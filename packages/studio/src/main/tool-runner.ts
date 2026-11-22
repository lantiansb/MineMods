import { execFile } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fillTemplate, type ToolManifest } from "@minemods/mod-core/tools/manifest"
import { toolProgram, type ToolEntry, type ToolEnvironment } from "@minemods/mod-core/tools/registry"

/**
 * Runs one tool that is not Studio's own (工具资产): a program, a web service or an MCP server, as its `tool.json` says, and hands back the file it made (or, for a
 * check, its findings as JSON). Studio's own (`builtin`) are run by the tool service. Every run has its own folder that is removed afterwards; nothing a tool writes
 * outside its `{out}` is taken. A program's arguments are passed one by one, never as one shell line. Keys are filled in only here, never handed back or logged.
 */

export type ToolProduct = { bytes: Uint8Array; mime: string; soundMeasurements?: import("@minemods/mod-core/sound").SoundMeasurements }
export class ToolRunError extends Error {
  constructor(
    message: string,
    /** What the person and the outside AI are told (no paths, no keys). */
    readonly plain: string,
  ) {
    super(message)
  }
}

export type RunTool = {
  runtimeRoot: string
  entry: ToolEntry & { manifest: ToolManifest }
  input: Record<string, unknown>
  /** A file handed to the tool (`{in}`): what a converter turns, a recording a check looks at. */
  given?: { bytes: Uint8Array; name: string }
  secrets: Record<string, string>
  environment: Pick<ToolEnvironment, "storeProgram">
  signal?: AbortSignal
  /** Stand-ins a test passes: the web (`fetch`) and an MCP client. */
  fetch?: typeof fetch
  mcp?: (server: { command: string; args: string[] } | { url: string }, tool: string, args: unknown) => Promise<{ content: { type: string; data?: string; mimeType?: string; text?: string }[]; structuredContent?: unknown }>
}

const MIME: Record<string, string> = { ogg: "audio/ogg", wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", json: "application/json", mp4: "video/mp4", webm: "video/webm" }
const mimeOf = (name: string) => MIME[path.extname(name).slice(1).toLowerCase()] ?? "application/octet-stream"

/** The value at a path of keys and list places (`data.0.b64_json`) of a JSON answer. */
export function atPath(value: unknown, where: string | undefined): unknown {
  if (!where) return value
  return where.split(".").reduce<unknown>((at, key) => (at && typeof at === "object" ? (at as Record<string, unknown>)[key] : undefined), value)
}

/** A file written as base64 or as a data URL, with what it says it is. */
export function fromBase64(text: unknown, fallback: string): ToolProduct {
  if (typeof text !== "string" || !text) throw new ToolRunError("TOOL_ANSWER_EMPTY", "工具的回答里没有找到它做出来的文件。")
  const data = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(text)
  return data ? { bytes: Buffer.from(data[3]!, data[2] ? "base64" : "utf8"), mime: data[1]! } : { bytes: Buffer.from(text, "base64"), mime: fallback }
}

function bounded(product: ToolProduct, manifest: ToolManifest): ToolProduct {
  if (product.bytes.byteLength === 0) throw new ToolRunError("TOOL_PRODUCT_EMPTY", "工具什么也没做出来（文件是空的）。")
  if (product.bytes.byteLength > manifest.limits.bytes) throw new ToolRunError("TOOL_PRODUCT_TOO_BIG", `工具做出来的文件有 ${product.bytes.byteLength} 字节，超过它说明里的上限 ${manifest.limits.bytes}。`)
  return product
}

export async function runTool(run: RunTool): Promise<ToolProduct> {
  const { manifest } = run.entry
  const runner = manifest.runner
  if (runner.type === "builtin") throw new Error("a builtin tool is run by the tool service")
  const work = await mkdtemp(path.join(os.tmpdir(), "minemods-tool-"))
  const out = path.join(work, "out")
  await mkdir(out)
  const timeout = AbortSignal.timeout(manifest.limits.seconds * 1000)
  const signal = run.signal ? AbortSignal.any([run.signal, timeout]) : timeout
  try {
    const inFile = run.given ? path.join(work, `in${path.extname(run.given.name) || ""}`) : undefined
    if (inFile) await writeFile(inFile, run.given!.bytes)
    const folder = run.entry.folder ? path.resolve(run.runtimeRoot, run.entry.folder) : work
    const given = { input: run.input, secrets: run.secrets, paths: { in: inFile, out, tool: folder } }
    if (runner.type === "command") {
      const program = await toolProgram(run.runtimeRoot, run.entry, runner.program, run.environment)
      if (!program) throw new ToolRunError("TOOL_PROGRAM_MISSING", `找不到工具要运行的程序（${runner.program}）。`)
      const args = runner.args.map((arg) => String(fillTemplate(arg, given)))
      await new Promise<void>((resolve, reject) => {
        // No shell: each argument reaches the program as it is.
        const child = execFile(program, args, { cwd: folder, signal, windowsHide: true, maxBuffer: 4 * 1024 * 1024, shell: false }, (error, _stdout, stderr) => {
          // Stopped (too long, or cancelled): the answer waits until the program is really gone — until then Windows keeps its folder busy, and the tool could not be taken out.
          if (signal.aborted) {
            const stopped = () => reject(new ToolRunError("TOOL_TIMEOUT", run.signal?.aborted ? "这次运行被停下了。" : `工具超过 ${manifest.limits.seconds} 秒还没做完，停下了。`))
            if (child.exitCode !== null || child.signalCode !== null) return stopped()
            child.once("exit", stopped)
            return
          }
          if (error) return reject(new ToolRunError(`TOOL_PROGRAM_FAILED: ${String(stderr).slice(-600)}`, `工具的程序出错退出了：${String(stderr).trim().split(/\r?\n/).slice(-2).join(" ").slice(0, 300) || error.message}`))
          resolve()
        })
      })
      const result = path.join(out, runner.result)
      const found = await stat(result).catch(() => null)
      if (!found?.isFile()) throw new ToolRunError("TOOL_RESULT_MISSING", `工具跑完了，可是没有写出它说的结果文件（${runner.result}）。`)
      if (found.size > manifest.limits.bytes) throw new ToolRunError("TOOL_PRODUCT_TOO_BIG", `工具做出来的文件超过它说明里的上限 ${manifest.limits.bytes} 字节。`)
      return bounded({ bytes: await readFile(result), mime: mimeOf(runner.result) }, manifest)
    }
    if (runner.type === "http") {
      const headers = fillTemplate(runner.headers, given) as Record<string, string>
      const body = runner.body === undefined ? undefined : JSON.stringify(fillTemplate(runner.body, given))
      const fetcher = run.fetch ?? fetch
      const response = await fetcher(runner.url, { method: runner.method, headers, body: runner.method === "GET" ? undefined : body, signal }).catch((error: unknown) => {
        throw new ToolRunError(`TOOL_HTTP: ${String(error)}`, signal.aborted ? `工具超过 ${manifest.limits.seconds} 秒还没回答，停下了。` : "连不上这个工具的网络服务。")
      })
      if (!response.ok) throw new ToolRunError(`TOOL_HTTP_STATUS: ${response.status}`, `这个工具的网络服务拒绝了请求（${response.status}）。${response.status === 401 || response.status === 403 ? "多半是密钥不对或过期了。" : ""}`)
      if (runner.answer.kind === "binary") return bounded({ bytes: new Uint8Array(await response.arrayBuffer()), mime: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream" }, manifest)
      const value = atPath(await response.json(), runner.answer.path)
      if (runner.answer.kind === "base64") return bounded(fromBase64(value, "application/octet-stream"), manifest)
      if (typeof value !== "string" || !/^https:\/\//.test(value)) throw new ToolRunError("TOOL_ANSWER_URL", "工具的回答里没有找到可以下载结果的地址。")
      const file = await fetcher(value, { signal })
      if (!file.ok) throw new ToolRunError(`TOOL_HTTP_FILE: ${file.status}`, "工具给的结果地址下载不下来。")
      return bounded({ bytes: new Uint8Array(await file.arrayBuffer()), mime: file.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream" }, manifest)
    }
    // An MCP server's tool.
    const declared = runner.server
    const server =
      "url" in declared
        ? { url: declared.url }
        : await (async () => {
            const program = await toolProgram(run.runtimeRoot, run.entry, declared.program, run.environment)
            if (!program) throw new ToolRunError("TOOL_PROGRAM_MISSING", `找不到工具的 MCP 服务程序（${declared.program}）。`)
            return { command: program, args: declared.args.map((arg: string) => String(fillTemplate(arg, given))) }
          })()
    if (!run.mcp) throw new Error("no MCP client")
    const answer = await run.mcp(server, runner.tool, fillTemplate(runner.arguments, given))
    if (runner.answer.kind === "base64") return bounded(fromBase64(atPath(answer.structuredContent, runner.answer.path), "application/octet-stream"), manifest)
    const file = answer.content.find((part) => (part.type === "audio" || part.type === "image" || part.type === "resource") && part.data)
    if (!file?.data) throw new ToolRunError("TOOL_ANSWER_EMPTY", "这个 MCP 工具的回答里没有音频或图片。")
    return bounded({ bytes: Buffer.from(file.data, "base64"), mime: file.mimeType ?? "application/octet-stream" }, manifest)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

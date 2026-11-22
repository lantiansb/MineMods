import { afterEach, expect, test } from "bun:test"
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TOOLS_FOLDER, type ToolManifest } from "@minemods/mod-core/tools/manifest"
import type { ToolEntry } from "@minemods/mod-core/tools/registry"
import { ToolRunError, atPath, fromBase64, runTool } from "../src/main/tool-runner"

/**
 * 工具资产: a tool that is a program, a web service or an MCP server is run as its tool.json says: arguments one by one (no shell), keys filled in only for the call,
 * what it made taken from its own folder, bounded in time and size, and every run's folder removed afterwards.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const runtime = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tool-run-"))
  roots.push(root)
  return root
}
const entry = (manifest: ToolManifest, folder: string | null = `${TOOLS_FOLDER}/${manifest.id}`): ToolEntry & { manifest: ToolManifest } => ({ id: manifest.id, folder, builtin: false, manifest, sha256: "0".repeat(64), state: "ready", problem: null })
const base = { schema_version: 1 as const, version: "1", title: "t", description: "d", role: "convert" as const, medium: "sound" as const, limits: { seconds: 20, bytes: 4096 } }
const environment = { storeProgram: () => null }

/** A program in the tool's folder: a link to this test's own runtime, which runs `run.js` next to it. */
async function programTool(root: string, script: string, args: string[], seconds = 20) {
  const manifest: ToolManifest = { ...base, id: "echo", limits: { seconds, bytes: 4096 }, input: { type: "object", properties: { word: { type: "string", description: "w" } }, required: [] }, runner: { type: "command", program: `bin/run${path.extname(process.execPath)}`, args, result: "result.ogg" } }
  const folder = path.join(root, TOOLS_FOLDER, "echo")
  await mkdir(path.join(folder, "bin"), { recursive: true })
  await link(process.execPath, path.join(folder, "bin", `run${path.extname(process.execPath)}`))
  await writeFile(path.join(folder, "run.js"), script)
  return entry(manifest)
}

test("a program runs in its folder with its arguments one by one; what it writes in {out} is what it made", async () => {
  const root = await runtime()
  const tool = await programTool(root, `require("fs").writeFileSync(process.argv[3], "OggS" + process.argv[2])`, ["{tool}/run.js", "a word; & | with spaces {input.word}", "{out}/result.ogg"])
  const made = await runTool({ runtimeRoot: root, entry: tool, input: { word: "吼" }, secrets: {}, environment })
  // The whole argument reached the program as one: a shell would have split it at the spaces and run what follows `&`.
  expect(Buffer.from(made.bytes).toString()).toBe("OggSa word; & | with spaces 吼")
  expect(made.mime).toBe("audio/ogg")
})

test("a program that fails, writes nothing, writes too much or takes too long is said so in plain words", async () => {
  const root = await runtime()
  const failing = await programTool(root, `console.error("bad input"); process.exit(3)`, ["{tool}/run.js"])
  const said = async (tool: typeof failing) => runTool({ runtimeRoot: root, entry: tool, input: {}, secrets: {}, environment }).then(() => "", (error: ToolRunError) => error.plain)
  expect(await said(failing)).toContain("工具的程序出错退出了：bad input")
  await writeFile(path.join(root, TOOLS_FOLDER, "echo", "run.js"), "")
  expect(await said(failing)).toBe("工具跑完了，可是没有写出它说的结果文件（result.ogg）。")
  await writeFile(path.join(root, TOOLS_FOLDER, "echo", "run.js"), `require("fs").writeFileSync(process.argv[2] + "/result.ogg", Buffer.alloc(9000))`)
  expect(await said({ ...failing, manifest: { ...failing.manifest, runner: { ...failing.manifest.runner, args: ["{tool}/run.js", "{out}"] } as never } })).toContain("超过它说明里的上限 4096")
  await writeFile(path.join(root, TOOLS_FOLDER, "echo", "run.js"), "setTimeout(() => {}, 60000)")
  expect(await said({ ...failing, manifest: { ...failing.manifest, limits: { seconds: 1, bytes: 4096 } } })).toBe("工具超过 1 秒还没做完，停下了。")
}, 30000)

test("a web service is called with the key filled in for the call only, and its answer read where the tool says", async () => {
  const root = await runtime()
  const seen: { auth: string | null; body: unknown }[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      seen.push({ auth: request.headers.get("authorization"), body: await request.json().catch(() => null) })
      const url = new URL(request.url)
      if (url.pathname === "/binary") return new Response(new Uint8Array([79, 103, 103, 83]), { headers: { "content-type": "audio/ogg" } })
      if (url.pathname === "/json") return Response.json({ data: [{ b64: "data:audio/wav;base64,UklGRg==" }] })
      return new Response("no", { status: 401 })
    },
  })
  try {
    const at = (route: string, answer: { kind: "binary" | "base64"; path?: string }): ToolManifest => ({ ...base, id: "api", role: "generate", input: { type: "object", properties: { prompt: { type: "string", description: "p" }, seconds: { type: "number", description: "s" } }, required: [] }, runner: { type: "http", url: `http://127.0.0.1:${server.port}/${route}`, method: "POST", headers: { Authorization: "Bearer {secret:KEY}" }, body: { text: "{input.prompt}", length: "{input.seconds}" }, answer } })
    const run = (manifest: ToolManifest) => runTool({ runtimeRoot: root, entry: entry(manifest), input: { prompt: "鼓声", seconds: 2 }, secrets: { KEY: "k-1" }, environment })
    expect(Buffer.from((await run(at("binary", { kind: "binary" }))).bytes).toString()).toBe("OggS")
    expect(seen[0]).toEqual({ auth: "Bearer k-1", body: { text: "鼓声", length: 2 } })
    const wav = await run(at("json", { kind: "base64", path: "data.0.b64" }))
    expect([wav.mime, Buffer.from(wav.bytes).toString()]).toEqual(["audio/wav", "RIFF"])
    const refused = await run(at("nope", { kind: "binary" })).catch((error: ToolRunError) => error)
    expect((refused as ToolRunError).plain).toBe("这个工具的网络服务拒绝了请求（401）。多半是密钥不对或过期了。")
    // The key is in no word handed back.
    expect(JSON.stringify(refused)).not.toContain("k-1")
    expect((refused as Error).message).not.toContain("k-1")
  } finally {
    server.stop(true)
  }
})

test("an MCP server's tool is called with its arguments filled in, and the file in its answer taken", async () => {
  const root = await runtime()
  const calls: unknown[] = []
  const manifest: ToolManifest = { ...base, id: "mcp-gen", role: "generate", input: { type: "object", properties: { prompt: { type: "string", description: "p" } }, required: [] }, runner: { type: "mcp", server: { url: "https://mcp.example.com/" }, tool: "make_sound", arguments: { description: "{input.prompt}" }, answer: { kind: "content" } } }
  const made = await runTool({
    runtimeRoot: root,
    entry: entry(manifest),
    input: { prompt: "蹄声" },
    secrets: {},
    environment,
    mcp: async (server, tool, args) => {
      calls.push({ server, tool, args })
      return { content: [{ type: "text", text: "done" }, { type: "audio", data: Buffer.from("OggS").toString("base64"), mimeType: "audio/ogg" }] }
    },
  })
  expect(calls).toEqual([{ server: { url: "https://mcp.example.com/" }, tool: "make_sound", args: { description: "蹄声" } }])
  expect([made.mime, Buffer.from(made.bytes).toString()]).toEqual(["audio/ogg", "OggS"])
})

test("the small readers: a path into a JSON answer, a file written as base64 or a data URL", () => {
  expect(atPath({ a: [{ b: 7 }] }, "a.0.b")).toBe(7)
  expect(atPath({ a: 1 }, undefined)).toEqual({ a: 1 })
  expect(Buffer.from(fromBase64("T2dnUw==", "audio/ogg").bytes).toString()).toBe("OggS")
  expect(fromBase64("data:image/png;base64,iVBORw==", "x").mime).toBe("image/png")
  expect(() => fromBase64(undefined, "x")).toThrow("TOOL_ANSWER_EMPTY")
})

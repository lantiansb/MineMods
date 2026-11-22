import { randomUUID } from "node:crypto"
import type { z } from "zod"
import type { SixViewToolTargetSchema } from "../external"
import { SOUND_ENCODER_REQUIRED, BUILTIN_MANIFESTS } from "@minemods/mod-core/tools/builtin"
import { TOOL_MEDIA, toolInputIssues, type ToolManifest } from "@minemods/mod-core/tools/manifest"
import { approveTool, ensureToolTemplates, loadTools, setToolEnabled, toolsForAi, watchTools, type ToolEntry } from "@minemods/mod-core/tools/registry"
import { ToolRunError, fromBase64, runTool, type RunTool, type ToolProduct } from "./tool-runner"

/**
 * The tools an outside AI may ask Studio to run (工具资产), and the runs it asked for. Which tools there are is read from the runtime's tools folder whenever it changes
 * (hot-plug); a run is checked against the tool's parameters, then run here (a program, a service, an MCP server, or Studio's own) and kept until it is read. A tool
 * that hands the work to the connected AI itself (`delegate-*`) waits for that AI to hand the file back (`finish`).
 *
 * What a run made is kept here as a file; what becomes of it — a sound asset, a six-view, a reviewer's pictures — is decided by whoever started it (`onProduct`).
 */

export type ToolRunState = "running" | "waiting" | "completed" | "failed"
export type ToolRun = {
  id: string
  tool: string
  project_id: string
  state: ToolRunState
  /** For a tool that hands the work to the connected AI: what it is asked to make, and how to hand it back. */
  ask: string | null
  /** What it made, once completed: its type and size (the file itself stays in Studio), and what Studio did with it. */
  product: { mime: string; bytes: number; saved: unknown } | null
  /** Why it failed, in plain words. */
  error: string | null
  started_at: string
  ended_at: string | null
  /** Where what it makes goes, besides being kept here: a model's six-view (`six_view`). Null: the run's own (a sound is saved as a sound asset by its name). */
  target: ToolTarget | null
}

export type ToolTarget = z.infer<typeof SixViewToolTargetSchema>

/** Builtin tools the service runs itself (beside the delegating ones), each added by its own step: `run` makes the file from the parameters. */
export type BuiltinRunners = Partial<Record<"sound-synth" | "scene-record" | "video-frames", (input: Record<string, unknown>, context: { projectId: string; signal: AbortSignal }) => Promise<ToolProduct>>>

export type ToolServiceOptions = {
  runtimeDirectory: string
  /** The keys the person saved for tools, decrypted only for a run. */
  secrets?: () => Promise<Record<string, string>>
  /** Where a program Studio downloaded is (`store:<id>`), or null. */
  storeProgram?: (id: string) => string | null | Promise<string | null>
  builtins?: BuiltinRunners
  requiresSoundEncoder?: boolean
  /** What becomes of a run's file (saved as an asset, …): its answer is kept on the run as `product.saved`. A throw fails the run with its words. */
  onProduct?: (run: ToolRun, product: ToolProduct, input: Record<string, unknown>, manifest: ToolManifest) => Promise<unknown>
  /** The tools changed (a folder put in, changed or taken out): the window reads them again. */
  onChange?: () => void
  /** Stand-ins a test passes to the runner. */
  runner?: Pick<RunTool, "fetch" | "mcp">
}

const KEEP = 200

export function createToolService(options: ToolServiceOptions) {
  const runs = new Map<string, ToolRun & { input: Record<string, unknown>; manifest: ToolManifest; controller: AbortController; file: ToolProduct | null }>()
  let cached: Promise<ToolEntry[]> | null = null
  const environment = async () => {
    const secrets = (await options.secrets?.()) ?? {}
    return { hasSecret: (name: string) => Boolean(secrets[name]), storeProgram: options.storeProgram ?? (() => null), secrets }
  }
  let stopWatching: (() => void) | null = null
  let closed = false
  // The folder is watched from the first time anybody asks for the tools (the window or an outside AI), not from the start: a service that never needs a tool holds no watch.
  let watching: Promise<void> | null = null
  const ready = () =>
    (watching ??= watchTools(options.runtimeDirectory, () => {
      cached = null
      options.onChange?.()
    })
      .then((stop) => {
        if (closed) stop()
        else stopWatching = stop
      })
      .catch(() => undefined))
  // The templates (an online sound maker, an online drawer) are written into a runtime once, turned off, the first time the tools are read.
  let templated: Promise<unknown> | null = null
  const entries = async () => {
    void ready()
    templated ??= ensureToolTemplates(options.runtimeDirectory).catch(() => undefined)
    const found = await (cached ??= templated.then(() => environment()).then((env) => loadTools(options.runtimeDirectory, env)))
    if (!options.requiresSoundEncoder || await options.storeProgram?.("ffmpeg")) return found
    return found.map((entry): ToolEntry => entry.state === "ready" && entry.manifest?.medium === "sound" && entry.manifest.role !== "check"
      ? { ...entry, state: "missing_program", problem: SOUND_ENCODER_REQUIRED }
      : entry)
  }

  const view = (run: ToolRun): ToolRun => ({ id: run.id, tool: run.tool, project_id: run.project_id, state: run.state, ask: run.ask, product: run.product, error: run.error, started_at: run.started_at, ended_at: run.ended_at, target: run.target })
  const forget = () => {
    const done = [...runs.values()].filter((run) => run.state === "completed" || run.state === "failed")
    for (const run of done.slice(0, Math.max(0, runs.size - KEEP))) runs.delete(run.id)
  }

  async function settle(id: string, made: Promise<ToolProduct>) {
    const run = runs.get(id)!
    try {
      const product = await made
      run.file = product
      const saved = options.onProduct ? await options.onProduct(view(run), product, run.input, run.manifest) : null
      Object.assign(run, { state: "completed", product: { mime: product.mime, bytes: product.bytes.byteLength, saved }, ended_at: new Date().toISOString() })
    } catch (error) {
      Object.assign(run, { state: "failed", error: error instanceof ToolRunError ? error.plain : error instanceof Error ? error.message : String(error), ended_at: new Date().toISOString() })
    }
  }

  return {
    ready,
    /** Every tool, as the person's storage page shows them. */
    entries: async () => entries(),
    /** The tools an outside AI may use now. */
    list: async (filter: { role?: string; medium?: string } = {}) => toolsForAi(await entries(), filter, Boolean(options.requiresSoundEncoder)),
    /** Starts a run; it goes on in the background (`get`). Refused, in plain words, when the tool is not ready or the parameters are not right. */
    start: async (input: { projectId: string; tool: string; input: unknown; target?: ToolTarget }) => {
      const entry = (await entries()).find((value) => value.id === input.tool)
      if (!entry?.manifest) throw new ToolRunError("TOOL_UNKNOWN", `没有叫「${input.tool}」的工具。用 list_tools 看现在能用哪些。`)
      if (entry.problem === SOUND_ENCODER_REQUIRED) throw new ToolRunError("FFMPEG_MISSING", SOUND_ENCODER_REQUIRED)
      if (entry.state !== "ready") throw new ToolRunError("TOOL_NOT_READY", `工具「${entry.manifest.title}」现在用不了：${entry.problem ?? entry.state}。这要用户在 Studio 里处理，不要换别的办法绕过去。`)
      const issues = toolInputIssues(entry.manifest, input.input)
      if (issues.length) throw new ToolRunError("TOOL_INPUT", `参数不对：${issues.join("；")}`)
      if (input.target?.kind === "six_view" && entry.manifest.medium !== "image") throw new ToolRunError("TOOL_TARGET", `六视图要用画图的工具，「${entry.manifest.title}」做的是${TOOL_MEDIA[entry.manifest.medium]}。`)
      const given = input.input as Record<string, unknown>
      const id = randomUUID()
      const manifest = entry.manifest
      const runner = manifest.runner
      const delegating = runner.type === "builtin" && (runner.name === "delegate-sound" || runner.name === "delegate-image")
      const controller = new AbortController()
      runs.set(id, {
        id,
        tool: entry.id,
        project_id: input.projectId,
        state: delegating ? "waiting" : "running",
        ask: delegating ? `请用你自己的生成${TOOL_MEDIA[manifest.medium]}的能力做出来：${String(given.prompt ?? "")}。做好以后调用 finish_tool_run（run 写这次的编号）带 file（data URL）交回；你没有这种能力就带 unsupported 写明原因，不要用脚本、占位图或别的文件冒充。` : null,
        product: null,
        error: null,
        started_at: new Date().toISOString(),
        ended_at: null,
        target: input.target ?? null,
        input: given,
        manifest,
        controller,
        file: null,
      })
      forget()
      if (!delegating) {
        if (runner.type === "builtin") {
          const own = options.builtins?.[runner.name as keyof BuiltinRunners]
          void settle(id, own ? own(given, { projectId: input.projectId, signal: controller.signal }) : Promise.reject(new ToolRunError("TOOL_BUILTIN_MISSING", `Studio 自带的工具「${manifest.title}」这一版还没有接上。`)))
        } else {
          const env = await environment()
          void settle(id, runTool({ runtimeRoot: options.runtimeDirectory, entry: { ...entry, manifest }, input: given, secrets: env.secrets, environment: env, signal: controller.signal, ...options.runner }))
        }
      }
      return view(runs.get(id)!)
    },
    get: (input: { projectId: string; run: string }) => {
      const run = runs.get(input.run)
      if (!run || run.project_id !== input.projectId) throw new ToolRunError("TOOL_RUN_UNKNOWN", "没有这次运行（编号不对，或者 Studio 重启过）。")
      return view(run)
    },
    /** The connected AI hands back what a delegating tool asked it to make, or says it cannot. */
    finish: async (input: { projectId: string; run: string; file?: string; unsupported?: string }) => {
      const run = runs.get(input.run)
      if (!run || run.project_id !== input.projectId) throw new ToolRunError("TOOL_RUN_UNKNOWN", "没有这次运行（编号不对，或者 Studio 重启过）。")
      if (run.state !== "waiting") throw new ToolRunError("TOOL_RUN_NOT_WAITING", "这次运行不在等你交东西：只有交给你自己生成的工具才用 finish_tool_run。")
      if (input.unsupported) {
        Object.assign(run, { state: "failed", error: `连接的 AI 说它做不了：${input.unsupported.slice(0, 400)}`, ended_at: new Date().toISOString() })
        return view(run)
      }
      if (!input.file) throw new ToolRunError("TOOL_FINISH_EMPTY", "finish_tool_run 要带 file（data URL）或者 unsupported（为什么做不了）。")
      run.state = "running"
      await settle(run.id, Promise.resolve().then(() => {
        const product = fromBase64(input.file, "application/octet-stream")
        if (product.bytes.byteLength > run.manifest.limits.bytes) throw new ToolRunError("TOOL_PRODUCT_TOO_BIG", `交回的文件太大（${product.bytes.byteLength} 字节，最多 ${run.manifest.limits.bytes}）。`)
        const wanted = run.manifest.medium === "sound" ? "audio/" : run.manifest.medium === "image" ? "image/" : "video/"
        if (!product.mime.startsWith(wanted)) throw new ToolRunError("TOOL_PRODUCT_KIND", `这个工具要的是${TOOL_MEDIA[run.manifest.medium]}，交回的是 ${product.mime}。`)
        return product
      }))
      return view(run)
    },
    /** The file a completed run made (for whoever started it to keep). */
    file: (run: string) => runs.get(run)?.file ?? null,
    cancel: (input: { projectId: string; run: string }) => {
      const run = runs.get(input.run)
      if (!run || run.project_id !== input.projectId) return null
      run.controller.abort()
      if (run.state === "waiting") Object.assign(run, { state: "failed", error: "这次运行被停下了。", ended_at: new Date().toISOString() })
      return view(run)
    },
    /** The person turned a folder tool on, having seen this `tool.json` (its sha256 as the storage page showed it). Only the window calls this, from the person's click. */
    approve: async (input: { id: string; sha256: string }) => {
      const entry = (await entries()).find((value) => value.id === input.id)
      if (!entry || entry.builtin || entry.sha256 !== input.sha256) throw new ToolRunError("TOOL_APPROVE_STALE", "这个工具的说明在你看的时候改过了，请重新看一遍再启用。")
      await approveTool(options.runtimeDirectory, input.id, input.sha256)
      cached = null
      options.onChange?.()
    },
    /** The person turned a tool off, or on again. */
    setEnabled: async (input: { id: string; enabled: boolean }) => {
      await setToolEnabled(options.runtimeDirectory, input.id, input.enabled)
      cached = null
      options.onChange?.()
    },
    /** A key was saved or removed: what the tools lack is read again. */
    secretsChanged: () => {
      cached = null
      options.onChange?.()
    },
    close: () => {
      closed = true
      stopWatching?.()
      stopWatching = null
    },
  }
}

/** The ids of Studio's own tools, for words that name them. */
export const BUILTIN_TOOL_IDS = Object.keys(BUILTIN_MANIFESTS)

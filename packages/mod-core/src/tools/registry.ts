import { createHash } from "node:crypto"
import { watch, type FSWatcher } from "node:fs"
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { STORE_FOLDER } from "../store/catalog"
import { BUILTIN_MANIFESTS, TOOL_TEMPLATES } from "./builtin"
import { TOOLS_FOLDER, TOOL_FILE, ToolManifestSchema, toolSecrets, type ToolManifest } from "./manifest"

/**
 * The tools Studio knows right now (工具资产): its own (`BUILTIN_MANIFESTS`) and every folder under the runtime's `tools/` with a `tool.json`. Read again whenever the
 * folder changes (`watchTools`), so a tool put in, changed or taken out is there or gone at once, without restarting anything.
 *
 * A tool in a folder runs a program, reaches an address or starts a server the person may not have looked at, so it is usable only once the person turned it on in
 * Studio, for exactly the `tool.json` they saw (its sha256): a changed file asks again. That choice lives in the runtime's store folder, written only by Studio's own
 * process; nothing an outside AI calls can turn a tool on.
 */

/** Why a tool can or cannot be run now, said to the person and to an outside AI. */
export const TOOL_STATES = {
  ready: "可以用",
  unapproved: "新放进来的工具，等你在 Studio 里看过再启用",
  disabled: "你停用了",
  invalid: "工具说明写得不对",
  missing_program: "找不到它要运行的程序",
  missing_secret: "还没有在 Studio 里存它要的密钥",
} as const
export type ToolState = keyof typeof TOOL_STATES

export type ToolEntry = {
  id: string
  /** Its folder, relative to the runtime; null for Studio's own. */
  folder: string | null
  builtin: boolean
  manifest: ToolManifest | null
  /** The sha256 of its `tool.json` as read; null for Studio's own. */
  sha256: string | null
  state: ToolState
  /** What is wrong, in plain words, when it is not ready. */
  problem: string | null
}

const ApprovalsSchema = z.strictObject({
  schema_version: z.literal(1),
  /** The tool.json the person turned on, by id: its sha256 then. */
  approved: z.record(z.string(), z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/), at: z.iso.datetime() })),
  /** Tools the person turned off (Studio's own too). */
  disabled: z.array(z.string()).max(1000),
  /** Templates already written once: one the person deleted is not written again. */
  templates: z.array(z.string()).max(100).default([]),
})
type Approvals = z.infer<typeof ApprovalsSchema>

const approvalsPath = (runtimeRoot: string) => path.join(runtimeRoot, STORE_FOLDER, "tool-approvals.json")
const emptyApprovals = (): Approvals => ({ schema_version: 1, approved: {}, disabled: [], templates: [] })

export async function readApprovals(runtimeRoot: string): Promise<Approvals> {
  const text = await readFile(approvalsPath(runtimeRoot), "utf8").catch(() => null)
  if (text === null) return emptyApprovals()
  try {
    return ApprovalsSchema.parse(JSON.parse(text))
  } catch {
    // A file that cannot be read turns every folder tool off again: the person is asked once more, nothing runs unasked.
    return emptyApprovals()
  }
}

async function writeApprovals(runtimeRoot: string, approvals: Approvals) {
  const file = approvalsPath(runtimeRoot)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(ApprovalsSchema.parse(approvals), null, 2)}\n`)
  await rename(temporary, file)
}

const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex")

/** What a tool needs from Studio to be checked: whether a key is saved, and where a downloaded program is (`store:<id>`), or null when it is not installed. */
export type ToolEnvironment = { hasSecret: (name: string) => boolean; storeProgram: (id: string) => string | null | Promise<string | null> }

/** The program a command or MCP tool runs, as a full path, or null when it is missing: inside its own folder, or one Studio downloaded. */
export async function toolProgram(runtimeRoot: string, entry: Pick<ToolEntry, "folder">, program: string, environment: Pick<ToolEnvironment, "storeProgram">): Promise<string | null> {
  if (program.startsWith("store:")) return await environment.storeProgram(program.slice("store:".length))
  if (!entry.folder) return null
  const folder = path.resolve(runtimeRoot, entry.folder)
  const full = path.resolve(folder, program)
  // Never outside its own folder, whatever the file says.
  if (path.relative(folder, full).startsWith("..") || path.isAbsolute(path.relative(folder, full))) return null
  const found = await stat(full).catch(() => null)
  return found?.isFile() ? full : null
}

/** Every tool Studio knows, with what it can do now: Studio's own first, then the folders by name. */
export async function loadTools(runtimeRoot: string, environment: ToolEnvironment): Promise<ToolEntry[]> {
  const approvals = await readApprovals(runtimeRoot)
  const disabled = new Set(approvals.disabled)
  const own: ToolEntry[] = Object.values(BUILTIN_MANIFESTS).map((manifest) => ({ id: manifest.id, folder: null, builtin: true, manifest, sha256: null, state: disabled.has(manifest.id) ? "disabled" : "ready", problem: disabled.has(manifest.id) ? TOOL_STATES.disabled : null }))
  const root = path.join(runtimeRoot, TOOLS_FOLDER)
  const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const seen = new Set(own.map((entry) => entry.id))
  const folders: ToolEntry[] = []
  for (const name of names) {
    const folder = path.join(TOOLS_FOLDER, name)
    const text = await readFile(path.join(root, name, TOOL_FILE)).catch(() => null)
    // A folder without its description is not a tool (yet): a program's own files, or one being copied in.
    if (text === null) continue
    const invalid = (problem: string): ToolEntry => ({ id: name, folder, builtin: false, manifest: null, sha256: sha256(text), state: "invalid", problem })
    let parsed: z.ZodSafeParseResult<ToolManifest>
    try {
      parsed = ToolManifestSchema.safeParse(JSON.parse(text.toString("utf8").replace(/^﻿/, "")))
    } catch (error) {
      folders.push(invalid(`${TOOL_FILE} 不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`))
      continue
    }
    if (!parsed.success) {
      folders.push(invalid(parsed.error.issues.map((issue) => `${issue.path.join(".") || "（整个文件）"}：${issue.message}`).join("；")))
      continue
    }
    const manifest = parsed.data
    if (seen.has(manifest.id)) {
      folders.push(invalid(`和另一个工具同名（${manifest.id}）：每个工具的 id 要不一样`))
      continue
    }
    seen.add(manifest.id)
    const entry: ToolEntry = { id: manifest.id, folder, builtin: false, manifest, sha256: sha256(text), state: "ready", problem: null }
    folders.push({ ...entry, ...(await folderState(runtimeRoot, entry, manifest, approvals, environment)) })
  }
  return [...own, ...folders]
}

async function folderState(runtimeRoot: string, entry: ToolEntry, manifest: ToolManifest, approvals: Approvals, environment: ToolEnvironment): Promise<Pick<ToolEntry, "state" | "problem">> {
  if (approvals.disabled.includes(manifest.id)) return { state: "disabled", problem: TOOL_STATES.disabled }
  if (approvals.approved[manifest.id]?.sha256 !== entry.sha256) return { state: "unapproved", problem: approvals.approved[manifest.id] ? "工具说明改过了，等你在 Studio 里再看一遍再启用" : TOOL_STATES.unapproved }
  const runner = manifest.runner
  const program = runner.type === "command" ? runner.program : runner.type === "mcp" && "program" in runner.server ? runner.server.program : null
  if (program !== null && (await toolProgram(runtimeRoot, entry, program, environment)) === null) return { state: "missing_program", problem: `${TOOL_STATES.missing_program}：${program}` }
  const missing = toolSecrets(manifest).filter((name) => !environment.hasSecret(name))
  if (missing.length) return { state: "missing_secret", problem: `${TOOL_STATES.missing_secret}：${missing.join("、")}` }
  return { state: "ready", problem: null }
}

/** The person turned a folder tool on, having seen this `tool.json` (its sha256 as `loadTools` read it). Only Studio's own process calls this, from the person's click. */
export async function approveTool(runtimeRoot: string, id: string, seen: string) {
  const approvals = await readApprovals(runtimeRoot)
  await writeApprovals(runtimeRoot, { ...approvals, approved: { ...approvals.approved, [id]: { sha256: seen, at: new Date().toISOString() } }, disabled: approvals.disabled.filter((value) => value !== id) })
}

/** The person turned a tool off, or on again (Studio's own, or a folder tool already approved for this file). */
export async function setToolEnabled(runtimeRoot: string, id: string, enabled: boolean) {
  const approvals = await readApprovals(runtimeRoot)
  const disabled = approvals.disabled.filter((value) => value !== id)
  await writeApprovals(runtimeRoot, { ...approvals, disabled: enabled ? disabled : [...disabled, id] })
}

/** Writes the templates (`TOOL_TEMPLATES`) a runtime has not had yet, each once; a template the person deleted stays deleted. They start turned off (not approved). */
export async function ensureToolTemplates(runtimeRoot: string) {
  const approvals = await readApprovals(runtimeRoot)
  const fresh = Object.keys(TOOL_TEMPLATES).filter((id) => !approvals.templates.includes(id))
  if (!fresh.length) return []
  for (const id of fresh) {
    const folder = path.join(runtimeRoot, TOOLS_FOLDER, id)
    await mkdir(folder, { recursive: true })
    const file = path.join(folder, TOOL_FILE)
    if (!(await stat(file).catch(() => null))) await writeFile(file, `${JSON.stringify(TOOL_TEMPLATES[id], null, 2)}\n`)
  }
  await writeApprovals(runtimeRoot, { ...approvals, templates: [...approvals.templates, ...fresh] })
  return fresh
}

/**
 * Calls `changed` (at most once per `quiet` milliseconds) whenever anything under the runtime's `tools/` is added, changed or removed: the caller reads `loadTools`
 * again. Returns a function that stops watching. The folder is made if it is not there, so a tool can be dropped in at any time.
 */
export async function watchTools(runtimeRoot: string, changed: () => void, quiet = 300): Promise<() => void> {
  const root = path.join(runtimeRoot, TOOLS_FOLDER)
  await mkdir(root, { recursive: true })
  let timer: ReturnType<typeof setTimeout> | null = null
  const nudge = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      changed()
    }, quiet)
  }
  let watcher: FSWatcher | null = watch(root, { recursive: true }, nudge)
  watcher.on("error", () => undefined)
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
    watcher = null
  }
}

/** What an outside AI is told of the tools it may use, plus enabled sound tools that need a program. Never the program path or a key. */
export function toolsForAi(entries: readonly ToolEntry[], filter: { role?: string; medium?: string } = {}, showUnavailableSound = false) {
  return entries
    .filter((entry) => (entry.state === "ready" || (showUnavailableSound && entry.state === "missing_program" && entry.manifest?.medium === "sound")) && entry.manifest && (!filter.role || entry.manifest.role === filter.role) && (!filter.medium || entry.manifest.medium === filter.medium))
    .map((entry) => ({ id: entry.id, title: entry.manifest!.title, description: entry.manifest!.description, role: entry.manifest!.role, medium: entry.manifest!.medium, input: entry.manifest!.input, limits: entry.manifest!.limits, builtin: entry.builtin, state: entry.state, problem: entry.problem }))
}

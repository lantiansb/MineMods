import { chmod, copyFile, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import { constants, existsSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse as parseToml } from "smol-toml"
import type { AiClientDetection, AiClientId, ConnectProblem, ConnectResult, ConnectState, ConnectedFile } from "../ai-clients"
import { AI_CLIENT_IDS } from "../ai-clients"

/**
 * 一键接上 (broad20, round 22): find the AI assistants this computer already has, and put Studio's entry into their settings file when the person
 * presses the button. Never in the background, never anything but that one entry: every other entry and setting stays as it was, a copy of the file
 * is kept next to it first, and a file that cannot be understood is left exactly as it is.
 */

/** The name Studio's entry has in every assistant's settings; the same as in the text people copy by hand. */
export const SERVER_NAME = "minemods-studio"

/** Studio's entry as `configurationParts` (mcp-handoff.ts) makes it: the one source for the copied text and for what is written here. */
export type ServerEntry = {
  command: string
  args: string[]
  env: Record<string, string> | null
  json: Record<string, unknown>
  toml: string
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Where things are
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** What the detection needs to know about the computer; the tests give it a folder of their own instead of the real one. */
export type Probe = {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  home: string
  exists(target: string): boolean
  /** Names inside a folder; none when it is not there. */
  list(target: string): string[]
}

export const realProbe = (): Probe => ({
  platform: process.platform,
  env: process.env,
  home: os.homedir(),
  exists: (target) => existsSync(target),
  list: (target) => {
    try {
      return readdirSync(target)
    } catch {
      return []
    }
  },
})

/**
 * Where an assistant keeps the setting Studio goes into, and whether it is on this computer. An assistant counts as there when its program is found
 * or its own settings folder is (it has been run here): the second is why an install in an unusual place still shows up.
 * `files` is every settings file that assistant may read on this computer.
 */
export type Where = { installed: boolean; files: string[] }

const CLAUDE_FILE = "claude_desktop_config.json"

export function whereClaudeDesktop(probe: Probe): Where {
  const { platform, env, home } = probe
  if (platform === "win32") {
    const roaming = env.APPDATA?.trim() || path.join(home, "AppData", "Roaming")
    const local = env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local")
    const files: string[] = []
    // The installer from claude.com/download: the program is under AnthropicClaude, the settings under Roaming\Claude.
    if (probe.exists(path.join(local, "AnthropicClaude")) || probe.exists(path.join(roaming, "Claude"))) files.push(path.join(roaming, "Claude", CLAUDE_FILE))
    // The Microsoft Store / MSIX package: Windows keeps what the app writes to Roaming inside the package's own folder, and the app reads only that copy.
    for (const name of probe.list(path.join(local, "Packages")))
      if (/^Claude_[a-z0-9]+$/i.test(name)) files.push(path.join(local, "Packages", name, "LocalCache", "Roaming", "Claude", CLAUDE_FILE))
    return { installed: files.length > 0, files }
  }
  if (platform === "darwin") {
    const support = path.join(home, "Library", "Application Support", "Claude")
    const there = [path.join("/Applications", "Claude.app"), path.join(home, "Applications", "Claude.app"), support].some((target) => probe.exists(target))
    return { installed: there, files: there ? [path.join(support, CLAUDE_FILE)] : [] }
  }
  // There is no Claude desktop app for other systems.
  return { installed: false, files: [] }
}

export function whereCodex(probe: Probe): Where {
  const { platform, env, home } = probe
  const codexHome = env.CODEX_HOME?.trim() || path.join(home, ".codex")
  const win = platform === "win32"
  const local = env.LOCALAPPDATA?.trim() || path.join(home, "AppData", "Local")
  const roaming = env.APPDATA?.trim() || path.join(home, "AppData", "Roaming")
  // The command-line program: on the PATH, or where the usual installers put it (a window opened from the desktop does not get a terminal's PATH).
  const programs = win ? ["codex.cmd", "codex.exe", "codex.ps1"] : ["codex"]
  const folders = [
    ...(env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean),
    ...(win
      ? [path.join(roaming, "npm"), path.join(home, ".bun", "bin")]
      : ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".npm-global", "bin"), path.join(home, ".local", "bin"), path.join(home, ".bun", "bin")]),
  ]
  const cli = folders.some((folder) => programs.some((program) => probe.exists(path.join(folder, program))))
  const app =
    platform === "darwin"
      ? [path.join("/Applications", "Codex.app"), path.join(home, "Applications", "Codex.app")].some((target) => probe.exists(target))
      : win
        ? probe.list(path.join(local, "Packages")).some((name) => /^OpenAI\.Codex_/i.test(name))
        : false
  // The folder is shared by the command-line program, the desktop app and the editor extension, so whichever of them is used, one file serves all.
  const installed = cli || app || probe.exists(codexHome)
  return { installed, files: installed ? [path.join(codexHome, "config.toml")] : [] }
}

export const whereClient = (client: AiClientId, probe: Probe) => (client === "claude-desktop" ? whereClaudeDesktop(probe) : whereCodex(probe))

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Merging Studio's entry into a settings file (text in, text out; nothing here touches the disk)
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type Merge =
  | { ok: true; text: string; change: "added" | "updated" | "unchanged" }
  | { ok: false; problem: Extract<ConnectProblem, "unreadable" | "unusual"> }

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)

/** Whether two parsed settings are the same thing (key order does not matter; TOML dates are compared by the moment they name). */
export function same(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) return left instanceof Date && right instanceof Date && left.toISOString() === right.toISOString()
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]))
  if (plain(left) || plain(right)) {
    if (!plain(left) || !plain(right)) return false
    const keys = Object.keys(left)
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  }
  return Object.is(left, right)
}

const BOM = "﻿"
const split = (text: string | null) => {
  const bom = text?.startsWith(BOM) ? BOM : ""
  return { bom, body: (text ?? "").slice(bom.length) }
}

/**
 * Claude desktop's file (JSON): Studio's entry goes under `mcpServers`; a same-named entry is replaced, every other entry and every other setting is
 * kept. A missing or empty file is a new one. Not JSON, or `mcpServers` not an object: not touched.
 */
export function mergeClaudeJson(existing: string | null, server: Record<string, unknown>): Merge {
  const { bom, body } = split(existing)
  let root: Record<string, unknown> = {}
  if (body.trim() !== "") {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return { ok: false, problem: "unreadable" }
    }
    if (!plain(parsed)) return { ok: false, problem: "unusual" }
    root = parsed
  }
  if (root.mcpServers !== undefined && !plain(root.mcpServers)) return { ok: false, problem: "unusual" }
  const servers = (root.mcpServers as Record<string, unknown> | undefined) ?? {}
  const had = Object.hasOwn(servers, SERVER_NAME)
  if (had && same(servers[SERVER_NAME], server)) return { ok: true, text: existing ?? "", change: "unchanged" }
  servers[SERVER_NAME] = server
  root.mcpServers = servers
  // The file keeps the indentation it had (tabs or the first indent found); a new one gets two spaces, as Claude writes it.
  const indent = /^([ \t]{1,8})"/m.exec(body)?.[1] ?? "  "
  return { ok: true, text: `${bom}${JSON.stringify(root, null, indent)}\n`, change: had ? "updated" : "added" }
}

/** `[a.b."c d"]` → ["a","b","c d"]; null when the line is not a table header. */
function tableHeader(line: string): { array: boolean; path: string[] } | null {
  const match = /^\s*(\[\[?)\s*(.+?)\s*(\]\]?)\s*(?:#.*)?$/.exec(line)
  if (!match || match[1]!.length !== match[3]!.length) return null
  const keys: string[] = []
  const text = match[2]!
  let index = 0
  while (index < text.length) {
    const char = text[index]!
    let key: string
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1
      if (end >= text.length) return null
      try {
        key = JSON.parse(text.slice(index, end + 1)) as string
      } catch {
        return null
      }
      index = end + 1
    } else if (char === "'") {
      const end = text.indexOf("'", index + 1)
      if (end < 0) return null
      key = text.slice(index + 1, end)
      index = end + 1
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(text.slice(index))
      if (!bare) return null
      key = bare[0]
      index += key.length
    }
    keys.push(key)
    while (text[index] === " " || text[index] === "\t") index += 1
    if (index >= text.length) break
    if (text[index] !== ".") return null
    index += 1
    while (text[index] === " " || text[index] === "\t") index += 1
  }
  return keys.length ? { array: match[1]!.length === 2, path: keys } : null
}

/** After one line: whether a multi-line string (""" or ''') is still open, so its lines are not read as table headers. */
function stringOpenAfter(line: string, open: string | null) {
  let current = open
  let index = 0
  while (index < line.length) {
    if (current) {
      if (current === '"""' && line[index] === "\\") index += 2
      else if (line.startsWith(current, index)) {
        current = null
        index += 3
      } else index += 1
      continue
    }
    const char = line[index]
    if (char === "#") break
    if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
      current = line.slice(index, index + 3)
      index += 3
    } else if (char === '"') {
      index += 1
      while (index < line.length && line[index] !== '"') index += line[index] === "\\" ? 2 : 1
      index += 1
    } else if (char === "'") {
      index = line.indexOf("'", index + 1)
      index = index < 0 ? line.length : index + 1
    } else index += 1
  }
  return current
}

const isStudioTable = (header: { array: boolean; path: string[] } | null) =>
  !!header && !header.array && header.path.length >= 2 && header.path[0] === "mcp_servers" && header.path[1] === SERVER_NAME

/**
 * Codex's file (TOML): Studio's table (and its env table) is replaced where it stands, or added at the end; everything else is kept as written, comments
 * included. The result is read back and must equal the original with only Studio's entry changed; if it does not (an unusual layout), nothing is written.
 */
export function mergeCodexToml(existing: string | null, server: Pick<ServerEntry, "command" | "args" | "env" | "toml">): Merge {
  const { bom, body } = split(existing)
  let before: Record<string, unknown> = {}
  if (body.trim() !== "") {
    try {
      before = parseToml(body)
    } catch {
      return { ok: false, problem: "unreadable" }
    }
  }
  if (before.mcp_servers !== undefined && !plain(before.mcp_servers)) return { ok: false, problem: "unusual" }
  const wanted = { command: server.command, args: server.args, ...(server.env ? { env: server.env } : {}) }
  const prior = (before.mcp_servers as Record<string, unknown> | undefined)?.[SERVER_NAME]
  if (prior !== undefined && same(prior, wanted)) return { ok: true, text: existing ?? "", change: "unchanged" }

  const eol = body.includes("\r\n") ? "\r\n" : "\n"
  const block = server.toml.split("\n")
  const out: string[] = []
  let placed = false
  // The block is followed by one blank line unless what follows it already starts with one.
  let gap = false
  let removing = false
  let trail: string[] = []
  let open: string | null = null
  const place = () => {
    if (placed) return
    placed = true
    gap = true
    out.push(...block)
  }
  for (const line of body.split(/\r?\n/)) {
    const header = open ? null : tableHeader(line)
    const wasOpen = open !== null
    open = stringOpenAfter(line, open)
    if (header) {
      // What lay between the old entry's last setting and the next table (blank lines, comments) belongs to what follows it, so it stays;
      // between two of Studio's own tables it goes with them.
      removing = isStudioTable(header)
      if (!removing) {
        if (gap && trail[0]?.trim() !== "") out.push("")
        gap = false
        out.push(...trail)
      }
      trail = []
      if (removing) {
        place()
        continue
      }
      out.push(line)
      continue
    }
    if (!removing) {
      out.push(line)
      continue
    }
    if (!wasOpen && (line.trim() === "" || line.trim().startsWith("#"))) trail.push(line)
    else trail = []
  }
  out.push(...trail)
  if (!placed) {
    while (out.length && out[out.length - 1]!.trim() === "") out.pop()
    if (out.length) out.push("")
    place()
  }
  while (out.length && out[out.length - 1]!.trim() === "") out.pop()
  const text = `${bom}${out.join(eol)}${eol}`

  // Read it back: the same as before, but for Studio's entry.
  let after: Record<string, unknown>
  try {
    after = parseToml(text)
  } catch {
    return { ok: false, problem: "unusual" }
  }
  const expected = { ...before, mcp_servers: { ...((before.mcp_servers as Record<string, unknown> | undefined) ?? {}), [SERVER_NAME]: wanted } }
  if (!same(after, expected)) return { ok: false, problem: "unusual" }
  return { ok: true, text, change: prior === undefined ? "added" : "updated" }
}

export const mergeFor = (client: AiClientId, existing: string | null, server: ServerEntry): Merge =>
  client === "claude-desktop" ? mergeClaudeJson(existing, server.json) : mergeCodexToml(existing, server)

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reading, backing up, writing
// ---------------------------------------------------------------------------------------------------------------------------------------------

const missing = (cause: unknown) => (cause as NodeJS.ErrnoException)?.code === "ENOENT"
const detailOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** The file's text, or null when there is no such file. Anything else that goes wrong is thrown. */
async function readSettings(target: string) {
  try {
    return await readFile(target, "utf8")
  } catch (cause) {
    if (missing(cause)) return null
    throw cause
  }
}

/** A name for the copy kept beside a settings file: `config.toml.minemods-20261019-153012.bak`, with a number added if that name is taken. */
export function backupName(target: string, at: Date, attempt = 1) {
  const two = (value: number) => String(value).padStart(2, "0")
  const stamp = `${at.getFullYear()}${two(at.getMonth() + 1)}${two(at.getDate())}-${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`
  return `${target}.minemods-${stamp}${attempt > 1 ? `-${attempt}` : ""}.bak`
}

async function backUp(target: string, at: Date) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const copy = backupName(target, at, attempt)
    try {
      await copyFile(target, copy, constants.COPYFILE_EXCL)
      return copy
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== "EEXIST") throw cause
    }
  }
  throw new Error("同一秒内备份太多次。")
}

/** The new text goes to a file beside the settings first and is moved over it, so a failure half-way leaves the old file whole. */
async function writeWhole(target: string, text: string, mode: number | null) {
  const temporary = `${target}.minemods-tmp`
  try {
    await writeFile(temporary, text, { encoding: "utf8", ...(mode === null ? {} : { mode }) })
    if (mode !== null) await chmod(temporary, mode)
    await rename(temporary, target)
  } catch (cause) {
    await unlink(temporary).catch(() => undefined)
    throw cause
  }
}

type Planned = { target: string; existing: string | null; merge: Extract<Merge, { ok: true }> }
type Failure = Extract<ConnectResult, { ok: false }>

/**
 * Press of the button: put Studio's entry into every settings file the assistant may read here. All the files are read and merged before any is
 * written, so a file that cannot be understood stops it before anything changes. Failures come back as a result, with the file they concern.
 */
export async function connectClient(client: AiClientId, probe: Probe, server: ServerEntry, now: Date = new Date()): Promise<ConnectResult> {
  const where = whereClient(client, probe)
  const fail = (problem: ConnectProblem, target: string, backup: string | null, cause?: unknown): Failure => ({
    ok: false,
    client,
    problem,
    path: target,
    backup,
    ...(cause === undefined ? {} : { detail: detailOf(cause) }),
  })
  if (!where.installed || !where.files.length) return fail("not-installed", "", null)

  const planned: Planned[] = []
  for (const listed of where.files) {
    // A settings file that is a link to somewhere else (kept by a dotfile tool, say) is changed where it really is.
    const target = await realpath(listed).catch(() => listed)
    let existing: string | null
    try {
      existing = await readSettings(target)
    } catch (cause) {
      return fail("no-access", target, null, cause)
    }
    const merge = mergeFor(client, existing, server)
    if (!merge.ok) return fail(merge.problem, target, null)
    planned.push({ target, existing, merge })
  }

  const files: ConnectedFile[] = []
  for (const { target, existing, merge } of planned) {
    if (merge.change === "unchanged") {
      files.push({ path: target, backup: null, change: "unchanged" })
      continue
    }
    let backup: string | null = null
    try {
      await mkdir(path.dirname(target), { recursive: true })
      if (existing !== null) backup = await backUp(target, now)
      const mode = existing === null ? null : (await stat(target)).mode & 0o777
      await writeWhole(target, merge.text, mode)
    } catch (cause) {
      return fail("no-access", target, backup, cause)
    }
    // Read back what is on the disk: it must be Studio's entry, as it would be written today.
    const back = await readSettings(target).then(
      (text) => mergeFor(client, text, server),
      () => null,
    )
    if (!back || !back.ok || back.change !== "unchanged") return fail("mismatch", target, backup)
    files.push({ path: target, backup, change: merge.change })
  }
  return { ok: true, client, files }
}

/** For each assistant: on this computer or not, and where Studio stands in its settings. Reads only; nothing is written. */
export async function detectClients(probe: Probe, server: ServerEntry): Promise<AiClientDetection> {
  const clients = await Promise.all(
    AI_CLIENT_IDS.map(async (id) => {
      const where = whereClient(id, probe)
      if (!where.installed) return { id, installed: false, state: "absent" as ConnectState }
      const states: ConnectState[] = []
      for (const file of where.files) {
        try {
          const merge = mergeFor(id, await readSettings(file), server)
          states.push(!merge.ok ? "unreadable" : merge.change === "unchanged" ? "current" : merge.change === "updated" ? "outdated" : "absent")
        } catch {
          states.push("unreadable")
        }
      }
      // The first that needs attention is what is shown: a file that cannot be read, then one that is out of date, then one with no entry.
      const state = (["unreadable", "outdated", "absent", "current"] as const).find((candidate) => states.includes(candidate)) ?? "absent"
      return { id, installed: true, state, files: where.files }
    }),
  )
  return { clients }
}

import { afterAll, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { parse as parseToml } from "smol-toml"
import { backupName, connectClient, detectClients, mergeClaudeJson, mergeCodexToml, whereClaudeDesktop, whereCodex, type Probe, type ServerEntry } from "../src/main/ai-client-config"
import { configurationParts } from "../src/main/mcp-handoff"
import { AI_CLIENT_DOWNLOAD, AI_CLIENT_IDS, CONNECT_WORDS, connectChoices, connectedLine, problemLine, type AiClientDetection } from "../src/ai-clients"

// Every test lives in a folder of its own under the system temp folder, laid out like a Windows user profile (or a Mac's): the real one is never read or written.
const made: string[] = []
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true })
})
function computer(platform: NodeJS.Platform = "win32", extra: Record<string, string> = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "minemods-connect-"))
  made.push(root)
  const home = path.join(root, "user")
  const roaming = path.join(home, "AppData", "Roaming")
  const local = path.join(home, "AppData", "Local")
  mkdirSync(roaming, { recursive: true })
  mkdirSync(local, { recursive: true })
  const probe: Probe = {
    platform,
    env: platform === "win32" ? { APPDATA: roaming, LOCALAPPDATA: local, PATH: path.join(root, "nowhere"), ...extra } : { PATH: path.join(root, "nowhere"), ...extra },
    home,
    exists: (target) => existsSync(target),
    list: (target) => (existsSync(target) ? readdirSync(target) : []),
  }
  return { root, home, roaming, local, probe }
}
const folder = (...parts: string[]) => {
  mkdirSync(path.join(...parts), { recursive: true })
  return path.join(...parts)
}
const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

// The entry as Studio makes it on Windows: a path with backslashes and spaces, and the environment that makes the program run as plain Node.
const configuration = JSON.stringify(
  { mcpServers: { "minemods-studio": { command: "C:\\Program Files\\MineMods Studio\\MineMods Studio.exe", args: ["C:\\Program Files\\MineMods Studio\\resources\\app.asar\\dist\\main\\mcp-stdio.js", "--mcp-stdio", "--connection", "C:\\Users\\阿铜\\AppData\\Roaming\\MineMods Studio\\runtime\\mcp-connection.json"], env: { ELECTRON_RUN_AS_NODE: "1" } } } },
  null,
  2,
)
const server: ServerEntry = configurationParts(configuration)
const moved = configurationParts(configuration.replace("C:\\\\Program Files", "D:\\\\Games"))

const CLAUDE = "claude_desktop_config.json"
const claudeFile = (c: ReturnType<typeof computer>) => path.join(c.roaming, "Claude", CLAUDE)
const msixFile = (c: ReturnType<typeof computer>, name = "Claude_pzs8sxrjxfjjc") => path.join(c.local, "Packages", name, "LocalCache", "Roaming", "Claude", CLAUDE)
const codexFile = (c: ReturnType<typeof computer>) => path.join(c.home, ".codex", "config.toml")
const siblings = (file: string) => readdirSync(path.dirname(file)).filter((name) => name !== path.basename(file))

// ------------------------------------------------------------------------------------------------------------------------------ finding them

test("什么都没装：两个都找不到，不碰任何文件", async () => {
  const c = computer()
  expect(whereClaudeDesktop(c.probe)).toEqual({ installed: false, files: [] })
  expect(whereCodex(c.probe)).toEqual({ installed: false, files: [] })
  expect(await detectClients(c.probe, server)).toEqual({ clients: [{ id: "claude-desktop", installed: false, state: "absent" }, { id: "codex", installed: false, state: "absent" }] })
  expect(existsSync(path.join(c.roaming, "Claude"))).toBe(false)
})

test("Windows 上的 Claude 桌面版：官网安装包和商店版放设置的地方不同，两种都认，各写各的位置", () => {
  const classic = computer()
  folder(classic.local, "AnthropicClaude")
  expect(whereClaudeDesktop(classic.probe)).toEqual({ installed: true, files: [claudeFile(classic)] })

  // The store package keeps what the app writes to Roaming inside its own folder, and reads only that: the file in Roaming would never be read.
  const store = computer()
  folder(store.local, "Packages", "Claude_pzs8sxrjxfjjc")
  folder(store.local, "Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe")
  const found = whereClaudeDesktop(store.probe)
  expect(found).toEqual({ installed: true, files: [msixFile(store)] })
  expect(found.files).not.toContain(claudeFile(store))

  // Both on one computer (an old install left behind): both are written, so whichever one is run finds it.
  const both = computer()
  folder(both.local, "AnthropicClaude")
  folder(both.local, "Packages", "Claude_pzs8sxrjxfjjc")
  expect(whereClaudeDesktop(both.probe).files).toEqual([claudeFile(both), msixFile(both)])
})

test("只留着它自己的设置文件夹也算在这台电脑上用过（装在不常见的位置时靠这个找到）", () => {
  const c = computer()
  folder(c.roaming, "Claude")
  expect(whereClaudeDesktop(c.probe).installed).toBe(true)
  const d = computer()
  folder(d.home, ".codex")
  expect(whereCodex(d.probe)).toEqual({ installed: true, files: [codexFile(d)] })
})

test("Mac：应用在「应用程序」里，设置在 Library/Application Support；没有 Claude 桌面版的系统不会被当成装了", () => {
  const mac = computer("darwin")
  expect(whereClaudeDesktop(mac.probe).installed).toBe(false)
  folder(mac.home, "Applications", "Claude.app")
  expect(whereClaudeDesktop(mac.probe)).toEqual({ installed: true, files: [path.join(mac.home, "Library", "Application Support", "Claude", CLAUDE)] })
  folder(mac.home, "Applications", "Codex.app")
  expect(whereCodex(mac.probe)).toEqual({ installed: true, files: [codexFile(mac)] })

  const other = computer("linux")
  folder(other.home, "Applications", "Claude.app")
  expect(whereClaudeDesktop(other.probe)).toEqual({ installed: false, files: [] })
})

test("Codex：命令行（在 PATH 里或常见安装位置）、商店版桌面应用、CODEX_HOME 指到别处，都能认出来", () => {
  const cli = computer("win32")
  const bin = folder(cli.root, "bin")
  write(path.join(bin, "codex.cmd"), "")
  cli.probe.env.PATH = [path.join(cli.root, "x"), bin].join(path.delimiter)
  expect(whereCodex(cli.probe)).toEqual({ installed: true, files: [codexFile(cli)] })

  // A window opened from the desktop has no terminal PATH: the folder the npm installer uses is looked in too.
  const npm = computer("win32")
  write(path.join(npm.roaming, "npm", "codex.cmd"), "")
  expect(whereCodex(npm.probe).installed).toBe(true)

  const store = computer("win32")
  folder(store.local, "Packages", "OpenAI.Codex_2p2nqsd0c76g0")
  expect(whereCodex(store.probe).installed).toBe(true)

  const elsewhere = computer("win32", { CODEX_HOME: "" })
  const home = folder(elsewhere.root, "codex-home")
  elsewhere.probe.env.CODEX_HOME = home
  expect(whereCodex(elsewhere.probe)).toEqual({ installed: true, files: [path.join(home, "config.toml")] })
})

test("看一眼现状：没有 Studio 这一条、一样的、位置变了的、文件读不懂的，各是各的说法", async () => {
  const c = computer()
  folder(c.local, "AnthropicClaude")
  const state = async () => (await detectClients(c.probe, server)).clients.find((client) => client.id === "claude-desktop")!.state
  expect(await state()).toBe("absent")
  write(claudeFile(c), JSON.stringify({ mcpServers: { other: { command: "x" } } }))
  expect(await state()).toBe("absent")
  write(claudeFile(c), JSON.stringify({ mcpServers: { "minemods-studio": server.json } }))
  expect(await state()).toBe("current")
  write(claudeFile(c), JSON.stringify({ mcpServers: { "minemods-studio": moved.json } }))
  expect(await state()).toBe("outdated")
  write(claudeFile(c), "{ not json")
  expect(await state()).toBe("unreadable")
  // Looking changes nothing: no copy, no new file.
  expect(siblings(claudeFile(c))).toEqual([])
  expect(readFileSync(claudeFile(c), "utf8")).toBe("{ not json")
})

// ------------------------------------------------------------------------------------------------------------------------------ the merge, as text

test("Claude 的 JSON：新文件、已有别的条目、已有旧的 Studio 条目", () => {
  const fresh = mergeClaudeJson(null, server.json)
  expect(fresh.ok && fresh.change).toBe("added")
  expect(JSON.parse(fresh.ok ? fresh.text : "")).toEqual({ mcpServers: { "minemods-studio": server.json } })

  const empty = mergeClaudeJson("  \n", server.json)
  expect(empty.ok && empty.change).toBe("added")

  // Other entries and other settings stay exactly as they were, in the same order.
  const others = JSON.stringify({ theme: "dark", mcpServers: { filesystem: { command: "npx", args: ["-y", "fs", "C:\\Users\\a"] }, other: { url: "https://x" } }, last: [1, 2] }, null, 2)
  const added = mergeClaudeJson(others, server.json)
  expect(added.ok && added.change).toBe("added")
  const after = JSON.parse(added.ok ? added.text : "")
  expect(after).toEqual({ ...JSON.parse(others), mcpServers: { ...JSON.parse(others).mcpServers, "minemods-studio": server.json } })
  expect(Object.keys(after)).toEqual(["theme", "mcpServers", "last"])
  expect(Object.keys(after.mcpServers)).toEqual(["filesystem", "other", "minemods-studio"])

  // An old Studio entry (Studio was moved) is replaced in its place; nothing else changes.
  const old = JSON.stringify({ mcpServers: { a: { command: "a" }, "minemods-studio": { command: "C:\\Old\\Studio.exe", args: ["old.js"] }, z: { command: "z" } } })
  const updated = mergeClaudeJson(old, server.json)
  expect(updated.ok && updated.change).toBe("updated")
  const now = JSON.parse(updated.ok ? updated.text : "")
  expect(Object.keys(now.mcpServers)).toEqual(["a", "minemods-studio", "z"])
  expect(now.mcpServers["minemods-studio"]).toEqual(server.json)
  expect(now.mcpServers.a).toEqual({ command: "a" })

  // Already as it would be written: nothing to write.
  const again = mergeClaudeJson(added.ok ? added.text : "", server.json)
  expect(again.ok && again.change).toBe("unchanged")
})

test("Claude 的 JSON：读不懂的、写法不对的不动；缩进和开头的标记照原样", () => {
  expect(mergeClaudeJson("{ \"mcpServers\": ", server.json)).toEqual({ ok: false, problem: "unreadable" })
  expect(mergeClaudeJson("// my notes\n{}", server.json)).toEqual({ ok: false, problem: "unreadable" })
  expect(mergeClaudeJson("[1, 2]", server.json)).toEqual({ ok: false, problem: "unusual" })
  expect(mergeClaudeJson('{"mcpServers": []}', server.json)).toEqual({ ok: false, problem: "unusual" })
  expect(mergeClaudeJson('{"mcpServers": null}', server.json)).toEqual({ ok: false, problem: "unusual" })

  const tabs = mergeClaudeJson('{\n\t"theme": "dark"\n}\n', server.json)
  expect(tabs.ok && tabs.text.startsWith('{\n\t"theme"')).toBe(true)
  const bom = mergeClaudeJson('\uFEFF{"theme":"dark"}', server.json)
  expect(bom.ok && bom.text.startsWith("\uFEFF{")).toBe(true)
})

test("Codex 的 TOML：新文件、已有别的设置和注释、已有旧的 Studio 条目", () => {
  const fresh = mergeCodexToml(null, server)
  expect(fresh.ok && fresh.change).toBe("added")
  expect(parseToml(fresh.ok ? fresh.text : "")).toEqual({ mcp_servers: { "minemods-studio": { command: server.command, args: server.args, env: { ELECTRON_RUN_AS_NODE: "1" } } } })

  const original = [
    "# my Codex settings",
    'model = "gpt-5"',
    "",
    '[projects."C:\\\\Users\\\\a\\\\work"]',
    'trust_level = "trusted"',
    "",
    "# a server I use",
    "[mcp_servers.docs]",
    'command = "npx"',
    'args = ["-y", "docs-mcp"]',
    "",
    "[mcp_servers.docs.env]",
    'TOKEN = "x"',
    "",
  ].join("\n")
  const added = mergeCodexToml(original, server)
  expect(added.ok && added.change).toBe("added")
  const text = added.ok ? added.text : ""
  // Everything that was there is there, written as it was, comments included; Studio's table follows.
  expect(text.startsWith(original.trimEnd())).toBe(true)
  expect(parseToml(text)).toEqual({ ...parseToml(original), mcp_servers: { ...(parseToml(original).mcp_servers as object), "minemods-studio": { command: server.command, args: server.args, env: { ELECTRON_RUN_AS_NODE: "1" } } } })

  // An old Studio entry, with its env table, between two others: replaced where it stands; the lines around it are kept.
  const withOld = [
    'model = "gpt-5"',
    "",
    "[mcp_servers.a]",
    'command = "a"',
    "",
    "[mcp_servers.minemods-studio]",
    'command = "C:\\\\Old\\\\Studio.exe"',
    'args = ["old.js"]',
    "",
    "[mcp_servers.minemods-studio.env]",
    'ELECTRON_RUN_AS_NODE = "1"',
    'STALE = "yes"',
    "",
    "# the last one",
    "[mcp_servers.z]",
    'command = "z"',
    "",
  ].join("\n")
  const updated = mergeCodexToml(withOld, server)
  expect(updated.ok && updated.change).toBe("updated")
  const out = updated.ok ? updated.text : ""
  expect(out.split("[mcp_servers.minemods-studio]").length).toBe(2)
  expect(out).not.toContain("STALE")
  expect(out).not.toContain("old.js")
  expect(out).toContain("# the last one\n[mcp_servers.z]")
  expect(out.indexOf("[mcp_servers.a]")).toBeLessThan(out.indexOf("[mcp_servers.minemods-studio]"))
  expect(out.indexOf("[mcp_servers.minemods-studio]")).toBeLessThan(out.indexOf("[mcp_servers.z]"))
  const parsed = parseToml(out) as { model: string; mcp_servers: Record<string, unknown> }
  expect(parsed.model).toBe("gpt-5")
  expect(Object.keys(parsed.mcp_servers).sort()).toEqual(["a", "minemods-studio", "z"])
  expect(parsed.mcp_servers["minemods-studio"]).toEqual({ command: server.command, args: server.args, env: { ELECTRON_RUN_AS_NODE: "1" } })

  const again = mergeCodexToml(out, server)
  expect(again.ok && again.change).toBe("unchanged")
})

test("Codex 的 TOML：读不懂的、写法特别的不动；Windows 换行照原样；字符串里长得像表头的行不会被当成表头", () => {
  expect(mergeCodexToml('model = "unterminated', server)).toEqual({ ok: false, problem: "unreadable" })
  expect(mergeCodexToml("[a\nb = 1", server)).toEqual({ ok: false, problem: "unreadable" })
  // Studio's entry written as an inline table or as dotted keys cannot be replaced line by line: left alone, not guessed at.
  expect(mergeCodexToml('mcp_servers = { minemods-studio = { command = "x" } }', server)).toEqual({ ok: false, problem: "unusual" })
  expect(mergeCodexToml('mcp_servers = "text"', server)).toEqual({ ok: false, problem: "unusual" })
  expect(mergeCodexToml('[mcp_servers]\nminemods-studio = { command = "x" }\n', server)).toEqual({ ok: false, problem: "unusual" })

  const crlf = mergeCodexToml('model = "a"\r\n\r\n[mcp_servers.x]\r\ncommand = "x"\r\n', server)
  expect(crlf.ok && crlf.text.includes("\r\n") && !/[^\r]\n/.test(crlf.text)).toBe(true)

  const note = ['notes = """', "[mcp_servers.minemods-studio]", 'command = "inside a string"', '"""', ""].join("\n")
  const kept = mergeCodexToml(note, server)
  expect(kept.ok && kept.change).toBe("added")
  expect((parseToml(kept.ok ? kept.text : "") as { notes: string }).notes).toContain("inside a string")

  const bom = mergeCodexToml('\uFEFFmodel = "a"\n', server)
  expect(bom.ok && bom.text.startsWith("\uFEFFmodel")).toBe(true)
})

// ------------------------------------------------------------------------------------------------------------------------------ the write

test("按下按钮：新装的 Claude 桌面版还没有设置文件，建一个；没有旧文件所以没有备份", async () => {
  const c = computer()
  folder(c.local, "AnthropicClaude")
  const result = await connectClient("claude-desktop", c.probe, server)
  expect(result).toEqual({ ok: true, client: "claude-desktop", files: [{ path: claudeFile(c), backup: null, change: "added" }] })
  expect(JSON.parse(readFileSync(claudeFile(c), "utf8"))).toEqual({ mcpServers: { "minemods-studio": server.json } })
  expect(siblings(claudeFile(c))).toEqual([])
})

test("按下按钮：写之前在同一个文件夹里留一份带时间的备份，内容和原文件一模一样；别的条目一个字不动", async () => {
  const c = computer()
  folder(c.local, "AnthropicClaude")
  const original = JSON.stringify({ globalShortcut: "Ctrl+Space", mcpServers: { filesystem: { command: "npx", args: ["-y", "fs"] }, "minemods-studio": { command: "C:\\Old\\Studio.exe" } } }, null, 4)
  write(claudeFile(c), original)
  const at = new Date(2026, 9, 19, 15, 30, 12)
  const result = await connectClient("claude-desktop", c.probe, server, at)
  const backup = `${claudeFile(c)}.minemods-20261019-153012.bak`
  expect(result).toEqual({ ok: true, client: "claude-desktop", files: [{ path: claudeFile(c), backup, change: "updated" }] })
  expect(backupName(claudeFile(c), at)).toBe(backup)
  expect(readFileSync(backup, "utf8")).toBe(original)
  const now = JSON.parse(readFileSync(claudeFile(c), "utf8"))
  expect(now.globalShortcut).toBe("Ctrl+Space")
  expect(now.mcpServers.filesystem).toEqual({ command: "npx", args: ["-y", "fs"] })
  expect(now.mcpServers["minemods-studio"]).toEqual(server.json)
  // No half-written leftovers.
  expect(siblings(claudeFile(c))).toEqual([path.basename(backup)])

  // Pressed again in the same second after a change: the new copy does not overwrite the first.
  const moved2 = await connectClient("claude-desktop", c.probe, moved, at)
  expect(moved2.ok && moved2.files[0]!.backup).toBe(`${claudeFile(c)}.minemods-20261019-153012-2.bak`)
  expect(readFileSync(backup, "utf8")).toBe(original)
})

test("按两次：第二次发现已经是这样，不改文件也不再留备份", async () => {
  const c = computer()
  const file = write(codexFile(c), 'model = "gpt-5"\n')
  const first = await connectClient("codex", c.probe, server)
  expect(first.ok && first.files[0]!.change).toBe("added")
  const written = readFileSync(file, "utf8")
  const copies = siblings(file).length
  const second = await connectClient("codex", c.probe, server)
  expect(second).toEqual({ ok: true, client: "codex", files: [{ path: file, backup: null, change: "unchanged" }] })
  expect(readFileSync(file, "utf8")).toBe(written)
  expect(siblings(file).length).toBe(copies)
  expect((await detectClients(c.probe, server)).clients.find((client) => client.id === "codex")!.state).toBe("current")
  expect((await detectClients(c.probe, moved)).clients.find((client) => client.id === "codex")!.state).toBe("outdated")
})

test("文件读不懂：不覆盖、不备份、不留临时文件，说明白是哪个文件", async () => {
  const c = computer()
  const broken = write(claudeFile(c), '{ "mcpServers": { "a": ')
  const result = await connectClient("claude-desktop", c.probe, server)
  expect(result).toEqual({ ok: false, client: "claude-desktop", problem: "unreadable", path: broken, backup: null })
  expect(readFileSync(broken, "utf8")).toBe('{ "mcpServers": { "a": ')
  expect(siblings(broken)).toEqual([])
  expect(connectedLine(result)).toContain("没有改动它")

  const toml = write(codexFile(c), 'model = "x')
  const second = await connectClient("codex", c.probe, server)
  expect(second.ok).toBe(false)
  expect(!second.ok && second.problem).toBe("unreadable")
  expect(readFileSync(toml, "utf8")).toBe('model = "x')
  expect(siblings(toml)).toEqual([])
})

test("两个设置文件里有一个读不懂：一个都不写，免得以为接上了其实用的是另一个", async () => {
  const c = computer()
  folder(c.local, "AnthropicClaude")
  folder(c.local, "Packages", "Claude_pzs8sxrjxfjjc")
  write(claudeFile(c), "{ nope")
  const result = await connectClient("claude-desktop", c.probe, server)
  expect(!result.ok && result.problem).toBe("unreadable")
  expect(existsSync(msixFile(c))).toBe(false)
})

test("商店版 Claude：写到它自己读的那个位置，Roaming 里那份不存在也不会被建出来", async () => {
  const c = computer()
  folder(c.local, "Packages", "Claude_pzs8sxrjxfjjc")
  const result = await connectClient("claude-desktop", c.probe, server)
  expect(result.ok && result.files.map((file) => file.path)).toEqual([msixFile(c)])
  expect(existsSync(path.join(c.roaming, "Claude"))).toBe(false)
  expect(JSON.parse(readFileSync(msixFile(c), "utf8")).mcpServers["minemods-studio"]).toEqual(server.json)
})

test("写不进去：如实说是哪个文件、原文件没动、没有留下临时文件", async () => {
  const c = computer()
  folder(c.local, "AnthropicClaude")
  // The place the settings should go is taken by a file where a folder is needed: the folder cannot be made.
  write(path.join(c.roaming, "Claude"), "I am a file")
  const result = await connectClient("claude-desktop", c.probe, server)
  expect(result.ok).toBe(false)
  expect(!result.ok && result.problem).toBe("no-access")
  expect(!result.ok && result.path).toBe(claudeFile(c))
  expect(!result.ok && result.detail).toBeTruthy()
  expect(readFileSync(path.join(c.roaming, "Claude"), "utf8")).toBe("I am a file")
  expect(connectedLine(result)).toContain("原来的文件没有被改动")

  // A settings "file" that is really a folder cannot be read either; it is said, not skipped.
  const d = computer()
  folder(d.local, "AnthropicClaude")
  folder(claudeFile(d))
  const second = await connectClient("claude-desktop", d.probe, server)
  expect(!second.ok && second.problem).toBe("no-access")
})

test("没装就按：说没找到，什么也不写", async () => {
  const c = computer()
  const result = await connectClient("codex", c.probe, server)
  expect(result).toEqual({ ok: false, client: "codex", problem: "not-installed", path: "", backup: null })
  expect(existsSync(path.join(c.home, ".codex"))).toBe(false)
})

test("写出去的 Codex 配置在 Windows 路径和中文用户名下读回来一模一样", async () => {
  const c = computer()
  folder(c.home, ".codex")
  const result = await connectClient("codex", c.probe, server)
  expect(result.ok).toBe(true)
  const read = parseToml(readFileSync(codexFile(c), "utf8")) as { mcp_servers: { "minemods-studio": { command: string; args: string[]; env: Record<string, string> } } }
  const entry = read.mcp_servers["minemods-studio"]
  expect(entry.command).toBe("C:\\Program Files\\MineMods Studio\\MineMods Studio.exe")
  expect(entry.args[3]).toContain("阿铜")
  expect(entry.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" })
})

test("审查员用的是同一个条目：不需要第二份配置，一份文件里只有一条 Studio", async () => {
  const c = computer()
  folder(c.local, "AnthropicClaude")
  await connectClient("claude-desktop", c.probe, server)
  const entries = Object.keys(JSON.parse(readFileSync(claudeFile(c), "utf8")).mcpServers)
  expect(entries).toEqual(["minemods-studio"])
})

// ------------------------------------------------------------------------------------------------------------------------------ the words and the buttons

const detection = (...clients: [boolean, AiClientDetection["clients"][number]["state"]][]): AiClientDetection => ({
  clients: clients.map(([installed, state], index) => ({ id: AI_CLIENT_IDS[index]!, installed, state })),
})

test("按钮：两个都没装时给下载入口和一句话，不出现「接到」", () => {
  const none = connectChoices(detection([false, "absent"], [false, "absent"]))
  expect(none.kind).toBe("install")
  expect(none.buttons).toEqual([])
  expect(none.downloads).toEqual([{ client: "claude-desktop", label: "下载 Claude 桌面版" }, { client: "codex", label: "下载 Codex" }])
  expect(CONNECT_WORDS.install).toContain("装好以后回到这里")
  expect(CONNECT_WORDS.install).toContain("接上")
  // Free accounts work; a whole mod may not fit in one day's allowance, and it is not promised that it does.
  expect(CONNECT_WORDS.quota).toContain("免费账号也能用")
  expect(CONNECT_WORDS.quota).toContain("可能会用完当天的额度")
  expect(AI_CLIENT_DOWNLOAD["claude-desktop"]).toBe("https://claude.com/download")
  expect(AI_CLIENT_DOWNLOAD.codex.startsWith("https://")).toBe(true)
  expect(connectChoices(null).kind).toBe("looking")
})

test("按钮：装了哪个就只出哪个的「接到」，Claude 桌面版排前面作主按钮", () => {
  const claude = connectChoices(detection([true, "absent"], [false, "absent"]))
  expect(claude.buttons.map((button) => button.label)).toEqual(["接到 Claude 桌面版"])
  expect(claude.downloads).toEqual([])
  const codex = connectChoices(detection([false, "absent"], [true, "absent"]))
  expect(codex.buttons.map((button) => [button.label, button.primary])).toEqual([["接到 Codex", true]])
  const both = connectChoices(detection([true, "absent"], [true, "absent"]))
  expect(both.buttons.map((button) => [button.label, button.primary])).toEqual([["接到 Claude 桌面版", true], ["接到 Codex", false]])
})

test("按钮：已经接过的、位置变了的、设置文件读不懂的，旁边各有一句白话；读不懂的按不了", () => {
  const [current] = connectChoices(detection([true, "current"], [false, "absent"])).buttons
  expect(current!.disabled).toBe(false)
  expect(current!.hint).toContain("已经接过")
  const [outdated] = connectChoices(detection([true, "outdated"], [false, "absent"])).buttons
  expect(outdated!.disabled).toBe(false)
  expect(outdated!.hint).toContain("位置变了")
  const [broken] = connectChoices(detection([true, "unreadable"], [false, "absent"])).buttons
  expect(broken!.disabled).toBe(true)
  expect(broken!.hint).toContain("读不懂")
  expect(connectChoices(detection([true, "absent"], [false, "absent"])).buttons[0]!.hint).toBeNull()
})

test("写完以后的话：要重启那个应用才生效，然后新开对话粘贴起步说明；没有改动、出了问题各有各的话", () => {
  const written = (client: "claude-desktop" | "codex", change: "added" | "updated" | "unchanged") => connectedLine({ ok: true, client, files: [{ path: "x", backup: null, change }] })
  const claude = written("claude-desktop", "added")
  expect(claude).toContain("已接到 Claude 桌面版")
  expect(claude).toContain("完全退出 Claude 桌面版再重新打开")
  expect(claude).toContain("新开一个对话")
  expect(claude).toContain("起步说明")
  const codex = written("codex", "updated")
  expect(codex).toContain("已接到 Codex")
  expect(codex).toContain("重新打开 Codex")
  expect(written("codex", "unchanged")).toContain("本来就是这样，没有改动")
  expect(connectedLine({ ok: true, client: "codex", files: [{ path: "a", backup: null, change: "unchanged" }, { path: "b", backup: "b.bak", change: "added" }] })).toContain("已接到 Codex")
})

test("界面上的话：白话，不出现配置格式和内部名字；每种问题都说「没有改动」或备份在哪", () => {
  const problems = ["unreadable", "unusual", "no-access", "mismatch", "not-installed"] as const
  const all = [
    ...Object.values(CONNECT_WORDS),
    ...problems.flatMap((problem) => AI_CLIENT_IDS.map((client) => problemLine(client, problem))),
    ...AI_CLIENT_IDS.flatMap((client) => [connectedLine({ ok: true, client, files: [{ path: "x", backup: null, change: "added" }] }), connectedLine({ ok: true, client, files: [{ path: "x", backup: null, change: "unchanged" }] })]),
    ...connectChoices(detection([true, "outdated"], [true, "unreadable"])).buttons.flatMap((button) => [button.label, button.hint ?? ""]),
  ]
  for (const text of all) for (const jargon of ["MCP", "JSON", "TOML", "stdio", "mcpServers", "mcp_servers", "config", "minemods-studio"]) expect(text).not.toContain(jargon)
  expect(problemLine("codex", "unreadable")).toContain("没有改动它")
  expect(problemLine("codex", "unusual")).toContain("没有改动它")
  expect(problemLine("codex", "no-access")).toContain("没有被改动")
  expect(problemLine("codex", "mismatch")).toContain("备份")
})

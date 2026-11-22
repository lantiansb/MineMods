import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BUILTIN_MANIFESTS, TOOL_TEMPLATES } from "../src/tools/builtin"
import { TOOLS_FOLDER, TOOL_FILE, ToolManifestSchema, fillTemplate, toolInputIssues, toolSecrets, type ToolManifest } from "../src/tools/manifest"
import { approveTool, ensureToolTemplates, loadTools, setToolEnabled, toolsForAi, watchTools } from "../src/tools/registry"

/**
 * 工具资产: the tools Studio runs for an outside AI. Its own are always there; a folder under the runtime's tools/ is one more, usable only once the person turned on
 * exactly the file they saw, and is there or gone the moment the folder changes.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const runtime = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tools-"))
  roots.push(root)
  return root
}

const converter: ToolManifest = {
  schema_version: 1,
  id: "to-ogg",
  version: "1",
  title: "转成 OGG",
  description: "把任何音频转成单声道 OGG。",
  role: "convert",
  medium: "sound",
  input: { type: "object", properties: { quality: { type: "integer", description: "质量", minimum: 0, maximum: 10 } }, required: [] },
  runner: { type: "command", program: "bin/convert.exe", args: ["-i", "{in}", "-q", "{input.quality}", "{out}/result.ogg"], result: "result.ogg" },
  limits: { seconds: 60, bytes: 2_000_000 },
}
const keyed: ToolManifest = { ...TOOL_TEMPLATES["sound-api"]!, id: "keyed-api", version: "1" }
const environment = (keys: string[] = []) => ({ hasSecret: (name: string) => keys.includes(name), storeProgram: () => null })
const put = async (root: string, folder: string, value: unknown) => {
  await mkdir(path.join(root, TOOLS_FOLDER, folder), { recursive: true })
  await writeFile(path.join(root, TOOLS_FOLDER, folder, TOOL_FILE), typeof value === "string" ? value : JSON.stringify(value))
}
const find = async (root: string, id: string, keys: string[] = []) => (await loadTools(root, environment(keys))).find((entry) => entry.id === id)!

test("a tool's description is checked: where its program may be, which addresses it may reach, that every parameter it uses is one it takes", () => {
  expect(ToolManifestSchema.parse(converter)).toEqual(converter)
  for (const manifest of Object.values(BUILTIN_MANIFESTS)) expect(ToolManifestSchema.safeParse(manifest).success).toBe(true)
  for (const manifest of Object.values(TOOL_TEMPLATES)) expect(ToolManifestSchema.safeParse(manifest).success).toBe(true)
  const said = (value: unknown) => ToolManifestSchema.safeParse(value).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(said({ ...converter, runner: { ...converter.runner, program: "C:/Windows/System32/cmd.exe" } })).toContain("不能写别处的绝对路径")
  expect(said({ ...converter, runner: { ...converter.runner, program: "../../evil.exe" } })).toContain("不能写别处的绝对路径")
  expect(said({ ...keyed, runner: { ...keyed.runner, url: "http://example.com/x" } })).toContain("只能是 https")
  expect(said({ ...converter, runner: { ...converter.runner, args: ["{input.speed}"] } })).toContain("{input.speed}，可是 input 里没有这个参数")
  expect(said({ ...converter, input: { ...converter.input, required: ["speed"] } })).toContain("必填参数「speed」没有在 properties 里写")
  expect(toolSecrets(keyed)).toEqual(["SOUND_API_KEY"])
})

test("a template is filled in: a parameter alone keeps its own value, in text it is text; a key and a path are filled; nothing missing is left as it was", () => {
  const given = { input: { prompt: "低吼", seconds: 2.5 }, secrets: { SOUND_API_KEY: "k-123" }, paths: { in: "a.wav", out: "/tmp/o", tool: "/t" } }
  expect(fillTemplate({ text: "{input.prompt}", duration_seconds: "{input.seconds}", note: "要 {input.seconds} 秒" }, given)).toEqual({ text: "低吼", duration_seconds: 2.5, note: "要 2.5 秒" })
  expect(fillTemplate("Bearer {secret:SOUND_API_KEY}", given)).toBe("Bearer k-123")
  expect(fillTemplate(["-i", "{in}", "{out}/result.ogg"], given)).toEqual(["-i", "a.wav", "/tmp/o/result.ogg"])
  expect(() => fillTemplate("{input.speed}", given)).toThrow("TOOL_INPUT_MISSING:speed")
  expect(() => fillTemplate("{secret:OTHER}", given)).toThrow("TOOL_SECRET_MISSING:OTHER")
  expect(toolInputIssues(converter, { quality: 4 })).toEqual([])
  expect(toolInputIssues(converter, { quality: 11, speed: 1 }).join(" ")).toContain("「quality」要在 0 到 10 之间")
  expect(toolInputIssues(converter, { quality: 11, speed: 1 }).join(" ")).toContain("这个工具没有参数「speed」")
  expect(toolInputIssues(BUILTIN_MANIFESTS["sound-synth"], { name: "roar" }).join(" ")).toContain("缺少必填参数「recipe」")
})

test("Studio's own tools are always there; a tool put in a folder waits for the person, runs only as the file they saw, and says what it lacks", async () => {
  const root = await runtime()
  expect((await loadTools(root, environment())).filter((entry) => entry.builtin).map((entry) => [entry.id, entry.state])).toEqual(Object.keys(BUILTIN_MANIFESTS).map((id) => [id, "ready"]))
  await put(root, "to-ogg", converter)
  const fresh = await find(root, "to-ogg")
  expect([fresh.state, fresh.problem]).toEqual(["unapproved", "新放进来的工具，等你在 Studio 里看过再启用"])
  await approveTool(root, "to-ogg", fresh.sha256!)
  expect((await find(root, "to-ogg")).problem).toBe("找不到它要运行的程序：bin/convert.exe")
  await mkdir(path.join(root, TOOLS_FOLDER, "to-ogg", "bin"), { recursive: true })
  await writeFile(path.join(root, TOOLS_FOLDER, "to-ogg", "bin", "convert.exe"), "")
  expect((await find(root, "to-ogg")).state).toBe("ready")
  // Changed after it was turned on: asked again.
  await put(root, "to-ogg", { ...converter, runner: { ...converter.runner, args: ["{in}", "{out}/result.ogg"] } })
  expect((await find(root, "to-ogg")).problem).toBe("工具说明改过了，等你在 Studio 里再看一遍再启用")
  // Turned off: not offered, even approved.
  await approveTool(root, "to-ogg", (await find(root, "to-ogg")).sha256!)
  await setToolEnabled(root, "to-ogg", false)
  expect((await find(root, "to-ogg")).state).toBe("disabled")
  await setToolEnabled(root, "sound-synth", false)
  expect((await find(root, "sound-synth")).state).toBe("disabled")
  // A key it needs.
  await put(root, "keyed", keyed)
  await approveTool(root, "keyed-api", (await find(root, "keyed-api")).sha256!)
  expect((await find(root, "keyed-api")).problem).toBe("还没有在 Studio 里存它要的密钥：SOUND_API_KEY")
  expect((await find(root, "keyed-api", ["SOUND_API_KEY"])).state).toBe("ready")
})

test("a broken description is said in plain words; two tools of one name are not both taken; a folder without one is no tool", async () => {
  const root = await runtime()
  await put(root, "broken", "{ not json")
  await put(root, "twin", { ...converter, id: "sound-synth" })
  await put(root, "wrong", { ...converter, role: "paint" })
  await mkdir(path.join(root, TOOLS_FOLDER, "just-files"), { recursive: true })
  const entries = await loadTools(root, environment())
  expect(entries.find((entry) => entry.id === "broken")?.problem).toContain("tool.json 不是合法的 JSON")
  expect(entries.find((entry) => entry.id === "twin")?.problem).toContain("和另一个工具同名（sound-synth）")
  expect(entries.find((entry) => entry.id === "wrong")?.state).toBe("invalid")
  expect(entries.some((entry) => entry.id === "just-files")).toBe(false)
})

test("the templates are written once, turned off; one the person deleted is not written again", async () => {
  const root = await runtime()
  expect(await ensureToolTemplates(root)).toEqual(Object.keys(TOOL_TEMPLATES))
  expect((await find(root, "sound-api")).state).toBe("unapproved")
  await rm(path.join(root, TOOLS_FOLDER, "sound-api"), { recursive: true })
  expect(await ensureToolTemplates(root)).toEqual([])
  expect((await loadTools(root, environment())).some((entry) => entry.id === "sound-api")).toBe(false)
})

test("a tool put in or taken out is noticed at once, without restarting anything", async () => {
  const root = await runtime()
  let changes = 0
  const stop = await watchTools(root, () => changes++, 50)
  const settled = async (expected: number) => {
    for (let wait = 0; wait < 60 && changes < expected; wait++) await new Promise((resolve) => setTimeout(resolve, 50))
    return changes
  }
  await put(root, "to-ogg", converter)
  expect(await settled(1)).toBeGreaterThanOrEqual(1)
  const before = changes
  await rm(path.join(root, TOOLS_FOLDER, "to-ogg"), { recursive: true })
  expect(await settled(before + 1)).toBeGreaterThan(before)
  stop()
})

test("an outside AI is told only the tools it may use now, with their parameters, and nothing of where they are or what they need", async () => {
  const root = await runtime()
  await put(root, "keyed", keyed)
  const told = toolsForAi(await loadTools(root, environment()))
  expect(told.map((tool) => tool.id)).toEqual(Object.keys(BUILTIN_MANIFESTS))
  expect(toolsForAi(await loadTools(root, environment()), { medium: "sound", role: "generate" }).map((tool) => tool.id)).toEqual(["sound-synth", "delegate-sound"])
  const text = JSON.stringify(told)
  expect(text).not.toMatch(/runner|program|https?:|secret|tools[\\/]/)
})

import { afterEach, expect, test } from "bun:test"
import { untilObserved } from "./observed"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { TOOLS_FOLDER, TOOL_FILE } from "@minemods/mod-core/tools/manifest"
import { TOOL_TEMPLATES } from "@minemods/mod-core/tools/builtin"
import { approveTool } from "@minemods/mod-core/tools/registry"
import { createToolService } from "../src/main/tool-service"

/**
 * 工具资产: the runs an outside AI asks Studio for. Refused in plain words when the tool is not ready or the parameters are wrong; a tool that hands the work to the
 * connected AI waits for it to hand the file back; what a run made goes to whoever started it; the tools there are follow the folder as it changes.
 */

const roots: string[] = []
const services: { close: () => void }[] = []
afterEach(async () => {
  services.splice(0).forEach((service) => service.close())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function service(options: Partial<Parameters<typeof createToolService>[0]> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tool-service-"))
  roots.push(root)
  const made = createToolService({ runtimeDirectory: root, ...options })
  services.push(made)
  await made.ready()
  return { root, tools: made }
}
const project = randomUUID()
const settle = async (read: () => { state: string }, until = (state: string) => state === "completed" || state === "failed") => {
  for (let wait = 0; wait < 100 && !until(read().state); wait++) await new Promise((resolve) => setTimeout(resolve, 20))
  return read()
}

test("a tool that is not there, not ready, or given the wrong parameters is refused in plain words", async () => {
  const { root, tools } = await service()
  await expect(tools.start({ projectId: project, tool: "nope", input: {} })).rejects.toMatchObject({ plain: "没有叫「nope」的工具。用 list_tools 看现在能用哪些。" })
  await mkdir(path.join(root, TOOLS_FOLDER, "sound-api"), { recursive: true })
  await writeFile(path.join(root, TOOLS_FOLDER, "sound-api", TOOL_FILE), JSON.stringify(TOOL_TEMPLATES["sound-api"]))
  await untilObserved(() => tools.entries(), (entries) => entries.some((tool) => tool.id === "sound-api" && tool.state === "unapproved"))
  await expect(tools.start({ projectId: project, tool: "sound-api", input: { prompt: "x", seconds: 1, name: "x" } })).rejects.toMatchObject({ plain: expect.stringContaining("现在用不了：新放进来的工具，等你在 Studio 里看过再启用") })
  await expect(tools.start({ projectId: project, tool: "delegate-sound", input: { name: "roar" } })).rejects.toMatchObject({ plain: "参数不对：缺少必填参数「prompt」" })
}, 120_000)

test("a tool that hands the work to the connected AI waits for the file, then gives it to whoever started it", async () => {
  const kept: { tool: string; mime: string; name: unknown }[] = []
  const { tools } = await service({ onProduct: async (run, product, input) => (kept.push({ tool: run.tool, mime: product.mime, name: input.name }), { asset: "a-1" }) })
  const started = await tools.start({ projectId: project, tool: "delegate-sound", input: { prompt: "一声低沉的牛吼，两秒", name: "roar" } })
  expect(started.state).toBe("waiting")
  expect(started.ask).toContain("一声低沉的牛吼，两秒")
  expect(started.ask).toContain("不要用脚本、占位图或别的文件冒充")
  const done = await tools.finish({ projectId: project, run: started.id, file: `data:audio/wav;base64,${Buffer.from("RIFF....WAVE").toString("base64")}` })
  expect(done).toMatchObject({ state: "completed", product: { mime: "audio/wav", bytes: 12, saved: { asset: "a-1" } } })
  expect(kept).toEqual([{ tool: "delegate-sound", mime: "audio/wav", name: "roar" }])
  expect(Buffer.from(tools.file(started.id)!.bytes).toString()).toBe("RIFF....WAVE")
  // Handed back twice, or for a run that does not wait: refused.
  await expect(tools.finish({ projectId: project, run: started.id, file: "data:audio/wav;base64,AA==" })).rejects.toMatchObject({ plain: expect.stringContaining("这次运行不在等你交东西") })
})

test("the connected AI that cannot make it says so; a file of the wrong kind is not taken", async () => {
  const { tools } = await service()
  const first = await tools.start({ projectId: project, tool: "delegate-image", input: { prompt: "六视图" } })
  expect(await tools.finish({ projectId: project, run: first.id, unsupported: "我没有画图工具" })).toMatchObject({ state: "failed", error: "连接的 AI 说它做不了：我没有画图工具" })
  const second = await tools.start({ projectId: project, tool: "delegate-image", input: { prompt: "六视图" } })
  expect(await tools.finish({ projectId: project, run: second.id, file: "data:audio/ogg;base64,T2dnUw==" })).toMatchObject({ state: "failed", error: "这个工具要的是图片，交回的是 audio/ogg。" })
  // Another project's run is not this one's.
  expect(() => tools.get({ projectId: randomUUID(), run: second.id })).toThrow()
})

test("Studio's own tool not yet joined says so; one that is runs and hands its file on", async () => {
  const { tools } = await service({ builtins: { "sound-synth": async (input) => ({ bytes: new TextEncoder().encode(`OggS${String(input.name)}`), mime: "audio/ogg" }) } })
  const synth = await tools.start({ projectId: project, tool: "sound-synth", input: { recipe: "{}", name: "drum" } })
  expect(await settle(() => tools.get({ projectId: project, run: synth.id }))).toMatchObject({ state: "completed", product: { mime: "audio/ogg", bytes: 8 } })
  const frames = await tools.start({ projectId: project, tool: "video-frames", input: { recording: "r1", frames: 4, look_for: "预警" } })
  expect(await settle(() => tools.get({ projectId: project, run: frames.id }))).toMatchObject({ state: "failed", error: "Studio 自带的工具「录像抽帧检查」这一版还没有接上。" })
})

test("a tool put in, turned on and taken out shows in the list at once, without restarting", async () => {
  let changes = 0
  const { root, tools } = await service({ secrets: async () => ({ SOUND_API_KEY: "k" }), onChange: () => changes++ })
  const ids = async () => (await tools.list()).map((tool) => tool.id)
  expect(await ids()).not.toContain("sound-api")
  await mkdir(path.join(root, TOOLS_FOLDER, "sound-api"), { recursive: true })
  await writeFile(path.join(root, TOOLS_FOLDER, "sound-api", TOOL_FILE), JSON.stringify(TOOL_TEMPLATES["sound-api"]))
  for (let wait = 0; wait < 40 && changes === 0; wait++) await new Promise((resolve) => setTimeout(resolve, 50))
  expect(changes).toBeGreaterThan(0)
  const entry = (await tools.entries()).find((value) => value.id === "sound-api")!
  expect(entry.state).toBe("unapproved")
  await approveTool(root, "sound-api", entry.sha256!)
  // The person's choice is a change of the store, not of the folder: the window asks for the list again after it.
  const seen = changes
  await writeFile(path.join(root, TOOLS_FOLDER, "sound-api", "notes.txt"), "touched")
  for (let wait = 0; wait < 40 && changes === seen; wait++) await new Promise((resolve) => setTimeout(resolve, 50))
  expect(await ids()).toContain("sound-api")
  await rm(path.join(root, TOOLS_FOLDER, "sound-api"), { recursive: true })
  for (let wait = 0; wait < 40 && (await ids()).includes("sound-api"); wait++) await new Promise((resolve) => setTimeout(resolve, 50))
  expect(await ids()).not.toContain("sound-api")
})

test("a picture made for a model's six-view carries where it goes; a tool that makes no picture cannot be sent there", async () => {
  const targets: unknown[] = []
  const { tools } = await service({ onProduct: async (run, product) => (targets.push({ target: run.target, mime: product.mime }), { six_view: run.target?.itemId }) })
  const run = await tools.start({ projectId: project, tool: "delegate-image", input: { prompt: "六视图" }, target: { kind: "six_view", itemId: "chiyou_model" } })
  expect(run.target).toEqual({ kind: "six_view", itemId: "chiyou_model" })
  expect(await tools.finish({ projectId: project, run: run.id, file: "data:image/png;base64,iVBORw0KGgo=" })).toMatchObject({ state: "completed", product: { saved: { six_view: "chiyou_model" } } })
  expect(targets).toEqual([{ target: { kind: "six_view", itemId: "chiyou_model" }, mime: "image/png" }])
  await expect(tools.start({ projectId: project, tool: "delegate-sound", input: { prompt: "吼", name: "roar" }, target: { kind: "six_view", itemId: "x" } })).rejects.toMatchObject({ plain: "六视图要用画图的工具，「由连接的 AI 生成声音」做的是声音。" })
})

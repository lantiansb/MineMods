import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { exportProjectArchive } from "@minemods/mod-core/container"
import { tmpdir } from "node:os"
import path from "node:path"
import { createProject, openProject, saveProject } from "@minemods/mod-core/project"
import { applyWorkspaceAsset } from "@minemods/mod-core/workspace"
import { addNote, NO_NOTES, noteBrief, notePlace, noteStanding, ONLY_MARKED, reopenNote, reviewNotes, sendNotes, settleNotes, toSend, type MakingNoteInput } from "../src/making-notes"
import { changedParts, missingBones, thinSteps, TRACE_LIMITS } from "../src/making-trace"
import { assetVersions, createMakingHistory } from "../src/main/making-history"
import { modelAnnotationContext } from "../src/main/model-annotation"
import { ModelAnnotationContextSchema } from "@minemods/studio-ai/model-annotation"
import { copyAt, partProgress, partsAt, partTitle, passageRows, roadOf, thinkingLine } from "../src/renderer/features/making-live-model"
import { presenceLine } from "../src/renderer/features/project-activity-model"
import { canAdd, mcpAddSentence } from "../src/renderer/features/project-navigation-model"

const made: string[] = []
afterAll(() => Promise.all(made.map((directory) => rm(directory, { recursive: true, force: true }))))
const cube = (size = 2, extra: Record<string, unknown> = {}) => ({ origin: [0, 0, 0], size: [size, size, size], ...extra })
const bone = (name: string, size = 2, extra: Record<string, unknown> = {}) => ({ name, parent: null, pivot: [0, 0, 0], cubes: [cube(size, extra)] })

async function aProject(document: { kind: string; [key: string]: unknown } = { kind: "item", identifier: "moon_shard", name: "月光碎片", max_stack: 64, color: "#79a9de", texture: null }) {
  const directory = await mkdtemp(path.join(tmpdir(), "making-p1-"))
  made.push(directory)
  const project = await createProject({ directory, name: "周末", description: "", mod_id: "p1_weekend" })
  const at = new Date().toISOString()
  const asset = { id: crypto.randomUUID(), module: document.kind, title: "月光碎片", revision: 1, created_at: at, updated_at: at, prompt: "样例", dependencies: [], document, provenance: { model: "ai-model", request_id: null }, status: "ready" as const }
  const saved = await saveProject(directory, applyWorkspaceAsset(project, asset as never), project.revision)
  return { directory, project: saved, assetId: asset.id, asset }
}
const historyOf = (directory: string, options: { redo?: (input: { feedback: string; annotation?: unknown }) => Promise<unknown>; changed?: () => void; lock?: () => Promise<string> } = {}) =>
  createMakingHistory({ directoryFor: async () => directory, changed: options.changed, lock: options.lock, redo: options.redo ?? (async () => null) })
const projectId = crypto.randomUUID()
const note = (over: Partial<MakingNoteInput> = {}): MakingNoteInput => ({ kind: "circle", start: { x: 0.1, y: 0.1 }, end: { x: 0.3, y: 0.3 }, text: "翅膀再往下垂一点", part: "left_wing", frame: null, camera: { position: [1, 2, 3], target: [0, 0, 0] }, ...over })

test("写入后立刻发刷新事件，步骤带着 AI 自己的话和写到的部件", async () => {
  const { directory, assetId } = await aProject()
  const told: number[] = []
  const history = historyOf(directory, { changed: () => told.push(Date.now()) })
  await history.record({ projectId, assetId, kind: "write", note: "先写头", document: { kind: "model", bones: [bone("head")], animations: [] } })
  expect(told).toHaveLength(1)
  const first = await history.trace({ projectId, assetId })
  expect(first.steps.at(-1)).toMatchObject({ kind: "write", note: "先写头", parts: ["head"], copy: true })
  await history.record({ projectId, assetId, kind: "write", document: { kind: "model", bones: [bone("head"), bone("left_wing")], animations: [] } })
  expect(told).toHaveLength(2)
  const second = await history.trace({ projectId, assetId })
  expect(second.steps.at(-1)!.parts).toEqual(["left_wing"])
  expect(await history.traceDocument({ projectId, assetId, version: second.version, seq: second.steps.at(-1)!.seq })).toMatchObject({ bones: [{ name: "head" }, { name: "left_wing" }] })
})

test("只报进度、写了和上一步一样的东西都不算一次写入；看图和审查有自己的刻度", async () => {
  const { directory, assetId } = await aProject()
  const history = historyOf(directory)
  const document = { kind: "model", bones: [bone("head")], animations: [] }
  await history.record({ projectId, assetId, kind: "write", document })
  await history.record({ projectId, assetId, kind: "write", document })
  await history.record({ projectId, assetId, kind: "write", note: "在想翅膀怎么接" })
  await history.record({ projectId, assetId, kind: "look" })
  await history.record({ projectId, assetId, kind: "review" })
  const trace = await history.trace({ projectId, assetId })
  expect(trace.steps.map((step) => step.kind)).toEqual(["write", "look", "review"])
  expect(trace.written).toBe(1)
  expect(trace.thought?.text).toBe("在想翅膀怎么接")
})

test("快照上限：每版不超过上限，均匀抽稀，首尾都在，多余的副本从磁盘删掉", async () => {
  const thinned = thinSteps(Array.from({ length: 1000 }, (_, index) => index), TRACE_LIMITS.steps)
  expect(thinned).toHaveLength(TRACE_LIMITS.steps)
  expect(thinned[0]).toBe(0)
  expect(thinned.at(-1)).toBe(999)
  const gaps = thinned.slice(1).map((value, index) => value - thinned[index]!)
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1)
  expect(thinSteps([1, 2, 3], 200)).toEqual([1, 2, 3])
  const { directory, assetId } = await aProject()
  const history = historyOf(directory)
  for (let index = 0; index < 212; index++) await history.record({ projectId, assetId, kind: "write", document: { kind: "model", bones: [bone("head", index + 1)], animations: [] } })
  const trace = await history.trace({ projectId, assetId })
  expect(trace.steps).toHaveLength(TRACE_LIMITS.steps)
  expect(trace.total).toBe(212)
  expect(trace.written).toBe(212)
  expect(trace.steps.at(-1)!.seq).toBe(212)
  const files = await readdir(path.join(directory, ".minemods", "making", "trace", assetId))
  expect(files.filter((name) => name.includes("-"))).toHaveLength(TRACE_LIMITS.steps)
}, 180000)

test("过大的文档只留刻度不留副本；步骤记录和批注都不进工程导出", async () => {
  const { directory, assetId } = await aProject()
  const history = historyOf(directory)
  await history.record({ projectId, assetId, kind: "write", document: { kind: "texture", pixels: "x".repeat(TRACE_LIMITS.document + 10) } })
  expect((await history.trace({ projectId, assetId })).steps.at(-1)!.copy).toBe(false)
  await history.addNote({ projectId, assetId, note: note() })
  const destination = path.join(directory, "..", `${path.basename(directory)}.minemods`)
  made.push(destination)
  await exportProjectArchive({ directory, destination })
  // A zip keeps its file names in the clear.
  const names = (await readFile(destination)).toString("latin1")
  expect(names).toContain("minemods.project.json")
  expect(names).not.toMatch(/making\/(trace|versions|notes)/)
})

test("部件差异分得清形状、颜色、动作", () => {
  expect(changedParts(null, { bones: [bone("head")], animations: [] })).toEqual({ parts: ["head"], areas: ["shape"] })
  expect(changedParts({ bones: [bone("head", 2, { color: "#fff" })] }, { bones: [bone("head", 2, { color: "#000" })] }).areas).toEqual(["paint"])
  expect(changedParts({ bones: [bone("head")], animations: [] }, { bones: [bone("head")], animations: [{ name: "idle" }] })).toEqual({ parts: [], areas: ["motion"] })
  expect(missingBones([bone("head"), bone("wing")], [bone("head")]).map((value) => value.name)).toEqual(["wing"])
})

const sheet = [{ name: "head", what: "圆脑袋，带鸡冠" }, { name: "body", what: "身体" }, { name: "left_wing", what: "左翅膀" }, { name: "right_wing", what: "右翅膀" }]
test("部件高亮与清单计数：有清单才写第几块，没有清单不编数字", () => {
  const document = { bones: [bone("head"), bone("body"), bone("left_wing")] }
  expect(partProgress({ parts: sheet, document, current: ["left_wing"] })).toMatchObject({ name: "左翅膀", line: "正在做：左翅膀 · 第 3 块 / 共 4 块", count: { at: 3, of: 4 }, left: ["右翅膀"] })
  // A bone's own name is the AI's: the person is told a part is being built, not its code name.
  expect(partProgress({ parts: null, document, current: ["left_wing"] })).toMatchObject({ name: "left_wing", line: "正在搭新的部件", count: null })
  expect(partProgress({ parts: [], document, current: ["翅膀"] }).line).toBe("正在做：翅膀")
  // A part the list does not name is not counted against the list.
  expect(partProgress({ parts: sheet, document, current: ["tail"] })).toMatchObject({ line: "正在搭新的部件", count: null })
  // A list in the person's words that names none of the model's parts cannot say what is still to come.
  expect(partProgress({ parts: [{ name: "头部", what: "圆脑袋" }, { name: "翅膀", what: "两只翅膀" }] as typeof sheet, document, current: ["head"] }).left).toEqual([])
  expect(partProgress({ parts: sheet, document, current: [] }).line).toBeNull()
  expect(partTitle("head", sheet)).toBe("圆脑袋")
  expect(partTitle("鸡冠", sheet)).toBe("鸡冠")
  const step = (seq: number, parts: string[], copy = true, kind: "write" | "look" = "write") => ({ seq, at: "", kind, parts, areas: [], note: null, copy })
  expect(partsAt([step(1, ["a"]), step(2, [], false, "look")], null)).toEqual(["a"])
  expect(copyAt([step(1, ["a"]), step(2, [], false), step(3, ["b"])], 2)?.seq).toBe(1)
})

test("步骤条取自记录，不新造状态；不做的时候不亮当前", () => {
  const write = (areas: ("shape" | "paint" | "motion")[]) => ({ seq: 1, at: "", kind: "write" as const, parts: [], areas, note: null, copy: true })
  const document = { bones: [bone("head")], animations: [] }
  const making = roadOf({ kind: "model", making: true, version: 2, sixView: true, document, steps: [write(["shape"])], review: null })
  expect(making.map((stop) => [stop.label, stop.state])).toEqual([["六视图", "done"], ["建模 · 第 2 版", "now"], ["上色", "todo"], ["动作", "todo"], ["审查", "todo"]])
  const moving = roadOf({ kind: "model", making: true, version: 1, sixView: false, document: { ...document, animations: [{ name: "idle" }] }, steps: [write(["motion"])], review: null })
  expect(moving.find((stop) => stop.state === "now")?.id).toBe("motion")
  expect(moving.find((stop) => stop.id === "views")?.state).toBe("todo")
  const done = roadOf({ kind: "model", making: false, version: 3, sixView: true, document: { bones: [bone("head", 2, { color: "#fff" })], animations: [{ name: "idle" }] }, steps: [], review: { passed: true } })
  expect(done.every((stop) => stop.state === "done")).toBe(true)
  expect(roadOf({ kind: "texture", making: true, version: 1, sixView: false, document: null, steps: [], review: null }).map((stop) => stop.id)).toEqual(["paint", "review"])
  expect(roadOf({ kind: "block", making: true, version: 1, sixView: false, document: null, steps: [], review: null }).map((stop) => stop.id)).toEqual(["made", "review"])
})

test("「AI 在想」只说 AI 自己写的；没有就说记录的白话；都没有就不说", () => {
  const step = (seq: number, at: string, note: string | null) => ({ seq, at, kind: "write" as const, parts: [], areas: [], note, copy: true })
  const event = { seq: 1, at: "2026-11-02T00:00:09.000Z", kind: "task", mark: "run", item: "x", title: "x", text: "做到一半" } as never
  expect(thinkingLine({ steps: [step(1, "2026-11-02T00:00:01.000Z", "翅膀加大")], thought: null }, [event])).toMatchObject({ own: true, text: "翅膀加大" })
  expect(thinkingLine({ steps: [step(1, "2026-11-02T00:00:01.000Z", "翅膀加大")], thought: { at: "2026-11-02T00:00:05.000Z", text: "在对齐" } }, [event])).toMatchObject({ own: true, text: "在对齐" })
  expect(thinkingLine({ steps: [step(1, "2026-11-02T00:00:01.000Z", null)], thought: null }, [event])).toMatchObject({ own: false, text: "做到一半" })
  expect(thinkingLine(null, [])).toBeNull()
})

test("这一样的经过：最新在上，一行一条，标签分得清", () => {
  const events = [
    { seq: 1, at: "2026-11-02T00:00:01.000Z", kind: "task", mark: "run", text: "接下了「小鸡」。" },
    { seq: 2, at: "2026-11-02T00:00:03.000Z", kind: "look", mark: "note", text: "看了一眼" },
    { seq: 3, at: "2026-11-02T00:00:04.000Z", kind: "review", mark: "note", text: "第 1 版：翅膀太小" },
    { seq: 4, at: "2026-11-02T00:00:05.000Z", kind: "person", mark: "note", text: "你自己改了" },
    { seq: 5, at: "2026-11-02T00:00:06.000Z", kind: "tool", mark: "note", quiet: true, text: "安静的调用" },
  ] as never[]
  const rows = passageRows(events, [{ seq: 1, at: "2026-11-02T00:00:02.000Z", kind: "write", parts: ["head"], areas: ["shape"], note: null, copy: true }], (part) => (part === "head" ? "头" : part))
  expect(rows.map((row) => [row.tag, row.text])).toEqual([["改", "你自己改了"], ["审查", "第 1 版：翅膀太小"], ["看图", "看了一眼"], ["写入", "头"], ["开始", "接下了「小鸡」。"]])
})

test("版本回退不覆盖：另存成新的一版，旧的当前版还在，内容等于所选旧版", async () => {
  const { directory, project, assetId, asset } = await aProject()
  const change = async (name: string, by: string | null) => {
    const latest = await openProject(directory)
    const was = latest.workspace.assets.find((value) => value.id === assetId)!
    return saveProject(directory, applyWorkspaceAsset(latest, { ...was, revision: was.revision + 1, updated_at: new Date().toISOString(), document: { ...asset.document, name } as never, provenance: { model: by, request_id: null } } as never), latest.revision)
  }
  expect(project.revision).toBeGreaterThan(0)
  await change("第二版", "ai-model")
  const third = await change("我手改的", null)
  const history = historyOf(directory)
  const before = await history.read({ projectId, assetId })
  expect(before.versions.map((value) => [value.version, value.by, (value.document as { name: string }).name, value.current])).toEqual([[1, "ai", "月光碎片", false], [2, "ai", "第二版", false], [3, "person", "我手改的", true]])
  const done = await history.restore({ projectId, assetId, version: 1, expectedRevision: third.revision })
  expect(done.version).toBe(4)
  const after = await history.read({ projectId, assetId })
  expect(after.versions).toHaveLength(4)
  expect(after.versions.at(-1)).toMatchObject({ version: 4, by: "restored", from: 1, current: true })
  expect((after.versions[2]!.document as { name: string }).name).toBe("我手改的")
  expect(((await openProject(directory)).workspace.assets.find((value) => value.id === assetId)!.document as { name: string }).name).toBe("月光碎片")
  // The same revision check every save has: an old number is refused, and nothing is written.
  await expect(history.restore({ projectId, assetId, version: 2, expectedRevision: third.revision })).rejects.toThrow()
  expect((await history.read({ projectId, assetId })).versions).toHaveLength(4)
  await expect(history.restore({ projectId, assetId, version: 4, expectedRevision: (await openProject(directory)).revision })).rejects.toThrow("就是现在这一版")
})

test("制作锁定时不能回退，并说明原因；旧工程没有历史时，现在的样子就是第 1 版", async () => {
  const { directory, assetId } = await aProject()
  const history = historyOf(directory, { lock: async () => "AI 正在做这一样，等这一次做完再回到旧版。" })
  await expect(history.restore({ projectId, assetId, version: 1, expectedRevision: (await openProject(directory)).revision })).rejects.toThrow("AI 正在做这一样")
  await rm(path.join(directory, ".minemods", "making", "versions"), { recursive: true, force: true })
  const versions = await assetVersions(directory, await openProject(directory), assetId)
  expect(versions.map((value) => [value.version, value.current])).toEqual([[1, true]])
})

test("批注持久化：编号稳定，删掉的号不再用，重新打开还在", async () => {
  const { directory, assetId } = await aProject()
  const first = historyOf(directory)
  await first.addNote({ projectId, assetId, note: note() })
  const two = await first.addNote({ projectId, assetId, note: note({ kind: "arrow", text: "鸡冠颜色再红一点", part: "comb" }) })
  expect(two.map((value) => value.id)).toEqual([1, 2])
  await first.changeNote({ projectId, assetId, id: 1, change: "remove" })
  const three = await first.addNote({ projectId, assetId, note: note({ kind: "frame", frame: { clip: "walk", time: 0.5 }, text: "这一帧脚穿地了" }) })
  expect(three.map((value) => value.id)).toEqual([2, 3])
  const reopened = await historyOf(directory).read({ projectId, assetId })
  expect(reopened.notes.map((value) => [value.id, value.part, value.frame?.clip ?? null, value.status])).toEqual([[2, "comb", null, "unsent"], [3, "left_wing", "walk", "unsent"]])
})

test("批注状态流转：交了以后 AI 交回新版才算已改，人手改不算；可以改回还没改好，再交一次", () => {
  const at = "2026-11-02T00:00:00.000Z"
  const base = addNote(NO_NOTES, note(), { version: 2, at })
  expect(noteStanding(base.notes[0]!)).toBe("还没交给 AI")
  const sent = sendNotes(base, [1], { version: 2, at })
  expect(sent.notes[0]).toMatchObject({ status: "sent", sent_version: 2 })
  expect(noteStanding(sent.notes[0]!)).toBe("已交给 AI")
  expect(toSend(sent.notes)).toHaveLength(0)
  expect(settleNotes(sent, [{ version: 2, by: "ai" }, { version: 3, by: "person" }, { version: 4, by: "restored" }], at).notes[0]!.status).toBe("sent")
  const fixed = settleNotes(sent, [{ version: 2, by: "ai" }, { version: 3, by: "ai" }], at)
  expect(fixed.notes[0]).toMatchObject({ status: "fixed", fixed_version: 3 })
  expect(noteStanding(fixed.notes[0]!)).toBe("第 3 版已改")
  const again = reopenNote(fixed, 1, at)
  expect(again.notes[0]).toMatchObject({ status: "not_fixed", fixed_version: null })
  expect(noteStanding(again.notes[0]!)).toBe("还没改好")
  expect(toSend(again.notes)).toHaveLength(1)
  expect(reopenNote(sent, 1, at).notes[0]!.status).toBe("sent")
  const reviewed = reviewNotes(NO_NOTES, ["翅膀太小", "翅膀太小", " "], { version: 1, at })
  expect(reviewed.notes.map((value) => [value.source, noteStanding(value)])).toEqual([["review", "审查提的"]])
  expect(reviewNotes(reviewed, ["翅膀太小"], { version: 2, at })).toBe(reviewed)
})

test("把批注交给 AI：走现有返工，带上位置和「只改标到的地方」；被拒绝时批注保持原样", async () => {
  const { directory, assetId } = await aProject()
  const asked: { feedback: string; annotation?: { only_marked?: boolean; annotations: { note: number; part: string; frame?: unknown }[] } }[] = []
  const history = historyOf(directory, { redo: async (input) => void asked.push(input as never) })
  await history.addNote({ projectId, assetId, note: note() })
  await history.addNote({ projectId, assetId, note: note({ kind: "frame", start: { x: 0.5, y: 0.5 }, end: undefined, frame: { clip: "walk", time: 0.5 }, part: "left_foot", text: "这一帧脚穿地了" }) })
  const picture = { image: "data:image/png;base64,xxxx", width: 10, height: 10, projectRevision: 1 }
  const sent = await history.sendNotes({ projectId, assetId, ids: [1, 2], onlyMarked: true, extra: "别动头", titles: { left_wing: "左翅膀" }, picture })
  expect(sent.map((value) => value.status)).toEqual(["sent", "sent"])
  expect(asked[0]!.feedback).toContain("圈在：左翅膀")
  expect(asked[0]!.feedback).toContain("翅膀再往下垂一点")
  expect(asked[0]!.feedback).toContain("别动头")
  expect(asked[0]!.feedback).toContain(ONLY_MARKED)
  expect(asked[0]!.annotation).toMatchObject({ only_marked: true, targetId: assetId, annotations: [{ note: 1, part: "left_wing" }, { note: 2, part: "left_foot", frame: { clip: "walk", time: 0.5 } }] })
  expect(await history.notesForTask(projectId, assetId)).toMatchObject([{ number: 1, says: "翅膀再往下垂一点", part: "left_wing" }, { number: 2, frame: { clip: "walk" } }])
  await expect(history.sendNotes({ projectId, assetId, ids: [1], onlyMarked: true })).rejects.toThrow("没有还没交的批注")
  const refused = historyOf(directory, { redo: async () => { throw new Error("正在做") } })
  await refused.addNote({ projectId, assetId, note: note({ text: "第三条" }) })
  await expect(refused.sendNotes({ projectId, assetId, ids: [3], onlyMarked: false })).rejects.toThrow("正在做")
  expect((await refused.read({ projectId, assetId })).notes.find((value) => value.id === 3)!.status).toBe("unsent")
})

test("交给 AI 的标注带着编号、帧和「只改标到的地方」，存取都不丢", () => {
  const targetId = crypto.randomUUID()
  const context = modelAnnotationContext({
    targetId,
    projectRevision: 3,
    width: 10,
    height: 10,
    image: "",
    selectedPart: null,
    only_marked: true,
    annotations: [{ kind: "text", start: { x: 0.5, y: 0.5 }, text: "这一帧脚穿地了", part: "foot", note: 3, frame: { clip: "walk", time: 0.5 } }],
  })
  expect(context).toMatchObject({ only_marked: true, annotations: [{ note: 3, frame: { clip: "walk", time: 0.5 } }] })
  expect(ModelAnnotationContextSchema.parse(context).only_marked).toBe(true)
})

test("交给 AI 的话不超过一条意见的长度，放不下的在标注里，约束一定在", () => {
  const at = "2026-11-02T00:00:00.000Z"
  const many = Array.from({ length: 30 }).reduce<typeof NO_NOTES>((record) => addNote(record, note({ text: "很长的一句话".repeat(10) }), { version: 1, at }), NO_NOTES)
  const brief = noteBrief(many.notes, { onlyMarked: true })
  expect(brief.length).toBeLessThanOrEqual(500)
  expect(brief).toContain("见图上标注")
  expect(brief.endsWith(ONLY_MARKED)).toBe(true)
})

test("贴图上的批注记的是贴图区域，模型上的记部件和动作帧", () => {
  expect(notePlace(note({ camera: null, part: null, start: { x: 0.1, y: 0.2 }, end: { x: 0.5, y: 0.6 } }))).toBe("圈在：贴图区域 左 10% 上 20% 到 左 50% 上 60%")
  expect(notePlace(note({ kind: "arrow" }), (part) => (part === "left_wing" ? "左翅膀" : part))).toBe("指向：左翅膀")
  expect(notePlace(note({ kind: "frame", frame: { clip: "walk", time: 0.5 }, part: null }), undefined, () => "走路")).toBe("标在：走路 · 第 10 帧")
})

test("动态行和连接状态一致；恢复后回到原样", () => {
  expect(presenceLine("idle")).toMatchObject({ text: "超过 45 秒没动静", state: "warn" })
  expect(presenceLine("disconnected")).toMatchObject({ text: "断开了，已交来的已存好", state: "fail" })
  for (const state of ["working", "connected", "unconnected", undefined]) expect(presenceLine(state)).toBeNull()
})

test("MCP 模式：不能填表的类别给一句可复制的话，能填表的照旧", () => {
  expect(canAdd("block", true)).toBe(true)
  expect(canAdd("entity", true)).toBe(false)
  expect(mcpAddSentence("周末彩虹乐园", "生物", "  一只会发光的小鸡 ")).toBe("在『周末彩虹乐园』里加一个生物：一只会发光的小鸡")
  expect(mcpAddSentence("周末彩虹乐园", "玩法", "")).toBe("在『周末彩虹乐园』里加一个玩法：")
})

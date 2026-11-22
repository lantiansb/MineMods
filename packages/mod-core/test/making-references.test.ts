import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, unzipSync } from "fflate"
import { createProject } from "../src/project"
import { exportProjectArchive, importProjectArchive } from "../src/container"
import {
  addReference,
  archivedMakingPaths,
  begin,
  changeMaking,
  describe,
  INTERRUPTED_WORDS,
  keep,
  keepInterrupted,
  listedReferences,
  looked,
  MakingRecordSchema,
  pictureType,
  readByWords,
  readMaking,
  readReferences,
  REFERENCE_LIMITS,
  REFERENCE_REFUSALS,
  ReferenceRefusal,
  removeReference,
  selfReview,
  setByWords,
  setConcepts,
  setThreeView,
  shownMaking,
  shownReferences,
  stop,
  stoppedWhy,
  fingerprint,
  finalReview,
  MAKING_LIMITS,
  type MakingRecord,
} from "../src/making"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "making-references-"))
  directories.push(root)
  const directory = path.join(root, "project")
  return { root, directory, created: await createProject({ directory, name: "参考图", description: "" }) }
}

// The smallest real files of each kind: what counts is what the bytes are, not what anything calls them.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString("base64")}`
const WEBP = `data:image/webp;base64,${Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8L\x0d\x00\x00\x00\x2f\x00\x00\x00\x10\x07\x10\x11\x11\x88\x88\xfe\x07\x00", "latin1").toString("base64")}`
const said = async (step: Promise<unknown>) => step.then(() => "", (error: unknown) => (error instanceof ReferenceRefusal ? error.message : Promise.reject(error)))

const sheet = { subject: "一样东西。", recognisable: ["一眼认得出"], parts: [{ name: "body", what: "主体", shape: "方的", attaches: "落在地上", surface: "灰色", moves: "不动", assumed: false }], assumed: [] }
const task = "11111111-1111-4111-8111-111111111111"
const asset = "22222222-2222-4222-8222-222222222222"
const start = () => begin(null, { asset_id: asset, entry: "guardian_model", kind: "model", request: "一只守卫", brief: "守卫的模型", task_id: task, remark: null })
const version = (name: string) => fingerprint({ kind: "model", name })
const seen = (record: MakingRecord, name: string, script?: string) => looked(record, { fingerprint: version(name), pictures: [{ label: "六个角度", file: `${record.rounds.length + 1}-a-0.jpg` }], findings: [], script })

test("an explicit reference replacement works at capacity and a rejected replacement preserves every picture", async () => {
  const made = await project()
  for (let index = 0; index < REFERENCE_LIMITS.user; index++) await addReference(made.directory, asset, { kind: "user", name: `参考 ${index}`, url: PNG })
  const before = await readReferences(made.directory, asset)
  const replaced = await addReference(made.directory, asset, { kind: "user", name: "新标注", url: PNG, replaceId: before[0]!.id })
  expect(replaced).toHaveLength(REFERENCE_LIMITS.user)
  expect(replaced.filter((reference) => reference.id !== replaced.at(-1)!.id)).toEqual(before.slice(1))
  await expect(addReference(made.directory, asset, { kind: "user", name: "坏图", url: "data:image/png;base64,bm90IHBuZw==", replaceId: replaced.at(-1)!.id })).rejects.toThrow(REFERENCE_REFUSALS.not_a_picture)
  expect(await readReferences(made.directory, asset)).toEqual(replaced)
  expect((await shownReferences(made.directory, [asset])).map((reference) => reference.url)).toEqual(Array(REFERENCE_LIMITS.user).fill(PNG))
})

test("参考图存在工程里：人给的排在前面，只收三种图片，按内容认而不是按名字认", async () => {
  const made = await project()
  expect(await readReferences(made.directory, "guardian_model")).toEqual([])
  await addReference(made.directory, "guardian_model", { kind: "user", name: "守卫草图.png", url: PNG })
  await setConcepts(made.directory, "guardian_model", [{ name: "正面", url: JPEG }, { name: "侧面", url: WEBP }])
  const held = await addReference(made.directory, "guardian_model", { kind: "user", name: "  颜色参考.jpg  ", url: JPEG })
  expect(held.map((reference) => [reference.kind, reference.name, reference.file.split(".")[1]])).toEqual([["user", "守卫草图.png", "png"], ["user", "颜色参考.jpg", "jpg"], ["concept", "正面", "jpg"], ["concept", "侧面", "webp"]])
  // Read back with the pictures themselves, byte for byte.
  const shown = await shownReferences(made.directory, ["guardian_model", null, "guardian_model"])
  expect(shown.map((reference) => reference.url)).toEqual([PNG, JPEG, JPEG, WEBP])
  expect(await listedReferences(made.directory, ["guardian_model"])).toEqual(held.map((reference) => ({ id: reference.id, kind: reference.kind, name: reference.name })))
  // A plan entry and the asset made for it are two ids of one thing.
  await addReference(made.directory, asset, { kind: "user", name: "另一张", url: PNG })
  expect((await shownReferences(made.directory, ["guardian_model", asset])).map((reference) => reference.name)).toEqual(["守卫草图.png", "颜色参考.jpg", "另一张", "正面", "侧面"])
  // Other items have none.
  expect(await shownReferences(made.directory, ["someone_else"])).toEqual([])

  expect(pictureType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull()
  expect(await said(addReference(made.directory, "x", { kind: "user", name: "a.svg", url: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` }))).toBe(REFERENCE_REFUSALS.not_a_picture)
  // Called a PNG, but the bytes are not one.
  expect(await said(addReference(made.directory, "x", { kind: "user", name: "a.png", url: `data:image/png;base64,${Buffer.from("#!/bin/sh\nrm -rf /").toString("base64")}` }))).toBe(REFERENCE_REFUSALS.not_a_picture)
  expect(await said(addReference(made.directory, "x", { kind: "user", name: "a.png", url: "https://example.com/a.png" }))).toBe(REFERENCE_REFUSALS.not_a_picture)
  expect(await readReferences(made.directory, "x")).toEqual([])
})

test("参考图有上限：张数、大小；去掉一张、换掉构想图，都不碰别的", async () => {
  const made = await project()
  const large = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG.split(",")[1]!, "base64"), Buffer.alloc(REFERENCE_LIMITS.bytes)]).toString("base64")}`
  expect(await said(addReference(made.directory, "thing", { kind: "user", name: "大图.png", url: large }))).toBe(REFERENCE_REFUSALS.too_large)
  await Array.from({ length: REFERENCE_LIMITS.user }, (_, index) => index).reduce(async (before, index) => {
    await before
    await addReference(made.directory, "thing", { kind: "user", name: `第 ${index + 1} 张`, url: PNG })
  }, Promise.resolve())
  expect(await said(addReference(made.directory, "thing", { kind: "user", name: "多的一张", url: PNG }))).toBe(REFERENCE_REFUSALS.too_many("user"))
  expect(await said(setConcepts(made.directory, "thing", Array.from({ length: REFERENCE_LIMITS.concept + 1 }, () => ({ name: "正面", url: PNG }))))).toBe(REFERENCE_REFUSALS.too_many("concept"))
  // The person's pictures being full does not stop an AI's views, and the other way round.
  await setConcepts(made.directory, "thing", [{ name: "正面", url: PNG }, { name: "背面", url: PNG }])
  const held = await readReferences(made.directory, "thing")
  expect(held).toHaveLength(REFERENCE_LIMITS.user + 2)
  const folder = path.join(made.directory, ".minemods", "making", "references")
  const files = async () => (await readdir(path.join(folder, (await readdir(folder)).find((name) => !name.endsWith(".json"))!))).sort()
  expect(await files()).toEqual(held.map((reference) => reference.file).sort())

  const left = await removeReference(made.directory, "thing", held[1]!.id)
  expect(left.map((reference) => reference.name)).toEqual(["第 1 张", "第 3 张", "第 4 张", "正面", "背面"])
  expect(await said(removeReference(made.directory, "thing", held[1]!.id))).toBe(REFERENCE_REFUSALS.gone)
  // New views take the place of the old ones; the files of the old ones go with them.
  const redrawn = await setConcepts(made.directory, "thing", [{ name: "三视图", url: JPEG }])
  expect(redrawn.map((reference) => reference.name)).toEqual(["第 1 张", "第 3 张", "第 4 张", "三视图"])
  expect(await files()).toEqual(redrawn.map((reference) => reference.file).sort())
  expect((await setConcepts(made.directory, "thing", [])).map((reference) => reference.kind)).toEqual(["user", "user", "user"])
  // A file that went missing, or was swapped for something that is not a picture, is simply not shown.
  const folderOf = path.join(folder, (await readdir(folder)).find((name) => !name.endsWith(".json"))!)
  await writeFile(path.join(folderOf, redrawn[0]!.file), "not a picture")
  await rm(path.join(folderOf, redrawn[1]!.file))
  expect((await shownReferences(made.directory, ["thing"])).map((reference) => reference.name)).toEqual(["第 4 张"])
})

test("参考图跟着工程走：导出再导入，一张不少；包里夹带别的东西会被拒绝", async () => {
  const made = await project()
  await addReference(made.directory, "guardian_model", { kind: "user", name: "草图.png", url: PNG })
  await setConcepts(made.directory, "guardian_model", [{ name: "正面", url: WEBP }])
  const record = await changeMaking(made.directory, asset, () => describe(start(), sheet))
  expect((await shownMaking(made.directory, record)).references).toEqual((await readReferences(made.directory, "guardian_model")).map((reference) => ({ id: reference.id, kind: reference.kind, name: reference.name })))
  const archive = path.join(made.root, "made.minemods")
  await exportProjectArchive({ directory: made.directory, destination: archive })
  const entries = unzipSync(await Bun.file(archive).bytes())
  const travelled = Object.keys(entries).filter((name) => name.startsWith(".minemods/making/references/"))
  expect(travelled).toHaveLength(3)
  const destination = path.join(made.root, "imported")
  await importProjectArchive({ archive, destination })
  expect(await shownReferences(destination, ["guardian_model"])).toEqual(await shownReferences(made.directory, ["guardian_model"]))
  expect(await readMaking(destination, asset)).toEqual(record)

  const index = travelled.find((name) => name.endsWith(".json"))!
  const picture = travelled.find((name) => name.endsWith(".png"))!
  expect(archivedMakingPaths(entries).sort()).toEqual(Object.keys(entries).filter((name) => name.startsWith(".minemods/making/")).sort())
  // Anything under the folder that an index does not name, or that is not the picture it says it is, is refused.
  expect(() => archivedMakingPaths({ ...entries, [`${index.slice(0, -5)}/evil.sh`]: strToU8("x") })).toThrow()
  expect(() => archivedMakingPaths({ ...entries, [picture]: strToU8("<script>") })).toThrow()
  expect(() => archivedMakingPaths({ ...entries, [".minemods/making/references/00000000000000000000000000000000.json"]: entries[index]! })).toThrow()
  expect(() => archivedMakingPaths({ ...entries, [".minemods/making/references/readme.txt"]: strToU8("x") })).toThrow()
  // A project without references exports exactly as before: nothing new appears in its archive.
  const plain = await project()
  await exportProjectArchive({ directory: plain.directory, destination: path.join(plain.root, "plain.minemods") })
  expect(Object.keys(unzipSync(await Bun.file(path.join(plain.root, "plain.minemods")).bytes())).filter((name) => name.includes("references"))).toEqual([])
})

test("被中断不等于没达标：记录里分得清为什么停下；每一版的脚本跟着这一版", async () => {
  const made = await project()
  const done = { matches: ["都对上了"], problems: [], next: [], verdict: "done" as const }
  const revise = { matches: [], problems: ["正面看不出脸"], next: ["把眼睛加大"], verdict: "revise" as const }
  const looking = seen(describe(start(), sheet), "a", "return 1")
  expect(looking.rounds[0]!.script).toBe("return 1")
  // The same version looked at again keeps its script; a later version written by hand has none.
  expect(looked(looking, { fingerprint: version("a"), pictures: [], findings: [] }).rounds[0]!.script).toBe("return 1")
  expect(seen(selfReview(looking, revise), "b").rounds.map((round) => round.script)).toEqual(["return 1", undefined])

  // Cut short after a review that passed: kept, and nothing in the record says it fell short.
  const passed = finalReview(selfReview(looking, done), { passed: true, findings: [], advice: ["神态可以再凶一点"], independent: true })
  const cut = keepInterrupted(passed)
  expect(cut).toMatchObject({ state: "done", outcome: "kept_interrupted", stopped_reason: "interrupted", kept_reason: [INTERRUPTED_WORDS], kept_round: 1 })
  expect(INTERRUPTED_WORDS).toBe("制作被中断了（软件关了或连接断了），这是中断前最好的一版，还没有做完审查。")
  expect(JSON.stringify(cut)).not.toMatch(/没达标|没有达到|不满意/)
  const shown = await shownMaking(made.directory, cut)
  expect(shown).toMatchObject({ outcome: "kept_interrupted", stopped_reason: "interrupted", kept_round: 1, review: { passed: true, round: 1 } })
  expect(shown.rounds[0]!.script).toBe("return 1")
  expect("references" in shown).toBe(false)

  // The other endings say which they were.
  expect(keep(selfReview(looking, revise), ["它自己认为必须改：正面看不出脸"])).toMatchObject({ outcome: "kept_unsatisfied", stopped_reason: "gave_up" })
  expect(stop(looking)).toMatchObject({ state: "stopped", outcome: "failed", stopped_reason: "failed" })
  expect(stop(looking, false)).toMatchObject({ state: "stopped" })
  expect(stop(looking, false).stopped_reason).toBeUndefined()
  const full = Array.from({ length: MAKING_LIMITS.rounds }, (_, index) => `v${index}`).reduce((record, name, index) => (index ? seen(selfReview(record, revise), name) : seen(record, name)), describe(start(), sheet))
  expect(stoppedWhy(selfReview(full, revise), "gave_up")).toBe("rounds")
  expect(stoppedWhy(finalReview(selfReview(full, done), { passed: false, findings: ["背上少一片叶子"], independent: true }), "gave_up")).toBe("review")
  expect(keep(selfReview(full, revise), [])).toMatchObject({ outcome: "kept_unsatisfied", stopped_reason: "rounds" })
})

test("旧记录照样能读：没有脚本、没有停下原因、没有参考图的记录，读出来和以前一样", async () => {
  const made = await project()
  // A record exactly as a Studio from before these fields wrote it.
  const old = {
    schema_version: 1,
    asset_id: asset,
    entry: "guardian_model",
    kind: "model",
    request: "一只守卫",
    brief: "守卫的模型",
    task_id: task,
    sheet: { ...sheet, remark: null },
    described: true,
    remark: null,
    rounds: [{ round: 1, at: "2026-10-01T00:00:00.000Z", fingerprint: version("a"), pictures: [], self_review: { matches: [], problems: ["还要改"], next: ["改"], verdict: "revise" }, findings: [] }],
    review: null,
    best: { round: 1, fingerprint: version("a") },
    outcome: "kept_unsatisfied",
    kept_reason: ["它自己认为必须改：还要改"],
    kept_round: 1,
    state: "done",
    rounds_allowed: 6,
    updated_at: "2026-10-01T00:00:00.000Z",
  }
  expect(MakingRecordSchema.parse(old)).toEqual(old as MakingRecord)
  await changeMaking(made.directory, asset, () => MakingRecordSchema.parse(old))
  const read = await readMaking(made.directory, asset)
  expect({ ...read, updated_at: old.updated_at }).toEqual(old as MakingRecord)
  expect(await shownMaking(made.directory, read!)).toEqual({
    sheet: old.sheet,
    rounds: [{ round: 1, at: old.rounds[0]!.at, pictures: [], self_review: old.rounds[0]!.self_review as MakingRecord["rounds"][number]["self_review"], findings: [] }],
    review: null,
    rounds_allowed: 6,
    outcome: "kept_unsatisfied",
    kept_reason: old.kept_reason,
    kept_round: 1,
  })
})

test("六视图：一整张或六个方向各一张，放进同一格就换掉；最多六张；排在最前面、和渲染图同序；重做时构想图清掉，六视图留着", async () => {
  const made = await project()
  await addReference(made.directory, "guardian_model", { kind: "user", name: "草图.png", url: PNG })
  await setConcepts(made.directory, "guardian_model", [{ name: "正面", url: JPEG }])
  // Views go in by slot, and are listed sheet, front, back, left, right, top, quarter whatever order they came in; then the person's own, then the concepts.
  await setThreeView(made.directory, "guardian_model", { view: "quarter", by: "person", name: "斜前方.png", url: PNG })
  await setThreeView(made.directory, "guardian_model", { view: "back", by: "person", name: "背面.png", url: PNG })
  await setThreeView(made.directory, "guardian_model", { view: "right", by: "person", name: "右侧.png", url: PNG })
  await setThreeView(made.directory, "guardian_model", { view: "front", by: "person", name: "正面.png", url: PNG })
  await setThreeView(made.directory, "guardian_model", { view: "top", by: "person", name: "从上往下.png", url: PNG })
  const six = await setThreeView(made.directory, "guardian_model", { view: "left", by: "person", name: "左侧.webp", url: WEBP })
  expect(six.map((reference) => [reference.kind, reference.view, reference.by])).toEqual([
    ["three_view", "front", "person"],
    ["three_view", "back", "person"],
    ["three_view", "left", "person"],
    ["three_view", "right", "person"],
    ["three_view", "top", "person"],
    ["three_view", "quarter", "person"],
    ["user", undefined, undefined],
    ["concept", undefined, undefined],
  ])
  expect(six.filter((reference) => reference.kind === "three_view")).toHaveLength(REFERENCE_LIMITS.three_view)
  // The same slot again takes the place of what was there, and its file goes with it; the six stay six.
  const front = six[0]!
  const again = await setThreeView(made.directory, "guardian_model", { view: "front", by: "person", name: "新正面.jpg", url: JPEG })
  expect(again.filter((reference) => reference.kind === "three_view").map((reference) => reference.name)).toEqual(["新正面.jpg", "背面.png", "左侧.webp", "右侧.png", "从上往下.png", "斜前方.png"])
  expect(again.some((reference) => reference.id === front.id)).toBe(false)
  const folder = path.join(made.directory, ".minemods", "making", "references")
  const files = async () => (await readdir(path.join(folder, (await readdir(folder)).find((name) => !name.endsWith(".json"))!))).sort()
  expect(await files()).toEqual(again.map((reference) => reference.file).sort())
  // A side from before the six is the left slot: put in as "side", it is kept as the left and takes the left's place.
  const sided = await setThreeView(made.directory, "guardian_model", { view: "side", by: "person", name: "侧面.png", url: PNG })
  expect(sided.filter((reference) => reference.kind === "three_view").map((reference) => [reference.view, reference.name])).toEqual([["front", "新正面.jpg"], ["back", "背面.png"], ["left", "侧面.png"], ["right", "右侧.png"], ["top", "从上往下.png"], ["quarter", "斜前方.png"]])
  // A whole sheet stands for all six views; a single view takes the place of a sheet.
  const sheetOnly = await setThreeView(made.directory, "guardian_model", { view: "sheet", by: "person", name: "六视图.png", url: PNG })
  expect(sheetOnly.filter((reference) => reference.kind === "three_view").map((reference) => reference.view)).toEqual(["sheet"])
  expect((await setThreeView(made.directory, "guardian_model", { view: "top", by: "person", name: "从上往下.png", url: PNG })).filter((reference) => reference.kind === "three_view").map((reference) => reference.view)).toEqual(["top"])
  // Never more than the limit, kept apart from the person's pictures and the concepts.
  for (const view of ["front", "back", "left", "side", "right", "quarter", "top"] as const) await setThreeView(made.directory, "guardian_model", { view, by: "person", name: view, url: PNG })
  expect((await readReferences(made.directory, "guardian_model")).filter((reference) => reference.kind === "three_view")).toHaveLength(REFERENCE_LIMITS.three_view)
  expect(await files()).toHaveLength(REFERENCE_LIMITS.three_view + 2)

  // An image model never takes the place of the person's own: refused, nothing changed.
  const before = await readReferences(made.directory, "guardian_model")
  expect(await said(setThreeView(made.directory, "guardian_model", { view: "sheet", by: "ai", name: "AI 画的六视图", url: PNG }))).toBe(REFERENCE_REFUSALS.person_three_view)
  expect(await readReferences(made.directory, "guardian_model")).toEqual(before)
  // Without the person's, a drawn sheet goes in, and a later drawing takes its place; the person's own picture takes the place of a drawn one.
  await Promise.all(before.filter((reference) => reference.kind === "three_view").map((reference) => removeReference(made.directory, "guardian_model", reference.id)))
  await setThreeView(made.directory, "guardian_model", { view: "sheet", by: "ai", name: "AI 画的六视图", url: PNG })
  const drawn = await setThreeView(made.directory, "guardian_model", { view: "sheet", by: "ai", name: "AI 又画了一张", url: JPEG })
  expect(drawn.filter((reference) => reference.kind === "three_view").map((reference) => [reference.name, reference.by])).toEqual([["AI 又画了一张", "ai"]])
  expect((await setThreeView(made.directory, "guardian_model", { view: "front", by: "person", name: "我画的正面", url: PNG })).filter((reference) => reference.kind === "three_view").map((reference) => [reference.view, reference.by])).toEqual([["front", "person"]])
  expect(await said(setThreeView(made.directory, "guardian_model", { view: "sheet", by: "person", name: "a.svg", url: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` }))).toBe(REFERENCE_REFUSALS.not_a_picture)

  // Making it again clears what an AI drew of what it meant then; the 六视图 and the person's own stay.
  const redone = await setConcepts(made.directory, "guardian_model", [])
  expect(redone.map((reference) => reference.kind)).toEqual(["three_view", "user"])
  // Read with the pictures and listed by name, each view of the 六视图 says its slot (and, with the pictures, whose it is).
  expect((await shownReferences(made.directory, ["guardian_model"])).map((reference) => [reference.kind, reference.view, reference.by])).toEqual([["three_view", "front", "person"], ["user", undefined, undefined]])
  expect(await listedReferences(made.directory, ["guardian_model"])).toEqual([{ id: redone[0]!.id, kind: "three_view", name: "我画的正面", view: "front" }, { id: redone[1]!.id, kind: "user", name: "草图.png" }])

  // It travels with the project like any other reference.
  const archive = path.join(made.root, "three.minemods")
  await exportProjectArchive({ directory: made.directory, destination: archive })
  const destination = path.join(made.root, "imported-three")
  await importProjectArchive({ archive, destination })
  expect(await shownReferences(destination, ["guardian_model"])).toEqual(await shownReferences(made.directory, ["guardian_model"]))
})

test("三视图、六视图之前写下的参考图索引照样能读；以前的「侧面」读作它的左侧；种类和格子对不上的条目不认", async () => {
  const made = await project()
  await addReference(made.directory, "old", { kind: "user", name: "草图.png", url: PNG })
  await setConcepts(made.directory, "old", [{ name: "正面", url: JPEG }])
  const folder = path.join(made.directory, ".minemods", "making", "references")
  const index = path.join(folder, (await readdir(folder)).find((name) => name.endsWith(".json"))!)
  // Written by a Studio from before three-views: no `view`, no `by`, only the two kinds.
  const old = JSON.parse(await Bun.file(index).text()) as { references: Record<string, unknown>[] }
  expect(old.references.every((reference) => !("view" in reference) && !("by" in reference))).toBe(true)
  expect((await readReferences(made.directory, "old")).map((reference) => reference.kind)).toEqual(["user", "concept"])
  // A three-view without its slot, or a picture of another kind with one, is not a reference this index can hold.
  await writeFile(index, JSON.stringify({ ...old, references: [{ ...old.references[0], kind: "three_view" }] }))
  expect(await readReferences(made.directory, "old")).toEqual([])
  await writeFile(index, JSON.stringify({ ...old, references: [{ ...old.references[0], view: "front", by: "person" }] }))
  expect(await readReferences(made.directory, "old")).toEqual([])
  // Written when there were three views: front, side and back. It still reads, the side as its left, in the order of the renders.
  const [user, concept] = old.references as [Record<string, unknown>, Record<string, unknown>]
  const three = { ...old, references: [{ ...concept, kind: "three_view", view: "back", by: "person" }, { ...user, kind: "three_view", view: "side", by: "person" }] }
  await writeFile(index, JSON.stringify(three))
  expect((await readReferences(made.directory, "old")).map((reference) => reference.view)).toEqual(["back", "left"])
  expect((await listedReferences(made.directory, ["old"])).map((reference) => reference.view)).toEqual(["back", "left"])
  expect((await shownReferences(made.directory, ["old"])).map((reference) => [reference.view, reference.by])).toEqual([["back", "person"], ["left", "person"]])
  // A left put in now takes the old side's place; the index is written with "left" from then on.
  const replaced = await setThreeView(made.directory, "old", { view: "left", by: "person", name: "左侧.png", url: PNG })
  expect(replaced.map((reference) => [reference.view, reference.name])).toEqual([["back", (concept as { name: string }).name], ["left", "左侧.png"]])
  expect(JSON.parse(await Bun.file(index).text()).references.map((reference: { view: string }) => reference.view)).toEqual(["back", "left"])
})

test("按文字做的选择记在工程里：记下以后一直在，加图、去图、重做都不影响，导出再导入还在；没选过的东西不受影响", async () => {
  const made = await project()
  expect(await readByWords(made.directory, "guardian_model")).toBe(false)
  await setByWords(made.directory, "guardian_model")
  await setByWords(made.directory, "guardian_model")
  expect(await readByWords(made.directory, "guardian_model")).toBe(true)
  // This thing only: another thing has not been answered for.
  expect(await readByWords(made.directory, "other_model")).toBe(false)
  // Pictures come and go around it, and a redo clears the concepts: the answer stays, and no picture appears out of it.
  expect(await readReferences(made.directory, "guardian_model")).toEqual([])
  const added = await addReference(made.directory, "guardian_model", { kind: "user", name: "草图.png", url: PNG })
  await setConcepts(made.directory, "guardian_model", [{ name: "正面", url: WEBP }])
  await setThreeView(made.directory, "guardian_model", { view: "sheet", by: "person", name: "六视图.png", url: PNG })
  await removeReference(made.directory, "guardian_model", added[0]!.id)
  await setConcepts(made.directory, "guardian_model", [])
  expect(await readByWords(made.directory, "guardian_model")).toBe(true)
  expect((await readReferences(made.directory, "guardian_model")).map((reference) => reference.kind)).toEqual(["three_view"])
  // It travels with the project, like the pictures.
  const archive = path.join(made.root, "words.minemods")
  await exportProjectArchive({ directory: made.directory, destination: archive })
  const destination = path.join(made.root, "imported")
  await importProjectArchive({ archive, destination })
  expect(await readByWords(destination, "guardian_model")).toBe(true)
  expect(await readByWords(destination, "other_model")).toBe(false)
  // Nothing but the choice recorded: an item with only that has no pictures and still travels.
  await setByWords(made.directory, "bare_model")
  expect(await readReferences(made.directory, "bare_model")).toEqual([])
  await exportProjectArchive({ directory: made.directory, destination: path.join(made.root, "bare.minemods") })
  await importProjectArchive({ archive: path.join(made.root, "bare.minemods"), destination: path.join(made.root, "bare") })
  expect(await readByWords(path.join(made.root, "bare"), "bare_model")).toBe(true)
})

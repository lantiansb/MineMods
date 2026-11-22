import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { strToU8, unzipSync, zipSync } from "fflate"
import { z } from "zod"
import { createHash } from "node:crypto"
import { createProject, openProject } from "../src/project"
import { exportProjectArchive, importProjectArchive } from "../src/container"
import { redoRemark } from "../src/blueprint-production"
import {
  archivedMakingPaths,
  begin,
  BLIND_KINDS,
  BLIND_WORDS,
  blindAnswered,
  blindDue,
  BLIND_FITS,
  blindAdvice,
  blindFinding,
  blindFit,
  blindPlain,
  isBlindNamed,
  changeMaking,
  commitGate,
  describe,
  edit,
  finalReview,
  findingLines,
  fingerprint,
  finish,
  listMakings,
  looked,
  lookGate,
  MAKING_LIMITS,
  MakingRecordSchema,
  MakingRefusal,
  PartSheetSchema,
  prunePictures,
  readMaking,
  REFUSALS,
  FINDING_CONTRASTS,
  FINDING_LINE,
  REVIEWER_INSTRUCTIONS,
  ReviewNeedsSchema,
  reviewScope,
  keep,
  needGate,
  readBest,
  reviewAsked,
  reviewShown,
  unsatisfied,
  writeBest,
  selfReview,
  selfReviewed,
  SHEET_CHANGED,
  sheetVersion,
  unseenMotions,
  continuityFindings,
  outsideFindings,
  sheetOnly,
  shownMaking,
  stop,
  writePictures,
  saveable,
  SaveRefusal,
  saveVerdict,
  tierFindings,
  isSheetless,
  looksAt,
  LOOKED_KINDS,
  type MakingRecord,
} from "../src/making"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const sheet = {
  subject: "一只守着蓝色矿石的洞穴守卫，敌对生物。",
  recognisable: ["石头身体上嵌着发光的蓝色矿石", "一双发蓝光的眼睛", "比玩家高一头的宽肩膀"],
  parts: [
    { name: "body", what: "躯干", shape: "上宽下窄的石块，约 12×14×8 像素", attaches: "立在两条腿上", surface: "深灰石头，胸口嵌三块蓝矿", moves: "走路时左右微晃", assumed: false },
    { name: "head", what: "头", shape: "扁方的石块，约 8×6×8 像素", attaches: "接在躯干顶上偏前", surface: "深灰石头，正面一双发光蓝眼，眉骨突出", moves: "跟着视线转", assumed: true },
  ],
  assumed: ["人没说长什么样：定成石头身体、嵌着同一种蓝矿"],
}
const task = "11111111-1111-4111-8111-111111111111"
const start = (previous: MakingRecord | null = null, remark: string | null = null, taskId = task) =>
  begin(previous, { asset_id: "22222222-2222-4222-8222-222222222222", entry: "guardian_model", kind: "model", request: "一只守着矿石的敌对生物", brief: "洞穴守卫的模型", task_id: taskId, remark })
const refused = (step: () => unknown) => {
  try {
    step()
  } catch (error) {
    if (error instanceof MakingRefusal) return { words: error.message, final: error.final }
    throw error
  }
  return null
}
const version = (name: string) => fingerprint({ kind: "model", name })
const seen = (record: MakingRecord, name: string, findings: string[] = []) => looked(record, { fingerprint: version(name), pictures: [{ label: "六个角度", file: `${record.rounds.length + 1}-a-0.jpg` }], findings })
const revise = { matches: ["躯干的比例对"], problems: ["正面看不出脸"], next: ["把眼睛加大并提亮"], verdict: "revise" as const }
const done = { matches: ["每个部件都对上了"], problems: [], next: [], verdict: "done" as const }

test("制作流程的每一步都按顺序把关：没有说明不能看，没自评不能看下一版，没看过的版本不能交", () => {
  const begun = start()
  expect(begun).toMatchObject({ state: "describing", sheet: null, described: false, rounds_allowed: MAKING_LIMITS.rounds })
  // Nothing may be looked at, and nothing handed in, before the sheet exists.
  expect(refused(() => lookGate(begun, version("a")))).toEqual({ words: REFUSALS.no_sheet, final: false })
  expect(commitGate(begun, version("a"))).toBe(REFUSALS.no_sheet)
  expect(commitGate(null, version("a"))).toBe(REFUSALS.no_sheet)
  const described = describe(begun, sheet)
  expect(described).toMatchObject({ state: "making", described: true, sheet: { ...sheet, remark: null } })
  expect(commitGate(described, version("a"))).toBe(REFUSALS.no_look)
  expect(refused(() => selfReview(described, revise))).toEqual({ words: REFUSALS.no_look, final: false })

  const first = seen(described, "a")
  expect(first.rounds).toHaveLength(1)
  expect(commitGate(first, version("a"))).toBe(REFUSALS.no_self_review(1))
  // A version that was never looked at: the document changed since the last look.
  expect(commitGate(first, version("b"))).toBe(REFUSALS.unseen)
  expect(REFUSALS.unseen).toContain("你还没有看过这一版")
  // The next version may be looked at before this one has been judged: that one is skipped, and says which round it left without a self-review.
  expect(lookGate(first, version("b"))).toEqual({ opens: true, skipped: 1 })
  expect(seen(first, "b").rounds.map((round) => [round.round, round.self_review])).toEqual([[1, null], [2, null]])
  // The review that counts is still of the last version, and it still needs that version's own self-review.
  expect(commitGate(seen(first, "b"), version("b"))).toBe(REFUSALS.no_self_review(2))
  expect(refused(() => finalReview(seen(first, "b"), { passed: true, findings: [], independent: true }))).toEqual({ words: REFUSALS.no_self_review(2), final: false })
  // The last version allowed cannot be walked past: no version is left to give, so it has to be judged.
  const spent = Array.from({ length: MAKING_LIMITS.rounds - 1 }).reduce<MakingRecord>((current, _, index) => seen(current, `s${index}`), first)
  expect(spent.rounds).toHaveLength(MAKING_LIMITS.rounds)
  expect(refused(() => lookGate(spent, version("x")))).toEqual({ words: REFUSALS.no_self_review(MAKING_LIMITS.rounds), final: false })
  // Looking again at the same version is the same round.
  expect(looked(first, { fingerprint: version("a"), pictures: [{ label: "近看「head」", file: "1-b-0.jpg" }], findings: [] }).rounds).toHaveLength(1)

  const judged = selfReview(first, revise)
  expect(judged.state).toBe("making")
  expect(commitGate(judged, version("a"))).toBe(REFUSALS.not_done)
  // A second self-review of the same version replaces the first, as long as nobody has concluded on the version.
  expect(selfReviewed(first)).toBe(false)
  expect(selfReviewed(judged)).toBe(true)
  expect(selfReview(judged, done).rounds[0]?.self_review?.verdict).toBe("done")
  expect(selfReview(judged, done).state).toBe("reviewing")
  expect(selfReview(selfReview(judged, done), revise).state).toBe("making")
  // Once the independent review of this very version has concluded, the self-review is no longer changed: it could be made to match what the reviewer found.
  const concluded = finalReview(selfReview(first, done), { passed: false, findings: ["正面看不出脸"], independent: true })
  expect(refused(() => selfReview(concluded, revise))).toEqual({ words: REFUSALS.reviewed_already, final: false })
  expect(refused(() => selfReview(concluded, done))).toEqual({ words: REFUSALS.reviewed_already, final: false })
  expect(refused(() => finalReview(judged, { passed: true, findings: [], independent: true }))).toEqual({ words: REFUSALS.not_done, final: false })

  const second = seen(judged, "b")
  expect(second.rounds.map((round) => round.round)).toEqual([1, 2])
  const finished = selfReview(second, done)
  expect(finished.state).toBe("reviewing")
  expect(commitGate(finished, version("b"))).toBe(REFUSALS.no_review)
  const passed = finalReview(finished, { passed: true, findings: [], advice: ["背面的纹样可以再丰富一点"], independent: true })
  expect(passed.review).toMatchObject({ passed: true, independent: true, findings: [], advice: ["背面的纹样可以再丰富一点"], fingerprint: version("b") })
  expect(commitGate(passed, version("b"))).toBeNull()
  // Changed after it passed: this is not the version that was looked at or reviewed.
  expect(commitGate(passed, version("c"))).toBe(REFUSALS.unseen)
  expect(finish(passed)).toMatchObject({ state: "done", outcome: "passed" })
})

test("自评不能自相矛盾：还有问题或量出硬伤就不能说做完，说要改就得写改什么", () => {
  const described = describe(start(), sheet)
  const clean = seen(described, "a")
  expect(refused(() => selfReview(clean, { ...done, problems: ["侧面是个平板"] }))).toEqual({ words: REFUSALS.done_with_problems, final: false })
  expect(refused(() => selfReview(clean, { ...revise, next: [] }))).toEqual({ words: REFUSALS.revise_without_next, final: false })
  // The deterministic standard is the floor: while it still finds a fault, the maker cannot call the version finished.
  const faulty = seen(described, "a", ["认得出：正面找不到一双眼睛。把眼睛画成和周围对比明显的一对。"])
  expect(refused(() => selfReview(faulty, done))?.words).toBe(REFUSALS.done_with_findings(faulty.rounds[0]!.findings))
  expect(selfReview(faulty, revise).rounds[0]?.self_review?.verdict).toBe("revise")
})

test("写了新的理由以后，照改之前的说明查出来的毛病不再挡着说做完的路：对同一版再看一次（不算新的一版），新的理由才被读进去", () => {
  const faulty = seen(describe(start(), sheet), "a", ["有主次：整个模型只看得出 2 种颜色，太单调。"])
  expect(faulty.rounds[0]!.sheet).toBe(sheetVersion(faulty.sheet)!)
  // The sheet as it was: the finding stands, in the words it always had.
  expect(refused(() => selfReview(faulty, done))?.words).toBe(REFUSALS.done_with_findings(faulty.rounds[0]!.findings))
  // A reason written after the look: the finding kept with the look is of the sheet before it. Refusing "done" with that same finding would send the maker round again for nothing, so it is told what to do.
  const answered = describe(faulty, { ...sheet, justified: [{ what: "few_tones", reason: "白色混凝土，本来就是一个颜色" }] })
  expect(sheetVersion(answered.sheet)).not.toBe(sheetVersion(faulty.sheet)!)
  const told = refused(() => selfReview(answered, done))
  expect(told).toEqual({ words: expect.stringContaining(SHEET_CHANGED), final: false })
  expect(SHEET_CHANGED).toContain("对这同一版再看一次")
  expect(SHEET_CHANGED).toContain("这不算新的一版")
  expect(SHEET_CHANGED).toContain("新写的理由才会被读进去")
  // "Revise" is still allowed: only calling it finished over a stale finding is held.
  expect(selfReview(answered, revise).rounds[0]?.self_review?.verdict).toBe("revise")
  // Looking again at this same version is not a new round; the standard now reads the new reason (no finding), and "done" goes through.
  expect(lookGate(answered, version("a"))).toEqual({ opens: false, skipped: null })
  const again = seen(answered, "a")
  expect(again.rounds).toHaveLength(1)
  expect(again.rounds[0]!.sheet).toBe(sheetVersion(answered.sheet)!)
  expect(selfReview(looked(answered, { fingerprint: version("a"), pictures: [{ label: "六个角度", file: "1-a-1.jpg" }], findings: [] }), done).state).toBe("reviewing")
  // Re-looked and the finding is still there (the reason did not answer it): the usual refusal, not the stale-sheet one.
  expect(refused(() => selfReview(looked(answered, { fingerprint: version("a"), pictures: [{ label: "六个角度", file: "1-a-1.jpg" }], findings: faulty.rounds[0]!.findings }), done))?.words).toBe(REFUSALS.done_with_findings(faulty.rounds[0]!.findings))
  // A sheet that answers the same (a remark, another subject line) is not a change; a record from before this was kept is read as it always was.
  expect(refused(() => selfReview(describe(faulty, { ...sheet, subject: "换了个说法的守卫。" }), done))?.words).toBe(REFUSALS.done_with_findings(faulty.rounds[0]!.findings))
  const old = { ...answered, rounds: answered.rounds.map(({ sheet: _sheet, ...round }) => round) }
  expect(refused(() => selfReview(MakingRecordSchema.parse(old), done))?.words).toBe(REFUSALS.done_with_findings(faulty.rounds[0]!.findings))
})

test("独立验收没通过就回去再改一版；同一版不能再验一次；改过的版本要重新验", () => {
  const finished = selfReview(seen(describe(start(), sheet), "a"), done)
  expect(refused(() => finalReview(finished, { passed: false, findings: [], independent: true }))).toEqual({ words: REFUSALS.failed_without_findings, final: false })
  const failed = finalReview(finished, { passed: false, findings: ["正面第一格看不出脸"], independent: false })
  expect(failed).toMatchObject({ state: "making", review: { passed: false, independent: false } })
  expect(commitGate(failed, version("a"))).toBe(REFUSALS.review_failed)
  expect(refused(() => finalReview(failed, { passed: true, findings: [], independent: true }))).toEqual({ words: REFUSALS.reviewed_and_failed, final: false })
  // The failure stays on show while the next version is made, and does not count for it.
  const next = selfReview(seen(failed, "b"), done)
  expect(next.review).toMatchObject({ passed: false, fingerprint: version("a") })
  expect(commitGate(next, version("b"))).toBe(REFUSALS.stale_review)
  const passed = finalReview(next, { passed: true, findings: [], independent: true })
  expect(commitGate(passed, version("b"))).toBeNull()
  // A sheet rewritten after the pass has not been reviewed against.
  expect(commitGate(describe(passed, { ...sheet, subject: "换了个说法的守卫。" }), version("b"))).toBe(REFUSALS.no_review)
})

test("版数有上限：看满了还没做完，流程到此为止", () => {
  const record = Array.from({ length: MAKING_LIMITS.rounds - 1 }).reduce<MakingRecord>((current, _, index) => selfReview(seen(current, `v${index}`), revise), describe(start(), sheet))
  expect(record.rounds).toHaveLength(MAKING_LIMITS.rounds - 1)
  const last = seen(record, "last")
  expect(last.rounds).toHaveLength(MAKING_LIMITS.rounds)
  // The last version allowed is judged "revise": nothing is left to revise in, and every further step is refused for good.
  const out = selfReview(last, revise)
  expect(out.state).toBe("stopped")
  expect(refused(() => lookGate(out, version("one-more")))).toEqual({ words: REFUSALS.over, final: true })
  // Called finished on the last version, a further version is still one too many.
  const full = selfReview(last, done)
  expect(refused(() => lookGate(full, version("seventh")))).toEqual({ words: REFUSALS.out_of_rounds(MAKING_LIMITS.rounds), final: true })
  // A review that fails on the last version ends it too; one that passes leaves it ready to hand in.
  expect(finalReview(full, { passed: false, findings: ["还是看不出脸"], independent: true }).state).toBe("stopped")
  expect(commitGate(finalReview(full, { passed: true, findings: [], independent: true }), version("last"))).toBeNull()
  expect(REFUSALS.out_of_rounds(MAKING_LIMITS.rounds)).toContain(`上限 ${MAKING_LIMITS.rounds} 版`)
})

test("同一份内容不管键的顺序都是同一版；改一个字就是另一版", () => {
  expect(fingerprint({ kind: "model", bones: [{ name: "a", pivot: [0, 1, 2] }] })).toBe(fingerprint({ bones: [{ pivot: [0, 1, 2], name: "a" }], kind: "model" }))
  expect(fingerprint({ kind: "model", optional: undefined })).toBe(fingerprint({ kind: "model" }))
  expect(fingerprint({ kind: "model", bones: [1, 2] })).not.toBe(fingerprint({ kind: "model", bones: [2, 1] }))
})

test("重做从上一版的部件说明加上人说的话开始；同一个任务再开始一次什么都不变", () => {
  const made = finish(finalReview(selfReview(seen(describe(start(), sheet), "a"), done), { passed: true, findings: [], independent: true }))
  expect(start(made)).toBe(made)
  const redo = start(made, "脸看不出来，眼睛做大一点", "33333333-3333-4333-8333-333333333333")
  expect(redo).toMatchObject({ state: "describing", described: false, rounds: [], review: null, remark: "脸看不出来，眼睛做大一点" })
  expect(redo.sheet).toEqual({ ...sheet, remark: "脸看不出来，眼睛做大一点" })
  // The earlier sheet does not stand in for describing this version.
  expect(commitGate(redo, version("a"))).toBe(REFUSALS.no_sheet)
  // The remark is the person's: an AI's sheet cannot overwrite it, and neither can an edit.
  expect(describe(redo, sheet).sheet?.remark).toBe("脸看不出来，眼睛做大一点")
  expect(edit(redo, { ...sheet, subject: "人自己改过的说明。", remark: "别的话" }).sheet).toMatchObject({ subject: "人自己改过的说明。", remark: "脸看不出来，眼睛做大一点" })
  // The remark is read out of the task text the redo was handed out with.
  expect(redoRemark("洞穴守卫的模型\n\n玩家看过现在这一版，说：\n脸看不出来，眼睛做大一点\n请在现有文档的基础上照这个意见重做，没有被提到的地方保持不变。\n\n整个模组共用的风格约定：\n造型：方块感")).toBe("脸看不出来，眼睛做大一点")
  expect(redoRemark("洞穴守卫的模型\n\n这一样之前没有做成，玩家想再试一次，并且说：\n请再做一次。\n\n整个模组共用的风格约定：\n造型：方块感")).toBe("请再做一次。")
  expect(redoRemark("洞穴守卫的模型")).toBeNull()
})

test("部件说明是自由文字：没有词表、没有题材分类，每一栏都要写", () => {
  expect(PartSheetSchema.safeParse({ ...sheet, remark: null }).success).toBe(true)
  expect(PartSheetSchema.safeParse({ ...sheet, remark: null, category: "creature" }).success).toBe(false)
  expect(PartSheetSchema.safeParse({ ...sheet, parts: [], remark: null }).success).toBe(false)
  expect(PartSheetSchema.safeParse({ ...sheet, parts: [{ ...sheet.parts[0], moves: "" }], remark: null }).success).toBe(false)
  // Nothing in the shape of a sheet enumerates subjects, materials or part types.
  expect(JSON.stringify(z.toJSONSchema(PartSheetSchema))).not.toContain("enum")
})

test("量出来的硬伤写成一句句大白话", () => {
  expect(findingLines({ unreadable: null, findings: [{ criterion: "认得出", severity: "硬伤", message: "正面找不到一双眼睛。", fix: "把眼睛画成对比明显的一对。" }] })).toEqual(["认得出：正面找不到一双眼睛。把眼睛画成对比明显的一对。"])
  expect(findingLines({ unreadable: { message: "模型的面放不进贴图。", fix: "把方块改小。" }, findings: [] })).toEqual(["这份内容没法检查：模型的面放不进贴图。把方块改小。"])
})

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-making-"))
  directories.push(root)
  const directory = path.join(root, "project")
  return { root, directory, created: await createProject({ directory, name: "看着做", description: "" }) }
}

test("每一版的图和自评存在工程里，重开后原样读回；一轮里图多了，留第一张和最新的", async () => {
  const { directory } = await project()
  const begun = await changeMaking(directory, start().asset_id, (current) => describe(begin(current, { ...start(), task_id: task, remark: null }), sheet))
  expect(await readMaking(directory, begun.asset_id)).toEqual(begun)
  const stored = await writePictures(directory, begun.asset_id, 1, [{ label: "六个角度", url: PIXEL }, { label: "不是图片", url: "https://example.com/a.png" }])
  expect(stored).toEqual([{ label: "六个角度", file: expect.stringMatching(/^1-[a-z0-9]+-0\.png$/) }])
  const first = await changeMaking(directory, begun.asset_id, (current) => selfReview(looked(current!, { fingerprint: version("a"), pictures: stored, findings: ["认得出：正面找不到一双眼睛。"] }), revise))
  // Read back as the app shows it: pictures as data URLs, nothing about files or fingerprints.
  const shown = await shownMaking(directory, (await readMaking(directory, begun.asset_id))!)
  expect(shown).toEqual({
    sheet: { ...sheet, remark: null },
    rounds: [{ round: 1, at: first.rounds[0]!.at, pictures: [{ label: "六个角度", url: PIXEL, from: "look" }], self_review: revise, findings: ["认得出：正面找不到一双眼睛。"] }],
    review: null,
    rounds_allowed: MAKING_LIMITS.rounds,
  })
  // Many looks at one version: the first sheet stays, the newest of the rest are kept, older files are removed.
  const many = await Array.from({ length: MAKING_LIMITS.kept + 2 }).reduce<Promise<MakingRecord>>(async (before, _, index) => {
    const current = await before
    const files = await writePictures(directory, begun.asset_id, 2, [{ label: index === 0 ? "六个角度" : `近看 ${index}`, url: PIXEL }])
    await Bun.sleep(2)
    return changeMaking(directory, begun.asset_id, () => looked(current, { fingerprint: version("b"), pictures: files, findings: [] }))
  }, Promise.resolve(first))
  expect(many.rounds[1]!.pictures.map((picture) => picture.label)).toEqual(["六个角度", ...Array.from({ length: MAKING_LIMITS.kept - 1 }, (_, index) => `近看 ${index + 3}`)])
  await prunePictures(directory, many)
  expect((await readdir(path.join(directory, ".minemods", "making", begun.asset_id))).sort()).toEqual(many.rounds.flatMap((round) => round.pictures.map((picture) => picture.file)).sort())
  // A file that is not a record reads as no record, never as an error.
  await writeFile(path.join(directory, ".minemods", "making", `${begun.asset_id}.json`), "{ broken")
  expect(await readMaking(directory, begun.asset_id)).toBeNull()
  expect(await listMakings(directory)).toEqual([])
})

test("没有制作记录的旧工程照常打开、导出、导入；有记录的工程带着记录和图一起走", async () => {
  const old = await project()
  expect(await readMaking(old.directory, start().asset_id)).toBeNull()
  expect(await listMakings(old.directory)).toEqual([])
  const plain = path.join(old.root, "old.minemods")
  await exportProjectArchive({ directory: old.directory, destination: plain })
  expect(Object.keys(unzipSync(await Bun.file(plain).bytes())).filter((name) => name.includes("making"))).toEqual([])
  await importProjectArchive({ archive: plain, destination: path.join(old.root, "old-imported") })
  expect((await openProject(path.join(old.root, "old-imported"))).id).toBe(old.created.id)

  const made = await project()
  const files = await writePictures(made.directory, start().asset_id, 1, [{ label: "六个角度", url: PIXEL }])
  // What was drawn for the reviewer and the round's small cover are pictures of the record too, and travel with it.
  const set = await writePictures(made.directory, start().asset_id, 1, [{ label: "六个角度", url: PIXEL }, { label: "走路（walk）· 斜前方", url: PIXEL }], "r")
  const cover = await writePictures(made.directory, start().asset_id, 1, [{ label: "封面", url: PIXEL }], "c")
  const record = await changeMaking(made.directory, start().asset_id, () =>
    finish(finalReview(reviewShown(selfReview(looked(describe(start(), sheet), { fingerprint: version("a"), pictures: files, findings: [], cover: cover[0]!.file }), done), set), { passed: true, findings: [], advice: ["都对上了"], independent: true })),
  )
  // A sheet a person wrote for something that was never made by looking travels the same way.
  const lone = await changeMaking(made.directory, "44444444-4444-4444-8444-444444444444", () => sheetOnly({ asset_id: "44444444-4444-4444-8444-444444444444", entry: null, kind: "texture", request: "一张石头贴图", brief: "一张石头贴图" }, { ...sheet, remark: null }))
  expect(lone).toMatchObject({ state: "done", described: false, task_id: null, rounds: [] })
  const archive = path.join(made.root, "made.minemods")
  await exportProjectArchive({ directory: made.directory, destination: archive })
  const entries = unzipSync(await Bun.file(archive).bytes())
  expect(Object.keys(entries).filter((name) => name.startsWith(".minemods/making/")).sort()).toEqual(
    [`.minemods/making/${record.asset_id}.json`, ...[...files, ...set, ...cover].map((picture) => `.minemods/making/${record.asset_id}/${picture.file}`), `.minemods/making/${lone.asset_id}.json`].sort(),
  )
  const destination = path.join(made.root, "made-imported")
  await importProjectArchive({ archive, destination })
  expect(await readMaking(destination, record.asset_id)).toEqual(record)
  // A reviewed round shows the reviewer's set, which is the whole one; the maker's own look of the same name is not repeated.
  expect((await shownMaking(destination, record)).rounds[0]).toMatchObject({ pictures: [{ label: "六个角度", url: PIXEL, from: "review" }, { label: "走路（walk）· 斜前方", url: PIXEL, from: "review" }], cover: PIXEL })
  expect(stop(record)).toBe(record)

  // An archive may not smuggle anything else in under the making folder.
  expect(() => archivedMakingPaths({ [`.minemods/making/${record.asset_id}.json`]: strToU8(JSON.stringify(record)), [`.minemods/making/${record.asset_id}/evil.sh`]: strToU8("x") })).toThrow()
  expect(() => archivedMakingPaths({ [`.minemods/making/${lone.asset_id}.json`]: strToU8(JSON.stringify(record)) })).toThrow()
  const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as { entries: { path: string; bytes: number; sha256: string }[] }
  const stray = strToU8("x")
  const tampered = path.join(made.root, "tampered.minemods")
  await writeFile(tampered, zipSync({ ...entries, ".minemods/making/readme.txt": stray, "manifest.json": strToU8(JSON.stringify({ ...manifest, entries: [...manifest.entries, { path: ".minemods/making/readme.txt", bytes: 1, sha256: createHash("sha256").update(stray).digest("hex") }] })) }))
  await expect(importProjectArchive({ archive: tampered, destination: path.join(made.root, "tampered-imported") })).rejects.toThrow("制作记录")
  expect(MakingRecordSchema.safeParse({ ...record, extra: true }).success).toBe(false)
})

const SPECIMENS = {
  // What the two reviewers of the first real run wrote, sorted by the line in FINDING_LINE.
  advice: ["表情还不够凶", "走路缺少重心转移", "呼吸的起伏太不明显"],
  // Not a finding at all: behaviour is not what a model's review is of.
  outside: ["这些图里看不出它在守着矿石"],
  // Not a finding either: the tail was behind the body in that camera angle. It is something to ask to be shown.
  unseen: ["受伤动作里尾巴被身体挡住，无法确认"],
}

test("问题分两种：只有必须改的会挡住自评和验收，可以更好的留着也能交", () => {
  const first = seen(describe(start(), sheet), "a")
  // Polish left over does not stand in the way of "done"; a blocking problem does.
  const finished = selfReview(first, { ...done, advice: SPECIMENS.advice })
  expect(finished).toMatchObject({ state: "reviewing", rounds: [{ self_review: { verdict: "done", problems: [], advice: SPECIMENS.advice } }] })
  expect(refused(() => selfReview(first, { ...done, problems: ["说明里写的尾巴在哪张图上都找不到"], advice: SPECIMENS.advice }))?.words).toBe(REFUSALS.done_with_problems)
  // The same for the reviewer: every one of those remarks as advice, and the review passes.
  const passed = finalReview(finished, { passed: true, findings: [], advice: SPECIMENS.advice, independent: true })
  expect(passed.review).toMatchObject({ passed: true, findings: [], advice: SPECIMENS.advice })
  expect(commitGate(passed, version("a"))).toBeNull()
  // A verdict has to agree with its own lists: failing needs a blocking finding, passing may not carry one.
  expect(refused(() => finalReview(finished, { passed: false, findings: [], advice: SPECIMENS.advice, independent: true }))?.words).toBe(REFUSALS.failed_without_findings)
  expect(refused(() => finalReview(finished, { passed: true, findings: ["胸口的矿石悬在半空，没有接在身体上"], independent: true }))?.words).toBe(REFUSALS.passed_with_findings)
  expect(finalReview(finished, { passed: false, findings: ["胸口的矿石悬在半空，没有接在身体上"], advice: SPECIMENS.advice, independent: true })).toMatchObject({ state: "making", review: { passed: false } })
})

test("第一次真跑里两位评审写的那几句话，按现在这条线各归各位", () => {
  const scope = reviewScope("model", "蓝晶兽", ["蓝图里写明这次不做「剑的技能」：剑现在只能是普通物品，做不了技能。"])
  // "The pictures do not show it guarding ore": guarding is behaviour, and behaviour is named as outside a model's review.
  expect(SPECIMENS.outside[0]).toContain("守着")
  expect(scope.judging).toBe("「蓝晶兽」——这个模型的外观和它自带的动作：形状、比例、每一个部件、表面，以及每一个动作放出来的样子。")
  expect(scope.judging).not.toMatch(/行为|守|攻击|掉落/)
  expect(scope.not_judged[0]).toMatch(/行为.*守着什么/)
  expect(scope.not_judged.at(-1)).toBe("蓝图里写明这次不做「剑的技能」：剑现在只能是普通物品，做不了技能。")
  expect(FINDING_LINE).toContain("它在游戏里的行为、别的资产、写明这次不做的）不写进任何一栏")
  // "The tail is hidden in the hurt motion, cannot be confirmed": not seen is something to ask for, never a blocking finding.
  expect(SPECIMENS.unseen[0]).toMatch(/挡住.*无法确认/)
  expect(FINDING_LINE).toContain("图上没拍到、被挡住、看不清的，不是毛病，“看不到”本身永远不能算必须改的")
  expect(ReviewNeedsSchema.safeParse([{ what: "motion", name: "hurt" }]).success).toBe(true)
  expect(REVIEWER_INSTRUCTIONS).toContain("要过以后还是看不到的，写进 advice 说明哪里没看到，不能写进 findings")
  // "Not ferocious enough", "no weight transfer", "breathing too subtle": the thing is right and could be better. Each has
  // its like among the contrasts, on the advice side, with the fault of the same kind that would block beside it.
  expect(FINDING_CONTRASTS.map((value) => value.advice)).toEqual(expect.arrayContaining(["认得出来，只是神态、气势还不够", "动了，也看得出是什么动作，只是幅度偏小、重心变化不明显"]))
  expect(FINDING_CONTRASTS.find((value) => value.advice.includes("重心"))!.blocking).toBe("一个动作从头放到尾，没有任何部位在动")
  expect(FINDING_LINE).toContain("更有神、更有分量、更细、更明显")
  // Four kinds of fault block and no others; one finding of the other kind never fails a review.
  expect(FINDING_LINE.match(/[①②③④⑤]/g)).toEqual(["①", "②", "③", "④"])
  expect(REVIEWER_INSTRUCTIONS).toContain("advice 再多也不影响通过")
})

test("看不到不等于没做到：评审可以要求补看，次数有上限，之后必须给结论", () => {
  const finished = selfReview(seen(describe(start(), sheet), "a"), done)
  const set = Array.from({ length: MAKING_LIMITS.review_sheets + 2 }, (_, index) => ({ label: `图 ${index}`, file: `1r-a-${index}.jpg` }))
  const shown = reviewShown(finished, set)
  // The set is bounded.
  expect(shown.rounds[0]!.review_pictures).toHaveLength(MAKING_LIMITS.review_sheets)
  const asked = Array.from({ length: MAKING_LIMITS.needs }).reduce<MakingRecord>((current, _, index) => reviewAsked(current, [{ label: `受伤（hurt）· 斜后方和左侧 ${index}`, file: `1n-a-${index}.jpg` }]), shown)
  expect(asked.rounds[0]).toMatchObject({ asked: MAKING_LIMITS.needs })
  expect(asked.rounds[0]!.review_pictures!.filter((picture) => picture.asked)).toHaveLength(MAKING_LIMITS.needs)
  // No more: now a verdict is due, and what still was not seen is not a blocking finding.
  expect(refused(() => needGate(asked))).toEqual({ words: REFUSALS.no_more_needs, final: false })
  expect(REFUSALS.no_more_needs).toContain("“看不到”不能当成必须改的问题")
  // Drawing the set again keeps what was asked for.
  expect(reviewShown(asked, set).rounds[0]!.review_pictures!.filter((picture) => picture.asked)).toHaveLength(MAKING_LIMITS.needs)
  // Nothing can be asked for before the maker called the version finished, nor after the review has concluded.
  expect(refused(() => needGate(seen(describe(start(), sheet), "a")))?.words).toBe(REFUSALS.no_self_review(1))
  expect(refused(() => needGate(finalReview(asked, { passed: true, findings: [], advice: SPECIMENS.unseen, independent: true })))?.words).toBe(REFUSALS.concluded)
})

test("做出来的不会白丢：留下的是看过的、没有硬伤的最新一版，并写明 AI 为什么还不满意", async () => {
  const described = describe(start(), sheet)
  // Version 1 is clean; version 2 has a hard fault: the best is still version 1.
  const first = selfReview(seen(described, "a"), { ...revise, advice: ["走路缺少重心转移"] })
  expect(first.best).toEqual({ round: 1, fingerprint: version("a") })
  const second = selfReview(seen(first, "b", ["认得出：正面找不到一双眼睛。"]), revise)
  expect(second.best).toEqual({ round: 1, fingerprint: version("a") })
  expect(unsatisfied(second, "做不下去了：模型一直改不好脸。")).toEqual([
    "停下的原因：做不下去了：模型一直改不好脸。",
    "它自己认为必须改：正面看不出脸",
    "它自己认为可以更好：走路缺少重心转移",
    "交给你的是第 1 版：后面的版本有量得出来的硬伤，没有留。",
  ])
  const kept = keep(second, unsatisfied(second, null))
  expect(kept).toMatchObject({ state: "done", outcome: "kept_unsatisfied", kept_round: 1, kept_reason: ["它自己认为必须改：正面看不出脸", "它自己认为可以更好：走路缺少重心转移", "交给你的是第 1 版：后面的版本有量得出来的硬伤，没有留。"] })
  // The reviewer's lists are the reason when it was the review of that very version that failed.
  const failed = finalReview(selfReview(seen(described, "a"), done), { passed: false, findings: ["背上的晶刺和说明里写的三根不一样，只有一根"], advice: SPECIMENS.advice.slice(0, 1), independent: true })
  expect(unsatisfied(failed, null)).toEqual(["评审认为必须改：背上的晶刺和说明里写的三根不一样，只有一根", "评审认为可以更好：表情还不够凶"])
  // Nothing clean was ever looked at: there is nothing to keep, and ending it is a failure as before.
  const faulty = selfReview(seen(described, "a", ["认得出：正面找不到一双眼睛。"]), revise)
  expect(faulty.best).toBeUndefined()
  expect(stop(faulty)).toMatchObject({ state: "stopped", outcome: "failed" })
  expect(stop(faulty, false).outcome).toBeUndefined()

  // The best version's document is kept beside the record, and only answers for the task and the version it is of.
  const { directory } = await project()
  const record = await changeMaking(directory, start().asset_id, () => second)
  await writeBest(directory, record.asset_id, { task_id: task, fingerprint: version("a"), document: { kind: "model", name: "a" } })
  expect(await readBest(directory, record)).toEqual({ kind: "model", name: "a" })
  expect(await readBest(directory, { ...record, task_id: "33333333-3333-4333-8333-333333333333" })).toBeNull()
  expect(await readBest(directory, { ...record, best: { round: 2, fingerprint: version("b") } })).toBeNull()
  // It is not a record and not a picture: listing and export leave it alone.
  expect((await listMakings(directory)).map((value) => value.asset_id)).toEqual([record.asset_id])
  const shown = await shownMaking(directory, kept)
  expect(shown).toMatchObject({ outcome: "kept_unsatisfied", kept_round: 1, kept_reason: kept.kept_reason })
})

test("看不出来在动的动作要有个交代：改到看得出来，或者在部件说明里声明本来就不动；这一版照样是留给人的那一版", async () => {
  const { directory } = await project()
  const still = { name: "idle", travel: 0.1, mover: "head", cube: "skull", between: [0, 1] as [number, number], moving: 1, parts: 2, turn: 0.6, game: 0.6, picture: 1.1, tall: 26, unseen: true }
  const described = describe(start(), sheet)
  const shown = looked(described, { fingerprint: version("a"), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: [], motion: [still, { ...still, name: "walk", travel: 6, game: 36, unseen: false }] })
  // Not a hard fault: the round holds none and the version is the best so far.
  expect(shown).toMatchObject({ best: { round: 1 }, rounds: [{ findings: [], motion: [{ name: "idle" }, { name: "walk" }] }] })
  const told = unseenMotions(shown.sheet, shown.rounds[0]!.motion)
  expect(told).toEqual([expect.stringContaining("不机械：待机（idle）看不出来在动")])
  expect(refused(() => selfReview(shown, done))).toEqual({ words: REFUSALS.done_with_unseen_motion(told), final: false })
  expect(selfReview(shown, revise).state).toBe("making")
  // Kept without being answered, the person is told what was measured.
  expect(unsatisfied(shown, null)).toEqual([expect.stringMatching(/^量出来的：不机械：待机（idle）看不出来在动（.+）。$/)])
  // Declared still in the sheet, with a reason: the same version may be called finished, and everyone is shown the declaration.
  const declared = describe(shown, { ...sheet, still: [{ motion: "idle", reason: "石像，站着就不该动" }] })
  expect(selfReview(declared, done).state).toBe("reviewing")
  expect((await shownMaking(directory, declared)).rounds[0]!.motion).toEqual([
    { ...still, still: "石像，站着就不该动", plain: "待机：看不出来在动——部件说明里写了这个动作本来就不动：石像，站着就不该动", line: expect.stringContaining("所以不算毛病。") },
    expect.objectContaining({ name: "walk", still: null, plain: "走路：看得出在动，动得最多的是「head」。" }),
  ])
  // A sheet that declares nothing is stored as sheets always were, and the person's edit keeps what the AI declared.
  expect("still" in describe(start(), { ...sheet, still: [] }).sheet!).toBe(false)
  expect(edit(declared, { ...declared.sheet!, subject: "一尊石像" }).sheet!.still).toEqual([{ motion: "idle", reason: "石像，站着就不该动" }])
})

test("贴图量出来落在原版范围以外，也要有个交代：改回来，或者在部件说明里写明本来就该不一样；没有对照就什么都不变", async () => {
  const { directory } = await project()
  // Numbers as round 6's ore had them: one figure of 12% of the picture where the game's own have up to ten small ones.
  const world = { names: ["stone", "coal_ore"], colours: [4, 14] as [number, number], flat: [0.016, 0.035] as [number, number], contrast: [39, 155] as [number, number], busy: [0.6, 0.83] as [number, number], peak: [0, 0.87] as [number, number], opaque: [1, 1] as [number, number], like: null, seam: [0.31, 1.14] as [number, number], motif: [0, 0.074] as [number, number], marks: [0, 10] as [number, number] }
  const texture = { width: 16, height: 16, opaque: 1, colours: 9, top: 0.36, flat: 0.03, contrast: 130, busy: 0.7, step: 12.8, seam: 0.85, vivid: 0.055, peak: 0.675, motif: 0.117, marks: 1, like: null, inside: null, world, copy: null }
  const block = () => describe({ ...start(), kind: "block" }, sheet)
  const shown = looked(block(), { fingerprint: version("a"), pictures: [{ label: "方块的贴图", file: "1-a-0.jpg" }], findings: [], texture })
  // Not a hard fault: the version is the best so far and is what the person would be handed.
  expect(shown).toMatchObject({ best: { round: 1 }, rounds: [{ findings: [] }] })
  const told = outsideFindings("block", shown.sheet, texture)
  expect(told).toEqual([expect.stringContaining("不机械：这张贴图上显眼的图案有 1 处，最大的一处占整张图的 12%")])
  expect(refused(() => selfReview(shown, done))).toEqual({ words: REFUSALS.done_outside_world(told), final: false })
  expect(selfReview(shown, revise).state).toBe("making")
  expect(unsatisfied(shown, null)).toEqual([expect.stringMatching(/^量出来的：不机械：这张贴图上显眼的图案有 1 处.+比原版的重复显眼一截。$/)])
  // Declared in the sheet with a reason: the same version may be called finished, and the person reads the reason.
  const declared = describe(shown, { ...sheet, differs: [{ measure: "motif", reason: "每块都刻着同一个符文，是有意的" }] })
  expect(selfReview(declared, done).state).toBe("reviewing")
  expect((await shownMaking(directory, declared)).rounds[0]!.texture!.plain.at(-1)).toContain("AI 说它本来就该和原版不一样：每块都刻着同一个符文，是有意的")
  expect("differs" in describe(block(), { ...sheet, differs: [] }).sheet!).toBe(false)
  expect(edit(declared, { ...declared.sheet!, subject: "一块符文砖" }).sheet!.differs).toEqual([{ measure: "motif", reason: "每块都刻着同一个符文，是有意的" }])
  // The same picture with nothing to compare with, and a record from before repetition was measured: nothing is asked.
  expect(selfReview(looked(block(), { fingerprint: version("a"), pictures: [{ label: "方块的贴图", file: "1-a-0.jpg" }], findings: [], texture: { ...texture, world: null } }), done).state).toBe("reviewing")
  const { motif: _motif, marks: _marks, ...before } = texture
  expect(selfReview(looked(block(), { fingerprint: version("a"), pictures: [{ label: "方块的贴图", file: "1-a-0.jpg" }], findings: [], texture: { ...before, world: { ...world, motif: undefined, marks: undefined, seam: undefined } } }), done).state).toBe("reviewing")
})

test("旧记录照常读：没有两种问题、没有封面、没有验收用的图，也不知道结局", async () => {
  const { directory } = await project()
  const old = {
    schema_version: 1,
    asset_id: start().asset_id,
    entry: "guardian_model",
    kind: "model",
    request: "一只守着矿石的敌对生物",
    brief: "洞穴守卫的模型",
    task_id: task,
    sheet: { ...sheet, remark: null },
    described: true,
    remark: null,
    rounds: [{ round: 1, at: "2026-10-05T00:00:00.000Z", fingerprint: version("a"), pictures: [], self_review: done, findings: [] }],
    review: { independent: true, passed: true, findings: ["六个角度都和说明一致"], at: "2026-10-05T00:01:00.000Z", fingerprint: version("a") },
    state: "done",
    rounds_allowed: 6,
    updated_at: "2026-10-05T00:01:00.000Z",
  }
  const record = MakingRecordSchema.parse(old)
  expect(record).toEqual(old as MakingRecord)
  const shown = await shownMaking(directory, record)
  // A passing review from before the split keeps its words where they were; nothing is invented for what it lacks.
  expect(shown.review).toEqual({ independent: true, passed: true, findings: ["六个角度都和说明一致"], at: "2026-10-05T00:01:00.000Z", round: 1 })
  expect(shown.rounds[0]).toEqual({ round: 1, at: "2026-10-05T00:00:00.000Z", pictures: [], self_review: done, findings: [] })
  expect("outcome" in shown || "kept_reason" in shown).toBe(false)
  // And it can still be handed in or carried on by the rules as they are now.
  expect(commitGate(record, version("a"))).toBeNull()
})

test("连起来看量出毛病的动作也要有个交代：改掉，或者在部件说明的 justified 里写明理由；这一版照样是留给人的那一版", async () => {
  const { directory } = await project()
  // A loop whose last moment is two model pixels off its first: measured tick by tick, shown on no still frame.
  const continuity = { seam: 2, seam_part: "head", step: 0.4, step_at: 0.5, step_part: "head", typical: 0.4, hovering: false, sink: 0, gap: 0, walk: null, cross: null, balance: null, movers: 2, together: 2, faults: ["seam" as const] }
  const idle = { name: "idle", travel: 6, mover: "head", cube: "skull", between: [0, 1] as [number, number], moving: 2, parts: 2, turn: 20, game: 36, picture: 40, tall: 26, unseen: false, continuity }
  const shown = looked(describe(start(), sheet), { fingerprint: version("a"), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: [], motion: [idle] })
  // Not a hard fault: the version is the best so far.
  expect(shown).toMatchObject({ best: { round: 1 }, rounds: [{ findings: [], motion: [{ continuity: { faults: ["seam"] } }] }] })
  const told = continuityFindings(shown.sheet, shown.rounds[0]!.motion)
  expect(told).toEqual([expect.stringContaining("站得住：待机（idle）循环接不上，会跳一下（最后一刻和第一刻的姿势差着 2 个模型像素")])
  expect(refused(() => selfReview(shown, done))).toEqual({ words: REFUSALS.done_with_motion_faults(told), final: false })
  expect(selfReview(shown, revise).state).toBe("making")
  expect(unsatisfied(shown, null)).toEqual([expect.stringMatching(/^量出来的：站得住：待机（idle）循环接不上，会跳一下（.+）。$/)])
  // Justified in the sheet: the same version may be called finished, and the person is shown the reason beside the fact.
  const justified = describe(shown, { ...sheet, justified: [{ what: "idle:seam", reason: "它每隔一会儿就抽搐一下" }] })
  expect(selfReview(justified, done).state).toBe("reviewing")
  expect((await shownMaking(directory, justified)).rounds[0]!.motion![0]!.held).toEqual({ plain: ["待机：循环接不上，会跳一下——部件说明里写了本来就该这样：它每隔一会儿就抽搐一下", "待机：2 个会动的部件全部同时动，没有先后。"], line: expect.stringContaining("——循环接不上，会跳一下（部件说明里写了本来就该这样：它每隔一会儿就抽搐一下）") })
  // A sheet that justifies nothing is stored as sheets always were; the person's edit keeps what the AI wrote; a round from before has no such sentence.
  expect("justified" in describe(start(), { ...sheet, justified: [] }).sheet!).toBe(false)
  expect(edit(justified, { ...justified.sheet!, subject: "一尊石像" }).sheet!.justified).toEqual([{ what: "idle:seam", reason: "它每隔一会儿就抽搐一下" }])
  const { continuity: _none, ...old } = idle
  expect("held" in (await shownMaking(directory, looked(describe(start(), sheet), { fingerprint: version("b"), pictures: [{ label: "六个角度", file: "1-b-0.jpg" }], findings: [], motion: [old] }))).rounds[0]!.motion![0]!).toBe(false)
})

// ---- round 10 ----


test("硬门槛：移动时整个平移的版本，写了理由也不能说做完；它照样留着，版数用完时带着这条原因交给人", () => {
  // A walk in which two parts stand on the ground and neither is ever seen to go back along it.
  const continuity = { seam: 0, seam_part: null, step: 0.4, step_at: 0.5, step_part: "body", typical: 0.4, hovering: false, sink: 0, gap: 0, walk: { supports: 2, speed: 0, declared: null, slide: 0, slider: null, stride: 0, drag: 0, skates: false, glides: true }, cross: null, balance: null, movers: 2, together: 2, faults: ["glide" as const] }
  const walk = { name: "walk", travel: 6, mover: "body", cube: "trunk", between: [0, 1] as [number, number], moving: 2, parts: 3, turn: 6, game: 36, picture: 40, tall: 50, unseen: false, continuity }
  const reasoned = { ...sheet, justified: [{ what: "walk:glide", reason: "它就是滑着走的" }] }
  const shown = looked(describe(start(), reasoned), { fingerprint: version("a"), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: [], motion: [walk] })
  // Not one of the standard's hard faults: this version is kept as the best so far.
  expect(shown).toMatchObject({ best: { round: 1 }, rounds: [{ findings: [] }] })
  const told = continuityFindings(shown.sheet, shown.rounds[0]!.motion)
  expect(told).toEqual([expect.stringContaining("走路（walk）移动时整个在地上平移，没有任何部件往后蹬")])
  expect(told[0]).toContain("硬门槛：只能改掉，写理由不算")
  // The reason in the sheet is not read: finished it is not, revised it may be.
  expect(refused(() => selfReview(shown, done))).toEqual({ words: REFUSALS.done_with_motion_faults(told), final: false })
  expect(selfReview(shown, revise).state).toBe("making")
  // When the making ends without a pass, this is the reason the person is given with the kept version.
  expect(unsatisfied(shown, null)).toEqual([expect.stringMatching(/^量出来的：站得住：走路（walk）移动时整个在地上平移，没有任何部件往后蹬（.+）。$/)])
})

test("有招式的生物不写部件说明也走完整个流程：看 → 自评 → 独立验收 → 提交；量出来对不上的要改掉才能说做完", async () => {
  // The kind is looked at only when a version has abilities; the kinds made from a sheet are what they were.
  expect(LOOKED_KINDS).not.toContain("entity")
  expect(isSheetless("entity")).toBe(true)
  expect(looksAt({ kind: "entity", abilities: [{}] })).toBe(true)
  expect(looksAt({ kind: "entity", abilities: [] })).toBe(false)
  expect(looksAt({ kind: "entity" })).toBe(false)
  expect(looksAt({ kind: "model" })).toBe(true)
  expect(looksAt({ kind: "recipe" })).toBe(false)
  const creature = begin(null, { asset_id: "22222222-2222-4222-8222-222222222222", entry: "guardian", kind: "entity", request: "一只守着矿石的敌对生物", brief: "洞穴守卫", task_id: task, remark: null, sheetless: true })
  expect(creature).toMatchObject({ sheetless: true, sheet: null, described: false, state: "describing" })
  // A record made from a sheet is stored as it always was, without the field.
  expect("sheetless" in start()).toBe(false)
  // No sheet is asked for and none is taken.
  expect(refused(() => describe(creature, sheet))).toEqual({ words: REFUSALS.no_sheet_wanted, final: false })
  expect(lookGate(creature, version("a"))).toEqual({ opens: true, skipped: null })
  expect(commitGate(creature, version("a"))).toBe(REFUSALS.no_look)
  const off = "对不上：动作朝判定范围挥过去的那一下在第 0.7 秒才到位，伤害却在第 0.3 秒就算了。"
  const first = looked(creature, { fingerprint: version("a"), pictures: [{ label: "招式", file: "1-a-0.jpg" }], findings: [], measured: [off] })
  // Not a hard fault of the standard: the version is the best so far. But it has to be answered before "done".
  expect(first).toMatchObject({ best: { round: 1 }, state: "making", rounds: [{ findings: [], measured: [off] }] })
  expect(refused(() => selfReview(first, done))).toEqual({ words: REFUSALS.done_with_measured([off]), final: false })
  // Another look at the same version that drew only part of it does not make what was measured on the rest go away.
  expect(looked(first, { fingerprint: version("a"), pictures: [{ label: "招式", file: "1-a-1.jpg" }], findings: [] }).rounds[0]!.measured).toEqual([off])
  expect(unsatisfied(first, null)).toEqual([`量出来的：${off}`])
  const second = looked(selfReview(first, revise), { fingerprint: version("b"), pictures: [{ label: "招式", file: "2-a-0.jpg" }], findings: [] })
  expect("measured" in second.rounds[1]!).toBe(false)
  const judged = selfReview(second, done)
  expect(judged.state).toBe("reviewing")
  expect(commitGate(judged, version("b"))).toBe(REFUSALS.no_review)
  // The reviewer's "not passed" is recorded like any other, and the version stays the one kept for the person.
  const failed = finalReview(judged, { passed: false, findings: ["效果和判定范围在目标高处时对不上"], independent: true })
  expect(commitGate(failed, version("b"))).toBe(REFUSALS.review_failed)
  expect(unsatisfied(failed, "做不下去了")).toEqual(["停下的原因：做不下去了", "评审认为必须改：效果和判定范围在目标高处时对不上"])
  expect(keep(failed, unsatisfied(failed, null))).toMatchObject({ outcome: "kept_unsatisfied", kept_round: 2, sheet: null })
  const third = selfReview(looked(failed, { fingerprint: version("c"), pictures: [{ label: "招式", file: "3-a-0.jpg" }], findings: [] }), done)
  expect(commitGate(finalReview(third, { passed: true, findings: [], independent: true }), version("c"))).toBeNull()
  // It is shown like every other making; what was measured is listed with what its maker was told to change.
  const { directory } = await project()
  expect((await shownMaking(directory, first)).rounds[0]!.findings).toEqual([off])
  expect(MakingRecordSchema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first)
})

test("选了高一档没用上，也要有个交代才能说做完：改回去、用上，或者在部件说明里写明理由", () => {
  const unused = { tier: "fine" as const, cubes: 46, bones: 11, texture: 512, animations: 6, keys: 37, total_keys: 331, texture_needed: 256 }
  const asked = { ...sheet, budget: { tier: "fine", reason: "分层的石头表面", at_once: 1 } }
  const shown = looked(describe(start(), asked), { fingerprint: version("a"), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: [], budget: unused })
  expect(shown).toMatchObject({ best: { round: 1 }, rounds: [{ findings: [], budget: unused }] })
  const told = tierFindings(shown.sheet, unused)
  expect(told).toHaveLength(1)
  expect(refused(() => selfReview(shown, done))).toEqual({ words: REFUSALS.done_with_measured(told), final: false })
  expect(unsatisfied(shown, null)).toEqual([expect.stringMatching(/^量出来的：几何预算：选了「精细」档.+没有用上。$/)])
  // Answered in the sheet, the same version may be called finished.
  expect(selfReview(describe(shown, { ...asked, justified: [{ what: "budget:unused", reason: "下一版加满碎石" }] }), done).state).toBe("reviewing")
  // A model that uses its tier, or names none, is asked nothing.
  expect(selfReview(looked(describe(start(), asked), { fingerprint: version("b"), pictures: [{ label: "六个角度", file: "1-a-0.jpg" }], findings: [], budget: { ...unused, cubes: 300 } }), done).state).toBe("reviewing")
})

test("存不进工程是一次拒绝，不是任务失败：同一句话看图时就说，提交时再说；次数算在验收标准的上限里", () => {
  expect(saveable(() => 7)).toEqual({ ok: true, made: 7 })
  const refusedSave = saveable(() => {
    throw new Error("动作 slam 里骨骼 arm 的转动轨道导出给游戏时太长了。")
  })
  if (refusedSave.ok) throw new Error("expected a refusal")
  expect(refusedSave.refusal).toBeInstanceOf(SaveRefusal)
  expect(refusedSave.refusal).toBeInstanceOf(MakingRefusal)
  expect(refusedSave.refusal.final).toBe(false)
  expect(refusedSave.refusal.message).toBe(REFUSALS.unsaveable("动作 slam 里骨骼 arm 的转动轨道导出给游戏时太长了。"))
  expect(refusedSave.refusal.message).toBe("这一版照现在的样子存不进工程，提交会被拒绝：动作 slam 里骨骼 arm 的转动轨道导出给游戏时太长了。改掉以后再看一版。")
  // A schema's refusal is said by where and what, as a hand-in always said it.
  const schema = saveable(() => z.strictObject({ keys: z.array(z.number()).max(1) }).parse({ keys: [1, 2] }))
  expect(schema.ok ? "" : schema.refusal.message).toMatch(/^这一版照现在的样子存不进工程，提交会被拒绝：keys: .+。改掉以后再看一版。$/)
  expect(saveVerdict(refusedSave.refusal, 1)).toEqual({ final: false, text: `${refusedSave.refusal.message}任务保持运行，工程里什么都没有改动（还可以再交 3 次）。` })
  expect(saveVerdict(refusedSave.refusal, 4)).toEqual({ final: true, text: `${refusedSave.refusal.message}这个任务已经被退回 4 次。` })
})

// Round 18: a crafting material nobody could name from sixteen pixels failed six versions. What is held to the picture follows from the thing.
test("盲认分三种：一眼叫得出、知道名字就看得出、对不上；只有对不上是硬门槛，知道名字才看得出的照样通过并由 Studio 记一句；旧的 recognised 照旧算数", async () => {
  const icon = () => selfReview(seen(describe(begin(null, { asset_id: "22222222-2222-4222-8222-222222222222", entry: "shell", kind: "item", request: "打倒它会掉甲壳", brief: "甲壳的图标", task_id: task, remark: null }), sheet), "a"), done)
  expect([...BLIND_FITS]).toEqual(["at_once", "with_name", "no"])
  expect([blindFit({ recognised: true }), blindFit({ recognised: false }), blindFit({}), blindFit({ fits: "with_name", recognised: false })]).toEqual(["at_once", "no", undefined, "with_name"])
  const pebble = { sees: "一块鹅卵石", also: ["贝壳"], because: "一块椭圆的浅黄色，上面有几道横纹" }
  const named = blindAnswered(icon(), pebble)
  // Not nameable by a stranger, and plainly the thing once its name is known: it passes, and Studio says what it was called, as advice.
  const fitted = finalReview(named, { passed: true, findings: [], advice: ["横纹在小一号的格子里有点糊"], independent: true, fits: "with_name", named: "砂岩甲壳" })
  expect(fitted).toMatchObject({ state: "reviewing", review: { passed: true, findings: [], blind: { said: "一块鹅卵石", recognised: true, fits: "with_name", named: "砂岩甲壳" } } })
  expect(fitted.review!.advice).toEqual([blindAdvice("砂岩甲壳", pebble), "横纹在小一号的格子里有点糊"])
  expect(commitGate(fitted, version("a"))).toBeNull()
  const { directory } = await project()
  const words = "盲认：只给图、不说这是什么，评审说它是「一块鹅卵石」（还可能是「贝壳」）；告诉它名字以后，它说看得出是「砂岩甲壳」，不会被当成别的。"
  expect((await shownMaking(directory, fitted)).review!.blind).toEqual({ tested: true, said: "一块鹅卵石", also: ["贝壳"], because: pebble.because, recognised: true, fits: "with_name", words })
  expect(blindAdvice("砂岩甲壳", pebble)).toStartWith(words)
  expect(blindAdvice("砂岩甲壳", pebble)).toContain("不影响通过")
  // The picture reads better as the other thing: the gate, whatever `passed` says, in either way of saying it.
  const coin = blindAnswered(icon(), { sees: "金色硬币", also: [], because: "一个金黄色的圆片" })
  const taken = finalReview(coin, { passed: true, findings: [], independent: true, fits: "no", named: "砂岩甲壳" })
  expect(taken).toMatchObject({ state: "making", review: { passed: false, blind: { recognised: false, fits: "no" } } })
  expect(taken.review!.findings).toEqual([blindFinding("砂岩甲壳", { sees: "金色硬币", also: [], because: "一个金黄色的圆片" })])
  expect(finalReview(coin, { passed: true, findings: [], independent: true, recognised: false, named: "砂岩甲壳" }).review).toMatchObject({ passed: false, blind: { recognised: false, fits: "no" } })
  expect(finalReview(coin, { passed: true, findings: [], independent: true, recognised: true, named: "砂岩甲壳" }).review).toMatchObject({ passed: true, blind: { recognised: true, fits: "at_once" } })
  // `fits` is the newer word and wins over a `recognised` sent beside it.
  expect(finalReview(coin, { passed: true, findings: [], independent: true, fits: "no", recognised: true, named: "砂岩甲壳" }).review!.passed).toBe(false)
  // Named at once: nothing is added to the advice.
  expect(finalReview(named, { passed: true, findings: [], advice: [], independent: true, fits: "at_once", named: "砂岩甲壳" }).review!.advice).toEqual([])
  // A record from before the three were told apart holds `recognised` alone, and reads as it did.
  const old = MakingRecordSchema.parse({ ...JSON.parse(JSON.stringify(fitted)), review: { ...fitted.review!, blind: (({ fits: _fits, ...blind }) => blind)(fitted.review!.blind!) } })
  expect((await shownMaking(directory, old)).review!.blind).toEqual({ tested: true, said: "一块鹅卵石", also: ["贝壳"], because: pebble.because, recognised: true, words: "盲认：只给图、不说这是什么，评审说它是「一块鹅卵石」（还可能是「贝壳」）——认出来了，它是「砂岩甲壳」。" })
})

// Round 17: 「这个风暴镐是如何通过筛查的」. Blind naming: what a thing is said to be from its picture alone, before the reviewer is told anything.
test("盲认：只凭图说它是什么，说完才给名字；说成了别的是写理由也过不去的一条，照样留着最好的一版；审查关着就如实写未盲认", async () => {
  const icon = (previous: MakingRecord | null = null) => begin(previous, { asset_id: "22222222-2222-4222-8222-222222222222", entry: "storm_pick", kind: "item", request: "用掉落物合成一把镐", brief: "一把镐的图标", task_id: task, remark: null })
  // The scope: what a player has to recognise from a picture and nothing else. Stated, not a list of subjects.
  expect([...BLIND_KINDS]).toEqual(["item", "block"])
  expect(LOOKED_KINDS.filter(isBlindNamed)).toEqual(["block", "item"])
  const finished = selfReview(seen(describe(icon(), sheet), "a"), done)
  expect(blindDue(finished)).toBe(true)
  // A conclusion before the blind answer is refused: the order is the rule. So is an answer where none is asked.
  expect(refused(() => finalReview(finished, { passed: true, findings: [], independent: true, recognised: true }))).toEqual({ words: REFUSALS.no_blind, final: false })
  expect(refused(() => blindAnswered(selfReview(seen(describe(start(), sheet), "a"), done), { sees: "石像", also: [], because: "站着的石头人" }))).toEqual({ words: REFUSALS.blind_not_wanted, final: false })
  expect(blindDue(selfReview(seen(describe(start(), sheet), "a"), done))).toBe(false)
  const said = { sees: "钩子", also: ["镰刀"], because: "灰色的头只朝一边弯下去，下面是一根斜着的棕色柄" }
  const named = blindAnswered(finished, said)
  expect(named.rounds[0]!.blind).toMatchObject(said)
  expect(blindDue(named)).toBe(false)
  // Answered once: whoever has since been told cannot answer again. And the conclusion has to say whether that answer was the thing.
  expect(refused(() => blindAnswered(named, { ...said, sees: "镐" }))).toEqual({ words: REFUSALS.blind_answered, final: false })
  expect(refused(() => finalReview(named, { passed: true, findings: [], independent: true }))).toEqual({ words: REFUSALS.blind_unjudged, final: false })
  // A miss fails the review whatever the reviewer put in `passed`, and whatever the sheet says: there is no field of the sheet that answers it.
  const justified = describe(named, { ...sheet, justified: [{ what: "盲认", reason: "风格化的镐，故意只画一边" }], differs: [{ measure: "盲认", reason: "故意的" }] })
  const missed = finalReview(justified, { passed: true, findings: [], advice: ["头的另一边看不出来"], independent: true, recognised: false, named: "风暴镐" })
  expect(missed).toMatchObject({ state: "making", review: { passed: false, independent: true, advice: ["头的另一边看不出来"], blind: { said: "钩子", also: ["镰刀"], recognised: false, named: "风暴镐" } } })
  expect(missed.review!.findings).toEqual([blindFinding("风暴镐", said)])
  expect(missed.review!.findings[0]).toContain("认得出：盲认没有认出来——只给图、不说这是什么的时候，评审说它是「钩子」（还可能是「镰刀」），要做的是「风暴镐」")
  expect(missed.review!.findings[0]).toContain(BLIND_WORDS.gate)
  expect(commitGate(missed, version("a"))).toBe(REFUSALS.review_failed)
  expect(refused(() => finalReview(missed, { passed: true, findings: [], independent: true, recognised: true }))).toEqual({ words: REFUSALS.reviewed_and_failed, final: false })
  // Not a failed task: the version is still the best one, and when the versions run out it is kept for the person with this as the reason.
  expect(missed.best).toEqual({ round: 1, fingerprint: version("a") })
  expect(unsatisfied(missed, null)).toEqual([`评审认为必须改：${blindFinding("风暴镐", said)}`, "评审认为可以更好：头的另一边看不出来"])
  expect(keep(missed, unsatisfied(missed, null))).toMatchObject({ state: "done", outcome: "kept_unsatisfied" })
  // The next version is named afresh. Named for what it is (or the everyday word for its kind) it passes, and the record keeps what was said.
  const again = selfReview(seen(missed, "b"), done)
  expect(blindDue(again)).toBe(true)
  const passed = finalReview(blindAnswered(again, { sees: "镐", also: [], because: "两头尖的弧形头横在柄的顶上" }), { passed: true, findings: [], independent: true, recognised: true, named: "风暴镐" })
  expect(passed.review).toMatchObject({ passed: true, findings: [], blind: { said: "镐", recognised: true, named: "风暴镐" } })
  expect(commitGate(passed, version("b"))).toBeNull()
  // A blind answer that says it cannot tell is a miss in its own words.
  expect(blindFinding("风暴镐", { sees: BLIND_WORDS.lost, also: [], because: "一团灰色和一条棕色" })).toContain("评审说认不出它是什么，要做的是「风暴镐」")
  // 审查 off: nobody can be shown it without knowing. The conclusion is taken, and the record says it was not named blind; nothing is made up.
  const alone = finalReview(finished, { passed: true, findings: [], independent: false, unblinded: true })
  expect(alone.review).toMatchObject({ passed: true, independent: false, blind: null })
  const { directory } = await project()
  expect((await shownMaking(directory, alone)).review!.blind).toEqual({ tested: false, words: blindPlain(null) })
  expect(blindPlain(null)).toStartWith(`${BLIND_WORDS.untested}：「审查」关着`)
  expect((await shownMaking(directory, missed)).review!.blind).toEqual({ tested: true, said: "钩子", also: ["镰刀"], because: said.because, recognised: false, fits: "no", words: "盲认：只给图、不说这是什么，评审说它是「钩子」（还可能是「镰刀」）——没有认出它是「风暴镐」。" })
  expect((await shownMaking(directory, passed)).review!.blind!.words).toBe("盲认：只给图、不说这是什么，评审说它是「镐」——认出来了，它是「风暴镐」。")
  // A kind that is not named blind, and every record from before: no such field, and nothing asked.
  const model = finalReview(selfReview(seen(describe(start(), sheet), "a"), done), { passed: true, findings: [], independent: true })
  expect("blind" in model.review!).toBe(false)
  const old = MakingRecordSchema.parse({ ...JSON.parse(JSON.stringify(passed)), rounds: passed.rounds.map(({ blind: _blind, ...round }) => round), review: (({ blind: _blind, ...review }) => review)(passed.review!) })
  expect("blind" in (await shownMaking(directory, old)).review!).toBe(false)
  expect(commitGate(old, version("b"))).toBeNull()
})

import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject } from "@minemods/mod-core/project"
import { CREATURE_TIERS, DETAIL_WORDS } from "@minemods/mod-core/creature-tier"
import { MODEL_COMPLEXITY_PRESETS } from "@minemods/studio-ai/model-quality"
import { OVERLAY_LEGEND, showsOverlay } from "@minemods/studio-ai/making"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import type { ActivityEvent, OverviewItem } from "../src/api"
import { createReferenceService } from "../src/main/reference-service"
import { needJob, reviewJob } from "../src/main/look-job"
import { askAboutThreeViews, asksAboutThreeView, missingThreeViews } from "../src/renderer/features/three-view-model"
import { floorRows, FLOOR_STATES, groupRows } from "../src/renderer/features/making-floor-model"
import { leftWords, makeCount, queueLine, queueWords } from "../src/renderer/features/production-counts"
import { makingNow } from "../src/renderer/features/production-words"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. 六视图 is asked about once per thing, and not at all when a model is there to go by.
// ---------------------------------------------------------------------------------------------------------------------------------

type Thing = { id: string; title: string; kind: string; facts?: { saved: boolean } }
/** The window's side of the question, with the project's record of answers and a person who answers as told. */
function person(answers: boolean[], held: Record<string, readonly { kind: string }[] | undefined> = {}) {
  const chosen = new Set<string>()
  const asked: string[][] = []
  return {
    chosen,
    asked,
    run: (items: Thing[]) =>
      askAboutThreeViews({
        items,
        byWords: async (item) => chosen.has(item.id),
        references: async (item) => (item.id in held ? held[item.id] : []),
        canDraw: async () => false,
        ask: async (question) => (asked.push(question.lines), answers.shift() ?? false),
        choose: async (item) => void chosen.add(item.id),
      }),
  }
}
const fox: Thing = { id: "fox_model", title: "小狐狸", kind: "model", facts: { saved: false } }
const golem: Thing = { id: "golem_model", title: "铜傀儡", kind: "model", facts: { saved: false } }

test("选过「直接开始」的东西，之后（包括提重做）不再问；没选过的另一样照样问", async () => {
  const you = person([true, false])
  // First time on the blueprint: asked, and the answer is kept for this thing.
  expect(await you.run([fox])).toEqual({ go: true })
  expect(you.asked).toHaveLength(1)
  expect(you.asked[0]![0]).toContain("小狐狸")
  expect([...you.chosen]).toEqual(["fox_model"])
  // Sent back with remarks, tried again, asked to remake: the same thing is never asked about again.
  for (let again = 0; again < 3; again++) expect(await you.run([fox])).toEqual({ go: true })
  expect(you.asked).toHaveLength(1)
  // Another thing was not answered for: it is asked, and the person may go and add the views instead.
  expect(await you.run([fox, golem])).toEqual({ go: false, first: golem })
  expect(you.asked).toHaveLength(2)
  expect(you.asked[1]![0]).toContain("铜傀儡")
  expect(you.asked[1]![0]).not.toContain("小狐狸")
  // Going to add the views records nothing: the question comes back until they are added or the person says to go on.
  expect(you.chosen.has("golem_model")).toBe(false)
})

test("已经有现成模型、正在被要求修改的东西，不要六视图：依据是现有模型加上你的意见", async () => {
  const made: Thing = { id: "fox_model", title: "小狐狸", kind: "model", facts: { saved: true } }
  const you = person([])
  // Sending it back with remarks, trying a failed redo again, a note on the saved model: never asked, and nothing is recorded as an answer.
  expect(await you.run([made])).toEqual({ go: true })
  expect(you.asked).toEqual([])
  expect(you.chosen.size).toBe(0)
  // Among things still to make, only those that have nothing yet are named.
  const mixed = person([true])
  expect(await mixed.run([made, golem])).toEqual({ go: true })
  expect(mixed.asked).toHaveLength(1)
  expect(mixed.asked[0]![0]).toContain("铜傀儡")
  expect(mixed.asked[0]![0]).not.toContain("小狐狸")
  expect([...mixed.chosen]).toEqual(["golem_model"])
})

test("六视图只问还没有、也没选过按文字做的模型；读不出来的、别的种类的都不问", () => {
  const model = { title: "小狐狸", kind: "model", references: [] as { kind: string }[] }
  expect(asksAboutThreeView(model)).toBe(true)
  expect(asksAboutThreeView({ ...model, byWords: true })).toBe(false)
  expect(asksAboutThreeView({ ...model, saved: true })).toBe(false)
  expect(asksAboutThreeView({ ...model, references: [{ kind: "three_view" }] })).toBe(false)
  expect(asksAboutThreeView({ ...model, references: [{ kind: "user" }] })).toBe(true)
  expect(asksAboutThreeView({ ...model, references: undefined })).toBe(false)
  expect(asksAboutThreeView({ ...model, kind: "item" })).toBe(false)
  expect(missingThreeViews([model, { ...model, title: "守卫", byWords: true }, { ...model, title: "傀儡", saved: true }])).toEqual(["小狐狸"])
})

test("按文字做的选择记在工程的记录里：重新打开窗口（新的服务）还在，别的东西不受影响", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "three-view-choice-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "小狐狸", description: "" })
  const service = () => createReferenceService({ directoryFor: async () => directory, refuse: (message) => new Error(message) })
  const input = { projectId: created.id, itemId: "fox_model" }
  expect(await service().byWords(input)).toBe(false)
  await service().chooseByWords(input)
  expect(await service().byWords(input)).toBe(true)
  expect(await service().byWords({ ...input, itemId: "golem_model" })).toBe(false)
  // Nothing about it shows up as a picture.
  expect(await service().list(input)).toEqual([])
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. A thing waiting in the queue is not "being made".
// ---------------------------------------------------------------------------------------------------------------------------------

const item = (id: string, extra: Partial<OverviewItem> = {}): OverviewItem =>
  ({
    id,
    key: id,
    asset_id: null,
    kind: "model",
    title: `${id}标题`,
    brief: "",
    owner: null,
    status: "making",
    status_label: "正在做",
    reason: null,
    facts: { saved: false, built: false, gametest: null, client: null, accepted: null },
    review_asked: false,
    review: null,
    preview: { source: null, model_asset_id: null, texture_asset_id: null, entity_id: null },
    needs: [],
    used_by: [],
    out_of_scope: null,
    revision: null,
    ...extra,
  }) as unknown as OverviewItem
const kinds = [{ id: "model", label: "模型" }]
const rowsOf = (items: OverviewItem[], events: ActivityEvent[] = []) => floorRows({ items, kinds, makings: {}, events, say: () => "" })

test("制作现场：在排队的和正在做的分成两组，排队的写明在等谁先做好", () => {
  const making = item("fox_model")
  const waiting = item("fox_skin", { status_label: "在排队", queued: { waiting_for: ["fox_model标题"] } })
  const next = item("berry", { status_label: "在排队", queued: { waiting_for: [] } })
  const rows = rowsOf([making, waiting, next])
  expect(rows.map((row) => [row.id, row.state])).toEqual([["fox_model", "making"], ["fox_skin", "queued"], ["berry", "queued"]])
  const groups = groupRows(rows)
  expect(groups.map((group) => [group.label, group.rows.map((row) => row.id)])).toEqual([["正在做", ["fox_model"]], ["在排队", ["fox_skin", "berry"]]])
  expect(FLOOR_STATES.map((state) => state.label).slice(0, 2)).toEqual(["正在做", "在排队"])
  // What a queued row says is what it waits for, never that it is being made.
  expect(rows.find((row) => row.id === "fox_skin")!.verdict).toBe("在排队，等「fox_model标题」先做好")
  expect(rows.find((row) => row.id === "berry")!.verdict).toBe("在排队，还没轮到它")
  expect(rows.find((row) => row.id === "fox_skin")!.mark).toBe("idle")
  expect(rows.find((row) => row.id === "fox_model")!.mark).toBe("run")
  // A queued row shows the step an earlier try left only when it is really being made.
  const step = { seq: 1, kind: "task", mark: "run", step: true, text: "正在写部件说明", item: "fox_skin" } as unknown as ActivityEvent
  expect(rowsOf([waiting], [step])[0]!.verdict).toBe("在排队，等「fox_model标题」先做好")
  expect(rowsOf([making], [{ ...step, item: "fox_model" } as ActivityEvent])[0]!.verdict).toBe("正在写部件说明")
})

test("计数：排队的不算在「还在做」「重做中」里，单独说排队几样", () => {
  // 4 things hold a place in the run: 1 being made, 2 waiting for a first making, 1 saved thing waiting to be made again.
  const production = { making: 4, queued: 3, queued_again: 1, remaking: 1, to_review: 0, to_redo: 0 }
  expect(leftWords(production)).toEqual(["还在做 1 样", "排队 3 样"])
  // Nothing has started: no "还在做" at all.
  expect(leftWords({ making: 2, queued: 2, queued_again: 0, remaking: 0, to_review: 0, to_redo: 0 })).toEqual(["排队 2 样"])
  // A saved thing really being made again is counted as that.
  expect(leftWords({ making: 2, queued: 1, queued_again: 0, remaking: 1, to_review: 1, to_redo: 1 })).toEqual(["排队 1 样", "等你验收 1 样", "重做中 2 样"])
  // Old answers without the new fields read as before.
  expect(leftWords({ making: 3, remaking: 1, to_review: 2, to_redo: 1 })).toEqual(["还在做 2 样", "等你验收 2 样", "重做中 2 样"])
  // The road's 制作 stage.
  expect(makeCount({ total: 5, done: 1, remaking: 1, unsatisfied: 0, interrupted: 0, queued: 2, queued_again: 1 })).toBe("1 / 5 · 排队 2")
  expect(makeCount({ total: 5, done: 1, remaking: 2, unsatisfied: 0, interrupted: 0, queued: 1, queued_again: 1 })).toBe("1 / 5 · 重做 1 · 排队 1")
  expect(makeCount({ total: 5, done: 1, remaking: 0, unsatisfied: 0, interrupted: 0 })).toBe("1 / 5")
})

test("总览上「正在做」的句子只数真的开始了的；排队的另起一句，写明在等什么", () => {
  const items = [item("fox_model"), item("fox_skin", { queued: { waiting_for: ["fox_model标题"] } }), item("fox", { queued: { waiting_for: ["fox_model标题", "fox_skin标题"] } })]
  const now = makingNow({ items, kinds, makings: {}, drafts: [], roundNow: () => 1 })
  expect(now.map((value) => value.id)).toEqual(["fox_model"])
  expect(queueLine(items)).toBe("排队 2 样：等「fox_model标题」「fox_skin标题」先做好")
  expect(queueLine([items[0]!])).toBe("")
  expect(queueLine([item("a", { queued: { waiting_for: [] } })])).toBe("排队 1 样：等着轮到它们")
  const many = Array.from({ length: 5 }, (_, index) => `前置${index + 1}`)
  expect(queueWords({ queued: { waiting_for: many } })).toBe("在排队，等「前置1」「前置2」「前置3」等 5 样先做好")
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. The pink overlay says what it is on the small picture.
// ---------------------------------------------------------------------------------------------------------------------------------

const cube = (name: string, origin: number[]) => ({ name, origin, size: [4, 4, 4], faces: { north: "#aa6644", east: "#aa6644", south: "#aa6644", west: "#aa6644", up: "#ddaa77", down: "#664422" }, surface_details: [] })
function mover(count: number) {
  const names = ["idle", "walk", "hurt", "attack", "death", "spin", "sleep", "roar", "float", "charge", "spawn", "eat", "sit", "look"]
  return {
    kind: "model" as const,
    ...ModelDesignSchema.parse({
      name: "会动的",
      texture_size: 64,
      bones: [
        { name: "root", parent: null, pivot: [0, 8, 0], rotation: [0, 0, 0], cubes: [cube("body", [-2, 4, -2])] },
        { name: "arm", parent: "root", pivot: [2, 8, 0], rotation: [0, 0, 0], cubes: [cube("hand", [2, 6, -2])] },
      ],
      animations: names.slice(0, count).map((name, index) => ({ name, length: 1, loop: true, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0, 0, 20 + index * 4] }, { time: 1, rotation: [0, 0, 0] }] }] })),
    }),
  }
}

test("粉色叠图：小图上带一句图例；哪些图带，和真正画了叠图的那些图一致", () => {
  expect(OVERLAY_LEGEND).toBe("粉色＝动得最多的两刻之间不一样的地方")
  const sheets = [
    ...reviewJob(mover(3), null).job.sheets,
    ...reviewJob(mover(7), null).job.sheets,
    ...reviewJob(mover(13), null).job.sheets,
    ...needJob(mover(3), null, [{ what: "motion", name: "walk" }, { what: "angle", name: "back" }, { what: "close_up", name: "arm" }]).job.sheets,
  ]
  const overlaid = sheets.filter((sheet) => sheet.cells.some((cell) => cell.kind === "compare"))
  expect(overlaid.length).toBeGreaterThan(5)
  // Every picture that has the overlay says so; the plain ones (angles, close-ups, the bare views) do not.
  // A shared 动作合辑 gives up the overlay cell of a motion when the room is short, so there the legend may stand on a picture whose motions all gave it up; it is never missing where the overlay is.
  for (const sheet of sheets) {
    const has = sheet.cells.some((cell) => cell.kind === "compare")
    if (sheet.label.startsWith("动作合辑")) expect([sheet.label, !has || showsOverlay(sheet.label)]).toEqual([sheet.label, true])
    else expect([sheet.label, showsOverlay(sheet.label)]).toEqual([sheet.label, has])
  }
  expect(sheets.some((sheet) => !sheet.cells.some((cell) => cell.kind === "compare"))).toBe(true)
  // Names of other pictures that also carry a dot in the middle are not motion pictures.
  for (const label of ["招式「大锤」· 出手的那一刻（红色是判定范围）", "背面（大图）", "近看「body」", "封面", "浅色的格子里 · 实际大小（16 像素）", undefined]) expect(showsOverlay(label)).toBe(false)
  expect(showsOverlay("动作合辑 1/2：待机、走路")).toBe(true)
  // The legend is plain words: no code names, no colour code.
  expect(OVERLAY_LEGEND).not.toMatch(/[A-Za-z0-9#]/)
})

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. 生物档位 and 模型精细度: a creature's tier raises the detail of its own model (never lowers the top setting), said in one sentence where each is chosen.
// ---------------------------------------------------------------------------------------------------------------------------------

test("生物档位和模型精细度：各一句话，说的是真的关系（档位只抬高这个生物自己的模型，顶部更高时按顶部），名字和档来自表", () => {
  const bossFloor = MODEL_COMPLEXITY_PRESETS[CREATURE_TIERS.boss.complexity].label
  expect(bossFloor).toBe("高")
  for (const said of [DETAIL_WORDS.tier, DETAIL_WORDS.button]) {
    expect(said.replace(/Boss|AI/g, "")).not.toMatch(/[A-Za-z_]{2,}/)
    // One sentence each (a clause or two), not a paragraph; no number that could differ from the range the maker is given.
    expect(said.length).toBeLessThan(110)
    expect(said).not.toMatch(/\d/)
    expect(said).not.toContain("两样分开算")
    expect(said).not.toContain("谁也不改谁")
  }
  // Beside the tier buttons: what each tier asks of its model, and that the top setting wins when it is higher.
  expect(DETAIL_WORDS.tier).toContain("招式和表现")
  expect(DETAIL_WORDS.tier).toContain(`${CREATURE_TIERS.fine.label}、${CREATURE_TIERS.boss.label}、${CREATURE_TIERS.epic.label}档至少按「${bossFloor}」`)
  expect(DETAIL_WORDS.tier).toContain(`${CREATURE_TIERS.standard.label}档照顶部的设置`)
  expect(DETAIL_WORDS.tier).toContain("顶部设得更高时按顶部")
  // At the top menu: a creature's tier may make one creature's model finer.
  expect(DETAIL_WORDS.button).toContain("生物档位可能把某个生物的模型抬得更细")
  expect(DETAIL_WORDS.button).toContain(`${CREATURE_TIERS.boss.label} 档至少按「${bossFloor}」`)
})

test("两句话真的摆在选档位的地方和顶部菜单里，界面里没有另写一份", async () => {
  const read = (file: string) => Bun.file(new URL(`../src/renderer/features/${file}`, import.meta.url)).text()
  const assets = await read("project-assets.tsx")
  const control = await read("model-complexity.tsx")
  expect(control).toContain("{DETAIL_WORDS.button}")
  expect(assets.match(/\{DETAIL_WORDS\.tier\}/g)).toHaveLength(2)
  // The old "separate settings" wording is gone from the screens.
  for (const text of [assets, control]) {
    expect(text).not.toContain("两样分开算")
    expect(text).not.toContain("谁也不改谁")
  }
})

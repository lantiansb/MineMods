import { expect, test } from "bun:test"
import type { ActivityEvent, Making, MakingRound, OverviewItem, OverviewStatus } from "../src/api"
import { filterRows, floorRows, groupRows, nowMaking, recentEvents, recordRound, REPLACED_WORDS, ROUND_WORDS, roundReviews, roundVerdict, thingTimeline, wholeId } from "../src/renderer/features/making-floor-model"
import { boneTitles, isIdentifier, motionTitle, partDetail, partTitle, plainNames, redoAfterWalk, redoPromise, redoSentence, redoStanding, retryWords } from "../src/renderer/features/asset-words"
import { assetChip, canAdd, categoryDesignNote, spareSlots, usersOf } from "../src/renderer/features/project-navigation-model"
import { buildProjectOverview } from "@minemods/mod-core/asset-overview"
import { confirmBlueprint, linkBlueprintEntry, replaceBlueprint } from "@minemods/mod-core/blueprint"
import { ProjectSchema } from "@minemods/mod-core/project"
import { readFileSync } from "node:fs"
import path from "node:path"
import { BLANK_KINDS } from "../src/renderer/features/asset-edit-words"
import { DESIGN_ONLY_WORDS } from "@minemods/mod-core/workspace-modules"

const start = Date.parse("2026-10-05T08:00:00.000Z")
const at = (minutes: number) => new Date(start + minutes * 60000).toISOString()
const stream = (rows: (Partial<ActivityEvent> & Pick<ActivityEvent, "kind" | "text">)[]): ActivityEvent[] =>
  rows.map((row, index) => ({ seq: index + 1, at: at(index), mark: "run", item: null, title: null, ...row }))
const thing = (id: string, title: string, kind: OverviewItem["kind"], status: OverviewStatus, more: Partial<OverviewItem> = {}): OverviewItem => ({
  id,
  key: id,
  asset_id: null,
  kind,
  title,
  brief: "",
  owner: null,
  status,
  status_label: status,
  reason: null,
  facts: { saved: status !== "planned" && status !== "making", built: false, gametest: null, client: null, accepted: null },
  review_asked: false,
  review: null,
  preview: { source: null, model_asset_id: null, texture_asset_id: null, entity_id: null },
  needs: [],
  used_by: [],
  out_of_scope: null,
  revision: null,
  ...more,
})
const round = (number: number, minutes: number, verdict: "revise" | "done", problems: string[] = []): MakingRound => ({
  round: number,
  at: at(minutes),
  pictures: [{ label: "六个角度", url: "data:," }],
  self_review: { matches: [], problems, next: [], verdict },
  findings: [],
})
const ore = { item: "ore", title: "蓝晶矿" }
const guard = { item: "guard", title: "矿石守卫" }
const events = stream([
  { kind: "plan", text: "正在想要做哪些东西。", step: true },
  { kind: "plan", text: "蓝图草稿好了。", mark: "ok", end: true },
  { kind: "person", text: "你确认了蓝图。", mark: "ok" },
  { kind: "batch", text: "开始做这一批，一共 2 样" },
  { kind: "task", text: "开始做", ...ore },
  { kind: "tool", text: "外部 AI 接下了「矿石守卫」。", ...guard, quiet: true, mark: "note", tool: "claim_task", ms: 12 },
  { kind: "look", text: "做出了第 1 版，看了它的渲染图。", ...ore, round: 1 },
  { kind: "review", text: "第 1 版自己检查：还要改。", ...ore, round: 1, mark: "warn", lines: ["看着像瓷砖"] },
  { kind: "tool", text: "外部 AI 提交了「矿石守卫」，被 Studio 退回了。", ...guard, mark: "fail", tool: "commit_task", lines: ["两条腿没有连着身体"] },
  { kind: "task", text: "正在检查并保存。", ...ore, step: true },
  { kind: "task", text: "做好了，已经保存，等你验收。", ...ore, mark: "ok", end: true },
  { kind: "task", text: "这一样没做成。", item: "old_sword", title: "旧剑", mark: "fail", end: true },
  { kind: "tool", text: "领了下一批要做的东西。", quiet: true, mark: "note", tool: "next_batch" },
  { kind: "task", text: "正在写部件说明。", ...guard, step: true },
])
const oreMaking: Making = {
  item_id: "ore",
  asset_id: null,
  sheet: { subject: "嵌在石头里的蓝色晶体", recognisable: [], parts: [], assumed: [], remark: null },
  rounds: [round(1, 6, "revise", ["看着像瓷砖"]), round(2, 9, "done")],
  review: { independent: true, passed: true, findings: [], advice: ["可以更亮一点"], at: at(9.5), round: 2 },
  state: "done",
  rounds_allowed: 5,
}
const items = [
  thing("ore", "蓝晶矿", "block", "review"),
  thing("guard", "矿石守卫", "entity", "making"),
  thing("recipe", "蓝晶剑的配方", "recipe", "planned"),
  thing("moon", "月亮维度", "dimension", "out_of_scope", { out_of_scope: "这个版本做不了新的维度。" }),
  thing("sword", "蓝晶剑", "item", "failed", { reason: "做满了 3 轮，还是没达到验收标准。" }),
]
const kinds = [
  { id: "block", label: "方块" },
  { id: "entity", label: "生物" },
  { id: "recipe", label: "配方" },
  { id: "dimension", label: "维度" },
  { id: "item", label: "物品" },
]
const say = (making: Making) => `做了 ${making.rounds.length} 轮`
const rows = floorRows({ items, kinds, makings: { ore: oreMaking }, events, say })

test("有记录的东西一样不漏：总览里的每一样、只剩动态记得的、整个模组的事，各有一行", () => {
  expect(rows.map((row) => [row.id, row.state, row.rounds])).toEqual([
    ["ore", "review", 2],
    ["guard", "making", 0],
    ["recipe", "waiting", 0],
    ["moon", "skipped", 0],
    ["sword", "stuck", 0],
    ["old_sword", "gone", 0],
    [wholeId("plan"), "whole", 0],
    [wholeId("batch"), "whole", 0],
    [wholeId("person"), "whole", 0],
    [wholeId("tool"), "whole", 0],
  ])
  // Every event of the log belongs to exactly one row.
  expect(rows.flatMap((row) => row.events.map((event) => event.seq)).sort((left, right) => left - right)).toEqual(events.map((event) => event.seq))
  // A row that exists without events: runs were made although the log is empty.
  expect(floorRows({ items: [], kinds, makings: {}, events: [], say, whole: { batch: { verdict: "月鹿", at: at(1), mark: "ok" } } }).map((row) => [row.id, row.verdict])).toEqual([[wholeId("batch"), "月鹿"]])
})

test("每一行最后一句话：正在做的是它手上的那一步，有制作记录的说记录，别的说原因或最后一条动态", () => {
  const verdict = (id: string) => rows.find((row) => row.id === id)!.verdict
  expect(verdict("guard")).toBe("正在写部件说明。")
  expect(verdict("ore")).toBe("AI 做了 2 轮")
  expect(verdict("sword")).toBe("做满了 3 轮，还是没达到验收标准。")
  expect(verdict("moon")).toBe("这个版本做不了新的维度。")
  expect(verdict("recipe")).toBe("planned")
  expect(verdict("old_sword")).toBe("这一样没做成。")
  expect(rows.find((row) => row.id === "ore")!.at).toBe(at(10))
})

test("按状态分组，组内最近动过的在前；搜索能搜到说过的话，筛选按状态和种类", () => {
  expect(groupRows(rows).map((group) => [group.label, group.rows.map((row) => row.title)])).toEqual([
    ["正在做", ["矿石守卫"]],
    ["等你验收", ["蓝晶矿"]],
    ["没做成 · 被卡住", ["蓝晶剑"]],
    ["还没做 · 要重做", ["蓝晶剑的配方"]],
    ["不做这个了", ["月亮维度"]],
    ["不在蓝图里的（单独做的，或者蓝图里已经拿掉的）", ["旧剑"]],
    ["整个模组的事", ["想法和蓝图", "一批一批的任务", "你做的决定", "外部 AI 的调用"]],
  ])
  const found = (search: string, state = "", kind = "") => filterRows(rows, { search, state: state as never, kind }).map((row) => row.id)
  expect(found("瓷砖")).toEqual(["ore"])
  expect(found("两条腿 守卫")).toEqual(["guard"])
  expect(found("嵌在石头里")).toEqual(["ore"])
  expect(found("", "stuck")).toEqual(["sword"])
  expect(found("", "", "recipe")).toEqual(["recipe"])
  expect(found("没有这个词")).toEqual([])
  expect(nowMaking(rows)?.id).toBe("guard")
})

test("一样东西的全部经过：制作记录的每一轮和验收，和动态里它的每一条，按时间排在一起", () => {
  const row = rows.find((value) => value.id === "ore")!
  const told = thingTimeline(oreMaking, row.events, false)
  expect(told.moments.map((moment) => (moment.type === "event" ? moment.event.text : moment.type === "round" ? `第 ${moment.round.round} 轮：${roundVerdict(oreMaking, moment.round, row.events).words}` : `验收：${moment.review.passed}`))).toEqual([
    "开始做",
    "第 1 轮：还要改 · 1 处毛病",
    "做出了第 1 版，看了它的渲染图。",
    "第 1 版自己检查：还要改。",
    // Its maker said "done" and the review of that very version passed: the round says the review, not the opinion.
    "第 2 轮：审查通过",
    "验收：true",
    "做好了，已经保存，等你验收。",
  ])
  // Ended: the step before the end is no longer what is being done.
  expect(told.live).toBeNull()
  // 高级 leaves nothing out.
  expect(thingTimeline(oreMaking, row.events, true).moments.filter((moment) => moment.type === "event")).toHaveLength(row.events.length)
  const guardRow = rows.find((value) => value.id === "guard")!
  expect(thingTimeline(undefined, guardRow.events, false).moments.map((moment) => moment.type === "event" && moment.event.tool)).toEqual(["commit_task"])
  expect(thingTimeline(undefined, guardRow.events, false).live?.text).toBe("正在写部件说明。")
  expect(recentEvents(events, false, 3).map((event) => event.seq)).toEqual([9, 11, 12])
  expect(recentEvents(events, true, 100)).toHaveLength(events.length)
})

test("制作现场：AI 写给开发者看的技术说明不摆在普通人面前——整句是代码的收进「高级」，只在句子里提到名字的留在句子里；别的行原样", async () => {
  const { splitForPerson, technicalHidden, mostlyCode } = await import("@minemods/mod-core/play-words")
  const note = "第九轮合法模型已通过脚本 schema和compileModel，但MCP look连续返回操作未完成；同输入只读reviewAsset复现 TypeError at model-look.ts colorDistance/marks。"
  const split = splitForPerson([note, "吐息的气流要跟着打出去的方向走。"])
  expect(split.shown).toEqual(["吐息的气流要跟着打出去的方向走。"])
  expect(split.technical).toEqual([note])
  expect(technicalHidden(1)).toContain("高级")
  // Names of things and of the game are not code, and a claim that only names a class or a file stays a sentence (round 18's cards).
  for (const line of ["掉 1 到 2 块 minecraft:mossy_cobblestone。", "用 GeckoLib 4.8.3 和 Minecraft 1.21.1。", "走路时每秒 0.2 格，MineMods Studio 量的。", "识别 HabitAlertGoal 在 Main.java 里注册，generated 里写了", "找不到类 SpawnRestriction（在 ProjectContent 里）"]) expect([line, mostlyCode(line)]).toEqual([line, false])
  for (const line of ["java.lang.NullPointerException: x", "    at studio.Mod.tick(Mod.java:3)"]) expect(splitForPerson([line])).toEqual({ shown: [], technical: [line] })
  // A short sentence with one name in it keeps its words: the name is set as a token by the window.
  for (const line of ["见 build-source.json", "调用 commitTask 失败"]) expect(splitForPerson([line]).technical).toEqual([])
  expect(splitForPerson([])).toEqual({ shown: [], technical: [] })
})

test("一轮上写的话：做它的 AI 自己觉得可以了不是通过；那一版审查没过就写在那一轮上；只有审查通过才是通过", () => {
  // Round 18: five versions in a row, each called done by its maker, each failing the blind naming that followed. The record keeps only the newest review; the log remembers the others.
  const rounds = [1, 2, 3, 4, 5].map((number) => round(number, number * 10, "done"))
  const failed = (number: number, minutes: number, line: string): Partial<ActivityEvent> & Pick<ActivityEvent, "kind" | "text"> => ({ kind: "review", text: `没参与制作的评审看了第 ${number} 版：没通过，有必须改的地方。`, mark: "fail", round: number, at: at(minutes), lines: [line], item: "shell" })
  const log = stream([
    { kind: "review", text: "第 1 版自己检查过，觉得可以了。", round: 1, at: at(11), item: "shell" },
    failed(1, 12, "盲认：评审以为这是一块石头"),
    failed(2, 22, "盲认：评审以为这是一只碗"),
    failed(3, 32, "盲认：评审以为这是一顶头盔"),
    failed(4, 42, "盲认：评审以为这是一个壳"),
  ])
  const making: Making = { item_id: "shell", asset_id: null, sheet: null, rounds, review: { independent: true, passed: false, findings: ["盲认：评审以为这是一只乌龟", "颜色太淡"], at: at(52), round: 5 }, state: "stopped", rounds_allowed: 5 }
  const said = rounds.map((value) => roundVerdict(making, value, log))
  expect(said.map((value) => value.tone)).toEqual(["fail", "fail", "fail", "fail", "fail"])
  expect(said.map((value) => value.words)).toEqual(["审查没过：盲认：评审以为这是一块石头", "审查没过：盲认：评审以为这是一只碗", "审查没过：盲认：评审以为这是一顶头盔", "审查没过：盲认：评审以为这是一个壳", "审查没过：盲认：评审以为这是一只乌龟"])
  expect(said.every((value) => value.short === ROUND_WORDS.fail)).toBe(true)
  // Without the log (the page has not read it) the record's own review still stands on its round, and no other round is called a pass.
  expect(rounds.map((value) => roundVerdict(making, value).tone)).toEqual(["own", "own", "own", "own", "fail"])
  expect(roundVerdict(making, rounds[0]!).words).toBe(ROUND_WORDS.own_later)
  // The maker's own word, while the review is still to come: its own, and waiting.
  const waiting: Making = { ...making, rounds: rounds.slice(0, 1), review: null, state: "reviewing" }
  expect(roundVerdict(waiting, rounds[0]!)).toEqual({ tone: "own", words: "做它的 AI 自己觉得可以了，等审查", short: "等审查" })
  expect(roundVerdict({ ...waiting, state: "done" }, rounds[0]!).words).toBe(ROUND_WORDS.own_only)
  // A pass is a review's: the independent one is the pass; the maker reviewing itself is said as that and is not coloured as one.
  expect(roundVerdict({ ...waiting, review: { independent: true, passed: true, findings: [], at: at(13), round: 1 }, state: "done" }, rounds[0]!)).toEqual({ tone: "pass", words: "审查通过", short: "审查通过" })
  expect(roundVerdict({ ...waiting, review: { independent: false, passed: true, findings: [], at: at(13), round: 1 }, state: "done" }, rounds[0]!).tone).toBe("own")
  // A record from before reviews said which version they were of: the last one.
  expect(roundReviews({ rounds: rounds.slice(0, 2), review: { independent: true, passed: false, findings: [], at: at(25) } }).map((value) => [value.round, value.passed, value.finding])).toEqual([[2, false, null]])
  // A review that failed without saying why, a round still being checked, a round its maker wants to change.
  expect(roundVerdict({ rounds: rounds.slice(0, 2), review: { independent: true, passed: false, findings: [], at: at(25) } }, rounds[1]!).words).toBe("审查没过")
  expect(roundVerdict(waiting, { ...rounds[0]!, self_review: null })).toEqual({ tone: "wait", words: "还没有它自己的检查", short: "" })
  expect(roundVerdict(waiting, round(1, 10, "revise", ["腿太短"]))).toEqual({ tone: "revise", words: "还要改 · 1 处毛病", short: "还要改" })
  // Reviews told of in the log before this making's first version were of a making that is gone.
  expect(roundReviews({ rounds: [round(1, 30, "done")], review: null }, log).map((value) => value.round)).toEqual([3, 4])
})

test("旧记录不会打开新制作里同号的那一版：按记录的时间归到它自己那次制作", () => {
  // Redone: the new making began at minute 60 and counts from 1 again.
  const current = { rounds: [round(1, 60, "revise"), round(2, 70, "revise"), round(3, 80, "done")] }
  const old = { at: at(30), round: 3 }
  expect(recordRound(old, current)).toEqual({ making: "replaced" })
  expect(recordRound({ at: at(81), round: 3 }, current)).toEqual({ making: "current", round: 3 })
  // The event of a making's first look carries that round's own time.
  expect(recordRound({ at: at(60), round: 1 }, current)).toEqual({ making: "current", round: 1 })
  // The new making has not looked at anything yet: every numbered record is from before it.
  expect(recordRound({ at: at(59), round: 1 }, { rounds: [] })).toEqual({ making: "replaced" })
  // With the earlier makings in hand the record leads to its own: the newest that had begun by then and has that round.
  const first = { rounds: [round(1, 5, "revise"), round(2, 8, "done")] }
  const second = { rounds: [round(1, 20, "revise"), round(2, 25, "revise"), round(3, 28, "done")] }
  expect(recordRound(old, current, [first, second])).toEqual({ making: "earlier", index: 1, round: 3 })
  expect(recordRound({ at: at(9), round: 2 }, current, [first, second])).toEqual({ making: "earlier", index: 0, round: 2 })
  expect(recordRound({ at: at(9), round: 3 }, current, [first, second])).toEqual({ making: "replaced" })
  // Nothing to choose between: the record names no round, or no making has been read.
  expect(recordRound({ at: at(30) }, current)).toBeNull()
  expect(recordRound(old, null)).toBeNull()
  expect(REPLACED_WORDS).toBe("这是重做之前的记录，那一版已经被新的替换了")
})

test("「高级」关着的时候，AI 写的标识符不当名字用：部件按它是什么来叫，动作按玩家的说法来叫", () => {
  for (const name of ["pick", "root", "appear", "leg_front_left", "bone.001"]) expect(isIdentifier(name)).toBe(true)
  for (const name of ["头", "左前腿", "镐头 a", ""]) expect(isIdentifier(name)).toBe(false)
  const pick = { name: "pick", what: "镐头：一块弯的蓝色金属" }
  const head = { name: "头", what: "圆圆的，有两只眼睛" }
  expect([partTitle(pick, false), partDetail(pick, false)]).toEqual(["镐头：一块弯的蓝色金属", ""])
  expect([partTitle(pick, true), partDetail(pick, true)]).toEqual(["pick", "镐头：一块弯的蓝色金属"])
  // A name in the person's own language is a name.
  expect([partTitle(head, false), partDetail(head, false)]).toEqual(["头", "圆圆的，有两只眼睛"])
  expect([motionTitle("idle", false), motionTitle("walk", false), motionTitle("hurt", false), motionTitle("death", false), motionTitle("attack", false)]).toEqual(["待机", "走路", "受伤", "倒下", "攻击"])
  expect(motionTitle("appear", false)).toBe("未命名动作")
  expect(motionTitle("appear", true)).toBe("未命名动作（appear）")
  expect(motionTitle("walk", true)).toBe("走路（walk）")
  expect(motionTitle("旋转", false)).toBe("未命名动作")
  const bones = [{ name: "root" }, { name: "pick" }, { name: "手柄" }]
  expect([...boneTitles(bones, [pick], false).values()]).toEqual(["第 1 个部件", "镐头：一块弯的蓝色金属", "手柄"])
  expect([...boneTitles(bones, [pick], true).values()]).toEqual(["root", "pick", "手柄"])
  expect(plainNames("appear：看得出在动，动得最多的是「pick」。", [pick], false)).toBe(`未命名动作：看得出在动，动得最多的是「镐头：一块弯的蓝色金属」。`)
  expect(plainNames("walk：看得出在动，动得最多的是「tail」。", [pick], false)).toBe("走路：看得出在动，动得最多的是「tail」。")
  expect(plainNames("appear：动得最多的是「pick」。", [pick], true)).toBe("appear：动得最多的是「pick」。")
})

test("再试一次带的话：上次说的那句，没有就是它现在这样的第一行原因；复制给外部 AI 的那句也用它", () => {
  const failed = { title: "风暴镐", facts: { saved: false }, reason: "做满了 5 轮，没有一版通过\n盲认没认出来", review: null }
  expect(retryWords(failed)).toBe("做满了 5 轮，没有一版通过")
  expect(retryWords({ ...failed, review: { note: "镐头再大一点" } })).toBe("镐头再大一点")
  expect(retryWords({ ...failed, reason: "很长".repeat(400) }, 500)).toHaveLength(500)
  expect(redoSentence("风暴山巅", failed)).toBe("MineMods 工程「风暴山巅」里的「风暴镐」上次没做成，请继续：先把它再做一次（做满了 5 轮，没有一版通过），再接着做别的。")
  expect(redoSentence("风暴山巅", { ...failed, facts: { saved: true }, review: { note: "镐头再大一点" } })).toBe("MineMods 工程「风暴山巅」里的「风暴镐」我在 Studio 里看过了，要改：镐头再大一点。请继续：先把它重做好，再接着做别的。")
})

test("左边一栏：没有东西的分类只剩标题一行；有东西的分类最多多一个空格子，而且不为它另起一行", () => {
  expect(spareSlots(0, 3, true)).toBe(0)
  expect([1, 2, 3, 4, 5, 6].map((count) => spareSlots(count, 3, true))).toEqual([1, 1, 0, 1, 1, 0])
  // Where nothing can be added (an outside AI makes the things) there is no place to add one.
  expect([0, 1, 2, 3].map((count) => spareSlots(count, 3, false))).toEqual([0, 0, 0, 0])
  // With an outside AI only the kinds that can start from an empty form keep their 「＋」; with Studio's own AI every kind does.
  const creates = ["entity", "block", "item", "recipe", "worldview", "gameplay", "gesture", "effect", "model", "book"]
  expect(creates.filter((create) => canAdd(create, true))).toEqual([...BLANK_KINDS])
  expect(creates.every((create) => canAdd(create, false))).toBe(true)
  // A category every kind of which is a design draft says so; one kind that reaches the game and it does not.
  expect(categoryDesignNote(["worldview", "biome", "dimension", "terrain"], "fabric-1.21.1")).toBe(DESIGN_ONLY_WORDS)
  expect(categoryDesignNote(["biome"], "fabric-1.21.1")).toBe("这一类现在只是设计稿，不会做进游戏")
  expect(categoryDesignNote(["model", "texture", "animation"], "fabric-1.21.1")).toBeNull()
  expect(categoryDesignNote(["block"], "fabric-1.21.1")).toBeNull()
  expect(categoryDesignNote([], "fabric-1.21.1")).toBeNull()
  // A Forge or NeoForge project's left column says the same: the look and the content reach the game there too.
  for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
    expect(categoryDesignNote(["model", "texture", "animation"], target)).toBeNull()
    expect(categoryDesignNote(["block"], target)).toBeNull()
    expect(categoryDesignNote(["biome"], target)).toBe(DESIGN_ONLY_WORDS)
  }
})

test("手动做的东西被蓝图原位改过以后，它原来的记录归在现在这一行里，不在「不在蓝图里的」", () => {
  const made = (_unused: string, text: string, item: string) => ({ seq: 0, at: at(0), mark: "note" as const, item, title: "苔纹石", kind: "person" as const, text })
  const log = [made("", "你自己从空白做了「苔纹石」。", "stone-asset"), made("", "做好了。", "plan-key"), made("", "老记录", "block:legacy-id"), made("", "旧剑的记录", "removed")].map((event, index) => ({ ...event, seq: index + 1 }))
  const items = [
    // A plan entry that took over the hand-made block: the row is the entry's key, the old id is its asset.
    thing("plan-key", "苔纹石", "block", "built", { asset_id: "stone-asset" }),
    // Hand-made content of the overview's own `kind:id` form.
    thing("block:legacy-id", "旧方块", "block", "saved"),
    // An item whose id is `kind:id` of another thing must not capture a record that already names an item.
    thing("item:other", "别的", "item", "saved", { asset_id: null }),
  ]
  const result = floorRows({ items, kinds, makings: {}, events: log, say })
  const own = (id: string) => result.find((row) => row.id === id)!.events.map((event) => event.text)
  expect(own("plan-key")).toEqual(["你自己从空白做了「苔纹石」。", "做好了。"])
  expect(own("block:legacy-id")).toEqual(["老记录"])
  // A record whose thing is really gone from the plan still says so.
  const gone = result.filter((row) => row.state === "gone")
  expect(gone.map((row) => row.id)).toEqual(["removed"])
  expect(gone[0]!.kindLabel).toBe("已不在蓝图里")
})

test("「不满意，要改」之后页面说的次序和真实一致：批次还在做，就说做完这一批以后才轮到重做（broad18）", () => {
  const what = "按你说的重做这一样"
  for (const external of [true, false]) {
    for (const aiConfigured of [true, false]) {
      const idle = { external, aiConfigured, running: false }
      const busy = { external, aiConfigured, running: true }
      const lines = (who: typeof idle) => [redoPromise(who, what), redoStanding(who, true), redoStanding(who, false), redoAfterWalk(who)]
      // While a batch is still being made, every line that talks about the redo says it waits for the batch to end, in each way of working that can redo at all.
      if (aiConfigured || external) for (const line of lines(busy)) expect(line).toContain("做完")
      for (const line of lines(idle).concat(lines(busy))) expect(line).not.toMatch(/[A-Za-z_]{4,}/)
    }
  }
  // An outside AI mid-batch is told it comes after the batch, and that the rework leads what is handed out next.
  const external = redoPromise({ external: true, aiConfigured: true, running: true }, "按你说的重做这一样")
  expect(external).toContain("没做完")
  expect(external).toContain("下一次领任务时它会先按你说的重做这一样")
  expect(redoAfterWalk({ external: true, aiConfigured: true, running: true })).toContain("等它做完")
  // With no batch going, the outside AI's next claim does start with the rework, so the old promise stands.
  expect(redoPromise({ external: true, aiConfigured: true, running: false }, what)).toContain("它会先按你说的重做这一样")
  expect(redoAfterWalk({ external: true, aiConfigured: true, running: false })).toContain("它会先重做这些")
})

test("the chip beside a saved asset says what is true on the project's target: a draft kind is 「设计稿」, a texture nobody wears yet waits, one a creature wears says nothing", () => {
  const texture = { id: "t", module: "texture" as const, status: "design" }
  const wornBy = (users: string[]) => (id: string) => (id === "t" ? users : null)
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    // Saved with status "design" by its kind, and worn by a creature: it is in the mod.
    expect(assetChip(texture, wornBy(["creature"]), target)).toBe("")
    // Nothing wears it yet: it will be in the mod once something does.
    expect(assetChip(texture, wornBy([]), target)).toBe("待用上")
    expect(assetChip(texture, null, target)).toBe("待用上")
    // A kind that is made into the game at once.
    expect(assetChip({ id: "i", module: "item", status: "ready" }, null, target)).toBe("")
    // A kind no build makes.
    expect(assetChip({ id: "b", module: "biome", status: "design" }, wornBy(["x"]), target)).toBe("设计稿")
  }
})

test("the chip reads what uses an asset from the real overview: a texture a creature wears is not 「待用上」", () => {
  // The second UI run of 2026-11-15: the first chip looked assets up by the overview item's id (`texture:<id>`), found none, and called a worn texture 「待用上」.
  // A project made from a blueprint, as there: the texture and the creature that wears it are entries, so the overview's items are the entries' keys.
  const legacy = ProjectSchema.parse(JSON.parse(readFileSync(path.join(import.meta.dir, "../../mod-core/test/fixtures/pre-0a/project.json"), "utf8")))
  const worn = legacy.workspace.assets.find((asset) => asset.module === "texture")!
  const wearer = legacy.workspace.assets.find((asset) => asset.document.kind === "entity" && asset.document.runtime.texture_asset_id === worn.id)!
  const entry = (key: string, kind: string, needs: string[] = []) => ({ key, kind, title: `${key} 标题`, brief: `${key} 说明`, owner: null, needs, out_of_scope: null }) as never
  const planned = replaceBlueprint(legacy, { request: "做一只苦力怕", style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }, entries: [entry("moss_model", "model"), entry("moss_skin", "texture", ["moss_model"]), entry("creeper", "entity", ["moss_model", "moss_skin"])], questions: [] })
  const model = wearer.document.kind === "entity" ? wearer.document.model_asset_id : ""
  const project = linkBlueprintEntry(linkBlueprintEntry(linkBlueprintEntry(confirmBlueprint(planned, 1), "moss_model", model), "moss_skin", worn.id), "creeper", wearer.id)
  const overview = buildProjectOverview({ project, runs: [], build: null, verification: null, production: null, producing: false })
  expect(overview.items.find((item) => item.asset_id === worn.id)?.id).toBe("moss_skin")
  expect(usersOf(overview, worn.id)?.length).toBeGreaterThan(0)
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const)
    expect(assetChip({ id: worn.id, module: "texture", status: "design" }, (id) => usersOf(overview, id), target)).toBe("")
  expect(usersOf(overview, "00000000-0000-4000-8000-000000000000")).toBeNull()
})

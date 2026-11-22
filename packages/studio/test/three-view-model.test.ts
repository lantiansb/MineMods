import { expect, test } from "bun:test"
import type { ReferenceImage } from "../src/api"
import { IMAGE_MODEL_WORDS } from "../src/renderer/words"
import { REFERENCE_REFUSALS } from "@minemods/studio-ai/making"
import { SIDE_WORDS } from "@minemods/studio-ai/orientation"
import {
  besidesThreeView,
  hasThreeView,
  missingThreeViews,
  NAMES_SAID,
  notStarted,
  replacedWords,
  slotFor,
  slotsOf,
  THREE_VIEW_PLAIN,
  THREE_VIEW_WORDS,
  threeViewQuestion,
  threeViewSlots,
  wantsThreeView,
} from "../src/renderer/features/three-view-model"

const picture = (id: string, kind: ReferenceImage["kind"], view?: ReferenceImage["view"], by?: ReferenceImage["by"]): ReferenceImage => ({ id, kind, name: `${id}.png`, url: "data:image/png;base64,AA==", ...(view ? { view } : {}), ...(by ? { by } : {}) })

test("六视图只给模型：生物的模型是一样 model，方块、物品、配方、贴图都不是", () => {
  expect(wantsThreeView("model")).toBe(true)
  for (const kind of ["entity", "block", "item", "recipe", "texture", "animation", "gesture", "effect", "logic"]) expect(wantsThreeView(kind)).toBe(false)
})

const EMPTY = { layout: null, sheet: null, front: null, back: null, left: null, right: null, top: null, quarter: null }

test("参考图按六视图的格子分好：别的图不算，没写 view 的是一整张，以前的「侧面」放在它的左侧那一格，后来的盖掉先来的", () => {
  expect(threeViewSlots([])).toEqual(EMPTY)
  const sheet = threeViewSlots([picture("u", "user"), picture("c", "concept"), picture("s", "three_view")])
  expect(sheet.layout).toBe("sheet")
  expect(sheet.sheet?.id).toBe("s")
  expect([sheet.front, sheet.back, sheet.left, sheet.right, sheet.top, sheet.quarter]).toEqual([null, null, null, null, null, null])
  const split = threeViewSlots([picture("f", "three_view", "front", "person"), picture("b1", "three_view", "back", "ai"), picture("b2", "three_view", "back", "ai"), picture("q", "three_view", "quarter", "person"), picture("t", "three_view", "top", "person")])
  expect(split.layout).toBe("split")
  expect([split.front?.id, split.back?.id, split.left, split.right, split.top?.id, split.quarter?.id]).toEqual(["f", "b2", null, null, "t", "q"])
  // Only one of the six makes it apart.
  expect(threeViewSlots([picture("r", "three_view", "right")]).layout).toBe("split")
  // A side kept from three views shows in the left slot; there is no slot of its own.
  const old = threeViewSlots([picture("s", "three_view", "side", "person")])
  expect(old.layout).toBe("split")
  expect(old.left?.id).toBe("s")
  expect("side" in old).toBe(false)
  // The overview's listing has no pictures: the same sorting works on it.
  expect(threeViewSlots([{ id: "x", kind: "three_view" as const, name: "x", view: "left" as const }]).left?.id).toBe("x")
  expect(slotsOf("sheet")).toEqual(["sheet"])
  // Apart, the six in the order of the six-angle renders, three to a row.
  expect(slotsOf("split")).toEqual(["front", "back", "left", "right", "top", "quarter"])
})

test("参考图那一栏不再列六视图", () => {
  const list = [picture("u", "user"), picture("s", "three_view"), picture("c", "concept")]
  expect(besidesThreeView(list).map((value) => value.id)).toEqual(["u", "c"])
  expect(hasThreeView(list)).toBe(true)
  expect(hasThreeView(besidesThreeView(list))).toBe(false)
  expect(hasThreeView(undefined)).toBe(false)
})

test("粘贴或拖到整块上的图：放进指着的格子，否则第一个空格，都满了放第一个", () => {
  const some = threeViewSlots([picture("f", "three_view", "front")])
  expect(slotFor(some, "split", "back")).toBe("back")
  expect(slotFor(some, "split", null)).toBe("back")
  expect(slotFor(some, "split", "sheet")).toBe("back")
  expect(slotFor(threeViewSlots([picture("f", "three_view", "front"), picture("b", "three_view", "back"), picture("s", "three_view", "side")]), "split", null)).toBe("right")
  const full = threeViewSlots(["front", "back", "left", "right", "top", "quarter"].map((view) => picture(view, "three_view", view as "front")))
  expect(slotFor(full, "split", null)).toBe("front")
  expect(slotFor(some, "sheet", null)).toBe("sheet")
})

test("换了放法以后先说清楚会替换掉什么", () => {
  const split = threeViewSlots([picture("f", "three_view", "front")])
  const sheet = threeViewSlots([picture("s", "three_view", "sheet")])
  expect(replacedWords(split, "sheet")).toBe(THREE_VIEW_WORDS.sheetOverSplit)
  expect(replacedWords(sheet, "split")).toBe(THREE_VIEW_WORDS.splitOverSheet)
  expect(replacedWords(split, "split")).toBe("")
  expect(replacedWords(sheet, "sheet")).toBe("")
  expect(replacedWords(threeViewSlots([]), "split")).toBe("")
})

test("还没有六视图的模型：只数模型，读不出来的不提", () => {
  expect(
    missingThreeViews([
      { title: "铜傀儡的模型", kind: "model", references: [{ kind: "user" }] },
      { title: "守卫的模型", kind: "model", references: [{ kind: "three_view" }] },
      { title: "没读出来的模型", kind: "model" },
      { title: "铜镐", kind: "item", references: [] },
      { title: "空着的模型", kind: "model", references: [] },
    ]),
  ).toEqual(["铜傀儡的模型", "空着的模型"])
  expect(missingThreeViews([])).toEqual([])
})

test("还没开始做：没存过、不在做、不是做不了的", () => {
  const item = (status: string, saved: boolean) => ({ status, facts: { saved } })
  expect(notStarted(item("planned", false))).toBe(true)
  expect(notStarted(item("failed", false))).toBe(true)
  expect(notStarted(item("redo", false))).toBe(true)
  expect(notStarted(item("making", false))).toBe(false)
  expect(notStarted(item("out_of_scope", false))).toBe(false)
  expect(notStarted(item("review", true))).toBe(false)
})

test("开始做之前问一句：点名、说后果、能画时多一句；安全的回答是先去加", () => {
  const many = threeViewQuestion(["铜傀儡", "守卫"], false)
  expect(many).toEqual({
    title: "还没有六视图",
    lines: [`下面这几样还没有六视图：「铜傀儡」「守卫」。${THREE_VIEW_PLAIN}没有它，AI 只能照文字做，形状和比例可能和你想的差得比较远；具体效果看所用 AI 模型的能力。`],
    confirm: "直接开始",
    cancel: "先去加六视图",
  })
  expect(threeViewQuestion(["铜傀儡"], true).lines).toEqual([
    `「铜傀儡」还没有六视图。${THREE_VIEW_PLAIN}没有它，AI 只能照文字做，形状和比例可能和你想的差得比较远；具体效果看所用 AI 模型的能力。`,
    "也可以让 AI 先把六视图画出来，你看过再开始。",
  ])
  const titles = Array.from({ length: NAMES_SAID + 3 }, (_, index) => `模型${index + 1}`)
  const long = threeViewQuestion(titles, false).lines[0]!
  expect(long).toContain(`「模型${NAMES_SAID}」等 ${NAMES_SAID + 3} 样。`)
  expect(long).not.toContain(`「模型${NAMES_SAID + 1}」`)
})

test("六视图和画图模型的字：六格和渲染图用同样的说法，左右是它自己的", () => {
  expect(THREE_VIEW_WORDS.title).toBe("六视图")
  // The term is never met bare: it says what it is, from which angles, and that it is optional.
  expect(THREE_VIEW_PLAIN).toBe(`六视图是同一样东西从六个方向各画一张的图：正面、背面、${SIDE_WORDS.left}、${SIDE_WORDS.right}、从上往下、斜前方。AI 做模型时照着它对形状和比例。它不是必须的：没有也能做，你可以自己放图，也可以让 AI 画。`)
  for (const said of [THREE_VIEW_WORDS.meaning, THREE_VIEW_WORDS.missingTitle, threeViewQuestion(["铜傀儡"], false).lines[0]!]) {
    expect(said).toContain("不是必须的")
    expect(said).toContain("从六个方向各画一张")
  }
  expect(THREE_VIEW_WORDS.meaning).toBe(`${THREE_VIEW_PLAIN}没有它，AI 只能照文字做，效果可能差一些。`)
  expect([THREE_VIEW_WORDS.whole, THREE_VIEW_WORDS.split, THREE_VIEW_WORDS.layout]).toEqual(["一整张", "分六张", "六视图怎么放"])
  expect(THREE_VIEW_WORDS.slots).toEqual({ sheet: "一整张六视图", front: "正面", back: "背面", left: SIDE_WORDS.left, right: SIDE_WORDS.right, top: "从上往下", quarter: "斜前方" })
  expect([SIDE_WORDS.left, SIDE_WORDS.right]).toEqual(["它的左侧", "它的右侧"])
  expect([THREE_VIEW_WORDS.sheetOverSplit, THREE_VIEW_WORDS.splitOverSheet]).toEqual(["现在存着的是分开的几张；在这里放一整张，会替换掉分开的那几张。", "现在存着的是一整张；在这里放任何一张，会替换掉那一整张。"])
  expect([THREE_VIEW_WORDS.draw, THREE_VIEW_WORDS.note, THREE_VIEW_WORDS.drawing]).toEqual(["让 AI 画六视图", "想补充的话（可选）", "正在画六视图…（一般要一两分钟）"])
  expect([THREE_VIEW_WORDS.keep, THREE_VIEW_WORDS.again, THREE_VIEW_WORDS.drop, THREE_VIEW_WORDS.byAi, THREE_VIEW_WORDS.byPerson, THREE_VIEW_WORDS.missing]).toEqual(["就用这个", "再画一次", "不要了", "AI 画的", "你给的", "还没有六视图（可不加）"])
  expect(THREE_VIEW_WORDS.missingTitle).toBe(`${THREE_VIEW_PLAIN}没有它，AI 只能照文字做，效果可能差一些。`)
  // The same words the app says before asking and Studio says if asked anyway.
  expect(THREE_VIEW_WORDS.beingMade).toBe(REFERENCE_REFUSALS.being_made)
  expect(THREE_VIEW_WORDS.beingMade).toBe("AI 正在做这一样，等这一次做完再换六视图。")
  expect(IMAGE_MODEL_WORDS).toEqual({ name: "画图模型", note: "用来画六视图。留空就用 gpt-image-1。", placeholder: "gpt-image-1" })
  // No word of the person's is the old name.
  for (const word of Object.values(THREE_VIEW_WORDS).flatMap((value) => (typeof value === "string" ? [value] : Object.values(value)))) expect(word).not.toContain("三视图")
})

test("a split 六视图 with some sides missing says which, the same way the making AI is told; a whole sheet or all six say nothing of it", async () => {
  const { coverWords, threeViewSlots } = await import("../src/renderer/features/three-view-model")
  const { threeViewCover } = await import("@minemods/studio-ai/making")
  const picture = (view: "front" | "left" | "quarter" | "sheet") => ({ kind: "three_view" as const, view })
  expect(coverWords(threeViewSlots([picture("front"), picture("left"), picture("quarter")]))).toBe("放了 3 / 6 个方向，还没放：背面、它的右侧、从上往下。没放的方向 AI 没有可对的，只能照说明自己推。")
  expect(coverWords(threeViewSlots([picture("sheet")]))).toBe("")
  expect(coverWords(threeViewSlots([]))).toBe("")
  expect(threeViewCover(["front", "left", "quarter"], ["back", "right", "top"])).toBe("这样东西的六视图是分开放的，放了3个方向：正面、它的左侧、斜前方；没放：背面、它的右侧、从上往下——这几面没有可对的，照部件说明和放了的几格推出来。")
  expect(threeViewCover(["sheet"], [])).toContain("一整张")
  expect(threeViewCover([], [])).toBe("")
})

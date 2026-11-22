import { REFERENCE_REFUSALS, SIX_VIEW_NAME, SIX_VIEW_WORDS, SIX_VIEWS, viewSlot, type SixView } from "@minemods/studio-ai/making"
import type { ReferenceImage, ThreeViewSlot } from "../../api"

/**
 * 六视图 (2026-10-08, the owner's request; three views until 03:16 that night, when the owner made it six "让 AI 有更深的理解"): pictures
 * of a thing the AI is about to build in 3D from the six angles every version is rendered from, which the making AI follows for shape
 * and proportion. Never required: without it the AI goes by words alone, and the person is told so once, before making starts.
 * Everything here is plain data and words. Code names keep "three view": the stored kind is still "three_view".
 */

/**
 * Only a model is built as a 3D shape. A creature is made as its own model (an item of kind "model" owned by the
 * creature), so the creature's 六视图 sits on that model; blocks, items, recipes and the rest are pictures or rules.
 */
export const wantsThreeView = (kind: string) => kind === "model"

/**
 * 六视图 is not a word a person knows (a13: "我不太懂「六视图」是什么，也没有现成的兔子图可以给它看"), so wherever it is met it says in
 * plain words what it is, from which angles, and that it is optional. One sentence, used by the question before making starts, the
 * card's mark and the block above the pictures, so they cannot drift apart. The angles are the ones the pictures are named by.
 */
export const THREE_VIEW_PLAIN = `${SIX_VIEW_NAME}是同一样东西从六个方向各画一张的图：${SIX_VIEWS.map((view) => SIX_VIEW_WORDS[view]).join("、")}。AI 做模型时照着它对形状和比例。它不是必须的：没有也能做，你可以自己放图，也可以让 AI 画。`

/** A slot the block shows: the whole sheet, or one of the six views. A `side` picture from three views is shown in the left one. */
export type ShownSlot = "sheet" | SixView

/** What the person reads about the 六视图, said the same way wherever it appears. The views are named as the renders of the same angle are. */
export const THREE_VIEW_WORDS = {
  title: SIX_VIEW_NAME,
  meaning: `${THREE_VIEW_PLAIN}没有它，AI 只能照文字做，效果可能差一些。`,
  layout: `${SIX_VIEW_NAME}怎么放`,
  whole: "一整张",
  split: "分六张",
  slots: { sheet: `一整张${SIX_VIEW_NAME}`, ...SIX_VIEW_WORDS } satisfies Record<ShownSlot, string>,
  how: "点空格子选一张图，也可以把图拖到格子上，或者直接粘贴。最好是正对着画的：每个方向一样的大小比例，没有透视和阴影；带透视的图，AI 只能自己估比例。",
  sheetOverSplit: "现在存着的是分开的几张；在这里放一整张，会替换掉分开的那几张。",
  splitOverSheet: "现在存着的是一整张；在这里放任何一张，会替换掉那一整张。",
  draw: `让 AI 画${SIX_VIEW_NAME}`,
  external: "交给外部 AI：能生图就生成并自动加入这里；不能生图会返回原因，需要独立准备。",
  copyTask: "复制六视图任务",
  copying: "正在准备任务…",
  copied: "任务已复制，发给外部 AI；生成的图片会自动出现在这里。",
  copyFailed: "未能写入剪贴板，可以选中下面的任务文字复制给外部 AI。",
  taskFailed: "没有取得六视图任务，请再试一次。",
  task: "六视图任务",
  note: "想补充的话（可选）",
  drawing: `正在画${SIX_VIEW_NAME}…（一般要一两分钟）`,
  drawn: "AI 画好了，看看像不像你想的样子。",
  keep: "就用这个",
  again: "再画一次",
  drop: "不要了",
  byAi: "AI 画的",
  byAiTitle: "这张不是你给的：是画图的 AI 照着说明画的",
  byPerson: "你给的",
  missing: `还没有${SIX_VIEW_NAME}（可不加）`,
  missingTitle: `${THREE_VIEW_PLAIN}没有它，AI 只能照文字做，效果可能差一些。`,
  beingMade: REFERENCE_REFUSALS.being_made,
  add: "加一张",
  adding: "正在加…",
  remove: "去掉这张",
  failedAdd: "这张图没有加上。",
  failedRemove: "这张图没有去掉，再试一次。",
  failedDraw: "这次没有画出来，可以再试一次。",
} as const

/** The pictures a thing has in each slot, and which way they are laid out (null: none yet). */
export type ThreeViewSlots<T> = { layout: "sheet" | "split" | null } & Record<ShownSlot, T | null>

/** A reference without a `view` predates separate views: it was always the whole sheet. A `side` from three views is its left. */
const slotOf = (reference: { view?: ThreeViewSlot }): ShownSlot => viewSlot(reference.view ?? "sheet")

/** Sorts an item's references into the slots, leaving out every other kind of picture. The last one in a slot wins. */
export function threeViewSlots<T extends { kind: ReferenceImage["kind"]; view?: ThreeViewSlot }>(references: readonly T[]): ThreeViewSlots<T> {
  const slots: ThreeViewSlots<T> = { layout: null, sheet: null, ...(Object.fromEntries(SIX_VIEWS.map((view) => [view, null])) as Record<SixView, null>) }
  for (const reference of references) if (reference.kind === "three_view") slots[slotOf(reference)] = reference
  slots.layout = SIX_VIEWS.some((view) => slots[view]) ? "split" : slots.sheet ? "sheet" : null
  return slots
}

/** The slots shown for a layout, in reading order: apart, the six three to a row, in the order of the six-angle renders. */
export const slotsOf = (layout: "sheet" | "split"): ShownSlot[] => (layout === "sheet" ? ["sheet"] : [...SIX_VIEWS])

export const hasThreeView = (references: readonly { kind: string }[] | undefined) => !!references?.some((reference) => reference.kind === "three_view")

/** Everything but the 六视图, for the 参考图 tray: the 六视图 has a block of its own and is never listed twice. */
export const besidesThreeView = <T extends { kind: string }>(references: readonly T[]) => references.filter((reference) => reference.kind !== "three_view")

/** Where a picture that was pasted or dropped on the block (not on a slot) goes: the slot pointed at, else the first empty one, else the first. */
export function slotFor<T>(slots: ThreeViewSlots<T>, layout: "sheet" | "split", aimed: ShownSlot | null): ShownSlot {
  const shown = slotsOf(layout)
  if (aimed && shown.includes(aimed)) return aimed
  return shown.find((slot) => !slots[slot]) ?? shown[0]!
}

/** A picture in another layout than the one shown is replaced by what is put here: said before it happens. */
export function replacedWords<T>(slots: ThreeViewSlots<T>, layout: "sheet" | "split") {
  if (layout === "sheet" && slots.layout === "split") return THREE_VIEW_WORDS.sheetOverSplit
  if (layout === "split" && slots.sheet) return THREE_VIEW_WORDS.splitOverSheet
  return ""
}

/**
 * How much of the six a split layout holds, said under the slots once at least one is there and not all: the AI has nothing to hold
 * the missing sides against and works them out from the words and the views given (the same text the making AI is told, `threeViewCover`).
 */
export function coverWords<T>(slots: ThreeViewSlots<T>) {
  if (slots.layout !== "split") return ""
  const missing = SIX_VIEWS.filter((view) => !slots[view])
  if (!missing.length) return ""
  return `放了 ${SIX_VIEWS.length - missing.length} / ${SIX_VIEWS.length} 个方向，还没放：${missing.map((view) => SIX_VIEW_WORDS[view]).join("、")}。没放的方向 AI 没有可对的，只能照说明自己推。`
}

/** Whether nothing has been made of this thing yet: what decides the overview card's 「还没有六视图」 and which things a whole plan's making starts on. */
export const notStarted = (item: { status: string; facts: { saved: boolean } }) => !item.facts.saved && item.status !== "making" && item.status !== "out_of_scope"

/**
 * The one rule for asking about a 六视图, wherever it would be asked (confirming the plan, 要重做, trying again, a note on a saved model):
 * ask only when there is nothing to go by yet. Not when the person already chose to have this thing made from words (`byWords`,
 * kept with the thing in the project, so a redo is not asked again either), and not when a model of it already exists
 * (`saved`): then the change goes by the model that is there and the person's own words.
 */
export const asksAboutThreeView = (item: { kind: string; saved?: boolean; byWords?: boolean; references?: readonly { kind: string }[] }) =>
  wantsThreeView(item.kind) && !item.saved && !item.byWords && item.references !== undefined && !hasThreeView(item.references)

/** The titles of the model things among `items` that the question is asked about (`asksAboutThreeView`). `references` absent means it could not be read: then nothing is said of it. */
export function missingThreeViews(items: readonly { title: string; kind: string; saved?: boolean; byWords?: boolean; references?: readonly { kind: string }[] }[]) {
  return items.filter(asksAboutThreeView).map((item) => item.title)
}

/**
 * The whole of the question, apart from the screen: which of `items` it is asked about (`asksAboutThreeView`), the question itself, and what is kept of the answer.
 * Answered 「直接开始」, each thing asked about is recorded as made from words (`choose`), so the same thing is not asked again, a redo included. Answered
 * 「先去加六视图」, nothing is recorded and `first` is the thing to take the person to. A thing whose pictures cannot be read is not asked about.
 */
export async function askAboutThreeViews<T extends { id: string; title: string; kind: string; facts?: { saved: boolean } }>(deps: {
  items: readonly T[]
  /** Whether the person already chose, for this item, to have it made from words. */
  byWords: (item: T) => Promise<boolean>
  /** The item's pictures; undefined when they cannot be read. */
  references: (item: T) => Promise<readonly { kind: string }[] | undefined>
  canDraw: () => Promise<boolean>
  ask: (question: ReturnType<typeof threeViewQuestion>) => Promise<boolean>
  choose: (item: T) => Promise<void>
}): Promise<{ go: true } | { go: false; first: T }> {
  const read = await Promise.all(
    deps.items
      .filter((item) => wantsThreeView(item.kind))
      .map(async (item) => ({ item, title: item.title, kind: item.kind, saved: !!item.facts?.saved, byWords: await deps.byWords(item).catch(() => false), references: await deps.references(item).catch(() => undefined) })),
  )
  const asked = read.filter(asksAboutThreeView)
  if (!asked.length) return { go: true }
  if (await deps.ask(threeViewQuestion(missingThreeViews(asked), await deps.canDraw()))) {
    await Promise.all(asked.map((entry) => deps.choose(entry.item).catch(() => undefined)))
    return { go: true }
  }
  return { go: false, first: asked[0]!.item }
}

/**
 * Names said in the warning before the rest are counted. Eight short titles fill about three lines of the question box
 * at its 1280×720 width (its text column holds some 30 characters a line), which keeps both buttons in view.
 */
export const NAMES_SAID = 8

/** The question asked before making starts on model things that have no 六视图. The safe answer goes to add one. */
export function threeViewQuestion(titles: readonly string[], canDraw: boolean) {
  const said = titles.slice(0, NAMES_SAID).map((title) => `「${title}」`).join("")
  const more = titles.length > NAMES_SAID ? `等 ${titles.length} 样` : ""
  const which = titles.length === 1 ? `${said}还没有${SIX_VIEW_NAME}。` : `下面这几样还没有${SIX_VIEW_NAME}：${said}${more}。`
  return {
    title: `还没有${SIX_VIEW_NAME}`,
    lines: [`${which}${THREE_VIEW_PLAIN}没有它，AI 只能照文字做，形状和比例可能和你想的差得比较远；具体效果看所用 AI 模型的能力。`, ...(canDraw ? [`也可以让 AI 先把${SIX_VIEW_NAME}画出来，你看过再开始。`] : [])],
    confirm: "直接开始",
    cancel: `先去加${SIX_VIEW_NAME}`,
  }
}

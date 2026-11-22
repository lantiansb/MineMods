import type { FindingTarget } from "@minemods/mod-core/reconcile"
import { fixItem, type FixItem } from "./fix-findings"
import { HAND_WORDS, isHandKind } from "./renderer/features/asset-edit-words"

/**
 * Where a finding's button takes the person. A finding that asks them to fill something in names its field (`FindingTarget`);
 * this decides how the window opens that field, once, for every place that lists findings (the build panel, the overview's
 * mod guide, the 能不能玩 list), so a hint can never again point at a place that does not exist (round 19: the English-name
 * hint said "在卡片的高级里填" and the field was nowhere). Pure, and no window: the window only acts on the answer.
 */

/**
 * Fields that also sit on the thing's card, in the open. They are where a thing with no editor of its own is filled in (content kept from before
 * assets existed); a thing saved as an asset is filled in in its own editor, which carries the same field (`formCarries`).
 */
export const CARD_FIELDS: readonly string[] = ["name_en"]

/** Whether the form of a saved kind of thing (its workspace module) has this field, or the field above it (`drop_item.item` is only on the form while `drop` says so). */
export function formCarries(module: string, field: string) {
  if (!isHandKind(module)) return false
  return HAND_WORDS[module].some((section) => section.fields.some((one) => one.path === field || field.startsWith(`${one.path}.`)))
}

export const GO_WORDS = {
  /** The thing the finding is about is not in the project any more (deleted since the check). */
  gone: "工程里已经找不到这样东西了，可能刚被删掉。重新打包检查一遍，这条提醒就会更新。",
  /** A thing from before things had pages of their own has no form to fill in. */
  noForm: "这样东西是早先做的，没有能直接改的表格。想改它，让 AI 来改。",
  /** Said under the opened field, so the person knows why they were brought here. */
  here: (label: string) => `${label}：就在下面这一栏。`,
} as const

export type Place =
  /** The thing's card in the overview opens, and the field on it is focused. Only for a thing with no editor of its own, or when no field is named. */
  | { how: "card"; itemId: string; field: string }
  /** The thing's own form opens on its edit tab with the field focused. */
  | { how: "form"; itemId: string; field: string }
  | { how: "none"; why: string }

/**
 * `formOf` says which editor the window has for a thing: the kind of the thing's own saved asset (its workspace module) when it has one, null for a thing
 * with none (content kept from before assets existed, or a plan entry not made yet). It is the window's own fact, so it is asked through a function rather
 * than guessed from the item here. The asset decides, never the plan's card: a saved thing that the newest plan sets aside (「这次不做」) still has its
 * own editor, and the card of such a plan entry is only the reason it is set aside, with nothing to fill in.
 */
export function placeOf<Item extends FixItem>(target: Pick<FindingTarget, "about" | "field">, items: readonly Item[], formOf: (item: Item) => string | null): Place {
  const item = fixItem(target.about, items)
  if (!item) return { how: "none", why: GO_WORDS.gone }
  // No field named: the card itself is the place (a failed build that stopped on a creature with no model leads to its card, where the model is made).
  if (!target.field) return { how: "card", itemId: item.id, field: target.field }
  const module = formOf(item)
  if (module && formCarries(module, target.field)) return { how: "form", itemId: item.id, field: target.field }
  return CARD_FIELDS.includes(target.field) && !module ? { how: "card", itemId: item.id, field: target.field } : { how: "none", why: GO_WORDS.noForm }
}

/** The element of a field, looked for by its path and then by the paths above it (`drop_item.item` is only on the form while `drop` says so; `drop` is always there). */
export function fieldSelector(field: string) {
  const parts = field.split(".")
  return parts.map((_, length) => `[data-field="${parts.slice(0, parts.length - length).join(".")}"]`)
}

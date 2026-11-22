import type { Project } from "@minemods/mod-core/project"
import { EnglishNameSchema, hasCjk } from "@minemods/mod-core/data-words"
import type { OverviewItem } from "../../api"

/**
 * The English-name box on a card: which thing of the project a card stands for, what the box says, and what is wrong with what was typed.
 * Apart from the component so it is tested without a window.
 */

export const ENGLISH_WORDS = {
  label: "英文名",
  help: "英文版游戏里显示的名字，例如 Azure Ore。不写的话，英文版里显示的也是中文名。",
  /** A name with no Chinese in it reads the same in both games. */
  notNeeded: "它的名字里没有中文，英文版里就是这个名字，可以不填。",
  save: "保存英文名",
  saving: "正在保存…",
  saved: "英文名已保存。重新打包以后，英文版游戏里才会用上。",
  cleared: "英文名已去掉。重新打包以后生效。",
  failed: "没保存成功，过一会儿再试。",
} as const

export type EnglishThing = { kind: "entity" | "block" | "item"; id: string; name: string; nameEn: string }

/**
 * The block, item or creature a card shows, by the same pointers the overview gives for it: a creature by its entity id (or, with no model yet, by its card's id), the others by
 * their asset id, or by the id after the colon for content from before assets existed. Null for any other kind of card.
 */
export function englishThing(project: Pick<Project, "blocks" | "items" | "entities">, item: Pick<OverviewItem, "id" | "asset_id" | "kind" | "preview">): EnglishThing | null {
  if (item.kind === "entity") {
    // The preview pointer names a creature only once it has a model (it says what to draw). A creature made by hand and not modelled yet has
    // nothing to draw but is still its own card, `entity:<id>`; leaving it out meant the name a finding asked for had no box to be typed in.
    const id = item.preview.entity_id ?? (item.asset_id === null && item.id.startsWith("entity:") ? item.id.slice("entity:".length) : null)
    const found = id ? project.entities.find((entity) => entity.id === id) : undefined
    return found ? { kind: "entity", id: found.id, name: found.name, nameEn: found.name_en ?? "" } : null
  }
  if (item.kind !== "block" && item.kind !== "item") return null
  const id = item.asset_id ?? item.id.split(":")[1]
  const found = (item.kind === "block" ? project.blocks : project.items).find((entry) => entry.id === id)
  return found ? { kind: item.kind, id: found.id, name: found.name, nameEn: found.name_en ?? "" } : null
}

/** What is wrong with the typed name, in the schema's own sentence; empty when it can be saved (an empty box takes the name away). */
export function englishProblem(text: string) {
  const typed = text.trim()
  if (!typed) return ""
  const parsed = EnglishNameSchema.safeParse(typed)
  return parsed.success ? "" : (parsed.error.issues[0]?.message ?? ENGLISH_WORDS.failed)
}

/** The words under the box before anything is typed. */
export const englishHint = (thing: Pick<EnglishThing, "name" | "nameEn">) => (!thing.nameEn && !hasCjk(thing.name) ? ENGLISH_WORDS.notNeeded : ENGLISH_WORDS.help)

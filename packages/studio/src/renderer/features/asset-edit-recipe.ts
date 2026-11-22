/**
 * 「自己改」: the things a field can name (this mod's blocks and items, the game's own items by their Chinese
 * names, and groups of items such as 「任意木板」), how each kind of field writes the one it names, and a recipe
 * document read as the slots its station has.
 * No Node APIs.
 */
import type { Project } from "@minemods/mod-core/project"
import { RECIPE_KINDS, referenceWords, type RecipeKind } from "@minemods/mod-core/content-words"
import { CONVENTION_ITEM_TAGS, MINECRAFT_ITEM_TAGS, VANILLA_ITEM_NAMES } from "@minemods/mod-core/fabric/content-vanilla"
import { initialRecipeState } from "./recipe-state"
import { resolveRecipeItem } from "./recipe-text"
import { SMITHING_SLOTS, settle, type Loose } from "./asset-edit-words"

/** `id` is how a recipe writes it: `mod:name`, `minecraft:name`, or `#namespace:tag`. `named`: it has a name a player knows. */
export type Thing = { id: string; name: string; from: "own" | "vanilla" | "tag"; named: boolean; color?: string; texture?: string }
/** What a field takes, and so how it writes it (see `Word.as`). */
export type ThingMode = "ingredient" | "result" | "own" | "loot"

const TAGGED = "任意"

/** Everything a field of this project can name: its own things first, then the game's items, then groups of items. */
export function catalog(project: Pick<Project, "mod_id" | "blocks" | "items">): Thing[] {
  const tags = [...[...MINECRAFT_ITEM_TAGS].map((tag) => `#minecraft:${tag}`), ...[...CONVENTION_ITEM_TAGS].map((tag) => `#c:${tag}`)]
  return [
    ...[...project.items, ...project.blocks].map((value): Thing => ({ id: `${project.mod_id}:${value.identifier}`, name: value.name, from: "own", named: true, color: value.color, ...(value.texture ? { texture: value.texture } : {}) })),
    ...Object.entries(VANILLA_ITEM_NAMES).map(([id, name]): Thing => ({ id: `minecraft:${id}`, name, from: "vanilla", named: true })),
    // A group whose plain name mod-core knows reads 「任意木板」; any other is only known by its tag, a modder's word.
    ...tags.map((id): Thing => {
      const words = referenceWords(id, project.mod_id, () => null)
      const named = !words.includes(id)
      return { id, name: named ? words : `${TAGGED}带 ${id.slice(1)} 标签的物品`, from: "tag", named }
    }),
  ]
}

/** The things a field of this mode may name. `except`: the short name of the thing being edited, which cannot name itself. */
export function offered(things: readonly Thing[], mode: ThingMode, options: { advanced: boolean; except?: string; modId: string }) {
  return things.filter((thing) => {
    if (thing.from === "tag") return mode === "ingredient" && (thing.named || options.advanced)
    if (thing.from === "vanilla") return mode !== "own"
    return thing.id !== `${options.modId}:${options.except ?? ""}`
  })
}

/** How a field of this mode writes a thing: a block's drop and a creature's loot name this mod's things without its prefix. */
export const toValue = (mode: ThingMode, modId: string, id: string) => ((mode === "own" || mode === "loot") && id.startsWith(`${modId}:`) ? id.slice(modId.length + 1) : id)
/** The thing a field's value names, as the catalog knows it. */
export const fromValue = (mode: ThingMode, modId: string, value: string) => ((mode === "own" || mode === "loot") && value && !value.includes(":") ? `${modId}:${value}` : value)

// As many as a list a person will read through; a longer one means the search words are too few.
export const SEARCH_LIMIT = 60

/** The things a few typed characters find, by Chinese name or by id: this mod's own first, then names that start with the words. */
export function search(things: readonly Thing[], query: string, limit = SEARCH_LIMIT) {
  const words = query.trim().toLowerCase()
  const rank = (thing: Thing) => (thing.from === "own" ? 0 : 3) + (thing.name.toLowerCase().startsWith(words) ? 0 : thing.name.toLowerCase().includes(words) ? 1 : 2)
  const found = words ? things.filter((thing) => thing.name.toLowerCase().includes(words) || thing.id.toLowerCase().includes(words)) : [...things]
  return found.map((thing, index) => ({ thing, index })).sort((left, right) => rank(left.thing) - rank(right.thing) || left.index - right.index).slice(0, limit).map((value) => value.thing)
}

export const NAMELESS = "一样认不出的东西"
/** A field's value by the name a player knows it by; its id only with 高级 on. Empty when nothing is named. */
export function thingName(things: readonly Thing[], mode: ThingMode, modId: string, value: string | null | undefined, advanced: boolean) {
  if (!value) return ""
  const id = fromValue(mode, modId, value)
  const thing = things.find((candidate) => candidate.id === id)
  return thing ? `${thing.name}${advanced ? `（${id}）` : ""}` : advanced ? id : NAMELESS
}

/**
 * A name or a full id typed by hand (高级) as the value a field of this mode stores, or why it cannot be taken.
 * `things` is what the field offers: nothing outside it is accepted, so a typed id is held to the same list a pick is.
 */
export function typedThing(text: string, things: readonly Thing[], mode: ThingMode, modId: string): { value: string | null } | { error: string } {
  const input = text.trim()
  const tag = input.startsWith("#")
  const read = resolveRecipeItem(tag ? input.slice(1) : input, things.filter((thing) => (thing.from === "tag") === tag).map((thing) => ({ id: thing.id.replace(/^#/, ""), name: thing.name })))
  if (read.error !== undefined) return { error: read.error }
  if (!read.value) return { value: null }
  const id = `${tag ? "#" : ""}${read.value}`
  return things.some((thing) => thing.id === id) ? { value: toValue(mode, modId, id) } : { error: `找不到「${input}」：这里只能填列表里有的东西。` }
}

const kindOf = (document: Loose) => (document.type ?? "shaped") as RecipeKind

/** A recipe as the slots of its station: nine on a workbench (three across), one in a furnace or a stonecutter, three on a smithing table, each with what it is for. */
export function gridOf(document: Loose): { slots: (string | null)[]; labels: readonly string[]; columns: number; ordered: boolean } {
  const slots = RECIPE_KINDS[kindOf(document)].slots
  const nine = initialRecipeState({ pattern: Array.isArray(document.pattern) ? (document.pattern as (string | null)[]) : [] }).stencil
  if (slots === "one") return { slots: nine.slice(0, 1), labels: ["材料"], columns: 1, ordered: true }
  if (slots === "three") return { slots: nine.slice(0, 3), labels: SMITHING_SLOTS, columns: 3, ordered: true }
  return { slots: nine, labels: [], columns: 3, ordered: slots === "grid" }
}

export const CRAFTING = "合成"
/**
 * A recipe as a reader sees it on its station: the same slots as `gridOf`, except that a recipe whose places do
 * not count has its things moved up to the first slots in the order they were written, the way the game's recipe
 * book shows one. `title` is what stands beside the slots: the workbench's 「合成」, or the name of any other station.
 */
export function benchOf(document: Loose) {
  const grid = gridOf(document)
  const kind = RECIPE_KINDS[kindOf(document)]
  const filled = grid.slots.filter((slot) => slot !== null)
  return { ...grid, slots: grid.ordered ? grid.slots : [...filled, ...grid.slots.slice(filled.length).map(() => null)], title: kind.slots === "grid" || kind.slots === "any" ? CRAFTING : kind.station }
}
/** The recipe with one slot of its station set (null empties it), written back as the nine slots a document holds. */
export function withSlot(document: Loose, index: number, value: string | null): Loose {
  const nine = initialRecipeState({ pattern: Array.isArray(document.pattern) ? (document.pattern as (string | null)[]) : [] }).stencil
  return settle("recipe", { ...document, pattern: nine.map((slot, position) => (position === index ? value : slot)) })
}

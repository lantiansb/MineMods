import { VANILLA_CRAFTING } from "./fabric/vanilla-crafting"
import { VANILLA_ITEM_NAMES } from "./fabric/content-vanilla"
import { referenceWords } from "./content-words"
import type { Project } from "./project"

/**
 * A crafting recipe of a project that takes the same things as another crafting recipe: one of the game's own
 * (`fabric/vanilla-crafting.ts`, read out of the 1.21.1 jar by `script/vanilla-crafting.ts`) or another of the project's.
 * The grid hands the player's items to the first recipe that fits, so the second recipe is never made: broad8 w3 laid three
 * bricks in the shape of a flower pot and got the game's flower pot, and put one sunflower in the grid and got yellow dye.
 * No Node APIs: the app's window reads it too.
 */

/**
 * The shape of the generated table (the script says how it is made). Every item is written once in `items` and elsewhere by its number there.
 * `sets` are ingredients: item numbers, and a tag as -1 minus its number in `tags`; the recipes point into them, -1 for an empty cell.
 */
export type VanillaCrafting = {
  items: string[]
  /** Every item tag of the game, resolved down to item numbers. */
  tags: [string, number[]][]
  sets: number[][]
  /** Result, width, and the cells row by row (the height follows). */
  shaped: [number, number, number[]][]
  /** Result, and the ingredients. */
  shapeless: [number, number[]][]
}

/** What one recipe asks of the crafting grid: a trimmed shape, or only the things (shapeless). A cell is the item ids that fit it, null for an empty one. */
type Grid = { shaped: true; width: number; cells: (ReadonlySet<string> | null)[] } | { shaped: false; cells: ReadonlySet<string>[] }

/** The recipe fields the comparison reads. Only the crafting kinds (shaped, shapeless) compete for the grid; any other kind is never in a clash. */
export type ClashRecipe = { id: string; name: string; type?: string | undefined; pattern: readonly (string | null)[]; result: string; count: number }

const tags = new Map(VANILLA_CRAFTING.tags.map(([name, items]) => [name, items.map((item) => `minecraft:${VANILLA_CRAFTING.items[item]}`)]))

/**
 * The item ids a recipe reference stands for, namespaced: an item is itself, a tag of the game is the items it holds. A tag the game does not
 * have (a Fabric convention tag: its members come from Fabric's data, not the game's) stands for nothing but itself, so it can only be in a clash
 * with the same tag.
 */
function itemsOf(reference: string): ReadonlySet<string> {
  if (!reference.startsWith("#minecraft:")) return new Set([reference])
  const members = tags.get(reference.slice("#minecraft:".length))
  return members ? new Set(members) : new Set([reference])
}

let table: { result: string; grid: Grid }[] | null = null
/** The game's recipes as grids, made on first use. */
function vanilla() {
  if (table) return table
  const { items, sets: numbered } = VANILLA_CRAFTING
  const sets = numbered.map((set) => new Set(set.flatMap((entry) => (entry < 0 ? [...itemsOf(`#minecraft:${VANILLA_CRAFTING.tags[-1 - entry]![0]}`)] : [`minecraft:${items[entry]}`]))))
  return (table = [
    ...VANILLA_CRAFTING.shaped.map(([result, width, cells]): { result: string; grid: Grid } => ({ result: items[result]!, grid: { shaped: true, width, cells: cells.map((cell) => (cell < 0 ? null : sets[cell]!)) } })),
    ...VANILLA_CRAFTING.shapeless.map(([result, ingredients]): { result: string; grid: Grid } => ({ result: items[result]!, grid: { shaped: false, cells: ingredients.map((cell) => sets[cell]!) } })),
  ])
}

/**
 * What a project recipe asks of the grid, or null for a kind that is not made on it. The game trims the empty rows and columns around a
 * shaped recipe and lets it sit anywhere on the grid (or mirrored), so only the trimmed shape counts.
 */
export function gridOf(recipe: Pick<ClashRecipe, "type" | "pattern">): Grid | null {
  const kind = recipe.type ?? "shaped"
  if (kind === "shapeless") return { shaped: false, cells: recipe.pattern.flatMap((reference) => (reference === null ? [] : [itemsOf(reference)])) }
  if (kind !== "shaped") return null
  // The nine slots are the grid row by row: three to a row.
  const filled = recipe.pattern.flatMap((reference, slot) => (reference === null ? [] : [{ row: Math.floor(slot / 3), column: slot % 3 }]))
  const rows = [Math.min(...filled.map((slot) => slot.row)), Math.max(...filled.map((slot) => slot.row))] as const
  const columns = [Math.min(...filled.map((slot) => slot.column)), Math.max(...filled.map((slot) => slot.column))] as const
  const cells = Array.from({ length: rows[1] - rows[0] + 1 }, (_, row) => Array.from({ length: columns[1] - columns[0] + 1 }, (_, column) => recipe.pattern[(rows[0] + row) * 3 + columns[0] + column]!)).flat()
  return { shaped: true, width: columns[1] - columns[0] + 1, cells: cells.map((reference) => (reference === null ? null : itemsOf(reference))) }
}

/** Whether some item fits both cells: the player's item can then be taken by either recipe. */
const overlap = (left: ReadonlySet<string>, right: ReadonlySet<string>) => [...left].some((item) => right.has(item))

/** Whether the things of one can be paired off with the things of the other, one to one, each pair sharing an item that fits both (augmenting paths). */
function pairsOff(left: readonly ReadonlySet<string>[], right: readonly ReadonlySet<string>[]) {
  if (left.length !== right.length) return false
  const taken: number[] = Array.from({ length: right.length }, () => -1)
  const place = (from: number, tried: Set<number>): boolean =>
    right.some((_, to) => {
      if (tried.has(to) || !overlap(left[from]!, right[to]!)) return false
      tried.add(to)
      if (taken[to]! >= 0 && !place(taken[to]!, tried)) return false
      taken[to] = from
      return true
    })
  return left.every((_, from) => place(from, new Set()))
}

const filledCells = (grid: Grid) => (grid.cells as (ReadonlySet<string> | null)[]).filter((cell): cell is ReadonlySet<string> => cell !== null)

/**
 * Whether the same items put on the crafting grid are taken by both recipes. Two shaped recipes: the trimmed shapes are the same size and, as
 * they lie or mirrored left to right, every cell of one shares an item with the cell of the other (an empty cell only with an empty one). When
 * either is shapeless the arrangement does not matter, so the things must pair off one to one.
 */
export function sameOnGrid(left: Grid, right: Grid) {
  if (left.shaped && right.shaped) {
    if (left.cells.length !== right.cells.length || left.width !== right.width) return false
    const mirrored = right.cells.map((_, index) => right.cells[Math.floor(index / right.width) * right.width + right.width - 1 - (index % right.width)]!)
    return [right.cells, mirrored].some((cells) => left.cells.every((cell, index) => (cell === null || cells[index] === null ? cell === cells[index] : overlap(cell, cells[index]!))))
  }
  return pairsOff(filledCells(left), filledCells(right))
}

/** The game's recipes that take what this project recipe takes, by the item each makes (bare name, no repeats). */
export function vanillaClashes(recipe: Pick<ClashRecipe, "type" | "pattern">): string[] {
  const grid = gridOf(recipe)
  return grid ? [...new Set(vanilla().filter((other) => sameOnGrid(grid, other.grid)).map((other) => other.result))].sort() : []
}

/** How many of the game's items to name in one sentence. */
const NAMED = 3
const quoted = (names: readonly string[]) => `${names.slice(0, NAMED).map((name) => `「${name}」`).join("、")}${names.length > NAMED ? `等 ${names.length} 种` : ""}`

export type Clash = {
  /** What it clashes with: the game's own recipe, or another recipe of the project (by its id). */
  with: { kind: "vanilla"; results: string[] } | { kind: "project"; id: string }
  /** The made thing is never made, or made as something else: the build's finding stops. Two recipes that make the very same thing only repeat each other. */
  stops: boolean
  text: string
  fix: string
}

/**
 * The clashes of one project recipe: with the game's own crafting recipes, and with the others given (the caller says which: all of them
 * when a recipe is saved, only the earlier ones when the whole project is read, so a pair is said once). `nameOf` says one of the project's
 * references the way a player knows it.
 */
export function recipeClashes(recipe: ClashRecipe, others: readonly ClashRecipe[], nameOf: (reference: string) => string): Clash[] {
  const grid = gridOf(recipe)
  if (!grid) return []
  // Said as what makes them the same: with a shape on both sides the way it is laid out counts, otherwise only the things.
  const same = (other: Grid | null) => (grid.shaped && other?.shaped ? "材料和摆法" : "材料")
  const gameNames = vanillaClashes(recipe).map((result) => VANILLA_ITEM_NAMES[result] ?? `minecraft:${result}`)
  const game: Clash[] = gameNames.length
    ? [
        {
          with: { kind: "vanilla", results: vanillaClashes(recipe) },
          stops: true,
          text: `配方「${recipe.name}」的${grid.shaped ? "材料和摆法" : "材料"}和原版的${quoted(gameNames)}配方一样：玩家在工作台上这样放，游戏先认出的是原版的配方，做出来的是原版的物品，不是${nameOf(recipe.result)}。`,
          fix: `换掉其中一种材料，或者换一种摆法（多放一格、少放一格也行），让它和原版的配方不一样。`,
        },
      ]
    : []
  const own = others.flatMap((other): Clash[] => {
    const theirs = gridOf(other)
    if (other.id === recipe.id || !theirs || !sameOnGrid(grid, theirs)) return []
    const alike = recipe.result === other.result && recipe.count === other.count
    return [
      {
        with: { kind: "project", id: other.id },
        stops: !alike,
        text: alike
          ? `配方「${recipe.name}」和配方「${other.name}」的${same(theirs)}一样，做出来的也一样（${recipe.count} 个${nameOf(recipe.result)}），重复了一份。`
          : `配方「${recipe.name}」和配方「${other.name}」的${same(theirs)}一样，可是一个做${nameOf(recipe.result)}，一个做${nameOf(other.result)}：玩家这样放，只会做出其中一个，另一个永远做不出来。`,
        fix: alike ? "删掉其中一个。" : "换掉其中一个配方的一种材料，或者换一种摆法，让两个配方不一样。",
      },
    ]
  })
  return [...game, ...own]
}

/** One thing a recipe names, the way a player says it: 「蓝晶块」, 「面包」, 「任意木板」. */
export const recipeThing = (project: Pick<Project, "mod_id" | "blocks" | "items">, reference: string) => {
  const words = referenceWords(reference, project.mod_id, (identifier) => [...project.blocks, ...project.items].find((value) => value.identifier === identifier)?.name ?? null)
  return words.startsWith("「") ? words : `「${words}」`
}

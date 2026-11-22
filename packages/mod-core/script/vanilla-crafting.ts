import { readFileSync, writeFileSync } from "node:fs"
import { strFromU8, unzipSync } from "fflate"

/**
 * Writes `src/fabric/vanilla-crafting.ts`: the crafting recipes of Minecraft 1.21.1 that the table can hold, read out of the game's own jar
 * (`data/minecraft/recipe`), so a recipe of a project can be held against them (`recipe-clash.ts`). It is game data, not art.
 *
 *   bun script/vanilla-crafting.ts [path to a 1.21.1 game jar that holds data/: minecraft-merged-… or minecraft-common-…]
 *
 * Left out, the jar is the common half of the game on Fabric's compile class path (`fabric-1.21.1-official.txt` under
 * MINEMODS_TARGET_CLASSPATH). The data files are the same in every jar of the game, whatever names its classes have.
 *
 * What is kept, to keep the file small: only `crafting_shaped` and `crafting_shapeless` (the other kinds are cooked, cut or smithed at
 * a station of their own and never compete for the crafting grid; the `crafting_special_*` and `crafting_decorated_pot` recipes are code,
 * not data, and cannot be listed). Of each, the result, the shape and what each cell takes. Every item is written once, in `items`, and
 * everywhere else by its number there; what a cell takes is an ingredient set (`sets`): item numbers, and a tag as -1 minus its number in
 * `tags`. `tags` holds every item tag of the game (the ones a project may name), each already followed down to items. Everything is sorted
 * and without repeats, so regenerating from the same jar gives the same file.
 */

const DEFAULT_JAR = () =>
  readFileSync(`${process.env.MINEMODS_TARGET_CLASSPATH ?? "."}/fabric-1.21.1-official.txt`, "utf8")
    .split(/\r?\n/)
    .find((jar) => /[\\/]minecraft-common-[^\\/]*\.jar$/.test(jar)) ?? ""
/** Where the file is written, relative to this folder. */
export const VANILLA_CRAFTING_FILE = "../src/fabric/vanilla-crafting.ts"

type Ingredient = { item?: string; tag?: string } | readonly { item?: string; tag?: string }[]
type Tag = { values: (string | { id: string })[] }

const bare = (id: string) => (id.startsWith("minecraft:") ? id.slice("minecraft:".length) : id)

/** The file's text, made from the game jar at `jar`. */
export function vanillaCraftingFile(jar: string = DEFAULT_JAR()) {
  const files = unzipSync(new Uint8Array(readFileSync(jar)), { filter: (file) => /^data\/minecraft\/(recipe|tags\/item)\/.*\.json$/.test(file.name) })
  const json = <Value>(name: string) => JSON.parse(strFromU8(files[name]!)) as Value
  const names = (folder: string) => Object.keys(files).filter((name) => name.startsWith(`data/minecraft/${folder}/`)).sort()
  const rawTags = new Map(names("tags/item").map((name) => [name.slice("data/minecraft/tags/item/".length, -".json".length), json<Tag>(name)] as const))
  /** The items a tag comes to, tags inside it followed down. */
  const resolve = (tag: string, seen: readonly string[] = []): string[] => {
    if (seen.includes(tag)) throw new Error(`The item tag ${tag} contains itself.`)
    const found = rawTags.get(tag)
    if (!found) throw new Error(`The item tag ${tag} is named but the jar has no such file.`)
    return found.values.flatMap((value) => {
      const id = typeof value === "string" ? value : value.id
      return id.startsWith("#minecraft:") ? resolve(id.slice("#minecraft:".length), [...seen, tag]) : [bare(id)]
    })
  }
  const tagNames = [...rawTags.keys()].sort()
  const tagItems = tagNames.map((tag) => [...new Set(resolve(tag))].sort())

  // Recipes first, as names: the item numbers are given out once every name that will be written is known.
  const sets: string[][] = []
  const setIndex = new Map<string, number>()
  /** An ingredient as the index of its set: items by name, tags as `#name`, the whole sorted and without repeats. */
  const index = (ingredient: Ingredient) => {
    const set = [...new Set((Array.isArray(ingredient) ? ingredient : [ingredient]).map((entry: { item?: string; tag?: string }) => (entry.tag ? `#${bare(entry.tag)}` : bare(entry.item!))))].sort()
    const key = JSON.stringify(set)
    if (!setIndex.has(key)) setIndex.set(key, sets.push(set) - 1)
    return setIndex.get(key)!
  }

  const shaped: [string, number, number[]][] = []
  const shapeless: [string, number[]][] = []
  for (const name of names("recipe")) {
    const recipe = json<{ type: string; key?: Record<string, Ingredient>; pattern?: string[]; ingredients?: Ingredient[]; result?: { id: string } }>(name)
    if (recipe.type !== "minecraft:crafting_shaped" && recipe.type !== "minecraft:crafting_shapeless") continue
    const result = bare(recipe.result!.id)
    if (recipe.type === "minecraft:crafting_shaped")
      shaped.push([result, recipe.pattern![0]!.length, recipe.pattern!.flatMap((row) => [...row].map((cell) => (cell === " " ? -1 : index(recipe.key![cell]!))))])
    else shapeless.push([result, recipe.ingredients!.map(index).sort((left, right) => left - right)])
  }
  // The same result from the same cells twice (two recipe files for one thing) is one entry.
  const once = <Entry>(list: Entry[]) => [...new Map(list.map((entry) => [JSON.stringify(entry), entry])).values()]
  const items = [...new Set([...tagItems.flat(), ...sets.flat().filter((entry) => !entry.startsWith("#")), ...shaped.map((entry) => entry[0]), ...shapeless.map((entry) => entry[0])])].sort()
  const number = (item: string) => items.indexOf(item)
  const table = {
    items,
    tags: tagNames.map((tag, at) => [tag, tagItems[at]!.map(number)]),
    sets: sets.map((set) => set.map((entry) => (entry.startsWith("#") ? -1 - tagNames.indexOf(entry.slice(1)) : number(entry)))),
    shaped: once(shaped).map(([result, width, cells]) => [number(result), width, cells]),
    shapeless: once(shapeless).map(([result, ingredients]) => [number(result), ingredients]),
  }

  return `// Generated by script/vanilla-crafting.ts from the Minecraft 1.21.1 jar; never edited by hand. test/recipe-clash.test.ts holds this file to the jar.
// The crafting_shaped and crafting_shapeless recipes of the game: what each makes and what each cell takes. See the script for what is left out and why.
import type { VanillaCrafting } from "../recipe-clash"

// prettier-ignore
export const VANILLA_CRAFTING: VanillaCrafting = ${JSON.stringify(table)}
`
}

if (import.meta.main) {
  const text = vanillaCraftingFile(process.argv[2])
  writeFileSync(new URL(VANILLA_CRAFTING_FILE, import.meta.url), text)
  console.log(`${text.length} characters written`)
}

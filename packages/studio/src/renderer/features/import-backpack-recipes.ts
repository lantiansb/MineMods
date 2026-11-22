/** Reads recipe and drop-table files by the shape of their JSON, so any mod's files can be drawn. */

export type RecipePart = {
  /** "namespace:name" of an item, or of a tag when `tag` is set. */
  id: string
  tag: boolean
  count: number
  /** How many other things would do as well. */
  others: number
}
export type RecipeView = {
  layout: "grid" | "single" | "smithing" | "row"
  /** Where it is made, in plain words; empty when the file does not say. */
  station: string
  /** Row by row, `width` cells per row; only for the "grid" layout. */
  cells: (RecipePart | null)[]
  width: number
  /** The materials can go in any slot. */
  free: boolean
  inputs: RecipePart[]
  result: RecipePart | null
  seconds: number | null
}
export type LootDrop = RecipePart & { min: number; max: number }

type Json = Record<string, unknown>

const idPattern = /^[a-z0-9_.-]{1,128}:[a-z0-9_./-]{1,128}$/
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)

const stations: Record<string, string> = {
  crafting_shaped: "工作台",
  crafting_shapeless: "工作台",
  smelting: "熔炉",
  blasting: "高炉",
  smoking: "烟熏炉",
  campfire_cooking: "营火",
  stonecutting: "切石机",
  smithing: "锻造台",
  smithing_transform: "锻造台",
  smithing_trim: "锻造台",
}

function named(text: string, count: number): RecipePart | null {
  const tag = text.startsWith("#")
  const bare = (tag ? text.slice(1) : text).trim().toLowerCase()
  const id = bare.includes(":") ? bare : `minecraft:${bare}`
  return idPattern.test(id) && !id.includes("..") ? { id, tag, count, others: 0 } : null
}

/** One ingredient or result, in any of the spellings recipe files use. */
export function readPart(value: unknown, depth = 0): RecipePart | null {
  if (depth > 4) return null
  if (typeof value === "string") return named(value, 1)
  if (Array.isArray(value)) {
    const options = value.flatMap((entry) => readPart(entry, depth + 1) ?? [])
    return options[0] ? { ...options[0], others: options.length - 1 } : null
  }
  if (!isObject(value)) return null
  const amount = typeof value.count === "number" && value.count > 0 ? Math.floor(value.count) : 1
  for (const key of ["item", "id", "block", "name"]) {
    if (typeof value[key] === "string") return named(value[key], amount)
  }
  if (typeof value.tag === "string") return named(`#${value.tag.replace(/^#/, "")}`, amount)
  for (const key of ["ingredient", "items"]) {
    const inner = readPart(value[key], depth + 1)
    if (inner) return { ...inner, count: inner.count > 1 ? inner.count : amount }
  }
  return null
}

const readParts = (value: unknown): RecipePart[] =>
  (Array.isArray(value) ? value : [value]).flatMap((entry) => readPart(entry) ?? [])

function readGrid(recipe: Json) {
  const rows = Array.isArray(recipe.pattern) ? recipe.pattern.filter((row) => typeof row === "string") : []
  const key = isObject(recipe.key) ? recipe.key : null
  if (!rows.length || !key) return null
  const width = Math.max(3, ...rows.map((row) => row.length))
  const height = Math.max(3, rows.length)
  if (width > 9 || height > 9) return null
  const cells: (RecipePart | null)[] = []
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const symbol = rows[row]?.[column]
      cells.push(symbol && symbol !== " " ? readPart(key[symbol]) : null)
    }
  }
  return { cells, width }
}

/** Mod loaders wrap a recipe that only applies under some condition; the first variant is the one shown. */
function unwrap(value: unknown, depth = 0): Json | null {
  if (!isObject(value)) return null
  const variants = Array.isArray(value.recipes) ? value.recipes : []
  const inner = variants.map((entry) => (isObject(entry) ? entry.recipe : null)).find(isObject)
  if (inner && depth < 3 && /(^|:)conditional$/.test(String(value.type ?? ""))) return unwrap(inner, depth + 1)
  return value
}

const total = (parts: (RecipePart | null)[]) => {
  const sums = new Map<string, RecipePart>()
  parts.forEach((part) => {
    if (!part) return
    const key = `${part.tag ? "#" : ""}${part.id}`
    const known = sums.get(key)
    sums.set(key, known ? { ...known, count: known.count + part.count } : part)
  })
  return [...sums.values()]
}

/** What a recipe file says, or null when nothing in it can be read as materials or a product. */
export function readRecipe(source: unknown): RecipeView | null {
  const recipe = unwrap(source)
  if (!recipe) return null
  const type = typeof recipe.type === "string" ? recipe.type.replace(/^minecraft:/, "") : ""
  const made = readPart(recipe.result) ?? readPart(recipe.output) ?? readPart(recipe.results) ?? readPart(recipe.outputs)
  const result =
    made && typeof recipe.count === "number" && recipe.count > 0 ? { ...made, count: Math.floor(recipe.count) } : made
  const base = { station: stations[type] ?? "", seconds: null, cells: [], width: 0, free: false }
  const grid = readGrid(recipe)
  if (type === "crafting_shaped" && grid)
    return { ...base, ...grid, layout: "grid", inputs: total(grid.cells), result }
  if (type === "crafting_shapeless") {
    const list = readParts(recipe.ingredients)
    if (!list.length) return null
    const width = Math.max(3, Math.ceil(Math.sqrt(list.length)))
    const cells = Array.from({ length: width * Math.max(3, Math.ceil(list.length / width)) }, (_, at) => list[at] ?? null)
    return { ...base, layout: "grid", cells, width, free: true, inputs: total(list), result }
  }
  if (["smelting", "blasting", "smoking", "campfire_cooking", "stonecutting"].includes(type)) {
    const input = readPart(recipe.ingredient)
    if (!input) return null
    const ticks = type === "stonecutting" ? null : recipe.cookingtime
    return {
      ...base,
      layout: "single",
      inputs: [input],
      result,
      seconds: typeof ticks === "number" && ticks > 0 ? Math.round(ticks / 2) / 10 : null,
    }
  }
  if (type.startsWith("smithing")) {
    const inputs = [recipe.template, recipe.base, recipe.addition].flatMap((entry) => readPart(entry) ?? [])
    return inputs.length ? { ...base, layout: "smithing", inputs, result } : null
  }
  // A mod's own kind of recipe: gather whatever looks like materials and a product.
  if (grid) return { ...base, ...grid, layout: "grid", inputs: total(grid.cells), result }
  const inputs = total([
    ...readParts(recipe.ingredient),
    ...readParts(recipe.ingredients),
    ...readParts(recipe.input),
    ...readParts(recipe.inputs),
    ...(isObject(recipe.key) ? Object.values(recipe.key).flatMap((entry) => readPart(entry) ?? []) : []),
    ...readParts(recipe.from),
  ]).slice(0, 9)
  const product = result ?? readPart(recipe.to)
  return inputs.length || product ? { ...base, layout: "row", inputs, result: product } : null
}

function countRange(value: unknown): [number, number] | null {
  if (typeof value === "number") return [value, value]
  if (!isObject(value)) return null
  if (typeof value.n === "number") return [0, value.n]
  const low = countRange(value.min)
  const high = countRange(value.max)
  return low && high ? [low[0], high[1]] : null
}

/** Everything a drop table can give, with how many when the table says so. */
export function readLoot(source: unknown, limit = 12): LootDrop[] {
  const drops = new Map<string, LootDrop>()
  const visit = (entry: unknown, depth: number) => {
    if (!isObject(entry) || depth > 8) return
    const type = String(entry.type ?? "").replace(/^minecraft:/, "")
    const part =
      (type === "item" || type === "tag") && typeof entry.name === "string"
        ? named(type === "tag" ? `#${entry.name}` : entry.name, 1)
        : null
    if (part) {
      const counts = (Array.isArray(entry.functions) ? entry.functions : [])
        .filter((step): step is Json => isObject(step) && /(^|:)set_count$/.test(String(step.function ?? "")))
        .map((step) => countRange(step.count))
        .find((range) => range)
      const min = Math.max(0, Math.floor(counts?.[0] ?? 1))
      const max = Math.max(min, Math.floor(counts?.[1] ?? 1))
      const key = `${part.tag ? "#" : ""}${part.id}`
      const known = drops.get(key)
      drops.set(key, { ...part, min: Math.min(known?.min ?? min, min), max: Math.max(known?.max ?? max, max) })
    }
    for (const key of ["children", "alternatives", "entries"]) {
      if (Array.isArray(entry[key])) entry[key].forEach((child) => visit(child, depth + 1))
    }
  }
  if (isObject(source) && Array.isArray(source.pools)) source.pools.forEach((pool) => visit(pool, 0))
  return [...drops.values()].slice(0, limit)
}

const pretty = (text: string) =>
  text
    .split(/[_/.\s-]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ")

const singular = (word: string) => word.replace(/(?<=[^s])s$/, "")

/** Tags every player meets, said the way the game's own recipe book would, with an item to stand for each. */
const commonTags: Record<string, [string, string]> = {
  planks: ["木板", "oak_planks"],
  logs: ["原木", "oak_log"],
  logs_that_burn: ["原木", "oak_log"],
  wool: ["羊毛", "white_wool"],
  wooden_slabs: ["木台阶", "oak_slab"],
  wooden_stairs: ["木楼梯", "oak_stairs"],
  saplings: ["树苗", "oak_sapling"],
  leaves: ["树叶", "oak_leaves"],
  coals: ["煤炭或木炭", "coal"],
  stone_crafting_materials: ["石头", "cobblestone"],
  stone_tool_materials: ["石头", "cobblestone"],
  "rods/wooden": ["木棍", "stick"],
  sticks: ["木棍", "stick"],
  chests: ["箱子", "chest"],
  "chests/wooden": ["木箱子", "chest"],
  slimeballs: ["粘液球", "slime_ball"],
  slime_balls: ["粘液球", "slime_ball"],
  dyes: ["染料", "white_dye"],
  glass: ["玻璃", "glass"],
  "glass/colorless": ["玻璃", "glass"],
  cobblestone: ["圆石", "cobblestone"],
  stone: ["石头", "stone"],
}

/**
 * A friendly name for "any of these" and one item that can stand for the group.
 * `names` maps the game's item ids to their names; `own` finds one of the mod's items by its short name.
 */
export function describeTag(
  tag: string,
  names: Record<string, string>,
  own: (name: string) => { id: string; name: string } | undefined = () => undefined,
): { name: string; sample: string | null } {
  const path = tag.split(":")[1] ?? tag
  const parts = path.split("/")
  const leaf = parts.at(-1)!
  const group = parts.length > 1 ? parts[0]! : ""
  const known = commonTags[path] ?? (group ? undefined : commonTags[leaf])
  if (known) return { name: `任意${known[0]}`, sample: `minecraft:${known[1]}` }
  // "ingots/iron" is the iron ingot, "storage_blocks/iron" the block of iron, "dusts/redstone" plain redstone.
  const guesses = !group
    ? [singular(leaf), leaf]
    : group === "storage_blocks"
      ? [`${leaf}_block`]
      : [`${leaf}_${singular(group)}`, `raw_${leaf}`, leaf].slice(0, group === "raw_materials" ? 2 : /^(dusts|gems)$/.test(group) ? 3 : 1)
  for (const guess of guesses) {
    const mine = own(guess)
    if (mine) return { name: `任意${mine.name}`, sample: mine.id }
    if (names[`minecraft:${guess}`]) return { name: `任意${names[`minecraft:${guess}`]}`, sample: `minecraft:${guess}` }
  }
  // "beds" matches every "<colour>_bed": what their names share is the word for the group.
  const family = group ? [] : Object.keys(names).filter((id) => id.endsWith(`_${leaf}`) || id.endsWith(`_${singular(leaf)}`))
  if (family.length > 1) {
    let shared = names[family[0]!]!
    for (const id of family) {
      while (shared && !names[id]!.endsWith(shared)) shared = shared.slice(1)
    }
    // Colour families ("白色床", "红色床") share the word for colour as well.
    shared = shared.replace(/^色/, "")
    if (shared) return { name: `任意${shared}`, sample: family[0]! }
  }
  return { name: `任意 ${pretty(group ? `${leaf} ${parts.slice(0, -1).join(" ")}` : leaf)}`, sample: null }
}

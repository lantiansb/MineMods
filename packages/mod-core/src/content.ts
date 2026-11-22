import { z } from "zod"
import { encodePng } from "./png"
import { decodeTextureDataUrl } from "./content-texture"
import { compileLuckyCaches } from "./fabric/lucky-cache"
import { LuckyCacheSchema } from "./lucky-cache"
import { BLOCK_SOUNDS, EnglishNameSchema, ORE_BASES, ORE_BIOME_GROUPS, ORE_DIMENSIONS, ORE_LIMITS, TOOL_TIERS, needsTool, type BlockSound, type OreBase, type OreBiomeGroup, type OreDimension, type ToolTier } from "./data-words"
import { compileWorldgen } from "./fabric/worldgen"
import { compileItemNatures, itemSource, materialSource, movementSource } from "./fabric/content-items"
import { BLOCK_FACES, faceEntries } from "@minemods/studio-ai/texture-facts"
import { BlockShapeSchema, readPngSize, shapeConflict } from "@minemods/studio-ai/block-shape"
import { BOUNCE_IMPORTS, bounceOf, bounceSource, launchOf } from "./fabric/block-bounce"
import { compileShapedBlock, compileShapedClient, isShaped, shapedClass, sheetName } from "./fabric/block-shape"
import { decodeRgbaPng } from "./png-decode"
import { ItemDisplaySchema, exportItemDisplay } from "./item-display"
import { compileItemModel } from "./item-model"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { GenTarget } from "./platform/adapter"
import { cutoutModel, platformContentRegistry } from "./platform/content"
import { targetVanillaIssue } from "./platform/vanilla-targets"
import { assertPorted } from "./platform/ported"
import { FABRIC_TARGET } from "./platform/target"
import { ARMOR_LOOKS, ARMOR_SLOTS, type ArmorLook, type ArmorSlot, BOUNCE_LIMITS, LAUNCH_LIMITS, FOOD_EFFECTS, FOOD_EFFECT_LIMITS, FOOD_LEAVES, INGREDIENT_PATTERN, ITEM_LIMITS, ITEM_RARITIES, type ItemRarity, MINING_LEVELS, MOVEMENT_LIMITS, RECIPE_KINDS, RECIPE_LIMITS, TOOL_KINDS, cookingTime, vanillaIssue, type FoodEffect, type FoodLeaves, type MiningLevel, type RecipeKind, type ToolKind } from "./content-words"

const LocalIdentifierSchema = z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/)
const NamespacedIdSchema = z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,63}:[a-z0-9][a-z0-9_./-]{0,63}$/)
const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
/** A recipe material or a repair material: one item (`mod:name`), or any item of a tag (`#minecraft:planks`). */
const IngredientSchema = z.string().trim().regex(INGREDIENT_PATTERN)

const keys = <Key extends string>(record: Record<Key, unknown>) => Object.keys(record) as [Key, ...Key[]]
const range = (label: string) => (value: { min: number; max: number }, context: z.RefinementCtx) => {
  if (value.min > value.max) context.addIssue({ code: "custom", path: ["max"], message: `${label}的最大值不能比最小值小。` })
}

/** Where a block generates in the world: veins of it replacing ordinary rock, the way vanilla ores are placed. */
export const GenerationSchema = z
  .strictObject({
    dimension: z.enum(keys<OreDimension>(ORE_DIMENSIONS)),
    /** Lowest and highest Y a vein may start at. */
    min_y: z.number().int().min(-64).max(320),
    max_y: z.number().int().min(-64).max(320),
    /** even: the same chance at every height; middle: most in the middle of the range, thinning toward both ends. */
    spread: z.enum(["even", "middle"]),
    /** Blocks in one vein, at most; the game makes each vein a little different. */
    vein_size: z.number().int().min(ORE_LIMITS.vein_min).max(ORE_LIMITS.vein_size),
    veins_per_chunk: z.number().int().min(1).max(ORE_LIMITS.veins_per_chunk),
    replaces: z.array(z.enum(keys<OreBase>(ORE_BASES))).min(1).max(4),
    /** Null: everywhere in the dimension. Otherwise only in this group of overworld biomes. */
    biomes: z.enum(keys<OreBiomeGroup>(ORE_BIOME_GROUPS)).nullable(),
  })
  .superRefine((generation, context) => {
    const dimension = ORE_DIMENSIONS[generation.dimension]
    if (generation.min_y > generation.max_y) context.addIssue({ code: "custom", path: ["max_y"], message: "生成高度的上限不能比下限低。" })
    if (generation.min_y < dimension.min_y || generation.max_y > dimension.max_y)
      context.addIssue({ code: "custom", path: ["min_y"], message: `${dimension.name}的高度只有 ${dimension.min_y} 到 ${dimension.max_y}，生成高度要落在这个范围里。` })
    if (new Set(generation.replaces).size !== generation.replaces.length) context.addIssue({ code: "custom", path: ["replaces"], message: "替换的岩石不要重复写。" })
    generation.replaces.forEach((base, index) => {
      if (ORE_BASES[base].dimension !== generation.dimension)
        context.addIssue({ code: "custom", path: ["replaces", index], message: `${dimension.name}里没有${ORE_BASES[base].name}，换成${Object.values(ORE_BASES).filter((value) => value.dimension === generation.dimension).map((value) => value.name).join("或")}。` })
    })
    if (generation.biomes && generation.dimension !== "overworld") context.addIssue({ code: "custom", path: ["biomes"], message: "只有主世界可以再限定群系；下界和末地写 null。" })
  })
export type Generation = z.infer<typeof GenerationSchema>

/** What a mined block gives instead of itself: an item or block of this project, how many, and whether Fortune gives more. */
export const DropItemSchema = z
  .strictObject({
    /** Identifier of an item or block of this project, without the mod prefix. */
    item: LocalIdentifierSchema,
    min: z.number().int().min(1).max(ORE_LIMITS.drop_count),
    max: z.number().int().min(1).max(ORE_LIMITS.drop_count),
    fortune: z.boolean(),
  })
  .superRefine(range("掉落数量"))

/** Burns in a furnace: 200 ticks smelt one thing. */
export const FuelSchema = z.strictObject({ burn_ticks: z.number().int().min(20).max(ITEM_LIMITS.burn_ticks) })

/**
 * A real tool or weapon. The numbers are the tool material's, except `attack_damage`, which is the whole
 * damage of one hit as the game's tooltip shows it, and `attack_speed`, hits a second (null: vanilla's for the kind).
 */
export const ToolSchema = z.strictObject({
  kind: z.enum(keys<ToolKind>(TOOL_KINDS)),
  durability: z.number().int().min(1).max(ITEM_LIMITS.durability),
  mining_level: z.enum(keys<MiningLevel>(MINING_LEVELS)),
  mining_speed: z.number().finite().min(1).max(ITEM_LIMITS.mining_speed),
  attack_damage: z.number().finite().min(1).max(ITEM_LIMITS.attack_damage),
  attack_speed: z.number().finite().min(0.5).max(4).nullable().optional(),
  enchantability: z.number().int().min(0).max(ITEM_LIMITS.enchantability),
  /** What mends it on an anvil; null: nothing does. */
  repair: IngredientSchema.nullable(),
})
export type Tool = z.infer<typeof ToolSchema>

/**
 * A piece of real armor (`armor` of an item): worn in `slot`, it adds `defense` armor points, `toughness` and `knockback_resistance` (0 to 1) as the game's own
 * armor does, wears out after `durability` hits, takes the enchantments of its slot at an enchanting table with `enchantability` and is mended on an anvil with `repair`.
 * `look` is how it is drawn worn: one of the game's own armors (`ARMOR_LOOKS`), with that armor's equip sound.
 */
export const ArmorSchema = z.strictObject({
  slot: z.enum(keys<ArmorSlot>(ARMOR_SLOTS)),
  defense: z.number().int().min(0).max(ITEM_LIMITS.defense),
  toughness: z.number().finite().min(0).max(ITEM_LIMITS.toughness),
  knockback_resistance: z.number().finite().min(0).max(ITEM_LIMITS.knockback_resistance),
  durability: z.number().int().min(1).max(ITEM_LIMITS.durability),
  enchantability: z.number().int().min(0).max(ITEM_LIMITS.enchantability),
  /** What mends it on an anvil; null: nothing does. */
  repair: IngredientSchema.nullable(),
  look: z.enum(keys<ArmorLook>(ARMOR_LOOKS)),
})
export type Armor = z.infer<typeof ArmorSchema>

/** One status effect a food gives when eaten. The instant ones (`FOOD_EFFECTS`) happen once, so their length is 1 and means nothing. */
export const FoodEffectSchema = z
  .strictObject({
    effect: z.enum(keys<FoodEffect>(FOOD_EFFECTS)),
    /** How long it lasts. Vanilla: the golden apple's regeneration 5, its absorption 120, the enchanted one's resistance 300. */
    seconds: z.number().int().min(FOOD_EFFECT_LIMITS.seconds.min).max(FOOD_EFFECT_LIMITS.seconds.max),
    /** 1 is I, 2 is II (the golden apple's regeneration is II). */
    level: z.number().int().min(FOOD_EFFECT_LIMITS.level.min).max(FOOD_EFFECT_LIMITS.level.max),
    /** The chance each time it is eaten: rotten flesh's hunger 0.8, raw chicken's poison 0.3. */
    chance: z.number().finite().min(0).max(1),
  })
  .superRefine((effect, context) => {
    if ("instant" in FOOD_EFFECTS[effect.effect] && effect.seconds !== FOOD_EFFECT_LIMITS.seconds.min)
      context.addIssue({ code: "custom", path: ["seconds"], message: `${FOOD_EFFECTS[effect.effect].name}是瞬间生效的，没有持续时间，seconds 只能写 ${FOOD_EFFECT_LIMITS.seconds.min}。` })
  })
export type FoodEffectEntry = z.infer<typeof FoodEffectSchema>

export const FoodSchema = z.strictObject({
  hunger: z.number().int().min(1).max(ITEM_LIMITS.hunger),
  /** Vanilla's saturation modifier: bread 0.6, steak 0.8. */
  saturation: z.number().finite().min(0).max(ITEM_LIMITS.saturation),
  always_edible: z.boolean().optional(),
  snack: z.boolean().optional(),
  // Absent in older projects: a food without them builds exactly as before.
  /** Status effects given when it is eaten, each with its own chance. */
  effects: z.array(FoodEffectSchema).max(FOOD_EFFECT_LIMITS.count, `一种食物最多带 ${FOOD_EFFECT_LIMITS.count} 个状态效果（附魔金苹果就是四个）。`).nullable().optional(),
  /** Held and used like a drink: the drinking motion and sound instead of chewing. */
  drink: z.boolean().nullable().optional(),
  /** What is left in the hand once it is eaten (the honey bottle leaves a glass bottle, a stew a bowl). */
  leaves: z.enum(keys<FoodLeaves>(FOOD_LEAVES)).nullable().optional(),
})
export type Food = z.infer<typeof FoodSchema>

/**
 * How a block changes the movement of whoever stands on it. All three are always written; a part at the game's
 * own default (`MOVEMENT_PLAIN`) changes nothing and is not written into the Java.
 */
export const MovementSchema = z.strictObject({
  /** Multiplies walking speed on it: soul sand and honey block 0.4. */
  speed: z.number().finite().min(MOVEMENT_LIMITS.speed.min).max(MOVEMENT_LIMITS.speed.max),
  /** Multiplies the push of a jump from it: honey block 0.5. */
  jump: z.number().finite().min(MOVEMENT_LIMITS.jump.min).max(MOVEMENT_LIMITS.jump.max),
  /** How slippery its top is: ordinary blocks 0.6, ice 0.98, blue ice 0.989. */
  slip: z.number().finite().min(MOVEMENT_LIMITS.slip.min).max(MOVEMENT_LIMITS.slip.max),
})
export type Movement = z.infer<typeof MovementSchema>

export const BlockSchema = z.strictObject({
  id: z.uuid(),
  identifier: LocalIdentifierSchema,
  name: z.string().trim().min(1).max(120),
  hardness: z.number().finite().min(0).max(3600000),
  luminance: z.number().int().min(0).max(15),
  tool: z.enum(["pickaxe", "axe", "shovel", "none"]),
  /** self: the block itself; none: nothing; item: what `drop_item` says (with Silk Touch, the block itself, as vanilla ores do). */
  drop: z.enum(["self", "none", "item"]),
  color: ColorSchema,
  texture: z.string().optional(),
  lucky: LuckyCacheSchema.nullable().optional(),
  // Everything below is optional and absent in older projects: a block without them builds exactly as before.
  drop_item: DropItemSchema.nullable().optional(),
  /** The least tool material that gets the drop. Needs a `tool` other than none. */
  tool_tier: z.enum(keys<ToolTier>(TOOL_TIERS)).nullable().optional(),
  /** Experience orbs when mined without Silk Touch. */
  experience: z.strictObject({ min: z.number().int().min(0).max(ORE_LIMITS.experience), max: z.number().int().min(0).max(ORE_LIMITS.experience) }).superRefine(range("经验")).nullable().optional(),
  /** The vanilla block whose break, step and place sounds this block borrows. */
  sound: z.enum(keys<BlockSound>(BLOCK_SOUNDS)).nullable().optional(),
  generation: GenerationSchema.nullable().optional(),
  name_en: EnglishNameSchema.nullable().optional(),
  fuel: FuelSchema.nullable().optional(),
  /** Slows whoever stands on it, makes them jump lower, or lets them slide (see `MovementSchema`). Absent or null: an ordinary block's. */
  movement: MovementSchema.nullable().optional(),
  /** What share of its landing speed it throws whoever lands on it back up with, as the slime block does (1); 0 or absent: an ordinary block. Sneaking lands without a bounce. */
  bounce: z.number().finite().min(BOUNCE_LIMITS.min).max(BOUNCE_LIMITS.max).nullable().optional(),
  /** How many blocks high it throws up a living thing that steps or lands on it, as a jump pad does; absent or null: an ordinary block. Sneaking is not thrown. */
  launch: z.number().finite().min(LAUNCH_LIMITS.min).max(LAUNCH_LIMITS.max).nullable().optional(),
  /**
   * More pictures of the same block, each the size of `texture`: the game shows one of them, or `texture`, at every
   * position, chosen from the position alone (the lists in the game's own `blockstates/stone.json`).
   */
  variants: z.array(z.string().max(2_000_000)).max(BLOCK_FACES.extra, `一个方块除了 texture 最多再带 ${BLOCK_FACES.extra} 张图（variants）。`).nullable().optional(),
  /** The game may show the block flipped left to right from place to place (`block/cube_mirrored_all`, as its stone is). */
  random_mirror: z.boolean().nullable().optional(),
  /** The game may show the block turned a quarter, a half or three quarters about the vertical from place to place (as its dirt and sand are). Only the top and the bottom show it. */
  random_turn: z.boolean().nullable().optional(),
  /**
   * Not a whole block but a few boxes put together, drawn from one picture and optionally turning to face whoever
   * places it (`block-shape.ts` in the AI package says what is in it). Absent or null: a whole block, built as ever.
   */
  shape: BlockShapeSchema.nullable().optional(),
})
export const ItemSchema = z.strictObject({
  id: z.uuid(),
  identifier: LocalIdentifierSchema,
  name: z.string().trim().min(1).max(120),
  max_stack: z.number().int().min(1).max(64),
  color: ColorSchema,
  texture: z.string().optional(),
  /** Workspace model UUID, never an entity or on-disk model revision UUID. */
  model_asset_id: z.uuid().nullable().optional(),
  display: ItemDisplaySchema.optional(),
  // Absent in older projects: the English-language game then shows the Chinese name, as before.
  name_en: EnglishNameSchema.nullable().optional(),
  // What the item is besides an ordinary item. Absent in older projects: an item without them builds exactly as before.
  tool: ToolSchema.nullable().optional(),
  // A piece of armor (absent in older projects: they build exactly as before).
  armor: ArmorSchema.nullable().optional(),
  food: FoodSchema.nullable().optional(),
  fuel: FuelSchema.nullable().optional(),
  // How rare the game calls it: the colour of its name (vanilla's Rarity). Absent or common: as every item before, white.
  rarity: z.enum(keys<ItemRarity>(ITEM_RARITIES)).optional(),
})
export const RecipeSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  /** Nine slots whatever the kind; how they are read is `RECIPE_KINDS[type].slots`. */
  pattern: z.array(IngredientSchema.nullable()).length(9).refine(pattern => pattern.some(Boolean), "配方至少需要一种材料。"),
  result: NamespacedIdSchema,
  count: z.number().int().min(1).max(64),
  // Absent in older projects: a recipe without a type is a shaped crafting recipe and builds exactly as before.
  type: z.enum(keys<RecipeKind>(RECIPE_KINDS)).optional(),
  /** Cooking kinds only: experience for each one cooked, and how long it takes in ticks (null: the station's own). */
  experience: z.number().finite().min(0).max(RECIPE_LIMITS.experience).nullable().optional(),
  cooking_time: z.number().int().min(1).max(RECIPE_LIMITS.cooking_time).nullable().optional(),
})
export const LogicSchema = z
  .strictObject({
    id: z.uuid(),
    entity_id: z.uuid(),
    trigger: z.enum(["player_near", "holding_item", "hurt"]),
    action: z.enum(["look", "follow", "play_animation"]),
    item: NamespacedIdSchema.optional(),
    animation: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean(),
  })
  .superRefine((logic, context) => {
    if (logic.trigger === "holding_item" && !logic.item)
      context.addIssue({ code: "custom", path: ["item"], message: "holding_item requires an item reference" })
    if (logic.trigger !== "holding_item" && logic.item)
      context.addIssue({ code: "custom", path: ["item"], message: "item is unsupported for this trigger" })
    if (logic.action === "play_animation" && !logic.animation)
      context.addIssue({ code: "custom", path: ["animation"], message: "play_animation requires an animation" })
    if (logic.action !== "play_animation" && logic.animation)
      context.addIssue({ code: "custom", path: ["animation"], message: "animation is unsupported for this action" })
  })

export const ContentSchema = z.strictObject({
  blocks: z.array(BlockSchema).max(256).default([]),
  items: z.array(ItemSchema).max(256).default([]),
  recipes: z.array(RecipeSchema).max(512).default([]),
  logic: z.array(LogicSchema).max(1024).default([]),
})

export type Block = z.infer<typeof BlockSchema>
export type Item = z.infer<typeof ItemSchema>
export type Recipe = z.infer<typeof RecipeSchema>
export type Logic = z.infer<typeof LogicSchema>
export type Content = z.infer<typeof ContentSchema>
export type CompiledContent = Record<string, string | Uint8Array>

type EntityReference = { id: string }
export type ContentInput = Content & {
  mod_id: string
  package_name: string
  entities?: EntityReference[]
  item_models?: Record<string, ModelDesign>
}

function issue(message: string, path: (string | number)[] = []) {
  const error = new z.ZodError([])
  error.addIssue({ code: "custom", path, message })
  return error
}

function resourceNameSet(content: Content) {
  return new Set([
    ...content.blocks.map((block) => block.identifier),
    ...content.items.map((item) => item.identifier),
  ])
}

function assertReference(reference: string, modId: string, resources: Set<string>, path: (string | number)[]) {
  // A vanilla item or a tag the game does not have makes the game drop the whole recipe when it loads.
  const missing = vanillaIssue(reference)
  if (missing) throw issue(missing, path)
  if (reference.startsWith("#")) return
  const [namespace, name] = reference.split(":")
  if (namespace === "minecraft") return
  if (namespace !== modId || !resources.has(name)) throw issue(`${UNKNOWN_CONTENT_REFERENCE}${reference}`, path)
}

/** The message every reference to content that is not in the project is refused with (`assertReference`). */
export const UNKNOWN_CONTENT_REFERENCE = "Unknown content reference: "

/**
 * How many ids a refusal lists in full. A refusal is cut at 2000 characters (`saveable`) and an id with its name runs to about 40,
 * so thirty ids take at most 1200 of them and the rest of the sentence still fits.
 */
export const REFERENCE_LISTING_LIMIT = 30

/**
 * What a reference to content this project holds can be written as, for whoever got one wrong: the project's own namespace and the ids that
 * exist. All of them when they fit in a listing; else only the ones whose short name (after the colon) is the one asked for, now with this
 * project's namespace in front. Never a guess at what was meant, and never a change to what was written.
 */
export function referenceChoices(wanted: readonly string[], source: { mod_id: string; blocks: readonly { identifier: string; name: string }[]; items: readonly { identifier: string; name: string }[] }) {
  const known = [...source.blocks, ...source.items].map((entry) => ({ id: `${source.mod_id}:${entry.identifier}`, name: entry.name, short: entry.identifier }))
  const shortOf = (reference: string) => reference.split(":").at(-1)!
  const asked = new Set(wanted.map(shortOf))
  const listed = known.length <= REFERENCE_LISTING_LIMIT ? known : known.filter((entry) => asked.has(entry.short)).slice(0, REFERENCE_LISTING_LIMIT)
  const say = (entries: typeof known) => entries.map((entry) => `${entry.id}（${entry.name}）`).join("、")
  const namespace = `这个工程的命名空间是 ${source.mod_id}，工程自己的方块和物品要写成 ${source.mod_id}:短名。`
  if (!known.length) return `${namespace}工程里还没有任何方块或物品可以引用，先把它们做出来。`
  if (known.length <= REFERENCE_LISTING_LIMIT) return `${namespace}现在能引用的有：${say(listed)}。`
  return `${namespace}工程里共有 ${known.length} 样，${listed.length ? `和写错的那几个同名的有：${say(listed)}` : "没有一样和写错的那几个同名"}。`
}

/** The message every reference to a creature that is not in the project is refused with. */
export const UNKNOWN_ENTITY_REFERENCE = "Unknown entity reference: "

/** The creatures a rule can be attached to, by the id it is attached with: the same listing, the same limit. */
export function entityChoices(entities: readonly { id: string; name: string }[]) {
  const listed = entities.slice(0, REFERENCE_LISTING_LIMIT).map((entity) => `${entity.id}（${entity.name}）`)
  return listed.length ? `现在能用的生物有：${listed.join("、")}${entities.length > listed.length ? `，等共 ${entities.length} 只` : ""}。` : "工程里还没有生物可以用，先把它做出来。"
}

/** What is wrong with how a recipe of its kind fills the nine slots and the cooking fields, or null. */
function recipeIssue(recipe: Recipe) {
  const kind = recipe.type ?? "shaped"
  const words = RECIPE_KINDS[kind]
  const filled = recipe.pattern.flatMap((value, index) => (value === null ? [] : [index]))
  if (words.slots === "one" && filled.length !== 1) return `配方「${recipe.name}」是${words.station}配方，只能有一样材料：写在第 0 格，其余 8 格写 null。`
  if (words.slots === "three" && filled.join() !== "0,1,2") return `配方「${recipe.name}」是锻造台配方：第 0、1、2 格依次写锻造模板、被升级的东西、加进去的材料，其余 6 格写 null。`
  const cooks = cookingTime(kind) !== null
  if (!cooks && (recipe.experience != null || recipe.cooking_time != null)) return `配方「${recipe.name}」不是烧炼类配方，不能写 experience 和 cooking_time。`
  // A furnace puts the result stack down once and then adds one at a time, so a larger count would only hold for the first.
  if ((cooks || kind === "smithing") && recipe.count !== 1) return `配方「${recipe.name}」是${words.station}配方，一次只能出 1 个（count 写 1）。`
  return null
}

/** The rest of what a block with a shape needs: a sheet the game can read, and a name for it that is not another block's. */
function shapeIssues(block: Block, blocks: Block[], where: (field: string) => (string | number)[]) {
  const conflict = shapeConflict(block)
  if (conflict) throw issue(conflict.message, where(conflict.field))
  if (blocks.some((other) => other.identifier === sheetName(block))) throw issue(`方块「${block.name}」的外形图会叫「${sheetName(block)}」，和模组里另一个方块的名字撞了：给其中一个换个名字。`, where("identifier"))
  try {
    decodeRgbaPng(decodeTextureDataUrl(block.shape!.sheet))
  } catch {
    throw issue(`方块「${block.name}」的外形图（shape.sheet）不是一张读得出来的 PNG。`, [...where("shape"), "sheet"])
  }
}

export function validateContent(input: unknown): Content {
  const source = typeof input === "object" && input !== null ? input as Partial<ContentInput> : {}
  const parsed = ContentSchema.parse({
    blocks: source.blocks,
    items: source.items,
    recipes: source.recipes,
    logic: source.logic,
  })
  const modId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).parse(source.mod_id)
  const entities = (source.entities ?? []) as (EntityReference & { runtime?: { death_drop?: { block_identifier: string } | null } })[]
  const entityIds = new Set(entities.map((entity) => z.uuid().parse(entity.id)))
  const ids = [...parsed.blocks, ...parsed.items, ...parsed.recipes, ...parsed.logic].map((entry) => entry.id)
  if (new Set(ids).size !== ids.length) throw issue("Duplicate content ID")
  const identifiers = [...parsed.blocks, ...parsed.items].map((entry) => entry.identifier)
  if (new Set(identifiers).size !== identifiers.length) throw issue("Duplicate content identifier")
  const resources = resourceNameSet(parsed)
  parsed.recipes.forEach((recipe, recipeIndex) => {
    const wrong = recipeIssue(recipe)
    if (wrong) throw issue(wrong, ["recipes", recipeIndex, "pattern"])
    recipe.pattern.forEach((reference, patternIndex) => {
      if (reference) assertReference(reference, modId, resources, ["recipes", recipeIndex, "pattern", patternIndex])
    })
    assertReference(recipe.result, modId, resources, ["recipes", recipeIndex, "result"])
  })
  parsed.logic.forEach((logic, logicIndex) => {
    if (!entityIds.has(logic.entity_id)) throw issue(`${UNKNOWN_ENTITY_REFERENCE}${logic.entity_id}`, ["logic", logicIndex, "entity_id"])
    if (logic.item) assertReference(logic.item, modId, resources, ["logic", logicIndex, "item"])
  })
  parsed.items.forEach((item, itemIndex) => {
    const where = (field: string) => ["items", itemIndex, field]
    if (item.tool && item.food) throw issue(`物品「${item.name}」不能既是工具又是食物，留下一个。`, where("food"))
    // The game refuses an item that both wears out and stacks.
    if (item.tool && item.max_stack !== 1) throw issue(`物品「${item.name}」是工具，工具不能叠放：max_stack 写 1。`, where("max_stack"))
    if (item.tool?.repair) assertReference(item.tool.repair, modId, resources, [...where("tool"), "repair"])
    if (item.tool?.repair === `${modId}:${item.identifier}`) throw issue(`物品「${item.name}」的修理材料不能是它自己。`, [...where("tool"), "repair"])
    if (item.armor && item.tool) throw issue(`物品「${item.name}」不能既是盔甲又是工具，留下一个。`, where("armor"))
    if (item.armor && item.food) throw issue(`物品「${item.name}」不能既是盔甲又是食物，留下一个。`, where("armor"))
    if (item.armor && item.max_stack !== 1) throw issue(`物品「${item.name}」是盔甲，盔甲不能叠放：max_stack 写 1。`, where("max_stack"))
    if (item.armor?.repair) assertReference(item.armor.repair, modId, resources, [...where("armor"), "repair"])
    if (item.armor?.repair === `${modId}:${item.identifier}`) throw issue(`物品「${item.name}」的修理材料不能是它自己。`, [...where("armor"), "repair"])
  })
  parsed.blocks.forEach((block, blockIndex) => {
    const where = (field: string) => ["blocks", blockIndex, field]
    if (block.drop === "item" && !block.drop_item) throw issue(`方块「${block.name}」写了挖掉后掉别的东西，可是没有写掉什么（drop_item）。`, where("drop_item"))
    if (block.drop !== "item" && block.drop_item) throw issue(`方块「${block.name}」写了 drop_item，那 drop 就要写成 item。`, where("drop"))
    if (block.drop_item && (block.drop_item.item === block.identifier || !resources.has(block.drop_item.item)))
      throw issue(`方块「${block.name}」挖掉后要掉「${block.drop_item.item}」，可是模组里没有别的方块或物品叫这个名字。先把它做出来。`, where("drop_item"))
    if (block.tool_tier && block.tool === "none") throw issue(`方块「${block.name}」要求至少用${TOOL_TIERS[block.tool_tier].name}质工具，那就得先选一种工具（镐、斧或锹）。`, where("tool_tier"))
    // A block that gives experience and comes back as itself could be placed and mined again without end.
    if (block.experience && block.experience.max > 0 && block.drop === "self") throw issue(`方块「${block.name}」挖掉会掉它自己，又给经验：玩家可以反复放下再挖来刷经验。让它掉别的物品，或者去掉经验。`, where("experience"))
    if (block.variants?.length) {
      if (!block.texture) throw issue(`方块「${block.name}」写了 variants（更多的图），可是没有第一张：先把 texture 画出来，variants 里是另外的几张。`, where("variants"))
      const sizes = [block.texture, ...block.variants].map((source, index) => {
        try {
          return ((image) => `${image.width}×${image.height}`)(decodeRgbaPng(decodeTextureDataUrl(source)))
        } catch {
          throw issue(`方块「${block.name}」的第 ${index + 1} 张图不是一张读得出来的 PNG。`, where(index ? "variants" : "texture"))
        }
      })
      const odd = sizes.findIndex((size) => size !== sizes[0])
      if (odd > 0) throw issue(`方块「${block.name}」的几张图要一样大：第 1 张是 ${sizes[0]}，第 ${odd + 1} 张是 ${sizes[odd]}。`, where("variants"))
    }
    if (block.shape) shapeIssues(block, parsed.blocks, where)
    if (block.lucky && (block.generation || block.drop === "item")) throw issue(`盲盒方块「${block.name}」不能在世界里自己生成，也不能改掉落。`, where("lucky"))
  })
  entities.forEach((entity, entityIndex) => {
    const deathDrop = entity.runtime?.death_drop
    if (!deathDrop) return
    const block = parsed.blocks.find((candidate) => candidate.identifier === deathDrop.block_identifier)
    if (!block || !block.lucky) throw issue(`Death drop references a missing or non-lucky block: ${deathDrop.block_identifier}`, ["entities", entityIndex, "runtime", "death_drop", "block_identifier"])
  })
  return parsed
}

function texture(color: string) {
  const channels = [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)]
  return channels
}

function compileTexture(color: string, source?: string) {
  if (source) return decodeTextureDataUrl(source)
  const [red, green, blue] = texture(color)
  const pixels = new Uint8Array(16 * 16 * 4)
  pixels.forEach((_, index) => {
    const channel = index % 4
    pixels[index] = channel === 0 ? red : channel === 1 ? green : channel === 2 ? blue : 255
  })
  return encodePng(pixels, 16, 16)
}

/**
 * A block's blockstate and block models. With one picture and nothing random: one model, as every build wrote it.
 * Otherwise a list the game picks from at every position, written the way the game's own are
 * (`blockstates/stone.json`: plain and `_mirrored` models; `dirt.json`: `"y": 90 / 180 / 270`). A name with a
 * hyphen cannot be another block's (`LocalIdentifierSchema` has none), so no two blocks' files collide.
 */
function compileBlockFaces(block: Block, modId: string, resources: string) {
  const entries = faceEntries(1 + (block.variants?.length ?? 0), { mirror: block.random_mirror, turn: block.random_turn })
  const named = (picture: number) => `${modId}:block/${block.identifier}${picture ? `-${picture + 1}` : ""}`
  const model = (entry: (typeof entries)[number]) => `${named(entry.picture)}${entry.mirror ? "-mirrored" : ""}`
  const files: Record<string, string | Uint8Array> = {
    [`${resources}/blockstates/${block.identifier}.json`]: JSON.stringify({ variants: { "": entries.length === 1 ? { model: model(entries[0]!) } : entries.map((entry) => ({ model: model(entry), ...(entry.turn ? { y: entry.turn * 90 } : {}) })) } }, null, 2),
  }
  entries.filter((entry) => entry.turn === 0).forEach((entry) => {
    files[`${resources}/models/block/${model(entry).split("/")[1]}.json`] = JSON.stringify({ parent: entry.mirror ? "minecraft:block/cube_mirrored_all" : "minecraft:block/cube_all", textures: { all: named(entry.picture) } }, null, 2)
  })
  ;(block.variants ?? []).forEach((source, index) => {
    files[`${resources}/textures/block/${named(index + 1).split("/")[1]}.png`] = decodeTextureDataUrl(source)
  })
  return files
}

const ingredient = (reference: string) => (reference.startsWith("#") ? { tag: reference.slice(1) } : { item: reference })

/** The recipe book tab a result goes under, the way vanilla sorts its own. */
function recipeCategory(recipe: Recipe, content: Content, modId: string) {
  const [namespace, name] = recipe.result.split(":")
  const item = namespace === modId ? content.items.find((value) => value.identifier === name) : undefined
  const block = namespace === modId && content.blocks.some((value) => value.identifier === name)
  if (cookingTime(recipe.type ?? "shaped") !== null) return item?.food ? "food" : block ? "blocks" : "misc"
  return item?.tool ? "equipment" : block ? "building" : "misc"
}

// Each kind is written field for field the way the game's own recipes of that kind are.
function compileRecipe(recipe: Recipe, content: Content, modId: string) {
  const kind = recipe.type ?? "shaped"
  const filled = recipe.pattern.filter((reference): reference is string => reference !== null)
  if (kind === "shapeless") return { type: RECIPE_KINDS[kind].type, category: recipeCategory(recipe, content, modId), ingredients: filled.map(ingredient), result: { count: recipe.count, id: recipe.result } }
  if (kind === "stonecutting") return { type: RECIPE_KINDS[kind].type, ingredient: ingredient(filled[0]!), result: { count: recipe.count, id: recipe.result } }
  if (kind === "smithing") return { type: RECIPE_KINDS[kind].type, addition: ingredient(filled[2]!), base: ingredient(filled[1]!), result: { count: 1, id: recipe.result }, template: ingredient(filled[0]!) }
  if (kind !== "shaped") return { type: RECIPE_KINDS[kind].type, category: recipeCategory(recipe, content, modId), cookingtime: recipe.cooking_time ?? cookingTime(kind), experience: recipe.experience ?? 0, ingredient: ingredient(filled[0]!), result: { id: recipe.result } }
  const keyByReference = new Map<string, string>()
  filled.forEach((reference) => {
    if (!keyByReference.has(reference)) keyByReference.set(reference, String.fromCharCode(65 + keyByReference.size))
  })
  const pattern = [0, 1, 2].map((row) => recipe.pattern.slice(row * 3, row * 3 + 3).map((reference) => reference ? keyByReference.get(reference) : " ").join(""))
  const key = Object.fromEntries([...keyByReference].map(([reference, letter]) => [letter, ingredient(reference)]))
  return { type: "minecraft:crafting_shaped", pattern, key, result: { id: recipe.result, count: recipe.count } }
}

/**
 * The loot table of a block that drops something else, written the way vanilla writes an ore's: with Silk Touch
 * the block itself, otherwise the item, counted, multiplied by Fortune when asked, thinned by explosions.
 */
export function oreLoot(modId: string, identifier: string, drop: z.infer<typeof DropItemSchema>) {
  const silk = { condition: "minecraft:match_tool", predicate: { predicates: { "minecraft:enchantments": [{ enchantments: "minecraft:silk_touch", levels: { min: 1 } }] } } }
  const functions = [
    ...(drop.min === 1 && drop.max === 1 ? [] : [{ add: false, count: { type: "minecraft:uniform", max: drop.max, min: drop.min }, function: "minecraft:set_count" }]),
    ...(drop.fortune ? [{ enchantment: "minecraft:fortune", formula: "minecraft:ore_drops", function: "minecraft:apply_bonus" }] : []),
    { function: "minecraft:explosion_decay" },
  ]
  return {
    type: "minecraft:block",
    pools: [
      {
        bonus_rolls: 0,
        entries: [
          {
            type: "minecraft:alternatives",
            children: [
              { type: "minecraft:item", conditions: [silk], name: `${modId}:${identifier}` },
              { type: "minecraft:item", functions, name: `${modId}:${drop.item}` },
            ],
          },
        ],
        rolls: 1,
      },
    ],
  }
}

/** The game's own sound type of each block sound a project may choose: the choice is saved by its old name, and the game's field is not always that name. */
export const SOUND_TYPES: Record<BlockSound, string> = {
  stone: "STONE",
  wood: "WOOD",
  gravel: "GRAVEL",
  grass: "GRASS",
  metal: "METAL",
  glass: "GLASS",
  wool: "WOOL",
  sand: "SAND",
  snow: "SNOW",
  deepslate: "DEEPSLATE",
  netherrack: "NETHERRACK",
  nether_ore: "NETHER_ORE",
  basalt: "BASALT",
  soul_sand: "SOUL_SAND",
  bone: "BONE_BLOCK",
  netherite: "NETHERITE_BLOCK",
  ancient_debris: "ANCIENT_DEBRIS",
  amethyst_block: "AMETHYST",
  copper: "COPPER",
  tuff: "TUFF",
  calcite: "CALCITE",
  dripstone_block: "DRIPSTONE_BLOCK",
  slime: "SLIME_BLOCK",
  honey: "HONEY_BLOCK",
  moss_block: "MOSS",
  mud: "MUD",
  sculk: "SCULK",
  bamboo_wood: "BAMBOO_WOOD",
  cherry_wood: "CHERRY_WOOD",
}

/** A block whose bounce or launch is written where it is registered (a block with a shape has a class of its own, which carries it). */
const bouncing = (block: Block) => (bounceOf(block) > 0 || launchOf(block) > 0) && !isShaped(block)

function compileJava(content: Content, modId: string, packageName: string) {
  const source = `src/main/java/${packageName.replaceAll(".", "/")}`
  const blockFields = content.blocks.map((block) => `    public static final Block BLOCK_${block.identifier.toUpperCase()} = Registry.register(BuiltInRegistries.BLOCK, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${block.identifier}"), ${isShaped(block) ? `new ${shapedClass(block)}(` : block.experience ? `new DropExperienceBlock(UniformInt.of(${block.experience.min}, ${block.experience.max}), ` : "new Block("}BlockBehaviour.Properties.of().strength(${block.hardness}f).lightLevel(state -> ${block.luminance})${needsTool(block) ? ".requiresCorrectToolForDrops()" : ""}${block.sound ? `.sound(SoundType.${SOUND_TYPES[block.sound]})` : ""}${movementSource(block.movement)}${isShaped(block) ? ".noOcclusion()" : ""})${bouncing(block) ? ` {\n${bounceSource(bounceOf(block), "        ", launchOf(block))}\n    }` : ""});`).join("\n")
  const blockItems = content.blocks.map((block) => `    public static final Item BLOCK_ITEM_${block.identifier.toUpperCase()} = Registry.register(BuiltInRegistries.ITEM, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${block.identifier}"), new BlockItem(BLOCK_${block.identifier.toUpperCase()}, new Item.Properties()${block.lucky ? `.stacksTo(${block.lucky.max_stack})` : ""}));`).join("\n")
  const natures = compileItemNatures(content, modId, packageName)
  const itemFields = content.items.map((item) => `${materialSource(item)}    public static final Item ITEM_${item.identifier.toUpperCase()} = Registry.register(BuiltInRegistries.ITEM, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${item.identifier}"), ${itemSource(item)});`).join("\n")
  // Only what the class uses is imported: a project without blocks, or without anything to register, names none of their classes.
  const blocks = content.blocks.length > 0
  const registers = blocks || content.items.length > 0
  const sourceCode = `package ${packageName};

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
${blocks ? "import net.minecraft.world.level.block.Block;\nimport net.minecraft.world.level.block.state.BlockBehaviour;\n" : ""}${content.blocks.some(bouncing) ? BOUNCE_IMPORTS.map((name) => `import ${name};\n`).join("") : ""}${content.blocks.filter(isShaped).map((block) => `import ${packageName}.block.${shapedClass(block)};\n`).join("")}${content.blocks.some((block) => block.experience && !isShaped(block)) ? "import net.minecraft.world.level.block.DropExperienceBlock;\n" : ""}${blocks ? "import net.minecraft.world.item.BlockItem;\n" : ""}${registers ? "import net.minecraft.core.Registry;\nimport net.minecraft.core.registries.BuiltInRegistries;\n" : ""}import net.minecraft.world.item.CreativeModeTabs;
${registers ? "import net.minecraft.world.item.Item;\n" : ""}${content.blocks.some((block) => block.sound) ? "import net.minecraft.world.level.block.SoundType;\n" : ""}${registers ? "import net.minecraft.resources.ResourceLocation;\n" : ""}${content.blocks.some((block) => block.experience && !isShaped(block)) ? "import net.minecraft.util.valueproviders.UniformInt;\n" : ""}${natures.imports}
public final class StudioContent implements ModInitializer {
    public static final String MOD_ID = "${modId}";
${blockFields}${blockFields ? "\n" : ""}${blockItems}${blockItems ? "\n" : ""}${itemFields}
    public static void register() {
${content.blocks.some(block => block.lucky) ? "        StudioLuckyCaches.register();" : ""}
${content.blocks.some((block) => block.generation) ? "        StudioWorldgen.register();\n" : ""}        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.BUILDING_BLOCKS).register(entries -> {
${content.blocks.map(block => `            entries.accept(BLOCK_ITEM_${block.identifier.toUpperCase()});`).join("\n")}
        });
        ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.INGREDIENTS).register(entries -> {
${content.items.filter((item) => !item.tool && !item.food && !item.armor).map(item => `            entries.accept(ITEM_${item.identifier.toUpperCase()});`).join("\n")}
        });
${natures.registrations}    }
    @Override public void onInitialize() { register(); }
}
`
  return { [`${source}/StudioContentRegistry.java`]: sourceCode.replace("public final class StudioContent", "public final class StudioContentRegistry"), ...natures.files }
}

/**
 * A project's blocks, items and recipes as source files. `target`: what they are generated for; Fabric 1.21.1 (the
 * default) is generated by this file's own text, exactly as before. A facade target (Forge, NeoForge) gets the same
 * blocks, items and data through `StudioPlatform`, its data mapped to its game version, and refuses a feature group
 * not ported to it yet (`platform/ported.ts`).
 */
export function compileContent(input: unknown, target: GenTarget = FABRIC_TARGET): CompiledContent {
  const value = typeof input === "object" && input !== null ? input as Partial<ContentInput> : {}
  const content = validateContent(input)
  const modId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).parse(value.mod_id)
  const packageName = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+$/).parse(value.package_name)
  const resources = `src/main/resources/assets/${modId}`
  const data = `src/main/resources/data/${modId}`
  const facade = target.loader.facade
  if (facade) assertPorted({ entities: [], blocks: content.blocks, items: content.items, workspace: { assets: [] } }, target)
  // The vanilla items and tags were checked against 1.21.1 and Fabric's convention tags; a facade target may not have all of them.
  if (facade) {
    const references = [
      ...content.recipes.flatMap((recipe, recipeIndex) => [...recipe.pattern.flatMap((reference, patternIndex) => (reference ? [{ reference, path: ["recipes", recipeIndex, "pattern", patternIndex] }] : [])), { reference: recipe.result, path: ["recipes", recipeIndex, "result"] }]),
      ...content.items.flatMap((item, itemIndex) => (item.tool?.repair ? [{ reference: item.tool.repair, path: ["items", itemIndex, "tool", "repair"] }] : [])),
      ...content.items.flatMap((item, itemIndex) => (item.armor?.repair ? [{ reference: item.armor.repair, path: ["items", itemIndex, "armor", "repair"] }] : [])),
      ...content.logic.flatMap((logic, logicIndex) => (logic.item ? [{ reference: logic.item, path: ["logic", logicIndex, "item"] }] : [])),
    ]
    for (const entry of references) {
      const missing = targetVanillaIssue(entry.reference, target.manifest.id)
      if (missing) throw issue(missing, entry.path)
    }
  }
  const files: Record<string, string | Uint8Array> = facade
    ? {
        ...platformContentRegistry(content, modId, packageName, target, SOUND_TYPES),
        // The game's tags that let enchantments and other mods know a tool by its kind (`swords`, `pickaxes`…): data, the same on every loader.
        ...Object.fromEntries(Object.entries(compileItemNatures(content, modId, packageName).files).filter(([name]) => !name.endsWith(".java"))),
      }
    : {
        ...compileJava(content, modId, packageName),
        ...compileLuckyCaches(content.blocks, packageName),
        ...compileShapedClient(content.blocks, packageName),

      }
  content.blocks.forEach((block) => {
    const faces = isShaped(block) ? compileShapedBlock(block, modId, resources, packageName, readPngSize(block.shape.sheet)!.width) : compileBlockFaces(block, modId, resources)
    // A facade target: the class of a block with a shape is the registry's (mapped to the version), and the holes in its picture are in its model.
    if (facade && isShaped(block))
      Object.keys(faces).forEach((name) => {
        if (name.endsWith(".java")) delete faces[name]
        else if (name === `${resources}/models/block/${block.identifier}.json`) faces[name] = cutoutModel(String(faces[name]))
      })
    Object.assign(files, faces)
    files[`${resources}/models/item/${block.identifier}.json`] = JSON.stringify({ parent: `${modId}:block/${block.identifier}` }, null, 2)
    files[`${resources}/textures/block/${block.identifier}.png`] = compileTexture(block.color, block.texture)
    files[`${data}/loot_table/blocks/${block.identifier}.json`] = block.drop === "item" && block.drop_item ? JSON.stringify(oreLoot(modId, block.identifier, block.drop_item), null, 2) : JSON.stringify(block.drop === "self" ? { type: "minecraft:block", pools: [{ rolls: 1, entries: [{ type: "minecraft:item", name: `${modId}:${block.identifier}` }], conditions: [{ condition: "minecraft:survives_explosion" }] }] } : { type: "minecraft:block", pools: [] }, null, 2)
  })
  content.items.forEach((item) => {
    const design = item.model_asset_id ? value.item_models?.[item.model_asset_id] : undefined
    if (item.model_asset_id && !design) throw new Error(`物品 ${item.name} 缺少关联模型 ${item.model_asset_id}`)
    const model = design ? compileItemModel(design) : undefined
    files[`${resources}/models/item/${item.identifier}.json`] = JSON.stringify({
      ...(model ? { elements: model.elements, gui_light: "side" } : { parent: item.tool ? "minecraft:item/handheld" : "minecraft:item/generated" }),
      textures: { layer0: `${modId}:item/${item.identifier}`, ...(model ? { particle: `${modId}:item/${item.identifier}` } : {}) },
      ...(item.display || model ? { display: exportItemDisplay(item.display, !!item.tool, !!model) } : {}),
    }, null, 2)
    files[`${resources}/textures/item/${item.identifier}.png`] = model ? encodePng(model.texture.pixels, model.texture.size, model.texture.size) : compileTexture(item.color, item.texture)
  })
  content.recipes.forEach((recipe) => {
    files[`${data}/recipe/${recipe.id}.json`] = JSON.stringify(compileRecipe(recipe, content, modId), null, 2)
  })
  ;["pickaxe", "axe", "shovel"].forEach(tool => {
    const values = content.blocks.filter(block => block.tool === tool).map(block => `${modId}:${block.identifier}`)
    if (values.length) files[`src/main/resources/data/minecraft/tags/block/mineable/${tool}.json`] = JSON.stringify({ replace: false, values }, null, 2)
  })
  Object.entries(TOOL_TIERS).forEach(([tier, words]) => {
    const values = content.blocks.filter((block) => block.tool_tier === tier).map((block) => `${modId}:${block.identifier}`)
    if (values.length) files[`src/main/resources/data/minecraft/tags/block/${words.tag}.json`] = JSON.stringify({ replace: false, values }, null, 2)
  })
  // A facade target takes the same two worldgen documents and adds them to the biomes by the loader's data (`LoaderAdapter.featureFiles`), not Fabric's class.
  Object.assign(
    files,
    facade
      ? {
          ...Object.fromEntries(Object.entries(compileWorldgen(content.blocks, modId, packageName)).filter(([name]) => !name.endsWith(".java"))),
          ...Object.assign({}, ...content.blocks.flatMap((block) => (block.generation ? [target.loader.featureFiles({ modId, feature: `ore_${block.identifier}`, dimension: block.generation.dimension, biomeTag: block.generation.biomes })] : []))),
        }
      : compileWorldgen(content.blocks, modId, packageName),
  )
  // A thing without an English name keeps its Chinese one in both files, which is what every build did before name_en.
  const language = (english: boolean) => ({ ...Object.fromEntries(content.blocks.map(block => [`block.${modId}.${block.identifier}`, (english && block.name_en) || block.name])), ...Object.fromEntries(content.items.map(item => [`item.${modId}.${item.identifier}`, (english && item.name_en) || item.name])) })
  files[`${resources}/lang/zh_cn.json`] = JSON.stringify(language(false), null, 2)
  files[`${resources}/lang/en_us.json`] = JSON.stringify(language(true), null, 2)
  return facade ? mapDataFiles(files, target) : files
}

/** Every data file in its target game version's folder and form (`VersionAdapter.dataFile`); everything else as it is. */
export function mapDataFiles(files: Record<string, string | Uint8Array>, target: GenTarget) {
  return Object.fromEntries(
    Object.entries(files).map(([name, contents]) => {
      if (typeof contents !== "string" || !name.startsWith("src/main/resources/data/")) return [name, contents]
      const mapped = target.version.dataFile(name, contents)
      return [mapped.file, mapped.text]
    }),
  )
}

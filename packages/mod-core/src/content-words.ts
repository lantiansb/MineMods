/**
 * The fixed vocabularies of what connects a mod's things to the world (the kinds of recipe, what an item can
 * be besides an ordinary item), each with the plain words a player knows it by. Schemas, the generated Java
 * and data files, the playability answers and the instructions an AI reads all come from here, so a word can
 * never be offered that the build cannot honour. Every id, tag, class and number named is Minecraft 1.21.1's
 * own, read off the game jar; a test holds the generated files to the game's.
 * No Node APIs.
 */
import { CONVENTION_ITEM_TAGS, MINECRAFT_ITEM_TAGS, VANILLA_ITEM_NAMES } from "./fabric/content-vanilla"
import type { Item } from "./content"
import { BLOCK_FACES } from "@minemods/studio-ai/texture-facts"

/**
 * The kinds of recipe. `type` is the game's recipe type. `time` marks the cooking family and is the game's own
 * default for that station, in ticks. `slots` says how the nine `pattern` slots of a recipe document are read:
 * grid (position matters), any (1–9 things, position ignored), one (exactly one thing), three (slots 0, 1, 2
 * are the template, the thing being upgraded and what is added to it).
 */
export const RECIPE_KINDS = {
  shaped: { type: "minecraft:crafting_shaped", station: "工作台", slots: "grid" },
  shapeless: { type: "minecraft:crafting_shapeless", station: "工作台", slots: "any" },
  smelting: { type: "minecraft:smelting", station: "熔炉", slots: "one", time: 200, verb: "烧" },
  blasting: { type: "minecraft:blasting", station: "高炉", slots: "one", time: 100, verb: "烧" },
  smoking: { type: "minecraft:smoking", station: "烟熏炉", slots: "one", time: 100, verb: "熏" },
  campfire: { type: "minecraft:campfire_cooking", station: "营火", slots: "one", time: 600, verb: "烤" },
  stonecutting: { type: "minecraft:stonecutting", station: "切石机", slots: "one" },
  smithing: { type: "minecraft:smithing_transform", station: "锻造台", slots: "three" },
} as const satisfies Record<string, { type: string; station: string; slots: "grid" | "any" | "one" | "three"; time?: number; verb?: string }>
export type RecipeKind = keyof typeof RECIPE_KINDS

/** The game's default cooking time of a kind, or null for a kind that does not cook. */
export const cookingTime = (kind: RecipeKind) => {
  const words = RECIPE_KINDS[kind]
  return "time" in words ? words.time : null
}

export const RECIPE_LIMITS = { experience: 10, cooking_time: 6000 } as const

/**
 * The tools an item can be. `java` is the game's class, `tag` the vanilla item tag that makes its enchantments
 * available, `speed` the attacks per second vanilla's iron one has, `mines` the block tool word it digs.
 */
export const TOOL_KINDS = {
  pickaxe: { name: "镐", java: "PickaxeItem", tag: "pickaxes", speed: 1.2, mines: "pickaxe", tab: "TOOLS" },
  axe: { name: "斧", java: "AxeItem", tag: "axes", speed: 0.9, mines: "axe", tab: "TOOLS" },
  shovel: { name: "锹", java: "ShovelItem", tag: "shovels", speed: 1, mines: "shovel", tab: "TOOLS" },
  hoe: { name: "锄", java: "HoeItem", tag: "hoes", speed: 3, mines: null, tab: "TOOLS" },
  sword: { name: "剑", java: "SwordItem", tag: "swords", speed: 1.6, mines: null, tab: "COMBAT" },
} as const
export type ToolKind = keyof typeof TOOL_KINDS

/**
 * What a tool's material is good enough to mine. `tag` is the `BlockTags` constant of the blocks it cannot
 * mine; `rank` orders the levels against a block's `tool_tier` (stone 1, iron 2, diamond 3).
 */
export const MINING_LEVELS = {
  wood: { name: "木", tag: "INCORRECT_FOR_WOODEN_TOOL", rank: 0, reach: "只挖得动不挑材质的方块，和木镐一样" },
  stone: { name: "石", tag: "INCORRECT_FOR_STONE_TOOL", rank: 1, reach: "挖得动铁矿这一档，和石镐一样" },
  iron: { name: "铁", tag: "INCORRECT_FOR_IRON_TOOL", rank: 2, reach: "挖得动钻石矿这一档，和铁镐一样" },
  diamond: { name: "钻石", tag: "INCORRECT_FOR_DIAMOND_TOOL", rank: 3, reach: "挖得动黑曜石这一档，和钻石镐一样" },
  netherite: { name: "下界合金", tag: "INCORRECT_FOR_NETHERITE_TOOL", rank: 4, reach: "什么都挖得动，和下界合金镐一样" },
} as const
export type MiningLevel = keyof typeof MINING_LEVELS
export const TIER_RANKS = { stone: 1, iron: 2, diamond: 3 } as const

/**
 * The four places a piece of armor is worn (`armor.slot` of an item). `type` is the game's `ArmorItem.Type`, `tag` the 1.21 enchantable tag that makes that
 * piece's enchantments (Protection, Respiration, Feather Falling…) available, `name` how the person is told it. Vanilla's iron piece for scale: `iron`.
 */
export const ARMOR_SLOTS = {
  head: { name: "头盔", type: "HELMET", tag: "head_armor", iron: { defense: 2, durability: 165 } },
  chest: { name: "胸甲", type: "CHESTPLATE", tag: "chest_armor", iron: { defense: 6, durability: 240 } },
  legs: { name: "护腿", type: "LEGGINGS", tag: "leg_armor", iron: { defense: 5, durability: 225 } },
  feet: { name: "靴子", type: "BOOTS", tag: "foot_armor", iron: { defense: 2, durability: 195 } },
} as const
export type ArmorSlot = keyof typeof ARMOR_SLOTS

/**
 * What a piece of armor looks like worn, when it has no model of its own (`armor.look`): one of the game's own armors, drawn with that armor's texture
 * on the player, with its equip sound. Leather is left out: the game draws its texture only dyed.
 */
/** An item's rarity, as the game's own `Rarity` (the same four on 1.20.1 and 1.21.1): its name in the window and the colour it is shown in. */
export const ITEM_RARITIES = {
  common: { label: "普通", colour: "白色", java: "COMMON" },
  uncommon: { label: "罕见", colour: "黄色", java: "UNCOMMON" },
  rare: { label: "稀有", colour: "青色", java: "RARE" },
  epic: { label: "史诗", colour: "紫色", java: "EPIC" },
} as const
export type ItemRarity = keyof typeof ITEM_RARITIES

export const ARMOR_LOOKS = {
  chainmail: { name: "锁链甲", sound: "ARMOR_EQUIP_CHAIN" },
  iron: { name: "铁甲", sound: "ARMOR_EQUIP_IRON" },
  gold: { name: "金甲", sound: "ARMOR_EQUIP_GOLD" },
  diamond: { name: "钻石甲", sound: "ARMOR_EQUIP_DIAMOND" },
  netherite: { name: "下界合金甲", sound: "ARMOR_EQUIP_NETHERITE" },
} as const
export type ArmorLook = keyof typeof ARMOR_LOOKS

// The widest numbers a document may carry. Vanilla for scale: durability wood 59 / iron 250 / diamond 1561;
// mining speed wood 2 / iron 6 / diamond 8; enchantability stone 5 / iron 14 / gold 22; coal burns 1600 ticks.
// Armor: defense diamond helmet 3 / chestplate 8, toughness diamond 2 / netherite 3, knockback resistance netherite 0.1 a piece.
export const ITEM_LIMITS = { durability: 10000, mining_speed: 20, attack_damage: 40, enchantability: 30, hunger: 20, saturation: 2, burn_ticks: 32000, defense: 20, toughness: 10, knockback_resistance: 1 } as const

/**
 * How a block changes the movement of whoever stands on it (`movement` of a block), each range with the vanilla
 * numbers it comes from. `speed` is `BlockBehaviour.Properties.speedFactor` (default 1; soul sand and honey
 * block 0.4), `jump` is `jumpFactor` (default 1; honey block 0.5), `slip` is `friction` (default
 * 0.6; ice 0.98, blue ice 0.989, the slipperiest block there is). The slow end 0.2 is half of the slowest vanilla
 * block (0.4): lower and a player hardly moves at all. A slip under 0.6 would be grippier than any block of the game.
 */
export const MOVEMENT_LIMITS = { speed: { min: 0.2, max: 1 }, jump: { min: 0.2, max: 1 }, slip: { min: 0.6, max: 0.989 } } as const
/** What a block that says nothing about its movement does: the game's own settings defaults, so a part still at these is not written. */
export const MOVEMENT_PLAIN = { speed: 1, jump: 1, slip: 0.6 } as const

/**
 * How much of the speed it lands with a block gives back (`bounce` of a block): the share of a fall the player
 * is thrown up again by. 0 is an ordinary block; 1 is the slime block, which sends a landing back up at the speed
 * it came down. More than 1 would throw them higher than they fell, which no block of the game does.
 */
export const BOUNCE_LIMITS = { min: 0, max: 1 } as const

/**
 * How high a block throws up whoever stands on it (`launch` of a block), in blocks. The low end 1.25 is what one
 * ordinary jump reaches (jump speed 0.42): a launch lower than that is no launch, so the field is left out and not
 * set low. The high end 10 is the most a child should be thrown by one step: landing off the pad from 10 blocks costs
 * 7 points of health (a fall hurts from 3 blocks on, one point per block more), under half of the 20 a player has,
 * where the 23 blocks that kill a full-health player is far off. Jump Boost II, the strongest potion a player
 * brews, reaches about 2.5 and Jump Boost III about 3.3.
 */
export const LAUNCH_LIMITS = { min: 1.25, max: 10 } as const

/**
 * What each of a block's three ways of treating whoever meets it is for, said once. The brief of whoever makes a block
 * (`BLOCK_MOVEMENT_INSTRUCTIONS`), the one line of what a block can do that the planner reads (`BLOCK_STANDING_SUMMARY`, in
 * the block's `summary`) and the capability list all take their words from here, so the three never describe a field
 * differently: before this the planner had a line of its own, and a jelly that throws you up was planned as a bounce.
 * `what` is what the person feels, `like` is what it is for, `only` is where the field stops.
 */
export const BLOCK_STANDING = {
  movement: { what: "踩上去变慢、跳不高、打滑", like: "", only: "" },
  bounce: { what: "落下去会反弹", like: "黏液块、蹦床", only: "只管落上去反弹，走路的速度不变" },
  launch: { what: "踩上去会弹人", like: "果冻、跳板、弹簧垫", only: "站上去、走上去就弹，不用先摔下来" },
} as const

/** The same three as one list for a planner: the field, what it does, what it is for, where it stops. */
export const BLOCK_STANDING_SUMMARY = (Object.entries(BLOCK_STANDING) as [keyof typeof BLOCK_STANDING, (typeof BLOCK_STANDING)[keyof typeof BLOCK_STANDING]][])
  .map(([field, words]) => `${field}（${words.what}${words.like ? `，如${words.like}` : ""}${words.only ? `；${words.only}` : ""}）`)
  .join("、")

/**
 * The status effects a food or drink may give (`effects[].effect`), each by its id in the game, with the name
 * the game shows in Chinese, what it does in a few plain words, its constant in the game's `MobEffects` (Mojang's names,
 * 1.21.1) and whether it is instant (`InstantenousMobEffect`: it happens once, length means nothing).
 * Only effects that make sense to eat or drink are on the list: no wither, no bad omen, no darkness.
 */
export const FOOD_EFFECTS = {
  regeneration: { name: "生命恢复", does: "慢慢回血", java: "REGENERATION" },
  instant_health: { name: "瞬间治疗", does: "立刻回血", java: "HEAL", instant: true },
  absorption: { name: "伤害吸收", does: "多出几颗黄色的心，先挡伤害", java: "ABSORPTION" },
  saturation: { name: "饱和", does: "立刻补饥饿和饱食度", java: "SATURATION", instant: true },
  speed: { name: "速度", does: "跑得更快", java: "MOVEMENT_SPEED" },
  haste: { name: "急迫", does: "挖得更快", java: "DIG_SPEED" },
  strength: { name: "力量", does: "近战伤害更高", java: "DAMAGE_BOOST" },
  jump_boost: { name: "跳跃提升", does: "跳得更高", java: "JUMP" },
  resistance: { name: "抗性提升", does: "受到的伤害变少", java: "DAMAGE_RESISTANCE" },
  fire_resistance: { name: "防火", does: "不怕火和岩浆", java: "FIRE_RESISTANCE" },
  water_breathing: { name: "水下呼吸", does: "在水里不会憋气", java: "WATER_BREATHING" },
  night_vision: { name: "夜视", does: "黑暗里也看得清", java: "NIGHT_VISION" },
  slow_falling: { name: "缓降", does: "掉下来变慢，不摔伤", java: "SLOW_FALLING" },
  luck: { name: "幸运", does: "战利品更好", java: "LUCK" },
  glowing: { name: "发光", does: "全身发光，隔着墙也看得见", java: "GLOWING" },
  poison: { name: "中毒", does: "持续掉血（不会掉到死）", java: "POISON" },
  hunger: { name: "饥饿", does: "饿得更快", java: "HUNGER" },
  nausea: { name: "反胃", does: "画面晃动", java: "CONFUSION" },
  slowness: { name: "缓慢", does: "走得更慢", java: "MOVEMENT_SLOWDOWN" },
  weakness: { name: "虚弱", does: "近战伤害变低", java: "WEAKNESS" },
  mining_fatigue: { name: "挖掘疲劳", does: "挖得更慢", java: "DIG_SLOWDOWN" },
  blindness: { name: "失明", does: "看不清远处", java: "BLINDNESS" },
  levitation: { name: "飘浮", does: "不受控制地往上飘", java: "LEVITATION" },
} as const satisfies Record<string, { name: string; does: string; java: string; instant?: true }>
export type FoodEffect = keyof typeof FOOD_EFFECTS

/**
 * The widest numbers of a food's effects. Vanilla for scale: the enchanted golden apple gives four effects, the
 * longest of them 300 seconds (fire resistance and resistance, 5 minutes) and the strongest absorption IV;
 * rotten flesh gives hunger with a 0.8 chance. So up to four, up to twice the longest vanilla food gives, one
 * level above the strongest.
 */
export const FOOD_EFFECT_LIMITS = { count: 4, seconds: { min: 1, max: 600 }, level: { min: 1, max: 5 } } as const

/**
 * What a food may leave in the hand once it is eaten (`leaves`): the item, the Chinese name for it and the
 * constant in the game's `Items` (official names, 1.21.1). Vanilla for scale: honey bottles leave a glass bottle, stews and soups leave a bowl.
 */
export const FOOD_LEAVES = {
  "minecraft:glass_bottle": { name: "玻璃瓶", java: "GLASS_BOTTLE" },
  "minecraft:bowl": { name: "碗", java: "BOWL" },
} as const satisfies Record<string, { name: string; java: string }>
export type FoodLeaves = keyof typeof FOOD_LEAVES

/** A project's own thing or a vanilla item (`mod:name`), or any item of a tag (`#minecraft:planks`). */
export const INGREDIENT_PATTERN = /^#?[a-z][a-z0-9_.-]{0,63}:[a-z0-9][a-z0-9_./-]{0,63}$/

// What the commonest tags are called; any other tag is said by its id.
const TAG_NAMES: Readonly<Record<string, string>> = {
  "minecraft:planks": "木板",
  "minecraft:logs": "原木",
  "minecraft:logs_that_burn": "能烧的原木",
  "minecraft:wooden_slabs": "木台阶",
  "minecraft:wool": "羊毛",
  "minecraft:wool_carpets": "羊毛地毯",
  "minecraft:coals": "煤炭或木炭",
  "minecraft:sand": "沙子",
  "minecraft:leaves": "树叶",
  "minecraft:saplings": "树苗",
  "minecraft:flowers": "花",
  "minecraft:small_flowers": "小花",
  "minecraft:fishes": "鱼",
  "minecraft:meat": "肉",
  "minecraft:stone_crafting_materials": "圆石一类的石头",
  "minecraft:stone_tool_materials": "圆石一类的石头",
  "minecraft:swords": "剑",
  "minecraft:pickaxes": "镐",
  "minecraft:axes": "斧",
  "minecraft:shovels": "锹",
  "minecraft:hoes": "锄",
  "c:ingots/iron": "铁锭",
  "c:ingots/gold": "金锭",
  "c:ingots/copper": "铜锭",
  "c:ingots/netherite": "下界合金锭",
  "c:nuggets/iron": "铁粒",
  "c:nuggets/gold": "金粒",
  "c:gems/diamond": "钻石",
  "c:gems/emerald": "绿宝石",
  "c:gems/amethyst": "紫水晶碎片",
  "c:gems/lapis": "青金石",
  "c:gems/quartz": "下界石英",
  "c:dusts/redstone": "红石粉",
  "c:dusts/glowstone": "荧石粉",
  "c:rods/wooden": "木棍",
  "c:rods/blaze": "烈焰棒",
  "c:strings": "线",
  "c:leathers": "皮革",
  "c:feathers": "羽毛",
  "c:bones": "骨头",
  "c:eggs": "蛋",
  "c:slime_balls": "黏液球",
  "c:ender_pearls": "末影珍珠",
  "c:gunpowders": "火药",
  "c:cobblestones": "圆石",
  "c:stones": "石头",
  "c:glass_blocks": "玻璃",
  "c:dyes": "染料",
}

/** How many single-letter changes turn one word into the other. */
function editDistance(left: string, right: string) {
  return [...left].reduce((row, letter, index) => right.split("").reduce((next, other, column) => [...next, Math.min(next[column]! + 1, row[column + 1]! + 1, row[column]! + (letter === other ? 0 : 1))], [index + 1]), Array.from({ length: right.length + 1 }, (_, column) => column))[right.length]!
}

/** Why a reference outside this project cannot be written, in plain words, or null when the game has it. */
export function vanillaIssue(reference: string) {
  const tag = reference.startsWith("#")
  const [namespace, name] = (tag ? reference.slice(1) : reference).split(":") as [string, string]
  if (tag) {
    if (namespace === "minecraft" && MINECRAFT_ITEM_TAGS.has(name)) return null
    if (namespace === "c" && CONVENTION_ITEM_TAGS.has(name)) return null
    return `Minecraft 1.21.1 和 Fabric 都没有 ${reference} 这个物品标签。标签只能写原版的（例如 #minecraft:planks 任意木板、#minecraft:logs 任意原木）或通用的（例如 #c:ingots/iron 任意铁锭）；拿不准就直接写物品 id。`
  }
  if (namespace !== "minecraft") return null
  if (name in VANILLA_ITEM_NAMES) return null
  // The real ids nearest in spelling: almost always what was meant.
  const near = Object.keys(VANILLA_ITEM_NAMES)
    .map((id) => ({ id, distance: editDistance(id, name) }))
    .filter((candidate) => candidate.distance <= Math.max(2, Math.floor(name.length / 3)))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 3)
    .map((candidate) => `minecraft:${candidate.id}（${VANILLA_ITEM_NAMES[candidate.id]}）`)
  return `Minecraft 1.21.1 里没有 ${reference} 这个物品${near.length ? `；相近的有 ${near.join("、")}` : ""}。写错的原版物品会让这条配方在游戏里整条作废。`
}

/**
 * How a referenced thing is said to a player: this project's by the name the caller gives it in 「」, a vanilla
 * item by its Chinese name, a tag as 「任意木板」.
 */
export function referenceWords(reference: string, modId: string, own: (identifier: string) => string | null) {
  if (reference.startsWith("#")) return `任意${TAG_NAMES[reference.slice(1)] ?? `带 ${reference} 标签的物品`}`
  const [namespace, name] = reference.split(":") as [string, string]
  if (namespace === modId) return `「${own(name) ?? name}」`
  return VANILLA_ITEM_NAMES[name] ?? reference
}

const seconds = (ticks: number) => `${Number((ticks / 20).toFixed(1))} 秒`
const listed = (parts: readonly string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join("、")}和 ${parts.at(-1)}` : (parts[0] ?? ""))

type RecipeFacts = { type?: RecipeKind | undefined; pattern: readonly (string | null)[]; result: string; count: number; experience?: number | null | undefined; cooking_time?: number | null | undefined }
type FoodEffectFacts = { effect: FoodEffect; seconds: number; level: number; chance: number }
type FoodFacts = { hunger: number; always_edible?: boolean | undefined; snack?: boolean | undefined; effects?: readonly FoodEffectFacts[] | null | undefined; drink?: boolean | null | undefined; leaves?: FoodLeaves | null | undefined }
type MovementFacts = { speed: number; jump: number; slip: number }
const percentOf = (fraction: number) => `${Number((fraction * 100).toFixed(1))}%`
const ROMAN = ["I", "II", "III", "IV", "V"] as const
/** 「生命恢复 II（慢慢回血）8 秒」, 「中毒（持续掉血）5 秒，30% 的机会」; an instant effect has no length to say. */
const foodEffectWords = (effect: FoodEffectFacts) => {
  const words = FOOD_EFFECTS[effect.effect]
  return `${words.name}${effect.level > 1 ? ` ${ROMAN[effect.level - 1]}` : ""}（${words.does}）${"instant" in words ? "" : ` ${effect.seconds} 秒`}${effect.chance < 1 ? `，${percentOf(effect.chance)} 的机会` : ""}`
}
type ToolFacts = { kind: ToolKind; durability: number; mining_level: MiningLevel; mining_speed: number; attack_damage: number; attack_speed?: number | null | undefined; enchantability: number; repair: string | null }

/**
 * The connection facts as plain sentences. Whatever shows a recipe or an item's nature to the person says it
 * with these, so two places can never disagree; every number in a sentence is a number of the data it was given.
 */
export const contentWords = {
  armor: (armor: NonNullable<Item["armor"]>, said: (reference: string) => string) =>
    `可穿戴的${ARMOR_SLOTS[armor.slot].name}，护甲 ${armor.defense}，韧性 ${armor.toughness}，抗击退 ${armor.knockback_resistance}，耐久 ${armor.durability}，附魔能力 ${armor.enchantability}${armor.repair ? `；用${said(armor.repair)}修理` : ""}`,
  /** 「在熔炉里把「粗蓝晶」烧 10 秒，得到 1 个「蓝晶锭」，给 0.7 点经验」. `said` names one reference. */
  recipe: (recipe: RecipeFacts, said: (reference: string) => string) => {
    const kind = recipe.type ?? "shaped"
    const words = RECIPE_KINDS[kind]
    const filled = recipe.pattern.filter((value): value is string => value !== null)
    const counts = [...filled.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())].map(([reference, count]) => `${count} 个${said(reference)}`)
    const made = `${recipe.count} 个${said(recipe.result)}`
    if (kind === "shaped") return `在工作台上按配方的格子摆放 ${listed(counts)}，做出 ${made}`
    if (kind === "shapeless") return `在工作台上放进 ${listed(counts)}（怎么摆都行），做出 ${made}`
    if (kind === "stonecutting") return `在切石机里把 1 个${said(filled[0]!)}切成 ${made}`
    if (kind === "smithing") return `在锻造台上放上${said(filled[0]!)}、${said(filled[1]!)}和${said(filled[2]!)}，把${said(filled[1]!)}升级成${said(recipe.result)}（原来的附魔会留着）`
    const experience = recipe.experience ?? 0
    return `${kind === "campfire" ? "放在营火上" : `在${words.station}里`}把${said(filled[0]!)}${"verb" in words ? words.verb : "烧"} ${seconds(recipe.cooking_time ?? cookingTime(kind)!)}，得到 ${made}${experience > 0 ? `，给 ${experience} 点经验` : ""}`
  },
  /** 「是一把镐：耐久 250 次，挖得动钻石矿这一档，和铁镐一样，拿着打一下 4 点伤害」 */
  tool: (tool: ToolFacts, said: (reference: string) => string) =>
    `是一把${TOOL_KINDS[tool.kind].name}：能用 ${tool.durability} 次，拿着打一下 ${tool.attack_damage} 点伤害${
      TOOL_KINDS[tool.kind].mines ? `，${MINING_LEVELS[tool.mining_level].reach}` : tool.kind === "hoe" ? "，能把泥土锄成耕地" : ""
    }${tool.enchantability > 0 ? "，可以附魔" : "，附不了魔"}${tool.repair ? `，在铁砧上用${said(tool.repair)}修` : ""}`,
  /** 「能吃：补 4 点饥饿（2 格鸡腿）」; a drink 「能喝：…，喝下去会有效果：生命恢复 II（慢慢回血）8 秒，喝完剩一个玻璃瓶」. */
  food: (food: FoodFacts) => {
    const verb = food.drink ? "喝" : "吃"
    const effects = (food.effects ?? []).map((effect) => foodEffectWords(effect))
    return `能${verb}：补 ${food.hunger} 点饥饿（${Number((food.hunger / 2).toFixed(1))} 格鸡腿）${food.always_edible ? `，不饿也能${verb}` : ""}${food.snack ? `，${verb}得很快` : ""}${effects.length ? `，${verb}下去会有效果：${effects.join("；")}` : ""}${food.leaves ? `，${verb}完剩一个${FOOD_LEAVES[food.leaves].name}` : ""}`
  },
  /** 「踩上去会变慢（速度变成原来的 40%），跳起来更费劲（起跳力变成原来的 50%）」, or "" for a block that moves whoever stands on it as any block does. */
  movement: (movement: MovementFacts | null | undefined) => {
    if (!movement) return ""
    const parts = [
      movement.speed < MOVEMENT_PLAIN.speed ? `踩上去会变慢（速度变成原来的 ${percentOf(movement.speed)}）` : "",
      movement.jump < MOVEMENT_PLAIN.jump ? `跳起来更费劲（起跳力变成原来的 ${percentOf(movement.jump)}）` : "",
      movement.slip > MOVEMENT_PLAIN.slip ? `脚下很滑（滑度 ${movement.slip}，普通方块 ${MOVEMENT_PLAIN.slip}，原版冰 0.98、蓝冰 0.989）` : "",
    ]
    return parts.filter(Boolean).join("，")
  },
  /** What a block does to whoever lands on or stands on it: its movement, its bounce and its launch, in one sentence ("" when it does none). */
  standing: (block: { movement?: MovementFacts | null; bounce?: number | null; launch?: number | null }) =>
    [
      contentWords.movement(block.movement),
      (block.bounce ?? 0) > BOUNCE_LIMITS.min ? `落上去会弹起来（弹回落下速度的 ${percentOf(block.bounce!)}，原版黏液块 100%；潜行时不弹）` : "",
      (block.launch ?? 0) >= LAUNCH_LIMITS.min ? `踩上去就会被弹起约 ${Number(block.launch!.toFixed(2))} 格高（原版跳一下约 ${LAUNCH_LIMITS.min} 格；潜行时不弹）` : "",
    ].filter(Boolean).join("，"),
  /** 「能当燃料：一个能烧 80 秒，够烧 8 个东西」 */
  fuel: (fuel: { burn_ticks: number }) => `能当燃料：一个能烧 ${seconds(fuel.burn_ticks)}，够熔炉烧 ${Number((fuel.burn_ticks / 200).toFixed(1))} 个东西`,
}

const kinds = (record: Readonly<Record<string, unknown>>) => Object.keys(record).join("|")

/** For whoever writes a recipe document. */
export const RECIPE_INSTRUCTIONS =
  ` type 决定这是哪一种配方（省略时是 shaped）：${Object.entries(RECIPE_KINDS).map(([kind, words]) => `${kind}（${words.station}）`).join("、")}。pattern 永远是 9 格：` +
  "shaped 按 3×3 的位置摆，空位写 null；shapeless 把 1–9 样材料写进任意格，位置不算数；smelting、blasting、smoking、campfire、stonecutting 只有一样材料，写在第 0 格，其余 8 格写 null；" +
  "smithing 的第 0、1、2 格依次是锻造模板、被升级的东西、加进去的材料，其余写 null，升级后原来的附魔会留着。" +
  `烧炼类（smelting 熔炉、blasting 高炉只烧矿物、smoking 烟熏炉只烧食物、campfire 营火）可以再写 experience（每个给的经验，0–${RECIPE_LIMITS.experience}，原版铁锭是 0.7）和 cooking_time（刻，20 刻 1 秒；省略时用原版的：熔炉 200、高炉和烟熏炉 100、营火 600），count 只能是 1；smithing 的 count 也只能是 1。` +
  "同一样东西想让高炉也能烧，就再交一条 blasting 配方。" +
  "材料可以是本工程的方块或物品（写成工程资料里的 reference，例如 project.content 里每个方块、物品都带着；命名空间是 project.mod_id，照抄，不要自己编一个）、原版物品（minecraft:iron_ingot，会按 1.21.1 的物品表核对，写错会被退回并给出相近的名字）、或一类物品的标签（以 # 开头，例如 #minecraft:planks 任意木板、#minecraft:logs 任意原木、#c:ingots/iron 任意铁锭）。result 只能是一个确定的物品（写法同上），不能是标签。" +
  "把 9 个小东西压成 1 块、再把 1 块拆回 9 个，就是两条普通配方（一条 shaped，一条 shapeless、count 9）。" +
  "合成配方（shaped、shapeless）的材料和摆法不能和原版的合成配方一样，也不能和工程里另一条合成配方一样：玩家这样放进工作台，游戏先认出原版的那条，做出来的是原版的东西，不是你的产物。撞了的会被退回，并说明撞的是哪个原版物品；用原版的材料时，换一种摆法，或者多加一样别的材料。" +
  '例：熔炉烧矿 {"type":"smelting","pattern":["mymod:raw_azure",null,null,null,null,null,null,null,null],"result":"mymod:azure_ingot","count":1,"experience":0.7,"cooking_time":200}。'

/**
 * For whoever writes an item document: what a food can do beyond filling the stomach. Said once, so the item and
 * the planner words agree; the numbers are `FOOD_EFFECT_LIMITS` and the effects are `FOOD_EFFECTS`.
 */
export const FOOD_NATURE_INSTRUCTIONS =
  ` 吃了给状态效果、喝的东西、吃完留下东西，都写在 food 里，不要写成 gameplay 代码（数据字段比代码稳）：` +
  `effects 最多 ${FOOD_EFFECT_LIMITS.count} 条，每条 {effect, seconds: ${FOOD_EFFECT_LIMITS.seconds.min}–${FOOD_EFFECT_LIMITS.seconds.max}, level: ${FOOD_EFFECT_LIMITS.level.min}–${FOOD_EFFECT_LIMITS.level.max}, chance: 0–1}；` +
  `effect 只能是 ${Object.entries(FOOD_EFFECTS).map(([key, words]) => `${key}（${words.name}，${words.does}）`).join("、")}；` +
  `seconds 是持续多少秒（原版：金苹果的生命恢复 5 秒、伤害吸收 120 秒，附魔金苹果的抗性提升和防火 300 秒），${Object.entries(FOOD_EFFECTS).filter(([, words]) => "instant" in words).map(([key]) => key).join("、")} 是瞬间生效的，seconds 只能写 1；` +
  `level 是等级（1 是 I，2 是 II；金苹果的生命恢复是 II），chance 是每次吃下去有多大机会得到这个效果（1 是一定，腐肉的饥饿是 0.8，生鸡肉的中毒是 0.3）。` +
  `drink=true 让它用喝的动作和声音（拿着按住右键是喝，不是咬），蜂蜜瓶、药水那样；` +
  `leaves 是吃完留下什么：${Object.entries(FOOD_LEAVES).map(([key, words]) => `${key}（${words.name}）`).join("或")}或 null；留下的东西放回玩家背包，一叠里吃一个也一样。` +
  '例：蜂蜜饮料 {"hunger":3,"saturation":0.3,"always_edible":true,"effects":[{"effect":"regeneration","seconds":8,"level":2,"chance":1}],"drink":true,"leaves":"minecraft:glass_bottle"}。'

/** For whoever writes an item document: what an item can be besides an ordinary item. */
export const ITEM_NATURE_INSTRUCTIONS =
  "物品右键施法用技能资产的 bindings；拿着物品召唤 Boss 写在敌对生物的 boss.summon 中。" +
  " 物品默认是普通物品（只能拿着、当材料）。下面四个字段都可省略或写 null，省略时和以前完全一样；用户说了「只是普通物品」就不要加。" +
  `tool 让它成为真正的工具或武器：{kind: ${kinds(TOOL_KINDS)}, durability: 1–${ITEM_LIMITS.durability}, mining_level: ${kinds(MINING_LEVELS)}, mining_speed: 1–${ITEM_LIMITS.mining_speed}, attack_damage: 1–${ITEM_LIMITS.attack_damage}, attack_speed: null 或 0.5–4, enchantability: 0–${ITEM_LIMITS.enchantability}, repair: null 或一个材料}。` +
  "durability 是能用多少次（原版木 59、石 131、铁 250、钻石 1561）；mining_level 是它挖得动哪一档方块（要求铁镐的方块得用 iron 以上）；mining_speed 是挖对口方块的速度（木 2、石 4、铁 6、钻石 8），剑也要写，写 1 即可；" +
  "attack_damage 是拿着它打一下的总伤害，就是游戏里物品说明上显示的数（铁剑 6、钻石剑 7、铁镐 4）；attack_speed 是每秒能打几下，写 null 用原版同类工具的（剑 1.6、镐 1.2、斧 0.9、锹 1、锄 3）；enchantability 越大附魔台出的附魔越好（铁 14、钻石 10、金 22），0 表示不能附魔；" +
  "repair 是铁砧上用来修它的材料，写法和配方材料一样（本工程物品、原版物品或 # 标签），null 表示不能用材料修。工具不能叠放，max_stack 必须是 1。Studio 会给它生成原版的握持姿势（item/handheld）并加入原版的剑、镐等标签，所以对应的附魔都能用。" +
  `food 让它能吃：{hunger: 1–${ITEM_LIMITS.hunger}, saturation: 0–${ITEM_LIMITS.saturation}, always_edible, snack, effects, drink, leaves}。hunger 是补的饥饿值（2 点是一格鸡腿；面包 5、熟牛排 8），saturation 是饱和系数（面包 0.6、熟牛排 0.8、腐肉 0.1），always_edible=true 不饿也能吃，snack=true 吃得快。工具不能同时是食物。` +
  FOOD_NATURE_INSTRUCTIONS +
  `fuel 让它能当熔炉燃料：{burn_ticks: 20–${ITEM_LIMITS.burn_ticks}}，200 刻烧完一个东西（木棍 100、煤炭 1600）。方块也可以写同样的 fuel。` +
  `armor 让它成为真正的盔甲（一件只穿在一个位置）：{slot: ${kinds(ARMOR_SLOTS)}, defense: 0–${ITEM_LIMITS.defense}, toughness: 0–${ITEM_LIMITS.toughness}, knockback_resistance: 0–${ITEM_LIMITS.knockback_resistance}, durability: 1–${ITEM_LIMITS.durability}, enchantability: 0–${ITEM_LIMITS.enchantability}, repair: null 或一个材料, look: ${kinds(ARMOR_LOOKS)}}。` +
  `slot 是穿在哪（${Object.values(ARMOR_SLOTS).map((slot) => slot.name).join("、")}，依次是 head、chest、legs、feet）；defense 是穿上加几点护甲值，就是护甲栏上的半格数（铁头盔 2、铁胸甲 6、钻石头盔 3、钻石胸甲 8）；toughness 是盔甲韧性（钻石 2、下界合金 3，其他 0）；knockback_resistance 是不被打退的程度，0 到 1（下界合金每件 0.1）；durability 是能挨多少下（铁头盔 165、铁胸甲 240、钻石头盔 363）；enchantability 同工具（铁 9、金 25、钻石 10）；repair 写法同工具；look 是穿在身上画成哪种原版盔甲的样子，同时用那种盔甲的穿戴声音（${Object.entries(ARMOR_LOOKS).map(([id, look]) => `${id} ${look.name}`).join("、")}）。穿在身上的样子现在只能借原版这几种，物品栏里的图标照常用自己的贴图或模型。盔甲不能叠放（max_stack 写 1），不能同时是工具或食物；Studio 会把它加进原版对应部位的附魔标签，保护、水下呼吸、摔落保护这些附魔都能上。` +
  "做不到、要用 gameplay（AI 写的代码）的：弓弩和其他远程武器、盾牌、右键使用有效果的物品（吃喝以外的）、带界面的机器；盔甲穿在身上用自己的模型（比如带角的头盔）现在也还做不到。不要用这四个字段假装做到了。" +
  '例：一把铁镐那一档的镐 {"max_stack":1,"tool":{"kind":"pickaxe","durability":300,"mining_level":"iron","mining_speed":6.5,"attack_damage":4,"attack_speed":null,"enchantability":15,"repair":"mymod:azure_ingot"}}。' +
  ` rarity（可选）是游戏里的稀有度，只管名字的颜色：${Object.entries(ITEM_RARITIES).map(([id, row]) => `${id} ${row.label}（${row.colour}）`).join("、")}；三个版本都用原版的稀有度，不写就是普通。用户说了「稀有」「史诗」这类话，或者要它的名字变色，就写上；没说就不写。`

/** For whoever writes a block document. */
export const BLOCK_FUEL_INSTRUCTIONS = ` 可选 fuel={burn_ticks: 20–${ITEM_LIMITS.burn_ticks}} 让这个方块能当熔炉燃料（200 刻烧完一个东西；煤炭块是 16000），省略或写 null 时不能烧。`

/** For whoever writes a block document: a block that slows, makes jumping hard, or is slippery. */
export const BLOCK_MOVEMENT_INSTRUCTIONS =
  ` 可选 movement={speed: ${MOVEMENT_LIMITS.speed.min}–${MOVEMENT_LIMITS.speed.max}, jump: ${MOVEMENT_LIMITS.jump.min}–${MOVEMENT_LIMITS.jump.max}, slip: ${MOVEMENT_LIMITS.slip.min}–${MOVEMENT_LIMITS.slip.max}} 让走在它上面的人（和生物）动作变样：${BLOCK_STANDING.movement.what}，都用它，不要写成 gameplay 代码。` +
  `三项都要写，不想改的写成原样（speed 1、jump 1、slip ${MOVEMENT_PLAIN.slip}）。speed 是移动速度变成原来的几倍（原版灵魂沙和蜂蜜块 0.4）；jump 是起跳的力变成原来的几倍（蜂蜜块 0.5，起跳的力减半，跳起来的高度比减半还低）；` +
  `slip 是脚下有多滑，${MOVEMENT_PLAIN.slip} 是普通方块，越大越滑（冰 0.98、蓝冰 0.989，站上去停不住）。省略或写 null 时和普通方块一样。例：像蜂蜜块一样粘脚 {"speed":0.4,"jump":0.5,"slip":${MOVEMENT_PLAIN.slip}}。` +
  ` 另有可选的 bounce（${BOUNCE_LIMITS.min}–${BOUNCE_LIMITS.max}，写在方块上，和 movement 并列）做「落上去会弹起来」：落到它上面的人和生物按这个比例被弹回落下时的速度，同时少受（或不受）摔伤，潜行时不弹；1 就是原版黏液块（落多高弹多高、不摔伤），0.5 弹回一半，省略、null 或 0 时不弹。${BLOCK_STANDING.bounce.what}的${BLOCK_STANDING.bounce.like}都用它，${BLOCK_STANDING.bounce.only}，不要写成 gameplay 代码。` +
  ` 另有可选的 launch（${LAUNCH_LIMITS.min}–${LAUNCH_LIMITS.max}，单位是格，写在方块上）做「踩上去就被弹起来」：站上去或走上去的人和生物（不用先摔下来）被弹到这么多格高，像跳板，被弹起后落回它上面不摔伤，潜行时不弹；原版跳一下约 ${LAUNCH_LIMITS.min} 格，填 4 就是三倍多；和 bounce 可以一起用，省略或 null 时不弹。${BLOCK_STANDING.launch.what}的${BLOCK_STANDING.launch.like}都用它，不要写成 gameplay 代码。`

/** For whoever writes a block document: more faces than one, said in two sentences. */
export const BLOCK_FACES_INSTRUCTIONS =
  ` 可选 variants（1–${BLOCK_FACES.extra} 张和 texture 一样大的 PNG data URL，或者让画图脚本 return 一个画布的列表）让游戏在每个位置从 texture 和这几张图里随机用一张，可选 random_mirror=true（随机左右镜像）、random_turn=true（随机转向，只有顶面和底面看得出来）；都省略或写 null 时和以前完全一样。` +
  "几张图要是同一种材质、同一套颜色，只有图案的位置和形状不同：砌成墙以后同一个图案一格一格地重复，单独一张图改不掉的时候，靠的就是这个。"

/**
 * A small shape that is valid whole once it has a 32×32 sheet: a stool, a seat and a leg. The faces' sizes are the
 * boxes' (a 12×2 side, a 12×12 top, a 4×10 side), each given its own place on the sheet; a test holds this to the
 * schema, so what the instructions show is what is accepted.
 */
export const BLOCK_SHAPE_EXAMPLE = {
  facing: "horizontal",
  collision: "shape",
  elements: [
    { name: "seat", from: [2, 10, 2], to: [14, 12, 14], rotation: null, faces: { up: { uv: [0, 0, 12, 12], cull: false }, north: { uv: [12, 0, 24, 2], cull: false }, south: { uv: [12, 2, 24, 4], cull: false }, east: { uv: [12, 4, 24, 6], cull: false }, west: { uv: [12, 6, 24, 8], cull: false } } },
    { name: "leg", from: [6, 0, 6], to: [10, 10, 10], rotation: null, faces: { north: { uv: [0, 12, 4, 22], cull: false }, south: { uv: [4, 12, 8, 22], cull: false }, east: { uv: [8, 12, 12, 22], cull: false }, west: { uv: [12, 12, 16, 22], cull: false } } },
  ],
} as const

/** For whoever writes a block document: a block that is not a whole block. */
export const BLOCK_SHAPE_INSTRUCTIONS =
  " 可选 shape（null 或省略就是整块方块）把方块做成几个方盒子拼成的静态外形：花盆、灯笼、讲台、信箱、雕像、桌椅这类不是整块的东西用它；墙、地板、矿石、砖这类整块的东西不要用它。" +
  "shape={facing, sheet, elements, collision}。facing：\"horizontal\" 放下时正面（north 那一面）朝着放它的玩家，像熔炉和讲台；\"none\" 永远是做出来的样子。" +
  "sheet 是一张 16、32 或 64 像素见方的 PNG data URL（或者让画图脚本画），所有盒子的所有面都画在这一张上；没画的像素是透明的，游戏里是镂空的（不做半透明）。" +
  "elements 是 1–48 个盒子，坐标单位是方块内的像素：方块是 0 到 16（可以伸出到 -8 和 24），x 向东、y 向上、z 向南，所以 north（z 最小的一面）是正面。" +
  "每个盒子是 {name, from, to, rotation, faces}：to 的每一维都要比 from 大；rotation 是 null 或 {axis, angle, origin}，angle 只能是 -45、-22.5、0、22.5、45，一次绕一个轴；" +
  "faces 写 north、south、east、west、up、down 里要画的那几个（看不见的面不写），每个是 {uv: [左, 上, 右, 下], cull}。" +
  "uv 是这个面在 sheet 上的像素位置：north 和 south 面是盒子的（宽 × 高），east 和 west 面是（深 × 高），up 和 down 面是（宽 × 深），一个面要多少像素就在 sheet 上留多少，别的面不要压在上面。" +
  "cull=true 只能写在贴着方块边界（0 或 16）、盒子没转过的面上，它让旁边有方块时这个面不画，其余写 false。" +
  "collision：\"shape\" 时碰撞和选中框就是这些盒子（转过的盒子取外接的方框），可以走进没有盒子的地方；\"full\" 和整块一样。" +
  "有 shape 的方块不能再写 generation、variants、random_mirror、random_turn；texture 仍然要有，它是方块被挖掉时碎片的颜色。" +
  "用画图脚本做外形：return { elements, sheet: 画布, facing, collision }，api.layout 把每个面要的像素块排在 sheet 上，直接给出 uv。" +
  "这一步的外形是静态的：不会动、不能打开、没有半透明；转动的风车、能开的门和箱子做不了。一个有效的小例子（sheet 是 32×32 的图）：elements=" +
  JSON.stringify(BLOCK_SHAPE_EXAMPLE.elements) +
  "。"

/** What a block with a shape is, in the words the mod guide and the facets use; the game can check each part of it. */
export const blockShapeWords = (shape: { facing: "none" | "horizontal"; elements: readonly unknown[]; collision: "full" | "shape" }) =>
  `不是整块，是由 ${shape.elements.length} 个方盒子拼成的${shape.facing === "horizontal" ? "（放下时正面朝着你）" : ""}`

/** What connects things without code, said once for outside AIs and the hand-off text; the same shape as `DATA_CAPABILITY`. */
export const CONNECTION_CAPABILITY = {
  done: [
    "配方有八种：有形合成、无形合成、熔炉、高炉、烟熏炉、营火、切石机、锻造台升级；材料可以是本工程的东西、原版物品（按 1.21.1 的物品表核对）或物品标签。",
    "物品可以是真正的工具或武器（镐、斧、锹、锄、剑）：耐久、挖掘等级和速度、攻击伤害和速度、附魔能力、修理材料都是数据，生成原版的工具类、握持模型和工具标签。",
    "物品可以是真正的盔甲（头盔、胸甲、护腿、靴子）：护甲值、韧性、抗打退、耐久、附魔能力、修理材料都是数据，穿上以后护甲栏、伤害减免和附魔都照原版算；穿在身上画成原版几种盔甲（锁链、铁、金、钻石、下界合金）之一的样子。这一点只有单元测试和 javac 验证过，还没有在游戏里看过。",
    "物品可以是食物（饥饿值、饱和系数、不饿也能吃、吃得快）；食物可以带状态效果（最多 4 条：哪种效果、几秒、几级、多大机会）、可以是喝的（喝的动作和声音）、可以吃完留下玻璃瓶或碗；物品和方块可以是熔炉燃料（燃烧时间）。",
    "方块可以改变站在上面的人的动作（movement）：踩上去变慢（像灵魂沙和蜂蜜块）、跳不高（像蜂蜜块）、打滑（像冰）。",
    `方块可以让落上去的东西弹起来（bounce，${BOUNCE_LIMITS.min} 到 ${BOUNCE_LIMITS.max}）：像黏液块那样${BLOCK_STANDING.bounce.what}，${BLOCK_STANDING.bounce.only}；潜行时不弹。`,
    `方块可以把踩上去的人和生物弹起来（launch，${LAUNCH_LIMITS.min} 到 ${LAUNCH_LIMITS.max} 格高）：${BLOCK_STANDING.launch.only}，像跳板，适合做${BLOCK_STANDING.launch.like}；潜行时不弹。`,
  ],
  not_done: [
    "弓弩等远程武器、盾牌、带界面的机器可用 gameplay（AI 写的代码）。盔甲是数据（armor），但穿在身上只能是原版几种盔甲的样子，还不能用自己的模型。食物的效果只有上面那几种状态效果，不能再带别的反应（比如吃了传送）。",
    "方块的 movement 只管站在上面的速度、起跳和打滑，bounce 只管落上去反弹，launch 只管踩上去弹起；粘在侧面爬墙、进入时的声音和粒子、流体里的阻力不在里面。",
    "配方不能要求带附魔或带耐久的材料，不能在合成后留下空桶一类的东西，烧炼类一次只出 1 个。",
  ],
} as const

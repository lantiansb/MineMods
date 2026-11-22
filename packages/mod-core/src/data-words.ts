/**
 * The fixed vocabularies of the data-only features (where a block generates, how it sounds, what a creature
 * sounds like), each with the plain name a player knows it by. Schemas, the generated Java, the acceptance
 * card and the mod guide all read from here, so a word can never be offered that the build cannot honour.
 * Everything named is vanilla Minecraft 1.21.1; a test checks every entry against the game itself.
 */
import { isSoundAsset, type SoundRef } from "./sound"
import { z } from "zod"
import { CONNECTION_CAPABILITY } from "./content-words"
import { CREATURE_LIFE_CAPABILITY } from "./creature-capability"
import { REGISTRY_NAME_INSTRUCTIONS } from "./registry-name"

/** Chinese characters, kana or hangul: a text holding any is not what an English-language game should show. */
export const hasCjk = (text: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)

/**
 * The name a thing goes by in an English-language game, beside its Chinese `name`. Optional everywhere and
 * absent in older projects: without it both language files carry the Chinese name, exactly as before.
 */
export const EnglishNameSchema = z.string().trim().min(1).max(120).refine((name) => !hasCjk(name), "英文名里不能有中文；写一个简短自然的英文名，例如 Azure Ore。")

/** For whoever writes a block, item or creature document. */
export const ENGLISH_NAME_INSTRUCTIONS =
  ' 每次写中文 name 都同时写 name_en：英文版游戏里显示的名字，简短自然，像原版物品的叫法（例如 name「蓝辉矿」配 name_en "Azure Ore"），只用英文，不要拼音，不要逐字硬译。省略或写 null 时英文版游戏里显示的还是中文名，Studio 会提醒用户。'

/** What an ore vein may replace. `target` is the vanilla rule test the worldgen JSON carries. */
export const ORE_BASES = {
  stone: { name: "石头", dimension: "overworld", target: { predicate_type: "minecraft:tag_match", tag: "minecraft:stone_ore_replaceables" } },
  deepslate: { name: "深板岩", dimension: "overworld", target: { predicate_type: "minecraft:tag_match", tag: "minecraft:deepslate_ore_replaceables" } },
  netherrack: { name: "下界岩", dimension: "nether", target: { block: "minecraft:netherrack", predicate_type: "minecraft:block_match" } },
  end_stone: { name: "末地石", dimension: "end", target: { block: "minecraft:end_stone", predicate_type: "minecraft:block_match" } },
} as const
export type OreBase = keyof typeof ORE_BASES

/** The three dimensions, the heights that exist there, and the Fabric selector constant the generated Java uses. */
export const ORE_DIMENSIONS = {
  overworld: { name: "主世界", min_y: -64, max_y: 320, selector: "foundInOverworld" },
  nether: { name: "下界", min_y: 0, max_y: 255, selector: "foundInTheNether" },
  end: { name: "末地", min_y: 0, max_y: 255, selector: "foundInTheEnd" },
} as const
export type OreDimension = keyof typeof ORE_DIMENSIONS

/** Vanilla biome tags an ore may be limited to. All are overworld groups; the nether and the end are chosen by dimension. */
export const ORE_BIOME_GROUPS = {
  is_mountain: "山地",
  is_hill: "丘陵",
  is_badlands: "恶地",
  is_jungle: "丛林",
  is_forest: "森林",
  is_taiga: "针叶林",
  is_savanna: "热带草原",
  is_ocean: "海洋",
  is_deep_ocean: "深海",
  is_beach: "沙滩",
  is_river: "河流",
} as const
export type OreBiomeGroup = keyof typeof ORE_BIOME_GROUPS

// Vanilla's ore feature places almost nothing below three blocks a vein.
export const ORE_LIMITS = { vein_min: 3, vein_size: 20, veins_per_chunk: 32, drop_count: 16, experience: 20 } as const

/** Tool tiers a block may ask for, the vanilla tag that enforces each, and how a player says it. */
export const TOOL_TIERS = {
  stone: { tag: "needs_stone_tool", name: "石" },
  iron: { tag: "needs_iron_tool", name: "铁" },
  diamond: { tag: "needs_diamond_tool", name: "钻石" },
} as const
export type ToolTier = keyof typeof TOOL_TIERS

/** Vanilla block sound groups a block may borrow: the key in upper case is the `SoundType` constant. */
export const BLOCK_SOUNDS = {
  stone: "石头",
  wood: "木头",
  gravel: "沙砾",
  grass: "草地",
  metal: "金属",
  glass: "玻璃",
  wool: "羊毛",
  sand: "沙子",
  snow: "雪",
  deepslate: "深板岩",
  netherrack: "下界岩",
  nether_ore: "下界矿石",
  basalt: "玄武岩",
  soul_sand: "灵魂沙",
  bone: "骨块",
  netherite: "下界合金",
  ancient_debris: "远古残骸",
  amethyst_block: "紫水晶",
  copper: "铜",
  tuff: "凝灰岩",
  calcite: "方解石",
  dripstone_block: "滴水石",
  slime: "黏液",
  honey: "蜂蜜",
  moss_block: "苔藓",
  mud: "泥巴",
  sculk: "幽匿",
  bamboo_wood: "竹子",
  cherry_wood: "樱花木",
} as const
export type BlockSound = keyof typeof BLOCK_SOUNDS

const VOICES: Record<string, readonly [string, readonly string[]]> = {
  iron_golem: ["铁傀儡", ["hurt", "death", "step"]],
  zombie: ["僵尸", ["ambient", "hurt", "death", "step"]],
  skeleton: ["骷髅", ["ambient", "hurt", "death", "step"]],
  spider: ["蜘蛛", ["ambient", "hurt", "death", "step"]],
  creeper: ["苦力怕", ["hurt", "death"]],
  enderman: ["末影人", ["ambient", "hurt", "death"]],
  wolf: ["狼", ["ambient", "growl", "hurt", "death", "step"]],
  cat: ["猫", ["ambient", "hurt", "death"]],
  fox: ["狐狸", ["ambient", "hurt", "death"]],
  cow: ["牛", ["ambient", "hurt", "death", "step"]],
  pig: ["猪", ["ambient", "hurt", "death", "step"]],
  sheep: ["羊", ["ambient", "hurt", "death", "step"]],
  chicken: ["鸡", ["ambient", "hurt", "death", "step"]],
  bat: ["蝙蝠", ["ambient", "hurt", "death"]],
  blaze: ["烈焰人", ["ambient", "hurt", "death"]],
  ghast: ["恶魂", ["ambient", "hurt", "death"]],
  slime: ["史莱姆", ["squish", "hurt", "death"]],
  phantom: ["幻翼", ["ambient", "hurt", "death"]],
  ravager: ["劫掠兽", ["ambient", "hurt", "death", "step"]],
  warden: ["监守者", ["ambient", "hurt", "death", "step"]],
}
const VOICE_WORDS: Record<string, string> = { ambient: "叫声", hurt: "受伤", death: "死亡", step: "脚步", growl: "低吼", squish: "弹跳声" }
const OTHER_SOUNDS = {
  "entity.generic.hurt": "普通的受伤声",
  "entity.generic.death": "普通的死亡声",
  "block.amethyst_block.chime": "紫水晶叮声",
  "block.amethyst_block.hit": "紫水晶敲击声",
  "block.amethyst_block.step": "紫水晶脚步",
  "block.anvil.land": "铁砧落地",
  "block.glass.break": "玻璃碎裂",
  "block.bell.use": "钟声",
} as const

/** Vanilla sound events a creature may use, by their game id, with a plain name: 「铁傀儡受伤」「紫水晶叮声」. */
export const CREATURE_SOUNDS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(VOICES).flatMap(([animal, [name, sounds]]) => sounds.map((sound) => [`entity.${animal}.${sound}`, `${name}${VOICE_WORDS[sound]}`]))),
  ...OTHER_SOUNDS,
}
export const CREATURE_SOUND_IDS = Object.keys(CREATURE_SOUNDS) as [string, ...string[]]

/** The four moments a creature makes a sound, in the order they are shown. */
export const SOUND_MOMENTS = { ambient: "平时", hurt: "受伤时", death: "死的时候", step: "走路时" } as const
export type SoundMoment = keyof typeof SOUND_MOMENTS

/**
 * The `SoundEvents` constant of a sound id, by Mojang's names: the id without its `entity.`, `block.` or `item.` in front, in upper case, every dot an underscore.
 * The bell is the one sound here Mojang names otherwise (read with javap from the 1.21.1 jar, for every id a creature or an ability may use).
 */
const SOUND_CONSTANT_EXCEPTIONS: Readonly<Record<string, string>> = { "block.bell.use": "BELL_BLOCK" }
export const soundConstant = (id: string) => SOUND_CONSTANT_EXCEPTIONS[id] ?? id.replace(/^(entity|block|item)\./, "").toUpperCase().replaceAll(".", "_")

/** Vanilla biomes by the name a Chinese player knows them by. */
export const BIOME_NAMES: Readonly<Record<string, string>> = {
  badlands: "恶地", bamboo_jungle: "竹林", basalt_deltas: "玄武岩三角洲", beach: "沙滩", birch_forest: "桦木森林", cherry_grove: "樱花树林",
  cold_ocean: "冷水海洋", crimson_forest: "绯红森林", dark_forest: "黑森林", deep_cold_ocean: "冷水深海", deep_dark: "深暗之域",
  deep_frozen_ocean: "冰冻深海", deep_lukewarm_ocean: "温水深海", deep_ocean: "深海", desert: "沙漠", dripstone_caves: "溶洞",
  end_barrens: "末地荒地", end_highlands: "末地高地", end_midlands: "末地内陆", eroded_badlands: "风蚀恶地", flower_forest: "繁花森林",
  forest: "森林", frozen_ocean: "冻洋", frozen_peaks: "冰封山峰", frozen_river: "冻河", grove: "雪林", ice_spikes: "冰刺之地",
  jagged_peaks: "尖峭山峰", jungle: "丛林", lukewarm_ocean: "温水海洋", lush_caves: "繁茂洞穴", mangrove_swamp: "红树林沼泽", meadow: "草甸",
  mushroom_fields: "蘑菇岛", nether_wastes: "下界荒地", ocean: "海洋", old_growth_birch_forest: "原始桦木森林", old_growth_pine_taiga: "原始松木针叶林",
  old_growth_spruce_taiga: "原始云杉针叶林", plains: "平原", river: "河流", savanna: "热带草原", savanna_plateau: "热带高原",
  small_end_islands: "末地小型岛屿", snowy_beach: "积雪沙滩", snowy_plains: "雪原", snowy_slopes: "积雪山坡", snowy_taiga: "积雪针叶林",
  soul_sand_valley: "灵魂沙峡谷", sparse_jungle: "稀疏丛林", stony_peaks: "裸岩山峰", stony_shore: "石岸", sunflower_plains: "向日葵平原",
  swamp: "沼泽", taiga: "针叶林", the_end: "末地", the_void: "虚空", warm_ocean: "暖水海洋", warped_forest: "诡异森林",
  windswept_forest: "风袭森林", windswept_gravelly_hills: "风袭沙砾丘陵", windswept_hills: "风袭丘陵", windswept_savanna: "风袭热带草原",
  wooded_badlands: "疏林恶地",
}
export const biomeName = (id: string) => BIOME_NAMES[id.split(":").at(-1)!] ?? id

const TOOL_WORDS = { pickaxe: "镐", axe: "斧", shovel: "锹" } as const
type BlockTool = keyof typeof TOOL_WORDS | "none"

/**
 * Whether a block drops nothing unless it is mined with its tool (the generated `requiresCorrectToolForDrops()`).
 * As in the game itself: what it gives to pickaxes (stone, ores, metal) needs one to drop, and so does
 * anything that asks for a tool material; what it gives to axes and shovels (wood, dirt, sand) is only
 * dug faster with them and still drops by hand.
 */
export const needsTool = (block: { tool: BlockTool; tool_tier?: ToolTier | null | undefined }) => block.tool !== "none" && (block.tool === "pickaxe" || Boolean(block.tool_tier))
const BREAK_NEEDS = { pickaxe: "要用镐挖才掉东西", axe: "要用斧头砍才掉东西", shovel: "要用锹铲才掉东西" } as const
const BREAK_FASTER = { pickaxe: "用镐挖得更快，空手也能挖下来", axe: "用斧头砍得更快，空手也能挖下来", shovel: "用锹铲得更快，空手也能挖下来" } as const
const span = (min: number, max: number) => (min === max ? String(min) : `${min}–${max}`)
// A minus sign a reader cannot mistake for a dash between two numbers.
const height = (y: number) => (y < 0 ? `−${-y}` : String(y))

type GenerationFacts = { dimension: OreDimension; min_y: number; max_y: number; spread: "even" | "middle"; vein_size: number; veins_per_chunk: number; replaces: readonly OreBase[]; biomes: OreBiomeGroup | null }
type DropFacts = { item: string; min: number; max: number; fortune: boolean }

/**
 * The data-only facts of a block and a creature as plain sentences. The acceptance card and the mod guide
 * both say them with these functions, so the two can never disagree; every number in a sentence is a number
 * of the data it was given.
 */
export const dataWords = {
  /** 「在主世界 Y −16 到 48 的石头、深板岩里生成（越靠中间越多），每个区块约 8 团，每团最多 6 块」 */
  generation: (generation: GenerationFacts) =>
    `在${ORE_DIMENSIONS[generation.dimension].name} Y ${height(generation.min_y)} 到 ${height(generation.max_y)} 的${generation.replaces.map((base) => ORE_BASES[base].name).join("、")}里生成${
      generation.spread === "middle" ? "（越靠中间越多）" : ""
    }，每个区块约 ${generation.veins_per_chunk} 团，每团最多 ${generation.vein_size} 块${generation.biomes ? `；只在${ORE_BIOME_GROUPS[generation.biomes]}一类的群系里有` : ""}`,
  /** 「挖掉会掉 1–2 个「蓝晶碎片」，带时运的工具会掉得更多；用精准采集挖，掉的是它自己」 */
  drop: (drop: DropFacts, name: (identifier: string) => string) =>
    `挖掉会掉 ${span(drop.min, drop.max)} 个「${name(drop.item)}」${drop.fortune ? "，带时运的工具会掉得更多" : ""}；用精准采集挖，掉的是它自己`,
  /** 「要用镐挖才掉东西」 or 「用斧头砍得更快，空手也能挖下来」: what `needsTool` decided, said. */
  breaks: (block: { tool: BlockTool; tool_tier?: ToolTier | null | undefined }) => (block.tool === "none" ? "空手就能挖" : (needsTool(block) ? BREAK_NEEDS : BREAK_FASTER)[block.tool]),
  /** 「至少要用铁镐才挖得下来，用更差的工具挖什么都不掉」 */
  tier: (tier: ToolTier, tool: keyof typeof TOOL_WORDS) => `至少要用${TOOL_TIERS[tier].name}${TOOL_WORDS[tool]}才挖得下来，用更差的工具挖什么都不掉`,
  experience: (experience: { min: number; max: number }) => (experience.max === 0 ? "挖掉不给经验" : `挖掉会给 ${span(experience.min, experience.max)} 点经验（用精准采集挖不给）`),
  blockSound: (sound: BlockSound) => `踩上去、挖起来是${BLOCK_SOUNDS[sound]}的声音`,
  /** 「受伤时是「铁傀儡受伤」的声音」 */
  creatureSound: (moment: SoundMoment, ref: SoundRef, title: ((id: string) => string | null) | null = null) =>
    isSoundAsset(ref) ? `${SOUND_MOMENTS[moment]}放自己的声音${((found) => (found === null ? (title ? "（工程里找不到）" : "") : `「${found}」`))(title?.(ref.asset) ?? null)}` : `${SOUND_MOMENTS[moment]}是「${CREATURE_SOUNDS[ref] ?? ref}」的声音`,
  voice: (sounds: { pitch: number; volume: number }) =>
    [sounds.pitch < 0.95 ? "声音比原来低沉" : sounds.pitch > 1.05 ? "声音比原来尖细" : null, sounds.volume < 0.95 ? "比原来小声" : sounds.volume > 1.05 ? "比原来大声" : null].filter((value): value is string => value !== null).join("，"),
}

const listed = (record: Readonly<Record<string, unknown>>) => Object.keys(record).join("|")

/** For whoever writes a block document: what each data-only field means, its safe range, and one example. */
export const BLOCK_DATA_INSTRUCTIONS =
  ENGLISH_NAME_INSTRUCTIONS +
  " 以下字段都可省略或写 null，省略时方块和以前完全一样。" +
  `generation 让方块像矿石一样在世界里一团一团生成：{dimension: ${listed(ORE_DIMENSIONS)}, min_y, max_y, spread: even|middle, vein_size: ${ORE_LIMITS.vein_min}–${ORE_LIMITS.vein_size}, veins_per_chunk: 1–${ORE_LIMITS.veins_per_chunk}, replaces: [${listed(ORE_BASES)}], biomes: null|${listed(ORE_BIOME_GROUPS)}}。` +
  "min_y/max_y 是生成高度（主世界 −64 到 320，下界和末地 0 到 255）；spread=middle 表示越靠中间越多；replaces 是它替换掉的岩石，主世界只能写 stone、deepslate，下界只能写 netherrack，末地只能写 end_stone；biomes 只有主世界能用，写 null 表示整个维度都有。" +
  "常见的量：稀有矿每区块 2–6 团、每团 4–8 块，常见矿每区块 10–20 团、每团 8–16 块。只能替换这几种岩石，做不出地表的植物、湖或建筑。" +
  `tool_tier: ${listed(TOOL_TIERS)} 表示至少要用这种材质的工具才挖得下来，必须同时写 tool（不能是 none）。` +
  `drop 除了 self、none 还可以写 item，同时写 drop_item={item, min, max, fortune}：item 是本工程里一个物品或另一个方块的短标识符（不带模组前缀，必须已经存在），min/max 是 1–${ORE_LIMITS.drop_count} 个，fortune=true 时时运附魔会多掉；用精准采集挖总是掉方块自己。` +
  `experience={min, max}（0–${ORE_LIMITS.experience}）是挖掉时给的经验；掉它自己（drop=self）的方块不能给经验，否则可以反复放下再挖来刷。` +
  `sound 借用一种原版方块的声音：${listed(BLOCK_SOUNDS)}；不能带自己的音效文件。` +
  '例：一种铁镐才挖得动的矿石 {"tool":"pickaxe","tool_tier":"iron","drop":"item","drop_item":{"item":"azure_shard","min":1,"max":2,"fortune":true},"experience":{"min":2,"max":5},"sound":"deepslate","generation":{"dimension":"overworld","min_y":-16,"max_y":48,"spread":"middle","vein_size":6,"veins_per_chunk":8,"replaces":["stone","deepslate"],"biomes":null}}。' +
  "盲盒方块（lucky）不能生成、不能改掉落。"

/** The same for a creature's borrowed sounds. */
export const CREATURE_SOUND_INSTRUCTIONS = "sounds.step_interval 可选，步声最小间隔（秒，0 到 30）；0 按体型自动。省略沿用游戏按距离发声。"+
  ENGLISH_NAME_INSTRUCTIONS +
  REGISTRY_NAME_INSTRUCTIONS.creature +
  " 可选 sounds={ambient, hurt, death, step, pitch, volume} 给生物配声音，省略或写 null 时和以前一样（平时不出声，受伤和死亡是通用的声音，脚步是脚下方块的声音）。" +
  '四个时刻各写一个原版声音的 id、{"asset":"<声音资产的 UUID>"}（这个工程自己的声音，是单独的一类资产「声音」，保存生物任务时 Studio 记录依赖）或 null；pitch 0.5–2（1 是原样，越小越低沉），volume 0.2–2（1 是原样）。原版声音只能从这份清单里选：' +
  Object.entries(CREATURE_SOUNDS).map(([id, name]) => `${id}（${name}）`).join("、") +
  '。例：{"ambient":null,"hurt":"entity.iron_golem.hurt","death":"entity.iron_golem.death","step":"entity.iron_golem.step","pitch":0.8,"volume":1}。' +
  " 模型的 features 里 glow=true 的眼睛和纹路（eyes、veins）在游戏里是真的发亮：黑暗里也看得见。只对模型自带的贴图有效，另外绑定 texture 资产的生物不会发亮。"

/**
 * The one thing Studio does with a running game, said once for every text that used to say it starts none.
 * Kept as a plain sentence here, so that no word list has to import the test scene itself (`scene.ts`).
 */
export const SCENE_CHECK_WORDS = "Studio 只在打包后可以做一项「测试场」检查：不开窗口地启动游戏自己的服务器，问游戏每样东西放不放得出来；它看不到画面，也不替人试玩。"

/**
 * What the data-only features can and cannot do, said once for outside AIs, the hand-off text and the docs.
 * `done` reaches the game through data files and fixed generated code; `not_done` is what somebody might
 * expect next to each and is not there.
 */
export const DATA_CAPABILITY = {
  summary: "不用写代码就能进游戏的常见玩法：方块像矿石一样生成、方块做成几个方盒子拼的静态外形、工具等级、掉落别的物品、挖掉给经验、借用原版声音、模型发光，方块踩上去变慢、跳不高或打滑，以及八种配方和物品当工具、食物（可带状态效果、是喝的、吃完留下玻璃瓶）、燃料。都是受限的数据，由 Studio 编译成数据包 JSON 和固定的通用代码。",
  done: [
    "方块在主世界、下界或末地的岩石里成团生成（configured_feature + placed_feature，由工程目标的加载器接入群系），可以限定高度、每团大小、每区块团数和一类主世界群系。",
    "方块要求最低工具材质（原版 needs_stone/iron/diamond_tool 标签）。",
    "方块挖掉后掉本工程的一个物品或方块，带数量范围和时运加成；精准采集掉方块自己（原版矿石的战利品表写法）。",
    "方块挖掉时给经验（原版 DropExperienceBlock）。",
    "方块可以不是整块，而是几个方盒子拼成的静态外形（花盆、灯笼、讲台那样），可以转过一个角度；放下时可以朝向玩家（四个方向）；碰撞和选中框可以是这些盒子，也可以和整块一样；没画的像素是镂空的。",
    "方块借用一种原版方块的声音；生物在平时、受伤、死亡、走路四个时刻各借用一个原版声音或者放工程自己的声音（注册成 <模组 id>:<名字>，写进 sounds.json，几个文件随机挑一个），可调高低和大小。",
    "模型里 glow 的眼睛和纹路在游戏里全亮显示（GeckoLib 的发光层，贴图旁多生成一张 _glowmask 图）。",
    "方块、物品、生物各带一个英文名（name_en），英文版游戏里显示它；没写的东西英文版里显示中文名，打包时会提醒一次。",
    "打包时的机器对账和模组说明书：都不启动游戏、不用 AI。",
    ...CONNECTION_CAPABILITY.done,
    ...CREATURE_LIFE_CAPABILITY.done,
  ],
  not_done: [
    "方块只能借用原版方块的声音。生物和招式可以引用工程的声音资产；直接提交声音文档用单声道 OGG Vorbis，文件导入和 Studio 声音工具可转码。",
    "生成只能替换石头、深板岩、下界岩、末地石，做不了地表装饰、植物、湖、结构或新群系；不能按单个群系、只能按给出的几类群系限定。",
    "方块的外形是静态的：不会动（转动的风车、跟着太阳转的花盘）、不能打开（门、箱子）、没有半透明（玻璃、水）；有外形的方块也不能当矿石在世界里生成。",
    "掉落只能是本工程的一个物品或方块，不能掉原版物品、不能一次掉几种、不能按概率掉。",
    "发光只对模型自带的贴图有效；另外绑定贴图的生物、方块和物品的贴图不会发亮。",
    ...CONNECTION_CAPABILITY.not_done,
    ...CREATURE_LIFE_CAPABILITY.not_done,
    `这些都没有人在游戏里试玩过，试玩由用户自己做；${SCENE_CHECK_WORDS}`,
  ],
} as const

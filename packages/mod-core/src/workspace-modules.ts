import { z } from "zod"
import { DEFAULT_TARGET, TargetIdSchema, type TargetId } from "./target/ids"
import { kindGap } from "./platform/kind-gaps"
import { lacksWords } from "./version-lacks"
import { APPENDAGE_GUIDE } from "./combat-design-words"
import { MODEL_ART_DIRECTION, TEXTURE_ART_DIRECTION } from "@minemods/studio-ai/model-quality"
import { ANIMATION_GUIDE } from "@minemods/studio-ai/animation"
import { ASSET_STANDARDS, standardBrief } from "./acceptance"
import { GESTURE_INSTRUCTIONS, GESTURE_SUMMARY } from "./gesture-bases"
import { GAMEPLAY_USES } from "./gameplay"
import { GAMEPLAY_INSTRUCTIONS, GAMEPLAY_SUMMARY, gameplayInstructions } from "./gameplay-words"
import { CREATURE_LIFE_INSTRUCTIONS, CREATURE_LIFE_SUMMARY, CREATURE_MOTION_SUMMARY, MODEL_CLIP_INSTRUCTIONS, creatureFacets, gameplayFacets } from "./creature-life"
import type { Facet, PlayQuestion } from "./playable"
import { TRAP_GAMEPLAY_WORDS } from "./terrain"
import { BLOCK_DATA_INSTRUCTIONS, CREATURE_SOUND_INSTRUCTIONS, ENGLISH_NAME_INSTRUCTIONS } from "./data-words"
import { blockFacets, itemFacets, recipeFacets } from "./content-facets"
import { EFFECT_INSTRUCTIONS, EFFECT_SUMMARY } from "./effect"
import { MUSIC_INSTRUCTIONS, MUSIC_SUMMARY } from "./music"
import { SOUND_INSTRUCTIONS, SOUND_SUMMARY } from "./sound"
import { PARTICLE_INSTRUCTIONS, PARTICLE_SUMMARY } from "./particle"
import { BOSS_BAR_INSTRUCTIONS, BOSS_BAR_SUMMARY } from "./boss-bar"
import { FIXTURE_INSTRUCTIONS, FIXTURE_SUMMARY } from "./fixture"
import { ABILITY_ASSET_INSTRUCTIONS, ABILITY_ASSET_SUMMARY } from "./ability-asset"
import { BOOK_INSTRUCTIONS, BOOK_SUMMARY } from "./book"
import { BLOCK_FACES_INSTRUCTIONS, BLOCK_FUEL_INSTRUCTIONS, BLOCK_MOVEMENT_INSTRUCTIONS, BLOCK_SHAPE_INSTRUCTIONS, BLOCK_STANDING_SUMMARY, ITEM_NATURE_INSTRUCTIONS, RECIPE_INSTRUCTIONS } from "./content-words"

export const ModuleKindSchema = z.enum([
  "model",
  "texture",
  "animation",
  "entity",
  "block",
  "item",
  "recipe",
  "logic",
  "worldview",
  "biome",
  "dimension",
  "terrain",
  "gesture",
  "gameplay",
  "effect",
  "sound",
  "music",
  "particle",
  "bossbar",
  "fixture",
  "ability",
  "book",
])
export type ModuleKind = z.infer<typeof ModuleKindSchema>

/** Build targets the product knows about. Capability is declared per target, never globally. */
export { DEFAULT_TARGET, TargetIdSchema, type TargetId }

/** runtime = goes into the built mod on that target; design = a saved draft that the build ignores. */
export type KindCapability = "runtime" | "design"

export const ASSET_GROUPS = {
  look: { id: "look", label: "外观" },
  content: { id: "content", label: "内容" },
  play: { id: "play", label: "玩法" },
  world: { id: "world", label: "世界" },
  text: { id: "text", label: "文本" },
  project: { id: "project", label: "工程" },
} as const
export type AssetGroup = (typeof ASSET_GROUPS)[keyof typeof ASSET_GROUPS]

/**
 * How one kind points at another.
 * - id: `field` (dotted path in the document) holds the other asset's id, and that id must also be a dependency.
 * - identifier: `field` holds the other asset's identifier, bare or as `mod_id:identifier`.
 * - creature: `field` holds a creature id. A creature shares its id with its model asset, but creatures made
 *   by hand have no workspace model, so the workspace cannot insist on the link.
 * - dependency: nothing in the document; the link only exists in the asset's dependency list.
 */
export type KindReference = {
  field: string
  kinds: readonly ModuleKind[]
  required: boolean
  match: "id" | "identifier" | "creature" | "dependency"
  /** The other end is the content this asset belongs to, or leads to it: a recipe belongs to what it makes. */
  belongs?: boolean
  /** Round 10: what the reference is for, in a few plain words, so whoever plans knows when the other thing has to be made first. */
  what?: string
}

type AssetKindSource = {
  /** Name shown wherever the kind is listed. */
  label: string
  /** Full brief handed to the AI that makes this kind. */
  instructions: string
  /** One line for outside AIs: what a document of this kind holds and where it stops. */
  summary: string
  group: AssetGroup
  /** A root of the "by content" view: something the player meets in the game. */
  owner: boolean
  /** Saved as a draft even on a runtime target, because it only reaches the game once a creature uses it. */
  staged: boolean
  /**
   * An end point: the build registers it and it works in the game with nothing pointing at it (a key plays
   * a cast action, gameplay code hooks itself in). Such a kind uses other things and is never "unused".
   */
  root?: boolean
  references: readonly KindReference[]
  /**
   * Whether the one generator every target shares makes this kind into the game ("runtime") or keeps it a saved draft
   * ("design"). The same on every target: a target that cannot make a kind yet says so, with the reason, in
   * `platform/kind-gaps.ts`, and `kindCapability` reads both.
   */
  capability: KindCapability
  /** Ids of the in-game test cases that prove this kind works. None exist yet. */
  verify: readonly string[]
  /**
   * Which of the four playability questions (see `playable.ts`) a thing of this kind must answer. Absent: the
   * kind is not a thing the player meets by itself (a model, a recipe), so the standard asks it nothing.
   */
  applies?: readonly PlayQuestion[]
  /** The answers one saved document gives, read against the whole project. Typed loosely here; `playable.ts` calls it. */
  facets?: (document: never, project: never) => Facet[]
  /** Icon name in the Studio icon set. */
  glyph: "entity" | "texture" | "play" | "cube" | "item" | "recipe" | "logic" | "document" | "biome" | "dimension" | "terrain"
  /** Name of one piece of work of this kind while it is being made. */
  work_label: string
}

// Any asset may be made against the project's worldview; the link is kept as a plain dependency.
const BACKGROUND = { field: "dependencies", kinds: ["worldview"], required: false, match: "dependency" } as const satisfies KindReference

const DEFINITIONS = {
  model: {
    label: "模型",
    instructions:
      `${MODEL_ART_DIRECTION} 输出可验证的骨骼树、立方体、表面（faces 和 surface_details 自己画，或者 paint、features 让 Studio 代画）和 idle/walk/hurt 动作。只修改用户明确指定的部位，保留其余骨骼、尺寸、父子关系、贴图尺寸和动画节奏。根骨骼必须唯一，父引用必须存在，方块必须在边界内，动作关键帧按时间递增且引用已有骨骼。不得输出网格、外部贴图或无法保存的自由文本；提交前通过 ModelDesignSchema，并标明仍需构建才能进入游戏。${MODEL_CLIP_INSTRUCTIONS}${APPENDAGE_GUIDE}`,
    summary: "骨骼、立方体、表面（自己逐块画，或者用 paint、features 让 Studio 代画）和动作；提交时按验收标准检查（看得清的脸、不堆方块、部件相连、动作自然），不合格会被退回并说明要改什么。" + CREATURE_MOTION_SUMMARY,
    group: ASSET_GROUPS.look,
    owner: false,
    staged: true,
    references: [BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "entity",
    work_label: "模型",
  },
  texture: {
    label: "贴图",
    instructions:
      `${TEXTURE_ART_DIRECTION} 输出固定宽高、有限调色板和逐像素索引，颜色使用六位十六进制。只重绘用户指定区域，未指定像素保持原值；所有索引必须落在调色板内，像素数量必须等于宽高乘积。不要引用外部文件、渐变表达式或自然语言占位符。贴图可以导出为 PNG，但只有在明确绑定模型并重新构建后才算运行时资源，不能把独立设计稿冒充已接入游戏。`,
    summary: "固定宽高、调色板和逐像素索引；必须依赖对应 model 任务，并使用 claim_task 返回的 model_context.atlas_size 与每个 bone/cube 的 UV 区域，不能猜 UV；像素数量必须匹配。模型自己带着贴图，需要给它另画一张时才需要这个模块；提交时贴到模型上按验收标准检查（不能到处一个花纹、不能是噪点、要有脸），不合格会被退回。",
    group: ASSET_GROUPS.look,
    owner: false,
    staged: true,
    references: [{ field: "dependencies", kinds: ["model"], required: false, match: "dependency", belongs: true }, BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "texture",
    work_label: "贴图",
  },
  animation: {
    label: "动画",
    instructions:
      "基于依赖模型已有的骨骼名称生成单个动作，输出长度、循环标记和关键帧。每个骨骼最多一个通道，每条轨道的关键帧时间严格递增且不得超过动作长度，至少保留一个关键帧。只改变用户指定动作和骨骼，保留模型中的其他动作；不得创建不存在的骨骼，也不得使用下面没有列出的轨道或插值。" + ANIMATION_GUIDE + "独立动画资产当前只保存为设计稿，不进入构建；游戏里的动作来自模型自带的动作，不能把动画稿说成已经进入游戏。" + standardBrief(ASSET_STANDARDS.animation),
    summary: "依赖模型骨骼的单个动作关键帧；时间递增且不能超过长度。只保存为设计稿，游戏里的动作来自模型自带的动作。",
    group: ASSET_GROUPS.look,
    owner: false,
    staged: true,
    references: [{ field: "dependencies", kinds: ["model"], required: false, match: "dependency", belongs: true }, BACKGROUND],
    capability: "design",
    verify: [],
    glyph: "play",
    work_label: "动画",
  },
  entity: {
    label: "生物",
    instructions:
      "输出生物名称、属性、行为和运行时契约。model_asset_id 必须引用当前 workspace 中一个已保存模型的 UUID，每种变体使用独立模型。texture_asset_id 为 null 时使用模型内置贴图，否则必须依赖对应尺寸匹配的 texture 资产。spawn 只在所列原版群系的合适地面生成；敌对生物要求黑暗环境，不能凭此实现水中生物。movement 控制接近方式；passive 不主动接近，follow 在玩家手里拿着引诱物时接近（引诱物见下面的 tempt，没写就是小麦），hostile 追踪生存玩家。explosion 为空时 hostile 近战，否则在距离玩家三格内按引信蓄力爆炸；damage_blocks=false 保留方块且不引火。状态效果仅作用于半径内的生存玩家。不得把受限契约以外的能力描述为已经实现。 可选 runtime.death_drop={block_identifier,chance} 绑定本工程已保存且启用lucky的方块；entity必须依赖该block资产。仅玩家造成的非爆炸死亡额外概率掉落1盒，尊重doMobLoot；原有掉落保留。省略或null不新增掉落。" + CREATURE_LIFE_INSTRUCTIONS + CREATURE_SOUND_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.entity),
    summary: "生物实体属性和运行时生成、爆炸、移动、护甲与材质绑定；必须依赖每个变体自己的 model，texture_asset_id 非空时还必须依赖对应 texture。可选 sounds 借用清单里的原版声音，或者写 {asset: 声音资产的 UUID} 放工程自己的声音（sound 资产，同时要依赖它）。" + CREATURE_LIFE_SUMMARY,
    group: ASSET_GROUPS.content,
    applies: ["source", "use", "reaction", "idle"],
    facets: creatureFacets,
    owner: true,
    staged: false,
    references: [
      { field: "model_asset_id", kinds: ["model"], required: true, match: "id" },
      { field: "runtime.texture_asset_id", kinds: ["texture"], required: false, match: "id" },
      { field: "runtime.death_drop.block_identifier", kinds: ["block"], required: false, match: "identifier" },
      // Round 10 (J1): what it drops when defeated (loot[].item). Without this row a plan could not say a creature needs the item it
      // drops, so the item was made first only by luck; every reference a document can carry belongs in this table.
      { field: "loot.item", kinds: ["item", "block"], required: false, match: "identifier", what: "它被打败时掉落的本工程物品或方块" },
      // H3: the effects its abilities show (abilities[].events[].effect). Each is kept as a dependency; `workspace.ts` holds the two equal.
      // Boss 能力 11: and the particles of its own they show (abilities[].events[].particle.asset), kept the same way.
      { field: "abilities", kinds: ["effect", "particle"], required: false, match: "dependency", what: "它的招式放出的效果和粒子" },
      // 任务二 §9: the sounds of its own it plays (sounds.* and abilities[].events[].sound as { asset }). Each is kept as a dependency; `workspace.ts` holds the two equal.
      { field: "boss.music.asset", kinds: ["music"], required: false, match: "dependency", what: "这只 Boss 的战斗音乐" },
      { field: "sounds", kinds: ["sound"], required: false, match: "dependency", what: "它叫、受伤、死、走路和招式里放的自己的声音" },
      // Boss 能力 6: the bar a boss shows instead of the game's (boss.bar.look.asset); kept as a dependency like any id it names.
      { field: "boss.bar.look.asset", kinds: ["bossbar"], required: false, match: "id", what: "它当 Boss 时屏幕上方的血条" },
      // Boss 能力 12: the fixtures its arena puts down (boss.arena.fixtures[].look.asset). Each is kept as a dependency; `workspace.ts` holds the two equal.
      { field: "boss.arena", kinds: ["fixture"], required: false, match: "dependency", what: "它当 Boss 时场地上摆的物件" },
      // 技能资产: the ability assets it uses as its own abilities (shared_abilities[].asset). Each is kept as a dependency; `workspace.ts` holds the two equal.
      { field: "shared_abilities", kinds: ["ability"], required: false, match: "dependency", what: "它当自己招式用的技能" },
      BACKGROUND,
    ],
    capability: "runtime",
    verify: [],
    glyph: "entity",
    work_label: "生物规则",
  },
  block: {
    label: "方块",
    instructions:
      "输出可编译的方块名称、短标识符、硬度、亮度、工具、掉落和颜色。标识符只能使用小写字母、数字和下划线，名称必须可显示，硬度和亮度必须在游戏边界内。只更新用户要求的字段，保留已有 ID 由应用分配，不接受模型或用户伪造的身份字段。纹理引用必须是可验证的本地数据；提交后通过 validateContent，明确区分已保存设计与已构建资源。 可选 lucky={max_stack,outcomes:[{weight,items:[{item,min,max}],effects:[{effect,duration_ticks,amplifier}]}]} 定义可放置盲盒，权重合计100且每项非空；奖励物品仅schema白名单。主手右键单次消耗，仅服务端开奖，冒险/旁观禁止、创造免疫惩罚。普通挖掘不开奖。省略或null保留普通方块行为。" + BLOCK_DATA_INSTRUCTIONS + BLOCK_FUEL_INSTRUCTIONS + BLOCK_MOVEMENT_INSTRUCTIONS + BLOCK_FACES_INSTRUCTIONS + BLOCK_SHAPE_INSTRUCTIONS + TRAP_GAMEPLAY_WORDS + standardBrief(ASSET_STANDARDS.block),
    summary: `可编译方块字段；标识符、数值、纹理和内容引用由 schema/Studio 校验。可选：像矿石一样在世界里生成（generation）、最低工具材质（tool_tier）、掉落本工程的物品（drop=item + drop_item）、挖掉给经验（experience）、借用原版方块的声音（sound）、当熔炉燃料（fuel）、${BLOCK_STANDING_SUMMARY}、几张贴图让游戏随机换着用来打破墙上的重复（variants、random_mirror、random_turn）、不是整块而是几个方盒子拼成的静态外形、放下时朝向玩家（shape）。`,
    group: ASSET_GROUPS.content,
    applies: ["source", "use", "reaction"],
    owner: true,
    staged: false,
    references: [{ field: "drop_item.item", kinds: ["item", "block"], required: false, match: "identifier", what: "挖掉它掉落的本工程物品或方块" }, BACKGROUND],
    facets: blockFacets,
    capability: "runtime",
    verify: [],
    glyph: "cube",
    work_label: "方块",
  },
  item: {
    label: "物品",
    instructions:
      "输出可编译的物品名称、短标识符、最大堆叠数和颜色，必要时附带受控的 PNG 数据。标识符只能使用小写字母、数字和下划线，堆叠数为 1 到 64；ID 始终由应用分配，模型不得覆盖或猜测。只修改用户点名的物品，保留其他字段和引用。保存前检查同工程标识符冲突，完成构建后才显示为可进入模组的物品。可选 model_asset_id 引用本工程 ready 的静态 model 资产并加入 dependencies，不创建生物。此轮只支持无旋转骨骼且所有动画轨道恒等的立方体模型；导出坐标必须在 -16 到 32 内。可选 display 保存 firstperson_righthand、firstperson_lefthand、thirdperson_righthand、thirdperson_lefthand 的 translation/rotation/scale，左右手独立。" + ENGLISH_NAME_INSTRUCTIONS + ITEM_NATURE_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.item),
    summary: "可编译物品字段；堆叠数与标识符遵守 schema。默认是普通物品；可选：真正的工具或武器（tool：镐、斧、锹、锄、剑）、食物（food，可以带状态效果 effects、是喝的 drink、吃完留下玻璃瓶或碗 leaves）、熔炉燃料（fuel）、盔甲（armor：头盔、胸甲、护腿、靴子，护甲值、韧性、抗打退，穿上是原版几种盔甲的样子）。弓弩、盾牌和右键有效果的物品不在这里，要用 gameplay。",
    group: ASSET_GROUPS.content,
    applies: ["source", "use"],
    owner: true,
    staged: false,
    references: [{ field: "model_asset_id", kinds: ["model"], required: false, match: "id", what: "手里显示的静态物品模型" }, { field: "tool.repair", kinds: ["item", "block"], required: false, match: "identifier", what: "修它用的本工程材料" }, BACKGROUND],
    facets: itemFacets,
    capability: "runtime",
    verify: [],
    glyph: "item",
    work_label: "物品",
  },
  recipe: {
    label: "配方",
    instructions:
      "输出九宫格材料、产物和数量，并确保每个非空引用指向原版或当前工程已存在的方块/物品。至少需要一种材料，空位必须明确保留，产物只能是有效命名空间 ID，数量为 1 到 64。只重排用户要求的格子和产物，保留空位与旧输入；ID 由应用分配。无法解析的材料必须返回待确认状态，不能静默替换成原版物品。" + RECIPE_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.recipe),
    summary: "九格材料、产物和数量；type 选配方种类：有形合成（默认）、无形合成、熔炉、高炉、烟熏炉、营火、切石机、锻造台升级。材料可以是本工程的东西、原版物品或 # 开头的物品标签，都会核对。",
    group: ASSET_GROUPS.play,
    owner: false,
    staged: false,
    references: [
      { field: "pattern", kinds: ["block", "item"], required: false, match: "identifier" },
      { field: "result", kinds: ["block", "item"], required: false, match: "identifier", belongs: true },
      BACKGROUND,
    ],
    facets: recipeFacets,
    capability: "runtime",
    verify: [],
    glyph: "recipe",
    work_label: "配方",
  },
  logic: {
    label: "逻辑",
    instructions:
      "输出实体 ID、触发条件、动作和必要的物品或动画引用。实体必须存在；holding_item 必须有有效物品，play_animation 必须有动作名称，其他触发不得携带多余字段。只改变用户指定规则，保留启用状态与未涉及规则；ID 由应用分配。保存前通过 validateContent 严查实体、物品和动作引用，设计规则只有在构建产物验证后才可称为运行时行为。" + standardBrief(ASSET_STANDARDS.logic),
    summary: "实体触发条件、动作和有效物品/动画引用。",
    group: ASSET_GROUPS.play,
    owner: false,
    staged: false,
    references: [
      { field: "entity_id", kinds: ["model"], required: true, match: "creature", belongs: true },
      { field: "item", kinds: ["block", "item"], required: false, match: "identifier" },
      BACKGROUND,
    ],
    capability: "runtime",
    verify: [],
    glyph: "logic",
    work_label: "玩法",
  },
  worldview: {
    label: "世界观",
    instructions:
      "把自然语言整理成标题、摘要和有顺序的设定条目，每条包含明确标题与正文，便于检索、关联和后续内容制作。保留用户原意、专有名词和未决问题，不捏造游戏已经支持的系统，不把设计条目写入方块、实体或维度运行时代码。修改只作用于用户选中的条目，保存状态必须标识为设计稿，并保留来源提示词。",
    summary: "标题、摘要和有序设定条目；只整理设计意图，不写运行时代码。",
    group: ASSET_GROUPS.text,
    owner: false,
    staged: false,
    references: [],
    capability: "design",
    verify: [],
    glyph: "document",
    work_label: "世界观",
  },
  biome: {
    label: "群系",
    instructions:
      "输出稳定标识符、名称、描述、温度、降雨和天空/雾/水颜色，所有数值在 schema 范围内。保留用户未指定的气候与视觉设定，不擅自增加生物生成、结构或掉落等未实现能力。标识符由应用检查冲突，ID 由应用分配；当前结果只用于可视化和设计审阅，除非另有真实构建器，否则不能宣称已经注册到 Minecraft。",
    summary: "标识符、气候和颜色；不伪造生成、结构或掉落能力。",
    group: ASSET_GROUPS.world,
    owner: false,
    staged: false,
    references: [BACKGROUND],
    capability: "design",
    verify: [],
    glyph: "biome",
    work_label: "群系",
  },
  dimension: {
    label: "维度",
    instructions:
      "输出维度标识符、名称、描述、天空类型、天花板标记和环境光，保证可视化字段完整且在范围内。只处理用户描述的空间规则，保留未决入口，不伪造传送、生成、地形或服务器行为。结果属于设计资产，必须清楚显示等待运行时实现；标识符冲突和引用关系由应用拒绝，不能用自由文本绕过 schema。",
    summary: "空间规则、天空类型、天花板和环境光；不伪造传送或生成行为。",
    group: ASSET_GROUPS.world,
    owner: false,
    staged: false,
    references: [BACKGROUND],
    capability: "design",
    verify: [],
    glyph: "dimension",
    work_label: "维度",
  },
  terrain: {
    label: "地形",
    instructions:
      "输出有序地层、材料和深度，以及可视化特征列表。每层材料必须有名称，深度为受限正整数，特征保持短而可检索；保留用户指定顺序和未完成标记，不把材料文字误当成已注册方块。该资产只描述世界生成意图，当前不进入 Fabric 构建器；应用应显示设计能力边界并保留提示词、依赖和版本。",
    summary: "有序地层和特征列表；材料文字不等于已注册方块。",
    group: ASSET_GROUPS.world,
    owner: false,
    staged: false,
    references: [BACKGROUND],
    capability: "design",
    verify: [],
    glyph: "terrain",
    work_label: "地形",
  },
  gesture: {
    label: "施法动作",
    instructions: GESTURE_INSTRUCTIONS,
    summary: GESTURE_SUMMARY,
    group: ASSET_GROUPS.look,
    owner: false,
    staged: false,
    root: true,
    references: [BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "play",
    work_label: "施法动作",
  },
  // Behaviour an AI writes as Java, kept in its own package. What it attaches to is listed in the document (`uses`) and kept as dependencies.
  gameplay: {
    label: "玩法",
    instructions: GAMEPLAY_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.gameplay),
    summary: GAMEPLAY_SUMMARY,
    group: ASSET_GROUPS.play,
    // Ready for the standard: which questions a gameplay is asked (`applies`) is the standard's to say.
    facets: gameplayFacets,
    owner: false,
    staged: false,
    root: true,
    references: [{ field: "uses", kinds: GAMEPLAY_USES, required: false, match: "dependency" }, BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "logic",
    work_label: "玩法代码",
  },
  // H3: something that appears in the world for a moment: a small model and how it lives. Shown by a creature's abilities or by gameplay code.
  effect: {
    label: "效果",
    instructions: EFFECT_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.effect),
    summary: EFFECT_SUMMARY,
    group: ASSET_GROUPS.look,
    owner: false,
    // Every saved effect is compiled into the mod; it shows once an ability or gameplay code names it.
    staged: false,
    references: [BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "play",
    work_label: "效果",
  },
  // 任务二 §9: the project's own audio, registered as <mod id>:<name>. Played by a creature's sounds or its abilities' sound events.
  sound: {
    label: "声音",
    instructions: SOUND_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.sound),
    summary: SOUND_SUMMARY,
    group: ASSET_GROUPS.look,
    owner: false,
    // Every saved sound is registered and written into sounds.json; it is heard once a creature or an ability names it.
    staged: false,
    references: [BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "play",
    work_label: "声音",
  },
  // Boss 能力 11: the mod's own particle: a few small pictures and how one of them lives. Shown by an ability's particle event that names it.
  music: {
    label: "音乐", instructions: MUSIC_INSTRUCTIONS, summary: MUSIC_SUMMARY, group: ASSET_GROUPS.look,
    owner: false, staged: true, references: [BACKGROUND], capability: "runtime", verify: [], glyph: "play", work_label: "音乐",
  },
  particle: {
    label: "粒子",
    instructions: PARTICLE_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.particle),
    summary: PARTICLE_SUMMARY,
    group: ASSET_GROUPS.look,
    owner: false,
    // Every saved particle is built into the mod (its pictures, its description and its row of the particle table); it shows once an ability names it.
    staged: false,
    references: [BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "texture",
    work_label: "粒子",
  },
  // Boss 能力 6: a boss's own bar at the top of the screen. It reaches the mod only once a boss names it (`boss.bar.look`), as a texture does once a creature wears it.
  bossbar: {
    label: "血条",
    instructions: BOSS_BAR_INSTRUCTIONS,
    summary: BOSS_BAR_SUMMARY,
    group: ASSET_GROUPS.look,
    owner: false,
    staged: true,
    references: [BACKGROUND],
    // Drawn in place of the game's bar on every target: Fabric by its own mixin, Forge and NeoForge through the facade's boss bar event (fabric/boss-bar.ts).
    capability: "runtime",
    verify: [],
    glyph: "texture",
    work_label: "血条",
  },
  // Boss 能力 12: a small model on the ground of a boss's arena, lit by a player. It reaches the mod only once a boss's arena puts it down (`boss.arena.fixtures[].look`).
  fixture: {
    label: "场地物件",
    instructions: FIXTURE_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.fixture),
    summary: FIXTURE_SUMMARY,
    group: ASSET_GROUPS.look,
    owner: false,
    staged: true,
    references: [BACKGROUND],
    // Put down, lit and drawn on every target: one entity of the mod's own registered as each loader registers one (fabric/arena.ts).
    capability: "runtime",
    verify: [],
    glyph: "cube",
    work_label: "场地物件",
  },
  // 技能资产: an ability any caster can use, bound to the items, blocks and cast actions it lists and used by the creatures that name it (`ability-asset.ts`).
  ability: {
    label: "技能",
    instructions: ABILITY_ASSET_INSTRUCTIONS,
    summary: ABILITY_ASSET_SUMMARY,
    group: ASSET_GROUPS.play,
    owner: false,
    // Built once it is bound to something or a creature uses it (`builtWorkspaceAssets`); a bare one waits as a draft.
    staged: true,
    // An end point: an item, a block or a key casts it with nothing else pointing at it.
    root: true,
    references: [
      { field: "bindings.item", kinds: ["item"], required: false, match: "identifier", what: "右键或按住它就放这个技能的本工程物品" },
      { field: "bindings.block", kinds: ["block"], required: false, match: "identifier", what: "玩家右键它就由它放这个技能的本工程方块" },
      { field: "bindings.gesture", kinds: ["gesture"], required: false, match: "id", what: "按它的键就放这个技能的施法动作" },
      { field: "gesture", kinds: ["gesture"], required: false, match: "id", what: "玩家放这个技能时身上播的施法动作" },
      { field: "events", kinds: ["effect", "sound"], required: false, match: "dependency", what: "它放出的效果和自己的声音" },
      BACKGROUND,
    ],
    // Cast on every target through the facade (fabric/ability-cast.ts).
    capability: "runtime",
    verify: [],
    glyph: "play",
    work_label: "技能",
  },
  // 书: a book the player is given on first joining a world, read on a page screen of the mod's own. Every saved book is built into the mod (`common/book.ts`).
  book: {
    label: "书",
    instructions: BOOK_INSTRUCTIONS + standardBrief(ASSET_STANDARDS.book),
    summary: BOOK_SUMMARY,
    group: ASSET_GROUPS.text,
    // Something the player holds and reads by itself.
    owner: true,
    staged: false,
    // An end point: nothing has to point at it for it to reach the game.
    root: true,
    references: [{ field: "pages", kinds: ["texture"], required: false, match: "dependency", what: "书页上的横幅图" }, BACKGROUND],
    capability: "runtime",
    verify: [],
    glyph: "document",
    work_label: "书",
  },
} as const satisfies Record<ModuleKind, AssetKindSource>

/** Said beside a kind whose capability is "design": nothing of it is built into the mod. */
export const DESIGN_ONLY_WORDS = "这一类现在只是设计稿，不会做进游戏"

/**
 * `capability` "design" is the one flag for a kind no build compiles; `design_note` is the sentence a
 * person is shown for it, null for a kind that is built.
 */
export type AssetKindDefinition = AssetKindSource & { id: ModuleKind; capability: KindCapability; design_note: string | null }

/**
 * The single definition of every asset kind. Prompts, validation, capabilities, the hand-off text and
 * the UI all read from here. `capability` and `design_note` are the kind's own, before any target's gap
 * (`platform/kind-gaps.ts`); whatever depends on a project asks `kindCapability` with the project's target.
 */
export const MODULES = Object.fromEntries(
  ModuleKindSchema.options.map((id) => [id, { ...DEFINITIONS[id], id, design_note: DEFINITIONS[id].capability === "design" ? DESIGN_ONLY_WORDS : null }]),
) as { [Kind in ModuleKind]: (typeof DEFINITIONS)[Kind] & { id: Kind; design_note: string | null } }

export const ASSET_KINDS: readonly AssetKindDefinition[] = ModuleKindSchema.options.map((id) => MODULES[id])

export function assetKind(kind: ModuleKind): AssetKindDefinition {
  return MODULES[kind]
}

/** The sentence for a kind that builds nothing for this target; null for one that is built. */
export function designNote(kind: ModuleKind, target: TargetId) {
  return kindCapability(kind, target) === "design" ? MODULES[kind].design_note ?? DESIGN_ONLY_WORDS : null
}

/** What an AI making a thing of this kind is told, with the facts of the project's target (only gameplay's words name them). */
export function kindInstructions(kind: ModuleKind, target: TargetId): string {
  if (kind === "gameplay") return gameplayInstructions(target) + standardBrief(ASSET_STANDARDS.gameplay)
  // A creature's abilities and its boss's show may name vanilla particles and sounds: the ones the target's game lacks are named (and refused when handed in).
  if (kind === "entity") return MODULES.entity.instructions + lacksWords(target)
  return MODULES[kind].instructions
}

/**
 * Whether a kind is made into the game on this target: the kind's own capability, unless the target has a gap for it
 * (`platform/kind-gaps.ts`, with the reason). The target is always the project's: there is no default, so no caller
 * answers for a target it did not mean.
 */
export function kindCapability(kind: ModuleKind, target: TargetId): KindCapability {
  return kindGap(kind, target) ? "design" : DEFINITIONS[kind].capability
}

/** A freshly saved asset is "ready" only when the build picks it up without a further binding step. */
export function savedStatus(kind: ModuleKind, target: TargetId) {
  return kindCapability(kind, target) === "runtime" && !DEFINITIONS[kind].staged ? ("ready" as const) : ("design" as const)
}

/**
 * The names of the kinds with this capability on the project's target. Given several targets (a text for no project in
 * particular, or a project made for more than one): "design" is a kind that is a draft on any of them, "runtime" one
 * made into the game on all of them, so nothing is promised for a target that cannot keep it.
 */
export function kindLabels(capability: KindCapability, targets: TargetId | readonly TargetId[]) {
  const list: readonly TargetId[] = typeof targets === "string" ? [targets] : targets
  const has = (kind: ModuleKind) =>
    capability === "design" ? list.some((target) => kindCapability(kind, target) === "design") : list.every((target) => kindCapability(kind, target) === "runtime")
  return ASSET_KINDS.filter((kind) => has(kind.id)).map((kind) => kind.label)
}

/** A kind's capability on every target Studio knows: what a list read by an outside AI shows beside each kind. */
export function kindTargets(kind: ModuleKind): Record<TargetId, KindCapability> {
  return Object.fromEntries(TargetIdSchema.options.map((target) => [target, kindCapability(kind, target)])) as Record<TargetId, KindCapability>
}

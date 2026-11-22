import { kindLabel } from "../words"
/**
 * 「自己改」: what every hand-editable field is called and what it does in the game, in a player's words, with
 * the game's own numbers beside it for scale. The form is laid out from a kind's schema (`HAND_SHAPES`) and
 * from this list: a field's kind of control, its range and its choices come from the schema; its name, its
 * one-line explanation and the names of its choices come from here, the choices from mod-core's vocabularies
 * wherever one exists. Vanilla numbers quoted are Minecraft 1.21.1's.
 * No Node APIs.
 */
import { STEADY_PRESETS } from "@minemods/mod-core/creature-steady"
import { isSoundAsset, type SoundRef } from "@minemods/mod-core/sound"
import { ARMOR_LOOKS, ARMOR_SLOTS, FOOD_EFFECTS, FOOD_EFFECT_LIMITS, FOOD_LEAVES, ITEM_RARITIES, MINING_LEVELS, MOVEMENT_LIMITS, MOVEMENT_PLAIN, RECIPE_KINDS, TOOL_KINDS, cookingTime, type RecipeKind } from "@minemods/mod-core/content-words"
import { BIOME_NAMES, BLOCK_SOUNDS, CREATURE_SOUNDS, ORE_BASES, ORE_BIOME_GROUPS, ORE_DIMENSIONS, SOUND_MOMENTS, TOOL_TIERS } from "@minemods/mod-core/data-words"
import { ENGAGEMENT_WORDS } from "@minemods/mod-core/creature-life"
import { MODULES } from "@minemods/mod-core/workspace-modules"
import { bookName, creatureName } from "@minemods/mod-core/registry-name"
import { BOOK_DEFAULT_COLOR, BOOK_FRAME_CLEAR, BOOK_INK, BOOK_LIMITS, BOOK_LOOK_SLOTS, marginCapacity } from "@minemods/mod-core/book"
import type { HandKind } from "../../main/content-service"

export const HAND_KINDS: readonly HandKind[] = ["block", "item", "recipe", "entity", "particle", "ability", "book"]
export const isHandKind = (kind: string): kind is HandKind => (HAND_KINDS as readonly string[]).includes(kind)
/** The kinds a person can start from an empty form. A creature stands on a model, which no form makes. */
export const BLANK_KINDS: readonly HandKind[] = ["block", "item", "recipe", "book"]
/**
 * What a person can make with no AI connected, said once for every screen that mentions it. It names the kinds
 * above, so the sentence cannot fall behind them: the home page once said only a creature's model and motion
 * could be made by hand, after blocks, items and recipes had got their empty forms.
 */
export const NO_AI_WORDS = `不连接也能自己做：${BLANK_KINDS.map((kind) => kindLabel(kind, MODULES[kind].label)).join("、").replace(/、([^、]*)$/, "和$1")}可以填表做出来，${MODULES.entity.label}的模型和动作可以手动做。`

export type Loose = Record<string, unknown>
/**
 * One field of the form. `path` is where it is in the document (`*` for every entry of a list).
 * `as` picks a control the schema alone cannot tell: a long text, a colour, the picture, the crafting grid, or
 * a thing chosen by name (`ingredient`: anything a recipe takes; `result`: one definite thing; `own`: a thing
 * of this mod by its short name; `loot`: a thing of this mod or a vanilla item, the way a creature's drops write it;
 * `texture`: one of the project's texture assets, by its id).
 * `none` is what a field that may be left out says when it is; `fresh` is what it starts with when switched on.
 * `when` hides a field that means nothing as the document stands; `options` narrows a choice the same way.
 * `advanced`: a modder's term, shown only with 高级 on.
 */
export type Word = {
  path: string
  label: string
  help: string
  advanced?: true
  as?: "long" | "color" | "picture" | "grid" | "builtin" | "stagger" | "ingredient" | "result" | "own" | "loot" | "texture"
  choices?: Readonly<Record<string, string>>
  names?: (document: Loose) => Readonly<Record<string, string>>
  keepEmpty?: boolean
  options?: (document: Loose) => readonly string[]
  none?: string
  fresh?: () => unknown
  when?: (document: Loose) => boolean
  /** One more sentence under the explanation that depends on the document (and the id of the asset it is, null before it is first saved). */
  note?: (document: Loose, id: string | null) => string
}
export type Section = { title: string; fields: Word[] }

/** The value at a dotted path, or undefined when anything on the way is missing. */
export const at = (document: unknown, path: string) => path.split(".").reduce<unknown>((value, key) => (typeof value === "object" && value !== null ? (value as Loose)[key] : undefined), document)

const namedRows = (value: unknown, key = "id") => Array.isArray(value)
  ? Object.fromEntries(value.flatMap(row => typeof row?.[key] === "string" ? [[row[key], row.name ?? row[key]]] : [])) as Record<string, string>
  : {}
const poseNames = (document: Loose) => namedRows(at(document, "stances.list"))
const moveNames = (document: Loose) => ({ ...namedRows(document.abilities), ...namedRows(document.shared_abilities), ...namedRows(document.combos) })
const partNames = (document: Loose) => namedRows(at(document.hitbox, "parts"), "name")

const names = <Key extends string>(record: Readonly<Record<Key, { name: string }>>) => Object.fromEntries(Object.entries<{ name: string }>(record).map(([key, value]) => [key, value.name])) as Record<Key, string>
const kindOf = (document: Loose) => (document.type ?? "shaped") as RecipeKind
const cooks = (document: Loose) => cookingTime(kindOf(document)) !== null
const seconds = (ticks: number) => `${Number((ticks / 20).toFixed(1))} 秒`

// Said for every kind the same way.
const NAME: Word = { path: "name", label: "名字", help: "游戏里显示的名字。" }
const NAME_EN: Word = { path: "name_en", label: "英文名", help: "英文版游戏里显示的名字，例如 Azure Ore。不写的话，英文版里显示的也是中文名。", none: "不写" }
const IDENTIFIER: Word = { path: "identifier", label: "标识符", help: "游戏内部认它用的英文短名（注册名）：小写字母开头，只用小写字母、数字和下划线。改了它，用它的配方和掉落都要跟着改，旧存档里的它也会消失。", advanced: true }
// r29b: a creature's or a book's registry name, said with the one it goes by now (`registry-name.ts`).
const registryWord = (thing: "生物" | "书", fallback: (document: Loose, id: string | null) => string | null): Word => ({
  path: "identifier",
  label: "注册名",
  help: `游戏认它用的英文短名（/summon、/give 和语言文件里写的就是它），不带模组前缀：小写字母开头，只用小写字母、数字和下划线，比如 ${thing === "生物" ? "xingtian" : "canjuan"}。不写就用 Studio 自动起的名字。打过包以后再改，已有世界里旧名字的${thing === "生物" ? "这个生物" : "这本书"}会消失。`,
  none: "自动起名",
  note: (document, id) => ((name) => (name ? `现在用的是 ${name}。` : "第一次保存以后才有自动起的名字。"))(typeof document.identifier === "string" && document.identifier ? document.identifier : fallback(document, id)),
})
const COLOR: Word = { path: "color", label: "底色", help: "还没有图案的时候，它就是这个颜色的一块。", as: "color" }
const PICTURE: Word = { path: "texture", label: "图案", help: "它在游戏里的样子：一张 16×16 的小图。可以换成你自己画的。", as: "picture" }
const FUEL: Word[] = [
  { path: "fuel", label: "能当燃料", help: "放进熔炉下面那一格能烧。", none: "不能烧", fresh: () => ({ burn_ticks: 300 }) },
  { path: "fuel.burn_ticks", label: "能烧多久", help: "单位是刻，20 刻是 1 秒；熔炉烧好一个东西要 200 刻。原版：木棍 100，木板 300，煤炭 1600。" },
]

/** How a recipe kind reads to a player: the station, and for the two workbench kinds whether position counts. */
export const recipeKindName = (kind: RecipeKind) => `${RECIPE_KINDS[kind].station}${RECIPE_KINDS[kind].slots === "grid" ? "（按位置摆）" : RECIPE_KINDS[kind].slots === "any" ? "（怎么摆都行）" : ""}`

// A creature's natural spawning groups biomes by the same tags ore generation does, and by the three whole dimensions.
const SPAWN_GROUPS: Readonly<Record<string, string>> = { is_overworld: "整个主世界", is_nether: "整个下界", is_end: "整个末地", ...ORE_BIOME_GROUPS }
const SOUND_HELP: Record<keyof typeof SOUND_MOMENTS, string> = {
  ambient: "平时隔一会儿自己叫一声。",
  hurt: "挨打的时候。",
  death: "被打倒的时候。",
  step: "走路的时候。不选就是脚下那种方块的脚步声。",
}

const HITBOX_PATH = "hitbox"

export const HAND_WORDS: Record<HandKind, Section[]> = {
  // 书: the cover and the two switches here; every page is written in the pages panel beside the form (`book-pages.tsx`).
  book: [
    {
      title: "封面",
      fields: [
        { path: "name", label: "书名", help: `物品的名字，也印在封面上，最多 ${BOOK_LIMITS.name} 字。` },
        { path: "name_en", label: "英文书名", help: "英文版游戏里显示的书名。不写的话，英文版里也显示中文书名。", none: "不写" },
        registryWord("书", (_document, id) => (id ? bookName({ id, document: {} }) : null)),
        { path: "author", label: "署名", help: `封面下方的一行字，比如「老猎人」，最多 ${BOOK_LIMITS.author} 字。`, none: "不署名" },
        { path: "cover_color", label: "封面颜色", help: "封面和物品图标的主色。", as: "color", none: "牛皮纸色", fresh: () => BOOK_DEFAULT_COLOR },
      ],
    },
    {
      title: "怎么给玩家",
      fields: [
        { path: "give_on_first_join", label: "第一次进世界就送一本", help: "每个玩家在每个世界只给一次；退出重进不会再给，换一个世界会再给。" },
        { path: "keep_on_death", label: "死了不掉", help: "死的时候不掉在地上，重生以后还在背包里。扔掉或烧掉的不会补。" },
      ],
    },
    {
      title: "书的外观",
      fields: [
        { path: "margin_small", label: "页边小字缩小", help: `不勾：页边小字和正文一样大，只是颜色淡，一行 ${marginCapacity().perLine} 个汉字、两行。勾上：缩成四分之三（以前的画法），一行 ${marginCapacity(true).perLine} 个汉字，但默认界面缩放下有点糊。` },
        { path: "look", label: "用自己的图和字色", help: "封面图、内页底图、边框、物品图标和三种字色。图都从工程里的贴图里选；没有合适的图，可以请人画好放进工程。不用就是纯色封面、米白纸页。", fresh: () => ({}) },
        { path: "look.cover", label: BOOK_LOOK_SLOTS.cover.label, help: `整张封面的底图，比例 302:230，建议 ${BOOK_LOOK_SLOTS.cover.size}。书名和署名印在图上，字色按图自动选深浅。`, as: "texture", none: "纯色封面" },
        { path: "look.title_in_cover", label: "封面图里画了书名", help: "勾上：书名已经画在封面图里（比如竖排的题签），游戏里不再印书名和署名。要先选一张封面图。" },
        { path: "look.paper", label: BOOK_LOOK_SLOTS.paper.label, help: `每一页的纸，纸纹、做旧、焦边都画在图里，比例 302:230，建议 ${BOOK_LOOK_SLOTS.paper.size}。字写在中间，四边留出焦边的地方。`, as: "texture", none: "米白纸页" },
        { path: "look.paper_even", label: BOOK_LOOK_SLOTS.paper_even.label, help: "第 2、4、6… 页用的另一张纸，比如书脊的阴影在另一边。不选就每页都用上面那张。", as: "texture", none: "和单数页一样" },
        { path: "look.frame", label: BOOK_LOOK_SLOTS.frame.label, help: `叠在内页上、字下面的一张边框或花边，比例 302:230，建议 ${BOOK_LOOK_SLOTS.frame.size}；中间要透出纸的地方涂成下面那个「透明的颜色」。页码在最下面正中，离下边只有 4 个界面像素，边框的下边只能画在最外 3 个像素里。`, as: "texture", none: "不加边框" },
        { path: "look.clear_color", label: "画成透明的颜色", help: `贴图本身没有透明，边框和物品图标里这个颜色的像素会画成透明。不填是品红 ${BOOK_FRAME_CLEAR}。`, as: "color", none: "品红", fresh: () => BOOK_FRAME_CLEAR },
        { path: "look.body_color", label: "正文颜色", help: "和底图太接近看不清时，检查会提醒并给出建议颜色。", as: "color", none: "深棕", fresh: () => BOOK_INK.body },
        { path: "look.title_color", label: "页标题颜色", help: "每页第一行的标题。", as: "color", none: "棕色", fresh: () => BOOK_INK.title },
        { path: "look.margin_color", label: "页边小字颜色", help: "页脚那一两行，一般比正文淡一些。", as: "color", none: "淡棕", fresh: () => BOOK_INK.margin },
        { path: "look.icon", label: BOOK_LOOK_SLOTS.icon.label, help: `背包里这本书的样子，一张 ${BOOK_LOOK_SLOTS.icon.size} 的方图，背景涂成「透明的颜色」。不选就按封面颜色画一本书。`, as: "texture", none: "按封面颜色画" },
      ],
    },
  ],
  ability: [{ title: "名字和距离", fields: [NAME, { path: "english_name", label: "英文名", help: "英文版游戏里显示的名字。" }, { path: "reach", label: "寻找目标的距离", help: "玩家或方块最多在多少格内寻找目标。" }] }],
  particle:[{title:"一颗粒子的变化",fields:[
    {path:"screen_limit",label:"拉长时的屏幕占比上限",help:"可选。0.2 表示最多占画面高度的两成。"},
    {path:"edge",label:"边缘",help:"可选 soft，让贴图边缘向外渐淡。"},
    {path:"lifetime",label:"寿命",help:"从出现到消失的秒数，游戏按每秒 20 刻取整。"},
    {path:"gravity",label:"重力",help:"正数下落，负数上浮，0 为无重力。"},
    {path:"size.start",label:"出现时的大小",help:"方形贴图的边长，单位是格。"},
    {path:"size.end",label:"消失时的大小",help:"寿命结束时的边长，单位是格。"},
    {path:"color.start",label:"出现时的颜色",as:"color",help:"初始颜色乘在贴图像素上。"},
    {path:"color.end",label:"消失时的颜色",as:"color",help:"结束时的染色，白色保留原图颜色。"},
    {path:"opacity.start",label:"出现时的不透明度",help:"0 完全透明，1 完全不透明。"},
    {path:"opacity.end",label:"消失时的不透明度",help:"结束时的不透明度。"},
    {path:"emissive",label:"自己发光",help:"打开后，夜晚也按最高亮度绘制。"},
    {path:"spin",label:"旋转速度",help:"每秒转过的角度。"},
  ]}],
  block: [
    { title: "它是什么", fields: [NAME, NAME_EN, IDENTIFIER, PICTURE, COLOR] },
    {
      title: "怎么挖",
      fields: [
        { path: "hardness", label: "硬度", help: "挖它要多久，数越大越慢，0 是一碰就碎。原版：泥土 0.5，石头 1.5，铁矿石 3，黑曜石 50。" },
        { path: "tool", label: "用什么挖", help: "哪种工具挖它最快。选了镐，不用镐挖就什么都不掉，和原版的石头一样；斧和锹只是挖得更快。", choices: { pickaxe: "镐", axe: "斧", shovel: "锹", none: "空手就行" } },
        { path: "tool_tier", label: "至少什么材质", help: "比这差的工具挖它，什么都不掉。原版：铁矿石要石镐，钻石矿石要铁镐，黑曜石要钻石镐。", choices: names(TOOL_TIERS), none: "不挑材质", when: (document) => document.tool !== "none" },
        { path: "sound", label: "声音", help: "踩上去、放下和挖掉的时候，像哪一种原版方块的声音。", choices: BLOCK_SOUNDS, none: "不特别指定" },
        { path: "luminance", label: "发光", help: "0 不发光，15 最亮。原版：红石火把 7，火把 14，萤石 15。" },
      ],
    },
    {
      title: "挖掉以后",
      fields: [
        { path: "drop", label: "掉什么", help: "挖掉它，地上会留下什么。", choices: { self: "掉它自己", none: "什么都不掉", item: "掉别的东西" }, options: (document) => (document.lucky ? ["self", "none"] : ["self", "none", "item"]) },
        { path: "drop_item.item", label: "掉哪一样", help: "只能是这个模组里的物品，或者别的方块。用「精准采集」挖，掉的还是它自己。", as: "own", when: (document) => document.drop === "item" },
        { path: "drop_item.min", label: "最少掉几个", help: "原版：煤矿石掉 1 个煤炭，红石矿石掉 4–5 个红石粉。", when: (document) => document.drop === "item" },
        { path: "drop_item.max", label: "最多掉几个", help: "每次在最少和最多之间随机。", when: (document) => document.drop === "item" },
        { path: "drop_item.fortune", label: "「时运」会多掉", help: "用带「时运」附魔的工具挖，会掉得更多，和原版矿石一样。", when: (document) => document.drop === "item" },
        { path: "experience", label: "给经验", help: "挖掉的时候冒出经验球。会掉它自己的方块不能给经验：不然放下再挖就能一直刷。", none: "不给经验", fresh: () => ({ min: 1, max: 3 }), when: (document) => document.drop !== "self" },
        { path: "experience.min", label: "最少给多少", help: "原版：煤矿石 0–2，钻石矿石 3–7。" },
        { path: "experience.max", label: "最多给多少", help: "每次在最少和最多之间随机。用「精准采集」挖不给。" },
      ],
    },
    {
      title: "在世界里生成",
      fields: [
        {
          path: "generation",
          label: "像矿石一样自己生成",
          help: "新生成的地形里，会有一团一团的它埋在岩石里。只能替换岩石，做不出地表的植物、湖或者建筑。",
          none: "不生成：只能靠合成或者创造模式拿到",
          // A middling ore: the example mod-core itself gives whoever writes a block (BLOCK_DATA_INSTRUCTIONS).
          fresh: () => ({ dimension: "overworld", min_y: -16, max_y: 48, spread: "middle", vein_size: 6, veins_per_chunk: 8, replaces: ["stone", "deepslate"], biomes: null }),
          when: (document) => !document.lucky,
        },
        { path: "generation.dimension", label: "哪个世界", help: "主世界、下界还是末地。", choices: names(ORE_DIMENSIONS) },
        { path: "generation.replaces", label: "长在什么岩石里", help: "它会顶替掉这些岩石。主世界是石头和深板岩，下界是下界岩，末地是末地石。", choices: names(ORE_BASES), options: (document) => Object.entries(ORE_BASES).filter(([, base]) => base.dimension === at(document, "generation.dimension")).map(([key]) => key) },
        { path: "generation.min_y", label: "最低高度", help: "主世界从 −64 到 320，海平面是 63；下界和末地从 0 到 255。原版钻石在 −64 到 16。" },
        { path: "generation.max_y", label: "最高高度", help: "原版铁矿最多的地方在 16 上下，煤矿在 96 上下。" },
        { path: "generation.spread", label: "怎么分布", help: "在最低和最高之间怎么分。", choices: { even: "每个高度一样多", middle: "越靠中间越多" } },
        { path: "generation.veins_per_chunk", label: "每个区块几团", help: "一个区块是 16×16 格的一片地。稀有的矿 2–6 团，常见的矿 10–20 团。" },
        { path: "generation.vein_size", label: "每团最多几块", help: "稀有的矿 4–8 块，常见的矿 8–16 块；游戏会让每一团都有点不一样。" },
        { path: "generation.biomes", label: "只在哪类群系", help: "只有主世界能再限定一类群系。", choices: ORE_BIOME_GROUPS, none: "整个世界都有", when: (document) => at(document, "generation.dimension") === "overworld" },
      ],
    },
    {
      title: "站上去",
      fields: [
        { path: "bounce", label: "落下反弹", help: "0 是不弹，1 是落多高弹多高。原版：黏液块 1。", none: "不弹" },
        { path: "launch", label: "踩上去弹高", help: "弹到几格高，留空是不弹。原版：跳一下约 1.25 格。", none: "不弹" },
        // Honey block: speed 0.4, jump 0.5, an ordinary grip.
        { path: "movement", label: "改变站在上面的人", help: "踩上去变慢、跳不高、打滑，都在这里。", none: "和普通方块一样", fresh: () => ({ speed: 0.4, jump: 0.5, slip: MOVEMENT_PLAIN.slip }) },
        { path: "movement.speed", label: "走得多快", help: `1 是不变，越小越慢。原版：灵魂沙和蜂蜜块 0.4。最小 ${MOVEMENT_LIMITS.speed.min}。` },
        { path: "movement.jump", label: "跳得多高", help: `1 是不变，越小起跳越没力。原版：蜂蜜块 0.5。最小 ${MOVEMENT_LIMITS.jump.min}。` },
        { path: "movement.slip", label: "有多滑", help: `${MOVEMENT_PLAIN.slip} 是普通方块，越大越滑，站上去停不住。原版：冰 0.98，蓝冰 0.989。` },
      ],
    },
    {
      title: "别的",
      fields: [
        ...FUEL,
        { path: "random_mirror", label: "随机左右翻转", help: "一格一格铺开的时候，有的会左右翻过来，看上去不那么重复。原版的石头就是这样。" },
        { path: "random_turn", label: "随机转个方向", help: "铺开的时候顶面和底面会随机转 90 度，原版的泥土和沙子就是这样。只有顶面和底面看得出来。" },
      ],
    },
  ],
  item: [
    {
      title: "它是什么",
      fields: [NAME, NAME_EN, IDENTIFIER, PICTURE, COLOR, { path: "max_stack", label: "一格能叠几个", help: "原版大多数东西是 64，雪球和末影珍珠是 16，工具和武器是 1。", when: (document) => !document.tool }, { path: "rarity", label: "稀有度", help: "游戏里名字的颜色：普通是白色，罕见黄色，稀有青色，史诗紫色（和原版的附魔金苹果、龙蛋一样）。只改颜色，不改别的。", choices: Object.fromEntries(Object.entries(ITEM_RARITIES).map(([id, row]) => [id, `${row.label}（${row.colour}）`])), none: "普通（不指定）" }],
    },
    {
      title: "工具或武器",
      fields: [
        // An iron pickaxe: 250 uses, speed 6, 4 damage, enchantability 14.
        { path: "tool", label: "它是一件工具或武器", help: "能挖、能砍、能打，会用坏，能附上对应的附魔。工具不能叠放，也不能同时是食物。", none: "只是普通物品", fresh: () => ({ kind: "pickaxe", durability: 250, mining_level: "iron", mining_speed: 6, attack_damage: 4, attack_speed: null, enchantability: 14, repair: null }) },
        { path: "tool.kind", label: "哪一种", help: "决定它挖什么最快、拿在手里的样子和能附的附魔。", choices: names(TOOL_KINDS) },
        { path: "tool.durability", label: "能用多少次", help: "用完就坏。原版：木 59，石 131，铁 250，钻石 1561。" },
        { path: "tool.mining_level", label: "挖得动哪一档", help: "有的方块要够好的工具才挖得下来。", choices: Object.fromEntries(Object.entries(MINING_LEVELS).map(([key, level]) => [key, `${level.name}：${level.reach}`])) },
        { path: "tool.mining_speed", label: "挖得多快", help: "挖对口的方块有多快。原版：木 2，石 4，铁 6，钻石 8。剑写 1 就行。" },
        { path: "tool.attack_damage", label: "打一下多少伤害", help: "就是游戏里物品说明上写的那个数，2 点是一颗心。原版：铁镐 4，铁剑 6，钻石剑 7。" },
        { path: "tool.attack_speed", label: "一秒能打几下", help: "原版：剑 1.6，镐 1.2，斧 0.9，锹 1，锄 3。", none: "和原版同类工具一样" },
        { path: "tool.enchantability", label: "附魔能力", help: "越大，附魔台给的附魔越好；0 是不能附魔。原版：石 5，钻石 10，铁 14，金 22。" },
        { path: "tool.repair", label: "用什么修", help: "在铁砧上拿它来修。", as: "ingredient", none: "不能用材料修" },
      ],
    },
    {
      title: "盔甲",
      fields: [
        // An iron helmet: 2 armor points, 165 hits, enchantability 9.
        { path: "armor", label: "它是一件盔甲", help: "穿在身上加护甲，会被打坏，能附上对应部位的附魔。盔甲不能叠放，也不能同时是工具或食物。", none: "不是盔甲" },
        { path: "armor.slot", label: "穿在哪", help: "一件盔甲只穿在一个位置。", choices: Object.fromEntries(Object.entries(ARMOR_SLOTS).map(([key, slot]) => [key, slot.name])) },
        { path: "armor.defense", label: "加几点护甲", help: "护甲栏上的半格数。原版：铁头盔 2，铁胸甲 6，钻石头盔 3，钻石胸甲 8。" },
        { path: "armor.toughness", label: "盔甲韧性", help: "挨重击时少掉的更多。原版：钻石 2，下界合金 3，其他 0。" },
        { path: "armor.knockback_resistance", label: "击退抗性", help: "0 到 1，越大越不容易被打退。原版下界合金每件 0.1。" },
        { path: "armor.durability", label: "能挨多少下", help: "挨打会磨损，到 0 就坏。原版：铁头盔 165，铁胸甲 240，钻石头盔 363。" },
        { path: "armor.enchantability", label: "附魔能力", help: "越大，附魔台给的附魔越好；0 是不能附魔。原版：铁 9，钻石 10，金 25。" },
        { path: "armor.repair", label: "用什么修", help: "在铁砧上拿它来修。", as: "ingredient", none: "不能用材料修" },
        { path: "armor.look", label: "穿上像哪种盔甲", help: "穿在身上画成哪种原版盔甲，也用它的穿戴声音。物品栏里的图标照常是它自己的。", choices: Object.fromEntries(Object.entries(ARMOR_LOOKS).map(([key, look]) => [key, look.name])) },
      ],
    },
    {
      title: "食物",
      fields: [
        // Bread: 5 hunger, saturation 0.6.
        { path: "food", label: "它能吃", help: "拿在手里按住右键吃掉。", none: "不能吃", fresh: () => ({ hunger: 5, saturation: 0.6 }), when: (document) => !document.tool },
        { path: "food.hunger", label: "补多少饥饿", help: "2 点是一格鸡腿。原版：苹果 4，面包 5，熟牛排 8。" },
        { path: "food.saturation", label: "有多顶饱", help: "越大，吃完越久才会再饿。原版：腐肉 0.1，面包 0.6，熟牛排 0.8。" },
        { path: "food.always_edible", label: "不饿也能吃", help: "像金苹果那样，饱着也能吃。" },
        { path: "food.snack", label: "吃得很快", help: "像干海带那样，一半的时间就吃完。" },
        { path: "food.drink", label: "是喝的", help: "拿着按住右键是喝，不是咬：用喝的动作和声音，像蜂蜜瓶。" },
        { path: "food.leaves", label: "吃完剩下", help: "吃完以后手里留下的东西，放回背包。原版：蜂蜜瓶剩一个玻璃瓶，蘑菇煲剩一只碗。", choices: Object.fromEntries(Object.entries(FOOD_LEAVES).map(([key, words]) => [key, words.name])), none: "什么都不剩" },
        // Golden apple: regeneration II for 5 seconds.
        { path: "food.effects", label: "吃了得到的效果", help: `一行一个，最多 ${FOOD_EFFECT_LIMITS.count} 个。`, fresh: () => ({ effect: "regeneration", seconds: 5, level: 1, chance: 1 }) },
        { path: "food.effects.*.effect", label: "什么效果", help: "游戏里的状态。", choices: names(FOOD_EFFECTS) },
        { path: "food.effects.*.seconds", label: "持续几秒", help: "原版：金苹果的生命恢复 5 秒，伤害吸收 120 秒。瞬间治疗和饱和是一下子生效的，写 1。" },
        { path: "food.effects.*.level", label: "几级", help: "1 是 I，2 是 II。原版金苹果的生命恢复是 II。" },
        { path: "food.effects.*.chance", label: "机会", help: "1 是每次吃都有，0.3 是十次里有三次。原版：腐肉的饥饿 0.8，生鸡肉的中毒 0.3。" },
      ],
    },
    { title: "别的", fields: FUEL },
  ],
  recipe: [
    {
      title: "怎么做出来",
      fields: [
        NAME,
        { path: "type", label: "在哪里做", help: "工作台按位置摆，是剑、镐那样有形状的配方；怎么摆都行，是把几样东西放一起就成的配方。高炉只烧矿物，烟熏炉只烧食物。", choices: Object.fromEntries(Object.keys(RECIPE_KINDS).map((kind) => [kind, recipeKindName(kind as RecipeKind)])) },
        { path: "pattern", label: "材料", help: "点一个格子，再从右边挑一样东西放进去。", as: "grid" },
        { path: "result", label: "做出来的是", help: "这条配方做出来的东西。", as: "result" },
        { path: "count", label: "一次做出几个", help: "原版：一根原木出 4 块木板，6 块木板出 3 扇门。", when: (document) => !cooks(document) && kindOf(document) !== "smithing" },
        { path: "experience", label: "给多少经验", help: "每烧好一个给的经验，取出来的时候拿到。原版：铁锭 0.7，熟牛排 0.35，木炭 0.15。", none: "不给经验", when: cooks },
        { path: "cooking_time", label: "要烧多久", help: "单位是刻，20 刻是 1 秒。", none: "和原版一样", when: cooks, note: (document) => cookingWords(document) },
      ],
    },
  ],
  entity: [
    {title:"自带表现", fields:[{path:"builtin",label:"换粒子和声音",help:"按发生的位置选择工程素材、原版素材或粒子别名。选回自带表现即可恢复。",as:"builtin"}]},
    { title: "格挡和硬直", fields: [
      {path:"guard", label:"正面格挡", help:"身体面朝来击方向时减伤。命中破绽或处于硬直时跳过格挡。", none:"不格挡", fresh:()=>({arc:120,damage_scale:0.2,by:"any"}), when:d=>d.behavior==="hostile"},
      {path:"guard.arc", label:"格挡总角度",help:"身体朝向左右两边合计的角度。"},
      {path:"guard.damage_scale",label:"挡住后承受几倍伤害",help:"0 完全挡住，0.2 表示承受两成。"},
      {path:"guard.by",label:"挡哪类来击",help:"远程只算投射物。",choices:{any:"两种都挡",melee:"近战",ranged:"远程"}},
      {path:"stagger",label:"破防硬直",help:"设置停顿秒数、期间的受伤倍率和触发条件。",as:"stagger", when:d=>d.behavior==="hostile"},
    ]},
    { title: "姿态", fields: [
      { path: "stances.start", label: "开场姿态", help: "离开战斗后回到这一种。", names: poseNames },
      { path: "stances.list", label: "已有姿态", help: "可以调要待多久、伤害乘几倍和能出哪些招。切换条件和声光步骤原样保留，请让 AI 修改。", fresh: () => ({ id: "", name: "" }) },
      { path: "stances.list.*.id", label: "姿态代号", help: "其他步骤用这个代号指向它。", advanced: true },
      { path: "stances.list.*.name", label: "姿态名字", help: "例如缩壳、探头。" },
      { path: "stances.list.*.max_seconds", label: "最多待几秒", help: "到点就切到下一种。" },
      { path: "stances.list.*.then", label: "到点切到", help: "也可以在来不及出招时直接切过去。", names: poseNames, none: "不指定" },
      { path: "stances.list.*.abilities", label: "这时能出哪些招", help: "沿用阶段的名单，或只挑其中几招。用了自己的名单却一招都没选时，它会等着。", names: moveNames, keepEmpty: true },
      { path: "stances.list.*.part_scales", label: "各部位承受几倍伤害", help: "只改这里点名的部位。招式打开破绽时优先用破绽的数。", fresh: () => ({ part: "", damage_scale: 1 }) },
      { path: "stances.list.*.part_scales.*.part", label: "哪个部位", help: "从碰撞箱已有部位里选。", names: partNames },
      { path: "stances.list.*.part_scales.*.damage_scale", label: "伤害乘几倍", help: "填 0 挡住全部伤害，填 2 承受两倍伤害。" },
    ]},
    { title: "它是谁", fields: [NAME, NAME_EN, registryWord("生物", (document) => (typeof document.model_asset_id === "string" ? creatureName({ id: document.model_asset_id }) : null)), { path: "description", label: "说明", help: "写给自己和 AI 看的，游戏里不显示。", as: "long" }] },
    {
      title: "身体",
      fields: [
        { path: "health", label: "生命", help: "2 点是一颗心。原版：鸡 4，僵尸 20，铁傀儡 100。" },
        { path: "runtime.armor", label: "护甲", help: "0 是没有护甲，挨打全吃。原版：僵尸 2；玩家穿一整套铁甲是 15，钻石甲是 20。" },
        { path: "speed", label: "走多快", help: "0 是站着不动。原版：牛 0.2，僵尸 0.23，蜘蛛 0.3。" },
      ],
    },
    { title: "身体能不能挡路", fields: [
      { path: HITBOX_PATH, label: "自定身体和部位", help: "按模型大小填写身体的宽高，再给伸出去的地方加部位。", fresh: () => ({ core: { width: 1, height: 2 } }), none: "按模型大小决定" },
      { path: `${HITBOX_PATH}.blockers`, label: "只挡路的部件", help: "最多 8 个，可做围栏或底座。打中这块不会伤到生物。", fresh: () => ({ name: "新围栏", forward: 0, up: 0, left: 0, width: 1, height: 1 }) },
      { path: `${HITBOX_PATH}.blockers.*.name`, label: "挡路部件名称", help: "用一个单独的名字。" },
      { path: `${HITBOX_PATH}.blockers.*.forward`, label: "向前几格", help: "从身体中心算起，负数向后。" },
      { path: `${HITBOX_PATH}.blockers.*.left`, label: "向左几格", help: "负数向右。" },
      { path: `${HITBOX_PATH}.blockers.*.up`, label: "高出脚下几格", help: "量到部件底面。" },
      { path: `${HITBOX_PATH}.blockers.*.width`, label: "挡路部件宽几格", help: "底面是正方形。" },
      { path: `${HITBOX_PATH}.blockers.*.height`, label: "挡路部件高几格", help: "从底面向上量。" },
      { path: `${HITBOX_PATH}.core.solid`, label: "身体中心挡路", help: "玩家和生物能站在身体上，被罩住时会被推出。", none: "可以走过去" },
      { path: `${HITBOX_PATH}.core.width`, label: "身体宽几格", help: "身体正方形底面的宽度。" },
      { path: `${HITBOX_PATH}.core.height`, label: "身体高几格", help: "从脚下算起的高度。" },
      { path: `${HITBOX_PATH}.parts`, label: "身体部位", help: "逐个选哪些部位能挡路。空隙两边各加一个部位，给人留下通道。", fresh: () => ({ name: "新部位", forward: 0, up: 0, left: 0, width: 1, height: 1 }) },
      { path: `${HITBOX_PATH}.parts.*.name`, label: "部位名称", help: "给这个部位一个不同的名字，方便在图上找。" },
      { path: `${HITBOX_PATH}.parts.*.forward`, label: "向前几格", help: "负数是向后，从身体中心算起。" },
      { path: `${HITBOX_PATH}.parts.*.up`, label: "高出脚下几格", help: "量到部位底面。" },
      { path: `${HITBOX_PATH}.parts.*.left`, label: "向左几格", help: "以生物自己的左边为准，负数是向右。" },
      { path: `${HITBOX_PATH}.parts.*.width`, label: "部位宽几格", help: "部位的底面是正方形。" },
      { path: `${HITBOX_PATH}.parts.*.height`, label: "部位高几格", help: "从这个部位的底面算起。" },
      { path: `${HITBOX_PATH}.parts.*.solid`, label: "实心，能挡路", help: "玩家和生物能站在上面。部位移开时会落下。", none: "可以走过去" },
    ] },
    {
      title: "转身和盯人",
      fields: [
        { path: "steady", label: "稳重", help: "按碰撞箱高度选一套转速，可以单独调整。", none: "沿用原来的动作", fresh: () => ({ preset: "auto" }) },
        { path: "steady.preset", label: "稳重档位", help: "按体型自动选，或指定一档。", choices: { auto: "按体型", ...Object.fromEntries(Object.entries(STEADY_PRESETS).map(([id,p]) => [id,p.label])) } },
        { path: "steady.body_turn", label: "身体转多快", help: "平时每秒转 1 到 1200 度。填 0 只在出招时转，头照常看目标。" },
        { path: "steady.head", label: "头怎么转", help: "调整头的转速和偏角。", fresh: () => ({}) },
        { path: "steady.head.turn", label: "头转多快", help: "头部每秒最多转多少度。" },
        { path: "steady.head.yaw", label: "能看多偏", help: "头向左、向右各能偏多少度。" },
        { path: "steady.head.pitch", label: "能看多高", help: "头向上、向下各能偏多少度。" },
        { path: "steady.turn_after", label: "站定后何时转身", help: "目标偏开这么多度才转身，偏差降到一半就停。填 0 可连续跟转。" },
        { path: "steady.idle_look", label: "闲着看哪", help: "没有战斗目标时的张望方式。", choices: { players:"只看玩家", around:"看玩家，也四下张望", none:"不张望" } },
        { path: "steady.ability_turn", label: "蓄力转多快", help: "每秒转多少度，单个招式可以另设。", when: doc => doc.behavior === "hostile" },
        { path: "steady.focus", label: "换目标", help: "至少选一种换人的条件。", fresh: () => ({ leave:12 }), when: doc => doc.behavior === "hostile" },
        { path: "steady.focus.hold", label: "至少盯几秒", help: "这段时间内尽量盯住同一个目标。" },
        { path: "steady.focus.leave", label: "多远才换人", help: "目标走出多少格后可以换到更近的玩家。" },
        { path: "steady.focus.hurt", label: "挨多重才换人", help: "另一人在 5 秒内打掉多少比例的满血。0.1 表示一成。" },
      ],
    },
    {
      title: "脾气和打架",
      fields: [
        { path: "behavior", label: "脾气", help: "它怎么对待玩家。", choices: { passive: "温顺：不打人，被打了只会跑", follow: "跟着玩家走，不打人", hostile: "有敌意：会打玩家" } },
        { path: "engagement", label: "打谁", help: "它怎么选要打的对象。", choices: ENGAGEMENT_WORDS, none: "老样子：看见玩家就打", when: (document) => document.behavior === "hostile" },
        { path: "attack_damage", label: "打一下多少伤害", help: "2 点是一颗心。原版：僵尸 3，蜘蛛 2，铁傀儡 7–21。它有招式的话用招式打，这个数就用不上了。", when: (document) => document.behavior === "hostile" },
        { path: "runtime.movement", label: "怎么靠近", help: "朝它盯上的对象走过去的方式。", choices: { direct: "直直地走过来", stalk: "悄悄跟在后面，慢慢靠近", burst: "走走停停，突然冲一段", strafe: "绕着转圈", leap: "靠近以后扑过来", retreat: "碰一下就往后退" }, when: (document) => document.behavior !== "passive" },
        // A creeper: a second and a half of fuse, a blast of 3.
        { path: "runtime.explosion", label: "会爆炸", help: "像苦力怕那样，靠近以后闪一会儿然后炸开。会爆炸的生物不再用身体打人。", none: "不会爆炸", fresh: () => ({ fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] }), when: (document) => document.behavior === "hostile" },
        { path: "runtime.explosion.fuse_ticks", label: "引信多长", help: "单位是刻，20 刻是 1 秒。原版苦力怕是 30。" },
        { path: "runtime.explosion.radius", label: "炸多大", help: "原版：苦力怕 3，TNT 4。" },
        { path: "runtime.explosion.damage_blocks", label: "会炸坏方块", help: "关掉以后只伤人，不毁地形。" },
        { path: "runtime.charging_armor", label: "快爆炸时的护甲", help: "引信烧着的那一会儿，用这个护甲代替平时的。和平时一样就填一样的数。", when: (document) => !!at(document, "runtime.explosion") },
      ],
    },
    {
      title: "打败以后",
      fields: [
        { path: "experience", label: "给多少经验", help: "玩家打败它得到的经验。原版：牛 1–3，僵尸 5，烈焰人 10。", none: "不给经验" },
        { path: "loot", label: "掉落", help: "它被打败以后掉的东西，一行一样。", fresh: () => ({ item: "", min: 1, max: 1, chance: 1, player_only: false }) },
        { path: "loot.*.item", label: "掉什么", help: "这个模组里的物品或方块，或者一样原版物品。", as: "loot" },
        { path: "loot.*.min", label: "最少", help: "0 表示有时候一个也不掉。原版僵尸掉 0–2 个腐肉。" },
        { path: "loot.*.max", label: "最多", help: "每次在最少和最多之间随机。" },
        { path: "loot.*.chance", label: "机会", help: "1 是每次都掉，0.25 是四次里掉一次。" },
        { path: "loot.*.player_only", label: "要玩家亲手打败", help: "被别的东西弄死就不掉，原版的稀有掉落都是这样。" },
        { path: "loot.*.looting", label: "抢夺能多掉", help: "开着：拿抢夺附魔的武器打败它，每级最多多掉 1 个。不写时普通生物会多掉，Boss 不会（说掉几个就是几个）。" },
      ],
    },
    {
      title: "怎么出现",
      fields: [
        // Sheep-like: a common animal's weight, in small groups, anywhere in the overworld.
        { path: "runtime.spawn", label: "会自己出现在世界里", help: "新生成和已经有的地方都会慢慢刷出来。有敌意的生物在和平难度下不出现。", none: "没有设置自己出现的群系：只能用刷怪蛋或者指令放出来（Boss 另有巢，巢里会放一只）", fresh: () => ({ biomes: [], tags: ["is_overworld"], weight: 10, min: 1, max: 2 }) },
        { path: "runtime.spawn.tags", label: "哪一类地方", help: "按一大类群系选，可以选几类。", choices: SPAWN_GROUPS },
        { path: "runtime.spawn.biomes", label: "再单独加几个群系", help: "一个一个地挑。和上面的大类合在一起算。", choices: Object.fromEntries(Object.entries(BIOME_NAMES).map(([key, name]) => [`minecraft:${key}`, name])) },
        { path: "runtime.spawn.light", label: "要多亮", help: "原版的怪物只在暗处出现，动物在亮处。", choices: { dark: "只在暗处", bright: "只在亮处", any: "明暗都行" }, none: "按脾气来：有敌意的只在暗处，别的不挑" },
        { path: "runtime.spawn.above_sea", label: "要多高", help: "只在比海平面高这么多格以上的地面出现（海平面是 63 格高，山顶常高出 40–120 格）。", none: "不限高度", fresh: () => 60 },
        { path: "runtime.spawn.cap", label: "一处最多几只", help: "数一数刷出来的那个点附近已经有几只同样的生物，满了就不再刷。只管自己出现，刷怪蛋和指令不受限。", none: "不限数量", fresh: () => ({ count: 2, radius: 48 }) },
        { path: "runtime.spawn.cap.count", label: "最多几只", help: "这一处地方（下面写的范围里）最多同时有几只。" },
        { path: "runtime.spawn.cap.radius", label: "范围有多大", help: "以刷出来的那个点为中心的半径，单位是格，只量水平距离，天上飞的也算。范围越大越费力，最多 64 格。" },
        { path: "runtime.spawn.time", label: "按时候多刷少刷", help: "一天里哪个时候多、哪个时候少：1 是平时，0 是这时候不出现，2 是多一倍。按主世界的钟算。", none: "全天一样", fresh: () => ({ dusk: 2, night: 2 }) },
        { path: "runtime.spawn.time.dawn", label: "黎明", help: "天快亮的时候（22200–1000 刻）是平时的几倍。不写是 1。" },
        { path: "runtime.spawn.time.day", label: "白天", help: "白天（1000–12000 刻）是平时的几倍。不写是 1。" },
        { path: "runtime.spawn.time.dusk", label: "黄昏", help: "太阳落山的时候（12000–13800 刻）是平时的几倍。不写是 1。" },
        { path: "runtime.spawn.time.night", label: "夜里", help: "夜里（13800–22200 刻）是平时的几倍。不写是 1。" },
        { path: "runtime.spawn.weather", label: "按天气多刷少刷", help: "晴天、下雨、打雷各是平时的几倍：1 是平时，0 是这时候不出现。按整个世界的天气算。", none: "什么天气都一样", fresh: () => ({ rain: 2, thunder: 2 }) },
        { path: "runtime.spawn.weather.clear", label: "晴天", help: "不下雨的时候是平时的几倍。不写是 1。" },
        { path: "runtime.spawn.weather.rain", label: "下雨", help: "下雨（或下雪）、不打雷的时候是平时的几倍。不写是 1。" },
        { path: "runtime.spawn.weather.thunder", label: "打雷", help: "雷雨的时候是平时的几倍。不写是 1。" },
        { path: "runtime.spawn.weight", label: "有多常见", help: "数越大越常见，是和同一个地方别的生物比出来的。原版：僵尸 95，羊 12，末影人 10。" },
        { path: "runtime.spawn.min", label: "一次最少几只", help: "原版：羊一次 4 只，僵尸一次 4 只，末影人 1–4 只。" },
        { path: "runtime.spawn.max", label: "一次最多几只", help: "每次在最少和最多之间随机。" },
        { path: "stationary", label: "故意不走动", help: "平时生物闲着会到处走、东张西望。打开这个，它就待在原地。", none: "闲着会到处走", fresh: () => ({ reason: "它本来就该待在原地" }) },
        { path: "stationary.reason", label: "为什么不走动", help: "写给自己看的一句话，会显示在它的说明里。" },
      ],
    },
    // r29c: motions of its model kept for a behaviour still to come; the build then says them as something to look at, not to mend.
    {
      title: "留给以后的动作",
      fields: [
        { path: "later_clips", label: "留给以后的动作", help: "模型里做好了、现在还没有招式或别的东西去播的动作。写在这里，打包时只提醒“看看”，不算要改。", fresh: () => ({ clip: "", reason: "留给以后的行为" }) },
        { path: "later_clips.*.clip", label: "哪个动作", help: "照模型里的动作名写，例如 circle。" },
        { path: "later_clips.*.reason", label: "留给什么", help: "一句话，会显示在打包提醒里。" },
      ],
    },
    {
      title: "声音",
      fields: [
        { path: "sounds", label: "原版声音", help: "这里可以选原版声音。要用工程里的声音，请在「它的声音」里选。", none: "不特别指定：平时不出声，受伤和死亡是普通的声音", fresh: () => ({ ambient: null, hurt: null, death: null, step: null, pitch: 1, volume: 1 }) },
        ...Object.entries(SOUND_MOMENTS).map(([moment, label]): Word => ({ path: `sounds.${moment}`, label, help: SOUND_HELP[moment as keyof typeof SOUND_MOMENTS], choices: CREATURE_SOUNDS, none: "不特别指定", when: (document) => !isSoundAsset((document.sounds as Record<string, SoundRef> | null | undefined)?.[moment]) })),
        { path: "boss.music.starts", label: "音乐从什么时候放", help: "登场从苏醒开始；开打从登场结束、血条出现时开始。", choices: { wake: "登场", fight: "开打" }, when: doc => !!at(doc, "boss.music") },
        { path: "boss.music.fade_seconds", label: "音乐淡出（秒）", help: "脱战或玩家走远时，用 0 到 10 秒把音乐降到无声。", when: doc => !!at(doc, "boss.music") },
        { path: "sounds.step_interval", label: "步声间隔（秒）", help: "留空沿用游戏按距离发声；填 0 按体型自动，或填最多 30 秒。同一刻只响一次。" },
        { path: "sounds.pitch", label: "声音高低", help: "1 是原样，越小越低沉，越大越尖细。" },
        { path: "sounds.volume", label: "声音大小", help: "1 是原样。" },
        { path: "sounds.range_blocks", label: "四种声音默认传几格", help: "可填 8 到 128 格。留空时，通常按 16 格乘音量计算，最少约 16 格。" },
      ],
    },
  ],
}

/**
 * What a document holds that the form leaves exactly as it is: what ties it to other things, and what only an AI
 * or another editor makes (a reward pool, more pictures, abilities, a boss, collision boxes, flight and habits, how it fights between abilities).
 */
export const HAND_KEPT: Record<HandKind, readonly string[]> = {
  book: ["kind", "pages"],
  ability: ["kind", "cast", "events", "hits", "moves", "stages", "bindings", "sounds", "sound_ranges", "loop_pitch", "scaling", "gesture", "particles", "length"],
  particle:["kind","name","frames","frames_by","size.mid","color.mid","opacity.mid","face","stretch","drag","suggested_emit"],
  block: ["kind", "lucky", "variants", "shape"],
  item: ["kind", "model_asset_id", "display"],
  recipe: ["kind"],
  entity: ["sounds.ranges", "builtin", "kind", "model_asset_id", "runtime.texture_asset_id", "runtime.death_drop", "runtime.spawn.near", "runtime.garrison", "runtime.explosion.effects", "abilities", "particles", "emitters", "shared_abilities", "combos", "boss", `${HITBOX_PATH}.core.eye_height`, `${HITBOX_PATH}.core.step`, `${HITBOX_PATH}.stuck`, `${HITBOX_PATH}.justified`, `${HITBOX_PATH}.parts.*.bone`, `${HITBOX_PATH}.parts.*.damage_scale`, `${HITBOX_PATH}.parts.*.phase_scales`, `${HITBOX_PATH}.parts.*.weakpoint_sound`, `${HITBOX_PATH}.parts.*.contact`, "flight", "habits", "tempt", "justified", "tactics", "stances.list.*.clips", "stances.list.*.model", "stances.list.*.guard", "stances.list.*.change", "stances.list.*.when", "stances.list.*.leave", "stances.list.*.events", "stances.list.*.bar", "stances.list.*.ambient"],
}
/** Said under the form for what `HAND_KEPT` holds, so nobody looks for it in vain. */
export const HAND_KEPT_WORDS: Record<HandKind, string> = {
  book: "每一页在「书页」里写：标题、正文、页边小字、图和英文，也能加页、删页、调顺序。",
  ability: "要调整出手、动作和声音，可以让 AI 改这招。",
  particle:"注册名、贴图帧、换帧方式、曲线中间点、朝向、拉伸、减速和建议撒法可以交给 AI 修改。",
  block: "盲盒的奖池、另外几张随机图案和方块的外形（几个方盒子拼成的样子）不在这里改：它们原样留着，要改就让 AI 改。",
  item: "外观模型和持握姿势原样保留，可以在「看看」里的物品持握面板调整。",
  recipe: "",
  entity: "它的模型和动作在模型编辑器里改；招式的临时地形、场地物件怎么亮、亮多久可以在上面改。常用出手、阶段和演出设置在各自的页签改。粒子别名、常驻发射、改灯的安排、亮灯条件、连招、巢、场地雾、眼睛高度、台阶高度、卡住时的动作、碰撞箱的随动和受伤设置、飞行、习性、跟随的生物拿什么引它、“本来就该这样”的理由清单、只在哪处遗迹或建筑附近出现、跟着哪只 Boss 的巢一起放好和爆炸附带的效果在这里原样留着。",
}
/** A creature's fields the older save route (`saveEntity`) carries: all the form offers until `saveByHand` is wired in. */
export const ENTITY_BASICS: readonly string[] = ["name", "description", "health", "speed", "attack_damage", "behavior"]

/** The lowest `block_3`-style short name nothing in the project uses yet. */
export function freeIdentifier(taken: readonly string[], kind: "block" | "item") {
  const used = new Set(taken)
  const free = (count: number): string => (used.has(`${kind}_${count}`) ? free(count + 1) : `${kind}_${count}`)
  return free(1)
}

/**
 * A new thing as the form first shows it: what vanilla's plainest one of its kind has (stone: hardness 1.5, mined
 * with a pickaxe, drops itself; an ordinary item stacks to 64). A recipe starts empty: its materials and what it
 * makes are the person's to pick, and it cannot be saved before they are.
 */
export function blankDocument(kind: HandKind, name: string, taken: readonly string[]): Loose | null {
  if (kind === "block") return { kind, identifier: freeIdentifier(taken, "block"), name, hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#8a8a8a", texture: null }
  if (kind === "item") return { kind, identifier: freeIdentifier(taken, "item"), name, max_stack: 64, color: "#8a8a8a", texture: null }
  if (kind === "recipe") return { kind, name, pattern: Array<string | null>(9).fill(null), result: "", count: 1, type: "shaped" }
  if (kind === "book") return { kind, name, give_on_first_join: true, keep_on_death: true, pages: [{ title: "第一页", body: "" }] }
  return null
}

const without = (document: Loose, ...keys: string[]) => Object.fromEntries(Object.entries(document).map(([key, value]) => [key, keys.includes(key) && value != null ? null : value]))

/**
 * A document made consistent after an edit, by the game's own rules (the ones `validateContent` refuses a save
 * for): choosing one thing takes with it what only made sense with the other. Run on every change, so the form
 * never holds a combination the game cannot have.
 */
export function settle(kind: HandKind, document: Loose): Loose {
  if (kind === "block") {
    const generation = document.generation as Loose | null | undefined
    const dimension = generation ? ORE_DIMENSIONS[generation.dimension as keyof typeof ORE_DIMENSIONS] : null
    const bases = generation ? Object.entries(ORE_BASES).filter(([, base]) => base.dimension === generation.dimension).map(([key]) => key) : []
    const kept = generation ? (generation.replaces as string[]).filter((base) => bases.includes(base)) : []
    const clamp = (y: unknown) => (typeof y === "number" && dimension ? Math.min(dimension.max_y, Math.max(dimension.min_y, y)) : y)
    return {
      // No tool, no tool material; something else drops only when asked for; a block that comes back as itself gives no experience.
      ...without(document, ...(document.tool === "none" ? ["tool_tier"] : []), ...(document.drop === "item" ? [] : ["drop_item"]), ...(document.drop === "self" ? ["experience"] : [])),
      ...(document.drop === "item" && !document.drop_item ? { drop_item: { item: "", min: 1, max: 1, fortune: false } } : {}),
      // Each dimension has its own rock and its own heights, and only the overworld is split into groups of biomes.
      ...(generation && dimension ? { generation: { ...generation, replaces: kept.length ? kept : bases, min_y: clamp(generation.min_y), max_y: clamp(generation.max_y), biomes: generation.dimension === "overworld" ? generation.biomes : null } } : {}),
    }
  }
  // A tool wears out, so it cannot stack, and it is not eaten.
  if (kind === "item") {
    if (document.tool) return { ...without(document, "food"), max_stack: 1 }
    // An effect that happens at once has no length to give: the game ignores it, so the form writes the 1 the document asks for.
    const food = document.food as Loose | null | undefined
    const effects = food?.effects as Loose[] | null | undefined
    const instant = (effect: Loose) => typeof effect.effect === "string" && effect.effect in FOOD_EFFECTS && "instant" in FOOD_EFFECTS[effect.effect as keyof typeof FOOD_EFFECTS]
    return effects?.some((effect) => instant(effect) && effect.seconds !== FOOD_EFFECT_LIMITS.seconds.min)
      ? { ...document, food: { ...food, effects: effects.map((effect) => (instant(effect) ? { ...effect, seconds: FOOD_EFFECT_LIMITS.seconds.min } : effect)) } }
      : document
  }
  if (kind === "recipe") {
    const type = kindOf(document)
    const slots = RECIPE_KINDS[type].slots
    const pattern = (document.pattern as (string | null)[]).slice(0, 9)
    const filled = pattern.filter((value): value is string => value !== null)
    // One material goes in the first slot; a smithing table reads its first three.
    const shaped = slots === "one" ? [filled[0] ?? null] : slots === "three" ? pattern.slice(0, 3) : pattern
    return {
      ...(cooks(document) ? document : without(document, "experience", "cooking_time")),
      pattern: Array.from({ length: 9 }, (_, index) => shaped[index] ?? null),
      // A furnace and a smithing table give one at a time.
      ...(cooks(document) || type === "smithing" ? { count: 1 } : {}),
    }
  }
  return document
}

/** 「熔炉自己的时间是 10 秒」: what leaving a recipe's cooking time out means for its kind. */
export const cookingWords = (document: Loose) => {
  const ticks = cookingTime(kindOf(document))
  return ticks === null ? "" : `${RECIPE_KINDS[kindOf(document)].station}自己的时间是 ${ticks} 刻（${seconds(ticks)}）。`
}

/** What the three slots of a smithing table hold, in the order the recipe reads them. */
export const SMITHING_SLOTS = ["锻造模板", "要升级的东西", "加进去的材料"] as const

/**
 * mod-core's own findings that name a field the way a document spells it, said again for the person. A finding
 * not listed and already in plain words is shown as it is; any other is shown as `ISSUE_WORDS.other`.
 */
export const ISSUE_RULES: readonly (readonly [RegExp, string])[] = [
  [/^Unknown content reference: (?:[a-z0-9_.-]+:)?(.+)$/, "用到了「$1」，可是模组里没有这样东西。先把它做出来，或者换一样。"],
  [/^Duplicate content identifier/, "这个标识符已经有别的方块或物品在用了，换一个。"],
  [/工具不能叠放/, "工具不能叠放，一格只能放 1 个。"],
  [/不能既是工具又是食物/, "它不能既是工具又是食物，留下一样。"],
  [/修理材料不能是它自己/, "不能用它自己来修它自己，换一样材料。"],
  [/没有写掉什么/, "还没选挖掉以后掉哪一样。"],
  [/那就得先选一种工具/, "要求工具材质的话，先选一种工具（镐、斧或者锹）。"],
  [/^自然生成至少要写一个群系/, "至少选一类地方，或者单独加一个群系。"],
  [/^Spawn min must not exceed max/, "一次最多几只，不能比最少还少。"],
  [/^Spawn biomes must be unique|同一组群系不要重复写/, "同一个地方选了两次，去掉一个。"],
  [/只能有一样材料/, "这种配方只放一样材料。"],
  [/是锻造台配方/, "锻造台要放满三样：锻造模板、要升级的东西、加进去的材料。"],
  [/一次只能出 1 个/, "这种配方一次只能做出 1 个。"],
  [/只有主世界可以再限定群系/, "只有主世界能再限定群系。"],
  [/在这个工程里找不到/, "这样掉落物在模组里找不到了，换一样。"],
  [/^英文名里不能有中文/, "英文名里不能有中文，写一个简短的英文名，例如 Azure Ore。"],
]
export const ISSUE_WORDS = {
  empty: "不能空着。",
  unpicked: "还没选。",
  number: "要填一个数。",
  whole: "要填整数，不带小数点。",
  choice: "要从给出的几样里选一个。",
  format: "写法不对。",
  identifier: "要用小写字母开头，只用小写字母、数字和下划线。",
  some: "至少选一样。",
  materials: "配方至少需要一种材料。",
  other: "这一项和别的设置对不上，检查一下。",
  elsewhere: (name: string) => `这样改了以后，「${name}」就对不上了。先去改它，或者把这里改回去。`,
  whole_thing: "有一处对不上，没有保存。",
} as const

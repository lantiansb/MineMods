import { z } from "zod"
import { GEOMETRY_TIER_IDS, GEOMETRY_TIERS, tierNamed, type GeometryTier } from "@minemods/studio-ai/budget"
import { EPIC_MODEL_GUIDE, EPIC_SHAPE_GUIDE, MODEL_COMPLEXITY_PRESETS, ModelComplexitySchema, type ModelComplexity } from "@minemods/studio-ai/model-quality"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { Ability } from "./entity-runtime"
import { motionLabel, motionName, REVIEW_SWITCH, SIX_VIEW_NAME, type SixViewStyle } from "@minemods/studio-ai/making"
import { BOSS_LIMITS } from "./boss-words"
import { ABILITY_LIMITS, COMBO_LIMITS, EPIC_LIMITS } from "./ability-words"
import { BOSS_TASK_LINES, felt } from "./creature-boss"
import { FLIGHT_TASK_LINES } from "./creature-flight"
import { modelBounds } from "./model-bounds"

/**
 * Creature tiers (creature tier, 10-12): how much a creature is worth making well. The planning AI writes one per
 * creature entry of the blueprint, the person may change it before confirming, and it then reaches the task text,
 * the part sheet's geometry budget, how strictly the model is reviewed and the pre-build reconciliation.
 *
 * This file is the one public table of them. Every number or choice in it comes from
 * docs/specs/2026-10-12-creature-tier.md (the table under 「档位」); nothing here knows a subject.
 * A tier is a floor for care, never a target: the geometry budget is only a ceiling and a model is accepted for how it
 * looks, not for how many parts it has (`studio-ai/src/budget.ts`).
 */

export const CREATURE_TIER_LEVELS = ["simple", "standard", "fine", "boss", "epic"] as const
export type CreatureTierLevel = (typeof CREATURE_TIER_LEVELS)[number]

/** What an entry of the blueprint says about its creature's tier. `by` is who decided: the planning AI or the person. */
export const CreatureTierSchema = z.strictObject({
  level: z.enum(CREATURE_TIER_LEVELS),
  /** One line the person reads: what the choice rests on, quoting their own words where there are any. */
  reason: z.string().trim().min(1).max(300),
  by: z.enum(["ai", "you"]),
})
export type CreatureTier = z.infer<typeof CreatureTierSchema>

/** The reason written when the person picks a tier on the blueprint card (spec: 「理由写『你选的』」). */
export const PERSON_TIER_REASON = "你选的"

type TierRow = {
  level: CreatureTierLevel
  /** The person's word for it, on the card's buttons. */
  label: string
  /** Who it is for, in plain words (spec table, column 「给谁」). */
  use: string
  /** The geometry budget tier (`GEOMETRY_TIERS`) the part sheet's budget may not be below (spec: 简单/标准 standard, 精细 fine, Boss finest). */
  budget: GeometryTier
  /**
   * The least detailed model detail level (`ModelComplexitySchema`, the vocabulary of the 模型精细度 button) the tier's creature is made by: the column of the
   * spec's 档位 table that says low / medium / high / high (史诗 high too: the button has nothing above 高, and what makes 史诗 more is in the budget, the
   * motions and the hitbox, not in a fourth level of detail). The names are the button's own, so no mapping stands between them; `effectiveDetail` reads it.
   */
  complexity: ModelComplexity
  /** Motions every creature needs, whatever its tier (spec: idle、walk、hurt). */
  clips: readonly string[]
  /** Also needs a death motion (spec: 精细 and Boss). */
  death: boolean
  /** A creature that hits with its own body and has no abilities also needs an attack motion (spec: 精细 and Boss). */
  attack: boolean
  /** The fewest abilities a hostile creature of this tier has, each with a motion of its own (spec: Boss, 2). */
  abilities: number
  /** Whether the person's own words asking for something simple may still relax the review (spec: 简单、标准 照旧; 精细、Boss 不放宽). */
  relaxes: boolean
  /** Whether the maker of the model is reminded to ask for the 六视图 before starting (spec: 开工前提醒先给六视图; asked of 精细 as well as Boss because both must be right in the first version). */
  sixViews: boolean
  sixViewStyle: Extract<SixViewStyle, "blocky" | "sculpted">
  /** What the first version has to be like, in a sentence for the maker. */
  detail: string
  /** The 六视图 is needed before the model is begun, not only reminded of (10-12: 史诗). */
  sixViewsRequired: boolean
  /** Its creature carries a hitbox of parts (body, head, tail, wings each boxed) (10-12: 史诗). */
  hitbox: boolean
  /** The models the person chose for making and reviewing it, said to both; null: the usual advice (10-12: 史诗, GPT 6 Astra at its highest). */
  models: string | null
  /**
   * A hostile creature of this tier carries a `boss` (spec 2026-10-12-boss-runtime.md, 「Boss 档的要求」; 史诗: a hostile one is a Boss as well). Only what the creature's schema requires of a boss is
   * required here — the bar and the death show; the wake-up, the phases (0 to `BOSS_LIMITS.phases`), the leash and the lair are optional in the schema and so optional in the tier (broad21: the table said
   * 「至少 1 个阶段」 while the schema allows none, and a veteran who wanted two moves was turned back for it).
   */
  boss: boolean
  /** A hostile creature of this tier has at least one ability that shakes the screen or throws up debris (spec: Boss 档的要求; the owner asked for it on 10-12). */
  felt: boolean
}

const BASE_CLIPS = ["idle", "walk", "hurt"] as const

export const CREATURE_TIERS = {
  simple: {
    level: "simple",
    sixViewStyle: "blocky",
    label: "简单",
    use: "用户明说要简单、低模、像原版那样简单的",
    budget: "standard",
    complexity: "low",
    clips: BASE_CLIPS,
    death: false,
    attack: false,
    abilities: 0,
    relaxes: true,
    sixViews: false,
    detail: "按简单的做：形体概括、一眼认得出就好，不用堆细节。",
    sixViewsRequired: false,
    hitbox: false,
    models: null,
    boss: false,
    felt: false,
  },
  standard: {
    level: "standard",
    sixViewStyle: "blocky",
    label: "标准",
    use: "默认",
    budget: "standard",
    // The planner's default, not a choice for more: it follows the person's own 「模型精细度」 button and raises nothing (the floor below every button).
    complexity: "low",
    clips: BASE_CLIPS,
    death: false,
    attack: false,
    abilities: 0,
    relaxes: true,
    sixViews: false,
    detail: "按一只普通生物的样子做：轮廓、比例和各部分的位置都要对，细节够用就好。",
    sixViewsRequired: false,
    hitbox: false,
    models: null,
    boss: false,
    felt: false,
  },
  fine: {
    level: "fine",
    sixViewStyle: "blocky",
    label: "精细",
    use: "用户说要精细、高质量、细节多，或者同屏只有几个、会走近看的大家伙",
    budget: "fine",
    complexity: "high",
    clips: BASE_CLIPS,
    death: true,
    attack: true,
    abilities: 0,
    relaxes: false,
    sixViews: true,
    detail: "第一版就要把细节做好：轮廓、比例、各部件的数量和位置、表面的层次都要到位，不要先交一个粗糙的版本、指望以后再改精细。",
    sixViewsRequired: false,
    hitbox: false,
    models: null,
    boss: false,
    felt: false,
  },
  boss: {
    level: "boss",
    sixViewStyle: "blocky",
    label: "Boss",
    use: "用户说 Boss、首领、最终、霸主之类，或者它显然是整场战斗的主角",
    budget: "finest",
    complexity: "high",
    clips: BASE_CLIPS,
    death: true,
    attack: true,
    abilities: 2,
    relaxes: false,
    sixViews: true,
    // broad11 w1: a "thunderbird boss" came out as a squat bird a little taller than the player, read as a penguin. A boss is looked at
    // as the boss: its size and the shape that says what it is are part of the brief, unless the person's words make it small.
    detail: "第一版就要把细节做好：它是整场战斗里被盯着看的那一个，要有 Boss 的分量——除非用户说了它小，体型要明显比玩家大、站在玩家旁边有压迫感；轮廓一眼就看得出是原话里的什么东西（种类特征要夸张到位，不能做成另一种动物的比例），比例、各部件的数量和位置、表面的层次都要到位，每个招式的蓄力和出手要大到玩家看得见；不要先交一个粗糙的版本、指望以后再改精细。",
    sixViewsRequired: false,
    hitbox: false,
    models: null,
    boss: true,
    felt: true,
  },
  // 10-12 (docs/specs/2026-10-12-epic-tier-flight.md): the final test the person set — the one creature of the mod, huge,
  // flying where it is asked to, with habits of its own, made and reviewed by the strongest model.
  epic: {
    level: "epic",
    sixViewStyle: "sculpted",
    label: "史诗",
    use: "用户说史诗、超巨型、终极生物、最终考验、像宣传片里的龙，要它会飞、有自己的习性、整个模组只有这一只",
    budget: "epic",
    complexity: "high",
    clips: BASE_CLIPS,
    death: true,
    attack: true,
    abilities: 3,
    relaxes: false,
    sixViews: true,
    detail: "这是整个模组的终极生物，第一版就要做到最好：轮廓流畅（大圆体先试 2 像素的 solid，小件需要细弧时用 1 像素），关节放在骨骼交接的地方、转起来不撕开，比例和六视图一致，表面有层次；动作要多而且连贯——走、跑、起飞、扇翅、滑翔、落地、休息、每个招式的蓄力和出手都要大到看得见；会飞就真的飞（写 flight），有自己的作息、窝和捕猎（写 habits）。",
    sixViewsRequired: true,
    hitbox: true,
    models: REVIEW_SWITCH.epic_models,
    boss: true,
    felt: true,
  },
} as const satisfies Record<CreatureTierLevel, TierRow>

/** A blueprint entry as far as tiers are concerned. Structural, so this file does not import the blueprint it is part of. */
export type TieredEntry = { key: string; kind: string; title: string; owner: string | null; tier?: CreatureTier | undefined }

/** The row of an entry's tier. An entry that names none (every blueprint from before tiers) is 标准. */
export const tierOf = (entry: Pick<TieredEntry, "tier"> | null | undefined): TierRow => CREATURE_TIERS[entry?.tier?.level ?? "standard"]

/** Whether the geometry budget `asked` (a sheet's word for it, or nothing) is below what the row asks. */
export const budgetBelow = (row: Pick<TierRow, "budget">, asked: unknown) => GEOMETRY_TIER_IDS.indexOf(tierNamed(asked)) < GEOMETRY_TIER_IDS.indexOf(row.budget)

/**
 * The entry whose tier governs an entry's task: a creature's own, or that of the creature a model or a texture
 * belongs to. Null when there is none, and when the creature names none (nothing is then added to anything).
 */
export function governing<Entry extends TieredEntry>(entries: readonly Entry[], key: string): (Entry & { tier: CreatureTier }) | null {
  const found = entries.find((value) => value.key === key)
  if (!found) return null
  const owner = found.kind === "entity" ? found : found.owner === null ? undefined : entries.find((value) => value.key === found.owner && value.kind === "entity")
  return owner?.tier ? (owner as Entry & { tier: CreatureTier }) : null
}

// ---- what a tier asks, as one list (broad21) ----

/**
 * What a tier asks of a creature, as a list of plain items made from the table above and from nothing else (the same list is read in four places: the blueprint card where the
 * person picks a tier, the claimed task where the maker is told what to make, the scope of the creature's review, and the pre-build reconciliation that says what is still missing).
 * broad21: the whole of it used to be said only when the build was about to be packed, so a veteran who asked for two moves was told after the game had run that a Boss also needs
 * phases and a shake. Whatever the schema leaves open (the wake-up, the phases, the leash, the lair) is listed as open and is never held against the creature.
 */
export type TierAskId = "motions" | "abilities" | "boss" | "felt" | "telegraph" | "hitbox" | "flight" | "boss_extras" | "steady" | "model_pose"
export type TierAsk = {
  id: TierAskId
  /** Whose work it is: the model's (its motions), the creature's document, or both. */
  side: "model" | "creature" | "both"
  /** False: said so that the person and the maker know it is open; it is never held against the creature. */
  required: boolean
  /** Only a hostile creature has to have it. */
  hostile: boolean
  /** Short and plain, for the blueprint card. */
  brief: string
  /** In full, for the maker and the reviewer. */
  full: string
  /** What to do about it when it is missing. */
  fix: string
}

const HITBOX_FIX = "给它写上 hitbox：身体一个箱子，伸出去的部位各自加箱子（parts）。"

function asksOf(row: TierRow): TierAsk[] {
  const clips = [...row.clips, ...(row.death ? ["death"] : [])]
  const optional = row.boss ? `登场（intro）、阶段（phases，0 到 ${BOSS_LIMITS.phases} 个）、离开重置（leash）、巢（lair）` : ""
  return [
    {
      id: "motions",
      side: "both",
      required: true,
      hostile: false,
      brief: `动作要有${clips.map(motionName).join("、")}${row.attack && !row.abilities ? "（近身打人的再加攻击）" : ""}`,
      full: `必须有的动作：${clips.map(motionLabel).join("、")}${row.attack ? `；会用身体近身打人、又没有招式的，再加${motionLabel("attack")}` : ""}`,
      fix: "给模型补上这些动作。",
    },
    ...(row.abilities
      ? [
          {
            id: "abilities" as const,
            side: "both" as const,
            required: true,
            hostile: true,
            brief: `至少 ${row.abilities} 个招式，每个有自己的动作`,
            full: `敌对的至少要有 ${row.abilities} 个招式（abilities），每个招式有自己名字的动作，不借用别的`,
            fix: "给它写出够数的招式（abilities），每个招式在模型里有同名的动作。",
          },
        ]
      : []),
    ...(row.boss
      ? [
          {
            id: "boss" as const,
            side: "creature" as const,
            required: true,
            hostile: true,
            brief: "Boss 的血条和死亡演出",
            full: "写 boss（格式见 boss 的说明）：血条（bar）和死亡演出（death）必须有",
            fix: "给它写上 boss（血条 bar 和死亡演出 death 必须有）。",
          },
        ]
      : []),
    ...(row.felt
      ? [
          {
            id: "felt" as const,
            side: "creature" as const,
            required: true,
            hostile: true,
            brief: "至少一个招式晃屏或扬起碎块",
            full: "至少一个招式在落地或吼叫的那一刻放晃屏（shake）或碎块（debris）",
            fix: "让至少一个招式在落地或吼叫的那一刻放 shake（晃屏）或 debris（碎块）。",
          },
        ]
      : []),
    // Judged by whoever looks at the pictures of its abilities (a reviewer's rule: a player must see the move coming), not measured by a count.
    ...(row.boss
      ? [
          {
            id: "telegraph" as const,
            side: "creature" as const,
            required: true,
            hostile: true,
            brief: "每个招式出手前有看得见的预警",
            full: "每个招式在蓄力里放预警：可给范围出手或冲击波环写 warn，也可用 effect 事件在判定范围上画出来，蓄力长到玩家看得见、躲得开",
            fix: "给每个招式加上能在蓄力时看到的范围或冲击波预警，或用 effect 事件标出判定范围。",
          },
        ]
      : []),
    ...(row.hitbox
      ? [
          {
            id: "hitbox" as const,
            side: "creature" as const,
            required: true,
            hostile: false,
            brief: "分部位的碰撞箱（头、尾巴、翅膀各一个箱子）",
            full: "写 hitbox：身体一个箱子（core），头、尾巴、翅膀这些伸出去的部位各自加箱子（parts）；看图时量出来不合身的要改",
            fix: HITBOX_FIX,
          },
        ]
      : []),
    ...(row.level === "epic"
      ? [
          {
            id: "flight" as const,
            side: "both" as const,
            required: true,
            hostile: false,
            brief: "会飞的要有起飞、落地的动作，有习性的要有休息的动作",
            full: "会飞的写 flight，起飞、落地各有自己的动作；有习性的写 habits，休息有自己的动作",
            fix: "会飞的写 flight（起飞、落地各一个动作），有习性的写 habits 并给休息一个动作。",
          },
        ]
      : []),
    ...(row.boss
      ? [
          {
            id: "model_pose" as const, side: "model" as const, required: false, hostile: false,
            brief: "头要会看人，待机时耳朵、尾巴或胸口有小动作",
            full: "头要会看人：写 look，让脖子和头分担转角。待机的小动作用 sway，例如耳朵、尾巴或呼吸。这两项按造型选用。",
            fix: "",
          },
          {
            id: "steady" as const, side: "creature" as const, required: true, hostile: false,
            brief: "身体转身和看人要稳重", full: '转身和看人要稳重，建议写 steady:{"preset":"auto"}。有意让它灵活，可在 justified 写 steady 和理由。',
            fix: "在生物页点「让它稳重」，或写明它需要灵活转身的理由。",
          },
          {
            id: "boss_extras" as const,
            side: "creature" as const,
            required: false,
            hostile: true,
            brief: `登场、阶段（0–${BOSS_LIMITS.phases} 个）、离开重置可有可无`,
            full: `${optional}都是可选的：想要再写，不写也算做到了这一档`,
            fix: "",
          },
        ]
      : []),
  ]
}

/** What a tier asks, as the list. Read this, never the table's fields, wherever a text says what a tier needs. */
export const tierAsks = (level: CreatureTierLevel): readonly TierAsk[] => asksOf(CREATURE_TIERS[level])

/** A tier's name as a sentence takes it: 「精细档」, 「Boss 档」. */
export const tierName = (row: Pick<TierRow, "label">) => (/^[A-Za-z]/.test(row.label) ? `${row.label} 档` : `${row.label}档`)

/**
 * One short plain sentence for the blueprint card, where the person picks a tier: what the chosen tier has to have, and what is left open.
 * Said in the person's words; no field names.
 */
export function tierAsksBrief(level: CreatureTierLevel) {
  const asks = tierAsks(level)
  const open = asks.filter((ask) => !ask.required)
  return `${tierName(CREATURE_TIERS[level])}要有：${asks.filter((ask) => ask.required).map((ask) => ask.brief).join("；")}。${open.length ? `${open.map((ask) => ask.brief).join("；")}。` : ""}`
}

/** The heading of the list in a task text: the items that are the maker's own to make follow it. */
export const TIER_ASKS_HEADING = "- 这一档要有这些（做完照这张单子逐项对一遍，审查时也按它查）："
function tierAskLines(row: TierRow, kind: "entity" | "model") {
  const mine = asksOf(row).filter((ask) => ask.side === "both" || ask.side === (kind === "entity" ? "creature" : "model"))
  return [TIER_ASKS_HEADING, ...mine.map((ask) => (ask.required ? `  · ${ask.full}` : `  · （可有可无，没有也不算缺）${ask.full}`))]
}

/** The motions and abilities a tier asks for, one phrase (the planner reads it to choose a tier). */
function clipsPhrase(row: TierRow) {
  const asks = asksOf(row)
  return [asks[0]!.full, ...asks.filter((ask) => ask.id === "abilities").map((ask) => ask.full)].join("；")
}

/** What a creature's document is read for, to say what of a tier's list is still missing. */
type GapSubject = { steady?: unknown; justified?: readonly { what: string; reason: string }[] | null; behavior: string; abilities?: readonly Pick<Ability, "events">[] | null; boss?: unknown; hitbox?: { parts?: readonly unknown[] | null } | null }

/**
 * Which of a tier's required items the creature's document measurably lacks, each with a plain sentence: the Boss settings, the ability that shakes or throws debris, the hitbox of parts.
 * Only a hostile creature fights, so it alone can lack what a fight needs. The motions and the number of abilities are measured against the model and the gameplay code by the reconciliation.
 */
export function tierAskGaps(row: TierRow, creature: GapSubject) {
  const hostile = creature.behavior === "hostile"
  const lacks = (ask: TierAsk): string | null =>
    ask.id === "boss" ? (creature.boss ? null : "还没有 Boss 设置（血条和死亡演出）")
    : ask.id === "felt" ? (felt(creature.abilities ?? []) ? null : "没有一个招式在落地或吼叫时晃屏或扬起碎块")
    : ask.id === "steady" ? (creature.steady || creature.justified?.some(item => item.what.trim().toLowerCase() === "steady" && item.reason.trim()) ? null : "缺稳重设置（steady）")
    : ask.id === "hitbox" ? (creature.hitbox?.parts?.length ? null : "没有分部位的碰撞箱（头、尾巴、翅膀各自的箱子）")
    : null
  return asksOf(row).flatMap((ask) => {
    if (!ask.required || (ask.hostile && !hostile)) return []
    const said = lacks(ask)
    return said === null ? [] : [{ ask, said }]
  })
}

/**
 * 第 3 步: what a creature carries beyond what its tier lets it, each as a plain sentence: more abilities than `ABILITY_LIMITS.abilities`, an ability with more hits than `ABILITY_LIMITS.hits`,
 * more combos than `COMBO_LIMITS.combos`. The epic tier has room for `EPIC_LIMITS` (the schema's own bounds), so nothing is said of an epic creature.
 */
export function tierLimitIssues(level: CreatureTierLevel, creature: { abilities?: readonly { name: string; hits: readonly unknown[] }[] | null; combos?: readonly unknown[] | null }) {
  if (level === "epic") return []
  const abilities = creature.abilities ?? []
  const many = abilities.filter((ability) => ability.hits.length > ABILITY_LIMITS.hits)
  return [
    ...(abilities.length > ABILITY_LIMITS.abilities ? [`写了 ${abilities.length} 个招式，这一档招式最多 ${ABILITY_LIMITS.abilities} 个（史诗档最多 ${EPIC_LIMITS.abilities} 个）`] : []),
    ...(many.length ? [`${many.map((ability) => `「${ability.name}」出手 ${ability.hits.length} 次`).join("、")}，这一档每个招式出手最多 ${ABILITY_LIMITS.hits} 次（史诗档最多 ${EPIC_LIMITS.hits} 次）`] : []),
    ...((creature.combos?.length ?? 0) > COMBO_LIMITS.combos ? [`写了 ${creature.combos!.length} 个连招，这一档连招最多 ${COMBO_LIMITS.combos} 个（史诗档最多 ${EPIC_LIMITS.combos} 个）`] : []),
  ]
}

/** The detail levels of the 模型精细度 button, least detailed first (the order of `ModelComplexitySchema`). */
const DETAIL_LEVELS = ModelComplexitySchema.options

/**
 * The detail level a creature's model is made and reviewed by (broad20): the higher of the 模型精细度 button at the top (`global`) and what the creature's
 * tier asks (`CREATURE_TIERS[tier].complexity`). A tier only raises, never lowers: the button above it is followed; without a tier (a thing that is not a
 * creature's model, an old blueprint) the button alone. This is the one place the two are put together; every text, range and review that speaks of a
 * model's detail reads its answer, so the maker is never given two ranges.
 */
export function effectiveDetail(global: ModelComplexity, tier?: CreatureTierLevel | null): ModelComplexity {
  const asked = tier ? CREATURE_TIERS[tier].complexity : global
  return DETAIL_LEVELS.indexOf(asked) > DETAIL_LEVELS.indexOf(global) ? asked : global
}

/**
 * `effectiveDetail` for the blueprint entry `key`: raised by the tier of the creature a model entry belongs to, unchanged for any other entry (an item's
 * model, a texture, the creature itself) and for a creature that names no tier. `global` null (a run started with no button setting) stays null.
 */
export function detailFor(entries: readonly TieredEntry[], key: string, global: ModelComplexity | null): ModelComplexity | null {
  if (global === null) return null
  const entry = entries.find((value) => value.key === key)
  const owner = entry?.kind === "model" ? governing(entries, key) : null
  return effectiveDetail(global, owner?.tier.level)
}

/** The part of an asset that tells which model it wears. Structural. */
type AssetOfModel = { id: string; document: { kind: string; model_asset_id?: string | null } }

/**
 * `detailFor` by the id of a model asset instead of a blueprint key (the older single-creature path and the outside AI's look at a saved model have an asset,
 * not a task): the creature entry linked to it, the same way the build's reconciliation finds it — the creature itself, the entity asset that wears the model,
 * or the model entry whose owner it is. `entries` are those of a confirmed blueprint; none: the button alone.
 */
export function tierForModel(entries: readonly (TieredEntry & { asset_id?: string | null })[], assets: readonly AssetOfModel[], modelId: string): CreatureTierLevel | undefined {
  const creature =
    entries.find(
      (value) =>
        value.kind === "entity" &&
        value.tier &&
        (value.asset_id === modelId || assets.some((asset) => asset.id === value.asset_id && asset.document.kind === "entity" && asset.document.model_asset_id === modelId)),
    ) ?? entries.flatMap((value) => (value.kind === "model" && value.asset_id === modelId ? [governing(entries, value.key)] : [])).find((value) => value !== null)
  return creature?.tier?.level
}

export function detailForModel(entries: Parameters<typeof tierForModel>[0], assets: readonly AssetOfModel[], modelId: string, global: ModelComplexity): ModelComplexity {
  return effectiveDetail(global, tierForModel(entries, assets, modelId))
}

export function sixViewStyleFor(level?: CreatureTierLevel, epicStyle?: "blocky" | "sculpted") {
  return level === "epic" && epicStyle ? epicStyle : CREATURE_TIERS[level ?? "standard"].sixViewStyle
}

/**
 * How the creature's tier and the 模型精细度 button at the top of the window relate (broad20, settled by the product owner): the tier is the creature's own
 * (the blueprint card: which motions it must have, how many abilities and phases a Boss has, how strict the review is, the geometry budget its part sheet may
 * not fall below) and it also names the least detail its model is made by (`TierRow.complexity`); the button is the setting for every model. A creature's model
 * is made by the higher of the two (`effectiveDetail`), so the button never lowers a tier and a tier never lowers the button.
 * One sentence beside each, from the same tables the rules read, so the sentences and the rules cannot drift apart. The names and levels are the tables' own.
 */
export const DETAIL_WORDS = (() => {
  const label = (level: ModelComplexity) => MODEL_COMPLEXITY_PRESETS[level].label
  // A tier at the lowest level raises nothing: it follows the button. Only the tiers above it are said as a floor.
  const lowest = DETAIL_LEVELS[0]!
  const following = CREATURE_TIER_LEVELS.filter((id) => CREATURE_TIERS[id].complexity === lowest).map((id) => CREATURE_TIERS[id].label)
  /** What each raising tier asks, grouped by level: "精细、Boss、史诗至少「高」". */
  const raising = DETAIL_LEVELS.filter((level) => level !== lowest)
    .flatMap((level) => {
      const tiers = CREATURE_TIER_LEVELS.filter((id) => CREATURE_TIERS[id].complexity === level).map((id) => CREATURE_TIERS[id].label)
      return tiers.length ? [`${tiers.join("、")}档至少按「${label(level)}」`] : []
    })
    .join("，")
  const floors = [raising, following.length ? `${following.join("、")}档照顶部的设置` : ""].filter(Boolean).join("；")
  return {
    /** Beside the tier buttons, where the person picks a creature's tier: one sentence, with what a higher tier costs. */
    tier: `档越高，要的招式和表现越多，模型也越细（${floors}；顶部设得更高时按顶部），做的时间也越长。`,
    /** Under the heading of the top 模型精细度 menu. */
    button: `只决定 AI 做模型时参考多少方块。生物档位可能把某个生物的模型抬得更细（比如 ${CREATURE_TIERS.boss.label} 档至少按「${label(CREATURE_TIERS.boss.complexity)}」），那只生物就按两者里更细的一档做。`,
    /** For the texts an outside AI reads (hand-off, module list, capability list): the same rule, and where the answer is. */
    told: `每个生物的模型实际按哪一档精细度做：取顶部「模型精细度」和这只生物的档位要求（${floors}）里更细的一档，只抬不压；任务的 instructions 里「复杂度档位」那一句已经把两样合起来算好了，只照它的范围做。`,
  } as const
})()

/** The heading the lines of a tier are written under in a task text (see `TASK_PROMPT_HEADINGS`). */
export const TIER_HEADING = "这个生物在蓝图上定的档位，做出来都要兑现："

/**
 * What a task is told about the tier of its creature: the level and why, the geometry budget to write on the part sheet, the
 * motions, the six views and how good the first version has to be. For the creature's own entry and for its model; empty
 * when the entry has no creature with a tier (an old blueprint) and so is 标准 by default without being told so.
 */
export function tierTaskLines(entries: readonly TieredEntry[], key: string): string[] {
  const owner = governing(entries, key)
  const kind = entries.find((value) => value.key === key)?.kind
  // Only the creature and its model are told: a texture or anything else follows what they are made as.
  if (!owner || (kind !== "entity" && kind !== "model")) return []
  const row = tierOf(owner)
  const budget = GEOMETRY_TIERS[row.budget]
  return [
    `- 档位：「${row.label}」（${row.level}）${kind === "entity" ? "" : `——这是蓝图里生物「${owner.title}」的档位，它的模型也照这一档做`}。${owner.tier!.by === "you" ? "这是用户自己选的。" : `理由：${owner.tier!.reason}`}`,
    // broad21: what this tier asks, as the one list the blueprint card, the review and the pre-build reconciliation read too.
    ...tierAskLines(row, kind),
    // Boss runtime (10-12): what a Boss asks of the creature's document, and how to choose its numbers.
    ...(row.level === "boss" && kind === "entity" ? BOSS_TASK_LINES : []),
    // 10-12 epic: a hostile one is a boss as well; every one wears a hitbox of parts.
    ...(row.level === "epic" && kind === "entity" ? ["- 敌对的史诗档生物同时是整场战斗的 Boss，照这一档的要求写 boss；不敌对的不写。", ...BOSS_TASK_LINES, ...FLIGHT_TASK_LINES, `- 史诗档的招式最多 ${EPIC_LIMITS.abilities} 个、每个招式出手最多 ${EPIC_LIMITS.hits} 次、连招最多 ${EPIC_LIMITS.combos} 个（别的档是 ${ABILITY_LIMITS.abilities}、${ABILITY_LIMITS.hits}、${COMBO_LIMITS.combos}）；分段、跳跃、预判冲锋、会拐弯的连招和出招之间的走法（tactics）照生物说明里「出招更像一个会打架的 Boss」那一段写。`] : []),
    ...(kind === "model"
      ? [
          row.budget === "standard"
            ? `- 部件说明的 budget 照「${budget.name}」档，不用特意写高一档。`
            : `- 部件说明的 budget 至少写 "${row.budget}"（「${budget.name}」档：${budget.use}），再按平常写理由和同屏估计；低于这一档的部件说明会被退回，因为是蓝图上定的档位要这样。`,
          "- 几何预算只是上限，不是指标：验收看的是做出来像不像，不数方块。",
          // 第 1 步: Boss and epic tier guidance includes model proportions and detail ranges.
          ...(row.level === "boss" || row.level === "epic" ? [`- Boss 和史诗档的模型：${EPIC_MODEL_GUIDE}`] : []),
          ...(row.level === "epic" ? [`- 史诗档造型：${EPIC_SHAPE_GUIDE}`] : []),
          // broad20: one range only. The tier names the least detail of its creature's model; the range itself is said once, in the instructions' 复杂度档位, already worked out with the button.
          `- 精细程度：这个生物的模型至少按「${MODEL_COMPLEXITY_PRESETS[row.complexity].label}」精细度做，顶部的「模型精细度」设得更高时按顶部的。实际按哪一档、参考多少个体块，只看指令里「复杂度档位」那一句，它已经把这两样合起来算好了。`,
          ...(row.sixViewsRequired
            ? [`- 开工之前必须先有${SIX_VIEW_NAME}：没有就不要开工，先请用户给一个（六个方向各一张，或一整张）；有了严格照它做，比例和每个部位的位置都要对得上。`]
            : row.sixViews
              ? [
                  `- 开工之前先看这样东西有没有${SIX_VIEW_NAME}；没有的话，先提醒用户给一个（六个方向各一张，或一整张），有了就照它做。`,
                  // broad11 w1: with no six looks and no picture of its own, a boss was modelled straight from words and lost its kind.
                  "- 用户没给、也不打算给的时候，不要凭空直接建模：先用你自己的画图工具画出打算做成的样子（正面、侧面、背面，体型和玩家的比例要画出来），用 save_concepts 交给 Studio，再照着画做；验收时会拿它和渲染图对比。",
                ]
              : []),
          // broad5 w2: a boss's model used its six looks on the wings, and only the creature's review then found four of its five
          // moves without a hit anyone could pick out — too late to change the motions. The moves are planned with the model.
          ...(row.abilities
            ? [
                "- 这一档的生物会有招式：照蓝图里说的招式，模型里每个招式单独做一个动作，动作里先收回去蓄力、再打到底，打到底的姿势停住一小下再收回；做生物时招式的判定就放在停住的那一刻。蓄力和打到底的姿势都要和待机差得一眼看得出，招式之间也要互相认得出。",
              ]
            : []),
        ]
      : []),
    `- ${row.detail}`,
    ...(row.models ? [`- ${row.models}`] : []),
    ...(row.relaxes ? [] : ["- 验收不会因为任务文字里出现「简单」而放宽。"]),
  ]
}

/** What is attached to a creature's model, as far as a reviewer is told of it: whether there is a 六视图, and how many pictures the person and the maker added. */
export type TierReferences = { three_view: boolean; user: number; concept: number }

/** What a reviewer of a model is given as `tier` (see `TIER_REVIEW_RULE`): the level, the creature, why, what the tier asks, and what the maker had to go by. */
export type TierReview = { level: CreatureTierLevel; label: string; creature: string; reason: string; detail: string; views?: string }

/**
 * broad11 w1: a "thunderbird boss" was a squat bird barely taller than the player and the reviewers had no tier criterion to fail it
 * on, because only the maker was told the tier (`tierTaskLines`). This is what the independent reviewer of a creature's model is told
 * of it. Null for everything but a model, for a creature with no tier and for the tiers that relax with the person's words (简单, 标准):
 * their reviewers get exactly what they got before. `views` is said for the tiers that ask for a 六视图 only, because there the
 * reviewer compares the renders with it, or with what the maker drew of its own intent.
 */
export function tierReviewOf(entries: readonly TieredEntry[], key: string, attached: TierReferences): TierReview | null {
  const owner = governing(entries, key)
  if (!owner || entries.find((value) => value.key === key)?.kind !== "model") return null
  const row = tierOf(owner)
  if (row.relaxes) return null
  const views = row.sixViews
    ? attached.three_view
      ? `人给了${SIX_VIEW_NAME}，以它为准。`
      : attached.user
        ? `没有${SIX_VIEW_NAME}，人给了参考图（见「参考图」那张图）。`
        : attached.concept
          ? `没有${SIX_VIEW_NAME}，人也没给参考图；制作者动手之前自己画了构想图（见「参考图」那张图，是它打算做成的样子，不是人定下来的）。`
          : `没有${SIX_VIEW_NAME}，没有人给的参考图，制作者也没有自己画构想图：只能对着 request 里人的话和 detail 判断。`
    : null
  return { level: row.level, label: row.label, creature: owner.title, reason: owner.tier.by === "you" ? "用户自己选的这一档。" : owner.tier.reason, detail: row.detail, ...(views ? { views } : {}) }
}

/** What the reviewer of a creature (not of its model) is given as `tier_asks` (see `TIER_ASKS_REVIEW_RULE`): what the tier asks, what is open, and what Studio measured to be missing. */
export type TierAskReview = { tier: string; creature: string; required: string[]; optional: string[]; missing: string[] }

/**
 * broad21: the reviewer of a creature's abilities was told nothing of what the blueprint's tier asks of it, and the build's reminder was the first place a Boss's phases and shake were
 * said. Now the reviewer is given the same list the maker was (`tierAsks`) with what is measurably missing in the creature's document. Null for everything but a creature, for a creature
 * with no tier, for the tiers that relax with the person's words (简单, 标准) and for the tiers whose list holds only the motions (精细): their reviewers get what they got before.
 */
export function tierAskReviewOf(entries: readonly TieredEntry[], key: string, creature: GapSubject): TierAskReview | null {
  const owner = governing(entries, key)
  if (!owner || entries.find((value) => value.key === key)?.kind !== "entity") return null
  const row = tierOf(owner)
  if (row.relaxes) return null
  const asks = asksOf(row).filter((ask) => ask.side !== "model" && !(ask.hostile && creature.behavior !== "hostile"))
  if (!asks.some((ask) => ask.id !== "motions")) return null
  return {
    tier: tierName(row),
    creature: owner.title,
    required: asks.filter((ask) => ask.required).map((ask) => ask.full),
    optional: asks.filter((ask) => !ask.required).map((ask) => ask.full),
    missing: tierAskGaps(row, creature).map((gap) => gap.said),
  }
}

/** A player's box: 1.8 blocks tall and 0.6 wide (`EntityType.PLAYER` dimensions, as `block-shape-facts.ts` and `AIM_TARGET` have it). */
const PLAYER_BOX = { height: 1.8, width: 0.6 } as const

/**
 * One plain sentence of fact: how tall and wide the model is in blocks next to the player. Measured on the model's own bones and cubes
 * in its rest pose (16 pixels a block), the way the game's one box for a creature is (`legacyCore`); a creature's document has no scale of its
 * own, so the model stands in the game at this size. The width is the side of the square around the model's middle that holds all of it, wings
 * and tail included. Said only where the reviewer is given a `tier`: a fact for judging the size a Boss asks for, not a judgement.
 */
export function sizeNextToPlayer(design: Pick<ModelDesign, "bones">) {
  const bounds = modelBounds(design as ModelDesign)
  const blocks = (value: number) => String(Number(value.toFixed(1)))
  const times = bounds.height / PLAYER_BOX.height
  return `大小（量出来的事实）：站着不动时，这个模型高 ${blocks(bounds.height)} 格、最宽处 ${blocks(bounds.width)} 格，玩家高 ${PLAYER_BOX.height} 格、宽 ${PLAYER_BOX.width} 格，它的高度是玩家的 ${blocks(times)} 倍；数是照模型的部件和方块量的（16 像素一格，生物没有另外放大缩小）。`
}

/** Why a part sheet's geometry budget is below what the creature's tier on the blueprint asks, or null. `asked` is the sheet's budget word, if it has one. */
export function tierBudgetRefusal(entries: readonly TieredEntry[], key: string, asked: unknown) {
  const owner = governing(entries, key)
  if (!owner || entries.find((value) => value.key === key)?.kind !== "model") return null
  const row = tierOf(owner)
  if (!budgetBelow(row, asked)) return null
  const budget = GEOMETRY_TIERS[row.budget]
  return `蓝图上把「${owner.title}」定为「${row.label}」档，这一档的模型部件说明里 budget 至少要写 "${row.budget}"（「${budget.name}」档：${budget.use}），现在${typeof asked === "string" && asked ? `写的是 "${asked}"` : "没有写"}。是蓝图上定的档位要求这样，不是随意加的：把部件说明的 budget 写成 {"tier":"${row.budget}","reason":"……","at_once":同屏大概会出现几个}，档位不是指标，用不满也没关系。`
}

/**
 * broad5 w3: a model made for a 精细 creature at the 精细 budget, using less than that budget, was told at every look to lower
 * the budget to 普通 — while the part sheet was refused below 精细. The budget a tier asks for is a floor the person chose on the
 * blueprint, never a target, so it is answered on the sheet in the tier's own words (the `budget:unused` justification the
 * look already reads), and the advice to step down is not given. Null when the creature's tier asks for no more than the default.
 */
export function tierBudgetKept(entries: readonly TieredEntry[], key: string): { tier: GeometryTier; reason: string } | null {
  const owner = governing(entries, key)
  if (!owner || entries.find((value) => value.key === key)?.kind !== "model") return null
  const row = tierOf(owner)
  if (GEOMETRY_TIER_IDS.indexOf(row.budget) <= 0) return null
  // Two different things were one word (broad19: 「预算是蓝图要求的下限；预算只是上限」 called one number both a floor and a ceiling). The geometry budget is a ceiling on
  // how many blocks may be used; what the blueprint asks is a floor on how detailed the model is, and that is the tier's detail level (broad20: `effectiveDetail`), not
  // a budget name. Each is said once, as itself, and no cube count is repeated here: the one range the maker aims for is in its instructions.
  return { tier: row.budget, reason: `蓝图上把「${owner.title}」定为「${row.label}」档：模型至少按「${MODEL_COMPLEXITY_PRESETS[row.complexity].label}」精细度做；部件说明里的几何预算写到「${GEOMETRY_TIERS[row.budget].name}」档，那只是方块数的上限，用不满不算错，所以方块少也不降档。` }
}

/**
 * Tiers in a plan an AI wrote, settled: the person's choice is theirs alone. An entry the held plan (the one the person last saw)
 * has a tier of the person's for keeps that tier whatever the new plan says (changed or dropped); a tier written `by: "you"` anywhere
 * else was the AI speaking for the person and is shown as the AI's own.
 */
export function settleTiers<Entry extends TieredEntry>(entries: readonly Entry[], held: readonly TieredEntry[] | undefined): Entry[] {
  return entries.map((entry) => {
    if (entry.kind !== "entity") return entry
    const kept = held?.find((before) => before.key === entry.key && before.kind === "entity" && before.tier?.by === "you")?.tier
    if (kept) return { ...entry, tier: kept }
    return entry.tier?.by === "you" ? { ...entry, tier: { ...entry.tier, by: "ai" as const } } : entry
  })
}

/**
 * The tiers as words, always from the table above, so that a text which lists them (the hand-off to an outside AI, an error, a comment about
 * "how many") can never fall a tier behind the table, as three hand-written lists did when the fifth tier was added.
 * - `labels`: the person's words in order, "简单、标准、精细、Boss、史诗"; `either`: the same with the last one after 还是.
 * - `ids`: the level ids as a type, `'simple' | 'standard' | …`; `named`: id and label, "simple（简单）、…或 epic（史诗）".
 * - `count`: how many, in Chinese ("五"), for a text that counts the buttons on the blueprint card (one for each tier).
 * - `strict`: the tiers whose review a simple wording cannot relax (`relaxes` false); `budgeted`: the tiers whose geometry budget is above the usual one,
 *   so a part sheet cannot name a lower one (`budget` is not "standard"). Both read "精细、Boss、史诗" today and are kept apart because they say different things.
 */
export const TIER_WORDS = (() => {
  const labels = CREATURE_TIER_LEVELS.map((id) => CREATURE_TIERS[id].label)
  const numerals = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"]
  const last = labels.length - 1
  return {
    labels: labels.join("、"),
    either: `${labels.slice(0, last).join("、")}还是${labels[last]}`,
    ids: CREATURE_TIER_LEVELS.map((id) => `'${id}'`).join(" | "),
    named: `${CREATURE_TIER_LEVELS.slice(0, last)
      .map((id) => `${id}（${CREATURE_TIERS[id].label}）`)
      .join("、")}或 ${CREATURE_TIER_LEVELS[last]}（${labels[last]}）`,
    count: numerals[CREATURE_TIER_LEVELS.length] ?? String(CREATURE_TIER_LEVELS.length),
    strict: CREATURE_TIER_LEVELS.filter((id) => !CREATURE_TIERS[id].relaxes)
      .map((id) => CREATURE_TIERS[id].label)
      .join("、"),
    budgeted: CREATURE_TIER_LEVELS.filter((id) => CREATURE_TIERS[id].budget !== "standard")
      .map((id) => CREATURE_TIERS[id].label)
      .join("、"),
  } as const
})()

/** The planner's brief about tiers: how to choose, what to write, what to keep. The words that choose are the only word lists in the feature. */
export const TIER_PLANNER_RULE =
  `生物档位：蓝图里每个生物条目（kind 是 entity 的）都要写 tier: { level, reason, by }，其他种类的条目不要写 tier。level 是下面五个之一，它决定这只生物的模型做到多细、要有哪些动作、验收多严：` +
  `${CREATURE_TIER_LEVELS.map((id) => `${id}（${CREATURE_TIERS[id].label}，${CREATURE_TIERS[id].use}；${clipsPhrase(CREATURE_TIERS[id])}）`).join("；")}。` +
  `怎么选：用户原话里说了史诗、超巨型、终极生物、最终考验、像宣传片里的龙这一类的（要的是整个模组里只有一只的终极生物），选 epic；说了 Boss、首领、最终、霸主这一类的，选 boss；说了精细、高质量、细节、大型这一类的，选 fine；说了简单、低模这一类的，选 simple；都没说，选 standard。` +
  `原话没提、但它显然是整场战斗的主角，或是同屏只有几个、会被走近了看的大家伙，也可以选 boss 或 fine，理由里写清楚是你判断的。` +
  `by 一律写 "ai"，reason 写一句给用户看的理由，引用原话里的依据（例如「你说了『最终 Boss』」）或它的特点（例如「它有 3 个招式、比玩家高三倍」）。` +
  `拿不准的时候（例如可能是 Boss 也可能是普通坐骑），仍然写下你的判断，同时在 questions 里问用户一句。` +
  `输入的 current 里 by 为 "you" 的 tier 是用户自己选的，原样保留（level、reason、by 都不改）。用户点确认之后档位才生效。`

/** For a capability list: every tier of the table and what each asks, from the same table the app uses. */
export const CREATURE_TIER_CAPABILITY = {
  default: "standard",
  rule: "蓝图里每个生物条目（kind 为 entity）可以带 tier: { level, reason, by }；没有 tier 的按 standard。AI 只能写 by 为 ai；用户在蓝图卡片上选的 by 为 you，AI 重新规划时原样保留。用户确认蓝图以后档位生效。非生物条目不能写 tier。",
  tiers: Object.fromEntries(
    CREATURE_TIER_LEVELS.map((id) => [
      id,
      {
        label: CREATURE_TIERS[id].label,
        use: CREATURE_TIERS[id].use,
        geometry_budget: CREATURE_TIERS[id].budget,
        model_complexity: CREATURE_TIERS[id].complexity,
        required_clips: [...CREATURE_TIERS[id].clips, ...(CREATURE_TIERS[id].death ? ["death"] : [])],
        attack_when_melee_without_abilities: CREATURE_TIERS[id].attack,
        min_abilities_when_hostile: CREATURE_TIERS[id].abilities,
        review_relaxed_by_simple_wording: CREATURE_TIERS[id].relaxes,
        six_views_first: CREATURE_TIERS[id].sixViews,
        six_views_required: CREATURE_TIERS[id].sixViewsRequired,
        six_view_style: CREATURE_TIERS[id].sixViewStyle,
        hitbox_required: CREATURE_TIERS[id].hitbox,
        recommended_models: CREATURE_TIERS[id].models,
        // broad21: the list the card, the claimed task, the review and the reminder before packing all read.
        asks: tierAsks(id).filter((ask) => ask.required).map((ask) => ask.full),
        open: tierAsks(id).filter((ask) => !ask.required).map((ask) => ask.full),
      },
    ]),
  ),
  effects: [
    "任务说明里写明档位和要求",
    "模型的部件说明里 budget 不能低于这一档的几何预算",
    `模型的精细度：${DETAIL_WORDS.told}`,
    `${TIER_WORDS.strict}的验收不因原话里的「简单」放宽`,
    "各档要有什么是同一张清单（creature_tiers 里每档的 asks 和 open）：蓝图卡片选档位的地方、claim_task 的任务说明、审查员的审查范围、打包前的提醒，读的都是它；open 里的是可有可无的，没有不算缺",
    "打包前对账：精细和 Boss 缺了这一档必须有的动作只提醒、不拦打包；史诗档缺了必须有的东西会拦住打包，并写明怎么补",
    "Boss 档：生物要写 boss（血条和死亡演出必须有；登场、阶段（0 到 3 个）、离开重置、巢可有可无）、至少一个招式用晃屏或碎块、每个招式有预警；缺了只提醒、不拦打包",
    `史诗档：几何预算 epic（32 个动作），开工前必须有六视图，敌对的同时是 Boss，至少 3 个招式（最多 ${EPIC_LIMITS.abilities} 个，每招出手最多 ${EPIC_LIMITS.hits} 次，连招最多 ${EPIC_LIMITS.combos} 个；别的档 ${ABILITY_LIMITS.abilities}、${ABILITY_LIMITS.hits}、${COMBO_LIMITS.combos}，超了拦住打包），必须写分部位的碰撞箱，要飞的写 flight、有习性的写 habits（缺了必须有的动作、碰撞箱会拦住打包，Boss 的部分只提醒）；做东西和审查都推荐 GPT 6 Astra 最高推理档`,
  ],
}

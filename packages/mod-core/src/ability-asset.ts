import { CAST_COMBAT_GUIDE } from "./combat-design-words"
import { abilityExamples } from "./ability-examples"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { abilityRef, assetRef, registryRef } from "./finding-refs"
import { ParticleAliasesSchema, aliasIssues, emitIssues, missingParticleRefs, particleDependencies, resolveAliases, type ParticleAliases } from "./particle-emission"
import { abilitiesUseArena } from "./arena"
import { moveAimsAtFixture } from "./fixture-events"
import { casterGuide, casterLine, casterLimits } from "./ability-casters"
import { CastInterruptSchema, OMNI_START_INSTRUCTIONS } from "./combat"
import { stanceEventIssues, stanceLeaveIssues } from "./stances"
import { z } from "zod"
import type { StandardOutline } from "@minemods/studio-ai/acceptance"
import { ABILITY_EFFECTS, ABILITY_LIMITS, ABILITY_PARTICLES, ABILITY_PROJECTILES, ABILITY_SOUND_IDS, ABILITY_SOUNDS, EPIC_LIMITS, TICKS, type AbilityEffect, type AbilityParticle } from "./ability-words"
import { type AbilityMove } from "./ability-dash"
import { SoundRangeSchema } from "./sound-range"
import { earlyLanding, landingTick } from "./hit-origin"
import { onceIssues } from "./once-group"
import { groundEventWords, groundFxCadenceIssue } from "./ground-fx"
import { ToneSchema, SoundAssetRefSchema, isSoundAsset } from "./sound"
import { AbilityHitSchema, AbilityEventSchema, HitPlaceSchema, AbilityShapeSchema, AbilitySchema, type Ability, type AbilityEvent, type AbilityHit, type SharedAbilityUse, type Stances } from "./entity-runtime"
import { lacksOf } from "./version-lacks"
import { SCALE_LIMITS, scaledTimeline, scaleFactors, scaleWords } from "./ability-scale"

/** Shared creature timelines plus the cast controls, bindings and scaling used by items and blocks. */

/** How much an ability asset may be. `reach`: how far it finds its target and its point (blocks). `level`: the level its numbers are counted at, at most. */
export const CAST_LIMITS = {
  charge: { min: 0.1, max: 10 },
  channel: { min: 0.5, max: 30 },
  every: { min: 1, max: 100 },
  cooldown: 600,
  recasts: 5,
  window: { min: 0.5, max: 30 },
  reach: { min: 2, max: 64 },
  hits: 6,
  events: 16,
  moves: 4,
  bindings: 8,
  sources: 3,
  level: 1000,
  heal: 1024,
  /** The fewest ticks between two pulses of a channel that deals damage: the game's own invulnerability after a hurt swallows a second hurt within 10 ticks. */
  hurt_gap: 10,
} as const

export const CAST_TYPES = { instant: "瞬发", charge: "蓄力", channel: "持续施法" } as const
export const CANCEL_IDS = ["move", "hurt", "swap"] as const
export const CANCEL_WORDS: Record<(typeof CANCEL_IDS)[number], string> = { move: "走动", hurt: "挨打", swap: "换手里的东西" }

/** Status effects an ability asset's hit may leave: the creatures' harmful ones, and the helpful ones a spell on allies gives. `java` is the `MobEffects` constant (1.20.1 and 1.21.1 alike). */
export const ASSET_EFFECTS = {
  slowness: { name: ABILITY_EFFECTS.slowness, java: "MOVEMENT_SLOWDOWN", creature: true },
  blindness: { name: ABILITY_EFFECTS.blindness, java: "BLINDNESS", creature: true },
  poison: { name: ABILITY_EFFECTS.poison, java: "POISON", creature: true },
  weakness: { name: ABILITY_EFFECTS.weakness, java: "WEAKNESS", creature: true },
  regeneration: { name: "生命恢复", java: "REGENERATION", creature: false },
  speed: { name: "迅捷", java: "MOVEMENT_SPEED", creature: false },
  strength: { name: "力量", java: "DAMAGE_BOOST", creature: false },
  resistance: { name: "抗性提升", java: "DAMAGE_RESISTANCE", creature: false },
  absorption: { name: "伤害吸收", java: "ABSORPTION", creature: false },
} as const
export type AssetEffect = keyof typeof ASSET_EFFECTS
const ASSET_EFFECT_IDS = Object.keys(ASSET_EFFECTS) as [AssetEffect, ...AssetEffect[]]


/**
 * A number that may grow: a plain number, or `{base, per_level}` — `base` plus `per_level` for every level the caster has (what `scaling.scales_with` counts). Its bounds are the
 * field's: `base` within them, and what it comes to at any level is held to them by the runtime.
 */
const scalable = (min: number, max: number) => z.union([z.number().finite().min(min).max(max), z.strictObject({ base: z.number().finite().min(min).max(max), per_level: z.number().finite().min(-max).max(max) })])
export type Scalable = number | { base: number; per_level: number }
export const scalarBase = (value: Scalable) => (typeof value === "number" ? value : value.base)
export const scalarPer = (value: Scalable) => (typeof value === "number" ? 0 : value.per_level)
export const isScaled = (value: Scalable | null | undefined) => value !== null && value !== undefined && typeof value !== "number"
/** What a number comes to at `level`, within `[min, max]`. The generated runtime counts the same way (`StudioAbilities.scaled`). */
export const scaledAt = (value: Scalable, level: number, min: number, max: number) => Math.min(max, Math.max(min, scalarBase(value) + scalarPer(value) * level))

export const AssetShapeSchema = AbilityShapeSchema
export type AssetShape = z.infer<typeof AssetShapeSchema>
export const AssetPlaceSchema = HitPlaceSchema
export type AssetPlace = z.infer<typeof AssetPlaceSchema>

// A cast may gain power with the player's level and may help allies. The creature owns every other field.
const [area, shot, ...otherHits] = AbilityHitSchema.options
const statusEffect = area.shape.effects.element
export const AssetHitSchema = z.discriminatedUnion("type", [
  area.extend({
    hits: z.enum(["target", "everyone", "allies"]),
    damage: scalable(0, ABILITY_LIMITS.damage),
    heal: scalable(0, CAST_LIMITS.heal).optional(),
    knockback: scalable(-ABILITY_LIMITS.knockback, ABILITY_LIMITS.knockback),
    effects: z.array(statusEffect.extend({ effect: z.enum(ASSET_EFFECT_IDS) })).max(ABILITY_LIMITS.effects),
  }),
  shot.extend({ damage: scalable(0, ABILITY_LIMITS.damage).nullable() }),
  ...otherHits,
])
export type AssetHit = z.infer<typeof AssetHitSchema>

// These three legacy cast events accepted shorter spellings than a creature. Keep those defaults at the asset boundary.
const [feedback, camera, sky, sound, particle, effect, trail, shake, debris, destroy, lightning, drop, fixture, fog, flash, hazard, ...otherEvents] = AbilityEventSchema.options
export const AssetEventSchema = z.discriminatedUnion("type", [
  feedback, camera, sky, sound.extend({ sound_alias: z.string().min(1).max(64).optional() }),
  particle.extend({ where: particle.shape.where.unwrap().default("self") }),
  effect.extend({ hit: effect.shape.hit.optional(), count: effect.shape.count.default(1), layout: effect.shape.layout.default("ring"), spread: effect.shape.spread.default(0) }),
  trail, shake, debris, destroy, lightning, drop, fixture, fog, flash,
  hazard.extend({ hit: hazard.shape.hit.default(null) }),
  ...otherEvents,
])
export type AssetEvent = z.infer<typeof AssetEventSchema>

export function moveEnd(move: AbilityMove) {
  if (!("type" in move)) return move.at
  return move.type === "dash" ? move.to : move.type === "leap" ? move.land : move.back.at
}

export const CastSchema = z.strictObject({
  interrupt: CastInterruptSchema.optional(),
  release: z.strictObject({
    min_seconds: z.number().min(0.05, "松手放出前至少蓄 0.05 秒。").max(10, "最短蓄力不能超过 10 秒。"),
  }).optional(),
  type: z.enum(["instant", "charge", "channel"]),
  /** Seconds it charges for (charge), or holds at most (channel); 0 for instant. */
  seconds: z.number().finite().min(0).max(CAST_LIMITS.channel.max),
  /** Channel only: every this many ticks the timeline is played again (a pulse), from the first tick on. */
  tick_every: z.number().int().min(CAST_LIMITS.every.min).max(CAST_LIMITS.every.max).optional(),
  /** Seconds after it ends before the same caster may cast it again; may grow. */
  cooldown: scalable(0, CAST_LIMITS.cooldown),
  /** It may be cast `count` more times within `within` seconds of the first before its wait begins. */
  recasts: z.strictObject({ count: z.number().int().min(1).max(CAST_LIMITS.recasts), within: z.number().finite().min(CAST_LIMITS.window.min).max(CAST_LIMITS.window.max) }).optional(),
  /** What interrupts it while it is cast: the caster walking off (half a block), being hurt, or changing what it holds. */
  cancel_on: z.array(z.enum(CANCEL_IDS)).max(CANCEL_IDS.length).optional(),
})
export type Cast = z.infer<typeof CastSchema>

const LocalIdentifierSchema = z.string().trim().regex(/^[a-z][a-z0-9_]{0,63}$/, "本工程的物品和方块用它的标识符（identifier）写：小写字母开头，只含小写字母、数字和下划线")

export const BindingSchema = z.discriminatedUnion("type", [
  /** A player holding this project's item casts it: `click` with one right click, `hold` while right click is held (letting go ends a channel and calls off a charge). */
  z.strictObject({ type: z.literal("item"), item: LocalIdentifierSchema, use: z.enum(["click", "hold"]) }),
  /** A player pressing the key of this project's cast action (a gesture asset) casts it; the action plays. */
  z.strictObject({ type: z.literal("gesture"), gesture: z.uuid() }),
  /** A player right-clicking this project's block makes the block cast it, from where it stands, sparing that player and its allies. */
  z.strictObject({ type: z.literal("block"), block: LocalIdentifierSchema, trigger: z.enum(["click", "step"]).optional(), who: z.enum(["players", "living"]).optional() }),
])
export type Binding = z.infer<typeof BindingSchema>

/** `attribute:<namespace>:<path>`: an attribute of the caster (`attribute:minecraft:generic.attack_damage`); `level`: a player's experience level. */
export const ScaleSourceSchema = z.union([z.literal("level"), z.string().regex(/^attribute:[a-z0-9_.-]+:[a-z0-9_./-]+$/, '写 "level"（玩家的经验等级）或者 "attribute:命名空间:属性名"（例如 "attribute:minecraft:generic.attack_damage"）')])

export const AbilityAssetDocumentSchema = z
  .strictObject({
    kind: z.literal("ability"),
    particles: ParticleAliasesSchema.optional(),
    name: z.string().trim().min(1).max(40),
    english_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 '-]{0,39}$/, "英文名只能有英文字母、数字、空格、' 和 -，最多 40 个字"),
    cast: CastSchema,
    /** A cast action (gesture asset) a player plays when casting it. */
    gesture: z.uuid().optional(),
    /** Heard at the caster: when it starts, every second while it charges or is held, and when it ends as it should (not when it is interrupted). */
    sound_ranges: z.strictObject({ start: SoundRangeSchema.optional(), loop: SoundRangeSchema.optional(), end: SoundRangeSchema.optional() }).optional(),
    sounds: z.strictObject({ start: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema]).optional(), loop: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema]).optional(), end: z.union([z.enum(ABILITY_SOUND_IDS), SoundAssetRefSchema]).optional() }).optional(),
    loop_pitch: z.strictObject({ from: ToneSchema, to: ToneSchema }).optional(),
    /** Blocks: how far a player's crosshair finds its target and its point, and how far a block or a creature looks for one. */
    reach: z.number().finite().min(CAST_LIMITS.reach.min).max(CAST_LIMITS.reach.max),
    hits: z.array(AssetHitSchema).min(1).max(EPIC_LIMITS.hits),
    events: z.array(AssetEventSchema).max(Math.max(CAST_LIMITS.events, ABILITY_LIMITS.events)),
    moves: AbilitySchema.shape.moves,
    stages: AbilitySchema.shape.stages,
    length: AbilitySchema.shape.length.optional(),
    bindings: z.array(BindingSchema).max(CAST_LIMITS.bindings),
    /** What the caster's level is counted from, for every number written `{base, per_level}`: added up, at most `CAST_LIMITS.level`. */
    scaling: z.strictObject({ scales_with: z.array(ScaleSourceSchema).min(1).max(CAST_LIMITS.sources) }).optional(),
  })
  .superRefine((ability, context) => abilityAssetDocumentIssues(ability).forEach((issue) => context.addIssue({ code: "custom", ...issue })))
export type AbilityAssetDocument = z.infer<typeof AbilityAssetDocumentSchema>
type Shaped = Omit<AbilityAssetDocument, "kind"> & { kind?: "ability" }

/** Every scalable number of an ability asset, with where it is and whether the server's power multiplier (`power` of the config) counts on it. */
export function scalables(ability: Pick<Shaped, "cast" | "hits">) {
  return [
    { path: ["cast", "cooldown"], value: ability.cast.cooldown as Scalable, what: "cooldown" as const, power: false },
    ...ability.hits.flatMap((hit, index) =>
      hit.type === "area"
        ? [
            { path: ["hits", index, "damage"], value: hit.damage as Scalable, what: "damage" as const, power: true },
            ...(hit.heal === undefined ? [] : [{ path: ["hits", index, "heal"], value: hit.heal as Scalable, what: "heal" as const, power: true }]),
            { path: ["hits", index, "knockback"], value: hit.knockback as Scalable, what: "knockback" as const, power: false },
          ]
        : hit.type !== "shot" || hit.damage === null
          ? []
          : [{ path: ["hits", index, "damage"], value: hit.damage as Scalable, what: "damage" as const, power: true }],
    ),
  ]
}

/** The tick of a moment, as the runtime counts it. */
export const castTick = (seconds: number) => Math.round(seconds * TICKS)
/** Ticks of the timeline: one past the last moment of a hit, an event or a push. */
export const timelineTicks = (ability: Pick<Shaped, "hits" | "events" | "moves">) => Math.max(0, ...ability.hits.map((hit) => castTick(hit.at)), ...ability.events.map((event) => castTick("until" in event ? event.until ?? event.at : event.at)), ...ability.moves.map((move) => castTick(moveEnd(move)))) + 1

/** What the field types cannot say about one ability asset on its own. */
export function abilityAssetDocumentIssues(ability: Shaped): { path: (string | number)[]; message: string }[] {
  const cast = ability.cast
  const issues = [...aliasIssues(ability), ...emitIssues(ability.events, ABILITY_LIMITS.seconds, ability.hits, cast.type === "channel" && cast.tick_every ? Math.ceil(castTick(cast.seconds) / cast.tick_every) : 1)]
  const limits = casterLimits(ability)
  if (ability.bindings.length && limits.generic.length) issues.push({ path: ["bindings"], message: "玩家和方块用不了" + limits.generic.join("、") + "。请去掉绑定、去掉这项写法，或另存一份给生物用。" })
  const add = (path: (string | number)[], message: string) => issues.push({ path, message })
  ability.events.forEach((event,i)=>{
    if (event.type==="particle" || !("where" in event) || !("hit" in event)) return
    if ((event.where==="hit") !== (event.hit!=null)) {issues.push({path:["events",i,"hit"],message:"引用出手落点时要填从 0 开始的出手序号，其余位置不填。"});return}
    if(event.hit==null)return
    const hit=ability.hits[event.hit]
    if(hit?.type!=="area") {issues.push({path:["events",i,"hit"],message:"需要指向已有的范围出手。"});return}
    const tick=landingTick(hit)
    if(castTick(event.at)<tick && (ability.length === undefined || ability.bindings.length))issues.push({path:["events",i,"at"],message:earlyLanding(event.hit,tick)})
  })
  issues.push(...onceIssues(ability.hits,"hits"),...onceIssues(ability.events,"events"))
  if (cast.release) {
    if (cast.type !== "charge" || cast.release.min_seconds > cast.seconds) add(["cast", "release"], "松手释放请选择 charge，最短蓄力 min_seconds 不能比蓄满时间 seconds 长。")
    if (ability.bindings.some(b => b.type !== "item" || b.use !== "hold")) add(["bindings"], "松手释放要绑在物品上，use 选 hold，按住蓄力后松手放出。")
  }
  if (ability.loop_pitch && (!ability.sounds?.loop || cast.type === "instant" || ability.loop_pitch.to <= ability.loop_pitch.from))
    add(["loop_pitch"], "循环升调需要 charge 或 channel 和 sounds.loop，终点音高 to 要高于起点 from。")
  if (cast.type === "instant" && cast.seconds !== 0) add(["cast", "seconds"], "瞬发（instant）的技能没有蓄力或持续的时间，seconds 写 0")
  if (cast.type === "charge" && (cast.seconds < CAST_LIMITS.charge.min || cast.seconds > CAST_LIMITS.charge.max)) add(["cast", "seconds"], `蓄力（charge）的时间 seconds 写 ${CAST_LIMITS.charge.min}–${CAST_LIMITS.charge.max} 秒`)
  if (cast.type === "channel" && cast.seconds < CAST_LIMITS.channel.min) add(["cast", "seconds"], `持续施法（channel）最长持续多久 seconds 写 ${CAST_LIMITS.channel.min}–${CAST_LIMITS.channel.max} 秒`)
  if ((cast.type === "channel") !== (cast.tick_every !== undefined)) add(["cast", "tick_every"], cast.type === "channel" ? "持续施法（channel）要写 tick_every：每隔多少刻（1 秒 20 刻）再放一次时间线" : "只有持续施法（channel）写 tick_every")
  ability.events.forEach((e, i) => {
    if (e.type !== "hazard") return
    if (e.growth && e.growth.max_radius < e.radius) add(["events", i, "growth", "max_radius"], "最大半径要达到起始半径 radius。")
    const cadence = groundFxCadenceIssue(e)
    if (cadence) add(["events", i, ...cadence.path], cadence.message)
  })
  const timeline = timelineTicks(ability)
  if (cast.type === "channel" && cast.tick_every !== undefined && timeline > cast.tick_every)
    add(["cast", "tick_every"], `持续施法每 ${cast.tick_every} 刻放一次时间线，时间线里最晚的一刻（at）要早于 ${cast.tick_every} 刻（${(cast.tick_every / TICKS).toFixed(2)} 秒）：现在最晚在第 ${timeline - 1} 刻`)
  const damaging = ability.hits.some((hit) => (hit.type === "area" ? scalarBase(hit.damage) > 0 || scalarPer(hit.damage) > 0 : hit.type !== "shot" || hit.damage !== null || hit.projectile !== "snowball"))
  if (cast.type === "channel" && cast.tick_every !== undefined && cast.tick_every < CAST_LIMITS.hurt_gap && damaging)
    add(["cast", "tick_every"], `持续施法会伤人时 tick_every 至少写 ${CAST_LIMITS.hurt_gap}：游戏里一个生物挨打以后 10 刻内再挨同样的伤害不算数，间隔更短的那几下会被吞掉`)
  if (cast.type === "channel" && cast.tick_every !== undefined && cast.tick_every > castTick(cast.seconds)) add(["cast", "tick_every"], "tick_every 比整个持续时间还长：只会放一次，写成瞬发（instant）")
  if (cast.interrupt) {
    if (!cast.cancel_on?.includes("hurt")) add(["cast", "cancel_on"], "写了 interrupt 的技能，要把 hurt 加进 cancel_on。")
    if (cast.interrupt.part) add(["cast", "interrupt", "part"], "玩家施法没有碰撞箱部位，删掉 part。生物引用这个技能时可以指定部位。")
    const length = cast.type === "channel" ? cast.seconds : cast.seconds + timeline / TICKS
    if ((cast.interrupt.to ?? length) > length || (cast.interrupt.from ?? 0) >= length) add(["cast", "interrupt"], "打断时间从按下施法算起，请把范围放在施法结束前。")
  }
  ;(cast.cancel_on ?? []).forEach((reason, index, all) => all.indexOf(reason) !== index && add(["cast", "cancel_on", index], `cancel_on 里「${reason}」写了两次`))
  ability.hits.forEach((hit, index) => {
    if (hit.type === "shot" && ABILITY_PROJECTILES[hit.projectile].damage !== (hit.damage !== null))
      add(["hits", index, "damage"], ABILITY_PROJECTILES[hit.projectile].damage ? "箭要写伤害（damage）" : `${ABILITY_PROJECTILES[hit.projectile].name}的伤害是原版定的，damage 写 null`)
    if (hit.type !== "area") return
    if (hit.shape.type === "arc" && (hit.shape.inner ?? 0) >= hit.shape.reach) add(["hits", index, "shape", "inner"], "空心环的内圈要小于外圈。")
    if (hit.shape.type === "arc" && hit.shape.low >= hit.shape.high) add(["hits", index, "shape", "high"], "弧形范围的上沿（high）要比下沿（low）高")
    if (hit.warn && (cast.type === "channel" || hit.warn.seconds > hit.at + (cast.type === "charge" ? cast.seconds : 0) + 1e-9)) add(["hits", index, "warn", "seconds"], "选点预警用于瞬发或蓄力技能，提前时间不能超过蓄力加出手等待的总时长。")
    const place = hit.place ?? "self"
    const placeable = hit.shape.type === "sphere" || hit.shape.type === "box" || (hit.shape.type === "arc" && hit.shape.angle >= 360)
    if (hit.shape.type !== "arena" && place !== "self" && !placeable) add(["hits", index, "place"], "只有球（sphere）、盒子（box）和一整圈的弧（arc，angle 写 360）能放到别处（place）：直线（line）和锥形（cone）从施法者身上朝它瞄的方向打")
    if (hit.hits === "allies" && scalarBase(hit.damage) > 0) add(["hits", index, "damage"], '只打自己人（hits 写 "allies"）的这一下不能伤人：damage 写 0，用 heal 或 effects')
    if (hit.hits !== "allies" && hit.heal !== undefined) add(["hits", index, "heal"], '治疗（heal）只给自己人：hits 写 "allies"')
    if (hit.hits === "allies" && hit.effects.some((effect) => ASSET_EFFECTS[effect.effect].creature)) add(["hits", index, "effects"], "给自己人的效果不能是变慢、看不清、中毒、变虚弱这些坏效果")
  })
  ability.moves.forEach((move, index) => moveEnd(move) > ABILITY_LIMITS.seconds && add(["moves", index, "at"], `位移的时刻（at）最晚 ${ABILITY_LIMITS.seconds} 秒`))
  const seen = new Set<string>()
  ability.bindings.forEach((binding, index) => {
    const key = binding.type === "item" ? `item:${binding.item}` : binding.type === "block" ? `block:${binding.block}` : `gesture:${binding.gesture}`
    if (seen.has(key)) add(["bindings", index], "同一个物品、方块或施法动作只绑一次")
    seen.add(key)
    if (binding.type === "block" && binding.who && binding.trigger !== "step") add(["bindings", index, "who"], "踩上去触发时可以选择谁能踩。")
    if (binding.type === "item" && binding.use === "hold" && cast.type === "instant") add(["bindings", index, "use"], '瞬发的技能按一下就放完了，use 写 "click"；"hold" 是按住蓄力或者持续施法')
    if (binding.type === "gesture" && ability.gesture !== undefined && ability.gesture !== binding.gesture) add(["gesture"], "按施法动作的键放的技能，放的就是那个动作：gesture 不写，或者写成同一个施法动作")
  })
  const scaled = scalables(ability).filter((entry) => isScaled(entry.value))
  if (scaled.length && !ability.scaling) add(["scaling"], "有数值写成了 {base, per_level}，要写 scaling.scales_with 说按什么成长")
  if (!scaled.length && ability.scaling) add(["scaling"], "写了 scaling，可是没有任何数值写成 {base, per_level}：去掉 scaling，或者把要成长的数值写成 {base, per_level}")
  ;(ability.scaling?.scales_with ?? []).forEach((source, index, all) => all.indexOf(source) !== index && add(["scaling", "scales_with", index], `「${source}」写了两次`))
  return issues
}

// ---- the project: what it is bound to and what it names ----

type AssetLike = { id: string; title?: string; document: { kind: string } }
type ProjectLike = {
  mod_id?: string
  items: readonly { id?: string; identifier: string; name: string }[]
  blocks: readonly { id?: string; identifier: string; name: string }[]
  entities: readonly { id: string; name: string; behavior: string; boss?: unknown; stances?: Stances | undefined; particles?: ParticleAliases; abilities?: readonly Ability[] | null; combos?: readonly { id: string }[] | null; shared_abilities?: readonly SharedAbilityUse[] | null }[]
  workspace: { assets: readonly AssetLike[] }
}

const MISSING_PARTICLE_ALIAS = "技能里有找不到的粒子别名，请先改技能的粒子引用。"
const withUseParticles = (document: AbilityAssetDocument, use: SharedAbilityUse) =>
  use.particles ? { ...document, particles: { ...document.particles, ...use.particles } } : document

/** Project references must be checked before aliases or shared casts are expanded by the generator. */
export function abilityParticleFindings(project: ProjectLike) {
  const assets = project.workspace.assets
  const skills = new Map(assets.flatMap(asset => asset.document.kind === "ability" ? [[asset.id, asset.document as AbilityAssetDocument] as const] : []))
  const particles = new Set(assets.filter(asset => asset.document.kind === "particle").map(asset => asset.id))
  type Timeline = Pick<AbilityAssetDocument, "particles"> & { hits: readonly { at: number }[]; events: readonly { at: number }[] }
  type About = { kind: "entity" | "ability"; id: string; name: string }
  const check = (timeline: Timeline, about: About, title: string, refs: FindingRef[], override?: ParticleAliases) =>
    missingParticleRefs(timeline, id => particles.has(id), about.kind === "ability")
      // The skill already reports its own missing references; a creature reports what its overrides break.
      .filter(({ alias }) => !override || !!alias && Object.hasOwn(override, alias))
      .map(({ path, name, asset }) => {
        const [part, index] = path
        const row = typeof index === "number" ? (part === "events" ? timeline.events : timeline.hits)[index] : undefined
        const where = typeof index === "number"
          ? `第 ${index + 1} ${part === "events" ? "个事件" : "次出手"}${row ? `（第 ${row.at} 秒）` : ""}`
          : "的别名表"
        return {
          rule: "particle_reference" as const, stops: true, about,
          refs: [...refs, ...(asset ? [assetRef(asset, "找不到的粒子")] : [])],
          text: `${title}${where}找不到粒子「${name}」。`,
          fix: "把这一处的粒子换成可用的原版粒子或本工程的粒子，或者先补上对应的粒子别名。",
          detail: path.join("."),
        }
      })
  return [
    ...[...skills].flatMap(([id, document]) =>
      check(document, { kind: "ability", id, name: document.name }, `技能「${document.name}」`, [abilityRef({ id, name: document.name }), assetRef(id, document.name)])),
    ...project.entities.flatMap(entity => {
      const about = { kind: "entity" as const, id: entity.id, name: entity.name }
      return [
        ...(entity.abilities ?? []).flatMap(move => check({ ...move, particles: entity.particles }, about, `「${entity.name}」的招式「${move.name}」`, [abilityRef(move)])),
        ...(entity.shared_abilities ?? []).flatMap(use => {
          const skill = skills.get(use.asset)
          if (!skill || !use.particles || entity.abilities?.some(move => move.id === use.id)) return []
          return check(withUseParticles(skill, use), about, `「${entity.name}」的招式「${skill.name}」`, [abilityRef({ id: use.id, name: skill.name }), assetRef(use.asset, skill.name)], use.particles)
        }),
      ]
    }),
  ]
}

/** The ability assets of a project, each with its id and document. */
export function abilityAssets(project: Pick<ProjectLike, "workspace">, strict = true) {
  return project.workspace.assets.flatMap((asset) => (asset.document.kind === "ability" ? [{ id: asset.id, document: resolveAliases(asset.document as AbilityAssetDocument, strict) }] : []))
}

/** The effect, sound and cast action assets an ability asset names, each a dependency of it. */
export function abilityAssetNames(document: Pick<AbilityAssetDocument, "events" | "sounds" | "gesture" | "bindings" | "particles"> & Partial<Pick<AbilityAssetDocument, "hits">>) {
  const sounds = [...document.events.flatMap(event => (event.type === "sound" || event.type === "hit_fx") && isSoundAsset(event.sound) ? [event.sound.asset] : []), ...Object.values(document.sounds ?? {}).flatMap((sound) => (sound && isSoundAsset(sound) ? [sound.asset] : []))]
  return {
    effects: [...new Set([...document.events.flatMap(event => event.type === "effect" ? [event.effect] : event.type === "lightning" && event.look?.effect ? [event.look.effect] : event.type === "shockwave" && event.warn?.effect ? [event.warn.effect] : []), ...(document.hits ?? []).flatMap(h => h.type === "projectile" ? [...("effect" in h.look ? [h.look.effect] : []), ...(h.impact?.effect ? [h.impact.effect] : [])] : []), ...(document.hits ?? []).flatMap(h => h.type === "area" && h.warn?.effect ? [h.warn.effect] : [])])],
    sounds: [...new Set(sounds)],
    particles: particleDependencies(document),
    gestures: [...new Set([...(document.gesture ? [document.gesture] : []), ...document.bindings.flatMap((binding) => (binding.type === "gesture" ? [binding.gesture] : []))])],
  }
}

export type AbilityAssetIssue = { refs?: FindingRef[]; rule: "ability_asset"; stops: boolean; text: string; fix: string; detail?: string }

/**
 * What an ability asset is against the project and its target's game: the items, blocks and cast actions it is bound to are there and bound once in the whole project, the
 * effects, sounds and cast actions it names are those assets, and its vanilla resources exist in the target game. Particle references are checked by abilityParticleFindings.
 */
export function abilityAssetIssues(project: ProjectLike, asset: { id: string; document: AbilityAssetDocument }, minecraft: string): AbilityAssetIssue[] {
  const name = asset.document.name
  const stop = (text: string, fix: string, detail?: string, refs: FindingRef[] = []): AbilityAssetIssue => ({ rule: "ability_asset", stops: true, text, fix, refs: [assetRef(asset.id, name), ...refs], ...(detail ? { detail } : {}) })
  const kindOf = (id: string) => project.workspace.assets.find((value) => value.id === id)?.document.kind
  const others = abilityAssets(project, false).filter((other) => other.id !== asset.id)
  const named = abilityAssetNames(asset.document)
  return [
    ...asset.document.bindings.flatMap((binding) => {
      if (binding.type === "item") {
        const bound = project.items.find(entry => entry.identifier === binding.item)
        if (!bound) return [stop(`技能「${name}」选的物品在这个工程里找不到。`, "绑到本工程里有的物品，或者先做出这个物品。", binding.item)]
        const twin = others.find((other) => other.document.bindings.some((value) => value.type === "item" && value.item === binding.item))
        return twin ? [stop(`物品「${bound.name}」同时绑了技能「${name}」和「${twin.document.name}」：右键的时候不知道放哪一个。`, "一个物品只绑一个技能。", undefined, [...(bound.id ? [assetRef(bound.id, bound.name)] : []), assetRef(twin.id, twin.document.name)])] : []
      }
      if (binding.type === "block") {
        const bound = project.blocks.find(entry => entry.identifier === binding.block)
        if (!bound) return [stop(`技能「${name}」选的方块在这个工程里找不到。`, "绑到本工程里有的方块，或者先做出这个方块。", binding.block)]
        const twin = others.find((other) => other.document.bindings.some((value) => value.type === "block" && value.block === binding.block))
        return twin ? [stop(`方块「${bound.name}」同时绑了技能「${name}」和「${twin.document.name}」。`, "一个方块只绑一个技能。", undefined, [...(bound.id ? [assetRef(bound.id, bound.name)] : []), assetRef(twin.id, twin.document.name)])] : []
      }
      const twin = others.find((other) => other.document.bindings.some((value) => value.type === "gesture" && value.gesture === binding.gesture))
      return twin ? [stop(`同一个施法动作同时绑了技能「${name}」和「${twin.document.name}」。`, "一个施法动作只绑一个技能。", undefined, [assetRef(binding.gesture), assetRef(twin.id, twin.document.name)])] : []
    }),
    ...named.gestures.filter((id) => kindOf(id) !== "gesture").map((id) => stop(`技能「${name}」用到的施法动作找不到了（或者那不是一个施法动作资产）。`, "gesture 和绑定里的 gesture 写本工程里施法动作资产的 id，并让技能依赖它。", undefined, [assetRef(id)])),
    ...named.effects.filter((id) => kindOf(id) !== "effect").map((id) => stop(`技能「${name}」放的效果找不到了（或者那不是一个效果资产）。`, "effect 事件写本工程里效果资产的 id，并让技能依赖它。", undefined, [assetRef(id)])),
    ...named.sounds.filter((id) => kindOf(id) !== "sound").map((id) => stop(`技能「${name}」放的声音找不到了（或者那不是一个声音资产）。`, "声音写原版的声音名，或者 {asset: 本工程声音资产的 id}，并让技能依赖它。", undefined, [assetRef(id)])),
    ...versionGapDetails(asset.document, minecraft).map(({ text, ref }) => stop(text, `换成 ${minecraft} 也有的，或者用 1.21.1 的目标构建。`, undefined, [ref])),
  ]
}

/** The vanilla particles and sounds an ability asset names that the game version lacks (`VERSION_LACKS`), each as a sentence. */
function versionGapDetails(owner: Pick<AbilityAssetDocument, "name" | "events" | "sounds" | "particles">, minecraft: string) {
  const document = resolveAliases(owner, false)
  const lacks = lacksOf(minecraft)
  const sounds = [...document.events.flatMap((event) => (event.type === "sound" ? [event.sound] : [])), ...Object.values(document.sounds ?? {}).flatMap((sound) => (sound ? [sound] : []))]
  return [
    ...[...new Set(document.events.flatMap((event) => ((event.type === "particle" || event.type === "hazard") && typeof event.particle === "string" && lacks.particles.includes(event.particle) ? [event.particle] : [])))].map((particle) => ({ ref: registryRef(particle, ABILITY_PARTICLES[particle as AbilityParticle]), text: `技能「${document.name}」用了原版的「${ABILITY_PARTICLES[particle as AbilityParticle]}」粒子（${particle}），Minecraft ${minecraft} 里还没有这个粒子。` })),
    ...[...new Set(sounds.flatMap((sound) => (typeof sound === "string" && lacks.sounds.includes(sound) ? [sound] : [])))].map((sound) => ({ ref: registryRef(sound, ABILITY_SOUNDS[sound]), text: `技能「${document.name}」用了原版的「${ABILITY_SOUNDS[sound]}」声音（${sound}），Minecraft ${minecraft} 里还没有这个声音。` })),
  ]
}

export const versionGaps = (...args: Parameters<typeof versionGapDetails>) => versionGapDetails(...args).map(({ text }) => text)

// ---- a creature that uses an ability asset ----

/** Whether an ability asset can be one of a creature's abilities, and if not why: a creature has no allies to heal or help. */
export const creatureUseGaps = (document: AbilityAssetDocument) => casterLimits(document).creature

function adaptReferences(value: unknown, use: SharedAbilityUse): unknown {
  if (!use.bones && use.damage_scale === undefined) return value
  if (Array.isArray(value)) return value.map(child => adaptReferences(child, use))
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === "bone" && typeof child === "string" && use.bones && Object.hasOwn(use.bones, child)) return [key, use.bones[child]]
    if (key === "damage" && typeof child === "number") return [key, child * (use.damage_scale ?? 1)]
    return [key, adaptReferences(child, use)]
  }))
}

const round = (seconds: number) => castTick(seconds) / TICKS

/**
 * One shared ability as one of the creature's own (`AbilitySchema`): the asset's timeline after `windup` (left out: its charge, or 0) — a channel's timeline once for every
 * pulse in its time — with its numbers at their base (a creature has no level). Null with the reason when it cannot be one: something only a player's spell has
 * (`creatureUseGaps`), or more than a creature's ability may hold, or what `AbilitySchema` refuses.
 */
export function sharedAbilityInline(use: SharedAbilityUse, document: AbilityAssetDocument): { ability: Ability; reason: null } | { ability: null; reason: string } {
  document = withUseParticles(document, use)
  if (aliasIssues(document).length) return { ability: null, reason: MISSING_PARTICLE_ALIAS }
  document = resolveAliases(document)
  const gaps = creatureUseGaps(document)
  if (gaps.length) return { ability: null, reason: `生物用不了${gaps.join("、")}` }
  const windup = document.length !== undefined ? use.windup ?? 0 : round(use.windup ?? (document.cast.type === "charge" ? document.cast.seconds : 0))
  const every = document.cast.type === "channel" ? document.cast.tick_every! : 0
  const pulses = document.cast.type === "channel" ? Array.from({ length: Math.floor((castTick(document.cast.seconds) - 1) / every) + 1 }, (_, index) => (index * every) / TICKS) : [0]
  // Extracted timelines carry their original clip length and already include windup.
  const at = (offset: number, seconds: number) => document.length !== undefined ? seconds + offset : round(windup + offset + seconds)
  const hits = pulses.flatMap((offset) => document.hits.map((hit): AbilityHit => {
    const moment = at(offset, hit.at)
    if (hit.type === "shot") return { ...hit, at: moment, damage: hit.damage === null ? null : scalarBase(hit.damage) }
    if (hit.type !== "area") return { ...hit, at: moment }
    const { heal, ...area } = hit
    return {
      ...area, at: moment, hits: hit.hits === "target" ? "target" : "everyone",
      damage: scalarBase(hit.damage), knockback: scalarBase(hit.knockback),
      effects: hit.effects.map(effect => ({ ...effect, effect: effect.effect as AbilityEffect })),
    }
  }))
  if (document.length === undefined) hits.sort((a, b) => a.at - b.at)
  const events = pulses.flatMap((offset, pulse) => document.events.map((event): AbilityEvent => {
    const moment = at(offset, event.at)
    const linked = "hit" in event && event.hit != null ? { hit: event.hit + pulse * document.hits.length } : {}
    if (event.type === "sound") {
      const { sound_alias, ...cue } = event
      return { ...cue, ...linked, at: moment, sound: sound_alias && use.sounds && Object.hasOwn(use.sounds, sound_alias) ? use.sounds[sound_alias]! : cue.sound }
    }
    if (event.type === "effect") return { ...event, at: moment, hit: null, ...linked }
    if (event.type === "particle") {
      const { where, until, ...burst } = event
      return { ...burst, ...linked, at: moment, ...(where === "self" ? {} : { where }), ...(until === undefined ? {} : { until: at(offset, until) }) }
    }
    return { ...event, ...linked, at: moment, ...("until" in event ? { until: at(offset, event.until) } : {}) }
  }))
  const moves = pulses.flatMap((offset, pulse) => document.moves.map((move): AbilityMove => {
    const when = (seconds: number) => at(offset, seconds)
    if (!("type" in move)) return { ...move, at: when(move.at) }
    if (move.type === "dash") return { ...move, from: when(move.from), to: when(move.to), hit: move.hit === null ? null : move.hit + pulse * document.hits.length }
    if (move.type === "leap") return { ...move, at: when(move.at), land: when(move.land), ...(move.landing_hit === undefined ? {} : { landing_hit: move.landing_hit + pulse * document.hits.length }) }
    return { ...move, at: when(move.at), back: { ...move.back, at: when(move.back.at) } }
  }))
  if (hits.length > EPIC_LIMITS.hits) return { ability: null, reason: `持续施法每一下都算一次出手，展开后有 ${hits.length} 次，生物的一个招式最多 ${EPIC_LIMITS.hits} 次` }
  if (events.length > ABILITY_LIMITS.events) return { ability: null, reason: `展开后有 ${events.length} 个事件，生物的一个招式最多 ${ABILITY_LIMITS.events} 个` }
  if (moves.length > ABILITY_LIMITS.moves) return { ability: null, reason: `展开后有 ${moves.length} 次位移，生物的一个招式最多 ${ABILITY_LIMITS.moves} 次` }
  const last = Math.max(windup, ...hits.map((hit) => hit.at), ...events.map((event) => "until" in event ? event.until ?? event.at : event.at), ...moves.map(moveEnd), ...(document.stages ?? []).map(stage => stage.until))
  const length = document.length ?? round(Math.max(last + 1 / TICKS, document.cast.type === "channel" ? windup + document.cast.seconds : 0))
  // r29c: played at its user's size; without a scale nothing here is touched, so the ability is what it always was.
  const factors = scaleFactors(use.scale)
  const timeline = factors ? scaledTimeline({ hits, events, moves, stages: document.stages }, factors) : { hits, events, moves, stages: document.stages }
  const parsed = AbilitySchema.safeParse({ id: use.id, name: document.name, clip: use.clip, windup, length, facing: use.facing, hits: adaptReferences(timeline.hits, use), moves: timeline.moves, stages: timeline.stages, dive: use.dive, where: use.where, on_hurt: use.on_hurt, track_until: use.track_until, turn_speed: use.turn_speed, start: use.cooldown === undefined ? use.start : { ...use.start, cooldown: use.cooldown }, stopped_by_hurt: use.stopped_by_hurt, ...(use.interrupt ? { interrupt: use.interrupt } : {}), ...(use.openings ? { openings: use.openings } : {}), ...(use.breaks ? { breaks: use.breaks } : {}), events: adaptReferences(timeline.events, use) })
  if (!parsed.success) return { ability: null, reason: (factors ? `按 scale 缩放以后有数超出了能写的范围，把 scale 往 1 调一些，或者另存一份技能：` : "") + parsed.error.issues.map((issue) => `${issue.path.join(".")}：${issue.message}`).join("；") }
  return { ability: parsed.data, reason: null }
}

/** Every shared ability of every creature that cannot be one of its abilities, said as a build stop (the asset gone, not an ability, or `sharedAbilityInline`'s reason). */
export function sharedAbilityIssues(project: ProjectLike): (AbilityAssetIssue & { creature: string })[] {
  return project.entities.flatMap((entity) =>
    (entity.shared_abilities ?? []).flatMap((use) => {
      const found = project.workspace.assets.find((asset) => asset.id === use.asset)
      if (found?.document.kind !== "ability")
        return [{ creature: entity.id, rule: "ability_asset" as const, stops: true, refs: [abilityRef({ id: use.id, name: use.id }), assetRef(use.asset)], text: `生物「${entity.name}」引用的技能（${use.id}）找不到了，或者那不是一个技能资产。`, fix: "shared_abilities 的 asset 写本工程里技能资产的 id，并让生物依赖它。" }]
      const skill = found.document as AbilityAssetDocument
      const made = sharedAbilityInline(use, skill)
      if (made.reason === MISSING_PARTICLE_ALIAS) return []
      if (made.ability && !entity.boss && (abilitiesUseArena([made.ability]) || moveAimsAtFixture(made.ability) || made.ability.events.some(e => e.type === "fixture" || e.type === "drop"))) {
        return [{ creature: entity.id, rule: "ability_asset" as const, stops: true, refs: [abilityRef(made.ability), assetRef(use.asset, skill.name)], text: `生物「${entity.name}」引用的「${skill.name}」需要首领的场地或部件。`, fix: "请给首领使用，或去掉需要首领的内容。" }]
      }
      if (made.ability) {
        const move = made.ability
        const rows = entity.stances?.list ?? []
        const issues = [...stanceEventIssues(move, new Set(rows.map(row => row.id))), ...rows.flatMap(row => stanceLeaveIssues(row, move))]
        return issues.map(issue => ({
          creature: entity.id, rule: "ability_asset" as const, stops: true,
          refs: [abilityRef(move), assetRef(use.asset, skill.name)],
          text: `生物「${entity.name}」使用「${skill.name}」切换姿态时有一处没配好。${issue.message}`,
          fix: "请一起核对技能的切换步骤和生物的姿态设置。",
        }))
      }
      return [{ creature: entity.id, rule: "ability_asset" as const, stops: true, refs: [abilityRef({ id: use.id, name: skill.name }), assetRef(use.asset, skill.name)], text: `生物「${entity.name}」引用的技能「${skill.name}」（${use.id}）当不了它的招式：${made.reason}。`, fix: "请对照上面的原因调整技能，或为这只生物选另一招。" }]
    }),
  )
}

/**
 * The project with each creature's shared abilities among its own (after them, in the order written): what the build and the checks read, so a creature that uses an ability
 * asset is generated and checked exactly as if it had written that ability itself. One that cannot be (`sharedAbilityIssues`) is left out; the build stops on it before.
 */
export function expandedMoves(entity: Pick<ProjectLike["entities"][number], "abilities" | "shared_abilities">, workspace: ProjectLike["workspace"]) {
  const moves = [...entity.abilities ?? []]
  const placed: { slot: number; ability: Ability }[] = []
  for (const use of entity.shared_abilities ?? []) {
    if (moves.some(move => move.id === use.id)) continue
    const asset = workspace.assets.find(value => value.id === use.asset)
    const made = asset?.document.kind === "ability" && sharedAbilityInline(use, asset.document as AbilityAssetDocument).ability
    if (!made) continue
    if (use.slot === undefined) moves.push(made)
    else placed.push({ slot: use.slot, ability: made })
  }
  for (const { slot, ability } of placed.sort((a, b) => a.slot - b.slot)) moves.splice(slot, 0, ability)
  return moves
}

export function withSharedAbilities<P extends ProjectLike>(project: P): P {
  if (!project.entities.some((entity) => entity.shared_abilities?.length)) return project
  return {
    ...project,
    entities: project.entities.map((entity) => {
      if (!entity.shared_abilities?.length) return entity
      return { ...entity, abilities: expandedMoves(entity, project.workspace) }
    }),
  }
}

// ---- words ----


/** One ability asset in sentences: how it is cast, when, what it does at level 0 and at level 10, and what it is bound to. Said with every look at it; never a refusal. */
export function abilityAssetLines(document: AbilityAssetDocument, title: (kind: "item" | "block" | "gesture", id: string) => string | undefined = () => undefined, studio = false) {
  const cast = document.cast
  const how = cast.type === "instant" ? "一按就放" : cast.release ? `按住至少 ${cast.release.min_seconds} 秒，松手释放；${cast.seconds} 秒蓄满，伤害和范围按蓄力比例计算` : cast.type === "charge" ? `蓄力 ${cast.seconds} 秒后放出` : `最长持续 ${cast.seconds} 秒，每 ${cast.tick_every} 刻（${((cast.tick_every ?? 0) / TICKS).toFixed(2)} 秒）放一次时间线`
  const numbers = (level: number) =>
    scalables(document)
      .filter((entry) => entry.what !== "knockback")
      .map((entry) => `${entry.what === "damage" ? "伤害" : entry.what === "heal" ? "治疗" : studio ? "之后歇" : "冷却"} ${Number(scaledAt(entry.value, level, 0, entry.what === "cooldown" ? CAST_LIMITS.cooldown : ABILITY_LIMITS.damage).toFixed(2))}${entry.what === "cooldown" ? " 秒" : ""}`)
      .join("、")
  const bound = document.bindings.map((binding) => (binding.type === "item"
    ? `物品「${title("item", binding.item) ?? binding.item}」（${binding.use === "hold" ? `按住右键${cast.type === "charge" ? "蓄满自动放出，中途松手取消" : ""}` : "右键"}）`
    : binding.type === "block"
      ? `方块「${title("block", binding.block) ?? binding.block}」（${binding.trigger === "step" ? (binding.who === "living" ? "生物踩上去就放" : "玩家踩上去就放") : "玩家右键它，它来放"}）`
      : `${studio ? "动作" : "施法动作"}${((name) => name ? `「${name}」` : "")(title("gesture", binding.gesture))}的按键`))
  return [
    casterLine(document),
    ...document.events.flatMap(e => e.type === "hazard" ? [groundEventWords(e)] : e.type === "sound" && e.pitch_variation ? [`第 ${e.at} 秒的声音音高上下浮动 ${Math.round(e.pitch_variation * 100)}%。`] : []),
    ...document.hits.flatMap((h, i) => h.type === "shot" && h.homing ? [`第 ${i+1} 次出手锁住准星目标，${h.homing.range} 格内每刻按 ${h.homing.strength} 的力度转向。`] : h.type === "area" ? [...(h.warn ? [`第 ${i+1} 次出手提前 ${h.warn.seconds} 秒显示预警${h.warn.follow ? `，跟随${h.warn.follow === "target" ? "目标" : "施法者"}` : ""}${h.warn.lock_before ? `，提前 ${h.warn.lock_before} 秒定住` : ""}${h.warn.fade_seconds ? `，结束后 ${h.warn.fade_seconds} 秒淡出` : ""}${h.warn.effect ? "，使用工程自己的地面效果" : ""}。`] : []), ...(h.blocked_by_walls ? [`第 ${i+1} 次出手被实心方块挡住时打不中。`] : [])] : []),
    `「${document.name}」是${CAST_TYPES[cast.type]}技能：${how}；时间线长 ${timelineTicks(document)} 刻，有 ${document.hits.length} 次出手、${document.events.length} 个事件、${document.moves.length} 次位移。${(cast.cancel_on ?? []).length ? `施放中${(cast.cancel_on ?? []).map((reason) => CANCEL_WORDS[reason]).join("、")}会被打断。` : ""}${cast.recasts ? `第一次放完以后 ${cast.recasts.within} 秒里还能再放 ${cast.recasts.count} 次，${studio ? "之后才开始歇。" : "然后才开始冷却。"}` : ""}`,
    ...(document.loop_pitch ? [`循环声在 ${cast.seconds} 秒内从音高 ${document.loop_pitch.from} 升至 ${document.loop_pitch.to}。`] : []),
    document.scaling ? `数值按 ${document.scaling.scales_with.join(" + ")} 成长：0 级时${numbers(0)}；10 级时${numbers(10)}（服务器配置的倍率另乘在伤害和治疗上）。` : `数值：${numbers(0)}（服务器配置的倍率另乘在伤害和治疗上）。`,
    bound.length ? `绑在：${bound.join("、")}。` : studio ? "还没有绑在任何物品、方块或动作上；只有用到它的生物能使出这一招。" : "还没有绑在任何物品、方块或施法动作上；只有引用它的生物会用它。",
  ]
}

export const ABILITY_ASSET_STANDARD: StandardOutline = {
  kind: "ability",
  label: "技能",
  rules: [],
  unmeasured: {
    earns_place: "一个技能值不值得有量不了；它的时间线、数值和绑在哪里每次都说出来，由人自己进游戏试",
    not_mechanical: "技能是数据，没有花纹和动作；玩家的动作由它用的施法动作负责",
    reads: "技能做的是不是名字说的那样，对照时间线和数值由人自己核对",
    hierarchy: "数值强弱合不合适量不了，由人自己进游戏试",
    sound: "它放在谁身上、绑在哪里，保存和打包时会检查",
    fits: "和别的技能、物品搭不搭，由人自己看",
  },
  told: {
    earns_place: "怎么放（瞬发、蓄力、持续施法）、时间线有几次出手、0 级和 10 级时的数值",
    fits: "绑在哪些物品、方块或施法动作上",
  },
}


/** The capability table and examples are shared with validation and the playable sample. */
export const ABILITY_ASSET_INSTRUCTIONS = [
  "技能和生物招式共用 hits、events、moves 和 stages，at 以秒计。谁能放由内容决定：" + casterGuide() + "。",
  "cast 可选 instant、charge、channel。按住物品用 hold，松手放写 release.min_seconds；持续施法写 tick_every，中断条件写 cancel_on。数值成长写 {base,per_level} 和 scaling.scales_with。服务器倍率在 config/<模组 id>-abilities.properties。",
  "bindings 可绑物品、施法动作或方块。方块默认右键；踩踏写 trigger:step，who 选 players 或 living。每个方块位置独立计算冷却。技能要依赖用到的工程资产。",
  `生物用 shared_abilities 引用这个技能时，${OMNI_START_INSTRUCTIONS}`,
  "多个事件用 where:hit 和 hit 序号共用锁定落点。出手与地面效果可用 once_group 避免重复伤害。声音范围写 range_blocks，施法声音分别写 sound_ranges.start、loop、end。",
  "生物在 shared_abilities 写 asset、id、clip、start、facing 和 stopped_by_hurt。bones 替换部件名，particles 替换粒子别名，sounds 替换事件的 sound_alias；可改 damage_scale、cooldown 和 interrupt。" +
    `scale 把这一招按比例放大缩小（${SCALE_LIMITS.min}–${SCALE_LIMITS.max} 倍）：一个数是整体；分开写 {size,reach,speed}，size 管判定范围、位置偏移、地面效果和预警的大小、效果和粒子散开，reach 管冲刺和跳跃的距离，speed 管冲刺速度（不写同 reach，时长不变）。伤害仍用 damage_scale；时间、击退和 start 的距离不变，start 按缩放后的距离自己写。只差尺寸时用 scale；要改时机、出手次数或换效果时另存一份技能。例：Boss 引用「横冲」不写 scale，小怪写 "scale":{"reach":0.33,"size":0.5}、start.max_distance 写 8。`,
  CAST_COMBAT_GUIDE,
  ...abilityExamples().map((document, i) => ["环形震地（两只生物各选动作、部件、粒子和声音）", "冰刺法杖（空心环出手并在前方显示冰刺效果）", "地刺陷阱（踩踏触发危险区和碎块）"][i] + "：" + JSON.stringify(document) + "。"),
].join("\n")

export const ABILITY_ASSET_SUMMARY = "把出手、事件、位移和分段存成一招。技能页显示谁能放、谁在用；生物可以为同一招选择自己的动作、部件、粒子和声音。"

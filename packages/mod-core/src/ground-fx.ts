import { ParticleRefSchema, assetOf, particleLabel, type ParticleAliases } from "./particle-emission"
import { onceFields } from "./once-group"
import { RingWarnSchema } from "./warning-schema"
import { z } from "zod"
import { PopBlocksSchema, abilitiesTerrain, type TerrainEvent } from "./terrain"
import { ABILITY_EFFECTS, ABILITY_EFFECT_IDS, ABILITY_LIMITS, ABILITY_PARTICLES, EPIC_LIMITS, TICKS, WARN_COLORS } from "./ability-words"
import type { Ability } from "./entity-runtime"

/**
 * 第 4 步（效果和表现）between the document and everything that reads it: four things an ability puts down in the world that are neither a model (an effect asset) nor a particle,
 * drawn by every player's game as meshes of their own (`common/ground-fx.ts` writes them):
 * - `hazard` (地面危险区): a patch of ground that burns or rots for some seconds — it hurts whoever stands in it every few ticks, may set them on fire or give them a status
 *   effect, and is seen as a glowing (or dark) disc on the ground with particles rising from it;
 * - `crack` (地裂): a flat crack on the ground that grows out from its middle and fades; only seen;
 * - `shockwave` (冲击波环): a ring on the ground that grows from one radius to another and fades as it goes, with an optional low wall; it may strike, once, whoever the ring passes;
 * - `beam` (光束): a glowing beam from the creature (a part of its model, or its feet) toward the one it fights or straight ahead, as wide as it says, for a stretch of the ability;
 *   it may strike whoever it touches every few ticks.
 * The first three may also be what a thrown thing leaves where it comes down (`impact.ground`, `GroundImpactSchema`). No Node APIs: the app's window reads it too.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits)) || 0
type Vec = [number, number, number]

/**
 * The bounds of every number. `hazard.every`: ticks between two times a hazard hurts (a quarter of a second to two); `particles`: particles a pulse of a hazard sends up (every
 * `pulse` ticks); `alive`: the most of them in a world at once (more are not made); `fall`: blocks under its place the ground is looked for; `range`: chunks within which a player's
 * game is told of one (a beam 48 blocks long seen from 10 chunks away is still seen whole); `impact`: how many a thrown thing may leave where it comes down.
 */
export const GROUND_FX_LIMITS = {
  hazard: { radius: { min: 0.5, max: 8 }, seconds: { min: 0.5, max: 20 }, every: { min: 5, max: 40 }, burn: 10, particles: 16, pulse: 4 },
  crack: { radius: { min: 1, max: 12 }, seconds: { min: 0.5, max: 20 }, grow: { min: 0, max: 2 } },
  shockwave: { from: { min: 0, max: 8 }, to: { min: 1, max: 32 }, seconds: { min: 0.2, max: 4 }, width: { min: 0.2, max: 4 }, height: { min: 0, max: 4 } },
  beam: { width: { min: 0.1, max: 3 }, length: { min: 2, max: 48 }, turn: 30, every: { min: 2, max: 20 }, fade: 1 },
  alive: 32,
  fall: 8,
  range: 10,
  impact: 3,
} as const

/** The four kinds, as the generated Java numbers them. */
export const GROUND_FX_KINDS = { hazard: 0, crack: 1, shockwave: 2, beam: 3, flash: 4 } as const
export type GroundFxKind = keyof typeof GROUND_FX_KINDS

const L = GROUND_FX_LIMITS
const ahead = z.number().finite().min(-ABILITY_LIMITS.reach).max(ABILITY_LIMITS.reach)
const time = z.number().finite().min(0).max(ABILITY_LIMITS.seconds)
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色写成 #rrggbb 的六位十六进制")
const range = (bounds: { min: number; max: number }) => z.number().finite().min(bounds.min).max(bounds.max)
// The same status effects a hit gives, written the same way (`AbilityEffectSchema`).
const FxEffectSchema = z.strictObject({ particles:z.boolean().optional(), effect: z.enum(ABILITY_EFFECT_IDS), duration_ticks: z.number().int().min(1).max(2400), amplifier: z.number().int().min(0).max(4) })
const strike = {
  damage: z.number().finite().min(0).max(ABILITY_LIMITS.damage),
  hits: z.enum(["target", "everyone"]),
  effects: z.array(FxEffectSchema).max(ABILITY_LIMITS.effects),
}

/** What a hazard is, wherever it is put down. `particle` (optional): what rises from it, a vanilla particle or one of the project's own (`{asset}`), `count` every pulse. `burn_seconds`: it sets on fire. */
const hazardShape = {
  type: z.literal("hazard"),
  radius: range(L.hazard.radius),
  shape: z.enum(["circle", "square"], { error: "危险区形状请选 circle（圆）或 square（方）。" }).optional(),
  growth: z.strictObject({
    per_second: z.number().min(0, "每秒增加的半径不能为负。").max(16, "每秒最多增加 16 格。"),
    per_hit: z.number().min(0, "每次命中增加的半径不能为负。").max(8, "每次命中最多增加 8 格。"),
    max_radius: z.number().min(0.5, "最大半径至少 0.5 格。").max(32, "最大半径最多 32 格。"),
  }).optional(),
  seconds: range(L.hazard.seconds),
  color,
  glow: z.boolean(),
  ...strike,
  every_ticks: z.number().int().min(L.hazard.every.min).max(L.hazard.every.max),
  burn_seconds: z.number().finite().min(0).max(L.hazard.burn).optional(),
  particle: ParticleRefSchema.optional(),
  count: z.number().int().min(1).max(L.hazard.particles).optional(),
}
const crackShape = { type: z.literal("crack"), radius: range(L.crack.radius), seconds: range(L.crack.seconds), grow_seconds: range(L.crack.grow), color, glow: z.boolean() }
const shockwaveShape = {
  type: z.literal("shockwave"),
  pop_blocks: PopBlocksSchema.optional(),
  from_radius: range(L.shockwave.from),
  to_radius: range(L.shockwave.to),
  seconds: range(L.shockwave.seconds),
  width: range(L.shockwave.width),
  height: range(L.shockwave.height),
  hit_height: z.number({ error: "环的命中高度请填格数。" }).min(0.05, "环的命中高度至少填 0.05 格。").max(4, "环的命中高度最多填 4 格。").optional(),
  color,
  glow: z.boolean(),
  ...strike,
  knockback: z.number().finite().min(0).max(ABILITY_LIMITS.knockback),
}
/** Where one is put down at a moment of an ability: counted from its own feet, the feet of the one it fights, or the middle of where hit number `hit` lands (the effect's and the debris' way). */
const placeShape = { at: time, where: z.enum(["self", "target", "hit"]), hit: z.number().int().min(0).max(EPIC_LIMITS.hits - 1).nullable(), forward: ahead, left: ahead }

export const FlashEventSchema = z.strictObject({
  type: z.literal("flash"), at: time, where: placeShape.where.default("self"), hit: placeShape.hit.default(null),
  forward: ahead.default(0), left: ahead.default(0), shape: z.enum(["arc", "ring", "glint"]),
  radius: z.number().min(0.1).max(16), arc: z.int().min(30).max(360).optional(),
  tilt: z.number().min(-90).max(90).default(0), color, seconds: z.number().min(0.1).max(1).default(0.3),
  grow: z.number().min(1).max(3).default(1),
})
export type FlashEvent = z.infer<typeof FlashEventSchema>
export const flashTexture = (flash: FlashEvent) => flash.shape === "arc" ? `arc_${flash.arc ?? 140}` : flash.shape

export const HazardEventSchema = z.strictObject({ ...hazardShape, ...placeShape, ...onceFields })
export const CrackEventSchema = z.strictObject({ ...crackShape, ...placeShape })
export const ShockwaveEventSchema = z.strictObject({ ...shockwaveShape, ...placeShape, ...onceFields, warn: RingWarnSchema.optional() })
/**
 * A beam from `at` to `until` (seconds of the ability): from the middle of the part `bone` (left out: its feet) and `forward`/`up`/`left` of it in its own terms, turning with it, toward
 * the one it fights (`aim: "target"`, its aim turning toward them at most `turn` degrees a tick: 0 keeps the aim it started with) or straight ahead the way it faces (`"ahead"`), as far
 * as `length` blocks or the first block in the way. It ends early when the ability does (over or cut short), or the creature dies.
 */
export const BeamEventSchema = z.strictObject({
  type: z.literal("beam"),
  at: time,
  until: time,
  bone: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/).optional(),
  forward: ahead,
  up: ahead,
  left: ahead,
  aim: z.enum(["target", "ahead"]),
  turn: z.number().finite().min(0).max(L.beam.turn).optional(),
  sweep: z.strictObject({
    blocks_per_second: z.number().finite().positive("光斑速度必须大于零。").max(128),
    phase_scales: z.array(z.number().finite().min(0).max(16)).min(1).max(4).optional(),
  }).optional(),
  length: range(L.beam.length),
  width: range(L.beam.width),
  color,
  ...strike,
  every_ticks: z.number().int().min(L.beam.every.min).max(L.beam.every.max),
})

/** 落地炸开 (`impact.ground`): a hazard, a crack or a shockwave left where a thrown thing comes down, written as the event is but without when and where (that is the landing). */
export const GroundImpactSchema = z.discriminatedUnion("type", [z.strictObject(hazardShape), z.strictObject(crackShape), z.strictObject(shockwaveShape)])
export type GroundImpact = z.infer<typeof GroundImpactSchema>

export type HazardEvent = z.infer<typeof HazardEventSchema>
export type CrackEvent = z.infer<typeof CrackEventSchema>
export type ShockwaveEvent = z.infer<typeof ShockwaveEventSchema>
export type BeamEvent = z.infer<typeof BeamEventSchema>
export type GroundEvent = HazardEvent | CrackEvent | ShockwaveEvent | FlashEvent
export type GroundFxEvent = GroundEvent | BeamEvent
export type GroundFx = GroundImpact | BeamEvent | FlashEvent

const FX_TYPES: ReadonlySet<string> = new Set(["hazard", "crack", "shockwave", "beam", "flash"])
/** Whether an event is one of the four. */
export const isGroundFx = (event: { type: string }): event is GroundFxEvent => FX_TYPES.has(event.type)
/** Whether an event is put down at a place (all but the beam). */
export const isGroundPlaced = (event: { type: string }): event is GroundEvent => event.type === "hazard" || event.type === "crack" || event.type === "shockwave" || event.type === "flash"
/** The four of an ability, each with its place in `events`. */
export const groundFxEvents = (ability: Pick<Ability, "events">) => ability.events.flatMap((event, index) => (isGroundFx(event) ? [{ index, event: event as GroundFxEvent }] : []))
/** What these abilities' thrown things leave where they come down. */
export const groundImpacts = (abilities: readonly Pick<Ability, "hits">[]) => abilities.flatMap((ability) => ability.hits.flatMap((hit) => (hit.type === "projectile" ? (hit.impact?.ground ?? []) : [])))
/** Whether any of the abilities puts down any of the four (events, or where a thrown thing comes down). */
export const abilitiesGroundFx = (abilities: readonly Pick<Ability, "events" | "hits">[] | null | undefined) => abilitiesTerrain(abilities) || (abilities ?? []).some((ability) => groundFxEvents(ability).length > 0) || groundImpacts(abilities ?? []).length > 0
/** Whether one hurts anybody (and so may not come before the ability is done getting ready). */
export const fxHurts = (fx: GroundFx) => fx.type !== "crack" && fx.type !== "flash" && (fx.damage > 0 || fx.effects.length > 0 || (fx.type === "hazard" && (fx.burn_seconds ?? 0) > 0) || (fx.type === "shockwave" && fx.knockback > 0))
/** Ticks one lasts: a beam from `at` to `until`, the rest their `seconds` (at least one). The generated Java's `life` is this. */
export const groundFxLife = (fx: GroundFx) => (fx.type === "beam" ? Math.max(1, Math.round(fx.until * TICKS) - Math.round(fx.at * TICKS)) : Math.max(1, Math.round(fx.seconds * TICKS)))

/**
 * What a hazard or a beam that hurts may not be: gone before its first strike. It strikes `every_ticks` after it is put down and every `every_ticks` after that, up to and on its
 * last tick, so it must last at least that long. Nothing for one that does not hurt.
 */
export function groundFxCadenceIssue(fx: GroundFx): { path: string[]; message: string } | null {
  if ((fx.type !== "hazard" && fx.type !== "beam") || !fxHurts(fx)) return null
  const life = groundFxLife(fx)
  if (life >= fx.every_ticks) return null
  return fx.type === "hazard"
    ? { path: ["seconds"], message: `地面危险区只留 ${num(life / TICKS)} 秒（${life} 刻），可它放下以后要过 every_ticks ${fx.every_ticks} 刻才第一次伤人：还没伤到人就没了。把 seconds 写到至少 ${num(fx.every_ticks / TICKS)} 秒，或者把 every_ticks 写小一点` }
    : { path: ["until"], message: `光束从 at 到 until 只有 ${num(life / TICKS)} 秒（${life} 刻），可它要过 every_ticks ${fx.every_ticks} 刻才第一次伤人：还没伤到人就收了。把 until 往后写，或者把 every_ticks 写小一点` }
}

/** The particle assets these put up, by asset id. */
export const groundFxParticleAssets = (all: readonly GroundFx[]) => [...new Set(all.flatMap((fx) => (fx.type === "hazard" && fx.particle !== undefined && assetOf(fx.particle) ? [assetOf(fx.particle)!] : [])))]
/** The vanilla particles these put up, by id. */
export const groundFxVanillaParticles = (all: readonly GroundFx[]) => [...new Set(all.flatMap((fx) => (fx.type === "hazard" && typeof fx.particle === "string" ? [fx.particle] : [])))]
/** Every one of these abilities (events and landings), in one list. */
export const allGroundFx = (abilities: readonly Pick<Ability, "events" | "hits">[] | null | undefined): GroundFx[] => [...(abilities ?? []).flatMap((ability) => groundFxEvents(ability).map((found) => found.event)), ...groundImpacts(abilities ?? [])]

/**
 * What is wrong with an ability's ground effects and beams, each with where it is: `hit` names a hit it has, that has a place it lands that is known when it is put down (not a hit
 * written in code or a thrown thing: that one leaves it where it comes down, `impact.ground`); one that hurts comes no earlier than a hit may; a beam
 * ends after it starts and inside the ability; a shockwave grows. `elsewhere`: whether an area hit lands somewhere decided by the server (`hitElsewhere`).
 */
export function groundFxIssues(ability: Pick<Ability, "windup" | "length" | "events" | "hits">) {
  const found: { path: (string | number)[]; message: string }[] = []
  ability.events.forEach((event, index) => {
    if (!isGroundFx(event)) return
    const at = (...rest: (string | number)[]) => ["events", index, ...rest]
    const name = GROUND_FX_NAMES[event.type]
    if (event.type === "flash" && event.shape !== "arc" && event.arc !== undefined) found.push({path: at("arc"), message: "只有弧形刀光能写张角 arc。圆环或星芒请去掉 arc。"})

    if (fxHurts(event) && event.at < ability.windup - 1e-9) found.push({ path: at("at"), message: `${name}会伤人，和出手一样不能比蓄力结束（windup）还早` })
    if (event.type === "beam") {
      if (event.until <= event.at + 1e-9) found.push({ path: at("until"), message: "光束结束的时刻（until）要比开始（at）晚" })
      if ((event.sweep === undefined) === (event.turn === undefined)) found.push({path:at("sweep"),message:"光束要选一种追踪方式：每刻转几度（turn），或光斑每秒走几格（sweep）。两种只填一种。"})
      if (event.sweep && event.aim !== "target") found.push({path:at("aim"),message:"按光斑速度追踪时，瞄准对象要选目标。"})
      if (event.until > ability.length + 1e-9) found.push({ path: at("until"), message: "光束结束的时刻（until）不能比招式全长（length）还晚：招式结束的那一刻光束就收了" })
      const cadence = event.until > event.at + 1e-9 ? groundFxCadenceIssue(event) : null
      if (cadence) found.push({ path: at(...cadence.path), message: cadence.message })
      return
    }
    if (event.type === "hazard" && event.growth && event.growth.max_radius < event.radius) found.push({ path: at("growth", "max_radius"), message: "最大半径不能小于起始半径 radius。" })
    const cadence = groundFxCadenceIssue(event)
    if (cadence) found.push({ path: at(...cadence.path), message: cadence.message })
    if (event.type === "shockwave" && event.warn && event.warn.seconds > event.at + 1e-9) found.push({ path: at("warn", "seconds"), message: `环的预警最早在出招时开始，第 ${event.at} 秒出现的环最多提前 ${event.at} 秒预警。` })
    if (event.type === "shockwave" && event.to_radius <= event.from_radius + 1e-9) found.push({ path: at("to_radius"), message: "冲击波最后的半径（to_radius）要比开始的半径（from_radius）大：它是往外扩的" })
    if ((event.where === "hit") !== (event.hit !== null)) found.push({ path: at("hit"), message: `${name}的 where 写 "hit" 的时候用 hit 写是第几次出手（从 0 数），其余时候 hit 写 null` })
    if (event.hit === null) return
    const aimed = ability.hits[event.hit]
    if (!aimed) found.push({ path: at("hit"), message: `这个招式只有 ${ability.hits.length} 次出手，没有第 ${event.hit} 次（从 0 数）` })
    else if (aimed.type === "gameplay") found.push({ path: at("hit"), message: `第 ${event.hit} 次出手是玩法代码做的，没有落点可以对：where 写 self / target 并且 hit 写 null` })
    else if (aimed.type === "projectile") found.push({ path: at("where"), message: `第 ${event.hit} 次出手是扔出去的东西，落在哪里要等它飞到才知道：${name}不能用 where:"hit" 指向它。要在落点留下${name}，写在那个投射物的 impact.ground 里` })
  })
  return found
}

/** What a projectile's `impact.ground` may not be, with where it is under the impact. */
export function groundImpactIssues(ground: readonly GroundImpact[]) {
  return ground.flatMap((fx, index) => {
    const cadence = groundFxCadenceIssue(fx)
    return [
      ...(fx.type === "hazard" && fx.growth && fx.growth.max_radius < fx.radius ? [{ path: ["ground", index, "growth", "max_radius"], message: "最大半径不能小于起始半径 radius。" }] : []),
      ...(fx.type === "shockwave" && fx.to_radius <= fx.from_radius + 1e-9 ? [{ path: ["ground", index, "to_radius"], message: "冲击波最后的半径（to_radius）要比开始的半径（from_radius）大：它是往外扩的" }] : []),
      ...(cadence ? [{ path: ["ground", index, ...cadence.path], message: cadence.message }] : []),
    ]
  })
}

// ---- words ----

export const GROUND_FX_NAMES: Record<GroundFxKind, string> = { hazard: "地面危险区", crack: "地裂", shockwave: "冲击波环", beam: "光束", flash: "闪形" }

const strikeWords = (fx: { damage: number; hits: "target" | "everyone"; effects: readonly { effect: keyof typeof ABILITY_EFFECTS; duration_ticks: number }[] }, extra: string[] = []) => {
  const done = [...(fx.damage > 0 ? [`掉 ${num(fx.damage)} 点血`] : []), ...extra, ...fx.effects.map((effect) => `${ABILITY_EFFECTS[effect.effect]} ${num(effect.duration_ticks / TICKS, 1)} 秒`)]
  return done.length ? `${done.join("、")}（${fx.hits === "target" ? "只打它的目标" : "除了它和同类以外谁都打"}）` : ""
}
const placeWords = (event: Pick<GroundEvent, "where" | "hit" | "forward" | "left">) =>
  `${event.where === "self" ? "它脚下" : event.where === "target" ? "目标脚下" : `第 ${(event.hit ?? 0) + 1} 次出手打到的地方`}${event.forward || event.left ? `（再往前 ${num(event.forward)} 格、往左 ${num(event.left)} 格）` : ""}`
const particleName = (particle: HazardEvent["particle"], title: ((id: string) => string | null) | null, aliases?: ParticleAliases) => (particle === undefined ? null : typeof particle === "string" ? ABILITY_PARTICLES[particle] : "alias" in particle ? particleLabel(particle, { title, aliases }) : `自己做的粒子「${title?.(particle.asset) ?? particle.asset}」`)

/** One of the four in words, without when and where: 「半径 3 格的地面危险区（#ff5500，发光），留 6 秒：站在里面每 0.5 秒掉 2 点血、着火 3 秒，冒火焰粒子」. */
export function groundFxWords(fx: GroundFx, title: ((id: string) => string | null) | null = null, aliases?: ParticleAliases): string {
  if (fx.type === "flash") return `${{arc:"弧形刀光",ring:"光环",glint:"星芒"}[fx.shape]}，半径 ${fx.radius} 格、倾角 ${fx.tilt}°，全亮，在 ${fx.seconds} 秒内淡出`
  const glow = (value: boolean) => (value ? "，发光" : "")
  if (fx.type === "hazard") {
    const hurt = strikeWords(fx, (fx.burn_seconds ?? 0) > 0 ? [`着火 ${num(fx.burn_seconds!)} 秒`] : [])
    const rises = particleName(fx.particle, title, aliases)
    return `半径 ${num(fx.radius)} 格的${fx.shape === "square" ? "方形" : ""}${GROUND_FX_NAMES.hazard}${fx.growth ? `（每秒增 ${fx.growth.per_second} 格，每次命中增 ${fx.growth.per_hit} 格，最多 ${fx.growth.max_radius} 格）` : ""}（${fx.color}${glow(fx.glow)}），留 ${num(fx.seconds)} 秒${hurt ? `：站在里面每 ${num(fx.every_ticks / TICKS)} 秒${hurt}` : "（只是看得见，不伤人）"}${rises ? `，冒${rises}粒子` : ""}`
  }
  if (fx.type === "crack") return `半径 ${num(fx.radius)} 格的${GROUND_FX_NAMES.crack}（${fx.color}${glow(fx.glow)}），${fx.grow_seconds > 0 ? `${num(fx.grow_seconds)} 秒里从中间裂开，` : "一下子裂开，"}留 ${num(fx.seconds)} 秒后淡掉（只是看得见）`
  if (fx.type === "shockwave") {
    const hurt = strikeWords(fx, fx.knockback > 0 ? ["被往外推开"] : [])
    return `${GROUND_FX_NAMES.shockwave}（${fx.color}${glow(fx.glow)}，宽 ${num(fx.width)} 格${fx.height > 0 ? `、带 ${num(fx.height)} 格高的光墙` : ""}），${num(fx.seconds)} 秒里从半径 ${num(fx.from_radius)} 格扩到 ${num(fx.to_radius)} 格${hurt ? `：环扫过的人${hurt}，每人只挨一次${fx.hit_height !== undefined ? `；脚底高过 ${num(fx.hit_height)} 格就能躲开${fx.hit_height <= 1 ? '，可以跳过去' : ''}` : ''}` : "（只是看得见，不伤人）"}${fx.pop_blocks ? `，地面方块弹起 ${fx.pop_blocks.height} 格后落回（只显示，最多 ${fx.pop_blocks.max} 块）` : ""}`
  }
  const hurt = strikeWords(fx)
  return `从${fx.bone ? `「${fx.bone}」` : "它脚下"}${fx.forward || fx.up || fx.left ? `（再往前 ${num(fx.forward)}、往上 ${num(fx.up)}、往左 ${num(fx.left)} 格）` : ""}射出一道宽 ${num(fx.width)} 格的${GROUND_FX_NAMES.beam}（${fx.color}，发光），${fx.aim === "target" ? `对着目标${fx.sweep ? `（光斑每秒 ${num(fx.sweep.blocks_per_second)} 格，玩家走路 4.3、疾跑 5.6 格每秒）` : (fx.turn ?? 0) > 0 ? `（每刻最多转 ${num(fx.turn!)}° 去追）` : "（瞄准开始那一刻目标的位置，不再追）"}` : "朝它面对的方向（跟着它转）"}，最远 ${num(fx.length)} 格、碰到方块就停${hurt ? `：被光束碰到每 ${num(fx.every_ticks / TICKS)} 秒${hurt}` : "（只是看得见，不伤人）"}`
}

/** One event in words, with when and where. */
export function groundEventWords(event: GroundFxEvent, title: ((id: string) => string | null) | null = null, aliases?: ParticleAliases) {
  if (event.type === "beam") return `第 ${num(event.at)} 到 ${num(event.until)} 秒${groundFxWords(event, title, aliases)}`
  const cue = event.type === "shockwave" && event.warn ? `，提前 ${num(event.warn.seconds)} 秒画${WARN_COLORS[event.warn.color].name}起始圈（半径 ${num(event.from_radius)} 格，宽 ${num(event.width)} 格）${event.warn.extent === "max" ? "，虚线标出最远外缘" : ""}` : ""
  return `第 ${num(event.at)} 秒在${placeWords(event)}放下${groundFxWords(event, title, aliases)}${cue}${"once_group" in event && event.once_group ? `，命中组「${event.once_group}」每人只扣一次血` : ""}`
}

/** What a thrown thing leaves where it comes down, in words (the end of `impactWords`). */
export const groundImpactWords = (ground: readonly GroundImpact[], title: ((id: string) => string | null) | null = null, aliases?: ParticleAliases) => ground.map((fx) => `留下${groundFxWords(fx, title, aliases)}`).join("、")

const effectsWords = `effects 和范围出手的一样（[{effect: ${Object.keys(ABILITY_EFFECTS).join("|")}, duration_ticks, amplifier}]）`
export const GROUND_FX_INSTRUCTIONS =
  `环、危险区、光束和带伤害的地面效果按设定间隔打，每一下都跳过原版半秒受伤保护；普通出手遵守保护。地裂（crack）只画裂纹；叠在裂纹上的危险区用危险区的伤害间隔。砸一下再放环时，在范围出手和环上都写 once_group:"slam"，同一次出招每人只扣一次血，第二个目标单独计算。默认重复命中也跳过击退和状态，once_skip_effects:false 保留这些效果。范围出手、冲刺沿路的出手、原版和自定义投射物、危险区和环均可编组。连招每步重新计数；要跨步，两步的成员都写 once_across_steps:true。` +
  ` 第 4 步的四种画面（都写在 events 里，都由每个玩家的游戏自己画成网格，不是效果资产，不用做模型，也不用加依赖）：` +
  ` 危险区 shape 选 circle 或 square，方形的 radius 是半边长。growth:{per_second:1,per_hit:0.25,max_radius:8} 控制每秒和每次命中增长的格数；粒子数按面积增加，每次最少 1、最多 64 个。地面危险区 {type:"hazard", at, where, hit, forward, left, radius, seconds, color, glow, damage, hits, effects, every_ticks, burn_seconds, particle, count}——在那个位置（where/hit/forward/left 的算法和碎块一样：self 它脚下、target 目标脚下、hit 第几次出手打到的地方，往下找地面）铺一块半径 radius 格（${L.hazard.radius.min} 到 ${L.hazard.radius.max}）的区域，留 seconds 秒（${L.hazard.seconds.min} 到 ${L.hazard.seconds.max}）；地上画一个 color（#rrggbb）的圆，glow=true 时发光叠加（火、毒、虚空的光），false 时是不发光的暗色（焦土、黑水）；每 every_ticks 刻（${L.hazard.every.min} 到 ${L.hazard.every.max}，20 刻一秒）对站在里面的人（hits: target 只打它的目标，everyone 打除了它和同类的每个活物）掉 damage 点血、上 effects、着火 burn_seconds 秒（可以不写，最多 ${L.hazard.burn}）——放下后第 every_ticks 刻第一次伤人，留到最后一刻的那一下也算，所以伤人的危险区 seconds 不能比 every_ticks 短；${effectsWords}。particle（可以不写，原版粒子名或 {"asset":"粒子资产 id"}）是从里面往上冒的粒子，每 ${L.hazard.pulse} 刻冒 count 个（1 到 ${L.hazard.particles}，不写是 4）。伤人的危险区不能早于 windup。` +
  ` 地裂 {type:"crack", at, where, hit, forward, left, radius, seconds, grow_seconds, color, glow}——地上一张 radius 格（${L.crack.radius.min} 到 ${L.crack.radius.max}）的裂纹，grow_seconds 秒（${L.crack.grow.min} 到 ${L.crack.grow.max}，0 是一下子裂开）里从中间长出来，留到 seconds 秒（${L.crack.seconds.min} 到 ${L.crack.seconds.max}）末尾淡掉；color 是裂纹的颜色，glow=true 时裂缝发光（岩浆、雷光），false 时是暗色的缝。只给人看。` +
  ` 冲击波环 {type:"shockwave", at, where, hit, forward, left, from_radius, to_radius, seconds, width, height, color, glow, damage, knockback, hits, effects}——地上一个环，seconds 秒（${L.shockwave.seconds.min} 到 ${L.shockwave.seconds.max}）里从半径 from_radius（${L.shockwave.from.min} 到 ${L.shockwave.from.max}）扩到 to_radius（${L.shockwave.to.min} 到 ${L.shockwave.to.max}，要比 from_radius 大），环宽 width 格（${L.shockwave.width.min} 到 ${L.shockwave.width.max}），越往外越细越淡；height 是环上竖起的一圈光墙有多高（0 到 ${L.shockwave.height.max}，0 就只有地上的环）；glow 同上。damage、knockback、effects 写了，环扫过的人（离地 2 格以内）每人只挨一次。写 hit_height 可指定脚底的命中高度（0.05–4 格），例如 0.35 格的薄环可以跳过去；knockback 往外推；都写 0 和 [] 就只是看得见。招式里的环可直接写 warn，字段和范围出手相同，例如 warn:{seconds:0.6,look:"ring",color:"orange",extent:"max"}。默认按起始圈宽度预警；extent:"max" 还以虚线标出最终外缘。带预警的环可满足蓄力预警要求。` +
  ` 预警 warn.paint 可选 mesh（画发光星芒组成的轮廓）或 dust（原版彩尘），也可用 warn.effect 铺工程效果。Boss 和史诗档的新任务默认用 mesh。` +
  ` 为什么要换：已有首领的进游戏采样中，一招累计 24708 颗原版彩尘，另一招 3138 颗。离场固定放 60 颗云，回场放 6 颗大爆炸。碎块扬尘可达三四百到一千多颗，打碎方块还会产生方块碎屑，减速可带出药水泡。采样按客户端粒子类累计，可能含上一招的残留。` +
  ` 在生物 builtin 表的对应位置写 particle 或 sound，例如 builtin:{weak_hit:{particle:{alias:"火星"}},leave:{sound:{asset:"声音资产 id"}}}。在该位置的 particle 或 sound 写字符串 "none"，可分别关闭该位置自带的粒子或声音；省略哪个字段，哪个就沿用默认。例如 builtin:{weak_hit:{particle:"none"},leave:{sound:"none"}}。物件两种状态分别用 builtin.fixture_lit.particle 和 builtin.fixture_ember.particle。写 {asset:粒子资产的 UUID}、{alias:粒子别名} 或字符串 none。也可在这一状态里单独填 effect:效果资产的 UUID。省略时亮灯不发粒子，余烬每四刻冒一颗小火苗。升起地形碎裂时的扬尘用 builtin.terrain_shatter.particle，保留两片地形碎块。死后身体消失那一刻，游戏自己会在原地冒一团 20 颗的白烟（原版 poof），每只生物都有，和是不是 Boss、有没有死亡爆炸无关；builtin.death_poof.particle 管的就是这团白烟，写 "none" 不冒，写原版粒子名、{asset:粒子资产的 UUID} 或 {alias:粒子别名} 就换成那种，颗数不变；不写照旧冒白烟。builtin.death_burst 只管 Boss 死亡演出最后那一下爆炸的光和声，换掉它管不到这团白烟。用 break.particles:false 关闭打碎时的碎屑，用状态 effects 项的 particles:false 隐藏药水泡，照常计算掉落和状态。` +
  ` lightning.look 可选。在每个落点显示 effect、粒子 particle、声音 sound 或闪形 flash。particle 可直接写粒子引用，也可写 {particle,count,spread,velocity}。只要写了 look 就用所选表现，伤害和落点沿用这道雷的配置。` +
  ` 碎块 debris 可用 block 选工程方块标识符或 minecraft:ice，用 dust 选原版粒子、工程粒子或别名。省略 block 使用脚下的方块，省略 dust 使用脚下方块的扬尘。` +
  ` 一句话得到整套命中反馈，例如 {type:"hit_fx",at:0.6,where:"hit",hit:0,level:"heavy",color:"#ffb35c"}。轻档叠星芒、6 颗粒子和声音，中档再加光环并用 12 颗，重档再加震屏与碎块。particle 和 sound 可换工程资产；省略 particle 时先找 hit 粒子别名，再用原版暴击星。` +
  ` 刀光或闪形用 {type:"flash",at,shape:"arc",radius:2,arc:140,tilt:0,color:"#ffcc77",seconds:0.3,grow:1.5}。tilt 为 0 时横扫，90 时竖劈；shape 也可用 ring 或 glint，此时省略 arc。始终全亮并淡出。` +
  ` 光束 {type:"beam", at, until, bone, forward, up, left, aim, turn, length, width, color, damage, hits, effects, every_ticks}——从 at 到 until 秒（until 比 at 晚，不超过 length；招式提前结束或被打断光束也跟着收），从模型部件 bone 的中心（不写就是脚下）再往前 forward、往上 up、往左 left 格的地方射出一道发光的光束，跟着它转；aim 是 "target"（对着目标，每刻最多转 turn 度去追，0 到 ${L.beam.turn}，0 就停在开始那一刻瞄的方向）或 "ahead"（朝它面对的方向，扫射用）；最远 length 格（${L.beam.length.min} 到 ${L.beam.length.max}），碰到方块就停；宽 width 格（${L.beam.width.min} 到 ${L.beam.width.max}），头尾各有一小段渐亮和渐暗；每 every_ticks 刻（${L.beam.every.min} 到 ${L.beam.every.max}）被它碰到的人掉 damage 点血、上 effects（射出后第 every_ticks 刻第一次伤人，所以伤人的光束 until 减 at 不能比 every_ticks 短）。危险区和光束每一下都按写的间隔打到，不受原版受伤后半秒无敌的影响。aim:"target" 可用 sweep:{blocks_per_second:5,phase_scales:[1,1.2]} 替换 turn，远近都按光斑速度追。玩家走路约 4.3、疾跑约 5.6 格每秒。phase_scales 从初始阶段起依次乘倍率，没有写到的阶段乘 1。` +
  ` 同一时间全世界最多 ${L.alive} 个，多了不放。扔出去的东西也可以在落点留下前三种：在投射物的 impact 里写 ground:[…]（最多 ${L.impact} 个，写法同上但不写 at、where、hit、forward、left——位置就是落点）。`

// ---- pictures ----

/** Model pixels a block (the pictures' viewport space, `abilityPlace`). */
const BLOCK = 16
const viewport = (forward: number, up: number, left: number): Vec => [-left * BLOCK, up * BLOCK, -forward * BLOCK]

/** A circle on the ground of `radius` blocks round a place, as a closed line in the pictures' space. */
export function groundCircle(forward: number, left: number, radius: number, up = 0.03, points = 32): Vec[] {
  return Array.from({ length: points + 1 }, (_, at) => viewport(forward + radius * Math.cos((at * 2 * Math.PI) / points), up, left + radius * Math.sin((at * 2 * Math.PI) / points)))
}

/** A star of `size` blocks round a place on the ground (what a burst is drawn as): four strokes through its middle. */
export function groundStar(forward: number, up: number, left: number, size: number): Vec[][] {
  return [0, 1, 2, 3].map((stroke) => {
    const angle = (stroke * Math.PI) / 4
    const dx = size * Math.cos(angle)
    const dz = size * Math.sin(angle)
    return [viewport(forward - dx, up + 0.05, left - dz), viewport(forward + dx, up + 0.05, left + dz)]
  })
}

/** A deterministic crack as strokes on the ground: `radius` blocks round a place, seven branches from its middle. */
export function groundCrack(forward: number, left: number, radius: number): Vec[][] {
  let seed = 7
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  return Array.from({ length: 7 }, (_, branch) => {
    let angle = (branch * 2 * Math.PI) / 7 + random() * 0.5
    const points: Vec[] = [viewport(forward, 0.04, left)]
    let x = 0
    let z = 0
    for (let step = 1; step <= 5; step++) {
      angle += (random() - 0.5) * 0.7
      x += (radius / 5) * Math.cos(angle)
      z += (radius / 5) * Math.sin(angle)
      points.push(viewport(forward + x, 0.04, left + z))
    }
    return points
  })
}

/**
 * What the pictures draw for one of the four put down at `place` (blocks, the creature's own terms, where the pictures put it), as lines in the pictures' space with their colour:
 * a hazard as its circle doubled (inner and outer edge); a crack as its strokes; a shockwave as its first and its last circle, joined by four spokes; a beam as its line from where it
 * starts to how far it reaches toward the one it fights (`target` blocks ahead) or straight ahead.
 */
export function groundFxLines(fx: GroundFx, place: { forward: number; up: number; left: number }, start?: { forward: number; up: number; left: number }, target?: number): { points: Vec[]; color: string; dashed?: boolean }[] {
  if (fx.type === "flash") {
    const span = (fx.shape === "arc" ? fx.arc ?? 140 : 360) * Math.PI / 180
    const tilt = fx.tilt * Math.PI / 180
    const steps = fx.shape === "glint" ? 8 : 48
    return [{ color: fx.color, points: Array.from({ length: steps + 1 }, (_, i) => {
      const a = span * (i / steps - 0.5)
      const r = fx.radius * (fx.shape === "glint" && i % 2 ? 0.22 : 1)
      return viewport(place.forward + r * Math.cos(a), place.up + 0.9 + r * Math.sin(a) * Math.sin(tilt), place.left + r * Math.sin(a) * Math.cos(tilt))
    }) }]
  }
  if (fx.type === "hazard" && (fx.growth || fx.shape === "square")) {
    const outline = (r: number) => fx.shape === "square" ? [[-1,-1],[-1,1],[1,1],[1,-1],[-1,-1]].map(([f,l]) => viewport(place.forward + r*f!, 0.03, place.left + r*l!)) : groundCircle(place.forward, place.left, r)
    return [{ points: outline(fx.radius), color: fx.color }, ...(fx.growth ? [{ points: outline(fx.growth.max_radius), color: fx.color, dashed: true }] : [])]
  }
  if (fx.type === "hazard") return [{ points: groundCircle(place.forward, place.left, fx.radius), color: fx.color }, { points: groundCircle(place.forward, place.left, fx.radius * 0.6), color: fx.color, dashed: true }]
  if (fx.type === "crack") return groundCrack(place.forward, place.left, fx.radius).map((points) => ({ points, color: fx.color }))
  if (fx.type === "shockwave") {
    const spokes = [0, 1, 2, 3].map((at) => {
      const angle = (at * Math.PI) / 2 + Math.PI / 4
      return { points: [viewport(place.forward + fx.from_radius * Math.cos(angle), 0.03, place.left + fx.from_radius * Math.sin(angle)), viewport(place.forward + fx.to_radius * Math.cos(angle), 0.03, place.left + fx.to_radius * Math.sin(angle))], color: fx.color, dashed: true }
    })
    const top = fx.hit_height === undefined ? [] : [{ points: groundCircle(place.forward, place.left, fx.to_radius, fx.hit_height), color: fx.color, dashed: true }]
    return [...top, ...(fx.pop_blocks ? [0,1,2,3].map(i=>({points:[viewport(place.forward+fx.to_radius/2*Math.cos(i*Math.PI/2),0,place.left+fx.to_radius/2*Math.sin(i*Math.PI/2)),viewport(place.forward+fx.to_radius/2*Math.cos(i*Math.PI/2),fx.pop_blocks!.height,place.left+fx.to_radius/2*Math.sin(i*Math.PI/2))],color:fx.color})) : []), ...(fx.from_radius > 0 ? [{ points: groundCircle(place.forward, place.left, fx.from_radius), color: fx.color }] : []), { points: groundCircle(place.forward, place.left, fx.to_radius, 0.03, 48), color: fx.color }, ...spokes]
  }
  const from = start ?? { forward: fx.forward, up: fx.up, left: fx.left }
  const reach = fx.aim === "target" && target !== undefined ? Math.min(fx.length, Math.hypot(target - from.forward, from.left)) : fx.length
  const toward = fx.aim === "target" && target !== undefined ? { forward: target, up: Math.max(0, Math.min(from.up, 0.9)), left: 0 } : { forward: from.forward + fx.length, up: from.up, left: from.left }
  const span = Math.hypot(toward.forward - from.forward, toward.up - from.up, toward.left - from.left) || 1
  const end = { forward: from.forward + ((toward.forward - from.forward) * reach) / span, up: from.up + ((toward.up - from.up) * reach) / span, left: from.left + ((toward.left - from.left) * reach) / span }
  const side = fx.width / 2
  return [
    { points: [viewport(from.forward, from.up, from.left), viewport(end.forward, end.up, end.left)], color: fx.color },
    { points: [viewport(from.forward, from.up + side, from.left), viewport(end.forward, end.up + side, end.left)], color: fx.color, dashed: true },
    { points: [viewport(from.forward, from.up - side, from.left), viewport(end.forward, end.up - side, end.left)], color: fx.color, dashed: true },
  ]
}

/** Where an event is put down, in the creature's own terms, with the one it fights `target` blocks ahead and hit number `hit` landing at `centre` (the pictures' places). */
export function groundEventPlace(event: GroundEvent | TerrainEvent, target: number, centre: (hit: number) => { forward: number; up: number; left: number }) {
  const origin = event.where === "self" ? { forward: 0, up: 0, left: 0 } : event.where === "target" ? { forward: target, up: 0, left: 0 } : centre(event.hit ?? 0)
  return { forward: origin.forward + event.forward, up: 0, left: origin.left + event.left }
}

/** The lines the pictures say under one: what it is, from when to when. */
export function groundFxCaption(event: GroundFxEvent, title: ((id: string) => string | null) | null = null, aliases?: ParticleAliases) {
  const lasts = event.type === "beam" ? event.until - event.at : event.seconds
  return [`${groundEventWords(event, title, aliases)}。`, `图上画的是它${event.type === "shockwave" ? "开始和最后的两圈" : event.type === "beam" ? "射到的整条线（虚线是宽度）" : "铺开的范围"}，从第 ${num(event.at)} 秒到第 ${num(event.at + lasts)} 秒。`]
}


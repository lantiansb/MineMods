import { z } from "zod"
import type { AbilityMove } from "./ability-dash"
import type { AbilityStage } from "./ability-tactics"
import type { AbilityEvent, AbilityHit } from "./entity-runtime"

/**
 * r29c: one shared ability played bigger or smaller by the creature that uses it (`SharedAbilityUseSchema.scale`), so a boss and a small creature play the same
 * ability asset each at its own size and the asset stays one. Three factors, every number of the ability that measures a length multiplied by one of them:
 * - `size`: what it strikes and shows, counted from its body: the hit shapes (box, ball, arc and ring, beam, cone; not a shape over a boss's whole arena), where a
 *   hit or an event is put (forward/up/left, a pattern's points, a scatter round the target), the radius and width of every ground effect (hazard, crack,
 *   shockwave, flash, beam, temporary terrain, swapped blocks), debris and breaking, lightning's reach, a shake's reach, the scatter of particles and of
 *   effects, the size an effect and a thrown thing are drawn at, a thrown thing's own hit radius, and the distance at which a loop ends near its target.
 * - `reach`: how far it carries itself: a dash's and a leap's distance, a leap's height and how short it stops, a push's strength, how high a boss rises to leave.
 * - `speed`: how fast a dash goes; left out, as `reach`, so a shorter dash takes the same time and still fits its motion.
 * A plain number is all three. Times are never scaled (the creature writes its own `windup`, and its model's motion has its own length), nor are damage
 * (`damage_scale`), knockback, a push or pull put on whoever is struck, how many of anything there are, nor how far a sound, a camera cue or a sky tint carries.
 */
export const SCALE_LIMITS = { min: 0.1, max: 4 } as const

const factor = z.number().finite().min(SCALE_LIMITS.min, `缩放至少 ${SCALE_LIMITS.min} 倍`).max(SCALE_LIMITS.max, `缩放最多 ${SCALE_LIMITS.max} 倍`)
export const AbilityScaleSchema = z.union([factor, z.strictObject({ reach: factor.optional(), size: factor.optional(), speed: factor.optional() })], { error: "scale 写一个倍数（例如 0.5），或者 {reach, size, speed} 分开写" })
export type AbilityScale = z.infer<typeof AbilityScaleSchema>
export type ScaleFactors = { reach: number; size: number; speed: number }

/** The three factors a scale comes to; null when it changes nothing (left out, or every factor 1), so such a use is built exactly as before. */
export function scaleFactors(scale: AbilityScale | undefined): ScaleFactors | null {
  if (scale === undefined) return null
  const reach = typeof scale === "number" ? scale : (scale.reach ?? 1)
  const factors = typeof scale === "number" ? { reach, size: reach, speed: reach } : { reach, size: scale.size ?? 1, speed: scale.speed ?? reach }
  return factors.reach === 1 && factors.size === 1 && factors.speed === 1 ? null : factors
}

/** 「冲刺和跳跃的距离 ×0.33、范围 ×0.5」: a scale in words; empty when it changes nothing. */
export function scaleWords(scale: AbilityScale | undefined) {
  const factors = scaleFactors(scale)
  if (!factors) return ""
  const times = (value: number) => `×${Number(value.toFixed(3))}`
  if (factors.reach === factors.size && factors.speed === factors.reach) return `整体缩放 ${times(factors.size)}（范围、位移距离和冲刺速度一起）`
  return [
    factors.size !== 1 ? `范围和位置 ${times(factors.size)}` : "",
    factors.reach !== 1 ? `位移距离 ${times(factors.reach)}` : "",
    factors.speed !== 1 ? `冲刺速度 ${times(factors.speed)}` : "",
  ].filter(Boolean).join("、")
}

// Every length under these names is a length of what it strikes or shows (`size`), wherever it is in a hit or an event.
const SIZED = new Set(["forward", "up", "left", "width", "height", "depth", "radius", "reach", "inner", "low", "high", "length", "spread", "from_radius", "to_radius", "max_radius", "per_second", "per_hit", "outward"])
// Kept as written, with what is in them: how far a camera cue or a sky tint carries, and how a beam keeps up with its target.
const KEPT = new Set(["camera", "sky_tint", "sweep"])
// Events with nothing of the body's size in them: their reaches are how far they are heard or seen.
const UNSIZED_EVENTS = new Set(["camera", "sky_tint", "sound", "hit_fx", "fixture", "fog", "drop"])

const times = (value: number, by: number) => Number((value * by).toFixed(4))

function sized<T>(value: T, by: number): T {
  if (Array.isArray(value)) return value.map((child) => sized(child, by)) as T
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (KEPT.has(key)) return [key, child]
    if (typeof child === "number") return [key, SIZED.has(key) ? times(child, by) : child]
    // A leave's return place is a range of two numbers ahead and to the left.
    if (Array.isArray(child) && child.every((entry) => typeof entry === "number")) return [key, SIZED.has(key) ? child.map((entry: number) => times(entry, by)) : child]
    return [key, sized(child, by)]
  })) as T
}

function scaledHit(hit: AbilityHit, by: number): AbilityHit {
  if (hit.type === "gameplay") return hit
  if (hit.type === "shot") return { ...hit, forward: times(hit.forward, by), up: times(hit.up, by) }
  if (hit.type === "projectile")
    return {
      ...hit,
      radius: times(hit.radius, by),
      size: times(hit.size ?? 1, by),
      ...("sky" in hit.from ? { from: { sky: { ...hit.from.sky, over: sized(hit.from.sky.over, by) } } } : {}),
      ...(hit.impact ? { impact: sized(hit.impact, by) } : {}),
      ...(hit.trail ? { trail: { ...hit.trail, spread: times(hit.trail.spread, by) } } : {}),
    }
  return {
    ...hit,
    // A hit over a boss's whole arena is as wide as the arena, whoever plays it.
    ...(hit.shape.type === "arena" ? {} : { shape: sized(hit.shape, by) }),
    ...(hit.place === undefined ? {} : { place: sized(hit.place, by) }),
  }
}

function scaledEvent(event: AbilityEvent, by: number): AbilityEvent {
  if (UNSIZED_EVENTS.has(event.type)) return event
  const scaled = sized(event, by)
  if (scaled.type === "effect") return { ...scaled, size: times(event.type === "effect" ? (event.size ?? 1) : 1, by) }
  // Swapped blocks fill whole blocks upward.
  if (scaled.type === "block_swap") return { ...scaled, area: { ...scaled.area, height: Math.max(1, Math.round(event.type === "block_swap" ? event.area.height * by : 1)) } }
  return scaled
}

function scaledMove(move: AbilityMove, factors: ScaleFactors): AbilityMove {
  const { reach, size, speed } = factors
  if (!("type" in move)) return { ...move, forward: times(move.forward, reach), up: times(move.up, reach) }
  if (move.type === "dash") return { ...move, distance: times(move.distance, reach), speed: times(move.speed, speed), ...(move.impact ? { impact: sized(move.impact, size) } : {}) }
  if (move.type === "leap") return { ...move, max_distance: times(move.max_distance, reach), height: times(move.height, reach), ...(move.short === undefined ? {} : { short: times(move.short, reach) }) }
  return { ...move, rise: times(move.rise, reach), back: { ...move.back, place: typeof move.back.place === "string" ? move.back.place : sized(move.back.place, reach) } }
}

/**
 * The timeline of one shared ability at the size its user plays it (`scaleFactors`), every length as the module comment says; what parses it (`AbilitySchema`)
 * then holds every scaled number to its field's own bounds, so a scale that takes one past them is refused with that field named.
 */
export function scaledTimeline<T extends { hits: AbilityHit[]; events: AbilityEvent[]; moves: AbilityMove[]; stages?: AbilityStage[] | undefined }>(timeline: T, factors: ScaleFactors): T {
  const { size } = factors
  return {
    ...timeline,
    hits: size === 1 ? timeline.hits : timeline.hits.map((hit) => scaledHit(hit, size)),
    events: size === 1 ? timeline.events : timeline.events.map((event) => scaledEvent(event, size)),
    moves: timeline.moves.map((move) => scaledMove(move, factors)),
    ...(timeline.stages && size !== 1 ? { stages: timeline.stages.map((stage) => (stage.end ? { ...stage, end: sized(stage.end, size) } : stage)) } : {}),
  }
}

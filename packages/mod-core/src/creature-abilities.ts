import { SOUND_RANGE_WORDS, soundReach } from "./sound-range"
import { abilityRef, boneRef, clipRef, comboRef, partRef } from "./finding-refs"
import { fixtureWords } from "./fixture-events"
import { CREATURE_COMBAT_GUIDE, PARTICLE_DESIGN_GUIDE } from "./combat-design-words"
import { abilityInterruptionWords, bearingConditionWords, bearingMatches, combatAdvice, combatBreaks, combatWeight, interruptProgress, type Stagger, type Guard, type Interrupt } from "./combat"
import { cameraWords, skyTintWords } from "./cinematic"
import { motionKnown, motionName } from "@minemods/studio-ai/making"
import { TERRAIN_INSTRUCTIONS, isTerrainEvent, terrainWords } from "./terrain"
import { GROUND_FX_INSTRUCTIONS, groundEventWords, groundFxEvents, isGroundFx } from "./ground-fx"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { GAME_PIXELS, MOTION_VISIBLE, measureMotion, posedCorners, type MotionClip } from "@minemods/studio-ai/model-motion"
import { ABILITY_EFFECTS, ABILITY_LIMITS, ABILITY_PARTICLES, COMBO_LIMITS, comboTimeline, ABILITY_PROJECTILES, ABILITY_SOUNDS, EFFECT_LIMITS, EFFECT_ZONE_TOLERANCE, RESERVED_CLIPS, TICKS } from "./ability-words"
import { BOSS_EVENT_INSTRUCTIONS, bossWords } from "./creature-boss"
import { hitBone, justifiedReason, type Ability, type AbilityHit, type AbilityShape, type Boss, type Combo, type Flight, type Habits, type Hitbox } from "./entity-runtime"
import { FLIGHT_LIMITS, flightMotions } from "./flight-words"
import { EFFECT_SIZE, HIT_PLACE_LIMITS, WARN_COLORS, WARN_LIMITS, WARN_LOOKS } from "./ability-words"
import { hitElsewhere, hitPlace, shapeInner, type HitPlace, type HitWarn } from "./entity-runtime"
import { isSoundAsset } from "./sound"
import { scatterWords, extendedEmit, emitTicks, particleLabel, EMITTER_INSTRUCTIONS, SCATTER_INSTRUCTIONS, type Emitter, type ParticleNames } from "./particle-emission"
import { TRAIL_INSTRUCTIONS, particleWords, trailEvents, trailIssues, trailTip, trailWords } from "./ability-trails"
import { isDash, DASH_INSTRUCTIONS, dashWords, forceWords, hitForce, isPush, movesForward } from "./ability-dash"
import { IMPACT_INSTRUCTIONS } from "./impact-fx"
import { dashFaces, dashForceFaces, dashForceLines, dashForceReview, hitForceFaces, leapFaces, leapLines } from "./ability-dash-words"
import { LIGHTNING_LIMITS } from "./weather-words"
import { LIGHTNING_INSTRUCTIONS, isLightningHit, lightningEvents, lightningWords, strikeOf, struckAbility } from "./boss-weather"
import { projectileIssues, projectileWords } from "./ability-projectile"
import { PROJECTILE_INSTRUCTIONS } from "./projectile-words"
import { ARENA_ABILITY_INSTRUCTIONS, arenaShapeWords, fogEventWords, isLeave, leaveWords, plainShape, safeWords } from "./arena"
import { PARRY_INSTRUCTIONS, PARRY_SUMMARY, parryReview, parryStartWords, parryWords, type OnHurt } from "./ability-parry"
import { branchWords, isLeap, leapWords, stagePlan, stageWords, trackWords } from "./ability-tactics"

/**
 * A creature's abilities (招式) between the document and everything that reads it: the ticks the generated
 * Java acts on (`abilityPlan`, the one place seconds become ticks), the life of one run of an ability as a
 * pure function (`abilityStep`, what the generated tick method does), what is wrong with an ability against
 * the model it plays on, where a hit lands in the model's own space so it can be drawn and measured, which
 * motion of a model is started by what (`creatureBindings`), and all of it in plain words.
 * Nothing here knows a subject: every sentence is made from the numbers and names of the document.
 * No Node APIs: the app's window reads it too.
 */

type Vec = [number, number, number]
type Clip = { name: string; length: number }
const num = (value: number, digits = 2) => Number(value.toFixed(digits))
const span = (min: number, max: number) => (min === max ? String(num(min)) : `${num(min)}–${num(max)}`)

// ---- timing ----

/** A moment of an ability as the server tick it happens on, counted from the tick the ability started (tick 0). */
export const abilityTick = (seconds: number) => Math.round(seconds * TICKS)

/**
 * One ability as ticks: what the generated Java is written from and what every sentence about its timing
 * says. No moment lies after the end, and a hit never lies before the end of getting ready.
 */
export function abilityPlan(ability: Ability) {
  const length = Math.max(1, abilityTick(ability.length))
  const at = (seconds: number) => Math.min(length, abilityTick(seconds))
  const windup = at(ability.windup)
  return {
    id: ability.id,
    clip: ability.clip,
    windup,
    length,
    // Boss 能力 14: one started by a blow waits its `on_hurt.cooldown` (its `start.cooldown` is 0).
    cooldown: abilityTick(ability.on_hurt?.cooldown ?? ability.start.cooldown),
    hits: ability.hits.map((hit, index) => ({ index, tick: Math.max(windup, at(hit.at)) })),
    // The pushes it gives itself, each at its moment (by its place in `moves`); a dash runs over many ticks and has a plan of its own (`dashPlan`, ability-dash.ts).
    moves: ability.moves.flatMap((move, index) => (isPush(move) ? [{ index, tick: at(move.at) }] : [])),
    events: ability.events.flatMap((event, index) => (event.type === "particle" ? emitTicks(event) : [at(event.at)]).map((tick) => ({ index, tick }))),
  }
}
export type AbilityPlan = ReturnType<typeof abilityPlan>

/** What a creature's abilities are doing between two ticks: which one runs (null: none), how far into it, and the age from which each may start again. */
export type AbilityRun = { running: number | null; tick: number; ready_at: number[]; hurt_total?: number; hurt_hits?: number }
export const abilityIdle = (count: number): AbilityRun => ({ running: null, tick: 0, ready_at: Array.from({ length: count }, () => 0) })

/**
 * One server tick of a creature's abilities, as the generated `tickAbility` does it. `start` is the ability
 * its goal picked on this tick (ignored while one runs or while that one is still waiting). A run that is
 * cut short (it died, the one it fights is gone, it was hurt and the ability says that stops it) does
 * nothing more: no hit of that tick or of any later one. The wait counts from the end, cut short or not.
 */
export function abilityStep(plans: readonly (AbilityPlan & { stopped_by_hurt: boolean; interrupt?: Interrupt | undefined })[], run: AbilityRun, input: { age: number; dead: boolean; target: boolean; hurt: boolean | { lost: number; max: number; part?: string | undefined }; breakTriggered?: boolean; start: number | null }) {
  const nothing = { hits: [] as number[], moves: [] as number[], events: [] as number[] }
  const started = run.running === null && input.start !== null && !input.dead && input.target && input.age >= run.ready_at[input.start]!
  // Started by the goal earlier on this very tick: the tick below is its tick 0.
  const now = started ? { ...run, running: input.start, tick: -1 } : run
  if (now.running === null) return { run: now, ended: null, ...nothing }
  const plan = plans[now.running]!
  const over = (ended: "death" | "target" | "hurt" | "done") => ({ run: { running: null, tick: 0, ready_at: now.ready_at.map((ready, index) => (index === now.running ? input.age + plan.cooldown : ready)) }, ended })
  const progress = !started && plan.interrupt && typeof input.hurt === "object" ? interruptProgress(plan.interrupt, input.hurt, now.tick, now.hurt_total ?? 0, now.hurt_hits ?? 0) : null
  const cutByImpact = !started && (input.breakTriggered || (plan.interrupt ? progress?.stop : input.hurt) && plan.stopped_by_hurt)
  const cut = input.dead ? "death" : !input.target ? "target" : cutByImpact ? "hurt" : null
  if (cut) return { ...over(cut), ...nothing }
  const tick = now.tick + 1
  const due = { hits: plan.hits.filter((hit) => hit.tick === tick).map((hit) => hit.index), moves: plan.moves.filter((move) => move.tick === tick).map((move) => move.index), events: plan.events.filter((event) => event.tick === tick).map((event) => event.index) }
  return tick >= plan.length ? { ...over("done"), ...due } : { run: { ...now, tick, ...(progress ? { hurt_total: progress.total, hurt_hits: progress.hits } : {}) }, ended: null, ...due }
}

// ---- where an area hit is put down, and the warning before it (Boss 能力 3) ----

/**
 * Per hit, its warning as server ticks (`abilityPlan`'s ticks): `start`, the tick its places are decided and every player's game near them is told to draw
 * them, and `ticks`, how long that is before the hit. Null for a hit without a warning, and for one whose warning would start on the tick of the hit itself.
 */
export function warnPlan(ability: Ability) {
  const plan = abilityPlan(ability)
  return ability.hits.map((hit, index) => {
    if (hit.type !== "area" || !hit.warn) return null
    const tick = plan.hits[index]!.tick
    const start = Math.max(0, tick - abilityTick(hit.warn.seconds))
    return tick > start ? { index, start, ticks: tick - start } : null
  })
}

/**
 * The numbers the server draws places by (mulberry32 on 32-bit integers): the generated `abilityRandom` takes exactly these steps in Java's `int`, so a cast
 * with the same seed is laid out the same here and in the game. The game picks a new seed every cast; the pictures draw the one in `WARN_LIMITS.seed`.
 */
export function placeRandom(seed: number) {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** The seed one hit of a cast draws its places from: the cast's own, mixed with which hit it is, so two hits of a cast land apart. The generated `abilityPlaceAround` mixes it the same way. */
export const placeSeed = (seed: number, index: number) => (seed ^ Math.imul(index + 1, 0x9e3779b9 | 0)) | 0

/** `around_target`: where its places lie from the feet of the one it fights, in the creature's own terms as it faces when they are decided (blocks ahead, to its own left): evenly over a disc of radius `spread`. */
export function aroundOffsets(count: number, spread: number, seed: number) {
  const roll = placeRandom(seed)
  return Array.from({ length: count }, () => {
    const angle = roll() * 2 * Math.PI
    const far = Math.sqrt(roll()) * spread
    return { forward: far * Math.cos(angle), left: far * Math.sin(angle) }
  })
}

/** Where the pictures put the one an ability fights, for a hit that lands at its feet: straight ahead, in the middle of the distances the ability starts at, on the creature's own ground. */
export const placeTarget = (ability: Pick<Ability, "start">) => num((ability.start.min_distance + ability.start.max_distance) / 2)

/**
 * The places an area hit is counted from, in the creature's own terms (blocks; its feet, the way it faces), with the one it fights `target` blocks straight ahead on the same ground
 * and `seed` the cast's own number: one place, its feet, for a hit that names no `place` (or "self"). What the game does with them (`abilityPlace…` in the generated Java) is the same arithmetic.
 */
export function hitPlaces(hit: AbilityHit, index: number, target: number, seed: number = WARN_LIMITS.seed): Place[] {
  const place = hit.type === "area" ? hitPlace(hit) : "self"
  // Boss 能力 13: the middle of its arena is drawn where it stands: the pictures put it at the middle of its arena.
  if (place === "self" || place === "center") return [{ forward: 0, up: 0, left: 0 }]
  if (place === "target") return [{ forward: target, up: 0, left: 0 }]
  if ("fixture" in place) return [] // The live arena supplies the landing point.
  if (place.type === "pattern") return place.points.map((point) => ({ forward: point.forward, up: 0, left: point.left }))
  return aroundOffsets(place.count, place.spread, placeSeed(seed, index)).map((offset) => ({ forward: num(target + offset.forward, 4), up: 0, left: num(offset.left, 4) }))
}

/** Preview a reserved leap at its clamped destination, including the stand-off distance. */
export function abilityHitPlaces(ability:Pick<Ability,"hits"> & {moves?:readonly unknown[]},slot:number,target:number) {
  const hit=ability.hits[slot]
  if (!hit) return []
  const leap=ability.moves?.find(isLeap)
  const distance=leap?.landing_hit === slot ? Math.max(0,Math.min(leap.max_distance,target-(leap.short ?? 0))) : target
  return hitPlaces(hit,slot,distance)
}

/** True for an area hit put down at the feet of the one it fights, or round them. */
export const hitOnTarget = (hit: AbilityHit) => hit.type === "area" && ((place) => place === "target" || (typeof place === "object" && place.type === "around_target"))(hitPlace(hit))

/** True for an area hit whose places are decided before it lands and kept: one that lands somewhere else, or one that is warned of. Only such a hit is checked at fixed places in the game. */
export const hitFixed = (hit: AbilityHit) => hit.type === "area" && (hitElsewhere(hit) || hit.warn !== undefined)

/** How far one of the places of a hit is to be walked out of by the one standing in its middle, in blocks: the nearest edge of what the shape covers on the ground, and half a player. */
export function warnEscape(given: AbilityShape) {
  const shape = plainShape(given)
  const inside = shape.type === "sphere" ? shape.radius - Math.hypot(shape.forward, shape.left) : shape.type === "box" ? Math.min(shape.width / 2 - Math.abs(shape.left), shape.depth / 2 - Math.abs(shape.forward)) : shape.type === "arc" && shape.angle >= 360 ? (shapeInner(shape) > 0 ? (shape.reach - shapeInner(shape)) / 2 : shape.reach) : 0
  return num(Math.max(0, inside) + 0.3)
}

// ---- where a hit lands, in the model's own space ----

/** Model pixels in a block: the game draws a creature's model at this scale. */
const BLOCK = 16
/** A place in the creature's own terms (blocks) as a point of the viewport's space (model pixels): the model faces -Z and its own left is the viewport's -X. */
export const abilityPlace = (forward: number, up: number, left: number): Vec => [-left * BLOCK, up * BLOCK, -forward * BLOCK]

/** A place on the creature in its own terms (blocks): ahead of its feet, above them, to its own left (negative: behind, below, right). */
export type Place = { forward: number; up: number; left: number }
const placeOf = (point: Vec): Place => ({ forward: num(-point[2] / BLOCK, 4) || 0, up: num(point[1] / BLOCK, 4) || 0, left: num(-point[0] / BLOCK, 4) || 0 })

/** Vanilla 1.21.1 \`LivingEntity\`: a creature that was hurt keeps \`timeUntilRegen\` at 20 and takes another blow while it is above 10 only by how much heavier the new one is: 10 ticks. */
export const HURT_COOLDOWN = 10

/** A cube with no thickness (a sheet) still weighs half a model pixel a side when the middle of a bone is found: the same measure `creature-hitbox.ts` takes for a thin cube. */
const THIN_CUBE = 0.5

/**
 * Where a hit that names a bone (`hit.bone`) counts from, in the creature's own terms and at the size the model is built: the middle of that
 * bone's own cubes (each weighing as much as its volume, a bone without a cube: its pivot) as the ability's own motion holds it at the moment
 * the hit is counted. The moment is the server tick of the hit (`abilityPlan`) on the motion's own clock, which is what the generated Java checks
 * on. It is the pose of `posedCorners` (studio-ai model-motion.ts), the arithmetic every picture and measure of a pose already uses; a bone's pivot is
 * found by giving it a cube with no size at its pivot, whose corner is the pivot itself. Null when the hit names no bone, or the model lacks the
 * bone or the motion (the build refuses that: `abilityIssues`).
 */
export function hitAnchor(ability: Ability, index: number, design: Pick<ModelDesign, "bones" | "animations">): Place | null {
  const named = ability.hits[index]
  const name = named && hitBone(named)
  if (name === undefined) return null
  const playing = abilityClipAt(ability, design, abilityPlan(ability).hits[index]!.tick / TICKS)
  return playing && bonePlace(design, name, playing.clip, playing.time)
}

/**
 * 第 3 步: the motion an ability shows at `seconds` of it, and how far into that motion (seconds) — what every player's game plays then. Its own clip from its start, or, from the
 * start of a stage that switches the motion (`stages`, `abilityStageClip`), that stage's clip from the stage's own start: a loop's over and over, any other held at its last moment
 * past its end (as the ability's own clip is). As the ability runs in full: a loop that ends early moves the game on, which no moment written beforehand can know. Null when the
 * model lacks that motion. What a hit that names a bone counts from (`hitAnchor`), and where a beam that names one starts.
 */
export function abilityClipAt(ability: Pick<Ability, "clip" | "stages" | "length">, design: Pick<ModelDesign, "animations">, seconds: number): { clip: MotionClip; time: number } | null {
  const tick = seconds * TICKS
  const stage = stagePlan(ability).filter((value) => value.clip !== null && value.from <= tick + 1e-6).at(-1)
  const clip = design.animations.find((animation) => animation.name === (stage?.clip ?? ability.clip)) as MotionClip | undefined
  if (!clip) return null
  const time = Math.max(0, seconds - (stage?.from ?? 0) / TICKS)
  return { clip, time: stage?.kind === "loop" && clip.length > 0 ? time % clip.length : Math.min(time, clip.length) }
}

/**
 * Where a bone is, in the creature's own terms and at the size the model is built: the middle of that bone's own cubes (each weighing as much as its volume; a bone
 * without a cube: its pivot) as `clip` holds it at `time` seconds (null: as built). The pose is `posedCorners`'s (studio-ai model-motion.ts); a bone's pivot is found by
 * giving it a cube with no size at its pivot, whose corner is the pivot itself. What a hit that names a bone counts from (`hitAnchor`), and what a collision box of a part
 * that names a bone follows (`hitbox-follow.ts`). Null when the model has no such bone.
 */
export function bonePlace(design: Pick<ModelDesign, "bones">, name: string, clip: MotionClip | null, time: number): Place | null {
  return bonePlaces(design, [name], clip, time)[0] ?? null
}

/** `bonePlace` for several bones at one moment, posing the model once: one place (or null) per name, in order. */
export function bonePlaces(design: Pick<ModelDesign, "bones">, names: readonly string[], clip: MotionClip | null, time: number): (Place | null)[] {
  const wanted = new Set(names)
  const marked = design.bones.map((value) => (wanted.has(value.name) ? { ...value, cubes: [...value.cubes, { name: "pivot", origin: value.pivot, size: [0, 0, 0] as Vec, faces: {} } as never] } : value))
  const corners = posedCorners({ bones: marked }, clip, time)
  // Where each bone's cubes start among the corners (eight a cube).
  const firsts: number[] = []
  marked.forEach((value, index) => firsts.push(index ? firsts[index - 1]! + marked[index - 1]!.cubes.length : 0))
  return names.map((name) => {
    const index = design.bones.findIndex((value) => value.name === name)
    if (index < 0) return null
    const bone = design.bones[index]!
    const first = firsts[index]!
    // The marker is the last cube of a marked bone: its first corner is the pivot.
    if (!bone.cubes.length) return placeOf(corners[(first + bone.cubes.length) * 8]!)
    const cubes = bone.cubes.map((cube, at) => {
      const mine = corners.slice((first + at) * 8, (first + at + 1) * 8)
      return { middle: [0, 1, 2].map((axis) => mine.reduce((sum, corner) => sum + corner[axis]!, 0) / 8) as Vec, weight: cube.size.reduce((volume, side) => volume * Math.max(side, THIN_CUBE), 1) }
    })
    const whole = cubes.reduce((sum, cube) => sum + cube.weight, 0)
    return placeOf([0, 1, 2].map((axis) => cubes.reduce((sum, cube) => sum + cube.middle[axis]! * cube.weight, 0) / whole) as Vec)
  })
}

/** The places every hit of every ability counts from: per ability, per hit, null where the hit names no bone (or the model cannot say). */
export const hitAnchors = (abilities: readonly Ability[], design: Pick<ModelDesign, "bones" | "animations">) => abilities.map((ability) => ability.hits.map((_, index) => hitAnchor(ability, index, design)))

/** What a hit is drawn and measured as: its shape, for a shot the small ball the projectile leaves from, and for what a gameplay does the same ball at its feet (it has no place of its own). */
const hitShape = (hit: AbilityHit): AbilityShape => (hit.type === "area" ? hit.shape : { type: "sphere", forward: hit.type === "shot" ? hit.forward : 0, up: hit.type === "shot" ? hit.up : 0, left: 0, radius: 0.25 })

/** The middle of where a hit lands, in the creature's own terms from where the hit counts from: what a striking motion goes toward, and where a dive brings the hit to. */
function focusPlace(given: AbilityShape): Place {
  const shape = plainShape(given)
  if (shape.type === "arc") return { forward: (shapeInner(shape) + shape.reach) / 2, up: (shape.low + shape.high) / 2, left: 0 }
  if (shape.type === "line" || shape.type === "cone") return { forward: shape.length / 2, up: shape.up, left: 0 }
  return { forward: shape.forward, up: shape.up, left: shape.left }
}

const shapeFocus = (shape: AbilityShape): Vec => ((place) => abilityPlace(place.forward, place.up, place.left))(focusPlace(shape))

/**
 * broad11 w1: where a dive brings its first hit when that hit counts from a bone. The charge used to bring the middle of the body to the middle of the one it fights,
 * so a beak 2 blocks ahead of the middle was 2 blocks past them when the hit was counted, and an arc that reaches ahead of the beak met no one. Now the bone and the
 * middle of what the hit reaches end there instead: `[forward, up, left]` of the bone at the size the model is built (the creature's own size scales it) and
 * `[forward, up, left]` of the middle of the hit's shape from the bone (blocks, as the shape is written), for the generated `flightDiveReached`. Null for an ability
 * that is not a dive, or whose first hit counts from the feet (the middle of the body goes to theirs, as it always did).
 */
export function diveReach(ability: Ability, anchors: readonly (Place | null)[]): number[] | null {
  if (!ability.dive || !ability.hits.length) return null
  const plan = abilityPlan(ability).hits
  const first = plan.reduce((best, hit) => (hit.tick < best.tick ? hit : best)).index
  const anchor = anchors[first] ?? null
  if (!anchor) return null
  const focus = focusPlace(hitShape(ability.hits[first]!))
  return [anchor.forward, anchor.up, anchor.left, focus.forward, focus.up, focus.left].map((value) => num(value, 4) || 0)
}

/**
 * broad11 w1: a beam or a cone that aims at the one it fights goes from where it starts to them, so one that starts off the middle of the body (a wing tip) goes slantwise
 * across to someone straight ahead, as the generated `abilityDirection` does. For what is drawn and measured, that one is taken to stand straight ahead in the middle
 * of the distances the ability starts at (as `levelReach` takes them): the turn, about the bone, that the shape takes. Null where nothing turns.
 */
function aimedTurn(ability: Pick<Ability, "start">, shape: AbilityShape, anchor: Place | null) {
  if (!anchor || !shapeAims(shape) || Math.abs(anchor.left) < 1e-6) return null
  const distance = (ability.start.min_distance + ability.start.max_distance) / 2
  const ahead = Math.max(0.5, distance - anchor.forward)
  const long = Math.hypot(ahead, anchor.left)
  return { forward: ahead / long, left: -anchor.left / long }
}

/** A point in the model's frame turned about the bone by `turn` (forward goes to `turn`, its own left stays square to it). */
const turned = (point: Vec, turn: { forward: number; left: number } | null): Vec => {
  if (!turn) return point
  const forward = -point[2]
  const left = -point[0]
  return [-(forward * turn.left + left * turn.forward), point[1], -(forward * turn.forward - left * turn.left)]
}

/** J2: true for a hit shape that points at the one the creature fights and so tilts with how high that one stands: a line or a cone not written `aim: "level"`. */
export const shapeAims = (shape: AbilityShape): shape is Extract<AbilityShape, { type: "line" | "cone" }> => (shape.type === "line" || shape.type === "cone") && shape.aim !== "level"

/** A pattern is placed in the caster's frame. Target, arena centre and fixture locations do not turn with it. */
const patternTurns = (place: HitPlace | undefined) =>
  typeof place === "object" && place.type === "pattern" && place.points.some(point => point.forward !== 0 || point.left !== 0)

/** Whether any authored strike uses a direction. Visuals can follow a bone without moving a hit. */
export function hasDirectionalStrike(ability: Ability): boolean {
  if (ability.moves.some(move => isDash(move) && move.hit !== null)) return true
  return ability.hits.some(hit => {
    if (hit.type === "gameplay") return false // A callback declares no hit geometry.
    if (hit.type !== "area") return true
    if (hit.bone !== undefined || patternTurns(hit.place)) return true
    const shape = hit.shape
    if (shape.type === "arena") return false
    if (shape.type === "sphere") return shape.forward !== 0 || shape.left !== 0
    return shape.type !== "arc" || shape.angle !== 360
  }) || ability.events.some(event => {
    if (event.type === "lightning") return patternTurns(event.place)
    if (event.type === "hazard" || event.type === "shockwave") return event.forward !== 0 || event.left !== 0
    return event.type === "beam"
  })
}

/** The most a walking creature turns in a tick: the cap of the generated `abilityAim` and, on the ground, of `flightTurnCap`. */
export const GROUND_TURN = 30

/**
 * epic game5: a frost dragon's tail sweep (`lock`, a sphere of radius 3 whose centre is 8.55 ahead at the hit) was started 18 times and hit 0: it stepped back with its body turned away from the
 * player and began the sweep that way, and a `lock` ability never turns. How far off its target the body may point when an ability whose hits lie ahead of it (an area hit not aimed at the target:
 * its landing spot depends on which way the body faces) starts, in degrees; 180 for any (nothing to hold it to).
 * - `lock` (it holds the way it faced): the bearing error at which the target still stands inside the hit when the hit lands. Seen from the creature, the centre of a sphere of radius r that lies `d` ahead
 *   is passed by a target `d` away at a bearing error of atan(r / d), a box of half width w by atan(w / d), a level beam of radius r and length L the same with its middle `L / 2` ahead; an arc or a cone
 *   covers its own half angle. `d` counts the bone the hit comes from (`anchors`, at the size the model is built); the smallest over the ability's such hits holds, so each of them can land.
 * - `track` (it turns to the target while getting ready): what it can turn by the end of getting ready, `GROUND_TURN` a tick over the ticks of getting ready and one more, as `flightFaces` does in the air;
 *   180 (none) from a wind-up of 5 ticks on.
 * A dive and an ability that starts only in the air are held by the flight (`flightFaces`), not here.
 */
export function faceTolerance(ability: Ability, anchors: readonly (Place | null)[], steadyTurn?: number): number {
  if (ability.start.keep_heading) return 180
  if (ability.dive || ability.where === "air" || !hasDirectionalStrike(ability)) return 180
  const degrees = (opposite: number, adjacent: number) => Math.floor(((Math.atan2(opposite, adjacent) * 180) / Math.PI) * 100) / 100
  const covers = (given: AbilityShape, bone: number) =>
    ((shape) =>
    shape.type === "sphere" ? degrees(shape.radius, bone + shape.forward) : shape.type === "box" ? degrees(shape.width / 2, bone + shape.forward) : shape.type === "line" ? degrees(shape.radius, bone + shape.length / 2) : shape.angle / 2)(plainShape(given))
  // Boss 能力 3: a hit put down somewhere else lands where its places are, not where the body points.
  const ahead = ability.hits.flatMap((hit, index) => (hit.type === "area" && !shapeAims(hit.shape) && !hitElsewhere(hit) ? [covers(hit.shape, anchors[index]?.forward ?? 0)] : []))
  if (!ahead.length) return 180
  if (ability.facing === "track" && steadyTurn !== undefined) return Math.min(180, Math.min(...ahead) + steadyTurn / 20 * Math.round((ability.track_until ?? ability.windup) * 20))
  if (ability.facing === "track") return Math.min(180, GROUND_TURN * (abilityPlan(ability).windup + 1))
  return Math.min(180, ...ahead)
}

/** Only say a hit is front-only when its position and shape make that clear. */
export function abilityCanReachBehind(ability: Ability) {
  return ability.hits.some(hit => {
    if (hit.type !== "area") return hit.type === "projectile"
    if (hitElsewhere(hit) || hitBone(hit) !== undefined) return true
    const shape = plainShape(hit.shape)
    if (shape.type === "sphere") return shape.forward < shape.radius
    if (shape.type === "box") return shape.forward < shape.depth / 2
    return (shape.type === "arc" || shape.type === "cone") && shape.angle > 180
  })
}

/**
 * J2: a player is 1.8 blocks tall, and what aims at one aims at the middle of the body (the generated
 * `abilityAim` reads `getBodyY(0.5)`): 0.9 above the feet. `near`: the generated `abilityDirection` never takes
 * its target as nearer than this, level, so the direction is always defined.
 */
export const AIM_TARGET = { tall: 1.8, middle: 0.9, near: 0.5 } as const

/**
 * J2: how far what aims from `up` above the creature's feet (and `forward` ahead of them) is tilted, in radians (up is
 * positive), when the one it fights stands `distance` blocks straight ahead with its feet `height` above the
 * creature's own: the same sum the generated `abilityDirection` does.
 */
export const aimPitch = (up: number, forward: number, stand: { distance: number; height: number }) => Math.atan2(stand.height + AIM_TARGET.middle - up, Math.max(AIM_TARGET.near, stand.distance - forward))

/**
 * How far a point of the model (viewport space, model pixels) is from a hit shape, in model pixels; 0 inside
 * it. A beam and a cone are taken as aimed level and straight ahead, which is how they are drawn too: in the
 * game they point at whoever the creature fights. `pitch` (J2, radians, up positive) tilts a beam or a cone
 * about where it starts, as it is when its target stands higher or lower.
 */
export function shapeGap(given: AbilityShape, point: Vec, pitch = 0) {
  const shape = plainShape(given)
  const tilt = pitch !== 0 && (shape.type === "line" || shape.type === "cone") ? { ahead: -point[2] / BLOCK, above: point[1] / BLOCK - shape.up, base: shape.up } : null
  const forward = tilt ? tilt.ahead * Math.cos(pitch) + tilt.above * Math.sin(pitch) : -point[2] / BLOCK
  const up = tilt ? tilt.base - tilt.ahead * Math.sin(pitch) + tilt.above * Math.cos(pitch) : point[1] / BLOCK
  const left = -point[0] / BLOCK
  const beside = (distance: number, off: number, far: number) => (off >= Math.PI / 2 ? distance : Math.hypot(distance * Math.sin(off), Math.max(0, distance * Math.cos(off) - far)))
  if (shape.type === "box") return BLOCK * Math.hypot(Math.max(0, Math.abs(forward - shape.forward) - shape.depth / 2), Math.max(0, Math.abs(up - shape.up) - shape.height / 2), Math.max(0, Math.abs(left - shape.left) - shape.width / 2))
  if (shape.type === "sphere") return BLOCK * Math.max(0, Math.hypot(forward - shape.forward, up - shape.up, left - shape.left) - shape.radius)
  if (shape.type === "line") return BLOCK * Math.max(0, Math.hypot(forward - Math.min(Math.max(forward, 0), shape.length), up - shape.up, left) - shape.radius)
  if (shape.type === "cone") {
    const distance = Math.hypot(forward, up - shape.up, left)
    const off = distance ? Math.acos(Math.min(1, Math.max(-1, forward / distance))) - (shape.angle * Math.PI) / 360 : 0
    return BLOCK * (off <= 0 ? Math.max(0, distance - shape.length) : beside(distance, off, shape.length))
  }
  const flat = Math.hypot(forward, left)
  const off = Math.abs(Math.atan2(left, forward)) - (shape.angle * Math.PI) / 360
  // An arc's hollow middle (`inner`): a point in it is as far from what is hit as from the inner edge.
  const hollow = Math.max(0, shapeInner(shape) - flat)
  return BLOCK * Math.hypot(off <= 0 || flat === 0 ? Math.max(hollow, flat - shape.reach) : beside(flat, off, shape.reach), Math.max(0, shape.low - up, up - shape.high))
}

/** How far ahead of the creature a shape reaches at most, in blocks. */
const shapeFar = (given: AbilityShape) => ((shape) => shape.type === "arc" ? shape.reach : shape.type === "line" || shape.type === "cone" ? shape.length : shape.type === "box" ? shape.forward + shape.depth / 2 : shape.forward + shape.radius)(plainShape(given))

/**
 * r29c (狍鸮): where along the ground a shape meets the straight way `angle` points from the creature's feet (degrees as `target_bearing` counts them: 0 ahead, right positive, ±180 behind),
 * as the distances it enters and leaves at; `offset` moves the shape's middle (a bone's place). A line or a cone aims at the one it fights whichever way that is. Null when that way misses it.
 */
function shapeToward(given: AbilityShape, offset: { forward: number; left: number }, angle: number): [number, number] | null {
  const shape = plainShape(given)
  const forward = Math.cos((angle * Math.PI) / 180)
  const left = -Math.sin((angle * Math.PI) / 180)
  if (shape.type === "line" || shape.type === "cone") return [0, shape.length + (shape.type === "line" ? shape.radius : 0)]
  if (shape.type === "box") {
    const slab = (from: number, to: number, along: number): [number, number] | null =>
      Math.abs(along) < 1e-9 ? (from <= 0 && to >= 0 ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY] : null) : [Math.min(from / along, to / along), Math.max(from / along, to / along)]
    const depth = slab(offset.forward + shape.forward - shape.depth / 2, offset.forward + shape.forward + shape.depth / 2, forward)
    const width = slab(offset.left + shape.left - shape.width / 2, offset.left + shape.left + shape.width / 2, left)
    if (!depth || !width) return null
    const span: [number, number] = [Math.max(depth[0], width[0]), Math.min(depth[1], width[1])]
    return span[0] > span[1] || span[1] < 0 ? null : span
  }
  // A sphere, and an arc as the round of its reach within its own angle either side of ahead.
  if (shape.type === "arc" && Math.abs(angle) > shape.angle / 2) return null
  const middle = shape.type === "arc" ? offset : { forward: offset.forward + shape.forward, left: offset.left + shape.left }
  const radius = shape.type === "arc" ? shape.reach : shape.radius
  const along = middle.forward * forward + middle.left * left
  const beside = middle.forward * middle.forward + middle.left * middle.left - along * along
  if (beside > radius * radius) return null
  const half = Math.sqrt(radius * radius - beside)
  return along + half < 0 ? null : [along - half, along + half]
}

/** r29c (狍鸮): the ways (whole degrees) an ability's start lets the one it fights stand in (`target_bearing` in `start.when`, every one met), when straight ahead is not one of them; null otherwise. */
function startBearings(ability: Ability): number[] | null {
  const rules = (ability.start.when ?? []).flatMap((rule) => (rule.if === "target_bearing" ? [rule] : []))
  if (!rules.length) return null
  const angles = Array.from({ length: 360 }, (_, index) => index - 179).filter((angle) => rules.every((rule) => bearingMatches(rule, angle, Number.MAX_SAFE_INTEGER)))
  return angles.length && !angles.includes(0) ? angles : null
}

/** r29c (狍鸮): a hit that does nothing to whoever it meets (no damage, knockback, effect or force): it is there for the ability's look and sound, and has no reach to fall short of. */
const harmlessHit = (hit: AbilityHit) => hit.type === "area" && hit.damage <= 0 && hit.knockback === 0 && !hit.effects.length && !hit.force
/** r29c (狍鸮): an ability that carries itself backward and never toward the one it fights (a retreat) is used to get away from them, not to reach them. */
const retreats = (ability: Ability) => !movesForward(ability) && !ability.moves.some(isLeap) && ability.moves.some((move) => isPush(move) && move.forward < 0)

/**
 * epic game1: a frost dragon breathed with a cone 16 blocks long from its mouth and the breath missed from 17 to 22 blocks away, started out of reach and flown past the player. The numbers an ability in
 * the air aimed at the one it fights is held to (the generated `flightReaches` / `flightReachStation`, one rule with the helpers below):
 * - `stand`: the horizontal distance from the target to the place the hits start at while it runs, two thirds of the reach. With the hits starting a third of the reach above the target's middle
 *   (`rise`, which the sinking of 8d2784e already used) that place is `sqrt((2/3)² + (1/3)²)` = 0.745 of the reach away: a quarter of the reach is left for the target stepping aside and the flier drifting.
 * - `near`: a third of the reach, the least the place its hits start at may come to the target at a hit (`airReachMayStart`).
 * - `slack`: a block, the same slack the far-end finding allows (a player half a block wide is still met when the edge touches them). Only the findings use it: the start is held inside the reach (`airReachLimit`).
 */
export const AIR_REACH = { stand: 2 / 3, rise: 1 / 3, near: 1 / 3, slack: 1 } as const

/**
 * What a pushed one slides on: the game's ground friction per tick, a block's slipperiness (0.6) times the air's drag (0.91). A push of strength k at rest moves it k / (1 - 0.546) blocks in all.
 */
const PUSH_DRAG = 0.6 * 0.91
/**
 * The push the game itself gives with any damage that comes from a creature (`LivingEntity.damage` calls `takeKnockback(0.4, …)` for an attacker), on top of the
 * hit's own knockback (epic game4: a breath of knockback 0.15 left the last hit 0.8 blocks short of the reach the start was held to, the hits having pushed the target
 * 1.7 blocks where 0.66 was counted).
 */
const DAMAGE_PUSH = 0.4

/**
 * Per ability, the one aimed area hit of an ability in the air that has the least reach, and where it starts: `[reach, up, forward, left, first, last, push, follow]`: how far it reaches from where it starts
 * (blocks), that place ahead of, above and to the left of the feet at the size the model is built (the hit's bone, or the feet when it names none, plus the shape's own `up`), the server ticks of the first
 * and of the last aimed hit (how long the flier has to close in, and how long it must stay in reach), and how far the hits before the last push the one they hit (blocks: every area hit before it, its
 * knockback, and the game's own push of a hit that does damage (`DAMAGE_PUSH`), over the friction it slides on, `PUSH_DRAG`, away from the flier), and how much of that the aim follows (the hits' own knockback alone). Null for an ability that is not in the air, a dive, or has no aimed area hit (a hit from a bone the model lacks is left out).
 */
export function airHitReach(ability: Ability, anchors: readonly (Place | null)[]): number[] | null {
  if (ability.where === "ground" || ability.dive) return null
  const plan = abilityPlan(ability).hits
  const aimed = ability.hits.flatMap((hit, at) => {
    if (hit.type !== "area" || !shapeAims(hit.shape)) return []
    const anchor = hit.bone === undefined ? { forward: 0, up: 0, left: 0 } : (anchors[at] ?? null)
    if (!anchor) return []
    return [{ reach: hit.shape.length + (hit.shape.type === "line" ? hit.shape.radius : 0), anchor, up: anchor.up + hit.shape.up, tick: plan[at]!.tick }]
  })
  if (!aimed.length) return null
  const shortest = aimed.reduce((best, value) => (value.reach < best.reach ? value : best))
  const first = Math.min(...aimed.map((value) => value.tick))
  const last = Math.max(...aimed.map((value) => value.tick))
  const before = ability.hits.flatMap((hit, at) => (hit.type === "area" && plan[at]!.tick < last ? [hit] : []))
  const push = before.reduce((sum, hit) => sum + ((hit.damage > 0 ? DAMAGE_PUSH : 0) + Math.max(0, hit.knockback)) / (1 - PUSH_DRAG), 0)
  // What the aim follows them by (`abilityFollow`) is less: the game's own push comes from the flier's middle, along the line to them, and the aim changes little by it; the hits' own knockback is
  // what the aim has to follow, and what a player who steps aside is not followed beyond (epic game4: with the whole push, a sprinter dodged 29% of the hits after the first, where 40% with the knockback).
  const follow = before.reduce((sum, hit) => sum + Math.max(0, hit.knockback) / (1 - PUSH_DRAG), 0)
  return [shortest.reach, shortest.up, shortest.anchor.forward, shortest.anchor.left, first, last, push, follow].map((value) => num(value, 4) || 0)
}

/**
 * How far from the target, horizontally, the flier's middle stands while such an ability runs so that the place its hits start at is `AIR_REACH.stand` of the reach from the target, when it faces
 * the target: that place is `forward` ahead of the middle and `left` beside it, so the middle is `forward + sqrt((stand·reach)² - left²)` away (never less than 0: it never goes past the target).
 */
export const airReachBody = (reach: number, forward: number, left: number) => Math.max(0, forward + Math.sqrt(Math.max(0, (AIR_REACH.stand * reach) ** 2 - left * left)))

/**
 * The flier as the hold flies it, per tick (blocks, degrees): a soaring one cannot stop (`soar`: at its stall speed, never under), a hovering one goes to its station at half its cruise and stays
 * there; `accel` and `brake` are the most its speed rises and falls by, `turn` the most its heading and its climb turn by, `climb` the steepest it may climb or sink.
 */
export type AirReachFlier = { soar: boolean; cruise: number; stall: number; accel: number; brake: number; turn: number; climb: number }

/** Where the flier is when the ability may start: its middle across and along from the target's (blocks), its feet over the target's middle, its heading (degrees), the angle it climbs at and its speed. */
export type AirReachFrom = { x: number; z: number; feet: number; yaw: number; climb: number; speed: number }

const wrapDegrees = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180
const clamp = (value: number, least: number, most: number) => Math.min(Math.max(value, least), most)

/**
 * epic game1 (the second measure): breaths that started inside the gate's reach ended out of it, 14.9, 15.3, then 16.5 blocks from a cone 16 long, because a soaring flier does not stop in the three
 * hits; and a breath that flew in at 7.8, 6.0 and 4.5 blocks missed by 21° with the one it hit pushed a block and a half. So the gate no longer asks where the place its hits start at is now, less what
 * the flier closes by the first hit: it flies the hold forward (the same steps as the generated `flightReaches`, which are `flightMove` and `flightSteer` of the hold, `flightReachStation`), tick by tick up
 * to the last aimed hit, and reads how far the place its hits start at is from the middle of the one it fights at every tick from the first hit to the last.
 * Each tick, in the order the game runs them: the ability turns the body toward the one it fights by the flier's turn cap while it gets ready (`tracks`, then `windup` ticks); from `first` on the place is
 * read, `ahead` along the way the ability faces and `left` beside it, `feet + up` high; then the flight steers toward the station (the point `min(flat, body)` out from the target along the bearing the
 * flier has from them, at the height `max(reach / 3 - up, floor)`), turning by at most `turn`, its speed going to the one it keeps, and moves; after getting ready the ability faces the way the flight does.
 * The one it fights is taken to stand still (the pushes of the hits before are the margin's, `airReachLimit`).
 * `floor`: the lowest the feet may be over the target's middle (the ground a block under them). Returns the nearest and the farthest the place was from them.
 */
export function airReachPath(row: readonly number[], flier: AirReachFlier, ability: { windup: number; tracks: boolean }, from: AirReachFrom, floor: number) {
  const [reach, up, ahead, left, first, last] = row as [number, number, number, number, number, number]
  const station = Math.max(reach / 3 - up, floor)
  const body = airReachBody(reach, ahead, left)
  const turn = flier.turn
  let { x, z, feet, climb, speed } = from
  let facing = from.yaw
  let near = Infinity
  let far = 0
  for (let tick = 0; tick <= last; tick++) {
    const getting = ability.tracks && tick < ability.windup
    if (getting) facing += clamp(wrapDegrees((Math.atan2(-z, -x) * 180) / Math.PI - 90 - facing), -turn, turn)
    if (tick >= first) {
      const angle = (facing * Math.PI) / 180
      const distance = Math.hypot(x - ahead * Math.sin(angle) + left * Math.cos(angle), z + ahead * Math.cos(angle) + left * Math.sin(angle), feet + up)
      near = Math.min(near, distance)
      far = Math.max(far, distance)
    }
    const flat = Math.hypot(x, z)
    const away = Math.min(flat, body)
    const across = flat > 1e-3 ? Math.hypot(x - (x * away) / flat, z - (z * away) / flat) : 0
    const toX = flat > 1e-3 ? (x * away) / flat - x : 0
    const toZ = flat > 1e-3 ? (z * away) / flat - z : 0
    const stays = !flier.soar && Math.hypot(across, station - feet) < 1
    let heading = facing
    if (!stays) heading += clamp(wrapDegrees(across > 0.05 ? (Math.atan2(-toX, toZ) * 180) / Math.PI - heading : 0), -turn, turn)
    const wantClimb = stays ? 0 : clamp((Math.atan2(station - feet, Math.max(across, 0.5)) * 180) / Math.PI, -flier.climb, flier.climb)
    climb = clamp(climb + clamp(wantClimb - climb, -turn, turn), -flier.climb, flier.climb)
    const want = stays ? 0 : flier.soar ? flier.stall : flier.cruise * 0.5
    speed = Math.max(0, speed + clamp(want - speed, -flier.brake, flier.accel))
    const lift = (climb * Math.PI) / 180
    x += -Math.sin((heading * Math.PI) / 180) * Math.cos(lift) * speed
    z += Math.cos((heading * Math.PI) / 180) * Math.cos(lift) * speed
    feet += Math.sin(lift) * speed
    if (!getting) facing = heading
  }
  return { near, far }
}

/**
 * The nearest the place its hits start at can be to the target's middle while the ability runs: two thirds of the reach across and, at the height the flier is asked to (a third of the reach above the
 * target's middle), `lowest` when the ground keeps it higher: `lowest` is that place's height over the target's middle with the feet a block over the ground (the floor rule).
 */
export const airReachNearest = (reach: number, lowest: number) => Math.hypot(AIR_REACH.stand * reach, Math.max(AIR_REACH.rise * reach, lowest))

/**
 * How far from the target the place its hits start at may be at any of the aimed hits: the reach, less the room the hit needs and the room the hits before it take.
 * - the push: the one it fights is pushed away from the flier by each hit before (`airHitReach`'s `push`, in blocks), and the hit after it has to reach them there;
 * - a step: the hit is counted within a tick of the one the path reads (the order of the move and the hit inside a tick), and a tick moves the place by at most `cruise` blocks.
 * Where the station itself is farther than that (`airReachNearest`, the floor rule keeping the flier high), no path gets nearer, so the least it can hold is the station and a step.
 */
export const airReachLimit = (row: readonly number[], cruise: number, lowest: number) => Math.max(row[0]! - row[6]! - cruise, airReachNearest(row[0]!, lowest) + cruise)

/**
 * Whether an ability aimed at the one it fights may start in the air (`airReachPath` read from where the flier is): the place its hits start at stays within `airReachLimit` of the target's middle at every
 * aimed hit, and never nearer than a third of the reach: that near, the first hits push the one it hit, and the flier going by turns the line to them faster than it can turn the aim after
 * (21° off, at 4.5 blocks of a cone 25° wide, for a block and a half; the aim also follows them, `abilityFollow`, but by no more than the flier's turn cap).
 */
export const airReachMayStart = (row: readonly number[], path: { near: number; far: number }, cruise: number, lowest: number) => path.far <= airReachLimit(row, cruise, lowest) && path.near >= row[0]! * AIR_REACH.near

/** The flier as the hold flies it (`AirReachFlier`): its numbers per tick, from the document's per second (`FLIGHT_LIMITS` are the generated flight's own steps). */
export function airReachFlier(flight: Pick<Flight, "style" | "speed" | "turn" | "climb">): AirReachFlier {
  const cruise = flight.speed / TICKS
  const ticks = (seconds: number) => Math.max(1, Math.round(seconds * TICKS))
  return { soar: flight.style === "soar", cruise, stall: cruise * FLIGHT_LIMITS.stall, accel: cruise / ticks(FLIGHT_LIMITS.accel), brake: cruise / ticks(FLIGHT_LIMITS.brake), turn: flight.turn / TICKS, climb: flight.climb }
}

/**
 * Whether some start passes the gate at all (`airReachMayStart`), for the findings: the flier at its stall speed (as a hold leaves it) at the station's height and at one of the distances round it a flier
 * can come from (the station's, and a quarter and a half beyond), flying toward the target, away, or to either side. Where none does, no circle and no approach starts it either.
 */
export function airReachHolds(row: readonly number[], flier: AirReachFlier, ability: { windup: number; tracks: boolean }, floor: number) {
  const reach = row[0]!
  const lowest = floor + row[1]!
  const body = airReachBody(reach, row[2]!, row[3]!)
  const feet = Math.max(reach / 3 - row[1]!, floor)
  const limit = airReachLimit(row, flier.cruise, lowest)
  const tries = [1, 1.25, 1.5].flatMap((scale) => [0, 90, 180, 270].map((yaw) => airReachPath(row, flier, ability, { x: body * scale, z: 0, feet, yaw, climb: 0, speed: flier.soar ? flier.stall : 0 }, floor)))
  const best = tries.reduce((found, path) => (path.far < found.far ? path : found))
  return { holds: tries.some((path) => airReachMayStart(row, path, flier.cruise, lowest)), near: best.near, far: best.far, limit }
}

/** How far around the creature anybody a shape could hold may stand, in blocks: the generated Java looks no further. */
export const shapeRange = (given: AbilityShape) =>
  ((shape) => num(1 + (shape.type === "arc" ? shape.reach : shape.type === "line" || shape.type === "cone" ? shape.length + (shape.type === "line" ? shape.radius : 0) : shape.type === "box" ? Math.hypot(Math.abs(shape.forward) + shape.depth / 2, Math.abs(shape.left) + shape.width / 2) : Math.hypot(shape.forward, shape.left) + shape.radius), 1))(plainShape(given))

const ring = (count: number, at: (angle: number) => Vec) => Array.from({ length: count }, (_, index) => at((index * 2 * Math.PI) / count))

/** A hit shape as flat faces (viewport space, model pixels) for a picture to draw through. A beam and a cone point level and straight ahead, or with `pitch` (J2, radians, up positive) tilted about where they start. */
export function shapeFaces(given: AbilityShape, pitch = 0): Vec[][] {
  const shape = plainShape(given)
  if (shape.type === "box") {
    const corner = (index: number) => abilityPlace(shape.forward + (index & 1 ? 0.5 : -0.5) * shape.depth, shape.up + (index & 2 ? 0.5 : -0.5) * shape.height, shape.left + (index & 4 ? 0.5 : -0.5) * shape.width)
    return [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]].map((face) => face.map(corner))
  }
  if (shape.type === "sphere")
    return [
      ring(24, (angle) => abilityPlace(shape.forward + shape.radius * Math.cos(angle), shape.up, shape.left + shape.radius * Math.sin(angle))),
      ring(24, (angle) => abilityPlace(shape.forward + shape.radius * Math.cos(angle), shape.up + shape.radius * Math.sin(angle), shape.left)),
      ring(24, (angle) => abilityPlace(shape.forward, shape.up + shape.radius * Math.cos(angle), shape.left + shape.radius * Math.sin(angle))),
    ]
  if (shape.type === "line" || shape.type === "cone") {
    const wide = shape.type === "line" ? shape.radius : shape.length * Math.tan((shape.angle * Math.PI) / 360)
    const rim = (forward: number, radius: number) => ring(12, (angle) => abilityPlace(forward * Math.cos(pitch) - radius * Math.cos(angle) * Math.sin(pitch), shape.up + forward * Math.sin(pitch) + radius * Math.cos(angle) * Math.cos(pitch), radius * Math.sin(angle)))
    const near = rim(0, shape.type === "line" ? wide : 0)
    const far = rim(shape.length, wide)
    return [far, ...far.map((point, index) => [near[index]!, point, far[(index + 1) % far.length]!, near[(index + 1) % near.length]!])]
  }
  const half = (shape.angle * Math.PI) / 360
  const steps = Math.max(2, Math.ceil(shape.angle / 15))
  const edge = (up: number, radius = shape.reach) => Array.from({ length: steps + 1 }, (_, index) => -half + (index * 2 * half) / steps).map((angle) => abilityPlace(radius * Math.cos(angle), up, radius * Math.sin(angle)))
  const floor = edge(shape.low)
  const roof = edge(shape.high)
  const centre = (up: number) => abilityPlace(0, up, 0)
  const inner = shapeInner(shape)
  if (inner > 0) {
    // A hollow arc (a ring when it goes all the way round): its outer and inner walls, and its floor and roof as bands between them; a part of one closes its two ends.
    const floorIn = edge(shape.low, inner)
    const roofIn = edge(shape.high, inner)
    const wall = (low: Vec[], high: Vec[]) => low.slice(1).map((point, index) => [low[index]!, point, high[index + 1]!, high[index]!])
    return [
      ...wall(floor, roof),
      ...wall(floorIn, roofIn),
      ...wall(floorIn, floor),
      ...wall(roofIn, roof),
      ...(shape.angle >= 360 ? [] : [[floorIn[0]!, floor[0]!, roof[0]!, roofIn[0]!], [floorIn.at(-1)!, floor.at(-1)!, roof.at(-1)!, roofIn.at(-1)!]]),
    ]
  }
  return [
    shape.angle >= 360 ? floor : [centre(shape.low), ...floor],
    shape.angle >= 360 ? roof : [centre(shape.high), ...roof],
    ...floor.slice(1).map((point, index) => [floor[index]!, point, roof[index + 1]!, roof[index]!]),
    ...(shape.angle >= 360 ? [] : [[centre(shape.low), floor[0]!, roof[0]!, centre(shape.high)], [centre(shape.low), floor.at(-1)!, roof.at(-1)!, centre(shape.high)]]),
  ]
}

/**
 * How far the moment a stroke of the motion lands (it went toward where the hit lands, and stops or turns back) may lie from the moment the hit is counted
 * before the two are said to disagree: two server ticks. One is lost to rounding a time to a tick, and one to
 * the players' games, which start the motion a tick after the server started the ability; nothing shorter
 * can be told apart at twenty ticks a second.
 */
export const STRIKE_TOLERANCE = 2 / TICKS
// Model pixels a stroke must bring its part closer to where the hit lands to be read as going there at all.
const APPROACH = 1
// A stroke: its part moves at least `fast` of the motion's top speed, and it ends where the speed falls under `stop` of what it was or the part turns back.
const STROKE = { fast: 0.25, stop: 0.35 } as const
// A stroke undoes the one before it when it carries the same part back along it: the two travels point more than this far against each other (cosine). Why 0.5: 120 degrees, so a part that
// swings back by a different path (a recovery that arcs) still counts as going back, and one that goes on sideways (a second stroke of a combination) does not.
const BACK = -0.5
// Model pixels below which a part has not moved.
const STILL = 0.5

/**
 * For every hit moment of an ability, on the model that plays it: where the hit lands in the model's own
 * space, and what the motion is doing right then. Measured from the documents alone.
 * - `faces`: the hit shape, to draw over the frame at `at` seconds;
 * - `part` and `gap`: the moving part that is furthest forward at that moment and how far it is from the shape (blocks; 0: inside);
 * - `arrives`: when a stroke of the motion lands: after the wind-up its fastest part went toward the middle of where the hit lands and there all but stops or turns back (seconds; of several strokes the one closest in time to this hit; null: no stroke goes there);
 * - `windup`: how far anything travels while it gets ready (to the end of the wind-up; without one, to the first hit), in screen pixels at the size the game shows a creature, and whether that can be seen.
 * Null when the model has no such motion.
 */
export function abilityHitShapes(ability: Ability, design: Pick<ModelDesign, "bones" | "animations">) {
  const clip = design.animations.find((animation) => animation.name === ability.clip) as MotionClip | undefined
  if (!clip) return null
  const owners = design.bones.flatMap((bone) => bone.cubes.flatMap((cube) => Array.from({ length: 8 }, () => ({ bone: bone.name, cube: cube.name }))))
  // Every server tick of the motion, to its own end: the swing may land after the ability is over.
  const times = Array.from({ length: Math.floor(clip.length * TICKS + 1e-6) + 1 }, (_, tick) => tick / TICKS)
  const poses = times.map((time) => posedCorners(design, clip, time))
  const apart = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const moving = owners.map((_, corner) => poses.some((pose) => apart(pose[corner]!, poses[0]![corner]!) > STILL))
  // How the motion goes, tick by tick: the part that moves fastest in each tick and how far it moves. A stroke ends on the tick after which that part all but stops, or turns back.
  const step = (corner: number, tick: number): Vec => (tick < 1 || tick >= poses.length ? [0, 0, 0] : [0, 1, 2].map((axis) => poses[tick]![corner]![axis]! - poses[tick - 1]![corner]![axis]!)) as Vec
  const long = (vector: Vec) => Math.hypot(...vector)
  const fastest = times.map((_, tick) => owners.reduce((best, _owner, corner) => (moving[corner] && (best < 0 || long(step(corner, tick)) > long(step(best, tick))) ? corner : best), -1))
  const peak = Math.max(0, ...fastest.map((corner, tick) => (corner < 0 ? 0 : long(step(corner, tick)))))
  const ends = fastest.flatMap((corner, tick) => {
    if (corner < 0 || tick < 1) return []
    const before = step(corner, tick)
    const after = step(corner, tick + 1)
    return long(before) >= Math.max(STILL, peak * STROKE.fast) && (long(after) < long(before) * STROKE.stop || before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0) ? [{ tick, corner }] : []
  })
  // Getting ready is what a player has to see in order to step aside: the motion up to the end of the wind-up, or up to the first hit for an ability written without one.
  const ready = ability.windup > 0 ? ability.windup : ability.hits[0]!.at
  const before = ready > 0 && moving.some(Boolean) ? measureMotion(design, { ...clip, length: Math.min(ready, clip.length), loop: false }) : null
  const windup = { seconds: ready, game: before ? before.game : 0, seen: before ? !before.unseen : false }
  const warns = warnPlan(ability)
  return ability.hits.map((hit, index) => {
    // Boss 能力 3: a hit put down at places decided before it lands is drawn at every one of them, with the one it fights where the pictures take it to stand. One that lands
    // somewhere other than round the creature is not something its motion swings at: nothing is measured of a stroke toward it.
    const remote = hit.type === "area" && hitElsewhere(hit)
    const places = abilityHitPlaces(ability,index,placeTarget(ability))
    const at = (place: Place) => (point: Vec): Vec => ((shift) => [point[0] + shift[0], point[1] + shift[1], point[2] + shift[2]])(abilityPlace(place.forward, place.up, place.left))
    const warned = hit.type === "area" && hit.warn ? { ...hit.warn, start: (warns[index]?.start ?? 0) / TICKS } : null
    const target = hitOnTarget(hit)
    const shape = hitShape(hit)
    const pose = posedCorners(design, clip, Math.min(hit.at, clip.length))
    const front = pose.reduce((best, point, corner) => (moving[corner] && (best < 0 || point[2] < pose[best]![2]) ? corner : best), -1)
    const part = front < 0 ? null : owners[front]!
    // A hit that names a bone counts from that bone: the shape, what it is drawn as and the stroke it is measured against all move to where the bone is.
    const anchor = hitAnchor(ability, index, design)
    const shift: Vec = anchor ? abilityPlace(anchor.forward, anchor.up, anchor.left) : [0, 0, 0]
    const turn = hit.type !== "area" ? null : aimedTurn(ability, shape, anchor)
    const moved = (point: Vec): Vec => (anchor ? ((at) => [at[0] + shift[0], at[1] + shift[1], at[2] + shift[2]] as Vec)(turned(point, turn)) : point)
    // Where a stroke has to go to be the one this hit belongs to. A hit that lands a good way from where it counts from (the bone, else the feet) lands at its own focus. One that lands within a block of it (a shot
    // leaves from the part that fires it; a ball or an aura at the bone itself) lands wherever that part is when the hit is counted, which says nothing about where the part is going: a bolt that is pushed
    // through the point it fires from never comes nearer to it, and the part going back to rest does. Such a hit is aimed at the target the creature faces instead, taken to stand straight ahead in the middle
    // of the distances the ability starts at (as `levelReach` and `aimedTurn` take it, and at least two blocks, so a very near target still leaves room to move toward), so that a part is going toward it
    // when it goes forward and away from it when it goes back.
    const offset = hit.type !== "area" ? ([0, 0, 0] as Vec) : turned(shapeFocus(shape), anchor ? turn : null)
    const placed = moved(shapeFocus(shape))
    const focus: Vec = Math.hypot(...offset) < BLOCK ? [placed[0], placed[1], placed[2] - Math.max(2, (ability.start.min_distance + ability.start.max_distance) / 2) * BLOCK] : placed
    const travelOf = (corner: number, from: number, to: number): Vec => [0, 1, 2].map((axis) => poses[to]![corner]![axis]! - poses[from]![corner]![axis]!) as Vec
    // A stroke goes toward where the hit lands when it brings its part nearer to that place by at least a quarter of how far it carried it: not a pass sideways.
    const goesToward = (corner: number, from: number, to: number) => apart(poses[from]![corner]!, focus) - apart(poses[to]![corner]!, focus) >= Math.max(APPROACH, long(travelOf(corner, from, to)) / 4)
    // Strokes that end after the wind-up (what comes before is getting ready by the ability's own word) and go toward where the hit lands. A stroke that carries its part back along the one before it, when that one
    // went toward where the hit lands, is the part returning to rest: the shot or the blow was before it, never at it (a crossbow's bolt is pushed forward, and then it goes back).
    const arrivals = ends.flatMap((end, order) => {
      const from = ends[order - 1]?.tick ?? 0
      if (times[end.tick]! <= ability.windup + 1e-6 || !goesToward(end.corner, from, end.tick)) return []
      if (order > 0) {
        const began = ends[order - 2]?.tick ?? 0
        const gone = travelOf(end.corner, began, from)
        const back = travelOf(end.corner, from, end.tick)
        if (goesToward(end.corner, began, from) && gone[0] * back[0] + gone[1] * back[1] + gone[2] * back[2] < BACK * long(gone) * long(back)) return []
      }
      return [times[end.tick]!]
    })
    const own = anchor ? shapeFaces(shape).map((face) => face.map(moved)) : hitFixed(hit) ? places.flatMap((place) => shapeFaces(shape).map((face) => face.map(at(place)))) : shapeFaces(shape)
    return {
      index,
      at: hit.at,
      tick: abilityPlan(ability).hits[index]!.tick,
      shape,
      // Said as something that leaves from a place ("出手"), as a shot is; a gameplay's hit is also marked as such (`gameplay`) so that nothing is measured of where it lands.
      shot: hit.type !== "area",
      // Boss 能力 7: the hit a lightning lands as (`struckAbility`), said as one.
      lightning: isLightningHit(hit),
      gameplay: hit.type === "gameplay",
      bone: hitBone(hit) ?? null,
      anchor,
      // Boss 能力 4: a dash's arrow and the band its hit sweeps, and a force's arrows, are drawn with the hit (`dashForceFaces`; nothing for any other hit).
      faces: [...own, ...dashForceFaces(ability, index, shapeFaces(shape), places), ...leapFaces(ability, index, shapeFaces(shape))],
      // r29c: the faces that are where the creature is when the hit is counted (its shape and a force's arrows), and those laid out from where a dash or a leap starts.
      // A picture of an ability that carries the creature (`abilityTravel`) moves the first by where it is then; `faces` is both, as it always was.
      carried: [...own, ...hitForceFaces(ability, index, places)],
      laid: [...dashFaces(ability, index, shapeFaces(shape)), ...leapFaces(ability, index, shapeFaces(shape))],
      // Boss 能力 3: the places it is counted from (its feet, for a hit that lands round the creature), whether they lie away from it, its warning (with the second it begins), and the one it fights as a box a player's size where the pictures put them.
      places,
      remote,
      warn: warned,
      dummy: target ? shapeFaces({ type: "box", forward: placeTarget(ability), up: AIM_TARGET.middle, left: 0, width: 0.6, height: AIM_TARGET.tall, depth: 0.6 }) : null,
      part,
      gap: part && !remote ? num(Math.min(...pose.flatMap((point, corner) => (owners[corner]!.bone === part.bone ? [shapeGap(shape, anchor ? turned([point[0] - shift[0], point[1] - shift[1], point[2] - shift[2]], turn && { forward: turn.forward, left: -turn.left }) : point)] : []))) / BLOCK) : null,
      // Of several arrivals (a motion may strike more than once), the one nearest this hit in time.
      arrives: hit.type !== "gameplay" && !remote && arrivals.length ? arrivals.reduce((best, time) => (Math.abs(time - hit.at) < Math.abs(best - hit.at) ? time : best)) : null,
      windup,
    }
  })
}
export type AbilityHitShape = NonNullable<ReturnType<typeof abilityHitShapes>>[number]

/**
 * J2: what a level beam or cone can reach where the one it fights is taken to stand (straight ahead, in the
 * middle of the distances the ability starts at): from how high to how high above the creature's feet, and
 * whether a player standing on the same ground is in that. Null for every other shape.
 */
export function levelReach(ability: Pick<Ability, "start">, shape: AbilityShape) {
  if ((shape.type !== "line" && shape.type !== "cone") || shape.aim !== "level") return null
  const distance = num((ability.start.min_distance + ability.start.max_distance) / 2)
  const half = shape.type === "line" ? shape.radius : Math.min(distance, shape.length) * Math.tan((shape.angle * Math.PI) / 360)
  return { distance, low: num(shape.up - half), high: num(shape.up + half), reaches: distance <= shape.length + (shape.type === "line" ? shape.radius : 0) && shape.up - half <= AIM_TARGET.tall && shape.up + half >= 0 }
}

/**
 * The stable name of a creature's measured fault about one ability, as the creature's own `justified` writes it (`what`): `<ability id>:windup` (nobody sees the wind-up, or there is none)
 * and `<ability id>:timing` (the stroke and the hit moment disagree). One name per ability and kind, so one reason answers it however many hits the ability has.
 */
export const abilityFaultName = (ability: Pick<Ability, "id">, kind: "windup" | "timing") => `${ability.id}:${kind}`

/** What a creature's `justified` says in a measured sentence it answers: the sentence stays (the reviewer and the person read it) and no longer starts or reads as a fault. */
const meant = (reason: string) => `（文档的 justified 里写了本来就该这样：${reason}）`
/** What the maker is told to do about a measured fault it can answer: write it in the creature's `justified`. */
const answerWith = (name: string) => `它本来就该这样（光环、荆棘、接触灼伤、陷阱）的话，在这只生物文档的 justified 里写 {"what":"${name}","reason":"……"}，理由会原样给评审和人看。`

/** Boss 能力 3: where a hit is put down, in words: 「目标脚下」. */
export const placeWords = (place: HitPlace) =>
  place === "self"
    ? "它自己脚下"
    : place === "center"
      ? "场地正中"
      : place === "target"
      ? "目标脚下"
      : "fixture" in place ? (place.fixture === "lit_random" ? "随机一座亮着的物件" : "离施放者最近的亮着物件") : place.type === "around_target"
        ? `目标脚下周围 ${num(place.spread)} 格以内随机的 ${place.count} 个地方（每次出招重新随机）`
        : `按它出招时站的位置和朝向排好的 ${place.points.length} 个地方（${place.points.map((point) => `前 ${num(point.forward)} 左 ${num(point.left)}`).join("、")}）`

/** Boss 能力 3: a warning in words: 「提前 1 秒在地上画出红色的地上画出范围的一圈」. */
export const warnWords = (warn: HitWarn) => `提前 ${num(warn.seconds)} 秒在落点画出${WARN_COLORS[warn.color].name}的预警（${WARN_LOOKS[warn.look]}${warn.follow ? `，跟随${warn.follow === "caster" ? "施法者" : "目标"}，提前 ${warn.lock_before ?? 0} 秒定住` : ""}${warn.fade_seconds ? `，结束后 ${warn.fade_seconds} 秒淡出` : ""}${warn.effect ? "，铺工程自己的效果" : ""}）`

/** Boss 能力 3: how long the warning of a measured hit really shows before it lands, in seconds (its ticks; a warning that would start before the ability is cut to its start). */
const warnLead = (found: Pick<AbilityHitShape, "tick" | "warn">) => (found.warn ? num(found.tick / TICKS - found.warn.start) : 0)

/** Boss 能力 3: what is said of a hit that is put down somewhere else or warned of: where it lands, how the pictures draw it, the warning, and whether the warning leaves time to step out. */
function placeLines(ability: Ability, found: AbilityHitShape): string[] {
  // Boss 能力 7: a lightning is the hit it lands as, after the ability's own (`struckAbility`).
  const hit = (struckAbility(ability) as Ability).hits[found.index]
  if (!hit || hit.type !== "area" || (!found.remote && !found.warn)) return []
  const many = found.places.length > 1
  const lead = warnLead(found)
  const escape = warnEscape(hit.shape)
  return [
    ...(found.remote
      ? [
          `第 ${num(found.at)} 秒这一下不在它身边打，打在${placeWords(hitPlace(hit))}${hitOnTarget(hit) ? `；图上按站在正前方 ${placeTarget(ability)} 格的目标画（小方框是目标）${hitPlace(hit) === "target" ? "" : "，随机的落点按其中一次出招画，游戏里每次都不一样"}` : ""}。落点在${found.warn ? "预警开始" : "出手"}的那一刻由服务端定下，之后谁怎么动都不会变。`,
        ]
      : []),
    ...(found.warn
      ? [
          `预警：从第 ${num(found.warn.start)} 秒起（比判定早 ${lead} 秒），${many ? `${found.places.length} 个落点上各` : "落点上"}画出${WARN_COLORS[found.warn.color].name}的${WARN_LOOKS[found.warn.look]}，形状和大小就是判定范围（图上红色的范围）；到第 ${num(found.at)} 秒就在${many ? "这些" : "这个"}地方判定。${found.warn.follow || found.warn.fade_seconds || found.warn.effect ? warnWords(found.warn) : found.remote ? "" : "落点和朝向在预警开始那一刻定在它当时站的地方，之后它被推开或者转身，判定也还在原地。"}`,
          ...(lead < WARN_LIMITS.readable - 1e-9 ? [`预警只提前 ${lead} 秒，不到 ${WARN_LIMITS.readable} 秒：玩家看到了也来不及躲。`] : []),
          ...(hitPlace(hit) === "target" && lead < escape / WARN_LIMITS.walk - 1e-9 ? [`目标站在落点正中，要走 ${escape} 格才出得了判定范围，走路（每秒 ${WARN_LIMITS.walk} 格）要 ${num(escape / WARN_LIMITS.walk)} 秒，预警只有 ${lead} 秒：不跑就躲不开。`] : []),
        ]
      : hitOnTarget(hit)
        ? [`这一下打在目标脚下，却没有预警（warn）：玩家看不出要躲到哪里。`]
        : []),
  ]
}

/**
 * What was measured at one hit moment, in sentences; the last says so when the motion and the hit moment disagree.
 * `justified` is the creature's own list (`Entity.justified`): a wind-up or a timing fault it answers with a reason (`abilityFaultName`) is still said, with the reason, and is no longer written
 * as a fault (no 「没有蓄力」 / 「看不到蓄力」 / 「对不上」 mark, which is what the making loop and the reviewer take as blocking, `abilityFault`). Left out: every fault is written as one, as it always was.
 * Why: an aura, a thorn burst, a contact burn or a trap has no wind-up on purpose (the schema and the ability's summary allow a wind-up of 0); a gate stops only on what a player would obviously see as an error.
 */
export function hitLines(ability: Ability, found: AbilityHitShape, justified?: readonly { what: string; reason: string }[] | null) {
  const off = found.arrives === null ? null : num(found.arrives - found.at)
  const windup = justifiedReason(justified, abilityFaultName(ability, "windup"))
  const timing = justifiedReason(justified, abilityFaultName(ability, "timing"))
  const level = found.shot ? null : levelReach(ability, found.shape)
  const strike = found.lightning ? strikeOf(ability, (struckAbility(ability) as Ability).hits[found.index]!) : null
  return [
    // Boss 能力 7: what a lightning is, before where it lands and its warning (`placeLines`).
    ...(strike ? [`第 ${num(strike.at)} 秒这里落雷：图上红色的柱子是半径 ${num(strike.radius)} 格、落点往下 ${-LIGHTNING_LIMITS.low} 格到往上 ${LIGHTNING_LIMITS.high} 格的雷柱，里面除了它自己和同类以外的生物${strike.damage > 0 ? `掉 ${num(strike.damage)} 点血` : "不掉血"}；闪电只有样子和雷声，不点火、不改方块。`] : []),
    ...(found.anchor && found.bone !== null
      ? [`第 ${num(found.at)} 秒这一下是从「${found.bone}」这个部位算的：那一刻它的中心离脚下前 ${found.anchor.forward} 格、上 ${found.anchor.up} 格、左 ${found.anchor.left} 格，${found.shot ? "出手的位置" : "判定范围"}从那里起（图上的框画在那里）。`]
      : []),
    ...(!found.shot && found.anchor && found.bone !== null && aimedTurn(ability, found.shape, found.anchor)
      ? [`「${found.bone}」在身体中线${found.anchor.left > 0 ? "左" : "右"}边 ${num(Math.abs(found.anchor.left))} 格，这一下朝目标打，所以是从那里斜着打向正前方的人（图上按站在正前方 ${num((ability.start.min_distance + ability.start.max_distance) / 2)} 格的人画）。`]
      : []),
    ...placeLines(ability, found),
    // Boss 能力 4: the dash this hit goes with, and the force it leaves.
    ...dashForceLines(ability, found.index),
    // 第 3 步: the leap a hit lands with (ability-dash-words.ts `leapLines`).
    ...leapLines(ability, found.index),
    ...(level
      ? [`第 ${num(found.at)} 秒这一下是水平打出去的（aim 写的是 level），不随目标站得高低倾斜：在正前方 ${level.distance} 格的地方，它只打得到离它脚下 ${level.low} 到 ${level.high} 格高的东西。站在同一块地上的玩家（身高 ${AIM_TARGET.tall} 格）${level.reaches ? "在这个高度里" : "不在这个高度里，打不中"}。`]
      : []),
    // A hit that lands away from the creature is not reached by its parts: nothing is said of how far they are from it.
    ...(found.remote
      ? []
      : [
          found.part === null
            ? `第 ${num(found.at)} 秒${found.shot ? "出手" : "判定"}的时候，动作「${ability.clip}」里没有任何部件在动。`
            : `第 ${num(found.at)} 秒${found.shot ? "出手" : "判定"}的那一刻，动得最靠前的部件是「${found.part.bone}」，${found.gap === 0 ? `它在${found.shot ? "出手的位置" : "判定范围"}里` : `它离${found.shot ? "出手的位置" : "判定范围"}还有 ${found.gap} 格`}。`,
        ]),
    ...(found.index === 0
      ? [
          found.windup.seconds === 0
            ? windup === null
              ? `一开始就判定，没有蓄力：玩家来不及躲。${answerWith(abilityFaultName(ability, "windup"))}`
              : `一开始就判定，不蓄力${meant(windup)}。`
            : found.windup.seen
              ? `出手前蓄力的 ${num(found.windup.seconds)} 秒里，动作在游戏里那么大的画面上走了约 ${found.windup.game} 个屏幕像素：看得出它要出手。`
              : windup === null
                ? `出手前蓄力的 ${num(found.windup.seconds)} 秒里，动作在游戏里那么大的画面上只走了约 ${found.windup.game} 个屏幕像素（不到 ${MOTION_VISIBLE.pixels} 个就看不出来）：玩家看不到蓄力，伤害像是凭空来的。${answerWith(abilityFaultName(ability, "windup"))}`
                : `出手前蓄力的 ${num(found.windup.seconds)} 秒里，动作在游戏里那么大的画面上只走了约 ${found.windup.game} 个屏幕像素（不到 ${MOTION_VISIBLE.pixels} 个就看不出来），玩家不容易看出它要出手${meant(windup)}。`,
        ]
      : []),
    ...(found.gameplay || found.remote
      ? []
      : off === null
      ? found.part === null
        ? []
        : [`蓄力之后，动作里没有朝${found.shot ? "出手的位置" : "判定范围"}挥过去再停住的一下，所以看不出这一下是什么时候打到的。`]
      : Math.abs(off) > STRIKE_TOLERANCE + 1e-9
        ? timing === null
          ? [`对不上：动作朝${found.shot ? "出手的位置" : "判定范围"}挥过去的那一下在第 ${num(found.arrives!)} 秒才到位，${found.shot ? "东西" : "伤害"}却在第 ${num(found.at)} 秒就${found.shot ? "射出去了" : "算了"}，${off > 0 ? "动作晚了" : "动作早了"} ${num(Math.abs(off))} 秒（超过 ${STRIKE_TOLERANCE} 秒，也就是两刻，玩家就看得出不同步）。把这一下的时刻（at）改成 ${num(found.arrives!)}，或者改动作；${answerWith(abilityFaultName(ability, "timing"))}`]
          : [`动作朝${found.shot ? "出手的位置" : "判定范围"}挥过去的那一下在第 ${num(found.arrives!)} 秒才到位，${found.shot ? "东西" : "伤害"}却在第 ${num(found.at)} 秒就${found.shot ? "射出去了" : "算了"}，${off > 0 ? "动作晚了" : "动作早了"} ${num(Math.abs(off))} 秒${meant(timing)}。`]
        : [`动作朝${found.shot ? "出手的位置" : "判定范围"}挥过去的那一下在第 ${num(found.arrives!)} 秒到位，和${found.shot ? "出手" : "判定"}的时刻对得上（相差不超过 ${STRIKE_TOLERANCE} 秒）。`]),
  ]
}

/** True when a hit moment and the motion disagree by more than `STRIKE_TOLERANCE`, or nothing shows before the first hit. */
export const hitDisagrees = (found: AbilityHitShape) => (found.arrives !== null && Math.abs(found.arrives - found.at) > STRIKE_TOLERANCE + 1e-9) || (found.index === 0 && !found.windup.seen)

/** One screen pixel count for a reader of the measure above. */
export const ABILITY_GAME_PIXELS = GAME_PIXELS

// ---- words ----

const shapeWords = (shape: AbilityShape) =>
  shape.type === "arena"
    ? arenaShapeWords(shape)
    :
  shape.type === "arc"
    ? `${shape.angle >= 360 ? "身边一圈" : `身前 ${num(shape.angle)}° 以内`} ${shapeInner(shape) > 0 ? `${num(shapeInner(shape))} 到 ${num(shape.reach)} 格（${num(shapeInner(shape))} 格以内是空的，站在里面打不到）` : `${num(shape.reach)} 格`}`
    : shape.type === "box"
      ? `身前 ${num(shape.forward)} 格处一块 ${num(shape.width)}×${num(shape.height)}×${num(shape.depth)} 格的地方`
      : shape.type === "sphere"
        ? `身前 ${num(shape.forward)} 格处半径 ${num(shape.radius)} 格的一团`
        : shape.type === "line"
          ? `${shape.aim === "level" ? "水平朝前" : "朝目标"}的一条 ${num(shape.length)} 格长、${num(shape.radius * 2)} 格粗的直线`
          : `${shape.aim === "level" ? "水平朝前" : "朝目标"}张开 ${num(shape.angle)}° 的 ${num(shape.length)} 格长的一片`

/** A shape put down somewhere other than round the creature (only a ball, a box or a full circle can be), said from its own middle. */
const placedShapeWords = (shape: AbilityShape) =>
  shape.type === "arena"
    ? arenaShapeWords(shape)
    :
  shape.type === "sphere" ? `半径 ${num(shape.radius)} 格的一团` : shape.type === "box" ? `${num(shape.width)}×${num(shape.height)}×${num(shape.depth)} 格的一块地方` : shape.type === "arc" ? (shapeInner(shape) > 0 ? `内半径 ${num(shapeInner(shape))}、外半径 ${num(shape.reach)} 格的一圈环` : `半径 ${num(shape.reach)} 格的一圈`) : shapeWords(shape)

const abilityStartTrigger = (ability: Pick<Ability, "start"> & { on_hurt?: OnHurt | undefined }) =>
  ability.on_hurt ? parryStartWords({ start: ability.start, on_hurt: ability.on_hurt }) : `目标在 ${span(ability.start.min_distance, ability.start.max_distance)} 格${ability.start.line_of_sight ? "、看得见" : ""}的时候`

const abilityStartConditions = (start: Ability["start"]) => [
  ...(start.when ?? []).flatMap(rule => rule.if === "target_bearing" ? [bearingConditionWords(rule)] : []),
  start.keep_heading ? "起手时可保持身体朝向" : "",
  ...(start.weight_when ?? []).flatMap(rule => rule.if === "target_bearing" ? [`${bearingConditionWords(rule)}时，选中权重 ×${rule.scale}`] : []),
].filter(Boolean)

export const abilityWords = {
  /** 「第 0.65 秒打身前 120° 以内 3 格里的所有生物：掉 8 点血、被打退（或被拉过去）、变慢 3 秒」 */
  // `gameplayName`: the name the project shows the gameplay by, when the reader has the project (the card does); without it the sentence does not name it.
  hit: (hit: AbilityHit, gameplayName?: (slug: string) => string | null, names?: ParticleNames) =>
    hit.type === "gameplay"
      ? `第 ${num(hit.at)} 秒由玩法${((name) => (name ? `「${name}」` : ""))(gameplayName?.(hit.gameplay) ?? null)}的代码接着做（做什么、做到什么程度，看那个玩法的说明，要进游戏看）`
      : hit.type === "projectile"
      ? projectileWords(hit, names) + (hit.once_group ? `，同组命中每人只扣一次血` : "")
      : hit.type === "shot"
      ? `第 ${num(hit.at)} 秒${hit.bone === undefined ? "" : `从「${names?.bone?.(hit.bone) ?? hit.bone}」那里`}朝目标射出一个${ABILITY_PROJECTILES[hit.projectile].name}（${hit.damage === null ? ABILITY_PROJECTILES[hit.projectile].does : `打中掉 ${num(hit.damage)} 点血`}）${hit.once_group ? `，同组命中每人只扣一次血` : ""}`
      : `第 ${num(hit.at)} 秒${hit.bone === undefined ? "" : `以「${names?.bone?.(hit.bone) ?? hit.bone}」为起点（范围从那个部位算，不从脚下算）`}${hitElsewhere(hit) ? `在${placeWords(hitPlace(hit))}${hitPlace(hit) === "target" ? "" : "各"}打${placedShapeWords(hit.shape)}` : `打${shapeWords(hit.shape)}`}里的${hit.hits === "target" ? "目标" : "所有生物"}${hit.warn ? `（${warnWords(hit.warn)}）` : ""}${hit.safe ? `，${safeWords(hit.safe)}` : ""}：${
          [...(hit.damage > 0 ? [`掉 ${num(hit.damage)} 点血`] : []), ...(hit.knockback > 0 ? ["被打退"] : hit.knockback < 0 ? ["被拉过去"] : []), ...hit.effects.map((effect) => `${ABILITY_EFFECTS[effect.effect]} ${num(effect.duration_ticks / TICKS, 1)} 秒`), ...(hitForce(hit) ? [forceWords(hitForce(hit)!)] : [])].join("、") || "什么都不会发生"
        }（那一刻不在范围里就打不中${hit.blocked_by_walls ? "；中间有实心方块也打不中，推拉无效；挡范围出手的临时地形同样能遮住目标" : ""}）${hit.once_group ? `，同组命中每人只扣一次血` : ""}`,
  /**
   * What the ability's hits do to whoever they reach, as short words in the order they are felt: 「掉血、被推开、被拉过来、变慢」. Read from the hits themselves, so a test step
   * asks the person to look for what this ability really does and not for a hit it does not have; null when none of its hits does anything to anybody (it is only seen and heard).
   */
  felt: (ability: Ability) => {
    const done = new Set<string>()
    for (const hit of ability.hits) {
      if (hit.type === "gameplay") continue
      // Boss 能力 2: a thrown thing of its own does what it says, as an area hit does.
      if (hit.type === "projectile") {
        if (hit.damage > 0) done.add("掉血")
        if (hit.knockback > 0) done.add("被推开")
        for (const effect of hit.effects) done.add(ABILITY_EFFECTS[effect.effect])
        continue
      }
      if (hit.type === "shot") {
        // A shot does what its kind does in the game (ABILITY_PROJECTILES.does): an arrow its written damage, a snowball only a push, the fireballs their vanilla damage, fire and blast.
        if (hit.projectile === "snowball") done.add("被推开")
        else if (hit.projectile === "fireball") done.add("被炸到")
        else done.add("掉血")
        if (hit.projectile === "small_fireball") done.add("着火")
        continue
      }
      if (hit.damage > 0) done.add("掉血")
      if (hit.knockback > 0) done.add("被推开")
      if (hit.knockback < 0) done.add("被拉过来")
      for (const effect of hit.effects) done.add(ABILITY_EFFECTS[effect.effect])
      if (hit.force) done.add(hit.force.kind === "pull" ? "被拉着走" : "被推着走")
    }
    // Boss 能力 7: a lightning that hurts is felt as a hit is.
    if (ability.events.some((event) => event.type === "lightning" && event.damage > 0)) done.add("掉血")
    return done.size ? [...done].join("、") : null
  },
  /** 「目标在 0–3 格、看得见的时候」 */
  // Boss 能力 14: one started by a blow says the blow, the attacker's window and the chance instead (「被近战打中（出手的人离它 0–4 格）的时候，有 15% 的机会」).
  start: (ability: Pick<Ability, "start"> & { on_hurt?: OnHurt | undefined }) => [abilityStartTrigger(ability), ...abilityStartConditions(ability.start)].join("，"),
  /** The whole ability, its phases in order: one sentence, or with `between` a line each as the card shows it. */
  summary: (ability: Ability, between = "；", gameplayName?: (slug: string) => string | null, motion?: (clip:string)=>string, stagger?: Stagger, names?: ParticleNames) =>
    [
      abilityStartTrigger(ability) + "会用",
      ...abilityStartConditions(ability.start),
      ability.windup > 0 ? `先蓄力 ${num(ability.windup)} 秒（${ability.facing === "track" ? "一直转向目标" : "朝向不变"}）` : "不蓄力",
      // 第 3 步: until when it turns and how fast, and its stages (ability-tactics.ts).
      ...[trackWords(ability), stageWords(ability,motion)].filter((words): words is string => words !== null),
      ...ability.hits.map((hit) => abilityWords.hit(hit, gameplayName, names)),
      ...ability.moves.map((move) => (isPush(move) ? `第 ${num(move.at)} 秒自己${move.forward < 0 ? "往后" : "往前"}${move.up > 0 ? "跳" : "冲"}一下` : isLeave(move) ? leaveWords(move) : isLeap(move) ? leapWords(ability)! : dashWords(ability)!)),
      `全程 ${num(ability.length)} 秒${ability.start.cooldown > 0 ? `，之后歇 ${num(ability.start.cooldown)} 秒` : ""}`,
      // Boss 能力 14: what one started by a blow does to that blow and to the one who struck, and its wait.
      ...(ability.on_hurt ? [parryWords(ability.on_hurt)] : []),
      abilityInterruptionWords(ability, stagger),
    ].join(between),
  /** Terrain changes deserve a caption even when no hit is drawn at the same time. */
  terrain: (ability: Ability) => [
    ...ability.events.flatMap((event) => event.type === "break" ? [bossWords.breaks(event)] : isTerrainEvent(event) ? [terrainWords(event)] : event.type === "shockwave" && event.pop_blocks ? [groundEventWords(event)] : []),
    ...ability.hits.flatMap((hit) => hit.type === "projectile"
      ? (hit.impact?.ground ?? []).flatMap((event) => event.type === "shockwave" && event.pop_blocks ? [`投射物落地后掀起地面方块 ${event.pop_blocks.height} 格再落回（只显示，最多 ${event.pop_blocks.max} 块）`] : [])
      : []),
  ],
  /** What is heard and seen, when anything is: 「第 0.65 秒「铁砧落地」的声音、爆炸」 */
  events: (ability: Ability, lookup: ParticleNames | ((id: string) => string | null) = {}) => {
    const names = typeof lookup === "function" ? { title: lookup } : lookup
    return ability.events.flatMap((event) => (event.type==="particle" && (extendedEmit(event) || event.forward || event.up || event.left) ? [scatterWords(event, names.displayNames ? particleLabel(event.particle, names) : particleWords(event,names.title,names.aliases), names.bone)] : event.type === "effect" ? [] : event.type === "camera" ? [cameraWords(event)] : event.type === "sky_tint" ? [skyTintWords(event)] : event.type === "shake" ? [bossWords.shake(event)] : event.type === "debris" ? [bossWords.debris(event)] : event.type === "break" ? [bossWords.breaks(event)] : event.type === "trail" ? [trailWords(event)] : event.type === "drop" ? [bossWords.drop(event)] : event.type === "lightning" ? [lightningWords(event, placeWords(event.place), event.warn ? warnWords(event.warn) : null)] : event.type === "fixture" ? [`第 ${event.at} 秒${fixtureWords(event)}`] : event.type === "fog" ? [fogEventWords(event)] : isTerrainEvent(event) ? [terrainWords(event)] : isGroundFx(event) ? [groundEventWords(event, names.title, names.aliases)] : [`第 ${num(event.at)} 秒${event.type === "hit_fx" ? `命中反馈（${{light:"轻",medium:"中",heavy:"重"}[event.level]}）` : event.type === "sound" ? (isSoundAsset(event.sound) ? (names.title?.(event.sound.asset) ? `播放「${names.title(event.sound.asset)}」` : "播放这个工程的声音") : `「${ABILITY_SOUNDS[event.sound] ?? event.sound}」的声音`) + (event.pitch_to !== undefined ? `（起手音高从 ${event.pitch} 升到 ${event.pitch_to}）` : "") + (event.pitch_variation ? `（音高上下浮动 ${num(event.pitch_variation * 100)}%）` : "") : event.type === "stance" ? `切到「${event.to}」姿态` : `${names.displayNames ? particleLabel(event.particle, names) : particleWords(event, names.title, names.aliases)}的粒子`}`])).join("、")
  },
}

// ---- an ability against the model it plays on ----

/** How far an ability may reach and still be a swing at whoever stands next to the creature: a creature that does not walk needs an ability that reaches further than this. */
export const STATIONARY_MELEE = 4

/** 第 3 步: until when an ability's own motion plays: its end, or the start of its first stage that brings a motion of its own. */
const clipUntil = (ability: Pick<Ability, "length" | "stages">) => {
  const stages = ability.stages ?? []
  const switched = stages.findIndex((stage, index) => index > 0 && stage.clip !== undefined)
  return switched > 0 ? stages[switched - 1]!.until : ability.length
}

export type AbilityIssue = { refs?: import("@minemods/studio-ai/acceptance").FindingRef[]; ability: string; rule: "ability_clip" | "ability_length" | "ability_unused" | "ability_gap" | "ability_reach" | "ability_timing" | "ability_windup" | "ability_bone" | "ability_rehit" | "ability_warn" | "ability_trail" | "ability_move" | "combo_window" | "combo_rehit" | "ability_projectile" | "ability_parry"; stops: boolean; text: string; fix: string; detail: string }

/**
 * Boss 能力 3: how far ahead of the creature an area hit put down somewhere else reaches, in blocks: wherever the one it fights is for one at their feet (never said to fall short),
 * the furthest of its places and what the shape covers beyond it for a pattern. Null for a hit that lands round the creature, measured as it always was.
 */
const placedFar = (hit: AbilityHit) => {
  if (hit.type !== "area" || !hitElsewhere(hit)) return null
  const place = hitPlace(hit)
  return typeof place === "object" && place.type === "pattern" ? Math.max(...place.points.map((point) => point.forward)) + shapeFar(hit.shape) : Number.POSITIVE_INFINITY
}

/**
 * Boss 能力 3: what makes a warned or placed hit hard to get out of, said and never a stop: a warning shorter than a player can act on (`WARN_LIMITS.readable`), one centred on the one it
 * fights that is shorter than walking out of it takes (`warnEscape` at `WARN_LIMITS.walk`), and a hit at their feet with no warning at all.
 */
function warnIssues(creature: { name: string }, ability: Ability): AbilityIssue[] {
  const warns = warnPlan(ability)
  return ability.hits.flatMap((hit, index): AbilityIssue[] => {
    if (hit.type !== "area") return []
    const said = (text: string, fix: string, detail: string): AbilityIssue => ({ ability: ability.id, refs: [abilityRef(ability)], rule: "ability_warn", stops: false, text: `「${creature.name}」的招式「${ability.name}」第 ${index + 1} 次出手${text}`, fix, detail: `ability ${ability.id} hit ${index}: ${detail}` })
    const warn = warns[index]
    if (!hit.warn || !warn) return hitOnTarget(hit) ? [said("打在目标脚下，却没有预警（warn）：玩家看不出要躲到哪里，只能挨打。", "给这一下写 warn（提前多少秒、ring 或 pillar、颜色），让玩家看到落点再躲。", `place ${JSON.stringify(hitPlace(hit))}; no warning`)] : []
    const lead = num(warn.ticks / TICKS)
    const escape = warnEscape(hit.shape)
    return [
      ...(lead < WARN_LIMITS.readable - 1e-9 ? [said(`的预警只提前 ${lead} 秒（不到 ${WARN_LIMITS.readable} 秒）：玩家看到了也来不及躲。`, `把 warn.seconds 改到 ${WARN_LIMITS.readable} 秒以上；预警最早在招式开始时出现，at 不够大就把这一下往后挪。`, `warning ${warn.ticks} ticks before the hit; readable from ${WARN_LIMITS.readable * TICKS}`)] : []),
      ...(hitPlace(hit) === "target" && lead >= WARN_LIMITS.readable - 1e-9 && lead < escape / WARN_LIMITS.walk - 1e-9
        ? [said(`打在目标脚下，目标站在正中要走 ${escape} 格才出得了判定范围，走路（每秒 ${WARN_LIMITS.walk} 格）要 ${num(escape / WARN_LIMITS.walk)} 秒，预警却只提前 ${lead} 秒：不跑就躲不开。`, `把 warn.seconds 改到 ${num(Math.min(WARN_LIMITS.seconds.max, escape / WARN_LIMITS.walk))} 秒以上，或者把判定范围改小。`, `warning ${lead} s; ${escape} blocks to walk out at ${WARN_LIMITS.walk} blocks/s`)]
        : []),
    ]
  })
}

/** How many of a model's parts a sentence about a missing one lists before it says "and others": enough to find the right one, short enough to read. */
const BONES_LISTED = 24

/** A name with what a typist gets wrong taken out (case, spaces, dashes, underscores). */
const looseName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")

/** The fewest single-letter changes (a letter added, left out or changed, or two neighbouring ones swapped) that turn one name into the other. */
function editDistance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1)
    }
  return rows[a.length]![b.length]!
}

/** How near a name has to be to one the model has to be offered as what was meant: a slip of the keys, and only for names long enough that two changes do not make another word. */
const NEAR_NAME = 2

/**
 * The start of a measured sentence about a part of the model that is not there, as the look writes it: it starts with the word that makes the making loop and the reviewer take the line as a
 * fault to answer (`abilityFault` in studio-ai reads it), so a version that names a part its model lacks is never taken as finished.
 */
export const BONE_FAULT_MARK = "缺这个部件："

/**
 * Every place a creature's document names a part (bone) of its model, checked against the parts the model really has: the one rule, so that the look, the draft, the commit and the build
 * all say the same thing about the same mistake. Today those places are the bone of each hit of each ability (where the hit counts from, and for a shot where the projectile leaves from;
 * everything else in an ability is counted from the feet or from the creature) and the bone of each part of the collision box (a description, which the game never reads).
 * A hit that names a part the model lacks `stops` the build: it could not be played as written, and a picture of it would be drawn from the feet, which is not what the document says. A box part's
 * bone is only a note, so it never stops anything. The sentence names the missing part, lists the parts that exist (and a near miss in spelling, when there is one), and says what to do.
 * Anything that names a part must be added here, not checked on its own: this is why the maker of a creature was once told nothing about `bolt_rail` until the build refused it.
 */
export function boneIssues(creature: { name: string; emitters?: readonly Emitter[]; abilities?: readonly Ability[] | null; hitbox?: Pick<Hitbox, "parts"> | null }, design: Pick<ModelDesign, "bones">): AbilityIssue[] {
  const names = design.bones.map((bone) => bone.name)
  const has = new Set(names)
  const have = names.length ? `${names.slice(0, BONES_LISTED).join("、")}${names.length > BONES_LISTED ? `等 ${names.length} 个` : ""}` : "一个部件也没有"
  const near = (bone: string) => {
    const mine = looseName(bone)
    const like = names.find((name) => looseName(name) === mine) ?? (mine.length > NEAR_NAME * 2 ? names.find((name) => editDistance(looseName(name), mine) <= NEAR_NAME) : undefined)
    return like ? `（模型里有名字很像的「${like}」，是不是写错了）` : ""
  }
  const hits = (creature.abilities ?? []).flatMap((ability) =>
    ability.hits.flatMap((hit, index): AbilityIssue[] => {
      const bone = hitBone(hit)
      return bone === undefined || has.has(bone)
        ? []
        : [
            {
              ability: ability.id, refs: [abilityRef(ability), boneRef(bone)],
              rule: "ability_bone",
              stops: true,
              text: `「${creature.name}」的招式「${ability.name}」第 ${index + 1} 次出手写的部位（bone）是「${bone}」，可是它的模型里没有这个部件${near(bone)}。${hit.type === "shot" ? "射出去的位置" : "判定范围"}只能先按从脚下算来画，不是从这个部件。`,
              fix: `模型里有的部件是：${have}。把 bone 改成其中一个，或者去掉 bone，让这一下从脚下算；真要从一个新的部件出手，就要先让模型有这个部件。`,
              detail: `ability ${ability.id} hit ${index}: bone ${bone}; model has: ${names.join(", ")}`,
            },
          ]
    }),
  )
  // Boss 能力 2: a thrown thing that looks like a part of the creature is drawn from that part's own cubes, and the part is hidden on the creature while it is out.
  const looks = (creature.abilities ?? []).flatMap((ability) =>
    ability.hits.flatMap((hit, index): AbilityIssue[] =>
      hit.type !== "projectile" || !("bone" in hit.look) || has.has(hit.look.bone)
        ? []
        : [
            {
              ability: ability.id, refs: [abilityRef(ability), boneRef(hit.look.bone)],
              rule: "ability_bone",
              stops: true,
              text: `「${creature.name}」的招式「${ability.name}」第 ${index + 1} 次出手扔的是部件「${hit.look.bone}」（look），可是它的模型里没有这个部件${near(hit.look.bone)}。扔出去的东西画不出来。`,
              fix: `模型里有的部件是：${have}。把 look.bone 改成兵器所在的部件，或者改用效果资产当它的样子（look:{"effect":"…"}）。`,
              detail: `ability ${ability.id} hit ${index}: look bone ${hit.look.bone}; model has: ${names.join(", ")}`,
            },
          ],
    ),
  )
  // Boss 能力 11: a trail follows the far end of a part, which is a corner of that part's own cubes (`trailTip`): a part the model lacks, or one with no cube of its own, has no end to follow.
  const trails = (creature.abilities ?? []).flatMap((ability) =>
    trailEvents(ability).flatMap(({ index, event }): AbilityIssue[] => {
      if (!has.has(event.bone))
        return [
          {
            ability: ability.id, refs: [abilityRef(ability), boneRef(event.bone)],
            rule: "ability_bone",
            stops: true,
            text: `「${creature.name}」的招式「${ability.name}」的拖尾（events 第 ${index + 1} 个）写的部位（bone）是「${event.bone}」，可是它的模型里没有这个部件${near(event.bone)}。拖尾跟的是这个部件的末端，没有它就画不出来。`,
            fix: `模型里有的部件是：${have}。把 bone 改成兵器所在的那个部件。`,
            detail: `ability ${ability.id} event ${index}: trail bone ${event.bone}; model has: ${names.join(", ")}`,
          },
        ]
      if (trailTip(design, event.bone)) return []
      return [
        {
          ability: ability.id, refs: [abilityRef(ability), boneRef(event.bone)],
          rule: "ability_bone",
          stops: true,
          text: `「${creature.name}」的招式「${ability.name}」的拖尾（events 第 ${index + 1} 个）跟着「${event.bone}」的末端，可是这个部件自己一个方块也没有：末端是它自己的方块里离转轴最远的那个角，没有方块就没有末端。`,
          fix: `把 bone 改成兵器的方块真正所在的那个部件（常常是「${event.bone}」下面挂着的那个），或者把兵器的方块放进「${event.bone}」。`,
          detail: `ability ${ability.id} event ${index}: trail bone ${event.bone} has no cubes of its own`,
        },
      ]
    }),
  )
  const parts = (creature.hitbox?.parts ?? []).flatMap((part): AbilityIssue[] =>
    part.bone == null || has.has(part.bone)
      ? []
      : [
          {
            ability: `hitbox:${part.name}`,
            refs: [partRef(part.name), boneRef(part.bone)],
            rule: "ability_bone",
            stops: false,
            text: `「${creature.name}」的碰撞箱部位「${part.name}」写的 bone 是「${part.bone}」，模型里没有这个部件${near(part.bone)}：这个箱子跟不了骨骼，只能停在写的位置。`,
            fix: `模型里有的部件是：${have}。改成其中一个，或者去掉这一项。`,
            detail: `hitbox part ${part.name}: bone ${part.bone}; model has: ${names.join(", ")}`,
          },
        ],
  )
  // 第 4 步: a beam from a part starts at that part's middle (`groundFxStarts`): a part the model lacks has none.
  const beams = (creature.abilities ?? []).flatMap((ability) =>
    groundFxEvents(ability).flatMap(({ index, event }): AbilityIssue[] =>
      event.type !== "beam" || event.bone === undefined || has.has(event.bone)
        ? []
        : [{ ability: ability.id, refs: [abilityRef(ability), boneRef(event.bone)], rule: "ability_bone", stops: true, text: `「${creature.name}」的招式「${ability.name}」的光束（events 第 ${index + 1} 个）写的部位（bone）是「${event.bone}」，可是它的模型里没有这个部件${near(event.bone)}。光束从这个部件的中心射出，没有它就不知道从哪里射。`, fix: `模型里有的部件是：${have}。把 bone 改成其中一个，或者去掉 bone 让光束从脚下（加上 forward、up、left）射出。`, detail: `ability ${ability.id} event ${index}: beam bone ${event.bone}; model has: ${names.join(", ")}` }],
    ),
  )
  const emitBones = [...(creature.emitters ?? []).map(e => ({ bone: e.bone, ability: "", label: "常驻发射" })), ...(creature.abilities ?? []).flatMap(a => a.events.flatMap(e => e.type === "particle" ? [{ bone: e.bone, ability: a.id, label: `招式「${a.name}」的粒子` }] : []))]
  return [...hits, ...looks, ...trails, ...beams, ...parts, ...emitBones.flatMap((e): AbilityIssue[] => e.bone && !has.has(e.bone) ? [{ ability: e.ability, rule: "ability_bone", stops: true, text: `${e.label}找不到部件「${e.bone}」${near(e.bone)}。`, fix: `可选部件有${have}。`, detail: `particle bone ${e.bone}` }] : [])]
}

/**
 * Boss 能力 7: what makes a lightning hard to get out of, said and never a stop, by the same measures as a warned hit's (`warnIssues`): its warning shorter than a player can act on,
 * one at the feet of the one it fights shorter than walking out of its column takes, and one at their feet with no warning at all. Measured on the hit it lands as (`struckAbility`).
 */
function lightningIssues(creature: { name: string }, ability: Ability): AbilityIssue[] {
  if (!lightningEvents(ability).length) return []
  const struck = struckAbility(ability) as Ability
  const warns = warnPlan(struck)
  return struck.hits.flatMap((hit, index): AbilityIssue[] => {
    const event = strikeOf(ability, hit)
    if (!event || hit.type !== "area") return []
    const said = (text: string, fix: string, detail: string): AbilityIssue => ({ ability: ability.id, refs: [abilityRef(ability)], rule: "ability_warn", stops: false, text: `「${creature.name}」的招式「${ability.name}」第 ${num(event.at)} 秒的落雷${text}`, fix, detail: `ability ${ability.id} lightning ${isLightningHit(hit) ? hit.lightning : index}: ${detail}` })
    const warn = warns[index]
    if (!event.warn || !warn) return event.place === "target" || (typeof event.place === "object" && event.place.type === "around_target") ? [said("劈在目标脚下，却没有预警（warn）：玩家看不出要躲到哪里，只能挨劈。", "给这道雷写 warn（提前多少秒、look 写 pillar 就是一圈加光柱、颜色），让玩家看到落点再躲。", `place ${JSON.stringify(event.place)}; no warning`)] : []
    const lead = num(warn.ticks / TICKS)
    const escape = warnEscape(hit.shape)
    return [
      ...(lead < WARN_LIMITS.readable - 1e-9 ? [said(`的预警只提前 ${lead} 秒（不到 ${WARN_LIMITS.readable} 秒）：玩家看到了也来不及躲。`, `把 warn.seconds 改到 ${WARN_LIMITS.readable} 秒以上；预警最早在招式开始时出现，at 不够大就把落雷往后挪。`, `warning ${warn.ticks} ticks before the strike; readable from ${WARN_LIMITS.readable * TICKS}`)] : []),
      ...(event.place === "target" && lead >= WARN_LIMITS.readable - 1e-9 && lead < escape / WARN_LIMITS.walk - 1e-9
        ? [said(`劈在目标脚下，目标站在正中要走 ${escape} 格才出得了半径 ${num(event.radius)} 格的雷柱，走路（每秒 ${WARN_LIMITS.walk} 格）要 ${num(escape / WARN_LIMITS.walk)} 秒，预警却只提前 ${lead} 秒：不跑就躲不开。`, `把 warn.seconds 改到 ${num(Math.min(WARN_LIMITS.seconds.max, escape / WARN_LIMITS.walk))} 秒以上，或者把 radius 改小。`, `warning ${lead} s; ${escape} blocks to walk out at ${WARN_LIMITS.walk} blocks/s`)]
        : []),
    ]
  })
}

/**
 * What is wrong with a creature's abilities, by rule. `clips` are its model's motions (null: the model is
 * not known here, so only what the creature's own document shows is checked). A finding that `stops` is one
 * the build refuses: the ability could not be played as written. `design`: the model, when it is known: a hit that names a bone the
 * model lacks is refused, and a hit that counts from a bone reaches that much further ahead of the feet than its shape says.
 */
export function abilityIssues(creature: { stagger?: Stagger | undefined; guard?: Guard; name: string; behavior: string; flight?: Flight | null; abilities?: readonly Ability[] | null; combos?: readonly Combo[] | null; stationary?: unknown; hitbox?: (Pick<Hitbox, "parts"> & { core?: { step?: number | null; width?: number | null } }) | null; boss?: (Pick<Boss, "leash" | "lair"> & Partial<Pick<Boss,"phases" | "damage_cap" | "intro">>) | null; habits?: Pick<Habits, "home"> | null }, clips: readonly Clip[] | null, design: Pick<ModelDesign, "bones" | "animations"> | null = null): AbilityIssue[] {
  const abilities = creature.abilities ?? []
  // The parts of the model the document names are checked first and by the one function (`boneIssues`), whether or not there are abilities (a box part names one too).
  const missing = design ? boneIssues(creature, design) : []
  if (!abilities.length) return missing
  const nearest = Math.min(...abilities.map((ability) => ability.start.min_distance))
  // How far an ability reaches from where its creature stands. A hit that counts from a bone reaches that bone's distance ahead of the feet further; with the model unknown, how far it is is unknown too, and it is not said to fall short.
  // r29c (狍鸮): a harmless hit (`harmlessHit`) is not what an ability reaches with, unless it has nothing else; one that has nothing else, or that retreats (`retreats`), is not held to its window at all (`measured`).
  const counted = (ability: Ability, hit: AbilityHit) => !harmlessHit(hit) || ability.hits.every(harmlessHit)
  const measured = (ability: Ability) => !retreats(ability) && ability.hits.some((hit) => !harmlessHit(hit))
  // r29c (狍鸮): an ability started only with the one it fights at its side or behind it reaches the furthest it does the ways they may stand then (`startBearings`); null for every other.
  const toward = (ability: Ability, hit: AbilityHit, index: number) => {
    const angles = startBearings(ability)
    if (!angles || hit.type !== "area" || placedFar(hit) !== null) return null
    const anchor = hit.bone === undefined ? { forward: 0, left: 0 } : design ? hitAnchor(ability, index, design) : null
    return anchor === null ? Number.POSITIVE_INFINITY : Math.max(0, ...angles.map((angle) => shapeToward(hit.shape, anchor, angle)?.[1] ?? 0))
  }
  const reachOf = (ability: Ability) =>
    Math.max(
      // A shot, and what a gameplay does at its moment, have no reach to measure: never said to fall short.
      ...ability.hits.map((hit, index) => !counted(ability, hit) ? Number.NEGATIVE_INFINITY : toward(ability, hit, index) ?? (hit.type !== "area" ? Number.POSITIVE_INFINITY : placedFar(hit) !== null ? placedFar(hit)! : hit.bone === undefined ? shapeFar(hit.shape) : ((anchor) => (anchor === null ? Number.POSITIVE_INFINITY : shapeFar(hit.shape) + Math.max(0, anchor.forward)))(design ? hitAnchor(ability, index, design) : null))),
    )
  const farthest = Math.max(...abilities.map((ability) => (ability.dive || movesForward(ability) ? Number.POSITIVE_INFINITY : reachOf(ability))))
  // r29 (狰): a leap carries it toward the one it fights, up to `max_distance` and stopping `short` of them, before the hits that come once it has left the ground: from
  // where it lands, what is left between them is the most that has to be reached. The start window was measured from where it stood (an ability that pounced 7 was said to reach 1.7).
  const left = (ability: Ability, distance: number) => {
    const leap = ability.moves.find(isLeap)
    return leap && ability.hits.some((hit) => hit.at >= leap.at) ? Math.max(leap.short ?? 0, distance - leap.max_distance) : distance
  }
  // r29 (狰): an ability its own start never picks (its weight is 0 at every health, seen or not) and that a combo uses runs only as that combo's step: its own start window is never asked,
  // so the window's reach is not said to fall short (the combo's step starts wherever the step before it ended).
  const comboOnly = (ability: Ability) => {
    if (!(creature.combos ?? []).some((combo) => combo.steps.includes(ability.id))) return false
    const lines = [...new Set([0, 1, ...(ability.start.weight_when ?? []).flatMap((rule) => ("share" in rule ? [rule.share] : []))])].sort((a, b) => a - b)
    return lines.slice(1).every((high, index) => [true, false].every((visible) => combatWeight(ability.start, (lines[index]! + high) / 2, visible) === 0))
  }
  return [
    ...combatAdvice(creature),
    ...missing,
    ...abilities.flatMap((a,i): AbilityIssue[] => {
      if (!creature.boss) return []
      const sounds = a.events.flatMap(event => event.type === "sound" ? [{ name:`「${a.name}」第 ${event.at} 秒的提示音`, reach:soundReach(event.volume,event.range_blocks), distance:a.start.max_distance }] : [])
      const intro=creature.boss.intro
      if (i === 0 && intro?.sound) sounds.push({ name:"开场提示音",reach:soundReach(intro.volume ?? 2,intro.range_blocks),distance:Math.max(...abilities.map(v=>v.start.max_distance)) })
      return sounds.filter(v=>v.reach<v.distance).map(v=>({ability:a.id,refs:[abilityRef(a)],rule:"ability_warn",stops:false,text:`${v.name}约传 ${v.reach} 格，在 ${v.distance} 格的出招距离可能听不到。`,fix:`把可闻距离设为至少 ${v.distance} 格。`,detail:`range_blocks`}))
    }),
    ...abilities.flatMap(a => a.events.flatMap((event): AbilityIssue[] => {
      if ((event.type !== "shockwave" && event.type !== "hazard") || event.damage <= 0) return []
      const overlap = a.hits.some((hit, i) => {
        if (hit.type !== "area" || hit.damage <= 0 || hit.at > event.at || event.at - hit.at > 0.500001 || (hit.once_group && hit.once_group === event.once_group && !!hit.once_across_steps === !!event.once_across_steps)) return false
        if (event.where === "hit" && event.hit === i) return true
        if (event.where !== "self" || hit.type !== "area" || hit.place || hit.shape.type !== "sphere") return false
        const distance = Math.hypot(hit.shape.forward-event.forward,hit.shape.left-event.left)
        const outer = event.type === "hazard" ? event.radius : event.to_radius + event.width/2
        const inner = event.type === "hazard" ? 0 : Math.max(0,event.from_radius-event.width/2)
        return distance-hit.shape.radius <= outer && distance+hit.shape.radius >= inner
      })
      return overlap ? [{ ability:a.id,rule:"ability_rehit",stops:false,text:`「${a.name}」先砸一下，半秒内又有地面效果扫过同一片，贴身的人会挨两次。`,fix:"如果每人只该挨一次，把这两次出手填进同一个命中组。",detail:`${event.at} 秒` }] : []
    })),
    ...(creature.behavior === "hostile" ? [] : [{ ability: abilities[0]!.id, rule: "ability_unused" as const, stops: false, text: `「${creature.name}」不会主动攻击，所以它的 ${abilities.length} 个招式在游戏里永远用不出来。`, fix: "把它改成会主动攻击（hostile），或者去掉招式。", detail: `behavior: ${creature.behavior}` }]),
    // A creature that walks and has an ability that is not a dive steps back into that ability's window when its target is nearer (`abilityBackOff`, broad12: the warning
    // still said it would only stand and be hit). One that may not walk (stationary), or whose abilities are all dives, still has nothing to do up close.
    // r29c (鵕鸟): a flier with an ability it may start in the air goes up after its target and circles it (`flightPlan` `fights`): nobody comes up to it standing, so it is not said to only stand and be hit.
    ...(nearest > 2 && (creature.stationary || (abilities.every((ability) => ability.dive) && !(creature.flight && abilities.some((ability) => ability.where !== "ground")))) ? [{ ability: abilities[0]!.id, rule: "ability_gap" as const, stops: false, text: `玩家贴到「${creature.name}」身边（${num(nearest)} 格以内）时，它没有任何招式可用，只会站着挨打。`, fix: "给它加一个近身能用的招式，或者把某个招式的最近距离（start.min_distance）改小。", detail: `smallest start.min_distance: ${nearest}` }] : []),
    // A creature that stays where it is does not walk up to anyone: with no ability that reaches further than a swing (a shot, a long beam or cone), it only ever fights whoever comes to it.
    ...(creature.behavior === "hostile" && creature.stationary && farthest <= STATIONARY_MELEE ? [{ ability: abilities[0]!.id, rule: "ability_reach" as const, stops: false, text: `「${creature.name}」故意守在原地（stationary），不会走过去追玩家，可是它的招式最远只打得到 ${num(farthest)} 格：玩家不走到它身边，它什么也做不了。`, fix: "给它一个远处能用的招式（射出去的 shot，或者长一点的光束、锥形），或者去掉 stationary 让它能追上去。", detail: `stationary; furthest reach of its abilities: ${farthest}` }] : []),
    ...abilities.flatMap((ability): AbilityIssue[] => {
      const clip = clips?.find((value) => value.name === ability.clip)
      const reach = reachOf(ability)
      // broad11 w1 recheck2: a wind blade that starts up to 10 blocks away from a wing tip 3.6 blocks to its left with a beam 8 long missed whoever stood past it. How far straight ahead
      // the furthest hit meets someone: from a bone, its own distance ahead and, for a beam or a cone aimed across from beside the body, what is left of the length after crossing over.
      const ahead = Math.max(
        ...ability.hits.map((hit, index) => {
          if (!counted(ability, hit)) return Number.NEGATIVE_INFINITY
          const aside = toward(ability, hit, index)
          if (aside !== null) return aside
          if (hit.type !== "area") return Number.POSITIVE_INFINITY
          if (placedFar(hit) !== null) return placedFar(hit)!
          const far = shapeFar(hit.shape) + (hit.shape.type === "line" ? hit.shape.radius : 0)
          if (hit.bone === undefined) return far
          const anchor = design ? hitAnchor(ability, index, design) : null
          if (anchor === null) return Number.POSITIVE_INFINITY
          return anchor.forward + (shapeAims(hit.shape) ? Math.sqrt(Math.max(0, far * far - anchor.left * anchor.left)) : far)
        }),
      )
      return [
        ...(clips && !clip
          ? [{ ability: ability.id, refs: [abilityRef(ability), clipRef(ability.clip)], rule: "ability_clip" as const, stops: true, text: `「${creature.name}」的招式「${ability.name}」要播「${clipRef(ability.clip).title}」这个动作，可是它的模型里没有这个动作。`, fix: `给模型加上名叫 ${ability.clip} 的动作，或者把招式换成模型里有的动作（${clips.filter((value) => !(RESERVED_CLIPS as readonly string[]).includes(value.name)).map((value) => value.name).join("、") || "现在一个可用的都没有"}）。`, detail: `clip: ${ability.clip}; model has: ${clips.map((value) => value.name).join(", ")}` }]
          : []),
        // 第 3 步: with stages its own motion plays until the first stage that brings one of its own (`clipUntil`).
        ...(clip && clipUntil(ability) > clip.length + 1 / TICKS / 2
          ? [{ ability: ability.id, refs: [abilityRef(ability)], rule: "ability_length" as const, stops: true, text: `「${creature.name}」的招式「${ability.name}」${clipUntil(ability) < ability.length ? `播自己的动作要播到第 ${num(clipUntil(ability))} 秒（下一段换动作的时候）` : `全程 ${num(ability.length)} 秒`}，可是它播的动作只有 ${num(clip.length)} 秒：后面一段它会僵着不动。`, fix: `把招式的全长（length）改到 ${num(clip.length)} 秒以内，或者把动作做长。`, detail: `ability ${ability.id}: length ${ability.length}; clip ${clip.name}: length ${clip.length}` }]
          : []),
        // 第 3 步: every motion a stage switches to is one the model has.
        ...(clips
          ? (ability.stages ?? []).flatMap((stage, index) =>
              stage.clip && !clips.some((value) => value.name === stage.clip)
                ? [{ ability: ability.id, refs: [abilityRef(ability), clipRef(stage.clip)], rule: "ability_clip" as const, stops: true, text: `「${creature.name}」的招式「${ability.name}」第 ${index + 1} 段要播「${clipRef(stage.clip).title}」这个动作，可是它的模型里没有这个动作。`, fix: `给模型加上名叫 ${stage.clip} 的动作，或者把这一段换成模型里有的动作（${clips.filter((value) => !(RESERVED_CLIPS as readonly string[]).includes(value.name)).map((value) => value.name).join("、") || "现在一个可用的都没有"}）。`, detail: `stage ${index} clip: ${stage.clip}; model has: ${clips.map((value) => value.name).join(", ")}` }]
                : [],
            )
          : []),
        // epic game1: a breath that hit at 1.4, 1.8 and 2.2 seconds took 4 blood at the first and the last and nothing at the middle one. The game keeps a creature that was just hurt
        // from being hurt again for 10 ticks (half a second) unless the new blow is heavier, and then only by the difference: a hit that follows another of the same ability sooner than that does nothing.
        ...((() => {
          const plan = abilityPlan(ability).hits
          const timed = ability.hits.flatMap((hit, index) => (hit.type === "area" && (hit.damage ?? 0) > 0 ? [{ index, tick: plan[index]!.tick, damage: hit.damage ?? 0 }] : [])).sort((a, b) => a.tick - b.tick)
          // Counted from the last hit that did land: one that is turned away does not start the wait again.
          const lost: { hit: (typeof timed)[number] }[] = []
          timed.reduce<(typeof timed)[number] | null>((landed, hit) => {
            if (landed && hit.tick - landed.tick < HURT_COOLDOWN && hit.damage <= landed.damage) {
              lost.push({ hit })
              return landed
            }
            return hit
          }, null)
          return lost.length
            ? [{ ability: ability.id, refs: [abilityRef(ability)], rule: "ability_rehit" as const, stops: false, text: `「${creature.name}」的招式「${ability.name}」有 ${lost.length} 下离上一下不到 ${HURT_COOLDOWN / TICKS} 秒（第 ${lost.map((value) => num(value.hit.tick / TICKS)).join("、")} 秒）：游戏里刚受伤的生物 ${HURT_COOLDOWN} 刻（${HURT_COOLDOWN / TICKS} 秒）内不会再受同样重或更轻的伤，这几下打中了也不掉血，带的减速、虚弱之类也不会上身。`, fix: `把这几下和前一下拉开到至少 ${HURT_COOLDOWN / TICKS} 秒，或者合成一下。`, detail: `ability ${ability.id}: hits at ticks ${timed.map((value) => value.tick).join(", ")}; hurt cooldown ${HURT_COOLDOWN} ticks` }]
            : []
        })()),
        // broad9 w1: a dive flies to the locked point by its first hit, so the start distance is closed by the flight, as by a forward move;
        // whether it can be covered in time is diveIssues' (creature-flight.ts), which says so with the numbers.
        ...(measured(ability) && !movesForward(ability) && !ability.dive && !comboOnly(ability) && reach + 0.3 < left(ability, ability.start.min_distance)
          ? [{ ability: ability.id, refs: [abilityRef(ability)], rule: "ability_reach" as const, stops: false, text: `「${creature.name}」的招式「${ability.name}」要目标在 ${num(ability.start.min_distance)} 格以外才用，可是它最远只打得到 ${num(reach)} 格${left(ability, ability.start.min_distance) < ability.start.min_distance ? `（算上跳扑，落地时离目标还有 ${num(left(ability, ability.start.min_distance))} 格）` : ""}：用出来也打不中。`, fix: "把打得到的范围加大、给它加一段往前冲的位移（moves），或者把出招的距离改近。", detail: `ability ${ability.id}: start.min_distance ${ability.start.min_distance}; furthest reach ${reach}` }]
          : []),
        // The far end of the window: someone a dive or a forward move does not bring it to, standing beyond what the hit reaches, is missed. Said only past a block of slack: a player half a
        // block wide still counts when the edge touches them, and one step either way during the wind-up is the player's doing, not the ability's.
        ...(measured(ability) && !movesForward(ability) && !ability.dive && !comboOnly(ability) && Number.isFinite(ahead) && !(reach + 0.3 < left(ability, ability.start.min_distance)) && ahead + 1 < left(ability, ability.start.max_distance)
          ? [{ ability: ability.id, refs: [abilityRef(ability)], rule: "ability_reach" as const, stops: false, text: `「${creature.name}」的招式「${ability.name}」在目标离它最远 ${num(ability.start.max_distance)} 格时也会用，可是它${startBearings(ability) ? "朝目标能站的那几个方向（start.when 的 target_bearing）" : "正前方"}最远只打得到 ${num(ahead)} 格${left(ability, ability.start.max_distance) < ability.start.max_distance ? `（算上跳扑，落地时离目标还有 ${num(left(ability, ability.start.max_distance))} 格）` : ""}：目标站在 ${num(ahead)}–${num(ability.start.max_distance)} 格之间时用出来也打不中。`, fix: `把出招的最远距离（start.max_distance）改到 ${num(Math.max(ability.start.min_distance, Math.floor(ahead * 10) / 10))} 以内，或者把打得到的范围加大${ability.hits.some((hit) => hitBone(hit) !== undefined) ? "，或者换一个离身体中线近一点的出手部位" : ""}。`, detail: `ability ${ability.id}: start.max_distance ${ability.start.max_distance}; furthest reach straight ahead ${num(ahead)}` }]
          : []),
        // epic game5: a frost dragon started its tail sweep (window 6 to 11.5 blocks, a sphere of 3 at the tail) at 11.2 blocks in 16 of 17 tries and the sphere, 8.5 ahead, met the player twice: a creature that
        // stands still while an ability runs (`tickAbility` stops its walk) has its target where it started them, so a window that reaches outside the stretch straight ahead that the hit meets starts it where it
        // cannot connect. Counted for area hits that name a bone and have a fixed centre (a sphere or a box, from the bone), and only when every hit of the ability is of that kind, as the others
        // would cover other distances; the creature faces its target at the start (`track` and `lock` both). Same slack as the far-end finding. Height is ignored.
        ...((): AbilityIssue[] => {
          if (!measured(ability) || movesForward(ability) || ability.dive || ability.moves.some(isLeap) || comboOnly(ability) || (creature.flight && ability.where !== "ground") || !design) return []
          const angles = startBearings(ability)
          const spans = ability.hits.flatMap((hit, index) => {
            if (!counted(ability, hit)) return []
            if (hit.type !== "area" || hit.bone === undefined || (hit.shape.type !== "sphere" && hit.shape.type !== "box")) return [null]
            const anchor = hitAnchor(ability, index, design)
            if (!anchor) return [null]
            // r29c (狍鸮): started only with the one it fights at its side or behind it, what it meets the ways they may stand then (`startBearings`).
            if (angles) {
              const met = angles.flatMap((angle) => ((span) => (span ? [span] : []))(shapeToward(hit.shape, anchor, angle)))
              return [{ index, bone: hit.bone, shape: hit.shape, along: met.length ? 0 : null, near: met.length ? Math.min(...met.map((span) => span[0])) : 0, far: met.length ? Math.max(...met.map((span) => span[1])) : 0 }]
            }
            const forward = anchor.forward + hit.shape.forward
            const side = Math.abs(anchor.left + hit.shape.left)
            const half = hit.shape.type === "sphere" ? hit.shape.radius : hit.shape.depth / 2
            const wide = hit.shape.type === "sphere" ? hit.shape.radius : hit.shape.width / 2
            const along = side > wide ? null : hit.shape.type === "sphere" ? Math.sqrt(Math.max(0, half * half - side * side)) : half
            return [{ index, bone: hit.bone, shape: hit.shape, along, near: along === null ? 0 : forward - along, far: along === null ? 0 : forward + along }]
          })
          if (!spans.length || spans.some((span) => span === null)) return []
          const met = spans.filter((span) => span!.along !== null) as NonNullable<(typeof spans)[number]>[]
          const near = met.length ? Math.min(...met.map((span) => span.near)) : 0
          const far = met.length ? Math.max(...met.map((span) => span.far)) : 0
          if (met.length && ability.start.min_distance >= near - 1 && ability.start.max_distance <= far + 1) return []
          // Only the far end is out, and the finding above already says so: not said twice.
          if (met.length && ability.start.min_distance >= near - 1 && Number.isFinite(ahead) && ahead + 1 < ability.start.max_distance) return []
          const first = spans[0]!
          const what = spans.length === 1
            ? `第 ${first.index + 1} 次出手打的是以「${first.bone}」为中心${first.shape.type === "sphere" ? `半径 ${num(first.shape.radius)} 格的球` : `${num(first.shape.width)}×${num(first.shape.depth)} 格的方块`}`
            : `${spans.length} 次出手都是从部位里打出的球或方块`
          const window = `${num(ability.start.min_distance)}–${num(ability.start.max_distance)}`
          return [{
            ability: ability.id, refs: [abilityRef(ability)],
            rule: "ability_reach",
            stops: false,
            text: met.length
              ? `「${creature.name}」的招式「${ability.name}」写的是目标在 ${window} 格时开始，可是${what}，正前方只够得到 ${num(near)}–${num(far)} 格：目标站在这之外开招就会打空。它出招时是站着不动的，开招时离目标多远，出手时就多远；最远一端（${num(ability.start.max_distance)} 格）尤其要紧，走近的生物会在它允许的第一个距离就开招。`
              : `「${creature.name}」的招式「${ability.name}」${what}，它离身体中线太远，正前方根本打不到站在中线上的目标：用出来必定打空。`,
            fix: met.length ? `把起手距离（start.min_distance、start.max_distance）改到 ${num(Math.max(near, 0))}–${num(far)} 格这个范围里，或者改判定（形状、位置、部位）。` : "把判定的范围加大、换一个离身体中线近一点的出手部位，或者改判定的位置。",
            detail: `ability ${ability.id}: start ${ability.start.min_distance}–${ability.start.max_distance}; hits meet straight ahead ${met.length ? `${num(near)}–${num(far)}` : "nowhere"}`,
          }]
        })(),
        // epic game1: an ability in the air aimed at the one it fights starts only when its hits can reach them by the first hit, and the flier holds station where they reach while it runs
        // (`flightReaches`, `flightReachStation`). Two cases that holding cannot mend are said, never a stop: the place the hits start at is so high above the feet that the floor rule (feet a block over the
        // ground) keeps it out of reach of someone standing on the ground, and a soaring flier, which cannot stop in the air, flies on from the first of its aimed hits to the last.
        ...((): AbilityIssue[] => {
          if (!creature.flight) return []
          const row = airHitReach(ability, ability.hits.map((_, index) => (design ? hitAnchor(ability, index, design) : null)))
          if (!row) return []
          const [reach, up] = row as [number, number]
          const said = (text: string, fix: string, detail: string): AbilityIssue[] => [{ ability: ability.id, refs: [abilityRef(ability)], rule: "ability_reach", stops: false, text, fix, detail: `ability ${ability.id}: ${detail}` }]
          // Someone on the ground has the middle of their body 0.9 above the ground, and the flier's feet are never under a block above it.
          const lowest = 1 + up - AIM_TARGET.middle
          const nearest = airReachNearest(reach, lowest)
          if (nearest > reach + AIR_REACH.slack)
            return said(
              `「${creature.name}」的招式「${ability.name}」在天上从离脚 ${num(up)} 格高的地方出手，可是它飞得再低也要离地 1 格：站在地上的人，身体中间离出手点至少 ${num(nearest)} 格，而招式只打得到 ${num(reach)} 格，所以它在天上只有目标也在高处时才放得出来。`,
              `把出手的部位（bone）换成离脚近一点的，或者把打得到的范围加大。`,
              `reach ${num(reach)}; hits start ${num(up)} above the feet; nearest to a player on the ground ${num(nearest)}`,
            )
          if (creature.flight.style !== "soar") return []
          // A soaring flier cannot stop: from the first aimed hit to the last it flies on at least at its stall speed (blocks a second), through the station if it is lucky. Said when no start the hold
          // can be given passes the gate (`airReachHolds`): every one of them takes the place its hits start at out of the reach, or past a third of it, at some hit.
          const ticks = abilityPlan(ability).hits.flatMap((plan, at) => ((hit) => (hit?.type === "area" && shapeAims(hit.shape) ? [plan.tick] : []))(ability.hits[at]))
          const stall = creature.flight.speed * FLIGHT_LIMITS.stall
          const span = (stall * (Math.max(...ticks) - Math.min(...ticks))) / TICKS
          const held = airReachHolds(row, airReachFlier(creature.flight), { windup: abilityPlan(ability).windup, tracks: ability.facing === "track" }, 1 - AIM_TARGET.middle)
          return !held.holds
            ? said(
                `「${creature.name}」的招式「${ability.name}」是在天上朝目标放的，可是它是滑翔型，在天上停不下来：第一下到最后一下隔 ${num((Math.max(...ticks) - Math.min(...ticks)) / TICKS)} 秒，它最慢也以每秒 ${num(stall)} 格的速度飞出 ${num(span)} 格，目标会落在 ${num(reach)} 格的范围之外，有几下会打空。`,
                `把这几下挨得近一点（at），或者把 flight 里的速度（speed）调小，或者把招式打得到的范围加大，或者让它改成能悬停的（hover）。`,
                `reach ${num(reach)}; aimed hits at ticks ${Math.min(...ticks)}–${Math.max(...ticks)}; stall speed ${num(stall)} blocks/s; flies on ${num(span)}; best hold keeps the hits ${num(held.near)}–${num(held.far)} from the target, the limit ${num(held.limit)}`,
              )
            : []
        })(),
        ...warnIssues(creature, ability),
        ...lightningIssues(creature, ability),
        // Boss 能力 2: a thrown thing that cannot reach, comes back late, is still away when it may throw again, or a cast that throws a great many (ability-projectile.ts).
        ...projectileIssues(creature, ability, design),
      ]
    }),
    // Boss 能力 11: a trail too short to see, or behind a part that does not move while it is drawn.
    ...trailIssues(creature, design),
    // Its combos: where they start against their first step, and a hit that falls in the game's half second after the step before (`comboIssues`).
    ...comboIssues(creature),
    // Boss 能力 4: a dash that leaves where it is kept or meets the ground, a push that carries a player out of the fight (`dashForceReview`).
    ...dashForceReview(creature),
    // Boss 能力 14: an ability started by a blow that answers too many blows, at once again, or never (`parryReview`).
    ...parryReview(creature),
  ]
}

/**
 * Where an ability's motion and its timing disagree, measured on the model (`abilityHitShapes`): a stroke
 * that lands more than `STRIKE_TOLERANCE` from the moment the hit is counted, and a wind-up nobody can see.
 * Never stops a build: the ability works, it only looks wrong.
 */
export function abilityTimingIssues(creature: { name: string; behavior: string; abilities?: readonly Ability[] | null; justified?: readonly { what: string; reason: string }[] | null }, design: Pick<ModelDesign, "bones" | "animations">): AbilityIssue[] {
  if (creature.behavior !== "hostile") return []
  // What the creature's own `justified` answers (`abilityFaultName`) is not listed as wrong: it is meant, with a reason the reviewer and the person read where it is measured (`hitLines`).
  const answered = (ability: Ability, kind: "windup" | "timing") => justifiedReason(creature.justified, abilityFaultName(ability, kind)) !== null
  return (creature.abilities ?? []).flatMap((ability) =>
    (abilityHitShapes(ability, design) ?? []).flatMap((found): AbilityIssue[] => [
      ...(found.arrives !== null && Math.abs(found.arrives - found.at) > STRIKE_TOLERANCE + 1e-9 && !answered(ability, "timing")
        ? [
            {
              ability: ability.id, refs: [abilityRef(ability)],
              rule: "ability_timing" as const,
              stops: false,
              text: `「${creature.name}」的招式「${ability.name}」对不上：动作挥过去的那一下在第 ${num(found.arrives)} 秒才到位，${found.shot ? "东西" : "伤害"}却在第 ${num(found.at)} 秒就${found.shot ? "射出去了" : "算了"}（差 ${num(Math.abs(found.arrives - found.at))} 秒，超过 ${STRIKE_TOLERANCE} 秒玩家就看得出不同步）。`,
              fix: `把这一下的时刻（at）改成 ${num(found.arrives)}，或者改动作让它在第 ${num(found.at)} 秒打到。`,
              detail: `ability ${ability.id} hit ${found.index}: at ${found.at} (tick ${found.tick}); stroke of clip ${ability.clip} lands at ${found.arrives}; tolerance ${STRIKE_TOLERANCE}`,
            },
          ]
        : []),
      ...(found.index === 0 && !found.windup.seen && !answered(ability, "windup")
        ? [
            {
              ability: ability.id, refs: [abilityRef(ability)],
              rule: "ability_windup" as const,
              stops: false,
              text: found.windup.seconds === 0 ? `「${creature.name}」的招式「${ability.name}」一开始就判定，没有蓄力：玩家来不及躲。` : `「${creature.name}」的招式「${ability.name}」出手前的 ${num(found.windup.seconds)} 秒里，动作在游戏里只走了约 ${found.windup.game} 个屏幕像素，看不出它要出手：伤害像是凭空来的。`,
              fix: "给动作加一段看得出来的蓄力（往出手的反方向收，幅度要大），并把蓄力时间（windup）留够。",
              detail: `ability ${ability.id}: wind-up ${found.windup.seconds} s travels ${found.windup.game} screen px (visible from ${MOTION_VISIBLE.pixels})`,
            },
          ]
        : []),
    ]),
  )
}

// ---- which motion is started by what ----

/** What starts one motion of a creature's model in the game: `by` for 高级, `words` for the person. */
export type ClipSource = { by: "idle" | "walk" | "hurt" | "death" | "attack" | "ability" | "rule" | "boss" | "flight" | "habit"; words: string; detail: string }
export type CreatureBindings = {
  /** Every motion of the model, in the model's order, with everything that starts it; none: nothing ever plays it. */
  clips: { clip: string; sources: ClipSource[] }[]
  /** Every ability with what it needs resolved against the model and the word lists; `missing` is empty when all of it is there. */
  abilities: { id: string; name: string; clip: string; resolved: string[]; missing: string[] }[]
}

const RULE_WORDS: Record<string, string> = { player_near: "玩家靠近", holding_item: "玩家拿着指定物品", hurt: "被打" }

/**
 * The binding list of one creature: every motion its model has → what starts it at runtime, and every
 * ability → the motion, effects, sounds and particles it names, found or missing. The same rules the
 * generator follows (`fabric/entity.ts`): idle and walk on the movement controller, hurt when hit, death
 * and attack when the model has them, an ability's motion when the ability starts, a rule's motion when the
 * rule fires. `creature-contract.ts` reads the same list back out of the generated Java, and a test holds the two equal.
 */
export function creatureBindings(creature: { abilities?: readonly Ability[] | null; boss?: Boss | null; flight?: Flight | null; habits?: Habits | null }, clips: readonly Clip[], rules: readonly { trigger: string; animation?: string | null; enabled: boolean; action: string }[] = [], effectTitle: ((id: string) => string | null) | null = null, /** 任务二 §9: the title of a sound asset by id, as `effectTitle`. */ soundTitle: ((id: string) => string | null) | null = null): CreatureBindings {
  const abilities = creature.abilities ?? []
  const fixed: Record<string, ClipSource> = {
    idle: { by: "idle", words: "闲着站着的时候一直播", detail: 'controller "movement"' },
    walk: { by: "walk", words: "走动的时候一直播", detail: 'controller "movement"' },
    hurt: { by: "hurt", words: "每次挨打立刻播", detail: 'controller "hurt"' },
    death: { by: "death", words: "死的时候播，播完才消失", detail: 'controller "death"' },
    attack: { by: "attack", words: abilities.length ? "只有玩法代码调用它的 doHurtTarget 时才播（它自己出手用的是招式）" : "每次出手（doHurtTarget）时播", detail: 'doHurtTarget → triggerAnim("attack", "attack")' },
  }
  return {
    clips: clips.map((clip) => ({
      clip: clip.name,
      sources: [
        ...(fixed[clip.name] ? [fixed[clip.name]!] : []),
        ...abilities.flatMap((ability): ClipSource[] => {
          if (ability.clip !== clip.name) return []
          const plan = abilityPlan(ability)
          return [{ by: "ability", words: `招式「${ability.name}」开始时从头播（蓄力到第 ${num(plan.windup / TICKS)} 秒，第 ${plan.hits.map((hit) => num(hit.tick / TICKS)).join("、")} 秒出手，第 ${num(plan.length / TICKS)} 秒结束）`, detail: `ability ${ability.id}: wind-up to tick ${plan.windup}, hits at tick ${plan.hits.map((hit) => hit.tick).join(", ")}, ends at tick ${plan.length}` }]
        }),
        // boss runtime (10-12): the motion of its wake-up and of each change of phase.
        ...(creature.boss?.intro?.clip === clip.name ? [{ by: "boss" as const, words: "Boss 醒来（登场）时播", detail: 'controller "boss": intro' }] : []),
        ...(creature.boss?.phases ?? []).flatMap((phase, index): ClipSource[] => (phase.clip === clip.name ? [{ by: "boss", words: `Boss 第 ${index + 1} 次变身时播`, detail: `controller "boss": phase ${index + 1}` }] : [])),
        // Flight and habits (10-12): the motions of the air and of the way it lives, played by the movement controller and the "habit" controller.
        ...(creature.flight
          ? Object.entries(flightMotions(creature.flight)).flatMap(([key, name]): ClipSource[] =>
              name === clip.name ? [{ by: "flight", words: { takeoff: "起飞时播", land: "落地时播", fly: "在天上飞的时候播（滑翔型：爬升或慢飞时；悬停型：飞动起来时）", glide: "在天上平飞或下降、速度够快时播（滑翔型）", hover: "在天上几乎停着时播（悬停型）" }[key]!, detail: `movement controller: flight ${key}` }] : [],
            )
          : []),
        ...(creature.habits
          ? ([[creature.habits.rest?.clip, "rest", "休息时播（回到窝、停下来以后一直播）"], [creature.habits.eat?.clip, "eat", "捕到猎物吃的时候播"], [creature.habits.alert?.clip, "alert", "玩家第一次走近时的警觉播一次"]] as const).flatMap(([name, key, words]): ClipSource[] => (name === clip.name ? [{ by: "habit", words, detail: `controller "habit": ${key}` }] : []))
          : []),
        ...rules.flatMap((rule): ClipSource[] => (rule.enabled && rule.action === "play_animation" && rule.animation === clip.name ? [{ by: "rule", words: `规则：${RULE_WORDS[rule.trigger] ?? rule.trigger}时播`, detail: `logic rule: ${rule.trigger} → play_animation ${clip.name}` }] : [])),
      ],
    })),
    abilities: abilities.map((ability) => {
      const clip = clips.find((value) => value.name === ability.clip)
      const effects = [...new Set(ability.hits.flatMap((hit) => (hit.type === "area" ? hit.effects.map((effect) => effect.effect) : [])))]
      const shots = [...new Set(ability.hits.flatMap((hit) => (hit.type === "shot" ? [hit.projectile] : [])))]
      const sounds = [...new Set(ability.events.flatMap((event) => (event.type === "sound" && !isSoundAsset(event.sound) ? [event.sound] : [])))]
      // 任务二 §9: the sound assets it plays, by asset id; named and checked only where the project is known (`soundTitle` given).
      const own = soundTitle ? [...new Set(ability.events.flatMap((event) => (event.type === "sound" && isSoundAsset(event.sound) ? [event.sound.asset] : [])))] : []
      // Boss 能力 11: a particle of the project's own is named where the project is known, as an effect is.
      const particles = [...new Set(ability.events.flatMap((event) => (event.type === "particle" && typeof event.particle === "string" ? [event.particle] : [])))]
      // H3: the effect assets it shows, by asset id; named and checked only where the project is known (`effectTitle` given).
      const shown = effectTitle ? [...new Set(ability.events.flatMap((event) => (event.type === "effect" ? [event.effect] : [])))] : []
      return {
        id: ability.id,
        name: ability.name,
        clip: ability.clip,
        resolved: [
          ...(clip ? [`动作 ${ability.clip}（${num(clip.length)} 秒）`] : []),
          ...effects.filter((effect) => effect in ABILITY_EFFECTS).map((effect) => `效果 ${ABILITY_EFFECTS[effect]}`),
          ...shots.filter((shot) => shot in ABILITY_PROJECTILES).map((shot) => `射出 ${ABILITY_PROJECTILES[shot].name}`),
          ...sounds.filter((sound) => sound in ABILITY_SOUNDS).map((sound) => `声音「${ABILITY_SOUNDS[sound]}」`),
          ...particles.filter((particle) => particle in ABILITY_PARTICLES).map((particle) => `粒子 ${ABILITY_PARTICLES[particle]}`),
          ...shown.flatMap((id) => ((title) => (title === null ? [] : [`出现的效果「${title}」`]))(effectTitle!(id))),
          ...own.flatMap((id) => ((title) => (title === null ? [] : [`自己的声音「${title}」`]))(soundTitle!(id))),
        ],
        missing: [
          ...(clip ? [] : [`动作 ${ability.clip}（模型里没有）`]),
          ...effects.filter((effect) => !(effect in ABILITY_EFFECTS)).map((effect) => `效果 ${effect}`),
          ...shots.filter((shot) => !(shot in ABILITY_PROJECTILES)).map((shot) => `射出 ${shot}`),
          ...sounds.filter((sound) => !(sound in ABILITY_SOUNDS)).map((sound) => `声音 ${sound}`),
          ...particles.filter((particle) => !(particle in ABILITY_PARTICLES)).map((particle) => `粒子 ${particle}`),
          ...shown.filter((id) => effectTitle!(id) === null).map((id) => `出现的效果 ${id}（工程里没有）`),
          ...own.filter((id) => soundTitle!(id) === null).map((id) => `自己的声音 ${id}（工程里没有）`),
        ],
      }
    }),
  }
}

/** Written for a motion nothing starts. */
export const NEVER_PLAYED = "没有任何地方会播放它"

/** The binding list in sentences, one per motion and one per ability: for the card and for whoever reviews gameplay. */
export function bindingLines(bindings: CreatureBindings, advanced = false, clipName: (id: string) => string = id => id) {
  return [
    ...bindings.clips.map((bound) => `动作 ${advanced ? bound.clip : clipName(bound.clip)}：${bound.sources.length ? bound.sources.map((source) => (advanced ? `${source.words}［${source.detail}］` : source.words)).join("；") : NEVER_PLAYED}`),
    ...bindings.abilities.map((ability) => `招式「${ability.name}」${advanced ? `（${ability.id}）` : ""}：${ability.missing.length ? `缺 ${ability.missing.join("、")}` : "用到的都在"}${ability.resolved.length ? `——${ability.resolved.join("、")}` : ""}`),
  ]
}

/** The same list as only the names the document and the generated code use, a line a motion: what 高级 adds beside the sentences. */
export const bindingDetails = (bindings: CreatureBindings) => bindings.clips.map((bound) => `${bound.clip} ← ${bound.sources.map((source) => source.detail).join("; ") || "nothing"}`)

// ---- which ability plays which motion, for the person ----

/**
 * What plays a motion, for the person: an ability (its plain name and the motion's id), or, with `by: "gameplay"`, a gameplay whose code starts the motion (its title and the motion's id).
 */
export type PlaysClip = Pick<Ability, "name" | "clip"> & { by?: "gameplay" }

/**
 * The abilities (by the name the person reads) that play one motion of a creature's model, in the creature's order. A motion nothing plays gives none.
 * Broad19: a veteran saw a motion called "slam" and an ability called 冲锋 and could not tell which motion the ability used, because the two lists never met.
 */
export const abilitiesPlaying = (abilities: readonly PlaysClip[] | null | undefined, clip: string) => [...new Set((abilities ?? []).filter((ability) => ability.by !== "gameplay" && ability.clip === clip).map((ability) => ability.name))]
/** The same for the gameplays whose code plays the motion. */
export const gameplaysPlaying = (plays: readonly PlaysClip[] | null | undefined, clip: string) => [...new Set((plays ?? []).filter((play) => play.by === "gameplay" && play.clip === clip).map((play) => play.name))]

/**
 * A motion as a button, a list or a heading names it. One rule for every page, in this order:
 * 1. the name the motion's own saved record gives it, when that is in the person's language (`title`: an animation saved on its own has a title);
 * 2. the player's word for the common motions (`motionKnown`: 待机, 走路, 受伤…);
 * 3. the name of what plays it: 「招式：重击」 for an ability, 「玩法：母鸡下蛋」 for a gameplay (the person named those in their own words);
 * 4. only when none of them says anything, the name the document gives it.
 * When something plays a motion that already has a word, that is added beside it: 「蓄力（招式：冲锋）」. With `advanced` the document's name is kept beside the result: 「走路（walk）」.
 */
export function motionWords(clip: string, plays: readonly PlaysClip[] | null | undefined, options: { title?: string | null; advanced?: boolean } = {}) {
  const word = options.title || motionKnown(clip)
  const by = [abilitiesPlaying(plays, clip), gameplaysPlaying(plays, clip)].flatMap((names, index) => (names.length ? [`${index === 0 ? "招式" : "玩法"}：${names.join("、")}`] : [])).join("；")
  const said = word ? (by ? `${word}（${by}）` : word) : by || "未命名动作"
  return options.advanced && said !== clip ? `${said}（${clip}）` : said
}

/** `motionWords` for the pages that have no saved title to offer and show no names the document uses. */
export const motionWithAbilities = (clip: string, plays: readonly PlaysClip[] | null | undefined) => motionWords(clip, plays)

/** The other direction, for an ability's card: which motion of the model it plays, in the same words the motion buttons use. */
export const abilityPlays = (ability: PlaysClip, clips?: readonly Clip[] | null, name = motionName) =>
  `播的动作：${name(ability.clip)}${clips && !clips.some((clip) => clip.name === ability.clip) ? "（模型里还没有这个动作）" : ""}`

// ---- for whoever writes a creature document ----

const listed = (record: Readonly<Record<string, unknown>>) => Object.keys(record).join("|")

/** What an AI is told about abilities. One text: the registry, the hand-off and the capability list read it. */
export const ABILITY_INSTRUCTIONS = SOUND_RANGE_WORDS + " " +
  ` abilities 是它对付目标的招式，最多 ${ABILITY_LIMITS.abilities} 个，每个都有真实的时间：先蓄力，到某一刻才判定，之后收招、歇一会儿。省略、null 或空数组时它照旧“够得着就立刻掉血”。只有会主动攻击（hostile）的生物用得上。写了招式以后它自己出手只用招式（按 weight 在当下能用的里面挑），不再瞬间近战；玩法代码调用 doHurtTarget 照旧有效。` +
  ` 每个招式：{id, name, clip, windup, length, facing, hits, moves, start, stopped_by_hurt, events}。id 是代码里的名字（小写字母、数字、下划线），name 是给人看的名字。clip 是模型里专门为这个招式做的动作名（不能是 ${RESERVED_CLIPS.join("、")}），招式开始时从头播。所有时刻都是从招式开始算的秒，游戏按 0.05 秒一刻取整。windup 是蓄力结束的时刻；length 是招式全长，不能比动作长。facing：track 表示蓄力时一直转向目标（每刻最多转 30°），lock 表示朝向从开始就不变；蓄力一结束朝向就定住，所以玩家看准了能躲开（会飞的生物在天上朝目标打的光束和锥形是例外的一小段：出手时瞄准点还会跟着目标，每刻最多转它的转弯速度，也不会离蓄力结束时瞄的地方超过前几下击退的距离再加一步，所以被推开的目标还在瞄准里，自己走开的仍然躲得开；lock 的不跟）。` +
  CREATURE_COMBAT_GUIDE +
  " 跳扑在写的落地刻处理出手和声光之前已走完落地动作；撞到方块仍按实际碰撞位置停。时间四舍五入到一刻。同一刻先处理范围出手的预警和位移，再处理出手与随后的声光；同类同时发生的项目照列表次序。阵地中心提前锁定时，落点可以和身体停下的位置不同。" +
  " 范围出手写 0 伤害也能打中，照样能推、加状态、计入出手方的命中分支和每人一次的命中组。它不会触发挨打方受到伤害才发生的打断或破绽。where:\"hit\" 用的是出手的位置，即使 0 伤害或没有打到人也会在那个位置发生。" +
  ` hits 是出手的时刻（至少一个，按先后写，不能早于 windup），有四种（第四种是扔出自己的投射物，type:"projectile"，写法在后面）。范围：{type:"area", at, shape, hits: target|everyone, damage, knockback, effects:[{effect: ${listed(ABILITY_EFFECTS)}, duration_ticks, amplifier}]}——到 at 那一刻，服务端按大家当时站的位置判定，不在 shape 里就打不中；hits=everyone 打范围里除了同类以外的所有生物，target 只打它的目标；damage 是掉血点数（一颗心 2 点），knockback 是击退力度（0 不击退，0.4 是普通一击，最大 ${ABILITY_LIMITS.knockback}）；写负数就反过来，是把人朝它拉过来（舌头卷人、吸力、钩爪），力度同样按绝对值算（-0.8 是用力一拉，最小 -${ABILITY_LIMITS.knockback}），被拉的人最多停在碰到它身体的地方，不会被拉穿过去，也同样受击退抗性影响。投射物：{type:"shot", at, projectile: ${listed(ABILITY_PROJECTILES)}, speed, forward, up, damage}——从它脚下往前 forward 格、往上 up 格的位置朝目标射出（箭和雪球会往下掉，射出去时会自己抬高瞄准补上下坠，不用自己算），speed 是每刻几格（箭 1.6 左右；火球自己会加速，speed 只是出手速度）；damage 只有 arrow 写数字，其余写 null（${Object.values(ABILITY_PROJECTILES).filter((value) => !value.damage).map((value) => `${value.name}：${value.does}`).join("；")}）。` +
  ` 玩法：{type:"gameplay", at, gameplay:"玩法的 slug", action:"入口名"}——到 at 那一刻，由这个工程里那个玩法的代码去做招式自己写不出的事（召唤别的生物、放方块、连续的动作……）。这仍然是这里的招式：名字、动作、蓄力、冷却、什么时候能用、Boss 的阶段、晃屏和碎块都照常写在这里，和别的招式轮着放、不会同时放；玩法只管这一刻做什么，不要在玩法里另外数时间去放。玩法的代码要在 onInitialize 里用 ProjectContent.abilityAction("入口名", (生物, 目标) -> …) 登记同名的入口（生物是 Mob，目标是它正在打的 LivingEntity，只在服务端、只在这一刻跑一次）；找不到那个 slug 的玩法、或者那个玩法没登记这个入口，检查和打包都会退回。这一次出手没有判定范围，也不能写 bone，events 里的 effect 和 debris 不能用 where:"hit" 指向它。` +
  ` 每一次出手（范围和投射物都行）还可以写 bone（模型里某个部件的名字，可以不写）：写了以后，这一次出手的位置——shape 里的 forward、up、left，arc 的 low 和 high，line 和 cone 起点的 up，投射物的 forward 和 up——都从那个部件的中心算起，不再从脚下算（下面说的“原点是脚下”只对没写 bone 的出手成立）。那个部件在哪，是出手那一刻（出手时刻落在哪一刻，就看这个招式自己的动作在那一刻把它摆在哪）量出来的，按这只生物放大缩小的比例放大，会飞的还跟着机身的俯仰和侧倾一起转。头抬得高、伸得远的生物，咬和喷吐要从头那里打出来，就写 bone:"head"，范围的 reach、length 从头算起，不用再把头离身体的距离加进去（所以 reach 这些数的上限 ${ABILITY_LIMITS.reach} 格是从那个部件算起的，离脚下可以远得多）。bone 必须是模型里有的部件，没有的不给打包；部件的中心是它自己所有方块的中心（没有方块的部件是它的转轴点），要从嘴的最前面打出来就把 forward 往前写几格。写了 bone 的出手，用 look 画出来的范围也在那个部件上。` +
  ` shape 的长度单位都是格，原点是它的脚下，forward 是它面朝的方向，left 是它自己的左边，up 是往上：{type:"arc", reach, angle, low, high, inner}（身前 angle 度以内、reach 格以内、离脚 low 到 high 高的扇形，360 是一圈；inner 可以不写，写了就是中间空心：整个碰撞箱都在离中心 inner 格以内就打不到；angle 写 360 就是一圈空心环。高度用目标的整个碰撞箱和原点加 low 至原点加 high 的带相交来判断，碰到边界也算。跳起来时，要等脚底高于这次出手的原点加 high 才能跳过；目标头顶低于原点加 low 也会躲过。inner 要比 reach 小，预警也会画出内圈）；{type:"box", forward, up, left, width, height, depth}（中心在那里的一个盒子，width 是左右、depth 是前后）；{type:"sphere", forward, up, left, radius}；{type:"line", up, length, radius}（从离脚 up 高的地方朝目标的一条直线）；{type:"cone", up, length, angle}（同样起点、朝目标张开 angle 度）。line 和 cone 朝的是目标身体的中间，所以目标站得比它高或者低，这条线就往上或者往下斜（它自己的 up 比玩家高时，对着平地上的玩家也是往下斜的）；在 line 或 cone 里再写 aim:"level"，它就一直水平、只朝它面对的方向打，目标不在那个高度就打不中。范围要和动作挥到的地方一致：对生物任务调用 look（document 写这份生物文档）会把每个招式的范围画在出手那一帧的模型上，并量出动作挥过去的那一下什么时候到位、蓄力看不看得见；对不上会直接说出来。` +
  ` 范围出手还可以写 place 和 warn（都可以不写，不写就是上面说的在它自己身边打）。place 是落在哪里："self"（它自己脚下，同不写）；"target"（目标脚下）；{type:"around_target", count, spread}（目标脚下周围 spread 格以内随机的 count 个地方，count 1 到 ${HIT_PLACE_LIMITS.count}，spread ${HIT_PLACE_LIMITS.spread.min} 到 ${HIT_PLACE_LIMITS.spread.max}，每次出招由服务端重新随机）；{type:"pattern", points:[{forward, left}]}（按出招时它站的位置和朝向排好的最多 ${HIT_PLACE_LIMITS.points} 个地方，forward 是往前、left 是往它自己的左边，单位格）。落在别处时 shape 从每个落点算起（forward、up、left 照样按它的朝向从落点再挪，一般写 0），只能用 sphere、box 和 angle 写 360 的 arc，不能写 bone，knockback 不能是负数（正数是从落点往外推）；同一个人在几个落点重叠的地方也只挨这一下一次。` +
  ` warn 是出手前的预警：{seconds, look, color}——提前 seconds 秒（${WARN_LIMITS.seconds.min} 到 ${WARN_LIMITS.seconds.max}，而且 at 减 seconds 不能小于 0：预警最早在招式开始时出现，可以落在蓄力里）由服务端定下落点，告诉附近玩家的游戏在每个落点画出预警，look 是 ${Object.entries(WARN_LOOKS).map(([id, words]) => `${id}（${words}）`).join("或")}，color 只能是 ${Object.entries(WARN_COLORS).map(([id, value]) => `${id}（${value.name}）`).join("、")}；预警的形状和大小就是判定范围，到 at 那一刻就在这些落点上、用同样的形状判定，通常落点固定。范围预警可设 follow 为 caster 或 target，lock_before 指出手前几秒定住，fade_seconds 指结束或打断后的淡出秒数；effect 可填本工程铺地效果的资产编号。不写 place 只写 warn，落点就定在预警开始时它自己站的地方和朝向上。line 和 cone 不能写 warn（它们朝出手那一刻的目标打），写了 warn 的也不能写 bone。招式中途被打断（挨打打断、它死了、目标没了），预警当场消失，这一下也不会打。预警要留够时间躲：少于 ${WARN_LIMITS.readable} 秒玩家来不及反应；打在目标脚下的，预警要长到走得出范围（走路每秒约 ${WARN_LIMITS.walk} 格）；打在目标脚下却不写预警，玩家只能硬吃，检查会说出来。look 会把每个落点的范围都画出来，并在正前方放一个目标的小方框。` +
  ` moves 是它给自己的位移：[{at, forward, up}]，到 at 那一刻它的速度变成朝面前每刻 forward 格（负数往后）、up 大于 0 时再加上向上每刻 up 格（0.42 是普通一跳）。start 是什么时候能用：{min_distance, max_distance, line_of_sight, cooldown, weight}——目标离它的直线距离（高低差也算）在这两个数之间（格）、line_of_sight=true 时还要看得见、这个招式上次结束后过了 cooldown 秒；weight 是 1 到 ${ABILITY_LIMITS.weight} 的整数，几个招式都能用时按它的比例挑。stopped_by_hurt=true 表示中途挨打就中断（后面的判定都不会发生）；它自己死了、目标死了或者不见了，一定中断。` +
  ` 环、地裂、危险区、碎块、特效、粒子、声音和震屏可写 where:"hit",hit:0，沿用第 0 次范围出手的实际落点。多点出手在每个落点发生。固定预警从亮起时保存，跟随预警从停止跟随时保存，没有预警的远处出手在出手时保存。目标走开或跳扑撞墙以后，已经保存的伤害中心和事件仍在原地。` +
  ` events 按时间列出声光和地形事件：{type:"sound", at, sound, volume, pitch}（sound 写 {"asset":"<声音资产的 UUID>"} 就放这个工程自己的声音，保存生物任务时 Studio 会记录对已有声音的依赖；写原版声音的 id 只能从清单里选：${Object.entries(ABILITY_SOUNDS).filter((entry) => !entry[0].endsWith(".step") && !entry[0].endsWith(".ambient")).map(([id, name]) => `${id}（${name}）`).join("、")}，以及生物声音清单里的其他声音；声音事件建议默认再写 pitch_variation:0.1，每次播放音高上下浮动 10%，范围 0–0.5，省略时音高固定；起手升调写 pitch:0.8、pitch_to:1.4，从 at 到 windup 每四刻播放一次，起手结束时到达终点音高）或 {type:"particle", at, particle: ${listed(ABILITY_PARTICLES)}, count, forward, up, left, spread}，` +
  SCATTER_INSTRUCTIONS + EMITTER_INSTRUCTIONS + PARTICLE_DESIGN_GUIDE +
  ` 或者放出这个工程里做好的效果（一个出现一下就消失的小模型，是单独的一类资产）：{type:"effect", at, effect:"效果的资产 id", where, hit, along, forward, up, left, count, layout, spread}。where 是从哪里算位置：self（它自己脚下）、target（目标脚下）、hit（某一次出手打到的地方的中心，这时 hit 写第几次出手，从 0 数；其余时候 hit 写 null）；forward、up、left 是在那个位置上再按它自己的方向挪多少格。count 是一次放几个（最多 ${EFFECT_LIMITS.count} 个），多于一个时 layout 决定怎么摆：ring 是围成半径 spread 格的一圈、每个都朝外，line 是从那个位置往前排成 spread 格长的一排。along 是按谁的方向摆，可以不写：facing 是按它自己水平的方向（往前、正上方、它的左边），效果不倾斜；aim 是顺着第 hit 次出手瞄的方向（只有 line、cone 和投射物有瞄的方向，这时不管 where 写什么，hit 都要写是哪一次出手）——整个摆法，连同每个效果自己，跟着那一下绕它的起点一起倾斜，所以平地上看到什么样，目标站高站低时还是什么样。不写 along 的时候：where:"hit" 放在一次朝目标瞄的 line 或 cone 上就是 aim，其余都是 facing。从它自己身上放出来、要盖在一条朝目标的线上的效果（where:"self"），要写 along:"aim" 和 hit，否则目标一站高或者站低，看到的路线和打到的路线就分开了。贴地的效果和一直对着玩家的效果，位置照样这样算，本身不倾斜。size 可以不写，是把每个效果画成原来的几倍（${EFFECT_SIZE.min}–${EFFECT_SIZE.max}）。效果怎么动、留多久、跟不跟着它走，是那个效果自己的设定。它只给人看，不影响谁被打中；要它标出打到的地方，就用 where:"hit"，并让它的大小和判定范围一致——对生物任务调用 look 会把效果画在招式里它该在的位置（和效果一起、只看生物的动作各一张；只看一个招式时 animation 写那个招式的 id），并说出它比蓄力结束和出手早多少、中心在不在判定范围里，差得超过 ${EFFECT_ZONE_TOLERANCE} 格会直接说对不上。有朝目标瞄的出手时，其余的图都把它画成水平的，另有一格把目标放到别的高度（和它站在同一块地上、比它高出它自己的身高，取对不上最多的一种），判定和效果按那时候的样子画，并量出效果离判定范围最远多少：平地上重合、换了高度却差出 ${EFFECT_ZONE_TOLERANCE} 格以上，同样说对不上。生物任务要依赖用到的每一个效果。` +
  BOSS_EVENT_INSTRUCTIONS +
  LIGHTNING_INSTRUCTIONS +
  TRAIL_INSTRUCTIONS +
  DASH_INSTRUCTIONS +
  IMPACT_INSTRUCTIONS +
  PROJECTILE_INSTRUCTIONS +
  ARENA_ABILITY_INSTRUCTIONS +
  PARRY_INSTRUCTIONS +
  GROUND_FX_INSTRUCTIONS + TERRAIN_INSTRUCTIONS +
  ` 好的招式让玩家看得懂、躲得开：蓄力要长到看得见（0.3 秒以上，动作幅度要大），判定时刻落在动作真正打到的那一帧，近身和远处各有能用的招式。招式自己做不到、要写玩法代码的：召唤别的生物、放方块、中途做别的复杂的事——写成上面 type:"gameplay" 的出手，玩法代码接那一刻（按血量换阶段、换招式不用写代码，写在 boss 的 phases 里）；招式中途沿路径走动或追人、连招之间的条件、不在清单里的投射物或效果，招式本身仍然做不到。` +
  ` 例：{"id":"slam","name":"重锤","clip":"slam","windup":0.45,"length":1.1,"facing":"track","hits":[{"type":"area","at":0.65,"shape":{"type":"arc","reach":3,"angle":120,"low":-0.5,"high":2.5},"hits":"everyone","damage":8,"knockback":1,"effects":[]}],"moves":[],"start":{"min_distance":0,"max_distance":3,"line_of_sight":true,"cooldown":2,"weight":3},"stopped_by_hurt":false,"events":[{"type":"sound","at":0.65,"sound":"entity.iron_golem.attack","volume":1,"pitch":0.8}]}。`

export const ABILITY_SUMMARY = "投射物飞行拖尾、弧形刀光、星芒和光环可选。hit_fx 一句话组合轻中重命中反馈，碎块和落雷可换外观，生物 builtin 可以换自带的粒子和声音。粒子或声音单独写字符串 none 即关闭那一项；删去该字段恢复 Studio 自带的表现。可选：招式（abilities）——有蓄力、判定时刻、收招和冷却的攻击，判定范围（扇形、盒子、球、直线、锥形；直线和锥形朝目标瞄，也可以写成一直水平）在出手那一刻由服务端按实际位置算，也可以射出原版投射物；每一次出手还可以从模型的某个部件（bone，比如头）算起，而不是从脚下；范围还可以落在目标脚下、目标周围随机的几处或者按固定的阵型排开，并且提前在地上画出预警（圈或者光柱），到时在同样的地方判定；能把被打中的往后推、带状态效果、自身位移、声音和粒子（原版、工程 particle 资产或本生物的别名，支持部件发射、持续时间、速度、染色、聚拢和环绕、圆盘和圆环及分方向散开；生物 emitters 可以常驻或按战斗、阶段开启）；兵器挥动时还能在某个部件的末端拖出一道发光的带子（trail）；每个招式播模型里自己的一个动作。招式的某一刻还能放出这个工程里做好的效果（effect 资产：出现一下就消失的小模型），放在自己脚下、目标脚下或者某次出手打到的地方，可以一圈或一排地放，也可以顺着某次出手瞄的方向摆、跟着它一起倾斜。招式的某一刻还可以交给玩法的代码去做（召唤别的生物、放方块……），招式自己的动作、冷却、阶段、晃屏照常。招式还能笔直冲刺一段（按自己的碰撞箱撞地形，撞墙停下，沿路打人，每人只挨一下）；范围出手可设实心方块遮挡（blocked_by_walls），此时临时地形的 blocks.area 也生效；可选 break_terrain 为 0 到 50，达到地形硬度时整组打碎，还能在之后几秒里把打中的人往外推、往里拉或者吹到一边。还能扔出自己的投射物（projectile：用效果资产的模型，或者直接扔自己身上的某个部件，比如矛），直线、抛物线、回旋或者飞去飞回，落地能插在地上几秒再飞回手里，也能从天上落下一场「兵器雨」并在每个落点先画预警。" + PARRY_SUMMARY

// ---- combos (连招) ----

/**
 * A combo as ticks: each step's own plan (`abilityPlan`, untouched: its hits, moves and events are the step's) with the tick of the combo it starts on
 * (`comboTimeline`), where its ability stands in the creature's list, and the combo's own end and wait. A step that names no ability the creature has
 * (a document the checks refuse) is left out.
 */
export function comboPlan(combo: Combo, abilities: readonly Ability[]) {
  const steps = combo.steps.flatMap((id) => ((index) => (index < 0 ? [] : [{ index, ability: abilities[index]! }]))(abilities.findIndex((ability) => ability.id === id)))
  const timeline = comboTimeline(steps.map((step) => step.ability.length), combo.gap_ticks)
  return {
    id: combo.id,
    gap: combo.gap_ticks,
    damage: combo.damage_scale,
    cooldown: abilityTick(combo.start.cooldown),
    end: timeline.end,
    steps: steps.map((step, place) => ({ ...step, start: timeline.starts[place]!, plan: abilityPlan(step.ability) })),
  }
}
export type ComboPlan = ReturnType<typeof comboPlan>

/** The combos a creature may use beside its abilities, in the generated Java's order: they are chosen after its abilities, so combo `n` is choice `abilities.length + n`. */
export const abilityChoices = (abilities: readonly Ability[], combos: readonly Combo[] | null | undefined) => [...abilities, ...(combos ?? [])]

export const comboWords = {
  /** 「「横扫」→「突刺」→「砸地」」 */
  steps: (combo: Pick<Combo, "steps">, abilities: readonly Pick<Ability, "id" | "name">[]) => combo.steps.map((id) => `「${abilities.find((ability) => ability.id === id)?.name ?? id}」`).join("→"),
  /**
   * 「目标在 0–4 格、看得见的时候会用；依次出「横扫」→「突刺」，一招接一招不回待机，两招之间停 0.2 秒；每一下的伤害 ×1.2；整套 2.4 秒，之后歇 8 秒；哪一招中途挨打会停照那一招自己的，停了整套就停」
   * With `between` a line each, as the card shows it.
   */
  summary: (combo: Combo, abilities: readonly Ability[], between = "；", studio = false, stagger?: Stagger) => {
    const plan = comboPlan(combo, abilities)
    const special = plan.steps.filter(step => combatBreaks(step.ability, stagger).length)
    const ordinary = plan.steps.filter(step => step.ability.stopped_by_hurt && !special.includes(step))
    return [
      `${abilityWords.start(combo)}会用`,
      `依次出${comboWords.steps(combo, abilities)}，一招接一招不回待机，${combo.gap_ticks ? `两招之间停 ${num(combo.gap_ticks / TICKS)} 秒（${combo.gap_ticks} 刻）` : "上一招收完的下一刻就出下一招"}`,
      // 第 3 步: where it branches (ability-tactics.ts).
      ...(combo.branches?.length ? [`分支：${branchWords(combo, id => abilities.find(move => move.id === id)?.name ?? "缺少的招式")}`] : []),
      ...(combo.damage_scale !== 1 ? [`每一下的伤害 ×${num(combo.damage_scale)}（招式自己写的伤害再乘它；交给玩法代码的那一下不乘）`] : []),
      `整套 ${num((plan.end + 1) / TICKS)} 秒${combo.start.cooldown > 0 ? `，之后歇 ${num(combo.start.cooldown)} 秒` : ""}${studio ? "（连招里的每招不用单独歇）" : "（连招里的招式不另算自己的冷却）"}`,
      special.length ? [...special.map(step => `「${step.ability.name}」${abilityInterruptionWords(step.ability, stagger)}`),
        ...(ordinary.length ? [`${ordinary.map(step => `「${step.ability.name}」`).join("、")}中途挨打会被打断`] : []), "有一招被打断，整套就停"].join("。") :
        ordinary.length ? `其中${ordinary.map(step => `「${step.ability.name}」`).join("")}中途挨打会被打断，打断了整套就停` : "整套挨打也不会停",
    ].join(between)
  },
  /** 「连招第 0 秒起「横扫」（它的第 0.45 秒出手）；第 1.15 秒起「突刺」（它的第 0.3 秒出手）……」: when each step starts and lands, counted from the combo's start. */
  timeline: (combo: Combo, abilities: readonly Ability[]) =>
    comboPlan(combo, abilities)
      .steps.map((step) => `连招第 ${num(step.start / TICKS)} 秒起「${step.ability.name}」（它自己的第 ${step.plan.hits.map((hit) => num(hit.tick / TICKS)).join("、")} 秒出手，也就是连招的第 ${step.plan.hits.map((hit) => num((step.start + hit.tick) / TICKS)).join("、")} 秒）`)
      .join("；"),
}

/**
 * What is wrong with a creature's combos, measured, never a stop (the combo works, it only plays worse than it reads):
 * - `combo_window`: it starts where its first step does not: a combo is started by its own window, and its first step's hits only reach as far as that step's window was made for.
 * - `combo_rehit`: a hit of one step lands within the game's half-second of the last hit of the step before it, no heavier (the steps' own damages times the combo's), so it does nothing:
 *   the same as `ability_rehit` across two steps, which a gap of `gap_ticks` may mend.
 */
export function comboIssues(creature: { name: string; abilities?: readonly Ability[] | null; combos?: readonly Combo[] | null }): AbilityIssue[] {
  const abilities = creature.abilities ?? []
  return (creature.combos ?? []).flatMap((combo): AbilityIssue[] => {
    const plan = comboPlan(combo, abilities)
    if (!plan.steps.length) return []
    const first = plan.steps[0]!.ability
    const window = (start: Ability["start"]) => `${num(start.min_distance)}–${num(start.max_distance)}`
    const outside = combo.start.min_distance < first.start.min_distance - 1e-9 || combo.start.max_distance > first.start.max_distance + 1e-9
    // Every damaging area hit of every step on the combo's own clock; one that the game's wait turns away does not start the wait again (as `ability_rehit` counts).
    const timed = plan.steps.flatMap((step, place) => step.ability.hits.flatMap((hit, index) => (hit.type === "area" && hit.damage > 0 ? [{ place, tick: step.start + step.plan.hits[index]!.tick, damage: hit.damage * combo.damage_scale }] : []))).sort((a, b) => a.tick - b.tick)
    const lost: { hit: (typeof timed)[number]; after: (typeof timed)[number] }[] = []
    timed.reduce<(typeof timed)[number] | null>((landed, hit) => {
      if (landed && hit.tick - landed.tick < HURT_COOLDOWN && hit.damage <= landed.damage) {
        // Within one step `ability_rehit` already says so.
        if (hit.place !== landed.place) lost.push({ hit, after: landed })
        return landed
      }
      return hit
    }, null)
    return [
      ...(outside
        ? [{ ability: combo.id, refs: [comboRef(combo), abilityRef(first)], rule: "combo_window" as const, stops: false, text: `「${creature.name}」的连招「${combo.name}」在目标离它 ${window(combo.start)} 格时开始，可是它的第一招「${first.name}」是照 ${window(first.start)} 格做的：目标站在这之外开连招，第一下多半打空。`, fix: `把连招的起手距离（start.min_distance、start.max_distance）改到 ${window(first.start)} 格以内，或者换一个够得着那里的招式当第一招。`, detail: `combo ${combo.id}: start ${window(combo.start)}; first step ${first.id} start ${window(first.start)}` }]
        : []),
      ...(lost.length
        ? [{ ability: combo.id, refs: [comboRef(combo)], rule: "combo_rehit" as const, stops: false, text: `「${creature.name}」的连招「${combo.name}」有 ${lost.length} 下接在上一招的最后一下后面不到 ${HURT_COOLDOWN / TICKS} 秒（连招的第 ${lost.map((value) => num(value.hit.tick / TICKS)).join("、")} 秒），又不比那一下重：游戏刚让人受过伤的半秒里不再掉血，这几下等于白打。`, fix: `把两招之间的间隔（gap_ticks）调大，或者让后一招的出手晚一点、伤害重一点。`, detail: `combo ${combo.id}: lost hits at combo ticks ${lost.map((value) => `${value.hit.tick} (after ${value.after.tick})`).join(", ")}` }]
        : []),
    ]
  })
}

/** What an AI is told about combos. Appended after the abilities' own text (`ABILITY_INSTRUCTIONS`), whose example has to stay its last sentence. */
export const COMBO_INSTRUCTIONS =
  ` combos 是连招，可以不写（省略、null 或空数组就是没有）：最多 ${COMBO_LIMITS.combos} 个，[{id, name, steps, gap_ticks, damage_scale, start}]。连招把这只生物已经有的几个招式按 steps 的顺序一招接一招地出，中间不回待机：每一步就是那个招式本身（它的动作、蓄力、出手、位移、声音和效果都照它自己写的），上一招收完，停 gap_ticks 刻（0–${COMBO_LIMITS.gap}，一刻是 0.05 秒；0 就是紧接着）就出下一招。` +
  ` steps 写 ${COMBO_LIMITS.steps.min}–${COMBO_LIMITS.steps.max} 个招式 id（必须是 abilities 里的；不能写别的连招——不能套连招；同一个招式在一个连招里只出一次），整套最长 ${COMBO_LIMITS.seconds} 秒。damage_scale ${COMBO_LIMITS.damage.min}–${COMBO_LIMITS.damage.max}：连招里每一下的伤害乘它（1 是不变；交给玩法代码的那一下不乘）。` +
  ` start 和招式的 start 一样 {min_distance, max_distance, line_of_sight, cooldown, weight}：连招和招式放在一起按 weight 挑，满足 start 才会挑到它；连招用完从它结束算 cooldown，连招里的招式不另算自己的冷却。起手距离要在第一招自己能打到的范围里。哪一招写了 stopped_by_hurt，那一招中途挨打整套就停。` +
  ` 连招的 id 不能和招式重名：Boss 的阶段（boss.phases 的 abilities / add / remove）和 intro.opening 都可以按 id 写连招。会飞的生物（写了 flight）现在还不能写连招。` +
  ` 例：{"id":"triple","name":"三连击","steps":["sweep","thrust","slam"],"gap_ticks":2,"damage_scale":1.1,"start":{"min_distance":0,"max_distance":3,"line_of_sight":true,"cooldown":10,"weight":2}}。`

export const COMBO_SUMMARY = "可选：连招（combos）——把已有的几个招式按顺序一招接一招地出，中间不回待机，每一招照它自己的动作、出手和效果；可以设两招之间停几刻、整套伤害的倍数，起手条件和冷却和招式一样按权重挑；Boss 的阶段能按 id 加入或去掉连招。"

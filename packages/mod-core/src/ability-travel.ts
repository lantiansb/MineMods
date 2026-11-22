import { TICKS } from "./ability-words"
import { dashPlan, isPush, type PushMove } from "./ability-dash"
import { leapPlan } from "./ability-tactics"
import { AIM_TARGET, abilityPlace, abilityPlan, hitAnchors, type AbilityHitShape, type Place } from "./creature-abilities"
import { airReach, flightCircle, flightPlan } from "./creature-flight"
import { assumedTarget, diveFrame } from "./effect-abilities"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { Ability, Flight } from "./entity-runtime"

/**
 * r29c: where an ability carries the creature itself, tick by tick, for the pictures. The look used to draw a creature where it began all through an ability, so a dive
 * (`dive: true`) left the bird where it started with its hit 12 blocks off at the target, and a reviewer judged it to strike through the air. Here every tick of the ability
 * has the place of its feet when that tick's hits are counted, in its own terms when the ability started (blocks: ahead, up, to its own left), with the one it fights where
 * every picture puts them: straight ahead in the middle of the distances the ability starts at (`assumedTarget`), on the same flat ground.
 *
 * The sums are the generated Java's, step for step (a test holds the Java to them, `ability-travel.test.ts`):
 * - a dash (`fabric/ability-dash.ts`, `abilityDashTick`): from its tick on, after the abilities have ticked, `min(step, room left)` straight ahead, until its distance is gone or its ticks are out;
 * - a leap (`fabric/ability-tactics.ts`, `abilityLeapStart` / `abilityLeapTick`): `short` short of the target and no further than `max_distance` (`leapReach`), along the arc
 *   `4 · height · part · (1 − part)` over the straight line, one step a tick from its tick on, down on its last;
 * - a dive (`fabric/entity-flight.ts`, `flightDive` / `flightCharge` / `flightDiveSpeed`): when getting ready ends it locks the point (`diveFrame`: the bone and the middle of what its first
 *   hit reaches on the middle of the target, or its own middle on theirs) and every tick sets the velocity `clamp(distance / ticks left, twice cruise, 3.9)`, never more than the distance
 *   and never under what a soaring one needs to stay up, along the straight line; a velocity set on tick t is applied before tick t + 2 is counted (`diveCoverage`), so it is there on the first hit;
 * - a push it gives itself (`moves[]` without a type): its speed set at its tick and then the game's own mob physics on flat ground (block friction 0.6 times 0.91 on the ground, 0.91 in
 *   the air, gravity 0.08, vertical drag 0.98), as `LivingEntity.travel` does it with no walking of its own.
 * What cannot be known is said, not guessed (`TRAVEL_UNKNOWN`): how a dive's flier gets above the target while getting ready (it steers there from wherever it was; the pictures
 * keep it where it is, at the height it gets ready at) and where it climbs to after the last hit (it stays where it struck); the lean of the body in a dive; walls and slopes (none in the pictures).
 * Null for an ability that does not carry the creature. No Node APIs.
 */

/** What the pictures cannot know of a travel, said with them. */
export const TRAVEL_UNKNOWN = {
  dive: "蓄力的时候它在往目标头顶上方飞，从哪里飞来要看它原来在哪，图上把它画在出发的地方不动（在它蓄力的高度上）；最后一次出手以后它往上拉起，图上停在打到的地方；俯冲时身体的倾斜没有画",
  ground: "图上是平地、没有墙和坡，路线是平地上的样子",
} as const

export type TravelKind = "dive" | "dash" | "leap" | "push"
export type Travel = {
  /** What carries it, every kind it has, in the order they start. */
  kinds: TravelKind[]
  /** Per tick of the ability (0 to its length), where its feet are when that tick's hits are counted. */
  places: Place[]
  /** Its first hit: the tick, and where it is then. */
  first: { tick: number; place: Place } | null
  /** The ticks it moves on: the first and the last on which it is somewhere else than the tick before. */
  from: number
  to: number
}

const num = (value: number, digits = 4) => Number(value.toFixed(digits))
const still = (place: Place): Place => ({ forward: num(place.forward), up: num(place.up), left: num(place.left) })
const ZERO: Place = { forward: 0, up: 0, left: 0 }

/** The game's own speed of the charge on a tick (`flightDiveSpeed` in the generated flight). */
export function diveSpeed(distance: number, left: number, least: number, most: number, floor: number) {
  const speed = Math.min(Math.max(distance / Math.max(1, left), least), most)
  return Math.max(Math.min(speed, distance), floor)
}

/** How high above the target's feet a dive gets ready (`flightPlan(...).diveHeight`, `FLIGHT_DIVE_HEIGHT`), worked out as the generator does for the creature. */
export function diveHeight(flight: Flight, abilities: readonly Ability[], design: Pick<ModelDesign, "bones" | "animations">) {
  const reaching = airReach(abilities, hitAnchors(abilities, design))
  return Math.max(flightCircle(flight, abilities, reaching.some(Boolean) ? reaching : undefined).height, flight.altitude.min)
}

export type TravelInput = {
  design: Pick<ModelDesign, "bones" | "animations">
  /** The creature's flight, when it flies, and every ability it has (what its dive height is worked out from). */
  flight?: Flight | null
  abilities?: readonly Ability[]
  /** The height of its body (blocks): a dive brings its middle to where it locked. */
  height: number
}

/** Where `ability` carries the creature, tick by tick (see the file), or null when it carries it nowhere. */
export function abilityTravel(ability: Ability, input: TravelInput): Travel | null {
  const plan = abilityPlan(ability)
  const length = plan.length
  const first = plan.hits.length ? Math.min(...plan.hits.map((hit) => hit.tick)) : null
  // In the air a flier's flight is its whole movement: a dash, a leap or a push does nothing there (the generated Java returns at once).
  const aloft = Boolean(input.flight) && ability.where === "air"
  const dive = ability.dive && input.flight ? diving(ability, input, plan) : null
  const places = dive ?? grounded(ability, length, aloft)
  if (!places) return null
  const kinds: TravelKind[] = dive ? ["dive"] : [...(dashPlan(ability) && !aloft ? ["dash" as const] : []), ...(leapPlan(ability) && !aloft ? ["leap" as const] : []), ...(ability.moves.some(isPush) && !aloft ? ["push" as const] : [])]
  const moved = places.flatMap((place, tick) => (tick && apart(place, places[tick - 1]!) > 1e-6 ? [tick] : []))
  if (!moved.length && !dive) return null
  return { kinds, places: places.map(still), first: first === null ? null : { tick: first, place: still(places[Math.min(first, length)]!) }, from: moved[0] ?? 0, to: moved.at(-1) ?? 0 }
}

const apart = (a: Place, b: Place) => Math.hypot(a.forward - b.forward, a.up - b.up, a.left - b.left)

/** A dive, from the height it gets ready at straight above where it began. */
function diving(ability: Ability, input: TravelInput, plan: ReturnType<typeof abilityPlan>): Place[] | null {
  if (!plan.hits.length) return null
  const flight = input.flight!
  const all = input.abilities?.length ? input.abilities : [ability]
  const flier = flightPlan(flight, all, true)
  const half = input.height / 2
  const start: Place = { forward: 0, up: diveHeight(flight, all, input.design), left: 0 }
  const frame = diveFrame(ability, input.design)
  // Where its middle goes: the bone's frame (`flightDiveReached`, laid on the target), or its middle on the target's middle (never into the flat ground under them).
  const goal: Place = frame ? { forward: frame.shift.forward, up: frame.shift.up + half, left: frame.shift.left } : { forward: assumedTarget(ability), up: Math.max(half, AIM_TARGET.middle), left: 0 }
  const firstTick = Math.min(...plan.hits.map((hit) => hit.tick))
  const lastTick = Math.max(...plan.hits.map((hit) => hit.tick))
  // `centres[t]`: its middle when the flight runs on tick t; `velocity[t]`: what that run sets. A velocity is applied before the tick two on is counted.
  const middle = (place: Place): Place => ({ ...place, up: place.up + half })
  const centres: Place[] = [middle(start)]
  const velocity: Place[] = []
  for (let tick = 0; tick <= plan.length; tick++) {
    const here = centres[tick]!
    const charging = tick >= plan.windup && tick < lastTick
    const to = { forward: goal.forward - here.forward, up: goal.up - here.up, left: goal.left - here.left }
    const distance = Math.hypot(to.forward, to.up, to.left)
    const speed = charging ? diveSpeed(distance, firstTick - tick - 1, flier.diveLeast, flier.diveMost, flier.stall) : 0
    const scale = charging && distance > 1e-6 ? speed / distance : 0
    velocity.push({ forward: to.forward * scale, up: to.up * scale, left: to.left * scale })
    centres.push({ forward: here.forward + velocity[tick]!.forward, up: here.up + velocity[tick]!.up, left: here.left + velocity[tick]!.left })
  }
  // Counted on tick T: the middle the flight saw on tick T − 1 (every velocity up to T − 2 applied), its feet half its height under it, never under the ground.
  return Array.from({ length: plan.length + 1 }, (_, tick) => {
    const centre = centres[Math.max(0, tick - 1)]!
    return { forward: centre.forward, up: Math.max(0, centre.up - half), left: centre.left }
  })
}

/** A dash, a leap and the pushes it gives itself, on flat ground, tick by tick. Null when it has none (or has them only in the air, where they do nothing). */
function grounded(ability: Ability, length: number, aloft: boolean): Place[] | null {
  const dash = aloft ? null : dashPlan(ability)
  const leap = aloft ? null : leapPlan(ability)
  const pushes = aloft ? [] : ability.moves.flatMap((move) => (isPush(move) ? [move] : []))
  if (!dash && !leap && !pushes.length) return null
  const at = (seconds: number) => Math.min(length, Math.round(seconds * TICKS))
  const places: Place[] = []
  let here: Place = { ...ZERO }
  let room = dash?.dash.distance ?? 0
  let dashLeft = 0
  let leapFrom: Place = ZERO
  let leapTo: Place = ZERO
  let leapStep = 0
  let leapTicks = 0
  let speed: Place = { ...ZERO }
  let ground = true
  for (let tick = 0; tick <= length; tick++) {
    // What is counted on this tick is counted before the moves of this tick (they run after the abilities have ticked).
    places.push({ ...here })
    // A push sets its speed while the ability ticks; the body then moves by it in the same tick (`LivingEntity.travel`).
    const pushed = pushes.filter((move: PushMove) => at(move.at) === tick)
    pushed.forEach((move) => (speed = { forward: move.forward, up: move.up > 0 ? move.up : speed.up, left: 0 }))
    if (dash && tick === dash.start) dashLeft = dash.ticks
    if (leap && tick === leap.start) {
      leapFrom = { ...here }
      const go = Math.max(0, Math.min(leap.leap.max_distance, assumedTarget(ability) - here.forward - (leap.leap.short ?? 0)))
      leapTo = { forward: here.forward + go, up: 0, left: here.left }
      leapStep = 0
      leapTicks = Math.max(1, leap.ticks)
      speed = { ...ZERO }
    }
    if (dashLeft > 0) {
      dashLeft--
      const step = Math.min(dash!.step, room)
      here = { ...here, forward: here.forward + step }
      room -= step
      if (room <= 1e-3) dashLeft = 0
      speed = { forward: 0, up: speed.up, left: 0 }
    }
    if (leapStep < leapTicks) {
      leapStep++
      const part = leapStep / leapTicks
      const up = leapFrom.up + (leapTo.up - leapFrom.up) * part + 4 * leap!.leap.height * part * (1 - part)
      here = { forward: leapFrom.forward + (leapTo.forward - leapFrom.forward) * part, up: leapStep >= leapTicks ? 0 : Math.max(0, up), left: leapFrom.left }
      speed = { ...ZERO }
      ground = leapStep >= leapTicks
      continue
    }
    if (pushes.length && (Math.abs(speed.forward) > 1e-4 || speed.up > 1e-4 || !ground)) {
      // The game's mob physics with no walking of its own, on flat ground: move by the speed, then slow it down.
      const friction = ground ? 0.6 * 0.91 : 0.91
      const rise = here.up + speed.up
      here = { forward: here.forward + speed.forward, up: Math.max(0, rise), left: here.left }
      const landed = rise <= 0
      speed = { forward: speed.forward * friction, up: landed ? 0 : (speed.up - 0.08) * 0.98, left: 0 }
      ground = landed || here.up <= 1e-6
    }
  }
  return places
}

/** The travel of a creature's ability at a moment in seconds: where its feet are then (its start when it does not move). */
export const travelAt = (travel: Travel | null, seconds: number): Place => (travel ? travel.places[Math.max(0, Math.min(travel.places.length - 1, Math.round(seconds * TICKS)))]! : ZERO)

type Vec = [number, number, number]
/** Where the creature has been carried to at a moment in seconds, in the viewport's space (model pixels: `abilityPlace`), or null where it is where it began. */
export const travelShift = (travel: Travel | null, seconds: number): Vec | null => ((place) => (Math.hypot(place.forward, place.up, place.left) > 1e-6 ? abilityPlace(place.forward, place.up, place.left) : null))(travelAt(travel, seconds))
/** The colour a travel is drawn in: its way dashed, and the box where it is at the first hit. */
export const TRAVEL_COLOR = "#ffd400"
/** A box `size` blocks across standing with its feet's middle at `feet` (viewport space), as one line along its twelve edges. */
export function boxOutline(feet: Vec, size: { width: number; height: number }): Vec[] {
  const half = (size.width * 16) / 2
  const top = feet[1] + size.height * 16
  const corner = (x: number, y: number, z: number): Vec => [feet[0] + x * half, y, feet[2] + z * half]
  const [a, b, c, d] = [corner(-1, feet[1], -1), corner(1, feet[1], -1), corner(1, feet[1], 1), corner(-1, feet[1], 1)]
  const [e, f, g, h] = [corner(-1, top, -1), corner(1, top, -1), corner(1, top, 1), corner(-1, top, 1)]
  return [a, b, c, d, a, e, f, b, f, g, c, g, h, d, h, e]
}
/** What a picture draws of a travel over a cell (viewport space): its way at the middle of its body, one point a tick, dashed; and its box where it is at the first hit. */
export function travelTrails(travel: Travel, body: { width: number; height: number }): { points: Vec[]; color: string; dashed?: true }[] {
  const way = travel.places.map((place) => abilityPlace(place.forward, place.up + body.height / 2, place.left))
  const first = travel.first ? boxOutline(abilityPlace(travel.first.place.forward, travel.first.place.up, travel.first.place.left), body) : []
  return [{ points: way, color: TRAVEL_COLOR, dashed: true }, ...(first.length ? [{ points: first, color: TRAVEL_COLOR }] : [])]
}

/**
 * The faces a hit is drawn with when its ability carries the creature: a hit round the creature is counted where the creature is on the hit's tick, so its shape and a force's arrows
 * (`carried`) go there, and a dash's band and a leap's arrow (`laid`) stay where they start; a hit put somewhere else, and every hit of an ability that carries nothing, as it always was.
 */
export function travelFaces(hit: Pick<AbilityHitShape, "faces" | "carried" | "laid" | "remote" | "tick">, travel: Travel | null): Vec[][] {
  const by = travelShift(travel, hit.tick / TICKS)
  return by && !hit.remote ? [...hit.carried.map((face) => face.map((point): Vec => [point[0] + by[0], point[1] + by[1], point[2] + by[2]])), ...hit.laid] : hit.faces
}

/** The words of a travel for the notes and the reviewer (`招式「…」会带着它走：…`). */
export function travelWords(ability: Pick<Ability, "name">, travel: Travel) {
  const at = (tick: number) => `第 ${Number((tick / TICKS).toFixed(2))} 秒`
  const end = travel.places[travel.to]!
  const first = travel.first
  const said: Record<TravelKind, string> = { dive: "俯冲", dash: "冲刺", leap: "跳扑", push: "自己往前冲" }
  const where = (place: Place) => `正前方 ${num(place.forward, 1)} 格${Math.abs(place.left) > 0.05 ? `、${place.left > 0 ? "左" : "右"}边 ${num(Math.abs(place.left), 1)} 格` : ""}、离地 ${num(place.up, 1)} 格`
  return [
    `招式「${ability.name}」会带着它走（${travel.kinds.map((kind) => said[kind]).join("、")}）：图上的生物按游戏里同一套算法画在每一刻它在的位置，黄色虚线是它这一路，${at(travel.from)}起动、${at(travel.to)}到${where(end)}。` +
      (first ? `第一次出手（${at(first.tick)}）的时候它在${where(first.place)}（黄框）。` : "") +
      `${travel.kinds.includes("dive") ? TRAVEL_UNKNOWN.dive : TRAVEL_UNKNOWN.ground}。`,
  ]
}

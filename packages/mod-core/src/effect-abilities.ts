import { hitElsewhere } from "./entity-runtime"
import { abilityRef, assetRef } from "./finding-refs"
import { plainShape } from "./arena"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { sampleBone } from "@minemods/studio-ai/animation"
import { tierOf } from "@minemods/studio-ai/budget"
import { EFFECT_LIMITS, EFFECT_ZONE_TOLERANCE, TICKS } from "./ability-words"
export { EFFECT_ZONE_TOLERANCE } from "./ability-words"
import { abilityPlace, abilityPlan, abilityTick, abilityHitPlaces, AIM_TARGET, aimPitch, diveReach, hitAnchor, shapeAims, shapeGap, type Place } from "./creature-abilities"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import { effectMeasure, effectModel, effectMoment, effectTicks, type EffectDocument } from "./effect"
import { modelBounds } from "./model-bounds"
import type { Ability, AbilityEvent, AbilityHit, AbilityShape } from "./entity-runtime"
import type { ModuleDocument } from "./workspace"

/**
 * Effects as a creature's abilities show them: where each one is put (the same arithmetic the generated
 * Java does, in the creature's own terms), when it appears and goes against the ability's own times, how
 * many exist at once, and whether an effect put on a hit lies where that hit lands. Also the creature and
 * its effects as one model at one moment, so a picture can show them together. Everything is read from the
 * documents; nothing here knows what an effect or a creature is a picture of. No Node APIs.
 */

type Vec = [number, number, number]
export type EffectEvent = Extract<AbilityEvent, { type: "effect" }>
/** An effect asset as this file needs it: null when the project has no such effect. */
export type EffectLookup = ((id: string) => { title: string; document: EffectDocument } | null) & { texture?: (id: string) => { title: string; document: Extract<ModuleDocument, { kind: "texture" }> } | null; blockColor?: (id:string) => string | undefined; particle?: import("./particle-preview").ParticleLookup; examples?: (p: import("./particle").ParticleDocument, owner?: ModuleDocument) => import("./particle-context").SceneExample[] }
import { particleExamples } from "./particle-context"
/** The effect assets of a project, by asset id. */
export const effectLookup =
  (project: { blocks?: readonly {identifier:string; color:string}[]; workspace: { assets: readonly { id: string; title: string; document: ModuleDocument }[] } }): EffectLookup =>
  Object.assign((id: string) => project.workspace.assets.flatMap((asset) => (asset.id === id && asset.document.kind === "effect" ? [{ title: asset.title, document: asset.document }] : []))[0] ?? null, {
    texture: (id: string) => {
      const asset = project.workspace.assets.find((value) => value.id === id)
      return asset?.document.kind === "texture" ? { title: asset.title, document: asset.document } : null
    },
    blockColor: (id:string) => project.blocks?.find(block => block.identifier === id)?.color,
    examples: (p:import("./particle").ParticleDocument,owner?:ModuleDocument)=>particleExamples(project.workspace.assets,p,owner),
    particle: (id: string) => {
      const asset = project.workspace.assets.find(a => a.id === id)
      return asset?.document.kind === "particle" ? { title: asset.title, document: asset.document } : null
    },
  })
const BLOCK = 16
// Never minus zero: a place a hair behind nothing is nothing.
const num = (value: number, digits = 2) => Number(value.toFixed(digits)) || 0
const degrees = (radians: number) => (radians * 180) / Math.PI

export const effectEvents = (ability: Pick<Ability, "events">) => ability.events.flatMap((event, index) => (event.type === "effect" ? [{ index, event }] : []))
/** Every effect asset the abilities of a creature show, each once. */
export const abilityEffectIds = (abilities: readonly (Pick<Ability, "events"> & Partial<Pick<Ability, "hits">>)[] | null | undefined) => [
  ...new Set([
    ...(abilities ?? []).flatMap(a => a.events.flatMap(e => e.type === "lightning" && e.look?.effect ? [e.look.effect] : [])),
    ...(abilities ?? []).flatMap((ability) => effectEvents(ability).map((found) => found.event.effect)),
    ...(abilities ?? []).flatMap(a => a.events.flatMap(event => event.type === "shockwave" && event.warn?.effect ? [event.warn.effect] : [])),
    ...(abilities ?? []).flatMap(a => (a.hits ?? []).flatMap(h => h.type === "area" && h.warn?.effect ? [h.warn.effect] : [])),
    // Boss 能力 2: an effect a thrown thing looks like is one the creature depends on, as one it shows.
    ...(abilities ?? []).flatMap((ability) => (ability.hits ?? []).flatMap((hit) => (hit.type === "projectile" && "effect" in hit.look ? [hit.look.effect] : []))),
    // 落地炸开: an effect shown where a thrown thing comes down, the same.
    ...(abilities ?? []).flatMap((ability) => (ability.hits ?? []).flatMap((hit) => (hit.type === "projectile" && hit.impact?.effect !== undefined ? [hit.impact.effect] : []))),
  ]),
]

/**
 * The middle of where a hit lands, in the creature's own terms (blocks). `aimed`: the place lies along the
 * line toward the one it fights (a beam, a cone), `forward` blocks along it from `up` above its feet; in a
 * picture that line is drawn level and straight ahead.
 */
export function hitCentre(hit: AbilityHit): { forward: number; up: number; left: number; aimed: boolean } {
  if (hit.type === "shot") return { forward: hit.forward, up: hit.up, left: 0, aimed: false }
  // What a gameplay does has no place it lands (an effect cannot be laid on it: `AbilitySchema`); its centre is the creature's own feet.
  if (hit.type === "gameplay") return { forward: 0, up: 0, left: 0, aimed: false }
  // Boss 能力 2: a thrown thing lands where its flight takes it (nothing can be laid on it: `projectileRules`); its centre is the creature's own feet.
  if (hit.type === "projectile") return { forward: 0, up: 0, left: 0, aimed: false }
  // Boss 能力 13: a hit over the whole arena is read as the full circle it covers.
  const shape = plainShape(hit.shape)
  if (shape.type === "arc") return { forward: num(shape.reach / 2, 4), up: num((shape.low + shape.high) / 2, 4), left: 0, aimed: false }
  if (shape.type === "line" || shape.type === "cone") return { forward: num(shape.length / 2, 4), up: shape.up, left: 0, aimed: shape.aim !== "level" }
  return { forward: shape.forward, up: shape.up, left: shape.left, aimed: false }
}

/**
 * J2: where the one it fights stands when a picture or a measure has to put it somewhere other than level with
 * what aims at it: `distance` blocks straight ahead, its feet `height` blocks above the creature's own.
 */
export type Stand = { distance: number; height: number }

/**
 * J2: in whose terms one effect event's offsets and layout are counted. `aim`: along the direction hit number
 * `hit` aims in, from `up` above the creature's feet and `forward` ahead of them: the whole layout turns as one
 * piece with that hit, about where its aim starts, every effect tilted with it.
 * `facing`: the creature's own level terms, every effect upright. Written with `along`; left out, an effect put
 * on a line or a cone that aims at the target goes along that aim, so the two agree by construction, and
 * everything else is level as it always was. A hit that does not tilt (any other shape, or `aim: "level"`) has
 * no terms of its own: an effect along it is level.
 */
export function eventFrame(ability: Pick<Ability, "hits">, event: EffectEvent): { along: "facing" } | { along: "aim"; hit: number; up: number; forward: number } {
  const hit = ability.hits[event.hit ?? 0]
  if (event.hit === null || !hit) return { along: "facing" }
  const wanted = event.along ?? (event.where === "hit" && hit.type === "area" ? "aim" : "facing")
  if (wanted !== "aim") return { along: "facing" }
  if (hit.type === "shot") return { along: "aim", hit: event.hit, up: hit.up, forward: hit.forward }
  if (hit.type === "gameplay" || hit.type === "projectile") return { along: "facing" }
  return shapeAims(hit.shape) ? { along: "aim", hit: event.hit, up: hit.shape.up, forward: 0 } : { along: "facing" }
}

/** Where the one it fights is taken to stand when a picture has to put it somewhere: straight ahead, in the middle of the distances the ability starts at. */
export const assumedTarget = (ability: Pick<Ability, "start">) => num((ability.start.min_distance + ability.start.max_distance) / 2)

// ---- a dive: where the creature is when it strikes ----

/**
 * A dive whose first hit counts from a bone, as a picture and a measure take it (one rule; `diveReach` is its source and `flightDiveReached` / `flightDiveHeld` in
 * the generated flight Java are the arithmetic it follows). In the game the charge ends with that bone and the middle of what the hit reaches laid on the middle of
 * the one it fights, and the creature facing them, so everything the dive hits is counted there and not where the creature began. Taken straight ahead, as every other
 * picture takes the target (`assumedTarget`), the creature is therefore moved by `shift` (blocks: ahead, up, to its own left) from the tick `arrives` (the first hit) on,
 * and the hit shapes, which are where the hit lands, are at the target all the time. `anchors` are where each hit counts from, in the creature's own terms.
 * Before `arrives` the creature is still where it began: getting ready it only lines up above the target (`flightDive`), and between the end of getting ready and the
 * first hit it is flying in at a speed that depends on the creature, so nothing says where it is: a picture of a moment before the first hit shows it at its start, a
 * wind-up that is exactly what the game shows then, with the red range already at the target, where the hit will land. After the last hit it climbs away from the
 * target, not to a place a picture could know, so it stays where it struck (the last place it surely was).
 * Not drawn: the lean (`flightLeaned`) that nose-down and banking give the body, which moves the bone by a few blocks in the game; the pose the picture shows is the model's own.
 * Vertically the hit's middle is put at the middle of a player's body (`AIM_TARGET.middle`), the creature's feet never under the target's (`flightDiveHeld`).
 */
export type DiveFrame = { arrives: number; shift: Place; anchors: readonly (Place | null)[] }

/** The dive of an ability on a model, or null when it is not one the game brings a bone to the target for (`diveReach` is null). */
export function diveFrame(ability: Ability, design: Pick<ModelDesign, "bones" | "animations">): DiveFrame | null {
  const anchors = ability.hits.map((_, index) => hitAnchor(ability, index, design))
  const reach = diveReach(ability, anchors)
  if (!reach) return null
  const [forward, up, left, focusForward, focusUp, focusLeft] = reach as [number, number, number, number, number, number]
  return {
    arrives: Math.min(...abilityPlan(ability).hits.map((hit) => hit.tick)),
    anchors,
    shift: { forward: num(assumedTarget(ability) - (forward + focusForward), 4), up: num(Math.max(0, AIM_TARGET.middle - (up + focusUp)), 4), left: num(-(left + focusLeft), 4) },
  }
}

/** Whether a dive has brought the creature to its target on this tick. */
export const diveArrived = (dive: DiveFrame | null, tick: number) => dive !== null && tick >= dive.arrives
/** Where hit number `index` starts in a dive's picture (the creature's own terms, blocks): from its bone, or its feet, after the creature has been brought to the target. */
export const diveOrigin = (dive: DiveFrame, index: number): Place => {
  const anchor = dive.anchors[index] ?? { forward: 0, up: 0, left: 0 }
  return { forward: num(dive.shift.forward + anchor.forward, 4), up: num(dive.shift.up + anchor.up, 4), left: num(dive.shift.left + anchor.left, 4) }
}
/** What `effectAtHit` is handed for a dive: the dive and the hit it measures against. */
export type DiveHit = { frame: DiveFrame; hit: number }

/**
 * Where each effect of one event is put, in the creature's own terms (blocks from its feet: ahead, up, to
 * its own left) and how each is turned: `turn` degrees toward its own left about the vertical, then (J2)
 * tilted `pitch` degrees upward, then `spin` degrees toward its own left about its own tilted upright. The
 * generated `abilityEffect` and `abilityEffectAimed` do the same sums in the world. `facing`: how this effect
 * faces; one that faces the target is turned to where the target is taken to stand (`target` blocks straight
 * ahead). `stand` (J2): the target stands there instead, higher or lower, so what aims at it is tilted; without
 * it everything that aims is level, as the pictures draw it, and nothing is tilted. `shift`: the creature is not at its feet's origin but moved by this (a dive that
 * has brought it to its target, `diveFrame`): what is put in its own terms (on itself or on a hit) moves with it, what is put on the target does not.
 */
export function effectPlaces(ability: Pick<Ability, "hits" | "start">, event: EffectEvent, facing: EffectDocument["play"]["facing"] = "owner", target = assumedTarget(ability), stand: Stand | null = null, shift: Place | null = null) {
  const frame = eventFrame(ability, event)
  const centre = hitCentre(ability.hits[event.hit ?? 0] ?? ability.hits[0]!)
  const level = event.where === "self" ? { forward: 0, up: 0, left: 0 } : event.where === "target" ? { forward: target, up: 0, left: 0 } : centre
  const pitch = stand && frame.along === "aim" ? aimPitch(frame.up, frame.forward, stand) : 0
  // The middle of a hit that aims lies along its aim, so it rises and falls with the target whatever the effect's own terms are.
  const lift = stand && centre.aimed ? aimPitch(centre.up, 0, stand) : 0
  // Where the layout is counted from. Along an aim everything turns as one piece, with the hit, about where the aim starts: what the level
  // picture shows is what is there at any tilt. Only the target's own feet are where the target is, whatever aims at it.
  const from =
    frame.along === "aim" && event.where !== "target"
      ? { forward: frame.forward, up: frame.up, left: level.left, ahead: level.forward - frame.forward, above: level.up - frame.up }
      : event.where === "target"
        ? { forward: stand?.distance ?? target, up: stand?.height ?? 0, left: 0, ahead: 0, above: 0 }
        : event.where === "hit"
          ? { forward: centre.forward * Math.cos(lift), up: centre.up + centre.forward * Math.sin(lift), left: centre.left, ahead: 0, above: 0 }
          : { ...level, ahead: 0, above: 0 }
  const linked = event.where === "hit" && event.hit != null ? ability.hits[event.hit] : null
  const offsets = linked?.type === "area" && hitElsewhere(linked) ? abilityHitPlaces(ability,event.hit!,target) : [shift && event.where !== "target" ? shift : null]
  return offsets.flatMap(moved => Array.from({ length: event.count }, (_, index) => {
    const ring = event.layout === "ring" && event.count > 1
    const angle = ring ? (index * 2 * Math.PI) / event.count : 0
    const along = from.ahead + event.forward + (ring ? event.spread * Math.cos(angle) : event.count > 1 ? (event.spread * index) / (event.count - 1) : 0)
    const above = from.above + event.up
    const forward = from.forward + along * Math.cos(pitch) - above * Math.sin(pitch)
    const left = from.left + event.left + (ring ? event.spread * Math.sin(angle) : 0)
    // One that always turns to whoever looks at it is never tilted; one that is not tilted has one turn only.
    const tilted = pitch !== 0 && facing !== "camera"
    const at = { forward: forward + (moved?.forward ?? 0), left: left + (moved?.left ?? 0) }
    return {
      forward: num(at.forward, 4),
      up: num(from.up + along * Math.sin(pitch) + above * Math.cos(pitch) + (moved?.up ?? 0), 4),
      left: num(at.left, 4),
      turn: num(facing === "target" ? degrees(Math.atan2(-at.left, (stand?.distance ?? target) - at.forward)) : tilted ? 0 : degrees(angle), 2),
      pitch: tilted ? num(degrees(pitch), 2) : 0,
      spin: tilted && facing !== "target" ? num(degrees(angle), 2) : 0,
      // r29c: drawn this many times as large as built, about its own origin, as the generated runtime draws it; left out, as built.
      ...(event.size === undefined ? {} : { size: event.size }),
    }
  }))
}
/** J2: an effect that lies on the ground is put down under its place and is never tilted. In a picture the ground is at the creature's feet. */
export const grounded = <Place extends { up: number; turn: number; pitch: number; spin: number }>(place: Place): Place => ({ ...place, up: 0, turn: num(place.turn + place.spin, 2), pitch: 0, spin: 0 })
export type EffectPlace = ReturnType<typeof effectPlaces>[number]

// ---- when ----

/**
 * Every effect of an ability on the ability's own clock, in server ticks from its start: when it appears,
 * how many, and when the last of it is gone (null: the project has no such effect, so nothing is known).
 * An effect appears on the tick its event falls on and first ticks on the next one.
 */
export function abilityEffectPlan(ability: Ability, lookup: EffectLookup) {
  const plan = abilityPlan(ability)
  return effectEvents(ability).map(({ index, event }) => {
    const found = lookup(event.effect)
    const tick = plan.events.find((value) => value.index === index)!.tick
    // The hit it belongs to: the one it is put on, else the one nearest in time.
    const hit = event.hit !== null ? plan.hits[event.hit]! : plan.hits.reduce((best, value) => (Math.abs(value.tick - tick) < Math.abs(best.tick - tick) ? value : best))
    return { index, effect: event.effect, title: found?.title ?? null, tick, count: event.count, gone: found ? tick + effectTicks(found.document.play.lifetime) : null, ends_with_owner: found?.document.play.ends_with_owner ?? null, windup: plan.windup, length: plan.length, hit }
  })
}
export type AbilityEffectPlan = ReturnType<typeof abilityEffectPlan>[number]

/** The most effects one ability has in the world at one time, when it runs to its end. */
export function effectsAlive(plans: readonly Pick<AbilityEffectPlan, "tick" | "gone" | "count">[]) {
  return Math.max(0, ...plans.map((at) => plans.filter((other) => other.gone !== null && other.tick <= at.tick && other.gone > at.tick).reduce((sum, other) => sum + other.count, 0)))
}

// ---- where, against where the hit lands ----

/** A corner of an effect's model (viewport space, model pixels) where one of its places puts it. The viewport mirrors the document's X, so its own left is -X there. */
const placedPoint = (point: Vec, place: EffectPlace): Vec => {
  const about = (value: Vec, angle: number): Vec => [value[0] * Math.cos(angle) + value[2] * Math.sin(angle), value[1], -value[0] * Math.sin(angle) + value[2] * Math.cos(angle)]
  // Its size first (the same every way), then its own turn, then the tilt (its front, -Z, rises), then the turn it stands at.
  const size = place.size ?? 1
  const spun = about(size === 1 ? point : [point[0] * size, point[1] * size, point[2] * size], (place.spin * Math.PI) / 180)
  const tilt = (place.pitch * Math.PI) / 180
  const turned = about([spun[0], spun[1] * Math.cos(tilt) - spun[2] * Math.sin(tilt), spun[1] * Math.sin(tilt) + spun[2] * Math.cos(tilt)], (place.turn * Math.PI) / 180)
  const at = abilityPlace(place.forward, place.up, place.left)
  return [turned[0] + at[0], turned[1] + at[1], turned[2] + at[2]]
}

/** J2: five points down the middle of a pose along the side it is longest on (its own space): where a long effect runs, end to end. */
function spine(pose: readonly Vec[]): Vec[] {
  const low = [0, 1, 2].map((axis) => Math.min(...pose.map((point) => point[axis]!)))
  const high = [0, 1, 2].map((axis) => Math.max(...pose.map((point) => point[axis]!)))
  const long = [0, 1, 2].reduce((best, axis) => (high[axis]! - low[axis]! > high[best]! - low[best]! ? axis : best))
  return [0, 0.25, 0.5, 0.75, 1].map((share) => [0, 1, 2].map((axis) => (axis === long ? low[axis]! + (high[axis]! - low[axis]!) * share : (low[axis]! + high[axis]!) / 2)) as Vec)
}

/**
 * One event's effects at their fullest, put where the ability puts them, against where its hit lands:
 * - `places`: where each one is put; `peak`: seconds after it appears at which it is at its fullest;
 * - `corners`: every cube corner of each one at that moment (viewport space, model pixels);
 * - `middles`: how far the middle of each one lies outside the hit's shape, in blocks (0: inside);
 * - `spines` (J2): the same for the point of each one's own length that lies furthest outside (a long effect is more than its middle);
 * - `wide`: how wide the whole of them is across (blocks, on the ground plane), and `far`: how far ahead of the creature they reach.
 * With `stand` (J2) the target stands there and whatever aims at it, the shape and the effects laid out along it, is tilted.
 * With `dive` the creature has been brought to its target (`diveFrame`): the shape starts where that hit counts from in that frame, an effect put in the creature's own
 * terms that appears on or after the tick it arrives is moved with it, and `far` is counted from where the creature then stands.
 * Null when the project has no such effect or the effect has no such motion.
 */
export function effectAtHit(ability: Ability, event: EffectEvent, found: { document: EffectDocument } | null, shape: AbilityShape | null, stand: Stand | null = null, dive: DiveHit | null = null) {
  const measured = found ? effectMeasure(found.document) : null
  if (!found || !measured) return null
  // The tick the effect appears on (`abilityPlan`): it is put where the creature stands then.
  const moved = dive && diveArrived(dive.frame, Math.min(abilityPlan(ability).length, abilityTick(event.at))) ? dive.frame.shift : null
  const places = effectPlaces(ability, event, found.document.play.facing, assumedTarget(ability), stand, moved)
  const ground = found.document.play.on_ground ? places.map(grounded) : places
  const pose = measured.poses[measured.peak.tick]!
  const corners = ground.map((place) => pose.map((point) => placedPoint(point, place)))
  const middle = (points: Vec[]): Vec => [0, 1, 2].map((axis) => (Math.min(...points.map((point) => point[axis]!)) + Math.max(...points.map((point) => point[axis]!))) / 2) as Vec
  const all = corners.flat()
  const tilt = shape && stand && shapeAims(shape) ? aimPitch(shape.up, 0, stand) : 0
  const run = spine(pose)
  // A shape is written from where its hit counts from; in a dive that is a place of its own, away from the origin the pictures count the effects from.
  const start = dive ? ((place) => abilityPlace(place.forward, place.up, place.left))(diveOrigin(dive.frame, dive.hit)) : null
  const from = (point: Vec): Vec => (start ? [point[0] - start[0], point[1] - start[1], point[2] - start[2]] : point)
  return {
    places: ground,
    peak: measured.peak.seconds,
    corners,
    middles: shape ? corners.map((points) => num(shapeGap(shape, from(middle(points)), tilt) / BLOCK)) : [],
    spines: shape ? ground.map((place) => num(Math.max(...run.map((point) => shapeGap(shape, from(placedPoint(point, place)), tilt))) / BLOCK)) : [],
    wide: num((Math.max(...all.map((point) => point[0])) - Math.min(...all.map((point) => point[0]))) / BLOCK),
    far: num(Math.max(...all.map((point) => -point[2])) / BLOCK - (moved?.forward ?? 0)),
  }
}

/** J2: how tall a creature stands as its model is built, in blocks: how much higher the target is put by `aimStands`. */
export const creatureTall = (design: ModelDesign) => num(modelBounds(design).max[1]! / BLOCK, 1)

/**
 * J2: where the target is put to see whether what is shown still lies on what is hit when it does not stand
 * level with the aim. Two places a player really is: on the same ground as the creature (what aims from above a
 * player's middle then points down), and standing higher by the creature's own height `tall` (a ledge, a
 * slope, a jump over it: the step a creature of that size makes look ordinary). Without `tall` (the model is
 * not known here) only the first. Both straight ahead at the distance a picture takes the target to stand.
 */
export const aimStands = (ability: Pick<Ability, "start">, tall: number | null = null): (Stand & { words: string })[] => [
  { distance: assumedTarget(ability), height: 0, words: "站在同一块地上" },
  ...(tall !== null && tall > 0 ? [{ distance: assumedTarget(ability), height: num(tall, 1), words: `站在比它高 ${num(tall, 1)} 格的地方` }] : []),
]

/**
 * J2: one effect event against a hit that aims at the target, when the target does not stand level with it.
 * For each place of `aimStands`: how far the hit is tilted (degrees, up positive) and how far the effects then
 * lie outside it at most (`index`: the hit the event belongs to), measured along each one's whole length (`gap`, blocks; 0: inside). `level` is the
 * same with nothing tilted, as the other pictures draw it, and `worst` the stand with the largest gap (of
 * equals, the highest). `disagrees`: on level ground the effects lie on the hit (within `EFFECT_ZONE_TOLERANCE`),
 * so a player reads them as where it lands, and at `worst` they are further outside it than that.
 * Null when the event's hit does not aim (nothing can come apart), for an effect that lies on the ground, or when nothing can be measured.
 */
export function effectAimGap(ability: Ability, event: EffectEvent, index: number, found: { document: EffectDocument } | null, tall: number | null = null) {
  const hit = ability.hits[index]
  // One that lies on the ground is put down under its place wherever that is; how high the ground is where the target stands is not known here.
  if (!hit || hit.type !== "area" || !shapeAims(hit.shape) || found?.document.play.on_ground) return null
  const shape = hit.shape
  const flat = effectAtHit(ability, event, found, shape)
  if (!flat) return null
  const level = Math.max(0, ...flat.spines)
  const stands = aimStands(ability, tall).map((stand) => ({ ...stand, tilt: num(degrees(aimPitch(shape.up, 0, stand)), 1), gap: Math.max(0, ...effectAtHit(ability, event, found, shape, stand)!.spines) }))
  const worst = stands.reduce((best, stand) => (stand.gap >= best.gap ? stand : best))
  return { hit: index, frame: eventFrame(ability, event).along, level, stands, worst, disagrees: level <= EFFECT_ZONE_TOLERANCE + 1e-9 && worst.gap > EFFECT_ZONE_TOLERANCE + 1e-9 }
}
const moment = (ticks: number) => num(ticks / TICKS)
const gap = (ticks: number, before: string, after: string, same: string) => (ticks === 0 ? same : ticks < 0 ? `${before} ${moment(-ticks)} 秒` : `${after} ${moment(ticks)} 秒`)

/** True when a sentence of `abilityEffectLines` reports a disagreement. */
export const effectDisagrees = (line: string) => line.startsWith("对不上") || line.startsWith("缺")

/**
 * What is known about the effects one ability shows, in sentences. Per effect event: `when` it appears against
 * the end of getting ready and against its hit, and when it is gone; `where` it lies against where that hit
 * lands (null when nothing can be measured); `aim` (J2) whether it still lies there when the target stands
 * higher or lower, said only for a hit that aims at the target or is kept level (`tall`: the creature's own
 * height in blocks, null when its model is not known here). `alive` is said only when more exist at once than
 * may. A sentence that starts with 「对不上」 or 「缺」 is a finding; the rest are facts.
 * `dive` (`diveFrame`): the ability is a dive that brings a bone to the target, so every effect is measured against the hit where the game lands it, with the creature
 * at its target. Then what the target's height does to an aimed hit (`aim`) is not said: the dive brings the hit onto the target itself, so there is no tilt to come apart.
 */
export function abilityEffectFacts(ability: Ability, lookup: EffectLookup, tall: number | null = null, dive: DiveFrame | null = null) {
  const plans = abilityEffectPlan(ability, lookup)
  const alive = effectsAlive(plans)
  return {
    events: plans.map((plan) => {
      const event = ability.events[plan.index] as EffectEvent
      const found = lookup(event.effect)
      if (!found) return { index: plan.index, when: `缺：招式「${ability.name}」第 ${moment(plan.tick)} 秒要出现的效果在工程里找不到（${event.effect}）。`, where: null, aim: null }
      const hit = ability.hits[plan.hit.index]!
      const at = effectAtHit(ability, event, found, hit.type === "area" ? hit.shape : null, null, dive ? { frame: dive, hit: plan.hit.index } : null)
      const named = `效果「${found.title}」${plan.count > 1 ? `（${plan.count} 个，${event.layout === "ring" ? `围成半径 ${num(event.spread)} 格的一圈` : `排成 ${num(event.spread)} 格长的一排`}）` : ""}`
      const outside = at ? Math.max(0, ...at.middles) : 0
      return {
        index: plan.index,
        when: `${named}在第 ${moment(plan.tick)} 秒出现：${gap(plan.tick - plan.windup, "比蓄力结束早", "比蓄力结束晚", "正好是蓄力结束的那一刻")}，${gap(plan.tick - plan.hit.tick, `比第 ${moment(plan.hit.tick)} 秒的出手早`, `比第 ${moment(plan.hit.tick)} 秒的出手晚`, `和第 ${moment(plan.hit.tick)} 秒的出手同时`)}${plan.tick < plan.hit.tick ? "（玩家有这么长时间先看到它）" : ""}；第 ${moment(plan.gone!)} 秒消失${plan.gone! > plan.length ? `，招式结束以后还留 ${moment(plan.gone! - plan.length)} 秒` : ""}。${plan.ends_with_owner ? "招式被打断或者它自己死了，效果立刻消失。" : "招式被打断它也照样留到时间结束。"}`,
        where: !at
          ? null
          : event.where === "hit" && outside > EFFECT_ZONE_TOLERANCE + 1e-9
            ? `对不上：${named}是放在第 ${plan.hit.index + 1} 次出手打到的地方的，可是${at.middles.length > 1 ? `其中 ${at.middles.filter((value) => value > EFFECT_ZONE_TOLERANCE).length} 个的` : "它的"}中心在判定范围外面 ${num(outside)} 格（超过 ${EFFECT_ZONE_TOLERANCE} 格，玩家照着效果站就会站错）。把它的位置（forward、up、left、spread）改到范围里，或者把判定范围改到效果标出来的地方。`
            : hit.type === "area"
              ? `${named}最完整的时候（出现后 ${num(at.peak)} 秒）整体宽约 ${at.wide} 格、最远到身前 ${at.far} 格；${outside === 0 ? "中心都在" : "中心离"}第 ${plan.hit.index + 1} 次出手的判定范围${outside === 0 ? "里" : ` ${num(outside)} 格`}。`
              : `${named}最完整的时候（出现后 ${num(at.peak)} 秒）整体宽约 ${at.wide} 格、最远到身前 ${at.far} 格。`,
        aim: dive ? null : aimWords(ability, event, plan.hit.index, found, named, tall),
      }
    }),
    alive: alive > EFFECT_LIMITS.alive ? `对不上：招式「${ability.name}」同一时间最多会有 ${alive} 个效果，一只生物身边最多同时有 ${EFFECT_LIMITS.alive} 个，多出来的不会出现。减少个数（count），或者让效果消失得早一些。` : null,
  }
}

/** How far something is tilted, as a player would say it. */
const tiltWords = (angle: number) => (Math.abs(angle) < 0.05 ? "是平的" : `往${angle > 0 ? "上" : "下"}斜 ${num(Math.abs(angle), 1)}°`)

/**
 * J2: one effect event against a hit that points somewhere, when the target does not stand level with it: which
 * of the two ways applies (the hit is kept level; or it aims at the target, and the effect either goes along
 * that aim or stays level), and what was measured at the places of `aimStands`. Null for a hit with no direction.
 */
function aimWords(ability: Ability, event: EffectEvent, index: number, found: { title: string; document: EffectDocument }, named: string, tall: number | null) {
  const hit = ability.hits[index]!
  const nth = `第 ${index + 1} 次出手`
  if (hit.type === "area" && (hit.shape.type === "line" || hit.shape.type === "cone") && hit.shape.aim === "level") return `${nth}写的是水平打出去（aim: level）：判定和${named}都按它自己水平的方向摆，目标站得高或者低，两样都不倾斜，看到的和打到的是同一个地方。`
  if (hit.type === "area" && shapeAims(hit.shape) && found.document.play.on_ground) return `${nth}是朝目标瞄的，目标站得高或者低它会跟着倾斜；${named}是贴地的效果，位置算出来以后落到脚下的地面上，本身不倾斜，也不跟着判定升高或者降低。`
  const measured = effectAimGap(ability, event, index, found, tall)
  if (!measured) return null
  const stood = measured.stands.map((stand) => `目标${stand.words}时判定${tiltWords(stand.tilt)}，效果离判定范围最远 ${num(stand.gap)} 格`).join("；")
  const flat = found.document.play.facing === "camera" ? "（它是一直对着玩家的效果：位置顺着瞄的方向算，本身不倾斜）" : ""
  if (measured.frame === "aim") return `${nth}是朝目标瞄的，目标站得高或者低它会跟着倾斜；${named}是顺着这个方向摆的（${event.along === "aim" ? "along 写的是 aim" : "放在这次出手打到的地方，默认就顺着它瞄的方向"}），位置和朝向跟着一起倾斜${flat}：${stood}。`
  const how = `${named}是按生物自己水平的方向摆的（${event.along === "facing" ? "along 写的是 facing" : "没有写 along"}），不会倾斜`
  if (!measured.disagrees) return `${nth}是朝目标瞄的，目标站得高或者低它会跟着倾斜；${how}：${stood}。`
  return `对不上：${nth}是朝目标瞄的，目标站得高或者低它会跟着倾斜，可是${how}——目标${measured.worst.words}的时候判定${tiltWords(measured.worst.tilt)}，效果还留在水平的位置上，离判定范围 ${num(measured.worst.gap)} 格（超过 ${EFFECT_ZONE_TOLERANCE} 格：玩家看到的路线和实际挨打的路线不是同一条；平地上它们是重合的，所以别的图上看不出来）。让效果顺着这次出手瞄的方向摆：在这个效果事件里写 along:"aim"、hit:${index}；或者让判定也保持水平：把这次出手的 shape 写上 aim:"level"。`
}

/** The same as one list of sentences. */
export const abilityEffectLines = (ability: Ability, lookup: EffectLookup, tall: number | null = null, dive: DiveFrame | null = null) => ((facts) => [...facts.events.flatMap((event) => [event.when, ...(event.where ? [event.where] : []), ...(event.aim ? [event.aim] : [])]), ...(facts.alive ? [facts.alive] : [])])(abilityEffectFacts(ability, lookup, tall, dive))

/**
 * What is wrong with the effects a creature's abilities show, by rule, in the shape every ability finding has. `effect_missing` is one the build refuses.
 * `design`: the creature's model, when it is known here; a dive whose first hit counts from one of its bones is then measured where it strikes (`diveFrame`), as the looks do.
 */
export function abilityEffectIssues(creature: { name: string; abilities?: readonly Ability[] | null }, lookup: EffectLookup, tall: number | null = null, design: Pick<ModelDesign, "bones" | "animations"> | null = null) {
  return (creature.abilities ?? []).flatMap((ability) =>
    abilityEffectFindings(ability, lookup, abilityEffectFacts(ability, lookup, tall, design ? diveFrame(ability, design) : null))
      .map((issue) => ({ ...issue, text: `「${creature.name}」${issue.text.replace(/^(?:对不上|缺)：/, "")}` })),
  )
}

export function abilityEffectFindings(ability: Ability, lookup: EffectLookup, facts: ReturnType<typeof abilityEffectFacts>) {
  const move = abilityRef(ability)
  const issue = (text: string, refs = [move]) => {
    const rule = text.startsWith("缺") ? ("effect_missing" as const) : text.includes("同一时间") ? ("effect_alive" as const) : ("effect_zone" as const)
    return { ability: ability.id, refs, rule, stops: rule === "effect_missing", text, fix: "", detail: `ability ${ability.id}: ${rule}` }
  }
  return [
    ...facts.events.flatMap(({ index, when, where, aim }) => {
      const event = ability.events[index] as EffectEvent
      return [when, where, aim].flatMap((text) => text && effectDisagrees(text) ? [issue(text, [move, assetRef(event.effect, lookup(event.effect)?.title)])] : [])
    }),
    ...(facts.alive ? [issue(facts.alive)] : []),
  ]
}

/** 「第 0.45 秒在出手打到的地方出现效果「…」×8」: one event for a card or a binding list. */
export const effectEventWords = (event: EffectEvent, title: string | null) =>
  `第 ${num(event.at)} 秒在${event.where === "self" ? "自己脚下" : event.where === "target" ? "目标脚下" : `第 ${(event.hit ?? 0) + 1} 次出手打到的地方`}出现效果${title ? `「${title}」` : "（工程里找不到）"}${event.count > 1 ? ` ×${event.count}` : ""}${event.size === undefined || event.size === 1 ? "" : `（画成原大小的 ${num(event.size)} 倍）`}`

// ---- which effects are there at one moment of an ability ----

/** Every cube corner of one effect `age` seconds after it appeared, put at one of its places (viewport space, model pixels). Empty when it has no such motion. */
export function effectCorners(document: Pick<EffectDocument, "bones" | "animations" | "play">, place: EffectPlace, age: number): Vec[] {
  const clip = document.animations.find((animation) => animation.name === document.play.clip)
  return clip ? posedCorners(document, clip, effectMoment(clip, age)).map((point) => placedPoint(point, place)) : []
}

/**
 * The effects of one ability that exist `seconds` after it started, when it runs to its end: each with where
 * it stands and how long it has been there. An effect that lies on the ground is put at the height of the creature's feet.
 * `stand` (J2): the target stands there, so effects laid out along an aim are tilted with it.
 * `dive`: the creature is brought to its target (`diveFrame`); an effect put in its own terms that appeared on or after the tick it arrived stands where it was then.
 */
export function effectsShown(ability: Ability, lookup: EffectLookup, seconds: number, stand: Stand | null = null, dive: DiveFrame | null = null) {
  const tick = Math.round(seconds * TICKS)
  return abilityEffectPlan(ability, lookup).flatMap((plan) => {
    const found = lookup(plan.effect)
    if (!found || plan.gone === null || tick < plan.tick || tick >= plan.gone) return []
    return effectPlaces(ability, ability.events[plan.index] as EffectEvent, found.document.play.facing, assumedTarget(ability), stand, dive && diveArrived(dive, plan.tick) ? dive.shift : null).map((place) => ({ event: plan.index, title: found.title, document: found.document, place: found.document.play.on_ground ? grounded(place) : place, age: (tick - plan.tick) / TICKS }))
  })
}
export type EffectShown = ReturnType<typeof effectsShown>[number]

// ---- the creature and its effects as one model at one moment ----

type Bone = ModelDesign["bones"][number]

/**
 * One effect standing where an ability puts it, as a model document of its own and the place to draw it at: `design` is the effect's own model with its bones
 * as they are written (the coordinates are the effect's own, small, around its own origin), frozen in the pose it has `age` seconds after it appeared and turned,
 * tilted and spun by the three turns of its place about that origin, and `offset` is where that origin lies (viewport space, model pixels, the same space as `placedPoint`)
 * for a picture to move the whole model by. So an effect never has to fit inside another model's document: not its 16 blocks around the middle, not its tier's bones and
 * cubes, not its atlas; it is held to the effect's own limits (`EFFECT_LIMITS`), which its document already was. The turning bones come after the effect's own, so the
 * effect's bones keep their positions in the list and anything compiled from the effect alone (its faces, its texture) still fits this model.
 */
export function stagedEffect(entry: { document: EffectDocument; place: EffectPlace; age: number }) {
  const { document, place } = entry
  const taken = new Set(document.bones.map((bone) => bone.name))
  const fresh = (base: string) => {
    const name = [base, ...Array.from({ length: 99 }, (_, index) => `${base}${index}`)].find((value) => !taken.has(value))!
    taken.add(name)
    return name
  }
  // The three turns are made one inside the other, as `placedPoint` makes them: the turn it stands at, the tilt (J2), its own turn. Only a tilted one needs the two inner ones.
  const tilted = place.pitch !== 0 || place.spin !== 0
  const outer = fresh("stage")
  const tilt = tilted ? fresh("stage_tilt") : outer
  const inner = tilted ? fresh("stage_spin") : outer
  const origin: Vec = [0, 0, 0]
  // A bone's angle about Y turns its front toward the model's own right, so a turn toward the left is written negative; about X, the angle that raises its front (-Z) is negative.
  const turns: Bone[] = [
    { name: outer, parent: null, pivot: origin, rotation: [0, -place.turn, 0], cubes: [] },
    ...(tilted
      ? ([
          { name: tilt, parent: outer, pivot: origin, rotation: [-place.pitch, 0, 0], cubes: [] },
          { name: inner, parent: tilt, pivot: origin, rotation: [0, -place.spin, 0], cubes: [] },
        ] satisfies Bone[])
      : []),
  ]
  const played = document.animations.find((animation) => animation.name === document.play.clip)
  const channels = played
    ? document.bones.flatMap((bone) => {
        const sample = sampleBone(played, bone.name, effectMoment(played, entry.age))
        return sample ? [{ bone: bone.name, keyframes: [{ time: 0, rotation: sample.rotation }], position: [{ time: 0, position: sample.position }], scale: [{ time: 0, scale: sample.scale.map((value) => Math.max(0, value)) as Vec }] }] : []
      })
    : []
  // r29c: one shown at a size of its own is scaled as a whole about its origin, as `placedPoint` puts its corners.
  const size = place.size ?? 1
  if (size !== 1) channels.push({ bone: outer, keyframes: [{ time: 0, rotation: [0, 0, 0] }], position: [{ time: 0, position: [0, 0, 0] }], scale: [{ time: 0, scale: [size, size, size] }] })
  return {
    offset: abilityPlace(place.forward, place.up, place.left),
    design: {
      ...effectModel(document),
      bones: [...document.bones.map((bone) => (bone.parent === null ? { ...bone, parent: inner } : bone)), ...turns],
      // One pose, held: the clip is named as the effect names its own, and a model with one motion plays it whatever else is asked for.
      animations: [{ name: document.play.clip, length: 1, loop: false, channels }],
    } as ModelDesign,
  }
}

/**
 * A creature's model with effects standing where an ability puts them, as one model document that can be
 * drawn like any other. `clip` at `time` poses the creature; every effect is frozen in the pose it has
 * `age` seconds after it appeared. A model document holds only as many bones and cubes as its geometry tier
 * allows (the creature's own) and reaches 16 blocks from its middle, so effects are added while they fit:
 * `drawn` says how many of `shown` made it. The looks no longer use it for exactly that reason (an effect far out, or on a creature
 * that fills its tier, was not drawn at all): they draw each effect as a model of its own (`stagedEffect`). This one stays for whoever
 * needs the creature and its effects as a single document.
 */
export function stagedDesign(creature: ModelDesign, clip: string, shown: readonly { document: EffectDocument; place: EffectPlace; age: number }[]) {
  const taken = new Set(creature.bones.map((bone) => bone.name))
  const fresh = (base: string) => {
    const name = [base, ...Array.from({ length: 99 }, (_, index) => `${base}${index}`)].find((value) => !taken.has(value))!
    taken.add(name)
    return name
  }
  const stage = fresh("stage")
  const motion = creature.animations.find((animation) => animation.name === clip)
  const room = tierOf(creature.budget)
  const fits = (value: number) => Math.abs(value) <= 256
  const built = shown.reduce(
    (made, entry, order) => {
      const played = entry.document.animations.find((animation) => animation.name === entry.document.play.clip)
      // The document's own axes: its front is -Z and its own left is +X.
      const at: Vec = [entry.place.left * BLOCK, entry.place.up * BLOCK, -entry.place.forward * BLOCK]
      const holder = fresh(`fx${order}`)
      const names = new Map(entry.document.bones.map((bone, index) => [bone.name, fresh(`fx${order}b${index}`)]))
      // J2: one that is tilted hangs from two more bones, so the three turns are made one inside the other: the turn it stands at, the tilt, its own turn.
      // A bone's angle about X that raises its front (-Z) is written negative; a test holds the staged model to the arithmetic of `placedPoint`.
      const tilted = entry.place.pitch !== 0 || entry.place.spin !== 0
      const inner = tilted ? fresh(`fx${order}s`) : holder
      const bones: Bone[] = [
        // A bone's angle about Y turns its front toward the model's own right, so a turn toward the left is written negative.
        { name: holder, parent: stage, pivot: at, rotation: [0, -entry.place.turn, 0], cubes: [] },
        ...(tilted
          ? (((tilt) => [
              { name: tilt, parent: holder, pivot: at, rotation: [-entry.place.pitch, 0, 0] as Vec, cubes: [] },
              { name: inner, parent: tilt, pivot: at, rotation: [0, -entry.place.spin, 0] as Vec, cubes: [] },
            ])(fresh(`fx${order}p`)) satisfies Bone[])
          : []),
        ...entry.document.bones.map((bone) => ({
          ...bone,
          name: names.get(bone.name)!,
          parent: bone.parent === null ? inner : (names.get(bone.parent) ?? inner),
          pivot: bone.pivot.map((value, axis) => value + at[axis]!) as Vec,
          cubes: bone.cubes.map((cube) => ({ ...cube, origin: cube.origin.map((value, axis) => value + at[axis]!) as Vec })),
        })),
      ]
      const whole = bones.every((bone) => bone.pivot.every(fits) && bone.cubes.every((cube) => cube.origin.every((value, axis) => fits(value) && value + cube.size[axis]! <= 256)))
      const cubes = bones.reduce((sum, bone) => sum + bone.cubes.length, 0)
      if (!whole || made.bones.length + bones.length > room.bones || made.cubes + cubes > room.cubes) return made
      const channels = played
        ? entry.document.bones.flatMap((bone) => {
            const sample = sampleBone(played, bone.name, effectMoment(played, entry.age))
            return sample ? [{ bone: names.get(bone.name)!, keyframes: [{ time: 0, rotation: sample.rotation }], position: [{ time: 0, position: sample.position }], scale: [{ time: 0, scale: sample.scale.map((value) => Math.max(0, value)) as Vec }] }] : []
          })
        : []
      return { bones: [...made.bones, ...bones], channels: [...made.channels, ...channels], cubes: made.cubes + cubes, drawn: made.drawn + 1 }
    },
    { bones: [{ name: stage, parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [] }, ...creature.bones.map((bone) => (bone.parent === null ? { ...bone, parent: stage } : bone))] as Bone[], channels: [] as ModelDesign["animations"][number]["channels"], cubes: creature.bones.reduce((sum, bone) => sum + bone.cubes.length, 0), drawn: 0 },
  )
  return {
    drawn: built.drawn,
    design: {
      ...creature,
      bones: built.bones,
      animations: creature.animations.map((animation) => (animation.name === clip ? { ...animation, channels: [...(motion?.channels ?? []), ...built.channels] } : animation)),
    } as ModelDesign,
  }
}

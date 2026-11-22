import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { boneRef, clipRef, partRef } from "./finding-refs"
import { HITBOX_FAULT_MARK, motionLabel } from "@minemods/studio-ai/making"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { posedCorners, type MotionClip } from "@minemods/studio-ai/model-motion"
import { TICKS } from "./ability-words"
import { abilityPlace } from "./creature-abilities"
import { HITBOX_LIMITS, type Ability, type Flight, type Hitbox } from "./entity-runtime"
import { bonedParts, followedPlace, followMoments } from "./hitbox-follow"
import { flightMotions } from "./flight-words"
import { modelBounds } from "./model-bounds"
import { HITBOX_COMBAT_INSTRUCTIONS } from "./hitbox-combat"

/**
 * A creature's collision boxes (碰撞箱) against its model: the boxes a document gives (or the one box every
 * creature had before documents could say), how well they hold the model, measured, and all of it in plain
 * words. The game knows one upright box with a square footprint for a creature, so a long body in one box
 * gets a square as wide as it is long; further boxes (`parts`) are separate things the generated mod keeps
 * beside it. Nothing here knows a subject: whether a creature needs parts is read off the numbers below.
 * No Node APIs: the app's window reads it too.
 */

type Vec = [number, number, number]
type Design = Pick<ModelDesign, "bones" | "animations">
const BLOCK = 16
const num = (value: number, digits = 2) => Number(value.toFixed(digits))

/**
 * When a box does not fit, in blocks. The two distances are the game's own spread (the owner's rule of 2026-10-14, "gates should not be too strict, no obvious error is
 * enough": a threshold that the game's own creatures fail is too strict): measured on 25 of the 1.21.1 creatures standing as built, each in the box it really has
 * (`test/vanilla-shapes.ts`, read off the client's own classes and `EntityType`; the same measures this file takes).
 * - `air`: how far a box may stand clear of the body inside it, on a side, at an end or above. Across the 25 the most any of them stands clear is 0.71 of a block
 *   (the turtle's wide, low box round its shell), then 0.56 (the llama above its neck), and the middle half stands clear by 0.11 to 0.26: so three quarters of a block, the
 *   largest rounded up to the next quarter. The first value this had, half a block (the smallest step of the game's own world, a slab), failed the turtle and the llama.
 * - `out`: how far the model may reach out of every box. Across the 25 the most any reaches is 0.95 (the fox's tail), then 0.78 (the hoglin's head) and 0.73 (the camel's
 *   neck); the middle half reach 0.24 to 0.44: so one block, the largest rounded up to the next quarter. Half a block failed 7 of the 25 (the fox, llama, panda, hoglin, ravager, camel and turtle).
 * - `trim`: the share of the model's volume, on the far end of any one measure, that a box is not fitted to: a
 *   whisker, a fin's edge, a tail's tip. Without it one thin part would count as the body filling its box.
 * - `reach`: how far a player reaches a creature from (`PLAYER_ENTITY_INTERACTION_RANGE`), 3 blocks; the scale the distances above are read at, not a measure.
 * - `overlap`: the share of a part's own box, standing as built, that lies inside the core. A part is a box of its own (an entity the game keeps) only to hold what the core
 *   does not; one more than half inside it adds a sliver at most, and most likely was put in the wrong place (`up` counted from the core's top, `left` read as right).
 * How much of a box is empty (`rest.empty`) has no threshold on purpose: it is a fact about the shape. The 25 creatures in their own boxes run from 17% to 94% empty and the
 * middle half from 48% to 68%, because one upright box with a square footprint cannot be full round a body that is not square; no size of box brings it down for a head, wings or
 * a tail that stand out. A box no wider than twice `air` can never stand clear by more than `air`, so a small creature with one box
 * passes whatever its shape; a long or large one passes only when its boxes follow its body.
 */
export const HITBOX_FIT = { air: 0.75, out: 1, trim: 0.02, reach: 3, overlap: 0.5 } as const

/**
 * The names a finding has in `hitbox.justified`: a box that stands clear of the body, model outside every box, and a part mostly inside the core. A part that names a bone
 * the model does not have (`bone`) is a finding too, one that cannot be said to be meant: the name is wrong, or the bone is missing.
 */
export const HITBOX_FAULTS = ["air", "out", "overlap", "bone"] as const
export type HitboxFault = (typeof HITBOX_FAULTS)[number]
export { HITBOX_FAULT_MARK }

/** One box in the model's own space (the viewport's: model pixels, front is -Z, the creature's own left is -X). */
export type HitboxBox = { name: string; core: boolean; min: Vec; max: Vec; bone: string | null; solid?: true; blocker?: true; damageScale?: number; phaseScales?: { phase: number; damage_scale: number }[] }

/** Colours and labels used by the look's renderer. The diagram shows the initial phase and lists every phase override. */
export function hitboxAppearance(box: Pick<HitboxBox, "core" | "damageScale" | "solid">) {
  if (box.core) return { fill: "#3d7bff", stroke: box.solid ? "rgb(0, 157, 117)" : "rgb(18, 64, 214)" }
  const stroke = box.solid ? "rgb(0, 157, 117)" : null
  if ((box.damageScale ?? 1) > 1) return { fill: "#ef476f", stroke: stroke ?? "rgb(176, 20, 62)" }
  if ((box.damageScale ?? 1) < 1) return { fill: "#8499ad", stroke: stroke ?? "rgb(59, 78, 99)" }
  return box.solid ? { fill: "#58c9a3", stroke: stroke! } : { fill: "#ff9a1f", stroke: "rgb(214, 108, 0)" }
}

/** The one box every creature had before a document could say: square, as wide as the model's longest reach from its middle, as tall as the model. Blocks. */
export function legacyCore(design: Pick<ModelDesign, "bones">) {
  const bounds = modelBounds(design as ModelDesign)
  return { width: bounds.width, height: bounds.height }
}

/** The boxes of a creature in the model's space: the core first. Without a `hitbox` the one box it always had. */
export function hitboxBoxes(hitbox: Hitbox | null | undefined, design: Pick<ModelDesign, "bones">): HitboxBox[] {
  const core = hitbox?.core ?? legacyCore(design)
  const box = (name: string, forward: number, up: number, left: number, width: number, height: number, bone: string | null, isCore: boolean): HitboxBox => ({
    name,
    core: isCore,
    bone,
    min: [(-left - width / 2) * BLOCK, up * BLOCK, (-forward - width / 2) * BLOCK],
    max: [(-left + width / 2) * BLOCK, (up + height) * BLOCK, (-forward + width / 2) * BLOCK],
  })
  return [{ ...box("身体", 0, 0, 0, core.width, core.height, null, true), ...(hitbox?.core.solid ? { solid: true as const } : {}) }, ...(hitbox?.parts ?? []).map((part) => ({ ...box(part.name, part.forward, part.up, part.left, part.width, part.height, part.bone ?? null, false), ...(part.solid ? { solid: true as const } : {}), ...(part.damage_scale !== undefined || part.phase_scales !== undefined ? { damageScale: part.phase_scales?.find((entry) => entry.phase === 0)?.damage_scale ?? part.damage_scale ?? 1, phaseScales: part.phase_scales } : {}) })),
    ...(hitbox?.blockers ?? []).map(part => ({ ...box(part.name, part.forward, part.up, part.left, part.width, part.height, null, false), solid: true as const, blocker: true as const })),
  ]
}

/**
 * The boxes as they stand at `time` seconds of `clip` (null: as built): a part that follows a bone the model has (`hitbox-follow.ts`) is moved by how far that bone has gone,
 * unrounded; every other box stands as stated. What the game does while it stands, walks or plays an ability; a picture of that moment draws these.
 */
export function hitboxBoxesAt(hitbox: Hitbox | null | undefined, design: Pick<ModelDesign, "bones">, clip: MotionClip | null, time: number): HitboxBox[] {
  const boxes = hitboxBoxes(hitbox, design)
  if (!clip) return boxes
  return boxes.map((box, index) => {
    if (box.core || box.blocker) return box
    const moved = followedPlace(hitbox, design, index - 1, clip, time)
    const shift = abilityPlace(moved.forward, moved.up, moved.left)
    return { ...box, min: box.min.map((value, axis) => value + shift[axis]!) as Vec, max: box.max.map((value, axis) => value + shift[axis]!) as Vec }
  })
}

/** How much of a part's box lies inside the core's: a share of its own volume. */
const insideCore = (core: HitboxBox, part: HitboxBox) =>
  [0, 1, 2].reduce((volume, axis) => volume * Math.max(0, Math.min(core.max[axis]!, part.max[axis]!) - Math.max(core.min[axis]!, part.min[axis]!)), 1) /
  Math.max(1e-9, [0, 1, 2].reduce((volume, axis) => volume * (part.max[axis]! - part.min[axis]!), 1))

/** How many of its abilities, the most often chosen first (by `start.weight`), the boxes of parts that follow a bone are drawn in, beside standing and walking. */
export const FOLLOW_ABILITIES_DRAWN = 1

/**
 * K1 任务二: the moments a picture shows the boxes of parts that follow a bone at, three for each of the most used motions: standing, walking and the abilities chosen most
 * (`FOLLOW_ABILITIES_DRAWN`). For a motion that goes round: the moment its followers are furthest from where they stand as built, and a third of the motion before and after it;
 * for one played once: its start, that moment and its end. Empty when no part follows a bone the model has, or none of these motions moves one.
 */
export function followKeyFrames(hitbox: Hitbox | null | undefined, design: Design, abilities: readonly Pick<Ability, "clip" | "start">[] = []) {
  const boned = bonedParts(hitbox, design)
  if (!boned.length) return []
  const chosen = [...abilities].sort((a, b) => b.start.weight - a.start.weight).slice(0, FOLLOW_ABILITIES_DRAWN).map((ability) => ability.clip)
  return [...new Set(["idle", "walk", ...chosen])].flatMap((name) => {
    const clip = design.animations.find((animation) => animation.name === name) as MotionClip | undefined
    if (!clip) return []
    const away = (time: number) => boned.reduce((sum, part) => ((moved) => sum + Math.hypot(moved.forward, moved.up, moved.left))(followedPlace(hitbox, design, part.index, clip, time)), 0)
    const moments = followMoments(clip).map((time) => ({ time, away: away(time) }))
    const peak = moments.reduce((best, moment) => (moment.away > best.away + 1e-9 ? moment : best), moments[0]!)
    if (peak.away < 1 / BLOCK) return []
    const third = clip.length / 3
    const times = clip.loop
      ? [peak.time, (peak.time + third) % clip.length, (peak.time + 2 * third) % clip.length].sort((a, b) => a - b)
      : peak.time <= 1e-9 || peak.time >= clip.length - 1e-9
        ? [0, clip.length / 2, clip.length]
        : [0, peak.time, clip.length]
    return [{ clip: name, times: times.map((time) => num(time, 3)) }]
  })
}

/** A box as six flat faces, for a picture to draw through. */
export const boxFaces = (box: Pick<HitboxBox, "min" | "max">): Vec[][] => {
  const corner = (index: number): Vec => [index & 1 ? box.max[0] : box.min[0], index & 2 ? box.max[1] : box.min[1], index & 4 ? box.max[2] : box.min[2]]
  return [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]].map((face) => face.map(corner))
}

// How many points stand for one cube along one of its edges: one every two model pixels, a dozen at most.
const along = (length: number) => Math.min(12, Math.max(1, Math.ceil(length / 2)))
// A cube with no thickness (a fin drawn as a sheet) still is something a player sees: it counts as half a pixel thick.
const THIN = 0.5

type Sample = { at: Vec; weight: number; bone: string }

/** The model at one moment as weighted points: every cube filled evenly, each point carrying its share of the cube's volume. */
function samples(design: Pick<ModelDesign, "bones">, clip: MotionClip | null, time: number): Sample[] {
  const corners = posedCorners(design, clip, time)
  const cubes = design.bones.flatMap((bone) => bone.cubes.map((cube) => ({ bone: bone.name, size: cube.size })))
  return cubes.flatMap((cube, index) => {
    const base = corners[index * 8]!
    const edges = [1, 2, 4].map((bit) => corners[index * 8 + bit]!.map((value, axis) => value - base[axis]!) as Vec)
    const lengths = edges.map((edge) => Math.hypot(...edge))
    const counts = lengths.map(along)
    const weight = lengths.reduce((volume, length) => volume * Math.max(length, THIN), 1) / (counts[0]! * counts[1]! * counts[2]!)
    return Array.from({ length: counts[0]! * counts[1]! * counts[2]! }, (_, order): Sample => {
      const step = [order % counts[0]!, Math.floor(order / counts[0]!) % counts[1]!, Math.floor(order / (counts[0]! * counts[1]!))].map((value, axis) => (value + 0.5) / counts[axis]!)
      return { at: [0, 1, 2].map((axis) => base[axis]! + edges[0]![axis]! * step[0]! + edges[1]![axis]! * step[1]! + edges[2]![axis]! * step[2]!) as Vec, weight, bone: cube.bone }
    })
  })
}

/** The value below which `share` of the weight lies. */
function quantile(values: readonly { value: number; weight: number }[], share: number) {
  const sorted = [...values].sort((a, b) => a.value - b.value)
  const whole = sorted.reduce((sum, entry) => sum + entry.weight, 0)
  const reached = sorted.reduce<{ sum: number; value: number | null }>((found, entry) => (found.value !== null ? found : found.sum + entry.weight >= whole * share ? { sum: found.sum, value: entry.value } : { sum: found.sum + entry.weight, value: null }), { sum: 0, value: null })
  return reached.value ?? sorted.at(-1)?.value ?? 0
}

const inside = (box: HitboxBox, point: Vec) => point.every((value, axis) => value >= box.min[axis]! && value <= box.max[axis]!)
const gap = (box: HitboxBox, point: Vec) => Math.hypot(...point.map((value, axis) => Math.max(0, box.min[axis]! - value, value - box.max[axis]!)))

/** How much of the model is outside every box at one moment: the share of its volume, how far out all but a `trim` of it lies (blocks), and the part that carries most of what is outside. */
function uncovered(boxes: readonly HitboxBox[], points: readonly Sample[]) {
  const whole = points.reduce((sum, point) => sum + point.weight, 0)
  const out = points.filter((point) => !boxes.some((box) => inside(box, point.at)))
  const byBone = out.reduce<Record<string, number>>((found, point) => ({ ...found, [point.bone]: 0 }), {})
  out.forEach((point) => (byBone[point.bone]! += point.weight))
  return {
    share: whole ? out.reduce((sum, point) => sum + point.weight, 0) / whole : 0,
    far: quantile(points.map((point) => ({ value: boxes.some((box) => inside(box, point.at)) ? 0 : Math.min(...boxes.map((box) => gap(box, point.at))), weight: point.weight })), 1 - HITBOX_FIT.trim) / BLOCK,
    bone: Object.entries(byBone).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  }
}

/** The share of the boxes' own room (counted once where they overlap) that holds none of the model, on a grid of at most 48 cells a side. */
function emptiness(boxes: readonly HitboxBox[], points: readonly Sample[]) {
  const min = [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis]!)))
  const max = [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]!)))
  // A cell is no finer than the points that fill a cube lie apart (two model pixels), or a full box would read as half empty.
  const cell = Math.max(2, Math.max(...max.map((value, axis) => value - min[axis]!)) / 48)
  const counts = max.map((value, axis) => Math.max(1, Math.ceil((value - min[axis]!) / cell)))
  const key = (cells: number[]) => cells[0]! + counts[0]! * (cells[1]! + counts[1]! * cells[2]!)
  const filled = new Uint8Array(counts[0]! * counts[1]! * counts[2]!)
  points.forEach((point) => {
    const cells = point.at.map((value, axis) => Math.floor((value - min[axis]!) / cell))
    if (cells.every((value, axis) => value >= 0 && value < counts[axis]!)) filled[key(cells)] = 1
  })
  const tally = { room: 0, held: 0 }
  Array.from({ length: counts[2]! }, (_, z) =>
    Array.from({ length: counts[1]! }, (_, y) =>
      Array.from({ length: counts[0]! }, (_, x) => {
        if (!boxes.some((box) => inside(box, [x, y, z].map((value, axis) => min[axis]! + (value + 0.5) * cell) as Vec))) return
        tally.room += 1
        tally.held += filled[key([x, y, z])]!
      }),
    ),
  )
  return tally.room ? 1 - tally.held / tally.room : 0
}

/**
 * How far one box stands clear of the model inside it, in blocks, side by side: `side` to its left and right (the
 * wider of the two), `ends` to its front and back, `top` above, and for a part `bottom` below. Each is counted to
 * where all but a `trim` of what the box holds lies. Null when the box holds none of the model.
 */
function clearance(box: HitboxBox, points: readonly Sample[]) {
  const held = points.filter((point) => inside(box, point.at))
  if (!held.length) return null
  const edge = (axis: number) => {
    const values = held.map((point) => ({ value: point.at[axis]!, weight: point.weight }))
    return { low: Math.max(0, quantile(values, HITBOX_FIT.trim) - box.min[axis]!) / BLOCK, high: Math.max(0, box.max[axis]! - quantile(values, 1 - HITBOX_FIT.trim)) / BLOCK }
  }
  return { side: Math.max(edge(0).low, edge(0).high), ends: Math.max(edge(2).low, edge(2).high), top: edge(1).high, bottom: box.core ? 0 : edge(1).low }
}

/**
 * The core a model's own shape suggests, in blocks: a square, on the sixteenth of a block the game's own sizes come in, that the check accepts standing as built, and the one that takes
 * the same share of both allowances. A wider square leaves less of the model out of it and stands further clear of the body, a narrower one the reverse, so between the narrow and
 * the long half of the model's reach there is one width at which what reaches out of the square (as a share of `out`) and how far it stands clear of what it holds (as a share
 * of `air`) are the same; that width is the suggestion when both are within their allowances. When no square is, the body is longer than one square can hold (or its parts reach
 * further than one can follow): the suggestion is the narrow one — never the long one — and what reaches out of it needs boxes of its own (`split`). The height is the top of what
 * stands over that square. Measured the same way as the check, so the check accepts what is suggested whatever the thresholds are.
 */
export function proposedCore(design: Pick<ModelDesign, "bones">) {
  const points = samples(design, null, 0)
  const reach = (axis: number) => quantile(points.map((point) => ({ value: Math.abs(point.at[axis]!), weight: point.weight })), 1 - HITBOX_FIT.trim) / BLOCK
  const narrow = Math.min(reach(0), reach(2))
  const long = Math.max(reach(0), reach(2))
  const sixteenth = (blocks: number) => Math.max(1, Math.min(HITBOX_LIMITS.size * BLOCK, Math.ceil(blocks * BLOCK - 1e-9)))
  const heightOf = (width: number) => {
    const over = points.filter((point) => Math.abs(point.at[0]) <= (width * BLOCK) / 2 && Math.abs(point.at[2]) <= (width * BLOCK) / 2)
    return Math.max(0.1, Math.min(HITBOX_LIMITS.size, Math.ceil(quantile((over.length ? over : points).map((point) => ({ value: point.at[1], weight: point.weight })), 1 - HITBOX_FIT.trim)) / BLOCK))
  }
  // A square of `step` sixteenths of a block, as shares of the two allowances.
  const taken = (step: number) => {
    const width = step / BLOCK
    const box = hitboxBoxes({ core: { width, height: heightOf(width) } }, design)[0]!
    const held = clearance(box, points)
    return { width, height: heightOf(width), out: uncovered([box], points).far / HITBOX_FIT.out, air: held ? Math.max(held.side, held.ends, held.top) / HITBOX_FIT.air : Number.POSITIVE_INFINITY }
  }
  // The squares from the narrow half's width to the long half's, both ends doubled as a width is a whole side: the first at which the share of `out` is no more than the share of `air`.
  const [from, to] = [sixteenth(narrow * 2), Math.max(sixteenth(narrow * 2), sixteenth(long * 2))]
  const first = (low: number, high: number): number => (low >= high ? low : taken(Math.floor((low + high) / 2)).out <= taken(Math.floor((low + high) / 2)).air ? first(low, Math.floor((low + high) / 2)) : first(Math.floor((low + high) / 2) + 1, high))
  const crossing = first(from, to)
  const best = [crossing - 1, crossing].filter((step) => step >= from).map(taken).sort((a, b) => Math.max(a.out, a.air) - Math.max(b.out, b.air))[0]!
  const split = Math.max(best.out, best.air) > 1 + 1e-9
  const chosen = split ? taken(from) : best
  return { width: num(chosen.width, 4), height: num(chosen.height, 4), split }
}

/** The motions the generated creature plays by itself while it stands and walks: where its boxes have to hold it. */
const MOVING = ["idle", "walk"] as const

/**
 * The motions a creature moves in that its boxes have to hold it in: standing and walking, and for a flier also the motions of the air it really plays
 * (`flightMotions`: taking off, landing, flying, and gliding or hovering). A flier spends its time in them, with its wings out; a box fitted to the pose it is built
 * in alone would leave the wings out of every box. A creature that does not fly has the same two it always had.
 */
const movingMotions = (flight: Flight | null | undefined): string[] => [...MOVING, ...(flight ? [...new Set(Object.values(flightMotions(flight)).filter((name): name is string => name !== null))] : [])]

/**
 * How a creature's boxes hold its model, measured from the two documents alone.
 * - `boxes`: the boxes measured, the core first; `stated`: the document gave them (false: the one box it always had);
 * - `rest`: standing as built — `outside`: the share of the model's volume outside every box, `far`: how far out it
 *   reaches (blocks), `bone`: the part that carries most of what is outside; `empty`: the share of the boxes' room that holds no model;
 * - `clear`: for every box, how far it stands clear of what it holds (null: it holds nothing);
 * - `moving`: the moment of standing or walking (and for a flier, of its flying motions) at which most reaches furthest out, measured the same way (null: no such motion moves anything out);
 * - `proposed`: the core the model's shape suggests;
 * - `faults`: the measures past `HITBOX_FIT`, each with whether the document says it is meant.
 */
export function hitboxFit(hitbox: Hitbox | null | undefined, design: Design, flight: Flight | null | undefined = null) {
  const drawn = hitboxBoxes(hitbox, design)
  const boxes = drawn.filter(box => !box.blocker)
  const still = samples(design, null, 0)
  const rest = uncovered(boxes, still)
  const clear = boxes.map((box) => ({ name: box.name, core: box.core, clear: clearance(box, still) }))
  const moments = movingMotions(flight).flatMap((name) => {
    const clip = design.animations.find((animation) => animation.name === name) as MotionClip | undefined
    if (!clip) return []
    // Every other server tick of the motion, twenty moments at most.
    const ticks = Math.max(1, Math.floor(clip.length * TICKS))
    const step = Math.max(2, Math.ceil(ticks / 20))
    return Array.from({ length: Math.floor(ticks / step) + 1 }, (_, index) => ({ clip, time: (index * step) / TICKS }))
  })
  // Standing and walking carry the parts that follow a bone (the game moves them so); the motions of the air do not.
  const held = (clip: MotionClip, time: number) => ((MOVING as readonly string[]).includes(clip.name) ? hitboxBoxesAt(hitbox, design, clip, time).filter(box => !box.blocker) : boxes)
  const worst = moments.map((moment) => ({ clip: moment.clip.name, time: moment.time, ...uncovered(held(moment.clip, moment.time), samples(design, moment.clip, moment.time)) })).reduce<{ clip: string; time: number; share: number; far: number; bone: string | null } | null>((best, found) => (!best || found.far > best.far + 1e-9 || (Math.abs(found.far - best.far) <= 1e-9 && found.share > best.share) ? found : best), null)
  const moving = worst && (worst.far > rest.far + 0.04 || worst.share > rest.share + 0.02) ? { clip: worst.clip, time: num(worst.time), outside: num(worst.share, 3), far: num(worst.far), bone: worst.bone } : null
  const reason = (what: HitboxFault) => hitbox?.justified?.find((entry) => entry.what.trim().toLowerCase().replace(/^hitbox[:：]/, "") === what)?.reason ?? null
  const wide = clear.flatMap((entry) => (entry.clear ? [{ name: entry.name, core: entry.core, most: Math.max(entry.clear.side, entry.clear.ends, entry.clear.top, entry.clear.bottom), ...entry.clear }] : [])).filter((entry) => entry.most > HITBOX_FIT.air + 1e-9)
  const far = Math.max(rest.far, moving?.far ?? 0)
  const parts = hitbox?.parts ?? []
  // A part that names a bone the model has follows it; one that names a bone it lacks stands as stated, which is not what its document meant.
  const missing = parts.filter((part) => part.bone && !design.bones.some((bone) => bone.name === part.bone)).map((part) => ({ name: part.name, bone: part.bone! }))
  const overlapping = boxes.slice(1).filter((box) => !box.solid).map((box) => ({ name: box.name, share: num(insideCore(boxes[0]!, box), 3) })).filter((entry) => entry.share > HITBOX_FIT.overlap + 1e-9)
  return {
    boxes: drawn,
    stated: Boolean(hitbox),
    flier: Boolean(flight),
    rest: { outside: num(rest.share, 3), far: num(rest.far), bone: rest.bone, empty: num(emptiness(boxes, still), 3) },
    clear: clear.map((entry) => ({ name: entry.name, core: entry.core, clear: entry.clear ? { side: num(entry.clear.side), ends: num(entry.clear.ends), top: num(entry.clear.top), bottom: num(entry.clear.bottom) } : null })),
    moving,
    proposed: proposedCore(design),
    /** How many parts it has, of the most it may (`HITBOX_LIMITS.parts`), and the names of those that follow a bone. */
    parts: { count: parts.length, most: HITBOX_LIMITS.parts, following: bonedParts(hitbox, design).map((part) => parts[part.index]!.name) },
    /** Parts that name a bone the model lacks; parts more than `HITBOX_FIT.overlap` inside the core (as a share of their own box). */
    missing,
    overlapping,
    faults: [
      ...(wide.length || clear.some((entry) => !entry.clear) ? [{ fault: "air" as const, reason: reason("air") }] : []),
      ...(far > HITBOX_FIT.out + 1e-9 ? [{ fault: "out" as const, reason: reason("out") }] : []),
      ...(overlapping.length ? [{ fault: "overlap" as const, reason: reason("overlap") }] : []),
      ...(missing.length ? [{ fault: "bone" as const, reason: null }] : []),
    ],
  }
}
export type HitboxFitted = ReturnType<typeof hitboxFit>

const percent = (share: number) => (share > 0 && share < 0.01 ? "不到 1%" : `${Math.round(share * 100)}%`)
const meant = (reason: string) => `（文档的 hitbox.justified 里写了本来就该这样：${reason}）`

/**
 * What was measured, in sentences: the facts first, then one sentence for every measure past its threshold. One
 * that the document does not say is meant starts with `HITBOX_FAULT_MARK` and has to be answered: change the core,
 * add or move parts, or say why in `hitbox.justified`.
 */
export function hitboxReport(fit: HitboxFitted) {
  const core = fit.boxes[0]!
  const size = (box: HitboxBox) => `宽 ${num((box.max[0] - box.min[0]) / BLOCK)} 格、高 ${num((box.max[1] - box.min[1]) / BLOCK)} 格`
  const parts = fit.boxes.slice(1).filter(box => !box.blocker)
  const blockers = fit.boxes.filter(box => box.blocker)
  const wide = fit.clear.flatMap((entry) => (entry.clear && Math.max(entry.clear.side, entry.clear.ends, entry.clear.top, entry.clear.bottom) > HITBOX_FIT.air + 1e-9 ? [{ ...entry, clear: entry.clear }] : []))
  const hollow = fit.clear.filter((entry) => !entry.clear)
  const air = fit.faults.find((found) => found.fault === "air")
  const out = fit.faults.find((found) => found.fault === "out")
  const suggestion = `按模型量出来的建议是 core {"width":${fit.proposed.width},"height":${fit.proposed.height}}${fit.proposed.split ? "，它的身体一头比另一头长出一大截，一个方箱子包不住，伸出去的部位要用 parts 另外加箱子" : ""}`
  const following = new Set(fit.parts.following)
  const solid = fit.boxes.filter((part) => part.solid)
  const overlap = fit.faults.find((found) => found.fault === "overlap")
  const farthest = fit.moving && fit.moving.far > fit.rest.far ? fit.moving : null
  const outsideBone = farthest ? farthest.bone : fit.rest.bone
  const findings: { rule: string; text: string; fix: string; refs: FindingRef[] }[] = []
  const note = (rule: string, fault: boolean, refs: FindingRef[], text: string) => {
    if (fault) findings.push({ rule, text, fix: "", refs })
    return text
  }
  const notes = [
    `碰撞箱：身体（core）宽 ${num((core.max[0] - core.min[0]) / BLOCK)} 格、高 ${num((core.max[1] - core.min[1]) / BLOCK)} 格${fit.stated ? "" : "——文档没有写 hitbox，这是老办法：按模型最长的一边定的一个方箱子"}${parts.length ? `；另有 ${parts.length} 个部位（最多 ${fit.parts.most} 个）：${parts.map((part) => `「${part.name}」${size(part)}${part.bone ? (following.has(part.name) ? `（跟着模型的 ${part.bone} 动）` : `（写的 bone 是 ${part.bone}，模型里没有，不跟着动）`) : ""}`).join("、")}` : "；没有分部位"}。游戏里身体这个箱子管走路、被推和卡进方块；部位的箱子${solid.length ? "都能" : "只管"}被打中和被右键，跟着身体的朝向转${fit.flier ? "，会飞的还跟着机身的俯仰和侧倾转（绕它身体箱子的中间）" : ""}；${following.size ? "写了 bone 的部位在它站着、走路和出招时还跟着那根骨骼动（构建时按每个动作每 2 刻量好骨骼的位置，服务端照着查），其他时候（醒来、换阶段、习性动作、在天上）停在写的位置" : "没写 bone 的部位不跟着动作动，停在写的位置"}。`,
    ...(blockers.length ? [`只挡路的部件有 ${blockers.length} 个：${blockers.map(box => `「${box.name}」`).join("、")}。这些箱子不接收攻击。`] : []),
    ...(solid.length ? [`青绿色边线是实心部位：${solid.map((part) => `「${part.name}」`).join("、")}。这些部位会挡住玩家和生物，也能站上去。部位移开时，站在上面的人会落下；被罩进身体时会被推出到有空的位置。`] : []),
    ...parts.flatMap((part) => part.damageScale === undefined ? [] : [`「${part.name}」初始伤害倍率 ${part.damageScale}×（${part.damageScale > 1 ? "红色弱点" : part.damageScale < 1 ? "灰蓝色硬甲" : "普通部位"}${part.damageScale === 0 ? "，完全格挡" : ""}）${part.phaseScales?.length ? `；阶段倍率：${part.phaseScales.map((entry) => `阶段 ${entry.phase} 为 ${entry.damage_scale}×`).join("、")}` : ""}。`]),
    `站着不动时，模型有 ${percent(fit.rest.outside)} 露在碰撞箱外面，打那里打不中${fit.rest.outside > 0 ? `（最远露出 ${fit.rest.far} 格${fit.rest.bone ? `，主要是「${fit.rest.bone}」` : ""}）` : ""}。`,
    `碰撞箱里有 ${percent(fit.rest.empty)} 是空的，空着的地方隔着空气也会被打到、被挡住。这些百分数和下面每个箱子多出的格数只是事实，不算不合身：方方的箱子和不方的身子总有对不上的地方，原版生物的箱子里多半有五成到七成是空的，也常有两三成的身子露在外面；合不合身只看以「${HITBOX_FAULT_MARK}」开头的句子（箱子空出超过 ${HITBOX_FIT.air} 格，或者模型露出超过 ${HITBOX_FIT.out} 格，才会有）。`,
    ...fit.clear.flatMap((entry) => (entry.clear ? [`「${entry.name}」的箱子比它里面的模型：左右最多多出 ${entry.clear.side} 格，前后最多多出 ${entry.clear.ends} 格，上面多出 ${entry.clear.top} 格${entry.core ? "" : `，下面多出 ${entry.clear.bottom} 格`}。`] : [])),
    ...(fit.moving ? [`动起来最差的一刻（${motionLabel(fit.moving.clip)}第 ${fit.moving.time} 秒）：模型有 ${percent(fit.moving.outside)} 露在碰撞箱外面，最远露出 ${fit.moving.far} 格${fit.moving.bone ? `，主要是「${fit.moving.bone}」` : ""}。`] : []),
    ...(air
      ? [
          note("hitbox_air", air.reason === null, [...wide, ...hollow].map(({ core, name }) => partRef(core ? "core" : name)), `${air.reason === null ? `${HITBOX_FAULT_MARK}：` : ""}${[...wide.map((entry) => `「${entry.name}」的箱子${[entry.clear.side > HITBOX_FIT.air ? `左右比模型多出 ${entry.clear.side} 格` : "", entry.clear.ends > HITBOX_FIT.air ? `前后多出 ${entry.clear.ends} 格` : "", entry.clear.top > HITBOX_FIT.air ? `上面多出 ${entry.clear.top} 格` : "", entry.clear.bottom > HITBOX_FIT.air ? `下面多出 ${entry.clear.bottom} 格` : ""].filter(Boolean).join("、")}`), ...hollow.map((entry) => `「${entry.name}」的箱子里一点模型都没有`)].join("；")}（空出来超过 ${HITBOX_FIT.air} 格，玩家隔着空气也打得到它，它也会被本来钻得过去的缺口挡住）。` +
            (air.reason === null ? `把箱子改到贴着身体（${suggestion}）；它本来就该这样的话，在文档的 hitbox.justified 里写 {"what":"air","reason":"……"}，理由会原样给评审和人看。` : meant(air.reason))),
        ]
      : []),
    ...(out
      ? [
          note("hitbox_out", out.reason === null, [...(outsideBone ? [boneRef(outsideBone)] : []), ...(farthest ? [clipRef(farthest.clip)] : []), partRef("core")], `${out.reason === null ? `${HITBOX_FAULT_MARK}：` : ""}模型最远有 ${Math.max(fit.rest.far, fit.moving?.far ?? 0)} 格露在所有碰撞箱外面${(fit.moving && fit.moving.far > fit.rest.far ? fit.moving.bone : fit.rest.bone) ? `（主要是「${fit.moving && fit.moving.far > fit.rest.far ? fit.moving.bone : fit.rest.bone}」${fit.moving && fit.moving.far > fit.rest.far ? `，在${motionLabel(fit.moving.clip)}第 ${fit.moving.time} 秒` : ""}）` : ""}（超过 ${HITBOX_FIT.out} 格，玩家对着那里打会打空）。` +
            (out.reason === null ? `用 parts 给露在外面的部位加箱子（最多 ${HITBOX_LIMITS.parts} 个），或者把 core 加大；它本来就该这样的话，在文档的 hitbox.justified 里写 {"what":"out","reason":"……"}，理由会原样给评审和人看。` : meant(out.reason))),
        ]
      : []),
    ...(overlap
      ? [
          note("hitbox_overlap", overlap.reason === null, [partRef("core"), ...fit.overlapping.map(({ name }) => partRef(name))], `${overlap.reason === null ? `${HITBOX_FAULT_MARK}：` : ""}${fit.overlapping.map((entry) => `「${entry.name}」的箱子有 ${percent(entry.share)} 在身体（core）的箱子里面`).join("；")}（超过 ${percent(HITBOX_FIT.overlap)}，这个部位几乎没有多罩住什么，多半是位置放错了：up 是从脚下算的，不是从 core 顶上；left 是它自己的左边）。` +
            (overlap.reason === null ? `把它挪到伸出 core 的那一截上，或者去掉这个部位；它本来就该这样的话，在文档的 hitbox.justified 里写 {"what":"overlap","reason":"……"}。` : meant(overlap.reason))),
        ]
      : []),
    ...(fit.missing.length
      ? [note("hitbox_bone", true, fit.missing.flatMap(({ name, bone }) => [partRef(name), boneRef(bone)]), `${HITBOX_FAULT_MARK}：${fit.missing.map((entry) => `部位「${entry.name}」写的 bone 是「${entry.bone}」`).join("、")}，模型里没有这根骨骼，这个箱子跟不了动作，只能停在写的位置。把 bone 改成模型里真有的骨骼名（names: true 的图上能看到每个部件的名字），或者去掉 bone。`)]
      : []),
  ]
  return { notes, findings }
}

export const hitboxLines = (fit: HitboxFitted) => hitboxReport(fit).notes

/**
 * The same in the few short lines a picture has room for: how much is outside and how much is empty; whether it
 * fits and by how much not; and the worst moment of standing or walking (empty when no motion moves anything further out).
 */
export function hitboxCaptions(fit: HitboxFitted) {
  const widest = fit.clear.flatMap((entry) => (entry.clear ? [{ name: entry.name, most: Math.max(entry.clear.side, entry.clear.ends, entry.clear.top, entry.clear.bottom) }] : [])).sort((a, b) => b.most - a.most)[0]
  const marked = (fault: HitboxFault) => (fit.faults.find((found) => found.fault === fault)?.reason === null ? `${HITBOX_FAULT_MARK}：` : "")
  const faulty = (fault: HitboxFault) => fit.faults.some((found) => found.fault === fault)
  return {
    shares: [`模型有 ${percent(fit.rest.outside)} 露在碰撞箱外面，打那里打不中`, `碰撞箱里有 ${percent(fit.rest.empty)} 是空的（事实，不算不合身）`],
    verdict: [
      ...(fit.clear.some((entry) => !entry.clear) ? [`${marked("air")}${fit.clear.filter((entry) => !entry.clear).map((entry) => `「${entry.name}」`).join("")}的箱子里没有模型`] : []),
      ...(widest ? [`${faulty("air") && widest.most > HITBOX_FIT.air ? marked("air") : ""}箱子最多比里面的模型空出 ${num(widest.most)} 格（「${widest.name}」；超过 ${HITBOX_FIT.air} 格算不合身）`] : []),
      `${faulty("out") && fit.rest.far > HITBOX_FIT.out ? marked("out") : ""}模型最远露出箱子 ${fit.rest.far} 格${fit.rest.bone && fit.rest.far > 0 ? `（「${fit.rest.bone}」）` : ""}（超过 ${HITBOX_FIT.out} 格算不合身）`,
      ...(fit.overlapping.length ? [`${marked("overlap")}${fit.overlapping.map((entry) => `「${entry.name}」${percent(entry.share)}`).join("、")}在身体的箱子里（超过 ${percent(HITBOX_FIT.overlap)} 算放错）`] : []),
      ...(fit.missing.length ? [`${HITBOX_FAULT_MARK}：${fit.missing.map((entry) => `「${entry.name}」`).join("")}写的骨骼模型里没有`] : []),
      ...(fit.parts.count ? [`${fit.parts.count} 个部位（最多 ${fit.parts.most} 个）${fit.parts.following.length ? `，${fit.parts.following.length} 个跟着骨骼动` : ""}`] : []),
    ],
    moving: fit.moving ? [`${fit.moving.far > HITBOX_FIT.out ? marked("out") : ""}${motionLabel(fit.moving.clip)}第 ${fit.moving.time} 秒：模型有 ${percent(fit.moving.outside)} 露在外面，最远 ${fit.moving.far} 格${fit.moving.bone ? `（「${fit.moving.bone}」）` : ""}；${fit.parts.following.length ? "写了 bone 的部位跟着骨骼动，别的箱子不动" : "箱子不跟着动作动"}`] : [],
  }
}

/** Whether a sentence is a misfit that still has to be answered. */
export const hitboxFault = (line: string) => line.startsWith(HITBOX_FAULT_MARK)

/**
 * Whether a creature's version has collision boxes to look at: it states them, or the one box it would get
 * without (as wide as its model is long) is measured not to fit. A small squarish creature that says nothing
 * has nothing to look at and is handed in as it always was.
 */
export const hitboxLooked = (creature: { hitbox?: Hitbox | null }, design: Design | null) => Boolean(creature.hitbox) || Boolean(design && hitboxFit(null, design).faults.length)

/** The same for the person, without numbers. Empty when the boxes fit. */
export function hitboxPlain(fit: HitboxFitted) {
  const words = { air: "碰撞箱比身体大出一截，隔着空气也会被打到", out: "身体有一部分露在碰撞箱外面，打那里打不中", overlap: "有的部位箱子几乎整个在身体的箱子里，多半放错了地方", bone: "有的部位写的骨骼模型里没有，箱子跟不了动作" } as const
  return fit.faults.map((found) => `${words[found.fault]}${found.reason === null ? "。" : `——文档里写了本来就该这样：${found.reason}`}`)
}

/** What an AI is told about collision boxes. One text: the registry, the hand-off and the capability list read it. */
export const SOLID_BODY_WORDS = "中间身体要挡路、承重就写 core.solid: true；伸出去的受击部位也可写 solid: true。省略或写 false 就不挡路。要留空隙，分开画部位并给空隙留出空间。部位移动或转身会从脚下移开，罩进身体的角色会被推到最近的可用空处。身体和受击部位照常承受命中。只做围栏、底座或填空心时，用 hitbox.blockers（最多 8 个），每个写 name、forward、up、left、width、height，随身体转向，始终实心。它不接收近战、投射物或右键，不占 16 个受击部位名额。"

export const HITBOX_INSTRUCTIONS = HITBOX_COMBAT_INSTRUCTIONS +
  ` ${SOLID_BODY_WORDS}` +
  ` hitbox 是它的碰撞箱，可以不写：{core: {width, height, eye_height, step, solid}, parts: [{name, forward, up, left, width, height, bone, solid}], blockers: [{name, forward, up, left, width, height}], stuck: {seconds, squeeze}, justified: [{what, reason}]}，长度都是格。游戏里一只生物自己只有一个箱子：正方形的底、竖直、中心在它脚下——这就是 core，宽 width、高 height，边长最多 ${HITBOX_LIMITS.size} 格（9 格高、6 格宽的巨人可以直接写；eye_height 是眼睛离脚多高，可以不写，不写是高度的 85%）。core 管的是它走路找路、被推开、卡进方块里窒息，也能被打中。step 是它不用跳就能走上去的台阶高度，${HITBOX_LIMITS.step.min} 到 ${HITBOX_LIMITS.step.max} 格，不写是游戏默认的 0.6；大个子要写大一点（九格高的巨人写 1.5 到 2），不然半格的台阶都会把它挡住。不写 hitbox（或 null）是老办法：一个方箱子，宽度取模型最长的一边，高度取模型的高；小而方的生物这样正好，身子长的或者大的生物会得到一个比身体宽出很多的大方块。` +
  ` parts 是另外加的箱子，最多 ${HITBOX_LIMITS.parts} 个，给伸到 core 外面的部位用（每个也是正方形的底、竖直）：forward、left 是箱子底面中心在它脚下往前、往它自己左边多少格（负数是往后、往右），up 是箱子的底离它脚下多高（从脚下算，不是从 core 顶上），width 是底的边长，height 是高，这些都按模型摆好不动时的样子量；name 是给人看的名字。部位的箱子能被近战和投射物打中、能被右键，打中它就是打中这只生物本身（同样的伤害、被打退、附魔和仇恨）；部位默认不挡路，写了 solid: true 才挡路。部位不会被推或窒息，也不影响自己的生物走路；这只生物自己的招式和投射物仍不会打到自己的部位。` +
  ` 部位跟着身体的朝向一起转（它被放大缩小时跟着一起变）。写了 bone（模型里一根骨骼的名字，要和模型里的完全一样）的部位还会跟着那根骨骼动：构建时按它的待机、走路和每个招式的动作，每 2 刻量一次这根骨骼离摆好时的位置挪了多少，写成一张表，游戏里服务端看它正在播哪个动作、播到第几刻就把箱子挪过去——六条手臂的巨人给每只手一个跟着手骨的箱子，挥手、砸地时箱子就跟着手走。其他时候（Boss 醒来和换阶段、习性动作、在天上飞、倒下）箱子停在写的位置。不写 bone 的部位一直停在写的位置。bone 写了模型里没有的名字，箱子跟不了，会出现在 findings 里。会飞的生物（写了 flight）的部位还跟着机身在空中的俯仰和侧倾一起转，绕它身体箱子（core）的中间——和玩家看到的模型转得一样；箱子自己仍然是竖直的方箱子，只是位置跟着动。会飞的生物量碰撞箱合不合身时，除了站着和走，也量起飞、落地、飞行、滑翔、悬停这些在天上的动作，翅膀展开的样子也要被箱子罩住。` +
  ` stuck 是大个子卡住时怎么办，可以不写（不写就是原版的寻路，卡住就一直卡着）：它追着一个目标、却连续 seconds 秒（${HITBOX_LIMITS.stuck.min} 到 ${HITBOX_LIMITS.stuck.max}，默认 ${HITBOX_LIMITS.stuck.default}）没有离目标近半格，就重新找一条路，再不行就绕到目标的一侧去找路，左右轮着试；squeeze 写 true 时第二次卡住起改成直接朝目标走两秒，碰到一格高的东西就跳过去。它不会拆方块。core 宽 3 格以上或高 4 格以上的生物建议写上 {"seconds":3,"squeeze":true}，样机按开阔场地验。例（九格高、六条手臂的巨人，core 到肩膀，头和六只手各一个跟着骨骼的部位）：core {"width":4,"height":7.5,"step":1.5}，parts 里每只手一个 {"name":"左上手","forward":0.5,"up":5.4,"left":2.4,"width":0.9,"height":0.9,"bone":"hand_left_0"}，头一个 {"name":"头","forward":0,"up":7.5,"left":0,"width":1.6,"height":1.5,"bone":"head"}，再加 stuck {"seconds":3,"squeeze":true}。` +
  ` 要不要分部位由你看量出来的结果决定，不看它是什么：对生物任务调用 look（document 写这份生物文档）会画出碰撞箱的图——从上往下、侧面，和动起来最差的一刻，模型保持自己的颜色，蓝色是 core，普通 parts 是橙色，弱点（倍率大于 1）是红色，硬甲（倍率小于 1，包括 0）是灰蓝色，实心部位带青绿色边线；颜色按初始阶段画，文字列出阶段倍率；有跟着骨骼的部位时另有一张图，画待机、走路和最常出的那一招各三个关键时刻箱子跟到了哪里——并说出模型有百分之几露在箱子外面（打那里打不中）、箱子里有百分之几是空的（隔着空气也会被打到、被挡住）、每个箱子比它里面的模型多出多少格——这些数只是事实，方箱子装不满不方的身子，原版生物也是如此，不是毛病。箱子比身体空出 ${HITBOX_FIT.air} 格以上，或者模型露在所有箱子外面 ${HITBOX_FIT.out} 格以上，或者一个未设为实心的部位有 ${Math.round(HITBOX_FIT.overlap * 100)}% 以上在 core 里面（多半放错了），或者 bone 写了模型里没有的骨骼，会出现在 findings 里：把 core 改到贴着身体、给露出去的部位加 parts、把部位挪到伸出去的那一截上、改对骨骼名，或者在 justified 里写明它本来就该这样和理由（what 写 air、out 或 overlap；理由会给评审和人看；骨骼名写错不能这样答）。不写 hitbox 而老办法量出来不合身的，findings 里会给出按模型算的 core 建议值。` +
  ` 例（一只身子长的生物）：{"core":{"width":1,"height":1.1},"parts":[{"name":"头","forward":1.1,"up":0.1,"left":0,"width":0.9,"height":0.9,"bone":"head"},{"name":"尾","forward":-1.2,"up":0.2,"left":0,"width":0.8,"height":0.6,"bone":"tail"}]}。`

export const HITBOX_SUMMARY = `可选：碰撞箱（hitbox）——身体一个方箱子（core，管走路、被推、窒息，边长最多 ${HITBOX_LIMITS.size} 格，step 是能走上去的台阶高度），伸出去的部位可以另外加最多 ${HITBOX_LIMITS.parts} 个箱子（parts，能被打中和右键，算在这只生物身上；写了 bone 的跟着那根骨骼动），身体或受击部位写 solid: true 可挡路、承重；另有最多 8 个只挡路的 blockers。部位可写 damage_scale（弱点或硬甲）、phase_scales（阶段倍率）和 contact（指定招式期间接触伤害，每招对每位玩家一次）；大个子可以写 stuck（卡住了绕路、跳过一格高的东西）；合不合身是在模型上量出来的，look 会画出来。不写就是老办法：按模型最长的一边定一个方箱子。`

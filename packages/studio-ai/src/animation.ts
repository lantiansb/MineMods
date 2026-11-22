/**
 * The animation contract: what a clip in a model document (or an animation document) means, and the one
 * function that plays it. Everything that shows or exports a motion reads it through here: the viewport and
 * the look pictures, the motion measure, the GeckoLib animation file, the .bbmodel file. No imports.
 *
 * Version 1 (every document written before): per bone one track of rotation keys, straight lines between
 * keys. Version 2 adds, all optional: a position track, a scale track, and on any key an `interpolation`.
 * A document that uses none of them is a version 1 document and means exactly what it meant.
 *
 * Axes and units are the document's own (see orientation.ts): Y up, the front is -Z, +X is the thing's own left.
 * - rotation: degrees [x, y, z] added to the angles the bone is built with.
 * - position: model pixels [x, y, z] the bone and everything under it is moved by, along the axes of the bone
 *   above it (the document's axes for the root, and for any bone whose parents are not turned). +X moves
 *   towards its own left, +Y up, -Z forwards.
 * - scale: multipliers [x, y, z] about the bone's pivot, along the bone's own axes; 1 is the built size.
 * A track that is absent leaves that part of the bone as built.
 *
 * `interpolation` on a key says how the value leaves that key (absent or null: linear):
 * - `linear`: a straight line to the next key;
 * - `step`: this key's value is held until the next key, where it jumps;
 * - `smooth`: the curve passes through this key without a corner. The segment that arrives at a smooth key
 *   and the one that leaves it are both curved (a uniform Catmull-Rom spline through the keys on either
 *   side, each axis by itself), unless the segment starts at a `step` key. This is Blockbench's rule for its
 *   own keyframes, so a clip opens there playing the same.
 * Before a track's first key its value is held; after its last key too. A looping clip starts over at its
 * length; in a looping clip with three or more keys a smooth curve's first and last segments take their
 * outer neighbours from the other end of the track (the key before the last, the key after the first), as
 * Blockbench does, so a loop whose first and last keys are the same pose turns over without a corner.
 *
 * Version 3 adds optional controls for layered motion:
 * - `bezier` interpolation, Blockbench's own: the segment between two keys where either is `bezier` (and
 *   neither is `smooth`, and the first is not `step`) is a cubic Bézier in (time, value) per axis, from the
 *   first key through its right handle (`bezier_right_time` seconds after it, `bezier_right_value` above it)
 *   and the second key's left handle (`bezier_left_time`, negative, and `bezier_left_value`) to the second
 *   key. A handle a key does not write is Blockbench's default: 0.1 s out, level. Handle times are held
 *   inside the segment, as Blockbench holds them.
 * - `easing` on a key: the straight line that leaves it is walked along one of `EASINGS` (the usual
 *   ease-in / ease-out / ease-in-out families) instead of at an even pace. Only on a segment that would
 *   otherwise be a straight line.
 * Every curve of whatever kind is cut into straight pieces for the game's file (`bakeTrack`), within the
 * same tolerance and the same limits as `smooth` always was. A clip that uses none of these means what it meant.
 */

export const ANIMATION_CONTRACT = 3
export const INTERPOLATIONS = ["linear", "step", "smooth", "bezier"] as const
export type Interpolation = (typeof INTERPOLATIONS)[number]
/** The easings a key may name: the families everyone knows them by (easings.net, and GeckoLib's own names). */
export const EASINGS = [
  "easeInSine", "easeOutSine", "easeInOutSine",
  "easeInQuad", "easeOutQuad", "easeInOutQuad",
  "easeInCubic", "easeOutCubic", "easeInOutCubic",
  "easeInQuart", "easeOutQuart", "easeInOutQuart",
  "easeInQuint", "easeOutQuint", "easeInOutQuint",
  "easeInExpo", "easeOutExpo", "easeInOutExpo",
  "easeInCirc", "easeOutCirc", "easeInOutCirc",
  "easeInBack", "easeOutBack", "easeInOutBack",
  "easeInElastic", "easeOutElastic", "easeInOutElastic",
  "easeInBounce", "easeOutBounce", "easeInOutBounce",
] as const
export type Easing = (typeof EASINGS)[number]

const bounceOut = (x: number) => {
  const n = 7.5625
  const d = 2.75
  if (x < 1 / d) return n * x * x
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375
  return n * (x -= 2.625 / d) * x + 0.984375
}
const BACK = 1.70158
const ELASTIC = (2 * Math.PI) / 3
const ELASTIC_BOTH = (2 * Math.PI) / 4.5
const inOut = (ease: (x: number) => number) => (x: number) => (x < 0.5 ? ease(2 * x) / 2 : 1 - ease(2 - 2 * x) / 2)
const out = (ease: (x: number) => number) => (x: number) => 1 - ease(1 - x)
const power = (n: number) => (x: number) => x ** n
const sine = (x: number) => 1 - Math.cos((x * Math.PI) / 2)
const expo = (x: number) => (x === 0 ? 0 : 2 ** (10 * x - 10))
const circ = (x: number) => 1 - Math.sqrt(1 - x * x)
const back = (x: number) => (BACK + 1) * x * x * x - BACK * x * x
const elastic = (x: number) => (x === 0 ? 0 : x === 1 ? 1 : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * ELASTIC))
const bounce = (x: number) => 1 - bounceOut(1 - x)
/**
 * Where an easing has got to at `x` (0 to 1) of its segment: 0 at the start, 1 at the end, in between how the
 * family goes (Back and Elastic go a little past either end, Bounce comes back off the end). easings.net's formulas.
 */
export const EASE: Readonly<Record<Easing, (x: number) => number>> = {
  easeInSine: sine, easeOutSine: out(sine), easeInOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  easeInQuad: power(2), easeOutQuad: out(power(2)), easeInOutQuad: inOut(power(2)),
  easeInCubic: power(3), easeOutCubic: out(power(3)), easeInOutCubic: inOut(power(3)),
  easeInQuart: power(4), easeOutQuart: out(power(4)), easeInOutQuart: inOut(power(4)),
  easeInQuint: power(5), easeOutQuint: out(power(5)), easeInOutQuint: inOut(power(5)),
  easeInExpo: expo, easeOutExpo: out(expo), easeInOutExpo: (x) => (x === 0 ? 0 : x === 1 ? 1 : inOut(expo)(x)),
  easeInCirc: circ, easeOutCirc: out(circ), easeInOutCirc: inOut(circ),
  easeInBack: back, easeOutBack: out(back), easeInOutBack: (x) => (x < 0.5 ? ((2 * x) ** 2 * ((BACK * 1.525 + 1) * 2 * x - BACK * 1.525)) / 2 : ((2 * x - 2) ** 2 * ((BACK * 1.525 + 1) * (x * 2 - 2) + BACK * 1.525) + 2) / 2),
  easeInElastic: elastic, easeOutElastic: out(elastic),
  easeInOutElastic: (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * ELASTIC_BOTH)) / 2 : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * ELASTIC_BOTH)) / 2 + 1),
  easeInBounce: bounce, easeOutBounce: bounceOut, easeInOutBounce: (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2),
}
export const ANIMATION_TRACKS = ["rotation", "position", "scale"] as const
export type AnimationTrack = (typeof ANIMATION_TRACKS)[number]

/** How far a key may go. Rotation is the document's old range; position reaches across a whole model; scale never turns a part inside out. */
export const ANIMATION_LIMITS = { rotation: 360, position: 128, scale: 16, keys: 60 } as const

type Vec = [number, number, number]
type Vector = readonly [number, number, number]
type Mode = Interpolation | null | undefined
type Handle = Vector | null | undefined
/** What a key may say about the curve beside it besides its time and value (version 3: `easing` and the Bézier handles). */
export type KeyShape = {
  interpolation?: Mode
  easing?: Easing | null
  bezier_left_time?: Handle
  bezier_left_value?: Handle
  bezier_right_time?: Handle
  bezier_right_value?: Handle
}
/** One track with its values under one name, whatever it is a track of. */
export type TrackKey = { time: number; value: Vector } & KeyShape
/** A bone's part of a clip as documents write it. */
export type ClipChannel = {
  bone: string
  keyframes: readonly ({ time: number; rotation: Vector } & KeyShape)[]
  position?: readonly ({ time: number; position: Vector } & KeyShape)[] | null
  scale?: readonly ({ time: number; scale: Vector } & KeyShape)[] | null
}
/**
 * `blend` (version 3): ticks over which the creature goes over from the pose it was in to this clip when the
 * clip starts, and from it to whatever plays next when it ends (absent, null or 0: at once, as always).
 * `layered` (version 3): while it plays, every bone it has no channel for keeps being moved by the walk or the
 * idle (absent, null or false: the walk and the idle stop while it plays, as always).
 */
export type Clip = { weights?: import("./clip-weights").ClipWeights | null; length: number; loop: boolean; channels: readonly ClipChannel[]; blend?: number | null; layered?: boolean | null }
/** The most ticks a clip may take to blend in or out: one second. */
export const BLEND_MOST = 20

/**
 * A follow bone (version 3, the model's `follow`): moved by no key of its own beyond what clips write, it
 * lags and sways after the bone above it and after the body's own movement, a damped spring per axis.
 * `period`: seconds of one sway; `damping`: the share of critical damping (1: no sway back, a slow return);
 * `drag`: degrees it trails by at one block a second; `limit`: the most degrees it may be away from where
 * its keys put it. The same arithmetic plays it in the preview (`follow-bones.ts`) and in the game.
 */
export type FollowBone = {
  bone: string
  /** `spring` (absent or null too): the damped spring of `follow-bones.ts`. `hang`: a chain of points hanging in the world (`hang-chains.ts`). */
  mode?: "spring" | "hang" | null
  period?: number | null
  damping?: number | null
  drag?: number | null
  limit?: number | null
  x_range?: readonly number[] | null
  /** Hang only, written on the top link of a chain: how hard the world pulls it down (1: as hard as anything falls). */
  gravity?: number | null
  /** Hang only: how firmly the chain is held to where the motion puts it (0: hangs freely, 1: barely sags), and how much of that each link further down loses. */
  attract?: number | null
  falloff?: number | null
  /** Hang only: whether its points rest on the blocks under them instead of going through. */
  floor?: boolean | null
  /** Hang only: how much of the hanging is shown over the motion's own pose (0: none, 1: all). */
  weight?: number | null
}
export const FOLLOW_DEFAULTS = { period: 0.8, damping: 0.3, drag: 6, limit: 35 } as const
/** The numbers a hanging chain leaves out, and how far each may go. */
export const HANG_DEFAULTS = { gravity: 1, attract: 0.2, falloff: 0.5, damping: 0.3, weight: 1 } as const
export const HANG_RANGE = { gravity: [0, 3], attract: [0, 1], falloff: [0, 1], weight: [0, 1] } as const
/** The words only one of the two modes reads. */
export const SPRING_ONLY = ["period", "drag", "x_range"] as const
export const HANG_ONLY = ["gravity", "attract", "falloff", "floor", "weight"] as const
/** A follow bone that hangs (`mode: "hang"`). */
export const hangs = (follow: Pick<FollowBone, "mode">) => follow.mode === "hang"

/**
 * Feet on the ground (the model's `foot_placement`): on every player's game alone, each foot finds the ground under it, its height going up and down at
 * capped speeds, the legs bending to reach it and `body` dropping (and, with feet in front and behind or on both sides, tilting) so the lowest still does.
 * `forward`/`side`: where the foot stands, model pixels forward (the document's -Z) and to its own left (+X); left out, where its end is as the model is built.
 * `knee`: which way a leg built straight bends (one built bent keeps its own way). Speeds in blocks a second, `max_drop` in blocks.
 */
export type FootPlacement = {
  feet: readonly { thigh: string; calf?: string | null; foot?: string | null; forward?: number | null; side?: number | null; knee?: "forward" | "back" | null }[]
  body?: string | null
  rise_speed?: number | null
  fall_speed?: number | null
  max_drop?: number | null
}
export const FOOT_DEFAULTS = { rise_speed: 3, fall_speed: 2, max_drop: 0.75 } as const
export const FOOT_RANGE = { feet: 8, speed: [0.5, 20], max_drop: [0.1, 2], probe: 128 } as const
export const FOLLOW_RANGE = { period: [0.2, 3], damping: [0.05, 1], drag: [0, 30], limit: [1, 90], bones: 32 } as const
/**
 * A follow bone with every number it may leave out filled in. `low`/`high`: the least and the most sway on each axis — `limit` either
 * way, except on x when `x_range` says otherwise (a cape lying on a back may swing out behind it and not into it: [0, 60]).
 */
export function followOf(follow: FollowBone) {
  const limit = follow.limit ?? FOLLOW_DEFAULTS.limit
  const range = follow.x_range ?? null
  return {
    bone: follow.bone,
    period: follow.period ?? FOLLOW_DEFAULTS.period,
    damping: follow.damping ?? FOLLOW_DEFAULTS.damping,
    drag: follow.drag ?? FOLLOW_DEFAULTS.drag,
    limit,
    low: [range ? Math.min(range[0]!, range[1]!) : -limit, -limit, -limit] as [number, number, number],
    high: [range ? Math.max(range[0]!, range[1]!) : limit, limit, limit] as [number, number, number],
  }
}
/** What a clip adds to a bone at one moment, in the document's axes. */
export type BoneSample = { rotation: Vec; position: Vec; scale: Vec }

/** What a bone is when nothing animates it. */
export const REST: Readonly<Record<AnimationTrack, Vector>> = { rotation: [0, 0, 0], position: [0, 0, 0], scale: [1, 1, 1] }

/** The three tracks of a channel in one shape. An absent track is an empty list. */
export function channelTracks(channel: ClipChannel): Record<AnimationTrack, TrackKey[]> {
  return {
    rotation: channel.keyframes.map((key) => ({ time: key.time, value: key.rotation, interpolation: key.interpolation, ...keyExtras(key) })),
    position: (channel.position ?? []).map((key) => ({ time: key.time, value: key.position, interpolation: key.interpolation, ...keyExtras(key) })),
    scale: (channel.scale ?? []).map((key) => ({ time: key.time, value: key.scale, interpolation: key.interpolation, ...keyExtras(key) })),
  }
}

const EXTRA_WORDS = ["easing", "bezier_left_time", "bezier_left_value", "bezier_right_time", "bezier_right_value"] as const
/** The version 3 words a key carries, only those it writes: a version 2 key comes out as it always did. */
function keyExtras(key: KeyShape): KeyShape {
  return Object.fromEntries(EXTRA_WORDS.filter((name) => key[name] != null).map((name) => [name, key[name]]))
}

/** Where a clip is at `time` seconds: a loop starts over at its length, anything else stops at its end. */
export function clipCursor(clip: Pick<Clip, "length" | "loop">, time: number) {
  return clip.loop ? ((time % clip.length) + clip.length) % clip.length : Math.min(Math.max(time, 0), clip.length)
}

/** How a segment runs: the four interpolations, or (version 3) a straight line walked along an easing. */
type Segment = Interpolation | "eased"

/**
 * How the segment that leaves key `index` runs. Blockbench's order: a step holds; else a smooth key on either
 * end curves it; else a bezier key on either end; else a straight line, walked along the first key's easing if it names one.
 */
function segmentMode(keys: readonly TrackKey[], index: number): Segment {
  const from = keys[index]!
  const to = keys[index + 1]!
  if (from.interpolation === "step") return "step"
  if (from.interpolation === "smooth" || to.interpolation === "smooth") return "smooth"
  if (from.interpolation === "bezier" || to.interpolation === "bezier") return "bezier"
  return from.easing ? "eased" : "linear"
}

/**
 * One axis of a Bézier segment at `time`: Blockbench's curve from `from` through its right handle and `to`'s left handle to `to`,
 * a handle a key does not write being 0.1 s out and level, handle times held inside the segment. The curve's time runs one way
 * only, so the moment on it is found by halving (48 halvings: far finer than a millisecond on a segment of 30 s).
 */
function bezierAt(from: TrackKey, to: TrackKey, axis: number, time: number) {
  const gap = to.time - from.time
  const t1 = from.time + Math.min(Math.max(from.bezier_right_time?.[axis] ?? 0.1, 0), gap)
  const t2 = to.time + Math.min(Math.max(to.bezier_left_time?.[axis] ?? -0.1, -gap), 0)
  const v0 = from.value[axis]!
  const v3 = to.value[axis]!
  const v1 = v0 + (from.bezier_right_value?.[axis] ?? 0)
  const v2 = v3 + (to.bezier_left_value?.[axis] ?? 0)
  const cubic = (a: number, b: number, c: number, d: number, s: number) => (1 - s) ** 3 * a + 3 * (1 - s) ** 2 * s * b + 3 * (1 - s) * s * s * c + s ** 3 * d
  let low = 0
  let high = 1
  for (let step = 0; step < 48; step++) {
    const middle = (low + high) / 2
    if (cubic(from.time, t1, t2, to.time, middle) < time) low = middle
    else high = middle
  }
  return cubic(v0, v1, v2, v3, (low + high) / 2)
}

/** A segment that is neither straight, held nor smooth (bezier, eased) at `time` inside it. */
function curveAt(keys: readonly TrackKey[], index: number, mode: "bezier" | "eased", time: number): Vec {
  const from = keys[index]!
  const to = keys[index + 1]!
  if (mode === "bezier") return [0, 1, 2].map((axis) => bezierAt(from, to, axis, time)) as Vec
  const u = EASE[from.easing!]((time - from.time) / (to.time - from.time))
  return from.value.map((value, axis) => value + (to.value[axis]! - value) * u) as Vec
}

/** The four values a smooth segment runs through: the key before, its two ends, the key after. A missing neighbour is the end itself, or in a loop the key from the other end. */
function splinePoints(keys: readonly TrackKey[], index: number, loop: boolean): [Vector, Vector, Vector, Vector] {
  const wrap = loop && keys.length >= 3
  return [
    (keys[index - 1] ?? (wrap ? keys[keys.length - 2]! : keys[index]!)).value,
    keys[index]!.value,
    keys[index + 1]!.value,
    (keys[index + 2] ?? (wrap ? keys[1]! : keys[index + 1]!)).value,
  ]
}

const spline = (p: readonly [number, number, number, number], u: number) =>
  0.5 * (2 * p[1] + (p[2] - p[0]) * u + (2 * p[0] - 5 * p[1] + 4 * p[2] - p[3]) * u * u + (3 * p[1] - p[0] - 3 * p[2] + p[3]) * u * u * u)

/**
 * One track at one moment (seconds inside the clip, see `clipCursor`). Undefined for a track with no keys.
 * `loop` only tells a smooth curve where its outer neighbours are.
 */
export function sampleTrack(keys: readonly TrackKey[], time: number, loop = false): Vec | undefined {
  if (!keys.length) return undefined
  const next = keys.findIndex((key) => key.time > time)
  if (next === 0) return [...keys[0]!.value]
  if (next === -1) return [...keys[keys.length - 1]!.value]
  const from = keys[next - 1]!
  const mode = segmentMode(keys, next - 1)
  if (mode === "step") return [...from.value]
  if (mode === "bezier" || mode === "eased") return curveAt(keys, next - 1, mode, time)
  const u = (time - from.time) / (keys[next]!.time - from.time)
  if (mode === "linear") return from.value.map((value, axis) => value + (keys[next]!.value[axis]! - value) * u) as Vec
  const points = splinePoints(keys, next - 1, loop)
  return [0, 1, 2].map((axis) => spline([points[0][axis]!, points[1][axis]!, points[2][axis]!, points[3][axis]!], u)) as Vec
}

/**
 * THE sampler: what `clip` adds to `bone` at `time` seconds, in the document's axes — degrees to add to the
 * bone's built rotation, pixels to move it by in the space of the bone above it, and its scale about its
 * pivot. A track the clip does not carry comes back as built (0, 0 and 1). Undefined when the clip does not
 * touch the bone at all. Time may be any number: a loop wraps, anything else is held at its ends.
 */
export function sampleBone(clip: Clip, bone: string, time: number): BoneSample | undefined {
  const channel = clip.channels.find((value) => value.bone === bone)
  if (!channel) return undefined
  const tracks = channelTracks(channel)
  const cursor = clipCursor(clip, time)
  return {
    rotation: sampleTrack(tracks.rotation, cursor, clip.loop) ?? [...REST.rotation],
    position: sampleTrack(tracks.position, cursor, clip.loop) ?? [...REST.position],
    scale: sampleTrack(tracks.scale, cursor, clip.loop) ?? [...REST.scale],
  }
}

/**
 * How closely the straight pieces of an exported curve follow it, per track: degrees, model pixels, scale.
 * At the size the game usually shows a creature one model pixel is about six screen pixels, so these are
 * all well under one screen pixel on a part a block long.
 */
export const BAKE_TOLERANCE: Readonly<Record<AnimationTrack, number>> = { rotation: 0.1, position: 0.02, scale: 0.002 }
// Pieces one curved segment may be cut into, and the shortest piece in seconds: GeckoLib puts the end of a held value 0.001 s before the next key.
const BAKE_PIECES = 128
const BAKE_SHORTEST = 0.002

const exact = (value: number) => Math.round(value * 10000) / 10000 + 0

/** A key of an exported track: plain, or with the value held up to it (`pre`) when the key before it is a `step`. */
export type BakedKey = { time: number; value: Vec; pre?: Vec }

/**
 * A track as the game's animation file can carry it, where only straight lines and jumps play the same in
 * GeckoLib as here: every key as written, each curved segment cut into as many straight pieces as keep it
 * within `BAKE_TOLERANCE` of the curve, and the end of each held value marked on the key that ends it.
 * A track of straight lines comes back as it is, values untouched.
 */
export function bakeTrack(keys: readonly TrackKey[], loop: boolean, tolerance: number): BakedKey[] {
  return keys.flatMap((key, index) => {
    const own: BakedKey = { time: key.time, value: [...key.value] }
    const before = keys[index - 1]
    // A jump needs room for the held value before it; closer keys than that are as good as a jump already.
    const held = before && segmentMode(keys, index - 1) === "step" && key.time - before.time > BAKE_SHORTEST ? { ...own, pre: [...before.value] as Vec } : own
    if (index === keys.length - 1) return [held]
    const mode = segmentMode(keys, index)
    if (mode === "bezier" || mode === "eased") return [held, ...curvePieces(keys, index, mode, tolerance)]
    if (mode !== "smooth") return [held]
    const points = splinePoints(keys, index, loop)
    // A cubic's second derivative is largest at one of its ends; a chord over 1/n of it strays at most that / 8n².
    const bend = Math.max(...[0, 1, 2].flatMap((axis) => [Math.abs(2 * points[0][axis]! - 5 * points[1][axis]! + 4 * points[2][axis]! - points[3][axis]!), Math.abs(4 * points[1][axis]! - points[0][axis]! - 5 * points[2][axis]! + 2 * points[3][axis]!)]))
    const span = keys[index + 1]!.time - key.time
    const pieces = Math.max(1, Math.min(BAKE_PIECES, Math.floor(span / BAKE_SHORTEST), Math.ceil(Math.sqrt(bend / (8 * tolerance)))))
    return [
      held,
      ...Array.from({ length: pieces - 1 }, (_, piece) => ({
        time: exact(key.time + (span * (piece + 1)) / pieces),
        value: [0, 1, 2].map((axis) => exact(spline([points[0][axis]!, points[1][axis]!, points[2][axis]!, points[3][axis]!], (piece + 1) / pieces))) as Vec,
      })),
    ]
  })
}

// Piece counts tried for a bezier or eased segment, fewest first: the first whose straight pieces stay within the tolerance is taken.
const CURVE_PIECES = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, BAKE_PIECES] as const
// Moments inside each piece at which a candidate is checked against the curve.
const CURVE_CHECKS = [0.25, 0.5, 0.75] as const

/**
 * The inner keys a bezier or eased segment is cut into (the keys at its two ends are the track's own): the
 * fewest even pieces whose chords stay within `tolerance` of the curve at a quarter, a half and three
 * quarters of every piece, at most `BAKE_PIECES`, and none shorter than `BAKE_SHORTEST`.
 */
function curvePieces(keys: readonly TrackKey[], index: number, mode: "bezier" | "eased", tolerance: number): BakedKey[] {
  const from = keys[index]!
  const span = keys[index + 1]!.time - from.time
  const at = (share: number) => (share >= 1 ? [...keys[index + 1]!.value] as Vec : share <= 0 ? [...from.value] as Vec : curveAt(keys, index, mode, from.time + span * share))
  const most = Math.max(1, Math.min(BAKE_PIECES, Math.floor(span / BAKE_SHORTEST)))
  const fits = (pieces: number) =>
    Array.from({ length: pieces }).every((_, piece) => {
      const start = at(piece / pieces)
      const end = at((piece + 1) / pieces)
      return CURVE_CHECKS.every((check) => {
        const curve = at((piece + check) / pieces)
        return [0, 1, 2].every((axis) => Math.abs(start[axis]! + (end[axis]! - start[axis]!) * check - curve[axis]!) <= tolerance)
      })
    })
  const pieces = CURVE_PIECES.find((count) => count >= most || fits(count)) ?? most
  const cut = Math.min(pieces, most)
  return Array.from({ length: cut - 1 }, (_, piece) => ({ time: exact(from.time + (span * (piece + 1)) / cut), value: at((piece + 1) / cut).map(exact) as Vec }))
}

/**
 * What an EXPORTED track may hold. `ANIMATION_LIMITS.keys` is a limit on what an author writes; cutting a
 * curve into straight pieces makes more keys than were written (six smooth keys of a wide, fast swing came
 * out as 79), and those are not the author's to count. They have a limit of their own, set by what they cost:
 * - measured here: a key of the game's animation file is about 36 bytes of JSON, so `track` keys are about
 *   17 KB a track and `total` about 2.2 MB a model, read in about 30 ms;
 * - read in GeckoLib 4.8.3's source (`AnimationController.getCurrentKeyFrameLocation`): every drawn frame
 *   walks a track's keys from its first to the one being played, once per axis, so a track costs at most
 *   `track` steps an axis a frame. Not measured in the game.
 * `loosest`: how far `BAKE_TOLERANCE` may be widened for one track before it is refused. At 8 times a part a
 * block long strays about a quarter of a model pixel from its curve at its far end (0.8 degrees), a little
 * over one screen pixel at the size the game usually shows a creature and under the two from which a shift
 * is seen (`MOTION_VISIBLE.pixels`).
 */
export const BAKED_LIMITS = { track: 480, total: 60_000, loosest: 8 } as const
const BAKE_STEPS = [1, 2, 4, BAKED_LIMITS.loosest] as const

/**
 * A track for the game's file, made to fit: baked at `BAKE_TOLERANCE`, and when that is more keys than an
 * exported track may hold, at twice, four and eight times it, the first that fits. `widened` is how many
 * times the tolerance it took (1: none); `over` is true when even the loosest does not fit, and then the
 * keys are the loosest ones, for whoever refuses it to count. A track of straight lines is never changed.
 */
export function bakeFitted(keys: readonly TrackKey[], loop: boolean, track: AnimationTrack) {
  const fit = (step: number): { keys: BakedKey[]; widened: number; over: boolean } => {
    const baked = bakeTrack(keys, loop, BAKE_TOLERANCE[track] * BAKE_STEPS[step]!)
    if (baked.length > BAKED_LIMITS.track && step < BAKE_STEPS.length - 1) return fit(step + 1)
    return { keys: baked, widened: BAKE_STEPS[step]!, over: baked.length > BAKED_LIMITS.track }
  }
  return fit(0)
}

const TRACK_WORDS: Readonly<Record<AnimationTrack, string>> = { rotation: "转动", position: "位移", scale: "缩放" }

/**
 * Every track of a set of clips as it is exported, counted: how many keys the game's file holds in all, the
 * longest track, the tracks whose tolerance had to be widened, and (`faults`) what cannot be exported at
 * all, in the words the maker is given. The look, a draft and the save all read this one count.
 */
export function bakedCounts(clips: readonly ({ name: string } & Pick<Clip, "loop" | "channels">)[]) {
  const tracks = clips.flatMap((clip) =>
    clip.channels.flatMap((channel) =>
      ANIMATION_TRACKS.flatMap((track) => {
        const written = channelTracks(channel)[track]
        if (!written.length) return []
        const fitted = bakeFitted(written, clip.loop, track)
        return [{ clip: clip.name, bone: channel.bone, track, written: written.length, baked: fitted.keys.length, widened: fitted.widened, over: fitted.over }]
      }),
    ),
  )
  const total = tracks.reduce((sum, track) => sum + track.baked, 0)
  const longest = tracks.reduce<(typeof tracks)[number] | null>((most, track) => (track.baked > (most?.baked ?? 0) ? track : most), null)
  return {
    total,
    longest,
    widened: tracks.filter((track) => track.widened > 1 && !track.over),
    faults: [
      ...tracks
        .filter((track) => track.over)
        .map(
          (track) =>
            `动作 ${track.clip} 里骨骼 ${track.bone} 的${TRACK_WORDS[track.track]}轨道导出给游戏时太长了：你写了 ${track.written} 个关键帧，其中的曲线（smooth、bezier、easing）要切成直线段游戏才放得出来，精度已经放宽到平时的 ${BAKED_LIMITS.loosest} 倍，还是要 ${track.baked} 个点，导出的一条轨道最多 ${BAKED_LIMITS.track} 个。把这条轨道上幅度大、挨得近的曲线关键帧减少或者拉开，或者把其中一些改成不带 easing 的 linear。`,
        ),
      ...(total > BAKED_LIMITS.total ? [`所有动作导出给游戏以后一共有 ${total} 个点，最多 ${BAKED_LIMITS.total} 个（smooth、bezier、easing 的曲线要切成直线段，所以比你写的关键帧多）。减少曲线关键帧，或者把幅度大的曲线改成不带 easing 的 linear。`] : []),
    ],
  }
}

/** The exported count in a sentence, said with a model's budget when curves made it differ from what was written; empty otherwise. A fact. */
export function bakedLine(counts: ReturnType<typeof bakedCounts>) {
  if (!counts.longest || (counts.longest.baked <= counts.longest.written && !counts.widened.length)) return ""
  return (
    `导出给游戏的动作：曲线（smooth、bezier、easing）要切成直线段游戏才放得出来，切完以后最长的一条轨道（动作 ${counts.longest.clip} 里骨骼 ${counts.longest.bone} 的${TRACK_WORDS[counts.longest.track]}，你写了 ${counts.longest.written} 个关键帧）有 ${counts.longest.baked} 个点（导出的上限 ${BAKED_LIMITS.track}），所有动作一共 ${counts.total} 个点（上限 ${BAKED_LIMITS.total}）。` +
    (counts.widened.length ? `有 ${counts.widened.length} 条轨道按平时的精度放不下，放宽了精度才导出（最多放宽到 ${Math.max(...counts.widened.map((track) => track.widened))} 倍，也就是一格长的部件末端最多偏 ${Number((0.03 * Math.max(...counts.widened.map((track) => track.widened))).toFixed(2))} 个模型像素）：${counts.widened.slice(0, 6).map((track) => `${track.clip}/${track.bone}`).join("、")}。` : "") +
    `这些上限管的是导出的文件，和你写的关键帧上限（一条轨道 ${ANIMATION_LIMITS.keys} 个）分开算。`
  )
}

/** True when a clip uses anything version 1 did not have. */
export function usesContract2(clip: Pick<Clip, "channels">) {
  return clip.channels.some((channel) => (channel.position?.length ?? 0) > 0 || (channel.scale?.length ?? 0) > 0 || channel.keyframes.some((key) => (key.interpolation ?? "linear") !== "linear"))
}

/** True when a clip uses a key word version 2 did not have: a bezier key, an easing or a handle. */
export function usesContract3(clip: Pick<Clip, "channels">) {
  return clip.channels.some((channel) => Object.values(channelTracks(channel)).some((keys) => keys.some((key) => key.interpolation === "bezier" || EXTRA_WORDS.some((name) => key[name] != null))))
}

/**
 * The exact sentences every maker is given about the contract, whichever way it writes a motion (a document
 * or a script): what the tracks are, their units and axes, what `interpolation` means, and what a motion is
 * judged by. It says nothing about how anything should move.
 */
export const ANIMATION_GUIDE =
  `一个动作里，每根骨骼最多有三条轨道，用哪条写哪条：` +
  `转动（文档里是 keyframes，每个关键帧写 rotation）——[x, y, z] 度，加在骨骼搭好时的角度上，范围 ±${ANIMATION_LIMITS.rotation}；` +
  `位移（position）——[x, y, z] 模型像素，把这根骨骼连同它下面的一切整体挪开这么远，范围 ±${ANIMATION_LIMITS.position}。方向按它上一级骨骼的轴；根骨骼、以及上级都没有转过的骨骼，就是文档自己的轴：+Y 向上，-Z 向前（它面朝的方向），+X 朝它自己的左边；` +
  `缩放（scale）——[x, y, z] 倍数，以这根骨骼的关节为中心，沿它自己的轴放大缩小，1 是搭好时的大小，三个数可以不一样，范围 0 到 ${ANIMATION_LIMITS.scale}。` +
  `哪条轨道不写，这根骨骼的那一样就保持搭好时的样子；只挪动或只缩放的骨骼，keyframes 写成空列表 []。每条轨道最多写 ${ANIMATION_LIMITS.keys} 个关键帧（数的是你写的，不是导出以后的），时间递增，不超过动作的 length。` +
  `每个关键帧可以带 interpolation，说的是值从这个关键帧出发怎么走（不写或写 null 就是 linear）：linear 是直线走到下一个关键帧；step 是保持这个值不变，到下一个关键帧的那一刻直接跳过去；smooth 是曲线顺滑地经过这个关键帧、不留折角——到达它的那一段和离开它的那一段都是曲线（从 step 关键帧出发的那一段除外），曲线会略微越过关键帧之间的直线。` +
  `bezier 和 Blockbench 的贝塞尔一样：两端有一个是 bezier 的那一段（另一端不是 smooth、出发的那个不是 step）是一条三次贝塞尔曲线，从这个关键帧出发，经过它的右手柄（bezier_right_time 秒以后、高出 bezier_right_value）和下一个关键帧的左手柄（bezier_left_time 是负的秒数、bezier_left_value），到下一个关键帧；手柄都是 [x, y, z] 三个轴各一个数，不写的手柄是往外 0.1 秒、水平；手柄的时间不会伸出这一段。` +
  `关键帧还可以带 easing（不写或 null 就是匀速）：这个关键帧出发的那段直线不再匀速走，而是按缓动走完——${EASINGS.join("、")}。In 是开头慢、越走越快，Out 是开头快、到头变慢，InOut 是两头慢中间快；Sine、Quad、Cubic、Quart、Quint、Expo 一个比一个陡，Circ 是圆弧；Back 会先往反方向退一点（In）或冲过头再回到终点（Out）；Elastic 在终点附近来回振几下；Bounce 像落地弹几下。easing 只用在直线段上（两端都不是 smooth、bezier，出发的不是 step），到了终点值就是下一个关键帧的值。` +
  `这些曲线导出给游戏时都切成直线段，和 smooth 一样受同样的精度和同样的点数上限。` +
  `第一个关键帧之前和最后一个关键帧之后，值保持不变。循环的动作到 length 就从头再来，所以首尾两个关键帧要是同一个姿势才接得上。` +
  `预览图、量出来的数、游戏和导出的 Blockbench 文件，播放的是同一份关键帧、同一种算法，看到的就是玩家会看到的。` +
  `一个动作好不好，不看写了多少轨道和关键帧，看它在游戏里常见的大小下是什么样：每次看图一起给的 motion_facts 是量出来的事实（最远的一点移动了多少模型像素、合多少屏幕像素、哪个部件动得最多、连起来接不接得上），以这些数和逐帧图为准，不要凭感觉。`

/** 第 2 步 (挂链): the sentences on `mode: "hang"`, part of `CLIP_PLAY_GUIDE`. */
export const HANG_GUIDE =
  `follow 的每一项还可以写 mode："spring"（不写也是它）是上面说的会弹的晃动；"hang" 是挂着垂下来——这几节骨骼当成挂在世界里的一串点，受重力往下坠，被身体拖着走，甩起来有惯性，再慢慢被拉回动作摆的姿势。尾巴、头发、披风、铁链、触手、旗子用它。` +
  `一根接一根都写 hang、每一根是上一根唯一挂着的下一节，就是同一串；整串的数只写在最上面那一节，下面几节只写 bone 和 mode：` +
  `gravity（重力的倍数，${HANG_RANGE.gravity[0]} 到 ${HANG_RANGE.gravity[1]}，默认 ${HANG_DEFAULTS.gravity}）、attract（被拉回动作姿势的力气，0 到 1，0 是完全垂下来、1 是基本保持动作的样子，默认 ${HANG_DEFAULTS.attract}）、falloff（往下每一节拉回的力气少几成，0 到 1，默认 ${HANG_DEFAULTS.falloff}：根部稳、末梢甩）、damping（甩动停下来的快慢，0.05 到 1，默认 ${HANG_DEFAULTS.damping}）、limit（每一节最多偏开动作里的方向多少度，1 到 90，不写就不限）、floor（写 true，点落到方块上面就停住、不穿进地里：拖地的尾巴、长披风）、weight（挂着的效果显示几成，0 到 1，默认 ${HANG_DEFAULTS.weight}）。period、drag、x_range 只给 spring 用。` +
  `每一节的轴点放在它挂起来的那一端（尾巴根、链环的上端），下一节的轴点放在上一节的末端；最后一节的方块往垂下去的方向伸，它的末端按方块的远端算。挂链下面的骨骼不能再写 spring。` +
  `例：狼的尾巴 tail、tail_mid、tail_end 三节都写 hang，tail 上写 attract 0.4、falloff 0.5——走起来尾尖往后拖，停下时晃两下再垂回去；生物手里提着的灯笼，链子 chain_a、chain_b 和灯笼 lantern 都写 hang，chain_a 上写 attract 0.05、damping 0.15——几乎自由地垂着，身体一动就来回荡。预览图里挂链和游戏里用同一种算法，先让它挂几秒、晃稳了再画。`

/** 第 2 步 (踩地): the sentences on `foot_placement`, part of `CLIP_PLAY_GUIDE`. */
export const FOOT_GUIDE =
  `模型还可以写 foot_placement，让脚踩在高低不平的地上（只在玩家的游戏里画的时候算，不改变它实际站在哪里）：feet 每一项是一条腿——thigh（大腿）、calf（小腿；只有一节的腿可以不写，整条腿上下挪）、foot（脚掌，可以不写；写了它就一直保持动作里的朝向，不跟着腿歪）、forward 和 side（这只脚踩在哪里，模型像素，往前和往它自己的左边；不写就用建模时这条腿最下端的位置）、knee（建模时伸直的腿往哪边弯：forward 或 back，默认 forward；建模时已经弯着的腿照它自己的方向弯）；` +
  `body 写腿上面那根骨骼（身体或者骨盆）；rise_speed、fall_speed（脚往上抬、往下落每秒最多多少格，${FOOT_RANGE.speed[0]} 到 ${FOOT_RANGE.speed[1]}，默认 ${FOOT_DEFAULTS.rise_speed} 和 ${FOOT_DEFAULTS.fall_speed}）；max_drop（脚最多往下够、往上抬多少格，${FOOT_RANGE.max_drop[0]} 到 ${FOOT_RANGE.max_drop[1]}，默认 ${FOOT_DEFAULTS.max_drop}）。最多 ${FOOT_RANGE.feet} 条腿；腿的骨骼和 body 不能再写进 follow。` +
  `每只脚找它脚下方块的顶面，腿弯曲去够，body 往下沉到最低的那只脚也够得着；前后都有脚的（三条腿以上）还会按前后的高低差前倾或后仰，左右都有脚的按左右的高低差侧倾；两条腿的不倾斜。跳起来、掉下去、骑在别的东西上时不算，脚回到动作里的位置。` +
  `例：蜥蜴走上台阶，前脚踩在高半格的台阶上、后脚还在下面，身体顺着台阶前高后低；两条腿的生物一只脚踩在台阶边上，另一条腿弯下去够到下面一级。踩地的效果要在游戏里走过台阶或斜坡查看。`

/**
 * The exact sentences a maker of a creature's model is given besides `ANIMATION_GUIDE` (version 3): how one clip
 * goes over into another (`blend`), which bones keep walking under it (`layered`), and the bones that sway by
 * themselves (`follow`). Not the script's: it says nothing of what a script may name.
 */
export const LOOK_GUIDE = "头要会看人，在模型上写 look.bones，从脖根到头按顺序列 bone、share（分摊的比例，加起来最多 1）、yaw 和 pitch（这一节左右、上下各能转多少度）。比如脖子分三成，头分七成。头转多快在生物的 steady.head.turn 写，每秒多少度；模型的 look.speed 只给没写稳重的小怪兜底。"
export const SWAY_GUIDE = "待机的小动作用 sway。每一串写 bones（从根到梢）、axis（x、y 或 z）、speed（每秒几次）和 amount（幅度）。耳朵写 rotation，独立胸廓呼吸写 scale，上下浮动写 position。尾巴用 phase 让后一节晚一点，grow 让梢摆得更大。避开托着踩地腿的骨骼。"
export const WEIGHT_GUIDE = "动作里用 weights 控制看向 look、摆动 sway、跟随 follow 和挂链 hang 各显示几成。每层按秒写最多八个 {time,value} 点，value 从 0 到 1，中间直线过渡。循环动作每层只写一个点；没写的层照常显示。蓄力先盯住目标，挥下去时把 look 降到 0，收招再回到 1。分段招式在每段自己的动作里写。受击或普通近战连续重播同名动作时，权重时间沿用上一次的起点。"
export const CLIP_PLAY_GUIDE =
  `一个动作还可以写两样（都可以不写或写 null）：blend——这个动作开始时从当时的姿势过渡到它、结束时从它过渡到接下来的姿势要多少 tick（1 秒 20 tick，0 到 ${BLEND_MOST}，不写就是立刻切换）；过渡时动作照常从第 0 秒开始放，只是开头和结尾这几个 tick 里看到的是两种姿势按比例混在一起。layered: true——招式用的动作放的时候，它没有写通道的骨骼继续由 walk 或 idle 带着动（比如它只写了上半身的骨骼，下半身照常走路），生物放招式的同时还会继续朝目标走；不写 layered 时，放招式的时候 walk 和 idle 都停下，生物站着出招。hurt 本来就是这样叠在走路上的；别的动作写了 layered 也不起作用。` +
  `模型还可以写 follow：一些骨骼不靠关键帧，而是跟着上一级骨骼和身体的移动自己晃——每一项写 bone（骨骼名），可以写 period（来回晃一次要多少秒，0.2 到 3，默认 ${FOLLOW_DEFAULTS.period}）、damping（晃动停下来的快慢，0.05 到 1，1 是不来回晃、慢慢回到原位，默认 ${FOLLOW_DEFAULTS.damping}）、drag（身体每秒移动 1 格时它往后拖多少度，0 到 30，默认 ${FOLLOW_DEFAULTS.drag}）、limit（最多偏开多少度，1 到 90，默认 ${FOLLOW_DEFAULTS.limit}）、x_range（只管 x 方向前后晃的范围 [最小, 最大] 度，-90 到 90，写了它 x 方向就不按 limit：贴着后背的披风写 [0, 60]，只往后飘、不往前穿进身体）。它的晃动加在关键帧的转动上面；一串骨骼都写 follow，晃动会一节一节传下去。预览图里的晃动和游戏里用同一种算法，从动作开头、身体不动时算起（walk 按它自己的速度往前走）。` +
  HANG_GUIDE +
  FOOT_GUIDE + LOOK_GUIDE + SWAY_GUIDE + WEIGHT_GUIDE

/** The widest a track's keys are apart on one axis; 0 for a track with no keys or one. */
export function trackSpan(keys: readonly TrackKey[]) {
  return keys.length ? Math.max(...[0, 1, 2].map((axis) => Math.max(...keys.map((key) => key.value[axis]!)) - Math.min(...keys.map((key) => key.value[axis]!)))) : 0
}

/** Model pixels and scale from which a position or scale track counts as doing something at all: a quarter of a pixel, a fiftieth of the size. */
export const TRACK_MOVES = { position: 0.25, scale: 0.02 } as const

/** True when a channel moves or scales its bone, whatever it does by turning. */
export function shiftsOrScales(channel: ClipChannel) {
  const tracks = channelTracks(channel)
  return trackSpan(tracks.position) >= TRACK_MOVES.position || trackSpan(tracks.scale) >= TRACK_MOVES.scale
}

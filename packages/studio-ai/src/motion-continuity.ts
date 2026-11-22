import { measureCrossing } from "./motion-crossing"
import { hangingBones } from "./hang-chains"
import { channelTracks } from "./animation"
import type { ModelDesign } from "./contracts"
import { FAULT_SLACK, GAME_PIXELS, MOTION_VISIBLE, STANDING_ABOVE, groundSlack, jointSlack, posedCorners, type MotionClip } from "./model-motion"

/**
 * What a strip of still frames hides about a motion, measured: whether a loop joins up, whether anything
 * jumps between two game ticks, whether what stands on the ground stays on it, whether parts run into each
 * other, where the weight is, and whether everything moves at once. From the document alone, through the
 * same posing arithmetic as `model-motion.ts` (so whatever a clip can carry there is measured here), and
 * with no knowledge of what the thing is: nothing here says how anything should move.
 */

type Vec = [number, number, number]
type Design = Pick<ModelDesign, "bones" | "follow">

/** The game's own grain of time: a creature's state advances twenty times a second. Every measure here compares poses one tick apart. */
export const TICK = 1 / 20

/**
 * The public thresholds, each from the screen or from arithmetic, never from the subject. Lengths are in
 * model pixels unless said otherwise; one model pixel is `GAME_PIXELS` (about 6) screen pixels at the size
 * the game usually shows a creature (`MOTION_VISIBLE`).
 *
 * `jump` (screen pixels): a change with no time in between — the end of a loop snapping to its start, or
 *   one tick that stands alone — is seen from the same `MOTION_VISIBLE.pixels` at which an edge is seen to
 *   shift at all; below it nothing on the screen jumps.
 * `alone`: a step is a jump, not fast motion, only when it stands alone: this many times the clip's usual
 *   step and this many times the steps on both sides of it. A swing that slows at its ends has a largest
 *   step about 1.4 times its usual one, an eased curve about 2; three is beyond what any smooth curve
 *   sampled at ticks gives, and a fast stretch that lasts two ticks or more is never counted.
 * `grain`: one model pixel, the grain of the art and of the ground (a block's face is drawn in the same
 *   pixels): a foot that slips, sinks or a part that enters another by less than one pixel changes no whole
 *   pixel of either surface and reads as touching. About six screen pixels. It is where a depth starts to be
 *   *told* as a fact (a line in the "连起来看" sentence); since 10-14 it is no longer where one becomes a fault:
 *   see `FAULT_SLACK` (`model-motion.ts`) — sinking, going off the ground and entering another part are faults only
 *   past `groundSlack` / `jointSlack` (2.5 model pixels at least, more for a large creature), the owner having
 *   decided that no obvious error is enough. Everything between `grain` and the allowance is said, never held against it.
 * `slip`: a planted part that slides over the ground by less than two model pixels in a cycle is not seen to
 *   slide (12 screen pixels along a step that takes a second); `skate` already holds only to half or one and a half
 *   times the ground, `slip` keeps that from firing on a creature whose whole step is a pixel or two.
 * `touch`: a gap under `MOTION_VISIBLE.pixels` screen pixels cannot be seen, so a part that close to the
 *   ground is on it (a planted part, measured from the model's own lowest point). Whether the whole model is built on the ground or clear of
 *   it is not asked with this but with `STANDING_ABOVE` (`model-motion.ts`), the number the static standard uses for the same question.
 * `skate`: with the creature's speed known, planted feet are held to it only grossly. The game plays one
 *   walking clip at every pace (a creature that chases at 1.2 times its pace covers 1.44 times the ground),
 *   so no clip fits all of them; a foot that covers less than half or more than one and a half times the
 *   ground the body covers fits none.
 *   (Since 10-07 the generated creature plays its moving clip at the rate
 *   its body is really carried at — `PACE` below — so what `skate` still measures is how far the tempo the
 *   maker looked at is from the tempo the game will play.)
 */
export const CONTINUITY = { jump: MOTION_VISIBLE.pixels, alone: 3, grain: 1, slip: 2, touch: MOTION_VISIBLE.pixels / GAME_PIXELS, skate: 0.5 } as const

/** The clips the game plays while the creature moves over the ground (`fabric/entity.ts`: `state.isMoving() ? WALK : IDLE`). Only these are measured for planted feet. */
export const MOVING_CLIPS: readonly string[] = ["walk"]

/** The faults a measured clip can have. Each is answered by its maker: changed, or justified in the sheet (`CONTINUITY_GATE` are changed, never justified). Never a refusal of the version. */
export const CONTINUITY_FAULTS = ["seam", "pop", "slide", "sink", "afloat", "cross", "glide"] as const
export type ContinuityFault = (typeof CONTINUITY_FAULTS)[number]

/**
 * The gate (10-07, after a creature was seen carried over the ground with nothing stepping): the faults a
 * maker's own reason cannot answer. A reason explains a look that is meant; these are not looks but a
 * contradiction between the clip and what the game does with it, whatever the thing is:
 *
 * `glide`: the game plays this clip while it carries the body forward over the ground, the thing stands on
 *   the ground (it is not built hovering), parts of it touch the ground during the clip, and while they touch
 *   none of them ever goes back along it — all of them together by less than `CONTINUITY.touch`, the gap
 *   that cannot be seen. Then nothing on the screen carries the body: every moment it is on the ground it is
 *   dragged over it at its full speed, and no playing rate fixes that (zero times any rate is zero). Stepping,
 *   pushing off, rolling and creeping all take a touching part back and are not this.
 *
 * A version with one of these is still kept (the standard does not refuse it); its maker may not call it
 * finished, a reviewer is told it is blocking, and when the versions run out the best one goes to the person
 * marked unsatisfied with this as the reason, like every other making that ends without a pass.
 */
export const CONTINUITY_GATE: readonly ContinuityFault[] = ["glide"]

/**
 * Blocks a second a creature walks at, from its movement speed attribute and the pace its goal asks for.
 * The game's own arithmetic (read from the 1.21.1 classes: `MoveControl` sets both the creature's speed and
 * its forward input to attribute × pace, the input is damped by 0.98, and on ordinary ground the velocity
 * keeps 0.6 × 0.91 of itself each tick), so the steady speed goes with the square.
 */
export const walkingSpeed = (attribute: number, pace = 1) => (20 * 0.98 * (attribute * pace) ** 2) / (1 - 0.6 * 0.91)

/**
 * How the generated creature decides that it is moving and how fast it plays its moving clip
 * (`mod-core/fabric/entity.ts` writes these numbers into the Java; nothing here is about a subject).
 *
 * Why (10-07, read from the classes): GeckoLib 4.8.3 calls a creature moving when the mean of |vx| and |vz|
 * of the velocity the client holds is at least 0.015 blocks a tick (`GeoRenderer.getMotionAnimThreshold`).
 * What a walking mob keeps as velocity after a tick is 0.6 × 0.91 of what it moved, so that test is only
 * passed from about 1.1 blocks a second along an axis. Goals and gameplay code walk creatures at any pace
 * (`walkingSpeed` goes with the square of it): one at 0.18 × 0.45 covers 0.28 blocks a second, was never
 * "moving", and was shown idling while it slid along. The game's own limb animator has no such floor: every
 * tick it takes four times the ground the body covered (`LivingEntity.updateLimbs`), eased by 0.4.
 *
 * `blend`: ticks the movement controller takes to blend between idling and moving.
 * `moving`: the body is seen to move when it shifts `MOTION_VISIBLE.pixels` screen pixels — the same shift
 *   at which anything is seen to move — within that blend; slower than that it stands, as far as the eye can
 *   tell, and it idles. In blocks a tick.
 * `amount`: the same as the limb animator's amount (four times the blocks a tick).
 * `frames`: the fewest ticks one cycle of a clip may take and still show both ends of a stride and the two
 *   moments between; faster than that the game's twenty ticks a second cannot show it. The playing rate is
 *   capped there; it has no floor, because a body that barely moves should barely step.
 */
const BLEND = 4
const SEEN = MOTION_VISIBLE.pixels / GAME_PIXELS / 16 / BLEND
export const PACE = { blend: BLEND, moving: SEEN, amount: 4 * SEEN, frames: 4 } as const

/**
 * What the game is given to play a moving clip by: the blocks a second at which the parts that touch the
 * ground stay where they are on it (0: nothing to hold the clip to — it hovers, nothing touches, or nothing
 * goes back — and it is played as written), and the most times its own speed it may be played at.
 */
export function clipPace(design: Design, clip: MotionClip) {
  const pose = standing(design, clip)
  const walk = MOVING_CLIPS.includes(clip.name.toLowerCase()) && !pose.hovering ? planted(pose, null) : null
  return { speed: walk && walk.stride >= CONTINUITY.touch ? walk.speed : 0, most: rounded(Math.max(1, clip.length / (PACE.frames * TICK))) }
}

// Model pixels below which two positions are the same position: arithmetic noise, not motion.
const SAME = 0.001
// Moments compared for what costs most (parts against parts, a part against itself over time): a longer clip is sampled evenly.
const MOMENTS = 48
// Upper bound on the corner comparisons made for the order of movement in one clip.
const TIMING_BUDGET = 6_000_000

const apart = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
const rounded = (value: number, digits = 2) => Number(value.toFixed(digits))
const evenly = <Value>(values: Value[], count: number) => (values.length <= count ? values : Array.from({ length: count }, (_, index) => values[Math.round((index * (values.length - 1)) / (count - 1))]!))

/** The furthest any corner is between two poses, and which corner. */
function furthest(a: Vec[], b: Vec[], skip?: ReadonlySet<number>) {
  const found = { travel: 0, corner: -1 }
  for (let corner = 0; corner < a.length; corner++) {
    if (skip?.has(corner)) continue
    const travel = apart(a[corner]!, b[corner]!)
    if (travel > found.travel) Object.assign(found, { travel, corner })
  }
  return found
}

/**
 * Where a clip switches on purpose: a `step` key (animation.ts) holds its value until the next key, and the
 * jump there is what the document asks for, not a fault. The moments of those next keys; `Infinity` stands
 * for the turn of a loop, when a track's last key is held to the end.
 */
const stepped = (clip: MotionClip) =>
  clip.channels.flatMap((channel) => Object.values(channelTracks(channel)).flatMap((keys) => keys.flatMap((key, index) => (key.interpolation === "step" ? [keys[index + 1]?.time ?? Infinity] : []))))

type Part = { name: string; parent: string | null; from: number; to: number; volumes: number[] }
type Standing = { times: number[]; poses: Vec[][]; rest: Vec[]; parts: Part[]; ground: number; hovering: boolean }

/** A clip posed tick by tick, with the parts of the model (each bone that carries cubes, as the run of corners that is its own) and the ground it stands on. */
function standing(design: Design, clip: MotionClip): Standing {
  const times = [...Array.from({ length: Math.floor(clip.length / TICK + 1e-6) + 1 }, (_, tick) => rounded(tick * TICK, 3)), ...(clip.length % TICK > 1e-6 && TICK - (clip.length % TICK) > 1e-6 ? [clip.length] : [])]
  const poses = times.map((time) => posedCorners(design, clip, time))
  const rest = posedCorners(design, null)
  const parts = design.bones.reduce<Part[]>((list, bone) => {
    const from = list.at(-1)?.to ?? 0
    return [...list, { name: bone.name, parent: bone.parent, from, to: from + bone.cubes.length * 8, volumes: bone.cubes.map((cube) => cube.size[0] * cube.size[1] * cube.size[2]) }]
  }, []).filter((part) => part.to > part.from)
  // Ground: the level its lowest point stands on as built. A thing built clear of the ground hovers, and nothing about standing is asked of it.
  // "Clear of the ground" is the static standard's own number (`STANDING_ABOVE`, one pixel, what `off_ground` calls standing), not `CONTINUITY.touch`:
  // with two numbers a walker built 0.4 to 1 pixel up passed the standard as standing and was called hovering here, so it escaped the glide gate.
  const ground = Math.min(...rest.map((point) => point[1]))
  return { times, poses, rest, parts, ground, hovering: ground > STANDING_ABOVE }
}

/**
 * Planted parts of a clip the game plays while the creature moves: the body goes forward (-Z), so a point on the ground goes back (+Z) in the model's own space at the same speed.
 * The caller has settled that the model stands on the ground (it does not hover).
 */
function planted({ times, poses, rest, parts, ground }: Omit<Standing, "hovering">, speed: number | null) {
  const supports = parts
    .map((part) => {
      const own = Array.from({ length: part.to - part.from }, (_, index) => part.from + index)
      const floor = Math.min(...own.map((corner) => rest[corner]![1]))
      const sole = own.filter((corner) => rest[corner]![1] <= floor + CONTINUITY.touch)
      const down = poses.map((pose) => Math.min(...own.map((corner) => pose[corner]![1])) <= ground + CONTINUITY.touch)
      const where = poses.map((pose) => sole.reduce((sum, corner) => sum + pose[corner]![2], 0) / sole.length)
      // Each tick it stays down through: how far its sole goes back, and how long that takes. Going forward while down is dragging, counted apart.
      const spans = times.slice(1).flatMap((time, index) => (down[index] && down[index + 1] ? [{ back: where[index + 1]! - where[index]!, seconds: time - times[index]! }] : []))
      return { name: part.name, touches: down.some(Boolean), pushes: spans.filter((span) => span.back >= -SAME), drag: spans.reduce((sum, span) => sum + Math.max(0, -span.back), 0) }
    })
    .filter((part) => part.touches)
  const pushes = supports.flatMap((part) => part.pushes)
  const seconds = pushes.reduce((sum, span) => sum + span.seconds, 0)
  const implied = seconds > 0 ? pushes.reduce((sum, span) => sum + span.back, 0) / seconds / 16 : 0
  const slid = supports.map((part) => ({
    name: part.name,
    drag: part.drag,
    stride: part.pushes.reduce((sum, span) => sum + span.back, 0),
    slide: part.pushes.reduce((sum, span) => sum + Math.abs(span.back - (speed ?? implied) * 16 * span.seconds), 0),
    covered: part.pushes.reduce((sum, span) => sum + (speed ?? implied) * 16 * span.seconds, 0),
  }))
  const worst = [...slid].sort((a, b) => b.slide - a.slide)[0]
  return {
    /** Parts that are on the ground at some moment of the clip. */
    supports: supports.length,
    /** Blocks a second at which the planted parts would stay where they are on the ground. */
    speed: rounded(implied),
    /** The creature's own speed in blocks a second; null when it is not known here. */
    declared: speed === null ? null : rounded(speed),
    /** Model pixels the worst planted part slips over the ground in one cycle, at the declared speed, or at the implied one when none is declared. */
    slide: rounded(worst?.slide ?? 0),
    slider: worst && worst.slide > SAME ? worst.name : null,
    /** Model pixels the longest stride carries a planted part back in one cycle. */
    stride: rounded(Math.max(0, ...slid.map((part) => part.stride))),
    /** Model pixels the worst part travels forward while still down: a step taken without lifting. */
    drag: rounded(Math.max(0, ...slid.map((part) => part.drag))),
    skates: speed !== null && Boolean(worst) && worst!.slide >= CONTINUITY.slip && worst!.slide >= CONTINUITY.skate * worst!.covered,
    /** Parts touch the ground and none of them is ever seen to go back along it: the body is carried over it by nothing (`CONTINUITY_GATE`). */
    glides: supports.length > 0 && Math.max(0, ...slid.map((part) => part.stride)) < CONTINUITY.touch,
  }
}

/**
 * One clip, measured tick by tick. `speed` is the creature's walking speed in blocks a second when it is
 * known (`walkingSpeed`); without it the planted parts say what speed they imply. `still`: the part sheet declares
 * this clip meant to be still; it only counts while the speed is unknown (see `unwalked` below).
 */
export function measureContinuity(design: Design, clip: MotionClip, speed: number | null = null, still = false) {
  const { times, poses, rest, parts, ground, hovering } = standing(design, clip)
  const owner = (corner: number) => parts.find((part) => corner >= part.from && corner < part.to)?.name ?? null

  // Seam and steps: how far the pose changes from one tick to the next, and from the end of a loop back to its start.
  const steps = times.slice(1).map((_, index) => furthest(poses[index]!, poses[index + 1]!))
  const moving = steps.map((step) => step.travel).filter((travel) => travel > SAME).sort((a, b) => a - b)
  const typical = moving.length ? moving[Math.floor((moving.length - 1) / 2)]! : 0
  const hanging = clip.loop ? hangingBones(design) : new Set<string>()
  const separate = hanging.size ? new Set(parts.filter((part) => hanging.has(part.name)).flatMap((part) => Array.from({ length: part.to - part.from }, (_, index) => part.from + index))) : undefined
  const seam = clip.loop ? furthest(poses.at(-1)!, poses[0]!, separate) : null
  const held = stepped(clip)
  // The first tick of a clip that plays once is where it sets in: the game blends into it, and a sudden start is the event itself.
  const judged = steps.map((step, index) => ({ ...step, index, around: Math.max(steps[index - 1]?.travel ?? (clip.loop ? steps.at(-1)!.travel : 0), steps[index + 1]?.travel ?? (clip.loop ? steps[0]!.travel : 0)) })).filter((step) => (clip.loop || step.index > 0) && !held.some((time) => time > times[step.index]! + 1e-6 && time <= times[step.index + 1]! + 1e-6))
  const alone = judged.filter((step) => step.travel * GAME_PIXELS >= CONTINUITY.jump && step.travel >= CONTINUITY.alone * typical && step.travel >= CONTINUITY.alone * step.around)
  const largest = [...(alone.length ? alone : judged)].sort((a, b) => b.travel - a.travel)[0] ?? null

  // Sinking and floating are counted from the ground itself (y = 0) when the model was built a little under it (allowed, `groundSlack`), so a model built under the
  // ground by some pixels does not also get the same again for a clip: the two together are what a player sees.
  const level = Math.max(ground, 0)
  // What may be under the ground, off it or inside another part before it is a fault (`FAULT_SLACK`): in proportion to the creature as built.
  const slack = {
    joint: rounded(jointSlack(Math.max(...[0, 1, 2].map((axis) => Math.max(...rest.map((point) => point[axis]!)) - Math.min(...rest.map((point) => point[axis]!)))))),
    ground: rounded(groundSlack(Math.max(...rest.map((point) => point[1])) - ground)),
  }
  const lows = poses.map((pose) => Math.min(...pose.map((point) => point[1])))
  const lowest = Math.min(...lows)

  // Planted parts of a clip the game plays while the creature moves (`planted`). Not measured when the creature is known not to walk, or, with no speed known yet (a model is made before the creature that wears it),
  // when the part sheet declares this clip meant to be still. Why: a creature that never walks never plays its moving clip, so what its feet do in that clip is nobody's glide or slide; the creature stage measures it
  // again once the speed is known (`glidingWalk`), so declaring a clip still does not let a creature that does walk through.
  const unwalked = speed === 0 || (speed === null && still)
  const walk = MOVING_CLIPS.includes(clip.name.toLowerCase()) && !hovering && !unwalked ? planted({ times, poses, rest, parts, ground }, speed) : null

  const { worst: crossing, coverage: crossingCoverage } = measureCrossing(parts, times, poses, rest, evenly(times.map((_, index) => index), MOMENTS))

  // Weight: where the middle of all the boxes (each weighed by its volume, as if the thing were of one stuff) falls on the ground at the moment furthest from the built pose, against the rectangle around everything that is down then.
  const extreme = poses.map((pose, index) => ({ index, travel: furthest(pose, rest).travel })).sort((a, b) => b.travel - a.travel)[0]!
  const balance = hovering || extreme.travel <= SAME ? null : weighed(poses[extreme.index]!, lows[extreme.index]!)
  function weighed(pose: Vec[], low: number) {
    const cubes = parts.flatMap((part) => part.volumes.map((volume, cube) => ({ volume, middle: [0, 2].map((axis) => pose.slice(part.from + cube * 8, part.from + cube * 8 + 8).reduce((sum, point) => sum + point[axis]!, 0) / 8) })))
    const volume = cubes.reduce((sum, cube) => sum + cube.volume, 0)
    const down = pose.filter((point) => point[1] <= low + CONTINUITY.grain)
    if (volume <= 0 || low > ground + CONTINUITY.grain) return null
    const centre = [0, 1].map((axis) => cubes.reduce((sum, cube) => sum + cube.middle[axis]! * cube.volume, 0) / volume)
    // Past the rectangle on each axis. This space mirrors the document's X (`posedCorners`), so -X is its own left; -Z is its front.
    const past = [0, 2].map((axis, index) => Math.max(0, centre[index]! - Math.max(...down.map((point) => point[axis]!))) - Math.max(0, Math.min(...down.map((point) => point[axis]!)) - centre[index]!))
    const off = Math.hypot(past[0]!, past[1]!)
    return {
      at: times[extreme.index]!,
      /** Model pixels the weight falls outside what stands on the ground; 0 when it is over it. */
      off: rounded(off),
      way: off <= SAME ? null : Math.abs(past[1]!) >= Math.abs(past[0]!) ? (past[1]! < 0 ? ("front" as const) : ("back" as const)) : past[0]! < 0 ? ("left" as const) : ("right" as const),
    }
  }

  // Timing: for every part that is seen to move, the two moments it is furthest apart between. Parts that share both reach their ends together, whichever way each goes.
  const allMoments = evenly(times.map((_, index) => index), MOMENTS * 2)
  const timingLimit = Math.max(2, Math.floor((1 + Math.sqrt(1 + (8 * TIMING_BUDGET) / Math.max(1, rest.length))) / 2))
  const moments = evenly(allMoments, timingLimit)
  const comparisons = (count: number) => (count * (count - 1)) / 2
  const timingCoverage = moments.length < allMoments.length ? { checked: comparisons(moments.length), total: comparisons(allMoments.length) } : undefined
  const ends = parts.flatMap((part) => {
    const found = { travel: 0, from: 0, to: 0 }
    for (let corner = part.from; corner < part.to; corner++)
      for (let a = 0; a < moments.length; a++)
        for (let b = a + 1; b < moments.length; b++) {
          const from = poses[moments[a]!]![corner]!, to = poses[moments[b]!]![corner]!
          const dx = from[0] - to[0], dy = from[1] - to[1], dz = from[2] - to[2]
          const threshold = found.travel + SAME
          // Keep the original distance and comparison at close calls, including rounding ties.
          if (dx * dx + dy * dy + dz * dz < threshold * threshold * (1 - Number.EPSILON * 8)) continue
          const travel = Math.hypot(dx, dy, dz)
          if (travel > threshold) Object.assign(found, { travel, from: a, to: b })
        }
    return found.travel * GAME_PIXELS >= MOTION_VISIBLE.pixels ? [`${found.from}-${found.to}`] : []
  })
  const together = Math.max(0, ...[...new Set(ends)].map((key) => ends.filter((value) => value === key).length))

  const faults: ContinuityFault[] = [
    ...(seam && !held.includes(Infinity) && seam.travel * GAME_PIXELS >= CONTINUITY.jump && seam.travel > typical ? (["seam"] as const) : []),
    ...(alone.length ? (["pop"] as const) : []),
    // A clip that glides has no stride to hold to a speed: it is the one fault, not both.
    ...(walk?.skates && !walk.glides ? (["slide"] as const) : []),
    ...(!hovering && level - lowest > slack.ground ? (["sink"] as const) : []),
    ...(!hovering && lowest - level > slack.ground ? (["afloat"] as const) : []),
    ...(crossing.more > slack.joint ? (["cross"] as const) : []),
    ...(walk?.glides ? (["glide"] as const) : []),
  ]
  return {
    /** Loops: model pixels the pose is off between the last moment and the first; null for a clip that plays once. */
    seam: seam ? rounded(seam.travel) : null,
    seam_part: seam && seam.travel > SAME ? owner(seam.corner) : null,
    /** The largest change within one tick, in model pixels (a step that stands alone, when there is one), when it happens, and what moves. */
    step: rounded(largest?.travel ?? 0),
    step_at: largest ? times[largest.index + 1]! : 0,
    step_part: largest && largest.travel > SAME ? owner(largest.corner) : null,
    /** The usual change within one tick: the middle one of all ticks in which anything moves. */
    typical: rounded(typical, 3),
    /** Built clear of the ground: nothing about standing on it is measured. */
    hovering,
    /** Model pixels the lowest point goes under the ground at the worst moment. A fault only past `slack.ground` (`FAULT_SLACK`). */
    sink: hovering ? 0 : rounded(Math.max(0, level - lowest)),
    /** Model pixels between the ground and the lowest point at the moment it is nearest: above 0, nothing ever touches. A fault only past `slack.ground`. */
    gap: hovering ? 0 : rounded(Math.max(0, lowest - level)),
    walk,
    /** The two parts (not parent and child) that go deepest into each other beyond how they are built, by how many model pixels, and when; null when none do. A fault only past `slack.joint`. */
    cross: crossing.more > SAME ? { a: crossing.a, b: crossing.b, more: rounded(crossing.more), at: crossing.at } : null,
    balance,
    /** What a depth may be before it is a fault (`FAULT_SLACK`), in model pixels, for this creature: entering another part (`joint`), under the ground or off it (`ground`). */
    slack,
    /** Parts seen to move at game size, and the most of them that reach their two ends at the same ticks. */
    movers: ends.length,
    together,
    faults,
    ...(crossingCoverage || timingCoverage ? { sampling: { ...(crossingCoverage ? { crossing: crossingCoverage } : {}), ...(timingCoverage ? { timing: timingCoverage } : {}) } } : {}),
  }
}

export type ContinuityMeasure = ReturnType<typeof measureContinuity>

/** What is measured and said as a fact with every look, by the criterion it bears on (`acceptance.ts` `told`): for a model's own motions and for a motion made on its own. */
export const CONTINUITY_TOLD = {
  not_mechanical: "每个动作里看得出在动的部件有几个是同时到头的、有几个错开了先后",
  sound:
    `每个动作按游戏每秒 20 刻逐刻量：循环的最后一刻和第一刻接不接得上、有没有哪一刻突然跳一下、最低处有没有陷进地面或者整段碰不到地面、不相连的部件有没有比站着时穿得更深（穿插和部件先后在大模型上有计算限额，若抽查会给实际比例；陷进、离地和穿进都要超过 ${FAULT_SLACK.ground} 个模型像素才算毛病，高大的生物更宽一些；再小的只当事实告诉你，不用改）、动作最大的那一刻重心落在着地范围里面还是外面；移动时放的动作还量着地的部件在地上滑了多少、照这样摆它每秒该走几格。其中接不上、突然跳、陷进地里、整段离地、穿得更深和打滑超过公开的门槛（陷进、离地、穿进要超过 ${FAULT_SLACK.ground} 个模型像素，打滑要滑过 ${CONTINUITY.slip} 个）时，制作者要么改掉，要么在部件说明里写明理由，否则不能说做完；移动时放的动作里着地的部件从头到尾没有往后走（整个平移）是硬门槛，只能改掉，写理由不算`,
} as const

/**
 * The moving clip of a model that glides at the creature's own speed (`walkingSpeed`), or null: the same measure as the model stage's gate
 * (`CONTINUITY_GATE`), run on the planted parts only. Why only those: the creature stage runs it on every review of every creature, and the
 * rest of `measureContinuity` (parts in parts, weight, timing) is the dear part and says nothing about whether the feet carry the body.
 * A creature that does not walk (speed 0) or a model built hovering has nothing to glide.
 */
export function glidingWalk(design: Pick<ModelDesign, "bones" | "animations">, speed: number) {
  if (speed === 0) return null
  for (const clip of design.animations as MotionClip[]) {
    if (!MOVING_CLIPS.includes(clip.name.toLowerCase())) continue
    const stage = standing(design, clip)
    const walk = stage.hovering ? null : planted(stage, speed)
    if (walk?.glides) return { clip: clip.name, supports: walk.supports }
  }
  return null
}

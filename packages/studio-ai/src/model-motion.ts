import { channelTracks, sampleTrack, type TrackKey } from "./animation"
import type { ModelDesign } from "./contracts"

/**
 * How much a motion actually moves, as facts: from the document alone (bones, pivots, cubes, keyframes),
 * with no knowledge of what the thing is. A clip is played through the animation contract's own sampler
 * (animation.ts), so turning, moving and scaling, curved or held, are all measured as they will be shown. Still frames side by side hide a small motion from anyone, so
 * whoever looks at a motion is given these numbers with the pictures, and one threshold says when a
 * motion cannot be seen at all. Nothing here says how anything should move.
 */

type Vec = [number, number, number]
type Bone = ModelDesign["bones"][number]
export type MotionClip = Pick<ModelDesign["animations"][number], "name" | "length" | "loop" | "channels" | "weights">

/**
 * When a motion can be seen. The one public threshold, derived from the screen and not from the subject:
 * a creature is usually watched from about `distance` blocks (half the 16 blocks at which creatures notice
 * a player) with the game's default lens (`fov` degrees, vertical) on a screen `screen` pixels high. There
 * one model pixel covers about six screen pixels. The game draws without smoothing, so a point that travels
 * less than one screen pixel changes nothing on the screen, and one that travels a single pixel only makes
 * an edge flicker; from `pixels` screen pixels on, an edge is seen to shift. Below that the motion is
 * reported as not visible, whatever it is a motion of.
 */
export const MOTION_VISIBLE = { distance: 8, fov: 70, screen: 1080, pixels: 2 } as const

/** Screen pixels one model pixel covers at the size the game usually shows a creature (about 6). */
export const GAME_PIXELS = MOTION_VISIBLE.screen / (2 * MOTION_VISIBLE.distance * 16 * Math.tan((MOTION_VISIBLE.fov * Math.PI) / 360))

/**
 * 2026-10-14 (the owner's standing decision: "motion quality gates, a foot not lifting on the return step for one, should not be too
 * strict — no obvious errors is enough"). How far a model may be wrong in the ways that are measured as depths, before a player
 * sees it. Lengths are model pixels (16 to a block). One model pixel is `GAME_PIXELS` (about 6) screen pixels at 8 blocks and about 12 at
 * 4 blocks, which is as close as creatures are usually watched; so none of the amounts below is more than a few percent of the screen.
 * Most are amounts a part is *inside* something or *under* the ground, which is hidden: it is only seen when it was the whole of a thing
 * (a part pushed so far in that it is gone, or comes out of the far side), so each is set against the size of the thinnest things that are
 * drawn. A gap, which shows what is behind it, is not treated that way:
 *
 * `joint`: how far two solid parts may be inside each other where they join (a wing root in the body, a leg in the trunk, a membrane
 *   on its bone): 2.5. Vanilla's thinnest limbs are 2 pixels thick (a spider's leg is 16×2×2) and its usual ones 4 (zombie, cow); a part
 *   pushed less than 2.5 into a part 4 thick still has a pixel and a half of solid in front of it and cannot come out of the far side, and
 *   2.5 pixels are 15 screen pixels at 8 blocks, 1.4 % of the screen's height. It is the amount a tester's rounding calls "2 pixels":
 *   "3 pixels" is over it. `jointShare`: the parts of a large creature are thicker in proportion, so the allowance grows with the
 *   creature's largest extent (a twentieth of it) once that is more than the floor.
 * `ground`: how far a creature may be under the ground, or its lowest part off it, where it stands: 2.5, a fifth of the 12-pixel legs of
 *   the usual walker (zombie, cow): the foot is still four fifths of its length, and 15 screen pixels at 8 blocks is below the size at
 *   which a foot reads as gone. `groundShare`: the same for a tall creature in proportion to its height (8 %), so a boss three blocks
 *   tall is not held to the pixel of a bat. For scale, a vanilla 4-pixel foot on a 12-pixel leg swung from the hip goes under the
 *   ground by only h²/2L = 0.17 pixel, so nothing a swing does by itself comes near this; it is for what a maker adds (a body lowered
 *   for a pounce, a wing beat that pulls the claws in).
 * `gap`: how wide a gap two parts that should touch may have before the model is called to fall apart: 0.8, as it was, *not* widened. A gap
 *   shows what is behind it, which an overlap never does: one pixel of it is a line six screen pixels wide through a leg at 8 blocks (the
 *   paws of the rejected lanjing-guard specimen, one pixel off their legs). Kept here so the one place that says what is tolerated says
 *   that this is not.
 *
 * Not loosened by these: anything the game's behaviour depends on (the collision boxes, the clip the game plays while the body is carried,
 * the required clips) and anything a player sees a whole part of (floating several pixels, sinking by a fifth of a leg or more, parts
 * through each other by several pixels, a part left on its own).
 */
export const FAULT_SLACK = { joint: 2.5, jointShare: 0.05, ground: 2.5, groundShare: 0.08, gap: 0.8 } as const

/**
 * How far above y=0 the lowest point of a model may be built and still be standing on the ground: one model pixel, the grain of the art and of the
 * ground (a block's face is drawn in the same pixels), so less than that changes no whole pixel of either and reads as touching.
 * ONE number for both questions that ask whether a model stands: the static standard (`off_ground`, and which unnamed parts are legs, in
 * `model-quality.ts` / `model-look.ts`) and the clip measure (`hovering` in `motion-continuity.ts`, which decides whether the planted-foot
 * analysis, the `glide` gate, applies). 10-14 (audit): they used to differ (1 pixel against `CONTINUITY.touch`, a third of a pixel), so a walker
 * built 0.4 to 1 pixel up was "standing" to the first, "hovering" to the second and so skipped the glide gate. The planted-foot analysis
 * itself is relative to the model's own lowest point (`ground`), so a model built a few tenths up is measured the same as one on y=0.
 */
export const STANDING_ABOVE = 1

/** Model pixels two solid parts may be inside each other at a joint, for a creature whose largest extent (any axis) is `extent` model pixels. */
export const jointSlack = (extent: number) => Math.max(FAULT_SLACK.joint, FAULT_SLACK.jointShare * extent)
/** Model pixels a creature `height` model pixels tall may be under the ground, or its lowest part off it, before a player sees it. */
export const groundSlack = (height: number) => Math.max(FAULT_SLACK.ground, FAULT_SLACK.groundShare * height)

/**
 * What every maker, reviewer and person is told about the amounts of `FAULT_SLACK`: which findings are must-fix and which are not worth a
 * round. One text, so the model guide, the motion guide, the self-review and the reviewer say the same numbers.
 */
export const SLACK_WORDS =
  `这几样要超过一定的量才算毛病，量以内是正常的接缝，不用改，更不要为它花一版：` +
  `两个部件在连接处互相插进去（翅根插进身体、腿根插进躯干、膜插在骨上……）不超过 ${FAULT_SLACK.joint} 个模型像素；` +
  `脚或身体陷进地面、或者整段动作都没落到地面（站着、走、飞、悬停、收翅，每个动作都一样量），不超过 ${FAULT_SLACK.ground} 个模型像素。` +
  `高大的生物再宽一些：陷进和离地按身高的 ${Math.round(FAULT_SLACK.groundShare * 100)}%，穿插按最大边长的 ${Math.round(FAULT_SLACK.jointShare * 100)}%，哪个大按哪个。` +
  `按游戏里常见的大小（离它 ${MOTION_VISIBLE.distance} 格远，1 个模型像素约 ${Math.round(GAME_PIXELS)} 个屏幕像素），这些量玩家看不出来：被盖住的部分本来就看不见，露出来的只是少了一小截。` +
  `玩家看得出、必须改的是超过它的：整个部件钻进了别的部件或者从另一面穿出来、脚陷进地里一大截（腿长的五分之一以上）、整只悬在地面上方好几个像素。留缝不同：哪怕只有 1 个像素，背景从缝里透出来也看得见，部件和身体之间不能留缝。` +
  `走路往回摆时脚没有抬离地面、翼膜后缘有台阶、边缘有锯齿，都只是可以更好的，不是必须改的。`

// Moments compared with each other; a clip with more is sampled evenly among them.
const SAMPLES = 32
// Degrees a track may turn between two compared moments: a wider turn between two keys is cut into steps, so a full spin is not mistaken for standing still.
const STEP = 45
// Moments looked at inside a stretch between two keys where some track curves.
const CURVE = 4
// Model pixels below which two positions are the same position: arithmetic noise, not motion.
const SAME = 0.001

type Tracks = ReturnType<typeof channelTracks>

/** One track inside a clip that is not played round: the end of a loop is its last key, not its first again. */
const sample = (keys: readonly TrackKey[], clip: MotionClip, time: number) => sampleTrack(keys, Math.min(Math.max(time, 0), clip.length), clip.loop)

/**
 * Every cube corner of the model at one moment of a clip (null: the pose it is built in), eight per cube in
 * document order, in the viewport's space and in model pixels. The same arithmetic as `modelBounds`, with
 * what the clip adds to each bone: its scale about its pivot, then its angles on top of the bone's own, then
 * its move along the axes of the bone above. The end of a loop is its last key, not its first again.
 */
export function posedCorners(design: Pick<ModelDesign, "bones">, clip: MotionClip | null, time = 0): Vec[] {
  const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
  const tracks = new Map<string, Tracks>(clip?.channels.map((channel) => [channel.bone, channelTracks(channel)]))
  const added = (bone: string, track: keyof Tracks) => (clip && tracks.has(bone) ? sample(tracks.get(bone)![track], clip, time) : undefined)
  const angles = new Map(design.bones.map((bone) => [bone.name, bone.rotation.map((angle, axis) => (((angle + (added(bone.name, "rotation")?.[axis] ?? 0)) * Math.PI) / 180) * (axis === 2 ? 1 : -1))]))
  const moves = new Map(design.bones.map((bone) => [bone.name, added(bone.name, "position") ?? [0, 0, 0]]))
  const scales = new Map(design.bones.map((bone) => [bone.name, added(bone.name, "scale") ?? [1, 1, 1]]))
  // What every corner of a bone needs is worked out once for the bone: the cosines and sines of its three angles, its scale and its move.
  // The arithmetic and its order are what they were when each corner worked them out again, so every number comes out the same.
  const turns = new Map(
    design.bones.map((bone) => {
      const [x, y, z] = angles.get(bone.name)!
      return [bone.name, { cos: [Math.cos(x!), Math.cos(y!), Math.cos(z!)] as Vec, sin: [Math.sin(x!), Math.sin(y!), Math.sin(z!)] as Vec, size: scales.get(bone.name)!, move: moves.get(bone.name)! }]
    }),
  )
  const lift = (point: Vec, bone: Bone, depth: number): Vec => {
    const { cos, sin, size, move } = turns.get(bone.name)!
    const sized: Vec = [point[0] * size[0]!, point[1] * size[1]!, point[2] * size[2]!]
    const a: Vec = [sized[0], sized[1] * cos[0] - sized[2] * sin[0], sized[1] * sin[0] + sized[2] * cos[0]]
    const b: Vec = [a[0] * cos[1] + a[2] * sin[1], a[1], -a[0] * sin[1] + a[2] * cos[1]]
    const parent = bone.parent && depth < design.bones.length ? bones.get(bone.parent) : undefined
    // The viewport's space mirrors the document's X, so a move towards the document's +X goes to -X here.
    const placed: Vec = [
      b[0] * cos[2] - b[1] * sin[2] - bone.pivot[0] + (parent?.pivot[0] ?? 0) - move[0]!,
      b[0] * sin[2] + b[1] * cos[2] + bone.pivot[1] - (parent?.pivot[1] ?? 0) + move[1]!,
      b[2] + bone.pivot[2] - (parent?.pivot[2] ?? 0) + move[2]!,
    ]
    return parent ? lift(placed, parent, depth + 1) : placed
  }
  return design.bones.flatMap((bone) =>
    bone.cubes.flatMap((cube) =>
      Array.from({ length: 8 }, (_, corner) =>
        lift([bone.pivot[0] - cube.origin[0] - (corner & 1 ? cube.size[0] : 0), cube.origin[1] + (corner & 2 ? cube.size[1] : 0) - bone.pivot[1], cube.origin[2] + (corner & 4 ? cube.size[2] : 0) - bone.pivot[2]], bone, 0),
      ),
    ),
  )
}

const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const crossOf = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dotOf = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * How deep two boxes are in each other: the least distance one would have to move to get clear, along the
 * fifteen axes that can separate two boxes (their edges and the edges crossed). Zero when apart. Boxes are
 * given as their eight corners in the order `posedCorners` lists them (bit 0 of the index is x, bit 1 y, bit 2 z; any box laid out so
 * serves); a box with no thickness has nothing to enter.
 * 10-14: along each axis that is the shorter way out (`min(maxA - minB, maxB - minA)`), not the length the two ranges share. The two
 * are the same while the ranges only cross, and differ once one lies inside the other: a one-pixel membrane lying in a body shares only its
 * own pixel of thickness whatever its depth, and so could never be deeper than a pixel, which a tolerance in pixels (`FAULT_SLACK.joint`)
 * could not tell from a membrane lying on its bone. Shared by the look gate (cubes as built) and the motion gate (cubes in a clip).
 */
export function penetration(a: Vec[], b: Vec[]) {
  const edges = [a, b].map((box) => [1, 2, 4].map((corner) => minus(box[corner]!, box[0]!)))
  if (edges.flat().some((edge) => Math.hypot(...edge) < SAME)) return 0
  const axes = [...edges[0]!, ...edges[1]!, ...edges[0]!.flatMap((left) => edges[1]!.map((right) => crossOf(left, right)))]
  return axes.reduce((least, axis) => {
    const length = Math.hypot(...axis)
    if (least === 0 || length < SAME) return least
    const along = [a, b].map((box) => box.map((point) => dotOf(point, axis) / length))
    return Math.max(0, Math.min(least, Math.min(Math.max(...along[0]!) - Math.min(...along[1]!), Math.max(...along[1]!) - Math.min(...along[0]!))))
  }, Infinity)
}

// Three numbers are the common case by far (every corner of every box at every tick): the same sum, without a list made for each.
const apart = (a: readonly number[], b: readonly number[]) => (a.length === 3 ? Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) : Math.hypot(...a.map((value, axis) => value - b[axis]!)))
const rounded = (value: number, digits = 2) => Number(value.toFixed(digits))

/**
 * What one clip does to the model, measured. `project` turns a point into picture pixels for one camera;
 * with it the same travel is also given as it shows in that picture.
 */
export function measureMotion(design: Pick<ModelDesign, "bones">, clip: MotionClip, project?: (point: Vec) => readonly [number, number]) {
  const known = clip.channels.filter((channel) => design.bones.some((bone) => bone.name === channel.bone)).map((channel) => ({ bone: channel.bone, tracks: channelTracks(channel) }))
  const every = known.flatMap((channel) => [channel.tracks.rotation, channel.tracks.position, channel.tracks.scale])
  const keys = [...new Set([0, ...every.flatMap((track) => track.map((key) => Math.min(key.time, clip.length))), clip.length])].sort((a, b) => a - b)
  const keyed = keys.flatMap((time, index) => {
    const before = keys[index - 1]
    if (before === undefined) return [time]
    const turned = Math.ceil(Math.max(0, ...known.flatMap((channel) => (channel.tracks.rotation.length ? sample(channel.tracks.rotation, clip, time)!.map((value, axis) => Math.abs(value - sample(channel.tracks.rotation, clip, before)![axis]!)) : []))) / STEP)
    // A curve can reach further between two keys than at either of them.
    const curved = every.some((track) => track.some((key, at) => key.time < time && (track[at + 1]?.time ?? -1) > before && (key.interpolation === "smooth" || track[at + 1]?.interpolation === "smooth" || key.interpolation === "bezier" || track[at + 1]?.interpolation === "bezier" || Boolean(key.easing))))
    const steps = Math.min(8, Math.max(turned, curved ? CURVE : 1))
    return [...Array.from({ length: Math.max(0, steps - 1) }, (_, step) => rounded(before + ((time - before) * (step + 1)) / steps, 3)), time]
  })
  const times = keyed.length <= SAMPLES ? keyed : Array.from({ length: SAMPLES }, (_, index) => keyed[Math.round((index * (keyed.length - 1)) / (SAMPLES - 1))]!)
  // A frame drawn at the very end of a loop shows its start again; a hair earlier it shows the last key.
  const shown = (index: number) => (clip.loop && times[index]! >= clip.length ? rounded(clip.length - 0.001, 3) : times[index]!)
  const poses = times.map((time) => posedCorners(design, clip, time))
  const flat = project ? poses.map((pose) => pose.map(project)) : null
  const rest = posedCorners(design, null)
  const owners = design.bones.flatMap((bone) => bone.cubes.flatMap((cube) => Array.from({ length: 8 }, () => ({ bone: bone.name, cube: cube.name }))))
  // How far each corner gets from itself over the clip, and how far apart any two moments are as whole poses.
  const reach = owners.map(() => 0)
  const gaps = times.map(() => times.map(() => 0))
  const most = { travel: 0, corner: -1, from: 0, to: 0, picture: 0 }
  for (let a = 0; a < times.length; a++)
    for (let b = a + 1; b < times.length; b++)
      for (let corner = 0; corner < owners.length; corner++) {
        const travel = apart(poses[a]![corner]!, poses[b]![corner]!)
        if (travel > reach[corner]!) reach[corner] = travel
        if (travel > gaps[a]![b]!) gaps[a]![b] = gaps[b]![a] = travel
        if (travel > most.travel) Object.assign(most, { travel, corner, from: a, to: b })
        if (flat) most.picture = Math.max(most.picture, apart(flat[a]![corner]!, flat[b]![corner]!))
      }
  const moved = new Set(owners.filter((_, corner) => reach[corner]! > SAME).map((owner) => owner.bone))
  // The widest any one track's keys are apart on one axis: degrees, model pixels, or scale.
  const span = (track: "rotation" | "position" | "scale") => Math.max(0, ...known.filter((channel) => channel.tracks[track].length).map((channel) => Math.max(...[0, 1, 2].map((axis) => Math.max(...channel.tracks[track].map((key) => key.value[axis]!)) - Math.min(...channel.tracks[track].map((key) => key.value[axis]!))))))
  // The moments that differ most from each other, the two extremes first: each next one is the moment furthest from all chosen so far.
  const pick = (chosen: number[]): number[] => {
    const next = times.map((_, index) => index).filter((index) => !chosen.includes(index)).map((index) => ({ index, gap: Math.min(...chosen.map((other) => gaps[index]![other]!)) })).sort((a, b) => b.gap - a.gap || a.index - b.index)[0]
    return next && next.gap > SAME ? pick([...chosen, next.index]) : chosen
  }
  return {
    name: clip.name,
    /** Model pixels the most-moving corner travels between its two furthest positions in the clip. */
    travel: rounded(most.travel),
    /** The part that corner belongs to; null when nothing moves. */
    mover: most.travel > SAME ? owners[most.corner]! : null,
    /** The two moments, in seconds, between which it travels that far. */
    between: (most.travel > SAME ? [shown(most.from), shown(most.to)] : [0, 0]) as [number, number],
    /** Model pixels any corner gets away from where it is in the pose the model is built in. */
    // Folded, not spread into one call: every corner of every sampled moment is one number, and a model of 900 cubes sampled at 20 moments is 150 000 of them,
    // more arguments than a call may take (RangeError, 2026-11-18: any big model with a hanging chain, a smoothed or an eased motion could not be looked at).
    from_rest: rounded(poses.reduce((most, pose) => pose.reduce((far, point, corner) => Math.max(far, apart(point, rest[corner]!)), most), 0)),
    /** Parts (bones that carry cubes) whose cubes move at all, out of how many there are. */
    moving: moved.size,
    parts: design.bones.filter((bone) => bone.cubes.length > 0).length,
    /** The largest swing of any one track on one axis, in degrees. */
    turn: rounded(span("rotation"), 1),
    /** The widest any one position track moves a part on one axis, in model pixels; 0 when the clip moves nothing by position. */
    shift: rounded(span("position")),
    /** The widest any one scale track changes on one axis (1 = from the built size to twice it); 0 when the clip scales nothing. */
    stretch: rounded(span("scale")),
    /** The same travel at the size the game usually shows a creature, in screen pixels. */
    game: rounded(most.travel * GAME_PIXELS, 1),
    /** The same travel in the picture `project` draws, in its pixels; null without one. */
    picture: project ? rounded(most.picture, 1) : null,
    /** Model pixels from the lowest to the highest corner in the built pose: what the travel is small or large against. */
    tall: rounded(Math.max(0, ...rest.map((point) => point[1])) - Math.min(0, ...rest.map((point) => point[1])), 1),
    /** Nothing travels far enough to be seen at game size. */
    unseen: most.travel * GAME_PIXELS < MOTION_VISIBLE.pixels,
    /** Moments worth a still frame, the most different first. Empty when nothing moves. */
    moments: most.travel > SAME ? pick([most.from, most.to]).map(shown) : [],
  }
}

export type MotionMeasure = ReturnType<typeof measureMotion>

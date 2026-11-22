import { FOOT_DEFAULTS, type Clip, type FootPlacement } from "./animation"
import type { ModelDesign } from "./contracts"
import { apply, boneTip, euler, IDENTITY, minus, mul, placeOf, pivotOf, plus, pointOf, rigOf, rigParents, swing, times, trackMove, trackTurn, transposed, turnBone, moveBone, under, dot, length, type M3, type Rig, type V3 } from "./pose-rig"

/**
 * 第 2 步 (踩地): a model's `foot_placement`, on every player's game alone. Each frame each foot looks at the ground under where it stands
 * (`forward`/`side`, turned with the body): the top of the highest block shape there, no more than `max_drop` blocks above or below the creature.
 * Its height goes there at no more than `rise_speed` blocks a second up and `fall_speed` down (`footGround`), and none of it while the creature is
 * off the ground. Then (`footSolve`, model space):
 *
 * - with feet in front and behind (three or more), `body` tilts nose down by the difference of the front and the back feet over how far apart they
 *   stand; with feet on both sides, it rolls the same way (at most `FEET.tilt` degrees each); a creature on two feet does neither;
 * - `body` drops (or rises) as far as the leg that needs it most, after the tilt, needs to reach its foot without stretching beyond what it
 *   spans in the motion: on an even slope that is about the feet's average;
 * - each leg reaches its foot's new height: a thigh and a calf bend as a triangle of their own lengths, in the plane they already bend in (a leg built
 *   straight bends its knee `knee`); a leg of one bone moves up or down whole; a `foot` keeps the turn the motion gives it, so it stays flat.
 *
 * The preview runs `footSolve` on a test ground (`footClip`), the game the same steps in Java (mod-core `fabric/pose-rig-java.ts`).
 */

/** The most degrees the body tilts either way; model pixels under which a foot counts as not lifted at all. */
export const FEET = { tilt: 30, still: 1e-3 } as const

type Design = Pick<ModelDesign, "bones"> & { foot_placement?: FootPlacement | null }
export type FootPlan = {
  feet: {
    thigh: number
    /** -1: a leg of one bone. */
    calf: number
    foot: number
    /** The bone whose point `point` is: the foot, else the calf, else the thigh. */
    end: number
    /** Where the foot meets the ground as the model is built (model space). */
    point: V3
    corners: V3[]
    /** Where it looks for the ground: model pixels forward and to its own left. */
    forward: number
    side: number
    /** 1: a straight leg bends its knee forwards; -1 backwards. */
    knee: number
    /** Whether `body` carries this leg. */
    under: boolean
  }[]
  body: number
  pitch: boolean
  roll: boolean
  rise: number
  fall: number
  drop: number
}

/** The plan of a design's feet, or null when it has none. Bones it does not have are left out (the document is refused for them). */
export function footPlan(design: Design): FootPlan | null {
  const placement = design.foot_placement
  if (!placement?.feet.length) return null
  const index = new Map(design.bones.map((bone, at) => [bone.name, at]))
  const parent = rigParents(design)
  const body = placement.body ? (index.get(placement.body) ?? -1) : -1
  const feet = placement.feet.flatMap((written) => {
    const thigh = index.get(written.thigh)
    if (thigh === undefined) return []
    const calf = written.calf ? (index.get(written.calf) ?? -1) : -1
    const foot = written.foot ? (index.get(written.foot) ?? -1) : -1
    const end = foot >= 0 ? foot : calf >= 0 ? calf : thigh
    const bone = design.bones[end]!
    const point: V3 = foot >= 0 ? [-bone.pivot[0], bone.pivot[1], bone.pivot[2]] : (boneTip(design, end) ?? [-bone.pivot[0], bone.pivot[1], bone.pivot[2]])
    const corners = bone.cubes.flatMap(cube => {
      const grow = cube.inflate ?? 0
      const pivot = cube.pivot ?? cube.origin.map((value,i)=>value + cube.size[i]! / 2)
      const rotation = cube.rotation ?? [0,0,0]
      const matrix = euler(-rotation[0]*Math.PI/180,-rotation[1]*Math.PI/180,rotation[2]*Math.PI/180)
      const centre: V3 = [-pivot[0]!,pivot[1]!,pivot[2]!]
      return Array.from({length:8},(_,i)=>{
        const at: V3 = [-(cube.origin[0]+(i&1 ? cube.size[0]+grow : -grow)),cube.origin[1]+(i&2 ? cube.size[1]+grow : -grow),cube.origin[2]+(i&4 ? cube.size[2]+grow : -grow)]
        return plus(centre,apply(matrix,minus(at,centre)))
      })
    })
    return [{ thigh, calf, foot, end, point, corners: corners.length ? corners : [point], forward: written.forward ?? -point[2], side: written.side ?? -point[0], knee: written.knee === "back" ? -1 : 1, under: body >= 0 && under({ parent }, thigh, body) }]
  })
  if (!feet.length) return null
  const spread = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return values.some((value) => value > mean + 1) && values.some((value) => value < mean - 1)
  }
  return {
    feet,
    body,
    pitch: body >= 0 && feet.length >= 3 && spread(feet.map((foot) => foot.forward)),
    roll: body >= 0 && feet.length >= 3 && spread(feet.map((foot) => foot.side)),
    rise: placement.rise_speed ?? FOOT_DEFAULTS.rise_speed,
    fall: placement.fall_speed ?? FOOT_DEFAULTS.fall_speed,
    drop: placement.max_drop ?? FOOT_DEFAULTS.max_drop,
  }
}

/** A foot's ground height after `seconds`: towards `target`, at most `rise` blocks a second up and `fall` down. */
export const footGround = (now: number, target: number, rise: number, fall: number, seconds: number) => now + Math.max(-fall * seconds, Math.min(rise * seconds, target - now))

/** The mean of `value` over the feet `pick` takes; 0 for none. */
function meanOf(plan: FootPlan, pick: (foot: FootPlan["feet"][number]) => boolean, value: (foot: FootPlan["feet"][number], index: number) => number) {
  let sum = 0
  let count = 0
  plan.feet.forEach((foot, index) => {
    if (!pick(foot)) return
    sum += value(foot, index)
    count++
  })
  return count ? sum / count : 0
}

/** How `body` tilts for feet lifted by `lift` (model pixels each): nose down by the front feet's being lower, rolled towards the lower side. */
export function footTilt(plan: FootPlan, lift: readonly number[]): M3 {
  const most = (FEET.tilt * Math.PI) / 180
  const clamp = (angle: number) => Math.max(-most, Math.min(most, angle))
  let turn = IDENTITY
  if (plan.pitch) {
    const middle = meanOf(plan, () => true, (foot) => foot.forward)
    const front = (foot: FootPlan["feet"][number]) => foot.forward > middle
    const back = (foot: FootPlan["feet"][number]) => foot.forward < middle
    const apart = meanOf(plan, front, (foot) => foot.forward) - meanOf(plan, back, (foot) => foot.forward)
    turn = euler(-clamp(Math.atan2(meanOf(plan, back, (_, at) => lift[at]!) - meanOf(plan, front, (_, at) => lift[at]!), apart)), 0, 0)
  }
  if (plan.roll) {
    const middle = meanOf(plan, () => true, (foot) => foot.side)
    const left = (foot: FootPlan["feet"][number]) => foot.side > middle
    const right = (foot: FootPlan["feet"][number]) => foot.side < middle
    const apart = meanOf(plan, left, (foot) => foot.side) - meanOf(plan, right, (foot) => foot.side)
    turn = mul(euler(0, 0, clamp(Math.atan2(meanOf(plan, right, (_, at) => lift[at]!) - meanOf(plan, left, (_, at) => lift[at]!), apart))), turn)
  }
  return turn
}

/** A thigh and a calf bent so the leg's end reaches `target` (model space), as a triangle of their lengths in the plane they bend in. */
function reach(rig: Rig, foot: FootPlan["feet"][number], target: V3) {
  const hip = pivotOf(rig, foot.thigh)
  const knee = pivotOf(rig, foot.calf)
  const end = pointOf(rig, foot.end, foot.point)
  const upper = length(minus(knee, hip))
  const lower = length(minus(end, knee))
  const toward = minus(target, hip)
  const far = length(toward)
  if (upper < 1e-6 || lower < 1e-6 || far < 1e-6) return
  const way = times(toward, 1 / far)
  const span = Math.max(Math.abs(upper - lower) + 1e-4, Math.min(upper + lower - 1e-4, far))
  const along = minus(knee, hip)
  let out = minus(along, times(way, dot(along, way)))
  if (length(out) < 1e-4 * upper) {
    const above = rig.parent[foot.thigh]! < 0 ? IDENTITY : placeOf(rig, rig.parent[foot.thigh]!).r
    const hint = apply(above, [0, 0, -foot.knee])
    out = minus(hint, times(way, dot(hint, way)))
    if (length(out) < 1e-9) return
  }
  out = times(out, 1 / length(out))
  const cos = Math.max(-1, Math.min(1, (upper * upper + span * span - lower * lower) / (2 * upper * span)))
  const bent = plus(hip, times(plus(times(way, cos), times(out, Math.sqrt(1 - cos * cos))), upper))
  turnBone(rig, foot.thigh, swing(along, minus(bent, hip), 1))
  const kneeNow = pivotOf(rig, foot.calf)
  const endNow = pointOf(rig, foot.end, foot.point)
  turnBone(rig, foot.calf, swing(minus(endNow, kneeNow), minus(plus(hip, times(way, span)), kneeNow), 1))
}

/** Puts the rig's feet `lift` model pixels above (or below) where the motion puts them, the body and the legs following. As the game's `footSolve`. */
export const soleHeight = (rig: Rig, foot: FootPlan["feet"][number]) => Math.min(...foot.corners.map(corner => pointOf(rig,foot.end,corner)[1]))

export function footSolve(rig: Rig, plan: FootPlan, lift: readonly number[], contact: readonly number[] = lift, surface?: (point: V3) => number) {
  const support = plan.feet.map((foot,i) => contact[i]! - soleHeight(rig,foot))
  if (!surface && lift.every(value => Math.abs(value) < FEET.still) && support.every(value => Math.abs(value) < FEET.still)) return
  const ends = plan.feet.map((foot) => pointOf(rig, foot.end, foot.point))
  const turns = plan.feet.map((foot) => (foot.foot >= 0 ? placeOf(rig, foot.foot).r : IDENTITY))
  if (plan.body >= 0) {
    const tilt = footTilt(plan, lift)
    const centre = pivotOf(rig, plan.body)
    // As low as the leg that needs it most: its hip (where the tilt takes it) no further above its foot's new place than the leg now spans.
    let drop = Infinity
    plan.feet.forEach((foot, index) => {
      if (!foot.under) return
      const hip = pivotOf(rig, foot.thigh)
      const end = ends[index]!
      const span = length(minus(end, hip))
      const turned = plus(centre, apply(tilt, minus(hip, centre)))
      const dx = end[0] - turned[0]
      const dz = end[2] - turned[2]
      drop = Math.min(drop, end[1] + lift[index]! - soleHeight(rig,foot) + Math.sqrt(Math.max(span * span - (dx * dx + dz * dz), 0)) - turned[1])
    })
    turnBone(rig, plan.body, tilt)
    if (drop !== Infinity) moveBone(rig, plan.body, [0, drop, 0])
  }
  plan.feet.forEach((foot, index) => {
    const target = plus(ends[index]!, [0, support[index]!, 0])
    if (foot.calf >= 0) reach(rig, foot, target)
    else moveBone(rig, foot.thigh, [0, target[1] - pointOf(rig, foot.end, foot.point)[1], 0])
    if (foot.foot >= 0) turnBone(rig, foot.foot, mul(turns[index]!, transposed(placeOf(rig, foot.foot).r)))
    // The solved calf can turn a corner below the point used by IK. Correct the remaining sole offset without rotating the knee.
    const correction = surface ? Math.max(...foot.corners.map(corner => {
      const at = pointOf(rig,foot.end,corner)
      return surface(at) - at[1]
    })) : contact[index]! - soleHeight(rig,foot)
    moveBone(rig,foot.thigh,[0,correction,0])
  })
}

/** The bones `footSolve` may turn or move, each once: the body, then each leg's. */
export const footBones = (plan: FootPlan) => [...new Set([...(plan.body >= 0 ? [plan.body] : []), ...plan.feet.flatMap((foot) => [foot.thigh, foot.calf, foot.foot].filter((bone) => bone >= 0))])]

/**
 * A clip as the preview shows it standing on uneven ground (`ground(x, z)`: the top of the ground in blocks, at a point of the world where the
 * creature stands at the origin facing +Z, its own left towards +X): every foot settled where it looks, the creature standing as high as its
 * highest foot's ground (as the game stands a creature on the highest block under it). Keyed at `moments` (seconds) only: the clip is for pictures
 * of those moments. Returns the clip and `level`, the height (blocks) it stands at, and each foot's lift (blocks).
 */
export function footClip<C extends Clip>(design: Design, clip: C, ground: (x: number, z: number) => number, moments: readonly number[]): { clip: C; level: number; lifts: number[] } {
  const plan = footPlan(design)
  if (!plan) return { clip, level: 0, lifts: [] }
  const heights = plan.feet.map((foot) => ground(foot.side / 16, foot.forward / 16))
  const level = Math.max(...heights)
  const lifts = heights.map((height) => Math.max(-plan.drop, Math.min(plan.drop, height - level)))
  const bones = footBones(plan)
  const parent = rigParents(design)
  const times = [...new Set(moments.map((time) => Math.min(Math.max(time, 0), clip.length)))].sort((a, b) => a - b)
  const posed = times.map((time) => {
    const rig = rigOf(design, clip, time, new Map(), parent)
    footSolve(
      rig,
      plan,
      lifts.map((lift) => lift * 16), undefined,
      point => 16 * Math.max(-plan.drop,Math.min(plan.drop,ground(-point[0]/16,-point[2]/16)-level)),
    )
    return rig
  })
  const kept = clip.channels.filter((channel) => !bones.some((bone) => design.bones[bone]!.name === channel.bone))
  const channels = bones.map((bone) => {
    const written = clip.channels.find((channel) => channel.bone === design.bones[bone]!.name)
    return {
      bone: design.bones[bone]!.name,
      keyframes: times.map((time, index) => ({ time, rotation: trackTurn(design, posed[index]!, bone) })),
      position: times.map((time, index) => ({ time, position: trackMove(posed[index]!, bone) })),
      scale: written?.scale ?? null,
    }
  })
  return { clip: { ...clip, channels: [...kept, ...channels] }, level, lifts }
}

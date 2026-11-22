import { channelTracks, clipCursor, followOf, hangs, sampleTrack, type Clip, type ClipChannel, type FollowBone } from "./animation"
import type { ModelDesign } from "./contracts"
import { hangMotion } from "./hang-chains"

/**
 * Follow bones (第 2 步, version 3 of the animation contract): bones a model names in `follow` lag and sway
 * after the bone above them and after the body's movement, a damped spring per axis, on top of whatever the
 * clip's keys turn them by. This is the one arithmetic: the preview (`followClip`) plays it here, and the game
 * plays the same steps in Java (`StudioPose` in a creature's renderer, mod-core `fabric/entity-pose.ts`), client side only.
 *
 * Per axis, in degrees and in the document's axes (see orientation.ts: a positive x turn swings what hangs
 * below the pivot backwards, a positive z turn swings it to its own right):
 * - `P` is where the bone's keys and the bones above it point it: the sum of every ancestor's turn (its keys'
 *   and, for a follow bone above it, its sway), plus the body's own yaw on y;
 * - `d` is how far movement drags it: `drag` degrees per block a second, backwards for moving forwards (x)
 *   and away from the side it moves towards (z);
 * - the bone's own angle `w` is a spring towards `P + d`: w'' = k (P + d - w) - c w' (k = (2π/period)², c = 2 · damping · √k:
 *   the air holds it back, so a bone above it that keeps turning keeps it trailing); stepped `STEPS_PER_TICK` times a game tick (semi-implicit Euler);
 * - its sway is w - P, never more than `limit` either way, or on x within `x_range` when it has one (beyond, it is held at the
 *   edge and turns as fast as P).
 */

/** Steps of the spring in one game tick (1/20 s): small enough for the stiffest spring allowed (a period of 0.2 s) to stay steady. */
export const STEPS_PER_TICK = 4
const STEP = 1 / 20 / STEPS_PER_TICK
/** Seconds a loop is played before its sway is shown, so that it is the sway it settles into and not the start from rest. */
const SETTLE = 3

type Vec = [number, number, number]
type Design = Pick<ModelDesign, "bones"> & { follow?: readonly FollowBone[] | null }

/** The spring's numbers for one follow bone, from what the model writes. */
export function followSpring(follow: FollowBone) {
  const full = followOf(follow)
  const k = ((2 * Math.PI) / full.period) ** 2
  return { ...full, k, c: 2 * full.damping * Math.sqrt(k) }
}

/** One follow bone's state: its angle and how fast it turns, per axis. */
export type FollowState = { w: Vec; v: Vec }

/**
 * One step of one follow bone: `parent` is P now, `parentBefore` P one step earlier, `drag` d now. Returns its
 * sway (w - P). The same arithmetic, in the same order, as the game's.
 */
export function followStep(spring: ReturnType<typeof followSpring>, state: FollowState, parent: Vec, parentBefore: Vec, drag: Vec): Vec {
  return [0, 1, 2].map((axis) => {
    const p = parent[axis]!
    const pv = (p - parentBefore[axis]!) / STEP
    const a = spring.k * (p + drag[axis]! - state.w[axis]!) - spring.c * state.v[axis]!
    state.v[axis] = state.v[axis]! + a * STEP
    state.w[axis] = state.w[axis]! + state.v[axis]! * STEP
    const sway = state.w[axis]! - p
    if (sway >= spring.low[axis]! && sway <= spring.high[axis]!) return sway
    const held = sway < spring.low[axis]! ? spring.low[axis]! : spring.high[axis]!
    state.w[axis] = p + held
    state.v[axis] = pv
    return held
  }) as Vec
}

/** How far movement drags a follow bone: degrees per block a second, backwards on x for moving forwards, away from the side on z. */
export const followDrag = (drag: number, forward: number, left: number): Vec => [drag * forward, 0, drag * left]

/** The follow springs of a design that name a bone of it, parents before children (each one's P counts the sway of those above it). Hanging bones are `hang-chains.ts`'s. */
export function followOrder(design: Design) {
  const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
  const depth = (name: string): number => {
    const parent = bones.get(name)?.parent
    return parent ? 1 + depth(parent) : 0
  }
  return (design.follow ?? []).filter((follow) => !hangs(follow) && bones.get(follow.bone)?.parent).map((follow) => ({ follow, depth: depth(follow.bone) })).sort((a, b) => a.depth - b.depth).map((entry) => entry.follow)
}

/**
 * The sway of every follow bone over one clip as the preview shows it: the body still (or, for `forward`
 * blocks a second, carried forwards as a walk is), from rest at the clip's start; a loop is first played for
 * `SETTLE` seconds so its sway is the one it settles into. Returns, per follow bone, the sway at every step
 * from 0 to the clip's length (`STEP` apart). Empty for a design without follow bones.
 */
export function followSway(design: Design, clip: Clip, forward = 0): Map<string, Vec[]> {
  const run = springRun(design, clip, forward)
  return new Map([...run.all].map(([bone, list]) => [bone, list.slice(-run.start)]))
}

/** The springs' sway at every step from where `followSway` starts them (`start`, a step at or before 0) to the clip's end. */
function springRun(design: Design, clip: Clip, forward: number, weight?: (layer: "follow" | "hang", time: number) => number): { start: number; all: Map<string, Vec[]> } {
  const order = followOrder(design)
  if (!order.length) return { start: 0, all: new Map() }
  const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
  const tracks = new Map(clip.channels.map((channel) => [channel.bone, channelTracks(channel).rotation]))
  const own = (bone: string, time: number): Vec => {
    const keys = tracks.get(bone)
    return keys?.length ? sampleTrack(keys, clipCursor(clip, time), clip.loop)! : [0, 0, 0]
  }
  const springs = order.map((follow) => ({ bone: follow.bone, spring: followSpring(follow), state: { w: [0, 0, 0] as Vec, v: [0, 0, 0] as Vec } }))
  const sway = new Map<string, Vec>(order.map((follow) => [follow.bone, [0, 0, 0]]))
  // P of a bone: every ancestor's keyed turn and sway, summed per axis.
  const parentOf = (bone: string, time: number): Vec => {
    const total: Vec = [0, 0, 0]
    for (let name = bones.get(bone)?.parent ?? null; name; name = bones.get(name)?.parent ?? null) {
      const turn = own(name, time)
      const swayed = sway.get(name) ?? [0, 0, 0]
      for (let axis = 0; axis < 3; axis++) total[axis] = total[axis]! + turn[axis]! + swayed[axis]!
    }
    return total
  }
  const settle = clip.loop ? Math.min(10, Math.ceil(SETTLE / clip.length)) * clip.length : 0
  const steps = Math.round(clip.length / STEP)
  const start = -Math.round(settle / STEP)
  const before = new Map<string, Vec>()
  springs.forEach((entry) => {
    const p = parentOf(entry.bone, start * STEP)
    const d = followDrag(entry.spring.drag, forward, 0)
    entry.state.w = [p[0] + d[0], p[1] + d[1], p[2] + d[2]]
    before.set(entry.bone, p)
    sway.set(entry.bone, d.map((value, axis) => Math.max(entry.spring.low[axis]!, Math.min(entry.spring.high[axis]!, value))) as Vec)
  })
  const all = new Map<string, Vec[]>(order.map((follow) => [follow.bone, []]))
  for (let step = start; step <= steps; step++) {
    const time = step * STEP
    springs.forEach((entry) => {
      const p = parentOf(entry.bone, time)
      const now = step === start ? (sway.get(entry.bone) as Vec) : followStep(entry.spring, entry.state, p, before.get(entry.bone)!, followDrag(entry.spring.drag, forward, 0))
      before.set(entry.bone, p)
      const shown = weight ? now.map(value => value * weight("follow", time)) as Vec : now
      sway.set(entry.bone, shown)
      all.get(entry.bone)!.push([...shown] as Vec)
    })
  }
  return { start, all }
}

/** Keys a follow bone's swayed rotation track is written with in a preview clip: one every game tick. */
const KEY_EVERY = 1 / 20

/**
 * The clip as the preview plays it with its follow bones swaying: each follow bone's rotation track is its own
 * keys plus its sway, written as straight lines one game tick apart. Position and scale tracks are untouched,
 * and a design without follow bones gets the very clip back. Not a document: its tracks may hold more keys than
 * a document may write.
 */
export function followClip<C extends Clip>(design: Design, clip: C, forward = 0, weight?: (layer: "follow" | "hang", time: number) => number): C {
  const run = springRun(design, clip, forward, weight)
  const sways = new Map([...run.all].map(([bone, list]) => [bone, list.slice(-run.start)]))
  // 第 2 步 (挂链): the hanging chains, carried by the springs above them (before the springs start, as they start).
  const hung = hangMotion(design, clip, forward, (step) => new Map([...run.all].map(([bone, list]) => [bone, list[Math.min(Math.max(step - run.start, 0), list.length - 1)]!])), weight ? time => weight("hang", time) : undefined)
  if (!sways.size && !hung.size) return clip
  const sampledFrom = (list: readonly Vec[], time: number): Vec => {
    const at = Math.min(Math.max(time / STEP, 0), list.length - 1)
    const low = Math.floor(at)
    const high = Math.min(low + 1, list.length - 1)
    return [0, 1, 2].map((axis) => list[low]![axis]! + (list[high]![axis]! - list[low]![axis]!) * (at - low)) as Vec
  }
  const sampled = (bone: string, time: number): Vec => sampledFrom(sways.get(bone)!, time)
  const times = [...Array.from({ length: Math.floor(clip.length / KEY_EVERY + 1e-9) + 1 }, (_, index) => Math.round(index * KEY_EVERY * 1000) / 1000), clip.length].filter((time, index, all) => time <= clip.length && all.indexOf(time) === index)
  const channels: ClipChannel[] = clip.channels.filter((channel) => !sways.has(channel.bone) && !hung.has(channel.bone))
  sways.forEach((_, bone) => {
    const written = clip.channels.find((channel) => channel.bone === bone)
    const keys = written ? channelTracks(written).rotation : []
    const keyed = (time: number): Vec => (keys.length ? sampleTrack(keys, Math.min(time, clip.length), clip.loop)! : [0, 0, 0])
    channels.push({
      bone,
      keyframes: times.map((time) => {
        const turn = keyed(time)
        const sway = sampled(bone, time)
        return { time, rotation: [turn[0] + sway[0], turn[1] + sway[1], turn[2] + sway[2]] as Vec }
      }),
      position: written?.position ?? null,
      scale: written?.scale ?? null,
    })
  })
  // A hanging link's rotation is what the chain turned it to, in place of its keys.
  hung.forEach((list, bone) => {
    const written = clip.channels.find((channel) => channel.bone === bone)
    channels.push({ bone, keyframes: times.map((time) => ({ time, rotation: sampledFrom(list, time) })), position: written?.position ?? null, scale: written?.scale ?? null })
  })
  return { ...clip, channels }
}

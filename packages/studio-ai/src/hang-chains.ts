import { HANG_DEFAULTS, hangs, type Clip, type FollowBone } from "./animation"
import type { ModelDesign } from "./contracts"
import { boneTip, pivotOf, pointOf, rigOf, rigParents, swing, trackTurn, turnBone, type Rig, type V3 } from "./pose-rig"

/**
 * 第 2 步 (挂链): follow bones written `mode: "hang"` hang in the world instead of swaying on a spring. A run of them, each the only hanging
 * child of the one above, is one chain: its points are the pivot of every link and the far end of the last (`boneTip`), and they move as
 * points in the world, a quarter tick at a time (Verlet):
 *
 * - each point keeps `keep` of the way it was going (the air and the joints slow it: `damping`) and falls by `gravity`;
 * - it is pulled `pull[i]` of the way back to where the motion puts it (`attract` at the first link, losing `falloff` of it every link down);
 * - then, from the top, each link is put back to its length, pointing where it now points, never further than `limit` degrees from where the
 *   motion points it (when written), and (with `floor`) never under the top of the block below it;
 * - the top point is where the bone above it carries it, every step.
 *
 * Each link is then turned, from the top down, the shortest way from where the motion points it to where its point hangs, `weight` of the way.
 * The preview runs it here (`hangMotion`) and the game the same steps in Java (mod-core `fabric/pose-rig-java.ts`), on every player's game alone.
 */

/** Steps a game tick; blocks a second a second falling at `gravity` 1; the most a point is pulled back in a step (`attract` 1); how far a resting point stays above the floor (blocks). */
export const HANG = { steps: 4, gravity: 16, pull: 0.05, margin: 1 / 16 } as const
const STEP = 1 / 20 / HANG.steps
/** Seconds a chain hangs before what is shown, so it is shown as it settles and not falling from the pose it was built in. */
const SETTLE = 3

type Design = Pick<ModelDesign, "bones"> & { follow?: readonly FollowBone[] | null }
/** Links and the bones they carry move with the hanging simulation. */
export function hangingBones(design: Design): ReadonlySet<string> {
  const links = new Set((design.follow ?? []).filter(hangs).map((entry) => entry.bone))
  if (!links.size) return links
  const parents = new Map(design.bones.map((bone) => [bone.name, bone.parent]))
  const hangsFrom = (name: string, depth: number): boolean => {
    if (links.has(name)) return true
    const parent = parents.get(name)
    return Boolean(parent && depth < parents.size && hangsFrom(parent, depth + 1))
  }
  return new Set(design.bones.filter((bone) => hangsFrom(bone.name, 0)).map((bone) => bone.name))
}

export type HangChain = {
  /** The links, top first: bone indices and names. */
  bones: number[]
  names: string[]
  /** The far end of the last link as the model is built (model space), or null when it ends at the last link's pivot. */
  tip: V3 | null
  /** Blocks fallen in one step, from rest. */
  fall: number
  /** The share of its speed a point keeps from one step to the next. */
  keep: number
  /** The share of the way back to the motion's pose each point (the first below the top first) is pulled in one step. */
  pull: number[]
  /** The cosine and sine of `limit`; a cosine of -2 when there is none. */
  cos: number
  sin: number
  floor: boolean
  weight: number
}

/** How many links of a chain turn: every link with a point below it. */
export const hangLinks = (chain: Pick<HangChain, "bones" | "tip">) => chain.bones.length - 1 + (chain.tip ? 1 : 0)

/** The chains of a design, in the order their top links are written. A chain with nothing to turn is left out (the document is refused for it). */
export function hangChains(design: Design): HangChain[] {
  const hanging = (design.follow ?? []).filter(hangs)
  if (!hanging.length) return []
  const index = new Map(design.bones.map((bone, at) => [bone.name, at]))
  const named = new Set(hanging.map((follow) => follow.bone))
  return hanging
    .filter((follow) => index.has(follow.bone) && !named.has(design.bones[index.get(follow.bone)!]!.parent ?? ""))
    .flatMap((top) => {
      const names = [top.bone]
      for (;;) {
        const below = hanging.filter((follow) => design.bones[index.get(follow.bone) ?? -1]?.parent === names.at(-1))
        if (below.length !== 1 || names.includes(below[0]!.bone)) break
        names.push(below[0]!.bone)
      }
      const bones = names.map((name) => index.get(name)!)
      const tip = boneTip(design, bones.at(-1)!)
      const links = bones.length - 1 + (tip ? 1 : 0)
      if (links < 1) return []
      const damping = top.damping ?? HANG_DEFAULTS.damping
      const attract = top.attract ?? HANG_DEFAULTS.attract
      const falloff = top.falloff ?? HANG_DEFAULTS.falloff
      const limit = top.limit ?? null
      return [
        {
          bones,
          names,
          tip,
          fall: HANG.gravity * (top.gravity ?? HANG_DEFAULTS.gravity) * STEP * STEP,
          keep: Math.pow(1 - 0.5 * damping, 1 / HANG.steps),
          pull: Array.from({ length: links }, (_, link) => HANG.pull * attract * Math.pow(1 - falloff, link)),
          cos: limit === null ? -2 : Math.cos((limit * Math.PI) / 180),
          sin: limit === null ? 0 : Math.sin((limit * Math.PI) / 180),
          floor: top.floor === true,
          weight: top.weight ?? HANG_DEFAULTS.weight,
        },
      ]
    })
}

/** Where the motion puts the chain's points (model space, three numbers a point, the top first). */
export function hangTargets(rig: Rig, chain: HangChain): number[] {
  const points = chain.bones.flatMap((bone) => pivotOf(rig, bone))
  return chain.tip ? [...points, ...pointOf(rig, chain.bones.at(-1)!, chain.tip)] : points
}

/**
 * One step of a chain (blocks, in the world): `x` where its points are, `before` where they were a step ago, `target` where the motion puts them
 * now; `floors` the top of the block under each point (NaN: none), or null when it does not rest on the ground. The same arithmetic, in the same
 * order, as the game's `hangStep`.
 */
export function hangStep(chain: HangChain, x: number[], before: number[], target: number[], floors: readonly number[] | null) {
  const points = x.length / 3
  for (let axis = 0; axis < 3; axis++) {
    x[axis] = target[axis]!
    before[axis] = target[axis]!
  }
  for (let point = 1; point < points; point++) {
    const pull = chain.pull[point - 1]!
    for (let axis = 0; axis < 3; axis++) {
      const at = point * 3 + axis
      const speed = (x[at]! - before[at]!) * chain.keep
      before[at] = x[at]!
      x[at] = x[at]! + speed - (axis === 1 ? chain.fall : 0)
      x[at] = x[at]! + (target[at]! - x[at]!) * pull
    }
  }
  for (let point = 1; point < points; point++) {
    const at = point * 3
    const rx = target[at]! - target[at - 3]!
    const ry = target[at + 1]! - target[at - 2]!
    const rz = target[at + 2]! - target[at - 1]!
    const rest = Math.sqrt(rx * rx + ry * ry + rz * rz)
    let dx = x[at]! - x[at - 3]!
    let dy = x[at + 1]! - x[at - 2]!
    let dz = x[at + 2]! - x[at - 1]!
    const now = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (now > 1e-9) {
      dx /= now
      dy /= now
      dz /= now
    } else if (rest > 1e-9) {
      dx = rx / rest
      dy = ry / rest
      dz = rz / rest
    } else {
      dx = 0
      dy = -1
      dz = 0
    }
    if (chain.cos > -1 && rest > 1e-9) {
      const ax = rx / rest
      const ay = ry / rest
      const az = rz / rest
      const along = dx * ax + dy * ay + dz * az
      if (along < chain.cos) {
        const sx = dx - ax * along
        const sy = dy - ay * along
        const sz = dz - az * along
        const side = Math.sqrt(sx * sx + sy * sy + sz * sz)
        if (side > 1e-9) {
          dx = ax * chain.cos + (sx / side) * chain.sin
          dy = ay * chain.cos + (sy / side) * chain.sin
          dz = az * chain.cos + (sz / side) * chain.sin
        } else {
          dx = ax
          dy = ay
          dz = az
        }
      }
    }
    x[at] = x[at - 3]! + dx * rest
    x[at + 1] = x[at - 2]! + dy * rest
    x[at + 2] = x[at - 1]! + dz * rest
    if (floors !== null && !Number.isNaN(floors[point]!)) {
      const low = floors[point]! + HANG.margin
      if (x[at + 1]! < low) {
        x[at + 1] = low
        before[at + 1] = low
      }
    }
  }
}

/** Turns the chain's links, from the top down, towards where its points hang (`points`, model space), `weight` of the way. As the game's `hangSolve`. */
export function hangSolve(rig: Rig, chain: HangChain, points: readonly number[]) {
  const links = hangLinks(chain)
  for (let link = 0; link < links; link++) {
    const bone = chain.bones[link]!
    const pivot = pivotOf(rig, bone)
    const end = link + 1 < chain.bones.length ? pivotOf(rig, chain.bones[link + 1]!) : pointOf(rig, bone, chain.tip!)
    const want: V3 = [points[(link + 1) * 3]! - pivot[0], points[(link + 1) * 3 + 1]! - pivot[1], points[(link + 1) * 3 + 2]! - pivot[2]]
    turnBone(rig, bone, swing([end[0] - pivot[0], end[1] - pivot[1], end[2] - pivot[2]], want, chain.weight))
  }
}

/** From model space to the world and back, for a body at `at` (blocks) turned to `yaw` degrees (the game's body yaw) and drawn `scale` times its size. */
export function toWorld(points: readonly number[], at: V3, yaw: number, scale: number) {
  const turn = ((180 - yaw) * Math.PI) / 180
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const k = scale / 16
  const out = new Array<number>(points.length)
  for (let point = 0; point < points.length; point += 3) {
    const mx = points[point]! * k
    const my = points[point + 1]! * k
    const mz = points[point + 2]! * k
    out[point] = at[0] + c * mx + s * mz
    out[point + 1] = at[1] + my
    out[point + 2] = at[2] - s * mx + c * mz
  }
  return out
}
export function toModel(points: readonly number[], at: V3, yaw: number, scale: number) {
  const turn = ((180 - yaw) * Math.PI) / 180
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const k = 16 / scale
  const out = new Array<number>(points.length)
  for (let point = 0; point < points.length; point += 3) {
    const wx = points[point]! - at[0]
    const wy = points[point + 1]! - at[1]
    const wz = points[point + 2]! - at[2]
    out[point] = (c * wx - s * wz) * k
    out[point + 1] = wy * k
    out[point + 2] = (s * wx + c * wz) * k
  }
  return out
}

/**
 * The hanging chains over one clip as the preview shows them: the body standing on flat ground (or carried forwards `forward` blocks a second,
 * as a walk is), a loop first played round for a few seconds and anything else held at its start as long, so what is shown is how the chain
 * settles and not its fall from the pose it was built in. `added(step)`: the follow springs' sway at that step (degrees, by bone), which the bones
 * above a chain carry it by. Returns, per link, its rotation track value (degrees, the document's axes) at every step from 0 to the clip's length.
 */
export function hangMotion(design: Design, clip: Clip, forward = 0, added: (step: number) => ReadonlyMap<string, readonly number[]> = () => new Map(), weight?: (time: number) => number): Map<string, V3[]> {
  const chains = hangChains(design)
  if (!chains.length) return new Map()
  const parent = rigParents(design)
  const settle = clip.loop ? Math.min(10, Math.ceil(SETTLE / clip.length)) * clip.length : SETTLE
  const start = -Math.round(settle / STEP)
  const steps = Math.round(clip.length / STEP)
  const state = chains.map(() => ({ x: [] as number[], before: [] as number[] }))
  const shown = new Map<string, V3[]>(chains.flatMap((chain) => chain.names.map((name) => [name, [] as V3[]])))
  for (let step = start; step <= steps; step++) {
    const rig = rigOf(design, clip, step * STEP, added(step), parent)
    const at: V3 = [0, 0, forward * (step - start) * STEP]
    chains.forEach((chain, index) => {
      const target = toWorld(hangTargets(rig, chain), at, 0, 1)
      const own = state[index]!
      if (step === start) {
        own.x = [...target]
        own.before = [...target]
      } else hangStep(chain, own.x, own.before, target, chain.floor ? new Array<number>(target.length / 3).fill(0) : null)
      const shownChain = weight ? { ...chain, weight: chain.weight * weight(step * STEP) } : chain
      hangSolve(rig, shownChain, toModel(own.x, at, 0, 1))
    })
    if (step >= 0) chains.forEach((chain) => chain.bones.forEach((bone, link) => shown.get(chain.names[link]!)!.push(trackTurn(design, rig, bone))))
  }
  return shown
}

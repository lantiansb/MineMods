import { channelTracks, clipCursor, sampleTrack, type Clip } from "./animation"
import type { ModelDesign } from "./contracts"

/**
 * 第 2 步 (挂链和踩地): a model's bones the way GeckoLib holds them while it draws a creature, and the few operations hanging chains
 * (`hang-chains.ts`) and feet on the ground (`foot-placement.ts`) do on them. The game does exactly these steps in Java (mod-core
 * `fabric/pose-rig-java.ts`, the same arithmetic in the same order), so the preview and the game agree to rounding.
 *
 * Model space is GeckoLib's: model pixels, the document's X turned over (see orientation.ts), Y up, the front towards -Z. Per bone, three
 * numbers each: `pivot` (where it turns about), `rot` (radians, the whole turn: the bone's own and its motion's; GeckoLib's signs, so the
 * document's x and y negated), `pos` (the motion's move, model pixels as the document writes it: GeckoLib draws x turned over) and `scale`.
 * A bone's place is its parent's, then its move, then its turn and scale about its pivot (Z after Y after X: `euler`).
 */

export type V3 = [number, number, number]
/** Row-major 3×3. */
export type M3 = number[]
export type Rig = { parent: readonly number[]; pivot: number[]; rot: number[]; pos: number[]; scale: number[] }

export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul(a: M3, b: M3): M3 {
  const out = new Array<number>(9)
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) out[row * 3 + col] = a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!
  return out
}
export const apply = (a: M3, v: V3): V3 => [a[0]! * v[0] + a[1]! * v[1] + a[2]! * v[2], a[3]! * v[0] + a[4]! * v[1] + a[5]! * v[2], a[6]! * v[0] + a[7]! * v[1] + a[8]! * v[2]]
export const transposed = (a: M3): M3 => [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!]
export const plus = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const times = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const length = (a: V3) => Math.sqrt(dot(a, a))

/** A turn as GeckoLib draws it: Z after Y after X (a point goes through X first). */
export function euler(x: number, y: number, z: number): M3 {
  const sa = Math.sin(x)
  const ca = Math.cos(x)
  const sb = Math.sin(y)
  const cb = Math.cos(y)
  const sc = Math.sin(z)
  const cc = Math.cos(z)
  return [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca]
}

const TURN = 2 * Math.PI
/** `value` moved by whole turns to lie within half a turn of `near`. */
const nearTo = (value: number, near: number) => value + TURN * Math.round((near - value) / TURN)

/**
 * The three angles of a turn (`euler`'s inverse), of the two sets that give it the one nearest `near` (each angle moved by whole turns
 * towards it), so a bone turned a little is written as a little more than it was, never as the same turn the long way round.
 */
export function eulerNear(m: M3, near: V3): V3 {
  const sb = Math.max(-1, Math.min(1, -m[6]!))
  if (Math.abs(sb) > 0.999999) {
    const x = near[0]
    const z = sb > 0 ? x - Math.atan2(m[1]!, m[4]!) : Math.atan2(-m[1]!, m[4]!) - x
    return [x, sb > 0 ? Math.PI / 2 : -Math.PI / 2, nearTo(z, near[2])]
  }
  const y = Math.asin(sb)
  const x = Math.atan2(m[7]!, m[8]!)
  const z = Math.atan2(m[3]!, m[0]!)
  const one: V3 = [nearTo(x, near[0]), nearTo(y, near[1]), nearTo(z, near[2])]
  const two: V3 = [nearTo(x + Math.PI, near[0]), nearTo(Math.PI - y, near[1]), nearTo(z + Math.PI, near[2])]
  const off = (set: V3) => Math.abs(set[0] - near[0]) + Math.abs(set[1] - near[1]) + Math.abs(set[2] - near[2])
  return off(two) < off(one) ? two : one
}

/** A turn of `angle` radians about the unit `axis`. */
export function axisTurn(axis: V3, angle: number): M3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const k = 1 - c
  const [x, y, z] = axis
  return [c + k * x * x, k * x * y - s * z, k * x * z + s * y, k * y * x + s * z, c + k * y * y, k * y * z - s * x, k * z * x - s * y, k * z * y + s * x, c + k * z * z]
}

/** The shortest turn that takes the direction `from` to the direction `to`, `share` of the way. Identity for a direction too short to have one. */
export function swing(from: V3, to: V3, share: number): M3 {
  const a = length(from)
  const b = length(to)
  if (a < 1e-9 || b < 1e-9) return IDENTITY
  const f = times(from, 1 / a)
  const t = times(to, 1 / b)
  let axis = cross(f, t)
  const s = length(axis)
  const c = dot(f, t)
  if (s < 1e-9) {
    if (c > 0) return IDENTITY
    axis = Math.abs(f[0]) < 0.9 ? cross(f, [1, 0, 0]) : cross(f, [0, 1, 0])
    return axisTurn(times(axis, 1 / length(axis)), Math.PI * share)
  }
  return axisTurn(times(axis, 1 / s), Math.atan2(s, c) * share)
}

const at3 = (list: readonly number[], index: number): V3 => [list[index * 3]!, list[index * 3 + 1]!, list[index * 3 + 2]!]

/** Where a bone is in model space: `r` its turn alone, `a` its turn and scale, `t` where its own origin goes (a point p of the bone is at a·p + t). */
export function placeOf(rig: Rig, index: number): { r: M3; a: M3; t: V3 } {
  const [rx, ry, rz] = at3(rig.rot, index)
  const r = euler(rx, ry, rz)
  const [sx, sy, sz] = at3(rig.scale, index)
  const a = [r[0]! * sx, r[1]! * sy, r[2]! * sz, r[3]! * sx, r[4]! * sy, r[5]! * sz, r[6]! * sx, r[7]! * sy, r[8]! * sz]
  const pivot = at3(rig.pivot, index)
  const [mx, my, mz] = at3(rig.pos, index)
  const turned = apply(a, pivot)
  const t: V3 = [-mx + pivot[0] - turned[0], my + pivot[1] - turned[1], mz + pivot[2] - turned[2]]
  const parent = rig.parent[index]!
  if (parent < 0) return { r, a, t }
  const above = placeOf(rig, parent)
  return { r: mul(above.r, r), a: mul(above.a, a), t: plus(apply(above.a, t), above.t) }
}

/** A point of a bone (as the model is built, model space) where the bone now puts it. */
export function pointOf(rig: Rig, index: number, point: V3): V3 {
  const place = placeOf(rig, index)
  return plus(apply(place.a, point), place.t)
}
export const pivotOf = (rig: Rig, index: number) => pointOf(rig, index, at3(rig.pivot, index))

/** Turns a bone about its pivot by `turn`, a turn in model space: its own angles are written anew, the nearest set to what they were. */
export function turnBone(rig: Rig, index: number, turn: M3) {
  const parent = rig.parent[index]!
  const above = parent < 0 ? IDENTITY : placeOf(rig, parent).r
  const own = at3(rig.rot, index)
  const next = eulerNear(mul(mul(mul(transposed(above), turn), above), euler(own[0], own[1], own[2])), own)
  rig.rot[index * 3] = next[0]
  rig.rot[index * 3 + 1] = next[1]
  rig.rot[index * 3 + 2] = next[2]
}

/** The inverse of a 3×3 (the identity for one that has none). */
export function inverse(a: M3): M3 {
  const c0 = a[4]! * a[8]! - a[5]! * a[7]!
  const c1 = a[5]! * a[6]! - a[3]! * a[8]!
  const c2 = a[3]! * a[7]! - a[4]! * a[6]!
  const det = a[0]! * c0 + a[1]! * c1 + a[2]! * c2
  if (Math.abs(det) < 1e-12) return IDENTITY
  const k = 1 / det
  return [
    c0 * k,
    (a[2]! * a[7]! - a[1]! * a[8]!) * k,
    (a[1]! * a[5]! - a[2]! * a[4]!) * k,
    c1 * k,
    (a[0]! * a[8]! - a[2]! * a[6]!) * k,
    (a[2]! * a[3]! - a[0]! * a[5]!) * k,
    c2 * k,
    (a[1]! * a[6]! - a[0]! * a[7]!) * k,
    (a[0]! * a[4]! - a[1]! * a[3]!) * k,
  ]
}

/** Moves a bone (and all under it) by `shift`, model pixels in model space. */
export function moveBone(rig: Rig, index: number, shift: V3) {
  const parent = rig.parent[index]!
  const local = parent < 0 ? shift : apply(inverse(placeOf(rig, parent).a), shift)
  rig.pos[index * 3] = rig.pos[index * 3]! - local[0]
  rig.pos[index * 3 + 1] = rig.pos[index * 3 + 1]! + local[1]
  rig.pos[index * 3 + 2] = rig.pos[index * 3 + 2]! + local[2]
}

/** Whether `index` is `above` or lies under it. */
export function under(rig: Pick<Rig, "parent">, index: number, above: number) {
  for (let at = index, guard = 0; at >= 0 && guard <= rig.parent.length; at = rig.parent[at]!, guard++) if (at === above) return true
  return false
}

type Design = Pick<ModelDesign, "bones">
const DEGREES = Math.PI / 180

/** The bones' parents by index (-1 for the root), in the order the model lists its bones. */
export const rigParents = (design: Design) => design.bones.map((bone) => (bone.parent === null ? -1 : design.bones.findIndex((other) => other.name === bone.parent)))

/**
 * The rig as GeckoLib holds it at `time` seconds of a clip (null: as built), with `added` degrees (the document's axes) on the rotation of
 * the bones it names (a follow bone's sway). A loop is played round (`clipCursor`), as the follow bones' preview plays it.
 */
export function rigOf(design: Design, clip: Clip | null, time = 0, added: ReadonlyMap<string, readonly number[]> = new Map(), parent = rigParents(design)): Rig {
  const tracks = new Map(clip?.channels.map((channel) => [channel.bone, channelTracks(channel)]) ?? [])
  const sample = (bone: string, track: "rotation" | "position" | "scale") => {
    const keys = tracks.get(bone)?.[track]
    return clip && keys?.length ? sampleTrack(keys, clipCursor(clip, time), clip.loop)! : null
  }
  const rig: Rig = { parent, pivot: [], rot: [], pos: [], scale: [] }
  design.bones.forEach((bone) => {
    const turn = sample(bone.name, "rotation") ?? [0, 0, 0]
    const more = added.get(bone.name) ?? [0, 0, 0]
    rig.pivot.push(-bone.pivot[0], bone.pivot[1], bone.pivot[2])
    rig.rot.push(-(bone.rotation[0] + turn[0] + more[0]!) * DEGREES, -(bone.rotation[1] + turn[1] + more[1]!) * DEGREES, (bone.rotation[2] + turn[2] + more[2]!) * DEGREES)
    rig.pos.push(...(sample(bone.name, "position") ?? [0, 0, 0]))
    rig.scale.push(...(sample(bone.name, "scale") ?? [1, 1, 1]))
  })
  return rig
}

/** A bone's rotation in the rig as a rotation track value of the document (degrees added to the bone's own). */
export function trackTurn(design: Design, rig: Rig, index: number): V3 {
  const own = design.bones[index]!.rotation
  return [-rig.rot[index * 3]! / DEGREES - own[0], -rig.rot[index * 3 + 1]! / DEGREES - own[1], rig.rot[index * 3 + 2]! / DEGREES - own[2]]
}
/** A bone's move in the rig as a position track value of the document. */
export const trackMove = (rig: Rig, index: number): V3 => at3(rig.pos, index)

/**
 * The far end of a bone's cubes as it is built (model space): from its pivot through the middle of the box its cubes fill, where that line
 * leaves the box. Null for a bone without cubes, or whose cubes sit round its pivot (nothing hangs from it in one direction).
 */
export function boneTip(design: Design, index: number): V3 | null {
  const bone = design.bones[index]!
  if (!bone.cubes.length) return null
  const low: V3 = [Infinity, Infinity, Infinity]
  const high: V3 = [-Infinity, -Infinity, -Infinity]
  bone.cubes.forEach((cube) => {
    const from: V3 = [-(cube.origin[0] + cube.size[0]), cube.origin[1], cube.origin[2]]
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis]!, from[axis]!)
      high[axis] = Math.max(high[axis]!, from[axis]! + cube.size[axis]!)
    }
  })
  const pivot: V3 = [-bone.pivot[0], bone.pivot[1], bone.pivot[2]]
  const middle: V3 = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2]
  const way = minus(middle, pivot)
  if (length(way) < 0.5) return null
  let leave = Infinity
  for (let axis = 0; axis < 3; axis++) if (Math.abs(way[axis]!) > 1e-9) leave = Math.min(leave, ((way[axis]! > 0 ? high[axis]! : low[axis]!) - pivot[axis]!) / way[axis]!)
  return plus(pivot, times(way, leave))
}

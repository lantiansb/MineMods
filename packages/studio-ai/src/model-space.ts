import type { ModelDesign } from "./contracts"
import type { ModelFace } from "./model-paint"

/**
 * 第 1 步: where a model's cubes are, at rest, in the mirrored coordinates the game draws in (x of the document turned over), with a cube's own
 * turn (`rotation` about `pivot`) and growth (`inflate`). What the painter reads to darken a face where another part meets it, and what every
 * measure that places cubes composes with a bone's own place (`cubeLocal`). A cube that says none of the three is placed exactly as before.
 */

export type Vec = [number, number, number]
type Bone = ModelDesign["bones"][number]
type Cube = Bone["cubes"][number]

export const multiply = (a: readonly number[], b: readonly number[]) => Array.from({ length: 9 }, (_, index) => [0, 1, 2].reduce((sum, k) => sum + a[Math.floor(index / 3) * 3 + k]! * b[k * 3 + (index % 3)]!, 0))
export const apply = (matrix: readonly number[], point: Vec) => [0, 1, 2].map((row) => matrix[row * 3]! * point[0] + matrix[row * 3 + 1]! * point[1] + matrix[row * 3 + 2]! * point[2]) as Vec
export const add = (a: Vec, b: Vec) => a.map((value, axis) => value + b[axis]!) as Vec
export const subtract = (a: Vec, b: Vec) => a.map((value, axis) => value - b[axis]!) as Vec
export const transpose = (matrix: readonly number[]) => Array.from({ length: 9 }, (_, index) => matrix[(index % 3) * 3 + Math.floor(index / 3)]!)

/** A rest rotation (a bone's or a cube's, in degrees as the document writes it) as a matrix in the mirrored coordinates: X, then Y, then Z. */
export function turnOf(rotation: readonly number[]) {
  const [x, y, z] = [-rotation[0]!, -rotation[1]!, rotation[2]!].map((angle) => (angle * Math.PI) / 180) as Vec
  return multiply(
    [Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1],
    multiply([Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)], [1, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, Math.sin(x), Math.cos(x)]),
  )
}

/** Whether a cube is turned at all. */
export const cubeTurned = (cube: Pick<Cube, "rotation">) => Boolean(cube.rotation?.some((value) => value !== 0))

/** The point a cube turns about, as the document writes it: its own `pivot`, else its middle. */
export const cubePivot = (cube: Pick<Cube, "origin" | "size" | "pivot">): Vec => (cube.pivot ? [...cube.pivot] : (cube.origin.map((value, axis) => value + cube.size[axis]! / 2) as Vec))

/** The cube's own turn about its pivot, p -> r·p + t in mirrored coordinates; null for a cube that is not turned. */
export function cubeLocal(cube: Pick<Cube, "origin" | "size" | "pivot" | "rotation">): { r: number[]; t: Vec } | null {
  if (!cubeTurned(cube)) return null
  const pivot = cubePivot(cube)
  const at: Vec = [-pivot[0], pivot[1], pivot[2]]
  const r = turnOf(cube.rotation!)
  return { r, t: subtract(at, apply(r, at)) }
}

/** A place composed with a cube's own turn: the cube's points go through its turn first, then through its bone. */
export const withCube = (placed: { r: number[]; t: Vec }, cube: Pick<Cube, "origin" | "size" | "pivot" | "rotation">) => {
  const local = cubeLocal(cube)
  return local ? { r: multiply(placed.r, local.r), t: add(apply(placed.r, local.t), placed.t) } : placed
}

/** Where texel (0,0) of a face sits on a cube centred at the origin (as fractions of its half size) and which way u, v and out run. */
export const FACE_FRAMES: Record<ModelFace, { origin: Vec; u: Vec; v: Vec; normal: Vec }> = {
  east: { origin: [1, 1, 1], u: [0, 0, -1], v: [0, -1, 0], normal: [1, 0, 0] },
  west: { origin: [-1, 1, -1], u: [0, 0, 1], v: [0, -1, 0], normal: [-1, 0, 0] },
  up: { origin: [-1, 1, -1], u: [1, 0, 0], v: [0, 0, 1], normal: [0, 1, 0] },
  down: { origin: [-1, -1, 1], u: [1, 0, 0], v: [0, 0, -1], normal: [0, -1, 0] },
  south: { origin: [-1, 1, 1], u: [1, 0, 0], v: [0, -1, 0], normal: [0, 0, 1] },
  north: { origin: [1, 1, -1], u: [-1, 0, 0], v: [0, -1, 0], normal: [0, 0, -1] },
}

/** Every cube at rest: its middle and half size (grown by `inflate`), how it is placed, and whether a point is in it. */
export function placedCubes(design: Pick<ModelDesign, "bones">) {
  const byName = new Map(design.bones.map((bone) => [bone.name, bone]))
  const worlds = new Map<string, { r: number[]; t: Vec }>()
  const world = (bone: Bone, depth = 0): { r: number[]; t: Vec } => {
    const known = worlds.get(bone.name)
    if (known) return known
    const pivot: Vec = [-bone.pivot[0], bone.pivot[1], bone.pivot[2]]
    const r = turnOf(bone.rotation)
    const own = { r, t: subtract(pivot, apply(r, pivot)) }
    const parent = bone.parent && depth < design.bones.length ? byName.get(bone.parent) : undefined
    const above = parent ? world(parent, depth + 1) : null
    const result = above ? { r: multiply(above.r, own.r), t: add(apply(above.r, own.t), above.t) } : own
    worlds.set(bone.name, result)
    return result
  }
  return design.bones.flatMap((bone, boneIndex) =>
    bone.cubes.map((cube, cubeIndex) => {
      const placed = withCube(world(bone), cube)
      const grow = cube.inflate ?? 0
      const centre: Vec = [-(cube.origin[0] + cube.size[0] / 2), cube.origin[1] + cube.size[1] / 2, cube.origin[2] + cube.size[2] / 2]
      const half = cube.size.map((value) => Math.max(0.01, value / 2 + grow)) as Vec
      const toWorld = (point: Vec) => add(apply(placed.r, point), placed.t)
      const inverse = transpose(placed.r)
      const corners = Array.from({ length: 8 }, (_, corner) => toWorld(add(centre, half.map((value, axis) => (corner & (1 << axis) ? value : -value)) as Vec)))
      const min = [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis]!))) as Vec
      const max = [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis]!))) as Vec
      return {
        bone,
        cube,
        boneIndex,
        cubeIndex,
        centre,
        half,
        toWorld,
        min,
        max,
        holds: (point: Vec, grow: number) => {
          const reach = Math.max(0, grow) * 1.7320508075688774 + 1e-6
          if (point[0] < min[0] - reach || point[0] > max[0] + reach || point[1] < min[1] - reach || point[1] > max[1] + reach || point[2] < min[2] - reach || point[2] > max[2] + reach) return false
          return subtract(apply(inverse, subtract(point, placed.t)), centre).every((value, axis) => Math.abs(value) <= half[axis]! + grow)
        },
      }
    }),
  )
}
export type PlacedCube = ReturnType<typeof placedCubes>[number]

/** The world point on a face of a placed cube at texel u, v (texels of `texel` model pixels, the last cut by the face's edge), `lift` pixels out from it. */
export function texelPoint(box: PlacedCube, face: ModelFace, u: number, v: number, lift: number, texel: number, across: number, down: number) {
  const frame = FACE_FRAMES[face]
  const extent = (index: number, size: number) => (texel === 1 ? index + 0.5 : Math.min((index + 0.5) * texel, size - Math.min(0.5, size / 2)))
  // A face of an inflated cube is the same texels spread over the grown side.
  const stretch = (axis: number) => (box.half[axis]! * 2) / Math.max(0.01, box.cube.size[axis]!)
  const uAxis = frame.u.findIndex((value) => value !== 0)
  const vAxis = frame.v.findIndex((value) => value !== 0)
  return box.toWorld(
    [0, 1, 2].map(
      (axis) => box.centre[axis]! + frame.origin[axis]! * box.half[axis]! + frame.u[axis]! * extent(u, across) * stretch(uAxis) + frame.v[axis]! * extent(v, down) * stretch(vAxis) + frame.normal[axis]! * lift,
    ) as Vec,
  )
}

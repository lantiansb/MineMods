import type { ModelDesign } from "@minemods/studio-ai/contracts"

/** Rest-pose bounds in GeckoLib coordinates and model pixels, including parent rotations. */
export function modelBounds(design: Pick<ModelDesign, "bones">) {
  const bones = new Map(design.bones.map((bone) => [bone.name, bone]))
  // A turn as GeckoLib applies it: X, then Y, then Z, with X and Y negated.
  const turn = (point: number[], rotation: readonly number[]) => {
    const angles = rotation.map((angle, axis) => ((angle * Math.PI) / 180) * (axis === 2 ? 1 : -1))
    const x = [point[0]!, point[1]! * Math.cos(angles[0]!) - point[2]! * Math.sin(angles[0]!), point[1]! * Math.sin(angles[0]!) + point[2]! * Math.cos(angles[0]!)]
    const y = [x[0]! * Math.cos(angles[1]!) + x[2]! * Math.sin(angles[1]!), x[1]!, -x[0]! * Math.sin(angles[1]!) + x[2]! * Math.cos(angles[1]!)]
    return [y[0]! * Math.cos(angles[2]!) - y[1]! * Math.sin(angles[2]!), y[0]! * Math.sin(angles[2]!) + y[1]! * Math.cos(angles[2]!), y[2]!]
  }
  const points = design.bones.flatMap((bone) =>
    bone.cubes.flatMap((cube) =>
      Array.from({ length: 8 }, (_, corner) => {
        // 第 1 步: an inflated cube reaches that much further; a turned one is turned about its own pivot first.
        const grow = cube.inflate ?? 0
        const at = [0, 1, 2].map((axis) => cube.origin[axis]! - grow + (corner & (1 << axis) ? cube.size[axis]! + grow * 2 : 0))
        const turned = cube.rotation?.some((value) => value !== 0)
        const pivot = cube.pivot ?? cube.origin.map((value, axis) => value + cube.size[axis]! / 2)
        let point = turned
          ? ((own) => [own[0]! + bone.pivot[0] - pivot[0]!, own[1]! + pivot[1]! - bone.pivot[1], own[2]! + pivot[2]! - bone.pivot[2]])(turn([pivot[0]! - at[0]!, at[1]! - pivot[1]!, at[2]! - pivot[2]!], cube.rotation!))
          : grow
            ? [bone.pivot[0] - at[0]!, at[1]! - bone.pivot[1], at[2]! - bone.pivot[2]]
            : // As it always was, to the last bit.
              [bone.pivot[0] - cube.origin[0] - (corner & 1 ? cube.size[0] : 0), cube.origin[1] + (corner & 2 ? cube.size[1] : 0) - bone.pivot[1], cube.origin[2] + (corner & 4 ? cube.size[2] : 0) - bone.pivot[2]]
        let current: typeof bone | undefined = bone
        while (current) {
          const turnedPoint = turn(point, current.rotation)
          const parent: typeof bone | undefined = current.parent ? bones.get(current.parent) : undefined
          point = [turnedPoint[0]! - current.pivot[0] + (parent?.pivot[0] ?? 0), turnedPoint[1]! + current.pivot[1] - (parent?.pivot[1] ?? 0), turnedPoint[2]! + current.pivot[2] - (parent?.pivot[2] ?? 0)]
          current = parent
        }
        return point
      }),
    ),
  )
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])))
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])))
  return {
    min,
    max,
    width: Math.max(0.1, Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[2]), Math.abs(max[2])) / 8),
    height: Math.max(0.1, max[1] / 16),
  }
}

type Vector = readonly [number, number, number]

// GeckoLib 4.8.3 BakedModelFactory/RenderUtil mirror X, negate X/Y angles,
// and multiply Z, Y, then X rotations. Values remain in model pixel units.
export const geckoRotationOrder = "ZYX" as const

export function geckoBonePosition(pivot: Vector, parent: Vector = [0, 0, 0]): [number, number, number] {
  return [parent[0] - pivot[0], pivot[1] - parent[1], pivot[2] - parent[2]]
}

export function geckoCubePosition(origin: Vector, size: Vector, pivot: Vector): [number, number, number] {
  return [pivot[0] - origin[0] - size[0] / 2, origin[1] + size[1] / 2 - pivot[1], origin[2] + size[2] / 2 - pivot[2]]
}

export function geckoRotation(rotation: Vector, animation: Vector = [0, 0, 0]): [number, number, number] {
  return [
    (-(rotation[0] + animation[0]) * Math.PI) / 180,
    (-(rotation[1] + animation[1]) * Math.PI) / 180,
    ((rotation[2] + animation[2]) * Math.PI) / 180,
  ]
}

export function fitModelBounds(min: Vector, max: Vector, aspect: number) {
  const radius = Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2)
  const halfAngle = Math.min((35 * Math.PI) / 360, Math.atan(Math.tan((35 * Math.PI) / 360) * Math.max(0.01, aspect)))
  const distance = (radius / Math.sin(halfAngle)) * 1.1
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as [number, number, number],
    radius,
    distance,
    near: Math.max(0.01, radius / 1000),
    far: Math.max(100, distance * 6 + radius * 4),
    minDistance: radius * 0.5,
    maxDistance: distance * 6,
    groundRadius: Math.max(4, Math.max(max[0] - min[0], max[2] - min[2]) * 0.75),
    groundY: min[1] - 0.5,
  }
}

import { fitModelBounds } from "./model-transform"

type Vector = readonly [number, number, number]

/**
 * How much further back than touching the edge the camera stands: every corner of the thing stays within
 * 1 / 1.1 ≈ 91% of the way from the middle of the picture to its edge. In the 180-pixel-high canvas of a card
 * that is 8 pixels free on each side: room for the 2-pixel selection outline and for the ground grid to be
 * seen running out past the thing's feet, and the same tenth the sphere fit left around its sphere.
 */
export const FIT_MARGIN = 1.1

const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vector, b: Vector): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vector): [number, number, number] => {
  const length = Math.hypot(...a) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

/**
 * Where a camera stands and what it looks at for a box to fill a picture of this aspect and vertical lens,
 * seen from `from` (the direction from the thing to the camera, any length, not straight up or down), with
 * `FIT_MARGIN` around all eight corners. Real screenshots showed an effect that is a long strip lost in a
 * large canvas: fitting the sphere around a thing into the picture's shorter side leaves a strip, or a tall
 * creature, a fraction of the side it could fill. Across and down are fitted separately, each corner by where
 * it really lands in perspective.
 *
 * Across, the point looked at is moved off the box's middle: the end of a long thing nearer the camera is
 * drawn larger than the far end, so looking at the middle leaves the far side of the picture empty (a 16×1×1
 * strip in a 2:1 picture stopped just short of 70% of the width). Moved, the outermost corners on both sides
 * sit at the margin. Up and down it still looks at the middle height: the point the orbit turns around stays
 * at the thing's own height, and a cube is not drawn larger than its margin allows.
 */
export function fitBox(min: Vector, max: Vector, aspect: number, from: Vector, fov: number) {
  const out = unit(from)
  const right = unit(cross([0, 1, 0], out))
  const up = cross(out, right)
  const tall = Math.tan((fov * Math.PI) / 360) / FIT_MARGIN
  const wide = tall * Math.max(0.01, aspect)
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((corner): Vector => [((corner & 1 ? 1 : -1) * (max[0] - min[0])) / 2, ((corner & 2 ? 1 : -1) * (max[1] - min[1])) / 2, ((corner & 4 ? 1 : -1) * (max[2] - min[2])) / 2])
  // A corner `side` off the line of sight and `depth` nearer than the middle is inside when side / reach + depth <= distance.
  // Each direction (one way, the other way) asks for its own distance; shifting the camera sideways trades one against the other, and they meet at their mean.
  const along = (axis: Vector, reach: number) => {
    const one = Math.max(...corners.map((point) => dot(point, out) + dot(point, axis) / reach))
    const other = Math.max(...corners.map((point) => dot(point, out) - dot(point, axis) / reach))
    return { distance: (one + other) / 2, shift: ((one - other) / 2) * reach }
  }
  const across = along(right, wide)
  const distance = Math.max(across.distance, ...corners.map((point) => dot(point, out) + Math.abs(dot(point, up)) / tall))
  const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  const target = centre.map((value, axis) => value + right[axis]! * across.shift) as [number, number, number]
  return { distance, target, position: target.map((value, axis) => value + out[axis]! * distance) as [number, number, number] }
}

/**
 * The frame of `fitModelBounds` with the camera brought in to where the box itself fills the picture: `target`
 * is what it looks at and orbits, `distance` how far from it. Never further than the sphere fit and no closer
 * than the orbit lets the camera come; in both cases it looks at the middle as before. Everything else
 * (centre, ground, limits, clipping) is the sphere frame's, so zooming out and the light behave as before.
 */
export function fitBoxView(min: Vector, max: Vector, aspect: number, from: Vector, fov: number) {
  const frame = fitModelBounds(min, max, aspect)
  const box = fitBox(min, max, aspect, from, fov)
  return box.distance > frame.distance || box.distance < frame.minDistance ? { ...frame, distance: Math.min(frame.distance, Math.max(frame.minDistance, box.distance)), target: frame.center } : { ...frame, distance: box.distance, target: box.target }
}

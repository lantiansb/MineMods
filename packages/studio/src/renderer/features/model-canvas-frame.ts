import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import { fitModelBounds } from "../model-transform"

type Vector = [number, number, number]
type Design = Pick<ModelDesign, "bones" | "animations">

// The viewport's own lens and the direction it first looks from (`viewport.ts`): this frame is that view, moved closer.
const FOV = 35
const FROM: Vector = [42, 18, -47]
// The share of the picture left free around the thing: what `fitModelBounds` leaves around its sphere.
const MARGIN = 1.1
// Moments of a motion its bounds are taken over: its two ends and seven between, enough for a swing or a
// stretch to show its widest reach without posing the model for every tick.
const MOMENTS = 8

const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vector): Vector => {
  const length = Math.hypot(...a) || 1
  return [a[0] / length, a[1] / length, a[2] / length]
}

/**
 * The box around everything the canvas will draw of a model: the pose it is built in and, when a motion is
 * shown, that motion at moments spread over its length (a thing that grows or swings would otherwise leave the
 * picture). In the viewport's space and model pixels. Null for a model with no cubes.
 */
export function posedBounds(design: Design, motion?: string | null) {
  const clip = motion ? design.animations.find((animation) => animation.name === motion) : undefined
  const corners = [
    ...posedCorners(design, null),
    ...(clip ? Array.from({ length: MOMENTS + 1 }, (_, index) => posedCorners(design, clip, (clip.length * index) / MOMENTS)).flat() : []),
  ].filter((corner) => corner.every(Number.isFinite))
  if (!corners.length) return null
  const side = (pick: (...values: number[]) => number) => [0, 1, 2].map((axis) => pick(...corners.map((corner) => corner[axis]!))) as Vector
  return { min: side(Math.min), max: side(Math.max) }
}

/**
 * Where the camera stands to fill the picture with a box. Round 18: an effect that is a thin strip was a
 * sliver in a wide canvas, because the viewport fits the sphere around a thing into the shorter side of the
 * picture, and a strip's sphere is mostly empty. Here every corner of the box is fitted into the picture as it
 * is really seen from the usual direction, across and down separately, so a long thing uses a wide picture.
 * Never further away than the sphere fit, and no closer than the orbit lets the camera come.
 */
export function tightFrame(min: Vector, max: Vector, aspect: number) {
  const sphere = fitModelBounds(min, max, aspect)
  const out = unit(FROM)
  const right = unit(cross([0, 1, 0], out))
  const up = cross(out, right)
  const tall = Math.tan((FOV * Math.PI) / 360)
  const wide = tall * Math.max(0.01, aspect)
  const needed = [0, 1, 2, 3, 4, 5, 6, 7].reduce((far, corner) => {
    const point: Vector = [(corner & 1 ? max[0] : min[0]) - sphere.center[0], (corner & 2 ? max[1] : min[1]) - sphere.center[1], (corner & 4 ? max[2] : min[2]) - sphere.center[2]]
    // A corner nearer the camera needs the camera further back for the same place in the picture.
    const near = dot(point, out)
    return Math.max(far, near + (Math.abs(dot(point, right)) / wide) * MARGIN, near + (Math.abs(dot(point, up)) / tall) * MARGIN)
  }, 0)
  const distance = Math.min(sphere.distance, Math.max(sphere.minDistance, needed))
  return {
    distance,
    target: sphere.center,
    position: [sphere.center[0] + out[0] * distance, sphere.center[1] + out[1] * distance, sphere.center[2] + out[2] * distance] as Vector,
  }
}

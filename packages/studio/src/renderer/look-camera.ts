import type { LookView } from "../main/look-job"
import { effectMeasure, effectRoom, type EffectDocument } from "@minemods/mod-core/effect"
import { fitModelBounds } from "./model-transform"

/**
 * Where the camera of a look stands and what it does to a point, as plain arithmetic: the page that draws
 * (`look.ts`) and the main process that measures how far a motion travels in the picture (`look-job.ts`)
 * both read it, so the number said about a picture is a number of that picture.
 */

type Vector = [number, number, number]
export type LookCamera = { position: Vector; target: Vector; fov: number }

// Where the camera stands, in the viewport's space: the model faces -Z, and the document's +X (its own left) is the viewport's -X.
const DIRECTIONS: Record<LookView, Vector> = {
  front: [0, 0.14, -1],
  back: [0, 0.14, 1],
  plus_x: [-1, 0.14, 0],
  minus_x: [1, 0.14, 0],
  top: [0, 1, -0.06],
  quarter: [42, 18, -47],
  quarter_back: [-42, 18, 47],
}
const LENS = 35

const minus = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vector): Vector => a.map((value) => value / Math.hypot(...a)) as Vector

/** The camera that frames a box (viewport space, model pixels) from one side, in a picture of this aspect. */
export function lookCamera(box: { min: Vector; max: Vector }, view: LookView, aspect: number): LookCamera {
  const frame = fitModelBounds(box.min, box.max, aspect)
  return { position: unit(DIRECTIONS[view]).map((value, axis) => frame.center[axis]! + value * frame.distance) as Vector, target: frame.center, fov: LENS }
}

/** Where a point lands in a picture of `size` pixels taken by this camera: x to the right, y down. */
export function projector(camera: LookCamera, size: readonly [number, number]) {
  const forward = unit(minus(camera.target, camera.position))
  const right = unit(cross(forward, [0, 1, 0]))
  const up = cross(right, forward)
  const focal = size[1] / 2 / Math.tan((camera.fov * Math.PI) / 360)
  return (point: Vector): [number, number] => {
    const seen = minus(point, camera.position)
    return [size[0] / 2 + (dot(seen, right) / dot(seen, forward)) * focal, size[1] / 2 - (dot(seen, up) / dot(seen, forward)) * focal]
  }
}

/**
 * The one picture an effect has on its cover and on its card (broad21): its own motion at the moment it is fullest, from the front quarter, in a square, in the room everything it reaches
 * fits (`effectRoom`, the room its frame-by-frame strips are shot in). The cover of a look and the card read this, so what the person is shown at a glance is a frame of the very material the
 * reviewer and the maker were shown, of the same version, and not the pose it is built in (a spike that rises out of the ground is built under it or flat, and was drawn so).
 */
export function effectShot(document: EffectDocument) {
  return { animation: document.play.clip, time: effectMeasure(document)?.peak.seconds ?? 0, camera: lookCamera(effectRoom(document), "quarter", 1) }
}

import { expect, test } from "bun:test"
import { PerspectiveCamera, Vector3 } from "three"
import { fitModelBounds } from "../src/renderer/model-transform"
import { FIT_MARGIN, fitBoxView } from "../src/renderer/box-fit"
import { posedBounds, tightFrame } from "../src/renderer/features/model-canvas-frame"

test("a 200-pixel tall accepted model fits every projected corner", () => {
  const frame = fitModelBounds([-1, 0, -1], [1, 200, 1], 1)
  const camera = new PerspectiveCamera(35, 1, frame.near, frame.far)
  camera.position
    .copy(new Vector3(...frame.center))
    .add(new Vector3(42, 18, -47).normalize().multiplyScalar(frame.distance))
  camera.lookAt(...frame.center)
  camera.updateMatrixWorld()
  for (const x of [-1, 1])
    for (const y of [0, 200])
      for (const z of [-1, 1]) {
        const projected = new Vector3(x, y, z).project(camera)
        expect(Math.abs(projected.x)).toBeLessThan(1)
        expect(Math.abs(projected.y)).toBeLessThan(1)
        expect(Math.abs(projected.z)).toBeLessThan(1)
      }
  expect(frame.center).toEqual([0, 100, 0])
  expect(frame.maxDistance).toBeGreaterThan(110)
})

test("portrait framing follows offset geometry and puts the floor below it", () => {
  const frame = fitModelBounds([190, -50, -210], [240, -20, -110], 0.5)
  expect(frame.center).toEqual([215, -35, -160])
  expect(frame.groundY).toBeLessThan(-50)
  expect(frame.distance).toBeGreaterThan(fitModelBounds([190, -50, -210], [240, -20, -110], 2).distance)
  expect(frame.far).toBeGreaterThan(frame.maxDistance + frame.radius)
})

const projected = (frame: ReturnType<typeof tightFrame>, aspect: number, min: number[], max: number[]) => {
  const camera = new PerspectiveCamera(35, aspect, 0.01, 10000)
  camera.position.set(...frame.position)
  camera.lookAt(...frame.target)
  camera.updateMatrixWorld()
  return [0, 1, 2, 3, 4, 5, 6, 7].map((corner) => new Vector3(corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]).project(camera))
}

test("a long thin strip fills a wide canvas instead of being fitted as a sphere into its height", () => {
  const min: [number, number, number] = [-16, 0, -2]
  const max: [number, number, number] = [16, 1, 2]
  const aspect = 2.8
  const frame = tightFrame(min, max, aspect)
  const corners = projected(frame, aspect, min, max)
  for (const corner of corners) {
    expect(Math.abs(corner.x)).toBeLessThan(1)
    expect(Math.abs(corner.y)).toBeLessThan(1)
  }
  // The strip reaches at least 85% of the way to the edge it is fitted against (a tenth is left free), where the sphere fit left it under a third.
  expect(Math.max(...corners.map((corner) => Math.max(Math.abs(corner.x), Math.abs(corner.y))))).toBeGreaterThan(0.85)
  const sphere = fitModelBounds(min, max, aspect)
  expect(frame.distance).toBeLessThan(sphere.distance / 2)
  expect(frame.target).toEqual(sphere.center)
})

test("tight framing keeps every corner in the picture for tall, flat and cubic things at wide and narrow canvases, and is never further than the sphere fit", () => {
  const boxes: [[number, number, number], [number, number, number]][] = [[[-1, 0, -1], [1, 200, 1]], [[-8, 0, -8], [8, 16, 8]], [[190, -50, -210], [240, -20, -110]], [[-20, 0, -20], [20, 0.5, 20]]]
  for (const [min, max] of boxes)
    for (const aspect of [0.5, 1, 1.6, 3]) {
      const frame = tightFrame(min, max, aspect)
      for (const corner of projected(frame, aspect, min, max)) {
        expect(Math.abs(corner.x)).toBeLessThan(1)
        expect(Math.abs(corner.y)).toBeLessThan(1)
      }
      expect(frame.distance).toBeLessThanOrEqual(fitModelBounds(min, max, aspect).distance)
    }
})

test("the bounds a model is framed by take in the motion on show, not only the pose it is built in", () => {
  const design = {
    bones: [{ name: "root", parent: null, pivot: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: [{ name: "strip", origin: [-8, 0, -1] as [number, number, number], size: [16, 1, 2] as [number, number, number] }] }],
    animations: [{ name: "appear", length: 1, loop: false, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 0, 0] }], position: [{ time: 0, position: [0, 0, 0] }, { time: 1, position: [0, 12, 0] }] }] }],
  } as unknown as Parameters<typeof posedBounds>[0]
  const rest = posedBounds(design)!
  expect([rest.min[1], rest.max[1]]).toEqual([0, 1])
  expect(rest.max[0] - rest.min[0]).toBe(16)
  const moving = posedBounds(design, "appear")!
  expect(moving.max[1]).toBe(13)
  expect(moving.min[1]).toBe(0)
  expect(posedBounds(design, "no_such_motion")).toEqual(rest)
  expect(posedBounds({ bones: [], animations: [] } as unknown as Parameters<typeof posedBounds>[0])).toBeNull()
})

// The viewport's own fit (`fitCamera` in viewport.ts): the same lens and the direction it looks from.
const seen = (min: [number, number, number], max: [number, number, number], aspect: number) => {
  const frame = fitBoxView(min, max, aspect, [42, 18, -47], 35)
  const out = new Vector3(42, 18, -47).normalize().multiplyScalar(frame.distance)
  const corners = projected({ distance: frame.distance, target: frame.target, position: [frame.target[0] + out.x, frame.target[1] + out.y, frame.target[2] + out.z] }, aspect, min, max)
  const span = (axis: "x" | "y") => (Math.max(...corners.map((corner) => corner[axis])) - Math.min(...corners.map((corner) => corner[axis]))) / 2
  return { frame, corners, wide: span("x"), tall: span("y") }
}

test("the viewport fits the box and not its sphere: a 16×1×1 strip fills a 2:1 canvas, a tall thing a narrow one, and nothing leaves the picture", () => {
  const strip = seen([-8, 0, -0.5], [8, 1, 0.5], 2)
  expect(strip.wide).toBeGreaterThan(0.7)
  // The sphere fit left the same strip under half of the width.
  expect(strip.frame.distance).toBeLessThan(fitModelBounds([-8, 0, -0.5], [8, 1, 0.5], 2).distance * 0.6)
  expect(seen([-1, 0, -1], [1, 40, 1], 0.5).tall).toBeGreaterThan(0.7)
  const boxes: [[number, number, number], [number, number, number]][] = [[[-8, 0, -0.5], [8, 1, 0.5]], [[-1, 0, -1], [1, 200, 1]], [[-8, 0, -8], [8, 16, 8]], [[190, -50, -210], [240, -20, -110]], [[-20, 0, -20], [20, 0.5, 20]]]
  for (const [min, max] of boxes)
    for (const aspect of [0.5, 1, 2, 3]) {
      const view = seen(min, max, aspect)
      // The margin: no corner past 1 / FIT_MARGIN of the way to an edge, and the nearest-fitted one reaches it unless the orbit's own limits hold the camera back.
      for (const corner of view.corners) expect(Math.max(Math.abs(corner.x), Math.abs(corner.y))).toBeLessThan(1 / FIT_MARGIN + 1e-6)
      const sphere = fitModelBounds(min, max, aspect)
      expect(view.frame.distance).toBeLessThanOrEqual(sphere.distance)
      expect(view.frame.distance).toBeGreaterThanOrEqual(sphere.minDistance)
      // What is looked at and turned around stays at the thing's middle height and within its footprint's reach; the rest of the frame is the sphere fit's.
      expect(view.frame.target[1]).toBe(sphere.center[1])
      expect(Math.hypot(view.frame.target[0] - sphere.center[0], view.frame.target[2] - sphere.center[2])).toBeLessThan(Math.hypot(max[0] - min[0], max[2] - min[2]) / 2)
      expect({ ...view.frame, distance: 0, target: 0 }).toEqual({ ...sphere, distance: 0, target: 0 })
    }
})

test("a cube is drawn about as large as before: closer than the sphere fit by less than the margin", () => {
  for (const aspect of [1, 2]) {
    const cube = seen([-8, 0, -8], [8, 16, 8], aspect)
    const sphere = fitModelBounds([-8, 0, -8], [8, 16, 8], aspect)
    expect(cube.frame.distance).toBeLessThanOrEqual(sphere.distance)
    expect(sphere.distance / cube.frame.distance).toBeLessThan(FIT_MARGIN)
  }
})

import { expect, test } from "bun:test"
import { Group, Mesh, BoxGeometry, Vector3 } from "three"
import {
  geckoBonePosition,
  geckoCubePosition,
  geckoRotation,
  geckoRotationOrder,
} from "../src/renderer/model-transform"

test("a positive Bedrock X rotation moves a forward cube upward as GeckoLib does", () => {
  const bone = new Group()
  bone.rotation.set(...geckoRotation([90, 0, 0]), geckoRotationOrder)
  const cube = new Mesh(new BoxGeometry(2, 2, 2))
  cube.position.set(...geckoCubePosition([0, 0, 4], [2, 2, 2], [0, 0, 0]))
  bone.add(cube)
  const center = cube.getWorldPosition(new Vector3())
  expect(center.x).toBeCloseTo(-1)
  expect(center.y).toBeCloseTo(5)
  expect(center.z).toBeCloseTo(-1)
  cube.geometry.dispose()
})

test("child pivots are relative to mirrored parent pivots", () => {
  expect(geckoBonePosition([6, 7, 8], [3, 4, 5])).toEqual([-3, 3, 3])
  expect(geckoCubePosition([7, 9, 11], [2, 2, 2], [6, 7, 8])).toEqual([-2, 3, 4])
  expect(geckoRotation([30, 40, 50], [5, -10, 15])[0]).toBeCloseTo((-35 * Math.PI) / 180)
  expect(geckoRotation([30, 40, 50], [5, -10, 15])[1]).toBeCloseTo((-30 * Math.PI) / 180)
  expect(geckoRotation([30, 40, 50], [5, -10, 15])[2]).toBeCloseTo((65 * Math.PI) / 180)
})

test("nested multi-axis transforms match GeckoLib's pinned JOML Z-Y-X matrix order", () => {
  const parent = new Group()
  parent.position.set(...geckoBonePosition([3, 4, 5]))
  parent.rotation.set(...geckoRotation([30, 40, 50]), geckoRotationOrder)
  const child = new Group()
  child.position.set(...geckoBonePosition([6, 7, 8], [3, 4, 5]))
  child.rotation.set(...geckoRotation([15, -20, -25]), geckoRotationOrder)
  parent.add(child)
  const cube = new Mesh(new BoxGeometry(2, 2, 2))
  cube.position.set(...geckoCubePosition([7, 9, 11], [2, 2, 2], [6, 7, 8]))
  child.add(cube)
  const center = cube.getWorldPosition(new Vector3())
  // Golden values come from the actual pinned JOML Matrix4f operations used by
  // GeckoLib RenderUtil, including parent and child translate-away-from-pivot.
  expect(center.x).toBeCloseTo(-12.062616348, 5)
  expect(center.y).toBeCloseTo(7.635184288, 5)
  expect(center.z).toBeCloseTo(5.38131237, 5)
  cube.geometry.dispose()
})

import { expect, test } from "bun:test"
import { measureLook } from "../src/model-look"
import model from "./fixtures/look/unsampled-face.json"

// A real model from a real run: thin slits on the face left spots the straight-on face sampling does not reach.
// Measuring used to throw there, and the look ended with no pictures at all.
test("量脸的时候采不到颜色的地方当作看不见，不会让整次看图失败", () => {
  const measured = measureLook(model as never)
  expect(Object.keys(measured).length).toBeGreaterThan(0)
})

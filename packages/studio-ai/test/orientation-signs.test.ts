import { expect, test } from "bun:test"
import { posedCorners } from "../src/model-motion"
import { ORIENTATION_GUIDE } from "../src/orientation"

// 10-13: the guide's y and z sentences had the sides the wrong way round for as long as makers read them; only x had been measured.
// Each sentence is checked against posedCorners, the same posing the look pictures and the measurements use. Its frame mirrors x:
// a part on the creature's own left (+X) comes out at negative x.
const centre = (rotation: number[], origin: number[]) => {
  const corners = posedCorners({ bones: [{ name: "b", parent: null, pivot: [0, 0, 0], rotation, cubes: [{ origin, size: [1, 1, 1], uv: [0, 0] }] }] } as never, null, 0)
  return [0, 1, 2].map((axis) => corners.reduce((sum, corner) => sum + corner[axis]!, 0) / corners.length)
}
const own = (out: number[]) => ({ left: -out[0]!, up: out[1]!, back: out[2]! })

test("转动正负的每一句都和渲染、量测用的摆姿势一致", () => {
  // x+: below the pivot swings back (+Z), in front goes down.
  expect(own(centre([30, 0, 0], [-0.5, -5, -0.5])).back).toBeGreaterThan(1)
  expect(own(centre([30, 0, 0], [-0.5, -0.5, -5])).up).toBeLessThan(-1)
  expect(ORIENTATION_GUIDE).toContain("绕 x 轴转正的角度，轴点下面的部分往后（+Z）摆、轴点前面的部分往下低")
  // y+: the front turns to its own right (-X).
  expect(own(centre([0, 30, 0], [-0.5, 0, -5])).left).toBeLessThan(-1)
  expect(ORIENTATION_GUIDE).toContain("绕 y 轴转正的角度，是朝它自己的右边（-X）转")
  // z+: below the pivot swings to its own right; a part out to its left goes down, one out to its right goes up.
  expect(own(centre([0, 0, 30], [-0.5, -5, -0.5])).left).toBeLessThan(-1)
  expect(own(centre([0, 0, 30], [4, -0.5, -0.5])).up).toBeLessThan(-1)
  expect(own(centre([0, 0, 30], [-5, -0.5, -0.5])).up).toBeGreaterThan(1)
  expect(ORIENTATION_GUIDE).toContain("往左边（+X）伸出去的部件（左翅膀、左臂平举）z 为正是往下压")
})

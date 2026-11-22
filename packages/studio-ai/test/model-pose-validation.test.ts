import { expect, test } from "bun:test"
import { ModelDesignSchema } from "../src/contracts"
import { quadrupedFixture } from "./quadruped-fixture"

test("看向、摆动和踩地的骨骼冲突在保存前指出", () => {
  const base = quadrupedFixture()
  const part = (bone: string, share: number) => ({bone, share, yaw: 30, pitch: 20})
  const gaze = (...bones: ReturnType<typeof part>[]) => ModelDesignSchema.safeParse({...base, look: {bones}})
  expect(gaze(part("head", 1)).success).toBe(true)
  expect(gaze(part("body", 0.6), part("head", 0.5)).success).toBe(false)
  expect(gaze(part("head", 0.5), part("body", 0.5)).success).toBe(false)
  expect(gaze(part("front_left_thigh", 1)).success).toBe(false)
  expect(gaze(part("missing", 1)).success).toBe(false)
  const sway = (channel: string, amount: number) => ModelDesignSchema.safeParse({...base, sway: [{bones:["front_left_thigh"], axis:"y", speed:1, channel, amount}]})
  expect(sway("scale", 0.03).success).toBe(true)
  expect(sway("rotation", 3).success).toBe(false)
})

test("循环权重只收常数，非循环的点按动作时间排列", () => {
  const base = quadrupedFixture()
  const valid = (loop: boolean, times: number[]) => ModelDesignSchema.safeParse({...base, animations: base.animations.map((c, i) => i ? c : {...c, loop, weights:{look:times.map(time => ({time, value:0.5}))}})}).success
  expect(valid(true, [0])).toBe(true)
  expect(valid(true, [0,1])).toBe(false)
  expect(valid(false, [0,1])).toBe(true)
  expect(valid(false, [1,1])).toBe(false)
  expect(valid(false, [0,3])).toBe(false)
})


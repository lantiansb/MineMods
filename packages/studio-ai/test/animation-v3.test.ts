import { expect, test } from "bun:test"
import { BAKE_TOLERANCE, CLIP_PLAY_GUIDE, EASE, EASINGS, bakeFitted, bakeTrack, sampleTrack, usesContract2, usesContract3, type Clip, type TrackKey } from "../src/animation"
import { ModelDesignJsonSchema, ModelDesignSchema } from "../src/contracts"
import { followClip, followSway } from "../src/follow-bones"
import { designFixture } from "./fixture"

type Vec = [number, number, number]
const line = (keys: TrackKey[], time: number) => sampleTrack(keys, time)![0]

test("easing：直线段按缓动走，两端不变；Back 冲过头、Bounce 回弹；没写 easing 的轨道和以前一样", () => {
  EASINGS.forEach((name) => {
    expect(EASE[name](0)).toBeCloseTo(0, 9)
    expect(EASE[name](1)).toBeCloseTo(1, 9)
  })
  const eased = (easing: TrackKey["easing"]): TrackKey[] => [{ time: 0, value: [0, 0, 0], easing }, { time: 1, value: [100, 0, 0] }]
  expect(line(eased("easeInQuad"), 0.5)).toBeCloseTo(25, 6)
  expect(line(eased("easeOutQuad"), 0.5)).toBeCloseTo(75, 6)
  expect(line(eased("easeInOutSine"), 0.5)).toBeCloseTo(50, 6)
  expect(line(eased("easeInOutSine"), 0.25)).toBeLessThan(25)
  expect(Math.max(...Array.from({ length: 99 }, (_, index) => line(eased("easeOutBack"), (index + 1) / 100)))).toBeGreaterThan(100)
  expect(Math.min(...Array.from({ length: 99 }, (_, index) => line(eased("easeInBack"), (index + 1) / 100)))).toBeLessThan(0)
  // The easing is the first key's: a key that names one only shapes the segment leaving it.
  expect(line([{ time: 0, value: [0, 0, 0] }, { time: 1, value: [100, 0, 0], easing: "easeInQuad" }, { time: 2, value: [0, 0, 0] }], 0.5)).toBeCloseTo(50, 6)
  // Next to a smooth key the curve is the smooth one: easing only bends a straight line.
  const beside: TrackKey[] = [{ time: 0, value: [0, 0, 0], easing: "easeInQuad" }, { time: 1, value: [100, 0, 0], interpolation: "smooth" }, { time: 2, value: [0, 0, 0] }]
  expect(line(beside, 0.5)).toBeCloseTo(line(beside.map(({ easing: _, ...key }) => key), 0.5), 9)
  const plain: TrackKey[] = [{ time: 0, value: [0, 0, 0] }, { time: 1, value: [100, 0, 0], interpolation: "smooth" }, { time: 2, value: [0, 0, 0] }]
  expect(bakeTrack(plain, false, BAKE_TOLERANCE.rotation)).toEqual(bakeTrack(plain.map((key) => ({ ...key })), false, BAKE_TOLERANCE.rotation))
})

/** Blockbench 5.1.6's own reading of a bezier segment (`Keyframe.getBezierLerp`): 200 points along the curve, the two nearest in time joined. */
function blockbenchBezier(from: TrackKey, to: TrackKey, axis: number, time: number) {
  const gap = to.time - from.time
  const p = [
    [from.time, from.value[axis]!],
    [from.time + Math.min(Math.max(from.bezier_right_time?.[axis] ?? 0.1, 0), gap), from.value[axis]! + (from.bezier_right_value?.[axis] ?? 0)],
    [to.time + Math.min(Math.max(to.bezier_left_time?.[axis] ?? -0.1, -gap), 0), to.value[axis]! + (to.bezier_left_value?.[axis] ?? 0)],
    [to.time, to.value[axis]!],
  ] as const
  const points = Array.from({ length: 201 }, (_, index) => {
    const s = index / 200
    return [0, 1].map((at) => (1 - s) ** 3 * p[0][at]! + 3 * (1 - s) ** 2 * s * p[1][at]! + 3 * (1 - s) * s * s * p[2][at]! + s ** 3 * p[3][at]!) as [number, number]
  })
  const sorted = [...points].sort((a, b) => Math.abs(a[0] - time) - Math.abs(b[0] - time))
  const [a, b] = [sorted[0]!, sorted[1]!]
  return a[1] + (b[1] - a[1]) * Math.min(Math.max((time - a[0]) / (b[0] - a[0]), 0), 1)
}

test("bezier：和 Blockbench 的贝塞尔一样；只写一端的手柄，另一端按默认 0.1 秒水平；切成直线段以后不超过精度", () => {
  const keys: TrackKey[] = [
    { time: 0, value: [0, 10, -20], interpolation: "bezier", bezier_right_time: [0.3, 0.05, 0.2], bezier_right_value: [60, 0, 15] },
    { time: 0.8, value: [45, -30, 10], interpolation: "bezier", bezier_left_time: [-0.1, -0.4, -0.05], bezier_left_value: [20, -10, 0], bezier_right_time: [0.1, 0.1, 0.1], bezier_right_value: [-5, 5, 0] },
    { time: 1.5, value: [0, 0, 0] },
  ]
  for (let time = 0; time <= 1.5; time += 0.01)
    [0, 1, 2].forEach((axis) => {
      const index = time < 0.8 ? 0 : 1
      expect(Math.abs(sampleTrack(keys, time)![axis]! - blockbenchBezier(keys[index]!, keys[index + 1]!, axis, time))).toBeLessThan(0.15)
    })
  const baked = bakeFitted(keys, false, "rotation")
  expect(baked.widened).toBe(1)
  expect(baked.keys.length).toBeGreaterThan(keys.length)
  expect(baked.keys.length).toBeLessThan(200)
  const linear = baked.keys.map((key) => ({ time: key.time, value: key.value }))
  for (let time = 0; time <= 1.5; time += 0.003) [0, 1, 2].forEach((axis) => expect(Math.abs(sampleTrack(linear, time)![axis]! - sampleTrack(keys, time)![axis]!)).toBeLessThan(BAKE_TOLERANCE.rotation * 1.6))
  // An easing bakes the same way.
  const eased: TrackKey[] = [{ time: 0, value: [0, 0, 0], easing: "easeOutElastic" }, { time: 1, value: [90, 0, 0] }]
  const fitted = bakeFitted(eased, false, "rotation")
  expect(fitted.over).toBe(false)
  const elastic = fitted.keys.map((key) => ({ time: key.time, value: key.value }))
  for (let time = 0; time <= 1; time += 0.002) expect(Math.abs(sampleTrack(elastic, time)![0]! - sampleTrack(eased, time)![0]!)).toBeLessThan(BAKE_TOLERANCE.rotation * fitted.widened * 2.5)
})

test("文档：easing、贝塞尔手柄、blend、layered、follow 都能写；旧文档不变；骨骼不存在、根骨骼、写两次的 follow 被拒", () => {
  const old = designFixture()
  expect(ModelDesignSchema.parse(old)).toEqual(old)
  const design = {
    ...old,
    bones: [...old.bones, { name: "cape", parent: "root", pivot: [0, 8, 2] as Vec, rotation: [0, 0, 0] as Vec, cubes: [] }],
    animations: old.animations.map((clip) => ({
      ...clip,
      blend: clip.name === "hurt" ? 3 : null,
      layered: clip.name === "hurt",
      channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] as Vec, interpolation: "bezier" as const, bezier_right_time: [0.2, 0.2, 0.2] as Vec, bezier_right_value: [10, 0, 0] as Vec }, { time: 0.5, rotation: [20, 0, 0] as Vec, easing: "easeInOutCubic" as const }, { time: 1, rotation: [0, 0, 0] as Vec }] }],
    })),
    follow: [{ bone: "cape", period: 0.6, damping: 0.25, drag: 8, limit: 40 }],
  }
  expect(ModelDesignSchema.parse(design)).toEqual(design)
  expect(design.animations.every(usesContract3)).toBe(true)
  expect(old.animations.some(usesContract3)).toBe(false)
  expect(usesContract2(design.animations[0]!)).toBe(true)
  const refused = (change: object) => ModelDesignSchema.safeParse({ ...design, ...change }).success
  expect(refused({ follow: [{ bone: "tail" }] })).toBe(false)
  expect(refused({ follow: [{ bone: "root" }] })).toBe(false)
  expect(refused({ follow: [{ bone: "cape" }, { bone: "cape" }] })).toBe(false)
  expect(refused({ follow: [{ bone: "cape", period: 0.05 }] })).toBe(false)
  expect(refused({ animations: design.animations.map((clip) => ({ ...clip, blend: 21 })) })).toBe(false)
  expect(refused({ animations: design.animations.map((clip) => ({ ...clip, channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0], easing: "wobble" }] }] })) })).toBe(false)
  // The strict JSON schema an outside AI writes against names the new words too.
  const text = JSON.stringify(ModelDesignJsonSchema)
  ;["easing", "bezier_right_value", "blend", "layered", "follow", "easeInOutBack"].forEach((word) => expect(text).toContain(word))
  // x_range is two numbers there too, not the three every tuple of the document is written as.
  expect(text).toContain(`"x_range":{"anyOf":[{"minItems":2,"maxItems":2`)
  expect(refused({ follow: [{ bone: "cape", x_range: [0, 60] }] })).toBe(true)
  expect(refused({ follow: [{ bone: "cape", x_range: [0, 60, 1] }] })).toBe(false)
  ;["blend", "layered", "follow", "period", "damping", "drag", "limit"].forEach((word) => expect(CLIP_PLAY_GUIDE).toContain(word))
})

const chain = () => {
  const design = designFixture()
  return {
    ...design,
    bones: [
      ...design.bones,
      { name: "arm", parent: "root", pivot: [0, 8, 0] as Vec, rotation: [0, 0, 0] as Vec, cubes: [] },
      { name: "flag", parent: "arm", pivot: [0, 8, 4] as Vec, rotation: [0, 0, 0] as Vec, cubes: [] },
      { name: "flag_tip", parent: "flag", pivot: [0, 4, 4] as Vec, rotation: [0, 0, 0] as Vec, cubes: [] },
    ],
    follow: [{ bone: "flag_tip" }, { bone: "flag", period: 0.6, damping: 0.3 }],
  }
}
const swing: Clip & { name: string } = {
  name: "swing",
  length: 2,
  loop: false,
  channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0], easing: "easeInCubic" }, { time: 0.4, rotation: [-80, 0, 0] }, { time: 2, rotation: [-80, 0, 0] }] }],
}

test("follow：上一级一甩，它先落后（方向相反）再晃回来、最后停住；一串骨骼一节一节传下去；同样的输入同样的结果", () => {
  const design = chain()
  const sway = followSway(design, swing)
  const flag = sway.get("flag")!
  const tip = sway.get("flag_tip")!
  // Steps are a quarter tick: 0.4 s is step 32. The arm turns to -80 on x, so the flag lags behind it, positive x.
  expect(flag[32]![0]).toBeGreaterThan(10)
  // It swings back past the arm afterwards, then settles where the arm is.
  expect(Math.min(...flag.slice(32, 120).map((value) => value[0]))).toBeLessThan(0)
  expect(Math.abs(flag[flag.length - 1]![0])).toBeLessThan(1.5)
  // The tip lags after the flag: its own biggest sway comes later.
  const peak = (list: Vec[]) => list.reduce((best, value, index) => (Math.abs(value[0]) > Math.abs(list[best]![0]) ? index : best), 0)
  expect(peak(tip)).toBeGreaterThan(peak(flag) - 1)
  expect(Math.max(...tip.map((value) => Math.abs(value[0])))).toBeLessThanOrEqual(35 + 1e-9)
  expect(followSway(design, swing)).toEqual(sway)
  // The preview clip carries the sway in the follow bones' rotation keys; a design without follow bones gets its clip back unchanged.
  const shown = followClip(design, swing)
  const keyed = shown.channels.find((channel) => channel.bone === "flag")!
  expect(keyed.keyframes.length).toBe(41)
  expect(keyed.keyframes[8]!.rotation[0]).toBeCloseTo(flag[32]![0], 6)
  expect(followClip(designFixture(), swing)).toBe(swing)
  // Moving forwards drags it back: a standing loop settles at rest, a walking one leans back by the drag.
  const still: Clip = { length: 1, loop: true, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] }
  expect(Math.abs(followSway(design, still).get("flag")!.at(-1)![0])).toBeLessThan(0.01)
  expect(followSway(design, still, 2).get("flag")!.at(-1)![0]).toBeCloseTo(12, 1)
})

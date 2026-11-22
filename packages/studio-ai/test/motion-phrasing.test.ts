import { expect, test } from "bun:test"
import { EPIC_MAKING, MAKING_LIMITS, makingLimits } from "../src/making"
import { MODEL_ART_DIRECTION } from "../src/model-quality"
import { EPIC_MOTION_GUIDE, PHRASING, epicBones, epicPhrasingFaults, measurePhrasing, phrasingLine } from "../src/motion-phrasing"
import { CLIP_PLAY_GUIDE, type Clip } from "../src/animation"
import { designFixture } from "./fixture"

type Vec = [number, number, number]
const design = () => {
  const base = designFixture()
  const limb = (name: string, x: number) => ({ name, parent: "root", pivot: [x, 8, 0] as Vec, rotation: [0, 0, 0] as Vec, cubes: [{ ...base.bones[0]!.cubes[0]!, name: `${name}_box`, origin: [x, 2, -1] as Vec, size: [2, 6, 2] as Vec }] })
  return { ...base, bones: [...base.bones, limb("arm_left", 3), limb("arm_right", -5), limb("tail", 0)] }
}
// A swing: 0.3 s back (wind-up), 0.15 s down eased in (strike), a little further (follow-through), 0.6 s back to rest (recovery).
const swing: Clip & { name: string } = {
  name: "smash",
  length: 1.2,
  loop: false,
  channels: [
    { bone: "arm_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.3, rotation: [40, 0, 0], easing: "easeInCubic" }, { time: 0.45, rotation: [-110, 0, 0], easing: "easeOutQuad" }, { time: 0.6, rotation: [-120, 0, 0] }, { time: 1.2, rotation: [0, 0, 0] }] },
    { bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.3, rotation: [-6, 0, 0] }, { time: 0.45, rotation: [10, 0, 0] }, { time: 1.2, rotation: [0, 0, 0] }], scale: [{ time: 0, scale: [1, 1, 1] }, { time: 0.3, scale: [1.05, 0.95, 1.05] }, { time: 0.6, scale: [1, 1, 1] }] },
    { bone: "tail", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1.2, rotation: [0, 0.5, 0] }] },
  ],
}

test("节奏：量出在动的骨骼、最快的一下、蓄势几刻、收势几刻", () => {
  const found = measurePhrasing(design(), swing)
  // The tail turns half a degree: not counted as moving.
  expect(found.bones_moved).toBe(2)
  expect(found.scaled).toBe(1)
  expect(found.peak_bone).toBe("arm_right")
  expect(found.strike_at).toBeGreaterThan(0.3)
  expect(found.strike_at).toBeLessThanOrEqual(0.45)
  // The six ticks it rises before it comes down.
  expect(found.anticipation).toBe(6)
  expect(found.recovery).toBeGreaterThanOrEqual(12)
  expect(found.peak_speed).toBeGreaterThan(1000)
  expect(phrasingLine(found, "砸（smash）")).toContain("蓄势）6 刻")
  // Straight down with no wind-up: none counted.
  const direct = measurePhrasing(design(), { ...swing, channels: [{ bone: "arm_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.1, rotation: [-110, 0, 0] }, { time: 0.2, rotation: [0, 0, 0] }] }] })
  expect(direct.anticipation).toBe(0)
  expect(measurePhrasing(design(), { ...swing, channels: [] }).strike_at).toBeNull()
})

test("史诗档：攻击动作要 20 根骨骼（或六成部件）、蓄势和收势；说明只讲给模型的制作方，其他档的上限不变", () => {
  const model = design()
  expect(epicBones(model)).toBe(Math.ceil(PHRASING.epic.share * 4))
  const faults = epicPhrasingFaults(model, measurePhrasing(model, swing), "砸（smash）")
  expect(faults).toHaveLength(1)
  expect(faults[0]).toContain("只有 2 根骨骼在动")
  const lazy = epicPhrasingFaults(model, measurePhrasing(model, { ...swing, channels: [{ bone: "arm_right", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.1, rotation: [-110, 0, 0] }, { time: 0.2, rotation: [0, 0, 0] }] }] }), "砸")
  expect(lazy.join("")).toContain("蓄势只有 0 刻")
  expect(lazy.join("")).toContain("收势")
  ;[EPIC_MOTION_GUIDE, CLIP_PLAY_GUIDE].forEach((guide) => expect(MODEL_ART_DIRECTION).toContain(guide))
  ;["蓄势", "出手", "余势", "收势", "20 根骨骼", "blend", "layered", "follow"].forEach((word) => expect(EPIC_MOTION_GUIDE).toContain(word))
  expect(makingLimits("epic")).toMatchObject({ rounds: 12, sheets: 6, kept: 12, own_motions: 6, frames: MAKING_LIMITS.frames })
  ;[null, undefined, "standard", "fine", "detailed"].forEach((tier) => expect(makingLimits(tier)).toBe(MAKING_LIMITS))
  expect(EPIC_MAKING.rounds as number).toBe(2 * MAKING_LIMITS.rounds)
})

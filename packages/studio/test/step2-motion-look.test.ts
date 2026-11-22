import { expect, test } from "bun:test"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { MAKING_LIMITS } from "@minemods/mod-core/making"
import { lookJob } from "../src/main/look-job"
import { capedGolem } from "../../mod-core/test/step2-fixture"

/**
 * 第 2 步 (动作) in what a maker is shown: a model's follow bones sway in the motions measured (and drawn: the viewport plays the same
 * `followClip`), every motion that does not loop gets a sentence on how it is phrased, an epic creature's attack motions are held to the
 * phrasing the guide asks for, and an epic model's look hands back up to six pictures.
 */

const golem = (budget: "epic" | null) => ({ kind: "model" as const, ...capedGolem, budget }) as ModuleDocument

test("跟随骨骼算进量出来的动作；不循环的动作多一句「节奏」", () => {
  const made = lookJob(golem(null), null, { animation: "burst" })
  const burst = made.motion.find((note) => note.name === "burst")!
  // The cape and its hem have no key in the burst: they move because they follow.
  expect(burst.moving).toBe(burst.parts)
  expect(made.facts.filter((line) => line.includes("的节奏"))).toHaveLength(capedGolem.animations.filter((clip) => !clip.loop && clip.name !== "hurt" && clip.name !== "death").length)
  expect(made.facts.find((line) => line.startsWith("「slam」的节奏"))).toContain("蓄势）")
  // Not epic: nothing is held against it.
  expect(made.measured ?? []).toEqual([])
})

test("史诗档：招式用的动作和 attack 达不到四段和 20 根骨骼，就作为量出来的毛病交回去；一次看图最多 6 张", () => {
  const made = lookJob(golem("epic"), null, { animation: "slam" }, null, null, null, null, { slam: [0.5, 0.7] })
  const faults = made.measured ?? []
  expect(faults.some((line) => line.startsWith("「slam」只有 2 根骨骼在动"))).toBe(true)
  expect(faults.some((line) => line.startsWith("攻击（attack）"))).toBe(true)
  // The burst is no ability's here, and loops are never attacks.
  expect(faults.some((line) => line.includes("burst") || line.includes("walk"))).toBe(false)
  const everything = { animation: "slam", angle: "back", close_up: "cape", shape_only: true, names: true } as const
  expect(lookJob(golem("epic"), null, everything).job.sheets).toHaveLength(6)
  expect(lookJob(golem(null), null, everything).job.sheets).toHaveLength(MAKING_LIMITS.sheets)
})

test("一次看图可以要几个动作的逐帧图（animations）：史诗档画得下五个，别的档按三张图的上限，没画的说出来", () => {
  const asked = { animation: "slam", animations: ["burst", "walk", "idle", "hurt"] }
  const epic = lookJob(golem("epic"), null, asked)
  expect(epic.job.sheets.map((sheet) => sheet.label)).toEqual(["六个角度", ...["slam", "burst", "walk", "idle", "hurt"].map((name) => epic.job.sheets.find((sheet) => sheet.label.includes(`（${name}）`) || sheet.label.includes(`「${name}」`))!.label)])
  const plain = lookJob(golem(null), null, asked)
  expect(plain.job.sheets).toHaveLength(MAKING_LIMITS.sheets)
  expect(plain.notes[0]).toContain(`一次最多 ${MAKING_LIMITS.sheets} 张图，这次没有画`)
  expect(() => lookJob(golem("epic"), null, { animations: ["dance"] })).toThrow("没有叫「dance」的动作")
})

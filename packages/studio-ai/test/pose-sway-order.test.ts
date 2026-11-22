import { expect, test } from "bun:test"
import { ModelDesignSchema } from "../src/contracts"
import { footPlan, footSolve, soleHeight } from "../src/foot-placement"
import { rigOf } from "../src/pose-rig"
import { quadrupedFixture } from "./quadruped-fixture"

test("踩地修正承重脚底，之后再转动上级骨骼仍会改变接触点", () => {
  const model = quadrupedFixture(), feet = footPlan(model)!, lift = [0, 0, -4, -4]
  function maximum(order: "none" | "before" | "after") {
    let worst = 0
    for (let frame = 0; frame < 160; frame++) {
      const rig = rigOf(model, null)
      const targets = lift
      const swing = () => { rig.rot[3 * feet.body] = 8 * Math.PI / 180 * Math.sin(Math.PI * frame / 20) }
      if (order === "before") swing()
      const extra = order === "after" ? 8 * Math.PI / 180 * Math.sin(Math.PI * frame / 20) : 0
      footSolve(rig, feet, lift)
      rig.rot[3 * feet.body] = rig.rot[3 * feet.body]! + extra
      feet.feet.forEach((f, i) => { worst = Math.max(worst, Math.abs(soleHeight(rig,f) - targets[i]!)) })
    }
    return worst
  }
  expect(maximum("none")).toBeLessThan(0.00011)
  expect(maximum("before")).toBeLessThan(0.00011)
  expect(maximum("after")).toBeGreaterThan(0.5)
  expect(ModelDesignSchema.safeParse({ ...model, sway: [{ bones: ["body"], axis: "x", speed: 0.5, amount: 8 }] }).success).toBe(false)
})

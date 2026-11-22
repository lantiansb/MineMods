import { expect, test } from "bun:test"
import { weightAt, weightSlew } from "../src/clip-weights"
import { lookPlan, lookSolve, lookStep } from "../src/look-bones"
import { apply, euler, placeOf, rigOf } from "../src/pose-rig"
import { swayAt, swayPlan } from "../src/sway-bones"
import { quadrupedFixture } from "./quadruped-fixture"

test("各节分摊后面对目标，超过限角时停在骨骼上限", () => {
  const model = quadrupedFixture()
  const plan = lookPlan({...model,look:{bones:[{bone:"body",share:0.4,yaw:20,pitch:12},{bone:"head",share:0.6,yaw:30,pitch:18}]}})!
  for (const [yaw,pitch,visibleYaw,visiblePitch] of [[25,12,25,12],[90,55,50,30]] as const) {
    const rig=rigOf(model,null)
    lookSolve(rig,plan,[yaw,pitch],1)
    const actual=apply(placeOf(rig,2).r,[0,0,-1])
    const wanted=apply(euler(visiblePitch*Math.PI/180,visibleYaw*Math.PI/180,0),[0,0,-1])
    actual.forEach((v,i)=>expect(v).toBeCloseTo(wanted[i]!,12))
  }
  expect(lookStep([0,0],[90,-60],120,0.05)).toEqual([6,-6])
})

test("相位让尾梢晚四分之一周期；权重点线性插值，每刻最多恢复两成", () => {
  const model=quadrupedFixture()
  const [s]=swayPlan({...model,sway:[{bones:["tail","tail_mid"],axis:"y",amount:8,speed:1,phase:90,grow:1.5}]})
  expect(swayAt(s!,0,0.25)).toBeCloseTo(8)
  expect(swayAt(s!,1,0.25)).toBeCloseTo(0)
  expect(swayAt(s!,1,0.5)).toBeCloseTo(12)
  const keys=[{time:1,value:0.2},{time:3,value:0.8}]
  expect(weightAt(keys,0)).toBe(0.2)
  expect(weightAt(keys,2)).toBeCloseTo(0.5)
  expect(weightAt(keys,4)).toBe(0.8)
  expect(weightSlew(0.1,1,1)).toBeCloseTo(0.3)
})

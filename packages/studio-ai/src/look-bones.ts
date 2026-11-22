import type { ModelDesign } from "./contracts"
import { euler, mul, transposed, turnBone, type Rig } from "./pose-rig"

export type Gaze = [number, number]
export function lookPlan(design: Pick<ModelDesign, "look" | "bones">) {
  if (!design.look) return null
  return { speed: design.look.speed ?? 180, bones: design.look.bones.map(link => ({
    ...link, index: design.bones.findIndex(bone => bone.name === link.bone),
  })) }
}
type Plan = NonNullable<ReturnType<typeof lookPlan>>
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value))
export function lookStep(state: Gaze, target: Gaze, speed: number, seconds: number): Gaze {
  const limit = speed * Math.max(0, seconds)
  return [state[0] + clamp(target[0] - state[0], limit), state[1] + clamp(target[1] - state[1], limit)]
}
export function lookSolve(rig: Rig, plan: Plan, gaze: Gaze, weight: number) {
  if (weight === 0) return
  let yaw = 0, pitch = 0
  let previous = euler(0, 0, 0)
  for (const link of plan.bones) {
    yaw += clamp(gaze[0] * link.share, link.yaw) * weight
    pitch += clamp(gaze[1] * link.share, link.pitch) * weight
    const turn = euler(pitch * Math.PI / 180, yaw * Math.PI / 180, 0)
    turnBone(rig, link.index, mul(turn, transposed(previous)))
    previous = turn
  }
}

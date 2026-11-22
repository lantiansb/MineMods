import type { ModelDesign } from "./contracts"
import type { Rig } from "./pose-rig"

export function swayPlan(model: Pick<ModelDesign, "bones" | "sway">) {
  return (model.sway ?? []).map(chain => ({
    bones: chain.bones.map(name => model.bones.findIndex(bone => bone.name === name)),
    channel: chain.channel ?? "rotation", axis: "xyz".indexOf(chain.axis), speed: chain.speed,
    amount: chain.amount, phase: (chain.phase ?? 0) * Math.PI / 180, grow: chain.grow ?? 1,
  }))
}
type Sway = ReturnType<typeof swayPlan>[number]
export const swayAt = (chain: Sway, link: number, seconds: number, phase = 0) =>
  chain.amount * chain.grow ** link * Math.sin(2 * Math.PI * chain.speed * seconds + phase - link * chain.phase)

export function swayApply(rig: Rig, plan: readonly Sway[], seconds: number, weight = 1, phase = 0) {
  for (const chain of plan) chain.bones.forEach((bone, i) => {
    const at = 3 * bone + chain.axis
    const offset = swayAt(chain, i, seconds, phase) * weight
    if (chain.channel === "rotation") rig.rot[at] = rig.rot[at]! + offset * Math.PI / 180 * (chain.axis === 2 ? 1 : -1)
    else if (chain.channel === "position") rig.pos[at] = rig.pos[at]! + offset
    else rig.scale[at] = rig.scale[at]! + offset
  })
}

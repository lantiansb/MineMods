import type { Clip } from "./animation"
import type { ModelDesign } from "./contracts"
import { lookPlan, lookSolve, lookStep, type Gaze } from "./look-bones"
import { clipWeightSampler } from "./clip-weights"
import { followClip } from "./follow-bones"
import { rigOf, rigParents, trackMove, trackTurn, type V3 } from "./pose-rig"
import { swayApply, swayPlan } from "./sway-bones"

export function programClip<C extends Clip>(design: ModelDesign, clip: C, forward = 0, target?: (seconds: number) => Gaze): C {
  const weight = clip.weights ? clipWeightSampler(clip.weights, clip.length) : undefined
  const sway = swayPlan(design)
  const look = target && lookPlan(design)
  let gaze: Gaze = [0, 0]
  if (!sway.length && !look) return design.follow?.length ? followClip(design, clip, forward, weight) : clip
  const bones = new Set(sway.flatMap(chain => chain.bones))
  for (const link of look?.bones ?? []) bones.add(link.index)
  const parent = rigParents(design)
  const times = Array.from({ length: Math.ceil(clip.length * 20) + 1 }, (_, i) => Math.min(i / 20, clip.length))
  const frames = times.map((time, i) => {
    const rig = rigOf(design, clip, time, undefined, parent)
    swayApply(rig, sway, time, weight?.("sway", time) ?? 1)
    if (look && target) {
      gaze = lookStep(gaze, target(time), look.speed, i ? time - times[i - 1]! : 0)
      lookSolve(rig, look, gaze, weight?.("look", time) ?? 1)
    }
    return rig
  })
  const channels = clip.channels.filter(channel => !bones.has(design.bones.findIndex(bone => bone.name === channel.bone)))
  for (const index of bones) channels.push({
    bone: design.bones[index]!.name,
    keyframes: frames.map((rig, i) => ({ time: times[i]!, rotation: trackTurn(design, rig, index) })),
    position: frames.map((rig, i) => ({ time: times[i]!, position: trackMove(rig, index) })),
    scale: frames.map((rig, i) => ({ time: times[i]!, scale: rig.scale.slice(index * 3, index * 3 + 3) as V3 })),
  })
  return followClip(design, { ...clip, channels }, forward, weight)
}

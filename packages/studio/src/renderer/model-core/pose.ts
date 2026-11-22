import { geckoBonePosition, geckoCubePosition, geckoRotation } from "../model-transform"
import { blockbenchInterpolate } from "./blockbench-animation"

type Vector = [number, number, number]
export type CompiledTrack = Record<string, Vector | { pre: Vector; post: Vector }>

/** Bedrock pre/post points preserve an imported Blockbench step at the next key. */
export function sampleCompiledTrack(track: CompiledTrack | undefined, time: number): Vector | undefined {
  const frames = Object.entries(track ?? {}).map(([key, value]) => ({ time: Number(key), pre: Array.isArray(value) ? value : value.pre, post: Array.isArray(value) ? value : value.post })).sort((a, b) => a.time - b.time)
  if (!frames.length) return undefined
  if (time <= frames[0]!.time) return frames[0]!.post
  const next = frames.findIndex(frame => frame.time > time)
  if (next === -1) return frames.at(-1)!.post
  return blockbenchInterpolate([{ time: frames[next - 1]!.time, value: frames[next - 1]!.post }, { time: frames[next]!.time, value: frames[next]!.pre }], time)
}

export function previewCubePose(cube: { origin: Vector; size: Vector; pivot?: Vector; rotation?: Vector }, bonePivot: Vector) {
  const pivot = cube.pivot ?? bonePivot
  return { pivot: geckoBonePosition(pivot, bonePivot), position: geckoCubePosition(cube.origin, cube.size, pivot), rotation: geckoRotation(cube.rotation ?? [0, 0, 0]) }
}

/** Geometry and translations share the GeckoLib mirrored X coordinate system. */
export function previewBonePosition(base: Vector, offset: Vector, animation: Vector = [0, 0, 0]): Vector {
  return [base[0] + offset[0] - animation[0], base[1] + offset[1] + animation[1], base[2] + offset[2] + animation[2]]
}

import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { sampleBone } from "@minemods/studio-ai/animation"

/**
 * The one sampler lives in `@minemods/studio-ai/animation` (the animation contract) so that the motion
 * measure, the exporters and this viewport all play a clip through the same function. Import `sampleBone`
 * from either place: it gives a bone's rotation, position and scale at a moment, in the document's axes.
 */
export { ANIMATION_CONTRACT, clipCursor, sampleBone, sampleTrack, type BoneSample, type Clip } from "@minemods/studio-ai/animation"

export type Rotation = [number, number, number]

/** The rotation part of `sampleBone`, for callers that only turn things. */
export function sampleAnimation(
  animation: ModelDesign["animations"][number],
  bone: string,
  time: number,
): Rotation | undefined {
  return sampleBone(animation, bone, time)?.rotation
}

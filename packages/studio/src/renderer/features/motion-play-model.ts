import type { Project } from "@minemods/mod-core/project"
import { extraAnimations, type Source } from "./asset-picture"
import { motionNamer } from "./asset-words"

type Clip = { name: string; length: number; loop: boolean; channels: { bone: string }[] }

/**
 * The motions a model can be shown playing: the ones in the model itself, then the ones saved on their own for it that only move parts it has (an animation naming a part
 * the model lacks cannot play, and is not offered). One rule for the viewer that plays them and for the list that counts them, so the two never differ.
 */
export function playableClips<T extends Clip, S extends Clip>(own: readonly T[], saved: readonly S[], bones: ReadonlySet<string>) {
  const known = new Set(own.map((value) => value.name))
  return [...own, ...saved.filter((value) => !known.has(value.name) && value.channels.every((channel) => bones.has(channel.bone)))]
}

/** One motion as the play list says it: the name a player knows it by, and the ability (招式) that plays it when a creature has one. */
export type PlayableMotion = { name: string; label: string; loop: boolean }

/**
 * Every motion of the model a thing shows on (the model itself, or the one its creature wears), each named as the motion buttons name it (`motionWords`): 「蓄力（招式：冲锋）」.
 * Read from the saved project, so it is known without drawing anything: the card and the 制作现场 can say how many there are, and offer to play them, before the view is made.
 * A creature whose model is not among the saved assets has its motions only in the compiled shape, which is not known here: the list is then empty, not a claim that it cannot move.
 */
export function playableMotions(project: Project, source: Pick<Source, "model_asset_id" | "entity_id">): PlayableMotion[] {
  const modelId = source.model_asset_id ?? project.entities.find((value) => value.id === source.entity_id)?.model_asset_id ?? null
  const asset = modelId ? project.workspace.assets.find((value) => value.id === modelId) : undefined
  if (!modelId || asset?.document.kind !== "model") return []
  const document = asset.document
  const bones = new Set(document.bones.map((bone) => bone.name))
  const named = motionNamer(project, modelId)
  return playableClips(document.animations, extraAnimations(project, modelId), bones).map((value) => ({ name: value.name, label: named(value.name), loop: value.loop }))
}

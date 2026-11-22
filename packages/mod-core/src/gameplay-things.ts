import { creatureName, gameplayThings, thingWord } from "./gameplay"
import { alreadyOnThings, type Already, type OtherGameplay } from "./gameplay-already"
import type { Project } from "./project"
import { mayBePlayedByGameplay, playedAnimations } from "./reconcile"

/** One thing of the project as the AI that writes a gameplay is shown it. */
export type WriterThing = {
  asset_id: string
  kind: string
  title: string
  accessor: string | null
  /** A creature only: the other asset ids that read the same creature (its model's asset and the asset of its rules). They are no other creatures. */
  also_read_as?: string[]
  /** A creature only: the motions of its model, and whether anything else already plays each one (`ProjectContent.playMotion` plays any of them). */
  motions?: { clip: string; played: boolean }[]
  /** What already acts on this thing and by whom: its own settings ("它自己") and every other gameplay that lists it. Left out when nothing does. */
  already?: Already[]
}

/**
 * What a gameplay may attach to, as its writer reads it: one entry for each thing, a creature once however many assets read it, and for a creature
 * the motions its model has with which of them nothing else plays yet. `except` is the gameplay being written: what it played in an earlier version
 * does not count, so a motion it plays is still listed as one to play. `gameplays` are the other gameplays and what they say they do (`OtherGameplay`):
 * each thing carries what already acts on it, its own settings and those gameplays, so a writer does not do again what is done.
 */
export function gameplayThingsForWriter(project: Project, except: string | null, gameplays: readonly OtherGameplay[] = []): WriterThing[] {
  const all = gameplayThings(project).filter((thing) => thing.asset_id !== except)
  const others = { ...project, workspace: { ...project.workspace, assets: project.workspace.assets.filter((asset) => asset.id !== except) } }
  const already = new Map(alreadyOnThings(project, null, gameplays, except).map((entry) => [entry.thing.asset_id, entry.already]))
  return all
    .filter((thing) => thing.alias_of === null)
    .map((thing): WriterThing => {
      const base = { asset_id: thing.asset_id, kind: thingWord(thing.kind), title: thing.title, accessor: thing.accessor, ...(already.has(thing.asset_id) ? { already: already.get(thing.asset_id)! } : {}) }
      if (thing.kind !== "creature") return base
      const aliases = all.filter((other) => other.alias_of === thing.asset_id).map((other) => other.asset_id)
      const entity = project.entities.find((value) => creatureName(value) === thing.registry)
      const model = entity ? project.workspace.assets.find((asset) => asset.id === entity.id && asset.document.kind === "model")?.document : undefined
      const clips = model?.kind === "model" ? model.animations.map((clip) => clip.name) : []
      // Gameplay code that picks a motion by a name it builds may be playing any of them: none is said to be left.
      const played = entity && clips.length ? (mayBePlayedByGameplay(others, entity.id) ? clips : playedAnimations(others, entity.id, clips)) : []
      return { ...base, ...(aliases.length ? { also_read_as: aliases } : {}), ...(clips.length ? { motions: clips.map((clip) => ({ clip, played: played.includes(clip) })) } : {}) }
    })
}

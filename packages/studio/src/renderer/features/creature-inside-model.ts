import { thingName } from "../words"
import type { Project } from "@minemods/mod-core/project"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { creatureMoves } from "@minemods/mod-core/combat-design"
import { bossPhaseIds } from "@minemods/mod-core/boss-words"
import { bossOwn, bossWords } from "@minemods/mod-core/creature-boss"
import { creatureBindings } from "@minemods/mod-core/creature-abilities"
import { soundMoments } from "@minemods/mod-core/sound-moments"
import { gameplayPlays, mayBePlayedByGameplay } from "@minemods/mod-core/gameplay-motions"
import { boneTitles, motionNamer } from "./asset-words"

export type CreatureDocument = Extract<ModuleDocument, { kind: "entity" }>
export type InsideTab = "moves" | "phases" | "stances" | "shows" | "sounds"
export function creatureInside(project: Project, doc: CreatureDocument) {
  const modelAsset = project.workspace.assets.find((a) => a.id === doc.model_asset_id)
  const model = modelAsset?.document.kind === "model" ? modelAsset.document : null
  const moves = doc.behavior === "hostile" ? creatureMoves(doc, project.workspace) : []
  const combos = doc.behavior === "hostile" ? (doc.combos ?? []) : []
  const boss = doc.behavior === "hostile" ? doc.boss : null
  const actions = [...moves, ...combos]
  const title = (id: string) => thingName(project.workspace.assets.find((a) => a.id === id)) ?? null
  const motion = motionNamer(project, doc.model_asset_id)
  const bones = boneTitles(model?.bones ?? [], undefined, false)
  const bone = (id: string) => bones.get(id) ?? (/[一-龥]/.test(id) ? id : "指定部位")
  const names = { ...bossOwn(doc), aliases: doc.particles, title, motion, bone, displayNames: true }
  const phases = boss
    ? bossPhaseIds(
        boss.phases,
        actions.map((a) => a.id),
      ).map((ids, i, all) => {
        const phase = boss.phases[i - 1]
        const previous = all[i - 1] ?? []
        return {
          percent: phase ? Math.round(100 * phase.below) : 100,
          ids,
          added: i ? ids.filter((id) => !previous.includes(id)) : [],
          removed: i ? previous.filter((id) => !ids.includes(id)) : [],
          text: phase
            ? bossWords.phase(phase, actions, names, ids)
            : bossWords.firstPhase(boss, actions) || "全程能用所有招式",
        }
      })
    : []
  const shows = boss ? (["intro", "death"] as const).flatMap((key) => (boss[key] ? [key] : [])) : []
  const sounds = soundMoments(project, doc.model_asset_id)
  return { project, doc, name: thingName(project.workspace.assets.find(a => a.document.kind === "entity" && a.document.model_asset_id === doc.model_asset_id)) ?? doc.name, model, moves, combos, boss, actions, title, motion, names, phases, shows, sounds }
}
export type CreatureInside = ReturnType<typeof creatureInside>
export const insideTabs = [
  { key: "moves", title: "招式", count: (m: CreatureInside) => m.moves.length },
  { key: "phases", title: "阶段", count: (m: CreatureInside) => m.phases.length },
  { key: "stances", title: "姿态", count: (m: CreatureInside) => m.doc.stances?.list.length ?? 0 },
  { key: "shows", title: "演出", count: (m: CreatureInside) => m.shows.length },
  { key: "sounds", title: "声音", count: (m: CreatureInside) => m.sounds.filter((s) => s.ref).length },
] as const

export function motionRows(project: Project, id: string, clips: NonNullable<CreatureInside["model"]>["animations"]) {
  const entity = project.workspace.assets.find(
    (a) => a.document.kind === "entity" && a.document.model_asset_id === id,
  )?.document
  const creature = entity?.kind === "entity" ? entity : project.entities.find((e) => e.id === id)
  const binds = creatureBindings(
    {
      ...creature,
      abilities: creature && creature.behavior === "hostile" ? creatureMoves(creature, project.workspace) : [],
    },
    clips,
    project.logic.filter((rule) => rule.entity_id === id),
  )
  const gameplay = gameplayPlays(project, id)
  const dynamic = mayBePlayedByGameplay(project, id)
  const name = motionNamer(project, id)
  return clips.map((clip, i) => {
    const uses = [
      ...binds.clips[i]!.sources.map((source) => source.words),
      ...gameplay.filter((p) => p.clip === clip.name).map((p) => "玩法「" + p.name + "」"),
      ...(["intro", "death"] as const).flatMap((key) =>
        (creature?.boss?.[key]?.steps ?? []).some((s) => s.type === "clip" && s.clip === clip.name)
          ? [key === "intro" ? "登场演出" : "死亡演出"]
          : [],
      ),
    ]
    return {
      clip,
      title: clip.display_name || name(clip.name),
      uses: uses.join("、") || (dynamic ? "玩法可能会按名字播放它" : "没有任何地方会播放它"),
    }
  })
}

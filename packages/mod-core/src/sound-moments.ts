import type { Project } from "./project"
import type { WorkspaceAsset } from "./workspace"
import { soundReach } from "./sound-range"
import { SOUND_MOMENTS } from "./data-words"
import { bossShowSteps } from "./boss-show"
import { combatParticleCounts } from "./combat-particles"
import type { SoundRef } from "./sound"
import type { AbilityAssetDocument } from "./ability-asset"
import { ABILITY_SOUNDS } from "./ability-words"
import { BUILTIN_LABELS, type Builtin } from "./builtin"
import { impactSlots } from "./impact-slots"

const builtins: Record<string, [string, string]> = {
  ANVIL_LAND: ["block.anvil.land", "铁砧落地"],
  ENDER_DRAGON_FLAP: ["entity.ender_dragon.flap", "末影龙拍翼"],
  GENERIC_EXPLODE: ["entity.generic.explode", "爆炸声"],
  BEACON_ACTIVATE: ["block.beacon.activate", "信标启动"],
  BEACON_POWER_SELECT: ["block.beacon.power_select", "信标选择效果"],
  CREEPER_PRIMED: ["entity.creeper.primed", "引信声"],
  ITEM_BREAK: ["entity.item.break", "物品破碎"],
  WITHER_SPAWN: ["entity.wither.spawn", "凋灵出现"],
  PLAYER_ATTACK_CRIT: ["entity.player.attack.crit", "暴击声"],
}
/** Which entry of the creature's `builtin` table a built-in sound answers to, from where it plays (and, for the summon's two, which of them it is). */
function builtinKey(where: string, id: string): keyof Builtin | null {
  if (where === "召唤") return id === "WITHER_SPAWN" ? "summon_success" : id === "ITEM_BREAK" ? "summon_blocked" : null
  const key = (Object.keys(BUILTIN_LABELS) as (keyof Builtin)[]).find((k) => BUILTIN_LABELS[k] === where)
  return key && key !== "terrain_shatter" && key !== "fog_edge" ? key : null
}
export type SoundMomentRow = {
  key: string
  where: string
  ref: SoundRef | null
  name: string
  source: string
  detail?: string
  reach?: string
  editable: boolean
  owner: string
  path: (string | number)[]
}
type MomentSpec = { where: string; ref: SoundRef | null | undefined; path: (string | number)[]; fixed?: boolean; detail?:string; volume?: number; range?: number }
function row(p: Project, owner: string, m: MomentSpec): SoundMomentRow {
  const ref = m.ref ?? null
  const name =
    typeof ref === "string"
      ? (ABILITY_SOUNDS[ref] ?? Object.values(builtins).find(([id]) => id === ref)?.[1] ?? "原版声音")
      : ref
        ? (p.workspace.assets.find((a) => a.id === ref.asset)?.title ?? "找不到声音")
        : "没有设"
  return {
    ...m,
    reach: ref && ref !== "none" ? (m.range === undefined ? "通常约 " : "") + soundReach(m.volume ?? 1, m.range) + " 格" : undefined,
    ref:ref==="none"?null:ref,
    key: owner + "/" + m.path.join("/") + "/" + m.where,
    owner,
    name:ref==="none"?"不响":name,
    source: ref==="none"?"已关闭":!ref ? "没有设" : typeof ref === "string" ? "原版" : "自己的",
    editable: !!owner && !m.fixed,
  }
}
function pitchWords(event:{pitch:number;pitch_variation?:number;pitch_to?:number}) {
  return [event.pitch_variation ? "音高上下浮动 "+Math.round(event.pitch_variation*100)+"%" : "",event.pitch_to!==undefined ? "音高从 "+event.pitch+" 变到 "+event.pitch_to : ""].filter(Boolean).join("，")
}
function chronological<T extends { at: number }>(events: readonly T[]) {
  return events.map((event, index) => ({ event, index })).sort((a, b) => a.event.at - b.event.at || a.index - b.index)
}
function abilityRows(p: Project, a: WorkspaceAsset, doc: AbilityAssetDocument) {
  const list: MomentSpec[] = []
  chronological(doc.events).forEach(({ event, index }) => {
    if (event.type === "sound")
      list.push({ where: "技能「" + a.title + "」第 " + event.at + " 秒", ref: event.sound, volume:event.volume, range:event.range_blocks, detail:pitchWords(event), path: ["events", index, "sound"] })
  })
  // r29: the moments it runs into something, said as such (撞上时), not by a second.
  for (const slot of impactSlots([{ name: a.title, stages: doc.stages, moves: doc.moves }]))
    if (slot.fx.sound !== undefined) list.push({ where: slot.words.replace(/^招式「/, "技能「"), ref: slot.fx.sound, volume: slot.fx.volume, detail: "撞上那一刻放，不按第几秒", path: [...slot.path, "sound"] })
  const labels = { start: "开始时", loop: "持续时", end: "结束时" }
  for (const key of ["start", "loop", "end"] as const)
    if (doc.sounds?.[key]) list.push({ where: "技能「" + a.title + "」" + labels[key], ref: doc.sounds[key], range:doc.sound_ranges?.[key], detail:key==="loop"&&doc.loop_pitch?"音高从 "+doc.loop_pitch.from+" 变到 "+doc.loop_pitch.to:"", path: ["sounds", key] })
  return list.map((m) => row(p, a.id, m))
}
export function soundMoments(p: Project, entityId: string) {
  const original = p.entities.find((e) => e.id === entityId)
  if (!original) return []
  const runtime = p.workspace.assets.find((a) => a.document.kind === "entity" && a.document.model_asset_id === entityId)
  const e = runtime?.document.kind === "entity" ? { ...original, ...runtime.document } : original
  const owner = runtime?.id ?? ""
  const list: MomentSpec[] = Object.entries(SOUND_MOMENTS).map(([key, where]) => ({
    where,
    ref: e.sounds?.[key as keyof typeof SOUND_MOMENTS],
    volume: (e.sounds?.volume ?? 1) * (key === "step" ? 0.15 : 1), range: e.sounds?.ranges?.[key as keyof typeof SOUND_MOMENTS] ?? e.sounds?.range_blocks,
    path: ["sounds", key],
  }))
  const steps = bossShowSteps(e.boss).sort((a, b) => a.step.at - b.step.at || a.index - b.index)
  function appendShow(show: "intro" | "death") {
    for (const { show: kind, step, index } of steps) {
      if (kind !== show || step.type !== "sound") continue
      list.push({
        where: (show === "intro" ? "登场" : "死亡") + "演出第 " + step.at + " 秒",
        ref: step.sound, volume:step.volume, range:step.range_blocks,
        path: ["boss", show, "steps", index, "sound"],
      })
    }
  }
  if (e.boss?.intro) list.push({ where: "登场吼声", ref: e.boss.intro.sound, volume:e.boss.intro.volume ?? 2, range:e.boss.intro.range_blocks, path: ["boss", "intro", "sound"] })
  appendShow("intro")
  for (const [i, a] of (e.abilities ?? []).entries())
    chronological(a.events).forEach(({ event, index: j }) => {
      if (event.type === "sound")
        list.push({ where: "招式「" + a.name + "」第 " + event.at + " 秒", ref: event.sound, volume:event.volume, range:event.range_blocks, detail:pitchWords(event), path: ["abilities", i, "events", j, "sound"] })
    })
  // r29: the moments it runs into something (a wall, somebody, the start of a daze), said as such (撞上时), not by a second.
  for (const slot of impactSlots(e.abilities ?? [], e.stagger === undefined ? [] : Array.isArray(e.stagger) ? e.stagger : [e.stagger]))
    if (slot.fx.sound !== undefined) list.push({ where: slot.words, ref: slot.fx.sound, volume: slot.fx.volume, detail: "撞上那一刻放，不按第几秒", path: [...(slot.ability === null ? [] : ["abilities", slot.ability]), ...slot.path, "sound"] })
  e.boss?.phases.forEach((phase, index) => {
    list.push({ where: "第 " + (index + 1) + " 次变身开始时", ref: phase.sound, volume:phase.volume, range:phase.range_blocks, path: ["boss", "phases", index, "sound"] })
  })
  appendShow("death")
  e.hitbox?.parts?.forEach((part, index) => {
    if (part.weakpoint_sound) list.push({ where: "弱点受击", ref: part.weakpoint_sound, path: ["hitbox", "parts", index, "weakpoint_sound"] })
  })
  // The generators' own sounds, from the structured list (the worded one is for people: it names each by a plain name, not by its constant).
  for (const entry of combatParticleCounts(e, e.abilities ?? []).builtin) {
    if (entry.kind !== "sound") continue
    const sound = builtins[entry.id]
    if (!sound) continue
    const key = builtinKey(entry.where, entry.id)
    const chosen = key ? (e.builtin?.[key] as { sound?: SoundRef } | undefined)?.sound : undefined
    const where = entry.where === "召唤" && key ? BUILTIN_LABELS[key] : entry.where
    if (key) list.push({ where: where + "（Studio 自带，可以换成自己的）", ref: chosen ?? sound[0], path: ["builtin", key, "sound"], ...(chosen ? { detail: "原来是" + sound[1] } : {}) })
    else list.push({ where: entry.where + "（Studio 自带，这一版还不能换）", ref: sound[0], path: [entry.id], fixed: true })
  }
  const shared = (e.shared_abilities ?? []).flatMap((use) => {
    const a = p.workspace.assets.find((a) => a.id === use.asset)
    return a?.document.kind === "ability" ? abilityRows(p, a, a.document) : []
  })
  return [...list.map((m) => row(p, owner, m)), ...shared]
}
export function soundUsers(p: Project, id: string) {
  const music = p.entities.flatMap(e => {
    const cue = e.boss?.music
    if (!cue || cue.asset !== id) return []
    const owner = p.workspace.assets.find(a => a.document.kind === "entity" && a.document.model_asset_id === e.id)
    return [{ key: "boss.music", owner: owner?.id ?? e.id, entity: e.id, title: owner?.title ?? e.name,
      where: `从${cue.starts === "wake" && e.boss?.intro ? "登场" : "开打"}播放，脱战 ${cue.fade_seconds} 秒淡出` }]
  })
  const owners = p.entities.flatMap((e) =>
    soundMoments(p, e.id)
      .filter((r) => r.ref && typeof r.ref === "object" && r.ref.asset === id)
      .map((r) => ({
        key:r.key,owner: r.owner,
        entity: e.id,
        title: p.workspace.assets.find((a) => a.document.kind === "entity" && a.document.model_asset_id === e.id)?.title ?? e.name,
        where: r.where,
      })),
  )
  const abilities = p.workspace.assets.flatMap((a) =>
    a.document.kind === "ability"
      ? abilityRows(p, a, a.document)
          .filter((r) => typeof r.ref === "object" && r.ref?.asset === id)
          .map((r) => ({key:r.key, owner: a.id, entity: null, title: a.title, where: r.where }))
      : [],
  )
  return [...music, ...owners, ...abilities]
}

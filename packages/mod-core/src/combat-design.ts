import { abilityRef, boneRef } from "./finding-refs"
import { appendageBoneGaps } from "@minemods/studio-ai/model-structure"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { castTick, expandedMoves, timelineTicks, type AbilityAssetDocument, type Scalable } from "./ability-asset"
import { COUNTER_SECONDS, HEAVY_DAMAGE, SHORT_VISUAL_SECONDS } from "./combat-design-words"
import { TICKS } from "./ability-words"
import { isDash } from "./ability-dash"
import { isLeave } from "./arena"
import type { Ability, Hitbox } from "./entity-runtime"
import { effectMeasure, type EffectDocument } from "./effect"
import type { ParticleDocument } from "./particle"
import { emitTicks } from "./particle-emission"
import type { Project } from "./project"

const heavy = HEAVY_DAMAGE
const counter = castTick(COUNTER_SECONDS)
const damageAtBase = (damage: Scalable | null) => typeof damage === "number" ? damage : damage?.base ?? 0

const advice = {
  terrain_restore: { label: "离场还原", fix: "给 Boss 的临时换块事件写 restore_on_exit:true，脱战或死亡后立即还原场地。" },
  hit_feedback: { label: "命中反馈", fix: "每次出手把粒子、效果或地面形状、声音放在同一刻或相邻一刻；重招再加震屏或碎块。真实落点用 impact，需在落点播放声音时用玩法入口。" },
  windup_sound: { label: "起手提示音", fix: "在第一次出伤以前加一个 sound；技能也可用 sounds.start。立刻出伤时往后移一刻以上，让人先听见提示。" },
  recovery_ratio: { label: "单击收招", fix: "把只有一下出伤的招式延长到有至少半段起手那么长的收招；延长 length 和对应动作，技能可把收尾声音或效果排在时间线末尾。" },
  facing_lock: { label: "出手锁朝向", fix: '要先瞄再锁，写 track_until 为首击时刻的约 80%；一开始就定住时用 facing: "lock"。' },
  counter_window: { label: "重招后的反击机会", fix: `从最后出伤到下一次出手留至少 ${COUNTER_SECONDS} 秒。延长收招，或明确让下一招等一会儿。单招冷却只管同一招；连放期间的冷却也不会立即生效。` },
  short_visual: { label: "短效视觉", fix: "让短粒子全亮并在消失前调低 opacity.end；短效果用全亮或叠加，临近结束缩小形状，或在出手时配逐渐变透明的粒子。" },
  appendage_chain: { label: "附属物的分节", fix: '把同一条尾巴、披风、胡子或链子拆成 2 至 6 节，逐节设 parent，再在这些节上写 follow 或 mode: "hang"。' },
  particle_mix: { label: "粒子用量", fix: "把招式的主视觉换成符合题材的自制粒子或效果，保留少量原版点缀。内置的场地和受击表现单独记录。" },
} as const
export type DesignRule = keyof typeof advice
export const isDesignRule = (rule: string) => Object.hasOwn(advice, rule)
export type DesignHint = { rule: DesignRule; text: string; fix: string; stops: false; refs?: FindingRef[] }
// The build result stores at most 600 characters per warning.
const TEXT_LIMIT = 600
export const hint = (rule: DesignRule, text: string, refs: FindingRef[] = []): DesignHint => ({
  rule,
  text: text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT - 1) + "…" : text,
  fix: advice[rule].fix,
  stops: false,
  ...(refs.length ? { refs } : {}),
})

type Layer = "粒子" | "形状" | "声音" | "震屏或碎块"
type Moment = { tick: number; damage: number; index?: number; impact?: readonly Layer[]; until?: number }
type Cue = { tick: number; layer: Layer; hit?: number | null; until?: number }
type MoveDesign = { name: string; ref?: FindingRef; end: number; moments: Moment[]; cues: Cue[]; sustained?: boolean; tracking?: number; wait: number; availableAgain?: number }
const THREE: readonly Layer[] = ["粒子", "形状", "声音"]
const SHAPES = new Set(["flash", "effect", "hazard", "crack", "shockwave", "beam", "terrain_rise", "block_swap", "lightning", "trail"])

function cuesFor(events: readonly (Ability["events"][number] | AbilityAssetDocument["events"][number])[]): Cue[] {
  return events.flatMap((event): Cue[] => {
    const tick = castTick(event.at)
    if (event.type === "hit_fx") return [...THREE, ...(event.level === "heavy" ? ["震屏或碎块" as const] : [])].map(layer => ({tick, hit:event.hit, layer}))
    const hit = "hit" in event && "where" in event && event.where === "hit" ? event.hit : undefined
    return [
      ...(event.type === "particle" ? emitTicks(event).map(tick => ({ tick, hit, layer: "粒子" as const })) : []),
      // A weapon trail is seen for as long as it is drawn (`at` to `until`), so it is the shape of every hit inside that span, not only of one landing
      // on the tick it starts: a sweep whose trail began at the wind-up was told it had no visible shape (r20, on a real project).
      ...(SHAPES.has(event.type) ? [{ tick, hit, layer: "形状" as const, ...(event.type === "trail" ? { until: castTick(event.until) } : {}) }] : []),
      ...(event.type === "hazard" && event.particle !== undefined ? [{ tick, layer: "粒子" as const, until: tick + castTick(event.seconds) }] : []),
      ...(event.type === "sound" ? [{ tick, layer: "声音" as const }] : []),
      ...(event.type === "shake" || event.type === "debris" || event.type === "break" || event.type === "terrain_rise" && event.shatter
        ? [{ tick, hit, layer: "震屏或碎块" as const }] : []),
    ]
  })
}

function timingGaps(move: MoveDesign): { rule: DesignRule; detail: string }[] {
  if (!move.moments.length) return []
  const first = Math.min(...move.moments.map((moment) => moment.tick))
  const last = Math.max(...move.moments.map((moment) => moment.until ?? moment.tick))
  const hitGaps = move.moments.flatMap((moment) => {
    const heardAndSeen = new Set<Layer>(moment.impact ?? [])
    for (const cue of move.cues) {
      if (cue.hit != null && cue.hit !== moment.index) continue
      if (cue.tick <= moment.tick + 1 && (cue.until ?? cue.tick) >= moment.tick - 1) heardAndSeen.add(cue.layer)
    }
    const wants = moment.damage >= heavy ? [...THREE, "震屏或碎块" as const] : THREE
    const missing = wants.filter((layer) => !heardAndSeen.has(layer))
    return missing.length ? [`第 ${moment.index === undefined ? moment.tick / TICKS + " 秒" : (moment.index + 1) + " 下"}少${missing.join("、")}`] : []
  })
  const recovery = Math.max(0, move.end - last)
  const counterTime = Math.max(0, move.end - Math.max(last, move.availableAgain ?? 0)) + move.wait
  return [
    ...(hitGaps.length ? [{ rule: "hit_feedback" as const, detail: hitGaps.slice(0, 3).join("，") + (hitGaps.length > 3 ? `，共 ${hitGaps.length} 下缺反馈` : "") }] : []),
    ...(!move.cues.some((cue) => cue.layer === "声音" && cue.tick < first) ? [{ rule: "windup_sound" as const, detail: `首次出伤前（${first / TICKS} 秒）没听到提示` }] : []),
    ...(!move.sustained && move.moments.length === 1 && recovery * 2 < first ? [{ rule: "recovery_ratio" as const, detail: `起手 ${first / TICKS} 秒，收招 ${recovery / TICKS} 秒` }] : []),
    ...(move.tracking !== undefined && move.tracking > 0 && move.tracking >= first ? [{ rule: "facing_lock" as const, detail: `到首次出手（${first / TICKS} 秒）还没有提前定住朝向` }] : []),
    ...(move.moments.some((moment) => moment.damage >= heavy) && counterTime < counter ? [{ rule: "counter_window" as const, detail: `最后出伤且能被打到以后只量到 ${counterTime / TICKS} 秒` }] : []),
  ]
}

function creatureMove(move: Ability, wait: number, parts: Hitbox["parts"]): MoveDesign {
  const moments: Moment[] = move.hits.flatMap((hit, index) => {
    if (hit.type === "gameplay" || (hit.type === "shot" ? hit.damage === 0 : hit.damage <= 0)) return []
    const dash = move.moves.filter(isDash).find((value) => value.hit === index)
    const impact: Layer[] = hit.type === "projectile" && hit.impact
      ? [...(hit.impact.particle || hit.impact.ground?.some((ground) => ground.type === "hazard" && ground.particle !== undefined) ? ["粒子" as const] : []), ...(hit.impact.effect || hit.impact.ground?.length ? ["形状" as const] : []), ...(hit.impact.shake ? ["震屏或碎块" as const] : [])]
      : []
    return [{ index, tick: castTick(dash?.from ?? hit.at), damage: hit.damage ?? 0, impact, ...(dash ? { until: castTick(dash.to) } : {}) }]
  })
  for (const event of move.events) {
    if (event.type === "terrain_rise" && (event.damage ?? 0) > 0) {
      const tick = castTick(event.at)
      moments.push({ tick: tick + 1, until: tick + castTick(event.rise_seconds) + castTick(event.stay_seconds), damage: event.damage!, impact: ["形状"] })
      continue
    }
    if (event.type !== "lightning" && event.type !== "hazard" && event.type !== "beam" && event.type !== "shockwave") continue
    if (event.damage <= 0 && (event.type !== "hazard" || !(event.burn_seconds ?? 0))) continue
    const tick = castTick(event.at)
    const interval = event.type === "hazard" || event.type === "beam" ? event.every_ticks : 0
    const end = event.type === "beam" ? castTick(event.until) : event.type === "lightning" ? tick : tick + castTick(event.seconds)
    moments.push({ tick: tick + interval, until: end, damage: event.damage, impact: ["形状", ...(event.type === "hazard" && event.particle !== undefined ? ["粒子" as const] : [])] })
  }
  for (const part of parts ?? []) for (const contact of part.contact ?? []) {
    if (contact.ability !== move.id || contact.damage <= 0) continue
    moments.push({ tick: castTick(contact.from ?? 0), until: castTick(contact.to ?? move.length), damage: contact.damage })
  }
  const leave = move.moves.find((value) => "type" in value && isLeave(value))
  return { name: move.name, ref: abilityRef(move), end: castTick(move.length), moments, cues: cuesFor(move.events), sustained: moments.some((moment) => moment.until !== undefined && moment.until > moment.tick), tracking: move.facing === "track" ? castTick(move.track_until ?? move.windup) : undefined, wait, availableAgain: leave && "back" in leave ? castTick(leave.back.at) : undefined }
}

const combine = (name: string, moves: readonly MoveDesign[]) => {
  const grouped = new Map<DesignRule, { words: string; ref?: FindingRef }[]>()
  for (const move of moves) for (const { rule, detail } of timingGaps(move)) {
    const list = grouped.get(rule) ?? []
    list.push({ words: `「${move.name}」${detail}`, ref: move.ref })
    grouped.set(rule, list)
  }
  return [...grouped].map(([rule, details]) => hint(rule, `「${name}」有 ${details.length} 招可以改善${advice[rule].label}：${details.slice(0, 5).map((row) => row.words).join("；")}${details.length > 5 ? "等" : ""}。`, details.slice(0, 5).flatMap((row) => row.ref ? [row.ref] : [])))
}

type Fighter = Pick<Project["entities"][number], "name" | "abilities" | "boss" | "tactics" | "combos" | "shared_abilities" | "hitbox">
type Assets = Pick<Project["workspace"], "assets">

export function creatureMoves(creature: Fighter, assets: Assets): Ability[] {
  return expandedMoves(creature, assets)
}

export function creatureDesignHints(creature: Fighter, moves: readonly Ability[], model: Pick<ModelDesign, "bones" | "follow"> | null = null) {
  const basePause = creature.tactics?.between?.pause ?? 0
  const cooldownScale = Math.min(1, creature.tactics?.enrage?.cooldown ?? 1)
  const pause = castTick(Math.min(basePause, ...(creature.boss?.phases ?? []).flatMap((phase) => phase.between ? [phase.between.pause] : [])) * cooldownScale)
  const layouts = moves.map((move) => {
    const combo = creature.combos?.some((value) => value.steps.includes(move.id))
    const wait = combo ? 0 : moves.length === 1 ? Math.max(pause, castTick((move.on_hurt?.cooldown ?? move.start.cooldown) * cooldownScale)) : pause
    return creatureMove(move, wait, creature.hitbox?.parts)
  })
  return [
    ...combine(creature.name, layouts),
    ...(creature.boss ? moves.filter(move => move.events.some(e => e.type === "block_swap" && !e.restore_on_exit)).map(move => hint("terrain_restore", `「${creature.name}」的「${move.name}」换了世界方块，离场后会一直保留到定时还原。`, [abilityRef(move)])) : []),
    ...(model ? appendageDesignHints(creature.name, model) : []),
  ]
}

export function appendageDesignHints(name: string, model: Pick<ModelDesign, "bones" | "follow">) {
  const gaps = appendageBoneGaps(model)
  const shown = gaps.slice(0, 5)
  return gaps.length ? [hint("appendage_chain", `「${name}」有 ${gaps.length} 串名称明确的附属物少了跟随、挂链或合适的节数：${shown.map((parts) => parts.join(" → ")).join("、")}${gaps.length > 5 ? "等" : ""}。`, shown.flat().map(boneRef))] : []
}

export function castDesignHints(document: AbilityAssetDocument) {
  const charge = document.cast.type === "charge" ? castTick(document.cast.seconds) : 0
  const cues = cuesFor(document.events).map((cue) => ({ ...cue, tick: cue.tick + charge }))
  if (document.sounds?.start) cues.push({ tick: 0, layer: "声音" })
  const moments = document.hits.flatMap((hit, index) =>
    "damage" in hit && (damageAtBase(hit.damage) > 0 || hit.type === "shot" && hit.damage === null || hit.type === "area" && typeof hit.damage !== "number" && hit.damage.per_level > 0)
      ? [{ tick: charge + castTick(hit.at), index, damage: damageAtBase(hit.damage) }]
      : [])
  return combine(document.name, [{
    name: document.name,
    end: charge + timelineTicks(document),
    moments,
    cues,
    sustained: document.cast.type === "channel",
    wait: document.cast.recasts ? 0 : castTick(damageAtBase(document.cast.cooldown)),
  }])
}

export function visualDesignHint(document: ParticleDocument | EffectDocument): DesignHint | null {
  if (document.kind === "particle") {
    if (castTick(document.lifetime) > castTick(SHORT_VISUAL_SECONDS) || document.emissive && document.opacity.end < document.opacity.start) return null
    const missing = [...(!document.emissive ? ["全亮"] : []), ...(document.opacity.end >= document.opacity.start ? ["淡出"] : [])]
    return hint("short_visual", `粒子「${document.name}」只显示 ${document.lifetime} 秒，少了${missing.join("和")}。`)
  }
  if (castTick(document.play.lifetime) > castTick(SHORT_VISUAL_SECONDS)) return null
  const bright = document.play.bright || document.play.blend === "additive"
  const measured = effectMeasure(document)
  const closes = (width: { last: number; most: number }) => width.most > 0 && width.last <= width.most * 0.25
  const fades = measured && (closes(measured.across) || document.play.on_ground && measured.base.under && closes(measured.base.across))
  if (bright && fades) return null
  return hint("short_visual", `效果「${document.name}」只显示 ${document.play.lifetime} 秒，${!bright ? "没有全亮" : ""}${!bright && !fades ? "，且" : ""}${!fades ? "临消失时形状仍然明显" : ""}。`)
}

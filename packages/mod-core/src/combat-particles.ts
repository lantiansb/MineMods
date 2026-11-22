import { fixtureRef } from "./finding-refs"
import { BUILTIN_LABELS, builtinUses } from "./builtin"
import { expandFeedback } from "./hit-feedback"
import { resolveParticle, type ParticleRef, type ParticleAliases } from "./particle-emission"
import { governing, type CreatureTierLevel } from "./creature-tier"
import { bossShowSteps } from "./boss-show"
import { isLeave } from "./arena"
import { appendageDesignHints, castDesignHints, creatureDesignHints, creatureMoves, hint, visualDesignHint } from "./combat-design"
import type { Ability } from "./entity-runtime"
import type { Project } from "./project"
import type { ModuleDocument } from "./workspace"
import type { ModelDesign } from "@minemods/studio-ai/contracts"

type Creature = Pick<Project["entities"][number], "name" | "boss" | "runtime" | "hitbox" | "sounds" | "emitters" | "particles" | "shared_abilities" | "builtin">
type Reference = string | { asset: string } | null | undefined

export function creatureTier(project: Pick<Project, "blueprint" | "workspace">, modelId: string, taskKey?: string | null) {
  const entries = project.blueprint?.state === "confirmed" ? project.blueprint.entries : []
  const task = taskKey ? governing(entries, taskKey) : null
  const entry = task ?? entries.find((value) => value.kind === "entity" && value.tier && (value.asset_id === modelId ||
    project.workspace.assets.some((asset) => asset.id === value.asset_id && asset.document.kind === "entity" && asset.document.model_asset_id === modelId)))
  return entry?.tier?.level ?? entries.flatMap((value) => value.kind === "model" && value.asset_id === modelId ? [governing(entries, value.key)?.tier.level] : []).find(Boolean) ?? "standard"
}

/** The vanilla particles and sounds the generators put in by themselves, by the constant in the generated Java and the name a person knows them by. */
export const BUILTIN_NAMES = {
  SMALL_FLAME: "小火苗", ELECTRIC_SPARK: "电火花", CRIT: "暴击星", CLOUD: "白色云雾", EXPLOSION: "爆炸烟团", EXPLOSION_EMITTER: "大爆炸", FLASH: "一下闪光", SMOKE: "黑烟", BLOCK: "方块碎屑", POOF: "白烟",
  PLAYER_ATTACK_CRIT: "暴击声", ANVIL_LAND: "铁砧落地声", ENDER_DRAGON_FLAP: "末影龙扇翅声", GENERIC_EXPLODE: "爆炸声", BEACON_ACTIVATE: "信标启动声", BEACON_POWER_SELECT: "信标选定声",
  CREEPER_PRIMED: "苦力怕点燃声", ITEM_BREAK: "物品损坏声", WITHER_SPAWN: "凋灵出现声",
} as const

const tally = (refs: readonly Reference[]) => ({
  vanilla: refs.filter((ref) => typeof ref === "string").length,
  own: refs.filter((ref) => ref && typeof ref !== "string").length,
})

function eventParticles(events: readonly { type: string; particle?: ParticleRef }[], aliases?: ParticleAliases) {
  return events.flatMap(event => (event.type === "particle" || event.type === "hazard") && event.particle ? [resolveParticle(event.particle, aliases)] : [])
}

export function combatParticleCounts(creature: Creature, moves: readonly Ability[], workspace?: Project["workspace"]) {
  const countParticles = (refs: readonly (ParticleRef | undefined | null)[], aliases?: ParticleAliases) => tally(refs.map(ref => ref && resolveParticle(ref, aliases)))
  const fromMoves = moves.flatMap(move => {
    const use = creature.shared_abilities?.find(use => use.id === move.id)
    const source = use && workspace?.assets.find(asset => asset.id === use.asset)?.document
    // Count the authored channel once, before the compiler expands its pulses.
    if (source?.kind === "ability") return eventParticles(source.events, { ...source.particles, ...use?.particles })
    const impacts = move.hits.flatMap(hit => hit.type === "projectile" ? [hit.trail?.particle, hit.impact?.particle, ...(hit.impact?.ground ?? []).flatMap(ground => ground.type === "hazard" ? [ground.particle] : [])] : [])
    return [...eventParticles(expandFeedback(move.events, creature.particles), creature.particles), ...move.events.flatMap(e => { const p = e.type === "lightning" ? e.look?.particle : null; return p ? [resolveParticle(typeof p === "object" && "particle" in p ? p.particle : p, creature.particles)] : [] }), ...move.events.flatMap(e => e.type === "debris" && e.dust ? [resolveParticle(e.dust, creature.particles)] : []), ...impacts.map(ref => ref && resolveParticle(ref, creature.particles))]
  })
  const shows = creature.boss ? bossShowSteps(creature.boss) : []
  const finish = creature.boss?.phases.flatMap(phase => phase.finish ?? []) ?? []
  const shown = [...shows.flatMap(({ step }) => step.type === "particle" ? [step.particle] : []),
    ...finish.flatMap(step => step.type === "particle" ? [step.particle] : step.type === "ground" ? step.ground.flatMap(fx => fx.type === "hazard" && fx.particle ? [fx.particle] : []) : [])]
  const moveSounds = moves.flatMap((move) => move.events.flatMap((event) => event.type === "sound" ? [event.sound] : []))
  const otherSounds: Reference[] = [
    ...shows.flatMap(({ step }) => step.type === "sound" ? [step.sound] : []),
    creature.boss?.intro?.sound ?? undefined,
    ...(creature.hitbox?.parts ?? []).map((part) => part.weakpoint_sound),
    creature.sounds?.ambient ?? undefined, creature.sounds?.hurt ?? undefined, creature.sounds?.death ?? undefined, creature.sounds?.step ?? undefined,
  ]
  const particles: string[] = []
  const sounds: string[] = []
  // Each is said by a plain name: the line goes into the mod guide, where a bare constant (CLOUD, ENDER_DRAGON_FLAP) is not a word anyone reads
  // and was replaced there by 「游戏里的某个部分」 (r20). The constant stays in `builtin`, for whoever has to find it in the generated code.
  const builtin: { where: string; kind: "particle" | "sound"; id: string; name: string; replacement?: string; own?: boolean }[] = []
  const selected = builtinUses(creature.builtin)
  const add = (where: string, names: (keyof typeof BUILTIN_NAMES | null)[], seen: string[]) => names.forEach((id) => {
    const kind = seen === particles ? "particle" : "sound"
    const choice = selected.find(u => BUILTIN_LABELS[u.key] === where)
    const ref = kind === "particle" ? choice?.effect ? {asset:choice.effect} : (choice?.particle==="none"?"none":choice?.particle && resolveParticle(choice.particle, creature.particles)) : choice?.sound
    if (ref) {
      builtin.push({where,kind,id:id ?? "fixture_lit",name:id ? BUILTIN_NAMES[id] : "亮灯默认无粒子",replacement:typeof ref === "string" ? ref : ref.asset,own:typeof ref !== "string"})
      return
    }
    if (!id) return
    builtin.push({ where, kind, id, name: BUILTIN_NAMES[id] })
    seen.push(`${where}的${BUILTIN_NAMES[id]}`)
  })
  const scales = (creature.hitbox?.parts ?? []).flatMap((part) => [part.damage_scale ?? 1, ...(creature.boss ? (part.phase_scales ?? []).map((entry) => entry.damage_scale) : [])])
  if (scales.includes(0)) {
    add("免伤部位受击", ["ELECTRIC_SPARK"], particles)
    add("免伤部位受击", ["ANVIL_LAND"], sounds)
  }
  if (scales.some((scale) => scale > 1)) {
    add("弱点部位受击", ["CRIT"], particles)
    if (creature.builtin?.weak_hit?.sound) add("弱点部位受击", ["PLAYER_ATTACK_CRIT"], sounds)
  }
  if (moves.some((move) => move.moves.some((motion) => "type" in motion && isLeave(motion)))) {
    add("离场", ["CLOUD"], particles)
    add("离场", ["ENDER_DRAGON_FLAP"], sounds)
    add("回场", ["EXPLOSION"], particles)
    add("回场", ["GENERIC_EXPLODE"], sounds)
  }
  const arena = creature.boss?.arena
  if (arena?.fixtures.length) {
    if (creature.builtin?.fixture_lit?.particle || creature.builtin?.fixture_lit?.effect) add("物件亮着时", [null], particles)
    const ember = (e: {type:string; do?:string}) => e.type === "fixture" && e.do === "ember"
    if (creature.builtin?.fixture_ember?.particle || creature.builtin?.fixture_ember?.effect || moves.some(m => m.events.some(ember)) || shows.some(s => ember(s.step)) || finish.some(ember) || moves.some(p => p.breaks?.some(b => b.result.fixture?.do === "ember")))
      add("物件处于余烬时", ["SMALL_FLAME"], particles)
    add("点亮场地物件", ["BEACON_ACTIVATE"], sounds)
    if (arena.fog && moves.some((move) => move.events.some((event) => event.type === "fog"))) {
      add("雾中安全区边缘", ["CLOUD"], particles)
      if (arena.fog.lift === "all_lit_once") add("同时清掉全场雾", ["BEACON_POWER_SELECT"], sounds)
    }
  }
  if (creature.boss?.death.explosion) {
    add("死亡爆炸", ["EXPLOSION_EMITTER", "FLASH"], particles)
    add("死亡爆炸", ["GENERIC_EXPLODE"], sounds)
  }
  // The game's own puff where any dead body goes: counted once the table changes it, so a creature that leaves it alone is reported as it always was.
  if (creature.builtin?.death_poof?.particle) add("死后消失时那团白烟", ["POOF"], particles)
  if (creature.runtime?.explosion) {
    add("爆炸引信", ["SMOKE"], particles)
    add("爆炸引信", ["CREEPER_PRIMED"], sounds)
  }
  if (creature.boss?.summon) {
    if (creature.builtin?.summon_success || creature.builtin?.summon_blocked) {
      add("召唤成功", ["WITHER_SPAWN"], sounds)
      add("召唤被挡", ["ITEM_BREAK"], sounds)
    } else add("召唤", ["ITEM_BREAK", "WITHER_SPAWN"], sounds)
  }
  if (moves.some((move) => move.events.some((event) => event.type === "debris" && !event.dust))) add("掀碎块", ["BLOCK"], particles)
  if (moves.some((move) => move.events.some((event) => event.type === "terrain_rise" && event.shatter))) add("升起地形碎裂", ["BLOCK"], particles)
  return { moves: tally(fromMoves), shows: countParticles(shown, creature.particles), emitters: countParticles((creature.emitters ?? []).map(e => e.particle), creature.particles), moveSounds: tally(moveSounds), otherSounds: tally(otherSounds), particles, sounds, builtin }
}

export function particleReport(creature: Creature, moves: readonly Ability[], tier: CreatureTierLevel, workspace?: Project["workspace"]) {
  const count = combatParticleCounts(creature, moves, workspace)
  const authored = count.moves.own + count.moves.vanilla + count.shows.own + count.shows.vanilla + count.emitters.own + count.emitters.vanilla
  if (!moves.length && !authored && !count.builtin.length) return null
  const warnings = moves.flatMap(move => [...move.hits.flatMap(h => (h.type === "area" || h.type === "projectile") && h.warn ? [h.warn] : []), ...move.events.flatMap(e => e.type === "lightning" && e.warn ? [e.warn] : [])])
  const dustWarnings = warnings.filter(w => w.paint !== "mesh" && !("effect" in w && w.effect)).length
  // The rings round a whole-arena hit's safe places are a warning of their own: painted as the hit's own warning is, so as dust unless that one is a mesh (an effect laid for the hit does not cover them).
  const dustSafe = moves.flatMap(move => move.hits.filter(h => h.type === "area" && h.shape.type === "arena" && h.safe && h.warn && h.warn.paint !== "mesh")).length
  const warningLine = [dustWarnings ? `预警 ${dustWarnings} 处用 Studio 自带的原版彩尘画法。${tier === "boss" || tier === "epic" ? "要铺工程自己的效果可填 warn.effect，也可选 warn.paint 为 mesh。" : ""}` : "", dustSafe ? `全场招的安全区边线 ${dustSafe} 处用原版彩尘画；把那一招的 warn.paint 写成 mesh，边线就跟着换。` : ""].join("")
  // r29: a warning the game paints with its own coloured dust is a vanilla particle the moves use, one per warning (the game spawned 430 DustParticle in one 横风), so it is counted with them.
  const painted = dustWarnings + dustSafe
  const vanillaMoves = count.moves.vanilla + painted
  const changed = count.builtin.filter(b => b.replacement && b.replacement!=="none")
  const off=count.builtin.filter(b=>b.replacement==="none").length
  const line = `「${creature.name}」的粒子使用处数：招式原版 ${vanillaMoves}${painted ? `（其中预警的原版彩尘 ${painted} 处）` : ""}、自制 ${count.moves.own}；演出原版 ${count.shows.vanilla}、自制 ${count.shows.own}${count.emitters.own || count.emitters.vanilla ? `；常驻发射原版 ${count.emitters.vanilla}、自制 ${count.emitters.own}` : ""}。声音使用处数：招式原版 ${count.moveSounds.vanilla}、自制 ${count.moveSounds.own}；演出、受击等原版 ${count.otherSounds.vanilla}、自制 ${count.otherSounds.own}。生成器随能力加入的原版粒子 ${count.particles.length} 处${count.particles.length ? `（${count.particles.join("、")}）` : ""}、声音 ${count.sounds.length} 处${count.sounds.length ? `（${count.sounds.join("、")}）` : ""}。${changed.length ? `生成器自带 ${count.builtin.length} 处，其中 ${changed.filter(b => b.own).length} 处换成了工程资产，${changed.filter(b => !b.own).length} 处换了原版素材。` : ""}${off?`关闭了 ${off} 处自带表现。`:""}${warningLine}`
  const majority = (tier === "boss" || tier === "epic") && vanillaMoves > count.moves.own
  const flame = count.builtin.some(use => use.id === "SMALL_FLAME" && !use.replacement)
  const refs = flame ? (creature.boss?.arena?.fixtures ?? []).map(f => fixtureRef(f.id)) : []
  return { line, warning: majority ? hint("particle_mix", `${line}这一档的招式里原版粒子占多数。`, refs) : (dustWarnings || flame) && (tier === "boss" || tier === "epic") ? hint("particle_mix", line + (flame ? "余烬的小火苗可在物件的余烬表现里更换或关闭。" : ""), refs) : null }
}

export function assetDesignNotes(project: Project, document: ModuleDocument, model: Pick<ModelDesign, "bones" | "follow"> | null = null, taskKey?: string | null) {
  if (document.kind === "entity") {
    const moves = creatureMoves(document, project.workspace)
    const counted = particleReport(document, moves, creatureTier(project, document.model_asset_id, taskKey), project.workspace)
    return { hints: [...creatureDesignHints(document, moves, model), ...(counted?.warning ? [counted.warning] : [])], facts: counted && !counted.warning ? [counted.line] : [] }
  }
  if (document.kind === "ability") {
    const refs = eventParticles(document.events, document.particles)
    const count = tally(refs)
    return { hints: castDesignHints(document), facts: refs.length ? [`技能「${document.name}」的粒子使用处数：原版 ${count.vanilla}、自制 ${count.own}。`] : [] }
  }
  if (document.kind === "model") return { hints: appendageDesignHints(document.name, document), facts: [] }
  if (document.kind === "particle" || document.kind === "effect") {
    const issue = visualDesignHint(document)
    return { hints: issue ? [issue] : [], facts: [] }
  }
  return { hints: [], facts: [] }
}

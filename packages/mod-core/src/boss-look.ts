import { abilityRef, assetRef, boneRef, comboRef, partRef, phaseRef, uniqueFindingRefs, stanceRef } from "./finding-refs"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { MotionClip } from "@minemods/studio-ai/model-motion"
import { TICKS } from "./ability-words"
import { SHAKE_LIMITS, bossPhaseIds } from "./boss-words"
import { abilityShakes, bossLookPlan, comboShakes, shakeCap, shakeCurve, shakesOf, type BossLookPlan, type GlowTexture } from "./boss-look-words"
import { bonePlace, type Place } from "./creature-abilities"
import { hitBone, type Ability, type Boss, type Combo, type Hitbox, BossPhaseModel, Stances } from "./entity-runtime"

/**
 * Boss 能力 8 and 10 against the model a boss plays on: where each part it drops comes off and where it sits on the model as built (what the generated Java places the
 * part from), and what is wrong with its shakes and its phases' model changes (`bossLookIssues`): a bone the model lacks, a part that is dropped and still needed, a
 * glow with no picture, shakes stacked past the cap. Each finding says what to do, in the person's words.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))

export type BossLookIssue = {
  refs?: import("@minemods/studio-ai/acceptance").FindingRef[]
  rule: "boss_look_bone" | "boss_look_dropped" | "boss_look_redundant" | "boss_look_glow" | "boss_look_texture" | "boss_shake_cap"
  stops: boolean
  text: string
  fix: string
  detail: string
}

/**
 * Where each dropped part is: `from`, where it comes off (below the middle of the bone's own cubes, at the height of its bottom, in the creature's own terms and blocks: an ability's as its motion holds it at the
 * drop's moment, a phase's as its change's motion holds it at its start, as built when it has none); `rest`, where that same place is on the model as built (the part is drawn as
 * built, moved so that this place is where it came off). By bone index of the plan. Null for a bone the model lacks.
 */
export function bossDropPlaces(plan: BossLookPlan, boss: Pick<Boss, "phases">, abilities: readonly Pick<Ability, "clip">[], design: Pick<ModelDesign, "bones" | "animations">) {
  const clip = (name: string | null | undefined) => (name ? ((design.animations.find((motion) => motion.name === name) as MotionClip | undefined) ?? null) : null)
  // The part's own place is its bottom (the lowest cube of it and of what hangs from it, as built), straight below the middle of its own cubes: what lands on the ground when it falls.
  const at = (bone: string, motion: MotionClip | null, time: number) => {
    const from = bonePlace(design, bone, motion, motion ? Math.min(time, motion.length) : 0)
    const rest = bonePlace(design, bone, null, 0)
    const cubes = design.bones.filter((value) => subtree(design, bone).has(value.name)).flatMap((value) => value.cubes)
    if (!from || !rest || !cubes.length) return from && rest ? { from, rest } : null
    const below = rest.up - Math.min(...cubes.map((cube) => cube.origin[1]!)) / 16
    return { from: { ...from, up: from.up - below }, rest: { ...rest, up: rest.up - below } }
  }
  return {
    phases: plan.phaseDrops.map((drops, phase) => drops.map((drop) => at(drop.name, clip(boss.phases[phase]?.clip), 0))),
    abilities: plan.abilityDrops.map((drop) => at(drop.drop.bone, clip(abilities[drop.ability]?.clip), drop.drop.at)),
  }
}
export type DropPlace = { from: Place; rest: Place } | null

/** A bone and every bone that hangs from it, by name. */
function subtree(design: Pick<ModelDesign, "bones">, name: string) {
  const found = new Set([name])
  let grew = true
  while (grew) {
    grew = false
    for (const bone of design.bones) if (bone.parent && found.has(bone.parent) && !found.has(bone.name)) {
      found.add(bone.name)
      grew = true
    }
  }
  return found
}

/** Whether the model has glowing parts of its own: a feature painted to glow. */
export const modelGlows = (design: Pick<ModelDesign, "bones">) => design.bones.some((bone) => bone.cubes.some((cube) => (cube.features ?? []).some((feature) => feature.glow)))

type Creature = {
  name: string
  behavior: string
  abilities?: readonly Ability[] | null
  combos?: readonly Combo[] | null
  boss?: Boss | null
  stances?: Stances | undefined
  hitbox?: Pick<Hitbox, "parts"> | null
  runtime?: { texture_asset_id?: string | null } | null
}

/**
 * What is wrong with a boss's model changes and its shakes, measured against its model (`design`; null: not known, so only what needs no model is said).
 * `texture`: a texture asset of the project by id, with its size (null: none such), for a glow or a phase's texture that names one.
 */
export function bossLookIssues(creature: Creature, design: Pick<ModelDesign, "bones" | "animations" | "texture_size"> | null, texture: (id: string) => { width: number; height: number } | null = () => null): BossLookIssue[] {
  const found: BossLookIssue[] = []
  const abilities = creature.behavior === "hostile" ? (creature.abilities ?? []) : []
  const combos = abilities.length ? (creature.combos ?? []) : []
  // Shakes stacked past the cap the runtime holds them to: one ability's, or one combo's on its own clock.
  const cap = shakeCap(shakesOf(abilities))
  const stacked = [...abilities.map((ability) => ({ name: `招式「${ability.name}」`, ref: abilityRef(ability), shakes: abilityShakes(ability) })), ...combos.map((combo) => ({ name: `连招「${combo.name}」`, ref: comboRef(combo), shakes: comboShakes(combo, abilities) }))]
  for (const { name, ref, shakes } of stacked) {
    const curve = shakeCurve(shakes, cap)
    if (!curve?.over.length) continue
    found.push({
      rule: "boss_shake_cap",
      refs: [ref],
      stops: false,
      text: `「${creature.name}」的${name}里几次晃屏叠在一起，第 ${num(curve.peak.tick / TICKS)} 秒最强加起来是 ${num(curve.peak.sum)}，超过了上限 ${cap}：超出的那一截不起作用（游戏里最多晃到 ${cap}），${num(curve.over.length / TICKS)} 秒里都顶在上限上。`,
      fix: cap < SHAKE_LIMITS.cap ? `把几次晃屏的 strength 调小、错开时间，或者想要更猛的晃屏就让其中一次的 strength 超过 ${SHAKE_LIMITS.legacyCap}（或写上 roll / fov / falloff / frequency 中的一样），这个模组就换成上限 ${SHAKE_LIMITS.cap} 的晃屏。` : "把几次晃屏的 strength 调小，或者把时间错开（前一次停下来以后再晃下一次）。",
      detail: `${name}: peak ${num(curve.peak.sum)} at tick ${curve.peak.tick}; cap ${cap}; ${curve.over.length} ticks over`,
    })
  }
  const hostile = creature.behavior === "hostile"
  const boss = hostile ? creature.boss : null
  const stances = hostile ? creature.stances : undefined
  if (!boss && !stances) return found
  const phases = boss?.phases ?? []
  const plan = bossLookPlan({ phases }, boss ? abilities : [], stances)
  if (!plan) return found
  const looks: { model?: BossPhaseModel | undefined; ref: ReturnType<typeof phaseRef>; label: string; phase: number }[] = [
    ...phases.map((row, i) => ({ model: row.model, ref: phaseRef(i + 1), label: `第 ${i + 1} 个阶段`, phase: i })),
    ...(stances?.list ?? []).map(row => ({ model: row.model, ref: stanceRef(row), label: `「${row.name}」姿态`, phase: -1 })),
  ]
  // Every bone a phase or an ability names, against the model.
  if (design) {
    const names = new Set(design.bones.map((bone) => bone.name))
    const have = design.bones.map((bone) => bone.name).slice(0, 24).join("、")
    const named = [
      ...looks.flatMap(({ model, ref, label }) => [
        ...(model?.hide ?? []).map(bone => ({ bone, ref, where: `${label}的 hide` })),
        ...(model?.show ?? []).map(bone => ({ bone, ref, where: `${label}的 show` })),
        ...(model?.drop ?? []).map(drop => ({ bone: drop.bone, ref, where: `${label}的 drop` })),
      ]),
      ...plan.abilityDrops.map((drop) => ({ bone: drop.drop.bone, ref: abilityRef(abilities[drop.ability]!), where: `招式「${abilities[drop.ability]!.name}」的掉落（events 第 ${drop.event + 1} 个）` })),
    ]
    for (const { bone, ref, where } of named)
      if (!names.has(bone))
        found.push({ rule: "boss_look_bone", refs: [ref, boneRef(bone)], stops: true, text: `「${creature.name}」${where}写的骨骼「${bone}」，模型里没有。`, fix: `模型里的骨骼有：${have}。改成其中一个，或者先让模型有这根骨骼。`, detail: `${where}: bone ${bone}; model has: ${[...names].join(", ")}` })
  }
  // A glow needs its picture: the model's own glowing parts (painted on its own texture), or a texture asset the size of the model's texture.
  looks.forEach(({ model, ref, label }) => {
    const glow = model?.glow
    if (!glow) return
    const where = `${label}的发光（glow）`
    if (glow.texture === "emissive") {
      if (creature.runtime?.texture_asset_id)
        found.push({ rule: "boss_look_glow", refs: [ref, ...(creature.runtime?.texture_asset_id ? [assetRef(creature.runtime.texture_asset_id)] : [])], stops: true, text: `「${creature.name}」${where}用的是模型自己发光的部分，可是它穿的是单独画的贴图：单独的贴图没有发光的部分。`, fix: "改用一张发光贴图（texture 写 {\"asset\": 贴图资产的 id}），或者让它穿回模型自己的贴图。", detail: `${where}: emissive with texture_asset_id` })
      else if (design && !modelGlows(design))
        found.push({ rule: "boss_look_glow", refs: [ref, ...(creature.runtime?.texture_asset_id ? [assetRef(creature.runtime.texture_asset_id)] : [])], stops: true, text: `「${creature.name}」${where}用的是模型自己发光的部分，可是模型里没有画成发光的地方，什么也亮不起来。`, fix: "在模型里把要亮的眼睛、纹路画成发光（feature 的 glow 写 true），或者改用一张发光贴图（texture 写 {\"asset\": 贴图资产的 id}）。", detail: `${where}: emissive, the model has no glowing feature` })
      return
    }
    const picture = texture(glow.texture.asset)
    if (!picture) found.push({ rule: "boss_look_glow", refs: [ref, assetRef(glow.texture.asset)], stops: true, text: `「${creature.name}」${where}用的发光贴图找不到了（或者那不是一张贴图）。`, fix: "换成这个工程里的一张贴图资产，或者改用模型自己发光的部分（texture 写 \"emissive\"）。", detail: `${where}: asset ${glow.texture.asset} not a texture of the project` })
    else if (design && (picture.width !== design.texture_size || picture.height !== design.texture_size))
      found.push({ rule: "boss_look_glow", refs: [ref, assetRef(glow.texture.asset)], stops: true, text: `「${creature.name}」${where}用的发光贴图是 ${picture.width}×${picture.height}，模型的贴图是 ${design.texture_size}×${design.texture_size}：两张对不齐，发光会亮在错的地方。`, fix: `照着模型的贴图画一张 ${design.texture_size}×${design.texture_size} 的发光贴图（要亮的地方画上亮色，其余涂黑）。`, detail: `${where}: ${picture.width}x${picture.height} against ${design.texture_size}` })
  })
  // A texture a phase puts on: a texture asset of the project, the size of the model's texture (the model's UVs and its glow mask are laid out on that one).
  looks.forEach(({ model, ref, label, phase: index }) => {
    const worn = model?.texture
    const where = `${label}换的贴图（texture）`
    if (worn && worn !== "model") {
      const picture = texture(worn.asset)
      if (!picture) found.push({ rule: "boss_look_texture", refs: [ref, assetRef(worn.asset)], stops: true, text: `「${creature.name}」${where}找不到了（或者那不是一张贴图）。`, fix: "换成这个工程里的一张贴图资产，或者写 \"model\" 换回模型自己的贴图。", detail: `${where}: asset ${worn.asset} not a texture of the project` })
      else if (design && (picture.width !== design.texture_size || picture.height !== design.texture_size))
        found.push({ rule: "boss_look_texture", refs: [ref, assetRef(worn.asset)], stops: true, text: `「${creature.name}」${where}是 ${picture.width}×${picture.height}，模型的贴图是 ${design.texture_size}×${design.texture_size}：两张对不齐，换上以后花纹会贴错地方。`, fix: `照着模型的贴图改画一张 ${design.texture_size}×${design.texture_size} 的贴图（位置一一对齐，只改颜色和花纹）。`, detail: `${where}: ${picture.width}x${picture.height} against ${design.texture_size}` })
    }
    if (worn && index >= 0 && plan.texture[index] === plan.texture[index + 1])
      found.push({ rule: "boss_look_redundant", refs: [ref, ...(worn === "model" ? [] : [assetRef(worn.asset)])], stops: false, text: `「${creature.name}」${where}和上一阶段穿的是同一张，什么也没换。`, fix: "不用写这一项；想换就写另一张贴图资产，想换回去写 \"model\"。", detail: `phase ${index + 1}: texture ${worn === "model" ? "model" : worn.asset}, already worn` })
  })
  if (!boss) return found
  // Show and hide that change nothing: the bone is already as the phase says.
  boss.phases.forEach((phase, index) => {
    const before = plan.hidden[index]!
    for (const bone of phase.model?.show ?? []) if (!(before & (1 << plan.bones.indexOf(bone))) && index > 0)
      found.push({ rule: "boss_look_redundant", refs: [phaseRef(index + 1), boneRef(bone)], stops: false, text: `「${creature.name}」第 ${index + 1} 个阶段 show 了「${bone}」，可是它在上一阶段本来就看得见。`, fix: "不用写这一项；想让它在这之前藏着，就在更早的阶段 hide 它，或者去掉更早阶段对它的 show。", detail: `phase ${index + 1}: show ${bone}, already shown` })
    for (const bone of phase.model?.hide ?? []) if (before & (1 << plan.bones.indexOf(bone)))
      found.push({ rule: "boss_look_redundant", refs: [phaseRef(index + 1), boneRef(bone)], stops: false, text: `「${creature.name}」第 ${index + 1} 个阶段 hide 了「${bone}」，可是它在上一阶段已经藏着了。`, fix: "不用写这一项。", detail: `phase ${index + 1}: hide ${bone}, already hidden` })
  })
  // A part that is dropped and still needed afterwards: an ability that counts a hit from it, draws its trail on it or drops it again, a later phase that shows it, a box that follows it.
  if (design) {
    const ids = [...abilities, ...combos].map((choice) => choice.id)
    const stages = bossPhaseIds(boss.phases, ids)
    const firstStage = (id: string) => stages.findIndex((stage) => stage.includes(id))
    const uses = (ability: Ability, gone: Set<string>) => [
      ...ability.hits.flatMap((hit, index) => ((bone) => (bone && gone.has(bone) ? [`第 ${index + 1} 次出手从「${bone}」算`] : []))(hitBone(hit))),
      ...ability.events.flatMap((event, index) => (event.type === "trail" && gone.has(event.bone) ? [`拖尾（events 第 ${index + 1} 个）跟着「${event.bone}」`] : [])),
    ]
    const drops = [
      ...boss.phases.flatMap((phase, index) => (phase.model?.drop ?? []).map((drop) => ({ bone: drop.bone, stage: index + 1, by: null as number | null, where: `第 ${index + 1} 个阶段一开始` }))),
      ...plan.abilityDrops.map((drop) => ({ bone: drop.drop.bone, stage: Math.max(0, firstStage(abilities[drop.ability]!.id)), by: drop.ability, where: `招式「${abilities[drop.ability]!.name}」` })),
    ]
    for (const drop of drops) {
      if (!design.bones.some((bone) => bone.name === drop.bone)) continue
      const gone = subtree(design, drop.bone)
      const later = abilities.filter((ability, index) => index === drop.by || stages.slice(drop.stage).some((stage) => stage.includes(ability.id)))
      const needs = [
        ...later.flatMap((ability) => uses(ability, gone).map((use) => ({ text: `招式「${ability.name}」${use}`, ref: abilityRef(ability) }))),
        ...boss.phases.slice(drop.stage).flatMap((phase, index) => (phase.model?.show ?? []).filter((bone) => gone.has(bone)).map((bone) => ({
          text: `第 ${drop.stage + index + 1} 个阶段 show「${bone}」（掉了就不会再显出来）`, ref: phaseRef(drop.stage + index + 1),
        }))),
        ...(creature.hitbox?.parts ?? []).filter((part) => part.bone && gone.has(part.bone)).map((part) => ({
          text: `碰撞箱部位「${part.name}」跟着「${part.bone}」`, ref: partRef(part.name),
        })),
      ]
      if (needs.length)
        found.push({
          rule: "boss_look_dropped",
          refs: uniqueFindingRefs([drop.by === null ? phaseRef(drop.stage) : abilityRef(abilities[drop.by]!), ...[...gone].map(boneRef), ...needs.map((need) => need.ref)]),
          stops: false,
          text: `「${creature.name}」${drop.where}把「${drop.bone}」掉了下来${gone.size > 1 ? `（连同挂在它下面的${[...gone].filter((bone) => bone !== drop.bone).map((bone) => `「${bone}」`).join("")}）` : ""}，可是之后还要用它：${needs.map((need) => need.text).join("；")}。游戏里那时候它已经不在身上了。`,
          fix: "让这些招式从别的部件出手、给别的部件画拖尾，或者把掉落挪到最后一个用到它的阶段之后；后面的阶段不要再 show 掉了的部件。",
          detail: `drop ${drop.bone} at stage ${drop.stage}${drop.by === null ? "" : ` by ability ${drop.by}`}; needed: ${needs.map((need) => need.text).join(" | ")}`,
        })
    }
  }
  return found
}

/** The pictures a boss's glows use, each once, the model's own first: what the build writes beside the model's texture (`bossGlowFile`) and what the renderer draws. */
export const bossGlowSlots = (plan: BossLookPlan | null): GlowTexture[] => plan?.slots ?? []

/** Where a glow picture of a creature is in the mod's resources (`assets/<mod>/` aside): the model's own glow mask, or the asset's picture written beside its texture. */
export const bossGlowFile = (creature: string, slot: GlowTexture, index: number) => (slot === "emissive" ? `textures/entity/${creature}_glowmask.png` : `textures/entity/${creature}_glow_${index}.png`)

/** Where a texture a boss's phases put on is in the mod's resources (`assets/<mod>/` aside): beside the model's own, by its place in `plan.textures` from 1 (`texture[stage]`). */
export const bossTextureFile = (creature: string, index: number) => `textures/entity/${creature}_phase_${index}.png`

import { assetRef, boneRef, clipRef, phaseRef } from "./finding-refs"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { MotionClip } from "@minemods/studio-ai/model-motion"
import { motionName } from "@minemods/studio-ai/making"
import { TICKS } from "./ability-words"
import { bonePlace, type Place } from "./creature-abilities"
import { bonesBelow } from "./boss-bones"
import { bossLookPlan, stageHidden } from "./boss-look-words"
import { modelGlows } from "./boss-look"
import { BOSS_SHOW_FEATURES, BOSS_SHOW_LIMITS, bossShowEnd, bossShowPlan, bossShowSteps, type BossShowName, type BossShowStep } from "./boss-show"
import type { Boss } from "./entity-runtime"

/**
 * Boss 能力 15 against the model a boss plays on and the project it is in: where each part its shows drop comes off (what the generated Java places the part
 * from), and what a reviewer is told (`bossShowIssues`): a step later than its show's seconds, a motion or a bone the model lacks, a glow with no picture, a
 * structure too large, a bone a phase shows that the wake-up hid for good, an asset that is not there. Each finding says what to do, in the person's words.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))

export type BossShowIssue = {
  refs?: import("@minemods/studio-ai/acceptance").FindingRef[]
  rule: "boss_finish_warning" | "boss_show_length" | "boss_show_clip" | "boss_show_bone" | "boss_show_glow" | "boss_show_structure" | "boss_show_overlap" | "boss_show_asset"
  stops: boolean
  text: string
  fix: string
  detail: string
}

type Showing = Pick<Boss, "intro" | "death" | "phases">
const showName = (show: BossShowName) => (show === "intro" ? "登场" : "死亡")

/**
 * The motion a show plays at `seconds` into it, and how far into that motion: its last clip step by then, else the wake-up's own `intro.clip` (from its start) or
 * the model's death motion. Null when nothing plays (the model as built).
 */
export function bossShowMotion(boss: Showing, show: BossShowName, seconds: number) {
  const steps = (show === "intro" ? boss.intro?.steps : boss.death.steps) ?? []
  const clip = steps.filter((step): step is Extract<BossShowStep, { type: "clip" }> => step.type === "clip" && step.at <= seconds + 1e-9).sort((a, b) => a.at - b.at).at(-1)
  if (clip) return { clip: clip.clip, time: seconds - clip.at }
  const own = show === "intro" ? (boss.intro?.clip ?? null) : "death"
  return own ? { clip: own, time: seconds } : null
}

/**
 * Where each part a show drops comes off and where that place is on the model as built (as item 10's drops: below the middle of its own cubes, at the height of its
 * bottom), in the creature's own terms and blocks, posed by the motion the show plays at the drop's moment. By the drop steps of each show in order; null for a bone
 * the model lacks.
 */
export function bossShowDropPlaces(boss: Showing, design: Pick<ModelDesign, "bones" | "animations">) {
  const motion = (name: string) => (design.animations.find((value) => value.name === name) as MotionClip | undefined) ?? null
  const at = (bone: string, show: BossShowName, seconds: number): { from: Place; rest: Place } | null => {
    const playing = bossShowMotion(boss, show, seconds)
    const clip = playing ? motion(playing.clip) : null
    const from = bonePlace(design, bone, clip, clip ? Math.min(playing!.time, clip.length) : 0)
    const rest = bonePlace(design, bone, null, 0)
    if (!from || !rest) return null
    const cubes = design.bones.filter((value) => bonesBelow(design, [bone]).has(value.name)).flatMap((value) => value.cubes)
    if (!cubes.length) return { from, rest }
    const below = rest.up - Math.min(...cubes.map((cube) => cube.origin[1]!)) / 16
    return { from: { ...from, up: from.up - below }, rest: { ...rest, up: rest.up - below } }
  }
  const of = (show: BossShowName) => ((show === "intro" ? boss.intro?.steps : boss.death.steps) ?? []).flatMap((step) => (step.type === "drop" ? [at(step.bone, show, step.at)] : []))
  return { intro: of("intro"), death: of("death") }
}

/** How many blocks a place step sets down at most, and how far from the boss the furthest of them is (blocks). */
export function structureSize(step: Extract<BossShowStep, { type: "place_structure" }>) {
  const from = Math.hypot(step.forward, step.left)
  if ("feature" in step.structure) {
    const feature = BOSS_SHOW_FEATURES[step.structure.feature]
    return { blocks: feature.blocks * step.structure.count, reach: from + step.structure.spread + feature.reach }
  }
  return { blocks: step.structure.blocks.length, reach: Math.max(...step.structure.blocks.map((block) => from + Math.hypot(block.forward, block.left))) }
}

type Creature = {
  name: string
  behavior: string
  boss?: Boss | null
  abilities?: readonly { events: readonly { type: string; bone?: string }[] }[] | null
  runtime?: { texture_asset_id?: string | null } | null
}
/** What a project has, for the assets a show names: null when there is no such asset of that kind (or it is not known here). */
export type ShowLookups = { effect?: (id: string) => boolean; particle?: (id: string) => boolean; sound?: (id: string) => boolean; texture?: (id: string) => { width: number; height: number } | null }

/**
 * What a reviewer is told of a boss's shows, measured against its model (`design`; null: not known, so only what needs none is said) and its project (`lookups`).
 * A finding that `stops` is one the build refuses.
 */
export function bossShowIssues(creature: Creature, design: Pick<ModelDesign, "bones" | "animations" | "texture_size"> | null, lookups: ShowLookups = {}): BossShowIssue[] {
  const boss = creature.behavior === "hostile" ? creature.boss : null
  const plan = boss ? bossShowPlan(boss) : null
  if (!boss || !plan) return []
  const found: BossShowIssue[] = []
  boss.phases.forEach((phase, index) => {
    if (!phase.sound && !phase.clip && phase.finish?.some(event => event.type === "ground" && event.ground.some(fx => "damage" in fx && fx.damage > 0)))
      found.push({ rule: "boss_finish_warning", refs: [phaseRef(index + 1)], stops: false, text: `第 ${index + 1} 次转换结束会造成地面伤害，转换期间没有提示音或动作。`, fix: "给这一阶段加提示声音 sound 或转换动作 clip，让玩家提前避开。", detail: `boss.phases[${index}].finish` })
  })
  // A step later than its show's seconds: the show runs to it (`bossPlan`), and a wake-up's motion or a death's is then shorter than the show.
  for (const show of ["intro", "death"] as const) {
    const steps = (show === "intro" ? boss.intro?.steps : boss.death.steps) ?? []
    const seconds = show === "intro" ? (boss.intro?.seconds ?? 0) : boss.death.seconds
    const end = bossShowEnd(steps) / TICKS
    if (end > seconds + 1e-9)
      found.push({
        rule: "boss_show_length",
        stops: false,
        text: `「${creature.name}」的${showName(show)}演出写的是 ${num(seconds)} 秒，可是最后一步在第 ${num(end)} 秒：游戏里${showName(show)}会拉长到 ${num(end)} 秒${show === "intro" ? "（这段时间里它都不动、打不死）" : "（它多躺这么久才消失）"}。`,
        fix: `把 ${show}.seconds 改成 ${num(end)}，或者把晚了的步骤提前。`,
        detail: `${show}.seconds ${seconds}; last step at ${end}`,
      })
  }
  const entries = bossShowSteps(boss)
  if (design) {
    const clips = new Set(design.animations.map((clip) => clip.name))
    const names = new Set(design.bones.map((bone) => bone.name))
    const have = design.bones.map((bone) => bone.name).slice(0, 24).join("、")
    for (const { show, step, index } of entries) {
      const where = `${showName(show)}演出第 ${index + 1} 步（第 ${num(step.at)} 秒）`
      if (step.type === "clip" && !clips.has(step.clip))
        found.push({ rule: "boss_show_clip", refs: [clipRef(step.clip)], stops: true, text: `「${creature.name}」${where}要播「${motionName(step.clip)}」，可是它的模型里没有这个动作。`, fix: `给模型加上名叫 ${step.clip} 的动作，或者把 clip 改成模型里有的动作：${[...clips].join("、")}。`, detail: `${show}.steps[${index}]: clip ${step.clip}; model has: ${[...clips].join(", ")}` })
      const bones = step.type === "glow" ? [...(step.show ?? []), ...(step.hide ?? [])] : step.type === "drop" || step.type==="particle" && step.bone ? [step.bone!] : []
      for (const bone of bones)
        if (!names.has(bone)) found.push({ rule: "boss_show_bone", refs: [boneRef(bone)], stops: true, text: `「${creature.name}」${where}写的骨骼「${bone}」，模型里没有。`, fix: `模型里的骨骼有：${have}。改成其中一个，或者先让模型有这根骨骼。`, detail: `${show}.steps[${index}]: bone ${bone}` })
    }
  }
  // A glow needs its picture, as a phase's does.
  for (const { show, step, index } of entries) {
    if (step.type !== "glow" || !step.glow) continue
    const where = `${showName(show)}演出第 ${index + 1} 步的发光`
    if (step.glow.texture === "emissive") {
      if (creature.runtime?.texture_asset_id)
        found.push({ rule: "boss_show_glow", stops: true, text: `「${creature.name}」${where}用的是模型自己发光的部分，可是它穿的是单独画的贴图：单独的贴图没有发光的部分。`, fix: "改用一张发光贴图（texture 写 {\"asset\": 贴图资产的 id}），或者让它穿回模型自己的贴图。", detail: `${show}.steps[${index}]: emissive with texture_asset_id` })
      else if (design && !modelGlows(design))
        found.push({ rule: "boss_show_glow", stops: true, text: `「${creature.name}」${where}用的是模型自己发光的部分，可是模型里没有画成发光的地方，什么也亮不起来。`, fix: "在模型里把要亮的眼睛、纹路画成发光（feature 的 glow 写 true），或者改用一张发光贴图。", detail: `${show}.steps[${index}]: emissive, the model has no glowing feature` })
      continue
    }
    if (!lookups.texture) continue
    const picture = lookups.texture(step.glow.texture.asset)
    if (!picture) found.push({ rule: "boss_show_glow", refs: [assetRef(step.glow.texture.asset)], stops: true, text: `「${creature.name}」${where}用的发光贴图找不到了（或者那不是一张贴图）。`, fix: "换成这个工程里的一张贴图资产，或者改用模型自己发光的部分（texture 写 \"emissive\"）。", detail: `${show}.steps[${index}]: asset ${step.glow.texture.asset}` })
    else if (design && (picture.width !== design.texture_size || picture.height !== design.texture_size))
      found.push({ rule: "boss_show_glow", refs: [assetRef(step.glow.texture.asset)], stops: true, text: `「${creature.name}」${where}用的发光贴图是 ${picture.width}×${picture.height}，模型的贴图是 ${design.texture_size}×${design.texture_size}：两张对不齐。`, fix: `照着模型的贴图画一张 ${design.texture_size}×${design.texture_size} 的发光贴图。`, detail: `${show}.steps[${index}]: ${picture.width}x${picture.height} against ${design.texture_size}` })
  }
  // A structure too large: past the most the build sets down it is refused; spread further than a fight's ground it is said.
  for (const { show, step, index } of entries) {
    if (step.type !== "place_structure") continue
    const size = structureSize(step)
    const where = `${showName(show)}演出第 ${index + 1} 步（第 ${num(step.at)} 秒）放的东西`
    const lair = boss.lair?.radius ?? null
    if (size.blocks > BOSS_SHOW_LIMITS.structure.most)
      found.push({ rule: "boss_show_structure", stops: true, text: `「${creature.name}」${where}太大了：大约 ${size.blocks} 个方块，一次最多放 ${BOSS_SHOW_LIMITS.structure.most} 个。`, fix: "少长几棵（count 改小），或者换一种小一点的树，或者少摆几个方块。", detail: `${show}.steps[${index}]: about ${size.blocks} blocks` })
    else if (size.reach > BOSS_SHOW_LIMITS.structure.wide || (lair !== null && size.reach > lair))
      found.push({
        rule: "boss_show_structure",
        stops: false,
        text: `「${creature.name}」${where}铺得很开：最远离它 ${num(size.reach, 1)} 格${lair !== null && size.reach > lair ? `，超出了它的巢（半径 ${lair} 格）` : ""}，会长到旁边玩家的地方去。`,
        fix: "把 spread 或方块的位置收小一点，让它落在战斗的地方。",
        detail: `${show}.steps[${index}]: reach ${num(size.reach, 1)}; lair ${lair ?? "none"}`,
      })
  }
  // A bone the wake-up hid for good (or dropped) that a phase shows again: the wake-up's look wins, so the phase cannot show it.
  const look = bossLookPlan(boss, (creature.abilities ?? []) as never)
  if (look) {
    const awake = plan.bones.filter((_, index) => (plan.awake & (1 << index)) !== 0)
    boss.phases.forEach((phase, index) => {
      for (const bone of phase.model?.show ?? [])
        if (awake.includes(bone) && !stageHidden(look, index + 1).includes(bone))
          found.push({ rule: "boss_show_overlap", refs: [phaseRef(index + 1), boneRef(bone)], stops: false, text: `「${creature.name}」第 ${index + 1} 个阶段要显出「${bone}」，可是登场演出把它藏起（或者掉了）以后一直没再显出来：演出藏起的骨骼整场战斗都藏着，阶段显不出来。`, fix: `在登场最后加一步 {type:"glow", show:["${bone}"]}，或者不要在登场里藏它。`, detail: `phase ${index + 1} shows ${bone}; the intro leaves it hidden` })
    })
  }
  // The assets the steps name, where the project is known.
  for (const { show, step, index } of entries) {
    const where = `${showName(show)}演出第 ${index + 1} 步`
    const missing =
      step.type === "effect" && lookups.effect && !lookups.effect(step.effect) ? "特效" : step.type === "particle" && typeof step.particle === "object" && "asset" in step.particle && lookups.particle && !lookups.particle(step.particle.asset) ? "粒子" : step.type === "sound" && typeof step.sound === "object" && lookups.sound && !lookups.sound(step.sound.asset) ? "声音" : null
    if (missing) found.push({ rule: "boss_show_asset", stops: true, text: `「${creature.name}」${where}用的${missing}在工程里找不到了。`, fix: `换成工程里有的${missing}资产，或者去掉这一步。`, detail: `${show}.steps[${index}]: ${step.type} asset missing` })
  }
  return found
}

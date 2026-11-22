import { TICKS, comboTimeline } from "./ability-words"
import { BOSS_LOOK_LIMITS, SHAKE_LIMITS } from "./boss-words"
import type { Ability, Boss, BossPhaseModel, Combo, Stances } from "./entity-runtime"

/**
 * Boss 能力 8 (a stronger screen shake: roll, a pulse of the field of view, falloff, frequency) and Boss 能力 10 (a boss's model changing with its phases: bones hidden
 * and shown, a glow fading in, parts that come off), as numbers and words: what the generated Java is written from (`bossLookPlan`, the shake's runtime choice), what
 * the pictures draw (`shakeCurve`) and what every check and card says. Nothing here reads a model: what is measured against one is `boss-look.ts`.
 * No Node APIs: the app's window reads it too.
 */

type Shake = Extract<Ability["events"][number], { type: "shake" }>
type Drop = Extract<Ability["events"][number], { type: "drop" }>
const num = (value: number, digits = 2) => Number(value.toFixed(digits))

// ---- Boss 能力 8: the shake ----

/** A shake written with something a shake could not have before: strength past the old cap, or any of the four new fields. Such a project gets the new runtime. */
export const shakeExtended = (event: Shake) => event.strength > SHAKE_LIMITS.legacyCap || shakeOwnCall(event)
/** A shake the creature has to tell more than the old three numbers (strength, radius, ticks): one with roll, a change of view, its falloff or its frequency written. */
export const shakeOwnCall = (event: Shake) => event.roll !== undefined || event.fov !== undefined || event.falloff !== undefined || event.frequency !== undefined
/** Every shake of these creatures' abilities: their shake events, and the shakes their thrown things make where they come down (落地炸开, `impact.shake`; at the moment they are thrown, as near as is known before). */
export const shakesOf = (abilities: readonly (Pick<Ability, "events"> & Partial<Pick<Ability, "hits">>)[]) => [
  ...abilities.flatMap((ability) => ability.events.flatMap((event) => (event.type === "shake" ? [event] : []))),
  ...abilities.flatMap((ability) => impactShakes(ability)),
]
/** The shakes of an ability's thrown things where they come down (落地炸开), as shake events at the moment each is thrown. */
export const impactShakes = (ability: Partial<Pick<Ability, "hits">>): Shake[] =>
  (ability.hits ?? []).flatMap((hit) => (hit.type === "projectile" && hit.impact?.shake ? [{ type: "shake" as const, at: hit.at, ...hit.impact.shake }] : []))
/** The cap on the sum of the shakes running at once, in the runtime a project with these shakes gets. */
export const shakeCap = (shakes: readonly Shake[]) => (shakes.some(shakeExtended) ? SHAKE_LIMITS.cap : SHAKE_LIMITS.legacyCap)
/** The ticks a shake lasts, as the generated Java counts them (never less than one). */
export const shakeTicks = (event: Pick<Shake, "seconds">) => Math.max(1, Math.round(event.seconds * TICKS))

/** How strong a shake is `distance` blocks from its centre and `ticks` ticks after it began, before the cap and the player's own setting: the runtime's own rule. */
export function shakeAt(event: Shake, distance: number, ticks: number) {
  if (ticks < 0) return 0
  const left = Math.max(0, 1 - ticks / shakeTicks(event))
  const near = event.falloff === "none" ? (distance <= event.radius ? 1 : 0) : Math.max(0, 1 - distance / event.radius)
  return event.strength * near * left
}

/** One shake on a clock: when it starts (ticks from tick 0 of that clock) and what it is. */
export type TimedShake = { tick: number; event: Shake; label: string }

/** The shakes of one ability on its own clock (the tick each event happens on, as `abilityPlan` counts it). */
export const abilityShakes = (ability: Pick<Ability, "events" | "length" | "name">): TimedShake[] => {
  const length = Math.max(1, Math.round(ability.length * TICKS))
  return ability.events.flatMap((event) => (event.type === "shake" ? [{ tick: Math.min(length, Math.round(event.at * TICKS)), event, label: ability.name }] : []))
}

/** The shakes of a combo on the combo's own clock: each step's at that step's start (`comboTimeline`). */
export const comboShakes = (combo: Pick<Combo, "steps" | "gap_ticks">, abilities: readonly Pick<Ability, "id" | "events" | "length" | "name">[]): TimedShake[] => {
  const steps = combo.steps.map((id) => abilities.find((ability) => ability.id === id)).filter((value): value is NonNullable<typeof value> => Boolean(value))
  const timeline = comboTimeline(steps.map((step) => step.length), combo.gap_ticks)
  return steps.flatMap((step, index) => abilityShakes(step).map((shake) => ({ ...shake, tick: shake.tick + timeline.starts[index]! })))
}

/**
 * The strength at the centre, tick by tick, from the first shake to the end of the last: each shake's own and their sum, against the cap the runtime holds it to.
 * What the picture of a shake draws and what the check of stacked shakes reads.
 */
export function shakeCurve(shakes: readonly TimedShake[], cap: number) {
  if (!shakes.length) return null
  const end = Math.max(...shakes.map((shake) => shake.tick + shakeTicks(shake.event)))
  const points = Array.from({ length: end + 1 }, (_, tick) => {
    const each = shakes.map((shake) => shakeAt(shake.event, 0, tick - shake.tick))
    return { tick, each, sum: each.reduce((all, value) => all + value, 0) }
  })
  const peak = points.reduce((best, point) => (point.sum > best.sum ? point : best), points[0]!)
  return { points, end, peak, cap, over: points.filter((point) => point.sum > cap + 1e-9) }
}

/** 「，转动 4 度，视野放大 3 度，范围内一样强，晃得快 2 倍」: what a shake has beyond the old three numbers; empty for one written as before. */
export const shakeMoreWords = (event: Shake) =>
  [
    event.roll ? `画面左右转动最多 ${num(event.roll)} 度` : "",
    event.fov ? `视野${event.fov > 0 ? "放大" : "收窄"} ${num(Math.abs(event.fov))} 度再慢慢回来（玩家把“视野效果”调小就变小）` : "",
    event.falloff === "none" ? `${num(event.radius, 1)} 格内一样强` : "",
    event.frequency !== undefined && event.frequency !== 1 ? `晃得${event.frequency > 1 ? "快" : "慢"}（${num(event.frequency)} 倍）` : "",
  ]
    .filter(Boolean)
    .map((part) => `，${part}`)
    .join("")

/** What an AI is told of a shake's four new fields (appended to the shake's own sentence). */
export const SHAKE_MORE_INSTRUCTIONS = `可选（不写就和原来一样）：roll 0–${SHAKE_LIMITS.roll.max}（画面绕视线左右摆的角度，度）、fov -${SHAKE_LIMITS.fov.max}–${SHAKE_LIMITS.fov.max}（视野一下放大（正）或收窄（负）多少度，随震动慢慢回来，玩家的“视野效果”设置会把它变小）、falloff none|linear（linear 是离中心越远越轻、边上没有，和原来一样；none 是 radius 格内一样强）、frequency ${SHAKE_LIMITS.frequency.min}–${SHAKE_LIMITS.frequency.max}（晃动快慢，1 是原来的速度，0.5 是缓慢的摇晃，3 是急促的抖）。同时在跑的几个晃屏加起来最多 ${SHAKE_LIMITS.cap}（roll 加起来最多 ${SHAKE_LIMITS.roll.max} 度，fov 最多 ±${SHAKE_LIMITS.fov.max} 度），叠得再多也不会更晃；`

// ---- Boss 能力 10: the model in each phase ----

/** The picture a glow uses: the model's own glowing parts, or a texture asset. */
export type GlowTexture = "emissive" | { asset: string }
const sameTexture = (a: GlowTexture, b: GlowTexture) => (a === "emissive" ? b === "emissive" : b !== "emissive" && a.asset === b.asset)

/** A phase's model change, as the phases of a boss have it (absent: none). */
type PhaseLook = { model?: BossPhaseModel | undefined }

/**
 * The model a boss shows in each stage of its fight (stage 0 before the first line, stage N after the Nth), as the generated Java holds it:
 * - `bones`: every bone a phase hides, shows or drops, or an ability drops, in the order first named; a bone is a bit of `hidden` and of the dropped mask the runtime keeps.
 * - `hidden`: per stage, the bones hidden by the phases (a bone some phase shows is hidden before it unless an earlier phase hid it first). What has been dropped is kept apart (it depends on the fight).
 * - `slots`: the glowing pictures, the model's own glowing parts first when a phase uses them; `glow[stage][slot]`: from, to and the ticks between, counted from the moment the stage begins.
 *   Before any phase the model's own glowing parts glow fully (as they always do) and an asset's not at all; a stage that does not change a picture keeps where the one before ended.
 * - `textures`: the texture assets its phases put on, each once in the order first named; `texture[stage]`: which it wears, 0 the model's own, k `textures[k - 1]`
 *   (a stage that names none keeps the one before).
 * - `phaseDrops`: per phase (0 is the first line), the parts that come off when it begins, by bone index, with their ticks.
 * - `abilityDrops`: the drop events of the abilities, by ability and event.
 * Null for a boss that changes nothing of its model.
 */
export function bossLookPlan(boss: Pick<Boss, "phases">, abilities: readonly Pick<Ability, "events">[] = [], stances?: Stances) {
  const phases = boss.phases as readonly (Boss["phases"][number] & PhaseLook)[]
  const abilityDrops = abilities.flatMap((ability, index) => ability.events.flatMap((event, place) => (event.type === "drop" ? [{ ability: index, event: place, drop: event as Drop }] : [])))
  const poses = stances?.list.some(row => row.model) ? stances.list : undefined
  if (!phases.some((phase) => phase.model) && !abilityDrops.length && !poses) return null
  const bones: string[] = []
  const bone = (name: string) => (bones.includes(name) ? bones.indexOf(name) : bones.push(name) - 1)
  phases.forEach((phase) => [...(phase.model?.hide ?? []), ...(phase.model?.show ?? []), ...(phase.model?.drop ?? []).map((drop) => drop.bone)].forEach(bone))
  abilityDrops.forEach((value) => bone(value.drop.bone))
  poses?.forEach(row => [...(row.model?.hide ?? []), ...(row.model?.show ?? [])].forEach(bone))
  // Hidden from the start: a bone whose first mention is a phase showing it.
  const first = new Map<string, "hide" | "show">()
  phases.forEach((phase) => {
    for (const name of phase.model?.hide ?? []) if (!first.has(name)) first.set(name, "hide")
    for (const name of phase.model?.show ?? []) if (!first.has(name)) first.set(name, "show")
  })
  const bit = (name: string) => 1 << bones.indexOf(name)
  const hidden = [[...first].filter(([, how]) => how === "show").reduce((mask, [name]) => mask | bit(name), 0)]
  for (const phase of phases) {
    const before = hidden.at(-1)!
    const hid = (phase.model?.hide ?? []).reduce((mask, name) => mask | bit(name), 0)
    const shown = (phase.model?.show ?? []).reduce((mask, name) => mask | bit(name), 0)
    hidden.push((before | hid) & ~shown)
  }
  const slots: GlowTexture[] = []
  for (const phase of phases) {
    const texture = phase.model?.glow?.texture
    if (texture && !slots.some((slot) => sameTexture(slot, texture))) slots.push(texture)
  }
  for (const row of poses ?? []) {
    const texture = row.model?.glow?.texture
    if (texture && !slots.some(slot => sameTexture(slot, texture))) slots.push(texture)
  }
  slots.sort((a, b) => (a === "emissive" ? -1 : b === "emissive" ? 1 : 0))
  const glow: { from: number; to: number; ticks: number }[][] = [slots.map((slot) => ((level) => ({ from: level, to: level, ticks: 0 }))(slot === "emissive" ? 1 : 0))]
  for (const phase of phases) {
    const before = glow.at(-1)!
    const own = phase.model?.glow
    glow.push(slots.map((slot, index) => (own && sameTexture(own.texture, slot) ? { from: own.from, to: own.to, ticks: Math.round(own.seconds * TICKS) } : { from: before[index]!.to, to: before[index]!.to, ticks: 0 })))
  }
  const textures: string[] = []
  const texture = [0]
  for (const phase of phases) {
    const own = phase.model?.texture
    if (own && own !== "model" && !textures.includes(own.asset)) textures.push(own.asset)
    texture.push(own === undefined ? texture.at(-1)! : own === "model" ? 0 : textures.indexOf(own.asset) + 1)
  }
  const poseLooks = poses?.map(row => {
    const pose = row.model
    const own = pose?.texture
    if (own && own !== "model" && !textures.includes(own.asset)) textures.push(own.asset)
    const glow = pose?.glow
    return {
      hide: (pose?.hide ?? []).reduce((mask, name) => mask | bit(name), 0),
      show: (pose?.show ?? []).reduce((mask, name) => mask | bit(name), 0),
      texture: own === undefined ? -1 : own === "model" ? 0 : textures.indexOf(own.asset) + 1,
      glow: glow ? { slot: slots.findIndex(slot => sameTexture(slot, glow.texture)), from: glow.from, to: glow.to, ticks: Math.round(glow.seconds * TICKS) } : undefined,
    }
  })
  return {
    ...(poseLooks ? { stances: poseLooks } : {}),
    bones,
    hidden,
    slots,
    glow,
    textures,
    texture,
    phaseDrops: phases.map((phase) => (phase.model?.drop ?? []).map((drop) => ({ bone: bones.indexOf(drop.bone), name: drop.bone, ticks: Math.max(1, Math.round(drop.stay_seconds * TICKS)) }))),
    abilityDrops: abilityDrops.map((value) => ({ ...value, bone: bones.indexOf(value.drop.bone), ticks: Math.max(1, Math.round(value.drop.stay_seconds * TICKS)) })),
  }
}
export type BossLookPlan = NonNullable<ReturnType<typeof bossLookPlan>>

/** The bones hidden in a stage, by name, as the plan holds them (what has dropped aside). */
export const stageHidden = (plan: BossLookPlan, stage: number, stance?: number) => {
  const phase = plan.hidden[Math.min(stage, plan.hidden.length - 1)]!
  const overlay = stance === undefined ? undefined : plan.stances?.[stance]
  const hidden = overlay ? (phase | overlay.hide) & ~overlay.show : phase
  return plan.bones.filter((_, index) => (hidden & (1 << index)) !== 0)
}

/** 「换上去的样子：藏起「左角」，显出「火焰」，掉下「右臂」（躺 5 秒），「自身发光的部分」2 秒里从 0 亮到 100%」: what a phase changes of the model, in words; empty for none. */
export const phaseLookWords = (model: BossPhaseModel | undefined, textureName: (texture: GlowTexture) => string = (texture) => (texture === "emissive" ? "模型自己发光的部分" : "一张发光贴图"), boneName: (id:string)=>string = id=>id) => {
  if (!model) return ""
  const named = (bones: readonly string[]) => bones.map((bone) => `「${boneName(bone)}」`).join("")
  const parts = [
    model.hide?.length ? `藏起${named(model.hide)}` : "",
    model.show?.length ? `显出${named(model.show)}` : "",
    model.drop?.length ? `掉下${model.drop.map((drop) => `「${boneName(drop.bone)}」（落地躺 ${num(drop.stay_seconds)} 秒）`).join("")}` : "",
    model.texture ? (model.texture === "model" ? "换回模型自己的贴图" : "整身换上另一张贴图") : "",
    model.glow ? `${textureName(model.glow.texture)}${model.glow.seconds ? `在 ${num(model.glow.seconds)} 秒里` : ""}从 ${Math.round(model.glow.from * 100)}% 亮到 ${Math.round(model.glow.to * 100)}%` : "",
  ].filter(Boolean)
  return parts.length ? `，模型变成：${parts.join("、")}` : ""
}

/** 「第 0.8 秒「右臂」掉下来，落地躺 5 秒；之后这场战斗里它一直没有右臂」 */
export const dropWords = (event: Drop) => `第 ${num(event.at)} 秒「${event.bone}」连同挂在它下面的部件掉下来，落到地上躺 ${num(event.stay_seconds)} 秒后消失；这场战斗里它身上一直没有这个部件（离开重置后长回来）`

/** What an AI is told of a phase's model (appended to the phases' sentence) and of the drop event (appended to the events). */
export const BOSS_LOOK_INSTRUCTIONS =
  ` 每个阶段还可以写 model（可选，不写就是模型不变）：{hide, show, glow, texture, drop}——变身开始的那一刻模型变成新的样子，一直保持到战斗结束（离开重置后全部复原）。hide：这一阶段起藏起来的骨骼名字（模型 bones 里的 name，最多 ${BOSS_LOOK_LIMITS.bones} 个；挂在它下面的骨骼一起藏起），show：这一阶段起显出来的骨骼。看这根骨骼在阶段里第一次被点到的动作：第一次是 show，开场就藏起，到那一阶段才显出；第一次是 hide，开场能看见，到那一阶段才藏起。不用在模型上另写默认藏起。想让二阶段长出第二个头，把头做成独立骨骼，再在二阶段写 show。评审图用同一个姿势对照各阶段，并标出显隐、换贴图和发光的变化。` +
  `glow：{texture, from 0–1, to 0–1, seconds ${BOSS_LOOK_LIMITS.glow.min}–${BOSS_LOOK_LIMITS.glow.max}}，一层不受光照影响、全亮的发光层在 seconds 秒里从 from 变到 to（0 不亮，1 最亮），之后一直保持，直到后面的阶段再改同一张图。texture 写 "emissive" 是模型自己发光的部分（模型里画成发光的眼睛、纹路，平时一直全亮，阶段可以把它调暗或者从暗慢慢亮起来）；或者写 {"asset": 贴图资产的 id}：一张和模型贴图一样大小的贴图资产当发光层，亮色的像素发光（叠加在模型上，越亮越显眼），涂成黑色（#000000）的像素不发光，要和模型贴图的位置一一对齐（每个像素对应模型贴图同一个位置），所以要照着模型的贴图画。` +
  `texture：{"asset": 贴图资产的 id}，变身开始的那一刻整只 Boss 一下子换上这张贴图（比如裂开的、烧红的样子），一直穿到后面的阶段再写 texture 为止；写 "model" 是换回模型自己的贴图。这张贴图要和模型贴图一样大小、位置一一对齐（照着模型的贴图改画），模型里画成发光的部分换了贴图照样发光。` +
  `drop：[{bone, stay_seconds ${BOSS_LOOK_LIMITS.stay.min}–${BOSS_LOOK_LIMITS.stay.max}}]，最多 ${BOSS_LOOK_LIMITS.drops} 个，变身开始时这根骨骼（连同挂在它下面的）从身上掉下来，落到地上躺 stay_seconds 秒后消失，身上从此没有这个部件。掉下去的部件后面就不要再用了：后面的招式不要从它出手（bone）、不要给它画拖尾、后面的阶段也不要再 show 它。一只 Boss 藏起、显出、掉落的骨骼加起来最多 ${BOSS_LOOK_LIMITS.touched} 个。例：{"below":0.33,…,"model":{"hide":["helmet"],"show":["flame_crown"],"glow":{"texture":"emissive","from":0,"to":1,"seconds":2},"drop":[{"bone":"shield","stay_seconds":8}]}}。`

export const DROP_EVENT_INSTRUCTIONS = `或者掉落 {type:"drop", at, bone, stay_seconds ${BOSS_LOOK_LIMITS.stay.min}–${BOSS_LOOK_LIMITS.stay.max}}（只有 Boss 能用）：那一刻这根骨骼（连同挂在它下面的）从身上掉下来，落到地上躺 stay_seconds 秒后消失，这场战斗里它身上一直没有这个部件（离开重置后长回来）；适合“砍断一条手臂”“把盾甩掉”。掉了的部件后面的招式就不能再用它出手、画拖尾；同一招再出一次不会再掉一次。`

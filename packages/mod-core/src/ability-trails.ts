import { abilityRef, boneRef } from "./finding-refs"
import { assetOf, particleLabel, type ParticleAliases } from "./particle-emission"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { posedCorners, type MotionClip } from "@minemods/studio-ai/model-motion"
import { ABILITY_PARTICLES, TICKS, TRAIL_LIMITS } from "./ability-words"
import type { Ability, AbilityEvent } from "./entity-runtime"
import { allGroundFx, groundFxParticleAssets } from "./ground-fx"

/**
 * Boss 能力 11 between the document and everything that reads it: which of the project's particles an ability shows, and a weapon trail — where the far
 * end of its part is (`trailTip`, the one definition the pictures and the generated Java share), the curve that end sweeps while the trail is drawn
 * (`trailPath`), what is said of it and what a reviewer is told about it (`trailIssues`). No Node APIs: the app's window reads it too.
 */

type Vec = [number, number, number]
const num = (value: number, digits = 2) => Number(value.toFixed(digits))
/** Model pixels in a block. */
const BLOCK = 16
/** A moment of an ability as its server tick, as `abilityTick` (creature-abilities.ts) rounds it; written out here so this file needs nothing of that one. */
const tickOf = (seconds: number) => Math.round(seconds * TICKS)

export type ParticleEvent = Extract<AbilityEvent, { type: "particle" }>
export type TrailEvent = Extract<AbilityEvent, { type: "trail" }>

/** The particle asset an event shows, by its asset id; null for a vanilla particle. */
export const particleAsset = (event: Pick<ParticleEvent, "particle">) => assetOf(event.particle)
/** Every particle asset the abilities show, each once: their particle events', and the ones their thrown things burst into where they come down (落地炸开, `impact`). */
export const abilityParticleIds = (abilities: readonly (Pick<Ability, "events"> & Partial<Pick<Ability, "hits">>)[] | null | undefined) => [
  ...new Set([
    ...(abilities ?? []).flatMap((ability) => ability.events.flatMap((event) => (event.type === "particle" && particleAsset(event) !== null ? [particleAsset(event)!] : []))),
    ...(abilities ?? []).flatMap((ability) => (ability.hits ?? []).flatMap((hit) => (hit.type === "projectile" && hit.impact?.particle !== undefined && particleAsset({ particle: hit.impact.particle }) !== null ? [particleAsset({ particle: hit.impact.particle })!] : []))),
    ...(abilities ?? []).flatMap(ability => (ability.hits ?? []).flatMap(hit => hit.type === "projectile" && hit.trail ? assetOf(hit.trail.particle) ?? [] : [])),
    // 第 4 步: what a ground hazard puts up (an event's, or one left where a thrown thing comes down).
    ...groundFxParticleAssets((abilities ?? []).flatMap((ability) => allGroundFx([{ events: ability.events, hits: ability.hits ?? [] }]))),
  ]),
]
/** The name of what a particle event shows: a vanilla particle's plain name, or the title of the project's own (`title` finds it by asset id; null: not known here). */
export const particleWords = (event: Pick<ParticleEvent, "particle">, title: ((id: string) => string | null) | null = null, aliases?: ParticleAliases) =>
  typeof event.particle === "string" ? ABILITY_PARTICLES[event.particle] : "alias" in event.particle ? particleLabel(event.particle, { title, aliases }) : `自己做的粒子「${title?.(event.particle.asset) ?? "自制粒子"}」`

/** The trails of an ability, each with its place in `events`. */
export const trailEvents = (ability: Pick<Ability, "events">) => ability.events.flatMap((event, index) => (event.type === "trail" ? [{ index, event }] : []))
/** Whether any of the abilities draws a trail. */
export const abilitiesTrail = (abilities: readonly Pick<Ability, "events">[] | null | undefined) => (abilities ?? []).some((ability) => trailEvents(ability).length > 0)

/**
 * The far end of a part, the point a trail follows: of the corners of the part's OWN cubes (not those of the parts under it), the one furthest from
 * the part's pivot, in the model as it is built; of two equally far the first (cubes in the order written, corners in the order `posedCorners` lists them).
 * It belongs to the part and turns and moves with it, so a blade's point stays the blade's point however the blade swings.
 * - `cube`, `corner`: which corner it is, as `posedCorners` numbers the corners of a cube (bit 1 the cube's width, 2 its height, 4 its depth);
 * - `index`: where that corner is in the list `posedCorners` returns for the whole model;
 * - `local`: the corner from the part's pivot in blocks, in GeckoLib's own axes (the document's X turned round, as GeckoLib reads a geometry file): the point the
 *   generated trail renderer hands the part's matrix every frame (`GeoBone.getLocalSpaceMatrix`, which is taken at the pivot after the part is turned).
 * Null when the model has no such part, or the part has no cube of its own (nothing to have an end).
 */
export function trailTip(design: Pick<ModelDesign, "bones">, name: string) {
  const bone = design.bones.find((value) => value.name === name)
  if (!bone || !bone.cubes.length) return null
  const first = design.bones.slice(0, design.bones.indexOf(bone)).reduce((sum, value) => sum + value.cubes.length, 0)
  // Exactly the point `posedCorners` turns with the part: from the pivot, the document's X turned round.
  const corners = bone.cubes.flatMap((cube, cubeIndex) =>
    Array.from({ length: 8 }, (_, corner) => ({
      cube: cubeIndex,
      corner,
      local: [bone.pivot[0] - cube.origin[0] - (corner & 1 ? cube.size[0] : 0), cube.origin[1] + (corner & 2 ? cube.size[1] : 0) - bone.pivot[1], cube.origin[2] + (corner & 4 ? cube.size[2] : 0) - bone.pivot[2]] as Vec,
    })),
  )
  const far = corners.reduce((best, value) => (Math.hypot(...value.local) > Math.hypot(...best.local) + 1e-9 ? value : best), corners[0]!)
  return { cube: far.cube, corner: far.corner, index: (first + far.cube) * 8 + far.corner, local: far.local.map((value) => value / BLOCK) as Vec, reach: num(Math.hypot(...far.local) / BLOCK, 3) }
}

/**
 * The curve the far end of a trail's part sweeps while the trail is drawn: where it is (the viewport's space, model pixels) on every server tick from the tick of
 * `at` to the tick of `until`, as the ability's own motion holds the part then (`posedCorners`, the arithmetic of every picture of a pose; past the end of
 * the motion, its last moment). `travel`: the length of that curve in blocks; `ticks`: how many ticks it is drawn for. Null when the model lacks the motion,
 * the part, or the part has no cube of its own (`trailTip`).
 */
export function trailPath(ability: Pick<Ability, "clip" | "events">, index: number, design: Pick<ModelDesign, "bones" | "animations">) {
  const event = ability.events[index]
  if (!event || event.type !== "trail") return null
  const clip = design.animations.find((animation) => animation.name === ability.clip) as MotionClip | undefined
  const tip = trailTip(design, event.bone)
  if (!clip || !tip) return null
  const from = tickOf(event.at)
  const to = Math.max(from, tickOf(event.until))
  const ticks = Array.from({ length: to - from + 1 }, (_, step) => from + step)
  const points = ticks.map((tick) => posedCorners(design, clip, Math.min(tick / TICKS, clip.length))[tip.index]!)
  const travel = points.slice(1).reduce((sum, point, step) => sum + Math.hypot(point[0] - points[step]![0], point[1] - points[step]![1], point[2] - points[step]![2]), 0) / BLOCK
  return { event, tip, from, to, ticks: to - from, times: ticks.map((tick) => tick / TICKS), points, travel: num(travel, 3) }
}
export type TrailPath = NonNullable<ReturnType<typeof trailPath>>

/** A trail in a few words: when, behind what, and how it looks. */
export const trailWords = (event: TrailEvent) => `第 ${num(event.at)}–${num(event.until)} 秒「${event.bone}」末端拖出 ${event.color} 的光带（宽 ${num(event.width)} 格，每一段 ${event.fade_ticks} 刻淡掉）`

/** What was measured of a trail on the model, as a sentence for the look's notes and the card: how far its end sweeps, and from which corner. */
export function trailLine(ability: Pick<Ability, "name" | "clip" | "events">, index: number, design: Pick<ModelDesign, "bones" | "animations">) {
  const event = ability.events[index] as TrailEvent
  const path = trailPath(ability, index, design)
  if (!path) return `招式「${ability.name}」的拖尾：${trailWords(event)}；模型里量不出「${event.bone}」的末端（没有这个部件、它自己没有方块，或者没有 ${ability.clip} 这个动作）。`
  return `招式「${ability.name}」的拖尾：${trailWords(event)}。末端是「${event.bone}」自己第 ${path.tip.cube + 1} 个方块离转轴最远的那个角（离转轴 ${path.tip.reach} 格），这 ${path.ticks} 刻里扫过 ${num(path.travel)} 格。`
}

export type TrailIssue = { refs: import("@minemods/studio-ai/acceptance").FindingRef[]; ability: string; rule: "ability_trail"; stops: false; text: string; fix: string; detail: string }

/**
 * What a reviewer is told about a creature's trails, measured on its model and never a stop (the ability plays as written; it only shows less than meant):
 * a trail drawn for under `TRAIL_LIMITS.shortest` ticks, which is a speck and not a sweep, and one whose end sweeps less than `TRAIL_LIMITS.still` blocks while
 * it is drawn, so that nothing that reads as a trail is left behind (the part is not swung then, or the wrong part is named). A trail the model cannot measure
 * is said by `boneIssues` (no such part, or no cube of its own) or by the missing motion.
 */
export function trailIssues(creature: { name: string; abilities?: readonly Ability[] | null }, design: Pick<ModelDesign, "bones" | "animations"> | null): TrailIssue[] {
  return (creature.abilities ?? []).flatMap((ability) =>
    trailEvents(ability).flatMap(({ index, event }): TrailIssue[] => {
      const said = (text: string, fix: string, detail: string): TrailIssue => ({ ability: ability.id, refs: [abilityRef(ability), boneRef(event.bone)], rule: "ability_trail", stops: false, text: `「${creature.name}」的招式「${ability.name}」${text}`, fix, detail: `ability ${ability.id} event ${index}: ${detail}` })
      const ticks = tickOf(event.until) - tickOf(event.at)
      if (ticks < TRAIL_LIMITS.shortest)
        return [said(`的拖尾只画 ${ticks} 刻（第 ${num(event.at)} 到 ${num(event.until)} 秒）：不到 ${TRAIL_LIMITS.shortest} 刻，看起来只是一个点，不是一道挥过去的光。`, `把 until 往后挪，让它盖住挥动的那一段（至少 ${TRAIL_LIMITS.shortest} 刻，${num(TRAIL_LIMITS.shortest / TICKS)} 秒）。`, `${ticks} ticks; at least ${TRAIL_LIMITS.shortest}`)]
      const path = design ? trailPath(ability, index, design) : null
      if (!path || path.travel >= TRAIL_LIMITS.still) return []
      return [said(`的拖尾跟着「${event.bone}」的末端，可是第 ${num(event.at)} 到 ${num(event.until)} 秒它只动了 ${num(path.travel)} 格（不到 ${TRAIL_LIMITS.still} 格）：这段时间这个部件没怎么挥，拖不出光带。`, `把 at 和 until 挪到这个部件真正挥动的那一段，或者换成挥动的那个部件（兵器本身），或者让动作在这段时间挥动它。`, `tip travels ${path.travel} blocks over ticks ${path.from}–${path.to}; at least ${TRAIL_LIMITS.still}`)]
    }),
  )
}

/** What an AI is told about trails and particles of its own in an ability's events. */
export const TRAIL_INSTRUCTIONS =
  ` 粒子事件的 particle 除了原版的名字，还可以写 {"asset":"粒子资产的 id"}，放这个工程里自己做的粒子（单独的一类资产：几张小图加寿命、重力、大小和颜色变化、发不发光）；生物任务要依赖用到的每一个粒子。` +
  ` 兵器拖尾：{type:"trail", at, until, bone, color, width, fade_ticks}——从 at 到 until 秒（until 要比 at 晚，不能超过 length），每个玩家的游戏记下模型部件 bone 的末端每一帧在哪里，连成一条 color（#rrggbb）的发光带子，宽 width 格（${TRAIL_LIMITS.width.min} 到 ${TRAIL_LIMITS.width.max}），每一段在末端经过以后 fade_ticks 刻（${TRAIL_LIMITS.fade.min} 到 ${TRAIL_LIMITS.fade.max}）内淡掉。` +
  ` 末端的定义：这个部件自己的方块（不算挂在它下面的部件）里，离它的转轴最远的那个角，按模型搭好的样子算；它跟着部件一起转，所以 bone 要写兵器本身（剑身、刀、戈头所在的部件），而且这个部件自己要有方块。拖尾只给人看，不打人；它是发光叠加上去的，颜色越亮越显眼，太暗的颜色几乎看不见。` +
  ` 拖尾要盖住真正挥动的那一段：少于 ${TRAIL_LIMITS.shortest} 刻只是一个点，这段时间末端动得不到 ${TRAIL_LIMITS.still} 格也拖不出带子，检查都会说出来；对生物任务调用 look 会把末端在 at 到 until 之间每一刻的位置连成曲线，用它自己的颜色画在招式的图上。`

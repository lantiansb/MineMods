import { TimedScatter, extendedEmit, scatterWords, particleLabel, type ParticleNames } from "./particle-emission"
import { FixtureActionSchema, fixtureWords } from "./fixture-events"
import { SoundRangeSchema, SoundVolumeSchema } from "./sound-range"
import { z } from "zod"
import { StanceActionSchema } from "./combat"
import { motionName } from "@minemods/studio-ai/making"
import { ABILITY_LIMITS, ABILITY_PARTICLES, ABILITY_SOUNDS, EFFECT_LIMITS, RESERVED_CLIPS, TICKS } from "./ability-words"
import { BOSS_LIMITS, BOSS_LOOK_LIMITS, SHAKE_LIMITS } from "./boss-words"
import { bossWeatherPlan, weatherWords } from "./boss-weather"
import { bossLookPlan, shakeMoreWords, type GlowTexture } from "./boss-look-words"
import type { Boss, BossWeather } from "./entity-runtime"

/**
 * Boss 能力 15 (多步演出): a boss's wake-up (`intro.steps`) and its death (`death.steps`) as a row of timed steps, each at a moment of the show:
 * a motion, a sound, particles, an effect, a shake, bones lit or shown or hidden and a glow faded (item 10's), a part that comes off (item 10's drop), a small
 * structure set down round it (a vanilla tree or rock, or a list of blocks; only in air and plants, and never when the world forbids mobs to change blocks),
 * and the weather of its fight (item 7's). The old fields (`intro.clip`, `intro.sound`, `death.seconds`…) work as they always did; a boss with no steps is the
 * Java it always was.
 *
 * Here: the bounds, the schema (built from the parts `entity-runtime.ts` already has, so nothing here imports it), the plan the generated Java is written
 * from (`bossShowPlan`), the words, what an AI is told (`BOSS_SHOW_INSTRUCTIONS`) and what is wrong with a document on its own (`bossShowDocumentIssues`).
 * What is measured against the model is `boss-show-model.ts`. No Node APIs: the app's window reads it too.
 */

const num = (value: number, digits = 2) => Number(value.toFixed(digits))

/**
 * - `steps`: steps a show may have; `seconds`: the latest moment a step may be at (a show runs at most as long as the longest wake-up or death).
 * - `reach`: blocks ahead, above or to the side of its feet a step's place may be; `blocks`: the blocks a list may set down.
 * - `features`: how many trees or rocks one step grows, and the most `spread` they are scattered over.
 * - `structure`: what a reviewer is told is too much: past `most` blocks set down in all the build refuses, past `wide` blocks from the boss it is said.
 * - `glows`: glowing pictures the shows may fade.
 */
export const BOSS_SHOW_LIMITS = {
  steps: 24,
  seconds: Math.max(BOSS_LIMITS.seconds.max, BOSS_LIMITS.death.max),
  reach: 12,
  blocks: 64,
  features: { count: { min: 1, max: 8 }, spread: { min: 0, max: 12 } },
  structure: { most: 2000, wide: 16 },
  glows: 4,
} as const

/**
 * The vanilla trees and rocks a step may grow (configured features of the game, the same on 1.20.1 and 1.21.1): their name, how far they spread from where they
 * stand and how many blocks one is, roughly, for the reviewer; `soil`: a tree, grown only on dirt or grass (the game turns the block under a tree to dirt, so on
 * anything else it would change a block that is not a plant). Each is grown the way the game grows it, so it only takes air, leaves and plants.
 */
export const BOSS_SHOW_FEATURES = {
  oak: { name: "橡树", reach: 2, blocks: 40, height: 7, soil: true },
  fancy_oak: { name: "大橡树", reach: 4, blocks: 200, height: 12, soil: true },
  birch: { name: "白桦树", reach: 2, blocks: 40, height: 8, soil: true },
  spruce: { name: "云杉", reach: 3, blocks: 60, height: 10, soil: true },
  pine: { name: "松树", reach: 2, blocks: 40, height: 10, soil: true },
  acacia: { name: "金合欢树", reach: 4, blocks: 60, height: 8, soil: true },
  dark_oak: { name: "深色橡树", reach: 4, blocks: 150, height: 9, soil: true },
  cherry: { name: "樱花树（粉红的树冠）", reach: 5, blocks: 320, height: 9, soil: true },
  azalea_tree: { name: "杜鹃树", reach: 3, blocks: 50, height: 6, soil: true },
  jungle_bush: { name: "丛林灌木", reach: 2, blocks: 20, height: 3, soil: true },
  huge_red_mushroom: { name: "巨型红蘑菇", reach: 3, blocks: 60, height: 7, soil: false },
  huge_brown_mushroom: { name: "巨型棕蘑菇", reach: 4, blocks: 60, height: 7, soil: false },
  forest_rock: { name: "苔石堆", reach: 1, blocks: 8, height: 2, soil: false },
  ice_spike: { name: "冰刺", reach: 3, blocks: 80, height: 12, soil: false },
  desert_well: { name: "沙漠水井", reach: 2, blocks: 40, height: 4, soil: false },
} as const
export type BossShowFeature = keyof typeof BOSS_SHOW_FEATURES
export const BOSS_SHOW_FEATURE_IDS = Object.keys(BOSS_SHOW_FEATURES) as [BossShowFeature, ...BossShowFeature[]]

/** What each kind of step is called where a person reads it (the timeline's legend, the review). */
export const BOSS_SHOW_KINDS = { clip: "动作", sound: "声音", particle: "粒子", effect: "特效", shake: "震屏", glow: "发光/显隐", drop: "掉落", place_structure: "放置", weather: "天气", fixture: "场地物件", stance: "切姿态" } as const
export type BossShowKind = keyof typeof BOSS_SHOW_KINDS

/**
 * The schema of a show's steps, made from the parts of a creature document `entity-runtime.ts` already has (a bone's name, a motion's name, item 10's glow, item 7's
 * weather, a sound, a particle, a block): that file calls this with them, so the step is written exactly as the same thing elsewhere is.
 */
export function bossShowStepsSchema<Bone extends z.ZodType<string>, Clip extends z.ZodType<string>, Glow extends z.ZodType, Weather extends z.ZodType, Sound extends z.ZodType, Particle extends z.ZodType, Block extends z.ZodType<string>>(parts: {
  bone: Bone
  clip: Clip
  glow: Glow
  weather: Weather
  sound: Sound
  particle: Particle
  block: Block
}) {
  const at = z.number().finite().min(0).max(BOSS_SHOW_LIMITS.seconds)
  const ahead = z.number().finite().min(-BOSS_SHOW_LIMITS.reach).max(BOSS_SHOW_LIMITS.reach)
  const whole = z.number().int().min(-BOSS_SHOW_LIMITS.reach).max(BOSS_SHOW_LIMITS.reach)
  const bones = z.array(parts.bone).max(BOSS_LOOK_LIMITS.bones)
  return z
    .array(
      z.discriminatedUnion("type", [
        z.strictObject({ type: z.literal("clip"), at, clip: parts.clip }),
        z.strictObject({ type: z.literal("sound"), at, sound: parts.sound, volume: SoundVolumeSchema, range_blocks: SoundRangeSchema.optional(), pitch: z.number().finite().min(0.5).max(2) }),
        z.strictObject({ type: z.literal("particle"), at, particle: parts.particle, count: z.number().int().min(1).max(64), forward: ahead, up: ahead, left: ahead, ...TimedScatter }),
        z.strictObject({ type: z.literal("effect"), at, effect: z.uuid(), forward: ahead, up: ahead, left: ahead, count: z.number().int().min(1).max(EFFECT_LIMITS.count), layout: z.enum(["ring", "line"]), spread: z.number().finite().min(0).max(EFFECT_LIMITS.spread) }),
        z.strictObject({
          type: z.literal("shake"),
          at,
          strength: z.number().finite().min(SHAKE_LIMITS.strength.min).max(SHAKE_LIMITS.strength.max),
          radius: z.number().finite().min(SHAKE_LIMITS.radius.min).max(SHAKE_LIMITS.radius.max),
          seconds: z.number().finite().min(SHAKE_LIMITS.seconds.min).max(SHAKE_LIMITS.seconds.max),
          roll: z.number().finite().min(0).max(SHAKE_LIMITS.roll.max).optional(),
          fov: z.number().finite().min(-SHAKE_LIMITS.fov.max).max(SHAKE_LIMITS.fov.max).optional(),
          falloff: z.enum(["none", "linear"]).optional(),
          frequency: z.number().finite().min(SHAKE_LIMITS.frequency.min).max(SHAKE_LIMITS.frequency.max).optional(),
        }),
        z.strictObject({ type: z.literal("glow"), at, show: bones.optional(), hide: bones.optional(), glow: parts.glow.optional() }),
        z.strictObject({ type: z.literal("drop"), at, bone: parts.bone, stay_seconds: z.number().finite().min(BOSS_LOOK_LIMITS.stay.min).max(BOSS_LOOK_LIMITS.stay.max) }),
        z.strictObject({
          type: z.literal("place_structure"),
          at,
          forward: ahead,
          left: ahead,
          structure: z.union([
            z.strictObject({ feature: z.enum(BOSS_SHOW_FEATURE_IDS), count: z.number().int().min(BOSS_SHOW_LIMITS.features.count.min).max(BOSS_SHOW_LIMITS.features.count.max), spread: z.number().finite().min(BOSS_SHOW_LIMITS.features.spread.min).max(BOSS_SHOW_LIMITS.features.spread.max) }),
            z.strictObject({ blocks: z.array(z.strictObject({ block: parts.block, forward: whole, up: whole, left: whole })).min(1).max(BOSS_SHOW_LIMITS.blocks) }),
          ]),
        }),
        z.strictObject({ type: z.literal("weather"), at, weather: parts.weather }),
        FixtureActionSchema.extend({ at }),
        StanceActionSchema.extend({ at }),
      ]),
    )
    .max(BOSS_SHOW_LIMITS.steps)
}

export type BossShowStep = NonNullable<Boss["death"]["steps"]>[number]
type Step<K extends BossShowKind> = Extract<BossShowStep, { type: K }>
export type BossShowName = "intro" | "death"
type Showing = { phases?: readonly { finish?: Boss["phases"][number]["finish"] }[]; intro?: { seconds: number; steps?: readonly BossShowStep[] | undefined } | null; death: { seconds: number; steps?: readonly BossShowStep[] | undefined } }

/** The server tick a step is at, counted from the show's start (its first tick is 1, as the boss's own timers count). */
export const bossShowTick = (at: number) => Math.max(1, Math.round(at * TICKS))
/** The tick of a show's last step; 0 without steps. A show runs at least this long (`bossPlan` stretches its wake-up and its death to it). */
export const bossShowEnd = (steps: readonly {at:number;until?:number}[] | null | undefined) => (steps ?? []).reduce((last, step) => Math.max(last, bossShowTick(step.until ?? step.at)), 0)
/** A show's steps in the order they happen: by tick, and as written within one tick. */
export const bossShowOrder = <T extends Pick<BossShowStep, "at">>(steps: readonly T[] | null | undefined) =>
  (steps ?? []).map((step, index) => ({ step, index, tick: bossShowTick(step.at) })).sort((a, b) => a.tick - b.tick || a.index - b.index)
export function bossScatter(boss: Boss | null | undefined) {
  return [...bossShowSteps(boss).map(row=>row.step),...(boss?.phases.flatMap(p=>p.finish??[])??[])].some(s=>s.type==="particle" && extendedEmit(s))
}
/** Whether a boss has any show step at all: only then is anything of this written. */
export const bossShows = (boss: Showing | null | undefined) => Boolean(boss && ((boss.intro?.steps?.length ?? 0) + (boss.death.steps?.length ?? 0) > 0))
/** The steps of both shows, each with which show it is in. */
export const bossShowSteps = (boss: Showing | null | undefined) => [...(boss?.intro?.steps ?? []).map((step, index) => ({ show: "intro" as const, step, index })), ...(boss?.death.steps ?? []).map((step, index) => ({ show: "death" as const, step, index }))]

const sameTexture = (a: GlowTexture, b: GlowTexture) => (a === "emissive" ? b === "emissive" : b !== "emissive" && a.asset === b.asset)

/**
 * The shows as the generated Java holds them. Null for a boss with no step, so nothing of this is written for it.
 * - `bones`: every bone a step shows, hides or drops, a bit each; `asleep`: hidden before the wake-up (a bone whose first mention in the wake-up, then the death, is
 *   being shown); `look[show]`: after each such step, what is hidden then; `awake`: what the fight shows after the wake-up (its last; or `asleep`). The death starts from `awake`.
 * - `clips`: the motions the shows play, each once; `clip[show]`: from its tick, the motion it plays (until the next, or the show's end).
 * - `slots`: the glowing pictures, the model's own first; `rest`: how bright one is when no show has said (its own glowing parts fully, a picture not at all);
 *   `glow[show]`: each fade; `asleepGlow` / `awakeGlow`: before the wake-up (its first fade's start) and in the fight (its last fade's end).
 * - `weather[show]`: from its tick, the weather of the fight's players; `carry[stage]`: the wake-up's last weather lasts into that stage of the fight (no phase has one by then).
 * - `steps[show]`: every step in order, with its tick, for the server to run; `end[show]`: the tick of the last one.
 */
export function bossShowPlan(boss: Showing & Pick<Boss, "phases">, hasStanceEvents = false) {
  if (!hasStanceEvents && !bossShows(boss) && !boss.phases?.some(phase => phase.finish?.length)) return null
  const shows = { intro: bossShowOrder(boss.intro?.steps), death: bossShowOrder(boss.death.steps) }
  const all = [...shows.intro, ...shows.death]
  const bones: string[] = []
  const bone = (name: string) => (bones.includes(name) ? bones.indexOf(name) : bones.push(name) - 1)
  const first = new Map<string, "show" | "hide">()
  for (const { step } of all) {
    if (step.type === "glow") {
      for (const name of step.hide ?? []) (bone(name), first.has(name) || first.set(name, "hide"))
      for (const name of step.show ?? []) (bone(name), first.has(name) || first.set(name, "show"))
    }
    if (step.type === "drop") (bone(step.bone), first.has(step.bone) || first.set(step.bone, "hide"))
  }
  const bit = (name: string) => 1 << bones.indexOf(name)
  const asleep = [...first].filter(([, how]) => how === "show").reduce((mask, [name]) => mask | bit(name), 0)
  const after = (mask: number, step: BossShowStep) =>
    step.type === "glow" ? (mask | (step.hide ?? []).reduce((all, name) => all | bit(name), 0)) & ~(step.show ?? []).reduce((all, name) => all | bit(name), 0) : step.type === "drop" ? mask | bit(step.bone) : mask
  const looks = (timed: typeof shows.intro, from: number) =>
    timed.reduce<{ tick: number; mask: number }[]>((rows, { step, tick }) => (step.type === "drop" || (step.type === "glow" && (step.show?.length || step.hide?.length)) ? [...rows, { tick, mask: after(rows.at(-1)?.mask ?? from, step) }] : rows), [])
  const introLook = looks(shows.intro, asleep)
  const awake = introLook.at(-1)?.mask ?? asleep
  const deathLook = looks(shows.death, awake)
  const clips: string[] = []
  const clipRows = (timed: typeof shows.intro) => timed.flatMap(({ step, tick }) => (step.type === "clip" ? [{ tick, clip: clips.includes(step.clip) ? clips.indexOf(step.clip) : clips.push(step.clip) - 1, name: step.clip }] : []))
  const introClips = clipRows(shows.intro)
  const deathClips = clipRows(shows.death)
  const slots: GlowTexture[] = []
  for (const { step } of all) if (step.type === "glow" && step.glow && !slots.some((slot) => sameTexture(slot, step.glow!.texture))) slots.push(step.glow.texture)
  slots.sort((a, b) => (a === "emissive" ? -1 : b === "emissive" ? 1 : 0))
  const rest = slots.map((slot) => (slot === "emissive" ? 1 : 0))
  const glowRows = (timed: typeof shows.intro) =>
    timed.flatMap(({ step, tick }) => (step.type === "glow" && step.glow ? [{ tick, slot: slots.findIndex((slot) => sameTexture(slot, step.glow!.texture)), from: step.glow.from, to: step.glow.to, ticks: Math.round(step.glow.seconds * TICKS) }] : []))
  const introGlow = glowRows(shows.intro)
  const deathGlow = glowRows(shows.death)
  const asleepGlow = slots.map((_, slot) => introGlow.find((row) => row.slot === slot)?.from ?? rest[slot]!)
  const awakeGlow = slots.map((_, slot) => introGlow.filter((row) => row.slot === slot).at(-1)?.to ?? rest[slot]!)
  const weatherRows = (timed: typeof shows.intro) => timed.flatMap(({ step, tick }) => (step.type === "weather" ? [{ tick, weather: step.weather as BossWeather }] : []))
  const introWeather = weatherRows(shows.intro)
  const deathWeather = weatherRows(shows.death)
  const carry = bossWeatherPlan(boss).map((stage) => stage === null && introWeather.length > 0)
  return {
    bones,
    asleep,
    awake,
    look: { intro: introLook, death: deathLook },
    clips,
    clip: { intro: introClips, death: deathClips },
    slots,
    rest,
    glow: { intro: introGlow, death: deathGlow },
    asleepGlow,
    awakeGlow,
    weather: { intro: introWeather, death: deathWeather },
    carry,
    steps: shows,
    end: { intro: bossShowEnd(boss.intro?.steps), death: bossShowEnd(boss.death.steps) },
  }
}
export type BossShowPlan = NonNullable<ReturnType<typeof bossShowPlan>>

/** The bones hidden at `time` seconds of a show (before the wake-up: `time` below 0 of "intro"; in the fight: past the wake-up's end), by name: what a picture of that moment turns off. */
export function bossShowHiddenAt(plan: BossShowPlan, show: BossShowName, time: number) {
  const tick = time * TICKS
  const rows = plan.look[show]
  const last = rows.filter((row) => row.tick <= tick + 1e-9).at(-1)
  const mask = last ? last.mask : show === "intro" ? plan.asleep : plan.awake
  return plan.bones.filter((_, index) => (mask & (1 << index)) !== 0)
}

/** How bright each glowing picture is at `time` seconds of a show (the rule the generated Java draws by). */
export function bossShowGlowAt(plan: BossShowPlan, show: BossShowName, time: number) {
  const tick = time * TICKS
  return plan.slots.map((_, slot) => {
    let level = show === "intro" ? plan.asleepGlow[slot]! : plan.awakeGlow[slot]!
    for (const row of plan.glow[show]) {
      if (row.tick > tick + 1e-9 || row.slot !== slot) continue
      const done = row.ticks <= 0 ? 1 : Math.min(1, Math.max(0, (tick - row.tick) / row.ticks))
      level = row.from + (row.to - row.from) * done
    }
    return level
  })
}

/** The motion a show plays at `time` seconds, and how far into it; null when none of its clip steps has come yet. */
export function bossShowClipAt(plan: BossShowPlan, show: BossShowName, time: number) {
  const tick = time * TICKS
  const last = plan.clip[show].filter((row) => row.tick <= tick + 1e-9).at(-1)
  return last ? { clip: last.name, time: Math.max(0, (tick - last.tick) / TICKS) } : null
}

// ---- words ----

/** What a vanilla particle, a sound or a picture is called, for the words; one of the project's own is named by what it is. */
export type ShowNames = ParticleNames & {
  displayNames?: boolean
  bone?: (id: string) => string
  block?: (id: string) => string
  motion?: (id: string) => string
}
const ownTitle = (id: string, kind: string, names: ShowNames) => names.title?.(id) ?? kind
const textureName = (texture: GlowTexture, names: ShowNames) => texture === "emissive" ? "模型自己发光的部分" : ownTitle(texture.asset, "发光贴图", names)
const boneName = (id: string, names: ShowNames) => names.bone?.(id) ?? (/[一-龥]/.test(id) ? id : "指定部件")
const named = (bones: readonly string[], names: ShowNames) => bones.map(bone => `「${boneName(bone, names)}」`).join("、")
/** 「它前方 3 格、左边 2 格」, or 「它脚下」. */
const where = (forward: number, left: number) => (forward || left ? `它${forward ? `${forward > 0 ? "前方" : "后方"} ${num(Math.abs(forward))} 格` : ""}${forward && left ? "、" : ""}${left ? `${left > 0 ? "左边" : "右边"} ${num(Math.abs(left))} 格` : ""}` : "它脚下")

/** One step in words, without its moment: 「播「跪下」」, 「长出 5 棵「樱花树」……」. */
export function bossShowStepWords(step: BossShowStep, names: ShowNames = {}) {
  switch (step.type) {
    case "fixture": return fixtureWords(step)
    case "stance": return `切到「${step.to}」姿态`
    case "clip":
      return `播「${names.motion?.(step.clip) ?? (motionName(step.clip) === step.clip ? "指定动作" : motionName(step.clip))}」`
    case "sound":
      return `播放「${typeof step.sound === "string" ? ABILITY_SOUNDS[step.sound] ?? (names.displayNames ? "游戏声音" : "游戏音效") : ownTitle(step.sound.asset, names.displayNames ? "自己的声音" : "自制音效", names)}」`
    case "particle":
      if(extendedEmit(step) || step.forward || step.up || step.left) return scatterWords(step,particleLabel(step.particle,{...names,title:id=>ownTitle(id,"自制",names)}))
      return `冒出 ${step.count} 个${particleLabel(step.particle, { ...names, title: id => ownTitle(id, "自制", names) })}粒子`
    case "effect":
      return `放出 ${step.count} 个「${ownTitle(step.effect, names.displayNames ? "效果" : "特效", names)}」${step.count > 1 ? (step.layout === "ring" ? `（围成半径 ${num(step.spread)} 格的一圈）` : `（往前排成 ${num(step.spread)} 格长的一行）`) : ""}`
    case "shake":
      return `${num(step.radius, 1)} 格内的玩家屏幕晃动（力度 ${num(step.strength)}，${num(step.seconds)} 秒里停下${shakeMoreWords({ ...step, type: "shake" } as never)}）`
    case "glow":
      return [step.show?.length ? `显出${named(step.show, names)}` : "", step.hide?.length ? `藏起${named(step.hide, names)}` : "", step.glow ? `${textureName(step.glow.texture, names)}${step.glow.seconds ? `在 ${num(step.glow.seconds)} 秒里` : ""}从 ${Math.round(step.glow.from * 100)}% 亮到 ${Math.round(step.glow.to * 100)}%` : ""].filter(Boolean).join("、")
    case "drop":
      return `「${boneName(step.bone, names)}」连同挂在它下面的部件脱手掉下来，落到地上躺 ${num(step.stay_seconds)} 秒后消失`
    case "place_structure":
      return "feature" in step.structure
        ? `在${where(step.forward, step.left)}${step.structure.count > 1 ? `周围 ${num(step.structure.spread)} 格内` : ""}长出 ${step.structure.count} ${step.structure.feature.includes("rock") || step.structure.feature.includes("well") || step.structure.feature.includes("spike") ? "个" : "棵"}「${BOSS_SHOW_FEATURES[step.structure.feature].name}」（照游戏自己长树的规矩，只占空气、树叶和花草）`
        : `在${where(step.forward, step.left)}摆下 ${step.structure.blocks.length} 个方块（${[...new Set(step.structure.blocks.map((block) => names.block?.(block.block) ?? "指定的方块"))].join("、")}；只放在空气和花草的位置上）`
    case "weather":
      return `战斗里的玩家看到${weatherWords(step.weather as BossWeather)}`
  }
}

/** 「第 0.5 秒显出「左眼」；第 1 秒……」: a show's steps in order; empty without any. */
export const bossShowWords = (steps: readonly BossShowStep[] | null | undefined, names: ShowNames = {}) =>
  bossShowOrder(steps)
    .map(({ step }) => `第 ${num(step.at)} 秒${bossShowStepWords(step, names)}`)
    .join("；")

/** The sentence a boss's wake-up or death adds for its steps, appended to the one it already has; empty without steps. */
export const bossShowSentence = (show: BossShowName, steps: readonly BossShowStep[] | null | undefined, names: ShowNames = {}) => {
  const words = bossShowWords(steps, names)
  if (!words) return ""
  const placed = (steps ?? []).some((step) => step.type === "place_structure")
  return `；${show === "intro" ? "登场演出" : "死亡演出"}按时间走：${words}${placed ? "（放置只在世界允许生物改方块时才做）" : ""}`
}

// ---- for whoever writes a creature document ----

/** What an AI is told of the shows' steps (appended to the boss's instructions after its death). */
export const BOSS_SHOW_INSTRUCTIONS =
  ` 粒子步骤和阶段收尾都接受招式的撒法，可选 bone、shape、spread、velocity、motion、tint、until、every_ticks。登场雾用一步从 0 秒撒到 2 秒；阶段收尾从变化完成的那一刻算 0 秒。登场和死亡还可以写成一串带时间的步骤（可选，不写就照上面的老写法演）：intro.steps、death.steps，各最多 ${BOSS_SHOW_LIMITS.steps} 步，每一步是 {type, at, …}，at 是从这段演出开始算的秒数（0–${BOSS_SHOW_LIMITS.seconds}）。登场的步骤从它醒来那一刻算（会飞的从飞上天开始算），这段时间里它不动、打不死；死亡的步骤从它死的那一刻算，全部演完它才消失。最后一步比 seconds 晚的，这段演出会拉长到最后一步，但最好把 seconds 写够。` +
  `type 有这几种：` +
  `{type:"clip", at, clip}：从这一刻起播模型里名叫 clip 的动作（不能是 idle、walk、hurt、death），直到下一个 clip 步骤或演出结束；登场里它盖过 intro.clip，死亡里它盖过 death 动作，动作放完停在最后一帧（跪下就一直跪着）。` +
  `{type:"sound", at, sound, volume 0.2–4, pitch 0.5–2}：响一声（sound 和招式的 sound 同一份清单，也可以是 {"asset": 声音资产的 id}）。` +
  `{type:"particle", at, particle, count 1–64, forward, up, left, spread 0–4}：在它脚下往前 forward、往上 up、往左 left 格的地方冒粒子（写法和招式的粒子事件一样）。` +
  `{type:"effect", at, effect, forward, up, left, count 1–${EFFECT_LIMITS.count}, layout ring|line, spread}：放这个工程的一个特效资产（写法和招式的 effect 事件一样，位置从它自己脚下算）。` +
  `{type:"shake", at, strength, radius, seconds, roll, fov, falloff, frequency}：晃屏，写法和招式的晃屏一样。` +
  `{type:"glow", at, show, hide, glow}：模型这一刻起的样子，和阶段的 model 同一套：show 显出骨骼、hide 藏起骨骼（骨骼名字，挂在下面的一起），glow {texture, from, to, seconds} 让一张发光图在 seconds 秒里从 from 亮到 to。被某一步 show 的骨骼在那之前是藏着的（睡着的时候也藏着），所以“雾里四只眼睛一只一只亮起来”就是：模型里把四只眼睛做成四根画成发光的骨骼，登场里每隔一会儿一步 {type:"glow", at, show:["eye_1"]}……。登场改过的样子会带进战斗；死亡改的只在死亡里。三样至少写一样；同一张发光图不能既在阶段的 model.glow 里又在演出里用（模型自己发光的部分也一样，要么阶段调、要么演出调）。` +
  `{type:"drop", at, bone, stay_seconds ${BOSS_LOOK_LIMITS.stay.min}–${BOSS_LOOK_LIMITS.stay.max}}：这根骨骼（连同挂在下面的）从身上脱手掉下来，落地躺 stay_seconds 秒后消失，之后身上没有它；“兵器一件件脱手”就是几步 drop 依次排开。同一个部件一段演出里只掉一次。` +
  `{type:"place_structure", at, forward, left, structure}：在它脚下往前 forward、往左 left 格（-${BOSS_SHOW_LIMITS.reach}–${BOSS_SHOW_LIMITS.reach}）的地方放一个小东西，留在世界里：structure 写 {feature, count ${BOSS_SHOW_LIMITS.features.count.min}–${BOSS_SHOW_LIMITS.features.count.max}, spread ${BOSS_SHOW_LIMITS.features.spread.min}–${BOSS_SHOW_LIMITS.features.spread.max}} 是长出 count 棵游戏自己的树或石堆，散在 spread 格内（feature 只能是 ${BOSS_SHOW_FEATURE_IDS.join("|")}，各是 ${BOSS_SHOW_FEATURE_IDS.map((id) => BOSS_SHOW_FEATURES[id].name).join("、")}，一棵的位置找不到地面、长不下或离已长出的那棵太近（不到 spread 的一半，最多 3 格）时，在 spread 格内往外挪一格、换个方向再找；都太近就不管间距再找一遍，还不行的那一棵才不长）；或者写 {blocks: [{block, forward, up, left}]}，最多 ${BOSS_SHOW_LIMITS.blocks} 个方块，block 写本工程方块的标识符或 minecraft:名字，forward/up/left 是整数格，从放置点（它的脚所在那一格）按它朝的方向转过去摆。两种都只放在空气、花草、树叶的位置上，不拆任何方块；世界的 mobGriefing 关掉（或者领地插件不让生物改方块）就什么都不放。“枷锁落地处长出一片红枫林”就是死亡里一步 place_structure（feature 用 cherry 或者一列自己的红色树叶方块）。` +
  `{type:"weather", at, weather:{rain, thunder, dark}}：从这一刻起这场战斗里的玩家看到的天气（和阶段的 weather 一样，只给他们看，世界真实的天气不变）；登场里最后的天气会带进战斗，直到某个阶段写了自己的 weather；死亡里的天气只到它消失。` +
  ` 例：{"intro":{…,"seconds":6,"steps":[{"type":"weather","at":0,"weather":{"rain":false,"thunder":false,"dark":0.7}},{"type":"glow","at":1,"show":["eye_1"]},{"type":"glow","at":2,"show":["eye_2"]},{"type":"clip","at":4,"clip":"stomp"},{"type":"shake","at":4.6,"strength":2,"radius":16,"seconds":0.8}]},"death":{"seconds":6,"xp_bursts":4,"explosion":false,"steps":[{"type":"drop","at":0.5,"bone":"axe","stay_seconds":30},{"type":"clip","at":3,"clip":"kneel"},{"type":"place_structure","at":5,"forward":0,"left":0,"structure":{"feature":"cherry","count":5,"spread":7}}]}}。`

/** The sound, effect and particle assets a boss's shows use, each once: what the creature depends on and the build needs. */
export function bossShowAssets(boss: Showing | null | undefined, extra: Readonly<NonNullable<Boss["phases"][number]["finish"]>> = []) {
  const finish = boss?.phases?.flatMap(phase => phase.finish ?? []) ?? []
  const steps = [...bossShowSteps(boss).map(entry => entry.step), ...finish, ...extra]
  const asset = (value: unknown) => (value && typeof value === "object" && "asset" in value ? [(value as { asset: string }).asset] : [])
  return {
    sounds: [...new Set(steps.flatMap((step) => (step.type === "sound" ? asset(step.sound) : [])))],
    effects: [...new Set(steps.flatMap((step) => (step.type === "effect" ? [step.effect] : [])))],
    particles: [...new Set(steps.flatMap(step => step.type === "particle" ? asset(step.particle) : step.type === "ground" ? step.ground.flatMap(fx => fx.type === "hazard" ? asset(fx.particle) : []) : []))],
    glows: [...new Set(steps.flatMap((step) => (step.type === "glow" && step.glow ? asset(step.glow.texture) : [])))],
  }
}

/**
 * What is wrong with a boss's shows that no single field shows, in the person's words, each with where it is (refused with the document): a step of a show
 * the boss does not have, a motion the creature plays by itself, a glow step that changes nothing, a bone shown and hidden at once, a part dropped twice in
 * one show, more bones or pictures than the runtime counts, and a glowing picture the phases already fade.
 */
export function bossShowDocumentIssues(creature: { behavior: string; boss?: (Showing & Pick<Boss, "phases">) | null }) {
  const found: { path: (string | number)[]; message: string }[] = []
  const boss = creature.boss
  if (!boss) return found
  for (const show of ["intro", "death"] as const) {
    const steps = (show === "intro" ? boss.intro?.steps : boss.death.steps) ?? []
    const dropped = new Set<string>()
    steps.forEach((step, index) => {
      const path = ["boss", show, "steps", index]
      if (step.type === "clip" && (RESERVED_CLIPS as readonly string[]).includes(step.clip)) found.push({ path: [...path, "clip"], message: `演出不能用 ${step.clip} 这个动作：它是生物平时、挨打或死的时候自己播的。给这一步单独做一个动作` })
      if (step.type === "glow") {
        if (!step.show?.length && !step.hide?.length && !step.glow) found.push({ path, message: "glow 这一步什么也没改：show、hide、glow 至少写一样" })
        const both = (step.show ?? []).filter((bone) => (step.hide ?? []).includes(bone))
        if (both.length) found.push({ path, message: `同一步里不能既显出又藏起${both.map(bone => `「${bone}」`).join("、")}：分成两步，或者去掉其中一边` })
      }
      if (step.type === "drop") {
        if (dropped.has(step.bone)) found.push({ path: [...path, "bone"], message: `「${step.bone}」在这段演出里已经掉过一次了：掉了的部件不会再掉一次，去掉这一步或者换一个部件` })
        dropped.add(step.bone)
      }
    })
  }
  const plan = bossShowPlan(boss)
  if (!plan) return found
  if (plan.bones.length > BOSS_LOOK_LIMITS.touched) found.push({ path: ["boss"], message: `演出里显出、藏起和掉落的骨骼加起来最多 ${BOSS_LOOK_LIMITS.touched} 根，现在写了 ${plan.bones.length} 根。合并一下：藏起一根骨骼，挂在它下面的会一起藏起` })
  if (plan.slots.length > BOSS_SHOW_LIMITS.glows) found.push({ path: ["boss"], message: `演出里最多用 ${BOSS_SHOW_LIMITS.glows} 张发光图，现在用了 ${plan.slots.length} 张` })
  // A glowing picture is faded either by the phases (item 10) or by the shows, never by both: two layers of the same picture would add up.
  const phased = bossLookPlan(boss)?.slots ?? []
  for (const slot of plan.slots)
    if (phased.some((other) => sameTexture(other, slot)))
      found.push({ path: ["boss"], message: `${textureName(slot, {})}已经由阶段的 model.glow 调亮调暗了，演出里不能再调同一张：演出换一张发光贴图（{"asset": 贴图资产的 id}），或者只在阶段里调它` })
  return found
}

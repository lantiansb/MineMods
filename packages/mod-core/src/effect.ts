import { SHORT_EFFECT_GUIDE } from "./combat-design-words"
import { z } from "zod"
import { ModelShapeSchema, type ModelDesign } from "@minemods/studio-ai/contracts"
import { paintModel, TEXTURE_SPACE_ERROR } from "@minemods/studio-ai/model-paint"
import { DEFAULT_TIER, tierOf, textureSizes } from "@minemods/studio-ai/budget"
import type { StandardOutline } from "@minemods/studio-ai/acceptance"
import { GAME_PIXELS, MOTION_VISIBLE, measureMotion, posedCorners, type MotionClip } from "@minemods/studio-ai/model-motion"
import { EFFECT_LIMITS, TICKS } from "./ability-words"
import { modelBounds } from "./model-bounds"
export { EFFECT_LIMITS } from "./ability-words"

/**
 * An effect (效果): something that appears in the world for a moment and is gone — a small model with motions
 * of its own, and how it lives: which motion it plays, for how long, whether it stays with whoever showed it,
 * which way it faces and how it is drawn. It knows no subject; what it looks like is the model its maker made.
 * This file is the document, its limits, the life of one effect as a pure function (what the generated
 * entity's tick does) and what can be measured on it. No Node APIs: the app's window reads it too.
 */

/** Model pixels in a block: the game draws a model at this scale. */
const BLOCK = 16
const Name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/)

export const EFFECT_FACINGS = { owner: "朝着放出它的那一方面朝的方向", target: "朝着目标", camera: "一直转过来对着看它的玩家（只绕竖直方向转）" } as const

/** How an effect lives. Times are seconds, rounded to a server tick (a twentieth of a second). */
export const EffectPlaySchema = z.strictObject({
  /** The motion of its own that plays from the moment it appears. One that does not loop holds its last pose until the effect is gone. */
  clip: Name,
  /** How long it exists. After that it is removed, wherever its motion is. */
  lifetime: z.number().finite().min(0.1).max(EFFECT_LIMITS.seconds),
  /** True: it keeps its place relative to whoever showed it, moving and turning with it. False: it stays where it appeared. */
  follow: z.boolean(),
  /** Which way its front (-Z) points: the way its owner faces, at the owner's target, or always turned toward each player's camera about the vertical axis. */
  facing: z.enum(["owner", "target", "camera"]),
  /** True: it is put down on the ground under where it appears (at most `EFFECT_LIMITS.fall` blocks lower). */
  on_ground: z.boolean(),
  /** True: it is gone the moment its owner dies or is removed, or the ability that showed it is cut short. False: it lives out its time. */
  ends_with_owner: z.boolean(),
  /** True: drawn at full brightness whatever the light around it. */
  bright: z.boolean(),
  /** 1 is solid; lower lets the world show through all of it evenly. */
  opacity: z.number().finite().min(0.2).max(1),
  /** 第 4 步: "additive" adds it to what is behind it at full brightness (fire, lightning, magic: it glows and black is see-through); left out or "normal", drawn as it always was. */
  blend: z.enum(["normal", "additive"]).optional(),
})
export type EffectPlay = z.infer<typeof EffectPlaySchema>

/**
 * The geometry tier every effect is held to: an effect's document names none (many are in the world at once, each one small), so it is the default
 * one (`budget.ts`), and the texture sizes it may name are that tier's, not every size a model could name. The schema offers exactly these.
 */
export const EFFECT_TIER = DEFAULT_TIER
export const EFFECT_TEXTURE_SIZES = textureSizes(EFFECT_TIER)
const largestTexture = Math.max(...EFFECT_TEXTURE_SIZES)

/**
 * What is said of a texture size an effect's tier does not offer: the sizes it does, the largest, and the two ways on for an effect that does not
 * fit (make it smaller, or one texel over several model pixels, as a model too large for its tier's largest texture does: `texel_size`).
 */
export const EFFECT_TEXTURE_REFUSAL = `效果的 texture_size 只能是 ${EFFECT_TEXTURE_SIZES.slice(0, -1).join("、")} 或 ${largestTexture}（效果按「${tierOf(EFFECT_TIER).name}」档算，最大的贴图是 ${largestTexture}×${largestTexture}，效果不能选更高的档）。所有的面排不进 ${largestTexture}×${largestTexture} 的大效果：把几何做小一些，或者写 texel_size: 2 或 4（一个贴图像素盖 2×2 或 4×4 个模型像素，贴图最大还是 ${largestTexture}）。`

/** The model's own fields, in a model document's own shapes, with an effect's smaller counts checked below. */
const design = {
  name: ModelShapeSchema.shape.name,
  texture_size: z.union(EFFECT_TEXTURE_SIZES.map((size) => z.literal(size)), { error: EFFECT_TEXTURE_REFUSAL }),
  /** One texel over 2×2 or 4×4 model pixels, exactly as a model writes it (`ModelShapeSchema`): the rule that it is only for what the largest texture cannot hold is the model's, and holds here through `effectModel`. */
  texel_size: ModelShapeSchema.shape.texel_size,
  bones: ModelShapeSchema.shape.bones,
  animations: z.array(ModelShapeSchema.shape.animations.element).min(1).max(EFFECT_LIMITS.clips),
}

export const EffectDocumentSchema = z.strictObject({ kind: z.literal("effect"), ...design, play: EffectPlaySchema }).superRefine((document, context) => {
  const cubes = document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)
  if (document.bones.length > EFFECT_LIMITS.bones) context.addIssue({ code: "custom", path: ["bones"], message: `一个效果最多 ${EFFECT_LIMITS.bones} 根骨骼，这里有 ${document.bones.length} 根` })
  if (cubes > EFFECT_LIMITS.cubes) context.addIssue({ code: "custom", path: ["bones"], message: `一个效果最多 ${EFFECT_LIMITS.cubes} 个方块，这里有 ${cubes} 个：同一时间会出现很多个效果，每个都要小` })
  if (!document.animations.some((animation) => animation.name === document.play.clip))
    context.addIssue({ code: "custom", path: ["play", "clip"], message: `play.clip 写的是 ${document.play.clip}，可是这个效果自己的动作里没有它（有：${document.animations.map((animation) => animation.name).join("、")}）` })
  // Everything a model document checks about its own structure (one root, parents that exist, keys in order) holds for an effect's model too.
  const parsed = ModelShapeSchema.safeParse(effectModel(document))
  if (!parsed.success) parsed.error.issues.forEach((issue) => context.addIssue({ ...issue, path: ["design", ...issue.path] }))
})
export type EffectDocument = z.infer<typeof EffectDocumentSchema>
type Shaped = Pick<EffectDocument, "name" | "texture_size" | "texel_size" | "bones" | "animations">

/**
 * An effect's model in a model document's shape, for everything that draws or compiles one: its own bones and its own
 * motions, nothing added. (Until round 17 a creature's three motions were added here as stillness, because the model
 * contract asked for them of every shape; whoever listed this model's motions then showed three an effect never has.)
 */
export function effectModel(document: Shaped): ModelDesign {
  // texel_size is carried only where the document writes it: an effect that does not is the same model, byte for byte, as before effects could.
  return { name: document.name, texture_size: document.texture_size, ...(document.texel_size == null ? {} : { texel_size: document.texel_size }), bones: document.bones, animations: document.animations }
}

/**
 * The motions of an effect that nothing plays: the game plays `play.clip` from the moment the effect appears and no
 * other (`fabric/effect.ts`: one row of the table an effect, one motion a row), and neither an ability's effect event
 * nor `spawnEffect` can name another. Whatever else it carries is only weight in the document and a choice on a
 * screen that does nothing in the game.
 */
export const effectUnplayed = (document: Pick<EffectDocument, "animations" | "play">) => document.animations.filter((animation) => animation.name !== document.play.clip).map((animation) => animation.name)

/** How the sentence about motions nothing plays starts. It is handed back with every look as something measured that has to be answered before the effect is called finished. */
export const EFFECT_UNPLAYED_MARK = "没有任何东西会播"

/** The same as a sentence for whoever makes it; null when every motion it has is the one it plays. */
export function effectUnplayedLine(document: Pick<EffectDocument, "animations" | "play">) {
  const names = effectUnplayed(document)
  return names.length ? `${EFFECT_UNPLAYED_MARK}的动作：这个效果有 ${document.animations.length} 个动作，游戏从它出现的那一刻起只播 play.clip 写的「${document.play.clip}」这一个，招式和玩法代码也指定不了别的；${names.map((name) => `「${name}」`).join("、")}在游戏里永远不会出现。把${names.length > 1 ? "它们" : "它"}从 animations 里去掉再看一版（想让它出现以后接着做别的，就写进「${document.play.clip}」这一个动作里）。` : null
}

/**
 * The picture an effect wears, as the build writes it (`textures/entity/<name>.png`): an effect's document holds no
 * image, its surface is written on its cubes and painted when it is compiled. Raw pixels, so the app's window can
 * show it without Node; `size` is the atlas the faces fit (the document's own, or the next size up, as the build
 * chooses), `islands` where each face sits. Null when the faces fit no atlas.
 */
export function effectTexture(document: Shaped) {
  const design = effectModel(document)
  const sizes = textureSizes(design.budget)
  for (const size of sizes.slice(Math.max(0, sizes.indexOf(design.texture_size)))) {
    try {
      const painted = paintModel({ ...design, texture_size: size })
      return { size: painted.size, pixels: painted.pixels, islands: painted.islands, glow: painted.glow }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== TEXTURE_SPACE_ERROR) throw error
    }
  }
  return null
}

/** The name an effect has in the generated mod's files and tables: its asset id without the dashes. */
export const effectName = (id: string) => `effect_${id.replaceAll("-", "")}`

// ---- its life ----

/** A lifetime as the server ticks it exists for: never none. */
export const effectTicks = (seconds: number) => Math.max(1, Math.round(seconds * TICKS))

/** The moment of its motion that shows when it has lived `seconds`: a loop goes round, anything else stops at its end and holds. */
export const effectMoment = (clip: Pick<MotionClip, "length" | "loop">, seconds: number) => (clip.loop ? seconds % clip.length : Math.min(seconds, clip.length))

/** How one kind of effect lives, as the generated tables hold it. */
export type EffectPlan = { ticks: number; follow: boolean; ends_with_owner: boolean }
export const effectPlan = (play: EffectPlay): EffectPlan => ({ ticks: effectTicks(play.lifetime), follow: play.follow, ends_with_owner: play.ends_with_owner })

/**
 * One server tick of one effect, as the generated `StudioEffect.tick` does it. `lived` is how many ticks it
 * has existed before this one. `owner`: it was shown without one, its owner is alive, or its owner died or
 * was removed. `cut`: the ability that showed it was cut short on this tick. In order: its time is up; then
 * what ends it with its owner; else it goes on, and follows when it is made to and has someone to follow.
 */
export function effectStep(plan: EffectPlan, lived: number, input: { owner: "none" | "alive" | "gone"; cut: boolean }) {
  const now = lived + 1
  const ended = now >= plan.ticks ? ("time" as const) : plan.ends_with_owner && input.cut ? ("cut" as const) : plan.ends_with_owner && input.owner === "gone" ? ("owner" as const) : null
  return { lived: now, ended, follows: ended === null && plan.follow && input.owner === "alive" }
}

// ---- what can be measured on it ----

type Vec = [number, number, number]
const num = (value: number, digits = 2) => Number(value.toFixed(digits))
const apart = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const box = (points: readonly Vec[]) => ({ min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]!))) as Vec, max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]!))) as Vec })

/** The motion an effect plays, cut to what its life shows of it. */
export function effectClip(document: Pick<EffectDocument, "animations" | "play">): MotionClip | null {
  const clip = document.animations.find((animation) => animation.name === document.play.clip)
  if (!clip) return null
  return clip.loop && document.play.lifetime >= clip.length ? clip : { ...clip, length: Math.min(clip.length, document.play.lifetime), loop: false }
}

/** Model pixels a part may lie under the base plane before it counts as under it: a cube built on the plane, or a hair below it, is not. */
const BASE_SLACK = 0.5

/** What of one pose stands above the base plane: each cube cut at y = 0, a cube wholly under it (or on it) left out. Eight corners a cube, in document order (`posedCorners`). */
function aboveBase(pose: readonly Vec[]): Vec[] {
  return Array.from({ length: Math.floor(pose.length / 8) }, (_, cube) => pose.slice(cube * 8, cube * 8 + 8)).flatMap((corners) =>
    Math.max(...corners.map((point) => point[1])) > BASE_SLACK ? corners.map((point): Vec => [point[0], Math.max(0, point[1]), point[2]]) : [],
  )
}

/**
 * An effect over its life, tick by tick, measured from the document alone (viewport space, model pixels):
 * - `poses`: every cube corner at each tick it exists (tick 0: the moment it appears);
 * - `peak`: the tick at which it is at its fullest: its box is largest then, and among ticks as large (within a
 *   model pixel) it is the one that differs most from how it appeared, by `change` model pixels;
 * - `size`: how wide, tall and deep it is when it appears, at its peak and on its last tick, in blocks, and `across`: corner to corner of its box at those three moments and at its largest;
 * - `base`: the same three sizes and corner-to-corner lengths of only the part that stands above the model's base plane (y = 0, the ground an effect on the ground stands on; a cube
 *   wholly under it is left out, one across it is cut there) and whether any part ever goes under it (`under`). A thing that rises out of the ground and sinks back keeps its geometry's size the
 *   whole time and still grows and shrinks to a player: the two are different measures and both are kept (broad21);
 * - `reach`: the furthest any corner ever gets from where the effect was put, in blocks;
 * - `motion`: how far anything travels, as every motion is measured, and whether that can be seen at game size.
 * Null when it has no such motion.
 */
export function effectMeasure(document: Pick<EffectDocument, "bones" | "animations" | "play">) {
  const full = document.animations.find((animation) => animation.name === document.play.clip)
  const played = effectClip(document)
  if (!full || !played) return null
  const ticks = effectTicks(document.play.lifetime)
  const poses = Array.from({ length: ticks + 1 }, (_, tick) => posedCorners(document, full, effectMoment(full, tick / TICKS)))
  const change = poses.map((pose) => Math.max(0, ...pose.map((point, corner) => apart(point, poses[0]![corner]!))))
  const across = poses.map((pose) => ((bounds) => apart(bounds.min, bounds.max))(box(pose)))
  // broad21: what stands above the base plane at each tick. A spike built under the ground that moves up out of it has the same box at every tick and is still seen to grow.
  const standing = poses.map(aboveBase)
  const high = standing.map((points) => (points.length ? ((bounds) => apart(bounds.min, bounds.max))(box(points)) : 0))
  const fullest = poses.map((_, tick) => tick).filter((tick) => across[tick]! >= Math.max(...across) - 1)
  // Among the ticks as large, the one that shows most above the ground, and among those the one that differs most from how it appeared.
  const shown = fullest.filter((tick) => high[tick]! >= Math.max(...fullest.map((at) => high[at]!)) - 1)
  const peak = shown.reduce((best, tick) => (change[tick]! > change[best]! ? tick : best))
  const size = (tick: number) => ((bounds) => bounds.max.map((value, axis) => num((value - bounds.min[axis]!) / BLOCK)) as Vec)(box(poses[tick]!))
  const sizeAbove = (tick: number): Vec => (standing[tick]!.length ? ((bounds) => bounds.max.map((value, axis) => num((value - bounds.min[axis]!) / BLOCK)) as Vec)(box(standing[tick]!)) : [0, 0, 0])
  const motion = measureMotion(document, played)
  return {
    ticks,
    clip: { name: full.name, length: full.length, loop: full.loop },
    poses,
    peak: { tick: peak, seconds: peak / TICKS, change: num(change[peak]!) },
    size: { first: size(0), peak: size(peak), last: size(ticks) },
    across: { first: num(across[0]! / BLOCK), peak: num(across[peak]! / BLOCK), last: num(across[ticks]! / BLOCK), most: num(Math.max(...across) / BLOCK) },
    base: {
      under: poses.some((pose) => pose.some((point) => point[1] < -BASE_SLACK)),
      size: { first: sizeAbove(0), peak: sizeAbove(peak), last: sizeAbove(ticks) },
      across: { first: num(high[0]! / BLOCK), peak: num(high[peak]! / BLOCK), last: num(high[ticks]! / BLOCK), most: num(Math.max(...high) / BLOCK) },
    },
    reach: num(poses.reduce((most, pose) => pose.reduce((far, point) => Math.max(far, Math.hypot(...point)), most), 0) / BLOCK),
    motion: { travel: motion.travel, game: motion.game, unseen: motion.unseen },
  }
}
export type EffectMeasure = NonNullable<ReturnType<typeof effectMeasure>>

/**
 * The room the pictures of an effect are taken in: the box (viewport space, model pixels) around everything it reaches over its life and in the pose it is built in. An effect grows and
 * moves past its built pose as a matter of course, so a picture framed on the built pose cuts it (broad21: a spike that rises out of the ground was a flat-topped column on its card).
 * Every picture of an effect — the frames, the cover, the card's — is shot in this room.
 */
export function effectRoom(document: EffectDocument) {
  const bounds = modelBounds(effectModel(document))
  const reached = [...(effectMeasure(document)?.poses.flat() ?? []), bounds.min, bounds.max] as Vec[]
  return { min: [0, 1, 2].map((axis) => Math.min(...reached.map((point) => point[axis]!))) as Vec, max: [0, 1, 2].map((axis) => Math.max(...reached.map((point) => point[axis]!))) as Vec }
}

/** How much of its largest size (corner to corner of its box) an effect must lack when it appears, or on its last tick, to be seen growing in or going out: under that it pops. */
export const EFFECT_POP = 0.2
const sized = (size: Vec) => `${size[0]}×${size[1]}×${size[2]} 格（宽×高×深）`

/**
 * How big an effect is when it appears, at its fullest and when it goes, and whether it comes and goes by growing and shrinking. broad21: one measure was not enough. The size of the whole
 * shape (`size`) says nothing of a thing that rises out of the ground and sinks back by moving: its shape is the same size the whole time and a player still sees it grow out and shrink away.
 * So when any part goes under the base plane the part that stands above it is given too (`base`), and a thing is said to pop only when neither measure shows it growing in or going out.
 */
function sizeLine(found: EffectMeasure, play: Pick<EffectDocument["play"], "on_ground">, unseen: boolean) {
  const grown = (across: EffectMeasure["across"]) => ({ in: across.first <= across.most * (1 - EFFECT_POP), out: across.last <= across.most * (1 - EFFECT_POP) })
  const whole = grown(found.across)
  const above = found.base.under ? grown(found.base.across) : whole
  const popsIn = !whole.in && !above.in
  const popsOut = !whole.out && !above.out
  const sizes = (size: EffectMeasure["size"]) => `出现的那一刻 ${sized(size.first)}，最完整的时候 ${sized(size.peak)}，消失前的最后一刻 ${sized(size.last)}`
  return [
    `大小：${sizes(found.size)}。`,
    found.base.under
      ? `其中${play.on_ground ? "露在地面上" : "高出它底面"}的部分：${sizes(found.base.size)}。整个形状的大小${whole.in || whole.out ? "也在变" : "从头到尾差不多不变，它升起、缩回靠的是位置在动，不是在变大变小"}。`
      : "",
    // Nothing moves at all: it appears whole and goes whole. Something moves but not in size (turning, sliding): said as that, not as "no growing".
    popsIn ? (unseen ? "它一出现就是差不多完整的大小，没有长出来的过程。" : "它出现时就是完整的大小，不是从小变大出来的（变的是位置或角度）。") : "",
    popsOut ? (unseen ? "消失的那一刻它还是差不多完整的大小，会是一下子不见。" : "消失前它还是完整的大小，不是缩小着消失的（变的是位置或角度）。") : "",
  ].join("")
}

/** The sentences of `effectLines` that say a defect of how an effect comes, goes or moves, to be picked out of them (the card shows only these). */
export const EFFECT_FLAW_LINE = /看不出任何变化|没有长出来的过程|一下子不见|不是从小变大出来的|不是缩小着消失的|还没播完/

/** What was measured on one effect, in sentences: said with every look at it, to whoever makes it and whoever reviews it. Never a refusal. */
export function effectLines(document: Pick<EffectDocument, "bones" | "animations" | "play">) {
  const found = effectMeasure(document)
  if (!found) return [`这个效果要播的动作「${document.play.clip}」它自己没有，量不了。`]
  const play = document.play
  const life = found.ticks / TICKS
  const cubes = document.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)
  return [
    `它存在 ${num(life)} 秒（${found.ticks} 刻），从出现的那一刻起播动作「${found.clip.name}」（${num(found.clip.length)} 秒，${found.clip.loop ? "循环" : "不循环"}）。${
      found.clip.loop
        ? ""
        : found.clip.length > life + 1 / TICKS / 2
          ? `动作还没播完它就消失了：最后 ${num(found.clip.length - life)} 秒玩家看不到。`
          : found.clip.length < life - 1 / TICKS / 2
            ? `动作播完以后，它保持最后的样子 ${num(life - found.clip.length)} 秒才消失。`
            : "动作播完它正好消失。"
    }`,
    found.motion.unseen
      ? `它从出现到消失看不出任何变化：在游戏里那么大的画面上只走了约 ${found.motion.game} 个屏幕像素（不到 ${MOTION_VISIBLE.pixels} 个就看不出来）。玩家看到的是一个突然出现、一动不动、又突然不见的东西。`
      : `它从出现到消失，在游戏里那么大的画面上变化了约 ${found.motion.game} 个屏幕像素（模型里 ${found.motion.travel} 个像素），看得出在变；它最完整的时候是出现后第 ${num(found.peak.seconds)} 秒。`,
    sizeLine(found, play, found.motion.unseen),
    `它有 ${cubes} 个方块（一个效果最多 ${EFFECT_LIMITS.cubes} 个）。${play.follow ? "它跟着放出它的那一方移动和转向" : "它留在出现的地方"}，${EFFECT_FACINGS[play.facing]}${play.on_ground ? "，贴在脚下的地面上" : ""}；${play.ends_with_owner ? "放出它的那一方死了，或者那一招被打断，它立刻消失" : "放出它的那一方死了或者那一招被打断，它照样留到时间结束"}。${play.bright ? "不受周围明暗影响，一直是最亮的。" : ""}${play.opacity < 1 ? `整个是半透明的（不透明度 ${num(play.opacity)}）。` : ""}${play.blend === "additive" ? "整个发光叠加在后面的东西上（越黑越透明，越亮越亮）。" : ""}`,
  ]
}

/** One screen pixel count for a reader of the measure above. */
export const EFFECT_GAME_PIXELS = GAME_PIXELS

// ---- the standard, and what an AI is told ----

/**
 * An effect against the acceptance standard. Nothing about it is refused by a measurement: what it must be
 * is settled by its document's own limits, and whether it is good is seen, by whoever makes it and by the
 * reviewer, in the pictures and the measured facts every look brings.
 */
export const EFFECT_STANDARD: StandardOutline = {
  kind: "effect",
  label: "效果",
  rules: [],
  unmeasured: {
    earns_place: "一个效果该有多少东西量不了；它看不看得出变化是量出来告诉你的事实",
    not_mechanical: "一个效果的节奏好不好量不了，对着逐帧图自己看",
    reads: "它像不像要表现的东西量不了，由人自己看",
    hierarchy: "不知道一个效果里哪里该是重点，量不了主次",
    sound: "效果可以悬空、可以穿过别的东西，站不站得住对它不适用",
    fits: "它和用它的招式对不对得上，在看那只生物的招式时量，不在这里",
  },
  told: {
    earns_place: "它存在多久、从出现到消失在游戏里那么大的画面上变化了多少、出现和消失的那一刻各有多大（一出现就是完整大小、或者消失时还是完整大小，都会说出来）",
    fits: "不循环的动作有没有在它消失之前播完，播完以后又停了多久",
  },
}

/** What an AI is told about making an effect. One text: the registry, the hand-off and the capability list read it. */
export const EFFECT_INSTRUCTIONS =
  SHORT_EFFECT_GUIDE.trimStart() + " " +
  `效果是在世界里出现一下就消失的东西：一个小模型带着它自己的动作，由生物的招式在某一刻放出来，或者由玩法代码放出来。它不是生物：没有血、没有 AI、碰不到也打不到、不挡路、不存盘（区块卸载或者退出世界它就没了），时间一到自己消失。它只给人看，从不对谁做任何事：谁受伤由招式的 hits 在服务端判定，和效果画在哪里无关。` +
  ` 文档：{kind:"effect", name, texture_size, texel_size, bones, animations, play}（texel_size 可以不写）。name、texture_size、texel_size、bones、animations 和模型文档的写法完全一样（骨骼、方块、表面的 faces / paint / features，动作的 rotation、position、scale 轨道和插值都能用），区别只有三点：不需要 idle、walk、hurt，也不要写它们——那是生物的模型才有的三个动作，效果没有待机、走路和挨打；动作只写它要播的那一个，名字自己起（游戏只播 play.clip 这一个，写了别的，没有任何东西会播它，look 会把它列为要去掉的）；最多 ${EFFECT_LIMITS.bones} 根骨骼、${EFFECT_LIMITS.cubes} 个方块——同一时间会有很多个效果在场，每一个都要小。原点 (0,0,0) 是它被放下的那个点（贴地的效果就是地面上的那一点），正面朝 -Z；模型围着原点做。` +
  ` 贴图：效果都按「${tierOf(EFFECT_TIER).name}」档算，texture_size 只能是 ${EFFECT_TEXTURE_SIZES.join("、")}（最大 ${largestTexture}×${largestTexture}，效果选不了更高的档）。贴图要多大只看所有的面排不排得下：构建时会从你写的大小往上找第一张排得下的，${largestTexture}×${largestTexture} 也排不下，这一版就造不出来——保存和 look 都会用构建会说的那句话告诉你，不用等到构建。一个大效果排不下：把几何做小一些，或者写 texel_size: 2 或 4（一个贴图像素盖 2×2 或 4×4 个模型像素，面上的色块、特征、surface_details 都改按贴图像素算，每个面能画的细节少到四分之一或十六分之一）；只有 ${largestTexture}×${largestTexture} 也放不下的效果才能用，排得下的写了会被拒绝并告诉你该写几，不要为了省事写。不要靠把几何做成一半再用根骨骼 scale 放大来绕。` +
  ` play 是它怎么活：{clip, lifetime, follow, facing, on_ground, ends_with_owner, bright, opacity, blend}。clip 是它出现的那一刻起播的动作（游戏里只播这一个；不循环的动作播完以后保持最后的样子直到消失）。lifetime 是它存在多少秒（0.1 到 ${EFFECT_LIMITS.seconds}，游戏按 0.05 秒一刻取整），到时间就没了，不管动作播到哪里。follow=true 表示它跟着放出它的那一方移动和转向，false 表示留在出现的地方。facing 是正面朝哪里：owner（放出它的那一方面朝的方向）、target（朝着目标）、camera（一直转过来对着看它的玩家，只绕竖直方向转）。on_ground=true 表示把它放到出现位置正下方的地面上（最多往下找 ${EFFECT_LIMITS.fall} 格）。ends_with_owner=true 表示放出它的那一方死了、或者那一招被打断，它立刻消失；false 表示照样留到时间结束。bright=true 表示不受周围明暗影响、一直最亮。opacity 是不透明度：1 是实心，小于 1 时整个均匀地半透明（0.2 到 1）。blend（可以不写）写 "additive" 时整个效果发光叠加在后面的东西上：亮的地方更亮、黑的地方透明，自己会发光的东西这样画（这时 opacity 没有用，颜色越暗越淡）；不写或 "normal" 是普通的画法。扔出去的投射物用这个效果当样子时也一样发光。表面 features 里的 glow 照样有效。` +
  ` 好的效果有“出现、最完整、消失”的过程：用 scale 轨道让它从小变大再缩小，或者用 position 轨道让它从地面以下升出来再沉回去（两样都算长出来、收掉），不要一下子冒出来又一下子不见；寿命要长到看得清（0.3 秒以上）；它要标出招式打到的地方时，大小和位置要和那一次出手的判定范围一致。` +
  ` 怎么看：对效果任务调用 look，会画出六个角度、它的动作逐帧（最后一格把差得最多的两刻叠在一起），并说出量到的事实：存在多久、看不看得出变化、出现和消失的那一刻各有多大。它被招式用到以后，对那只生物的任务调用 look，会把它画在招式里它该在的位置上。` +
  ` 怎么用：生物文档的 abilities[].events 里写 {type:"effect", at, effect:"这个效果的资产 id", where, hit, along, forward, up, left, count, layout, spread}，并让生物任务依赖这个效果（along 写 aim 时它顺着那次出手瞄的方向摆，整个跟着一起倾斜：模型的正面 -Z 就是那个方向，所以沿着一条线伸出去的效果要朝 -Z 做；贴地的和一直对着玩家的不倾斜）；玩法代码里调用 ProjectContent.spawnEffect("这个效果的资产 id", world, pos, yaw) 或者再加一个 owner 参数，并把它列进 uses。同一只生物身边同时最多 ${EFFECT_LIMITS.alive} 个效果，多出来的不会出现。` +
  ` 效果做不到的（要写玩法代码）：改变地形、放方块或者破坏方块、屏幕上的遮罩和文字、界面、让谁受伤或者带上状态、发出声音（声音用招式的 sound 事件）、沿着路线飞或者追人（它只会留在原地，或者跟着放出它的那一方）、按条件变成别的样子。`

export const EFFECT_SUMMARY = `在世界里出现一下就消失的小模型：和模型文档一样的骨骼、方块、表面和动作（只有它自己播的那一个动作，没有生物的 idle/walk/hurt；最多 ${EFFECT_LIMITS.bones} 根骨骼、${EFFECT_LIMITS.cubes} 个方块；贴图最大 ${largestTexture}，更大的效果可以写 texel_size），加上 play——播哪个动作、存在几秒、跟不跟着放出它的那一方、正面朝哪里、贴不贴地、会不会随那一招被打断而消失、是否最亮、是否半透明。由生物招式的 effect 事件或玩法代码的 ProjectContent.spawnEffect 放出来；只给人看，不伤人，不存盘。`

import { z } from "zod"
import { previewPng } from "./preview-png"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { GESTURE_BASE_IDS, gestureBase, type GestureBase, type GestureHand } from "./gesture-bases"
import { holdFor, judge, unreadable, type AssetReview, type ReviewContext } from "@minemods/studio-ai/acceptance"
import { GESTURE_STANDARD, measureGesture } from "./gesture-gate"
import { gestureTicks, gestureTimeline, mirrorGestureMotion, retimeGestureMotion, type GestureKey, type GestureMotion, type GesturePhase, type GestureTimeline } from "./gesture-motion"
import { GESTURE_ADJUST, GESTURE_BONES, GESTURE_EASINGS, GESTURE_FORMAT, GESTURE_KEYFRAMES, GESTURE_KEYS, GESTURE_TICK, GESTURE_TIMING, GESTURE_VIEW, type GestureBone } from "./gesture-rig"

// No Node APIs in this file: the app's window imports the preview functions directly.

// Not `multipleOf`: binary fractions make 0.15 fail it, here and in every JSON Schema validator.
const onTick = (seconds: number) => Math.abs(seconds / GESTURE_TICK - gestureTicks(seconds)) < 1e-6
const seconds = (range: { min: number; max: number }) => z.number().min(range.min).max(range.max).refine(onTick, "时间必须是 0.05 秒（一个游戏刻）的整数倍").describe("Seconds, a multiple of 0.05")
const axis = (range: readonly [number, number]) => z.number().min(range[0]).max(range[1])
const keys = (limits: GestureBone["rotation"]) =>
  z
    .array(
      z.strictObject({
        time: z.number().gt(0).max(GESTURE_TIMING.hold_cycle.max).refine(onTick, "时间必须是 0.05 秒（一个游戏刻）的整数倍").describe("Seconds from the start of this phase, a multiple of 0.05"),
        value: z.tuple([axis(limits.x), axis(limits.y), axis(limits.z)]),
        easing: z.enum(GESTURE_EASINGS),
      }),
    )
    .min(1)
    .max(GESTURE_KEYFRAMES.max)
    .optional()
// Bones are keys of a strict object, so an invented bone is a schema error and no bone can appear twice.
const Bones = z.strictObject(Object.fromEntries(GESTURE_BONES.map((bone) => [bone.name, z.strictObject({ rotation: keys(bone.rotation), position: keys(bone.position) }).optional()])))
const phase = (range: { min: number; max: number }) => z.strictObject({ length: seconds(range), bones: Bones })

/**
 * How a cast action starts. A tagged union so "played by a skill, held while it charges" can be added as
 * another member later without touching documents that are already saved. Today the only way is a key press.
 */
export const GestureTriggerSchema = z.discriminatedUnion("type", [z.strictObject({ type: z.literal("key"), key: z.enum(GESTURE_KEYS) })], {
  error: '触发方式只有按键一种，写成 { "type": "key", "key": "g" } 这样；要让技能来播它，在技能（ability）的 gesture 或 bindings 里写这个施法动作',
})

const LEGACY = "这是旧格式（格式 1）的手势，带第一人称方块手和 hand_color。那套做法已经取消，旧文档不能直接使用：请改成施法动作（format 2）——选一个基础动作写在 base 里，或者按新格式写 custom 轨道。"
const legacyKeys = ["hand_color", "length", "third_person"]
// Saved by a newer Studio: said as it is, never read as if it were this format.
const newer = (format: number) => `这个文档是 format ${format}，比这个版本认识的 format ${GESTURE_FORMAT} 新，应该是更新版本的 Studio 保存的。请升级 Studio 后再打开；这里不会去猜它的内容`

const Shape = z.strictObject(
  {
    kind: z.literal("gesture"),
    format: z.literal(GESTURE_FORMAT, { error: (issue) => (typeof issue.input === "number" && issue.input > GESTURE_FORMAT ? newer(issue.input) : LEGACY) }),
    name: z.string().trim().min(1).max(40),
    english_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 '-]{0,39}$/),
    trigger: GestureTriggerSchema,
    base: z.enum(GESTURE_BASE_IDS).optional().describe("Id of a built-in base motion. The default way to make a cast action."),
    speed: z.number().min(GESTURE_ADJUST.speed.min).max(GESTURE_ADJUST.speed.max).optional(),
    strength: z.number().min(GESTURE_ADJUST.strength.min).max(GESTURE_ADJUST.strength.max).optional(),
    hand: z.enum(["right", "left", "both"]).optional(),
    hold_seconds: seconds(GESTURE_TIMING.hold).optional(),
    custom: z
      .strictObject({ windup: phase(GESTURE_TIMING.windup), hold: phase(GESTURE_TIMING.hold_cycle).extend({ loop: z.boolean() }).nullable(), release: phase(GESTURE_TIMING.release) })
      .optional()
      .describe("Own tracks instead of a base. Only when no base fits; held to the acceptance standard like any AI work."),
    aim: z.boolean().default(true),
    mirror_for_left_handed: z.boolean().default(true),
    first_person: z.strictObject({ arms: z.boolean(), items: z.boolean() }).default({ arms: true, items: true }),
  },
  { error: (issue) => (issue.code === "unrecognized_keys" && issue.keys.some((key) => legacyKeys.includes(key)) ? LEGACY : undefined) },
)
type Shaped = z.infer<typeof Shape>
type Problem = { path: (string | number)[]; message: string }

// What the field types cannot say: one source of motion, a hand the base has, keys inside their phase, a loop that closes.
function structure(gesture: Shaped): Problem[] {
  if ((gesture.base === undefined) === (gesture.custom === undefined)) return [{ path: [gesture.base === undefined ? "base" : "custom"], message: "base 和 custom 必须写且只能写一个：custom 是自己写轨道，base 是拿一个内置基础动作来调" }]
  const base = gesture.base === undefined ? null : gestureBase(gesture.base)!
  if (base)
    return gesture.hand === undefined || base.hands.includes(gesture.hand)
      ? []
      : [{ path: ["hand"], message: `基础动作「${base.name}」是${base.hands.includes("both") ? "双手动作，hand 只能写 both" : "单手动作，hand 只能写 right 或 left"}` }]
  const custom = gesture.custom!
  const stray = (["speed", "strength", "hand"] as const).filter((name) => gesture[name] !== undefined).map((name) => ({ path: [name], message: `${name} 只能和 base 一起用；自定义轨道请直接改关键帧` }))
  const phases = (["windup", "hold", "release"] as const).flatMap((name) => (custom[name] ? [{ name, value: custom[name]! }] : []))
  const tracks = phases.flatMap((entry) =>
    Object.entries(entry.value.bones).flatMap(([bone, channels]) =>
      (["rotation", "position"] as const).flatMap((channel) => (channels?.[channel] ? [{ path: ["custom", entry.name, "bones", bone, channel], keys: channels[channel]!, length: entry.value.length }] : [])),
    ),
  )
  return [
    ...stray,
    ...tracks.filter((track) => track.keys.some((frame, index) => index > 0 && gestureTicks(frame.time) <= gestureTicks(track.keys[index - 1]!.time))).map((track) => ({ path: track.path, message: "关键帧的时间必须一个比一个晚" })),
    ...tracks.filter((track) => gestureTicks(track.keys.at(-1)!.time) > gestureTicks(track.length)).map((track) => ({ path: track.path, message: "关键帧的时间不能超过这一段的 length" })),
  ]
}

const toMotion = (custom: NonNullable<Shaped["custom"]>): GestureMotion => {
  const convert = (value: { length: number; bones: z.infer<typeof Bones> }): GesturePhase => ({
    ticks: gestureTicks(value.length),
    bones: Object.fromEntries(
      Object.entries(value.bones).flatMap(([bone, channels]) => {
        const track = (list?: { time: number; value: number[]; easing: GestureKey["easing"] }[]) => list?.map((frame) => ({ tick: gestureTicks(frame.time), value: frame.value as GestureKey["value"], easing: frame.easing }))
        return channels ? [[bone, { ...(channels.rotation ? { rotation: track(channels.rotation) } : {}), ...(channels.position ? { position: track(channels.position) } : {}) }]] : []
      }),
    ),
  })
  return { windup: convert(custom.windup), hold: custom.hold ? { ...convert(custom.hold), loop: custom.hold.loop } : null, release: convert(custom.release) }
}

export type GestureResolved = {
  base: GestureBase | null
  hand: GestureHand | null
  speed: number
  strength: number
  /** Ticks a key press stays in the hold phase: `hold_seconds`, rounded to whole cycles when the hold loops. */
  hold_ticks: number
  /** The motion as it will play: base built at its strength, mirrored for the left hand, retimed. Times in ticks. */
  motion: GestureMotion
  timeline: GestureTimeline
}

function resolve(gesture: Shaped): GestureResolved {
  const base = gesture.base === undefined ? null : gestureBase(gesture.base)!
  const hand = base ? (gesture.hand ?? base.hands[0]!) : null
  const built = base ? base.motion(gesture.strength ?? 1) : toMotion(gesture.custom!)
  const motion = retimeGestureMotion(hand === "left" ? mirrorGestureMotion(built) : built, gesture.speed ?? 1)
  const asked = gestureTicks(gesture.hold_seconds ?? base?.hold_seconds ?? 0)
  const cycle = motion.hold?.loop ? motion.hold.ticks : 0
  // A looping hold is played in whole cycles, so the release always starts from the pose it was written for.
  const cycles = cycle && asked ? Math.max(1, Math.min(Math.round(asked / cycle), Math.floor(gestureTicks(GESTURE_TIMING.hold.max) / cycle))) : 0
  const hold_ticks = cycle ? cycles * cycle : asked
  return { base, hand, speed: gesture.speed ?? 1, strength: gesture.strength ?? 1, hold_ticks, motion, timeline: gestureTimeline(motion, hold_ticks) }
}

// A loop that does not end where it began would jump once per cycle for as long as the hold lasts.
function open(motion: GestureMotion): Problem[] {
  if (!motion.hold?.loop) return []
  const ready = gestureTimeline({ ...motion, hold: null }, 0)
  const start = ready.local[ready.ticks.windup]!
  return Object.entries(motion.hold.bones).flatMap(([bone, channels]) =>
    (["rotation", "position"] as const).flatMap((channel) => {
      const last = channels[channel]?.at(-1)
      if (!last) return []
      const from = start[bone as keyof typeof start][channel]
      return last.tick === motion.hold!.ticks && last.value.every((value, index) => Math.abs(value - from[index]!) < 0.01)
        ? []
        : [{ path: ["custom", "hold", "bones", bone, channel], message: "循环蓄力（loop: true）的最后一个关键帧必须正好在这一段的结尾，并且回到这一段开始时的姿势，否则每循环一次都会跳一下" }]
    }),
  )
}

/**
 * A cast action that is well-formed and can be played. The schema says nothing about how good the motion
 * is: that is the acceptance standard's job (`reviewGesture`), applied where AI work is handed in, so a
 * person's own edit is never refused for style.
 */
export const GestureDocumentSchema = Shape.check((context) => {
  // A field already out of range is reported by itself.
  if (context.issues.length) return
  const report = (problem: Problem) => context.issues.push({ code: "custom", input: context.value, path: problem.path, message: problem.message })
  const problems = structure(context.value)
  problems.forEach(report)
  if (!problems.length) open(resolve(context.value).motion).forEach(report)
})
export type GestureDocument = z.infer<typeof GestureDocumentSchema>

/** A document that can be played, whatever the acceptance standard thinks of it. Throws when it is malformed. */
function playable(input: unknown) {
  const document = Shape.parse(input)
  const problems = structure(document)
  if (problems.length) throw new Error(problems.map((problem) => `${problem.path.join(".")}: ${problem.message}`).join("; "))
  const resolved = resolve(document)
  const loose = open(resolved.motion)
  if (loose.length) throw new Error(loose.map((problem) => `${problem.path.join(".")}: ${problem.message}`).join("; "))
  return { document, resolved }
}

/** The motion a document plays, resolved tick by tick. Throws on a malformed document; does not judge it. */
export function resolveGesture(input: unknown) {
  return playable(input).resolved
}

/**
 * The acceptance review of a cast action: the motion as it will play, measured and judged by the shared
 * standard. A document too broken to play is unreadable — refused with the place that is wrong, before
 * any criterion applies.
 */
export function reviewGesture(input: unknown, context: ReviewContext = {}, hold = holdFor(context, null)): AssetReview {
  const shaped = Shape.safeParse(input)
  if (!shaped.success) {
    if (shaped.error.issues.some((issue) => issue.message === LEGACY)) return unreadable(GESTURE_STANDARD, "这是旧格式（格式 1）的手势，带第一人称方块手和 hand_color，那套做法已经取消。", "改成施法动作（format 2）：选一个基础动作写在 base 里，或者按新格式写 custom 轨道。")
    return unreadable(GESTURE_STANDARD, `文档格式不对：${shaped.error.issues.map((issue) => `${issue.path.join(".") || "文档"}：${issue.message}`).join("；")}。`, "按施法动作的格式把这些地方改对。")
  }
  const problems = structure(shaped.data)
  const resolved = problems.length ? null : resolve(shaped.data)
  const broken = resolved ? open(resolved.motion) : problems
  if (!resolved || broken.length) return unreadable(GESTURE_STANDARD, `文档格式不对：${broken.map((problem) => `${problem.path.join(".")}：${problem.message}`).join("；")}。`, "按施法动作的格式把这些地方改对。")
  return judge(GESTURE_STANDARD, measureGesture(resolved.motion, resolved.timeline), context, hold)
}

type Face = "north" | "east" | "south" | "west" | "up" | "down"
const FACES: Face[] = ["north", "east", "south", "west", "up", "down"]
// Where each face of a box sits on the skin, in the usual strip: top and bottom above, then the four sides.
const faceRect = (box: GestureBone["box"], face: Face) => {
  const [width, height, depth] = box.size
  const [u, v] = box.uv
  if (face === "up") return { x: u + depth, y: v, w: width, h: depth }
  if (face === "down") return { x: u + depth + width, y: v, w: width, h: depth }
  if (face === "west") return { x: u, y: v + depth, w: depth, h: height }
  if (face === "north") return { x: u + depth, y: v + depth, w: width, h: height }
  if (face === "east") return { x: u + depth + width, y: v + depth, w: depth, h: height }
  return { x: u + depth + width + depth, y: v + depth, w: width, h: height }
}

const SKIN = {
  skin: "#dfa678",
  skinShade: "#c48a5f",
  hair: "#3b2c4c",
  hairLight: "#57436e",
  eyeWhite: "#f3f1ea",
  iris: "#2a7d8c",
  mouth: "#9c5547",
  robe: "#2d6b86",
  robeDark: "#235369",
  trim: "#e6bf58",
  sash: "#a9302a",
  trousers: "#393d5a",
  shoe: "#5b3d2b",
  sole: "#2b2a31",
} as const
type Tone = keyof typeof SKIN

// The figure's default look, painted here pixel by pixel: a caster in a blue robe with a gold trim and a red
// sash. It is this product's own drawing, not a copy of any game skin.
function paint(bone: GestureBone, face: Face, x: number, y: number, w: number): Tone {
  if (bone.name === "head") {
    if (face === "up") return (x + y) % 5 === 0 ? "hairLight" : "hair"
    if (face === "down") return "skinShade"
    if (face === "south") return y < 7 ? (x === 2 || x === 5 ? "hairLight" : "hair") : "skinShade"
    if (face !== "north") return y < 3 || (y < 6 && (face === "west" ? x < 5 : x > 2)) ? (y === 2 ? "hairLight" : "hair") : "skin"
    if (y < 2 || (y === 2 && (x === 0 || x === 7 || x === 3))) return y === 1 && x % 3 === 1 ? "hairLight" : "hair"
    if (y === 4 && (x === 1 || x === 6)) return "eyeWhite"
    if (y === 4 && (x === 2 || x === 5)) return "iris"
    if (y === 3 && (x === 1 || x === 2 || x === 5 || x === 6)) return "hair"
    if (y === 6 && (x === 3 || x === 4)) return "mouth"
    return y === 7 || (y === 5 && (x === 3 || x === 4)) ? "skinShade" : "skin"
  }
  if (bone.name === "torso") {
    if (face === "up") return "robe"
    if (face === "down") return "trousers"
    if (y === 8 || y === 9) return face === "north" && (x === 3 || x === 4) ? "trim" : "sash"
    if (y === 11) return "trim"
    if (face === "north" && y < 3 && Math.abs(x - 3.5) < 1.5 - y * 0.5 + 0.5) return y < 2 && Math.abs(x - 3.5) < 1 ? "skin" : "trim"
    return (face === "north" || face === "south") && (x === 0 || x === w - 1) ? "robeDark" : "robe"
  }
  if (bone.name.endsWith("arm")) {
    if (face === "up") return "robe"
    if (face === "down") return "skinShade"
    if (y === 8) return "trim"
    return y > 8 ? (y === 11 ? "skinShade" : "skin") : y === 0 ? "robeDark" : "robe"
  }
  if (face === "down" || y === 11) return face === "up" ? "trousers" : "sole"
  if (face === "up") return "trousers"
  return y > 8 ? "shoe" : y === 0 ? "robeDark" : "trousers"
}

function skin() {
  const pixels = new Uint8Array(64 * 64 * 4)
  GESTURE_BONES.forEach((bone) =>
    FACES.forEach((face) => {
      const rect = faceRect(bone.box, face)
      for (let y = 0; y < rect.h; y++)
        for (let x = 0; x < rect.w; x++) {
          const color = SKIN[paint(bone, face, x, y, rect.w)]
          // A little grain so large areas do not read as flat fills; the same every time.
          const grain = (((rect.x + x) * 7 + (rect.y + y) * 13 + ((rect.x + x) ^ (rect.y + y)) * 5) % 5) * 3 - 6
          pixels.set([...[1, 3, 5].map((offset) => Math.max(0, Math.min(255, Number.parseInt(color.slice(offset, offset + 2), 16) + grain))), 255], ((rect.y + y) * 64 + rect.x + x) * 4)
        }
    }),
  )
  return pixels
}

const round = (value: number) => Number(value.toFixed(3))
/** Integer object keys are reordered by JSON.stringify; the viewport reads keyframes in written order, so 1 is written "1.0". */
const timeKey = (time: number) => (Number.isInteger(time) ? `${time}.0` : String(time))
const PHASE_LABEL = { windup: "起手", hold: "蓄力", release: "出手", recover: "收回" } as const

/** Parts of the figure a first-person view leaves out: the game hides them and shows only the player's own arms. */
const HIDDEN_IN_FIRST_PERSON = ["head", "torso", "right_leg", "left_leg"]
/** Eye height above the feet in the figure's own pixels (the neck is 24 up). */
const EYE = 24 + GESTURE_VIEW.eye_above_neck

function figure(identifier: string, input: unknown, loop: boolean, hidden: (document: GestureDocument) => string[]) {
  const { document, resolved } = playable(input)
  const timeline = resolved.timeline
  const length = round((timeline.frames.length - 1) * GESTURE_TICK)
  // The torso is listed by its waist in the rig but drawn, like in the game, as a part that turns at the neck.
  const parts = GESTURE_BONES.map((bone) => ({ bone, pivot: bone.name === "torso" ? ([0, 0, 0] as const) : bone.pivot, from: bone.name === "torso" ? ([bone.box.from[0], 0, bone.box.from[2]] as const) : bone.box.from }))
  // Model space counts y down from the neck; the viewport's geometry counts it up from the feet.
  const up = (pivot: readonly number[]): [number, number, number] => [pivot[0]!, 24 - pivot[1]!, pivot[2]!]
  const cubes = (part: (typeof parts)[number]) =>
    hidden(document).includes(part.bone.name) ? [] : [{ origin: [part.pivot[0] + part.from[0], 24 - (part.pivot[1] + part.from[1] + part.bone.box.size[1]), part.pivot[2] + part.from[2]].map(round) as [number, number, number], size: [...part.bone.box.size] as [number, number, number] }]
  const tracks = parts.map((part) => ({
    bone: part.bone.name,
    rotation: timeline.frames.map((frame, tick) => ({ time: round(tick * GESTURE_TICK), value: frame[part.bone.name].rotation.map(round) as [number, number, number] })),
    position: timeline.frames.map((frame, tick) => ({ time: round(tick * GESTURE_TICK), value: [round(frame[part.bone.name].position[0]), round(-frame[part.bone.name].position[1]), round(frame[part.bone.name].position[2])] as [number, number, number] })),
  }))
  const design: ModelDesign = {
    name: document.name,
    texture_size: 64,
    bones: [
      // A box of no size at the feet keeps the ground under the figure when only the arms are drawn.
      { name: "player", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "feet", origin: [0, 0, 0], size: [0, 0, 0], faces: Object.fromEntries(FACES.map((face) => [face, SKIN.sole])) as Record<Face, string>, surface_details: [] }] },
      ...parts.map((part) => ({
        name: part.bone.name,
        parent: "player",
        pivot: up(part.pivot),
        rotation: [0, 0, 0] as [number, number, number],
        cubes: cubes(part).map((cube) => ({ name: part.bone.name, ...cube, faces: Object.fromEntries(FACES.map((face) => [face, SKIN[paint(part.bone, face, 1, 5, 4)]])) as Record<Face, string>, surface_details: [] })),
      })),
    ],
    animations: [{ name: "gesture", length, loop, channels: tracks.map((track) => ({ bone: track.bone, keyframes: track.rotation.map((frame) => ({ time: frame.time, rotation: frame.value })) })) }],
  }
  const starts = { windup: 0, hold: timeline.ticks.windup, release: timeline.ticks.windup + timeline.ticks.hold, recover: timeline.ticks.windup + timeline.ticks.hold + timeline.ticks.release }
  return {
    /** Display only: not a model that can be saved. */
    design,
    geometry: {
      format_version: "1.12.0",
      "minecraft:geometry": [
        {
          description: { identifier: `geometry.${identifier}`, texture_width: 64 as const, texture_height: 64 as const, visible_bounds_width: 8, visible_bounds_height: 8, visible_bounds_offset: [0, 1, 0] },
          bones: [
            { name: "player", pivot: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], cubes: [{ origin: [0, 0, 0] as [number, number, number], size: [0, 0, 0] as [number, number, number], uv: Object.fromEntries(FACES.map((face) => [face, { uv: [0, 0], uv_size: [0, 0] }])) as Record<Face, { uv: number[]; uv_size: number[] }> }] },
            ...parts.map((part) => ({
              name: part.bone.name,
              parent: "player",
              pivot: up(part.pivot),
              rotation: [0, 0, 0] as [number, number, number],
              cubes: cubes(part).map((cube) => ({
                ...cube,
                uv: Object.fromEntries(FACES.map((face) => [face, ((rect) => ({ uv: [rect.x, rect.y], uv_size: [rect.w, rect.h] }))(faceRect(part.bone.box, face))])) as Record<Face, { uv: number[]; uv_size: number[] }>,
              })),
            })),
          ],
        },
      ],
    },
    textureDataUrl: `data:image/png;base64,${btoa(String.fromCharCode(...previewPng(skin(), 64)))}`,
    animation: {
      format_version: "1.8.0",
      animations: {
        [`animation.${identifier}.gesture`]: {
          loop,
          animation_length: length,
          bones: Object.fromEntries(
            tracks.map((track) => [track.bone, { rotation: Object.fromEntries(track.rotation.map((frame) => [timeKey(frame.time), frame.value])), position: Object.fromEntries(track.position.map((frame) => [timeKey(frame.time), frame.value])) }]),
          ),
        },
      },
    },
    /** Seconds. */
    length,
    /** The stretches of the timeline, for a labelled scrubber. A hold of no length is left out. */
    phases: (["windup", "hold", "release", "recover"] as const)
      .map((id) => ({ id, label: PHASE_LABEL[id], start: round(starts[id] * GESTURE_TICK), end: round((starts[id] + timeline.ticks[id]) * GESTURE_TICK) }))
      .filter((entry) => entry.end > entry.start),
    /** The moment the casting hand is furthest from where it hangs: the frame a still picture should show. */
    peak: round(timeline.frames.reduce((best, frame, tick) => (reach(frame) > reach(timeline.frames[best]!) ? tick : best), 0) * GESTURE_TICK),
    resolved,
  }
}

const reach = (frame: GestureTimeline["frames"][number]) => Math.max(...(["right_arm", "left_arm"] as const).map((arm) => Math.hypot(...frame[arm].rotation) + Math.hypot(...frame[arm].position)))

/**
 * What other players see: the whole cast action on a block figure in the product's own default skin, in
 * the shape the app's 3D viewport plays (same as a compiled model). One key per game tick, already
 * resolved exactly as the game will be fed. A draft the acceptance standard refuses is still drawn; a malformed
 * document throws. It faces north, like every model in the viewport, and repeats
 * by default so a card keeps moving; in the game one key press plays it once.
 */
export function gesturePlayerPreview(input: unknown, options: { loop?: boolean } = {}) {
  return figure("gesture_player", input, options.loop ?? true, () => [])
}

/**
 * What the player sees: the same figure and the same motion with head, torso and legs left out, plus where
 * the eyes are. That is how the game draws it: the animation library shows the player's own model in first
 * person with everything but the arms hidden, and the camera stays where it always is. The viewport must
 * use `camera` as given (already in the viewport's space) and must not re-fit the view to the model.
 */
export function gestureFirstPersonPreview(input: unknown, options: { loop?: boolean } = {}) {
  return { ...figure("gesture_arms", input, options.loop ?? true, (document) => (document.first_person.arms ? HIDDEN_IN_FIRST_PERSON : GESTURE_BONES.map((bone) => bone.name))), camera: GESTURE_EYES }
}

/**
 * The player's eyes: at eye height over the feet, looking level the way the figure faces, through the
 * game's default lens. Nothing is tilted or pulled back to flatter the picture: this is where the game's
 * camera is while the animation library draws the player's own model. Draw it at 16:9.
 */
export const GESTURE_EYES: { position: [number, number, number]; target: [number, number, number]; fov: number } = { position: [0, round(EYE), 0], target: [0, round(EYE), -40], fov: GESTURE_VIEW.fov }

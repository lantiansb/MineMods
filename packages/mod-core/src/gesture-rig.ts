/**
 * The fixed rig a cast action animates and the numbers every other gesture file agrees on. Nothing here
 * names a loader or a library: the compiler turns these bones into whatever the target animates, and
 * another target may map them differently. No imports, so the registry, the schema, the build and the app
 * can all read it.
 */

/** Data format of a gesture document and of `gestures.json`. The runtime refuses a higher number instead of guessing. */
export const GESTURE_FORMAT = 2
/** Version of the fixed Java runtime the build puts in the mod. Bump with any behaviour change. */
export const GESTURE_RUNTIME_VERSION = "2.0.0"

/** One game tick in seconds. Every time in a document is a whole number of these. */
export const GESTURE_TICK = 0.05
/** Letters with no vanilla binding. One cast action per key, so this is also the most a project can hold today. */
export const GESTURE_KEYS = ["g", "h", "j", "k", "r", "v", "b", "n"] as const

/**
 * How a channel arrives at a keyframe. Each name is one curve of the standard easing set; the Fabric
 * compiler's table maps them one to one onto the animation library's own, and a JVM check compares the two.
 */
export const GESTURE_EASINGS = [
  "linear",
  "in_sine",
  "out_sine",
  "in_out_sine",
  "in_quad",
  "out_quad",
  "in_out_quad",
  "in_cubic",
  "out_cubic",
  "in_out_cubic",
  "in_back",
  "out_back",
  "in_out_back",
] as const
export type GestureEasing = (typeof GESTURE_EASINGS)[number]

/** Seconds. `recover` and the two fades are done by the runtime after the release and are not authored. */
export const GESTURE_TIMING = {
  windup: { min: 0.15, max: 1.5 },
  /** One cycle of the hold phase. */
  hold_cycle: { min: 0.2, max: 2 },
  /** How long a key press stays in the hold phase. */
  hold: { min: 0, max: 3 },
  release: { min: 0.1, max: 0.6 },
  recover: 0.3,
  fade_in: 0.1,
  cancel: 0.2,
} as const
export const GESTURE_ADJUST = { speed: { min: 0.6, max: 1.6 }, strength: { min: 0.6, max: 1.3 } } as const
/** Keyframes one channel of one bone may hold in one phase. */
export const GESTURE_KEYFRAMES = { max: 8 } as const
/** Share of the look direction the casting arms follow when `aim` is on. */
export const GESTURE_AIM = 0.65

/**
 * The player's own view of their arms: the game draws the player's model where it stands and looks out from
 * eye height (1.62 blocks; the model is drawn at 15/16 size, so 3.648 model pixels above the neck) through
 * the default 70° lens. The preview's camera and the "can I see my own hand" measurement both read this.
 */
export const GESTURE_VIEW = { eye_above_neck: (1.62 * 16) / 0.9375 - 24, fov: 70, aspect: 16 / 9 } as const

type Range = readonly [number, number]
type Vector = readonly [number, number, number]
type Limits = { x: Range; y: Range; z: Range }
export type GestureBoneName = "head" | "torso" | "right_arm" | "left_arm" | "right_leg" | "left_leg"
export type GestureBone = {
  name: GestureBoneName
  /** Plain-words name used in the AI brief and the design note. */
  label: string
  side: "right" | "left" | null
  /**
   * Where the bone turns, in the vanilla player model's own space: pixels, x towards the player's left,
   * y down from the neck, z towards the back. The torso turns at the waist so a lean carries the chest.
   */
  pivot: Vector
  /** What the bone hangs from: the torso carries the head and both arms; the legs only follow the waist's position. */
  carried: "torso" | "waist" | null
  /** Allowed degrees per axis, [min, max], in the document's convention (see GESTURE_INSTRUCTIONS). */
  rotation: Limits
  /** Allowed offset in pixels per axis. */
  position: Limits
  /** The vanilla box relative to the pivot (model space) and where its box-UV strip starts on a 64×64 skin. */
  box: { from: Vector; size: Vector; uv: readonly [number, number] }
}

const ARM = { x: [-215, 70], y: [-75, 90], z: [-45, 160] } as const
const LEG = { x: [-60, 60], y: [-25, 25], z: [-10, 40] } as const
const REACH = { x: [-3, 3], y: [-3, 3], z: [-4, 4] } as const

export const GESTURE_BONES: readonly GestureBone[] = [
  {
    name: "torso",
    label: "躯干（带着头和双臂一起动，轴在腰）",
    side: null,
    pivot: [0, 12, 0],
    carried: null,
    rotation: { x: [-25, 50], y: [-45, 45], z: [-25, 25] },
    position: { x: [-3, 3], y: [-6, 2], z: [-4, 4] },
    box: { from: [-4, -12, -2], size: [8, 12, 4], uv: [16, 16] },
  },
  {
    name: "head",
    label: "头（始终跟着视线，这里写的是在视线基础上的偏移）",
    side: null,
    pivot: [0, 0, 0],
    carried: "torso",
    rotation: { x: [-50, 50], y: [-60, 60], z: [-25, 25] },
    position: { x: [-2, 2], y: [-2, 2], z: [-2, 2] },
    box: { from: [-4, -8, -4], size: [8, 8, 8], uv: [0, 0] },
  },
  { name: "right_arm", label: "右臂", side: "right", pivot: [-5, 2, 0], carried: "torso", rotation: ARM, position: REACH, box: { from: [-3, -2, -2], size: [4, 12, 4], uv: [40, 16] } },
  { name: "left_arm", label: "左臂", side: "left", pivot: [5, 2, 0], carried: "torso", rotation: ARM, position: REACH, box: { from: [-1, -2, -2], size: [4, 12, 4], uv: [32, 48] } },
  { name: "right_leg", label: "右腿", side: "right", pivot: [-1.9, 12, 0], carried: "waist", rotation: LEG, position: { x: [-3, 3], y: [-1, 4], z: [-6, 6] }, box: { from: [-2, 0, -2], size: [4, 12, 4], uv: [0, 16] } },
  { name: "left_leg", label: "左腿", side: "left", pivot: [1.9, 12, 0], carried: "waist", rotation: LEG, position: { x: [-3, 3], y: [-1, 4], z: [-6, 6] }, box: { from: [-2, 0, -2], size: [4, 12, 4], uv: [16, 48] } },
]
export const GESTURE_BONE_NAMES = GESTURE_BONES.map((bone) => bone.name)

/** What a cast action can and cannot do today, in one sentence. Capabilities, the hand-off text and the docs all quote it. */
export const GESTURE_BOUNDARY =
  "施法动作（gesture）进入构建，自己只能按键播放；技能（ability）可以绑在它的键上，或者在放技能时播它；动作分起手、蓄力、出手三段，可以自己写轨道，也可以拿内置的基础动作来调，都要通过验收标准才会保存；第一人称看到的是玩家自己的手臂（带皮肤和手持物品）做同一套动作，没有单独的手部模型，也不能动手指；只动头、躯干、双臂、双腿，不带粒子、音效或伤害；游戏内效果还没有验证过；和其他改写第一人称画面或玩家动画的模组（例如 First Person Model）一起装是否正常还没有验证。"

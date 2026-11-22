import type { KindStandard, Rule } from "@minemods/studio-ai/acceptance"
import { gestureMatrix, gesturePoint, type GestureKey, type GestureMotion, type GesturePhase, type GesturePose, type GestureTimeline, type Vector } from "./gesture-motion"
import { GESTURE_BONE_NAMES, GESTURE_TICK, GESTURE_VIEW, type GestureBoneName } from "./gesture-rig"

/**
 * What the acceptance standard reads on a cast action. This file only measures — every tick resolved on
 * the fixed player proportions, the way it will play — and states, as rules under the shared criteria,
 * which measurement means what. Whether a finding refuses the work, and how it is worded to an AI or on a
 * card, is decided by the standard, the same as for every other kind.
 */

/**
 * Limits, as data. Pixels are 1/16 of a block; the arm is 12 long; speeds are per game tick (0.05 s).
 * Margins: the test runs every built-in base at every allowed adjustment and requires each to clear its
 * limit by the factor noted as "bases"; "bad" is what the rejected motions in test/fixtures/gesture-bad
 * measure (a = the old 剑指, b = one arm up and down, c = random keys, d = a nod).
 */
export const GESTURE_GATE = {
  /** The casting hand's whole path. bases ≥ 1.25×; bad d 0. */
  hand_travel: 24,
  /** How far the hand must go within `strike_ticks` somewhere in the release. bases ≥ 1.15×; bad a 6.2, b 5.6, d 0. */
  strike_distance: 7,
  strike_ticks: 3,
  /** How far the hand must have pulled back against the strike, within `anticipation_ticks` before it. bases ≥ 1.25×; bad a 0, d 0. */
  anticipation: 1.2,
  anticipation_ticks: 8,
  /** Where the release must leave the hand, measured from where it hangs. bases ≥ 1.5×; bad a 0, b 0, d 0. */
  end_distance: 5,
  /** Hand speed on the last tick of the release, as a share of the strike's top speed. bases ≤ 0.5×; bad a 1, b 1. */
  settle: 0.5,
  /** Top hand speed over the typical (median) speed while moving; constant speed scores 1. bases ≥ 1.1×; bad a 1.2, b 1.0. */
  speed_ratio: 1.6,
  /** Share of keyframes that may be `linear`. bases ≤ 0.5×; bad a 1, b 1. */
  linear_share: 0.4,
  /** Bones that must really move, the torso among them. bases > 3; bad a 2, b 1, d 1. */
  bones: 3,
  /** Degrees or pixels a bone has to move by itself to count. */
  moving: { torso: 5, torso_shift: 1, head: 4, arm: 10, leg: 6 },
  /** Degrees the torso must turn during the release. bases ≥ 1.5×; bad a 0, b 0, d 0. */
  strike_torso: 4,
  /** Largest turn of any part, and largest slide of any pivot, in one tick. bases ≤ 0.95× and 0.92×; bad c 147 degrees. */
  turn: 90,
  slide: 12,
  /** Times the hand may turn sharply back on itself at speed; a good action has two or three. bases < 7; bad c 19. */
  reversals: 7,
  /** How close the middle of a forearm or hand may come to being inside the torso or head box; the arm is 2 thick either side of it, so -0.5 lets its surface sink 1.5. bases ≤ -0.7; bad c +0.09 (inside). */
  overlap: -0.5,
  /** How far the lower foot may leave the ground, and how far any foot may sink. bases ≤ 0.8×. */
  feet: 2,
  /** Share of the action during which a hand is inside the player's own first-person view. bases ≥ 1.2× (the two that end with the hands on the ground or flung wide are the lowest); bad a 0, d 0. */
  in_view: 0.25,
  /** Two hands closer than this to mirror images of each other, with a torso turning less than this, are a robot. bases ≥ 3× apart. */
  mirror: { hands: 0.75, torso: 2 },
} as const

export type GestureMetrics = {
  /** "right", "left" or "both": the arm(s) whose hand travels furthest. */
  casting: "right" | "left" | "both"
  hand_travel: number
  strike_distance: number
  strike_peak_speed: number
  anticipation: number
  end_distance: number
  settle: number
  speed_ratio: number
  linear_share: number
  moving_bones: GestureBoneName[]
  strike_torso: number
  max_turn: number
  max_slide: number
  reversals: number
  deepest_overlap: number
  feet_error: number
  mirror_difference: number | null
  /** Share of the ticks from key press to the end of the release in which a palm is inside the player's own view, looking level. */
  in_view: number
  /** The torso and the casting arm are keyed on exactly the same ticks in every phase. */
  same_beat: boolean
  /** The most the torso turns or tilts sideways, in degrees. */
  torso_turn: number
  seconds: { windup: number; hold: number; release: number }
}

const subtract = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (a: Vector) => Math.hypot(...a)
const round = (value: number) => Number(value.toFixed(2))
const ARMS = ["right_arm", "left_arm"] as const
// The middle of the palm: the arm box hangs 10 below its pivot and sits one pixel outside it.
const palm = (frame: GesturePose, arm: (typeof ARMS)[number]) => gesturePoint(frame, arm, [arm === "right_arm" ? -1 : 1, 9, 0])

// The angle between two orientations of a part, whatever their three numbers happen to be.
function turn(a: Vector, b: Vector) {
  const first = gestureMatrix(a)
  const second = gestureMatrix(b)
  const trace = [0, 1, 2].reduce((sum, row) => sum + [0, 1, 2].reduce((inner, column) => inner + first[row]![column]! * second[row]![column]!, 0), 0)
  return (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI
}

// How far inside a box a point is (negative when outside), with the box given in a part's own frame.
function inside(frame: GesturePose, part: "torso" | "head", point: Vector, low: Vector, high: Vector) {
  const matrix = gestureMatrix(frame[part].rotation)
  const offset = subtract(point, gesturePoint(frame, part, [0, 0, 0]))
  // The matrix is a pure turn, so its transpose takes a model-space offset back into the part's frame.
  const own = [0, 1, 2].map((axis) => matrix[0]![axis]! * offset[0] + matrix[1]![axis]! * offset[1] + matrix[2]![axis]! * offset[2])
  return Math.min(...own.map((value, axis) => Math.min(value - low[axis]!, high[axis]! - value)))
}

// Inside the first-person frame, a little in from its edges, and not right against the lens. Model space: x left, y down from the neck, z back.
const HALF = Math.tan((GESTURE_VIEW.fov * Math.PI) / 360)
export const gestureSeen = (point: Vector) => -point[2] > 2 && Math.abs(point[0]) < -point[2] * HALF * GESTURE_VIEW.aspect * 0.92 && Math.abs(point[1] + GESTURE_VIEW.eye_above_neck) < -point[2] * HALF * 0.92

const tracks = (motion: GestureMotion) =>
  ([["windup", motion.windup], ["hold", motion.hold], ["release", motion.release]] as [string, GesturePhase | null][]).flatMap(([name, phase]) =>
    Object.entries(phase?.bones ?? {}).flatMap(([bone, channels]) => (["rotation", "position"] as const).flatMap((channel) => (channels[channel] ? [{ phase: name, bone: bone as GestureBoneName, keys: channels[channel] as GestureKey[] }] : []))),
  )

export function measureGesture(motion: GestureMotion, timeline: GestureTimeline): GestureMetrics {
  const acting = timeline.ticks.windup + timeline.ticks.hold + timeline.ticks.release
  const releaseStart = timeline.ticks.windup + timeline.ticks.hold
  const frames = timeline.frames.slice(0, acting + 1)
  const local = timeline.local.slice(0, acting + 1)
  const hands = Object.fromEntries(ARMS.map((arm) => [arm, frames.map((frame) => palm(frame, arm))])) as Record<(typeof ARMS)[number], Vector[]>
  const path = (points: Vector[]) => points.slice(1).reduce((sum, point, index) => sum + length(subtract(point, points[index]!)), 0)
  const travel = { right_arm: path(hands.right_arm), left_arm: path(hands.left_arm) }
  // The casting hand is the one that does the release. The other may well travel further over the whole action: it
  // often comes up first to aim and gets out of the way again.
  const struck = { right_arm: path(hands.right_arm.slice(releaseStart)), left_arm: path(hands.left_arm.slice(releaseStart)) }
  const lead = struck.right_arm >= struck.left_arm ? "right_arm" : "left_arm"
  const other = lead === "right_arm" ? "left_arm" : "right_arm"
  const both = struck[other] >= struck[lead] * 0.7
  const hand = hands[lead]
  const speed = hand.slice(1).map((point, index) => length(subtract(point, hand[index]!)))
  // The strike: the stretch of the release where the hand covers the most ground in a few ticks.
  const windows = Array.from({ length: Math.max(1, acting - releaseStart) }, (_, index) => releaseStart + index).map((start) => ({ start, end: Math.min(acting, start + GESTURE_GATE.strike_ticks) }))
  const strike = windows.reduce((best, window) => (length(subtract(hand[window.end]!, hand[window.start]!)) > length(subtract(hand[best.end]!, hand[best.start]!)) ? window : best))
  const blow = subtract(hand[strike.end]!, hand[strike.start]!)
  const releaseSpeeds = speed.slice(releaseStart)
  const peak = Math.max(0, ...releaseSpeeds)
  // The pull-back: at each fast tick of the release, how far ahead of the hand (along the way it is now going) it had been
  // a moment earlier. Only a hand that first went the other way has ever been ahead of itself.
  const pulled = releaseSpeeds.flatMap((value, index) => {
    const tick = releaseStart + index
    const step = subtract(hand[tick + 1]!, hand[tick]!)
    return value >= Math.max(peak * 0.3, 1e-6) ? hand.slice(Math.max(0, tick - GESTURE_GATE.anticipation_ticks), tick).map((point) => dot(subtract(point, hand[tick]!), step) / value) : []
  })
  const moving = speed.filter((value) => value > 0.15).sort((a, b) => a - b)
  const keyed = tracks(motion)
  const allKeys = keyed.flatMap((track) => track.keys)
  const span = (bone: GestureBoneName, channel: "rotation" | "position") => Math.max(...local.map((value) => length(value[bone][channel])))
  // An arm counts when it turns in its own shoulder; being carried by the torso is not taking part.
  const swing = (bone: GestureBoneName) => Math.max(...local.map((value) => turn(value[bone].rotation, [0, 0, 0])))
  const limits = GESTURE_GATE.moving
  const movingBones = GESTURE_BONE_NAMES.filter((bone) => {
    if (bone === "torso") return swing(bone) >= limits.torso || span(bone, "position") >= limits.torso_shift
    if (bone === "head") return swing(bone) >= limits.head
    return swing(bone) >= (bone.endsWith("arm") ? limits.arm : limits.leg)
  })
  // A looping hold repeats by design, so only its first cycle is counted.
  const repeated = (tick: number) => tick > timeline.ticks.windup + Math.min(timeline.ticks.hold, motion.hold?.ticks ?? 0) && tick <= releaseStart
  const reversals = speed.slice(1).filter((value, index) => {
    if (repeated(index + 1)) return false
    const previous = subtract(hand[index + 1]!, hand[index]!)
    const next = subtract(hand[index + 2]!, hand[index + 1]!)
    return value >= 1 && speed[index]! >= 1 && dot(previous, next) < -0.3 * value * speed[index]!
  }).length
  const overlap = Math.max(
    ...frames.flatMap((frame) =>
      ARMS.flatMap((arm) =>
        // The forearm and hand only: the upper arm always sits against the chest.
        [6.5, 8.5, 10].flatMap((down) => {
          const point = gesturePoint(frame, arm, [arm === "right_arm" ? -1 : 1, down, 0])
          return [inside(frame, "torso", point, [-4, 0, -2], [4, 12, 2]), inside(frame, "head", point, [-4, -8, -4], [4, 0, 4])]
        }),
      ),
    ),
  )
  const feet = frames.map((frame) => (["right_leg", "left_leg"] as const).map((leg) => gesturePoint(frame, leg, [0, 12, 0])[1] - 24))
  const arm = both || lead === "right_arm" ? "right_arm" : "left_arm"
  const signature = (bone: GestureBoneName) => keyed.filter((track) => track.bone === bone).map((track) => `${track.phase}:${track.keys.map((key) => key.tick).join(",")}`).sort().join("|")
  const mirrored = both ? Math.max(...frames.map((frame) => length(subtract(palm(frame, "right_arm"), ((point) => [-point[0], point[1], point[2]] as Vector)(palm(frame, "left_arm")))))) : null
  return {
    casting: both ? "both" : lead === "right_arm" ? "right" : "left",
    hand_travel: round(travel[lead]),
    strike_distance: round(length(blow)),
    strike_peak_speed: round(peak),
    anticipation: round(Math.max(0, ...pulled)),
    end_distance: round(length(subtract(hand[acting]!, hand[0]!))),
    settle: round(peak > 0 ? releaseSpeeds.at(-1)! / peak : 1),
    speed_ratio: round(moving.length ? Math.max(...moving) / moving[Math.floor(moving.length / 2)]! : 0),
    linear_share: round(allKeys.length ? allKeys.filter((key) => key.easing === "linear").length / allKeys.length : 1),
    moving_bones: movingBones,
    strike_torso: round(Math.max(...frames.slice(releaseStart).map((frame) => turn(frame.torso.rotation, frames[releaseStart]!.torso.rotation)))),
    max_turn: round(Math.max(0, ...frames.slice(1).flatMap((frame, index) => GESTURE_BONE_NAMES.map((bone) => turn(frame[bone].rotation, frames[index]![bone].rotation))))),
    max_slide: round(Math.max(0, ...frames.slice(1).flatMap((frame, index) => GESTURE_BONE_NAMES.map((bone) => length(subtract(frame[bone].position, frames[index]![bone].position)))))),
    reversals,
    deepest_overlap: round(overlap),
    // The lower foot should be on the ground; no foot should be under it.
    feet_error: round(Math.max(...feet.map((pair) => Math.max(Math.abs(Math.max(...pair)), ...pair)))),
    mirror_difference: mirrored === null ? null : round(mirrored),
    in_view: round(frames.slice(1).filter((_, index) => ARMS.some((arm) => gestureSeen(hands[arm][index + 1]!))).length / Math.max(1, acting)),
    same_beat: keyed.some((track) => track.bone === "torso") && signature("torso") === signature(arm),
    torso_turn: round(Math.max(...timeline.local.map((value) => Math.max(Math.abs(value.torso.rotation[1]), Math.abs(value.torso.rotation[2]))))),
    seconds: { windup: round(timeline.ticks.windup * GESTURE_TICK), hold: round(timeline.ticks.hold * GESTURE_TICK), release: round(timeline.ticks.release * GESTURE_TICK) },
  }
}

const G = GESTURE_GATE
const rule = (id: string, criterion: Rule<GestureMetrics>["criterion"], asks: string, find: Rule<GestureMetrics>["find"]): Rule<GestureMetrics> => ({ id, criterion, severity: "defect", asks, find })

/**
 * A cast action under the standard. Every rule is a defect: a cast that fails one of them is the stiff,
 * robotic or broken motion the kind exists to keep out, however simple the brief.
 */
export const GESTURE_STANDARD: KindStandard<GestureMetrics> = {
  kind: "gesture",
  label: "施法动作",
  rules: [
    rule("hand_travel", "reads", "幅度够大，一眼看得出在施法：施法的手一共至少走两个手臂长", (m) =>
      m.hand_travel < G.hand_travel ? { message: `施法的那只手一共只走了 ${m.hand_travel} 像素（手臂长 12），动作幅度太小，看不出在施法。`, fix: `手的路程至少要 ${G.hand_travel} 像素：把起手的姿势摆开，让出手真正打出去。` } : null,
    ),
    rule("weak_strike", "reads", "出手像一击：手在 0.15 秒内走出至少半个手臂的距离", (m) =>
      m.strike_distance < G.strike_distance
        ? { message: `出手不像一击：手在 ${G.strike_ticks} 刻（0.15 秒）内最多只走了 ${m.strike_distance} 像素。`, fix: `至少要 ${G.strike_distance} 像素：把出手的主要位移压缩到 2～3 刻内完成，用 out_cubic 或 out_quad。` }
        : null,
    ),
    rule("never_in_view", "reads", "自己看得见：至少有四分之一的时间，手出现在自己第一人称的眼前", (m) =>
      m.in_view < G.in_view ? { message: `玩家自己几乎看不到这个动作：手只有 ${Math.round(m.in_view * 100)}% 的时间出现在第一人称的视野里。`, fix: `至少要 ${G.in_view * 100}%：把手抬到眼前（手臂 x 在 -95 到 -125 之间、略向中线收）来蓄力或出手，不要只在腰侧或身后动。` } : null,
    ),
    rule("returns_to_rest", "reads", "出手停在打出去的姿势附近，不自己把手放回身边（收回由游戏自动做）", (m) =>
      m.end_distance < G.end_distance ? { message: `出手结束时手又回到了身边（离自然下垂的位置只有 ${m.end_distance} 像素），看不出打出去了。`, fix: "出手应该停在打出去的姿势附近；收回由游戏自动完成，不要自己把手放回去。" } : null,
    ),
    rule("no_anticipation", "hierarchy", "出手前有预备：手和躯干先往反方向收一点，再打出去", (m) =>
      m.anticipation < G.anticipation
        ? { message: `出手前没有预备动作：打出去之前的 ${G.anticipation_ticks} 刻里，手没有先往反方向收（只退了 ${m.anticipation} 像素）。`, fix: `至少要退 ${G.anticipation} 像素：在出手的开头加一两刻，让手和躯干先往回收一点再打出去。` }
        : null,
    ),
    rule("no_settle", "hierarchy", "出手之后有收势：一击到位后留两三刻，略微回弹并慢下来", (m) =>
      m.settle > G.settle ? { message: `出手末尾没有收势：最后一刻手还在以最高速度的 ${Math.round(m.settle * 100)}% 运动。`, fix: `最后一刻的速度不能超过最高速度的 ${G.settle * 100}%：在一击到位之后留两三刻，让手略微回弹并慢下来。` } : null,
    ),
    rule("few_bones", "hierarchy", `全身配合：躯干必须参与，头、另一只手臂或腿里至少再动一个，总共至少 ${G.bones} 个部位`, (m) =>
      m.moving_bones.length < G.bones || !m.moving_bones.includes("torso")
        ? { message: `只有 ${m.moving_bones.length ? m.moving_bones.join("、") : "0 个部位"} 在动，施法的手是孤零零自己在动。`, fix: `施法要全身配合：躯干（torso）必须参与，头、另一只手臂或腿里至少再动一个，总共至少 ${G.bones} 个部位。`, evidence: m.moving_bones }
        : null,
    ),
    rule("strike_alone", "hierarchy", "出手那一刻躯干跟着转身或前倾，带着手臂打出去", (m) =>
      m.strike_torso < G.strike_torso ? { message: `出手时躯干没有跟着动（只转了 ${m.strike_torso} 度）。`, fix: `至少要转 ${G.strike_torso} 度：让躯干在出手那一刻转身或前倾，带着手臂打出去。` } : null,
    ),
    rule("constant_speed", "not_mechanical", "有快有慢：蓄势慢、出手快，不能整套匀速", (m) =>
      m.speed_ratio < G.speed_ratio ? { message: `整套动作几乎是匀速的，像机器人（最快的时候只有平常速度的 ${m.speed_ratio} 倍）。`, fix: `最快要到平常速度的 ${G.speed_ratio} 倍以上：蓄势要慢、出手要快，关键帧用带缓动的 easing。` } : null,
    ),
    rule("linear_keys", "not_mechanical", "关键帧用带缓动的曲线，匀速（linear）的不超过四成", (m) =>
      m.linear_share > G.linear_share ? { message: `有 ${Math.round(m.linear_share * 100)}% 的关键帧是匀速转过去的，动作很僵硬。`, fix: `匀速（linear）的关键帧不能超过 ${G.linear_share * 100}%：把它们换成 in_out_sine、out_cubic 这类缓动。` } : null,
    ),
    rule("same_timing", "not_mechanical", "各部位错开一两刻：躯干先到位，手臂再跟上，不能同起同停", (m) =>
      m.same_beat ? { message: "躯干和施法手臂的关键帧时间完全一样，所有部位同时起、同时停。", fix: "让躯干比手臂早一两刻到位，手臂再跟上。" } : null,
    ),
    rule("mirror_symmetric", "not_mechanical", "两只手不能完全左右对称、同时运动", (m) =>
      m.mirror_difference !== null && m.mirror_difference < G.mirror.hands && m.torso_turn < G.mirror.torso ? { message: "两只手完全左右对称、同时运动，像机器人。", fix: "让一只手早一两刻，或者让躯干带一点转动，打破对称。" } : null,
    ),
    rule("jitter", "not_mechanical", "一个动作只做一件事，手不能来回乱抖", (m) =>
      m.reversals > G.reversals ? { message: `手来回抖动太碎（高速急转了 ${m.reversals} 次）。`, fix: `急转不能超过 ${G.reversals} 次：去掉多余的关键帧，一个动作只做一件事。` } : null,
    ),
    rule("teleport", "sound", "一刻（0.05 秒）之内不能转过 90 度，不能像瞬移", (m) =>
      m.max_turn > G.turn || m.max_slide > G.slide
        ? { message: `有一刻转得太快，像瞬移（一刻之内最多转了 ${Math.round(m.max_turn)} 度、移了 ${Math.round(m.max_slide)} 像素）。`, fix: `一刻之内最多转 ${G.turn} 度、移 ${G.slide} 像素：给这一段多留一两刻，或者减小幅度。` }
        : null,
    ),
    rule("through_body", "sound", "手和前臂不能穿进身体或头里", (m) =>
      m.deepest_overlap > G.overlap ? { message: "手或前臂穿进了身体或头里。", fix: "把这只手臂向外打开一些（举过头顶时 z 用负值才是向外），或者减小向内收的 y。" } : null,
    ),
    rule("feet", "sound", "脚踩在地上：不能双脚离地，也不能陷进地里", (m) =>
      m.feet_error > G.feet ? { message: `脚离开地面或陷进地里了（差 ${m.feet_error} 像素）。`, fix: `最多差 ${G.feet} 像素：压低身体（torso 的 position y 为负）时要同时把两条腿前后分开，让脚仍然踩在地上；不要让双脚同时离地。` } : null,
    ),
  ],
  unmeasured: {
    earns_place: "哪些关键帧是多余的，还量不了",
    fits: "只能按键播放，还没有可以对照的技能或效果；动作和骨架对不对得上由格式保证（只有六个固定部位）",
  },
}

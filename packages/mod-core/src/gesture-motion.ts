import { GESTURE_BONES, GESTURE_TICK, GESTURE_TIMING, type GestureBone, type GestureBoneName, type GestureEasing } from "./gesture-rig"

// No Node APIs and no zod here: the schema, the quality gate, the build and the app's preview all run this one
// arithmetic, so what is judged, what is drawn and what the game plays cannot drift apart.

export type Vector = [number, number, number]
/** `tick` counts from the start of its phase; the value before the first key is wherever the previous phase left the bone. */
export type GestureKey = { tick: number; value: Vector; easing: GestureEasing }
export type GestureChannels = { rotation?: GestureKey[]; position?: GestureKey[] }
export type GesturePhase = { ticks: number; bones: Partial<Record<GestureBoneName, GestureChannels>> }
/** A whole cast action as authored: three phases of keyed tracks in the document's convention, times in ticks. */
export type GestureMotion = { windup: GesturePhase; hold: (GesturePhase & { loop: boolean }) | null; release: GesturePhase }
/** One body part at one tick, ready for a flat player model: degrees and pixel offsets in vanilla model axes. */
export type GesturePart = { rotation: Vector; position: Vector }
export type GesturePose = Record<GestureBoneName, GesturePart>
export type GestureStage = "windup" | "hold" | "release" | "recover"

export const gestureTicks = (seconds: number) => Math.round(seconds / GESTURE_TICK)
export const GESTURE_RECOVER_TICKS = gestureTicks(GESTURE_TIMING.recover)

const BACK = 1.70158
/** The standard easing curves, written out so the numbers can be compared with the animation library's on a JVM. */
export const GESTURE_EASE: Record<GestureEasing, (amount: number) => number> = {
  linear: (t) => t,
  in_sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  out_sine: (t) => Math.sin((t * Math.PI) / 2),
  in_out_sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  in_quad: (t) => t * t,
  out_quad: (t) => 1 - (1 - t) * (1 - t),
  in_out_quad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  in_cubic: (t) => t * t * t,
  out_cubic: (t) => 1 - (1 - t) ** 3,
  in_out_cubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  in_back: (t) => (BACK + 1) * t * t * t - BACK * t * t,
  out_back: (t) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2,
  // The library's in-out pair is its "in" curve played forwards then backwards, not the 1.525 variant some tables list.
  in_out_back: (t) => (t < 0.5 ? ((BACK + 1) * (2 * t) ** 3 - BACK * (2 * t) ** 2) / 2 : 1 - ((BACK + 1) * (2 - 2 * t) ** 3 - BACK * (2 - 2 * t) ** 2) / 2),
}

type Matrix = [Vector, Vector, Vector]
const radians = (degrees: number) => (degrees * Math.PI) / 180
const degrees = (value: number) => (value * 180) / Math.PI
const multiply = (a: Matrix, b: Matrix) => a.map((row) => [0, 1, 2].map((column) => row[0] * b[0][column]! + row[1] * b[1][column]! + row[2] * b[2][column]!)) as Matrix
const apply = (matrix: Matrix, vector: Vector) => matrix.map((row) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]) as Vector
const add = (a: Vector, b: Vector): Vector => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

/** The vanilla model turns a part roll · yaw · pitch (the pitch reaches the box first). Degrees in, matrix out. */
export function gestureMatrix(rotation: Vector): Matrix {
  const [sx, sy, sz] = rotation.map((angle) => Math.sin(radians(angle))) as Vector
  const [cx, cy, cz] = rotation.map((angle) => Math.cos(radians(angle))) as Vector
  return [
    [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
    [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
    [-sy, sx * cy, cx * cy],
  ]
}

// The same turn has many sets of angles; the one nearest the previous tick keeps a channel from spinning the long way round.
function angles(matrix: Matrix, near: Vector): Vector {
  const yaw = -Math.asin(Math.max(-1, Math.min(1, matrix[2][0])))
  const first: Vector = [degrees(Math.atan2(matrix[2][1], matrix[2][2])), degrees(yaw), degrees(Math.atan2(matrix[1][0], matrix[0][0]))]
  const second: Vector = [first[0] + 180, 180 - first[1], first[2] + 180]
  const close = (candidate: Vector) => candidate.map((angle, axis) => angle - 360 * Math.round((angle - near[axis]!) / 360)) as Vector
  const distance = (candidate: Vector) => candidate.reduce((sum, angle, axis) => sum + Math.abs(angle - near[axis]!), 0)
  return [close(first), close(second)].reduce((best, candidate) => (distance(candidate) < distance(best) - 1e-6 ? candidate : best))
}

const side = (bone: GestureBone) => (bone.side === "left" ? -1 : 1)
// Document convention to model axes. Limbs count sideways numbers outwards on both sides, so a symmetric
// pose is the same numbers left and right; head and torso count them towards the player's right.
const modelRotation = (bone: GestureBone, value: Vector): Vector => (bone.side ? [value[0], side(bone) * value[1], side(bone) * value[2]] : [value[0], value[1], -value[2]])
// Subtracted from zero rather than negated, so an untouched axis stays a plain 0 and not -0.
const modelPosition = (bone: GestureBone, value: Vector): Vector => [bone.side === "left" ? value[0] : 0 - value[0], 0 - value[1], 0 - value[2]]

type Local = Record<GestureBoneName, { rotation: Vector; position: Vector }>
const BONE = Object.fromEntries(GESTURE_BONES.map((bone) => [bone.name, bone])) as Record<GestureBoneName, GestureBone>
const zero = (): Vector => [0, 0, 0]
const rest = () => Object.fromEntries(GESTURE_BONES.map((bone) => [bone.name, { rotation: zero(), position: zero() }])) as Local

function sample(keys: GestureKey[] | undefined, start: Vector, tick: number): Vector {
  if (!keys?.length) return start
  const next = keys.findIndex((key) => key.tick >= tick)
  if (next === -1) return keys.at(-1)!.value
  const from = next === 0 ? { tick: 0, value: start } : keys[next - 1]!
  const amount = GESTURE_EASE[keys[next]!.easing]((tick - from.tick) / (keys[next]!.tick - from.tick))
  return from.value.map((value, axis) => value + (keys[next]!.value[axis]! - value) * amount) as Vector
}

/** Every bone's own values, tick by tick through one phase, continuing from `start`. */
function play(phase: GesturePhase, start: Local) {
  return Array.from({ length: phase.ticks }, (_, index) =>
    Object.fromEntries(
      GESTURE_BONES.map((bone) => [
        bone.name,
        {
          rotation: sample(phase.bones[bone.name]?.rotation, start[bone.name].rotation, index + 1),
          position: sample(phase.bones[bone.name]?.position, start[bone.name].position, index + 1),
        },
      ]),
    ) as Local,
  )
}

/**
 * Resolves the torso carrying the head and arms: the animation library moves six independent parts, so a
 * turned torso has to be written out as new pivots and angles for whatever hangs from it.
 */
function pose(local: Local, previous: GesturePose | null, headTurns: boolean): GesturePose {
  const torso = gestureMatrix(modelRotation(BONE.torso, local.torso.rotation))
  const waist = modelPosition(BONE.torso, local.torso.position)
  return Object.fromEntries(
    GESTURE_BONES.map((bone) => {
      const near = previous?.[bone.name].rotation ?? zero()
      const own = modelRotation(bone, local[bone.name].rotation)
      const offset = modelPosition(bone, local[bone.name].position)
      if (bone.name === "torso") return [bone.name, { rotation: angles(torso, near), position: add(add(waist, apply(torso, [0, -bone.pivot[1], 0])), [0, bone.pivot[1], 0]) }]
      if (bone.carried === "waist") return [bone.name, { rotation: angles(gestureMatrix(own), near), position: add(waist, offset) }]
      const hung = add(add([...bone.pivot], [0, -BONE.torso.pivot[1], 0]), offset)
      const position = add(add(waist, apply(torso, hung)), [-bone.pivot[0], BONE.torso.pivot[1] - bone.pivot[1], -bone.pivot[2]])
      // The head keeps facing where the player looks; only what the action itself asks for is added on top.
      if (bone.name === "head") return [bone.name, { rotation: headTurns ? own : zero(), position }]
      return [bone.name, { rotation: angles(multiply(torso, gestureMatrix(own)), near), position }]
    }),
  ) as GesturePose
}

export type GestureTimeline = {
  ticks: { windup: number; hold: number; release: number; recover: number }
  /** One pose per game tick from 0 (standing) to the end of the recovery. */
  frames: GesturePose[]
  /** The bones' own values at the same ticks, before the torso is resolved. The gate reads who moved by themselves here. */
  local: Local[]
  /** Which phase each tick belongs to. Tick 0 is the windup's starting pose. */
  stage: GestureStage[]
}

/**
 * Plays a motion the way one key press does: windup, the hold repeated (or frozen on its last pose) for
 * `holdTicks`, release, then the eased return to standing that the runtime adds by itself.
 */
export function gestureTimeline(motion: GestureMotion, holdTicks: number): GestureTimeline {
  const windup = play(motion.windup, rest())
  const ready = windup.at(-1)!
  const cycle = motion.hold ? play(motion.hold, ready) : []
  const hold = Array.from({ length: holdTicks }, (_, index) => (cycle.length ? cycle[motion.hold!.loop ? index % cycle.length : Math.min(index, cycle.length - 1)]! : ready))
  const release = play(motion.release, hold.at(-1) ?? ready)
  const last = release.at(-1)!
  const recover = Array.from({ length: GESTURE_RECOVER_TICKS }, (_, index) => {
    const left = 1 - GESTURE_EASE.in_out_sine((index + 1) / GESTURE_RECOVER_TICKS)
    return Object.fromEntries(GESTURE_BONES.map((bone) => [bone.name, { rotation: last[bone.name].rotation.map((value) => value * left), position: last[bone.name].position.map((value) => value * left) }])) as Local
  })
  const local = [rest(), ...windup, ...hold, ...release, ...recover]
  const headTurns = [motion.windup, motion.hold, motion.release].some((phase) => phase?.bones.head?.rotation?.length)
  const frames = local.reduce<GesturePose[]>((made, value) => [...made, pose(value, made.at(-1) ?? null, headTurns)], [])
  const acting = windup.length + hold.length + release.length
  return {
    ticks: { windup: windup.length, hold: hold.length, release: release.length, recover: GESTURE_RECOVER_TICKS },
    // The library fades each channel back by itself; fading the resolved parts is that same arithmetic.
    frames: frames.map((frame, tick) => (tick <= acting ? frame : fade(frames[acting]!, 1 - GESTURE_EASE.in_out_sine((tick - acting) / GESTURE_RECOVER_TICKS)))),
    local,
    stage: [
      "windup",
      ...windup.map(() => "windup" as const),
      ...hold.map(() => "hold" as const),
      ...release.map(() => "release" as const),
      ...recover.map(() => "recover" as const),
    ],
  }
}

const fade = (from: GesturePose, left: number) =>
  Object.fromEntries(GESTURE_BONES.map((bone) => [bone.name, { rotation: from[bone.name].rotation.map((value) => value * left), position: from[bone.name].position.map((value) => value * left) }])) as GesturePose

/** The same motion for the other hand: limbs swap sides as they are, head and torso flip their sideways numbers. */
export function mirrorGestureMotion(motion: GestureMotion): GestureMotion {
  const swap: Record<GestureBoneName, GestureBoneName> = { head: "head", torso: "torso", right_arm: "left_arm", left_arm: "right_arm", right_leg: "left_leg", left_leg: "right_leg" }
  const flip = (keys: GestureKey[] | undefined, signs: Vector) => keys?.map((key) => ({ ...key, value: key.value.map((value, axis) => value * signs[axis]! + 0) as Vector }))
  const phase = <T extends GesturePhase>(value: T): T => ({
    ...value,
    bones: Object.fromEntries(
      Object.entries(value.bones).map(([name, channels]) => [
        swap[name as GestureBoneName],
        BONE[name as GestureBoneName].side ? channels : { ...(channels.rotation ? { rotation: flip(channels.rotation, [1, -1, -1]) } : {}), ...(channels.position ? { position: flip(channels.position, [-1, 1, 1]) } : {}) },
      ]),
    ),
  })
  return { windup: phase(motion.windup), hold: motion.hold ? phase(motion.hold) : null, release: phase(motion.release) }
}

/**
 * Plays the windup and the hold `speed` times as fast, and the release too when that makes it faster. A
 * slower setting never slows the release: a strike played in slow motion stops reading as a strike. Keys
 * stay on whole ticks and never land on each other.
 */
export function retimeGestureMotion(motion: GestureMotion, rate: number): GestureMotion {
  const phase = <T extends GesturePhase>(value: T, speed: number): T => {
    const keys = (list: GestureKey[] | undefined) =>
      list?.reduce<GestureKey[]>((made, key) => [...made, { ...key, tick: Math.max((made.at(-1)?.tick ?? 0) + 1, Math.round(key.tick / speed)) }], [])
    const bones = Object.fromEntries(
      Object.entries(value.bones).map(([name, channels]) => [name, { ...(channels.rotation ? { rotation: keys(channels.rotation) } : {}), ...(channels.position ? { position: keys(channels.position) } : {}) }]),
    ) as GesturePhase["bones"]
    const last = Math.max(0, ...Object.values(bones).flatMap((channels) => [channels.rotation?.at(-1)?.tick ?? 0, channels.position?.at(-1)?.tick ?? 0]))
    return { ...value, ticks: Math.max(last, Math.round(value.ticks / speed), 2), bones }
  }
  return { windup: phase(motion.windup, rate), hold: motion.hold ? phase(motion.hold, rate) : null, release: phase(motion.release, Math.max(rate, 1)) }
}

/** Where a point fixed to a part is, in model space (x left, y down from the neck, z back). */
export function gesturePoint(frame: GesturePose, bone: GestureBoneName, point: Vector): Vector {
  return add(add(bone === "torso" ? [0, 0, 0] : [...BONE[bone].pivot], frame[bone].position), apply(gestureMatrix(frame[bone].rotation), point))
}

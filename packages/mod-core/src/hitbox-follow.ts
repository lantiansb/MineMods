import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { MotionClip } from "@minemods/studio-ai/model-motion"
import { TICKS } from "./ability-words"
import { bonePlaces, type Place } from "./creature-abilities"
import type { Ability, Hitbox } from "./entity-runtime"

/**
 * Collision boxes of parts that follow a bone (`hitbox.parts[].bone`). The server plays no motion, so where each such bone goes is measured here, at build time, on the
 * same pose every picture and every hit anchor uses (`bonePlaces`, `posedCorners`), and written into the generated creature as a table: for every motion the server knows
 * the creature is in (standing, walking, and each of its abilities), every `every` ticks, how far the bone has gone from where it stands as built, in the creature's own
 * terms (ahead, up, to its left; blocks at the size the model is built). The server looks up the motion and the tick it is at and moves the box by that much; between two
 * rows it goes in a straight line. Standing and walking loop; an ability holds its last row. A part whose bone does not move in any of these motions, or that names a bone
 * the model does not have, is not in the table and stands where it is stated, as every part did before.
 * The table is text, three letters a value (`letters`: `a` to `p`, sixteen to a letter, `unit` to the block, `zero` is no move: ±16 blocks), because a 150-cube giant with
 * a dozen abilities has some ten thousand values, and as an array they would be bytecode in the class's static initialiser, which the JVM holds to 64 KiB.
 * No Node APIs: the app's window reads it too.
 */
export const HITBOX_FOLLOW = { every: 2, unit: 128, zero: 2048, letters: 3, most: 4095 } as const

/** One motion of the table: its name, its length in ticks, whether it loops, and its rows (every `every` ticks from 0 to its end, both ends included) of every follower's three values. */
export type FollowMotion = { name: string; ticks: number; loop: boolean; moves: string }

/**
 * What a creature's class is given: `columns`, per part, its place among the followers (-1: it does not follow); `followers`: how many do; `motions`: the table's rows;
 * `idle` and `walk`: the rows of standing and walking; `abilities`: per ability (in the order the class numbers them), its row (-1: its motion could not be measured).
 */
export type HitboxFollow = { columns: number[]; followers: number; motions: FollowMotion[]; idle: number; walk: number; abilities: number[] }

const LETTER = "a".charCodeAt(0)
const encode = (blocks: number) => {
  const value = Math.max(0, Math.min(HITBOX_FOLLOW.most, Math.round(blocks * HITBOX_FOLLOW.unit) + HITBOX_FOLLOW.zero))
  return String.fromCharCode(LETTER + (value >> 8), LETTER + ((value >> 4) & 15), LETTER + (value & 15))
}
const decode = (text: string, at: number) => ((((text.charCodeAt(at) - LETTER) << 8) | ((text.charCodeAt(at + 1) - LETTER) << 4) | (text.charCodeAt(at + 2) - LETTER)) - HITBOX_FOLLOW.zero) / HITBOX_FOLLOW.unit

/** A motion's length in server ticks (at least one), and the moments of its rows in seconds: every `every` ticks, and its end. */
export const followTicks = (clip: Pick<MotionClip, "length">) => Math.max(1, Math.round(clip.length * TICKS))
export const followMoments = (clip: Pick<MotionClip, "length">) => Array.from({ length: Math.ceil(followTicks(clip) / HITBOX_FOLLOW.every) + 1 }, (_, row) => Math.min(row * HITBOX_FOLLOW.every, followTicks(clip)) / TICKS)

/** How far a bone has gone from where it stands as built, in the creature's own terms (blocks). */
const moved = (now: Place | null, rest: Place | null): Place => (now && rest ? { forward: now.forward - rest.forward, up: now.up - rest.up, left: now.left - rest.left } : { forward: 0, up: 0, left: 0 })

/** The parts of a hitbox that name a bone the model has, by their index. */
type BoneSlots = { parts?: readonly { bone?: string | null }[] | null }
export const bonedParts = (hitbox: BoneSlots | null | undefined, design: Pick<ModelDesign, "bones">) =>
  (hitbox?.parts ?? []).flatMap((part, index) => (part.bone && design.bones.some((bone) => bone.name === part.bone) ? [{ index, bone: part.bone }] : []))

/** The motions the generated creature is known by its server to be in, in the order of the table: standing, walking, then each ability's own motion once. */
export function followedMotions(design: Pick<ModelDesign, "animations">, abilities: readonly Pick<Ability, "clip">[]) {
  const names = [...new Set(["idle", "walk", ...abilities.map((ability) => ability.clip)])]
  return names.flatMap((name) => {
    const clip = design.animations.find((animation) => animation.name === name) as MotionClip | undefined
    return clip ? [clip] : []
  })
}

/**
 * The table a creature's class is given, or null when no part follows a bone that moves (its class is then written as it always was).
 * `abilities`: the abilities the class is built with (only a hostile creature's), in its order.
 */
export function hitboxFollow(hitbox: BoneSlots | null | undefined, design: Pick<ModelDesign, "bones" | "animations">, abilities: readonly Pick<Ability, "clip">[]): HitboxFollow | null {
  const boned = bonedParts(hitbox, design)
  const clips = followedMotions(design, abilities)
  if (!boned.length || !clips.some((clip) => clip.name === "idle") || !clips.some((clip) => clip.name === "walk")) return null
  const names = boned.map((part) => part.bone)
  const rest = bonePlaces(design, names, null, 0)
  // Per motion, per row, per boned part: how far its bone has gone.
  const rows = clips.map((clip) => followMoments(clip).map((time) => bonePlaces(design, names, clip, time).map((place, at) => moved(place, rest[at]!))))
  const moves = (at: number) => rows.some((motion) => motion.some((row) => [row[at]!.forward, row[at]!.up, row[at]!.left].some((value) => Math.round(value * HITBOX_FOLLOW.unit) !== 0)))
  const followers = boned.map((part, at) => ({ ...part, at })).filter((part) => moves(part.at))
  if (!followers.length) return null
  const columns = (hitbox?.parts ?? []).map((_, index) => followers.findIndex((part) => part.index === index))
  const motions = clips.map((clip, motion) => ({
    name: clip.name,
    ticks: followTicks(clip),
    // Standing and walking go round and round; an ability is played once.
    loop: clip.name === "idle" || clip.name === "walk",
    moves: rows[motion]!.map((row) => followers.map((part) => encode(row[part.at]!.forward) + encode(row[part.at]!.up) + encode(row[part.at]!.left)).join("")).join(""),
  }))
  const row = (name: string) => motions.findIndex((motion) => motion.name === name)
  return { columns, followers: followers.length, motions, idle: row("idle"), walk: row("walk"), abilities: abilities.map((ability) => row(ability.clip)) }
}

/**
 * Where the table moves part `index` at `tick` ticks into a motion, read the way the generated Java reads it (`hitboxMoved`): null for a part that does not follow.
 * A looping motion wraps; any other holds its end. For the tests that hold the Java to this, and for nothing that is built.
 */
export function followedAt(follow: HitboxFollow, index: number, motion: number, tick: number): Place | null {
  const column = follow.columns[index] ?? -1
  const found = follow.motions[motion]
  if (column < 0 || !found) return null
  const width = follow.followers * 3 * HITBOX_FOLLOW.letters
  const last = found.moves.length / width - 1
  const at = Math.min(found.loop ? (((tick % found.ticks) + found.ticks) % found.ticks) / HITBOX_FOLLOW.every : Math.max(0, tick) / HITBOX_FOLLOW.every, last)
  const low = Math.floor(at)
  const high = Math.min(low + 1, last)
  const share = at - low
  const value = (row: number, axis: number) => decode(found.moves, row * width + (column * 3 + axis) * HITBOX_FOLLOW.letters)
  const axis = (which: number) => value(low, which) * (1 - share) + value(high, which) * share
  return { forward: axis(0), up: axis(1), left: axis(2) }
}

/** Where part `index` of a hitbox is moved by its bone at `time` seconds of `clip` (null: as built), unrounded: what a picture of the boxes at a moment draws. Zero for a part that does not follow a bone the model has. */
export function followedPlace(hitbox: Hitbox | null | undefined, design: Pick<ModelDesign, "bones">, index: number, clip: MotionClip | null, time: number): Place {
  const bone = hitbox?.parts?.[index]?.bone
  if (!bone || !design.bones.some((value) => value.name === bone)) return { forward: 0, up: 0, left: 0 }
  const [now, rest] = [bonePlaces(design, [bone], clip, time)[0] ?? null, bonePlaces(design, [bone], null, 0)[0] ?? null]
  return moved(now, rest)
}

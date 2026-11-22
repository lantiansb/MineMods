import { weightAt } from "@minemods/studio-ai/clip-weights"
import { EASINGS, type Easing, type KeyShape, type TrackKey } from "@minemods/studio-ai/animation"
import type { ModelDesign } from "@minemods/studio-ai/contracts"

/**
 * One key of the animation contract as a Blockbench keyframe has it, both ways (第 2 步). Blockbench's own words
 * for the interpolations are `linear`, `step`, `catmullrom` (the contract's `smooth`) and `bezier`, with the
 * handles under the very names the contract uses (`bezier_left_time` …), so a bezier key goes there and back
 * as it is. Blockbench has no easing of its own: GeckoLib's Blockbench plugin writes one as `easing` on the key
 * the eased segment ARRIVES at; the contract puts it on the key the segment leaves, so it is moved one key back
 * on the way in, and one key forward on the way out (a Blockbench without the plugin plays such a segment as
 * a straight line; the game and Studio play the easing either way).
 */

type Vec = [number, number, number]
const HANDLES = ["bezier_left_time", "bezier_left_value", "bezier_right_time", "bezier_right_value"] as const

/** Blockbench's word for a key's interpolation, and its handles when it is a bezier key. */
export type BlockbenchWord = "linear" | "step" | "catmullrom" | "bezier"
export function blockbenchKeyWords(key: KeyShape): { interpolation: BlockbenchWord } & Partial<Record<(typeof HANDLES)[number], Vec>> {
  const word: BlockbenchWord = key.interpolation === "step" ? "step" : key.interpolation === "smooth" ? "catmullrom" : key.interpolation === "bezier" ? "bezier" : "linear"
  return {
    interpolation: word,
    ...(word === "bezier" ? Object.fromEntries(HANDLES.map((name) => [name, [...(key[name] ?? (name === "bezier_left_time" ? [-0.1, -0.1, -0.1] : name === "bezier_right_time" ? [0.1, 0.1, 0.1] : [0, 0, 0]))]])) : {}),
  }
}

/**
 * The Blockbench words of every key of one track, in order: its interpolation (and handles), and the easing of
 * the segment arriving at it in GeckoLib's plugin's place for it. A key with nothing to say beyond a straight
 * line says nothing (`linear` is left out), so a version 2 track is written exactly as before.
 */
export function blockbenchTrackWords(keys: readonly KeyShape[]): ({ interpolation?: BlockbenchWord; easing?: Easing } & Partial<Record<(typeof HANDLES)[number], Vec>>)[] {
  return keys.map((key, index) => {
    const { interpolation, ...handles } = blockbenchKeyWords(key)
    const arriving = keys[index - 1]?.easing
    return { ...(interpolation === "linear" ? {} : { interpolation }), ...handles, ...(arriving ? { easing: arriving } : {}) }
  })
}

const vector = (value: unknown): Vec | null =>
  Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part)) ? ([value[0], value[1], value[2]] as Vec) : null

/**
 * A Blockbench keyframe's interpolation, handles and (GeckoLib plugin) easing in the contract's words, for keys
 * already sorted by time; `undefined` for a word the contract does not know. The easing a keyframe names is the
 * previous key's, the easing of the segment arriving at it.
 */
export function contractKeyWords(keyframes: readonly Record<string, unknown>[]): (KeyShape | undefined)[] {
  return keyframes.map((keyframe, index) => {
    const word = keyframe.interpolation ?? "linear"
    const interpolation = word === "linear" ? undefined : word === "step" ? "step" : word === "catmullrom" ? "smooth" : word === "bezier" ? "bezier" : null
    if (interpolation === null) return undefined
    const handles = interpolation === "bezier" ? Object.fromEntries(HANDLES.flatMap((name) => (vector(keyframe[name]) ? [[name, vector(keyframe[name])]] : []))) : {}
    const next = keyframes[index + 1]?.easing
    const easing = typeof next === "string" && next !== "linear" && (EASINGS as readonly string[]).includes(next) ? (next as Easing) : undefined
    return { ...(interpolation ? { interpolation } : {}), ...handles, ...(easing ? { easing } : {}) }
  })
}

/** A contract key from its time, value and the words `contractKeyWords` read. */
export const contractKey = (time: number, value: Vec, words: KeyShape): TrackKey => ({ time, value, ...words })

/**
 * 第 2 步: what a Blockbench file has no place for and a design edited there keeps from the design it was before: each clip's `blend` and
 * `layered` (by its name), the model's follow bones (those whose bone is still there, and not the root) and its feet on the ground (each leg
 * whose bones are all still there; the body only while it is). Nothing changes for a design that had none of it.
 */
export function keptPlayWords<D extends Pick<ModelDesign, "bones" | "animations" | "follow" | "foot_placement" | "look" | "sway">>(edited: D, before: Pick<ModelDesign, "animations" | "follow" | "foot_placement" | "look" | "sway"> | null): D {
  if (!before) return edited
  const clips = new Map(before.animations.map((clip) => [clip.name, clip]))
  const bones = new Map(edited.bones.map((bone) => [bone.name, bone]))
  const follow = (before.follow ?? []).filter((entry) => bones.get(entry.bone)?.parent)
  const connected = (chain: readonly string[]) => chain.every((name, i) => {
    if (!bones.has(name)) return false
    if (i === 0) return true
    const seen = new Set<string>()
    for (let p = bones.get(name)?.parent; p && !seen.has(p); p = bones.get(p)?.parent) {
      if (p === chain[i - 1]) return true
      seen.add(p)
    }
    return false
  })
  const gaze = before.look?.bones.filter(b => bones.has(b.bone)) ?? []
  const sway = before.sway?.flatMap(chain => {
    const kept = chain.bones.filter(name => bones.has(name))
    return kept.length && connected(kept) ? [{...chain, bones: kept}] : []
  })
  const placed = before.foot_placement
  const feet = (placed?.feet ?? []).filter((foot) => [foot.thigh, foot.calf, foot.foot].every((name) => !name || bones.has(name)))
  return {
    ...edited,
    animations: edited.animations.map((clip) => {
      const was = clips.get(clip.name)
      const weights = was?.weights && Object.fromEntries(Object.entries(was.weights).map(([layer, keys]) => {
        if (!keys?.length) return [layer, keys]
        if (clip.loop && keys.length > 1) return [layer, [{time:0, value:weightAt(keys, 0)}]]
        if (keys.at(-1)!.time <= clip.length) return [layer, keys]
        return [layer, [...keys.filter(key => key.time < clip.length), {time:clip.length, value:weightAt(keys, clip.length)}]]
      }))
      return { ...clip, ...(was?.display_name ? { display_name: was.display_name } : {}), ...(weights ? {weights} : {}), ...(was?.blend != null ? { blend: was.blend } : {}), ...(was?.layered != null ? { layered: was.layered } : {}) }
    }),
    ...(before.look && gaze.length && connected(gaze.map(b => b.bone)) ? {look:{...before.look, bones:gaze}} : {}),
    ...(sway?.length ? {sway} : {}),
    ...(follow.length ? { follow } : {}),
    ...(placed && feet.length ? { foot_placement: { ...placed, feet, body: placed.body && bones.has(placed.body) ? placed.body : null } } : {}),
  }
}

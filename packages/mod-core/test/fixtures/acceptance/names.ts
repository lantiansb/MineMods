import { ANIMATION_LIMITS, ASSET_STANDARDS, SPRITE_LIMITS } from "../../../src/acceptance"
import { GESTURE_GATE } from "../../../src/gesture-gate"
import { MOTION_MEASURES } from "@minemods/studio-ai/model-look"
import { LOOK_LIMITS } from "@minemods/studio-ai/model-quality"

// The standard's inner names: what its rules are called and what its measurements and limits are called.
// None of them may reach an AI or a person: an AI that is handed a number's name aims at the number.
// A plain lowercase word among the measurements (tones, turn, bones, animation) is left out: it cannot be told
// from ordinary writing or from the vocabulary of the documents themselves.
const compound = (name: string) => /[A-Z_]/.test(name)
export const INNER_NAMES = (measured: readonly (Record<string, unknown> | null)[] = []) => [
  ...new Set([
    ...Object.values(ASSET_STANDARDS).flatMap((standard) => standard.rules.map((rule) => rule.id)).filter((name) => compound(name) || name.length >= 7),
    ...[LOOK_LIMITS, GESTURE_GATE, SPRITE_LIMITS, ANIMATION_LIMITS, MOTION_MEASURES].flatMap((table) => Object.keys(table)).filter(compound),
    ...measured.flatMap((value) => Object.keys(value ?? {})).filter(compound),
  ]),
]

/**
 * The inner names a text gives away. One use of a rule's name is on purpose: a craft finding says how to answer it in the part sheet's
 * `justified` (`{"what":"tiny_fragments","reason":"……"}`), and `what` is the rule's id, the key the answer is read by. That snippet is not counted.
 */
export const leaked = (text: string, names: readonly string[] = INNER_NAMES()) => {
  const said = text.replace(/\{\\?"what\\?":\\?"[a-z_]+\\?",\\?"reason\\?":\\?"……\\?"\}/g, "")
  return names.filter((name) => new RegExp(`(?<![A-Za-z_])${name}(?![A-Za-z_])`).test(said))
}

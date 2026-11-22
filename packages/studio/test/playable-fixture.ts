import { appliesTo, PLAY_QUESTIONS } from "@minemods/mod-core/playable"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"

/**
 * For tests about something other than the playable standard: a plan whose things each give a plain answer
 * to every question their kind is asked, and the paper play-through an outside AI hands in with it.
 */
export function played<Plan extends { entries: BlueprintPlan["entries"] }>(plan: Plan): Plan {
  return {
    ...plan,
    entries: plan.entries.map((entry) =>
      entry.out_of_scope || entry.play || !appliesTo(entry.kind).length ? entry : { ...entry, play: { answers: appliesTo(entry.kind).map((question) => ({ question, words: `${PLAY_QUESTIONS[question].label}有交代`, from: "ai" as const, through: [] })), declined: [] } },
    ),
  }
}
export const PAPER = { findings: [], advice: [], independent: true }

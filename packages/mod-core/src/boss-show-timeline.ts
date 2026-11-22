import { TICKS } from "./ability-words"
import {
  bossShowOrder,
  bossShowStepWords,
  type ShowNames,
  type BossShowKind,
  type BossShowName,
  type BossShowStep,
} from "./boss-show"
import type { Boss } from "./entity-runtime"
const num = (value: number) => Number(value.toFixed(2))
/** The kinds of step that change how the model looks (a picture of the moment after each is worth drawing). */
const LOOKING: ReadonlySet<BossShowKind> = new Set(["clip", "glow", "drop", "place_structure"])
const MOST_MOMENTS = 5

/**
 * Per show the boss has steps in: its length (its seconds, or its last step when that is later: the runtime stretches it so), every step in order with its moment,
 * kind and words, and the moments to draw the model at: the start, each moment a step changes how it looks, and the end, at most five (the first, the last and evenly between).
 */
export function bossShowTimeline(boss: Pick<Boss, "intro" | "death">, names?: ShowNames) {
  const shows: {
    show: BossShowName
    name: string
    seconds: number
    written: number
    steps: { at: number; kind: BossShowKind; words: string; step: BossShowStep }[]
    moments: { at: number }[]
  }[] = []
  for (const show of ["intro", "death"] as const) {
    const own = show === "intro" ? boss.intro : boss.death
    const steps = own?.steps ?? []
    if (!own || !steps.length) continue
    const ordered = bossShowOrder(steps)
    const last = Math.max(...ordered.map((entry) => entry.tick)) / TICKS
    const seconds = Math.max(own.seconds, last)
    const changes = [
      ...new Set([
        0,
        ...ordered.filter((entry) => LOOKING.has(entry.step.type)).map((entry) => num(entry.step.at)),
        num(seconds),
      ]),
    ].sort((a, b) => a - b)
    const middle = changes.slice(1, -1)
    const room = MOST_MOMENTS - 2
    const picked =
      changes.length <= MOST_MOMENTS
        ? changes
        : [
            changes[0]!,
            ...Array.from(
              { length: room },
              (_, index) => middle[Math.round((index * (middle.length - 1)) / (room - 1))]!,
            ),
            changes.at(-1)!,
          ]
    shows.push({
      show,
      name: show === "intro" ? "登场" : "死亡",
      seconds,
      written: own.seconds,
      steps: ordered.map((entry) => ({
        at: entry.step.at,
        kind: entry.step.type,
        words: bossShowStepWords(entry.step, names),
        step: entry.step,
      })),
      moments: [...new Set(picked)].map((at) => ({ at })),
    })
  }
  return shows
}
export type ShowTimeline = ReturnType<typeof bossShowTimeline>[number]

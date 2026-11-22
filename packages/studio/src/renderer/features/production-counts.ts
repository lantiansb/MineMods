import { KEPT_WORDS } from "@minemods/mod-core/kept-words"
import type { OverviewItem, ProjectOverview } from "../../api"

/**
 * How the overview counts what is made, in one place so the strip, the road's 制作 stage and the progress bar say the same number
 * (broad19: a Boss whose independent review stopped it was kept as a saved version, and the strip said 已做好 4 / 5 while the road and
 * the bar counted differently). "Done" is `production.done`: saved, not being made again, and not a version that was kept without
 * passing its review. Those kept versions are saved and handed to the person, so they are counted apart and said as that.
 */
type Production = ProjectOverview["production"]
export type Counted = Pick<Production, "total" | "done" | "remaking" | "unsatisfied" | "interrupted"> & Partial<Pick<Production, "queued" | "queued_again">>

/** What was saved but is not counted as done, as short phrases for the end of a count line. Empty when every saved thing passed. */
export function heldWords(production: Pick<Counted, "unsatisfied" | "interrupted">): string[] {
  return [
    ...(production.unsatisfied ? [KEPT_WORDS.unsatisfied(production.unsatisfied)] : []),
    ...(production.interrupted ? [KEPT_WORDS.interrupted(production.interrupted)] : []),
  ]
}

/** The longer sentence behind the phrases, for a hover or a hint: why those are not counted as done, and who decides about them. */
export function heldHint(production: Pick<Counted, "unsatisfied" | "interrupted">): string {
  const parts = [
    production.unsatisfied ? `${production.unsatisfied} 样：AI 做到最后还是不满意，把它最好的一版先留给你，没有算「已做好」` : "",
    production.interrupted ? `${production.interrupted} 样：制作中途被打断（软件关了或连接断了），存下的是打断前的一版，还没做完审查` : "",
  ].filter(Boolean)
  return parts.length ? `${parts.join("；")}。可不可以，由你看了决定。` : ""
}

/** "已做好 3 / 5", or the all-passed sentence when every saved thing is done and none is left out. */
export function doneLine(production: Counted): string {
  return production.done >= production.total ? `全部做好了，一共 ${production.total} 样` : `已做好 ${production.done} / ${production.total}`
}

/** The count a stage of the road shows beside 制作: done of total, and what is being made again or was kept without a pass. */
export function makeCount(production: Counted): string {
  // Waiting is not making: what has a place in the run but nothing started on it is counted as 排队, apart from what is being made again.
  const again = Math.max(production.remaking - (production.queued_again ?? 0), 0)
  const rest = [...(again ? [`重做 ${again}`] : []), ...(production.queued ? [`排队 ${production.queued}`] : []), ...(production.unsatisfied ? [`${production.unsatisfied} 样没通过审查`] : []), ...(production.interrupted ? [`${production.interrupted} 样被中断`] : [])]
  return `${production.done} / ${production.total}${rest.length ? ` · ${rest.join(" · ")}` : ""}`
}

/** How much of the bar is green: the share that is done, never the share merely saved. */
export const doneShare = (production: Pick<Counted, "total" | "done">) => production.done / Math.max(production.total, 1)

/** The bar's second segment: saved but kept without a pass (amber), drawn after the green so the two never overlap. */
export const heldShare = (production: Pick<Counted, "total" | "unsatisfied" | "interrupted">) => (production.unsatisfied + production.interrupted) / Math.max(production.total, 1)

/**
 * The end of a walk through the things waiting for a verdict. It closes the batch the person opened, not the project (broad20: 「都看完了」 was read as the
 * whole mod being finished while the AI went on saving new things and some were sent back). So it names the batch by its size.
 */
export const WALK_WORDS = {
  done: (count: number) => `这次打开的 ${count} 样看完了`,
  /** What is still open in the whole project, said after the batch is done. */
  left: (rest: string[]) => `工程里还剩：${rest.join("、")}。`,
} as const

/**
 * What the project still has open, from the same counts the strip shows, only the ones that are not zero. 「重做」 is both the ones sent back that
 * have not been started again and those being made again now; 「还在做」 is what is being made for the first time. 「排队」 is what has a place in the
 * run but nothing has started on (first time or again): it is not in either of the other two, so a count never calls waiting work "being made".
 */
export function leftWords(production: Pick<Production, "making" | "remaking" | "to_review" | "to_redo"> & Partial<Pick<Production, "queued" | "queued_again">>): string[] {
  const queued = production.queued ?? 0
  const again = production.queued_again ?? 0
  const making = Math.max(production.making - production.remaking - (queued - again), 0)
  const redoing = Math.max(production.remaking - again, 0) + production.to_redo
  return [...(making ? [`还在做 ${making} 样`] : []), ...(queued ? [`排队 ${queued} 样`] : []), ...(production.to_review ? [`等你验收 ${production.to_review} 样`] : []), ...(redoing ? [`重做中 ${redoing} 样`] : [])]
}

/** How many names the queue line says before it counts the rest. */
const QUEUE_NAMES = 3

/**
 * Why one thing is in the queue, in plain words: it waits for what it needs to be made first (named), or it only waits for its turn. Never 「正在做」:
 * nothing has started on it.
 */
export function queueWords(item: Pick<OverviewItem, "queued">): string {
  const waiting = item.queued?.waiting_for ?? []
  if (!waiting.length) return "在排队，还没轮到它"
  const said = waiting.slice(0, QUEUE_NAMES).map((title) => `「${title}」`).join("")
  return `在排队，等${said}${waiting.length > QUEUE_NAMES ? `等 ${waiting.length} 样` : ""}先做好`
}

/** The strip's line for the queue: how many wait and for what, or an empty string when nothing is queued. «排队 2 样：等「铜镐」先做好» */
export function queueLine(items: Pick<OverviewItem, "title" | "queued">[]): string {
  const queued = items.filter((item) => item.queued)
  if (!queued.length) return ""
  const waiting = [...new Set(queued.flatMap((item) => item.queued!.waiting_for))]
  const for_ = waiting.length ? `：等${waiting.slice(0, QUEUE_NAMES).map((title) => `「${title}」`).join("")}${waiting.length > QUEUE_NAMES ? `等 ${waiting.length} 样` : ""}先做好` : "：等着轮到它们"
  return `排队 ${queued.length} 样${for_}`
}

import type { ActivityEvent, Making, MakingRound, OverviewItem, OverviewStatus } from "../../api"
import { queueWords } from "./production-counts"
import { detailTag } from "./model-detail"

/**
 * How 制作现场 reads what a project has on record. Pure, so it can be checked without a screen.
 *
 * The rule the page keeps (完整管控): anything that has a record gets a row. A thing of the overview is a
 * row whether or not anything happened to it; a thing that only the activity log still knows (its blueprint
 * entry is gone) is a row; and everything that is about the mod as a whole (ideas and blueprint, batches,
 * builds, what the person did, an outside AI's calls, checks, notes) is one row per sort of record.
 */
export type FloorState = "making" | "queued" | "review" | "done" | "stuck" | "waiting" | "skipped" | "gone" | "whole"
/** The groups of the list, in the order they are shown. */
export const FLOOR_STATES: { id: FloorState; label: string }[] = [
  { id: "making", label: "正在做" },
  { id: "queued", label: "在排队" },
  { id: "review", label: "等你验收" },
  { id: "done", label: "做好了" },
  { id: "stuck", label: "没做成 · 被卡住" },
  { id: "waiting", label: "还没做 · 要重做" },
  { id: "skipped", label: "不做这个了" },
  { id: "gone", label: "不在蓝图里的（单独做的，或者蓝图里已经拿掉的）" },
  { id: "whole", label: "整个模组的事" },
]
const OF_STATUS: Record<OverviewStatus, FloorState> = {
  making: "making",
  review: "review",
  saved: "done",
  built: "done",
  verified: "done",
  failed: "stuck",
  blocked: "stuck",
  planned: "waiting",
  redo: "waiting",
  out_of_scope: "skipped",
}
export type WholeKind = "plan" | "batch" | "build" | "person" | "tool" | "check" | "note"
/** Records about the mod as a whole, one row per sort. Work events (`task`, `look`, `review`) without a thing are kept with the batches. */
export const WHOLE_ROWS: { kind: WholeKind; title: string; label: string }[] = [
  { kind: "plan", title: "想法和蓝图", label: "规划" },
  { kind: "batch", title: "一批一批的任务", label: "任务" },
  { kind: "build", title: "做进模组", label: "打包" },
  { kind: "person", title: "你做的决定", label: "你" },
  { kind: "tool", title: "外部 AI 的调用", label: "外部 AI" },
  { kind: "check", title: "检查", label: "检查" },
  { kind: "note", title: "别的记录", label: "记录" },
]
const wholeKind = (kind: ActivityEvent["kind"]): WholeKind => (kind === "task" || kind === "look" || kind === "review" ? "batch" : kind)
export const wholeId = (kind: WholeKind) => `whole:${kind}`
export const isWhole = (id: string) => id.startsWith("whole:")

export type RowMark = "run" | "ok" | "fail" | "warn" | "note" | "idle"
export type FloorRow = {
  /** The overview item's id, or `whole:<kind>` for a record about the mod as a whole. */
  id: string
  item: OverviewItem | null
  state: FloorState
  title: string
  /** The kind's id for a thing; empty for the whole mod. */
  kind: string
  kindLabel: string
  /** How many versions were made and looked at; 0 when none were. */
  rounds: number
  /** The last word on it, as one plain sentence. */
  verdict: string
  /** When anything was last recorded about it; null when nothing carries a time. */
  at: string | null
  mark: RowMark
  /** Every event about it, oldest first, steps and quiet ones included. */
  events: ActivityEvent[]
  /** Everything a search may match, lower case. */
  search: string
}
export type FloorInput = {
  items: OverviewItem[]
  kinds: { id: string; label: string }[]
  makings: Record<string, Making | undefined>
  events: ActivityEvent[]
  /** `makingLine` of the making story, passed in so this file stays free of screen code. */
  say: (making: Making) => string
  /** The 模型精细度 button at the top as it stands: a model made by another level carries that level beside its kind (`detailTag`). */
  top?: "low" | "medium" | "high"
  /** Rows that exist although the log says nothing about them: there are runs (batch), there is a build job (build). */
  whole?: Partial<Record<WholeKind, { verdict: string; at: string | null; mark: RowMark; search?: string }>>
}

const newest = (times: (string | null | undefined)[]) =>
  times.reduce<string | null>((best, time) => (time && (!best || Date.parse(time) > Date.parse(best)) ? time : best), null)
const told = (event: ActivityEvent) => !event.step && !event.quiet
const STATUS_MARK: Record<OverviewStatus, RowMark> = { making: "run", review: "warn", saved: "ok", built: "ok", verified: "ok", failed: "fail", blocked: "fail", planned: "idle", redo: "warn", out_of_scope: "note" }

/** A saved version that was kept without a pass (its AI was not satisfied, or its making was cut short) and that nobody has answered yet. */
const kept = (item: OverviewItem) => item.ai_unsatisfied === true || item.ai_interrupted === true
/**
 * Where a thing stands in the list. A kept version waits for the person's answer because its status says so (every version an AI made does): the list,
 * the count of what waits and the card of the thing read the same status, so 「等你验收」 here always has the button on the card.
 */
const stateOf = (item: OverviewItem): FloorState => (item.status === "making" && item.queued ? "queued" : OF_STATUS[item.status])

/** Every row of the list, in no particular order; `groupRows` orders them. */
export function floorRows(input: FloorInput): FloorRow[] {
  const labels = new Map(input.kinds.map((kind) => [kind.id, kind.label]))
  // A record names its thing as it was known then: the id of the asset made for it, or the id part of a hand-made `kind:id` item. The same thing may
  // be known by another id now (a plan entry took over content made by hand and changed it in place: the entry's key is the row, the old id is its
  // asset). A record that names such an id is about that row, not about something the plan left out (broad18 r82); the item's own id always wins.
  const home = new Map<string, string>()
  input.items.forEach((item) => {
    const names = [item.asset_id, item.id.includes(":") ? item.id.slice(item.id.indexOf(":") + 1) : null]
    names.forEach((name) => name && !input.items.some((other) => other.id === name) && !home.has(name) && home.set(name, item.id))
  })
  const byItem = new Map<string, ActivityEvent[]>()
  input.events.forEach((event) => {
    const key = event.item ? (home.get(event.item) ?? event.item) : wholeId(wholeKind(event.kind))
    const own = byItem.get(key)
    if (own) own.push(event)
    if (!own) byItem.set(key, [event])
  })
  const things = input.items.map<FloorRow>((item) => {
    const making = input.makings[item.id]
    const events = byItem.get(item.id) ?? []
    const last = events.filter(told).at(-1)
    const live = item.status === "making" && !item.queued ? events.filter((event) => event.step).at(-1) : undefined
    // A queued thing says what it waits for, not what an earlier try did: nothing has started on it.
    const verdict = item.queued ? queueWords(item) : live?.text ?? (making ? `AI ${input.say(making)}` : (item.reason ?? item.out_of_scope ?? last?.text ?? item.status_label))
    const kindLabel = [labels.get(item.kind) ?? item.kind, detailTag(item, input.top)].filter(Boolean).join(" · ")
    return {
      id: item.id,
      item,
      state: stateOf(item),
      title: item.title,
      kind: item.kind,
      kindLabel,
      rounds: making?.rounds.length ?? Math.max(0, ...events.map((event) => event.round ?? 0)),
      verdict,
      at: newest([making?.review?.at, making?.rounds.at(-1)?.at, events.at(-1)?.at, item.review?.at]),
      mark: item.queued ? "idle" : kept(item) && STATUS_MARK[item.status] === "ok" ? "warn" : STATUS_MARK[item.status],
      events,
      search: [item.title, item.brief, kindLabel, item.status_label, verdict, item.reason, item.review?.note, making?.sheet?.subject, ...events.flatMap((event) => [event.text, ...(event.lines ?? [])])].filter(Boolean).join("\n").toLowerCase(),
    }
  })
  const known = new Set(input.items.map((item) => item.id))
  // Still in the log, no longer in the overview: the blueprint changed, the record stays.
  const gone = [...byItem.entries()]
    .filter(([key]) => !isWhole(key) && !known.has(key))
    .map<FloorRow>(([key, events]) => {
      const last = events.filter(told).at(-1) ?? events.at(-1)!
      const end = events.filter((event) => event.end).at(-1)
      return {
        id: key,
        item: null,
        state: "gone",
        title: events.filter((event) => event.title).at(-1)?.title ?? "一样东西",
        kind: "",
        kindLabel: "已不在蓝图里",
        rounds: Math.max(0, ...events.map((event) => event.round ?? 0)),
        verdict: last.text,
        at: events.at(-1)!.at,
        mark: end ? (end.mark === "run" ? "idle" : end.mark) : "idle",
        events,
        search: [...events.flatMap((event) => [event.title, event.text, ...(event.lines ?? [])])].filter(Boolean).join("\n").toLowerCase(),
      }
    })
  const whole = WHOLE_ROWS.flatMap<FloorRow>((row) => {
    const events = byItem.get(wholeId(row.kind)) ?? []
    const extra = input.whole?.[row.kind]
    if (!events.length && !extra) return []
    const last = events.filter(told).at(-1)
    const end = events.filter((event) => event.end).at(-1)
    const open = !!events.length && events.at(-1) !== end && !!events.filter((event) => !event.quiet).length && ["plan", "batch", "build"].includes(row.kind)
    return [
      {
        id: wholeId(row.kind),
        item: null,
        state: "whole",
        title: row.title,
        kind: "",
        kindLabel: row.label,
        rounds: 0,
        verdict: last?.text ?? extra?.verdict ?? (events.length ? "只有给「高级」看的记录" : ""),
        at: newest([events.at(-1)?.at, extra?.at]),
        mark: extra && !last ? extra.mark : open && last?.mark === "run" ? "run" : (last?.mark === "run" ? "note" : (last?.mark ?? "note")),
        events,
        search: [row.title, row.label, extra?.verdict, extra?.search, ...events.flatMap((event) => [event.text, ...(event.lines ?? [])])].filter(Boolean).join("\n").toLowerCase(),
      },
    ]
  })
  return [...things, ...gone, ...whole]
}

export type FloorFilter = { search: string; state: FloorState | ""; kind: string }
/** Rows that pass the search box and the two filters. Every word of the search has to be found. */
export function filterRows(rows: FloorRow[], filter: FloorFilter) {
  const words = filter.search.toLowerCase().split(/\s+/).filter(Boolean)
  return rows.filter((row) => (!filter.state || row.state === filter.state) && (!filter.kind || row.kind === filter.kind) && words.every((word) => row.search.includes(word)))
}

/** The list as it is shown: the groups that have rows, each with the most recently touched row first. */
export function groupRows(rows: FloorRow[]) {
  return FLOOR_STATES.flatMap((state) => {
    const own = rows.filter((row) => row.state === state.id)
    if (!own.length) return []
    // Rows about the whole mod keep their fixed order; things go newest first, the ones without a time last.
    const ordered = state.id === "whole" ? own : [...own].sort((left, right) => (Date.parse(right.at ?? "") || 0) - (Date.parse(left.at ?? "") || 0))
    return [{ ...state, rows: ordered }]
  })
}

/** The thing the page follows: of the things being made, the one that last gave a sign of life. */
export function nowMaking(rows: FloorRow[]) {
  return rows.filter((row) => row.state === "making").sort((left, right) => (Date.parse(right.at ?? "") || 0) - (Date.parse(left.at ?? "") || 0))[0] ?? null
}

/**
 * One line of a thing's story. An `event` is a node of the activity log; a `round` is a version the making
 * record keeps with its pictures; a `review` is the record's final review.
 */
export type Moment =
  | { type: "event"; at: string; event: ActivityEvent }
  | { type: "round"; at: string; round: MakingRound }
  | { type: "review"; at: string; review: NonNullable<Making["review"]> }

/**
 * A thing's whole story in the order it happened: the making record's rounds and review, and every event the
 * log has about it. Without 高级, steps (only ever a live line) and quiet events (told by another one) are left
 * out, as the 动态 panel leaves them out; with it nothing is.
 */
export function thingTimeline(making: Making | null | undefined, events: ActivityEvent[], advanced: boolean) {
  const end = events.filter((event) => event.end).at(-1)
  const step = events.filter((event) => event.step).at(-1)
  const moments: Moment[] = [
    ...events.filter((event) => advanced || told(event)).map((event) => ({ type: "event" as const, at: event.at, event })),
    ...(making?.rounds ?? []).map((round) => ({ type: "round" as const, at: round.at, round })),
    ...(making?.review ? [{ type: "review" as const, at: making.review.at, review: making.review }] : []),
  ]
  const order = (moment: Moment) => (moment.type === "event" ? moment.event.seq : 0)
  return {
    // The sort is stable: at the same instant the record's own entries come before the log's, and events keep their order.
    moments: moments.map((moment, index) => ({ moment, index })).sort((left, right) => Date.parse(left.moment.at) - Date.parse(right.moment.at) || order(left.moment) - order(right.moment) || left.index - right.index).map((entry) => entry.moment),
    /** What is being done right now: the newest step, unless something after it has ended the thing. */
    live: step && (!end || step.seq > end.seq) ? step : null,
  }
}

/** The newest events across all things as the live view shows them, oldest first. */
export function recentEvents(events: ActivityEvent[], advanced: boolean, count: number) {
  return events.filter((event) => advanced || told(event)).slice(-count)
}

/** A review of one version, as far as the page knows of it: the record's own, or one the log still tells of. */
export type RoundReview = { round: number; passed: boolean; /** Unknown for a review only the log remembers. */ independent: boolean | null; /** The first blocking finding, when it failed and said why. */ finding: string | null }
type Reviewed = Pick<Making, "rounds" | "review">
type Told = Pick<ActivityEvent, "at" | "kind" | "mark" | "round" | "lines">

/**
 * Every review of this making's versions, the newest of each version last. A making record keeps only its
 * newest review; the ones before it (round 18: five versions in a row handed in and failed) are still in the
 * log as `review` events that ended well or badly and name their version. Events from before this making's
 * first version belong to a making that was replaced and are left out.
 */
export function roundReviews(making: Reviewed, events: readonly Told[] = []): RoundReview[] {
  const began = Date.parse(making.rounds[0]?.at ?? "")
  const logged = events
    .filter((event) => event.kind === "review" && event.round !== undefined && (event.mark === "ok" || event.mark === "fail") && Date.parse(event.at) >= began)
    .map<RoundReview>((event) => ({ round: event.round!, passed: event.mark === "ok", independent: null, finding: event.mark === "fail" ? (event.lines?.[0] ?? null) : null }))
  const review = making.review
  // A record from before reviews said which version they were of was always of the last one.
  const of = review ? (review.round === undefined ? making.rounds.at(-1)?.round : review.round) : null
  return [...logged, ...(review && typeof of === "number" ? [{ round: of, passed: review.passed, independent: review.independent, finding: review.passed ? null : (review.findings[0] ?? null) }] : [])]
}

/**
 * `pass`: a review passed it, the only thing shown as a pass. `fail`: a review failed it. `own`: only its
 * maker's opinion, which is nobody's verdict. `revise`: its maker wants to change it. `wait`: not judged by anyone yet.
 */
export type RoundTone = "pass" | "fail" | "own" | "revise" | "wait"
export const ROUND_WORDS = {
  wait: "还没有它自己的检查",
  pass: "审查通过",
  self_pass: "做它的 AI 自己审查的，算通过；没有另一位把关",
  fail: "审查没过",
  own_waiting: "做它的 AI 自己觉得可以了，等审查",
  own_later: "做它的 AI 自己觉得可以了，后来又改了一版",
  own_only: "做它的 AI 自己觉得可以了，没有另外审查",
  revise: "还要改",
} as const

/**
 * What stands on a round, for 制作现场 and for the filmstrip of the acceptance card alike. Round 18: a maker's
 * "done" read 「它觉得行了」 in green on five versions that each failed the review that followed, and was taken
 * for a pass. The maker's opinion is now worded as its own and never a pass; a review of that version, when
 * there was one, is what the round says. `short` fits under a thumbnail.
 */
export function roundVerdict(making: (Reviewed & Partial<Pick<Making, "state">>) | null | undefined, round: MakingRound, events: readonly Told[] = []): { tone: RoundTone; words: string; short: string } {
  const review = making ? roundReviews(making, events).filter((value) => value.round === round.round).at(-1) : undefined
  if (review?.passed) return review.independent === false ? { tone: "own", words: ROUND_WORDS.self_pass, short: "自己审查的" } : { tone: "pass", words: ROUND_WORDS.pass, short: ROUND_WORDS.pass }
  if (review) return { tone: "fail", words: review.finding ? `${ROUND_WORDS.fail}：${review.finding}` : ROUND_WORDS.fail, short: ROUND_WORDS.fail }
  if (!round.self_review) return { tone: "wait", words: ROUND_WORDS.wait, short: "" }
  if (round.self_review.verdict === "revise") {
    const must = round.self_review.problems.length + round.findings.length
    return { tone: "revise", words: must ? `${ROUND_WORDS.revise} · ${must} 处毛病` : ROUND_WORDS.revise, short: ROUND_WORDS.revise }
  }
  const later = !!making && making.rounds.some((value) => value.round > round.round)
  const live = !making?.state || making.state === "making" || making.state === "reviewing" || making.state === "describing"
  return { tone: "own", words: later ? ROUND_WORDS.own_later : live ? ROUND_WORDS.own_waiting : ROUND_WORDS.own_only, short: later || !live ? "自己说可以" : "等审查" }
}

/** Said where an old record is opened whose version is gone. */
export const REPLACED_WORDS = "这是重做之前的记录，那一版已经被新的替换了"
type Span = { rounds: readonly Pick<MakingRound, "round" | "at">[] }
export type RecordTarget = { making: "current"; round: number } | { making: "earlier"; index: number; round: number } | { making: "replaced" }

/**
 * Which making a record's round is a round of. Round 18: after a redo the new making counts its versions
 * from 1 again, so an old 「第 3 版还要改」 opened version 3 of the new making and the words did not match the
 * pictures. A round's number is therefore never enough: the record's time decides. A making begins with its
 * first version; a record from before that belongs to an earlier making (`earlier`, oldest first, when the
 * caller has them), and when none of those holds it either, to one that was replaced and is gone.
 * Null: the record names no round, or no making has been read, so there is nothing to choose between.
 */
export function recordRound(record: Pick<ActivityEvent, "at" | "round">, making: Span | null | undefined, earlier: readonly Span[] = []): RecordTarget | null {
  if (record.round === undefined || !making) return null
  const at = Date.parse(record.at)
  const holds = (span: Span) => !!span.rounds.length && at >= Date.parse(span.rounds[0]!.at) && span.rounds.some((round) => round.round === record.round)
  if (holds(making)) return { making: "current", round: record.round }
  // Of the earlier makings, the newest that had begun by then.
  const index = earlier.reduce((found, span, place) => (holds(span) ? place : found), -1)
  return index >= 0 ? { making: "earlier", index, round: record.round } : { making: "replaced" }
}

/** A day and a clock time, short: today is only the clock time. */
export function shortWhen(at: string | null, now = Date.now()) {
  if (!at || Number.isNaN(Date.parse(at))) return ""
  const date = new Date(at)
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
  return new Date(now).toDateString() === date.toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`
}


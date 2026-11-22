import { blindFit, UNSATISFIED } from "@minemods/studio-ai/making"
import type { ActivityEvent } from "./activity"
import type { OverviewStatusId } from "./asset-overview"
import { plainCheckLines, type GameplayCheck } from "./gameplay-check"
import type { GameplayRecord } from "./gameplay-loop"
import { INTERRUPTED_WORDS, type MakingRecord } from "./making"
import { splitForPerson } from "./play-words"
import type { SceneReport } from "./scene"
import { assetKind, type ModuleKind } from "./workspace-modules"

/**
 * 验收回执: what Studio measured, refused and verified for one project, read from the records it already keeps and from
 * nothing else. Facts only, in the words a player reads: every number is a count of something written down, every line is
 * a sentence a record already holds (cut short, never reworded into praise). This file is the whole assembly and is pure:
 * the studio service reads the records and hands them in.
 */

export const RECEIPT_LIMITS = { things: 200, caught: 30, blind: 12, unverified: 40, why: 90 } as const

/** Who refused the version, in the words shown beside the line. */
export const CAUGHT_HOW = {
  standard: "检查标准量出来的",
  save: "交上来时被退回",
  review: "另一位 AI 没让过",
  code: "代码检查没过",
} as const
export type CaughtBy = keyof typeof CAUGHT_HOW

export const RECEIPT_WORDS = {
  /** A thing the game has not set out. */
  game_unchecked: "游戏还没查过它",
  game_failed: "游戏自动检查没通过",
  no_review: "没有经过另一位 AI 审查",
  self_reviewed: "审查的是做它的 AI 自己",
  review_failed: "另一位 AI 审查没通过",
  unblind: "没有做盲认（先只凭图说出它是什么）",
} as const

export type ReceiptThing = {
  id: string
  title: string
  kind: ModuleKind
  kind_label: string
  status: OverviewStatusId
  status_label: string
  saved: boolean
}

export type ReceiptCaught = {
  /** `OverviewItem.id`: what the making story of this thing is opened by. */
  item: string
  title: string
  /** The version it was about; null when the record does not say which. */
  round: number | null
  /** One plain line. */
  why: string
  /** A later version, or a saved one, no longer has it. */
  fixed: boolean
  /** The version that no longer had it, when that is known. */
  fixed_in: number | null
  by: CaughtBy
  how: string
  /** When the round was looked at or the refusal was written: what a making story opened at this round is found by. */
  at: string
}

export type ReceiptGame = {
  checked_at: string
  /** The game was started with the mod in it. */
  started: boolean
  /** What was set out in the world. */
  total: number
  /** The game took the command that puts them there. */
  placed: number
  /** Creatures that were waited on, and how many of them were still there. Blocks and items are not waited on. */
  waited: number
  present: number
  /** The findings of the check, as many as it wrote. */
  problems: number
  /** The check is of the project as it is now. */
  current: boolean
}

export type Receipt = {
  things: ReceiptThing[]
  made: { rounds: number; things: number; firstTry: number; most: { item: string; title: string; rounds: number } | null }
  caught: ReceiptCaught[]
  /** How many there were before the list was cut. */
  caught_total: number
  reviewed: {
    passed: number
    total: number
    /** How many times a version was refused by the other AI, over everything the log still holds. */
    refusals: number
    blind: { item: string; title: string; said: string; named: string; recognised: boolean | null }[]
  }
  game: ReceiptGame | null
  /** What the verification record says of the saved things that go into the mod: how many the game's own check passed or failed, of how many. */
  checked: { total: number; passed: number; failed: number }
  unverified: { id: string; title: string; why: string }[]
}

export type ReceiptItem = {
  id: string
  key: string | null
  asset_id: string | null
  kind: ModuleKind
  title: string
  status: OverviewStatusId
  status_label: string
  reason: string | null
  facts: { saved: boolean; gametest: boolean | null }
  ai_unsatisfied?: boolean
  ai_interrupted?: boolean
  /** The kind goes into the built mod, so the game can be asked about it. */
  runtime: boolean
}

type ReviewLike = { independent: boolean; passed: boolean; findings: readonly string[]; at: string; fingerprint?: string }
export type ReceiptMaking = Pick<MakingRecord, "asset_id" | "entry" | "outcome" | "kept_reason"> & {
  rounds: readonly { round: number; at: string; fingerprint?: string; findings: readonly string[] }[]
  review: (ReviewLike & { blind?: { said: string; recognised: boolean; fits?: "at_once" | "with_name" | "no"; named: string } | null }) | null
  best?: { round: number } | null
}
export type ReceiptGameplay = Pick<GameplayRecord, "asset_id" | "entry" | "outcome" | "kept_reason"> & {
  rounds: readonly { round: number; at: string; fingerprint?: string; passed: boolean; check: GameplayCheck }[]
  review: ReviewLike | null
  saved?: unknown
}
export type ReceiptEvent = Pick<ActivityEvent, "seq" | "at" | "kind" | "mark" | "item" | "title" | "text"> & Partial<Pick<ActivityEvent, "end" | "lines" | "tool" | "round">>
export type ReceiptScene = { record: { checked_at?: string; report?: Pick<SceneReport, "started" | "things" | "findings"> } | null; current: boolean }

export type ReceiptInput = {
  items: readonly ReceiptItem[]
  makings: readonly ReceiptMaking[]
  gameplays: readonly ReceiptGameplay[]
  events: readonly ReceiptEvent[]
  scene: ReceiptScene | null
}

/** The first sentence of a longer finding, short enough for a line of the book; cut before a bracket that would be left open. */
export function oneLine(text: string, max: number = RECEIPT_LIMITS.why) {
  const flat = text.replace(/\s+/g, " ").trim()
  const stop = flat.search(/[。！？]/)
  const first = stop > 0 ? flat.slice(0, stop) : flat
  if (first.length <= max) return first
  const cut = first.slice(0, max - 1)
  const open = Math.max(cut.lastIndexOf("（"), cut.lastIndexOf("「"))
  const closed = Math.max(cut.lastIndexOf("）"), cut.lastIndexOf("」"))
  return `${(open > closed && open >= 8 ? cut.slice(0, open) : cut).replace(/[、，；：\s]+$/, "")}…`
}

/** What one finding is about, without the numbers and names that change between versions of the same fault: the criterion and its heading. */
const faultKey = (line: string) => line.split(/[：:（(。]/).slice(0, 2).join("：")

// A refused call is about the work only when the standard refused the version itself (what the maker may not call finished, what cannot be saved).
// The rest of what the door says is about how the call was made (a missing step, a wrong field) and is not a fault in anything made.
const REFUSED_WORK: [RegExp, (line: string) => string][] = [
  [/^验收标准在这一版上还查出了毛病，不能说做完：/, (line) => line.replace(/^[^：]*：/, "")],
  [/^有动作.{0,20}，不能直接说做完：/, (line) => line.replace(/^[^：]*：/, "")],
  [/^量出来的事实里还有没有回答的，不能直接说做完：/, (line) => line.replace(/^[^：]*：/, "")],
  [/^(?:和原版对照，量出来有|贴图量出来的事实里有还没有回答的).*不能直接说做完：/, (line) => line.replace(/^[^：]*：/, "")],
  [/^这一版照现在的样子存不进工程，提交会被拒绝：/, (line) => `存不进工程：${line.replace(/^[^：]*：/, "")}`],
  [/^新交的这一版和上一版一模一样/, (line) => line],
]
/** What a refused call says about the work, or null when it is only about how the call was made. */
export function refusedWork(line: string) {
  const found = REFUSED_WORK.find(([pattern]) => pattern.test(line))
  return found ? found[1](line).trim() || null : null
}
// The runner's own words for a hand-in sent back (task events) are the standard's findings as they were; only these are about no work at all.
const NOT_ABOUT_THE_WORK = /技术问题|读不懂|尚未领取|已结束|没有可以看的样子/
const REFUSING_TOOLS = ["commit_task", "self_review"]

/** The first reason an AI gave for not being satisfied that a person can read: a line that is mostly code stays in the record for 高级 and is not the one told here. */
const keptReason = (reasons: readonly string[] | undefined) => splitForPerson(reasons ?? []).shown[0]

const byTime = (left: { at: string }, right: { at: string }) => right.at.localeCompare(left.at)

export function buildReceipt(input: ReceiptInput): Receipt {
  const items = input.items.filter((item) => item.status !== "out_of_scope")
  const itemOf = (record: { asset_id: string; entry: string | null }) => items.find((item) => item.asset_id === record.asset_id) ?? (record.entry ? items.find((item) => item.key === record.entry) : undefined)
  const makings = input.makings.flatMap((record) => ((item) => (item ? [{ record, item }] : []))(itemOf(record)))
  const gameplays = input.gameplays.flatMap((record) => ((item) => (item ? [{ record, item }] : []))(itemOf(record)))
  const events = [...input.events].sort((left, right) => left.seq - right.seq)

  const things = items.slice(0, RECEIPT_LIMITS.things).map(
    (item): ReceiptThing => ({ id: item.id, title: item.title, kind: item.kind, kind_label: assetKind(item.kind).label, status: item.status, status_label: item.status_label, saved: item.facts.saved }),
  )

  // --- how many rounds -------------------------------------------------------------------------------------------
  const spans = [
    ...makings.map(({ record, item }) => ({ item, rounds: record.rounds.length, passed: record.review?.passed === true })),
    ...gameplays.map(({ record, item }) => ({ item, rounds: record.rounds.length, passed: record.review?.passed === true })),
  ].filter((span) => span.rounds > 0)
  const most = spans.reduce<(typeof spans)[number] | null>((found, span) => (!found || span.rounds > found.rounds ? span : found), null)
  const made = {
    rounds: spans.reduce((sum, span) => sum + span.rounds, 0),
    things: spans.length,
    firstTry: spans.filter((span) => span.rounds === 1 && span.passed).length,
    most: most && most.rounds >= 2 ? { item: most.item.id, title: most.item.title, rounds: most.rounds } : null,
  }

  // --- what was refused ------------------------------------------------------------------------------------------
  const caught: ReceiptCaught[] = []
  // 1. What the standard measured on a version and a later version no longer had.
  for (const { record, item } of makings) {
    const open = new Map<string, { round: number; at: string; line: string }>()
    const rounds = [...record.rounds].sort((left, right) => left.round - right.round)
    for (const round of rounds) {
      const now = new Map(round.findings.map((line) => [faultKey(line), line]))
      for (const [key, found] of open)
        if (!now.has(key)) {
          caught.push({ item: item.id, title: item.title, round: found.round, why: oneLine(found.line), fixed: true, fixed_in: round.round, by: "standard", how: CAUGHT_HOW.standard, at: found.at })
          open.delete(key)
        }
      for (const [key, line] of now) if (!open.has(key)) open.set(key, { round: round.round, at: round.at, line })
    }
    // Still there in the last version looked at: fixed only if a clean version was kept after it.
    for (const found of open.values())
      caught.push({ item: item.id, title: item.title, round: found.round, why: oneLine(found.line), fixed: (record.best?.round ?? 0) > found.round, fixed_in: (record.best?.round ?? 0) > found.round ? record.best!.round : null, by: "standard", how: CAUGHT_HOW.standard, at: found.at })
  }
  // 2. A version of code the checks refused.
  for (const { record, item } of gameplays) {
    const rounds = [...record.rounds].sort((left, right) => left.round - right.round)
    for (const round of rounds) {
      if (round.passed) continue
      // The receipt is read by the person, so a refused version is told in the sentences of the rules, not in the quoted code (round 18).
      const lines = plainCheckLines(round.check)
      if (!lines.length) continue
      const places = round.check.bounds.length + round.check.references.length + (round.check.compile?.ok === false ? round.check.compile.findings.length : 0)
      const later = rounds.find((value) => value.round > round.round && value.passed)
      caught.push({ item: item.id, title: item.title, round: round.round, why: `${oneLine(lines[0]!)}${places > 1 ? `（一共 ${places} 处）` : ""}`, fixed: Boolean(later), fixed_in: later?.round ?? null, by: "code", how: CAUGHT_HOW.code, at: round.at })
    }
  }
  // 3. Refusals the activity log wrote down: a hand-in the standard sent back at the save door, a call refused while the work was handed over, a version the other AI did not pass.
  const known = caught.map((value) => ({ item: value.item, key: faultKey(value.why) }))
  const seen = new Set<string>()
  const roundAt = (item: ReceiptItem, at: string) => {
    const record = makings.find((value) => value.item === item)?.record ?? null
    return (record?.rounds ?? []).filter((round) => round.at <= at).sort((left, right) => right.round - left.round)[0]?.round ?? null
  }
  const mended = (event: ReceiptEvent, review: boolean) =>
    events.some((later) => later.seq > event.seq && later.item === event.item && (review ? later.kind === "review" && later.mark === "ok" : (later.kind === "task" && later.end === true && later.mark === "ok") || (later.kind === "review" && later.mark === "ok") || later.kind === "look")) ||
    ((record) => Boolean(record?.review?.passed && record.review.at > event.at))(makings.find((value) => value.item.id === event.item)?.record)
  for (const event of events) {
    const review = event.kind === "review" && event.mark === "fail"
    const door = (event.kind === "task" && event.mark === "fail" && !event.end) || (event.kind === "tool" && event.mark === "fail" && REFUSING_TOOLS.includes(event.tool ?? ""))
    if (!review && !door) continue
    if (!event.item) continue
    const raw = event.lines?.[0]?.trim()
    if (!raw || NOT_ABOUT_THE_WORK.test(raw)) continue
    const first = event.kind === "tool" ? refusedWork(raw) : raw
    if (!first) continue
    const why = oneLine(first)
    const key = `${event.item}|${event.round ?? ""}|${review ? "r" : "s"}|${why}`
    // A refusal that only repeats a fault already counted from the rounds, or the same words said again.
    if (seen.has(key) || known.some((value) => value.item === event.item && first.includes(value.key) && value.key.length > 4)) continue
    seen.add(key)
    const item = items.find((value) => value.id === event.item)
    caught.push({
      item: event.item,
      title: item?.title ?? event.title ?? "这一样",
      round: event.round ?? (item ? roundAt(item, event.at) : null),
      why,
      fixed: mended(event, review),
      fixed_in: null,
      by: review ? "review" : "save",
      how: review ? CAUGHT_HOW.review : CAUGHT_HOW.save,
      at: event.at,
    })
  }
  // The last review of a version that did not pass, when the log no longer says it (the log keeps only the newest events).
  for (const { record, item } of [...makings, ...gameplays]) {
    const review = record.review
    if (!review || review.passed || !review.independent || !review.findings.length) continue
    const round = record.rounds.find((value) => value.fingerprint !== undefined && value.fingerprint === review.fingerprint)?.round ?? null
    if (caught.some((value) => value.item === item.id && value.by === "review" && (round === null || value.round === round))) continue
    caught.push({ item: item.id, title: item.title, round, why: oneLine(review.findings[0]!), fixed: record.rounds.some((value) => value.at > review.at), fixed_in: null, by: "review", how: CAUGHT_HOW.review, at: review.at })
  }
  caught.sort(byTime)

  // --- the other AI --------------------------------------------------------------------------------------------
  const reviews = [...makings, ...gameplays].flatMap(({ record }) => (record.review?.independent ? [record.review] : []))
  const blind = makings.flatMap(({ record, item }) => {
    const said = record.review?.blind
    if (!said) return []
    const fit = blindFit(said)
    return [{ item: item.id, title: item.title, said: said.said, named: said.named, recognised: fit === undefined ? null : fit !== "no" }]
  })
  const reviewed = {
    passed: reviews.filter((review) => review.passed).length,
    total: reviews.length,
    refusals: events.filter((event) => event.kind === "review" && event.mark === "fail" && event.item).length,
    blind: blind.slice(0, RECEIPT_LIMITS.blind),
  }

  // --- the game ----------------------------------------------------------------------------------------------------
  const report = input.scene?.record?.report
  const checkedAt = input.scene?.record?.checked_at
  const creatures = report?.things.filter((thing) => thing.kind === "creature" && thing.placed && thing.there !== undefined && thing.there !== null) ?? []
  const game: ReceiptGame | null =
    report && checkedAt
      ? { checked_at: checkedAt, started: report.started, total: report.things.length, placed: report.things.filter((thing) => thing.placed).length, waited: creatures.length, present: creatures.filter((thing) => thing.there === true).length, problems: report.findings.length, current: input.scene!.current }
      : null

  const going = items.filter((item) => item.facts.saved && item.runtime)
  const checked = { total: going.length, passed: going.filter((item) => item.facts.gametest === true).length, failed: going.filter((item) => item.facts.gametest === false).length }

  // --- what nobody verified -----------------------------------------------------------------------------------------
  const unverified = items
    .filter((item) => item.facts.saved)
    .flatMap((item) => {
      const record = makings.find((value) => value.item === item)?.record ?? gameplays.find((value) => value.item === item)?.record ?? null
      const why = [
        ...(item.ai_unsatisfied ? [`${UNSATISFIED.mark}${keptReason(record?.kept_reason) ? `：${oneLine(keptReason(record?.kept_reason)!)}` : ""}`] : []),
        ...(item.ai_interrupted ? [INTERRUPTED_WORDS.replace(/[，。].*$/, "")] : []),
        ...(record && !record.review && !item.ai_interrupted ? [RECEIPT_WORDS.no_review] : []),
        ...(record?.review && !record.review.independent ? [RECEIPT_WORDS.self_reviewed] : []),
        ...(record?.review?.independent && !record.review.passed && !item.ai_unsatisfied ? [RECEIPT_WORDS.review_failed] : []),
        ...(item.facts.gametest === false ? [RECEIPT_WORDS.game_failed] : item.facts.gametest === null && item.runtime ? [RECEIPT_WORDS.game_unchecked] : []),
      ]
      return why.length ? [{ id: item.id, title: item.title, why: `${why.join("；")}。`, weight: item.ai_unsatisfied || item.ai_interrupted ? 0 : item.facts.gametest === false ? 1 : 2 }] : []
    })
    .sort((left, right) => left.weight - right.weight)
    .slice(0, RECEIPT_LIMITS.unverified)
    .map(({ weight: _weight, ...value }) => value)

  return { things, made, caught: caught.slice(0, RECEIPT_LIMITS.caught), caught_total: caught.length, reviewed, game, checked, unverified }
}

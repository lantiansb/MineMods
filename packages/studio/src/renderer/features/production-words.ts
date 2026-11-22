import type { Making, OverviewItem, ProjectOverview } from "../../api"
import { MAKING_LIMITS } from "@minemods/studio-ai/making"
import type { Draft } from "./asset-picture"

/**
 * What the overview's progress strip says while things are being made and what it waits for. Pure, so it can be checked without a screen.
 * Everything here is read from records the page already holds (the overview, the making records, the drafts an outside AI showed); nothing is
 * guessed, and where a record does not say, the words say nothing either.
 */

/** The order things happen in, said once, where 审查 and 验收 are both on the page. The 审查 step is left out when the switch is off. */
export const ORDER_WORDS = {
  on: "顺序：AI 做 → 另一个 AI 审查 → 最后你验收。审查过了，才轮到你。",
  off: "顺序：AI 做 → 它自己检查 → 最后你验收。「审查」关着，没有另一个 AI 来看。",
} as const

/** What the person is offered when a finished version waits for a reviewer, and what each choice costs, in one sentence each. */
export const REVIEWER_OFFER = {
  open: "打开审查员",
  openHow: "点「复制起步说明」，在同一个 AI 助手里再新开一个对话粘贴，它就会来领这一版去看。多一个对话，多花一些额度和时间。",
  copied: "已复制。在同一个 AI 助手里新开一个对话粘贴，再回到这里等它。",
  without: "这次不另请审查，让做的 AI 自己检查",
  withoutHow: "以后都不另请审查员（想再开，在连接 AI里打开「审查」）：做的 AI 自己检查并写明是它自己审查的，更快，但少一道关。你最后验收不变。",
  done: "好了，以后由做的 AI 自己检查。它在等的那一版会马上接着走。",
} as const

/**
 * The three counts a making shows, in one short line (broad19: 「第一轮、最多六轮、边做边看二十次这几个计数的关系也不清楚」). A round is one version the AI handed in and
 * looked over; the cap is how many it may hand in; a quick look while it works is not a round and is counted on its own. `glances: false` for what has no quick look (a
 * gameplay's code); `word` is the one the page already uses for a version, 轮 or 版, so the line speaks the page's language.
 */
export const roundsExplained = (allowed: number, options: { word?: "轮" | "版"; glances?: boolean } = {}) => {
  const word = options.word ?? "轮"
  return (
    `第 N ${word}：AI 正式交出、对着图检查过的一版。最多 ${allowed} ${word}：能交的版数上限，用完还没通过就停下。` +
    (options.glances === false ? "" : `边做边看：做的过程中随手看一眼图，不算一${word}；外部 AI 一个任务最多看 ${MAKING_LIMITS.glances} 次，Studio 自己的 AI 每一版最多 ${MAKING_LIMITS.own_glances} 次。`)
  )
}

type Wait = NonNullable<ProjectOverview["review_wait"]>

/** How long ago, in the words a person uses for a wait. */
export function sinceWords(since: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000))
  if (!Number.isFinite(seconds) || Number.isNaN(Date.parse(since))) return ""
  if (seconds < 60) return "刚刚"
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `已经等了 ${minutes} 分钟` : `已经等了 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

/**
 * The page's notice about versions that wait for a reviewer: what waits, for how long, who is (not) there. `head` always says what is waiting; `reviewer`
 * says what Studio knows about the other window and nothing it does not (it cannot know that a window is open, only that it asked for work).
 */
export function reviewWaitWords(wait: Wait, now: number) {
  const first = wait.waiting[0]!
  const more = wait.waiting.length - 1
  const what = more > 0 ? `「${first.title}」等 ${wait.waiting.length} 样` : `「${first.title}」`
  const reading = wait.reviewer === "reading"
  const head = reading ? `审查员正在看${what}` : `${what}做好了，在等审查员看`
  const clock = sinceWords(first.since, now)
  const reviewer =
    wait.reviewer === "never"
      ? "还没有审查员的窗口连上来过。"
      : wait.reviewer === "silent"
        ? "审查员的窗口连过，但有一阵没有动静了。"
        : wait.reviewer === "reading"
          ? "审查员的窗口在看，看完会给结论。"
          : "审查员的窗口连着，等它来领。"
  return { head, clock, reviewer, offer: wait.offer, after: "审查员看完以后才轮到你验收。" }
}

/** One thing being made, as it is said in a line: its name with its kind, and where its making stands. */
export type MakingNow = { id: string; title: string; kind: string; said: string; fraction: number }

/** A versions-so-far share never reaches 1: only a saved thing is whole. */
const UNDER_WHOLE = 0.95

/**
 * Where each thing in hand stands, from its making record and its draft:
 * the words come from the record (writing the part sheet, the version it is at, waiting for review), else from the percentage an outside AI reported
 * for its draft; `fraction` is how much of the bar it fills, 0 to under 1. It is the larger of two real numbers: the AI's own reported percentage, and the versions
 * made so far against the versions allowed. The second is a share of the allowance used, not a forecast: it says how far along the loop is, and an AI that is
 * satisfied early skips ahead when its thing is saved. Nothing fills the bar that no record holds.
 */
export function makingNow(input: { items: OverviewItem[]; kinds: { id: string; label: string }[]; makings: Record<string, Making | undefined>; drafts: Draft[]; roundNow: (making: Making) => number }): MakingNow[] {
  const label = new Map(input.kinds.map((kind) => [kind.id, kind.label]))
  return input.items
    // A queued thing is not being made: nothing has started on it (it is counted and said apart, see `queueLine`).
    .filter((item) => item.status === "making" && !item.queued && !input.makings[item.id]?.idle)
    .map((item) => {
      const making = input.makings[item.id]
      const draft = input.drafts.find((value) => (item.asset_id ? value.asset_id === item.asset_id : value.kind === item.kind && value.title === item.title)) ?? null
      const percent = draft?.progress ?? null
      const fromRounds = making && making.rounds_allowed > 0 ? Math.min(making.rounds.length / making.rounds_allowed, UNDER_WHOLE) : 0
      const fromDraft = percent === null ? 0 : Math.min(percent / 100, UNDER_WHOLE)
      const live = making && making.state !== "done" && making.state !== "stopped" ? making : null
      const said = live
        ? live.state === "describing"
          ? "在写部件说明"
          : live.state === "reviewing"
            ? `第 ${live.rounds.length || 1} 版做好了，等审查`
            : `做到第 ${input.roundNow(live)} 版`
        : percent !== null
          ? `进度 ${percent}%`
          : "刚开始"
      return { id: item.id, title: item.title, kind: label.get(item.kind) ?? "", said, fraction: Math.max(fromRounds, fromDraft) }
    })
}

/**
 * The strip's sentence while something is being made: how many, and for the first few where each stands. «正在做 4 样：小刺猬（模型）做到第 2 版；…»
 * Spoken only while nothing is finished yet and also later: a thing that is made again is counted in `making` too.
 */
export function makingSentence(now: MakingNow[], shown = 3) {
  if (!now.length) return ""
  const line = (value: MakingNow) => `${value.title}${value.kind ? `（${value.kind}）` : ""}${value.said}`
  const rest = now.length - shown
  return `正在做 ${now.length} 样：${now.slice(0, shown).map(line).join("；")}${rest > 0 ? `；另外 ${rest} 样` : ""}`
}

/**
 * How much of the bar the things in hand fill, as a share of all the things (0 to 1): what each fills, added up, over how many there are in all.
 * A thing that is made again is counted among the saved ones in the solid part of the bar; its new making adds what it has reached, never more than
 * a whole thing, so the two parts together can not pass the bar.
 */
export function inHandShare(now: MakingNow[], total: number) {
  if (!total) return 0
  return now.reduce((all, value) => all + value.fraction, 0) / total
}

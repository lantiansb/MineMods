import { KEPT_WORDS } from "@minemods/mod-core/kept-words"
import type { ActivityEvent } from "../../api"

/**
 * How the activity log reads in the side panel. Pure, so it can be checked without a screen.
 * Events about one thing are gathered under that thing; events about the whole project stay where they
 * happened, so the order from top to bottom is the order things began in.
 */
export type GroupState = "run" | "ok" | "fail" | "warn" | "note" | "idle"
export type ActivityGroup = {
  /** Stable while the group grows: the `seq` of its first event. */
  id: number
  /** The overview item it is about; null for the whole project. */
  item: string | null
  title: string
  /** Everything in it, oldest first, steps and quiet ones included. */
  events: ActivityEvent[]
  /** How the thing stands: how it ended, "run" while nothing has ended it, "idle" when nothing is running any more. */
  state: GroupState
  /** What is being done right now: the newest step, while nothing after it has ended the thing. */
  live: ActivityEvent | null
  /** The state in a word or two, beside the title; empty when there is nothing to add. */
  word: string
  /** For a row that gathers several makings of one thing (`rowsOf`): the newest making's events, which its rounds are read from. */
  current?: ActivityEvent[]
}

const WHOLE: Record<ActivityEvent["kind"], string> = { plan: "想法和蓝图", batch: "这一批", build: "做进模组", person: "你做的", tool: "外部 AI", check: "检查", note: "别的", task: "制作", look: "制作", review: "制作" }
// The renderer's library level has no findLast.
const lastOf = <T>(list: T[], test: (value: T) => boolean) => list.filter(test).at(-1)
// Work on the thing itself; one of these after the thing has ended means it is being made again.
const WORK: ActivityEvent["kind"][] = ["task", "look", "review"]
// Events that say what somebody did about the project as a whole. They stay with whatever was going on.
const ASIDE: ActivityEvent["kind"][] = ["person", "tool", "note", "check"]

/** Gather events into groups. `running` is whether anything is being planned or made right now. */
export function groupActivity(events: ActivityEvent[], running: boolean): ActivityGroup[] {
  const groups = events.reduce<{ item: string | null; kind: ActivityEvent["kind"]; title: string; events: ActivityEvent[]; ended: boolean }[]>((made, event) => {
    const last = made.at(-1)
    const own = event.item === null ? null : lastOf(made, (group) => group.item === event.item)
    // The whole project: joins what was just going on when it is the same sort of thing, or an aside to it.
    const joined = event.item !== null ? (own && !(own.ended && WORK.includes(event.kind) && !event.quiet) ? own : null) : last && last.item === null && (last.kind === event.kind ? !last.ended : ASIDE.includes(event.kind)) ? last : null
    if (!joined) return [...made, { item: event.item, kind: event.kind, title: event.item === null ? WHOLE[event.kind] : (event.title ?? "一样东西"), events: [event], ended: !!event.end }]
    joined.events.push(event)
    // A name can change while a thing is made; the newest one is the one on its card.
    if (event.item !== null && event.title) joined.title = event.title
    if (event.end) joined.ended = true
    return made
  }, [])
  return groups.map((group) => {
    const end = lastOf(group.events, (event) => !!event.end)
    const live = end ? null : (lastOf(group.events, (event) => !!event.step) ?? null)
    // An aside alone (a verdict, a tool call) is not something under way.
    const working = group.events.some((event) => !ASIDE.includes(event.kind))
    const state: GroupState = end ? end.mark : !working ? "note" : running ? "run" : "idle"
    // "warn" on a thing is a version kept for the person; on the whole project it is something worth a look.
    const words: Record<GroupState, string> = {
      run: group.kind === "plan" ? "正在想" : group.kind === "build" ? "正在打包" : "正在做",
      ok: "做好了",
      fail: "没成",
      warn: group.item === null ? "要看一眼" : "留给你看",
      note: end && group.item !== null ? "没做完" : "",
      idle: "停了",
    }
    return { id: group.events[0]!.seq, item: group.item, title: group.title, events: group.events, state, live: running ? live : null, word: words[state] }
  })
}

/** The nodes of a group as the person reads them: steps are only the live line, quiet ones only under 高级. */
export function shownEvents(group: ActivityGroup, advanced: boolean) {
  return group.events.filter((event) => !event.step && (advanced || !event.quiet))
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60000))
/** "3 分钟" for anything under an hour and a half, then hours. */
export const lasted = (ms: number) => (ms < 90 * 60000 ? `${minutes(ms)} 分钟` : `${Math.round(ms / 3600000)} 小时`)

// After this long without a sign of life the panel says so instead of leaving a mark blinking.
export const STALLED_AFTER = 120000

/**
 * The line at the top and, when it applies, the plain statement that nothing has moved for a while.
 * `now` and `aliveAt` are the main process's clock, in milliseconds.
 */
export function activitySummary(groups: ActivityGroup[], input: { running: boolean; now: number; aliveAt: number | null }) {
  const things = groups.filter((group) => group.item !== null)
  const making = things.filter((group) => group.state === "run").length
  // A thing counts once, by how its latest making ended.
  const latest = [...new Map(things.map((group) => [group.item, group])).values()]
  // "warn" on a thing is a version kept for the person: saved, but not "已做好" (broad19: a Boss whose review stopped it was counted as made).
  // It is counted apart and says why it was kept, the way the overview strip does.
  const done = latest.filter((group) => group.state === "ok").length
  const keptBy = (group: ActivityGroup) => group.events.filter((event) => event.end).at(-1)?.kept
  const held = latest.filter((group) => group.state === "warn")
  const unsatisfied = held.filter((group) => keptBy(group) === "unsatisfied").length
  const interrupted = held.filter((group) => keptBy(group) === "interrupted").length
  // A kept version from a log written before the reason was recorded: kept for the person, reason unknown.
  const unknown = held.length - unsatisfied - interrupted
  const failed = latest.filter((group) => group.state === "fail").length
  const since = groups.find((group) => group.state === "run")?.events[0]?.at
  const parts = [
    input.running ? (making ? `正在做 ${making} 样` : "正在想") : "现在没有在做的",
    ...(done ? [`已做好 ${done} 样`] : []),
    ...(unsatisfied ? [KEPT_WORDS.unsatisfied(unsatisfied)] : []),
    ...(interrupted ? [KEPT_WORDS.interrupted(interrupted)] : []),
    ...(unknown ? [`${unknown} 样留了一版，等你看`] : []),
    ...(failed ? [`没做成 ${failed} 样`] : []),
    ...(input.running && since ? [`用了 ${lasted(input.now - Date.parse(since))}`] : []),
  ]
  const quiet = input.running && input.aliveAt !== null ? input.now - input.aliveAt : 0
  return {
    line: groups.length ? parts.join(" · ") : "还没有动静。说一句想做什么，这里就会一步一步记下来。",
    stalled: quiet >= STALLED_AFTER ? `AI 已经 ${lasted(quiet)}没有动静了。可能是网络慢，也可能卡住了；可以再等等，或者先停一下再继续。` : "",
  }
}

/** The clock time of an event, as the panel shows it beside a node. */
export const clock = (at: string) => new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })

/** One square of a thing's round strip: how that round stood when it was last heard of. */
export type RoundPip = { round: number; state: "now" | "made" | "redo" | "passed" | "failed" }

/**
 * The rounds of a thing as a strip of squares, oldest first, read off the events alone: a round exists once a version
 * of it was looked at; what was said of it last decides its colour. The newest round of a thing still being made is
 * "now". Nothing is guessed: a round nobody has judged yet is only "made".
 */
export function roundPips(group: ActivityGroup): RoundPip[] {
  // A thing made again counts its rounds from 1 again: the strip is the newest making's.
  const events = group.current ?? group.events
  const rounds = [...new Set(events.filter((event) => event.kind === "look" && event.round !== undefined).map((event) => event.round!))]
  const newest = rounds.at(-1)
  return rounds.map((round) => {
    const said = lastOf(events, (event) => event.round === round && event.kind === "review" && !event.quiet)
    const state: RoundPip["state"] =
      said?.mark === "fail" ? "failed" : said?.mark === "warn" ? "redo" : said?.mark === "ok" && said.end ? "passed" : group.state === "run" && round === newest ? "now" : "made"
    return { round, state }
  })
}

/** The one line a closed thing shows: what is being done now, else the newest thing said of it. */
export function nowLine(group: ActivityGroup, advanced: boolean): ActivityEvent | null {
  const events = shownEvents(group, advanced)
  return group.live ?? events.filter((event) => !event.build_warning).at(-1) ?? events.at(-1) ?? null
}

/** The newest picture of a thing, for its slot; null before any version was drawn. */
export function groupPicture(group: ActivityGroup): string | null {
  return lastOf(group.events, (event) => !!event.thumb)?.thumb ?? null
}

/**
 * The panel's rows: one per thing, however many times it was made again, standing where its newest making is; the
 * project's own news stays where it happened. The row carries every step the thing has had (`events`), while its state,
 * live line and rounds are those of the newest making, which is what the thing is now.
 */
export function rowsOf(groups: ActivityGroup[]): ActivityGroup[] {
  const newest = new Map<string, number>()
  groups.forEach((group, index) => group.item !== null && newest.set(group.item, index))
  return groups.flatMap((group, index) => {
    if (group.item === null) return [group]
    if (newest.get(group.item) !== index) return []
    const earlier = groups.slice(0, index).filter((other) => other.item === group.item)
    return [{ ...group, id: earlier[0]?.id ?? group.id, events: [...earlier.flatMap((other) => other.events), ...group.events], current: group.events }]
  })
}

/** A milestone's line without its kind said twice: 「外部 AI」 before 「外部 AI 打开这个模组」 is dropped. */
export const mileText = (title: string, text: string) => (text.startsWith(title) ? text.slice(title.length).replace(/^[\s：:，,]+/, "") : text)

/**
 * The line of a thing being made, as the connection stands (P1-C1). The record cannot know that the AI has gone quiet or gone away: while it has, the
 * line says so instead of 「正在做」; once it is back the record speaks again. Null: nothing to add, whatever the connection.
 */
export function presenceLine(state: string | undefined) {
  if (state === "idle") return { state: "warn" as const, word: "没动静", text: "超过 45 秒没动静", next: "回你的 AI 窗口看看它是不是停了。" }
  if (state === "disconnected") return { state: "fail" as const, word: "断开了", text: "断开了，已交来的已存好", next: "回你的 AI 窗口，让它重新接上。" }
  return null
}

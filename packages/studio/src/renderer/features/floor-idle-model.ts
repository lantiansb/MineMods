import type { ActivityEvent, ProjectOverview } from "../../api"
import { OUTSIDE_PRESENT_MS } from "../connection-chip"
import { afterConfirmWords, type AiWait } from "./waiting-for-you-model"

/**
 * 制作现场 when nothing is being made (broad20 P3-01). The page used to say 「现在没有在做的」 whatever the reason, which a person who had just confirmed the blueprint,
 * or whose AI was reading it, read as "idle, broken". This says why, as one sentence, from signals Studio really has: the connection, the blueprint's state,
 * whether the AI sits in its wait call (`blueprint_wait`), the newest call the outside AI made (the activity log), and what is made. Pure, so it can be checked without a screen.
 * Where no signal says anything, it says nothing (null) and the page keeps its old words.
 */
export type IdleReason = {
  title: string
  text: string
  /** The next step the person can press, when there is one that is not already a button on the page. */
  action?: { id: "overview"; label: string }
}

export type IdleInput = {
  /** An outside AI builds through MCP; false: Studio's own AI does. */
  external: boolean
  /** The outside AI is there (it called a tool lately), or Studio's own AI is set up. */
  connected: boolean
  blueprint: NonNullable<ProjectOverview["blueprint"]>["state"] | null
  /** The cards of ideas are on the table and the choice is the person's. */
  ideasWaiting: boolean
  ai: AiWait
  production: Pick<ProjectOverview["production"], "total" | "saved" | "done" | "to_review" | "to_redo" | "failed" | "blocked" | "unsatisfied" | "interrupted">
  /** The activity log, oldest first. */
  events: ActivityEvent[]
  /** The main process's clock in milliseconds, as `activitySummary` takes it. */
  now: number
}

/** "刚刚" under a minute, then minutes, then hours. */
export function agoWords(at: string, now: number) {
  const ms = now - Date.parse(at)
  if (!Number.isFinite(ms)) return ""
  if (ms < 60_000) return "刚刚"
  const minutes = Math.floor(ms / 60_000)
  return minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时前`
}

/** The newest call the outside AI made that was not turned back, if it was within the time an outside AI still counts as there. */
function lastCall(events: ActivityEvent[], now: number) {
  const call = events.filter((event) => event.kind === "tool" && event.mark !== "fail").at(-1)
  if (!call) return null
  const age = now - Date.parse(call.at)
  return Number.isFinite(age) && age < OUTSIDE_PRESENT_MS ? call : null
}

export function idleReason(input: IdleInput): IdleReason | null {
  const made = input.production
  if (!input.connected) return input.external ? { title: "外面的 AI 没有接上", text: "Studio 这边没有收到它的动静，所以不会有新东西做出来。" } : { title: "AI 还没有连上", text: "连上以后，才能开始做。" }
  if (input.ideasWaiting && input.blueprint === null) return { title: "想法在等你挑", text: "你挑好以后，才会出蓝图。" }
  if (input.blueprint === "draft") {
    return input.external && input.ai === "waiting"
      ? { title: "AI 在等你确认蓝图", text: "确认以后它会自己开始，不用再回去跟它说。" }
      : { title: "蓝图在等你确认", text: input.external ? "确认以后，还要回到你的 AI 窗口让它开始。" : "确认以后才会开始做。" }
  }
  const unmade = made.total > made.saved || made.to_redo > 0
  if (input.external && input.blueprint === "confirmed" && unmade && input.ai === "told") return { title: "蓝图确认好了", text: afterConfirmWords(input.ai, "") }
  if (input.external) {
    const call = lastCall(input.events, input.now)
    if (call) return { title: "外部 AI 已接上", text: `${agoWords(call.at, input.now)}${call.text.replace(/^外部 AI\s*/, "")}还没开始做下一样。` }
  }
  if (input.blueprint === "confirmed" && unmade) {
    return input.external
      ? { title: "蓝图确认好了", text: afterConfirmWords(input.ai, made.saved ? "继续做" : "开始做") }
      : { title: "蓝图确认好了", text: "还有没做的，在下面说一句就能接着做。" }
  }
  const finished = made.total > 0 && made.done === made.total && !made.to_review && !made.to_redo && !made.failed && !made.blocked && !made.unsatisfied && !made.interrupted
  if (finished) return { title: "全部做完了", text: "蓝图里的东西都做好了。", action: { id: "overview", label: "回工程总览" } }
  if (input.external && input.blueprint === null && !made.total) return { title: "外部 AI 已接上", text: "这个模组还没有蓝图。在 AI 窗口里说出你的想法，它就会开始规划。" }
  return null
}

/** 「审查」 as the person has it switched, and whether a reviewing window is really there. Only an outside AI has a window to connect. */
export type ReviewerInput = {
  external: boolean
  reviewOn: boolean | undefined
  /** `ProjectOverview.review_window`, or the `reviewer` of `review_wait` while a version waits. */
  reviewer: NonNullable<ProjectOverview["review_window"]> | undefined
}

export function reviewerLine(input: ReviewerInput): { text: string; open: boolean } | null {
  if (!input.external || !input.reviewOn || !input.reviewer) return null
  if (input.reviewer === "present") return { text: "审查已打开，审查员的窗口已接上。", open: false }
  if (input.reviewer === "reading") return { text: "审查已打开，审查员正在看一版。", open: false }
  return { text: input.reviewer === "silent" ? "审查已打开，但审查员的窗口有一阵没有动静了。" : "审查已打开，但审查员的窗口还没接上。", open: true }
}

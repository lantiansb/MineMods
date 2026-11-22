import { Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import type { ActivityEvent } from "../../api"
import { ADVANCEMENTS, type AdvancementId } from "../../advancements"
import { playSound } from "../sounds"
import "./advancement.css"

/**
 * Advancement toasts (10-14): what Studio just did for the person, said the way the game says an advancement — a dark
 * frame sliding in at the top right with a coloured first line, the thing's name and, when the making loop kept one, its
 * picture. One at a time, a few seconds each, never more than a handful queued: a toast is news, not a log (the activity
 * panel is the log). Fed from the activity log while a project is open, and by `pushToast` from places that know of
 * something the log does not hold (the background check in the game).
 */
export type Toast = {
  /** The frame and the first line's colour: a milestone, a step done, a challenge (all of a batch, checked in the game), or a problem Studio stopped. */
  tone: "goal" | "task" | "challenge" | "caught"
  /** The first line, in the frame's colour. */
  head: string
  /** The second line: what it is about. */
  name: string
  /** A picture of the thing (a data URL the activity log hands over), else a pixel mark of the tone. */
  thumb?: string
}

// 「验收」 is the person's own verdict and nothing else (broad20: 「验收通过！」 popped up while another card was open and read as Studio having accepted it for them).
// What another AI's review found is 「审查」, and the toast says who waits next.
const HEADS = {
  review: "AI 审查通过，等你验收",
  saved: "做好了！",
  caught: "拦下一处问题",
  build: "模组打好包了！",
  batch: "挑战完成！",
  checked: "Studio 检查通过",
} as const

/**
 * The toast an activity event makes, or null for the many that are not news (steps, notes, what the person did).
 * Read off the event's kind, mark and end — never off its words, which change.
 */
export function toastOf(event: ActivityEvent): Toast | null {
  if (event.quiet || event.step) return null
  const name = event.title ?? ""
  const thumb = event.thumb ? { thumb: event.thumb } : {}
  // Another AI that did not make it looked at it and passed it: the moment the work is not only the maker's word.
  if (event.kind === "review" && event.mark === "ok" && event.end !== false && /评审/.test(event.text) && name) return { tone: "goal", head: HEADS.review, name: `「${name}」${event.round ? `第 ${event.round} 版` : ""}`, ...thumb }
  if (event.kind === "task" && event.mark === "ok" && event.end && name) return { tone: "task", head: HEADS.saved, name: `「${name}」已经存进工程`, ...thumb }
  // A version the standard refused at the door: Studio caught it before it reached the person.
  if (event.kind === "task" && event.mark === "fail" && !event.end && name) return { tone: "caught", head: HEADS.caught, name: `「${name}」没通过检查，AI 正在改`, ...thumb }
  if (event.kind === "build" && event.mark === "ok" && event.end) return { tone: "goal", head: HEADS.build, name: event.text.replace(/^模组打包好了：/, "") }
  if (event.kind === "batch" && event.mark === "ok" && event.end) return { tone: "challenge", head: HEADS.batch, name: event.text }
  if (event.kind === "check" && event.mark === "ok" && !name) return { tone: "task", head: HEADS.checked, name: "做出来的文件和工程里写的对得上" }
  return null
}

const SHOWN_MS = 5200
const QUEUED_MOST = 6
const [queue, setQueue] = createSignal<(Toast & { id: number })[]>([])
let next = 1

/** Shows a toast now or after the ones already waiting. Past a handful waiting, the oldest waiting ones give way. */
export function pushToast(toast: Toast) {
  setQueue((list) => [...list, { ...toast, id: next++ }].slice(-QUEUED_MOST))
}

/** The first this event is, if it may be one. Goes by the same reading as the toast above, so the two never disagree on what happened. */
export function firstOf(event: ActivityEvent): AdvancementId | null {
  const head = toastOf(event)?.head
  return head === HEADS.saved ? "made" : head === HEADS.build ? "packed" : null
}

/** Says a first, if it is one. Nothing asked for still makes sure the project has its record, so what it has done by then is not news later. It never stands in the way of anything. */
export function earnAdvancement(projectId: string, ...ids: AdvancementId[]) {
  void window.studio.earnAdvancements({ projectId, ids: [...new Set(ids)] }).then(
    ({ fresh }) =>
      fresh.forEach((id) => {
        pushToast({ tone: "goal", head: `进度达成！${ADVANCEMENTS[id].title}`, name: ADVANCEMENTS[id].line })
        playSound("ding")
      }),
    () => undefined,
  )
}

/** Pixel marks for a toast without a picture, 8×8, one path each. */
const MARKS: Record<Toast["tone"], string> = {
  goal: "M1 3h1v1h1v1h1V4h1V3h1V2h1v1h-1v1h-1v1h-1v1h-1v1H3V6H2V5H1z",
  task: "M2 1h4v1h1v4H6v1H2V6H1V2h1zm1 2v2h2V3z",
  challenge: "M3 0h2v2h2v1H6v1H5v1h1v2H5V6H3v1H2V5h1V4H2V3H1V2h2z",
  caught: "M1 1h6v3H6v1H5v1H4v1H3V6H2V5H1zm2 1v1h2V2z",
}

/** The toasts of an open project: its activity log, read from the moment the page opened. What was already there is not news. */
export function Advancements(props: { projectId: string | null }) {
  // By value: the id is read off a view that is new at every save, and starting over with each one would take what just happened for what was already there.
  const project = createMemo(() => props.projectId)
  createEffect(
    on(
      project,
      (projectId) => {
        setQueue([])
        if (!projectId) return
        const poll = { stopped: false, timer: 0, last: -1 }
        earnAdvancement(projectId)
        const read = async () => {
          const got = await window.studio.getActivity({ projectId, ...(poll.last >= 0 ? { after: poll.last } : {}) }).catch(() => null)
          if (poll.stopped) return
          if (got) {
            const fresh = got.events.filter((event) => event.seq > poll.last)
            const firsts = [...new Set(fresh.flatMap((event) => firstOf(event) ?? []))]
            if (poll.last >= 0) {
              fresh.map(toastOf).forEach((toast) => toast && pushToast(toast))
              if (firsts.length) earnAdvancement(projectId, ...firsts)
            } else if (firsts.length) {
              // Done while nobody was looking: no news now, but it did happen, and the next one is not the first.
              void window.studio.earnAdvancements({ projectId, ids: firsts, quiet: true }).catch(() => undefined)
            }
            poll.last = Math.max(poll.last, got.last)
          }
          poll.timer = window.setTimeout(() => void read(), got?.running ? 1500 : 3500)
        }
        void read()
        onCleanup(() => {
          poll.stopped = true
          window.clearTimeout(poll.timer)
        })
      },
    ),
  )
  // The first in the queue is on screen; it leaves after its time, or at once when clicked. By value: another joining the queue is a new list, and does not start this one's time over.
  const shownId = createMemo(() => queue()[0]?.id)
  createEffect(
    on(
      shownId,
      (id) => {
        if (id === undefined) return
        const timer = window.setTimeout(() => setQueue((list) => list.filter((toast) => toast.id !== id)), SHOWN_MS)
        onCleanup(() => window.clearTimeout(timer))
      },
    ),
  )
  return (
    <div class="adv-stack" aria-live="polite">
      <Show when={queue()[0]} keyed>
        {(toast) => (
          <button type="button" class="adv-toast" data-tone={toast.tone} onClick={() => setQueue((list) => list.filter((value) => value.id !== toast.id))} title="点一下收起">
            <span class="adv-icon" aria-hidden="true">
              <Show
                when={toast.thumb}
                fallback={
                  <svg viewBox="0 0 8 8" shape-rendering="crispEdges">
                    <path fill="currentColor" d={MARKS[toast.tone]} />
                  </svg>
                }
              >
                <img src={toast.thumb} alt="" />
              </Show>
            </span>
            <span class="adv-words">
              <strong>{toast.head}</strong>
              <span>{toast.name}</span>
            </span>
            <Show when={queue().length > 1}>
              <small class="adv-more">还有 {queue().length - 1} 条</small>
            </Show>
          </button>
        )}
      </Show>
    </div>
  )
}

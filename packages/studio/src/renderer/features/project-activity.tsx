import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { ActivityEvent } from "../../api"
import { Icon } from "../ui"
import { activitySummary, clock, groupActivity, groupPicture, lasted, mileText, nowLine, presenceLine, roundPips, rowsOf, shownEvents, type ActivityGroup, type GroupState } from "./project-activity-model"
import { BuildWarnings } from "./build-warnings"
import { SaidLines } from "./play-text"
import { openFloor } from "./making-floor-link"
import "./project-activity.css"

// The newest events kept on screen; older ones stay in the project's log.
const KEPT = 600
const STORE = "minemods.activity.open"
// The person's choice of open or closed, for as long as the app runs and, where it can be kept, after.
const remembered = { open: localStorage.getItem(STORE) === null ? null : localStorage.getItem(STORE) === "1" }
// Wide enough for the panel to stand beside an open card without the card losing the width it has at 1280.
const roomy = window.matchMedia("(min-width: 1366px)")

// One small picture per outcome, drawn like the status marks of the overview so they read without colour.
const marks: Record<GroupState, string[]> = {
  run: ["1111111", "0100010", "0011100", "0001000", "0011100", "0111110", "1111111"],
  ok: ["0000000", "0000001", "0000011", "1000110", "1101100", "0111000", "0010000"],
  fail: ["1100011", "1110111", "0111110", "0011100", "0111110", "1110111", "1100011"],
  warn: ["0011100", "0011100", "0011100", "0011100", "0001000", "0000000", "0001000"],
  note: ["0000000", "0000000", "0011100", "0011100", "0011100", "0000000", "0000000"],
  idle: ["0000000", "0110110", "0110110", "0110110", "0110110", "0110110", "0000000"],
}
const pixels = (rows: string[]) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "1" ? [`M${x} ${y}h1v1h-1z`] : []))).join("")

/**
 * The side panel that says what is happening right now: a timeline of plain sentences, gathered under the
 * thing each one is about. It reads the project's activity log by polling and changes nothing.
 *
 * Where it sits (see the layout note in project-activity.css): beside the page when the window is wide,
 * and as a drawer over the page's right edge when it is not, so the page and the acceptance card never
 * lose width to it on a 1280-wide window.
 */
export function ActivityPanel(props: {
  projectId: string
  /** 高级 is on: tool names, durations, raw detail and the calls other events already tell. */
  advanced: boolean
  /** A card is open on the page. */
  card: boolean
  /** An outside AI's connection as it stands; absent with Studio's own AI, which cannot go away. */
  presence?: string
  /** Whether a node about this item can be opened: the item is on the overview. */
  name?: (item: string) => string | undefined
  has: (item: string) => boolean
  /** Open the item's card; with a round, at that round of its making story. `at` is the time of the record that named the round: a record from before a redo is not a round of the new making (`recordRound`). */
  onOpen: (item: string, round?: number, at?: string) => void
  onUndoDeletion: (deletion: string) => Promise<void>
  /** Told what the panel has read of the log, so the page can say of a thing's rounds what the log alone remembers (reviews of earlier versions). */
  onEvents?: (events: readonly ActivityEvent[]) => void
  /** Told how the panel stands, so the page can make room: `beside` when it stands next to the page (and next to a card), `open` when it is unfolded there. */
  onState: (state: { open: boolean; beside: boolean }) => void
}) {
  let scroller: HTMLDivElement | undefined
  const [log, setLog] = createStore<{ events: ActivityEvent[] }>({ events: [] })
  const [meta, setMeta] = createSignal({ running: false, skew: 0, aliveAt: null as number | null, read: false })
  const [tick, setTick] = createSignal(Date.now())
  const [chosen, setChosen] = createSignal(remembered.open)
  const [following, setFollowing] = createSignal(true)
  const [unseen, setUnseen] = createSignal(0)
  const [unfolded, setUnfolded] = createSignal<number[]>([])
  const [missed, setMissed] = createSignal(0)

  const now = () => tick() + meta().skew
  const groups = createMemo(() => groupActivity(log.events.map(event => event.item && props.name ? { ...event, title: props.name(event.item) ?? event.title } : event), meta().running))
  const summary = createMemo(() => activitySummary(groups(), { running: meta().running, now: now(), aliveAt: meta().aliveAt }))
  const [wide, setWide] = createSignal(roomy.matches)
  const [over, setOver] = createSignal(false)
  // Beside the page it takes room; on a window too narrow to spare any beside an open card it lies over the card instead.
  const docked = createMemo(() => !props.card || wide())
  // Open while something runs unless the person said otherwise; their choice stands once made. Over a card it
  // opens only when asked, so the card is never covered by default.
  const open = createMemo(() => (docked() ? (chosen() ?? wide()) : over()))
  const last = () => log.events.at(-1)?.seq ?? 0

  createEffect(() => props.onState({ open: open() && docked(), beside: docked() }))
  createEffect(on(last, () => props.onEvents?.(log.events)))
  createEffect(
    on(
      () => props.projectId,
      () => {
        setLog("events", [])
        setMeta({ running: false, skew: 0, aliveAt: null, read: false })
        const poll = { stopped: false, timer: 0 }
        const read = async () => {
          // A read that fails keeps what is on screen; the next one asks again from the same place.
          const next = await window.studio.getActivity({ projectId: props.projectId, after: last() }).catch(() => null)
          if (poll.stopped) return
          if (next) {
            const fresh = next.events.filter((event) => event.seq > last())
            if (fresh.length) setLog("events", reconcile([...log.events, ...fresh].slice(-KEPT), { key: "seq" }))
            // What was already there when the page opened is not news.
            if (fresh.length && meta().read && (!open() || !following())) setUnseen(unseen() + fresh.filter((event) => !event.step && !event.quiet && event.kind !== "person").length)
            setMeta({ running: next.running, skew: Date.parse(next.now) - Date.now(), aliveAt: next.alive_at ? Date.parse(next.alive_at) : null, read: true })
          }
          setTick(Date.now())
          poll.timer = window.setTimeout(() => void read(), meta().running ? 1500 : 4000)
        }
        void read()
        onCleanup(() => {
          poll.stopped = true
          window.clearTimeout(poll.timer)
        })
      },
    ),
  )
  // Follow the newest line, unless the person has scrolled up to read something.
  createEffect(
    on([last, open, () => groups().at(-1)?.live?.seq], () => {
      if (!open() || !following()) return
      queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }))
      setUnseen(0)
    }),
  )
  const scrolled = () => {
    const bottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 28
    setFollowing(bottom)
    if (bottom) setUnseen(0)
  }
  const toBottom = () => {
    setFollowing(true)
    setUnseen(0)
    scroller?.scrollTo({ top: scroller.scrollHeight })
  }
  const choose = (next: boolean) => {
    remembered.open = next
    localStorage.setItem(STORE, next ? "1" : "0")
    setChosen(next)
    if (!docked()) setOver(next)
  }
  createEffect(() => {
    if (!props.card) setOver(false)
  })
  createEffect(() => {
    const changed = () => setWide(roomy.matches)
    roomy.addEventListener("change", changed)
    onCleanup(() => roomy.removeEventListener("change", changed))
  })
  // Opened again: at the newest line.
  createEffect(on(open, (now) => now && queueMicrotask(toBottom), { defer: true }))
  const visit = (event: ActivityEvent) => {
    if (!event.item || !props.has(event.item)) return setMissed(event.seq)
    props.onOpen(event.item, event.kind === "look" || event.kind === "review" ? event.round : undefined, event.at)
  }
  createEffect(() => {
    if (!missed()) return
    const timer = window.setTimeout(() => setMissed(0), 2600)
    onCleanup(() => window.clearTimeout(timer))
  })

  const mark = (state: () => GroupState, live: () => boolean = () => false) => (
    <span class="ac-mark" data-state={state()} classList={{ live: live() }}>
      <svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
        <path fill="currentColor" d={pixels(marks[state()])} />
      </svg>
    </span>
  )
  // A step shows one line; its further lines and picture open under it when it is pressed, one step at a time.
  const [opened, setOpened] = createSignal(0)
  const [undoing, setUndoing] = createSignal<string | null>(null)
  const [undone, setUndone] = createSignal<string[]>([])
  const [undoError, setUndoError] = createSignal<{ deletion: string; message: string } | null>(null)
  const restored = createMemo(() => new Set([...undone(), ...log.events.flatMap((event) => event.restored_deletion ? [event.restored_deletion] : [])]))
  async function undo(deletion: string) {
    if (undoing()) return
    setUndoing(deletion)
    setUndoError(null)
    try {
      await props.onUndoDeletion(deletion)
      setUndone((previous) => [...previous, deletion])
    } catch (error) {
      setUndoError({ deletion, message: String(error).replace(/^.*?Error: /, "") })
    } finally {
      setUndoing(null)
    }
  }
  const node = (event: ActivityEvent) => {
    const deletion = () => event.undo_deletion && !restored().has(event.undo_deletion) ? event.undo_deletion : null
    const more = () => !!deletion() || !!event.lines?.length || !!event.thumb || (props.advanced && !!(event.tool || event.ms !== undefined || event.detail))
    const shown = () => opened() === event.seq
    return (
      <li class="ac-step" data-mark={event.mark} data-kind={event.kind} classList={{ quiet: event.quiet, open: shown() }}>
        <button type="button" class="ac-step-line" disabled={!more()} aria-expanded={more() ? shown() : undefined} title={more() ? "点一下看这一步的细节" : undefined} onClick={() => setOpened(shown() ? 0 : event.seq)}>
          <time>{clock(event.at)}</time>
          <span class="ac-text">{event.text}</span>
        </button>
        <Show when={shown()}>
          <div class="ac-step-more">
            <Show when={event.lines?.length}>
              <span class="ac-lines">
                <SaidLines as="span" lines={event.lines ?? []} advanced={props.advanced} />
              </span>
            </Show>
            <Show when={event.thumb}>
              <img class="ac-thumb" src={event.thumb} alt="" />
            </Show>
            <Show when={deletion()}>{(id) => (
              <button type="button" class="ac-go" disabled={undoing() !== null} onClick={() => void undo(id())}>撤销</button>
            )}</Show>
            <Show when={undoError()?.deletion === event.undo_deletion && undoError()?.message}>{(message) => (
              <p role="alert">{message()}</p>
            )}</Show>
            <Show when={event.item && !event.undo_deletion}>
              <button type="button" class="ac-go" onClick={() => visit(event)}>
                {event.round !== undefined && (event.kind === "look" || event.kind === "review") ? `打开它，看第 ${event.round} 轮` : "打开它"}
              </button>
            </Show>
            <Show when={props.advanced && (event.tool || event.ms !== undefined || event.detail)}>
              <pre class="ac-tech">{[[event.tool, event.ms === undefined ? null : `${event.ms} 毫秒`].filter(Boolean).join(" · "), event.detail?.replace(/^[a-z_]+ · \d+ 毫秒\n?/, "")].filter(Boolean).join("\n")}</pre>
            </Show>
          </div>
        </Show>
        <Show when={missed() === event.seq}>
          <p class="ac-missed">这样东西现在不在总览里了，可能蓝图改过。</p>
        </Show>
      </li>
    )
  }
  // Groups are worked out anew with every event; the page keeps one section per group id, so what is on screen grows in place.
  const rows = createMemo(() => rowsOf(groups()))
  const byId = createMemo(() => new Map(rows().map((group) => [group.id, group])))
  const ids = createMemo(() => rows().map((group) => group.id), [], { equals: (left, right) => left.join() === right.join() })
  const PIP_WORDS = { now: "正在做", made: "做出来了", redo: "还要改", passed: "审查通过", failed: "没通过" } as const
  const body = (id: number) => {
    const group = () => byId().get(id) as ActivityGroup
    const steps = () => shownEvents(group(), props.advanced)
    const buildWarnings = createMemo(
      () => steps().flatMap((event) => event.build_warning ? [event.build_warning] : []),
      [],
      { equals: (previous, next) => previous.length === next.length && previous.every((warning, index) => warning === next[index]) },
    )
    const warnings = createMemo(() => {
      const builds = new Map<string, NonNullable<ActivityEvent["build_warning"]>[]>()
      for (const warning of buildWarnings()) {
        const batch = builds.get(warning.build_id)
        if (batch) batch.push(warning)
        else builds.set(warning.build_id, [warning])
      }
      return [...builds.values()]
    })
    const unfoldedHere = () => unfolded().includes(id)
    const toggle = () => setUnfolded(unfoldedHere() ? unfolded().filter((value) => value !== id) : [...unfolded(), id])
    const line = () => nowLine(group(), props.advanced)
    const steplist = () => (
      <Show when={unfoldedHere()}>
        <ol class="ac-steps">
          <For each={steps()}>{(event) => <Show when={!event.build_warning || props.advanced}>{node(event)}</Show>}</For>
          <For each={warnings()}>{(batch) => <li><BuildWarnings warnings={batch} advanced={props.advanced} /></li>}</For>
        </ol>
      </Show>
    )
    // The whole project is not a thing: its news reads as a milestone between the things, one line, opened like a thing.
    if (group().item === null)
      return (
        <section class="ac-mile" data-state={group().state} classList={{ open: unfoldedHere() }}>
          <button type="button" class="ac-mile-line" aria-expanded={unfoldedHere()} onClick={toggle}>
            {mark(() => group().state, () => group().state === "run")}
            <span class="ac-mile-words">
              <b>{group().title}</b>
              <span>{line() ? mileText(group().title, line()!.text) : ""}</span>
            </span>
            <time>{line() ? clock(line()!.at) : ""}</time>
          </button>
          {steplist()}
        </section>
      )
    const picture = () => groupPicture(group())
    const pips = () => roundPips(group())
    // Only what is in hand now can be said to have gone quiet: a thing finished earlier stands as it was.
    const standing = () => (group().live ? presenceLine(props.presence) : null)
    return (
      <section class="ac-thing" data-state={group().state} data-item={group().item ?? ""} classList={{ open: unfoldedHere() }}>
        <div class="ac-thing-row">
          <span class="ac-slot" aria-hidden="true">
            <Show when={picture()} fallback={mark(() => group().state, () => group().state === "run")}>
              <img src={picture()!} alt="" />
            </Show>
          </span>
          <button type="button" class="ac-thing-main" aria-expanded={unfoldedHere()} title={unfoldedHere() ? "收起这样东西的每一步" : "点一下看这样东西的每一步"} onClick={toggle}>
            <span class="ac-thing-head">
              <b>{group().title}</b>
              <Show when={standing()?.word ?? group().word}>
                <em data-state={standing()?.state ?? group().state}>{standing()?.word ?? group().word}</em>
              </Show>
            </span>
            <span class="ac-thing-now" classList={{ live: !!group().live }}>
              <Show when={pips().length}>
                <span class="ac-pips" role="img" aria-label={pips().map((pip) => `第 ${pip.round} 轮${PIP_WORDS[pip.state]}`).join("，")}>
                  <For each={pips()}>{(pip) => <i data-state={pip.state} title={`第 ${pip.round} 轮：${PIP_WORDS[pip.state]}`} />}</For>
                </span>
              </Show>
              <span class="ac-now-text" data-presence={standing()?.state} title={standing()?.next}>
                {standing()?.text ?? line()?.text ?? ""}
              </span>
            </span>
          </button>
          <Show when={props.has(group().item!)}>
            <button type="button" class="ac-open" title="打开这样东西" aria-label={`打开「${group().title}」`} onClick={() => props.onOpen(group().item!)}>
              <Icon name="arrow" />
            </button>
          </Show>
        </div>
        <Show when={unfoldedHere()}>
          <Show when={props.advanced && group().events.length > 1}>
            <small class="ac-lasted">前后用了 {lasted(Date.parse(group().events.at(-1)!.at) - Date.parse(group().events[0]!.at))}</small>
          </Show>
        </Show>
        {steplist()}
      </section>
    )
  }

  return (
    <aside class="ac-panel" classList={{ open: open(), docked: docked(), running: meta().running, stalled: !!summary().stalled }} aria-label="动态">
      <button type="button" class="ac-rail mc-window" aria-expanded={open()} aria-label={open() ? "收起动态" : `打开动态${unseen() ? `，有 ${unseen()} 条新的` : ""}`} title={open() ? "收起动态" : summary().stalled || summary().line} onClick={() => choose(!open())}>
        {mark(() => (summary().stalled ? "warn" : meta().running ? "run" : "idle"), () => meta().running && !summary().stalled)}
        <span class="ac-rail-word">动态</span>
        <Show when={!open() && unseen()}>
          <b class="ac-count">{unseen() > 99 ? "99+" : unseen()}</b>
        </Show>
        <Icon name="arrow" class={open() ? "" : "back"} />
      </button>
      <Show when={open()}>
        <div class="ac-drawer mc-window">
          <header class="ac-head">
            <strong>动态</strong>
            <span class="ac-summary" role="status">
              正在做什么，最新的在上面
            </span>
            <button type="button" class="pa-mini" aria-label="收起动态" onClick={() => choose(false)}>
              <Icon name="close" />
            </button>
          </header>
          <Show when={summary().stalled}>
            <p class="ac-stalled" role="alert">
              {mark(() => "warn")}
              <span>{summary().stalled}</span>
            </p>
          </Show>
          <div class="ac-scroll" ref={scroller} onScroll={scrolled}>
            <Show when={groups().length} fallback={<p class="ac-empty">{meta().read ? summary().line : "正在读这个模组的动态…"}</p>}>
              <For each={ids()}>{body}</For>
            </Show>
          </div>
          <Show when={!following()}>
            <button type="button" class="ac-jump" onClick={toBottom}>
              {unseen() ? `有 ${unseen()} 条新动态，回到最新` : "回到最新"}
            </button>
          </Show>
          {/* The panel keeps the newest; 制作现场 has every thing's whole story. */}
          <button type="button" class="ac-floor" onClick={() => openFloor()}>
            在制作现场看全部
          </button>
        </div>
      </Show>
    </aside>
  )
}

import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { runSummaryCopy } from "./creator-card-copy"
import { supersededSound } from "./sound-placeholder"
import { createStore, reconcile } from "solid-js/store"
import type { Job } from "@minemods/mod-core/jobs"
import type { ActivityEvent, Making, OverviewItem, ProjectOverview, StudioView } from "../../api"
import type { ProjectRun, RunTask } from "../../project-runs"
import type { ModuleDocument, WorkspaceAsset } from "@minemods/mod-core/workspace"
import type { Ideas } from "@minemods/mod-core/blueprint-ideas"
import { MODULES } from "@minemods/mod-core/workspace-modules"
import { ModulePreview } from "./asset-workspace"
import { ModelCanvas } from "./model-canvas"
import { RecipeGrid } from "./asset-preview"
import { makingBadge, makingLine, makingLive, makingPicture } from "./asset-making"
import { draftPicture, pictureOf, type Picture } from "./asset-picture"
import { ideasCard, clearFloorTarget, floorTarget, setFloorShown } from "./making-floor-link"
import { filterRows, FLOOR_STATES, floorRows, groupRows, isWhole, nowMaking, recentEvents, recordRound, shortWhen, wholeId, type FloorRow, type FloorState, type RowMark, type WholeKind } from "./making-floor-model"
import { EventNode, FloorPicture, FloorZoom, FollowScroll, ThingStory, type Glyph, type Zoomed } from "./making-floor-thing"
import { activitySummary, clock, groupActivity } from "./project-activity-model"
import { StatusMark } from "./project-assets"
import { VoiceInput } from "./voice-input"
import { beforeConfirmWords, confirmDraft, waitingForYou, WAITING_WORDS, type WaitingKind } from "./waiting-for-you-model"
import { WaitingForYou } from "./waiting-for-you"
import { RefusalText } from "./play-text"
import { openCard } from "./making-floor-link"
import { threeViewsReady } from "./three-view"
import { notStarted } from "./three-view-model"
import { Button, Icon } from "../ui"
import { advanced } from "../advanced"
import { CHIP_WORDS } from "../connection-chip"
import { buildFailureWords } from "./build-failure-words"
import { kindLabel, namedOverviewItems, WORDS } from "../words"
import "./project-assets.css"
import "./asset-making.css"
import "./project-activity.css"
import "./external-workbench.css"
import "./making-floor.css"
import { Fold } from "../fold"
import { ReviewWaitNotice } from "./review-wait"
import { idleReason, reviewerLine } from "./floor-idle-model"
import { ReviewerLine } from "./floor-idle"
import { MakingLive } from "./making-live"

const states: Record<RunTask["state"] | ProjectRun["state"], string> = {
  planning: "规划中",
  awaiting_input: "等待补充",
  queued: "排队中",
  running: "制作中",
  validating: "检查中",
  saving: "保存中",
  completed: "做好了",
  partial: "做好了一部分",
  failed: "失败",
  blocked: "卡住了",
  canceled: "已取消",
  interrupted: "已中断",
}

const examples = [
  "做一只尾巴会发光的萤火狐，夜里在森林出没",
  "给苔皮苦力怕加一个更凶的蓄力动作",
  "做一个打开会随机掉落矿石的秘匣方块",
]

const busyStates = ["running", "validating", "saving"]
const stoppedStates = ["failed", "blocked", "canceled"]
// The newest events the live view lists at first; the rest are one press away.
const RECENT = 120
// Everything the log can hold (it keeps 1500 and some slack), so no thing's story is cut short on screen.
const KEPT = 2000
const WHOLE_GLYPHS: Record<WholeKind, Glyph> = { plan: "document", batch: "logic", build: "tool", person: "check", tool: "link", check: "search", note: "copy" }
const RUN_MARK: Record<ProjectRun["state"], RowMark> = { planning: "run", awaiting_input: "warn", running: "run", completed: "ok", partial: "warn", canceled: "note", failed: "fail", interrupted: "warn" }
const EMPTY_ROW: FloorRow = { id: "", item: null, state: "whole", title: "", kind: "", kindLabel: "", rounds: 0, verdict: "", at: null, mark: "note", events: [], search: "" }
const sameList = (left: string[], right: string[]) => left.join("\n") === right.join("\n")
const plain = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback)
// The same pixel shapes the 动态 panel uses for how a thing stands.
const marks: Record<RowMark, string[]> = {
  run: ["1111111", "0100010", "0011100", "0001000", "0011100", "0111110", "1111111"],
  ok: ["0000000", "0000001", "0000011", "1000110", "1101100", "0111000", "0010000"],
  fail: ["1100011", "1110111", "0111110", "0011100", "0111110", "1110111", "1100011"],
  warn: ["0011100", "0011100", "0011100", "0011100", "0001000", "0000000", "0001000"],
  note: ["0000000", "0000000", "0011100", "0011100", "0011100", "0000000", "0000000"],
  idle: ["0000000", "0110110", "0110110", "0110110", "0110110", "0110110", "0000000"],
}
const pixels = (rows: string[]) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "1" ? [`M${x} ${y}h1v1h-1z`] : []))).join("")
function Mark(props: { state: RowMark; live?: boolean }) {
  return (
    <span class="ac-mark" data-state={props.state} classList={{ live: props.live }}>
      <svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
        <path fill="currentColor" d={pixels(marks[props.state])} />
      </svg>
    </span>
  )
}

/**
 * 制作现场: the page where the making is seen, whole. Left, every thing of the mod that has a record, grouped
 * by how it stands; right, the chosen thing's story (the making story of the overview card and every event the
 * log has about it, in the order they happened), or with nothing chosen the live view: what is being made
 * now and the newest events of all things, each leading to its thing. It reads the overview, the making
 * records, the activity log and the runs, and changes nothing but what the person starts or stops here.
 *
 * Both connections use it: with an outside AI (MCP) it also shows the drafts that client has handed over;
 * with Studio's own AI it carries the box a request is typed into.
 */
export function MakingFloor(props: {
  view: StudioView
  runs: ProjectRun[]
  drafts: Record<string, ModuleDocument>
  percentages: Record<string, number | null>
  /** An outside AI builds through MCP; false when Studio's own AI does. */
  external: boolean
  /** The outside client is connected, or Studio's own AI is set up. */
  connected: boolean
  /** An outside AI's connection as it stands; absent with Studio's own AI. */
  presence?: string
  enabled: boolean
  /** Something else is busy, so no new request can be started from here. */
  disabled?: boolean
  onSettings: () => void
  onCancel: (runId: string) => Promise<void>
  onAsset: (asset: WorkspaceAsset) => void
  /** Studio's own AI only: hand a typed request over. */
  onRun?: (prompt: string) => Promise<void>
  onDirty?: (dirty: boolean) => void
  /** The project changed on this page (the blueprint was confirmed here), so the window reads it again. */
  onChanged?: () => void
  /** The 模型精细度 button at the top as it stands: a model made by another level says so beside its kind. */
  modelComplexity?: "low" | "medium" | "high"
}) {
  const [pinned, setPinned] = createSignal<string | null>(null)
  const [error, setError] = createSignal("")
  const [copied, setCopied] = createSignal("")
  const [build, setBuild] = createSignal<Job | null>(null)
  const [state, setState] = createStore<{ overview: ProjectOverview | null }>({ overview: null })
  const [log, setLog] = createStore<{ events: ActivityEvent[] }>({ events: [] })
  const [meta, setMeta] = createSignal({ running: false, skew: 0, aliveAt: null as number | null, read: false })
  const [tick, setTick] = createSignal(Date.now())
  const [makings, setMakings] = createStore<{ of: Record<string, Making | undefined> }>({ of: {} })
  const [answered, setAnswered] = createSignal<string[]>([])
  // null follows whatever is being made; "live" is the live view; anything else is a row the person chose.
  const [chosen, setChosen] = createSignal<string | null>(null)
  const [round, setRound] = createSignal<{ round: number; at?: string } | null>(null)
  const [search, setSearch] = createSignal("")
  const [onlyState, setOnlyState] = createSignal<FloorState | "">("")
  const [onlyKind, setOnlyKind] = createSignal("")
  const [zoom, setZoom] = createSignal<Zoomed | null>(null)
  const [more, setMore] = createSignal(1)
  const [prompt, setPrompt] = createSignal("")
  const [sending, setSending] = createSignal(false)
  const [sent, setSent] = createSignal(false)
  const [folded, setFolded] = createSignal(false)
  // What waits for the person (see `waitingForYou`): cards of ideas on the table, and the confirm button's own progress.
  const [ideas, setIdeas] = createSignal<Ideas | null>(null)
  const [confirming, setConfirming] = createSignal(false)
  const [waitError, setWaitError] = createSignal("")
  // A thing being made, or with a recorded making, shows the live page; the rounds and pictures of old are one press away, and stay put until pressed back.
  const [storyOf, setStoryOf] = createSignal<string | null>(null)
  const [traced, setTraced] = createSignal<string[]>([])

  // By value: the view is new whenever a task changes state, and `on` alone would empty the page and read it all again each time.
  const projectId = createMemo(() => props.view.project.id)
  const items = createMemo(() => namedOverviewItems((state.overview?.items ?? []).filter((item) => !supersededSound(props.view.project, item)), props.view.project.workspace.assets))
  const byId = createMemo(() => new Map(items().map((item) => [item.id, item])))
  const kinds = createMemo(() => new Map((state.overview?.kinds ?? []).map((kind) => [kind.id, { ...kind, label: kindLabel(kind.id, kind.label) }])))
  const last = () => log.events.at(-1)?.seq ?? 0

  setFloorShown(true)
  onCleanup(() => {
    setFloorShown(false)
    props.onDirty?.(false)
  })

  // The latest build job, as before.
  createEffect(() => {
    const id = projectId()
    const polling = { stopped: false, timer: 0 }
    const poll = async () => {
      const result = await window.studio.getLatestBuild({ projectId: id }).catch(() => null)
      if (polling.stopped) return
      setBuild(result)
      polling.timer = window.setTimeout(() => void poll(), 1500)
    }
    void poll()
    onCleanup(() => {
      polling.stopped = true
      window.clearTimeout(polling.timer)
    })
  })

  // The overview, every thing's making record and the activity log, read for as long as the page shows.
  createEffect(
    on(projectId, (id) => {
      setState("overview", null)
      setLog("events", [])
      setMakings("of", reconcile({}))
      setAnswered([])
      setMeta({ running: false, skew: 0, aliveAt: null, read: false })
      const poll = { stopped: false, overview: 0, activity: 0, draining: false }
      // What a record was last read for: a thing is read again when it is saved anew or its state changes.
      const read = new Map<string, string>()
      const queue: string[] = []
      const stamp = (item: OverviewItem) => `${item.revision}:${item.status}:${item.facts.saved}`
      const drain = async () => {
        if (poll.draining) return
        poll.draining = true
        while (queue.length && !poll.stopped) {
          const itemId = queue.shift()!
          const item = byId().get(itemId)
          const record = await window.studio.getMaking({ projectId: id, itemId }).then((value) => ({ value }), () => null)
          if (poll.stopped) return
          if (!record) continue
          setMakings("of", itemId, record.value ? reconcile(record.value, { key: "round" }) : undefined)
          if (item) read.set(itemId, stamp(item))
          if (!answered().includes(itemId)) setAnswered([...answered(), itemId])
        }
        poll.draining = false
      }
      const want = () => {
        const shown = shownId()
        const wanted = items().filter((item) => item.status === "making" || makingLive(makings.of[item.id]) || read.get(item.id) !== stamp(item))
        // The row on screen first, then what is being made, then the rest.
        const ordered = [...wanted.filter((item) => item.id === shown), ...wanted.filter((item) => item.id !== shown && item.status === "making"), ...wanted.filter((item) => item.id !== shown && item.status !== "making")]
        ordered.forEach((item) => queue.includes(item.id) || queue.push(item.id))
        void drain()
      }
      const overview = async () => {
        const next = await window.studio.getProjectOverview({ projectId: id }).then((value) => ({ value }), () => null)
        if (poll.stopped) return
        if (next) setState("overview", next.value ? reconcile(next.value, { key: "id" }) : null)
        // Read beside the overview: an outside AI can put cards on the table at any moment, and this page says they wait for the person.
        const cards = await window.studio.getIdeas({ projectId: id }).then((value) => ({ value }), () => null)
        if (poll.stopped) return
        if (cards) setIdeas(cards.value ?? null)
        want()
        poll.overview = window.setTimeout(() => void overview(), running() ? 1500 : 4000)
      }
      const activity = async () => {
        // A read that fails keeps what is on screen; the next one asks again from the same place.
        const next = await window.studio.getActivity({ projectId: id, after: last() }).catch(() => null)
        if (poll.stopped) return
        const fresh = next ? next.events.filter((event) => event.seq > last()) : []
        if (fresh.length) setLog("events", reconcile([...log.events, ...fresh].slice(-KEPT), { key: "seq" }))
        if (next) setMeta({ running: next.running, skew: Date.parse(next.now) - Date.now(), aliveAt: next.alive_at ? Date.parse(next.alive_at) : null, read: true })
        // An answer that could not be had is not "still reading": the page says what it has.
        if (!next && !meta().read) setMeta({ ...meta(), read: true })
        setTick(Date.now())
        // A read holds at most 400 events: more to come is asked for at once.
        poll.activity = window.setTimeout(() => void activity(), next && next.last > last() ? 0 : meta().running ? 1500 : 4000)
      }
      void overview()
      void activity()
      // Choosing a row reads its record without waiting for the next round of the poll.
      createEffect(on(shownId, () => want(), { defer: true }))
      onCleanup(() => {
        poll.stopped = true
        window.clearTimeout(poll.overview)
        window.clearTimeout(poll.activity)
      })
    }),
  )

  const latest = createMemo(() => props.runs[0])
  const task = createMemo(() => {
    const tasks = latest()?.tasks ?? []
    if (pinned()) return tasks.find((value) => value.id === pinned()) ?? tasks.at(-1)
    return tasks.find((value) => busyStates.includes(value.state)) ?? tasks.at(-1)
  })
  const savedAsset = (value?: { asset_id: string | null }) => props.view.project.workspace.assets.find((asset) => asset.id === value?.asset_id)
  const asset = createMemo(() => savedAsset(task()))
  const draft = () => (task() && task()!.state !== "completed" ? props.drafts[task()!.id] : undefined)
  const document = createMemo(() => (task()?.state === "completed" ? asset()?.document : (draft() ?? asset()?.document)))
  const model = createMemo(() => {
    const value = document()
    return value?.kind === "model" ? value : null
  })
  // Every batch still going, not only the newest: a new conversation can start one while the last one's is left going.
  const going = () => props.runs.filter((run) => ["running", "planning", "awaiting_input"].includes(run.state))
  const runBusy = () => going().length > 0
  const running = () => runBusy() || meta().running || !!state.overview?.production.running
  const waits = createMemo(() =>
    waitingForYou({
      blueprint: state.overview?.blueprint ?? null,
      madeCount: items().filter((item) => item.status !== "out_of_scope").length,
      // The person has not said go: cards are on the table and the choice is still theirs (`ready` means they did, and the AI is to draw the plan).
      ideasWaiting: !!ideas()?.groups.length && ideas()!.state === "choosing",
      toReview: state.overview?.production?.to_review ?? 0,
      keptReview: items().filter((item) => item.status === "review" && (item.ai_unsatisfied || item.ai_interrupted)).length,
      external: props.external,
      running: running(),
    }),
  )
  // The same action as the overview's 「确认蓝图」. A model with no 六视图 is asked about first; going to add one leads to that thing's card.
  const confirmHere = async () => {
    const plan = state.overview?.blueprint
    if (confirming() || !plan) return
    setConfirming(true)
    setWaitError("")
    await confirmDraft({
      projectId: projectId(),
      revision: plan.revision,
      external: props.external,
      ready: () => threeViewsReady(projectId(), items().filter(notStarted), (item) => openCard(item.id)),
      afterConfirm: () => props.onChanged?.(),
      studio: window.studio,
    }).then(
      async (done) => {
        if (!done.confirmed) return
        const next = done.started ?? (await window.studio.getProjectOverview({ projectId: projectId() }))
        setState("overview", reconcile(next, { key: "id" }))
      },
      (cause: unknown) => setWaitError(plain(cause, "这一步没成功，请再试一次。")),
    )
    setConfirming(false)
  }
  const goWaiting = (kind: WaitingKind) => openCard(kind === "review" ? items().find((item) => item.status === "review")?.id : kind === "ideas" ? ideasCard : undefined)

  const stopped = createMemo(
    () =>
      (!!task() && stoppedStates.includes(task()!.state)) ||
      ["interrupted", "failed", "partial", "canceled"].includes(latest()?.state ?? ""),
  )
  const percent = () => {
    const value = task() ? props.percentages[task()!.id] : null
    if (task()?.state === "completed") return 100
    return typeof value === "number" ? Math.max(0, Math.min(100, value)) : null
  }
  const done = () => latest()?.tasks.filter((value) => value.state === "completed").length ?? 0
  const completedAssets = createMemo(() => (latest()?.tasks ?? []).flatMap((value) => {
    const saved = savedAsset(value)
    return value.state === "completed" && saved ? [saved] : []
  }))
  const stateText = () => {
    const current = task()
    if (!current) return ""
    return draft() ? "草稿 · 尚未保存" : states[current.state]
  }
  const buildText = (job: Job) =>
    job.project_revision !== props.view.project.revision
      ? `有新修改，要重新${WORDS.pack}`
      : job.state === "completed"
        ? WORDS.packed
        : job.state === "running" || job.state === "queued"
          ? `正在${WORDS.pack}…`
          : `${WORDS.pack}没做成`
  const cancel = async () => {
    const runs = going()
    if (!runs.length) return
    setError("")
    await Promise.all(runs.map((run) => props.onCancel(run.id))).catch((cause: unknown) => setError(plain(cause, "停止失败，请重试。")))
  }
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text)
      window.setTimeout(() => setCopied(""), 1600)
    })
  }
  const counts = () => {
    const project = props.view.project
    return [
      { label: "生物", value: project.entities.length, icon: "entity" as const },
      { label: "方块", value: project.blocks.length, icon: "cube" as const },
      { label: "物品", value: project.items.length, icon: "item" as const },
      { label: "配方", value: project.recipes.length, icon: "recipe" as const },
    ]
  }
  // The thing a task of a run made or is making.
  const itemOfTask = (value: RunTask) => items().find((item) => item.asset_id === value.asset_id) ?? items().find((item) => item.kind === value.module && item.title === value.title)
  // What an outside AI has shown of a thing it has not saved yet.
  const draftOf = (item: OverviewItem) => {
    if (item.status !== "making") return null
    const found = (latest()?.tasks ?? []).find((value) => props.drafts[value.id] && (item.asset_id ? value.asset_id === item.asset_id : value.module === item.kind && value.title === item.title))
    return found ? { kind: found.module, title: found.title, asset_id: found.asset_id, document: props.drafts[found.id]!, progress: props.percentages[found.id] ?? null } : null
  }

  // A chosen thing that only has a draft so far is shown on the stage: the stage then holds that draft, not whatever runs.
  createEffect(() => {
    const item = shownRow()?.item
    const found = item && draftOf(item) ? (latest()?.tasks ?? []).find((value) => props.drafts[value.id] && (item.asset_id ? value.asset_id === item.asset_id : value.module === item.kind && value.title === item.title)) : undefined
    if (found) setPinned(found.id)
  })

  const rows = createMemo(() =>
    floorRows({
      items: items(),
      kinds: [...kinds().values()],
      makings: makings.of,
      events: log.events,
      say: makingLine,
      top: props.modelComplexity,
      whole: {
        ...(props.runs.length ? { batch: { verdict: runSummaryCopy(latest()!.summary || latest()!.prompt), at: latest()!.updated_at, mark: RUN_MARK[latest()!.state], search: props.runs.flatMap((run) => [run.prompt, run.summary, ...run.tasks.map((value) => value.title)]).join("\n") } } : {}),
        ...(build() ? { build: { verdict: buildText(build()!), at: null, mark: build()!.state === "completed" ? "ok" : build()!.state === "failed" ? "fail" : "run" } } : {}),
      },
    }),
  )
  // A row that only 高级 has anything to show for is not listed without it.
  const listed = createMemo(() => rows().filter((row) => advanced() || !isWhole(row.id) || !row.events.length || row.events.some((event) => !event.quiet && !event.step) || (row.id === wholeId("batch") && props.runs.length) || (row.id === wholeId("build") && build())))
  const groups = createMemo(() => groupRows(filterRows(listed(), { search: search(), state: onlyState(), kind: onlyKind() })))
  const nowIds = createMemo(() => rows().filter((value) => value.state === "making").map((value) => value.id), [], { equals: sameList })
  const groupIds = createMemo(() => groups().map((group) => group.id), [], { equals: sameList })
  const usedKinds = createMemo(() => [...kinds().values()].filter((kind) => items().some((item) => item.kind === kind.id)))
  const current = createMemo(() => nowMaking(rows()))
  const shownId = createMemo(() => chosen() ?? current()?.id ?? "live")
  const shownRow = createMemo(() => (shownId() === "live" ? null : (rows().find((row) => row.id === shownId()) ?? null)))
  // What the story reads: the row on screen, kept while the story is being taken away so nothing in it reads a row that is gone.
  const heldRow = createMemo<FloorRow>((held) => shownRow() ?? held, EMPTY_ROW)
  // `at`: the time of the record that named the round, so one from before a redo is not opened as a round of the new making.
  const select = (id: string, wanted?: number, at?: string) => {
    setRound(wanted === undefined ? null : { round: wanted, at })
    setChosen(id)
  }
  // Asked for from elsewhere (the overview card, the 动态 panel): that thing, at that round; with no thing, whatever is being made.
  createEffect(() => {
    const target = floorTarget()
    if (!target) return
    clearFloorTarget()
    setRound(target.round === undefined ? null : { round: target.round, at: target.at })
    setChosen(target.item ?? null)
  })
  // The line under the title counts the list itself, so the two can never disagree.
  const standing = createMemo(() => {
    const count = (id: FloorState) => rows().filter((value) => value.state === id).length
    const parts = [
      [count("making"), "正在做"],
      [count("queued"), "在排队"],
      [count("review"), "等你验收"],
      [count("done"), "做好了"],
      [count("stuck"), "没做成或被卡住"],
      [count("waiting"), "还没做或要重做"],
    ] as const
    return parts.filter(([value]) => value).map(([value, label]) => `${label} ${value} 样`).join(" · ")
  })
  const summary = createMemo(() => activitySummary(groupActivity(log.events, meta().running), { running: meta().running, now: tick() + meta().skew, aliveAt: meta().aliveAt }))
  // Why nothing is being made, from what Studio really knows (see `idleReason`); null says nothing and the page keeps its old words.
  const idle = createMemo(() => {
    const overview = state.overview
    if (!overview || !meta().read) return null
    return idleReason({
      external: props.external,
      connected: props.connected,
      blueprint: overview.blueprint?.state ?? null,
      ideasWaiting: !!ideas()?.groups.length && ideas()!.state === "choosing",
      ai: overview.blueprint_wait?.ai,
      production: overview.production,
      events: log.events,
      now: tick() + meta().skew,
    })
  })
  // 「审查」 switched on is not the same as a reviewing window being connected: said apart, once a thing has been made or is in hand.
  const reviewer = createMemo(() => reviewerLine({ external: props.external, reviewOn: state.overview?.review_on, reviewer: state.overview?.review_window }))
  const glyphOf = (row: FloorRow): Glyph => (row.item ? ((kinds().get(row.item.kind)?.glyph ?? "cube") as Glyph) : isWhole(row.id) ? WHOLE_GLYPHS[row.id.slice(6) as WholeKind] : "cube")
  const pictureFor = (row: FloorRow): Picture | null => {
    const item = row.item
    if (!item) return null
    const shown = draftOf(item)
    const early = item.status === "making" || !item.facts.saved ? ((shown ? draftPicture(shown) : null) ?? makingPicture(makings.of[item.id])) : null
    return early ?? pictureOf(projectId(), props.view.project, items(), item)
  }
  // With no draft to stand on the stage, the live view shows the newest picture the making loop has of the thing in hand.
  const watch = createMemo(() => {
    const row = current()
    const round = row ? makings.of[row.id]?.rounds.filter((value) => value.pictures.length).at(-1) : undefined
    return row && round ? { url: round.pictures[0]!.url, label: `${row.title} · 第 ${round.round} 轮看到的样子` } : null
  })
  // The asset a thing is being or was made into: known from the task before anything is saved.
  const assetOfItem = (item: OverviewItem) => item.asset_id ?? (latest()?.tasks ?? []).find((value) => value.module === item.kind && value.title === item.title)?.asset_id ?? null
  const busyTask = () => (latest()?.tasks ?? []).find((value) => busyStates.includes(value.state))
  /**
   * The thing the live page is about. Usually a row of the list; but a first version asked for outside any plan is on no list until it is saved (its row is only the log's), and
   * with nothing chosen the page follows whatever is in hand. Pressing 「全部动态」 asks for the feed: that is what it then gets.
   */
  const subject = createMemo(() => {
    const row = shownRow()
    if (row?.item) return { id: row.item.id, assetId: assetOfItem(row.item), title: row.item.title, kind: row.item.kind, making: row.item.status === "making" && (!row.item.queued || busyTask()?.asset_id === assetOfItem(row.item)), said: row.item.review?.note ?? "", events: row.events }
    const task = busyTask()
    if (!task || chosen() === "live" || (row && row.id !== task.asset_id)) return null
    return { id: task.asset_id, assetId: task.asset_id as string | null, title: task.title, kind: task.module as string, making: true, said: "", events: log.events.filter((event) => event.item === task.asset_id) }
  })
  // Kept while the page is being taken away: a task that just ended leaves no subject, and what is still on screen reads it once more on its way out.
  const heldSubject = createMemo<NonNullable<ReturnType<typeof subject>>>((held) => subject() ?? held, { id: "", assetId: null, title: "", kind: "", making: false, said: "", events: [] })
  const liveAsset = () => subject()?.assetId ?? null
  createEffect(
    on(liveAsset, (assetId) => {
      if (!assetId || traced().includes(assetId)) return
      void window.studio.getMakingTrace({ projectId: projectId(), assetId }).then((trace) => {
        if (trace.steps.length && !traced().includes(assetId)) setTraced([...traced(), assetId])
      }, () => undefined)
    }),
  )
  const showLive = () => {
    const value = subject()
    return !!value?.assetId && storyOf() !== value.id && round() === null && (value.making || traced().includes(value.assetId))
  }
  const feed = createMemo(() => recentEvents(log.events, advanced(), RECENT * more()))
  const hidden = createMemo(() => recentEvents(log.events, advanced(), KEPT).length - feed().length)
  // Nothing was ever made or said here: the page explains itself instead of showing empty panels.
  const blank = () => !log.events.length && !props.runs.length && !items().some((item) => item.facts.saved || item.status === "making")
  const canRun = () => !!prompt().trim() && !props.disabled && props.connected && !sending() && !running()
  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!canRun() || !props.onRun) return
    setSending(true)
    setError("")
    await props.onRun(prompt().trim()).then(
      () => {
        setSent(true)
        setPrompt("")
        props.onDirty?.(false)
        setChosen(null)
      },
      (cause: unknown) => {
        setError(plain(cause, "这句要求没有交出去，请再试一次。"))
        props.onDirty?.(true)
      },
    )
    setSending(false)
  }

  const stage = () => (
    <div class="external-stage" data-busy={!!task() && busyStates.includes(task()!.state)}>
      {/* The state line and its buttons used to float over the stage and hid what was drawn under them (a finished recipe's ingredients), so they get a row of their own above it. */}
      <Show when={task() || pinned()}>
        <div class="external-stage-head">
          <Show when={task()}>
            {(value) => (
              <div class="external-caption">
                <span class="external-state" data-state={draft() ? "draft" : value().state}>
                  {stateText()}
                </span>
                <strong>{value().title}</strong>
                <Show when={value().detail && !stoppedStates.includes(value().state)}>
                  <p>{value().detail}</p>
                </Show>
              </div>
            )}
          </Show>
          <div class="external-stage-actions">
            <Show when={pinned()}>
              <button type="button" class="external-pill" onClick={() => setPinned(null)}>
                <i class="external-live-dot" />
                回到实时
              </button>
            </Show>
            <Show when={task() && itemOfTask(task()!)}>
              {(item) => (
                <button type="button" class="external-pill" onClick={() => select(item().id)}>
                  看它的全部经过
                </button>
              )}
            </Show>
            <Show when={asset() && task()?.state === "completed"}>
              <button type="button" class="external-pill" onClick={() => props.onAsset(asset()!)}>
                打开
                <Icon name="arrow" />
              </button>
            </Show>
          </div>
        </div>
      </Show>
      <Show
        when={document()}
        fallback={
          <div class="external-empty">
            <span class="external-empty-glyph" data-state={stopped() ? "stopped" : task()?.state}>
              <Icon name={stopped() ? "close" : task() ? MODULES[task()!.module].glyph : "cube"} />
            </span>
            <h2>{stopped() ? "这一步没做完" : task()?.state === "completed" ? "这一步做完了" : "在等下一份看得见的草稿"}</h2>
            <p>
              {stopped()
                ? completedAssets().length
                  ? "已保存的成果还在工程里，让 AI 读取最新工程继续就好。"
                  : "这次还没有保存成果，让 AI 读取最新工程再试一次。"
                : task()?.state === "completed"
                  ? "成果已保存，点下方卡片查看。"
                  : "AI 提交第一份草稿后，这里会立刻出现预览。"}
            </p>
            <Show when={stopped() && task()?.error}>
              <Fold class="external-failure" summary="查看原因">
                <p>
                  <RefusalText text={task()!.error!} advanced={advanced()} />
                </p>
              </Fold>
            </Show>
          </div>
        }
      >
        <Show
          when={model()}
          fallback={
            <Show when={document()} keyed>
              {(value) => (
                <div class="external-document">
                  {/* A recipe is its station, the way its card in the overview draws it: drawn as loose words it read as a row of ids. */}
                  <Show when={value.kind === "recipe" && value} fallback={<ModulePreview document={value} project={props.view.project} />}>
                    {(recipe) => <RecipeGrid projectId={projectId()} project={props.view.project} items={items()} pattern={recipe().pattern} result={recipe().result} count={recipe().count} type={recipe().type} onOpen={select} />}
                  </Show>
                </div>
              )}
            </Show>
          }
        >
          <ModelCanvas
            view={{
              model: model(),
              preview: task()?.state === "completed" && props.view.entity_id === task()?.asset_id ? props.view.preview : null,
            }}
            modes={[]}
          />
        </Show>
      </Show>
      <Show when={percent() !== null && task()?.state !== "completed"}>
        <div class="external-meter" role="progressbar" aria-label="现在这一步的进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent()!}>
          <span style={{ width: `${percent()}%` }} />
        </div>
      </Show>
    </div>
  )

  // Every run with everything it recorded: what was asked, how it was split, what each piece came to.
  const runsRecord = () => (
    <div class="mf-runs">
      <For each={props.runs}>
        {(run, index) => (
          <Fold
            class="mf-run"
            open={index() === 0}
            arrow={false}
            summary={
              <>
                <span class="external-run-state" data-state={run.state}>
                  {states[run.state]}
                </span>
                <strong>{runSummaryCopy(run.summary || run.prompt)}</strong>
                <time>{shortWhen(run.updated_at)}</time>
              </>
            }
          >
            <p class="mf-brief">
              <span>你当时说的</span>
              {run.prompt}
            </p>
            <For each={run.questions}>{(question) => <p class="external-question">{question}</p>}</For>
            <Show when={run.error}>
              <p class="mf-reason" data-status="failed">
                <RefusalText text={run.error!} advanced={advanced()} />
              </p>
            </Show>
            <ul class="mf-run-tasks">
              <For each={run.tasks}>
                {(value) => (
                  <li data-state={value.state}>
                    <span class="mf-kind">{kindLabel(value.module, MODULES[value.module].label)}</span>
                    <Show when={itemOfTask(value)} fallback={<strong>{value.title}</strong>}>
                      {(item) => (
                        <button type="button" class="pa-link" onClick={() => select(item().id)}>
                          {value.title}
                        </button>
                      )}
                    </Show>
                    <em>{states[value.state]}</em>
                    <Show when={value.outcome}>
                      <em class="pa-unsat">{value.outcome === "kept_interrupted" ? "被中断了" : "AI 还不满意"}</em>
                    </Show>
                    <Show when={value.detail || value.prompt}>
                      <small>{value.detail || value.prompt}</small>
                    </Show>
                    <Show when={value.dependencies.length}>
                      <small>要先有：{value.dependencies.join("、")}</small>
                    </Show>
                    <Show when={value.error}>
                      <small class="mf-run-error">
                        <RefusalText text={value.error!} advanced={advanced()} />
                      </small>
                    </Show>
                    <Show when={advanced()}>
                      <pre class="mf-tech">{[`task ${value.id}`, `asset ${value.asset_id}`, value.module, value.state, value.started_at ? `开始 ${value.started_at}` : null, value.finished_at ? `结束 ${value.finished_at}` : null].filter(Boolean).join(" · ")}</pre>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
            <Show when={run.events.length}>
              <Fold class="mf-run-events" summary={<>这一批自己记下的 {run.events.length} 条</>}>
                <ol>
                  <For each={run.events}>
                    {(event) => (
                      <li>
                        <time>{clock(event.time)}</time>
                        <Show when={run.tasks.find((value) => value.id === event.task_id)}>{(value) => <b>{value().title}</b>}</Show>
                        <span>{event.message}</span>
                      </li>
                    )}
                  </For>
                </ol>
              </Fold>
            </Show>
            <Show when={advanced()}>
              <pre class="mf-tech">{[`run ${run.id}`, run.state, `开始 ${run.created_at}`, `更新 ${run.updated_at}`, run.model_complexity ? `精细程度 ${run.model_complexity}` : null].filter(Boolean).join(" · ")}</pre>
            </Show>
          </Fold>
        )}
      </For>
    </div>
  )
  const buildRecord = () => (
    <Show when={build()}>
      {(job) => (
        <div class="mf-runs">
          <p class="mf-reason" data-status={job().state === "failed" ? "failed" : undefined}>
            <b>最近一次打包</b>
            {buildText(job())}
            <Show when={job().error}>：{buildFailureWords(job().error ?? "")}</Show>
          </p>
          <Show when={advanced()}>
            <pre class="mf-tech">{[`job ${job().id}`, job().state, `工程版本 ${job().project_revision}（现在 ${props.view.project.revision}）`].join(" · ")}</pre>
          </Show>
        </div>
      )}
    </Show>
  )

  // Rows are made anew whenever anything is read again; the list keeps one button per id, so what is on screen changes in place.
  const rowsById = createMemo(() => new Map(rows().map((value) => [value.id, value])))
  const row = (id: string) => {
    const held = createMemo<FloorRow>((kept) => rowsById().get(id) ?? kept, rowsById().get(id) ?? EMPTY_ROW)
    return rowButton(held)
  }
  const rowButton = (value: () => FloorRow) => (
    <button type="button" class="mf-row" data-row={value().id} data-state={value().state} aria-pressed={shownId() === value().id || (showLive() && subject()?.id === value().id)} onClick={() => select(value().id)}>
      <span class="mf-row-slot">
        <FloorPicture picture={pictureFor(value())} glyph={glyphOf(value())} />
        <Show when={value().item} fallback={<Mark state={value().mark} live={value().mark === "run" && running()} />}>
          {(item) => <StatusMark status={item().status} label={item().status_label} />}
        </Show>
        <Show when={value().item?.status === "making" && makingBadge(makings.of[value().id], true)}>{(badge) => <em class="pa-round">{badge()}</em>}</Show>
      </span>
      <span class="mf-row-words">
        <strong>{value().title}</strong>
        <small class="mf-row-meta">
          <span>{value().kindLabel}</span>
          <Show when={value().rounds}>
            <span>{value().rounds} 轮</span>
          </Show>
          <Show when={value().at}>
            <time>{shortWhen(value().at, tick())}</time>
          </Show>
        </small>
        <small class="mf-row-verdict">{value().verdict}</small>
      </span>
    </button>
  )

  const liveView = () => (
    <section class="mf-live" aria-label="现在的动态">
      <div class="mf-live-main">
        <Show when={rows().some((value) => value.state === "making")}>
          <div class="mf-now">
            <h3>
              现在在做<small>点一样，看它一轮一轮是怎么做的</small>
            </h3>
            <div class="mf-now-cards">
              <For each={nowIds()}>
                {(id) => {
                  const value = createMemo<FloorRow>((kept) => rowsById().get(id) ?? kept, rowsById().get(id) ?? EMPTY_ROW)
                  return (
                    <button type="button" class="mf-now-card" data-row={value().id} onClick={() => select(value().id)}>
                      <FloorPicture picture={pictureFor(value())} glyph={glyphOf(value())} large />
                      <span class="mf-row-words">
                        <strong>{value().title}</strong>
                        <small class="mf-row-meta">
                          <span>{value().kindLabel}</span>
                          <Show when={makingBadge(makings.of[value().id])}>{(badge) => <span>{badge()}</span>}</Show>
                        </small>
                        <small class="mf-row-verdict">{value().verdict}</small>
                      </span>
                    </button>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
        <Show when={document() || (props.external && latest())}>{stage()}</Show>
        <Show when={!document() && !(props.external && latest()) && watch()}>
          {(shown) => (
            <button type="button" class="mf-watch mc-well" title="点一下放大看" onClick={() => setZoom({ url: shown().url, label: shown().label })}>
              <img src={shown().url} alt={shown().label} draggable={false} />
              <em>{shown().label}</em>
            </button>
          )}
        </Show>
        <Show when={latest()}>
          {(run) => (
            <section class="external-strip" aria-label="这一批的进度">
              {/* The class names beginning `project-run-` are what the end-to-end checks of the old task page look for. */}
              <div class="external-strip-heading project-run-focus-header">
                <button type="button" class="project-run-summary mf-run-fold" aria-expanded={!folded()} title={folded() ? "展开这一批的每一项" : "收起这一批的每一项"} onClick={() => setFolded(!folded())}>
                  <span class="external-run-state project-run-state" data-state={run().state} role="status">
                    {states[run().state]}
                  </span>
                  <strong class="mf-run-title">{runSummaryCopy(run().summary || run().prompt)}</strong>
                  <span class="external-strip-count">
                    {done()} / {run().tasks.length} 项已做好
                  </span>
                </button>
                <button type="button" class="pa-link" onClick={() => select(wholeId("batch"))}>
                  看每一批的记录
                </button>
              </div>
              <For each={run().questions}>{(question) => <p class="external-question">{question}</p>}</For>
              <Show when={run().error}>
                <p class="mf-reason" data-status="failed">
                  <RefusalText text={run().error!} advanced={advanced()} />
                </p>
              </Show>
              <For each={run().tasks.filter((value) => value.error)}>
                {(value) => (
                  <p class="mf-reason" data-status="failed">
                    <b>{value.title}</b>
                    <RefusalText text={value.error!} advanced={advanced()} />
                  </p>
                )}
              </For>
              <Show when={!folded()}>
                <div class="external-tiles project-run-detail">
                  <For each={run().tasks}>
                    {(item) => (
                      <button
                        type="button"
                        class="external-tile project-run-task"
                        data-state={item.state}
                        aria-pressed={task()?.id === item.id}
                        title={item.error ?? item.detail ?? item.title}
                        onClick={() => {
                          const thing = itemOfTask(item)
                          // With a draft or a saved document the stage shows it; otherwise the click goes straight to the thing's story.
                          if (thing && !props.drafts[item.id] && !props.external) return select(thing.id)
                          setPinned(item.id === pinned() ? null : item.id)
                        }}
                        onDblClick={() => {
                          const saved = savedAsset(item)
                          if (saved && item.state === "completed") props.onAsset(saved)
                        }}
                      >
                        <span class="external-tile-glyph" data-state={item.state}>
                          <Icon name={MODULES[item.module].glyph} />
                          <Show when={item.state === "completed"}>
                            <i class="external-tile-check">
                              <Icon name="check" />
                            </i>
                          </Show>
                        </span>
                        <span class="external-tile-copy">
                          <strong>{item.title}</strong>
                          <small>
                            {kindLabel(item.module, MODULES[item.module].label)} · {states[item.state]}
                            <Show when={busyStates.includes(item.state) && props.percentages[item.id] != null}> {props.percentages[item.id]}%</Show>
                          </small>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          )}
        </Show>
        <Show when={blank() || (!latest() && !rows().some((value) => value.state === "making"))}>
          <div class="external-idle mf-idle">
            <div class="external-idle-copy">
              <h2>{blank() ? "准备好，看创作发生" : (idle()?.title ?? "现在没有在做的")}</h2>
              <p>{!blank() && idle() ? idle()!.text : props.external ? "在已经接上的 AI 助手里说出你的想法，制作过程会实时出现在这里。" : props.onRun ? "在下面写一句想做什么，或者到「工程总览」从想法开始。做的每一步都会记在这里。" : "制作过程会实时出现在这里。"}</p>
              <Show when={!blank() && idle()?.action}>
                {(action) => (
                  <button type="button" class="pa-link" onClick={() => openCard()}>
                    {action().label}
                  </button>
                )}
              </Show>
              {/* Example sentences and empty counts are for a start with nothing to report; once Studio can say why nothing is being made, that one sentence is the page. */}
              <Show when={blank() || !idle()}>
                <div class="external-examples">
                  <For each={examples}>
                    {(text) => (
                      <button type="button" onClick={() => copy(text)} title="复制这句话">
                        <span>“{text}”</span>
                        <em>{copied() === text ? "已复制" : "复制"}</em>
                      </button>
                    )}
                  </For>
                </div>
                <div class="external-counts">
                  <For each={counts()}>
                    {(item) => (
                      <span>
                        <Icon name={item.icon} />
                        <strong>{item.value}</strong>
                        {item.label}
                      </span>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={!props.connected}>
                <Button primary onClick={props.onSettings}>
                  {props.external ? "把外面的 AI 接上" : WORDS.connect}
                  <Icon name="arrow" />
                </Button>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={props.onRun}>
          <form class="mf-compose mc-window" onSubmit={(event) => void submit(event)}>
            <label for="mf-compose-input">说一句想做什么</label>
            <textarea
              id="mf-compose-input"
              class="pa-input"
              aria-label="说一句想做什么"
              rows="2"
              maxlength="20000"
              value={prompt()}
              disabled={props.disabled || sending()}
              placeholder="例如：做一套月下森林的东西：一只月鹿、一种会发光的方块，再加一张能合成的配方。"
              onInput={(event) => {
                setPrompt(event.currentTarget.value)
                setSent(false)
                props.onDirty?.(!!event.currentTarget.value.trim())
              }}
            />
            <div class="mf-compose-foot">
              <VoiceInput
                disabled={props.disabled || sending()}
                onText={(text) => {
                  setPrompt(`${prompt().trim()}${prompt().trim() ? "\n" : ""}${text}`)
                  props.onDirty?.(true)
                }}
              />
              <span class="pa-hint" role="status">
                {!props.connected ? `${WORDS.connect} 后才能开始做。` : running() ? "正在做上一句，做完再说下一句。" : sent() ? "交出去了，做的每一步会出现在右边。" : "可以一句话说好几样东西。"}
              </span>
              <Button primary type="submit" disabled={!canRun()}>
                {sending() ? "正在规划…" : WORDS.tell}
              </Button>
            </div>
          </form>
        </Show>
      </div>
      <div class="mf-feed">
        <h3>
          动态<small>点一条，去看那样东西和那一轮</small>
        </h3>
        <FollowScroll label="所有东西的动态" stamp={`${last()}:${advanced()}`}>
          <Show when={feed().length} fallback={<p class="pa-hint mf-none">{meta().read ? summary().line : "正在读这个模组的动态…"}</p>}>
            <Show when={hidden() > 0}>
              <button type="button" class="pa-link mf-earlier" onClick={() => setMore(more() + 2)}>
                前面还有 {hidden()} 条，点开看
              </button>
            </Show>
            <ol class="mf-nodes">
              <For each={feed()}>
                {(event) => (
                  <EventNode
                    event={event}
                    advanced={advanced()}
                    thing={event.item === null ? null : (byId().get(event.item)?.title ?? event.title ?? "一样东西")}
                    onVisit={() => select(event.item ?? wholeId(event.kind === "task" || event.kind === "look" || event.kind === "review" ? "batch" : event.kind), event.round, event.at)}
                    full={event.item === null || recordRound(event, makings.of[event.item])?.making !== "current" ? undefined : makings.of[event.item]?.rounds.find((value) => value.round === event.round)?.pictures[0]?.url}
                    visitTitle={event.item === null ? "点一下，看这一类的全部记录" : event.round ? "点一下，去看这样东西的这一轮" : "点一下，去看这样东西"}
                    onZoom={setZoom}
                  />
                )}
              </For>
            </ol>
          </Show>
        </FollowScroll>
      </div>
    </section>
  )

  return (
    <section class="external-workbench mf-floor" classList={{ advanced: advanced() }} aria-label={WORDS.floor}>
      <header class="external-heading mf-head">
        <div class="external-title">
          <span class="external-connection" data-connected={props.connected} role="status">
            <i />
            {props.external ? (!props.enabled ? "外面的 AI 还没开始接" : props.connected ? CHIP_WORDS.outside_on : CHIP_WORDS.outside_off) : props.connected ? CHIP_WORDS.own_on : CHIP_WORDS.own_off}
          </span>
          <h1>
            制作现场<small role="status">{standing() || (meta().read ? summary().line : props.view.project.name)}</small>
          </h1>
        </div>
        <div class="external-controls">
          <Show when={chosen() !== null && current()}>
            <button type="button" class="ac-jump mf-follow-now" onClick={() => (setRound(null), setChosen(null))}>
              回到最新：跟着正在做的
            </button>
          </Show>
          <Show when={build()}>
            {(job) => (
              <span class="external-build" data-state={job().project_revision !== props.view.project.revision ? "stale" : job().state} role="status" aria-label={`${WORDS.pack}进度`} title={job().error ? buildFailureWords(job().error!) : undefined}>
                <Icon name="tool" />
                {buildText(job())}
              </span>
            )}
          </Show>
          <Show when={runBusy()}>
            <Button onClick={() => void cancel()}>停止</Button>
          </Show>
          <button type="button" class="external-icon-button" aria-label="连接 AI" title="连接 AI" onClick={props.onSettings}>
            <Icon name="settings" />
          </button>
        </div>
      </header>
      {/* A finished version waits for a reviewing window: said here too, where the person watches the outside AI work. */}
      <Show when={state.overview?.review_wait}>
        {(wait) => (
          <ReviewWaitNotice
            projectId={projectId()}
            wait={wait()}
            onChanged={() => void window.studio.getProjectOverview({ projectId: projectId() }).then((next) => setState("overview", reconcile(next, { key: "id" })), () => undefined)}
          />
        )}
      </Show>
      <WaitingForYou
        waits={waits()}
        pending={confirming()}
        error={waitError()}
        hint={!props.external && !props.connected ? WAITING_WORDS.needsAi : beforeConfirmWords(props.external, state.overview?.blueprint_wait?.ai)}
        onDo={() => void confirmHere()}
        onGo={goWaiting}
      />
      <Show when={error()}>
        <p class="error-bar" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={!blank() && !state.overview?.review_wait && reviewer()}>{(line) => <ReviewerLine projectId={projectId()} line={line()} />}</Show>
      <Show when={summary().stalled}>
        <p class="ac-stalled mf-stalled action-notice" role="alert">
          <Mark state="warn" />
          <span>{summary().stalled}</span>
        </p>
      </Show>
      <div class="mf-body">
        <aside class="mf-list mc-window" aria-label="这个模组做过的每一样">
          <label class="mf-search">
            <Icon name="search" />
            <input type="search" aria-label="搜做过的东西" placeholder="搜名字、说过的话、检查的结论" value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
          </label>
          <div class="mf-filters">
            <select aria-label="只看哪种状态" value={onlyState()} onChange={(event) => setOnlyState(event.currentTarget.value as FloorState | "")}>
              <option value="">全部状态</option>
              <For each={FLOOR_STATES.filter((value) => listed().some((entry) => entry.state === value.id))}>
                {(value) => (
                  <option value={value.id}>
                    {value.label}（{listed().filter((entry) => entry.state === value.id).length}）
                  </option>
                )}
              </For>
            </select>
            <select aria-label="只看哪一种东西" value={onlyKind()} onChange={(event) => setOnlyKind(event.currentTarget.value)}>
              <option value="">全部种类</option>
              <For each={usedKinds()}>{(kind) => <option value={kind.id}>{kind.label}</option>}</For>
            </select>
          </div>
          <button type="button" class="mf-row mf-row-live" aria-pressed={shownId() === "live" && !showLive()} onClick={() => select("live")}>
            <span class="mf-row-slot">
              <Mark state={summary().stalled ? "warn" : running() ? "run" : "idle"} live={running() && !summary().stalled} />
            </span>
            <span class="mf-row-words">
              <strong>全部</strong>
              <small class="mf-row-verdict">{running() ? "现在在做什么，和所有东西的最新进展" : "所有东西的最新进展"}</small>
            </span>
          </button>
          <div class="mf-rows">
            <For each={groupIds()} fallback={<p class="pa-hint mf-none">{listed().length ? "没有找到。换个词，或者把筛选改回「全部」。" : state.overview || meta().read ? "这个模组还没有做过东西。" : "正在读…"}</p>}>
              {(groupId) => {
                const group = () => groups().find((value) => value.id === groupId)
                const ids = createMemo(() => (group()?.rows ?? []).map((value) => value.id), [], { equals: sameList })
                return (
                  <section class="mf-group" data-state={groupId}>
                    <h3>
                      {group()?.label}
                      <small>{ids().length}</small>
                    </h3>
                    <For each={ids()}>{row}</For>
                  </section>
                )
              }}
            </For>
          </div>
        </aside>
        <div class="mf-main mc-window">
          <Show when={showLive()}>
            <MakingLive
              projectId={projectId()}
              project={props.view.project}
              subject={heldSubject()}
              assetId={heldSubject().assetId!}
              making={makings.of[heldSubject().id]}
              fallback={props.drafts[busyTask()?.asset_id === heldSubject().assetId ? (busyTask()?.id ?? "") : ""] ?? props.view.project.workspace.assets.find((value) => value.id === heldSubject().assetId)?.document ?? null}
              advanced={advanced()}
              presence={props.presence}
              onStory={() => setStoryOf(heldSubject().id)}
            />
          </Show>
          <Show when={!showLive()}>
          <Show when={shownRow()} fallback={liveView()}>
              <Show when={storyOf() === heldRow().item?.id && heldRow().item}>
                <button type="button" class="pa-link ml-back-live" onClick={() => setStoryOf(null)}>
                  回到制作现场的时间轴
                </button>
              </Show>
            <ThingStory
              projectId={projectId()}
              project={props.view.project}
              row={heldRow()}
              items={items()}
              making={makings.of[heldRow().id]}
              read={answered().includes(heldRow().id)}
              picture={pictureFor(heldRow())}
              glyph={glyphOf(heldRow())}
              advanced={advanced()}
              problems={(state.overview?.problems ?? []).filter((problem) => problem.item === heldRow().id)}
              round={round()}
              onRound={() => setRound(null)}
              extra={heldRow().id === wholeId("batch") ? runsRecord() : heldRow().id === wholeId("build") ? buildRecord() : undefined}
              draft={heldRow().item && draftOf(heldRow().item!) && !makings.of[heldRow().id] ? stage() : undefined}
              onSelect={select}
              onVerdict={() => openCard(heldRow().item?.id)}
              onOpen={savedAsset(heldRow().item ?? undefined) ? () => props.onAsset(savedAsset(heldRow().item!)!) : undefined}
              onZoom={setZoom}
              onHold={() => chosen() === null && setChosen(shownId())}
            />
          </Show>
          </Show>
        </div>
      </div>
      <FloorZoom shown={zoom()} onClose={() => setZoom(null)} />
    </section>
  )
}

/** The name the page had when only an outside AI used it. */
export const ExternalWorkbench = MakingFloor

import { AudioEditor } from "./audio-editor"
import { BuildHistory } from "./build-history"
import { supersededSound } from "./sound-placeholder"
import { buildFailureWords } from "./build-failure-words"
import { kindLabel, namedOverviewItems, thingName, WORDS } from "../words"
/// <reference types="vite/client" />
import { ThingMenu } from "./thing-menu"
import { ParticleColours } from "./particle-colors"
import { SteadySetting } from "./steady-setting"
import { earnAdvancement } from "./advancement"
import { flyOrbs, placeOfAction } from "../little-things"
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, type JSX } from "solid-js"
import { makingLock, LOCK_THEN } from "./making-lock"
import { MakingHistory, VersionsTeaser, type HistoryBar } from "./making-history"
import { historyReach } from "./making-history-model"
import { createStore, reconcile, unwrap } from "solid-js/store"
import type { Blueprint, BlueprintDraft } from "@minemods/mod-core/blueprint"
import type { Project } from "@minemods/mod-core/project"
import type { Item } from "@minemods/mod-core/content"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import { Portal } from "solid-js/web"
import type { ActivityEvent, IdeaChoice, Ideas, Making, OverviewItem, OverviewStatus, PartSheet, ProjectOverview } from "../../api"
import { Button, Icon } from "../ui"
import { ask as confirmUnsaved, UNSAVED } from "../confirm-dialog"
import { advanced } from "../advanced"
import { draftPicture, named, pictureOf, type Draft, type Picture } from "./asset-picture"
import { AssetStage, TilePicture } from "./asset-preview"
import { describeAsset, type Words, redoAfterWalk, redoPromise, redoSentence, redoStanding, remarkIdeas, retryWords, ruleCaption } from "./asset-words"
import { NO_AI_WORDS } from "./asset-edit-words"
import { assetCheck, type AssetCheck } from "./asset-check"
import { checkVersusReview } from "./asset-check-versus"
import { LOOKED_KINDS, UNSATISFIED, sheetReasons } from "@minemods/studio-ai/making"
import { MotionPlay } from "./motion-play"
import { INTERRUPTED, makingBadge, makingLive, makingPicture, MakingStory, MakingTeaser, ReferenceTray, roundNow } from "./asset-making"
import { inHandShare, makingNow, makingSentence, ORDER_WORDS } from "./production-words"
import { KEPT_WORDS, keptEach } from "@minemods/mod-core/kept-words"
import { doneLine, doneShare, heldHint, heldShare, heldWords, leftWords, makeCount, queueLine, queueWords, WALK_WORDS } from "./production-counts"
import { ReviewWaitNotice } from "./review-wait"
import { IdeaChooser, RefusedPlan, Requirements } from "./project-ideas"
import { PlayAnswers } from "./project-playable"
import { checkMark, type PlayQuestion } from "@minemods/mod-core/playable"
import { CREATURE_TIER_LEVELS, CREATURE_TIERS, DETAIL_WORDS, PERSON_TIER_REASON, tierAsksBrief, tierOf, type CreatureTierLevel } from "@minemods/mod-core/creature-tier"
import { ModGuide } from "./mod-guide"
import { followStored, STALE_EDIT } from "@minemods/mod-core/stale-edit"
import { StaleNotice } from "./stale-edit"
import type { FindingTarget } from "@minemods/mod-core/reconcile"
import { placeOf } from "../../finding-targets"
import { cachedOverview, overviewKey, readOverview, storeOverview } from "./overview-cache"
import { hasIdea, originalBrief, planCounts, playScope } from "../../project-status"
import { ActivityPanel } from "./project-activity"
import { recordRound, REPLACED_WORDS } from "./making-floor-model"
import { cardParts } from "./asset-card-parts"
import { notStarted, THREE_VIEW_WORDS, wantsThreeView } from "./three-view-model"
import { afterConfirmWords, beforeConfirmWords, confirmDraft, WAITING_WORDS } from "./waiting-for-you-model"
import { cardTarget, clearCardTarget, ideasCard } from "./making-floor-link"
import { ThreeViewBlock, ThreeViewMissing, threeViewsReady } from "./three-view"
import { creatorWords } from "@minemods/mod-core/creator-words"
import { BriefNote } from "./brief-note"
import { detailTag } from "./model-detail"
import { acceptOffered } from "./accept-offer"
import "./project-assets.css"
import { Fold } from "../fold"
import { checkCopy } from "./creator-card-copy"
import { ReceiptBook } from "./receipt"
import { askForPlan, handSentence, sentenceFor, writeSentence } from "../pending-sentence"

const entityDescriptions = new Map<string, Words>()

type Kind = ProjectOverview["kinds"][number]
type Glyph = Parameters<typeof Icon>[0]["name"]
type Entry = Blueprint["entries"][number]
type Ask = { title: string; lines: string[]; names: string[]; actions: { label: string; primary?: boolean; run: () => void }[] }
type StageId = "idea" | "plan" | "make" | "review" | "build" | "play"
type Stage = { id: StageId; label: string; state: "done" | "now" | "todo" | "skip"; count: string; off: boolean; mark: string[] }
type Problem = ProjectOverview["problems"][number]
/** One walk through the things waiting for a verdict: the list as it was when the walk began, and what was said. */
type Flow = { ids: string[]; verdicts: Record<string, "accepted" | "rejected"> }

// Survives leaving the page and coming back: a plan being drafted keeps going in the main process.
const drafting = new Map<string, { jobId: string; request: string; kind: "plan" | "ideas" }>()
const handed = new Set<string>()
const remembered = { mode: "content" as "content" | "section" | "guide" }

// The API takes at most this many characters of what the person says about one thing.
const REMARK = 500
const PAGE = 120
const examples = [
  "符咒师：能画符咒、有怨灵出没，打败怨灵掉灵屑，用灵屑打一把镇灵刀",
  "一片只在夜里发光的森林，有长着水晶鹿角的鹿",
  "会偷东西的小狐狸，被抓到会吐出一个幸运方块",
]

// Each status has its own shape, so the mark still reads without colour.
const marks: Record<OverviewStatus, string[]> = {
  planned: ["0000000", "0000000", "0000000", "1101011", "1101011", "0000000", "0000000"],
  making: ["1111111", "0100010", "0011100", "0001000", "0011100", "0111110", "1111111"],
  review: ["0000000", "0111110", "1100011", "1011101", "1100011", "0111110", "0000000"],
  redo: ["0011100", "0100010", "1000001", "1000111", "1000010", "0100000", "0011110"],
  saved: ["0000000", "0000001", "0000011", "1000110", "1101100", "0111000", "0010000"],
  built: ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"],
  verified: ["0001000", "0001000", "1111111", "0111110", "0011100", "0110110", "1100011"],
  failed: ["1100011", "1110111", "0111110", "0011100", "0111110", "1110111", "1100011"],
  blocked: ["0011100", "0100010", "0100010", "1111111", "1110111", "1110111", "1111111"],
  out_of_scope: ["0111110", "1100011", "1000111", "1001101", "1011001", "1110011", "0111110"],
}

// One small picture per stage of the road from a sentence to the game.
const stageMarks: Record<StageId, string[]> = {
  idea: ["0111110", "1000001", "1011101", "1000001", "0111110", "0001100", "0001000"],
  plan: ["1111110", "1000011", "1011101", "1000001", "1011101", "1000001", "1111111"],
  make: ["0001110", "0011111", "0111110", "1111100", "0111000", "1110000", "1100000"],
  review: marks.review,
  build: ["0011100", "0111110", "1111111", "1101011", "1111111", "1100011", "1111111"],
  play: ["0100010", "1111111", "1011101", "1111111", "1110111", "1100011", "0100010"],
}
const pixels = (rows: string[]) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "1" ? [`M${x} ${y}h1v1h-1z`] : []))).join("")

const plain = (cause: unknown) =>
  cause instanceof Error
    ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    : "出了点问题，请再试一次。"

/** The small status mark: a pixel shape on a coloured tile, optionally followed by the status in words. */
// A version kept without a pass says why it was kept. Cut short is not a judgement of the work, so it never reads "AI 还不满意".
const kept = (item: OverviewItem) => (item.ai_interrupted ? { ...INTERRUPTED, card: `制作${INTERRUPTED.mark}` } : item.ai_unsatisfied ? { ...UNSATISFIED, card: UNSATISFIED.mark } : null)

export function StatusMark(props: { status: OverviewStatus; label: string; words?: boolean }) {
  return (
    <span class="pa-mark" data-status={props.status} classList={{ words: props.words }} title={props.label}>
      <svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
        <path fill="currentColor" d={pixels(marks[props.status])} />
      </svg>
      <Show when={props.words}>
        <em>{props.label}</em>
      </Show>
    </span>
  )
}

/**
 * One inventory slot: the thing's own picture once it exists, the status mark in the corner, the name
 * underneath. Not made yet is a dashed outline of its kind; being made keeps a strip moving along the bottom.
 */
export function AssetSlot(props: {
  item: OverviewItem
  kind?: Kind
  small?: boolean
  picture?: Picture | null
  /** A couple of words under the kind's mark, for things that have no picture of their own. */
  words?: string | null
  /** Something it uses was remade since it was saved, so it is worth another look. */
  stale?: boolean
  /** Which round of making it is on, while it is being made. */
  round?: string | null
  onOpen: (id: string) => void
  onHover?: (event: MouseEvent, item: OverviewItem) => void
  onLeave?: () => void
}) {
  return (
    <button
      type="button"
      class="pa-slot"
      classList={{ small: props.small, ghost: !props.item.facts.saved }}
      data-status={props.item.status}
      data-checked={props.item.facts.gametest === true ? "game" : undefined}
      data-kind={props.item.kind}
      data-item={props.item.id}
      aria-label={`${props.item.title}，${props.kind?.label ?? ""}，${props.item.status_label}${kept(props.item) ? `，${kept(props.item)!.mark}` : ""}${props.round ? `，${props.round}` : ""}${props.stale ? "，它用到的东西重做过" : ""}`}
      onClick={() => props.onOpen(props.item.id)}
      onMouseMove={(event) => props.onHover?.(event, props.item)}
      onMouseLeave={() => props.onLeave?.()}
    >
      <span class="pa-cell mc-slot">
        <TilePicture picture={props.picture ?? null} glyph={(props.kind?.glyph ?? "cube") as Glyph} words={props.small ? null : props.words} />
        <Show when={props.stale}>
          <i class="pa-stale-mark" aria-hidden="true" />
        </Show>
        <Show when={props.item.status === "making" && !props.item.queued}>
          <i class="pa-working" aria-hidden="true" />
        </Show>
        <Show when={props.round}>
          <em class="pa-round">{props.round}</em>
        </Show>
        <Show when={kept(props.item)}>
          {(words) => (
            <em class="pa-unsat" title={words().words}>
              {words().mark}
            </em>
          )}
        </Show>
        <StatusMark status={props.item.status} label={props.item.status_label} />
      </span>
      <span class="pa-name">{props.item.title}</span>
    </button>
  )
}

/** A window laid over the page, closed by its own button or by clicking the dark area around it. */
export function CardShell(props: {
  title: string
  manageFocus?: boolean
  /** Keeps the keyboard inside and gives it back on closing, leaving Escape to whoever owns the card. */
  trapFocus?: boolean
  wide?: boolean
  /** Shown in the title bar, after the title. */
  head?: JSX.Element
  onClose: () => void
  onBack?: () => void
  children: JSX.Element
}) {
  let dialog: HTMLDivElement | undefined
  onMount(() => {
    if (!props.manageFocus && !props.trapFocus) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && props.manageFocus) { event.preventDefault(); event.stopImmediatePropagation(); props.onClose(); return }
      if (event.key !== "Tab") return
      // Another dialog stands over this one and has the keyboard.
      if (props.trapFocus && document.querySelector(".pa-veil.top, .pa-ask, .modal-backdrop")) return
      const buttons = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"], canvas') ?? [])].filter((node) => node.getClientRects().length && node.tabIndex >= 0)
      const first = buttons[0], last = buttons.at(-1)
      const inside = dialog?.contains(document.activeElement)
      // A button that was pressed and went away leaves the focus on the page: Tab brings it back in, not on behind the card.
      if (!inside || (event.shiftKey ? document.activeElement === first || document.activeElement === dialog : document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus()
      }
    }
    window.addEventListener("keydown", key, true)
    // The slot that opened it may have been drawn anew while the card stood: the one that is the same thing takes the focus back.
    const sameThing = previous?.dataset.item ? `.${previous.classList[0]}[data-item="${CSS.escape(previous.dataset.item)}"]` : null
    onCleanup(() => {
      window.removeEventListener("keydown", key, true)
      ;(previous?.isConnected ? previous : sameThing ? document.querySelector<HTMLElement>(sameThing) : null)?.focus()
    })
  })
  return (
    <Portal mount={document.querySelector(".studio-root") ?? document.body}><div class="pa-veil" classList={{ top: props.manageFocus }} onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div ref={dialog} class="pa-card mc-window" classList={{ wide: props.wide }} role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1}>
        <header class="pa-card-head">
          <Show when={props.onBack}>
            <button type="button" class="pa-mini" onClick={() => props.onBack?.()}>
              返回
            </button>
          </Show>
          <strong>{props.title}</strong>
          {props.head}
          <button type="button" class="pa-mini pa-close" aria-label="关闭" onClick={() => props.onClose()}>
            <Icon name="close" />
          </button>
        </header>
        {props.children}
      </div>
    </div></Portal>
  )
}

/**
 * The project's main page: say one sentence, look through the plan the AI drew up, watch it being made,
 * and afterwards find everything the mod contains. All status wording comes from the overview as it is.
 */
export function ProjectAssets(props: {
  cardOnly?: boolean
  onDismiss?: () => void
  inspection?: { id: string; nonce: number } | null
  projectId: string
  projectName: string
  /** The project as the app holds it. Every picture and every plain-word fact is read from what is saved in it. */
  project: Project
  /** Changes whenever the project was saved, by this app or by an outside AI. */
  revision: number
  /** Goes up each time a job (a build, a check, the game) ends. What a job found is not always a new revision of the project. */
  ended?: number
  /** An AI app outside Studio does the work. */
  external: boolean
  /** An outside AI's connection as it stands. */
  presence?: string
  aiConfigured: boolean
  /** 个人设置: what the person asked to be called; empty or left out, nobody is addressed by name. */
  nickname?: string
  onSettings: () => void
  /** Where the outside AI's work can be watched and stopped. */
  onWatch: () => void
  /** The project was changed here (plan stored, things made), so the rest of the app should read it again. */
  onChanged: () => void
  /** Open the thing in its own editor, on the field named when there is one; absent when it has none. */
  editor: (item: OverviewItem, field?: string) => (() => void) | undefined
  /** A finding's button was pressed outside this panel (the build panel): open that field as soon as the overview has been read. `nonce` changes on every press. */
  jump?: { target: FindingTarget; nonce: number } | null
  /** The jump was carried out (or could not be): the app forgets it. */
  onJumped?: () => void
  /** The mod's information (name, author, version, licence, icon) in one short line, and the way to its page. */
  info?: { line: string; icon: string | null; open: () => void }
  /** Open the app's own build-and-play control. */
  onPack?: () => void
  onRevealJar?: () => void
  buildBusy?: boolean
  onBuild?: () => void
  /** What an outside AI has shown of the things it is making right now. */
  drafts?: Draft[]
  /** The 模型精细度 button at the top as it stands: a model made by another level says so on itself (`detailTag`). */
  modelComplexity?: "low" | "medium" | "high"
  onSaveItem?: (item: Item) => Promise<void>
  onAnnotateModel?: (prompt: string, input: ModelAnnotationInput) => Promise<unknown>
  onDirty?: (dirty: boolean) => void
}) {
  const [historyOpen, setHistoryOpen] = createSignal(false)
  const [failureDetails, setFailureDetails] = createSignal("")
  const [copiedFailure, setCopiedFailure] = createSignal("")
  const packButtons = () => <div class="button-row pack-actions">
    <Button disabled={props.buildBusy} onClick={props.onPack}>打包</Button>
    <Button disabled={props.buildBusy} onClick={props.onBuild}>构建并试玩</Button>
    <Button onClick={() => setHistoryOpen(true)}>打包记录</Button>
    <Show when={historyOpen()}><BuildHistory projectId={props.projectId} close={() => setHistoryOpen(false)} /></Show>
  </div>
  const id = { projectId: props.projectId }
  const [state, setState] = createStore<{ overview: ProjectOverview | null }>({ overview: null })
  const [blueprint, setBlueprint] = createSignal<Blueprint | null>(null)
  const [trouble, setTrouble] = createSignal("")
  const [slow, setSlow] = createSignal(false)
  const [error, setError] = createSignal("")
  const [pending, setPending] = createSignal("")
  const [previewDirty, setPreviewDirty] = createSignal(false)
  // A note being written on 「制作过程」 is work in hand like a mark on the finished view: it is not lost without asking.
  const [notesDirty, setNotesDirty] = createSignal(false)
  const anyDirty = () => previewDirty() || notesDirty()
  const previewChanged = (dirty: boolean) => { setPreviewDirty(dirty); props.onDirty?.(dirty || notesDirty()) }
  const notesChanged = (dirty: boolean) => { setNotesDirty(dirty); props.onDirty?.(dirty || previewDirty()) }
  const leavePreview = (next: () => void) => {
    if (!anyDirty()) return next()
    void confirmUnsaved({ ...UNSAVED, text: "当前有未保存的标注或持握修改，离开后这些修改就没有了。" }).then((yes) => {
      if (!yes) return
      setNotesDirty(false)
      previewChanged(false)
      next()
    })
  }
  onCleanup(() => props.onDirty?.(false))
  const [sentence, setSentence] = createSignal(sentenceFor(props.projectId))
  const [more, setMore] = createSignal("")
  const [hint, setHint] = createSignal("")
  // The sentence was handed in while no AI was connected: it is kept, and the page says what is missing.
  const [parked, setParked] = createSignal(false)
  const [job, setJob] = createSignal(drafting.get(props.projectId) ?? null)
  const [copied, setCopied] = createSignal(handed.has(props.projectId))
  const [told, setTold] = createSignal(false)
  const [mode, setMode] = createSignal<"content" | "section" | "guide">(remembered.mode === "guide" ? "guide" : "content")
  const [trail, setTrail] = createSignal<string[]>([])
  // What the guide's reconciliation came to, for the mark on its tab: null until it has been read.
  const [guideState, setGuideState] = createSignal<"ok" | "warn" | "stop" | null>(null)
  const [planOpen, setPlanOpen] = createSignal(false)
  const [stopping, setStopping] = createSignal(false)
  const [ask, setAsk] = createSignal<Ask | null>(null)
  const [listed, setListed] = createSignal(false)
  const [wide, setWide] = createSignal(false)
  const [visible, setVisible] = createSignal(PAGE)
  const [edit, setEdit] = createSignal({ title: "", brief: "" })
  // The plan revision and the words the card's form started from (see `stale-edit`): a save is made on that revision, never on the one stored now,
  // so an AI's newer plan is not overwritten by a form that still holds the older text.
  const [editBasis, setEditBasis] = createSignal<{ revision: number | null; title: string; brief: string } | null>(null)
  const [editMoved, setEditMoved] = createSignal(false)
  const [tip, setTip] = createSignal<{ x: number; y: number; item: OverviewItem }>()
  const [focus, setFocus] = createSignal<StageId | null>(null)
  // The remark box: "change" sends a saved thing back with words, "retry" is for something that was never made.
  const [remark, setRemark] = createSignal<"change" | "retry" | null>(null)
  const [feedback, setFeedback] = createSignal("")
  const [judged, setJudged] = createSignal("")
  const [flow, setFlow] = createSignal<Flow | null>(null)
  const [finished, setFinished] = createSignal<Flow | null>(null)
  // 「验收回执」: the book of what Studio checked, refused and verified.
  const [receiptOpen, setReceiptOpen] = createSignal(false)
  // How things were made, by item: only for what is being made right now and for the open card.
  const [makings, setMakings] = createStore<{ of: Record<string, Making | undefined> }>({ of: {} })
  const [page, setPage] = createSignal<"thing" | "story">("thing")
  const [sheetsSaved, setSheetsSaved] = createSignal(0)
  // Idea cards and the person's requirements, as stored; null for a project that never had any.
  const [ideas, setIdeas] = createSignal<Ideas | null>(null)
  // The person changed their requirements and Studio's own AI is comparing the plan with the new list; and a request to bring them to one requirement card.
  const [comparing, setComparing] = createSignal(false)
  const [toRequirement, setToRequirement] = createSignal<{ id: string | null; nonce: number } | null>(null)
  // How the activity panel stands beside the page, and the round of a making story a node asked to see.
  const [beside, setBeside] = createSignal({ open: false, beside: true })
  const [wanted, setWanted] = createSignal<{ round: number; at?: string } | null>(null)
  // An old record was opened whose version a redo has replaced: the card says so and stays on the thing itself.
  const [replaced, setReplaced] = createSignal(false)
  // What the activity panel has read of the log; a thing's story reads its own events from it.
  const [logged, setLogged] = createSignal<readonly ActivityEvent[]>([])

  const overview = () => state.overview
  const items = createMemo(() => namedOverviewItems(state.overview?.items ?? [], props.project.workspace.assets))
  // A finding's button brought the person to a field of one card: the card opens and the part that has the field focuses it.
  const [fieldRequest, setFieldRequest] = createSignal<{ itemId: string; field: string; nonce: number } | null>(null)
  let requests = 0
  const byId = createMemo(() => new Map(items().map((item) => [item.id, item])))
  const kinds = createMemo(() => new Map((state.overview?.kinds ?? []).map((kind) => [kind.id, { ...kind, label: kindLabel(kind.id, kind.label) }])))
  const kindOf = (item: OverviewItem) => kinds().get(item.kind)
  const made = createMemo(() => items().filter((item) => item.status !== "out_of_scope"))
  const skipped = createMemo(() => items().filter((item) => item.status === "out_of_scope" && !supersededSound(props.project, item)))
  const roots = createMemo(() => made().filter((item) => kindOf(item)?.owner))
  const parts = (root: OverviewItem) => made().filter((item) => item.owner === root.id)
  const loose = createMemo(() => made().filter((item) => !kindOf(item)?.owner && !roots().some((root) => root.id === item.owner)))
  const ofKind = (kind: string) => made().filter((item) => item.kind === kind)
  // Plain ids, so a refresh keeps the slots that are already on screen.
  const usedKinds = createMemo(() => (state.overview?.kinds ?? []).filter((kind) => ofKind(kind.id).length).map((kind) => kind.id))
  const groups = createMemo(() => [...new Set(usedKinds().map((kind) => kinds().get(kind)!.group.id))])
  const plan = () => state.overview?.blueprint ?? null
  const blueprintCounts = createMemo(() => {
    const rows = items()
    const saved = rows.filter((item) => item.facts.saved)
    return {
      ...planCounts(rows.filter((item) => item.key !== null)),
      saved: saved.length,
      outside: saved.filter((item) => item.key === null).length,
    }
  })
  const [play, setPlay] = createSignal<ProjectOverview["playable"]>()
  createEffect(on(() => [props.revision, props.cardOnly] as const, ([, cardOnly]) => {
    if (cardOnly) return
    let stopped = false
    let timer = 0
    const read = () => window.studio.getProjectPlay(id).then((value) => { if (!stopped) setPlay(value) },
      () => { if (!stopped) timer = window.setTimeout(read, 2500) })
    void read()
    onCleanup(() => { stopped = true; window.clearTimeout(timer) })
  }))
  const production = () => state.overview?.production
  const running = () => !!production()?.running
  // What is being made right now and where each stands, from the making records and the drafts: the strip's words and the part of its bar that is under way.
  const inHand = createMemo(() => makingNow({ items: made(), kinds: state.overview?.kinds ?? [], makings: makings.of, drafts: props.drafts ?? [], roundNow }))
  // Nothing is finished yet although things are being made: the strip leads with what is going on, not with 「0 / 4」.
  const noneYet = () => !!production() && production()!.done === 0 && production()!.saved - production()!.remaking === 0 && inHand().length > 0
  const reviewing = () => !!plan() && (plan()!.state === "draft" || planOpen())
  const left = () => (production() ? production()!.total - production()!.saved - production()!.failed - production()!.blocked : 0)
  const card = () => byId().get(trail().at(-1) ?? "")
  const entry = (key: string | null) => blueprint()?.entries.find((value) => value.key === key)
  const editable = () => reviewing() && !running() && !!entry(card()?.key ?? null)
  // Changed against what the form started from, not against what is stored now: when an AI changed the stored words, an untouched form is not an edit.
  const changed = () => !!card() && (edit().title.trim() !== (editBasis()?.title ?? card()!.title) || edit().brief.trim() !== (editBasis()?.brief ?? entry(card()!.key)?.brief ?? ""))
  // The order things appear in on the page, so "next" walks them the way the eye does.
  const ordered = createMemo(() => [...roots().flatMap((root) => [root, ...parts(root)]), ...loose()])
  const awaiting = createMemo(() => ordered().filter((item) => item.status === "review"))
  // Of those waiting, the ones kept without a pass: said beside the count wherever the count is, in the one set of words (`KEPT_WORDS.among`).
  const keptAwaiting = createMemo(() => awaiting().filter((item) => keptEach(item)).length)
  const callWords = () => (
    <span class="pa-call-words">
      <span>有 {awaiting().length} 样等你验收</span>
      <Show when={keptAwaiting()}>
        <small>{KEPT_WORDS.among(awaiting().length, keptAwaiting())}</small>
      </Show>
    </span>
  )
  const draftOf = (item: OverviewItem) =>
    item.status === "making"
      ? ((props.drafts ?? []).find((draft) => (item.asset_id ? draft.asset_id === item.asset_id : draft.kind === item.kind && draft.title === item.title)) ?? null)
      : null
  const makingOf = (item: OverviewItem) => makings.of[item.id]
  // What the making loop last looked at, while the thing is still in its hands or when it never got as far as being saved.
  const roundPicture = (item: OverviewItem) => (item.status === "making" || !item.facts.saved ? makingPicture(makingOf(item)) : null)
  // A thing being made for the first time has no picture, unless an outside AI has shown a draft of it
  // or a round of making has been looked at.
  const picture = (item: OverviewItem) => {
    const draft = item.preview.source ? null : draftOf(item)
    return draft ? draftPicture(draft) : (roundPicture(item) ?? pictureOf(props.projectId, props.project, items(), item))
  }
  // How many versions the open card's thing has saved, read when it has no making record: an imported or older thing (or a gameplay the naming
  // conversion saved anew) has its versions all the same. Kept by thing, not by revision, so a step back taken there does not close the page it was taken on.
  const [savedVersions, setSavedVersions] = createSignal<{ assetId: string; count: number } | null>(null)
  const versionsAsked = createMemo(() => {
    const item = card()
    return item?.asset_id && !makingOf(item) ? `${item.asset_id}:${item.revision}` : ""
  })
  createEffect(
    on(versionsAsked, (asked) => {
      if (!asked) return
      const assetId = asked.slice(0, asked.indexOf(":"))
      void window.studio.getMakingHistory({ projectId: props.projectId, assetId }).then(
        (view) => {
          if (versionsAsked() === asked) setSavedVersions({ assetId, count: view.versions.length })
        },
        () => undefined,
      )
    }),
  )
  const versionsOf = (item: OverviewItem) => {
    const saved = savedVersions()
    return saved && saved.assetId === item.asset_id ? saved.count : null
  }
  // Whether the card has 「制作过程」, and with what in it: see `historyReach`.
  const reach = (item: OverviewItem) => historyReach({ making: !!makingOf(item), assetId: item.asset_id, savedVersions: versionsOf(item) })
  const onStory = () => page() === "story" && !!card() && reach(card()!) !== null
  // The AI's making record, on 「制作过程」 only where there is one.
  const story = () => (onStory() ? makingOf(card()!) : undefined)
  // The story disposes the live viewport, so leaving a draft follows the same guard as closing its card.
  const [historyBar, setHistoryBar] = createSignal<HistoryBar | null>(null)
  const showStory = () => leavePreview(() => setPage("story"))
  const problemsOf = (itemId: string) => (state.overview?.problems ?? []).filter((problem) => problem.item === itemId)
  const staleIds = createMemo(() => new Set((state.overview?.problems ?? []).filter((problem) => problem.kind === "stale").map((problem) => problem.item)))
  // Only something that is saved as an asset can be judged: a verdict is about one saved version.
  const judgeable = (item: OverviewItem) => item.facts.saved && item.asset_id !== null && item.revision !== null && item.status !== "making"
  const ownAi = () => !props.external && props.aiConfigured
  const place = () => flow()?.ids.indexOf(trail()[0] ?? "") ?? -1
  const nameOf = (reference: string) => named(props.projectId, props.project, items(), reference).name
  const entityKey = createMemo(() => {
    const item = card()
    return item?.kind === "entity" && item.facts.saved ? JSON.stringify([props.projectId, props.revision, item.id, item.asset_id, item.preview.source]) : null
  })
  const [entityWords, setEntityWords] = createSignal<{ key: string; value: Words }>()
  createEffect(on(entityKey, (key) => {
    if (!key) return
    const known = entityDescriptions.get(key)
    if (known) return void setEntityWords({ key, value: known })
    const item = card()!
    const project = unwrap(props.project)
    const asset = project.workspace.assets.find((value) => value.id === item.asset_id)?.document
    const entity = asset?.kind === "entity" ? asset : project.entities.find((value) => value.id === item.id.slice(item.id.indexOf(":") + 1))
    const drop = entity?.runtime?.death_drop?.block_identifier
    const names = drop ? { [drop]: nameOf(drop) } : {}
    let stopped = false
    let worker: Worker | undefined
    const keep = (value: Words) => {
      if (stopped) return
      entityDescriptions.set(key, value)
      if (entityDescriptions.size > 8) entityDescriptions.delete(entityDescriptions.keys().next().value!)
      setEntityWords({ key, value })
      worker?.terminate()
    }
    const fallback = () => { if (!stopped) keep(describeAsset(project, item, nameOf)) }
    void import("./entity-words.worker?worker&inline").then(({ default: EntityWordsWorker }) => {
      if (stopped) return
      worker = new EntityWordsWorker()
      worker.onmessage = ({ data }: MessageEvent<Words>) => keep(data)
      worker.onerror = fallback
      worker.postMessage({ project, item: { id: item.id, asset_id: item.asset_id, kind: item.kind, preview: { source: item.preview.source } }, names })
    }).catch(fallback)
    onCleanup(() => { stopped = true; worker?.terminate() })
  }))
  const person = createMemo(() => creatorWords(props.project, card()?.preview.model_asset_id, card() ? makingOf(card()!)?.sheet?.parts : undefined))
  const words = createMemo(() => {
    const item = card()
    if (!item) return null
    const key = entityKey()
    if (key) return entityWords()?.key === key ? entityWords()!.value : null
    return describeAsset(props.project, item, nameOf, advanced())
  })
  // Judged with the reasons its maker gave in the part sheet, the list the gate accepted the work on.
  const checkKey = createMemo(() => {
    const item = card()
    return item ? `${item.id}:${item.revision}:${item.status === "making"}` : ""
  })
  const [checked, setChecked] = createSignal("")
  const checkPending = () => !!checkKey() && checked() !== checkKey()
  const check = createMemo(() => {
    const item = card()
    return item && !checkPending() ? assetCheck(props.project, items(), item, draftOf(item), sheetReasons(makingOf(item)?.sheet)) : null
  })
  const versus = createMemo(() => (card() ? checkVersusReview(check(), makingOf(card()!)) : null))
  const inFocus = (stage: StageId, item: OverviewItem) => {
    if (stage === "make") return !item.facts.saved || item.status === "making"
    if (stage === "review") return item.status === "review" || item.status === "redo"
    if (stage === "build") return item.facts.saved && !item.facts.built
    if (stage === "play") return item.facts.client !== true
    return true
  }
  const focused = createMemo(() => (focus() ? ordered().filter((item) => inFocus(focus()!, item)) : []))
  // Every stage says only what is recorded: counts come from the overview, never from a guess.
  const stages = createMemo((): Stage[] => {
    const now = production()
    const total = now?.total ?? 0
    const judgedOnes = made().filter((item) => item.review_asked || item.facts.accepted !== null).length
    const seen = made().filter((item) => item.facts.client === true).length
    const waits = !total || plan()?.state === "draft"
    const list = [
      { id: "idea" as const, label: "说想法", done: hasIdea(plan()?.request ?? ideas()?.request), skip: !hasIdea(plan()?.request ?? ideas()?.request) && total > 0, count: "", off: false },
      { id: "plan" as const, label: "看蓝图", done: plan()?.state === "confirmed", skip: !plan() && total > 0, count: plan()?.state === "draft" ? "等你确认" : "", off: !plan() },
      // A saved thing that is being made again, or kept without passing its review, is not done: counting it would show 「9 / 9」 while three are being remade (`production.done`).
      { id: "make" as const, label: "制作", done: total > 0 && now!.done === total, skip: false, count: total && plan()?.state !== "draft" ? (noneYet() ? `正在做 ${inHand().length} 样` : makeCount(now!)) : "", off: waits },
      {
        id: "review" as const,
        label: "验收",
        done: judgedOnes > 0 && now!.accepted === judgedOnes && now!.saved === total,
        skip: total > 0 && !plan() && !judgedOnes,
        // broad2: "通过 0 / 6" read as "none passed". It counts the person's own check-offs, so it says what is left for them.
        count: now?.to_review ? `${now.to_review} 样等你看` : now?.to_redo ? `${now.to_redo} 样要重做` : judgedOnes ? (now!.accepted >= judgedOnes ? "都验收了" : `还有 ${judgedOnes - now!.accepted} 样你没验收`) : "",
        off: waits || !judgedOnes,
      },
      { id: "build" as const, label: "做进模组", done: total > 0 && now!.built === total, skip: false, count: now?.saved ? `${now.built} / ${total}` : "", off: waits || !now?.saved },
      { id: "play" as const, label: "进游戏看", done: total > 0 && seen === total, skip: false, count: now?.saved ? (seen ? `看过 ${seen} / ${total}` : "还没看过") : "", off: waits || !now?.saved },
    ]
    const current = list.find((stage) => !stage.done && !stage.skip)?.id
    return list.map((stage) => ({
      id: stage.id,
      label: stage.label,
      count: stage.count,
      off: stage.off,
      mark: stageMarks[stage.id],
      state: stage.skip ? "skip" : stage.done ? "done" : stage.id === current ? "now" : "todo",
    }))
  })

  // Cards are on the table: the person is choosing, or has said go and the plan has not been drawn yet.
  const [ideasOpened, setIdeasOpened] = createSignal(false)
  const pendingIdeas = () => ideas()?.by === "outside" && ideas()?.state === "choosing" && !job() ? ideas() : null
  const choosing = () =>
    ideas()?.groups.length && ideas()?.state !== "used" && !job() && (!pendingIdeas() || ideasOpened()) ? ideas() : null
  createEffect(() => {
    if (ideas()?.state === "ready" || ideas()?.state === "used") setIdeasOpened(false)
  })
  let overviewHeading!: HTMLHeadingElement
  const openIdeas = () => {
    setIdeasOpened(true)
    overviewHeading?.focus()
  }
  // The requirements of a sentence that went straight to a plan, shown where the sentence is typed.
  const required = () => (!pendingIdeas() && !choosing() && ideas()?.constraints.length && !plan() ? ideas() : null)
  let ideasRead = 0
  const readIdeas = () => {
    const read = ++ideasRead
    return window.studio.getIdeas(id).then((next) => {
      if (read === ideasRead) setIdeas(next ?? null)
    }).catch(() => undefined)
  }
  const apply = (next: ProjectOverview) => {
    storeOverview(overviewKey(props.projectId, props.revision), next)
  }
  createEffect(() => {
    const next = cachedOverview(overviewKey(props.projectId, props.revision))
    if (!next) return
    setState("overview", reconcile(next, { key: "id" }))
    setTrouble("")
    setSlow(false)
  })
  const load = (refresh = true) => {
    // An outside AI can put cards on the table at any moment; while things are being made nobody is choosing.
    if (!running() && !props.cardOnly) void readIdeas()
    return readOverview(id.projectId, props.revision, refresh)
      .catch((cause: unknown) => {
        // A refresh that fails while something is already on screen is retried by the next poll.
        if (!state.overview) setTrouble(plain(cause))
      })
  }
  const reload = () => {
    setTrouble("")
    setSlow(false)
    window.setTimeout(() => !state.overview && !trouble() && setSlow(true), 8000)
    void load(false)
  }
  const act = (name: string, operation: () => Promise<unknown>) => {
    if (pending()) return
    setPending(name)
    setError("")
    void operation()
      .catch((cause: unknown) => {
        // A save refused because the stored content moved on is said once, by the form's own notice with its 「载入新的」, not again as an error bar.
        const said = plain(cause)
        if (said === STALE_EDIT.says) setEditMoved(true)
        else setError(said)
        return load()
      })
      .finally(() => setPending(""))
  }

  // A memo, so reading the project again without anything having changed does not load twice.
  createEffect(on(createMemo(() => props.revision), reload))
  // A job's findings are kept beside the project, not in it: after the game was closed the last step still read 「还没看过」 until something else saved the project.
  createEffect(on(() => props.ended, () => void load(), { defer: true }))
  createEffect(
    on(
      () => plan()?.revision,
      (revision) => {
        if (!revision) return setBlueprint(null)
        void window.studio
          .getBlueprint(id)
          .then(setBlueprint)
          .catch(() => undefined)
      },
    ),
  )
  // Ideas are stored beside the project, so an outside handoff may leave its revision unchanged.
  createEffect(() => {
    const refreshOverview = !!trouble() || running()
    const delay = trouble() ? 2500 : running() ? 1500 : props.external && !props.cardOnly ? 2500 : 0
    if (!delay) return
    const poll = { stopped: false, timer: 0 }
    const tick = async () => {
      await (refreshOverview ? load() : readIdeas())
      if (!poll.stopped) poll.timer = window.setTimeout(() => void tick(), delay)
    }
    poll.timer = window.setTimeout(() => void tick(), delay)
    onCleanup(() => {
      poll.stopped = true
      window.clearTimeout(poll.timer)
    })
  })
  createEffect(() => {
    if (!running()) setStopping(false)
  })
  createEffect(() => {
    if (props.external || props.aiConfigured) setParked(false)
  })
  // The making of whatever is in hand and of the open card: read once, then again while any of it still moves.
  const watched = createMemo(() =>
    [
      ...new Set([
        ...made()
          .filter((item) => item.status === "making")
          .slice(0, 12)
          .map((item) => item.id),
        ...(card() ? [card()!.id] : []),
      ]),
    ].join("\n"),
  )
  createEffect(
    on([watched, checkKey], ([list, key]) => {
      const ids = list.split("\n").filter(Boolean)
      if (!ids.length) return
      const openIndex = ids.indexOf(card()?.id ?? "")
      const poll = { stopped: false, timer: 0 }
      const tick = async () => {
        // A read that fails keeps what is on screen; the next one tries again.
        const read = await Promise.all(ids.map(async (itemId, index) => {
          const value = await window.studio.getMaking({ ...id, itemId }).then((record) => ({ record }), () => null)
          if (!poll.stopped && value) batch(() => {
            // Merged in place, so a story on screen grows without being redrawn.
            setMakings("of", itemId, value.record ? reconcile(value.record, { key: "round" }) : undefined)
            if (index === openIndex) setChecked(key)
          })
          return value
        }))
        if (poll.stopped) return
        if (read.some((value) => !value || makingLive(value.record)) || ids.some((itemId) => byId().get(itemId)?.status === "making")) poll.timer = window.setTimeout(() => void tick(), 2000)
      }
      void tick()
      onCleanup(() => {
        poll.stopped = true
        window.clearTimeout(poll.timer)
      })
    }),
  )
  // Each thing that gets made or remade changes the project, and the pictures here are drawn from what the app holds of it.
  createEffect(
    on(
      () => items().map((item) => `${item.asset_id}:${item.revision}`).join(),
      () => props.onChanged(),
      { defer: true },
    ),
  )
  // A filter with nothing left to show would be an empty page with no way to tell why.
  createEffect(() => {
    if (focus() && stages().find((stage) => stage.id === focus())?.off) setFocus(null)
  })
  createEffect(() => {
    if (!judged()) return
    const timer = window.setTimeout(() => setJudged(""), 2600)
    onCleanup(() => window.clearTimeout(timer))
  })
  createEffect(() => {
    if (!plan()) return
    handed.delete(props.projectId)
    setCopied(false)
  })
  createEffect(() => {
    const current = job()
    if (!current) return
    const poll = { stopped: false, timer: 0, misses: 0 }
    const end = (message = "") => {
      drafting.delete(props.projectId)
      setJob(null)
      setError(message)
    }
    const tick = async () => {
      const next = await window.studio.getJob({ ...id, jobId: current.jobId }).catch(() => null)
      if (poll.stopped) return
      poll.misses = next ? 0 : poll.misses + 1
      if (poll.misses > 5) return end("看不到 AI 的进度了，请再试一次。")
      if (next?.state === "completed") {
        await load()
        props.onChanged()
        return end()
      }
      // A plan refused over one of the person's requirements leaves them on record: read, so they show beside the message.
      if (next?.state === "failed") return void readIdeas().then(() => end(next.error ?? "AI 这次没有想出来，请再试一次。"))
      if (next?.state === "canceled") return end()
      if (next?.state === "interrupted") return end("刚才被打断了，请再试一次。")
      poll.timer = window.setTimeout(() => void tick(), 900)
    }
    void tick()
    onCleanup(() => {
      poll.stopped = true
      window.clearTimeout(poll.timer)
    })
  })
  createEffect(() => {
    if (!card() && !ask() && !finished()) return
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      // An input method takes Escape for its own: it cancels the word being composed, not the card.
      if (event.isComposing) return
      if (event.key === "Escape") {
        event.preventDefault()
        if (ask()) return setAsk(null)
        if (finished()) return setFinished(null)
        if (remark()) return setRemark(null)
        return close()
      }
      if (ask() || finished() || remark() || pending() || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
      // Arrows in a text box move the caret, and Enter on a button presses that button: neither is a verdict.
      if (target?.closest("input, textarea, select, [contenteditable]")) return
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault()
        return step(event.key === "ArrowRight" ? 1 : -1)
      }
      if (event.key !== "Enter" || target?.closest("button, a")) return
      const item = card()
      if (!item || item.status !== "review" || !judgeable(item) || reviewing()) return
      // Notes not handed over yet say something is still to be changed: Enter does not pass over them.
      if (onStory() && historyBar()?.hand) return
      event.preventDefault()
      accept(item)
    }
    window.addEventListener("keydown", key)
    onCleanup(() => window.removeEventListener("keydown", key))
  })
  // Put the words stored now into the card's form, and start it from them.
  const loadEdit = () => {
    const stored = entry(card()?.key ?? null)
    const words = { title: stored?.title ?? card()!.title, brief: stored?.brief ?? card()!.brief ?? "" }
    setEdit(words)
    setEditBasis({ revision: blueprint()?.revision ?? null, ...words })
    setEditMoved(false)
  }
  // The plan was stored again while the card is open. A form the person has not touched shows the new words; one they have keeps theirs and says
  // so (「载入新的」); and a plan that left this very entry as it was changes nothing for the form.
  createEffect(
    on(
      () => blueprint()?.revision,
      (revision) => {
        const basis = editBasis()
        const stored = entry(card()?.key ?? null)
        if (!basis || basis.revision === null || revision === undefined || !stored || !editable()) return
        const words = (value: { title: string; brief: string }) => JSON.stringify([value.title.trim(), value.brief.trim()])
        const mine = edit()
        // Whatever the form holds already is what is stored (the person's own save just came back): nothing to lose.
        const verdict = words(mine) === words(stored) ? "rebase" : followStored({ revision: basis.revision, value: words(basis) }, { revision, value: words(stored) }, words(mine) !== words(basis), (left, right) => left === right)
        if (verdict === "follow") return loadEdit()
        if (verdict === "rebase") {
          setEditBasis({ revision, title: stored.title, brief: stored.brief })
          setEditMoved(false)
        }
        if (verdict === "moved") setEditMoved(true)
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      () => trail().at(-1),
      () => {
        setTip(undefined)
        setError("")
        setRemark(null)
        setFeedback("")
        setReplaced(false)
        setPage("thing")
        if (card()) loadEdit()
        // The card itself takes the focus, so the keys work at once and Enter is not spent on a button.
        queueMicrotask(() => document.querySelector<HTMLElement>(".pa-veil:not(.top) > .pa-card")?.focus())
      },
    ),
  )
  // Asked for by a node of the activity panel: once that thing's making is read, show its story at that round.
  createEffect(() => {
    const asked = wanted()
    if (asked === null || !card() || !makingOf(card()!)) return
    setWanted(null)
    const making = makingOf(card()!)!
    const target = asked.at ? recordRound({ at: asked.at, round: asked.round }, making) : ({ making: "current", round: asked.round } as const)
    // A round's number alone would open the same-numbered version of the new making, with other pictures than the record spoke of.
    if (target?.making !== "current") return setReplaced(target?.making === "replaced")
    setReplaced(false)
    setPage("story")
    // The story has one stop per round, in order. It is another feature's component, so the stop is pressed, not set.
    const place = making.rounds.findIndex((round) => round.round === target.round)
    queueMicrotask(() => document.querySelectorAll<HTMLButtonElement>(".pa-card .mk-film button.mk-stop:not(.end)")[place]?.click())
  })
  // A thing that is gone (the plan changed under the card) closes its card instead of leaving an empty one.
  createEffect(() => {
    if (trail().length && !card()) setTrail([])
  })

  // The request goes first so the person sees their own words at the top of what they paste; the
  // hand-off below it tells an AI that has never seen this project how to work with Studio.
  const hand = (text: string) => window.studio.copyMcpHandoff({ ...id, request: text })
  // "ideas": cards first, for the person to choose from. "plan": straight to a plan, as before.
  const submit = (text: string, kind: "plan" | "ideas" = "plan") => {
    const request = text.trim()
    if (!request) return setHint("先写一句话，比如想要什么生物、什么道具。")
    setHint("")
    if (props.external)
      return act("draft", async () => {
        await hand(askForPlan(props.projectName, request, kind))
        if (request === sentence().trim()) handSentence(props.projectId)
        handed.add(props.projectId)
        setCopied(true)
        setMore("")
      })
    // Round 18: without a connected AI the button was dead and the way on led off the page. The sentence can be
    // handed in all the same: it stays where it is (`pending-sentence.ts`), and the page says in place what is still needed.
    if (!props.aiConfigured) return setParked(request === sentence().trim())
    act("draft", async () => {
      const started = { ...(await (kind === "ideas" ? window.studio.expandIdeas({ ...id, request }) : window.studio.draftBlueprint({ ...id, request }))), request, kind }
      drafting.set(props.projectId, started)
      if (request === sentence().trim()) handSentence(props.projectId)
      setJob(started)
      setMore("")
    })
  }
  // The person's own part of the idea cards. Null when the app refused; the reason is on screen.
  const chooseIdea = (change: Omit<IdeaChoice, "revision">) => {
    setError("")
    // Words about the requirements alone, with a plan standing: the plan is held to the new list, and with Studio's own AI it is compared again, which takes a moment.
    const onPlan = !!plan() && change.picks === undefined && !change.answers && change.summary === undefined && !change.ready
    if (onPlan && ownAi()) setComparing(true)
    // A person's plan from before requirements were kept has no record yet: Studio makes an empty one, which is revision 1.
    return window.studio.chooseIdeas({ ...id, revision: ideas()?.revision ?? 1, ...change }).then(
      (next) => {
        setIdeas(next)
        // The refusal and the plan's own copy of the list follow the change.
        void load()
        if (onPlan) void window.studio.getBlueprint(id).then(setBlueprint).catch(() => undefined)
        return next
      },
      (cause: unknown) => {
        setError(plain(cause))
        void readIdeas()
        return null
      },
    ).finally(() => setComparing(false))
  }
  // "就按这个做": Studio's own AI draws the plan from the approved summary; an outside AI is told to come and read it.
  const goIdeas = (chosen: Ideas) => {
    if (props.external)
      return act("draft", async () => {
        await hand(`MineMods 工程「${props.projectName}」的想法我在 Studio 里选好了。请调用 get_ideas 读我选的做法（ideas.summary）和仍然锁定的要求（ideas.locked），照着出蓝图，用 propose_blueprint 提交草稿，然后停下来等我确认。`)
        handed.add(props.projectId)
        setCopied(true)
      })
    act("draft", async () => {
      const started = { ...(await window.studio.draftBlueprint({ ...id, request: chosen.summary ?? chosen.request, ideas: chosen.revision })), request: chosen.summary ?? chosen.request, kind: "plan" as const }
      drafting.set(props.projectId, started)
      setJob(started)
    })
  }
  const dropIdeas = () =>
    act("discard", async () => {
      remember(ideas()?.request ?? sentence())
      await window.studio.discardIdeas(id)
      await readIdeas()
    })
  // A node of the activity panel: its thing's card, at the round of the making story it is about.
  const visit = (itemId: string, round?: number, at?: string) => {
    if (previewDirty() && card()?.id === itemId && round === undefined) return
    if (anyDirty()) return leavePreview(() => visit(itemId, round, at))
    setFinished(null)
    if (trail().at(-1) !== itemId) {
      setFlow(null)
      setTrail([itemId])
    }
    setReplaced(false)
    setWanted(round === undefined ? null : { round, at })
  }
  const type = (event: KeyboardEvent, run: () => void) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
    event.preventDefault()
    run()
  }
  const remember = (text: string) => {
    writeSentence(props.projectId, text)
    setSentence(text)
    setHint("")
  }
  // 「先去加六视图」: the first model without one opens, at its story when it has one (that is where its block is then).
  const toThreeView = (item: OverviewItem) => {
    if (anyDirty()) return leavePreview(() => toThreeView(item))
    open(item.id)
    if (makingOf(item)) setPage("story")
  }
  // Before a plan's making starts (by Studio's AI or an outside one), the models it will start on without a three-view are named once.
  const plannedReady = () => threeViewsReady(props.projectId, items().filter(notStarted), toThreeView)
  // The same action 制作现场 offers beside its 「等你确认」 (see `confirmDraft`), so the two can never differ.
  const confirm = () =>
    act("confirm", async () => {
      const done = await confirmDraft({
        projectId: props.projectId,
        revision: plan()!.revision,
        external: props.external,
        ready: plannedReady,
        afterConfirm: () => {
          setPlanOpen(false)
          setTrail([])
          props.onChanged()
        },
        studio: window.studio,
      })
      if (!done.confirmed) return
      if (done.started) return apply(done.started)
      return load()
    })
  const start = () =>
    act("start", async () => {
      if (await plannedReady()) apply(await window.studio.startBlueprintProduction(id))
    })
  const stop = () =>
    act("stop", async () => {
      apply(await window.studio.stopBlueprintProduction(id))
      setStopping(true)
    })
  const discard = () =>
    setAsk({
      title: "重新想一个？",
      lines: ["这份蓝图会被丢掉，你可以重新说一句话。", ...(made().some((item) => item.facts.saved) ? ["已经做好的东西不会丢，还留在工程里。"] : [])],
      names: [],
      actions: [
        {
          label: "重新想一个",
          primary: true,
          run: () =>
            act("discard", async () => {
              remember(plan()?.request ?? sentence())
              await window.studio.discardBlueprint(id)
              setPlanOpen(false)
              setTrail([])
              props.onChanged()
              await load()
            }),
        },
      ],
    })
  const store = (entries: Entry[], basedOn?: number) =>
    act("save", async () => {
      const current = blueprint()!
      const draft: BlueprintDraft = {
        request: current.request,
        style: current.style,
        questions: current.questions,
        entries: entries.map((value) => ({
          key: value.key,
          kind: value.kind,
          title: value.title,
          brief: value.brief,
          owner: value.owner,
          needs: value.needs,
          out_of_scope: value.out_of_scope,
          ...(value.play ? { play: value.play } : {}),
          // creature tier (10-12): rebuilt here like the rest, or an edit of anything else would drop it.
          ...(value.tier ? { tier: value.tier } : {}),
        })),
      }
      setBlueprint(await window.studio.saveBlueprint({ ...id, revision: basedOn ?? current.revision, blueprint: draft }))
      props.onChanged()
      await load()
    })
  // 「故意不做」 and taking it back are the person's own edits of the plan: stored like any other, back to a draft.
  const settle = (key: string, question: PlayQuestion, declined: boolean) =>
    store(
      blueprint()!.entries.map((value) => {
        if (value.key !== key) return value
        const kept = { answers: (value.play?.answers ?? []).filter((answer) => !declined || answer.question !== question), declined: (value.play?.declined ?? []).filter((entry) => entry.question !== question) }
        return { ...value, play: declined ? { ...kept, declined: [...kept.declined, { question, reason: "你决定这一处不做", by: "you" as const, constraint: null }] } : kept }
      }),
    )
  // creature tier (10-12): the person's pick of 简单 / 标准 / 精细 / Boss for a creature, stored like any other edit of the plan. It only counts once the plan is confirmed.
  const chooseTier = (key: string, level: CreatureTierLevel) =>
    store(blueprint()!.entries.map((value) => (value.key === key && value.kind === "entity" ? { ...value, tier: { level, reason: PERSON_TIER_REASON, by: "you" as const } } : value)))
  // 「让 AI 补上」: the same planner, told where the plan on screen is still open. An outside AI is handed the sentence for it.
  const fill = () => {
    if (!props.external) return submit(plan()!.request)
    act("draft", async () => {
      await hand(`MineMods 工程「${props.projectName}」的蓝图里还有东西没有交代清楚怎么玩。请调用 get_blueprint 读 playable.gaps 和 playable.paper，把每一处补上（确实不该有的，写明故意不做和原因），用 propose_blueprint 重新提交草稿，然后停下来等我确认。`)
      handed.add(props.projectId)
      setCopied(true)
    })
  }
  const playShown = () => mode() !== "guide"
  const playPanel = () => (
    <Show when={playShown() && play()}>
      {(report) => (
        <section class="pp-panel" aria-label="能不能玩">
          <div class="pp-head">
            <h3 class="pa-heading">能不能玩</h3>
            <small>{playScope(made().length, report().things.length)} · {report().summary.replace(/^\d+ 样东西 · /, "")}</small>
          </div>
          <p>
            一个能玩的模组，每样东西都要答得上这几个问题：从哪来、干什么用、有什么反应、闲着时什么样。
            {reviewing() ? "带「AI 补的」的是你没说、AI 替你补上的；空着的可以让 AI 补上，或者你说故意不做。" : "做好的东西按实际的样子回答，还没做的按蓝图回答。这是按规则对出来的，好不好玩要你自己进游戏试。"}
          </p>
          <PlayAnswers
            report={report()}
            titleOf={id => thingName(props.project.workspace.assets.find(asset => asset.id === id))}
            display={line => person()(line, advanced())}
            busy={!!pending() || running()}
            advanced={advanced()}
            paper={blueprint()?.paper ?? null}
            {...(plan() && !running() && (props.external || props.aiConfigured) ? { fill: props.external ? "复制给我的 AI 补上" : "让 AI 补上", onFill: fill } : {})}
            {...(reviewing() && !running() && blueprint()
              ? {
                  onDecline: (thing: string, question: PlayQuestion) => entry(thing) && settle(thing, question, true),
                  onRestore: (thing: string, question: PlayQuestion) => entry(thing) && settle(thing, question, false),
                }
              : {})}
          />
        </section>
      )}
    </Show>
  )
  const saveEdit = () => {
    if (!edit().title.trim() || !edit().brief.trim()) return setError("名字和说明都要写一点。")
    // The button is off while the form is behind; the notice above it already says why.
    if (editMoved()) return
    store(
      blueprint()!.entries.map((value) =>
        value.key === card()!.key ? { ...value, title: edit().title.trim(), brief: edit().brief.trim() } : value,
      ),
      // The revision the form started from: the app refuses the save if an AI stored another plan since.
      editBasis()?.revision ?? undefined,
    )
  }
  // Everything that cannot stay once these entries are gone: whatever needs them, and whatever belongs to them.
  const doomed = (keys: string[]): string[] => {
    const next = blueprint()!
      .entries.filter((value) => !keys.includes(value.key))
      .filter((value) => keys.includes(value.owner ?? "") || value.needs.some((need) => keys.includes(need)))
      .map((value) => value.key)
    return next.length ? doomed([...keys, ...next]) : keys
  }
  const remove = (item: OverviewItem) => {
    const key = item.key!
    const others = doomed([key]).filter((value) => value !== key)
    const drop = (keys: string[]) => {
      setTrail([])
      store(
        blueprint()!
          .entries.filter((value) => !keys.includes(value.key))
          .map((value) => ({
            ...value,
            owner: keys.includes(value.owner ?? "") ? null : value.owner,
            needs: value.needs.filter((need) => !keys.includes(need)),
          })),
      )
    }
    setAsk({
      title: `不做「${item.title}」了？`,
      lines: [
        ...(others.length ? ["下面这些东西要用到它，或者是它身上的一部分。去掉它，它们也会一起去掉："] : ["去掉以后，这次就不会做它了。"]),
        ...(item.facts.saved ? ["已经做好的那一份不会丢，还留在工程里。"] : []),
      ],
      names: others.map((value) => entry(value)?.title ?? value),
      actions: [
        { label: others.length ? `一起去掉（共 ${others.length + 1} 样）` : "不做它了", primary: true, run: () => drop([key, ...others]) },
        ...(others.length ? [{ label: "只去掉这一样", run: () => drop([key]) }] : []),
      ],
    })
  }
  const close = () => {
    if (anyDirty()) return leavePreview(() => close())
    setTrail([])
    setFlow(null)
    props.onDismiss?.()
  }
  const open = (itemId: string) => {
    if (card()?.id === itemId) return
    if (anyDirty()) return leavePreview(() => open(itemId))
    if (card()) return setTrail((value) => [...value.filter((entry) => entry !== itemId), itemId])
    // Opening something that waits for a verdict starts a walk through everything that waits, from there.
    setFlow(byId().get(itemId)?.status === "review" ? { ids: awaiting().map((item) => item.id), verdicts: {} } : null)
    setFinished(null)
    setTrail([itemId])
  }
  let inspected = 0
  createEffect(on(() => [props.inspection, state.overview] as const, ([request, overview]) => {
    if (!request || request.nonce === inspected || !overview || !byId().has(request.id)) return
    inspected = request.nonce
    open(request.id)
  }))
  // The way from a finding to the field it names (see `finding-targets.ts`): the card with the field on it, or the thing's own form at that field, or why neither.
  const go = (target: FindingTarget) => {
    // Only a thing saved as an asset has a form to fill in; content from before assets existed opens a different editor, which has no such field.
    // The saved asset decides, not the plan's card for it: a saved thing the plan sets aside (「这次不做」) is filled in in its own editor like any other.
    const place = placeOf(target, items(), (item) => (item.asset_id && props.editor(item, target.field) ? (props.project.workspace.assets.find((asset) => asset.id === item.asset_id)?.module ?? null) : null))
    if (place.how === "none") return setError(place.why)
    setError("")
    if (place.how === "form") return props.editor(byId().get(place.itemId)!, place.field)?.()
    open(place.itemId)
    setFieldRequest({ itemId: place.itemId, field: place.field, nonce: ++requests })
  }
  // A press made in another panel waits here until there are cards to open.
  createEffect(
    on(
      () => [props.jump, state.overview] as const,
      ([request, overview]) => {
        if (!request || !overview) return
        go(request.target)
        props.onJumped?.()
      },
    ),
  )
  // A press made on 制作现场 (「去验收」 on a thing waiting for the verdict) waits here until there are cards to open, then opens that thing's card.
  createEffect(
    on(
      () => [cardTarget(), state.overview] as const,
      ([target, overview]) => {
        if (!target || !overview) return
        clearCardTarget()
        if (target === ideasCard) return openIdeas()
        if (byId().has(target)) open(target)
      },
    ),
  )
  const review = () => {
    const first = awaiting()[0]
    if (!first) return
    if (anyDirty()) return leavePreview(() => review())
    setTrail([])
    open(first.id)
  }
  // Next and previous walk the list being judged; outside such a walk, the things as they lie on the page.
  const step = (by: number) => {
    if (anyDirty()) return leavePreview(() => step(by))
    const walk = place() >= 0 ? flow() : null
    const list = walk?.ids ?? (focus() ? focused() : ordered()).map((item) => item.id)
    const at = list.indexOf(trail()[0] ?? "")
    if (at < 0) return
    if (walk && at + by >= list.length) {
      close()
      return setFinished(walk)
    }
    const next = list[at + by]
    if (next && byId().has(next)) setTrail([next])
  }
  // After a verdict: on to the next thing that still waits, and at the end say so instead of leaving a card open.
  const after = (item: OverviewItem, verdict: "accepted" | "rejected") => {
    const walk = flow()
    if (!walk || trail()[0] !== item.id || !walk.ids.includes(item.id)) return
    const next = { ids: walk.ids, verdicts: { ...walk.verdicts, [item.id]: verdict } }
    const rest = walk.ids.slice(place() + 1).find((value) => byId().get(value)?.status === "review")
    setFlow(next)
    if (rest) return setTrail([rest])
    close()
    setFinished(next)
  }
  const accept = (item: OverviewItem) => {
    const assetId = item.asset_id
    if (!assetId || !judgeable(item)) return
    if (anyDirty()) return setError("请先保存持握设置或提交标注，再验收这一样东西。")
    const from = placeOfAction()
    act("accept", async () => {
      // Bound to the version on screen: if it changed meanwhile the app refuses and says so.
      apply(await window.studio.reviewAsset({ ...id, assetId, revision: item.revision ?? undefined, verdict: "accepted" }))
      setJudged(`「${item.title}」通过了。`)
      // The bar stands only while things are being made; otherwise they go to the stop on the road they just came through.
      flyOrbs(from, document.querySelector(".pa-progress") ?? document.querySelector('.pa-stop[data-stage="review"]'))
      earnAdvancement(props.projectId, "accepted")
      after(item, "accepted")
    })
  }
  // Sends one thing back with the person's words. Runs inside whatever asked for it, so a saved sheet can lead straight into it.
  // False when the person went to add a three-view first: then nothing was sent.
  const returned = async (item: OverviewItem, note: string) => {
    if (!(await threeViewsReady(props.projectId, [item], toThreeView))) return false
    const assetId = item.asset_id
    const saved = !!assetId && judgeable(item)
    if (assetId && saved) apply(await window.studio.reviewAsset({ ...id, assetId, revision: item.revision ?? undefined, verdict: "rejected", note }))
    // Studio's own AI starts on it at once. An outside AI is handed whatever was rejected with its next
    // batch; a thing that was never made has no version to reject, so asking again is its only record.
    if (ownAi() || !saved) apply(await window.studio.redoAsset({ ...id, itemId: item.id, feedback: note }))
    setRemark(null)
    setFeedback("")
    setTold(false)
    setJudged(saved ? `「${item.title}」记下要改了。` : `「${item.title}」会再试一次。`)
    if (saved) after(item, "rejected")
    return true
  }
  const sendBack = (item: OverviewItem, words: string) => {
    if (previewDirty()) return setError("请先保存持握设置或提交标注，再填写其他返工意见。")
    const note = words.trim().slice(0, REMARK)
    if (judgeable(item) && !note) return setError("写一句哪里不满意就行，比如「颜色太亮了，想要暗一点」。")
    act("redo", () => returned(item, note))
  }
  // The person's own correction of the part sheet; with `redo`, the thing then goes back to be made from it.
  const saveSheet = (item: OverviewItem, sheet: PartSheet, redo: string | null) =>
    act(redo ? "redo" : "sheet", async () => {
      setMakings("of", item.id, reconcile(await window.studio.saveSheet({ ...id, itemId: item.id, sheet }), { key: "round" }))
      setSheetsSaved(sheetsSaved() + 1)
      if (redo && (await returned(item, redo.slice(0, REMARK)))) return
      setJudged("部件说明保存好了。")
    })
  // The same words again: starts a redo that is only recorded so far, or gives a failed one another try.
  const again = (item: OverviewItem) =>
    act("redo", async () => {
      if (!(await threeViewsReady(props.projectId, [item], toThreeView))) return
      apply(await window.studio.redoAsset({ ...id, itemId: item.id, feedback: retryWords(item, REMARK) }))
      setTold(false)
    })
  const takeBack = (item: OverviewItem) => {
    const assetId = item.asset_id
    if (!assetId) return
    act("clear", async () => {
      apply(await window.studio.clearAssetReview({ ...id, assetId }))
      setJudged(`「${item.title}」的意见撤回了，就当还没看过。`)
    })
  }
  const acceptShown = () => {
    const list = focused().filter((item) => item.status === "review" && judgeable(item))
    setAsk({
      title: `这 ${list.length} 样都通过？`,
      lines: ["确认以后，下面这些都会记成你验收通过了。以后想让哪一样改，再点开它就行。"],
      names: list.map((item) => item.title),
      actions: [
        {
          label: `都通过（${list.length} 样）`,
          primary: true,
          run: () =>
            act("accept", async () => {
              const results = await list.reduce(
                (done, item) => done.then(() => window.studio.reviewAsset({ ...id, assetId: item.asset_id ?? "", revision: item.revision ?? undefined, verdict: "accepted" })),
                Promise.resolve<ProjectOverview | null>(null),
              )
              if (results) apply(results)
              setJudged(`${list.length} 样都通过了。`)
              earnAdvancement(props.projectId, "accepted")
            }),
        },
      ],
    })
  }
  const pick = (stage: Stage) => {
    if (anyDirty()) return leavePreview(() => pick(stage))
    setTrail([])
    if (stage.id === "idea" || stage.id === "plan") {
      setFocus(null)
      setPlanOpen(!!plan())
      // Without a plan, "say your idea" is the sentence box on this page.
      if (!plan()) queueMicrotask(() => document.querySelector<HTMLTextAreaElement>(".project-assets .pa-say textarea")?.focus())
      return
    }
    setPlanOpen(false)
    setFocus(focus() === stage.id ? null : stage.id)
  }
  const hover = (event: MouseEvent, item: OverviewItem) => setTip({ x: event.clientX, y: event.clientY, item })
  const slot = (item: OverviewItem, small = false) => (
    <AssetSlot
      item={item}
      kind={kindOf(item)}
      small={small}
      picture={picture(item)}
      words={item.kind === "logic" && item.preview.source ? ruleCaption(props.project, item) : null}
      stale={staleIds().has(item.id)}
      round={item.status === "making" ? makingBadge(makingOf(item), small) : null}
      onOpen={open}
      onHover={hover}
      onLeave={() => setTip(undefined)}
    />
  )
  const view = (next: "content" | "section" | "guide") => {
    remembered.mode = next
    setMode(next)
    setVisible(PAGE)
  }
  const road = () => (
    <nav class="pa-road mc-window" aria-label="从一句话到游戏里">
      {/* A stage this project never had (no plan, so nothing asked to be judged) is left out, not greyed out. */}
      <For each={stages().filter((stage) => stage.state !== "skip")}>
        {(stage, index) => (
          <>
            <Show when={index() > 0}>
              <i class="pa-road-link" data-state={stage.state} aria-hidden="true" />
            </Show>
            <button
              type="button"
              class="pa-stop"
              data-stage={stage.id}
              data-state={stage.state}
              aria-pressed={focus() === stage.id || (reviewing() && stage.id === "plan")}
              aria-current={stage.state === "now" ? "step" : undefined}
              disabled={stage.off}
              title={stage.state === "done" ? "这一步做完了" : stage.state === "now" ? "现在在这一步" : stage.state === "skip" ? "这个模组没有用到这一步" : "还没到这一步"}
              onClick={() => pick(stage)}
            >
              <span class="pa-stop-frame">
                <svg viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
                  <path fill="currentColor" d={pixels(stage.state === "done" ? marks.saved : stage.mark)} />
                </svg>
              </span>
              <span class="pa-stop-words">
                <strong>{stage.label}</strong>
                <small>{stage.count || (stage.state === "done" ? WORDS.ready : stage.state === "now" ? "现在" : stage.state === "skip" ? "没用到" : "还没到")}</small>
              </span>
            </button>
          </>
        )}
      </For>
    </nav>
  )
  const lens = () => {
    const count = () => focused().length
    const waits = () => focused().filter((item) => item.status === "review").length
    const keptWaits = () => focused().filter((item) => item.status === "review" && keptEach(item)).length
    const now = () => production()!
    const said = (): { title: string; hint: string } => {
      if (focus() === "make")
        return count()
          ? { title: `还没做好的 ${count()} 样`, hint: running() ? "AI 正在一样一样地做，做好一样，这里就少一样。" : "点上面的「继续制作」，AI 会接着做。" }
          : { title: "每一样都做出来了", hint: now().unsatisfied || now().interrupted ? `接下来可以一样一样地验收。${heldHint(now())}` : "接下来可以一样一样地验收。" }
      if (focus() === "review")
        return count()
          ? {
              title: waits() ? `有 ${waits()} 样等你验收` : `有 ${count()} 样要重做`,
              hint: `${keptWaits() ? `${KEPT_WORDS.among(waits(), keptWaits())}。` : ""}点开一样，转一转、播一播；觉得可以就点「验收通过」，不满意就点「退回重做」。`,
            }
          : { title: now().accepted ? "你都验收过了" : "现在没有要验收的", hint: "AI 每做好一样，就会出现在这里等你看。" }
      if (focus() === "build")
        return count()
          ? { title: `做好了、还没做进模组的 ${count()} 样`, hint: "选「打包」生成模组文件，或选「构建并试玩」试玩。" }
          : { title: "都已经做进模组了", hint: "想进游戏看看，点「构建并试玩」。" }
      if (!count()) return { title: "每一样都在游戏里看过了", hint: "这个模组可以拿去玩了。" }
      // Nothing is claimed that was not recorded: no check in the game yet means exactly that.
      return made().some((item) => item.facts.client !== null || item.facts.gametest !== null)
        ? { title: `还没在游戏里亲眼看过的 ${count()} 样`, hint: "只有进游戏亲眼看过、确认没问题的，才会在这里打勾。点「构建并试玩」进游戏。" }
        : { title: "游戏里还一样都没看过", hint: "到现在为止，没有任何一样让游戏自动查过，也没有人进游戏亲眼看过。点「构建并试玩」，做进模组以后进游戏看。" }
    }
    return (
      <>
        <header class="pa-lens">
          <div>
            <strong>{said().title}</strong>
            <span>{said().hint}</span>
          </div>
          <Show when={focus() === "review" && waits() > 0}>
            <Button primary onClick={review}>
              从第一样开始验收
              <Icon name="arrow" />
            </Button>
          </Show>
          <Show when={focus() === "review" && waits() > 1}>
            <Button disabled={!!pending()} onClick={acceptShown}>
              这 {waits()} 样我都看过了，都通过
            </Button>
          </Show>
          <Show when={(focus() === "build" || focus() === "play") && props.onBuild}>
            {packButtons()}
          </Show>
          <Button onClick={() => setFocus(null)}>看全部</Button>
        </header>
      </>
    )
  }

  const errorBar = () => (
    <Show when={error()}>
      <p class="pa-error" role="alert">
        <span>{error()}</span>
        <button type="button" class="pa-mini" aria-label="关闭提示" onClick={() => setError("")}>
          <Icon name="close" />
        </button>
      </p>
    </Show>
  )
  // One panel, where the sentence was typed: what happened to it, what is missing, and the way to the connection settings that already exist.
  const noAi = () => (
    <Show when={parked()} fallback={<p class="pa-hint">还没有连上 AI。想法可以先写下来，要让 AI 做的时候再连。{NO_AI_WORDS}</p>}>
      <div class="pa-parked" role="status">
        <strong>这句话我记下了。要做出来，得先接上一个 AI</strong>
        <Show when={sentence().trim()}>
          <p class="pa-quote mc-well">{sentence().trim()}</p>
        </Show>
        <div class="pa-parked-actions">
          <Button primary onClick={props.onSettings}>
            连接 AI
            <Icon name="arrow" />
          </Button>
          <span>连好以后回到这里，这句话还在，不用重写。</span>
        </div>
      </div>
    </Show>
  )
  const sentenceBox = (big: boolean) => (
    <div class="pa-say" classList={{ big }}>
      <textarea
        class="pa-input"
        aria-label="想做个什么模组"
        rows={big ? 3 : 1}
        maxLength={2000}
        placeholder={big ? "比如：符咒师，能画符咒，有怨灵出没…" : "想做个什么模组？说一句话就行"}
        value={sentence()}
        disabled={!!pending()}
        onInput={(event) => remember(event.currentTarget.value)}
        onKeyDown={(event) => type(event, () => submit(sentence()))}
      />
      <Show
        when={props.external || props.aiConfigured}
        fallback={
          <Button primary disabled={!!pending()} onClick={() => submit(sentence())}>
            让 AI 安排
          </Button>
        }
      >
        <div class="pa-say-actions">
          {/* One click, as before: straight to a plan. */}
          <Button disabled={!!pending()} onClick={() => submit(sentence())}>
            {props.external ? "复制给我的 AI" : "让 AI 做"}
          </Button>
          <Button primary disabled={!!pending()} onClick={() => submit(sentence(), "ideas")}>
            <Icon name={props.external ? "copy" : "play"} />
            {props.external ? (copied() ? "再复制一次" : "先出几个想法，复制给我的 AI") : "先帮我想细一点"}
          </Button>
        </div>
      </Show>
    </div>
  )
  const refusedBanner = () => (
    <Show when={state.overview?.plan_refusal}>
      {(refusal) => <RefusedPlan refusal={refusal()} standing={!!plan()} external={props.external} advanced={advanced()} onToRequirement={(constraint) => setToRequirement({ id: constraint, nonce: (toRequirement()?.nonce ?? 0) + 1 })} />}
    </Show>
  )
  const afterSay = () => (
    <>
      <Show when={hint()}>
        <p class="pa-hint warn">{hint()}</p>
      </Show>
      <Show when={props.external && copied()}>
        <p class="pa-copied" role="status">
          <Icon name="check" />
          <span>
            <strong>已复制，去你的 AI 窗口粘贴就行。</strong>
            AI 把蓝图想好以后，这里会自己换成蓝图，不用刷新。
          </span>
        </p>
      </Show>
      <Show when={!props.external && !props.aiConfigured}>{noAi()}</Show>
      {/* A refused plan is not stored: with no plan the reason stands here, where the plan should be, with the requirement it is about just below. */}
      <Show when={!plan()}>{refusedBanner()}</Show>
      <Show when={required()}>{(record) => <Requirements constraints={record().constraints} lifted={record().lifted} busy={!!pending()} focus={toRequirement()} onChange={(change) => void chooseIdea(change)} />}</Show>
    </>
  )

  // Five separate facts, none standing in for another. Null means nobody has recorded it, said as "not yet".
  const facts = (item: OverviewItem) => [
    // Saved is not passed: a version kept without passing its review is said as that here, as on the strip, never as 「是」 (broad20: the banner said the AI was not satisfied over a 「是」).
    keptEach(item) && item.facts.saved && item.status !== "making"
      ? { label: "做好了", value: keptEach(item)!, state: "no" }
      : { label: item.status_label === "已保存" ? "已保存" : "做好了", value: item.facts.saved ? "是" : "还没有", state: item.facts.saved ? "yes" : "none" },
    {
      label: "你验收过了",
      value: item.facts.accepted === true ? "通过了" : item.facts.accepted === false ? "你说要改" : "还没有",
      state: item.facts.accepted === true ? "yes" : item.facts.accepted === false ? "no" : "none",
    },
    { label: "已做进模组", value: item.facts.built ? "是" : "还没有", state: item.facts.built ? "yes" : "none" },
    ...(["gametest", "client"] as const).map((key) => ({
      label: key === "gametest" ? "游戏自动查过" : "游戏里亲眼看过",
      value: item.facts[key] === null ? "还没有" : item.facts[key] ? "通过了" : "没通过",
      state: item.facts[key] === null ? "none" : item.facts[key] ? "yes" : "no",
    })),
  ]
  // What the status means for the person right now, next to the status word the overview gives.
  const meaning = (item: OverviewItem) => {
    // Something the person made by hand that is not whole yet (a creature with no model) is not in any plan: its reason says what is missing.
    if (item.status === "planned") return item.key === null ? "这是你手动做的，还缺东西，所以还不算做好。" : "排在计划里，还没开始做。"
    if (item.status === "making" && item.queued) return item.facts.saved ? `${queueWords(item)}。要重做它，左边还是上一版。` : `${queueWords(item)}。还没有开始做它。`
    if (item.status === "making") return item.facts.saved ? "AI 正在重做它，左边还是上一版。" : "AI 正在做它。"
    // Packed or not is a separate fact (its own row above): either way the answer is still the person's to give.
    if (item.status === "review" && item.ai_unsatisfied) return `AI 自己还不满意，先把最好的一版留给了你${item.facts.built ? "，也已经做进模组了" : ""}，没有算「已做好」。等你看一眼：可以就通过，不满意就让它改。`
    if (item.status === "review" && item.ai_interrupted) return `制作中途被打断了，存下的是打断前的一版${item.facts.built ? "，也已经做进模组了" : ""}，还没做完审查，没有算「已做好」。等你看一眼：可以就通过，不满意就让它改。`
    if (item.status === "review") return `AI 做好了${item.facts.built ? "，也已经做进模组了" : ""}，等你看一眼：可以就通过，不满意就让它改。`
    if (item.status === "redo") return item.facts.saved ? "你说它要改，还没重做好。" : "它上次没做成，已经记下要再试一次。"
    if (item.status === "failed") return "AI 试过了，这一样没做成。"
    if (item.status === "blocked") return "它自己没有问题，只是在等别的东西先做成。"
    if (item.status === "out_of_scope") return "不做这个了。"
    if (item.status === "verified") return "已经做进模组，游戏里的测试也通过了。"
    if (item.status === "built") return item.facts.client === false ? "已经做进模组，但在游戏里看的时候没通过。" : "已经做进模组，还没在游戏里确认过。"
    if (item.status_label === "已保存") return "已保存，这一版没有 AI 检查记录。"
    return item.facts.accepted ? "做好了，你也验收通过了，还没做进模组。" : "做好了，还没做进模组。"
  }
  const when = (at: string) => new Date(at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
  // The review in one line, for the folded block.
  const checkLine = (result: AssetCheck) => {
    if (result.unreadable) return "这样东西读不出来，没法按标准检查。"
    if (result.nothing) return `没有可以量的地方：${result.nothing}。`
    const names = (state: string) => result.criteria.filter((value) => value.state === state).map((value) => value.name)
    const rest = names("unmeasured").length ? `；另有 ${names("unmeasured").length} 条这一种还量不了` : ""
    if (!names("failed").length) return `量得了的 ${names("passed").length} 条都通过了${rest}。`
    return `${names("failed").join("、")}没通过${names("passed").length ? `；${names("passed").join("、")}通过了` : ""}${rest}。`
  }
  const problemTag = (kind: Problem["kind"]) => (kind === "stale" ? "用到的东西变了" : kind === "missing_reference" ? "缺东西" : kind === "unused" ? "没被用上" : "被卡住")
  // What will happen once the remark is sent, said before it is sent.
  const redoWho = () => ({ external: !!props.external, aiConfigured: props.aiConfigured, running: running() })
  const promise = (item: OverviewItem) => redoPromise(redoWho(), judgeable(item) ? "按你说的重做这一样" : "把这一样再做一次")
  const related = (title: string, ids: string[]) => (
    <Show when={ids.some((value) => byId().has(value))}>
      <section class="pa-related">
        <h4>
          {title}
          <small>{ids.filter((value) => byId().has(value)).length}</small>
        </h4>
        <div class="pa-related-grid">
          <For each={ids.flatMap((value) => byId().get(value) ?? []).slice(0, 24)}>{(item) => slot(item, true)}</For>
        </div>
      </section>
    </Show>
  )

  const bundles = () => (
    <>
      <div class="pa-bundles">
        <For each={roots().slice(0, visible())}>
          {(root) => (
            <section class="pa-bundle" classList={{ alone: !parts(root).length }}>
              {slot(root)}
              <Show when={parts(root).length}>
                <div class="pa-parts">
                  <For each={parts(root)}>{(item) => slot(item, true)}</For>
                </div>
              </Show>
            </section>
          )}
        </For>
      </div>
      <Show when={roots().length > visible()}>
        <button type="button" class="pa-more" onClick={() => setVisible(visible() + PAGE)}>
          再看 {Math.min(PAGE, roots().length - visible())} 个（还有 {roots().length - visible()} 个没显示）
        </button>
      </Show>
      <Show when={loose().length}>
        <h3 class="pa-heading">
          玩法和别的东西<small>{loose().length}</small>
        </h3>
        <div class="pa-grid">
          <For each={loose().slice(0, visible())}>{(item) => slot(item)}</For>
        </div>
      </Show>
    </>
  )
  const sections = () => (
    <div class="pa-sections">
    <For each={groups()}>
      {(group) => (
        <section class="pa-section">
          <h3 class="pa-group">{kinds().get(usedKinds().find((kind) => kinds().get(kind)!.group.id === group)!)!.group.label}</h3>
          <For each={usedKinds().filter((kind) => kinds().get(kind)!.group.id === group)}>
            {(kind) => (
              <div class="pa-row">
                <h4>
                  {kinds().get(kind)!.label}
                  <small>{ofKind(kind).length}</small>
                </h4>
                <div class="pa-grid">
                  <For each={ofKind(kind).slice(0, visible())}>{(item) => slot(item)}</For>
                </div>
                <Show when={ofKind(kind).length > visible()}>
                  <button type="button" class="pa-more" onClick={() => setVisible(visible() + PAGE)}>
                    再看 {Math.min(PAGE, ofKind(kind).length - visible())} 个（还有 {ofKind(kind).length - visible()} 个没显示）
                  </button>
                </Show>
              </div>
            )}
          </For>
        </section>
      )}
    </For>
    </div>
  )
  const chest = () => (
    <div class="pa-chest mc-window">
      <Show when={focus() && !reviewing()}>{lens()}</Show>
      <Show when={true}>
      <header class="pa-top">
        <div class="pa-tabs" role="tablist" aria-label="怎么看">
          <button type="button" role="tab" aria-selected={mode() === "content"} onClick={() => view("content")}>
            <Icon name="entity" />
            能不能玩
          </button>
          <Show when={advanced()}><button type="button" role="tab" aria-selected={mode() === "section"} onClick={() => view("section")}>
            <Icon name="recipe" />
            按板块看
          </button></Show>
          <button type="button" role="tab" class="pa-tab-guide" aria-selected={mode() === "guide"} onClick={() => view("guide")}>
            <Icon name="document" />
            说明书
            <Show when={checkMark(guideState(), blueprint()?.paper)}>{(state) => <i data-state={state()} title={state() === "ok" ? "检查：没有问题" : state() === "warn" ? "检查：有提醒" : "检查：有地方要先改"} />}</Show>
          </button>
        </div>
      </header>
      {/* How many things there are to lay out: the stylesheet sizes the slots from it and from the room the panel has. */}
      <div class="pa-scroll" style={{ "--pa-count": made().length }}>
        {/* The guide is one of the ways to look at the same things, so it lives in this panel and scrolls with it; it stays
            mounted while another way is shown, so its tab can carry what the reconciliation came to. */}
        <Show when={made().length}>
          <div class="pa-guide" hidden={mode() !== "guide"}>
            <ModGuide projectId={props.projectId} revision={props.project.revision} advanced={advanced()} onState={setGuideState} onGo={go} />
          </div>
        </Show>
        <Show when={mode() !== "guide" || !made().length}>
        {playPanel()}
        <Show when={made().length} fallback={<p class="pa-empty">这里还没有要做的东西。</p>}>
          <Show when={advanced() && mode() === "section"}>{sections()}</Show>
        </Show>
        </Show>
        <Show when={skipped().length && mode() !== "guide"}>
          <section class="pa-skipped">
            <h3 class="pa-heading">
              这次做不了<small>{skipped().length}</small>
            </h3>
            <p class="pa-hint">这些是你提到、但 AI 判断 Studio 现在还做不进游戏的东西，理由是 AI 写的，在每一条后面。它们不会被做，也不会影响别的；觉得其实能做，就跟 AI 说一声，让它重新规划。</p>
            <For each={skipped()}>
              {(item) => (
                <button
                  type="button"
                  class="pa-skip"
                  data-item={item.id}
                  onClick={() => open(item.id)}
                >
                  <span class="pa-cell mc-slot" data-kind={item.kind}>
                    <Icon name={(kindOf(item)?.glyph ?? "cube") as Glyph} />
                    <StatusMark status={item.status} label={item.status_label} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.out_of_scope ?? item.reason ?? item.status_label}</small>
                  </span>
                </button>
              )}
            </For>
          </section>
        </Show>
      </div>
      </Show>
      <footer class="pa-foot">
        <span class="pa-legend">
          <For each={Object.keys(marks) as OverviewStatus[]}>
            {(status) => (
              <Show when={items().find((item) => item.status === status)}>
                {(item) => <StatusMark status={status} label={item().status_label} words />}
              </Show>
            )}
          </For>
        </span>
        <span>{mode() === "guide" ? "点一下标题，把那一段收起或展开" : judged() || "点左栏的格子，看样子、播动作、给它验收"}</span>
      </footer>
    </div>
  )

  const problems = () => (
    <Show when={overview()!.problems.length}>
      <div class="pa-problems">
        <button type="button" aria-expanded={listed()} onClick={() => setListed(!listed())}>
          <i class="pa-stale-mark" aria-hidden="true" />
          有 {new Set(overview()!.problems.map((value) => value.item)).size} 样东西需要看一眼
          <Show when={staleIds().size}>
            <span>其中 {staleIds().size} 样用到的东西重做过</span>
          </Show>
          <em>{listed() ? "收起" : "看看是什么"}</em>
        </button>
        <Show when={listed()}>
          <ul>
            <For each={overview()!.problems}>
              {(problem) => (
                <li>
                  <button type="button" data-kind={problem.kind} onClick={() => open(problem.item)}>
                    <em>{problemTag(problem.kind)}</em>
                    {problem.message}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  )
  // The AI waits for the blueprint's decision in a call of its own (`blueprint_wait`): then there is nothing to tell it, and the sentence says so; the copyable sentence is only for the AI that is not waiting.
  const aiWait = () => state.overview?.blueprint_wait?.ai
  // Before the person has confirmed there is nothing to tell the AI yet (and the copyable sentence says the blueprint is confirmed): only what confirming will lead to.
  const unconfirmed = () => state.overview?.blueprint?.state === "draft"
  const goBack = (words: string) => (
    <div class="pa-handover">
      <span>{unconfirmed() ? beforeConfirmWords(true, aiWait()) : afterConfirmWords(aiWait(), words)}</span>
      <Show when={!unconfirmed() && aiWait() !== "waiting" && aiWait() !== "told"}>
      <button
        type="button"
        class="pa-link"
        onClick={() =>
          act("copy", async () => {
            await window.studio.copyText({ text: `MineMods 工程「${props.projectName}」的蓝图我已经在 Studio 里确认了，请${words}，一批一批做到全部做好。` })
            setTold(true)
          })
        }
      >
        {told() ? "已复制，再复制一次" : "复制这句话"}
      </button>
      </Show>
    </div>
  )
  // Once at least one thing is saved there is something to write a receipt about.
  const receiptButton = () => (
    <Show when={production()?.saved}>
      <Button class="pa-receipt" onClick={() => setReceiptOpen(true)}>
        检查结果
      </Button>
    </Show>
  )
  const strip = () => {
    const now = () => production()!
    return (
      <section class="pa-strip mc-window" role="status">
        <div class="pa-strip-main">
          <strong>
            {/* A saved thing that is being made again, or was kept without passing its review, is not "done": it keeps its version on disk but the sentence must not count it (`production.done`, the same number as the road and the bar). */}
            <Show when={now().done < now().total} fallback={overview()?.build_failure ? `做好了 ${now().done} / ${now().total} 样，打包待修复` : doneLine(now())}>
              <Show when={noneYet()} fallback={<>{doneLine(now())}</>}>
                正在做 {inHand().length} 样，还没有一样做完
              </Show>
            </Show>
            <Show when={now().remaking - (now().queued_again ?? 0) > 0}>
              <em> · 正在重做 {now().remaking - (now().queued_again ?? 0)} 样</em>
            </Show>
            <Show when={now().to_review}>
              <em> · 等你验收 {now().to_review}</em>
            </Show>
            {/* broad1: "全部做好了" read as "all passed"; broad19: and "已做好 4 / 5" counted a Boss whose review stopped it. What was kept without passing is counted apart, beside the done count, with the card's own mark in the hover. */}
            <Show when={heldWords(now()).length}>
              <em class="pa-strip-kept" title={heldHint(now())}> · {heldWords(now()).join(" · ")}</em>
            </Show>
            <Show when={running() && !inHand().length}>
              <span> · {now().current.length ? `正在做：${now().current.join("、")}` : queueLine(made()) ? queueLine(made()) : "正在准备下一批…"}</span>
            </Show>
          </strong>
          {/* Where each thing in hand stands, in words and not in a count that stays at 0: it comes from the making records and the drafts. */}
          <Show when={running() && inHand().length}>
            <p class="pa-now" title={inHand().map((value) => `${value.title}（${value.kind}）${value.said}`).join("\n")}>
              {makingSentence(inHand())}
            </p>
          </Show>
          {/* Waiting is said apart from making: a thing in the queue has had nothing started on it, and says what it waits for. */}
          <Show when={running() && inHand().length > 0 && queueLine(made())}>
            <p class="pa-now">{queueLine(made())}</p>
          </Show>
          <span class="pa-progress" aria-hidden="true">
            {/* The game's experience level: how many things are made, in green over the bar. */}
            <b class="pa-level">{now().done}</b>
            <i class="done" style={{ width: `${doneShare(now()) * 100}%` }} />
            {/* Saved but kept without a pass: its own amber segment after the green, so the bar and the count say the same thing. */}
            <Show when={heldShare(now())}>
              <i class="held" style={{ width: `${heldShare(now()) * 100}%` }} />
            </Show>
            {/* Only what the records hold: the percentage an outside AI reported for a draft, or the versions made against the versions allowed. */}
            <Show when={running() && inHand().length}>
              <i class="now" style={{ width: `${inHandShare(inHand(), now().total) * 100}%` }} />
            </Show>
            <i class="bad" style={{ width: `${((now().failed + now().blocked) / Math.max(now().total, 1)) * 100}%` }} />
          </span>
          <small>
            <Show when={now().failed}>
              <StatusMark status="failed" label={`${now().failed} 样没做成`} words />
            </Show>
            <Show when={now().blocked}>
              <StatusMark status="blocked" label={`${now().blocked} 样被卡住`} words />
            </Show>
            <Show when={now().to_redo}>
              <StatusMark status="redo" label={`${now().to_redo} 样等着重做`} words />
            </Show>
            <Show when={running() && now().to_review}>
              <span>不用等全部做完，做好的现在就能看。</span>
            </Show>
            <Show when={!running() && now().saved === now().total && now().total > 0 && !now().to_review}>
              <span>点右上角「构建并试玩」，进游戏看看。</span>
            </Show>
            <Show when={!running() && now().saved < now().total && !now().failed && !now().blocked && !props.external}>
              <span>还有 {left()} 样没开始做。</span>
            </Show>
            <Show when={stopping() && running()}>
              <span>做完手上这几样就停。</span>
            </Show>
            {/* Where 审查 and 验收 are both on the page: who waits for whom, once. */}
            <Show when={state.overview?.review_on !== undefined && (running() || now().to_review > 0 || !!state.overview?.review_wait)}>
              <span class="pa-order">{state.overview!.review_on ? ORDER_WORDS.on : ORDER_WORDS.off}</span>
            </Show>
          </small>
          <Show when={now().note}>
            <p class="pa-note">{now().note}</p>
          </Show>
        </div>
        <div class="pa-strip-actions">
          <Show when={awaiting().length}>
            <Button primary class="pa-call" onClick={review}>
              <StatusMark status="review" label="等你验收" />
              {callWords()}
              <Icon name="arrow" />
            </Button>
          </Show>
          <Show when={running() && !props.external}>
            <Button disabled={stopping() || !!pending()} onClick={stop}>
              {stopping() ? "正在停下…" : "先停一下"}
            </Button>
          </Show>
          <Show when={running() && props.external}>
            <button type="button" class="pa-link" onClick={props.onWatch}>
              去制作现场看看
            </button>
          </Show>
          <Show when={!running() && left() > 0 && !props.external && props.aiConfigured}>
            <Button primary disabled={!!pending()} onClick={start}>
              <Icon name="play" />
              {now().saved || now().failed ? "继续制作" : "开始制作"}
            </Button>
          </Show>
          <Show when={!running() && now().failed > 0 && (props.external || props.aiConfigured)}>
            <Button primary={left() === 0 && !awaiting().length} disabled={!!pending()} onClick={confirm}>
              再试一次失败的
            </Button>
          </Show>
          <Show when={!running() && !props.external && !props.aiConfigured && now().saved < now().total}>
            <Button onClick={props.onSettings}>连接 AI</Button>
          </Show>
          <Show when={!running()}>
            <Button disabled={!!pending()} onClick={() => setPlanOpen(true)}>
              看蓝图
            </Button>
          </Show>
          {receiptButton()}
        </div>
        <Show when={state.overview?.review_wait}>
          {(wait) => <ReviewWaitNotice projectId={props.projectId} wait={wait()} onChanged={() => void load()} />}
        </Show>
        <Show when={!running() && props.external && now().saved < now().total}>{goBack(now().saved ? "继续做" : "开始做")}</Show>
      </section>
    )
  }
  const book = () => (
    <aside class="pa-book mc-window">
      <div class="pa-book-scroll">
      {/* A newer plan an AI handed in was refused: what is on this page is the one before it, and the reason stands here. */}
      {refusedBanner()}
      <Show when={plan()!.questions.length}>
        <section class="pa-questions">
          <h3>AI 想先问你 {plan()!.questions.length} 件事</h3>
          <ol>
            <For each={plan()!.questions}>{(question) => <li>{question}</li>}</For>
          </ol>
          <p>不回答也能开工。想回答的话，在下面「再说一句」里写上就行。</p>
        </section>
      </Show>
      <section>
        <h3>你说的</h3>
        <p class="pa-quote mc-well">{plan()!.request}</p>
      </section>
      {/* creature tier (10-12): every creature's 简单 / 标准 / 精细 / Boss in the book itself, where the person reads the plan before confirming, not only inside one card. */}
      <Show when={blueprint()?.entries.some((value) => value.kind === "entity" && !value.out_of_scope)}>
        <section class="pa-tiers">
          <h3>生物要做到多细</h3>
          <p>AI 先按你的话定了一档，不对就点一下换，确认蓝图以后才算数。{DETAIL_WORDS.tier}</p>
          <ul>
            <For each={blueprint()!.entries.filter((value) => value.kind === "entity" && !value.out_of_scope)}>
              {(value) => (
                <li>
                  <strong>{value.title}</strong>
                  <div class="pa-tier-buttons" role="group" aria-label={`「${value.title}」的档位`}>
                    <For each={CREATURE_TIER_LEVELS}>
                      {(level) => (
                        <button
                          type="button"
                          class="studio-button pa-tier-button"
                          classList={{ primary: tierOf(value).level === level }}
                          aria-pressed={tierOf(value).level === level}
                          disabled={!reviewing() || running() || !!pending() || (value.tier?.by === "you" && value.tier.level === level)}
                          title={CREATURE_TIERS[level].use}
                          onClick={() => chooseTier(value.key, level)}
                        >
                          {CREATURE_TIERS[level].label}
                        </button>
                      )}
                    </For>
                  </div>
                  <small class="pa-tier-reason">{value.tier ? (value.tier.by === "you" ? PERSON_TIER_REASON : `AI 的判断：${value.tier.reason}`) : "没有定档位，按「标准」做。"}</small>
                  {/* broad21: what the chosen tier has to have, from the same list the maker and the reviewer are given. */}
                  <small class="pa-tier-reason pa-tier-asks">{tierAsksBrief(tierOf(value).level)}</small>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
      {/* What the person said must hold, beside the plan they are about to confirm, with how each entry keeps it. They can change their mind here without starting over; while things are being made the list is only read. */}
      <Show when={blueprint() && (blueprint()!.constraints?.length || !running())}>
        <Requirements
          constraints={blueprint()!.constraints ?? []}
          lifted={blueprint()!.lifted ?? []}
          busy={!!pending() || comparing()}
          comparing={comparing()}
          focus={toRequirement()}
          onChange={running() ? undefined : (change) => void chooseIdea(change)}
          honours={[
            ...(blueprint()!.honours ?? []).map((value) => ({ ...value, title: null })),
            ...blueprint()!.entries.flatMap((value) => (value.honours ?? []).map((honour) => ({ ...honour, title: value.title }))),
          ]}
          checked={(() => {
            const check = blueprint()!.check
            if (!check) return "这份蓝图还没有照现在的要求重新审查过（你改过要求，或者审查没做成）。"
            const open = (blueprint()!.constraints ?? []).filter((value) => !(blueprint()!.lifted ?? []).some((entry) => entry.constraint === value.id))
            const broken = check.verdicts.find((verdict) => !verdict.kept && open.some((value) => value.id === verdict.constraint))
            const reader = check.by === "studio" ? "一个没参与规划、只看得到这些要求和蓝图的审查员" : `你的 AI 说它${check.independent ? "请了一个没参与规划的审查员" : "自己"}`
            if (broken) return `${reader}逐条看过，认为这份蓝图违反了你说的「${open.find((value) => value.id === broken.constraint)?.text ?? ""}」：${broken.why}可以改这条要求、不要它，或者让 AI 重新出蓝图。`
            return check.by === "studio"
              ? `${reader}逐条看过，没有发现违反。它也可能看漏，确认前你自己再看一眼。`
              : `${reader}逐条审查过，没有发现违反。Studio 没法验证这一点，确认前你自己再看一眼。`
          })()}
        />
      </Show>
      <section class="pa-style" classList={{ wide: wide() }}>
        <h3>整个模组的样子</h3>
        <Show when={plan()!.style.palette.length}>
          <div class="pa-palette" role="img" aria-label="配色">
            <For each={plan()!.style.palette}>{(color) => <i style={{ background: color }} title={advanced() ? color : undefined} />}</For>
          </div>
        </Show>
        <dl>
          <For
            each={[
              { label: "造型", text: plan()!.style.shape },
              { label: "起名", text: plan()!.style.naming },
              { label: "世界", text: plan()!.style.world },
            ].filter((line) => line.text)}
          >
            {(line) => (
              <>
                <dt>{line.label}</dt>
                <dd>{line.text}</dd>
              </>
            )}
          </For>
        </dl>
        <Show when={[plan()!.style.shape, plan()!.style.naming, plan()!.style.world].some((text) => text.length > 54)}>
          <button type="button" class="pa-link" onClick={() => setWide(!wide())}>
            {wide() ? "收起" : "看全部"}
          </button>
        </Show>
      </section>
      <Show when={!running()}>
        <section>
          <h3>再说一句</h3>
          <div class="pa-say">
            <textarea
              class="pa-input"
              aria-label="还想加点或者改点什么"
              rows={2}
              maxLength={1000}
              placeholder="还想加点或者改点什么？"
              value={more()}
              disabled={!!pending()}
              onInput={(event) => setMore(event.currentTarget.value)}
              onKeyDown={(event) => type(event, () => more().trim() && submit(`${plan()!.request}\n补充：${more().trim()}`))}
            />
            <Button
              disabled={!!pending() || !more().trim() || (!props.external && !props.aiConfigured)}
              onClick={() => submit(`${plan()!.request}\n补充：${more().trim()}`)}
            >
              {props.external ? "复制给我的 AI" : "让 AI 改一改"}
            </Button>
          </div>
          {afterSay()}
        </section>
      </Show>
      </div>
      <footer class="pa-book-actions">
        <p class="pa-count">
          蓝图里打算做 <strong>{blueprintCounts().planned}</strong> 样
          <Show when={blueprintCounts().skipped}>
            ，另外记下 <strong>{blueprintCounts().skipped}</strong> 样暂不制作的东西
          </Show>
          。工程总览里已保存 <strong>{blueprintCounts().saved}</strong> 样，其中 <strong>{blueprintCounts().outside}</strong> 样不在这份蓝图里。

          <Show when={advanced()}>
            <code>蓝图第 {plan()!.revision} 版</code>
          </Show>
        </p>
        <Show when={running()}>
          <p class="pa-hint">正在制作，这会儿改不了蓝图。可以先停一下再改。</p>
        </Show>
        <Show
          when={plan()!.state === "draft"}
          fallback={
            <Button primary onClick={() => setPlanOpen(false)}>
              <Icon name="undo" />
              回工程总览
            </Button>
          }
        >
          <Button primary disabled={!!pending() || !made().length} onClick={confirm}>
            <Icon name="check" />
            {props.external ? WAITING_WORDS.confirm.external : WAITING_WORDS.confirm.own}
          </Button>
          <Show when={!props.external && !props.aiConfigured}>
            <p class="pa-hint warn">{WAITING_WORDS.needsAi}</p>
          </Show>
          <Show when={beforeConfirmWords(!!props.external, aiWait())}>{(words) => <p class="pa-hint">{words()}</p>}</Show>
        </Show>
        <Show when={!running()}>
          <Button disabled={!!pending()} onClick={discard}>
            重新想一个
          </Button>
        </Show>
      </footer>
    </aside>
  )

  return (
    <section class="project-assets pa-activity" style={props.cardOnly ? { display: "contents" } : undefined} classList={{ advanced: advanced(), "pa-activity-open": beside().open, "pa-activity-beside": beside().beside }}>
      <Show when={!props.cardOnly}>
      <Show when={!choosing() && pendingIdeas()?.groups.length}>
        <section class="action-notice pa-ideas-ready" aria-label="等你挑的想法">
          <strong role="status">AI 交来 {pendingIdeas()!.groups.reduce((count, group) => count + group.options.length, 0)} 个想法，等你挑</strong>
          <Button primary onClick={openIdeas}>{WAITING_WORDS.ideasGo}</Button>
        </section>
      </Show>
      <Show when={overview()?.build_failure}>{failure => <section class="action-notice pack-failure" role="alert">
        <strong>打包失败</strong><p>{buildFailureWords(failure().reason).split(/(?<=。)|\n/, 1)[0] ?? ""}</p>
        <div class="button-row"><Button onClick={async () => {
          try {
            await window.studio.copyText({ text: `请修复 MineMods 工程「${props.projectName}」的打包问题，再重新打包验证。\n${failure().reason}${failure().detail ? "\n技术详情：" + failure().detail : ""}` })
            setCopiedFailure(failure().jobId)
          } catch { setError("复制失败，请展开详情复制原因。") }
        }}>{copiedFailure() === failure().jobId ? "已复制" : "复制给我的 AI 去改"}</Button>
        <Button onClick={() => setFailureDetails(failureDetails() === failure().jobId ? "" : failure().jobId)}>{failureDetails() === failure().jobId ? "收起详情" : "看详情"}</Button></div>
        <Show when={failureDetails() === failure().jobId}><p>{buildFailureWords(failure().reason)}</p><Show when={advanced() && failure().detail}><pre>{failure().detail}</pre></Show><p>改好后点「打包」再试一次。成功后，这条提醒会自动消失。</p></Show>
      </section>}</Show>
      <header class="pa-header">
        <h1 ref={overviewHeading} tabIndex={-1}>
          {choosing() ? "想法" : reviewing() ? "蓝图" : "工程总览"}
          <Show when={overview() && made().length && !choosing()}>
            <small>
              {reviewing() ? "先看看 AI 打算做哪些东西，改好了再开工" : `一共 ${made().length} 样东西`}
            </small>
          </Show>
        </h1>
        {/* The mod's own card: name, icon, author, version and licence live on one page, and this is its door from the overview. */}
        <Show when={props.info}>
          {(info) => (
            <button type="button" class="pa-info" onClick={() => info().open()} aria-label="模组信息：名字、图标、作者、版本、许可证。点这里修改">
              <span class="pa-info-face mc-slot">
                <Show when={info().icon} fallback={<Icon name="cube" />}>
                  {(url) => <img src={url()} alt="" draggable={false} />}
                </Show>
              </span>
              <span class="pa-info-text">
                <strong>模组信息</strong>
                <small>{info().line}</small>
              </span>
              <em>改</em>
            </button>
          )}
        </Show>
      </header>
      <Show when={props.onBuild && !choosing() && !reviewing()}>{packButtons()}
        <Show when={props.onRevealJar && !overview()?.build_failure}><Button onClick={props.onRevealJar}>打开模组文件所在的文件夹</Button></Show>
      </Show>
      {/* The road only means something once there is something on it: a plan, or things already made. */}
      <Show when={overview() && (plan() || items().length) && !choosing()}>{road()}</Show>
      <Show when={!card()}>{errorBar()}</Show>
      <Show
        when={overview()}
        fallback={
          <div class="pa-center">
            <div class="pa-box mc-window" role="status">
              <Show
                when={trouble() || slow()}
                fallback={
                  <>
                    <strong>正在打开这个工程…</strong>
                    <span class="pa-bar">
                      <i />
                    </span>
                  </>
                }
              >
                <strong>{trouble() ? "正在重新读取工程…" : "打开得有点慢"}</strong>
                <p class="pa-hint">{trouble() || "正在读取，会自动重试。"}</p>
              </Show>
            </div>
          </div>
        }
      >
        <Show
          when={!job()}
          fallback={
            <div class="pa-center">
              <div class="pa-box mc-window" role="status">
                <strong>{job()!.kind === "ideas" ? "AI 正在替你把没想到的地方想一遍…" : "AI 正在想要做哪些东西…"}</strong>
                <p class="pa-quote mc-well">{job()!.request}</p>
                <span class="pa-bar">
                  <i />
                </span>
                <p class="pa-hint">
                  {job()!.kind === "ideas"
                    ? "一般要等一小会儿。想好以后，这里会摆出几组做法让你挑；你挑完了才会出蓝图。"
                    : "一般要等一小会儿。想好以后，这里会列出每一样要做的东西，你确认了才会开工。"}
                </p>
                <Button
                  disabled={!!pending()}
                  onClick={() =>
                    act("cancel", async () => {
                      await window.studio.cancelJob({ ...id, jobId: job()!.jobId })
                      drafting.delete(props.projectId)
                      setJob(null)
                    })
                  }
                >
                  先不想了
                </Button>
              </div>
            </div>
          }
        >
          <Show
            when={!choosing()}
            fallback={
              <>
              <Show when={pendingIdeas()}><Button onClick={() => { setIdeasOpened(false); overviewHeading?.focus() }}>回工程总览</Button></Show>
              <IdeaChooser
                ideas={choosing()!}
                advanced={advanced()}
                busy={!!pending()}
                external={props.external}
                blocked={props.external || props.aiConfigured ? "" : "还没有连上 AI，连上以后才能出蓝图。"}
                notice={props.external && copied() && choosing()!.state === "ready" ? "已复制，去你的 AI 窗口粘贴就行。它出好蓝图以后，这里会自己换成蓝图，不用刷新。" : ""}
                onChoose={chooseIdea}
                onGo={goIdeas}
                onSkip={() => submit(ideas()!.request)}
                onDiscard={dropIdeas}
              />
              </>
            }
          >
          <Show
            when={plan() || items().length}
            fallback={
              <div class="pa-center">
                <div class="pa-box pa-first mc-window">
                  <h2>{props.nickname ? `${props.nickname}，` : ""}想做个什么模组？说一句话就行</h2>
                  <p class="pa-hint">
                    {props.external
                      ? "写好以后复制给你的 AI。可以让它先出几组想法给你挑，也可以直接出蓝图；都要等你验收才开工。"
                      : "可以让 AI 先把你没想到的地方想一遍、出几组做法给你挑，也可以直接出蓝图。都要等你验收才开工。"}
                  </p>
                  {sentenceBox(true)}
                  {afterSay()}
                  <div class="pa-examples">
                    <span>没想好？点一个试试：</span>
                    <For each={examples}>
                      {(text) => (
                        <button type="button" onClick={() => remember(text)}>
                          {text}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            }
          >
            <Show when={!reviewing()}>{problems()}</Show>
            <Show
              when={reviewing()}
              fallback={
                <div class="pa-main">
                  <Show
                    when={plan()}
                    fallback={
                      <section class="pa-strip pa-fresh mc-window">
                        <div class="pa-strip-main">
                          <strong>想再做点什么？说一句话就行</strong>
                          {sentenceBox(false)}
                          {afterSay()}
                        </div>
                        <Show when={awaiting().length || production()?.saved}>
                          <div class="pa-strip-actions">
                            <Show when={awaiting().length}>
                              <Button primary class="pa-call" onClick={review}>
                                <StatusMark status="review" label="等你验收" />
                                {callWords()}
                                <Icon name="arrow" />
                              </Button>
                            </Show>
                            {receiptButton()}
                          </div>
                        </Show>
                      </section>
                    }
                  >
                    {strip()}
                  </Show>
                  {chest()}
                </div>
              }
            >
              <div class="pa-review">
                {book()}
                {chest()}
              </div>
            </Show>
          </Show>
          </Show>
        </Show>
      </Show>
      {/* What is happening right now, beside the page. It only reads; where it sits is explained in project-activity.css. */}
      <ActivityPanel projectId={props.projectId} advanced={advanced()} presence={props.presence} card={!!card()} name={id => byId().get(id)?.title} has={(itemId) => byId().has(itemId)} onOpen={visit} onState={setBeside} onEvents={setLogged}
        onUndoDeletion={async (deletion) => {
          const projectId = props.projectId
          const opened = await window.studio.openProject(projectId)
          await window.studio.restoreDeleted({ projectId, expectedRevision: opened.project.revision, deletion })
          props.onChanged()
        }} />

      </Show>

      <Show when={card()?.id} keyed>
        {(itemId) => {
          // Children can finish a reactive update while the card is being removed.
          // Read the item by identity instead of a Show accessor invalidated by close().
          const initial = byId().get(itemId)!
          const item = () => byId().get(itemId) ?? initial
          const audio = () => {
            const asset = props.project.workspace.assets.find(a => a.id === item().asset_id)
            const doc = asset?.document
            return asset && (doc?.kind === "sound" || doc?.kind === "music") ? { id: asset.id, doc } : null
          }
          const existingCreature = () => item().kind === "entity"
            ? props.project.blueprint?.entries.find((entry) => item().key && entry.key === item().key && entry.existing && props.project.entities.some((entity) => entity.id === entry.existing?.id))?.existing?.id
            : undefined
          return (
          <CardShell
            title={item().title}
            wide
            trapFocus
            head={
              <>
                <Show when={item().kind==="music"}><span>在 Boss 的「它的声音」里设置。</span></Show>
                <ThingMenu project={props.project} id={item().asset_id ?? existingCreature() ?? item().id.split(":").pop()!} title={item().title} kind={item().kind} busy={item().status==="making"} planned={!item().facts.saved && !!item().key && !existingCreature()} omit={item().key?()=>remove(item()):undefined}
                  saved={(_,id)=>{props.onChanged();if(!id)close()}} go={id=>{const user=byId().get(id);if(user && props.editor(user))props.editor(user)!();else open(id)}}
                  replace={["block","item","sound","music","entity"].includes(item().kind)?props.editor(item(),"replace_file"):undefined} />
                <Show when={place() >= 0 && trail().length === 1}>
                  <span class="pa-counter" aria-live="polite">
                    还剩 {awaiting().length} 样等你验收
                  </span>
                </Show>
                <Show when={reach(item())}>
                  <div class="mk-tabs" role="tablist" aria-label="看成品，还是看制作过程">
                    <button type="button" role="tab" class="pa-move" aria-selected={!onStory()} onClick={() => (notesDirty() ? leavePreview(() => setPage("thing")) : setPage("thing"))}>
                      成品
                    </button>
                    <button type="button" role="tab" class="pa-move" aria-selected={onStory()} onClick={showStory}>
                      制作过程
                    </button>
                  </div>
                </Show>
                <StatusMark status={item().status} label={item().status_label} words />
                <Show when={wantsThreeView(item().kind) && !makingOf(item()) && notStarted(item())}>
                  <ThreeViewMissing projectId={props.projectId} itemId={item().id} />
                </Show>
                <Show when={kept(item())}>
                  {(words) => (
                    <em class="pa-unsat" title={words().words}>
                      {words().card}
                    </em>
                  )}
                </Show>
              </>
            }
            onClose={close}
            onBack={trail().length > 1 ? () => leavePreview(() => setTrail((value) => value.slice(0, -1))) : undefined}
          >
            <div class="pa-card-body" hidden={onStory()}>
              <div class="pa-card-look">
                {/* The story is pictures only: while it is open the live view is put away, so there is never a second one. */}
                <Show when={!onStory()}>
                  <Show when={audio()} fallback={<AssetStage
                    projectId={props.projectId}
                    project={props.project}
                    items={items()}
                    item={item()}
                    glyph={(kindOf(item())?.glyph ?? "cube") as Glyph}
                    draft={draftOf(item())}
                    round={roundPicture(item())}
                    onOpen={open}
                    onSaveItem={props.onSaveItem}
                    onAnnotateModel={props.onAnnotateModel ? async (prompt, input) => { await props.onAnnotateModel!(prompt, input); await load() } : undefined}
                    onDirty={previewChanged}
                    disabled={!!pending() || reviewing()}
                  />}>{a => <AudioEditor auditionOnly project={props.project} assetId={a().id} doc={a().doc} />}</Show>
                </Show>
                <For each={cardParts(item().kind, "look")}>{(value) => <value.part projectId={props.projectId} project={props.project} item={item()} making={makingOf(item())} advanced={advanced()} onOpen={open} focus={fieldRequest()} changed={props.onChanged} />}</For>
              </div>
              <div class="pa-card-info" data-kind={item().kind}>
                <p class="pa-kind">
                  <span>{kindOf(item())?.label}</span>
                  <Show when={detailTag(item(), props.modelComplexity)}>{(tag) => <span>{tag()}</span>}</Show>
                  <Show when={byId().get(item().owner ?? "")}>
                    {(owner) => (
                      <button type="button" onClick={() => open(owner().id)}>
                        属于 {owner().title}
                      </button>
                    )}
                  </Show>
                  <em>{meaning(item())}</em>
                </p>
                <Show when={item().reason ?? item().out_of_scope}>
                  <p class="pa-reason" data-status={item().status}>
                    <strong>
                      {item().status === "out_of_scope"
                        ? "为什么做不了"
                        : item().status === "blocked"
                          ? "为什么被卡住"
                          : item().status === "redo"
                            ? item().facts.saved
                              ? "你说要改"
                              : "要再试一次"
                            : item().status === "planned"
                              ? "还缺什么"
                              : "哪里出了问题"}
                    </strong>
                    {item().reason ?? item().out_of_scope}
                  </p>
                </Show>
                <Show when={item().review && item().status !== "redo"}>
                  <p class="pa-said" data-verdict={item().review!.verdict}>
                    <strong>{item().review!.verdict === "accepted" ? "你验收通过了" : "你说要改"}</strong>
                    <Show when={item().review!.note}>
                      <q>{item().review!.note}</q>
                    </Show>
                    <small>{when(item().review!.at)}</small>
                  </p>
                </Show>
                <For each={problemsOf(item().id)}>
                  {(problem) => (
                    <p class="pa-heed" data-kind={problem.kind}>
                      <i class="pa-stale-mark" aria-hidden="true" />
                      <span>
                        <strong>{problemTag(problem.kind)}</strong>
                        {problem.message}
                        <Show when={problem.kind === "stale" && judgeable(item())}>
                          <small>看看它现在的样子：还合适就点「验收通过」，不合适就点「退回重做」。</small>
                        </Show>
                      </span>
                    </p>
                  )}
                </For>
                <Show when={replaced()}>
                  <p class="pa-hint warn pa-replaced" role="status">
                    {REPLACED_WORDS}。这里是它现在的样子。
                  </p>
                </Show>
                <Show when={makingOf(item())}>{(record) => <MakingTeaser making={record()} asked={item().status === "review"} onOpen={showStory} />}</Show>
                <Show when={reach(item()) === "versions"}>
                  <VersionsTeaser count={versionsOf(item()) ?? 0} onOpen={showStory} />
                </Show>
                {/* Before anything is made of a thing the AI will make by looking, the person can already give it pictures to go by. Once there is a making record the same tray is in its part sheet. */}
                {/* A model's 六视图 comes first. It is also here for a saved model with no making record, which has no story to hold it, so a redo can follow one. */}
                <Show when={!makingOf(item()) && item().key !== null && item().status !== "out_of_scope" && wantsThreeView(item().kind)}>
                  <ThreeViewBlock projectId={props.projectId} itemId={item().id} locked={makingLock(item(), LOCK_THEN.sixView)} />
                </Show>
                <Show when={!makingOf(item()) && !item().facts.saved && item().key !== null && item().status !== "out_of_scope" && LOOKED_KINDS.some((kind) => kind === item().kind)}>
                  <ReferenceTray projectId={props.projectId} itemId={item().id} locked={makingLock(item(), LOCK_THEN.reference)} />
                </Show>
                {/* Other features' own blocks for this kind of thing; see asset-card-parts.ts. */}
                <For each={cardParts(item().kind, "info")}>{(value) => <value.part projectId={props.projectId} project={props.project} item={item()} making={makingOf(item())} advanced={advanced()} onOpen={open} focus={fieldRequest()} changed={props.onChanged} />}</For>
                <Show when={item().kind === "entity" && item().facts.saved}><SteadySetting project={props.project} entityId={(() => {
                  const doc = props.project.workspace.assets.find(a => a.id === item().asset_id)?.document
                  return doc?.kind === "entity" ? doc.model_asset_id : item().id.split(":").pop()!
                })()} saved={props.onChanged} /></Show>
                <Show when={entityKey() && !words()}><p class="pa-hint" role="status">正在读取生物说明…</p></Show>
                <Show when={item().facts.saved && words() && (words()!.sentence || words()!.rows.length || words()!.notes.length)}>
                  <section class="pa-part-block">
                    <h4>现在做出来的是</h4>
                    <Show when={words()!.sentence}>
                      <p class="pa-sentence">{person()(words()!.sentence!, advanced())}</p>
                    </Show>
                    <Show when={words()!.rows.length}>
                      <dl class="pa-words">
                        <For each={words()!.rows}>
                          {(row) => (
                            <>
                              <dt>{row.label}</dt>
                              <dd>
                                <Show when={row.colours}>{colours => <><ParticleColours colours={colours()} />，</>}</Show>
                                {person()(row.text, advanced())}
                                {/* G2: the same fact as the document and the generated code spell it, behind 高级. */}
                                <Show when={advanced() && row.detail}>
                                  <small class="pa-row-detail">{row.detail}</small>
                                </Show>
                              </dd>
                            </>
                          )}
                        </For>
                      </dl>
                    </Show>
                    {/* For a cast action these are what the kind cannot do yet, not something missing from this one. */}
                    <For each={words()!.notes}>{(note) => <p class="pa-hint" classList={{ warn: item().kind !== "gesture" }}>{person()(note, advanced())}</p>}</For>
                  </section>
                </Show>
                {/* Keyed: one review per version, so walking to another thing closes what was unfolded. */}
                <Show when={checkPending()}><p class="pa-hint" role="status">检查中…</p></Show>
                <Show when={check()} keyed>
                  {(result) => (
                    <Fold
                      class="pa-part-block pa-check"
                      state={result.unreadable ? "unreadable" : result.passed ? (result.spared ? "spared" : "passed") : "failed"}
                      open={!result.passed || result.spared || !!versus()}
                      arrow={false}
                      summary={
                        <>
                          <span class="pa-check-title">
                            检查
                            {/* Beside a making story this is only the floor: hard faults that can be measured. */}
                            <Show when={makingOf(item())}>
                              <small>只查硬伤</small>
                            </Show>
                          </span>
                          <span class="pa-check-line">{checkLine(result)}</span>
                          <span class="pa-check-mark">{result.unreadable ? "没法检查" : result.spared ? `不算不合格 · ${result.found} 处` : result.passed ? "机器检查通过" : `机器检查没通过 · ${result.found} 处`}</span>
                        </>
                      }
                    >
                      <Show when={result.draft}>
                        <p class="pa-hint">这是 AI 交上来的草稿，还没有保存；{result.passed ? "机器检查通过，仍要完成制作审查。" : "改到通过才会存进工程。"}</p>
                      </Show>
                      <Show when={!result.draft && !result.passed}>
                        <p class="pa-hint">它已经保存在工程里了，但按现在的标准有下面这些毛病。想让 AI 改，就点「退回重做」。</p>
                      </Show>
                      <Show when={result.spared}>
                        <p class="pa-hint">这是 AI 在你自己做的版本上改的，你原来那一版也没过这几条，所以下面的问题只列出来，不算它不合格。</p>
                      </Show>
                      <Show when={result.simple}>
                        <p class="pa-hint">你要的是简单的，所以这次只查硬伤，做工细不细不算。</p>
                      </Show>
                      <Show when={versus()}>
                        <p class="pa-hint">{versus()}</p>
                      </Show>
                      <Show when={result.unreadable}>
                        {(broken) => (
                          <div class="pa-check-row" data-state="failed">
                            <p class="pa-check-finding">{checkCopy(broken().message, person())}</p>
                            <p class="pa-check-fix">怎么改：{checkCopy(broken().fix, person())}</p>
                          </div>
                        )}
                      </Show>
                      <Show when={!result.unreadable && !result.nothing}>
                        <For each={result.criteria}>
                          {(value) => (
                            <div class="pa-check-row" data-state={value.state}>
                              <p class="pa-check-name">
                                <b>{value.name}</b>
                                <em>{value.state === "passed" ? "通过" : value.state === "failed" ? "没通过" : "这一种还量不了"}</em>
                                <span>{value.state === "unmeasured" ? value.note : value.measures}</span>
                              </p>
                              {/* What a tick stands on: the numbers the passed rules were measured at, or, where a rule has nothing to count, what it looked at. */}
                              <Show when={value.state !== "unmeasured" && value.looked.length}>
                                <ul class="pa-check-looked" aria-label={value.state === "passed" ? "通过的依据" : "这一种里通过的几条"}>
                                  <For each={value.looked}>
                                    {(entry) => (
                                      <li>
                                        <Show when={entry.read} fallback={<>看了：{checkCopy(entry.asks.replace(/。$/, ""), person())}（这一条没有数字，只看有没有）</>}>
                                          量到：{checkCopy(entry.read ?? "", person())}
                                        </Show>
                                        <Show when={advanced()}>
                                          <code>{entry.rule}</code>
                                        </Show>
                                      </li>
                                    )}
                                  </For>
                                </ul>
                              </Show>
                              <For each={value.findings}>
                                {(finding) => (
                                  <>
                                    {/* A finding that quotes the code has a sentence of its own for the person; what it quotes is read under 高级. */}
                                    <p class="pa-check-finding">
                                      {checkCopy(finding.plain ?? finding.message, person())}
                                    </p>
                                    <p class="pa-check-fix">怎么改：{checkCopy(finding.fix, person())}</p>
                                  </>
                                )}
                              </For>
                              {/* What a rule measured and could not call a fault: said, never refused for. */}
                              <For each={value.advice}>{(entry) => <p class="pa-check-fix">建议：{checkCopy(entry.message, person())}</p>}</For>
                            </div>
                          )}
                        </For>
                      </Show>
                      <Show when={result.passed}>
                        <p class="pa-hint">
                          {makingOf(item())
                            ? "这一项只是底线：只查量得出来的硬伤。做得好不好，看「制作过程」里 AI 每一轮的检查和最后的审查，再加上你自己的眼睛。"
                            : "标准只管量得出来的毛病。像不像你想要的样子，还是要你自己看一眼。"}
                        </p>
                      </Show>
                    </Fold>
                  )}
                </Show>
                <Show
                  when={editable()}
                  fallback={
                    <Show when={item().key && item().brief}>
                      <section class="pa-part-block">
                        <Show when={originalBrief(item())} fallback={<><h4>要它做成什么样</h4><BriefNote display={person()} brief={item().brief!} /></>}>
                          <Fold summary="当时的蓝图要求"><BriefNote display={person()} brief={item().brief!} /></Fold>
                        </Show>
                      </section>
                    </Show>
                  }
                >
                  <Show when={editMoved()}>
                    <StaleNotice onLoad={loadEdit} />
                  </Show>
                  <label class="pa-field">
                    <span>名字</span>
                    <input
                      class="pa-input"
                      maxLength={120}
                      value={edit().title}
                      onInput={(event) => setEdit({ ...edit(), title: event.currentTarget.value })}
                      onKeyDown={(event) => type(event, () => changed() && saveEdit())}
                    />
                  </label>
                  <label class="pa-field">
                    <span>{originalBrief(item()) ? "当时的蓝图要求" : "一句话说明"}</span>
                    <textarea
                      class="pa-input"
                      rows={3}
                      maxLength={4000}
                      value={edit().brief}
                      onInput={(event) => setEdit({ ...edit(), brief: event.currentTarget.value })}
                    />
                  </label>
                  <Show when={entry(card()!.key)?.kind === "entity"}>
                    {(() => {
                      const chosen = () => entry(card()!.key)!
                      return (
                        <div class="pa-field pa-tier">
                          <span>要做到多细</span>
                          <div class="pa-tier-buttons" role="group" aria-label="生物档位" title={DETAIL_WORDS.tier}>
                            <For each={CREATURE_TIER_LEVELS}>
                              {(level) => (
                                <button
                                  type="button"
                                  class="studio-button pa-tier-button"
                                  classList={{ primary: tierOf(chosen()).level === level }}
                                  aria-pressed={tierOf(chosen()).level === level}
                                  disabled={!!pending() || (chosen().tier?.by === "you" && chosen().tier?.level === level)}
                                  title={CREATURE_TIERS[level].use}
                                  onClick={() => chooseTier(chosen().key, level)}
                                >
                                  {CREATURE_TIERS[level].label}
                                </button>
                              )}
                            </For>
                          </div>
                          <small class="pa-tier-reason">{chosen().tier ? (chosen().tier!.by === "you" ? PERSON_TIER_REASON : chosen().tier!.reason) : "没有定档位，按「标准」做。"}</small>
                          <small class="pa-tier-reason pa-tier-asks">{tierAsksBrief(tierOf(chosen()).level)}</small>
                        </div>
                      )
                    })()}
                  </Show>
                  <div class="pa-edit-actions">
                    <Button primary disabled={!changed() || !!pending() || editMoved()} onClick={saveEdit}>
                      保存修改
                    </Button>
                    <Button disabled={!!pending()} onClick={() => remove(item())}>
                      不做这个了
                    </Button>
                  </div>
                </Show>
                <Show when={item().status !== "out_of_scope"}>
                  <section class="pa-part-block">
                    <h4>它走到哪一步了</h4>
                    <ul class="pa-facts">
                      <For each={facts(item())}>
                        {(fact) => (
                          <li data-state={fact.state}>
                            <i aria-hidden="true" />
                            <span>{fact.label}</span>
                            <strong>{fact.value}</strong>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>
                <div class="pa-relations">
                  {related("它用到了", item().needs)}
                  {related("谁在用它", item().used_by)}
                  {related(
                    "还有这些也是它的",
                    parts(item())
                      .map((part) => part.id)
                      .filter((part) => !item().needs.includes(part) && !item().used_by.includes(part)),
                  )}
                </div>
                <Show when={!item().needs.length && !item().used_by.length && !parts(item()).length && item().status !== "out_of_scope"}>
                  <p class="pa-hint">它没有和别的东西连在一起。</p>
                </Show>
                <Show when={advanced()}>
                  <dl class="pa-tech">
                    <dt>种类</dt>
                    <dd>
                      {item().kind} · {kindOf(item())?.capability}
                    </dd>
                    <dt>状态</dt>
                    <dd>{item().status}</dd>
                    <dt>蓝图里的标识</dt>
                    <dd>{item().key ?? "—"}</dd>
                    <dt>这样东西的 ID</dt>
                    <dd>{item().asset_id ?? "—"}</dd>
                    <dt>这样东西的版本</dt>
                    <dd>{item().revision ?? "—"}</dd>
                  </dl>
                </Show>
              </div>
            </div>
            <div class="pa-story-page" hidden={!onStory()}>
            <Show when={onStory() && item().asset_id}>
              <MakingHistory
                projectId={props.projectId}
                project={props.project}
                item={item()}
                assetId={item().asset_id!}
                making={makingOf(item())}
                locked={makingLock(item(), "等这一次做完再回到旧版或者交批注。") || (reviewing() ? "蓝图还开着。先确认蓝图，再来改。" : "")}
                advanced={advanced()}
                external={!!props.external}
                onChanged={() => {
                  props.onChanged?.()
                  void load()
                }}
                onHanded={() => setTold(false)}
                onSaid={setJudged}
                onError={setError}
                onAsk={setAsk}
                onDirty={notesChanged}
                onBar={setHistoryBar}
              />
            </Show>
            <Show when={story()}>
              {(record) => (
                <MakingStory
                  projectId={props.projectId}
                  kind={item().kind}
                  play={<MotionPlay projectId={props.projectId} project={props.project} item={item()} />}
                  making={record()}
                  events={logged().filter((event) => event.item === item().id)}
                  locked={makingLock(item(), LOCK_THEN.notes) || (reviewing() ? "蓝图还开着。先确认蓝图，再来改这份说明。" : "")}
                  busy={!!pending()}
                  promise={promise(item())}
                  saved={sheetsSaved()}
                  onSave={(sheet, redo) => saveSheet(item(), sheet, redo)}
                  onRedo={(remark) =>
                    setAsk({
                      title: `按这份说明重做「${item().title}」？`,
                      lines: [promise(item()), ...(item().facts.saved ? ["现在这一版会记成「要改」。"] : [])],
                      names: [],
                      actions: [{ label: "重做", primary: true, run: () => act("redo", () => returned(item(), remark)) }],
                    })
                  }
                />
              )}
            </Show>
            </div>
            {errorBar()}
            <Show when={!reviewing() && item().status !== "out_of_scope"}>
              <footer class="pa-verdict" data-status={item().status}>
                <Show
                  when={!remark()}
                  fallback={
                    <div class="pa-redo">
                      <label for="pa-redo-words">{remark() === "retry" ? "想提醒 AI 什么？不写也可以。" : "哪里不满意？想改成什么样？"}</label>
                      <Show when={remark() === "change"}>
                        <div class="pa-ideas" role="group" aria-label="可以直接点的说法">
                          <For each={remarkIdeas(item().kind)}>
                            {(idea) => (
                              <button
                                type="button"
                                disabled={!!pending() || feedback().includes(idea)}
                                onClick={() => {
                                  setFeedback(`${feedback().trim()}${feedback().trim() ? "，" : ""}${idea}`.slice(0, REMARK))
                                  document.querySelector<HTMLTextAreaElement>("#pa-redo-words")?.focus()
                                }}
                              >
                                {idea}
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                      <textarea
                        id="pa-redo-words"
                        class="pa-input"
                        rows={2}
                        maxLength={REMARK}
                        placeholder={remark() === "retry" ? "比如：这次画简单一点" : "用自己的话说就行，比如：头太大了，颜色再暗一点"}
                        value={feedback()}
                        disabled={!!pending()}
                        ref={(element) => queueMicrotask(() => element.focus())}
                        onInput={(event) => setFeedback(event.currentTarget.value)}
                        onKeyDown={(event) => type(event, () => sendBack(item(), feedback()))}
                      />
                      <p class="pa-redo-plan">
                        <span>{promise(item())}</span>
                        <small classList={{ full: feedback().length >= REMARK }}>
                          {feedback().length} / {REMARK}
                        </small>
                      </p>
                      <div class="pa-redo-actions">
                        <Button primary class="pa-big" disabled={!!pending() || (remark() === "change" && !feedback().trim())} onClick={() => sendBack(item(), feedback())}>
                          {pending() === "redo" ? "正在交给 AI…" : remark() === "retry" ? "再试一次" : ownAi() ? "就这样，让 AI 重做" : "就这样，记下来"}
                        </Button>
                        <Button disabled={!!pending()} onClick={() => setRemark(null)}>
                          算了
                        </Button>
                      </div>
                    </div>
                  }
                >
                  <div class="pa-verdict-main">
                    <Show when={onStory() && historyBar()}>
                      {(bar) => (
                        <div class="pa-history-actions">
                          <Show when={bar().restore}>
                            {(restore) => (
                              <span class="pa-history-restore">
                                <Button class="pa-big" disabled={restore().disabled} onClick={restore().run}>
                                  {restore().label}
                                </Button>
                                <small>{restore().hint}</small>
                              </span>
                            )}
                          </Show>
                          <Show when={bar().hand}>
                            {(hand) => (
                              <span class="pa-history-restore" title={hand().why || undefined}>
                                <Button class="pa-big" disabled={hand().disabled} onClick={hand().run}>
                                  {hand().label}
                                </Button>
                                <Show when={hand().why}>
                                  <small>{hand().why}</small>
                                </Show>
                              </span>
                            )}
                          </Show>
                        </div>
                      )}
                    </Show>
                    <Show when={item().status === "review" && judgeable(item())}>
                      <span class="pa-verdict-ask">看完了吗？这一样可以吗？</span>
                      <Button primary class="pa-big" disabled={!!pending()} onClick={() => accept(item())}>
                        <Icon name="check" />
                        验收通过
                      </Button>
                      <Button class="pa-big" disabled={!!pending()} onClick={() => setRemark("change")}>
                        退回重做
                      </Button>
                    </Show>
                    <Show when={item().status === "making" && item().queued}>
                      <span class="pa-verdict-ask">{queueWords(item())}。轮到它做好以后，才能在这里验收。</span>
                    </Show>
                    <Show when={item().status === "making" && !item().queued}>
                      <span class="pa-verdict-ask">
                        {item().facts.saved ? "AI 正在按你说的重做这一样，别的不动。做好以后会换成新的样子，再请你看一遍。" : "AI 正在做它。做好以后，就能在这里验收。"}
                      </span>
                    </Show>
                    <Show when={item().status === "redo"}>
                      <span class="pa-verdict-ask" role="status">
                        {redoStanding(redoWho(), item().facts.saved)}
                      </span>
                      <Show when={props.external}>
                        <Button
                          primary
                          disabled={!!pending()}
                          onClick={() =>
                            act("copy", async () => {
                              await window.studio.copyText({ text: redoSentence(props.projectName, item()) })
                              setTold(true)
                            })
                          }
                        >
                          <Icon name="copy" />
                          {told() ? "已复制，再复制一次" : "复制这句话给我的 AI"}
                        </Button>
                      </Show>
                      <Show when={ownAi() && !running()}>
                        <Button primary class="pa-big" disabled={!!pending()} onClick={() => again(item())}>
                          {item().facts.saved ? "让 AI 现在重做" : "现在就再试一次"}
                        </Button>
                      </Show>
                      <Button disabled={!!pending()} onClick={() => setRemark(item().facts.saved ? "change" : "retry")}>
                        换个说法
                      </Button>
                    </Show>
                    <Show when={item().status === "failed"}>
                      <span class="pa-verdict-ask">这一样没做成，所以还没有东西可以验收。</span>
                      <Show
                        when={props.external || props.aiConfigured}
                        fallback={<Button onClick={props.onSettings}>连接 AI</Button>}
                      >
                        <Button primary class="pa-big" disabled={!!pending()} onClick={() => sendBack(item(), "")}>
                          只是再试一次
                        </Button>
                        <Button class="pa-big" disabled={!!pending()} onClick={() => setRemark("retry")}>
                          提醒 AI 一句再试
                        </Button>
                      </Show>
                    </Show>
                    <Show when={item().facts.accepted === true && !["making", "redo", "review"].includes(item().status)}>
                      <span class="pa-verdict-ask done">
                        <Icon name="check" />
                        你验收通过了
                      </span>
                      <Show when={judgeable(item())}>
                        <Button disabled={!!pending()} onClick={() => setRemark("change")}>
                          又想改了
                        </Button>
                      </Show>
                    </Show>
                    <Show when={item().facts.saved && item().facts.accepted === null && !["review", "making", "redo", "failed"].includes(item().status)}>
                      <span class="pa-verdict-ask">{!item().asset_id ? "这是以前就有的东西，不用验收。想改就点「打开它」。" : "这样东西没有在等你验收：它不是照你确认过的蓝图做的，也不是按你的意见改的，或者做好以后又改过。"}</span>
                      <Show when={judgeable(item())}>
                        {/* 「通过」 is the answer to a question: it is here only when the thing is waiting for it (above) or the page asks the person whether what it uses still fits (the stale note). */}
                        <Show when={acceptOffered(item(), problemsOf(item().id))}>
                          <Button disabled={!!pending()} onClick={() => accept(item())}>
                            <Icon name="check" />
                            验收通过
                          </Button>
                        </Show>
                        <Button disabled={!!pending()} onClick={() => setRemark("change")}>
                          想让 AI 改一改
                        </Button>
                      </Show>
                    </Show>
                    <Show when={!item().facts.saved && ["planned", "blocked"].includes(item().status)}>
                      <span class="pa-verdict-ask">做出来以后，就能在这里验收它。</span>
                    </Show>
                    <Show when={item().review && item().asset_id && item().status !== "making"}>
                      <button type="button" class="pa-link" disabled={!!pending()} onClick={() => takeBack(item())}>
                        撤回我的意见
                      </button>
                    </Show>
                  </div>
                </Show>
                <div class="pa-walk">
                  <Show
                    when={place() >= 0 && trail().length === 1}
                    fallback={
                      <Show when={awaiting().filter((value) => value.id !== item().id).length}>
                        <span class="pa-left">还有 {awaiting().filter((value) => value.id !== item().id).length} 样等你验收</span>
                        <Button onClick={review}>
                          去验收
                          <Icon name="arrow" />
                        </Button>
                      </Show>
                    }
                  >
                    <Button disabled={place() === 0} onClick={() => step(-1)}>
                      上一样
                    </Button>
                    <span class="pa-left">
                      本轮第 {place() + 1} 样
                    </span>
                    <Button onClick={() => step(1)}>
                      {place() === flow()!.ids.length - 1 ? "看完了" : "下一样"}
                      <Icon name="arrow" />
                    </Button>
                    <Show when={!remark()}>
                      <span class="pa-keys">键盘 ← → 换一样{item().status === "review" && judgeable(item()) ? "，回车 = 通过" : ""}</span>
                    </Show>
                  </Show>
                  <span class="pa-moves-gap" />
                  <Show when={judged()}>
                    <span class="pa-left done" role="status">
                      {judged()}
                    </span>
                  </Show>
                  <Show when={props.editor(item())}>
                    {(run) => (
                      <Button onClick={() => { const edit = run(); props.onDismiss?.(); edit() }}>
                        打开它
                        <Icon name="arrow" />
                      </Button>
                    )}
                  </Show>
                </div>
              </footer>
            </Show>
          </CardShell>
          )
        }}
      </Show>
      <Show when={receiptOpen()}>
        <ReceiptBook
          projectId={props.projectId}
          projectName={props.projectName}
          slot={(id, onOpen) => {
            const item = byId().get(id)
            return item ? <AssetSlot item={item} kind={kindOf(item)} small picture={picture(item)} words={item.kind === "logic" && item.preview.source ? ruleCaption(props.project, item) : null} onOpen={onOpen} /> : null
          }}
          onClose={() => setReceiptOpen(false)}
        />
      </Show>
      <Show when={finished()}>
        {(walk) => (
          <div class="pa-veil" onClick={(event) => event.target === event.currentTarget && setFinished(null)}>
            <div class="pa-card pa-ask pa-end mc-window" role="dialog" aria-modal="true" aria-label={WALK_WORDS.done(walk().ids.length)}>
              <header class="pa-card-head">
                <StatusMark status="saved" label={WALK_WORDS.done(walk().ids.length)} />
                <strong>{WALK_WORDS.done(walk().ids.length)}</strong>
              </header>
              <ul class="pa-tally">
                <li data-state="yes">
                  <i aria-hidden="true" />
                  <span>通过</span>
                  <strong>{Object.values(walk().verdicts).filter((value) => value === "accepted").length} 样</strong>
                </li>
                <li data-state="no">
                  <i aria-hidden="true" />
                  <span>要改</span>
                  <strong>{Object.values(walk().verdicts).filter((value) => value === "rejected").length} 样</strong>
                </li>
                <li data-state="none">
                  <i aria-hidden="true" />
                  <span>还没表态</span>
                  <strong>{walk().ids.filter((id) => byId().get(id)?.status === "review").length} 样</strong>
                </li>
              </ul>
              <Show when={Object.values(walk().verdicts).includes("rejected")}>
                <p>
                  {redoAfterWalk(redoWho())}
                </p>
              </Show>
              <Show when={!overview()?.build_failure && !awaiting().length && !production()?.to_redo && !running() && production()?.done === production()?.total}>
                {/* "You looked at all of them" is said only when something asked for the person's answer and every such version has one. */}
                <p>
                  {made().some((item) => item.review_asked) && !made().some((item) => item.review_asked && item.facts.accepted === null)
                    ? "每一样都做好了，你也都看过了。"
                    : "每一样都做好了。"}
                  {production()?.built === production()?.total ? "下一步是进游戏里看。" : "下一步是把它们做进模组，进游戏里看。"}
                </p>
              </Show>
              {/* The batch is over, the project may not be: what is still open is counted from the overview, not from the batch. */}
              <Show when={production() && leftWords(production()!).length}>
                <p>{WALK_WORDS.left(leftWords(production()!))}</p>
              </Show>
              <div class="pa-ask-actions">
                <Show when={awaiting().length}>
                  <Button primary onClick={review}>
                    接着看剩下的
                    <Icon name="arrow" />
                  </Button>
                </Show>
                <Show when={!awaiting().length && !production()?.to_redo && !running() && production()?.saved === production()?.total && props.onBuild}>
                  <Button
                    primary
                    onClick={() => {
                      setFinished(null)
                      props.onBuild?.()
                    }}
                  >
                    <Icon name="play" />
                    构建并试玩
                  </Button>
                </Show>
                <Button onClick={() => setFinished(null)}>回工程总览</Button>
              </div>
            </div>
          </div>
        )}
      </Show>
      <Show when={ask()}>
        {(box) => (
          <div class="pa-veil top" onClick={(event) => event.target === event.currentTarget && setAsk(null)}>
            <div class="pa-card pa-ask mc-window" role="alertdialog" aria-modal="true" aria-label={box().title}>
              <header class="pa-card-head">
                <strong>{box().title}</strong>
              </header>
              <For each={box().lines}>{(line) => <p>{line}</p>}</For>
              <Show when={box().names.length}>
                <ul class="pa-names mc-well">
                  <For each={box().names}>{(name) => <li>{name}</li>}</For>
                </ul>
              </Show>
              <div class="pa-ask-actions">
                <For each={box().actions}>
                  {(action) => (
                    <Button
                      primary={action.primary}
                      onClick={() => {
                        setAsk(null)
                        action.run()
                      }}
                    >
                      {action.label}
                    </Button>
                  )}
                </For>
                <Button onClick={() => setAsk(null)}>先留着</Button>
              </div>
            </div>
          </div>
        )}
      </Show>
      <Show when={tip()}>
        {(value) => (
          <div
            class="pa-tip mc-tooltip"
            style={{
              left: `${Math.min(value().x + 16, window.innerWidth - 280)}px`,
              top: `${Math.min(value().y + 12, window.innerHeight - 100)}px`,
            }}
          >
            <strong>{value().item.title}</strong>
            <span>
              {kindOf(value().item)?.label} · {value().item.status_label}
            </span>
            <Show when={value().item.reason ?? value().item.out_of_scope}>
              <span>{(value().item.reason ?? value().item.out_of_scope)!.slice(0, 60)}</span>
            </Show>
            <Show when={advanced()}>
              <span>{value().item.key ?? value().item.asset_id ?? value().item.id}</span>
            </Show>
          </div>
        )}
      </Show>
    </section>
  )
}

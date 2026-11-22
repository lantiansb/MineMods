import { createEffect, createMemo, createSignal, For, Index, on, onCleanup, Show, type JSX } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Button, Icon } from "../ui"
import type { Picture } from "./asset-picture"
import { DEFAULT_TIER, GEOMETRY_TIERS, tierNamed } from "@minemods/studio-ai/budget"
import { comparedName, FINDING_LABELS, justifiedName, MOTION_WORDS, OUTSIDE_WORDS, OVERLAY_LEGEND, REFERENCE_LIMITS, REFERENCE_NOTE, REFERENCE_REFUSALS, showsOverlay, UNSATISFIED } from "@minemods/studio-ai/making"
import type { ActivityEvent, Making, MakingRound, PartSheet, ReferenceImage } from "../../api"
import { advanced } from "../advanced"
import { isIdentifier, motionTitle, partDetail, partTitle, plainNames } from "./asset-words"
import { floorShown, openFloor } from "./making-floor-link"
import { dropZone, PASTED_NAME, PICTURE_ACCEPT, PictureZoom, pastedPictures, pictureFiles, pictureRefusal, plainFailure, readPicture } from "./picture-input"
import { besidesThreeView, wantsThreeView } from "./three-view-model"
import { ThreeViewBlock } from "./three-view"
import { roundVerdict } from "./making-floor-model"
import { roundsExplained } from "./production-words"
import { cellOffset, choose, isViewSheet, roundBefore, sharedSheets, sheetOf as exactSheet, SHEET_VIEWS } from "./making-compare"
import "./asset-making.css"
import { Fold } from "../fold"
import { SaidLines } from "./play-text"
import { zoomedRound, type StoryZoom } from "./story-zoom"

type Part = PartSheet["parts"][number]
/** A place on the filmstrip: a round by its number, or what came after the last one. */
type Stop = number | "end"

const details = [
  { key: "shape", label: "形状" },
  { key: "attaches", label: "接在哪" },
  { key: "surface", label: "表面" },
  { key: "moves", label: "怎么动" },
] as const
// The same two pixel shapes the status marks use for "fine" and "not fine".
const pixels = (rows: string[]) => rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "1" ? [`M${x} ${y}h1v1h-1z`] : []))).join("")
const tick = pixels(["0000000", "0000001", "0000011", "1000110", "1101100", "0111000", "0010000"])
const cross = pixels(["1100011", "1110111", "0111110", "0011100", "0111110", "1110111", "1100011"])

/** A round in small: the single view drawn for that, or (in records from before one was drawn) its first sheet whole. */
const coverOf = (round: MakingRound) => round.cover ?? round.pictures[0]?.url ?? ""
function Thumb(props: { url: string }) {
  return <img src={props.url} alt="" draggable={false} onLoad={crisp} />
}

const when = (at: string) => new Date(at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
// A picture smaller than its frame is pixel art being enlarged: it must stay sharp squares.
const crisp = (event: Event & { currentTarget: HTMLImageElement }) =>
  event.currentTarget.classList.toggle("pixel", event.currentTarget.naturalWidth < event.currentTarget.clientWidth)

/** Saved although its AI was not satisfied: the loop ended without a pass and the best version was handed to the person. */
export const makingKept = (making: Making | null | undefined) => making?.outcome === "kept_unsatisfied"
/** Saved because the making was cut short (the app closed, the connection broke): the best version before that was handed to the person. Nobody judged it wanting. */
export const makingInterrupted = (making: Making | null | undefined) => making?.outcome === "kept_interrupted"
/** Either way a version was saved without a pass, for the person to judge. */
const makingHanded = (making: Making | null | undefined) => makingKept(making) || makingInterrupted(making)
/** Said of a version saved because its making was cut short. Never a judgement of the work. */
export const INTERRUPTED = { mark: "被中断了", words: "制作被中断了，先把中断前最好的一版交给你" } as const
const handedWords = (making: Making) => (makingInterrupted(making) ? INTERRUPTED : UNSATISFIED)

/**
 * Why a making that saved nothing stopped. A record that names no reason, did not use up its versions and
 * was not recorded as failed was cut short or called off, which says nothing about the work; only running
 * out of versions or failing the last review is "did not pass".
 */
export function makingHalt(making: Making): NonNullable<Making["stopped_reason"]> {
  if (making.stopped_reason) return making.stopped_reason
  // Records from before the reason was written down: every version used and the last one judged means it ran out.
  const last = making.rounds.at(-1)
  if (making.rounds.length >= making.rounds_allowed && last?.self_review) return making.review && !making.review.passed && (making.review.round ?? last.round) === last.round ? "review" : "rounds"
  return making.outcome === "failed" ? "failed" : "interrupted"
}
const HALT_WORDS: Record<NonNullable<Making["stopped_reason"]>, { mark: string; head: string; line: (making: Making) => string }> = {
  interrupted: { mark: "中断了", head: "制作被中断了，没有做完", line: (making) => `做到第 ${making.rounds.length || 1} 轮时被中断了，没有做完` },
  rounds: { mark: "轮数用完", head: "轮数用完了，没有一版通过", line: (making) => `做满了 ${making.rounds.length} 轮，没有一版通过` },
  review: { mark: "没通过", head: "最后一次审查没通过，轮数也用完了", line: (making) => `做满了 ${making.rounds.length} 轮，最后一次审查没通过` },
  gave_up: { mark: "停下了", head: "做它的 AI 自己停下了", line: (making) => `做到第 ${making.rounds.length || 1} 轮，做它的 AI 自己停下了` },
  failed: { mark: "没做成", head: "中途出了问题，没有做成", line: (making) => `做到第 ${making.rounds.length || 1} 轮时出了问题，没有做成` },
}
/** The version a review was of. Records from before reviews said which were always of the last round. */
const reviewedRound = (making: Making) => (making.review ? (making.review.round === undefined ? making.rounds.at(-1) : making.rounds.find((round) => round.round === making.review!.round)) : undefined)
/** Who a picture was drawn for, as a heading over its group. */
const drawnFor = { review: "交给审查看的", asked: "审查时另外要看的", look: "AI 做的时候看的" } as const

/** Still being worked on, so worth reading again. */
export const makingLive = (making: Making | null | undefined) => !!making && making.state !== "done" && making.state !== "stopped"

/**
 * A picture's label as the person reads it. The picture itself also carries the name a motion has in the
 * document (「走路（walk）」), which an AI needs to ask for it and a person does not: left out here.
 */
export const plainLabel = (label: string | undefined) => (label ?? "").replace(/（[A-Za-z][A-Za-z0-9_]*）/g, "")

/** The round in hand: the newest one while the AI still looks at it, the one after it once it has said what to change. */
export function roundNow(making: Making) {
  const last = making.rounds.at(-1)
  if (!last) return 1
  if (making.state !== "making" || last.self_review?.verdict !== "revise") return last.round
  return Math.min(last.round + 1, Math.max(making.rounds_allowed, last.round))
}

/** A few characters for the corner of a slot while the thing is being made. */
export function makingBadge(making: Making | null | undefined, short = false) {
  if (!making || !makingLive(making)) return null
  // Taken and not touched: it waits, it is not being written (`Making.idle`).
  if (making.idle) return short ? "排队" : "还没动手"
  if (making.state === "describing") return short ? "说明" : "写说明"
  // 验收 is the person's word for their own yes or no; what the AI side does at this point is a check, by another AI or by the maker itself.
  if (making.state === "reviewing") return short ? "检查" : "检查中"
  return short ? `${roundNow(making)} / ${making.rounds_allowed}` : `第 ${roundNow(making)} / ${making.rounds_allowed} 轮`
}

/** The newest picture the loop has of a thing, for its slot while it is being made. */
export function makingPicture(making: Making | null | undefined): Picture | null {
  const round = making?.rounds.filter((value) => value.pictures.length).at(-1)
  return round ? { key: `making:${making!.item_id}:${round.round}:${round.at}`, pixel: false, load: () => Promise.resolve(coverOf(round)) } : null
}

/** The whole story in a few words. */
export function makingLine(making: Making) {
  if (making.idle) return "领了任务，还没动手"
  if (making.state === "describing") return "正在写部件说明"
  if (making.state === "making") return `正在做第 ${roundNow(making)} / ${making.rounds_allowed} 轮`
  if (making.state === "reviewing") return `做了 ${making.rounds.length} 轮，正在检查`
  if (makingInterrupted(making)) return `做了 ${making.rounds.length} 轮，制作被中断了；中断前最好的第 ${making.kept_round ?? making.rounds.length} 轮那一版已经存下来，还没有做完审查`
  if (makingKept(making)) return `做了 ${making.rounds.length} 轮，没做到审查通过；留给你的是第 ${making.kept_round ?? making.rounds.length} 轮那一版`
  if (making.state === "stopped") return HALT_WORDS[makingHalt(making)].line(making)
  if (!making.review) return `做了 ${making.rounds.length} 轮`
  return `做了 ${making.rounds.length} 轮，${making.review.independent ? "另一位 AI 审查" : "它自己检查"}${making.review.passed ? "通过" : "没通过"}`
}

/** On the card's first page: the rounds as a row of small pictures and the outcome, leading to the full story. A kept version says why its AI was not satisfied. */
export function MakingTeaser(props: { making: Making; asked: boolean; onOpen: () => void }) {
  return (
    <button type="button" class="mk-teaser" data-state={props.making.state} data-passed={props.making.review?.passed} data-kept={makingHanded(props.making)} onClick={() => props.onOpen()}>
      <span class="mk-teaser-film">
        <For each={props.making.rounds.filter((round) => round.pictures.length).slice(-4)}>{(round) => <Thumb url={coverOf(round)} />}</For>
      </span>
      <span class="mk-teaser-words">
        <strong>{makingHanded(props.making) ? handedWords(props.making).words : "它是怎么做出来的"}</strong>
        <small>AI {makingLine(props.making)}</small>
        <Show when={makingHanded(props.making)}>
          <ul class="mk-why">
            <SaidLines lines={(props.making.kept_reason ?? []).slice(0, 3)} advanced={advanced()} />
          </ul>
          <Show when={props.asked}>
            <small>可不可以，还是你说了算：觉得行就点「验收通过」，不行就点「退回重做」。</small>
          </Show>
        </Show>
      </span>
      <em>
        看制作过程
        <Icon name="arrow" />
      </em>
    </button>
  )
}

/**
 * The reference images of one overview item: what the person attached for the AI to go by, and any views
 * an AI drew of what it meant to make (marked as AI-drawn). The person adds with the file picker, by
 * dropping files on it, or by pasting; and removes any of them. Usable wherever an item is shown, also
 * before anything has been made of it. `listed` is the item's `Making.references`: when it changes, the
 * pictures are read again. `locked` says why nothing can be changed right now; empty when it can.
 */
export function ReferenceTray(props: { projectId: string; itemId: string; listed?: { id: string }[]; locked: string }) {
  let input!: HTMLInputElement
  const [held, setHeld] = createSignal<ReferenceImage[]>([])
  const [wrong, setWrong] = createSignal("")
  const [working, setWorking] = createSignal(false)
  const [over, setOver] = createSignal(false)
  const [large, setLarge] = createSignal<ReferenceImage | null>(null)
  // The three-view has a block of its own above this one: it is never listed twice.
  const shown = () => besidesThreeView(held())
  const own = () => held().filter((value) => value.kind === "user")
  const full = () => own().length >= REFERENCE_LIMITS.user
  const closed = () => !!props.locked.trim() || working()

  // Read again whenever the item changes or the record says the list did (an AI handed in its views).
  const listedOf = createMemo(() => `${props.projectId}:${props.itemId}:${(props.listed ?? []).map((value) => value.id).join(",")}`)
  createEffect(
    on(
      listedOf,
      () => {
        const asked = props.itemId
        void window.studio.getReferences({ projectId: props.projectId, itemId: asked }).then(
          (list) => asked === props.itemId && setHeld(list),
          () => undefined,
        )
      },
    ),
  )
  createEffect(on(() => props.itemId, () => (setWrong(""), setLarge(null)), { defer: true }))

  /** One file after another, so the count is checked against what is really there; the first refusal stops the rest and is said. */
  const add = async (files: File[]) => {
    const pictures = pictureFiles(files)
    if (!pictures.length || closed()) return
    setWrong("")
    setWorking(true)
    await pictures
      .reduce(async (before, file) => {
        await before
        if (pictureRefusal(file)) throw new Error(pictureRefusal(file))
        if (own().length >= REFERENCE_LIMITS.user) throw new Error(REFERENCE_REFUSALS.too_many("user"))
        setHeld(await window.studio.addReference({ projectId: props.projectId, itemId: props.itemId, name: file.name || PASTED_NAME, url: await readPicture(file) }))
      }, Promise.resolve())
      .catch((error: unknown) => setWrong(plainFailure(error, "这张图没有加上。")))
    setWorking(false)
  }
  const remove = async (reference: ReferenceImage) => {
    if (closed()) return
    setWrong("")
    setWorking(true)
    await window.studio.removeReference({ projectId: props.projectId, itemId: props.itemId, referenceId: reference.id }).then(setHeld, () => setWrong("这张图没有去掉，再试一次。"))
    setWorking(false)
  }
  // A picture on the clipboard is added wherever the person is, unless they are typing in a field or the
  // 六视图 block above took it (the person was pointing at it).
  const pasted = (event: ClipboardEvent) => {
    if (event.defaultPrevented) return
    const files = pastedPictures(event)
    if (!files.length) return
    event.preventDefault()
    void add(files)
  }
  window.addEventListener("paste", pasted)
  onCleanup(() => window.removeEventListener("paste", pasted))
  const zone = dropZone({ closed, over: setOver, files: (files) => void add(files) })

  return (
    <section
      class="mk-refs"
      aria-label="参考图"
      data-over={over()}
      onDragOver={zone.onDragOver}
      onDragLeave={zone.onDragLeave}
      onDrop={zone.onDrop}
    >
      <h5>
        参考图<small>{shown().length ? "AI 做和审查的时候，都会对照着它看" : "有想要的样子？放一张图，AI 会照着它的形状和风格做"}</small>
      </h5>
      <ul class="mk-ref-list">
        <For each={shown()}>
          {(reference) => (
            <li data-kind={reference.kind}>
              <button type="button" class="mk-ref mc-well" title={`点一下放大看：${reference.name}`} aria-label={`放大看：${reference.kind === "concept" ? "AI 画的构想图" : "你给的参考图"} ${reference.name}`} onClick={() => setLarge(reference)}>
                <img src={reference.url} alt="" draggable={false} />
              </button>
              <Show when={reference.kind === "concept"}>
                <em class="mk-ai" title="这张不是你给的：是 AI 动手之前画的、它打算做成的样子">
                  AI 画的
                </em>
              </Show>
              <button type="button" class="pa-mini mk-ref-drop" aria-label={`去掉这张：${reference.name}`} title="去掉这张" disabled={closed()} onClick={() => void remove(reference)}>
                <Icon name="close" />
              </button>
            </li>
          )}
        </For>
        <li class="mk-ref-add">
          <button type="button" class="mk-ref mc-well" disabled={closed() || full()} title={full() ? REFERENCE_REFUSALS.too_many("user") : `选一张图（最多 ${REFERENCE_LIMITS.user} 张，PNG、JPEG、WebP，每张不超过 ${REFERENCE_LIMITS.bytes / 1024 / 1024} MB）`} onClick={() => input.click()}>
            <b aria-hidden="true">+</b>
            <span>{working() ? "正在加…" : full() ? "放满了" : "加一张"}</span>
          </button>
        </li>
      </ul>
      <input
        ref={input}
        type="file"
        accept={PICTURE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          void add([...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ""
        }}
      />
      <Show when={wrong()}>
        <p class="mk-honest" role="alert">
          {wrong()}
        </p>
      </Show>
      <p class="pa-hint" title={`最多 ${REFERENCE_LIMITS.user} 张，PNG、JPEG、WebP，每张不超过 ${REFERENCE_LIMITS.bytes / 1024 / 1024} MB。`}>
        点「加一张」、把图拖进来，或者直接粘贴。{REFERENCE_NOTE}
        <Show when={shown().length}>换了图以后，点下面的「按这份说明重做」，AI 会带着图重新做。</Show>
      </p>
      <Show when={large()}>
        {(reference) => <PictureZoom label="参考图" title={`${reference().kind === "concept" ? "AI 画的构想图" : "你给的参考图"} · ${reference().name}`} url={reference().url} alt={reference().name} onClose={() => setLarge(null)} />}
      </Show>
    </section>
  )
}

/**
 * How one thing was made, for someone who was not there: what the AI set out to make (the part sheet),
 * each round's pictures with what it thought of them, and the final review. Pictures only, never a live
 * 3D view. The sheet can be corrected in plain fields and the thing sent back to be made from it.
 */
export function MakingStory(props: {
  making: Making
  /** Why the sheet cannot be changed or sent back right now; empty when it can. */
  locked: string
  busy: boolean
  /** What sending it back will do, said before it is done. */
  promise: string
  /** Counts the sheets saved, so the form knows when to close. */
  saved: number
  onSave: (sheet: PartSheet, redo: string | null) => void
  onRedo: (remark: string) => void
  /** What the activity log says of this thing, when the page showing the story has it: reviews of earlier versions are only there (`roundReviews`). */
  events?: readonly ActivityEvent[]
  /** The open project. With it the sheet shows this thing's reference images and lets the person add or remove them; without it that part is left out. */
  projectId?: string
  /** The thing's kind (`OverviewItem.kind`): a model also shows its 六视图 above the reference images. */
  kind?: string
  /**
   * Where nothing is changed (制作现场), the sheet folds to one line above the rounds, so the pictures get the width (broad20: the sheet took a third of a
   * 1280-wide window there while the picture under review was a stamp).
   */
  sheetFolded?: boolean
  /** The entry that plays this thing's motions (`MotionPlay`), when it has any: one place, under the status line. */
  play?: JSX.Element
  /** The person opened a round or a large picture: whatever page follows the newest thing (制作现场) stays on this one until they go back to it themselves. */
  onHold?: () => void
}) {
  let sheetHost!: HTMLElement
  const [picked, setPickedRaw] = createSignal<Stop | null>(null)
  const setPicked = (value: Stop | null) => {
    setPickedRaw(value)
    if (value !== null) props.onHold?.()
  }
  const [angle, setAngle] = createSignal("")
  const [compare, setCompare] = createSignal(false)
  // 和上一轮对比: which cell of the six-view sheet both rounds show; null is the whole sheet.
  const [cell, setCell] = createSignal<number | null>(null)
  // The picture shown large: which round, and which of its sheets. It stays while the record is read again and goes only with its round (`zoomedRound`).
  const [zoom, setZoomRaw] = createSignal<StoryZoom | null>(null)
  const setZoom = (value: StoryZoom | null) => {
    setZoomRaw(value)
    if (value) props.onHold?.()
  }
  const [open, setOpen] = createSignal<string[]>([])
  const [editing, setEditing] = createSignal(false)
  const [more, setMore] = createSignal<number[]>([])
  // A block or an item set among the game's own: drawn when asked for and held only here, never stored (it holds the game's own pictures).
  const [beside, setBeside] = createSignal<{ state: "drawing" | "none" } | { state: "shown"; label: string; url: string } | null>(null)
  const [besideLarge, setBesideLarge] = createSignal(false)
  createEffect(on(() => props.making.asset_id, () => (setBeside(null), setBesideLarge(false)), { defer: true }))
  const lookBeside = (projectId: string, assetId: string) => {
    setBeside({ state: "drawing" })
    void window.studio.lookBeside({ projectId, assetId }).then(
      (picture) => setBeside(picture ? { state: "shown", ...picture } : { state: "none" }),
      () => setBeside({ state: "none" }),
    )
  }
  const [form, setForm] = createStore<PartSheet>({ subject: "", recognisable: [], parts: [], assumed: [], remark: null })

  const rounds = () => props.making.rounds
  // One wording for a round wherever it is shown; see `roundVerdict`.
  const verdict = (round: MakingRound) => roundVerdict(props.making, round, props.events ?? [])
  const plainLine = (line: string) => plainNames(line, props.making.sheet?.parts, advanced())
  // A version saved without a pass, whichever way: not satisfied, or cut short.
  const keptOne = () => makingHanded(props.making)
  const cut = () => makingInterrupted(props.making)
  const halt = () => HALT_WORDS[makingHalt(props.making)]
  const ended = () => !!props.making.review || props.making.state === "reviewing" || props.making.state === "stopped" || keptOne()
  // What the last page shows a picture of: the version handed to the person when one was kept, else the version that was
  // reviewed (never a later one), else the last.
  const reviewed = () => reviewedRound(props.making)
  const final = () => (keptOne() ? rounds().find((round) => round.round === props.making.kept_round) : undefined) ?? reviewed() ?? rounds().at(-1)
  // The last version was made after the review and never reviewed itself.
  const unreviewed = () => (reviewed() && rounds().at(-1)!.round > reviewed()!.round ? rounds().at(-1) : undefined)
  // Nothing picked follows the newest thing that happened, so a story being written is read as it grows.
  const stop = (): Stop | null => {
    const chosen = picked()
    if (chosen === "end" && ended()) return "end"
    if (typeof chosen === "number" && rounds().some((round) => round.round === chosen)) return chosen
    if (ended()) return "end"
    return rounds().at(-1)?.round ?? null
  }
  const shown = () => (stop() === "end" ? final() : rounds().find((round) => round.round === stop()))
  // The nearest earlier round that has pictures, and the sheets it shares with the one on show: only those can be held side by side.
  const before = () => roundBefore(rounds(), shown())
  const shared = () => sharedSheets(before(), shown())
  const canCompare = () => shared().length > 0
  const shot = (round: MakingRound | undefined, label = angle()) => round?.pictures.find((picture) => picture.label === label) ?? round?.pictures[0]
  const comparing = () => compare() && canCompare()
  const waiting = () => props.making.state === "making" && roundNow(props.making) > (rounds().at(-1)?.round ?? 0)
  const said = () => {
    const state = props.making.state
    const count = rounds().length
    if (props.making.idle) return "AI 领了这个任务，还没动手。它交上部件说明以后，这里才会写它在做什么。"
    if (state === "describing") return "AI 正在写部件说明：先把每个部分说清楚，再动手做。"
    if (state === "making") return `AI 正在做第 ${roundNow(props.making)} 轮（最多 ${props.making.rounds_allowed} 轮）。每做完一轮，它会对着图自己检查，再改。`
    if (state === "reviewing") return `AI 做了 ${count} 轮，自己觉得可以了。现在在做最后一道审查。`
    if (cut()) return `AI 做了 ${count} 轮，制作被中断了（软件关了或连接断了）。中断前最好的第 ${props.making.kept_round ?? count} 轮那一版已经存进工程，它还没有做完审查，不是没通过。可不可以，由你决定。`
    if (keptOne()) return `AI 做了 ${count} 轮，${UNSATISFIED.words}。存进工程的是第 ${props.making.kept_round ?? count} 轮那一版；它为什么还不满意写在最后一格里。可不可以，由你决定。`
    if (state === "stopped") return `AI ${halt().line(props.making)}。这一版没有存进工程${kept()}。${makingHalt(props.making) === "interrupted" ? "这不是没通过，只是没做完；想要它，就让 AI 再做一次。" : "它卡在哪里都写在下面。"}`
    if (!props.making.review) return `AI 做了 ${count} 轮，自己觉得可以了。这一次没有另外的审查。`
    const leftover = props.making.review.passed && props.making.review.advice?.length ? `，另外留了 ${props.making.review.advice.length} 条“${FINDING_LABELS.advice}”给你参考` : ""
    if (!props.making.review.independent) return `AI 做了 ${count} 轮。这一次没有另一位 AI 把关，是做它的那个 AI 自己审查的：${props.making.review.passed ? "通过" : "没通过"}${leftover}。`
    return `AI 做了 ${count} 轮。另一位没参与制作的 AI 审查：${props.making.review.passed ? "通过" : "没通过"}${leftover}。`
  }
  // A stopped try at something that was saved before leaves that earlier version where it was.
  const kept = () => (props.making.asset_id ? "，工程里留着的还是之前那一版" : "")
  const tidy = (): PartSheet => ({
    subject: form.subject.trim(),
    recognisable: form.recognisable.map((text) => text.trim()).filter(Boolean),
    // A part left completely empty was never meant: it is dropped instead of being complained about.
    parts: form.parts
      .map((part) => ({ ...part, name: part.name.trim(), what: part.what.trim(), shape: part.shape.trim(), attaches: part.attaches.trim(), surface: part.surface.trim(), moves: part.moves.trim() }))
      .filter((part) => part.name || part.what),
    assumed: form.assumed.map((text) => text.trim()).filter(Boolean),
    remark: form.remark,
    // The AI's own declarations are not edited here; they travel with the sheet as they are.
    ...(form.still?.length ? { still: form.still.map((item) => ({ ...item })) } : {}),
    ...(form.differs?.length ? { differs: form.differs.map((item) => ({ ...item })) } : {}),
    ...(form.justified?.length ? { justified: form.justified.map((item) => ({ ...item })) } : {}),
    ...(form.budget ? { budget: { ...form.budget } } : {}),
  })
  // What the person changed, by part name, so the AI is told where to look.
  const changes = (next: PartSheet) => {
    const old = new Map((props.making.sheet?.parts ?? []).map((part) => [part.name, JSON.stringify(part)]))
    const names = (label: string, parts: { name: string }[]) => (parts.length ? [`${label}${parts.map((part) => part.name || "没起名的部分").join("、")}`] : [])
    return [
      ...(props.making.sheet?.subject === next.subject ? [] : ["改了它是什么"]),
      ...names("改了：", next.parts.filter((part) => old.has(part.name) && old.get(part.name) !== JSON.stringify(part))),
      ...names("加了：", next.parts.filter((part) => !old.has(part.name))),
      ...names("去掉了：", (props.making.sheet?.parts ?? []).filter((part) => !next.parts.some((value) => value.name === part.name))),
    ].join("；")
  }
  const start = () => {
    setForm(reconcile(JSON.parse(JSON.stringify(props.making.sheet)) as PartSheet))
    setMore([])
    setEditing(true)
    sheetHost.scrollTop = 0
  }
  const save = (redo: boolean) => {
    const next = tidy()
    props.onSave(next, redo ? `我改了部件说明${changes(next) ? `（${changes(next)}）` : ""}，请按改过的说明重做。` : null)
  }

  createEffect(on(() => props.saved, () => setEditing(false), { defer: true }))
  // Another thing's story starts from its own newest moment.
  createEffect(
    on(
      () => props.making.item_id,
      () => {
        setPicked(null)
        setAngle("")
        setCompare(false)
        setCell(null)
        setZoom(null)
        setOpen([])
        setEditing(false)
      },
      { defer: true },
    ),
  )
  const drawn = () => rounds().filter((round) => round.pictures.length)
  const sheetOf = (round: MakingRound) => shot(round, zoom()?.label ?? "")
  const large = () => zoomedRound(zoom(), rounds())
  // The same sheet of the round before or after, so two rounds can be flipped between in one place.
  const turn = (by: number) => {
    const from = drawn().indexOf(large()!)
    const next = from < 0 ? undefined : drawn()[from + by]
    if (next) setZoom({ round: next.round, at: next.at, label: (next.pictures.find((picture) => picture.label === zoom()!.label) ?? next.pictures[0]!).label })
  }
  // While a picture is large the keys are its own: Escape closes it and the arrows change the round, before the card hears them.
  createEffect(() => {
    if (!zoom()) return
    const key = (event: KeyboardEvent) => {
      if (!["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) return
      event.stopImmediatePropagation()
      event.preventDefault()
      if (event.key !== "Escape") return turn(event.key === "ArrowRight" ? 1 : -1)
      setZoom(null)
    }
    window.addEventListener("keydown", key, true)
    onCleanup(() => window.removeEventListener("keydown", key, true))
  })

  const notes = (title: string, tone: string, lines: string[], none = "") => (
    <Show when={lines.length || none}>
      <section class="mk-notes" data-tone={tone}>
        <h5>{title}</h5>
        <Show when={tone === "rule" && lines.length}><p>这版还有需要调整的地方。{lines.some(line => /穿进|穿模|穿过/.test(line)) ? "有部件在动作中互相穿过。" : lines.some(line => /离地|陷进|地面/.test(line)) ? "模型和地面的位置需要对齐。" : "下面列出了没达到检查标准的地方。"}</p></Show>
        <Show when={lines.length} fallback={<p class="pa-hint">{none}</p>}>
          <ul>
            <SaidLines lines={lines} advanced={advanced()} />
          </ul>
        </Show>
      </section>
    </Show>
  )
  // A motion's picture has pink in it (what differs between its two moments): said on the small picture itself, so nobody has to open it to learn it is not a fault.
  const legend = (label: string | undefined) => (
    <Show when={showsOverlay(label)}>
      <small class="mk-legend">
        <i aria-hidden="true" />
        {OVERLAY_LEGEND}
      </small>
    </Show>
  )
  const frame = (round: MakingRound | undefined, caption = "") => (
    <Show when={shot(round)} fallback={<div class="mk-shot mc-well empty">这一轮没有留下图</div>}>
      {(picture) => (
        <button
          type="button"
          class="mk-shot mc-well"
          title="点一下放大看"
          aria-label={`放大看：第 ${round!.round} 轮，${plainLabel(picture().label)}`}
          onClick={() => setZoom({ round: round!.round, at: round!.at, label: picture().label })}
        >
          <img src={picture().url} alt={`第 ${round!.round} 轮，${plainLabel(picture().label)}`} draggable={false} onLoad={crisp} />
          <Show when={caption}>
            <em>{caption}</em>
          </Show>
          {legend(picture().label)}
        </button>
      )}
    </Show>
  )
  // Every picture of a round, under who it was drawn for. A round nobody reviewed has one group and no headings.
  // Only the first group of pictures (the ones handed to review, when there are) is listed at once; the rest wait behind 「更多图」 unless one of them is on show.
  const [allAngles, setAllAngles] = createSignal(false)
  const groupsOf = (round: MakingRound) => (["review", "asked", "look"] as const).filter((from) => round.pictures.some((picture) => (picture.from ?? "look") === from))
  const angles = (round: MakingRound | undefined) => (
    <Show when={(round?.pictures.length ?? 0) > 1}>
      <div class="mk-angles" role="group" aria-label="换一张图">
        <For
          each={groupsOf(round!).filter(
            (from, index) => index === 0 || allAngles() || round!.pictures.some((picture) => (picture.from ?? "look") === from && picture.label === shot(round)?.label),
          )}
        >
          {(from) => (
            <>
              <Show when={round!.pictures.some((picture) => picture.from && picture.from !== "look")}>
                <small>{drawnFor[from]}</small>
              </Show>
              <For each={round!.pictures.filter((picture) => (picture.from ?? "look") === from)}>
                {(picture) => (
                  <button type="button" class="pa-move" aria-pressed={shot(round)?.label === picture.label} onClick={() => setAngle(picture.label)}>
                    {plainLabel(picture.label)}
                  </button>
                )}
              </For>
            </>
          )}
        </For>
        <Show when={groupsOf(round!).length > 1}>
          <button type="button" class="pa-link mk-more-angles" aria-expanded={allAngles()} onClick={() => setAllAngles(!allAngles())}>
            {allAngles() ? "收起" : `更多图（${round!.pictures.filter((picture) => (picture.from ?? "look") !== groupsOf(round!)[0]).length}）`}
          </button>
        </Show>
      </div>
    </Show>
  )
  const compareToggle = () => (
    <Show when={canCompare()}>
      <span class="pa-moves-gap" />
      <button type="button" class="pa-move" aria-pressed={comparing()} onClick={() => setCompare(!compare())}>
        和上一轮对比
      </button>
    </Show>
  )
  // The earlier round and the one on show, the same sheet of both (and the same cell of it), switched together.
  const pair = (after: MakingRound, caption: string) => {
    const using = () => choose(shared(), angle(), cell())
    const half = (round: MakingRound | undefined, words: string) => (
      <Show when={exactSheet(round, using().label)} fallback={<div class="mk-shot mc-well empty">这一轮没有留下这个角度的图</div>}>
        {(picture) => (
          <button
            type="button"
            class="mk-shot mc-well"
            classList={{ cut: using().cell !== null }}
            title="点一下放大看"
            aria-label={`放大看：第 ${round!.round} 轮，${plainLabel(picture().label)}`}
            onClick={() => setZoom({ round: round!.round, at: round!.at, label: picture().label })}
          >
            <Show when={using().cell !== null} fallback={<><img src={picture().url} alt={`第 ${round!.round} 轮，${plainLabel(picture().label)}`} draggable={false} onLoad={crisp} />{legend(picture().label)}</>}>
              <span class="mk-cell">
                <img src={picture().url} alt={`第 ${round!.round} 轮，${SHEET_VIEWS[using().cell ?? 0]}`} draggable={false} style={cellOffset(using().cell ?? 0)} />
              </span>
            </Show>
            <em>{words}</em>
          </button>
        )}
      </Show>
    )
    return (
      <>
        <div class="mk-compare">
          {half(before(), `第 ${before()!.round} 轮`)}
          <svg class="mk-arrow" viewBox="0 0 11 9" shape-rendering="crispEdges" aria-hidden="true">
            <path fill="currentColor" d="M0 3h6v3H0zM6 0h1v1h1v1h1v1h1v1h1v1h-1v1H9v1H8v1H7v1H6z" />
          </svg>
          {half(after, caption)}
        </div>
        <Show when={shared().length > 1}>
          <div class="mk-angles" role="group" aria-label="两轮一起换一张图">
            <For each={shared()}>
              {(label) => (
                <button type="button" class="pa-move" aria-pressed={using().label === label} onClick={() => (setAngle(label), setCell(null))}>
                  {plainLabel(label)}
                </button>
              )}
            </For>
          </div>
        </Show>
        <Show when={isViewSheet(using().label)} fallback={<p class="pa-hint">两边是同一个动作、同一个角度，每一格上写着它是哪一刻。</p>}>
          <div class="mk-angles" role="group" aria-label="两轮一起换角度">
            <button type="button" class="pa-move" aria-pressed={using().cell === null} onClick={() => setCell(null)}>
              整张
            </button>
            <For each={SHEET_VIEWS}>
              {(name, index) => (
                <button type="button" class="pa-move" aria-pressed={using().cell === index()} onClick={() => setCell(index())}>
                  {name}
                </button>
              )}
            </For>
          </div>
        </Show>
      </>
    )
  }
  const mark = (passed: boolean) => (
    <svg class="mk-mark" data-passed={passed} viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true">
      <path fill="currentColor" d={passed ? tick : cross} />
    </svg>
  )
  const field = (label: string, value: string, change: (text: string) => void, rows = 1) => (
    <label class="mk-field">
      <span>{label}</span>
      <Show
        when={rows > 1}
        fallback={<input class="pa-input" value={value} disabled={props.busy} onInput={(event) => change(event.currentTarget.value)} />}
      >
        <textarea class="pa-input" rows={rows} value={value} disabled={props.busy} onInput={(event) => change(event.currentTarget.value)} />
      </Show>
    </label>
  )
  const lines = (key: "recognisable" | "assumed", label: string, add: string) => (
    <fieldset class="mk-lines">
      <legend>{label}</legend>
      <Index each={form[key]}>
        {(text, index) => (
          <div class="mk-line">
            <input class="pa-input" aria-label={`${label}，第 ${index + 1} 条`} value={text()} disabled={props.busy} onInput={(event) => setForm(key, index, event.currentTarget.value)} />
            <button type="button" class="pa-mini" aria-label="去掉这一条" title="去掉这一条" disabled={props.busy} onClick={() => setForm(key, (list) => list.filter((_, at) => at !== index))}>
              <Icon name="close" />
            </button>
          </div>
        )}
      </Index>
      <button type="button" class="pa-link" disabled={props.busy} onClick={() => setForm(key, (list) => [...list, ""])}>
        + {add}
      </button>
    </fieldset>
  )

  const sheet = (value: () => PartSheet) => (
    <>
      <Show when={value().remark}>
        <p class="mk-remark">
          <strong>这份说明是照你上次说的改的</strong>
          <q>{value().remark}</q>
        </p>
      </Show>
      <p class="mk-subject">{value().subject}</p>
      <Show when={value().recognisable.length}>
        <h5>一眼认出它，靠的是</h5>
        <ul class="mk-chips">
          <For each={value().recognisable}>{(text) => <li>{text}</li>}</For>
        </ul>
      </Show>
      <Show when={value().parts.length}>
        <h5>
          它分成 {value().parts.length} 个部分<small>点一个看细节</small>
        </h5>
        <ul class="mk-parts">
          <For each={value().parts}>
            {(part: Part) => (
              <li data-assumed={part.assumed}>
                <button
                  type="button"
                  aria-expanded={open().includes(part.name)}
                  onClick={() => setOpen(open().includes(part.name) ? open().filter((name) => name !== part.name) : [...open(), part.name])}
                >
                  <b>{partTitle(part, advanced())}</b>
                  <Show when={part.assumed}>
                    <em class="mk-ai" title="你没说要这个，是 AI 自己加的">
                      AI 补的
                    </em>
                  </Show>
                  <Show when={partDetail(part, advanced())}>
                    <span>{part.what}</span>
                  </Show>
                </button>
                <Show when={open().includes(part.name)}>
                  <dl>
                    <For each={details.filter((detail) => part[detail.key])}>
                      {(detail) => (
                        <>
                          <dt>{detail.label}</dt>
                          <dd>{part[detail.key]}</dd>
                        </>
                      )}
                    </For>
                  </dl>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={value().assumed.length}>
        <h5>你没说、AI 自己拿主意的</h5>
        <ul class="mk-assumed">
          <For each={value().assumed}>
            {(text) => (
              <li>
                <em class="mk-ai">AI 补的</em>
                {text}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={value().still?.length}>
        <h5>AI 说{MOTION_WORDS.still}</h5>
        <ul class="mk-assumed mk-still">
          <For each={value().still}>
            {(item) => (
              <li>
                <em class="mk-ai">{motionTitle(item.motion, advanced())}</em>
                {item.reason}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={value().differs?.length}>
        <h5>AI 说{OUTSIDE_WORDS.meant}</h5>
        <ul class="mk-assumed mk-still">
          <For each={value().differs}>
            {(item) => (
              <li>
                <em class="mk-ai">{comparedName(item.measure)}</em>
                {item.reason}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <Show when={value().budget}>
        {(budget) => (
          <>
            <h5>AI 选的精细程度</h5>
            <ul class="mk-assumed mk-still">
              <li>
                <em class="mk-ai">「{GEOMETRY_TIERS[tierNamed(budget().tier)].name}」档</em>
                最多 {GEOMETRY_TIERS[tierNamed(budget().tier)].cubes} 个方块、{GEOMETRY_TIERS[tierNamed(budget().tier)].bones} 根骨骼（不写就是「{GEOMETRY_TIERS[DEFAULT_TIER].name}」档：{GEOMETRY_TIERS[DEFAULT_TIER].cubes} 个方块）。预计游戏里同时出现约 {budget().at_once} 个。理由：{budget().reason}
              </li>
            </ul>
          </>
        )}
      </Show>
      <Show when={value().justified?.length}>
        <h5>AI 说量出来的这几样本来就该这样</h5>
        <ul class="mk-assumed mk-still">
          <For each={value().justified}>
            {(item) => (
              <li>
                <em class="mk-ai">{justifiedName(item.what)}</em>
                {item.reason}
              </li>
            )}
          </For>
        </ul>
      </Show>
      <div class="mk-sheet-foot">
        <div class="mk-sheet-actions">
          <Button disabled={props.busy || !!props.locked} onClick={start}>
            改这份说明
          </Button>
          <Button disabled={props.busy || !!props.locked} onClick={() => props.onRedo("请严格按现在这份部件说明重做这一样。")}>
            按这份说明重做
          </Button>
        </div>
        <p class="pa-hint">{props.locked || "哪里写得不对、哪样不是你要的，可以直接改。"}</p>
      </div>
    </>
  )
  const editor = () => (
    <form
      class="mk-edit"
      onSubmit={(event) => {
        event.preventDefault()
        save(false)
      }}
    >
      {field("它是什么（一句话）", form.subject, (text) => setForm("subject", text), 2)}
      {lines("recognisable", "一眼认出它，靠的是", "加一条")}
      <fieldset class="mk-lines">
        <legend>它分成这些部分</legend>
        <For each={form.parts}>
          {(part, index) => (
            <div class="mk-part-edit" data-assumed={part.assumed}>
              <div class="mk-line">
                {/* A name written as an identifier is the documents' business: it is kept as it is and only shown under 高级. */}
                <Show when={advanced() || !isIdentifier(part.name)} fallback={<span class="mk-name mk-name-plain">第 {index() + 1} 个部分</span>}>
                  <input class="pa-input mk-name" aria-label="部分的名字" placeholder="名字，比如：头" value={part.name} disabled={props.busy} onInput={(event) => setForm("parts", index(), "name", event.currentTarget.value)} />
                </Show>
                <label class="mk-check" title="打勾：这是 AI 自己加的；去掉勾：这就是我要的">
                  <input type="checkbox" checked={part.assumed} disabled={props.busy} onChange={(event) => setForm("parts", index(), "assumed", event.currentTarget.checked)} />
                  AI 补的
                </label>
                <button type="button" class="pa-mini" aria-label={`去掉「${partTitle(part, advanced()) || "这个部分"}」`} title="去掉这个部分" disabled={props.busy} onClick={() => setForm("parts", (list) => list.filter((_, at) => at !== index()))}>
                  <Icon name="close" />
                </button>
              </div>
              <input class="pa-input" aria-label="这个部分是什么样的" placeholder="一句话说它是什么样的" value={part.what} disabled={props.busy} onInput={(event) => setForm("parts", index(), "what", event.currentTarget.value)} />
              <Show
                when={more().includes(index())}
                fallback={
                  <button type="button" class="pa-link" onClick={() => setMore([...more(), index()])}>
                    改细节（形状、接在哪、表面、怎么动）
                  </button>
                }
              >
                <For each={details}>{(detail) => field(detail.label, part[detail.key], (text) => setForm("parts", index(), detail.key, text))}</For>
              </Show>
            </div>
          )}
        </For>
        <button
          type="button"
          class="pa-link"
          disabled={props.busy}
          onClick={() => {
            setMore([...more(), form.parts.length])
            setForm("parts", (list) => [...list, { name: "", what: "", shape: "", attaches: "", surface: "", moves: "", assumed: false }])
          }}
        >
          + 加一个部分
        </button>
      </fieldset>
      {lines("assumed", "你没说、AI 自己拿主意的", "加一条")}
      <div class="mk-sheet-foot">
        <div class="mk-sheet-actions">
          <Button primary type="submit" disabled={props.busy}>
            保存
          </Button>
          <Button disabled={props.busy || !!props.locked} onClick={() => save(true)}>
            保存，并按这份说明重做
          </Button>
          <Button disabled={props.busy} onClick={() => setEditing(false)}>
            不改了
          </Button>
        </div>
        <p class="pa-hint">空着的不用管，会自动去掉。「保存，并按这份说明重做」：{props.promise}</p>
      </div>
    </form>
  )
  const round = (value: () => MakingRound) => (
    <>
      <header class="mk-detail-head">
        <strong>第 {value().round} 轮</strong>
        <small>{when(value().at)}</small>
        <Show when={keptOne() && props.making.kept_round === value().round}>
          <em class="mk-tag">交给你的就是这一版</em>
        </Show>
        <Show when={reviewed() === value()}>
          <em class="mk-tag plain">审查看的是这一版</em>
        </Show>
        {compareToggle()}
      </header>
      <Show
        when={comparing()}
        fallback={
          <div class="mk-round">
            <div class="mk-look">
              {frame(value())}
              {angles(value())}
            </div>
            <div class="mk-words">
              <Show
                when={value().self_review}
                fallback={<p class="pa-hint">{props.making.state === "making" && value() === rounds().at(-1) ? "图出来了。AI 正在对着图，一条一条检查自己做得对不对…" : "这一轮没有留下它自己的检查。"}</p>}
              >
                {(review) => (
                  <>
                    {notes("它觉得做对了的", "good", review().matches)}
                    {notes(`它自己认为${FINDING_LABELS.blocking}`, "bad", review().problems, `它没发现${FINDING_LABELS.blocking}问题。`)}
                    {notes(`它自己认为${FINDING_LABELS.advice}`, "advice", review().advice ?? [])}
                    {notes("它打算改的", "next", review().next)}
                    <Show when={advanced()}>{notes("技术细节（它另外写下的）", "tech", review().technical ?? [])}</Show>
                    <p class="mk-turn" data-verdict={review().verdict}>
                      {review().verdict === "done"
                        ? review().advice?.length
                          ? `做它的 AI 自己觉得可以交了：没有${FINDING_LABELS.blocking}，${FINDING_LABELS.advice}留给你决定。这只是它自己的看法，不是审查。`
                          : "做它的 AI 自己觉得可以了，交去审查。这只是它自己的看法，不是审查。"
                        : value() === rounds().at(-1) && (props.making.state === "stopped" || keptOne())
                          ? rounds().length >= props.making.rounds_allowed
                            ? "它觉得还要改，但是轮数用完了。"
                            : cut() || (!keptOne() && makingHalt(props.making) === "interrupted")
                              ? "它觉得还要改，但是制作在这里被中断了。"
                              : "它觉得还要改，但是做到这里就停下了。"
                          : "它决定再改一轮。"}
                    </p>
                  </>
                )}
              </Show>
              {/* What a review said of this very version stands on the version, so the maker's "done" above is never the last word on it. */}
              <Show when={verdict(value()).tone === "fail" || verdict(value()).tone === "pass"}>
                <p class="mk-turn mk-round-review" data-tone={verdict(value()).tone}>
                  {verdict(value()).words}
                </p>
              </Show>
              {notes("按检查标准量出来的毛病", "rule", value().findings.map(plainLine), value().self_review ? "结构上没量出毛病。" : "")}
              <Show when={value().motion?.length}>
                {notes("每个动作动得怎么样", "motion", (value().motion ?? []).map((item) => plainLine(item.plain)))}
                <Show when={value().motion?.some((item) => item.held)}>
                  {notes("动作连起来看", "motion", (value().motion ?? []).flatMap((item) => item.held?.plain ?? []), "循环接得上，中途没有突然跳，没有陷进地里，也没有哪个部件穿进别的部件。")}
                </Show>
                <Fold class="mk-advanced" summary="每个动作量出来的数">
                  <p class="pa-hint">从模型文件里直接量的：哪个部件动得最多、移动了多少；连起来看的那一句是按游戏每秒 20 刻逐刻量的。AI 和审查员看到的也是这些数。</p>
                  <ul class="mk-facts">
                    <For each={value().motion}>
                      {(item) => (
                        <>
                          <li>{item.line}</li>
                          <Show when={item.held}>{(held) => <li>{held().line}</li>}</Show>
                        </>
                      )}
                    </For>
                  </ul>
                </Fold>
              </Show>
              <Show when={value().budget}>
                {(budget) => (
                  <>
                    {notes("做得有多细", "motion", [budget().plain])}
                    <Fold class="mk-advanced" summary="和这一档的上限对着数">
                      <p class="pa-hint">从模型文件里直接数的。上限是 Studio 自己的制作流程量出来能承受的，不是游戏里量的帧数。</p>
                      <ul class="mk-facts">
                        <li>{budget().line}</li>
                      </ul>
                    </Fold>
                  </>
                )}
              </Show>
              <Show when={value().texture}>
                {(texture) => (
                  <>
                    {notes("这张图数出来的", "texture", texture().plain)}
                    <Fold class="mk-advanced" summary="数出来的每一项">
                      <p class="pa-hint">直接从图上数的，是事实，不是结论。AI 和审查员看到的也是这些。</p>
                      <ul class="mk-facts">
                        <For each={texture().lines}>{(line) => <li>{line}</li>}</For>
                      </ul>
                    </Fold>
                    <Show when={props.projectId && props.making.asset_id}>
                      <section class="mk-beside">
                        <button type="button" class="pa-move" disabled={beside()?.state === "drawing"} onClick={() => lookBeside(props.projectId!, props.making.asset_id!)}>
                          {beside()?.state === "drawing" ? "正在画…" : "和原版放在一起看"}
                        </button>
                        <p class="pa-hint">
                          {beside()?.state === "none"
                            ? "这台电脑上还读不到游戏本体的贴图（先把工程打包一次，或者打开一次测试场），现在没有原版的东西可以放在一起看。"
                            : "把现在存着的这一版和游戏里本来就有的东西放在一起。这张图是现画的，只给你看，不会存进工程。"}
                        </p>
                        <Show when={((shown) => (shown?.state === "shown" ? shown : null))(beside())}>
                          {(shown) => (
                            <>
                              <button type="button" class="mk-beside-shot" title="点开看大图" onClick={() => setBesideLarge(true)}>
                                <img src={shown().url} alt={shown().label} draggable={false} />
                              </button>
                              <Show when={besideLarge()}>
                                <div class="mk-zoom" role="dialog" aria-modal="true" aria-label={shown().label} onClick={() => setBesideLarge(false)}>
                                  <header>
                                    <strong>{shown().label}</strong>
                                    <span class="pa-moves-gap" />
                                    <small>现画的，只给你看，不会存进工程</small>
                                    <button type="button" class="pa-move" onClick={() => setBesideLarge(false)}>
                                      关上
                                    </button>
                                  </header>
                                  <img src={shown().url} alt={shown().label} draggable={false} />
                                </div>
                              </Show>
                            </>
                          )}
                        </Show>
                      </section>
                    </Show>
                  </>
                )}
              </Show>
              <Show when={value().script}>
                {(script) => (
                  <Fold class="mk-advanced" summary="这一版是 AI 写脚本做出来的">
                    <p class="pa-hint">脚本只是另一种写法，跑出来的就是你看到的这一版。不用看懂它。</p>
                    <pre>{script()}</pre>
                  </Fold>
                )}
              </Show>
            </div>
          </div>
        }
      >
        {pair(value(), `第 ${value().round} 轮`)}
        <div class="mk-words pair">
          {notes(`第 ${before()!.round} 轮之后，它说要改的`, "next", before()!.self_review?.next ?? [], "它没写要改什么。")}
          {notes(`第 ${value().round} 轮，它觉得做对了的`, "good", value().self_review?.matches ?? [], value().self_review ? "它没写做对了什么。" : "它还在检查这一轮。")}
        </div>
      </Show>
    </>
  )
  // What the picture of the last page is of.
  const endCaption = () =>
    keptOne()
      ? `交给你的这一版（第 ${shown()?.round} 轮）`
      : props.making.state === "stopped" && !props.making.review
        ? "停下时的这一版"
        : props.making.review
          ? `审查看的这一版（第 ${shown()?.round} 轮）`
          : "交去审查的这一版"
  const end = () => (
    <>
      <header class="mk-detail-head">
        <strong>
          {keptOne()
            ? handedWords(props.making).words
            : props.making.review
              ? props.making.review.independent
                ? "另一位没参与制作的 AI 审查"
                : "做它的那个 AI 自己检查"
              : props.making.state === "reviewing"
                ? "正在检查"
                : halt().head}
        </strong>
        <Show when={props.making.review}>
          <small>{when(props.making.review!.at)}</small>
        </Show>
        {compareToggle()}
      </header>
      <div class="mk-round" classList={{ compare: comparing() }}>
        <div class="mk-look">
          <Show
            when={comparing()}
            fallback={
              <>
                {frame(shown(), endCaption())}
                {angles(shown())}
              </>
            }
          >
            {pair(shown()!, endCaption())}
          </Show>
        </div>
        <div class="mk-words">
          <Show when={cut()}>
            <p class="mk-unsat">做出来的没有丢：制作被中断了（软件关了或连接断了），中断前它看过的、没有硬伤的最新一版（第 {props.making.kept_round ?? shown()?.round} 轮）已经存进工程。这一版还没有做完审查——不是没通过，是没来得及。行不行由你定，用下面的「验收通过」或者「退回重做」。</p>
            <Show when={!props.making.review}>
              <p class="pa-hint">中断的时候，这一版还没有轮到审查。</p>
            </Show>
          </Show>
          <Show when={keptOne() && !cut()}>
            <p class="mk-unsat">做出来的没有丢：它看过的、没有硬伤的最新一版（第 {props.making.kept_round ?? shown()?.round} 轮）已经存进工程。行不行由你定，用下面的「验收通过」或者「退回重做」。</p>
            {notes("它还不满意的地方", "bad", props.making.kept_reason ?? [], "它没有写原因。")}
            <Show when={advanced()}>{notes("技术细节（停下时写的）", "tech", props.making.kept_technical ?? [])}</Show>
          </Show>
          <Show when={props.making.review}>
            {(review) => (
              <>
                <p class="mk-verdict" data-passed={review().passed}>
                  {mark(review().passed)}
                  <strong>{review().passed ? "通过" : "没通过"}</strong>
                  <Show when={keptOne()}>
                    <small>{review().independent ? "另一位 AI 的审查" : "它自己的审查"}</small>
                  </Show>
                </p>
                {/* 盲认: what the reviewer took the picture for before it was told the name. Said whether it hit or missed, and when it was not asked. */}
                <Show when={review().blind}>
                  {(blind) => (
                    <p class="mk-blind" data-recognised={blind().tested ? !!blind().recognised : undefined}>
                      <b>盲认</b>
                      {blind().words}
                    </p>
                  )}
                </Show>
                {/* A review is of one version. Say so whenever the picture beside it, or the last thing made, is another. */}
                <Show when={reviewed() && reviewed() !== shown() && !unreviewed()}>
                  <p class="mk-honest">这个审查结论说的是第 {reviewed()!.round} 轮那一版，不是左边这一版。</p>
                </Show>
                <Show when={review().round === null}>
                  <p class="mk-honest">这个审查结论说的那一版已经不在记录里了。</p>
                </Show>
                <Show when={unreviewed()}>
                  {(later) => (
                    <p class="mk-honest">
                      注意：这个审查结论说的是第 {reviewed()!.round} 轮那一版。之后 AI 又做了第 {later().round} 轮，<b>{makingLive(props.making) ? "那一版还没有审查" : "那一版没有审查过"}</b>
                      {keptOne() ? (props.making.kept_round === later().round ? "；交给你的就是那一版" : "") : makingLive(props.making) ? "" : "，也没有存进工程"}。
                    </p>
                  )}
                </Show>
                <Show when={!review().independent}>
                  <p class="mk-honest">这一次没有另一位 AI 把关：审查是做它的那个 AI 自己做的，所以这个结论要打点折扣，请你多看两眼。</p>
                </Show>
                {/* A review from before the two kinds were told apart has one list, and it is not relabelled as blocking. */}
                <Show
                  when={review().advice !== undefined}
                  fallback={notes(review().passed ? "它看完以后说的" : "它指出的问题（那时还没有分「必须改」和「可以更好」）", review().passed ? "good" : "bad", review().findings, review().passed ? "它没有别的要说的。" : "它没写具体哪里不行。")}
                >
                  {notes(FINDING_LABELS.blocking, "bad", review().findings, review().passed ? `没有${FINDING_LABELS.blocking}。` : "它没写具体哪里不行。")}
                  {notes(FINDING_LABELS.advice, "advice", review().advice ?? [], "它没有别的建议。")}
                </Show>
                <Show when={advanced()}>{notes("技术细节（审查时另外写下的）", "tech", review().technical ?? [])}</Show>
              </>
            )}
          </Show>
          <Show when={!props.making.review && props.making.state === "reviewing"}>
            <p class="mk-turn">
              <i class="mk-busy" aria-hidden="true" />
              正在对着部件说明和检查标准，一条一条查这一版。审查看的是专门为这一版画的一整套图。
            </p>
          </Show>
          <Show when={props.making.state === "stopped" && !keptOne()}>
            <p class="mk-honest">
              {makingHalt(props.making) === "interrupted"
                ? "制作被中断了：软件中途关了、连接断了，或者被停掉了。这不是没通过，只是没做完，也没有一版来得及留下。"
                : rounds().length >= props.making.rounds_allowed
                  ? `最多做 ${props.making.rounds_allowed} 轮，已经用完了，没有一版能留下。`
                  : `${halt().head}。`}
              这一版没有存进工程{kept()}。{makingHalt(props.making) === "interrupted" ? "下面是它被打断时手上还记着的问题。" : "下面是它停下时还没解决的问题。"}想要它，就提醒 AI 一句，让它再做一次。
            </p>
            {notes("最后一轮它自己说还有的问题", "bad", rounds().at(-1)?.self_review?.problems ?? [])}
            {notes("按检查标准量出来的毛病", "rule", rounds().at(-1)?.findings ?? [])}
          </Show>
          <p class="pa-hint">AI 的审查只是先帮你把一道关：只有「{FINDING_LABELS.blocking}」会让它不通过，「{FINDING_LABELS.advice}」只是建议。它可不可以，最后还是你说了算。</p>
        </div>
      </div>
    </>
  )

  const sheetBody = () => (
    <>
      <h4>
        部件说明<small>AI 动手之前写下的：它打算做成什么样</small>
      </h4>
      {/* Folded (制作现场, read only), the 六视图 and reference trays come only when there is something in them: an empty tray there offers nothing. */}
      <Show when={props.projectId && (!props.sheetFolded || (props.making.references?.length ?? 0) > 0) ? props.projectId : undefined}>
        {(projectId) => (
          <>
            <Show when={wantsThreeView(props.kind ?? "")}>
              <ThreeViewBlock projectId={projectId()} itemId={props.making.item_id} listed={props.making.references} locked={props.busy || editing() ? "正在改说明" : props.locked} />
            </Show>
            <ReferenceTray projectId={projectId()} itemId={props.making.item_id} listed={props.making.references} locked={props.busy || editing() ? "正在改说明" : props.locked} />
          </>
        )}
      </Show>
      <Show when={props.making.sheet} fallback={<p class="mk-turn">{props.making.sheetless ? "有招式的生物不写部件说明：AI 看的、审查员审查的，是它每个招式放出来的样子，图和结论在右边。" : props.making.state === "describing" ? `${props.making.idle ? "AI 还没动手写。" : "AI 还在写。"}写好以后，这里会列出它打算做的每一个部分。` : "这一次没有留下部件说明。"}</p>}>
        {(value) => (
          <Show when={editing()} fallback={sheet(value)}>
            {editor()}
          </Show>
        )}
      </Show>
    </>
  )
  // The folded sheet's one line: what it holds, counted.
  const sheetSummary = () =>
    [props.making.sheet ? `${props.making.sheet.parts.length} 个部件` : props.making.sheetless ? "按招式看，不写说明" : "还没有写", props.making.references?.length ? `参考图 ${props.making.references.length} 张` : ""].filter(Boolean).join("，")
  return (
    <div class="mk-story" classList={{ editing: editing(), comparing: comparing(), folded: !!props.sheetFolded && !editing() }} data-state={props.making.state}>
      <p class="mk-status" role="status" data-state={props.making.state} data-passed={props.making.review?.passed} data-kept={keptOne()}>
        <Show when={makingLive(props.making)}>
          <i class="mk-busy" aria-hidden="true" />
        </Show>
        <Show when={props.making.review && !keptOne()}>{mark(props.making.review!.passed)}</Show>
        <span>{said()}</span>
        {/* 制作现场 shows this same story beside everything else recorded about the thing. */}
        <Show when={!floorShown()}>
          <button type="button" class="pa-link mk-floor" title="这样东西的每一轮、每一次检查、退回和保存，都在制作现场" onClick={() => openFloor({ item: props.making.item_id, round: typeof stop() === "number" ? (stop() as number) : undefined })}>
            在制作现场看全部
          </button>
        </Show>
      </p>
      {props.play}
      <section ref={sheetHost} class="mk-sheet" aria-label="部件说明">
        <Show when={props.sheetFolded && !editing()} fallback={sheetBody()}>
          <Fold class="mk-sheet-fold" summary={<>部件说明<small>{sheetSummary()}</small></>}>
            {sheetBody()}
          </Fold>
        </Show>
      </section>
      <section class="mk-rounds" aria-label="一轮一轮是怎么做的">
        <div class="mk-film" role="tablist" aria-label="每一轮">
          <For each={rounds()}>
            {(value, index) => (
              <>
                <Show when={index() > 0}>
                  <i class="mk-link" aria-hidden="true" />
                </Show>
                <button type="button" role="tab" class="mk-stop" aria-selected={stop() === value.round} data-verdict={value.self_review?.verdict} data-tone={verdict(value).tone} title={verdict(value).words} onClick={() => setPicked(value.round)}>
                  <span class="mk-thumb mc-well">
                    <Show when={coverOf(value)} fallback={<i class="mk-busy" aria-hidden="true" />}>
                      {(url) => <Thumb url={url()} />}
                    </Show>
                    {/* The round's number sits in the slot's corner the way a stack's count does. */}
                    <b class="mk-count">
                      <span class="sr-only">第 </span>
                      {value.round}
                      <span class="sr-only"> 轮</span>
                    </b>
                  </span>
                  <small>{keptOne() && props.making.kept_round === value.round ? "交给你的" : verdict(value).short || (props.making.state === "making" ? "检查中" : "　")}</small>
                </button>
              </>
            )}
          </For>
          <Show when={waiting()}>
            <Show when={rounds().length}>
              <i class="mk-link" aria-hidden="true" />
            </Show>
            <span class="mk-stop pending">
              <span class="mk-thumb">
                <i class="mk-busy" aria-hidden="true" />
                <b class="mk-count">
                  <span class="sr-only">第 </span>
                  {roundNow(props.making)}
                  <span class="sr-only"> 轮</span>
                </b>
              </span>
              <small>正在做</small>
            </span>
          </Show>
          <Show when={ended()}>
            <Show when={rounds().length}>
              <i class="mk-link" aria-hidden="true" />
            </Show>
            <button type="button" role="tab" class="mk-stop end" aria-selected={stop() === "end"} data-passed={props.making.review?.passed} data-kept={keptOne()} onClick={() => setPicked("end")}>
              <span class="mk-thumb">
                {/* A kept version is neither passed nor failed: it is handed over. */}
                <Show when={props.making.review && !keptOne()} fallback={<i class={keptOne() ? "mk-handed" : props.making.state === "reviewing" ? "mk-busy" : "mk-halt"} aria-hidden="true" />}>
                  {mark(props.making.review!.passed)}
                </Show>
              </span>
              <b>{keptOne() ? "交给你" : props.making.state === "stopped" && !props.making.review ? "停下了" : "审查"}</b>
              {/* An interrupted making is never worded as a failed one. */}
              <small>{keptOne() ? handedWords(props.making).mark : props.making.review ? (props.making.review.passed ? "通过" : "没通过") : props.making.state === "reviewing" ? "进行中" : halt().mark}</small>
            </button>
          </Show>
          <Show when={makingLive(props.making)}>
            <span class="mk-cap">最多做 {props.making.rounds_allowed} 轮</span>
          </Show>
        </div>
        {/* The counts on this page (which round, how many at most, the quick looks) in one line, so they are not left to be guessed apart. */}
        <Fold class="mk-counts" summary="轮数怎么算">
          <p class="pa-hint">{roundsExplained(props.making.rounds_allowed)}</p>
        </Fold>
        <div class="mk-detail">
          <Show when={stop() === "end"}>{end()}</Show>
          <Show when={stop() !== "end" && shown()}>{(value) => round(value)}</Show>
          <Show when={stop() === null}>
            <p class="mk-turn">
              <i class="mk-busy" aria-hidden="true" />
              {props.making.state === "describing" ? "还没开始做。说明写好以后，每做完一轮，这里就多一张图。" : "第 1 轮正在做，图出来以后会显示在这里。"}
            </p>
          </Show>
        </div>
      </section>
      <Show when={large()}>
        {(round) => (
          <div class="mk-zoom" role="dialog" aria-modal="true" aria-label={`第 ${round().round} 轮的图`} onClick={(event) => event.target === event.currentTarget && setZoom(null)}>
            <header>
              <button type="button" class="pa-move" disabled={drawn().indexOf(round()) === 0} onClick={() => turn(-1)}>
                上一轮
              </button>
              <strong>
                第 {round().round} 轮 · {plainLabel(sheetOf(round())?.label)}
              </strong>
              <button type="button" class="pa-move" disabled={drawn().indexOf(round()) === drawn().length - 1} onClick={() => turn(1)}>
                下一轮
              </button>
              <For each={round().pictures.length > 1 ? round().pictures : []}>
                {(picture) => (
                  <button type="button" class="pa-move" aria-pressed={sheetOf(round())?.label === picture.label} onClick={() => setZoom({ round: round().round, at: round().at, label: picture.label })}>
                    {plainLabel(picture.label)}
                  </button>
                )}
              </For>
              <span class="pa-moves-gap" />
              <small>键盘 ← → 换一轮，对着看哪里变了</small>
              <button type="button" class="pa-move" onClick={() => setZoom(null)}>
                关上
              </button>
            </header>
            <Show when={sheetOf(round())} fallback={<p class="mk-turn">这一轮没有留下图。</p>}>
              {(picture) => <img src={picture().url} alt={`第 ${round().round} 轮，${plainLabel(picture().label)}`} draggable={false} onLoad={crisp} onClick={() => setZoom(null)} />}
            </Show>
            <Show when={showsOverlay(sheetOf(round())?.label)}>
              <small class="mk-legend large">
                <i aria-hidden="true" />
                {OVERLAY_LEGEND}
              </small>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

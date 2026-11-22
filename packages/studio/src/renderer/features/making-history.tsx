import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { AnnotationMark } from "@minemods/studio-ai/model-annotation"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import type { Project } from "@minemods/mod-core/project"
import type { Making, MakingVersion, OverviewItem, StudioView } from "../../api"
import { noteBrief, notePlace, noteStanding, noteTick, pointOnShape, sameAngle, toSend, type MakingNote, type MakingNoteInput } from "../../making-notes"
import { annotationLayers, annotationPoint, annotationSvg } from "../model-annotation"
import type { ViewportCameraState, ViewportSnapshot, mountViewport } from "../viewport"
import { draftPicture } from "./asset-picture"
import { ModulePreview } from "./asset-workspace"
import { FloorPicture } from "./making-floor-thing"
import { partTitle } from "./making-live-model"
import { ModelCanvas } from "./model-canvas"
import { motionTitle } from "./asset-words"
import { keepSame } from "../keep-same"
import { Icon } from "../ui"
import { NO_MAKING_RECORD_WORDS, versionWords } from "./making-history-model"
import { earnAdvancement } from "./advancement"
import "./brief-note.css"
import "./model-annotation.css"
import "./making-live.css"
import "./making-history.css"

/** What stands in a preview for a thing that is not a model: its own preview, the one its card uses. */
export function ModuleDocumentPreview(props: { document: ModuleDocument | null; project: Project; empty?: string }) {
  return (
    <Show when={props.document} keyed fallback={<p class="mh-empty">{props.empty ?? "没有可以显示的内容。"}</p>}>
      {(value) => (
        <div class="mh-document">
          <ModulePreview document={value} project={props.project} />
        </div>
      )}
    </Show>
  )
}

/** The card's way into 「制作过程」 for a thing with saved versions and no making record: the making teaser's look, saying only what there is. */
export function VersionsTeaser(props: { count: number; onOpen: () => void }) {
  return (
    <button type="button" class="mk-teaser" data-testid="versions-teaser" onClick={() => props.onOpen()}>
      <span class="mk-teaser-words">
        <strong>保存过 {props.count} 版</strong>
        <small>没有 AI 的制作记录。各版可以并排比，也可以回到旧版。</small>
      </span>
      <em>
        看各版
        <Icon name="arrow" />
      </em>
    </button>
  )
}

export type HistoryBar = {
  restore: { label: string; hint: string; disabled: boolean; run: () => void } | null
  hand: { label: string; disabled: boolean; why: string; run: () => void } | null
}
type Tool = "circle" | "arrow" | "text" | "frame"
const TOOLS: { id: Tool; label: string }[] = [
  { id: "circle", label: "圈一下" },
  { id: "arrow", label: "画箭头" },
  { id: "text", label: "写一句" },
  { id: "frame", label: "标动作的某一帧" },
]
type Viewport = ReturnType<typeof mountViewport>
/** How long a note taken away can still be taken back. */
const UNDO_FOR = 5000

/**
 * 验收窗「制作过程」: every saved version as a slot; any old one beside the current one, turning together; stepping back as a new version; notes that stay on the thing,
 * handed to the AI through the redo that exists. The making story of old stands below this, as it was. A thing with no making record (`making` undefined:
 * imported, older, converted to the official names) has this alone, and says so; nothing of an AI's making is made up for it.
 */
export function MakingHistory(props: {
  projectId: string
  project: Project
  item: OverviewItem
  assetId: string
  making: Making | undefined
  /** Why nothing may be changed now ("" when it may). */
  locked: string
  advanced: boolean
  /** An outside AI does the work: it does not wake by itself, and what is handed over waits for it. */
  external: boolean
  onChanged: (view?: StudioView) => void
  /** Notes were just handed over. */
  onHanded: () => void
  /** One line on how something went, where the card says such things. */
  onSaid: (words: string) => void
  onError: (words: string) => void
  onAsk: (ask: { title: string; lines: string[]; names: string[]; actions: { label: string; primary?: boolean; run: () => void }[] }) => void
  /** A note is being written or drawn: leaving now would lose it. */
  onDirty: (dirty: boolean) => void
  onBar: (bar: HistoryBar | null) => void
}) {
  const [versions, setVersions] = createSignal<MakingVersion[]>([])
  const [allNotes, setAllNotes] = createSignal<MakingNote[]>([])
  const [other, setOther] = createSignal<number | null>(null)
  const [tool, setTool] = createSignal<Tool | null>(null)
  const [pending, setPending] = createSignal<MakingNoteInput | null>(null)
  const [dragging, setDragging] = createSignal(false)
  const [words, setWords] = createSignal("")
  const [escapeOnce, setEscapeOnce] = createSignal(false)
  const [extra, setExtra] = createSignal("")
  const [onlyMarked, setOnlyMarked] = createSignal(true)
  const [doing, setDoing] = createSignal<"" | "restore" | "hand" | "keep" | "clear">("")
  // Taken away a moment ago and not gone yet: a slip of the hand can still be undone.
  const [taken, setTaken] = createSignal<number[]>([])
  // Taken away and on its way out: too late to take back.
  const [going, setGoing] = createSignal<number[]>([])
  const [link, setLink] = createSignal<{ from: "old" | "now"; state: ViewportCameraState } | null>(null)
  const [viewNow, setViewNow] = createSignal<ViewportCameraState | null>(null)
  const [clip, setClip] = createSignal("")
  const [frameTime, setFrameTime] = createSignal(0)
  const [box, setBox] = createSignal({ width: 0, height: 0 })
  const views: { old: Viewport | null; now: Viewport | null } = { old: null, now: null }
  const undoTimers = new Map<number, number>()
  let host: HTMLDivElement | undefined
  let root: HTMLElement | undefined

  const notes = createMemo(() => allNotes().filter((note) => !taken().includes(note.id)))
  // By revision: a read that found nothing new must not take the views down and put them up again.
  const current = createMemo(() => versions().find((value) => value.current) ?? versions().at(-1) ?? null, null, { equals: (left, right) => left?.revision === right?.revision })
  const old = createMemo(() => versions().find((value) => value.version === other()) ?? null, null, { equals: (left, right) => left?.revision === right?.revision })
  const parts = () => props.making?.sheet?.parts ?? null
  const titled = (part: string) => partTitle(part, parts())
  const modelOf = (value: MakingVersion | null) => (value?.document.kind === "model" ? (value.document as ModelDesign & ModuleDocument) : null)
  const motions = createMemo(() => [...new Set([...(modelOf(current())?.animations ?? []), ...(modelOf(old())?.animations ?? [])].map((value) => value.name))])
  const sendable = createMemo(() => toSend(notes()))
  const mine = createMemo(() => notes().filter((value) => value.source === "person" && value.status === "unsent"))
  // What can be drawn on: a model from the view in hand, a texture on its own picture.
  const drawable = () => !!modelOf(current()) || current()?.document.kind === "texture"
  const drawing = () => !!tool() && !props.locked
  const shape = () => (box().height ? box().width / box().height : null)

  const read = async () => {
    const next = await window.studio.getMakingHistory({ projectId: props.projectId, assetId: props.assetId }).catch(() => null)
    if (!next) return
    setVersions((before) => keepSame(before, next.versions, (value) => value.revision, (left, right) => left.current === right.current))
    setAllNotes((before) => keepSame(before, next.notes, (value) => value.id))
  }
  createEffect(on(() => `${props.assetId}:${props.item.revision}:${props.item.status}:${props.project.revision}`, () => void read()))
  const unsubscribe = window.studio.onCommand((command) => {
    if (command === "trace" || command === "changed") void read()
  })
  createEffect(() => props.onDirty(!!pending()))
  const remove = (id: number) => {
    window.clearTimeout(undoTimers.get(id))
    undoTimers.delete(id)
    // The button that took it back goes now, and the keyboard goes on from a button: with the focus on nothing, Enter would pass the thing on the card.
    const held = document.activeElement?.matches(`.mh-undo[data-note="${id}"]`)
    setGoing((list) => [...list, id])
    if (held) focusOn(".mh-tools button:not(:disabled)")
    const over = () => {
      setGoing((list) => list.filter((value) => value !== id))
      setTaken((list) => list.filter((value) => value !== id))
    }
    return window.studio.changeMakingNote({ projectId: props.projectId, assetId: props.assetId, id, change: "remove" }).then(
      (next) => {
        setAllNotes((before) => keepSame(before, next, (value) => value.id))
        over()
        return true
      },
      (cause: unknown) => {
        over()
        props.onError(plain(cause))
        return false
      },
    )
  }
  onCleanup(() => {
    unsubscribe()
    props.onBar(null)
    props.onDirty(false)
    // Leaving does not bring back what was taken away, it only stops waiting for a change of mind.
    ;[...undoTimers.keys()].forEach((id) => void remove(id))
  })

  const plain = (cause: unknown) => (cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "这一步没成功，请再试一次。")
  const act = async (what: "restore" | "hand" | "keep" | "clear", work: () => Promise<void>) => {
    if (doing()) return
    setDoing(what)
    props.onError("")
    await work().catch((cause: unknown) => props.onError(plain(cause)))
    setDoing("")
  }
  // After an action the button pressed may be gone: the keyboard goes on from somewhere sensible, not from the top of the page.
  const focusOn = (selector: string) => queueMicrotask(() => root?.querySelector<HTMLElement>(selector)?.focus())
  const restore = () =>
    act("restore", async () => {
      const version = other()
      if (!version) return
      const done = await window.studio.restoreVersion({ projectId: props.projectId, assetId: props.assetId, version, expectedRevision: props.project.revision })
      setOther(null)
      props.onChanged(done.view)
      await read()
      props.onSaid(`已回到第 ${version} 版的样子，存成了第 ${done.version} 版。`)
      earnAdvancement(props.projectId, "restored")
    })
  const markOf = (note: MakingNote, shownOn: number | null): AnnotationMark => ({
    kind: note.kind === "frame" ? "text" : note.kind,
    start: pointOnShape(note.start, note.aspect, shownOn),
    ...(note.end && note.kind !== "frame" && note.kind !== "text" ? { end: pointOnShape(note.end, note.aspect, shownOn) } : {}),
    ...(note.kind === "text" ? { text: `${note.id}. ${note.text}` } : note.kind === "frame" ? { text: `${note.id}. 第 ${noteTick(note.frame?.time ?? 0)} 帧` } : {}),
    part: note.part,
    note: note.id,
  })
  // The picture handed over: one angle, and the marks drawn from it. Marks from other angles would fall on the wrong places; they go as words and positions.
  const picture = async () => {
    const marked = sendable().filter((note) => note.source === "person" && note.camera)
    const viewport = views.now
    if (!marked.length || !viewport) return undefined
    const angle = marked[0]!.camera!
    const back = viewport.cameraNow()
    viewport.setCamera(angle)
    const shot: ViewportSnapshot = await viewport.captureCurrent()
    viewport.setCamera(back)
    const load = (source: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error("标注图片无法生成，请再试一次。"))
        image.src = source
      })
    const canvas = document.createElement("canvas")
    canvas.width = shot.width
    canvas.height = shot.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("标注图片无法生成，请再试一次。")
    const marks = marked.filter((note) => sameAngle(note.camera, angle)).map((note) => markOf(note, shot.width / shot.height))
    context.drawImage(await load(shot.dataUrl), 0, 0, shot.width, shot.height)
    context.drawImage(await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(annotationSvg(marks, shot.width, shot.height))}`), 0, 0)
    return { image: canvas.toDataURL("image/png"), width: shot.width, height: shot.height, projectRevision: props.project.revision, marks: marks.map((mark) => ({ note: mark.note!, start: mark.start, ...(mark.end ? { end: mark.end } : {}) })) }
  }
  const hand = () =>
    act("hand", async () => {
      const ids = sendable().map((note) => note.id)
      if (!ids.length) return
      const titles = Object.fromEntries(sendable().flatMap((note) => (note.part ? [[note.part, titled(note.part)]] : [])))
      const shown = await picture()
      const next = await window.studio.sendMakingNotes({ projectId: props.projectId, assetId: props.assetId, ids, onlyMarked: onlyMarked(), ...(extra().trim() ? { extra: extra().trim().slice(0, 200) } : {}), titles, ...(shown ? { picture: shown } : {}) })
      setAllNotes(next)
      setExtra("")
      props.onHanded()
      props.onChanged()
      earnAdvancement(props.projectId, "handed")
      props.onSaid(props.external ? "批注记下了。" : "批注交给 AI 了，做好以后这里会标出来。")
    })
  createEffect(() => {
    const now = current()
    const chosen = old()
    const count = sendable().length
    props.onBar({
      restore: chosen && now && !chosen.current ? { label: doing() === "restore" ? "正在回到旧版…" : `回到第 ${chosen.version} 版`, hint: props.locked || `另存成第 ${now.version + 1} 版，现在的第 ${now.version} 版还在`, disabled: !!props.locked || !!doing(), run: () => void restore() } : null,
      hand: count ? { label: doing() === "hand" ? "正在交给 AI…" : `把 ${count} 条批注交给 AI`, disabled: !!props.locked || !!doing(), why: props.locked, run: () => void hand() } : null,
    })
  })

  // A mark means something only from the view it was drawn on: turned away, the marks stand aside until it is turned back.
  // A flat picture has no view to turn away from: its marks always stand.
  const shownMarks = createMemo(() => notes().filter((note) => note.source === "person" && note.status !== "fixed" && (note.camera ? sameAngle(note.camera, viewNow()) : !modelOf(current()))))
  const hiddenMark = () => notes().find((note) => note.source === "person" && note.camera && note.status !== "fixed" && !sameAngle(note.camera, viewNow()))
  const hiddenCount = () => notes().filter((note) => note.source === "person" && note.camera && note.status !== "fixed" && !sameAngle(note.camera, viewNow())).length
  const turnBack = (state: ViewportCameraState | null | undefined) => {
    if (!state) return
    views.now?.setCamera(state)
    views.old?.setCamera(state)
    setViewNow(state)
  }
  const cancelNote = () => {
    setPending(null)
    setDragging(false)
    setWords("")
    setEscapeOnce(false)
  }
  const choose = (next: Tool) => {
    const was = tool()
    setTool(was === next ? null : next)
    cancelNote()
    // The picture a frame was chosen on was held still for it: leaving, it moves again.
    if (was === "frame" && tool() !== "frame") views.now?.resume(clip() || undefined)
    if (tool()) setViewNow(views.now?.cameraNow() ?? null)
    if (next === "frame" && !clip()) setClip(motions()[0] ?? "")
  }
  // The AI took the thing while a tool was out: nothing can be marked now, and the view must not stay covered.
  createEffect(on(() => props.locked, (locked) => {
    if (!locked) return
    setTool(null)
    setDragging(false)
  }, { defer: true }))
  // Escape here belongs to what is in hand, not to the card: first the note being written (asking once if there are words in it), then the tool.
  createEffect(() => {
    if (!tool() && !pending()) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return
      // The card's own question stands over all this, and the key is its.
      if (document.querySelector(".pa-ask")) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (pending()) {
        if (words().trim() && !escapeOnce()) return setEscapeOnce(true)
        cancelNote()
        return focusOn('.mh-tools [aria-pressed="true"]')
      }
      const was = tool()
      if (was) choose(was)
      focusOn(`.mh-tools button[data-tool="${was}"]`)
    }
    window.addEventListener("keydown", key, true)
    onCleanup(() => window.removeEventListener("keydown", key, true))
  })
  createEffect(() => {
    const element = host
    if (!element) return
    const watch = new ResizeObserver(() => setBox({ width: element.clientWidth, height: element.clientHeight }))
    watch.observe(element)
    onCleanup(() => watch.disconnect())
  })
  const pointAt = (event: PointerEvent & { currentTarget: SVGSVGElement }) => annotationPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
  const noteBase = (start: { x: number; y: number }) => ({ start, part: views.now?.partAt(start.x, start.y) ?? null, camera: views.now?.cameraNow() ?? null, text: "", frame: null, aspect: shape() })
  const placeAt = (using: Tool, start: { x: number; y: number }) => {
    if (using === "text") return setPending({ ...noteBase(start), kind: "text" })
    return setPending({ ...noteBase(start), kind: "frame", frame: { clip: clip() || (motions()[0] ?? "待机"), time: frameTime() } })
  }
  const begin = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    const using = tool()
    if (!using || event.button !== 0 || props.locked) return
    const start = pointAt(event)
    setWords("")
    setEscapeOnce(false)
    if (using === "text" || using === "frame") return placeAt(using, start)
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    setPending({ ...noteBase(start), kind: using, end: start })
  }
  const move = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    const mark = pending()
    if (dragging() && mark) setPending({ ...mark, end: pointAt(event) })
  }
  const finish = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    if (!dragging()) return
    setDragging(false)
    const mark = pending()
    if (!mark?.end) return
    const size = box()
    const end = pointAt(event)
    // A press with no drag is not a mark.
    if (Math.hypot((end.x - mark.start.x) * size.width, (end.y - mark.start.y) * size.height) < 5) return setPending(null)
    const middle = { x: (mark.start.x + end.x) / 2, y: (mark.start.y + end.y) / 2 }
    setPending({ ...mark, end, part: mark.part ?? views.now?.partAt(middle.x, middle.y) ?? null })
  }
  // The keyboard has no drag: Enter on the picture marks its middle, and the words say what is meant.
  const placeByKey = (event: KeyboardEvent) => {
    const using = tool()
    if (event.key !== "Enter" || !using || props.locked) return
    event.preventDefault()
    event.stopPropagation()
    setWords("")
    setEscapeOnce(false)
    if (using === "text" || using === "frame") return placeAt(using, { x: 0.5, y: 0.5 })
    setPending({ ...noteBase({ x: 0.5, y: 0.5 }), kind: using, start: using === "arrow" ? { x: 0.75, y: 0.25 } : { x: 0.38, y: 0.38 }, end: using === "arrow" ? { x: 0.52, y: 0.48 } : { x: 0.62, y: 0.62 } })
  }
  const keep = () =>
    act("keep", async () => {
      const note = pending()
      if (!note) return
      const next = await window.studio.addMakingNote({ projectId: props.projectId, assetId: props.assetId, note: { ...note, text: words().trim() } })
      setAllNotes(next)
      setViewNow(note.camera)
      cancelNote()
      props.onSaid(`第 ${next.at(-1)?.id ?? ""} 条记下了。`)
      focusOn('.mh-tools [aria-pressed="true"]')
    })
  const reopen = (id: number) =>
    act("keep", async () => {
      setAllNotes(await window.studio.changeMakingNote({ projectId: props.projectId, assetId: props.assetId, id, change: "reopen" }))
      props.onSaid(`第 ${id} 条已恢复为待修改，可以再交一次。`)
    })
  // Taken away at once on screen, really gone a few seconds later unless it is taken back.
  const take = (id: number) => {
    setTaken((list) => [...list, id])
    undoTimers.set(id, window.setTimeout(() => void remove(id), UNDO_FOR))
    focusOn(`.mh-undo[data-note="${id}"]`)
  }
  const undo = (id: number) => {
    window.clearTimeout(undoTimers.get(id))
    undoTimers.delete(id)
    setTaken((list) => list.filter((value) => value !== id))
    focusOn(`.mh-note[data-note="${id}"] button`)
  }
  const clearMine = () => {
    const list = mine()
    props.onAsk({
      title: `清掉 ${list.length} 条还没交的批注？`,
      lines: ["清掉以后找不回来。交过的和审查提的不受影响。"],
      names: [],
      actions: [{ label: "清掉", run: () => void act("clear", async () => {
        // What went, not what was asked for; why the rest did not is on screen already.
        const gone = (await Promise.all(list.map((note) => remove(note.id)))).filter(Boolean).length
        if (gone) props.onSaid(gone === list.length ? `清掉了 ${gone} 条批注。` : `清掉了 ${gone} 条批注，还有 ${list.length - gone} 条没清掉。`)
      }) }],
    })
  }
  const goToNote = (note: MakingNote) => {
    turnBack(note.camera)
    if (note.frame) {
      setClip(note.frame.clip)
      setFrameTime(note.frame.time)
    }
  }
  const playBoth = () => {
    const name = clip() || motions()[0]
    if (!name) return
    setClip(name)
    setFrameTime(0)
    views.now?.resume(name)
    views.old?.resume(name)
  }
  const frameLength = () => modelOf(current())?.animations.find((value) => value.name === clip())?.length ?? 1
  const preview = (version: MakingVersion | null, side: "old" | "now") => {
    const model = modelOf(version)
    return (
      <Show when={model} fallback={<ModuleDocumentPreview document={version?.document ?? null} project={props.project} />}>
        <ModelCanvas
          view={{ model }}
          modes={[]}
          animation={clip() || undefined}
          time={tool() === "frame" && side === "now" ? frameTime() : undefined}
          camera={link()?.from !== side ? (link()?.state ?? null) : null}
          onCamera={(state) => {
            setLink({ from: side, state })
            setViewNow(state)
          }}
          onViewport={(viewport) => {
            views[side] = viewport
            if (!viewport) return
            // A view put up anew (a new version, the other side opened) stands at the angle in use, so the two are compared alike and the marks stay on what they point at.
            const kept = untrack(viewNow)
            if (kept) viewport.setCamera(kept)
            else if (side === "now") setViewNow(viewport.cameraNow())
          }}
          rawNames={props.advanced}
        />
      </Show>
    )
  }
  const layers = createMemo(() => {
    const size = box()
    const on = shape()
    const draft = pending()
    const marks: AnnotationMark[] = [
      ...shownMarks().map((note) => markOf(note, on)),
      ...(draft ? [{ kind: draft.kind === "frame" ? ("text" as const) : draft.kind, start: draft.start, ...(draft.end ? { end: draft.end } : {}), ...(draft.kind === "frame" || draft.kind === "text" ? { text: draft.kind === "frame" ? `第 ${noteTick(frameTime())} 帧` : "这里" } : {}), part: draft.part }] : []),
    ]
    return size.width ? annotationLayers(marks, size.width, size.height) : ""
  })
  const toolHint = () => (tool() === "text" || tool() === "frame" ? "在图上点一下放这一条" : "在图上拖一下")

  return (
    <section class="mh-floor" aria-label="版本和批注" ref={root}>
      <div class="mh-main">
        <Show when={!props.making}>
          <small class="mh-hint" data-testid="history-no-making">{NO_MAKING_RECORD_WORDS}</small>
        </Show>
        <div class="mh-versions" role="group" aria-label="版本">
          <span class="mh-label">版本</span>
          <For each={versions()} fallback={<span class="mh-hint">这一样还没有保存过。</span>}>
            {(version) => (
              <button
                type="button"
                class="mh-version"
                data-version={version.version}
                aria-current={version.current ? "true" : undefined}
                aria-pressed={other() === version.version}
                title={version.current ? "这是现在这一版" : "点一下，和现在这一版并排比"}
                disabled={version.current}
                onClick={() => setOther(other() === version.version ? null : version.version)}
              >
                <span class="mc-slot mh-version-slot">
                  <FloorPicture picture={draftPicture({ kind: version.document.kind, title: `${version.title} ${version.version}`, asset_id: props.assetId, document: version.document, progress: version.version })} glyph="cube" />
                </span>
                <small>
                  第 {version.version} 版 · {versionWords(version)}
                </small>
              </button>
            )}
          </For>
          <Show when={versions().length > 1 && versions().length < 4}>
            <span class="mh-hint mh-right">点一版就和现在并排比</span>
          </Show>
        </div>
        <div class="mh-tools" role="group" aria-label="在图上标">
          <span class="mh-label">在图上标：</span>
          <For each={TOOLS.filter((value) => value.id !== "frame" || motions().length)}>
            {(value) => (
              <button type="button" class="ml-button" data-tool={value.id} aria-pressed={tool() === value.id} disabled={!!props.locked || !drawable()} title={props.locked || (drawable() ? undefined : "这种东西没有图可以标")} onClick={() => choose(value.id)}>
                {value.label}
              </button>
            )}
          </For>
          <Show when={motions().length && (tool() === "frame" || old())}>
            <select aria-label="哪个动作" value={clip() || motions()[0]} onChange={(event) => setClip(event.currentTarget.value)}>
              <For each={motions()}>{(name) => <option value={name}>{props.advanced ? name : motionTitle(name, false)}</option>}</For>
            </select>
          </Show>
          <Show when={old() && motions().length}>
            <button type="button" class="ml-button" onClick={playBoth}>
              一起播放
            </button>
          </Show>
          <Show when={tool() === "frame"}>
            <input type="range" aria-label="动作的哪一帧" min={0} max={frameLength()} step={0.05} value={frameTime()} onInput={(event) => setFrameTime(Number(event.currentTarget.value))} />
            <small class="mh-hint">第 {noteTick(frameTime())} 帧</small>
          </Show>
          <button type="button" class="ml-button mh-right" disabled={!!doing() || !mine().length} title={mine().length ? undefined : "现在没有还没交的批注"} onClick={clearMine}>
            清掉我标的
          </button>
          <Show when={drawing()}>
            <small class="mh-hint mh-tool-hint" role="status">
              {toolHint()}，或者按回车标在中间。要转模型，再点一次工具或者按 Esc。
            </small>
          </Show>
          <Show when={props.locked}>
            <small class="mh-hint mh-tool-hint">{props.locked}</small>
          </Show>
        </div>
        <div class="mh-stages" data-side-by-side={!!old()} data-link={link()?.from ?? ""}>
          <Show when={old()} keyed>
            {(version) => (
              <div class="mh-stage" data-testid="history-old">
                <span class="mh-chip">第 {version.version} 版</span>
                {preview(version, "old")}
              </div>
            )}
          </Show>
          <div class="mh-stage" data-testid="history-now" ref={host}>
            <span class="mh-chip mh-chip-now">第 {current()?.version ?? 1} 版 · 现在</span>
            <Show when={current()} keyed>
              {(version) => preview(version, "now")}
            </Show>
            <svg class="mh-marks" classList={{ drawing: drawing() }} role="img" aria-label={`图上的批注：看得见 ${shownMarks().length} 条`} tabindex={drawing() ? 0 : -1} viewBox={`0 0 ${box().width || 1} ${box().height || 1}`} onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelNote} onKeyDown={placeByKey} innerHTML={layers()} />
            <Show when={hiddenCount() > 0 && !tool()}>
              <button type="button" class="ml-button mh-turn-back" onClick={() => turnBack(hiddenMark()?.camera)}>
                转到标注的角度（还有 {hiddenCount()} 条）
              </button>
            </Show>
          </div>
        </div>
      </div>
      <aside class="mh-notes" aria-label="批注">
        <div class="mh-notes-head">
          <strong>批注 · {sendable().length} 条没交</strong>
          <small>一直留着</small>
        </div>
        <Show when={pending() && !dragging()}>
          <div class="bn-note mh-compose">
            <label for="mh-note-words">{pending()!.part ? `这一处（${titled(pending()!.part!)}）想怎么改？` : "这一处想怎么改？"}</label>
            <textarea
              id="mh-note-words"
              rows={2}
              maxLength={1000}
              value={words()}
              ref={(element) => window.setTimeout(() => element.focus())}
              onInput={(event) => {
                setWords(event.currentTarget.value)
                setEscapeOnce(false)
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing && !(pending()!.kind === "text" && !words().trim())) {
                  event.preventDefault()
                  void keep()
                }
              }}
            />
            <Show when={escapeOnce()} fallback={<small class="mh-compose-hint">Ctrl + 回车记下{words().length >= 900 ? ` · ${words().length} / 1000 字` : ""}</small>}>
              <small class="mh-compose-hint" role="status">
                再按一次 Esc，这一条就不要了。
              </small>
            </Show>
            <div class="mh-compose-actions">
              <button type="button" class="ml-button" disabled={!!doing() || (pending()!.kind === "text" && !words().trim())} title={pending()!.kind === "text" && !words().trim() ? "写一句才能记下" : undefined} onClick={() => void keep()}>
                {doing() === "keep" ? "正在记下…" : "记下这一条"}
              </button>
              <button
                type="button"
                class="ml-button"
                onClick={() => {
                  cancelNote()
                  focusOn('.mh-tools [aria-pressed="true"]')
                }}
              >
                算了
              </button>
            </div>
          </div>
        </Show>
        <ol class="mh-note-list">
          <For each={taken()}>
            {(id) => (
              <li class="mh-taken">
                <span>删掉了第 {id} 条</span>
                <Show when={!going().includes(id)} fallback={<span>正在删…</span>}>
                  <button type="button" class="pa-link mh-undo" data-note={id} onClick={() => undo(id)}>
                    撤销
                  </button>
                </Show>
              </li>
            )}
          </For>
          <For each={notes()} fallback={<Show when={!taken().length}><li class="mh-hint">{!drawable() ? "这种东西没有图可以标。想改哪里，点下面的「想让 AI 改一改」说一句。" : tool() ? "在左边的图上标一处。" : "想改哪里，在图上圈出来、写一句。"}</li></Show>}>
            {(note) => (
              <li class="bn-note mh-note" data-note={note.id} data-status={note.status} data-source={note.source}>
                <Show when={note.camera || note.frame} fallback={<span class="mh-note-number">{note.id}</span>}>
                  <button type="button" class="mh-note-number" aria-label={`第 ${note.id} 条，转到它标的地方`} title="转到这一条标的地方" onClick={() => goToNote(note)}>
                    {note.id}
                  </button>
                </Show>
                <span class="mh-note-words">
                  {note.text || "（看图上标的）"}
                  <small>
                    {notePlace(note, titled, (name) => (props.advanced ? name : motionTitle(name, false)))} · {noteStanding(note, props.external && !props.locked)}
                  </small>
                </span>
                <Show when={note.status === "fixed"}>
                  <button type="button" class="pa-link" disabled={!!doing()} onClick={() => void reopen(note.id)}>
                    还没改好
                  </button>
                </Show>
                <Show when={note.status === "unsent"}>
                  <button type="button" class="pa-link" aria-label={`删掉第 ${note.id} 条`} onClick={() => take(note.id)}>
                    删掉
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ol>
        <Show when={sendable().length}>
          <label class="mh-extra">
            <span class="mh-hint">再补一句（可不写）</span>
            <textarea rows={2} maxLength={200} value={extra()} onInput={(event) => setExtra(event.currentTarget.value)} />
          </label>
          <label class="mh-only">
            <input type="checkbox" checked={onlyMarked()} onChange={(event) => setOnlyMarked(event.currentTarget.checked)} />
            只改标到的地方，别的不动
          </label>
          <small class="mh-hint mh-brief" title={noteBrief(sendable(), { onlyMarked: onlyMarked(), extra: extra(), title: titled })}>
            交给 AI 的是这 {sendable().length} 条和图上的位置。
          </small>
        </Show>
      </aside>
    </section>
  )
}

import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { REFERENCE_LIMITS, THREE_VIEW_NOTE, SixViewStyleSchema, viewSlot, type SixViewStyle } from "@minemods/studio-ai/making"
import type { ActivityEvent, ReferenceImage, StudioApi, ThreeViewSlot } from "../../api"
import { ask } from "../confirm-dialog"
import { Button, Icon } from "../ui"
import { dropZone, PASTED_NAME, PICTURE_ACCEPT, PictureZoom, pastedPictures, pictureFiles, pictureRefusal, plainFailure, readPicture } from "./picture-input"
import { askAboutThreeViews, coverWords, hasThreeView, replacedWords, slotFor, slotsOf, THREE_VIEW_WORDS as WORDS, threeViewSlots, type ShownSlot } from "./three-view-model"
import "./three-view.css"

type Drawing = Awaited<ReturnType<StudioApi["threeViewDrawing"]>>

const keyOf = (projectId: string, itemId: string) => `${projectId}\n${itemId}`
// Whether each thing has a 六视图, as last read anywhere in the window: the overview card's 「还没有六视图」 goes by it.
const [known, setKnown] = createStore<Record<string, boolean>>({})
const remember = (projectId: string, itemId: string, list: readonly ReferenceImage[]) => setKnown(keyOf(projectId, itemId), hasThreeView(list))
/** True or false once this thing's pictures were read here; undefined before that. */
export const threeViewKnown = (projectId: string, itemId: string): boolean | undefined => known[keyOf(projectId, itemId)]

// The thing whose block should come into view: set by 「先去加六视图」, taken by that block as soon as it is on screen.
const [wanted, setWanted] = createSignal<string | null>(null)
export const showThreeView = (projectId: string, itemId: string) => setWanted(keyOf(projectId, itemId))

// Whether an image model is there to draw one: read again whenever it matters, since the connection can change at any time.
const [drawing, setDrawing] = createSignal<Drawing | null>(null)
const readDrawing = () =>
  window.studio.threeViewDrawing().then(
    (value) => (setDrawing(value), value),
    () => null,
  )

/**
 * Asked before making starts on things among `items` that are models without a 六视图: a question, never a
 * wall, and asked at most once for a thing: 「直接开始」 is kept in the project, and a thing that already has a saved model is
 * never asked about (`asksAboutThreeView`). True to go on. On 「先去加六视图」 nothing starts: `onAdd` is given the first such
 * thing to open its page, and its 六视图 block comes into view. A thing whose pictures cannot be read is not asked about.
 */
export async function threeViewsReady<T extends { id: string; title: string; kind: string; facts?: { saved: boolean } }>(projectId: string, items: readonly T[], onAdd?: (item: T) => void): Promise<boolean> {
  const answer = await askAboutThreeViews({
    items,
    byWords: (item) => window.studio.threeViewByWords({ projectId, itemId: item.id }),
    references: (item) =>
      window.studio.getReferences({ projectId, itemId: item.id }).then(
        (list) => (remember(projectId, item.id, list), list as readonly { kind: string }[]),
        () => undefined,
      ),
    canDraw: async () => { const value = await readDrawing(); return value?.mode === "mcp" || !!value?.can },
    ask,
    choose: (item) => window.studio.chooseThreeViewByWords({ projectId, itemId: item.id }),
  })
  if (answer.go) return true
  onAdd?.(answer.first)
  showThreeView(projectId, answer.first.id)
  return false
}

/** The overview card's small mark for a model that has no 六视图 yet. Says nothing until its pictures were read. */
export function ThreeViewMissing(props: { projectId: string; itemId: string }) {
  return (
    <Show when={threeViewKnown(props.projectId, props.itemId) === false}>
      <em class="tv-missing" title={WORDS.missingTitle}>
        {WORDS.missing}
      </em>
    </Show>
  )
}

const zoomName = (view: ThreeViewSlot) => ((slot) => (slot === "sheet" ? WORDS.whole : WORDS.slots[slot]))(viewSlot(view))
const byWords = (reference: ReferenceImage) => (reference.by === "ai" ? WORDS.byAi : WORDS.byPerson)

/**
 * The 六视图 of one model thing: one whole sheet, or the six views apart (正面、背面、它的左侧 / 它的右侧、从上往下、斜前方, three to a
 * row as the six-angle renders lie, named as they are), each in a slot of its own; an old 侧面 shows as its left. The person
 * puts a picture in by clicking an empty slot, dropping on it, or pasting while pointing at the block; or asks the
 * connected image model to draw one, then keeps it, has it drawn again, or drops it. `listed` is the item's
 * `Making.references`: when it changes the pictures are read again. `locked` says why nothing can be changed now.
 */
export function ThreeViewBlock(props: { projectId: string; itemId: string; listed?: { id: string }[]; locked: string }) {
  let input!: HTMLInputElement
  let host!: HTMLElement
  const [held, setHeld] = createSignal<ReferenceImage[]>([])
  const [layout, setLayout] = createSignal<"sheet" | "split">("sheet")
  const [wrong, setWrong] = createSignal("")
  const [working, setWorking] = createSignal<"" | "add" | "remove" | "draw">("")
  const [over, setOver] = createSignal(false)
  const [aimed, setAimed] = createSignal<ShownSlot | null>(null)
  const [picking, setPicking] = createSignal<ShownSlot>("sheet")
  const [large, setLarge] = createSignal<ReferenceImage | null>(null)
  const [note, setNote] = createSignal("")
  const [copying, setCopying] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  const [manualTask, setManualTask] = createSignal("")
  const [handoffError, setHandoffError] = createSignal("")
  const [reported, setReported] = createSignal<ActivityEvent | null>(null)
  // The AI's drawing just came back here: the person is asked what to do with it.
  const [fresh, setFresh] = createSignal(false)
  const [uploadStyle, setUploadStyle] = createSignal<SixViewStyle | undefined>()
  const [called, setCalled] = createSignal(false)
  const slots = () => threeViewSlots(held())
  const stuck = () => !!props.locked.trim()
  const closed = () => stuck() || !!working()
  const drawn = () => held().filter((value) => value.kind === "three_view" && value.by === "ai")
  // The image model only ever replaces its own drawing, so once the person has given one it is theirs to change.
  const given = () => held().some((value) => value.kind === "three_view" && value.by !== "ai")
  const external = () => drawing()?.mode === "mcp"
  const visibleResult = () => reported()?.mark === "ok" && !drawn().length || reported()?.mark === "warn" && given() ? null : reported()
  let pointing = false
  let handedAt = 0

  const take = (list: ReferenceImage[]) => {
    setHeld(list)
    remember(props.projectId, props.itemId, list)
    const laid = threeViewSlots(list).layout
    if (laid) setLayout(laid)
  }
  // By value, all three: the ids are read off a view that is new at every save, and a note half written here must not go with it.
  const listedOf = createMemo(() => `${props.projectId}:${props.itemId}:${(props.listed ?? []).map((value) => value.id).join(",")}`)
  const thingOf = createMemo(() => keyOf(props.projectId, props.itemId))
  const followed = createMemo(() => `${thingOf()}:${external()}`)
  createEffect(
    on(
      listedOf,
      () => {
        const asked = keyOf(props.projectId, props.itemId)
        void window.studio.getReferences({ projectId: props.projectId, itemId: props.itemId }).then(
          (list) => asked === keyOf(props.projectId, props.itemId) && take(list),
          () => undefined,
        )
      },
    ),
  )
  createEffect(on(thingOf, () => (handedAt = 0, setWrong(""), setLarge(null), setFresh(false), setUploadStyle(undefined), setNote(""), setCopied(false), setManualTask(""), setHandoffError(""), setReported(null), setCopying(false)), { defer: true }))
  void readDrawing()
  // The outside AI writes through MCP. Follow its actual saved pictures and result while this card is open.
  createEffect(on(followed, () => {
    if (!external()) return
    const projectId = props.projectId
    const itemId = props.itemId
    let after = 0
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      await Promise.all([
        window.studio.getReferences({ projectId, itemId }),
        window.studio.getActivity({ projectId, after }),
      ]).then(([list, activity]) => {
        if (stopped) return
        // Unchanged saved images must not reset the layout the person is choosing for their next upload.
        if (list.length !== held().length || list.some((value, index) => value.id !== held()[index]?.id)) take(list)
        after = activity.last
        const result = activity.events.filter((event) => event.item === itemId && event.tool === "finish_six_view" && event.end && (event.mark === "ok" || event.mark === "warn")).at(-1)
        if (!result) return
        setReported(result)
        // An older result loaded after a new copy attempt must not dismiss that attempt's feedback.
        if (Date.parse(result.at) < handedAt) return
        setCopied(false)
        setManualTask("")
        setHandoffError("")
      }, () => undefined)
      if (!stopped) timer = setTimeout(() => void poll(), 1500)
    }
    void poll()
    onCleanup(() => { stopped = true; clearTimeout(timer) })
  }))
  const copyTask = async () => {
    if (copying() || closed() || given()) return
    const asked = keyOf(props.projectId, props.itemId)
    const started = Date.now()
    handedAt = started
    const current = () => asked === keyOf(props.projectId, props.itemId) && handedAt === started
    const waiting = () => current() && (Date.parse(reported()?.at ?? "") || 0) < started
    setCopying(true)
    setCopied(false)
    setManualTask("")
    setHandoffError("")
    await window.studio.getThreeViewPrompt({ projectId: props.projectId, itemId: props.itemId }).then(async (text) => {
      if (!current()) return
      await window.studio.copyText({ text }).then(() => {
        if (waiting()) setCopied(true)
      }, () => {
        if (!waiting()) return
        setManualTask(text)
        setHandoffError(WORDS.copyFailed)
      })
    }, (error: unknown) => { if (waiting()) setHandoffError(plainFailure(error, WORDS.taskFailed)) })
    if (current()) setCopying(false)
  }
  // Sent here by 「先去加六视图」: come into view and say where to start.
  createEffect(() => {
    if (wanted() !== keyOf(props.projectId, props.itemId)) return
    setWanted(null)
    setCalled(true)
    queueMicrotask(() => {
      host.scrollIntoView({ block: "center", behavior: "smooth" })
      host.querySelector<HTMLElement>(external() ? ".tv-handoff button:not(:disabled)" : ".tv-slot:not(:disabled)")?.focus({ preventScroll: true })
    })
  })

  /** One picture into one slot. Refused here first with the project's own words, then by the project. */
  const put = async (slot: ShownSlot, files: File[]) => {
    const file = pictureFiles(files)[0]
    if (!file || closed()) return
    setWrong("")
    if (pictureRefusal(file)) return setWrong(pictureRefusal(file))
    setWorking("add")
    const style = uploadStyle()
    await readPicture(file)
      .then((url) => window.studio.addThreeView({ projectId: props.projectId, itemId: props.itemId, view: slot, name: file.name || PASTED_NAME, url, ...(style ? { style } : {}) }))
      .then((list) => { take(list); setReported(null) }, (error: unknown) => setWrong(plainFailure(error, WORDS.failedAdd)))
    setWorking("")
  }
  const remove = async (list: ReferenceImage[]) => {
    if (!list.length || closed()) return
    setWrong("")
    setWorking("remove")
    await list
      .reduce<Promise<unknown>>((before, reference) => before.then(() => window.studio.removeReference({ projectId: props.projectId, itemId: props.itemId, referenceId: reference.id }).then(take)), Promise.resolve())
      .catch(() => setWrong(WORDS.failedRemove))
    setFresh(false)
    setWorking("")
  }
  const draw = async () => {
    if (closed() || !drawing()?.can) return
    setWrong("")
    setFresh(false)
    setWorking("draw")
    const words = note().trim().slice(0, THREE_VIEW_NOTE)
    await window.studio.drawThreeView({ projectId: props.projectId, itemId: props.itemId, ...(words ? { note: words } : {}) }).then(
      (list) => (take(list), setFresh(true)),
      (error: unknown) => setWrong(plainFailure(error, WORDS.failedDraw)),
    )
    setWorking("")
  }
  const pick = (slot: ShownSlot) => {
    setPicking(slot)
    input.click()
  }
  // A pasted picture is this block's while the person points at it or works in it; otherwise the 参考图 tray takes it.
  const pasted = (event: ClipboardEvent) => {
    if (closed() || !(pointing || host.contains(document.activeElement))) return
    const files = pastedPictures(event)
    if (!files.length) return
    event.preventDefault()
    void put(slotFor(slots(), layout(), aimed()), files)
  }
  window.addEventListener("paste", pasted, true)
  onCleanup(() => window.removeEventListener("paste", pasted, true))
  const zone = dropZone({
    closed,
    over: setOver,
    files: (files) => {
      const slot = slotFor(slots(), layout(), aimed())
      setAimed(null)
      void put(slot, files)
    },
  })
  const megabytes = REFERENCE_LIMITS.bytes / 1024 / 1024

  return (
    <section
      ref={host}
      class="tv"
      aria-label={WORDS.title}
      data-over={over()}
      data-called={called()}
      onAnimationEnd={() => setCalled(false)}
      onPointerEnter={() => (pointing = true)}
      onPointerLeave={() => (pointing = false)}
      onDragOver={zone.onDragOver}
      onDragLeave={zone.onDragLeave}
      onDrop={zone.onDrop}
    >
      <header class="tv-head">
        <h5>{WORDS.title}</h5>
        <div class="tv-layout" role="group" aria-label={WORDS.layout}>
          <button type="button" class="pa-move" aria-pressed={layout() === "sheet"} disabled={closed()} onClick={() => setLayout("sheet")}>
            {WORDS.whole}
          </button>
          <button type="button" class="pa-move" aria-pressed={layout() === "split"} disabled={closed()} onClick={() => setLayout("split")}>
            {WORDS.split}
          </button>
        </div>
      </header>
      <p class="tv-meaning">{external() ? WORDS.external : WORDS.meaning}</p>
      <Show when={external()}>
        <div class="tv-handoff">
          <Button primary disabled={copying() || closed() || given()} onClick={() => void copyTask()}>
            <Icon name="copy" />{copying() ? WORDS.copying : WORDS.copyTask}
          </Button>
          <Show when={stuck()}><p class="pa-hint">{props.locked}</p></Show>
          <Show when={!stuck() && given()}><p class="pa-hint">已有你提供的六视图；需要重新生成时，先移除它。</p></Show>
          <Show when={copied()}><p class="pa-hint" role="status">{WORDS.copied}</p></Show>
          <Show when={!copied() && !copying() && !handoffError() && visibleResult()}>{(result) => <p class="tv-result" data-mark={result().mark} role="status">{result().text}<Show when={result().lines?.length}><span>{result().lines!.join(" ")}</span></Show></p>}</Show>
          <Show when={handoffError()}><p class="mk-honest" role="alert">{handoffError()}</p></Show>
          <Show when={manualTask()}><textarea class="tv-task" aria-label={WORDS.task} readonly value={manualTask()} onFocus={(event) => event.currentTarget.select()} /></Show>
        </div>
      </Show>
      <label class="tv-meaning">
        放入的图怎么验
        <select class="ps-select" aria-label="放入的六视图怎么验" disabled={closed()} value={uploadStyle() ?? ""} onChange={(event) => setUploadStyle(SixViewStyleSchema.safeParse(event.currentTarget.value).data)}>
          <option value="">按老规则（默认）</option>
          <option value="angled">按斜板造型</option>
          <option value="sculpted">按精细造型（斜板加圆体）</option>
        </select>
      </label>
      <ul class="tv-slots" data-layout={layout()}>
        <For each={slotsOf(layout())}>
          {(slot) => {
            const picture = () => slots()[slot]
            return (
              <li data-slot={slot} onPointerEnter={() => setAimed(slot)} onPointerLeave={() => setAimed(null)} onDragOver={() => setAimed(slot)}>
                <button
                  type="button"
                  class="tv-slot mc-well"
                  data-empty={!picture()}
                  disabled={!picture() && closed()}
                  title={picture() ? `点一下放大看：${picture()!.name}` : stuck() ? props.locked : `选一张图放进「${WORDS.slots[slot]}」（PNG、JPEG、WebP，不超过 ${megabytes} MB）`}
                  aria-label={picture() ? `放大看：${WORDS.slots[slot]}，${byWords(picture()!)}` : `${WORDS.add}：${WORDS.slots[slot]}`}
                  onFocus={() => setAimed(slot)}
                  onClick={() => (picture() ? setLarge(picture()) : pick(slot))}
                >
                  <Show
                    when={picture()}
                    fallback={
                      <>
                        <b aria-hidden="true">+</b>
                        <span>{working() === "add" && picking() === slot ? WORDS.adding : WORDS.add}</span>
                      </>
                    }
                  >
                    {(value) => <img src={value().url} alt="" draggable={false} />}
                  </Show>
                </button>
                <Show when={layout() === "split"}>
                  <span class="tv-name">{WORDS.slots[slot]}</span>
                </Show>
                <Show when={picture()}>
                  {(value) => (
                    <>
                      <Show when={value().by === "ai"} fallback={<em class="tv-by tv-own">{WORDS.byPerson}</em>}>
                        <em class="tv-by mk-ai" title={WORDS.byAiTitle}>
                          {WORDS.byAi}
                        </em>
                      </Show>
                      <Show when={!stuck()}>
                        <button type="button" class="pa-mini tv-drop" aria-label={`${WORDS.remove}：${WORDS.slots[slot]}`} title={WORDS.remove} disabled={closed()} onClick={() => void remove([value()])}>
                          <Icon name="close" />
                        </button>
                      </Show>
                    </>
                  )}
                </Show>
              </li>
            )
          }}
        </For>
      </ul>
      <input
        ref={input}
        type="file"
        accept={PICTURE_ACCEPT}
        hidden
        onChange={(event) => {
          void put(picking(), [...(event.currentTarget.files ?? [])])
          event.currentTarget.value = ""
        }}
      />
      <Show when={!stuck()}>
        <Show when={replacedWords(slots(), layout())}>{(words) => <p class="pa-hint warn">{words()}</p>}</Show>
        <Show when={layout() === "split" && coverWords(slots())}>{(words) => <p class="pa-hint">{words()}</p>}</Show>
        <Show when={drawing()?.mode === "api"}>
        <Show
          when={working() !== "draw"}
          fallback={
            <p class="tv-busy" role="status">
              <i class="mk-busy" aria-hidden="true" />
              {WORDS.drawing}
            </p>
          }
        >
          <Show
            when={fresh() && drawn().length}
            fallback={
              <Show when={!given()}>
                <div class="tv-draw">
                  <Show
                    when={drawing()?.can}
                    fallback={
                      <>
                        <Button disabled>{WORDS.draw}</Button>
                        <Show when={drawing()?.why}>{(why) => <p class="pa-hint">{why()}</p>}</Show>
                      </>
                    }
                  >
                    <input
                      class="tv-note"
                      aria-label={WORDS.note}
                      placeholder={WORDS.note}
                      maxlength={THREE_VIEW_NOTE}
                      value={note()}
                      disabled={closed()}
                      onInput={(event) => setNote(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" || event.isComposing) return
                        event.preventDefault()
                        void draw()
                      }}
                    />
                    <Button disabled={closed()} onClick={() => void draw()}>
                      {WORDS.draw}
                    </Button>
                  </Show>
                </div>
              </Show>
            }
          >
            <div class="tv-drawn" role="status">
              <span>{WORDS.drawn}</span>
              <div class="tv-actions">
                <Button primary disabled={closed()} onClick={() => setFresh(false)}>
                  {WORDS.keep}
                </Button>
                <Button disabled={closed()} onClick={() => void draw()}>
                  {WORDS.again}
                </Button>
                <Button disabled={closed()} onClick={() => void remove(drawn())}>
                  {WORDS.drop}
                </Button>
              </div>
            </div>
          </Show>
        </Show>
        </Show>
        <p class="pa-hint">{external() ? "独立准备的图片也可以拖入、粘贴，或点击格子添加。" : WORDS.how}</p>
      </Show>
      <Show when={wrong()}>
        <p class="mk-honest" role="alert">
          {wrong()}
        </p>
      </Show>
      <Show when={large()}>
        {(reference) => <PictureZoom label={WORDS.title} title={`${WORDS.title} · ${zoomName(reference().view ?? "sheet")} · ${byWords(reference())}`} url={reference().url} alt={reference().name} onClose={() => setLarge(null)} />}
      </Show>
    </section>
  )
}

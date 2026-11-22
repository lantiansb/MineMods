import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { mushroomCowDesign } from "@minemods/mod-core/example"
import type { StudioView } from "../../api"
import type { ModelProgress } from "../../main/model-core-session"
import { Button, Icon } from "../ui"
import { advanced } from "../advanced"
import { ModelCanvas } from "./model-canvas"
import { motionRows } from "./creature-inside-model"
import { motionNamer } from "./asset-words"
import { ModelAnnotation, type AnnotationCapture } from "./model-annotation"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import {
  boneOf,
  boneFamily,
  createHistory,
  deleteBone,
  deleteKeyframe,
  fillFace,
  keyframeTimes,
  mirrorBone,
  modelPalette,
  moveBone,
  paintTexels,
  rotateBone,
  scaleBone,
  setAnimationTiming,
  setKeyframe,
  texelColor,
  tintBone,
  type Axis,
  type PaintStroke,
  type ModelEditResult,
} from "../model-edit"
import { sampleAnimation } from "../model-core/animation"
import { WORDS } from "../words"
import "./model-workspace.css"
import { ask } from "../confirm-dialog"

// Without an AI there is still a way to a model, and it is a file made elsewhere.
const BLANK_WAYS = "没有 AI 也可以：用 Blockbench 做好 .bbmodel 文件，点右上「导入模型」。"

export function ModelWorkspace(props: {
  view: StudioView
  mode: "model" | "texture" | "animation"
  prompt: string
  promptDirty: boolean
  disabled: boolean
  dirty: boolean
  aiConfigured: boolean
  /** MCP mode: an outside AI makes the model, so the prompt box gives way to a pointer to the task stage. */
  external?: boolean
  /** Whether the next step (behaviour / runtime rules) can be opened. Defaults to having a model. */
  continueReady?: boolean
  /** Said under the way on when the creature has no rules to go on to. */
  continueHint?: string
  onTasks?: () => void
  progress?: ModelProgress | null
  generating?: boolean
  onMode: (mode: "model" | "texture" | "animation") => void
  onPrompt: (value: string) => void
  onGenerate: (prompt: string) => void
  onAnnotate?: (prompt: string, annotation: ModelAnnotationInput) => Promise<unknown>
  onAdd: () => void
  onSelect: (entityId: string) => boolean | void
  onSaved: (view: StudioView) => void
  onDirty: (value: boolean) => void
  onError: (message: string) => void
  onContinue: () => void
  onBack: () => void
}) {
  const [part, setPart] = createSignal("")
  const [playRequest,replay]=createSignal(0)
  const [animation, setAnimation] = createSignal("idle")
  let motionNameInput: HTMLInputElement | undefined
  const nameMotion = (name: string) => {
    setAnimation(name)
    setPinned(null)
    requestAnimationFrame(() => {
      motionNameInput?.scrollIntoView({ block: "center" })
      motionNameInput?.focus({ preventScroll: true })
    })
  }
  const [importing, setImporting] = createSignal(false)
  const [inspectorOpen, setInspectorOpen] = createSignal(false)
  const [bonesOpen, setBonesOpen] = createSignal(true)
  const [capture, setCapture] = createSignal<AnnotationCapture | null>(null)
  const [annotationDirty, setAnnotationDirty] = createSignal(false)
  const entity = () => props.view.project.entities.find((value) => value.id === props.view.entity_id)
  // A separately painted texture is laid out on the current UVs, so only pose edits are safe for it.
  const boundTexture = () => {
    const id = entity()?.runtime?.texture_asset_id
    return id ? (props.view.project.workspace.assets.find((asset) => asset.id === id)?.title ?? "独立贴图") : ""
  }
  // Manual edits live in a local history until the user saves them as a new model version.
  const [edited, setEdited] = createSignal<ModelDesign | null>(null)
  const [historyTick, setHistoryTick] = createSignal(0)
  const [editMessage, setEditMessage] = createSignal("")
  const [savingEdits, setSavingEdits] = createSignal(false)
  const history: { value: ReturnType<typeof createHistory> | null } = { value: null }
  const shown = () => edited() ?? props.view.model
  const storedModel = createMemo(() => JSON.stringify(props.view.model))
  const editsPending = createMemo(() => !!edited() && JSON.stringify(edited()) !== storedModel())
  createEffect(() => props.onDirty(editsPending() || props.promptDirty || annotationDirty()))
  const resetEdits = () => {
    history.value = null
    setEdited(null)
    setEditMessage("")
    setHistoryTick(historyTick() + 1)
  }
  // By what it holds, like the memos below: a refreshed copy of the view that says the same thing does not throw away what was changed by hand.
  createEffect(on(storedModel, resetEdits, { defer: true }))
  // 查看示例 only shows a model made by hand for this purpose: it is held here, never saved, and never counted as
  // the creature's model. A person who pressed it to see what is possible would otherwise find a cow standing in for
  // the moth they named, marked as made. It goes away as soon as the creature gets a model of its own, or another creature is opened.
  const [example, setExample] = createSignal<ModelDesign | null>(null)
  // Memos of plain values, so a refreshed copy of the view that says the same thing does not close the example.
  const openEntity = createMemo(() => props.view.entity_id)
  const hasModel = createMemo(() => !!props.view.model)
  const making = createMemo(() => !!props.generating)
  createEffect(on([openEntity, hasModel, making], () => setExample(null), { defer: true }))
  const editLocked = () => props.disabled || !!props.generating || savingEdits()
  const applyEdit = (operation: (design: ModelDesign) => ModelEditResult) => {
    const current = shown()
    if (!current || editLocked()) return
    const result = operation(current)
    if (!result.ok) {
      setEditMessage(result.message)
      return
    }
    history.value ??= createHistory(current)
    history.value.push(result.design)
    setEdited(result.design)
    setEditMessage("")
    setHistoryTick(historyTick() + 1)
  }
  const stepHistory = (direction: "undo" | "redo") => {
    const stack = history.value
    if (!stack || editLocked() || !(direction === "undo" ? stack.canUndo : stack.canRedo)) return
    setEdited(direction === "undo" ? stack.undo() : stack.redo())
    setEditMessage("")
    setHistoryTick(historyTick() + 1)
  }
  const discardEdits = resetEdits
  const saveEdits = async () => {
    const design = edited()
    if (!design || !entity() || !editsPending() || editLocked()) return
    setSavingEdits(true)
    await window.studio
      .saveModel({
        projectId: props.view.project.id,
        expectedRevision: props.view.project.revision,
        entityId: entity()!.id,
        model: design,
      })
      .then((next) => {
        resetEdits()
        props.onSaved(next)
      })
      .catch((cause) => props.onError(cause instanceof Error ? cause.message : "模型保存失败"))
      .finally(() => setSavingEdits(false))
  }
  onCleanup(() => (history.value = null))
  {
    const shortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (!(event.ctrlKey || event.metaKey) || target?.closest("input, textarea, select, [contenteditable]")) return
      const key = event.key.toLowerCase()
      if (key === "z" && !event.shiftKey) {
        event.preventDefault()
        stepHistory("undo")
      }
      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault()
        stepHistory("redo")
      }
      if (key === "s" && editsPending()) {
        event.preventDefault()
        void saveEdits()
      }
    }
    window.addEventListener("keydown", shortcuts)
    onCleanup(() => window.removeEventListener("keydown", shortcuts))
  }
  // What a press on the part moves: the whole of it, and the parts attached beneath it.
  const carried = (name: string) => {
    const below = [...boneFamily(shown()!, name)].filter((value) => value !== name)
    return below.length ? `改的是这一整组，连带 ${below.slice(0, 3).join("、")}${below.length > 3 ? ` 等 ${below.length} 个部件` : ""}一起动。` : "改的是这一整组。"
  }
  const selectedBone = () => {
    const model = shown()
    const name = boneOf(model, part())
    return name ? model!.bones.find((bone) => bone.name === name) : undefined
  }
  const palette = () => (shown() ? modelPalette(shown()!, 7) : [])
  // Texture painting (贴图 tab). Strokes go through the same history as the other manual edits.
  type PaintTool = "brush" | "eraser" | "picker" | "fill" | "select"
  const [tool, setTool] = createSignal<PaintTool>("brush")
  const [brushColor, setBrushColor] = createSignal("")
  const [recentColors, setRecentColors] = createSignal<string[]>([])
  const currentColor = () => brushColor() || palette()[0] || "#3f7f1e"
  const chooseColor = (color: string) => {
    setBrushColor(color.toLowerCase())
    if (tool() === "eraser" || tool() === "picker" || tool() === "select") setTool("brush")
  }
  const remember = (color: string) =>
    setRecentColors([color, ...recentColors().filter((value) => value !== color)].slice(0, 6))
  const paintMode = () =>
    props.mode === "texture" && !!shown() && tool() !== "select" && !editLocked() && !boundTexture()
      ? { color: tool() === "eraser" ? null : currentColor(), continuous: tool() === "brush" || tool() === "eraser" }
      : null
  const stroke = (strokes: PaintStroke[]) => {
    const first = strokes[0]
    if (!first?.texels[0]) return
    if (tool() === "picker") {
      const color = shown() && texelColor(shown()!, first.part, first.face, first.texels[0])
      if (color) {
        setBrushColor(color)
        setTool("brush")
      }
      return
    }
    if (tool() === "fill") {
      const color = currentColor()
      applyEdit((design) => fillFace(design, first.part, first.face, color))
      remember(color)
      return
    }
    const color = tool() === "eraser" ? null : currentColor()
    applyEdit((design) => paintTexels(design, strokes, color))
    if (color) remember(color)
  }
  // Animation keyframes (动画 step). `pinned` is the time the preview is paused at; null while playing.
  const [pinned, setPinned] = createSignal<number | null>(null)
  const [clock, setClock] = createSignal(0)
  // The motions are listed by the person's words (`motionWords`); the names the model file uses only under 高级.
  const motionName = createMemo(() => {
    const inherited = motionNamer(props.view.project, props.view.project.entities.find(value => value.id === props.view.entity_id)?.model_asset_id)
    return (name: string, raw = false) => {
      const title = shown()?.animations.find(clip => clip.name === name)?.display_name
      if (!title) return inherited(name, raw)
      return raw && title !== name ? title + "（" + name + "）" : title
    }
  })
  const motion = () => shown()?.animations.find((value) => value.name === animation()) ?? shown()?.animations[0]
  const now = () => pinned() ?? clock()
  const pin = (time: number) => {
    const length = motion()?.length ?? 1
    setPinned(Math.min(length, Math.max(0, Math.round(time * 20) / 20)))
  }
  const allKeys = () => (shown() && motion() ? keyframeTimes(shown()!, motion()!.name) : [])
  const boneKeys = () =>
    shown() && motion() && selectedBone() ? keyframeTimes(shown()!, motion()!.name, selectedBone()!.name) : []
  const keyHere = () => boneKeys().some((time) => Math.abs(time - now()) < 0.005)
  const poseNow = (): [number, number, number] =>
    (motion() && selectedBone() ? sampleAnimation(motion()!, selectedBone()!.name, now()) : undefined) ?? [0, 0, 0]
  const recordKey = (rotation = poseNow()) => {
    const name = motion()?.name
    const bone = selectedBone()?.name
    if (!name || !bone) return
    const time = now()
    setPinned(time)
    applyEdit((design) => setKeyframe(design, name, bone, time, rotation))
  }
  const turnKey = (axis: Axis, degrees: number) => {
    const pose = poseNow()
    pose[axis] += degrees
    recordKey(pose)
  }
  const jumpKey = (direction: 1 | -1) => {
    const keys = selectedBone() ? boneKeys() : allKeys()
    const target =
      direction > 0 ? keys.find((time) => time > now() + 0.005) : [...keys].reverse().find((time) => time < now() - 0.005)
    if (target !== undefined) setPinned(target)
  }
  let track!: HTMLDivElement
  const seekTrack = (event: PointerEvent) => {
    const bounds = track.getBoundingClientRect()
    pin(((event.clientX - bounds.left) / bounds.width) * (motion()?.length ?? 1))
  }
  createEffect(on(animation, () => setPinned(null), { defer: true }))
  const tools: { id: PaintTool; label: string; hint: string }[] = [
    { id: "brush", label: "画笔", hint: "按住左键在模型表面涂色" },
    { id: "eraser", label: "橡皮", hint: "擦回这一面原来的底色" },
    { id: "picker", label: "吸管", hint: "点模型取色" },
    { id: "fill", label: "整面填充", hint: "把点到的整面换成当前颜色" },
    { id: "select", label: "选择部件", hint: "点模型选中部件，不绘制" },
  ]
  const move = (axis: Axis, delta: number) => applyEdit((design) => moveBone(design, selectedBone()!.name, axis, delta))
  const turn = (axis: Axis, degrees: number) =>
    applyEdit((design) => rotateBone(design, selectedBone()!.name, axis, degrees))
  const formatVector = (value: readonly number[]) => value.map((item) => item.toFixed(1)).join("  ")
  const importModel = async (file: File) => {
    if (props.disabled || !entity()) return
    if (file.size > 8 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".bbmodel")) {
      props.onError("请选择 8 MB 以内的 .bbmodel 模型文件。")
      return
    }
    // The model there now is not kept anywhere the page can bring back: said before, with the way to keep a copy.
    if (props.view.model && !(await ask({ title: "导入会替换现在的模型", text: "替换后不能撤销。想留一份，先点「导出模型」。", confirm: "替换", cancel: "先不导入" }))) return
    setImporting(true)
    await file
      .text()
      .then((text) =>
        window.studio.saveBlockbench({
          projectId: props.view.project.id,
          expectedRevision: props.view.project.revision,
          entityId: entity()!.id,
          snapshot: JSON.parse(text),
        }),
      )
      .then(props.onSaved)
      .catch((cause) => props.onError(cause instanceof Error ? cause.message : "模型导入失败"))
      .finally(() => setImporting(false))
  }
  const exportModel = () => {
    if (!props.view.blockbench) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(props.view.blockbench, null, 2)], { type: "application/json" }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${entity()?.name ?? "model"}.bbmodel`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section class="editor-page model-workspace" aria-label="做模型">
      <header class="page-heading">
        <div class="model-heading-copy">
          <button class="model-back" onClick={props.onBack}>
            <Icon name="undo" />
            回到工程总览
          </button>
          <div class="model-title-row">
            <h1>{entity()?.name ?? "做模型"}</h1>
            <Show when={props.dirty}>
              <span class="model-dirty" aria-label="有未保存修改">
                未保存
              </span>
            </Show>
          </div>
        </div>
        <div class="page-actions">
          <Show when={entity()}>
            <button
              class="model-inspector-toggle"
              type="button"
              aria-expanded={inspectorOpen()}
              aria-controls="model-inspector"
              onClick={() => setInspectorOpen(!inspectorOpen())}
            >
              制作面板
            </button>
          </Show>
          <label class="model-import">
            导入模型
            <input
              type="file"
              aria-label="导入模型"
              accept=".bbmodel"
              disabled={props.disabled || importing() || !entity()}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void importModel(file)
                event.currentTarget.value = ""
              }}
            />
          </label>
          <Button disabled={!props.view.blockbench || props.disabled} onClick={exportModel}>
            导出模型
          </Button>
        </div>
      </header>
      <Show
        when={entity()}
        fallback={
          <div class="empty panel model-empty">
            <Icon name="cube" />
            <h2>添加一个生物</h2>
            <Button primary onClick={props.onAdd}>
              开始建模
            </Button>
          </div>
        }
      >
        <div class="model-creation-layout">
          <div class="model-visual-column">
            <ModelCanvas
              view={props.view}
              draft={
                edited() ??
                (props.generating && !props.view.model && props.progress?.draft.bones.length
                  ? props.progress.draft
                  : null) ??
                (props.view.model ? null : example())
              }
              mode={props.mode}
              modes={props.mode === "animation" ? [] : ["model", "texture"]}
              animation={animation()} hideMotionPicker={props.mode==="animation"} playRequest={playRequest()}
              rawNames={advanced()}
              motionName={motionName()}
              onMode={props.onMode}
              onAnimation={setAnimation}
              selectedPart={part()}
              onSelectPart={(value) => setPart(boneOf(shown(), value) ?? value)}
              paint={paintMode()}
              onStroke={stroke}
              draftNote={edited() ? "保存修改后更新贴图图集" : example() && !props.view.model ? "示例的贴图图集，不会存进工程" : undefined}
              time={props.mode === "animation" ? pinned() : null}
              onTime={setClock}
              onPlaying={(playing) => playing && setPinned(null)}
              onCaptureReady={(next) => setCapture(() => next)}
            />
            <Show when={!props.view.model && !props.generating}>
              <div class="model-empty-note" role="status">
                <Icon name="cube" />
                <Show
                  when={example()}
                  fallback={
                    <>
                      <strong>还没有模型</strong>
                      <span>
                        {props.external ? "在等外面的 AI 把模型交来，进度在「制作现场」。" : `先描述一个生物。想先看看能做成什么样，可以点「查看示例」：只是看，不会放进你的工程。${props.aiConfigured ? "" : BLANK_WAYS}`}
                      </span>
                    </>
                  }
                >
                  {(shownExample) => (
                    <>
                      <strong>这是一个示例（{shownExample().name}），不是你的{entity() ? `「${entity()!.name}」` : "生物"}</strong>
                      <span>只是让你看看能做出什么样，没有存进工程，你的生物仍然没有模型。描述你要的生物，点「开始制作」就会做你自己的。</span>
                    </>
                  )}
                </Show>
              </div>
            </Show>
            <div class="model-selection">
              <span>{part() ? `已选中 ${part()}` : "拖动旋转 · 滚轮缩放 · 右键平移"}</span>
              <Show when={part()}>
                <button onClick={() => setPart("")}>清除选择</button>
              </Show>
            </div>
            <Show when={shown() && entity() && props.onAnnotate}>
              <ModelAnnotation
                capture={capture()}
                sourceKey={JSON.stringify([shown(), props.view.preview, props.view.entity_id])}
                targetId={entity()!.id}
                projectRevision={props.view.project.revision}
                selectedPart={part()}
                disabled={editLocked() || editsPending() || (!!props.external && !props.onAnnotate)}
                onDirty={setAnnotationDirty}
                onSubmit={(prompt, annotation) => props.onAnnotate!(prompt, annotation)}
              />
              <Show when={editsPending()}><p class="model-context">先保存手动修改，再截取画面进行标注。</p></Show>
            </Show>
          </div>
          <aside id="model-inspector" class={`model-conversation ${inspectorOpen() ? "is-open" : ""}`}>
            <div class="model-conversation-title">
              <div>
                <h2>{props.external ? "调整模型" : props.view.model ? "继续制作" : "描述你的生物"}</h2>
              </div>
              <Show when={props.generating}>
                <span class="model-status-dot" aria-hidden="true" />
              </Show>
            </div>
            <Show when={editsPending() || editMessage()}>
              <div class="model-edit-bar" role="status" aria-live="polite">
                <Show when={editsPending()} fallback={<span class="model-edit-message">{editMessage()}</span>}>
                  <span>
                    <strong>手动修改未保存</strong>
                    <Show when={editMessage()}>
                      <small class="model-edit-message">{editMessage()}</small>
                    </Show>
                  </span>
                  <div class="model-edit-actions">
                    <button type="button" class="model-edit-icon" aria-label="撤销" title="撤销 (Ctrl+Z)" disabled={editLocked()} onClick={() => stepHistory("undo")}>
                      <Icon name="undo" />
                    </button>
                    <button
                      type="button"
                      class="model-edit-icon redo"
                      aria-label="重做"
                      title="重做 (Ctrl+Y)"
                      disabled={editLocked() || !(historyTick() >= 0 && history.value?.canRedo)}
                      onClick={() => stepHistory("redo")}
                    >
                      <Icon name="undo" />
                    </button>
                    <Button disabled={editLocked()} onClick={discardEdits}>
                      放弃
                    </Button>
                    <Button primary disabled={editLocked()} onClick={() => void saveEdits()}>
                      {savingEdits() ? "保存中…" : "保存修改"}
                    </Button>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={shown()}>
              {(model) => (
                <p class="model-context">
                  {model().bones.length} 个骨骼 · {model().animations.length} 组动作
                </p>
              )}
            </Show>
            <Show when={props.mode==="animation" && shown()}>{model=><section class="inside-motion-list"><h3>动作 {model().animations.length} 组</h3>
              <For each={motionRows(props.view.project, props.view.entity_id ?? "",model().animations)}>{row=><article classList={{selected:row.clip.name===motion()?.name}}>
                <button aria-pressed={row.clip.name===motion()?.name} onClick={()=>{setAnimation(row.clip.name);setPinned(null);replay(n=>n+1)}}>{row.title} · 播放</button>
                <small>{row.clip.length} 秒 · {row.clip.loop ? "循环" : "不循环"}</small><p>{row.uses}</p>
                <Show when={row.title === "未命名动作"}>
                  <p>模型里还没给这段动作填写显示名。</p>
                  <button type="button" disabled={editLocked()} onClick={() => nameMotion(row.clip.name)}>给动作起名</button>
                </Show>
                <Show when={advanced()}><code>{row.clip.name}</code></Show>
              </article>}</For></section>}</Show>
            <Show when={shown() && props.mode === "animation" && motion()}>
              {(current) => (
                <section class="model-keys" aria-label="动作关键帧">
                  <div class="model-part-editor-head">
                    <h3>动作 · {motionName()(current().name, advanced())}</h3>
                    <span>{current().channels.length} 个部件在动</span>
                  </div>
                  <label class="field">动作显示名
                    <input ref={motionNameInput} aria-label="动作显示名" maxLength={48} disabled={editLocked()} value={current().display_name ?? ""} placeholder={motionName()(current().name, false)}
                      onChange={event => {
                        const display_name = event.currentTarget.value.trim() || undefined
                        applyEdit(design => ({ok: true, design: {...design, animations: design.animations.map(clip => clip.name === current().name ? {...clip, display_name} : clip)}}))
                      }} />
                  </label>
                  <div class="keys-timing">
                    <label>
                      时长
                      <input
                        type="number"
                        aria-label="动作时长（秒）"
                        min="0.05"
                        max="30"
                        step="0.05"
                        value={current().length}
                        disabled={editLocked()}
                        onChange={(event) => {
                          const length = Number(event.currentTarget.value)
                          applyEdit((design) => setAnimationTiming(design, current().name, { length }))
                        }}
                      />
                      秒
                    </label>
                    <label class="keys-loop">
                      <input
                        type="checkbox"
                        checked={current().loop}
                        disabled={editLocked()}
                        onChange={(event) => {
                          const loop = event.currentTarget.checked
                          applyEdit((design) => setAnimationTiming(design, current().name, { loop }))
                        }}
                      />
                      循环播放
                    </label>
                  </div>
                  <div
                    ref={track}
                    class="keys-track"
                    role="slider"
                    tabindex="0"
                    aria-label="动作时间"
                    aria-valuemin={0}
                    aria-valuemax={current().length}
                    aria-valuenow={Math.round(now() * 100) / 100}
                    aria-valuetext={`${now().toFixed(2)} 秒`}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      seekTrack(event)
                    }}
                    onPointerMove={(event) => event.buttons & 1 && seekTrack(event)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft") pin(now() - 0.05)
                      if (event.key === "ArrowRight") pin(now() + 0.05)
                    }}
                  >
                    <For each={allKeys()}>
                      {(time) => (
                        <span
                          class="keys-mark"
                          classList={{ own: boneKeys().includes(time) }}
                          style={{ left: `${(time / current().length) * 100}%` }}
                        />
                      )}
                    </For>
                    <span class="keys-head" style={{ left: `${(now() / current().length) * 100}%` }} />
                  </div>
                  <div class="keys-clock">
                    <button type="button" aria-label="上一个关键帧" title="上一个关键帧" onClick={() => jumpKey(-1)}>
                      ◀
                    </button>
                    <span>
                      {now().toFixed(2)} / {current().length.toFixed(2)} 秒{pinned() === null ? " · 播放中" : ""}
                    </span>
                    <button type="button" aria-label="下一个关键帧" title="下一个关键帧" onClick={() => jumpKey(1)}>
                      ▶
                    </button>
                  </div>
                  <Show
                    when={selectedBone()}
                    fallback={<p class="model-context">在模型上点一个部件，就能在这一刻给它摆姿势，自动记成关键帧。</p>}
                  >
                    {(bone) => (
                      <>
                        <div class="keys-bone">
                          <strong>{bone().name}</strong>
                          <output>{poseNow().map((value) => value.toFixed(0)).join(" / ")}°</output>
                        </div>
                        <div class="part-pad">
                          <For each={[["抬低", 0, "低下 15 度", "抬起 15 度"], ["转向", 1, "向左转 15 度", "向右转 15 度"], ["侧倾", 2, "向左倾 15 度", "向右倾 15 度"]] as const}>
                            {(item) => (
                              <div class="part-axis">
                                <button type="button" aria-label={`此刻${item[2]}`} title={item[2]} disabled={editLocked()} onClick={() => turnKey(item[1], -15)}>
                                  −
                                </button>
                                <span>{item[0]}</span>
                                <button type="button" aria-label={`此刻${item[3]}`} title={item[3]} disabled={editLocked()} onClick={() => turnKey(item[1], 15)}>
                                  +
                                </button>
                              </div>
                            )}
                          </For>
                        </div>
                        <div class="part-actions">
                          <Button disabled={editLocked() || keyHere()} onClick={() => recordKey()}>
                            记录此刻姿势
                          </Button>
                          <Button
                            class="danger"
                            disabled={editLocked() || !keyHere()}
                            onClick={() => {
                              const name = current().name
                              const time = now()
                              applyEdit((design) => deleteKeyframe(design, name, bone().name, time))
                            }}
                          >
                            删除此关键帧
                          </Button>
                        </div>
                      </>
                    )}
                  </Show>
                </section>
              )}
            </Show>
            <Show when={shown()}>
              {(model) => (
                <section class="model-bones-panel" aria-label="骨骼结构">
                  <div class="model-bones-heading">
                    <h3>骨骼结构</h3>
                    <button type="button" aria-expanded={bonesOpen()} onClick={() => setBonesOpen(!bonesOpen())}>
                      {bonesOpen() ? "收起" : "展开"}
                    </button>
                  </div>
                  <Show when={bonesOpen()}>
                    <div class="model-bone-tree" aria-label="模型骨骼">
                      <For each={model().bones}>
                        {(bone) => (
                          <button
                            type="button"
                            class={selectedBone()?.name === bone.name ? "is-selected" : ""}
                            aria-pressed={selectedBone()?.name === bone.name}
                            title={bone.parent ? `父级：${bone.parent}` : "根骨骼"}
                            onClick={() => setPart(bone.name)}
                          >
                            <span class="model-bone-glyph" aria-hidden="true">
                              <Icon name="cube" />
                            </span>
                            <span class="model-bone-name">{bone.name}</span>
                            <span class="model-bone-count">{bone.cubes.length}</span>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                  <Show when={selectedBone()}>
                    {(bone) => (
                      <div class="model-bone-properties" aria-label={`${bone().name} 属性`}>
                        <div>
                          <span>枢轴</span>
                          <output>{formatVector(bone().pivot)}</output>
                        </div>
                        <div>
                          <span>旋转</span>
                          <output>{formatVector(bone().rotation)}°</output>
                        </div>
                      </div>
                    )}
                  </Show>
                </section>
              )}
            </Show>
            <Show when={shown() && props.mode === "texture"}>
              <section class="model-paint" aria-label="绘制贴图">
                <div class="model-part-editor-head">
                  <h3>绘制贴图</h3>
                  <span>右键拖动旋转 · 滚轮缩放</span>
                </div>
                <Show
                  when={!boundTexture()}
                  fallback={
                    <p class="part-note">
                      这个生物使用独立贴图「{boundTexture()}」，请在贴图素材里修改；这里的绘制只作用于模型自带的颜色。
                    </p>
                  }
                >
                  <div class="paint-tools" role="group" aria-label="绘制工具">
                    <For each={tools}>
                      {(item) => (
                        <button
                          type="button"
                          aria-pressed={tool() === item.id}
                          title={item.hint}
                          disabled={editLocked()}
                          onClick={() => setTool(item.id)}
                        >
                          {item.label}
                        </button>
                      )}
                    </For>
                  </div>
                  <div class="part-row">
                    <span class="part-label">颜色</span>
                    <div class="part-swatches">
                      <span class="paint-current" style={{ background: currentColor() }} aria-label={`当前颜色 ${currentColor()}`} role="img" />
                      <For each={[...new Set([...recentColors(), ...palette()])].slice(0, 9)}>
                        {(color) => (
                          <button
                            type="button"
                            class="part-swatch"
                            classList={{ chosen: color === currentColor() }}
                            style={{ background: color }}
                            aria-label={`画笔颜色 ${color}`}
                            title={color}
                            onClick={() => chooseColor(color)}
                          />
                        )}
                      </For>
                      <label class="part-swatch part-swatch-custom" title="自定义颜色">
                        <input
                          type="color"
                          aria-label="自定义画笔颜色"
                          value={currentColor()}
                          onInput={(event) => chooseColor(event.currentTarget.value)}
                        />
                      </label>
                    </div>
                  </div>
                  <p class="model-context">{tools.find((item) => item.id === tool())?.hint}。每画一笔都可以撤销。</p>
                </Show>
              </section>
            </Show>
            <Show when={shown() && props.mode === "model"}>
              <Show
                when={selectedBone()}
                fallback={<p class="model-context model-part-hint">在模型上点一个部件，就能直接调整它的颜色、大小、位置和姿态。</p>}
              >
                {(bone) => (
                  <section class="model-part-editor" aria-label={`调整部件 ${bone().name}`}>
                    <div class="model-part-editor-head">
                      <h3>调整 {bone().name}</h3>
                      <span>{bone().cubes.length} 个方块</span>
                    </div>
                    <p class="part-note">{carried(bone().name)}</p>
                    <Show when={boundTexture()}>
                      <p class="part-note">
                        这个生物使用贴图「{boundTexture()}」，颜色、大小和部件增减会让贴图错位，这里只调整位置和姿态。
                      </p>
                    </Show>
                    <div class="part-row">
                      <span class="part-label">颜色</span>
                      <div class="part-swatches">
                        <For each={palette()}>
                          {(color) => (
                            <button
                              type="button"
                              class="part-swatch"
                              style={{ background: color }}
                              aria-label={`部件换成 ${color}`}
                              title={color}
                              disabled={editLocked() || !bone().cubes.length || !!boundTexture()}
                              onClick={() => applyEdit((design) => tintBone(design, bone().name, color))}
                            />
                          )}
                        </For>
                        <label class="part-swatch part-swatch-custom" title="自定义颜色">
                          <input
                            type="color"
                            aria-label="自定义部件颜色"
                            disabled={editLocked() || !bone().cubes.length || !!boundTexture()}
                            onChange={(event) => {
                              const color = event.currentTarget.value
                              applyEdit((design) => tintBone(design, bone().name, color))
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    <div class="part-row">
                      <span class="part-label">大小</span>
                      <div class="part-buttons">
                        <button type="button" disabled={editLocked() || !!boundTexture()} onClick={() => applyEdit((design) => scaleBone(design, bone().name, 0.8))}>
                          缩小
                        </button>
                        <button type="button" disabled={editLocked() || !!boundTexture()} onClick={() => applyEdit((design) => scaleBone(design, bone().name, 1.25))}>
                          放大
                        </button>
                      </div>
                    </div>
                    <div class="part-row">
                      <span class="part-label">位置</span>
                      <div class="part-pad">
                        <For each={[["左右", 0, "向左移动一格", "向右移动一格"], ["上下", 1, "向下移动一格", "向上移动一格"], ["前后", 2, "向前移动一格", "向后移动一格"]] as const}>
                          {(item) => (
                            <div class="part-axis">
                              <button type="button" aria-label={item[2]} title={item[2]} disabled={editLocked()} onClick={() => move(item[1], -1)}>
                                −
                              </button>
                              <span>{item[0]}</span>
                              <button type="button" aria-label={item[3]} title={item[3]} disabled={editLocked()} onClick={() => move(item[1], 1)}>
                                +
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class="part-row">
                      <span class="part-label">姿态</span>
                      <div class="part-pad">
                        <For each={[["抬低", 0, "低下 15 度", "抬起 15 度"], ["转向", 1, "向左转 15 度", "向右转 15 度"], ["侧倾", 2, "向左倾 15 度", "向右倾 15 度"]] as const}>
                          {(item) => (
                            <div class="part-axis">
                              <button type="button" aria-label={item[2]} title={item[2]} disabled={editLocked()} onClick={() => turn(item[1], -15)}>
                                −
                              </button>
                              <span>{item[0]}</span>
                              <button type="button" aria-label={item[3]} title={item[3]} disabled={editLocked()} onClick={() => turn(item[1], 15)}>
                                +
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class="part-actions">
                      <Button disabled={editLocked() || bone().parent === null || !!boundTexture()} onClick={() => applyEdit((design) => mirrorBone(design, bone().name))}>
                        镜像复制
                      </Button>
                      <Button
                        class="danger"
                        disabled={editLocked() || bone().parent === null || !!boundTexture()}
                        onClick={() => {
                          const result = deleteBone(shown()!, bone().name)
                          if (result.ok) setPart(bone().parent ?? "")
                          applyEdit(() => result)
                        }}
                      >
                        删除部件
                      </Button>
                    </div>
                  </section>
                )}
              </Show>
            </Show>
            <Show when={part()}>
              <div class="model-part-context">
                <span>当前选中部件</span>
                <strong>{part()}</strong>
                <button type="button" onClick={() => setPart("")}>
                  清除
                </button>
              </div>
            </Show>
            <Show
              when={!props.external}
              fallback={
                <div class="model-mcp-note">
                  <strong>模型由外面的 AI 来做</strong>
                  <span>在你的 AI 助手里说要改哪里，进度会出现在「制作现场」。小改动可以直接在上面手动调。</span>
                  <Show when={props.onTasks}>
                    <Button onClick={() => props.onTasks?.()}>
                      打开制作现场
                      <Icon name="arrow" />
                    </Button>
                  </Show>
                </div>
              }
            >
              <form
                class="model-brief"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (editsPending()) {
                    setEditMessage("先保存或放弃手动修改，再让 AI 修改模型。")
                    return
                  }
                  if (!props.disabled && props.aiConfigured && props.prompt.trim())
                    props.onGenerate(
                      `${part() ? `选中部件：${part()}。修改这个部件，保持其他部分。\n` : ""}${props.prompt}`,
                    )
                }}
              >
                <textarea
                  id="model-description"
                  aria-label="跟 AI 说这个模型"
                  rows="4"
                  maxlength="15000"
                  placeholder={
                    props.view.model
                      ? "想改哪里？例如：尾巴加粗一些，头部增大，补上羽毛和铜绿的细节。"
                      : "描述外形、材质和动作，例如：铜绿羽毛的机械猫头鹰，分节翅膀，起飞前蓄力、收脚。"
                  }
                  value={props.prompt}
                  disabled={props.disabled}
                  onInput={(event) => props.onPrompt(event.currentTarget.value)}
                />
                <div class="model-brief-actions">
                  <Show when={!props.view.model}>
                    <Button disabled={props.disabled} onClick={() => setExample(example() ? null : mushroomCowDesign)}>
                      {example() ? "收起示例" : "查看示例"}
                    </Button>
                  </Show>
                  <Button type="submit" primary disabled={props.disabled || !props.aiConfigured || !props.prompt.trim()}>
                    {props.generating ? "制作中…" : props.view.model ? "修改模型" : "开始制作"}
                  </Button>
                </div>
              </form>
              <Show when={!props.aiConfigured}>
                <p class="model-context model-service-note">{WORDS.connect} 后就能做。{props.view.model ? "" : BLANK_WAYS}</p>
              </Show>
            </Show>
            <Show when={props.generating}>
              <div class="model-generation-status" role="status" aria-live="polite">
                <span class="model-status-label">正在制作</span>
                <span>{props.progress?.events.at(-1)?.label ?? "正在准备，现在的模型先不动。"}</span>
              </div>
            </Show>
            <Show when={props.progress?.events.length}>
              <div class="model-events-heading">
                <span>{WORDS.feed}</span>
                <span>{props.progress!.complete ? "做好了" : "实时"}</span>
              </div>
              <ol class="model-build-events" aria-label="模型制作过程">
                <For each={props.progress!.events.slice(-12)}>
                  {(event) => (
                    <li>
                      <Icon name="check" />
                      {event.label}
                    </li>
                  )}
                </For>
              </ol>
            </Show>
            <Show when={!props.generating && props.progress?.events.length && !props.progress?.complete}>
              <p class="model-context model-recovery-note">
                本轮制作未应用，当前模型和描述仍保留，可以继续修改或重试。
              </p>
            </Show>
            <div class="model-next">
              <Button
                primary
                disabled={props.disabled || !props.view.model || editsPending() || props.continueReady === false}
                onClick={props.onContinue}
              >
                {props.continueReady === undefined ? `确认模型与${WORDS.motion}` : "查看生物行为"}
                <Icon name="arrow" />
              </Button>
              <span>
                {props.continueReady === false ? (props.external ? "外面的 AI 还没有交来这个生物的行为" : (props.continueHint ?? "这个生物还没有行为")) : props.continueReady ? "下一步：这个生物的行为" : "下一步：行为与玩法"}
              </span>
            </div>
          </aside>
        </div>
      </Show>
    </section>
  )
}

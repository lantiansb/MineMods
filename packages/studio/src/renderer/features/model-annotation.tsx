import { For, Show, createSignal, onCleanup } from "solid-js"
import { ask } from "../confirm-dialog"
import type { AnnotationMark, ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import { annotationLayers, annotationPoint, annotationSourceMatches, annotationSvg } from "../model-annotation"
import "./model-annotation.css"

export type AnnotationCapture = () => Promise<{ dataUrl: string; width: number; height: number }>

export function ModelAnnotation(props: {
  capture?: AnnotationCapture | null
  sourceKey: string
  targetId: string
  projectRevision: number
  selectedPart?: string
  disabled?: boolean
  onSubmit: (prompt: string, input: ModelAnnotationInput) => Promise<unknown> | void
  onDirty?: (dirty: boolean) => void
}) {
  const [snapshot, setSnapshot] = createSignal<{ dataUrl: string; width: number; height: number; sourceKey: string; projectRevision: number; targetId: string } | null>(null)
  const [open, setOpen] = createSignal(false)
  const [marks, setMarks] = createSignal<AnnotationMark[]>([])
  const [pending, setPending] = createSignal<AnnotationMark | null>(null)
  const [tool, setTool] = createSignal<AnnotationMark["kind"]>("circle")
  const [text, setText] = createSignal("")
  const [prompt, setPrompt] = createSignal("")
  const [working, setWorking] = createSignal(false)
  const [error, setError] = createSignal("")
  const [status, setStatus] = createSignal("")
  let activePointer: number | null = null
  let disposed = false
  onCleanup(() => { disposed = true })
  const current = () => {
    const value = snapshot()
    return !!value && value.targetId === props.targetId && annotationSourceMatches(value, props.sourceKey, props.projectRevision)
  }
  const locked = () => !!props.disabled || working()
  const take = async () => {
    if (!props.capture || locked()) return
    // A new picture starts with no marks: the ones drawn go, and the words stay.
    if (marks().length && !(await ask({ title: `重新截图会清掉 ${marks().length} 条标注`, text: "修改说明会留着。", confirm: "清掉，重新截图", cancel: "留着" }))) return
    setWorking(true)
    setError("")
    const sourceKey = props.sourceKey
    const projectRevision = props.projectRevision
    const targetId = props.targetId
    await props.capture().then((image) => {
      if (disposed) return
      if (sourceKey !== props.sourceKey || projectRevision !== props.projectRevision || targetId !== props.targetId)
        throw new Error("截图期间模型已更新，请重新截图。")
      setSnapshot({ ...image, sourceKey, projectRevision, targetId })
      setMarks([])
      setPending(null)
      setOpen(true)
      setStatus("")
      props.onDirty?.(true)
    }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "截图失败，请重试。") })
      .finally(() => { if (!disposed) setWorking(false) })
  }
  const add = (mark: AnnotationMark) => {
    if (marks().length >= 64) return setError("最多添加 64 条标注，可以先撤销或清空。")
    setMarks([...marks(), mark])
    setError("")
    props.onDirty?.(true)
  }
  const begin = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    if (event.button !== 0 || locked() || !current()) return
    const start = annotationPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    if (tool() === "text") {
      if (!text().trim()) return setError("先输入标注文字，再点击画面放置。")
      add({ kind: "text", start, text: text().trim(), part: props.selectedPart || null })
      return
    }
    activePointer = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setPending({ kind: tool(), start, end: start, part: props.selectedPart || null })
  }
  const move = (event: PointerEvent & { currentTarget: SVGSVGElement }) => {
    if (event.pointerId !== activePointer || !pending() || locked()) return
    setPending({ ...pending()!, end: annotationPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()) })
  }
  const finish = (event: PointerEvent & { currentTarget: SVGSVGElement }, cancel = false) => {
    if (event.pointerId !== activePointer) return
    const mark = pending()
    activePointer = null
    setPending(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancel || !mark || !current() || locked()) return
    const end = annotationPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    const image = snapshot()!
    if (Math.hypot((end.x - mark.start.x) * image.width, (end.y - mark.start.y) * image.height) < 5) return
    add({ ...mark, end })
  }
  const load = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("标注图片无法读取，请重新截图。"))
    image.src = source
  })
  const exportImage = async (image: NonNullable<ReturnType<typeof snapshot>>, annotations: AnnotationMark[]) => {
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")
    if (!context) throw new Error("无法生成标注图片，请重试。")
    context.drawImage(await load(image.dataUrl), 0, 0, image.width, image.height)
    context.drawImage(await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(annotationSvg(annotations, image.width, image.height))}`), 0, 0)
    return canvas.toDataURL("image/png")
  }
  const submit = async () => {
    const image = snapshot()
    if (!image || locked() || !current() || !marks().length || !prompt().trim()) return
    const annotations = marks().map((mark) => ({ ...mark, start: { ...mark.start }, ...(mark.end ? { end: { ...mark.end } } : {}) }))
    const feedback = prompt().trim()
    const selectedPart = props.selectedPart || null
    setWorking(true)
    setError("")
    await exportImage(image, annotations).then(async (raster) => {
      if (disposed) return
      if (!current() || snapshot() !== image) throw new Error("模型已更新，请重新截图后提交。")
      await props.onSubmit(feedback, { targetId: image.targetId, projectRevision: image.projectRevision, image: raster, width: image.width, height: image.height, selectedPart, annotations })
      if (disposed) return
      setSnapshot(null)
      setMarks([])
      setPending(null)
      setPrompt("")
      setText("")
      setOpen(false)
      setStatus("标注已提交。")
      props.onDirty?.(false)
    }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "标注修改未完成，图片和标注已保留。") })
      .finally(() => { if (!disposed) setWorking(false) })
  }

  return <section class="model-annotation" aria-label="图上标注修改">
    <div class="annotation-entry">
      <button type="button" disabled={locked() || !props.capture} onClick={() => snapshot() ? setOpen(!open()) : void take()}>{snapshot() ? open() ? "收起标注" : `继续标注 · ${marks().length} 条` : "图上标注修改"}</button>
      <Show when={snapshot() && !open()}><small>截图和标注已保留</small></Show>
    </div>
    <Show when={open() && snapshot()}>{(image) => <div class="annotation-editor">
      <div class="annotation-head"><strong>在固定画面上说明修改</strong><button type="button" disabled={locked() || !props.capture} onClick={() => void take()}>重新截图</button></div>
      <Show when={!current()}><p class="annotation-error" role="alert">模型或工程版本已更新。旧截图已保留，请重新截图后提交。</p></Show>
      <div class="annotation-tools" role="group" aria-label="标注工具">
        <For each={[["circle", "圈选"], ["arrow", "箭头"], ["text", "文字"]] as const}>{(item) => <button type="button" aria-pressed={tool() === item[0]} disabled={locked()} onClick={() => setTool(item[0])}>{item[1]}</button>}</For>
        <button type="button" disabled={locked() || !marks().length} onClick={() => { setMarks(marks().slice(0, -1)); setPending(null) }}>撤销标注</button>
        <button type="button" disabled={locked() || !marks().length} onClick={() => { setMarks([]); setPending(null) }}>清空标注</button>
      </div>
      <Show when={tool() === "text"}><input aria-label="标注文字" placeholder="输入文字，再点击画面放置" value={text()} maxlength={240} disabled={locked()} onInput={(event) => setText(event.currentTarget.value)} /></Show>
      <p class="annotation-hint">{props.selectedPart ? `新标注关联部件：${props.selectedPart}` : "可先在模型中选中部件，再添加标注。"} {tool() === "text" ? "点击画面放置文字。" : "在画面上拖动绘制。"}</p>
      <div class="annotation-picture">
        <img src={image().dataUrl} alt="当前模型的固定截图" draggable={false} />
        <svg role="img" aria-label="截图标注画布" viewBox={`0 0 ${image().width} ${image().height}`} classList={{ "is-locked": locked() || !current() }} onPointerDown={begin} onPointerMove={move} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} innerHTML={annotationLayers([...marks(), ...(pending() ? [pending()!] : [])], image().width, image().height)} />
      </div>
      <Show when={marks().length}><ol class="annotation-list" aria-label="标注部件关联"><For each={marks()}>{(mark, index) => <li>{index() + 1}. {mark.kind === "circle" ? "圈选" : mark.kind === "arrow" ? "箭头" : mark.text}{mark.part ? ` · ${mark.part}` : " · 整体参考"}</li>}</For></ol></Show>
      <textarea aria-label="标注修改说明" placeholder="结合标注，描述希望怎样修改模型。" rows={3} maxlength={500} value={prompt()} disabled={locked()} onInput={(event) => { setPrompt(event.currentTarget.value); props.onDirty?.(true) }} />
      <small class="annotation-hint">{prompt().length} / 500 字</small>
      <div class="annotation-actions"><button type="button" onClick={() => setOpen(false)}>取消</button><button type="button" class="primary" disabled={locked() || !current() || !marks().length || !prompt().trim()} onClick={() => void submit()}>{working() ? "正在处理…" : "提交标注修改"}</button></div>
    </div>}</Show>
    <Show when={error()}><p class="annotation-error" role="alert">{error()}</p></Show>
    <Show when={status()}><p class="annotation-hint" role="status">{status()}</p></Show>
  </section>
}

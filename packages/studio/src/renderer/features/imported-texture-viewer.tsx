import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import "./imported-texture-viewer.css"

const minZoom = 0.01
const maxZoom = 64
const zoomOptions = [25, 50, 100, 200, 400, 800, 1600, 3200, 6400]

export function ImportedTextureViewer(props: { src: string; name: string; assetKey?: string; active?: boolean }) {
  let stage!: HTMLDivElement
  let image!: HTMLImageElement
  let resizeObserver: ResizeObserver | undefined
  let dragStart: { pointerId: number; x: number; y: number; offset: { x: number; y: number } } | undefined
  let fitMode = true
  const [zoom, setZoom] = createSignal(1)
  const [offset, setOffset] = createSignal({ x: 0, y: 0 })
  const [size, setSize] = createSignal({ width: 0, height: 0 })
  const [error, setError] = createSignal(false)
  const [dragging, setDragging] = createSignal(false)
  const clearDrag = () => {
    if (dragStart && stage?.hasPointerCapture(dragStart.pointerId)) stage.releasePointerCapture(dragStart.pointerId)
    dragStart = undefined
    setDragging(false)
  }

  const fit = () => {
    if (!stage || !image?.naturalWidth || !image.naturalHeight) return
    const bounds = stage.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return
    fitMode = true
    const scale = Math.min((bounds.width - 48) / image.naturalWidth, (bounds.height - 48) / image.naturalHeight)
    setZoom(Math.max(minZoom, Math.min(12, scale)))
    setOffset({ x: 0, y: 0 })
    fitMode = true
  }
  const reset = () => {
    setError(false)
    setSize({ width: 0, height: 0 })
    setOffset({ x: 0, y: 0 })
    setZoom(1)
  }
  const changeZoom = (next: number) => {
    fitMode = false
    setZoom(Math.max(minZoom, Math.min(maxZoom, next)))
  }

  createEffect(() => {
    props.assetKey
    props.src
    props.name
    reset()
    clearDrag()
    if (image?.complete && image.naturalWidth) {
      setSize({ width: image.naturalWidth, height: image.naturalHeight })
      if (props.active !== false) fit()
    }
  })

  createEffect(() => {
    if (props.active === false) return
    if (!stage || typeof ResizeObserver === "undefined") return
    resizeObserver?.disconnect()
    resizeObserver = new ResizeObserver(() => {
      if (fitMode) fit()
    })
    resizeObserver.observe(stage)
    fit()
    onCleanup(() => resizeObserver?.disconnect())
  })

  onCleanup(() => {
    resizeObserver?.disconnect()
    clearDrag()
  })

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
    if (event.key === "+" || event.key === "=") {
      event.preventDefault()
      changeZoom(zoom() * 1.25)
    }
    if (event.key === "-") {
      event.preventDefault()
      changeZoom(zoom() / 1.25)
    }
    if (event.key === "0") {
      event.preventDefault()
      fit()
    }
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const bounds = stage.getBoundingClientRect()
    const point = {
      x: event.clientX - bounds.left - bounds.width / 2,
      y: event.clientY - bounds.top - bounds.height / 2,
    }
    const current = zoom()
    fitMode = false
    const next = Math.max(minZoom, Math.min(maxZoom, current * Math.exp(-event.deltaY * 0.0015)))
    const ratio = next / current
    setOffset((previous) => ({
      x: point.x - (point.x - previous.x) * ratio,
      y: point.y - (point.y - previous.y) * ratio,
    }))
    setZoom(next)
  }

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return
    stage.setPointerCapture(event.pointerId)
    setDragging(true)
    fitMode = false
    dragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offset: offset() }
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return
    setOffset({
      x: dragStart.offset.x + event.clientX - dragStart.x,
      y: dragStart.offset.y + event.clientY - dragStart.y,
    })
  }
  const onPointerEnd = () => {
    dragStart = undefined
    setDragging(false)
  }

  return (
    <section class="itv-card" aria-label={`贴图预览：${props.name}`}>
      <header class="itv-header">
        <div class="itv-title">
          <strong title={props.name}>{props.name}</strong>
          <span>{size().width > 0 ? `${size().width} × ${size().height}px` : "贴图预览"}</span>
        </div>
        <div class="itv-controls" aria-label="贴图缩放控制">
          <button type="button" aria-label="缩小" title="缩小 (−)" onClick={() => changeZoom(zoom() / 1.25)}>
            −
          </button>
          <select
            aria-label="缩放倍率"
            value={String(Math.round(zoom() * 100))}
            onChange={(event) => changeZoom(Number(event.currentTarget.value) / 100)}
          >
            <option value={String(Math.round(zoom() * 100))}>{Math.round(zoom() * 100)}%</option>
            {zoomOptions.map((value) => (
              <option value={String(value)}>{value}%</option>
            ))}
          </select>
          <button type="button" aria-label="放大" title="放大 (+)" onClick={() => changeZoom(zoom() * 1.25)}>
            +
          </button>
          <button type="button" onClick={fit}>
            适应
          </button>
          <button
            type="button"
            onClick={() => {
              fitMode = false
              setZoom(1)
              setOffset({ x: 0, y: 0 })
            }}
          >
            100%
          </button>
          <button type="button" onClick={fit}>
            复位
          </button>
        </div>
      </header>
      <div
        ref={stage!}
        class={`itv-stage${dragging() ? " is-dragging" : ""}`}
        tabIndex={0}
        role="application"
        aria-label="贴图画布。可滚轮缩放、拖拽平移，按加号减号缩放，按 0 适应窗口"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onKeyDown={onKeyDown}
        onDblClick={fit}
      >
        <Show when={!error()} fallback={<div class="itv-error">贴图无法加载</div>}>
          <img
            ref={image!}
            class="itv-image"
            src={props.src}
            alt={props.name}
            draggable={false}
            onLoad={(event) => {
              setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              if (props.active !== false && fitMode) fit()
            }}
            onError={() => setError(true)}
            style={{
              transform: `translate(calc(-50% + ${offset().x}px), calc(-50% + ${offset().y}px)) scale(${zoom()})`,
            }}
          />
        </Show>
        <span class="itv-hint">滚轮缩放 · 拖动平移 · 双击适应</span>
      </div>
    </section>
  )
}

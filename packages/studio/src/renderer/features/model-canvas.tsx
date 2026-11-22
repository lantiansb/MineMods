import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, onMount, untrack } from "solid-js"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { paintModel } from "@minemods/studio-ai/model-paint"
import { textureSizes } from "@minemods/studio-ai/budget"
import { paintedPreview } from "../model-paint-preview"
import { calm } from "../calm"
import { mountViewport, type Preview, type ViewportBox, type ViewportCameraState, type ViewportPaint, type ViewportSnapshot } from "../viewport"
import type { PaintStroke } from "../model-edit"
import type { Face } from "../model-core"
import { motionTitle } from "./asset-words"
import { posedBounds, tightFrame } from "./model-canvas-frame"
import "./model-canvas.css"

export type ModelCanvasMode = "model" | "texture" | "animation"
export type ModelCanvasView = {
  model: ModelDesign | null
  preview?: Preview | null
  blockbench?: Record<string, unknown> | null
}
export type ModelCanvasDraft = { name: string; texture_size: ModelDesign["texture_size"]; bones: ModelDesign["bones"]; animations: ModelDesign["animations"] }

export function ModelCanvas(props: {
  view: ModelCanvasView
  draft?: ModelCanvasDraft | null
  mode?: ModelCanvasMode
  visible?:boolean
  hideMotionPicker?: boolean
  playRequest?: number
  animation?: string
  onMode?: (mode: ModelCanvasMode) => void
  /** View modes offered as tabs; pages that already have their own step navigation pass a subset. */
  modes?: ModelCanvasMode[]
  onAnimation?: (name: string) => void
  onSelectPart?: (part: string) => void
  selectedPart?: string
  outlineBoxes?: readonly ViewportBox[]
  /** When set, left-clicking the model paints instead of selecting. */
  paint?: ViewportPaint | null
  onStroke?: (strokes: PaintStroke[]) => void
  /** Shown in the UV panel while a draft (not yet compiled) is displayed. */
  draftNote?: string
  /** A pinned animation time (seconds); the preview pauses there. */
  time?: number | null
  onTime?: (time: number) => void
  onPlaying?: (playing: boolean) => void
  /** True: a motion is listed by the name its document gives it. Otherwise by the word a player has for it (待机, 走路), where there is one. */
  rawNames?: boolean
  /** How a motion is listed (`motionNamer`): the word for it, with what plays it. Left out: the word for a common motion, else the name the document gives it. */
  motionName?: (clip: string, advanced?: boolean) => string
  onCaptureReady?: (capture: (() => Promise<ViewportSnapshot>) | null) => void
  /** 制作现场: the parts written last, marked white and blinking slowly. */
  highlight?: readonly string[]
  /** 制作现场: what the version before had and this one has not got to yet, drawn where it stood. */
  ghosts?: { design: ModelDesign; names: readonly string[] } | null
  /** 制作现场 「跟着 AI 看」: the view keeps turning to these parts. */
  follow?: readonly string[] | null
  /** The person took the view over with their hand or the wheel. */
  onOwnView?: () => void
  /** Linked views: told each change this view's person makes. */
  onCamera?: (state: ViewportCameraState) => void
  /** Linked views: stand at this angle. */
  camera?: ViewportCameraState | null
  /** Walking through the steps of a making: the view is placed once for the whole of what is there, and stays, so what changes is the model and not how far away it looks. */
  holdCamera?: boolean
  /** The view itself, for what it alone can say (which part lies under a point, where it stands now). Null while there is none. */
  hiddenBones?: readonly string[]
  onViewport?: (viewport: ReturnType<typeof mountViewport> | null) => void
}) {
  let host!: HTMLDivElement
  const [exploded, setExploded] = createSignal(false)
  const [playing, setPlaying] = createSignal(!calm())
  const [showUv, setShowUv] = createSignal(false)
  const [selectedPart, setSelectedPart] = createSignal("")
  let controller: ReturnType<typeof mountViewport> | null = null
  let camera: ViewportCameraState | undefined
  let renderedKey = ""
  let renderedName = ""
  // The person has turned or zoomed the view themselves: from then on it is theirs, and nothing here moves it.
  let moved = false
  // Holding the view on purpose, and it has been placed for that.
  let holding = false
  // The shape of the picture the camera was last placed for; 0 when it was left to the viewport's own fit.
  let framedAspect = 0
  // Counts up when the camera has to be placed again for the same model (the picture changed shape, or the view was reset).
  const [refit, setRefit] = createSignal(0)
  const design = () => props.draft ?? props.view.model
  const mode = () => props.mode ?? "model"
  const modes = () => (props.modes ?? (["model", "texture", "animation"] as ModelCanvasMode[])).filter((item) => item !== "texture" || !design() || hasSheet())
  const modeLabels: Record<ModelCanvasMode, string> = { model: "模型", texture: "贴图 / UV", animation: "动作" }

  let lastTick = { time: -1, at: 0 }
  const tick = (time: number) => {
    const now = performance.now()
    if (Math.abs(time - lastTick.time) < 0.001 || now - lastTick.at < 50) return
    lastTick = { time, at: now }
    props.onTime?.(time)
  }
  const activePreview = () => props.draft ? null : props.view.preview ?? null
  /**
   * The picture the UV panel shows. A model nobody compiled for this page (an effect, a model asset on its own) still
   * has one: the game's texture for it is painted from the model itself (`paintModel`, the very thing the build runs),
   * on the first texture size its faces fit, as `fitModelAtlas` picks it. Null when its faces fit none: then there is
   * truly no image, and the UV button is not offered.
   */
  const ownSheet = createMemo((): Preview | null => {
    const current = props.view.model
    if (props.draft || props.view.preview || !current) return null
    const sizes = textureSizes(current.budget)
    for (const size of [current.texture_size, ...sizes.filter((value) => value > current.texture_size)]) {
      try {
        const sized = { ...current, texture_size: size }
        const sheet = paintedPreview(sized, paintModel(sized))
        if (sheet) return sheet
      } catch {
        // Its faces do not fit this size: the next one up is tried.
      }
    }
    return null
  })
  const sheet = () => activePreview() ?? ownSheet()
  // A draft says its texture comes later; anything else without a picture has nothing to show there.
  const hasSheet = () => !!props.draft || !!sheet()?.textureDataUrl
  createEffect(() => {
    const current = design()
    if (!host) return
    if (!current) { props.onCaptureReady?.(null); controller?.dispose(); controller = null; camera = undefined; renderedKey = ""; return }
    const preview = activePreview()
    const key = `${JSON.stringify(current)}|${preview?.textureDataUrl ?? ""}|${JSON.stringify(preview?.geometry)}|${JSON.stringify(preview?.animation)}|${refit()}`
    if (key === renderedKey) return
    if (renderedName !== current.name) moved = false
    // Their own view of the same model is kept. Otherwise the camera is placed to fill the picture with what is drawn
    // (`tightFrame`): the pose the model is built in and the motion on show. A host with no size yet, or a model
    // with nothing in it, is left to the viewport's own fit.
    const hold = !!untrack(() => props.holdCamera)
    const kept = moved ? (controller?.getCameraState() ?? camera) : hold && holding ? (controller?.cameraNow() ?? camera) : undefined
    holding = hold
    const aspect = host.clientWidth > 1 && host.clientHeight > 1 ? host.clientWidth / host.clientHeight : 0
    const shownClip = untrack(() => current.animations.find((item) => item.name === props.animation) ?? current.animations.find((item) => item.name === "idle") ?? current.animations[0])
    // Pulled apart, the parts reach past the model's own bounds: that view keeps the viewport's roomier fit.
    const bounds = kept || !aspect || untrack(exploded) ? null : posedBounds(current, shownClip?.name)
    const framed = bounds ? tightFrame(bounds.min, bounds.max, aspect) : null
    camera = kept ?? (framed ? { position: framed.position, target: framed.target } : undefined)
    framedAspect = framed ? aspect : 0
    props.onCaptureReady?.(null)
    props.onViewport?.(null)
    controller?.dispose()
    const next = mountViewport(host, current, preview, () => undefined, { exploded: untrack(exploded), playing: untrack(playing), animation: untrack(() => props.animation), camera, time: untrack(() => props.time ?? null), onTick: tick, paint: untrack(() => props.paint ?? null), onStroke: (strokes) => props.onStroke?.(strokes), onCamera: (state) => props.onCamera?.(state), onSelectPart: (part) => { setSelectedPart(part); props.onSelectPart?.(part) } })
    controller = next
    if (untrack(() => props.hiddenBones)) next.hideBones(untrack(() => props.hiddenBones) ?? [])
    next.outlineBoxes(untrack(() => props.outlineBoxes ?? []))
    if(untrack(()=>props.visible)===false)next.setVisible(false)
    props.onCaptureReady?.(() => next.captureCurrent())
    props.onViewport?.(next)
    renderedKey = key
    renderedName = current.name
    controller.select(untrack(() => props.selectedPart ?? selectedPart()))
  })
  // Asked for through `design()`, so each of these is put back on the view a new document mounts.
  // Following the AI leaves the view shifted toward its last part: looking back starts from the whole, which at this moment is still the newest step.
  createEffect(()=>{const visible=props.visible;if(visible!==undefined)controller?.setVisible(visible)})
  const holdWanted = createMemo(() => !!props.holdCamera)
  createEffect(on(holdWanted, (hold) => { if (hold && !moved) setRefit(untrack(refit) + 1) }, { defer: true }))
  createEffect(() => { controller?.outlineBoxes(props.outlineBoxes ?? []) })
  createEffect(() => { design(); refit(); controller?.highlight(props.highlight ?? []) })
  createEffect(() => { design(); refit(); controller?.ghosts(props.ghosts?.design ?? null, props.ghosts?.names ?? []) })
  createEffect(() => { design(); refit(); const parts = props.follow; if (parts?.length) controller?.focusPart(parts) })
  createEffect(() => { design(); refit(); if (props.camera) { controller?.setCamera(props.camera); moved = true } })
  createEffect(() => { const hidden = props.hiddenBones; if (hidden) controller?.hideBones(hidden) })
  createEffect(() => { const name = props.animation; if (controller && name) controller.setAnimation(name) })
  createEffect(() => { controller?.setExploded(exploded()) })
  createEffect(() => { const paint = props.paint ?? null; controller?.setPaint(paint) })
  createEffect(() => { const time = props.time; if (typeof time === "number" && controller) { controller.seek(time); setPlaying(false) } })
  createEffect(() => { const part = props.selectedPart; if (part !== undefined) { setSelectedPart(part); controller?.select(part) } })
  createEffect(() => { if (mode() === "texture") setShowUv(true) })
  createEffect(() => { if (!hasSheet()) setShowUv(false) })
  onCleanup(() => { props.onCaptureReady?.(null); props.onViewport?.(null); controller?.dispose(); controller = null })
  onMount(() => {
    // Turning, zooming or panning makes the view the person's own.
    const own = () => { moved = true; props.onOwnView?.() }
    host.addEventListener("pointerdown", own)
    const ownByWheel = (event: WheelEvent) => event.defaultPrevented && own()
    host.addEventListener("wheel", ownByWheel, { passive: true })
    // On the way down: the view keeps its arrow keys from the page around it, and would keep them from here too.
    const ownByKey = (event: KeyboardEvent) => event.key.startsWith("Arrow") && own()
    host.addEventListener("keydown", ownByKey, true)
    onCleanup(() => host.removeEventListener("keydown", ownByKey, true))
    // The camera was placed for one shape of picture. When the picture changes shape (the window, the UV panel
    // beside it) it is placed again, once the size has settled. A change under 5% is left alone: the frame keeps
    // 10% free around the thing, so that little cannot push it to the edge.
    let settle = 0
    const watch = new ResizeObserver(() => {
      window.clearTimeout(settle)
      settle = window.setTimeout(() => {
        const aspect = host.clientWidth > 1 && host.clientHeight > 1 ? host.clientWidth / host.clientHeight : 0
        if (moved || !aspect || !controller || untrack(exploded)) return
        if (framedAspect && Math.abs(aspect - framedAspect) / framedAspect < 0.05) return
        setRefit(untrack(refit) + 1)
      }, 160)
    })
    watch.observe(host)
    onCleanup(() => {
      window.clearTimeout(settle)
      watch.disconnect()
      host.removeEventListener("pointerdown", own)
      host.removeEventListener("wheel", ownByWheel)
    })
  })
  const resetView = () => {
    moved = false
    setRefit(refit() + 1)
  }

  const togglePlaying = () => {
    const next = controller?.togglePlaying() ?? false
    setPlaying(next)
    props.onPlaying?.(next)
  }
  const toggleExplosion = () => {
    const next = !exploded()
    setExploded(next)
    controller?.setExploded(next)
    // The camera is placed again for what is now drawn, unless the person has taken the view over.
    if (!moved) resetView()
  }
  const animations = () => design()?.animations ?? []
  // The motion on show: the one the page names, else the one picked here, else what the viewport starts with.
  const [picked, setPicked] = createSignal<string | null>(null)
  const playingClip = () => animations().find((item) => item.name === (props.animation ?? picked())) ?? animations().find((item) => item.name === "idle") ?? animations()[0]
  createEffect(on(()=>props.playRequest,request=>{if(request && controller){controller.setAnimation(props.animation ?? playingClip()!.name);if(!playing())togglePlaying()}},{defer:true}))
  const replay = () => {
    const name = playingClip()?.name
    if (!name || !controller) return
    controller.setAnimation(name)
    if (!playing()) togglePlaying()
  }
  const textureWidth = () => sheet()?.geometry["minecraft:geometry"][0]?.description.texture_width ?? design()!.texture_size
  const textureHeight = () => sheet()?.geometry["minecraft:geometry"][0]?.description.texture_height ?? design()!.texture_size
  const uvFaces: Face[] = ["north", "east", "south", "west", "up", "down"]
  const atlasRect = (boneIndex: number, cubeIndex: number, face: Face) => {
    const raw = sheet()?.geometry["minecraft:geometry"][0]?.bones[boneIndex]?.cubes[cubeIndex]?.uv[face]
    return raw ? { x: Math.min(raw.uv[0], raw.uv[0] + raw.uv_size[0]), y: Math.min(raw.uv[1], raw.uv[1] + raw.uv_size[1]), width: Math.abs(raw.uv_size[0]), height: Math.abs(raw.uv_size[1]) } : undefined
  }

  return <section class="model-canvas" aria-label="模型可视化">
    <div class="model-canvas-toolbar">
      <Show when={modes().length > 1}>
        <div class="model-canvas-modes" role="tablist" aria-label="模型查看模式">
          <For each={modes()}>{item => <button type="button" role="tab" aria-selected={mode() === item} onClick={() => props.onMode?.(item)}>{modeLabels[item]}</button>}</For>
        </div>
      </Show>
      <div class="model-canvas-actions">
        <button type="button" onClick={toggleExplosion} aria-pressed={exploded()}>{exploded() ? "收拢模型" : "展开模型"}</button>
        <button type="button" onClick={resetView}>重置视角</button>
        <Show when={hasSheet()}><button type="button" onClick={() => setShowUv(!showUv())} aria-pressed={showUv()}>UV</button></Show>
        <Show when={mode() === "animation" && animations().length}>
          {/* One motion needs no picker. */}
          <Show when={!props.hideMotionPicker && animations().length > 1}>
            <select aria-label="选择动作" value={playingClip()?.name} onChange={(event) => { const name = event.currentTarget.value; setPicked(name); props.onAnimation?.(name); controller?.setAnimation(name) }}><For each={animations()}>{item => <option value={item.name} selected={item.name === playingClip()?.name}>{(props.motionName ?? motionTitle)(item.name, !!props.rawNames)}</option>}</For></select>
          </Show>
          <button type="button" onClick={togglePlaying}>{playing() ? "暂停" : "播放"}</button>
          {/* A motion that does not loop plays once and holds its last pose: this starts it again. */}
          <Show when={playingClip() && !playingClip()!.loop}><button type="button" onClick={replay}>从头再放</button></Show>
        </Show>
      </div>
    </div>
    <div class="model-canvas-stage" classList={{ "with-uv": showUv() && !!design() }}><div ref={host} class="model-canvas-viewport" /><Show when={!design()}><div class="model-canvas-empty">还没有做出来</div></Show><Show when={showUv() && design()}><div class="model-canvas-uv" aria-label="UV 预览"><Show when={sheet()?.textureDataUrl} fallback={<span>{props.draftNote ?? "贴图将在模型完成后显示"}</span>}><img src={sheet()?.textureDataUrl} alt="模型纹理 UV" /><div class="model-canvas-uv-list"><For each={design()!.bones.flatMap((bone, boneIndex) => bone.cubes.flatMap((cube, cubeIndex) => uvFaces.map((face) => ({ bone: bone.name, cube, face, boneIndex, cubeIndex })) ))}>{item => { const rect = atlasRect(item.boneIndex, item.cubeIndex, item.face); if (!rect) return null; const part = `${item.bone}.${item.cube.name}`; return <span class={selectedPart() === part ? "selected" : ""} title={`${part} ${item.face}`} style={{ left: `${rect.x / textureWidth() * 100}%`, top: `${rect.y / textureHeight() * 100}%`, width: `${rect.width / textureWidth() * 100}%`, height: `${rect.height / textureHeight() * 100}%` }} /> }}</For></div></Show></div></Show></div>
  </section>
}

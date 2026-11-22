import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show, untrack } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { Hitbox } from "@minemods/mod-core/entity-runtime"
import { solidPartLegend, solidPartOutlines } from "./solid-part-preview"
import type { Item } from "@minemods/mod-core/content"
import { isItemOnlyModel } from "@minemods/mod-core/item-model-quality"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import { ModelAnnotation } from "./model-annotation"
import { ItemDisplay } from "./item-display"
import type { OverviewItem } from "../../api"
import { Icon } from "../ui"
import { mountViewport, type ViewportCameraState } from "../viewport"
import {
  cachedPicture,
  contentId,
  documentOf,
  draftPicture,
  extraAnimations,
  forgetLook,
  castLook,
  loadPicture,
  lookStamp,
  modelLook,
  named,
  pictureOf,
  textureOf,
  textureUrl,
  type Draft,
  type CastSide,
  type Look,
  type Picture,
  type Source,
} from "./asset-picture"
import type { RecipeKind } from "@minemods/mod-core/content-words"
import { benchOf } from "./asset-edit-recipe"
import { ParticleLife } from "./particle-life"
import { advanced } from "../advanced"
import { castWords, motionNamer } from "./asset-words"
import { playableClips } from "./motion-play-model"
import "./project-assets.css"

type Glyph = Parameters<typeof Icon>[0]["name"]

// One watcher for every tile: a picture is only made once its tile has come near the screen.
const waiting = new WeakMap<Element, () => void>()
const watcher =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(
        (entries) =>
          entries
            .filter((entry) => entry.isIntersecting)
            .forEach((entry) => {
              waiting.get(entry.target)?.()
              waiting.delete(entry.target)
              watcher?.unobserve(entry.target)
            }),
        { rootMargin: "240px" },
      )

// One flat grey for "shape only": every face samples the same colour, so only the light tells the faces apart.
const plain = { url: "" }
const grey = () => {
  if (plain.url) return plain.url
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 2
  const context = canvas.getContext("2d")
  if (!context) return ""
  context.fillStyle = "#cfcfcf"
  context.fillRect(0, 0, 2, 2)
  plain.url = canvas.toDataURL("image/png")
  return plain.url
}

/**
 * The picture in a tile: an image, never a live canvas. Until it is ready, and for kinds that have no
 * look of their own, the kind's mark stands in, with `words` under it when there are any. A picture that
 * changes is swapped in place, never blanked first.
 */
export function TilePicture(props: { picture: Picture | null; glyph: Glyph; words?: string | null }) {
  let host!: HTMLSpanElement
  const [near, setNear] = createSignal(!watcher)
  const key = createMemo(() => props.picture?.key)
  const [url, setUrl] = createSignal(cachedPicture(key() ?? "") ?? null)
  onMount(() => {
    if (!watcher) return
    waiting.set(host, () => setNear(true))
    watcher.observe(host)
    onCleanup(() => watcher.unobserve(host))
  })
  createEffect(() => {
    const picture = untrack(() => props.picture)
    if (!key() || !picture) return setUrl(null)
    const ready = cachedPicture(picture.key)
    if (ready !== undefined) return setUrl(ready)
    if (!near()) return
    void loadPicture(picture).then((next) => key() === picture.key && setUrl(next))
  })
  return (
    <span ref={host} class="pa-picture" classList={{ pixel: props.picture?.pixel, drawn: !!url(), sign: !props.picture }}>
      <Show when={url()} fallback={<Icon name={props.glyph} />}>
        <img src={url()!} alt="" draggable={false} />
      </Show>
      <Show when={!url() && props.words}>
        <em class="pa-picture-words">{props.words}</em>
      </Show>
    </span>
  )
}

/**
 * A model in the round: drag to turn it, one button per action it knows, and a switch between wearing
 * its texture and showing the bare shape. It stands still until an action is picked. Only ever one
 * WebGL view: it is thrown away when the card closes or the model changes.
 */
export function ModelStage(props: {
  projectId: string
  project: Project
  source: Source
  body?: Hitbox | null
  /** The action to offer first, e.g. the one a rule plays. */
  first?: string | null
  /** Open the texture it wears on its own. */
  onTexture?: () => void
  onAnnotate?: (prompt: string, input: ModelAnnotationInput) => Promise<unknown>
  disabled?: boolean
  onDirty?: (dirty: boolean) => void
}) {
  let host!: HTMLDivElement
  const [look, setLook] = createSignal<Look | null>()
  const [slow, setSlow] = createSignal(false)
  const [moving, setMoving] = createSignal("")
  const [bare, setBare] = createSignal(false)
  const [attempt, setAttempt] = createSignal(0)
  const [selectedPart, setSelectedPart] = createSignal("")
  const [loadedStamp, setLoadedStamp] = createSignal("")
  const stage: { controller: ReturnType<typeof mountViewport> | null; camera?: ViewportCameraState; paused: boolean; again: number } = {
    controller: null,
    paused: true,
    again: 0,
  }
  // Changes only when the model or its texture was saved again, so a refresh of the page keeps the pose and the camera.
  const stamp = createMemo(() => `${lookStamp(props.projectId, props.project, props.source)}:${attempt()}`)
  createEffect(
    on(stamp, (current) => {
      setSlow(false)
      setSelectedPart("")
      const timer = window.setTimeout(() => current === stamp() && look() === undefined && setSlow(true), 8000)
      onCleanup(() => window.clearTimeout(timer))
      void modelLook(props.projectId, props.project, props.source).then((next) => {
        if (current !== stamp()) return
        setLook(next)
        setLoadedStamp(current)
      })
    }),
  )
  // Compared by content: the app hands over a fresh copy of the project on every refresh, and a copy that
  // says the same must not rebuild the view under the person's hand.
  const extras = createMemo(() => (props.source.model_asset_id ? extraAnimations(props.project, props.source.model_asset_id) : []), undefined, {
    equals: (before, after) => JSON.stringify(before) === JSON.stringify(after),
  })
  const design = createMemo(() => {
    const current = look()
    if (!current) return null
    const bones = new Set(current.model.bones.map((bone) => bone.name))
    return {
      ...current.model,
      // Animations saved on their own only play when every part they move exists on this model.
      animations: playableClips(
        current.model.animations,
        extras().map((value) => ({ name: value.name, length: value.length, loop: value.loop, channels: value.channels })),
        bones,
      ),
    }
  })
  // The action a rule plays comes first, so the person finds it without reading names.
  // Each button says what the motion is in the person's words (`motionWords`): the word for a common motion, else what plays it (an ability, a gameplay), so 「冲锋」 can be found among the buttons. The document's own name only under 高级.
  const motionName = createMemo(() => motionNamer(props.project, props.source.model_asset_id ?? props.project.entities.find((value) => value.id === props.source.entity_id)?.model_asset_id))
  const itemModel = createMemo(() => !!props.source.model_asset_id && isItemOnlyModel(props.project, props.source.model_asset_id))
  const actions = createMemo(() => {
    if (itemModel()) return []
    const list = design()?.animations ?? []
    return [...list.filter((value) => value.name === props.first), ...list.filter((value) => value.name !== props.first)]
  })
  const drop = () => {
    window.clearTimeout(stage.again)
    stage.again = 0
    stage.camera = stage.controller?.getCameraState() ?? stage.camera
    stage.controller?.dispose()
    stage.controller = null
  }
  createEffect(() => {
    const model = design()
    const shape = bare()
    untrack(() => {
      drop()
      if (!model || !host) return
      const current = look()!
      const name = model.animations.some((value) => value.name === moving()) ? moving() : ""
      setMoving(name)
      stage.paused = !name
      stage.controller = mountViewport(host, model, current.preview && shape ? { ...current.preview, textureDataUrl: grey() } : current.preview, () => undefined, {
        animation: name || actions()[0]?.name,
        playing: !!name,
        time: name ? undefined : 0,
        camera: stage.camera,
        onSelectPart: setSelectedPart,
        // An action that is done once (being hit) is shown again after a breath, or it would be over before it is seen.
        onTick: (time) => {
          const active = model.animations.find((value) => value.name === moving())
          if (!active || active.loop || stage.again || time < active.length - 0.02) return
          stage.again = window.setTimeout(() => {
            stage.again = 0
            stage.controller?.setAnimation(active.name)
          }, 700)
        },
      })
    })
  })
  const outlines = createMemo(() => moving() ? [] : solidPartOutlines(props.body, design()))
  createEffect(() => {
    const boxes = outlines()
    // Changing how the model is shaded mounts a new canvas.
    bare()
    stage.controller?.outlineBoxes(boxes)
  })
  onCleanup(drop)
  const play = (name: string) => {
    window.clearTimeout(stage.again)
    stage.again = 0
    setMoving(name)
    stage.controller?.setAnimation(name)
    if (stage.paused) stage.controller?.togglePlaying()
    stage.paused = false
  }
  const stop = () => {
    window.clearTimeout(stage.again)
    stage.again = 0
    setMoving("")
    stage.paused = true
    const rest = actions()[0]?.name
    if (rest) stage.controller?.setAnimation(rest)
    stage.controller?.seek(0)
  }
  const sheet = () => textureOf(props.project, props.source.texture_asset_id)
  return (
    <div class="pa-live">
      <div class="pa-view mc-well" data-moving={moving() || undefined} data-skin={bare() ? "shape" : "texture"}>
        <div ref={host} class="pa-view-host" />
        <Show when={look() === undefined && !slow()}>
          <span class="pa-view-note">正在把它摆出来…</span>
        </Show>
        <Show when={look() === undefined && slow()}>
          <span class="pa-view-note">
            摆得有点慢。
            <button
              type="button"
              class="pa-move"
              onClick={() => {
                forgetLook(props.projectId, props.project, props.source)
                setAttempt(attempt() + 1)
              }}
            >
              再试一次
            </button>
          </span>
        </Show>
        <Show when={look() === null}>
          <span class="pa-view-note">这个模型现在显示不出来。可以点「打开它」看看。</span>
        </Show>
        <Show when={look()?.preview}>
          <div class="pa-skin" role="group" aria-label="怎么看">
            <button type="button" aria-pressed={!bare()} onClick={() => setBare(false)}>
              {look()!.texture ? "带贴图" : "带颜色"}
            </button>
            <button type="button" aria-pressed={bare()} onClick={() => setBare(true)}>
              只看形状
            </button>
          </div>
        </Show>
        <Show when={look()}>
          <span class="pa-view-tip">按住拖动可以转着看，滚轮放大</span>
        </Show>
      </div>
      <Show when={outlines().length}><p class="pa-hint">{solidPartLegend(outlines())}</p></Show>
      <Show when={props.onAnnotate && props.source.model_asset_id}>
        <ModelAnnotation
          capture={async () => {
            if (!stage.controller || loadedStamp() !== stamp()) throw new Error("模型更新中，请稍后截图。")
            return stage.controller.captureCurrent()
          }}
          sourceKey={stamp()}
          targetId={props.source.model_asset_id!}
          projectRevision={props.project.revision}
          selectedPart={selectedPart()}
          disabled={props.disabled || !design() || loadedStamp() !== stamp()}
          onSubmit={(prompt, input) => props.onAnnotate!(prompt, input)}
          onDirty={props.onDirty}
        />
      </Show>
      <Show when={design()}>
        <div class="pa-moves" role="group" aria-label="动作">
          <Show when={actions().length} fallback={<span class="pa-moves-label">{itemModel() ? "静态物品外观 · 在物品中调整持握" : "它还不会动，只有站着的样子。"}</span>}>
            <span class="pa-moves-label">让它动一动</span>
            <For each={actions()}>
              {(value) => (
                <button
                  type="button"
                  class="pa-move"
                  aria-pressed={moving() === value.name}
                  title={value.loop ? "一直重复" : "做一次，停一下再做"}
                  onClick={() => play(value.name)}
                >
                  <Icon name="play" />
                  {motionName()(value.name, advanced())}
                </button>
              )}
            </For>
            <button type="button" class="pa-move" disabled={!moving()} onClick={stop}>
              <i class="pa-stop-mark" aria-hidden="true" />
              停下
            </button>
          </Show>
          <span class="pa-moves-gap" />
          <button type="button" class="pa-move" title="回到一开始的角度" onClick={() => stage.controller?.resetCamera()}>
            摆正
          </button>
        </div>
        <Show
          when={sheet()}
          fallback={<p class="pa-hint">{look()?.preview ? "它还没有单独的贴图，现在看到的是模型自己的颜色。" : "现在看到的是模型自己的颜色。"}</p>}
        >
          {(value) => (
            <div class="pa-worn">
              <span class="pa-worn-sheet mc-well">
                <img src={textureUrl(value().document)} alt="" draggable={false} />
              </span>
              <span class="pa-worn-words">
                <strong>它身上的贴图</strong>
                <small>
                  「{value().asset.title}」摊平的样子，{value().document.width} × {value().document.height} 格。
                </small>
              </span>
              <Show when={props.onTexture}>
                <button type="button" class="pa-move" onClick={() => props.onTexture?.()}>
                  单独看这张贴图
                </button>
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  )
}

// The one place a broken cast action is caught: the preview functions throw on anything that cannot be played.
const attempt = <T,>(make: () => T) => {
  try {
    return make()
  } catch {
    return null
  }
}

/**
 * A cast action from both sides: what the player sees of their own arms, through the game's own lens, and
 * the block figure other players see. One WebGL view at a time: changing sides throws the other away.
 * It is played over and over with a breath in between so it can be watched; in the game one key press
 * plays it once. `facts` adds the plain-word facts under it, for pages that have no card around it.
 */
export function CastStage(props: { document: unknown; facts?: boolean }) {
  let host!: HTMLDivElement
  let strip: HTMLDivElement | undefined
  const [side, setSide] = createSignal<CastSide>("first_person")
  const [playing, setPlaying] = createSignal(true)
  const [phase, setPhase] = createSignal("")
  const stage: { controller: ReturnType<typeof mountViewport> | null; again: number; time: number } = { controller: null, again: 0, time: 0 }
  // Compared by content: the app hands over a fresh copy of the project on every refresh.
  const stamp = createMemo(() => JSON.stringify(props.document))
  const look = createMemo(() => {
    stamp()
    return attempt(() => castLook(untrack(() => props.document), side()))
  })
  const words = createMemo(() => (props.facts && look() ? castWords(props.document as Parameters<typeof castWords>[0]) : null))
  const drop = () => {
    window.clearTimeout(stage.again)
    stage.again = 0
    stage.controller?.dispose()
    stage.controller = null
  }
  createEffect(() => {
    const current = look()
    untrack(() => {
      drop()
      setPhase("")
      if (!current || current.hidden || !host) return
      setPlaying(true)
      stage.controller = mountViewport(host, current.design, current.preview, () => undefined, {
        animation: "gesture",
        playing: true,
        camera: current.camera,
        onTick: (time) => {
          stage.time = time
          // A moment on the line between two stretches belongs to the one that ends there; once it is over, none is lit.
          setPhase(time < current.length - 0.02 ? (current.phases.find((value) => time <= value.end + 0.001)?.id ?? "") : "")
          strip?.style.setProperty("--at", `${(time / current.length) * 100}%`)
          if (!playing() || stage.again || time < current.length - 0.02) return
          stage.again = window.setTimeout(() => {
            stage.again = 0
            stage.controller?.setAnimation("gesture")
          }, 700)
        },
      })
    })
  })
  onCleanup(drop)
  const again = () => {
    window.clearTimeout(stage.again)
    stage.again = 0
    stage.controller?.setAnimation("gesture")
    if (!playing()) setPlaying(stage.controller?.togglePlaying() ?? false)
  }
  const play = () => {
    if (stage.time >= look()!.length - 0.02) return again()
    setPlaying(stage.controller?.togglePlaying() ?? false)
  }
  const stop = () => {
    window.clearTimeout(stage.again)
    stage.again = 0
    setPlaying(stage.controller?.togglePlaying() ?? false)
  }
  const jump = (time: number) => {
    window.clearTimeout(stage.again)
    stage.again = 0
    stage.controller?.seek(time)
    setPlaying(false)
  }
  return (
    <div class="pa-live pa-cast">
      <div class="pa-tabs" role="tablist" aria-label="从谁的眼睛看">
        <button type="button" role="tab" aria-selected={side() === "first_person"} onClick={() => setSide("first_person")}>
          自己看到的<small>第一人称</small>
        </button>
        <button type="button" role="tab" aria-selected={side() === "third_person"} onClick={() => setSide("third_person")}>
          别人看到的<small>第三人称</small>
        </button>
      </div>
      <div class="pa-view mc-well" data-side={side()} data-playing={playing() ? "yes" : "no"} data-phase={phase() || undefined}>
        <div ref={host} class="pa-view-host" />
        <Show when={look()} fallback={<span class="pa-view-note">这个动作的数据有问题，播不出来。</span>}>
          <Show when={look()!.hidden}>
            <span class="pa-view-note">这个动作在第一人称下不显示手臂，自己看不到。点「别人看到的」看它的样子。</span>
          </Show>
          <Show when={side() === "third_person"}>
            <span class="pa-view-tip">按住拖动可以转着看，滚轮放大</span>
          </Show>
          <Show when={side() === "first_person" && !look()!.hidden}>
            <i class="pa-crosshair" aria-hidden="true" />
            <span class="pa-view-tip">从你自己的眼睛看出去，中间是准星</span>
          </Show>
        </Show>
      </div>
      <Show when={look() && !look()!.hidden}>
        <div ref={strip} class="pa-phases" role="group" aria-label="动作分几段">
          <For each={look()!.phases}>
            {(value) => (
              <button
                type="button"
                class="pa-phase"
                style={{ "flex-grow": value.end - value.start }}
                aria-current={phase() === value.id ? "step" : undefined}
                title={`停在「${value.label}」这一段看看`}
                onClick={() => jump(value.still)}
              >
                {value.label}
                <small>{Number((value.end - value.start).toFixed(2))} 秒</small>
              </button>
            )}
          </For>
          <i class="pa-phase-at" aria-hidden="true" />
        </div>
        <div class="pa-moves" role="group" aria-label="播放">
          <button type="button" class="pa-move" disabled={playing()} onClick={play}>
            <Icon name="play" />
            播放
          </button>
          <button type="button" class="pa-move" disabled={!playing()} onClick={stop}>
            <i class="pa-stop-mark" aria-hidden="true" />
            停下
          </button>
          <button type="button" class="pa-move" onClick={again}>
            再放一遍
          </button>
          <span class="pa-moves-gap" />
          <Show when={side() === "third_person"}>
            <button type="button" class="pa-move" title="回到一开始的角度" onClick={() => stage.controller?.resetCamera()}>
              摆正
            </button>
          </Show>
        </div>
        <p class="pa-hint">
          {side() === "first_person"
            ? "这是你自己在游戏里看到的：只有自己的两条手臂伸进画面。这里会重复放，方便看；游戏里按一次只做一遍。点上面的某一段可以停在那里。"
            : "这是别的玩家看到你的样子。小人穿的是 Studio 自带的衣服，游戏里是你自己的皮肤。"}
        </p>
      </Show>
      <Show when={words()}>
        {(value) => (
          <>
            <Show when={value().sentence}>
              <p class="pa-sentence">{value().sentence}</p>
            </Show>
            <dl class="pa-words">
              <For each={value().rows}>
                {(row) => (
                  <>
                    <dt>{row.label}</dt>
                    <dd>{row.text}</dd>
                  </>
                )}
              </For>
            </dl>
            <For each={value().notes}>{(note) => <p class="pa-hint">{note}</p>}</For>
          </>
        )}
      </Show>
    </div>
  )
}

/** A texture flat, every pixel a sharp square, with a way to look closer, and on its model when one is known. */
export function TextureStage(props: { projectId: string; project: Project; item: OverviewItem }) {
  const [worn, setWorn] = createSignal(false)
  const [zoom, setZoom] = createSignal(1)
  const sheet = () => textureOf(props.project, props.item.asset_id)
  const wearer = () => !!(props.item.preview.entity_id || props.item.preview.model_asset_id)
  // Follows the item, so walking from card to card never shows the previous thing's choice.
  createEffect(
    on(
      () => props.item.id,
      () => {
        setWorn(false)
        setZoom(1)
      },
    ),
  )
  return (
    <div class="pa-live">
      <Show when={wearer()}>
        <div class="pa-moves" role="group" aria-label="怎么看这张贴图">
          <button type="button" class="pa-move" aria-pressed={!worn()} onClick={() => setWorn(false)}>
            摊平了看
          </button>
          <button type="button" class="pa-move" aria-pressed={worn()} onClick={() => setWorn(true)}>
            贴在模型上看
          </button>
        </div>
      </Show>
      <Show
        when={worn() && wearer()}
        fallback={
          <Show when={sheet()} fallback={<div class="pa-view mc-well"><span class="pa-view-note">这张贴图现在显示不出来。可以点「打开它」看看。</span></div>}>
            {(value) => (
              <>
                <div class="pa-view mc-well sheet" classList={{ zoomed: zoom() > 1 }} tabIndex={zoom() > 1 ? 0 : undefined}>
                  <img
                    class="pa-flat"
                    style={zoom() > 1 ? { width: `${zoom() * 100}%`, height: "auto" } : undefined}
                    src={textureUrl(value().document)}
                    alt={`${props.item.title}，摊平的样子`}
                    draggable={false}
                  />
                </div>
                <div class="pa-moves" role="group" aria-label="放大缩小">
                  <span class="pa-moves-label">{zoom() > 1 ? `放大了 ${zoom()} 倍，可以拖滚动条看别处` : "整张的样子"}</span>
                  <span class="pa-moves-gap" />
                  <button type="button" class="pa-move" disabled={zoom() <= 1} aria-label="缩小" onClick={() => setZoom(zoom() / 2)}>
                    缩小
                  </button>
                  <button type="button" class="pa-move" disabled={zoom() >= 8} aria-label="放大" onClick={() => setZoom(zoom() * 2)}>
                    放大
                  </button>
                </div>
                <p class="pa-hint">
                  {wearer() ? "这是摊平的样子，像一张还没折起来的包装纸；一格就是游戏里的一个小方点。" : "这是摊平的样子，一格就是游戏里的一个小方点。"}
                </p>
              </>
            )}
          </Show>
        }
      >
        <ModelStage projectId={props.projectId} project={props.project} source={props.item.preview} />
      </Show>
    </div>
  )
}

/** A recipe laid out like the game's crafting table: nine cells, an arrow, what comes out. */
export function RecipeGrid(props: {
  projectId: string
  project: Project
  items: OverviewItem[]
  pattern: (string | null)[]
  result: string
  count: number
  /** Which station it is made on; absent, a workbench where places count (an older recipe). */
  type?: RecipeKind | undefined
  onOpen: (id: string) => void
}) {
  const others = () => props.items.filter((item) => item.kind !== "recipe")
  const bench = createMemo(() => benchOf({ type: props.type, pattern: props.pattern }))
  const cell = (reference: string | null, big = false, label?: string) => {
    const part = () => (reference ? named(props.projectId, props.project, others(), reference) : null)
    const words = () => [label, part()?.name ?? (label ? "空" : null)].filter(Boolean).join("：")
    return (
      <button
        type="button"
        class="pa-part mc-slot"
        classList={{ big, blank: !reference, still: !part()?.item }}
        title={words() || undefined}
        aria-label={words() || "空"}
        disabled={!part()?.item}
        onClick={() => part()?.item && props.onOpen(part()!.item!)}
      >
        <Show when={part()}>
          {(value) => (
            <Show when={value().picture} fallback={<span class="pa-letter">{value().name.slice(0, 2)}</span>}>
              <PartPicture picture={value().picture!} name={value().name} />
            </Show>
          )}
        </Show>
        <Show when={big && props.count > 1}>
          <em class="pa-count-mark">{props.count}</em>
        </Show>
      </button>
    )
  }
  const used = () => [...new Set(props.pattern.filter((value): value is string => value !== null))]
  const name = (reference: string) => named(props.projectId, props.project, others(), reference).name
  return (
    <div class="pa-recipe">
      <div class="pa-craft">
        <span class="pa-craft-title">{bench().title}</span>
        <div class="pa-craft-grid" style={{ "grid-template-columns": `repeat(${bench().columns}, 60px)` }}>
          <For each={bench().slots}>{(reference, index) => cell(reference, false, bench().labels[index()])}</For>
        </div>
        <svg class="pa-craft-arrow" viewBox="0 0 11 9" shape-rendering="crispEdges" aria-hidden="true">
          <path fill="currentColor" d="M0 3h6v3H0zM6 0h1v1h1v1h1v1h1v1h1v1h-1v1H9v1H8v1H7v1H6z" />
        </svg>
        {cell(props.result, true)}
      </div>
      <dl class="pa-parts-list">
        <dt>材料</dt>
        <dd>
          <For each={used()}>
            {(reference) => (
              <span>
                {name(reference)}
                <small>× {props.pattern.filter((value) => value === reference).length}</small>
              </span>
            )}
          </For>
        </dd>
        <dt>做出来</dt>
        <dd>
          <span>
            {name(props.result)}
            <small>× {props.count}</small>
          </span>
        </dd>
      </dl>
    </div>
  )
}

/** A picture inside a recipe cell; the first letters of the name stand in when it cannot be drawn. */
function PartPicture(props: { picture: Picture; name: string }) {
  const [url, setUrl] = createSignal(cachedPicture(props.picture.key) ?? null)
  createEffect(() => {
    const picture = props.picture
    void loadPicture(picture).then((next) => picture.key === props.picture.key && setUrl(next))
  })
  return (
    <Show when={url()} fallback={<span class="pa-letter">{props.name.slice(0, 2)}</span>}>
      <img src={url()!} alt="" draggable={false} classList={{ pixel: props.picture.pixel }} />
    </Show>
  )
}

/**
 * The big look of one thing in its card. Creatures and models turn and move, a texture is shown
 * pixel for pixel and can be put on its model, a recipe is its crafting grid, everything else shows its
 * picture large. Something not made yet says so; it never gets a made-up picture.
 */
export function AssetStage(props: {
  projectId: string
  project: Project
  items: OverviewItem[]
  item: OverviewItem
  glyph: Glyph
  /** What an outside AI has shown of it so far, when it is being made. */
  draft?: Draft | null
  /** The newest picture the making loop looked at, while the thing is still being made. */
  round?: Picture | null
  onOpen: (id: string) => void
  onSaveItem?: (item: Item) => Promise<void>
  onAnnotateModel?: (prompt: string, input: ModelAnnotationInput) => Promise<unknown>
  onDirty?: (dirty: boolean) => void
  disabled?: boolean
}) {
  const document = () => documentOf(props.project, props.item)
  const body = () => {
    const current = document()
    if (current?.kind === "entity") return current.hitbox
    if (props.item.kind === "entity") return props.project.entities.find((entity) => entity.id === props.item.preview.entity_id)?.hitbox
  }
  const heldItem = () => props.item.kind === "item" ? props.project.items.find((value) => value.id === (props.item.asset_id ?? contentId(props.item))) : undefined
  const drawable = () => props.item.preview.source !== null || (props.item.facts.saved && ["sound","music","fixture"].includes(props.item.kind))
  const rule = () => {
    const current = document()
    if (current?.kind === "logic") return current
    return props.item.kind === "logic" ? props.project.logic.find((value) => value.id === contentId(props.item)) : undefined
  }
  const moves = () => {
    const current = document()
    return current?.kind === "animation" ? current.name : (rule()?.animation ?? null)
  }
  // Anything shown on a model: the model itself, its creature, an action for it, a rule about it.
  const modelled = () =>
    drawable() &&
    ["model", "entity", "animation", "logic"].includes(props.item.kind) &&
    !!(props.item.preview.entity_id || textureless())
  const textureless = () => props.project.workspace.assets.some((asset) => asset.id === props.item.preview.model_asset_id && asset.document.kind === "model")
  const recipe = () => {
    const current = document()
    if (current?.kind === "recipe") return current
    return props.item.kind === "recipe" && drawable() ? props.project.recipes.find((value) => value.id === contentId(props.item)) : undefined
  }
  const particle = () => {
    const current = document()
    return drawable() && current?.kind === "particle" ? current : null
  }
  const sheet = () => drawable() && props.item.kind === "texture"
  const gesture = () => (drawable() && props.item.kind === "gesture" ? document() : undefined)
  const picture = createMemo(() => pictureOf(props.projectId, props.project, props.items, props.item))
  const sketch = createMemo(() => (props.draft ? draftPicture(props.draft) : (props.round ?? null)))
  const wornBy = () => props.items.find((value) => value.asset_id !== null && value.asset_id === props.item.preview.texture_asset_id && value.id !== props.item.id)
  return (
    <div class="pa-stage" data-kind={props.item.kind}>
      <Show when={props.item.status === "making" && props.item.facts.saved}>
        <p class="pa-ribbon" role="status">
          <i class="pa-working" aria-hidden="true" />
          {props.item.queued ? "这是上一版。重做在排队，还没开始，轮到它做好以后这里会换成新的。" : "这是上一版。AI 正在重做，做好以后这里会换成新的。"}
        </p>
      </Show>
      <Show when={modelled()}>
        <ModelStage
          projectId={props.projectId}
          project={props.project}
          source={props.item.preview}
          body={body()}
          first={moves()}
          onTexture={wornBy() ? () => props.onOpen(wornBy()!.id) : undefined}
          onAnnotate={props.item.kind === "model" ? props.onAnnotateModel : undefined}
          disabled={props.disabled || props.item.status === "making"}
          onDirty={props.onDirty}
        />
      </Show>
      <Show when={sheet()}>
        <TextureStage projectId={props.projectId} project={props.project} item={props.item} />
      </Show>
      <Show when={recipe()}>
        {(value) => (
          <RecipeGrid projectId={props.projectId} project={props.project} items={props.items} pattern={value().pattern} result={value().result} count={value().count} type={value().type} onOpen={props.onOpen} />
        )}
      </Show>
      <Show when={gesture()}>{(value) => <CastStage document={value()} />}</Show>
      <Show when={heldItem()}>{(item) => <ItemDisplay item={item()} project={props.project} disabled={props.disabled || props.item.status === "making"} onSave={props.onSaveItem} onDirty={props.onDirty} onEditModel={(modelId) => { const target = props.items.find((value) => value.asset_id === modelId); if (target) props.onOpen(target.id) }} />}</Show>
      <Show when={particle()}>{value => <ParticleLife document={value()} />}</Show>
      <Show when={drawable() && !modelled() && !sheet() && !recipe() && !gesture() && !heldItem() && !particle()}>
        <div class="pa-view mc-slot still" data-status={props.item.status}>
          <TilePicture picture={picture()} glyph={props.glyph} />
        </div>
      </Show>
      <Show when={!drawable()}>
        <div class="pa-view still ghost" data-status={props.item.status}>
          <Show when={sketch()} fallback={<TilePicture picture={null} glyph={props.glyph} />}>
            <TilePicture picture={sketch()} glyph={props.glyph} />
          </Show>
          <Show when={props.item.status === "making" && !props.item.queued}>
            <i class="pa-working" aria-hidden="true" />
          </Show>
        </div>
        <p class="pa-pending" data-status={props.item.status}>
          {props.item.status === "making" && props.item.queued
            ? "在排队，还没开始做。轮到它做好以后，这里会换成它真正的样子。"
            : props.item.status === "making"
            ? sketch()
              ? props.draft
                ? `正在做。上面是 AI 画到一半的草稿${props.draft.progress ? `（大约 ${props.draft.progress}%）` : ""}，还不是最后的样子。`
                : "正在做。上面是 AI 最新一轮做出来的样子，它还在对着图检查、修改。"
              : "正在做。做好以后，这里会换成它真正的样子。"
            : props.item.status === "out_of_scope"
              ? "不做这个了，没有成品可看。"
              : sketch()
                ? "这是 AI 停下时做出来的样子。它没有达到标准，所以没有存进工程。"
                : "它还没做出来，所以现在没有样子可以看。"}
        </p>
      </Show>
    </div>
  )
}

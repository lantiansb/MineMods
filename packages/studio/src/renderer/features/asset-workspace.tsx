import { CardShell } from "./project-assets"
import type { JSX } from "solid-js"
import { Button } from "../ui"
import { AbilityUsers } from "./ability-users"
import { kindLabel, thingName, gameName } from "../words"
import { particleScene } from "@minemods/mod-core/particle-scene"
import {SHAPES,SHAPE_PARAMETERS} from "@minemods/studio-ai/particle-shapes"
import {layeredParticles,particleExamples,type SceneExample} from "@minemods/mod-core/particle-context"
import { particleTicks } from "@minemods/mod-core/particle"
import { particleImage, particleSource } from "./particle-image"
import { For, Show, batch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { assetChip, usersOf } from "./project-navigation-model"
import { cachedOverview, overviewKey, readOverview } from "./overview-cache"
import { makingLock, LOCK_THEN } from "./making-lock"
import { createStore, reconcile } from "solid-js/store"
import { advanced } from "../advanced"
import { isLooked } from "@minemods/studio-ai/making"
import type { Project } from "@minemods/mod-core/project"
import { MODULES, type ModuleKind } from "@minemods/mod-core/workspace-modules"
import type { ModuleDocument, WorkspaceAsset } from "@minemods/mod-core/workspace"
import type { Making, OverviewItem, PartSheet, StudioView } from "../../api"
import type { ProjectRun } from "../../project-runs"
import { VoiceInput } from "./voice-input"
import { ItemIcon } from "./item-icon"
import { AssetAppearance } from "./asset-appearance"
import { ModelCanvas, type ModelCanvasMode } from "./model-canvas"
import { SteadySetting } from "./steady-setting"
import { EntityPreview } from "./entity-preview"
import { CastStage } from "./asset-preview"
import { ThingMenu } from "./thing-menu"
import { SoundUsers } from "./creature-sounds"
import { AudioEditor, SoundMetadata } from "./audio-editor"
import "./asset-workspace.css"
import { RewardPool, asRewardPool } from "./reward-pool"
import { effectClip, effectModel, effectTexture, effectUnplayed } from "@minemods/mod-core/effect"
import { fixtureLines, fixtureModel } from "@minemods/mod-core/fixture"
import { abilityAssetLines } from "@minemods/mod-core/ability-asset"
import { bossBarLayout, bossBarMoments, drawBossBar, evenLines, type Picture as BossBarPicture } from "@minemods/mod-core/boss-bar"
import { paintedPreview } from "../model-paint-preview"
import type { Preview } from "../viewport"
import { MakingStory, makingLive } from "./asset-making"
import { MotionPlay } from "./motion-play"
import { THREE_VIEW_WORDS, wantsThreeView } from "./three-view-model"
import { ThreeViewBlock, threeViewsReady } from "./three-view"
import { blueprintSourceKey } from "@minemods/mod-core/task-source"
import { creatorWords } from "@minemods/mod-core/creator-words"
import { boneTitles, describeAsset, type Words, redoPromise, redoSentence, retryWords, motionNamer } from "./asset-words"
import { ParticleColours } from "./particle-colors"
import { loadPicture, named, pictureOf } from "./asset-picture"
import { ContentEditor } from "./content-editor"
import { BookPreview } from "./book-pages"
import { handWired, type HandApi } from "./asset-edit-save"
import { BLANK_KINDS, blankDocument, isHandKind, type Loose } from "./asset-edit-words"
import { Fold } from "../fold"
import { Said, SaidLines } from "./play-text"
import type { Item } from "@minemods/mod-core/content"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import { ItemDisplay } from "./item-display"
import { ModelAnnotation, type AnnotationCapture } from "./model-annotation"

const objectives: Record<ModuleKind, string> = {
  book: "像在游戏里一样一页一页翻这本书；排不下的地方标红。玩家第一次进世界就会拿到它。",
  entity: "检查生物外观、它怎么出现与战斗行为。",
  model: "查看骨骼与部件，进入模型编辑器继续调整外观和动作。",
  texture: "查看像素、调色板与尺寸。独立贴图保存后还需绑定模型。",
  animation: "查看骨骼轨道和关键帧。游戏里的动作要在模型里编辑。",
  block: "调整硬度、发光、挖掘工具与掉落。",
  item: "设计物品的外观、名称与堆叠数量。",
  recipe: "查看材料摆放、合成产物与数量。",
  logic: "设定生物在什么条件下执行什么动作。",
  worldview: "整理世界背景、角色与故事设定。",
  biome: "设计群系的气候与天空、雾和水的颜色。",
  dimension: "设计维度的天空、环境光与空间特征。",
  terrain: "安排地层材料、厚度与地形特征。",
  gesture: "查看动作在自己眼里和别人眼里的样子，以及用哪个按键播放。",
  gameplay: "看这个玩法会做什么、挂在哪些东西上；它的代码是 AI 写的，要自己进游戏试。",
  effect: "看这个效果的样子和它自己的动作；它由生物的招式或者玩法放出来，出现一下就消失。",
  music: "前奏、循环段和结尾可以在这里试听。在 Boss 的「它的声音」里选上以后，战斗时游戏里就会放它。",
  sound: "试听这个声音的每个文件，看它多长、谁在用；它由生物的叫声、受伤、死、走路或者招式放出来。",
  particle: "看这个粒子的几张小图和它一生怎么变；它由生物招式里的粒子事件放出来。",
  bossbar: "看 Boss 血条在满血、刚过第一条线正在碎锁、残血时的样子；给 Boss 选用这条血条后，游戏里就会显示。",
  fixture: "看场地物件没点亮和点亮的样子；把它放在 Boss 的战斗场地里，玩家按住右键点亮它。",
  ability: "看这个技能怎么放（一按就放、蓄力还是持续施法）、数值多少、绑在哪件物品、哪个方块或哪个按键上；好不好用要进游戏试。",
}
/** Said where a thing's page has nothing to show yet. */
const NOTHING_MADE = "还没有做出来"
type SheetParts = PartSheet["parts"]
const safeError = (cause: unknown) =>
  cause instanceof Error
    ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
    : "模块任务执行失败"
type DocumentOf<K extends ModuleKind> = Extract<ModuleDocument, { kind: K }>

function PreviewGlyph(props: { name: "root" | "branch" | "arrow" }) {
  const paths = {
    root: "M12 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM12 8.5v4m0 0-4 4m4-4 4 4",
    branch: "M6 4v16m0-12h6m0 0 3 3m-3-3 3-3",
    arrow: "M4 12h15m-6-6 6 6-6 6",
  } as const
  return (
    <svg
      class="preview-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={paths[props.name]} />
    </svg>
  )
}

function TexturePreview(props: { document: DocumentOf<"texture"> }) {
  let canvas!: HTMLCanvasElement
  createEffect(() => {
    canvas.width = props.document.width
    canvas.height = props.document.height
    const context = canvas.getContext("2d")
    if (!context) return
    const image = context.createImageData(props.document.width, props.document.height)
    props.document.pixels.forEach((paletteIndex, index) => {
      const color = props.document.palette[paletteIndex] ?? "#000000"
      image.data[index * 4] = Number.parseInt(color.slice(1, 3), 16)
      image.data[index * 4 + 1] = Number.parseInt(color.slice(3, 5), 16)
      image.data[index * 4 + 2] = Number.parseInt(color.slice(5, 7), 16)
      image.data[index * 4 + 3] = 255
    })
    context.putImageData(image, 0, 0)
  })
  return (
    <div class="asset-preview texture-preview" aria-label="贴图像素预览">
      <canvas ref={canvas} role="img" aria-label={`${props.document.width}×${props.document.height} 贴图`} />
    </div>
  )
}

/**
 * Boss 能力 6: a boss bar at the three moments every look of it shows (`bossBarMoments`), drawn by the very function the reviewer's pictures are (`drawBossBar`),
 * each picture with what it shows under it. A bar whose pictures cannot be read says so instead.
 */
function BossBarPreview(props: { document: DocumentOf<"bossbar">; advanced: boolean }) {
  const drawn = createMemo(() => {
    try {
      const layout = bossBarLayout(props.document)
      const lines = evenLines(layout.segments.length)
      return bossBarMoments(layout, lines, props.advanced).map((moment) => ({ label: moment.label, picture: drawBossBar(layout, lines, moment.state) }))
    } catch {
      return null
    }
  })
  const paint = (canvas: HTMLCanvasElement, picture: BossBarPicture) => {
    canvas.width = picture.width
    canvas.height = picture.height
    const context = canvas.getContext("2d")
    if (!context) return
    const image = context.createImageData(picture.width, picture.height)
    image.data.set(picture.pixels)
    context.putImageData(image, 0, 0)
  }
  return (
    <Show when={drawn()} fallback={<div class="asset-preview asset-preview-empty">这个血条里有读不出来的图，画不出来。</div>}>
      {(moments) => (
        <div class="asset-preview texture-preview" aria-label="血条预览">
          <For each={moments()}>
            {(moment) => (
              <>
                <canvas ref={(canvas) => paint(canvas, moment.picture)} role="img" aria-label={moment.label} />
                <p>{moment.label}</p>
              </>
            )}
          </For>
        </div>
      )}
    </Show>
  )
}

function ModelPreview(props: { document: DocumentOf<"model">; assetId?: string; projectRevision?: number; disabled?: boolean; onAnnotate?: (prompt: string, input: ModelAnnotationInput) => Promise<unknown> | void; onDirty?: (dirty: boolean) => void; preview?: Preview | null; advanced?: boolean; animation?: string; start?: ModelCanvasMode; /** How the model's motions are named (`motionNamer`): by the ability or gameplay that plays them where they have no word of their own. */ motionName?: (clip: string, advanced?: boolean) => string; /** The part sheet's rows, when the thing has one: what each part is, in plain words. */ parts?: SheetParts }) {
  const [mode, setMode] = createSignal<ModelCanvasMode>(props.start ?? "model")
  // A bone's name is an identifier its AI wrote (round 18: `pick`, `root`, `leg_front_left` in plain view). Without 高级 a part goes by what the sheet says it is.
  const titles = createMemo(() => boneTitles(props.document.bones, props.parts, !!props.advanced))
  const [capture, setCapture] = createSignal<AnnotationCapture | null>(null)
  const [selectedPart, setSelectedPart] = createSignal("")
  const depth = (bone: DocumentOf<"model">["bones"][number], path: string[] = []): number => {
    if (!bone.parent || path.includes(bone.name)) return 0
    const parent = props.document.bones.find((candidate) => candidate.name === bone.parent)
    return parent ? depth(parent, [...path, bone.name]) + 1 : 0
  }
  return (
    <div class="asset-preview model-preview" aria-label="模型骨骼结构">
      <ModelCanvas view={{ model: props.document, preview: props.preview }} mode={mode()} onMode={setMode} animation={props.animation} rawNames={props.advanced} motionName={props.motionName} onSelectPart={setSelectedPart} selectedPart={selectedPart()} onCaptureReady={value => setCapture(() => value)} />
      <Show when={props.onAnnotate && props.assetId}><ModelAnnotation capture={capture()} sourceKey={JSON.stringify(props.document)} targetId={props.assetId!} projectRevision={props.projectRevision ?? 0} selectedPart={selectedPart()} disabled={props.disabled} onSubmit={(prompt, input) => props.onAnnotate?.(prompt, input)} onDirty={props.onDirty} /></Show>
      <Fold class="asset-model-structure" summary={props.advanced ? `骨骼结构 · ${props.document.bones.length} 个骨骼` : `它由 ${props.document.bones.length} 个部件拼成`}>
        <div class="model-tree">
          <For each={props.document.bones}>
            {(bone, index) => (
              <div class="model-tree-row" style={{ "--depth": depth(bone) }}>
                <span class="model-tree-branch" aria-hidden="true">
                  <PreviewGlyph name={bone.parent ? "branch" : "root"} />
                </span>
                <strong>{titles().get(bone.name)}</strong>
                <small>
                  {bone.cubes.length} 个方块{props.advanced ? (bone.parent ? ` · 父级 ${bone.parent}` : " · 根骨骼") : bone.parent ? ` · 接在「${titles().get(bone.parent) ?? "别的部件"}」上` : " · 别的部件都接在它上面"}
                </small>
                <span class="model-tree-index">{index() + 1}</span>
              </div>
            )}
          </For>
          <Show when={!props.document.bones.length}>
            <span class="asset-preview-empty">{NOTHING_MADE}</span>
          </Show>
        </div>
      </Fold>
    </div>
  )
}

function AnimationPreview(props: { document: DocumentOf<"animation"> }) {
  return (
    <div class="asset-preview animation-preview" aria-label="动作关键帧预览">
      <div class="animation-timeline">
        <span>0s</span>
        <span>{props.document.length}s</span>
      </div>
      <For each={props.document.channels}>
        {(channel) => (
          <div class="animation-track">
            <div>
              <strong>{channel.bone}</strong>
              <small>{channel.keyframes.length} 个关键帧</small>
            </div>
            <div class="animation-track-line">
              <For each={channel.keyframes}>
                {(keyframe) => (
                  <i
                    style={{ left: `${Math.min(100, Math.max(0, (keyframe.time / props.document.length) * 100))}%` }}
                    title={`${keyframe.time}s · ${keyframe.rotation.join(" / ")}°`}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  )
}

function RecipePreview(props: { document: DocumentOf<"recipe">; project: Project }) {
  const resource = (id: string) =>
    id.startsWith(`${props.project.mod_id}:`)
      ? [...props.project.blocks, ...props.project.items].find((item) => item.identifier === id.split(":").at(-1))
      : undefined
  return (
    <div class="asset-preview recipe-preview" aria-label="配方九宫格">
      <div class="recipe-grid">
        <For each={props.document.pattern}>
          {(cell) => (
            <span title={cell ?? undefined}>
              <Show when={cell}>
                {(id) => (
                  <>
                    <ItemIcon id={id()} color={resource(id())?.color} texture={resource(id())?.texture} />
                    <small>{resource(id())?.name ?? id().split(":").at(-1)}</small>
                  </>
                )}
              </Show>
            </span>
          )}
        </For>
      </div>
      <span class="recipe-arrow" aria-hidden="true">
        <PreviewGlyph name="arrow" />
      </span>
      <div class="recipe-output-cell">
        <ItemIcon
          id={props.document.result}
          color={resource(props.document.result)?.color}
          texture={resource(props.document.result)?.texture}
        />
        <strong>{resource(props.document.result)?.name ?? props.document.result.split(":").at(-1)}</strong>
        <small>× {props.document.count}</small>
      </div>
    </div>
  )
}

function LogicPreview(props: { document: DocumentOf<"logic"> }) {
  return (
    <div class="asset-preview logic-preview" aria-label="逻辑触发动作预览">
      <div class="logic-link">
        <span>{props.document.trigger}</span>
        <b class="logic-arrow">
          <PreviewGlyph name="arrow" />
        </b>
        <strong>{props.document.action}</strong>
      </div>
      <Show when={props.document.item}>
        <p>物品引用：{props.document.item}</p>
      </Show>
      <Show when={props.document.animation}>
        <p>动作引用：{props.document.animation}</p>
      </Show>
      <span class="logic-enabled">{props.document.enabled ? "规则已启用" : "规则已停用"}</span>
    </div>
  )
}

/** Design notes sometimes carry a JSON pool or table; show those as pictures instead of code. */
function EntryBody(props: { body: string }) {
  const parsed = () => {
    const text = props.body.trim()
    if (!/^[[{]/.test(text)) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  }
  const pool = () => asRewardPool(parsed())
  const [open, setOpen] = createSignal(false)
  const long = () => props.body.length > 220
  return (
    <Show
      when={pool()}
      fallback={
        <Show
          when={parsed() !== undefined}
          fallback={
            <>
              <p class={long() && !open() ? "document-clamp" : ""}>{props.body}</p>
              <Show when={long()}>
                <button type="button" class="document-more" onClick={() => setOpen(!open())}>
                  {open() ? "收起" : "展开全文"}
                </button>
              </Show>
            </>
          }
        >
          <Fold class="document-data" summary="结构化数据">
            <pre>{JSON.stringify(parsed(), null, 2)}</pre>
          </Fold>
        </Show>
      }
    >
      {(outcomes) => <RewardPool outcomes={outcomes()} />}
    </Show>
  )
}

function WorldviewPreview(props: { document: DocumentOf<"worldview"> }) {
  return (
    <div class="asset-preview document-preview" aria-label="世界观文档预览">
      <p class="document-lead">{props.document.summary}</p>
      <For each={props.document.entries}>
        {(entry) => (
          <section class="document-entry">
            <h4>{entry.title}</h4>
            <EntryBody body={entry.body} />
          </section>
        )}
      </For>
    </div>
  )
}

/** The words the overview card has for a saved thing (`describeAsset`), for the document on this page: saved or still a draft. */
function wordsOf(project: Project, document: ModuleDocument, assetId: string | undefined) {
  const saved = !!assetId && project.workspace.assets.some((asset) => asset.id === assetId)
  // A draft is not in the project yet: it is read as if it were, under an id nothing else has.
  const id = saved ? assetId! : "00000000-0000-4000-8000-000000000000"
  const shown: Project = saved
    ? project
    : { ...project, workspace: { ...project.workspace, assets: [...project.workspace.assets, { id, module: document.kind, title: "", revision: 1, created_at: project.updated_at, updated_at: project.updated_at, prompt: "-", dependencies: [], document, provenance: { model: null, request_id: null }, status: "ready" }] } }
  const tile = { id, asset_id: id, kind: document.kind, preview: { source: "asset" as const, model_asset_id: null, texture_asset_id: null, entity_id: null } }
  return { tile, shown, saved, words: describeAsset(shown, tile, (reference) => named(project.id, shown, [], reference).name, advanced()) }
}

/** What a thing is, row by row in a player's words; the document's own spelling of a row only under 高级. */
function PlainRows(props: { project: Project; rows: Words["rows"]; notes: string[]; advanced: boolean; identifier?: string }) {
  const display = createMemo(() => creatorWords(props.project))
  return (
    <>
      <For each={props.rows}>
        {(row) => (
          <div class="asset-plain-row">
            <span>{row.label}</span>
            <strong>
              <Show when={row.colours}>{colours => <><ParticleColours colours={colours()} />，</>}</Show>
              {display()(row.text, props.advanced)}
              <Show when={props.advanced && row.detail}>
                <small>{row.detail}</small>
              </Show>
            </strong>
          </div>
        )}
      </For>
      <Show when={props.advanced && props.identifier}>
        <div class="asset-plain-row">
          <span>标识符</span>
          <strong>{props.identifier}</strong>
        </div>
      </Show>
      <For each={props.notes}>{(note) => <p class="asset-plain-note">{display()(note, props.advanced)}</p>}</For>
    </>
  )
}

/** A block or an item: how it looks in the game, then what it is in plain rows. Laid out to what there is to say. */
function ThingPreview(props: { document: DocumentOf<"block"> | DocumentOf<"item">; project: Project; assetId?: string; advanced: boolean }) {
  const read = createMemo(() => wordsOf(props.project, props.document, props.assetId))
  const [picture, setPicture] = createSignal<string | null>(null)
  createEffect(() => {
    // A block is drawn the way an inventory shows one: three faces of a cube.
    if (props.document.kind !== "block") return
    const made = pictureOf(props.project.id, read().shown, [], read().tile)
    let live = true
    if (made) void loadPicture(made, false).then((url) => live && setPicture(url))
    onCleanup(() => (live = false))
  })
  const identifier = () => `${props.project.mod_id}:${props.document.identifier}`
  return (
    <div class="asset-preview parameter-preview thing-preview" aria-label={props.document.kind === "block" ? "方块预览" : "物品预览"}>
      <AssetAppearance document={props.document} picture={picture()} id={props.advanced ? identifier() : null} />
      <PlainRows project={read().shown} rows={read().words.rows} notes={read().words.notes.filter((note) => !note.startsWith("还没有画图案"))} advanced={props.advanced} identifier={identifier()} />
      <Show when={props.document.kind === "block" && props.document.lucky}>
        {(lucky) => (
          <section class="lucky-pool">
            <h3>右键开盒 · 每次消耗 1 个</h3>
            <p>最多堆叠 {lucky().max_stack} 个 · 不破坏周围方块</p>
            <RewardPool outcomes={lucky().outcomes} />
          </section>
        )}
      </Show>
    </div>
  )
}

/**
 * An effect: the small model it is, wearing the picture the build paints for it and playing the one motion the game
 * plays of it. Whatever other motions its document holds are never shown in the game (`effectUnplayed`), so they are
 * not offered here.
 */
function EffectPreview(props: { document: DocumentOf<"effect">; project: Project; assetId?: string; advanced: boolean; parts?: SheetParts }) {
  const design = createMemo((): DocumentOf<"model"> => {
    const model = effectModel(props.document)
    const play = props.document.play
    // Shown as its whole life over and over: the motion from its start, held or cut where its time ends, then again.
    // A motion that loops for longer than one round of itself is simply left looping.
    const life = props.document.animations.filter((animation) => animation.name === play.clip).map((animation) => (animation.loop && play.lifetime >= animation.length ? animation : { ...animation, length: play.lifetime, loop: true }))
    return { kind: "model", ...model, animations: life }
  })
  // An effect's document holds no image: its texture is painted from its cubes when it is built (`effectTexture`).
  // The page paints the same one and hands it to the canvas, drawn as the game draws it (see-through when it is).
  const preview = createMemo((): Preview | null => {
    const texture = effectTexture(props.document)
    const sheet = texture && paintedPreview({ ...effectModel(props.document), texture_size: texture.size as DocumentOf<"model">["texture_size"] }, { size: texture.size, pixels: texture.pixels })
    return sheet ? { ...sheet, look: { blend: props.document.play.opacity < 1, opacity: props.document.play.opacity } } : null
  })
  const read = createMemo(() => wordsOf(props.project, props.document, props.assetId))
  const line = () => {
    const play = props.document.play
    const full = props.document.animations.find((animation) => animation.name === play.clip)
    const shown = effectClip(props.document)
    if (!full || !shown) return "这个效果要播的动作它自己没有，游戏里它只会一动不动地出现再消失。"
    const life = Number(play.lifetime.toFixed(2))
    const length = Number(full.length.toFixed(2))
    const how = full.loop ? `一遍 ${length} 秒，循环着播` : full.length > play.lifetime + 0.025 ? `整段 ${length} 秒，没播完它就消失了` : full.length < play.lifetime - 0.025 ? `${length} 秒播完，然后停在最后的样子` : `${length} 秒，播完正好消失`
    return `它只有一个动作，不用选：一出现就从头播（${how}），一共存在 ${life} 秒就消失。上面的画面在一遍一遍重放它这 ${life} 秒。`
  }
  const unused = () => effectUnplayed(props.document)
  return (
    <div class="effect-preview">
      <ModelPreview document={design()} preview={preview()} advanced={props.advanced} animation={props.document.play.clip} start="animation" parts={props.parts} />
      <p class="effect-motion" role="note">
        {line()}
        <Show when={unused().length}> 文档里另外写的 {unused().length} 个动作游戏里不会播，这里不放。</Show>
        <Show when={props.advanced}>
          <small>
            play.clip {props.document.play.clip}
            {unused().length ? ` · 不播：${unused().join(", ")}` : ""}
          </small>
        </Show>
      </p>
      <div class="asset-preview parameter-preview thing-preview" aria-label="效果说明">
        <PlainRows project={read().shown} rows={read().words.rows.filter((row) => read().saved || row.label !== "谁在用它")} notes={read().words.notes} advanced={props.advanced} />
      </div>
    </div>
  )
}

/** Boss 能力 12: a fixture, as a model playing its lit motion (switchable to its dark one), painted as the build paints it, with what was measured on it. */
function FixturePreview(props: { document: DocumentOf<"fixture">; advanced: boolean; parts?: SheetParts }) {
  const [state, setState] = createSignal<"unlit" | "lit" | "ember">("lit")
  const clipName = () => props.document.play[state()] ?? props.document.play.unlit
  const design = createMemo((): DocumentOf<"model"> => {
    const clip = clipName()
    return { kind: "model", ...fixtureModel(props.document), animations: props.document.animations.filter((animation) => animation.name === clip) }
  })
  const preview = createMemo((): Preview | null => {
    const texture = effectTexture(props.document)
    return texture && paintedPreview({ ...fixtureModel(props.document), texture_size: texture.size as DocumentOf<"model">["texture_size"] }, { size: texture.size, pixels: texture.pixels })
  })
  return (
    <div class="effect-preview">
      <ModelPreview document={design()} preview={preview()} advanced={props.advanced} animation={clipName()} start="animation" parts={props.parts} />
      <p class="effect-motion" role="note">
        {(["unlit", "lit", "ember"] as const).map(which =>
          <button type="button" aria-pressed={state() === which} onClick={() => setState(which)}>{{unlit: "没点亮", lit: "亮着", ember: "余烬"}[which]}</button>)}
        {state() === "ember" && !props.document.play.ember && " 使用未点亮动作，游戏中有火星。"}
      </p>
      <div class="asset-preview parameter-preview thing-preview" aria-label="场地物件说明">
        <SaidLines lines={fixtureLines(props.document)} advanced={props.advanced} as="p" />
      </div>
    </div>
  )
}

/** Boss 能力 11: a particle's pictures, each enlarged pixel for pixel, and what it does over its life in plain rows. */
function ParticleStage(props:{doc:DocumentOf<"particle">;example?:SceneExample}) {
  let canvas!: HTMLCanvasElement
  const [playing,setPlaying]=createSignal(false)
  const [night,setNight]=createSignal<boolean|"dark"|"fog">(false)
  const scene=createMemo(()=>particleScene(props.doc,props.example?.emission,props.example))
  createEffect(()=>{
    const draw=scene(), dark=night(), ticks=particleTicks(props.doc)
    const start=performance.now()
    const paint=(age:number)=>{
      const frame=draw(age,dark), context=canvas.getContext("2d")!
      const image=context.createImageData(frame.width,frame.height)
      image.data.set(frame.pixels)
      context.putImageData(image,0,0)
    }
    paint(props.example ? Math.floor(ticks*0.55):0)
    if(playing()){
      const id=window.setInterval(()=>paint(Math.floor((performance.now()-start)/50)%ticks),50)
      onCleanup(()=>window.clearInterval(id))
    }
  })
  return <figure><canvas ref={canvas} width="240" height="180" aria-label="粒子标准场景" style={{"image-rendering":"pixelated"}}/>
    <figcaption><button type="button" aria-pressed={playing()} onClick={()=>setPlaying(!playing())}>{playing()?"停止播放":"循环播放"}</button>
    <button type="button" aria-pressed={night()===false} onClick={()=>setNight(false)}>白天</button>
    <button type="button" aria-pressed={night()===true} onClick={()=>setNight(true)}>夜晚</button>
    {props.example?.dark && <button type="button" aria-pressed={night()==="dark"} onClick={()=>setNight("dark")}>压暗</button>}
    {props.example?.fog && <button type="button" aria-pressed={night()==="fog"} onClick={()=>setNight("fog")}>起雾</button>} · 人高 1.8 格</figcaption></figure>
}

function ParticlePreview(props: { document: DocumentOf<"particle">; project: Project; assetId?: string; advanced: boolean }) {
  const read = createMemo(() => wordsOf(props.project, props.document, props.assetId))
  return (
    <div class="asset-preview parameter-preview thing-preview" aria-label="粒子预览">
      <p>{particleSource(props.document)} · {props.document.frames.length} 帧</p>
      <ParticleStage doc={props.document}/>
      <Fold class="particle-shape-list" summary="查看自带形状在 0.25、1、2 格时的大小">
        <For each={SHAPES}>{shape =>
          <figure class="particle-shape-scale">
            <figcaption>{SHAPE_PARAMETERS[shape]}</figcaption>
            <div><For each={[0.25, 1, 2]}>{size =>
              <span><img src={particleImage({shape,seed:1})} alt={size+" 格"} width={size*48} height={size*48}/>{size} 格</span>
            }</For></div>
          </figure>
        }</For>
      </Fold>
      <section><h4>{layeredParticles.label}</h4><ParticleStage doc={props.document} example={layeredParticles}/></section>
      <For each={particleExamples(props.project.workspace.assets,props.document,undefined,props.assetId)}>{example=><section><h4>{example.label}</h4><ParticleStage doc={props.document} example={example}/></section>}</For>
      <div class="particle-frames" role="list" aria-label="粒子的图">
        <For each={props.document.frames}>
          {(frame, index) => (
            <figure role="listitem">
              <img src={particleImage(frame,props.document.color.start,props.document.edge)} alt={`第 ${index() + 1} 张`} style={{ "image-rendering": "pixelated", width: "96px", height: "96px", background: "#2b2b2b" }} />
              <figcaption>第 {index() + 1} 张 · {typeof frame==="string"?"自绘":frame.shape}</figcaption>
            </figure>
          )}
        </For>
      </div>
      <PlainRows project={read().shown} rows={read().words.rows} notes={read().words.notes} advanced={props.advanced} identifier={props.document.name} />
    </div>
  )
}

function ParameterPreview(props: {
  document: DocumentOf<"biome"> | DocumentOf<"dimension"> | DocumentOf<"terrain">
  advanced?: boolean
}) {
  const document = props.document
  if (document.kind === "biome")
    return (
      <div class="asset-preview parameter-preview" aria-label="群系参数预览">
        <AssetAppearance document={document} />
        <Show when={props.advanced}>
          <div>
            <span>标识符</span>
            <strong>{document.identifier}</strong>
          </div>
        </Show>
        <div>
          <span>温度 / 降雨</span>
          <strong>
            {document.temperature} / {document.downfall}
          </strong>
        </div>
        <div>
          <span>环境色</span>
          <strong>
            {document.effects.sky} · {document.effects.fog} · {document.effects.water}
          </strong>
        </div>
      </div>
    )
  if (document.kind === "dimension")
    return (
      <div class="asset-preview parameter-preview" aria-label="维度参数预览">
        <AssetAppearance document={document} />
        <Show when={props.advanced}>
          <div>
            <span>标识符</span>
            <strong>{document.identifier}</strong>
          </div>
        </Show>
        <div>
          <span>天空 / 天花板</span>
          <strong>
            {document.sky} / {document.has_ceiling ? "有" : "无"}
          </strong>
        </div>
        <div>
          <span>环境光</span>
          <strong>{document.ambient_light}</strong>
        </div>
      </div>
    )
  return (
    <div class="asset-preview parameter-preview" aria-label="地形参数预览">
      <AssetAppearance document={document} />
      <div class="terrain-layers">
        <span>地层</span>
        <For each={document.layers}>
          {(layer) => (
            <strong>
              {layer.material} · {layer.depth}
            </strong>
          )}
        </For>
      </div>
      <div>
        <span>特征</span>
        <strong>{document.features.join("、") || "无"}</strong>
      </div>
    </div>
  )
}

/** `assetId`: the saved asset the document is of, when it is one. `advanced`: the 高级 switch of the page showing it. */
export function ModulePreview(props: { onOpenAsset?: (id: string) => void; creatureView?:StudioView; replaceAudio?:boolean; document?: ModuleDocument; project: Project; assetId?: string; advanced?: boolean; parts?: SheetParts; disabled?: boolean; annotationDisabled?: boolean; onSaveItem?: (item: Item) => Promise<void>; onEditItemModel?: (assetId: string) => void; onAnnotateModel?: (prompt: string, input: ModelAnnotationInput) => Promise<unknown> | void; onDirty?: (dirty: boolean) => void; /** Something saved from inside the preview (a sound file brought in): the project as it now is. */ onSaved?: (view: StudioView, assetId: string) => void }) {
  const document = props.document
  if (!document) return <div class="asset-preview asset-preview-empty">{NOTHING_MADE}</div>
  if (document.kind === "texture") return <TexturePreview document={document} />
  if (document.kind === "model") return <ModelPreview document={props.document as DocumentOf<"model">} assetId={props.assetId} projectRevision={props.project.revision} disabled={props.annotationDisabled ?? props.disabled} onAnnotate={props.onAnnotateModel} onDirty={props.onDirty} advanced={props.advanced} parts={props.parts} motionName={motionNamer(props.project, props.assetId)} />
  if (document.kind === "item" && props.assetId) {
    return <>
      <ThingPreview document={props.document as DocumentOf<"item">} project={props.project} assetId={props.assetId} advanced={!!props.advanced} />
      <Show when={props.project.items.find(value => value.id === props.assetId)}>{item => <ItemDisplay item={item()} project={props.project} disabled={props.disabled} onSave={props.onSaveItem} onDirty={props.onDirty} onEditModel={props.onEditItemModel} />}</Show>
    </>
  }
  if (document.kind === "animation") return <AnimationPreview document={document} />
  if (document.kind === "recipe") return <RecipePreview document={document} project={props.project} />
  if (document.kind === "logic") return <LogicPreview document={document} />
  if (document.kind === "worldview") return <WorldviewPreview document={document} />
  if (document.kind === "entity") return <><Show when={props.assetId && props.onSaved}><SteadySetting project={props.project} entityId={document.model_asset_id} disabled={!!props.disabled} saved={view => props.onSaved?.(view, props.assetId!)} /></Show><EntityPreview document={document} project={props.project} view={props.creatureView} /></>
  if (document.kind === "gesture")
    return (
      <div class="asset-preview gesture-preview" aria-label="动作预览">
        <CastStage document={document} facts />
      </div>
    )
  // Boss 能力 11: a particle is a few small pictures and how one lives: the pictures, then its parameters in words.
  if (document.kind === "particle") return <ParticlePreview document={document} project={props.project} assetId={props.assetId} advanced={!!props.advanced} />
  // An effect (H3) is a small model: shown as one, playing the motion it plays in the game.
  if (document.kind === "effect") return <EffectPreview document={document} project={props.project} assetId={props.assetId} advanced={!!props.advanced} parts={props.parts} />
  // 任务二 §9: a sound is heard, file by file, with what was measured of it.
  if (document.kind === "music" || document.kind === "sound") return <>
    <AudioEditor replace={props.replaceAudio} doc={document} project={props.project} assetId={props.assetId!} saved={(view,id)=>props.onSaved?.(view,id)} disabled={props.disabled} />
    <SoundUsers project={props.project} id={props.assetId!} go={props.onEditItemModel} />
    <Show when={document.kind === "sound" && document}>{sound => <>
      <SoundMetadata project={props.project} doc={sound()} assetId={props.assetId!} disabled={props.disabled} saved={(view, id) => props.onSaved?.(view, id)} />
      <PlainRows project={props.project} rows={wordsOf(props.project, sound(), props.assetId).words.rows.filter(r=>!["谁在用它","字幕","音量"].includes(r.label) && (props.advanced || !["采样率","注册名","文件"].some(s=>r.label.includes(s))))} advanced={!!props.advanced} identifier={sound().name} notes={[]} />
    </>}</Show>
  </>
  if (document.kind === "bossbar") return <BossBarPreview document={document} advanced={!!props.advanced} />
  // 书: its pages as the game draws them, turned one at a time.
  if (document.kind === "book") return <BookPreview document={document} project={props.project} />
  // Boss 能力 12: a fixture is a small model with a motion dark and one lit: shown as one, playing the lit one, its facts in words.
  if (document.kind === "fixture") return <FixturePreview document={document} advanced={!!props.advanced} parts={props.parts} />
  if (document.kind === "block" || document.kind === "item") return <ThingPreview document={document} project={props.project} assetId={props.assetId} advanced={!!props.advanced} />
  if (document.kind === "ability")
    return (
      <div class="asset-preview" aria-label="技能说明">
        <Show when={props.assetId}>{id => <AbilityUsers document={document} project={props.project} assetId={id()} go={props.onOpenAsset} />}</Show>
        <For each={abilityAssetLines(document, (kind, id) => {
          const project = props.project
          const name = kind === "gesture" ? project?.workspace.assets.find(asset => asset.id === id)?.title
            : (kind === "item" ? project?.items : project?.blocks)?.find(item => item.identifier === id || item.id === id)?.name
          return props.advanced && name ? `${name}（${id}）` : name ?? (props.advanced ? id : "没找到这样东西")
        }, true)}>
          {(line) => (
            <p>
              <Said text={line} />
            </p>
          )}
        </For>
      </div>
    )
  // Gameplay (Engineer D): AI-written code has no parameters to edit here; its description is shown, the rest is on its card.
  if (document.kind === "gameplay")
    return (
      <div class="asset-preview" aria-label="玩法说明">
        <p>
          <Said text={document.summary} />
        </p>
        <ol>
          <For each={document.behaviours}>
            {(behaviour) => (
              <li>
                <Said text={`${behaviour.when}：${behaviour.does}`} />
              </li>
            )}
          </For>
        </ol>
      </div>
    )
  return <ParameterPreview document={document} advanced={props.advanced} />
}

const LIVE = ["queued", "running", "validating", "saving"]
const REMARK = 500
const day = (time: string | null | undefined) => {
  const date = time ? new Date(time) : null
  return date && !Number.isNaN(date.getTime()) ? `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : ""
}
/**
 * How this thing came to be. With a making record: the same story its card in the overview tells (the part sheet,
 * every round with its pictures and what the AI found and changed, the review by someone who took no part).
 * Without one: one plain sentence from what is known of it. Either way the things it uses, and the things that use
 * it, by name, each a way to its own page. Never a run id, a task state or a document's raw words.
 */
function AssetStory(props: {
  project: Project
  asset: WorkspaceAsset
  runs: ProjectRun[]
  external: boolean
  aiConfigured: boolean
  onOpenAsset: (asset: WorkspaceAsset) => void
  onCancel: (runId: string) => Promise<void>
  /** Told the part sheet's rows once the making record is read, so the page can name the model's parts in plain words. */
  onParts?: (parts: SheetParts | undefined) => void
}) {
  const id = () => ({ projectId: props.project.id })
  const [found, setFound] = createStore<{ item: OverviewItem | null; making: Making | null; draft: boolean; read: boolean }>({ item: null, making: null, draft: false, read: false })
  const [saved, setSaved] = createSignal(0)
  const [busy, setBusy] = createSignal(false)
  const [ask, setAsk] = createSignal<string | null>(null)
  const [said, setSaid] = createSignal("")
  const [error, setError] = createSignal("")
  const [again, setAgain] = createSignal(0)
  // Read once for this version of the thing, then again while it is still being made.
  createEffect(
    on([() => `${props.project.id}:${props.asset.id}:${props.asset.revision}`, again], () => {
      const poll = { stopped: false, timer: 0 }
      const tick = async () => {
        const overview = await readOverview(props.project.id, props.project.revision, !!again() || found.item?.status === "making").catch(() => null)
        if (poll.stopped) return
        const item = overview?.items.find((value) => value.asset_id === props.asset.id) ?? null
        // A read that fails keeps what is on screen. So does one that does not list this thing for the moment (the plan is being changed under it): that says nothing
        // about its record, and taking the story away would close the round the person has open.
        const record = item ? await window.studio.getMaking({ ...id(), itemId: item.id }).catch(() => undefined) : found.item ? undefined : null
        if (poll.stopped) return
        batch(() => {
          if (overview && (item || !found.item)) setFound("item", item ? reconcile(item) : null)
          if (overview) setFound("draft", overview.blueprint?.state === "draft")
          if (record !== undefined) setFound("making", record ? reconcile(record, { key: "round" }) : null)
          if (record !== undefined) props.onParts?.(record?.sheet?.parts)
          setFound("read", true)
        })
        if (item?.status === "making" || makingLive(record)) poll.timer = window.setTimeout(() => void tick(), 2000)
      }
      void tick()
      onCleanup(() => {
        poll.stopped = true
        window.clearTimeout(poll.timer)
      })
    }),
  )
  const tasks = createMemo(() => props.runs.flatMap((run) => run.tasks.filter((task) => task.module === props.asset.module && task.asset_id === props.asset.id).map((task) => ({ run, task }))))
  const live = () => tasks().filter((value) => LIVE.includes(value.task.state) && ["running", "planning"].includes(value.run.state))
  const handed = () => tasks().filter((value) => value.task.state === "completed")
  const lastOf = (list: ReturnType<typeof tasks>) => list.reduce<ReturnType<typeof tasks>[number] | null>((best, value) => (!best || (value.task.finished_at ?? value.run.updated_at) > (best.task.finished_at ?? best.run.updated_at) ? value : best), null)
  // The asset overview's own rule (`handIn`): a version saved after its AI's task had finished is the person's own change.
  const byHand = () => {
    const last = lastOf(handed())
    return !!last?.task.finished_at && last.task.finished_at < props.asset.updated_at
  }
  const failed = () => {
    const last = lastOf(tasks().filter((value) => !LIVE.includes(value.task.state)))
    return last && last.task.state === "failed" ? last.task.error || "没有说原因" : ""
  }
  /** Round 18: the technical detail its AI wrote apart from the reason, which is for the person; shown under 高级 only. */
  const failedTechnical = () => {
    const last = lastOf(tasks().filter((value) => !LIVE.includes(value.task.state)))
    return last && last.task.state === "failed" ? (last.task.error_technical ?? "") : ""
  }
  /** One sentence for a thing without a making record. */
  const sentence = () => {
    const asset = props.asset
    const last = lastOf(handed())
    const when = day(last?.task.finished_at ?? asset.updated_at)
    const now = `现在存着的是第 ${asset.revision} 版${when ? `（${when} 存的）` : ""}`
    const looked = isLooked(asset.module) || asset.module==="particle" ? "这一版没有留下每一轮的图和检查记录。" : `${MODULES[asset.module].label}不是对着图一轮一轮做的，所以没有每一轮的图可看。`
    if (last || asset.provenance.model)
      return `${now}。${last?.task.outcome ? "交这一版的时候 AI 自己还不满意，先留给你看。" : ""}${looked}`
    return `这一样没有 AI 的制作记录：它是手动做的、导入的，或者是早先的版本留下来的。${now}。`
  }
  const byId = (assetId: string) => props.project.workspace.assets.find((value) => value.id === assetId)
  const uses = () => props.asset.dependencies.map(byId).filter((value): value is WorkspaceAsset => !!value)
  const usedBy = () => props.project.workspace.assets.filter((value) => value.dependencies.includes(props.asset.id))
  const links = (label: string, list: WorkspaceAsset[]) => (
    <Show when={list.length}>
      <p class="aw-links">
        <span>{label}</span>
        <For each={list}>
          {(value) => (
            <button type="button" onClick={() => props.onOpenAsset(value)}>
              {thingName(value)}
              <small>{MODULES[value.module].label}</small>
            </button>
          )}
        </For>
      </p>
    </Show>
  )
  const judgeable = (item: OverviewItem) => item.facts.saved && item.asset_id !== null && item.revision !== null && item.status !== "making"
  const ownAi = () => !props.external && props.aiConfigured
  // A batch of the plan being made is what keeps rework waiting (see `redoPromise`): the same rule the overview's `production.live` uses.
  const batchLive = () => props.runs.some((run) => ["planning", "running"].includes(run.state) && run.tasks.some((task) => blueprintSourceKey(task.source) !== null))
  const promise = (item: OverviewItem) => redoPromise({ external: props.external, aiConfigured: props.aiConfigured, running: batchLive() }, judgeable(item) ? "按你说的重做这一样" : "把这一样再做一次")
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    try {
      await work()
    } catch (cause) {
      setError(safeError(cause))
    } finally {
      setBusy(false)
    }
  }
  // The same two steps the overview takes: the version is recorded as "to change", then Studio's own AI starts on it.
  // False when the person went to add a three-view first (its block is on this page): then nothing was sent.
  const sendBack = async (item: OverviewItem, note: string) => {
    if (!(await threeViewsReady(props.project.id, [item]))) return false
    const recorded = judgeable(item)
    if (recorded) await window.studio.reviewAsset({ ...id(), assetId: item.asset_id!, revision: item.revision ?? undefined, verdict: "rejected", note })
    if (ownAi() || !recorded) await window.studio.redoAsset({ ...id(), itemId: item.id, feedback: note })
    setAsk(null)
    setSaid(recorded ? `「${thingName(props.asset)}」记下要改了。` : `「${thingName(props.asset)}」会再试一次。`)
    setAgain(again() + 1)
    return true
  }
  const saveSheet = (item: OverviewItem, sheet: PartSheet, redo: string | null) =>
    act(async () => {
      setFound("making", reconcile(await window.studio.saveSheet({ ...id(), itemId: item.id, sheet }), { key: "round" }))
      setSaved(saved() + 1)
      if (redo && (await sendBack(item, redo.slice(0, REMARK)))) return
      setSaid("部件说明保存好了。")
    })
  const cancel = (runId: string) => act(() => props.onCancel(runId))
  // The overview card's 「现在就再试一次」: the same words again, handed to Studio's own AI.
  const retry = (item: OverviewItem) =>
    act(async () => {
      if (!(await threeViewsReady(props.project.id, [item]))) return
      await window.studio.redoAsset({ ...id(), itemId: item.id, feedback: retryWords(item, REMARK) })
      setSaid(`「${thingName(props.asset)}」会再试一次。`)
      setAgain(again() + 1)
    })
  const [copied, setCopied] = createSignal(false)
  const handOver = (item: OverviewItem) =>
    act(async () => {
      await window.studio.copyText({ text: redoSentence(props.project.name, item) })
      setCopied(true)
    })

  return (
    <section class="aw-story mc-window" aria-label="制作过程">
      <header>
        <h2>它是怎么做出来的</h2>
        <Show when={live().length}>
          <span class="aw-story-live" role="status">
            AI 正在做它
            <button type="button" disabled={busy()} onClick={() => void cancel(live()[0]!.run.id)}>
              停下
            </button>
          </span>
        </Show>
      </header>
      <Show when={found.read} fallback={<p class="aw-story-line">正在读它的制作过程…</p>}>
        {/* A model with no making record has no story to hold its 六视图, and the request beside it may ask for one. */}
        <Show when={!found.making && found.item && wantsThreeView(found.item.kind) ? found.item : null}>
          {(item) => <ThreeViewBlock projectId={props.project.id} itemId={item().id} locked={makingLock(item(), LOCK_THEN.sixView)} />}
        </Show>
        <Show when={found.making && found.item} fallback={<p class="aw-story-line">{sentence()}</p>}>
          <div class="aw-story-body">
            <MakingStory
              projectId={props.project.id}
              kind={found.item!.kind}
              play={<MotionPlay projectId={props.project.id} project={props.project} item={found.item} />}
              making={found.making!}
              locked={makingLock(found.item!, LOCK_THEN.notes) || (found.draft ? "蓝图还开着。先到「工程总览」确认蓝图，再来改这份说明。" : "")}
              busy={busy()}
              promise={promise(found.item!)}
              saved={saved()}
              onSave={(sheet, redo) => void saveSheet(found.item!, sheet, redo)}
              onRedo={(remark) => setAsk(remark)}
            />
          </div>
        </Show>
      </Show>
      <Show when={found.read && byHand()}>
        <p class="aw-story-line" role="note">
          AI 交上来以后，你自己又改过它：现在存着的第 {props.asset.revision} 版是你改的{day(props.asset.updated_at) ? `（${day(props.asset.updated_at)}）` : ""}，没有经过检查。
        </p>
      </Show>
      <Show when={ask() !== null && found.item}>
        <div class="aw-story-ask" role="alertdialog" aria-label="确认重做">
          <p>
            按这份说明重做「{found.item!.title}」？{promise(found.item!)}
            {found.item!.facts.saved ? "现在这一版会记成「要改」。" : ""}
          </p>
          <button type="button" class="primary" disabled={busy()} onClick={() => void act(() => sendBack(found.item!, (ask() ?? "").slice(0, REMARK)))}>
            重做
          </button>
          <button type="button" disabled={busy()} onClick={() => setAsk(null)}>
            先不
          </button>
        </div>
      </Show>
      <Show when={failed()}>
        <p class="aw-story-line warn aw-story-failed">
          <span>
            最近一次没做成：<SaidLines as="span" lines={[failed()]} advanced={advanced()} />
            <Show when={advanced() && failedTechnical()}>
              <small class="said-technical"> {failedTechnical()}</small>
            </Show>
          </span>
          <Show when={found.item}>
            {(item) => (
              <Show when={!live().length && item().status !== "making"}>
                <Show when={ownAi()}>
                  <button type="button" class="primary" disabled={busy()} onClick={() => void retry(item())}>
                    再试一次
                  </button>
                </Show>
                <Show when={props.external}>
                  <button type="button" disabled={busy()} onClick={() => void handOver(item())}>
                    {copied() ? "已复制，再复制一次" : "复制这句话给我的 AI"}
                  </button>
                </Show>
                <Show when={!props.external && !props.aiConfigured}>
                  <em>AI 还没连接，连上以后就能再试。</em>
                </Show>
              </Show>
            )}
          </Show>
        </p>
      </Show>
      <Show when={said()}>
        <p class="aw-story-line" role="status">
          {said()}
        </p>
      </Show>
      <Show when={error()}>
        <p class="asset-error" role="alert">
          {error()}
        </p>
      </Show>
      {links("它用到了", uses())}
      {props.asset.module !== "ability" && links("谁在用它", usedBy())}
    </section>
  )
}

/** The page's two views of a saved thing that can be changed by hand. */
const TABS = { look: "看看", edit: "自己改" } as const

export function AssetWorkspace(props: {
  creatureView?:StudioView
  project: Project
  module: ModuleKind
  asset: WorkspaceAsset | null
  runs: ProjectRun[]
  disabled: boolean
  /** Hand edits are guarded by the save service; an open game must not lock their form. */
  handDisabled?: boolean
  behaviorNotes?: JSX.Element
  aiConfigured: boolean
  external?: boolean
  onRun: (prompt: string) => Promise<void>
  onCloseNew: () => void
  onOpenAsset: (asset: WorkspaceAsset) => void
  onReplaceModel?: (id:string)=>void
  onRemoved?: (view:StudioView)=>void
  onEditModel?: (entityId: string) => void
  onSaveItem?: (item: Item) => Promise<void>
  onAnnotateModel?: (prompt: string, input: ModelAnnotationInput) => Promise<unknown> | void
  onCancel: (runId: string) => Promise<void>
  onDirty: (dirty: boolean) => void
  /** A hand edit was saved: the project as it now is, and the thing's id (a new one's too). Without it the page still shows what was saved. */
  onSaved?: (view: StudioView, assetId: string) => void
  /** A finding's button asked for this field of the form: the page opens on 「自己改」 and focuses it. `nonce` changes on every press. */
  focusField?: { field: string; nonce: number } | null
}) {
  const [prompt, setPrompt] = createSignal("")
  const [previewDirty, setPreviewDirty] = createSignal(false)
  const [committed, setCommitted] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [error, setError] = createSignal("")
  const [parts, setParts] = createSignal<SheetParts>()
  const meta = createMemo(() => MODULES[props.module])
  // What a hand edit saved from this page. The page shows it at once, whether or not whoever shows the page has read the project again.
  const [made, setMade] = createSignal<{ view: StudioView; assetId: string } | null>(null)
  const project = createMemo(() => (made() && made()!.view.project.id === props.project.id && made()!.view.project.revision > props.project.revision ? made()!.view.project : props.project))
  const asset = createMemo(() => {
    const id = props.asset?.id ?? made()?.assetId
    return id ? (project().workspace.assets.find((value) => value.id === id) ?? props.asset) : null
  })
  const useLabel = () => {
    const current = asset()
    const view = cachedOverview(overviewKey(project().id, project().revision))
    if (!current || !view) return "正在读…"
    return assetChip(current, (id) => usersOf(view, id), project().target) || "会做进模组"
  }
  const hand = createMemo(() => (isHandKind(props.module) ? props.module : null))
  const [tab, setTab] = createSignal<keyof typeof TABS>("look")
  // The form is made the first time it is asked for and then stays, so what was typed survives a look at the other tab.
  const [opened, setOpened] = createSignal(false)
  const [blank, setBlank] = createSignal<Loose | null>(null)
  const [name, setName] = createSignal("")
  const [edited, setEdited] = createSignal(false)
  const editing = () => !!hand() && !!asset() && tab() === "edit"
  const choosePicture = () => {
    setTab("edit")
    setOpened(true)
    requestAnimationFrame(()=>document.querySelector<HTMLInputElement>(".asset-workspace .ae-picture-side input[type=file]")?.click())
  }
  // Brought here by a finding to fill one field: the form is the first thing shown, not the picture of the thing.
  createEffect(
    on(
      () => props.focusField,
      (request) => {
        if (!request || !hand() || !asset()) return
        if (request.field==="replace_file" && ["block","item"].includes(props.module))return choosePicture()
        setTab("edit")
        setOpened(true)
      },
    ),
  )
  // One answer for whoever guards leaving the page: words not yet sent to the AI, or a form not yet saved.
  createEffect(() => props.onDirty([edited(), previewDirty(), !!prompt().trim() && prompt().trim() !== committed()].some(Boolean)))
  const selectedId = createMemo(() => props.asset?.id ?? "")
  const previewKey = createMemo(() => {
    const current = asset()
    if (!current?.document) return undefined
    return `${current.id}:${current.module}:${current.module === "item" || current.module === "model" ? "live" : current.revision}`
  })
  const modelEditable = createMemo(
    () =>
      props.module === "model" &&
      !!props.asset &&
      props.project.entities.some((entity) => entity.id === props.asset!.id && !!entity.model_asset_id),
  )
  createEffect(() => {
    selectedId()
    setParts(undefined)
    setPreviewDirty(false)
  })
  onCleanup(() => props.onDirty(false))
  // A saved model sent to the AI from here is made by the same loop as on the overview, going by its three-view if it has one.
  const modelReady = async () => {
    const current = asset()
    if (props.module !== "model" || !current) return true
    const overview = await window.studio.getProjectOverview({ projectId: props.project.id }).catch(() => null)
    const item = overview?.items.find((value) => value.asset_id === current.id)
    return item ? threeViewsReady(props.project.id, [item]) : true
  }
  const submit = async (event: SubmitEvent) => {
    event.preventDefault()
    if (props.disabled || !props.aiConfigured || !prompt().trim() || running()) return
    const value = prompt().trim()
    setRunning(true)
    setError("")
    try {
      if (!(await modelReady())) return
      await props.onRun(value)
      setCommitted(value)
    } catch (cause) {
      setError(safeError(cause))
    } finally {
      setRunning(false)
    }
  }
  const startBlank = (event: SubmitEvent) => {
    event.preventDefault()
    const kind = hand()
    if (!kind || !name().trim()) return
    setBlank(blankDocument(kind, name().trim(), [...project().blocks, ...project().items].map((value) => value.identifier)))
  }
  const saved = (view: StudioView, assetId: string) => {
    setMade({ view, assetId })
    // A new thing is now a saved one: the same form goes on as its 「自己改」.
    if (blank()) {
      setBlank(null)
      setOpened(true)
      setTab("edit")
    }
    props.onSaved?.(view, assetId)
  }
  const request = () => (
    <>
      <form onSubmit={submit}>
        <label for="asset-request-input">制作要求</label>
        <textarea id="asset-request-input" aria-label={`${kindLabel(meta().id, meta().label)}制作要求`} value={prompt()} disabled={props.disabled || running()} onInput={(event) => setPrompt(event.currentTarget.value)} placeholder={objectives[props.module]} rows="7" maxlength="16000" />
        <div class="asset-request-footer">
          <VoiceInput disabled={props.disabled || running()} onText={(text) => setPrompt(`${prompt().trim()}${prompt().trim() ? "\n" : ""}${text}`)} />
          <span role="status">{running() ? "正在交给 AI…" : "你写的话会记下来。"}</span>
          <Button primary type="submit" disabled={props.disabled || running() || !props.aiConfigured || !prompt().trim()}>
            {running() ? "正在交给 AI…" : asset() ? "让 AI 改" : "让 AI 做"}
          </Button>
        </div>
      </form>
      <Show when={error()}>
        <p class="asset-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={committed()}>
        <div class="asset-committed">
          <span>已提交</span>
          <p>{committed()}</p>
        </div>
      </Show>
    </>
  )

  const canStartBlank = () => !!hand() && BLANK_KINDS.includes(hand()!)
  const label = () => kindLabel(meta().id, meta().label)
  const newDialog = () => (
    <CardShell title={`新建${label()}`} manageFocus onClose={props.onCloseNew}>
      <div class="new-asset-form">
        <Show when={canStartBlank()}>
          <form class="new-asset-section" onSubmit={startBlank}>
            <label class="field">
              {`${label()}的名字`}
              <input maxlength="120" value={name()} disabled={props.disabled} onInput={(event) => setName(event.currentTarget.value)} />
            </label>
            <div class="page-actions">
              <Button primary type="submit" disabled={props.disabled || !name().trim()}>从空白开始</Button>
            </div>
          </form>
        </Show>
        <Show when={!props.external}>
          <section class="new-asset-section asset-request" aria-label="让 AI 做">
            <Show when={!props.aiConfigured}><p>先连接 AI，就可以在这里交制作要求。</p></Show>
            {request()}
          </section>
        </Show>
      </div>
    </CardShell>
  )

  return (
    <Show when={asset() || blank()} fallback={newDialog()}>
    <section class="asset-workspace" classList={{ "asset-workspace-external": !!props.external }} aria-label={`${kindLabel(meta().id, meta().label)}工作区`}>
      <header class="asset-workspace-header">
        <div>
          <span class="asset-workspace-kicker">{kindLabel(meta().id, meta().label)}</span>
          <h1>{thingName(asset()) ?? `${kindLabel(meta().id, meta().label)}工作区`}</h1>
          <Show when={asset()}>{a => <Show when={gameName(a()) && gameName(a()) !== thingName(a())}>
            <p>工程里叫：{a().title} / 游戏里显示：{gameName(a())}</p>
          </Show>}</Show>
          <p>
            {objectives[props.module]}
            <Show when={!meta().design_note}> 做进模组以后，可以进游戏看效果。</Show>
          </p>
          {/* A kind no build compiles says so where its thing is opened, so nobody waits for it in the game. */}
          <Show when={meta().design_note}>{(note) => <p class="asset-design-note">{note()}。</p>}</Show>
        </div>
        <div class="asset-header-actions">
          <Show when={asset()?.module!=="entity" && asset()}>{value=><ThingMenu project={project()} id={value().id} kind={value().module} title={thingName(value())} busy={props.handDisabled || cachedOverview(overviewKey(project().id,project().revision))?.items.some(i=>i.asset_id===value().id && i.status==="making")}
            saved={(v,id)=>{if(id)saved(v,id);else props.onRemoved?.(v)}} go={id=>{const found=project().workspace.assets.find(a=>a.id===id);if(found)props.onOpenAsset(found)}}
            replace={["sound","music"].includes(value().module)?()=>window.dispatchEvent(new Event("studio-replace-audio")):value().document.kind==="entity"?()=>{const d=value().document;if(d.kind==="entity")props.onReplaceModel?.(d.model_asset_id)}:["block","item"].includes(value().module)?choosePicture:undefined} />}</Show>
          <Show when={asset()}>
            <span class="asset-document-source">
              第 {asset()!.revision} 次保存 · {useLabel()}
            </span>
          </Show>
          <Show when={modelEditable() && props.onEditModel}>
            <button class="asset-open-source" type="button" onClick={() => props.onEditModel?.(props.asset!.id)}>
              进入模型编辑器
            </button>
          </Show>
        </div>
      </header>
      <div class="asset-workspace-layout">
        <Show when={blank()}>
          <div class="asset-document">
            <ContentEditor project={project()} kind={hand()!} asset={null} start={blank()!} disabled={props.handDisabled ?? props.disabled} advanced={advanced()} onDirty={setEdited} onSaved={saved} onGiveUp={() => setBlank(null)} />
          </div>
        </Show>
        <Show when={asset()}>
          <div class="asset-workspace-main" classList={{ "aw-editing": editing() }}>
            <div class="asset-document">
              <Show when={hand() && asset()}>
                <div class="aw-tabs" role="tablist" aria-label="看它，或者自己改它">
                  <For each={Object.entries(TABS) as [keyof typeof TABS, string][]}>
                    {([id, label]) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={tab() === id}
                        onClick={() => {
                          setTab(id)
                          if (id === "edit") setOpened(true)
                        }}
                      >
                        {label}
                        <Show when={id === "edit" && edited()}>
                          <small>改过了，还没保存</small>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
              <div style={{ display: editing() ? "none" : undefined }}>
                {props.behaviorNotes}
                <Show when={previewKey()} keyed>
                  {(_key) => <ModulePreview onOpenAsset={id => { const target = project().workspace.assets.find(a => a.id === id); if (target) props.onOpenAsset(target) }} creatureView={props.creatureView} replaceAudio={props.focusField?.field==="replace_file"} document={asset()?.document} project={project()} assetId={asset()?.id} advanced={advanced()} parts={parts()} disabled={props.handDisabled ?? props.disabled} annotationDisabled={props.disabled} onSaveItem={props.onSaveItem} onAnnotateModel={props.onAnnotateModel} onDirty={setPreviewDirty} onSaved={saved} onEditItemModel={(id) => { const target = project().workspace.assets.find((value) => value.id === id); if (target) props.onOpenAsset(target) }} />}
                </Show>
                <Show when={!asset()?.document}>
                  <div class="asset-preview asset-preview-empty">{NOTHING_MADE}</div>
                </Show>
                <Show when={advanced() && asset()}>
                  <Fold class="asset-json" summary="原始文档">
                    <pre>{JSON.stringify(asset()?.document ?? {}, null, 2)}</pre>
                  </Fold>
                </Show>
              </div>
              {/* Kept once opened, shown only on its tab. A new thing's form (above) goes on as this one after its first save. */}
              <Show when={hand() && asset() && opened()}>
                <div style={{ display: editing() ? undefined : "none" }}>
                  <ContentEditor project={project()} kind={hand()!} asset={asset()} start={asset()!.document as Loose} disabled={props.handDisabled ?? props.disabled} advanced={advanced()} focus={props.focusField} onDirty={setEdited} onSaved={saved} />
                  <Show when={props.module === "entity" && !handWired(window.studio as unknown as HandApi)}>
                    <p class="aw-hand-note">这个版本里，生物在这里只能改最基本的几项；掉落、出现的地方和声音还要让 AI 改。</p>
                  </Show>
                </div>
              </Show>
            </div>
            <Show when={!props.external && !editing()}>
              <aside class="asset-workspace-tools">
                <section class="asset-request">
                  <div class="asset-request-heading">
                    <span>制作</span>
                    <Show when={!props.aiConfigured}>
                      <em>AI 还没连接</em>
                    </Show>
                  </div>
                  {request()}
                </section>
              </aside>
            </Show>
          </div>
        </Show>
        <Show when={asset()}>
          {(value) => <AssetStory project={project()} asset={value()} runs={props.runs} external={!!props.external} aiConfigured={props.aiConfigured} onOpenAsset={props.onOpenAsset} onCancel={props.onCancel} onParts={setParts} />}
        </Show>
      </div>
    </section>
    </Show>
  )
}

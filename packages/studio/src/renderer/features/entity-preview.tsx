import { thingName } from "../words"
import type { StudioView } from "../../api"
import { Fold } from "../fold"
import { FixtureMap } from "./fixture-map"
import { fixtureConditions } from "@minemods/mod-core/fixture-conditions"
import { For, Show, createMemo, createResource, createSignal } from "solid-js"
import type { Project } from "@minemods/mod-core/project"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { advanced } from "../advanced"
import { solidPartLegend, solidPartOutlines } from "./solid-part-preview"
import { creatureFacets } from "@minemods/mod-core/creature-life"
import { biomeName } from "@minemods/mod-core/data-words"
import { Said } from "./play-text"
import { motionNamer } from "./asset-words"
import {EmitterPictures} from "./emitter-pictures"
import { ModelCanvas, type ModelCanvasMode } from "./model-canvas"
import "./entity-preview.css"

type EntityDocument = Extract<ModuleDocument, { kind: "entity" }>
const movements = {
  direct: "直接接近",
  stalk: "缓慢接近",
  burst: "间歇冲刺",
  strafe: "侧向接近",
  leap: "短距跃进",
  retreat: "受击后撤",
}
const effects = { slowness: "缓慢", blindness: "失明", poison: "中毒", weakness: "虚弱" }

const previews = new WeakMap<Project, Map<string, ReturnType<typeof window.studio.getEntityPreview>>>()

export function EntityPreview(props: { document: EntityDocument; project: Project; view?:StudioView }) {
  const [mode, setMode] = createSignal<ModelCanvasMode>("model")
  const origins = createMemo(() => creatureFacets(props.document, props.project, true).filter((facet) => facet.question === "source"))
  const source = createMemo(() =>
    props.project.workspace.assets.find((asset) => asset.id === props.document.model_asset_id),
  )
  const held=()=>props.view?.entity_id===props.document.model_asset_id && props.view?.preview && props.view?.model ? props.view : undefined
  const [loaded] = createResource(
    () => !held() && ({ projectId: props.project.id, entityId: props.document.model_asset_id, revision: props.project.revision }),
    async (input) => {
      const cached = previews.get(props.project) ?? new Map<string, ReturnType<typeof window.studio.getEntityPreview>>()
      previews.set(props.project, cached)
      const key = input.entityId + "/" + input.revision
      let pending = cached.get(key)
      if (!pending) {
        pending = window.studio.getEntityPreview({projectId:input.projectId, entityId:input.entityId})
        cached.set(key,pending)
      }
      return pending.catch(()=>{cached.delete(key);return null})
    },
  )
  const texture = createMemo(() =>
    props.project.workspace.assets.find((asset) => asset.id === props.document.runtime.texture_asset_id),
  )
  const preview = createMemo(() => {
    const current = held()?.preview ?? loaded()?.preview
    const document = texture()?.document
    if (!current || document?.kind !== "texture") return current
    const canvas = window.document.createElement("canvas")
    canvas.width = document.width
    canvas.height = document.height
    const context = canvas.getContext("2d")
    if (!context) return null
    const pixels = context.createImageData(document.width, document.height)
    document.pixels.forEach((index, offset) => {
      const color = document.palette[index]!
      pixels.data.set(
        [
          Number.parseInt(color.slice(1, 3), 16),
          Number.parseInt(color.slice(3, 5), 16),
          Number.parseInt(color.slice(5, 7), 16),
          255,
        ],
        offset * 4,
      )
    })
    context.putImageData(pixels, 0, 0)
    return { ...current, textureDataUrl: canvas.toDataURL("image/png") }
  })
  const model = () =>
    held()?.model ?? loaded()?.model ??
    (source()?.document.kind === "model" ? (source()!.document as Extract<ModuleDocument, { kind: "model" }>) : null)
  const outlines = createMemo(() => mode() === "model" ? solidPartOutlines(props.document.hitbox, model()) : [])
  return (
    <div class="entity-preview" aria-label="生物行为预览">
      <Show when={props.document.boss?.arena}>{arena => <FixtureMap arena={arena()} rules={fixtureConditions(props.document)} title={id => thingName(props.project.workspace.assets.find(a => a.id === id))} advanced={advanced()} />}</Show>
      <div class="entity-appearance">
        <ModelCanvas view={{ model: model(), preview: preview() }} mode={mode()} onMode={setMode} rawNames={advanced()} motionName={motionNamer(props.project, props.document.model_asset_id)} outlineBoxes={outlines()} />
        <p class="entity-preview-note">
          {!held() && loaded.loading
            ? "正在读取已保存模型…"
            : !held() && !loaded()
              ? "外观草稿 · 已保存模型预览暂不可用"
              : "外观预览 · 游戏行为要打包后进游戏检查"}
        </p>
        <Show when={outlines().length}>
          <p class="entity-preview-note">{solidPartLegend(outlines())}</p>
        </Show>
        <Show when={!!props.document.emitters?.length && model()}>{design=><EmitterPictures owner={props.document} project={props.project} design={design()} preview={preview()??null}/>}</Show>
        <div class="entity-bindings">
          <span>
            模型 <strong>{source()?.title ?? "等待模型"}</strong>
          </span>
          <span>
            材质 <strong>{texture()?.title ?? "模型内置贴图"}</strong>
          </span>
        </div>
      </div>
      <aside class="entity-inspector" aria-label="生物行为">
        <Show when={props.document.boss?.music}>{(music) => (
          <section aria-label="战斗音乐时间轴">
            <h3>战斗音乐时间轴</h3>
            <dl>
              <Show when={props.document.boss?.intro}>
                <div><dt>0 秒 · 登场</dt><dd>{music().starts === "wake" ? "音乐开始" : "等待开打"}</dd></div>
              </Show>
              <div><dt>{props.document.boss?.intro?.seconds ?? 0} 秒 · 开打</dt>
                <dd>{music().starts === "wake" && props.document.boss?.intro ? "音乐接着放" : "音乐开始"}</dd></div>
              <div><dt>脱战</dt><dd>{music().fade_seconds} 秒淡出</dd></div>
            </dl>
          </section>
        )}</Show>
        <Show when={props.document.runtime.death_drop}>
          {(drop) => <section aria-label="盲盒掉落规则">
            <h3>击败掉落</h3>
            <p>{props.project.blocks.find(block => block.identifier === drop().block_identifier)?.name ?? (advanced() ? drop().block_identifier : "缺少的方块")} × 1 · {Math.round(drop().chance * 100)}%</p>
            <p>仅玩家击杀 · 爆炸与环境死亡不掉落</p>
          </section>}
        </Show>
        <section>
          <h3>基础属性</h3>
          <dl>
            <div>
              <dt>生命</dt>
              <dd>{props.document.health}</dd>
            </div>
            <div>
              <dt>移动速度</dt>
              <dd>{props.document.speed}</dd>
            </div>
            <div>
              <dt>攻击伤害</dt>
              <dd>{props.document.attack_damage}</dd>
            </div>
            <div>
              <dt>行为</dt>
              <dd>{movements[props.document.runtime.movement]}</dd>
            </div>
            <div>
              <dt>护甲 / 蓄力护甲</dt>
              <dd>
                {props.document.runtime.armor} / {props.document.runtime.charging_armor}
              </dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>怎么出现</h3>
          <Show when={!props.document.runtime.spawn}><p>自己出现 · 不会在普通群系里自然生成</p></Show>
          <For each={origins()}>{(facet) => <p><Said text={facet.words} /></p>}</For>
          <Show when={props.document.boss?.lair}>{lair=><Fold summary="看它的巢">
            <div class="lair-map" style={{"clip-path":"circle(50%)","background-size":`${100/(2*lair().radius+1)}% ${100/(2*lair().radius+1)}%`}} aria-label={`圆形平台半径 ${lair().radius} 格`}><span>中心</span></div>
            <p>平台半径 {lair().radius} 格，上方清空 {lair().clearance} 格。</p>
          </Fold>}</Show>
          <p>刷怪蛋 · 有</p>
          <Show when={props.document.runtime.spawn}>
            {(spawn) => (
              <>
                <div class="entity-biomes">
                  <For each={spawn().biomes}>
                    {(id) => (
                      <span title={advanced() ? id : undefined}>{biomeName(id)}</span>
                    )}
                  </For>
                </div>
                <p>
                  生成权重 {spawn().weight} · 每组 {spawn().min}–{spawn().max} 只
                </p>
              </>
            )}
          </Show>
        </section>
        <section>
          <h3>爆炸</h3>
          <Show when={props.document.runtime.explosion} fallback={<p>未启用爆炸</p>}>
            {(explosion) => (
              <>
                <dl>
                  <div>
                    <dt>引信</dt>
                    <dd>{explosion().fuse_ticks / 20} 秒</dd>
                  </div>
                  <div>
                    <dt>范围</dt>
                    <dd>{explosion().radius}</dd>
                  </div>
                  <div>
                    <dt>方块</dt>
                    <dd>{explosion().damage_blocks ? "允许爆炸破坏" : "保留方块"}</dd>
                  </div>
                </dl>
                <Show when={explosion().effects.length}>
                  <h3 class="entity-effects-title">状态</h3>
                  <For each={explosion().effects}>
                    {(effect) => (
                      <div class="entity-effect">
                        <strong>
                          {effects[effect.effect]} {effect.amplifier + 1}
                        </strong>
                        <span>{effect.duration_ticks / 20} 秒</span>
                      </div>
                    )}
                  </For>
                </Show>
              </>
            )}
          </Show>
        </section>
      </aside>
    </div>
  )
}

import { For, Show } from "solid-js"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { FOOD_EFFECTS, MINING_LEVELS, TOOL_KINDS } from "@minemods/mod-core/content-words"
import { blockPaint } from "@minemods/studio-ai/block-shape"
import "./asset-appearance.css"

type AppearanceDocument = Extract<ModuleDocument, { kind: "block" | "item" | "biome" | "dimension" | "terrain" }>

const skyLabels = {
  overworld: "主世界天空",
  nether: "下界天空",
  end: "末地天空",
  custom: "自定义天空",
} as const

function StateGlyph(props: { kind: "sky" | "ceiling" }) {
  return props.kind === "sky" ? (
    <svg
      class="asset-appearance-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2m-17.07-7.07 1.42 1.42m11.3 11.3 1.42 1.42m0-14.14-1.42 1.42m-11.3 11.3-1.42 1.42" />
    </svg>
  ) : (
    <svg
      class="asset-appearance-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19h16M5 16h14M7 5h10l2 11H5L7 5Z" />
      <path d="M9 9h6M9 12h6" />
    </svg>
  )
}

/** A tooltip line of an item, the way the game adds lines under a name: short, and only what its document states. */
function itemLines(document: Extract<AppearanceDocument, { kind: "item" }>) {
  const tool = document.tool
  return [
    ...(tool
      ? [
          `一把${TOOL_KINDS[tool.kind].name}`,
          `能用 ${tool.durability} 次`,
          `拿着打一下 ${tool.attack_damage} 点伤害`,
          ...(TOOL_KINDS[tool.kind].mines ? [MINING_LEVELS[tool.mining_level].reach] : []),
        ]
      : []),
    ...(document.food ? [`${document.food.drink ? "能喝" : "能吃"}，补 ${document.food.hunger} 点饥饿`, ...(document.food.effects ?? []).map((effect) => `${FOOD_EFFECTS[effect.effect].name}${"instant" in FOOD_EFFECTS[effect.effect] ? "" : `（${effect.seconds} 秒）`}`)] : []),
    ...(document.fuel ? [`能当燃料，一个烧 ${Number((document.fuel.burn_ticks / 20).toFixed(1))} 秒`] : []),
  ]
}

/**
 * A block or an item as the game shows it: in an inventory slot at the size it has in the bag, enlarged on a light
 * and on a dark slot with every pixel crisp, and with the tooltip the game puts beside it. Nothing is painted behind
 * the picture: what shows through its empty pixels is the slot, as in the game.
 */
function InGame(props: { name: string; picture: string | null; plain: string | null; stack: number; lines: string[]; id: string | null; note: string | null }) {
  const icon = () =>
    props.picture ? <img src={props.picture} alt="" draggable={false} /> : props.plain ? <i class="asset-ingame-plain" style={{ "background-color": props.plain }} /> : null
  return (
    <div class="asset-ingame">
      <figure class="asset-ingame-bag">
        <div class="asset-ingame-strip" role="img" aria-label={`${props.name}在背包格子里的样子`}>
          <span class="mc-slot" />
          <span class="mc-slot">
            {icon()}
            <Show when={props.stack > 1}>
              <b>{props.stack}</b>
            </Show>
          </span>
          <span class="mc-slot" />
        </div>
        <figcaption>背包里就是这么大{props.stack > 1 ? `，一格最多叠 ${props.stack} 个` : ""}</figcaption>
      </figure>
      <figure class="asset-ingame-large">
        <div>
          <span class="asset-ingame-slot" data-tone="light">
            {icon()}
          </span>
          <span class="asset-ingame-slot" data-tone="dark">
            {icon()}
          </span>
        </div>
        <figcaption>放大看：浅色格、深色格里各一个{props.note ? `。${props.note}` : ""}</figcaption>
      </figure>
      <figure class="asset-ingame-hover">
        <div class="asset-ingame-tip mc-tooltip">
          <strong>{props.name}</strong>
          <For each={props.lines}>{(line) => <span>{line}</span>}</For>
          <Show when={props.id}>
            <small>{props.id}</small>
          </Show>
        </div>
        <figcaption>鼠标指着它时出现的说明</figcaption>
      </figure>
    </div>
  )
}

function BiomeAppearance(props: { document: Extract<AppearanceDocument, { kind: "biome" }> }) {
  const swatches = [
    { label: "天空", color: props.document.effects.sky },
    { label: "雾色", color: props.document.effects.fog },
    { label: "水色", color: props.document.effects.water },
  ]
  return (
    <div class="asset-appearance-inner asset-appearance-biome">
      <div class="asset-appearance-heading">
        <strong>{props.document.name}</strong>
        <span>{props.document.identifier}</span>
      </div>
      <div class="asset-appearance-swatches" aria-label="群系环境色">
        <For each={swatches}>
          {(swatch) => (
            <div class="asset-appearance-swatch">
              <span style={{ "background-color": swatch.color }} />
              <label>{swatch.label}</label>
              <output>{swatch.color}</output>
            </div>
          )}
        </For>
      </div>
      <dl class="asset-appearance-values">
        <div>
          <dt>温度</dt>
          <dd>{props.document.temperature}</dd>
        </div>
        <div>
          <dt>降水</dt>
          <dd>{props.document.downfall}</dd>
        </div>
      </dl>
    </div>
  )
}

function DimensionAppearance(props: { document: Extract<AppearanceDocument, { kind: "dimension" }> }) {
  return (
    <div class="asset-appearance-inner asset-appearance-dimension">
      <div class="asset-appearance-heading">
        <strong>{props.document.identifier}</strong>
        <span>{skyLabels[props.document.sky]}</span>
      </div>
      <div class="asset-appearance-state-row">
        <div class="asset-appearance-state">
          <StateGlyph kind="sky" />
          <span>天空</span>
          <strong>{skyLabels[props.document.sky]}</strong>
        </div>
        <div class="asset-appearance-state">
          <StateGlyph kind="ceiling" />
          <span>空间</span>
          <strong>{props.document.has_ceiling ? "封闭" : "开放"}</strong>
        </div>
      </div>
      <div class="asset-appearance-light">
        <div>
          <span>环境光</span>
          <output>{props.document.ambient_light}</output>
        </div>
        <meter
          min="0"
          max="1"
          value={props.document.ambient_light}
          aria-label={`环境光 ${props.document.ambient_light}`}
        />
      </div>
    </div>
  )
}

function TerrainAppearance(props: { document: Extract<AppearanceDocument, { kind: "terrain" }> }) {
  const totalDepth = props.document.layers.reduce((total, layer) => total + layer.depth, 0)
  return (
    <div class="asset-appearance-inner asset-appearance-terrain">
      <div class="asset-appearance-heading">
        <strong>地层结构</strong>
        <span>总厚度 {totalDepth}</span>
      </div>
      <div class="asset-appearance-layers" aria-label="地层厚度比例">
        <For each={props.document.layers}>
          {(layer) => (
            <div class="asset-appearance-layer" style={{ flex: layer.depth }}>
              <strong>{layer.material}</strong>
              <span>{layer.depth}</span>
            </div>
          )}
        </For>
      </div>
      <ShowFeatures features={props.document.features} />
    </div>
  )
}

function ShowFeatures(props: { features: string[] }) {
  if (!props.features.length) return null
  return (
    <div class="asset-appearance-features">
      <span>地形特征</span>
      <strong>{props.features.join("、")}</strong>
    </div>
  )
}

/**
 * `picture`: the thing drawn as an inventory shows it (a block as a cube), when the page has it; an item without
 * one falls back to its own texture. `id`: its identifier with the mod's prefix, passed only when 高级 is on.
 */
export function AssetAppearance(props: { document: AppearanceDocument; picture?: string | null; id?: string | null }) {
  if (props.document.kind === "block") {
    const block = props.document
    return (
      <section class="asset-appearance asset-appearance-ingame" aria-label="方块外观">
        <InGame name={block.name} picture={props.picture ?? null} plain={null} stack={block.lucky?.max_stack ?? 64} lines={[]} id={props.id ?? null} note={blockPaint(block) === "colour" ? "还没有画图案，每一面都是这一种颜色" : null} />
      </section>
    )
  }
  if (props.document.kind === "item") {
    const item = props.document
    return (
      <section class="asset-appearance asset-appearance-ingame" aria-label="物品外观">
        <InGame name={item.name} picture={item.texture ?? null} plain={item.texture ? null : item.color} stack={item.max_stack} lines={itemLines(item)} id={props.id ?? null} note={item.texture ? null : "还没有画图案，游戏里是一块纯色"} />
      </section>
    )
  }
  if (props.document.kind === "biome")
    return (
      <section class="asset-appearance" aria-label="群系外观">
        <BiomeAppearance document={props.document} />
      </section>
    )
  if (props.document.kind === "dimension")
    return (
      <section class="asset-appearance" aria-label="维度外观">
        <DimensionAppearance document={props.document} />
      </section>
    )
  return (
    <section class="asset-appearance" aria-label="地形外观">
      <TerrainAppearance document={props.document} />
    </section>
  )
}

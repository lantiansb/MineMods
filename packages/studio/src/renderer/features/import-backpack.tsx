import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack, type JSX } from "solid-js"
import type { ImportedAsset, ImportedAssetCatalog } from "@minemods/mod-core/import-assets"
import type { ImportedAssetGraph } from "@minemods/mod-core/import-asset-graph"
import type { ImportAssetGraphAnalysisRun } from "../../main/import-asset-graph-service"
import type { StudioApi } from "../../api"
import type { ImportedProject } from "../../library"
import type { Preview } from "../viewport"
import { Button } from "../ui"
import { ModelCanvas, type ModelCanvasView } from "./model-canvas"
import { ImportedAudioPlayer, safeAudioMime } from "./imported-audio-player"
import { readEntityIcon, readFlatModelIcon, readModelIcon, readThumbnail } from "./imported-asset-media"
import { describeTag, readLoot, readRecipe, type LootDrop, type RecipePart, type RecipeView } from "./import-backpack-recipes"
import itemNames from "../assets/minecraft/1.21.1/item-names.json"
import "./import-backpack.css"

type Selection = Awaited<ReturnType<StudioApi["getImportAssetSelection"]>>
type GraphNode = ImportedAssetGraph["nodes"][number]
type GraphEdge = ImportedAssetGraph["edges"][number]
type Mod = ImportedProject["report"]["mods"][number]
type TabId = "entity" | "thing" | "block" | "item" | "world" | "rule" | "media" | "art" | "mods" | "other"
type Glyph = GraphNode["kind"] | "mod"
type Relation = { label: string; items: { node: GraphNode; maybe: boolean }[] }
/** How the AI is reached: an outside AI app, a model the app talks to itself, or not at all. */
type AiMode = "mcp" | "direct" | "none"

/** What an open card already shows about its thing, handed to an AI along with the question. */
type Known = { title: string; lines: string[]; files: { label: string; assetId: string }[] }

/** The game's own names for its items, for materials that are not part of the mod. */
const gameNames: Record<string, string> = itemNames

const pageSize = 120
/** Sources with this many parts or fewer are unpacked without asking. */
const autoUnpackLimit = 8
const tabs: { id: TabId; label: string; kinds: GraphNode["kind"][]; glyph: Glyph; advanced?: boolean; aside?: boolean }[] = [
  { id: "entity", label: "生物", kinds: ["entity"], glyph: "entity" },
  // Entities that are not alive: arrows, bolts, thrown blocks, boats, effects.
  { id: "thing", label: "弹射物与杂项", kinds: ["entity"], glyph: "entity", aside: true },
  { id: "block", label: "方块", kinds: ["block"], glyph: "block" },
  { id: "item", label: "物品", kinds: ["item"], glyph: "item" },
  { id: "world", label: "世界", kinds: ["dimension", "biome"], glyph: "biome" },
  { id: "rule", label: "配方与掉落", kinds: ["recipe", "loot", "effect"], glyph: "recipe" },
  { id: "media", label: "动作与声音", kinds: ["animation", "sound", "audio"], glyph: "sound" },
  { id: "art", label: "模型与贴图", kinds: ["model", "texture"], glyph: "texture", advanced: true },
  { id: "mods", label: "模组", kinds: [], glyph: "mod" },
  { id: "other", label: "其他", kinds: ["class", "resource"], glyph: "resource", advanced: true },
]
/** Whether a node belongs on a tab: living creatures and the other entities share a kind but not a tab. */
const onTab = (entry: (typeof tabs)[number], node: GraphNode) =>
  entry.kinds.includes(node.kind) && (node.kind !== "entity" || (node.metadata.aside === true) === (entry.aside === true))
const kindNames: Record<GraphNode["kind"], string> = {
  entity: "生物",
  block: "方块",
  item: "物品",
  model: "模型",
  texture: "贴图",
  audio: "声音",
  sound: "声音",
  animation: "动作",
  dimension: "维度",
  biome: "生物群系",
  loot: "掉落",
  recipe: "配方",
  effect: "状态",
  class: "代码",
  resource: "其他",
}
const kindOf = (node: GraphNode): string => (node.kind === "entity" && node.metadata.aside === true ? "实体" : kindNames[node.kind])
const mobCategories: Record<string, string> = {
  monster: "敌对生物",
  creature: "友好生物",
  ambient: "环境生物",
  axolotls: "水生生物",
  underground_water_creature: "水生生物",
  water_creature: "水生生物",
  water_ambient: "水生生物",
  misc: "特殊实体",
}
const soundActions: Record<string, string> = {
  ambient: "叫声",
  hurt: "受伤",
  death: "死亡",
  step: "脚步",
  attack: "攻击",
  shoot: "射击",
  roar: "咆哮",
  growl: "低吼",
  bite: "撕咬",
  warn: "警告",
  noise: "动静",
}
const outgoingLabels: Record<GraphEdge["type"], string> = {
  uses_model: "模型",
  uses_texture: "贴图",
  has_animation: "动作",
  plays_sound: "声音",
  spawns_in: "出现在",
  belongs_to: "来自",
  references: "相关的东西",
  extends: "代码",
}
const incomingLabels: Partial<Record<GraphEdge["type"], string>> = {
  uses_model: "谁在用它",
  uses_texture: "谁在用它",
  has_animation: "谁在用它",
  plays_sound: "谁在用它",
  spawns_in: "这里会出现",
  belongs_to: "包含",
  references: "谁提到它",
}

/** Small original pixel drawings for things that have no picture of their own. */
const glyphs: Record<Glyph, [string, number, number, number, number][]> = {
  entity: [
    ["#3d6b2e", 5, 2, 6, 1],
    ["#3d6b2e", 4, 3, 8, 2],
    ["#3d6b2e", 3, 5, 10, 6],
    ["#3d6b2e", 4, 11, 8, 2],
    ["#3d6b2e", 5, 13, 6, 1],
    ["#6fae4f", 5, 3, 3, 2],
    ["#6fae4f", 4, 5, 2, 3],
    ["#e8e2c8", 8, 6, 2, 2],
    ["#e8e2c8", 5, 9, 2, 2],
    ["#e8e2c8", 10, 10, 2, 2],
  ],
  block: [
    ["#5d9c3a", 2, 2, 12, 4],
    ["#7a5c3c", 2, 6, 12, 8],
    ["#4a7d2d", 2, 5, 3, 2],
    ["#4a7d2d", 8, 5, 2, 2],
    ["#5e452c", 4, 9, 2, 2],
    ["#5e452c", 10, 11, 2, 1],
    ["#93714c", 7, 8, 2, 1],
  ],
  item: [
    ["#3fc7c0", 6, 2, 4, 2],
    ["#3fc7c0", 4, 4, 8, 4],
    ["#3fc7c0", 5, 8, 6, 3],
    ["#3fc7c0", 7, 11, 2, 3],
    ["#b8f4ef", 6, 4, 2, 2],
    ["#249089", 10, 6, 2, 3],
  ],
  model: [
    ["#e8e8e8", 3, 5, 8, 8],
    ["#b8b8b8", 5, 3, 8, 2],
    ["#8f8f8f", 11, 5, 2, 8],
    ["#555555", 3, 5, 8, 1],
    ["#555555", 3, 12, 8, 1],
    ["#555555", 3, 5, 1, 8],
    ["#555555", 10, 5, 1, 8],
  ],
  texture: [
    ["#ffffff", 2, 2, 12, 12],
    ["#8fb7e8", 3, 3, 10, 6],
    ["#f5d76e", 10, 4, 2, 2],
    ["#5d9c3a", 3, 9, 10, 4],
    ["#3d6b2e", 5, 7, 3, 3],
  ],
  audio: [
    ["#262626", 6, 3, 7, 2],
    ["#262626", 6, 3, 2, 8],
    ["#262626", 11, 3, 2, 7],
    ["#262626", 3, 10, 5, 3],
    ["#262626", 8, 9, 5, 3],
  ],
  sound: [
    ["#262626", 2, 6, 3, 4],
    ["#262626", 5, 5, 1, 6],
    ["#262626", 6, 4, 1, 8],
    ["#262626", 7, 3, 1, 10],
    ["#3c8527", 10, 6, 1, 4],
    ["#3c8527", 12, 4, 1, 8],
  ],
  animation: [
    ["#262626", 2, 3, 12, 10],
    ["#e8e8e8", 3, 4, 10, 8],
    ["#3c8527", 6, 5, 2, 6],
    ["#3c8527", 8, 6, 2, 4],
    ["#3c8527", 10, 7, 1, 2],
  ],
  dimension: [
    ["#1c1028", 3, 1, 10, 14],
    ["#8a3fd6", 5, 3, 6, 10],
    ["#c79bf2", 6, 5, 2, 2],
    ["#c79bf2", 8, 9, 2, 2],
    ["#5a1f9c", 6, 10, 1, 2],
  ],
  biome: [
    ["#3d6b2e", 6, 1, 4, 2],
    ["#3d6b2e", 4, 3, 8, 3],
    ["#5d9c3a", 2, 6, 12, 4],
    ["#3d6b2e", 3, 9, 3, 1],
    ["#7a5c3c", 7, 10, 2, 4],
    ["#5d9c3a", 2, 14, 12, 1],
  ],
  loot: [
    ["#262626", 2, 4, 12, 10],
    ["#a8743a", 3, 5, 10, 3],
    ["#8a5a28", 3, 9, 10, 4],
    ["#262626", 3, 8, 10, 1],
    ["#d8d8d8", 7, 7, 2, 3],
  ],
  recipe: [
    ["#262626", 2, 2, 12, 12],
    ["#8b8b8b", 3, 3, 3, 3],
    ["#8b8b8b", 7, 3, 2, 3],
    ["#8b8b8b", 10, 3, 3, 3],
    ["#8b8b8b", 3, 7, 3, 2],
    ["#3c8527", 7, 7, 2, 2],
    ["#8b8b8b", 10, 7, 3, 2],
    ["#8b8b8b", 3, 10, 3, 3],
    ["#8b8b8b", 7, 10, 2, 3],
    ["#8b8b8b", 10, 10, 3, 3],
  ],
  effect: [
    ["#262626", 6, 1, 4, 2],
    ["#d8d8d8", 7, 3, 2, 3],
    ["#262626", 4, 6, 8, 8],
    ["#c0399c", 5, 8, 6, 5],
    ["#f0a8dc", 6, 9, 2, 2],
  ],
  class: [
    ["#262626", 3, 1, 10, 14],
    ["#ffffff", 4, 2, 8, 12],
    ["#8b8b8b", 5, 4, 6, 1],
    ["#8b8b8b", 5, 7, 4, 1],
    ["#8b8b8b", 5, 10, 6, 1],
  ],
  resource: [
    ["#262626", 3, 1, 10, 14],
    ["#ffffff", 4, 2, 8, 12],
    ["#8b8b8b", 5, 4, 6, 1],
    ["#8b8b8b", 5, 7, 6, 1],
    ["#8b8b8b", 5, 10, 3, 1],
  ],
  mod: [
    ["#262626", 2, 2, 12, 12],
    ["#b0623a", 3, 3, 10, 10],
    ["#e9b678", 4, 4, 8, 2],
    ["#7a3f20", 4, 11, 8, 1],
    ["#f5e3c0", 6, 7, 4, 3],
  ],
}

function PixelGlyph(props: { name: Glyph }) {
  return (
    <svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
      <For each={glyphs[props.name]}>
        {([fill, x, y, width, height]) => <rect x={x} y={y} width={width} height={height} fill={fill} />}
      </For>
    </svg>
  )
}

function prettify(value: string) {
  const tail = value.split(/[:/\\]/).at(-1)!.replace(/\.[a-z0-9]+$/i, "")
  const words = tail
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
  return words.join(" ") || value
}

/** The in-game name when the mod ships one, otherwise a readable form of its id. */
export function backpackName(node: GraphNode) {
  const displayName = node.metadata.displayName
  if (typeof displayName === "string" && displayName.trim()) return displayName.trim()
  if (typeof node.metadata.translationKey === "string" && node.name.trim()) return node.name.trim()
  return prettify(node.resourceId || node.name || node.sourcePath || node.id)
}

function failure(cause: unknown) {
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

export function ImportBackpack(props: {
  project: ImportedProject
  active: boolean
  /** Show code-level entries and the "open as file" shortcut. */
  advanced: boolean
  onOpenFile: (assetId: string) => void
}) {
  const id = () => props.project.manifest.id
  const [stage, setStage] = createSignal<"loading" | "choose" | "unpacking" | "sorting" | "ready">("loading")
  const [selection, setSelection] = createSignal<Selection>()
  const [catalog, setCatalog] = createSignal<ImportedAssetCatalog | null>(null)
  const [graph, setGraph] = createSignal<ImportedAssetGraph | null>(null)
  const [chosen, setChosen] = createSignal<string[]>([])
  const [error, setError] = createSignal("")
  const [tab, setTab] = createSignal<TabId>("entity")
  const [query, setQuery] = createSignal("")
  const [visible, setVisible] = createSignal(pageSize)
  const [trail, setTrail] = createSignal<string[]>([])
  const [openMod, setOpenMod] = createSignal<Mod>()
  const [tip, setTip] = createSignal<{ x: number; y: number; title: string; lines: string[] }>()
  const [story, setStory] = createSignal<ImportAssetGraphAnalysisRun | null>(null)
  const [storyBusy, setStoryBusy] = createSignal(false)
  const [storyError, setStoryError] = createSignal("")
  const [aiMode, setAiMode] = createSignal<AiMode>("none")
  const [said, setSaid] = createSignal<{ note: string; prompt?: string }>()
  let request = 0
  let disposed = false
  let started = false
  onCleanup(() => {
    disposed = true
    request++
  })
  const alive = (current: number) => !disposed && current === request

  const [words, setWords] = createSignal(new Map<string, string>())
  const [beings, setBeings] = createSignal<Awaited<ReturnType<StudioApi["listImportedEntities"]>>>([])
  const being = createMemo(() => new Map(beings().map((entry) => [entry.entity, entry])))
  const assets = createMemo(() => new Map((catalog()?.assets ?? []).map((asset) => [asset.id, asset])))
  const files = createMemo(() => new Map((catalog()?.assets ?? []).map((asset) => [asset.resourcePath, asset])))
  /**
   * What the mod registers is read from its resource pack: one blockstate file per block and one
   * item model per item. That is the same list the game's creative inventory shows.
   */
  const world = createMemo(() => {
    const source = graph()
    const byAsset = new Map<string, GraphNode>()
    source?.nodes.forEach((node) => {
      if (node.sourceAssetId && (node.kind === "model" || node.kind === "texture")) byAsset.set(node.sourceAssetId, node)
    })
    const made: GraphNode[] = []
    const links: GraphEdge[] = []
    const link = (from: GraphNode, asset: ImportedAsset | undefined, type: GraphEdge["type"]) => {
      const to = asset && byAsset.get(asset.id)
      if (to) links.push({ id: `${from.id}>${to.id}`, from: from.id, to: to.id, type, relationStatus: "verified", evidence: [] })
    }
    const blocks = new Set<string>()
    const thing = (kind: "block" | "item", namespace: string, name: string) => {
      const model = files().get(`assets/${namespace}/models/item/${name}.json`)
      const shape = files().get(`assets/${namespace}/models/block/${name}.json`)
      const texture = files().get(`assets/${namespace}/textures/${kind}/${name}.png`)
      const node: GraphNode = {
        id: `${kind}:${namespace}:${name}`,
        kind,
        name,
        resourceId: `${namespace}:${name}`,
        sourceAssetId: (kind === "block" ? (shape ?? model) : model)?.id ?? null,
        sourcePath: null,
        metadata: { available: true },
        evidence: [],
      }
      made.push(node)
      link(node, kind === "block" ? (model ?? shape) : model, "uses_model")
      link(node, texture, "uses_texture")
    }
    files().forEach((_asset, path) => {
      const match = path.match(/^assets\/([^/]+)\/blockstates\/([^/]+)\.json$/)
      if (!match) return
      blocks.add(`${match[1]}:${match[2]}`)
      thing("block", match[1]!, match[2]!)
    })
    files().forEach((_asset, path) => {
      const match = path.match(/^assets\/([^/]+)\/models\/item\/([^/]+)\.json$/)
      if (match && !blocks.has(`${match[1]}:${match[2]}`)) thing("item", match[1]!, match[2]!)
    })
    // Tag lists, recipe-unlock advancements and the row of spawn eggs are bookkeeping, not things to browse.
    // Arrows, bolts and thrown things are entities too; they get a tab of their own.
    // Without a shape to go by, drops and spawn eggs tell the living from the rest.
    const lives = beings().some((entry) => entry.creature)
    const helper = (node: Pick<GraphNode, "resourceId" | "metadata">) => {
      const entry = being().get(node.resourceId ?? "")
      const category = node.metadata.mobCategory
      const aside = !!entry && (entry.helper || (lives && !entry.creature && entry.kind === "none"))
      return aside && !(typeof category === "string" && category.toLowerCase() !== "misc")
    }
    const noise = (node: GraphNode) =>
      /(^|[:/])(tags|advancements)\//.test(node.resourceId ?? "") ||
      (node.kind === "item" && /_spawn_egg$/.test(node.resourceId ?? "")) ||
      (node.kind === "entity" && node.metadata.available === false)
    // Creatures come from the mod's data too. The relationship graph only knows the ones whose registration
    // code it could follow, so the rest are added here.
    const graphed = new Set((source?.nodes ?? []).filter((node) => node.kind === "entity").map((node) => node.resourceId))
    const extra: GraphNode[] = beings()
      .filter(
        (entry) =>
          !graphed.has(entry.entity) &&
          (entry.creature || entry.kind !== "none" || helper({ resourceId: entry.entity, metadata: {} })),
      )
      .map((entry) => ({
        id: `entity:${entry.entity}`,
        kind: "entity" as const,
        name: entry.entity.split(":")[1]!,
        resourceId: entry.entity,
        sourceAssetId: null,
        sourcePath: null,
        metadata: { available: true, ...(helper({ resourceId: entry.entity, metadata: {} }) ? { aside: true } : {}) },
        evidence: [],
      }))
    // A recipe or drop table is named after what it makes or who drops it: tie the two together.
    const things = new Map(made.map((node) => [node.id, node]))
    const creatures = new Map(
      [...(source?.nodes ?? []).filter((node) => node.kind === "entity"), ...extra].map((node) => [node.resourceId, node]),
    )
    source?.nodes.forEach((node) => {
      if (node.kind !== "recipe" && node.kind !== "loot") return
      const [namespace = "", path = ""] = (node.resourceId ?? "").split(":")
      const leaf = path.split("/").at(-1) ?? ""
      const subject =
        (path.includes("entities/") ? creatures.get(`${namespace}:${leaf}`) : undefined) ??
        things.get(`block:${namespace}:${leaf}`) ??
        things.get(`item:${namespace}:${leaf}`) ??
        creatures.get(`${namespace}:${leaf}`)
      if (subject)
        links.push({
          id: `${node.id}>${subject.id}`,
          from: node.id,
          to: subject.id,
          type: "references",
          relationStatus: "verified",
          evidence: [],
        })
    })
    const nodes = [
      ...(source?.nodes ?? [])
        .filter(
          (node) => (made.length ? node.kind !== "block" && node.kind !== "item" : true) && (props.advanced || !noise(node)),
        )
        .map((node) => (node.kind === "entity" && helper(node) ? { ...node, metadata: { ...node.metadata, aside: true } } : node)),
      ...made.filter((node) => props.advanced || !noise(node)),
      ...extra,
    ]
    return { nodes, edges: [...(source?.edges ?? []), ...links] }
  })
  const index = createMemo(() => {
    const nodeById = new Map(world().nodes.map((node) => [node.id, node]))
    const outgoing = new Map<string, GraphEdge[]>()
    const incoming = new Map<string, GraphEdge[]>()
    const push = (map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge) => {
      const list = map.get(key)
      if (list) list.push(edge)
      else map.set(key, [edge])
    }
    world().edges.forEach((edge) => {
      if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) return
      push(outgoing, edge.from, edge)
      push(incoming, edge.to, edge)
    })
    return { nodeById, outgoing, incoming }
  })
  /** Language files may carry the game's colour codes ("§6Name§r"); only the words are shown. */
  const plain = (text: string) => text.replace(/§./g, "").trim()

  /** The name the game shows, from the mod's own language files: Chinese first, then English. */
  const nameOf = (node: GraphNode) => {
    const own = node.metadata.displayName
    if (typeof own === "string" && own.trim()) return own.trim()
    if (typeof node.metadata.translationKey === "string" && node.name.trim()) return node.name.trim()
    const [namespace = "", path = ""] = (node.resourceId ?? "").split(":")
    const leaf = path.replace(/\.[a-z0-9]+$/i, "").split("/").at(-1) ?? ""
    const lookup = (...kinds: string[]) =>
      kinds.map((kind) => words().get(`${kind}.${namespace}.${leaf}`)).find((value) => value)
    const found =
      node.kind === "item"
        ? lookup("item", "block")
        : node.kind === "block"
          ? lookup("block", "item")
          : node.kind === "entity" || node.kind === "biome" || node.kind === "effect"
            ? lookup(node.kind)
            : node.kind === "recipe" || node.kind === "loot"
              ? lookup("item", "block", "entity")
              : node.kind === "dimension"
                ? lookup("dimension")
                : undefined
    if (found) return found
    if (node.kind === "sound") {
      // "entity.<mod>.<creature>.<action>": say whose sound it is and what it is doing.
      const parts = path.split(".")
      const owner = parts[0] === "entity" ? words().get(`entity.${parts[1]}.${parts[2]}`) : undefined
      const action = parts.slice(owner ? 3 : -2).join(" ")
      const label = soundActions[parts.at(-1) ?? ""] ?? prettify(action.replaceAll(" ", "_"))
      return owner ? `${owner} · ${label}` : prettify(parts.slice(-2).join("_"))
    }
    return backpackName(node)
  }
  createEffect(() => {
    const projectId = id()
    const sources = [...files().values()].filter((asset) =>
      /^assets\/[^/]+\/lang\/(zh_cn|en_us)\.(json|lang)$/i.test(asset.resourcePath),
    )
    if (!sources.length) return
    let live = true
    const chinese = (path: string) => Number(/zh_cn\.[a-z]+$/i.test(path))
    const snake = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
    void Promise.all(
      sources.map((asset) =>
        window.studio
          .readImportedAssetFile({ id: projectId, assetId: asset.id })
          .then((file) => ({ asset, file }))
          .catch(() => null),
      ),
    ).then((results) => {
      if (!live) return
      const next = new Map<string, string>()
      // English first so Chinese entries overwrite it.
      results
        .filter((result) => result !== null)
        .sort((first, second) => chinese(first.asset.resourcePath) - chinese(second.asset.resourcePath))
        .forEach(({ asset, file }) => {
          if (file.encoding !== "utf8" || file.truncated) return
          if (/\.lang$/i.test(asset.resourcePath)) {
            // 1.12 and earlier: "tile.moss_stone.name=…", "item.rubyGem.name=…", "entity.modid.SnowOwl.name=…".
            const namespace = asset.resourcePath.split("/")[1]!
            const kinds: Record<string, string> = { tile: "block", item: "item", entity: "entity" }
            for (const line of file.content.split(/\r?\n/)) {
              const match = line.match(/^(tile|item|entity)\.([\w.:-]+)\.name\s*=\s*(.+)$/)
              if (match?.[3]?.trim())
                next.set(`${kinds[match[1]!]}.${namespace}.${snake(match[2]!.split(/[.:]/).at(-1)!)}`, plain(match[3]))
            }
            return
          }
          try {
            Object.entries(JSON.parse(file.content) as Record<string, unknown>).forEach(([key, value]) => {
              if (typeof value === "string" && plain(value)) next.set(key, plain(value))
            })
          } catch {
            // A malformed language file only costs the translated names.
          }
        })
      setWords(next)
    })
    onCleanup(() => {
      live = false
    })
  })
  const assetOf = (node: GraphNode | undefined) => (node?.sourceAssetId ? assets().get(node.sourceAssetId) : undefined)
  const linked = (node: GraphNode | undefined, type: GraphEdge["type"]) =>
    (index().outgoing.get(node?.id ?? "") ?? [])
      .filter((edge) => edge.type === type)
      .sort(
        (first, second) =>
          Number(first.relationStatus === "candidate") - Number(second.relationStatus === "candidate"),
      )
      .map((edge) => index().nodeById.get(edge.to))
      .find((target) => assetOf(target))
  const modelOf = (node: GraphNode) => (node.kind === "model" ? node : linked(node, "uses_model"))
  /** A creature the service found a shape for, whether written in code or shipped as a model file. */
  const shaped = (node: GraphNode) => {
    const entry = node.kind === "entity" ? being().get(node.resourceId ?? "") : undefined
    return entry && entry.kind !== "none" ? entry : undefined
  }
  const textureOf = (node: GraphNode) =>
    node.kind === "texture" ? node : (linked(node, "uses_texture") ?? linked(linked(node, "uses_model"), "uses_texture"))
  /**
   * Creatures show their model from the default angle, blocks an inventory-style cube and items
   * their sprite. Rendering a block's full model is slow, so it is only the last resort here.
   */
  const pictureOf = async (node: GraphNode): Promise<string | null> => {
    if (node.kind === "recipe" || node.kind === "loot") {
      const subject = (index().outgoing.get(node.id) ?? [])
        .map((edge) => index().nodeById.get(edge.to))
        .find((target) => target?.kind === "block" || target?.kind === "item" || target?.kind === "entity")
      return subject ? pictureOf(subject) : null
    }
    const model = assetOf(modelOf(node)) ?? (node.kind === "block" || node.kind === "item" ? assetOf(node) : undefined)
    const texture = assetOf(textureOf(node))
    const shape = shaped(node)
    const sprite = () => (texture ? readThumbnail(id(), texture) : Promise.resolve(null))
    const drawn = () => (model ? readFlatModelIcon(id(), model, files()) : Promise.resolve(null))
    const solid = () =>
      shape
        ? readEntityIcon(id(), shape.entity, catalog()?.createdAt ?? "")
        : model
          ? readModelIcon(id(), model)
          : Promise.resolve(null)
    if (node.kind === "texture") return sprite()
    if (node.kind === "item") return (await sprite()) ?? (await drawn()) ?? (await solid())
    if (node.kind === "block") return (await drawn()) ?? (await sprite()) ?? (await solid())
    if (node.kind === "entity" || node.kind === "model") return (await solid()) ?? (await drawn()) ?? (await sprite())
    return null
  }

  /** Items, blocks and creatures by their in-game id, so a recipe slot can lead to the thing itself. */
  const byResource = createMemo(() => {
    const rank: Partial<Record<GraphNode["kind"], number>> = { item: 3, block: 2, entity: 1 }
    const full = new Map<string, GraphNode>()
    const short = new Map<string, GraphNode>()
    world().nodes.forEach((node) => {
      const weight = rank[node.kind]
      if (!weight || !node.resourceId) return
      if (weight > (rank[full.get(node.resourceId)?.kind ?? "class"] ?? 0)) full.set(node.resourceId, node)
      const name = node.resourceId.split(":")[1]!
      if (weight > 1 && weight > (rank[short.get(name)?.kind ?? "class"] ?? 0)) short.set(name, node)
    })
    return { full, short }
  })
  const jsonFiles = new Map<string, Promise<unknown>>()
  /** A data file of the mod, parsed; null when it cannot be read. */
  const readJson = (assetId: string) => {
    const key = `${id()}:${assetId}`
    const known = jsonFiles.get(key)
    if (known) return known
    const work = window.studio
      .readImportedAssetFile({ id: id(), assetId })
      .then((file): unknown => (file.encoding === "utf8" && !file.truncated ? JSON.parse(file.content) : null))
      .catch(() => null)
    jsonFiles.set(key, work)
    return work
  }
  const gameIcons = new Map<string, Promise<string | null>>()
  /** The picture of something from the base game, taken from the player's own copy of the game. */
  const gameIcon = (item: string) => {
    const key = `${id()}:${item}`
    const known = gameIcons.get(key)
    if (known) return known
    const work = Promise.resolve()
      .then(() => window.studio.readImportedGameIcon({ id: id(), item }))
      .then((icon) => (icon ? `data:${icon.mime};base64,${icon.base64}` : null))
      .catch(() => null)
    gameIcons.set(key, work)
    return work
  }
  /** The first thing a tag lists, when the mod ships that list. */
  const tagMember = async (tag: string) => {
    const [namespace = "", path = ""] = tag.split(":")
    const list = ["items", "item", "blocks", "block"]
      .map((folder) => files().get(`data/${namespace}/tags/${folder}/${path}.json`))
      .find(Boolean)
    const json = list ? ((await readJson(list.id)) as { values?: unknown } | null) : null
    const first = (Array.isArray(json?.values) ? json.values : [])
      .map((entry: unknown) => (typeof entry === "string" ? entry : ((entry as { id?: unknown } | null)?.id ?? "")))
      .find((entry) => typeof entry === "string" && /^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(entry))
    return typeof first === "string" ? first : undefined
  }
  const [tagMembers, setTagMembers] = createSignal(new Map<string, string | undefined>())
  /** Looks up the tags of a recipe once, so its slots can show a member of each. */
  const learnTags = (parts: (RecipePart | null)[]) => {
    const fresh = [...new Set(parts.flatMap((part) => (part?.tag && !tagMembers().has(part.id) ? [part.id] : [])))]
    if (!fresh.length) return
    void Promise.all(fresh.map((tag) => tagMember(tag).catch(() => undefined))).then((found) => {
      if (disposed) return
      const next = new Map(tagMembers())
      fresh.forEach((tag, at) => next.set(tag, found[at]))
      setTagMembers(next)
    })
  }
  /** What one slot of a recipe stands for: a thing of the mod, or something from the game or another mod. */
  const partInfo = (part: RecipePart) => {
    const lookup = (item: string) => {
      const node = byResource().full.get(item)
      const [namespace = "", name = ""] = item.split(":")
      const fromGame = gameNames[item] ?? words().get(`item.${namespace}.${name}`) ?? words().get(`block.${namespace}.${name}`)
      return { node, name: node ? nameOf(node) : (fromGame ?? prettify(item)), item }
    }
    if (!part.tag) return lookup(part.id)
    const [namespace = "", path = ""] = part.id.split(":")
    const written = words().get(`tag.item.${namespace}.${path.replaceAll("/", ".")}`)
    const guess = describeTag(part.id, gameNames, (name) => {
      const node = byResource().short.get(name)
      return node ? { id: node.resourceId!, name: nameOf(node) } : undefined
    })
    const sample = tagMembers().get(part.id) ?? guess.sample
    const shown = sample ? lookup(sample) : undefined
    return {
      node: shown?.node,
      // Only a guessed English name is worse than naming one member of the group.
      name: written ? `任意${written}` : !guess.sample && shown ? `${shown.name}这一类` : guess.name,
      item: sample ?? null,
    }
  }
  const partLabel = (part: RecipePart) => {
    const name = partInfo(part).name
    return part.count > 1 ? `${name} ×${part.count}` : name
  }

  const loadGraph = async (current: number) => {
    setStage("sorting")
    const result = await window.studio.getImportAssetGraph({ id: id() })
    if (!alive(current)) return
    // Which creatures the mod adds and what they look like; a failure only costs their pictures.
    const found = await window.studio.listImportedEntities({ id: id() }).catch(() => [])
    if (!alive(current)) return
    setBeings(found)
    setGraph(result)
    setStage("ready")
    void window.studio
      .getImportAssetGraphAnalysis({ id: id() })
      .then((run) => {
        if (alive(current)) setStory(run)
      })
      .catch(() => undefined)
  }
  const unpack = async (groupIds: string[]) => {
    const current = ++request
    setError("")
    setStage("unpacking")
    try {
      const result = await window.studio.extractImportAssets({ id: id(), groupIds })
      if (!alive(current)) return
      setCatalog(result)
      await loadGraph(current)
    } catch (cause) {
      if (alive(current)) {
        setError(failure(cause))
        setStage("choose")
      }
    }
  }
  const open = async () => {
    const current = ++request
    setError("")
    setStage("loading")
    try {
      const [parts, existing] = await Promise.all([
        window.studio.getImportAssetSelection({ id: id() }),
        window.studio.getImportedAssetCatalog({ id: id() }),
      ])
      if (!alive(current)) return
      setSelection(parts)
      setCatalog(existing)
      if (existing) return await loadGraph(current)
      setChosen(parts.groups.map((group) => group.id))
      if (parts.groups.length > 0 && parts.groups.length <= autoUnpackLimit)
        return await unpack(parts.groups.map((group) => group.id))
      setStage("choose")
    } catch (cause) {
      if (alive(current)) {
        setError(failure(cause))
        setStage("choose")
      }
    }
  }
  createEffect(() => {
    if (!props.active || started) return
    started = true
    untrack(() => void open())
  })

  const mods = createMemo(() => props.project.report.mods)
  const shownTabs = createMemo(() =>
    tabs
      .filter((entry) => !entry.advanced || props.advanced)
      .map((entry) => ({
        ...entry,
        count:
          entry.id === "mods"
            ? mods().length
            : world().nodes.filter((node) => onTab(entry, node)).length,
      }))
      .filter((entry) => entry.count > 0 && (entry.id !== "mods" || entry.count > 1)),
  )
  createEffect(() => {
    const list = shownTabs()
    if (stage() === "ready" && list.length && !list.some((entry) => entry.id === tab())) setTab(list[0]!.id)
  })
  const filtered = createMemo(() => {
    const entry = tabs.find((value) => value.id === tab())!
    const term = query().trim().toLocaleLowerCase()
    return world()
      .nodes.filter((node) => onTab(entry, node))
      .map((node) => ({ node, name: nameOf(node) }))
      .filter(
        ({ node, name }) =>
          !term || [name, node.name, node.resourceId].some((value) => value?.toLocaleLowerCase().includes(term)),
      )
      .sort(
        (first, second) =>
          Number(first.node.metadata.available === false) - Number(second.node.metadata.available === false) ||
          Number(first.node.kind === "entity" && !shaped(first.node)) -
            Number(second.node.kind === "entity" && !shaped(second.node)) ||
          first.name.localeCompare(second.name, "zh-CN"),
      )
      .map(({ node }) => node)
  })
  const filteredMods = createMemo(() => {
    const term = query().trim().toLocaleLowerCase()
    return mods().filter(
      (mod) => !term || [mod.name, mod.id].some((value) => value?.toLocaleLowerCase().includes(term)),
    )
  })
  const total = () => (tab() === "mods" ? filteredMods().length : filtered().length)

  const current = createMemo(() => index().nodeById.get(trail().at(-1) ?? ""))
  const show = (node: GraphNode) => {
    setTip(undefined)
    setOpenMod(undefined)
    setTrail((value) => (value.at(-1) === node.id ? value : [...value, node.id]))
  }
  const close = () => {
    setTrail([])
    setOpenMod(undefined)
  }
  createEffect(() => {
    if (!current() && !openMod()) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      close()
    }
    window.addEventListener("keydown", key, true)
    onCleanup(() => window.removeEventListener("keydown", key, true))
  })

  const relations = createMemo<Relation[]>(() => {
    const node = current()
    if (!node) return []
    const groups = new Map<string, Relation>()
    const seen = new Set<string>([node.id])
    const add = (label: string, other: GraphNode | undefined, edge: GraphEdge) => {
      if (!other || seen.has(other.id)) return
      if (!props.advanced && (other.kind === "class" || other.kind === "resource" || edge.type === "extends")) return
      seen.add(other.id)
      const group = groups.get(label) ?? { label, items: [] }
      group.items.push({ node: other, maybe: edge.relationStatus === "candidate" })
      groups.set(label, group)
    }
    ;(index().outgoing.get(node.id) ?? []).forEach((edge) =>
      add(outgoingLabels[edge.type], index().nodeById.get(edge.to), edge),
    )
    // A creature's picture comes from its model, so list what that model is made of as well.
    const model = node.kind === "model" ? undefined : linked(node, "uses_model")
    ;(index().outgoing.get(model?.id ?? "") ?? [])
      .filter((edge) => edge.type === "uses_texture" || edge.type === "has_animation")
      .forEach((edge) => add(outgoingLabels[edge.type], index().nodeById.get(edge.to), edge))
    ;(index().incoming.get(node.id) ?? []).forEach((edge) => {
      const other = index().nodeById.get(edge.from)
      const label = other?.kind === "recipe" ? "配方" : other?.kind === "loot" ? "掉落" : incomingLabels[edge.type]
      if (label) add(label, other, edge)
    })
    const order = ["配方", "掉落", "模型", "贴图", "动作", "声音", "出现在", "这里会出现", "包含", "谁在用它", "相关的东西", "谁提到它", "来自"]
    return [...groups.values()].sort((first, second) => order.indexOf(first.label) - order.indexOf(second.label))
  })
  const facts = createMemo(() => {
    const node = current()
    if (!node) return []
    const lines: string[] = []
    const category = node.metadata.mobCategory
    if (typeof category === "string") lines.push(mobCategories[category.toLowerCase()] ?? "生物")
    if (node.kind === "animation")
      lines.push(
        node.metadata.animationMode === "programmatic"
          ? "写在模组代码里的动作"
          : node.metadata.animationMode === "texture_frames"
            ? "一帧一帧切换的贴图"
            : "单独的动作文件",
      )
    const home = (index().outgoing.get(node.id) ?? [])
      .filter((edge) => edge.type === "belongs_to")
      .map((edge) => index().nodeById.get(edge.to))
      .find(Boolean)
    const group = catalog()?.groups.find((value) => value.id === assetOf(node)?.groupId)
    if (home || (group && (catalog()?.groups.length ?? 0) > 1)) lines.push(`来自 ${home ? nameOf(home) : group!.name}`)
    if (node.metadata.available === false) lines.push("模组里只提到了它，本体在原版游戏或别的模组里")
    return lines
  })
  const realIds = createMemo(() => new Set((graph()?.nodes ?? []).map((node) => node.id)))
  /**
   * The entries an explanation can be asked for. Blocks, items and some creatures are put together
   * here from the mod's files and are unknown to the analysis, so their recipes, drops, models and
   * textures speak for them.
   */
  const standIns = (node: GraphNode | undefined) => {
    if (!node) return []
    if (realIds().has(node.id)) return [node.id]
    const near = [
      ...(index().incoming.get(node.id) ?? []).map((edge) => index().nodeById.get(edge.from)),
      ...(index().outgoing.get(node.id) ?? []).map((edge) => index().nodeById.get(edge.to)),
    ]
    return [...new Set(near.flatMap((other) => (other && realIds().has(other.id) ? [other.id] : [])))].slice(0, 12)
  }
  const storyEntries = createMemo(() => {
    const node = current()
    const ids = standIns(node)
    return (story()?.result?.entries ?? [])
      .filter((entry) => ids.includes(entry.nodeId))
      .map((entry) => {
        const about = entry.nodeId === node?.id ? undefined : index().nodeById.get(entry.nodeId)
        return { entry, about: about ? `${kindOf(about)} · ${nameOf(about)}` : "" }
      })
  })
  /** Whether the current explanation run was started from the card that is open. */
  const storyMine = () => standIns(current()).some((nodeId) => story()?.selectedNodeIds.includes(nodeId))
  const storyRunning = () =>
    storyBusy() || (["running", "awaiting_model"].includes(story()?.state ?? "") && aiMode() === "direct" && storyMine())
  const checkAi = async (): Promise<AiMode> => {
    const [connection, environment] = await Promise.all([
      window.studio.getConnection().catch(() => null),
      window.studio.environment().catch(() => null),
    ])
    const mode = connection?.mode === "mcp" ? "mcp" : environment?.aiConfigured ? "direct" : "none"
    if (!disposed) setAiMode(mode)
    return mode
  }
  let saidTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(saidTimer))
  // A message belongs to the card it was said on.
  createEffect(() => {
    if (!trail().length) return
    clearTimeout(saidTimer)
    setStoryError("")
    setSaid(undefined)
    void checkAi()
  })
  /** A question about one thing, written so it can be pasted into any AI chat. */
  const askText = async (node: GraphNode, mode: AiMode, known: Known) => {
    const mods = props.project.report.mods
    const lines = [
      `我在看 Minecraft 模组「${(mods.length === 1 ? mods[0]!.name?.trim() : "") || props.project.manifest.name}」，想请你给我讲讲里面的一样东西。`,
      "",
      `名字：${known.title}`,
      `类别：${kindOf(node)}`,
      ...(node.resourceId ? [`编号：${node.resourceId}`] : []),
      ...known.lines,
    ]
    const groups = relations().slice(0, 8)
    if (groups.length) {
      lines.push("", "和它有关的东西：")
      groups.forEach((group) => {
        const named = group.items
          .slice(0, 6)
          .map(({ node: other }) => nameOf(other) + (other.resourceId ? `（${other.resourceId}）` : ""))
        lines.push(`- ${group.label}：${named.join("、")}${group.items.length > 6 ? ` 等 ${group.items.length} 个` : ""}`)
      })
    }
    lines.push(
      "",
      "请用玩家听得懂的话告诉我：",
      "1. 它是什么",
      "2. 怎么获得，或者会在哪里出现",
      "3. 有什么用",
      "4. 要注意什么",
      "不用讲代码和文件，拿不准的地方请直接说拿不准。",
    )
    if (mode === "mcp") {
      const term = (node.resourceId ?? node.name).split(/[:/]/).at(-1)!
      lines.push(
        "",
        `你已经连着 MineMods，可以自己去查它的细节。这个模组的工程编号（id）是 ${id()}。`,
        `- get_import_asset_graph：传 id 和 query（比如 "${term}"），能查到它和跟它有关的条目；`,
        `- list_imported_assets：传 id 和 query（比如 "${term}"），能找到它的文件和每个文件的 assetId；`,
        "- read_imported_asset：传 id 和 assetId，能读出文件内容。",
      )
      if (known.files.length)
        lines.push(`相关文件的 assetId：${known.files.map((file) => `${file.label} ${file.assetId}`).join("；")}。`)
      return lines.join("\n")
    }
    // No tools on the other side: hand over the facts themselves.
    for (const file of known.files.slice(0, 2)) {
      const json = await readJson(file.assetId)
      if (!json) continue
      const text = JSON.stringify(json)
      lines.push("", `下面是模组里它的${file.label}原文，供你参考：`, text.length > 3000 ? `${text.slice(0, 3000)}\n…（后面省略）` : text)
    }
    return lines.join("\n")
  }
  const copyAsk = async (node: GraphNode, mode: AiMode, known: Known) => {
    const text = await askText(node, mode, known)
    if (disposed || current()?.id !== node.id) return
    clearTimeout(saidTimer)
    try {
      // The app's own clipboard first: the page's one refuses whenever the window is not in front.
      await window.studio.copyText({ text: text.slice(0, 20_000) }).catch(() => navigator.clipboard.writeText(text))
      setSaid({ note: "已复制，去你的 AI 窗口粘贴就行" })
      saidTimer = setTimeout(() => setSaid(undefined), 5000)
    } catch {
      setSaid({ note: "没能自动复制。请把下面这段话全选复制，再贴给你的 AI。", prompt: text })
    }
  }
  const tell = async (node: GraphNode, known: Known) => {
    if (storyBusy()) return
    setStoryBusy(true)
    setStoryError("")
    setSaid(undefined)
    try {
      const mode = await checkAi()
      const nodeIds = standIns(node)
      // With an outside AI app, or nothing to hand to the built-in one, the player takes the question along.
      if (mode !== "direct" || !nodeIds.length) return await copyAsk(node, mode === "mcp" ? "mcp" : "none", known)
      const run = await window.studio.startImportAssetGraphAnalysis({ id: id(), nodeIds })
      if (!disposed) setStory(run)
    } catch (cause) {
      if (!disposed && current()?.id === node.id) setStoryError(failure(cause))
    } finally {
      if (!disposed) setStoryBusy(false)
    }
  }
  createEffect(() => {
    if (!props.active || !["running", "awaiting_model"].includes(story()?.state ?? "")) return
    const timer = setTimeout(() => {
      void window.studio
        .getImportAssetGraphAnalysis({ id: id() })
        .then((run) => {
          if (!disposed) setStory(run)
        })
        .catch((cause: unknown) => {
          if (!disposed && storyMine()) setStoryError(failure(cause))
        })
    }, 3000)
    onCleanup(() => clearTimeout(timer))
  })

  const hover = (event: MouseEvent, title: string, lines: string[]) =>
    setTip({ x: event.clientX, y: event.clientY, title, lines })

  const SlotPicture = (slot: { node: GraphNode; large?: boolean }) => {
    let host!: HTMLSpanElement
    const [image, setImage] = createSignal<string | null>(null)
    createEffect(() => {
      const node = slot.node
      if (!props.active || !host) return
      let live = true
      const load = () =>
        void pictureOf(node).then((result) => {
          if (live) setImage(result)
        })
      if (slot.large || typeof IntersectionObserver === "undefined") {
        load()
        onCleanup(() => {
          live = false
        })
        return
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          observer.disconnect()
          load()
        },
        { rootMargin: "120px" },
      )
      observer.observe(host)
      onCleanup(() => {
        live = false
        observer.disconnect()
      })
    })
    return (
      <span ref={host} class="bp-picture" data-kind={slot.node.kind}>
        <Show when={image()} fallback={<PixelGlyph name={slot.node.kind} />}>
          <img src={image()!} alt="" draggable={false} />
          <Show when={slot.node.kind === "recipe" || slot.node.kind === "loot"}>
            <i class="bp-badge">
              <PixelGlyph name={slot.node.kind} />
            </i>
          </Show>
        </Show>
      </span>
    )
  }

  const Slot = (slot: { node: GraphNode; small?: boolean; maybe?: boolean }) => (
    <button
      type="button"
      class="bp-slot"
      classList={{ small: slot.small, faint: slot.node.metadata.available === false, maybe: slot.maybe }}
      onClick={() => show(slot.node)}
      onMouseMove={(event) =>
        hover(event, nameOf(slot.node), [
          kindOf(slot.node) + (slot.maybe ? " · 可能有关" : ""),
          ...(slot.node.resourceId ? [slot.node.resourceId] : []),
        ])
      }
      onMouseLeave={() => setTip(undefined)}
    >
      <span class="bp-cell mc-slot">
        <SlotPicture node={slot.node} />
      </span>
      <span class="bp-name">{nameOf(slot.node)}</span>
    </button>
  )

  /** One material or product: a small slot that leads to the thing when the mod has it. */
  const Part = (slot: { part: RecipePart; amount?: string; big?: boolean }) => {
    const info = createMemo(() => partInfo(slot.part))
    const [icon, setIcon] = createSignal<string | null>(null)
    createEffect(() => {
      const { node, item } = info()
      setIcon(null)
      if (node || !item || !props.active) return
      let live = true
      void gameIcon(item).then((result) => {
        if (live) setIcon(result)
      })
      onCleanup(() => {
        live = false
      })
    })
    const lines = () => {
      const { node, item } = info()
      return [
        slot.part.tag ? "这一类里的哪一种都行" : node ? kindOf(node) : item?.startsWith("minecraft:") ? "原版游戏里的东西" : "别的模组里的东西",
        ...(slot.part.others ? [`或其他 ${slot.part.others} 种`] : []),
        `${slot.part.tag ? "#" : ""}${slot.part.id}`,
      ]
    }
    return (
      <button
        type="button"
        class="bp-part mc-slot"
        classList={{ big: slot.big, still: !info().node }}
        aria-label={info().name}
        onClick={() => info().node && show(info().node!)}
        onMouseMove={(event) => hover(event, info().name, lines())}
        onMouseLeave={() => setTip(undefined)}
      >
        <Show
          when={info().node}
          fallback={
            <Show when={icon()} fallback={<span class="bp-letter">{info().name.replace(/^任意\s*/, "").slice(0, 2)}</span>}>
              <span class="bp-picture" data-kind="item">
                <img src={icon()!} alt="" draggable={false} />
              </span>
            </Show>
          }
          keyed
        >
          {(node) => <SlotPicture node={node} large />}
        </Show>
        <Show when={slot.amount}>
          <i class="bp-count">{slot.amount}</i>
        </Show>
      </button>
    )
  }
  const amountOf = (part: RecipePart) => (part.count > 1 ? String(part.count) : undefined)
  const Arrow = (arrow: { label?: string }) => (
    <span class="bp-arrow">
      <svg viewBox="0 0 22 15" shape-rendering="crispEdges" aria-hidden="true">
        <path d="M0 6h13V1h2v2h2v2h2v2h3v1h-3v2h-2v2h-2v2h-2V9H0z" />
      </svg>
      <Show when={arrow.label}>
        <small>{arrow.label}</small>
      </Show>
    </span>
  )
  /** In plain words: where a recipe is made and what to do there. */
  const recipeHow = (view: RecipeView) => {
    const time = view.seconds ? ` ${view.seconds} 秒` : ""
    if (view.layout === "grid")
      return view.station
        ? view.free
          ? `放进${view.station}，怎么摆都行`
          : `在${view.station}里照这样摆`
        : "照这样摆（这是模组自己的做法）"
    if (view.layout === "smithing") return "在锻造台上把它们合在一起"
    if (view.station === "营火") return `放在营火上烤${time}`
    if (view.station === "切石机") return "用切石机切出来"
    if (view.station) return `放进${view.station}烧${time}`
    return "这是模组自己的做法"
  }
  /** A recipe laid out the way the game shows it: materials, an arrow, the product. */
  const RecipePanel = (panel: { view: RecipeView; more?: number }) => (
    <section class="bp-related bp-recipe">
      <h4>
        怎么做
        <small>{recipeHow(panel.view)}</small>
      </h4>
      <div class="bp-craft">
        <Show
          when={panel.view.layout === "grid"}
          fallback={
            <div class="bp-craft-row">
              <For each={panel.view.inputs}>{(part) => <Part part={part} amount={amountOf(part)} />}</For>
            </div>
          }
        >
          <div class="bp-craft-grid" style={{ "--columns": panel.view.width }}>
            <For each={panel.view.cells}>
              {(part) => (
                <Show when={part} fallback={<span class="bp-part mc-slot blank" />}>
                  <Part part={part!} amount={amountOf(part!)} />
                </Show>
              )}
            </For>
          </div>
        </Show>
        <Show when={panel.view.result}>
          <Arrow label={panel.view.layout === "grid" ? undefined : panel.view.station} />
          <Part part={panel.view.result!} amount={amountOf(panel.view.result!)} big />
        </Show>
      </div>
      <p class="bp-needs">
        <Show when={panel.view.inputs.length}>
          <span>材料：{panel.view.inputs.map(partLabel).join("、")}</span>
        </Show>
        <Show when={panel.view.result}>
          <span>做出：{partLabel(panel.view.result!)}</span>
        </Show>
        <Show when={panel.view.layout === "smithing" && !panel.view.result}>
          <span>做出：带上纹饰的装备</span>
        </Show>
        <Show when={panel.more}>
          <span>还有 {panel.more} 种做法，在下面的「配方」里</span>
        </Show>
      </p>
    </section>
  )
  /** A fixed number sits on the slot like a stack count; a range is spelled out in words below. */
  const dropAmount = (drop: LootDrop) => (drop.min === drop.max && drop.max > 1 ? String(drop.max) : undefined)
  const dropLabel = (drop: LootDrop) =>
    partInfo(drop).name + (drop.min !== drop.max ? ` ${drop.min}～${drop.max} 个` : drop.max > 1 ? ` ×${drop.max}` : "")
  const DropsPanel = (panel: { drops: LootDrop[] }) => (
    <section class="bp-related bp-recipe">
      <h4>
        会掉落
        <small>{panel.drops.length} 种</small>
      </h4>
      <div class="bp-craft">
        <div class="bp-craft-row">
          <For each={panel.drops}>{(drop) => <Part part={drop} amount={dropAmount(drop)} />}</For>
        </div>
      </div>
      <p class="bp-needs">
        <span>{panel.drops.map(dropLabel).join("、")}</span>
      </p>
    </section>
  )

  const Card = (card: { node: GraphNode }) => {
    const [spin, setSpin] = createSignal(false)
    const [view, setView] = createSignal<ModelCanvasView>()
    const [sound, setSound] = createSignal<string>()
    const [busy, setBusy] = createSignal(false)
    const [trouble, setTrouble] = createSignal("")
    const [recipe, setRecipe] = createSignal<{ view: RecipeView | null; more: number; assetId: string }>()
    const [drops, setDrops] = createSignal<{ list: LootDrop[]; assetId: string }>()
    // A recipe or drop table shows what its file says; a thing shows how it is made, a creature what it drops.
    createEffect(() => {
      const node = card.node
      let live = true
      onCleanup(() => {
        live = false
      })
      const sources = (kind: "recipe" | "loot") =>
        node.kind === kind
          ? [node]
          : (index().incoming.get(node.id) ?? [])
              .map((edge) => index().nodeById.get(edge.from))
              .filter((other): other is GraphNode => other?.kind === kind && !!other.sourceAssetId)
              .sort((first, second) => (first.resourceId ?? "").length - (second.resourceId ?? "").length)
      const loot = node.kind === "loot" || node.kind === "entity" ? sources("loot")[0] : undefined
      if (loot?.sourceAssetId)
        void readJson(loot.sourceAssetId).then((json) => {
          const list = readLoot(json)
          if (!live || (!list.length && node.kind !== "loot")) return
          learnTags(list)
          setDrops({ list, assetId: loot.sourceAssetId! })
        })
      if (node.kind !== "recipe" && node.kind !== "item" && node.kind !== "block") return
      const makers = sources("recipe").slice(0, 6)
      void Promise.all(makers.map((maker) => readJson(maker.sourceAssetId ?? "").then(readRecipe))).then((views) => {
        if (!live || !makers.length) return
        // The file is named after the thing, which does not always mean it makes the thing.
        const fits = views.map((view) => node.kind === "recipe" || view?.result?.id === node.resourceId)
        const at = fits.findIndex((fit, index) => fit && views[index])
        if (at < 0 && node.kind !== "recipe") return
        const view = views[Math.max(at, 0)] ?? null
        if (view) learnTags([...view.inputs, view.result])
        setRecipe({ view, more: fits.filter(Boolean).length - 1, assetId: makers[Math.max(at, 0)]!.sourceAssetId! })
      })
    })
    /** A recipe file is often named after its method, not its product: the product is what the card shows. */
    const made = () => {
      const result = card.node.kind === "recipe" ? recipe()?.view?.result : undefined
      return result && !result.tag ? byResource().full.get(result.id) : undefined
    }
    /** What the card already shows, for a question to an AI. */
    const known = (): Known => {
      const view = recipe()?.view
      const list = drops()?.list ?? []
      return {
        title: made() ? `${nameOf(made()!)}的配方` : nameOf(card.node),
        lines: [
          ...(view?.inputs.length ? [`做法：${recipeHow(view)}。材料：${view.inputs.map(partLabel).join("、")}`] : []),
          ...(view?.result && card.node.kind === "recipe" ? [`做出：${partLabel(view.result)}`] : []),
          ...(list.length ? [`会掉落：${list.map(dropLabel).join("、")}`] : []),
        ],
        files: [
          ...(recipe() ? [{ label: "配方", assetId: recipe()!.assetId }] : []),
          ...(drops() ? [{ label: "掉落表", assetId: drops()!.assetId }] : []),
        ],
      }
    }
    const canAskHere = () => aiMode() === "direct" && standIns(card.node).length > 0
    const model = () => assetOf(modelOf(card.node))
    /** Why a creature has no picture, or what is uncertain about the one shown. */
    const note = () => {
      const entry = card.node.kind === "entity" ? being().get(card.node.resourceId ?? "") : undefined
      if (!entry) return ""
      if (entry.kind === "none" || entry.partial) return entry.note ?? ""
      return entry.matchedByName ? "这个样子是按名字对上的，不一定就是游戏里用的那一个。" : ""
    }
    const shape = () => shaped(card.node)
    const turn = async () => {
      const asset = model()
      const entry = shape()
      if ((!asset && !entry) || busy()) return
      setBusy(true)
      try {
        const result = entry
          ? await window.studio.previewImportedEntity({ id: id(), entity: entry.entity })
          : await window.studio.previewImportedAsset({ id: id(), assetId: asset!.id })
        if (result.model)
          setView({ model: result.model, preview: result.preview as Preview | null, blockbench: result.blockbench })
        else setTrouble("它没有可以转动的立体形状，只能看图标。")
        setSpin(!!result.model)
      } catch (cause) {
        // Most often a shape that builds on the game's own models, with no copy of the game on this computer.
        setTrouble(
          /assets\/minecraft\//.test(failure(cause))
            ? "它的立体形状要用到原版游戏文件，这台电脑上没有找到。图标仍然是它在物品栏里的样子。"
            : "这个立体形状没能打开。",
        )
      } finally {
        setBusy(false)
      }
    }
    createEffect(() => {
      const asset = card.node.kind === "audio" ? assetOf(card.node) : assetOf(linked(card.node, "plays_sound"))
      if (!asset || (card.node.kind !== "audio" && card.node.kind !== "sound")) return
      let live = true
      void window.studio
        .readImportedAssetFile({ id: id(), assetId: asset.id })
        .then((file) => {
          if (!live || file.encoding !== "base64" || file.truncated) return
          const mime = safeAudioMime(asset.path, file.content)
          if (mime) setSound(`data:${mime};base64,${file.content}`)
        })
        .catch(() => undefined)
      onCleanup(() => {
        live = false
      })
    })
    return (
      <div class="bp-card mc-window" role="dialog" aria-modal="true" aria-label={nameOf(card.node)}>
        <header class="bp-card-head">
          <Show when={trail().length > 1}>
            <button type="button" class="bp-mini" onClick={() => setTrail((value) => value.slice(0, -1))}>
              ← 返回
            </button>
          </Show>
          <strong>{made() ? nameOf(made()!) : nameOf(card.node)}</strong>
          <button type="button" class="bp-mini" aria-label="关闭" onClick={close}>
            ✕
          </button>
        </header>
        <div class="bp-card-body">
          <div class="bp-card-look">
            <div class="bp-stage mc-slot" classList={{ live: spin() }}>
              <Show when={spin() && view()} fallback={<SlotPicture node={made() ?? card.node} large />}>
                <ModelCanvas view={view()!} mode="model" modes={["model"]} />
              </Show>
            </div>
            <Show when={(model() || shape()) && !spin()}>
              <Button disabled={busy()} onClick={() => void turn()}>
                {busy() ? "正在打开…" : "转一转看看"}
              </Button>
            </Show>
            <Show when={spin()}>
              <Button onClick={() => setSpin(false)}>回到图标</Button>
            </Show>
            <Show when={trouble() || note()}>
              <p class="bp-hint">{trouble() || note()}</p>
            </Show>
            <Show when={sound()}>
              <ImportedAudioPlayer src={sound()!} active={props.active} />
            </Show>
          </div>
          <div class="bp-card-info">
            <p class="bp-kind">
              <span>{kindOf(card.node)}</span>
              <For each={facts()}>{(line) => <span>{line}</span>}</For>
            </p>
            <Show when={card.node.resourceId}>
              <p class="bp-id">{card.node.resourceId}</p>
            </Show>
            <Show when={recipe()}>
              {(found) => (
                <Show
                  when={found().view}
                  fallback={<p class="bp-hint">这个配方是模组按自己的规则做的，这里画不出来。</p>}
                >
                  <RecipePanel view={found().view!} more={found().more} />
                </Show>
              )}
            </Show>
            <Show when={drops()}>
              {(found) => (
                <Show when={found().list.length} fallback={<p class="bp-hint">没有找到它会掉什么东西。</p>}>
                  <DropsPanel drops={found().list} />
                </Show>
              )}
            </Show>
            <For each={storyEntries()}>
              {(item) => (
                <div class="bp-story mc-well">
                  <Show when={item.about}>
                    <p class="bp-story-about">{item.about}</p>
                  </Show>
                  <p>{item.entry.summary}</p>
                  <For each={item.entry.facts}>{(fact) => <p>· {fact.text}</p>}</For>
                </div>
              )}
            </For>
            <Show when={!storyEntries().length}>
              <div class="bp-ask">
                <Button disabled={storyRunning()} onClick={() => void tell(card.node, known())}>
                  {canAskHere() ? (storyRunning() ? "AI 正在看它…" : "让 AI 讲讲它") : "复制提问，去问 AI"}
                </Button>
                <Show when={said() && !said()!.prompt}>
                  <small role="status">{said()!.note}</small>
                </Show>
              </div>
            </Show>
            <Show when={said()?.prompt}>
              <p class="bp-hint">{said()!.note}</p>
              <textarea
                class="bp-ask-text mc-well"
                readOnly
                rows={6}
                aria-label="给 AI 的提问"
                value={said()!.prompt}
                onFocus={(event) => event.currentTarget.select()}
              />
            </Show>
            <Show when={storyError() || (story()?.state === "failed" && storyMine() && story()?.error)}>
              <p class="bp-error">{storyError() || story()!.error}</p>
            </Show>
            <div class="bp-relations">
              <For each={relations()}>
                {(group) => (
                  <section class="bp-related">
                    <h4>
                      {group.label}
                      <small>{group.items.length}</small>
                    </h4>
                    <div class="bp-related-grid">
                      <For each={group.items.slice(0, 24)}>
                        {(item) => <Slot node={item.node} small maybe={item.maybe} />}
                      </For>
                      <Show when={group.items.length > 24}>
                        <span class="bp-more-note">还有 {group.items.length - 24} 个</span>
                      </Show>
                    </div>
                  </section>
                )}
              </For>
            </div>
            <Show when={!relations().length && !recipe()?.view && !drops()?.list.length}>
              <p class="bp-hint">它没有和别的东西连在一起。</p>
            </Show>
            <Show when={props.advanced && card.node.sourceAssetId}>
              <button type="button" class="bp-link" onClick={() => props.onOpenFile(card.node.sourceAssetId!)}>
                在文件里打开
              </button>
            </Show>
          </div>
        </div>
      </div>
    )
  }

  const steps: Record<"loading" | "unpacking" | "sorting", string> = {
    loading: "正在打开背包…",
    unpacking: "正在把模组里的东西拿出来…",
    sorting: "正在整理：生物、方块、物品各归各位…",
  }
  const busyText = (): JSX.Element => {
    const value = stage()
    return value === "choose" || value === "ready" ? null : steps[value]
  }

  return (
    <section class="import-backpack" aria-label="模组背包">
      <Show when={stage() !== "ready" && stage() !== "choose"}>
        <div class="bp-loading mc-window" role="status">
          <strong>{busyText()}</strong>
          <span class="bp-bar">
            <i />
          </span>
          <small>第一次打开会久一点，之后就是秒开。</small>
        </div>
      </Show>
      <Show when={stage() === "choose"}>
        <div class="bp-choose mc-window">
          <header>
            <strong>这个包里有 {selection()?.groups.length ?? 0} 份东西，想看哪些？</strong>
            <small>东西很多的整合包建议先挑几个感兴趣的，之后随时可以再加。</small>
          </header>
          <Show when={error()}>
            <p class="bp-error" role="alert">
              {error()}
            </p>
          </Show>
          <Show
            when={selection()?.groups.length}
            fallback={<p class="bp-hint">这个文件里没有找到可以看的东西。</p>}
          >
            <div class="bp-choose-list">
              <For each={selection()!.groups}>
                {(group) => (
                  <label class="bp-choose-item" classList={{ on: chosen().includes(group.id) }}>
                    <input
                      type="checkbox"
                      checked={chosen().includes(group.id)}
                      onChange={(event) =>
                        setChosen((value) =>
                          event.currentTarget.checked
                            ? [...new Set([...value, group.id])]
                            : value.filter((entry) => entry !== group.id),
                        )
                      }
                    />
                    <span class="bp-cell mc-slot">
                      <PixelGlyph name={group.kind === "mod" ? "mod" : "recipe"} />
                    </span>
                    <span>
                      <strong title={group.name}>{group.name}</strong>
                      <small>{group.kind === "mod" ? "模组" : "整合包作者自己加的东西"}</small>
                    </span>
                  </label>
                )}
              </For>
            </div>
            <footer>
              <button
                type="button"
                class="bp-link"
                onClick={() =>
                  setChosen(
                    chosen().length === selection()!.groups.length ? [] : selection()!.groups.map((group) => group.id),
                  )
                }
              >
                {chosen().length === selection()!.groups.length ? "全部不选" : "全选"}
              </button>
              <span>已选 {chosen().length} 份</span>
              <Show when={catalog()}>
                <Button onClick={() => setStage("ready")}>先不改了</Button>
              </Show>
              <Button primary disabled={!chosen().length} onClick={() => void unpack(chosen())}>
                放进背包
              </Button>
            </footer>
          </Show>
        </div>
      </Show>
      <Show when={stage() === "ready"}>
        <div class="bp-chest mc-window">
          <header class="bp-top">
            <div class="bp-tabs" role="tablist" aria-label="背包分类">
              <For each={shownTabs()}>
                {(entry) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab() === entry.id}
                    onClick={() => {
                      setTab(entry.id)
                      setVisible(pageSize)
                    }}
                  >
                    <PixelGlyph name={entry.glyph} />
                    <span>{entry.label}</span>
                    <small>{entry.count}</small>
                  </button>
                )}
              </For>
            </div>
            <input
              class="bp-search"
              type="search"
              aria-label="在背包里搜索"
              placeholder="搜索名字…"
              value={query()}
              onInput={(event) => {
                setQuery(event.currentTarget.value)
                setVisible(pageSize)
              }}
            />
          </header>
          <div class="bp-grid-wrap">
            <Show
              when={total() > 0}
              fallback={
                <p class="bp-empty">
                  {shownTabs().length ? "这里没有找到叫这个名字的东西。" : "背包是空的：这个模组里没有找到生物、方块或物品。"}
                </p>
              }
            >
              <div class="bp-grid">
                <Show
                  when={tab() === "mods"}
                  fallback={<For each={filtered().slice(0, visible())}>{(node) => <Slot node={node} />}</For>}
                >
                  <For each={filteredMods().slice(0, visible())}>
                    {(mod) => (
                      <button
                        type="button"
                        class="bp-slot"
                        onClick={() => {
                          setTip(undefined)
                          setOpenMod(mod)
                        }}
                        onMouseMove={(event) =>
                          hover(event, mod.name ?? mod.id ?? "没有名字的模组", [mod.version ?? "版本未知"])
                        }
                        onMouseLeave={() => setTip(undefined)}
                      >
                        <span class="bp-cell mc-slot">
                          <span class="bp-picture">
                            <PixelGlyph name="mod" />
                          </span>
                        </span>
                        <span class="bp-name">{mod.name ?? mod.id ?? "没有名字的模组"}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
              <Show when={visible() < total()}>
                <button type="button" class="bp-more" onClick={() => setVisible(visible() + pageSize)}>
                  再看 {Math.min(pageSize, total() - visible())} 个（还有 {total() - visible()} 个）
                </button>
              </Show>
            </Show>
          </div>
          <footer class="bp-foot">
            <span>共 {total()} 样 · 点一下格子看详情</span>
            <Show when={(selection()?.groups.length ?? 0) > 1}>
              <button type="button" class="bp-link" onClick={() => setStage("choose")}>
                换一批东西
              </button>
            </Show>
          </footer>
        </div>
      </Show>
      <Show when={current() || openMod()}>
        <div class="bp-veil" onClick={(event) => event.target === event.currentTarget && close()}>
          <Show when={current()} keyed>
            {(node) => <Card node={node} />}
          </Show>
          <Show when={openMod()}>
            {(mod) => (
              <div class="bp-card bp-mod-card mc-window" role="dialog" aria-modal="true">
                <header class="bp-card-head">
                  <strong>{mod().name ?? mod().id ?? "没有名字的模组"}</strong>
                  <button type="button" class="bp-mini" aria-label="关闭" onClick={close}>
                    ✕
                  </button>
                </header>
                <div class="bp-card-body">
                  <div class="bp-card-look">
                    <div class="bp-stage mc-slot">
                      <span class="bp-picture">
                        <PixelGlyph name="mod" />
                      </span>
                    </div>
                  </div>
                  <div class="bp-card-info">
                    <p class="bp-kind">
                      <span>模组</span>
                      <span>版本 {mod().version ?? "未知"}</span>
                      <span>{mod().loader}</span>
                    </p>
                    <Show when={mod().id}>
                      <p class="bp-id">{mod().id}</p>
                    </Show>
                    <p class="bp-hint">想看它里面的生物、方块和物品，点下面「换一批东西」把它放进背包。</p>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>
      <Show when={tip()}>
        {(value) => (
          <div
            class="bp-tip mc-tooltip"
            style={{
              left: `${Math.min(value().x + 16, window.innerWidth - 280)}px`,
              top: `${Math.min(value().y + 12, window.innerHeight - 90)}px`,
            }}
          >
            <strong>{value().title}</strong>
            <For each={value().lines}>{(line) => <span>{line}</span>}</For>
          </div>
        )}
      </Show>
    </section>
  )
}

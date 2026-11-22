import { abilityUsers } from "@minemods/mod-core/ability-usage"
import { casterLine } from "@minemods/mod-core/ability-casters"
import { kindLabel } from "../words"
import { supersededSound } from "./sound-placeholder"
import { thingName } from "../words"
import { motionNamer } from "./asset-words"
import { creatureMoves } from "@minemods/mod-core/combat-design"
import { focusSound } from "./sound-focus"
import { NewAudioDialog } from "./new-audio-dialog"
import { ProjectImportDialog } from "./project-import-dialog"
import type { StudioView } from "../../api"
import { particleSource } from "./particle-image"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { cachedOverview, overviewKey, readOverview } from "./overview-cache"
import { Portal } from "solid-js/web"
import type { Project } from "@minemods/mod-core/project"
import type { ConceptionEntry } from "@minemods/mod-core/conception"
import { Button, Icon } from "../ui"
import { MODULES, type ModuleKind } from "@minemods/mod-core/workspace-modules"
import type { WorkspaceAsset } from "@minemods/mod-core/workspace"
import type { OverviewItem, OverviewStatus, ProjectOverview } from "../../api"
import { pictureOf } from "./asset-picture"
import { TilePicture } from "./asset-preview"
import { CardShell, StatusMark } from "./project-assets"
import { assetChip, canAdd, categoryDesignNote, mcpAddSentence, nonemptyGroups, usersOf } from "./project-navigation-model"
import { WORDS } from "../words"
import "./project-navigation.css"

/** The runtime rules asset (health, spawn, drops…) that belongs to a creature, if one was made. */
export function entityRuntimeAsset(project: Project, entityId: string) {
  return project.workspace.assets.find(
    (asset) => asset.module === "entity" && asset.document?.kind === "entity" && asset.document.model_asset_id === entityId,
  )
}

/** The creature a runtime rules asset belongs to. */
export function runtimeAssetEntity(project: Project, asset: WorkspaceAsset) {
  if (asset.module !== "entity" || asset.document?.kind !== "entity") return undefined
  const id = asset.document.model_asset_id
  return project.entities.find((entity) => entity.id === id)
}

type Row =
  | { type: "entity"; id: string; title: string; ready: boolean; runtime?: WorkspaceAsset; search: string }
  | { type: "asset"; id: string; title: string; asset: WorkspaceAsset }
  | { type: "entry"; id: string; title: string; entry: ConceptionEntry; runtime: boolean }
  | { type: "overview"; id: string; title: string; item: OverviewItem }

type Glyph = Parameters<typeof Icon>[0]["name"]
type Tile = Pick<OverviewItem, "id" | "asset_id" | "kind" | "preview">
/** What a slot shows of its thing: where its picture comes from and how it stands, in the overview's own words. */
type Look = { tile: Tile | null; kind: ModuleKind; status: OverviewStatus; label: string; reason: string | null }
type Tip = { x: number; y: number; row: Row }

// Only until the overview has answered: the words it uses for a saved thing and for one not made yet.
const UNREAD = { saved: "已保存", planned: "还没做" } as const

type Group = {
  id: string
  label: string
  icon: Parameters<typeof Icon>[0]["name"]
  modules: ModuleKind[]
  kinds: ConceptionEntry["kind"][]
  create: keyof typeof addTiles
  collapsed?: boolean
}

// The tree keeps its own grouping (a creature is one row, parts are tucked away); names and icons of
// single-kind groups come from the asset registry so they cannot drift from the rest of the app.
const single = (kind: Exclude<keyof typeof addTiles, "worldview" | "gameplay" | "model">, kinds: ConceptionEntry["kind"][], label: string = kindLabel(kind, MODULES[kind].label)): Group => ({
  id: kind,
  label,
  icon: MODULES[kind].glyph,
  modules: [kind],
  kinds,
  create: kind,
})
const parts: ModuleKind[] = ["model", "texture", "animation"]

const groups: Group[] = [
  single("entity", []),
  single("block", ["block"]),
  single("item", ["item"]),
  single("recipe", ["recipe"]),
  {
    id: "world",
    label: "世界",
    icon: "world",
    modules: ["worldview", "biome", "dimension", "terrain"],
    kinds: ["worldview", "biome", "dimension"],
    create: "worldview",
  },
  // One family for everything that is behaviour: gameplay an AI wrote as code first, then the older trigger rules.
  {
    id: "play",
    label: MODULES.gameplay.label,
    icon: MODULES.gameplay.glyph,
    modules: ["gameplay", "logic"],
    kinds: [],
    create: "gameplay",
  },
  single("gesture", [], "玩家动作"),
  single("effect", []),
  single("sound", []),
  single("music", []),
  // Boss 能力 11: the project's own particles, beside the effects its abilities show.
  single("particle", []),
  // Boss 能力 6 and 12: a boss's own bar and the fixtures its arena sets out. Left out when the kinds were added, so a blueprint's bar and fixtures were nowhere in the
  // column (the 蚩尤 run of 2026-11-15: 「打算做 18 样」 counted a bronze bar and four compass carts the column did not show).
  single("bossbar", []),
  single("fixture", []),
  // 技能资产: an ability an item, a block or a key casts, and creatures share. Without its own group a saved one was nowhere in the column.
  single("ability", []),
  // 书: a book the player is given and reads.
  single("book", []),
  {
    id: "parts",
    label: "模型素材",
    icon: MODULES.texture.glyph,
    modules: parts,
    kinds: [],
    create: "model",
    collapsed: false,
  },
]

const addTiles = {
  entity: { icon: "entity", detail: "会走动、有动作和行为的生物。" },
  block: { icon: "cube", detail: "能搭建、挖掘或放在地上的方块。" },
  item: { icon: "item", detail: "可以拿在手里或放进背包的东西。" },
  recipe: { icon: "recipe", detail: "规定用哪些材料能做出一样东西。" },
  worldview: { icon: "world", detail: "写下世界的设定和想做的地方。" },
  gameplay: { icon: "logic", detail: "规定什么时候发生什么事。" },
  gesture: { icon: "gesture", detail: "玩家施法时手和身体怎么动。" },
  effect: { icon: "effect", detail: "游戏里可看到的光、烟或冲击波。" },
  sound: { icon: "sound", detail: "走路、吼叫或碰撞时发出的声音。" },
  music: { icon: "music", detail: "战斗或演出时听到的曲子。" },
  particle: { icon: "particle", detail: "一小团会飘的图，例如火星或烟。" },
  bossbar: { icon: "bossbar", detail: "战斗时显示 Boss 血量的进度条。" },
  fixture: { icon: "fixture", detail: "战斗场地里的机关或装饰。" },
  ability: { icon: "biome", detail: "可由生物或物品施放的一招。" },
  book: { icon: "document", detail: "开局送给玩家的一本书：说明书、图鉴或任务手册。" },
  model: { icon: "texture", detail: "存放模型、贴图，以及模型自己的动作。" },
} satisfies Partial<Record<ModuleKind, { icon: Glyph; detail: string }>>

/**
 * One tree for everything in the project. Buildable assets and design drafts of the same kind
 * sit in the same group; the chip says which ones will actually go into the game.
 */
export function ProjectNavigation(props: {
  project: Project
  entries: ConceptionEntry[]
  page: string
  entryId: string | null
  entityId?: string | null
  assetId: string | null
  external?: boolean
  compact?: boolean
  onToggle: () => void
  onInspect: (id: string) => void
  /** The project has something on the older 「模组构想」 route and the person asked for 高级: its one way in is shown. */
  legacy?: boolean
  onAsset: (asset: WorkspaceAsset) => void
  onAudioSaved: (view:StudioView,id:string)=>void
  onNewAsset: (module: ModuleKind) => void
  onNewEntity: () => void
  onNavigate: (page: "overview" | "conception" | "commands" | "info") => void
  onEntry: (entry: ConceptionEntry) => void
  onEntity: (id: string) => void
}) {
  const [query, setQuery] = createSignal("")
  const [closed, setClosed] = createSignal<Record<string, boolean>>(
    Object.fromEntries(groups.filter((group) => group.collapsed).map((group) => [group.id, true])),
  )
  const runtimeIds = () =>
    new Set([
      ...props.project.blocks.map((value) => value.id),
      ...props.project.items.map((value) => value.id),
      ...props.project.recipes.map((value) => value.id),
    ])
  const musicSearch = () => !!query().trim() && "背景音乐".includes(query().trim())
  const musicOwners = createMemo(() => musicSearch() ? props.project.entities.flatMap((entity) => {
    const runtime = entityRuntimeAsset(props.project, entity.id)
    return runtime?.document.kind === "entity" && runtime.document.boss ? [{ entity, runtime }] : []
  }) : [])
  const rows = (group: Group): Row[] => {
    const entities: Row[] =
      group.id === "entity"
        ? props.project.entities.map((entity) => {
            const runtime = entityRuntimeAsset(props.project, entity.id)
            const model = query().trim() ? props.project.workspace.assets.find(a=>a.id===entity.id)?.document : null
            const doc = runtime?.document.kind==="entity" ? runtime.document : entity
            const motion = model?.kind==="model" ? motionNamer(props.project,entity.id) : null
            const names = query().trim() ? [...creatureMoves(doc,props.project.workspace).map(a=>a.name),...(doc.combos ?? []).map(c=>c.name),
              ...(doc.shared_abilities ?? []).map(u=>props.project.workspace.assets.find(a=>a.id===u.asset)?.title),
              ...(model?.kind==="model" ? model.animations.map(a=>a.display_name || motion!(a.name)) : [])] : []
            return {
              type: "entity",
              id: entity.id,
              title: thingName(runtime) ?? entity.name,
              ready: !!entity.model_asset_id,
              runtime,
              search: [entity.name,runtime?.title,...names].join(" "),
            }
          })
        : []
    // A creature's runtime rules open from the creature itself, so they are not listed twice.
    const assets: Row[] = props.project.workspace.assets
      .filter((asset) => group.modules.includes(asset.module))
      .filter((asset) => !runtimeAssetEntity(props.project, asset))
      .sort((left, right) => group.modules.indexOf(left.module) - group.modules.indexOf(right.module))
      .map((asset) => ({ type: "asset", id: asset.id, title: thingName(asset), asset }))
    const entries: Row[] = props.entries
      .filter((entry) => group.kinds.includes(entry.kind))
      .filter(
        (entry) =>
          !props.project.workspace.assets.some((asset) => asset.id === entry.id && asset.module === entry.kind),
      )
      // A draft of the older 「模组构想」 route is never built, so it is no thing of the mod: it stays behind that route's own entry.
      .filter((entry) => runtimeIds().has(entry.id))
      .map((entry) => ({ type: "entry", id: entry.id, title: entry.title, entry, runtime: true }))
    const needle = query().trim().toLowerCase()
    const existing = [...entities, ...assets, ...entries]
    const planned: Row[] = items().filter((item) => group.modules.includes(item.kind) && !supersededSound(props.project, item))
      .filter((item) => !existing.some((row) => item.asset_id === row.id || item.id === row.id || item.id === `${group.create}:${row.id}` || item.preview.entity_id === row.id))
      .map((item) => ({ type: "overview", id: item.id, title: item.title, item }))
    return [...existing, ...planned].filter(
      (row) => !needle || group.label.includes(needle) || (group.id === "music" && musicSearch()) || (row.type === "entity" ? row.search : row.type === "asset" && row.asset.document.kind === "sound"
        ? [row.title, row.asset.document.name, row.asset.document.subtitle?.zh, row.asset.document.subtitle?.en].join(" ")
        : row.title).toLowerCase().includes(needle),
    )
  }
  const active = (row: Row) =>
    row.type === "overview" ? false : row.type === "entity"
      ? (props.entityId === row.id && ["model", "texture", "animation", "behavior"].includes(props.page)) ||
        (props.page === "asset" && !!row.runtime && props.assetId === row.runtime.id)
      : row.type === "asset"
        ? props.page === "asset" && props.assetId === row.id
        : props.page === "entry" && props.entryId === row.id
  const open = (row: Row) => {
    if (row.type === "entity") return props.onEntity(row.id)
    const item = itemOf(row)
    if (item) return props.onInspect(item.id)
    if (row.type === "asset") return props.onAsset(row.asset)
    if (row.type === "entry") props.onEntry(row.entry)
  }
  const chip = (row: Row) => {
    const doc=row.type==="asset"?row.asset.document:row.type==="overview" && row.item.kind==="particle"?props.project.workspace.assets.find(a=>a.id===row.item.asset_id)?.document:null
    if(doc?.kind==="particle")return particleSource(doc)
    if (row.type === "entity") return row.ready ? "" : "待建模"
    if (row.type === "asset") {
      const document = row.asset.document
      return assetChip(row.asset, id => document.kind === "ability" ? abilityUsers(props.project, id, document) : usersOf(state.overview, id), props.project.target)
    }
    if (row.type === "overview") return row.item.facts.saved ? "" : "还没做"
    return row.runtime ? "" : "设计稿"
  }
  // The same overview the 模组总览 page reads: it says how each thing stands and where its picture comes from.
  const state = { get overview() { return cachedOverview(overviewKey(props.project.id, props.project.revision)) } }
  const load = (refresh = false) => readOverview(props.project.id, props.project.revision, refresh).catch(() => undefined)
  // By value: the project is read off a view that is new at every save, and the marks must not blink away with each one.
  createEffect(on(createMemo(() => overviewKey(props.project.id, props.project.revision)), () => void load()))
  // While things are being made, and on the page where they are judged, the marks keep up by themselves.
  createEffect(() => {
    const delay = !state.overview || state.overview.production.running || props.external ? 2500 : 0
    if (!delay) return
    const timer = window.setInterval(() => void load(true), delay)
    onCleanup(() => window.clearInterval(timer))
  })
  const items = () => state.overview?.items ?? []
  const itemOf = (row: Row) => {
    if (row.type === "overview") return row.item
    if (row.type === "asset") return items().find((item) => item.asset_id === row.id)
    if (row.type === "entry") return items().find((item) => item.id === `${row.entry.kind}:${row.id}`)
    // A creature is its rules asset, or its record from before assets existed, or (sharing its id) its model.
    return (
      items().find((item) => !!row.runtime && item.asset_id === row.runtime.id) ??
      items().find((item) => item.id === `entity:${row.id}`) ??
      items().find((item) => item.asset_id === row.id) ??
      items().find((item) => item.kind === "entity" && item.preview.entity_id === row.id)
    )
  }
  const look = (row: Row): Look => {
    const kind: ModuleKind = row.type === "entity" ? "entity" : row.type === "asset" ? row.asset.module : row.type === "overview" ? row.item.kind : row.entry.kind
    const item = itemOf(row)
    if (item) return { tile: item, kind, status: item.status, label: item.status_label, reason: item.reason }
    // Not in the overview (yet): drawn from the project itself, and said to be saved, which is all that is known.
    const preview = { source: null, model_asset_id: null, texture_asset_id: null, entity_id: null }
    const tile: Tile | null =
      row.type === "asset"
        ? { id: row.id, asset_id: row.id, kind, preview: { ...preview, source: "asset", model_asset_id: kind === "model" ? row.id : null } }
        : row.type === "entity" && row.ready
          ? { id: `entity:${row.id}`, asset_id: null, kind, preview: { ...preview, source: "content", entity_id: row.id } }
          : row.type === "entry" && row.runtime
            ? { id: `${kind}:${row.id}`, asset_id: null, kind, preview: { ...preview, source: "content" } }
            : null
    const status = tile ? "saved" : "planned"
    return { tile, kind, status, label: UNREAD[status], reason: null }
  }
  const picture = (row: Row) => {
    const tile = look(row).tile
    return tile ? pictureOf(props.project.id, props.project, items(), tile, true) : null
  }
  const listed = createMemo(() => new Map(groups.map((group) => [group.id, rows(group)])))
  const rowsOf = (group: Group) => listed().get(group.id) ?? []
  const visibleGroups = () => nonemptyGroups(groups, rowsOf, group => group.id === "music" && (!query().trim() || musicSearch()))
  const add = (group: Group) => (group.create === "entity" ? props.onNewEntity() : props.onNewAsset(group.create))
  const [tip, setTip] = createSignal<Tip>()
  const [adding, setAdding] = createSignal(false)
  const [importing, setImporting] = createSignal(false)
  const [audioKind,setAudioKind] = createSignal<"sound"|"music"|null>(null)
  const [telling, setTelling] = createSignal<{ label: string } | null>(null)
  const [wish, setWish] = createSignal("")
  const [copied, setCopied] = createSignal(false)
  const addWord = (group: Group) => (group.id === "world" ? "世界（设计稿）" : group.label)
  // Everything in the window can be pressed and has a result: what cannot be filled in here is handed to the outside AI in a sentence ready to copy.
  const pick = (group: Group) => {
    setAdding(false)
    if (group.create === "sound" || group.create === "music") return setAudioKind(group.create)
    if (canAdd(group.create, !!props.external)) return add(group)
    setWish("")
    setCopied(false)
    setTelling({ label: addWord(group) })
  }
  const sentence = () => mcpAddSentence(props.project.name, telling()?.label ?? "", wish())
  const [copyFailed, setCopyFailed] = createSignal(false)
  const copySentence = async () => {
    setCopyFailed(false)
    await window.studio.copyText({ text: sentence() }).then(() => setCopied(true), () => setCopyFailed(true))
  }
  const said = (row: Row) => [kindLabel(look(row).kind, MODULES[look(row).kind].label), look(row).label, chip(row)].filter(Boolean).join("，")
  let host: HTMLElement | undefined
  return (
    <>
      <Show when={props.compact}>
        <button class="nav-link shelf-expand" aria-label="展开左栏" title="展开左栏" onClick={props.onToggle}><Icon name="arrow" /></button>
      </Show>
      <label class="tree-search">
        <Icon name="search" />
        <input
          aria-label="搜索工程里的东西"
          placeholder="搜索全部东西"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <nav aria-label="工程里的东西" ref={host} onScroll={() => setTip()}>
        <button
          class={`nav-link ${props.page === "overview" ? "active" : ""}`}
          aria-current={props.page === "overview" ? "page" : undefined}
          onClick={() => props.onNavigate("overview")}
        >
          <Icon name="home" />
          工程总览
        </button>
        <button
          class={`nav-link ${props.page === "commands" ? "active" : ""}`}
          aria-current={props.page === "commands" ? "page" : undefined}
          onClick={() => props.onNavigate("commands")}
        >
          <Icon name="clock" />
          {WORDS.floor}
        </button>
        <Show when={state.overview} fallback={<p role="status">正在读…</p>}>
        <Show when={query().trim() && !visibleGroups().length}><p>没有找到符合的东西。</p></Show>
        <For each={visibleGroups()}>
          {(group) => (
            <section class="tree-section inv-section" aria-label={group.label}>
              <div class="tree-heading">
                <button
                  type="button"
                  class="tree-toggle"
                  aria-expanded={!closed()[group.id] || !!query().trim()}
                  onClick={() => setClosed({ ...closed(), [group.id]: !closed()[group.id] })}
                >
                  <Icon name={group.icon} />
                  <span>{group.label}</span>
                  <small>{group.id === "sound" ? `${rowsOf(group).length} 条` : rowsOf(group).length}</small>
                </button>
              </div>
              {/* Nothing of a design-only category is ever built: said once on the category, quietly. */}
              <Show when={categoryDesignNote(group.modules, props.project.target)}>{(note) => <p class="inv-design">{note()}</p>}</Show>
              {/* A category with nothing in it is its header alone; what it lacks is read out, not drawn. */}
              <Show when={!rowsOf(group).length && group.id !== "music"}>
                <span class="inv-none">{query() ? "没有找到" : `还没有${group.label}`}</span>
              </Show>
              <Show when={group.id === "music" && !rowsOf(group).length && (!closed()[group.id] || musicSearch())}>
                <button class="nav-link" type="button" onClick={() => pick(group)}>还没有音乐 · 添加曲子</button>
              </Show>
              <Show when={group.id === "music" && musicOwners().length}>
                <For each={musicOwners()}>{({ entity, runtime }) => (
                  <button class="nav-link" onClick={() => {
                    focusSound({ entity: entity.id, key: "boss.music", edit: false })
                    props.onAsset(runtime)
                  }}>{thingName(runtime)}的背景音乐</button>
                )}</For>
              </Show>
              <Show when={rowsOf(group).length && (props.compact || !closed()[group.id] || !!query().trim())}>
                <div class="inv-grid">
                  <For each={rowsOf(group)}>
                    {(row) => (
                      <button
                        type="button"
                        class="inv-slot"
                        classList={{ active: active(row), ghost: look(row).status === "planned" }}
                        data-kind={look(row).kind}
                        data-item={itemOf(row)?.id}
                        data-status={look(row).status}
                        aria-current={active(row) ? "page" : undefined}
                        aria-label={`${row.title}，${said(row)}`}
                        onClick={() => open(row)}
                        onMouseMove={(event) => setTip({ x: event.clientX + 14, y: event.clientY + 12, row })}
                        onMouseLeave={() => setTip()}
                        onFocus={(event) => {
                          if (!event.currentTarget.matches(":focus-visible")) return
                          const box = event.currentTarget.getBoundingClientRect()
                          setTip({ x: box.right + 6, y: box.top, row })
                        }}
                        onBlur={() => setTip()}
                      >
                        <span class="inv-cell mc-slot">
                          <TilePicture picture={picture(row)} glyph={MODULES[look(row).kind].glyph as Glyph} />
                          <Show when={look(row).status === "making"}>
                            <i class="inv-working" aria-hidden="true" />
                          </Show>
                          <Show when={chip(row)}>
                            <em class="inv-chip">{chip(row)}</em>
                          </Show>
                          <StatusMark status={look(row).status} label={look(row).label} />
                        </span>
                        <span class="inv-name">{row.title}{row.type === "asset" && row.asset.document.kind === "ability" && <small>{casterLine(row.asset.document)}</small>}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          )}
        </For>
        {/* Last and quiet: nothing written there reaches the game, and a project without any of it never sees the entry. */}
        </Show>
        <Show when={props.legacy}>
          <button
            class={`nav-link nav-legacy ${props.page === "conception" ? "active" : ""}`}
            aria-current={props.page === "conception" ? "page" : undefined}
            onClick={() => props.onNavigate("conception")}
          >
            <Icon name="document" />
            {WORDS.legacy}
          </button>
        </Show>
      </nav>
      <div class="shelf-actions">
        <button class="nav-link" aria-label="加一样东西" onClick={() => setAdding(true)}><Icon name="plus" /><Show when={!props.compact}>加一样东西</Show></button>
        <Show when={!props.compact}><button class="nav-link" onClick={props.onToggle}>收起左栏</button></Show>
      </div>
      <Show when={adding()}>
        <Portal mount={host?.closest<HTMLElement>(".studio-root") ?? document.body}><CardShell title="加一样东西" manageFocus onClose={() => setAdding(false)}>
          <div class="shelf-add-grid">
            <For each={groups}>{(group) => (
              <button type="button" class="nav-link mc-slot" aria-label={addWord(group)} aria-describedby={`shelf-kind-${group.id}`}
                title={canAdd(group.create, !!props.external) ? undefined : "写一句话，复制给你的 AI"} onClick={() => pick(group)}>
                <Icon name={addTiles[group.create].icon} />
                <span>{addWord(group)}</span>
                <small id={`shelf-kind-${group.id}`}>{addTiles[group.create].detail}</small>
              </button>
            )}</For>
          </div>
          <Show when={props.external}><p class="shelf-add-note">方块、物品和配方可以在这里填表做。其他种类会给你一句写好的话，复制给你的 AI。</p></Show>
          <div class="shelf-other"><button type="button" class="nav-link" onClick={() => { setAdding(false); setImporting(true) }}><Icon name="plus" />从别的工程导入</button><small>把别的工程里做好的生物或别的东西，连同它用到的一切带过来</small></div>
        </CardShell></Portal>
      </Show>
      {/* A brought creature opens the way a saved sound does: the view is applied, and the thing is shown. */}
      <Show when={importing()}><Portal mount={host?.closest<HTMLElement>(".studio-root") ?? document.body}><ProjectImportDialog project={props.project} close={() => setImporting(false)} imported={(view, id) => props.onAudioSaved(view, id ?? "")} /></Portal></Show>
      <Show when={audioKind()}>{kind => <NewAudioDialog project={props.project} kind={kind()} close={() => setAudioKind(null)}
        saved={(view, id) => { setAudioKind(null); props.onAudioSaved(view, id) }} />}</Show>
      <Show when={telling()}>
        <Portal mount={host?.closest<HTMLElement>(".studio-root") ?? document.body}><CardShell title={`加一个${telling()!.label}`} manageFocus onClose={() => setTelling(null)}>
          <div class="shelf-tell">
            <p class="shelf-tell-line">在『{props.project.name}』里加一个{telling()!.label}：</p>
            <input class="pa-input" aria-label="补一句想要什么样" placeholder="补一句想要什么样" maxLength={300} value={wish()} ref={(element) => queueMicrotask(() => element.focus())} onInput={(event) => { setWish(event.currentTarget.value); setCopied(false) }} onKeyDown={(event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void copySentence() } }} />
            <div class="shelf-tell-actions">
              <Button primary onClick={() => void copySentence()}>复制给我的 AI</Button>
              <span class="pa-hint" role="status">{copyFailed() ? "没复制成功，再按一次试试。" : copied() ? "已复制，去你的 AI 窗口粘贴。" : ""}</span>
            </div>
          </div>
        </CardShell></Portal>
      </Show>
      <Show when={tip()}>
        {(value) => (
          <Portal mount={host?.closest<HTMLElement>(".studio-root") ?? document.body}>
            <div
              class="inv-tip mc-tooltip"
              role="presentation"
              style={{
                left: `${Math.max(4, Math.min(value().x, window.innerWidth - 268))}px`,
                top: `${Math.max(4, Math.min(value().y, window.innerHeight - 96))}px`,
              }}
            >
              <strong>{value().row.title}</strong>
              <span class="inv-tip-kind">{kindLabel(look(value().row).kind, MODULES[look(value().row).kind].label)}</span>
              <span class="inv-tip-status" data-status={look(value().row).status}>
                {look(value().row).label}
              </span>
              <Show when={chip(value().row)}>{(label) =>
                <span>{label() === "待建模" ? "还没有模型" : label() === "设计稿" ? "只是设计稿，不会做进游戏" : label()}</span>}
              </Show>
              <Show when={look(value().row).reason}>
                <span>{look(value().row).reason!.slice(0, 60)}</span>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </>
  )
}

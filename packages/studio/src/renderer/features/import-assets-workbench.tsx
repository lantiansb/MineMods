import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { ImportedAsset, ImportedAssetCatalog } from "@minemods/mod-core/import-assets"
import type { ImportedModelPreview } from "@minemods/mod-core/imported-model"
import type { StudioApi } from "../../api"
import type { Preview } from "../viewport"
import { ModelCanvas, type ModelCanvasMode } from "./model-canvas"
import { ImportedTextureViewer } from "./imported-texture-viewer"
import { ImportedAudioPlayer, safeAudioMime } from "./imported-audio-player"
import { readThumbnail, safeImageMime } from "./imported-asset-media"
import { Icon } from "../ui"
import "./import-assets-workbench.css"
import { Fold } from "../fold"

type Selection = Awaited<ReturnType<StudioApi["getImportAssetSelection"]>>
type Asset = ImportedAsset
type Catalog = ImportedAssetCatalog
type FileRead = Awaited<ReturnType<StudioApi["readImportedAssetFile"]>>
type AssetPreview = ImportedModelPreview
type Category = Asset["kind"] | "all"

const categories: { id: Category; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "model", label: "模型" },
  { id: "texture", label: "贴图" },
  { id: "animation", label: "动作" },
  { id: "script", label: "脚本" },
  { id: "config", label: "配置" },
  { id: "quest", label: "任务" },
  { id: "audio", label: "声音" },
  { id: "data", label: "数据" },
  { id: "other", label: "其他" },
]
const batchSize = 36
const textKinds: Asset["kind"][] = ["script", "config", "quest", "data"]
const textExtensions =
  /\.(?:js|mjs|ts|json|json5|jsonc|toml|ya?ml|properties|cfg|conf|ini|txt|mcfunction|snbt|xml|lang|md|zs)$/i
const textDrafts = new Map<string, string>()
const categoryIcons: Record<Asset["kind"], "cube" | "texture" | "play" | "logic" | "settings" | "document" | "recipe"> =
  {
    model: "cube",
    texture: "texture",
    animation: "play",
    script: "logic",
    config: "settings",
    quest: "document",
    audio: "play",
    data: "recipe",
    other: "document",
  }

function cacheTextDraft(key: string, value: string) {
  textDrafts.delete(key)
  textDrafts.set(key, value)
  if (textDrafts.size > 128) textDrafts.delete(textDrafts.keys().next().value!)
}

function AssetGlyph(props: { id: string; asset: Asset; active: boolean }) {
  let host!: HTMLSpanElement
  const [image, setImage] = createSignal<string | null>(null)
  const [settled, setSettled] = createSignal(
    props.asset.kind !== "texture" || !props.asset.path.toLowerCase().endsWith(".png"),
  )
  createEffect(() => {
    if (!props.active || props.asset.kind !== "texture" || !props.asset.path.toLowerCase().endsWith(".png") || !host)
      return
    let alive = true
    const load = () =>
      void readThumbnail(props.id, props.asset).then((result) => {
        if (!alive) return
        setImage(result)
        setSettled(true)
      })
    if (typeof IntersectionObserver === "undefined") {
      load()
      onCleanup(() => {
        alive = false
      })
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        load()
      },
      { root: host.closest(".iaw-asset-list"), rootMargin: "36px" },
    )
    observer.observe(host)
    onCleanup(() => {
      alive = false
      observer.disconnect()
    })
  })
  return (
    <span ref={host} class="iaw-asset-visual" data-kind={props.asset.kind}>
      {image() ? <img src={image()!} alt="" loading="lazy" /> : <Icon name={categoryIcons[props.asset.kind]} />}
      {props.asset.kind === "texture" && !settled() ? <i class="iaw-thumb-loading" /> : null}
    </span>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ImportAssetsWorkbench(props: {
  id: string
  active: boolean
  /** Jump straight to this asset once the library is loaded. */
  openAssetId?: string
}) {
  const [selection, setSelection] = createSignal<Selection>()
  const [catalog, setCatalog] = createSignal<Catalog | null>(null)
  const [selectedGroups, setSelectedGroups] = createSignal<string[]>([])
  const [selectedId, setSelectedId] = createSignal<string>()
  const [category, setCategory] = createSignal<Category>("all")
  const [origin, setOrigin] = createSignal<"all" | Asset["origin"]>("all")
  const [query, setQuery] = createSignal("")
  const [visibleCount, setVisibleCount] = createSignal(batchSize)
  const [file, setFile] = createSignal<FileRead>()
  const [draft, setDraft] = createSignal("")
  const [image, setImage] = createSignal<string>()
  const [preview, setPreview] = createSignal<AssetPreview>()
  const [textureChoice, setTextureChoice] = createSignal("")
  const [loadedDetailKey, setLoadedDetailKey] = createSignal("")
  const [mode, setMode] = createSignal<ModelCanvasMode>("model")
  const [busy, setBusy] = createSignal("")
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [searchToken, setSearchToken] = createSignal(0)
  const [showLibrary, setShowLibrary] = createSignal(false)
  let catalogRequest = 0
  let detailRequest = 0
  let previewRequest = 0
  let actionRequest = 0
  let disposed = false
  onCleanup(() => {
    disposed = true
    catalogRequest++
    detailRequest++
    previewRequest++
    actionRequest++
  })

  const selected = createMemo(() => catalog()?.assets.find((asset) => asset.id === selectedId()))
  const derivedModels = createMemo(() =>
    (catalog()?.assets ?? []).filter(
      (asset) => asset.kind === "model" && asset.dependencies.includes(selectedId() ?? ""),
    ),
  )
  const dirty = createMemo(() => file()?.encoding === "utf8" && draft() !== file()?.content)
  const filtered = createMemo(() => {
    const term = query().trim().toLocaleLowerCase()
    return (catalog()?.assets ?? []).filter(
      (asset) =>
        (category() === "all" || asset.kind === category()) &&
        (origin() === "all" || asset.origin === origin()) &&
        (!term ||
          `${asset.name} ${asset.path} ${asset.sourcePath} ${asset.namespace ?? ""}`
            .toLocaleLowerCase()
            .includes(term)),
    )
  })
  const visibleAssets = createMemo(() => filtered().slice(0, visibleCount()))
  const counts = createMemo(
    () =>
      Object.fromEntries(
        categories.map((item) => [
          item.id,
          item.id === "all"
            ? (catalog()?.assets.length ?? 0)
            : (catalog()?.assets.filter((asset) => asset.kind === item.id).length ?? 0),
        ]),
      ) as Record<Category, number>,
  )
  const selectableTextures = createMemo(() => {
    const all = catalog()?.assets.filter((asset) => asset.kind === "texture" && asset.format === "png") ?? []
    const requested = preview()?.textures ?? []
    const current = selected()
    const matchesAdapter = (asset: Asset) =>
      requested.some((path) => path === asset.path || path === asset.sourcePath || path.endsWith(asset.path))
    const preferred = all.filter(matchesAdapter)
    const preferredIds = new Set(preferred.map((asset) => asset.id))
    return [
      ...preferred,
      ...all.filter((asset) => asset.groupId === current?.groupId && !preferredIds.has(asset.id)),
    ].slice(0, 80)
  })

  const load = async (id: string, current: number) => {
    const [nextSelection, nextCatalog] = await Promise.all([
      window.studio.getImportAssetSelection({ id }),
      window.studio.getImportedAssetCatalog({ id }),
    ])
    if (disposed || current !== catalogRequest || !props.active || id !== props.id) return
    setSelection(nextSelection)
    setCatalog(nextCatalog)
    setSelectedGroups((previous) =>
      previous.length
        ? previous.filter((groupId) => nextSelection.groups.some((group) => group.id === groupId))
        : nextCatalog || nextSelection.sourceKind !== "jar" || nextSelection.groups.length !== 1
          ? []
          : [nextSelection.groups[0]!.id],
    )
    setSelectedId((previous) => (nextCatalog?.assets.some((asset) => asset.id === previous) ? previous : undefined))
    setShowLibrary(!!nextCatalog)
    setError("")
    setBusy("")
  }

  createEffect(() => {
    const id = props.id
    const active = props.active
    searchToken()
    const current = ++catalogRequest
    actionRequest++
    if (!active) return
    setBusy("正在读取来源与文件库…")
    setError("")
    void load(id, current).catch((cause: unknown) => {
      if (!disposed && current === catalogRequest && id === props.id) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy("")
      }
    })
  })

  createEffect(() => {
    const id = props.id
    const assetId = selectedId()
    const active = props.active
    const asset = untrack(selected)
    const current = ++detailRequest
    previewRequest++
    if (!active) return
    const key = asset ? `${id}:${asset.id}` : ""
    if (key && untrack(loadedDetailKey) === key) return
    setFile(undefined)
    setDraft("")
    setImage(undefined)
    setPreview(undefined)
    setTextureChoice("")
    setMode("model")
    setLoadedDetailKey("")
    setError("")
    if (!asset || !assetId) return
    setBusy(asset.kind === "model" ? "正在生成模型预览…" : "正在读取文件…")
    void (async () => {
      if (asset.kind === "model") {
        const results = await Promise.allSettled([
          window.studio.previewImportedAsset({ id, assetId: asset.id }),
          window.studio.readImportedAssetFile({ id, assetId: asset.id }),
        ])
        if (disposed || current !== detailRequest || id !== props.id) return
        if (results[0].status === "fulfilled") setPreview(results[0].value)
        if (results[0].status === "rejected")
          setError(results[0].reason instanceof Error ? results[0].reason.message : String(results[0].reason))
        if (results[1].status === "fulfilled") {
          setFile(results[1].value)
          if (results[1].value.encoding === "utf8")
            setDraft(textDrafts.get(`${id}:${asset.id}`) ?? results[1].value.content)
        }
      }
      if (asset.kind !== "model" && (textKinds.includes(asset.kind) || textExtensions.test(asset.path))) {
        const result = await window.studio.readImportedAssetFile({ id, assetId: asset.id })
        if (disposed || current !== detailRequest || id !== props.id) return
        setFile(result)
        if (result.encoding === "utf8") setDraft(textDrafts.get(`${id}:${asset.id}`) ?? result.content)
      }
      if (asset.kind === "texture") {
        const result = await window.studio.readImportedAssetFile({ id, assetId: asset.id })
        if (disposed || current !== detailRequest || id !== props.id) return
        setFile(result)
        if (result.encoding === "base64" && !result.truncated) {
          const mime = safeImageMime(asset.path, result.content)
          if (mime) setImage(`data:${mime};base64,${result.content}`)
          else setError("此贴图无法安全预览，仍可查看素材路径与格式。")
        }
      }
      if (asset.kind === "audio") {
        const result = await window.studio.readImportedAssetFile({ id, assetId: asset.id })
        if (disposed || current !== detailRequest || id !== props.id) return
        setFile(result)
        if (result.encoding === "base64" && !result.truncated) {
          const mime = safeAudioMime(asset.path, result.content)
          if (mime) setImage(`data:${mime};base64,${result.content}`)
        }
      }
      if (!disposed && current === detailRequest && id === props.id) {
        setLoadedDetailKey(key)
        setBusy("")
      }
    })().catch((cause: unknown) => {
      if (!disposed && current === detailRequest && id === props.id) {
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy("")
      }
    })
  })

  const switchAsset = (assetId: string) => {
    if (assetId === selectedId()) return
    if (busy() === "正在保存文件…") {
      setNotice("保存完成后再换文件。")
      return
    }
    if (dirty() && !window.confirm("当前文件有未保存修改，换一个文件会丢弃草稿。是否继续？")) return
    if (dirty() && selectedId()) textDrafts.delete(`${props.id}:${selectedId()}`)
    setSelectedId(assetId)
  }

  createEffect(() => {
    const assetId = props.openAssetId
    if (!assetId || !catalog()?.assets.some((asset) => asset.id === assetId)) return
    untrack(() => {
      setCategory("all")
      setOrigin("all")
      setQuery("")
      setShowLibrary(true)
      switchAsset(assetId)
    })
  })

  const toggleGroup = (groupId: string, checked: boolean) =>
    setSelectedGroups((value) => (checked ? [...new Set([...value, groupId])] : value.filter((id) => id !== groupId)))

  const runExtraction = async () => {
    if (!selectedGroups().length) return
    const id = props.id
    setBusy("正在拆解并归类文件…")
    setError("")
    const current = ++actionRequest
    try {
      const result = await window.studio.extractImportAssets({ id, groupIds: selectedGroups() })
      if (disposed || current !== actionRequest || !props.active || id !== props.id) return
      setCatalog(result)
      setShowLibrary(true)
      setSelectedId(undefined)
      setCategory("all")
      setVisibleCount(batchSize)
      setNotice("文件已拆解并加入分类库。")
    } catch (cause) {
      if (!disposed && current === actionRequest && id === props.id)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!disposed && current === actionRequest && id === props.id) setBusy("")
    }
  }

  const saveFile = async () => {
    const asset = selected()
    const currentFile = file()
    if (!asset || !currentFile || currentFile.encoding !== "utf8") return
    const id = props.id
    const content = draft()
    const current = ++actionRequest
    setBusy("正在保存文件…")
    setError("")
    try {
      const result = await window.studio.saveImportedAssetFile({
        id,
        assetId: asset.id,
        expectedSha256: asset.sha256,
        content,
      })
      if (disposed || id !== props.id) return
      setCatalog(result)
      const saved = result.assets.find((value) => value.id === asset.id)
      if (saved && selectedId() === asset.id) setFile({ ...currentFile, content })
      if (saved && selectedId() === asset.id && draft() === content) cacheTextDraft(`${id}:${asset.id}`, content)
      if (current === actionRequest) setNotice("文件已保存。")
    } catch (cause) {
      if (!disposed && current === actionRequest && id === props.id)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!disposed && current === actionRequest && id === props.id) setBusy("")
    }
  }

  const exportCatalog = async () => {
    const id = props.id
    const current = ++actionRequest
    setBusy("正在导出成工程…")
    setError("")
    try {
      const result = await window.studio.exportImportedAssets({ id })
      if (disposed || current !== actionRequest || id !== props.id) return
      if (result?.path) setNotice(`已导出到 ${result.path}`)
    } catch (cause) {
      if (!disposed && current === actionRequest && id === props.id)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!disposed && current === actionRequest && id === props.id) setBusy("")
    }
  }

  const chooseGroups = () => {
    if (busy() === "正在保存文件…") {
      setNotice("保存完成后再选择内容。")
      return
    }
    if (dirty() && !window.confirm("当前文件有未保存修改，返回选择内容会丢弃草稿。是否继续？")) return
    if (dirty() && selectedId()) textDrafts.delete(`${props.id}:${selectedId()}`)
    setSelectedId(undefined)
    setShowLibrary(false)
  }

  const TextEditor = () => (
    <>
      <div class="iaw-editor-toolbar">
        <span>{file()!.truncated ? "文件内容已截断，只能查看" : dirty() ? "有未保存修改" : "文本文件"}</span>
        <button type="button" disabled={!dirty() || file()!.truncated || !!busy()} onClick={() => void saveFile()}>
          保存文件
        </button>
      </div>
      <textarea
        class="iaw-editor"
        aria-label="文件的文本"
        spellcheck={false}
        readOnly={file()!.truncated}
        value={draft()}
        onInput={(event) => {
          const value = event.currentTarget.value
          setDraft(value)
          if (selectedId()) cacheTextDraft(`${props.id}:${selectedId()}`, value)
        }}
      />
    </>
  )

  return (
    <section class="import-assets-workbench" aria-label="文件工作台">
      <header class="iaw-header">
        <div>
          <span class="iaw-eyebrow">别人的模组 · 分类文件库</span>
          <h1>文件工作台</h1>
          <p>从整合包或 JAR 中选择来源内容，拆解后浏览原始模型、贴图、脚本与配置。</p>
        </div>
        <div class="iaw-actions">
          <Show when={catalog()}>
            <button type="button" disabled={!!busy()} onClick={chooseGroups}>
              选择内容
            </button>
            <button
              type="button"
              disabled={!!busy() || dirty()}
              title={dirty() ? "请先保存未保存的文本修改，再导出成工程。" : undefined}
              onClick={() => void exportCatalog()}
            >
              导出成工程
            </button>
          </Show>
          <Show when={selection()}>
            <span>
              {selection()!.sourceKind === "jar" ? "JAR" : "整合包"} · {selection()!.groups.length} 个内容组
            </span>
          </Show>
        </div>
      </header>
      <Show when={error()}>
        <p class="iaw-message error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={notice()}>
        <p class="iaw-message" role="status">
          {notice()}
        </p>
      </Show>
      <Show when={busy()}>
        <p class="iaw-busy" role="status">
          {busy()}
        </p>
      </Show>
      <Show when={selection()?.warnings.length}>
        <Fold class="iaw-warnings" summary={<>来源提示（{selection()!.warnings.length}）</>}>
          <For each={selection()!.warnings}>{(warning) => <p>{warning}</p>}</For>
        </Fold>
      </Show>
      <Show when={!showLibrary()}>
        <div class="iaw-select-panel">
          <div class="iaw-panel-heading">
            <div>
              <strong>选择拆解范围</strong>
              <small>
                {selection()?.sourceKind === "modpack"
                  ? "KubeJS 等作者目录会作为独立内容组展示。请明确选择需要入库的来源。"
                  : "JAR 可按模组内容组单独拆解入库。"}
              </small>
            </div>
          </div>
          <Show
            when={selection()?.groups.length}
            fallback={<div class="iaw-empty">{busy() || "当前来源没有可拆解内容组。"}</div>}
          >
            <div class="iaw-group-sections">
              <For
                each={(["author", "mod"] as const).filter((kind) =>
                  selection()?.groups.some((group) => group.kind === kind),
                )}
              >
                {(kind) => {
                  const groups = () => selection()!.groups.filter((group) => group.kind === kind)
                  return (
                    <section class="iaw-group-section">
                      <header>
                        <Icon name={kind === "mod" ? "cube" : "logic"} />
                        <div>
                          <strong>{kind === "mod" ? "模组内容" : "作者内容"}</strong>
                          <small>
                            {kind === "author" ? "KubeJS 等自定义内容独立入库" : "每个模组单独拆解"} · {groups().length}{" "}
                            组
                          </small>
                        </div>
                      </header>
                      <div class="iaw-group-grid">
                        <For each={groups()}>
                          {(group) => (
                            <label class="iaw-group-card" classList={{ selected: selectedGroups().includes(group.id) }}>
                              <input
                                type="checkbox"
                                disabled={!!busy()}
                                checked={selectedGroups().includes(group.id)}
                                onChange={(event) => toggleGroup(group.id, event.currentTarget.checked)}
                              />
                              <span class="iaw-group-card-copy">
                                <strong title={group.name}>{group.name}</strong>
                                <small>
                                  {group.description || (kind === "author" ? "作者维护的独立内容" : "这个模组自己的文件")}
                                </small>
                                <code title={group.path}>{group.path}</code>
                              </span>
                              <span class="iaw-bytes">{formatBytes(group.bytes)}</span>
                            </label>
                          )}
                        </For>
                        <Show when={!groups().length}>
                          <div class="iaw-empty iaw-group-empty">没有发现此类内容。</div>
                        </Show>
                      </div>
                    </section>
                  )
                }}
              </For>
            </div>
            <footer class="iaw-select-footer">
              <small>
                已选 {selectedGroups().length} / {selection()!.groups.length}
              </small>
              <button
                type="button"
                disabled={!selectedGroups().length || !!busy()}
                onClick={() => void runExtraction()}
              >
                拆解所选内容
              </button>
            </footer>
          </Show>
        </div>
      </Show>
      <Show when={catalog() && showLibrary()}>
        <div class="iaw-layout">
          <aside class="iaw-library">
            <div class="iaw-categories">
              <For each={categories}>
                {(item) => (
                  <button
                    type="button"
                    classList={{ active: category() === item.id }}
                    onClick={() => {
                      setCategory(item.id)
                      setVisibleCount(batchSize)
                    }}
                  >
                    <span>{item.label}</span>
                    <b>{counts()[item.id]}</b>
                  </button>
                )}
              </For>
            </div>
            <div class="iaw-library-filters">
              <input
                type="search"
                placeholder="搜索名称或路径"
                value={query()}
                onInput={(event) => {
                  setQuery(event.currentTarget.value)
                  setVisibleCount(batchSize)
                }}
              />
              <select
                aria-label="来源筛选"
                value={origin()}
                onChange={(event) => setOrigin(event.currentTarget.value as "all" | Asset["origin"])}
              >
                <option value="all">所有来源</option>
                <option value="mod">模组来源</option>
                <option value="author">作者来源</option>
              </select>
            </div>
            <div class="iaw-origin-count">
              <span>模组 {catalog()!.assets.filter((asset) => asset.origin === "mod").length}</span>
              <span>作者 {catalog()!.assets.filter((asset) => asset.origin === "author").length}</span>
              <span>{filtered().length} 项</span>
            </div>
            <div
              class="iaw-asset-list"
              onScroll={(event) => {
                const node = event.currentTarget
                if (node.scrollTop + node.clientHeight >= node.scrollHeight - 120)
                  setVisibleCount((count) => Math.min(filtered().length, count + batchSize))
              }}
            >
              <For each={visibleAssets()}>
                {(asset) => (
                  <button
                    type="button"
                    class="iaw-asset"
                    classList={{ active: selectedId() === asset.id }}
                    onClick={() => switchAsset(asset.id)}
                    title={asset.path}
                  >
                    <AssetGlyph id={props.id} asset={asset} active={props.active} />
                    <span class="iaw-asset-copy">
                      <span class="iaw-asset-title">
                        <strong>{asset.name}</strong>
                        <i class="iaw-kind">{categories.find((item) => item.id === asset.kind)?.label ?? asset.kind}</i>
                      </span>
                      <small>{asset.path}</small>
                      <span class="iaw-asset-meta">
                        <i data-origin={asset.origin}>{asset.origin === "author" ? "作者" : "模组"}</i>
                        {formatBytes(asset.bytes)} · {asset.format}
                      </span>
                    </span>
                  </button>
                )}
              </For>
              <Show when={!filtered().length}>
                <div class="iaw-empty">
                  {category() === "animation" && !counts().animation
                    ? "所选内容没有独立动作文件。写在代码里的动作可以在背包的「动作与声音」里看到。"
                    : "没有符合条件的文件。"}
                </div>
              </Show>
              <Show when={visibleCount() < filtered().length}>
                <div class="iaw-list-more">
                  继续滚动以加载 {Math.min(batchSize, filtered().length - visibleCount())} 项
                </div>
              </Show>
            </div>
          </aside>
          <main class="iaw-detail">
            <Show
              when={selected() && filtered().some((asset) => asset.id === selectedId()) ? selected() : undefined}
              fallback={
                <div class="iaw-detail-empty">
                  <strong>选一个文件</strong>
                  <small>预览与编辑内容会在此处打开。</small>
                </div>
              }
            >
              {(asset) => (
                <>
                  <header class="iaw-detail-heading">
                    <div>
                      <span>
                        {asset().kind} · {asset().format}
                      </span>
                      <h2>{asset().name}</h2>
                      <code>{asset().path}</code>
                    </div>
                    <small>{formatBytes(asset().bytes)}</small>
                  </header>
                  <Show when={asset().kind === "model"}>
                    <Show
                      when={preview()}
                      fallback={
                        <div class="iaw-preview-state">{busy() || "模型预览不可用，原始文件仍保留在文件库中。"}</div>
                      }
                    >
                      <div class="iaw-model-toolbar">
                        <label>
                          模型贴图
                          <select
                            value={textureChoice()}
                            onChange={(event) => {
                              const texture = event.currentTarget.value
                              const id = props.id
                              const assetId = asset().id
                              const current = ++previewRequest
                              setTextureChoice(texture)
                              setBusy("正在更新模型贴图…")
                              setError("")
                              void window.studio
                                .previewImportedAsset({ id, assetId, texturePath: texture || undefined })
                                .then((result) => {
                                  if (
                                    !disposed &&
                                    current === previewRequest &&
                                    id === props.id &&
                                    selectedId() === assetId
                                  )
                                    setPreview(result)
                                })
                                .catch((cause: unknown) => {
                                  if (
                                    !disposed &&
                                    current === previewRequest &&
                                    id === props.id &&
                                    selectedId() === assetId
                                  )
                                    setError(cause instanceof Error ? cause.message : String(cause))
                                })
                                .finally(() => {
                                  if (!disposed && current === previewRequest && id === props.id) setBusy("")
                                })
                            }}
                          >
                            <option value="">自动 / 模型内置</option>
                            <For each={selectableTextures()}>
                              {(texture) => (
                                <option value={texture.path}>
                                  {texture.name} · {texture.path}
                                </option>
                              )}
                            </For>
                          </select>
                        </label>
                        <span>{preview()!.format}</span>
                      </div>
                      <Show
                        when={preview()!.model && preview()!.preview}
                        fallback={
                          <div class="iaw-raw-preview">
                            <strong>{preview()!.diagnostics[0] ?? "这个文件没有独立的静态几何"}</strong>
                            <small>可展开模型诊断及原始文件，查看它的渲染方式与依赖。</small>
                            <Show when={preview()!.blockbench}>
                              <Fold summary="Blockbench 原始预览数据">
                                <pre>{JSON.stringify(preview()!.blockbench, null, 2)}</pre>
                              </Fold>
                            </Show>
                          </div>
                        }
                      >
                        <Show when={props.active}>
                          <div class="iaw-model-canvas">
                            <ModelCanvas
                              view={{
                                model: preview()!.model,
                                preview: preview()!.preview as Preview,
                                blockbench: preview()!.blockbench,
                              }}
                              mode={mode()}
                              onMode={setMode}
                              modes={
                                preview()!.model!.animations.length
                                  ? ["model", "texture", "animation"]
                                  : ["model", "texture"]
                              }
                            />
                          </div>
                        </Show>
                      </Show>
                      <Show when={preview()!.diagnostics.length}>
                        <Fold class="iaw-diagnostics" summary={<>模型诊断（{preview()!.diagnostics.length}）</>}>
                          <For each={preview()!.diagnostics}>{(diagnostic) => <p>{diagnostic}</p>}</For>
                        </Fold>
                      </Show>
                      <Show when={!preview()!.model && derivedModels().length}>
                        <div class="iaw-related-models">
                          <strong>用到这个文件的模型（{derivedModels().length}）</strong>
                          <div>
                            <For each={derivedModels().slice(0, 12)}>
                              {(related) => (
                                <button
                                  type="button"
                                  onClick={() => switchAsset(related.id)}
                                  title={related.resourcePath}
                                >
                                  <Icon name="cube" />
                                  {related.name}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </Show>
                  </Show>
                  <Show when={asset().kind === "texture"}>
                    <div class="iaw-texture-preview">
                      <Show
                        when={image()}
                        fallback={
                          <p>
                            {file()?.truncated
                              ? "文件超过预览读取上限。"
                              : "此贴图格式无法安全预览；原始文件仍可导出。"}
                          </p>
                        }
                      >
                        <ImportedTextureViewer
                          src={image()!}
                          name={asset().name}
                          assetKey={`${props.id}:${asset().id}:${asset().sha256}`}
                          active={props.active}
                        />
                      </Show>
                    </div>
                  </Show>
                  <Show when={asset().kind === "audio"}>
                    <div class="iaw-audio-preview">
                      <Show
                        when={image()}
                        fallback={
                          <p>
                            {file()?.truncated
                              ? "声音超过预览读取上限，原始文件仍可导出。"
                              : "声音格式或文件签名无法识别，原始文件仍可导出。"}
                          </p>
                        }
                      >
                        <ImportedAudioPlayer src={image()!} active={props.active} />
                      </Show>
                    </div>
                  </Show>
                  <Show when={file()?.encoding === "utf8"}>
                    <Show when={asset().kind === "model"} fallback={<TextEditor />}>
                      <Fold class="iaw-source-details iaw-model-source" summary="原始模型文件（查看与编辑）">
                        <TextEditor />
                      </Fold>
                    </Show>
                  </Show>
                  <Show when={file()?.truncated && file()?.encoding === "base64"}>
                    <p class="iaw-message">文件超过读取上限，未加载完整内容。</p>
                  </Show>
                  <Fold class="iaw-source-details" summary="来源与依赖">
                    <dl>
                      <dt>来源组</dt>
                      <dd>
                        {catalog()!.groups.find((group) => group.id === asset().groupId)?.name ?? asset().groupId}
                      </dd>
                      <dt>原始路径</dt>
                      <dd>
                        <code>{asset().sourcePath}</code>
                      </dd>
                      <dt>来源类型</dt>
                      <dd>{asset().origin === "author" ? "作者内容" : "模组内容"}</dd>
                      <dt>SHA-256</dt>
                      <dd>
                        <code>{asset().sha256}</code>
                      </dd>
                      <dt>依赖</dt>
                      <dd>{asset().dependencies.length ? asset().dependencies.join("、") : "无已识别依赖"}</dd>
                    </dl>
                  </Fold>
                </>
              )}
            </Show>
          </main>
        </div>
        <Show when={catalog()!.warnings.length}>
          <Fold class="iaw-warnings" summary={<>文件库提示（{catalog()!.warnings.length}）</>}>
            <For each={catalog()!.warnings}>{(warning) => <p>{warning}</p>}</For>
          </Fold>
        </Show>
      </Show>
    </section>
  )
}

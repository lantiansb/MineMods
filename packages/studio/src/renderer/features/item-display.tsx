import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { Item } from "@minemods/mod-core/content"
import type { Project } from "@minemods/mod-core/project"
import { ITEM_DISPLAY_SLOTS, ItemTransformSchema, exportItemDisplay, itemDisplayTransform, type ItemDisplay, type ItemDisplaySlot } from "@minemods/mod-core/item-display"
import { compileItemModel } from "@minemods/mod-core/item-model"
import { mountItemDisplay } from "../item-display-scene"
import { itemDisplayKey, itemDisplaySync } from "../item-display-state"
import "./item-display.css"

const labels: Record<ItemDisplaySlot, string> = { firstperson_righthand: "第一人称 · 右手", firstperson_lefthand: "第一人称 · 左手", thirdperson_righthand: "第三人称 · 右手", thirdperson_lefthand: "第三人称 · 左手" }

export function ItemDisplay(props: {
  item: Item
  project: Project
  disabled?: boolean
  onSave?: (item: Item) => Promise<void>
  onDirty?: (dirty: boolean) => void
  onEditModel?: (modelAssetId: string) => void
}) {
  let host!: HTMLDivElement
  let controller: ReturnType<typeof mountItemDisplay> | undefined
  const [baseline, setBaseline] = createSignal(props.item)
  const savedKey = createMemo(() => itemDisplayKey(props.item))
  const [submittedKey, setSubmittedKey] = createSignal<string | null>(null)
  const [conflict, setConflict] = createSignal(false)
  const [slot, setSlot] = createSignal<ItemDisplaySlot>("thirdperson_righthand")
  const [display, setDisplay] = createSignal<ItemDisplay>(props.item.display ?? {})
  const [modelId, setModelId] = createSignal(props.item.model_asset_id ?? "")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")
  const [notice, setNotice] = createSignal("")
  const [sceneVersion, setSceneVersion] = createSignal(0)
  const models = createMemo(() => props.project.workspace.assets.filter(asset => asset.document.kind === "model"))
  const modelKey = createMemo(() => JSON.stringify(models().find(asset => asset.id === modelId())?.document ?? null))
  const design = createMemo(() => {
    modelKey()
    const document = untrack(() => models().find(asset => asset.id === modelId())?.document)
    if (document?.kind !== "model") return undefined
    const { kind: _kind, ...model } = document
    return model
  })
  const issue = createMemo(() => {
    if (!modelId()) return ""
    if (!design()) return "关联模型不存在，请重新选择模型。"
    try { compileItemModel(design()!); return "" } catch (cause) { return cause instanceof Error ? cause.message : "物品模型无法导出" }
  })
  const current = createMemo(() => itemDisplayTransform(display(), slot(), !!baseline().tool, !!modelId()))
  const dirty = createMemo(() => JSON.stringify(display()) !== JSON.stringify(baseline().display ?? {}) || modelId() !== (baseline().model_asset_id ?? ""))
  createEffect(() => {
    const action = itemDisplaySync(savedKey(), itemDisplayKey(untrack(baseline)), untrack(dirty), untrack(submittedKey))
    if (action === "unchanged") return
    if (action === "conflict") { setConflict(true); return }
    const item = untrack(() => props.item)
    setBaseline(item)
    setDisplay(structuredClone(item.display ?? {}))
    setModelId(item.model_asset_id ?? "")
    setConflict(false)
    setError("")
  })
  createEffect(() => props.onDirty?.(dirty()))
  createEffect(() => {
    const model = design()
    const invalid = issue()
    const item = baseline()
    if (!host) return
    controller?.dispose()
    controller = undefined
    setError("")
    if (invalid) return
    try {
      controller = mountItemDisplay(host, item, model, setError)
      controller.update(untrack(slot), untrack(current))
      setSceneVersion(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法打开三维预览") }
  })
  createEffect(() => { sceneVersion(); controller?.update(slot(), current()) })
  onCleanup(() => { controller?.dispose(); props.onDirty?.(false) })
  const save = async () => {
    if (!props.onSave || busy() || issue() || conflict()) return
    setBusy(true); setError(""); setNotice("")
    try {
      const next = { ...baseline(), model_asset_id: modelId() || null, display: exportItemDisplay(display(), !!baseline().tool, !!modelId()) }
      setSubmittedKey(itemDisplayKey(next))
      await props.onSave(next)
      setBaseline(next)
      setDisplay(next.display)
      setConflict(false)
      setNotice("持握设置已保存，重新打开后继续生效。")
    } catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "保存失败，请重试") }
    finally { setBusy(false); setSubmittedKey(null) }
  }
  return <section class="item-display" aria-label={`${props.item.name}持握设置`}>
    <header><div><h3>物品持握</h3><p>调整手中位置、角度和大小，保存后写入游戏资源。</p></div><Show when={modelId() && props.onEditModel}><button type="button" onClick={() => props.onEditModel?.(modelId())}>编辑关联模型</button></Show></header>
    <label class="item-display-model">外观模型<select aria-label="物品外观模型" value={modelId()} disabled={props.disabled || busy()} onChange={event => { setModelId(event.currentTarget.value); setNotice("") }}><option value="">使用物品贴图</option><For each={models()}>{asset => <option value={asset.id}>{asset.title}</option>}</For></select></label>
    <Show when={modelId()}><p class="item-display-help">支持无旋转骨骼、动作轨道静止的立方体模型。模型修改会同步到此物品。</p></Show>
    <div class="item-display-tabs" role="tablist" aria-label="持握视角"><For each={ITEM_DISPLAY_SLOTS}>{value => <button type="button" role="tab" aria-selected={slot() === value} onClick={() => setSlot(value)}>{labels[value]}</button>}</For></div>
    <div class="item-display-body"><div class="item-display-stage"><div ref={host} class="item-display-viewport" /><span class="item-display-view-label">{labels[slot()]}{slot().startsWith("thirdperson") ? " · 拖动查看" : " · 静止持握"}</span><Show when={issue()}><p class="item-display-invalid" role="alert">{issue()}</p></Show></div>
      <div class="item-display-controls"><For each={(["translation", "rotation", "scale"] as const)}>{field => <fieldset disabled={props.disabled || busy()}><legend>{field === "translation" ? "位置（像素）" : field === "rotation" ? "旋转（度）" : "缩放（倍）"}</legend><For each={([0, 1, 2] as const)}>{axis => <label><span>{["X", "Y", "Z"][axis]}</span><input type="number" aria-label={`${field === "translation" ? "位置" : field === "rotation" ? "旋转" : "缩放"} ${["X", "Y", "Z"][axis]}`} value={current()[field][axis]} min={field === "scale" ? 0 : field === "translation" ? -80 : -180} max={field === "scale" ? 4 : field === "translation" ? 80 : 180} step={field === "scale" ? 0.05 : field === "translation" ? 0.25 : 1} onInput={event => {
        const next = structuredClone(current())
        next[field][axis] = event.currentTarget.valueAsNumber
        const parsed = ItemTransformSchema.safeParse(next)
        if (!parsed.success) { event.currentTarget.setCustomValidity("请填写输入框范围内的有效数值。"); return }
        event.currentTarget.setCustomValidity("")
        setDisplay({ ...display(), [slot()]: parsed.data }); setNotice("")
      }} onBlur={event => { event.currentTarget.value = String(current()[field][axis]); event.currentTarget.setCustomValidity("") }} /></label>}</For></fieldset>}</For>
      <button type="button" disabled={props.disabled || busy()} onClick={() => { setDisplay({ ...display(), [slot()]: itemDisplayTransform(undefined, slot(), !!props.item.tool, !!modelId()) }); setNotice("") }}>重置当前视角</button>
      <small>左右手分别保存。左手按游戏规则镜像位置 X 和旋转 Y / Z。</small></div></div>
    <Show when={conflict()}><p class="item-display-error" role="alert">此物品已有新的保存版本。当前调整已保留，请点击取消修改载入最新版本后再编辑。</p></Show>
    <Show when={error()}><p class="item-display-error" role="alert">{error()}</p></Show><Show when={notice()}><p class="item-display-notice" role="status">{notice()}</p></Show>
    <footer><span>{dirty() ? "有未保存的持握修改" : "已保存的持握设置"}</span><button type="button" disabled={(!dirty() && !conflict()) || busy()} onClick={() => { setBaseline(props.item); setDisplay(structuredClone(props.item.display ?? {})); setModelId(props.item.model_asset_id ?? ""); setConflict(false); setError(""); setNotice("") }}>取消修改</button><button type="button" class="item-display-save" disabled={!props.onSave || props.disabled || busy() || !!issue() || conflict() || !dirty()} onClick={() => void save()}>{busy() ? "保存中…" : "保存持握设置"}</button></footer>
  </section>
}

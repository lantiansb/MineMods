import { soundMoments } from "@minemods/mod-core/sound-moments"
import type { Project } from "@minemods/mod-core/project"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"

export function changeSoundMoment(project: Project, entityId: string, key: string, soundId?: string, vanilla?: string) {
  if (key === "boss.music") {
    const asset = project.workspace.assets.find(a => a.document.kind === "entity" && a.document.model_asset_id === entityId)
    if (asset?.document.kind !== "entity" || asset.document.behavior !== "hostile" || !asset.document.boss) throw new Error("请先选择一只 Boss。")
    if (soundId && !project.workspace.assets.some(a => a.id === soundId && a.document.kind === "music")) throw new Error("请选择工程里的音乐资产。")
    const boss = { ...asset.document.boss }
    const old = boss.music
    if (soundId) boss.music = { starts: old?.starts ?? "fight", fade_seconds: old?.fade_seconds ?? 2, asset: soundId }
    else delete boss.music
    return applyWorkspaceAsset(project, WorkspaceAssetSchema.parse({ ...asset, document: { ...asset.document, boss },
      dependencies: [...new Set([...asset.dependencies.filter(id => id !== old?.asset), ...(soundId ? [soundId] : [])])],
      revision: asset.revision + 1, updated_at: new Date().toISOString(), provenance: { model: null, request_id: null } }))
  }
  const moments = soundMoments(project, entityId)
  const row = moments.find((m) => m.key === key)
  const asset = project.workspace.assets.find((a) => a.id === row?.owner)
  if (!row?.editable || !asset) throw new Error("这个时刻的声音不能更换。")
  if (vanilla==="none" && row.path[0]!=="builtin") throw new Error("只有自带表现能选择不响。")
  if (soundId && !project.workspace.assets.some((a) => a.id === soundId && a.document.kind === "sound")) throw new Error("没有这个声音。")
  const document = structuredClone(asset.document)
  if (document.kind === "entity" && row.path[0] === "sounds" && !document.sounds)
    document.sounds = { ambient: null, hurt: null, death: null, step: null, pitch: 1, volume: 1 }
  // Only paths obtained from the saved document's own sound rows can reach this write.
  let parent = document as unknown as Record<string, unknown>
  // A built-in sound's own table (`builtin.<where>.sound`) is only there once something in it was changed: made on the way down.
  for (const segment of row.path.slice(0, -1)) parent = (row.path[0] === "builtin" ? (parent[String(segment)] ??= {}) : parent[String(segment)]) as Record<string, unknown>
  const last = String(row.path.at(-1))
  const replacement = soundId ? { asset: soundId } : (vanilla ?? null)
  if (replacement === null && (row.path.includes("events") || row.path.includes("steps"))) {
    let events: unknown = document
    for (const segment of row.path.slice(0, -2)) events = (events as Record<string, unknown>)[String(segment)]
    if (!Array.isArray(events)) throw new Error("找不到这一刻的声音。")
    events.splice(Number(row.path.at(-2)), 1)
  } else if (row.path[0] === "builtin") {
    // "不设" on a built-in sound puts Studio's own back: the entry goes, and the table with it once it is empty (so the saved data, and what is generated, is as it was before).
    const table = (document as unknown as { builtin?: Record<string, Record<string, unknown>> }).builtin!
    if (replacement === null) delete parent[last]
    else parent[last] = replacement
    if (!Object.keys(parent).length) delete table[String(row.path[1])]
    if (!Object.keys(table).length) delete (document as unknown as { builtin?: unknown }).builtin
  } else if (replacement === null && (row.path.includes("impact") || row.path.at(-2) === "enter")) {
    // A moment of impact keeps what else it shows without its sound; its volume and pitch go with it.
    for (const field of ["sound", "volume", "pitch"]) delete parent[field]
  } else if (replacement === null && (row.path.includes("phases") || document.kind === "ability")) delete parent[last]
  else parent[last] = replacement
  const old = typeof row.ref === "object" ? row.ref?.asset : null
  const references = (node: unknown): boolean =>
    !!node && typeof node === "object" && Object.entries(node).some(([k, v]) => (k === "asset" && v === old) || references(v))
  const dependencies = [...new Set([...asset.dependencies.filter((id) => id !== old || references(document)), ...(soundId ? [soundId] : [])])]
  return applyWorkspaceAsset(
    project,
    WorkspaceAssetSchema.parse({
      ...asset,
      document,
      dependencies,
      provenance: { model: null, request_id: null },
      revision: asset.revision + 1,
      updated_at: new Date().toISOString(),
    }),
  )
}

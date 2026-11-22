import { casterLine } from "./ability-casters"
import type { AbilityAssetDocument } from "./ability-asset"
import type { Project } from "./project"
import { scaleWords } from "./ability-scale"

/** Use the persisted creatures, including older projects whose creature has no workspace card. */
export function abilityUsers(project: Project, assetId: string, document: AbilityAssetDocument) {
  const users = new Map<string, { id: string; title: string; kind: "entity" | "block" | "item" | "gesture"; scale?: string }>()
  for (const entity of project.entities) {
    if (!entity.shared_abilities?.some(use => use.asset === assetId)) continue
    const owner = project.workspace.assets.find(a => a.document.kind === "entity" && a.document.model_asset_id === entity.id)
    const id = owner?.id ?? entity.id
    // r29c: the size each of its uses plays it at, said only for one that is scaled.
    const scaled = entity.shared_abilities.filter(use => use.asset === assetId && scaleWords(use.scale)).map(use => `${use.id}：${scaleWords(use.scale)}`)
    users.set(id, { id, title: owner?.title ?? entity.name, kind: "entity", ...(scaled.length ? { scale: scaled.join("；") } : {}) })
  }
  for (const binding of document.bindings) {
    const asset = binding.type === "gesture" ? project.workspace.assets.find(a => a.id === binding.gesture)
      : binding.type === "item" ? project.items.find(i => i.identifier === binding.item) : project.blocks.find(b => b.identifier === binding.block)
    if (asset) users.set(asset.id, { id: asset.id, title: "title" in asset ? asset.title : asset.name, kind: binding.type })
  }
  return [...users.values()]
}

export function abilityInfo(project: Project, assetId: string, document: AbilityAssetDocument) {
  return { casters: casterLine(document), used_by: abilityUsers(project, assetId, document) }
}

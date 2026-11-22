import { randomUUID } from "node:crypto"
import { AbilityAssetDocumentSchema, abilityAssetNames, expandedMoves } from "./ability-asset"
import type { Project } from "./project"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "./workspace"

/** Prepare both edits in memory. The caller commits them together at the revision it opened. */
export function extractAbility(project: Project, entityAssetId: string, moveId: string) {
  const owner = project.workspace.assets.find(asset => asset.id === entityAssetId)
  if (owner?.document.kind !== "entity") throw new Error("请先选择一只已保存的生物。")
  const entity = owner.document
  const move = entity.abilities?.find(value => value.id === moveId)
  if (!move) throw new Error("这只生物找不到要提取的招式，请重新打开它。")
  const slot = expandedMoves(entity, project.workspace).findIndex(value => value.id === moveId)
  const { name, length, hits, events, moves, stages, ...choice } = move
  const assetId = randomUUID()
  const document = AbilityAssetDocumentSchema.parse({
    kind: "ability", name, english_name: moveId.replaceAll("_", " "),
    cast: { type: "instant", seconds: 0, cooldown: move.start.cooldown }, reach: Math.max(2, Math.min(64, move.start.max_distance)),
    hits, events, moves, stages, length, bindings: [], particles: entity.particles,
  })
  const timestamp = new Date().toISOString()
  const dependencies = [...new Set(Object.values(abilityAssetNames(document)).flat())]
  const skill = WorkspaceAssetSchema.parse({
    id: assetId, module: "ability", title: name, revision: 1, status: "ready", prompt: "从生物的招式提取",
    created_at: timestamp, updated_at: timestamp, provenance: { model: null, request_id: null }, dependencies, document,
  })
  const withSkill = applyWorkspaceAsset(project, skill)
  const next = applyWorkspaceAsset(withSkill, {
    ...owner, updated_at: timestamp, revision: owner.revision + 1, provenance: { model: null, request_id: null },
    dependencies: [...owner.dependencies, assetId],
    document: { ...entity, abilities: entity.abilities!.filter(a => a.id !== moveId),
      shared_abilities: [...entity.shared_abilities ?? [], { ...choice, asset: assetId, slot }] },
  })
  return { project: next, assetId }
}

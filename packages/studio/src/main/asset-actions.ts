import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { ProjectSchema, storagePath, type Project } from "@minemods/mod-core/project"
import { applyWorkspaceAsset, mirrorContent, removeWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { BlueprintSchema } from "@minemods/mod-core/blueprint"
import { ConceptionEntrySchema } from "@minemods/mod-core/conception"
import { COPY_KINDS } from "../asset-actions"
import { z } from "zod"

function find(project: Project, id: string) {
  const next = mirrorContent(project, new Set([id]))
  const asset = next.workspace.assets.find((value) => value.id === id)
  if (!asset) throw new Error("找不到这样东西。")
  return { next, asset }
}
export function creatureThing(project: Project, id: string) {
  const document = project.workspace.assets.find((asset) => asset.id === id)?.document
  const entity = project.entities.find((entity) => entity.id === (document?.kind === "entity" ? document.model_asset_id : id))
  if (!entity) return null
  const models = project.assets.filter((asset) => asset.entity_id === entity.id)
  const logic = project.logic.filter((rule) => rule.entity_id === entity.id)
  const ids = new Set([entity.id, ...logic.map((rule) => rule.id)])
  const assets = project.workspace.assets.filter((asset) => ids.has(asset.id) || asset.document.kind === "entity" && asset.document.model_asset_id === entity.id)
  assets.forEach((asset) => ids.add(asset.id))
  const entries = (project.blueprint?.entries ?? []).filter((entry) =>
    (entry.asset_id && ids.has(entry.asset_id)) || (entry.existing && ids.has(entry.existing.id)))
  const conception = project.conception.entries.filter((entry) => entry.entity_id === entity.id)
  return { entity, models, logic, assets, ids, entries, conception }
}

export function renameThing(project: Project, id: string, title: string, isCreature = false) {
  const creature = isCreature ? creatureThing(project, id) : null
  if (creature) {
    const rules = new Set(creature.assets.filter((asset) => asset.document.kind === "entity").map((asset) => asset.id))
    const stamp = new Date().toISOString()
    return ProjectSchema.parse({
      ...project,
      entities: project.entities.map((entity) => entity.id === creature.entity.id ? { ...entity, name: title } : entity),
      workspace: { assets: project.workspace.assets.map((asset) =>
        rules.has(asset.id) && asset.document.kind === "entity"
          ? { ...asset, title, revision: asset.revision + 1, updated_at: stamp, document: { ...asset.document, name: title } }
          : asset) },
      conception: { ...project.conception, entries: project.conception.entries.map((entry) =>
        entry.entity_id === creature.entity.id ? { ...entry, title } : entry) },
      blueprint: project.blueprint && { ...project.blueprint, entries: project.blueprint.entries.map((entry) =>
        entry.kind === "entity" && creature.entries.includes(entry) ? { ...entry, title } : entry) },
    })
  }
  const { next, asset } = find(project, id)
  const updated = applyWorkspaceAsset(next, { ...asset, title, updated_at: new Date().toISOString(), revision: asset.revision + 1 })
  if (updated.blueprint)
    updated.blueprint = {
      ...updated.blueprint,
      entries: updated.blueprint.entries.map((entry) => (entry.asset_id === id ? { ...entry, title } : entry)),
    }
  return ProjectSchema.parse(updated)
}
export function copyThing(project: Project, sourceId: string) {
  const { next, asset } = find(project, sourceId)
  if (!COPY_KINDS.includes(asset.module)) throw new Error("这一类东西暂时不能复制。")
  const id = randomUUID(),
    stamp = new Date().toISOString(),
    title = asset.title.slice(0, 114) + " 的副本"
  const key = "copy_" + id.replaceAll("-", "").slice(0, 24)
  const old = asset.document
  const document =
    old.kind === "block" || old.kind === "item"
      ? { ...old, identifier: key, name: title }
      : ["music", "sound", "particle"].includes(old.kind)
        ? { ...old, name: key }
        : old
  return {
    id,
    next: ProjectSchema.parse(
      applyWorkspaceAsset(
        next,
        WorkspaceAssetSchema.parse({
          ...asset,
          id,
          title,
          document,
          revision: 1,
          updated_at: stamp,
          created_at: stamp,
          provenance: { model: null, request_id: null },
        }),
      ),
    ),
  }
}
const Deleted = z.strictObject({ asset: WorkspaceAssetSchema, entries: z.array(BlueprintSchema.shape.entries.element), projectId: z.uuid() })
const DeletedCreature = z.strictObject({
  entity: ProjectSchema.shape.entities.element,
  models: ProjectSchema.shape.assets,
  assets: z.array(WorkspaceAssetSchema),
  logic: ProjectSchema.shape.logic,
  conception: z.array(ConceptionEntrySchema),
  entries: z.array(BlueprintSchema.shape.entries.element),
  projectId: z.uuid(),
})

export async function deleteThing(directory: string, project: Project, id: string, users: string[], isCreature = false) {
  if (users.length) throw new Error("还不能删，以下内容在用它：" + [...new Set(users)].join("、"))
  const creature = isCreature ? creatureThing(project, id) : null
  if (creature) {
    const { entity, models, assets, ids, logic, entries, conception } = creature
    const keys = new Set(entries.map((entry) => entry.key))
    const remaining = project.blueprint?.entries.filter((entry) => !keys.has(entry.key))
    const held = [
      ...project.workspace.assets.filter((asset) => !ids.has(asset.id) && asset.dependencies.some((dependency) => ids.has(dependency))).map((asset) => asset.title),
      ...(remaining ?? []).filter((entry) => entry.needs.some((key) => keys.has(key)) || entry.owner && keys.has(entry.owner)).map((entry) => entry.title),
      ...project.items.filter((item) => item.model_asset_id && ids.has(item.model_asset_id)).map((item) => item.name),
    ]
    if (held.length) throw new Error("还不能删，以下内容在用它：" + [...new Set(held)].join("、"))
    const next = ProjectSchema.parse({
      ...project,
      entities: project.entities.filter((value) => value.id !== entity.id),
      assets: project.assets.filter((value) => value.entity_id !== entity.id),
      workspace: { assets: project.workspace.assets.filter((asset) => !ids.has(asset.id)) },
      logic: project.logic.filter((rule) => !ids.has(rule.id)),
      conception: { ...project.conception, entries: project.conception.entries.filter((entry) => entry.entity_id !== entity.id) },
      blueprint: project.blueprint && { ...project.blueprint, entries: remaining },
    })
    const deletion = randomUUID()
    const file = await storagePath(directory, ["已删除的东西", deletion + ".json"], true)
    await writeFile(file, JSON.stringify({ entity, models, assets, logic, entries, conception, projectId: project.id }), { flag: "wx" })
    return { next, deletion }
  }
  const { next, asset } = find(project, id)
  const entries = (next.blueprint?.entries ?? []).filter((entry) => entry.asset_id === id)
  const removed = await removeWorkspaceAsset(next, id)
  const deletion = randomUUID()
  const file = await storagePath(directory, ["已删除的东西", deletion + ".json"], true)
  await writeFile(file, JSON.stringify({ asset, entries, projectId: project.id }), { flag: "wx" })
  return { next: removed, deletion }
}
export async function restoreThing(directory: string, project: Project, deletion: string) {
  const file = await storagePath(directory, ["已删除的东西", z.uuid().parse(deletion) + ".json"])
  const raw = JSON.parse(await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("找不到这条删除记录。请查看动态或使用删除操作返回的编号。")
    throw error
  })) as unknown
  const creature = DeletedCreature.safeParse(raw)
  if (creature.success) {
    const saved = creature.data
    if (saved.projectId !== project.id || project.entities.some((entity) => entity.id === saved.entity.id)
      || project.workspace.assets.some((asset) => saved.assets.some((old) => old.id === asset.id)))
      throw new Error("这样东西已经存在，无法覆盖。")
    if (saved.entries.length && (!project.blueprint || project.blueprint.entries.some((entry) => saved.entries.some((old) => old.key === entry.key))))
      throw new Error("原来的蓝图位置已经改变。")
    const next = ProjectSchema.parse({
      ...project,
      entities: [...project.entities, saved.entity],
      assets: [...project.assets, ...saved.models],
      workspace: { assets: [...project.workspace.assets, ...saved.assets] },
      logic: [...project.logic, ...saved.logic],
      conception: { ...project.conception, entries: [...project.conception.entries, ...saved.conception] },
      blueprint: project.blueprint && { ...project.blueprint, entries: [...project.blueprint.entries, ...saved.entries] },
    })
    return { next, id: saved.entity.id, title: saved.entity.name }
  }
  const saved = Deleted.parse(raw)
  if (saved.projectId !== project.id || project.workspace.assets.some((a) => a.id === saved.asset.id)) throw new Error("这样东西已经存在，无法覆盖。")
  const next = applyWorkspaceAsset(project, saved.asset)
  if (saved.entries.length) {
    if (!next.blueprint || next.blueprint.entries.some((e) => saved.entries.some((old) => old.key === e.key)))
      throw new Error("原来的蓝图位置已经改变。")
    next.blueprint = { ...next.blueprint, entries: [...next.blueprint.entries, ...saved.entries] }
  }
  return { next: ProjectSchema.parse(next), id: saved.asset.id, title: saved.asset.title }
}

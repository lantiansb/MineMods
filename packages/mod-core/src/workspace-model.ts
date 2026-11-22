import { designToBlockbench } from "./blockbench"
import { putModelAssetUnlocked } from "./assets"
import { compileSavedModel } from "./editable-model"
import { openProject, saveProjectUnlocked, withProjectLock, type Project } from "./project"
import { WorkspaceAssetSchema } from "./workspace"
import { compileItemModel } from "./item-model"
import { isItemOnlyModel } from "./item-model-quality"
import { creatureName } from "./registry-name"

function designDocument(asset: ReturnType<typeof WorkspaceAssetSchema.parse>) {
  if (asset.module !== "model" || asset.document.kind !== "model") throw new Error("Workspace asset is not a model")
  const { kind: _kind, ...design } = asset.document
  return design
}

/**
 * A workspace model made ready to be stored: its design, the creature it belongs to, the editor's file, and the
 * whole compile it has to come through. Throws what the save would throw and writes nothing, so a version can
 * be asked about before it is saved (the look) by the very code that saves it.
 */
export function compileWorkspaceModel(project: Project, assetId: string) {
  const asset = WorkspaceAssetSchema.parse(project.workspace.assets.find((value) => value.id === assetId))
  const design = designDocument(asset)
  const entity = project.entities.find((value) => value.id === asset.id) ?? {
    id: asset.id,
    name: asset.title,
    description: asset.prompt.slice(0, 4000),
    health: 20,
    speed: 0.25,
    attack_damage: 2,
    behavior: "passive" as const,
    model_asset_id: null,
  }
  const blockbench = designToBlockbench(design)
  const itemOnly = isItemOnlyModel(project, asset.id)
  if (itemOnly) compileItemModel(design)
  else compileSavedModel({ design, blockbench }, creatureName(entity))
  return { asset, design, entity, blockbench }
}

/** Persist the model for its existing item or entity use; caller must hold the project lock. */
export async function persistWorkspaceModelUnlocked(directory: string, project: Project, assetId: string) {
  const { asset, design, entity, blockbench } = compileWorkspaceModel(project, assetId)
  if (isItemOnlyModel(project, asset.id)) {
    const saved = await saveProjectUnlocked(directory, {
      ...project,
      workspace: { assets: project.workspace.assets.map(value => value.id === asset.id ? { ...value, status: "ready" as const } : value) },
    }, project.revision)
    return { project: saved, asset: null, workspaceAsset: saved.workspace.assets.find(value => value.id === asset.id)! }
  }
  const next: Project = {
    ...project,
    entities: project.entities.some((value) => value.id === entity.id)
      ? project.entities
      : [...project.entities, entity],
    workspace: {
      assets: project.workspace.assets.map((value) =>
        value.id === asset.id ? { ...value, status: "ready" as const } : value,
      ),
    },
  }
  const origin = asset.provenance.model === "gpt-6-astra" ? "gpt-6-astra" : asset.provenance.model ? "ai" : "manual"
  const saved = await putModelAssetUnlocked(directory, next, {
    entity_id: entity.id,
    data: { design, blockbench, provenance: asset.provenance },
    origin,
    expectedRevision: project.revision,
  })
  return { ...saved, workspaceAsset: saved.project.workspace.assets.find((value) => value.id === asset.id)! }
}

/** Persist a generated workspace model under one project lock. */
export async function persistWorkspaceModel(directory: string, assetId: string) {
  return withProjectLock(directory, async () =>
    persistWorkspaceModelUnlocked(directory, await openProject(directory), assetId),
  )
}

import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { loadModelAsset } from "./assets"
import type { Project } from "./project"
import { WorkspaceAssetSchema, WorkspaceSchema, mirrorContent } from "./workspace"
import type { ModuleKind } from "./workspace-modules"

/**
 * Content the person made by hand in the window: a creature, a block or an item that lives in the project's own lists and has no workspace
 * asset standing for it ("legacy" in the code, because assets came later). It is as much the person's work as anything an AI made, so a
 * plan must be able to see it, name it, and change it where it stands. The one rule that decides what is left out is the same for every
 * reader (the plan's `existing` list, the same-name check, the task route): a thing is listed here until a workspace asset takes its place.
 */
export type LegacyThing = { id: string; kind: "entity" | "block" | "item"; title: string; modelled: boolean }

type Held = Pick<Project, "workspace"> & Partial<Pick<Project, "entities" | "blocks" | "items">>

export function legacyThings(project: Held): LegacyThing[] {
  const assets = project.workspace.assets
  const known = (id: string) => assets.some((asset) => asset.id === id)
  return [
    // A creature is spoken for as soon as a model carries its id (the model is listed as itself) or its rules exist as an asset.
    ...(project.entities ?? [])
      .filter((entity) => !known(entity.id) && !assets.some((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === entity.id))
      .map((entity) => ({ id: entity.id, kind: "entity" as const, title: entity.name, modelled: entity.model_asset_id !== null })),
    ...(project.blocks ?? []).filter((value) => !known(value.id)).map((value) => ({ id: value.id, kind: "block" as const, title: value.name, modelled: false })),
    ...(project.items ?? []).filter((value) => !known(value.id)).map((value) => ({ id: value.id, kind: "item" as const, title: value.name, modelled: false })),
  ]
}

/**
 * What a task may name as the thing it changes although no asset exists for it yet. A creature is changed by making its model under the
 * creature's own id (a model and its creature share one id, and saving the model binds it to that creature), so it is a target of kind model.
 */
export function legacyTargets(project: Held): { id: string; module: ModuleKind }[] {
  return legacyThings(project).map((thing) => ({ id: thing.id, module: thing.kind === "entity" ? ("model" as const) : thing.kind }))
}

/**
 * The project with the assets a change needs to stand on, made from the hand-made content named in `ids`:
 * - a block or an item gets the asset that mirrors it (same id), so saving the task replaces that very block or item;
 * - a creature that already has a model gets that model as a workspace model asset (same id as the creature), so the AI is handed the
 *   model as it is and changes it, instead of drawing a second one; a creature with no model needs nothing, the task makes the model
 *   under the creature's id and saving it binds the model to the creature.
 * Nothing is written to disk here; the caller saves the result.
 */
export async function adoptLegacy(directory: string, project: Project, ids: readonly string[]): Promise<Project> {
  const wanted = new Set(ids)
  const mirrored = mirrorContent(project, wanted)
  return legacyThings(mirrored)
    .filter((thing) => thing.kind === "entity" && thing.modelled && wanted.has(thing.id))
    .reduce<Promise<Project>>(async (previous, thing) => {
      const current = await previous
      const entity = current.entities.find((value) => value.id === thing.id)!
      const saved = await loadModelAsset(directory, entity.model_asset_id!)
      const data = typeof saved.data === "object" && saved.data !== null && "design" in saved.data ? (saved.data as { design?: unknown }).design : saved.data
      const design = ModelDesignSchema.parse(data)
      const at = new Date().toISOString()
      const asset = WorkspaceAssetSchema.parse({
        id: entity.id,
        module: "model",
        title: entity.name,
        revision: 1,
        created_at: at,
        updated_at: at,
        prompt: "手动做的模型，由 AI 在它现在的样子上修改",
        dependencies: [],
        document: { kind: "model", ...design },
        provenance: { model: null, request_id: null },
        status: "ready",
      })
      return { ...current, workspace: WorkspaceSchema.parse({ assets: [...current.workspace.assets, asset] }) }
    }, Promise.resolve(mirrored))
}

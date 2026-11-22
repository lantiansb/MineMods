import type { Project } from "./project"
import type { BlueprintEntry } from "./blueprint"

// Kept apart from blueprint.ts on purpose: the check that reads this (reconcile.ts) also runs in the app's window, in the thread that words a creature's card,
// and blueprint.ts brings in the whole saving side (workspace.ts and its Node-only modules), which cannot be bundled there. Only types may be imported here.
/** A creature link may name the saved rules asset or the creature itself in older plans. */
export function blueprintCreature(project: Project, entry: Pick<BlueprintEntry, "kind" | "asset_id">) {
  if (entry.kind !== "entity" || !entry.asset_id) return undefined
  const document = project.workspace.assets.find((asset) => asset.id === entry.asset_id)?.document
  const id = document?.kind === "entity" ? document.model_asset_id : entry.asset_id
  return project.entities.find((entity) => entity.id === id)
}

// The fields a creature row has when saving a model wrote it (`compileWorkspaceModel`): anything more was written by a creature document or by hand.
const BARE = new Set(["id", "name", "description", "health", "speed", "attack_damage", "behavior", "model_asset_id"])

/**
 * A creature row that only stands for a model: a blueprint model entry made it (saving a model adds a row under the model's id), no creature document
 * wears that model, no blueprint entry names the row as existing content to change, and nothing but what the save wrote is in it. Such a row is not a
 * creature anyone made, so the build does not register it (no creature, no spawn egg) and says so. A creature made by hand in the window has no
 * blueprint model entry of its own id, or is named by its creature entry's `existing`, so it is never one of these.
 */
export function modelOnlyCreature(project: Pick<Project, "workspace" | "blueprint">, entity: Project["entities"][number]) {
  const entries = project.blueprint?.entries ?? []
  return (
    entries.some((entry) => entry.kind === "model" && entry.asset_id === entity.id) &&
    !entries.some((entry) => entry.existing?.id === entity.id) &&
    project.workspace.assets.some((asset) => asset.id === entity.id && asset.module === "model") &&
    !project.workspace.assets.some((asset) => asset.document.kind === "entity" && asset.document.model_asset_id === entity.id) &&
    Object.keys(entity).every((key) => BARE.has(key))
  )
}

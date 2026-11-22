/**
 * 「自己改」: where a hand-edited document is sent. `saveByHand` (main/content-service.ts) takes every kind,
 * answers with what is wrong field by field, and writes the activity line. Where a build of the app does not
 * offer it yet, a block, an item and a recipe go through `saveContent` and a creature's basic numbers through
 * `saveEntity`: the same schemas and reference rules, with what is wrong said in one sentence for the whole thing.
 */
import type { Content } from "@minemods/mod-core/content"
import type { Project } from "@minemods/mod-core/project"
import type { StudioApi, StudioView } from "../../api"
import type { HandIssue, HandKind, HandSaveInput, HandSaveResult } from "../../main/content-service"
import type { Loose } from "./asset-edit-words"

export type HandApi = Pick<StudioApi, "saveContent" | "saveEntity"> & { saveByHand?: (input: HandSaveInput) => Promise<HandSaveResult> }
export const handWired = (api: HandApi) => typeof api.saveByHand === "function"

const LISTS = { block: "blocks", item: "items", recipe: "recipes" } as const

/** The project's content lists with one document put in under an id: in place of the entry it had, or as a new last one. */
export function contentWith(project: Pick<Project, "blocks" | "items" | "recipes" | "logic">, id: string, document: Loose): Content {
  const { kind, ...fields } = document
  const list = LISTS[kind as keyof typeof LISTS]
  // A content record leaves a missing picture out where a document writes null (`applyWorkspaceAsset` does the same).
  const entry = { ...Object.fromEntries(Object.entries(fields).filter(([key, value]) => key !== "texture" || value !== null)), id }
  const content = { blocks: project.blocks, items: project.items, recipes: project.recipes, logic: project.logic }
  const current = content[list] as { id: string }[]
  return { ...content, [list]: current.some((value) => value.id === id) ? current.map((value) => (value.id === id ? entry : value)) : [...current, entry] } as Content
}

const refused = (cause: unknown): HandIssue[] => [{ path: [], code: "refused", message: cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "没有保存成功，再试一次。" }]

/** Save one hand-edited document. `assetId` null: a new thing, stored under `freshId` on the older route. */
export async function saveHand(api: HandApi, project: Project, kind: HandKind, assetId: string | null, document: Loose, changed: string[], freshId: () => string, basedOn?: number): Promise<HandSaveResult> {
  const base = { projectId: project.id, expectedRevision: project.revision }
  try {
    // `basedOn`: the revision of the thing the form started from, so the app can refuse a save over a newer version (see `stale-edit`).
    if (api.saveByHand) return await api.saveByHand({ ...base, assetId, document, changed, ...(basedOn === undefined ? {} : { basedOn }) })
    const id = assetId ?? freshId()
    if (kind !== "entity") return { ok: true, view: await api.saveContent({ ...base, content: contentWith(project, id, document) }), assetId: id }
    const creature = document as { name: string; description: string; health: number; speed: number; attack_damage: number; behavior: Project["entities"][number]["behavior"]; model_asset_id: string }
    // A creature is known to the older route by its model's id, which is the id of its entity.
    return { ok: true, view: await api.saveEntity({ ...base, name: creature.name, description: creature.description, health: creature.health, speed: creature.speed, attack_damage: creature.attack_damage, behavior: creature.behavior, entityId: creature.model_asset_id }), assetId: id }
  } catch (cause) {
    return { ok: false, issues: refused(cause) }
  }
}

/** The saved document of an asset in a view, as the form holds one. */
export const savedDocument = (view: StudioView, assetId: string) => (view.project.workspace.assets.find((asset) => asset.id === assetId)?.document ?? null) as Loose | null

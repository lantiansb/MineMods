import { ImportMappingSchema } from "@minemods/mod-core/project-import-map"
import { z } from "zod"

/** r29c: a project folder anywhere on disk, by its full path (the folder that holds minemods.project.json, or that file itself): read where it is, never copied or written. */
export const ProjectFolderPath = z.string().trim().min(1, "写工程文件夹的完整路径。").max(1024, "路径太长了。")
const oneSource = (input: { sourceId?: string | undefined; sourcePath?: string | undefined }) => (input.sourceId === undefined) !== (input.sourcePath === undefined)
const ONE_SOURCE = { message: "源工程写一个：Studio 里的工程用 sourceId，别处的工程文件夹用 sourcePath。" }

/**
 * 从别的工程导入: what the window and the outside AI send. `projectId` is the main project, the one written; the source is only read: one of Studio's projects (`sourceId`)
 * or (r29c) a project folder anywhere on disk (`sourcePath`), one of the two.
 */
const Picks = {
  projectId: z.uuid(),
  sourceId: z.uuid().optional(),
  sourcePath: ProjectFolderPath.optional(),
  mapping: ImportMappingSchema.optional(),
  picks: z.array(z.uuid()).min(1).max(64),
  conflict: z.enum(["rename", "reuse_same"]).optional(),
  // "replace" (r29b): only where the list found a namesake in the main project (`ImportItem.namesake`); the same list as mod-core's `IMPORT_CHOICES`.
  choices: z.record(z.uuid(), z.enum(["rename", "reuse", "replace"])).optional(),
}
export const ProjectImportPreviewInput = z.strictObject(Picks).refine(oneSource, ONE_SOURCE)
export const ProjectImportApplyInput = z.strictObject({ ...Picks, expectedRevision: z.int().nonnegative(), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).refine(oneSource, ONE_SOURCE)
/** r29c: what can be picked in a project folder anywhere on disk, read where it is. */
export const ProjectImportFolderInput = z.strictObject({ projectId: z.uuid(), sourcePath: ProjectFolderPath })
export const ProjectImportUndoInput = z.strictObject({ projectId: z.uuid(), expectedRevision: z.int().nonnegative(), importId: z.uuid() })
export const ProjectImportSourcesInput = z.strictObject({ projectId: z.uuid() })

/** The outside AI's one tool for it: without `fingerprint` it gets the list and nothing is written; with the list's `fingerprint` (after the person agreed) the import is written. */
export const ExternalProjectImportInput = z.strictObject({
  projectId: z.uuid(),
  sourceProjectId: z.uuid().optional(),
  // r29c: or a project folder anywhere on disk, by its full path (`ProjectFolderPath`).
  sourceProjectPath: ProjectFolderPath.optional(),
  picks: Picks.picks,
  conflict: Picks.conflict,
  choices: Picks.choices,
  mapping: Picks.mapping,
  expectedRevision: z.int().nonnegative().optional(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}).refine((input) => (input.sourceProjectId === undefined) !== (input.sourceProjectPath === undefined), { message: "源工程写一个：Studio 里的工程用 sourceProjectId，别处的工程文件夹用 sourceProjectPath（完整路径）。" })
export const ExternalProjectUndoInput = ProjectImportUndoInput

/** r29b 合并重复件: the list (nothing written), the merge of the copies chosen from it, and its undo. Without `drops` and `expectedRevision` the outside AI gets the list. */
export const AssetMergeListInput = z.strictObject({ projectId: z.uuid() })
export const AssetMergeInput = z.strictObject({ projectId: z.uuid(), expectedRevision: z.int().nonnegative(), drops: z.array(z.uuid()).min(1).max(256) })
export const AssetMergeUndoInput = z.strictObject({ projectId: z.uuid(), expectedRevision: z.int().nonnegative(), mergeId: z.uuid() })
export const ExternalAssetMergeInput = z.strictObject({ projectId: z.uuid(), drops: z.array(z.uuid()).min(1).max(256).optional(), expectedRevision: z.int().nonnegative().optional() })

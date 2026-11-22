import { ExtractAbilityInput } from "../ability-requests"
import { AssetMergeInput, AssetMergeListInput, AssetMergeUndoInput, ProjectImportApplyInput, ProjectImportFolderInput, ProjectImportPreviewInput, ProjectImportSourcesInput, ProjectImportUndoInput } from "../project-import-requests"
import { AdvancementIdSchema } from "../advancements"
import { SteadySchema } from "@minemods/mod-core/creature-steady"
import { z } from "zod"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { MODEL_ANNOTATION_IMAGE_LIMIT, ModelAnnotationInputSchema } from "@minemods/studio-ai/model-annotation"
import { MakingNoteInputSchema } from "../making-notes"
import { ContentSchema } from "@minemods/mod-core/content"
import { HandSaveInputSchema } from "./content-service"
import { ReleaseSchema } from "@minemods/mod-core/release"
import { EpicSixViewStyleSchema, SettingsSchema } from "../settings"
import { BoundedSnapshotSchema } from "./blockbench-task"
import { ConceptionSchema, ConceptionPlanSchema, ConceptionEntrySchema } from "@minemods/mod-core/conception"
import { ModuleKindSchema } from "../project-runs"
import { SpeechInputSchema } from "../speech"
import { AI_CLIENT_IDS } from "../ai-clients"
import { KEY_PAGE_PROVIDERS } from "../ai-providers"
import {
  ConnectionSettingsSchema,
  SaveConnectionInputSchema,
  TestConnectionInputSchema,
  ListConnectionModelsInputSchema,
} from "../connection"
import { ExternalBridgeRequestSchema, ExternalThreeViewFinishInputSchema, ExternalRunInputSchema, ExternalThreeViewPromptInputSchema } from "../external"
import { ReverseChangeSchema } from "@minemods/mod-core/reverse-project"
import { BlueprintDraftSchema } from "@minemods/mod-core/blueprint"
import { IdeaChoiceShape } from "@minemods/mod-core/blueprint-ideas"
import { REVIEW_NOTE_LIMIT } from "@minemods/mod-core/reviews"
import { PartSheetSchema, SixViewStyleSchema, THREE_VIEW_NOTE, THREE_VIEW_SLOTS } from "@minemods/studio-ai/making"
import { isPlainJarName } from "@minemods/mod-core/modrinth"

import { AssetAction, AssetRename, AssetRestore } from "../asset-actions"
import { AudioTarget, InboxImport, AudioUpload, PartInput, SoundSettings } from "../audio-requests"
const ProjectInput = z.strictObject({ projectId: z.uuid() })
const RevisionInput = ProjectInput.extend({ expectedRevision: z.number().int().nonnegative() })
const JobInput = ProjectInput.extend({ jobId: z.uuid() })
const EntityRevisionInput = RevisionInput.extend({ entityId: z.uuid().optional() })
const LibraryInput = z.strictObject({ id: z.uuid() })
const ImportRunInput = LibraryInput.extend({ runId: z.uuid() })
const ImportedAssetInput = LibraryInput.extend({ assetId: z.string().min(1).max(128) })
// 新建工程的配置和运行环境 (2026-10-08). A Java major from 8 (the oldest any listed game version runs on, targets.ts) up;
// a folder or Java home as long as a settings field may hold it; a Modrinth project id as Modrinth writes them.
const JavaMajor = z.number().int().min(8).max(99)
const LocalPath = z.string().min(1).max(1000)
const ModrinthId = z.string().regex(/^[A-Za-z0-9]{8}$/)
const TargetId = z.string().min(1).max(64)
/** A pre-installed mod is named by its file name in the project's mods folder, never by a path. */
const ModFileName = z.string().max(255).refine(isPlainJarName, "MOD_FILE_INVALID")
/**
 * As many jars as one pick of the file chooser may hold; the main process says so before sending anything to the worker.
 * 64 is several times what a test scene for one mod needs beside it (one 「加上」 from Modrinth brings at most 12); a
 * bigger pick is a whole modpack's folder, which the test scene is not for.
 */
export const MOD_PICK = { limit: 64, words: "一次最多选 64 个 jar，请分几次加。" } as const
const ImportGraphSelectionInput = LibraryInput.extend({
  nodeIds: z.array(z.string().min(1).max(128)).min(1).max(80).optional(),
})

export const StudioRequestSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("getImportAssetSelection"), input: LibraryInput }),
  z.strictObject({ method: z.literal("getImportedAssetCatalog"), input: LibraryInput }),
  z.strictObject({ method: z.literal("getImportAssetGraph"), input: LibraryInput }),
  z.strictObject({ method: z.literal("buildImportAssetGraph"), input: LibraryInput }),
  z.strictObject({ method: z.literal("prepareImportAssetGraphAnalysis"), input: ImportGraphSelectionInput }),
  z.strictObject({ method: z.literal("startImportAssetGraphAnalysis"), input: ImportGraphSelectionInput }),
  z.strictObject({ method: z.literal("getImportAssetGraphAnalysis"), input: LibraryInput }),
  z.strictObject({ method: z.literal("cancelImportAssetGraphAnalysis"), input: LibraryInput }),
  z.strictObject({
    method: z.literal("submitImportAssetGraphAnalysis"),
    input: LibraryInput.extend({ contextId: z.string().regex(/^[a-f0-9]{64}$/), result: z.unknown() }),
  }),
  z.strictObject({
    method: z.literal("extractImportAssets"),
    input: LibraryInput.extend({ groupIds: z.array(z.string().min(1).max(128)).min(1).max(2048) }),
  }),
  z.strictObject({ method: z.literal("readImportedAssetFile"), input: ImportedAssetInput }),
  z.strictObject({
    method: z.literal("previewImportedAsset"),
    input: ImportedAssetInput.extend({ texturePath: z.string().min(1).max(2048).optional() }),
  }),
  z.strictObject({
    method: z.literal("previewImportedEntity"),
    input: LibraryInput.extend({ entity: z.string().regex(/^[a-z0-9_.-]{1,128}:[a-z0-9_.-]{1,128}$/) }),
  }),
  z.strictObject({ method: z.literal("listImportedEntities"), input: LibraryInput }),
  z.strictObject({
    method: z.literal("readImportedGameIcon"),
    input: LibraryInput.extend({ item: z.string().regex(/^[a-z0-9_.-]{1,128}:[a-z0-9_./-]{1,128}$/) }),
  }),
  z.strictObject({
    method: z.literal("saveImportedAssetFile"),
    input: ImportedAssetInput.extend({
      expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
      content: z.string().max(4 * 1024 * 1024),
    }),
  }),
  z.strictObject({ method: z.literal("exportImportedAssets"), input: LibraryInput }),
  z.strictObject({ method: z.literal("prepareReverseProject"), input: LibraryInput }),
  z.strictObject({ method: z.literal("getReverseState"), input: LibraryInput }),
  z.strictObject({
    method: z.literal("listReverseFiles"),
    input: LibraryInput.extend({ prefix: z.string().max(512).optional() }),
  }),
  z.strictObject({
    method: z.literal("readReverseFile"),
    input: LibraryInput.extend({ path: z.string().min(1).max(512) }),
  }),
  z.strictObject({
    method: z.literal("editReverseFiles"),
    input: LibraryInput.extend({ changes: z.array(ReverseChangeSchema).min(1).max(300) }),
  }),
  z.strictObject({
    method: z.literal("startReverseAnalysis"),
    input: LibraryInput.extend({ prompt: z.string().max(20000).optional() }),
  }),
  z.strictObject({ method: z.literal("applyReversePlan"), input: ImportRunInput }),
  z.strictObject({
    method: z.literal("cancelReverseOperation"),
    input: LibraryInput.extend({ operationId: z.uuid() }),
  }),
  z.strictObject({
    method: z.literal("buildReverseModule"),
    input: LibraryInput.extend({ moduleId: z.string().min(1).max(128) }),
  }),
  z.strictObject({
    method: z.literal("chooseReverseDependencies"),
    input: LibraryInput.extend({ moduleId: z.string().min(1).max(128) }),
  }),
  z.strictObject({
    method: z.literal("exportReverseProject"),
    input: LibraryInput.extend({ kind: z.enum(["archive", "project"]) }),
  }),
  z.strictObject({
    method: z.literal("startImportAnalysis"),
    input: LibraryInput.extend({ prompt: z.string().trim().min(1).max(20000).optional() }),
  }),
  z.strictObject({ method: z.literal("listImportAnalysisRuns"), input: LibraryInput }),
  z.strictObject({ method: z.literal("getImportAnalysisRun"), input: ImportRunInput }),
  z.strictObject({ method: z.literal("cancelImportAnalysis"), input: ImportRunInput }),
  z.strictObject({ method: z.literal("applyImportedPlan"), input: ImportRunInput }),
  z.strictObject({
    method: z.literal("exportModifiedImport"),
    input: ImportRunInput.extend({ kind: z.enum(["archive", "project"]) }),
  }),
  z.strictObject({ method: z.literal("listEnvironmentStorage") }),
  z.strictObject({
    method: z.literal("prepareEnvironment"),
    input: z.strictObject({ profileId: z.literal("fabric-1.21.1") }),
  }),
  z.strictObject({
    method: z.literal("removeEnvironment"),
    input: z.strictObject({ id: z.string().min(1).max(100), confirmReferenced: z.boolean().optional() }),
  }),
  z.strictObject({ method: z.literal("cleanUnusedEnvironment") }),
  // Tools and local audio files.
  z.strictObject({ method: z.literal("listTools") }),
  z.strictObject({ method: z.literal("approveTool"), input: z.strictObject({ id: z.string().min(1).max(60), sha256: z.string().regex(/^[0-9a-f]{64}$/) }) }),
  z.strictObject({ method: z.literal("setToolEnabled"), input: z.strictObject({ id: z.string().min(1).max(60), enabled: z.boolean() }) }),
  z.strictObject({ method: z.literal("saveToolSecret"), input: z.strictObject({ name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,59}$/), value: z.string().max(4000) }) }),
  z.strictObject({ method: z.literal("installProgram"), input: z.strictObject({ id: z.literal("ffmpeg") }) }),
  z.strictObject({ method: z.literal("chooseOwnProgram"), input: z.strictObject({ id: z.literal("ffmpeg") }) }),
  z.strictObject({method:z.literal("changeSoundMoment"),input:ProjectInput.extend({expectedRevision:z.number().int().nonnegative(),entityId:z.uuid(),key:z.string().max(400),soundId:z.uuid().optional(),vanilla:z.string().regex(/^[a-z0-9_.]+$/).max(140).optional()})}),
  z.strictObject({method:z.literal("vanillaAudio"),input:ProjectInput.extend({event:z.string().regex(/^[a-z0-9_.]+$/).max(140),probe:z.boolean().optional()})}),
  z.strictObject({method:z.literal("renameAsset"),input:AssetRename}),
  z.strictObject({method:z.literal("duplicateAsset"),input:AssetAction}),
  z.strictObject({method:z.literal("deleteAsset"),input:AssetAction}),
  z.strictObject({method:z.literal("restoreDeleted"),input:AssetRestore}),
  z.strictObject({ method: z.literal("listAudioInbox"), input: ProjectInput }),
  z.strictObject({ method: z.literal("extractAbility"), input: ExtractAbilityInput }),
  z.strictObject({ method: z.literal("projectImportSources"), input: ProjectImportSourcesInput }),
  z.strictObject({ method: z.literal("projectImportSourceAt"), input: ProjectImportFolderInput }),
  z.strictObject({ method: z.literal("chooseProjectImportFolder"), input: ProjectImportSourcesInput }),
  z.strictObject({ method: z.literal("previewProjectImport"), input: ProjectImportPreviewInput }),
  z.strictObject({ method: z.literal("applyProjectImport"), input: ProjectImportApplyInput }),
  z.strictObject({ method: z.literal("undoProjectImport"), input: ProjectImportUndoInput }),
  z.strictObject({ method: z.literal("listDuplicateAssets"), input: AssetMergeListInput }),
  z.strictObject({ method: z.literal("mergeDuplicateAssets"), input: AssetMergeInput }),
  z.strictObject({ method: z.literal("undoAssetMerge"), input: AssetMergeUndoInput }),
  z.strictObject({ method: z.literal("importAudioInbox"), input: InboxImport }),
  z.strictObject({ method: z.literal("uploadAudio"), input: AudioUpload }),
  z.strictObject({ method: z.literal("removeAudio"), input: AudioTarget }),
  z.strictObject({ method: z.literal("saveSoundSettings"), input: SoundSettings }),
  z.strictObject({ method: z.literal("readMusicPart"), input: PartInput }),
  z.strictObject({ method: z.literal("importSound"), input: z.strictObject({ projectId: z.uuid(), name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), data: z.string().min(1).max(24 * 1024 * 1024) }) }),
  z.strictObject({ method: z.literal("chooseImportSource") }),
  z.strictObject({ method: z.literal("getLibraryTask"), input: LibraryInput }),
  z.strictObject({ method: z.literal("listLibraryTasks") }),
  z.strictObject({ method: z.literal("cancelLibraryTask"), input: LibraryInput }),
  z.strictObject({ method: z.literal("listImportedProjects") }),
  z.strictObject({ method: z.literal("listImportedProjectIssues") }),
  z.strictObject({ method: z.literal("getImportedProject"), input: LibraryInput }),
  z.strictObject({ method: z.literal("deleteImportedProject"), input: LibraryInput }),
  z.strictObject({ method: z.literal("clearImportedCache"), input: LibraryInput }),
  z.strictObject({ method: z.literal("exportImportedReport"), input: LibraryInput }),
  z.strictObject({ method: z.literal("getConnection") }),
  z.strictObject({ method: z.literal("saveConnection"), input: SaveConnectionInputSchema }),
  z.strictObject({ method: z.literal("turnOffReview") }),
  z.strictObject({ method: z.literal("testConnection"), input: TestConnectionInputSchema }),
  z.strictObject({ method: z.literal("listConnectionModels"), input: ListConnectionModelsInputSchema }),
  z.strictObject({ method: z.literal("getMcpStatus") }),
  z.strictObject({ method: z.literal("copyMcpConfig") }),
  z.strictObject({ method: z.literal("copyText"), input: z.strictObject({ text: z.string().min(1).max(20_000) }) }),
  // `role`: with 「审查」 on there are two hand-offs, the maker's (the default) and the reviewer's.
  z.strictObject({ method: z.literal("getMcpHandoff"), input: ProjectInput.partial().extend({ role: z.enum(["maker", "reviewer"]).optional() }) }),
  // `request` goes in front of the maker's hand-off; with `ifNoPlan` only while the project has no plan yet (the sentence the person wrote and no AI was given: once a plan stands on it, it is carried no more).
  z.strictObject({ method: z.literal("copyMcpHandoff"), input: ProjectInput.partial().extend({ role: z.enum(["maker", "reviewer"]).optional(), request: z.string().min(1).max(20_000).optional(), ifNoPlan: z.boolean().optional() }) }),
  // 一键接上: the assistants on this computer, writing Studio into one's settings (only when the person presses the button), and opening its download page.
  z.strictObject({ method: z.literal("detectAiClients") }),
  z.strictObject({ method: z.literal("connectAiClient"), input: z.strictObject({ client: z.enum(AI_CLIENT_IDS) }) }),
  z.strictObject({ method: z.literal("openAiClientDownload"), input: z.strictObject({ client: z.enum(AI_CLIENT_IDS) }) }),
  // The key page of a ready-made AI service (DeepSeek…): the window names the service, never a link.
  z.strictObject({ method: z.literal("openProviderKeyPage"), input: z.strictObject({ provider: z.enum(KEY_PAGE_PROVIDERS) }) }),
  z.strictObject({ method: z.literal("getExternalProgress"), input: ExternalRunInputSchema }),
  z.strictObject({ method: z.literal("listProjects") }),
  z.strictObject({ method: z.literal("chooseExistingProject") }),
  z.strictObject({ method: z.literal("transcribeAudio"), input: SpeechInputSchema }),
  z.strictObject({
    method: z.literal("startProjectRun"),
    input: RevisionInput.extend({
      prompt: z.string().trim().min(1).max(20000),
      module: ModuleKindSchema.optional(),
      assetId: z.uuid().optional(),
    }),
  }),
  z.strictObject({ method: z.literal("listProjectRuns"), input: ProjectInput }),
  z.strictObject({ method: z.literal("getLatestBuild"), input: ProjectInput }),
  z.strictObject({ method: z.literal("getProjectRun"), input: ProjectInput.extend({ runId: z.uuid() }) }),
  z.strictObject({ method: z.literal("cancelProjectRun"), input: ProjectInput.extend({ runId: z.uuid() }) }),
  z.strictObject({
    method: z.literal("draftBlueprint"),
    input: ProjectInput.extend({ request: z.string().trim().min(1).max(20000), ideas: z.number().int().min(1).optional() }),
  }),
  // Idea cards and the activity panel.
  z.strictObject({ method: z.literal("expandIdeas"), input: ProjectInput.extend({ request: z.string().trim().min(1).max(20000) }) }),
  z.strictObject({ method: z.literal("getIdeas"), input: ProjectInput }),
  z.strictObject({ method: z.literal("chooseIdeas"), input: ProjectInput.extend(IdeaChoiceShape) }),
  z.strictObject({ method: z.literal("discardIdeas"), input: ProjectInput }),
  z.strictObject({ method: z.literal("getActivity"), input: ProjectInput.extend({ after: z.number().int().nonnegative().optional() }) }),
  z.strictObject({ method: z.literal("getReceipt"), input: ProjectInput }),
  z.strictObject({ method: z.literal("getBlueprint"), input: ProjectInput }),
  z.strictObject({
    method: z.literal("saveBlueprint"),
    input: ProjectInput.extend({ revision: z.number().int().nonnegative(), blueprint: BlueprintDraftSchema }),
  }),
  z.strictObject({ method: z.literal("confirmBlueprint"), input: ProjectInput.extend({ revision: z.number().int().min(1) }) }),
  z.strictObject({ method: z.literal("discardBlueprint"), input: ProjectInput }),
  z.strictObject({ method: z.literal("startBlueprintProduction"), input: ProjectInput }),
  z.strictObject({ method: z.literal("stopBlueprintProduction"), input: ProjectInput }),
  z.strictObject({ method: z.literal("getProjectPlay"), input: ProjectInput }),
  z.strictObject({ method: z.literal("getProjectOverview"), input: ProjectInput.extend({ progressOnly: z.boolean().optional() }) }),
  z.strictObject({
    method: z.literal("reviewAsset"),
    input: ProjectInput.extend({
      assetId: z.uuid(),
      revision: z.number().int().min(1).optional(),
      verdict: z.enum(["accepted", "rejected"]),
      note: z.string().trim().max(REVIEW_NOTE_LIMIT).optional(),
    }),
  }),
  z.strictObject({ method: z.literal("clearAssetReview"), input: ProjectInput.extend({ assetId: z.uuid() }) }),
  z.strictObject({
    method: z.literal("redoAsset"),
    input: ProjectInput.extend({ itemId: z.string().min(1).max(200), feedback: z.string().trim().max(REVIEW_NOTE_LIMIT), annotation: ModelAnnotationInputSchema.optional() }),
  }),
  z.strictObject({ method: z.literal("getAssetUsage"), input: ProjectInput.extend({ assetId: z.uuid(), creature: z.literal(true).optional() }) }),
  z.strictObject({ method: z.literal("getMaking"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200) }) }),
  // 制作现场: the steps of a making. 验收窗「制作过程」: its versions and notes.
  z.strictObject({ method: z.literal("getMakingTrace"), input: ProjectInput.extend({ assetId: z.uuid(), version: z.number().int().positive().optional() }) }),
  z.strictObject({ method: z.literal("getMakingStep"), input: ProjectInput.extend({ assetId: z.uuid(), version: z.number().int().positive(), seq: z.number().int().positive() }) }),
  z.strictObject({ method: z.literal("getMakingHistory"), input: ProjectInput.extend({ assetId: z.uuid() }) }),
  z.strictObject({ method: z.literal("restoreVersion"), input: ProjectInput.extend({ assetId: z.uuid(), version: z.number().int().positive(), expectedRevision: z.number().int().nonnegative() }) }),
  z.strictObject({ method: z.literal("addMakingNote"), input: ProjectInput.extend({ assetId: z.uuid(), note: MakingNoteInputSchema }) }),
  z.strictObject({ method: z.literal("earnAdvancements"), input: ProjectInput.extend({ ids: z.array(AdvancementIdSchema).max(5), quiet: z.boolean().optional() }) }),
  z.strictObject({ method: z.literal("changeMakingNote"), input: ProjectInput.extend({ assetId: z.uuid(), id: z.number().int().positive(), change: z.enum(["remove", "reopen"]) }) }),
  z.strictObject({
    method: z.literal("sendMakingNotes"),
    input: ProjectInput.extend({
      assetId: z.uuid(),
      ids: z.array(z.number().int().positive()).min(1).max(200),
      onlyMarked: z.boolean(),
      extra: z.string().trim().max(200).optional(),
      titles: z.record(z.string().max(200), z.string().max(200)).optional(),
      picture: z.strictObject({
        image: z.string().max(MODEL_ANNOTATION_IMAGE_LIMIT),
        width: z.number().int().min(1).max(4096),
        height: z.number().int().min(1).max(4096),
        projectRevision: z.number().int().nonnegative(),
        marks: z.array(z.strictObject({ note: z.number().int().positive(), start: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }), end: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional() })).max(200).optional(),
      }).optional(),
    }),
  }),
  // 2D textures (Engineer E4)
  z.strictObject({ method: z.literal("lookBeside"), input: ProjectInput.extend({ assetId: z.uuid() }) }),
  // Gameplay (Engineer D)
  z.strictObject({ method: z.literal("getGameplay"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200) }) }),
  z.strictObject({ method: z.literal("saveSheet"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200), sheet: PartSheetSchema }) }),
  // Reference images of an overview item. A picture is a data URL of at most 4 MB of PNG, JPEG or WebP.
  z.strictObject({ method: z.literal("getReferences"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200) }) }),
  z.strictObject({ method: z.literal("addReference"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200), name: z.string().max(200), url: z.string().min(1).max(8 * 1024 * 1024) }) }),
  z.strictObject({ method: z.literal("removeReference"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200), referenceId: z.uuid() }) }),
  // 六视图 of a model item: the person's picture into one slot (same formats and size as a reference), or drawn on request with an optional note.
  z.strictObject({ method: z.literal("addThreeView"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200), view: z.enum(THREE_VIEW_SLOTS), style: SixViewStyleSchema.optional(), name: z.string().max(200), url: z.string().min(1).max(8 * 1024 * 1024) }) }),
  z.strictObject({ method: z.literal("drawThreeView"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200), note: z.string().max(THREE_VIEW_NOTE).optional() }) }),
  z.strictObject({ method: z.literal("getThreeViewPrompt"), input: ExternalThreeViewPromptInputSchema }),
  z.strictObject({ method: z.literal("finishThreeView"), input: ExternalThreeViewFinishInputSchema }),
  z.strictObject({ method: z.literal("threeViewDrawing") }),
  z.strictObject({ method: z.literal("threeViewByWords"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200) }) }),
  z.strictObject({ method: z.literal("chooseThreeViewByWords"), input: ProjectInput.extend({ itemId: z.string().min(1).max(200) }) }),
  z.strictObject({ method: z.literal("environment") }),
  z.strictObject({ method: z.literal("chooseProjectLocation") }),
  z.strictObject({ method: z.literal("getSettings") }),
  z.strictObject({ method: z.literal("getBlockbenchRuntime") }),
  z.strictObject({ method: z.literal("loadBlockbench"), input: ProjectInput.extend({ entityId: z.uuid() }) }),
  z.strictObject({ method: z.literal("saveSettings"), input: SettingsSchema.omit({ epicSixViewStyle: true }).extend({ epicSixViewStyle: EpicSixViewStyleSchema.optional() }) }),
  // 个人设置 · 默认工程目录: the folder comes from `chooseProjectLocation`; null puts it back to Studio's own folder.
  z.strictObject({ method: z.literal("saveProjectsDirectory"), input: z.strictObject({ locationToken: z.uuid().nullable() }) }),
  z.strictObject({
    method: z.literal("addEntity"),
    input: RevisionInput.extend({ name: z.string().trim().min(1).max(120) }),
  }),
  z.strictObject({ method: z.literal("selectEntity"), input: ProjectInput.extend({ entityId: z.uuid() }) }),
  z.strictObject({method:z.literal("getCreatureLook"),input:RevisionInput.extend({assetId:z.uuid(),part:z.enum(["move","phases","show","arena"]),key:z.string().max(120).optional()})}),
  z.strictObject({ method: z.literal("getEntityPreview"), input: ProjectInput.extend({ entityId: z.uuid() }) }),
  z.strictObject({ method: z.literal("saveContent"), input: RevisionInput.extend({ content: ContentSchema }) }),
  z.strictObject({ method: z.literal("saveByHand"), input: HandSaveInputSchema }),
  z.strictObject({
    method: z.literal("saveConception"),
    input: RevisionInput.extend({ conception: ConceptionSchema }),
  }),
  z.strictObject({ method: z.literal("saveRelease"), input: RevisionInput.extend({ release: ReleaseSchema }) }),
  z.strictObject({ method: z.literal("renameProject"), input: RevisionInput.extend({ name: z.string().trim().min(1).max(120) }) }),
  z.strictObject({
    method: z.literal("saveModInfo"),
    input: RevisionInput.extend({
      info: z.strictObject({
        name: z.string().trim().min(1).max(120),
        name_en: z.string().max(200),
        description: z.string().max(4000),
        description_en: z.string().max(4000),
        release: ReleaseSchema,
        // A PNG data URL as the file picker gave it; the service checks it (`givenIcon`), so only its size is bounded here.
        icon: z.string().max(1_000_000).nullable().optional(),
      }),
    }),
  }),
  z.strictObject({
    method: z.literal("setEnglishName"),
    input: RevisionInput.extend({ kind: z.enum(["entity", "block", "item"]), id: z.string().min(1).max(80), name_en: z.string().max(200) }),
  }),
  z.strictObject({ method: z.literal("deleteProject"), input: ProjectInput }),
  z.strictObject({
    method: z.literal("analyzeConception"),
    input: RevisionInput.extend({ brief: z.string().trim().min(1).max(20000) }),
  }),
  z.strictObject({
    method: z.literal("importConception"),
    input: RevisionInput.extend({ plan: ConceptionPlanSchema }),
  }),
  z.strictObject({ method: z.literal("saveEntry"), input: RevisionInput.extend({ entry: ConceptionEntrySchema }) }),
  z.strictObject({
    method: z.literal("reviewEntry"),
    input: RevisionInput.extend({ entry: ConceptionEntrySchema, behavior: z.boolean() }),
  }),
  z.strictObject({
    method: z.literal("saveBlockbench"),
    input: RevisionInput.extend({ entityId: z.uuid(), snapshot: BoundedSnapshotSchema }),
  }),
  z.strictObject({ method: z.literal("exportProject"), input: ProjectInput }),
  z.strictObject({ method: z.literal("chooseImport") }),
  z.strictObject({ method: z.literal("importProject"), input: z.strictObject({ token: z.uuid() }) }),
  z.strictObject({
    method: z.literal("createProject"),
    input: z.strictObject({
      name: z.string().trim().min(1).max(120),
      description: z.string().max(4000),
      modId: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,63}$/)
        .optional(),
      empty: z.boolean().optional(),
      profileId: z.literal("fabric-1.21.1").optional(),
      javaMajor: z.literal(21).optional(),
      minecraft: z.literal("1.21.1").optional(),
      loader: z.literal("fabric").optional(),
      loaderVersion: z.literal("0.17.2").optional(),
      locationToken: z.uuid().optional(),
      targetId: TargetId.optional(),
    }),
  }),
  z.strictObject({ method: z.literal("openProject"), input: z.uuid() }),
  z.strictObject({
    method: z.literal("saveEntity"),
    input: EntityRevisionInput.extend({
      steady: SteadySchema.nullable().optional(),
      name: z.string().trim().min(1).max(120),
      description: z.string().max(4000),
      health: z.number().finite().positive().max(1024),
      speed: z.number().finite().min(0).max(2),
      attack_damage: z.number().finite().min(0).max(1024),
      behavior: z.enum(["passive", "follow", "hostile"]),
    }),
  }),
  z.strictObject({ method: z.literal("useExample"), input: EntityRevisionInput }),
  z.strictObject({ method: z.literal("saveModel"), input: EntityRevisionInput.extend({ model: ModelDesignSchema }) }),
  z.strictObject({
    method: z.literal("generateModel"),
    input: RevisionInput.extend({ prompt: z.string().trim().min(1).max(16000), annotation: ModelAnnotationInputSchema.optional() }),
  }),
  z.strictObject({ method: z.literal("getJob"), input: JobInput }),
  z.strictObject({ method: z.literal("getModelProgress"), input: JobInput }),
  z.strictObject({ method: z.literal("cancelJob"), input: JobInput }),
  z.strictObject({ method: z.literal("buildProject"), input: ProjectInput }),
  z.strictObject({ method: z.literal("startPlaytest"), input: JobInput }),
  z.strictObject({ method: z.literal("getScene"), input: ProjectInput }),
  z.strictObject({ method: z.literal("getBuildPanel"), input: ProjectInput.extend({ jobId: z.uuid().optional() }) }),
  z.strictObject({ method: z.literal("fixFindings"), input: ProjectInput }),
  z.strictObject({ method: z.literal("agreeSceneEula") }),
  z.strictObject({ method: z.literal("startSceneCheck"), input: JobInput }),
  z.strictObject({ method: z.literal("startScenePlay"), input: JobInput }),
  z.strictObject({ method: z.literal("exportSource"), input: ProjectInput }),
  z.strictObject({ method: z.literal("listBuildJars"), input: ProjectInput }),
  z.strictObject({ method: z.literal("revealRecordedJar"), input: JobInput }),
  z.strictObject({ method: z.literal("revealBuildJar"), input: JobInput }),
  z.strictObject({ method: z.literal("exportJar"), input: JobInput }),
  // Data-only gameplay (Engineer C)
  z.strictObject({ method: z.literal("getModGuide"), input: ProjectInput }),
  z.strictObject({ method: z.literal("exportBlockbench"), input: ProjectInput.extend({ assetId: z.uuid() }) }),
  // 新建工程的配置和运行环境 (2026-10-08)
  z.strictObject({ method: z.literal("getTargets") }),
  z.strictObject({ method: z.literal("detectJava"), input: z.strictObject({ major: JavaMajor }) }),
  z.strictObject({ method: z.literal("chooseJava"), input: z.strictObject({ home: LocalPath.nullable(), major: JavaMajor }) }),
  z.strictObject({ method: z.literal("planJavaInstall"), input: z.strictObject({ major: JavaMajor, directory: LocalPath.optional() }) }),
  z.strictObject({ method: z.literal("chooseJavaDirectory"), input: z.strictObject({ major: JavaMajor }) }),
  z.strictObject({ method: z.literal("installJava"), input: z.strictObject({ major: JavaMajor, directory: LocalPath.nullable().optional() }) }),
  z.strictObject({ method: z.literal("listPreinstalledMods"), input: ProjectInput }),
  // A search is what a person types into one box; offset pages through at most the first ten thousand results.
  z.strictObject({ method: z.literal("searchMods"), input: z.strictObject({ query: z.string().max(100), targetId: TargetId, offset: z.number().int().min(0).max(10_000).optional() }) }),
  z.strictObject({ method: z.literal("addModrinthMod"), input: ProjectInput.extend({ modrinthId: ModrinthId }) }),
  z.strictObject({ method: z.literal("chooseModFiles") }),
  // The tokens come from `registerModFiles`, one pick at a time.
  z.strictObject({ method: z.literal("addModFiles"), input: ProjectInput.extend({ tokens: z.array(z.uuid()).min(1).max(MOD_PICK.limit) }) }),
  z.strictObject({ method: z.literal("removePreinstalledMod"), input: ProjectInput.extend({ file: ModFileName }) }),
])

export const WorkerRequestSchema = z.union([
  StudioRequestSchema,
  z.strictObject({
    method: z.literal("exportImportedAssetsTo"),
    input: LibraryInput.extend({ destination: z.string().min(1).max(2048) }),
  }),
  z.strictObject({
    method: z.literal("exportReverseProjectTo"),
    input: LibraryInput.extend({ kind: z.enum(["archive", "project"]), destination: z.string().min(1).max(2048) }),
  }),
  z.strictObject({
    method: z.literal("buildReverseModuleWithDependencies"),
    input: LibraryInput.extend({
      moduleId: z.string().min(1).max(128),
      dependencyPaths: z.array(z.string().min(1).max(2048)).max(256),
    }),
  }),
  z.strictObject({ method: z.literal("startImportSource"), input: z.strictObject({ filename: z.string().min(1) }) }),
  z.strictObject({
    method: z.literal("exportImportedReportTo"),
    input: LibraryInput.extend({ destination: z.string().min(1) }),
  }),
  z.strictObject({ method: z.literal("externalCall"), input: ExternalBridgeRequestSchema }),
  z.strictObject({
    method: z.literal("openProjectDirectory"),
    input: z.strictObject({ directory: z.string().min(1) }),
  }),
  z.strictObject({
    method: z.literal("registerLocation"),
    input: z.strictObject({ token: z.uuid(), directory: z.string().min(1) }),
  }),
  // Only the main process sends these, with what the person picked in the system's choosers.
  // 工具资产: the person's own copy of a program, and that a tool's key was saved (decrypted keys are read again, and what the tools lack).
  z.strictObject({ method: z.literal("useOwnProgram"), input: z.strictObject({ id: z.literal("ffmpeg"), path: LocalPath }) }),
  z.strictObject({ method: z.literal("toolSecretsChanged") }),
  z.strictObject({ method: z.literal("registerJavaDirectory"), input: z.strictObject({ major: JavaMajor, directory: LocalPath }) }),
  z.strictObject({
    method: z.literal("registerModFiles"),
    input: z.strictObject({ files: z.array(z.strictObject({ token: z.uuid(), filename: z.string().min(1).max(4096) })).max(MOD_PICK.limit) }),
  }),
  z.strictObject({
    method: z.literal("inspectArchive"),
    input: z.strictObject({ token: z.uuid(), filename: z.string().min(1) }),
  }),
  z.strictObject({
    method: z.literal("exportProjectTo"),
    input: ProjectInput.extend({ destination: z.string().min(1) }),
  }),
  z.strictObject({
    method: z.literal("exportSourceTo"),
    input: ProjectInput.extend({ destination: z.string().min(1) }),
  }),
  z.strictObject({ method: z.literal("jarHandoff"), input: JobInput.extend({ reveal: z.boolean() }) }),
  z.strictObject({ method: z.literal("exportJarTo"), input: JobInput.extend({ destination: z.string().min(1) }) }),
  z.strictObject({ method: z.literal("exportBlockbenchTo"), input: ProjectInput.extend({ assetId: z.uuid(), destination: z.string().min(1) }) }),
  z.strictObject({
    method: z.literal("exportModifiedImportTo"),
    input: ImportRunInput.extend({ kind: z.enum(["archive", "project"]), destination: z.string().min(1) }),
  }),
])
export type StudioRequest = z.infer<typeof StudioRequestSchema>
export type WorkerRequest = z.infer<typeof WorkerRequestSchema>

export const WorkerMessageSchema = z.strictObject({ id: z.uuid(), request: WorkerRequestSchema })
export const WorkerShutdownSchema = z.strictObject({ id: z.uuid(), control: z.literal("shutdown") })

const ConnectionStoredValue = z.strictObject({
  settings: ConnectionSettingsSchema,
  apiKey: z.string().max(1000).optional(),
})
export const ConnectionStoreRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("connection-load"), id: z.uuid() }),
  z.strictObject({ type: z.literal("connection-save"), id: z.uuid(), value: ConnectionStoredValue }),
])
export const ConnectionStoreReplySchema = z.union([
  z.strictObject({
    type: z.literal("connection-result"),
    id: z.uuid(),
    ok: z.literal(true),
    value: ConnectionStoredValue.nullable(),
  }),
  z.strictObject({ type: z.literal("connection-result"), id: z.uuid(), ok: z.literal(false), error: z.string() }),
])

/** The worker asks the main process to draw a look; the job is checked where it is built, the answer where it arrives. */
export const LookRequestSchema = z.strictObject({ type: z.literal("look-render"), id: z.uuid(), job: z.unknown(), progress: z.boolean().optional() })
export const LookCancelSchema = z.strictObject({ type: z.literal("look-cancel"), id: z.uuid() })
export const LookProgressSchema = z.strictObject({ type: z.literal("look-progress"), id: z.uuid(), done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
export const LookReplySchema = z.strictObject({
  type: z.literal("look-result"),
  id: z.uuid(),
  result: z.union([
    z.strictObject({ ok: z.literal(true), pictures: z.array(z.strictObject({ label: z.string().max(200), url: z.string().max(4 * 1024 * 1024) })).max(8) }),
    z.strictObject({ ok: z.literal(false), reason: z.string().max(1000) }),
  ]),
})

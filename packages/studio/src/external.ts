import { z } from "zod"
import type { ModelAnnotationContext } from "@minemods/studio-ai/model-annotation"
import type { AssetReview } from "@minemods/mod-core/acceptance"
import type { ModelComplexity } from "@minemods/studio-ai/model-quality"
import { ModuleKindSchema, type ModuleDocument, type WorkspaceAsset } from "@minemods/mod-core/workspace"
import { BlueprintPlanSchema } from "@minemods/mod-core/blueprint"
import { CONSTRAINT_LIMITS, ConstraintVerdictsSchema } from "@minemods/mod-core/blueprint-constraints"
import { PaperPlaySchema } from "@minemods/mod-core/playable"
import { IdeaProposalSchema } from "@minemods/mod-core/blueprint-ideas"
import { GameplaySheetSchema, type GameplaySheet } from "@minemods/mod-core/gameplay"
import { CROP_WORDS } from "@minemods/mod-core/image-crop"
import type { WriterThing } from "@minemods/mod-core/gameplay-things"
import { BLIND_FITS, BlindAnswerSchema, FinalReviewSchema, LookOptionsSchema, MAKING_LIMITS, PartSheetDraftSchema, REFERENCE_LIMITS, ReviewNeedSchema, ReviewNeedsSchema, SelfReviewSchema, THREE_VIEW_NOTE, THREE_VIEW_SLOTS, SixViewStyleSchema, type SixViewStyle, type PartSheet, type SixView } from "@minemods/studio-ai/making"
import { SCRIPT_ERRORS, SCRIPT_LIMITS } from "@minemods/studio-ai/script"
import { PROJECT_RUN_LIMITS } from "@minemods/mod-core/workspace-runs"
import {
  RoutePlanSchema,
  RouteTaskSchema,
  type ProjectRun,
  type RoutePlan,
  type RouteTask,
  type RunTask,
} from "./project-runs"

export const ExternalProvenanceSchema = z.strictObject({
  client: z.string().trim().min(1).max(120).optional(),
  model: z.string().trim().min(1).max(200).optional(),
  version: z.string().trim().min(1).max(120).optional(),
  verified: z.literal(false).optional(),
})
export type ExternalProvenance = z.infer<typeof ExternalProvenanceSchema>
/** A 六视图's slot as an outside AI is told it: the whole sheet, or one of the six views (a `side` kept from three views is read as `left`). */
type SixViewSlot = "sheet" | SixView

/**
 * A task of an outside AI's own plan (`plan_run`) may say which entry of the confirmed blueprint it makes (`entry`, the entry's key): what it saves
 * then stands for that entry, as a task of `next_batch` does. Resolved and dropped before the plan is checked (`entryPlan`), so a run never stores it.
 */
export const ExternalRouteTaskSchema = RouteTaskSchema.extend({ entry: RouteTaskSchema.shape.key.optional() })
export const ExternalRoutePlanSchema = RoutePlanSchema.extend({ tasks: z.array(ExternalRouteTaskSchema).max(PROJECT_RUN_LIMITS.tasks) })
export type ExternalRoutePlan = z.infer<typeof ExternalRoutePlanSchema>

export const ExternalStartInputSchema = z.strictObject({
  projectId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  prompt: z.string().trim().min(1).max(20000),
  plan: ExternalRoutePlanSchema,
  provenance: ExternalProvenanceSchema.optional(),
})
export type ExternalStartInput = z.infer<typeof ExternalStartInputSchema>

export const ExternalTaskInputSchema = z.strictObject({
  projectId: z.uuid(),
  runId: z.uuid(),
  taskId: z.uuid(),
})
export type ExternalTaskInput = z.infer<typeof ExternalTaskInputSchema>

/** Script modelling: a model, a texture or an animation may be handed in as a script (a JavaScript function body that returns the document) in place of the document itself. */
const ExternalScriptSchema = z.string().min(1).max(SCRIPT_LIMITS.source, {
  error: (issue) => SCRIPT_ERRORS.too_long(String(issue.input).length),
})

export const ExternalUpdateInputSchema = ExternalTaskInputSchema.extend({
  progress: z.number().int().min(0).max(100).optional(),
  detail: z.string().trim().max(4000).optional(),
  draft: z.unknown().optional(),
  /** In place of `draft`: a script Studio runs into the draft. */
  script: ExternalScriptSchema.optional(),
})
export type ExternalUpdateInput = z.infer<typeof ExternalUpdateInputSchema>

export const ExternalCommitInputSchema = ExternalTaskInputSchema.extend({
  document: z.unknown(),
  /** In place of `document`: the script of the version that was looked at. The same script gives the same document. */
  script: ExternalScriptSchema.optional(),
  provenance: ExternalProvenanceSchema.optional(),
})
export type ExternalCommitInput = z.infer<typeof ExternalCommitInputSchema>

export const ExternalFailInputSchema = ExternalTaskInputSchema.extend({
  error: z.string().trim().min(1).max(4000).optional(),
  /** The same thing under the name clients reach for first; one of the two has to be there, and `error` wins. */
  reason: z.string().trim().min(1).max(4000).optional(),
  /** Round 18: the technical detail behind `error`, which is written in plain words for the person; the window keeps it under 高级. */
  technical: z.string().trim().min(1).max(4000).optional(),
}).refine((input) => input.error !== undefined || input.reason !== undefined, { path: ["error"], message: "fail_task 要写做不下去的真实原因：error（写成 reason 也可以）不能省。" })
export type ExternalFailInput = z.infer<typeof ExternalFailInputSchema>

/** The part sheet an outside AI writes for a task it has claimed, before it makes anything. */
// Gameplay (Engineer D): for a gameplay task the sheet is the plain description of the behaviour and what it attaches to.
export const ExternalSheetInputSchema = ExternalTaskInputSchema.extend({ sheet: z.union([PartSheetDraftSchema, GameplaySheetSchema]) })
export type ExternalSheetInput = z.infer<typeof ExternalSheetInputSchema>

/** One look at a version. `document` left out means the last draft sent with `update_task`. `script` in place of `document`: Studio runs it and looks at what it produced. */
// `glance`: 边做边看 — the same pictures and findings, and nothing recorded or counted as a version.
export const ExternalTaskLookInputSchema = ExternalTaskInputSchema.extend({ receipt_id: z.uuid().optional(), document: z.unknown().optional(), script: ExternalScriptSchema.optional(), glance: z.boolean().optional(), ...LookOptionsSchema.shape })
export const ExternalAudioLookInputSchema = z.strictObject({
  projectId: z.uuid(), assetId: z.uuid(), receipt_id: z.uuid().optional(),
  audio_part: z.union([z.number().int().min(1).max(8), z.enum(["intro", "loop", "outro"])]).optional(),
})
export type ExternalAudioLookInput = z.infer<typeof ExternalAudioLookInputSchema>
export const AUDIO_LOOK_WORDS = "外部 AI 可以用 look 读工程里已保存的音频，传 {projectId, assetId}。声音默认看第一个变体，音乐默认看循环段。用 audio_part 选变体编号（从 1 开始）或 intro、loop、outro。你听不到声音。看波形、频谱和测得的数据来判断，再请人最终试听。若先收到回执，带同一个 projectId、assetId 和 receipt_id 到 look 取回材料。没有转换工具时，请用户在「存储空间」准备 ffmpeg。"
export const ExternalLookInputSchema = ExternalTaskLookInputSchema.partial({ runId: true, taskId: true }).extend({
  assetId: ExternalAudioLookInputSchema.shape.assetId.optional(),
  audio_part: ExternalAudioLookInputSchema.shape.audio_part,
})
export type ExternalLookInput = z.infer<typeof ExternalLookInputSchema>

/**
 * `view_reference`: one of the task's reference pictures, or a region of it, cut out and enlarged to be read up close; read-only.
 * `reference`: its number in the order `claim_task`'s making.references lists them (from 1), its name, or a slot of the 六视图 (`front`, `正面`).
 * `region`: left out, the whole picture; `unit` left out, fractions (0 to 1) of the picture's width and height.
 */
export const ExternalViewReferenceInputSchema = ExternalTaskInputSchema.extend({
  reference: z.union([z.number().int().min(1).max(REFERENCE_LIMITS.user + REFERENCE_LIMITS.concept + REFERENCE_LIMITS.three_view), z.string().trim().min(1).max(REFERENCE_LIMITS.name)]),
  region: z
    .strictObject({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(CROP_WORDS.not_positive),
      height: z.number().positive(CROP_WORDS.not_positive),
      unit: z.enum(["pixels", "fraction"]).optional(),
    })
    .optional(),
})
export type ExternalViewReferenceInput = z.infer<typeof ExternalViewReferenceInputSchema>

/**
 * Reference images: views an outside AI drew, with its own image tool, of what it intends to make, handed
 * in before modelling. Each `image` is a data URL (PNG, JPEG or WebP). They replace any it handed in before;
 * an empty list takes them away. Never required.
 */
export const ExternalConceptInputSchema = ExternalTaskInputSchema.extend({
  views: z.array(z.strictObject({ name: z.string().trim().min(1).max(80), image: z.string().min(1).max(6 * 1024 * 1024) })).max(3),
})
export type ExternalConceptInput = z.infer<typeof ExternalConceptInputSchema>

/** The person's six-view request, read without starting a modelling task or changing the project. */
export const ExternalThreeViewPromptInputSchema = z.strictObject({
  style: SixViewStyleSchema.optional(),
  projectId: z.uuid(),
  itemId: z.string().trim().min(1).max(200),
  note: z.string().trim().max(THREE_VIEW_NOTE).optional(),
})
export type ExternalThreeViewPromptInput = z.infer<typeof ExternalThreeViewPromptInputSchema>

/** One real image, never a local path or a URL for Studio to fetch. Decoded pixels are checked by the reference service. */
const ExternalThreeViewImageSchema = z.string().max(4 * Math.ceil(REFERENCE_LIMITS.bytes / 3) + "data:image/webp;base64,".length)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
  .refine((image) => {
    const base64 = image.slice(image.indexOf(",") + 1)
    return base64.length > 0 && base64.length % 4 === 0 && base64.length / 4 * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0) <= REFERENCE_LIMITS.bytes
  }, "六视图只收一张不超过 4 MiB 的 PNG、JPEG 或 WebP 图片。")

export const ExternalThreeViewFinishInputSchema = ExternalThreeViewPromptInputSchema.omit({ note: true }).extend({
  result: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("generated"), image: ExternalThreeViewImageSchema, name: z.string().trim().min(1).max(80).optional() }),
    z.strictObject({ status: z.literal("provided"), image: ExternalThreeViewImageSchema, view: z.enum(THREE_VIEW_SLOTS).optional(), name: z.string().trim().min(1).max(80).optional() }),
    z.strictObject({ status: z.literal("unsupported"), reason: z.string().trim().min(1).max(2000) }),
  ]),
})
export const SixViewToolTargetSchema = z.strictObject({ kind: z.literal("six_view"), itemId: z.string().min(1).max(200), style: SixViewStyleSchema.optional() })

export type ExternalThreeViewFinishInput = z.infer<typeof ExternalThreeViewFinishInputSchema>

export const ExternalSelfReviewInputSchema = ExternalTaskInputSchema.extend(SelfReviewSchema.shape)
export type ExternalSelfReviewInput = z.infer<typeof ExternalSelfReviewInputSchema>

/**
 * Without `verdict` or `need`: ask for what a reviewer is given. With `need`: the reviewer could not see
 * something and is shown it. With `verdict`: record what the reviewer concluded; `findings` are the
 * blocking ones and alone decide `passed`, `advice` is polish. A reviewer's whole answer may be passed as
 * the verdict: while its `need` is not empty it counts as a request, not a conclusion.
 * `independent` is the client's own word on whether the reviewer took no part in the making; Studio cannot check it.
 */
export const ExternalFinalReviewInputSchema = ExternalTaskInputSchema.extend({
  // `lacking` (gameplay): material the reviewer said it needed and was not given; a failed review that lacked material may be held once more for the same version.
  // `fits` (盲认): for a thing that was named blind first, how the picture fits the thing now that the reviewer knows its name; `recognised` is the yes-or-no of callers from before (true: at_once, false: no).
  verdict: FinalReviewSchema.extend({ independent: z.boolean(), need: z.array(ReviewNeedSchema).max(MAKING_LIMITS.need_items).optional(), lacking: z.array(z.string().trim().min(1).max(600)).max(8).optional(), fits: z.enum(BLIND_FITS).optional(), recognised: z.boolean().optional() }).optional(),
  need: ReviewNeedsSchema.optional(),
  /** Round 17, 盲认: what the reviewer says the picture is, having been shown the picture alone. Only then is it handed the name, the sheet and the rest. */
  blind: BlindAnswerSchema.optional(),
})
export type ExternalFinalReviewInput = z.infer<typeof ExternalFinalReviewInputSchema>

/**
 * 「审查」with two windows (10-07): the AI that reviews asks for the next thing waiting to be reviewed; the AI that makes
 * waits for what the reviewer concluded. Both wait inside Studio for a while and answer "still waiting" rather than
 * hold a call open past a client's patience. Neither gives or changes the person's own verdict.
 */
/**
 * `wait` is the default and stays under a client's one minute (`CLIENT_CALL_MS`); `longest` is what a maker may ask for with `wait_seconds` on `await_inspection`
 * (r29: a reviewer often takes minutes, and a client whose tool timeout is longer than a minute need not call again and again). It stays below the five-minute tool
 * timeouts clients commonly allow; a client with the one-minute default must not ask for more than `wait`.
 */
export const INSPECTION_LIMITS = { wait: 40, longest: 300, poll: 500, held: 600 } as const
export const ExternalNextInspectionInputSchema = z.strictObject({ projectId: z.uuid(), receipt_id: z.uuid().optional(), wait_seconds: z.number().int().min(0).max(INSPECTION_LIMITS.wait).optional() })
export const ExternalAwaitInspectionInputSchema = ExternalTaskInputSchema.extend({ wait_seconds: z.number().int().min(0).max(INSPECTION_LIMITS.longest).optional() })

/**
 * Waiting for the person's decision on a blueprint (broad19). Studio cannot wake an outside AI that has ended its turn, so an AI that is still in its turn waits
 * with `await_blueprint_decision` instead of sending the person back to say 「开始做」.
 * - `wait`: one call is held no longer than the other long polls (40 s): under the 60 s many MCP clients cut a call at, and the same patience the reviewer's
 *   and the maker's waits already assume.
 * - `patience`: how long one series of calls keeps asking before the AI is told to hand the wait back to the person. Reading a blueprint, opening the cards
 *   and weighing a few requirements takes a person minutes; ten minutes covers nearly all of that, and is 15 small calls: within what clients allow one turn
 *   to spend. Past it the person has most likely left the screen, and a turn held open for that long is the likelier to be cut anyway.
 * - `gap`: how long after a call ended Studio still counts the AI as waiting. The AI needs a moment to read "still waiting" and call again (a slow model is
 *   some seconds; 60 s is longer than the slowest we saw); a longer silence means it stopped, and the person is told to go back.
 * - `told`: how long after it was handed 「确认了」 the person is told it is starting. It calls next_batch within seconds; past this nothing started, so the page falls back to asking the person.
 */
export const BLUEPRINT_WAIT_LIMITS = { wait: INSPECTION_LIMITS.wait, poll: INSPECTION_LIMITS.poll, patience: 600, gap: 60, told: 120 } as const
export const ExternalAwaitBlueprintDecisionInputSchema = z.strictObject({
  projectId: z.uuid(),
  /** The revision of the blueprint just proposed (`propose_blueprint` returns it): an edit made before this call counts as a change, not as the baseline. */
  revision: z.number().int().nonnegative().optional(),
  wait_seconds: z.number().int().min(0).max(BLUEPRINT_WAIT_LIMITS.wait).optional(),
})
export type ExternalAwaitBlueprintDecisionInput = z.infer<typeof ExternalAwaitBlueprintDecisionInputSchema>

/** Gameplay (Engineer D): check one version of gameplay code. `document` left out means the last draft sent with `update_task`. */
export const ExternalCheckCodeInputSchema = ExternalTaskInputSchema.extend({ document: z.unknown().optional() })
export type ExternalCheckCodeInput = z.infer<typeof ExternalCheckCodeInputSchema>

export const ExternalRunInputSchema = z.strictObject({
  projectId: z.uuid(),
  runId: z.uuid(),
})
export type ExternalRunInput = z.infer<typeof ExternalRunInputSchema>

export const BuildProjectInputSchema = z.strictObject({ projectId: z.uuid() })
export type BuildProjectInput = z.infer<typeof BuildProjectInputSchema>

export const BuildJobInputSchema = z.strictObject({ projectId: z.uuid(), jobId: z.uuid() })
export type BuildJobInput = z.infer<typeof BuildJobInputSchema>

export const InspectModelInputSchema = z.strictObject({ projectId: z.uuid(), modelAssetId: z.uuid() })
export type InspectModelInput = z.infer<typeof InspectModelInputSchema>
/**
 * r29b: a model's files as the game reads them, written into the project's own folder. `assetId` is a creature (its id, its model's or its setting's) or a
 * model asset; `folder` is a folder inside the project, written with `/` (`exports/models` when left out).
 */
export const ExportModelInputSchema = z.strictObject({ projectId: z.uuid(), assetId: z.uuid(), folder: z.string().trim().min(1).max(200).optional() })
export type ExportModelInput = z.infer<typeof ExportModelInputSchema>

export const ExternalCancelInputSchema = ExternalRunInputSchema
export type ExternalCancelInput = z.infer<typeof ExternalCancelInputSchema>

/** An outside AI's plan for the person's sentence. It is stored as a draft; only the person can confirm it, in the app. */
export const ExternalProposeBlueprintInputSchema = z.strictObject({
  projectId: z.uuid(),
  request: z.string().trim().min(1).max(20000),
  blueprint: BlueprintPlanSchema,
  /**
   * What the person explicitly required, quoted word for word from `request`. Studio adds every limiting clause it
   * finds in `request` by rule, and when the person went through idea cards for this request it already holds the list.
   */
  constraints: z.array(z.string().trim().min(1).max(CONSTRAINT_LIMITS.text)).max(CONSTRAINT_LIMITS.constraints).optional(),
  /**
   * Needed when requirements are in force: what a reader shown only the requirements and the entries concluded.
   * `independent` is the client's own word on whether that reader took no part in the planning; Studio cannot check it.
   */
  constraint_check: ConstraintVerdictsSchema.extend({ independent: z.boolean() }).optional(),
  /**
   * 「在纸上玩一遍」: what a reader shown only the request, the requirements and each thing's answers found when it
   * walked the plan as a new survival world (see `get_blueprint` → playable.paper_play). `independent` is the client's own word.
   */
  paper_play: PaperPlaySchema.extend({ independent: z.boolean() }).optional(),
  provenance: ExternalProvenanceSchema.optional(),
})
export type ExternalProposeBlueprintInput = z.infer<typeof ExternalProposeBlueprintInputSchema>

/** An outside AI's idea cards for the person's sentence. Only the person chooses among them, in the app. */
export const ExternalProposeIdeasInputSchema = z.strictObject({
  projectId: z.uuid(),
  request: z.string().trim().min(1).max(20000),
  ideas: IdeaProposalSchema,
  provenance: ExternalProvenanceSchema.optional(),
})
export type ExternalProposeIdeasInput = z.infer<typeof ExternalProposeIdeasInputSchema>

/** Reading the plan and asking for the next batch both name only the project. */
export const ProjectDetailSchema = z.enum(["summary", "full"])
export const ExternalListProjectsSchema = z.strictObject({ detail: ProjectDetailSchema.optional() })
export const ExternalOpenProjectSchema = z.strictObject({ projectId: z.uuid(), detail: ProjectDetailSchema.optional(), assetId: z.uuid().optional() })

export const ExternalBlueprintInputSchema = z.strictObject({ projectId: z.uuid() })
export type ExternalBlueprintInput = z.infer<typeof ExternalBlueprintInputSchema>

export const ExternalModuleSchemaInputSchema = z.strictObject({ module: ModuleKindSchema, projectId: z.uuid().optional() })
export type ExternalModuleSchemaInput = z.infer<typeof ExternalModuleSchemaInputSchema>

export type ExternalTaskContext = {
  task: RunTask
  /**
   * What the person said in Studio when they sent this thing back (or asked for it to be tried again), also written in `task.prompt`:
   * said apart so that a task the AI planned itself does not hide it among its own words. Absent when they said nothing waiting.
   */
  person_said?: string
  schema: Record<string, unknown>
  instructions: string
  project: Record<string, unknown>
  existing: ModuleDocument | null
  /** A current-model edit capture: readable coordinates plus actual image content in the MCP result. */
  annotation?: ModelAnnotationContext
  pictures?: { label: string; url: string }[]
  dependency_results: WorkspaceAsset[]
  model_context: Array<{ asset_id: string; atlas_size: number; geometry: Record<string, unknown> }>
  /** The acceptance standard for this kind in words, the model tier when it applies, and what the standard says about the version an AI made before. */
  quality: {
    standard: string
    complexity: ModelComplexity | null
    existing: AssetReview | null
  }
  /**
   * Set when this kind is made by looking: the order of work, the sheet of the version before (a redo
   * starts from it) with what the person said, and how many versions may be looked at. Null otherwise.
   */
  making: {
    discipline: string
    sheet: PartSheet | null
    remark: string | null
    rounds_allowed: number
    next_step: string
    /** Script modelling: how a script may be handed in for this kind, or null when the kind takes documents only. */
    script?: string | null
    /** Reference images attached to this thing, by whose they are; the pictures themselves come beside every look. */
    references?: { kind: "user" | "concept" | "three_view"; name: string; view?: SixViewSlot; by?: "person" | "ai"; style?: SixViewStyle }[]
    /**
     * 2026-10-08 六视图 (the key keeps the name it had when it was three views): whether this thing has one, whose it is (the person's, or
     * drawn by an image model the person asked) and which views it holds — the whole sheet, or which of the six. When `present`, the shape
     * is to follow it (see `reference_guide`). The person may request an outside AI to draw and hand one in. `missing`: of separate views, the directions
     * not given (nothing to hold those sides against; empty for a whole sheet). `words`: the same in one sentence ("" without one).
     */
    three_view?: { present: boolean; by: "person" | "ai" | null; views: SixViewSlot[]; missing: Exclude<SixViewSlot, "sheet">[]; words: string }
    /** Reference images: how to hand in pictures of what is intended (`save_concepts`, for a model, an item or a block; a script can trace one with `api.trace`), and how references are to be read. */
    reference_guide?: string
  } | null
  /**
   * Gameplay (Engineer D). Set when the task is gameplay code: the order of work, what of the project it may attach
   * to with how code reads each thing, the description of the version before (a redo starts from it), and how
   * many versions may be checked. Absent or null otherwise.
   */
  gameplay?: { discipline: string; api: readonly string[]; package_name: string; things: WriterThing[]; /** The other gameplay tasks of the run that have no description yet. */ not_yet_described?: { title: string; brief: string }[]; sheet: GameplaySheet | null; remark: string | null; rounds_allowed: number; next_step: string; no_game: string } | null
}

export type ExternalStartResult = {
  run: ProjectRun
  tasks: Array<{
    task: RunTask
    schema: Record<string, unknown>
    dependencies: string[]
  }>
}

export type ExternalProgress = {
  run: ProjectRun
  drafts: Record<
    string,
    {
      progress: number | null
      detail: string
      draft: ModuleDocument | null
      updated_at: string
      /** The acceptance review of the draft: the same one `commit_task` applies, for every kind. */
      quality?: AssetReview
      /** Round 10: why `commit_task` would refuse this draft although the standard passes it (a schema, the compile, what the exported file may hold), in the words it would use. Absent when it can be saved. */
      unsaveable?: string
    }
  >
  /** Script modelling: set on the answer to an `update_task` whose draft was handed in as a script: what the script produced, in a few numbers, and the notes it left. */
  script?: { summary: Record<string, unknown>; notes: string[] }
}

export const ExternalBridgeMethodSchema = z.enum([
  "getImportAssetSelection",
  "extractImportAssets",
  "getImportedAssetCatalog",
  "getImportAssetGraph",
  "buildImportAssetGraph",
  "prepareImportAssetGraphAnalysis",
  "startImportAssetGraphAnalysis",
  "getImportAssetGraphAnalysis",
  "submitImportAssetGraphAnalysis",
  "cancelImportAssetGraphAnalysis",
  "readImportedAssetFile",
  "saveImportedAssetFile",
  "getCapabilities",
  "getGuide",
  "listProjects",
  "openProject",
  "createProject",
  "moduleSchema",
  "startExternal",
  "claimExternalTask",
  "updateExternalTask",
  "commitExternalTask",
  "failExternalTask",
  "describeExternalTask",
  "conceptExternalTask",
  "getThreeViewPrompt",
  "finishThreeView",
  "lookExternalTask",
  "viewReferenceExternalTask",
  "selfReviewExternalTask",
  "finalReviewExternalTask",
  "nextInspection",
  "awaitInspection",
  "checkCodeExternalTask",
  "getExternalRun",
  "getExternalProgress",
  "cancelExternalRun",
  "getBlueprint",
  "proposeBlueprint",
  "proposeIdeas",
  "getIdeas",
  "awaitBlueprintDecision",
  "nextBatch",
  "buildProject",
  "getBuild",
  // 「测试场」 (10-07)
  "checkScene",
  "getSceneCheck",
  // 工具资产 (tool-service.ts): the tools Studio runs for an outside AI.
  "listTools",
  "runTool",
  "listAudioInbox",
  "extractAbility",
  "importFromProject",
  "undoProjectImport",
  "mergeDuplicateAssets",
  "undoAssetMerge",
  "importAudioInbox",
  "getToolRun",
  "finishToolRun",
  // Data-only gameplay (Engineer C)
  "getModGuide",
  "inspectModel",
  "exportModel",
  "listImports",
  "startImportTask",
  "getImportTask",
  "submitImportTask",
  "applyImportPlan",
  "cancelImportTask",
  "prepareReverseProject",
  "getReverseState",
  "listReverseFiles",
  "readReverseFile",
  "startReverseTask",
  "getReverseTask",
  "submitReverseTask",
  "applyReversePlan",
  "buildReverseModule",
  "cancelReverseOperation",
  "heartbeat",
])
export type ExternalBridgeMethod = z.infer<typeof ExternalBridgeMethodSchema>

export const ExternalBridgeRequestSchema = z.strictObject({
  method: ExternalBridgeMethodSchema,
  input: z.unknown(),
  sessionId: z.string().max(120).optional(),
})

export type ExternalBridgeRequest = z.infer<typeof ExternalBridgeRequestSchema>

export const ExternalBridgeDescriptorSchema = z.strictObject({
  url: z.string().url(),
  token: z.string().min(32).max(256),
})
export type ExternalBridgeDescriptor = z.infer<typeof ExternalBridgeDescriptorSchema>

export function externalTaskRoute(
  task: RunTask,
): Pick<RouteTask, "key" | "module" | "title" | "prompt" | "source" | "dependencies" | "target_id"> {
  return {
    key: task.key,
    module: task.module,
    title: task.title,
    prompt: task.prompt,
    source: task.source,
    dependencies: task.dependencies,
    target_id: task.target_id,
  }
}

export function parseExternalPlan(plan: unknown) {
  return RoutePlanSchema.parse(plan) as RoutePlan
}

import { MODEL_EXPORT_WORDS } from "@minemods/mod-core/model-export-words"
import { ProjectRecordBusyError } from "@minemods/mod-core/project"
import { ExtractAbilityInput } from "../ability-requests"
import { AssetMergeUndoInput, ExternalAssetMergeInput, ExternalProjectImportInput, ExternalProjectUndoInput } from "../project-import-requests"
import type { DuplicatePair, ImportPlan } from "@minemods/mod-core/project-import"
import { reviewEnabled } from "../connection"
import { RevisionConflictError } from "@minemods/mod-core/project"
import { ASSET_ACTIONS, isAssetAction, runAssetAction } from "./mcp-asset-actions"
import { z } from "zod"
import { modelComplexityInstructions } from "@minemods/studio-ai/model-quality"
import { reviewAsset, told } from "@minemods/mod-core/acceptance"
import { BuildStop } from "@minemods/mod-core/build-stop"
import { DETAIL_WORDS, detailForModel } from "@minemods/mod-core/creature-tier"
import { getModuleSchema, MODULES, type ModuleKind } from "@minemods/mod-core/workspace"
import { kindTargets } from "@minemods/mod-core/workspace-modules"
import { PARALLEL_WORDS, parallelPlan, type ProjectRun } from "@minemods/mod-core/workspace-runs"
import { ImportAssetGraphNodeSchema } from "@minemods/mod-core/import-asset-graph"
import { TargetIdSchema } from "@minemods/mod-core/target/ids"
import {
  BuildJobInputSchema,
  BuildProjectInputSchema,
  ExternalBridgeRequestSchema,
  ExternalAudioLookInputSchema,
  ExternalLookInputSchema,
  ExternalListProjectsSchema,
  ExternalOpenProjectSchema,
  ExternalModuleSchemaInputSchema,
  ExternalRunInputSchema,
  ExternalTaskInputSchema,
  ExternalThreeViewPromptInputSchema,
  ExternalThreeViewFinishInputSchema,
  SixViewToolTargetSchema,
  InspectModelInputSchema,
  ExportModelInputSchema,
  type ExternalTaskContext,
} from "../external"
import { StudioRequestSchema } from "./protocol"
import { StudioError, type createStudioService } from "./service"
import { GAMEPLAY_INSTRUCTIONS, gameplayInstructions } from "@minemods/mod-core/gameplay-words"
import { externalAssetStatus } from "./external-asset-status"
import { getMcpCapabilities } from "./mcp-capabilities"
import { claimSegments, guideIndex, guideText, type GuideInput } from "./mcp-guide"
import { CLAIM_GUIDE, ExternalGuideInputSchema, GUIDE_TOPICS, type GuideTopicId } from "./mcp-guide-topics"
import { standingWishes } from "../settings"
import { BlueprintError } from "./blueprint-service"
import { ToolRunError } from "./tool-runner"
import { AcceptanceRefusal, ClaimRefusal, TAKEN_WORDS } from "./project-runner"
import { EntryRefusal } from "./plan-entry"
import { ABILITY_REVIEW_GUIDE, isLooked, isSheetless, MAKING_SUMMARY, MakingRefusal } from "@minemods/mod-core/making"
import {
  GraphAnalysisResultSchema,
  IMPORT_ASSET_GRAPH_INSTRUCTIONS,
  IMPORT_ASSET_GRAPH_STRUCTURED_PROMPT,
} from "./import-asset-graph-ai"

export function externalError(error: unknown) {
  if (error instanceof ProjectRecordBusyError) return new StudioError(error.message)
  // Written for whoever reads it: which rule of the plan was broken, or why nothing can start yet.
  if (error instanceof BlueprintError) return new StudioError(error.message)
  // A refusal by the acceptance standard, of any kind, reaches the outside AI word for word: it is what it has to act on.
  if (error instanceof AcceptanceRefusal) return new StudioError(error.message)
  // A claim refused for the order or the number of the tasks says which to claim or finish instead.
  if (error instanceof ClaimRefusal) return new StudioError(error.message)
  // A plan task's `entry` refused: what to write instead.
  if (error instanceof EntryRefusal) return new StudioError(error.message)
  // So does a step of the making loop refused: what is missing, in the order it has to be done.
  if (error instanceof MakingRefusal) return new StudioError(error.message)
  // The generator stopped on something the document says and gave the sentence for it: that sentence is what the outside AI has to act on, not a note that the call did not finish.
  if (error instanceof BuildStop) return new StudioError(error.message)
  if (
    error instanceof Error &&
    /^IMPORT_[A-Z0-9_]+(?::[A-Za-z0-9_./,-]*){0,2}$/.test(error.message) &&
    !/(?:sk-|bearer\s|api[_-]?key|token=)/i.test(error.message)
  )
    return new StudioError(error.message)
  if (error instanceof z.ZodError)
    return new StudioError(
      `结构校验失败：${error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
        .join("；")}`,
    )
  const allowed = [
    "路由没有任务或需要澄清的问题。",
    "路由包含重复任务。",
    "同一资产不能被多个并行任务修改。",
    "任务超出了当前模块。",
    "任务没有对应的原始需求，已拒绝执行。",
    "路由指向不存在或不同模块的资产。",
    "路由包含无效依赖。",
    "路由包含循环依赖。",
    "外部运行不存在或已结束。",
    "运行记录不属于当前工程。",
    "外部运行当前不可领取任务。",
    "外部任务不存在。",
    "外部任务当前不可领取。",
    TAKEN_WORDS,
    "外部任务尚未领取或已结束。",
    "结构化草稿未通过当前模块 schema。",
    "指定 job 不是构建任务。",
    "这一类东西暂时不能复制。",
    "找不到这样东西。",
    "这样东西已经存在，无法覆盖。",
    "原来的蓝图位置已经改变。",
    "找不到这条删除记录。请查看动态或使用删除操作返回的编号。",
    "生物与模型、行为和游戏存档相连，这一版还不能删除。",
  ]
  return error instanceof Error && allowed.includes(error.message) ? new StudioError(error.message) : error
}

/**
 * What an outside AI is given with the project it has just created, so what it tells the person matches the window: Studio opens the project by itself when the person is
 * not in the middle of something, and otherwise shows a bar to press; the project is also in the list on the home page. No path to hunt for, no button to name.
 */
export const PROJECT_MADE_TOLD = (name: string) =>
  `工程「${name}」已经建好。Studio 的窗口会自己打开它（落在「模组总览」）；用户正在忙别的事时，窗口上方会出现一条「AI 建好了「${name}」，点这里打开」，点一下就进去了。首页的工程列表里也有它。告诉用户去 MineMods Studio 窗口里看就行，不要叫他自己找文件夹，也不要说「返回工程」之类窗口里并不存在的按钮；想知道文件夹在哪里，看 directory（以工程名命名）。`

/** What an outside AI is to do about a build that failed on a download: nothing to the mod. */
export const BUILD_NETWORK_NEXT_STEP = "这次打包失败是下载时网络断了，不是模组的问题：不要改模组的任何内容。过几分钟再调用 build_project 重新打包，已经下载好的不会重下；连续几次都这样，就如实告诉用户网络现在连不上下载地址。"

/** What an outside AI is told with a check of the test scene: how to read it, and that it is no look at the game. */
export const SCENE_TOLD = {
  started: "检查在后台跑：不开窗口，第一次要下载游戏的服务器文件，可能要几分钟。用 get_scene_check（同一个 projectId、这里返回的 jobId）轮询到终态。",
  done: "scene_check.output.report 是游戏自己的回答：started（带着这个模组启动了没有）、mods（这个游戏里一共有哪些模组）、things（每样东西摆出来了没有、生物等了一会儿还在不在、在哪、还有多少血）、errors（日志里提到这个模组的报错原文）、findings（发现的问题，空的就是没发现）。scene_check.output.lines 是给用户看的话。findings 不是空的：照它改模组，重新 build_project，再检查一次。它是空的也只说明 limits 以外的事——limits 里写着这项检查看不到什么，把那一段原样告诉用户，不要说成「游戏里验证过了」。",
} as const

// A build job as an outside AI is shown it: one that failed on a download says so beside the plain sentence in `error`.
// The return type is spelled out: left to inference, `T | (T & extra)` collapses to T and the two additive fields vanish from the contract.
const buildTold = <T extends { state: string; checkpoint: unknown }>(job: T): T & { reason?: "network"; next_step?: string } =>
  job.state === "failed" && job.checkpoint && typeof job.checkpoint === "object" && "reason" in job.checkpoint && job.checkpoint.reason === "network" ? { ...job, reason: "network", next_step: BUILD_NETWORK_NEXT_STEP } : job

/**
 * The door every call of an outside AI comes through. Each one is also reported to the project's activity
 * log, refused or not, so the person can watch an AI that runs elsewhere. Reporting never changes the outcome.
 */
export async function dispatchExternal(service: Awaited<ReturnType<typeof createStudioService>>, input: unknown) {
  const started = Date.now()
  const report = (result: unknown, error: unknown) =>
    Promise.resolve()
      .then(() => service.blueprints.toolCalled({ request: ExternalBridgeRequestSchema.safeParse(input).data, result, ms: Date.now() - started, refused: error === null ? null : refusedWords(error) }))
      .catch(() => undefined)
  return route(service, input).then(
    async (result) => {
      await report(result, null)
      if (ExternalBridgeRequestSchema.safeParse(input).data?.method !== "lookExternalTask")
        await traced(service, input, result).catch(() => undefined)
      return result
    },
    async (error: unknown) => {
      await report(null, error)
      throw error
    },
  )
}

/**
 * What 制作现场 follows: each call that wrote to a thing or looked at it, with the words the AI itself gave, if the call has any. Never in the way of the call.
 * Only the AI's own text is taken as what it is thinking: a line Studio wrote into `detail` for it is not.
 */
async function traced(service: Awaited<ReturnType<typeof createStudioService>>, input: unknown, result: unknown) {
  const request = ExternalBridgeRequestSchema.parse(input)
  const kind = { updateExternalTask: "write", lookExternalTask: "look", selfReviewExternalTask: "review", finalReviewExternalTask: "review" }[request.method as string] as "write" | "look" | "review" | undefined
  if (!kind) return
  const given = z.looseObject({ projectId: z.uuid(), runId: z.uuid(), taskId: z.uuid(), detail: z.string().optional(), next: z.array(z.string()).optional(), verdict: z.unknown().optional() }).parse(request.input)
  if (request.method === "finalReviewExternalTask" && given.verdict === undefined) return
  const progress = await service.externalRunner.getExternalProgress({ projectId: given.projectId, runId: given.runId })
  const task = progress.run.tasks.find((value) => value.id === given.taskId)
  if (!task) return
  const draft = progress.drafts[given.taskId]?.draft ?? undefined
  const wrote = request.method === "lookExternalTask" || (result as { script?: unknown } | null)?.script !== undefined || (request.input as { draft?: unknown }).draft !== undefined
  await service.makingHistory.record({ projectId: given.projectId, assetId: task.asset_id, kind, note: given.detail ?? given.next?.[0] ?? null, ...(wrote && draft ? { document: draft } : {}) })
}

/** Said to the person when an outside AI's call did not have the shape a tool takes. The AI itself is given every field that was wrong. */
export const CALL_UNREADABLE = "AI 发来的这一次调用，Studio 读不懂（内容的格式不对）。已经把哪里不对告诉它了，它会改好再发。"

/**
 * A refusal as the outside AI is given it, and whether those words were written for a person. A call of the wrong shape is refused with
 * the schema's own messages, which the AI needs and which are English: the person is told in a sentence, and the original (`raw`) is for 高级.
 */
export function refusedWords(error: unknown) {
  const shown = externalError(error)
  const message = shown instanceof Error ? shown.message : String(shown)
  if (error instanceof z.ZodError) return { plain: true, message: CALL_UNREADABLE, raw: message }
  // A refusal that quotes the code (a failed check) has a sentence for the person of its own; the quoted original stays for 高级.
  if ((error instanceof MakingRefusal || error instanceof AcceptanceRefusal) && error.plain) return { plain: true, message: error.plain, raw: message }
  return { plain: shown instanceof StudioError, message }
}

async function route(service: Awaited<ReturnType<typeof createStudioService>>, input: unknown) {
  const request = ExternalBridgeRequestSchema.parse(input)
  // Said in the names the person sees, for the AI to pass on.
  if ((await service.getConnection()).mode !== "mcp") throw new StudioError("MineMods Studio 还没有接受外部 AI。请用户点击 Studio 顶栏的 AI 连接状态，选「用我自己的 AI 助手」，按三步向导接上后再试。")
  if (request.method === "lookExternalTask") {
    const given = ExternalLookInputSchema.parse(request.input)
    if (given.assetId)
      return service.lookAudio(ExternalAudioLookInputSchema.parse(request.input))
    return service.externalRunner.lookExternalTaskWithReceipt(given, (result) => traced(service, input, result).catch(() => undefined))
  }
  if (request.method === "getCapabilities") {
    const { projectId } = z.strictObject({ projectId: z.uuid().optional() }).parse(request.input)
    const targets = projectId ? await service.projectTargets(projectId) : undefined
    const settings = await service.getSettings()
    // 个人设置: a window already at work reads the person's standing wishes here, as they are now. Nothing said: an empty string.
    return { ...getMcpCapabilities(settings.modelComplexity, { review: reviewEnabled(await service.getConnection()), target: targets?.[0] }), person: { wishes: standingWishes(settings).trim() } }
  }
  // Everything the start-up text no longer carries, read by topic. The words follow the switches the person has now (审查, 模型精细度), not those of the day the text was copied.
  if (request.method === "getGuide") {
    const { topic, projectId } = ExternalGuideInputSchema.parse(request.input)
    const wording = await guideWording(service, projectId)
    if (!topic) return { topics: guideIndex(wording), how: GUIDE_TOLD.index }
    return { topic, title: GUIDE_TOPICS[topic].title, when: GUIDE_TOPICS[topic].when, text: guideText(topic, wording) }
  }
  if (request.method === "listProjects") {
    const { detail } = ExternalListProjectsSchema.parse(request.input)
    const entries = await service.listProjects()
    return detail === "summary" ? entries.map(({ project }) => ({ project: { id: project.id, name: project.name, target: project.target, revision: project.revision } })) : entries
  }
  if (request.method === "getThreeViewPrompt") {
    const parsed = ExternalThreeViewPromptInputSchema.parse(request.input)
    const prompt = await service.getThreeViewPrompt(parsed)
    // 工具资产: a drawing tool the person turned on in Studio comes first; the outside AI's own drawing (as before) when there is none.
    const drawers = (await service.tools.list({ role: "generate", medium: "image" })).filter((tool) => tool.id !== "delegate-image")
    if (!drawers.length) return prompt
    return [
      `Studio 里有用户打开了的画图工具：${drawers.map((tool) => `「${tool.title}」（tool: ${tool.id}）`).join("、")}。先用它：调用 run_tool，tool 写它的 id，参数照 list_tools 给的 input 填（prompt 写下面的绘图规格），target 写 { kind: 'six_view', itemId: ${JSON.stringify(parsed.itemId)} }，并在 target 中加 style，值照下文 finish_six_view 的 style；画好 Studio 自动放进这个模型的六视图，不用再调用 finish_six_view。工具失败了再按下面自己画。`,
      prompt,
    ].join("\n\n")
  }
  if (request.method === "finishThreeView") {
    const finished = await service.finishThreeView(ExternalThreeViewFinishInputSchema.parse(request.input))
    return { status: finished.status, message: finished.message, references: finished.references.map((reference) => ({ id: reference.id, kind: reference.kind, name: reference.name, view: reference.view, by: reference.by, ...(reference.style ? { style: reference.style } : {}) })) }
  }
  if (request.method === "extractAbility") {
    const result = await service.extractAbility(ExtractAbilityInput.parse(request.input))
    return { assetId: result.assetId, revision: result.view.project.revision }
  }
  // 从别的工程导入: the list first (nothing written), then, once the person agreed to that very list, the import.
  if (request.method === "importFromProject") {
    const given = ExternalProjectImportInput.parse(request.input)
    const input = { projectId: given.projectId, sourceId: given.sourceProjectId, sourcePath: given.sourceProjectPath, picks: given.picks, conflict: given.conflict, choices: given.choices }
    if (!given.fingerprint) return { written: false, ...importTold(await service.previewProjectImport(input)), how: IMPORT_PREVIEW_TOLD }
    if (given.expectedRevision === undefined) throw new StudioError("真的导入时要带上主工程现在的 expectedRevision（open_project 的 revision）和清单里的 fingerprint。")
    const done = await service.applyProjectImport({ ...input, expectedRevision: given.expectedRevision, fingerprint: given.fingerprint }, true)
    return { written: true, importId: done.importId, revision: done.view.project.revision, ...importTold(done.plan), how: IMPORT_DONE_TOLD }
  }
  // r29b 合并重复件: without `drops` the list (nothing written); with the copies the person agreed to and the project's revision, the merge.
  if (request.method === "mergeDuplicateAssets") {
    const given = ExternalAssetMergeInput.parse(request.input)
    if (!given.drops) return { written: false, duplicates: (await service.listDuplicateAssets({ projectId: given.projectId })).map(duplicateTold), how: MERGE_LIST_TOLD }
    if (given.expectedRevision === undefined) throw new StudioError("真的合并时要带上工程现在的 expectedRevision（open_project 的 revision）。")
    const done = await service.mergeDuplicateAssets({ projectId: given.projectId, expectedRevision: given.expectedRevision, drops: given.drops }, true)
    return { written: true, mergeId: done.mergeId, revision: done.view.project.revision, merged: done.pairs.map(duplicateTold), how: MERGE_DONE_TOLD }
  }
  if (request.method === "undoAssetMerge") {
    const done = await service.undoAssetMerge(AssetMergeUndoInput.parse(request.input), true)
    return { undone: true, revision: done.view.project.revision }
  }
  if (request.method === "undoProjectImport") {
    const done = await service.undoProjectImport(ExternalProjectUndoInput.parse(request.input), true)
    return { undone: true, revision: done.view.project.revision }
  }
  if (request.method === "listAudioInbox") return service.listAudioInbox(z.strictObject({projectId:z.uuid()}).parse(request.input))
  if (request.method === "importAudioInbox") {
    const { InboxImport } = await import("../audio-requests")
    const result = await service.importAudioInbox(InboxImport.parse(request.input))
    return {assetId:result.assetId,revision:result.view.project.revision,seconds:result.seconds,cut:result.cut}
  }
  if (request.method === "openProject") {
    const { projectId, detail, assetId } = ExternalOpenProjectSchema.parse(request.input)
    if (assetId) return service.projectAsset(projectId, assetId)
    if (detail === "summary") return service.projectSummary(projectId)
    const view = await service.openProject(projectId)
    const status = externalAssetStatus(view.project)
    return { ...view, project: { ...view.project, workspace: { ...view.project.workspace, assets: view.project.workspace.assets.map((asset) => ({ ...asset, status: status(asset) })) } } }
  }
  if (request.method === "createProject") {
    // `target`: the game version × loader to make it for, an id from get_capabilities' build_targets; left out, the default. Studio refuses one that is not ready.
    const { target, ...named } = z
      .strictObject({ name: z.string(), description: z.string(), modId: z.string().optional(), target: TargetIdSchema.optional() })
      .parse(request.input)
    const parsed = StudioRequestSchema.parse({ method: "createProject", input: { ...named, ...(target ? { targetId: target } : {}), empty: true } })
    if (parsed.method !== "createProject") throw new StudioError("工程创建请求无效。")
    const made = await service.createProject(parsed.input)
    // What to tell the person about where the project is. An AI left to guess named a button that does not lead there, and the person never found the project.
    return { ...made, where_to_look: PROJECT_MADE_TOLD(made.project.name) }
  }
  if (request.method === "moduleSchema") {
    const { module, projectId } = ExternalModuleSchemaInputSchema.parse(request.input)
    const target = projectId ? (await service.projectTargets(projectId))[0] : undefined
    const complexity = (await service.getSettings()).modelComplexity
    return {
      module,
      label: MODULES[module].label,
      // broad20: this is the button's own level; the range of a creature's model that its tier raises is the one in that task's instructions (claim_task), said once there.
      instructions: `${module === "gameplay" ? MODULES.gameplay.instructions.replace(GAMEPLAY_INSTRUCTIONS, target ? gameplayInstructions(target) : "请带上 projectId 重读，以取得当前工程目标的完整玩法代码说明。") : MODULES[module].instructions}${module === "model" ? `${modelComplexityInstructions(complexity)}${DETAIL_WORDS.told}` : ""}`,
      capability: MODULES[module].capability,
      targets: kindTargets(module),
      references: MODULES[module].references,
      schema: z.toJSONSchema(getModuleSchema(module), { target: "draft-7" }),
      // Set for the kinds made by looking: the order of work commit_task holds them to.
      // Round 10: and for a creature, which is looked at and reviewed when it has abilities.
      making: isLooked(module) ? MAKING_SUMMARY : isSheetless(module) ? ABILITY_REVIEW_GUIDE : null,
    }
  }
  if (request.method === "heartbeat") return { ready: true }
  if (request.method === "cancelExternalRun")
    return service.externalRunner.cancelExternalRun(ExternalRunInputSchema.parse(request.input))
  if (request.method === "getBlueprint") {
    const view = await service.blueprints.external.getBlueprint(request.input)
    return { ...view, guide: blueprintGuide(view, await guideWording(service, z.object({ projectId: z.uuid() }).parse(request.input).projectId)) }
  }
  if (request.method === "proposeBlueprint") return service.blueprints.external.proposeBlueprint(request.input)
  if (request.method === "proposeIdeas") return service.blueprints.external.proposeIdeas(request.input)
  if (request.method === "getIdeas") return service.blueprints.external.getIdeas(request.input)
  if (request.method === "awaitBlueprintDecision") return service.blueprints.external.awaitBlueprintDecision(request.input)
  if (request.method === "nextBatch") return service.blueprints.external.nextBatch(request.input)
  if (request.method === "buildProject") {
    const parsed = BuildProjectInputSchema.parse(request.input)
    const started = await service.buildProject(parsed)
    return { ...started, job: buildTold(await service.getJob({ projectId: parsed.projectId, jobId: started.jobId })) }
  }
  if (request.method === "getBuild") {
    const parsed = BuildJobInputSchema.parse(request.input)
    const job = await service.getJob(parsed)
    if (job.kind !== "build") throw new StudioError("指定 job 不是构建任务。")
    return buildTold(job)
  }
  // 「测试场」: the windowless check of a finished build. The game's server is started on this computer only; no window opens.
  if (request.method === "checkScene") {
    const parsed = BuildJobInputSchema.parse(request.input)
    const started = await service.startSceneCheck(parsed)
    return { ...started, scene_check: await service.getJob({ projectId: parsed.projectId, jobId: started.jobId }), how: SCENE_TOLD.started }
  }
  if (request.method === "getSceneCheck") {
    const job = await service.getJob(BuildJobInputSchema.parse(request.input))
    if (job.kind !== "scene_check") throw new StudioError("指定 job 不是测试场的检查。")
    return { scene_check: job, how: job.state === "completed" ? SCENE_TOLD.done : SCENE_TOLD.started }
  }
  // Data-only gameplay (Engineer C): read-only, by rule; nothing is built and no game is started.
  if (request.method === "getModGuide") {
    const report = await service.getModGuide(BuildProjectInputSchema.parse(request.input), true)
    return { revision: report.revision, guide: report.markdown, findings: report.findings }
  }
  if (request.method === "exportModel") {
    const exported = await service.exportModel(ExportModelInputSchema.parse(request.input))
    return { ...exported, formats: MODEL_EXPORT_WORDS.files }
  }
  if (request.method === "inspectModel") {
    const parsed = InspectModelInputSchema.parse(request.input)
    const view = await service.openProject(parsed.projectId)
    if (view.project.id !== parsed.projectId) throw new StudioError("工程身份与请求不一致。")
    const asset = view.project.workspace.assets.find((value) => value.id === parsed.modelAssetId)
    if (!asset || asset.module !== "model" || asset.document.kind !== "model" || asset.status !== "ready")
      throw new StudioError("模型资产不存在、未就绪或不属于当前工程。")
    const entity = view.project.entities.find((value) => value.id === asset.id)
    if (!entity) throw new StudioError("模型资产没有对应生物。")
    const preview = await service.getEntityPreview({ projectId: parsed.projectId, entityId: entity.id })
    // broad20: a creature's model is held to the detail its tier raises it to (the confirmed blueprint's), as the review that decided its hand-in was.
    const blueprint = view.project.blueprint?.state === "confirmed" ? view.project.blueprint : null
    const complexity = detailForModel(blueprint?.entries ?? [], view.project.workspace.assets, asset.id, (await service.getSettings()).modelComplexity)
    return {
      asset_id: asset.id,
      ...preview,
      // The same review a hand-in gets, on the model as the project holds it now (in the texture it wears, if any).
      quality: preview.model ? told(reviewAsset(view.project, asset, { complexity, insisted: true }), true) : null,
    }
  }
  if (request.method === "prepareReverseProject")
    return service.reverseService.prepare(z.strictObject({ id: z.uuid() }).parse(request.input))
  if (request.method === "getReverseState")
    return service.reverseService.state(z.strictObject({ id: z.uuid() }).parse(request.input).id)
  if (request.method === "listReverseFiles")
    return service.reverseService.files(
      z.strictObject({ id: z.uuid(), prefix: z.string().max(512).optional() }).parse(request.input),
    )
  if (request.method === "readReverseFile")
    return service.reverseService.read(
      z.strictObject({ id: z.uuid(), path: z.string().min(1).max(512) }).parse(request.input),
    )
  if (request.method === "startReverseTask")
    return service.reverseService.startModel({
      ...z.strictObject({ id: z.uuid(), prompt: z.string().max(20000).optional() }).parse(request.input),
      external: true,
    })
  if (request.method === "getReverseTask")
    return service.reverseService.task(
      z
        .strictObject({
          id: z.uuid(),
          runId: z.uuid(),
          paths: z.array(z.string().min(1).max(512)).max(32).optional(),
          prefix: z.string().max(512).optional(),
        })
        .parse(request.input),
    )
  if (request.method === "submitReverseTask") {
    const input = z.strictObject({ id: z.uuid(), runId: z.uuid(), result: z.unknown() }).parse(request.input)
    return service.reverseService.submit(input.id, input.runId, input.result)
  }
  if (request.method === "applyReversePlan") {
    const input = z.strictObject({ id: z.uuid(), runId: z.uuid() }).parse(request.input)
    return service.reverseService.apply(input.id, input.runId)
  }
  if (request.method === "buildReverseModule")
    return service.reverseService.build(
      z.strictObject({ id: z.uuid(), moduleId: z.string().min(1).max(128) }).parse(request.input),
    )
  if (request.method === "cancelReverseOperation") {
    const input = z.strictObject({ id: z.uuid(), operationId: z.uuid() }).parse(request.input)
    return service.reverseService.cancel(input.id, input.operationId)
  }
  if (request.method === "getImportAssetSelection")
    return service.importAssets.selection(z.strictObject({ id: z.uuid() }).parse(request.input))
  if (request.method === "prepareImportAssetGraphAnalysis" || request.method === "startImportAssetGraphAnalysis") {
    const input = z
      .strictObject({ id: z.uuid(), nodeIds: z.array(z.string().min(1).max(128)).min(1).max(80).optional() })
      .parse(request.input)
    return request.method === "prepareImportAssetGraphAnalysis"
      ? service.importAssetGraphAnalysis.prepare(input)
      : service.importAssetGraphAnalysis.start(input)
  }
  if (request.method === "getImportAssetGraphAnalysis") {
    const run = await service.importAssetGraphAnalysis.get(z.strictObject({ id: z.uuid() }).parse(request.input))
    return {
      run,
      instructions: IMPORT_ASSET_GRAPH_INSTRUCTIONS,
      structured_prompt: IMPORT_ASSET_GRAPH_STRUCTURED_PROMPT,
      response_schema: z.toJSONSchema(GraphAnalysisResultSchema),
    }
  }
  if (request.method === "submitImportAssetGraphAnalysis")
    return service.importAssetGraphAnalysis.submit(
      z
        .strictObject({ id: z.uuid(), contextId: z.string().regex(/^[a-f0-9]{64}$/), result: z.unknown() })
        .parse(request.input),
    )
  if (request.method === "cancelImportAssetGraphAnalysis")
    return service.importAssetGraphAnalysis.cancel(z.strictObject({ id: z.uuid() }).parse(request.input))
  if (request.method === "buildImportAssetGraph") {
    const graph = await service.importAssets.buildGraph(z.strictObject({ id: z.uuid() }).parse(request.input))
    return {
      projectId: graph.projectId,
      catalogSha256: graph.catalogSha256,
      graphSha256: graph.graphSha256,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      coverage: graph.coverage,
    }
  }
  if (request.method === "getImportAssetGraph") {
    const input = z
      .strictObject({
        id: z.uuid(),
        nodeId: z.string().min(1).max(128).optional(),
        kind: ImportAssetGraphNodeSchema.shape.kind.optional(),
        query: z.string().max(512).optional(),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(100).default(40),
      })
      .parse(request.input)
    const graph = await service.importAssets.graph(input)
    const items = graph.nodes.filter(
      (node) =>
        (!input.nodeId || node.id === input.nodeId) &&
        (!input.kind || node.kind === input.kind) &&
        (!input.query ||
          `${node.name} ${node.resourceId ?? ""} ${node.sourcePath ?? ""}`
            .toLowerCase()
            .includes(input.query.toLowerCase())),
    )
    const selected = items.slice(input.offset, input.offset + input.limit)
    const selectedIds = new Set(selected.map((node) => node.id))
    const relations = graph.edges.filter((edge) => selectedIds.has(edge.from) || selectedIds.has(edge.to))
    const edges = relations.slice(0, 150)
    const relatedIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]))
    return {
      projectId: graph.projectId,
      catalogSha256: graph.catalogSha256,
      graphSha256: graph.graphSha256,
      total: items.length,
      nodes: selected,
      relatedNodes: graph.nodes.filter((node) => relatedIds.has(node.id) && !selectedIds.has(node.id)),
      edges,
      edgesTruncated: relations.length > edges.length,
      coverage: graph.coverage,
      nextOffset: input.offset + input.limit < items.length ? input.offset + input.limit : null,
    }
  }
  if (request.method === "extractImportAssets") {
    const catalog = await service.importAssets.extract(
      z
        .strictObject({ id: z.uuid(), groupIds: z.array(z.string().min(1).max(128)).min(1).max(2048) })
        .parse(request.input),
    )
    return {
      projectId: catalog.projectId,
      sourceSha256: catalog.sourceSha256,
      groups: catalog.groups,
      assetCount: catalog.assets.length,
      warnings: catalog.warnings,
    }
  }
  if (request.method === "getImportedAssetCatalog") {
    const input = z
      .strictObject({
        id: z.uuid(),
        query: z.string().max(512).optional(),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(request.input)
    const catalog = await service.importAssets.catalog(input)
    if (!catalog) return { projectId: input.id, total: 0, assets: [], nextOffset: null }
    const items = catalog.assets.filter(
      (asset) =>
        !input.query || `${asset.kind} ${asset.resourcePath}`.toLowerCase().includes(input.query.toLowerCase()),
    )
    return {
      projectId: catalog.projectId,
      sourceSha256: catalog.sourceSha256,
      total: items.length,
      assets: items.slice(input.offset, input.offset + input.limit),
      nextOffset: input.offset + input.limit < items.length ? input.offset + input.limit : null,
    }
  }
  if (request.method === "readImportedAssetFile")
    return service.importAssets.read(
      z.strictObject({ id: z.uuid(), assetId: z.string().min(1).max(128) }).parse(request.input),
    )
  if (request.method === "saveImportedAssetFile") {
    const input = z
      .strictObject({
        id: z.uuid(),
        assetId: z.string().min(1).max(128),
        expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
        content: z.string().max(4 * 1024 * 1024),
      })
      .parse(request.input)
    const catalog = await service.importAssets.save(input)
    return { projectId: catalog.projectId, asset: catalog.assets.find((asset) => asset.id === input.assetId) }
  }
  if (request.method === "listImports") {
    z.strictObject({}).parse(request.input)
    const projects = await service.library.listImportedProjects()
    return {
      projects: await Promise.all(
        projects.map(async (project) => ({
          manifest: project.manifest,
          report: project.report,
          runs: await service.importAnalysis.list(project.manifest.id),
        })),
      ),
    }
  }
  if (request.method === "startImportTask") {
    const parsed = z
      .strictObject({ id: z.uuid(), prompt: z.string().trim().max(20000).optional() })
      .parse(request.input)
    return service.importAnalysis.start({ ...parsed, external: true })
  }
  if (request.method === "getImportTask") {
    const parsed = z
      .strictObject({ id: z.uuid(), runId: z.uuid(), paths: z.array(z.string().min(1).max(512)).max(32).optional() })
      .parse(request.input)
    return service.importAnalysis.task(parsed)
  }
  if (request.method === "submitImportTask") {
    const parsed = z.strictObject({ id: z.uuid(), runId: z.uuid(), result: z.unknown() }).parse(request.input)
    return service.importAnalysis.submit(parsed.id, parsed.runId, parsed.result)
  }
  if (request.method === "applyImportPlan") {
    const parsed = z.strictObject({ id: z.uuid(), runId: z.uuid() }).parse(request.input)
    return service.importAnalysis.apply(parsed.id, parsed.runId)
  }
  if (request.method === "cancelImportTask") {
    const parsed = z.strictObject({ id: z.uuid(), runId: z.uuid() }).parse(request.input)
    return service.importAnalysis.cancel(parsed.id, parsed.runId)
  }
  // What an outside AI is shown of a review is the same for a draft, for the version it is asked to redo and for
  // a saved model: the verdict and each finding in words, without the numbers behind it or the names of the rules.
  if (request.method === "claimExternalTask") {
    const context = await service.externalRunner.claimExternalTask(request.input)
    const { projectId, runId } = ExternalTaskInputSchema.parse(request.input)
    const run = await service.externalRunner.getExternalRun({ projectId, runId })
    // What the person marked on this thing and handed over, readable with its number and where it points, whichever kind the thing is.
    const notes = await service.makingHistory.notesForTask(projectId, context.task.asset_id)
    return { ...context, ...(notes.length ? { notes } : {}), quality: { ...context.quality, existing: context.quality.existing && told(context.quality.existing, true) }, parallel: steered(run), guide: taskGuide(service, runId, context, context.task.module, await guideWording(service, projectId)) }
  }
  if (request.method === "updateExternalTask" || request.method === "getExternalProgress") {
    const progress = await service.externalRunner[request.method](request.input)
    return { ...progress, drafts: Object.fromEntries(Object.entries(progress.drafts).map(([id, draft]) => [id, { ...draft, ...(draft.quality ? { quality: told(draft.quality, true) } : {}) }])) }
  }
  // A task saved or given up frees a place, and may free the tasks that waited for it: the answer says what to claim next.
  if (request.method === "commitExternalTask" || request.method === "failExternalTask") {
    const run = await service.externalRunner[request.method](request.input)
    return { ...run, parallel: steered(run) }
  }
  // 工具资产 (tool-service.ts): the tools Studio runs for an outside AI. A tool's own words (not ready, wrong parameters) reach it as Studio's.
  if (request.method === "listTools" || request.method === "runTool" || request.method === "getToolRun" || request.method === "finishToolRun") return toolCall(service, request.method, request.input)
  return service.externalRunner[request.method](request.input)
}

const ToolListInputSchema = z.strictObject({ role: z.enum(["generate", "convert", "check"]).optional(), medium: z.enum(["sound", "image", "video"]).optional() })
const ToolRunInputSchema = z.strictObject({ projectId: z.uuid(), tool: z.string().min(1).max(60), input: z.record(z.string(), z.unknown()), target: SixViewToolTargetSchema.optional() })
const ToolRunReadSchema = z.strictObject({ projectId: z.uuid(), run: z.uuid() })
const ToolFinishSchema = z.strictObject({ projectId: z.uuid(), run: z.uuid(), file: z.string().max(48 * 1024 * 1024).optional(), unsupported: z.string().min(1).max(1000).optional() })

async function toolCall(service: Awaited<ReturnType<typeof createStudioService>>, method: "listTools" | "runTool" | "getToolRun" | "finishToolRun", input: unknown) {
  try {
    if (method === "listTools") {
      const filters = ToolListInputSchema.parse(input ?? {})
      return { tools: await service.tools.list(filters), how: TOOLS_TOLD, ...(!filters.medium && !filters.role ? { asset_management: ASSET_ACTIONS } : {}) }
    }
    if (method === "runTool") {
      const given = ToolRunInputSchema.parse(input)
      if (given.tool === "asset_management") throw new StudioError("资产管理里任选一个动作作为 tool：rename_asset、duplicate_asset、delete_asset 或 restore_deleted_asset。用 open_project（detail: summary）读最新 revision 和资产 UUID，参数见 get_capabilities 的 asset_management。")
      if (isAssetAction(given.tool)) {
        if (given.target) throw new StudioError("管理资产时把编号放到 input 里，不用 target。")
        return await runAssetAction(service, given.tool, given.projectId, given.input)
      }
      return { run: await service.tools.start(given), how: TOOL_RUN_TOLD }
    }
    if (method === "getToolRun") {
      const run = service.tools.get(ToolRunReadSchema.parse(input))
      // A check's frames come back as pictures (the MCP side sends them as images), with what to look for; the run itself without them.
      const saved = run.product?.saved as { pictures?: { label: string; url: string }[]; look_for?: string } | null | undefined
      if (saved?.pictures?.length) return { run: { ...run, product: { ...run.product!, saved: { look_for: saved.look_for, frames: saved.pictures.length } } }, look_for: saved.look_for, pictures: saved.pictures }
      return { run }
    }
    return { run: await service.tools.finish(ToolFinishSchema.parse(input)) }
  } catch (error) {
    if (error instanceof ToolRunError) throw new StudioError(error.plain)
    if (error instanceof RevisionConflictError) throw new StudioError("工程已被改动。用 open_project（detail: summary）确认对象和最新 revision，再重试。")
    throw error
  }
}

/** An import's list as the outside AI is given it: each thing with why it comes, what happens to it and every name it changes; the main project's notes; what cannot be done. */
const duplicateTold = (pair: DuplicatePair) => ({ kind: pair.kind, keep: pair.keep, drop: pair.drop, from: pair.from, differs: pair.fields })
const MERGE_LIST_TOLD = "这只是清单，什么都没写。每一项是以前从别的工程导入时改名另存的一份（drop），和主工程里原来那份（keep）；differs 是两份不一样的字段。用日常的话告诉用户，合并以后只留 keep，用到 drop 的地方都改成指向 keep，drop 里的不同之处不会留下。用户同意了，再带上要合并的 drop 编号（drops）和工程的 expectedRevision 调一次才会真的合并。"
const MERGE_DONE_TOLD = "已经合并（revision 加了一）。合并错了可以用 undo_merge_duplicate_assets（传 mergeId 和工程最新的 revision）撤销；合并以后工程又改过就不能撤。"
const importTold = (plan: ImportPlan) => ({
  source: { id: plan.source.id, name: plan.source.name, mod_id: plan.source.mod_id, targets: plan.source.targets },
  main: { id: plan.main.id, name: plan.main.name, mod_id: plan.main.mod_id, revision: plan.main.revision, targets: plan.main.targets },
  items: plan.items.map((item) => ({ sourceId: item.source_id, title: item.title, kind: item.kind, why: item.why, action: item.action, assetId: item.target_id, same_as: item.same_as?.title ?? null, renamed: item.renames.filter((rename) => rename.what !== "id").map((rename) => ({ what: rename.what, from: rename.from, to: rename.to })), ...(item.namesake ? { namesake: { title: item.namesake.title, differs: item.namesake.fields } } : {}), ...(item.again ? { again: { title: item.again.title, edited: item.again.edited } } : {}) })),
  left_out: plan.left_out.map((thing) => ({ title: thing.title, why: thing.why })),
  notes: plan.notes.map((note) => note.text),
  blocked: plan.blocked,
  fingerprint: plan.fingerprint,
})
const IMPORT_PREVIEW_TOLD = "这只是清单，什么都没写。用日常的话告诉用户：会带进来哪些东西、为什么带（why）、哪些改了名（renamed）、主工程那边有什么提醒（notes），blocked 不为空时说明为什么导不了、要先改什么。用户同意了，再用同样的参数加上这里的 fingerprint 和主工程的 expectedRevision 调一次 import_from_project 才会真的导入。"
const IMPORT_DONE_TOLD = "已经写进主工程（revision 加了一）。源工程没有改。导错了可以用 undo_project_import（传 importId 和主工程最新的 revision）撤销。"
const TOOLS_TOLD = "这些是用户在 Studio 里打开了的工具，参数照每个工具的 input 填。列表会随时变（用户放进、拿走或停用工具），每次要用之前重新读。没有合适的就如实告诉用户，不要自己找别的程序或服务代替。"
const TOOL_RUN_TOLD = "工具在 Studio 里跑：用 get_tool_run 轮询到 completed 或 failed。state 是 waiting 时照 ask 做，做好用 finish_tool_run 交回。"

/**
 * The switches the guide's words follow: 「审查」 and 「模型精细度」 as the person has them now, and, for a project's own task or plan (`projectId`),
 * the targets it is built for, so the game, loader and Java it is told are its own. Without one, every ready target.
 */
async function guideWording(service: Awaited<ReturnType<typeof createStudioService>>, projectId?: string): Promise<GuideInput> {
  const wording = { review: reviewEnabled(await service.getConnection()), complexity: (await service.getSettings()).modelComplexity }
  return projectId ? { ...wording, targets: await service.projectTargets(projectId) } : wording
}

/** What `get_guide` and the answers that carry a guide say about reading it. */
export const GUIDE_TOLD = {
  index: "按主题读：把 topic 填成下面某个 id。领任务时 claim_task 的返回里已经带着这一类任务的说明，这里用来重读，或者在领任务之前先读。",
  again: (topics: readonly GuideTopicId[]) => `这一类的说明在这一批里已经给过一次（领取同一类的别的任务时），内容没有变。记不清了用 get_guide 重读：${topics.join("、")}。`,
  read: "先读完这段再动手；它和这个返回里的 instructions、schema、quality 一起，是这一类任务的全部说明。",
} as const

/**
 * The parts of a guide a run was already given, by the Studio that gave them. A batch of tasks of one kind would otherwise carry the same
 * rules once for each; the first claim of a kind in a run carries them whole, the next ones say where they were given. A run is one batch, so
 * the next batch brings them again. Studio restarting forgets it, and a run does not survive that.
 */
const given = new WeakMap<object, Map<string, Map<string, string>>>()

/** The guide of a claimed task: the topics of its kind, whole the first time in this run, and what to read where it was not repeated. */
export function taskGuide(service: object, runId: string, claim: Pick<ExternalTaskContext, "instructions" | "making">, kind: ModuleKind, wording: GuideInput) {
  const runs = given.get(service) ?? new Map<string, Map<string, string>>()
  given.set(service, runs)
  const seen = runs.get(runId) ?? new Map<string, string>()
  runs.set(runId, seen)
  const topics = CLAIM_GUIDE[kind]
  const parts = claimSegments(kind, wording)
  // A part the claim carries in a field of its own is not said twice, as long as that field really holds it.
  const carried = { instructions: claim.instructions, "making.discipline": claim.making?.discipline ?? "", "making.reference_guide": claim.making?.reference_guide ?? "" }
  const elsewhere = parts.filter((part) => part.same && carried[part.same.in].includes(part.same.text) && (part.same.text !== "" || carried[part.same.in] !== ""))
  const own = parts.filter((part) => !elsewhere.includes(part))
  const fresh = own.filter((part) => seen.get(part.id) !== part.text)
  const repeated = own.length > fresh.length
  fresh.forEach((part) => seen.set(part.id, part.text))
  const text = topics
    .map((topic) => {
      const mine = fresh.filter((part) => part.topic === topic)
      return mine.length ? `# ${GUIDE_TOPICS[topic].title}（${topic}）\n\n${mine.map((part) => part.text).join("\n\n")}` : null
    })
    .filter((value): value is string => value !== null)
    .join("\n\n")
  return {
    kind,
    topics,
    text: text || null,
    // Where the rest of this kind's words stand in this same answer.
    also_in: [...new Set(elsewhere.flatMap((part) => (part.same ? [part.same.in] : [])))],
    next_step: [text ? GUIDE_TOLD.read : null, repeated ? GUIDE_TOLD.again(topics) : null].filter(Boolean).join(""),
  }
}

/**
 * `get_blueprint` carries the guide of planning while there is something to plan or redo (no plan yet, a draft, or things the person sent back);
 * once the plan is confirmed and nothing waits, only where to read it again.
 */
export function blueprintGuide(view: { blueprint: { state: string } | null; redo: readonly unknown[] }, wording: GuideInput) {
  const open = !view.blueprint || view.blueprint.state !== "confirmed" || view.redo.length > 0
  return open ? { topic: "blueprint" as const, text: guideText("blueprint", wording) } : { topic: "blueprint" as const, text: null, next_step: "规划规则和重做的做法在 get_guide 的 blueprint 里，需要时重读。" }
}

/** Where the parallel places of a run stand and what to claim next, as an outside AI is shown it with a claim, a commit or a task given up. */
function steered(run: ProjectRun) {
  const plan = parallelPlan(run)
  return { ...plan, next_step: PARALLEL_WORDS.after(plan, run) }
}

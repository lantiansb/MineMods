import { abilityInfo } from "@minemods/mod-core/ability-usage"
import { glyphForecast } from "@minemods/mod-core/glyph-fill"
import { extractAbility } from "@minemods/mod-core/extract-ability"
import { applyProjectImport, duplicateAssets, ImportRefusal, importableThings, listProjectImports, mergeDuplicateAssets, previewProjectImport, undoAssetMerge, undoProjectImport, type ImportPlan } from "@minemods/mod-core/project-import"
import { reviewEnabled } from "../connection"
import { deliveredJarName, deliverJar } from "./jar-delivery"
import { installProgram, programStates, useOwnProgram } from "@minemods/mod-core/tools/programs"
import { TOOLS_FOLDER, toolSecrets, type ToolManifest } from "@minemods/mod-core/tools/manifest"
import { toolSecretNames } from "./tool-secrets"
import { fromBase64 } from "./tool-runner"
import type { ToolsView } from "../api"
import { keepRecording, recordWindow, recordingFile, sceneWindowTitle, videoFrames } from "./tool-video"
import { programPath } from "@minemods/mod-core/tools/programs"
import { listAudioInbox, readInboxFile } from "./audio-inbox"
import {changeSoundMoment} from "./change-sound-moment"
import {musicEvents,MUSIC_SUMMARY} from "@minemods/mod-core/music"
import {vanillaAudio} from "./vanilla-audio"
import { creatureThing, renameThing,copyThing,deleteThing,restoreThing } from "./asset-actions"
import { putAudio, dropAudio, updateSoundSettings } from "./audio-import"
import { readMedia } from "@minemods/mod-core/media"
import { lookAudioAsset } from "./audio-look"
import { createInspectionReceipts } from "./inspection-receipts"
import type { ExternalAudioLookInput } from "../external"
import { saveToolSound, toGameSound, toolSoundNote } from "./tool-sound"
import { ToolRunError } from "./tool-runner"
import { measureSynth, readSynthRecipe, renderSynth, wavFile } from "@minemods/mod-core/tools/synth"
import { createToolService } from "./tool-service"
import { randomUUID } from "node:crypto"
import { TEXTURE_SPACE_ERROR } from "@minemods/studio-ai/model-paint"
import { access, mkdir, readFile, realpath, rename, rmdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import * as projects from "@minemods/mod-core/project"
import * as jobs from "@minemods/mod-core/jobs"
import { detailForModel, governing, sixViewStyleFor, tierForModel } from "@minemods/mod-core/creature-tier"
import { buildWatch, noteActivity, readActivity } from "@minemods/mod-core/activity"
import { BUILD_NETWORK_FAILED, GRADLE_NETWORK, gradleNetworkWords } from "@minemods/mod-core/gradle-network"
import { staleReasonOf } from "@minemods/mod-core/build-stages"
import { CRASH_REASON, CRASH_WORDS, GameCrashedError, crashRemark, crashSentence, crashTarget, type GameCrash } from "@minemods/mod-core/game-crash"
import { buildWordsForCreator } from "@minemods/mod-core/creator-words"
import { BuildWarningSchema } from "@minemods/mod-core/build"
import { BuildStop } from "@minemods/mod-core/build-stop"
import { codedParts, codedWords } from "@minemods/mod-core/coded-errors"
import { EntrypointError } from "@minemods/mod-core/fabric/entrypoints"
import { loadModelAsset, putModelAsset } from "@minemods/mod-core/assets"
import { mushroomCowDesign } from "@minemods/mod-core/example"
import { compileModel, fitModelAtlas } from "@minemods/mod-core/model"
import { compileSavedModel } from "@minemods/mod-core/editable-model"
import { applyContent, compileWorkspaceTexture, unbuiltThings } from "@minemods/mod-core/workspace"
import { externalAssetStatus } from "./external-asset-status"
import { ModelDesignSchema, ModelingInputSchema, ModelingResultSchema } from "@minemods/studio-ai/contracts"
import { createModelingClient } from "@minemods/studio-ai/client"
import { ModelingError } from "@minemods/studio-ai/policy"
import { createModelingContext, requestModelingStep } from "@minemods/ai-service/openai"
import { DELETED_FOLDER, REVISION_CONFLICT, type Receipt, type StudioApi, type StudioView } from "../api"
import { claimProjectFolder } from "../project-folder"
import { listMakings } from "@minemods/mod-core/making"
import { assetUsage, buildProjectOverview } from "@minemods/mod-core/asset-overview"
import { buildReceipt } from "@minemods/mod-core/receipt"
import { ICON_WORDS, ReleaseSchema } from "@minemods/mod-core/release"
import { EnglishNameSchema } from "@minemods/mod-core/data-words"
import { givenIcon, iconBytes, iconUrl } from "@minemods/mod-core/fabric/icon"
import { ProjectSchema } from "@minemods/mod-core/project"
import { WorkerRequestSchema } from "./protocol"
import { ContentSchema } from "@minemods/mod-core/content"
import {
  ArchiveError,
  exportProjectArchive,
  importProjectArchive,
  inspectProjectArchive,
} from "@minemods/mod-core/container"
import { SettingsSchema, standingWishes } from "../settings"
import { aheadMoment } from "../prepare-ahead"
import { createPrepareAhead, type AheadRunners } from "./prepare-ahead-run"
import { blockbenchToDesign, designToBlockbench } from "@minemods/mod-core/blockbench"
import { keptPlayWords } from "@minemods/mod-core/blockbench-keys"
import { modelImportFailure } from "./model-import-words"
import {
  ConceptionSchema,
  ConceptionEntrySchema,
  ConceptionPlanSchema,
  ConceptionReviewSchema,
  applyConceptionPlan,
  conceptionFromPlan,
  type ConceptionEntry,
} from "@minemods/mod-core/conception"
import { requestAuthoring, setStandingWishes, WORLD_INSTRUCTIONS, CONTENT_INSTRUCTIONS } from "./authoring-ai"
import { createModelCoreSession } from "./model-core-session"
import type { ModelProgressEvent } from "@minemods/ai-service/model-stream"
import { createProjectRunner } from "./project-runner"
import { pictureCanBeAsked, requestPicture } from "@minemods/ai-service/image-request"
import { createReferenceService } from "./reference-service"
import { ModelAnnotationError, modelAnnotationContext, validateModelAnnotation } from "./model-annotation"
import { createMakingHistory, HistoryRefusal } from "./making-history"
import { makingLock } from "../renderer/features/making-lock"
import { refusalText, reviewAsset } from "@minemods/mod-core/acceptance"
import { BlueprintError, createBlueprintService, NO_PLANNER } from "./blueprint-service"
import { FIX_WORDS, findingsFeedback, groupFindings, type FixFindingsResult } from "../fix-findings"
import { REVIEW_NOTE_LIMIT } from "@minemods/mod-core/reviews"
import { creatureName } from "@minemods/mod-core/gameplay"
import { SpeechError, transcribeSpeech } from "./speech"
import { responsesConfig } from "@minemods/ai-service/responses-config"
import { probeConnection, type StructuredTransport } from "@minemods/ai-service/structured-request"
import { MODEL_POLICY } from "@minemods/studio-ai/policy"
import { NO_VISION_WORDS } from "@minemods/studio-ai/making"
import { plainContent, SCHEMA_WORDS } from "./plain-content"
export { plainContent } from "./plain-content"
import { MakingRefusal } from "@minemods/mod-core/making"
import { findGameplay, listGameplay, readGameplay, shownGameplay as shownGameplayRecord } from "@minemods/mod-core/gameplay-loop"
import { createContentService, type HandSaveInput } from "./content-service"
import { SCENE, SCENE_EXTRA, SCENE_WORDS } from "@minemods/mod-core/scene"
import { markProgress, type JobMarks } from "./job-marks"
import type { GameplayCompile } from "./gameplay-loop"
import { creatureMoves } from "@minemods/mod-core/combat-design"
import { effectLookup } from "@minemods/mod-core/effect-abilities"
import { creatureTabLook, type LookRenderer } from "./look-job"
import { worldSource } from "@minemods/mod-core/making-world"
import { besidePicture } from "./making-loop"
import {
  ConnectionSettingsSchema,
  ConnectionTestResultSchema,
  ListConnectionModelsInputSchema,
  PublicConnectionSchema,
  SaveConnectionInputSchema,
  type PublicConnection,
  type SaveConnectionInput,
  type TestConnectionInput,
  type ListConnectionModelsInput,
} from "../connection"
import type { ConnectionStore } from "./connection-store"
import { createLibraryService, LibraryError } from "./library-service"
import { repairTitles } from "./title-repair"
import { repairEntryLinks } from "./entry-repair"
import { ImportProjectError } from "@minemods/mod-core/import-project"
import { createImportAnalysisService, ImportAnalysisError } from "./import-analysis-service"
import { createReverseService, ReverseServiceError } from "./reverse-service"
import { createImportAssetService, ImportAssetServiceError } from "./import-asset-service"
import { createImportAssetGraphService, ImportAssetGraphAnalysisError } from "./import-asset-graph-service"
import { javaMajors } from "../project-status"
import { DEFAULT_TARGET, TARGETS, targetById, type GameTarget } from "@minemods/mod-core/targets"
import { TargetIdSchema } from "@minemods/mod-core/target/ids"
import { detectJava, directorySize, freeSpace, pickJava, type JavaFound } from "@minemods/mod-core/java-detect"
import { checkInstallDirectory, ensureJava, gradleReady, gradleWhole, javaDownloadSize, javaInstallSource, ManagedJavaCacheError, MANAGED_JAVA, RuntimeDirectoryError } from "@minemods/mod-core/runtime"
import { COMPILE_COLD_LINE } from "./check-calling"
import { latestSuccessfulBuild, successfulBuild } from "@minemods/mod-core/build-record"
import { packedVersion } from "@minemods/mod-core/packed-version"
import * as preinstalled from "@minemods/mod-core/modrinth"
import type { JavaUse } from "./library-service"

export class StudioError extends Error {}

/** An import refused (the list changed, a check of the main project stopped it, something uses what would be taken out) reaches the person word for word. */
const importError = (error: unknown): never => {
  if (error instanceof ImportRefusal) throw new StudioError(error.message)
  throw error
}
/** What the activity feed says of an import: who did it, from where, how many things, and every name that changed. */
function importActivity(plan: ImportPlan, external: boolean) {
  const added = plan.items.filter((item) => item.action === "add")
  const reused = plan.items.filter((item) => item.action === "reuse")
  const renamed = plan.items.flatMap((item) => item.renames.filter((rename) => rename.what !== "id").map((rename) => `「${item.title}」${rename.what === "title" ? "显示名" : rename.what === "identifier" || rename.what === "registry" ? "注册名" : "游戏里的名字"}改成 ${rename.to}`))
  return {
    kind: "note" as const, mark: "note" as const, item: null, title: null,
    text: `${external ? "外部 AI " : "你"}从「${plan.source.name}」导入了 ${added.length} 样东西${reused.length ? `，${reused.length} 样用了主工程里已有的` : ""}。`,
    lines: [...added.filter((item) => item.kind === "creature").map((item) => `生物「${item.title}」`), ...renamed].slice(0, 12).map((line) => line.slice(0, 200)),
  }
}

/** What 新建工程 and 运行环境 say when they refuse (2026-10-08), one sentence each. */
export const SETUP_WORDS = {
  unknownTarget: "没有这个游戏版本和加载器的组合，请重新选一个。",
  notReady: (target: GameTarget) => `Minecraft ${target.minecraft} · ${preinstalled.loaderName(target.loader)} 现在还不能选。${target.why ?? ""}`,
  javaMissing: "在这个位置没有找到能运行的 Java，请从检测到的列表里选一个。",
  javaUnfit: (why: string) => `这个 Java 不能用来做这个版本的模组：${why}`,
  noInstall: (major: number) => `Studio 还不能在这台电脑上自动安装 Java ${major}。请自己装一个 JDK ${major}，再回来选它。`,
  unpicked: "这个位置没有经过选择，请点「换个位置」重新选一个文件夹。",
  filesGone: "选的文件已经失效，请重新选一次。",
  installing: (vendor: string, version: string, bytes: number | null) => `正在下载 ${vendor} JDK ${version}${bytes ? `（约 ${sizeWords(bytes)}）` : ""}，下载完会自动装好…`,
  installed: (vendor: string, version: string, home: string, bytes: number) => `Java 装好了：${vendor} JDK ${version}，在「${home}」，占用 ${sizeWords(bytes)}。下载的压缩包已经删掉，之后打包会自动用它。`,
  alreadyThere: (major: number, home: string) => `这台电脑上已经有能用的 Java ${major}（在「${home}」），这次没有另外下载。`,
}
// The way a size is said on the 运行环境 card (the same as runtime.ts says free space): GB from one gigabyte, else whole MB.
function sizeWords(bytes: number) {
  const gigabyte = 1024 ** 3
  return bytes >= gigabyte ? `${(bytes / gigabyte).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

// The plan's rules are worded once in mod-core, where an AI planner reads them too. A player has never
// heard of "entries" and "dependencies", so each rule is said again here in their words.
const PLAN_WORDS: [RegExp, string][] = [
  [/(「[^」]*」)是([^，。]+)，必须依赖一个([^。]+?)条目。/g, "$1是$2，还缺一个它要用到的$3。"],
  [/(「[^」]*」)是([^，。]+)，不能依赖([^。]+)。/g, "$1是$2，用不上$3。"],
  [/(「[^」]*」)依赖了不存在的条目。/g, "$1要用到的一样东西在蓝图里找不到了。"],
  [/(「[^」]*」)依赖了不制作的(「[^」]*」)。/g, "$1要用到$2，可是$2这次不做。"],
  [/(「[^」]*」)的 owner 写的是它自己：一样东西不能属于它自己。[^。]*。/g, "$1被写成了属于它自己，这说不通：一样东西不能属于它自己。生物、方块、物品通常不属于谁；只有它们的模型、贴图、玩法这些部件，才要写明属于哪一样东西。"],
  [/(「[^」]*」)所属的内容不存在，或者不是生物、方块、物品这类内容。/g, "$1不知道该算在谁身上：它跟着的那样东西不在蓝图里，或者不是生物、方块、物品。"],
  [/蓝图里的依赖绕成了一个圈。/g, "蓝图里有几样东西互相要用到对方，绕成了一个圈。"],
  [/蓝图里有重复的条目标识。/g, "蓝图里有两样东西撞名了。"],
  [/蓝图里有两个条目指向同一个已做好的内容。/g, "蓝图里有两样东西指着同一份做好的内容。"],
  [/蓝图里没有这个条目。/g, "蓝图里没有这样东西。"],
  [/要关联的内容不存在，或者种类和条目不一致。/g, "要连上的那样东西不存在，或者不是同一种东西。"],
  [/蓝图已经更新，请先查看最新版本再(保存|确认)。/g, "别处刚改过蓝图，已为你刷新。请看一眼再$1。"],
]

export function plainPlan(message: string) {
  return PLAN_WORDS.reduce((text, [pattern, words]) => text.replace(pattern, words), message)
}

/** The kind of an error and the first place in Studio's own code it was thrown from, as `TypeError，在 scene.ts:212`: no message, no folder. Null when the stack says neither. */
export function errorSite(error: Error) {
  const kind = error.name && error.name !== "Error" ? error.name : null
  const frame = (error.stack ?? "")
    .split("\n")
    .slice(1)
    .map((line) => /([\w.-]+\.(?:ts|tsx|js|mjs|cjs)):(\d+)(?::\d+)?\)?\s*$/.exec(line.trim()))
    .find((found) => found && !/node_modules|node:/.test(found[0]))
  const site = frame ? `${frame[1]}:${frame[2]}` : null
  return kind || site ? [kind, site ? `在 ${site}` : null].filter(Boolean).join("，") : null
}

/**
 * Another writer holds the project's lock (`withProjectLock`). The person and an outside AI used to read 「操作未完成…」 with a line of Studio's code and
 * could not tell it was a lock, let alone what to do. A lock whose writer is gone is cleared by Studio itself and never gets here; what is left is said by case.
 */
export function lockedWords(error: projects.ProjectLockedError) {
  const kept = "这一步没有做，工程文件没有动。"
  // Its writer is gone and another call is clearing it this very moment (only one may at a time).
  if (error.alive === false) return `${kept}上一次没关干净留下的写入记号正在被清掉：再试一次就好。`
  if (error.holder && error.alive)
    return `${kept}这个工程正被另一个 MineMods Studio（进程号 ${error.holder.pid}）写着：等它写完再试；一直这样，就关掉另一个 Studio 窗口再试。`
  if (error.holder)
    return `${kept}这个工程带着一个写入记号，Studio 没法确认留下它的程序还在不在（它是别的电脑或者别的程序留下的）。确认没有别的 MineMods Studio 开着这个工程以后，删掉工程文件夹里的 .minemods\\write.lock 这个文件夹，再试一次。`
  return `${kept}这个工程带着一个写入记号，是旧版 Studio 留下的，或者别的 Studio 正在写。先关掉别的 MineMods Studio 窗口再试；如果是上次没关干净留下的，Studio 会在它留下 ${Math.round(projects.OWNERLESS_LOCK_MS / 60000)} 分钟以后自己清掉，不想等就删掉工程文件夹里的 .minemods\\write.lock 这个文件夹。`
}

/**
 * `find` reads the project the failure happened in, so a coded message that names a thing by id (`SAVED_MODEL_REQUIRED:<id>`) is said
 * with that thing's name (see `coded-errors.ts`). Left out, the sentence still says what is wrong, without the name.
 */
/** Books in a project: a book is content of its own (r28 复验: a project of only a book and its pictures was refused a build its instructions promised). */
const projectBookCount = (project: Pick<projects.Project, "workspace">) => project.workspace.assets.filter((asset) => asset.document.kind === "book").length
/** Whether a project has anything a build makes into the mod: a creature, a block, an item or a book (whose own checks then run in the build). */
export const hasBuildContent = (project: Pick<projects.Project, "entities" | "blocks" | "items" | "workspace">) =>
  project.entities.length > 0 || project.blocks.length > 0 || project.items.length > 0 || projectBookCount(project) > 0

export function publicError(error: unknown, find?: Parameters<typeof codedWords>[1]): string {
  if (error instanceof projects.ProjectRecordBusyError) return error.message
  if (error instanceof ModelAnnotationError) return error.message
  if (error instanceof HistoryRefusal) return error.message
  if (error instanceof ImportAssetServiceError) return error.message
  if (error instanceof ImportAssetGraphAnalysisError) return error.message
  if (error instanceof ReverseServiceError) return error.message
  if (error instanceof ImportProjectError) {
    const messages: Record<ImportProjectError["code"], string> = {
      UNSUPPORTED_INPUT: "请选择本机的 JAR、ZIP 或 MRPACK 文件。",
      INPUT_LIMIT: "归档超过当前扫描限制。原始文件大小需不超过 2 GiB。",
      UNSAFE_ARCHIVE: "归档存在异常路径、重复条目或链接，无法安全导入。",
      INVALID_ARCHIVE: "归档损坏、元数据格式异常或超过扫描限制，无法完成导入。",
      PROJECT_CORRUPT: "分析工程的文件缺失或校验不一致，请重新导入原始文件。",
      PROJECT_NOT_FOUND: "分析工程不存在或路径不可用。",
    }
    return messages[error.code]
  }
  if (error instanceof LibraryError) return error.message
  if (error instanceof ImportAnalysisError) return error.message
  if (error instanceof SpeechError) return error.message
  if (error instanceof StudioError) return error.message
  if (error instanceof BlueprintError) return plainPlan(error.message)
  // A step of the making loop refused: the words are already the ones to show.
  if (error instanceof MakingRefusal) return error.message
  // The generator stopped on something the document says and gave the sentence for it (`BuildStop`): shown as it stands, not as "the operation did not finish".
  if (error instanceof BuildStop) return error.message
  if (error instanceof ArchiveError) return error.message
  // The build refused a class the game could not create: the sentence names the class and is the one to show.
  if (error instanceof EntrypointError) return error.message
  if (error instanceof projects.RevisionConflictError) return REVISION_CONFLICT
  if (error instanceof projects.ProjectLockedError) return lockedWords(error)
  if (
    error instanceof z.ZodError &&
    error.issues.some((issue) => issue.message.startsWith("GRAPH_ANALYSIS_CONTEXT_TOO_LARGE"))
  )
    return "资产图上下文超过 160 KB，请减少所选条目后分批解读。"
  if (error instanceof Error && error.message.startsWith("GRAPH_ANALYSIS_")) {
    const code = error.message.split(":")[0]
    const messages: Record<string, string> = {
      GRAPH_ANALYSIS_SELECTION_TOO_LARGE: "一次最多解读 80 个条目，请分批选择。",
      GRAPH_ANALYSIS_SELECTION_REQUIRED: "请先选择需要解读的条目。",
      GRAPH_ANALYSIS_SELECTION_EMPTY: "请至少选择一个条目。",
      GRAPH_ANALYSIS_NODE_NOT_FOUND: "所选条目已变化，请刷新资产图。",
      GRAPH_ANALYSIS_SUBGRAPH_TOO_LARGE: "所选条目的四层关联超过分析预算，请缩小范围后分批解读。",
      GRAPH_ANALYSIS_EVIDENCE_REFERENCE_INVALID: "模型引用了无关、缺失或候选关系的证据，结果已拒绝。",
      GRAPH_ANALYSIS_EDGE_REFERENCE_INVALID: "模型引用了未经确认的关联关系，结果已拒绝。",
      GRAPH_ANALYSIS_CONTEXT_MISMATCH: "结果与当前工程或分析请求不匹配，请领取最新上下文。",
      GRAPH_ANALYSIS_NODE_COVERAGE_MISMATCH: "结果未准确覆盖所选条目，请检查是否重复或遗漏。",
    }
    return messages[code] ?? "资产图解读未通过结构与来源校验，请检查结果后重试。"
  }
  const broken = plainContent(error)
  if (broken) return broken
  if (error instanceof ManagedJavaCacheError || error instanceof RuntimeDirectoryError) return error.detail
  if (error instanceof z.ZodError) return SCHEMA_WORDS
  if (error instanceof ModelingError) {
    const messages: Record<ModelingError["code"], string> = {
      INVALID_INPUT: "生成描述或模型上下文超过当前限制，请缩短描述或减少模型细节。",
      INVALID_OUTPUT: "AI 返回的内容没通过校验，什么都没有改动。请重试；一直这样的话，换个说法或换个模型。",
      MODEL_MISMATCH: "服务返回的模型与所选模型不一致，请检查连接设置中的模型名称。",
      UNAUTHORIZED: "API Key 未通过验证，请到连接设置检查密钥和账户权限。",
      BUDGET_EXCEEDED: "当前生成预算或服务额度不足，请检查额度后重试。",
      NO_API_KEY: "尚未连接模型，请到个人设置选择厂商并填写 API Key。",
      CANCELLED: "已取消，什么都没有改动。",
      TIMEOUT: "AI 太久没有回应，什么都没有改动，请稍后重试。",
      REFUSED: "AI 服务未接受这次生成描述，请调整描述后重试。",
      INCOMPLETE_OUTPUT: "AI 的回答没说完就停了，什么都没有改动。请重试；一直这样的话，换个模型或把要求说短一些。",
      UPSTREAM_UNAVAILABLE: "暂时无法连接模型服务，请检查服务地址和网络后重试。",
      REQUEST_REJECTED: "模型服务连上了，但不接受这次请求，什么都没有改动。重试也会一样；请在连接设置里换一个模型或服务。",
      SERVICE_UNAVAILABLE: "暂时无法连接建模服务，请检查服务地址和网络。",
      NO_VISION: NO_VISION_WORDS,
    }
    return messages[error.code]
  }
  if (error instanceof Error) {
    const java = /^(EXPLICIT_)?JAVA_(17|21)_REQUIRED(_ON_THIS_PLATFORM)?$/.exec(error.message)
    if (java) return java[1]
      ? `当前系统需要手动安装 Java ${java[2]}，并配置 JAVA_HOME 指向 JDK ${java[2]} 目录后重启应用。`
      : `这里需要 Java ${java[2]}。到「运行环境」里换回「自动」或选一个 JDK ${java[2]}。`
    const coded = codedWords(error.message, find ?? (() => null))
    if (coded) return coded.text
    const messages: Record<string, string> = {
      ENVIRONMENT_BUSY: "环境正在使用，请等待当前任务结束。",
      ENVIRONMENT_IN_USE: "环境正在下载、构建或试玩，暂时无法清理。",
      JAVA_RUNTIME_REMOVED_RETRY: "Java 环境已改变，请重新准备环境后再试。",
      UNSUPPORTED_ENVIRONMENT_ITEM: "该文件不属于可清理的托管环境。",
      UNSUPPORTED_ENVIRONMENT_PROFILE: "这个运行环境配置不支持所选目标。",
      UNSAFE_ENVIRONMENT_ITEM: "该环境包含链接或异常文件，请检查后再清理。",
      UNSAFE_RUNTIME_DIRECTORY: "运行时目录不是有效目录，或者是指向别处的联接、那里用不了。",
      UNSAFE_ENVIRONMENT_PATH: "环境路径不符合托管范围，已停止清理。",
      MODEL_TEXTURE_REQUIRED: "模型需要一张 PNG 贴图。请在贴图页创建贴图后保存。",
      MODEL_EMBEDDED_TEXTURE_REQUIRED: "请把模型贴图嵌入工程后保存。",
      MODEL_EXTERNAL_TEXTURE: "模型引用了外部贴图。请在 Blockbench 中嵌入 PNG 后保存。",
      MODEL_TEXTURE_COUNT: "当前游戏导出使用单张贴图，请先把贴图合并为一个图集。",
      MODEL_MULTI_TEXTURE: "模型使用了多张贴图，请先合并为一个图集。",
      MODEL_PNG_INVALID: "PNG 贴图无效，请重新导入 RGBA PNG 后保存。",
      MODEL_PNG_DIMENSIONS: "贴图尺寸与模型 UV 设置不一致，请在贴图页调整尺寸。",
      MODEL_UV_MISSING: "部分模型面还没有 UV，请在贴图页展开 UV 后保存。",
      MODEL_FACE_ROTATION_UNSUPPORTED: "当前游戏导出尚不支持单面 UV 旋转，请将该面的 UV 旋转设为 0。",
      MODEL_TRANSPARENT_FACE_UNSUPPORTED: "部分模型面未绑定贴图，请为这些面指定图集。",
      MODEL_MESH_UNSUPPORTED: "当前游戏导出支持方块模型，请先把网格转为方块。",
      MODEL_EXPRESSION_UNSUPPORTED: "当前游戏导出需要数值关键帧，请将动作表达式转换为数值。",
      MODEL_INTERPOLATION_UNSUPPORTED: "当前游戏导出支持直线、保持、顺滑（Catmull-Rom）和贝塞尔四种关键帧插值，请把其他插值改成这四种之一。",
      MODEL_ANIMATION_NAME_UNSAFE: "动作名称请使用英文字母开头的字母、数字或下划线，长度不超过 48。",
      MODEL_ANIMATION_CHANNEL_UNSUPPORTED: "当前游戏导出支持位移、旋转和缩放的数值关键帧。",
      MODEL_ANIMATION_BONE_UNKNOWN: "动作引用的骨骼不存在，请在动作页重新绑定。",
      MODEL_HIERARCHY_ROOT: "请将骨骼放在同一个根骨骼下，再保存模型。",
      MODEL_HIERARCHY_REQUIRED: "请先创建根骨骼并将方块放入骨骼，再保存模型。",
      MODEL_HIERARCHY_INVALID: "模型的骨骼引用不完整，请检查骨骼列表后保存。",
      CANCELLED: "任务已取消，已保存的工程和模型仍然保留。",
      JAVA_HOME_NOT_FOUND:
        "找不到要用的 Java 了（可能被删掉或移走了）。到「运行环境」里换回「自动」或重新选择工程目标所需的 JDK，再试一次。",
      UNSAFE_JAVA_DIRECTORY: "Java 的安装位置是一个指向别处的链接，Studio 不往链接里装。到「运行环境」里换一个普通文件夹。",
      // 预装模组 (2026-10-08)
      MODRINTH_UNREACHABLE: "连不上 Modrinth（模组库）：检查网络或代理后再试。",
      MODRINTH_NOT_FOUND: "在 Modrinth（模组库）上找不到这个模组，它可能已经下架了。",
      MODRINTH_INVALID_RESPONSE: "Modrinth（模组库）这次回的内容不对，稍后再试。",
      MODRINTH_DOWNLOAD_FAILED: "从 Modrinth（模组库）下载模组没有成功，下了一半的已经删掉。检查网络或代理后再试。",
      MOD_FILE_INVALID: "只能移除测试场模组文件夹里的 jar 文件。",
      MOD_LOADER_UNSUPPORTED: "Studio 现在只认得 Fabric、Forge 和 NeoForge 模组，这个加载器的模组还加不进测试场。",
      INVALID_MANAGED_JAVA_DIRECTORY:
        "Java 缓存目录不完整或不能读取。请到「运行环境」重新检测，选一个能用的 Java 后再打包。",
      JAVA_EXTRACTION_FAILED:
        "Java 运行环境解压失败。请确认磁盘空间充足、运行时目录可写，然后重新构建；也可配置工程目标所需的本地 JDK。",
      JAVA_ARCHIVE_LAYOUT_INVALID: "下载的 Java 安装目录格式不符合要求。请重试下载，或配置工程目标所需的本地 JDK 的 JAVA_HOME。",
      JAVA_INSTALL_PATH_ESCAPE: "Java 安装目录未通过路径校验。请配置工程目标所需的本地 JDK 的 JAVA_HOME 后重启应用。",
      INVALID_DOWNLOAD_CONFIGURATION: "运行环境下载配置不完整。请恢复应用附带的模板和版本配置，或配置工程目标所需的本地 JDK。",
      DOWNLOAD_FAILED: "运行环境下载失败。请检查网络和代理能否访问 GitHub，再重新构建；也可配置工程目标所需的本地 JDK。",
      DOWNLOAD_TIMEOUT: "运行环境下载超时。请检查网络或代理连接后重试；也可配置工程目标所需的本地 JDK 避免下载。",
      DOWNLOAD_TOO_LARGE: "下载文件超过允许大小，已停止使用。请检查网络或代理返回的内容，重试下载或配置工程目标所需的本地 JDK。",
      DOWNLOAD_CHECKSUM_MISMATCH: "下载文件校验失败，已拒绝使用。请检查网络或代理后重新构建，让应用重新下载运行环境。",
      UNSUPPORTED_PROXY_CONFIGURATION:
        "代理地址格式不支持。请使用 http://主机:端口 或 https://主机:端口，地址中不要包含账号密码；修改后重启应用。",
      PROCESS_START_FAILED: "无法启动构建或游戏进程。请确认工程目标所需的 JDK 安装完整且允许执行，然后重新构建。",
      PROCESS_TIMEOUT: "构建或游戏进程运行超时。请查看下方进度信息，检查网络和代理后重试。",
      [BUILD_NETWORK_FAILED]: gradleNetworkWords(),
      GRADLE_BUILD_FAILED: "模组构建失败。请查看下方进度中的错误；若依赖下载失败，请检查网络或代理后重新构建。",
      // mod-core `naming-migration.ts` (NAMING_MIGRATION_FAILED); its `detail` says why, in plain words.
      NAMING_MIGRATION_FAILED: "这个工程的玩法代码没能自动换成 Mojang 官方命名，工程没有改动，也还没有打包。",
      GRADLE_WRAPPER_CHECKSUM_MISMATCH: "构建工具文件校验失败。请恢复或重新安装应用附带的模板，再重新构建。",
      UNSUPPORTED_GRADLE_TASK: "当前构建任务不受支持。请重新打开工程，从构建或试玩按钮重试。",
      INVALID_BUILD_JAR: "生成的 JAR 缺少必要文件，尚未作为可用构建保存。请重新构建，并查看进度中的编译错误。",
      STALE_BUILD_REVISION: "工程已在构建后修改。请重新构建当前版本，再导出或试玩。",
      BUILD_PROJECT_MISMATCH: "这份构建不属于当前工程。请重新构建当前工程，再导出或试玩。",
      BUILD_RECORD_MISMATCH: "构建记录已发生变化。请重新构建当前工程，再导出或试玩。",
      BUILD_PATH_MISMATCH: "构建文件已移动或路径不匹配。请重新构建当前工程，再导出或试玩。",
      BUILD_CHECKSUM_MISMATCH: "构建文件内容已改变，无法继续使用。请重新构建当前工程，再导出或试玩。",
      PLAYTEST_PROCESS_FAILED:
        "开发游戏未正常退出。请查看下方进度中的错误，确认工程目标所需的 JDK 和图形驱动可用，再重新构建并试玩。",
      // 「测试场」
      SCENE_EULA: SCENE_WORDS.eula,
      SCENE_NOT_DEPLOYED: "这个模组的测试场还没有部署。先构建，再点「后台检查」或「打开测试场」。",
      SCENE_DOWNLOAD_FAILED: "准备测试场时，下载游戏文件的网络断了或者超时了。这不是模组的问题：检查网络或代理后再试一次，已经下载好的不会重下。",
      // mod-core `store/instance.ts`: the loader's installer failed; `code` says whether every run lost the network.
      LOADER_INSTALL_NETWORK: "安装 Forge/NeoForge 时网络断了（握手被断开、连接被重置、超时，或者下载节点拒绝了请求），已经自动重试过，还是没装上。这不是模组的问题：检查网络或代理后再点一次，已经下好的文件不会重下。",
      LOADER_INSTALL_FAILED: "Forge/NeoForge 的安装器没有装成功，镜像和官方地址都试过了。这不是模组的问题：请看下方进度里安装器最后几行说了什么，再试一次；还是不行，把那几行告诉开发者。",
      SCENE_LIBRARY_NAMES_COLLIDE: "游戏的文件清单里有两个同名的库，测试场没有准备好。这不是模组的问题，请把这句话告诉开发者。",
      ONE_ENTITY_REQUIRED: "当前预览只支持一个实体。请打开只有一个实体的工程，再构建或导出。",
      SAVED_MODEL_REQUIRED: "有一个生物还没有模型，所以没有打包。让 AI 给它做模型，或者自己做一个，再打包。",
      ABSOLUTE_EXPORT_DESTINATION_REQUIRED: "导出目录无效。请使用应用的导出按钮，在原生对话框中重新选择目录。",
      ABSOLUTE_JAR_DESTINATION_REQUIRED: "导出文件名无效。请在原生保存对话框中选择以 .jar 结尾的文件名。",
      EEXIST: "目标位置已有同名文件或目录。请换一个导出名称或选择新目录，已有文件未被覆盖。",
      ENOSPC: "磁盘空间不足。请释放工程或导出目标磁盘的空间，再重试。",
      ENOENT: "所需文件不存在。请检查工程、应用模板和 Java 安装是否完整；构建文件丢失时请重新构建。",
      EACCES: "没有目录访问权限。请选择可写的工程或导出目录，并关闭占用文件的程序后重试。",
      EPERM: "文件被占用或没有操作权限。请关闭占用程序，或选择可写的导出目录后重试。",
      [TEXTURE_SPACE_ERROR]: "模型纹理空间不足。请缩小方块尺寸或减少细节；最大的贴图也放不下的巨型模型，可以让一个贴图像素盖 2×2 或 4×4 个模型像素（texel_size 写 2 或 4），再保存模型。",
      "生物模型需要待机、行走和受击三个动作。": "模型缺少必要动作。请保留待机、行走和受击三个动作后再保存。",
    }
    // A failed download of the game's files says which file and what the network answered: a proxy, a reset and an outage read differently.
    // A failed download says which file and what the network answered: a proxy, a reset and an outage read differently.
    if ((error.message === "SCENE_DOWNLOAD_FAILED" || error.message === BUILD_NETWORK_FAILED) && "detail" in error && typeof error.detail === "string")
      return `${messages[error.message]}最后一次没下完的是${error.detail}。`
    if (error.message === "NAMING_MIGRATION_FAILED" && "detail" in error && typeof error.detail === "string") return `${messages[error.message]}${error.detail}`
    if (Object.hasOwn(messages, error.message)) return messages[error.message]
    if ("code" in error && typeof error.code === "string" && Object.hasOwn(messages, error.code))
      return messages[error.code]
  }
  // epic game1: two background checks failed with nothing but this sentence, so nobody could tell where. The message of an unknown error is never shown (it may carry a key or a
  // private path); what kind of error it was and the file and line of Studio's own code it came from are, and are enough to find it.
  const where = error instanceof Error ? errorSite(error) : null
  return `操作未完成，已有工程文件已保留。请重新打开工程并检查配置；必要时重启应用。${where ? `（${where}）` : ""}`
}

const BuildResultSchema = z.strictObject({
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  jarPath: z.string().min(1),
  projectDirectory: z.string().min(1),
  sourceDirectory: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  // Both optional in mod-core's own record; without them here a mod with gameplay code or with warnings could not be exported.
  gameplay_units: z.number().int().min(1).optional(),
  warnings: z.array(BuildWarningSchema).optional(),
})

// The drawer can show a saved pack's warnings as soon as it knows which pack it can reuse.
function currentBuildReceipt(list: readonly jobs.Job[], revision: number) {
  for (const job of list) {
    if (job.kind !== "build" || job.state !== "completed" || job.project_revision !== revision) continue
    const output = BuildResultSchema.safeParse(job.output).data
    if (output?.revision === revision) return { latest_build_job_id: job.id, latest_build_warnings: output.warnings ?? [] }
  }
  return { latest_build_job_id: null, latest_build_warnings: [] }
}

export async function createStudioService(options: {
  /** A step of a making is on disk: the window can read it now. */
  onTrace?: () => void
  /** 工具资产: the keys the person saved for tools (decrypted in the app's main process), and that the tools changed (the window reads them again). */
  toolSecrets?: () => Promise<Record<string, string>>
  onToolsChanged?: () => void
  workspaceDirectory: string
  runtimeDirectory: string
  templateDirectory: string
  /** A Java that always wins over what the person picked or detection found: a developer's or a test's override (MINEMODS_STUDIO_JAVA_HOME). */
  javaHome?: string
  /** 运行环境 (2026-10-08): stand-ins for finding Java, asking a download's size and naming the JDK to install. Only tests set them. */
  javaProbe?: {
    detect?: typeof detectJava
    now?: () => number
    downloadSize?: typeof javaDownloadSize
    installSource?: (major: number) => { vendor: string; version: string; url: string; sha256: string } | null
    install?: typeof ensureJava
  }
  /** The test scene's own runtime (setting it up, opening the game): a test stands in for the game with its own pieces; left out, the real ones. */
  sceneRun?: Partial<typeof import("@minemods/mod-core/scene-run")>
  /** Gameplay (Engineer D): the compiler behind a gameplay code check. Left out, the generated project's own Gradle compiles (no jar, no game). */
  compileGameplay?: GameplayCompile
  /**
   * 提前准备 (broad20): getting the downloads a pack and the game need done in the background before they are asked for (`prepare-ahead.ts`). Off unless the app
   * turns it on, so a service made for a test never fetches anything by itself; a test turns it on with stand-ins for the three steps.
   */
  ahead?: { on: boolean; runners?: Partial<AheadRunners>; /** Told when what the window shows of the preparation changed (the app passes it on to the window, which then reads the build panel again). */ changed?: () => void }
  applyBlockbench?: (
    input: { projectId: string; entityId: string; expectedRevision: number; model: Record<string, unknown> },
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>
  ai?: {
    apiKey?: string
    mode?: "api" | "mcp"
    source?: "saved" | "environment" | "none"
    baseUrl?: string
    model?: string
    serviceUrl?: string
    serviceToken?: string
    routerModel?: string
    moduleModel?: string
    /** 「审查」: see `ConnectionSettingsSchema`. Left out: on, with the making model. */
    particleLook?: boolean
    reviewDefaults?: "by-mode"
    review?: boolean
    reviewModel?: string
    /** 六视图: see `ConnectionSettingsSchema`. Left out: "gpt-image-1". */
    imageModel?: string
    transcriptionBaseUrl?: string
    transcriptionModel?: string
  }
  connectionStore?: ConnectionStore
  /** 六视图: stands in for the connection's image endpoint (tests). Left out, pictures are asked of the real one. */
  pictureTransport?: StructuredTransport
  /** Draws what an AI has made so far, without showing a window. Left out, nothing is made by looking. */
  look?: LookRenderer
}) {
  await mkdir(options.workspaceDirectory, { recursive: true })
  const workspace = await realpath(options.workspaceDirectory)
  const readStudioSettings = async () =>
    SettingsSchema.parse(
      await readFile(path.join(workspace, "studio-settings.json"), "utf8")
        .then((text) => JSON.parse(text) as unknown)
        .catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}
          throw error
        }),
    )
  // 个人设置: the person's standing wishes go with every request Studio's own AI makes (`authoring-ai.ts`), read at each one.
  setStandingWishes(async (role) => standingWishes(await readStudioSettings(), role))
  const known = new Map<string, string>()
  const locations = new Map<string, string>()
  const archives = new Map<string, string>()
  const selected = new Map<string, string>()
  const external = z.array(z.string()).parse(
    await readFile(path.join(workspace, "studio-locations.json"), "utf8")
      .then((text) => JSON.parse(text) as unknown)
      .catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
        throw error
      }),
  )
  const recovered = new Map<string, Promise<void>>()
  const openNotices = new Map<string, string>()
  const creaturePictures = new Map<string, Awaited<ReturnType<StudioApi["getCreatureLook"]>>>()
  const controllers = new Map<string, AbortController>()
  const active = new Map<string, Promise<void>>()
  const buildStarts = new Map<string, Promise<{ jobId: string }>>()
  const runtimeJobs = new Set<string>()
  const modelSessions = new Map<string, ReturnType<typeof createModelCoreSession>>()
  const ai = {
    ...options.ai,
    model: options.ai?.model?.trim() || MODEL_POLICY.model,
    routerModel: options.ai?.routerModel?.trim() || options.ai?.model?.trim() || MODEL_POLICY.model,
    moduleModel: options.ai?.moduleModel?.trim() || options.ai?.model?.trim() || MODEL_POLICY.model,
    transcriptionModel: options.ai?.transcriptionModel?.trim() || "gpt-4o-mini-transcribe",
    mode: options.ai?.mode ?? "api",
    source:
      options.ai?.source ??
      (options.ai?.apiKey || options.ai?.baseUrl || options.ai?.model ? ("environment" as const) : ("none" as const)),
  }
  const stored = await options.connectionStore?.load()
  if (stored) {
    Object.assign(ai, {
      ...stored.settings,
      apiKey: stored.apiKey,
      transcriptionBaseUrl: stored.settings.baseUrl,
      source: "saved" as const,
    })
  }
  const direct = () => (ai.mode === "api" ? ai.apiKey?.trim() : undefined)
  const gateway = () =>
    ai.mode === "api" && ai.serviceUrl?.trim() && ai.serviceToken?.trim()
      ? { url: ai.serviceUrl, token: ai.serviceToken }
      : undefined

  async function discover() {
    const result = [
      ...(await projects.listProjects(workspace)),
      ...(
        await Promise.all(
          external.map((directory) =>
            projects
              .openProject(directory)
              .then((project) => ({ directory, project }))
              .catch(() => null),
          ),
        )
      ).filter((entry) => entry !== null),
    ]
    result.forEach((entry) => known.set(entry.project.id, entry.directory))
    return [...new Map(result.map((entry) => [entry.project.id, entry])).values()].sort((a, b) =>
      b.project.updated_at.localeCompare(a.project.updated_at),
    )
  }

  async function repairLegacyProject(directory: string, projectId: string) {
    const titles = await repairTitles(directory)
    const links = await repairEntryLinks(directory)
    if (!titles.length && !links.length) return
    const details = [titles.length && `恢复了 ${titles.length} 个资产的原名`, links.length && `补上了 ${links.length} 处蓝图关联`].filter(Boolean)
    openNotices.set(projectId, `打开时把旧格式升级了，${details.join("，")}。`)
  }

  async function directoryFor(projectId: string, readOnly = false) {
    z.uuid().parse(projectId)
    if (!known.has(projectId)) await discover()
    const directory = known.get(projectId)
    if (!directory) throw new StudioError("找不到这个工程，请刷新工程列表。")
    const canonical = await realpath(directory)
    const expected = process.platform === "win32" ? workspace.toLowerCase() : workspace
    const parent = process.platform === "win32" ? path.dirname(canonical).toLowerCase() : path.dirname(canonical)
    if (
      parent !== expected &&
      !external.some(
        (directory) =>
          (process.platform === "win32" ? directory.toLowerCase() : directory) ===
          (process.platform === "win32" ? canonical.toLowerCase() : canonical),
      )
    )
      throw new StudioError("工程目录未通过系统选择器授权，请重新打开。")
    const project = await projects.openProject(canonical)
    if (project.id !== projectId) throw new StudioError("工程身份与目录不一致，请刷新工程列表。")
    if (readOnly) return canonical
    const before = recovered.get(projectId)
    if (before) {
      await before
      return canonical
    }
    // Once per project and session: names a revising task once wrote over an asset's own are put back where the records are sure (see `repairTitles`),
    // and a plan entry an outside AI made again with a plan of its own is linked to what it made (see `repairEntryLinks`).
    const attempt = jobs.recoverJobs(canonical).then(() => repairLegacyProject(canonical, projectId))
    recovered.set(projectId, attempt)
    // Once that it succeeded. A failure is not kept: another writer held the project just then, and every later call of the session used to get
    // that same failure back until Studio was restarted, with the lock long gone (2026-11-17). Nothing that writes ran in between, so the next call tries again.
    attempt.catch(() => {
      if (recovered.get(projectId) === attempt) recovered.delete(projectId)
    })
    await attempt
    return canonical
  }

  async function readAppearance(directory: string, id: string, entityId: string, revision?: number) {
    const asset = await loadModelAsset(directory, id, revision)
    const data = z.object({ design: ModelDesignSchema, blockbench: z.record(z.string(), z.unknown()).optional() }).safeParse(asset.data)
    const model = data.success ? data.data.design : ModelDesignSchema.parse(asset.data)
    const compiled = compileSavedModel(asset.data, creatureName({ id: entityId }))
    return { model, compiled, blockbench: data.success ? data.data.blockbench ?? null : null, origin: asset.origin }
  }
  let appearance: { key: string; value: ReturnType<typeof readAppearance> } | undefined

  async function view(directory: string, entityId?: string): Promise<StudioView> {
    const project = await projects.openProject(directory)
    considerAhead(directory, project)
    if (entityId && !project.entities.some((entity) => entity.id === entityId))
      throw new StudioError("找不到这个生物。")
    const entity =
      project.entities.find((entity) => entity.id === (entityId ?? selected.get(project.id))) ?? project.entities[0]
    const receipt = currentBuildReceipt(await jobs.listJobs(directory), project.revision)
    const id = entity?.model_asset_id
    if (!id)
      return {
        directory,
        project,
        model: null,
        model_origin: null,
        preview: null,
        ...receipt,
        open_notice: openNotices.get(project.id),
        entity_id: entity?.id ?? null,
        blockbench: null,
      }
    const ref = project.assets.find((ref) => ref.id === id)
    const key = JSON.stringify([directory, entity.id, id, ref?.sha256])
    if (appearance?.key !== key) {
      const value = readAppearance(directory, id, entity.id, ref?.revision)
      appearance = { key, value }
      value.catch(() => { if (appearance?.value === value) appearance = undefined })
    }
    const { model, compiled, blockbench, origin } = structuredClone(await appearance.value)
    const texture = project.workspace.assets.find((value) => value.id === entity.runtime?.texture_asset_id)
    const png = texture?.document.kind === "texture" ? compileWorkspaceTexture(texture.document) : compiled.png
    return {
      directory,
      project,
      model,
      entity_id: entity.id,
      blockbench,
      model_origin: origin,
      ...receipt,
      open_notice: openNotices.get(project.id),
      preview: {
        geometry: compiled.geometry,
        textureDataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        animation: compiled.animation,
      },
    }
  }

  async function source(projectId: string, expectedRevision?: number) {
    const current = await view(await directoryFor(projectId))
    if (expectedRevision !== undefined && current.project.revision !== expectedRevision)
      throw new projects.RevisionConflictError(expectedRevision, current.project.revision)
    // While the mod is being packed or checked, what is saved must stay what is packed: a save in between would make the
    // finished jar an old one before the chain got to open it. Only those two — the game the person has open afterwards
    // can stay open for hours, and thinking up ideas writes nothing a build reads; neither is a reason to refuse a save.
    if (expectedRevision !== undefined && (await jobs.listJobs(current.directory)).some((job) => ["build", "scene_check"].includes(job.kind) && ["queued", "running"].includes(job.state)))
      throw new StudioError("这个工程正在打包或者检查。等它结束或者先取消，再保存修改。")
    return current
  }

  async function changeAsset<T>(input:{projectId:string;expectedRevision:number;assetId?:string;entityId?:string},change:(directory:string,p:projects.Project)=>Promise<{next:projects.Project;result:T}>) {
    const current=await source(input.projectId,input.expectedRevision)
    const overview=await blueprints.overview({projectId:current.project.id})
    if(overview.items.some(i=>i.status==="making" && ((input.assetId && (i.asset_id===input.assetId || i.id.endsWith(input.assetId))) || (input.entityId && i.preview.entity_id===input.entityId))))throw new StudioError("正在制作，等做完再管理这样东西。")
    const result=await projects.withProjectLock(current.directory,async()=>{
      const p=await projects.openProject(current.directory)
      if(p.revision!==input.expectedRevision) throw new projects.RevisionConflictError(input.expectedRevision,p.revision)
      const changed=await change(current.directory,p)
      await projects.saveProjectUnlocked(current.directory,changed.next,input.expectedRevision)
      return changed.result
    })
    return {view:await view(current.directory),result}
  }

  const audioReceipts = createInspectionReceipts(undefined, "look_audio")
  const audioLooking = new Set<string>()

  async function importAudio(input: import("../audio-requests").AudioTargetInput, read: (directory: string) => Promise<Uint8Array>) {
    const current = await source(input.projectId, input.expectedRevision)
    const audio = await putAudio(current.directory, current.project, input, await read(current.directory), await programPath(options.runtimeDirectory, "ffmpeg") ?? null)
    await projects.saveProject(current.directory, audio.next, input.expectedRevision)
    return {assetId: audio.id, seconds: audio.seconds, cut:audio.cut, view:await view(current.directory)}
  }

  function entityFor(current: StudioView, entityId = current.entity_id) {
    const entity = current.project.entities.find((value) => value.id === entityId)
    if (!entity) throw new StudioError("请先添加或选择一个生物。")
    return entity
  }

  async function saveEntryAt(current: StudioView, input: ConceptionEntry) {
    const entry = ConceptionEntrySchema.parse(input)
    if (entry.entity_id && !current.project.entities.some((entity) => entity.id === entry.entity_id))
      throw new StudioError("这个内容所关联的生物不存在。")
    if (
      entry.model_confirmed_asset_id &&
      !current.project.entities.some(
        (entity) => entity.id === entry.entity_id && entity.model_asset_id === entry.model_confirmed_asset_id,
      )
    )
      throw new StudioError("模型已经变化，请重新确认模型和动画。")
    const conception = ConceptionSchema.parse({
      ...current.project.conception,
      entries: [...current.project.conception.entries.filter((value) => value.id !== entry.id), entry],
    })
    await projects.saveProject(current.directory, { ...current.project, conception }, current.project.revision)
    return view(current.directory)
  }

  /** 从别的工程导入: one project as the window lists it to pick from. */
  const importSourceOf = (project: projects.Project) => ({ id: project.id, name: project.name, mod_id: project.mod_id, revision: project.revision, targets: projects.projectTargets(project), things: importableThings(project) })

  /**
   * r29c: the project folder at `given` (the folder that holds minemods.project.json, or that file itself), checked to be a MineMods project other than the main one, and read where it is:
   * nothing is copied, registered among Studio's projects, recovered or written. Each way it is not one is said in plain words.
   */
  async function importFolder(projectId: string, given: string) {
    const main = await directoryFor(projectId, true)
    if (!path.isAbsolute(given)) throw new StudioError(`工程文件夹要写完整的路径（从盘符写起，比如 D:\\游戏\\projects\\工程名），现在写的是「${given}」。`)
    const named = await stat(given).catch(() => null)
    if (!named) throw new StudioError(`找不到「${given}」这个文件夹。看看路径有没有写错，盘有没有插好。`)
    const folder = named.isFile() && path.basename(given).toLowerCase() === "minemods.project.json" ? path.dirname(given) : given
    if (!named.isDirectory() && folder === given) throw new StudioError(`「${given}」是一个文件，不是工程文件夹。选工程本身的那一层文件夹（里面直接有 minemods.project.json）。`)
    const directory = await realpath(folder)
    if (!(await stat(path.join(directory, "minemods.project.json")).catch(() => null))?.isFile())
      throw new StudioError(`「${directory}」里没有 minemods.project.json，不是 MineMods 工程。选工程本身的那一层文件夹（里面直接有 minemods.project.json），不是它上面的 projects 文件夹，也不是它里面的 generated。`)
    const project = await projects.openProject(directory).catch((error: unknown) => {
      throw new StudioError(`「${directory}」里的工程读不出来：工程文件坏了，或者是更新版本的 Studio 做的。${error instanceof Error ? `（${error.message.slice(0, 300)}）` : ""}`)
    })
    const same = (left: string, right: string) => (process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right)
    if (project.id === projectId || same(directory, main)) throw new StudioError("源工程和主工程是同一个工程，选另一个工程。")
    return { directory, project }
  }

  /** 从别的工程导入: where the source of an import is read from: one of Studio's projects (`sourceId`) or (r29c) a project folder anywhere on disk (`sourcePath`). */
  async function importSourceDirectory(input: { projectId: string; sourceId?: string | undefined; sourcePath?: string | undefined }) {
    if (input.sourcePath !== undefined) return (await importFolder(input.projectId, input.sourcePath)).directory
    if (input.sourceId === undefined) throw new StudioError("源工程写一个：Studio 里的工程用 sourceId，别处的工程文件夹用 sourcePath。")
    if (input.sourceId === input.projectId) throw new StudioError("源工程和主工程是同一个工程，选另一个工程。")
    return directoryFor(input.sourceId, true)
  }

  async function remember(directory: string) {
    if (path.dirname(directory) === workspace || external.includes(directory)) return
    external.push(directory)
    await projects.writeRecord(workspace, ["studio-locations.json"], external)
  }

  async function completedBuild(projectId: string, jobId: string) {
    const current = await source(projectId)
    const job = await jobs.loadJob(current.directory, jobId)
    if (job.kind !== "build" || job.state !== "completed")
      throw new StudioError("请先完成当前工程的构建，再导出或试玩。")
    const result = BuildResultSchema.parse(job.output)
    if (job.project_revision !== current.project.revision || result.revision !== current.project.revision)
      throw new StudioError("工程已修改，请重新构建后再导出或试玩。")
    return { current, result }
  }

  // A history entry can be from an older revision or from before the project was moved.
  // Resolve its jar inside the current project, using only the recorded build ID and filename.
  const recordedJar = async (directory: string, result: z.infer<typeof BuildResultSchema>) => {
    const name = path.basename(result.jarPath)
    if (!name.toLowerCase().endsWith(".jar")) return null
    return projects.storagePath(directory, ["generated", "build-" + result.id, "build", "libs", name])
      .then(file => stat(file).then(info => info.isFile() ? file : null))
      .catch(() => null)
  }
  const resultOfBuild = (job: Awaited<ReturnType<typeof jobs.loadJob>>) => {
    if (job.kind !== "build" || job.state !== "completed") return null
    const parsed = BuildResultSchema.safeParse(job.output)
    return parsed.success && parsed.data.revision === job.project_revision ? parsed.data : null
  }

  const sceneRuntime = async () => ({ ...(await import("@minemods/mod-core/scene-run")), ...options.sceneRun })

  /**
   * Which downloads this computer already has, for every hint that says "the first time": the development files a build, a code check and the development game
   * share (Gradle's mark, or, for a computer that built before the mark existed, a build of this project that finished), and the scene's two sets of game files.
   */
  async function setupReady(directory: string) {
    const [scene, gradle, built] = await Promise.all([
      (await sceneRuntime()).sceneReady(options.runtimeDirectory),
      gradleReady(options.runtimeDirectory),
      jobs.listJobs(directory).then((all) => all.some((job) => job.kind === "build" && job.state === "completed")),
    ])
    return { build: gradle || built, check: scene.check, play: scene.play }
  }

  /**
   * Whether what is on this computer is all of it, which `setupReady` does not say: the development files only count as whole once a pack's own tasks have run (a code check
   * leaves the mark too, but does not resolve the libraries only the pack does), and the game's files once the two mods every scene starts with are in the cache.
   * A computer that built a pack before the mark existed is whole by that build.
   */
  async function setupWhole(directory: string) {
    const [gradle, built, mods] = await Promise.all([
      gradleWhole(options.runtimeDirectory),
      jobs.listJobs(directory).then((all) => all.some((job) => job.kind === "build" && job.state === "completed")),
      (await sceneRuntime()).sceneModsReady(options.runtimeDirectory),
    ])
    return { build: gradle || built, play: mods }
  }

  /**
   * For a Forge or NeoForge project: whether that target's check and game are already installed on this computer, and what a first time
   * downloads, in the words the drawer says while the stage runs (`TARGET_SCENE_WORDS.cold`). Null for a Fabric project, whose scene is `setupReady`'s.
   */
  async function targetSceneFacts(project: projects.Project) {
    if (project.target === DEFAULT_TARGET) return null
    const [sceneTarget, { targetManifest }] = await Promise.all([import("@minemods/mod-core/scene-target"), import("@minemods/mod-core/target/manifests")])
    const manifest = targetManifest(project.target)
    const cold = sceneTarget.TARGET_SCENE_WORDS.cold(manifest)
    return { ready: await sceneTarget.targetSceneReady(options.runtimeDirectory, project.id, manifest), cold: { check: cold.check, play: cold.play } }
  }

  // What the scene found goes onto each thing it was about, so the overview says "tested in the game" and "seen in the
  // game" from what really ran. Keeping this note is never a reason for the run itself to fail.
  async function noteScene(directory: string, project: projects.Project, buildId: string, from: Parameters<typeof import("@minemods/mod-core/scene").sceneCases>[2]) {
    const [{ sceneCases }, { recordVerification }, { builtWorkspaceAssets }] = await Promise.all([import("@minemods/mod-core/scene"), import("@minemods/mod-core/verification"), import("@minemods/mod-core/workspace")])
    const cases = sceneCases(project, builtWorkspaceAssets(project).map((asset) => asset.id), from)
    if (cases.length) await recordVerification(directory, { build_id: buildId, cases }).catch(() => undefined)
  }

  const sceneEulaFile = path.join(options.runtimeDirectory, "scene", "eula.json")
  const sceneEula = () => access(sceneEulaFile).then(() => true, () => false)
  const saveStudioSettings = async (settings: z.input<typeof SettingsSchema>) => {
    const parsed = SettingsSchema.parse(settings)
    await projects.writeRecord(workspace, ["studio-settings.json"], parsed)
    return parsed
  }

  // 运行环境 (2026-10-08): the Java a build, a check or the test scene uses is found each time it is needed, never fixed
  // when Studio starts: the person may pick another one or install Studio's own while the app is open.
  const probe = {
    detect: options.javaProbe?.detect ?? detectJava,
    downloadSize: options.javaProbe?.downloadSize ?? javaDownloadSize,
    installSource: options.javaProbe?.installSource ?? ((major: number) => javaInstallSource(major)),
    install: options.javaProbe?.install ?? ensureJava,
  }
  // Finding Java starts every candidate once (a few seconds); a build, its check and the scene ask within moments of each
  // other, so what was found is kept for half a minute and dropped as soon as the person picks a Java or one is installed.
  const JAVA_FRESH = 30_000
  const javaNow = options.javaProbe?.now ?? Date.now
  const javaFound = new Map<number, { at: number; key: string; report: Promise<{ found: JavaFound[]; using: JavaFound | null }> }>()
  const forgetJava = () => javaFound.clear()
  async function findJava(major: number) {
    const settings = await readStudioSettings()
    const key = JSON.stringify([settings.javaHome, settings.javaInstallDirectory])
    const kept = javaFound.get(major)
    if (kept && kept.key === key && javaNow() - kept.at < JAVA_FRESH) return kept.report
    const entry = { at: javaNow(), key, report: probe.detect({ major, runtimeDirectory: options.runtimeDirectory, installDirectory: settings.javaInstallDirectory, chosen: settings.javaHome }) }
    javaFound.set(major, entry)
    void entry.report.catch(() => (javaFound.get(major) === entry ? javaFound.delete(major) : undefined))
    return entry.report
  }
  /** What was found and what the next build uses: the person's pick while it still fits, else what automatic would take. */
  async function javaReport(major: number) {
    const settings = await readStudioSettings()
    const { found, using } = await findJava(major)
    // A pick that stopped fitting (moved, uninstalled) is no reason to download another: automatic takes over until they pick again.
    return { found, using: using ?? (settings.javaHome ? pickJava(found, { chosen: null }) : null), mode: settings.javaHome ? ("chosen" as const) : ("auto" as const), chosen: settings.javaHome }
  }
  const studioJava = () => targetById(DEFAULT_TARGET)!.java
  /**
   * The one place a Java for a build is decided. A developer's or a test's explicit Java wins; else the found one
   * (`javaReport`); else none, and `ensureJava` installs Studio's own under the folder the person chose (or the runtime folder).
   */
  async function resolveJava(): Promise<JavaUse> {
    const javaDirectory = (await readStudioSettings()).javaInstallDirectory ?? undefined
    if (options.javaHome) return { javaHome: options.javaHome, javaDirectory, external: options.javaHome }
    const { using } = await javaReport(studioJava())
    return { javaHome: using?.home, javaDirectory, external: using && using.source !== "studio" ? using.home : undefined }
  }
  const javaFor = async () => {
    const use = await resolveJava()
    const chosen = (await readStudioSettings()).javaHome
    const java17 = chosen ? (await findJava(17)).using : null
    return {
      javaHome: use.javaHome,
      javaDirectory: use.javaDirectory,
      ...(java17?.source === "chosen" ? { javaHomes: { 17: java17.home } } : {}),
    }
  }
  // 提前准备 (broad20): what a pack and the game would download once asked is fetched in the background once there is a mod to pack soon (`aheadMoment`), with the
  // same functions and into the same folders a press uses. The switch is read at every look; the licence line is the one 「打开测试场」 and the check go by.
  const ahead = options.ahead?.on
    ? createPrepareAhead<string>({
        // What is fetched ahead is Fabric's (Loom's development files, the Fabric scene's game): a Forge or NeoForge project gets none of it, its pack and its scene fetch their own when pressed.
        facts: async (directory) => ({
          enabled: (await readStudioSettings()).prepareAhead && (await projects.openProject(directory).then((project) => project.target === DEFAULT_TARGET, () => true)),
          eula: await sceneEula(),
          ready: await setupReady(directory),
          whole: await setupWhole(directory),
        }),
        changed: options.ahead.changed,
        runners: {
          development: async (step) => {
            const build = await import("@minemods/mod-core/build")
            const java = await javaFor()
            // Studio's own Java may be installed on the way (`ensureJava`); what the 运行环境 line found before is out of date. It is installed first, here, and the window told
            // at once, because the files that follow take many minutes and the line would otherwise say "not found" until they were all there (round 21).
            await probe.install(options.runtimeDirectory, { ...java, signal: step.signal, onProgress: step.onProgress })
            forgetJava()
            step.changed()
            await build.prepareDevelopmentFiles({ ...java, templateDirectory: options.templateDirectory, runtimeDirectory: options.runtimeDirectory, lowPriority: true, signal: step.signal, onProgress: step.onProgress }).finally(forgetJava)
          },
          server: async (step) => (await sceneRuntime()).prepareSceneServer(options.runtimeDirectory, { runtimeDirectory: options.runtimeDirectory, gentle: true, ...step }),
          client: async (step) => (await sceneRuntime()).prepareSceneClient(options.runtimeDirectory, { runtimeDirectory: options.runtimeDirectory, gentle: true, ...step }),
          ...options.ahead.runners,
        },
      })
    : null
  // The folder of the project that last made a pack likely, for the looks that are not about a project (the switch turned on, the licence agreed).
  const aheadWhere = { directory: null as string | null }
  function considerAhead(directory: string, project: projects.Project, soon = false) {
    if (!ahead || !aheadMoment({ blueprintConfirmed: project.blueprint?.state === "confirmed", things: project.entities.length + project.blocks.length + project.items.length + projectBookCount(project) })) return
    aheadWhere.directory = directory
    ahead.consider(directory, soon)
  }
  // Folders the person picked in the system's chooser for Studio's JDK this session; only these, the saved one and the
  // runtime folder may be installed into, as a project location is only ever one the chooser gave (`registerLocation`).
  const javaDirectories = new Set<string>()
  const pickedJavaDirectory = (directory: string, saved: string | null) => {
    const resolved = path.resolve(directory)
    const same = (other: string | null) => !!other && (process.platform === "win32" ? path.resolve(other).toLowerCase() === resolved.toLowerCase() : path.resolve(other) === resolved)
    if (!same(options.runtimeDirectory) && !same(saved) && ![...javaDirectories].some(same)) throw new StudioError(SETUP_WORDS.unpicked)
    return resolved
  }
  async function planJavaInstall(input: { major: number; directory?: string | null }) {
    const source = probe.installSource(input.major)
    if (!source) throw new StudioError(SETUP_WORDS.noInstall(input.major))
    const saved = (await readStudioSettings()).javaInstallDirectory
    const directory = input.directory ? pickedJavaDirectory(input.directory, saved) : (saved ?? options.runtimeDirectory)
    const [downloadBytes, freeBytes] = await Promise.all([
      probe.downloadSize({ url: source.url, proxyUrl: process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY }),
      freeSpace(directory),
    ])
    return { vendor: source.vendor, version: source.version, url: source.url, downloadBytes, directory, defaultDirectory: options.runtimeDirectory, freeBytes, problem: await checkInstallDirectory(directory, downloadBytes) }
  }
  // Jars the person picked in the file chooser, by the token the window holds for each; used once.
  const modFiles = new Map<string, string>()
  async function projectTarget(projectId: string) {
    const directory = await directoryFor(projectId)
    const project = await projects.openProject(directory)
    const target = targetById(project.target)
    if (!target) throw new StudioError(SETUP_WORDS.unknownTarget)
    return { directory, target }
  }

  const failedOnNetwork = (error: unknown) => error instanceof Error && error.message === BUILD_NETWORK_FAILED

  /**
   * The words and the way there for a failure that carries the id of a thing in the project (`coded-errors.ts`), read from the project as it
   * is now. Null for any other failure, and when the project cannot be read: the usual sentence then stands.
   */
  async function namedFailure(directory: string, error: unknown) {
    if (!(error instanceof Error) || !codedParts(error.message)) return null
    const project = await projects.openProject(directory).catch(() => null)
    if (!project) return null
    return codedWords(error.message, (id, kind) => {
      if (kind === "entity") return project.entities.filter((entity) => entity.id === id).map((entity) => ({ kind, name: entity.name }))[0] ?? null
      return project.workspace.assets.filter((asset) => asset.id === id).map((asset) => ({ kind, name: asset.title }))[0] ?? null
    })
  }

  /**
   * The failure a crashed play ends in: the sentence for the person (that it crashed, which gameplay the report points at by its title, where the report
   * is) and the way to that gameplay's card. A gameplay is found by the slug in the class's package; a class of the mod that is not a gameplay's names no card.
   */
  function crashedPlay(crash: GameCrash, project: projects.Project) {
    const gameplay = (slug: string) => project.workspace.assets.find((asset) => asset.document.kind === "gameplay" && (asset.document as { slug?: string }).slug === slug)
    const found = (slug: string) => {
      const asset = gameplay(slug)
      return asset ? { id: asset.id, title: asset.title } : null
    }
    return new GameCrashedError(crashSentence(crash, (slug) => found(slug)?.title ?? null), crash, crashTarget(crash, found))
  }

  function run(
    directory: string,
    job: jobs.Job,
    operation: (signal: AbortSignal, progress: (detail: string) => void) => Promise<unknown>,
  ) {
    if (["build", "playtest", "scene_check", "scene_play"].includes(job.kind)) runtimeJobs.add(job.id)
    const controller = new AbortController()
    controllers.set(job.id, controller)
    const updates = { tail: Promise.resolve() }
    // When a run that waited for the runtime environment got its turn: how long it has taken is counted from there, not from the queue.
    // What the output said once and must not be forgotten when the next piece replaces the detail (job-marks.ts).
    const marks: JobMarks = {}
    // Only the newest detail is ever written: a game that prints fast used to queue one write per line, and the job
    // read as running for minutes after the window closed while the queue drained (测试场接线, 2026-11-14).
    const latest: { detail: string | null; writing: boolean } = { detail: null, writing: false }
    const flush = async () => {
      while (latest.detail !== null) {
        const detail = latest.detail
        latest.detail = null
        await (async () => {
          const current = await jobs.loadJob(directory, job.id)
          if (current.state !== "running") return
          await jobs.updateJob(directory, job.id, {
            expectedRevision: current.revision,
            checkpoint: { detail: detail.slice(-4000), ...marks },
          })
        })().catch(() => undefined)
      }
      latest.writing = false
    }
    const progress = (detail: string) => {
      markProgress(marks, detail)
      latest.detail = detail
      if (latest.writing) return
      latest.writing = true
      updates.tail = updates.tail.then(flush)
    }
    const work = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        await jobs.updateJob(directory, job.id, { state: "running", expectedRevision: job.revision })
        const output = await operation(controller.signal, progress)
        await updates.tail
        const current = await jobs.loadJob(directory, job.id)
        if (current.state === "canceled" || controller.signal.aborted) return
        await jobs.updateJob(directory, job.id, { state: "completed", expectedRevision: current.revision, output })
      })
      .catch(async (error: unknown) => {
        await updates.tail
        const current = await jobs.loadJob(directory, job.id)
        if (["completed", "canceled", "failed", "interrupted"].includes(current.state)) return
        if (controller.signal.aborted) {
          await jobs.cancelJob(directory, job.id)
          return
        }
        // A failure that names a thing of the project by its id is said with the thing's name, and leaves the way to its card beside the sentence.
        const named = await namedFailure(directory, error)
        // A game that crashed has its own reason, and its own sentence: the report, the part it points at and what to do about it.
        const crashed = error instanceof GameCrashedError ? error : null
        const reason = crashed ? CRASH_REASON : error instanceof ManagedJavaCacheError ? "java_cache" : failedOnNetwork(error) ? "network" : staleReasonOf(error)
        const target = named?.target ?? crashed?.target ?? null
        await jobs.updateJob(directory, job.id, {
          state: "failed",
          expectedRevision: current.revision,
          error: crashed?.message ?? named?.text ?? publicError(error),
          // Why it failed, where that is known to be nothing about the mod (a download broke off, or the project was saved while it ran): read by the build view and by an outside AI.
          ...(reason || target || error instanceof BuildStop
            ? {
                checkpoint: {
                  ...(current.checkpoint && typeof current.checkpoint === "object" && !Array.isArray(current.checkpoint) ? current.checkpoint : {}),
                  ...(reason ? { reason } : {}),
                  ...(target ? { target } : {}),
                  ...(error instanceof BuildStop ? { build_detail: error.findings.map(issue => issue.detail || issue.text + issue.fix).join("\n").slice(0,16000) } : {}),
                  ...(crashed ? { crash: crashed.crash, crash_detail: CRASH_WORDS.advanced(crashed.crash) } : {}),
                },
              }
            : {}),
        })
      })
      .catch(() => undefined)
      .finally(() => {
        // A build, check or scene run may have downloaded Studio's own Java on the way (`ensureJava`); what was found before it started is out of date,
        // and the build panel's 「运行环境」 line asks again right after the run ends, so it must not be answered from the half-minute cache.
        if (runtimeJobs.has(job.id)) forgetJava()
        runtimeJobs.delete(job.id)
        controllers.delete(job.id)
        active.delete(job.id)
      })
    active.set(job.id, work)
  }

  const world = worldSource(path.join(options.runtimeDirectory, "gradle-home"), options.runtimeDirectory)
  const projectRunner = createProjectRunner({
    directoryFor,
    trace: (input) => makingHistory.record(input),
    ai,
    // What a failed request of Studio's own AI is stored as, for the person: the same sentences every other failure gets.
    plain: publicError,
    getModelComplexity: async () => (await readStudioSettings()).modelComplexity,
    getEpicSixViewStyle: async () => (await readStudioSettings()).epicSixViewStyle,
    look: options.look,
    // 2D textures (Engineer E4): read only from the Gradle home Studio's own build uses, never written anywhere.
    world,
    // Reference images: the views Studio's own AI may draw of what it intends, when the connection has an image endpoint, with the image model the person chose.
    draws: (request) => requestPicture({ ...request, model: ai.imageModel, transport: options.pictureTransport }),
    canDraw: (connection) => pictureCanBeAsked(connection.baseUrl, ai.imageModel),
    // Gameplay (Engineer D): a version of gameplay code is compiled with the generated project through the controlled Gradle entry.
    compileGameplay:
      options.compileGameplay ??
      (async (input) => {
        const build = await import("@minemods/mod-core/build")
        // The development files are on their way already (提前准备): the check waits for them like a pack does, and then finds them there.
        await ahead?.join({ signal: input.signal, onProgress: input.onProgress })
        // The check says "the first time" only when the development files are really not here yet (a build or an earlier check having finished means they are).
        if (!(await setupReady(input.directory)).build) input.onProgress?.(COMPILE_COLD_LINE)
        return build.compileGameplayCandidate(input.directory, {
          templateDirectory: options.templateDirectory,
          candidate: input.candidate,
          compiler: build.gradleCompiler({ ...(await javaFor()), templateDirectory: options.templateDirectory, runtimeDirectory: options.runtimeDirectory, signal: input.signal, onProgress: input.onProgress }),
          signal: input.signal,
        })
      }),
  })
  const library = createLibraryService({
    workspaceDirectory: workspace,
    runtimeDirectory: options.runtimeDirectory,
    java: resolveJava,
    references: async () =>
      (await discover()).map((entry) => ({
        projectId: entry.project.id,
        projectName: entry.project.name,
        environmentIds: options.javaHome ? ["gradle-home"] : [...javaMajors([entry.project], TARGETS).map((major) => `java-${major}`), "gradle-home"],
      })),
    runtimeBusy: () => runtimeJobs.size > 0 || buildStarts.size > 0 || (ahead?.active() ?? false),
    onRestored: (input) => importAnalysis.registerRestored(input).then(() => undefined),
    importBusy: () =>
      importAnalysis.isBusy() || reverseService.isBusy() || importAssets.isBusy() || importAssetGraphAnalysis.isBusy(),
    publicError,
  })
  const importAnalysis = createImportAnalysisService({
    workspaceDirectory: workspace,
    beforeApply: async (id) => {
      if (reverseService.isBusy()) throw new StudioError("逆向工程正在处理，请稍后再试。")
      if ((await reverseService.state(id)).project)
        throw new StudioError("此工程已还原源码与资源，请在通用逆向工程中继续修改，以保证导出内容包含全部改动。")
    },
    connection: () => ({
      mode: ai.mode,
      apiKey: direct() ?? undefined,
      baseUrl: ai.baseUrl,
      model: ai.moduleModel ?? ai.model,
    }),
    publicError,
  })
  const reverseService = createReverseService({
    workspaceDirectory: workspace,
    runtimeDirectory: options.runtimeDirectory,
    javaHome: async () => (await resolveJava()).javaHome,
    importBusy: () => importAnalysis.isBusy(),
    connection: () => ({
      mode: ai.mode,
      apiKey: direct() ?? undefined,
      baseUrl: ai.baseUrl,
      model: ai.moduleModel ?? ai.model,
    }),
    publicError,
  })
  const importAssets = createImportAssetService(workspace, options.runtimeDirectory)
  const importAssetGraphAnalysis = createImportAssetGraphService({
    workspaceDirectory: workspace,
    connection: () => ({
      mode: ai.mode,
      apiKey: direct() ?? undefined,
      baseUrl: ai.baseUrl,
      model: ai.moduleModel ?? ai.model,
    }),
    publicError,
  })
  const projectRuns = new Map<string, string>()
  let startingProjectRuns = 0
  const sixViewStyle = async (project: Awaited<ReturnType<typeof projects.openProject>>, item: { key: string | null; asset_id: string | null }) => {
    const entries = project.blueprint?.entries ?? []
    const level = (item.key ? governing(entries, item.key)?.tier.level : undefined)
      ?? (item.asset_id ? tierForModel(entries, project.workspace.assets, item.asset_id) : undefined)
    return sixViewStyleFor(level, (await readStudioSettings()).epicSixViewStyle)
  }
  const references = createReferenceService({
    directoryFor,
    // 六视图: the item as the overview has it and its part sheet, read when the person puts a three-view on it or asks for one to be drawn.
    thing: async (input, readOnly = false) => {
      // A copied prompt must not recover jobs, repair titles or interrupt runs. Only the canonical
      // overview's identity fields are needed; the most recently saved part sheet is read as-is.
      if (readOnly) {
        const directory = await directoryFor(input.projectId, true)
        const project = await projects.openProject(directory)
        const item = buildProjectOverview({ project, runs: [], build: null, verification: null, production: null, producing: false }).items.find((value) => value.id === input.itemId)
        if (!item) return null
        const record = (await listMakings(directory))
          .filter((value) => (item.asset_id !== null && value.asset_id === item.asset_id) || (item.key !== null && value.entry === item.key))
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
        return { item, sheet: record?.sheet ?? null, style: await sixViewStyle(project, item) }
      }
      const item = (await blueprints.overview({ projectId: input.projectId })).items.find((value) => value.id === input.itemId)
      if (!item) return null
      const project = await projects.openProject(await directoryFor(input.projectId))
      return { item, sheet: (await blueprints.making(input).catch(() => null))?.sheet ?? null, style: await sixViewStyle(project, item) }
    },
    connection: () => ({ mode: ai.mode, apiKey: ai.apiKey?.trim(), baseUrl: ai.baseUrl, imageModel: ai.imageModel }),
    transport: options.pictureTransport,
    say: (projectId, event) => directoryFor(projectId, true).then((directory) => noteActivity(directory, event)).catch(() => undefined),
    refuse: (message) => new StudioError(message),
  })
  const blueprints = createBlueprintService({
    directoryFor,
    runner: projectRunner,
    connection: () => (direct() ? { apiKey: direct()!, baseUrl: ai.baseUrl, planner: ai.routerModel } : null),
    onRun: (runId, projectId) => projectRuns.set(runId, projectId),
  })

  async function managedThing(input: Parameters<StudioApi["getAssetUsage"]>[0], external: boolean): Promise<typeof input> {
    if (!external || input.creature) return input
    const { project } = await source(input.projectId)
    const asset = project.workspace.assets.find((asset) => asset.id === input.assetId)
    if ((!asset || asset.document.kind === "entity") && creatureThing(project, input.assetId)) return { ...input, creature: true }
    return input
  }

  async function thingUsage(input: Parameters<StudioApi["getAssetUsage"]>[0]) {
    if (!input.creature) return blueprints.usage(input)
    const current = await source(input.projectId)
    const creature = creatureThing(current.project, input.assetId)
    if (!creature) throw new StudioError("找不到这只生物。")
    const overview = await blueprints.overview({ projectId: input.projectId })
    const keys = new Set(creature.entries.map((entry) => entry.key))
    const owned = new Set(overview.items.filter((item) =>
      (item.key && keys.has(item.key)) || [...creature.ids].some((id) => item.asset_id === id || item.id.endsWith(`:${id}`)))
      .map((item) => item.id))
    const used = [...creature.ids].flatMap((id) => assetUsage(overview, id)?.used_by ?? [])
    const used_by = [...new Map(used.filter((item) => !owned.has(item.id)).map((item) => [item.id, item])).values()]
    return { item: `entity:${creature.entity.id}`, title: creature.entity.name, used_by, message: used_by.length
      ? "下面这些地方还在用这只生物，先改掉引用再删除。"
      : "没有其他内容在用这只生物，可以删除。" }
  }

  const makingHistory = createMakingHistory({
    directoryFor,
    changed: options.onTrace,
    lock: async ({ projectId, assetId }) => {
      const item = (await blueprints.overview({ projectId })).items.find((value) => value.asset_id === assetId)
      return item ? makingLock(item, "等这一次做完再回到旧版。") : ""
    },
    reviewOf: async ({ projectId, assetId }) => (await blueprints.making({ projectId, itemId: assetId }))?.review ?? null,
    redo: (input) => blueprints.redo(input as Parameters<typeof blueprints.redo>[0]),
  })

  const connectionSettings = () =>
    ConnectionSettingsSchema.parse({
      mode: ai.mode,
      baseUrl: ai.baseUrl ?? "",
      model: ai.model,
      routerModel: ai.routerModel,
      moduleModel: ai.moduleModel,
      transcriptionModel: ai.transcriptionModel,
      review: ai.review,
      reviewDefaults: ai.reviewDefaults,
      ...(ai.particleLook===undefined?{}:{particleLook:ai.particleLook}),
      ...(ai.reviewModel?.trim() ? { reviewModel: ai.reviewModel.trim() } : {}),
      ...(ai.imageModel?.trim() ? { imageModel: ai.imageModel.trim() } : {}),
    })
  const publicConnection = (): PublicConnection =>
    PublicConnectionSchema.parse({
      ...connectionSettings(),
      hasApiKey: Boolean(ai.apiKey?.trim()),
      source: ai.source,
    })
  const sameConnectionEndpoint = (baseUrl: string) => {
    try {
      return (
        responsesConfig(baseUrl || undefined, 1, false).endpoint ===
        responsesConfig(ai.baseUrl || undefined, 1, false).endpoint
      )
    } catch {
      return false
    }
  }
  const connectionInput = (input?: TestConnectionInput | SaveConnectionInput) => {
    if (!input) return { settings: connectionSettings(), apiKey: direct() }
    const parsed = SaveConnectionInputSchema.parse(input)
    const { apiKey, clearApiKey, ...settings } = parsed
    return {
      settings: ConnectionSettingsSchema.parse(settings),
      apiKey: clearApiKey
        ? undefined
        : (apiKey ?? (sameConnectionEndpoint(settings.baseUrl) ? ai.apiKey?.trim() : undefined)),
    }
  }
  async function testConnection(input?: TestConnectionInput) {
    const current = connectionInput(input)
    if (current.settings.mode !== "api") throw new ModelingError("SERVICE_UNAVAILABLE")
    if (!current.apiKey?.trim()) throw new ModelingError("NO_API_KEY")
    const result = await probeConnection({
      baseUrl: current.settings.baseUrl || undefined,
      apiKey: current.apiKey,
      model: current.settings.model,
      signal: AbortSignal.timeout(30000),
      transport: (url, init) => fetch(url, init),
    }).catch((error: unknown) => {
      throw error instanceof ModelingError ? error : new ModelingError("UPSTREAM_UNAVAILABLE")
    })
    return ConnectionTestResultSchema.parse({ ok: true, model: result.model, status: result.status })
  }
  async function listConnectionModels(input: ListConnectionModelsInput) {
    const parsed = ListConnectionModelsInputSchema.parse(input)
    const apiKey = parsed.apiKey ?? (sameConnectionEndpoint(parsed.baseUrl) ? ai.apiKey?.trim() : undefined)
    if (!apiKey?.trim()) throw new ModelingError("NO_API_KEY")
    const provider = responsesConfig(parsed.baseUrl || undefined, 1, false)
    const response = await fetch(provider.modelsEndpoint, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    }).catch(() => {
      throw new ModelingError("UPSTREAM_UNAVAILABLE")
    })
    if (!response.ok) {
      await response.body?.cancel()
      // Many compatible services have no model catalogue; the wizard still accepts a typed model name.
      if ([404, 405, 501].includes(response.status)) throw new StudioError("当前服务没有提供模型列表。")
      throw new ModelingError(
        response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "UPSTREAM_UNAVAILABLE",
      )
    }
    const entry = z.object({ id: z.string().optional(), name: z.string().optional() })
    const result = z
      .union([z.object({ data: z.array(entry) }), z.object({ models: z.array(entry) }), z.array(entry)])
      .safeParse(await response.json().catch(() => null))
    if (!result.success) throw new ModelingError("INVALID_OUTPUT")
    const entries = Array.isArray(result.data) ? result.data : "data" in result.data ? result.data.data : result.data.models
    const names = entries.map((model) => (model.id ?? model.name ?? "").trim())
    return [...new Set(names.filter((name) => name.length >= 1 && name.length <= 120))]
  }
  async function assertConnectionChangeAllowed() {
    if (await projectRunner.hasExternalWork())
      throw new StudioError("外部模型正在制作，请先完成或停止任务，再修改连接方式。")
    if (active.size || startingProjectRuns || blueprints.isProducing())
      throw new StudioError("当前有 AI 任务正在运行，请等待任务结束后再修改连接配置。")
    for (const [runId, projectId] of projectRuns) {
      const run = await projectRunner.get({ projectId, runId }).catch(() => null)
      if (run && !["completed", "partial", "canceled", "failed", "interrupted"].includes(run.state))
        throw new StudioError("当前有工程运行正在执行，请等待运行结束后再修改连接配置。")
      projectRuns.delete(runId)
    }
  }

  // 工具资产: the tools an outside AI may ask Studio to run, read again whenever the runtime's tools folder changes (tool-service.ts).
  const tools = createToolService({
    runtimeDirectory: options.runtimeDirectory,
    secrets: options.toolSecrets,
    onChange: options.onToolsChanged,
    requiresSoundEncoder: true,
    // Studio's own sound maker: measurements describe its rendered mono PCM before encoding.
    builtins: {
      "sound-synth": async (input) => {
        const samples = renderSynth(readSynthRecipe(String(input.recipe)))
        return { bytes: wavFile(samples), mime: "audio/wav", soundMeasurements: measureSynth(samples) }
      },
      // The test scene's game window of this project only, while the person has it open.
      "scene-record": async (input, context) => {
        const ffmpeg = await programPath(options.runtimeDirectory, "ffmpeg")
        if (!ffmpeg) throw new ToolRunError("FFMPEG_MISSING", "录测试场要用 ffmpeg：要先在 Studio 的「个人设置 → 工具」里下载 ffmpeg，或者指定你自己的 ffmpeg。这要用户在 Studio 里处理。")
        const title = await sceneWindowTitle(context.projectId)
        if (!title) throw new ToolRunError("SCENE_NOT_OPEN", process.platform === "win32" ? "这个工程的测试场没有开着：请用户在 Studio 里点「构建并试玩」打开游戏，进到世界里再录。" : "录测试场现在只在 Windows 上能做。")
        return recordWindow(ffmpeg, title, Number(input.seconds), context.signal)
      },
      // A recording of this project, cut into frames for whoever looks (the reviewer, or the AI that made the thing).
      "video-frames": async (input, context) => {
        const ffmpeg = await programPath(options.runtimeDirectory, "ffmpeg")
        if (!ffmpeg) throw new ToolRunError("FFMPEG_MISSING", "抽帧要用 ffmpeg：要先在 Studio 的「个人设置 → 工具」里下载 ffmpeg，或者指定你自己的 ffmpeg。这要用户在 Studio 里处理。")
        const file = recordingFile(await directoryFor(context.projectId), String(input.recording))
        if (!(await stat(file).catch(() => null))?.isFile()) throw new ToolRunError("RECORDING_UNKNOWN", "没有这段录像：recording 写 scene-record 那次运行的编号。")
        const frames = await videoFrames(ffmpeg, file, Number(input.frames), context.signal)
        return { bytes: new TextEncoder().encode(JSON.stringify({ look_for: String(input.look_for), seconds: frames.seconds, pictures: frames.pictures })), mime: "application/json" }
      },
    },
    // A program Studio looks after (ffmpeg), downloaded on the storage page or the person's own copy.
    storeProgram: (id) => programPath(options.runtimeDirectory, id),
    // Every sound a tool made becomes the game's sound and a sound asset of the project; anything else is kept on the run for whoever asked for it.
    onProduct: async (run, product, input, manifest) => {
      // A picture made for a model's six-view goes where the outside AI's own picture would (finish_six_view): the same checks, the same note.
      if (run.target?.kind === "six_view") {
        if (!product.mime.startsWith("image/")) throw new ToolRunError("TOOL_PRODUCT_KIND", "六视图要的是图片，工具交回的不是。")
        const done = await references.finishThreeView({ projectId: run.project_id, itemId: run.target.itemId, style: run.target.style, result: { status: "generated", image: `data:${product.mime};base64,${Buffer.from(product.bytes).toString("base64")}`, name: `${manifest.title}画的六视图`.slice(0, 80) } })
        return { six_view: run.target.itemId, message: done.message }
      }
      // A recording is kept with the project as material to check (its id is the run's); the frames of one are handed to whoever asked, as pictures.
      if (manifest.id === "scene-record") {
        await keepRecording(await directoryFor(run.project_id), run.id, product.bytes)
        return { recording: run.id, bytes: product.bytes.byteLength }
      }
      if (manifest.id === "video-frames") return JSON.parse(new TextDecoder().decode(product.bytes)) as unknown
      if (manifest.medium !== "sound" || manifest.role === "check") return null
      const ffmpeg = await programPath(options.runtimeDirectory, "ffmpeg")
      if (!ffmpeg) throw new ToolRunError("FFMPEG_MISSING", "声音做出来了，可是还不能转成游戏用的格式：要先在 Studio 的「个人设置 → 工具」里下载 ffmpeg，或者指定你自己的 ffmpeg。这要用户在 Studio 里处理。")
      const sound = await toGameSound(ffmpeg, product)
      const directory = await directoryFor(run.project_id)
      const made = await projects.withProjectLock(directory, async () => {
        const project = await projects.openProject(directory)
        const made = saveToolSound(project, { name: input.name, title: input.title, subtitleZh: input.subtitle_zh, subtitleEn: input.subtitle_en, sound: { ...sound, measurements: product.soundMeasurements }, manifest, at: new Date().toISOString() })
        await projects.saveProjectUnlocked(directory, made.next, project.revision)
        return made
      }).catch((error: unknown) => {
        if (error instanceof projects.RevisionConflictError || error instanceof projects.ProjectLockedError) throw new ToolRunError("SOUND_REVISION", "保存声音时工程刚被另一个窗口修改。等另一个窗口保存完，再运行这个声音工具。")
        if (error instanceof Error && "code" in error && ["EPERM", "EBUSY", "EACCES"].includes(String(error.code))) throw new ToolRunError("SOUND_FILE_BUSY", "保存声音时工程文件持续被占用。请关闭正在占用工程文件的程序，稍后再运行这个声音工具。")
        throw error
      })
      await noteActivity(directory, toolSoundNote(made.asset, manifest, made.added))
      return { asset_id: made.asset.id, name: made.asset.title, seconds: sound.duration, added_file: made.added, ...(product.soundMeasurements ? { measurements: product.soundMeasurements } : {}) }
    },
  })
  /** 工具资产: what a tool runs or reaches, said for the person before they turn it on (never its keys). */
  const toolRuns = (manifest: ToolManifest | null) => {
    const runner = manifest?.runner
    if (!runner || runner.type === "builtin") return null
    if (runner.type === "command") return `运行 ${runner.program} ${runner.args.join(" ")}`
    if (runner.type === "http") return `${runner.method} ${runner.url}`
    return "url" in runner.server ? `MCP 服务 ${runner.server.url} 的 ${runner.tool}` : `MCP 服务 ${runner.server.program} ${runner.server.args.join(" ")} 的 ${runner.tool}`
  }
  return {
    tools,
    async listTools(): Promise<ToolsView> {
      const entries = await tools.entries()
      return {
        tools: entries.map((entry) => ({ id: entry.id, title: entry.manifest?.title ?? entry.id, description: entry.manifest?.description ?? "", role: entry.manifest?.role ?? "", medium: entry.manifest?.medium ?? "", builtin: entry.builtin, state: entry.state, problem: entry.problem, sha256: entry.sha256, runs: toolRuns(entry.manifest), secrets: entry.manifest ? toolSecrets(entry.manifest) : [] })),
        programs: await programStates(options.runtimeDirectory),
        secrets: await toolSecretNames(options.runtimeDirectory),
        folder: path.join(options.runtimeDirectory, TOOLS_FOLDER),
      }
    },
    approveTool: (input: { id: string; sha256: string }) => tools.approve(input).catch((error: unknown) => { throw error instanceof ToolRunError ? new StudioError(error.plain) : error }),
    setToolEnabled: (input: { id: string; enabled: boolean }) => tools.setEnabled(input),
    async installProgram(input: { id: "ffmpeg" }) {
      const fetchJson = async (url: string) => {
        const response = await fetch(url, { headers: { accept: "application/vnd.github+json", "user-agent": "MineMods-Studio" }, signal: AbortSignal.timeout(30_000) })
        if (!response.ok) {
          // GitHub answers 403 (or 429) to a computer that asked it too often without signing in; it says when it will answer again.
          const reset = Number(response.headers.get("x-ratelimit-reset"))
          const limited = (response.status === 403 || response.status === 429) && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after"))
          if (limited) {
            const minutes = Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000)) : Math.max(1, Math.ceil(Number(response.headers.get("retry-after") ?? 60) / 60))
            throw new StudioError(`GitHub 暂时不让这台电脑再查发布页了（短时间里查得太多）。大约 ${minutes} 分钟后再点「下载」；等不及也可以点「用我自己的」。`)
          }
          throw new StudioError(`读不到 ${input.id} 的发布页（${response.status}）。过一会儿再点一次「下载」；还不行就点「用我自己的」。`)
        }
        return response.json()
      }
      const installed = await installProgram(options.runtimeDirectory, input.id, { fetchJson }).catch((error: unknown) => {
        throw error instanceof StudioError ? error : new StudioError(`下载 ${input.id} 没有成功：${error instanceof Error ? error.message : String(error)}`)
      })
      tools.secretsChanged()
      return { path: installed }
    },
    async useOwnProgram(input: { id: "ffmpeg"; path: string }) {
      await useOwnProgram(options.runtimeDirectory, input.id, input.path).catch((error: unknown) => { throw new StudioError(error instanceof Error ? error.message : String(error)) })
      tools.secretsChanged()
      return { path: input.path }
    },
    toolSecretsChanged: () => tools.secretsChanged(),
    async changeSoundMoment(input:Parameters<StudioApi["changeSoundMoment"]>[0]){
      return (await changeAsset(input,async(_,p)=>({next:changeSoundMoment(p,input.entityId,input.key,input.soundId,input.vanilla),result:null}))).view
    },
    async vanillaAudio(input:Parameters<StudioApi["vanillaAudio"]>[0]){
      const project=await projects.openProject(await directoryFor(input.projectId,true))
      return vanillaAudio(options.runtimeDirectory,targetById(project.target)!.minecraft,input.event,input.probe)
    },
    async renameAsset(input: Parameters<StudioApi["renameAsset"]>[0], external = false) {
      const target = await managedThing(input, external)
      const usage = external ? await thingUsage(target) : undefined
      const changed = await changeAsset(input, async (_, project) => ({ next: renameThing(project, input.assetId, input.title, target.creature), result: null }))
      if (usage) await noteActivity(changed.view.directory, {
        kind: "note", mark: "note", item: usage.item, title: input.title,
        text: `外部 AI 把「${usage.title}」改名为「${input.title}」。`,
      })
      return changed.view
    },
    async duplicateAsset(input: Parameters<StudioApi["duplicateAsset"]>[0], external = false) {
      const changed = await changeAsset(input, async (_, project) => {
        const copy = copyThing(project, input.assetId)
        return { next: copy.next, result: copy.id }
      })
      const copy = changed.view.project.workspace.assets.find((asset) => asset.id === changed.result)!
      if (external) await noteActivity(changed.view.directory, {
        kind: "note", mark: "note", item: copy.id, title: copy.title, text: `外部 AI 创建了「${copy.title}」。`,
      })
      return { view: changed.view, assetId: changed.result }
    },
    async deleteAsset(input: Parameters<StudioApi["deleteAsset"]>[0], external = false): ReturnType<StudioApi["deleteAsset"]> {
      const target = await managedThing(input, external)
      const usage = await thingUsage(target)
      if (usage.used_by.length) return { view: await source(input.projectId, input.expectedRevision), deletion: null, used_by: usage.used_by, message: usage.message }
      const changed = await changeAsset(input, async (directory, project) => {
        const gone = await deleteThing(directory, project, input.assetId, [], target.creature)
        return { next: gone.next, result: gone.deletion }
      })
      if (external) await noteActivity(changed.view.directory, {
        kind: "note", mark: "note", item: usage.item, title: usage.title,
        text: `外部 AI 删除了「${usage.title}」。可以在这里撤销。`, undo_deletion: changed.result,
      })
      return { view: changed.view, deletion: changed.result, used_by: [] }
    },
    async restoreDeleted(input: Parameters<StudioApi["restoreDeleted"]>[0], external = false) {
      const changed = await changeAsset(input, async (directory, project) => {
        const restored = await restoreThing(directory, project, input.deletion)
        return { next: restored.next, result: { id: restored.id, title: restored.title } }
      })
      const restored = changed.result
      await noteActivity(changed.view.directory, {
        kind: "note", mark: "note", item: restored.id, title: restored.title,
        text: `${external ? "外部 AI" : "你"}恢复了「${restored.title}」。`, restored_deletion: input.deletion,
      })
      return { view: changed.view, assetId: restored.id }
    },
    async listAudioInbox(input: {projectId: string}) { return listAudioInbox(await directoryFor(input.projectId)) },
    importAudioInbox(input: Parameters<StudioApi["importAudioInbox"]>[0]) {return importAudio(input, directory => readInboxFile(directory,input.filename))},
    uploadAudio(input: Parameters<StudioApi["uploadAudio"]>[0]) {return importAudio(input, async () => fromBase64(input.data,"audio/ogg").bytes)},
    async saveSoundSettings(input: Parameters<StudioApi["saveSoundSettings"]>[0]) {
      return (await changeAsset(input, async (_, project) => ({ next: updateSoundSettings(project, input), result: null }))).view
    },
    async removeAudio(input: Parameters<StudioApi["removeAudio"]>[0]) {
      const current = await source(input.projectId,input.expectedRevision)
      await projects.saveProject(current.directory,dropAudio(current.project,input),input.expectedRevision)
      return view(current.directory)
    },
    async lookAudio(input: ExternalAudioLookInput) {
      const scope = input.projectId + "/" + input.assetId
      if (input.receipt_id) {
        if (input.audio_part !== undefined) throw new MakingRefusal("取回音频材料时只带 projectId、assetId 和 receipt_id。")
        return audioReceipts.poll(scope, input.receipt_id)
      }
      const program = await programPath(options.runtimeDirectory, "ffmpeg")
      if (!program) throw new MakingRefusal("要检查音频，请用户先在 Studio 的「存储空间」准备 ffmpeg，再试一次。")
      if (audioLooking.has(scope)) throw new MakingRefusal("正在检查这份音频。请等原调用返回，或用已有的 receipt_id 取回结果。")
      audioLooking.add(scope)
      return audioReceipts.start(scope, async (progress) => {
        try {
          const directory = await directoryFor(input.projectId, true)
          const project = await projects.openProject(directory)
          return await lookAudioAsset(directory, project, input, program, progress)
        } finally {
          audioLooking.delete(scope)
        }
      })
    },
    async readMusicPart(input: Parameters<StudioApi["readMusicPart"]>[0]) {
      const directory = await directoryFor(input.projectId)
      const project = await projects.openProject(directory)
      const doc = project.workspace.assets.find(asset => asset.id === input.assetId)?.document
      if (doc?.kind !== "music" || !doc[input.part]) throw new StudioError("这段音乐还没有文件。")
      return "data:audio/ogg;base64," + (await readMedia(directory,doc[input.part]!.media_sha256)).toString("base64")
    },
    async importSound(input: { projectId: string; name: string; data: string }) {
      const ffmpeg = await programPath(options.runtimeDirectory, "ffmpeg")
      if (!ffmpeg) throw new StudioError("导入声音要用 ffmpeg 把它转成游戏用的格式：先在「个人设置 → 工具」里下载 ffmpeg，或者指定你自己的。")
      const sound = await toGameSound(ffmpeg, fromBase64(input.data, "application/octet-stream")).catch((error: unknown) => { throw new StudioError(error instanceof ToolRunError ? error.plain : String(error)) })
      const current = await source(input.projectId)
      const made = saveToolSound(current.project, { name: input.name, sound, manifest: { id: "import", title: "导入的文件" }, at: new Date().toISOString() })
      await projects.saveProject(current.directory, made.next, current.project.revision)
      await noteActivity(current.directory, { kind: "person", mark: "note", item: made.asset.id, title: made.asset.title, text: `你导入了一段声音到「${made.asset.title}」。` })
      // The project as it now is, so the page that brought the file in shows it at once.
      return { asset_id: made.asset.id, name: made.asset.title, seconds: sound.duration, added_file: made.added, view: await view(current.directory) }
    },
    startProjectRun: async (input: Parameters<typeof projectRunner.start>[0]) => {
      if (ai.mode !== "api") throw new StudioError("当前连接模式不支持 API 工程运行。")
      startingProjectRuns += 1
      try {
        const run = await projectRunner.start(input)
        projectRuns.set(run.id, input.projectId)
        return run
      } finally {
        startingProjectRuns -= 1
      }
    },
    listProjectRuns: (input: { projectId: string }) => projectRunner.list(input.projectId),
    getProjectRun: projectRunner.get,
    cancelProjectRun: projectRunner.cancel,
    getConnection: async () => publicConnection(),
    async saveConnection(input: SaveConnectionInput) {
      const parsed = SaveConnectionInputSchema.parse(input)
      await assertConnectionChangeAllowed()
      const { apiKey, clearApiKey, ...settings } = parsed
      const validated = ConnectionSettingsSchema.parse({
        ...settings,
        reviewDefaults: ai.source === "none" ? "by-mode" : ai.reviewDefaults,
      })
      const nextApiKey = clearApiKey
        ? undefined
        : (apiKey ?? (sameConnectionEndpoint(validated.baseUrl) ? ai.apiKey : undefined))
      await options.connectionStore?.save({ settings: validated, apiKey: nextApiKey })
      Object.assign(ai, {
        ...validated,
        review: validated.review,
        // A reviewer's model taken away again must not stay behind from the settings before.
        particleLook: validated.particleLook,
        reviewModel: validated.reviewModel,
        imageModel: validated.imageModel,
        transcriptionBaseUrl: validated.baseUrl,
        apiKey: nextApiKey,
        source: "saved" as const,
      })
      return publicConnection()
    },
    /**
     * 「这次不另请审查，让做的 AI 自己检查」: the person's way out when a finished version waits for a reviewer who never comes. It is `saveConnection` with the
     * review switch alone changed, and without the refusal while an outside AI is at work: that is exactly when it is needed. The maker's pending
     * `await_inspection` reads the switch live, so the change reaches it on its next call (or its current wait) as the "review is off" instruction.
     */
    async turnOffReview() {
      if (reviewEnabled(ai)) {
        await options.connectionStore?.save({ settings: ConnectionSettingsSchema.parse({ ...connectionSettings(), review: false }), apiKey: ai.apiKey })
        ai.review = false
      }
      return publicConnection()
    },
    testConnection,
    listConnectionModels,
    externalRunner: projectRunner,
    blueprints,
    /** One sentence in, a draft blueprint out. Runs as a job so it can be followed and cancelled like any other AI work. */
    async draftBlueprint(input: Parameters<StudioApi["draftBlueprint"]>[0]) {
      if (!direct()) throw new StudioError(NO_PLANNER)
      const directory = await directoryFor(input.projectId)
      const request = z.string().trim().min(1).max(20000).parse(input.request)
      const job = await jobs.startJob(directory, {
        kind: "draft-blueprint",
        expectedRevision: (await projects.openProject(directory)).revision,
        input: { request },
      })
      run(directory, job, async (signal, progress) => {
        progress("正在把你的想法整理成蓝图。")
        const blueprint = await blueprints.draft({ projectId: input.projectId, request, ...(input.ideas === undefined ? {} : { ideas: input.ideas }) }, signal, progress)
        return { revision: blueprint.revision, entries: blueprint.entries.length }
      })
      return { jobId: job.id }
    },
    // --- idea cards and the activity panel ---
    /** One sentence in, idea cards out. A job like `draftBlueprint`, so it can be followed and cancelled the same way. */
    async expandIdeas(input: Parameters<StudioApi["expandIdeas"]>[0]) {
      if (!direct()) throw new StudioError(NO_PLANNER)
      const directory = await directoryFor(input.projectId)
      const request = z.string().trim().min(1).max(20000).parse(input.request)
      const job = await jobs.startJob(directory, { kind: "expand-ideas", expectedRevision: (await projects.openProject(directory)).revision, input: { request } })
      run(directory, job, async (signal, progress) => {
        const ideas = await blueprints.expand({ projectId: input.projectId, request }, signal, progress)
        return { revision: ideas.revision, groups: ideas.groups.length }
      })
      return { jobId: job.id }
    },
    getIdeas: blueprints.getIdeas,
    chooseIdeas: blueprints.chooseIdeas,
    discardIdeas: blueprints.discardIdeas,
    getActivity: blueprints.activity,
    // --- end ---
    getBlueprint: blueprints.get,
    saveBlueprint: blueprints.save,
    confirmBlueprint: async (input: Parameters<typeof blueprints.confirm>[0]) => {
      const confirmed = await blueprints.confirm(input)
      // The AI starts making now: the quiet stretch before the first pack is when the downloads cost nothing.
      if (ahead) {
        const directory = await directoryFor(input.projectId)
        considerAhead(directory, await projects.openProject(directory))
      }
      return confirmed
    },
    discardBlueprint: blueprints.discard,
    startBlueprintProduction: blueprints.start,
    stopBlueprintProduction: blueprints.stop,
    getProjectPlay: blueprints.play,
    getProjectOverview: blueprints.overview,
    reviewAsset: blueprints.review,
    clearAssetReview: blueprints.clearReview,
    redoAsset: blueprints.redo,
    getAssetUsage: thingUsage,
    getMaking: blueprints.making,
    makingHistory,
    getMakingTrace: makingHistory.trace,
    getMakingStep: makingHistory.traceDocument,
    getMakingHistory: makingHistory.read,
    addMakingNote: makingHistory.addNote,
    changeMakingNote: makingHistory.changeNote,
    earnAdvancements: makingHistory.earnAdvancements,
    sendMakingNotes: makingHistory.sendNotes,
    // 2D textures (Engineer E4): a saved block or item drawn among the game's own pictures, for the person to look at; drawn on demand and stored nowhere.
    lookBeside: async (input: { projectId: string; assetId: string }) => {
      const asset = (await projects.openProject(await directoryFor(input.projectId))).workspace.assets.find((value) => value.id === input.assetId)
      return asset ? besidePicture({ look: options.look, world }, asset.document) : null
    },
    // Gameplay (Engineer D)
    // The record is the asset's own, so it is read by the asset the item stands for (the plan entry's, or the item's own id) and only then by the entry it was written for;
    // and what it says was checked counts for the version the project holds now (broad23: a revision's checks were not found, or the old version's were shown).
    getGameplay: async (input: { projectId: string; itemId: string }) => {
      const directory = await directoryFor(input.projectId)
      const project = await projects.openProject(directory)
      const asset = project.blueprint?.entries.find((entry) => entry.key === input.itemId)?.asset_id ?? input.itemId
      const record = (await readGameplay(directory, asset).catch(() => null)) ?? (await findGameplay(directory, input.itemId))
      return record ? shownGameplayRecord(record, project.workspace.assets.find((value) => value.id === record.asset_id)?.document) : null
    },
    saveSheet: blueprints.saveSheet,
    // Reference images of an overview item.
    getReferences: references.list,
    addReference: references.add,
    removeReference: references.remove,
    // 六视图 (2026-10-08) of a model item: the person's own, or drawn by the connection's image model when the person asks.
    addThreeView: references.addThreeView,
    drawThreeView: references.drawThreeView,
    getThreeViewPrompt: references.getThreeViewPrompt,
    finishThreeView: references.finishThreeView,
    threeViewDrawing: references.threeViewDrawing,
    threeViewByWords: references.byWords,
    chooseThreeViewByWords: references.chooseByWords,
    transcribeAudio: (input: Parameters<StudioApi["transcribeAudio"]>[0]) =>
      transcribeSpeech(input, {
        apiKey: direct(),
        baseUrl: ai.transcriptionBaseUrl ?? ai.baseUrl,
        model: ai.transcriptionModel,
      }),
    async openProjectDirectory(directory: string) {
      const resolved = await realpath(directory)
      const project = await projects.openProject(resolved)
      await remember(resolved)
      known.set(project.id, resolved)
      // Before the first view, so the revision the person sees is the one after the repair.
      await repairLegacyProject(resolved, project.id)
      return view(resolved)
    },
    async listProjects() {
      return discover()
    },
    async createProject(input: Parameters<StudioApi["createProject"]>[0]) {
      const parsed = WorkerRequestSchema.parse({ method: "createProject", input })
      if (parsed.method !== "createProject") throw new StudioError("创建工程参数无效。")
      // Only a combination Studio can really make, build and run is taken, and the project is saved for it.
      const target = targetById(parsed.input.targetId ?? DEFAULT_TARGET)
      if (!target) throw new StudioError(SETUP_WORDS.unknownTarget)
      if (!target.ready) throw new StudioError(SETUP_WORDS.notReady(target))
      const targetId = TargetIdSchema.safeParse(target.id)
      if (!targetId.success) throw new StudioError(SETUP_WORDS.notReady(target))
      // 个人设置 · 默认工程目录: the folder the person picked for new projects; gone or unwritable, Studio's own folder as before.
      const preferred = parsed.input.locationToken ? "" : (await readStudioSettings()).projectsDirectory
      const location = parsed.input.locationToken
        ? locations.get(parsed.input.locationToken)
        : preferred
          ? await mkdir(preferred, { recursive: true }).then(() => realpath(preferred), () => workspace)
          : workspace
      if (!location) throw new StudioError("工程位置已失效，请重新选择文件夹。")
      // The folder is named after the project so the person can recognise it; the id lives in the project file, and nothing reads it from the folder's name.
      const directory = await claimProjectFolder(location, parsed.input.name)
      const project = await projects
        .createProject({
          directory,
          name: parsed.input.name,
          description: parsed.input.description,
          mod_id: parsed.input.modId,
          target: targetId.data,
        })
        .catch(async (error: unknown) => {
          // A project that was not made leaves no folder behind (rmdir only takes an empty one, so nothing of anyone's is lost).
          await rmdir(directory).catch(() => undefined)
          throw error
        })
      if (!parsed.input.empty)
        await projects.saveProject(
          directory,
          { ...project, entities: [projects.createEntity(parsed.input)] },
          project.revision,
        )
      known.set(project.id, directory)
      await remember(directory)
      recovered.set(project.id, Promise.resolve())
      return view(directory)
    },
    async extractAbility(input: Parameters<StudioApi["extractAbility"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const extracted = extractAbility(current.project, input.entityAssetId, input.moveId)
      await projects.saveProject(current.directory, extracted.project, input.expectedRevision)
      return { assetId: extracted.assetId, view: await view(current.directory) }
    },
    // 从别的工程导入: the source is opened read-only (no recovery, no repair writes to it); the main project is written once, under its lock, by `applyProjectImport`.
    async projectImportSources(input: Parameters<StudioApi["projectImportSources"]>[0]) {
      await directoryFor(input.projectId, true)
      return (await discover()).filter((entry) => entry.project.id !== input.projectId).map(({ project }) => importSourceOf(project))
    },
    // r29c: a project folder anywhere on disk, chosen in the window or named by an outside AI: read where it is, never copied, registered or written.
    async projectImportSourceAt(input: Parameters<StudioApi["projectImportSourceAt"]>[0]) {
      const found = await importFolder(input.projectId, input.sourcePath)
      return { ...importSourceOf(found.project), path: found.directory }
    },
    async previewProjectImport(input: Parameters<StudioApi["previewProjectImport"]>[0]) {
      return previewProjectImport(await importSourceDirectory(input), await directoryFor(input.projectId, true), input).catch(importError)
    },
    async applyProjectImport(input: Parameters<StudioApi["applyProjectImport"]>[0], external = false) {
      const from = await importSourceDirectory(input)
      const current = await source(input.projectId, input.expectedRevision)
      const importId = randomUUID()
      const done = await applyProjectImport(from, current.directory, { ...input, importId }).catch(importError)
      await noteActivity(current.directory, importActivity(done.plan, external))
      return { view: await view(current.directory), plan: done.plan, importId }
    },
    async undoProjectImport(input: Parameters<StudioApi["undoProjectImport"]>[0], external = false) {
      const current = await source(input.projectId, input.expectedRevision)
      const undone = await undoProjectImport(current.directory, input.importId, input.expectedRevision).catch(importError)
      await noteActivity(current.directory, { kind: "note", mark: "note", item: null, title: null, text: `${external ? "外部 AI" : "你"}撤销了从「${undone.record.source.name}」导入的 ${undone.record.items.filter((item) => item.action === "add").length} 样东西。` })
      return { view: await view(current.directory) }
    },
    // r29b 合并重复件: the list read from the project and its import records; the merge and its undo under the project's lock (`mergeDuplicateAssets`).
    async listDuplicateAssets(input: Parameters<StudioApi["listDuplicateAssets"]>[0]) {
      const directory = await directoryFor(input.projectId, true)
      return duplicateAssets(await projects.openProject(directory), await listProjectImports(directory))
    },
    async mergeDuplicateAssets(input: Parameters<StudioApi["mergeDuplicateAssets"]>[0], external = false) {
      const current = await source(input.projectId, input.expectedRevision)
      const mergeId = randomUUID()
      const done = await mergeDuplicateAssets(current.directory, { drops: input.drops, expectedRevision: input.expectedRevision, mergeId }).catch(importError)
      await noteActivity(current.directory, { kind: "note", mark: "note", item: null, title: null, text: `${external ? "外部 AI" : "你"}合并了 ${done.pairs.length} 样以前导入留下的重复件：${done.pairs.map((pair) => `「${pair.drop.title}」并进「${pair.keep.title}」`).join("、")}。` })
      return { view: await view(current.directory), mergeId, pairs: done.pairs }
    },
    async undoAssetMerge(input: Parameters<StudioApi["undoAssetMerge"]>[0], external = false) {
      const current = await source(input.projectId, input.expectedRevision)
      const undone = await undoAssetMerge(current.directory, input.mergeId, input.expectedRevision).catch(importError)
      await noteActivity(current.directory, { kind: "note", mark: "note", item: null, title: null, text: `${external ? "外部 AI" : "你"}撤销了一次重复件合并（${undone.record.pairs.length} 样）。` })
      return { view: await view(current.directory) }
    },
    async projectSummary(projectId: string) {
      const project = await projects.openProject(await directoryFor(projectId))
      const status = externalAssetStatus(project)
      return { open_notice: openNotices.get(projectId), project: {
        id: project.id, name: project.name, mod_id: project.mod_id, revision: project.revision,
        target: project.target, targets: projects.projectTargets(project),
        workspace: { assets: project.workspace.assets.map((asset) => ({ id: asset.id, module: asset.module, title: asset.title, revision: asset.revision, dependencies: asset.dependencies, status: status(asset), ...(asset.document.kind === "ability" ? abilityInfo(project, asset.id, asset.document) : {}), ...(asset.document.kind==="music"?{note:MUSIC_SUMMARY,parts:musicEvents(asset.document).map(({part,seconds,channels})=>({part,seconds,channels})),used_by:project.workspace.assets.filter(a=>a.dependencies.includes(asset.id)).map(a=>a.title)}:{}) })) },
      } }
    },
    async projectAsset(projectId: string, assetId: string) {
      const project = await projects.openProject(await directoryFor(projectId))
      const asset = project.workspace.assets.find((asset) => asset.id === assetId)
      if (!asset) throw new StudioError("这个工程里没有这项资产。")
      return { projectId, revision: project.revision, open_notice: openNotices.get(projectId), asset: { ...asset, status: externalAssetStatus(project)(asset), ...(asset.document.kind === "ability" ? abilityInfo(project, asset.id, asset.document) : {}) } }
    },
    async openProject(projectId: string) {
      return view(await directoryFor(projectId))
    },
    /** The targets a project is built for, primary first, read off its file alone (no view, no model compiled): what words about its game follow. */
    async projectTargets(projectId: string) {
      return projects.projectTargets(await projects.openProject(await directoryFor(projectId, true)))
    },
    async registerLocation(token: string, directory: string) {
      z.uuid().parse(token)
      const canonical = await realpath(directory)
      locations.set(token, canonical)
      return { token, label: canonical }
    },
    async addEntity(input: Parameters<StudioApi["addEntity"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const entity = projects.createEntity({ name: input.name })
      await projects.saveProject(
        current.directory,
        { ...current.project, entities: [...current.project.entities, entity] },
        input.expectedRevision,
      )
      selected.set(input.projectId, entity.id)
      return view(current.directory)
    },
    async selectEntity(input: Parameters<StudioApi["selectEntity"]>[0]) {
      const current = await source(input.projectId)
      if (!current.project.entities.some((entity) => entity.id === input.entityId))
        throw new StudioError("找不到这个生物。")
      selected.set(input.projectId, input.entityId)
      return view(current.directory)
    },
    async getCreatureLook(input:Parameters<StudioApi["getCreatureLook"]>[0]) {
      const project=await projects.openProject(await directoryFor(input.projectId,true))
      if(project.revision!==input.expectedRevision) throw new StudioError("工程已更新，请重新打开这只生物。")
      const asset=project.workspace.assets.find(a=>a.id===input.assetId)
      const doc=asset?.document
      if(doc?.kind!=="entity") throw new StudioError("找不到这只生物。")
      const model=project.workspace.assets.find(a=>a.id===doc.model_asset_id)
      if(model?.document.kind!=="model" || !options.look) return {pictures:[],note:"还没有可供画图的模型。"}
      const key=JSON.stringify([project.id,project.revision,asset!.id,asset!.revision,model.revision,input.part,input.key])
      const held=creaturePictures.get(key)
      if(held)return held
      if(await assertConnectionChangeAllowed().then(()=>false,()=>true)) return {pictures:[],note:"AI 正在制作，等它做完再看图。"}
      const job=creatureTabLook({...doc,abilities:creatureMoves(doc,project.workspace)},model.document,input.part,input.key,effectLookup(project))
      if(!job.sheets.length)return {pictures:[],note:"这个部分没有另外的画面。"}
      const drawn=await options.look(job)
      if(!drawn.ok)return {pictures:[],note:drawn.reason}
      const result={pictures:drawn.pictures,note:""}
      if(creaturePictures.size>=12)creaturePictures.delete(creaturePictures.keys().next().value!)
      creaturePictures.set(key,result)
      return result
    },
    async getEntityPreview(input: Parameters<StudioApi["getEntityPreview"]>[0]) {
      const current = await view(await directoryFor(input.projectId), input.entityId)
      return { model: current.model, preview: current.preview }
    },
    saveByHand: (input: HandSaveInput) => createContentService({ source, view, saveProject: projects.saveProject, note: noteActivity }).saveByHand(input),
    async saveContent(input: Parameters<StudioApi["saveContent"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      // The workspace assets for this content are updated in the same save, so the two never drift apart.
      const content = ContentSchema.parse(input.content)
      const next = await Promise.resolve()
        .then(() => applyContent(current.project, content))
        .catch((error: unknown) => {
          // Said with the name of the thing being saved, which only this call knows.
          const words = plainContent(error, { recipes: content.recipes, entities: current.project.entities })
          throw words ? new StudioError(words) : error
        })
      await projects.saveProject(current.directory, next, input.expectedRevision)
      return view(current.directory)
    },
    async saveConception(input: Parameters<StudioApi["saveConception"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      await projects.saveProject(
        current.directory,
        { ...current.project, conception: ConceptionSchema.parse(input.conception) },
        input.expectedRevision,
      )
      return view(current.directory)
    },
    /** 「发布信息」: who made the mod, its version, licence and links, which the build writes into the jar. Fields left empty are not stored, so the build's own defaults stand. */
    async saveRelease(input: Parameters<StudioApi["saveRelease"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const parsed = ReleaseSchema.safeParse(input.release)
      // The schema's own sentences say what to write instead (a version of three numbers, a link that starts with https://).
      if (!parsed.success) throw new StudioError(parsed.error.issues[0]?.message ?? "发布信息里有一项写得不对。")
      const release = Object.keys(parsed.data).length ? parsed.data : undefined
      await projects.saveProject(current.directory, { ...current.project, release }, input.expectedRevision)
      return view(current.directory)
    },
    /**
     * 「模组信息」: the mod's own words about itself, saved in one step so the page has one Save and the project never holds half of it.
     * Empty English fields are taken away (the mod then shows its Chinese ones in both games, as before). The icon is checked and sized here, not trusted from the window.
     */
    async saveModInfo(input: Parameters<StudioApi["saveModInfo"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const info = input.info
      const name = info.name.trim()
      if (!name || name.length > 120) throw new StudioError("模组的名字要写 1 到 120 个字。")
      const released = ReleaseSchema.safeParse(info.release)
      // The schema's own sentences say what to write instead (a version of three numbers, a link that starts with https://).
      if (!released.success) throw new StudioError(released.error.issues[0]?.message ?? "发布信息里有一项写得不对。")
      const english = (value: string, schema: typeof ProjectSchema.shape.name_en, fallback: string) => {
        const text = value.trim()
        if (!text) return null
        const parsed = schema.safeParse(text)
        if (!parsed.success) throw new StudioError(parsed.error.issues[0]?.message ?? fallback)
        return parsed.data ?? null
      }
      const nameEn = english(info.name_en, ProjectSchema.shape.name_en, "英文名写得不对。")
      const descriptionEn = english(info.description_en, ProjectSchema.shape.description_en, "英文介绍写得不对。")
      const icon = await Promise.resolve().then(() => {
        if (info.icon === undefined) return current.project.icon ?? null
        if (info.icon === null) return null
        // The picture the window hands over is the one it still shows, which may be the saved (already sized) one: that is kept as it is.
        if (info.icon === current.project.icon) return info.icon
        const bytes = iconBytes(info.icon)
        if (!bytes) throw new StudioError(ICON_WORDS.unreadable)
        const made = givenIcon(bytes)
        if (!made.ok) throw new StudioError(made.text)
        return iconUrl(made.png)
      })
      const { name_en: _name, description_en: _description, icon: _icon, ...rest } = current.project
      await projects.saveProject(
        current.directory,
        {
          ...rest,
          name,
          description: info.description,
          release: Object.keys(released.data).length ? released.data : undefined,
          ...(nameEn ? { name_en: nameEn } : {}),
          ...(descriptionEn ? { description_en: descriptionEn } : {}),
          ...(icon ? { icon } : {}),
        },
        input.expectedRevision,
      )
      return view(current.directory)
    },
    /**
     * The English name of one block, item or creature. A block or an item goes through the same save as the form, which keeps the
     * workspace asset describing it in step; a creature is written on its entry and on its rules asset, as `saveEntity` does.
     */
    async setEnglishName(input: Parameters<StudioApi["setEnglishName"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const text = input.name_en.trim()
      const parsed = text ? EnglishNameSchema.safeParse(text) : null
      if (parsed && !parsed.success) throw new StudioError(parsed.error.issues[0]?.message ?? "英文名写得不对。")
      const value = parsed?.success ? parsed.data : null
      const project = current.project
      const missing = new StudioError("工程里找不到这样东西了，可能刚被删掉。")
      if (input.kind === "entity") {
        if (!project.entities.some((entity) => entity.id === input.id)) throw missing
        const updatedAt = new Date().toISOString()
        await projects.saveProject(
          current.directory,
          {
            ...project,
            entities: project.entities.map((entity) => (entity.id === input.id ? { ...entity, name_en: value } : entity)),
            workspace: {
              assets: project.workspace.assets.map((asset) =>
                asset.module === "entity" && asset.document.kind === "entity" && asset.document.model_asset_id === input.id && (asset.document.name_en ?? null) !== value
                  ? { ...asset, revision: asset.revision + 1, updated_at: updatedAt, document: { ...asset.document, name_en: value } }
                  : asset,
              ),
            },
          },
          input.expectedRevision,
        )
        return view(current.directory)
      }
      const list = input.kind === "block" ? project.blocks : project.items
      if (!list.some((entry) => entry.id === input.id)) throw missing
      const content = ContentSchema.parse({
        blocks: input.kind === "block" ? project.blocks.map((entry) => (entry.id === input.id ? { ...entry, name_en: value } : entry)) : project.blocks,
        items: input.kind === "item" ? project.items.map((entry) => (entry.id === input.id ? { ...entry, name_en: value } : entry)) : project.items,
        recipes: project.recipes,
        logic: project.logic,
      })
      await projects.saveProject(current.directory, applyContent(project, content), input.expectedRevision)
      return view(current.directory)
    },
    /** The name the person sees. The mod id was fixed when the project was made and is what saves and other mods refer to: it never follows. */
    async renameProject(input: Parameters<StudioApi["renameProject"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const name = input.name.trim()
      if (!name || name.length > 120) throw new StudioError("工程名字要写 1 到 120 个字。")
      await projects.saveProject(current.directory, { ...current.project, name }, input.expectedRevision)
      return view(current.directory)
    },
    /**
     * Nothing is unlinked: the folder is moved into 「已删除」 beside where it was, so it can be taken back by hand.
     * Beside, not into one fixed place, because a project may live on another drive and a move across drives is a copy that can fail halfway.
     */
    async deleteProject(input: Parameters<StudioApi["deleteProject"]>[0]) {
      const directory = await directoryFor(input.projectId)
      const project = await projects.openProject(directory)
      const busy = (await jobs.listJobs(directory)).some((job) => ["queued", "running"].includes(job.state)) || (await projectRunner.list(input.projectId)).some((run) => ["planning", "running"].includes(run.state))
      if (busy) throw new StudioError("这个工程里还有事情正在进行。等它结束或者先取消，再删除。")
      // A folder name every system takes: what a path cannot hold becomes an underscore, and a name of only such characters still gets one.
      const label = project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 60) || "工程"
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
      const bin = path.join(path.dirname(directory), DELETED_FOLDER)
      await mkdir(bin, { recursive: true })
      // Two projects of one name deleted within the same second still get a folder each.
      const taken = (target: string) => access(target).then(() => true, () => false)
      const free = async (count: number): Promise<string> => {
        const target = path.join(bin, `${label}-${stamp}${count ? `-${count + 1}` : ""}`)
        return (await taken(target)) ? free(count + 1) : target
      }
      const moved = await free(0)
      await rename(directory, moved)
      known.delete(input.projectId)
      selected.delete(input.projectId)
      recovered.delete(input.projectId)
      openNotices.delete(input.projectId)
      const listed = external.indexOf(directory)
      if (listed >= 0) {
        external.splice(listed, 1)
        await projects.writeRecord(workspace, ["studio-locations.json"], external)
      }
      return { moved }
    },
    async importConception(input: Parameters<StudioApi["importConception"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const plan = ConceptionPlanSchema.parse(input.plan)
      const imported = applyConceptionPlan(current.project, conceptionFromPlan(current.project, plan))
      await projects.saveProject(current.directory, { ...imported.project, name: plan.name }, input.expectedRevision)
      return view(current.directory)
    },
    async analyzeConception(input: Parameters<StudioApi["analyzeConception"]>[0]) {
      if (!direct()) throw new StudioError("请先配置本机 AI 凭据，再整理模组构想。")
      const connection = { apiKey: direct()!, baseUrl: ai.baseUrl, model: ai.routerModel }
      const current = await source(input.projectId, input.expectedRevision)
      const brief = z.string().trim().min(1).max(20000).parse(input.brief)
      const saved = await projects.saveProject(
        current.directory,
        { ...current.project, conception: { ...current.project.conception, brief } },
        input.expectedRevision,
      )
      const job = await jobs.startJob(current.directory, {
        kind: "analyze-conception",
        expectedRevision: saved.revision,
        input: { brief },
      })
      run(current.directory, job, async (signal, progress) => {
        progress("正在根据构想整理模组设定和内容目录。")
        const plan = await requestAuthoring(
          ConceptionPlanSchema,
          {
            brief,
            project_name: saved.name,
            existing_plan: saved.conception.review,
            existing_entries: saved.conception.entries.map((entry) => ({
              key: entry.key,
              title: entry.title,
              kind: entry.kind,
              brief: entry.brief,
            })),
          },
          { ...connection, instructions: WORLD_INSTRUCTIONS, signal },
        )
        if (signal.aborted) throw new ModelingError("CANCELLED")
        await projects.saveProject(
          current.directory,
          { ...saved, conception: { ...saved.conception, review: plan, status: "reviewed" } },
          saved.revision,
        )
        return { reviewed: true, entries: plan.entries.length }
      })
      return { jobId: job.id, view: await view(current.directory) }
    },
    async saveEntry(input: Parameters<StudioApi["saveEntry"]>[0]) {
      return saveEntryAt(await source(input.projectId, input.expectedRevision), input.entry)
    },
    async reviewEntry(input: Parameters<StudioApi["reviewEntry"]>[0]) {
      if (!direct()) throw new StudioError("请先配置本机 AI 凭据，再整理内容设计。")
      const connection = { apiKey: direct()!, baseUrl: ai.baseUrl, model: ai.moduleModel }
      const entry = ConceptionEntrySchema.parse(input.entry)
      if (input.behavior && (!entry.entity_id || !entry.model_confirmed_asset_id))
        throw new StudioError("请先确认这个生物的模型与动画。")
      if (input.behavior && !entry.behavior_brief.trim()) throw new StudioError("请描述这个生物的行为与玩法。")
      if (!input.behavior && entry.kind === "recipe") {
        if (!entry.recipe.input_names.some((value) => value.trim()) || !entry.recipe.output_name.trim())
          throw new StudioError("请填写至少一个材料和产物。")
        entry.recipe.intent = entry.brief
      }
      const beforeSave = await source(input.projectId, input.expectedRevision)
      const existing = beforeSave.project.conception.entries.find((value) => value.id === entry.id)
      const current = await saveEntryAt(beforeSave, {
        ...entry,
        review: existing?.review ?? entry.review ?? null,
        behavior_review: existing?.behavior_review ?? entry.behavior_review ?? null,
      })
      const persistedEntry = current.project.conception.entries.find((value) => value.id === entry.id)
      if (!persistedEntry) throw new StudioError("内容条目保存失败。")
      const job = await jobs.startJob(current.directory, {
        kind: "review-content",
        expectedRevision: current.project.revision,
        input: { entry: persistedEntry, behavior: input.behavior },
      })
      run(current.directory, job, async (signal, progress) => {
        progress(input.behavior ? "正在整理这个生物的行为与动作衔接。" : "正在整理内容的制作要求。")
        const review = await requestAuthoring(
          ConceptionReviewSchema,
          {
            worldview: current.project.conception.review?.worldview ?? current.project.conception.plan,
            entry: persistedEntry,
            behavior: input.behavior,
            animations: input.behavior ? current.model?.animations.map((animation) => animation.name) : [],
          },
          { ...connection, instructions: CONTENT_INSTRUCTIONS, signal },
        )
        if (signal.aborted) throw new ModelingError("CANCELLED")
        await saveEntryAt(current, {
          ...persistedEntry,
          ...(input.behavior ? { behavior_review: review } : { review }),
          status: "reviewed",
        })
        return { reviewed: true, entry_id: entry.id }
      })
      return { jobId: job.id, view: current }
    },
    async getModelProgress(input: Parameters<StudioApi["getModelProgress"]>[0]) {
      await jobs.loadJob(await directoryFor(input.projectId), input.jobId)
      return modelSessions.get(input.jobId)?.read() ?? null
    },
    async getSettings() {
      return readStudioSettings()
    },
    async loadBlockbench(input: Parameters<StudioApi["loadBlockbench"]>[0]) {
      const current = await source(input.projectId)
      const entity = current.project.entities.find((value) => value.id === input.entityId)
      if (!entity) throw new StudioError("找不到这个生物。")
      if (!entity.model_asset_id)
        return {
          meta: { format_version: "5.0", model_format: "free", box_uv: false },
          name: entity.name,
          resolution: { width: 64, height: 64 },
          elements: [],
          outliner: [{ uuid: randomUUID(), name: "root", origin: [0, 0, 0], rotation: [0, 0, 0], children: [] }],
          textures: [],
          animations: [],
        }
      const asset = await loadModelAsset(current.directory, entity.model_asset_id)
      const data = z
        .object({ design: ModelDesignSchema, blockbench: z.record(z.string(), z.unknown()).optional() })
        .parse(asset.data)
      return data.blockbench ?? (designToBlockbench(data.design) as Record<string, unknown>)
    },
    async saveBlockbench(input: Parameters<StudioApi["saveBlockbench"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      if (!current.project.entities.some((entity) => entity.id === input.entityId))
        throw new StudioError("找不到这个生物。")
      // 第 2 步: what Blockbench has no place for (a clip's blend and layered, the follow bones) is kept from the design as it was.
      const entity = current.project.entities.find((value) => value.id === input.entityId)!
      const before = entity.model_asset_id ? await loadModelAsset(current.directory, entity.model_asset_id).then((asset) => ModelDesignSchema.safeParse((asset.data as { design?: unknown } | null)?.design).data ?? null, () => null) : null
      // A file that cannot be taken in is refused with a sentence naming what is wrong in it, not the generic line (see model-import-words.ts).
      const design = (() => {
        try {
          const converted = keptPlayWords(blockbenchToDesign(input.snapshot), before)
          compileSavedModel({ design: converted, blockbench: input.snapshot }, creatureName({ id: input.entityId }))
          return converted
        } catch (error) {
          const failure = modelImportFailure(error)
          if (failure && "words" in failure) throw new StudioError(failure.words)
          if (failure) throw new Error(failure.code)
          throw error
        }
      })()
      await putModelAsset(current.directory, {
        entity_id: input.entityId,
        expectedRevision: input.expectedRevision,
        origin: "manual",
        data: { design, blockbench: input.snapshot, provenance: null },
      })
      selected.set(input.projectId, input.entityId)
      return view(current.directory)
    },
    async saveSettings(input: Parameters<StudioApi["saveSettings"]>[0]) {
      // The folder for new projects is not the renderer's to type: it stays what the chooser last gave (`saveProjectsDirectory`).
      // The Java and its install folder likewise stay what 运行环境 set (`chooseJava`, `installJava`).
      const stored = await readStudioSettings()
      const saved = await saveStudioSettings({ ...input, epicSixViewStyle: input.epicSixViewStyle ?? stored.epicSixViewStyle, projectsDirectory: stored.projectsDirectory, javaHome: stored.javaHome, javaInstallDirectory: stored.javaInstallDirectory })
      // Turned off: what is being fetched stops (what was finished stays). Turned on: a look at once, not after the wait a look that found nothing has.
      if (!saved.prepareAhead) ahead?.stop()
      else if (!stored.prepareAhead && aheadWhere.directory) ahead?.consider(aheadWhere.directory, true)
      return saved
    },
    async saveProjectsDirectory(input: Parameters<StudioApi["saveProjectsDirectory"]>[0]) {
      const directory = input.locationToken ? locations.get(z.uuid().parse(input.locationToken)) : ""
      if (directory === undefined) throw new StudioError("工程位置已失效，请重新选择文件夹。")
      const settings = SettingsSchema.parse({ ...(await readStudioSettings()), projectsDirectory: directory === workspace ? "" : directory })
      await projects.writeRecord(workspace, ["studio-settings.json"], settings)
      return settings
    },
    async exportProjectTo(projectId: string, destination: string) {
      return exportProjectArchive({ directory: await directoryFor(projectId), destination })
    },
    async inspectArchive(token: string, filename: string) {
      const preview = await inspectProjectArchive(filename)
      archives.set(token, filename)
      return { token, name: path.basename(filename), project: preview.project, environment: preview.environment }
    },
    async importProject(input: Parameters<StudioApi["importProject"]>[0]) {
      const archive = archives.get(input.token)
      if (!archive) throw new StudioError("请选择需要导入的工程文件。")
      const preview = await inspectProjectArchive(archive)
      await discover()
      if (known.has(preview.project.id))
        throw new StudioError("这个工程已在作品中。请先打开已有工程，避免导入重复副本。")
      const imported = await importProjectArchive({ archive, destination: path.join(workspace, randomUUID()) })
      known.set(imported.project.id, imported.directory)
      archives.delete(input.token)
      return view(imported.directory)
    },
    async saveEntity(input: Parameters<StudioApi["saveEntity"]>[0]) {
      const parsed = WorkerRequestSchema.parse({ method: "saveEntity", input })
      if (parsed.method !== "saveEntity") throw new StudioError("实体参数无效。")
      const current = await source(parsed.input.projectId, parsed.input.expectedRevision)
      const target = entityFor(current, parsed.input.entityId ?? current.entity_id)
      const updated = {
        name: parsed.input.name,
        description: parsed.input.description,
        health: parsed.input.health,
        speed: parsed.input.speed,
        attack_damage: parsed.input.attack_damage,
        behavior: parsed.input.behavior,
        ...(parsed.input.steady !== undefined ? { steady: parsed.input.steady } : {}),
      }
      const updatedAt = new Date().toISOString()
      await projects.saveProject(
        current.directory,
        {
          ...current.project,
          entities: current.project.entities.map((entity) =>
            entity.id === target.id
              ? {
                  ...entity,
                  ...updated,
                }
              : entity,
          ),
          workspace: {
            assets: current.project.workspace.assets.map((asset) => {
              if (
                asset.module !== "entity" ||
                asset.document.kind !== "entity" ||
                asset.document.model_asset_id !== target.id
              )
                return asset
              const changed =
                asset.document.name !== updated.name ||
                asset.document.description !== updated.description ||
                asset.document.health !== updated.health ||
                asset.document.speed !== updated.speed ||
                asset.document.attack_damage !== updated.attack_damage ||
                asset.document.behavior !== updated.behavior ||
                (updated.steady !== undefined && JSON.stringify(asset.document.steady) !== JSON.stringify(updated.steady))
              if (!changed) return asset
              return {
                ...asset,
                // The title follows the name only when the name itself was changed: a setting saved from the creature's page (稳重) kept the name
                // and still replaced a title its maker had written (「蚩尤（终极 Boss）」 became 「蚩尤」, r20).
                title: asset.document.name !== updated.name ? updated.name : asset.title,
                revision: asset.revision + 1,
                updated_at: updatedAt,
                document: { ...asset.document, ...updated },
              }
            }),
          },
        },
        parsed.input.expectedRevision,
      )
      return view(current.directory)
    },
    // No screen offers this any more: 查看示例 shows the example without saving it, because a saved example became the person's
    // own creature and read as made. It stays as the way a test (or a script) gives a creature a finished model quickly.
    async useExample(input: Parameters<StudioApi["useExample"]>[0]) {
      const current = await source(input.projectId, input.expectedRevision)
      const entity = entityFor(current, input.entityId ?? current.entity_id)
      compileModel(mushroomCowDesign, creatureName(entity))
      await putModelAsset(current.directory, {
        entity_id: entity.id,
        data: {
          design: ModelDesignSchema.parse(mushroomCowDesign),
          blockbench: designToBlockbench(mushroomCowDesign),
          provenance: null,
        },
        origin: "example",
        expectedRevision: input.expectedRevision,
      })
      selected.set(input.projectId, entity.id)
      return view(current.directory)
    },
    async generateModel(input: Parameters<StudioApi["generateModel"]>[0]) {
      if (!direct() && !gateway()) throw new StudioError("尚未连接模型。请打开个人设置，选择厂商并完成密钥配置。")
      const connection = { apiKey: direct(), baseUrl: ai.baseUrl, model: ai.model }
      const client = gateway() ? createModelingClient(gateway()!) : undefined
      const current = await source(input.projectId, input.expectedRevision)
      const studioSettings = await readStudioSettings()
      // broad20: this creature's model is made by the button's level raised to what its tier on the confirmed blueprint asks, told and reviewed alike.
      const confirmed = current.project.blueprint?.state === "confirmed" ? current.project.blueprint.entries : []
      const modelComplexity = detailForModel(confirmed, current.project.workspace.assets, entityFor(current).id, studioSettings.modelComplexity)
      const annotation = input.annotation ? validateModelAnnotation(input.annotation, current.project, entityFor(current).id) : undefined
      if (annotation && !current.model) throw new StudioError("请先保存模型，再截图标注修改。")
      const request = ModelingInputSchema.safeParse({
        step: current.model ? "revise" : "model",
        revision: String(current.project.revision),
        complexity: modelComplexity,
        ...(annotation ? { images: [annotation.image] } : {}),
        content: JSON.stringify({
          prompt: z.string().trim().min(1).max(16000).parse(input.prompt),
          // 个人设置: this older path's instructions are built by the modelling service, so the wishes travel beside the prompt. Nothing said: no field.
          ...(standingWishes(studioSettings) ? { person_wishes: standingWishes(studioSettings).trim() } : {}),
          ...(annotation ? { annotation: modelAnnotationContext(annotation) } : {}),
          entity: entityFor(current),
          worldview: current.project.conception.review?.worldview ?? current.project.conception.plan,
          content_brief:
            current.project.conception.entries.find((entry) => entry.entity_id === entityFor(current).id)?.brief ?? "",
          previous_design: current.model,
          previous_editor: current.blockbench
            ? {
                resolution: current.blockbench.resolution,
                elements: current.blockbench.elements,
                outliner: current.blockbench.outliner,
                groups: current.blockbench.groups,
                animations: current.blockbench.animations,
                textures: Array.isArray(current.blockbench.textures)
                  ? current.blockbench.textures.map((value) => {
                      const texture = z.record(z.string(), z.unknown()).parse(value)
                      return { name: texture.name, uuid: texture.uuid, width: texture.width, height: texture.height }
                    })
                  : [],
              }
            : null,
        }),
      })
      if (!request.success) throw new StudioError("描述和已有模型超过当前上下文限制，请缩短描述或使用更简单的模型。")
      const job = await jobs.startJob(current.directory, {
        kind: "generate-model",
        entity_id: entityFor(current).id,
        expectedRevision: current.project.revision,
        input: request.data,
      })
      const session = createModelCoreSession(current.model)
      if (modelSessions.size >= 32) modelSessions.delete(modelSessions.keys().next().value!)
      modelSessions.set(job.id, session)
      const applyProgress = (event: ModelProgressEvent) => {
        const params =
          event.type === "reset"
            ? {
                name: "model.begin",
                arguments: {
                  name: (current.model?.name ?? entityFor(current).name).slice(0, 80),
                  texture_size: current.model?.texture_size ?? 256,
                },
              }
            : event.type === "bone"
              ? { name: "model.upsert_bone", arguments: event.value }
              : event.type === "animation"
                ? { name: "model.upsert_animation", arguments: event.value }
                : null
        if (params) session.call({ jsonrpc: "2.0", id: session.read().sequence, method: "tools/call", params })
      }
      run(current.directory, job, async (signal, progress) => {
        progress("正在生成模型结构、像素贴图与动画。")
        const received = ModelingResultSchema.parse(
          client
            ? await client.requestModelingStep(request.data, { signal })
            : await requestModelingStepWithKey(
                request.data,
                createModelingContext({
                  userId: "local-developer",
                  taskId: job.id,
                  authorized: true,
                  budget: { maxAttempts: 2, maxTotalTokens: 250000, maxOutputTokens: 32768 },
                  timeoutMs: 600000,
                  signal,
                }),
                connection.apiKey!,
                connection.baseUrl,
                connection.model,
                () => progress("正在校正骨骼、贴图边界和动作数据。"),
                applyProgress,
              ),
        )
        if (received.revision !== request.data.revision) throw new ModelingError("INVALID_OUTPUT")
        const result = {
          ...received,
          design: fitModelAtlas(received.design, creatureName(entityFor(current))).design,
        }
        if (signal.aborted) throw new ModelingError("CANCELLED")
        // The modelling service judges its own output; this is the same standard at the door into the project, so a
        // model from a service that did not judge it (an older gateway) is not saved either.
        const review = reviewAsset(
          current.project,
          { id: entityFor(current).id, module: "model", document: { kind: "model", ...result.design }, dependencies: [] },
          { brief: input.prompt, insisted: true, complexity: modelComplexity, candidate: true },
        )
        if (!review.passed) throw new StudioError(`模型没通过检查，工程里什么都没有改动。${refusalText(review)}`)
        progress("正在校验模型核心与工程资源。")
        session.call({
          jsonrpc: "2.0",
          id: session.read().sequence,
          method: "tools/call",
          params: { name: "model.finish", arguments: result.design },
        })
        const blockbench = designToBlockbench(result.design)
        if (signal.aborted) throw new ModelingError("CANCELLED")
        compileSavedModel(
          { design: result.design, blockbench },
          creatureName(entityFor(current)),
        )
        progress("模型与编辑资源校验通过，正在保存新版本。")
        const saved = await putModelAsset(current.directory, {
          entity_id: entityFor(current).id,
          data: {
            design: result.design,
            blockbench,
            provenance: result.provenance,
            usage: result.usage,
            transaction_id: job.id,
          },
          origin: ai.model === MODEL_POLICY.model ? "gpt-6-astra" : "ai",
          expectedRevision: current.project.revision,
          job_id: job.id,
        })
        return {
          asset_id: saved.asset.id,
          asset_revision: saved.asset.revision,
          project_revision: saved.project.revision,
        }
      })
      return { jobId: job.id }
    },
    async saveModel(input: Parameters<StudioApi["saveModel"]>[0]) {
      const parsed = WorkerRequestSchema.parse({ method: "saveModel", input })
      if (parsed.method !== "saveModel") throw new StudioError("模型参数无效。")
      const current = await source(parsed.input.projectId, parsed.input.expectedRevision)
      const entity = entityFor(current, parsed.input.entityId ?? current.entity_id)
      compileModel(parsed.input.model, creatureName(entity))
      await putModelAsset(current.directory, {
        entity_id: entity.id,
        expectedRevision: current.project.revision,
        origin: "manual",
        data: { design: parsed.input.model, blockbench: designToBlockbench(parsed.input.model), provenance: null },
      })
      selected.set(input.projectId, entity.id)
      return view(current.directory)
    },
    async getJob(input: Parameters<StudioApi["getJob"]>[0]) {
      return jobs.loadJob(await directoryFor(input.projectId), input.jobId)
    },
    /**
     * The build panel's facts about the packs: which version the newest pack is and which the press in progress is working from (each said against the
     * project as it is now, see `packedVersion`), and which downloads are already on this computer (so "the first time" is only said when it is one).
     */
    async getBuildPanel(input: Parameters<StudioApi["getBuildPanel"]>[0]) {
      const current = await source(input.projectId)
      const [newest, asked, view, fabricReady, fabricWhole, target, latestJob, glyphs] = await Promise.all([
        latestSuccessfulBuild(current.directory),
        input.jobId ? successfulBuild(current.directory, input.jobId) : null,
        blueprints.overview({ projectId: input.projectId }),
        setupReady(current.directory),
        setupWhole(current.directory),
        targetSceneFacts(current.project),
        jobs.listJobs(current.directory).then((list) => list.find((job) => job.kind === "build")),
        // Said ahead, never in the way: a font folder that cannot be read leaves the line out, as for a project without such characters.
        glyphForecast(current.project).catch(() => null),
      ])
      // A Forge or NeoForge project's check and game are that target's own instances: what is on this computer, and what a first time downloads, are theirs.
      const ready = target ? { ...fabricReady, check: target.ready.check, play: target.ready.play } : fabricReady
      const whole = target ? { ...fabricWhole, play: target.ready.play } : fabricWhole
      // Every thing the project holds, whatever the plan says about it today: a saved thing the newest plan sets aside (「这次不做」) is still in the project, and a pack
      // that was made with it holds it. How many a pack holds comes from its manifest (`packedVersion`); this list only names what was added or changed since.
      const items = view.items
        .map((item) => ({ asset_id: item.asset_id, kind: item.kind, title: item.title, saved: item.facts.saved, revision: item.revision }))
      const version = (build: Awaited<ReturnType<typeof latestSuccessfulBuild>>) => (build ? packedVersion({ job_id: build.job_id, revision: build.revision, finished_at: build.finished_at, assets: build.assets }, current.project.revision, items) : null)
      // What the preparation is doing now, and the last try that did not succeed. A failure is not shown once the step it was in has been done another way (a pack fetched
      // those files itself) or while the switch is off, because nothing will try again then.
      const now = ahead?.status()
      const stepDone = { development: fabricReady.build && fabricWhole.build, server: fabricReady.check, client: fabricReady.play && fabricWhole.play }
      const failed = now?.failure && !ahead?.active() && (await readStudioSettings()).prepareAhead && !(now.failure.step && stepDone[now.failure.step]) ? now.failure : null
      return {
        ...(latestJob?.state === "failed" && latestJob.checkpoint && typeof latestJob.checkpoint === "object" && "reason" in latestJob.checkpoint && latestJob.checkpoint.reason === "java_cache" && latestJob.error ? { javaProblem: latestJob.error } : {}),
        latest: version(newest),
        used: version(asked),
        drafts: unbuiltThings(current.project).length,
        ready,
        whole,
        ...(target ? { cold: target.cold } : {}),
        ...(ahead?.active() ? { preparing: true, ...(now?.step ? { prepareStep: now.step } : {}), ...(now?.counter ? { prepareCounter: now.counter } : {}) } : {}),
        ...(failed ? { prepareFailed: { step: failed.step, why: failed.why, retryAt: new Date(failed.retryAt).toISOString() } } : {}),
        ...(glyphs ? { glyphs } : {}),
      }
    },
    async getLatestBuild(input: Parameters<StudioApi["getLatestBuild"]>[0]) {
      return (await jobs.listJobs(await directoryFor(input.projectId))).find((job) => job.kind === "build") ?? null
    },
    async cancelJob(input: Parameters<StudioApi["cancelJob"]>[0]) {
      const directory = await directoryFor(input.projectId)
      const job = await jobs.cancelJob(directory, input.jobId)
      controllers.get(input.jobId)?.abort()
      return job
    },
    async buildProject(input: Parameters<StudioApi["buildProject"]>[0]) {
      const current = await source(input.projectId)
      const key = `${input.projectId}:${current.project.revision}`
      const pending = buildStarts.get(key)
      if (pending) return pending
      const starting = (async () => {
        const existing = (await jobs.listJobs(current.directory)).find(
          (job) =>
            job.kind === "build" &&
            job.project_revision === current.project.revision &&
            ["queued", "running"].includes(job.state),
        )
        if (existing) return { jobId: existing.id }
        if (!hasBuildContent(current.project))
          throw new StudioError("请先添加生物、方块、物品或书，再构建模组。")
        const job = await jobs.startJob(current.directory, {
          kind: "build",
          expectedRevision: current.project.revision,
        })
        // A preparation that did not succeed is not waited on: the press is the next try, for the game's files as well (`pressed`).
        ahead?.pressed(current.directory)
        run(current.directory, job, async (signal, onProgress) => {
          // The development files are on their way already (提前准备): wait for them instead of fetching them a second time.
          await ahead?.join({ signal, onProgress })
          const build = await import("@minemods/mod-core/build")
          const author = (await readStudioSettings()).nickname
          // Activity panel: the build's stages, warnings and end are reported from this one place.
          const watch = buildWatch(current.directory)
          const whole = { kind: "build" as const, item: null, title: null }
          // The end of what Gradle printed, kept for 高级 when the build fails on a download.
          const printed = { tail: "" }
          const result = await build
            .buildProjectFiles(current.directory, {
              // Who made it, when the project itself does not say: what the person asked to be called, never Studio's own name by default.
              ...(author ? { author } : {}),
              ...(await javaFor()),
              templateDirectory: options.templateDirectory,
              runtimeDirectory: options.runtimeDirectory,
              signal,
              onProgress: (text) => {
                printed.tail = `${printed.tail}${text}`.slice(-1800)
                onProgress(text)
                watch.progress(text)
              },
              onRetry: (attempt) => void noteActivity(current.directory, { ...whole, mark: "run", text: `下载 Minecraft 的开发文件时网络断了一下，正在自动重试（第 ${attempt} 次，最多 ${GRADLE_NETWORK.retries} 次）。已经下载好的不会重下。` }),
            })
            .catch((error: unknown) => {
              // Not the mod's fault, and said as that in one sentence; what Gradle printed stays behind 高级.
              if (failedOnNetwork(error)) void noteActivity(current.directory, { ...whole, mark: "fail", end: true, text: "模组没有打包成功：下载时网络断了。", lines: [gradleNetworkWords()], detail: printed.tail })
              if (error instanceof BuildStop) {
                const human = new BuildStop(error.rule, error.findings)
                human.message = buildWordsForCreator(current.project, error.findings)
                watch.failed(human)
                throw human
              }
              if (!failedOnNetwork(error)) watch.failed(error)
              throw error
            })
          watch.done(result.jarPath)
          return result
        })
        return { jobId: job.id }
      })().finally(() => buildStarts.delete(key))
      buildStarts.set(key, starting)
      return starting
    },
    async startPlaytest(input: Parameters<StudioApi["startPlaytest"]>[0]) {
      const build = await completedBuild(input.projectId, input.jobId)
      const job = await jobs.startJob(build.current.directory, {
        kind: "playtest",
        expectedRevision: build.current.project.revision,
        input: { build_job_id: input.jobId },
      })
      run(build.current.directory, job, async (signal, onProgress) => {
        const playtest = await import("@minemods/mod-core/build")
        await playtest.launchPlaytest(build.result, {
          ...(await javaFor()),
          runtimeDirectory: options.runtimeDirectory,
          signal,
          onProgress,
        })
        return { build_job_id: input.jobId, exited: true }
      })
      return { jobId: job.id }
    },
    // 「测试场」 (10-07): the built jar and only what it needs, in a game of its own. Checked without a window, or opened for the person.
    async getScene(input: { projectId: string }) {
      const current = await source(input.projectId)
      const scene = await import("@minemods/mod-core/scene-run")
      const record = await scene.readScene(options.runtimeDirectory, current.project.id)
      // A check of an earlier revision says nothing about the project as it is now; the window says so beside it.
      const directory = scene.scenePaths(options.runtimeDirectory, current.project.id).instance
      // The world the windowless check leaves behind; opening the scene without it lands on the game's main menu (the client is only sent into a world that is there).
      // A Forge or NeoForge project's check leaves it in that target's server instance (`scene-target.ts`), from where opening the game copies it.
      const level = current.project.target === DEFAULT_TARGET ? path.join(directory, "saves", SCENE.world, "level.dat") : path.join((await import("@minemods/mod-core/scene-target")).targetScenePaths(options.runtimeDirectory, current.project.id, current.project.target).world, "level.dat")
      const world = await stat(level).then(() => true, () => false)
      return { record, current: record?.revision === current.project.revision, lines: record?.report ? scene.sceneLines(record.report) : [], eula: await sceneEula(), world, directory, extra: path.join(current.directory, SCENE_EXTRA) }
    },
    /**
     * 验收回执: what Studio measured, refused and verified for this project, from the records it keeps. Read-only; no picture is read.
     * The assembly is `buildReceipt` (pure); this only reads the records in.
     */
    async getReceipt(input: { projectId: string }): Promise<Receipt> {
      const current = await source(input.projectId)
      const [view, makings, gameplays, activity, scene] = await Promise.all([
        blueprints.overview(input),
        listMakings(current.directory),
        listGameplay(current.directory),
        readActivity(current.directory),
        import("@minemods/mod-core/scene-run").then((value) => value.readScene(options.runtimeDirectory, current.project.id)),
      ])
      const runtime = new Map(view.kinds.map((kind) => [kind.id, kind.capability === "runtime"]))
      return buildReceipt({
        items: view.items.map((item) => ({ ...item, runtime: runtime.get(item.kind) === true })),
        makings,
        gameplays,
        events: activity.events,
        scene: { record: scene, current: scene?.revision === current.project.revision },
      })
    },
    /**
     * What the checks after a build found, handed to the AI: each thing with findings is sent back through the
     * same redo its card starts, with the findings as the words. Before this the findings stopped at the screen
     * and the person retyped each one. A scene check of an earlier revision says nothing about this one and is not read.
     */
    async fixFindings(input: { projectId: string }): Promise<FixFindingsResult> {
      const current = await source(input.projectId)
      const project = current.project
      const [guide, record, view] = await Promise.all([
        (await import("@minemods/mod-core/guide-project")).projectGuide(current.directory),
        sceneRuntime().then((value) => value.readScene(options.runtimeDirectory, project.id)),
        blueprints.overview(input),
      ])
      // A crash of the last opening of the game, while it is about this very revision: handed over with the report's own words (the exception, the place, the start of the stack).
      const crash = record?.revision === project.revision ? (record.crash ?? null) : null
      const crashAsset = crash?.where?.gameplay ? project.workspace.assets.find((asset) => asset.document.kind === "gameplay" && (asset.document as { slug?: string }).slug === crash.where!.gameplay) : undefined
      const grouped = groupFindings({
        guide: guide.findings,
        scene: record?.revision === project.revision ? (record.report ?? null) : null,
        crash: crash
          ? { about: crashAsset ? { kind: "gameplay", id: crashAsset.id, name: crashAsset.title } : null, title: crashAsset?.title ?? FIX_WORDS.whole, lines: crashRemark(crash, crashAsset?.title ?? null), plain: crashSentence(crash, () => crashAsset?.title ?? null) }
          : null,
        contents: [
          ...project.blocks.map((block) => ({ kind: "block" as const, id: block.id, name: block.name, registry: `${project.mod_id}:${block.identifier}` })),
          ...project.items.map((item) => ({ kind: "item" as const, id: item.id, name: item.name, registry: `${project.mod_id}:${item.identifier}` })),
          ...project.entities.map((entity) => ({ kind: "entity" as const, id: entity.id, name: entity.name, registry: `${project.mod_id}:${creatureName(entity)}` })),
        ],
        items: view.items,
      })
      const asked = grouped.things.length ? await blueprints.redoSeveral({ projectId: input.projectId, things: grouped.things.map((thing) => ({ itemId: thing.item.id, feedback: findingsFeedback(thing.lines, REVIEW_NOTE_LIMIT) })) }) : { sent: [], refused: [], own: Boolean(direct()) }
      const started = asked.sent.map((sent) => ({ thing: sent.id, title: sent.title }))
      const left = [
        ...asked.refused.map((refused) => ({ title: grouped.things.find((thing) => thing.item.id === refused.itemId)!.item.title, why: refused.why })),
        ...grouped.unknown.map((thing) => ({ title: thing.title, why: `${FIX_WORDS.unknown}${thing.lines.join("")}` })),
        ...(grouped.general.length ? [{ title: FIX_WORDS.whole, why: FIX_WORDS.general(grouped.general) }] : []),
      ]
      const waiting = started.length > 0 && !asked.own
      if (started.length || left.length)
        await noteActivity(current.directory, { kind: "check", mark: started.length ? "note" : "warn", item: null, title: null, text: FIX_WORDS.note(started.length, left.length), lines: [...started.map((value) => value.title), ...left.map((value) => `${value.title}：${value.why}`)] })
      return { started, left, nothing: !started.length && !left.length, waiting, tell: waiting && ai.mode === "mcp" ? FIX_WORDS.tell(project.name, started.map((value) => value.title)) : null }
    },
    /** The person's own agreement to the game's licence, which its server asks for before the windowless check can start. Only ever called from Studio's own window. */
    async agreeSceneEula() {
      await mkdir(path.join(options.runtimeDirectory, "scene"), { recursive: true })
      await writeFile(sceneEulaFile, `${JSON.stringify({ agreed_at: new Date().toISOString(), licence: "https://aka.ms/MinecraftEULA" })}\n`)
      // The server's files could not be fetched ahead before this; they can now.
      if (aheadWhere.directory) ahead?.consider(aheadWhere.directory, true)
      return { eula: true }
    },
    async startSceneCheck(input: { projectId: string; jobId: string }) {
      const build = await completedBuild(input.projectId, input.jobId)
      if (!(await sceneEula())) throw new StudioError(SCENE_WORDS.eula)
      const job = await jobs.startJob(build.current.directory, { kind: "scene_check", expectedRevision: build.current.project.revision, input: { build_job_id: input.jobId } })
      run(build.current.directory, job, async (signal, onProgress) => {
        const scene = await import("@minemods/mod-core/scene-run")
        const runtime = { ...(await javaFor()), runtimeDirectory: options.runtimeDirectory, signal, onProgress }
        const record = await scene.deployScene({ build: build.result, project: build.current.project, runtimeDirectory: options.runtimeDirectory }, runtime)
        if (record.missing.length) throw new StudioError(SCENE_WORDS.missing(record.missing))
        const report = await scene.checkScene({ project: build.current.project, runtimeDirectory: options.runtimeDirectory, eula: true }, runtime)
        await noteScene(build.current.directory, build.current.project, build.result.id, { report })
        return { build_job_id: input.jobId, mods: record.mods, report, lines: scene.sceneLines(report) }
      })
      return { jobId: job.id }
    },
    async startScenePlay(input: { projectId: string; jobId: string }) {
      const build = await completedBuild(input.projectId, input.jobId)
      const job = await jobs.startJob(build.current.directory, { kind: "scene_play", expectedRevision: build.current.project.revision, input: { build_job_id: input.jobId } })
      run(build.current.directory, job, async (signal, onProgress) => {
        const scene = await sceneRuntime()
        const runtime = { ...(await javaFor()), runtimeDirectory: options.runtimeDirectory, signal, onProgress }
        // A scene already set up for this very build is opened as it is: the world a check left stays the one the person sees.
        // Deployed for the game only (a Forge or NeoForge project's scene then installs its client, not a server it is not going to start).
        const before = await scene.readScene(options.runtimeDirectory, build.current.project.id)
        const record = before && before.build_id === build.result.id ? before : await scene.deployScene({ build: build.result, project: build.current.project, runtimeDirectory: options.runtimeDirectory }, { ...runtime, purpose: "play" })
        if (record.missing.length) throw new StudioError(SCENE_WORDS.missing(record.missing))
        const played = await scene.openScene({ projectId: build.current.project.id, runtimeDirectory: options.runtimeDirectory, modId: build.current.project.mod_id }, runtime)
        // A game that crashed is not a game that was closed (broad18 w2, B18-J-08): the job ends as a failure that says so, with the report and the part it points at.
        if (played.crash) throw crashedPlay(played.crash, build.current.project)
        // Only a game that got as far as the world was something to look at.
        if (played.world && played.code === 0) await noteScene(build.current.directory, build.current.project, build.result.id, { opened: true })
        return { build_job_id: input.jobId, mods: record.mods, world: played.world, exited: true }
      })
      return { jobId: job.id }
    },
    async exportSourceTo(projectId: string, destination: string) {
      const current = await source(projectId)
      if (!hasBuildContent(current.project))
        throw new StudioError("请先添加内容，再导出源码。")
      const build = await import("@minemods/mod-core/build")
      const author = (await readStudioSettings()).nickname
      return { path: await build.exportProjectSource(current.directory, destination, options.templateDirectory, author ? { author } : {}) }
    },
    // Data-only gameplay (Engineer C): the guide and the reconciliation, by rule from the saved project.
    async getModGuide(input: { projectId: string }, external = false) {
      const report = await (await import("@minemods/mod-core/guide-project")).projectGuide(await directoryFor(input.projectId), external)
      return { revision: report.revision, title: report.guide.title, markdown: report.guide.markdown, sections: report.guide.sections, findings: report.findings }
    },
    // r29b: `export_model`: a model's game files into a folder of the project; what is refused is said as it stands.
    async exportModel(input: { projectId: string; assetId: string; folder?: string }) {
      const exported = await import("@minemods/mod-core/model-export")
      return exported.exportProjectModel(await directoryFor(input.projectId), input.assetId, input.folder).catch((error: unknown) => {
        if (error instanceof exported.ModelExportRefusal) throw new StudioError(error.message)
        throw error
      })
    },
    async exportBlockbenchTo(projectId: string, assetId: string, destination: string) {
      if (!path.isAbsolute(destination) || !destination.toLowerCase().endsWith(".bbmodel")) throw new StudioError("请选一个以 .bbmodel 结尾的保存位置。")
      const model = await (await import("@minemods/mod-core/guide-project")).projectBbmodel(await directoryFor(projectId), assetId).catch((error: unknown) => {
        if (error instanceof Error && error.message === "BBMODEL_NO_MODEL") throw new StudioError("这样东西还没有模型，没有可以导出的。")
        throw error
      })
      await writeFile(destination, model.text)
      return { path: destination }
    },
    async listBuildJars(projectId: string) {
      const directory = await directoryFor(projectId)
      const builds = (await jobs.listJobs(directory)).flatMap(job => {
        const result = resultOfBuild(job)
        return result ? [{ job, result }] : []
      }).sort((a, b) => b.job.updated_at.localeCompare(a.job.updated_at))
      return Promise.all(builds.map(async ({ job, result }) => ({
        jobId: job.id, name: path.basename(result.jarPath), revision: result.revision,
        finishedAt: job.updated_at, available: !!await recordedJar(directory, result),
      })))
    },
    async revealRecordedJar(projectId: string, jobId: string) {
      const directory = await directoryFor(projectId)
      const result = resultOfBuild(await jobs.loadJob(directory, jobId))
      const file = result && await recordedJar(directory, result)
      if (!file) throw new StudioError("这次打包的模组文件已找不到。")
      return file
    },
    async jarHandoff(projectId: string, jobId: string, reveal: boolean) {
      const { current, result } = await completedBuild(projectId, jobId)
      const { verifyBuiltResult } = await import("@minemods/mod-core/build")
      const verified = await verifyBuiltResult(current.directory, result)
      const name = deliveredJarName(verified.project)
      return reveal ? deliverJar(current.directory, verified.result, name) : name
    },
    async exportJarTo(projectId: string, jobId: string, destination: string) {
      const build = await completedBuild(projectId, jobId)
      const exporter = await import("@minemods/mod-core/build")
      return { path: await exporter.exportBuiltJar(build.current.directory, build.result, destination) }
    },
    async environment() {
      return {
        aiConfigured: Boolean(direct() || gateway()),
        // A fitting Java was found, or Studio's own is installed (found the same way); a developer's override is only checked to exist.
        javaConfigured: options.javaHome
          ? await access(path.join(options.javaHome, "bin", process.platform === "win32" ? "java.exe" : "java")).then(() => true, () => false)
          : Boolean(await javaReport(studioJava()).then((report) => report.using, () => null)),
        model: ai.model,
        projectAiConfigured: Boolean(direct()),
        routerModel: ai.routerModel,
        assetModel: ai.moduleModel,
        workspace,
        version: "0.1.0-preview" as const,
        profiles: TARGETS.filter((target) => target.ready).map((target) => ({ id: target.id, java: target.java, minecraft: target.minecraft, loader: target.loader, loaderVersion: target.loaderVersion ?? "" })),
      }
    },
    // 新建工程的配置和运行环境 (2026-10-08)
    async getTargets() {
      return { targets: TARGETS.map((target) => ({ ...target })), chosen: DEFAULT_TARGET }
    },
    async detectJava(input: { major: number }) {
      return javaReport(input.major)
    },
    /** null goes back to automatic; a home is taken only when detection finds it there and it fits. */
    async chooseJava(input: { home: string | null; major: number }) {
      const settings = await readStudioSettings()
      forgetJava()
      if (input.home === null) {
        await saveStudioSettings({ ...settings, javaHome: null })
        return javaReport(input.major)
      }
      const report = await probe.detect({ major: input.major, runtimeDirectory: options.runtimeDirectory, installDirectory: settings.javaInstallDirectory, chosen: input.home })
      // Detection lists the asked-for home first, under `chosen`, unless it found nothing that runs there.
      const asked = report.found.find((java) => java.source === "chosen")
      if (!asked) throw new StudioError(SETUP_WORDS.javaMissing)
      if (!asked.fits) throw new StudioError(SETUP_WORDS.javaUnfit(asked.why ?? ""))
      const saved = await saveStudioSettings({ ...settings, javaHome: asked.home })
      javaFound.set(input.major, { at: Date.now(), key: JSON.stringify([saved.javaHome, saved.javaInstallDirectory]), report: Promise.resolve({ found: report.found, using: asked }) })
      return javaReport(input.major)
    },
    planJavaInstall,
    /** The folder the person just picked in the system's chooser (sent by the main process only), and the plan for it. */
    async registerJavaDirectory(input: { major: number; directory: string }) {
      javaDirectories.add(path.resolve(input.directory))
      return planJavaInstall({ major: input.major, directory: input.directory })
    },
    async installJava(input: { major: number; directory?: string | null }) {
      const source = probe.installSource(input.major)
      if (!source) throw new StudioError(SETUP_WORDS.noInstall(input.major))
      const saved = (await readStudioSettings()).javaInstallDirectory
      const directory = input.directory ? pickedJavaDirectory(input.directory, saved) : (saved ?? options.runtimeDirectory)
      const apart = path.resolve(directory) !== path.resolve(options.runtimeDirectory)
      return library.installJava(async (signal, progress) => {
        const plan = await planJavaInstall({ major: input.major, directory })
        if (plan.problem) throw new StudioError(plan.problem)
        progress(SETUP_WORDS.installing(plan.vendor, plan.version, plan.downloadBytes))
        const home = await probe.install(options.runtimeDirectory, { javaDirectory: apart ? directory : undefined, signal })
        forgetJava()
        // Where the person said to put it is where Studio's JDK lives from now on; the runtime folder is the default and saved as such.
        if (input.directory) await saveStudioSettings({ ...(await readStudioSettings()), javaInstallDirectory: apart ? directory : null })
        // `ensureJava` takes a Java 21 already named by JAVA_HOME instead of downloading: said as that, not as an install.
        const managed = path.join(await realpath(directory), MANAGED_JAVA)
        if ((await realpath(home).catch(() => home)) !== managed) return SETUP_WORDS.alreadyThere(input.major, home)
        return SETUP_WORDS.installed(plan.vendor, plan.version, home, await directorySize(managed))
      })
    },
    async listPreinstalledMods(input: { projectId: string }) {
      // A jar put there by hand is named from its own mods file for the project's loader (Forge's and NeoForge's are not Fabric's).
      const { directory, target } = await projectTarget(input.projectId)
      return { mods: await preinstalled.listPreinstalled(directory, target.loader), folder: path.join(directory, SCENE_EXTRA) }
    },
    async searchMods(input: { query: string; targetId: string; offset?: number }) {
      const target = targetById(input.targetId)
      if (!target) throw new StudioError(SETUP_WORDS.unknownTarget)
      const result = await preinstalled.searchModrinth({ query: input.query, minecraft: target.minecraft, loader: target.loader, offset: input.offset })
      // The window shows no picture from the internet; the icons come to it as data.
      const icons = await preinstalled.modrinthIcons(result.hits.map((hit) => hit.icon))
      return { hits: result.hits.map((hit, index) => ({ ...hit, icon: icons[index] ?? null })), total: result.total }
    },
    async addModrinthMod(input: { projectId: string; modrinthId: string }) {
      const { directory, target } = await projectTarget(input.projectId)
      return preinstalled.addFromModrinth({ projectDirectory: directory, projectId: input.modrinthId, minecraft: target.minecraft, loader: target.loader, skip: preinstalled.studioInstalls(target.loader) })
    },
    /** Jars the person just picked in the system's chooser (sent by the main process only): a token for each, usable once. */
    registerModFiles(input: { files: { token: string; filename: string }[] }) {
      return input.files.map((file) => {
        z.uuid().parse(file.token)
        if (!path.isAbsolute(file.filename)) throw new StudioError(SETUP_WORDS.filesGone)
        modFiles.set(file.token, file.filename)
        return { token: file.token, name: path.basename(file.filename) }
      })
    },
    async addModFiles(input: { projectId: string; tokens: string[] }) {
      const files = input.tokens.map((token) => modFiles.get(token))
      if (!files.length || files.some((file) => file === undefined)) throw new StudioError(SETUP_WORDS.filesGone)
      const { directory, target } = await projectTarget(input.projectId)
      const result = await preinstalled.addJarFiles({ projectDirectory: directory, files: files as string[], loader: target.loader })
      input.tokens.forEach((token) => modFiles.delete(token))
      return result
    },
    async removePreinstalledMod(input: { projectId: string; file: string }) {
      const { directory, target } = await projectTarget(input.projectId)
      return { mods: await preinstalled.removePreinstalled(directory, input.file, target.loader) }
    },
    library,
    importAnalysis,
    reverseService,
    importAssets,
    importAssetGraphAnalysis,
    async dispose() {
      ahead?.stop()
      controllers.forEach((controller) => controller.abort())
      tools.close()
      await library.dispose()
      await importAnalysis.dispose()
      await importAssetGraphAnalysis.dispose()
      await reverseService.dispose()
      await importAssets.dispose()
      blueprints.dispose()
      await projectRunner.dispose()
      await blueprints.settled()
      await Promise.allSettled(active.values())
      await ahead?.settled()
    },
    /** For tests: the preparation done ahead of need, which is otherwise nobody's to wait for. */
    aheadSettled: () => ahead?.settled() ?? Promise.resolve(),
  }
}

async function requestModelingStepWithKey(
  input: unknown,
  context: Parameters<typeof requestModelingStep>[1],
  apiKey: string,
  baseUrl?: string,
  model?: string,
  onRepair?: () => void,
  onProgress?: (event: ModelProgressEvent) => void,
) {
  const openai = await import("@minemods/ai-service/openai")
  const debugDirectory = process.env.MINEMODS_STUDIO_DEBUG_MODEL_DIR
  return openai.createModelingRequester({
    apiKey,
    baseUrl,
    model,
    onRepair,
    onProgress,
    onRead: debugDirectory
      ? async (value) => {
          await mkdir(debugDirectory, { recursive: true })
          await writeFile(
            path.join(debugDirectory, `${context.taskId}.${randomUUID()}.read.json`),
            JSON.stringify(value, null, 2),
            { encoding: "utf8", flag: "wx" },
          )
        }
      : undefined,
    onResponse: debugDirectory
      ? async (value) => {
          await mkdir(debugDirectory, { recursive: true })
          await writeFile(
            path.join(debugDirectory, `${context.taskId}.${randomUUID()}.response.json`),
            JSON.stringify(value, null, 2).replaceAll(apiKey.trim(), "[redacted]"),
            { encoding: "utf8", flag: "wx" },
          )
        }
      : undefined,
  })(input, context)
}

export async function dispatchStudioRequest(service: Awaited<ReturnType<typeof createStudioService>>, input: unknown) {
  const request = WorkerRequestSchema.parse(input)
  switch (request.method) {
    case "getImportAssetSelection":
      return service.importAssets.selection(request.input)
    case "extractImportAssets":
      return service.importAssets.extract(request.input)
    case "getImportedAssetCatalog":
      return service.importAssets.catalog(request.input)
    case "getImportAssetGraph":
      return service.importAssets.graph(request.input)
    case "buildImportAssetGraph":
      return service.importAssets.buildGraph(request.input)
    case "prepareImportAssetGraphAnalysis":
      return service.importAssetGraphAnalysis.prepare(request.input)
    case "startImportAssetGraphAnalysis":
      return service.importAssetGraphAnalysis.start(request.input)
    case "getImportAssetGraphAnalysis":
      return service.importAssetGraphAnalysis.get(request.input)
    case "submitImportAssetGraphAnalysis":
      return service.importAssetGraphAnalysis.submit(request.input)
    case "cancelImportAssetGraphAnalysis":
      return service.importAssetGraphAnalysis.cancel(request.input)
    case "readImportedAssetFile":
      return service.importAssets.read(request.input)
    case "saveImportedAssetFile":
      return service.importAssets.save(request.input)
    case "previewImportedAsset":
      return service.importAssets.preview(request.input)
    case "previewImportedEntity":
      return service.importAssets.previewEntity(request.input)
    case "listImportedEntities":
      return service.importAssets.entities(request.input)
    case "readImportedGameIcon":
      return service.importAssets.gameIcon(request.input)
    case "exportImportedAssetsTo":
      await service.importAssetGraphAnalysis.validateForExport({ id: request.input.id })
      return service.importAssets.export(request.input)
    case "prepareReverseProject":
      return service.reverseService.prepare(request.input)
    case "getReverseState":
      return service.reverseService.state(request.input.id)
    case "listReverseFiles":
      return service.reverseService.files(request.input)
    case "readReverseFile":
      return service.reverseService.read(request.input)
    case "editReverseFiles":
      return service.reverseService.edit(request.input)
    case "startReverseAnalysis":
      return service.reverseService.startModel(request.input)
    case "applyReversePlan":
      return service.reverseService.apply(request.input.id, request.input.runId)
    case "cancelReverseOperation":
      return service.reverseService.cancel(request.input.id, request.input.operationId)
    case "buildReverseModule":
    case "buildReverseModuleWithDependencies":
      return service.reverseService.build(request.input)
    case "exportReverseProjectTo":
      return service.reverseService.export(request.input)
    case "startImportAnalysis":
      return service.importAnalysis.start(request.input)
    case "listImportAnalysisRuns":
      return service.importAnalysis.list(request.input.id)
    case "getImportAnalysisRun":
      return service.importAnalysis.get(request.input.id, request.input.runId)
    case "cancelImportAnalysis":
      return service.importAnalysis.cancel(request.input.id, request.input.runId)
    case "applyImportedPlan":
      return service.importAnalysis.apply(request.input.id, request.input.runId)
    case "exportModifiedImportTo":
      return service.importAnalysis.export(request.input)
    case "listEnvironmentStorage":
      return service.library.listEnvironmentStorage()
    case "prepareEnvironment":
      return service.library.prepareEnvironment(request.input)
    case "removeEnvironment":
      return service.library.removeEnvironment(request.input)
    case "cleanUnusedEnvironment":
      return service.library.cleanUnusedEnvironment()
    case "listTools":
      return service.listTools()
    case "approveTool":
      return service.approveTool(request.input)
    case "setToolEnabled":
      return service.setToolEnabled(request.input)
    case "installProgram":
      return service.installProgram(request.input)
    case "useOwnProgram":
      return service.useOwnProgram(request.input)
    case "toolSecretsChanged":
      return service.toolSecretsChanged()
    case "changeSoundMoment": return service.changeSoundMoment(request.input)
    case "saveSoundSettings": return service.saveSoundSettings(request.input)
    case "vanillaAudio": return service.vanillaAudio(request.input)
    case "renameAsset": return service.renameAsset(request.input)
    case "duplicateAsset": return service.duplicateAsset(request.input)
    case "deleteAsset": return service.deleteAsset(request.input)
    case "restoreDeleted": return service.restoreDeleted(request.input)
    case "listAudioInbox": return service.listAudioInbox(request.input)
    case "extractAbility": return service.extractAbility(request.input)
    case "projectImportSources": return service.projectImportSources(request.input)
    case "projectImportSourceAt": return service.projectImportSourceAt(request.input)
    case "previewProjectImport": return service.previewProjectImport(request.input)
    case "applyProjectImport": return service.applyProjectImport(request.input)
    case "undoProjectImport": return service.undoProjectImport(request.input)
    case "listDuplicateAssets": return service.listDuplicateAssets(request.input)
    case "mergeDuplicateAssets": return service.mergeDuplicateAssets(request.input)
    case "undoAssetMerge": return service.undoAssetMerge(request.input)
    case "importAudioInbox": return service.importAudioInbox(request.input)
    case "uploadAudio": return service.uploadAudio(request.input)
    case "removeAudio": return service.removeAudio(request.input)
    case "readMusicPart": return service.readMusicPart(request.input)
    case "importSound":
      return service.importSound(request.input)
    case "startImportSource":
      return service.library.startImportSource(request.input.filename)
    case "getLibraryTask":
      return service.library.getLibraryTask(request.input.id)
    case "listLibraryTasks":
      return service.library.listLibraryTasks()
    case "cancelLibraryTask":
      return service.library.cancelLibraryTask(request.input.id)
    case "listImportedProjects":
      return service.library.listImportedProjects()
    case "listImportedProjectIssues":
      return service.library.listImportedProjectIssues()
    case "getImportedProject":
      return service.library.getImportedProject(request.input.id)
    case "deleteImportedProject":
      return service.library.deleteImportedProject(request.input.id)
    case "clearImportedCache":
      return service.library.clearImportedCache(request.input.id)
    case "exportImportedReportTo":
      return service.library.exportImportedReportTo(request.input.id, request.input.destination)
    case "openProjectDirectory":
      return service.openProjectDirectory(request.input.directory)
    case "startProjectRun":
      return service.startProjectRun(request.input)
    case "listProjectRuns":
      return service.listProjectRuns(request.input)
    case "getProjectRun":
      return service.getProjectRun(request.input)
    case "cancelProjectRun":
      return service.cancelProjectRun(request.input)
    case "draftBlueprint":
      return service.draftBlueprint(request.input)
    case "getBlueprint":
      return service.getBlueprint(request.input)
    case "expandIdeas":
      return service.expandIdeas(request.input)
    case "getIdeas":
      return service.getIdeas(request.input)
    case "chooseIdeas":
      return service.chooseIdeas(request.input)
    case "discardIdeas":
      return service.discardIdeas(request.input)
    case "getActivity":
      return service.getActivity(request.input)
    case "saveBlueprint":
      return service.saveBlueprint(request.input)
    case "confirmBlueprint":
      return service.confirmBlueprint(request.input)
    case "discardBlueprint":
      return service.discardBlueprint(request.input)
    case "startBlueprintProduction":
      return service.startBlueprintProduction(request.input)
    case "stopBlueprintProduction":
      return service.stopBlueprintProduction(request.input)
    case "turnOffReview":
      return service.turnOffReview()
    case "getProjectPlay":
      return service.getProjectPlay(request.input)
    case "getProjectOverview":
      return service.getProjectOverview(request.input)
    case "reviewAsset":
      return service.reviewAsset(request.input)
    case "clearAssetReview":
      return service.clearAssetReview(request.input)
    case "redoAsset":
      return service.redoAsset(request.input)
    case "getAssetUsage":
      return service.getAssetUsage(request.input)
    case "getMaking":
      return service.getMaking(request.input)
    case "getMakingTrace":
      return service.getMakingTrace(request.input)
    case "getMakingStep":
      return service.getMakingStep(request.input)
    case "getMakingHistory":
      return service.getMakingHistory(request.input)
    case "restoreVersion":
      return { ...(await service.makingHistory.restore(request.input)), view: await service.openProject(request.input.projectId) }
    case "addMakingNote":
      return service.addMakingNote(request.input)
    case "changeMakingNote":
      return service.changeMakingNote(request.input)
    case "earnAdvancements":
      return service.earnAdvancements(request.input)
    case "sendMakingNotes":
      return service.sendMakingNotes(request.input)
    case "lookBeside":
      return service.lookBeside(request.input)
    case "getGameplay":
      return service.getGameplay(request.input)
    case "saveSheet":
      return service.saveSheet(request.input)
    case "getReferences":
      return service.getReferences(request.input)
    case "addReference":
      return service.addReference(request.input)
    case "removeReference":
      return service.removeReference(request.input)
    case "addThreeView":
      return service.addThreeView(request.input)
    case "drawThreeView":
      return service.drawThreeView(request.input)
    case "getThreeViewPrompt":
      return service.getThreeViewPrompt(request.input)
    case "finishThreeView":
      return service.finishThreeView(request.input)
    case "threeViewDrawing":
      return service.threeViewDrawing()
    case "threeViewByWords":
      return service.threeViewByWords(request.input)
    case "chooseThreeViewByWords":
      return service.chooseThreeViewByWords(request.input)
    case "transcribeAudio":
      return service.transcribeAudio(request.input)
    case "listProjects":
      return service.listProjects()
    case "environment":
      return service.environment()
    case "registerLocation":
      return service.registerLocation(request.input.token, request.input.directory)
    case "getSettings":
      return service.getSettings()
    case "loadBlockbench":
      return service.loadBlockbench(request.input)
    case "saveBlockbench":
      return service.saveBlockbench(request.input)
    case "saveSettings":
      return service.saveSettings(request.input)
    case "saveProjectsDirectory":
      return service.saveProjectsDirectory(request.input)
    case "addEntity":
      return service.addEntity(request.input)
    case "selectEntity":
      return service.selectEntity(request.input)
    case "getCreatureLook":
      return service.getCreatureLook(request.input)
    case "getEntityPreview":
      return service.getEntityPreview(request.input)
    case "saveContent":
      return service.saveContent(request.input)
    case "saveByHand":
      return service.saveByHand(request.input)
    case "saveConception":
      return service.saveConception(request.input)
    case "saveRelease":
      return service.saveRelease(request.input)
    case "renameProject":
      return service.renameProject(request.input)
    case "saveModInfo":
      return service.saveModInfo(request.input)
    case "setEnglishName":
      return service.setEnglishName(request.input)
    case "deleteProject":
      return service.deleteProject(request.input)
    case "analyzeConception":
      return service.analyzeConception(request.input)
    case "importConception":
      return service.importConception(request.input)
    case "saveEntry":
      return service.saveEntry(request.input)
    case "reviewEntry":
      return service.reviewEntry(request.input)
    case "getModelProgress":
      return service.getModelProgress(request.input)
    case "exportProjectTo":
      return service.exportProjectTo(request.input.projectId, request.input.destination)
    case "inspectArchive":
      return service.inspectArchive(request.input.token, request.input.filename)
    case "importProject":
      return service.importProject(request.input)
    case "createProject":
      return service.createProject(request.input)
    case "openProject":
      return service.openProject(request.input)
    case "saveEntity":
      return service.saveEntity(request.input)
    case "useExample":
      return service.useExample(request.input)
    case "saveModel":
      return service.saveModel(request.input)
    case "generateModel":
      return service.generateModel(request.input)
    case "getJob":
      return service.getJob(request.input)
    case "getLatestBuild":
      return service.getLatestBuild(request.input)
    case "getBuildPanel":
      return service.getBuildPanel(request.input)
    case "cancelJob":
      return service.cancelJob(request.input)
    case "buildProject":
      return service.buildProject(request.input)
    case "startPlaytest":
      return service.startPlaytest(request.input)
    case "getScene":
      return service.getScene(request.input)
    case "getReceipt":
      return service.getReceipt(request.input)
    case "fixFindings":
      return service.fixFindings(request.input)
    case "agreeSceneEula":
      return service.agreeSceneEula()
    case "startSceneCheck":
      return service.startSceneCheck(request.input)
    case "startScenePlay":
      return service.startScenePlay(request.input)
    case "exportSourceTo":
      return service.exportSourceTo(request.input.projectId, request.input.destination)
    case "listBuildJars":
      return service.listBuildJars(request.input.projectId)
    case "revealRecordedJar":
      return service.revealRecordedJar(request.input.projectId, request.input.jobId)
    case "jarHandoff":
      return service.jarHandoff(request.input.projectId, request.input.jobId, request.input.reveal)
    case "exportJarTo":
      return service.exportJarTo(request.input.projectId, request.input.jobId, request.input.destination)
    case "getModGuide":
      return service.getModGuide(request.input)
    case "exportBlockbenchTo":
      return service.exportBlockbenchTo(request.input.projectId, request.input.assetId, request.input.destination)
    case "getTargets":
      return service.getTargets()
    case "detectJava":
      return service.detectJava(request.input)
    case "chooseJava":
      return service.chooseJava(request.input)
    case "planJavaInstall":
      return service.planJavaInstall(request.input)
    case "registerJavaDirectory":
      return service.registerJavaDirectory(request.input)
    case "installJava":
      return service.installJava(request.input)
    case "listPreinstalledMods":
      return service.listPreinstalledMods(request.input)
    case "searchMods":
      return service.searchMods(request.input)
    case "addModrinthMod":
      return service.addModrinthMod(request.input)
    case "registerModFiles":
      return service.registerModFiles(request.input)
    case "addModFiles":
      return service.addModFiles(request.input)
    case "removePreinstalledMod":
      return service.removePreinstalledMod(request.input)
    case "chooseJavaDirectory":
    case "chooseModFiles":
    case "exportBlockbench":
    case "exportSource":
    case "revealBuildJar":
    case "exportJar":
    case "chooseProjectLocation":
    case "chooseExistingProject":
    case "chooseImport":
    case "chooseReverseDependencies":
    case "exportReverseProject":
    case "chooseImportSource":
    case "chooseProjectImportFolder":
    case "exportImportedReport":
    case "exportModifiedImport":
    case "exportProject":
    case "getBlockbenchRuntime":
      throw new StudioError("请使用应用的原生导出对话框。")
  }
}

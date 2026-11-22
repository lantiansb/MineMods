import { activityText, planCounts, savedLabel } from "../project-status"
import { z } from "zod"
import { openProject, RevisionConflictError, saveProject } from "@minemods/mod-core/project"
import { BlueprintDraftSchema, BlueprintPlanSchema, confirmBlueprint, replaceBlueprint, validateBlueprint, type Blueprint, type BlueprintDraft, type BlueprintPlan } from "@minemods/mod-core/blueprint"
import { settleTiers } from "@minemods/mod-core/creature-tier"
import { blueprintPlanJsonSchema, blueprintPlannerInstructions, constraintVerdictsJsonSchema, ideaInstructions, ideaProposalJsonSchema, paperPlayInstructions, paperPlayJsonSchema } from "@minemods/mod-core/blueprint-planner"
import { PLAY_REFUSALS, PaperPlaySchema, paperPlayInput, planThings, playability, playRefusal, projectPlay, type PaperPlay } from "@minemods/mod-core/playable"
import { changeSentences, CONSTRAINT_EXTRACT_INSTRUCTIONS, constraintCheckInstructions, ConstraintQuotesSchema, ConstraintVerdictsSchema, constraintCheckInput, INDEPENDENCE_REFUSALS, LOCK_REFUSALS, lockedConstraints, lockRefusalDetail, PLAN_CHECK_WORDS, quoted, type ConstraintCheck, type PlanChecker } from "@minemods/mod-core/blueprint-constraints"
import { STALE_EDIT } from "@minemods/mod-core/stale-edit"
import { askedWords, bareIdeas, changeIdeas, heldWords, chooseIdeas, covers, IdeaProposalSchema, planStored, proposeIdeas, readIdeas, requireOnly, shownIdeas, type IdeaChoice, type Ideas } from "@minemods/mod-core/blueprint-ideas"
import { clearRefusal, noteRefusal, readRefusal, refusalView, type PlanRefusal } from "@minemods/mod-core/blueprint-refusal"
import { noteActivity, noteMakings, pulseActivity, readActivity, taskItem, type ActivityInput } from "@minemods/mod-core/activity"
import { readPicture } from "@minemods/mod-core/making"
import { forPerson, toolActivity } from "./activity-tools"
import { BLUEPRINT_ATTEMPTS, blockingAssets, isRedoRun, nextProductionBatch, redoneBefore, productionState, readProduction, redoBatch, writeProduction } from "@minemods/mod-core/blueprint-production"
import { clearReview, readRedoRequests, readReviews, recordReview, requestRedo } from "@minemods/mod-core/reviews"
import { assetUsage, buildProjectOverview } from "@minemods/mod-core/asset-overview"
import { buildHistory } from "@minemods/mod-core/build-record"
import { readVerification } from "@minemods/mod-core/verification"
import { ModelingError } from "@minemods/studio-ai/policy"
import { requestAuthoring } from "./authoring-ai"
import { handIn, reviewContext, type createProjectRunner } from "./project-runner"
import { restoredAssets } from "./making-history"
import { BLUEPRINT_WAIT_LIMITS, ExternalAwaitBlueprintDecisionInputSchema, ExternalBlueprintInputSchema, ExternalProposeBlueprintInputSchema, ExternalProposeIdeasInputSchema, type ExternalBridgeRequest } from "../external"
import { changeMaking, edit, isLooked, listMakings, readMaking, sheetOnly, shownMaking, type MakingRecord, type PartSheet } from "@minemods/mod-core/making"
import { blueprintSource, blueprintSourceKey } from "@minemods/mod-core/task-source"
import { existingRefusal, existingThings } from "@minemods/mod-core/blueprint-existing"
import { legacyThings } from "@minemods/mod-core/legacy-content"
import { claimedIdle, PARALLEL_WORDS, parallelPlan } from "@minemods/mod-core/workspace-runs"
import { buildAndCheckStep } from "./mcp-handoff"
import type { Activity, AssetUsage, Making, ProjectOverview } from "../api"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import { clearModelAnnotation, storeModelAnnotation, validateModelAnnotation } from "./model-annotation"

/** Carries a message written for the person; shown as it is. */
export class BlueprintError extends Error {}

const BUSY = "正在制作内容，请等这一批做完或者先停止，再修改蓝图。"
const MOVED = "别处刚改过这个模组，已为你刷新。请再试一次。"
const GONE = "这样东西还没有做出来，或者已经被删掉了。"
const CHANGED = (title: string) => `「${title}」刚刚又变了，你看到的已经不是最新的一版。已为你刷新，请再看一眼。`
const BEING_MADE = "这样东西正在做，等这一次做完再改部件说明。"
const NO_SHEET_YET = "这样东西还没有开始做，还没有部件说明可以改。"
const NOT_LOOKED = "这一类内容不是看着图做的，没有部件说明。"
export const NO_PLANNER = "还没有连接 AI。请先在设置里填好 AI 连接，再生成蓝图。"
const LIST_MOVED = "用户刚刚改了他的要求，你交的蓝图还没有照新的要求核对，所以没有保存。请重新读一遍 get_blueprint，照现在的要求再交一次。"
const CHOOSING = "你还在选想法。等你在 MineMods Studio 里选完、点了「就按这个做」，才能出蓝图。"
const NO_CHECK = "用户提过要求，提交蓝图时要带上 constraint_check：请一个只看得到这些要求和蓝图条目的评审逐条核对，把它的结论交上来。"
// 「审查」 off: nobody else will read the plan, so the refusal asks for the maker's own comparison and says what to write in `independent`.
const NO_CHECK_SELF = "用户提过要求，提交蓝图时要带上 constraint_check：「审查」是关着的，没有别的评审，由你自己只对着这些要求和蓝图条目逐条核对，把结论交上来，independent 填 false。"
/** What `await_blueprint_decision` tells the AI, in its four situations. The page's own sentences about this wait live with the page (`afterConfirmWords`). */
export const DECISION_WORDS = {
  waiting: "用户还没有决定。再调用一次 await_blueprint_decision 接着等（revision 照填你交的那一版）；用户确认以后它会马上返回 confirmed。",
  gave_up: "已经等了很久，用户还没有在 Studio 里确认，可能离开了屏幕。不要再调用 await_blueprint_decision。用日常的话告诉他：蓝图在 Studio 里等他确认，确认以后回到这个窗口说一声「开始做」，你再开始。然后结束这一轮。",
  confirmed: "用户在 Studio 里确认了蓝图。现在就调用 next_batch 开始，一批一批做到全部完成；不用再请用户回来说开始，也不用再问他。",
  confirmed_edited: "用户在 Studio 里改过蓝图以后确认了，edited_entries 是他动过的条目。确认的是他手里这一版：现在就调用 next_batch 开始（它按存着的这一版给任务），一批一批做到全部完成；不用再请用户回来说开始。",
  changed: "用户动了蓝图或者它要守的要求，还没有确认：edited_entries 是他改过的条目，requirements_changed 是他对要求做的改动。先用 get_blueprint 读最新的：他改的条目（by 是 you 的）原样保留；要求改了的话，已有的核对结论作废了，照现在的要求重新核对，再用 propose_blueprint 提交。他的改动不需要你动什么的话，就再调用 await_blueprint_decision（revision 填这里的 revision）接着等他确认。",
  discarded: "用户把这份蓝图丢掉了，想重新来。不要再提交原来的蓝图；问问他想怎么重新说，或者等他再说一句。",
} as const

// How many events one read returns at most, and how many of them come with their small picture.
const ACTIVITY_PAGE = 400
const ACTIVITY_PICTURES = 24

// The rules a plan can break are worded for the person in mod-core; malformed input keeps its own error.
const ruled = <T>(make: () => T) =>
  Promise.resolve()
    .then(make)
    .catch((error: unknown) => {
      throw error instanceof Error && !(error instanceof z.ZodError) ? new BlueprintError(error.message) : error
    })

// Someone else saved the project between reading it and writing it. The screen reads it again by itself.
/** What `next_batch` says when it starts nothing. */
export const NOTHING_LEFT = {
  made: "没有可以开始的内容了：每一样都做好保存了。接下来：",
  stuck: "没有可以开始的内容了：都已保存，或者剩下的失败了、被卡住了。用 get_blueprint 查看每一项的状态。",
  // "Saved" is not "passed": versions kept without a pass are the user's to judge, and production.done leaves them out. Said so the AI does not report them to the user as finished.
  held: (count: number) => `另外有 ${count} 样是留了一版但没通过审查的（production.done 不算它们）：它们等用户看了再决定，不要对用户说它们已经做好了。`,
} as const

/**
 * What an outside AI is told about entries that failed on every try (`get_blueprint`, and `next_batch` when it starts nothing): `next_batch` hands one out again
 * only after the person asks for it in Studio (「再试一次」); an AI that has seen to why it failed can make it itself with `plan_run`, naming the entry, so the
 * thing it makes is that entry's and not a second thing beside a failed one (2026-11-16, 蚩尤).
 */
export const FAILED_ENTRY_WORDS = (failed: readonly { key: string; title: string }[]) =>
  `${failed.map((entry) => `「${entry.title}」（key ${entry.key}）`).join("")}试过 ${BLUEPRINT_ATTEMPTS} 次都没有做成，next_batch 不会自己再交出它们。两种办法：用户在 Studio 里对它点「再试一次」，之后 next_batch 会把它再交给你；或者没做成的原因已经排除了（比如是 Studio 这边的检查出了问题），你自己用 plan_run 重做：那个任务加 entry 写条目的 key，module 和条目的种类一样，source 写 "blueprint:条目 key"，target_id 写 null。这样做出来的就算这个条目的，总览里它变成做好了，被它卡住的条目 next_batch 会接着做；不写 entry 的话会另多出一样不属于任何条目的东西，条目还是没做成。`

/**
 * `next_batch` while a batch is in hand and a redo of what it stands on is already running beside it: where the redo is, and that the task that waits for it
 * does not have to be given up. The task is not handed in before the redo is; everything else in the batch goes on.
 */
export const REDO_LIVE_WORDS = (redo: { id: string; tasks: readonly { title: string; state: string }[] }, waiting: readonly { title: string }[]) =>
  `${waiting.map((task) => `「${task.title}」`).join("")}在等${redo.tasks.filter((task) => ["queued", "running", "validating", "saving"].includes(task.state)).map((task) => `「${task.title}」`).join("")}重做好，重做已经单独开成运行 ${redo.id}，不用把它们记为失败（不要 fail_task）：在那个运行里 claim_task、重做、commit_task；提交了以后回到原来的任务接着做，再提交。这一批还没有结束，现在不能领下一批。`

/** What `next_batch` adds when it hands out a redo beside a batch in hand: the tasks of that batch wait for it, and are neither given up nor handed in meanwhile. */
export const REDO_BESIDE_WORDS = (waiting: readonly { title: string }[]) =>
  `这一批的重做是上一批里${waiting.map((task) => `「${task.title}」`).join("")}在等的：它们要用的东西正在被重做，所以不用把它们记为失败（不要 fail_task），其余任务照常做。重做的提交了以后回到它们接着做、再提交；在那之前提交它们会被拒绝。`

const moved = (error: unknown): never => {
  throw error instanceof RevisionConflictError ? new BlueprintError(MOVED) : error
}

export function createBlueprintService(options: {
  directoryFor: (projectId: string) => Promise<string>
  runner: ReturnType<typeof createProjectRunner>
  /** Studio's own AI connection, or null when it is not set up or an outside AI does the work. */
  connection: () => { apiKey: string; baseUrl?: string; planner?: string; /** Milliseconds between tries of a request; left out: `AUTHORING_RETRY.wait`. Tests shorten it. */ retryWait?: readonly number[] } | null
  /** Told about every batch Studio starts for itself, so the rest of the app knows work is going on. */
  onRun: (runId: string, projectId: string) => void
}) {
  // Projects Studio is working through right now. Only this is in memory: after a restart the plan's
  // asset links and the run records say what is left, and starting again carries on from there.
  const producing = new Map<string, { stop: boolean; runId: string; done: Promise<void> }>()
  // Runs started to remake single things the person was not happy with. They are not part of working through the plan.
  const redos = new Set<string>()
  /** Who reads a plan against the requirements and plays it on paper for an outside AI, as 「审查」 is switched right now: a reader that took no part, or, off, the maker itself. */
  const checker = (): PlanChecker => (options.runner.reviewOn() ? "independent" : "self")
  const redoing = (runs: { id: string; state: string }[]) => runs.some((run) => redos.has(run.id) && ["planning", "running"].includes(run.state))

  async function facts(projectId: string) {
    const directory = await options.directoryFor(z.uuid().parse(projectId))
    const project = await openProject(directory)
    const runs = await options.runner.list(projectId)
    const record = await readProduction(directory)
    return {
      directory,
      project,
      runs,
      record,
      reviews: await readReviews(directory),
      requests: await readRedoRequests(directory),
      busy:
        producing.has(projectId) ||
        (project.blueprint?.state === "confirmed" &&
          productionState({ blueprint: project.blueprint, assets: project.workspace.assets, runs, record }).live),
    }
  }

  /** The entries that failed on every try and that nobody has asked to have tried again: what `FAILED_ENTRY_WORDS` is about. */
  function failedForGood(current: Awaited<ReturnType<typeof facts>>, view: { items: readonly { key: string | null; title: string; status: string }[] }) {
    const blueprint = current.project.blueprint
    if (blueprint?.state !== "confirmed") return []
    const failed = new Set(productionState({ blueprint, assets: current.project.workspace.assets, runs: current.runs, record: current.record }).failed.map((value) => value.key))
    return view.items.flatMap((item) => (item.key !== null && failed.has(item.key) && item.status === "failed" ? [{ key: item.key, title: item.title }] : []))
  }

  /**
   * One thing sent back with words, recorded so it is never lost; refuses in plain words what cannot be
   * redone. `only` is what `redoBatch` is kept to for it.
   */
  async function sentBack(input: { projectId: string; itemId: string; feedback: string; annotation?: ModelAnnotationInput }) {
    const feedback = z.string().trim().max(500).parse(input.feedback)
    const current = await facts(input.projectId)
    const view = await overview(input)
    // Round 10 (J1): the thing is named by its overview id (its plan key when it has one) or by the id of the asset made for it. Either is the same thing; a caller that held the asset id was told it did not exist.
    const item = view.items.find((value) => value.id === input.itemId) ?? view.items.find((value) => value.asset_id === input.itemId)
    const asset = current.project.workspace.assets.find((value) => value.id === item?.asset_id)
    if (!item) throw new BlueprintError(GONE)
    if (item.status === "making") throw new BlueprintError(`「${item.title}」正在做，等这一次做完再说。`)
    if (!asset && item.facts.saved) throw new BlueprintError(`「${item.title}」是你自己做的内容，AI 没法替你重做。可以打开它直接改。`)
    // Made by hand and not whole yet (a creature with no model): nothing was made before that could be made again, and it is in no plan to be tried again.
    if (!asset && item.key === null) throw new BlueprintError(`「${item.title}」是你自己做的，还缺东西（${item.reason ?? "还没做完"}），「重做」帮不上。想让 AI 补上，就告诉它要把「${item.title}」做完，它会在蓝图里写明改的就是这一个；也可以打开它自己做。`)
    if (!asset && !["failed", "redo"].includes(item.status))
      throw new BlueprintError(
        item.status === "blocked" ? `「${item.title}」${item.reason}先把那一样做出来。` : `「${item.title}」还没有做出来，没法重做。等它做好再说。`,
      )
    const annotation = input.annotation ? validateModelAnnotation(input.annotation, current.project, asset?.id ?? "") : undefined
    if (annotation && asset?.module !== "model") throw new BlueprintError("图上修改只能用于当前已保存的模型。")
    if (annotation && asset) await storeModelAnnotation(current.directory, annotation, asset.revision)
    if (!annotation && asset?.module === "model") await clearModelAnnotation(current.directory, asset.id)
    // Recorded again even when it was already waiting: asking again is what gives a failed redo another try.
    if (asset) await recordReview(current.directory, { asset_id: asset.id, revision: asset.revision, verdict: "rejected", note: feedback })
    if (!asset) await requestRedo(current.directory, { key: item.key!, feedback })
    return { item, remade: Boolean(asset), only: [item.id, ...(asset ? [asset.id] : [])] }
  }

  /** Starts on what was sent back, as one batch. An outside AI does the work, or Studio is in the middle of a batch: the requests wait their turn. */
  async function redone(projectId: string, only: string[]) {
    if (!options.connection() || producing.has(projectId) || (await overview({ projectId })).production.running) return
    const next = await facts(projectId)
    const batch = redoBatch({ blueprint: next.project.blueprint, assets: next.project.workspace.assets, reviews: next.reviews, requests: next.requests, runs: next.runs, only })
    if (!batch) return
    const started = await options.runner.startPlanned({ projectId, expectedRevision: next.project.revision, prompt: batch.prompt, plan: batch.plan }, false).catch(moved)
    redos.add(started.run.id)
    options.onRun(started.run.id, projectId)
    void options.runner.wait(started.run.id).finally(() => redos.delete(started.run.id))
  }

  let playCache: { id: string; revision: number; studio: boolean; value: ReturnType<typeof projectPlay> } | undefined
  function playFor(project: Awaited<ReturnType<typeof openProject>>, studio = false) {
    if (playCache?.id !== project.id || playCache.revision !== project.revision || playCache.studio !== studio)
      playCache = { id: project.id, revision: project.revision, studio, value: projectPlay(project, studio) }
    return structuredClone(playCache.value)
  }
  let progressCache: { key: string; view: ReturnType<typeof buildProjectOverview> } | undefined
  async function overview(input: { projectId: string; progressOnly?: boolean }): Promise<ProjectOverview> {
    const current = await facts(input.projectId)
    const { build, failure } = await buildHistory(current.directory)
    const sidecars = {
      runs: current.runs,
      build,
      // A record that cannot be read proves nothing, which is the same as having none.
      verification: build ? await readVerification(current.directory, build.id).catch(() => null) : null,
      reviews: current.reviews,
      requests: current.requests,
      restored: await restoredAssets(current.directory, current.project.workspace.assets),
      production: current.record,
      producing: producing.has(input.projectId) || redoing(current.runs),
      // Where a plan an AI handed in was refused, so the page can say so at the plan and not only in 动态.
      refusal: refusalView(await readRefusal(current.directory).catch(() => null), await readIdeas(current.directory).catch(() => null)),
    }
    // Reviews, jobs, interrupted runs and the production log can change without saving the manifest.
    const key = JSON.stringify([current.directory, current.project.id, current.project.revision, sidecars])
    if (progressCache?.key !== key) progressCache = { key, view: buildProjectOverview({ project: current.project, ...sidecars }) }
    const view = structuredClone(progressCache.view)
    // What the acceptance standard was told when an AI handed each saved version in, so the card can run the same
    // review. Nothing for a version a person made or has changed by hand since: that one is never judged.
    const judged = (assetId: string | null) => {
      const made = handIn(current.project.workspace.assets.find((value) => value.id === assetId), current.runs)
      return made ? { judged: reviewContext(made.run, made.task, current.project.blueprint) } : {}
    }
    // 「能不能玩」: the playable standard on the plan, and on what is really made as soon as it is.
    // 「审查」: whether the switch is on, and, for an outside AI's finished versions that wait for a reviewer, what the person is told about it (see `ReviewWait`).
    const wait = await options.runner.reviewWait(current.directory).catch(() => null)
    const waitView = decisionView(input.projectId)
    // Whether a reviewing window is there at all, for the page to tell the switch being on from a reviewer being connected.
    const reviewWindow = wait?.reviewer ?? options.runner.reviewerPresence(current.directory)
    return { ...view, build_failure: failure, items: view.items.map((item) => {
      const context = judged(item.asset_id)
      return { ...item, ...context, status_label: savedLabel(item, !!context.judged) ?? item.status_label }
    }), ...(input.progressOnly ? {} : { playable: playFor(current.project) }), review_on: options.runner.reviewOn(), ...(wait ? { review_wait: wait } : {}), ...(reviewWindow ? { review_window: reviewWindow } : {}), ...(waitView ? { blueprint_wait: waitView } : {}) }
  }

  // ---- 等蓝图的决定 (broad19) ----
  // Per project: the AI that waits for the person's decision on the blueprint in `await_blueprint_decision`. Only in memory: a wait does not outlive Studio (the AI's call
  // fails with it), and the page falls back to telling the person to go back to the AI.
  const deciding = new Map<
    string,
    {
      /** Calls being held right now. */
      pending: number
      /** When the last call ended, and what it answered: only "waiting" counts as an AI still there. */
      ended: { at: number; answer: "waiting" | "decided" | "gave_up" } | null
      /** The plan as the series began, to say what the person changed. Dropped once a decision (or the end of the patience) was answered. */
      baseline: { blueprint: Blueprint; at: number } | null
      /** When the AI was told the person confirmed, and which revision. */
      told: { at: number; revision: number } | null
    }
  >()
  /** What the page may say about the AI's side of the wait; null when no wait call has been seen. */
  function decisionView(projectId: string): { ai: "waiting" | "told" | "none" } | null {
    const entry = deciding.get(projectId)
    if (!entry) return null
    const now = Date.now()
    if (entry.pending > 0 || (entry.ended?.answer === "waiting" && now - entry.ended.at < BLUEPRINT_WAIT_LIMITS.gap * 1000)) return { ai: "waiting" }
    if (entry.told && now - entry.told.at < BLUEPRINT_WAIT_LIMITS.told * 1000) return { ai: "told" }
    return { ai: "none" }
  }
  /** How long a confirmed plan may wait for its production record before the AI is told (see `awaitDecision`). */
  const SETTLE_MS = 3000
  /** The plan without its state: the person confirming must not read as the person editing. */
  const standing = (blueprint: Blueprint) => JSON.stringify({ ...blueprint, state: "draft" })
  /** Titles of the entries that differ between two plans (added, removed or edited), for the AI to read what the person touched. */
  const touched = (before: Blueprint, now: Blueprint) => {
    const titles = new Set<string>()
    for (const entry of now.entries) {
      const was = before.entries.find((value) => value.key === entry.key)
      if (!was || JSON.stringify(was) !== JSON.stringify(entry)) titles.add(entry.title)
    }
    for (const entry of before.entries) if (!now.entries.some((value) => value.key === entry.key)) titles.add(entry.title)
    return [...titles]
  }
  /**
   * `await_blueprint_decision`: for an outside AI that is still in its turn after proposing a blueprint. Returns at once when the person has decided
   * (confirmed; changed the plan or what it must keep; threw it away), otherwise after the long-poll window, so the AI asks again.
   */
  async function awaitDecision(input: unknown) {
    const parsed = ExternalAwaitBlueprintDecisionInputSchema.parse(input)
    const directory = await options.directoryFor(parsed.projectId)
    const entry = deciding.get(parsed.projectId) ?? { pending: 0, ended: null, baseline: null, told: null }
    deciding.set(parsed.projectId, entry)
    const started = Date.now()
    const first = await openProject(directory)
    if (!first.blueprint && parsed.revision === undefined) throw new BlueprintError("这个工程还没有蓝图。先用 propose_blueprint 交一份，再等用户的决定。")
    // A new series: the first call, or one after the last had ended with an answer or the AI had been away. It is measured from the plan as it stands now,
    // unless the AI says which revision it proposed (then an edit made since counts).
    const away = !entry.ended || entry.ended.answer !== "waiting" || started - entry.ended.at > BLUEPRINT_WAIT_LIMITS.gap * 1000
    if (away || !entry.baseline) entry.baseline = first.blueprint ? { blueprint: first.blueprint, at: started } : null
    const series = entry.baseline
    entry.pending++
    let confirmedAt: number | undefined
    try {
      const decide = async () => {
        const project = await openProject(directory)
        const now = project.blueprint
        if (!now) return { decision: "discarded" as const }
        if (now.state === "confirmed") {
          // `confirm` saves the plan and then starts the count of tries afresh for it; handed out in between, the AI's `next_batch` could read the old count. A moment's grace,
          // and no more: a plan confirmed long ago has a count of its own that need not name this revision.
          const counted = (await readProduction(directory))?.blueprint_revision === now.revision
          confirmedAt ??= Date.now()
          if (!counted && Date.now() - confirmedAt < SETTLE_MS) return null
          return { decision: "confirmed" as const, blueprint: now }
        }
        const moved = parsed.revision !== undefined && now.revision !== parsed.revision
        if (moved || (series && standing(series.blueprint) !== standing(now))) return { decision: "changed" as const, blueprint: now }
        return null
      }
      const deadline = started + (parsed.wait_seconds ?? BLUEPRINT_WAIT_LIMITS.wait) * 1000
      let decided = await decide()
      while (!decided && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(BLUEPRINT_WAIT_LIMITS.poll, Math.max(0, deadline - Date.now()))))
        decided = await decide()
      }
      if (!decided) {
        const waited = Math.round((Date.now() - (series?.at ?? started)) / 1000)
        // The patience is spent: the wait is handed back to the person. The series ends here, so the page stops saying the AI is waiting.
        if (waited >= BLUEPRINT_WAIT_LIMITS.patience) {
          entry.ended = { at: Date.now(), answer: "gave_up" }
          entry.baseline = null
          return { waiting: true, ask_person_back: true, waited_seconds: waited, how: DECISION_WORDS.gave_up }
        }
        entry.ended = { at: Date.now(), answer: "waiting" }
        return { waiting: true, waited_seconds: waited, revision: first.blueprint?.revision ?? null, how: DECISION_WORDS.waiting }
      }
      entry.ended = { at: Date.now(), answer: "decided" }
      entry.baseline = null
      if (decided.decision === "discarded") return { waiting: false, decision: "discarded", how: DECISION_WORDS.discarded }
      if (decided.decision === "confirmed") {
        entry.told = { at: Date.now(), revision: decided.blueprint.revision }
        const edited = series ? standing(series.blueprint) !== standing(decided.blueprint) : false
        return { waiting: false, decision: "confirmed", revision: decided.blueprint.revision, ...(edited && series ? { edited_entries: touched(series.blueprint, decided.blueprint) } : {}), how: edited ? DECISION_WORDS.confirmed_edited : DECISION_WORDS.confirmed }
      }
      const record = await readIdeas(directory)
      return {
        waiting: false,
        decision: "changed",
        revision: decided.blueprint.revision,
        ...(series ? { edited_entries: touched(series.blueprint, decided.blueprint) } : {}),
        requirements_changed: changeSentences(record?.changes),
        how: DECISION_WORDS.changed,
      }
    } finally {
      entry.pending--
    }
  }

  /**
   * The making record behind an overview item: that of the task working on it right now, else that of the
   * asset saved for it, else the newest one kept for its plan entry (an entry that failed has no asset).
   */
  async function madeFor(input: { projectId: string; itemId: string }) {
    const current = await facts(input.projectId)
    const entry = current.project.blueprint?.entries.find((value) => value.key === input.itemId) ?? null
    const asset = current.project.workspace.assets.find((value) => value.id === (entry ? entry.asset_id : input.itemId)) ?? null
    const task = current.runs
      .filter((run) => ["planning", "running"].includes(run.state))
      .flatMap((run) => run.tasks)
      .find((value) => ["running", "validating", "saving"].includes(value.state) && (value.asset_id === (asset?.id ?? (entry ? undefined : input.itemId)) || (entry !== null && value.source === blueprintSource(entry.key))))
    const kept = async () => (entry ? ((await listMakings(current.directory)).filter((record) => record.entry === entry.key).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null) : null)
    const record = (task ? await readMaking(current.directory, task.asset_id) : null) ?? (asset ? await readMaking(current.directory, asset.id) : null) ?? (await kept())
    const live = Boolean(task) && record?.task_id === task?.id
    return { directory: current.directory, entry: entry?.key ?? null, asset, saved: asset?.id ?? null, record, live, idle: live && claimedIdle(task!) }
  }

  /** A record as the contract with the screen has it. One that says it is under way while no task is working on it was cut short. */
  async function shown(directory: string, itemId: string, record: MakingRecord, saved: string | null, live: boolean, idle = false): Promise<Making> {
    return { item_id: itemId, asset_id: saved, ...(await shownMaking(directory, record)), state: live || record.state === "done" ? record.state : "stopped", ...(idle ? { idle: true as const } : {}) }
  }

  /** Store a plan as a draft. Whoever wrote it, nothing is made from it until the person confirms. */
  async function store(projectId: string, draft: BlueprintDraft, revision?: number) {
    const current = await facts(projectId)
    if (current.busy) throw new BlueprintError(BUSY)
    // The person's form started from `revision`; a plan stored since (an AI's new version) must not be overwritten by what the form held.
    if (revision !== undefined && (current.project.blueprint?.revision ?? 0) !== revision) throw new BlueprintError(STALE_EDIT.says)
    const next = await ruled(() => replaceBlueprint(current.project, draft))
    return (await saveProject(current.directory, next, current.project.revision).catch(moved)).blueprint!
  }

  /** Report to the activity log. Never in the way of what it reports. */
  const say = (projectId: string, event: ActivityInput) =>
    options
      .directoryFor(projectId)
      .then((directory) => noteActivity(directory, event))
      .catch(() => undefined)
  const whole = { item: null, title: null }
  // Projects whose idea cards or plan an AI of Studio's is thinking about right now.
  const thinking = new Set<string>()
  // Every request of the planning (idea cards, the quoted requirements, the plan, its check, the paper play) is tried again when the provider
  // was busy or cut the answer short (`AUTHORING_RETRY`): before, one such moment failed the whole plan.
  const ai = (connection: NonNullable<ReturnType<typeof options.connection>>, signal: AbortSignal) => ({ apiKey: connection.apiKey, baseUrl: connection.baseUrl, model: connection.planner, signal, retry: true, retryWait: connection.retryWait })

  /** The requirement fields a plan carries, from the record that holds them. Nothing when the person required nothing. */
  const required = (record: Ideas | null, check: ConstraintCheck | null, paper: PaperPlay | null = null) => ({
    ...(record?.constraints.length ? { constraints: record.constraints, lifted: record.lifted, ...(check ? { check } : {}) } : {}),
    ...(paper ? { paper } : {}),
  })

  /**
   * A plan as an AI may write it: 「故意不做」 in the person's name is theirs alone, so one an AI wrote stands only
   * where the plan the person last saw already had it; anywhere else it is the AI's own proposal and is shown as that.
   */
  const settled = (plan: BlueprintPlan, held: Blueprint | undefined): BlueprintPlan => ({
    ...plan,
    // creature tier (10-12): the same for a creature's tier. One the person chose stays whatever the AI wrote; "you" in an AI's hand is the AI's own.
    entries: settleTiers(plan.entries, held?.entries).map((entry) =>
      entry.play
        ? {
            ...entry,
            play: {
              ...entry.play,
              declined: entry.play.declined.map((value) =>
                value.by !== "you" || held?.entries.some((before) => before.key === entry.key && before.play?.declined.some((kept) => kept.by === "you" && kept.question === value.question)) ? value : { ...value, by: "ai" as const, constraint: null },
              ),
            },
          }
        : entry,
    ),
  })
  /** Whether a plan an AI wrote leaves nothing silently unanswered under the playable standard. Null when it may be stored. */
  const playable = (record: Ideas | null, plan: BlueprintPlan) => playRefusal({ entries: plan.entries, constraints: record?.constraints, lifted: record?.lifted })

  /**
   * Whether a plan an AI wrote may be stored, as far as the person's requirements go: every requirement in
   * force answered, compared by a reader that saw nothing else, and none broken. `compare` is how that reader
   * is reached; it is asked only when there is something to compare and the plan answers every requirement.
   */
  async function locked(record: Ideas | null, plan: BlueprintPlan, compare: () => Promise<ConstraintCheck | null>) {
    const about = { constraints: record?.constraints, lifted: record?.lifted, entries: plan.entries, honours: plan.honours }
    const open = lockedConstraints(record?.constraints, record?.lifted)
    // The parts a program can settle come first, so a reader is not asked about a plan that is refused anyway.
    const early = lockRefusalDetail({ ...about, check: { verdicts: open.map((value) => ({ constraint: value.id, kept: true, entry: null, why: "-" })) } })
    if (early || !open.length) return { issue: early?.why ?? null, constraint: early?.constraint ?? null, check: null }
    const check = await compare()
    const refused = lockRefusalDetail({ ...about, check })
    return { issue: refused?.why ?? null, constraint: refused?.constraint ?? null, check }
  }

  /**
   * Remember why a plan an AI handed in was turned back, for the blueprint page to say at the plan (a refused plan is not stored, so
   * without this the reason is only in 动态). Never in the way of the refusal it reports.
   */
  const turnedBack = (directory: string, input: { by: PlanRefusal["by"]; why: string; about: PlanRefusal["about"]; constraint?: string | null; /** The words of that requirement as they stood: a refused plan may be the first thing to carry them, with no list stored yet. */ words?: string | null; plan: Pick<BlueprintPlan, "entries">; against?: number }) =>
    noteRefusal(directory, {
      at: new Date().toISOString(),
      by: input.by,
      why: forPerson(input.why),
      about: input.about,
      constraint: input.constraint ?? null,
      words: input.words ?? null,
      titles: input.plan.entries.map((entry) => entry.title).slice(0, 200),
      against: input.against ?? null,
    }).catch(() => undefined)

  /**
   * Ask Studio's own AI for a plan. One sentence in, a stored draft out. With `ideas` the sentence is the
   * summary the person approved and the requirements are the ones they saw beside it; without, the
   * requirements are first quoted from the sentence by a request of its own, so a planner cannot lose one.
   */
  async function draft(input: { projectId: string; request: string; ideas?: number }, signal: AbortSignal, progress: (detail: string) => void = () => undefined) {
    const connection = options.connection()
    if (!connection) throw new BlueprintError(NO_PLANNER)
    const current = await facts(input.projectId)
    if (current.busy) throw new BlueprintError(BUSY)
    const project = current.project
    const tell = (text: string) => {
      progress(text)
      void say(input.projectId, { ...whole, kind: "plan", mark: "run", step: true, text })
    }
    const quote = (repair?: string) => requestAuthoring(ConstraintQuotesSchema, { request: input.request, ...(repair ? { revision_required: repair } : {}) }, { ...ai(connection, signal), instructions: CONSTRAINT_EXTRACT_INSTRUCTIONS, standing: "none" })
    const record = await (async () => {
      if (input.ideas !== undefined) return readIdeas(current.directory)
      tell("正在从你的话里找出你明确提过的要求。")
      const keep = (quotes: string[]) => ruled(() => changeIdeas(current.directory, (before) => requireOnly(before, { request: input.request, by: "studio", quotes })))
      const first = await quote()
      // A quote that is not in the sentence is a paraphrase: asked once more to copy. What is still not the person's
      // words after that is left out, and the limiting clauses the app finds by rule are locked all the same.
      return keep(first.constraints).catch(async (error: unknown) => (error instanceof BlueprintError ? keep((await quote(error.message)).constraints.filter((text) => quoted(input.request, text))) : Promise.reject(error)))
    })()
    if (input.ideas !== undefined && (!record || record.revision !== input.ideas || record.state === "choosing" || !record.summary)) throw new BlueprintError(CHOOSING)
    const request = input.ideas === undefined ? input.request : record!.summary!
    const open = lockedConstraints(record?.constraints, record?.lifted)
    const ask = (repair?: { blueprint: unknown; issues: { code: string; message: string }[] }) =>
      requestAuthoring(
        BlueprintPlanSchema,
        {
          request,
          project: { name: project.name, description: project.description, target: project.target },
          current: project.blueprint
            ? {
                style: project.blueprint.style,
                entries: project.blueprint.entries.map((entry) => ({
                  key: entry.key,
                  kind: entry.kind,
                  title: entry.title,
                  brief: entry.brief.slice(0, 400),
                  owner: entry.owner,
                  needs: entry.needs,
                  out_of_scope: entry.out_of_scope,
                  made: entry.asset_id !== null,
                  ...(entry.play ? { play: entry.play } : {}),
                  ...(entry.tier ? { tier: entry.tier } : {}),
                  ...(entry.existing ? { existing: entry.existing } : {}),
                })),
              }
            : null,
          // Where the plan the person is looking at still leaves a thing without an answer, and where a paper play-through got stuck.
          ...(project.blueprint
            ? { play_gaps: playability(planThings(project.blueprint)).gaps.map((gap) => gap.text), ...(project.blueprint.paper?.findings.length ? { paper_findings: project.blueprint.paper.findings } : {}) }
            : {}),
          existing: existingThings(project).slice(-200),
          // Word for word, with their ids: what the plan must keep and what the person agreed to give up.
          ...(record?.constraints.length
            ? {
                constraints: open.map((value) => ({ id: value.id, text: value.text })),
                lifted: record.lifted.flatMap((entry) => record.constraints.filter((value) => value.id === entry.constraint).map((value) => ({ text: value.text, change: entry.change }))),
              }
            : {}),
          ...(repair ? { revision_required: repair } : {}),
        },
        {
          ...ai(connection, signal),
          maxOutputTokens: 32768,
          instructions: blueprintPlannerInstructions(project.target),
        },
      )
    // A fresh request that is shown the requirements and the entries, and nothing of how the plan came about.
    const compare = (plan: BlueprintPlan) => async (): Promise<ConstraintCheck> => {
      tell("正在请一个没参与规划的核对员，逐条核对蓝图有没有违反你的要求。")
      const answer = await requestAuthoring(ConstraintVerdictsSchema, constraintCheckInput({ constraints: record?.constraints, lifted: record?.lifted, entries: plan.entries, honours: plan.honours }), { ...ai(connection, signal), instructions: constraintCheckInstructions(), standing: "reviewer" })
      return { ...answer, by: "studio", independent: true, at: new Date().toISOString() }
    }
    const judged = async (plan: BlueprintPlan): Promise<{ issue: string | null; check: ConstraintCheck | null; code: "blueprint_rule" | "playable" | "constraint"; constraint: string | null }> => {
      const rule = await ruled(() => {
        replaceBlueprint(project, { request, ...plan, ...required(record, null) })
        // A thing of the same name as one already made, or described as a change to it, is not stored as a second one.
        const clash = existingRefusal(project, plan)
        if (clash) throw new BlueprintError(clash)
      }).then(
        () => null,
        (error: unknown) => (error instanceof BlueprintError ? error.message : "蓝图的格式不对。"),
      )
      if (rule) return { issue: rule, check: null, code: "blueprint_rule", constraint: null }
      // Settled by rule, so it comes before the reader: a plan with a silent gap is not worth comparing yet.
      const gaps = playable(record, plan)
      return gaps ? { issue: gaps, check: null, code: "playable", constraint: null } : { ...(await locked(record, plan, compare(plan))), code: "constraint" }
    }
    tell("正在想要做哪些东西。")
    const first = settled(await ask(), project.blueprint)
    const before = await judged(first)
    if (before.issue) tell(before.code === "constraint" ? "蓝图有一处违反了你的要求，正在请 AI 照你的要求改。" : before.code === "playable" ? "蓝图里还有东西没有交代清楚怎么玩，正在请 AI 补上。" : "蓝图里有一处对不上，正在请 AI 改正。")
    // One correction only: a planner that cannot follow the rules twice will not on a third try either.
    const plan = before.issue ? settled(await ask({ blueprint: first, issues: [{ code: before.code, message: before.issue }] }), project.blueprint) : first
    const after = before.issue ? await judged(plan) : before
    // A requirement still broken, or a thing still without an answer, is said as it is: the person decides, not a third try.
    // The page is told too, so the reason stands where the plan should be and not only in 动态.
    if (after.issue) await turnedBack(current.directory, { by: "studio", why: after.issue, about: after.code === "constraint" ? "requirement" : after.code === "playable" ? "playable" : "rule", constraint: after.constraint, words: record?.constraints.find((value) => value.id === after.constraint)?.text, plan, against: project.blueprint?.revision })
    if (after.issue && after.code !== "blueprint_rule") throw new BlueprintError(after.issue)
    if (after.issue) throw new BlueprintError(`AI 给出的蓝图有问题，改了一次还是不对：${after.issue}请把想法说得更具体一些，再试一次。`)
    // Cancelled while the AI was answering: the person no longer wants this plan stored.
    if (signal.aborted) throw new ModelingError("CANCELLED")
    // A fresh request that sees the sentence, the requirements and each thing's answers, and plays them through.
    // It helps and never stops a plan: what it finds is stored beside the plan, and a reader that cannot be reached leaves nothing.
    tell("正在请一个没参与规划的试玩员，照着蓝图在纸上从头玩一遍。")
    const paper = await requestAuthoring(PaperPlaySchema, paperPlayInput({ request, entries: plan.entries, constraints: record?.constraints, lifted: record?.lifted }), { ...ai(connection, signal), instructions: paperPlayInstructions(), standing: "reviewer" }).then(
      (answer): PaperPlay => ({ ...answer, by: "studio", independent: true, at: new Date().toISOString() }),
      () => null,
    )
    if (signal.aborted) throw new ModelingError("CANCELLED")
    progress("正在保存蓝图。")
    const stored = await store(input.projectId, { request, ...plan, ...required(record, after.check, paper) })
    // The changes the person made to their requirements were all held against this plan: nobody needs to be told of them again.
    if (record) await changeIdeas(current.directory, (latest) => planStored(latest ?? record, record))
    await clearRefusal(current.directory).catch(() => undefined)
    await say(input.projectId, { ...whole, kind: "plan", mark: "ok", end: true, text: drafted(stored) })
    return stored
  }

  /**
   * The person changed their requirements while a plan stands. The plan carries a copy of the list, so the copy follows; and the comparison
   * it was stored with was made against the old words, so it goes. With Studio's own AI a reader that took no part in the planning compares
   * the plan with the list as it now is, right away, and its answer is stored whatever it says: a break it finds is shown at the plan, not
   * hidden by dropping the answer. Without one, or when the reader cannot be reached, the plan says plainly that nobody compared it yet.
   * Nothing here confirms or changes an entry: the plan is as it was, only held to what the person now says.
   */
  async function holdPlanTo(projectId: string, directory: string, record: Ideas, before: Ideas | null) {
    const open = lockedConstraints(record.constraints, record.lifted)
    const connection = options.connection()
    const was = (await facts(projectId)).project.blueprint
    if (!was) return
    const sentence = (change: Ideas["changes"][number]) =>
      change.kind === "reword" ? `你把要求「${change.was}」改成了「${change.now}」。` : change.kind === "drop" ? `你不要这条要求了：「${change.was}」。` : change.kind === "restore" ? `你又要回这条要求：「${change.now}」。` : `你加了一条要求：「${change.now}」。`
    const fresh = record.changes.filter((change) => !before?.changes.some((value) => value.at === change.at && value.kind === change.kind && value.constraint === change.constraint))
    await Promise.all(fresh.map((change) => say(projectId, { ...whole, kind: "person", mark: "note", text: sentence(change) })))
    // A fresh request that is shown the requirements as they now are and the entries, and nothing of how the plan came about.
    const check = await (async (): Promise<ConstraintCheck | null> => {
      if (!connection || !open.length) return null
      void say(projectId, { ...whole, kind: "plan", mark: "run", step: true, text: "正在请一个没参与规划的审查员，照你改过的要求，把现在的蓝图重新审查一遍。" })
      const answer = await requestAuthoring(ConstraintVerdictsSchema, constraintCheckInput({ constraints: record.constraints, lifted: record.lifted, entries: was.entries, honours: was.honours }), { ...ai(connection, new AbortController().signal), instructions: constraintCheckInstructions(), standing: "reviewer" }).catch(() => null)
      return answer ? { ...answer, by: "studio", independent: true, at: new Date().toISOString() } : null
    })()
    const current = await facts(projectId)
    if (!current.project.blueprint) return
    const { check: _old, ...kept } = current.project.blueprint
    const next = validateBlueprint({ ...kept, constraints: record.constraints, lifted: record.lifted, ...(check ? { check } : {}) }, current.project.target)
    await saveProject(directory, { ...current.project, blueprint: next }, current.project.revision).catch(moved)
    if (!connection || !open.length) return
    const broken = check?.verdicts.find((verdict) => !verdict.kept && open.some((value) => value.id === verdict.constraint))
    await say(projectId, {
      ...whole,
      kind: "plan",
      mark: !check ? "warn" : broken ? "fail" : "ok",
      end: true,
      text: !check ? "没能请到审查员，蓝图还没有照你改过的要求重新审查。" : broken ? `照你改过的要求重新审查，蓝图有一处对不上：「${open.find((value) => value.id === broken.constraint)?.text ?? ""}」。${broken.why}` : "照你改过的要求重新审查过了，审查员没有发现违反。",
    })
  }

  /** Ask Studio's own AI for idea cards: one request, no pictures. The cards are stored for the person to choose from. */
  async function expand(input: { projectId: string; request: string }, signal: AbortSignal, progress: (detail: string) => void = () => undefined) {
    const connection = options.connection()
    if (!connection) throw new BlueprintError(NO_PLANNER)
    const current = await facts(input.projectId)
    if (current.busy) throw new BlueprintError(BUSY)
    const project = current.project
    progress("正在替你把没想到的地方想一遍。")
    await say(input.projectId, { ...whole, kind: "plan", mark: "run", step: true, text: "正在替你把没想到的地方想一遍，出几组做法给你挑。" })
    const ask = (repair?: string) =>
      requestAuthoring(
        IdeaProposalSchema,
        { request: input.request, project: { name: project.name, description: project.description, target: project.target }, existing: [...project.workspace.assets.map((asset) => ({ kind: asset.module, title: asset.title })), ...legacyThings(project).map((thing) => ({ kind: thing.kind, title: thing.title }))].slice(-200), ...(repair ? { revision_required: repair } : {}) },
        { ...ai(connection, signal), maxOutputTokens: 16000, instructions: ideaInstructions(project.target) },
      )
    const keep = (proposal: z.infer<typeof IdeaProposalSchema>) => ruled(() => changeIdeas(current.directory, (before) => proposeIdeas(before, { request: input.request, by: "studio", proposal, target: project.target })))
    // One correction, and only for what the app can tell: a "requirement" that is not a quote, a clash of ids.
    const record = await keep(await ask()).catch(async (error: unknown) => (error instanceof BlueprintError && !signal.aborted ? keep(await ask(error.message)) : Promise.reject(error)))
    await say(input.projectId, { ...whole, kind: "plan", mark: "ok", end: true, text: carded(record) })
    return record
  }

  const drafted = (blueprint: Blueprint) => {
    const { skipped, planned } = planCounts(blueprint.entries)
    const stuck = blueprint.paper?.findings.length ?? 0
    return `蓝图草稿好了：打算做 ${planned} 样${skipped ? `，做不了 ${skipped} 样` : ""}。${stuck ? `试玩员在纸上玩了一遍，有 ${stuck} 处会卡住，写在蓝图旁边。` : ""}等你确认。`
  }
  const carded = (record: Ideas) => `想法出来了：${record.groups.length} 组做法等你挑${record.constraints.length ? `，记下了你提的 ${record.constraints.length} 条要求` : ""}。`

  /** Both ways of making go through here: the same plan state, the same next batch, the same run. */
  async function startBatch(projectId: string, external: boolean) {
    const current = await facts(projectId)
    const blueprint = current.project.blueprint
    // What the person asked to have redone comes before anything new, with or without a plan.
    const redo = redoBatch({ blueprint, assets: current.project.workspace.assets, reviews: current.reviews, requests: current.requests, runs: current.runs })
    if (redo && !(blueprint?.state === "confirmed" && productionState({ blueprint, assets: current.project.workspace.assets, runs: current.runs, record: current.record }).live))
      return options.runner.startPlanned({ projectId, expectedRevision: current.project.revision, prompt: redo.prompt, plan: redo.plan }, external)
    if (!blueprint) throw new BlueprintError("这个工程还没有蓝图。")
    if (blueprint.state !== "confirmed") throw new BlueprintError("蓝图还没有确认。请先在 MineMods Studio 里查看并确认蓝图，再开始制作。")
    const input = { blueprint, assets: current.project.workspace.assets, runs: current.runs, record: current.record }
    if (productionState(input).live) {
      if (external) {
        // B18-J-03: what the batch in hand stands on and the person (or the maker, for what it made) sent back is made again now, as a run of its own beside the
        // batch: the batch cannot end without the task that stands on it, and that task may be unable to be handed in before the thing is made again.
        // Anything else sent back still waits for the batch to end; it holds nothing back.
        const blocking = redoBatch({ blueprint, assets: current.project.workspace.assets, reviews: current.reviews, requests: current.requests, runs: current.runs, only: blockingAssets(current.runs, blueprint) })
        if (blocking) return options.runner.startPlanned({ projectId, expectedRevision: current.project.revision, prompt: blocking.prompt, plan: blocking.plan }, external)
      }
      // An outside AI that asks for the next batch while this one still has tasks is told which call is right now, from the run as it stands: claim what can be claimed.
      const live = external ? current.runs.find((run) => ["planning", "running"].includes(run.state) && run.tasks.some((task) => blueprintSourceKey(task.source) !== null)) : undefined
      // A redo run that was started beside the batch for what the batch stands on: said first, since it is the one thing to do and nothing needs to be given up.
      const redoing = external ? current.runs.find((run) => isRedoRun(run) && ["planning", "running"].includes(run.state) && run.tasks.some((task) => ["queued", "running", "validating", "saving"].includes(task.state))) : undefined
      const waiting = redoing ? current.runs.filter((run) => run !== redoing && ["planning", "running"].includes(run.state)).flatMap((run) => run.tasks.filter((task) => ["queued", "running", "validating", "saving"].includes(task.state) && redoneBefore([redoing], run, task, blueprint).length)) : []
      throw new BlueprintError(
        redoing && waiting.length
          ? `${REDO_LIVE_WORDS(redoing, waiting)}${PARALLEL_WORDS.ended(redoing)}`
          : live
            ? `上一批内容还没有做完（运行 ${live.id}），现在不能领下一批。${PARALLEL_WORDS.ended(live)}`
            : "上一批内容还没有做完，请等它结束或者先停止。",
      )
    }
    const plan = nextProductionBatch(input)
    if (!plan) return null
    return options.runner.startPlanned({ projectId, expectedRevision: current.project.revision, prompt: blueprint.request, plan }, external)
  }

  async function note(projectId: string, text: string | null) {
    const current = await facts(projectId)
    if (current.project.blueprint?.state === "confirmed")
      await writeProduction(current.directory, { blueprint_revision: current.project.blueprint.revision, note: text })
  }

  // After each batch: stop if asked, stop if nothing moved, otherwise start the next one.
  async function advance(projectId: string, entry: { stop: boolean; runId: string }): Promise<void> {
    // A stop that arrived while this batch was being set up had no run to act on yet.
    if (entry.stop) options.runner.drain(entry.runId)
    await options.runner.wait(entry.runId)
    const run = await options.runner.get({ projectId, runId: entry.runId })
    if (entry.stop || run.state === "canceled") return
    // Every batch must save or fail at least one entry; one that does neither would repeat forever.
    if (!run.tasks.some((task) => task.state === "completed" || task.state === "failed"))
      return note(projectId, "这一批没有任何进展，制作已经暂停。请检查 AI 连接，然后再点一次继续。")
    const next = await startBatch(projectId, false)
    if (!next) return
    entry.runId = next.run.id
    options.onRun(next.run.id, projectId)
    return advance(projectId, entry)
  }

  /**
   * What happened in this project, for the side panel. The making steps of whatever is in hand are read into
   * the log first, so they show while Studio's own AI or an outside one is still working.
   */
  async function activity(input: { projectId: string; after?: number }): Promise<Activity> {
    const directory = await options.directoryFor(z.uuid().parse(input.projectId))
    const live = (await options.runner.list(input.projectId)).filter((run) => ["planning", "running"].includes(run.state))
    await noteMakings(
      directory,
      live.flatMap((run) => run.tasks.filter((task) => ["running", "validating", "saving"].includes(task.state)).map((task) => ({ asset_id: task.asset_id, item: taskItem(task), title: task.title }))),
    )
    const read = await readActivity(directory, input.after ?? 0)
    const events = read.events.slice(-ACTIVITY_PAGE)
    // Only the newest few come with their picture: a long log is not a reason to read a hundred files.
    const pictured = new Set(events.filter((event) => event.picture).slice(-ACTIVITY_PICTURES).map((event) => event.seq))
    return {
      events: await Promise.all(
        events.map(async ({ picture, key: _key, ...event }) => {
          const thumb = picture && pictured.has(event.seq) ? await readPicture(directory, picture.asset_id, picture.file).catch(() => null) : null
          return { ...event, text: activityText(event), ...(thumb ? { thumb } : {}) }
        }),
      ),
      last: read.last,
      now: new Date().toISOString(),
      alive_at: read.alive_at ? new Date(read.alive_at).toISOString() : null,
      running: live.length > 0 || producing.has(input.projectId) || thinking.has(input.projectId),
    }
  }
  const itemOf = (blueprint: Blueprint | undefined, assetId: string) => blueprint?.entries.find((entry) => entry.asset_id === assetId)?.key ?? assetId
  // While a job of Studio's own AI thinks, the panel says something is going on.
  const thought = <T>(projectId: string, work: Promise<T>) => {
    thinking.add(projectId)
    return work.finally(() => thinking.delete(projectId))
  }

  return {
    overview,
    play: async (input: { projectId: string }) => playFor(await openProject(await options.directoryFor(input.projectId)), true),
    draft: (input: Parameters<typeof draft>[0], signal: AbortSignal, progress?: (detail: string) => void) => thought(input.projectId, draft(input, signal, progress)),
    expand: (input: Parameters<typeof expand>[0], signal: AbortSignal, progress?: (detail: string) => void) => thought(input.projectId, expand(input, signal, progress)),
    activity,
    /** Add an event to this project's activity log: the one way in for features outside this file. See `@minemods/mod-core/activity`. */
    say,
    /** One call of an outside AI, as the dispatcher saw it end. */
    async toolCalled(input: { request: ExternalBridgeRequest | undefined; result: unknown; ms: number; refused: { plain: boolean; message: string; raw?: string } | null }) {
      const given = z.object({ projectId: z.uuid(), runId: z.uuid().optional() }).safeParse(input.request?.input).data
      if (!input.request || !given) return
      // A successful open is a sign of life, without a new on-disk project event.
      if (input.request.method === "openProject" && !input.refused) return pulseActivity(await options.directoryFor(given.projectId))
      const run = given.runId ? await options.runner.get({ projectId: given.projectId, runId: given.runId }).catch(() => null) : null
      const event = toolActivity({ method: input.request.method, input: input.request.input, result: input.result, refused: input.refused, ms: input.ms, run, review: options.runner.reviewOn() })
      if (!event) return
      const directory = await options.directoryFor(given.projectId)
      // What the call did to a making is read in before the call itself, so the steps stand in the order they happened.
      if (run) await noteMakings(directory, run.tasks.filter((task) => task.id === (input.request!.input as { taskId?: string }).taskId).map((task) => ({ asset_id: task.asset_id, item: taskItem(task), title: task.title })))
      await noteActivity(directory, event)
    },
    /** The idea cards and the person's requirements, as stored; null when there are none. */
    async getIdeas(input: { projectId: string }) {
      return readIdeas(await options.directoryFor(z.uuid().parse(input.projectId)))
    },
    /** The person's own part: picking, answering, giving a requirement up, editing the summary, saying go. No tool offered to an outside AI leads here. */
    async chooseIdeas(input: { projectId: string } & IdeaChoice) {
      const directory = await options.directoryFor(z.uuid().parse(input.projectId))
      const { projectId: _projectId, ...choice } = input
      // Words about the requirements alone, while a plan stands (the blueprint page, not the cards): the person changing what that plan is held to.
      // They go through this same record, so the AI-side lock reads them like any other requirement, and the plan's own copy is brought along.
      const edits = Boolean(choice.reword?.length || choice.lift?.length || choice.restore?.length || choice.add?.trim())
      const alone = edits && choice.picks === undefined && !choice.answers && choice.summary === undefined && !choice.ready
      const before = alone ? await readIdeas(directory) : null
      const planned = alone ? (await facts(input.projectId)) : null
      const onPlan = !!planned?.project.blueprint && (before === null || before.state === "used")
      if (onPlan && planned!.busy) throw new BlueprintError(BUSY)
      const record = await ruled(() => changeIdeas(directory, (current) => chooseIdeas(current ?? (onPlan ? bareIdeas({ request: planned!.project.blueprint!.request, by: options.connection() ? "studio" : "outside" }) : null), choice)))
      if (onPlan) await holdPlanTo(input.projectId, directory, record, before)
      const answered = Object.entries(choice.answers ?? {}).flatMap(([id, yes]) => record.questions.filter((question) => question.id === id).map((question) => ({ question, yes })))
      await Promise.all([
        ...answered.map((value) => say(input.projectId, { ...whole, kind: "person", mark: "note", text: value.yes ? `你同意改掉一条要求：${value.question.change}` : `你决定保持原来的要求，不改：「${record.constraints.find((constraint) => constraint.id === value.question.constraint)?.text ?? ""}」` })),
        ...(choice.ready ? [say(input.projectId, { ...whole, kind: "person", mark: "note", text: "你选好了做法，说「就按这个做」。" })] : []),
      ])
      return record
    },
    async discardIdeas(input: { projectId: string }) {
      const directory = await options.directoryFor(z.uuid().parse(input.projectId))
      const current = await readIdeas(directory)
      // The cards go; what the person required stays with their sentence until they write a new one.
      if (current) await changeIdeas(directory, () => ({ ...current, revision: current.revision + 1, groups: [], questions: [], things: [], declined: [], picks: [], answers: [], summary: null, state: "choosing" }))
      return null
    },
    isProducing: () => producing.size > 0,
    async get(input: { projectId: string }) {
      return (await facts(input.projectId)).project.blueprint ?? null
    },
    async save(input: { projectId: string; revision: number; blueprint: BlueprintDraft }) {
      const draft = BlueprintDraftSchema.parse(input.blueprint)
      const held = (await facts(input.projectId)).project.blueprint
      // The person's own edit. Their requirements and what each entry said about them stay with the plan;
      // the comparison does not, because nobody compared the plan as it is after this change.
      // What a paper play-through found stays while the same things are planned; once the person adds or removes one it no longer describes the plan.
      const { check: _check, paper: _paper, ...kept } = draft
      const same = !!held && held.entries.length === draft.entries.length && held.entries.every((entry) => draft.entries.some((value) => value.key === entry.key))
      return store(
        input.projectId,
        {
          ...kept,
          entries: draft.entries.map((entry) => {
            const before = held?.entries.find((value) => value.key === entry.key)
            const honours = entry.honours ?? before?.honours
            // Their answers stay with an entry the person only renamed or reworded; 「故意不做」 they clicked comes in with the edit itself.
            const play = entry.play ?? before?.play
            // creature tier (10-12): the same for the tier, so an edit that does not mention it (a renamed entry) does not lose it.
            const tier = entry.tier ?? before?.tier
            return { ...entry, ...(honours ? { honours } : {}), ...(play ? { play } : {}), ...(tier && entry.kind === "entity" ? { tier } : {}) }
          }),
          ...(same && held?.paper ? { paper: held.paper } : {}),
          ...(held?.honours && !draft.honours ? { honours: held.honours } : {}),
          ...(held?.constraints ? { constraints: held.constraints } : {}),
          ...(held?.lifted ? { lifted: held.lifted } : {}),
        },
        input.revision,
      )
    },
    /** Only the person does this, in the app. No tool offered to an outside AI leads here. */
    async confirm(input: { projectId: string; revision: number }) {
      const current = await facts(input.projectId)
      if (current.busy) throw new BlueprintError(BUSY)
      const next = await ruled(() => confirmBlueprint(current.project, input.revision))
      const saved = await saveProject(current.directory, next, current.project.revision).catch(moved)
      // Confirming starts the count of tries afresh, including for entries that had failed for good.
      await writeProduction(current.directory, { blueprint_revision: input.revision, note: null, restart: true })
      await say(input.projectId, { ...whole, kind: "person", mark: "ok", text: "你确认了蓝图。" })
      return saved.blueprint!
    },
    async discard(input: { projectId: string }) {
      const current = await facts(input.projectId)
      if (current.busy) throw new BlueprintError(BUSY)
      if (!current.project.blueprint) return null
      const { blueprint: _blueprint, ...rest } = current.project
      await saveProject(current.directory, rest, current.project.revision).catch(moved)
      // The person starts over: what was refused before no longer stands in front of the new start.
      await clearRefusal(current.directory).catch(() => undefined)
      return null
    },
    async start(input: { projectId: string }) {
      if (!options.connection()) throw new BlueprintError("还没有连接 AI，或者现在由外部 AI 负责制作。请先在设置里填好 AI 连接。")
      if (producing.has(input.projectId)) return overview(input)
      // Claimed before the first await, so a second call cannot start a second line of work.
      const entry = { stop: false, runId: "", done: Promise.resolve() }
      producing.set(input.projectId, entry)
      // The note is cleared before the batch, never after: a record first written here must not postdate the run it is about to count.
      const first = await note(input.projectId, null)
        .then(() => startBatch(input.projectId, false))
        .catch((error: unknown) => {
          producing.delete(input.projectId)
          throw error
        })
      if (!first) {
        producing.delete(input.projectId)
        return overview(input)
      }
      options.onRun(first.run.id, input.projectId)
      entry.runId = first.run.id
      entry.done = advance(input.projectId, entry)
        .catch((error: unknown) =>
          note(input.projectId, `制作被打断了：${error instanceof BlueprintError ? error.message : "出现了意外情况。"}可以再点一次继续。`).catch(() => undefined),
        )
        .finally(() => producing.delete(input.projectId))
      return overview(input)
    },
    async stop(input: { projectId: string }) {
      const entry = producing.get(input.projectId)
      if (entry) {
        entry.stop = true
        options.runner.drain(entry.runId)
        await say(input.projectId, { ...whole, kind: "person", mark: "note", text: "你点了先停一下：手上这几样做完就停。" })
      }
      redos.forEach((runId) => options.runner.drain(runId))
      return overview(input)
    },
    /** Resolves when Studio is no longer working through this project's plan. */
    async idle(projectId: string) {
      await producing.get(projectId)?.done
    },
    /**
     * The person's own check-off of one saved thing, for the revision they were looking at. It never holds
     * anything up. Only the person can give it: there is no way for an outside AI to call this.
     */
    async review(input: { projectId: string; assetId: string; revision?: number; verdict: "accepted" | "rejected"; note?: string }) {
      const current = await facts(input.projectId)
      const asset = current.project.workspace.assets.find((value) => value.id === input.assetId)
      if (!asset) throw new BlueprintError(GONE)
      if (input.revision !== undefined && input.revision !== asset.revision) throw new BlueprintError(CHANGED(asset.title))
      await recordReview(current.directory, { asset_id: asset.id, revision: asset.revision, verdict: input.verdict, note: input.note })
      await say(input.projectId, {
        kind: "person",
        item: itemOf(current.project.blueprint, asset.id),
        title: asset.title,
        ...(input.verdict === "accepted" ? { mark: "ok" as const, text: "你验收通过了。" } : { mark: "note" as const, text: "你说这一版要改。", ...(input.note ? { lines: [input.note] } : {}) }),
      })
      return overview(input)
    },
    /** The person takes back what they said about the revision that exists now. */
    async clearReview(input: { projectId: string; assetId: string }) {
      const current = await facts(input.projectId)
      const asset = current.project.workspace.assets.find((value) => value.id === input.assetId)
      if (!asset) throw new BlueprintError(GONE)
      await clearReview(current.directory, { asset_id: asset.id, revision: asset.revision })
      await say(input.projectId, { kind: "person", mark: "note", item: itemOf(current.project.blueprint, asset.id), title: asset.title, text: "你撤回了对这一版的意见。" })
      return overview(input)
    },
    /**
     * Make one thing again with what the person said about it. The request is recorded first, so it is
     * never lost: Studio's own AI starts on it at once (or right after the batch in hand), and an outside
     * AI is handed it by its next `next_batch`. A saved thing is remade in place; a plan entry that failed
     * and was never made gets one more try.
     */
    async redo(input: { projectId: string; itemId: string; feedback: string; annotation?: ModelAnnotationInput }) {
      const sent = await sentBack(input)
      await say(input.projectId, { kind: "person", mark: "note", item: sent.item.id, title: sent.item.title, text: sent.remade ? "你让 AI 重做这一样。" : "你让 AI 把这一样再试一次。", ...(input.feedback ? { lines: [input.feedback] } : {}) })
      await redone(input.projectId, sent.only)
      return overview(input)
    },
    /**
     * Several things sent back in one go, each with its own words: what `redo` does for one, with one batch
     * for all of them (a second redo asked while the first is being made would only wait). A thing that
     * cannot be redone does not stop the others: it is returned with the reason `redo` would have given.
     * `own` says whether Studio's own AI does the work; false means they wait for an outside AI.
     */
    async redoSeveral(input: { projectId: string; things: { itemId: string; feedback: string }[] }) {
      const done = { sent: [] as { id: string; title: string }[], refused: [] as { itemId: string; why: string }[], only: [] as string[] }
      for (const thing of input.things)
        await sentBack({ projectId: input.projectId, ...thing }).then(
          (sent) => void (done.sent.push({ id: sent.item.id, title: sent.item.title }), done.only.push(...sent.only)),
          (error: unknown) => (error instanceof BlueprintError ? void done.refused.push({ itemId: thing.itemId, why: error.message }) : Promise.reject(error)),
        )
      if (done.only.length) await redone(input.projectId, done.only)
      return { sent: done.sent, refused: done.refused, own: Boolean(options.connection()) }
    },
    /** How one item was or is being made by looking, as the card shows it. Read from the project every time, so polling follows a running task. */
    async making(input: { projectId: string; itemId: string }): Promise<Making | null> {
      const found = await madeFor(input)
      return found.record ? shown(found.directory, input.itemId, found.record, found.saved, found.live, found.idle) : null
    },
    /** The person's own edit of a part sheet. It changes nothing that is made; the next redo starts from it. */
    async saveSheet(input: { projectId: string; itemId: string; sheet: PartSheet }): Promise<Making> {
      const found = await madeFor(input)
      if (found.live) throw new BlueprintError(BEING_MADE)
      const asset = found.asset
      if (!found.record && !asset) throw new BlueprintError(NO_SHEET_YET)
      if (!found.record && !isLooked(asset!.module)) throw new BlueprintError(NOT_LOOKED)
      const record = await changeMaking(found.directory, found.record?.asset_id ?? asset!.id, (current) =>
        current ? edit(current, input.sheet) : sheetOnly({ asset_id: asset!.id, entry: found.entry, kind: asset!.module, request: asset!.prompt.slice(0, 20000), brief: asset!.prompt.slice(0, 16000) }, input.sheet),
      )
      return shown(found.directory, input.itemId, record, found.saved, false)
    },
    async usage(input: { projectId: string; assetId: string }): Promise<AssetUsage> {
      const usage = assetUsage(await overview(input), input.assetId)
      if (!usage) throw new BlueprintError("找不到这项内容，可能已经被删除了。")
      return usage
    },
    external: {
      async getBlueprint(input: unknown) {
        const parsed = ExternalBlueprintInputSchema.parse(input)
        const current = await facts(parsed.projectId)
        const view = await overview(parsed)
        const failed = failedForGood(current, view)
        return {
          blueprint: current.project.blueprint ?? null,
          // Whether anyone but the maker will read the plan against the requirements and play it on paper, said once, with what `independent` must then be.
          plan_checks: { reviewer: checker() === "independent", rule: PLAN_CHECK_WORDS[checker()] },
          entries: view.items.filter((item) => item.key !== null),
          // What the project already holds that no entry stands for: the ids an entry's `existing` can point at to change one of them, instead of making a second.
          existing: existingThings(current.project).filter((thing) => !current.project.blueprint?.entries.some((entry) => entry.asset_id === thing.id || (entry.existing?.action === "change" && entry.existing.id === thing.id))),
          production: view.production,
          problems: view.problems,
          // What the person looked at and wants remade, with their words. `next_batch` hands these out first.
          // `asset_id` is null for an entry that failed and was never made: that one is made anew, not edited.
          redo: view.items.filter((item) => item.status === "redo").map((item) => ({ id: item.id, asset_id: item.asset_id, title: item.title, feedback: item.reason })),
          // Entries that failed on every try: what can be done about them, so the AI that makes one again names the entry it makes.
          ...(failed.length ? { failed: { entries: failed, next_step: FAILED_ENTRY_WORDS(failed) } } : {}),
          // What a plan must look like, for an AI about to propose one.
          planner: { instructions: blueprintPlannerInstructions(current.project.target, checker()), schema: blueprintPlanJsonSchema() },
          // 「能不能玩」 as it stands, and how a paper play-through of a new plan must be handed in with it.
          playable: { ...view.playable, paper: current.project.blueprint?.paper ?? null, paper_play: { instructions: paperPlayInstructions(checker()), schema: paperPlayJsonSchema() } },
          // What the person required, as far as Studio already holds it, and how a comparison must be handed in.
          requirements: await readIdeas(current.directory).then((record) => ({
            constraints: lockedConstraints(record?.constraints, record?.lifted),
            lifted: record?.lifted ?? [],
            // What the person changed in their own list since the last plan was stored, in sentences: the plan has not been held to it yet, and `blueprint.check` is gone if it was compared against the old words.
            changed: changeSentences(record?.changes),
            check: { instructions: constraintCheckInstructions(checker()), schema: constraintVerdictsJsonSchema() },
          })),
        }
      },
      /**
       * An outside AI's plan. The requirements are the person's: those Studio already holds for this sentence, or,
       * when it holds none, the quotes the AI sends (checked against the sentence) together with every limiting
       * clause Studio finds in the sentence by rule, whether the AI quoted it or not. A plan that breaks one the
       * person has not given up is refused here, the same as Studio's own. Studio has no model of its own in this
       * mode, so the comparison is the outside AI's to arrange and to hand in; whether its reader was a separate
       * one is its own word.
       */
      async proposeBlueprint(input: unknown) {
        const parsed = ExternalProposeBlueprintInputSchema.parse(input)
        const current = await facts(parsed.projectId)
        if (current.busy) throw new BlueprintError(BUSY)
        const held = await readIdeas(current.directory)
        // The person's words are what Studio stored, never what the AI says they are: while a plan or approved cards stand on them, a hand-in
        // that words them differently is turned back (below), and one that repeats them is stored from Studio's own copy.
        const said = askedWords(heldWords(held, current.project.blueprint), parsed.request)
        const request = "request" in said ? said.request : parsed.request
        const known = covers(held, request)
        if (known && held.groups.length && held.state === "choosing") throw new BlueprintError(CHOOSING)
        const check = parsed.constraint_check
        // Every refusal below is also written down for the blueprint page, so the reason stands where the plan should be.
        const against = current.project.blueprint?.revision
        const back = (about: PlanRefusal["about"], why: string, constraint: string | null = null) => turnedBack(current.directory, { by: "outside", why, about, constraint, words: constraint ? record.constraints.find((value) => value.id === constraint)?.text : null, plan: parsed.blueprint, against })
        const refuse = async (about: PlanRefusal["about"], why: string, constraint: string | null = null, message = why): Promise<never> => {
          await back(about, why, constraint)
          throw new BlueprintError(message)
        }
        if (!("request" in said)) await refuse("rule", said.person, null, `${said.person}${said.ai}`)
        // 「审查」 off: Studio knows nobody else can have read this plan, so a claim that somebody independent did is refused, not stored with a disclaimer.
        if (checker() === "self") {
          if (check?.independent) await refuse("rule", INDEPENDENCE_REFUSALS.no_reviewer("constraint_check", "对要求的逐条核对"))
          if (parsed.paper_play?.independent) await refuse("rule", INDEPENDENCE_REFUSALS.no_reviewer("paper_play", "在纸上从头玩一遍"))
        }
        // Stored only once the plan is: a refused plan leaves the person's list as it was.
        const record = await ruled(() => (known && !parsed.constraints ? held : requireOnly(held, { request, by: "outside", quotes: parsed.constraints ?? [] })))
        const plan = settled(parsed.blueprint, current.project.blueprint)
        // The plan's own rules first, so what is wrong with its shape is said before anything about how it plays.
        await ruled(() => replaceBlueprint(current.project, { request, ...plan, ...required(record, null) })).catch((error: unknown) => (error instanceof BlueprintError ? refuse("rule", error.message) : Promise.reject(error)))
        // Content the project already holds: an entry changes it, is deliberately another thing, or is refused for being a second one of the same name.
        const clash = existingRefusal(current.project, plan)
        if (clash) await refuse("rule", clash)
        // The same door as Studio's own planner: a thing left without an answer is named and the plan is not stored.
        const gaps = playable(record, plan)
        if (gaps) await refuse("playable", gaps)
        const verdict = await locked(record, plan, async () => (check ? { verdicts: check.verdicts, by: "outside", independent: check.independent, at: new Date().toISOString() } : null))
        // The outside AI is told which requirements are in force and under which ids, so it can answer each one.
        const listed = `\n现在锁定的要求（honours 和 constraint_check 里用这些 id）：${lockedConstraints(record?.constraints, record?.lifted).map((value) => `${value.id}「${value.text}」`).join("；")}`
        if (verdict.issue) await refuse("requirement", verdict.issue, verdict.constraint, `${!check && verdict.issue === LOCK_REFUSALS.unchecked ? (checker() === "self" ? NO_CHECK_SELF : NO_CHECK) : verdict.issue}${listed}`)
        // Studio has no model of its own here, so the paper play-through is the outside AI's to arrange, like the comparison above.
        if (!parsed.paper_play) return refuse("playable", "还没有人在纸上把这份蓝图玩一遍，所以没有保存。AI 交蓝图时没有带上试玩的结论。", null, checker() === "self" ? PLAY_REFUSALS.unplayed_self : PLAY_REFUSALS.unplayed)
        const paper: PaperPlay = { findings: parsed.paper_play.findings, advice: parsed.paper_play.advice, by: "outside", independent: parsed.paper_play.independent, at: new Date().toISOString() }
        // What Studio can only repeat to the person: nobody it can see has read this plan.
        const claimed = Boolean(verdict.check?.independent || paper.independent)
        // The person may have changed their list while this was being weighed: the plan was held to the list as it stood when it came in, so it is
        // not stored over a newer one, and what they changed is never overwritten by the copy read at the start.
        const now = await readIdeas(current.directory)
        if (now?.updated_at !== held?.updated_at) throw new BlueprintError(LIST_MOVED)
        const blueprint = await store(parsed.projectId, { request, ...plan, ...required(record, verdict.check, paper) })
        await changeIdeas(current.directory, (latest) => planStored(latest && latest.updated_at !== held?.updated_at ? latest : record, record))
        await clearRefusal(current.directory).catch(() => undefined)
        await say(parsed.projectId, { ...whole, kind: "plan", mark: "ok", end: true, text: `外部 AI 交来了蓝图草稿。${drafted(blueprint).replace("蓝图草稿好了：", "")}` })
        return {
          blueprint,
          confirmed: false,
          next_step: `蓝图已经存为草稿。${claimed ? "你把核对或试玩写成了没参与规划的评审做的；Studio 看不到这个评审，核实不了，会原样写给用户看。其实是你自己做的话，现在改成 false 再提交一次。" : ""}${paper.findings.length ? `试玩员指出的 ${paper.findings.length} 处卡住的地方会原样摆在用户面前；能解决的先改好再提交一次。` : ""}用一句话请用户在 MineMods Studio 里看蓝图、在那里点「确认蓝图」（不用回到这个窗口告诉你），然后马上调用 await_blueprint_decision（revision 填 ${blueprint.revision}）在这一轮里等他：返回 confirmed 就立刻 next_batch 开始；返回 ask_person_back 才请他确认后回来说一声「开始做」。确认之前 next_batch 不会开始制作。`,
        }
      },
      /** An outside AI's idea cards. They are put before the person; nothing here, or anywhere an AI can reach, chooses among them. */
      async proposeIdeas(input: unknown) {
        const parsed = ExternalProposeIdeasInputSchema.parse(input)
        const current = await facts(parsed.projectId)
        if (current.busy) throw new BlueprintError(BUSY)
        // The same door as the plan's: the person's words are Studio's copy, and an AI's different wording of them is turned back, not stored.
        const said = askedWords(heldWords(await readIdeas(current.directory), current.project.blueprint), parsed.request)
        if (!("request" in said)) throw new BlueprintError(`${said.person}${said.ai}`)
        const record = await ruled(() => changeIdeas(current.directory, (before) => proposeIdeas(before, { request: said.request, by: "outside", proposal: parsed.ideas, target: current.project.target })))
        await say(parsed.projectId, { ...whole, kind: "plan", mark: "ok", end: true, text: `外部 AI 交来了想法。${carded(record).replace("想法出来了：", "")}` })
        return { ideas: shownIdeas(record), chosen: false, next_step: "想法已经摆在用户面前。请让用户在 MineMods Studio 里一组一组地选；只有用户能选。之后用 get_ideas 读他选了什么。" }
      },
      awaitBlueprintDecision: awaitDecision,
      async getIdeas(input: unknown) {
        const parsed = ExternalBlueprintInputSchema.parse(input)
        const current = await facts(parsed.projectId)
        const record = await readIdeas(current.directory)
        return {
          ideas: record ? shownIdeas(record) : null,
          chosen: record?.state === "ready" || record?.state === "used",
          // What idea cards must look like, for an AI about to propose them.
          author: { instructions: ideaInstructions(current.project.target), schema: ideaProposalJsonSchema() },
          next_step: !record
            ? "还没有想法。按 author.instructions 把用户的一句话展开成想法卡片，用 propose_ideas 提交。"
            : record.state === "choosing"
              ? "用户还在选。等他选完再来读；不要替他选，也不要现在提交蓝图。"
              : "用户选好了：ideas.summary 是他认可（可能亲手改过）的做法，ideas.locked 是他仍然坚持的要求。按 summary 规划蓝图，用 propose_blueprint 提交，request 填 ideas.summary。",
        }
      },
      async nextBatch(input: unknown) {
        const parsed = ExternalBlueprintInputSchema.parse(input)
        const started = await startBatch(parsed.projectId, true)
        const view = await overview(parsed)
        const production = view.production
        // Everything of the plan is saved and nothing waits to be remade: what is left is the build and its checks.
        const made = production.total > 0 && production.saved === production.total && !production.to_redo
        // The tasks that can start now are named, not left to be worked out from `dependencies`: measured on real projects, the
        // outside AI held fewer places than it was allowed and claimed ready tasks late, one at a time.
        const plan = started ? parallelPlan(started.run) : null
        // A redo started beside a batch in hand (B18-J-03): which tasks of that batch wait for it, so the maker is told it does not have to give them up.
        const waiting =
          started && isRedoRun(started.run)
            ? await facts(parsed.projectId).then((current) =>
                current.runs.filter((run) => run.id !== started.run.id && ["planning", "running"].includes(run.state)).flatMap((run) => run.tasks.filter((task) => ["queued", "running", "validating", "saving"].includes(task.state) && redoneBefore([started.run], run, task, current.project.blueprint).length)),
              )
            : []
        return {
          run: started?.run ?? null,
          tasks: started?.tasks ?? [],
          ...(plan ? { parallel: plan } : {}),
          production,
          next_step: started && plan
            ? isRedoRun(started.run)
              ? `这一批是用户看过以后要求重做的内容，用户的意见写在每个任务的 prompt 里。claim_task 会给出现有文档，照意见改好后 commit_task。${waiting.length ? REDO_BESIDE_WORDS(waiting) : ""}${PARALLEL_WORDS.batch(plan)}`
              : PARALLEL_WORDS.batch(plan)
            : made
              ? `${NOTHING_LEFT.made}${buildAndCheckStep()}${production.unsatisfied || production.interrupted ? NOTHING_LEFT.held(production.unsatisfied + production.interrupted) : ""}`
              : await facts(parsed.projectId).then((current) => {
                  const failed = failedForGood(current, view)
                  return `${NOTHING_LEFT.stuck}${failed.length ? FAILED_ENTRY_WORDS(failed) : ""}`
                }),
        }
      },
    },
    /** Start no further batch. The runner ends the one in flight; `settled` waits for the loops to notice. */
    dispose() {
      producing.forEach((entry) => {
        entry.stop = true
      })
    },
    async settled() {
      await Promise.all([...producing.values()].map((entry) => entry.done))
    },
  }
}

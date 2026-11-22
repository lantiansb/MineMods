import { isDeepStrictEqual } from "node:util"
import { z } from "zod"
import { noteActivity, taskItem } from "@minemods/mod-core/activity"
import type { AssetReview } from "@minemods/mod-core/acceptance"
import { told } from "@minemods/mod-core/acceptance"
import { redoRemark } from "@minemods/mod-core/blueprint-production"
import { stopWords } from "@minemods/mod-core/coded-errors"
import { GAMEPLAY_LIMITS, GameplayDocumentSchema, GameplaySheetSchema, GameplayWriterSchema, findingLine, gameplayPackage, gameplaySheet, type GameplayDocument, type GameplaySheet } from "@minemods/mod-core/gameplay"
import { gameplayThingsForWriter } from "@minemods/mod-core/gameplay-things"
import { alreadyForReview, savedGameplays, type OtherGameplay } from "@minemods/mod-core/gameplay-already"
import { CHECK_WORDS, gameplayApiWords, floorPassed, plainCheckLines, staticChecks, type GameplayCheck } from "@minemods/mod-core/gameplay-check"
import type { CompileResult } from "@minemods/mod-core/gameplay-compile"
import { gameplayContract } from "@minemods/mod-core/creature-contract"
import { CHECK_NETWORK_WORDS } from "@minemods/mod-core/gradle-network"
import {
  GAMEPLAY_REVIEW_LIMITS,
  beginGameplay,
  changeGameplay,
  checkGate,
  checkLines,
  checkedGameplay,
  describeGameplay,
  finishGameplay,
  gameplayCommitGate,
  gameplayCommitGatePlain,
  gameplayUnsatisfied,
  gameplayUnsatisfiedTechnical,
  keepGameplay,
  listGameplay,
  readGameplay,
  readGameplayBest,
  removeGameplayBest,
  reviewableGameplay,
  reviewedGameplay,
  shownGameplay,
  stopGameplay,
  writeGameplayBest,
  writeGameplayUnlocked,
  type GameplayRecord,
} from "@minemods/mod-core/gameplay-loop"
import { gameplayDiscipline, GAMEPLAY_NO_GAME_WORDS, GAMEPLAY_REFUSALS, gameplayOwnWords, GAMEPLAY_REVIEWER_HANDOFF, GAMEPLAY_SOLO_VOICE, GAMEPLAY_REVIEWER_INSTRUCTIONS, gameplaySheetInstructions, gameplayWriterInstructions } from "@minemods/mod-core/gameplay-words"
import { FINDING_LABELS, findingLines, fingerprint, MakingRefusal, SaveRefusal } from "@minemods/mod-core/making"
import { SOLO_VOICE } from "@minemods/studio-ai/making"
import { PARALLEL_WORDS } from "@minemods/mod-core/workspace-runs"
import { openProject } from "@minemods/mod-core/project"
import { blueprintSourceKey } from "@minemods/mod-core/task-source"
import type { ProjectRun, RunTask } from "../project-runs"
import { CHECK_CALLING, CHECK_STAGES, CHECK_STOPPED, CHECK_TIMING, COMPILE_COLD_LINE, elapsedWords, type CheckTiming } from "./check-calling"

/**
 * Gameplay code as Studio runs its loop: description → code → machine checks → review of description
 * against code by someone who took no part → the door. Studio's own AI (`craft`) and an outside AI's tools
 * call the same functions and only these, so there is one protocol and one record. It stands beside the
 * making loop of the looked kinds and answers the same questions at the door (`gate`, `best`, `saved`,
 * `ended`), so the runner treats both alike.
 */

/** Compiles one unsaved version with everything the project generates. Without one, gameplay cannot be checked and so cannot be made. */
export type GameplayCompile = (input: { directory: string; candidate: { asset_id: string; title: string; document: GameplayDocument }; signal?: AbortSignal; onProgress?: (text: string) => void }) => Promise<CompileResult>

/** The progress line of a code check under way: how long, and what it waits on, in the person's words. */
export const checkingLine = (title: string, ms: number, stage: string) => `正在编译检查「${title}」的代码，已经 ${elapsedWords(ms)}：${stage}。`
const compileStage = (output: string) => (/A download broke off/.test(output) ? CHECK_STAGES.retrying : /> Task :compileJava\b/.test(output) ? CHECK_STAGES.compiling : output.includes(COMPILE_COLD_LINE.trim()) ? CHECK_STAGES.preparing_first : null)

export type GameplayWork = {
  directory: string
  /** `tasks`: the run's other tasks, which is how a gameplay is told of the ones planned beside it that have no description yet. Left out: only saved gameplay and records are known. */
  run: Pick<ProjectRun, "prompt"> & Partial<Pick<ProjectRun, "tasks">>
  task: Pick<RunTask, "id" | "asset_id" | "module" | "title" | "prompt" | "source">
}

/** What a reviewer answers. The same two lists as every review; there is nothing to ask to be shown. */
export const GameplayReviewAnswerSchema = z.strictObject({
  passed: z.boolean(),
  findings: z.array(z.string().trim().min(1).max(600)).max(24),
  advice: z.array(z.string().trim().min(1).max(600)).max(24),
  /** Round 18: the technical detail behind the two lists (file, class, method), apart from them, which are written for the person. Always asked for. */
  technical: z.array(z.string().trim().min(1).max(600)).max(24).default([]),
  /** Material the reviewer needed and was not given, a sentence each; empty when it had what it needed. */
  lacking: z.array(z.string().trim().min(1).max(600)).max(GAMEPLAY_REVIEW_LIMITS.lacking),
})

const NO_COMPILER = "这台 Studio 没有配置编译环境。"

/** How much of another task's brief is told, as much as a description's own summary may hold (`GameplaySheetSchema`). */
const GAMEPLAY_SUMMARY_CHARS = 400

/** What whoever made a thing is told of a task whose work is saved and passed. One sentence for both loops. */
/** What a maker is told of a task that has been saved. What to call next is added from the run as it stands (`PARALLEL_WORDS.ended`), never fixed here. */
export const TASK_SAVED = "这一样已经存进工程，这个任务结束了。"

/** Said to the writer of the code with the next findings when the description it asked for instead (`sheet_change`) was not taken: the description is as it was, and this version was checked and reviewed against that. */
export const GAMEPLAY_SHEET_CHANGE_REFUSED = (why: string) => `你在答案里写的 sheet_change 没有被收下，说明还是原来的，这一版是按原来的说明检查和评审的。拒绝的原话：${why}${/[。！？.!?]$/.test(why) ? "" : "。"}照这句话改好，下一版需要时再写一次 sheet_change。`

/** 「审查」 with two windows: a review that failed for want of material is held again by the reviewer in the other window, never by the writer. */
export const GAMEPLAY_AGAIN_APART = (lacked: readonly string[], left: number) =>
  `评审没通过，但它说缺材料：${lacked.join("；")}。审查开着，评审由另一个窗口里的审查 AI 做，不是你：想让它对这一版再评审一次（只有这一次），就再调用一次 await_inspection 等它的结论，不要自己调用 final_review；或者照它列出的问题改出新的一版，check_code，再用 await_inspection 等审查（还可以检查 ${left} 版）。`

/**
 * What a writer is told of a gameplay whose making is over: why (the versions are used up, or it was ended), and what became of the work.
 * Before, the step read as if another version could still be checked, with none left.
 */
function endedStep(record: GameplayRecord, where: string) {
  if (record.outcome === "passed") return `${TASK_SAVED}${where}`
  return `${record.rounds.length >= record.rounds_allowed ? GAMEPLAY_REFUSALS.out_of_rounds(record.rounds_allowed) : GAMEPLAY_REFUSALS.over}${record.outcome === "kept_unsatisfied" && record.kept_round ? GAMEPLAY_REFUSALS.kept(record.kept_round) : GAMEPLAY_REFUSALS.nothing_kept}${where}`
}

/** What a writer is told after each step: where it stands and what comes next. `apart`: 「审查」 is on and the review is another window's to hold. `solo`: it is off, so the writer checks its own code and no reviewer is to be found. `where`: what to call next once the task is over, worked out from the run by the caller. */
export function gameplayStep(record: GameplayRecord, apart = false, solo = false, where = PARALLEL_WORDS.ended(null)) {
  const round = record.rounds.at(-1)
  const left = record.rounds_allowed - record.rounds.length
  return {
    state: record.state,
    round: round?.round ?? 0,
    rounds_allowed: record.rounds_allowed,
    rounds_left: left,
    next_step: record.state === "done" || record.state === "stopped"
      ? endedStep(record, where)
      : !record.described
      ? "先用 save_sheet 写玩法说明。"
      : !round
        ? "照说明写出代码，然后用 check_code 检查。"
        : !round.passed
          ? `照检查结果逐条改，再用 check_code 检查（还可以检查 ${left} 版）。`
          : !record.review || record.review.fingerprint !== round.fingerprint
            ? solo
              ? GAMEPLAY_SOLO_VOICE.step
              : "三项检查都过了。用 final_review（不带 verdict）取评审材料——说明和代码——交给一个没有参与编写的评审，再用 final_review 带上 verdict 记下它的结论。"
            : record.review.passed
              ? `评审通过。现在用 commit_task 提交检查过的这一版，一个字都不要再改。评审留下的“${FINDING_LABELS.advice}”会一起交给用户看。`
              : record.review.lacked?.length && !record.review.again
                ? apart
                  ? GAMEPLAY_AGAIN_APART(record.review.lacked, left)
                  : `评审没通过，但它说缺材料：${record.review.lacked.join("；")}。可以把缺的补给评审，用 final_review 对这一版再评审一次（只有这一次）；或者照它列出的问题改出新的一版，check_code，再评审（还可以检查 ${left} 版）。`
                : `评审没通过：说明里写的行为代码没有做到。照评审列出的问题改出新的一版，check_code，再评审（还可以检查 ${left} 版）。`,
  }
}

/** A check as its writer is shown it: the three results in words, and every finding as one line. */
const checkTold = (check: GameplayCheck) => ({
  passed: floorPassed(check),
  in_bounds: { ok: !check.bounds.length, findings: check.bounds },
  references: { ok: !check.references.length, findings: check.references },
  compiles: check.compile ? { ok: check.compile.ok, compiler: check.compile.compiler, findings: check.compile.findings, note: check.compile.note } : { ok: null, note: "越界和引用的问题改掉以后才会编译。" },
  lines: checkLines(check),
  // K2: read off the source and no refusal; told so the writer can act on it before a reviewer has to.
  ...(check.advice?.length ? { advice: check.advice.map(findingLine) } : {}),
})

export function createGameplayLoop(options: { compile?: GameplayCompile; timing?: Partial<CheckTiming> }) {
  const on = (kind: string) => kind === "gameplay"
  const timing: CheckTiming = { ...CHECK_TIMING, ...options.timing }
  // One compile at a time in this Studio: the build tools are a single shared installation, and a second Gradle beside the first is refused by it.
  const line = { tail: Promise.resolve<unknown>(undefined) }
  const inTurn = <T>(run: () => Promise<T>) => {
    const next = line.tail.then(run, run)
    line.tail = next.catch(() => undefined)
    return next
  }
  const missing = (): never => {
    throw new MakingRefusal(GAMEPLAY_REFUSALS.no_sheet)
  }

  /** The record of this task, started if this is the first step. A redo starts from the description of the version before. */
  async function open(work: GameplayWork) {
    const current = await readGameplay(work.directory, work.task.asset_id)
    if (current?.task_id === work.task.id) return current
    const entry = blueprintSourceKey(work.task.source)
    const earlier = current ?? (entry ? ((await listGameplay(work.directory)).filter((record) => record.entry === entry).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null) : null)
    return changeGameplay(work.directory, work.task.asset_id, (latest) => beginGameplay(latest ?? earlier, { asset_id: work.task.asset_id, entry, request: work.run.prompt, brief: work.task.prompt, task_id: work.task.id, remark: redoRemark(work.task.prompt) }))
  }
  const change = (work: GameplayWork, step: (record: GameplayRecord) => GameplayRecord) => changeGameplay(work.directory, work.task.asset_id, (record) => step(record?.task_id === work.task.id ? record : missing()))
  const note = (work: GameplayWork, event: Parameters<typeof noteActivity>[1]) => noteActivity(work.directory, event)
  const about = (work: GameplayWork) => ({ item: taskItem(work.task as RunTask), title: work.task.title })

  /**
   * The other gameplays of the project as they describe themselves: the saved ones, and the ones being written whose description is already written (its record, which is newer than
   * the saved version when it is a redo). A record whose task is no longer among the run's active ones is a task that ended without a trace and does not count. `planned`: the run's
   * other gameplay tasks that have no description yet, by title and the brief of the plan (cut where a description's own summary is cut), since all they can be known by.
   */
  async function neighbours(work: GameplayWork, project: Awaited<ReturnType<typeof openProject>>) {
    const tasks = work.run.tasks
    const active = new Map((tasks ?? []).filter((task) => task.module === "gameplay" && task.id !== work.task.id && ["queued", "running", "validating", "saving"].includes(task.state)).map((task) => [task.id, task]))
    const writing = (await listGameplay(work.directory))
      .flatMap((record): (OtherGameplay & { task_id: string | null })[] => {
        const inProgress = ["describing", "writing", "reviewing"].includes(record.state) && (!tasks || (record.task_id !== null && active.has(record.task_id)))
        return record.sheet && record.asset_id !== work.task.asset_id && inProgress ? [{ task_id: record.task_id, asset_id: record.asset_id, name: record.sheet.name, summary: record.sheet.summary, behaviours: record.sheet.behaviours, uses: record.sheet.uses }] : []
      })
    const gameplays: OtherGameplay[] = [...savedGameplays(project, work.task.asset_id).filter((saved) => !writing.some((other) => other.asset_id === saved.asset_id)), ...writing]
    // The run's list was read when this task started: a task it still shows as waiting may have been described or saved since, and is then known by its description.
    const planned = [...active.values()].filter((task) => !gameplays.some((other) => other.asset_id === task.asset_id)).map((task) => ({ title: task.title, brief: task.prompt.slice(0, GAMEPLAY_SUMMARY_CHARS) }))
    return { gameplays, planned }
  }
  /** What of the project a gameplay may attach to and read, as the writer is shown it: each thing with what already acts on it. */
  async function things(work: GameplayWork) {
    const project = await openProject(work.directory)
    const around = await neighbours(work, project)
    return { mod_id: project.mod_id, target: project.target, things: gameplayThingsForWriter(project, work.task.asset_id, around.gameplays), planned: around.planned }
  }

  // The packet last handed to a reviewer, by task: in memory only.
  const handed = new Map<string, { version: string; packet: string }>()
  /** All that a reviewer who took no part is given: the description, the code and what Studio generates around it, the person's words for context, and nothing of the writing. */
  async function packetOf(work: GameplayWork) {
    const record = await readGameplay(work.directory, work.task.asset_id)
    if (record?.task_id !== work.task.id || !record.sheet) return missing()
    reviewableGameplay(record)
    const document = record.best?.fingerprint === record.rounds.at(-1)?.fingerprint ? GameplayDocumentSchema.safeParse(await readGameplayBest(work.directory, record)).data : undefined
    if (!document) throw new MakingRefusal(GAMEPLAY_REFUSALS.no_check)
    // What Studio generates around this gameplay and the AI's sources do not show: read from the source the build would write now.
    const generated = await gameplayContract(work.directory, document.uses, { asset_id: work.task.asset_id, document })
    // What already acts on the things it lists, from the same documents the writer was shown it from: so a repeat of what the thing or another gameplay does can be seen.
    const project = await openProject(work.directory)
    const already = alreadyForReview(project, document.uses, (await neighbours(work, project)).gameplays, work.task.asset_id)
    const version = fingerprint(document)
    const input = { judging: `玩法「${work.task.title}」：它的说明和它的代码（加上 Studio 自己生成的那部分）是不是一回事。`, description: gameplaySheet(document), code: { sources: document.sources, data: document.data, lang: document.lang }, ...(generated.length ? { generated } : {}), ...(already.length ? { already } : {}), ...(record.amendments?.length ? { amended: record.amendments.map((value) => ({ because: value.because || "没有写理由", changes: value.changes })) } : {}), ...(record.rounds.at(-1)?.check.advice?.length ? { noticed: record.rounds.at(-1)!.check.advice!.map(findingLine) } : {}), request: record.request }
    // Which packet this is: a version that failed a review of another packet may be reviewed once more.
    const packet = fingerprint({ instructions: GAMEPLAY_REVIEWER_INSTRUCTIONS, input })
    handed.set(work.task.id, { version, packet })
    return { instructions: GAMEPLAY_REVIEWER_INSTRUCTIONS, input, answer_schema: z.toJSONSchema(GameplayReviewAnswerSchema) as Record<string, unknown>, packet }
  }
  /** The hash of the packet a verdict answers: the one last handed out for this version, or (after a restart) the one that would be handed out now. */
  async function packetHash(work: GameplayWork) {
    const record = await readGameplay(work.directory, work.task.asset_id).catch(() => null)
    const known = handed.get(work.task.id)
    if (known && known.version === record?.rounds.at(-1)?.fingerprint) return known.packet
    return packetOf(work).then((made) => made.packet, () => undefined)
  }
  return {
    on,
    open,
    timing,
    step: gameplayStep,
    /** What a claimed task is told: the order of work, what it may attach to, the support code, and where it stands. */
    async context(work: GameplayWork) {
      const record = await open(work)
      const known = await things(work)
      return { discipline: gameplayDiscipline(known.target), api: gameplayApiWords(known.target), package_name: record.sheet ? gameplayPackage(known.mod_id, record.sheet.slug) : `${gameplayPackage(known.mod_id, "<slug>")}`, things: known.things, ...(known.planned.length ? { not_yet_described: known.planned } : {}), sheet: record.sheet, remark: record.remark, rounds_allowed: record.rounds_allowed, next_step: gameplayStep(record).next_step, no_game: GAMEPLAY_NO_GAME_WORDS }
    },
    /** The writer's description of this gameplay: what a reviewer reads and the person later tests by. */
    async describe(work: GameplayWork, sheet: unknown, because?: string) {
      await open(work)
      return change(work, (record) => describeGameplay(record, GameplaySheetSchema.parse(sheet), because))
    },
    /**
     * Check one version: bounds and references from the source and the project, then — only for code that
     * passed both — a real compile with everything the project generates. Refused, before anything is
     * compiled, when the loop does not allow a check. A compiler that could not run is a refusal too:
     * nothing was learnt, and no round is used up. A version that passes all three is kept whole, so it can
     * still be handed to the person if the loop ends without a pass.
     *
     * The compile is awaited here however long it takes; Studio's own AI simply waits. While it runs the
     * person is told after twenty seconds and then every minute that it is still going and for how long, and `stage` is told where it is.
     */
    async check(work: GameplayWork, input: unknown, signal?: AbortSignal, stage: (words: string) => void = () => undefined) {
      const document = GameplayDocumentSchema.parse(input)
      checkGate(await open(work), document)
      const project = await openProject(work.directory)
      const found = staticChecks(project, document, work.task.asset_id)
      await note(work, { kind: "check", mark: "run", ...about(work), text: `正在检查「${work.task.title}」的代码：有没有越界、引用对不对得上${found.bounds.length || found.references.length ? "" : "、能不能编译"}。`, step: true })
      const started = Date.now()
      const compile = options.compile
      const compiling = async (): Promise<CompileResult> => {
        if (!compile) return { ran: false, reason: NO_COMPILER }
        const at = { words: CHECK_STAGES.queued as string, told: false }
        // What the compile waits on is said where the person reads it: in the line itself, not only in the detail under it. Before, an outside AI was told
        // "preparing the first-time environment", "queued behind another compile" or "network broke, retrying" while the person saw only "checking for minutes".
        const tell = () => void note(work, { kind: "check", mark: "run", step: true, ...about(work), text: checkingLine(work.task.title, Date.now() - started, at.words), lines: [`${at.words}。`] })
        const say = (words: string) => {
          const changed = words !== at.words
          stage((at.words = words))
          // Once the first word has been said, a change of stage is said when it happens, not a minute later: that is when the person wonders whether it is stuck.
          if (changed && at.told) tell()
        }
        say(at.words)
        // The first word comes early, so an ordinary compile of under a minute is not silent; after that one a beat.
        const beat = { id: setTimeout(() => { at.told = true; tell(); beat.id = setInterval(tell, timing.beat) }, timing.early) }
        return inTurn(() => {
          say(CHECK_STAGES.preparing)
          return compile({ directory: work.directory, candidate: { asset_id: work.task.asset_id, title: work.task.title, document }, signal, onProgress: (text) => say(compileStage(text) ?? at.words) })
        }).finally(() => clearInterval(beat.id))
      }
      const compiled: CompileResult | null =
        found.bounds.length || found.references.length
          ? null
          : await compiling().catch(async (error: unknown) => {
              // Assembling everything the project generates stopped before any compiler ran, and said why in its own words (a creature whose ability names a part its model lacks is the usual case):
              // those words reach the writer and the person as they are, the stage says it stopped instead of staying at "preparing", and no round is used up, as for a compiler that could not run.
              const words = stopWords(error, project)
              stage(words === null ? CHECK_STAGES.failed : CHECK_STAGES.stopped)
              if (words === null) throw error
              await note(work, { kind: "check", mark: "fail", end: true, ...about(work), text: CHECK_STOPPED.person(work.task.title), lines: [words], ms: Date.now() - started })
              throw new MakingRefusal(CHECK_STOPPED.ai(words), false, CHECK_STOPPED.person(work.task.title))
            })
      if (compiled && !compiled.ran) {
        // Two reasons that are nobody's code are said in their own plain words instead of the tool's.
        const reason = compiled.reason.includes(CHECK_NETWORK_WORDS) ? CHECK_NETWORK_WORDS : compiled.reason.includes("ENVIRONMENT_BUSY") ? CHECK_CALLING.other : compiled.reason
        await note(work, { kind: "check", mark: "warn", end: true, ...about(work), text: `「${work.task.title}」的代码这一次没能编译。`, lines: [reason], ...(reason === compiled.reason ? {} : { detail: compiled.reason }), ms: Date.now() - started })
        throw new MakingRefusal(GAMEPLAY_REFUSALS.no_compiler(reason))
      }
      const check: GameplayCheck = { ...found, compile: compiled?.ran ? compiled.compile : null }
      if (floorPassed(check)) await writeGameplayBest(work.directory, work.task.asset_id, { task_id: work.task.id, fingerprint: fingerprint(document), document })
      const record = await change(work, (current) => checkedGameplay(current, document, check))
      const round = record.rounds.at(-1)!
      await note(work, {
        kind: "check",
        mark: round.passed ? "ok" : "fail",
        end: true,
        ...about(work),
        round: round.round,
        text: round.passed ? `「${work.task.title}」第 ${round.round} 版的代码检查通过：${CHECK_WORDS.compile.ok}、${CHECK_WORDS.bounds.ok}、${CHECK_WORDS.references.ok}。` : `「${work.task.title}」第 ${round.round} 版的代码没通过检查：${[check.bounds.length ? CHECK_WORDS.bounds.bad : "", check.references.length ? CHECK_WORDS.references.bad : "", check.compile && !check.compile.ok ? CHECK_WORDS.compile.bad : ""].filter(Boolean).join("、")}。`,
        // For the person: a sentence for each result that failed. What the checks quoted of the code is the detail, kept under 高级.
        lines: plainCheckLines(check),
        detail: [...(check.compile ? [`编译器：${check.compile.compiler}`] : []), ...checkLines(check)].join("\n"),
        ms: Date.now() - started,
      })
      return { record, round: round.round, passed: round.passed, check, lines: checkLines(check) }
    },
    /** What a reviewer who took no part is given (`packetOf`). */
    packet: packetOf,
    /** The reviewer's conclusion about the last version, kept with the hash of what it was given. */
    async review(work: GameplayWork, verdict: { passed: boolean; findings: string[]; advice?: string[]; technical?: string[]; independent: boolean; lacking?: string[] }) {
      const packet = await packetHash(work)
      const record = await change(work, (current) => reviewedGameplay(current, { ...verdict, ...(packet ? { packet } : {}) }))
      await note(work, { kind: "review", mark: verdict.passed ? "ok" : "warn", end: true, ...about(work), text: verdict.passed ? `评审核对了「${work.task.title}」的说明和代码：${CHECK_WORDS.said.ok}。` : `评审核对了「${work.task.title}」的说明和代码：${CHECK_WORDS.said.bad}。`, lines: [...verdict.findings.map((line) => `${FINDING_LABELS.blocking}：${line}`), ...(verdict.advice ?? []).map((line) => `${FINDING_LABELS.advice}：${line}`)], ...(verdict.technical?.length ? { detail: verdict.technical.join("\n") } : {}) })
      return record
    },
    /** Why this version may not be saved, or null. `kept` asks about the other way in: the best checked version, when the loop has ended without a pass. */
    gate: async (directory: string, task: Pick<RunTask, "id" | "asset_id">, document: unknown, kept = false) => {
      const found = await readGameplay(directory, task.asset_id)
      const record = found?.task_id === task.id ? found : null
      if (!kept) return gameplayCommitGate(record, fingerprint(document))
      return record && record.state !== "done" && record.best?.fingerprint === fingerprint(document) ? null : GAMEPLAY_REFUSALS.unchecked
    },
    /** The same refusal as `gate`, in the words the person is shown (no quoted code, no tool names); undefined when the gate is open. */
    plain: async (directory: string, task: Pick<RunTask, "id" | "asset_id">, document: unknown, kept = false) => {
      const found = await readGameplay(directory, task.asset_id)
      const record = found?.task_id === task.id ? found : null
      if (kept) return record && record.state !== "done" && record.best?.fingerprint === fingerprint(document) ? undefined : gameplayOwnWords(GAMEPLAY_REFUSALS.unchecked)
      return gameplayCommitGatePlain(record, fingerprint(document)) ?? undefined
    },
    /** The best version that passed the machine checks, with its document; null when there is none. */
    best: async (directory: string, task: Pick<RunTask, "id" | "asset_id">) => {
      const record = await readGameplay(directory, task.asset_id).catch(() => null)
      if (record?.task_id !== task.id || record.state === "done" || !record.best) return null
      const document = GameplayDocumentSchema.safeParse(await readGameplayBest(directory, record).catch(() => null)).data
      return document ? { document, round: record.best.round } : null
    },
    /** The version was saved. `kept`: not because the loop passed it, but so the person can judge it. Caller holds the project lock. */
    saved: async (directory: string, task: Pick<RunTask, "id" | "asset_id">, kept?: { said: string | null; technical?: string | null }) => {
      const record = await readGameplay(directory, task.asset_id)
      if (record?.task_id !== task.id) return
      await writeGameplayUnlocked(directory, kept ? keepGameplay(record, gameplayUnsatisfied(record, kept.said), gameplayUnsatisfiedTechnical(record, kept.technical ?? null)) : finishGameplay(record))
      await removeGameplayBest(directory, task.asset_id)
    },
    /** The task ended without saving. `failed` is false when it was called off. */
    ended: async (directory: string, task: Pick<RunTask, "id" | "asset_id">, failed = true) => {
      const record = await readGameplay(directory, task.asset_id).catch(() => null)
      if (record?.task_id === task.id && record.state !== "done") await changeGameplay(directory, task.asset_id, (latest) => stopGameplay(latest ?? record, failed)).catch(() => null)
      await removeGameplayBest(directory, task.asset_id).catch(() => null)
    },
    /** The record as the acceptance card shows it; null when none was kept (a gameplay from an imported project). */
    shown: async (directory: string, assetId: string) => {
      const record = await readGameplay(directory, assetId).catch(() => null)
      return record ? shownGameplay(record) : null
    },
    /** One step of an outside AI, with what comes next. */
    told: { check: checkTold, handoff: GAMEPLAY_REVIEWER_HANDOFF },
    /**
     * Studio's own AI, driven through the same loop an outside AI is held to: it writes the description,
     * then code; every version is checked; one that passes is read by a fresh request that knows nothing
     * of the writing; and only then does it go to the door.
     */
    async craft(job: {
      work: GameplayWork
      ask: <T extends z.ZodType>(schema: T, input: unknown, instructions: string, maxOutputTokens?: number) => Promise<z.output<T>>
      /** 「审查」: how the reviewer is asked (its own model when the person named one), or null when the switch is off. Left out: asked like the writer. */
      reviewer?: () => (<T extends z.ZodType>(schema: T, input: unknown, instructions: string) => Promise<z.output<T>>) | null
      step: (detail: string, state?: "running" | "validating" | "saving") => Promise<void>
      save: (document: GameplayDocument) => Promise<{ asset: unknown; review: AssetReview }>
      signal: AbortSignal
    }) {
      const work = job.work
      const begun = await open(work)
      const first = await things(work)
      // The description is only ever put in the record through this one step, whether it is first written or changed by the writer of the code.
      const describing = (value: unknown, because?: string) => this.describe(work, value, because)
      await job.step("正在写玩法说明。")
      const described = await describing(await job.ask(GameplaySheetSchema, { request: work.run.prompt, item: { title: work.task.title, brief: work.task.prompt }, things: first.things.map(({ accessor: _accessor, ...thing }) => thing), ...(first.planned.length ? { not_yet_described: first.planned } : {}), previous_sheet: begun.sheet, remark: begun.remark }, gameplaySheetInstructions(first.target)))
      // The description the code is written to: the one just written, and after that the one its writer asked for instead and Studio accepted (`sheet_change`).
      let sheet: GameplaySheet = described.sheet!
      type Before = { document: GameplayDocument; findings: string[]; reviewer: string[]; reviewer_advice: string[]; reviewer_technical?: string[] }
      const version = async (number: number, before?: Before): Promise<void> => {
        await job.step(`第 ${number} 版：正在照说明写代码。`)
        // Read again for every version: another gameplay may have been described or saved since.
        const known = await things(work)
        const code = await job.ask(
          GameplayWriterSchema,
          {
            sheet,
            package_name: gameplayPackage(known.mod_id, sheet.slug),
            things: known.things,
            ...(known.planned.length ? { not_yet_described: known.planned } : {}),
            limits: GAMEPLAY_LIMITS,
            making: { round: number, rounds_allowed: described.rounds_allowed },
            ...(before ? { revision_required: { document: { sources: before.document.sources, data: before.document.data, lang: before.document.lang }, findings: before.findings, reviewer_findings: before.reviewer, reviewer_advice: before.reviewer_advice, ...(before.reviewer_technical?.length ? { reviewer_technical: before.reviewer_technical } : {}) } } : {}),
          },
          gameplayWriterInstructions(known.target),
          32768,
        )
        const { sheet_change: asked, ...files } = code
        // A description the writer asks for instead is taken when the sheet's own rules take it (the same ones as for any description); when they do not, it stays as it was and the writer is told why with the next findings.
        const declined = asked && !isDeepStrictEqual(asked.sheet, sheet) ? await describing(asked.sheet, asked.because).then((record) => ((sheet = record.sheet!), null), (error: unknown) => (error instanceof MakingRefusal ? GAMEPLAY_SHEET_CHANGE_REFUSED(gameplayOwnWords(error.message)) : Promise.reject(error))) : null
        const held = declined ? [declined] : []
        const document = GameplayDocumentSchema.parse({ kind: "gameplay", ...sheet, ...files })
        await job.step(`第 ${number} 版：正在检查代码（越界、引用、编译）。`, "validating")
        const checked = await this.check(work, document, job.signal)
        // The same document again is the same version: asked to fix it, the model changed nothing.
        if (checked.round < number) throw new MakingRefusal(GAMEPLAY_REFUSALS.unchanged, true)
        if (!checked.passed) {
          if (checked.record.state === "stopped") throw new MakingRefusal(GAMEPLAY_REFUSALS.out_of_rounds(checked.record.rounds_allowed), true)
          return version(number + 1, { document, findings: [...held, ...checked.lines, ...(checked.check.advice ?? []).map(findingLine)], reviewer: [], reviewer_advice: [] })
        }
        const reviewer = job.reviewer ? job.reviewer() : job.ask
        await job.step(reviewer ? `第 ${number} 版：正在请没有参与编写的评审核对说明和代码。` : `第 ${number} 版：三项检查都过了（审查没有开，不另请评审）。`, "validating")
        // A fresh request: it is given the description and the code, and none of the writing. With 「审查」 off nobody else reads it, and the record says so.
        const packet = await this.packet(work)
        const judged = reviewer ? await reviewer(GameplayReviewAnswerSchema, packet.input, packet.instructions) : { passed: true, findings: [], advice: [], technical: [] as string[], lacking: [] }
        // Only blocking findings fail a review, whatever the reviewer put in `passed`.
        const concluded = await this.review(work, { passed: !judged.findings.length, findings: judged.findings, advice: judged.advice, technical: judged.technical, independent: Boolean(reviewer), lacking: judged.lacking })
        if (judged.findings.length) {
          if (concluded.state === "stopped") throw new MakingRefusal(GAMEPLAY_REFUSALS.out_of_rounds(concluded.rounds_allowed), true)
          return version(number + 1, { document, findings: held, reviewer: judged.findings, reviewer_advice: judged.advice, reviewer_technical: judged.technical })
        }
        await job.step("正在检查并写入工程资产。", "saving")
        // A version the save cannot store is not the end of the task (as for the looked kinds): one more version, with why, inside the same cap on versions.
        const result = await job.save(document).catch((error: unknown) => (error instanceof SaveRefusal ? error : Promise.reject(error)))
        if (!(result instanceof SaveRefusal) && result.asset) return
        // The standard found something at the door that the check had not (the project changed meanwhile): one more version, with what it said.
        return version(number + 1, { document, findings: [...held, ...(result instanceof SaveRefusal ? [result.message] : findingLines(told(result.review)))], reviewer: [], reviewer_advice: [] })
      }
      await version(1)
    },
  }
}
export type GameplayLoop = ReturnType<typeof createGameplayLoop>

export type WaitForGameplayCheck = <T>(settled: Promise<T>, ms: number) => Promise<T | null>

export const GAMEPLAY_CHECK_FRESH_MS = 10 * 60_000

export function finalGameplayCheck(record: GameplayRecord | null, task: RunTask, kept: number | null): RunTask["final_gameplay_check"] {
  const last = record?.rounds.at(-1)
  if (!record || record.task_id !== task.id || record.state !== "stopped" || !last || last.round < record.rounds_allowed) return undefined
  const review = record.review
  return {
    fingerprint: last.fingerprint,
    round: last.round,
    kept_round: kept,
    check_findings: checkLines(last.check),
    review_findings: review && !review.passed && review.fingerprint === last.fingerprint ? review.findings : [],
  }
}

export function finishedGameplayRefusal(run: ProjectRun, task: RunTask) {
  const final = task.final_gameplay_check!
  const archived = task.finished_at && Date.now() - Date.parse(task.finished_at) >= GAMEPLAY_CHECK_FRESH_MS
  const findings = final.review_findings.length
    ? `这一版代码检查通过，独立评审没有通过：${final.review_findings.join(" ")} `
    : `这一版没有通过代码检查，不能评审也不能提交：${final.check_findings.join(" ")} `
  const kept = final.kept_round ? GAMEPLAY_REFUSALS.kept(final.kept_round) : GAMEPLAY_REFUSALS.nothing_kept
  // The task may already be saved while the run's final status is still being written.
  const ending = run.tasks.every((value) => !["queued", "running", "validating", "saving"].includes(value.state)) ? { ...run, state: "completed" as const } : run
  return new MakingRefusal(`${archived ? "任务已结束。以下是最后一轮的结论。" : ""}${findings}${GAMEPLAY_REFUSALS.out_of_rounds(final.round)}${kept}${PARALLEL_WORDS.ended(ending)}`, true)
}

type Ids = { projectId: string; runId: string; taskId: string }
export type HeldGameplay = { ids: Ids; work: GameplayWork; draft: unknown; signal: AbortSignal }

/**
 * The steps of an outside AI on a gameplay task, over the same loop: `save_sheet`, `check_code` and
 * `final_review`. The runner supplies the task it holds, how a task ends and how a draft is shown; nothing
 * here knows how runs are stored. Each of `describe` and `review` answers null for a task that is not gameplay.
 */
export function externalGameplay(loop: GameplayLoop, runner: { held: (input: unknown) => Promise<HeldGameplay | null>; end: (input: Ids & { error: string }) => Promise<{ kept: number | null; run: ProjectRun }>; update: (input: Ids & { draft: unknown; detail: string }) => Promise<unknown>; /** Whether this task's reviews are held by a reviewing window of its own (「审查」 with two windows). Read at every step. */ apart?: (taskId: string) => boolean; waitForCheck?: WaitForGameplayCheck; /** Whether 「审查」 is off, so nobody but the writer reads the code. Read at every step. */ solo?: () => boolean }) {
  const stepOf = (record: GameplayRecord) => gameplayStep(record, Boolean(record.task_id && runner.apart?.(record.task_id)), Boolean(runner.solo?.()), PARALLEL_WORDS.ended(null))
  // A step that ended the loop for good also ends the task: the best checked version is kept for the person, or it is recorded as failed.
  const ended = (ids: Ids, checking = false) => async (error: unknown): Promise<never> => {
    if (!(error instanceof MakingRefusal) || !error.final) throw error
    const done = await runner.end({ ...ids, error: error.message.slice(0, 4000) }).catch(() => null)
    const task = checking && done?.run.tasks.find((value) => value.id === ids.taskId)
    if (done && task && task.final_gameplay_check) throw finishedGameplayRefusal(done.run, task)
    throw new MakingRefusal(`${error.message}${done?.kept ? GAMEPLAY_REFUSALS.kept(done.kept) : GAMEPLAY_REFUSALS.nothing_kept}${PARALLEL_WORDS.ended(done?.run)}`, true)
  }
  type Outcome = { value: { finished: true } & ReturnType<typeof gameplayStep> & { check: ReturnType<typeof loop.told.check> } } | { error: unknown }
  type Checking = { version: string; revision: number; started: number; stage: string; settled: Promise<Outcome>; outcome: Outcome | null }
  // The check under way, or the last one finished, of each task. In memory only: after a restart the version is simply checked again.
  const checks = new Map<string, Checking>()
  const begin = (held: HeldGameplay, given: unknown, version: string, revision: number) => {
    const run = async () => {
      const checked = await loop.check(held.work, given, held.signal, (words) => {
        if (entry.stage === words) return
        entry.stage = words
        // The task's own line, which the person reads beside it, says what the check waits on as it changes.
        void runner.update({ ...held.ids, draft: undefined, detail: `代码检查：${words}。` }).catch(() => undefined)
      }).catch(ended(held.ids))
      // The version just checked is also the draft Studio shows the person while the task runs.
      await runner.update({ ...held.ids, draft: given, detail: `第 ${checked.round} 版：代码检查${checked.passed ? "通过" : "没通过"}。` }).catch(() => undefined)
      if (checked.record.state === "stopped") await ended(held.ids, true)(new MakingRefusal(`${GAMEPLAY_REFUSALS.floor(checked.lines)}${GAMEPLAY_REFUSALS.out_of_rounds(checked.record.rounds_allowed)}`, true))
      return { finished: true as const, ...stepOf(checked.record), check: loop.told.check(checked.check) }
    }
    const entry: Checking = { version, revision, started: Date.now(), stage: CHECK_STAGES.reading, outcome: null, settled: Promise.resolve({ error: null }) }
    entry.settled = run().then((value): Outcome => ({ value }), (error: unknown): Outcome => ({ error })).then((outcome) => {
      if ("error" in outcome && outcome.error instanceof MakingRefusal && outcome.error.final) {
        setTimeout(() => { if (checks.get(held.ids.taskId) === entry) checks.delete(held.ids.taskId) }, GAMEPLAY_CHECK_FRESH_MS).unref()
      }
      return (entry.outcome = outcome)
    })
    checks.set(held.ids.taskId, entry)
    return entry
  }
  // The outcome if it comes within `ms`, else null. The timer never outlives the answer.
  const within = (settled: Promise<Outcome>, ms: number) => {
    const timer: { id?: ReturnType<typeof setTimeout> } = {}
    return Promise.race([settled, new Promise<null>((resolve) => (timer.id = setTimeout(() => resolve(null), ms)))]).finally(() => clearTimeout(timer.id))
  }
  return {
    /** `save_sheet` for gameplay: the description. */
    async describe(input: { sheet?: unknown }) {
      const held = await runner.held(input)
      if (!held) return null
      const record = await loop.describe(held.work, input.sheet)
      return { sheet: record.sheet, ...stepOf(record) }
    },
    /**
     * `check_code`: check one version and hand back what each check found, by file and line.
     *
     * The check runs on its own and the call only waits a little for it. One that is not finished answers
     * "still checking", and the same call again (same task, same content) comes back to that very check
     * instead of starting a compile. A finished result is kept, so asking again returns it at once, for as
     * long as the project has not changed since. Another version while one is being checked is refused: every
     * checked version uses up one of a few rounds, it could not compile beside the first anyway, and its
     * writer has not yet seen what the first one found — typically it is a client that timed out and tried
     * something else.
     */
    async check(input: { document?: unknown }, held: HeldGameplay | null) {
      if (!held) throw new MakingRefusal(GAMEPLAY_REFUSALS.not_gameplay)
      const given = input.document ?? held.draft
      if (given === undefined || given === null) throw new MakingRefusal(GAMEPLAY_REFUSALS.no_draft)
      const version = fingerprint(GameplayDocumentSchema.parse(given))
      const revision = (await openProject(held.work.directory)).revision
      const known = checks.get(held.ids.taskId)
      const record = await readGameplay(held.work.directory, held.work.task.asset_id).catch(() => null)
      // A kept result stands only while it is still what the record and the project say: the same version checked last, nothing saved since. One that does not
      // stand is checked again (cheap: bounds and references, assembling the files), and only its compile is reused, by the files it was given, not by the revision.
      // A check still running, or one that ended without a result and has not been told yet, is always the one asked after.
      const stale = !!known?.outcome && "value" in known.outcome && !(known.revision === revision && record?.task_id === held.ids.taskId && record.rounds.at(-1)?.fingerprint === version)
      const same = known?.version === version && !stale
      if (known && !same && !known.outcome) throw new MakingRefusal(CHECK_CALLING.busy(elapsedWords(Date.now() - known.started)))
      const current = known && same ? known : begin(held, given, version, revision)
      const outcome = current.outcome ?? (await (runner.waitForCheck ?? within)(current.settled, known && same ? loop.timing.again : loop.timing.first))
      if (!outcome) {
        const elapsed = elapsedWords(Date.now() - current.started)
        return { finished: false as const, state: "checking" as const, checking: { seconds: Math.round((Date.now() - current.started) / 1000), elapsed, stage: current.stage }, next_step: CHECK_CALLING.still(elapsed, current.stage) }
      }
      // Where the task stands is read now, after the check settled, never remembered: `record` above is from before the wait
      // (it would say "no version yet" of the very version just checked), and a review may have been recorded since a kept result.
      if ("value" in outcome) {
        const now = await readGameplay(held.work.directory, held.work.task.asset_id).catch(() => null)
        return now?.task_id === held.ids.taskId ? { ...outcome.value, ...stepOf(now) } : outcome.value
      }
      // A check that did not end in a result (no compiler, the network, a tool that broke) is told once; the same call after that starts afresh.
      if (!(outcome.error instanceof MakingRefusal && outcome.error.final) && checks.get(held.ids.taskId) === current) checks.delete(held.ids.taskId)
      throw outcome.error
    },
    /**
     * `final_review` for gameplay: without a verdict, what a reviewer is given; with one, its conclusion recorded.
     * `reviewer`: the call comes from the reviewing window. A verdict that ends the task is then recorded and the task ended for its
     * writer without the reviewer being told, as a writer is, to go on with the next batch.
     */
    async review(input: { verdict?: { passed: boolean; findings: string[]; advice?: string[]; technical?: string[]; independent: boolean; need?: unknown[]; lacking?: string[] }; need?: unknown[] }, reviewer = false) {
      const held = await runner.held(input)
      if (!held) return null
      if (input.need?.length || input.verdict?.need?.length) throw new MakingRefusal(GAMEPLAY_REFUSALS.no_need)
      if (!input.verdict) return { ...(await loop.packet(held.work)), how: runner.solo?.() ? GAMEPLAY_SOLO_VOICE.handoff : loop.told.handoff }
      // 「审查」 off: Studio knows nobody else exists, so a verdict that says somebody independent wrote it is refused, not recorded with a disclaimer.
      if (input.verdict.independent && runner.solo?.()) throw new MakingRefusal(SOLO_VOICE.independent)
      const record = await loop.review(held.work, { passed: input.verdict.passed, findings: input.verdict.findings, ...(input.verdict.advice ? { advice: input.verdict.advice } : {}), ...(input.verdict.technical?.length ? { technical: input.verdict.technical } : {}), independent: input.verdict.independent, ...(input.verdict.lacking?.length ? { lacking: input.verdict.lacking } : {}) }).catch(ended(held.ids))
      if (record.state === "stopped") {
        const final = new MakingRefusal(`独立评审没有通过。${GAMEPLAY_REFUSALS.out_of_rounds(record.rounds_allowed)}`, true)
        if (!reviewer) await ended(held.ids)(final)
        await runner.end({ ...held.ids, error: final.message.slice(0, 4000) }).catch(() => null)
      }
      return { review: record.review && { independent: record.review.independent, passed: record.review.passed, findings: record.review.findings, advice: record.review.advice ?? [] }, ...stepOf(record) }
    },
  }
}

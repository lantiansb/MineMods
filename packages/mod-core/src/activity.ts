import { appendFile, readFile, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { BUILD_STAGES } from "./build-stages"
import { BuildWarningSchema } from "./build-warnings"
import { readMaking, type MakingRecord } from "./making"
import { KEPT_WORDS, taskAsksForReview } from "./asset-status"
import { refusalForPerson, withheldWords } from "./refusal-words"
import { storagePath } from "./project"
import { blueprintSourceKey } from "./task-source"
import { claimedIdle, stoppedBehind, type ProjectRun, type RunTask } from "./workspace-runs"

/**
 * What is happening in a project, as a list of things that happened: planning, each task's steps, builds,
 * what the person did, and every call an outside AI makes. It is what the side panel shows. Events are only
 * ever added, the newest `ACTIVITY_LIMITS.events` are kept, and the file lies beside the project, so it
 * survives a restart and a project from before it existed is untouched.
 *
 * To add events from a new feature, call `noteActivity(directory, { kind, mark, item, title, text })`.
 * It never throws and never waits on the project lock, so it is safe from anywhere, including inside a
 * locked section. `text` is one plain sentence for a player; anything technical goes in `detail`, which the
 * panel shows only under 高级. Set `end` on the event that finishes a thing (made, failed, checked), and give
 * `key` to an event that might be reported twice: a key already in the log is not added again.
 */
export const ACTIVITY_LIMITS = { events: 1500, slack: 300, text: 300, lines: 6, line: 240, detail: 2000, archive: 256 * 1024, repeat: 60000 } as const

export const ActivityEventSchema = z.strictObject({
  /** Counts up by one for as long as the project lives; `readActivity(directory, after)` returns what came later. */
  seq: z.number().int().min(1),
  at: z.iso.datetime(),
  /** What sort of thing happened. `check` is for checks other features run on what was made. */
  kind: z.enum(["plan", "batch", "task", "look", "review", "build", "person", "tool", "check", "note"]),
  /** How the node reads: under way, went well, went wrong, worth a look, or plain information. */
  mark: z.enum(["run", "ok", "fail", "warn", "note"]),
  /** This event finishes what it is about: its `mark` is how the thing ended. */
  end: z.boolean().optional(),
  /** The overview item it concerns (`OverviewItem.id`), or null for something about the whole project. */
  item: z.string().max(200).nullable(),
  /** That item's name when it happened. */
  title: z.string().max(120).nullable(),
  /** One plain sentence. */
  text: z.string().min(1).max(ACTIVITY_LIMITS.text),
  /** A few plain lines under it: what a review found, why something was refused. */
  lines: z.array(z.string().max(ACTIVITY_LIMITS.line)).max(ACTIVITY_LIMITS.lines).optional(),
  /** The full build warning, including refs, for the build check in the activity panel. */
  build_warning: BuildWarningSchema.extend({ build_id: z.uuid() }).optional(),
  /** For 高级 only: the raw error, the tool's name, a path. */
  detail: z.string().max(ACTIVITY_LIMITS.detail).optional(),
  tool: z.string().max(80).optional(),
  /** How long it took, in milliseconds. */
  ms: z.number().int().min(0).optional(),
  /** Says what is being done right now. The panel shows only the newest of these for a thing, as its live line. */
  step: z.boolean().optional(),
  /** Another event already tells this to the person; shown only under 高级. */
  quiet: z.boolean().optional(),
  /**
   * On the event that ends a thing with a version kept for the person ("warn"): why it was kept. "unsatisfied": its AI, or its independent reviewer,
   * was not satisfied; "interrupted": the making was cut short. Absent in events written before this and on every other event. The top line counts
   * the two apart, because a kept version is saved but is not "已做好".
   */
  kept: z.enum(["unsatisfied", "interrupted"]).optional(),
  /** The round of the making story this belongs to. */
  round: z.number().int().min(1).optional(),
  /** A picture the making loop already keeps, by reference: nothing is copied. */
  picture: z.strictObject({ asset_id: z.uuid(), file: z.string().regex(/^[a-z0-9-]{1,40}\.(jpg|png)$/) }).optional(),
  /** The deletion this event offers to undo. The recovery record stays with the project. */
  undo_deletion: z.uuid().optional(),
  restored_deletion: z.uuid().optional(),
  key: z.string().max(200).optional(),
})
export type ActivityEvent = z.infer<typeof ActivityEventSchema>
export type ActivityInput = Omit<ActivityEvent, "seq" | "at"> & { at?: string }

const SEGMENTS = [".minemods", "activity.jsonl"]
export const ACTIVITY_ARCHIVE_PATH = SEGMENTS.join("/")

type Log = { size: number; events: ActivityEvent[]; keys: Set<string> }
// One queue per project in this process, so events land in the order they were reported.
const logs = new Map<string, { tail: Promise<unknown>; log: Log | null; alive: number }>()
const entry = (directory: string) => {
  const key = path.resolve(directory)
  const found = logs.get(key) ?? { tail: Promise.resolve(), log: null, alive: 0 }
  logs.set(key, found)
  return found
}

const parse = (text: string) =>
  text.split("\n").flatMap((line) => {
    const event = ActivityEventSchema.safeParse(line ? JSON.parse(line) : null)
    return event.success ? [event.data] : []
  })

// The file is read again whenever its size is not what this process last wrote: after a restart, or an import.
async function open(directory: string) {
  const state = entry(directory)
  const file = await storagePath(directory, SEGMENTS, true)
  const size = (await stat(file).catch(() => null))?.size ?? 0
  if (state.log && state.log.size === size) return { file, log: state.log }
  const events: ActivityEvent[] = size ? await readFile(file, "utf8").then(parse, () => []) : []
  const log: Log = { size, events, keys: new Set(events.flatMap((event) => (event.key ? [event.key] : []))) }
  state.log = log
  return { file, log }
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const lined = (lines: string[] = []) => lines.filter(Boolean).slice(0, ACTIVITY_LIMITS.lines).map((line) => cut(line, ACTIVITY_LIMITS.line))
const shaped = (input: ActivityInput, seq: number): ActivityEvent =>
  ActivityEventSchema.parse({
    ...input,
    seq,
    at: input.at ?? new Date().toISOString(),
    title: input.title === null ? null : cut(input.title, 120),
    text: cut(input.text.trim() || "（没有说明）", ACTIVITY_LIMITS.text),
    ...(input.lines ? { lines: lined(input.lines) } : {}),
    ...(input.detail ? { detail: cut(input.detail, ACTIVITY_LIMITS.detail) } : {}),
  })

async function add(directory: string, inputs: ActivityInput[]) {
  const { file, log } = await open(directory)
  const fresh = inputs.reduce<ActivityEvent[]>((made, input) => {
    const last = made.at(-1) ?? log.events.at(-1)
    // Reported before, or the very same call again within a minute (an outside AI polling): once is enough.
    if (input.key && (log.keys.has(input.key) || made.some((event) => event.key === input.key))) return made
    // A refusal with another reason reads the same in its first sentence and is not the same call: it is kept.
    if ((input.quiet || input.kind === "tool") && last?.kind === input.kind && last.text === input.text && last.item === input.item && (last.lines ?? []).join("\n") === lined(input.lines).join("\n") && Date.now() - Date.parse(last.at) < ACTIVITY_LIMITS.repeat) return made
    return [...made, shaped(input, (last?.seq ?? 0) + 1)]
  }, [])
  if (!fresh.length) return
  const lines = fresh.map((event) => `${JSON.stringify(event)}\n`).join("")
  await appendFile(file, lines, "utf8")
  log.events.push(...fresh)
  fresh.forEach((event) => event.key && log.keys.add(event.key))
  log.size += Buffer.byteLength(lines)
  if (log.events.length <= ACTIVITY_LIMITS.events + ACTIVITY_LIMITS.slack) return
  // Bounded: the oldest go, in one rewrite, once the slack is used up.
  const kept = log.events.slice(-ACTIVITY_LIMITS.events)
  const text = kept.map((event) => `${JSON.stringify(event)}\n`).join("")
  await writeFile(`${file}.tmp`, text, "utf8")
  await rename(`${file}.tmp`, file)
  entry(directory).log = { size: Buffer.byteLength(text), events: kept, keys: new Set(kept.flatMap((event) => (event.key ? [event.key] : []))) }
}

/** Something is alive in this project although nothing worth an event happened (text arriving from a model, a poll). */
export function pulseActivity(directory: string) {
  entry(directory).alive = Date.now()
}

/**
 * Add one event or several. See the note at the top of this file. `inputs` may be a function, for events
 * that have to be worked out in their place in the queue. Nothing here can fail the caller.
 */
export function noteActivity(directory: string, inputs: ActivityInput | ActivityInput[] | (() => Promise<ActivityInput[]>)): Promise<void> {
  const state = entry(directory)
  state.alive = Date.now()
  const done = state.tail.then(async () => add(directory, typeof inputs === "function" ? await inputs() : [inputs].flat())).catch(() => undefined)
  state.tail = done
  return done
}

/** Events after `after`, oldest first, and when anything in this project last gave a sign of life in this process. */
export async function readActivity(directory: string, after = 0) {
  const state = entry(directory)
  await state.tail
  const { log } = await open(directory)
  return { events: log.events.filter((event) => event.seq > after), last: log.events.at(-1)?.seq ?? 0, alive_at: Math.max(state.alive, Date.parse(log.events.at(-1)?.at ?? "") || 0) }
}

// A message with no Chinese in it was not written for the person: the plain sentence stands, the original goes to 高级. One with Chinese in it may still
// be a refusal written to the AI that has to act on it (its procedure: which call to make next, which field to write): the person's lines are its
// plain sentences, and the whole original goes to 高级 whenever anything was left out (broad19: 「abilities……hitbox……再自评、验收、提交」 read as the person's line).
const worded = (message: string | null | undefined, fallback: string) => {
  if (!message || !/[一-鿿]/.test(message)) return { lines: [fallback], ...(message ? { detail: message } : {}) }
  const said = refusalForPerson(message)
  if (!said.withheld) return { lines: said.lines.length ? said.lines : [message] }
  // Nothing of it is for the person: say that in a sentence instead of reading the procedure out.
  return { lines: said.lines.length ? [...said.lines, withheldWords(said.withheld)] : [fallback === "出了技术问题，原文在高级里。" ? withheldWords(said.withheld) : fallback], detail: message }
}

// The refusal that sent a version back is the acceptance standard's text for the maker: its finding is the person's line, the way out that names a field of the
// part sheet is the maker's (kept whole in 高级 when any of it is left out).
const backFromDoor = (message: string) => {
  const refusal = refusalForPerson(message)
  const lines = refusal.lines.slice(0, ACTIVITY_LIMITS.lines)
  if (!lines.length && !refusal.withheld) return {}
  return { lines: lines.length ? lines : [withheldWords(refusal.withheld)], ...(refusal.withheld ? { detail: message } : {}) }
}

const WORKING = ["running", "validating", "saving"]
// What the runner writes into a task's detail while text streams in from a model.
const NOISE = ["模型输出已接收", "模型进度："]
/** The overview item a run task is about: its plan entry when it has one, else the asset itself. */
export const taskItem = (task: Pick<RunTask, "source" | "asset_id">) => blueprintSourceKey(task.source) ?? task.asset_id
const itemOf = taskItem
// `filter().at(-1)` and not `findLast`: this file is also type-checked with the studio package's older library level.
const said = (run: ProjectRun, task: RunTask) => run.events.filter((event) => event.task_id === task.id).at(-1)?.message ?? null

/** Why a task is held back, when what it stands on stopped: which thing, and how it stopped. Null when nothing it stands on did. */
const heldWords = (tasks: RunTask[], task: RunTask) => {
  const behind = stoppedBehind(tasks, task)
  if (!behind.length) return null
  const how = behind.every((value) => value.state === "failed") ? "没做成" : behind.every((value) => value.state === "canceled") ? "被停下了" : "没做完"
  return `要用的${behind.map((value) => `「${value.title}」`).join("")}${how}，这一样先放着。`
}

/**
 * What a change of a run record means, as events. Pure: the runner calls it at the two places a run is
 * written, so every state a task passes through is reported once and no step can forget to.
 * A change of nothing but a task's detail (text arriving from a model) is not an event.
 */
export function runActivity(before: ProjectRun | null, after: ProjectRun): ActivityInput[] {
  const tasks = after.tasks.flatMap((task): ActivityInput[] => {
    const was = before?.tasks.find((value) => value.id === task.id)
    const about = { kind: "task" as const, item: itemOf(task), title: task.title }
    if (task.state === "queued") return []
    // The same state with new words: the step it is on now. Counts of characters received are a sign of life, not a step.
    if (was?.state === task.state && was.outcome === task.outcome)
      return was.detail === task.detail || !WORKING.includes(task.state) || NOISE.some((start) => task.detail.startsWith(start)) || !task.detail.trim() ? [] : [{ ...about, mark: "run", step: true, text: task.detail }]
    // An outside AI that has only taken the task has not started on it (`claimedIdle`): the first thing it hands in is the start.
    if (task.state === "running" && (!was || was.state === "queued")) return [claimedIdle(task) ? { ...about, mark: "note" as const, text: "领了任务，还没动手" } : { ...about, mark: "run" as const, text: "开始做" }]
    // Back from the door: the acceptance standard refused this version and it is being changed.
    if (task.state === "running") return [{ ...about, mark: "fail", text: task.detail || "没通过审查，正在按意见改。", ...(said(after, task) ? backFromDoor(said(after, task)!) : {}) }]
    if (task.state === "validating") return [{ ...about, mark: "run", step: true, text: task.detail || "做出来了，正在检查。" }]
    if (task.state === "saving") return [{ ...about, mark: "run", step: true, text: "正在检查并保存。" }]
    // Kept for the person although its AI was not satisfied, or because the making was cut short: saved, and said as that.
    if (task.state === "completed" && task.outcome)
      // Why it stopped is held to the same rule as why it failed: words that were not written for the person go to 高级.
      return [{ ...about, mark: "warn", end: true, kept: task.outcome === "kept_interrupted" ? ("interrupted" as const) : ("unsatisfied" as const), text: task.detail || "存下了目前最好的一版，等你自己看。", ...(said(after, task)?.replace(task.detail, "").trim() ? worded(said(after, task)!.replace(task.detail, "").trim(), "出了技术问题，原文在高级里。") : {}) }]
    // Waiting for the person is said only of a version the person is asked about (`taskAsksForReview`, the rule the card of the thing reads): the line and the card cannot disagree.
    if (task.state === "completed") return [{ ...about, mark: "ok", end: true, text: taskAsksForReview(task) ? "做好了，已经保存，等你验收。" : "做好了，已经保存。" }]
    if (task.state === "failed") return [{ ...about, mark: "fail", end: true, text: "这一样没做成。", ...worded(task.error, "出了技术问题，原文在高级里。") }]
    // Not made and not its own fault: plain information, so "warn" on a thing always means a version was kept for the person.
    // Held back by something it stands on that stopped: that is said, by name. Only a task with nothing of the kind behind it was cut off by the app closing.
    if (task.state === "blocked") return [{ ...about, mark: "note", end: true, text: heldWords(after.tasks, task) ?? (after.state === "interrupted" ? (task.started_at ? "做到一半，应用关掉了，这一样没有做完。" : "还没开始做，应用就关掉了。") : "它要用的东西没做成，这一样先放着。") }]
    return [{ ...about, mark: "note", end: true, text: "停下了，这一样没有做完。" }]
  })
  const whole = { kind: "batch" as const, item: null, title: null }
  const count = (state: RunTask["state"]) => after.tasks.filter((task) => task.state === state).length
  const names = after.tasks.map((task) => task.title)
  const begun: ActivityInput[] =
    !before && !after.tasks.length
      ? [{ ...whole, kind: "plan", mark: "run", text: "正在想这句话要做哪些东西。" }]
      : after.tasks.length && !before?.tasks.length
        ? [{ ...whole, mark: "run", text: `开始做这一批，一共 ${names.length} 样：${names.slice(0, 4).join("、")}${names.length > 4 ? "……" : ""}` }]
        : []
  const ended = (): ActivityInput[] => {
    if (before?.state === after.state || ["planning", "running"].includes(after.state)) return []
    if (after.state === "awaiting_input") return [{ ...whole, kind: "plan", mark: "warn", end: true, text: "AI 想先问你几件事。", lines: after.questions }]
    // Saved is not passed: a task that ended with a kept version (its AI was not satisfied, or it was cut short) is counted apart, as the overview does.
    const keptTasks = after.tasks.filter((task) => task.state === "completed" && task.outcome)
    const unsatisfied = keptTasks.filter((task) => task.outcome !== "kept_interrupted").length
    const interrupted = keptTasks.length - unsatisfied
    const held = [...(unsatisfied ? [KEPT_WORDS.unsatisfied(unsatisfied)] : []), ...(interrupted ? [KEPT_WORDS.interrupted(interrupted)] : [])]
    const passed = count("completed") - keptTasks.length
    if (after.state === "completed")
      return [{ ...whole, mark: held.length ? "warn" : "ok", end: true, text: held.length ? `这一批做完了，${passed} 样做好，${held.join("，")}。` : `这一批做完了，${count("completed")} 样都保存好了。` }]
    if (after.state === "partial") return [{ ...whole, mark: "warn", end: true, text: `这一批结束了：做好 ${passed} 样，${held.map((words) => `${words}，`).join("")}${count("failed")} 样没做成${count("blocked") ? `，${count("blocked")} 样被卡住` : ""}。` }]
    if (after.state === "canceled") return [{ ...whole, mark: "note", end: true, text: `停下了，这一批保存了 ${count("completed")} 样。` }]
    // Nothing on the page continues a batch cut off: an outside AI starts it again from its own window, Studio's own AI from 总览.
    if (after.state === "interrupted")
      return [{ ...whole, mark: "warn", end: true, text: `${after.tasks.some((task) => task.started_at) ? "上次做到一半，应用关掉了，已经交来的都存好了。" : "计划收到了，还没开始做，应用就关掉了。"}要接着做：用自己的 AI 助手的，回你的 AI 窗口说「继续」；用 Studio 自己的 AI 的，在总览里再开始一次。` }]
    return [{ ...whole, mark: "fail", end: true, text: "这一批没做成。", ...worded(after.error, "出了技术问题，原文在高级里。") }]
  }
  return [...begun, ...tasks, ...ended()]
}

/**
 * The steps of one making, read from the record the making loop already writes: sheet, each version looked
 * at, what its maker said, what the reviewer asked to see and concluded. Every event has a key, so reading
 * the same record again adds nothing. `about` is the overview item and its name.
 */
export function makingActivity(record: MakingRecord, about: { item: string; title: string }): ActivityInput[] {
  if (!record.task_id) return []
  const key = (part: string) => `making:${record.task_id}:${part}`
  const base = { item: about.item, title: about.title }
  const reviewedRound = record.review ? record.rounds.find((round) => round.fingerprint === record.review!.fingerprint) : undefined
  const reviewed = reviewedRound?.round
  // The review's line carries the picture of the version it looked at, so what passed is seen, not only named.
  const reviewedPicture = reviewedRound ? (reviewedRound.cover ?? reviewedRound.pictures[0]?.file) : undefined
  return [
    ...(record.described && record.sheet ? [{ ...base, kind: "task" as const, mark: "run" as const, key: key("sheet"), text: `写好了部件说明：${record.sheet.parts.length} 个部件。`, lines: record.sheet.recognisable.slice(0, 3) }] : []),
    ...record.rounds.flatMap((round): ActivityInput[] => {
      const picture = round.cover ?? round.pictures[0]?.file
      const review = round.self_review
      return [
        {
          ...base,
          kind: "look",
          mark: "run",
          key: key(`look:${round.round}`),
          at: round.at,
          round: round.round,
          text: `做出了第 ${round.round} 版，看了它的渲染图。`,
          ...(round.findings.length ? { lines: round.findings.slice(0, 4) } : {}),
          ...(picture ? { picture: { asset_id: record.asset_id, file: picture } } : {}),
        },
        ...(review
          ? [
              {
                ...base,
                kind: "review" as const,
                mark: review.verdict === "done" ? ("run" as const) : ("warn" as const),
                key: key(`self:${round.round}`),
                round: round.round,
                text: review.verdict === "done" ? `第 ${round.round} 版自己检查过，觉得可以了。` : `第 ${round.round} 版自己检查：还要改。`,
                lines: (review.verdict === "done" ? (review.advice ?? []) : [...review.problems, ...review.next]).slice(0, 4),
              },
            ]
          : []),
        ...Array.from({ length: round.asked ?? 0 }, (_, index) => ({ ...base, kind: "review" as const, mark: "run" as const, key: key(`asked:${round.round}:${index + 1}`), round: round.round, text: `审查员想再看几张图，补拍给它了（第 ${index + 1} 次）。` })),
      ]
    }),
    ...(record.review
      ? [
          {
            ...base,
            kind: "review" as const,
            mark: record.review.passed ? ("ok" as const) : ("fail" as const),
            key: key(`review:${record.review.at}`),
            at: record.review.at,
            ...(reviewed ? { round: reviewed } : {}),
            text: `${record.review.independent ? "没参与制作的审查员" : "做它的 AI 自己"}看了${reviewed ? `第 ${reviewed} 版` : ""}：${record.review.passed ? "通过。" : "没通过，有必须改的地方。"}`,
            lines: (record.review.passed ? (record.review.advice ?? []) : record.review.findings).slice(0, 4),
            ...(reviewedPicture ? { picture: { asset_id: record.asset_id, file: reviewedPicture } } : {}),
          },
        ]
      : []),
  ]
}

/** Read the making records of these assets and add whatever steps are not in the log yet. */
export function noteMakings(directory: string, about: { asset_id: string; item: string; title: string }[]) {
  return noteActivity(directory, async () => (await Promise.all(about.map(async (value) => makingActivity((await readMaking(directory, value.asset_id).catch(() => null)) ?? ({ task_id: null } as MakingRecord), value)))).flat())
}

/**
 * Called wherever a run record is written, with what it was and what it becomes. The making steps of the
 * tasks that moved are read first, so "looked at version 2" comes before "saved". Nothing is awaited.
 */
export function noteRun(directory: string, before: ProjectRun | null, after: ProjectRun) {
  const events = runActivity(before, after)
  if (!events.length) return pulseActivity(directory)
  const moved = after.tasks.filter((task) => events.some((event) => event.kind === "task" && event.item === itemOf(task)))
  void noteMakings(directory, moved.map((task) => ({ asset_id: task.asset_id, item: itemOf(task), title: task.title })))
  void noteActivity(directory, events)
}

/**
 * A stretch of build output as events: each stage the first time it shows, and each warning line.
 * `seen` is the caller's memory of what one build has already reported.
 */
export function buildActivity(output: string, seen: Set<string>): ActivityInput[] {
  const whole = { kind: "build" as const, item: null, title: null }
  const staged = BUILD_STAGES.flatMap(([pattern, text]): ActivityInput[] => {
    if (seen.has(text) || !pattern.test(output)) return []
    seen.add(text)
    return [{ ...whole, mark: "run", text }]
  })
  const warned = output.split(/\r?\n/).flatMap((line): ActivityInput[] => {
    if (!/\bwarning:/i.test(line) || seen.has(line) || seen.size > 64) return []
    seen.add(line)
    return [{ ...whole, mark: "warn", text: "打包时有一条提醒，不影响做出模组。", detail: line.trim() }]
  })
  return [...staged, ...warned]
}

/**
 * One build from start to end, for whoever runs it: pass `progress` every stretch of output, then call
 * `done` with where the file is, or `failed` with the error. A build that was stopped is said as that.
 */
export function buildWatch(directory: string) {
  const seen = new Set<string>()
  const whole = { kind: "build" as const, item: null, title: null }
  const started = Date.now()
  void noteActivity(directory, { ...whole, mark: "run", text: "开始把做好的东西做进模组。" })
  return {
    progress: (output: string) => void noteActivity(directory, buildActivity(output, seen)),
    done: (jar: string) => void noteActivity(directory, { ...whole, mark: "ok", end: true, text: `模组打包好了：${path.basename(jar)}`, lines: ["点「构建并试玩」旁边的导出，可以把它存到你想放的地方。"], detail: jar, ms: Date.now() - started }),
    failed: (error: unknown) =>
      void noteActivity(
        directory,
        error instanceof Error && error.message === "CANCELLED"
          ? { ...whole, mark: "note", end: true, text: "打包停下了。", ms: Date.now() - started }
          : { ...whole, mark: "fail", end: true, text: "模组没有打包成功。", ...worded(error instanceof Error ? error.message : String(error), "打包时出了技术问题，原文在高级里。"), ms: Date.now() - started },
      ),
  }
}

/** The log as an archive entry: the newest events that fit the budget. Empty when there is no log. */
export async function archivedActivity(directory: string): Promise<Record<string, Uint8Array>> {
  const lines = (await readActivity(directory)).events.map((event) => `${JSON.stringify(event)}\n`)
  // Walk back from the newest until the budget is spent; what is kept is one unbroken tail.
  const from = lines.reduceRight((state, line, index) => (state.full || state.bytes + Buffer.byteLength(line) > ACTIVITY_LIMITS.archive ? { ...state, full: true } : { bytes: state.bytes + Buffer.byteLength(line), from: index, full: false }), { bytes: 0, from: lines.length, full: false }).from
  return from < lines.length ? { [ACTIVITY_ARCHIVE_PATH]: new TextEncoder().encode(lines.slice(from).join("")) } : {}
}

/** Whether an archive entry is a log this app could have written. Throws on anything else. */
export function checkArchivedActivity(bytes: Uint8Array) {
  if (bytes.length > ACTIVITY_LIMITS.archive * 4) throw new Error("Activity log is too large")
  new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .split("\n")
    .filter(Boolean)
    .forEach((line) => ActivityEventSchema.parse(JSON.parse(line)))
}

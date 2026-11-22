import { z } from "zod"
import { ModelComplexitySchema } from "@minemods/studio-ai/model-quality"

import { blueprintSourceKey } from "./task-source"
import { ModuleKindSchema } from "./workspace"
export { ModuleKindSchema } from "./workspace"

export const PROJECT_RUN_LIMITS = { tasks: 12, parallel: 3, dependencies: 64 } as const

export const RouteTaskSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  module: ModuleKindSchema,
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(16000),
  source: z.string().trim().min(1).max(16000),
  dependencies: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(PROJECT_RUN_LIMITS.dependencies),
  target_id: z.uuid().nullable(),
})
export const RoutePlanSchema = z.strictObject({
  summary: z.string().trim().min(1).max(4000),
  tasks: z.array(RouteTaskSchema).max(PROJECT_RUN_LIMITS.tasks),
  questions: z.array(z.string().trim().min(1).max(1000)).max(8),
})
export const RunTaskSchema = RouteTaskSchema.extend({
  id: z.uuid(),
  asset_id: z.uuid(),
  state: z.enum(["queued", "running", "validating", "saving", "completed", "failed", "blocked", "canceled"]),
  detail: z.string().max(4000),
  error: z.string().max(4000).nullable(),
  /** Round 18: the technical detail behind `error` (which is written in plain words for the person), for 高级. Absent in older records. */
  error_technical: z.string().max(4000).optional(),
  /** Set on a completed task whose saved version the loop did not pass: kept for the person to judge, its AI not satisfied. */
  outcome: z.enum(["kept_unsatisfied", "kept_interrupted"]).optional(),
  /** The final rejected gameplay version, saved with the task so a repeat check can read it after the run closes. */
  final_gameplay_check: z.strictObject({
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    round: z.number().int().positive(),
    kept_round: z.number().int().positive().nullable(),
    check_findings: z.array(z.string()).max(192),
    review_findings: z.array(z.string()).max(64),
  }).optional(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
})
export const ProjectRunSchema = z.strictObject({
  id: z.uuid(),
  project_id: z.uuid(),
  prompt: z.string().trim().min(1).max(20000),
  state: z.enum(["planning", "awaiting_input", "running", "completed", "partial", "canceled", "failed", "interrupted"]),
  summary: z.string().max(4000),
  questions: z.array(z.string().max(1000)).max(8),
  tasks: z.array(RunTaskSchema).max(PROJECT_RUN_LIMITS.tasks),
  events: z
    .array(
      z.strictObject({
        id: z.number().int().nonnegative(),
        task_id: z.uuid().nullable(),
        time: z.iso.datetime(),
        message: z.string().max(4000),
      }),
    )
    .max(512),
  error: z.string().max(4000).nullable(),
  model_complexity: ModelComplexitySchema.nullable().default(null),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
})
export type RoutePlan = z.infer<typeof RoutePlanSchema>
export type RouteTask = z.infer<typeof RouteTaskSchema>
export type RunTask = z.infer<typeof RunTaskSchema>
export type ProjectRun = z.infer<typeof ProjectRunSchema>

export function validateRoutePlan(
  plan: RoutePlan,
  input: {
    prompt: string
    module?: z.infer<typeof ModuleKindSchema>
    assets: { id: string; module: z.infer<typeof ModuleKindSchema> }[]
    /** Hand-made content no asset stands for yet (see `legacyTargets`): a task may name it as the thing it changes, and its asset is made from it when the run starts. */
    legacy?: { id: string; module: z.infer<typeof ModuleKindSchema> }[]
    /** Entries of the project's confirmed blueprint that a task may be made from. */
    blueprint?: { key: string; kind: z.infer<typeof ModuleKindSchema> }[]
  },
) {
  const parsed = RoutePlanSchema.parse(plan)
  if (!parsed.tasks.length && !parsed.questions.length) throw new Error("路由没有任务或需要澄清的问题。")
  if (new Set(parsed.tasks.map((task) => task.key)).size !== parsed.tasks.length) throw new Error("路由包含重复任务。")
  const targets = parsed.tasks.flatMap((task) => (task.target_id ? [task.target_id] : []))
  if (new Set(targets).size !== targets.length) throw new Error("同一资产不能被多个并行任务修改。")
  parsed.tasks.forEach((task) => {
    if (input.module && task.module !== input.module) throw new Error("任务超出了当前模块。")
    // A task must trace back to the person's own words, or to an entry of the plan they confirmed.
    if (
      !input.prompt.includes(task.source) &&
      !input.blueprint?.some((entry) => entry.key === blueprintSourceKey(task.source) && entry.kind === task.module)
    )
      throw new Error("任务没有对应的原始需求，已拒绝执行。")
    if (task.target_id && ![...input.assets, ...(input.legacy ?? [])].some((asset) => asset.id === task.target_id && asset.module === task.module))
      throw new Error("路由指向不存在或不同模块的资产。")
    if (
      new Set(task.dependencies).size !== task.dependencies.length ||
      task.dependencies.some((key) => key === task.key || !parsed.tasks.some((item) => item.key === key))
    )
      throw new Error("路由包含无效依赖。")
  })
  const visit = (key: string, path: string[]) => {
    if (path.includes(key)) throw new Error("路由包含循环依赖。")
    parsed.tasks
      .find((task) => task.key === key)!
      .dependencies.forEach((dependency) => visit(dependency, [...path, key]))
  }
  parsed.tasks.forEach((task) => visit(task.key, []))
  return parsed
}

/**
 * The states in which a task holds one of the parallel places: claimed, not yet saved or given up. Studio's own
 * runner and the claim cap of an outside AI both count these, so the limit is one number in one place.
 */
export const HELD_STATES: readonly RunTask["state"][] = ["running", "validating", "saving"]

/** What a task says the moment an outside AI takes it, until the AI does anything with it (a draft, a progress report, a part sheet, a version looked at). */
export const CLAIMED_DETAIL = "外部模型已领取任务。"

/**
 * Taken by an outside AI and not touched since: the task holds a place in the run, but nothing is being made. Every kind is told the same way, so a thing is only
 * said to be written or made once its AI has handed in something; until then it is said as what it is, waiting for its turn (`queued`).
 */
export const claimedIdle = (task: Pick<RunTask, "state" | "detail">) => task.state === "running" && task.detail === CLAIMED_DETAIL

type Stood = Pick<RunTask, "id" | "key" | "state" | "dependencies">

/**
 * The queued tasks that can never start because something they stand on stopped (failed, canceled or itself held back), looking through
 * the whole chain and not only the first link: a task behind a task that is held back is held back too. A dependency the run does not
 * have counts as stopped, since nothing will ever make it. The runner marks these at once, so a run never ends with a task still queued.
 */
export function heldBack<T extends Stood>(tasks: readonly T[]): T[] {
  const stopped = new Set(tasks.filter((task) => ["failed", "blocked", "canceled"].includes(task.state)).map((task) => task.key))
  const keys = new Set(tasks.map((task) => task.key))
  const held = new Set<string>()
  for (let changed = true; changed; ) {
    changed = false
    for (const task of tasks)
      if (task.state === "queued" && !held.has(task.key) && task.dependencies.some((key) => stopped.has(key) || held.has(key) || !keys.has(key))) {
        held.add(task.key)
        changed = true
      }
  }
  return tasks.filter((task) => held.has(task.key))
}

/**
 * The tasks that stopped on their own account (failed or canceled) which this task, however indirectly, was waiting for. Empty when it
 * waited for nothing that stopped: what ended it was not a dependency (the app was closed in the middle of it).
 */
export function stoppedBehind<T extends Stood>(tasks: readonly T[], task: Pick<RunTask, "key" | "dependencies">): T[] {
  const seen = new Set<string>([task.key])
  const roots: T[] = []
  const visit = (keys: readonly string[]) =>
    keys.forEach((key) => {
      const upstream = tasks.find((value) => value.key === key)
      if (!upstream || seen.has(key)) return
      seen.add(key)
      if (upstream.state === "failed" || upstream.state === "canceled") roots.push(upstream)
      else if (upstream.state === "blocked") visit(upstream.dependencies)
    })
  visit(task.dependencies)
  return roots
}

type Steered = Pick<RunTask, "id" | "key" | "title" | "module" | "state" | "dependencies">
const brief = (task: Steered) => ({ task_id: task.id, key: task.key, title: task.title, module: task.module })

/**
 * What an outside AI can do about the parallel places of a run right now. The limit is `PROJECT_RUN_LIMITS.parallel`;
 * `free` is that minus the tasks it holds. `ready_now` are the tasks whose dependencies are all saved, as many as there
 * are free places, those that hold up the most other tasks first (the order they are claimed in decides how soon the
 * rest become ready). `ready_later` are ready as well but have no free place yet. `waiting` lists what each of the others
 * still waits for. A run that is not running offers nothing to claim.
 */
export function parallelPlan(run: { state: ProjectRun["state"]; tasks: readonly Steered[] }) {
  const held = run.tasks.filter((task) => HELD_STATES.includes(task.state))
  const free = Math.max(0, PROJECT_RUN_LIMITS.parallel - held.length)
  const saved = new Set(run.tasks.filter((task) => task.state === "completed").map((task) => task.key))
  const queued = run.tasks.filter((task) => task.state === "queued")
  const ready = run.state === "running" ? queued.filter((task) => task.dependencies.every((key) => saved.has(key))) : []
  // How many tasks wait, however indirectly, for one: finishing it first frees the most work.
  const holdsUp = (task: Steered, seen = new Set<string>()): number => {
    for (const other of queued) {
      if (!other.dependencies.includes(task.key) || seen.has(other.key)) continue
      seen.add(other.key)
      holdsUp(other, seen)
    }
    return seen.size
  }
  const ordered = ready.map((task) => ({ task, holds: holdsUp(task) })).sort((left, right) => right.holds - left.holds).map((value) => value.task)
  const titleOf = (key: string) => run.tasks.find((task) => task.key === key)?.title ?? key
  return {
    limit: PROJECT_RUN_LIMITS.parallel,
    free,
    claimed: held.map(brief),
    ready_now: ordered.slice(0, free).map(brief),
    ready_later: ordered.slice(free).map(brief),
    waiting: queued.filter((task) => !ready.includes(task)).map((task) => ({ ...brief(task), waits_for: task.dependencies.filter((key) => !saved.has(key)).map(titleOf) })),
  }
}
export type ParallelPlan = ReturnType<typeof parallelPlan>

const quoted = (tasks: readonly { title: string }[]) => tasks.map((task) => `「${task.title}」`).join("")

/**
 * What an outside AI is told to do with the parallel places, in the words of each moment. The numbers come from the plan,
 * which comes from the limit: nothing here repeats it. Measured on real projects, the AI held 1.7 of the places on average
 * and claimed what was ready late; these texts are where it is told to claim all that is ready at once and to work on
 * another task while one waits.
 */
export const PARALLEL_WORDS = {
  /**
   * The refusal of handing in a task whose dependency is being made again in a redo run of its own (B18-J-03): what it waits for, where to find it, and that
   * nothing has to be given up. Handing in before would save a task made against what is about to be replaced.
   */
  redoFirst: (title: string, redoing: readonly { title: string }[]) =>
    `「${title}」要用到的${quoted(redoing)}正在重做，重做提交以前不能提交「${title}」。不用放弃它（不要 fail_task）：重做是单独的一个运行，用 next_batch 能看到运行号，在那里 claim_task、重做、commit_task；提交了以后回到「${title}」，照重做好的样子再核对（需要的话重新看一版），然后再提交。`,
  /** The rule for the time a task waits for its independent review or a check: other claimed tasks are worked on. */
  meanwhile: "某个任务在等独立评审（await_inspection）或代码检查（check_code）的时候不要干等：去做另一个已经领了的任务，把等待的调用和别的任务的调用放在同一轮里一起发出去；手上没有别的任务时才单独等。",
  /** next_batch: the whole batch is in hand, and what can start now should all be claimed in one turn. */
  batch(plan: ParallelPlan) {
    const now = plan.ready_now
    const later = plan.waiting
    return [
      now.length
        ? `这一批现在就能开始的有 ${now.length} 个：${quoted(now)}。马上把它们全部领下来：在同一轮里同时调用 ${now.length} 次 claim_task（每个任务一次，taskId 见 parallel.ready_now），不要领一个、做完、再领下一个——同时最多做 ${plan.limit} 个，分开领会白白等时间。`
        : "这一批现在没有能立刻开始的任务；用 get_run 看一下。",
      now.length ? `领完一起做。${PARALLEL_WORDS.meanwhile}` : "",
      later.length ? `${quoted(later.slice(0, 6))}${later.length > 6 ? "等" : ""}要等别的任务提交以后才能领：每次 commit_task 的返回里 parallel.ready_now 会列出刚变得能领的，看到就马上领，让手上始终有 ${plan.limit} 个在做。` : "",
      "这一批全部结束以后再调用 next_batch。",
    ].filter(Boolean).join("")
  },
  /** After a claim, a commit or a task given up: where the places stand and what to claim next. */
  after(plan: ParallelPlan, run: Pick<ProjectRun, "state">) {
    if (run.state !== "running") return "这一批已经结束。调用 next_batch 看接下来做什么。"
    if (plan.ready_now.length) return `现在有 ${plan.free} 个空位，这些任务已经能领：${quoted(plan.ready_now)}。马上同时领下来（同一轮里每个调用一次 claim_task）。${plan.claimed.length ? PARALLEL_WORDS.meanwhile : ""}`
    if (plan.ready_later.length) return `${quoted(plan.ready_later)}已经能领，但 ${plan.limit} 个位置都占着：手上有一个提交了就马上领它。${PARALLEL_WORDS.meanwhile}`
    if (plan.claimed.length) return `手上还有 ${plan.claimed.length} 个在做：${quoted(plan.claimed)}。继续做。${plan.claimed.length > 1 ? PARALLEL_WORDS.meanwhile : ""}${plan.waiting.length ? `${quoted(plan.waiting.slice(0, 6))}要等它们提交，提交以后马上看返回里的 parallel.ready_now。` : ""}`
    return "现在没有能领的任务，手上也没有在做的：用 get_run 看看剩下的任务卡在哪。"
  },
  /**
   * After a task ended without a commit (its versions used up, given up, or kept for the person): what to call next, worked out from the
   * run as it now stands. A task of the batch that can be claimed is claimed; `next_batch` is named only when the batch is over. Before,
   * the ending always said `next_batch`, which Studio refused while the batch still had tasks. Without the run (it could not be read),
   * it says how to find out instead of guessing.
   */
  ended(run: (Pick<ProjectRun, "state"> & { tasks: readonly Steered[] }) | null | undefined): string {
    if (!run) return "接下来：用 get_run 看这一批的状态；还有任务能领就继续领，这一批全部结束以后才调用 next_batch。"
    return `接下来：${PARALLEL_WORDS.after(parallelPlan(run), run)}`
  },
} as const

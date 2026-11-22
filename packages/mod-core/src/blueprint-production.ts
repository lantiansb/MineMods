import { readFile } from "node:fs/promises"
import { z } from "zod"
import { blueprintTaskPrompt, handMade, nextBlueprintBatch, TASK_PROMPT_HEADINGS, taskTarget, type Blueprint, type HandRole } from "./blueprint"
import { currentReview, type RedoRequest, type Review } from "./reviews"
import { storagePath, withProjectLock, writeRecord } from "./project"
import { blueprintSource, blueprintSourceKey } from "./task-source"
import { PROJECT_RUN_LIMITS, RoutePlanSchema, type ProjectRun, type RoutePlan } from "./workspace-runs"
import type { ModuleKind } from "./workspace-modules"

/** An entry gets a first try and one retry. After that it stays failed until the person changes the plan. */
export const BLUEPRINT_ATTEMPTS = 2

/**
 * The little that production has to remember between batches and across a restart. What has been made is
 * never stored here: that is read from the plan's asset links and from the run records.
 */
export const ProductionRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  blueprint_revision: z.number().int().min(1),
  /** When this revision was confirmed. Failures from before belong to an earlier plan and no longer count. */
  since: z.iso.datetime(),
  /** Why production stopped by itself, in words for the person; null while there is nothing to say. */
  note: z.string().max(1000).nullable(),
  updated_at: z.iso.datetime(),
})
export type ProductionRecord = z.infer<typeof ProductionRecordSchema>

const SEGMENTS = [".minemods", "production.json"]

/** Null when nothing was recorded, or when the file cannot be read as a record: production then starts clean. */
export async function readProduction(directory: string) {
  const text = await readFile(await storagePath(directory, SEGMENTS), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "null"
    throw error
  })
  return ProductionRecordSchema.safeParse(await Promise.resolve(text).then(JSON.parse).catch(() => null)).data ?? null
}

/** Start counting afresh for a newly confirmed revision, or keep the count and only change the note. */
export async function writeProduction(directory: string, input: { blueprint_revision: number; note: string | null; restart?: boolean }) {
  return withProjectLock(directory, async () => {
    const current = await readProduction(directory)
    const updated_at = new Date().toISOString()
    const record = ProductionRecordSchema.parse({
      schema_version: 1,
      blueprint_revision: input.blueprint_revision,
      since: !input.restart && current?.blueprint_revision === input.blueprint_revision ? current.since : updated_at,
      note: input.note,
      updated_at,
    })
    await writeRecord(directory, SEGMENTS, record)
    return record
  })
}

export type ProductionInput = {
  blueprint: Blueprint
  assets: { id: string; module?: string }[]
  /** Any order. Only tasks made from a plan entry are looked at. */
  runs: Pick<ProjectRun, "state" | "created_at" | "tasks">[]
  record: ProductionRecord | null
}

/**
 * Where every entry that should be made stands. Direct production and an outside AI both decide what to
 * do next from this one answer.
 * - saved: its asset exists.
 * - failed: it failed on every allowed try; `reason` is the last error.
 * - blocked: not failed itself, but something it needs (named in `by`) failed, so it cannot start.
 * - waiting: can still be made, including an entry waiting for its retry.
 */
export function productionState(input: ProductionInput) {
  const since = input.record?.blueprint_revision === input.blueprint.revision ? input.record.since : ""
  const runs = input.runs.filter((run) => run.created_at >= since).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const entries = input.blueprint.entries.filter((entry) => !entry.out_of_scope)
  const saved = entries.filter((entry) => input.assets.some((asset) => asset.id === entry.asset_id)).map((entry) => entry.key)
  const failed = entries.flatMap((entry) => {
    const failures = runs.flatMap((run) => run.tasks.filter((task) => task.source === blueprintSource(entry.key) && task.state === "failed"))
    return !saved.includes(entry.key) && failures.length >= BLUEPRINT_ATTEMPTS
      ? [{ key: entry.key, reason: failures.at(-1)!.error ?? failures.at(-1)!.detail }]
      : []
  })
  // The failed entries an entry is waiting behind, looking through needs that are themselves still unmade.
  const behind = (key: string, path: string[]): string[] =>
    (entries.find((entry) => entry.key === key)?.needs ?? []).flatMap((need) => {
      if (saved.includes(need) || path.includes(need)) return []
      return failed.some((value) => value.key === need) ? [need] : behind(need, [...path, need])
    })
  const blocked = entries.flatMap((entry) => {
    const by = [...new Set(behind(entry.key, [entry.key]))]
    return !saved.includes(entry.key) && !failed.some((value) => value.key === entry.key) && by.length ? [{ key: entry.key, by }] : []
  })
  return {
    saved,
    failed,
    blocked,
    waiting: entries
      .map((entry) => entry.key)
      .filter((key) => !saved.includes(key) && !failed.some((value) => value.key === key) && !blocked.some((value) => value.key === key)),
    /** A batch is still being worked on, so the next one must wait. */
    live: input.runs.some(
      (run) => ["planning", "running"].includes(run.state) && run.tasks.some((task) => blueprintSourceKey(task.source) !== null),
    ),
  }
}

/** The next batch to make, or null when everything left is saved, failed for good, or blocked. */
export function nextProductionBatch(input: ProductionInput): RoutePlan | null {
  const state = productionState(input)
  return nextBlueprintBatch(
    {
      ...input.blueprint,
      // A link to an asset that has since been deleted must not be handed on as something to edit.
      entries: input.blueprint.entries.map((entry) => (entry.asset_id && !state.saved.includes(entry.key) ? { ...entry, asset_id: null } : entry)),
    },
    state.saved,
    state.failed.map((value) => value.key),
    // Which of the plan's `existing` ids are a creature's rules asset: the rest of the creatures it changes were made by hand (see `handMade`).
    new Set(input.assets.filter((asset) => asset.module === undefined || asset.module === "entity").map((asset) => asset.id)),
  )
}

const REDO_MARK = "玩家看过现在这一版，说："
const RETRY_MARK = "这一样之前没有做成，玩家想再试一次，并且说："
const REDO_DEFAULT = "这一版不太对，请重新做一版，要和现在这一版有明显的不同。"
const RETRY_DEFAULT = "请再做一次。"
const REDO_SUMMARY = "按玩家的意见重做"
const REDO_TAIL = "请在现有文档的基础上照这个意见重做，没有被提到的地方保持不变。"
/** The longest a task text may be (`RouteTaskSchema`). */
const TASK_PROMPT_LIMIT = 16000

// What `carryRemark` adds to a task that did not come from `redoBatch`: the task has an aim of its own, and the person's words are to be met beside it.
const SENT_BACK_MARK = "用户在 Studio 里打回了现在这一版，原话："
const ASKED_AGAIN_MARK = "这一样之前没有做成，用户在 Studio 里想让它再做一次，原话："
const SENT_BACK_DEFAULT = "这一版不太对，想让它重做。"
const CARRIED_TAIL = "这次连同上面的要求一起改掉；用户没提到的地方保持不变。"
const REMARK_MARKS = [REDO_MARK, RETRY_MARK, SENT_BACK_MARK, ASKED_AGAIN_MARK]

/** What the person said when they sent a thing back, read out of the task text `redoBatch` or `carryRemark` wrote; null for a task that carries none. */
export function redoRemark(prompt: string) {
  const mark = REMARK_MARKS.find((value) => prompt.includes(`\n${value}\n`))
  if (!mark) return null
  return [REDO_TAIL, CARRIED_TAIL, ...TASK_PROMPT_HEADINGS.map((heading) => `\n${heading}`)].reduce((text, end) => text.split(`\n${end}`)[0]!, prompt.split(`\n${mark}\n`).at(-1)!).trim().slice(0, 500) || null
}

/** A task text without what was said about an earlier version. */
const withoutRemark = (prompt: string) => REMARK_MARKS.reduce((text, mark) => text.split(`\n\n${mark}`)[0]!, prompt)

/**
 * A task that works on a thing the person is waiting to have redone, however it came to be (an outside AI's own `plan_run`, a task
 * claimed after the person sent the thing back), carries their words in its text, as a task `redoBatch` hands out does. The redo is
 * taken up by any task on that thing (`redoBatch` leaves out a thing a task is working on, and the verdict stops counting once a new
 * version is saved), so words not carried there were dropped without anyone having read them (2026-11-16, 蚩尤).
 * Waiting: the version the thing has now was sent back, or a never-made entry was asked for again and no run since took it up (the
 * overview's 「要重做」). `runs` are the other runs, never the one the task is in. The new task text, or null when there is nothing to
 * add or the text already carries what the person said.
 */
export function carryRemark(
  input: Pick<RedoInput, "blueprint" | "reviews" | "requests"> & { assets: { id: string; revision: number }[]; runs: Pick<ProjectRun, "created_at" | "tasks">[] },
  task: { prompt: string; source: string; target_id: string | null },
): string | null {
  if (redoRemark(task.prompt) !== null) return null
  const asset = task.target_id ? input.assets.find((value) => value.id === task.target_id) : undefined
  const review = asset ? currentReview(input.reviews, asset) : null
  const key = blueprintSourceKey(task.source)
  const entry = input.blueprint?.state === "confirmed" && key ? input.blueprint.entries.find((value) => value.key === key && !value.out_of_scope) : undefined
  const request =
    entry && !input.assets.some((value) => value.id === entry.asset_id)
      ? (input.requests ?? []).find((value) => value.key === key && !input.runs.some((run) => run.created_at >= value.at && run.tasks.some((other) => other.source === task.source)))
      : undefined
  const words = review?.verdict === "rejected" ? [SENT_BACK_MARK, review.note || SENT_BACK_DEFAULT] : request ? [ASKED_AGAIN_MARK, request.feedback || RETRY_DEFAULT] : null
  if (!words) return null
  const tail = ["", "", ...words, CARRIED_TAIL].join("\n")
  return `${task.prompt.slice(0, TASK_PROMPT_LIMIT - tail.length).trimEnd()}${tail}`
}

export type RedoInput = {
  blueprint?: Blueprint
  assets: { id: string; revision: number; module: ModuleKind; title: string; prompt: string }[]
  reviews: Review[]
  /** "Try once more" for plan entries that failed and were never made. */
  requests?: RedoRequest[]
  runs: Pick<ProjectRun, "state" | "created_at" | "tasks">[]
  /** Asset ids or entry keys to keep to; absent means everything the person asked to have redone. */
  only?: string[]
}

/**
 * What the person asked to have made again, as one batch: saved things they looked at and sent back are
 * remade in place, and failed entries they asked about get one more try. Their words travel in the task
 * prompt, apart from the brief and the shared style. What a task needs as context is not listed as a task
 * dependency: the runner hands every task its asset's own dependencies and what its plan entry needs.
 * One that is being made, or that was already tried since they asked, is left out: a redo that failed is
 * tried again only when the person asks again. Null when nothing is left.
 */
export function redoBatch(input: RedoInput): { prompt: string; plan: RoutePlan } | null {
  const tasks = input.runs.flatMap((run) => run.tasks.map((task) => ({ task, created_at: run.created_at, live: ["planning", "running"].includes(run.state) })))
  const busy = (own: typeof tasks) => own.some((value) => value.live && ["queued", "running", "validating", "saving"].includes(value.task.state))
  const wanted = (id: string) => !input.only || input.only.includes(id)
  const blueprint = input.blueprint?.state === "confirmed" ? input.blueprint : undefined
  const saved = new Set((blueprint?.entries ?? []).filter((entry) => input.assets.some((asset) => asset.id === entry.asset_id)).map((entry) => entry.key))
  const remakes = input.assets.flatMap((asset) => {
    const review = currentReview(input.reviews, asset)
    const entry = blueprint?.entries.find((candidate) => candidate.asset_id === asset.id && !candidate.out_of_scope)
    if (review?.verdict !== "rejected" || !(wanted(asset.id) || (entry && wanted(entry.key)))) return []
    const own = tasks.filter((value) => value.task.asset_id === asset.id)
    if (busy(own) || own.some((value) => value.task.state === "failed" && (value.task.finished_at ?? "") >= review.at)) return []
    const feedback = review.note || REDO_DEFAULT
    const words = ["", REDO_MARK, feedback, REDO_TAIL]
    return [
      {
        at: review.at,
        // A task must trace back to the plan or to the person's own words; outside the plan the words are their feedback.
        said: entry ? [] : [feedback],
        task: {
          key: entry?.key ?? `redo_${asset.id.replaceAll("-", "")}`,
          module: asset.module,
          title: entry?.title ?? asset.title,
          // Something outside the plan has only its own earlier prompt; what was said about an earlier version is dropped from it.
          prompt: entry ? blueprintTaskPrompt(blueprint!, entry, saved, words) : [withoutRemark(asset.prompt), ...words].join("\n"),
          source: entry ? blueprintSource(entry.key) : feedback,
          dependencies: [],
          target_id: asset.id,
        },
      },
    ]
  })
  const hand = blueprint ? handMade(blueprint, new Set(input.assets.filter((asset) => asset.module === "entity").map((asset) => asset.id))) : new Map<string, HandRole>()
  const retries = (blueprint ? (input.requests ?? []) : []).flatMap((request) => {
    const entry = blueprint!.entries.find((candidate) => candidate.key === request.key && !candidate.out_of_scope)
    // Nothing to stand on yet: an entry cannot be made before everything it needs is.
    if (!entry || !wanted(entry.key) || saved.has(entry.key) || !entry.needs.every((key) => saved.has(key))) return []
    const own = tasks.filter((value) => value.task.source === blueprintSource(entry.key))
    if (busy(own) || own.some((value) => value.created_at >= request.at)) return []
    return [
      {
        at: request.at,
        said: [],
        task: {
          key: entry.key,
          module: entry.kind,
          title: entry.title,
          prompt: blueprintTaskPrompt(blueprint!, entry, saved, ["", RETRY_MARK, request.feedback || RETRY_DEFAULT], hand.get(entry.key)),
          source: blueprintSource(entry.key),
          dependencies: [],
          // An entry that changes content already there is tried again on that content, never as a second thing beside it.
          target_id: taskTarget(entry, hand.get(entry.key)),
        },
      },
    ]
  })
  const chosen = [...remakes, ...retries].sort((a, b) => a.at.localeCompare(b.at)).slice(0, PROJECT_RUN_LIMITS.tasks)
  if (!chosen.length) return null
  return {
    prompt: [...(blueprint ? [blueprint.request] : []), ...chosen.flatMap((value) => value.said)].join("\n") || REDO_DEFAULT,
    plan: RoutePlanSchema.parse({ summary: `${REDO_SUMMARY} ${chosen.length} 项内容。`, questions: [], tasks: chosen.map((value) => value.task) }),
  }
}

/** Whether a run is one handed out by `redoBatch`, told from the summary it was given. */
export function isRedoRun(run: { summary: string }) {
  return run.summary.startsWith(REDO_SUMMARY)
}

type Walked = Pick<ProjectRun, "state" | "tasks">
type WalkedTask = ProjectRun["tasks"][number]
const UNFINISHED_TASK: readonly WalkedTask["state"][] = ["queued", "running", "validating", "saving"]

/**
 * The assets a task stands on, however indirectly: what the finished tasks it depends on in its run saved, and what the entries its own
 * plan entry needs have saved (a batch lists as dependencies only what is not saved yet, so a model saved by an earlier batch is
 * reached through the plan). Never the task's own asset.
 */
function standsOn(run: Pick<ProjectRun, "tasks">, task: Pick<WalkedTask, "dependencies" | "source" | "asset_id">, blueprint?: Pick<Blueprint, "entries">) {
  const assets = new Set<string>()
  const seen = new Set<string>()
  const wanted = new Set<string>()
  const visit = (keys: readonly string[]) =>
    keys.forEach((key) => {
      const dependency = run.tasks.find((value) => value.key === key)
      if (!dependency || seen.has(key)) return
      seen.add(key)
      if (dependency.state === "completed") assets.add(dependency.asset_id)
      const entry = blueprintSourceKey(dependency.source)
      if (entry) wanted.add(entry)
      visit(dependency.dependencies)
    })
  visit(task.dependencies)
  const own = blueprintSourceKey(task.source)
  if (own) wanted.add(own)
  const reach = (key: string, path: string[]) => {
    const entry = blueprint?.entries.find((value) => value.key === key)
    for (const need of entry?.needs ?? []) {
      if (path.includes(need)) continue
      const needed = blueprint?.entries.find((value) => value.key === need)
      if (needed?.asset_id) assets.add(needed.asset_id)
      reach(need, [...path, need])
    }
  }
  wanted.forEach((key) => reach(key, [key]))
  assets.delete(task.asset_id)
  return assets
}

/**
 * The assets that a batch still being worked on stands on: saved by a finished task of that batch, and used by a task of it
 * that is not finished. Making one of these again cannot wait for the batch to end, because the batch cannot end without the
 * task that uses it, and that task may be unable to finish before the thing it uses is made again (a creature whose model lacks
 * a motion it needs). A redo of anything else does wait: it holds nothing back.
 */
export function blockingAssets(runs: readonly Walked[], blueprint?: Pick<Blueprint, "entries">) {
  const assets = runs
    .filter((run) => ["planning", "running"].includes(run.state))
    .flatMap((run) => run.tasks.filter((task) => UNFINISHED_TASK.includes(task.state)).flatMap((task) => [...standsOn(run, task, blueprint)]))
  return [...new Set(assets)]
}

/**
 * The tasks of redo runs still being made that make again what a task stands on: that task is not handed in before they are, because
 * what it was made against is about to be replaced. Empty for a task that stands on nothing being redone.
 */
export function redoneBefore(runs: readonly (Walked & { summary: string })[], run: Pick<ProjectRun, "tasks">, task: Pick<WalkedTask, "dependencies" | "source" | "asset_id">, blueprint?: Pick<Blueprint, "entries">) {
  const assets = standsOn(run, task, blueprint)
  return runs
    .filter((value) => isRedoRun(value) && ["planning", "running"].includes(value.state))
    .flatMap((value) => value.tasks.filter((other) => UNFINISHED_TASK.includes(other.state) && assets.has(other.asset_id)))
}

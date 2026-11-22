import { handMade, taskTarget, type Blueprint, type BlueprintEntry } from "@minemods/mod-core/blueprint"
import { blueprintSource, blueprintSourceKey } from "@minemods/mod-core/task-source"
import { assetKind, type ModuleKind } from "@minemods/mod-core/workspace-modules"
import type { ExternalRoutePlan } from "../external"
import type { ProjectRun, RoutePlan, RouteTask } from "../project-runs"

const UNFINISHED: readonly ProjectRun["tasks"][number]["state"][] = ["queued", "running", "validating", "saving"]
const label = (kind: ModuleKind) => assetKind(kind).label

/** A task's `entry` refused: the words say what to write instead, and reach the outside AI as they are (`externalError`). */
export class EntryRefusal extends Error {}

/** What `plan_run` answers when a task's `entry` cannot be what the task makes. Each says what to write instead. */
export const ENTRY_REFUSALS = {
  noBlueprint: (task: string, key: string) => `任务「${task}」写了 entry「${key}」，但这个工程没有蓝图。不是在做蓝图里的条目的话，去掉 entry。`,
  unconfirmed: (task: string) => `蓝图还没有确认，任务「${task}」不能写 entry：确认之前不能做蓝图里的条目。`,
  missing: (task: string, key: string) => `任务「${task}」的 entry 写的是「${key}」，蓝图里没有这个 key 的条目。entry 写 get_blueprint 返回的 entries 里那一项的 key。`,
  outOfScope: (task: string, entry: BlueprintEntry) => `任务「${task}」的 entry「${entry.key}」（「${entry.title}」）在蓝图里标成了不制作，不能做。`,
  kind: (task: string, entry: BlueprintEntry, module: ModuleKind) => `任务「${task}」的 entry「${entry.key}」（「${entry.title}」）是${label(entry.kind)}（${entry.kind}），任务的 module 写的是 ${module}：两个要一样。`,
  source: (task: string, entry: BlueprintEntry, other: string) => `任务「${task}」的 source 指向条目「${other}」，entry 写的却是「${entry.key}」，对不上。带 entry 时 source 写 "blueprint:${entry.key}"。`,
  twice: (entry: BlueprintEntry) => `这份计划里有两个任务的 entry 都是「${entry.key}」（「${entry.title}」）：一个条目只能由一个任务来做。`,
  busy: (entry: BlueprintEntry, runId: string) => `「${entry.title}」正在运行 ${runId} 里做着（任务还没结束）：在那个运行里接着做完，不要再用 plan_run 另做一份。`,
  saved: (task: string, entry: BlueprintEntry, assetId: string) => `「${entry.title}」已经做好了（资产 ID ${assetId}）。任务「${task}」要改它的话 target_id 写这个 ID（或者写 null，Studio 会填上），不能指向别的东西。`,
  linked: (task: string, entry: BlueprintEntry, other: BlueprintEntry) => `任务「${task}」的 target_id 是蓝图条目「${other.title}」（${other.key}）做出来的东西，不能拿来当「${entry.title}」（${entry.key}）。`,
} as const

type Input = {
  blueprint: Blueprint | undefined
  assets: readonly { id: string; module: ModuleKind }[]
  /** The project's runs: an entry a task of a live run is still making is not made a second time beside it. */
  runs: readonly Pick<ProjectRun, "id" | "state" | "tasks">[]
}

/**
 * An outside AI's own plan, with every task that makes an entry of the confirmed blueprint turned into the task `next_batch` would have handed out for it:
 * its source names the entry, so what it saves is linked to that entry (`linkBlueprintTask`), and the overview shows the entry made instead of a failed entry
 * beside a second thing with no entry (2026-11-16, 蚩尤: 「戴上铜头铁额」 failed twice in `next_batch`, then the AI made it again with `plan_run`).
 *
 * A task says which entry it makes with `entry`, and anything wrong with that is refused with what to write instead. A task that does not say, and is not
 * already one of the plan's (source `blueprint:…`), is taken for an entry only when there is no doubt: exactly one entry not made yet, of the same kind, is
 * called what the task is called (its key, its title, or its brief as the task's text), the task makes a new thing (or the very thing the entry changes),
 * no other task of the plan is that entry, and no live run is making it. Otherwise the task is left exactly as it was.
 */
export function entryPlan(plan: ExternalRoutePlan, input: Input): RoutePlan {
  const confirmed = input.blueprint?.state === "confirmed" ? input.blueprint : undefined
  const made = (entry: BlueprintEntry) => (entry.asset_id && input.assets.some((asset) => asset.id === entry.asset_id && asset.module === entry.kind) ? entry.asset_id : null)
  // A link to something since deleted is not something to edit, as in `nextProductionBatch`.
  const entries = (confirmed?.entries ?? []).map((entry) => (made(entry) || !entry.asset_id ? entry : { ...entry, asset_id: null }))
  const hand = confirmed ? handMade({ entries }, new Set(input.assets.filter((asset) => asset.module === "entity").map((asset) => asset.id))) : new Map()
  const busy = (entry: BlueprintEntry) =>
    input.runs.find((run) => ["planning", "running"].includes(run.state) && run.tasks.some((task) => task.source === blueprintSource(entry.key) && UNFINISHED.includes(task.state)))
  const target = (entry: BlueprintEntry) => taskTarget(entry, hand.get(entry.key))

  const named = plan.tasks.map((task) => {
    if (task.entry === undefined) return null
    if (!input.blueprint) throw new EntryRefusal(ENTRY_REFUSALS.noBlueprint(task.title, task.entry))
    if (!confirmed) throw new EntryRefusal(ENTRY_REFUSALS.unconfirmed(task.title))
    const entry = entries.find((value) => value.key === task.entry)
    if (!entry) throw new EntryRefusal(ENTRY_REFUSALS.missing(task.title, task.entry))
    if (entry.out_of_scope) throw new EntryRefusal(ENTRY_REFUSALS.outOfScope(task.title, entry))
    if (entry.kind !== task.module) throw new EntryRefusal(ENTRY_REFUSALS.kind(task.title, entry, task.module))
    const other = blueprintSourceKey(task.source)
    if (other !== null && other !== entry.key) throw new EntryRefusal(ENTRY_REFUSALS.source(task.title, entry, other))
    const running = busy(entry)
    if (running) throw new EntryRefusal(ENTRY_REFUSALS.busy(entry, running.id))
    const saved = made(entry)
    if (saved && task.target_id !== null && task.target_id !== saved) throw new EntryRefusal(ENTRY_REFUSALS.saved(task.title, entry, saved))
    const owner = task.target_id === null ? undefined : entries.find((value) => value.key !== entry.key && value.asset_id === task.target_id)
    if (owner) throw new EntryRefusal(ENTRY_REFUSALS.linked(task.title, entry, owner))
    return entry
  })
  named.forEach((entry, index) => {
    if (entry && named.findIndex((value) => value?.key === entry.key) !== index) throw new EntryRefusal(ENTRY_REFUSALS.twice(entry))
  })

  const guessed = plan.tasks.map((task, index) => {
    if (named[index] || !confirmed || blueprintSourceKey(task.source) !== null) return null
    const found = entries.filter(
      (entry) =>
        !entry.out_of_scope &&
        entry.kind === task.module &&
        !made(entry) &&
        (entry.key === task.key || entry.title === task.title || entry.brief === task.source || entry.brief === task.prompt) &&
        (task.target_id === null || task.target_id === target(entry)),
    )
    return found.length === 1 && !busy(found[0]!) ? found[0]! : null
  })
  // An entry two tasks could be is neither's: which one makes it is not clear.
  const shared = (key: string, index: number) => named.some((value) => value?.key === key) || guessed.some((value, other) => other !== index && value?.key === key)
  const chosen = plan.tasks.map((_, index) => named[index] ?? (guessed[index] && !shared(guessed[index].key, index) ? guessed[index] : null))

  return {
    summary: plan.summary,
    questions: plan.questions,
    tasks: plan.tasks.map(({ entry: _entry, ...task }, index): RouteTask => {
      const entry = chosen[index]
      if (!entry) return task
      // A thing already made for the entry is changed where it stands, as `next_batch` hands it out; a new one is made (or the thing the entry changes is edited) otherwise.
      return { ...task, source: blueprintSource(entry.key), target_id: made(entry) ?? task.target_id ?? target(entry) }
    }),
  }
}

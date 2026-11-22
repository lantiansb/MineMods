import { noteActivity } from "@minemods/mod-core/activity"
import { linkBlueprintEntry } from "@minemods/mod-core/blueprint"
import { openProject, saveProjectUnlocked, withProjectLock, type Project } from "@minemods/mod-core/project"
import { blueprintSource, blueprintSourceKey } from "@minemods/mod-core/task-source"
import type { ProjectRun } from "@minemods/mod-core/workspace-runs"
import { readRuns } from "./title-repair"

/**
 * Links a plan entry to the thing an outside AI made for it with a plan of its own, from before `plan_run` took a task for the entry it makes (`entryPlan`).
 * 2026-11-16, 蚩尤: 「戴上铜头铁额」 failed twice in `next_batch`, the AI made it again with `plan_run`, and the overview showed the entry failed with nothing
 * made, beside the new thing with no entry.
 *
 * It only acts where the records leave no doubt, and otherwise leaves the project exactly as it is:
 *  - the plan is confirmed, the entry is to be made and nothing that exists is linked to it;
 *  - the entry was handed out (a task named it as its source) before the run that made the thing was started;
 *  - that thing was made new (no `target_id`) by a finished task that names no entry, of the entry's kind, with the entry's key or title, and it still exists,
 *    is linked to no entry and is not what an entry changes;
 *  - exactly one such thing is found for the entry, and it is found for no other entry.
 * Only the link changes. Once linked the entry is made, so running it again finds nothing.
 */
export type EntryLinkRepair = { key: string; asset_id: string; title: string }

export function entryLinkRepairs(input: { project: Pick<Project, "workspace" | "blueprint">; runs: readonly Pick<ProjectRun, "created_at" | "tasks">[] }): EntryLinkRepair[] {
  const blueprint = input.project.blueprint
  if (blueprint?.state !== "confirmed") return []
  const assets = input.project.workspace.assets
  const linked = new Set(blueprint.entries.flatMap((entry) => (entry.asset_id && assets.some((asset) => asset.id === entry.asset_id) ? [entry.asset_id] : [])))
  const changed = new Set(blueprint.entries.flatMap((entry) => (entry.existing?.action === "change" ? [entry.existing.id] : [])))
  const tasks = input.runs.flatMap((run) => run.tasks.map((task) => ({ run, task })))
  const found = blueprint.entries.flatMap((entry): EntryLinkRepair[] => {
    if (entry.out_of_scope || (entry.asset_id && linked.has(entry.asset_id))) return []
    const handed = tasks.filter(({ task }) => task.source === blueprintSource(entry.key)).map(({ run }) => run.created_at).sort()[0]
    if (handed === undefined) return []
    const made = tasks.filter(
      ({ run, task }) =>
        run.created_at > handed &&
        task.state === "completed" &&
        task.target_id === null &&
        blueprintSourceKey(task.source) === null &&
        task.module === entry.kind &&
        (task.key === entry.key || task.title === entry.title) &&
        assets.some((asset) => asset.id === task.asset_id && asset.module === entry.kind) &&
        !linked.has(task.asset_id) &&
        !changed.has(task.asset_id),
    )
    const ids = [...new Set(made.map(({ task }) => task.asset_id))]
    return ids.length === 1 ? [{ key: entry.key, asset_id: ids[0]!, title: entry.title }] : []
  })
  return found.filter((repair) => found.filter((other) => other.asset_id === repair.asset_id).length === 1)
}

/**
 * Makes the links `entryLinkRepairs` is sure of, once for the project, saved under the project lock, and says so for each in the activity panel. Best effort:
 * opening a project must never fail because of it, so a record it cannot read, or a link the plan's rules turn down, means no repair.
 */
export async function repairEntryLinks(directory: string): Promise<EntryLinkRepair[]> {
  try {
    const repaired = await withProjectLock(directory, async () => {
      const project = await openProject(directory)
      const found = entryLinkRepairs({ project, runs: await readRuns(directory, project.id) })
      if (!found.length) return []
      const next = found.reduce((value, repair) => linkBlueprintEntry(value, repair.key, repair.asset_id), project)
      await saveProjectUnlocked(directory, next, project.revision)
      return found
    })
    await noteActivity(
      directory,
      repaired.map((repair) => ({ kind: "note" as const, mark: "note" as const, item: repair.key, title: repair.title, text: `「${repair.title}」接上了蓝图里的条目：AI 之前另外重做了它，做好的那一样现在算作这个条目`, key: `entry-linked:${repair.key}:${repair.asset_id}` })),
    )
    return repaired
  } catch {
    return []
  }
}

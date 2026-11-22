import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { noteActivity, readActivity, type ActivityEvent } from "@minemods/mod-core/activity"
import { openProject, saveProjectUnlocked, storagePath, withProjectLock, type Project } from "@minemods/mod-core/project"
import { ProjectRunSchema, type ProjectRun } from "@minemods/mod-core/workspace-runs"

/**
 * Repairs the names that a revising task once wrote over an asset's own (before `makeAsset` kept an existing title): an effect
 * first called 「地面霜痕」 and then saved by a task named 「地面霜痕修订」 was listed, and named in the guide, as the latter.
 *
 * It only acts where the records leave no doubt, and otherwise leaves the asset exactly as it is:
 *  - the version the project holds was saved by a task that revised the asset (`target_id` is the asset) and the asset's
 *    title is that task's title to the letter, and nothing has saved the asset since (a hand edit saves it later than the
 *    task finished, and a person's act on it is in the activity log);
 *  - the title it had at the start is known: the task that created it, or else the plan entry that stands for it, and the
 *    two do not disagree.
 * It restores the title only. The document and the asset's revision are what they were. Once restored, the title no longer
 * is the revising task's, so running it again finds nothing.
 */
export type TitleRepair = { asset_id: string; item: string; from: string; to: string; key: string }

export function titleRepairs(input: { project: Pick<Project, "workspace" | "blueprint">; runs: readonly ProjectRun[]; events: readonly Pick<ActivityEvent, "kind" | "item" | "at">[] }): TitleRepair[] {
  const tasks = input.runs.flatMap((run) => run.tasks.map((task) => ({ run, task })))
  return input.project.workspace.assets.flatMap((asset): TitleRepair[] => {
    const maker = input.runs.find((run) => run.id === asset.provenance.request_id)
    // The saves of this asset by that run that nothing has come after: exactly one, or it is not clear which one named it.
    const saved = (maker?.tasks ?? []).filter((task) => task.asset_id === asset.id && task.state === "completed" && task.finished_at !== null && task.finished_at >= asset.updated_at)
    const revision = saved.length === 1 && saved[0]!.target_id === asset.id && saved[0]!.title === asset.title ? saved[0]! : null
    if (!revision) return []
    const entries = (input.project.blueprint?.entries ?? []).filter((entry) => entry.asset_id === asset.id)
    // A plan entry that is called what the asset is called says the title is the plan's own name for it.
    if (entries.length > 1 || entries.some((entry) => entry.title === asset.title)) return []
    const creators = tasks.filter(({ task }) => task.asset_id === asset.id && task.target_id === null && task.state === "completed" && task.finished_at !== null).sort((a, b) => a.task.finished_at!.localeCompare(b.task.finished_at!))
    const created = creators[0]?.task.title ?? null
    const planned = entries[0]?.title ?? null
    if (created !== null && planned !== null && created !== planned) return []
    const original = created ?? planned
    if (original === null || original === asset.title) return []
    const item = entries[0]?.key ?? asset.id
    // A person who acted on it after the task (a hand edit, a rename, a redo) is not told apart from a name they chose.
    if (input.events.some((event) => event.kind === "person" && (event.item === asset.id || event.item === item) && event.at >= revision.finished_at!)) return []
    return [{ asset_id: asset.id, item, from: asset.title, to: original, key: `title-restored:${asset.id}:${revision.id}` }]
  })
}

export async function readRuns(directory: string, projectId: string) {
  const folder = path.dirname(await storagePath(directory, [".minemods", "runs", `${randomUUID()}.json`]))
  const files = (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name))
  const runs = await Promise.all(
    files.map(async (entry) => {
      const parsed = ProjectRunSchema.safeParse(JSON.parse(await readFile(await storagePath(directory, [".minemods", "runs", entry.name]), "utf8")))
      return parsed.success && parsed.data.project_id === projectId ? [parsed.data] : []
    }),
  )
  return runs.flat()
}

/**
 * Restores the titles `titleRepairs` is sure of, once for the project, saved under the project lock, and says so for each in the
 * activity panel. Best effort: opening a project must never fail because of it, so a record it cannot read means no repair.
 */
export async function repairTitles(directory: string): Promise<TitleRepair[]> {
  try {
    const repaired = await withProjectLock(directory, async () => {
      const project = await openProject(directory)
      const found = titleRepairs({ project, runs: await readRuns(directory, project.id), events: (await readActivity(directory)).events })
      if (!found.length) return []
      const to = new Map(found.map((repair) => [repair.asset_id, repair.to]))
      // Only the title changes: the asset keeps its revision and its time, so nothing that went by them looks changed.
      await saveProjectUnlocked(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (to.has(asset.id) ? { ...asset, title: to.get(asset.id)! } : asset)) } }, project.revision)
      return found
    })
    await noteActivity(
      directory,
      repaired.map((repair) => ({ kind: "note" as const, mark: "note" as const, item: repair.item, title: repair.to, text: `名字恢复成「${repair.to}」：之前被修订任务的名字「${repair.from}」盖掉了`, key: repair.key })),
    )
    return repaired
  } catch {
    return []
  }
}

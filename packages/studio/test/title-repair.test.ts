import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readActivity } from "@minemods/mod-core/activity"
import { createProject, openProject, saveProject, writeRecord } from "@minemods/mod-core/project"
import { WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { savedStatus } from "@minemods/mod-core/workspace-modules"
import { ProjectRunSchema } from "@minemods/mod-core/workspace-runs"
import { repairTitles, titleRepairs } from "../src/main/title-repair"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute)).toISOString()
const id = () => crypto.randomUUID()

/** A run holding one completed task for an asset: the one that created it (`target_id` null) or one that revised it. */
const run = (project_id: string, asset_id: string, task: { title: string; creates: boolean; finished: number }, runId = id()) =>
  ProjectRunSchema.parse({
    id: runId,
    project_id,
    prompt: "做宝石",
    state: "completed",
    summary: "",
    questions: [],
    tasks: [
      {
        key: "gem",
        module: "item",
        title: task.title,
        prompt: "做宝石",
        source: "做宝石",
        dependencies: [],
        target_id: task.creates ? null : asset_id,
        id: id(),
        asset_id,
        state: "completed",
        detail: "",
        error: null,
        started_at: at(task.finished - 1),
        finished_at: at(task.finished),
      },
    ],
    events: [],
    error: null,
    created_at: at(task.finished - 1),
    updated_at: at(task.finished),
  })

const gem = async () => (await Bun.file(new URL("../../mod-core/test/fixtures/acceptance/good/gem-item.json", import.meta.url)).json()).document

/** A project whose gem was created by 「宝石」 at minute 1 and saved by the revising task 「宝石修订」 at minute 5. */
async function polluted(change: { title?: string; updated?: number; creating?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-title-repair-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "名字测试", description: "" })
  const assetId = id()
  const revising = run(created.id, assetId, { title: "宝石修订", creates: false, finished: 5 })
  const runs = [revising, ...(change.creating === false ? [] : [run(created.id, assetId, { title: "宝石", creates: true, finished: 1 })])]
  await Promise.all(runs.map((value) => writeRecord(directory, [".minemods", "runs", `${value.id}.json`], value)))
  const asset = WorkspaceAssetSchema.parse({
    id: assetId,
    module: "item",
    title: change.title ?? "宝石修订",
    revision: 2,
    created_at: at(1),
    updated_at: at(change.updated ?? 4),
    prompt: "改淡一点",
    dependencies: [],
    document: await gem(),
    provenance: { model: "m", request_id: revising.id },
    status: savedStatus("item", "fabric-1.21.1"),
  })
  await saveProject(directory, { ...created, workspace: { assets: [asset] } }, created.revision)
  return { directory, assetId, asset, runs }
}

test("被修订任务的名字盖掉的名字，恢复成最初那个任务给的名字，内容和版本号不动", async () => {
  const { directory, assetId, asset } = await polluted()
  const before = await openProject(directory)
  const repaired = await repairTitles(directory)
  expect(repaired).toMatchObject([{ asset_id: assetId, from: "宝石修订", to: "宝石" }])
  const after = await openProject(directory)
  expect(after.workspace.assets).toEqual([{ ...asset, title: "宝石" }])
  expect(after.workspace.assets[0]).toMatchObject({ revision: 2, updated_at: asset.updated_at })
  expect(after.revision).toBe(before.revision + 1)
  const events = (await readActivity(directory)).events
  expect(events.filter((event) => event.item === assetId)).toMatchObject([{ kind: "note", text: "名字恢复成「宝石」：之前被修订任务的名字「宝石修订」盖掉了" }])
})

test("再跑一次什么都不变", async () => {
  const { directory } = await polluted()
  expect(await repairTitles(directory)).toHaveLength(1)
  const once = await openProject(directory)
  const noted = (await readActivity(directory)).events.length
  expect(await repairTitles(directory)).toEqual([])
  expect(await openProject(directory)).toEqual(once)
  expect((await readActivity(directory)).events.length).toBe(noted)
})

test("人在修订之后自己改过的名字不动", async () => {
  // Renamed by hand: the title is no longer the revising task's…
  const renamed = await polluted({ title: "我的宝石", updated: 7 })
  expect(await repairTitles(renamed.directory)).toEqual([])
  expect((await openProject(renamed.directory)).workspace.assets[0]!.title).toBe("我的宝石")
  // …and a hand edit that left the name alone, but saved the asset after the task finished, is not told apart from a chosen name.
  const edited = await polluted({ updated: 7 })
  expect(await repairTitles(edited.directory)).toEqual([])
  expect((await openProject(edited.directory)).workspace.assets[0]!.title).toBe("宝石修订")
  // The person's own act in the activity log after the task is the same.
  const noted = await polluted()
  const { noteActivity } = await import("@minemods/mod-core/activity")
  await noteActivity(noted.directory, { kind: "person", mark: "note", item: noted.assetId, title: "宝石修订", text: "你自己改了「宝石修订」。", at: at(9) })
  expect(await repairTitles(noted.directory)).toEqual([])
  expect((await openProject(noted.directory)).workspace.assets[0]!.title).toBe("宝石修订")
})

test("没有创建它的任务记录时不动", async () => {
  const { directory } = await polluted({ creating: false })
  const before = await openProject(directory)
  expect(await repairTitles(directory)).toEqual([])
  expect(await openProject(directory)).toEqual(before)
})

test("创建任务的记录没有，蓝图条目的名字是第二来源；两处对不上或条目就叫现在的名字则不动", async () => {
  const { directory, asset, runs } = await polluted({ creating: false })
  const project = await openProject(directory)
  const entry = (title: string) => ({ key: "gem", asset_id: asset.id, title })
  const found = (entries: { key: string; asset_id: string; title: string }[], more = runs) => titleRepairs({ project: { ...project, blueprint: { entries } as never }, runs: more, events: [] })
  expect(found([entry("宝石")])).toMatchObject([{ to: "宝石", item: "gem" }])
  expect(found([entry("宝石修订")])).toEqual([])
  const created = run(project.id, asset.id, { title: "小宝石", creates: true, finished: 1 })
  expect(found([entry("宝石")], [...runs, created])).toEqual([])
  expect(found([], [...runs, created])).toMatchObject([{ to: "小宝石" }])
})

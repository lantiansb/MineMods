import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openProject, saveProject, storagePath, writeRecord } from "@minemods/mod-core/project"
import { BLUEPRINT_ATTEMPTS } from "@minemods/mod-core/blueprint-production"
import { ProjectRunSchema } from "@minemods/mod-core/workspace-runs"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"
import { createStudioService, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { FAILED_ENTRY_WORDS, NOTHING_LEFT } from "../src/main/blueprint-service"
import { ENTRY_REFUSALS } from "../src/main/plan-entry"
import { repairEntryLinks } from "../src/main/entry-repair"
import type { ExternalStartResult } from "../src/external"
import { PAPER, played } from "./playable-fixture"

// 2026-11-16, 蚩尤: the blueprint entry 「戴上铜头铁额」 failed twice in next_batch; the outside AI then made the same thing with its own plan_run, and the
// overview showed the entry failed with nothing made, beside the new thing as an item that stood for no entry.

type Service = Awaited<ReturnType<typeof createStudioService>>
const services: Service[] = []
const roots: string[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function studio(root: string) {
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: { mode: "mcp", review: true } })
  services.push(service)
  return service
}

const REQUEST = "做一套矿物和配方"
const entry = (key: string, kind: string, needs: string[] = [], extra: Record<string, unknown> = {}) =>
  ({ key, kind, title: `${key} 标题`, brief: `做一个 ${key}`, owner: null, needs, out_of_scope: null, ...extra }) as BlueprintPlan["entries"][number]
const gemDocument = { kind: "item", identifier: "gem", name: "宝石", max_stack: 16, color: "#99ccff", texture: null }
const ringDocument = { kind: "recipe", name: "戒指", pattern: ["pipeline:gem", null, null, null, null, null, null, null, null], result: "minecraft:stick", count: 1 }

type Overview = Awaited<ReturnType<Service["getProjectOverview"]>>
type Task = { key: string; module: string; title: string; prompt: string; source: string; dependencies: string[]; target_id: string | null; entry?: string }

/** A confirmed plan of a gem and a ring made from it, where the gem failed on every try: the ring is held behind it and next_batch has nothing left. */
async function failedGem() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-plan-entry-"))
  roots.push(root)
  const service = await studio(root)
  const created = await service.createProject({ name: "重做条目", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  await call("proposeBlueprint", { projectId, request: REQUEST, blueprint: played({ style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }, entries: [entry("gem", "item"), entry("ring", "recipe", ["gem"]), entry("lore", "worldview", [], { out_of_scope: "只能存成设计稿" })], questions: [] }), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  for (const _ of Array.from({ length: BLUEPRINT_ATTEMPTS })) {
    const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
    const ids = { projectId, runId: batch.run.id, taskId: batch.tasks.find((value) => value.task.key === "gem")!.task.id }
    await call("claimExternalTask", ids)
    await call("failExternalTask", { ...ids, error: "检查代码的编译环境起不来" })
  }
  const plan = async (tasks: Task[], prompt = REQUEST) =>
    (await call("startExternal", { projectId, expectedRevision: (await service.openProject(projectId)).project.revision, prompt, plan: { summary: "自己重做", questions: [], tasks } })) as ExternalStartResult
  const finish = async (made: ExternalStartResult, document: unknown) => {
    const ids = { projectId, runId: made.run.id, taskId: made.tasks[0]!.task.id }
    await call("claimExternalTask", ids)
    await call("commitExternalTask", { ...ids, document })
  }
  return { root, service, projectId, directory: created.directory, call, refused, plan, finish }
}

const item = (view: Overview, key: string) => view.items.find((value) => value.key === key)!
const unlinked = (view: Overview) => view.items.filter((value) => value.key === null)

test("条目两次都没做成：next_batch 和 get_blueprint 告诉外部 AI 可以用 plan_run 带 entry 重做", async () => {
  const { projectId, call, service } = await failedGem()
  const view = await service.getProjectOverview({ projectId })
  expect(item(view, "gem")).toMatchObject({ status: "failed", asset_id: null })
  expect(item(view, "ring")).toMatchObject({ status: "blocked" })
  const words = FAILED_ENTRY_WORDS([{ key: "gem", title: "gem 标题" }])
  expect(words).toContain("「gem 标题」（key gem）")
  expect(words).toContain("再试一次")
  expect(words).toContain("entry")
  const next = (await call("nextBatch", { projectId })) as { run: unknown; next_step: string }
  expect(next).toMatchObject({ run: null })
  expect(next.next_step).toBe(`${NOTHING_LEFT.stuck}${words}`)
  const read = (await call("getBlueprint", { projectId })) as { failed?: { entries: unknown[]; next_step: string } }
  expect(read.failed).toEqual({ entries: [{ key: "gem", title: "gem 标题" }], next_step: words })
})

test("plan_run 带 entry 重做没做成的条目：提交以后总览里条目就是做好了（等验收），不多出不属于条目的东西，被它卡住的接着做", async () => {
  const { projectId, call, service, plan, finish } = await failedGem()
  const made = await plan([{ key: "gem_again", module: "item", title: "宝石", prompt: "编译环境修好了，把宝石再做一次", source: "blueprint:gem", dependencies: [], target_id: null, entry: "gem" }])
  // Stored as the entry's own task: no `entry` field left on it.
  expect(made.tasks.map((value) => [value.task.key, value.task.source, value.task.target_id, "entry" in value.task])).toEqual([["gem_again", "blueprint:gem", null, false]])
  await finish(made, gemDocument)
  const view = await service.getProjectOverview({ projectId })
  expect(item(view, "gem")).toMatchObject({ status: "review", asset_id: made.tasks[0]!.task.asset_id, facts: { saved: true } })
  expect(unlinked(view)).toEqual([])
  expect(view.production).toMatchObject({ failed: 0, blocked: 0 })
  expect((await openProject((await service.openProject(projectId)).directory)).blueprint!.entries.find((value) => value.key === "gem")!.asset_id).toBe(made.tasks[0]!.task.asset_id)
  expect(((await call("getBlueprint", { projectId })) as { failed?: unknown }).failed).toBeUndefined()

  // What waited behind it is handed out again, and the plan ends made.
  const ring = (await call("nextBatch", { projectId })) as ExternalStartResult
  expect(ring.tasks.map((value) => value.task.key)).toEqual(["ring"])
  await finish(ring, ringDocument)
  const done = (await call("nextBatch", { projectId })) as { run: unknown; next_step: string }
  expect(done.run).toBeNull()
  expect(done.next_step.startsWith(NOTHING_LEFT.made)).toBe(true)

  // An entry already made is changed where it stands: the task is given its asset, and nothing second is made.
  const again = await plan([{ key: "gem_fix", module: "item", title: "宝石", prompt: "颜色深一点", source: "blueprint:gem", dependencies: [], target_id: null, entry: "gem" }])
  expect(again.tasks[0]!.task.target_id).toBe(made.tasks[0]!.task.asset_id)
  await finish(again, { ...gemDocument, color: "#336699" })
  const after = await service.getProjectOverview({ projectId })
  expect(item(after, "gem")).toMatchObject({ asset_id: made.tasks[0]!.task.asset_id, revision: 2 })
  expect(unlinked(after)).toEqual([])
})

test("plan_run 没写 entry，但任务只对得上一个没做成的条目（同种类、同 key 或同名）：也算这个条目的；对不上的照旧另做", async () => {
  const { projectId, service, plan, finish } = await failedGem()
  // Not the gem: another kind, another name. It stays a thing of its own, as before.
  const other = await plan([{ key: "pearl", module: "item", title: "珍珠", prompt: "做一颗珍珠", source: "矿物", dependencies: [], target_id: null }])
  expect(other.tasks[0]!.task.source).toBe("矿物")
  await finish(other, { ...gemDocument, identifier: "pearl", name: "珍珠" })
  // The gem's own key, its words quoted from the request: the gem.
  const made = await plan([{ key: "gem", module: "item", title: "宝石", prompt: "把宝石再做一次", source: "矿物", dependencies: [], target_id: null }])
  expect(made.tasks[0]!.task.source).toBe("blueprint:gem")
  await finish(made, gemDocument)
  const view = await service.getProjectOverview({ projectId })
  expect(item(view, "gem")).toMatchObject({ status: "review", asset_id: made.tasks[0]!.task.asset_id })
  expect(unlinked(view).map((value) => value.title)).toEqual(["珍珠"])
})

test("entry 写错了就拒绝，说清楚该怎么写；两个任务对得上同一个条目时都不算", async () => {
  const { projectId, call, refused, service, plan } = await failedGem()
  const task = (extra: Partial<Task>): Task => ({ key: "gem_again", module: "item", title: "宝石", prompt: "再做一次", source: "blueprint:gem", dependencies: [], target_id: null, entry: "gem", ...extra })
  const start = async (tasks: Task[]) => refused("startExternal", { projectId, expectedRevision: (await service.openProject(projectId)).project.revision, prompt: REQUEST, plan: { summary: "自己重做", questions: [], tasks } })
  const gem = (await openProject((await service.openProject(projectId)).directory)).blueprint!.entries.find((value) => value.key === "gem")!
  const lore = (await openProject((await service.openProject(projectId)).directory)).blueprint!.entries.find((value) => value.key === "lore")!
  expect(await start([task({ entry: "pearl" })])).toBe(ENTRY_REFUSALS.missing("宝石", "pearl"))
  expect(await start([task({ module: "recipe" })])).toBe(ENTRY_REFUSALS.kind("宝石", gem, "recipe"))
  expect(await start([task({ entry: "lore", module: "worldview", source: "blueprint:lore" })])).toBe(ENTRY_REFUSALS.outOfScope("宝石", lore))
  expect(await start([task({ source: "blueprint:ring" })])).toBe(ENTRY_REFUSALS.source("宝石", gem, "ring"))
  expect(await start([task({}), task({ key: "gem_twice" })])).toBe(ENTRY_REFUSALS.twice(gem))
  expect(ENTRY_REFUSALS.kind("宝石", gem, "recipe")).toContain("物品")

  // Two tasks that could both be the gem: which one is, is not clear, so neither is taken for it.
  const both = await plan([
    { key: "gem", module: "item", title: "宝石", prompt: "做宝石", source: "矿物", dependencies: [], target_id: null },
    { key: "gem_two", module: "item", title: "gem 标题", prompt: "再做一颗", source: "配方", dependencies: [], target_id: null },
  ])
  expect(both.tasks.map((value) => value.task.source)).toEqual(["矿物", "配方"])
  await call("cancelExternalRun", { projectId, runId: both.run.id })

  // An entry a live run is still making is not made a second time beside it.
  await service.redoAsset({ projectId, itemId: "gem", feedback: "再试一次" })
  const retry = (await call("nextBatch", { projectId })) as ExternalStartResult
  expect(retry.tasks.map((value) => value.task.source)).toEqual(["blueprint:gem"])
  expect(await start([task({})])).toBe(ENTRY_REFUSALS.busy(gem, retry.run.id))
  // Without `entry` the same task is not refused: it is simply not taken for the entry that is being made.
  const loose = await plan([{ key: "gem", module: "item", title: "宝石", prompt: "做宝石", source: "矿物", dependencies: [], target_id: null }])
  expect(loose.tasks[0]!.task.source).toBe("矿物")
})

test("已经是坏样子的工程（条目没做成、AI 另做的那一样不属于条目）：打开时自动接上，只接得上一样时才接，再打开不再动", async () => {
  const { root, projectId, directory, plan, finish, service } = await failedGem()
  const made = await plan([{ key: "gem", module: "item", title: "宝石", prompt: "把宝石再做一次", source: "矿物", dependencies: [], target_id: null }])
  await finish(made, gemDocument)
  const assetId = made.tasks[0]!.task.asset_id
  // Put it back the way the old Studio left it: the task named no entry, and nothing linked the entry to what it made.
  const file = await storagePath(directory, [".minemods", "runs", `${made.run.id}.json`])
  const run = ProjectRunSchema.parse(JSON.parse(await readFile(file, "utf8")))
  await writeRecord(directory, [".minemods", "runs", `${made.run.id}.json`], { ...run, tasks: run.tasks.map((value) => ({ ...value, source: "矿物" })) })
  const project = await openProject(directory)
  await saveProject(directory, { ...project, blueprint: { ...project.blueprint!, entries: project.blueprint!.entries.map((value) => (value.key === "gem" ? { ...value, asset_id: null } : value)) } }, project.revision)
  const broken = await service.getProjectOverview({ projectId })
  expect(item(broken, "gem")).toMatchObject({ status: "failed", asset_id: null })
  expect(unlinked(broken).map((value) => value.asset_id)).toEqual([assetId])

  // Opened by a Studio with the fix: linked before anything is shown.
  const reopened = await studio(root)
  const upgraded = "打开时把旧格式升级了，补上了 1 处蓝图关联。"
  expect((await reopened.projectSummary(projectId)).open_notice).toBe(upgraded)
  expect((await reopened.openProject(projectId)).open_notice).toBe(upgraded)
  const fixed = await reopened.getProjectOverview({ projectId })
  expect(item(fixed, "gem")).toMatchObject({ status: "review", asset_id: assetId })
  expect(unlinked(fixed)).toEqual([])
  expect(fixed.production).toMatchObject({ failed: 0, blocked: 0 })
  const revision = (await openProject(directory)).revision
  expect(await repairEntryLinks(directory)).toEqual([])
  expect((await openProject(directory)).revision).toBe(revision)
})

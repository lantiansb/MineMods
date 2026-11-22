import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import os from "node:os"
import path from "node:path"
import { openProject, saveProject } from "@minemods/mod-core/project"
import { putModelAsset } from "@minemods/mod-core/assets"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"
import { createStudioService, dispatchStudioRequest, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { jobTarget } from "../src/renderer/job-target"
import { englishThing } from "../src/renderer/features/english-name-model"
import { placeOf } from "../src/finding-targets"
import { PAPER, played } from "./playable-fixture"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"

type Service = Awaited<ReturnType<typeof createStudioService>>

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const directories: string[] = []
const services: Service[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function external() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-broad17-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: TEMPLATE, ai: { mode: "mcp", review: true } })
  services.push(service)
  const created = await service.createProject({ name: "手做的鹿", description: "", modId: "handmade", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  return { service, created, projectId, call, refused }
}

const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ key, kind, title: `${key} 标题`, brief: `做一个 ${key}`, owner: null, needs: [], out_of_scope: null, ...extra }) as BlueprintPlan["entries"][number]
const plan = (entries: BlueprintPlan["entries"]): BlueprintPlan => played({ style, entries, questions: [] })

// A model that passes the standard as it is (the same one the look tests use), so a commit is judged and kept, not refused.
const design = ModelDesignSchema.parse(slime.model)
const entityDocument = (modelId: string, over: Record<string, unknown> = {}) => ({
  kind: "entity", name: "苔叶鹿", description: "林子里的一只鹿", health: 14, speed: 0.25, attack_damage: 2, behavior: "passive", model_asset_id: modelId,
  runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null }, ...over,
})

test("手动做的生物（还没有模型）：蓝图能指向它，开工的模型任务就在它身上做，做完工程里仍然只有这一只", async () => {
  const { service, created, projectId, call, refused } = await external()
  // The person makes the creature by hand, in the window.
  const withDeer = await service.addEntity({ projectId, name: "苔叶鹿", expectedRevision: created.project.revision })
  const deer = withDeer.project.entities[0]!
  expect(deer.model_asset_id).toBeNull()

  // 1. The outside AI sees it, with the id the rest of the system accepts, and is told what changing it means.
  const shown = (await call("getBlueprint", { projectId })) as unknown as { existing: { id: string; kind: string; title: string; hand?: boolean; note?: string }[] }
  expect(shown.existing).toMatchObject([{ id: deer.id, kind: "entity", title: "苔叶鹿", hand: true }])
  expect(shown.existing[0]!.note).toContain("还没有模型")

  // 2. A second deer of the same name is refused, with the id and the way to change this one.
  const clash = await refused("proposeBlueprint", { projectId, request: "做一只鹿", blueprint: plan([entry("deer_model", "model", { title: "苔叶鹿的模型", owner: "deer", brief: "简单低模的鹿" }), entry("deer", "entity", { title: "苔叶鹿", needs: ["deer_model"] })]), paper_play: PAPER })
  expect(clash).toContain(deer.id)
  expect(clash).toContain(`action: "change"`)

  // 3. A plan that names it is stored; the plan's list shows it once, and the sidebar and the overview agree it is not done.
  const entries = [entry("deer_model", "model", { title: "苔叶鹿的模型", owner: "deer", brief: "简单低模的鹿" }), entry("deer", "entity", { title: "苔叶鹿", needs: ["deer_model"], existing: { id: deer.id, action: "change" } })]
  const proposed = (await call("proposeBlueprint", { projectId, request: "把苔叶鹿做完整，简单低模", blueprint: plan(entries), paper_play: PAPER })) as { blueprint: { revision: number } }
  const drafted = await service.getProjectOverview({ projectId })
  expect(drafted.items.filter((item) => item.title === "苔叶鹿")).toHaveLength(1)
  await dispatchStudioRequest(service, { method: "confirmBlueprint", input: { projectId, revision: proposed.blueprint.revision } } as never)

  // 4. The batch: the model is made under the creature's own id; the creature's rules are a new asset that binds to it.
  const batch = (await call("nextBatch", { projectId })) as { run: { id: string }; tasks: { task: { id: string; key: string; target_id: string | null; asset_id: string; prompt: string } }[] }
  expect(batch.tasks.map((value) => [value.task.key, value.task.target_id])).toEqual([["deer_model", deer.id], ["deer", null]])
  expect(batch.tasks[0]!.task.asset_id).toBe(deer.id)
  expect(batch.tasks[0]!.task.prompt).toContain("手动做的生物「苔叶鹿」")
  const ids = (index: number) => ({ projectId, runId: batch.run.id, taskId: batch.tasks[index]!.task.id })
  const context = (await call("claimExternalTask", ids(0))) as { project: { entities: { id: string; health: number; description: string }[] } }
  // The AI is handed the creature as it is, so it starts from what the person set.
  expect(context.project.entities).toMatchObject([{ id: deer.id, name: "苔叶鹿", health: 20, speed: 0.25, attack_damage: 2, behavior: "passive" }])
  await call("commitExternalTask", { ...ids(0), document: { kind: "model", ...design } })
  const modelled = await openProject(created.directory)
  expect(modelled.entities).toHaveLength(1)
  expect(modelled.entities[0]).toMatchObject({ id: deer.id, name: "苔叶鹿", model_asset_id: expect.any(String) })
  await call("claimExternalTask", ids(1))
  await call("commitExternalTask", { ...ids(1), document: entityDocument(deer.id, { health: 18 }) })

  // 5. One creature in the end: the same entry, now bound to a model and carrying the rules the AI wrote; no second deer anywhere.
  const done = await openProject(created.directory)
  expect(done.entities).toHaveLength(1)
  expect(done.entities[0]).toMatchObject({ id: deer.id, name: "苔叶鹿", health: 18 })
  expect(done.workspace.assets.filter((asset) => asset.module === "entity")).toHaveLength(1)
  const overview = await service.getProjectOverview({ projectId })
  expect(overview.items.filter((item) => item.kind === "entity" && item.title.includes("苔叶鹿"))).toHaveLength(1)
  expect(overview.items.filter((item) => item.kind === "entity").every((item) => item.facts.saved)).toBe(true)

  // 6. The same plan, handed in again after the work, is still accepted: the creature is now spoken for by its own rules asset.
  const again = await refused("proposeBlueprint", { projectId, request: "把苔叶鹿做完整，简单低模", blueprint: plan(entries), paper_play: PAPER })
  expect(again).toBe("accepted")
})

test("手动做的物品（没有资产的老内容）：蓝图指向它，任务拿到它现在的样子，保存后还是同一个物品", async () => {
  const { service, created, projectId, call } = await external()
  const id = crypto.randomUUID()
  const project = await openProject(created.directory)
  // Written straight into the content list, as a project from before assets existed holds it.
  await saveProject(created.directory, { ...project, items: [{ id, identifier: "leaf_charm", name: "叶片护符", max_stack: 16, color: "#88aa66" }] }, project.revision)
  expect((await call("getBlueprint", { projectId }) as unknown as { existing: { id: string; hand?: boolean }[] }).existing).toMatchObject([{ id, hand: true }])

  const changed = entry("charm", "item", { title: "叶片护符", existing: { id, action: "change" } })
  const proposed = (await call("proposeBlueprint", { projectId, request: "把护符改亮", blueprint: plan([changed]), paper_play: PAPER })) as { blueprint: { revision: number } }
  await dispatchStudioRequest(service, { method: "confirmBlueprint", input: { projectId, revision: proposed.blueprint.revision } } as never)
  const batch = (await call("nextBatch", { projectId })) as { run: { id: string }; tasks: { task: { id: string; target_id: string | null } }[] }
  expect(batch.tasks.map((value) => value.task.target_id)).toEqual([id])
  const ids = { projectId, runId: batch.run.id, taskId: batch.tasks[0]!.task.id }
  const claimed = (await call("claimExternalTask", ids)) as { existing: Record<string, unknown> | null }
  expect(claimed.existing).toMatchObject({ kind: "item", identifier: "leaf_charm", name: "叶片护符", color: "#88aa66" })
  await call("commitExternalTask", { ...ids, document: { kind: "item", identifier: "leaf_charm", name: "叶片护符", max_stack: 16, color: "#99ddaa", texture: null } })
  const done = await openProject(created.directory)
  expect(done.items).toHaveLength(1)
  expect(done.items[0]).toMatchObject({ id, color: "#99ddaa" })
  expect(done.workspace.assets.filter((asset) => asset.module === "item")).toHaveLength(1)
})

test("手动做的、已有模型的生物：被改的任务拿到现在的模型，保存后仍是同一只", async () => {
  const { service, created, projectId, call } = await external()
  const withDeer = await service.addEntity({ projectId, name: "苔叶鹿", expectedRevision: created.project.revision })
  const deer = withDeer.project.entities[0]!
  await putModelAsset(created.directory, { entity_id: deer.id, data: { design, blockbench: {}, provenance: null }, origin: "manual", expectedRevision: withDeer.project.revision })
  const entries = [entry("deer_model", "model", { title: "苔叶鹿的模型", owner: "deer", brief: "简单低模的鹿" }), entry("deer", "entity", { title: "苔叶鹿", needs: ["deer_model"], existing: { id: deer.id, action: "change" } })]
  const proposed = (await call("proposeBlueprint", { projectId, request: "简单低模改鹿", blueprint: plan(entries), paper_play: PAPER })) as { blueprint: { revision: number } }
  await dispatchStudioRequest(service, { method: "confirmBlueprint", input: { projectId, revision: proposed.blueprint.revision } } as never)
  const batch = (await call("nextBatch", { projectId })) as { run: { id: string }; tasks: { task: { id: string; target_id: string | null } }[] }
  expect(batch.tasks.map((value) => value.task.target_id)).toEqual([deer.id, null])
  const ids = { projectId, runId: batch.run.id, taskId: batch.tasks[0]!.task.id }
  const claimed = (await call("claimExternalTask", ids)) as { existing: { kind: string; name: string } | null }
  // The model on file reaches the AI as the document it changes.
  expect(claimed.existing).toMatchObject({ kind: "model", name: design.name })
  await call("commitExternalTask", { ...ids, document: { kind: "model", ...design, name: "新鹿" } })
  const done = await openProject(created.directory)
  expect(done.entities).toHaveLength(1)
  expect(done.assets.filter((asset) => asset.entity_id === deer.id).length).toBe(1)
  expect(done.workspace.assets.filter((asset) => asset.module === "model")).toHaveLength(1)
})

test("没有模型的生物打包：说出是哪个生物没有模型，作业记下直达它卡片的目标；窗口认得这个目标", async () => {
  const { service, created, projectId } = await external()
  const withDeer = await service.addEntity({ projectId, name: "苔叶鹿", expectedRevision: created.project.revision })
  const deer = withDeer.project.entities[0]!
  const { jobId } = await service.buildProject({ projectId })
  let job = await service.getJob({ projectId, jobId })
  for (let tries = 0; tries < 400 && ["queued", "running"].includes(job.state); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    job = await service.getJob({ projectId, jobId })
  }
  expect(job.state).toBe("failed")
  expect(job.error).toBe("「苔叶鹿」还没有模型，所以没有打包：生物要先有模型才能做进模组。打开它的卡片，让 AI 给它做模型，或者自己做一个，再打包。")
  expect(job.error).not.toContain("操作未完成")
  const target = jobTarget(job)!
  expect(target).toEqual({ about: { kind: "entity", id: deer.id, name: "苔叶鹿" }, field: "", label: "打开「苔叶鹿」" })
  // The way there: with no field named the card itself opens, found by the creature's id on the overview.
  const items = (await service.getProjectOverview({ projectId })).items
  expect(placeOf(target, items, () => null)).toEqual({ how: "card", itemId: `entity:${deer.id}`, field: "" })
  // A checkpoint that is not such a target (an older job, a network failure) gives no button.
  expect(jobTarget({ checkpoint: { reason: "network" } })).toBeUndefined()
  expect(jobTarget({ checkpoint: null })).toBeUndefined()
})

test("英文名的输入框：没有模型的生物卡片也有，英文名检查给出的按钮能落到它；有英文名要填的方块、物品照旧", async () => {
  const { service, created, projectId } = await external()
  const withDeer = await service.addEntity({ projectId, name: "苔叶鹿", expectedRevision: created.project.revision })
  const deer = withDeer.project.entities[0]!
  const project = (await service.openProject(projectId)).project
  const card = (await service.getProjectOverview({ projectId })).items.find((item) => item.id === `entity:${deer.id}`)!
  // The overview gives no model to draw, and the box does not depend on one.
  expect(card.preview.entity_id).toBeNull()
  expect(englishThing(project, card)).toEqual({ kind: "entity", id: deer.id, name: "苔叶鹿", nameEn: "" })
  // The finding's button for the English name lands on that card, field and all.
  const place = placeOf({ about: { kind: "entity", id: deer.id, name: "苔叶鹿" }, field: "name_en" }, [card], () => null)
  expect(place).toEqual({ how: "card", itemId: card.id, field: "name_en" })
  // Saving it goes through the same call as any card's box.
  const saved = await service.setEnglishName({ projectId, expectedRevision: project.revision, kind: "entity", id: deer.id, name_en: "Mossleaf Deer" })
  expect(saved.project.entities[0]!.name_en).toBe("Mossleaf Deer")
  const after = (await service.openProject(projectId)).project
  expect(englishThing(after, card)).toMatchObject({ nameEn: "Mossleaf Deer" })
  // A card that is not a creature, block or item has no box.
  expect(englishThing(after, { id: "x", asset_id: null, kind: "model", preview: card.preview })).toBeNull()
})

test("手动生物改名、删除并撤销时，绑定的模型记录也随生物恢复", async () => {
  const { service, created, projectId } = await external()
  const added = await service.addEntity({ projectId, name: "苔叶鹿", expectedRevision: created.project.revision })
  const entity = added.project.entities[0]!
  const modeled = await service.useExample({ projectId, expectedRevision: added.project.revision })
  const target = { projectId, assetId: entity.id, creature: true as const }
  const renamed = await service.renameAsset({ ...target, expectedRevision: modeled.project.revision, title: "灰叶鹿" })
  expect(renamed.project.entities[0]?.name).toBe("灰叶鹿")
  const deleted = await service.deleteAsset({ ...target, expectedRevision: renamed.project.revision })
  expect(deleted.deletion).not.toBeNull()
  expect(deleted.view.project.entities).toHaveLength(0)
  expect(deleted.view.project.assets).toHaveLength(0)
  const restored = await service.restoreDeleted({ projectId, expectedRevision: deleted.view.project.revision, deletion: deleted.deletion! })
  expect(restored.view.project.entities).toEqual(renamed.project.entities)
  expect(restored.view.project.assets).toEqual(renamed.project.assets)
  expect(restored.view.model).toEqual(renamed.model)
})

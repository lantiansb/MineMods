import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject, openProject, saveProject } from "@minemods/mod-core/project"
import { applyContent, applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { compileModel } from "@minemods/mod-core/model"
import { reviewStaticItemModel } from "@minemods/mod-core/item-model-quality"
import { encodePng } from "@minemods/mod-core/png"
import { readMaking } from "@minemods/mod-core/making"
import { weaponFixture, WEAPON_MODEL_ID, WEAPON_ITEM_ID } from "./weapon-fixture"
import { lookJob, needJob, reviewJob } from "../src/main/look-job"
import { createMakingLoop, type MakingWork } from "../src/main/making-loop"
import { createProjectRunner } from "../src/main/project-runner"

const roots: string[] = []
const runners: ReturnType<typeof createProjectRunner>[] = []
afterEach(async () => {
  await Promise.all(runners.splice(0).map(runner => runner.dispose()))
  await Promise.all(roots.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
const document = () => ({ kind: "model" as const, ...weaponFixture() })

test("claiming an item rework receives its actual static model dependency without an entity asset", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-item-context-"))
  roots.push(directory)
  const project = await createProject({ directory, name: "静态物品依赖" })
  const time = new Date().toISOString()
  const model = WorkspaceAssetSchema.parse({ id: WEAPON_MODEL_ID, module: "model", title: "电锯剑", document: document(), revision: 1, created_at: time, updated_at: time, prompt: "武器", dependencies: [], provenance: { model: null, request_id: null }, status: "design" })
  const linked = applyContent(applyWorkspaceAsset(project, model), { blocks: [], recipes: [], logic: [], items: [{ id: WEAPON_ITEM_ID, identifier: "chainsword", name: "电锯剑", max_stack: 1, color: "#aa7755", model_asset_id: WEAPON_MODEL_ID }] })
  const saved = await saveProject(directory, linked, project.revision)
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  runners.push(runner)
  const started = await runner.startExternal({ projectId: saved.id, expectedRevision: saved.revision, prompt: "修改武器名称", plan: { summary: "修改物品", questions: [], tasks: [{ key: "item", module: "item", title: "电锯剑", source: "修改武器名称", prompt: "保留武器模型，只改物品名称", dependencies: [], target_id: WEAPON_ITEM_ID }] } })
  const context = await runner.claimExternalTask({ projectId: saved.id, runId: started.run.id, taskId: started.run.tasks[0]!.id })
  expect(context.model_context).toEqual([{ asset_id: WEAPON_MODEL_ID, atlas_size: weaponFixture().texture_size, geometry: compileModel(weaponFixture(), "item_context").geometry }])
  expect(context.dependency_results.some(asset => asset.id === WEAPON_MODEL_ID)).toBe(true)
  expect((await openProject(directory)).entities).toEqual([])
  expect((await openProject(directory)).assets).toEqual([])
})

test("static item look and final review retain geometry and budget but do not invent creature motion requirements", () => {
  const model = document()
  const before = structuredClone(model)
  const look = lookJob(model, null, {}, null, null, null, null, {}, true)
  expect(look.motion).toEqual([])
  expect(look.job.scenes[0]!.design).toEqual(weaponFixture())
  expect(look.budget_facts?.length).toBeGreaterThan(0)
  const packet = reviewJob(model, null, null, null, null, null, {}, true)
  expect(packet.job.sheets.map(sheet => sheet.label)).toEqual(["六个角度", "只看形状"])
  expect(packet.motion).toEqual([])
  expect(model).toEqual(before)
  expect(reviewJob(model, null).motion.length).toBe(3)
  expect(() => needJob(model, null, [{ what: "motion", name: "walk" }], null, true)).toThrow("没有动作")
})

test("static item self-review and final-review keep all findings and independent-review gates", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-static-gates-"))
  roots.push(directory)
  await createProject({ directory, name: "静态物品完整门槛" })
  // This unit test exercises persisted gate transitions. Real renderer evidence is covered by weapon-authoring.spec.ts.
  const pixel = `data:image/png;base64,${Buffer.from(encodePng(new Uint8Array([255, 255, 255, 255]), 1, 1)).toString("base64")}`
  const loop = createMakingLoop({ look: async job => ({ ok: true, pictures: job.sheets.map(sheet => ({ label: sheet.label, url: pixel })) }) })
  const work: MakingWork = {
    directory, itemOnly: true, run: { prompt: "修改电锯剑刀刃" },
    task: { id: crypto.randomUUID(), asset_id: WEAPON_MODEL_ID, module: "model", title: "电锯剑", prompt: "静态武器", source: "修改电锯剑刀刃" },
    wears: () => null, judge: async model => { if (model.kind !== "model") throw new Error("Expected model"); const { kind: _kind, ...design } = model; return reviewStaticItemModel(design) }, outside: [],
  }
  await loop.describe(work, { subject: "静态电锯剑", recognisable: ["长刀刃与锯齿"], parts: [{ name: "blade", what: "刀刃", shape: "长方体", attaches: "连接握柄", surface: "铜色", moves: "静止", assumed: false }], assumed: [] })
  const glance = await loop.look(work, document(), {}, undefined, true)
  expect(glance.findings).toEqual([])
  expect(glance.motion_facts).toEqual([])
  expect((await readMaking(directory, work.task.asset_id))?.rounds).toHaveLength(0)
  expect(await loop.gate(directory, work.task, document())).not.toBeNull()
  await expect(loop.selfReview(work, { matches: [], problems: [], next: [], verdict: "done" })).rejects.toThrow()
  const shown = await loop.look(work, document())
  expect(shown.findings).toEqual([])
  expect(shown.notes.join(" ")).toContain("静态物品模型")
  expect(await loop.gate(directory, work.task, document())).not.toBeNull()
  await loop.selfReview(work, { matches: ["形状符合"], problems: [], next: [], verdict: "done" })
  expect(await loop.gate(directory, work.task, document())).not.toBeNull()
  const packet = await loop.packet(work)
  expect(packet.input.judging).toContain("静态物品模型")
  expect(packet.instructions).toContain("不能要求制作者添加假动作")
  expect(packet.input).not.toHaveProperty("motion_facts")
  expect(await loop.gate(directory, work.task, { ...document(), name: "未看过的版本" })).not.toBeNull()
  await loop.review(work, { passed: true, findings: [], independent: true })
  expect(await loop.gate(directory, work.task, document())).toBeNull()
  const invalid = document()
  invalid.bones[0]!.rotation[0] = 45
  const nextWork = { ...work, task: { ...work.task, id: crypto.randomUUID() } }
  await loop.describe(nextWork, { subject: "静态电锯剑", recognisable: ["长刀刃"], parts: [{ name: "blade", what: "刀刃", shape: "长方体", attaches: "握柄", surface: "铜色", moves: "静止", assumed: false }], assumed: [] })
  expect((await loop.look(nextWork, invalid)).findings.length).toBeGreaterThan(0)
  await expect(loop.selfReview(nextWork, { matches: [], problems: [], next: [], verdict: "done" })).rejects.toThrow()
  // The same geometry serving a creature must retain the new measured-motion gates.
  const shared = { ...work, itemOnly: false, task: { ...work.task, id: crypto.randomUUID() } }
  await loop.describe(shared, { subject: "持剑生物", recognisable: ["长刀刃"], parts: [{ name: "blade", what: "刀刃", shape: "长方体", attaches: "握柄", surface: "铜色", moves: "挥动", assumed: false }], assumed: [] })
  const creatureLook = await loop.look(shared, document())
  expect(creatureLook.motion_facts.length).toBeGreaterThan(0)
  await expect(loop.selfReview(shared, { matches: [], problems: [], next: [], verdict: "done" })).rejects.toThrow()
})

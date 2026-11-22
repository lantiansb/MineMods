import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { mushroomCowDesign } from "../src/example"
import { createEntity, createProject, openProject, saveProject, type Project } from "../src/project"
import { persistWorkspaceModel } from "../src/workspace-model"
import { WorkspaceAssetSchema, applyWorkspaceAsset } from "../src/workspace"
import { assembleBuildSource } from "../src/build"
import { modelOnlyCreature } from "../src/blueprint-creature"
import { creatureName } from "../src/gameplay"
import { reconcile } from "../src/reconcile"

// 主工程第 2 条：只有模型、没有生物文档的条目（蓝图的模型条目做出来的那一行）不注册成生物和刷怪蛋，打包提醒说一句；手做的旧生物照旧注册。

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))))
const template = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const at = () => new Date().toISOString()
const asset = (module: string, title: string, document: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  WorkspaceAssetSchema.parse({ id: crypto.randomUUID(), module, title, revision: 1, created_at: at(), updated_at: at(), prompt: `做${title}`, dependencies: [], document, provenance: { model: null, request_id: null }, status: "design", ...extra })
const entry = (key: string, kind: string, title: string, assetId: string | null, extra: Record<string, unknown> = {}) => ({ key, kind, title, brief: title, owner: null, needs: [], out_of_scope: null, asset_id: assetId, ...extra })

/** A project with: a blueprint model entry that only made a model (灯笼鱼的模型), a creature made from a model and a creature document (石灵), and a creature made by hand in the window with a model (手做的鹿). */
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-model-only-"))
  directories.push(root)
  const created = await createProject({ directory: root, name: "只有模型" })
  const lone = asset("model", "灯笼鱼的模型", { kind: "model", ...mushroomCowDesign })
  const worn = asset("model", "石灵的模型", { kind: "model", ...mushroomCowDesign })
  await saveProject(root, applyWorkspaceAsset(applyWorkspaceAsset(created, lone), worn), created.revision)
  await persistWorkspaceModel(root, lone.id)
  const second = await persistWorkspaceModel(root, worn.id)
  const rules = asset("entity", "石灵", { kind: "entity", name: "石灵", description: "", health: 30, speed: 0.3, attack_damage: 3, behavior: "hostile", model_asset_id: worn.id, runtime: { spawn: { biomes: ["minecraft:plains"], weight: 10, min: 1, max: 2 }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } }, { dependencies: [worn.id], status: "ready" })
  const documented = applyWorkspaceAsset(second.project, rules)
  // The hand-made creature: a row of the project's own with a model record and no workspace asset (`legacy-content.ts`).
  const deer = createEntity({ name: "手做的鹿" })
  const withDeer = await saveProject(root, { ...documented, entities: [...documented.entities, deer] }, second.project.revision)
  const { putModelAsset } = await import("../src/assets")
  const { designToBlockbench } = await import("../src/blockbench")
  await putModelAsset(root, { entity_id: deer.id, data: { design: mushroomCowDesign, blockbench: designToBlockbench(mushroomCowDesign) }, origin: "manual", expectedRevision: withDeer.revision })
  const latest = await openProject(root)
  const blueprint = {
    request: "灯笼鱼和石灵",
    style: { palette: [], shape: "", naming: "", world: "" },
    entries: [entry("fish_model", "model", "灯笼鱼的模型", lone.id), entry("stone_model", "model", "石灵的模型", worn.id), entry("stone", "entity", "石灵", rules.id, { needs: ["stone_model"] })],
    questions: [],
    revision: 1,
    state: "confirmed",
  }
  const saved = await saveProject(root, { ...latest, blueprint } as Project, latest.revision)
  return { root, project: saved, lone, worn, deer }
}

test("只由蓝图模型条目带出来的行不算生物；有生物文档的、手做的旧生物都算", async () => {
  const { project, lone, worn, deer } = await setup()
  const row = (id: string) => project.entities.find((entity) => entity.id === id)!
  expect(modelOnlyCreature(project, row(lone.id))).toBe(true)
  expect(modelOnlyCreature(project, row(worn.id))).toBe(false)
  expect(modelOnlyCreature(project, row(deer.id))).toBe(false)
  // Edited by hand in the window (anything beyond what the model's save wrote): a creature the person made.
  expect(modelOnlyCreature(project, { ...row(lone.id), sounds: null })).toBe(false)
  // A blueprint entry that names the row as existing content to change: the person's creature, whose model is being made on it.
  const changing = { ...project, blueprint: { ...project.blueprint!, entries: [...project.blueprint!.entries, { ...entry("fish", "entity", "灯笼鱼", null), existing: { id: lone.id, action: "change" as const } }] } }
  expect(modelOnlyCreature(changing as Project, row(lone.id))).toBe(false)
  // No blueprint: what every project before blueprints made is built as before.
  expect(modelOnlyCreature({ ...project, blueprint: undefined }, row(lone.id))).toBe(false)
  // The check that runs outside a build says it, and asks nothing of a creature of it.
  const said = reconcile(project, { animations: { [lone.id]: ["idle"], [worn.id]: ["idle", "walk", "hurt"], [deer.id]: ["idle", "walk", "hurt"] }, gameplay: [] }).filter((finding) => finding.about?.id === lone.id)
  expect(said.map((finding) => [finding.rule, finding.stops])).toEqual([["model_only", false]])
})

test("打包：只有模型的不注册成生物、没有刷怪蛋，提醒里说「只有模型，没有打进模组」；石灵和手做的鹿照旧注册", async () => {
  const { root, lone, worn, deer } = await setup()
  const source = path.join(root, "source")
  const result = await assembleBuildSource(root, source, template)
  const lang = await readFile(path.join(source, `src/main/resources/assets/${result.project.mod_id}/lang/zh_cn.json`), "utf8")
  expect(lang).not.toContain(creatureName({ id: lone.id }))
  expect(lang).toContain(`${creatureName({ id: worn.id })}_spawn_egg`)
  expect(lang).toContain(`${creatureName({ id: deer.id })}_spawn_egg`)
  expect(result.entityIds).not.toContain(creatureName({ id: lone.id }))
  const note = result.findings.find((finding) => finding.rule === "model_only")
  expect(note).toMatchObject({ stops: false, about: { id: lone.id } })
  expect(note?.text).toContain("只有模型")
  expect(note?.text).toContain("没有打进模组")
  // Its model asset stays in the project as it was: a texture made on it is not left dangling.
  expect((await openProject(root)).workspace.assets.some((value) => value.id === lone.id)).toBe(true)
})

test("模组里只剩只有模型的条目时，打包停下并说清楚，不报「还没有模型」", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-model-only-"))
  directories.push(root)
  const created = await createProject({ directory: root, name: "只有模型" })
  const lone = asset("model", "灯笼鱼的模型", { kind: "model", ...mushroomCowDesign })
  await saveProject(root, applyWorkspaceAsset(created, lone), created.revision)
  const persisted = await persistWorkspaceModel(root, lone.id)
  const blueprint = { request: "灯笼鱼", style: { palette: [], shape: "", naming: "", world: "" }, entries: [entry("fish_model", "model", "灯笼鱼的模型", lone.id)], questions: [], revision: 1, state: "confirmed" }
  await saveProject(root, { ...persisted.project, blueprint } as Project, persisted.project.revision)
  const failure = await assembleBuildSource(root, path.join(root, "source"), template).then(() => null, (error: unknown) => error)
  expect(failure).toMatchObject({ name: "BuildStop", rule: "model_only" })
  expect(String((failure as Error).message)).toContain("只有模型")
})

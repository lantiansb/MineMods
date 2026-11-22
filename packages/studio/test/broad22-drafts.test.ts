import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { openProject, saveProject } from "@minemods/mod-core/project"
import { WorkspaceAssetSchema, builtWorkspaceAssets, unbuiltThings } from "@minemods/mod-core/workspace"
import { handSave } from "../src/main/content-service"
import { createStudioService } from "../src/main/service"
import { createDataGameplaySample, golemEffects } from "../../mod-core/script/data-gameplay-sample"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const at = "2026-10-19T08:00:00.000Z"
const asset = (module: string, title: string, document: unknown, status: "ready" | "design", dependencies: string[] = []) =>
  WorkspaceAssetSchema.parse({ id: randomUUID(), module, title, revision: 1, created_at: at, updated_at: at, prompt: "-", dependencies, document, provenance: { model: null, request_id: null }, status })

test("the build list's 「只是设计稿」 follows what the build compiles, not the status an asset was saved with: an effect is never one, every kind is judged alike", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-drafts-"))
  roots.push(root)
  const project = await createDataGameplaySample(path.join(root, "p"), { chain: true, life: true, abilities: true, effects: true })
  // Everything the sample holds is compiled: nothing is a draft.
  expect(unbuiltThings(project)).toEqual([])
  const built = new Set(builtWorkspaceAssets(project).map((value) => value.id))
  // Whatever status an effect carries, the build takes it (it goes into the mod with its row in the effect tables), so it is not a draft.
  const marked = { ...project, workspace: { assets: project.workspace.assets.map((value) => (value.module === "effect" ? { ...value, status: "design" as const } : value)) } }
  expect(marked.workspace.assets.filter((value) => value.module === "effect" && built.has(value.id))).toHaveLength(2)
  expect(unbuiltThings(marked)).toEqual([])
  // A texture a creature wears is compiled too and was saved as "design" (the status of its kind, until something rewrites it): not a draft either.
  const golem = project.entities[0]!
  const texture = asset("texture", "傀儡贴图", { kind: "texture", width: 2, height: 2, palette: ["#112233"], pixels: [0, 0, 0, 0] }, "design")
  const worn = { ...marked, entities: [{ ...golem, runtime: { ...golem.runtime!, texture_asset_id: texture.id } }, ...project.entities.slice(1)], workspace: { assets: [...marked.workspace.assets, texture] } }
  expect(unbuiltThings(worn)).toEqual([])
  // A texture nothing wears, a design-only kind (worldview) and an idea note that is no built thing are drafts, and each is counted once.
  const loose = asset("texture", "没人穿的贴图", { kind: "texture", width: 2, height: 2, palette: ["#112233"], pixels: [0, 0, 0, 0] }, "design")
  const lore = asset("worldview", "世界观", { kind: "worldview", title: "世界观", summary: "地下的蓝晶。", entries: [] }, "design")
  const note = { id: randomUUID(), key: "", title: "一个想法", brief: "", status: "draft" as const, entity_id: null, review: null, behavior_brief: "", behavior_review: null, model_confirmed_asset_id: null, kind: "dimension" as const }
  const noteOfBuilt = { ...note, id: project.blocks[0]!.id, title: "已经做进去的方块", kind: "block" as const }
  const mixed = { ...worn, workspace: { assets: [...worn.workspace.assets, loose, lore] }, conception: { ...worn.conception, entries: [note, noteOfBuilt] } }
  expect(unbuiltThings(mixed).map((value) => value.title).sort()).toEqual(["一个想法", "世界观", "没人穿的贴图"].sort())
})

test("the build panel's draft count is the saved things the pack leaves out", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-drafts-panel-"))
  roots.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} })
  const created = await service.createProject({ name: "设计稿工程", description: "", empty: true })
  const { directory } = created
  const projectId = created.project.id
  expect((await service.getBuildPanel({ projectId })).drafts).toBe(0)
  const opened = await openProject(directory)
  const made = handSave(opened, { assetId: null, document: { kind: "item", identifier: "moon_a", name: "月屑", max_stack: 64, color: "#99aacc", texture: null }, id: randomUUID(), at })
  const saved = await saveProject(directory, made.next, opened.revision)
  // A thing the build takes does not make a draft.
  expect((await service.getBuildPanel({ projectId })).drafts).toBe(0)
  // An effect (compiled whatever its status says) beside a worldview (no build compiles it): one draft, the worldview.
  const effect = asset("effect", golemEffects.mark.title, golemEffects.mark.document, "design")
  const lore = asset("worldview", "世界观", { kind: "worldview", title: "世界观", summary: "地下的蓝晶。", entries: [] }, "design")
  const next = await saveProject(directory, { ...saved, workspace: { assets: [...saved.workspace.assets, effect, lore] } }, saved.revision)
  const panel = await service.getBuildPanel({ projectId })
  const inPack = new Set(builtWorkspaceAssets(next).map((value) => value.id))
  expect(panel.drafts).toBe(next.workspace.assets.filter((value) => !inPack.has(value.id)).length)
  expect(panel.drafts).toBe(1)
  expect(inPack.has(effect.id)).toBe(true)
})

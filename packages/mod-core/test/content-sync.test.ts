import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createProject, openProject, ProjectSchema, saveProject, type Project } from "../src/project"
import { applyContent, applyWorkspaceAsset } from "../src/workspace"

const legacy = async () => ProjectSchema.parse(JSON.parse(await readFile(path.join(import.meta.dir, "fixtures", "pre-0a", "project.json"), "utf8")))
const content = (project: Project) => ({ blocks: project.blocks, items: project.items, recipes: project.recipes, logic: project.logic })
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

/** Applying each content asset again must reproduce exactly the content lists: the two stores agree. */
function consistent(project: Project) {
  const rebuilt = project.workspace.assets
    .filter((asset) => ["block", "item", "recipe", "logic"].includes(asset.module))
    .reduce<Project>((next, asset) => applyWorkspaceAsset(next, asset), { ...project, blocks: [], items: [], recipes: [], logic: [] })
  const byId = (values: { id: string }[]) => [...values].sort((a, b) => a.id.localeCompare(b.id))
  return (["blocks", "items", "recipes", "logic"] as const).every((key) => JSON.stringify(byId(rebuilt[key])) === JSON.stringify(byId(project[key])))
}

test("saving unchanged content changes neither the content nor any asset revision", async () => {
  const project = await legacy()
  const saved = applyContent(project, content(project))
  expect(content(saved)).toEqual(content(project))
  expect(saved.workspace).toEqual(project.workspace)
  expect("blueprint" in saved).toBe(false)
  expect(JSON.stringify(ProjectSchema.parse(saved))).toBe(JSON.stringify(project))
})

test("an edit in the content editor reaches the workspace asset and bumps only that asset", async () => {
  const project = await legacy()
  const saved = applyContent(project, { ...content(project), items: project.items.map((item) => ({ ...item, max_stack: 8 })) })
  const before = project.workspace.assets.find((asset) => asset.module === "item")!
  const after = saved.workspace.assets.find((asset) => asset.module === "item")!
  expect(saved.items[0]!.max_stack).toBe(8)
  expect(after.document).toMatchObject({ kind: "item", max_stack: 8, texture: null })
  expect(after.revision).toBe(before.revision + 1)
  expect(after.title).toBe(before.title)
  expect(saved.workspace.assets.filter((asset) => asset.id !== after.id)).toEqual(project.workspace.assets.filter((asset) => asset.id !== before.id))
  expect(consistent(saved)).toBe(true)
  expect(ProjectSchema.safeParse(saved).success).toBe(true)
})

test("new content gets a ready asset and deleted content loses its asset and incoming dependencies", async () => {
  const project = await legacy()
  const lamp = { id: crypto.randomUUID(), identifier: "moss_lamp", name: "苔灯", hardness: 1, luminance: 12, tool: "pickaxe" as const, drop: "self" as const, color: "#88aa66" }
  const rule = { id: crypto.randomUUID(), entity_id: project.entities[0]!.id, trigger: "hurt" as const, action: "follow" as const, enabled: true }
  const recipe = project.workspace.assets.find((asset) => asset.module === "recipe")!
  // Give another asset a dependency on the recipe, then delete the recipe in the editor.
  const dependent = { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.module === "worldview" ? { ...asset, dependencies: [recipe.id] } : asset)) } }
  const saved = applyContent(ProjectSchema.parse(dependent), { blocks: [...project.blocks, lamp], items: project.items, recipes: [], logic: [...project.logic, rule] })
  expect(saved.workspace.assets.find((asset) => asset.id === lamp.id)).toMatchObject({ module: "block", title: "苔灯", revision: 1, status: "ready", dependencies: [], provenance: { model: null, request_id: null } })
  expect(saved.workspace.assets.find((asset) => asset.id === rule.id)).toMatchObject({ module: "logic", status: "ready", document: { kind: "logic", item: null, animation: null } })
  expect(saved.workspace.assets.some((asset) => asset.id === recipe.id)).toBe(false)
  expect(saved.workspace.assets.find((asset) => asset.module === "worldview")!.dependencies).toEqual([])
  expect(saved.recipes).toEqual([])
  expect(consistent(saved)).toBe(true)
  expect(ProjectSchema.safeParse(saved).success).toBe(true)
})

test("content that an older version let drift is pulled back in step on the next save", async () => {
  const project = await legacy()
  // What the old saveContent did: content changed and removed, assets untouched.
  const drifted = ProjectSchema.parse({ ...project, items: project.items.map((item) => ({ ...item, name: "新月露" })), recipes: [] })
  expect(consistent(drifted)).toBe(false)
  const saved = applyContent(drifted, content(drifted))
  expect(consistent(saved)).toBe(true)
  expect(saved.workspace.assets.find((asset) => asset.module === "item")!.document).toMatchObject({ name: "新月露" })
  expect(saved.workspace.assets.some((asset) => asset.module === "recipe")).toBe(false)
})

test("a project made only in the content editor stays loadable after its assets are created", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-content-sync-"))
  roots.push(root)
  const project = await createProject({ directory: root, name: "手工内容", mod_id: "hand_made" })
  const item = { id: crypto.randomUUID(), identifier: "dew", name: "露水", max_stack: 16, color: "#99ccff", texture: "data:image/png;base64,AAAA" }
  const recipe = { id: crypto.randomUUID(), name: "露水合成", pattern: ["minecraft:glass_bottle", null, null, null, null, null, null, null, null], result: "hand_made:dew", count: 1 }
  await saveProject(root, applyContent(project, { blocks: [], items: [item], recipes: [recipe], logic: [] }), project.revision)
  const opened = await openProject(root)
  expect(opened.items).toEqual([item])
  expect(opened.workspace.assets.map((asset) => [asset.id, asset.module, asset.status])).toEqual([[item.id, "item", "ready"], [recipe.id, "recipe", "ready"]])
  expect(opened.workspace.assets[0]!.document).toMatchObject({ texture: item.texture })
  expect(consistent(opened)).toBe(true)
})

test("an id cannot move between kinds and the death-drop rule still guards a deleted reward block", async () => {
  const project = await legacy()
  const model = project.workspace.assets.find((asset) => asset.module === "model")!
  expect(() => applyContent(project, { ...content(project), items: [...project.items, { id: model.id, identifier: "clash", name: "冲突", max_stack: 1, color: "#000000" }] })).toThrow("module cannot change")
  expect(() => applyContent(project, { ...content(project), blocks: [] })).toThrow()
})

test("renaming an item in the editor renames its asset, and a recipe naming something missing is refused", async () => {
  const project = await legacy()
  const item = project.items[0]!
  const renamed = applyContent(project, { ...content(project), items: project.items.map((value) => (value.id === item.id ? { ...value, name: "新物品名" } : value)) })
  expect(renamed.workspace.assets.find((asset) => asset.id === item.id)?.title).toBe("新物品名")
  expect(consistent(renamed)).toBe(true)
  const recipe = project.recipes[0]!
  const broken = { ...recipe, id: crypto.randomUUID(), name: "缺材料的配方", pattern: recipe.pattern.map((cell, index) => (index === 0 ? `${project.mod_id}:missing` : cell)) }
  expect(() => applyContent(project, { ...content(project), recipes: [...project.recipes, broken] })).toThrow("Unknown content reference")
})

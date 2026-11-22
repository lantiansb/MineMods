import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { openProject, ProjectSchema, saveProject } from "../src/project"
import { builtWorkspaceAssets } from "../src/workspace"
import { ProjectRunSchema, validateRoutePlan } from "../src/workspace-runs"

// Written by the schemas as they were before the blueprint, registry and manifest changes.
const fixtures = path.join(import.meta.dir, "fixtures", "pre-0a")
const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

test("a project saved before phase 0A parses and is written back byte for byte", async () => {
  const text = await readFile(path.join(fixtures, "project.json"), "utf8")
  const project = ProjectSchema.parse(JSON.parse(text))
  expect(`${JSON.stringify(project)}\n`).toBe(text)
  expect("blueprint" in project).toBe(false)
  expect(project.workspace.assets.map((asset) => asset.module)).toEqual([
    "model", "texture", "animation", "block", "item", "recipe", "entity", "logic", "worldview", "biome", "dimension", "terrain",
  ])
})

test("opening and saving an old project changes only its revision and timestamp", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-legacy-"))
  roots.push(root)
  const original = JSON.parse(await readFile(path.join(fixtures, "project.json"), "utf8"))
  await cp(path.join(fixtures, "project.json"), path.join(root, "minemods.project.json"))
  await mkdir(path.join(root, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(path.join(fixtures, "model-asset.json"), path.join(root, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  const opened = await openProject(root)
  const saved = await saveProject(root, opened, opened.revision)
  const written = JSON.parse(await readFile(path.join(root, "minemods.project.json"), "utf8"))
  expect(saved.revision).toBe(original.revision + 1)
  expect(Object.keys(written)).toEqual(Object.keys(original))
  expect({ ...written, revision: original.revision, updated_at: original.updated_at }).toEqual(original)
})

test("an old run record still parses unchanged and the verbatim source rule still holds", async () => {
  const text = await readFile(path.join(fixtures, "run.json"), "utf8")
  const run = ProjectRunSchema.parse(JSON.parse(text))
  expect(`${JSON.stringify(run, null, 2)}\n`).toBe(text)
  const task = { key: "world", module: "worldview" as const, title: "世界观", prompt: "创建世界观", source: "创建世界观", dependencies: [], target_id: null }
  expect(validateRoutePlan({ summary: "计划", questions: [], tasks: [task] }, { prompt: "请创建世界观", assets: [] }).tasks).toHaveLength(1)
  expect(() => validateRoutePlan({ summary: "计划", questions: [], tasks: [{ ...task, source: "别的话" }] }, { prompt: "请创建世界观", assets: [] })).toThrow("任务没有对应的原始需求")
  expect(() => validateRoutePlan({ summary: "计划", questions: [], tasks: [{ ...task, source: "blueprint:world" }] }, { prompt: "请创建世界观", assets: [] })).toThrow("任务没有对应的原始需求")
})

test("the build manifest keeps its old fields and additionally lists every built workspace asset", async () => {
  const project = ProjectSchema.parse(JSON.parse(await readFile(path.join(fixtures, "project.json"), "utf8")))
  const manifest = JSON.parse(await readFile(path.join(fixtures, "build-manifest.json"), "utf8"))
  expect(Object.keys(manifest)).toEqual([
    "schema_version", "project_id", "revision", "profile", "asset_origins", "asset_ids", "asset_revisions", "entity_revisions", "texture_asset_ids", "texture_revisions", "provenances",
  ])
  const built = builtWorkspaceAssets(project)
  // Everything the build compiles is listed; the standalone animation and the four design documents are not.
  expect(built.map((asset) => asset.module)).toEqual(["model", "texture", "block", "item", "recipe", "entity", "logic"])
  expect(built.every((asset) => project.workspace.assets.some((value) => value.id === asset.id && value.revision === asset.revision))).toBe(true)
  expect(built.find((asset) => asset.module === "texture")).toEqual({ id: manifest.texture_asset_ids[0], module: "texture", revision: manifest.texture_revisions[0] })
  expect(built.find((asset) => asset.module === "entity")?.revision).toBe(manifest.entity_revisions[0])
})

test("content that drifted from its workspace asset is not reported as built", async () => {
  const project = ProjectSchema.parse(JSON.parse(await readFile(path.join(fixtures, "project.json"), "utf8")))
  const drifted = { ...project, items: project.items.map((item) => ({ ...item, max_stack: 1 })) }
  expect(builtWorkspaceAssets(drifted).some((asset) => asset.module === "item")).toBe(false)
  expect(builtWorkspaceAssets(drifted).some((asset) => asset.module === "block")).toBe(true)
})

// build-source.json holds the SHA-256 of every file a build of this project assembled before gestures
// existed. A kind added later must leave a project that does not use it building exactly the same.
// The Java files' hashes there: names only (Yarn → Mojang), checked 2026-11-14 (StudioContent, StudioContentRegistry, StudioLuckyCaches, StudioCreatureRenderer, StudioCreature).
// build.gradle, gradle.properties, README.md and README-STUDIO.md: the switch to official mappings only (officialMojangMappings, no yarn_mappings), checked 2026-11-14.
test("an old project without gestures assembles byte for byte the same build source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-legacy-"))
  roots.push(root)
  const original = JSON.parse(await readFile(path.join(fixtures, "project.json"), "utf8"))
  await cp(path.join(fixtures, "project.json"), path.join(root, "minemods.project.json"))
  await mkdir(path.join(root, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(path.join(fixtures, "model-asset.json"), path.join(root, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(root, source, fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)))
  const names = (await readdir(source, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
    .sort()
  const hashes = Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        const bytes = await readFile(path.join(source, name))
        // The two scaffolded files that print the current year are compared with the year masked.
        const stable = ["LICENSE", "README.md"].includes(name) ? Buffer.from(bytes.toString("utf8").replaceAll(String(new Date().getFullYear()), "{{year}}")) : bytes
        return [name, createHash("sha256").update(stable).digest("hex")]
      }),
    ),
  )
  expect(hashes).toEqual(JSON.parse(await readFile(path.join(fixtures, "build-source.json"), "utf8")))
  expect(names.some((name) => /gesture|playerAnimator/i.test(name))).toBe(false)
  // Nor anything of the data-only features (generation, tool tiers, glow): this project uses none of them.
  expect(names.some((name) => /worldgen|StudioWorldgen|glowmask|needs_[a-z]+_tool/.test(name))).toBe(false)
})

// Idea cards and the activity log lie beside the project and are never read by a build: with both present,
// the same old project still assembles the same files, byte for byte, and its project file is not touched.
test("idea cards and an activity log beside an old project change nothing a build assembles", async () => {
  const { changeIdeas, requireOnly } = await import("../src/blueprint-ideas")
  const { noteActivity, readActivity } = await import("../src/activity")
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-legacy-"))
  roots.push(root)
  const original = JSON.parse(await readFile(path.join(fixtures, "project.json"), "utf8"))
  await cp(path.join(fixtures, "project.json"), path.join(root, "minemods.project.json"))
  await mkdir(path.join(root, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(path.join(fixtures, "model-asset.json"), path.join(root, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  // An old project has neither record, and reading them creates nothing.
  expect((await readActivity(root)).events).toEqual([])
  expect((await readdir(path.join(root, ".minemods"))).sort()).toEqual(["assets"])
  await changeIdeas(root, (current) => requireOnly(current, { request: "剑现在只能是普通物品，不要爆炸", by: "studio", quotes: [] }))
  await noteActivity(root, { kind: "build", mark: "run", item: null, title: null, text: "开始把做好的东西打包成模组。" })
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(root, source, fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)))
  const expected = JSON.parse(await readFile(path.join(fixtures, "build-source.json"), "utf8")) as Record<string, string>
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
  expect(names.sort()).toEqual(Object.keys(expected).sort())
  const plain = names.filter((name) => !["LICENSE", "README.md"].includes(name))
  const hashes = await Promise.all(plain.map(async (name) => createHash("sha256").update(await readFile(path.join(source, name))).digest("hex")))
  expect(hashes).toEqual(plain.map((name) => expected[name]!))
  expect(await readFile(path.join(root, "minemods.project.json"), "utf8")).toBe(await readFile(path.join(fixtures, "project.json"), "utf8"))
})

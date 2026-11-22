import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { contentName } from "../src/asset-name"
import { BossSchema } from "../src/entity-runtime"
import { modGuide } from "../src/guide"
import type { Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const TASK_TITLE = "巨龙通过版本确认"
const lair = { biomes: [] as string[], tags: ["is_mountain"], above_sea: 80, spacing: 40, radius: 12, floor: ["azure_ore", "minecraft:packed_ice"], rim: "minecraft:snow_block", clearance: 6 }

/** The sample's hostile golem, with the lair and the spawn the test asks for, and the title its making task gave its asset. */
async function bossProject(options: { lair: boolean; spawn: boolean; title?: string }): Promise<Project> {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-guide-lair-"))
  roots.push(root)
  const sample = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const boss = BossSchema.parse({ bar: { color: "blue", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 2, xp_bursts: 2, explosion: false }, leash: null, ...(options.lair ? { lair } : {}) })
  const asset = sample.workspace.assets.find((value) => value.document.kind === "entity")!
  const document = asset.document as Extract<typeof asset.document, { kind: "entity" }>
  const spawn = options.spawn ? document.runtime?.spawn ?? { biomes: [], tags: ["is_overworld"], weight: 10, min: 1, max: 2 } : null
  const entity = sample.entities.find((value) => value.id === document.model_asset_id)!
  return {
    ...sample,
    entities: sample.entities.map((value) => (value === entity ? { ...entity, boss, runtime: { ...entity.runtime!, spawn } } : value)),
    workspace: { assets: sample.workspace.assets.map((value) => (value === asset ? { ...asset, title: options.title ?? asset.title, document: { ...document, boss, runtime: { ...document.runtime, spawn } } } : value)) },
  } as Project
}

const guideOf = (project: Project) => {
  const animations = Object.fromEntries(project.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]]))
  return modGuide(project, { findings: reconcile(project, { animations }), animations, glowing: [], built: false })
}
const creatureLines = (project: Project) => guideOf(project).sections.find((section) => section.creature !== undefined)!.lines.map((line) => line.text)

test("a creature with a lair is never told it does not appear by itself, and the guide says where the lair is", async () => {
  const project = await bossProject({ lair: true, spawn: false })
  const entity = project.entities.find((value) => value.boss)!
  const guide = guideOf(project)
  const all = guide.sections.flatMap((section) => section.lines.map((line) => line.text))
  expect(all.some((text) => text.includes("不会自己出现"))).toBe(false)
  const lines = creatureLines(project)
  const found = lines.filter((text) => text.includes("它的巢随世界一起生成"))
  expect(found).toHaveLength(1)
  expect(found[0]).toContain(`/locate structure ${project.mod_id}:creature_${entity.id.replaceAll("-", "")}_lair`)
  expect(found[0]).toContain("只有新生成的区块里才有")
  // The walk through the world says the same thing as the creature's section.
  expect(guide.markdown.match(/它的巢随世界一起生成/g)!.length).toBeGreaterThanOrEqual(2)
})

test("a lair and a spawn are both ways to meet it; without a lair or a spawn it still does not appear by itself", async () => {
  const both = await bossProject({ lair: true, spawn: true })
  const lines = creatureLines(both)
  expect(lines.some((text) => text.startsWith("会自己出现在这些群系"))).toBe(true)
  expect(lines.some((text) => text.includes("它的巢随世界一起生成"))).toBe(true)
  expect(lines.some((text) => text.includes("不会自己出现"))).toBe(false)

  const bare = await bossProject({ lair: false, spawn: false })
  expect(creatureLines(bare).filter((text) => text.startsWith("不会自己出现："))).toHaveLength(1)
  expect(guideOf(bare).markdown).not.toContain("它的巢随世界一起生成")

  // A creature that spawns on its own is not told it does not.
  const spawning = await bossProject({ lair: false, spawn: true })
  expect(creatureLines(spawning).some((text) => text.includes("不会自己出现"))).toBe(false)
})

test("reconciliation does not call a creature with a lair unreachable", async () => {
  const lang = { zh_cn: {}, en_us: {} }
  const reached = (project: Project) => reconcile(project, { animations: Object.fromEntries(project.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]])), built: { lang, files: [] } }).filter((finding) => finding.rule === "creature_unreachable")
  expect(reached(await bossProject({ lair: true, spawn: false }))).toEqual([])
  expect(reached(await bossProject({ lair: false, spawn: false })).length).toBe(1)
})

test("the guide names content by its own name, never by the title of the task that made it", async () => {
  const project = await bossProject({ lair: true, spawn: false, title: TASK_TITLE })
  const entity = project.entities.find((value) => value.boss)!
  const asset = project.workspace.assets.find((value) => value.document.kind === "entity")!
  expect(asset.title).toBe(TASK_TITLE)
  expect(entity.name).not.toBe(TASK_TITLE)
  expect(contentName(asset)).toBe((asset.document as { name: string }).name)
  const guide = guideOf(project)
  expect(guide.markdown).not.toContain(TASK_TITLE)
  expect(guide.markdown).toContain(`「${entity.name}」`)
  // Only a kind with no name of its own keeps its title.
  expect(contentName({ title: "效果名", document: { kind: "effect" } })).toBe("效果名")
  expect(contentName({ title: "动作", document: { kind: "animation", name: "walk" } })).toBe("动作")
})

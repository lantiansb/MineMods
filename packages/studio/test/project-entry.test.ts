import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { createStudioService } from "../src/main/service"
import { StudioRequestSchema } from "../src/main/protocol"
import { SettingsSchema } from "../src/settings"
import { deriveModId } from "../src/mod-id"

const roots: string[] = []
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "obsidian-entry-"))
  roots.push(root)
  const options = { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} }
  return { root, options, service: await createStudioService(options) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

test("新建工程只问名字：Studio 自己起的模组 ID 就是建出来的那个，纯中文名字每次都一样", async () => {
  const f = await setup()
  // Exactly what the 新建模组工程 form sends.
  for (const name of ["赤铜飞行社", "Copper Aviary", "3D 工坊", "x".repeat(120)]) {
    const input = { name, description: "", empty: true, modId: deriveModId(name) }
    expect(StudioRequestSchema.safeParse({ method: "createProject", input }).success).toBe(true)
    expect((await f.service.createProject(input)).project.mod_id).toBe(deriveModId(name))
  }
  expect(deriveModId("赤铜飞行社")).toMatch(/^mod_[0-9a-z]{7}$/)
})

test("new studio flow creates an empty named project then adds selected entities", async () => {
  const f = await setup()
  const empty = await f.service.createProject({ name: "赤铜飞行社", description: "", empty: true, modId: "copper_aviary", javaMajor: 21, minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2" })
  expect(empty.project.entities).toHaveLength(0)
  expect(empty.project.mod_id).toBe("copper_aviary")
  const first = await f.service.addEntity({ projectId: empty.project.id, expectedRevision: empty.project.revision, name: "铜鸮" })
  const second = await f.service.addEntity({ projectId: first.project.id, expectedRevision: first.project.revision, name: "守卫" })
  expect(second.project.entities).toHaveLength(2)
  expect(second.entity_id).toBe(second.project.entities[1].id)
  expect((await f.service.selectEntity({ projectId: first.project.id, entityId: first.entity_id! })).entity_id).toBe(first.entity_id)
})

test("native granted location persists across restart, arbitrary tokens do not work", async () => {
  const f = await setup()
  const outside = path.join(f.root, "chosen")
  await mkdir(outside)
  const token = randomUUID()
  await f.service.registerLocation(token, outside)
  const created = await f.service.createProject({ name: "Outside", description: "", empty: true, locationToken: token })
  expect(path.dirname(created.directory)).toBe(outside)
  const restarted = await createStudioService(f.options)
  expect((await restarted.listProjects()).map(entry => entry.project.id)).toContain(created.project.id)
  expect((await restarted.openProject(created.project.id)).project.id).toBe(created.project.id)
  await expect(f.service.createProject({ name: "Denied", description: "", locationToken: randomUUID() })).rejects.toThrow()
  expect(StudioRequestSchema.safeParse({ method: "registerLocation", input: { token, directory: outside } }).success).toBe(false)
})

test("unsupported environments are rejected and settings persist", async () => {
  const f = await setup()
  expect(StudioRequestSchema.safeParse({ method: "createProject", input: { name: "No", description: "", javaMajor: 17 } }).success).toBe(false)
  expect((await f.service.getSettings()).modelComplexity).toBe("medium")
  await f.service.saveSettings({ nickname: "铜工", avatar: "forest", language: "zh-CN", reducedMotion: true, theme: "craft", modelComplexity: "high" })
  expect((await (await createStudioService(f.options)).getSettings()).modelComplexity).toBe("high")
})

test("settings keep one look and migrate retired themes", () => {
  expect(SettingsSchema.parse({}).theme).toBe("craft")
  for (const theme of ["block", "night", "ivory", "obsidian", "forest", "dusk"])
    expect(SettingsSchema.parse({ theme }).theme).toBe("craft")
})

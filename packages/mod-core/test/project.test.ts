import { afterEach, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { once } from "node:events"
import os from "node:os"
import path from "node:path"
import { createEntity, createProject, listProjects, openProject, OWNERLESS_LOCK_MS, ProjectLockedError, projectTargets, ProjectSchema, saveProject, withProjectLock } from "../src/project"
import { loadModelAsset, putModelAsset } from "../src/assets"

const directories: string[] = []

async function directory() {
  const value = await mkdtemp(path.join(os.tmpdir(), "studio-项目-'"))
  directories.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true })))
})

test("creates, saves and reopens a project at a Unicode and quoted path", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "星光 鹿's" })
  expect(project.mod_id).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
  expect(project.schema_version).toBe(1)
  expect(project.target).toBe("fabric-1.21.1")
  expect(project.revision).toBe(0)
  expect(await openProject(root)).toEqual(project)
  const saved = await saveProject(root, { ...project, entities: [createEntity({ name: "星光鹿" })] }, 0)
  expect(saved.revision).toBe(1)
  expect(saved.entities[0]?.health).toBe(20)
  expect(await openProject(root)).toEqual(saved)
})

test("重复打开不共享可变数据，外部同版本编辑让缓存失效", async () => {
  const root = await directory()
  const original = await createProject({ directory: root, name: "雪原" })
  const first = await openProject(root)
  first.name = "只改内存"
  expect((await openProject(root)).name).toBe("雪原")
  await writeFile(path.join(root, "minemods.project.json"), JSON.stringify({ ...original, name: "冰湖" }))
  expect((await openProject(root)).name).toBe("冰湖")
})

test("一个工程可以做给几个目标：老工程只有主目标，原样写回；目标列表主目标在前、不重复", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "蚩尤", target: "forge-1.20.1" })
  expect(project.target).toBe("forge-1.20.1")
  expect("targets" in project).toBe(false)
  expect(projectTargets(project)).toEqual(["forge-1.20.1"])
  const saved = await saveProject(root, { ...project, targets: ["forge-1.20.1", "fabric-1.21.1"] }, 0)
  expect(projectTargets(saved)).toEqual(["forge-1.20.1", "fabric-1.21.1"])
  expect((await openProject(root)).targets).toEqual(["forge-1.20.1", "fabric-1.21.1"])
  expect(JSON.parse(await readFile(path.join(root, "minemods.project.json"), "utf8"))).toMatchObject({ target: "forge-1.20.1", targets: ["forge-1.20.1", "fabric-1.21.1"] })
  expect(() => ProjectSchema.parse({ ...project, targets: ["fabric-1.21.1", "forge-1.20.1"] })).toThrow("primary target first")
  expect(() => ProjectSchema.parse({ ...project, targets: ["forge-1.20.1", "forge-1.20.1"] })).toThrow("each target once")
  expect(() => ProjectSchema.parse({ ...project, target: "quilt-1.21.1" })).toThrow()
})

test("accepts an explicit mod ID and defaults new content collections", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "铜鸮", mod_id: "copper_aviary" })
  expect(project.mod_id).toBe("copper_aviary")
  expect(project.blocks).toEqual([])
  expect(project.items).toEqual([])
  expect(project.recipes).toEqual([])
  expect(project.logic).toEqual([])
  expect(await openProject(root)).toEqual(project)
})

test("reads schema1 manifests written before content collections existed", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "Legacy" })
  const legacy = { ...project }
  delete (legacy as Partial<typeof project>).blocks
  delete (legacy as Partial<typeof project>).items
  delete (legacy as Partial<typeof project>).recipes
  delete (legacy as Partial<typeof project>).logic
  await writeFile(path.join(root, "minemods.project.json"), `${JSON.stringify(legacy)}\n`)
  expect(await openProject(root)).toMatchObject({ schema_version: 1, blocks: [], items: [], recipes: [], logic: [] })
})

test("serializes concurrent writes and rejects a stale revision", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "Forest" })
  const writes = await Promise.allSettled([
    saveProject(root, { ...project, name: "First" }, 0),
    saveProject(root, { ...project, name: "Second" }, 0),
  ])
  expect(writes.filter((value) => value.status === "fulfilled")).toHaveLength(1)
  expect(writes.filter((value) => value.status === "rejected")).toHaveLength(1)
  expect((await openProject(root)).revision).toBe(1)
})

test("invalid input and malformed manifests leave the previous bytes intact", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "Forest" })
  const before = await readFile(path.join(root, "minemods.project.json"), "utf8")
  await expect(saveProject(root, { ...project, unexpected: true } as typeof project, 0)).rejects.toThrow()
  expect(await readFile(path.join(root, "minemods.project.json"), "utf8")).toBe(before)
  await writeFile(path.join(root, "minemods.project.json"), "{broken")
  await expect(saveProject(root, project, 0)).rejects.toThrow()
  await expect(createProject({ directory: root, name: "Replacement" })).rejects.toThrow()
  expect(await readFile(path.join(root, "minemods.project.json"), "utf8")).toBe("{broken")
})

test("commits model versions with truthful provenance and retains previous assets", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "Forest" })
  const entity = createEntity({ name: "Deer" })
  const project = await saveProject(root, { ...created, entities: [entity] }, 0)
  const first = await putModelAsset(root, {
    entity_id: entity.id,
    data: { cubes: [1] },
    origin: "example",
    expectedRevision: project.revision,
  })
  expect(first.asset.origin).toBe("example")
  expect(first.project.entities[0]?.model_asset_id).toBe(first.asset.id)
  const second = await putModelAsset(root, {
    entity_id: entity.id,
    data: { cubes: [2] },
    origin: "manual",
    expectedRevision: first.project.revision,
  })
  expect(second.asset.id).toBe(first.asset.id)
  expect(second.asset.revision).toBe(2)
  expect(await loadModelAsset(root, first.asset.id, 1)).toEqual(first.asset)
  expect(await loadModelAsset(root, first.asset.id)).toEqual(second.asset)
  await expect(
    putModelAsset(root, { entity_id: entity.id, data: {}, origin: "gpt-6-astra", expectedRevision: project.revision }),
  ).rejects.toThrow(/revision/i)
  expect(await openProject(root)).toEqual(second.project)
})

test("missing and corrupted dependencies prevent project saves", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "Forest" })
  const entity = createEntity({ name: "Deer" })
  const project = await saveProject(root, { ...created, entities: [entity] }, 0)
  const saved = await putModelAsset(root, {
    entity_id: entity.id,
    data: {},
    origin: "manual",
    expectedRevision: project.revision,
  })
  const file = path.join(root, ".minemods", "assets", saved.asset.id, "1.json")
  await writeFile(file, "{}")
  await expect(openProject(root)).rejects.toThrow()
  await expect(saveProject(root, saved.project, saved.project.revision)).rejects.toThrow()
  await rm(file)
  await expect(openProject(root)).rejects.toThrow()
})

test("an orphaned asset revision from an interrupted commit remains intact and does not block retry", async () => {
  const root = await directory()
  const created = await createProject({ directory: root, name: "Forest" })
  const entity = createEntity({ name: "Deer" })
  const project = await saveProject(root, { ...created, entities: [entity] }, 0)
  const first = await putModelAsset(root, {
    entity_id: entity.id,
    data: { cubes: [1] },
    origin: "manual",
    expectedRevision: project.revision,
  })
  const orphan = path.join(root, ".minemods", "assets", first.asset.id, "2.json")
  await writeFile(orphan, "{interrupted")
  const retried = await putModelAsset(root, {
    entity_id: entity.id,
    data: { cubes: [3] },
    origin: "manual",
    expectedRevision: first.project.revision,
  })
  expect(retried.asset.revision).toBe(3)
  expect(await readFile(orphan, "utf8")).toBe("{interrupted")
  expect(await loadModelAsset(root, first.asset.id, 1)).toEqual(first.asset)
})

test("an abandoned transaction lock fails closed while the last project remains readable", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "Forest" })
  await mkdir(path.join(root, ".minemods", "write.lock"))
  expect(await openProject(root)).toEqual(project)
  await expect(saveProject(root, project, 0)).rejects.toThrow(/write lock/i)
  expect(await openProject(root)).toEqual(project)
})

// ---- a lock left by a writer that is gone (2026-11-17: Studio ended in the middle of a write, and every call after the restart was refused) ----

const lockOf = (root: string) => path.join(root, ".minemods", "write.lock")
const sign = (root: string, owner: Record<string, unknown>) => mkdir(lockOf(root)).then(() => writeFile(path.join(lockOf(root), "owner.json"), JSON.stringify({ host: os.hostname(), at: new Date().toISOString(), ...owner })))
const refusal = (root: string) =>
  withProjectLock(root, async () => "written").then(
    (value) => value,
    (error: unknown) => error,
  )
/** A process that has ended: its number is one nobody is running under (the system does not hand a number out again that fast). */
async function gone() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" })
  await once(child, "exit")
  return child.pid!
}

test("the lock says who holds it while it is held, and is gone after", async () => {
  const root = await directory()
  await createProject({ directory: root, name: "Forest" })
  const owner = await withProjectLock(root, async () => JSON.parse(await readFile(path.join(lockOf(root), "owner.json"), "utf8")) as Record<string, unknown>)
  expect([owner.pid, owner.host, typeof owner.token, Number.isNaN(Date.parse(String(owner.at)))]).toEqual([process.pid, os.hostname(), "string", false])
  expect(await stat(lockOf(root)).catch(() => null)).toBeNull()
})

test("a lock whose writer is gone is taken over, and the write goes through", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "Forest" })
  await sign(root, { pid: await gone(), token: "the-studio-that-was-ended" })
  const saved = await saveProject(root, { ...project, entities: [createEntity({ name: "Deer" })] }, 0)
  expect(saved.revision).toBe(1)
  expect(await stat(lockOf(root)).catch(() => null)).toBeNull()
  expect(await stat(`${lockOf(root)}.takeover`).catch(() => null)).toBeNull()
})

test("a lock whose writer is running is never taken: the refusal says who holds it", async () => {
  const root = await directory()
  const project = await createProject({ directory: root, name: "Forest" })
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" })
  try {
    await sign(root, { pid: other.pid, token: "another-studio" })
    const refused = await refusal(root)
    expect(refused).toBeInstanceOf(ProjectLockedError)
    expect([(refused as ProjectLockedError).code, (refused as ProjectLockedError).holder?.pid, (refused as ProjectLockedError).alive]).toEqual(["PROJECT_WRITE_LOCKED", other.pid, true])
    // Still theirs: nothing of it was touched, and the project reads as it was.
    expect(JSON.parse(await readFile(path.join(lockOf(root), "owner.json"), "utf8")).token).toBe("another-studio")
    expect(await openProject(root)).toEqual(project)
  } finally {
    other.kill()
    await once(other, "exit")
  }
  // Once that process has ended the same lock is an abandoned one.
  expect(await refusal(root)).toBe("written")
})

test("a lock that cannot be told to be abandoned is kept: another computer's, this process's number under another token, a fresh one with no owner", async () => {
  const root = await directory()
  await createProject({ directory: root, name: "Forest" })
  for (const owner of [
    { pid: await gone(), token: "elsewhere", host: `${os.hostname()}-another-computer` },
    { pid: process.pid, token: "not-this-process" },
  ]) {
    await sign(root, owner)
    const refused = await refusal(root)
    expect([refused instanceof ProjectLockedError, (refused as ProjectLockedError).alive, (refused as ProjectLockedError).holder?.token]).toEqual([true, null, owner.token])
    await rm(lockOf(root), { recursive: true })
  }
  // No owner written (a Studio from before owners, r12 and older): kept while an operation could still be running under it...
  await mkdir(lockOf(root))
  const refused = await refusal(root)
  expect([refused instanceof ProjectLockedError, (refused as ProjectLockedError).holder, (refused as ProjectLockedError).alive]).toEqual([true, null, null])
  // ...and taken over once it is older than any operation runs.
  const old = new Date(Date.now() - OWNERLESS_LOCK_MS - 60000)
  await utimes(lockOf(root), old, old)
  expect(await refusal(root)).toBe("written")
})

test("of many writers that find the same abandoned lock at once, each in its own process, every write lands once and none is lost", async () => {
  const root = await directory()
  await createProject({ directory: root, name: "Forest" })
  await sign(root, { pid: await gone(), token: "the-studio-that-was-ended" })
  const counter = path.join(root, "counter.txt")
  await writeFile(counter, "0")
  // Each process retries while another holds the lock, then reads, waits and writes the number back plus one under it: two inside at once would lose a count.
  const script = `
    const { withProjectLock, ProjectLockedError } = require(${JSON.stringify(path.join(import.meta.dir, "..", "src", "project.ts"))})
    const { readFile, writeFile } = require("node:fs/promises")
    const once = () => withProjectLock(${JSON.stringify(root)}, async () => {
      const value = Number(await readFile(${JSON.stringify(counter)}, "utf8"))
      await new Promise((resolve) => setTimeout(resolve, 15))
      await writeFile(${JSON.stringify(counter)}, String(value + 1))
    })
    const attempt = (left) => once().catch((error) => {
      if (!(error instanceof ProjectLockedError) || left === 0) throw error
      return new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20)).then(() => attempt(left - 1))
    })
    attempt(2000).then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
  `
  const writers = Array.from({ length: 6 }, () => spawn(process.execPath, ["-e", script], { stdio: ["ignore", "ignore", "inherit"] }))
  const codes = await Promise.all(writers.map((writer) => once(writer, "exit").then(([code]) => code)))
  expect(codes).toEqual([0, 0, 0, 0, 0, 0])
  expect(await readFile(counter, "utf8")).toBe("6")
  expect(await stat(lockOf(root)).catch(() => null)).toBeNull()
}, 120000)

test("project backups remain portable and discovery only returns valid project directories", async () => {
  const root = await directory()
  const source = path.join(root, "source")
  const backup = path.join(root, "备份 ' moved")
  const created = await createProject({ directory: source, name: "Forest" })
  const entity = createEntity({ name: "Deer" })
  const project = await saveProject(source, { ...created, entities: [entity] }, 0)
  const saved = await putModelAsset(source, {
    entity_id: entity.id,
    data: {},
    origin: "example",
    expectedRevision: project.revision,
  })
  await cp(source, backup, { recursive: true })
  await rm(source, { recursive: true })
  await mkdir(path.join(root, "unrelated"))
  expect(await openProject(backup)).toEqual(saved.project)
  expect(await listProjects(root)).toEqual([{ directory: backup, project: saved.project }])
})

test("rejects asset traversal and symlinked storage without writing outside the project", async () => {
  const root = await directory()
  const outside = await directory()
  const project = await createProject({ directory: root, name: "Forest" })
  await expect(loadModelAsset(root, "../../escape")).rejects.toThrow()
  await symlink(outside, path.join(root, ".minemods", "assets"), process.platform === "win32" ? "junction" : "dir")
  const entity = createEntity({ name: "Deer" })
  const saved = await saveProject(root, { ...project, entities: [entity] }, 0)
  await expect(
    putModelAsset(root, { entity_id: entity.id, data: {}, origin: "manual", expectedRevision: saved.revision }),
  ).rejects.toThrow(/symbolic|symlink/i)
})

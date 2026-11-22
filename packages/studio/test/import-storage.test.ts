import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { ImportProjectManifestSchema, ImportProjectReportSchema } from "@minemods/mod-core/import-project"
import { zip } from "./fixtures/zip"
import { dispatchStudioRequest, createStudioService } from "../src/main/service"
import { StudioRequestSchema, WorkerRequestSchema } from "../src/main/protocol"
import { LibraryTaskSchema } from "../src/library"
import { createLibraryService } from "../src/main/library-service"
import { readCatalog, recordItem } from "@minemods/mod-core/store/catalog"

const ImportedProjectSchema = z.strictObject({
  directory: z.string(),
  manifest: ImportProjectManifestSchema,
  report: ImportProjectReportSchema,
})
const ImportedProjectsSchema = z.array(ImportedProjectSchema)
const ExportResultSchema = z.strictObject({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const EnvironmentRemovalSchema = z.discriminatedUnion("deleted", [
  z.strictObject({
    deleted: z.literal(false),
    confirmationRequired: z.literal(true),
    impactedProjects: z.array(z.strictObject({ projectId: z.string(), projectName: z.string().nullable() })),
  }),
  z.strictObject({
    deleted: z.literal(true),
    confirmationRequired: z.literal(false),
    impactedProjects: z.array(z.strictObject({ projectId: z.string(), projectName: z.string().nullable() })),
  }),
])

const setups: { root: string; service: Awaited<ReturnType<typeof createStudioService>> }[] = []

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-import-storage-"))
  const service = await createStudioService({
    workspaceDirectory: path.join(root, "projects"),
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: path.join(root, "templates"),
    ai: {},
  })
  const value = { root, service }
  setups.push(value)
  return value
}

afterEach(async () => {
  await Promise.all(
    setups.splice(0).map(async ({ root, service }) => {
      await service.dispose()
      await rm(root, { recursive: true, force: true })
    }),
  )
})

async function waitForTask(service: Awaited<ReturnType<typeof createStudioService>>, id: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const task = LibraryTaskSchema.parse(
      await dispatchStudioRequest(service, { method: "getLibraryTask", input: { id } }),
    )
    if (task.state === "completed" || task.state === "failed" || task.state === "canceled") return task
    await Bun.sleep(20)
  }
  throw new Error(`Import task did not finish before deadline: ${id}`)
}

test("worker-only import dispatch scans, saves, exports, and deletes independently of the source file", async () => {
  const f = await setup()
  const request = { method: "startImportSource", input: { filename: "C:\\local\\sample.jar" } }
  expect(StudioRequestSchema.safeParse(request).success).toBe(false)
  expect(WorkerRequestSchema.safeParse(request).success).toBe(true)

  const source = path.join(f.root, "sample.jar")
  const jar = zip({
    "fabric.mod.json": JSON.stringify({
      id: "sample_mod",
      name: "Sample Mod",
      version: "1.2.3",
      depends: { minecraft: "1.21.1" },
    }),
    "sample/Example.class": "bytecode placeholder",
  })
  await writeFile(source, jar)
  const originalHash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex")

  const started = LibraryTaskSchema.parse(
    await dispatchStudioRequest(f.service, { method: "startImportSource", input: { filename: source } }),
  )
  const task = await waitForTask(f.service, started.id)
  expect(task.state).toBe("completed")
  expect(task.resultId).toBeTruthy()
  const importedId = z.uuid().parse(task.resultId)

  const listed = ImportedProjectsSchema.parse(
    await dispatchStudioRequest(f.service, { method: "listImportedProjects" }),
  )
  expect(listed).toHaveLength(1)
  expect(listed[0]?.manifest.id).toBe(importedId)
  expect(listed[0]?.report.id).toBe(importedId)
  expect(listed[0]?.report.metadata.loaders).toContain("fabric")

  const detail = ImportedProjectSchema.parse(
    await dispatchStudioRequest(f.service, { method: "getImportedProject", input: { id: importedId } }),
  )
  expect(detail.manifest.id).toBe(importedId)
  const exportedPath = path.join(f.root, "sample.modscan")
  const exported = ExportResultSchema.parse(
    await dispatchStudioRequest(f.service, {
      method: "exportImportedReportTo",
      input: { id: importedId, destination: exportedPath },
    }),
  )
  expect(exported.path).toBe(exportedPath)
  expect(JSON.parse(await readFile(exportedPath, "utf8"))).toMatchObject({
    format: "minemods-import-report",
    report: { id: importedId },
  })

  await dispatchStudioRequest(f.service, { method: "deleteImportedProject", input: { id: importedId } })
  expect(await dispatchStudioRequest(f.service, { method: "listImportedProjects" })).toHaveLength(0)
  expect(
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
  ).toBe(originalHash)
})

test("environment cleanup confirms project impact and removes only managed Gradle cache", async () => {
  const f = await setup()
  const project = await f.service.createProject({ name: "Cache reference", description: "" })
  const cache = path.join(f.root, "runtime", "gradle-home")
  const connection = path.join(f.root, "runtime", "connection.json")
  await mkdir(cache, { recursive: true })
  await writeFile(path.join(cache, "artifact.bin"), "cached bytes")
  await writeFile(connection, "connection settings")

  const listed = await f.service.library.listEnvironmentStorage()
  expect(listed.items.find((item) => item.id === "gradle-home")).toMatchObject({
    bytes: Buffer.byteLength("cached bytes"),
    referencedBy: [{ projectId: project.project.id, projectName: project.project.name }],
  })
  const confirmation = EnvironmentRemovalSchema.parse(
    await dispatchStudioRequest(f.service, { method: "removeEnvironment", input: { id: "gradle-home" } }),
  )
  expect(confirmation).toMatchObject({
    deleted: false,
    confirmationRequired: true,
    impactedProjects: [{ projectId: project.project.id }],
  })

  const removed = EnvironmentRemovalSchema.parse(
    await dispatchStudioRequest(f.service, {
      method: "removeEnvironment",
      input: { id: "gradle-home", confirmReferenced: true },
    }),
  )
  expect(removed).toMatchObject({ deleted: true, impactedProjects: [{ projectId: project.project.id }] })
  expect(await f.service.listProjects()).toHaveLength(1)
  expect(await readFile(connection, "utf8")).toBe("connection settings")
  await expect(
    dispatchStudioRequest(f.service, {
      method: "removeEnvironment",
      input: { id: "external-java", confirmReferenced: true },
    }),
  ).rejects.toThrow()
  await expect(
    dispatchStudioRequest(f.service, {
      method: "removeEnvironment",
      input: { id: "unknown-cache", confirmReferenced: true },
    }),
  ).rejects.toThrow()
})

test("「清理没用的」只清资源清单里没人用的东西；有谁在下载、构建或试玩时不清", async () => {
  const f = await setup()
  const runtime = path.join(f.root, "runtime")
  for (const name of ["old", "inst"]) {
    await mkdir(path.join(runtime, "store", name), { recursive: true })
    await writeFile(path.join(runtime, "store", name, "file.bin"), "12345")
  }
  const base = { kind: "loader" as const, bytes: 5, source: "bmclapi", sha256: null, installed_at: "2026-11-14T00:00:00.000Z" }
  await recordItem(runtime, { ...base, id: "loader:old", title: "旧加载器", path: "store/old" })
  await recordItem(runtime, { ...base, id: "loader:inst", title: "Forge 加载器", path: "store/inst", users: ["target:forge-1.20.1"] })

  expect(StudioRequestSchema.safeParse({ method: "cleanUnusedEnvironment" }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "cleanUnusedEnvironment", input: { id: "loader:inst" } }).success).toBe(false)
  const listed = await f.service.library.listEnvironmentStorage()
  expect(listed.items.find((item) => item.id === "loader:inst")).toMatchObject({ type: "store", title: "Forge 加载器", source: "bmclapi", neededBy: ["forge-1.20.1"] })

  const busy = createLibraryService({
    workspaceDirectory: path.join(f.root, "projects"),
    runtimeDirectory: runtime,
    references: async () => [],
    runtimeBusy: () => true,
    publicError: String,
  })
  await expect(busy.cleanUnusedEnvironment()).rejects.toThrow("环境正在下载、构建或试玩")
  expect((await readCatalog(runtime)).items.map((item) => item.id)).toContain("loader:old")

  const cleaned = await dispatchStudioRequest(f.service, { method: "cleanUnusedEnvironment" })
  expect(cleaned).toMatchObject({ removed: ["loader:old"], freedBytes: 5 })
  expect(await lstat(path.join(runtime, "store", "old")).catch(() => null)).toBeNull()
  expect(await readFile(path.join(runtime, "store", "inst", "file.bin"), "utf8")).toBe("12345")
  expect(await dispatchStudioRequest(f.service, { method: "cleanUnusedEnvironment" })).toMatchObject({ removed: [], freedBytes: 0 })
})

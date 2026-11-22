import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { applyImportChanges, exportModifiedImport, getImportContext } from "@minemods/mod-core/import-edit"
import { importProject } from "@minemods/mod-core/import-project"
import { LibraryTaskSchema } from "../src/library"
import { createLibraryService } from "../src/main/library-service"
import { zip } from "./fixtures/zip"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("restores and registers a .modwork, removing a restoration canceled during registration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-import-restoration-"))
  roots.push(root)
  const originalWorkspace = path.join(root, "original-workspace")
  const restoredWorkspace = path.join(root, "restored-workspace")
  await Promise.all([mkdir(originalWorkspace), mkdir(restoredWorkspace)])
  const archive = path.join(root, "source.zip")
  await writeFile(archive, zip({ "config/example.json": "{}\n" }))
  const original = await importProject({ workspaceDirectory: originalWorkspace, filename: archive })
  const context = await getImportContext({ workspaceDirectory: originalWorkspace, id: original.manifest.id })
  const evidence = context.evidence.find((item) => item.path === "config/example.json")!
  const applied = await applyImportChanges({
    workspaceDirectory: originalWorkspace,
    id: original.manifest.id,
    parentRevisionId: context.revisionId,
    changeset: {
      schema_version: 1,
      id: crypto.randomUUID(),
      project_id: original.manifest.id,
      source_sha256: original.manifest.source.sha256,
      summary: "Update imported config",
      warnings: [],
      changes: [
        { path: evidence.path, operation: "write", expected_sha256: evidence.sha256, content: '{"enabled":true}\n' },
      ],
    },
  })
  const modwork = path.join(root, "shared.modwork")
  await exportModifiedImport({
    workspaceDirectory: originalWorkspace,
    id: original.manifest.id,
    revisionId: applied.revisionId,
    destination: modwork,
    kind: "project",
  })

  const registrations: { id: string; revisionId: string }[] = []
  const library = createLibraryService({
    workspaceDirectory: restoredWorkspace,
    runtimeDirectory: path.join(root, "runtime"),
    references: async () => [],
    runtimeBusy: () => false,
    publicError: (error) => (error instanceof Error ? error.message : String(error)),
    onRestored: async (input) => {
      registrations.push(input)
    },
  })
  const started = LibraryTaskSchema.parse(library.startImportSource(modwork))
  const deadline = Date.now() + 10_000
  let completed = LibraryTaskSchema.parse(library.getLibraryTask(started.id))
  while (["running", "canceling"].includes(completed.state) && Date.now() < deadline) {
    await Bun.sleep(20)
    completed = LibraryTaskSchema.parse(library.getLibraryTask(started.id))
  }

  expect(completed.state).toBe("completed")
  expect(completed.resultId).toBeTruthy()
  const id = completed.resultId!
  expect(registrations).toEqual([{ id, revisionId: applied.revisionId }])
  const restored = await import("@minemods/mod-core/import-project").then(({ getImportProject }) =>
    getImportProject(restoredWorkspace, id),
  )
  expect(restored.report.id).toBe(id)
  expect(restored.manifest.source.filename).toBe("source.zip")
  expect(await readFile(path.join(restored.directory, "source", "source.zip"))).toEqual(await readFile(archive))
  const restoredContext = await getImportContext({ workspaceDirectory: restoredWorkspace, id })
  expect(restoredContext.revisionId).toBe(applied.revisionId)

  const registered = Promise.withResolvers<void>()
  const cancelingLibrary = createLibraryService({
    workspaceDirectory: restoredWorkspace,
    runtimeDirectory: path.join(root, "runtime"),
    references: async () => [],
    runtimeBusy: () => false,
    publicError: String,
    onRestored: async () => {
      cancelingLibrary.cancelLibraryTask(canceling.id)
      registered.resolve()
    },
  })
  const canceling = cancelingLibrary.startImportSource(modwork)
  await registered.promise
  await cancelingLibrary.dispose()
  expect(cancelingLibrary.getLibraryTask(canceling.id).state).toBe("canceled")
  expect((await cancelingLibrary.listImportedProjects()).map((project) => project.manifest.id)).toEqual([id])
  expect(await Bun.file(modwork).exists()).toBe(true)
})

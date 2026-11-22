import { z } from "zod"

export const LibraryTaskSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["prepare-environment", "scan-import"]),
  state: z.enum(["running", "canceling", "completed", "failed", "canceled"]),
  detail: z.string().max(4000),
  resultId: z.uuid().nullable(),
  error: z.string().max(4000).nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
})

export type LibraryTask = z.infer<typeof LibraryTaskSchema>
export type EnvironmentStorage = Awaited<
  ReturnType<typeof import("@minemods/mod-core/environment").listManagedEnvironment>
>
export type EnvironmentRemoval = Awaited<
  ReturnType<typeof import("@minemods/mod-core/environment").deleteManagedEnvironment>
>
export type EnvironmentCleanup = Awaited<
  ReturnType<typeof import("@minemods/mod-core/environment").cleanUnusedEnvironment>
>
export type ImportedProject = Awaited<ReturnType<typeof import("@minemods/mod-core/import-project").getImportProject>>
export type ImportedProjectList = Awaited<
  ReturnType<typeof import("@minemods/mod-core/import-project").listImportProjects>
>

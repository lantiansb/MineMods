import { randomUUID } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { openProject, RevisionConflictError, storagePath, withProjectLock, writeRecord } from "./project"

export const JobStateSchema = z.enum(["queued", "running", "completed", "failed", "canceled", "interrupted"])
export const JobSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: z.uuid(),
    project_id: z.uuid(),
    project_revision: z.number().int().nonnegative(),
    entity_id: z.uuid().nullable(),
    kind: z.string().trim().min(1).max(80),
    state: JobStateSchema,
    revision: z.number().int().nonnegative(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    input: z.json().nullable(),
    checkpoint: z.json().nullable(),
    output: z.json().nullable(),
    error: z.string().max(16000).nullable(),
  })
  .superRefine((job, context) => {
    if (job.state === "completed" && job.output === null)
      context.addIssue({ code: "custom", message: "Completed jobs require output" })
    if (job.state === "failed" && !job.error)
      context.addIssue({ code: "custom", message: "Failed jobs require an error" })
  })
export type Job = z.infer<typeof JobSchema>
export type JobState = z.infer<typeof JobStateSchema>

const transitions: Record<JobState, JobState[]> = {
  queued: ["running", "failed", "canceled"],
  running: ["completed", "failed", "canceled", "interrupted"],
  completed: [],
  failed: [],
  canceled: [],
  interrupted: [],
}

export async function loadJob(directory: string, id: string) {
  return readProjectJob(directory, id, (await openProject(directory)).id)
}

async function readProjectJob(directory: string, id: string, projectId: string) {
  z.uuid().parse(id)
  const job = JobSchema.parse(
    JSON.parse(await readFile(await storagePath(directory, [".minemods", "jobs", `${id}.json`]), "utf8")),
  )
  if (job.id !== id) throw new Error("Job ID does not match its storage path")
  if (job.project_id !== projectId) throw new Error("Job belongs to a different project")
  return job
}

export async function startJob(
  directory: string,
  input: {
    kind: string
    entity_id?: string
    expectedRevision: number
    input?: unknown
  },
) {
  return withProjectLock(directory, async () => {
    const project = await openProject(directory)
    if (project.revision !== input.expectedRevision)
      throw new RevisionConflictError(input.expectedRevision, project.revision)
    if (input.entity_id && !project.entities.some((entity) => entity.id === input.entity_id))
      throw new Error("Unknown job entity")
    const timestamp = new Date().toISOString()
    const job = JobSchema.parse({
      schema_version: 1,
      id: randomUUID(),
      project_id: project.id,
      project_revision: project.revision,
      entity_id: input.entity_id ?? null,
      kind: input.kind,
      state: "queued",
      revision: 0,
      created_at: timestamp,
      updated_at: timestamp,
      input: input.input ?? null,
      checkpoint: null,
      output: null,
      error: null,
    })
    await writeRecord(directory, [".minemods", "jobs", `${job.id}.json`], job)
    return job
  })
}

async function persistJob(
  directory: string,
  previous: Job,
  input: Partial<Pick<Job, "state" | "checkpoint" | "output" | "error">>,
) {
  const job = JobSchema.parse({
    ...previous,
    ...input,
    revision: previous.revision + 1,
    updated_at: new Date().toISOString(),
  })
  await writeRecord(directory, [".minemods", "jobs", `${job.id}.json`], job)
  return job
}

export async function updateJob(
  directory: string,
  id: string,
  input: {
    expectedRevision: number
    state?: JobState
    checkpoint?: unknown
    output?: unknown
    error?: string | null
  },
) {
  return withProjectLock(directory, async () => {
    const job = await loadJob(directory, id)
    if (job.revision !== input.expectedRevision) throw new RevisionConflictError(input.expectedRevision, job.revision)
    const state = input.state ?? job.state
    if (state !== job.state && !transitions[job.state].includes(state))
      throw new Error(`Invalid job transition: ${job.state} → ${state}`)
    if (!["queued", "running"].includes(job.state)) throw new Error(`Cannot update terminal job state: ${job.state}`)
    return persistJob(directory, job, {
      state,
      checkpoint: input.checkpoint === undefined ? job.checkpoint : z.json().nullable().parse(input.checkpoint),
      output: input.output === undefined ? job.output : z.json().nullable().parse(input.output),
      error: input.error === undefined ? job.error : input.error,
    })
  })
}

export async function cancelJob(directory: string, id: string, expectedRevision?: number) {
  return withProjectLock(directory, async () => {
    const job = await loadJob(directory, id)
    if (expectedRevision !== undefined && expectedRevision !== job.revision)
      throw new RevisionConflictError(expectedRevision, job.revision)
    if (job.state === "canceled") return job
    if (!["queued", "running", "interrupted"].includes(job.state)) throw new Error(`Cannot cancel a ${job.state} job`)
    return persistJob(directory, job, { state: "canceled" })
  })
}

export async function resumeJob(directory: string, id: string, expectedRevision?: number) {
  return withProjectLock(directory, async () => {
    const job = await loadJob(directory, id)
    if (expectedRevision !== undefined && expectedRevision !== job.revision)
      throw new RevisionConflictError(expectedRevision, job.revision)
    if (!["failed", "canceled", "interrupted"].includes(job.state)) throw new Error(`Cannot resume a ${job.state} job`)
    const project = await openProject(directory)
    if (project.revision !== job.project_revision)
      throw new RevisionConflictError(job.project_revision, project.revision)
    return persistJob(directory, job, { state: "queued", error: null, output: null })
  })
}

export async function listJobs(directory: string) {
  const project = await openProject(directory)
  const parent = path.dirname(await storagePath(directory, [".minemods", "jobs", "listing"]))
  const entries = await readdir(parent, { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  })
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readProjectJob(directory, entry.name.slice(0, -5), project.id)),
  ).then((jobs) => jobs.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)))
}

/**
 * Call once during application startup before dispatching workers, never while workers are active.
 * Whatever was queued or running was held by the process that has just gone (its runner, and any game, server or build it had started), so none of it can still be going:
 * it becomes interrupted, which neither holds up the next run of the same kind nor goes on saying what it was in the middle of (broad11 w4b: a test-scene game job
 * left running by a Studio that was closed kept saying the game was open and had to be canceled by hand before a new play). A queued job never got a runner in this
 * process either, so it is interrupted too and not left waiting for one that will not come; resuming it queues it again from its checkpoint.
 */
export async function recoverJobs(directory: string) {
  return withProjectLock(directory, async () =>
    Promise.all(
      (await listJobs(directory)).map((job) =>
        job.state === "running" || job.state === "queued" ? persistJob(directory, job, { state: "interrupted" }) : job,
      ),
    ),
  )
}

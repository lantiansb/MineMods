import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createEntity, createProject, openProject, saveProject } from "../src/project"
import { putModelAsset } from "../src/assets"
import { cancelJob, listJobs, recoverJobs, resumeJob, startJob, updateJob } from "../src/jobs"

const directories: string[] = []

async function projectDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-job-任务-'"))
  directories.push(directory)
  await createProject({ directory, name: "Forest" })
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("persists queued and running states, recovering interrupted work from a checkpoint", async () => {
  const directory = await projectDirectory()
  const queued = await startJob(directory, { kind: "generate-model", expectedRevision: 0, input: { prompt: "deer" } })
  expect(queued.state).toBe("queued")
  const running = await updateJob(directory, queued.id, {
    expectedRevision: 0,
    state: "running",
    checkpoint: { stage: "model-requested" },
  })
  expect(running.revision).toBe(1)
  expect((await listJobs(directory))[0]).toEqual(running)
  const recovered = await recoverJobs(directory)
  expect(recovered[0]?.state).toBe("interrupted")
  const resumed = await resumeJob(directory, queued.id)
  expect(resumed.state).toBe("queued")
  expect(resumed.checkpoint).toEqual({ stage: "model-requested" })
  expect(resumed.input).toEqual({ prompt: "deer" })
})

// broad11 w4b: Studio was closed with the test scene's game open; the next Studio still had that job running and "the game open" until the tester canceled it.
test("a restart interrupts every job that was queued or running, and leaves the finished ones as they were", async () => {
  const directory = await projectDirectory()
  const waiting = await startJob(directory, { kind: "build", expectedRevision: 0 })
  const playing = await startJob(directory, { kind: "scene_play", expectedRevision: 0 })
  await updateJob(directory, playing.id, { expectedRevision: 0, state: "running", checkpoint: { detail: "游戏已经开着了", in_game_at: "2026-10-12T00:00:00.000Z" } })
  const done = await startJob(directory, { kind: "build", expectedRevision: 0 })
  const running = await updateJob(directory, done.id, { expectedRevision: 0, state: "running" })
  await updateJob(directory, done.id, { expectedRevision: running.revision, state: "completed", output: { ok: true } })
  const recovered = await recoverJobs(directory)
  expect(Object.fromEntries(recovered.map((job) => [job.id, job.state]))).toEqual({ [waiting.id]: "interrupted", [playing.id]: "interrupted", [done.id]: "completed" })
  // Nothing is left that a new run of the same kind would wait for or be refused for; the checkpoint is kept for a resume.
  expect((await listJobs(directory)).some((job) => job.state === "queued" || job.state === "running")).toBe(false)
  expect((await listJobs(directory)).find((job) => job.id === playing.id)?.checkpoint).toMatchObject({ in_game_at: "2026-10-12T00:00:00.000Z" })
  // Starting up again changes nothing more.
  expect((await recoverJobs(directory)).map((job) => job.revision).sort()).toEqual((await listJobs(directory)).map((job) => job.revision).sort())
  expect((await resumeJob(directory, waiting.id)).state).toBe("queued")
})

test("canceling a job blocks a stale worker completion and preserves the project", async () => {
  const directory = await projectDirectory()
  const before = await openProject(directory)
  const queued = await startJob(directory, { kind: "generate-model", expectedRevision: 0 })
  const running = await updateJob(directory, queued.id, { expectedRevision: 0, state: "running" })
  const canceled = await cancelJob(directory, running.id)
  expect(canceled.state).toBe("canceled")
  await expect(
    updateJob(directory, running.id, { expectedRevision: running.revision, state: "completed" }),
  ).rejects.toThrow(/revision/i)
  await expect(
    updateJob(directory, running.id, { expectedRevision: canceled.revision, state: "completed" }),
  ).rejects.toThrow(/transition/i)
  expect(await openProject(directory)).toEqual(before)
})

test("a completed job needs a running state and a persisted output", async () => {
  const directory = await projectDirectory()
  const queued = await startJob(directory, { kind: "build", expectedRevision: 0 })
  await expect(
    updateJob(directory, queued.id, { expectedRevision: 0, state: "completed", output: { artifact: "mod.jar" } }),
  ).rejects.toThrow()
  const running = await updateJob(directory, queued.id, { expectedRevision: 0, state: "running" })
  await expect(
    updateJob(directory, queued.id, { expectedRevision: running.revision, state: "completed" }),
  ).rejects.toThrow(/output/i)
  const completed = await updateJob(directory, queued.id, {
    expectedRevision: running.revision,
    state: "completed",
    output: { artifact: "mod.jar" },
  })
  expect(completed.state).toBe("completed")
  await expect(resumeJob(directory, queued.id)).rejects.toThrow()
})

test("resuming work against a changed project fails without rewriting job data", async () => {
  const directory = await projectDirectory()
  const queued = await startJob(directory, { kind: "build", expectedRevision: 0 })
  const failed = await updateJob(directory, queued.id, {
    expectedRevision: 0,
    state: "failed",
    error: "Compiler failed",
  })
  const project = await openProject(directory)
  await saveProject(directory, { ...project, name: "Changed" }, project.revision)
  await expect(resumeJob(directory, queued.id)).rejects.toThrow(/revision/i)
  expect((await listJobs(directory))[0]).toEqual(failed)
})

test("malformed job records are preserved and invalid identifiers cannot traverse storage", async () => {
  const directory = await projectDirectory()
  const job = await startJob(directory, { kind: "build", expectedRevision: 0 })
  const file = path.join(directory, ".minemods", "jobs", `${job.id}.json`)
  await writeFile(file, "{broken")
  await expect(cancelJob(directory, job.id)).rejects.toThrow()
  await expect(resumeJob(directory, "../../escape")).rejects.toThrow()
  expect(await readFile(file, "utf8")).toBe("{broken")
})

test("a canceled job cannot publish a late model result", async () => {
  const directory = await projectDirectory()
  const created = await openProject(directory)
  const entity = createEntity({ name: "Deer" })
  const project = await saveProject(directory, { ...created, entities: [entity] }, 0)
  const job = await startJob(directory, {
    kind: "generate-model",
    entity_id: entity.id,
    expectedRevision: project.revision,
  })
  await updateJob(directory, job.id, { state: "running", expectedRevision: 0 })
  await cancelJob(directory, job.id)
  await expect(
    putModelAsset(directory, {
      entity_id: entity.id,
      data: {},
      origin: "gpt-6-astra",
      expectedRevision: project.revision,
      job_id: job.id,
    }),
  ).rejects.toThrow(/running|canceled/i)
  expect(await openProject(directory)).toEqual(project)
})

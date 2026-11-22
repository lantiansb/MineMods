import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { latestSuccessfulBuild } from "../src/build-record"
import { startJob, updateJob } from "../src/jobs"
import { createProject } from "../src/project"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mod-core-build-record-"))
  directories.push(root)
  const directory = path.join(root, "project")
  return { directory, project: await createProject({ directory, name: "构建记录", description: "" }) }
}

// A build as the service records it: a job that ran, and the manifest written next to the generated source.
async function build(directory: string, revision: number, state: "completed" | "failed", assets?: { id: string; revision: number }[]) {
  const id = crypto.randomUUID()
  const job = await startJob(directory, { kind: "build", expectedRevision: revision })
  const running = await updateJob(directory, job.id, { state: "running", expectedRevision: job.revision })
  if (assets) {
    await mkdir(path.join(directory, "generated", `build-${id}`), { recursive: true })
    await writeFile(path.join(directory, "generated", `build-${id}`, "minemods-build.json"), JSON.stringify({ schema_version: 1, revision, workspace_assets: assets.map((asset) => ({ ...asset, module: "item" })) }))
  }
  await updateJob(
    directory,
    job.id,
    state === "completed"
      ? { state, expectedRevision: running.revision, output: { id, revision, jarPath: "/x.jar", projectDirectory: directory, sourceDirectory: "/x", sha256: "0".repeat(64) } }
      : { state, expectedRevision: running.revision, error: "模组构建失败" },
  )
  return id
}

test("no build, or only failed ones, is no build", async () => {
  const { directory, project } = await setup()
  expect(await latestSuccessfulBuild(directory)).toBeNull()
  await build(directory, project.revision, "failed")
  expect(await latestSuccessfulBuild(directory)).toBeNull()
})

test("the latest build is the one whose job completed last, and its manifest lists what was built", async () => {
  const { directory, project } = await setup()
  const asset = { id: crypto.randomUUID(), revision: 4 }
  await build(directory, project.revision, "completed", [{ ...asset, revision: 3 }])
  await Bun.sleep(5)
  const latest = await build(directory, project.revision, "completed", [asset])
  await Bun.sleep(5)
  // A later failure does not hide the build before it.
  await build(directory, project.revision, "failed")
  expect(await latestSuccessfulBuild(directory)).toMatchObject({ id: latest, revision: project.revision, assets: [asset] })
})

test("a build whose manifest is gone, unreadable or older than the asset list claims nothing", async () => {
  const { directory, project } = await setup()
  const id = await build(directory, project.revision, "completed")
  expect(await latestSuccessfulBuild(directory)).toMatchObject({ id, assets: [] })
  await mkdir(path.join(directory, "generated", `build-${id}`), { recursive: true })
  await writeFile(path.join(directory, "generated", `build-${id}`, "minemods-build.json"), JSON.stringify({ schema_version: 1, asset_ids: [] }))
  expect(await latestSuccessfulBuild(directory)).toMatchObject({ id, assets: [] })
  await writeFile(path.join(directory, "generated", `build-${id}`, "minemods-build.json"), "{ broken")
  expect(await latestSuccessfulBuild(directory)).toMatchObject({ id, assets: [] })
})

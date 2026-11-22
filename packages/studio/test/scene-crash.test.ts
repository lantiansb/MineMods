import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CRASH_REASON, CRASH_WORDS, jobCrashed, jobCrashDetail, parseCrashReport, type GameCrash } from "@minemods/mod-core/game-crash"
import { startJob, updateJob } from "@minemods/mod-core/jobs"
import { openProject } from "@minemods/mod-core/project"
import type { SceneRecord } from "@minemods/mod-core/scene-run"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"
import { FIX_WORDS } from "../src/fix-findings"
import { createStudioService } from "../src/main/service"
import { jobTarget } from "../src/renderer/job-target"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const PACKAGE = "com.minemods.content_azure_sample"
const REPORT = `---- Minecraft Crash Report ----

Time: 2026-10-14 20:36:34
Description: Exception ticking world

java.lang.IllegalArgumentException: Invalid weapon firing an arrow
\tat net.minecraft.class_1665.<init>(class_1665.java:141)
\tat ${PACKAGE}.gameplay.ore_guarding.Main.fire(Main.java:30)

A detailed walkthrough of the error
`

/** The sample project (its one gameplay has the slug `ore_guarding`) with a finished build of it, and a stand-in for the game that ends the way `ends` says. */
async function bench(ends: (project: { id: string; mod_id: string }) => { code: number; crash: GameCrash | null }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-crash-"))
  directories.push(root)
  const sample = await createDataGameplaySample(path.join(root, "projects", "azure"), { life: true })
  const directory = path.join(root, "projects", "azure")
  const project = await openProject(directory)
  const queued = await startJob(directory, { kind: "build", expectedRevision: project.revision })
  const running = await updateJob(directory, queued.id, { state: "running", expectedRevision: queued.revision })
  const built = await updateJob(directory, queued.id, { state: "completed", expectedRevision: running.revision, output: { id: "build-1", revision: project.revision, jarPath: path.join(root, "mod.jar"), projectDirectory: directory, sourceDirectory: directory, sha256: "0".repeat(64) } })
  const record: SceneRecord = { schema_version: 1, project_id: project.id, build_id: "build-1", revision: project.revision, jar_sha256: "0".repeat(64), mods: [], missing: [], deployed_at: new Date().toISOString() }
  const opened: unknown[] = []
  const state = { record }
  const service = await createStudioService({
    workspaceDirectory: path.join(root, "projects"),
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: TEMPLATE,
    ai: { mode: "mcp" },
    javaHome: root,
    sceneRun: {
      readScene: async () => state.record,
      deployScene: async () => state.record,
      openScene: async (input) => {
        opened.push(input)
        const end = ends(project)
        // What the real opening does with the record, as the next hand-off reads it.
        state.record = { ...record, ...(end.crash ? { crash: end.crash } : {}) }
        return { world: true, code: end.code, crash: end.crash }
      },
    },
  })
  closers.push(() => service.dispose())
  await service.listProjects()
  return { service, sample, project, built, opened, record: () => state.record }
}

const finished = async (service: Awaited<ReturnType<typeof bench>>["service"], projectId: string, jobId: string) => {
  for (let tries = 0; tries < 200; tries++) {
    const job = await service.getJob({ projectId, jobId })
    if (!["queued", "running"].includes(job.state)) return job
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("the job did not end")
}

const crashed = (): GameCrash => ({ signs: ["report", "marker", "exit"], code: 255, report: "/runtime/scene/instances/p/crash-reports/crash-2026-10-14_20.36.34-server.txt", ...parseCrashReport(REPORT, PACKAGE), at: "2026-10-14T12:36:40.000Z" })

test("broad18 w2: a game that crashed ends the play job as a crash, with the report, the gameplay it points at and the way to its card, not as 「完成」", async () => {
  const { service, project, built, opened } = await bench(() => ({ code: 255, crash: crashed() }))
  const { jobId } = await service.startScenePlay({ projectId: project.id, jobId: built.id })
  const job = await finished(service, project.id, jobId)
  // The mod's id reaches the opening so the report can be read for this mod's classes.
  expect(opened).toEqual([{ projectId: project.id, runtimeDirectory: expect.any(String), modId: "azure_sample" }])
  expect(job.state).toBe("failed")
  expect(jobCrashed(job)).toBe(true)
  expect(job.checkpoint).toMatchObject({ reason: CRASH_REASON })
  // The sentence the person reads: it crashed, which gameplay by its title, where the report is, and that the AI can be asked.
  expect(job.error).toStartWith(CRASH_WORDS.stop)
  expect(job.error).toContain("崩溃报告指向玩法「")
  expect(job.error).toContain("crash-2026-10-14_20.36.34-server.txt")
  expect(job.error).toContain("交给 AI")
  expect(job.error).toContain("晶石傀儡守矿")
  expect(job.error).not.toContain("完成")
  expect(job.error).not.toContain("Main.java")
  // The way to the gameplay's card is the same button a finding has.
  const target = jobTarget(job)
  expect(target).toMatchObject({ about: { kind: "gameplay" }, field: "" })
  expect(job.error).toContain(`「${target!.about.name}」`)
  // The file and the line stay for 高级.
  expect(jobCrashDetail(job)).toContain("Main.fire")
  expect(jobCrashDetail(job)).toContain("Main.java:30")
  expect(jobCrashDetail(job)).toContain("Invalid weapon firing an arrow")
})

test("a game closed by the person ends the play job as before; and a crash with nothing to point at says only what it knows", async () => {
  const closed = await bench(() => ({ code: 0, crash: null }))
  const first = await finished(closed.service, closed.project.id, (await closed.service.startScenePlay({ projectId: closed.project.id, jobId: closed.built.id })).jobId)
  expect(first.state).toBe("completed")
  expect(jobCrashed(first)).toBe(false)
  expect(first.output).toMatchObject({ exited: true, world: true })

  // Only the exit code said so: no report, nothing pointed at, no card to go to.
  const bare = await bench(() => ({ code: 255, crash: { signs: ["exit"], code: 255, report: null, description: null, exception: null, where: null, frames: [], at: "2026-10-14T12:36:40.000Z" } }))
  const second = await finished(bare.service, bare.project.id, (await bare.service.startScenePlay({ projectId: bare.project.id, jobId: bare.built.id })).jobId)
  expect(second.state).toBe("failed")
  expect(jobCrashed(second)).toBe(true)
  expect(second.error).toContain(CRASH_WORDS.none)
  expect(second.error).not.toContain("指向")
  expect(jobTarget(second)).toBeUndefined()
})

test("the crash the last opening left is handed to the AI through the findings path: to the gameplay's card when the report points at it, to the person when it points at none", async () => {
  const { service, project, built } = await bench(() => ({ code: 255, crash: crashed() }))
  await finished(service, project.id, (await service.startScenePlay({ projectId: project.id, jobId: built.id })).jobId)
  const handed = await service.fixFindings({ projectId: project.id })
  // An AI outside Studio is connected (mcp mode): the redo is recorded on the gameplay's card and waits for it, with the sentence to paste.
  expect(handed.started.map((value) => value.title)).toContain("晶石傀儡守矿")
  expect(handed).toMatchObject({ nothing: false, waiting: true })
  expect(handed.tell).toContain("晶石傀儡守矿")
  // What the card is sent back with is the game's own exception and the place, in the words the AI is told.
  const overview = await service.getProjectOverview({ projectId: project.id })
  const card = overview.items.find((item) => item.title === "晶石傀儡守矿")!
  expect(card.status).toBe("redo")
  expect(card.reason).toStartWith(FIX_WORDS.lead)
  expect(card.reason).toContain("游戏崩溃了")
  expect(card.reason).toContain("java.lang.IllegalArgumentException: Invalid weapon firing an arrow")
  expect(card.reason).toContain("Main.java 第 30 行")
})

test("a crash the report does not tie to a gameplay is left to the person, in a sentence, and no card is sent back with it", async () => {
  const bare = (): GameCrash => ({ ...crashed(), where: null, frames: ["net.minecraft.class_310.method_1(class_310.java:1)"] })
  const { service, project, built } = await bench(() => ({ code: 255, crash: bare() }))
  await finished(service, project.id, (await service.startScenePlay({ projectId: project.id, jobId: built.id })).jobId)
  const handed = await service.fixFindings({ projectId: project.id })
  const whole = handed.left.find((value) => value.title === FIX_WORDS.whole)!
  expect(whole.why).toContain(CRASH_WORDS.stop)
  expect(whole.why).toContain(CRASH_WORDS.elsewhere)
  expect(whole.why).not.toContain("class_310")
  // The cards the project's own checks sent back carry only those checks' words: nothing of the crash goes onto a card it does not point at.
  const overview = await service.getProjectOverview({ projectId: project.id })
  for (const item of overview.items) expect(item.reason ?? "").not.toContain("游戏崩溃了")
})

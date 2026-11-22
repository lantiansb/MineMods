import { afterEach, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { abilityFault } from "@minemods/studio-ai/making"
import { BuildStop } from "@minemods/mod-core/build-stop"
import { BONE_FAULT_MARK } from "@minemods/mod-core/creature-abilities"
import { readActivity } from "@minemods/mod-core/activity"
import { openProject } from "@minemods/mod-core/project"
import { MakingRefusal } from "@minemods/mod-core/making"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { BOX_GUARD, LEGACY_FILES } from "../../mod-core/test/fixtures/gameplay/sample"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"
import { CHECK_STAGES, CHECK_STOPPED } from "../src/main/check-calling"
import { externalError } from "../src/main/external-dispatch"
import { lookJob } from "../src/main/look-job"
import { createProjectRunner } from "../src/main/project-runner"
import { publicError } from "../src/main/service"

const directories: string[] = []
const closers: (() => unknown)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const STOP = new BuildStop("ability_bone", [{ text: "「傀儡」的招式「重锤」第 1 次出手写的部位（bone）是「arm_lef」，可是它的模型里没有这个部件（模型里有名字很像的「arm_left」）。", fix: "模型里有的部件是：body、head、arm_left。把 bone 改成其中一个。" }])

test("a stop of the generator reaches whoever asked in its own words, not as an operation that did not finish with a line of Studio's code", () => {
  // Before, this was `new Error(sentence)`: the sentence was never shown, and the person read 「操作未完成…」 with a file and a line.
  expect(publicError(STOP)).toBe(STOP.message)
  expect(publicError(STOP)).not.toContain("操作未完成")
  expect(publicError(new Error(STOP.message))).toContain("操作未完成")
  expect((externalError(STOP) as Error).message).toBe(STOP.message)
  // The other stops of that layer, coded, are worded too.
  expect(publicError(new Error("GAMEPLAY_FILE_CONFLICT:gameplay/a/Main.java"))).toContain("gameplay/a/Main.java")
  expect(publicError(new Error("GESTURE_KEY_CONFLICT:11111111-1111-4111-8111-111111111111"))).toContain("触发的按键")
})

test("the look of a creature says a part its model lacks as a fault to answer, with the parts that exist, and draws nothing from it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-bone-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  const of = <Kind extends ModuleDocument["kind"]>(kind: Kind) => project.workspace.assets.flatMap((asset) => (asset.document.kind === kind ? [asset.document as Extract<ModuleDocument, { kind: Kind }>] : []))[0]!
  const creature = of("entity")
  const model = of("model")
  const slam = creature.abilities![0]!
  const lost = { ...creature, abilities: [{ ...slam, hits: [{ ...slam.hits[0]!, bone: "arm_lef" }] }, creature.abilities![1]!] }
  const made = lookJob(lost, model)
  const line = made.notes.find((note) => note.startsWith(BONE_FAULT_MARK))
  expect(line).toBeDefined()
  expect(line).toContain("「arm_lef」")
  expect(line).toContain("模型里有名字很像的「arm_left」")
  expect(line).toContain("模型里有的部件是：")
  // It is a measured fault, so the making loop holds the version until it is changed.
  expect(abilityFault(line!)).toBe(true)
  expect(made.notes.filter(abilityFault).some((note) => note.startsWith(BONE_FAULT_MARK))).toBe(true)
  // A creature that names only parts that exist has none.
  expect(lookJob(creature, model).notes.some((note) => note.startsWith(BONE_FAULT_MARK))).toBe(false)
})

test("a code check whose project cannot be put together says why in the generator's words, shows that it stopped, and uses up no round", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-stop-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const original = JSON.parse(await readFile(LEGACY_FILES.project, "utf8"))
  await mkdir(path.join(directory, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(LEGACY_FILES.project, path.join(directory, "minemods.project.json"))
  await cp(LEGACY_FILES.model, path.join(directory, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  const project = await openProject(directory)
  const runner = createProjectRunner({
    directoryFor: async () => directory,
    ai: {},
    compileGameplay: async () => {
      throw STOP
    },
  })
  closers.push(() => runner.dispose())
  const started = await runner.startExternal({ projectId: project.id, expectedRevision: project.revision, prompt: "一只守着秘匣的敌对生物", plan: { summary: "守卫", questions: [], tasks: [{ key: "guard", module: "gameplay", title: "守匣警报", prompt: "守着秘匣的敌对生物", source: "守着秘匣的敌对生物", dependencies: [], target_id: null }] } })
  const ids = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  await runner.claimExternalTask(ids)
  const { gameplaySheet } = await import("@minemods/mod-core/gameplay")
  await runner.describeExternalTask({ ...ids, sheet: gameplaySheet(BOX_GUARD) })
  const refused = await runner.checkCodeExternalTask({ ...ids, document: BOX_GUARD }).then(
    () => null,
    (error: unknown) => error,
  )
  expect(refused).toBeInstanceOf(MakingRefusal)
  const words = (externalError(refused) as Error).message
  expect(words).toBe(CHECK_STOPPED.ai(STOP.message))
  expect(words).toContain("「arm_lef」")
  expect(words).toContain("没有占用版数")
  expect((refused as MakingRefusal).plain).toBe(CHECK_STOPPED.person("守匣警报"))
  // What the person reads: one ending line that says it failed and why, in those words; the check is not left reading "preparing".
  const ended = (await readActivity(directory)).events.filter((event) => event.kind === "check" && event.end)
  expect(ended.at(-1)).toMatchObject({ mark: "fail", text: CHECK_STOPPED.person("守匣警报"), lines: [STOP.message] })
  expect(Object.values(CHECK_STAGES)).toContain(CHECK_STAGES.stopped)
  expect(CHECK_STAGES.stopped).not.toContain("准备")
  // And no round was used: the same check can be asked again.
  const again = await runner.checkCodeExternalTask({ ...ids, document: BOX_GUARD }).then(
    () => null,
    (error: unknown) => error,
  )
  expect(again).toBeInstanceOf(MakingRefusal)
})

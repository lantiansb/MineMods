import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CRASH_MARKER, CRASH_WORDS, GAME_CRASH_CODES, crashDetails, crashRemark, crashSentence, crashTarget, gameplayOf, jobCrashDetail, jobCrashed, parseCrashReport, type GameCrash } from "../src/game-crash"
import { findGameCrash, keepCrash, readScene, scenePaths, type SceneRecord } from "../src/scene-run"
import { modPackage } from "../src/gameplay"
import { identifiersIn } from "../src/play-words"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const MOD = "azure_trap"
const PACKAGE = modPackage(MOD)

/** The crash the retest hit: a pressure plate's gameplay built an arrow with an empty stack as its weapon, and the integrated server's tick threw. */
const REPORT = `---- Minecraft Crash Report ----
// You should try our sister game, Minceraft!

Time: 2026-10-14 20:36:34
Description: Exception ticking world

java.lang.IllegalArgumentException: Invalid weapon firing an arrow
\tat net.minecraft.class_1665.<init>(class_1665.java:141)
\tat net.minecraft.class_1667.<init>(class_1667.java:47)
\tat ${PACKAGE}.gameplay.plate_trigger.Main.fire(Main.java:30)
\tat ${PACKAGE}.gameplay.plate_trigger.Main.lambda$onInitialize$0(Main.java:18)
\tat net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.lambda$static$0(ServerTickEvents.java:37)
\tat net.minecraft.class_3218.method_18765(class_3218.java:200)


A detailed walkthrough of the error, its code path and all known details is as follows:
---------------------------------------------------------------------------------------

-- Head --
Thread: Server thread
Stacktrace:
\tat net.minecraft.class_1665.<init>(class_1665.java:141)
\tat ${PACKAGE}.gameplay.plate_trigger.Main.fire(Main.java:30)

-- Affected level --
Details:
\tAll players: 1 total
`

/** An instance folder like the scene's: where the game runs, with the files it leaves. `launched` is when Studio started the process. */
async function instance() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-crash-"))
  roots.push(root)
  await mkdir(path.join(root, "crash-reports"), { recursive: true })
  return root
}
const OUTPUT_CLOSED = "[20:30:01] [Render thread/INFO] (Minecraft) Stopping!\n"
const markerFor = (file: string) => `#@!@# Game crashed! Crash report saved to: #@!@# ${file}\n`

test("a crash report is read for what the game said and where its stack first enters the mod", () => {
  const read = parseCrashReport(REPORT, PACKAGE)
  expect(read.description).toBe("Exception ticking world")
  expect(read.exception).toBe("java.lang.IllegalArgumentException: Invalid weapon firing an arrow")
  // The first frame in the mod's own package is the gameplay's, not the game's two above it.
  expect(read.where).toEqual({ class: `${PACKAGE}.gameplay.plate_trigger.Main`, method: "fire", file: "Main.java", line: 30, gameplay: "plate_trigger" })
  expect(read.frames[0]).toBe("net.minecraft.class_1665.<init>(class_1665.java:141)")
  expect(read.frames).toContain(`${PACKAGE}.gameplay.plate_trigger.Main.fire(Main.java:30)`)
  // The text after the game's own walkthrough line repeats the stack and is not read twice.
  expect(read.frames.filter((frame) => frame.endsWith("Main.fire(Main.java:30)"))).toHaveLength(1)

  // The cause that ended it is the deepest one: a wrapper whose own frames are the game's names no part of the mod.
  const wrapped = `Description: Ticking entity\n\nnet.minecraft.util.crash.CrashException: Ticking entity\n\tat net.minecraft.class_1.method(class_1.java:1)\nCaused by: java.lang.NullPointerException: Cannot invoke "x" because "y" is null\n\tat ${PACKAGE}.entity.CreatureEntity.tick(CreatureEntity.java:77)\n\nA detailed walkthrough of the error`
  const cause = parseCrashReport(wrapped, PACKAGE)
  expect(cause.exception).toBe(`java.lang.NullPointerException: Cannot invoke "x" because "y" is null`)
  // A class of the mod that is not a gameplay's names no gameplay.
  expect(cause.where).toMatchObject({ class: `${PACKAGE}.entity.CreatureEntity`, line: 77, gameplay: null })

  // Studio's own support package for gameplay only forwards what a gameplay asked: the gameplay's frame below it is where the crash points.
  const forwarded = `Description: x\n\njava.lang.IllegalStateException: no\n\tat ${PACKAGE}.gameplay.api.ProjectContent.flyTo(ProjectContent.java:90)\n\tat ${PACKAGE}.gameplay.bat_swarm.Main.tick(Main.java:12)\n`
  expect(parseCrashReport(forwarded, PACKAGE).where).toMatchObject({ method: "tick", gameplay: "bat_swarm" })
  // A crash that never enters the mod points at no part of it.
  const elsewhere = `Description: Rendering screen\n\njava.lang.RuntimeException: boom\n\tat net.minecraft.class_310.method_1(class_310.java:1)\n\tat com.othermod.Thing.render(Thing.java:5)\n`
  expect(parseCrashReport(elsewhere, PACKAGE)).toMatchObject({ description: "Rendering screen", exception: "java.lang.RuntimeException: boom", where: null })
  // A text that is no crash report says nothing and invents nothing.
  expect(parseCrashReport("not a report", PACKAGE)).toEqual({ description: null, exception: null, where: null, frames: [] })
  expect(gameplayOf(`${PACKAGE}.gameplay.plate_trigger.client.ClientMain`, PACKAGE)).toBe("plate_trigger")
  expect(gameplayOf(`${PACKAGE}.gameplay.api.ProjectContent`, PACKAGE)).toBeNull()
})

test("a game that crashed is found from the report it wrote, the marker in its output and the exit code, and a closed window is not one", async () => {
  const folder = await instance()
  const launched = Date.now()

  // Closed by the person: exit 0, no report, nothing in the output. Not a crash, whatever else is lying in the folder from before.
  const old = path.join(folder, "crash-reports", "crash-2026-01-01_00.00.00-client.txt")
  await writeFile(old, REPORT)
  await utimes(old, new Date(launched - 3_600_000), new Date(launched - 3_600_000))
  expect(await findGameCrash({ instance: folder, launched, code: 0, output: OUTPUT_CLOSED, modId: MOD })).toBeNull()
  // Another non-zero code is a process that was ended from outside, not a crash the game reported.
  for (const code of [1, 130, 137, 143, null]) expect(await findGameCrash({ instance: folder, launched, code, output: OUTPUT_CLOSED, modId: MOD })).toBeNull()

  // The real shape of the retest: the integrated server wrote a -server report, the client printed the marker and exited 255.
  const fresh = path.join(folder, "crash-reports", "crash-2026-10-14_20.36.34-server.txt")
  await writeFile(fresh, REPORT)
  const crash = (await findGameCrash({ instance: folder, launched, code: 255, output: OUTPUT_CLOSED + markerFor(fresh), modId: MOD }))!
  expect(crash.signs).toEqual(["report", "marker", "exit"])
  expect(crash.report).toBe(fresh)
  expect(crash.code).toBe(255)
  expect(crash.exception).toBe("java.lang.IllegalArgumentException: Invalid weapon firing an arrow")
  expect(crash.where).toMatchObject({ method: "fire", line: 30, gameplay: "plate_trigger" })
  // The report alone is enough: the output of a long session is cut off at its cap and loses the end, and a game closed by a code of 0 after a report still wrote one.
  expect((await findGameCrash({ instance: folder, launched, code: 0, output: "", modId: MOD }))!.signs).toEqual(["report"])
  // A report of an earlier run is not this run's: only the old file is there.
  await rm(fresh)
  expect(await findGameCrash({ instance: folder, launched, code: 0, output: OUTPUT_CLOSED, modId: MOD })).toBeNull()
})

test("the marker and the exit code each stand without a report; a path the marker names that is not there is not used", async () => {
  const folder = await instance()
  const launched = Date.now()
  const elsewhere = path.join(folder, "nowhere", "crash-x.txt")
  // The marker names a report that cannot be found, and the report folder is empty: it crashed, and Studio does not claim a file.
  const marked = (await findGameCrash({ instance: folder, launched, code: 255, output: markerFor(elsewhere), modId: MOD }))!
  expect(marked.signs).toEqual(["marker", "exit"])
  expect(marked.report).toBeNull()
  expect(marked.where).toBeNull()
  // The game could not even save its report.
  expect((await findGameCrash({ instance: folder, launched, code: 254, output: "#@?@# Game crashed! Crash report could not be saved. #@?@#\n", modId: MOD }))!.signs).toEqual(["marker", "exit"])
  // The marker that names a report that is there reads it, with the folder listing unavailable to the search (a report written outside crash-reports).
  const named = path.join(folder, "saved-elsewhere.txt")
  await writeFile(named, REPORT)
  expect(await findGameCrash({ instance: folder, launched, code: 0, output: markerFor(named), modId: MOD })).toMatchObject({ signs: ["report", "marker"], report: named })
  // Only the exit code.
  expect((await findGameCrash({ instance: folder, launched, code: 4294967295, output: OUTPUT_CLOSED, modId: MOD }))!.signs).toEqual(["exit"])
  // Both numbers the game's own exit gives, as a process reports them on each system.
  for (const code of [-1, -2, 255, 254, 4294967295, 4294967294]) expect(GAME_CRASH_CODES).toContain(code)
  expect(CRASH_MARKER.test("#@!@# Game crashed! Crash report saved to: #@!@# /x")).toBe(true)
  expect(CRASH_MARKER.test("Game crashed?")).toBe(false)
  // The Java machine itself died: it writes its own log and no report.
  await writeFile(path.join(folder, "hs_err_pid4242.log"), "# A fatal error has been detected by the Java Runtime Environment")
  const fatal = (await findGameCrash({ instance: folder, launched, code: 134, output: "", modId: MOD }))!
  expect(fatal.signs).toEqual(["jvm"])
  expect(fatal.report).toBe(path.join(folder, "hs_err_pid4242.log"))
})

test("a crash is told to the person in plain words with the report's place, and to the AI with the game's own words", () => {
  const crash: GameCrash = { signs: ["report", "marker", "exit"], code: 255, report: "/runtime/scene/instances/p1/crash-reports/crash-2026-10-14_20.36.34-server.txt", ...parseCrashReport(REPORT, PACKAGE), at: "2026-10-14T12:36:40.000Z" }
  const sentence = crashSentence(crash, (slug) => (slug === "plate_trigger" ? "踏板触发炮塔" : null))
  expect(sentence).toStartWith(CRASH_WORDS.stop)
  expect(sentence).toContain("崩溃报告指向玩法「踏板触发炮塔」")
  expect(sentence).toContain(`崩溃报告在：${crash.report}`)
  expect(sentence).toContain("交给 AI")
  // Nothing in it is code: no class, no file, no line, no exception. Those stay under 高级.
  expect(identifiersIn(sentence.replace(crash.report!, ""))).toEqual([])
  expect(sentence).not.toContain("Main")
  expect(sentence).not.toContain("IllegalArgument")
  expect(CRASH_WORDS.advanced(crash)).toContain("Main.fire")
  expect(CRASH_WORDS.advanced(crash)).toContain("Main.java:30")
  expect(CRASH_WORDS.advanced(crash)).toContain("Invalid weapon firing an arrow")
  // The drawer says the first part once as the stop's own line and the rest under it.
  expect(crashDetails(sentence)).toStartWith("崩溃报告指向")
  // A gameplay the project does not have by that slug is not named; the part is the mod's generated code at most.
  expect(crashSentence(crash, () => null)).toContain(CRASH_WORDS.generated)
  expect(crashSentence(crash, () => null)).toContain(CRASH_WORDS.unfixable)
  // A crash that never enters the mod does not blame it.
  const elsewhere: GameCrash = { ...crash, where: null, frames: ["net.minecraft.class_310.method_1(class_310.java:1)"] }
  expect(crashSentence(elsewhere, () => null)).toContain(CRASH_WORDS.elsewhere)
  // No report: said as that, and the way Studio knows is the exit, not a file it does not have.
  const none: GameCrash = { signs: ["exit"], code: 255, report: null, description: null, exception: null, where: null, frames: [], at: crash.at }
  const noReport = crashSentence(none, () => null)
  expect(noReport).toContain(CRASH_WORDS.none)
  expect(noReport).not.toContain(CRASH_WORDS.elsewhere)
  expect(noReport).not.toContain("指向")
  // A report that could not be read does not guess which part.
  expect(crashSentence({ ...none, signs: ["report"], report: "/x/crash.txt" }, () => null)).toContain(CRASH_WORDS.unread)

  // The way to the card, only when the report points at a gameplay the project has.
  expect(crashTarget(crash, (slug) => (slug === "plate_trigger" ? { id: "asset-1", title: "踏板触发炮塔" } : null))).toEqual({ about: { kind: "gameplay", id: "asset-1", name: "踏板触发炮塔" }, field: "", label: "打开「踏板触发炮塔」" })
  expect(crashTarget(crash, () => null)).toBeNull()
  expect(crashTarget(none, () => ({ id: "x", title: "y" }))).toBeNull()

  // What the AI is told is the game's own exception and the place, not the person's sentence.
  const remark = crashRemark(crash, "踏板触发炮塔").join("")
  expect(remark).toContain("Exception ticking world")
  expect(remark).toContain("java.lang.IllegalArgumentException: Invalid weapon firing an arrow")
  expect(remark).toContain("Main.fire（Main.java 第 30 行）")
  expect(remark).toContain("玩法「踏板触发炮塔」")
  expect(remark).toContain("Main.fire(Main.java:30)")
})

test("a play job that ended in a crash is known by the reason it was stored with", () => {
  const job = (state: string, checkpoint: unknown) => ({ state, checkpoint })
  expect(jobCrashed(job("failed", { reason: "game_crashed", crash_detail: "游戏说：x" }))).toBe(true)
  expect(jobCrashed(job("failed", { reason: "stale" }))).toBe(false)
  expect(jobCrashed(job("completed", { reason: "game_crashed" }))).toBe(false)
  expect(jobCrashed(job("failed", null))).toBe(false)
  expect(jobCrashed(null)).toBe(false)
  expect(jobCrashDetail(job("failed", { crash_detail: "a\nb" }))).toBe("a\nb")
  expect(jobCrashDetail(job("failed", { crash_detail: 3 }))).toBe("")
  expect(jobCrashDetail(null)).toBe("")
})

test("the crash is kept in the scene's record for the AI hand-off, replaced by the next opening, and never put on another build's record", async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), "minemods-crash-record-"))
  roots.push(runtime)
  const paths = scenePaths(runtime, "p1")
  await mkdir(paths.instance, { recursive: true })
  const record: SceneRecord = { schema_version: 1, project_id: "p1", build_id: "b1", revision: 3, jar_sha256: "0".repeat(64), mods: [], missing: [], deployed_at: "2026-10-14T00:00:00.000Z", checked_at: "2026-10-14T00:01:00.000Z" }
  await writeFile(paths.record, JSON.stringify(record))
  const crash: GameCrash = { signs: ["exit"], code: 255, report: null, description: null, exception: null, where: null, frames: [], at: "2026-10-14T00:05:00.000Z" }
  await keepCrash(runtime, "p1", "b1", crash)
  expect(await readScene(runtime, "p1")).toEqual({ ...record, crash })
  // The next opening ended well: the old crash is gone, the rest of the record is as it was.
  await keepCrash(runtime, "p1", "b1", null)
  expect(await readScene(runtime, "p1")).toEqual(record)
  // A record that is now another build's (a deploy ran meanwhile) is not written onto.
  await keepCrash(runtime, "p1", "other-build", crash)
  expect(await readScene(runtime, "p1")).toEqual(record)
  // No record at all: nothing is made up for it.
  await keepCrash(runtime, "nobody", "b1", crash)
  expect(await readScene(runtime, "nobody")).toBeNull()
})

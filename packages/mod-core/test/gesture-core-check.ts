import { execFileSync } from "node:child_process"
import { cp, mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { GESTURE_LIBRARY_EASE } from "../src/fabric/gesture"
import { resolveGesture } from "../src/gesture"
import { GESTURE_EASE, gestureMatrix } from "../src/gesture-motion"
import { GESTURE_AIM, GESTURE_EASINGS } from "../src/gesture-rig"
import { createGestureSample } from "./gesture-sample"

// Not part of `bun test`: needs a JDK. usage: bun test/gesture-core-check.ts <gson.jar> [<classpath with playerAnimator>]
// 1. Compiles the generated core with nothing but Gson on the classpath (so it cannot depend on a loader, an
//    animation library or Minecraft), runs it, and checks the timeline it rebuilds from the data file
//    against the one the app previews and the quality gate judged.
// 2. With a second argument, builds the animations through the generated adapter and plays them in the real
//    animation library on a plain JVM: the library must return, tick by tick, what the preview shows, and
//    its easing curves must be the ones the document's easing names promise.
const gson = process.argv[2]
if (!gson) throw new Error("usage: bun test/gesture-core-check.ts <gson.jar> [<classpath with playerAnimator>]")
const directory = await mkdtemp(path.join(os.tmpdir(), "gesture-core-"))
const sample = await createGestureSample(path.join(directory, "sample"))
const sources = path.join(sample.sourceDirectory, "src/main/java/com/minemods/content_gesture_smoke/gesture")
const dataFile = path.join(sample.sourceDirectory, "src/main/resources/data/gesture_smoke/studio/gestures.json")
const java = async (folder: string) => (await readdir(path.join(sources, folder))).map((name) => path.join(sources, folder, name))
const run = (classpath: string, main: string, files: string[], args: string[]) => {
  execFileSync("javac", ["-proc:none", "-d", path.join(directory, main), "-cp", classpath, ...files], { stdio: ["ignore", "inherit", "ignore"] })
  return execFileSync("java", ["-cp", `${path.join(directory, main)}${path.delimiter}${classpath}`, main, dataFile, ...args], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 })
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
}
await cp(path.join(import.meta.dir, "gesture-core-check.java"), path.join(directory, "GestureCoreCheck.java"))
const lines = run(gson, "GestureCoreCheck", [path.join(directory, "GestureCoreCheck.java"), ...(await java("core"))], [])
// The data file lists actions by asset id, the same order the sample saved them in.
const resolved = sample.project.workspace.assets.map((asset) => resolveGesture(asset.document))
const acting = (index: number) => resolved[index]!.timeline.ticks.windup + resolved[index]!.timeline.ticks.hold + resolved[index]!.timeline.ticks.release
const frames = lines.filter((line) => line.startsWith("frame "))
const wrong = frames.filter((line) => {
  const [, index, part, channel, tick, ...values] = line.split(" ")
  const expected = resolved[Number(index)]!.timeline.frames[Number(tick)]![part as "torso"][channel as "rotation"]
  return values.some((value, axis) => Math.abs(Number(value) - expected[axis]!) > (channel === "rotation" ? 0.006 : 0.0006))
})
const swing = gestureMatrix([30, -40, 0]).map((row) => row[0] * -5 + row[1] * 2 + row[2] * -1.5)
const aim = lines.find((line) => line.startsWith("aim "))?.split(" ").map(Number) ?? []
const aimWrong = [swing[0]! + 5, swing[1]! - 2, swing[2]! + 1.5].some((value, axis) => Math.abs(value - aim[axis + 1]!) > 1e-4) || Math.abs(aim[5]! - 40 * GESTURE_AIM) > 1e-3 || aim[7] !== -170 || aim[8] !== 170
const expected = [
  "loaded 2 of 2 reports 0",
  ...resolved.map((value, index) => `ticks ${index} ${value.timeline.ticks.windup} ${value.timeline.ticks.hold} ${value.timeline.ticks.release} ${value.timeline.frames.length - 1}`),
  "older 0 newer 0 skill 1 of 2 first true second true broken 0 out-of-range true",
  "state false true false",
  "gone true false",
  "cooldown true false true",
  "restart true",
  "turns true false",
]
const fade = lines.find((line) => line.startsWith("fade "))?.split(" ").slice(1).map(Number) ?? []
const fadeWrong = [0, GESTURE_EASE.in_out_sine(0.25), 0.5, 1].some((value, index) => !(Math.abs(value - fade[index]!) < 1e-6))
const missing = expected.filter((line) => !lines.includes(line))
console.log(lines.filter((line) => !line.startsWith("frame ")).join("\n"))
if (missing.length || wrong.length || !frames.length || aimWrong || fadeWrong) throw new Error(`CAST CORE FAILED: missing ${JSON.stringify(missing)}, ${wrong.length} of ${frames.length} values differ, aim ${aimWrong ? "differs" : "matches"}, aim fade ${fadeWrong ? "differs" : "matches"}`)
console.log(`CAST CORE OK (${frames.length} values match the preview timeline; aim arithmetic matches)`)

const library = process.argv[3]
if (library) {
  await cp(path.join(import.meta.dir, "gesture-library-check.java"), path.join(directory, "GestureLibraryCheck.java"))
  // Only the adapter class that touches nothing of the game: the rest of the adapter needs a running client.
  const played = run(`${gson}${path.delimiter}${library}`, "GestureLibraryCheck", [path.join(directory, "GestureLibraryCheck.java"), ...(await java("core")), path.join(sources, "fabric/client/GestureAnimations.java")], GESTURE_EASINGS.map((name) => GESTURE_LIBRARY_EASE[name]))
  const samples = played.filter((line) => line.startsWith("played "))
  const off = samples.filter((line) => {
    const [, index, part, tick, active, ...values] = line.split(" ").map((value, position) => (position === 2 ? value : Number(value))) as [string, number, "torso", number, number, ...number[]]
    const timeline = resolved[index]!.timeline
    // Past the end the library has let go, which reads as rest.
    const frame = timeline.frames[Math.min(tick, timeline.frames.length - 1)]!
    const want = [...frame[part].rotation, ...frame[part].position]
    const channels = { rotation: timeline.frames.some((value) => value[part].rotation.some((angle) => Math.abs(angle) > 0.01)), position: timeline.frames.some((value) => value[part].position.some((offset) => Math.abs(offset) > 0.001)) }
    // The library hands angles back within one turn; -180.03 and 179.97 are the same pose.
    const apart = (value: number, axis: number) => (axis < 3 ? Math.abs(((value - want[axis]! + 540) % 360) - 180) : Math.abs(value - want[axis]!))
    return active !== (tick < timeline.frames.length - 1 ? 1 : 0) || values.some((value, axis) => (axis < 3 ? channels.rotation : channels.position) && apart(value, axis) > (axis < 3 ? 0.02 : 0.002))
  })
  const curves = played.filter((line) => line.startsWith("ease "))
  const bent = GESTURE_EASINGS.filter((name) => {
    const values = curves.find((line) => line.split(" ")[1] === GESTURE_LIBRARY_EASE[name])?.split(" ").slice(2).map(Number)
    return !values || values.some((value, step) => Math.abs(value - GESTURE_EASE[name](step / 20)) > 1e-5)
  })
  if (off.length || bent.length || !samples.length) throw new Error(`CAST LIBRARY FAILED: ${off.length} of ${samples.length} played values differ (first: ${off[0]}), curves that differ: ${bent.join(", ") || "none"}`)
  console.log(`CAST LIBRARY OK (${samples.length} values played by the animation library match the preview, through the recovery, over ${acting(0)} and ${acting(1)} acting ticks; ${GESTURE_EASINGS.length} easing curves match)`)
}
await rm(directory, { recursive: true, force: true })

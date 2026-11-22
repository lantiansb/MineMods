import { spawn } from "node:child_process"
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { staticChecks } from "../src/gameplay-check"
import type { GameplayDocument } from "../src/gameplay"
import { genTarget } from "../src/platform/target"
import { openProject } from "../src/project"
import { jarName } from "../src/release"
import { storeLayout } from "../src/store/layout"
import { serverLaunchCommand } from "../src/store/launch"
import { toolchainFor } from "../src/toolchain/toolchain"
import { runToolchainGradle } from "../src/toolchain/run"
import type { TargetId } from "../src/target/ids"
import { createTargetGameplaySample } from "./target-gameplay-sample"

/**
 * The real check of the platform layer's gameplay group (D 组) on one target: the gameplay sample (`target-gameplay-sample.ts`: the crystal golem,
 * the guarding gameplay that keeps it to the azure ore, and a probe gameplay that uses every member of `ProjectPlatform`), with `--gestures` also two
 * cast actions, assembled by Studio's own `assembleBuildSource` and built by the target's real Gradle toolchain, then a real dedicated server of the
 * target (a flat world) driven over its console:
 * - the probe says the server started (and its own item is registered), that 100 ticks passed, that a world ticked;
 * - a golem by an ore: its added goal is asked, it goes for a villager standing still by the ore and its target rule is asked; `/gameplayprobe` counts it;
 * - the guarding gameplay: moved 21 blocks from the ore, the golem walks back (its position read before and after);
 * - killed, its death reaches the probe.
 * A server has no player: a key, a packet to a player, a right-click and what a player sees of a cast action are compiled, not seen.
 *
 *   bun packages/mod-core/script/target-gameplay-check.ts <target> <empty work folder> [--gestures]
 *
 * Environment: as `target-slice-check.ts` (MINEMODS_CHECK_RUNTIME, MINEMODS_JDK17, MINEMODS_JDK21, MINEMODS_CHECK_SERVER, MINEMODS_CHECK_GECKOLIB).
 */
const [target, work] = process.argv.slice(2) as [TargetId, string]
const gestures = process.argv.includes("--gestures")
if (!target || !work) throw new Error("Usage: bun packages/mod-core/script/target-gameplay-check.ts <target> <empty work folder> [--gestures]")
const need = (name: string) => process.env[name] ?? (() => { throw new Error(`${name} is not set`) })()
const runtime = need("MINEMODS_CHECK_RUNTIME")
const server = need("MINEMODS_CHECK_SERVER")
const geckolib = need("MINEMODS_CHECK_GECKOLIB")
const jdk = { 17: need("MINEMODS_JDK17"), 21: need("MINEMODS_JDK21") }
const manifest = genTarget(target).manifest
const templates = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const root = path.resolve(work)
await mkdir(root, { recursive: true })
if ((await readdir(root)).length) throw new Error("The work folder must be empty")
const log: string[] = []
const say = (line: string) => {
  log.push(line)
  console.log(line)
}
const seconds = (since: number) => ((Date.now() - since) / 1000).toFixed(1)

// ---- the source, by Studio's own assembly ----
const directory = path.join(root, "工程")
const project = await createTargetGameplaySample(directory, target, { gestures })
const opened = await openProject(directory)
for (const asset of opened.workspace.assets.filter((value) => value.document.kind === "gameplay")) {
  const checks = staticChecks(opened, asset.document as GameplayDocument, asset.id)
  say(`${target}: gameplay ${(asset.document as GameplayDocument).slug}: out of bounds ${checks.bounds.length}, broken references ${checks.references.length}`)
}
const source = path.join(root, "source")
await mkdir(source)
const assembled = Date.now()
const built = await assembleBuildSource(directory, source, templates)
say(`${target}: source assembled in ${seconds(assembled)} s (${built.gameplay.length} gameplays${gestures ? `, ${opened.workspace.assets.filter((value) => value.document.kind === "gesture").length} cast actions` : ""})`)

// ---- the target's real Gradle build ----
const building = Date.now()
const progress: string[] = []
const gradle = await runToolchainGradle(toolchainFor(manifest), source, "build", { runtimeDirectory: runtime, javaHome: jdk[21], javaHomes: jdk, onProgress: (text) => progress.push(text) })
await writeFile(path.join(root, "build.log"), progress.join(""))
const jar = path.join(source, "build", "libs", jarName(project))
say(`${target}: Gradle build exit ${gradle.code} in ${seconds(building)} s, jar ${path.basename(jar)}`)
if (gradle.code !== 0) throw new Error("GRADLE_BUILD_FAILED: see build.log")
const listing = Bun.spawnSync([path.join(jdk[21], "bin", "jar.exe"), "tf", jar]).stdout.toString().split(/\r?\n/)
const wanted = [...built.gameplayFiles, ...built.gestureFiles]
say(`${target}: jar holds ${wanted.filter((name) => listing.includes(name)).length}/${wanted.length} of the gameplay's${gestures ? " and the cast actions'" : ""} files${wanted.some((name) => !listing.includes(name)) ? `, missing ${wanted.filter((name) => !listing.includes(name)).join(", ")}` : ""}`)
if (gestures) {
  const nested = listing.filter((name) => /^META-INF\/jarjar\//.test(name))
  say(`${target}: jar-in-jar: ${nested.join(", ") || "none"}`)
}

// ---- a real dedicated server of the target, with the jar and GeckoLib ----
const runtimeHere = path.join(root, "runtime")
const instance = path.join(runtimeHere, storeLayout.instance(project.id, target), "server")
const copied = Date.now()
await cp(server, instance, { recursive: true, filter: (from) => !["world", "logs", "mods", "crash-reports"].includes(path.relative(server, from).split(path.sep)[0]!) })
await mkdir(path.join(instance, "mods"))
await cp(jar, path.join(instance, "mods", path.basename(jar)))
await cp(geckolib, path.join(instance, "mods", path.basename(geckolib)))
say(`${target}: server instance copied in ${seconds(copied)} s`)
const command = await serverLaunchCommand(runtimeHere, manifest, { projectId: project.id, javaExecutable: path.join(jdk[manifest.java.major as 17 | 21], "bin", "java.exe"), properties: { "level-name": "world", "level-type": "minecraft:flat", "spawn-protection": "0", "spawn-monsters": "false", difficulty: "normal", motd: "gameplay" } })
const golem = `${project.mod_id}:creature_${opened.entities[0]!.id.replaceAll("-", "")}`
const run = (line: string) => `execute in minecraft:overworld run ${line}`
const WAIT = "#wait"
const steps = [
  run("forceload add -32 -32 48 32"),
  "say GAMEPLAY_STEP golem by the ore",
  run(`setblock 3 -60 0 ${project.mod_id}:azure_ore`),
  run(`summon ${golem} 2 -60 3 {Tags:["golem"],PersistenceRequired:1b}`),
  WAIT,
  run(`summon minecraft:villager 5 -60 -1 {Tags:["villager"],NoAI:1b}`),
  WAIT,
  WAIT,
  "gameplayprobe",
  run("data get entity @e[tag=golem,limit=1] Pos"),
  "say GAMEPLAY_STEP golem led away",
  run("kill @e[tag=villager]"),
  run("tp @e[tag=golem,limit=1] 24 -60 3"),
  run("data get entity @e[tag=golem,limit=1] Pos"),
  // Where it is every 2.5 seconds for 15 seconds: walking back, and free again once it is there (2 blocks).
  ...Array.from({ length: 6 }, () => [WAIT, run("data get entity @e[tag=golem,limit=1] Pos")]).flat(),
  "say GAMEPLAY_STEP golem dies",
  run("kill @e[tag=golem]"),
  WAIT,
  "say GAMEPLAY_DONE",
]
const started = Date.now()
const child = spawn(command.java, command.args, { cwd: command.cwd, stdio: ["pipe", "pipe", "pipe"] })
const lines: string[] = []
let ready = 0
const done = new Promise<void>((resolve) => {
  const read = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line) continue
      lines.push(line)
      if (!ready && /Done \(/.test(line)) {
        ready = Date.now()
        void (async () => {
          for (const step of steps) {
            if (step !== WAIT) child.stdin.write(`${step}\n`)
            await new Promise((wait) => setTimeout(wait, step === WAIT ? 2500 : 700))
          }
        })()
      }
      if (/GAMEPLAY_DONE/.test(line)) child.stdin.write("stop\n")
    }
  }
  child.stdout.on("data", read)
  child.stderr.on("data", read)
  child.on("exit", () => resolve())
})
const timeout = setTimeout(() => child.kill(), 600000)
await done
clearTimeout(timeout)
await writeFile(path.join(root, "server.log"), lines.join("\n"))
const loud = lines.filter((line) => /\/(ERROR|FATAL)\]|Exception|Error:/.test(line))
const mine = loud.filter((line) => line.toLowerCase().includes(project.mod_id) || /geckolib|gameplay|gesture|playeranim/i.test(line))
say(`${target}: server ready in ${ready ? ((ready - started) / 1000).toFixed(1) : "never"} s, stopped after ${seconds(started)} s, exit ${child.exitCode}`)
for (const line of lines.filter((line) => /GAMEPLAY_PROBE|GAMEPLAY_STEP|Cast-action runtime|has the following entity data|golems: |playeranimator|Player Animator/i.test(line))) say(`    ${line.replace(/^.*?\]: /, "").slice(0, 220)}`)
// The guarding gameplay's walk back: its distance from the ore (the middle of the block at 3, -60, 0) at each reading after it was moved away.
const away = lines.findIndex((line) => /GAMEPLAY_STEP golem led away/.test(line))
const distances = lines.slice(away < 0 ? lines.length : away).flatMap((line) => {
  const at = /has the following entity data: \[(-?[\d.]+)d, (-?[\d.]+)d, (-?[\d.]+)d\]/.exec(line)
  return at ? [Math.hypot(Number(at[1]) - 3.5, Number(at[3]) - 0.5)] : []
})
say(`${target}: the guard's distance from its ore after being moved away, every 2.5 s: ${distances.map((value) => value.toFixed(1)).join(" → ")} (closest ${distances.length ? Math.min(...distances).toFixed(1) : "?"})`)
say(`${target}: log lines ${lines.length}, errors ${loud.length}, errors naming the mod, its gameplay, GeckoLib or playerAnimator ${mine.length}`)
for (const line of (mine.length ? mine : loud).slice(0, 12)) say(`    ${line.slice(0, 240)}`)
await writeFile(path.join(root, "summary.txt"), `${log.join("\n")}\n`)
await rm(runtimeHere, { recursive: true, force: true }).catch(() => undefined)

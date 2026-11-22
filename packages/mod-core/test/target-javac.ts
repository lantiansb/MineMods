import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { targetManifest } from "../src/target/manifests"

/**
 * Compiles generated Java for one target with javac alone, against that target's real compile class path (the game
 * named as the target names it, the loader, GeckoLib, the loader's API). Seconds instead of a Gradle build, so every
 * generator test can check that what it writes compiles on every target.
 *
 * MINEMODS_TARGET_CLASSPATH: a folder with `<target>.txt` per target (one jar per line, UTF-8), written by Gradle from a
 * project of that target (`studioClasspath` init script). MINEMODS_JDK17 / MINEMODS_JDK21: JDK folders. Where these are
 * absent the tests that need a compiler are skipped.
 */
const CLASSPATHS = process.env.MINEMODS_TARGET_CLASSPATH ?? ""
const jdk = (major: number) => process.env[`MINEMODS_JDK${major}`] ?? ""

export function hasTargetJavac(target: string) {
  const major = targetManifest(target.replace(/-official$/, "")).java.major
  return !!CLASSPATHS && existsSync(path.join(CLASSPATHS, `${target}.txt`)) && existsSync(path.join(jdk(major), "bin"))
}

/**
 * `target` is a manifest id, or `fabric-1.21.1-official` for Fabric with Mojang's names. With `classes` the compiled
 * classes are written to that folder and kept, for a test that reads them (`targetJavap`); without, they are thrown away.
 */
export async function targetJavac(target: string, sources: string, classes?: string, /** Jars beside the target's class path (a library only some mods use, such as playerAnimator). */ extra: readonly string[] = []) {
  const major = targetManifest(target.replace(/-official$/, "")).java.major
  const jars = [...(await readFile(path.join(CLASSPATHS, `${target}.txt`), "utf8")).split(/\r?\n/).filter(Boolean), ...extra]
  const files = (await readdir(sources, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name))
  const work = await mkdtemp(path.join(os.tmpdir(), "minemods-target-javac-"))
  // An argument file, so a class path of a hundred jars under a Chinese folder name is passed whole.
  const quote = (value: string) => `"${value.replaceAll("\\", "/")}"`
  const argumentsFile = path.join(work, "args.txt")
  await writeFile(argumentsFile, ["-proc:none", "-nowarn", "-encoding", "UTF-8", "-d", quote(classes ?? path.join(work, "out")), "-cp", quote(jars.join(path.delimiter)), ...files.map(quote)].join("\n"))
  try {
    return await new Promise<{ code: number; output: string }>((resolve) =>
      execFile(path.join(jdk(major), "bin", process.platform === "win32" ? "javac.exe" : "javac"), [`@${argumentsFile}`], { maxBuffer: 16 * 1024 * 1024, encoding: "utf8", env: { ...process.env, JAVA_TOOL_OPTIONS: "-Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -Dstderr.encoding=UTF-8" } }, (error, stdout, stderr) =>
        resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, output: `${stdout}${stderr}` }),
      ),
    )
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** One tool of a target's JDK (`javac`, `java`, `javap`), for a test that runs plain Java where the class path is set up. */
export const targetJdkTool = (target: string, tool: "javac" | "java" | "javap") => path.join(jdk(targetManifest(target.replace(/-official$/, "")).java.major), "bin", process.platform === "win32" ? `${tool}.exe` : tool)
const javapOf = (target: string) => targetJdkTool(target, "javap")

/** Whether `targetJavap` can read classes compiled for this target here. */
export const hasTargetJavap = (target: string) => hasTargetJavac(target) && existsSync(javapOf(target))

/** What `javap -p` prints for one class of a folder `targetJavac` kept: every member with its access, private ones too. */
export function targetJavap(target: string, classes: string, name: string) {
  const read = Bun.spawnSync([javapOf(target), "-p", "-cp", classes, name])
  if (read.exitCode !== 0) throw new Error(`javap could not read ${name}: ${read.stderr.toString()}`)
  return read.stdout.toString().replaceAll("\r\n", "\n")
}

import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gradleCompiler } from "../src/build"
import type { GameplayDocument } from "../src/gameplay"
import { compileGameplayCandidate, forgetCompiled, toolFailureWords } from "../src/gameplay-compile"
import { openProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetGameplaySample } from "../script/target-gameplay-sample"

/**
 * The code check runs the project's own Gradle with the Java the project's build needs: on Forge 1.20.1 that is 17 (and 21), handed over
 * exactly as a build hands it. It once went to Fabric's runner whatever the target, so a Forge 1.20.1 check gave Gradle Java 21 alone and
 * failed at `:createMinecraftArtifacts` every time, saying only that the tool had broken.
 *
 * MINEMODS_JDK17 / MINEMODS_JDK21: real JDKs; without them the tests that start Java are skipped. Gradle itself is never started here:
 * the check is stopped the moment the toolchain says it is starting Gradle.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const JDK17 = process.env.MINEMODS_JDK17 ?? ""
const JDK21 = process.env.MINEMODS_JDK21 ?? ""
const java = (home: string) => !!home && existsSync(path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java"))
const roots: string[] = []
afterEach(async () => {
  forgetCompiled()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** What Gradle printed when the check of 蚩尤 (Forge 1.20.1) was given no Java 17 (2026-11-16). */
const NO_JAVA_17 = `> Task :createMinecraftArtifacts FAILED

FAILURE: Build failed with an exception.

* What went wrong:
Execution failed for task ':createMinecraftArtifacts'.
> Error while evaluating property 'toolsJavaExecutable' of task ':createMinecraftArtifacts'.
   > Failed to calculate the value of task ':createMinecraftArtifacts' property 'toolsJavaExecutable'.
      > Cannot find a Java installation on your machine (Windows 11 10.0 amd64) matching: {languageVersion=17, vendor=any vendor, implementation=vendor-specific, nativeImageCapable=false}. Toolchain download repositories have not been configured.

* Try:
> Learn more about toolchain auto-detection and auto-provisioning at https://docs.gradle.org/8.14.3/userguide/toolchains.html#sec:auto_detection.
> Run with --stacktrace option to get the stack trace.

BUILD FAILED in 8s
1 actionable task: 1 executed
`

test("a compile tool that fails without naming a line says why: the Java it wanted, and what Gradle said went wrong", () => {
  const words = toolFailureWords(NO_JAVA_17)
  expect(words).toContain("Gradle 要用 Java 17")
  expect(words).toContain("languageVersion=17")
  expect(words).not.toContain("BUILD FAILED")
  // Anything else: Gradle's own "what went wrong", its deepest causes last.
  const other = toolFailureWords("FAILURE: Build failed with an exception.\n\n* What went wrong:\nCould not resolve all files for configuration ':compileClasspath'.\n> Could not find net.minecraftforge:forge:1.20.1.\n\n* Try:\n> Run with --info\n\nBUILD FAILED in 3s\n")
  expect(other).toBe("Gradle 最后说：Could not resolve all files for configuration ':compileClasspath'. Could not find net.minecraftforge:forge:1.20.1.")
  // No "what went wrong": the last lines that are not Gradle's usual footer.
  expect(toolFailureWords("Starting a Gradle Daemon\nError: could not open `jvm.cfg'\nBUILD FAILED in 1s\n")).toBe("Gradle 最后说：Starting a Gradle Daemon Error: could not open `jvm.cfg'")
  expect(toolFailureWords("")).toBe("它什么都没有输出。")
})

async function sample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-check-java-"))
  roots.push(root)
  const directory = path.join(root, "蚩尤")
  await createTargetGameplaySample(directory, target)
  const asset = (await openProject(directory)).workspace.assets.find((value) => value.document.kind === "gameplay")!
  return { root, directory, candidate: { asset_id: asset.id, title: asset.title, document: asset.document as GameplayDocument } }
}

/** Checks a gameplay of a sample project with the real Gradle compiler, stopped as soon as it is about to start Gradle. */
async function check(target: TargetId, javaHomes: Partial<Record<number, string>>) {
  const { root, directory, candidate } = await sample(target)
  const stop = new AbortController()
  const lines: string[] = []
  const options = {
    templateDirectory: TEMPLATE,
    javaHome: JDK21,
    javaHomes,
    runtimeDirectory: path.join(root, "runtime"),
    signal: stop.signal,
    onProgress: (text: string) => {
      lines.push(text)
      if (text.startsWith("Compiling the generated sources with Gradle")) stop.abort()
    },
  }
  const result = await compileGameplayCandidate(directory, { templateDirectory: TEMPLATE, candidate, compiler: gradleCompiler(options), signal: stop.signal }).then(
    (value) => ({ value }),
    (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
  )
  return { result, lines }
}

test.skipIf(!java(JDK17) || !java(JDK21))("a Forge 1.20.1 check starts Gradle the way a Forge 1.20.1 build does: with Java 17 and Java 21, through its own toolchain", async () => {
  const { result, lines } = await check("forge-1.20.1", { 17: JDK17, 21: JDK21 })
  expect(result).toEqual({ error: "CANCELLED" })
  // The toolchain's own line (Fabric's runner says no target), said after Java 17 and 21 were both found and checked.
  expect(lines).toContain("Compiling the generated sources with Gradle (forge-1.20.1; no jar, no game).\n")
}, 120000)

test.skipIf(!java(JDK21))("a Forge 1.20.1 check given no Java 17 says so in plain words, and never starts Gradle on Java 21 alone", async () => {
  // A Java 21 named as the 17: the build refuses it (JAVA_17_REQUIRED), and so does the check, before Gradle is started.
  const { result, lines } = await check("forge-1.20.1", { 17: JDK21, 21: JDK21 })
  expect(lines.some((line) => line.startsWith("Compiling the generated sources with Gradle"))).toBe(false)
  expect(result).toMatchObject({ value: { ran: false } })
  const reason = (result as { value: { reason: string } }).value.reason
  expect(reason).toContain("检查要用 Java 17")
  expect(reason).toContain("forge-1.20.1")
}, 120000)

test.skipIf(!java(JDK21))("a Fabric 1.21.1 check runs Gradle as it always did: Loom's runner, Java 21", async () => {
  const { result, lines } = await check("fabric-1.21.1", {})
  expect(result).toEqual({ error: "CANCELLED" })
  expect(lines).toContain("Compiling the generated sources with Gradle (no jar, no game).\n")
}, 120000)

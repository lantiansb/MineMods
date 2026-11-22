import { createHash } from "node:crypto"
import { mkdir, readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { resolveProfile } from "../fabric/profile"
import { GRADLE_STOOD_STILL, retryGradle, type GradleResult } from "../gradle-network"
import {
  MANAGED_JAVA,
  directorySize,
  ensureJavaMajor,
  gradleStall,
  proxyJvmArgs,
  recordManagedEnvironmentUse,
  runGradle,
  runOwnedProcess,
  runtimeEnvironment,
  validateJava,
  waitTurn,
  watchGradleDownloads,
  withRuntimeLeases,
  writeCaptureScript,
  type RuntimeOptions,
} from "../runtime"
import type { Toolchain, ToolchainTask } from "./toolchain"

export type ToolchainRunOptions = RuntimeOptions & {
  /** A JDK the person (or a test) named for a Java major; the others are found or installed as `ensureJavaMajor` does. `javaHome` stands for 21, as it always has. */
  javaHomes?: Partial<Record<number, string>>
}

const WRAPPER = "gradle/wrapper/gradle-wrapper.jar"

/**
 * Runs one Gradle task of a project made from a toolchain's template.
 *
 * Loom hands over to `runGradle` unchanged. ModDevGradle runs the same way (the runtime environment's lease, Gradle's
 * folder in the runtime directory, a run that stands still ended and a download that broke off run again, the game itself
 * never started twice), with every JDK of the manifest found or installed first and handed to Gradle. It leaves no "ready"
 * mark (`markGradleReady`): that mark says Fabric's development files are in place, which a Forge or NeoForge build says nothing about.
 */
export async function runToolchainGradle(toolchain: Toolchain, sourceDirectory: string, task: ToolchainTask, options: ToolchainRunOptions): Promise<GradleResult> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  if (toolchain.kind === "loom") {
    if (task === "runServer") throw new Error("UNSUPPORTED_GRADLE_TASK")
    return runGradle(sourceDirectory, task, { ...options, javaHome: options.javaHomes?.[21] ?? options.javaHome })
  }
  if (!toolchain.tasks.includes(task)) throw new Error("UNSUPPORTED_GRADLE_TASK")
  const wrapper = await readFile(path.join(sourceDirectory, WRAPPER))
  if (createHash("sha256").update(wrapper).digest("hex") !== resolveProfile("fabric-1.21.1").gradle.wrapper.sha256) throw new Error("GRADLE_WRAPPER_CHECKSUM_MISMATCH")
  if (task === "compileJava") await writeCaptureScript(sourceDirectory)
  const named = (major: number) => options.javaHomes?.[major] ?? (major === 21 ? options.javaHome : undefined)
  const found = new Map<number, string>()
  for (const major of toolchain.javaMajors) found.set(major, await ensureJavaMajor(options.runtimeDirectory, major, { ...options, javaHome: named(major) }))
  await mkdir(options.runtimeDirectory, { recursive: true })
  const runtimeRoot = await realpath(options.runtimeDirectory)
  const javaRoot = options.javaDirectory ? await realpath(options.javaDirectory).catch(() => undefined) : undefined
  // A Studio-installed JDK under a root of the person's own is held by that root's lease too, as `withBuildEnvironment` does for Java 21.
  const apart = !!javaRoot && javaRoot !== runtimeRoot && [...found.values()].some((home) => path.dirname(path.resolve(home)) === javaRoot)
  return withRuntimeLeases(apart ? [javaRoot!, runtimeRoot] : [runtimeRoot], waitTurn(options), async () => {
    for (const [major, home] of found)
      await validateJava(home, options, major).catch(() => {
        throw new Error("JAVA_RUNTIME_REMOVED_RETRY")
      })
    // The usage record knows Studio's Java 21 and Gradle's folder; Java 17 is not one of its entries yet.
    const managed = (root: string) => (path.resolve(found.get(21) ?? "") === path.join(root, MANAGED_JAVA) ? [MANAGED_JAVA] : [])
    if (apart && managed(javaRoot!).length) await recordManagedEnvironmentUse(javaRoot!, [MANAGED_JAVA])
    const gradleHome = path.join(runtimeRoot, "gradle-home")
    await mkdir(gradleHome, { recursive: true })
    await recordManagedEnvironmentUse(runtimeRoot, ["gradle-home", ...managed(runtimeRoot)])
    const invocation = toolchain.gradle(task, found)
    const environment = runtimeEnvironment()
    options.onProgress?.(
      task === "build"
        ? `Building the saved project with Gradle (${toolchain.target.id}).\n`
        : task === "compileJava"
          ? `Compiling the generated sources with Gradle (${toolchain.target.id}; no jar, no game).\n`
          : `Starting the development Minecraft ${task === "runServer" ? "server" : "client"} (${toolchain.target.id}).\n`,
    )
    const watch = options.onProgress ? watchGradleDownloads(gradleHome, options.onProgress, undefined, undefined, toolchain.gameCache) : undefined
    const game = task === "runClient" || task === "runServer"
    const once = () =>
      runOwnedProcess(
        path.join(invocation.javaHome, "bin", process.platform === "win32" ? "java.exe" : "java"),
        // The wrapper is named relative to the project folder (the working directory), so the project's own path is not on the command line.
        [...proxyJvmArgs(environment), "-classpath", WRAPPER, "org.gradle.wrapper.GradleWrapperMain", ...invocation.args],
        {
          cwd: sourceDirectory,
          env: { ...environment, ...invocation.env, JAVA_HOME: invocation.javaHome, GRADLE_USER_HOME: gradleHome },
          signal: options.signal,
          ...(game
            ? { timeoutMs: 14400000 }
            : { stall: gradleStall(options.stall, gradleHome, sourceDirectory) }),
          onProgress: options.onProgress,
          lowPriority: options.lowPriority,
        },
      ).catch((error: unknown): { code: number; output: string } => {
        if (!(error instanceof Error && error.message === "PROCESS_STALLED")) throw error
        options.onProgress?.(`${GRADLE_STOOD_STILL}\n`)
        return { code: 1, output: `${(error as Error & { output?: string }).output ?? ""}${GRADLE_STOOD_STILL}\n` }
      })
    try {
      return game
        ? await once().then((value): GradleResult => ({ ...value, network: false, retries: 0 }))
        : await retryGradle(once, { ...options, downloaded: () => directorySize(path.join(gradleHome, "caches")) })
    } finally {
      watch?.()
    }
  })
}

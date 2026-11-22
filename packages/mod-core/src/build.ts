import { z } from "zod"
import { BuildWarningSchema, buildWarnings } from "./build-warnings"
export { BuildWarningSchema } from "./build-warnings"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { noteActivity } from "./activity"
import { bbmodelNames, bbmodelText } from "./bbmodel"
import { GUIDE_FILE } from "./guide"
import { findingText } from "./reconcile"
import { assembleBuildSource } from "./build-source"
import type { CodeCompiler } from "./gameplay-compile"
import { resolveProfile } from "./fabric/profile"
import { openProject, storagePath, withProjectLock } from "./project"
import { jarName } from "./release"
import { BUILD_NETWORK_FAILED, CHECK_NETWORK_WORDS, gradleNetworkDetail } from "./gradle-network"
import { compileInputs, setupKey } from "./compile-key"
import { DIRECT_COMPILER, compileDirect, errorSet, learnAndCalibrate, readRecord } from "./javac-direct"
import { ensureJava, gradleWhole, runGradle, runOwnedProcess, withBuildEnvironment } from "./runtime"
import { scaffoldProject } from "./fabric/scaffold"
import { STALE_BUILD_CODE } from "./build-stages"
import { ensureOfficialNaming } from "./naming-migration"
import { targetManifest } from "./target/manifests"
import type { TargetManifest } from "./target/manifest"
import { DEFAULT_TARGET } from "./target/ids"
import { toolchainFor } from "./toolchain/toolchain"
import { runToolchainGradle } from "./toolchain/run"
import { PLATFORM_CLASS, PLATFORM_PACKAGE } from "./platform/facade"

const AbsolutePath = z.string().refine(path.isAbsolute)
export const BuildResultSchema = z.strictObject({
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  jarPath: AbsolutePath,
  projectDirectory: AbsolutePath,
  sourceDirectory: AbsolutePath,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** How many gameplay units of AI-written code went into the jar. Absent for a mod without any, so its record is as before. */
  gameplay_units: z.number().int().min(1).optional(),
  /**
   * What machine reconciliation found that does not stop the build but would leave the mod not doing what the
   * project says. Absent when it found nothing, so such a build's record is as before.
   */
  warnings: z.array(BuildWarningSchema).min(1).optional(),
})
export type BuildResult = z.infer<typeof BuildResultSchema>
export type BuildOptions = {
  templateDirectory: string
  javaHome?: string
  /** The root the Studio-installed JDK lives under when the person picked one; left out, the runtime directory. */
  javaDirectory?: string
  runtimeDirectory: string
  onProgress?: (text: string) => void
  /** Gradle is being run again because a download broke off; `attempt` counts from 1. */
  onRetry?: (attempt: number) => void
  /** How the pause before such a retry is waited out; left unset outside tests. */
  pause?: (ms: number) => Promise<unknown>
  signal?: AbortSignal
  /** The person's name as the app knows it: the mod's author when the project's own `release.author` says nothing. */
  author?: string
  /** Gradle's process runs below normal priority: set for what is done ahead of need (`prepareDevelopmentFiles`), never for a pack the person is waiting for. */
  lowPriority?: boolean
  /** For tests: how long a Gradle run may stand still and how often that is looked at (`RuntimeOptions.stall`). */
  stall?: { ms?: number; every?: number }
  /** A JDK named for a Java major a target's build needs besides 21 (Forge 1.20.1 builds on 17 too); the others are found or installed (`runToolchainGradle`). */
  javaHomes?: Partial<Record<number, string>>
  /**
   * For tests and checks only: build a project whose target is not ready yet (its manifest's `ready` is false). Studio never sets it, so a
   * person cannot get a jar for a target that is still being ported.
   */
  unreadyTargets?: boolean
}

export async function buildProjectFiles(projectDirectory: string, options: BuildOptions): Promise<BuildResult> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const root = await realpath(projectDirectory)
  // An older project's gameplay code is in Yarn's names: converted once, here, before the first build that compiles it against Mojang's.
  const converted = await ensureOfficialNaming(root, options)
  const id = randomUUID()
  const source = await withProjectLock(root, async () => {
    const opened = await openProject(root)
    // The project's target picks the toolchain below; one whose manifest is not ready is built only when a test asks for it.
    if (!targetManifest(opened.target).ready && !options.unreadyTargets) throw new Error("TARGET_NOT_READY")
    const directory = path.join(path.dirname(await storagePath(root, ["generated", "reserve"], true)), `build-${id}`)
    await mkdir(directory)
    options.onProgress?.("Assembling a saved project snapshot.\n")
    return { directory, ...(await assembleBuildSource(root, directory, options.templateDirectory, options.author ? { author: options.author } : {})) }
  })
  if (options.signal?.aborted) throw new Error("CANCELLED")
  // Said before the long compile, in the activity panel and in the build log: nothing here stops the build.
  const findings = source.findings.filter((finding) => !finding.stops)
  const warnings = buildWarnings(findings)
  void noteActivity(
    root,
    warnings.length
      ? findings.map((finding, index) => ({ kind: "check" as const, mark: "warn" as const, item: null, title: finding.about?.name ?? null, text: finding.text, lines: [finding.fix], build_warning: { ...warnings[index]!, build_id: id }, ...(finding.detail ? { detail: finding.detail } : {}) }))
      : { kind: "check", mark: "ok", item: null, title: null, text: "机器对账：做出来的文件和工程里写的对得上，没有发现问题。" },
  )
  findings.forEach((finding) => options.onProgress?.(`机器对账：${findingText(finding)}\n`))
  // The toolchain of the project's target (`projectGradle`); the file that declares its mod is looked for in the jar below.
  const toolchain = toolchainFor(source.target.manifest)
  const processResult = await projectGradle(source.target.manifest, source.directory, "build", options)
  // Code a machine has just renamed may keep a name it missed: whoever reads the failure is told where to look.
  if (processResult.code !== 0 && !processResult.network && converted?.revisions.length)
    options.onProgress?.(`${converted.revisions.map((entry) => `「${entry.title}」`).join("、")}的玩法代码刚从 Yarn 命名自动换成了 Mojang 官方命名，编译不过多半是没换到的旧名字：让 AI 按编译错误把这些玩法改成官方命名。\n`)
  // A download that kept breaking off is not the mod's fault and is said as that; anything else is a failed build.
  if (processResult.code !== 0)
    throw processResult.network
      ? Object.assign(new Error(BUILD_NETWORK_FAILED), { detail: gradleNetworkDetail(processResult.output) })
      : new Error("GRADLE_BUILD_FAILED")
  const jarPath = await storagePath(root, [
    "generated",
    `build-${id}`,
    "build",
    "libs",
    jarName(source.project),
  ])
  const javaHome = await ensureJava(options.runtimeDirectory, options)
  const listing = await runOwnedProcess(
    path.join(javaHome, "bin", process.platform === "win32" ? "jar.exe" : "jar"),
    ["tf", jarPath],
    { signal: options.signal, timeoutMs: 30000 },
  )
  const names = new Set(listing.output.split(/\r?\n/))
  const packageRoot = source.packageName.replaceAll(".", "/")
  const required = [
    // The file that declares the mod (fabric.mod.json, META-INF/mods.toml, META-INF/neoforge.mods.toml), and a facade target's facade.
    toolchain.modFile,
    ...(source.target.loader.facade ? [`${packageRoot}/${PLATFORM_PACKAGE}/${PLATFORM_CLASS}.class`] : []),
    `${packageRoot}/StudioContent.class`,
    `${packageRoot}/StudioContentRegistry.class`,
    ...source.entityClasses.map((name) => `${packageRoot}/${name}.class`),
    ...source.clientClasses.flatMap((name) => [`${packageRoot}/client/${name}.class`]),
    ...source.entityIds.flatMap((entityId) => [
      `assets/${source.project.mod_id}/geo/${entityId}.geo.json`,
      `assets/${source.project.mod_id}/textures/entity/${entityId}.png`,
      `assets/${source.project.mod_id}/animations/${entityId}.animation.json`,
    ]),
    ...source.gestureFiles,
    ...source.gameplayFiles,
    ...source.effectFiles,
    ...source.bookFiles,
    ...source.soundFiles,
    ...source.glowMasks,
    ...source.hitboxFiles,
    ...source.bossFiles,
    ...source.warnFiles,
    ...source.bossBarFiles,
    ...source.weatherFiles,
    ...source.projectileFiles,
    ...source.groundFxFiles,
    ...source.abilityFiles,
    ...source.arenaFiles,
    ...source.glyphFiles,
  ]
  if (listing.code !== 0 || !required.every((name) => names.has(name)))
    throw new Error("INVALID_BUILD_JAR")
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const result = BuildResultSchema.parse({
    id,
    revision: source.project.revision,
    jarPath,
    projectDirectory: root,
    sourceDirectory: source.directory,
    sha256: createHash("sha256")
      .update(await readFile(jarPath))
      .digest("hex"),
    ...(source.gameplay.length ? { gameplay_units: source.gameplay.length } : {}),
    ...(warnings.length ? { warnings } : {}),
  })
  await writeBuildCompanions(root, id, source)
  if (source.gameplay.length) options.onProgress?.(`This mod contains ${source.gameplay.length} gameplay unit(s) of AI-written code: ${source.gameplay.map((entry) => entry.title).join(", ")}. It was compiled, not played: test it in the game yourself.\n`)
  await withProjectLock(root, async () => {
    if ((await openProject(root)).revision !== result.revision) throw new Error(STALE_BUILD_CODE)
    if (options.signal?.aborted) throw new Error("CANCELLED")
    await writeFile(
      await storagePath(root, [".minemods", "builds", `${id}.json`], true),
      `${JSON.stringify(result, null, 2)}\n`,
      { flag: "wx" },
    )
  })
  return result
}

/**
 * What a build leaves beside its jar, never inside it: the guide written from this very revision
 * (模组说明.md) and each creature's model for Blockbench (models/<name>.bbmodel).
 */
export async function writeBuildCompanions(root: string, id: string, source: Pick<Awaited<ReturnType<typeof assembleBuildSource>>, "guide" | "looks">) {
  const libs = ["generated", `build-${id}`, "build", "libs"]
  await writeFile(await storagePath(root, [...libs, GUIDE_FILE], true), source.guide.markdown)
  const models = bbmodelNames(source.looks.map((look) => look.name))
  await Promise.all(source.looks.map(async (look, index) => writeFile(await storagePath(root, [...libs, "models", models[index]!], true), bbmodelText(look))))
  return { guide: GUIDE_FILE, models }
}

export async function verifyBuiltResult(projectDirectory: string, input: BuildResult) {
  const result = BuildResultSchema.parse(input)
  const root = await realpath(projectDirectory)
  if (root !== result.projectDirectory) throw new Error("BUILD_PROJECT_MISMATCH")
  const project = await openProject(root)
  if (project.revision !== result.revision) throw new Error(STALE_BUILD_CODE)
  const recorded = BuildResultSchema.parse(
    JSON.parse(await readFile(await storagePath(root, [".minemods", "builds", `${result.id}.json`]), "utf8")),
  )
  // Deep, not by identity: the warnings are a list.
  if (!isDeepStrictEqual(recorded, result))
    throw new Error("BUILD_RECORD_MISMATCH")
  const jar = await storagePath(root, [
    "generated",
    `build-${result.id}`,
    "build",
    "libs",
    jarName(project),
  ])
  if (result.jarPath !== jar || result.sourceDirectory !== path.join(root, "generated", `build-${result.id}`))
    throw new Error("BUILD_PATH_MISMATCH")
  const bytes = await readFile(jar)
  if (createHash("sha256").update(bytes).digest("hex") !== result.sha256) throw new Error("BUILD_CHECKSUM_MISMATCH")
  // What the jar needs to run: the target's manifest on every target; Fabric's pinned profile too, which says it the way every Fabric export always has.
  const manifest = targetManifest(project.target)
  return { result, project, bytes, manifest, profile: manifest.loader.kind === "fabric" ? resolveProfile(project.target) : null }
}

/**
 * Gets the development files (Gradle itself, Minecraft's, the libraries: the one folder every build, code check and development game shares) onto this
 * computer before a pack asks for them. They are the same for every mod of this Minecraft version, so the project it is done for does not matter: Gradle
 * builds an empty mod made from the template, the very task a pack runs (`build`), and ends the way a pack ends (the same mark, `gradleWhole`).
 *
 * It is `build` and not the code check's `compileJava` because the two do not fetch the same files. Compiling needs the game's jars and the libraries to compile
 * against; the pack's `remapJar` (Loom's task, which `build` runs) also resolves the game's runtime libraries, among them the system-specific LWJGL natives (24 of them, about
 * 7.5 MB), and a first pack after a `compileJava` preparation still downloaded those (round 21). Asking Gradle for the pack's own task is what makes "prepared" mean "the
 * pack finds nothing left to fetch" for every file the pack asks for, now and when Loom's list changes, without Studio keeping a list of its own.
 *
 * It goes through `runGradle`, so it takes its turn at the runtime environment like any pack: a pack that comes while it runs waits for it and then finds everything
 * there. Nothing is done when the mark of a finished pack-task run is already there. A download that kept breaking off, or stood still, throws `BUILD_NETWORK_FAILED`.
 */
export async function prepareDevelopmentFiles(options: BuildOptions): Promise<"already" | "prepared"> {
  if (await gradleWhole(options.runtimeDirectory)) return "already"
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const directory = path.join(options.runtimeDirectory, "prepare", `development-${randomUUID()}`)
  try {
    // What an earlier run that was cut off by the app closing left behind; only one of these runs at a time.
    await rm(path.dirname(directory), { recursive: true, force: true }).catch(() => undefined)
    await mkdir(path.dirname(directory), { recursive: true })
    await scaffoldProject({ templateDirectory: options.templateDirectory, directory, modId: "prepare", name: "prepare", packageName: "studio.prepare" })
    const result = await runGradle(directory, "build", options)
    if (result.code !== 0) throw new Error(result.network ? BUILD_NETWORK_FAILED : "PREPARE_FAILED")
    return "prepared"
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * One Gradle task of a generated project, by its target's toolchain: Fabric's Loom runs exactly as it always did; Forge and NeoForge run ModDevGradle
 * with every JDK their build needs (Forge 1.20.1: 17 and 21). A build and a code check both come here, so a check is given the very Java a build is
 * given (a check that went to Loom's runner on a Forge 1.20.1 project gave Gradle Java 21 alone, and Gradle stopped at once looking for 17).
 */
export function projectGradle(manifest: TargetManifest, sourceDirectory: string, task: "build" | "compileJava", options: BuildOptions) {
  const toolchain = toolchainFor(manifest)
  return toolchain.kind === "loom" ? runGradle(sourceDirectory, task, options) : runToolchainGradle(toolchain, sourceDirectory, task, options)
}

export const GRADLE_COMPILER = "gradle compileJava"

/**
 * The real compiler behind a gameplay code check: the generated project's own Gradle, told to compile and stop (about a minute even when
 * everything is downloaded, most of it Gradle starting up). Once a Gradle compile of this build setup has run and javac, given the very
 * classpath and flags that Gradle gave it, has agreed with it on the same files (`javac-direct.ts`), later checks hand javac that list
 * themselves, which takes seconds. Which of the two ran is the `compiler` of the result. Anything that stands in the way of the short way
 * (nothing learnt yet, a library gone from the cache, javac failing without naming a line, errors only outside the gameplay's files)
 * ends in the Gradle way, so a verdict is never given on less than the real build's compile.
 */
export const gradleCompiler = (options: BuildOptions): CodeCompiler => {
  // Another JDK, or another folder of downloaded libraries, is another compiler: the same files may then come out differently.
  const identity = async () => `${options.javaHome ?? process.env.JAVA_HOME ?? ""}\n${options.javaDirectory ?? ""}\n${path.resolve(options.runtimeDirectory)}${options.javaHomes ? `\n${JSON.stringify(Object.entries(options.javaHomes).sort())}` : ""}`
  const javacOf = (javaHome: string) => path.join(javaHome, "bin", process.platform === "win32" ? "javac.exe" : "javac")
  return {
    name: GRADLE_COMPILER,
    identity,
    run: async (sourceDirectory, gameplay, target: string = DEFAULT_TARGET) => {
      const key = await compileInputs(sourceDirectory)
        .then(async (inputs) => setupKey(inputs, await identity()))
        .catch(() => null)
      const record = key === null ? null : await readRecord(options.runtimeDirectory, key).catch(() => null)
      // A trusted record that could not be used, or whose answer Gradle had to confirm, is learnt again from the Gradle run below.
      let relearn = false
      if (record?.trusted) {
        const direct = await withBuildEnvironment(options, async ({ javaHome, environment }) =>
          compileDirect(sourceDirectory, record, { run: runOwnedProcess, javac: javacOf(javaHome), env: { ...environment, JAVA_HOME: javaHome }, signal: options.signal, onProgress: options.onProgress }),
        ).catch((error: unknown) => {
          if (options.signal?.aborted) throw error
          return { reason: error instanceof Error ? error.message : String(error) }
        })
        if ("reason" in direct) {
          relearn = true
          options.onProgress?.(`Direct javac not used (${direct.reason}); compiling with Gradle.\n`)
        } else if (direct.code === 0 || namesError(direct.output, gameplay)) {
          return { ...direct, compiler: DIRECT_COMPILER }
        } else {
          relearn = true
          options.onProgress?.("Direct javac named no error in the gameplay's own files; asking Gradle to confirm.\n")
        }
      }
      const result = await projectGradle(targetManifest(target), sourceDirectory, "compileJava", options)
      // A download that kept breaking off taught nothing about the code: the check did not run, and the writer is told to try later.
      if (result.network) throw new Error(CHECK_NETWORK_WORDS)
      // The next check of this build setup may be quicker. Learning it costs one javac run, once, and cannot fail this check.
      if (key !== null && (!record || relearn) && (result.code === 0 || errorSet(result.output).length > 0)) {
        const told = await withBuildEnvironment(options, async ({ javaHome, environment }) =>
          learnAndCalibrate({ sourceDirectory, runtimeDirectory: options.runtimeDirectory, key, gradle: result, how: { run: runOwnedProcess, javac: javacOf(javaHome), env: { ...environment, JAVA_HOME: javaHome }, signal: options.signal } }),
        ).catch((): string => "")
        if (told) options.onProgress?.(told)
      }
      return { ...result, compiler: GRADLE_COMPILER }
    },
  }
}

/** Whether a failed compile named an error in the gameplay's own folder: the one kind of failure a verdict is given on without Gradle confirming it. */
function namesError(output: string, gameplay: string) {
  const folder = `${gameplay.split(path.sep).join("/")}/`
  return output
    .replaceAll("\r\n", "\n")
    .split("\n")
    .some((line) => {
      const match = /^(.*\.java):\d+: error: /.exec(line.trim().replaceAll("\\", "/"))
      return !!match && match[1]!.includes(folder)
    })
}

export { assembleBuildSource } from "./build-source"
export { compileGameplayCandidate, type CodeCompiler } from "./gameplay-compile"
export { exportProjectSource, exportBuiltJar } from "./export"
export { launchPlaytest } from "./playtest"

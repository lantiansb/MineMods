import { randomUUID } from "node:crypto"
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { resolveProfile } from "./fabric/profile"
import { checkGradleWrapper } from "./fabric/scaffold"
import { GAMEPLAY_API, GameplayDocumentSchema, gameplayRoot, sourceFile, type GameplayDocument } from "./gameplay"
import { expandGameWildcards, jarClassIndex } from "./gameplay-naming"
import type { GradleResult } from "./gradle-network"
import { NAMING_RECORD, NamingRecordSchema } from "./naming-migration/record"
import { yarnGameplayApi } from "./naming-migration/yarn-api"
import {
  ProjectSchema,
  assetVersionSegments,
  hasGameplayCode,
  openProject,
  readProjectRecord,
  saveProjectUnlocked,
  storagePath,
  withProjectLock,
  writeRecord,
  type KeptVersion,
  type Project,
} from "./project"
import { MIGRATE_MAPPINGS_TASK, runGradle, type RuntimeOptions } from "./runtime"

/**
 * Gameplay code of an older project, written by an AI in Yarn's names of the game, converted once to Mojang's names (the ones every generator now
 * writes) before the project's first build in them.
 *
 * The recipe is the one proven on real AI code (47 files, 3075 lines, one leftover error): wildcard imports of the game are spelled out first
 * (`gameplay-naming.ts`), then Loom's `migrateMappings` renames everything else, in a throwaway Loom project set up with Yarn names under the runtime
 * folder. The support code the gameplay calls into goes into that project too, frozen as it was generated in Yarn's names (`naming-migration/yarn-api.ts`):
 * without it Loom cannot tell what a call on `ProjectContent.entity(...)` returns, and leaves the names after it as they were.
 *
 * Every gameplay whose code changed is saved as a new revision, kept as a version made `by: "converted"` (shown as 「从旧命名自动转换」, never as an
 * AI's or the person's); the revision before stays as its own saved version (what 「制作过程」 shows, with or without an AI making record), and the
 * project file as it was is copied aside. Then the project is marked `naming: "official"`. Anything that goes wrong leaves the project as it was and is
 * said in plain words; what Loom could not rename is left for the code check to find, and its findings say the code was converted.
 */

/** Said in the build's progress before the conversion starts. */
export const NAMING_MIGRATION_WORDS = "这个工程的玩法代码是按旧的 Yarn 命名写的，正在自动换成 Mojang 官方命名（只做一次，原来的版本留着）"
/** Thrown by `ensureOfficialNaming` when the conversion did not happen; what went wrong was said in the progress just before. */
export const NAMING_MIGRATION_FAILED = "NAMING_MIGRATION_FAILED"

/** One gameplay source file, by its gameplay asset and its path in the gameplay. */
export type MigratedFile = { asset_id: string; title: string; path: string }

export type NamingMigrationReport = {
  /** `not_needed`: already official, or no gameplay code; nothing was touched. `failed`: nothing was touched either, and `failures` says why. */
  state: "migrated" | "not_needed" | "failed"
  /** Files whose text changed (a wildcard spelled out counts). */
  converted: MigratedFile[]
  /** Files Loom handed back exactly as they were. */
  unchanged: MigratedFile[]
  /** Wildcard imports of a package the Yarn-named game does not have: left as written, and likely what the code check finds. */
  unknownWildcards: (MigratedFile & { package: string })[]
  /** Each gameplay saved as a new revision: `from` is the revision kept as the backup. */
  revisions: { asset_id: string; title: string; from: number; to: number }[]
  /** Plain Chinese, one sentence each; empty unless `state` is `failed`. */
  failures: string[]
}

export type GradleRunner = (directory: string, task: typeof MIGRATE_MAPPINGS_TASK, options: RuntimeOptions) => Promise<Pick<GradleResult, "code" | "output"> & { network?: boolean }>

export type NamingMigrationOptions = RuntimeOptions & {
  /** The Fabric template: the Gradle wrapper of the throwaway project is copied from it (and checked against the pinned one). */
  templateDirectory: string
  /** Runs Loom; `runGradle` unless a test stands in for it. */
  gradle?: GradleRunner
}

/** Whether a project's gameplay code still has to be converted: it has some, and was never marked as written in the official names. */
export const needsNamingMigration = (project: Pick<Project, "naming" | "workspace">) => project.naming !== "official" && hasGameplayCode(project)

/**
 * Where Loom keeps the game in Yarn's names, as Studio's Gradle (`runGradle`: `GRADLE_USER_HOME` is the runtime folder's `gradle-home`) leaves it once
 * any project set up with Yarn names has been configured. The conversion reads which classes each package has from it.
 */
export function yarnGameJar(runtimeDirectory: string) {
  const profile = resolveProfile("fabric-1.21.1")
  const version = `${profile.minecraft}-net.fabricmc.yarn.${profile.minecraft.replaceAll(".", "_")}.${profile.yarn}-v2`
  return path.join(runtimeDirectory, "gradle-home", "caches", "fabric-loom", "minecraftMaven", "net", "minecraft", "minecraft-merged", version, `minecraft-merged-${version}.jar`)
}

/** The throwaway project's build: what the Fabric template was while it wrote Yarn names, reduced to what `migrateMappings` reads (the game, its names, the libraries gameplay may use). */
function yarnBuildFiles() {
  const profile = resolveProfile("fabric-1.21.1")
  return {
    "settings.gradle": `pluginManagement {
    repositories {
        maven { url = 'https://maven.fabricmc.net/' }
        mavenCentral()
        gradlePluginPortal()
    }
}

rootProject.name = 'naming_migration'
`,
    "build.gradle": `// Written by MineMods Studio to convert gameplay code from Yarn names to Mojang's (migrateMappings). Thrown away afterwards.
plugins {
    id 'fabric-loom' version '${profile.loom}'
}

repositories {
    maven {
        name = 'GeckoLib'
        url = '${profile.geckolib.repository}'
        content { includeGroup('software.bernie.geckolib') }
    }
}

dependencies {
    minecraft "com.mojang:minecraft:${profile.minecraft}"
    mappings "net.fabricmc:yarn:${profile.yarn}:v2"
    modImplementation "net.fabricmc:fabric-loader:${profile.loader}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:${profile.fabricApi}"
    modImplementation "${profile.geckolib.coordinate}"
}

java {
    sourceCompatibility = JavaVersion.toVersion(${profile.java.major})
    targetCompatibility = JavaVersion.toVersion(${profile.java.major})
}

tasks.withType(JavaCompile).configureEach {
    it.options.encoding = 'UTF-8'
}
`,
    "gradle.properties": "org.gradle.jvmargs=-Xmx2G\n",
  }
}

type Source = MigratedFile & { file: string; original: string }

const exists = (file: string) => lstat(file).then(() => true, () => false)
const lastLines = (output: string, count = 6) => output.replaceAll("\r\n", "\n").trim().split("\n").slice(-count).join(" / ").slice(0, 600)
const failed = (failures: string[]): NamingMigrationReport => ({ state: "failed", converted: [], unchanged: [], unknownWildcards: [], revisions: [], failures })

/** A refusal said in plain words; anything else that is thrown is a fault and said with its own message. */
class Refusal extends Error {}

/**
 * Converts the gameplay code of the project in `projectDirectory` from Yarn's names to Mojang's, once (see the top of this file). Throws only `CANCELLED`;
 * everything else ends in the report.
 */
export async function migrateProjectNaming(projectDirectory: string, options: NamingMigrationOptions): Promise<NamingMigrationReport> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const root = await realpath(projectDirectory)
  const before = await openProject(root)
  if (!needsNamingMigration(before)) return { state: "not_needed", converted: [], unchanged: [], unknownWildcards: [], revisions: [], failures: [] }
  const gameplays = before.workspace.assets.flatMap((asset) => (asset.document.kind === "gameplay" ? [{ asset, document: asset.document }] : []))
  const work = path.join(options.runtimeDirectory, "naming-migration", `${before.id}-${randomUUID().slice(0, 8)}`)
  const gradle = options.gradle ?? runGradle
  try {
    await mkdir(work, { recursive: true })
    await checkGradleWrapper(options.templateDirectory).catch(() => {
      throw new Refusal("Studio 自带的构建工具文件校验没通过，没法转换。请重新安装 Studio 再构建。")
    })
    for (const name of ["gradle/wrapper/gradle-wrapper.jar", "gradle/wrapper/gradle-wrapper.properties"]) {
      await mkdir(path.dirname(path.join(work, name)), { recursive: true })
      await copyFile(path.join(options.templateDirectory, name), path.join(work, name))
    }
    for (const [name, text] of Object.entries(yarnBuildFiles())) await writeFile(path.join(work, name), text)
    const api = `src/main/java/${gameplayRoot(before.mod_id).replaceAll(".", "/")}/${GAMEPLAY_API.package}`
    for (const [name, text] of Object.entries(yarnGameplayApi(before.mod_id))) await put(work, `${api}/${name}`, text)
    const sources: Source[] = gameplays.flatMap(({ asset, document }) =>
      document.sources.map((source) => ({ asset_id: asset.id, title: asset.title, path: source.path, file: sourceFile(before.mod_id, document.slug, source.path), original: source.content })),
    )
    for (const source of sources) await put(work, source.file, source.original)

    // The game in Yarn's names is in Loom's cache once any Yarn project has been configured, which every older project's builds did. When it is not
    // (Gradle's folder was emptied), a first run of the same task puts it there; its output is thrown away.
    const jar = yarnGameJar(options.runtimeDirectory)
    if (!(await exists(jar))) {
      await migrate(work, gradle, options)
      await rm(path.join(work, "remappedSrc"), { recursive: true, force: true })
      if (!(await exists(jar))) throw new Refusal("Loom 准备好了，但它的缓存里没有按 Yarn 命名的游戏包，没法展开通配导入。请把这句话告诉开发者。")
    }
    const index = await jarClassIndex(jar).catch(() => {
      throw new Refusal("Loom 缓存里按 Yarn 命名的游戏包读不出来（可能下载坏了）。请在设置里清掉开发文件后重新构建。")
    })
    const unknownWildcards: NamingMigrationReport["unknownWildcards"] = []
    const expanded = new Map<Source, string>()
    for (const source of sources) {
      const result = expandGameWildcards(source.original, index)
      result.unknown.forEach((name) => unknownWildcards.push({ asset_id: source.asset_id, title: source.title, path: source.path, package: name }))
      expanded.set(source, result.content)
      await writeFile(path.join(work, source.file), result.content)
    }

    await migrate(work, gradle, options)
    const converted = new Map<Source, string>()
    for (const source of sources) {
      const text = await readFile(path.join(work, "remappedSrc", source.file.replace(/^src\/main\/java\//, "")), "utf8").catch(() => null)
      if (text === null) throw new Refusal(`Loom 没有交回「${source.title}」里 ${source.path} 的转换结果，为了不丢代码，这次一个文件都没有改。请把这句话告诉开发者。`)
      // Loom writes the line endings of the computer it runs on; a file is only changed where its words were.
      converted.set(source, source.original.includes("\r\n") ? text : text.replaceAll("\r\n", "\n"))
    }
    if (options.signal?.aborted) throw new Error("CANCELLED")

    const documents = new Map<string, GameplayDocument>()
    for (const { asset, document } of gameplays) {
      const mine = sources.filter((source) => source.asset_id === asset.id)
      if (mine.every((source) => converted.get(source) === source.original)) continue
      const next = GameplayDocumentSchema.safeParse({ ...document, sources: document.sources.map((file) => ({ ...file, content: converted.get(mine.find((source) => source.path === file.path)!)! })) })
      if (!next.success) throw new Refusal(`「${asset.title}」换成官方命名以后，代码超出了一个玩法能存的大小，为了不丢代码，这次一个文件都没有改。请让 AI 把这个玩法的代码精简一些，再重新构建。`)
      documents.set(asset.id, next.data)
    }

    const revisions = await withProjectLock(root, async () => {
      const current = await openProject(root)
      if (current.revision !== before.revision)
        throw new Refusal("转换的时候工程又被保存过，为了不盖掉新的改动，这次没有写回。重新构建会再转一次。")
      // The backups are written before anything is replaced: the project file as it was, and every gameplay's current revision as a saved version.
      await writeFile(await storagePath(root, [".minemods", "naming-migration-before.json"], true), await readProjectRecord(root))
      const at = new Date().toISOString()
      const revisions: NamingMigrationReport["revisions"] = []
      const assets: Project["workspace"]["assets"] = []
      // The converted version's own record, written before the save so the record every save keeps finds it there and leaves it saying that Studio
      // converted it, not that an AI or the person wrote it. Taken away again when the save does not happen.
      const written: string[][] = []
      try {
        for (const asset of current.workspace.assets) {
          const document = documents.get(asset.id)
          if (!document) {
            assets.push(asset)
            continue
          }
          const segments = assetVersionSegments(asset.id, asset.revision)
          if (!(await exists(await storagePath(root, segments, true))))
            await writeRecord(root, segments, { revision: asset.revision, at: asset.updated_at, by: asset.provenance.model === null ? "person" : "ai", title: asset.title, document: asset.document } satisfies KeptVersion)
          const converted = assetVersionSegments(asset.id, asset.revision + 1)
          await writeRecord(root, converted, { revision: asset.revision + 1, at, by: "converted", title: asset.title, document } satisfies KeptVersion)
          written.push(converted)
          revisions.push({ asset_id: asset.id, title: asset.title, from: asset.revision, to: asset.revision + 1 })
          assets.push({ ...asset, document, revision: asset.revision + 1, updated_at: at })
        }
        const next = ProjectSchema.parse({ ...current, workspace: { ...current.workspace, assets }, naming: "official" })
        await saveProjectUnlocked(root, next, current.revision)
      } catch (error) {
        await Promise.all(written.map(async (segments) => rm(await storagePath(root, segments), { force: true }).catch(() => undefined)))
        throw error
      }
      return revisions
    })
    const report: NamingMigrationReport = {
      state: "migrated",
      converted: sources.filter((source) => converted.get(source) !== source.original).map(file),
      unchanged: sources.filter((source) => converted.get(source) === source.original).map(file),
      unknownWildcards,
      revisions,
      failures: [],
    }
    // What the code check reads to tell the AI the code was converted; the conversion stands without it.
    await withProjectLock(root, async () => writeRecord(root, NAMING_RECORD, NamingRecordSchema.parse({ schema_version: 1, at: new Date().toISOString(), ...report }))).catch(() => undefined)
    return report
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.message === "CANCELLED")) throw new Error("CANCELLED")
    if (error instanceof Refusal) return failed([error.message])
    return failed([`转换时出了意外（${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}），工程没有改动。请把这句话告诉开发者。`])
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

const file = (source: Source): MigratedFile => ({ asset_id: source.asset_id, title: source.title, path: source.path })

async function put(work: string, name: string, text: string) {
  const target = path.join(work, name)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, text)
}

async function migrate(work: string, gradle: GradleRunner, options: NamingMigrationOptions) {
  const result = await gradle(work, MIGRATE_MAPPINGS_TASK, options)
  if (options.signal?.aborted) throw new Error("CANCELLED")
  if (result.code === 0) return
  throw new Refusal(
    result.network
      ? "转换命名要用的开发文件没下载下来（网络断了），玩法代码没有转换，工程没有改动。请检查网络或代理后重新构建。"
      : `Loom 转换命名时出错了，玩法代码没有转换，工程没有改动。Gradle 最后说的是：${lastLines(result.output)}`,
  )
}

/** The report as lines for the build's progress. */
export function namingReportLines(report: NamingMigrationReport): string[] {
  if (report.state === "failed") return report.failures.map((line) => `没能把玩法代码换成 Mojang 官方命名：${line}`)
  if (report.state === "not_needed") return []
  const titles = [...new Set(report.revisions.map((entry) => `「${entry.title}」`))]
  return [
    `玩法代码已经换成 Mojang 官方命名：改了 ${report.converted.length} 个文件，${report.unchanged.length} 个不用改。${titles.length ? `${titles.join("、")}各存成了新的一版，原来的那一版留在它的「制作过程」里。` : ""}`,
    ...(report.unknownWildcards.length
      ? [`有 ${report.unknownWildcards.length} 处通配导入的包在游戏里找不到，没法展开，原样留着：${report.unknownWildcards.slice(0, 8).map((entry) => `「${entry.title}」${entry.path} 的 ${entry.package}.*`).join("；")}。编译不过的话，让 AI 按官方命名改。`]
      : []),
  ]
}

/**
 * The step a build takes first: converts an older project's gameplay code when it still has to be (`needsNamingMigration`), saying so in the progress.
 * Null when nothing had to be done. A conversion that did not happen throws `NAMING_MIGRATION_FAILED`, after saying why: building Yarn-named code
 * against Mojang's names could only fail, and the next build tries again.
 */
export async function ensureOfficialNaming(projectDirectory: string, options: NamingMigrationOptions): Promise<NamingMigrationReport | null> {
  if (!needsNamingMigration(await openProject(projectDirectory))) return null
  options.onProgress?.(`${NAMING_MIGRATION_WORDS}\n`)
  const report = await migrateProjectNaming(projectDirectory, options)
  namingReportLines(report).forEach((line) => options.onProgress?.(`${line}\n`))
  // The error's `detail` is shown on its own, away from the progress: what Gradle printed and a fault's own message (either may name folders) stay in the progress.
  if (report.state === "failed")
    throw Object.assign(new Error(NAMING_MIGRATION_FAILED), { detail: report.failures.map((line) => line.replace(/Gradle 最后说的是：[\s\S]*$/, "Gradle 最后说的话在下方进度里。").replace(/^转换时出了意外（[\s\S]*?），/, "转换时出了意外（详情在下方进度里），")).join(" ") })
  return report.state === "migrated" ? report : null
}

import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import { GameplayDocumentSchema, gameplayPackage, type GameplayDocument } from "../src/gameplay"
import { staticChecks } from "../src/gameplay-check"
import { compileGameplayCandidate, forgetCompiled, type CodeCompiler } from "../src/gameplay-compile"
import {
  NAMING_MIGRATION_FAILED,
  NAMING_MIGRATION_WORDS,
  ensureOfficialNaming,
  migrateProjectNaming,
  needsNamingMigration,
  yarnGameJar,
  type GradleRunner,
} from "../src/naming-migration"
import { CONVERTED_HINT, convertedGameplay } from "../src/naming-migration/record"
import { yarnGameplayApi } from "../src/naming-migration/yarn-api"
import { assetVersionSegments, createProject, openProject, ProjectSchema, saveProject, storagePath, writeRecord } from "../src/project"
import { gradleWrapperArguments } from "../src/runtime"
import { WorkspaceAssetSchema } from "../src/workspace"

const TEMPLATE = path.resolve(import.meta.dir, "../../../templates/fabric-1.21")
const NOW = "2026-11-14T08:00:00.000Z"
const folders: string[] = []

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

async function temporary() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "改命名 测试-"))
  folders.push(folder)
  return folder
}

const document = (slug: string, main: string): GameplayDocument =>
  GameplayDocumentSchema.parse({
    kind: "gameplay",
    slug,
    name: slug,
    summary: "测试用的玩法。",
    behaviours: [{ when: "玩家进入世界", does: "什么都不做", shows: "没有变化" }],
    not_doing: [],
    uses: [],
    sources: [{ path: "Main.java", content: main }],
    data: [],
    lang: { zh_cn: {}, en_us: {} },
  })

const asset = (id: string, value: GameplayDocument) =>
  WorkspaceAssetSchema.parse({ id, module: "gameplay", title: `玩法${value.slug}`, revision: 1, created_at: NOW, updated_at: NOW, prompt: "测试", dependencies: [], document: value, provenance: { model: "ai", request_id: null }, status: "ready" })

const GUARD = "11111111-1111-4111-8111-111111111111"
const QUIET = "22222222-2222-4222-8222-222222222222"

/** An older project: two gameplays, no naming mark. One uses the game through a wildcard import; the other touches nothing of the game. */
async function olderProject() {
  const root = path.join(await temporary(), "齐天 大圣")
  const created = await createProject({ directory: root, name: "齐天", mod_id: "qitian" })
  const guard = document(
    "guard",
    [
      `package ${gameplayPackage("qitian", "guard")};`,
      "",
      `import ${gameplayPackage("qitian", "api")}.GameplayEntry;`,
      "import net.minecraft.util.math.*;",
      "import net.minecraft.made.up.*;",
      "",
      "public final class Main implements GameplayEntry {",
      "    @Override public void onInitialize() { Vec3d at = Vec3d.ZERO; }",
      "}",
      "",
    ].join("\n"),
  )
  const quiet = document("quiet", [`package ${gameplayPackage("qitian", "quiet")};`, "", "public final class Main implements com.minemods.content_qitian.gameplay.api.GameplayEntry {", "    @Override public void onInitialize() {}", "}", ""].join("\n"))
  const saved = await saveProject(root, { ...created, workspace: { assets: [asset(GUARD, guard), asset(QUIET, quiet)] } }, 0)
  // As an older Studio left it: no mark.
  const { naming: _naming, ...older } = saved
  await writeRecord(root, ["minemods.project.json"], older)
  return { root, project: ProjectSchema.parse(older) }
}

/** Loom as far as the conversion sees it: the Yarn game in its cache after a first run, and `remappedSrc` with Vec3d renamed. Line ends as Windows writes them. */
function fakeLoom(runtimeDirectory: string, behave: { code?: number; network?: boolean; skip?: string; during?: () => Promise<void> } = {}) {
  const calls: { directory: string; task: string; files: string[]; build: string }[] = []
  const gradle: GradleRunner = async (directory, task) => {
    const files = await list(path.join(directory, "src/main/java"))
    calls.push({ directory, task, files, build: await readFile(path.join(directory, "build.gradle"), "utf8") })
    await behave.during?.()
    const jar = yarnGameJar(runtimeDirectory)
    await mkdir(path.dirname(jar), { recursive: true })
    const empty = new Uint8Array(0)
    await writeFile(jar, zipSync({ "net/minecraft/util/math/Vec3d.class": empty, "net/minecraft/util/math/BlockPos.class": empty, "net/minecraft/entity/Entity.class": empty }))
    if (behave.code) return { code: behave.code, output: "FAILURE: Build failed with an exception.\n* What went wrong:\nMercury exploded", network: behave.network ?? false }
    for (const file of files) {
      if (behave.skip && file.endsWith(behave.skip)) continue
      const text = await readFile(path.join(directory, "src/main/java", file), "utf8")
      const out = path.join(directory, "remappedSrc", file)
      await mkdir(path.dirname(out), { recursive: true })
      await writeFile(out, text.replaceAll("net.minecraft.util.math.Vec3d", "net.minecraft.world.phys.Vec3").replace(/\bVec3d\b/g, "Vec3").replaceAll("\n", "\r\n"))
    }
    return { code: 0, output: "BUILD SUCCESSFUL", network: false }
  }
  return { gradle, calls }
}

async function list(folder: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? list(path.join(folder, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`])))).flat()
}

test("命名标记：可选、不给默认值；没有它的工程原样读回，新工程带着它；只认 official", async () => {
  const root = await temporary()
  const project = await createProject({ directory: root, name: "新工程" })
  expect(project.naming).toBe("official")
  const { naming: _naming, ...older } = project
  const parsed = ProjectSchema.parse(older)
  expect("naming" in parsed).toBe(false)
  expect(JSON.stringify(parsed)).toBe(JSON.stringify(older))
  expect(ProjectSchema.safeParse({ ...older, naming: "yarn" }).success).toBe(false)
})

test("没有玩法代码的老工程：普通保存原样写回，带来第一个玩法的那次保存标上官方命名；有玩法代码的老工程保存时不带，等转换；标记不会被旧副本抹掉", async () => {
  const bare = path.join(await temporary(), "空工程")
  const created = await createProject({ directory: bare, name: "空工程" })
  const { naming: _naming, ...older } = created
  await writeRecord(bare, ["minemods.project.json"], older)
  expect(needsNamingMigration(await openProject(bare))).toBe(false)
  const plain = await saveProject(bare, { ...ProjectSchema.parse(older), name: "空工程二" }, 0)
  expect("naming" in plain).toBe(false)
  // The save that brings the first gameplay: code written now is in the official names.
  const first = await saveProject(bare, { ...plain, workspace: { assets: [asset(GUARD, document("guard", "class Main {}"))] } }, 1)
  expect(first.naming).toBe("official")
  // A copy read before the mark was set does not take it away.
  expect((await saveProject(bare, { ...plain, revision: 2 }, 2)).naming).toBe("official")

  const { root, project } = await olderProject()
  expect(needsNamingMigration(project)).toBe(true)
  const saved = await saveProject(root, { ...project, name: "齐天改名" }, project.revision)
  expect(saved.naming).toBeUndefined()
  expect(needsNamingMigration(saved)).toBe(true)
})

test("冻结的 Yarn 支撑代码按工程改包名，不带别的工程的东西", () => {
  const files = yarnGameplayApi("da_sheng")
  expect(Object.keys(files).sort()).toEqual(["AbilityAction.java", "GameplayClientEntry.java", "GameplayEntry.java", "ProjectContent.java"])
  for (const text of Object.values(files)) {
    expect(text.split("\n")[0]).toBe("package com.minemods.content_da_sheng.gameplay.api;")
    expect(text).not.toContain("azure_sample")
    expect(text).not.toContain("StudioEffects")
  }
  const content = files["ProjectContent.java"]!
  expect(content).toContain('public static final String MOD_ID = "da_sheng";')
  // What Loom has to see to rename calls on what these return: Yarn names, the nested interfaces, every method gameplay calls.
  for (const name of ["import net.minecraft.entity.mob.MobEntity;", "public interface StudioActor", "public interface StudioFlier", "public static EntityType<?> entity(String id)", "public static void playMotion(MobEntity creature, String motion)", "public static Entity spawnEffect(", "public static void abilityAction(String name, AbilityAction action)"])
    expect(content).toContain(name)
  expect(files["AbilityAction.java"]).toContain("void run(MobEntity creature, LivingEntity target);")
})

test("Loom 的转换任务：任务选项跟在任务后面，转到 Mojang 官方命名", () => {
  expect(gradleWrapperArguments("migrateMappings").slice(-3)).toEqual(["migrateMappings", "--mappings", "net.minecraft:mappings:1.21.1"])
  expect(gradleWrapperArguments("build").at(-1)).toBe("build")
})

test("转换：通配导入先展开，Loom 改名，改了的玩法存成新的一版、旧版留着，没改的不动，工程标成官方命名", async () => {
  const { root, project } = await olderProject()
  const runtimeDirectory = path.join(await temporary(), "运行 环境")
  const loom = fakeLoom(runtimeDirectory)
  const before = await readFile(await storagePath(root, ["minemods.project.json"]), "utf8")
  const said: string[] = []
  const report = await ensureOfficialNaming(root, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: loom.gradle, onProgress: (text) => said.push(text) })
  // The game was not in Loom's cache yet: a first run put it there, then the real one ran.
  expect(loom.calls.map((call) => call.task)).toEqual(["migrateMappings", "migrateMappings"])
  for (const call of loom.calls) {
    expect(call.directory.startsWith(path.join(runtimeDirectory, "naming-migration"))).toBe(true)
    expect(call.build).toContain('mappings "net.fabricmc:yarn:1.21.1+build.3:v2"')
    // The frozen support code sits beside the gameplay code, in this project's package.
    expect(call.files).toContain("com/minemods/content_qitian/gameplay/api/ProjectContent.java")
    expect(call.files).toContain("com/minemods/content_qitian/gameplay/guard/Main.java")
  }
  expect(report).toMatchObject({
    state: "migrated",
    converted: [{ asset_id: GUARD, path: "Main.java" }],
    unchanged: [{ asset_id: QUIET, path: "Main.java" }],
    unknownWildcards: [{ asset_id: GUARD, path: "Main.java", package: "net.minecraft.made.up" }],
    revisions: [{ asset_id: GUARD, from: 1, to: 2 }],
    failures: [],
  })
  expect(said[0]).toBe(`${NAMING_MIGRATION_WORDS}\n`)
  expect(said.join("")).toContain("改了 1 个文件，1 个不用改")
  expect(said.join("")).toContain("net.minecraft.made.up.*")

  const after = await openProject(root)
  expect(after.naming).toBe("official")
  expect(after.revision).toBe(project.revision + 1)
  const guard = after.workspace.assets.find((value) => value.id === GUARD)!
  const quiet = after.workspace.assets.find((value) => value.id === QUIET)!
  expect(guard.revision).toBe(2)
  expect(quiet).toEqual(project.workspace.assets.find((value) => value.id === QUIET)!)
  const code = guard.document.kind === "gameplay" ? guard.document.sources[0]!.content : ""
  expect(code).toContain("import net.minecraft.world.phys.Vec3;\nimport net.minecraft.made.up.*;")
  expect(code).toContain("Vec3 at = Vec3.ZERO;")
  expect(code).not.toContain("\r\n")
  expect(code).not.toContain("net.minecraft.util.math.*")
  // The version before is kept, as the AI wrote it, and so is the whole project file.
  const kept = JSON.parse(await readFile(await storagePath(root, assetVersionSegments(GUARD, 1)), "utf8"))
  expect(kept.document).toEqual(project.workspace.assets.find((value) => value.id === GUARD)!.document)
  expect(kept.by).not.toBe("converted")
  // The converted version says Studio converted it: not the AI's work, not the person's.
  const marked = JSON.parse(await readFile(await storagePath(root, assetVersionSegments(GUARD, 2)), "utf8"))
  expect(marked).toMatchObject({ revision: 2, by: "converted", title: guard.title })
  expect(marked.document).toEqual(guard.document)
  expect(await list(path.dirname(await storagePath(root, assetVersionSegments(QUIET, 1))))).not.toContain("2.json")
  expect(await readFile(await storagePath(root, [".minemods", "naming-migration-before.json"]), "utf8")).toBe(before)
  // The code check knows which gameplay a machine renamed.
  expect([...(await convertedGameplay(root))]).toEqual([GUARD])
  expect(CONVERTED_HINT).toContain("自动换成了 Mojang 官方命名")
  // Nothing is left in the runtime folder, and a second build does nothing.
  expect(await list(path.join(runtimeDirectory, "naming-migration"))).toEqual([])
  expect(await ensureOfficialNaming(root, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: loom.gradle })).toBeNull()
  expect(loom.calls).toHaveLength(2)
})

test("Loom 失败、少交一个文件、网络断了、转换时工程被改：工程一个字不动，说清楚为什么", async () => {
  const cases: { name: string; behave: Parameters<typeof fakeLoom>[1]; says: string }[] = [
    { name: "失败", behave: { code: 1 }, says: "Loom 转换命名时出错了，玩法代码没有转换，工程没有改动。Gradle 最后说的是：FAILURE" },
    { name: "网络", behave: { code: 1, network: true }, says: "网络断了" },
    { name: "少文件", behave: { skip: "guard/Main.java" }, says: "Loom 没有交回「玩法guard」里 Main.java 的转换结果" },
  ]
  for (const each of cases) {
    const { root } = await olderProject()
    const runtimeDirectory = path.join(await temporary(), "运行")
    const before = await readFile(await storagePath(root, ["minemods.project.json"]), "utf8")
    const report = await migrateProjectNaming(root, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: fakeLoom(runtimeDirectory, each.behave).gradle })
    expect(report.state).toBe("failed")
    expect(report.failures[0]).toContain(each.says)
    expect(await readFile(await storagePath(root, ["minemods.project.json"]), "utf8")).toBe(before)
    expect(await convertedGameplay(root)).toEqual(new Set())
  }
  // Before a build: said in the progress in full, thrown with a detail that leaves Gradle's own words to the progress.
  {
    const { root } = await olderProject()
    const runtimeDirectory = path.join(await temporary(), "运行")
    const said: string[] = []
    const error = (await ensureOfficialNaming(root, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: fakeLoom(runtimeDirectory, { code: 1 }).gradle, onProgress: (text) => said.push(text) }).catch((value: unknown) => value)) as Error & { detail: string }
    expect(error.message).toBe(NAMING_MIGRATION_FAILED)
    expect(said.join("")).toContain("Mercury exploded")
    expect(error.detail).toContain("Gradle 最后说的话在下方进度里。")
    expect(error.detail).not.toContain("Mercury")
  }

  const { root, project } = await olderProject()
  const runtimeDirectory = path.join(await temporary(), "运行")
  const loom = fakeLoom(runtimeDirectory, { during: async () => void (await saveProject(root, { ...(await openProject(root)), name: "转换时改了名" }, (await openProject(root)).revision)) })
  const said: string[] = []
  const error = await ensureOfficialNaming(root, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: loom.gradle, onProgress: (text) => said.push(text) }).catch((value: unknown) => value)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toBe(NAMING_MIGRATION_FAILED)
  expect(said.join("")).toContain("转换的时候工程又被保存过")
  const after = await openProject(root)
  // Only the person's change is there: no conversion written over it, no mark.
  expect(after.name).toBe("转换时改了名")
  expect(after.naming).toBeUndefined()
  expect(after.workspace.assets).toEqual(project.workspace.assets)
  // Nor a converted version of the gameplay left behind in its history.
  expect(await list(path.dirname(await storagePath(root, assetVersionSegments(GUARD, 1))))).toEqual(["1.json"])
})

test("已经是官方命名的工程、没有玩法代码的工程：不转换，也不跑 Gradle", async () => {
  const runtimeDirectory = await temporary()
  const loom = fakeLoom(runtimeDirectory)
  const fresh = path.join(await temporary(), "新")
  await createProject({ directory: fresh, name: "新" })
  expect((await migrateProjectNaming(fresh, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: loom.gradle })).state).toBe("not_needed")
  expect(await ensureOfficialNaming(fresh, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: loom.gradle })).toBeNull()
  expect(loom.calls).toEqual([])
})

test("代码检查报自动转换过的玩法的编译错误时，告诉 AI 这是机器换的命名；没转换过的玩法照旧", async () => {
  const { root } = await olderProject()
  const runtimeDirectory = path.join(await temporary(), "运行")
  await ensureOfficialNaming(root, { runtimeDirectory, templateDirectory: TEMPLATE, gradle: fakeLoom(runtimeDirectory).gradle })
  const opened = await openProject(root)
  // What the conversion could not spell out (a wildcard of a package the game does not have) is left for the code check, which refuses it before any compile.
  const leftover = opened.workspace.assets.find((value) => value.id === GUARD)!.document as GameplayDocument
  expect(staticChecks(opened, leftover, GUARD).bounds.map((finding) => finding.rule)).toEqual(["wildcard_import"])
  // The AI took that line out and saved the gameplay; the compiler then finds a name the conversion missed.
  const tidy = (value: GameplayDocument) => ({ ...value, sources: value.sources.map((file) => ({ ...file, content: file.content.replace(/import net\.minecraft\.made\.up\.\*;\r?\n/, "") })) })
  const project = await saveProject(root, { ...opened, workspace: { assets: opened.workspace.assets.map((value) => (value.id === GUARD ? { ...value, document: tidy(value.document as GameplayDocument) } : value)) } }, opened.revision)
  expect(staticChecks(project, project.workspace.assets.find((value) => value.id === GUARD)!.document as GameplayDocument, GUARD).bounds).toEqual([])
  // A compiler that finds a name the conversion missed in whichever gameplay it is handed.
  const compiler = (slug: string): CodeCompiler => ({
    name: `fake-${slug}`,
    run: async (directory) => ({ code: 1, output: `${directory}/src/main/java/com/minemods/content_qitian/gameplay/${slug}/Main.java:8: error: cannot find symbol\n  symbol:   method getWorld()\n1 error\n` }),
  })
  const check = async (id: string, slug: string) => {
    forgetCompiled()
    const asset = project.workspace.assets.find((value) => value.id === id)!
    const run = await compileGameplayCandidate(root, { templateDirectory: TEMPLATE, candidate: { asset_id: id, title: asset.title, document: asset.document as GameplayDocument }, compiler: compiler(slug) })
    if (!run.ran) throw new Error(run.reason)
    return run.compile.findings
  }
  const converted = await check(GUARD, "guard")
  expect(converted).toHaveLength(1)
  expect(converted[0]!.fix).toContain(CONVERTED_HINT)
  const untouched = await check(QUIET, "quiet")
  expect(untouched).toHaveLength(1)
  expect(untouched[0]!.fix).not.toContain(CONVERTED_HINT)
})

test("能识别是自动转换过的玩法：记录读不出来就当没转换过", async () => {
  const root = await temporary()
  await createProject({ directory: root, name: "记录" })
  expect(await convertedGameplay(root)).toEqual(new Set())
  await mkdir(path.join(root, ".minemods"), { recursive: true })
  await writeFile(path.join(root, ".minemods", "naming-migration.json"), "{not json")
  expect(await convertedGameplay(root)).toEqual(new Set())
})

/**
 * The real thing, opt-in (MINEMODS_REAL_MIGRATE=1): the Yarn gameplay code of 齐天 (the AI's own files: every gameplay, not the support code) as an older
 * project, converted by Loom through Studio's own Gradle and runtime folder (MINEMODS_REAL_RUNTIME, else Studio's), then compiled with javac against
 * Fabric in Mojang's names together with 齐天's support code in Mojang's names (`target-javac.ts`'s environment). Errors are counted in the AI's files only.
 */
const REAL_FIXTURE = process.env.MINEMODS_REAL_MIGRATE_FIXTURE ?? ""
test.skipIf(!process.env.MINEMODS_REAL_MIGRATE)("真转换：齐天的 Yarn 玩法代码经 Loom 换成官方命名，再按官方命名编译", async () => {
  const { hasTargetJavac, targetJavac } = await import("./target-javac")
  const modId = "mod_11ssz0y"
  const gameplayFolder = (base: string) => path.join(base, "com/minemods", `content_${modId}`, "gameplay")
  const yarn = gameplayFolder(path.join(REAL_FIXTURE, "src/main/java-yarn"))
  const slugs = (await readdir(yarn, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== "api").map((entry) => entry.name).sort()
  const root = path.join(await temporary(), "齐天 转换")
  const created = await createProject({ directory: root, name: "齐天", mod_id: modId })
  const assets = await Promise.all(
    slugs.map(async (slug, index) => {
      const files = await list(path.join(yarn, slug))
      const sources = await Promise.all(files.map(async (file) => ({ path: file, content: await readFile(path.join(yarn, slug, file), "utf8") })))
      return asset(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, GameplayDocumentSchema.parse({ ...document(slug, "class Main {}"), sources }))
    }),
  )
  const saved = await saveProject(root, { ...created, workspace: { assets } }, 0)
  const { naming: _naming, ...older } = saved
  await writeRecord(root, ["minemods.project.json"], older)

  const runtimeDirectory = process.env.MINEMODS_REAL_RUNTIME ?? path.join(process.env.APPDATA ?? os.homedir(), "MineMods Studio", "runtime")
  const said: string[] = []
  const began = Date.now()
  const javaHome = process.env.MINEMODS_REAL_RUNTIME ? process.env.MINEMODS_JDK21 : undefined
  const report = await ensureOfficialNaming(root, { runtimeDirectory, templateDirectory: TEMPLATE, ...(javaHome ? { javaHome } : {}), onProgress: (text) => said.push(text) }).catch((error: unknown) => {
    console.log(said.join("").slice(-4000))
    throw error
  })
  const seconds = Math.round((Date.now() - began) / 1000)
  expect(report?.state).toBe("migrated")
  const project = await openProject(root)
  expect(project.naming).toBe("official")

  // The converted code and 齐天's own support code in Mojang's names, compiled together.
  const work = await temporary()
  const official = path.join(REAL_FIXTURE, "src/main/java")
  for (const file of await list(official)) {
    if (/^com\/minemods\/content_mod_11ssz0y\/gameplay\/(?!api\/)/.test(file)) continue
    await mkdir(path.dirname(path.join(work, file)), { recursive: true })
    await writeFile(path.join(work, file), await readFile(path.join(official, file)))
  }
  for (const value of project.workspace.assets)
    if (value.document.kind === "gameplay")
      for (const source of value.document.sources) {
        const target = path.join(gameplayFolder(work), value.document.slug, source.path)
        await mkdir(path.dirname(target), { recursive: true })
        await writeFile(target, source.content)
      }
  const compiled = hasTargetJavac("fabric-1.21.1-official") ? await targetJavac("fabric-1.21.1-official", work) : null
  const errors = (compiled?.output ?? "").replaceAll("\\", "/").split(/\r?\n/).filter((line) => /\.java:\d+: error:/.test(line))
  const own = errors.filter((line) => /\/gameplay\/(?!api\/)[a-z_]+\//.test(line))
  console.log(
    [
      `真转换：${slugs.length} 个玩法，${report!.converted.length + report!.unchanged.length} 个文件，用了 ${seconds} 秒`,
      `改了 ${report!.converted.length} 个，没改 ${report!.unchanged.length} 个，找不到的通配包 ${report!.unknownWildcards.length} 处`,
      compiled ? `官方命名编译：AI 文件里 ${own.length} 处错误（全部 ${errors.length} 处）` : "没有设好 MINEMODS_TARGET_CLASSPATH / MINEMODS_JDK21，没编译",
      ...own.slice(0, 20),
      ...said.filter((line) => /Yarn|官方命名/.test(line)),
    ].join("\n"),
  )
  // First run, 2026-11-14: 9 gameplays, 21 files (18 changed), 76 s, no error left in the AI's files.
  if (compiled) expect(own).toEqual([])
}, 900_000)


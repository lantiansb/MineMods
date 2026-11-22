import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseToml } from "smol-toml"
import { BUILD_STAGES } from "../src/build-stages"
import { resolveProfile } from "../src/fabric/profile"
import { fabricPlaceholders, scaffoldProject } from "../src/fabric/scaffold"
import { listTargetManifests, targetManifest } from "../src/target/manifests"
import { MDG_STAGES, geckolibRange, loaderRange, minecraftRange, tomlString } from "../src/toolchain/mdg"
import { templateDirectoryOf, toolchainFor } from "../src/toolchain/toolchain"

const templatesRoot = fileURLToPath(new URL("../../../templates", import.meta.url))
const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

const temporary = async (name: string) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), name))
  roots.push(directory)
  return directory
}

async function listFiles(directory: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? listFiles(directory, path.join(relative, entry.name)) : [path.join(relative, entry.name)])))).flat().sort()
}

const jdk17 = path.resolve("/jdks/temurin-17")
const jdk21 = path.resolve("/jdks/temurin-21")
const homes = new Map([
  [17, jdk17],
  [21, jdk21],
])

// The command line `runGradle` built before the toolchains existed, written out: Loom's must stay exactly this.
const fabricCommand = (task: string) => [
  "--no-daemon",
  "--console=plain",
  "--max-workers=2",
  "-Dorg.gradle.internal.http.connectionTimeout=60000",
  "-Dorg.gradle.internal.http.socketTimeout=60000",
  "-Dorg.gradle.internal.repository.max.retries=5",
  "-Dorg.gradle.internal.repository.max.tentatives=5",
  "-Dorg.gradle.internal.repository.initial.backoff=1000",
  ...(task === "compileJava" ? ["--init-script", "minemods-capture.init.gradle"] : []),
  task,
]

test("every target manifest has a toolchain, with its template, JDKs, tasks and mod file", () => {
  const summary = listTargetManifests().map((manifest) => {
    const toolchain = toolchainFor(manifest)
    return [manifest.id, toolchain.kind, toolchain.template, toolchain.javaMajors, toolchain.tasks, toolchain.modFile, toolchain.gameCache, toolchain.chinesePaths.runs]
  })
  expect(summary).toEqual([
    ["fabric-1.21.1", "loom", "fabric-1.21", [21], ["build", "compileJava", "runClient"], "fabric.mod.json", "fabric-loom", "classpath-bootstrap"],
    ["forge-1.20.1", "mdg-legacyforge", "forge-1.20.1", [17, 21], ["build", "compileJava", "runClient", "runServer"], "META-INF/mods.toml", "neoformruntime", "as-is"],
    ["neoforge-1.21.1", "mdg", "neoforge-1.21.1", [21], ["build", "compileJava", "runClient", "runServer"], "META-INF/neoforge.mods.toml", "neoformruntime", "as-is"],
  ])
  expect(toolchainFor("forge-1.20.1").target.id).toBe("forge-1.20.1")
  expect(() => toolchainFor("fabric-1.20.1")).toThrow("UNKNOWN_TARGET")
  expect(templateDirectoryOf(toolchainFor("neoforge-1.21.1"), templatesRoot)).toBe(path.join(templatesRoot, "neoforge-1.21.1"))
})

test("Loom's Gradle command is the one runGradle always ran, and it needs only Java 21", () => {
  const loom = toolchainFor("fabric-1.21.1")
  for (const task of ["build", "compileJava", "runClient"] as const) expect(loom.gradle(task, homes)).toEqual({ javaHome: jdk21, args: fabricCommand(task), env: {} })
  expect(() => loom.gradle("runServer", homes)).toThrow("UNSUPPORTED_GRADLE_TASK")
  expect(() => loom.gradle("build", new Map([[17, jdk17]]))).toThrow("JAVA_21_REQUIRED")
  expect(loom.stages).toBe(BUILD_STAGES)
})

test("ModDevGradle hands Gradle every JDK of the manifest through the environment, never on the command line", () => {
  const forge = toolchainFor("forge-1.20.1").gradle("build", homes)
  expect(forge.javaHome).toBe(jdk17)
  expect(forge.env).toEqual({ MINEMODS_JDK_17: jdk17, MINEMODS_JDK_21: jdk21 })
  expect(forge.args).toEqual([
    ...fabricCommand("build").slice(0, -1),
    "-Porg.gradle.java.installations.fromEnv=MINEMODS_JDK_17,MINEMODS_JDK_21",
    "-Porg.gradle.java.installations.auto-detect=false",
    "-Porg.gradle.java.installations.auto-download=false",
    "build",
  ])
  expect(forge.args.some((arg) => arg.includes(jdk17) || arg.includes(jdk21))).toBe(false)
  expect(() => toolchainFor("forge-1.20.1").gradle("build", new Map([[17, jdk17]]))).toThrow("JAVA_21_REQUIRED")
  expect(() => toolchainFor("forge-1.20.1").gradle("build", new Map([[17, "relative/jdk"], [21, jdk21]]))).toThrow("JAVA_17_REQUIRED")

  const neoforge = toolchainFor("neoforge-1.21.1")
  const check = neoforge.gradle("compileJava", new Map([[21, jdk21]]))
  expect(check.env).toEqual({ MINEMODS_JDK_21: jdk21 })
  expect(check.args.slice(-6)).toEqual([
    "-Porg.gradle.java.installations.fromEnv=MINEMODS_JDK_21",
    "-Porg.gradle.java.installations.auto-detect=false",
    "-Porg.gradle.java.installations.auto-download=false",
    "--init-script",
    "minemods-capture.init.gradle",
    "compileJava",
  ])
  expect(neoforge.gradle("runServer", new Map([[21, jdk21]])).args.at(-1)).toBe("runServer")
})

test("each toolchain says where the jar lands", () => {
  const project = path.resolve("/projects/中文 mod")
  for (const id of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"])
    expect(toolchainFor(id).jarPath(project, { modId: "chiyou", version: "1.2.3" })).toBe(path.join(project, "build", "libs", "chiyou-1.2.3.jar"))
  expect(toolchainFor("forge-1.20.1").jarPath(project, { modId: "chiyou" })).toBe(path.join(project, "build", "libs", "chiyou-0.1.0.jar"))
})

test("ModDevGradle's log is read as stages, from the first build's game preparation to the jar", () => {
  const forge = toolchainFor("forge-1.20.1")
  const log = [
    "> Task :createMinecraftArtifacts",
    "*** Started working on downloadJson",
    "*** Started working on downloadClient",
    "*** Started working on mergeMappings",
    "*** Started working on decompile",
    "*** Started working on applyNeoforgePatches",
    "*** Started working on recompile",
    "> Task :compileJava",
    "> Task :processResources",
    "> Task :jar",
    "> Task :reobfJar",
    "BUILD SUCCESSFUL in 3m 39s",
  ]
  const said = log.map((_, index) => forge.stageWords(log.slice(0, index + 1).join("\n")))
  expect(said).toEqual([
    "正在准备游戏的开发文件（第一次要几分钟）。",
    "正在下载游戏本体和映射表。",
    "正在下载游戏本体和映射表。",
    "正在整理游戏文件。",
    "正在反编译游戏（第一次最慢的一步）。",
    "正在给游戏代码打上加载器的补丁。",
    "正在重新编译游戏代码。",
    "正在编译模组的代码。",
    "正在装进贴图、模型和声音。",
    "正在装成一个模组文件。",
    "正在把模组文件换成游戏运行时用的名字。",
    "编译完成，正在检查做出来的文件。",
  ])
  expect(forge.stageWords("Welcome to Gradle 8.14.3!")).toBeNull()
  expect(toolchainFor("fabric-1.21.1").stageWords("> Task :remapJar\n")).toBe("正在装成一个模组文件。")
  expect(MDG_STAGES.length).toBeGreaterThan(BUILD_STAGES.length)
})

test("TOML strings, version ranges and the GeckoLib range follow the manifest", () => {
  expect(tomlString('a "b" \\ c\nd\te\u0001\u007f')).toBe('a \\"b\\" \\\\ c\\nd\\te\\u0001\\u007F')
  expect(parseToml(`x = "${tomlString('中文 "Mod"\n\\end\u0000')}"`).x).toBe('中文 "Mod"\n\\end\u0000')
  expect(minecraftRange("1.20.1")).toBe("[1.20.1,1.20.2)")
  expect(minecraftRange("1.21")).toBe("[1.21,1.21.1)")
  expect(loaderRange(targetManifest("forge-1.20.1"))).toBe("[47,)")
  expect(loaderRange(targetManifest("neoforge-1.21.1"))).toBe("[21.1,)")
  expect(geckolibRange("4.8.4")).toBe("[4.8.4,5)")
})

test("Loom's scaffold is Fabric's own, file for file", async () => {
  const root = await temporary("studio-toolchain-loom-")
  const input = { templateDirectory: path.join(templatesRoot, "fabric-1.21"), modId: "same_mod", name: '中文 "Mod"', packageName: "studio.same", description: "a\nb", version: "1.0.0" }
  const loom = toolchainFor("fabric-1.21.1")
  const viaToolchain = await loom.scaffold({ ...input, directory: path.join(root, "toolchain") })
  const direct = await scaffoldProject({ ...input, directory: path.join(root, "direct") })
  const files = await listFiles(viaToolchain.directory)
  expect(files).toEqual(await listFiles(direct.directory))
  for (const file of files) expect((await readFile(path.join(viaToolchain.directory, file))).equals(await readFile(path.join(direct.directory, file)))).toBe(true)
  expect(loom.placeholders(input)).toEqual(fabricPlaceholders(input, resolveProfile("fabric-1.21.1")))
})

for (const id of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${id}: the template is filled from the manifest into a folder with Chinese characters and a space`, async () => {
    const toolchain = toolchainFor(id)
    const manifest = toolchain.target
    const directory = path.join(await temporary("studio-toolchain-mdg-"), "中文 模组")
    const name = '中文 "Mod"'
    const description = "line one\nline two\\end"
    const result = await toolchain.scaffold({
      templateDirectory: templateDirectoryOf(toolchain, templatesRoot),
      directory,
      modId: "chiyou",
      name,
      packageName: "studio.spike.chiyou",
      description,
      author: 'Builder "B"',
      version: "1.2.3",
    })
    expect(result.directory).toBe(directory)
    const read = (file: string) => readFile(path.join(directory, file), "utf8")

    // Nothing was left unfilled.
    for (const file of await listFiles(directory)) if (!file.endsWith(".jar")) expect(await read(file)).not.toContain("{{")
    expect(await listFiles(directory)).toContain(path.join("src", "main", "java", "studio", "spike", "chiyou", "ChiyouMod.java"))
    expect(await read("src/main/java/studio/spike/chiyou/ChiyouMod.java")).toContain('public static final String MOD_ID = "chiyou";')

    // The wrapper is Studio's pinned one, and it fetches the manifest's Gradle and checks it.
    const wrapper = await readFile(path.join(directory, "gradle/wrapper/gradle-wrapper.jar"))
    expect(createHash("sha256").update(wrapper).digest("hex")).toBe(resolveProfile("fabric-1.21.1").gradle.wrapper.sha256)
    for (const script of ["gradlew", "gradlew.bat"])
      expect((await readFile(path.join(directory, script))).equals(await readFile(path.join(templatesRoot, "fabric-1.21", script)))).toBe(true)
    const wrapperProperties = await read("gradle/wrapper/gradle-wrapper.properties")
    expect(wrapperProperties).toContain(`distributionUrl=https\\://services.gradle.org/distributions/gradle-${manifest.toolchain.gradle.version}-bin.zip\n`)
    expect(wrapperProperties).toContain(`distributionSha256Sum=${manifest.toolchain.gradle.distribution.sha256}\n`)

    const properties = await read("gradle.properties")
    for (const line of [
      "mod_id=chiyou",
      "mod_version=1.2.3",
      "maven_group=studio.spike.chiyou",
      `minecraft_version=${manifest.minecraft.version}`,
      `${id === "forge-1.20.1" ? "forge_version" : "neo_version"}=${manifest.loader.version}`,
      `parchment_minecraft_version=${manifest.mappings.kind === "official" ? manifest.mappings.parchment?.minecraft : ""}`,
      `parchment_mappings_version=${manifest.mappings.kind === "official" ? manifest.mappings.parchment?.version : ""}`,
      `java_version=${manifest.java.major}`,
      `geckolib_coordinate=${manifest.dependencies.geckolib.coordinate}`,
    ])
      expect(properties).toContain(`${line}\n`)
    const buildScript = await read("build.gradle")
    expect(buildScript).toContain(`version '${manifest.toolchain.plugin}'`)
    expect(await read("settings.gradle")).toContain("rootProject.name = 'chiyou'")

    const modFile = parseToml(await read(`src/main/resources/${toolchain.modFile}`)) as {
      loaderVersion: string
      mods: { modId: string; version: string; displayName: string; description: string; authors: string }[]
      mixins?: { config: string }[]
      dependencies: Record<string, { modId: string; versionRange: string }[]>
    }
    expect(modFile.mods[0]).toMatchObject({ modId: "chiyou", version: "${version}", displayName: name, description, authors: 'Builder "B"' })
    const ranges = Object.fromEntries(modFile.dependencies.chiyou!.map((dependency) => [dependency.modId, dependency.versionRange]))
    const mixins = JSON.parse(await read("src/main/resources/chiyou.mixins.json"))
    const pack = JSON.parse(await read("src/main/resources/pack.mcmeta"))
    expect(pack.pack).toEqual({ description: name, pack_format: manifest.data.packFormat.resource })
    expect(JSON.parse(await read("src/main/resources/assets/chiyou/lang/en_us.json"))).toEqual({ "chiyou.description": description })
    if (id === "forge-1.20.1") {
      expect(modFile.loaderVersion).toBe("[47,)")
      expect(ranges).toEqual({ forge: "[47,)", minecraft: "[1.20.1,1.20.2)", geckolib: "[4.8.4,5)" })
      expect(modFile.mixins).toBeUndefined()
      expect(mixins).toMatchObject({ package: "studio.spike.chiyou.mixin", compatibilityLevel: "JAVA_17", refmap: "chiyou.refmap.json" })
      expect(buildScript).toContain("id 'net.neoforged.moddev.legacyforge'")
      expect(buildScript).toContain('add sourceSets.main, "${project.mod_id}.refmap.json"')
      expect(buildScript).toContain("annotationProcessor 'org.spongepowered:mixin:0.8.5:processor'")
      expect(pack.pack.pack_format).toBe(15)
    } else {
      expect(modFile.loaderVersion).toBe("[4,)")
      expect(ranges).toEqual({ neoforge: "[21.1,)", minecraft: "[1.21.1,1.21.2)", geckolib: "[4.9.3,5)" })
      expect(modFile.mixins).toEqual([{ config: "chiyou.mixins.json" }])
      expect(mixins).toMatchObject({ package: "studio.spike.chiyou.mixin", compatibilityLevel: "JAVA_21" })
      expect(mixins.refmap).toBeUndefined()
      expect(buildScript).toContain("id 'net.neoforged.moddev'")
      expect(buildScript).not.toContain("refmap")
    }
  })
}

test("a ModDevGradle scaffold refuses what Fabric's refuses, and a template whose wrapper is not the pinned one", async () => {
  const toolchain = toolchainFor("neoforge-1.21.1")
  const root = await temporary("studio-toolchain-refuse-")
  const templateDirectory = templateDirectoryOf(toolchain, templatesRoot)
  await expect(toolchain.scaffold({ templateDirectory, directory: path.join(root, "a"), modId: "../bad", name: "Bad", packageName: "studio.bad" })).rejects.toThrow("mod ID")
  await expect(toolchain.scaffold({ templateDirectory, directory: path.join(root, "a"), modId: "valid", name: "Bad", packageName: "studio.class" })).rejects.toThrow("package")
  await expect(toolchain.scaffold({ templateDirectory: "templates/neoforge-1.21.1", directory: path.join(root, "a"), modId: "valid", name: "Ok", packageName: "studio.ok" })).rejects.toThrow("absolute")
  await toolchain.scaffold({ templateDirectory, directory: path.join(root, "a"), modId: "valid", name: "Ok", packageName: "studio.ok" })
  await expect(toolchain.scaffold({ templateDirectory, directory: path.join(root, "a"), modId: "again", name: "Again", packageName: "studio.again" })).rejects.toThrow("not empty")
  // The Fabric template's placeholders are not a NeoForge toolchain's: filling it fails instead of leaving `{{…}}` in a file.
  await expect(toolchain.scaffold({ templateDirectory: path.join(templatesRoot, "fabric-1.21"), directory: path.join(root, "b"), modId: "valid", name: "Ok", packageName: "studio.ok" })).rejects.toThrow("Unknown template placeholder")
})

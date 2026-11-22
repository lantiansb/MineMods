import { existsSync } from "node:fs"
import { readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { RUNTIME_WAIT_WORDS, buildStageWords } from "../build-stages"
import { checkGradleWrapper, checkScaffoldInput, copyTemplate, modPlaceholders } from "../fabric/scaffold"
import { RELEASE_DEFAULTS, licenseNotice } from "../release"
import { gradleWrapperArguments } from "../runtime"
import type { TargetManifest } from "../target/manifest"
import { builtJarPath, requireJavaHomes } from "./common"
import type { ProgressStage, Toolchain } from "./toolchain"

/**
 * ModDevGradle: `net.neoforged.moddev` for NeoForge, and its `legacyforge` plugin for Forge 1.20.1 (no ForgeGradle).
 * Checked in the real game on 2026-11-14 (第0阶段-技术验证结论.md): both built, installed and started from folders with
 * Chinese names and spaces.
 */

/** A value inside a TOML basic string ("…"): quotes, backslashes and control characters escaped, as TOML 1.0 asks. */
export function tomlString(value: string) {
  const named: Record<string, string> = { "\\": "\\\\", '"': '\\"', "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r" }
  return value.replace(/[\\"\u0000-\u001f\u007f]/g, (character) => named[character] ?? `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
}

/** `[1.20.1,1.20.2)`: exactly this game version and its patch releases' absence; the generated code uses names of this version only. */
export function minecraftRange(version: string) {
  const parts = version.split(".").map(Number)
  const next = parts.length === 3 ? [parts[0], parts[1], parts[2]! + 1] : [parts[0], parts[1], 1]
  return `[${version},${next.join(".")})`
}

/**
 * The loader versions a mod accepts, in mods.toml's Maven range syntax: this major and newer. Forge numbers its builds
 * `<major>.<minor>.<patch>` per game version (47 is 1.20.1); NeoForge's first two numbers are the game's (21.1 is 1.21.1).
 */
export function loaderRange(manifest: TargetManifest) {
  const parts = manifest.loader.version.split(".")
  return `[${(manifest.toolchain.kind === "mdg" ? parts.slice(0, 2) : parts.slice(0, 1)).join(".")},)`
}

/** GeckoLib: the version compiled against or any newer 4.x, as Fabric's `dependencyRanges` says it. */
export const geckolibRange = (version: string) => `[${version},${Number(version.split(".")[0]) + 1})`

/**
 * What the log of a ModDevGradle build says, in order. `createMinecraftArtifacts` is the first build's long step: NeoForm
 * Runtime downloads the game, merges and renames it, decompiles it, applies the loader's patches and compiles it again
 * (about two minutes of a 3–6 minute first build in the check; later builds skip it). Its own steps are printed as
 * `*** Started working on <step>`. The step names are the ones in the check's logs (forge-build.log, neoforge-build.log).
 */
export const MDG_STAGES: readonly ProgressStage[] = [
  [/Assembling a saved project snapshot/, "正在把工程里的东西整理到一起。"],
  [/Waiting for the runtime environment/, RUNTIME_WAIT_WORDS],
  [/Runtime environment free, going on/, "轮到它了，接着做。"],
  [/> Task :createMinecraftArtifacts\b/, "正在准备游戏的开发文件（第一次要几分钟）。"],
  [/Started working on download(?:Json|Client|Server|ClientMappings)\b/, "正在下载游戏本体和映射表。"],
  [/Started working on (?:mergeMappings|createMappings|extractServer|strip(?:Client|Server|SideAnnotations)|merge|rename)\b/, "正在整理游戏文件。"],
  [/Started working on decompile\b/, "正在反编译游戏（第一次最慢的一步）。"],
  [/Started working on (?:inject|patch|applyNeoforgePatches|transformSources|remapSrgSourcesToOfficial)\b/, "正在给游戏代码打上加载器的补丁。"],
  [/Started working on recompile\b/, "正在重新编译游戏代码。"],
  [/> Task :compileJava\b/, "正在编译模组的代码。"],
  [/> Task :processResources\b/, "正在装进贴图、模型和声音。"],
  [/> Task :jar\b/, "正在装成一个模组文件。"],
  // legacyforge only: the jar is turned back to the names the obfuscated game uses at run time.
  [/> Task :reobfJar\b/, "正在把模组文件换成游戏运行时用的名字。"],
  [/BUILD SUCCESSFUL/, "编译完成，正在检查做出来的文件。"],
]

/** Where the Gradle wrapper's `distributionUrl` goes in a `.properties` file: a colon is escaped there. */
const propertiesValue = (value: string) => value.replaceAll(":", "\\:")

export function mdgToolchain(manifest: TargetManifest): Toolchain {
  const kind = manifest.toolchain.kind
  if (kind !== "mdg" && kind !== "mdg-legacyforge") throw new Error(`NOT_AN_MDG_TARGET: ${manifest.id}`)
  const parchment = manifest.mappings.parchment
  const geckolib = manifest.dependencies.geckolib
  const template = `${manifest.loader.kind}-${manifest.minecraft.version}`
  const toolchain: Toolchain = {
    kind,
    target: manifest,
    template,
    javaMajors: [manifest.java.major, ...manifest.java.alsoForBuild],
    tasks: ["build", "compileJava", "runClient", "runServer"],
    gameCache: "neoformruntime",
    modFile: manifest.data.modFile,
    stages: MDG_STAGES,
    chinesePaths: {
      runs: "as-is",
      why:
        "ModDevGradle builds in a folder whose path has Chinese characters and spaces (Forge 1.20.1 and NeoForge 1.21.1, 2026-11-14), and its development " +
        "server starts there (runServer: NeoForge constructed the mod and started; Forge loaded the mod's mixin config and stopped at the EULA, which it asks " +
        "before mods are constructed), so no bootstrap like Loom's `ClasspathBootstrap` is added. runClient was not started. " +
        "Unlike Loom 1.7 it does not shorten the class path into a manifest jar: VM and program arguments go through @-files, but the class path and " +
        "`-Dfml.modFolders` are on the java command line itself (about 24,000 characters for the NeoForge server). That works where Windows' ANSI code page " +
        "can spell the folder's characters (a Chinese system, as checked); on another code page, or past Windows' 32,767-character command-line limit, " +
        "the run tasks would need a bootstrap too. The JDK paths are given to Gradle through environment variables (`org.gradle.java.installations.fromEnv`), " +
        "never on the command line, so a JDK under such a folder reaches Gradle intact whatever the code page.",
    },
    placeholders: (input) => {
      const mod = modPlaceholders(input)
      return {
        ...mod,
        toml_display_name: tomlString(mod.display_name),
        toml_description: tomlString(mod.description),
        toml_author: tomlString(mod.author),
        mc_version: manifest.minecraft.version,
        mc_version_range: minecraftRange(manifest.minecraft.version),
        loader_version: manifest.loader.version,
        loader_version_range: loaderRange(manifest),
        mdg_version: manifest.toolchain.plugin,
        gradle_version: manifest.toolchain.gradle.version,
        gradle_distribution_url: propertiesValue(manifest.toolchain.gradle.distribution.url),
        gradle_distribution_sha256: manifest.toolchain.gradle.distribution.sha256 ?? "",
        java_version: String(manifest.java.major),
        // Empty when the manifest names none: the build script then leaves Parchment out.
        parchment_minecraft_version: parchment?.minecraft ?? "",
        parchment_mappings_version: parchment?.version ?? "",
        geckolib_coordinate: geckolib.coordinate,
        geckolib_repository: geckolib.repository,
        geckolib_version: geckolib.version,
        geckolib_range: geckolibRange(geckolib.version),
        data_pack_format: String(manifest.data.packFormat.data),
        resource_pack_format: String(manifest.data.packFormat.resource),
      }
    },
    scaffold: async (input) => {
      checkScaffoldInput(input)
      const directory = path.resolve(input.directory)
      if (existsSync(directory) && (await readdir(directory)).length) throw new Error("Target directory is not empty")
      await checkGradleWrapper(input.templateDirectory)
      const files = await copyTemplate(input.templateDirectory, directory, toolchain.placeholders(input))
      // As Fabric's scaffold: the template's LICENSE is MIT's whole text; any other licence gets a short file that names it.
      if (input.license && input.license !== "MIT")
        await writeFile(path.join(directory, "LICENSE"), licenseNotice(input.license, { name: input.name, author: input.author ?? RELEASE_DEFAULTS.author, year: String(new Date().getFullYear()) }))
      const properties = path.join(directory, "gradle.properties")
      await writeFile(properties, (await readFile(properties, "utf8")).replace("mod_version=0.1.0", `mod_version=${input.version ?? RELEASE_DEFAULTS.version}`))
      return { directory, files }
    },
    gradle: (task, javaHomes) => {
      if (!toolchain.tasks.includes(task)) throw new Error("UNSUPPORTED_GRADLE_TASK")
      const homes = requireJavaHomes(toolchain, javaHomes)
      // Gradle reads each JDK's path from the variable named here. Only these, not whatever it finds on the computer, so the build uses Studio's JDKs.
      const env = Object.fromEntries(homes.map(({ major, home }) => [`MINEMODS_JDK_${major}`, home]))
      return {
        javaHome: homes[0]!.home,
        env,
        args: gradleWrapperArguments(task, [
          `-Porg.gradle.java.installations.fromEnv=${Object.keys(env).join(",")}`,
          "-Porg.gradle.java.installations.auto-detect=false",
          "-Porg.gradle.java.installations.auto-download=false",
        ]),
      }
    },
    jarPath: builtJarPath,
    stageWords: (text) => buildStageWords(text, MDG_STAGES),
  }
  return toolchain
}

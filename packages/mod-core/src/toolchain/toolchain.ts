import path from "node:path"
import type { ScaffoldInput } from "../fabric/scaffold"
import type { TargetManifest, ToolchainKind } from "../target/manifest"
import { targetManifest } from "../target/manifests"
import { loomToolchain } from "./loom"
import { mdgToolchain } from "./mdg"

/**
 * How one target's mod is made into a jar: which template it starts from, what fills the template's placeholders,
 * how Gradle is called, where the jar lands, how its log reads as stages, and what it needs for paths with Chinese
 * characters in them. Everything comes from the target's manifest; nothing here downloads or starts a process
 * (`run.ts` does that).
 *
 * - `loom` (Fabric) wraps what Studio always did (`fabric/scaffold.ts`, `runtime.ts`'s `runGradle`): same files, same
 *   command line.
 * - `mdg-legacyforge` (Forge 1.20.1) and `mdg` (NeoForge 1.21.1) are ModDevGradle. Forge 1.20.1 also needs Java 21
 *   next to its own 17 (legacyforge makes the deobfuscated game jar on 21), so every JDK of the manifest is handed to Gradle.
 */

/** The Gradle tasks Studio runs. A toolchain that has no such task leaves it out of its `tasks`. */
export type ToolchainTask = "build" | "compileJava" | "runClient" | "runServer"

/** What a template is filled with that the person decides: the mod, not the toolchain. */
export type ToolchainScaffoldInput = Pick<ScaffoldInput, "templateDirectory" | "directory" | "modId" | "name" | "packageName" | "version" | "description" | "author" | "license">

/** One JDK per Java major version the manifest names (`java.major` and `java.alsoForBuild`): its home folder. */
export type JavaHomes = ReadonlyMap<number, string>

/**
 * A Gradle run, without the parts every run shares (the JVM's proxy flags and the wrapper's class path, which `run.ts` adds):
 * `javaHome` is the JDK that starts the wrapper, `args` follow `GradleWrapperMain`, and `env` is added to the process's
 * environment (JDK paths travel there, not on the command line: see `mdg.ts`).
 */
export type GradleInvocation = { javaHome: string; args: string[]; env: Record<string, string> }

export type ProgressStage = readonly [RegExp, string]

/**
 * How a toolchain copes with a project folder whose path has Chinese characters (or spaces) in it.
 * - `classpath-bootstrap`: the development game is started through a small entry point that reads the real class path
 *   from a UTF-8 file (Loom 1.7 cannot hand such a class path to the game itself).
 * - `as-is`: building and the run tasks work in such a folder without help.
 */
export type ChinesePathHandling = { runs: "classpath-bootstrap" | "as-is"; why: string }

export interface Toolchain {
  readonly kind: ToolchainKind
  readonly target: TargetManifest
  /** The template folder under `templates/`. */
  readonly template: string
  /** Every Java major the build needs; the first is the one the game and the mod run on, and the one that starts Gradle. */
  readonly javaMajors: readonly number[]
  /** The tasks `gradle` accepts. */
  readonly tasks: readonly ToolchainTask[]
  /** The folder under Gradle's `caches` that holds this toolchain's copy of the game, which a first build fills. */
  readonly gameCache: string
  /** The file inside the jar that declares the mod (`fabric.mod.json`, `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`). */
  readonly modFile: string
  readonly stages: readonly ProgressStage[]
  readonly chinesePaths: ChinesePathHandling
  /** The template's placeholders, filled. */
  placeholders(input: Omit<ToolchainScaffoldInput, "templateDirectory" | "directory">): Record<string, string>
  /** Copies the template into an empty `directory` and fills it. */
  scaffold(input: ToolchainScaffoldInput): Promise<{ directory: string; files: string[] }>
  /** The Gradle command for `task`; `javaHomes` must hold a JDK for every one of `javaMajors`. */
  gradle(task: ToolchainTask, javaHomes: JavaHomes): GradleInvocation
  /** Where `build` leaves the jar the person gets. */
  jarPath(projectDirectory: string, mod: { modId: string; version?: string }): string
  /** The stage a stretch of this toolchain's build output has reached, in the person's words; null when it names none. */
  stageWords(text: string): string | null
}

/** The toolchain of a target, by its manifest or its ID. */
export function toolchainFor(target: TargetManifest | string): Toolchain {
  const manifest = typeof target === "string" ? targetManifest(target) : target
  switch (manifest.toolchain.kind) {
    case "loom":
      return loomToolchain(manifest)
    case "mdg-legacyforge":
    case "mdg":
      return mdgToolchain(manifest)
  }
}

/** A toolchain's template folder under the folder that holds every template (the repository's `templates/`, or the app's resources). */
export const templateDirectoryOf = (toolchain: Toolchain, templatesRoot: string) => path.join(templatesRoot, toolchain.template)

export { builtJarPath, requireJavaHomes } from "./common"

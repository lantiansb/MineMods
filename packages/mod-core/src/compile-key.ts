import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

/**
 * What decides the outcome of compiling a generated project, as one fingerprint. Used by the code check to keep a
 * finished verdict for as long as, and only as long as, none of it changed (`gameplay-compile.ts`), and by the direct
 * javac path to know which resolved classpath belongs to which build setup (`javac-direct.ts`).
 *
 * Derivation. The compile Studio asks for is `compileJava` of the generated project. Gradle's compileJava is a function of
 *   1. the Java files of the main source set (`src/main/java`): every byte of every file and its place in the tree;
 *   2. the classpath and compiler settings, which come from the build scripts and the versions they name: `build.gradle`,
 *      `settings.gradle`, `gradle.properties` and the wrapper's `gradle-wrapper.properties` (Gradle version);
 *   3. what Loom reads beside the scripts when it prepares that classpath and the Mixin processor: the mod's `*.mixins.json`,
 *      any `*.accesswidener` at the top of the resources, and the `accessWidener` entry of `fabric.mod.json`;
 *   4. the JDK and the machine's Gradle caches, which are the compiler's own and are named by the caller (`identity`).
 * Nothing else is read by compileJava: the other resources (pictures, language files, recipes, models, `fabric.mod.json`
 * apart from its `accessWidener` entry, the project backup, the README) go into the jar through processResources, a task
 * compileJava does not depend on, and `src/studioDev` is a source set of its own that only the run tasks compile.
 * So two assembled projects with the same fingerprint have the same compile result, and when any input above changes the
 * fingerprint changes.
 *
 * The one line of `gradle.properties` left out is `mod_version=`: it only names the jar (`version = project.mod_version`
 * in build.gradle), and a release-version edit must not throw away a finished check.
 */

export type CompileInputs = {
  /** Over every file under src/main/java. */
  sources: string
  /** Over the build scripts, the Gradle version and what Loom reads beside them. */
  toolchain: string
  /** How many Java files were read, for the record. */
  files: number
}

const sha = (...parts: (string | Uint8Array)[]) => {
  const hash = createHash("sha256")
  for (const part of parts) {
    // A length before each part, so that "ab"+"c" and "a"+"bc" are not the same input.
    hash.update(`${typeof part === "string" ? Buffer.byteLength(part) : part.byteLength}:`)
    hash.update(part)
  }
  return hash.digest("hex")
}

/** The files under `directory` (relative, with forward slashes), sorted by code point so the order is the same on every machine. */
async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

const missing = (error: unknown) => {
  if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return null
  throw error
}

export async function compileInputs(directory: string): Promise<CompileInputs> {
  const javaRoot = path.join(directory, "src", "main", "java")
  const names = (await filesUnder(javaRoot)).filter((name) => name.endsWith(".java"))
  const sources = sha(...(await Promise.all(names.map(async (name) => sha(name, await readFile(path.join(javaRoot, ...name.split("/"))))))))
  const read = async (...segments: string[]) => (await readFile(path.join(directory, ...segments), "utf8").catch(missing)) ?? "<absent>"
  const properties = (await read("gradle.properties")).replace(/^mod_version=.*$/m, "mod_version=<left out>")
  const resources = path.join(directory, "src", "main", "resources")
  const top = (await filesUnder(resources)).filter((name) => !name.includes("/") && /\.(?:mixins\.json|accesswidener)$/i.test(name))
  const metadata = await readFile(path.join(resources, "fabric.mod.json"), "utf8").then((text) => (JSON.parse(text) as { accessWidener?: unknown }).accessWidener ?? null, () => null)
  const toolchain = sha(
    await read("build.gradle"),
    await read("settings.gradle"),
    properties,
    await read("gradle", "wrapper", "gradle-wrapper.properties"),
    ...(await Promise.all(top.map(async (name) => sha(name, await readFile(path.join(resources, name)))))),
    JSON.stringify(metadata),
  )
  return { sources, toolchain, files: names.length }
}

/** The key of one compile: the inputs above and the compiler's own identity (its JDK and caches). */
export const compileKey = (inputs: CompileInputs, identity: string) => sha("compile-key-v1", inputs.sources, inputs.toolchain, identity)

/**
 * The key of a build setup: what decides the classpath and flags Gradle gives javac, without the Java files (those are javac's input, not part of the list).
 * Records of the direct javac path are kept under it.
 */
export const setupKey = (inputs: CompileInputs, identity: string) => sha("setup-key-v1", inputs.toolchain, identity)

import { randomUUID } from "node:crypto"
import { mkdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { assembleBuildSource } from "./build-source"
import { compileInputs, compileKey } from "./compile-key"
import { GAMEPLAY_LIMITS, gameplayRoot, type GameplayDocument } from "./gameplay"
import { compilerFindings, type GameplayCheck } from "./gameplay-check"
import { COMPILE_ELSEWHERE_NOTE } from "./gameplay-plain"
import { CONVERTED_HINT, convertedGameplay } from "./naming-migration/record"
import { storagePath, withProjectLock } from "./project"

/**
 * Compiling a gameplay that is not saved yet, together with everything the project generates. The source
 * is assembled exactly as a build assembles it, with the candidate in the place of its asset; then a
 * compiler is run on it and what it printed is mapped to the candidate's own files. Which compiler is the
 * caller's: on a person's machine the generated project's Gradle (`gradleCompiler` in build.ts), in tests
 * javac alone. Does not load the download and process code behind a real build.
 */

export type CodeCompiler = {
  /** Shown beside the result: which compiler said so. */
  name: string
  /**
   * What else about this compiler can change its verdict on the same files (its JDK, the folder of resolved libraries), as a string that is
   * equal exactly when the verdicts are. Part of the key under which a finished compile is kept; a compiler that says nothing is told apart by `name` alone.
   */
  identity?: () => Promise<string>
  /**
   * Compile the assembled project. `gameplay` is the folder all gameplay code lies in, for a compiler that takes folders. `target` is the
   * project's target ID (left out, Fabric 1.21.1): its toolchain, and the Java its build needs, are the ones a compiler that runs the real build tool must use.
   * `compiler`: which way of compiling actually ran, when the compiler has more than one (shown instead of `name`).
   */
  run: (sourceDirectory: string, gameplay: string, target?: string) => Promise<{ code: number; output: string; compiler?: string }>
}

/** Said beside a verdict that was not compiled again: the same files had already been compiled, and the verdict is that one's. */
export const REUSED_NOTE = "这一版和工程生成的全部代码，跟之前编译过的一模一样，沿用了那次的编译结果，没有重新编译。"
const REUSED_MARK = "（沿用上次）"

/**
 * Finished compiles, by `compileKey` (see compile-key.ts for why that key decides the result). In memory, bounded: after a restart
 * the same files are simply compiled once more. Only a compile that really ran and ended with a verdict is kept; one that could
 * not run says nothing about the code and is never kept.
 */
const compiled = new Map<string, NonNullable<GameplayCheck["compile"]>>()
/**
 * Most verdicts kept. The one asked for again is the latest version of a gameplay still being made, so what must be remembered is a few gameplays' worth of
 * versions: every version a gameplay is allowed (`GAMEPLAY_LIMITS.rounds`) for four gameplays at once. One verdict is at most a few kilobytes (its findings are
 * capped by the record's own schema), so these stay far under a megabyte.
 */
export const COMPILED_KEPT = GAMEPLAY_LIMITS.rounds * 4
export const forgetCompiled = () => compiled.clear()

export type CompileResult = { ran: true; compile: NonNullable<GameplayCheck["compile"]> } | { ran: false; reason: string }

export async function compileGameplayCandidate(projectDirectory: string, input: { templateDirectory: string; candidate: { asset_id: string; title: string; document: GameplayDocument }; compiler: CodeCompiler; signal?: AbortSignal }): Promise<CompileResult> {
  const root = await realpath(projectDirectory)
  const directory = path.join(path.dirname(await storagePath(root, ["generated", "reserve"], true)), `check-${randomUUID()}`)
  const assembled = await withProjectLock(root, async () => {
    await mkdir(directory)
    return assembleBuildSource(root, directory, input.templateDirectory, { candidate: input.candidate })
  }).catch(async (error: unknown) => {
    await rm(directory, { recursive: true, force: true })
    throw error
  })
  // The key is taken from what was just assembled, never from the project's revision: a commit that changes nothing the compiler is given (a recipe, another model's look)
  // must not make the same files compile again. A key that cannot be taken only means this one is compiled, as before.
  const key = await compileInputs(directory)
    .then(async (inputs) => compileKey(inputs, `${input.compiler.name}\n${(await input.compiler.identity?.()) ?? ""}`))
    .catch(() => null)
  const kept = key === null ? undefined : compiled.get(key)
  if (kept) {
    await rm(directory, { recursive: true, force: true })
    return { ran: true, compile: { ...structuredClone(kept), compiler: `${kept.compiler.slice(0, 80 - REUSED_MARK.length)}${REUSED_MARK}`, note: kept.note ?? REUSED_NOTE } }
  }
  const ran = await input.compiler
    .run(directory, path.join(directory, "src", "main", "java", ...gameplayRoot(assembled.project.mod_id).split(".")), assembled.target.manifest.id)
    .then((result) => ({ result }), (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }))
    .finally(() => rm(directory, { recursive: true, force: true }))
  if (input.signal?.aborted) throw new Error("CANCELLED")
  if ("error" in ran) return { ran: false, reason: ran.error === "CANCELLED" ? "检查被取消了。" : notStartedWords(ran.error, assembled.target.manifest.id) }
  const name = (ran.result.compiler ?? input.compiler.name).slice(0, 80)
  const keep = (compile: NonNullable<GameplayCheck["compile"]>): CompileResult => {
    if (key !== null) {
      compiled.delete(key)
      // A copy: whoever is handed the result may change it, and what is kept must stay as the compiler said it.
      compiled.set(key, structuredClone(compile))
      // Oldest first out: a Map keeps the order things were put in.
      while (compiled.size > COMPILED_KEPT) compiled.delete(compiled.keys().next().value!)
    }
    return { ran: true, compile }
  }
  if (ran.result.code === 0) return keep({ ok: true, findings: [], compiler: name, note: null })
  const found = compilerFindings(ran.result.output, assembled.project.mod_id, input.candidate.document.slug, assembled.project.target)
  // Code Studio converted from Yarn's names by machine: what is left is most likely a name the conversion missed, and the writer is told so.
  if (found.own.length && (await convertedGameplay(root)).has(input.candidate.asset_id))
    return keep({ ok: false, findings: found.own.map((finding) => ({ ...finding, fix: `${finding.fix}${CONVERTED_HINT}` })), compiler: name, note: null })
  if (found.own.length) return keep({ ok: false, findings: found.own, compiler: name, note: null })
  // The compiler failed on files that are not this gameplay's: the project as a whole does not compile, and the writer is told where.
  if (found.elsewhere.length) return keep({ ok: false, findings: [], compiler: name, note: COMPILE_ELSEWHERE_NOTE, detail: `工程里别的代码编译不过，不是这个玩法自己的文件：${found.elsewhere.slice(0, 4).join("；")}。` })
  // It ended badly without naming a single line: the tool itself failed (no network for its downloads, no Java), and nothing was learnt about the code.
  return { ran: false, reason: `编译工具自己出了问题，没有给出任何一行代码的错误：${toolFailureWords(ran.result.output)}` }
}

/** Gradle's toolchain lookup, when the Java a build asks for is not among those it was given (and it may neither look further nor download one). */
const JAVA_NOT_FOUND = /Cannot find a Java installation on your machine[^\n]*?matching: \{languageVersion=(\d+)/
/** Lines that are in every failed Gradle run and say nothing about this one. */
const GRADLE_BOILERPLATE = /^(?:BUILD FAILED\b|\d+ actionable tasks?:|\* (?:Try|Get more help)|> (?:Run with|Learn more|Get more help)|FAILURE: Build failed)/

/**
 * Why a compile tool ended badly without naming a line of code, in plain words: the Java it wanted and was not given, else what Gradle
 * said went wrong (its deepest causes), else the last lines it printed that were not its usual footer. Never "the tool broke" alone: a
 * Forge 1.20.1 check that could not find Java 17 said only that, and the reason had to be dug out of Gradle's daemon log.
 */
export function toolFailureWords(output: string): string {
  const text = output.replaceAll("\r\n", "\n")
  const wrong = /\* What went wrong:\n([\s\S]*?)(?:\n[ \t]*\n|\n\* Try:|$)/.exec(text)
  const said = (wrong?.[1] ?? "")
    .split("\n")
    .map((line) => line.trim().replace(/^>\s*/, ""))
    .filter(Boolean)
  const lines = (said.length ? said : text.split("\n").map((line) => line.trim()).filter((line) => line && !GRADLE_BOILERPLATE.test(line))).slice(-3).join(" ").slice(0, 400)
  const wanted = JAVA_NOT_FOUND.exec(text)?.[1]
  if (wanted) return `Gradle 要用 Java ${wanted} 来准备这个版本的 Minecraft，但交给它的 Java 里没有 ${wanted}（它不自己去找，也不自己下载），所以一行代码都还没编译到。Gradle 最后说：${lines}`
  return lines ? `Gradle 最后说：${lines}` : "它什么都没有输出。"
}

/** Why the compiler did not start at all, in plain words; a Java that is missing or of the wrong version is named with the target that needs it. */
function notStartedWords(error: string, target: string): string {
  const java = /^(?:EXPLICIT_)?JAVA_(\d+)_REQUIRED/.exec(error)?.[1]
  if (java) return `编译器没有跑起来：检查要用 Java ${java}（${target} 的工程打包也用它），但没有找到能用的 Java ${java}（${error.slice(0, 120)}）。`
  if (error === "JAVA_HOME_NOT_FOUND") return `编译器没有跑起来：指定的 Java 文件夹不在了（${error}）。`
  return `编译器没有跑起来（${error.slice(0, 300)}）。`
}

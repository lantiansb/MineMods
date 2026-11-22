import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { CAPTURE_FILE } from "./runtime"

/**
 * Compiling the generated project with javac alone, against the classpath Gradle itself resolved for the same project.
 *
 * Why this is the same compile and not a look-alike. A real `gradle compileJava` spends most of its time before javac runs:
 * starting Gradle, configuring Loom, checking its caches. What javac is then handed is a fixed list: a classpath of jars (Minecraft remapped to
 * Mojang's official names with Fabric's access wideners applied, Fabric API, GeckoLib, Loader), a processor path (Loom's Mixin annotation processor) with
 * its `-A` flags, `--release`, the encoding, and the Java files of `src/main/java`. A code check that has once run the real Gradle
 * records exactly that list (an init script writes it just before Gradle's compile; see `CAPTURE_SCRIPT` in runtime.ts), and
 * later checks hand javac the same list again. Nothing is guessed about where Loom keeps its files: whatever Gradle used is what is
 * kept, and a file that is not there any more (or has changed) makes the record unusable, and the check goes back to Gradle.
 *
 * It is trusted only after it has agreed with Gradle once (`calibrate`): the first time a record is learnt, javac is also run on the
 * very files Gradle compiled, and the record is used for later checks only if both said the same (both passed, or both
 * reported the same errors on the same lines). A record that disagreed is kept as untrusted so that it is not learnt again every time.
 *
 * Generated sources: the project has none beyond `src/main/java` (the capture checks that this is the main source set's only folder), and the
 * Mixin processor writes a refmap and a mapping file, not Java.
 */

export const DIRECT_COMPILER = "javac（沿用 Gradle 解析出的同一份类路径）"
const STORE = "javac-classpath"
/** Placeholder in a stored compiler flag for the folder of the project being compiled; it is a new folder every time. */
const WORK = "{{WORK}}"
/** Flags Studio sets itself below; a build that also passed them would be compiled differently from what is recorded. */
const OWN_FLAGS = new Set(["-d", "-s", "-h", "-cp", "-classpath", "--class-path", "-p", "--module-path", "-sourcepath", "--source-path", "-processorpath", "--processor-path", "-encoding", "--release", "-source", "-target", "--source", "--target", "-proc:none"])

const Capture = z.object({
  schema: z.literal(1),
  projectDir: z.string().min(1),
  srcDirs: z.array(z.string()),
  classpath: z.array(z.string().min(1)),
  processorpath: z.array(z.string().min(1)),
  compilerArgs: z.array(z.string()),
  argFileExists: z.array(z.boolean()),
  release: z.number().int().positive().nullable(),
  encoding: z.string().min(1).nullable(),
  fork: z.boolean().nullable().optional(),
})

const Entry = z.strictObject({ path: z.string().min(1), size: z.number().int().nonnegative(), mtime_ms: z.number() })
export type Entry = z.infer<typeof Entry>

const RecordSchema = z.strictObject({
  v: z.literal(1),
  learned_at: z.iso.datetime(),
  release: z.number().int().positive(),
  encoding: z.string().min(1),
  classpath: z.array(Entry),
  processorpath: z.array(Entry),
  args: z.array(z.string()),
  /** Files named by the processor's flags that must still be there and unchanged. */
  inputs: z.array(Entry),
  /** True once javac has agreed with Gradle on the very files Gradle compiled. Only a trusted record is compiled with. */
  trusted: z.boolean(),
  /** What the agreement was on (both passed, or both failed with the same errors), or why it did not hold. */
  calibration: z.string().max(400),
})
export type ClasspathRecord = z.infer<typeof RecordSchema>

const unixPath = (value: string) => value.split(path.sep).join("/")
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function entryOf(file: string): Promise<Entry> {
  const info = await stat(file)
  return { path: file, size: info.size, mtime_ms: info.mtimeMs }
}

/** Why a recorded file can no longer be relied on (gone, a folder, or changed since it was recorded); null while it is the same file. */
async function drift(entry: Entry): Promise<string | null> {
  const info = await stat(entry.path).catch(() => null)
  if (!info) return `${path.basename(entry.path)} 已经不在了`
  if (!info.isFile() || info.size !== entry.size || info.mtimeMs !== entry.mtime_ms) return `${path.basename(entry.path)} 变了`
  return null
}

/** The folder a runtime directory keeps its records in, and one record's file. */
export const storeOf = (runtimeDirectory: string) => path.join(runtimeDirectory, STORE)
const recordFile = (runtimeDirectory: string, key: string) => path.join(storeOf(runtimeDirectory), `${key}.json`)

export async function readRecord(runtimeDirectory: string, key: string): Promise<ClasspathRecord | null> {
  const text = await readFile(recordFile(runtimeDirectory, key), "utf8").catch(() => null)
  if (text === null) return null
  return RecordSchema.safeParse(JSON.parse(text)).data ?? null
}

async function writeRecord(runtimeDirectory: string, key: string, record: ClasspathRecord) {
  await mkdir(storeOf(runtimeDirectory), { recursive: true })
  const temporary = path.join(storeOf(runtimeDirectory), `.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(record)}\n`)
  await rename(temporary, recordFile(runtimeDirectory, key)).finally(() => rm(temporary, { force: true }))
}

export type Learnt = { record: Omit<ClasspathRecord, "trusted" | "calibration"> } | { reason: string }

/**
 * Turns what Gradle recorded into something later checks can use. Files that lie inside the throwaway project folder (where
 * a Loom that keeps its caches per project would put them) are copied into the store, because the folder is deleted after the
 * check; everything else is referenced where it is and watched for change. A shape this does not understand is refused with
 * the reason, and the check simply keeps using Gradle.
 */
export async function learnCapture(sourceDirectory: string, runtimeDirectory: string, key: string): Promise<Learnt> {
  const text = await readFile(path.join(sourceDirectory, ...CAPTURE_FILE.split("/")), "utf8").catch(() => null)
  if (text === null) return { reason: "Gradle 没有留下编译参数的记录" }
  const parsed = Capture.safeParse(JSON.parse(text))
  if (!parsed.success) return { reason: "Gradle 留下的编译参数记录读不懂" }
  const capture = parsed.data
  const project = path.resolve(capture.projectDir)
  // The folder Gradle names may be spelled through a link (a short Windows name, a symlinked temp folder); the same folder is what counts.
  const same = async (left: string, right: string) => (await realpath(left).catch(() => path.resolve(left))) === (await realpath(right).catch(() => path.resolve(right)))
  if (!(await same(sourceDirectory, project))) return { reason: "记录的工程文件夹不是这一次编译的那个" }
  if (capture.srcDirs.length !== 1 || path.resolve(capture.srcDirs[0]!) !== path.join(project, "src", "main", "java")) return { reason: "主源码不只是 src/main/java 一个文件夹" }
  if (capture.release === null || capture.encoding === null) return { reason: "编译没有写明 Java 版本或编码" }
  if (capture.argFileExists.length !== capture.compilerArgs.length) return { reason: "编译参数记录对不上" }
  const folder = path.join(storeOf(runtimeDirectory), key)
  await rm(folder, { recursive: true, force: true })
  let copies = 0
  const keep = async (file: string): Promise<Entry | string> => {
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) return `${path.basename(file)} 不是一个文件`
    if (!inside(project, file)) return entryOf(file)
    await mkdir(folder, { recursive: true })
    const copy = path.join(folder, `${copies++}-${path.basename(file)}`)
    await copyFile(file, copy)
    return entryOf(copy)
  }
  const keepAll = async (files: string[]) => {
    const kept = await Promise.all(files.map((file) => keep(path.resolve(file))))
    const bad = kept.find((value): value is string => typeof value === "string")
    return bad === undefined ? (kept as Entry[]) : bad
  }
  const classpath = await keepAll(capture.classpath)
  if (typeof classpath === "string") return { reason: classpath }
  const processorpath = await keepAll(capture.processorpath)
  if (typeof processorpath === "string") return { reason: processorpath }
  const inputs: Entry[] = []
  const args: string[] = []
  for (const [index, arg] of capture.compilerArgs.entries()) {
    if (OWN_FLAGS.has(arg.split("=")[0]!) || arg.startsWith("@")) return { reason: `编译参数里有 ${arg.slice(0, 40)}，它和直接编译自己设的参数冲突` }
    const flag = /^(-A[^=]+=)(.*)$/.exec(arg)
    const value = flag ? flag[2]! : arg
    if (!flag) {
      if (arg.includes(project)) return { reason: `编译参数 ${arg.slice(0, 40)} 里带着工程文件夹，不知道怎么搬` }
      args.push(arg)
      continue
    }
    if (!path.isAbsolute(value)) {
      args.push(arg)
      continue
    }
    const target = path.resolve(value)
    if (inside(project, target) && !capture.argFileExists[index]) {
      // Somewhere in the project that the compile writes to (the refmap, the mapping file): the same place in the next project folder.
      args.push(`${flag[1]}${WORK}/${unixPath(path.relative(project, target))}`)
    } else if (capture.argFileExists[index]) {
      const kept = await keep(target)
      if (typeof kept === "string") return { reason: kept }
      inputs.push(kept)
      args.push(`${flag[1]}${kept.path}`)
    } else {
      args.push(arg)
    }
  }
  return { record: { v: 1, learned_at: new Date().toISOString(), release: capture.release, encoding: capture.encoding, classpath, processorpath, args, inputs } }
}

/** The `.java` files of the main source set, absolute and in a fixed order. */
async function javaFiles(sourceDirectory: string) {
  const root = path.join(sourceDirectory, "src", "main", "java")
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.join(entry.parentPath, entry.name)).sort()
}

const quoted = (token: string) => `"${token.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`

export type DirectRun = { run: (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs: number; onProgress?: (text: string) => void }) => Promise<{ code: number; output: string }>; javac: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; onProgress?: (text: string) => void }

/** The compile of `sourceDirectory` with the recorded list, or the reason it cannot be done this way. */
export async function compileDirect(sourceDirectory: string, record: ClasspathRecord, how: DirectRun): Promise<{ code: number; output: string } | { reason: string }> {
  for (const entry of [...record.classpath, ...record.processorpath, ...record.inputs]) {
    const changed = await drift(entry)
    if (changed) return { reason: changed }
  }
  if (!(await lstat(how.javac).catch(() => null))) return { reason: "JDK 里没有 javac" }
  const files = await javaFiles(sourceDirectory)
  if (!files.length) return { reason: "没有 Java 文件" }
  const work = path.join(sourceDirectory, "build", "minemods-javac")
  await mkdir(path.join(work, "classes"), { recursive: true })
  await mkdir(path.join(work, "empty"), { recursive: true })
  const flags = record.args.map((arg) => arg.replaceAll(WORK, unixPath(sourceDirectory)))
  // Where the processor writes its files: the folder has to be there, as it is when Gradle runs.
  await Promise.all(flags.map((flag) => /^-A[^=]+=(.*)$/.exec(flag)?.[1]).filter((value): value is string => !!value && path.isAbsolute(value) && inside(sourceDirectory, value)).map((value) => mkdir(path.dirname(value), { recursive: true })))
  // Everything goes through an argument file: a project folder can have long and non-ASCII names, and the command line of a Windows process holds neither well.
  const tokens = [
    "-d", "build/minemods-javac/classes",
    "-encoding", record.encoding,
    "--release", String(record.release),
    // An empty source path, as Gradle gives: classes are found on the classpath, never compiled from a source file found there.
    "-sourcepath", "build/minemods-javac/empty",
    "-classpath", record.classpath.map((entry) => entry.path).join(path.delimiter),
    ...(record.processorpath.length ? ["-processorpath", record.processorpath.map((entry) => entry.path).join(path.delimiter)] : ["-proc:none"]),
    ...flags,
    ...files,
  ]
  await writeFile(path.join(work, "args.txt"), `${tokens.map(quoted).join("\n")}\n`, "utf8")
  how.onProgress?.("> Task :compileJava (javac, the classpath Gradle resolved)\n")
  // The diagnostics are read as UTF-8 whatever the console's code page is.
  return how.run(how.javac, ["-J-Dstdout.encoding=UTF-8", "-J-Dstderr.encoding=UTF-8", "@build/minemods-javac/args.txt"], { cwd: sourceDirectory, env: how.env, signal: how.signal, timeoutMs: 900000, onProgress: how.onProgress })
}

/** `file:line: error: text` of every error in javac's or Gradle's output, with the path cut to what follows `src/main/java/`. */
export function errorSet(output: string) {
  return [
    ...new Set(
      output
        .replaceAll("\r\n", "\n")
        .split("\n")
        .flatMap((line) => {
          const match = /^(.*\.java):(\d+): error: (.*)$/.exec(line.trim().replaceAll("\\", "/"))
          if (!match) return []
          const at = match[1]!.lastIndexOf("src/main/java/")
          return [`${at < 0 ? match[1]! : match[1]!.slice(at + "src/main/java/".length)}:${match[2]}: ${match[3]}`]
        }),
    ),
  ].sort()
}

/**
 * Learns the record from a Gradle compile that has just run, and tests it against that very compile: javac on the same files must
 * say the same. Returns what to tell the log. Never throws: a check does not fail because the shortcut could not be set up.
 */
export async function learnAndCalibrate(input: { sourceDirectory: string; runtimeDirectory: string; key: string; gradle: { code: number; output: string }; how: DirectRun }): Promise<string> {
  try {
    const learnt = await learnCapture(input.sourceDirectory, input.runtimeDirectory, input.key)
    if ("reason" in learnt) return `Not learnt for the direct javac path: ${learnt.reason}.\n`
    const draft = { ...learnt.record, trusted: false, calibration: "" }
    const direct = await compileDirect(input.sourceDirectory, draft, input.how)
    // Nothing is written when the comparison could not be made (no javac in the JDK, a library gone already): the next Gradle compile tries again.
    if ("reason" in direct) return `Direct javac could not be compared with Gradle: ${direct.reason}.\n`
    const gradleErrors = errorSet(input.gradle.output)
    const directErrors = errorSet(direct.output)
    const bothPassed = input.gradle.code === 0 && direct.code === 0
    const sameErrors = input.gradle.code !== 0 && direct.code !== 0 && gradleErrors.length > 0 && JSON.stringify(gradleErrors) === JSON.stringify(directErrors)
    const trusted = bothPassed || sameErrors
    const calibration = trusted ? (bothPassed ? "Gradle 和 javac 都编译通过" : `Gradle 和 javac 报了同样的 ${gradleErrors.length} 个错误`) : `Gradle ${input.gradle.code === 0 ? "通过" : `报 ${gradleErrors.length} 个错误`}，javac ${direct.code === 0 ? "通过" : `报 ${directErrors.length} 个错误`}，两边不一致`
    await writeRecord(input.runtimeDirectory, input.key, { ...draft, trusted, calibration })
    return trusted ? `Direct javac agreed with Gradle (${bothPassed ? "both compiled" : "same errors"}); later checks use it.\n` : `Direct javac disagreed with Gradle (${calibration}); later checks keep using Gradle.\n`
  } catch (error) {
    return `Direct javac was not set up: ${error instanceof Error ? error.message : String(error)}.\n`
  }
}

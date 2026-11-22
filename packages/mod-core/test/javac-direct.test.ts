import { afterEach, expect, test } from "bun:test"
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gradleCompiler } from "../src/build"
import { compileInputs, compileKey, setupKey } from "../src/compile-key"
import { DIRECT_COMPILER, compileDirect, errorSet, learnCapture, readRecord, storeOf } from "../src/javac-direct"
import { CAPTURE_FILE, CAPTURE_SCRIPT, runOwnedProcess } from "../src/runtime"
import { scaffoldProject } from "../src/fabric/scaffold"
import { hasTargetJavac, targetJdkTool } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
/** The class path a code check is compiled against here: Fabric with Mojang's names (`target-javac.ts`), and the javac of its JDK. */
const OFFICIAL = "fabric-1.21.1-official"
const HAS_JAVAC = hasTargetJavac(OFFICIAL)
const JAVAC = targetJdkTool(OFFICIAL, "javac")
const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))
const temp = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-direct-"))
  roots.push(directory)
  return directory
}

/** A scaffolded project of the template, as a code check gets one, with a gameplay class in it. */
async function project(directory: string, body = "int answer() { return 42; }") {
  await scaffoldProject({ templateDirectory: TEMPLATE, directory, modId: "probe", name: "Probe", packageName: "com.minemods.content_probe" })
  const folder = path.join(directory, "src", "main", "java", "com", "minemods", "content_probe", "gameplay", "alarm")
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, "Alarm.java"), `package com.minemods.content_probe.gameplay.alarm;\n\nimport net.minecraft.resources.ResourceLocation;\n\nfinal class Alarm {\n    ResourceLocation id() { return ResourceLocation.fromNamespaceAndPath("probe", "alarm"); }\n    ${body}\n}\n`)
  return { gameplay: path.dirname(folder), alarm: path.join(folder, "Alarm.java") }
}

// ---- the key a finished compile is kept under ----

test("the compile key follows what javac is given and the build setup, and nothing else", async () => {
  const one = await temp()
  const two = await temp()
  await project(one)
  await project(two)
  const first = await compileInputs(one)
  // The same files in another folder are the same inputs.
  expect(await compileInputs(two)).toEqual(first)
  expect(compileKey(first, "jdk-a")).toBe(compileKey(await compileInputs(two), "jdk-a"))
  // Another JDK or another folder of libraries is another compiler.
  expect(compileKey(first, "jdk-a")).not.toBe(compileKey(first, "jdk-b"))
  // Not javac's inputs: the other resources, the project backup, the jar's version number.
  await writeFile(path.join(two, "src", "main", "resources", "assets", "probe", "lang", "en_us.json"), '{"a":"b"}')
  await mkdir(path.join(two, "project-backup"), { recursive: true })
  await writeFile(path.join(two, "project-backup", "minemods.project.json"), "{}")
  await writeFile(path.join(two, "gradle.properties"), (await readFile(path.join(two, "gradle.properties"), "utf8")).replace("mod_version=0.1.0", "mod_version=9.9.9"))
  expect(await compileInputs(two)).toEqual(first)
  // Its inputs: any Java file (a changed byte, a new file), the build scripts, the dependency versions, the Gradle version, the mixin list, an access widener.
  const changed = async (edit: (directory: string) => Promise<void>) => {
    const directory = await temp()
    await project(directory)
    await edit(directory)
    return compileInputs(directory)
  }
  const alarm = (directory: string) => path.join(directory, "src", "main", "java", "com", "minemods", "content_probe", "gameplay", "alarm", "Alarm.java")
  expect((await changed(async (d) => writeFile(alarm(d), (await readFile(alarm(d), "utf8")).replace("42", "43")))).sources).not.toBe(first.sources)
  expect((await changed(async (d) => writeFile(path.join(path.dirname(alarm(d)), "Other.java"), "package x;"))).sources).not.toBe(first.sources)
  for (const [file, edit] of [
    ["build.gradle", (text: string) => `${text}\n// changed`],
    ["settings.gradle", (text: string) => `${text}\n// changed`],
    ["gradle.properties", (text: string) => text.replace("fabric_version=", "fabric_version=0.0.1-")],
    ["gradle/wrapper/gradle-wrapper.properties", (text: string) => text.replace("gradle-8.8", "gradle-8.9")],
    ["src/main/resources/probe.mixins.json", (text: string) => text.replace('"client": []', '"client": ["X"]')],
  ] as const) {
    const after = await changed(async (d) => writeFile(path.join(d, file), edit(await readFile(path.join(d, file), "utf8"))))
    expect(after.sources).toBe(first.sources)
    expect(after.toolchain).not.toBe(first.toolchain)
  }
  expect((await changed(async (d) => writeFile(path.join(d, "src", "main", "resources", "probe.accesswidener"), "accessWidener v2 named\n"))).toolchain).not.toBe(first.toolchain)
})

// ---- learning what Gradle gave javac ----

const capture = (directory: string, extra: Record<string, unknown> = {}) => ({
  schema: 1,
  projectDir: directory,
  srcDirs: [path.join(directory, "src", "main", "java")],
  classpath: [] as string[],
  processorpath: [] as string[],
  compilerArgs: [] as string[],
  argFileExists: [] as boolean[],
  release: 21,
  encoding: "UTF-8",
  fork: false,
  ...extra,
})

/** Every jar of the stand-in classpath: what Gradle's resolved classpath of the real build comes to for these tests. */
async function jars() {
  const listed = await readFile(path.join(process.env.MINEMODS_TARGET_CLASSPATH ?? "", `${OFFICIAL}.txt`), "utf8")
  return listed.split(/\r?\n/).filter((jar) => jar.endsWith(".jar")).sort()
}

test("what Gradle recorded is kept as a record: libraries by place and fingerprint, files inside the throwaway folder copied, outputs moved to the next folder", async () => {
  const runtime = await temp()
  const source = await temp()
  await mkdir(path.join(source, "build"), { recursive: true })
  const inside = path.join(source, "loom-cache", "mapped.jar")
  await mkdir(path.dirname(inside), { recursive: true })
  await writeFile(inside, "not really a jar")
  const outside = path.join(runtime, "outside.jar")
  await writeFile(outside, "outside")
  const map = path.join(source, "loom-cache", "in.tiny")
  await writeFile(map, "tiny")
  const write = (value: unknown) => writeFile(path.join(source, ...CAPTURE_FILE.split("/")), JSON.stringify(value))
  await write(
    capture(source, {
      classpath: [inside, outside],
      processorpath: [outside],
      compilerArgs: [`-AinMap=${map}`, `-AoutRefMap=${path.join(source, "build", "tmp", "refmap.json")}`, "-AdefaultEnv=named:intermediary", "-Xlint:deprecation"],
      argFileExists: [true, false, false, false],
    }),
  )
  const learnt = await learnCapture(source, runtime, "k1")
  if ("reason" in learnt) throw new Error(learnt.reason)
  const record = learnt.record
  // The file inside the folder that is deleted after the check lives on in the store; the one outside stays where it is.
  expect(record.classpath[0]!.path).toContain(path.join(storeOf(runtime), "k1"))
  expect(await readFile(record.classpath[0]!.path, "utf8")).toBe("not really a jar")
  expect(record.classpath[1]).toMatchObject({ path: outside, size: 7 })
  expect(record.inputs).toHaveLength(1)
  expect(record.args).toEqual([`-AinMap=${record.inputs[0]!.path}`, "-AoutRefMap={{WORK}}/build/tmp/refmap.json", "-AdefaultEnv=named:intermediary", "-Xlint:deprecation"])
  expect(record.release).toBe(21)

  // Shapes the direct way does not understand are refused with a reason, not guessed at.
  const refused = async (value: unknown) => {
    await write(value)
    const result = await learnCapture(source, runtime, "k2")
    return "reason" in result ? result.reason : "learnt"
  }
  expect(await refused(capture(source, { srcDirs: [path.join(source, "src", "main", "java"), path.join(source, "build", "generated")] }))).toContain("src/main/java")
  expect(await refused(capture(source, { release: null }))).toContain("Java 版本")
  expect(await refused(capture(source, { classpath: [path.join(source, "loom-cache")] }))).toContain("不是一个文件")
  expect(await refused(capture(source, { classpath: [path.join(runtime, "gone.jar")] }))).toContain("gone.jar")
  expect(await refused(capture(source, { compilerArgs: ["-classpath"], argFileExists: [false] }))).toContain("冲突")
  expect(await refused(capture(source, { compilerArgs: [`-J${source}`], argFileExists: [false] }))).toContain("工程文件夹")
  expect(await refused(capture(path.join(runtime, "elsewhere")))).toContain("不是这一次编译的那个")
})

test("a library that was removed or replaced since it was recorded makes the record unusable", async () => {
  const runtime = await temp()
  const source = await temp()
  const jar = path.join(runtime, "lib.jar")
  await writeFile(jar, "one")
  await mkdir(path.join(source, "build"), { recursive: true })
  await writeFile(path.join(source, ...CAPTURE_FILE.split("/")), JSON.stringify(capture(source, { classpath: [jar] })))
  const learnt = await learnCapture(source, runtime, "k")
  if ("reason" in learnt) throw new Error(learnt.reason)
  const how = { run: runOwnedProcess, javac: JAVAC, env: process.env, signal: undefined }
  const record = { ...learnt.record, trusted: true, calibration: "" }
  await writeFile(jar, "two!")
  expect(await compileDirect(source, record, how)).toEqual({ reason: "lib.jar 变了" })
  await rm(jar)
  expect(await compileDirect(source, record, how)).toEqual({ reason: "lib.jar 已经不在了" })
})

// ---- javac against the stand-in classpath ----

test.skipIf(!HAS_JAVAC)("javac with a recorded list compiles the project and names the error of a bad one on its line, with the release and encoding of the record", async () => {
  const runtime = await temp()
  const source = await temp()
  const { alarm } = await project(source, "int answer() { return \"中文\"; }")
  await mkdir(path.join(source, "build"), { recursive: true })
  await writeFile(path.join(source, ...CAPTURE_FILE.split("/")), JSON.stringify(capture(source, { classpath: await jars() })))
  const learnt = await learnCapture(source, runtime, "k")
  if ("reason" in learnt) throw new Error(learnt.reason)
  const record = { ...learnt.record, trusted: true, calibration: "" }
  const how = { run: runOwnedProcess, javac: JAVAC, env: process.env, signal: undefined }
  const bad = await compileDirect(source, record, how)
  if ("reason" in bad) throw new Error(bad.reason)
  expect(bad.code).not.toBe(0)
  expect(errorSet(bad.output)).toEqual(["com/minemods/content_probe/gameplay/alarm/Alarm.java:7: incompatible types: String cannot be converted to int"])
  // The release is the record's: 21 compiles `var` and records, 8 would not.
  await writeFile(alarm, (await readFile(alarm, "utf8")).replace('return "中文";', "var x = 1; return x;"))
  expect(await compileDirect(source, record, how)).toMatchObject({ code: 0 })
  await writeFile(alarm, (await readFile(alarm, "utf8")).replace("final class Alarm", "record Pair(int a) {}\nfinal class Alarm"))
  expect(await compileDirect(source, record, how)).toMatchObject({ code: 0 })
  const old = await compileDirect(source, { ...record, release: 8 }, how)
  expect("code" in old && old.code).not.toBe(0)
  // Nothing is left in the source folder that the next check would trip over except the throwaway build folder.
  expect((await readdir(path.join(source, "build"))).sort()).toEqual(["minemods-javac", "minemods-javac.json"])
}, 120000)

// ---- the whole way: Gradle first, javac after ----

/**
 * A stand-in for the JDK (shell scripts, so not on Windows): `java` plays Gradle by writing the record the init script writes and printing
 * what Gradle prints; `javac` is the real one. `gradleSees` is what the stand-in Gradle says it gave the compiler.
 */
async function jdk(directory: string, gradleSees: { classpath: string[]; code?: number; output?: string }) {
  const javaHome = path.join(directory, "jdk")
  const log = path.join(directory, "gradle.log")
  await mkdir(path.join(javaHome, "bin"), { recursive: true })
  const written = JSON.stringify(capture("@@DIR@@", { classpath: gradleSees.classpath }))
  await writeFile(
    path.join(javaHome, "bin", "java"),
    `#!/bin/sh
if [ "$1" = "-version" ]; then echo 'openjdk version "21.0.4" 2024-07-16' >&2; exit 0; fi
echo "$@" >> '${log}'
mkdir -p build
cat > build/minemods-javac.json <<JSON
${written.replaceAll("@@DIR@@", "$PWD")}
JSON
${gradleSees.output ? `cat <<'OUT'\n${gradleSees.output}\nOUT` : "echo '> Task :compileJava'; echo 'BUILD SUCCESSFUL in 1s'"}
exit ${gradleSees.code ?? 0}
`,
  )
  await writeFile(path.join(javaHome, "bin", "javac"), `#!/bin/sh\nexec '${JAVAC}' "$@"\n`)
  await chmod(path.join(javaHome, "bin", "java"), 0o755)
  await chmod(path.join(javaHome, "bin", "javac"), 0o755)
  return { javaHome, log, runs: async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean) }
}

const setup = async (gradleSees: Parameters<typeof jdk>[1]) => {
  const directory = await temp()
  const lines: string[] = []
  const stand = await jdk(directory, gradleSees)
  const options = { templateDirectory: TEMPLATE, javaHome: stand.javaHome, runtimeDirectory: path.join(directory, "runtime"), pause: async () => undefined, onProgress: (text: string) => void lines.push(text) }
  const made = async (body?: string) => {
    const source = await temp()
    return { source, ...(await project(source, body)) }
  }
  return { directory, lines, stand, options, made, compiler: gradleCompiler(options) }
}
const key = async (source: string, setupped: Awaited<ReturnType<typeof setup>>) => setupKey(await compileInputs(source), await gradleCompiler(setupped.options).identity!())

test.skipIf(!HAS_JAVAC || process.platform === "win32")("a code check goes through Gradle once, then through javac with Gradle's own list; a version with a mistake is named by javac; a failure outside the gameplay goes back to Gradle", async () => {
  const t = await setup({ classpath: await jars() })
  const first = await t.made()
  const one = await t.compiler.run(first.source, first.gameplay)
  // Nothing was known: Gradle ran (with the init script that records what it hands javac), and its compile was repeated by javac and agreed.
  expect(one).toMatchObject({ code: 0, compiler: "gradle compileJava" })
  expect(await t.stand.runs()).toHaveLength(1)
  expect((await t.stand.runs())[0]).toContain(`--init-script ${CAPTURE_SCRIPT} compileJava`)
  expect(await readFile(path.join(first.source, CAPTURE_SCRIPT), "utf8")).toContain("minemods-javac.json")
  expect(t.lines.join("")).toContain("Direct javac agreed with Gradle (both compiled)")
  const learnt = await readRecord(t.options.runtimeDirectory, await key(first.source, t))
  expect(learnt).toMatchObject({ trusted: true, calibration: "Gradle 和 javac 都编译通过", release: 21, encoding: "UTF-8" })

  // The same build setup in a new folder: javac, with the list Gradle gave; Gradle is not started again.
  const second = await t.made()
  const two = await t.compiler.run(second.source, second.gameplay)
  expect(two).toMatchObject({ code: 0, compiler: DIRECT_COMPILER })
  expect(t.lines.join("")).toContain("> Task :compileJava (javac")
  expect(await t.stand.runs()).toHaveLength(1)

  // A mistake in the gameplay is told the way a compile tells it, by file and line.
  const wrong = await t.made('int answer() { return "no"; }')
  const three = await t.compiler.run(wrong.source, wrong.gameplay)
  expect(three.code).not.toBe(0)
  expect(three.compiler).toBe(DIRECT_COMPILER)
  expect(errorSet(three.output)).toEqual(["com/minemods/content_probe/gameplay/alarm/Alarm.java:7: incompatible types: String cannot be converted to int"])
  expect(await t.stand.runs()).toHaveLength(1)

  // A mistake only outside the gameplay's files is not given as a verdict by javac: Gradle is asked, and the disagreement (Gradle's stand-in says
  // "compiled") takes the trust back, so that the next check does not use javac either.
  const outside = await t.made()
  await writeFile(path.join(outside.source, "src", "main", "java", "com", "minemods", "content_probe", "Broken.java"), "package com.minemods.content_probe;\nclass Broken { int x() { return \"s\"; } }\n")
  const four = await t.compiler.run(outside.source, outside.gameplay)
  expect(four).toMatchObject({ code: 0, compiler: "gradle compileJava" })
  expect(await t.stand.runs()).toHaveLength(2)
  expect(t.lines.join("")).toContain("asking Gradle to confirm")
  expect(await readRecord(t.options.runtimeDirectory, await key(first.source, t))).toMatchObject({ trusted: false })
  const fifth = await t.made()
  expect(await t.compiler.run(fifth.source, fifth.gameplay)).toMatchObject({ code: 0, compiler: "gradle compileJava" })
  expect(await t.stand.runs()).toHaveLength(3)
}, 240000)

test.skipIf(!HAS_JAVAC || process.platform === "win32")("javac is not trusted when it disagrees with Gradle on the first compile: every check stays with Gradle, and is not re-learnt each time", async () => {
  // The stand-in Gradle says it gave javac libraries without Minecraft, and that the compile passed; javac then cannot compile the same files.
  const t = await setup({ classpath: (await jars()).filter((jar) => !path.basename(jar).startsWith("minecraft-")) })
  const first = await t.made()
  expect(await t.compiler.run(first.source, first.gameplay)).toMatchObject({ code: 0, compiler: "gradle compileJava" })
  expect(t.lines.join("")).toContain("Direct javac disagreed with Gradle")
  const record = await readRecord(t.options.runtimeDirectory, await key(first.source, t))
  expect(record).toMatchObject({ trusted: false })
  expect(record!.calibration).toContain("两边不一致")
  const second = await t.made()
  expect(await t.compiler.run(second.source, second.gameplay)).toMatchObject({ compiler: "gradle compileJava" })
  expect(await t.stand.runs()).toHaveLength(2)
}, 240000)

test.skipIf(!HAS_JAVAC || process.platform === "win32")("a library replaced in the cache sends the check back to Gradle, which records the new list for the next one; a Gradle that fails to name a line teaches nothing", async () => {
  const lib = path.join(await temp(), "annotations.jar")
  const annotations = (await jars()).find((jar) => /^annotations-[\d.]+\.jar$/.test(path.basename(jar)))!
  await cp(annotations, lib)
  const t = await setup({ classpath: [...(await jars()).filter((jar) => jar !== annotations), lib] })
  const first = await t.made()
  await t.compiler.run(first.source, first.gameplay)
  expect(await readRecord(t.options.runtimeDirectory, await key(first.source, t))).toMatchObject({ trusted: true })
  // The cache was cleaned and Gradle fetched the library again: same file, new time.
  await utimes(lib, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000))
  const second = await t.made()
  expect(await t.compiler.run(second.source, second.gameplay)).toMatchObject({ code: 0, compiler: "gradle compileJava" })
  expect(t.lines.join("")).toContain("Direct javac not used (annotations.jar 变了)")
  expect(await t.stand.runs()).toHaveLength(2)
  const third = await t.made()
  expect(await t.compiler.run(third.source, third.gameplay)).toMatchObject({ code: 0, compiler: DIRECT_COMPILER })
  expect(await t.stand.runs()).toHaveLength(2)

  // A Gradle that failed without a single compile error (its own trouble) records nothing.
  const broken = await setup({ classpath: await jars(), code: 1, output: "FAILURE: Build failed with an exception.\n* What went wrong: boom" })
  const fourth = await broken.made()
  expect(await broken.compiler.run(fourth.source, fourth.gameplay)).toMatchObject({ code: 1, compiler: "gradle compileJava" })
  expect(await readdir(storeOf(broken.options.runtimeDirectory)).catch(() => [])).toEqual([])
}, 240000)

test.skipIf(!HAS_JAVAC || process.platform === "win32")("the direct way lives in the runtime folder: no record, no trust, and the project folder it ran in is the caller's to remove", async () => {
  const t = await setup({ classpath: await jars() })
  const first = await t.made()
  await t.compiler.run(first.source, first.gameplay)
  const stored = await readdir(storeOf(t.options.runtimeDirectory))
  expect(stored.filter((name) => name.endsWith(".json"))).toHaveLength(1)
  expect((await stat(first.source)).isDirectory()).toBe(true)
}, 120000)

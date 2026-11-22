import { afterEach, beforeEach, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { COMPILED_KEPT, REUSED_NOTE, compileGameplayCandidate, forgetCompiled, type CodeCompiler } from "../src/gameplay-compile"
import type { GameplayDocument } from "../src/gameplay"
import { openProject, saveProject } from "../src/project"
import { BOX_GUARD, IDS, LEGACY_FILES } from "./fixtures/gameplay/sample"
import { readFile } from "node:fs/promises"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
beforeEach(forgetCompiled)
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function sampleDirectory() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-compile-cache-"))
  roots.push(root)
  const original = JSON.parse(await readFile(LEGACY_FILES.project, "utf8"))
  await cp(LEGACY_FILES.project, path.join(root, "minemods.project.json"))
  await mkdir(path.join(root, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(LEGACY_FILES.model, path.join(root, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  return root
}

/** A compiler that counts how often it was asked and answers as scripted. */
const counting = (answer: { code: number; output: string } = { code: 0, output: "" }, name = "counting") => {
  const calls: string[] = []
  const compiler: CodeCompiler = { name, run: async (directory) => (calls.push(directory), answer) }
  return { compiler, calls }
}
const check = (root: string, compiler: CodeCompiler, document: GameplayDocument = BOX_GUARD) => compileGameplayCandidate(root, { templateDirectory: TEMPLATE, candidate: { asset_id: IDS.box_guard, title: document.name, document }, compiler })

test("the same files are compiled once: a commit that changes nothing the compiler is given keeps the verdict, a change to the gameplay or to a used creature does not", async () => {
  const root = await sampleDirectory()
  const { compiler, calls } = counting()
  expect(await check(root, compiler)).toEqual({ ran: true, compile: { ok: true, findings: [], compiler: "counting", note: null } })
  expect(calls).toHaveLength(1)
  // Asked again with nothing changed: the verdict of the first compile, said to be that.
  expect(await check(root, compiler)).toEqual({ ran: true, compile: { ok: true, findings: [], compiler: "counting（沿用上次）", note: REUSED_NOTE } })
  expect(calls).toHaveLength(1)

  // A recipe is committed to the project: its revision goes up, what the compiler is given does not change.
  const before = await openProject(root)
  const recipe = { ...before.recipes[0]!, id: "77777777-7777-4777-8777-777777777777", name: "另一个配方", pattern: ["minecraft:stick", null, null, null, null, null, null, null, null], result: "legacy_sample:moon_dew" }
  const withRecipe = await saveProject(root, { ...before, recipes: [...before.recipes, recipe] }, before.revision)
  expect(withRecipe.revision).toBeGreaterThan(before.revision)
  expect(await check(root, compiler)).toMatchObject({ ran: true, compile: { ok: true, note: REUSED_NOTE } })
  expect(calls).toHaveLength(1)

  // Another version of the gameplay: compiled.
  const edited: GameplayDocument = { ...BOX_GUARD, sources: BOX_GUARD.sources.map((source, index) => (index === 0 ? { ...source, content: `${source.content}\n// another version\n` } : source)) }
  expect(await check(root, compiler, edited)).toMatchObject({ ran: true, compile: { ok: true, note: null } })
  expect(calls).toHaveLength(2)
  // And that version is kept under its own key, the first one still under its own.
  expect(await check(root, compiler, edited)).toMatchObject({ compile: { note: REUSED_NOTE } })
  expect(await check(root, compiler)).toMatchObject({ compile: { note: REUSED_NOTE } })
  expect(calls).toHaveLength(2)

  // A creature the gameplay uses gets other numbers: its generated class changes, so the compile is done again.
  const project = await openProject(root)
  await saveProject(root, { ...project, entities: project.entities.map((entity) => (entity.id === "11111111-1111-4111-8111-111111111111" ? { ...entity, health: entity.health + 10 } : entity)) }, project.revision)
  expect(await check(root, compiler)).toMatchObject({ ran: true, compile: { ok: true, note: null } })
  expect(calls).toHaveLength(3)
})

test("a verdict is kept for a failing compile too, and not for a compiler that could not run", async () => {
  const root = await sampleDirectory()
  const failing = counting({ code: 1, output: `${"x"}/src/main/java/com/minemods/content_legacy_sample/StudioContentRegistry.java:20: error: ItemGroups has private access in ItemGroups\n1 error\n` })
  const first = await check(root, failing.compiler)
  expect(first).toMatchObject({ ran: true, compile: { ok: false, findings: [], note: expect.stringContaining("工程里别的代码编译不过") } })
  expect(await check(root, failing.compiler)).toMatchObject({ ran: true, compile: { ok: false, compiler: "counting（沿用上次）", note: first.ran ? first.compile.note : null } })
  expect(failing.calls).toHaveLength(1)

  // The tool itself broke (no network, no Java): nothing was learnt about the code, so nothing is kept, and asking again tries again.
  const broken = { calls: 0, compiler: { name: "broken", run: async () => (broken.calls++, { code: 1, output: "BUILD FAILED\nCould not resolve net.fabricmc:fabric-loom." }) } }
  expect(await check(root, broken.compiler)).toMatchObject({ ran: false })
  expect(await check(root, broken.compiler)).toMatchObject({ ran: false })
  expect(broken.calls).toBe(2)
  const refused = { calls: 0, compiler: { name: "refuses", run: async () => (refused.calls++, Promise.reject(new Error("JAVA_RUNTIME_MISSING"))) } }
  await check(root, refused.compiler)
  await check(root, refused.compiler)
  expect(refused.calls).toBe(2)
})

test("a verdict belongs to the compiler that gave it: another JDK or runtime folder (its identity) or another compiler is compiled again, and the compiler named on a reused verdict fits the record", async () => {
  const root = await sampleDirectory()
  const a = counting()
  const withIdentity = (identity: string): CodeCompiler => ({ ...a.compiler, identity: async () => identity })
  await check(root, withIdentity("jdk-1"))
  await check(root, withIdentity("jdk-1"))
  expect(a.calls).toHaveLength(1)
  await check(root, withIdentity("jdk-2"))
  expect(a.calls).toHaveLength(2)
  await check(root, counting().compiler)
  // Same name, no identity: not the same compiler as the one that did state an identity.
  expect(a.calls).toHaveLength(2)
  // The record keeps the compiler as at most 80 characters; a long name with the mark must still fit.
  const long = counting({ code: 0, output: "" }, "x".repeat(80))
  await check(root, long.compiler)
  const again = await check(root, long.compiler)
  expect(again.ran && again.compile.compiler.length).toBeLessThanOrEqual(80)
  expect(again.ran && again.compile.compiler.endsWith("（沿用上次）")).toBe(true)
})

test("which way a compiler took is the compiler of the verdict, and is what a reused verdict repeats", async () => {
  const root = await sampleDirectory()
  const calls: number[] = []
  const compiler: CodeCompiler = { name: "gradle compileJava", run: async () => (calls.push(1), { code: 0, output: "", compiler: "javac（沿用 Gradle 解析出的同一份类路径）" }) }
  expect(await check(root, compiler)).toMatchObject({ compile: { compiler: "javac（沿用 Gradle 解析出的同一份类路径）" } })
  expect(await check(root, compiler)).toMatchObject({ compile: { compiler: "javac（沿用 Gradle 解析出的同一份类路径）（沿用上次）" } })
  expect(calls).toHaveLength(1)
})

test("only the most recent verdicts are kept", async () => {
  const root = await sampleDirectory()
  const { compiler, calls } = counting()
  const version = (n: number): GameplayDocument => ({ ...BOX_GUARD, sources: BOX_GUARD.sources.map((source, index) => (index === 0 ? { ...source, content: `${source.content}\n// v${n}\n` } : source)) })
  await check(root, compiler, version(0))
  for (let n = 1; n <= COMPILED_KEPT; n++) await check(root, compiler, version(n))
  expect(calls).toHaveLength(COMPILED_KEPT + 1)
  // The newest are still there; the first, which went out to make room, is compiled again.
  await check(root, compiler, version(COMPILED_KEPT))
  expect(calls).toHaveLength(COMPILED_KEPT + 1)
  await check(root, compiler, version(0))
  expect(calls).toHaveLength(COMPILED_KEPT + 2)
}, 120000)

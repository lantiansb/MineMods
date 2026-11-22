import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createEntity, createProject, openProject, saveProject } from "../src/project"
import { putModelAsset } from "../src/assets"
import { designToBlockbench } from "../src/blockbench"
import { mushroomCowDesign } from "../src/example"
import { assembleBuildSource, buildProjectFiles, exportProjectSource, gradleCompiler } from "../src/build"
import { BUILD_NETWORK_FAILED, CHECK_NETWORK_WORDS, GRADLE_NETWORK } from "../src/gradle-network"
import { HANDSHAKE } from "./fixtures/gradle-output"

const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))
const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-build-"))
  roots.push(directory)
  const projectDirectory = path.join(directory, "中文 project's assets")
  const initial = await createProject({ directory: projectDirectory, name: "Forest Creatures" })
  const entity = createEntity({ name: "蘑菇牛", behavior: "follow" })
  const project = await saveProject(projectDirectory, { ...initial, entities: [entity] }, initial.revision)
  await putModelAsset(projectDirectory, {
    entity_id: entity.id,
    expectedRevision: project.revision,
    origin: "example",
    data: { design: mushroomCowDesign, provenance: { origin: "example" } },
  })
  return { directory, projectDirectory }
}

test("source export assembles complete locked source, generated entity and editable backup", async () => {
  const input = await fixture()
  const destination = path.join(input.directory, "source export's 中文")
  expect(await exportProjectSource(input.projectDirectory, destination, templateDirectory)).toBe(destination)
  const metadata = JSON.parse(await readFile(path.join(destination, "src/main/resources/fabric.mod.json"), "utf8"))
  expect(metadata.entrypoints.main).toEqual(["com.minemods.content_forest_creatures.StudioContent"])
  expect(metadata.entrypoints.client).toEqual(["com.minemods.content_forest_creatures.client.StudioClient"])
  expect(metadata.depends.minecraft).toBe("1.21.1")
  expect(
    await readFile(
      path.join(destination, "src/main/java/com/minemods/content_forest_creatures/StudioContent.java"),
      "utf8",
    ),
  ).toContain("class StudioContent")
  expect((await readFile(path.join(destination, "gradle/wrapper/gradle-wrapper.jar"))).byteLength).toBeGreaterThan(1000)
  expect(await openProject(path.join(destination, "project-backup"))).toEqual(await openProject(input.projectDirectory))
  expect(await readFile(path.join(destination, "README-STUDIO.md"), "utf8")).toContain("example")
  expect(await readFile(path.join(destination, "README-STUDIO.md"), "utf8")).toContain("4.8.3")
})

test("source export refuses an existing destination without changing its files", async () => {
  const input = await fixture()
  const sentinel = path.join(input.directory, "keep.txt")
  await writeFile(sentinel, "preserved")
  await expect(exportProjectSource(input.projectDirectory, input.directory, templateDirectory)).rejects.toThrow()
  expect(await readFile(sentinel, "utf8")).toBe("preserved")
})

test("build cancellation cannot create a successful record and preserves the project", async () => {
  const input = await fixture()
  const before = await openProject(input.projectDirectory)
  const cancel = new AbortController()
  cancel.abort()
  await expect(
    buildProjectFiles(input.projectDirectory, {
      templateDirectory,
      runtimeDirectory: path.join(input.directory, "runtime"),
      signal: cancel.signal,
    }),
  ).rejects.toThrow("CANCELLED")
  expect(await openProject(input.projectDirectory)).toEqual(before)
  expect(await readdir(path.join(input.projectDirectory, ".minemods", "builds")).catch(() => [])).toEqual([])
})

test("source assembly permits a zero-entity content project", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-empty-build-"))
  roots.push(directory)
  const project = await createProject({ directory, name: "铜灯", mod_id: "copper_aviary" })
  const saved = await saveProject(directory, {
    ...project,
    blocks: [{
      id: "11111111-1111-4111-8111-111111111111",
      identifier: "copper_lamp",
      name: "铜纹灯",
      hardness: 1.5,
      luminance: 12,
      tool: "pickaxe",
      drop: "self",
      color: "#c77a45",
    }],
  }, project.revision)
  const source = path.join(directory, "empty-content-source")
  await assembleBuildSource(directory, source, templateDirectory)
  expect(await readFile(path.join(source, "src/main/resources/assets/copper_aviary/blockstates/copper_lamp.json"), "utf8")).toContain("copper_lamp")
  expect(await readFile(path.join(source, "src/main/resources/data/copper_aviary/loot_table/blocks/copper_lamp.json"), "utf8")).toContain("copper_lamp")
  expect(await readFile(path.join(source, "src/main/java/com/minemods/content_copper_aviary/StudioContent.java"), "utf8")).toContain("StudioContentRegistry.register()")
  expect(saved.revision).toBe(1)
})

test("source assembly names the entity missing a model instead of rejecting the project shape", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-missing-model-build-"))
  roots.push(directory)
  const project = await createProject({ directory, name: "缺模型" })
  const entity = createEntity({ name: "铜鸮" })
  await saveProject(directory, { ...project, entities: [entity] }, project.revision)
  await expect(assembleBuildSource(directory, path.join(directory, "source"), templateDirectory)).rejects.toThrow(entity.id)
})

test("source assembly compiles every modeled entity and calls shared content registration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-multi-entity-build-"))
  roots.push(directory)
  const initial = await createProject({ directory, name: "双鸮", mod_id: "copper_aviary" })
  const first = createEntity({ name: "铜鸮" })
  const second = createEntity({ name: "银鸮" })
  const project = await saveProject(directory, { ...initial, entities: [first, second] }, initial.revision)
  const firstSaved = await putModelAsset(directory, { entity_id: first.id, expectedRevision: project.revision, origin: "example", data: { design: mushroomCowDesign } })
  const secondSaved = await putModelAsset(directory, { entity_id: second.id, expectedRevision: firstSaved.project.revision, origin: "example", data: { design: mushroomCowDesign } })
  const source = path.join(directory, "multi-content-source")
  const result = await assembleBuildSource(directory, source, templateDirectory)
  const packageRoot = "src/main/java/com/minemods/content_copper_aviary"
  expect(await readFile(path.join(source, `src/main/resources/assets/copper_aviary/geo/creature_${first.id.replaceAll("-", "")}.geo.json`), "utf8")).toContain("minecraft:geometry")
  expect(await readFile(path.join(source, `src/main/resources/assets/copper_aviary/geo/creature_${second.id.replaceAll("-", "")}.geo.json`), "utf8")).toContain("minecraft:geometry")
  expect(await readFile(path.join(source, `${packageRoot}/StudioContent.java`), "utf8")).toContain("StudioContentRegistry.register()")
  expect(result.entityIds).toEqual([`creature_${first.id.replaceAll("-", "")}`, `creature_${second.id.replaceAll("-", "")}`])
})

test("source assembly uses the saved Blockbench atlas and cube UVs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-editable-model-build-"))
  roots.push(directory)
  const initial = await createProject({ directory, name: "可编辑铜鸮" })
  const entity = createEntity({ name: "铜鸮" })
  const project = await saveProject(directory, { ...initial, entities: [entity] }, initial.revision)
  const blockbench = structuredClone(designToBlockbench(mushroomCowDesign))
  blockbench.elements![0]!.faces.north!.uv = [7, 8, 17, 15]
  const saved = await putModelAsset(directory, {
    entity_id: entity.id,
    expectedRevision: project.revision,
    origin: "manual",
    data: { design: mushroomCowDesign, blockbench },
  })
  const source = path.join(directory, "editable-content-source")
  await assembleBuildSource(directory, source, templateDirectory)
  const geometry = JSON.parse(await readFile(path.join(source, `src/main/resources/assets/${saved.project.mod_id}/geo/creature_${entity.id.replaceAll("-", "")}.geo.json`), "utf8"))
  expect(geometry["minecraft:geometry"][0].bones[0].cubes[0].uv.north).toEqual({ uv: [7, 8], uv_size: [10, 7] })
  expect(await readFile(path.join(source, `src/main/resources/assets/${saved.project.mod_id}/textures/entity/creature_${entity.id.replaceAll("-", "")}.png`))).toEqual(Buffer.from((blockbench.textures![0] as { source: string }).source.split(",")[1]!, "base64"))
})

test("runs a real local Gradle assemble for a block and reversible recipe", async () => {
  const repoRoot = path.resolve(templateDirectory, "../..")
  const javaHome = path.join(repoRoot, ".artifacts", "toolchains", "temurin21", "jdk-21.0.12.1+1")
  const gradleHome = path.join(repoRoot, ".artifacts", "toolchains", "gradle-home")
  if (!existsSync(path.join(javaHome, "bin", "java.exe")) || !existsSync(gradleHome)) return
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-content-gradle-"))
  roots.push(directory)
  const project = await createProject({ directory, name: "铜灯", mod_id: "copper_aviary" })
  const saved = await saveProject(directory, {
    ...project,
    blocks: [{
      id: "11111111-1111-4111-8111-111111111111",
      identifier: "copper_lamp",
      name: "铜纹灯",
      hardness: 1.5,
      luminance: 12,
      tool: "pickaxe",
      drop: "self",
      color: "#c77a45",
    }],
    recipes: [{
      id: "33333333-3333-4333-8333-333333333333",
      name: "铜纹灯",
      pattern: [
        "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot",
        "minecraft:copper_ingot", "minecraft:redstone", "minecraft:copper_ingot",
        "minecraft:copper_ingot", "minecraft:copper_ingot", "minecraft:copper_ingot",
      ],
      result: "copper_aviary:copper_lamp",
      count: 1,
    }],
  }, project.revision)
  expect(saved.revision).toBe(1)
  const source = path.join(directory, "source")
  await assembleBuildSource(directory, source, templateDirectory)
  const gradle = Bun.spawn(["cmd.exe", "/d", "/s", "/c", "gradlew.bat assemble --no-daemon"], {
    cwd: source,
    env: { ...process.env, JAVA_HOME: javaHome, GRADLE_USER_HOME: gradleHome },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(gradle.stdout).text(), new Response(gradle.stderr).text()])
  expect(await gradle.exited, `${stdout}\n${stderr}`).toBe(0)
  expect(await readFile(path.join(source, "build/classes/java/main/com/minemods/content_copper_aviary/StudioContentRegistry.class"))).toBeTruthy()
  const jar = path.join(source, "build/libs/copper_aviary-0.1.0.jar")
  const listingProcess = Bun.spawn([path.join(javaHome, "bin", "jar.exe"), "tf", jar], { stdout: "pipe", stderr: "pipe" })
  const listing = (await new Response(listingProcess.stdout).text()).split(/\r?\n/)
  expect([
    "assets/copper_aviary/lang/zh_cn.json",
    "assets/copper_aviary/lang/en_us.json",
    "data/copper_aviary/recipe/33333333-3333-4333-8333-333333333333.json",
    "data/copper_aviary/loot_table/blocks/copper_lamp.json",
    "data/minecraft/tags/block/mineable/pickaxe.json",
  ].every((entry) => listing.includes(entry))).toBe(true)
  expect(JSON.parse(await readFile(path.join(source, "src/main/resources/assets/copper_aviary/lang/zh_cn.json"), "utf8"))["block.copper_aviary.copper_lamp"]).toBe("铜纹灯")
}, 120_000)

test("a failed runtime preserves prior project assets and isolated source snapshots", async () => {
  const input = await fixture()
  const before = await openProject(input.projectDirectory)
  await expect(
    buildProjectFiles(input.projectDirectory, {
      templateDirectory,
      javaHome: path.join(input.directory, "missing-java"),
      runtimeDirectory: path.join(input.directory, "runtime"),
    }),
  ).rejects.toThrow()
  expect(await openProject(input.projectDirectory)).toEqual(before)
  const snapshots = await readdir(path.join(input.projectDirectory, "generated"))
  expect(snapshots).toHaveLength(1)
  expect(await openProject(path.join(input.projectDirectory, "generated", snapshots[0], "project-backup"))).toEqual(
    before,
  )
  expect(await readdir(path.join(input.projectDirectory, ".minemods", "builds")).catch(() => [])).toEqual([])
})

// The whole path with a stand-in for Java (a shell script, so not on Windows): the controlled command line, the retries, and what the build and the code check each end with.
test.skipIf(process.platform === "win32")("a build whose downloads keep failing ends as BUILD_NETWORK_FAILED after the retries, with Gradle's own timeouts on the command line", async () => {
  const input = await fixture()
  const javaHome = path.join(input.directory, "java")
  const log = path.join(input.directory, "gradle.log")
  await mkdir(path.join(javaHome, "bin"), { recursive: true })
  await writeFile(path.join(javaHome, "bin", "java"), `#!/bin/sh\nif [ "$1" = "-version" ]; then echo 'openjdk version "21.0.4" 2024-07-16' >&2; exit 0; fi\necho "$@" >> '${log}'\ncat <<'OUT'\n${HANDSHAKE}OUT\nexit 1\n`)
  await chmod(path.join(javaHome, "bin", "java"), 0o755)
  const options = { templateDirectory, javaHome, runtimeDirectory: path.join(input.directory, "runtime"), pause: async () => undefined }
  const retried: number[] = []

  await expect(buildProjectFiles(input.projectDirectory, { ...options, onRetry: (attempt) => void retried.push(attempt) })).rejects.toThrow(BUILD_NETWORK_FAILED)
  expect(retried).toEqual([1, 2, 3])
  const runs = (await readFile(log, "utf8")).trim().split("\n")
  expect(runs).toHaveLength(GRADLE_NETWORK.retries + 1)
  expect(runs.every((line) => line.endsWith(" build") && line.includes("-Dorg.gradle.internal.http.socketTimeout=60000") && line.includes("-Dorg.gradle.internal.repository.max.retries=5"))).toBe(true)
  // The code check through the same entry: it did not run, and says so in the words for a check.
  const snapshot = path.join(input.projectDirectory, "generated", (await readdir(path.join(input.projectDirectory, "generated")))[0]!)
  await expect(gradleCompiler(options).run(snapshot, "")).rejects.toThrow(CHECK_NETWORK_WORDS)
}, 60_000)

test("exports saved projects whose technical names are single characters or Java keywords", async () => {
  for (const name of ["A", "New", "Class", "Default"]) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "studio-java-name-"))
    roots.push(directory)
    const projectDirectory = path.join(directory, "project")
    const initial = await createProject({ directory: projectDirectory, name })
    const entity = createEntity({ name: "Cow" })
    const saved = await saveProject(projectDirectory, { ...initial, entities: [entity] }, initial.revision)
    await putModelAsset(projectDirectory, {
      entity_id: entity.id,
      expectedRevision: saved.revision,
      origin: "example",
      data: { design: mushroomCowDesign },
    })
    const destination = await exportProjectSource(projectDirectory, path.join(directory, "source"), templateDirectory)
    const metadata = JSON.parse(await readFile(path.join(destination, "src/main/resources/fabric.mod.json"), "utf8"))
    // Fabric Loader refuses a mod id of one character (the game would not start), so a one-letter name gets a longer id.
    const id = name.length === 1 ? `mod_${name.toLowerCase()}` : name.toLowerCase()
    expect(metadata.id).toBe(id)
    expect(metadata.entrypoints.main).toEqual([`com.minemods.content_${id}.StudioContent`])
    expect(
      await readFile(
        path.join(destination, `src/main/java/com/minemods/content_${id}/StudioContent.java`),
        "utf8",
      ),
    ).toContain(`package com.minemods.content_${id};`)
  }
})

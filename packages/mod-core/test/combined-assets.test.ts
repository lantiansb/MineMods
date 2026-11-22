import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { createCombinedSample, EMBER_ID } from "../script/target-combined-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/**
 * The asset kinds and boss features that were made apart (sounds, particles and weapon trails, a boss's own bar, combos,
 * hits with a warning) in one creature of one project: the build writes all of them together, the whole tree compiles
 * against Fabric 1.21.1 in Mojang's names, and the same project builds and compiles for Forge 1.20.1 and NeoForge 1.21.1 too.
 */

const OFFICIAL = "fabric-1.21.1-official"
const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function combined(target?: "forge-1.20.1" | "neoforge-1.21.1") {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-combined-"))
  roots.push(root)
  const directory = path.join(root, "project")
  await createCombinedSample(directory, target)
  return { root, directory }
}

test.skipIf(!hasTargetJavac(OFFICIAL))("sounds, particles, a weapon trail, a boss's own bar, a combo and a warned hit together: built and compiled on Fabric 1.21.1 (Mojang's names)", async () => {
  const made = await combined()
  const source = path.join(made.root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(made.directory, source, TEMPLATE)
  const pkg = path.join(source, "src/main/java", ...built.packageName.split("."))
  const creature = await readFile(path.join(pkg, "entity", "StudioCreature.java"), "utf8")
  // Each feature's own part of the creature is there.
  expect(creature).toContain("StudioSounds.SOUND_GOLEM_ROAR")
  expect(creature).toContain(`abilityOwnParticles("${EMBER_ID}"`)
  expect(creature).toContain("public static final StudioTrailSpec[] TRAILS = {")
  expect(built.soundFiles.length).toBeGreaterThan(0)
  expect(built.bossBarFiles.length).toBe(6)
  expect(built.warnFiles.length).toBeGreaterThan(0)
  const resources = path.join(source, "src/main/resources/assets", built.project.mod_id)
  expect(JSON.parse(await readFile(path.join(resources, "sounds.json"), "utf8"))).toHaveProperty("golem_roar")
  expect(JSON.parse(await readFile(path.join(resources, "particles/ember.json"), "utf8")).textures).toHaveLength(2)
  const classes = path.join(made.root, "classes")
  const compiled = (await compileTreeFor(OFFICIAL, source, classes))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
  // Every feature's classes were compiled with the creature that uses them.
  const classFiles = (await readdir(classes, { recursive: true })).map((name) => String(name).replaceAll("\\", "/"))
  for (const name of [...built.soundFiles.filter((file) => file.endsWith(".class")), ...built.bossBarFiles, ...built.warnFiles, ...built.bossFiles, `${built.packageName.replaceAll(".", "/")}/entity/StudioCreature.class`]) expect(classFiles).toContain(name)
}, 300000)

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test.skipIf(!hasTargetJavac(target))(`the same project on ${target}: nothing stops it (A 组, E 组 and B2 are ported); every feature is written through the facade and the whole tree compiles`, async () => {
    const made = await combined(target)
    const source = path.join(made.root, `source-${target}`)
    await mkdir(source)
    const built = await assembleBuildSource(made.directory, source, TEMPLATE, { target })
    expect(built.target.manifest.id).toBe(target)
    const pkg = path.join(source, "src/main/java", ...built.packageName.split("."))
    const creature = await readFile(path.join(pkg, "entity", "StudioCreature.java"), "utf8")
    // Each feature's own part of the creature is there, as on Fabric.
    expect(creature).toContain("StudioSounds.SOUND_GOLEM_ROAR")
    expect(creature).toContain(`abilityOwnParticles("${EMBER_ID}"`)
    expect(creature).toContain("public static final StudioTrailSpec[] TRAILS = {")
    expect(built.soundFiles.length).toBeGreaterThan(0)
    // A facade target has no mixin for the boss bars: the loader's event draws them.
    expect(built.bossBarFiles.length).toBe(5)
    expect(built.warnFiles.length).toBeGreaterThan(0)
    // The common and client entries run each feature's register(): the warning's, the particles' and the boss bar's.
    const content = await readFile(path.join(pkg, "StudioContent.java"), "utf8")
    for (const name of ["entity.StudioParticleSetup", "entity.StudioWarn", "entity.StudioBossBarSync"]) expect(content).toContain(`${built.packageName}.${name}.register();`)
    const client = await readFile(path.join(pkg, "client", "StudioClient.java"), "utf8")
    for (const name of ["client.StudioParticleClient", "client.StudioWarnClient", "client.StudioBossBarClient"]) expect(client).toContain(`${built.packageName}.${name}.register();`)
    const resources = path.join(source, "src/main/resources/assets", built.project.mod_id)
    expect(JSON.parse(await readFile(path.join(resources, "sounds.json"), "utf8"))).toHaveProperty("golem_roar")
    expect(JSON.parse(await readFile(path.join(resources, "particles/ember.json"), "utf8")).textures).toHaveLength(2)
    const compiled = (await compileTreeFor(target, source))!
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 300000)
}

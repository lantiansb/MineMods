import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { addEntryCalls, assembleBuildSource } from "../src/build-source"
import { BuildStop } from "../src/build-stop"
import { compileContent } from "../src/content"
import { compileBossRuntime } from "../src/fabric/boss-runtime"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"
import { assertPorted, unportedFeatures } from "../src/platform/ported"
import { openProject, saveProject } from "../src/project"
import { encodePng } from "../src/png"
import { WorkspaceAssetSchema } from "../src/workspace"
import { EXTRAS_SAMPLE, createTargetExtrasSample } from "../script/target-extras-sample"
import type { TargetId } from "../src/target/ids"
import { createTargetBossSample } from "../script/target-boss-sample"
import { createTargetAbilitySample } from "../script/target-ability-sample"
import { createTargetBodySample } from "../script/target-body-sample"
import { createTargetSliceSample } from "../script/target-slice-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * The platform layer's vertical slice (平台层-移植清单.md) on Forge 1.20.1 and NeoForge 1.21.1: the files a build
 * writes for each, that the common layer names no loader, and that the whole tree compiles against the target's real
 * class path. The real Gradle builds and dedicated servers are `script/target-slice-check.ts`.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function slice(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-slice-"))
  roots.push(root)
  const project = await createTargetSliceSample(path.join(root, "赤岩山谷"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "赤岩山谷"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  const read = (name: string) => readFile(path.join(source, name), "utf8")
  return { root, project, source, built, names, read }
}

const LOADER_API = /^import net\.(minecraftforge|neoforged|fabricmc)\./m
/** One white pixel, a particle's frame. */
const PIXEL = `data:image/png;base64,${Buffer.from(encodePng(new Uint8Array([255, 255, 255, 255]), 1, 1)).toString("base64")}`

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  const forge = target === "forge-1.20.1"
  test(`${target}: the slice is generated through the facade, its data in the version's folders, and compiles against the real class path`, async () => {
    const { project, built, names, read, source } = await slice(target)
    const pkg = "src/main/java/com/minemods/content_red_valley"
    const data = "src/main/resources/data/red_valley"
    expect(built.target.manifest.id).toBe(target)
    // The loader's metadata from the toolchain's template, not Fabric's.
    expect(names).toContain(forge ? "src/main/resources/META-INF/mods.toml" : "src/main/resources/META-INF/neoforge.mods.toml")
    expect(names).not.toContain("src/main/resources/fabric.mod.json")
    expect(names).toContain(`${pkg}/platform/StudioPlatform.java`)
    expect(names).toContain(`${pkg}/platform/StudioClientPlatform.java`)
    // The template's main class is replaced by one that runs the common layer and hands the facade to the loader.
    const main = await read(`${pkg}/RedValleyMod.java`)
    expect(main).toContain("StudioContent.register();")
    expect(main).toContain("StudioPlatform.init(")
    // Only the facade and the main class name the loader; the common layer never does.
    const java = names.filter((name) => name.endsWith(".java"))
    const loaderNamed = (await Promise.all(java.map(async (name) => ((LOADER_API.test(await read(name)) ? [name] : []))))).flat()
    expect(loaderNamed.sort()).toEqual([`${pkg}/RedValleyMod.java`, `${pkg}/platform/StudioClientPlatform.java`, `${pkg}/platform/StudioPlatform.java`])
    // Two creatures: their registration through the facade, called in order from StudioContent, drawn from StudioClient.
    const entry = await read(`${pkg}/StudioContent.java`)
    expect(entry).toContain("StudioContentRegistry.register();")
    expect(entry.match(/StudioContentEntity\d_\w+\.register\(\);/g)).toHaveLength(2)
    expect((await read(`${pkg}/client/StudioClient.java`)).match(/StudioClientEntity\d_\w+\.register\(\);/g)).toHaveLength(2)
    const [golem, grazer] = project.entities.map((entity) => `creature_${entity.id.replaceAll("-", "")}`)
    const golemContent = await read(names.find((name) => /StudioContentEntity1_\w+\.java$/.test(name))!)
    expect(golemContent).toContain(`StudioPlatform.entity("${golem}",`)
    expect(golemContent).toContain(`StudioPlatform.spawnEgg("${golem}_spawn_egg", CREATURE,`)
    expect(golemContent).toContain("StudioPlatform.addToTab(CreativeModeTabs.SPAWN_EGGS, SPAWN_EGG);")
    expect(golemContent).toContain("StudioPlatform.spawnRule(CREATURE, (type, world, reason, pos, random) -> world.getDifficulty() != Difficulty.PEACEFUL && Monster.isDarkEnoughToSpawn(world, pos, random) && Mob.checkMobSpawnRules(type, world, reason, pos, random));")
    // Natural spawns as the loader's biome modifiers: the golem's biomes and its group apart, the grazer's group.
    const modifiers = names.filter((name) => name.includes("/biome_modifier/")).sort()
    expect(modifiers).toEqual([`${data}/${forge ? "forge" : "neoforge"}/biome_modifier/${golem}_spawns_1.json`, `${data}/${forge ? "forge" : "neoforge"}/biome_modifier/${golem}_spawns_2.json`, `${data}/${forge ? "forge" : "neoforge"}/biome_modifier/${grazer}_spawns.json`].sort())
    expect(JSON.parse(await read(`${data}/${forge ? "forge" : "neoforge"}/biome_modifier/${grazer}_spawns.json`))).toEqual({ type: forge ? "forge:add_spawns" : "neoforge:add_spawns", biomes: "#minecraft:is_forest", spawners: { type: `red_valley:${grazer}`, weight: 8, minCount: 2, maxCount: 3 } })
    // Data in the version's folders and form.
    const recipe = names.find((name) => name.startsWith(`${data}/${forge ? "recipes" : "recipe"}/`))!
    expect(JSON.parse(await read(recipe)).result).toEqual(forge ? { item: "red_valley:red_rock", count: 1 } : { id: "red_valley:red_rock", count: 1 })
    const loot = JSON.parse(await read(`${data}/${forge ? "loot_tables" : "loot_table"}/entities/${golem}.json`))
    expect(loot.pools[0].entries[0].functions[1].function).toBe(forge ? "minecraft:looting_enchant" : "minecraft:enchanted_count_increase")
    expect(names).toContain(`${data}/${forge ? "loot_tables" : "loot_table"}/blocks/red_rock.json`)
    expect(names).toContain(`src/main/resources/data/minecraft/tags/${forge ? "blocks" : "block"}/mineable/pickaxe.json`)
    // GeckoLib's packages of the target's line.
    const creature = await read(names.find((name) => /entity\/StudioCreatureEntity1_\w+\.java$/.test(name))!)
    expect(creature).toContain(forge ? "import software.bernie.geckolib.core.animation.AnimationController;" : "import software.bernie.geckolib.animation.AnimationController;")
    expect(creature.includes("getAgeScale")).toBe(!forge)
    // Both languages, and nothing of Fabric's Mod Menu.
    const english = JSON.parse(await read("src/main/resources/assets/red_valley/lang/en_us.json"))
    expect(english).toMatchObject({ [`entity.red_valley.${golem}`]: "Red Rock Golem", [`item.red_valley.${golem}_spawn_egg`]: "Red Rock Golem Spawn Egg", "block.red_valley.red_rock": "Red Rock", "item.red_valley.red_shard": "Red Shard" })
    expect(JSON.parse(await read("src/main/resources/assets/red_valley/lang/zh_cn.json"))[`entity.red_valley.${grazer}`]).toBe("绒角兽")
    expect(Object.keys(english).some((key) => key.startsWith("modmenu."))).toBe(false)
    expect(JSON.parse(await read("minemods-build.json"))).toMatchObject({ target, profile: { id: target } })
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output).not.toMatch(/error|warning/)
    expect(compiled.code).toBe(0)
  }, 120000)
}

test("the same project builds for Fabric 1.21.1 by Fabric's own text when its target is Fabric", async () => {
  const { names, read, source } = await slice("fabric-1.21.1")
  expect(names).toContain("src/main/resources/fabric.mod.json")
  expect(names.some((name) => name.includes("/platform/"))).toBe(false)
  expect(await read("src/main/java/com/minemods/content_red_valley/StudioContent.java")).toContain("implements ModInitializer")
  if (!hasTargetJavac(CLASSPATH["fabric-1.21.1"])) return
  const compiled = await targetJavac(CLASSPATH["fabric-1.21.1"], path.join(source, "src", "main", "java"))
  expect(compiled.code).toBe(0)
}, 120000)

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: every feature group is ported, so nothing stops a build (a particle asset and a lure here); Fabric generates everything`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-slice-ported-"))
    roots.push(root)
    const directory = path.join(root, "project")
    const project = await createTargetSliceSample(directory, target)
    // A particle asset (A 组) and a lure (creature-extras): the last two groups ported.
    const now = new Date().toISOString()
    const ember = WorkspaceAssetSchema.parse({ id: crypto.randomUUID(), module: "particle", title: "余烬", revision: 1, created_at: now, updated_at: now, prompt: "余烬", dependencies: [], document: { kind: "particle", name: "ember", frames: [PIXEL], frames_by: "age", lifetime: 1, gravity: 0, size: { start: 0.2, end: 0.05 }, color: { start: "#ffcc66", end: "#ff3300" }, opacity: { start: 1, end: 0 }, emissive: true, spin: 0 }, provenance: { model: null, request_id: null }, status: "ready" })
    const lured = { ...project.entities[1]!, behavior: "follow" as const, tempt: ["minecraft:wheat"] }
    await saveProject(directory, { ...project, entities: [project.entities[0]!, lured], workspace: { assets: [...project.workspace.assets, ember] } }, project.revision)
    const opened = await openProject(directory)
    for (const id of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
      expect(unportedFeatures(opened, genTarget(id))).toEqual([])
      expect(() => assertPorted(opened, genTarget(id))).not.toThrow()
    }
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(directory, source, TEMPLATE)
    expect(built.target.manifest.id).toBe(target)
    expect((await readdir(path.join(source, "src/main/resources/assets/red_valley/particles")))).toEqual(["ember.json"])
    // Blocks and items (E 组) are ported: a food is generated for a facade target.
    const fed = { ...project.items[0]!, food: { hunger: 4, saturation: 0.3 } }
    expect(Object.keys(compileContent({ mod_id: "m", package_name: "a.b", items: [{ ...fed, identifier: "x" }] }, genTarget(target)))).toContain("src/main/java/a/b/StudioContentRegistry.java")
  }, 120000)
}

test("sounds, particles, weapon trails and a boss's own bar are wired on every loader: no target stops a build for them", () => {
  const project = {
    entities: [
      { name: "蚩尤", abilities: [{ id: "swing", events: [{ type: "trail", at: 0.5, until: 0.75, bone: "arm" }] }], combos: [{ id: "triple" }], boss: { bar: { look: { asset: "bar-id" } } } },
      { name: "铜人", boss: { bar: { look: "vanilla" } } },
    ],
    blocks: [],
    items: [],
    workspace: { assets: [{ document: { kind: "sound" } }, { document: { kind: "particle" } }, { document: { kind: "bossbar" } }, { document: { kind: "effect" } }] },
  }
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    // Sounds (E 组), a boss's own bar (B2), and the abilities, combos, effects, particles and weapon trails (A 组) are ported.
    expect(unportedFeatures(project, genTarget(target))).toEqual([])
    expect(() => assertPorted(project, genTarget(target))).not.toThrow()
  }
  // A project with none of them is not stopped for them.
  expect(unportedFeatures({ entities: [], blocks: [], items: [], workspace: { assets: [] } }, genTarget("forge-1.20.1"))).toEqual([])
})

test("flight, habits, collision boxes with parts and a big body (parts that follow bones, a step height, a way out when stuck) are ported: no target stops for them", () => {
  const core = { width: 3, height: 6, step: 1.5 }
  const part = { name: "颈", forward: 2, up: 4, left: 0, width: 1.5, height: 1.5, bone: "neck" }
  const project = { entities: [{ name: "巨龙", flight: { style: "soar" }, habits: { active: "day" }, hitbox: { core, parts: [part], stuck: { seconds: 3, squeeze: true } } }], blocks: [], items: [], workspace: { assets: [] } }
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    expect(unportedFeatures(project, genTarget(target))).toEqual([])
    expect(() => assertPorted(project, genTarget(target))).not.toThrow()
  }
})

// The creature's own variants beyond the slice project, compiled on both targets: what else of a creature is already
// generated right by the shared class (the goals of every behaviour, rules, sounds, glow, engagement, a population cap).
const clip = (name: string, length: number) => ({ name, length, loop: name === "idle" || name === "walk", channels: [{ bone: "root", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] })
const face = "#cc9966"
const model = (...extra: [string, number][]) => ({
  name: "Creature",
  texture_size: 64,
  bones: [{ name: "root", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "body", origin: [-2, 0, -2], size: [4, 8, 4], faces: { north: face, east: face, south: face, west: face, up: face, down: face } }] }],
  animations: [clip("idle", 1), clip("walk", 1), clip("hurt", 0.4), ...extra.map(([name, length]) => clip(name, length))],
})
const plain = { modId: "variant_mod", packageName: "com.minemods.content_variant_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: model() }
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const logic = (trigger: string, action: string, extra: Record<string, string> = {}) => ({ id: crypto.randomUUID(), entity_id: crypto.randomUUID(), trigger, action, enabled: true, ...extra })
const VARIANTS = {
  hostileGoals: { ...plain, model: model(["attack", 0.5], ["death", 2]) },
  passive: { ...plain, behavior: "passive" as const, stationary: { reason: "它长在地上" }, glow: true },
  follower: { ...plain, behavior: "follow" as const, logic: [logic("player_near", "look"), logic("hurt", "play_animation", { animation: "hurt" })] },
  engaged: { ...plain, engagement: "provoked" as const, sounds: { ambient: "entity.zombie.ambient", hurt: "entity.zombie.hurt", death: null, step: "entity.zombie.step", pitch: 1, volume: 1 } },
  capped: { ...plain, runtime: { ...runtime, movement: "strafe" as const, spawn: { biomes: ["minecraft:plains"], weight: 10, min: 1, max: 2, light: "any", above_sea: 4, cap: { count: 3, radius: 24 } } } },
}

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: the creature's variants beyond the slice compile against the real class path`, async () => {
    if (!hasTargetJavac(CLASSPATH[target])) return
    for (const [name, input] of Object.entries(VARIANTS)) {
      const files = compileEntity(input, genTarget(target))
      const root = await mkdtemp(path.join(os.tmpdir(), `minemods-variant-${name}-`))
      roots.push(root)
      // The facade it calls, and the entry the client side of the facade runs.
      const target_ = genTarget(target)
      const all: Record<string, string | Uint8Array> = {
        ...files,
        ...target_.loader.platformFiles({ modId: plain.modId, packageName: plain.packageName, version: target_.version }),
        "src/main/java/com/minemods/content_variant_mod/client/StudioClient.java": "package com.minemods.content_variant_mod.client;\npublic final class StudioClient { public static void register() {} }\n",
      }
      await Promise.all(
        Object.entries(all)
          .filter(([file]) => file.endsWith(".java"))
          .map(async ([file, text]) => {
            await mkdir(path.dirname(path.join(root, file)), { recursive: true })
            await writeFile(path.join(root, file), String(text))
          }),
      )
      const compiled = await targetJavac(CLASSPATH[target], path.join(root, "src", "main", "java"))
      expect({ name, output: compiled.output.split("\n").filter((line) => /error/.test(line)) }).toEqual({ name, output: [] })
      expect(compiled.code).toBe(0)
    }
  }, 180000)
}

// ---- B 组: the boss runtime and lairs (平台层-移植清单.md) ----

/** The boss sample (`script/target-boss-sample.ts`) as a build writes it for a target. */
async function bossSample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-boss-target-"))
  roots.push(root)
  const project = await createTargetBossSample(path.join(root, "石魔山口"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "石魔山口"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  const forge = target === "forge-1.20.1"
  test(`${target}: bosses (bar, phases, wake-up, death, leash) and a lair are generated through the facade and the whole tree compiles`, async () => {
    const { project, built, names, read, source } = await bossSample(target)
    const pkg = "src/main/java/com/minemods/content_stone_pass"
    const data = "src/main/resources/data/stone_pass"
    expect(built.target.manifest.id).toBe(target)
    const [keeper, sleeper] = project.entities.map((entity) => `creature_${entity.id.replaceAll("-", "")}`)
    // The lair: one class for the mod, registered through the facade from the keeper's content class; its structure files in the folders both versions read.
    const lair = await read(`${pkg}/StudioLair.java`)
    expect(lair).toContain('StudioPlatform.register(Registries.STRUCTURE_PIECE, "lair",')
    expect(lair).toContain('StudioPlatform.register(Registries.STRUCTURE_TYPE, "lair",')
    expect(lair).toContain(forge ? "StructureType<StudioLair> lair = () -> CODEC.codec();" : "StructureType<StudioLair> lair = () -> CODEC;")
    expect(lair).toContain(forge ? "mob.finalizeSpawn(world, difficulty, MobSpawnType.STRUCTURE, null, null);" : "mob.finalizeSpawn(world, difficulty, MobSpawnType.STRUCTURE, null);")
    expect(lair).not.toContain("Registry.register(")
    const keeperContent = await read(names.find((name) => /StudioContentEntity1_\w+\.java$/.test(name))!)
    expect(keeperContent).toContain("        StudioLair.register();\n")
    expect(await read(names.find((name) => /StudioContentEntity2_\w+\.java$/.test(name))!)).not.toContain("StudioLair")
    expect(JSON.parse(await read(`${data}/worldgen/structure/${keeper}_lair.json`))).toMatchObject({ type: "stone_pass:lair", creature: `stone_pass:${keeper}`, biomes: `#stone_pass:${keeper}_lair` })
    expect(JSON.parse(await read(`${data}/worldgen/structure_set/${keeper}_lair.json`)).structures).toEqual([{ structure: `stone_pass:${keeper}_lair`, weight: 1 }])
    expect(JSON.parse(await read(`${data}/tags/worldgen/biome/${keeper}_lair.json`))).toEqual({ values: ["minecraft:plains", "#minecraft:is_mountain"] })
    // The boss's class: the version's synced value and experience; nothing of the loader.
    const keeperClass = await read(names.find((name) => /entity\/StudioCreatureEntity1_\w+\.java$/.test(name))!)
    expect(keeperClass).toContain("new ServerBossEvent(getDisplayName(), BossEvent.BossBarColor.PURPLE, BossEvent.BossBarOverlay.NOTCHED_10)")
    expect(keeperClass).toContain(
      forge
        ? "    @Override protected void defineSynchedData() {\n        super.defineSynchedData();\n        this.entityData.define(BOSS, BOSS_START);\n    }"
        : "    @Override protected void defineSynchedData(SynchedEntityData.Builder builder) {\n        super.defineSynchedData(builder);\n        builder.define(BOSS, BOSS_START);\n    }",
    )
    expect(keeperClass).toContain(forge ? "@Override protected void dropExperience() {" : "@Override protected void dropExperience(Entity attacker) {")
    expect(keeperClass).toContain(forge ? "bossXp = getExperienceReward();" : "bossXp = getExperienceReward(serverWorld, attacker);")
    expect(await read(names.find((name) => /entity\/StudioCreatureEntity2_\w+\.java$/.test(name))!)).toContain("private static final double BOSS_WAKE_DISTANCE = 12.0;")
    expect(names.some((name) => name.endsWith(`/${sleeper}_lair.json`))).toBe(false)
    const java = names.filter((name) => name.endsWith(".java"))
    const loaderNamed = (await Promise.all(java.map(async (name) => ((LOADER_API.test(await read(name)) ? [name] : []))))).flat()
    expect(loaderNamed.sort()).toEqual([`${pkg}/StonePassMod.java`, `${pkg}/platform/StudioClientPlatform.java`, `${pkg}/platform/StudioPlatform.java`])
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output).not.toMatch(/error|warning/)
    expect(compiled.code).toBe(0)
  }, 180000)

  test(`${target}: the screen shake and the pieces of the ground go through the facade, are run from the entries, and compile`, async () => {
    const genned = genTarget(target)
    const packageName = "com.minemods.content_variant_mod"
    const pkg = "src/main/java/com/minemods/content_variant_mod"
    const made = compileBossRuntime({ modId: plain.modId, packageName, shake: true, debris: true }, genned)
    expect(Object.keys(made.files).sort()).toEqual([`${pkg}/client/StudioShakeClient.java`, `${pkg}/entity/StudioDebris.java`, `${pkg}/entity/StudioShake.java`, `${pkg}/mixin/StudioShakeCameraMixin.java`])
    expect(Object.values(made.files).some((text) => LOADER_API.test(text))).toBe(false)
    expect(made.files[`${pkg}/entity/StudioShake.java`]).toContain('StudioPlatform.s2c("studio_shake", Shake.class, Shake::write, Shake::read)')
    expect(made.files[`${pkg}/client/StudioShakeClient.java`]).toContain("StudioClientPlatform.onS2C(StudioShake.CHANNEL,")
    expect(made.files[`${pkg}/mixin/StudioShakeCameraMixin.java`]).toContain(forge ? "move(double ahead, double up, double left)" : "move(float ahead, float up, float left)")
    expect(made.classes).toContain("com/minemods/content_variant_mod/mixin/StudioShakeCameraMixin.class")
    // The mixin goes in the client section of the template's list; there is no fabric.mod.json to edit.
    const mixins = await readFile(fileURLToPath(new URL(`../../../templates/${target}/src/main/resources/{{mod_id}}.mixins.json`, import.meta.url)), "utf8")
    expect(Object.keys(made.patch)).toEqual([`src/main/resources/${plain.modId}.mixins.json`])
    expect(JSON.parse(made.patch[`src/main/resources/${plain.modId}.mixins.json`]!(mixins))).toMatchObject({ mixins: [], client: ["StudioShakeCameraMixin"] })
    // The entries make the channel and set up the receiver, whichever wrote the entries.
    const boss = { bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ below: 0.5, clip: null, seconds: 0.5, bar_color: null, speed: 1.2, damage: 1.2 }], death: { seconds: 2, xp_bursts: 3, explosion: true }, leash: { distance: 32, reset_seconds: 30 } }
    const files: Record<string, string | Uint8Array> = { ...compileEntity({ ...plain, model: model(["death", 2]), boss }, genned), ...made.files, ...genned.loader.platformFiles({ modId: plain.modId, packageName, version: genned.version }) }
    addEntryCalls(files, packageName, made.entries)
    expect(String(files[`${pkg}/StudioContent.java`])).toContain(`public static void register() {\n        ${packageName}.entity.StudioShake.register();`)
    expect(String(files[`${pkg}/client/StudioClient.java`])).toContain(`public static void register() {\n        ${packageName}.client.StudioShakeClient.register();`)
    expect(() => addEntryCalls({}, packageName, made.entries)).toThrow("FACADE_ENTRY_MISSING")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-boss-runtime-"))
    roots.push(root)
    await Promise.all(
      Object.entries(files)
        .filter(([file]) => file.endsWith(".java"))
        .map(async ([file, text]) => {
          await mkdir(path.dirname(path.join(root, file)), { recursive: true })
          await writeFile(path.join(root, file), String(text))
        }),
    )
    const compiled = await targetJavac(CLASSPATH[target], path.join(root, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)
}

// ---- C 组: flight, habits, collision boxes with parts, a big body (平台层-移植清单.md) ----

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  const forge = target === "forge-1.20.1"
  test(`${target}: a flying boss, a creature with habits and the six-armed giant (parts that follow its hands, a step, a way out when stuck) go through the facade and the whole tree compiles`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-body-target-"))
    roots.push(root)
    const project = await createTargetBodySample(path.join(root, "云端巨像"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(path.join(root, "云端巨像"), source, TEMPLATE)
    expect(built.target.manifest.id).toBe(target)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    const read = (name: string) => readFile(path.join(source, name), "utf8")
    const pkg = "src/main/java/com/minemods/content_sky_giants"
    const content = (index: number) => read(names.find((name) => new RegExp(`/StudioContentEntity${index}_\\w+\\.java$`).test(name))!)
    const creature = (index: number) => read(names.find((name) => new RegExp(`entity/StudioCreatureEntity${index}_\\w+\\.java$`).test(name))!)
    // The parts: one type for the mod, registered through the facade by the common entry and drawn as nothing from the client entry; no fabric.mod.json to edit.
    expect(names).not.toContain("src/main/resources/fabric.mod.json")
    expect(await read(`${pkg}/entity/StudioParts.java`)).toContain('public static final Supplier<EntityType<StudioPart>> TYPE = StudioPlatform.entity("studio_part",')
    expect(await read(`${pkg}/client/StudioPartClient.java`)).toContain("StudioClientPlatform.renderer(StudioParts.TYPE, NoopRenderer::new);")
    expect(await read(`${pkg}/StudioContent.java`)).toContain("public static void register() {\n        com.minemods.content_sky_giants.entity.StudioParts.register();")
    expect(await read(`${pkg}/client/StudioClient.java`)).toContain("public static void register() {\n        com.minemods.content_sky_giants.client.StudioPartClient.register();")
    // The part entity in the version's members: it follows a bone and leans with a flier on both.
    const part = await read(`${pkg}/entity/StudioPart.java`)
    expect(part).toContain("new StudioPart(StudioParts.TYPE.get(), owner.level())")
    expect(part).toContain("default float[] hitboxMoved(int index) { return null; }")
    expect(part).toContain("default double[] hitboxLeaned(double forward, double up, double left)")
    expect(part.includes("getAddEntityPacket() { return new net.minecraft.network.protocol.game.ClientboundAddEntityPacket(this); }")).toBe(forge)
    expect(part).toContain(forge ? "@Override public boolean canChangeDimensions() { return false; }" : "@Override public boolean canUsePortal(boolean allowVehicles) { return false; }")
    expect(part).toContain(forge ? "@Override public boolean ignoreExplosion() { return true; }" : "@Override public boolean ignoreExplosion(Explosion explosion) { return true; }")
    expect(part).toContain(forge ? "if (size.width != row[3] * scale || size.height != row[4] * scale) {" : "if (size.width() != row[3] * scale || size.height() != row[4] * scale) {")
    expect(part).toContain(forge ? "this.entityData.define(MOVED_FORWARD, 0.0f);" : "builder.define(MOVED_FORWARD, 0.0f);")
    expect(JSON.parse(await read("src/main/resources/assets/sky_giants/lang/zh_cn.json"))["entity.sky_giants.studio_part"]).toBe("身体部位")
    // The flier: its eyes (the type's in 1.21.1, the class's in 1.20.1), its position every tick, its renderer's lean in the GeckoLib line's hook.
    expect(await content(1)).toContain(`.sized(1.4000f, 2.6000f)${forge ? "" : ".eyeHeight(2.2000f)"}.clientTrackingRange(8).updateInterval(1).build(`)
    const flier = await creature(1)
    expect(flier.includes("getStandingEyeHeight(net.minecraft.world.entity.Pose pose, net.minecraft.world.entity.EntityDimensions dimensions) { return dimensions.height * (2.2000f / 2.6000f); }")).toBe(forge)
    expect(flier).toContain("FLIGHT_TAKEOFF_TICKS")
    const renderer = await read(names.find((name) => /client\/StudioCreatureRendererEntity1_\w+\.java$/.test(name))!)
    expect(renderer).toContain(forge ? "float rotationYaw, float partialTick) {\n        super.applyRotations(creature, poseStack, ageInTicks, rotationYaw, partialTick);" : "float partialTick, float nativeScale) {")
    // The creature with habits: its home and its rest, saved.
    expect(await creature(2)).toContain('nbt.putBoolean("HabitHomeSet", habitHomeSet);')
    // The giant: its step where the version takes it, the table its hands follow, the goal that gets it unstuck.
    const giant = await creature(3)
    expect(giant.includes(".add(Attributes.STEP_HEIGHT, 2.5)")).toBe(!forge)
    expect(giant.includes("super(type, world); setMaxUpStep(2.5f); }")).toBe(forge)
    for (const piece of ["@Override public float[] hitboxMoved(int index) {", "hitboxPose();", "goalSelector.addGoal(0, new StuckGoal());", "private static final boolean STUCK_SQUEEZE = true;"]) expect(giant).toContain(piece)
    expect(project.entities.map((entity) => entity.name)).toEqual(["飞天石魔", "巢居兽", "六臂巨人"])
    const java = names.filter((name) => name.endsWith(".java"))
    const loaderNamed = (await Promise.all(java.map(async (name) => ((LOADER_API.test(await read(name)) ? [name] : []))))).flat()
    expect(loaderNamed.sort()).toEqual([`${pkg}/SkyGiantsMod.java`, `${pkg}/platform/StudioClientPlatform.java`, `${pkg}/platform/StudioPlatform.java`])
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output).not.toMatch(/error|warning/)
    expect(compiled.code).toBe(0)
  }, 180000)
}

// ---- B2: a boss's own bar (平台层-移植清单.md, Boss 能力 6) ----

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a boss's own bar is sent through the facade's channel, drawn on the loader's boss bar event, and the whole tree compiles`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-bossbar-target-"))
    roots.push(root)
    const project = await createTargetBossSample(path.join(root, "石魔山口"), target, { bar: true })
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(path.join(root, "石魔山口"), source, TEMPLATE)
    const read = (name: string) => readFile(path.join(source, name), "utf8")
    const pkg = "src/main/java/com/minemods/content_stone_pass"
    const keeper = `creature_${project.entities[0]!.id.replaceAll("-", "")}`
    const cls = "com/minemods/content_stone_pass"
    // The state, the masks and the HUD, the packet and its client side; no mixin (the loader has an event for the boss bars).
    expect(built.bossBarFiles).toEqual([`${cls}/entity/StudioBossBarState.class`, `${cls}/entity/StudioBossBars.class`, `${cls}/client/StudioBossBarHud.class`, `${cls}/entity/StudioBossBarSync.class`, `${cls}/client/StudioBossBarClient.class`])
    const sync = await read(`${pkg}/entity/StudioBossBarSync.java`)
    expect(sync).toContain('StudioPlatform.s2c("studio_boss_bar", Bar.class, Bar::write, Bar::read)')
    expect(sync).toContain("for (ServerPlayer player : players) CHANNEL.sendTo(player, bar);")
    const client = await read(`${pkg}/client/StudioBossBarClient.java`)
    for (const line of ["StudioClientPlatform.onS2C(StudioBossBarSync.CHANNEL,", "StudioClientPlatform.onBossBar(StudioBossBarClient::draw);", "StudioClientPlatform.onReload(StudioBossBarHud::clear);"]) expect(client).toContain(line)
    // Run from the entries.
    expect(await read(`${pkg}/StudioContent.java`)).toContain("public static void register() {\n        com.minemods.content_stone_pass.entity.StudioBossBarSync.register();")
    expect(await read(`${pkg}/client/StudioClient.java`)).toContain("public static void register() {\n        com.minemods.content_stone_pass.client.StudioBossBarClient.register();")
    // The HUD in the version's names; the boss sends its state to the players of its bar.
    const hud = await read(`${pkg}/client/StudioBossBarHud.java`)
    expect(hud).toContain(target === "forge-1.20.1" ? 'new ResourceLocation(NAMESPACE, "studio/bossbar/" + creature + ".json")' : 'ResourceLocation.fromNamespaceAndPath(NAMESPACE, "studio/bossbar/" + creature + ".json")')
    const keeperClass = await read((await readdir(path.join(source, pkg, "entity"))).filter((name) => /^StudioCreatureEntity1_\w+\.java$/.test(name)).map((name) => `${pkg}/entity/${name}`)[0]!)
    expect(keeperClass).toContain(`StudioBossBarSync.send(bossBar.getPlayers(), bossBar.getId(), "${keeper}", state);`)
    expect(await read((await readdir(path.join(source, pkg, "entity"))).filter((name) => /^StudioCreatureEntity2_\w+\.java$/.test(name)).map((name) => `${pkg}/entity/${name}`)[0]!)).not.toContain("StudioBossBar")
    expect(JSON.parse(await read(`src/main/resources/assets/stone_pass/studio/bossbar/${keeper}.json`)).names).toHaveLength(3)
    // Only the facade and the main class name the loader.
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".java")).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    const loaderNamed = (await Promise.all(names.map(async (name) => ((LOADER_API.test(await read(name)) ? [name] : []))))).flat()
    expect(loaderNamed.sort()).toEqual([`${pkg}/StonePassMod.java`, `${pkg}/platform/StudioClientPlatform.java`, `${pkg}/platform/StudioPlatform.java`])
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)
}

/** The abilities sample (`script/target-ability-sample.ts`, A 组) as a build writes it for a target. */
async function abilitySample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-ability-target-"))
  roots.push(root)
  const project = await createTargetAbilitySample(path.join(root, "雷鸣石窟"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "雷鸣石窟"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  return { project, source, built, names, read: (name: string) => readFile(path.join(source, name), "utf8") }
}

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  const forge = target === "forge-1.20.1"
  test(`${target}: abilities, warned hits, a combo, effects, particles of the project's own and a weapon trail are generated through the facade and the whole tree compiles`, async () => {
    const { built, names, read, source } = await abilitySample(target)
    const pkg = "src/main/java/com/minemods/content_thunder_cave"
    expect(built.target.manifest.id).toBe(target)
    // The common and client entries run the warning's, the effects' and the particles' register() before the creatures'.
    const content = await read(`${pkg}/StudioContent.java`)
    for (const name of ["entity.StudioParticleSetup", "entity.StudioWarn", "entity.StudioEffects"]) expect(content).toContain(`        com.minemods.content_thunder_cave.${name}.register();\n`)
    const client = await read(`${pkg}/client/StudioClient.java`)
    for (const name of ["StudioParticleClient", "StudioWarnClient", "StudioEffectClient"]) expect(client).toContain(`        com.minemods.content_thunder_cave.client.${name}.register();\n`)
    // The warning's packet goes on a channel of the facade; its drawing is set up through the client facade.
    expect(await read(`${pkg}/entity/StudioWarn.java`)).toContain('StudioPlatform.s2c("studio_warn", Warn.class, Warn::write, Warn::read)')
    expect(await read(`${pkg}/client/StudioWarnClient.java`)).toContain("StudioClientPlatform.onS2C(StudioWarn.CHANNEL, payload -> {")
    // The effects' one entity type and its renderer through the facade, with what the version writes otherwise.
    const effects = await read(`${pkg}/entity/StudioEffects.java`)
    expect(effects).toContain('public static final Supplier<EntityType<StudioEffect>> TYPE = StudioPlatform.entity("studio_effect",')
    expect(effects).toContain("new StudioEffect(TYPE.get(), world)")
    expect(effects).toContain(forge ? "ClipContext.Fluid.NONE, (Entity) null)" : "ClipContext.Fluid.NONE, CollisionContext.empty())")
    // The effect entity extends the game's Entity itself: its members are C 组's plainEntity for the version.
    const effect = await read(`${pkg}/entity/StudioEffect.java`)
    expect(effect).toContain(forge ? "@Override public boolean canChangeDimensions() { return false; }" : "@Override public boolean canUsePortal(boolean allowVehicles) { return false; }")
    expect(effect).toContain(forge ? "@Override public boolean ignoreExplosion() { return true; }" : "@Override public boolean ignoreExplosion(Explosion explosion) { return true; }")
    expect(effect.includes("getAddEntityPacket() { return new net.minecraft.network.protocol.game.ClientboundAddEntityPacket(this); }")).toBe(forge)
    const effectRenderer = await read(`${pkg}/client/StudioEffectRenderer.java`)
    expect(effectRenderer).toContain(forge ? "float rotationYaw, float partialTick) {" : "float rotationYaw, float partialTick, float nativeScale) {")
    expect(effectRenderer).toContain(forge ? "import software.bernie.geckolib.core.object.Color;" : "import software.bernie.geckolib.util.Color;")
    // The particles: registered through the facade, given their providers through the client facade.
    expect(await read(`${pkg}/entity/StudioParticleSetup.java`)).toContain("StudioPlatform.register(Registries.PARTICLE_TYPE, StudioParticles.NAMES[spec], () -> StudioParticles.TYPES[spec]);")
    expect(await read(`${pkg}/client/StudioParticleClient.java`)).toContain("StudioClientPlatform.<SimpleParticleType>particle(() -> StudioParticles.TYPES[spec], sprites -> new StudioParticle.Provider(sprites, spec));")
    // The trail: drawn by the renderer of the creature that has it, with the hooks of the version's GeckoLib; the other creature's renderer is what it was.
    const thunderRenderer = await read(names.find((name) => /client\/StudioCreatureRendererEntity1_\w+\.java$/.test(name))!)
    expect(thunderRenderer).toContain(forge ? "int packedLight, int packedOverlay, float red, float green, float blue, float alpha) {" : "int packedLight, int packedOverlay, int colour) {")
    expect(thunderRenderer).toContain("trails.frame(creature, creature.studioAbilityShown(), model, partialTick, poseStack, bufferSource);")
    expect(await read(names.find((name) => /client\/StudioCreatureRendererEntity2_\w+\.java$/.test(name))!)).not.toContain("StudioTrails")
    expect(await read(`${pkg}/client/StudioTrails.java`)).toContain(forge ? "out.vertex(pose, x, y, z).color(red, green, blue, alpha).endVertex();" : "out.addVertex(pose, x, y, z).setColor(red, green, blue, alpha);")
    // The thrower's shots in the version's own constructors.
    const thrower = await read(names.find((name) => /entity\/StudioCreatureEntity2_\w+\.java$/.test(name))!)
    expect(thrower).toContain(forge ? "new Arrow(level(), this)" : "new Arrow(level(), this, new ItemStack(Items.ARROW), null)")
    expect(thrower).toContain(forge ? "new SmallFireball(level(), this, aim.x, aim.y, aim.z)" : "new SmallFireball(level(), this, aim)")
    // Nothing but the facade and the main class names the loader.
    const java = names.filter((name) => name.endsWith(".java"))
    const loaderNamed = (await Promise.all(java.map(async (name) => ((LOADER_API.test(await read(name)) ? [name] : []))))).flat()
    expect(loaderNamed.sort()).toEqual([`${pkg}/ThunderCaveMod.java`, `${pkg}/platform/StudioClientPlatform.java`, `${pkg}/platform/StudioPlatform.java`])
    expect(names).toContain("src/main/resources/assets/thunder_cave/particles/ember.json")
    expect(names).not.toContain("src/main/resources/fabric.mod.json")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output).not.toMatch(/error|warning/)
    expect(compiled.code).toBe(0)
  }, 180000)

  test(`${target}: an ability naming a vanilla particle or sound the version lacks is said in plain words${forge ? "" : " (none: 1.21.1 has them all)"}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-ability-version-"))
    roots.push(root)
    const directory = path.join(root, "project")
    const project = await createTargetAbilitySample(directory, target)
    const [thunder, ...rest] = project.entities
    const added = [
      { type: "particle" as const, at: 1, particle: "gust" as const, count: 4, forward: 1, up: 1, left: 0, spread: 0.5 },
      { type: "sound" as const, at: 1, sound: "entity.breeze.shoot", volume: 1, pitch: 1 },
    ]
    const gusty = { ...thunder!, abilities: thunder!.abilities!.map((ability, index) => (index === 1 ? { ...ability, events: [...ability.events, ...added] } : ability)) }
    await saveProject(directory, { ...project, entities: [gusty, ...rest] }, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    const made = await assembleBuildSource(directory, source, TEMPLATE).catch((error: unknown) => error)
    if (!forge) {
      expect(made).not.toBeInstanceOf(Error)
      return
    }
    expect(made).toBeInstanceOf(BuildStop)
    expect((made as BuildStop).rule).toBe("ability_version")
    expect((made as Error).message).toContain("「雷鸣傀儡」的招式「晶刺喷射」用了原版的「阵风」粒子（gust），Minecraft 1.20.1 里还没有这个粒子。")
    expect((made as Error).message).toContain("「雷鸣傀儡」的招式「晶刺喷射」用了原版的「旋风人发射」声音（entity.breeze.shoot），Minecraft 1.20.1 里还没有这个声音。")
  }, 120000)
}

// ---- creature-extras: a follower's lures, a creature that explodes, a death drop of a lucky cache (平台层-移植清单.md, E2) ----

test("lures, an explosion and a death drop are ported: no target stops for them", () => {
  const project = {
    entities: [{ name: "糖角羊", tempt: ["minecraft:carrot"] }, { name: "火药菇", runtime: { explosion: { fuse_ticks: 30 } } }, { name: "宝箱怪", runtime: { death_drop: { block_identifier: "lucky_box", chance: 1 } } }],
    blocks: [],
    items: [],
    workspace: { assets: [] },
  }
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    expect(unportedFeatures(project, genTarget(target))).toEqual([])
    expect(() => assertPorted(project, genTarget(target))).not.toThrow()
  }
})

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  const forge = target === "forge-1.20.1"
  test(`${target}: followers with lures, creatures that explode and one that drops a lucky cache go through the facade and the whole tree compiles`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-extras-target-"))
    roots.push(root)
    await createTargetExtrasSample(path.join(root, "糖角牧场"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(path.join(root, "糖角牧场"), source, TEMPLATE)
    expect(built.target.manifest.id).toBe(target)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    const read = (name: string) => readFile(path.join(source, name), "utf8")
    const pkg = "src/main/java/com/minemods/content_sugar_ranch"
    const creature = (index: number) => read(names.find((name) => new RegExp(`entity/StudioCreatureEntity${index}_\\w+\\.java$`).test(name))!)
    const rl = (namespace: string, item: string) => (forge ? `new ResourceLocation("${namespace}", "${item}")` : `ResourceLocation.fromNamespaceAndPath("${namespace}", "${item}")`)
    // The follower without a runtime: the game's TemptGoal; 1.20.1's takes an Ingredient of the lures that are in the game (no goal when none is), 1.21.1's the predicate.
    const goat = await creature(1)
    expect(goat).toContain(`LURES = java.util.Set.of(${rl("minecraft", "carrot")}, ${rl("sugar_ranch", "sugar_lump")});`)
    if (forge) {
      expect(goat).toContain("net.minecraft.world.item.crafting.Ingredient lures = net.minecraft.world.item.crafting.Ingredient.of(LURES.stream().map(BuiltInRegistries.ITEM::get).map(ItemStack::new).filter(stack -> !stack.isEmpty()));")
      expect(goat).toContain("if (!lures.isEmpty()) goalSelector.addGoal(1, new TemptGoal(this, 1.2, lures, false));")
      expect(goat).not.toContain("::isLure")
    } else expect(goat).toMatch(/goalSelector\.addGoal\(1, new TemptGoal\(this, 1\.2, StudioCreatureEntity1_\w+::isLure, false\)\);/)
    // The follower with a runtime: no TemptGoal; its own goal checks the same lures.
    const runner = await creature(2)
    expect(runner).not.toContain("new TemptGoal(")
    expect(runner).toContain("(isLure(player.getMainHandItem()) || isLure(player.getOffhandItem()))")
    // The creeper: its fuse, its explosion (blocks broken: the mob's interaction), its effects as the version takes them.
    const shroom = await creature(3)
    expect(shroom).toContain(`private static final int RUNTIME_FUSE_TICKS = ${EXTRAS_SAMPLE.explosion.fuse_ticks};`)
    expect(shroom).toContain("level().explode(this, getX(), getY(), getZ(), 3f,\n            false, Level.ExplosionInteraction.MOB);")
    expect(shroom).toContain(`BuiltInRegistries.MOB_EFFECT.${forge ? "getOptional" : "getHolder"}(${rl("minecraft", "slowness")}).orElseThrow(),\n                200, 1));`)
    expect(shroom).not.toContain(forge ? "getHolder(" : "getOptional(")
    expect(await creature(5)).toContain("Level.ExplosionInteraction.NONE")
    // The mimic: the lucky cache when a player kills it, not by an explosion; the cache itself is the blocks' (E 组).
    const mimic = await creature(4)
    expect(mimic).toContain("@Override protected void dropFromLootTable(DamageSource source, boolean causedByPlayer) {")
    expect(mimic).toContain(`spawnAtLocation(new ItemStack(BuiltInRegistries.ITEM.get(${rl("sugar_ranch", EXTRAS_SAMPLE.cache)}), 1));`)
    expect(names).toContain(`${pkg}/StudioLuckyCaches.java`)
    // Nothing of the loader outside the facade and the main class.
    const java = names.filter((name) => name.endsWith(".java"))
    const loaderNamed = (await Promise.all(java.map(async (name) => ((LOADER_API.test(await read(name)) ? [name] : []))))).flat()
    expect(loaderNamed.sort()).toEqual([`${pkg}/SugarRanchMod.java`, `${pkg}/platform/StudioClientPlatform.java`, `${pkg}/platform/StudioPlatform.java`])
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 180000)
}

test("1.20.1's lures are rewritten only where the generator wrote them; 1.21.1 changes nothing", () => {
  const version = genTarget("forge-1.20.1").version
  expect(version.creatureExtras("class A {}", "A")).toBe("class A {}")
  expect(() => version.creatureExtras("        goalSelector.addGoal(2, new TemptGoal(this, 1.0, A::isLure, true));", "A")).toThrow("TEMPT_GOAL_UNPLACED:A")
  const text = "A::isLure BuiltInRegistries.MOB_EFFECT.getHolder("
  expect(genTarget("neoforge-1.21.1").version.creatureExtras(text, "A")).toBe(text)
})

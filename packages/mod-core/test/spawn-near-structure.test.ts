import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { CREATURE_LIFE_INSTRUCTIONS, CREATURE_LIFE_SUMMARY, SPAWN_NEAR_INSTRUCTIONS, creatureStructureIssues, creatureWords, lairOwner, structureFindings } from "../src/creature-life"
import { BossSchema, EntityRuntimeSchema, EntitySchema, GarrisonSchema, NEAR_LIMITS, SpawnNearSchema, VANILLA_STRUCTURE_IDS } from "../src/entity-runtime"
import { compileEntity, structureName } from "../src/fabric/entity"
import { LAIR_CLASS, lairClass, lairData } from "../src/fabric/lair"
import { genTarget } from "../src/platform/target"
import { createEntity, createProject, saveProject, type Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { HAS_GAME_DATA, vanillaFiles } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * r29 修补乙 第 1 件: a creature kept to a structure. `spawn.near`: its natural spawn only within some blocks of a structure (a lair of this project, a vanilla structure,
 * another mod's); `garrison`: some of it put on a boss's lair as the world makes it, kept, never put back. The samples are a temple's skeleton guards and a wolf pack by
 * the villages, not a boss of the stories.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const VILLAGES = ["minecraft:village_plains", "minecraft:village_desert", "minecraft:village_savanna", "minecraft:village_snowy", "minecraft:village_taiga"]
const lair = { biomes: [] as string[], tags: ["is_overworld"], spacing: 40, radius: 9, floor: ["minecraft:stone_bricks", "minecraft:cracked_stone_bricks"], rim: "minecraft:chiseled_stone_bricks", clearance: 6 }
const keeper = () => BossSchema.parse({ bar: { color: "white", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 2, xp_bursts: 2, explosion: false }, leash: null, lair })
const runtime = (spawn: unknown, garrison?: unknown) => EntityRuntimeSchema.parse({ spawn, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null, ...(garrison === undefined ? {} : { garrison }) })
const spawnOf = (near?: unknown) => ({ biomes: [], tags: ["is_overworld"], weight: 10, min: 1, max: 2, ...(near === undefined ? {} : { near }) })

/** The temple project: its keeper (a boss with a lair), the skeleton guards on the lair and by it, and the wolves by the villages. */
async function templeProject(directory: string, target: TargetId = "fabric-1.21.1") {
  const created = await createProject({ directory, name: "石殿", description: "石殿守灵和它的骷髅卫兵，村庄边上的狼群。", mod_id: "stone_temple", target })
  const boss = EntitySchema.parse({ ...createEntity({ name: "石殿守灵", health: 120, speed: 0.22, attack_damage: 6, behavior: "hostile" }), name_en: "Temple Keeper", boss: keeper(), runtime: runtime(null) })
  const guard = EntitySchema.parse({ ...createEntity({ name: "骷髅卫兵", health: 24, speed: 0.25, attack_damage: 3, behavior: "hostile" }), name_en: "Skeleton Guard", runtime: runtime(spawnOf({ structures: [{ lair: boss.id }], distance: 16 }), { structure: { lair: boss.id }, min: 3, max: 4 }) })
  const wolf = EntitySchema.parse({ ...createEntity({ name: "灰狼", health: 16, speed: 0.3, attack_damage: 3, behavior: "hostile" }), name_en: "Grey Wolf", runtime: runtime(spawnOf({ structures: VILLAGES, distance: 24 })) })
  let project = await saveProject(directory, { ...created, entities: [boss, guard, wolf] }, created.revision)
  for (const entity of [boss, guard, wolf]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
  return { project, boss, guard, wolf }
}

// ---- the document ----

test("near and garrison are bounded, name structures the game has or a lair, and are absent from every older document", () => {
  const near = (value: unknown) => SpawnNearSchema.safeParse(value).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(near({ structures: VILLAGES, distance: 24 })).toBe("")
  expect(near({ structures: [{ lair: "11111111-1111-4111-8111-111111111111" }], distance: 0 })).toBe("")
  expect(near({ structures: ["other_mod:tower"], distance: NEAR_LIMITS.distance.max })).toBe("")
  expect(near({ structures: ["minecraft:village"], distance: 8 })).toContain("Minecraft 1.21.1 里没有 minecraft:village 这个结构")
  expect(near({ structures: ["village_plains"], distance: 8 })).toContain("命名空间:名字")
  expect(near({ structures: [], distance: 8 })).not.toBe("")
  expect(near({ structures: Array.from({ length: NEAR_LIMITS.structures + 1 }, (_, index) => `other_mod:s${index}`), distance: 8 })).not.toBe("")
  expect(near({ structures: VILLAGES, distance: NEAR_LIMITS.distance.max + 1 })).not.toBe("")
  expect(near({ structures: VILLAGES, distance: -1 })).not.toBe("")
  expect(near({ structures: [{ asset: "11111111-1111-4111-8111-111111111111" }], distance: 8 })).not.toBe("")
  // The same structure twice is said.
  expect(EntityRuntimeSchema.shape.spawn.unwrap().safeParse(spawnOf({ structures: ["minecraft:igloo", "minecraft:igloo"], distance: 8 })).error?.issues[0]?.message).toBe("同一个结构不要重复写")
  const garrison = (value: unknown) => GarrisonSchema.safeParse(value).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(garrison({ structure: { lair: "11111111-1111-4111-8111-111111111111" }, min: 3, max: 4 })).toBe("")
  expect(garrison({ structure: { lair: "11111111-1111-4111-8111-111111111111" }, min: 4, max: 3 })).toContain("不能比最少几只（min）小")
  expect(garrison({ structure: { lair: "11111111-1111-4111-8111-111111111111" }, min: 0, max: 3 })).not.toBe("")
  expect(garrison({ structure: { lair: "11111111-1111-4111-8111-111111111111" }, min: 1, max: NEAR_LIMITS.guards.max + 1 })).not.toBe("")
  expect(garrison({ structure: "minecraft:desert_pyramid", min: 1, max: 2 })).toContain("用 spawn.near")
  // Older documents have neither; null is the same as none.
  const plain = runtime(spawnOf())
  expect(plain.spawn).not.toHaveProperty("near")
  expect(plain).not.toHaveProperty("garrison")
  expect(runtime(null, null).garrison).toBeNull()
})

test.skipIf(!HAS_GAME_DATA)("the vanilla structure list is the game's own: every structure file of the 1.21.1 jar", () => {
  const files = new Set(vanillaFiles().flatMap((line) => /^data\/minecraft\/worldgen\/structure\/([a-z0-9_]+)\.json$/.exec(line)?.[1] ?? []))
  expect([...files].sort()).toEqual([...VANILLA_STRUCTURE_IDS].sort())
})

// ---- what is generated ----

const base = { modId: "stone_temple", packageName: "com.minemods.content_stone_temple", name: "骷髅卫兵", health: 24, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const contentOf = (files: Record<string, string | Uint8Array>) => String(Object.entries(files).find(([name]) => name.endsWith("Content.java"))![1])

test("the spawn rule asks for the structure after the cheap checks and before the cap; without `near` not a byte changes", () => {
  const plain = compileEntity({ ...base, id: "guard", runtime: runtime(spawnOf()) })
  const kept = compileEntity({ ...base, id: "guard", runtime: runtime({ ...spawnOf({ structures: [{ lair: "aaaaaaaa-1111-4111-8111-111111111111" }, "minecraft:desert_pyramid"], distance: 16 }), cap: { count: 4, radius: 32 } }) })
  const text = contentOf(kept)
  expect(text).toContain("Mob.checkMobSpawnRules(type, world, reason, pos, random) && nearStructure(world, reason, pos) && roomInHabitat(world, reason, pos));")
  expect(text).toContain('ResourceLocation.tryParse("stone_temple:creature_aaaaaaaa111141118111111111111111_lair"), net.minecraft.resources.ResourceLocation.tryParse("minecraft:desert_pyramid")')
  expect(text).toContain("final int reach = 16;")
  // Only natural spawns are held to it; a chunk that is not there is never loaded for it.
  expect(text).toContain("if (reason != net.minecraft.world.entity.MobSpawnType.NATURAL && reason != net.minecraft.world.entity.MobSpawnType.CHUNK_GENERATION) return true;")
  expect(text).toContain("if (!world.hasChunk(x, z)) continue;")
  expect(text).toContain("getReferencesForStructure(structure)")
  // Without near: the file is the file with near, less exactly the method and the call.
  const without = contentOf(compileEntity({ ...base, id: "guard", runtime: runtime({ ...spawnOf(), cap: { count: 4, radius: 32 } }) }))
  expect(text.replace(" && nearStructure(world, reason, pos)", "").replace(/    \/\/ Only within 16 blocks[\s\S]*?\n        return false;\n    }\n\n/, "")).toBe(without)
  Object.values(plain).forEach((value) => expect(String(value)).not.toContain("nearStructure"))
  expect(structureName("m", { lair: "aaaaaaaa-1111-4111-8111-111111111111" })).toBe("m:creature_aaaaaaaa111141118111111111111111_lair")
  expect(structureName("m", "minecraft:igloo")).toBe("minecraft:igloo")
})

test("a lair without guards is generated as it was; with guards its JSON lists them and the one lair class reads and places them", () => {
  const plainData = lairData("stone_temple", "keeper", lair as never)
  expect(lairData("stone_temple", "keeper", lair as never, [])).toEqual(plainData)
  const guarded = lairData("stone_temple", "keeper", lair as never, [{ creature: "creature_guard", min: 3, max: 4 }])
  const structure = JSON.parse(guarded["src/main/resources/data/stone_temple/worldgen/structure/keeper_lair.json"]!)
  expect(structure.guards).toEqual([{ creature: "stone_temple:creature_guard", min: 3, max: 4 }])
  expect({ ...structure, guards: undefined }).toEqual({ ...JSON.parse(plainData["src/main/resources/data/stone_temple/worldgen/structure/keeper_lair.json"]!), guards: undefined })
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    const plainClass = lairClass("stone_temple", base.packageName, genTarget(target))
    expect(lairClass("stone_temple", base.packageName, genTarget(target), false)).toBe(plainClass)
    const withGuards = lairClass("stone_temple", base.packageName, genTarget(target), true)
    expect(plainClass).not.toContain("Guard")
    expect(withGuards).toContain('Guard.CODEC.listOf().optionalFieldOf("guards", List.of()).forGetter(lair -> lair.guards)')
    expect(withGuards).toContain('nbt.putString("guards", guards);')
    expect(withGuards).toContain("RandomSource.create(context.seed() ^")
    expect(withGuards).toContain("mob.setPersistenceRequired();")
    // Every line of the class without guards is still there, in order: guards only add.
    const lines = withGuards.split("\n")
    let at = 0
    for (const line of plainClass.split("\n").filter((value) => !value.includes("private " + LAIR_CLASS + "(") && !value.includes("Piece(BoundingBox box") && !value.includes("Piece piece = new Piece(") && !value.includes("Codec.INT.optionalFieldOf(\"above_sea\""))) {
      const found = lines.indexOf(line, at)
      expect([line, found >= 0]).toEqual([line, true])
      at = found + 1
    }
  }
})

// ---- the project: words, checks, the build on three targets ----

test("the words, the facets and the checks of a project with temple guards and village wolves", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-near-"))
  roots.push(root)
  const { project, boss, guard, wolf } = await templeProject(path.join(root, "石殿"))
  expect(lairOwner(project, boss.id)?.entity.name).toBe("石殿守灵")
  expect(lairOwner(project, guard.id)).toBeNull()
  const guardDoc = project.entities.find((value) => value.id === guard.id)!
  const wolfDoc = project.entities.find((value) => value.id === wolf.id)!
  expect(creatureStructureIssues(project, guardDoc)).toEqual([])
  expect(creatureWords.garrison(project, guardDoc.runtime!.garrison)!.words).toContain("跟着「石殿守灵」的巢一起生成：每座巢里放 3–4 只")
  expect(creatureWords.garrison(project, guardDoc.runtime!.garrison)!.words).toContain(`/locate structure stone_temple:creature_${boss.id.replaceAll("-", "")}_lair`)
  expect(creatureWords.spawn(wolfDoc.runtime!.spawn!, "hostile")).toContain("只在「平原村庄」或「沙漠村庄」或「热带草原村庄」或「雪原村庄」或「针叶林村庄」周围 24 格以内出现")
  // A lair that is not there, or a creature without one, is said by name and stops the build.
  const lost: Project = { ...project, entities: project.entities.map((value) => (value.id === boss.id ? { ...value, boss: { ...value.boss!, lair: null } } : value)) }
  expect(creatureStructureIssues(lost, guardDoc)).toEqual(["生物「骷髅卫兵」要守在「石殿守灵」的巢边上，可是「石殿守灵」没有巢（boss.lair）。先给它做一个巢，或者把 spawn.near / garrison 里的这一项改掉。"])
  const nowhere = { ...guardDoc, runtime: runtime(null, { structure: { lair: "99999999-1111-4111-8111-111111111111" }, min: 1, max: 1 }) }
  expect(creatureStructureIssues(project, nowhere)[0]).toContain("在这个工程里找不到：没有这个编号的生物")
  const names = Object.fromEntries(project.entities.map((value) => [value.id, ["idle", "walk", "hurt", "death", "attack"]]))
  expect(reconcile(lost, { animations: names }).filter((finding) => finding.rule === "creature_structure")).toMatchObject([{ stops: true, about: { id: guard.id } }])
  expect(reconcile(project, { animations: names }).filter((finding) => finding.rule === "creature_structure" || finding.rule === "spawn_near_small")).toEqual([])
  // Too small a place to turn up in: advice, never a stop.
  const tiny = { ...guardDoc, runtime: runtime(spawnOf({ structures: ["minecraft:igloo"], distance: 0 })) }
  expect(structureFindings(project, tiny)).toMatchObject([{ rule: "spawn_near_small", stops: false }])
  expect(structureFindings(project, { ...tiny, runtime: runtime(spawnOf({ structures: ["minecraft:igloo"], distance: 8 })) })).toEqual([])
  expect(structureFindings(project, { ...tiny, runtime: runtime(spawnOf({ structures: VILLAGES, distance: 0 })) })).toEqual([])
  // A structure Forge 1.20.1 does not have, on a project built for it.
  expect(structureFindings({ ...project, target: "forge-1.20.1" }, { ...tiny, runtime: runtime(spawnOf({ structures: ["minecraft:trial_chambers"], distance: 16 })) })[0]!.text).toContain("Forge 1.20.1 里没有")
  // Guards taller than the air over the lair are stopped.
  expect(structureFindings(project, { ...guardDoc, hitbox: { core: { height: 7 } } })).toMatchObject([{ rule: "creature_structure", stops: true }])
  // Said to the maker.
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(SPAWN_NEAR_INSTRUCTIONS)
  expect(SPAWN_NEAR_INSTRUCTIONS).toContain("runtime.spawn.near")
  expect(SPAWN_NEAR_INSTRUCTIONS).toContain("runtime.garrison")
  expect(SPAWN_NEAR_INSTRUCTIONS).toContain('{"asset": 结构资产编号}')
  expect(CREATURE_LIFE_SUMMARY).toContain("runtime.garrison")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: the temple project is built by Studio's own build, and its whole tree compiles against the real class path`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-near-tree-"))
    roots.push(root)
    const { boss, guard, wolf } = await templeProject(path.join(root, "石殿"), target)
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(path.join(root, "石殿"), source, TEMPLATE)
    expect(built.findings.filter((finding) => finding.stops)).toEqual([])
    const all = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
    const read = (pattern: RegExp) => Promise.all(all.filter((name) => pattern.test(name.replaceAll("\\", "/"))).map((name) => readFile(name, "utf8")))
    const hex = (id: string) => id.replaceAll("-", "")
    const [structure] = await read(new RegExp(`worldgen/structure/creature_${hex(boss.id)}_lair\\.json$`))
    expect(JSON.parse(structure!).guards).toEqual([{ creature: `stone_temple:creature_${hex(guard.id)}`, min: 3, max: 4 }])
    const [lairJava] = await read(/StudioLair\.java$/)
    expect(lairJava).toContain("record Guard(")
    const contents = (await read(/StudioContent[^/]*\.java$/)).join("\n")
    expect(contents).toContain(`ResourceLocation.tryParse("stone_temple:creature_${hex(boss.id)}_lair")`)
    expect(contents).toContain('ResourceLocation.tryParse("minecraft:village_taiga")')
    expect(contents.match(/&& nearStructure\(world, reason, pos\)/g)).toHaveLength(2)
    expect(wolf.name).toBe("灰狼")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 300000)
}

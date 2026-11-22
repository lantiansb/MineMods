import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BOSS_LIMITS, LAIR_LIMITS, lairSeparation } from "../src/boss-words"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_INSTRUCTIONS, BOSS_SUMMARY, bossModelIssues, bossWords } from "../src/creature-boss"
import { creatureFacets, creatureLairIssues, creatureWords } from "../src/creature-life"
import { BossSchema, EntitySchema, LairSchema, SPAWN_BIOME_TAGS, bossDocumentIssues, type Boss } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { VANILLA_BLOCK_IDS } from "../src/fabric/content-vanilla"
import { LAIR_CLASS, lairSalt } from "../src/fabric/lair"
import { reconcile } from "../src/reconcile"
import { applyWorkspaceAsset } from "../src/workspace"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { HAS_GAME_DATA, compileTreeFor, vanillaFiles, vanillaJson } from "./java-tree"
import { hasTargetJavac } from "./target-javac"
import { dragonAbilities, dragonBoss, dragonDesign, dragonHitbox } from "./giant-flier"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

/**
 * A boss's lair (巢): a structure of the world's own generation that holds a platform and the boss, placed once while it is made. These tests hold what the
 * document says, what is generated from it (against the game's own structure files in the 1.21.1 jar) and that the whole generated tree compiles.
 */

const lair = { biomes: [] as string[], tags: ["is_mountain"], above_sea: 80, spacing: 40, radius: 12, floor: ["minecraft:packed_ice", "minecraft:blue_ice"], rim: "minecraft:snow_block", clearance: 16 }
/** The dragon's boss without a change of phase: the phase of the fixture names an ability that only the whole dragon has. */
const calm = BossSchema.parse({ ...dragonBoss, phases: [] })
const withLair = (change: Record<string, unknown> = {}): Boss => BossSchema.parse({ ...calm, lair: { ...lair, ...change } })
const refused = (change: Record<string, unknown>) => LairSchema.safeParse({ ...lair, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""

const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "dragon", name: "巨龙", health: 400, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const source = "src/main/java/com/minemods/content_golem_mod"
const data = "src/main/resources/data/golem_mod"
const dragon = (shape: Record<string, unknown> = {}) => compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAbilities, boss: calm, ...shape } as never)
const text = (files: Record<string, string | Uint8Array>, name: string) => String(files[name])
const json = (files: Record<string, string | Uint8Array>, name: string) => JSON.parse(text(files, name))

// ---- the document ----

test("a boss without a lair is what it was; a lair is bounded, and what is wrong with one is said in plain words", () => {
  expect(JSON.stringify(BossSchema.parse(calm))).toBe(JSON.stringify(calm))
  expect(BossSchema.parse({ ...calm, lair: null }).lair).toBeNull()
  expect(withLair().lair).toEqual(lair as never)
  expect(refused({})).toBe("")
  // Spacing, radius, clearance and the number of floor blocks are held to LAIR_LIMITS, the ends included.
  for (const [key, limits] of [["spacing", LAIR_LIMITS.spacing], ["radius", LAIR_LIMITS.radius], ["clearance", LAIR_LIMITS.clearance]] as const) {
    expect(refused({ [key]: limits.min })).toBe("")
    expect(refused({ [key]: limits.max })).toBe("")
    expect(refused({ [key]: limits.min - 1 })).not.toBe("")
    expect(refused({ [key]: limits.max + 1 })).not.toBe("")
    expect(refused({ [key]: limits.min + 0.5 })).not.toBe("")
  }
  expect(refused({ floor: [] })).not.toBe("")
  expect(refused({ floor: Array.from({ length: LAIR_LIMITS.floor.max }, () => "minecraft:stone") })).toBe("")
  expect(refused({ floor: Array.from({ length: LAIR_LIMITS.floor.max + 1 }, () => "minecraft:stone") })).not.toBe("")
  expect(refused({ above_sea: 0 })).not.toBe("")
  expect(refused({ above_sea: 257 })).not.toBe("")
  const { above_sea: _omitted, ...without } = lair
  expect(LairSchema.safeParse(without).success).toBe(true)
  expect(LairSchema.safeParse({ ...lair, rim: null }).success).toBe(true)
  const { rim: _rim, ...unrimmed } = lair
  expect(LairSchema.safeParse(unrimmed).success).toBe(true)
  expect(LairSchema.safeParse({ ...lair, depth: 3 }).success).toBe(false)
  // Where it may be is written as a creature's natural spawning writes it: biomes or groups of biomes, at least one, each at most once.
  expect(refused({ tags: undefined })).toContain("至少要写一个群系")
  expect(refused({ tags: [] })).not.toBe("")
  expect(refused({ biomes: ["minecraft:snowy_slopes"], tags: undefined })).toBe("")
  expect(refused({ biomes: ["minecraft:snowy_slopes", "minecraft:snowy_slopes"], tags: undefined })).toContain("不要重复")
  expect(refused({ tags: ["is_mountain", "is_mountain"] })).toContain("同一组群系不要重复写")
  expect(refused({ biomes: ["minecraft:nowhere"], tags: undefined })).not.toBe("")
  expect(refused({ tags: ["is_nowhere"] })).not.toBe("")
  expect(SPAWN_BIOME_TAGS).toContain("is_mountain")
})

test("the blocks of a lair are vanilla blocks the game has, or a block of the project; air is no floor", () => {
  expect(refused({ floor: ["minecraft:stone", "my_block"] })).toBe("")
  expect(refused({ floor: ["minecraft:not_a_block"] })).toContain("Minecraft 1.21.1 里没有 minecraft:not_a_block 这个方块")
  expect(refused({ rim: "minecraft:not_a_block" })).toContain("没有 minecraft:not_a_block")
  expect(refused({ floor: ["minecraft:air"] })).toContain("是空气，铺不成地面")
  expect(refused({ rim: "minecraft:cave_air" })).toContain("是空气")
  expect(refused({ floor: ["Stone"] })).toContain("标识符")
  expect(refused({ floor: ["other_mod:stone"] })).toContain("标识符")
  // A block with no item is a block all the same (water, fire); an item with no block is not one.
  expect(refused({ floor: ["minecraft:water", "minecraft:lava"] })).toBe("")
  expect(refused({ floor: ["minecraft:diamond"] })).toContain("没有 minecraft:diamond")
})

test("the vanilla block list is the game's: the blocks of its jar, each with a blockstate file", () => {
  expect(VANILLA_BLOCK_IDS.size).toBe(1060)
  for (const id of ["stone", "packed_ice", "water", "lava", "fire", "nether_portal", "grass_block", "oak_wall_sign", "white_wall_banner", "air"]) expect(VANILLA_BLOCK_IDS.has(id)).toBe(true)
  for (const id of ["diamond", "item_frame", "minecraft:stone", "Stone"]) expect(VANILLA_BLOCK_IDS.has(id)).toBe(false)
  if (!HAS_GAME_DATA) return
  const states = new Set(vanillaFiles().flatMap((line) => /^assets\/minecraft\/blockstates\/([a-z0-9_]+)\.json$/.exec(line)?.[1] ?? []))
  // Every block has a blockstate file; the two frames have one for the entity that is not a block.
  expect([...states].filter((id) => !VANILLA_BLOCK_IDS.has(id)).sort()).toEqual(["glow_item_frame", "item_frame"])
  expect([...VANILLA_BLOCK_IDS].filter((id) => !states.has(id))).toEqual([])
})

// These read the game's own data (MINEMODS_TARGET_CLASSPATH): skipped, not failed, on a machine that has none.
test.skipIf(!HAS_GAME_DATA)("the bounds of a lair follow from the game's own numbers", () => {
  const set = (name: string) => (vanillaJson(`data/minecraft/worldgen/structure_set/${name}.json`) as { placement: { spacing: number; separation: number } }).placement
  // Separation is a quarter of the spacing, rounded up: the structures of the game that are spaced 32 or more write it so.
  for (const [name, spacing] of [["igloos", 32], ["desert_pyramids", 32], ["jungle_temples", 32], ["swamp_huts", 32], ["pillager_outposts", 32], ["woodland_mansions", 80]] as const) {
    expect(set(name)).toMatchObject({ spacing, separation: lairSeparation(spacing) })
  }
  expect(lairSeparation(40)).toBe(10)
  expect(lairSeparation(41)).toBe(11)
  // The largest spacing is the largest of any structure set of the game that places by random spread, the woodland mansion's.
  expect<number>(LAIR_LIMITS.spacing.max).toBe(set("woodland_mansions").spacing)
  // The platforms of the two biggest lairs, each pushed its whole search distance towards the other, still apart at the smallest spacing; and not at a smaller one.
  const apart = (spacing: number) => 16 * (lairSeparation(spacing) + 1) - 2 * LAIR_LIMITS.search > 2 * LAIR_LIMITS.radius.max
  expect(apart(LAIR_LIMITS.spacing.min)).toBe(true)
  expect(apart(LAIR_LIMITS.spacing.min - 4)).toBe(false)
  // The lair stays within the 8 chunks within which the game finds the structure starts that reach a chunk.
  expect(Math.ceil((LAIR_LIMITS.search + LAIR_LIMITS.radius.max + 8) / 16)).toBeLessThanOrEqual(8)
  expect<number>(LAIR_LIMITS.support).toBe(2 * LAIR_LIMITS.radius.max)
  expect(LAIR_LIMITS.step % LAIR_LIMITS.check).toBe(0)
  // The tallest collision box a creature may have fits in the clearance with room to spare.
  expect(LAIR_LIMITS.clearance.max).toBeGreaterThan(16)
  expect(BOSS_LIMITS.battle).toBeGreaterThan(0)
})

test("the air over a lair has to hold the creature: a stated collision box is held to it in the document, the model's at build", () => {
  const creature = { behavior: "hostile", boss: withLair({ clearance: 4 }), hitbox: dragonHitbox }
  // The dragon's box is 5 high: 4 blocks of air is not enough, 5 is.
  expect(bossDocumentIssues(creature).map((issue) => issue.path.join("."))).toEqual(["boss.lair.clearance"])
  expect(bossDocumentIssues(creature)[0]!.message).toContain("clearance 至少写 5")
  expect(bossDocumentIssues({ ...creature, boss: withLair({ clearance: 5 }) })).toEqual([])
  expect(bossDocumentIssues({ ...creature, hitbox: null })).toEqual([])
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "巨龙", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null }
  expect(EntitySchema.safeParse({ ...old, hitbox: dragonHitbox, boss: withLair({ clearance: 4 }) }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...old, hitbox: dragonHitbox, boss: withLair({ clearance: 5 }) }).success).toBe(true)
  // Without a stated box the height is only known where the model is: whole blocks that hold 2.5 are 3.
  const model = (height: number | null, shape: Record<string, unknown> = {}) => bossModelIssues({ name: "巨龙", behavior: "hostile", boss: withLair({ clearance: 3, ...shape }) }, null, height).filter((issue) => issue.rule === "boss_lair_clearance")
  expect(model(2.5)).toEqual([])
  expect(model(3)).toEqual([])
  expect(model(3.1)).toMatchObject([{ stops: true }])
  expect(model(null)).toEqual([])
  // Building says it too, in words, whether the box is stated or the model's.
  expect(() => dragon({ boss: withLair({ clearance: 4 }) })).toThrow("clearance 至少写 5")
  expect(() => dragon({ hitbox: undefined, boss: withLair({ clearance: 3 }) })).toThrow("巢上方清出来的空间")
  expect(() => dragon({ boss: withLair({ clearance: 5 }) })).not.toThrow()
})

test("a boss that has a lair and also spawns by itself is warned, never stopped", () => {
  const both = bossModelIssues({ name: "巨龙", behavior: "hostile", boss: withLair(), runtime: { spawn: { biomes: ["minecraft:plains"] } } }, null)
  expect(both).toMatchObject([{ rule: "boss_lair_spawns", stops: false }])
  expect(both[0]!.text).toContain("不止一只")
  expect(bossModelIssues({ name: "巨龙", behavior: "hostile", boss: withLair(), runtime: { spawn: null } }, null)).toEqual([])
  expect(bossModelIssues({ name: "巨龙", behavior: "hostile", boss: calm, runtime: { spawn: { biomes: ["minecraft:plains"] } } }, null)).toEqual([])
  const runtime = { spawn: { biomes: ["minecraft:plains"], weight: 1, min: 1, max: 1 }, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
  expect(() => dragon({ boss: withLair(), runtime })).not.toThrow()
})

// ---- what is generated ----

test("a boss without a lair is generated as it was, and `lair: null` is the same as none", () => {
  const plain = dragon()
  expect(Object.keys(plain).filter((name) => name.includes("Lair") || name.includes("_lair"))).toEqual([])
  expect(text(plain, `${source}/StudioContent.java`)).not.toContain(LAIR_CLASS)
  const nulled = dragon({ boss: BossSchema.parse({ ...calm, lair: null }) })
  expect(Object.keys(nulled)).toEqual(Object.keys(plain))
  Object.keys(plain).forEach((name) => expect(String(nulled[name])).toBe(String(plain[name])))
  // A creature that does not fight has no boss to have a lair.
  const peaceful = compileEntity({ ...base, behavior: "passive", model: dragonDesign, hitbox: dragonHitbox, boss: withLair() } as never)
  expect(Object.keys(peaceful).filter((name) => name.includes("lair") || name.includes("Lair"))).toEqual([])
})

test("a boss with a lair adds its structure, its structure set, the one fixed class and its registration, and nothing else changes", () => {
  const plain = dragon()
  const made = dragon({ boss: withLair() })
  const added = Object.keys(made).filter((name) => !(name in plain))
  expect(added.sort()).toEqual([`${data}/worldgen/structure/dragon_lair.json`, `${data}/worldgen/structure_set/dragon_lair.json`, `${source}/${LAIR_CLASS}.java`].sort())
  // The boss's own class and the rest are the same to the byte; only the content class gets its registration.
  const changed = Object.keys(plain).filter((name) => String(plain[name]) !== String(made[name]))
  expect(changed).toEqual([`${source}/StudioContent.java`])
  const content = text(made, `${source}/StudioContent.java`)
  expect(content.replace(`        ${LAIR_CLASS}.register();`, "")).toBe(text(plain, `${source}/StudioContent.java`))
  expect(content).toContain(`        ${LAIR_CLASS}.register();\n    }\n    @Override public void onInitialize()`)
  // With natural spawning too, the registration comes after it.
  const spawning = text(dragon({ boss: withLair(), runtime: { spawn: { biomes: ["minecraft:plains"], weight: 1, min: 1, max: 1 }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } }), `${source}/StudioContent.java`)
  expect(spawning.indexOf("BiomeModifications.addSpawn")).toBeLessThan(spawning.indexOf(`${LAIR_CLASS}.register();`))
})

test.skipIf(!HAS_GAME_DATA)("the structure and its set are written as the game's own are, with the lair's fields beside", () => {
  const made = dragon({ boss: withLair({ biomes: [], tags: ["is_mountain"] }) })
  const igloo = vanillaJson("data/minecraft/worldgen/structure/igloo.json") as Record<string, unknown>
  const igloos = vanillaJson("data/minecraft/worldgen/structure_set/igloos.json") as { placement: Record<string, unknown>; structures: Record<string, unknown>[] }
  const structure = json(made, `${data}/worldgen/structure/dragon_lair.json`)
  // Every field the game's structure has, and with a value of the same kind.
  Object.entries(igloo).forEach(([key, value]) => expect([key, typeof structure[key]]).toEqual([key, typeof value]))
  expect(structure).toEqual({
    type: "golem_mod:lair",
    biomes: "#minecraft:is_mountain",
    step: "top_layer_modification",
    spawn_overrides: {},
    terrain_adaptation: "none",
    creature: "golem_mod:dragon",
    floor: ["minecraft:packed_ice", "minecraft:blue_ice"],
    rim: "minecraft:snow_block",
    radius: 12,
    clearance: 16,
    above_sea: 80,
  })
  const set = json(made, `${data}/worldgen/structure_set/dragon_lair.json`)
  expect(Object.keys(set).sort()).toEqual(Object.keys(igloos).sort())
  expect(Object.keys(set.placement).sort()).toEqual(Object.keys(igloos.placement).sort())
  expect(set.placement).toEqual({ type: "minecraft:random_spread", salt: lairSalt("golem_mod", "dragon"), separation: 10, spacing: 40 })
  expect(set.structures).toEqual([{ structure: "golem_mod:dragon_lair", weight: 1 }])
  expect(Object.keys(set.structures[0]).sort()).toEqual(Object.keys(igloos.structures[0]!).sort())
  // The salt is the game's own kind of number (0 to 2^31 - 1), stable, and not the same for two creatures or two mods.
  expect(Number.isInteger(set.placement.salt) && set.placement.salt >= 0 && set.placement.salt <= 2 ** 31 - 1).toBe(true)
  expect(lairSalt("golem_mod", "dragon")).toBe(lairSalt("golem_mod", "dragon"))
  expect(new Set([lairSalt("golem_mod", "dragon"), lairSalt("golem_mod", "wyrm"), lairSalt("other_mod", "dragon")]).size).toBe(3)
  // Optional fields are left out when not asked for; the project's own blocks carry the mod's name.
  const plainer = dragon({ boss: withLair({ above_sea: undefined, rim: null, floor: ["azure_ore", "minecraft:stone"] }) })
  const fields = json(plainer, `${data}/worldgen/structure/dragon_lair.json`)
  expect(fields).not.toHaveProperty("rim")
  expect(fields).not.toHaveProperty("above_sea")
  expect(fields.floor).toEqual(["golem_mod:azure_ore", "minecraft:stone"])
})

test("biomes are a list, one group is that group's tag, and biomes with groups (or several groups) are a tag of the mod", () => {
  const biomesOf = (change: Record<string, unknown>) => json(dragon({ boss: withLair(change) }), `${data}/worldgen/structure/dragon_lair.json`).biomes
  expect(biomesOf({ biomes: ["minecraft:snowy_slopes", "minecraft:jagged_peaks"], tags: undefined })).toEqual(["minecraft:snowy_slopes", "minecraft:jagged_peaks"])
  expect(biomesOf({ biomes: [], tags: ["is_forest"] })).toBe("#minecraft:is_forest")
  const mixed = dragon({ boss: withLair({ biomes: ["minecraft:snowy_slopes"], tags: ["is_mountain", "is_hill"] }) })
  expect(json(mixed, `${data}/worldgen/structure/dragon_lair.json`).biomes).toBe("#golem_mod:dragon_lair")
  expect(json(mixed, `${data}/tags/worldgen/biome/dragon_lair.json`)).toEqual({ values: ["minecraft:snowy_slopes", "#minecraft:is_mountain", "#minecraft:is_hill"] })
  expect(biomesOf({ biomes: [], tags: ["is_mountain", "is_hill"] })).toBe("#golem_mod:dragon_lair")
  // The game's tags the lair names exist, in the place the tag file is read from.
  if (HAS_GAME_DATA) SPAWN_BIOME_TAGS.forEach((tag) => expect(() => vanillaJson(`data/minecraft/tags/worldgen/biome/${tag}.json`)).not.toThrow())
  expect(Object.keys(dragon({ boss: withLair({ biomes: [], tags: ["is_forest"] }) })).some((name) => name.includes("/tags/worldgen/biome/"))).toBe(false)
})

test("the fixed class is the same for every creature and mod but for its package and mod id, and says what the game is asked to do", () => {
  const first = text(dragon({ boss: withLair() }), `${source}/${LAIR_CLASS}.java`)
  const second = text(dragon({ id: "wyrm", name: "蠕龙", boss: withLair({ spacing: 64, radius: 5, floor: ["minecraft:stone"], rim: null }) }), `${source}/${LAIR_CLASS}.java`)
  // Nothing of one lair is in the class: every field is read from the structure's JSON.
  expect(second).toBe(first)
  expect(first.replaceAll("golem_mod", "other_mod")).toBe(text(compileEntity({ ...base, modId: "other_mod", packageName: "com.minemods.content_other_mod", model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAbilities, boss: withLair() } as never), "src/main/java/com/minemods/content_other_mod/StudioLair.java"))
  expect(first).toContain("public final class StudioLair extends Structure")
  expect(first).toContain("RecordCodecBuilder.mapCodec(instance -> instance.group(\n        settingsCodec(instance),")
  for (const field of ["creature", "floor", "rim", "radius", "clearance", "above_sea"]) expect(first).toContain(`"${field}"`)
  expect(first).toContain(`Codec.intRange(${LAIR_LIMITS.radius.min}, ${LAIR_LIMITS.radius.max}).fieldOf("radius")`)
  expect(first).toContain(`Codec.intRange(${LAIR_LIMITS.clearance.min}, ${LAIR_LIMITS.clearance.max}).fieldOf("clearance")`)
  expect(first).toContain("@Override protected Optional<Structure.GenerationStub> findGenerationPoint(Structure.GenerationContext context)")
  expect(first).toContain("generator.getBaseHeight(originX + dx, originZ + dz, Heightmap.Types.WORLD_SURFACE_WG, limits, noise)")
  expect(first).toContain("Heightmap.Types.OCEAN_FLOOR_WG")
  expect(first).toContain(`private static final int SEARCH = ${LAIR_LIMITS.search};`)
  expect(first).toContain(`private static final int SUPPORT = ${LAIR_LIMITS.support};`)
  expect(first).toContain("public static final class Piece extends StructurePiece")
  expect(first).toContain("@Override public void postProcess(WorldGenLevel world, StructureManager accessor, ChunkGenerator generator, RandomSource random, BoundingBox chunkBox, ChunkPos chunkPos, BlockPos pivot)")
  expect(first).toContain("@Override protected void addAdditionalSaveData(StructurePieceSerializationContext context, CompoundTag nbt)")
  expect(first).toContain("BuiltInRegistries.STRUCTURE_PIECE, ResourceLocation.fromNamespaceAndPath(MOD_ID, \"lair\"), (StructurePieceType.ContextlessType) Piece::new")
  expect(first).toContain("BuiltInRegistries.STRUCTURE_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, \"lair\"), lair")
  // Registered once however many creatures have a lair; the boss placed once, only by the chunk that holds the middle, and kept.
  expect(first).toContain("if (type != null) return;")
  expect(first).toContain("centreX < chunkBox.minX() || centreX > chunkBox.maxX()")
  expect(first).toContain("mob.setPersistenceRequired();")
  expect(first).toContain("MobSpawnType.STRUCTURE")
  expect(first).toContain("world.addFreshEntityWithPassengers(entity);")
  // It never throws over a block it does not know, and touches nothing outside the chunk it is asked to make.
  expect(first).toContain("BuiltInRegistries.BLOCK.containsKey(id)")
  expect(first).toContain("Math.min(boundingBox.maxX(), chunkBox.maxX())")
})

test("the words say what a lair is, to the person and to the AI", () => {
  expect(BOSS_INSTRUCTIONS).toContain("lair（可选")
  expect(BOSS_INSTRUCTIONS).toContain("/locate structure 模组id:生物注册名_lair")
  expect(BOSS_INSTRUCTIONS).toContain("新生成的区块")
  expect(BOSS_INSTRUCTIONS).toContain("打败了就不会再来")
  expect(BOSS_INSTRUCTIONS).toContain(`spacing ${LAIR_LIMITS.spacing.min}–${LAIR_LIMITS.spacing.max}`)
  const example = /例：(\{"lair":.*?\}\})。/.exec(BOSS_INSTRUCTIONS)![1]!
  expect(LairSchema.safeParse(JSON.parse(example).lair).success).toBe(true)
  expect(BOSS_SUMMARY).toContain("lair")
  const words = bossWords.lair(withLair().lair!, "高山一类的群系", "golem_mod:dragon_lair", (block) => (block === "minecraft:packed_ice" ? "浮冰" : block))
  expect(words).toBe("它的巢随世界一起生成：在高山一类的群系，平均每隔 40 个区块一个，平台比海平面高 80 格以上才有；巢是半径 12 格的圆平台，铺着「浮冰」、「minecraft:blue_ice」，最外一圈砌着「minecraft:snow_block」，上方 16 格里的树、山石和别的建筑都清掉（巢是区块里最后造的东西；造完以后落下的一层薄雪会留着）；生成的那一刻放进去一只，打败了不会再来，只有新生成的区块里才有，已经走过的地方没有；想找到它：按 T 打开聊天框，粘贴 `/locate structure golem_mod:dragon_lair` 再按回车，游戏会告诉你它在哪一格")
  expect(bossWords.lair({ ...lair, biomes: [], tags: ["is_mountain"], above_sea: undefined, rim: null }, "x", "m:c_lair")).not.toContain("海平面")
})

// ---- a whole project ----

async function lairProject(change: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-lair-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const boss = BossSchema.parse({ bar: { color: "blue", style: "progress", darken_sky: false }, intro: null, phases: [], death: { seconds: 2, xp_bursts: 2, explosion: false }, leash: null, lair: { ...lair, floor: ["azure_ore", "minecraft:packed_ice"], clearance: 6, ...change } })
  return { root, directory, sample, golem, boss, project: sample, entity: { ...golem, boss } as typeof golem }
}

test("a lair names blocks of the project that exist; the project is told when it does not, in the document, at save and at build", async () => {
  const made = await lairProject()
  const named = { ...made.project, entities: [made.entity] }
  expect(creatureLairIssues(named, made.entity)).toEqual([])
  const lost = { ...made.entity, boss: { ...made.boss, lair: { ...made.boss.lair!, floor: ["azure_ore", "ghost_block"], rim: "ghost_rim" } } }
  expect(creatureLairIssues(named, lost)).toEqual(["生物「晶石傀儡」的巢用了方块「ghost_block」，在这个工程里找不到。先把这个方块做出来，或者写成 minecraft:名字 的原版方块。", "生物「晶石傀儡」的巢用了方块「ghost_rim」，在这个工程里找不到。先把这个方块做出来，或者写成 minecraft:名字 的原版方块。"])
  // An item of the project is no block to build with.
  expect(creatureLairIssues(named, { ...made.entity, boss: { ...made.boss, lair: { ...made.boss.lair!, floor: ["azure_shard"] } } })).toHaveLength(1)
  const asset = made.project.workspace.assets.find((value) => value.document.kind === "entity")!
  expect(() => applyWorkspaceAsset(made.project, { ...asset, document: { ...asset.document, boss: lost.boss } } as typeof asset)).toThrow("的巢用了方块「ghost_block」，在这个工程里找不到。")
})

test("without a lair the golem project's tree has none of it; with one, the reconciliation says what is left to say", async () => {
  const made = await lairProject()
  const names = { animations: { [made.golem.id]: ["idle", "walk", "hurt", "death", "attack"] } }
  const spawning = reconcile({ ...made.project, entities: [made.entity] }, names).filter((finding) => finding.rule.startsWith("boss_lair"))
  // The sample's golem also spawns by itself: the warning, which stops nothing.
  expect(spawning).toMatchObject([{ rule: "boss_lair_spawns", stops: false, about: { kind: "entity", id: made.golem.id } }])
  const quiet = { ...made.entity, runtime: { ...made.entity.runtime!, spawn: null } }
  expect(reconcile({ ...made.project, entities: [quiet] }, names).filter((finding) => finding.rule.startsWith("boss_lair"))).toEqual([])
  // Too low for what the model measures: stopped.
  const low = { ...quiet, hitbox: undefined, boss: { ...made.boss, lair: { ...made.boss.lair!, clearance: 3 } } }
  expect(reconcile({ ...made.project, entities: [low] }, names).filter((finding) => finding.rule === "boss_lair_clearance" && finding.stops).length).toBeLessThanOrEqual(1)
})

test("a lair is a source of its creature, told with where to find it", async () => {
  const made = await lairProject()
  const asset = made.project.workspace.assets.find((value) => value.document.kind === "entity")!
  const entity = asset.document as Extract<typeof asset.document, { kind: "entity" }>
  const document = { ...entity, runtime: { ...entity.runtime, spawn: null }, boss: made.boss }
  const sources = creatureFacets(document, made.project).filter((facet) => facet.question === "source")
  expect(sources).toHaveLength(1)
  expect(sources[0]).toMatchObject({ answered: true })
  expect(sources[0]!.words).toContain("它的巢随世界一起生成")
  expect(sources[0]!.words).toContain(creatureWords.places(made.boss.lair!))
  expect(sources[0]!.words).toContain("「蓝晶矿石」、「浮冰」") // the project's block by its name; ice from the game's by its Chinese name
  expect(sources[0]!.words).toContain(`/locate structure azure_sample:creature_${entity.model_asset_id.replaceAll("-", "")}_lair`)
  // Without the lair, and without spawning, it is still said it cannot be met.
  expect(creatureFacets({ ...document, boss: null }, made.project).find((facet) => facet.question === "source")).toMatchObject({ answered: false })
  // The facet reads nothing for a creature that is not hostile: it is no boss.
  expect(creatureFacets({ ...document, behavior: "passive" }, made.project).find((facet) => facet.question === "source")).toMatchObject({ answered: false })
})

test("a project with a lair builds a tree with its files, the unknown block refused at build, and one without builds none of them", async () => {
  const made = await lairProject()
  // Build: the lair on the sample's golem (the boss and its lair saved in the project, which keeps its own spawn and model).
  const { saveProject } = await import("../src/project")
  const saved = await saveProject(made.directory, { ...made.project, entities: [made.entity] } as never, made.project.revision)
  const out = path.join(made.root, "source")
  await mkdir(out)
  const built = await assembleBuildSource(made.directory, out, TEMPLATE)
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
  expect(built.findings.some((finding) => finding.rule === "boss_lair_spawns")).toBe(true)
  const id = `creature_${made.golem.id.replaceAll("-", "")}`
  const structure = JSON.parse(await readFile(path.join(out, `src/main/resources/data/azure_sample/worldgen/structure/${id}_lair.json`), "utf8"))
  expect(structure).toMatchObject({ type: "azure_sample:lair", creature: `azure_sample:${id}`, floor: ["azure_sample:azure_ore", "minecraft:packed_ice"] })
  const entry = await readFile(path.join(out, "src/main/java/com/minemods/content_azure_sample/StudioContent.java"), "utf8")
  expect(entry).toContain("StudioLair.register();")
  const set = JSON.parse(await readFile(path.join(out, `src/main/resources/data/azure_sample/worldgen/structure_set/${id}_lair.json`), "utf8"))
  expect(set.structures[0].structure).toBe(`azure_sample:${id}_lair`)
  if (hasTargetJavac(OFFICIAL)) {
    const compiled = (await compileTreeFor(OFFICIAL, out))!
    expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
    expect(compiled.code).toBe(0)
  }
  // A block that is gone is refused at build.
  const { saveProject: save } = await import("../src/project")
  const lost = { ...made.entity, boss: { ...made.boss, lair: { ...made.boss.lair!, floor: ["ghost_block"] } } }
  await save(made.directory, { ...saved, entities: [lost] } as never, saved.revision)
  const again = path.join(made.root, "again")
  await mkdir(again)
  await expect(assembleBuildSource(made.directory, again, TEMPLATE)).rejects.toThrow(`ENTITY_LAIR_UNKNOWN_BLOCK:${made.golem.id}`)
}, 240000)

test.skipIf(!hasTargetJavac(OFFICIAL))("the whole generated tree of a dragon with a lair, with a rim and without, compiles against Minecraft 1.21.1", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-lair-"))
  roots.push(root)
  const { putModelAsset } = await import("../src/assets")
  const { saveProject } = await import("../src/project")
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const wyrm = EntitySchema.parse({ ...sample.entities[0]!, abilities: dragonAbilities.filter((ability) => ability.id !== "stoop"), boss: withLair({ clearance: 8 }), hitbox: dragonHitbox, runtime: { ...sample.entities[0]!.runtime, spawn: null } })
  const saved = await saveProject(directory, { ...sample, entities: [wyrm] } as never, sample.revision)
  await putModelAsset(directory, { entity_id: wyrm.id, data: { design: dragonDesign }, origin: "example", expectedRevision: saved.revision })
  const out = path.join(root, "source")
  await mkdir(out)
  const built = await assembleBuildSource(directory, out, TEMPLATE)
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
  expect(built.findings.some((finding) => finding.rule === "boss_lair_spawns")).toBe(false)
  const compiled = (await compileTreeFor(OFFICIAL, out))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

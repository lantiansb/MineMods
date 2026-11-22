import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { CREATURE_LIFE_CAPABILITY } from "../src/creature-capability"
import { CREATURE_LIFE_INSTRUCTIONS, CREATURE_LIFE_SUMMARY, creatureWords } from "../src/creature-life"
import { EntityRuntimeSchema, EntitySchema, SPAWN_CAP_LIMITS } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { saveProject } from "../src/project"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { dragonDesign, dragonFlight } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * A natural spawn can carry a population cap: at most N of the creature within R blocks of the spot. The cap is a term of the spawn predicate the game asks (SpawnRestriction),
 * so a group stops growing when the neighbourhood is full; it is not gameplay code that removes creatures afterwards.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const spawn = { biomes: ["minecraft:plains"], weight: 6, min: 1, max: 2 }
const schema = EntityRuntimeSchema.shape.spawn.unwrap()
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "ray", name: "星帆鳐", health: 12, speed: 0.2, attack_damage: 0, behavior: "passive" as const, model: dragonDesign, flight: dragonFlight }
const runtime = (extra: Record<string, unknown> = {}) => ({ spawn: { ...spawn, ...extra }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null })
const files = (extra: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => compileEntity({ ...base, runtime: runtime(extra), ...input } as never)
const contentFile = (all: Record<string, string | Uint8Array>) => String(Object.entries(all).find(([name]) => name.endsWith("Content.java"))![1])
const content = (extra: Record<string, unknown> = {}, input: Record<string, unknown> = {}) => contentFile(files(extra, input))
const sha = (text: string) => `${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${text.length}`

test("the cap is two whole numbers inside bounds that each have a reason, and nothing else", () => {
  const parse = (cap: unknown) => schema.safeParse({ ...spawn, cap }).success
  expect(parse({ count: 2, radius: 48 })).toBe(true)
  // The ends of each range, both sides.
  expect(parse({ count: SPAWN_CAP_LIMITS.count.min, radius: SPAWN_CAP_LIMITS.radius.min })).toBe(true)
  expect(parse({ count: SPAWN_CAP_LIMITS.count.max, radius: SPAWN_CAP_LIMITS.radius.max })).toBe(true)
  expect(SPAWN_CAP_LIMITS).toEqual({ count: { min: 1, max: 64 }, radius: { min: 4, max: 64 } })
  ;[{ count: 0, radius: 48 }, { count: 65, radius: 48 }, { count: 1.5, radius: 48 }, { count: 2, radius: 3 }, { count: 2, radius: 65 }, { count: 2, radius: 48.5 }, { count: 2 }, { radius: 48 }, { count: 2, radius: 48, shape: "sphere" }, { count: "2", radius: 48 }, null].forEach((cap) => expect(parse(cap)).toBe(false))
  // Absent is allowed and stays absent (older projects have none); the field is not filled in for them.
  expect(schema.parse(spawn)).not.toHaveProperty("cap")
  expect(EntityRuntimeSchema.shape.spawn.parse(null)).toBeNull()
})

test("the generated spawn rule asks the cap last, through a method that counts the same creature in a box and cuts the corners; without the cap not a byte changes", () => {
  const capped = content({ cap: { count: 2, radius: 48 } })
  // The last term of the predicate, after the cheap checks, so the lookup runs only for a spot that would otherwise take the creature.
  expect(capped).toContain("Mob.checkMobSpawnRules(type, world, reason, pos, random) && roomInHabitat(world, reason, pos));")
  expect(capped).toContain("private static boolean roomInHabitat(net.minecraft.world.level.ServerLevelAccessor world, net.minecraft.world.entity.MobSpawnType reason, net.minecraft.core.BlockPos pos)")
  // Only natural spawns count: a spawner, an egg or a command is the person's own doing.
  expect(capped).toContain("if (reason != net.minecraft.world.entity.MobSpawnType.NATURAL && reason != net.minecraft.world.entity.MobSpawnType.CHUNK_GENERATION) return true;")
  expect(capped).toContain("radius = 48;")
  // The whole height of the world over a square of the radius, then the true distance along the ground; the creature's own type, alive ones.
  expect(capped).toContain("world.getMinBuildHeight()")
  expect(capped).toContain("world.getMaxBuildHeight()")
  expect(capped).toContain("world.getEntities(CREATURE, habitat, other -> other.isAlive() && (other.getX() - x) * (other.getX() - x) + (other.getZ() - z) * (other.getZ() - z) <= radius * radius).size() < 2;")
  // The numbers are the ones written.
  expect(content({ cap: { count: 5, radius: 20 } })).toContain("radius = 20;")
  expect(content({ cap: { count: 5, radius: 20 } })).toContain(".size() < 5;")
  // It is still the same registration and the same biome modifier, with the group the person wrote.
  expect(capped).toContain("BiomeModifications.addSpawn(")
  expect(capped).toContain("MobCategory.CREATURE, CREATURE, 6, 1, 2);")
  // A hostile one keeps its own terms in front of the cap.
  expect(content({ cap: { count: 1, radius: 16 } }, { behavior: "hostile" })).toContain("world.getDifficulty() != Difficulty.PEACEFUL && Monster.isDarkEnoughToSpawn(world, pos, random) && Mob.checkMobSpawnRules(type, world, reason, pos, random) && roomInHabitat(world, reason, pos));")
  // Without the cap: nothing of it, in any file.
  const plain = files()
  Object.values(plain).forEach((text) => expect(String(text)).not.toContain("roomInHabitat"))
  expect(contentFile(plain)).toContain("Mob.checkMobSpawnRules(type, world, reason, pos, random));")
  // The text without the cap is the text with the cap, less exactly the method and the call.
  const rebuilt = content({ cap: { count: 2, radius: 48 } })
    .replace(" && roomInHabitat(world, reason, pos)", "")
    .replace(/    \/\/ At most 2 of this creature[\s\S]*?\n    }\n\n(?=    public static void register)/, "")
  expect(rebuilt).toBe(contentFile(plain))
  expect(Object.keys(files({ cap: { count: 2, radius: 48 } })).sort()).toEqual(Object.keys(plain).sort())
  // A pinned reading of the Java of a flier that spawns without a cap, written by the generator at 558ac91, before the cap existed.
  expect(sha(contentFile(plain))).toBe(PLAIN_CONTENT_PIN)
})

test("the cap is said to the maker and to the person in plain words", () => {
  const words = (cap?: { count: number; radius: number }) => creatureWords.spawn(schema.parse({ ...spawn, ...(cap ? { cap } : {}) }), "passive")
  expect(words({ count: 2, radius: 48 })).toContain("48 格范围内（不管高低）最多同时有 2 只")
  expect(words({ count: 2, radius: 48 })).toContain("一次 1–2 只")
  // Said honestly: a place the game has only just made cannot be counted.
  expect(words({ count: 2, radius: 48 })).toContain("新地方头一批游戏数不到")
  expect(words()).not.toContain("最多同时有")
  expect(words()).toBe("会自己出现在这些群系：平原，一次 1–2 只")
  // The maker is told the field, its bounds and why gameplay code is the wrong place for it.
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(`cap（可不写）是“一处地方最多几只”：{count: ${SPAWN_CAP_LIMITS.count.min}–${SPAWN_CAP_LIMITS.count.max}, radius: ${SPAWN_CAP_LIMITS.radius.min}–${SPAWN_CAP_LIMITS.radius.max}}`)
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain('cap {"count":2,"radius":48}')
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain("不要用玩法代码去做这件事")
  expect(CREATURE_LIFE_SUMMARY).toContain("cap")
  expect(CREATURE_LIFE_CAPABILITY.done.join("\n")).toContain("cap：半径多少格内最多几只")
  // A written cap passes the whole runtime schema.
  expect(EntityRuntimeSchema.safeParse(runtime({ cap: { count: 2, radius: 48 } })).success).toBe(true)
})

// ---- the generated tree, compiled ----

test.skipIf(!hasTargetJavac(OFFICIAL))("the generated tree of a flier with a capped natural spawn compiles with javac against the 1.21.1 classes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-spawn-cap-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, {})
  const ray = EntitySchema.parse({ ...sample.entities[0]!, behavior: "passive", abilities: [], boss: null, habits: null, loot: [], flight: dragonFlight, runtime: { ...sample.entities[0]!.runtime, spawn: schema.parse({ ...spawn, cap: { count: 2, radius: 48 } }) } })
  const saved = await saveProject(directory, { ...sample, entities: [ray], logic: [] } as never, sample.revision)
  await putModelAsset(directory, { entity_id: ray.id, data: { design: dragonDesign }, origin: "example", expectedRevision: saved.revision })
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
  // What is compiled is the capped spawn, with the flier, not a tree that lost the cap on the way.
  const folder = path.join(source, "src/main/java/com/minemods/content_azure_sample")
  const written = await Promise.all((await readdir(folder)).filter((file) => file.startsWith("StudioContent")).map((file) => readFile(path.join(folder, file), "utf8")))
  expect(written.filter((text) => text.includes("roomInHabitat(world, reason, pos)"))).toHaveLength(1)
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

// re-pinned when the generator moved to Mojang's names (Loom's officialMojangMappings): names and the imports they need, nothing else.
// names only (Yarn → Mojang), checked 2026-11-14
const PLAIN_CONTENT_PIN = "09836171cc39aa4f 2555"

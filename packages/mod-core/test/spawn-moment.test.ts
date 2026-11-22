import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { CREATURE_LIFE_INSTRUCTIONS, CREATURE_LIFE_SUMMARY, creatureWords } from "../src/creature-life"
import { EntityRuntimeSchema, EntitySchema, SPAWN_WHEN_LIMITS } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { createEntity, createProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * r29 修补乙 第 2 件: a natural spawn more or less often by the time of day (`spawn.time`) and the weather (`spawn.weather`). The samples are a beast of the dusk that comes out
 * more in the rain, and a butterfly of the day; not a boss of the stories.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const spawnOf = (extra: Record<string, unknown> = {}) => ({ biomes: [], tags: ["is_overworld"], weight: 10, min: 1, max: 2, ...extra })
const runtime = (extra: Record<string, unknown> = {}) => EntityRuntimeSchema.parse({ spawn: spawnOf(extra), explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null })
const schema = EntityRuntimeSchema.shape.spawn.unwrap()
const base = { modId: "dusk_mod", packageName: "com.minemods.content_dusk_mod", id: "beast", name: "暮兽", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const contentOf = (extra: Record<string, unknown> = {}) => String(Object.entries(compileEntity({ ...base, runtime: runtime(extra) })).find(([name]) => name.endsWith("Content.java"))![1])

test("time and weather are scales 0–4 of named moments, not all 0, and absent from every older document", () => {
  const refused = (extra: Record<string, unknown>) => schema.safeParse(spawnOf(extra)).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(refused({ time: { dusk: 2, night: 2 } })).toBe("")
  expect(refused({ time: { day: 0, dawn: 0 } })).toBe("")
  expect(refused({ weather: { rain: 2, thunder: 2 } })).toBe("")
  expect(refused({ time: { day: SPAWN_WHEN_LIMITS.scale.max }, weather: { clear: 0 } })).toBe("")
  expect(refused({ time: { day: SPAWN_WHEN_LIMITS.scale.max + 0.5 } })).not.toBe("")
  expect(refused({ time: { day: -1 } })).not.toBe("")
  expect(refused({ time: { noon: 2 } })).not.toBe("")
  expect(refused({ time: { dawn: 0, day: 0, dusk: 0, night: 0 } })).toContain("一天里至少要有一个时候不是 0")
  expect(refused({ weather: { clear: 0, rain: 0, thunder: 0 } })).toContain("至少要有一个不是 0")
  const plain = schema.parse(spawnOf())
  expect(plain).not.toHaveProperty("time")
  expect(plain).not.toHaveProperty("weather")
})

test("the spawn rule lets a spawn through at its moment's share of the commonest; without either field not a byte changes", () => {
  const dusk = contentOf({ time: { dusk: 2, night: 2 }, weather: { rain: 2, thunder: 2 } })
  expect(dusk).toContain("spawnMoment(world, reason, random) && Mob.checkMobSpawnRules(type, world, reason, pos, random)")
  expect(dusk).toContain("share *= clock >= 22200L || clock < 1000L ? 1f : clock < 12000L ? 1f : clock < 13800L ? 2f : 2f;")
  expect(dusk).toContain("share *= level.isThundering() ? 2f : level.isRaining() ? 2f : 1f;")
  // The commonest moment is dusk or night in rain or a storm: 2 × 2.
  expect(dusk).toContain("return share > 0.0f && (share >= 4f || random.nextFloat() * 4f < share);")
  // Only natural spawns are held to it.
  expect(dusk).toContain("if (reason != net.minecraft.world.entity.MobSpawnType.NATURAL && reason != net.minecraft.world.entity.MobSpawnType.CHUNK_GENERATION) return true;")
  // Only one of the two: the other is not read.
  const day = contentOf({ time: { dusk: 0, night: 0, dawn: 0 } })
  expect(day).not.toContain("isRaining")
  expect(day).toContain("clock < 12000L ? 1f : clock < 13800L ? 0f : 0f;")
  expect(contentOf({ weather: { rain: 3 } })).not.toContain("getDayTime")
  // Without them: the text with them, less exactly the method and the call.
  const plain = contentOf()
  expect(plain).not.toContain("spawnMoment")
  expect(dusk.replace("spawnMoment(world, reason, random) && ", "").replace(/    \/\/ More or less often by the moment[\s\S]*?\n    }\n\n/, "")).toBe(plain)
})

test("the moments are said to the person and to the maker", () => {
  expect(creatureWords.spawn(schema.parse(spawnOf({ time: { dusk: 2, night: 2 }, weather: { rain: 2, thunder: 2 } })), "hostile")).toContain("黄昏和夜里是平时的 2 倍，下雨和打雷是平时的 2 倍")
  expect(creatureWords.spawn(schema.parse(spawnOf({ time: { dusk: 0, night: 0, dawn: 0 } })), "passive")).toContain("黎明、黄昏和夜里不出现")
  expect(creatureWords.spawn(schema.parse(spawnOf()), "passive")).toBe("会自己出现在这些群系：整个主世界，一次 1–2 只")
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain("runtime.spawn.time = {dawn, day, dusk, night}")
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain('{"weather":{"rain":2,"thunder":2}}')
  expect(CREATURE_LIFE_SUMMARY).toContain("time、weather")
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: a dusk beast and a day butterfly are built by Studio's own build and compile against the real class path`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-moment-"))
    roots.push(root)
    const directory = path.join(root, "暮野")
    const created = await createProject({ directory, name: "暮野", description: "黄昏和雨里多的野兽，只在白天飞的蝴蝶。", mod_id: "dusk_field", target })
    const beast = EntitySchema.parse({ ...createEntity({ name: "暮兽", behavior: "hostile" }), name_en: "Dusk Beast", runtime: runtime({ time: { dusk: 2, night: 2 }, weather: { rain: 2, thunder: 2 } }) })
    const butterfly = EntitySchema.parse({ ...createEntity({ name: "日蝶", behavior: "passive" }), name_en: "Day Butterfly", runtime: runtime({ time: { dusk: 0, night: 0, dawn: 0 }, weather: { rain: 0, thunder: 0 } }) })
    let project = await saveProject(directory, { ...created, entities: [beast, butterfly] }, created.revision)
    for (const entity of [beast, butterfly]) project = (await putModelAsset(directory, { entity_id: entity.id, data: { design: fightingGolemDesign }, origin: "example", expectedRevision: project.revision })).project
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(directory, source, TEMPLATE)
    expect(built.findings.filter((finding) => finding.stops)).toEqual([])
    const all = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && /StudioContent[^\\/]*\.java$/.test(entry.name)).map((entry) => path.join(entry.parentPath, entry.name))
    const contents = (await Promise.all(all.map((name) => readFile(name, "utf8")))).join("\n")
    expect(contents.match(/spawnMoment\(world, reason, random\) && /g)).toHaveLength(2)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 300000)
}

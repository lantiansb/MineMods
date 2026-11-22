import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SUMMON_LIMITS } from "../src/boss-words"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_INSTRUCTIONS } from "../src/creature-boss"
import { creatureSummonIssues } from "../src/creature-life"
import { SummonSchema } from "../src/entity-runtime"
import { SUMMON_CLASS, summonCall, summonClass } from "../src/fabric/summon"
import { genTarget } from "../src/platform/target"
import { openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetBossSample } from "../script/target-boss-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * Calling a boss up (`summon`, the third tier of task 二): an item used in the air or on an altar block makes the boss in front of the player, where its body fits,
 * one at a time, with a cooldown; found by registry names, so one class serves every loader but for how a use reaches it.
 */

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const inAir = { item: "minecraft:nether_star", block: null, consume: true, cooldown: 30, ahead: 4 }
const onAltar = { item: "war_banner", block: "minecraft:crying_obsidian", consume: false, cooldown: 0, ahead: 2 }

test("a summon names its item and altar as other boss data does; the game's own ones are checked against the game", () => {
  expect(SummonSchema.parse(inAir)).toEqual(inAir)
  const said = (value: unknown) => SummonSchema.safeParse(value).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(said({ ...inAir, item: "minecraft:nether_starr" })).toContain("Minecraft 1.21.1 里没有 minecraft:nether_starr 这个物品")
  expect(said({ ...inAir, block: "minecraft:air" })).toContain("是空气，不能当召唤台")
  expect(said({ ...inAir, ahead: SUMMON_LIMITS.ahead.max + 1 })).not.toBe("")
  expect(said({ ...inAir, item: "Bad Name" })).toContain("召唤用的东西写本工程物品或方块的标识符")
})

test("what it names of the project must be there: the item one of its items or blocks, the altar one of its blocks", () => {
  const project = { items: [{ identifier: "war_banner" }], blocks: [{ identifier: "bronze_altar" }] } as never
  const boss = (summon: unknown) => ({ name: "蚩尤", boss: { summon } }) as never
  expect(creatureSummonIssues(project, boss(onAltar))).toEqual([])
  expect(creatureSummonIssues(project, boss({ ...onAltar, item: "lost_horn" })).join("")).toContain("召唤用的「lost_horn」在这个工程里找不到")
  expect(creatureSummonIssues(project, boss({ ...onAltar, block: "war_banner" })).join("")).toContain("召唤台「war_banner」在这个工程里找不到")
  expect(creatureSummonIssues(project, boss({ ...onAltar, block: "bronze_altar" }))).toEqual([])
})

test("the creature adds itself by its registry name; the shared class listens through Fabric API or the facade", () => {
  expect(summonCall("chiyou", "creature_x", inAir)).toBe(`${SUMMON_CLASS}.add("chiyou:creature_x", "minecraft:nether_star", null, true, 600, 4.0);`)
  expect(summonCall("chiyou", "creature_x", onAltar)).toBe(`${SUMMON_CLASS}.add("chiyou:creature_x", "chiyou:war_banner", "minecraft:crying_obsidian", false, 0, 2.0);`)
  const fabric = summonClass("com.minemods.content_chiyou")
  expect(fabric).toContain("UseItemCallback.EVENT.register(")
  expect(fabric).toContain(`world.getEntities(kind, player.getBoundingBox().inflate(${SUMMON_LIMITS.near}.0), Entity::isAlive).isEmpty()`)
  expect(fabric).toContain("if (way.consume() && !player.getAbilities().instabuild) stack.shrink(1);")
  for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
    const facade = summonClass("com.minemods.content_chiyou", genTarget(target))
    expect(facade).toContain("StudioPlatform.onUseItem(StudioSummon::useItem);")
    expect(facade).toContain("StudioPlatform.onUseBlock(StudioSummon::useBlock);")
    expect(facade).not.toContain("fabricmc")
  }
  expect(BOSS_INSTRUCTIONS).toContain("summon（可选，省略或 null 是不能召唤）")
})

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: two bosses that can be called up share the class, each adds itself, and the whole tree compiles`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-summon-"))
    roots.push(root)
    const directory = path.join(root, "石魔山口")
    await createTargetBossSample(directory, target)
    const project = await openProject(directory)
    const bosses = project.entities.filter((entity) => entity.boss)
    expect(bosses.length).toBeGreaterThanOrEqual(2)
    const ways = [inAir, { ...onAltar, item: "minecraft:blaze_rod" }]
    await saveProject(directory, { ...project, entities: project.entities.map((entity) => { const index = bosses.indexOf(entity); return index >= 0 && index < 2 ? { ...entity, boss: { ...entity.boss!, summon: ways[index] } } : entity }) }, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    expect(names.filter((name) => name.endsWith(`/${SUMMON_CLASS}.java`))).toHaveLength(1)
    const contents = await Promise.all(names.filter((name) => /\/StudioContent\w*\.java$/.test(name)).map((name) => readFile(path.join(source, name), "utf8")))
    expect(contents.join("\n").match(/StudioSummon\.add\(/g)).toHaveLength(2)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

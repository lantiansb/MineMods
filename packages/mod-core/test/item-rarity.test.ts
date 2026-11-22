import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { ItemSchema } from "../src/content"
import { ITEM_NATURE_INSTRUCTIONS } from "../src/content-words"
import { itemSource } from "../src/fabric/content-items"
import { CONTENT_1_20_1 } from "../src/platform/content-version"
import { modGuide } from "../src/guide"
import { openProject, saveProject } from "../src/project"
import type { TargetId } from "../src/target/ids"
import { createTargetContentSample } from "../script/target-content-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

// 主工程第 12 条：物品稀有度 rarity（普通 / 罕见 / 稀有 / 史诗），三端都用原版的 Rarity（名字变色）。不写或写普通的物品照旧生成。

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const item = (more: Record<string, unknown>) => ItemSchema.parse({ id: randomUUID(), identifier: "relic", name: "刑天之心", max_stack: 1, color: "#B3261E", ...more })
const RARE = "new Item.Properties().rarity(net.minecraft.world.item.Rarity.RARE)"

test("rarity 只认四档；写了就加在物品的属性上，普通物品、食物、工具、盔甲都一样；不写或写 common 照旧", () => {
  expect(ItemSchema.safeParse({ ...item({}), rarity: "legendary" }).success).toBe(false)
  expect(itemSource(item({}))).toBe("new Item(new Item.Properties().stacksTo(1))")
  expect(itemSource(item({ rarity: "common" }))).toBe("new Item(new Item.Properties().stacksTo(1))")
  expect(itemSource(item({ rarity: "rare" }))).toBe(`new Item(${RARE}.stacksTo(1))`)
  expect(itemSource(item({ rarity: "epic" }))).toContain("Rarity.EPIC")
  expect(itemSource(item({ rarity: "uncommon" }))).toContain("Rarity.UNCOMMON")
  const food = item({ max_stack: 16, rarity: "rare", food: { hunger: 4, saturation: 0.6, always_edible: false, snack: false } })
  expect(itemSource(food)).toStartWith(`new Item(${RARE}.stacksTo(16).food(`)
  expect(CONTENT_1_20_1.item(food)).toStartWith(`new Item(${RARE}.stacksTo(16).food(`)
  const sword = item({ rarity: "rare", tool: { kind: "sword", durability: 250, mining_level: "iron", mining_speed: 1, attack_damage: 6, attack_speed: null, enchantability: 14, repair: null } })
  expect(itemSource(sword)).toContain(`${RARE}.attributes(`)
  expect(CONTENT_1_20_1.item(sword)).toContain(`, ${RARE})`)
  expect(CONTENT_1_20_1.item(item({}))).toBe("new Item(new Item.Properties().stacksTo(1))")
})

test("给外部 AI 的说明和模组说明讲到稀有度", () => {
  expect(ITEM_NATURE_INSTRUCTIONS).toContain("rarity（可选）是游戏里的稀有度，只管名字的颜色：common 普通（白色）、uncommon 罕见（黄色）、rare 稀有（青色）、epic 史诗（紫色）")
})

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: 带稀有度的物品、食物和剑注册时用原版 Rarity，模组说明写出来，整棵树编译通过`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-rarity-"))
    roots.push(root)
    const directory = path.join(root, "琥珀工坊")
    await createTargetContentSample(directory, target)
    const project = await openProject(directory)
    const relic = item({ rarity: "epic" })
    const sword = item({ identifier: "rare_blade", name: "稀有之刃", rarity: "rare", tool: { kind: "sword", durability: 250, mining_level: "iron", mining_speed: 1, attack_damage: 6, attack_speed: null, enchantability: 14, repair: null } })
    const saved = await saveProject(directory, { ...project, items: [...project.items, relic, sword] }, project.revision)
    expect(modGuide(saved, { findings: [], animations: {}, poses: {}, glowing: [], built: false }).sections.flatMap((section) => section.lines.map((line) => line.text)).join("")).toContain("稀有度「史诗」，名字显示紫色")
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name))
    const registry = await readFile(names.find((name) => name.endsWith(`${path.sep}StudioContentRegistry.java`) || name.endsWith(`${path.sep}StudioContent.java`) && !names.some((other) => other.endsWith(`${path.sep}StudioContentRegistry.java`)))!, "utf8")
    expect(registry).toContain("Rarity.EPIC")
    expect(registry).toContain("Rarity.RARE")
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

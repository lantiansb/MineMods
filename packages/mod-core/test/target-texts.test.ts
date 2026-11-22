import { expect, test } from "bun:test"
import { compilerFindings, gameplayApiWords, GAMEPLAY_API_WORDS } from "../src/gameplay-check"
import { checkGameplayReferences } from "../src/gameplay-references"
import { GAMEPLAY_DISCIPLINE, GAMEPLAY_INSTRUCTIONS, GAMEPLAY_SHEET_INSTRUCTIONS, GAMEPLAY_STARTUP_WORDS, GAMEPLAY_WRITER_INSTRUCTIONS, gameplayDiscipline, gameplayInstructions, gameplayRuntimeWords, gameplaySheetInstructions, gameplayStartupWords, gameplayWriterInstructions } from "../src/gameplay-words"
import { gameplayRoot } from "../src/gameplay"
import { modGuide } from "../src/guide"
import type { Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { jarName } from "../src/release"
import { kindInstructions, MODULES } from "../src/workspace-modules"
import { BOX_GUARD, sampleProject } from "./fixtures/gameplay/sample"

/**
 * What gameplay code is told and checked against names the facts of the project's own target. Every target names the game's classes
 * by Mojang's official names; a Fabric 1.21.1 project is told Fabric API, a Forge 1.20.1 project is told Forge, 1.20.1 and Java 17.
 */

const FABRIC_FREELY =
  "Minecraft 1.21.1（Mojang 官方名称）和 Fabric API 可以自由使用。不能用 mixin、access widener 和反射。游戏的类一个一个写出来导入，不用 .* 通配导入。判断一个实体是不是敌人，用 instanceof Enemy（net.minecraft.world.entity.monster.Enemy），它同时覆盖原版的怪和这个工程里的敌对生物（包括 Boss）；不要用 Monster 类（net.minecraft.world.entity.monster.Monster），它不是所有敌人共有的：史莱姆、恶魂、幻翼、潜影贝都不是它的子类，工程里的生物也不是。"

test("the words for a Fabric project name Fabric API and the official names, word for word", () => {
  expect(GAMEPLAY_API_WORDS.at(-1)).toBe(FABRIC_FREELY)
  expect(gameplayApiWords("fabric-1.21.1")).toEqual(GAMEPLAY_API_WORDS)
  // Nothing a Fabric writer is told names the game the old way.
  for (const words of [...GAMEPLAY_API_WORDS, GAMEPLAY_STARTUP_WORDS, gameplayRuntimeWords("fabric-1.21.1"), GAMEPLAY_DISCIPLINE, GAMEPLAY_INSTRUCTIONS, GAMEPLAY_WRITER_INSTRUCTIONS])
    expect(words).not.toMatch(/Yarn|HostileEntity|PathAwareEntity|MobEntity|PlayerEntity|ServerWorld|Identifier\.of|isClient\(|canStart|tryAttack|DataTracker|ArrowEntity|Vec3d/)
  expect(GAMEPLAY_STARTUP_WORDS).toContain("⑥ 数据文件夹用 1.21.1 的名字：loot_table、recipe、advancement、tags/item、tags/block……（不带 s）；放在旧名字的文件夹里游戏不读也不报错。")
  expect(gameplayRuntimeWords("fabric-1.21.1")).toContain("例如 new Arrow(level, shooter, 箭, ItemStack.EMPTY) 能编译")
  expect(gameplayRuntimeWords("fabric-1.21.1")).toContain("拿不准的就查它在 1.21.1 里的真实要求")
  expect(gameplayDiscipline("fabric-1.21.1")).toBe(GAMEPLAY_DISCIPLINE)
  expect(gameplayInstructions("fabric-1.21.1")).toBe(GAMEPLAY_INSTRUCTIONS)
  expect(gameplaySheetInstructions("fabric-1.21.1")).toBe(GAMEPLAY_SHEET_INSTRUCTIONS)
  expect(gameplayWriterInstructions("fabric-1.21.1")).toBe(GAMEPLAY_WRITER_INSTRUCTIONS)
})

test("the words for a Forge 1.20.1 project name Forge, 1.20.1 and the official names", () => {
  const api = gameplayApiWords("forge-1.20.1").at(-1)!
  // D 组: on Forge the loader is reached only through Studio's ProjectPlatform / ProjectClient, never named itself.
  expect(api).toStartWith("Minecraft 1.20.1（Mojang 官方名称）可以自由使用；加载器（Forge）的事只经 ProjectPlatform / ProjectClient。")
  expect(api).toContain("instanceof Enemy（net.minecraft.world.entity.monster.Enemy）")
  expect(api).toBe(FABRIC_FREELY.replace("1.21.1", "1.20.1").replace("和 Fabric API 可以自由使用。", "可以自由使用；加载器（Forge）的事只经 ProjectPlatform / ProjectClient。"))
  expect(api).not.toContain("Yarn")
  expect(gameplayStartupWords("forge-1.20.1")).toContain("⑥ 数据文件夹用 1.20.1 的名字：loot_tables、recipes、advancements、tags/items、tags/blocks……（带 s）")
  const runtime = gameplayRuntimeWords("forge-1.20.1")
  expect(runtime).toContain("拿不准的就查它在 1.20.1 里的真实要求")
  // The arrow example is a fact of 1.21.1; it is not told to a game that has no such constructor, and is told to every 1.21.1 target.
  expect(runtime).not.toContain("new Arrow(")
  expect(gameplayRuntimeWords("neoforge-1.21.1")).toContain("例如 new Arrow(level, shooter, 箭, ItemStack.EMPTY) 能编译")
  for (const text of [gameplayDiscipline("forge-1.20.1"), gameplayInstructions("forge-1.20.1"), gameplayWriterInstructions("forge-1.20.1")]) {
    expect(text).not.toContain("1.21.1")
    expect(text).toContain("1.20.1")
  }
  expect(gameplayInstructions("neoforge-1.21.1")).toContain("Minecraft 1.21.1（Mojang 官方名称）可以自由使用；加载器（NeoForge）的事只经 ProjectPlatform / ProjectClient。")
})

test("a compile hint names the project's game, loader and names", () => {
  const folder = gameplayRoot("moonmod").replaceAll(".", "/")
  const output = [
    `/work/src/main/java/${folder}/guard/Main.java:12: error: cannot find symbol`,
    "    Foo.bar();",
    "    ^",
    "  symbol:   class Foo",
    "  location: class Main",
    `/work/src/main/java/${folder}/guard/Main.java:3: error: package net.minecraft.entity.mob does not exist`,
    `/work/src/main/java/${folder}/guard/Main.java:20: error: incompatible types: int cannot be converted to String`,
  ].join("\n")
  const fabric = compilerFindings(output, "moonmod", "guard").own.map((finding) => finding.fix)
  expect(fabric).toEqual([
    "这个名字在 Minecraft 1.21.1（Mojang 官方名称）或 Fabric API 里不存在，或者少了 import。核对拼写、参数和 import；不确定的接口不要凭印象写。",
    "核对 import 的包名：用的是 Minecraft 1.21.1 的 Mojang 官方名称（net.minecraft.…），不是 Yarn 名称，也不是别的版本。",
    "按这个方法在 1.21.1 里真正的参数和返回类型来写。",
  ])
  expect(compilerFindings(output, "moonmod", "guard", "fabric-1.21.1").own.map((finding) => finding.fix)).toEqual(fabric)
  expect(compilerFindings(output, "moonmod", "guard", "forge-1.20.1").own.map((finding) => finding.fix)).toEqual([
    "这个名字在 Minecraft 1.20.1（Mojang 官方名称）或 Studio 生成的 ProjectPlatform / ProjectClient 里不存在，或者少了 import。核对拼写、参数和 import；不确定的接口不要凭印象写。",
    "核对 import 的包名：用的是 Minecraft 1.20.1 的 Mojang 官方名称（net.minecraft.…），不是 Yarn 名称，也不是别的版本。",
    "按这个方法在 1.20.1 里真正的参数和返回类型来写。",
  ])
})

test("a data file is held to the folder names of the project's game", () => {
  const project = sampleProject()
  const forge: Project = { ...project, target: "forge-1.20.1" }
  const at = (folder: string) => ({ ...BOX_GUARD, data: [{ path: `data/${project.mod_id}/${folder}/chests/box.json`, content: '{"type":"minecraft:chest","pools":[]}' }] })
  const folderFindings = (in_: Project, folder: string) => checkGameplayReferences(in_, at(folder), null).filter((finding) => finding.rule === "data_folder")
  expect(folderFindings(project, "loot_tables").map((finding) => [finding.message, finding.fix])).toEqual([
    [`这个数据文件放在 loot_tables 文件夹里，那是旧版本游戏的名字：1.21.1 不读这个文件夹，文件等于没有，游戏也不会报错。`, "把文件夹改名为 loot_table（1.21 起这些文件夹都改成了不带 s 的名字）。"],
  ])
  expect(folderFindings(project, "loot_table")).toEqual([])
  expect(folderFindings(forge, "loot_tables")).toEqual([])
  expect(folderFindings(forge, "loot_table").map((finding) => [finding.message, finding.fix])).toEqual([
    [`这个数据文件放在 loot_table 文件夹里，那是 1.21 起新版本游戏的名字：1.20.1 不读这个文件夹，文件等于没有，游戏也不会报错。`, "把文件夹改名为 loot_tables（1.20.1 用的还是带 s 的名字）。"],
  ])
})

test("the mod guide says how to install the mod for its own target", () => {
  const install = (project: Project) => {
    const animations = Object.fromEntries(project.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]]))
    const lines = modGuide(project, { findings: reconcile(project, { animations }), animations, glowing: [], built: false }).sections.flatMap((section) => section.lines.map((line) => line.text))
    return lines.filter((line) => line.includes("模组，给 Minecraft") || line.startsWith("先装好"))
  }
  const project = sampleProject()
  expect(install(project)).toEqual([
    "这是一个 Fabric 模组，给 Minecraft 1.21.1（Java 版）用，需要 Java 21。",
    `先装好 Fabric Loader（0.17.2 或更新），再把三个文件放进游戏的 mods 文件夹：这个模组的 ${jarName(project)}、Fabric API（0.116.6+1.21.1 或更新）和 GeckoLib 4.8.3 或更新的 4.x（Fabric 1.21.1 版）。缺了后两个，游戏会在启动时提示缺少前置。`,
  ])
  const forge: Project = { ...project, target: "forge-1.20.1" }
  expect(install(forge)).toEqual([
    "这是一个 Forge 模组，给 Minecraft 1.20.1（Java 版）用，需要 Java 17。",
    `先装好 Forge（47.4.28 或更新），再把两个文件放进游戏的 mods 文件夹：这个模组的 ${jarName(forge)} 和 GeckoLib 4.8.4 或更新的 4.x（Forge 1.20.1 版）。缺了 GeckoLib，游戏会在启动时提示缺少前置。`,
  ])
})

test("what a task of a kind is told follows the project's target only where the words name it", () => {
  for (const kind of Object.keys(MODULES) as (keyof typeof MODULES)[]) expect(kindInstructions(kind, "fabric-1.21.1")).toBe(MODULES[kind].instructions)
  expect(kindInstructions("gameplay", "forge-1.20.1")).toContain("Minecraft 1.20.1（Mojang 官方名称）可以自由使用；加载器（Forge）的事只经 ProjectPlatform / ProjectClient。")
  expect(kindInstructions("block", "forge-1.20.1")).toBe(MODULES.block.instructions)
})

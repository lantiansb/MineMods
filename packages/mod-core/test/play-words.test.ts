import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CREATIVE_TAKE_WORDS, GAMEPLAY_API, gameplayThings, gameplayTryList, NEW_WORLD_WORDS, type GameplayDocument } from "../src/gameplay"
import { LOAD_CALLBACKS } from "../src/gameplay-scan"
import { GAMEPLAY_DISCIPLINE, GAMEPLAY_FORM_EXAMPLE, GAMEPLAY_SHEET_INSTRUCTIONS } from "../src/gameplay-words"
import { modGuide } from "../src/guide"
import { LogicSchema } from "../src/content"
import { byHandLines, itemTab } from "../src/play-by-hand"
import { EVENT_WORDS, TRIGGER_WORDS, command, commandPieces, handoutWords, identifiersIn, mostlyCode, plainWords, sayPieces, splitForPerson, typeIn, withoutMarks } from "../src/play-words"
import { ProjectSchema, type Project } from "../src/project"
import { reconcile } from "../src/reconcile"
import { WorkspaceAssetSchema } from "../src/workspace"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { BOX_GUARD, IDS, sampleProject } from "./fixtures/gameplay/sample"
import { expectPlainGuide } from "./fixtures/plain-guide"

const NOW = "2026-10-14T08:00:00.000Z"
const withGameplay = (project: Project, document: GameplayDocument) =>
  ProjectSchema.parse({
    ...project,
    workspace: { assets: [...project.workspace.assets, WorkspaceAssetSchema.parse({ id: IDS.box_guard, module: "gameplay", title: document.name, revision: 1, created_at: NOW, updated_at: NOW, prompt: "守着秘匣的生物", dependencies: document.uses, document, provenance: { model: "gpt-6-astra", request_id: null }, status: "ready" })] },
  })
const guideOf = (project: Project) => {
  const animations = Object.fromEntries(project.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]]))
  return modGuide(project, { findings: reconcile(project, { animations }), animations, glowing: [], built: false })
}

/** The retest's gameplay: its description was written with the game's own event name in it, which is what a new player was shown. */
const TICKING: GameplayDocument = {
  ...BOX_GUARD,
  summary: "每个 ServerTickEvents.END_WORLD_TICK 检查一次：秘匣附近有玩家就惊动守卫。",
  behaviours: [
    { when: "每个 END_WORLD_TICK（world.getTime() % 20 == 0）", does: "检查 12 格以内有没有玩家，调用 alertGuards() 惊动守卫", shows: "守卫转头看向玩家，同时 onChunkLoad 里记下位置" },
    ...BOX_GUARD.behaviours.slice(1),
  ],
  not_doing: ["不会在 ServerChunkEvents.CHUNK_LOAD 里改世界"],
}

test("a game event an AI wrote into a description is said as when it happens; any other name stays in the sentence as a piece of code, never replaced by a placeholder", () => {
  expect(plainWords("每个 END_WORLD_TICK 检查一次")).toBe("每个 游戏每走一小步（每秒 20 次）的时候 检查一次")
  expect(plainWords("在 ServerTickEvents.END_WORLD_TICK 里再做")).toBe("在 游戏每走一小步（每秒 20 次）的时候 里再做")
  expect(plainWords("UseBlockCallback.EVENT 触发")).toBe("玩家右键一个方块的时候 触发")
  // Round 18 showed 「游戏里的某个操作」 for every name that was not a known moment: the claim was lost. Now the name stays where it was written.
  const unknown = plainWords("每当 SOME_NEW_THING 发生就调用 world.getTopY(x, z)，并执行 doThing() 和 Main::tick")
  expect(unknown).not.toContain("游戏里的某个操作")
  expect(unknown).toContain("SOME_NEW_THING")
  expect(unknown).toContain("每当")
  // A command is what the person types and stays as it is; a sentence without code is not touched.
  expect(plainWords(`粘贴 ${command("/give @s my_mod:moon_dew")} 再按回车`)).toBe(`粘贴 ${command("/give @s my_mod:moon_dew")} 再按回车`)
  expect(plainWords("玩家右键时给 1 个物品，5 秒内不再给")).toBe("玩家右键时给 1 个物品，5 秒内不再给")
})

test("round 18's real sentences: the claim stays readable, the class and file names become inline code, and a developer's note goes under 高级", () => {
  // The 近距鸣叫 card: a class name, a file name and a folder name written inside a sentence.
  const alarm = "识别 HabitAlertGoal 在 Main.java 里注册，generated 里写了"
  expect(mostlyCode(alarm)).toBe(false)
  const pieces = sayPieces(alarm)
  expect(pieces.filter((piece) => piece.code).map((piece) => piece.text)).toEqual(expect.arrayContaining(["HabitAlertGoal", "Main.java"]))
  expect(pieces.map((piece) => piece.text).join("")).toBe(alarm)
  // The failed population-cap card: Studio's own wording was never a sentence, and the AI's one named two classes.
  const cap = "找不到类 SpawnRestriction（在 ProjectContent 里）"
  expect(mostlyCode(cap)).toBe(false)
  expect(sayPieces(cap).filter((piece) => piece.code).map((piece) => piece.text)).toEqual(expect.arrayContaining(["SpawnRestriction", "ProjectContent"]))
  expect(plainWords(cap)).toBe(cap)
  // A developer's note, a stack frame and an exception are code with a few words around them: not a sentence a person can use.
  for (const note of ["第九轮合法模型已通过脚本 schema和compileModel，但MCP look连续返回操作未完成；同输入只读reviewAsset复现 TypeError at model-look.ts colorDistance/marks。", "java.lang.NullPointerException: x", "    at studio.Mod.tick(Mod.java:3)"]) expect([note, mostlyCode(note)]).toEqual([note, true])
  // Product names and numbers are not code at all; a registry name is a name inside a sentence, set as a token and never sent under 高级 on its own.
  for (const fine of ["用 GeckoLib 4.8.3 和 Minecraft 1.21.1。", "走路时每秒 0.2 格，MineMods Studio 量的。"]) expect([fine, mostlyCode(fine), sayPieces(fine).some((piece) => piece.code)]).toEqual([fine, false, false])
  expect([mostlyCode("掉 1 到 2 块 minecraft:mossy_cobblestone。"), sayPieces("掉 1 到 2 块 minecraft:mossy_cobblestone。").filter((piece) => piece.code).map((piece) => piece.text)]).toEqual([false, ["minecraft:mossy_cobblestone"]])
  const split = splitForPerson(["吐息的气流要跟着打出去的方向走。", "java.lang.NullPointerException: x", alarm])
  expect(split.shown).toEqual(["吐息的气流要跟着打出去的方向走。", alarm])
  expect(split.technical).toEqual(["java.lang.NullPointerException: x"])
})

test("every moment the code scan knows by name has its plain words", () => {
  for (const callback of LOAD_CALLBACKS) {
    const name = `${callback.owner}.${callback.event}`
    const row = EVENT_WORDS.find(([pattern]) => pattern.test(name))
    expect([name, !!row]).toEqual([name, true])
    expect(identifiersIn(plainWords(name))).toEqual([])
  }
  for (const name of ["ServerTickEvents.END_WORLD_TICK", "ServerTickEvents.END_SERVER_TICK", "ClientTickEvents.END_CLIENT_TICK", "ServerLifecycleEvents.SERVER_STARTING", "ServerLifecycleEvents.SERVER_STARTED", "ServerPlayConnectionEvents.DISCONNECT", "ClientPlayConnectionEvents.DISCONNECT", "UseBlockCallback.EVENT"]) {
    expect([name, EVENT_WORDS.some(([pattern]) => pattern.test(name))]).toEqual([name, true])
  }
})

test("every kind of trigger a creature's rule can have has plain words, with no code in them", () => {
  for (const kind of LogicSchema.shape.trigger.options) {
    const said = TRIGGER_WORDS[kind]("「月露」")
    expect(identifiersIn(said)).toEqual([])
    expect(said).toMatch(/[一-鿿]/)
  }
  expect(Object.keys(TRIGGER_WORDS).sort()).toEqual([...LogicSchema.shape.trigger.options].sort())
})

test("what counts as code in words for a person: events, calls, camelCase and snake_case names; not commands, file names or product names", () => {
  for (const code of ["java.net.Socket", "net.minecraft.world.World", "HabitAlertGoal", "Main.java", "END_WORLD_TICK", "ServerTickEvents.END_WORLD_TICK", "world.getTopY(x)", "onChunkLoad", "tick()", "Main::tick", "moon_dew", "minecraft:iron_ingot"]) expect([code, identifiersIn(`说到 ${code} 的时候`).length > 0]).toEqual([code, true])
  for (const fine of ["GeckoLib 4.8 和 MineMods", "legacy_sample-0.1.0.jar", "模组说明.md", "按 F3+B 显示", `粘贴 ${command("/tp @e[type=my_mod:creature_1,limit=1] ^ ^ ^6")} 再按回车`, "5 秒内 1–2 个"]) expect([fine, identifiersIn(fine)]).toEqual([fine, []])
})

test("a command is one line the window can copy: pieces are cut at the backticks and nothing else is", () => {
  expect(commandPieces(`先 ${command("/give @s a:b")} 再 ${command("/time set day")}`)).toEqual([{ text: "先 " }, { text: "/give @s a:b", command: true }, { text: " 再 " }, { text: "/time set day", command: true }])
  expect(commandPieces("没有命令的一句话")).toEqual([{ text: "没有命令的一句话" }])
  expect(withoutMarks(typeIn("/time set day"))).toBe("按 T 打开聊天框，粘贴 /time set day 再按回车")
})

test("the try-it list gets hold of a thing without a command first, and the command is one line that says how to type it", () => {
  const list = gameplayTryList("legacy_sample", BOX_GUARD, gameplayThings(sampleProject()))
  expect(list.prepare[0]).toContain(NEW_WORLD_WORDS)
  expect(NEW_WORLD_WORDS).toContain("创造")
  const [chest, dew, creature] = list.prepare.slice(1)
  // The inventory way comes before the command, by the name the person knows.
  expect(chest).toContain("搜索物品")
  expect(chest).toContain("「秘匣」")
  expect(chest!.indexOf("搜索物品")).toBeLessThan(chest!.indexOf("`/give"))
  expect(dew!.indexOf("搜索物品")).toBeLessThan(dew!.indexOf("`/give"))
  expect(chest).toContain("按 T 打开聊天框")
  expect(chest).toContain("`/give @s legacy_sample:mystery_box`")
  // A creature has an egg: the egg first, then the command.
  expect(creature).toContain("「苔皮苦力怕刷怪蛋」")
  expect(creature!.indexOf("刷怪蛋")).toBeLessThan(creature!.indexOf("`/summon"))
  for (const line of list.prepare) expect(identifiersIn(line)).toEqual([])
})

test("broad18 w2: the creative inventory takes two clicks, and every place that tells a person how to get an item says both", () => {
  // In Creative the first click on an item in the list only puts it on the cursor; a second click on a hotbar slot puts it down (1.21.1 CreativeInventoryScreen.onMouseClick, see CREATIVE_TAKE_WORDS).
  expect(CREATIVE_TAKE_WORDS).toContain("跟在鼠标上")
  expect(CREATIVE_TAKE_WORDS).toContain("再点一下快捷栏")
  const project = sampleProject()
  const texts = [
    ...byHandLines(project).map((line) => line.text),
    ...gameplayTryList("legacy_sample", BOX_GUARD, gameplayThings(project)).prepare,
  ]
  // The sentence that sent a person to the hotbar after one click is gone from all of them.
  for (const text of texts) {
    expect(text).not.toContain("点一下它就放进快捷栏")
    expect(text).not.toContain("点一下它放进快捷栏")
  }
  // Each way of getting an item (search by name, the block, the spawn egg) carries the second click.
  const taking = texts.filter((text) => text.includes("搜索物品") || text.includes("刷怪蛋"))
  expect(taking.length).toBeGreaterThanOrEqual(4)
  for (const text of taking) expect(text).toContain(CREATIVE_TAKE_WORDS)
  // Shift-click is not offered as a shortcut: in the creative list it only makes the stack on the cursor a full one.
  for (const text of texts) expect(text).not.toMatch(/Shift|shift/)
})

test("seeing the things by hand: a creative world, the inventory by name, the egg, and where a thing turns up by itself", () => {
  const project = sampleProject()
  const lines = byHandLines(project).map((line) => line.text)
  expect(lines[0]).toContain("创造")
  expect(lines[0]).toContain("允许作弊")
  // The mod has no tab of its own and says so; what is in which of the game's own tabs is said from the way the build puts them there.
  expect(lines.find((line) => line.includes("没有一个单独的模组页签"))).toContain("搜索物品")
  expect(lines).toContain("在「建筑方块」页签里能找到：「秘匣」。")
  expect(lines).toContain("在「原材料」页签里能找到：「月露」。")
  expect(lines.find((line) => line.includes("刷怪蛋"))).toContain("「苔皮苦力怕刷怪蛋」")
  // A creature that spawns by itself says where and when to look.
  expect(lines.find((line) => line.includes("不用蛋也行"))).toContain("森林")
  expect(lines.find((line) => line.includes("不用蛋也行"))).toContain("只在暗处出现")
  // The command comes last, as a line to paste, with what it does.
  const last = lines.at(-1)!
  expect(last).toContain("`/give @s legacy_sample:mystery_box`")
  expect(last).toContain("按 T 打开聊天框")
  lines.forEach((line) => expect(identifiersIn(line)).toEqual([]))
  // A project with nothing in it has nothing to find.
  expect(byHandLines({ ...project, blocks: [], items: [], entities: [], workspace: { assets: [] } })).toEqual([])
  // A tool is in the tab of its kind, food with the food, anything else with the ingredients (the way `content-items.ts` registers them).
  expect(itemTab({ tool: { kind: "sword" } as never, food: undefined })).toBe("战斗用品")
  expect(itemTab({ tool: { kind: "pickaxe" } as never, food: undefined })).toBe("工具与实用物品")
  expect(itemTab({ tool: undefined, food: { hunger: 2 } as never })).toBe("食物与饮品")
  expect(itemTab({ tool: undefined, food: undefined })).toBe("原材料")
})

test("a block that generates by itself is looked for in a new world, at its height", () => {
  const project = sampleProject()
  const ore = { ...project.blocks[0]!, generation: { dimension: "overworld", replaces: ["stone"], min_y: -16, max_y: 48, veins_per_chunk: 8, vein_size: 6, spread: "middle" } } as Project["blocks"][number]
  const lines = byHandLines({ ...project, blocks: [ore] }).map((line) => line.text)
  const found = lines.find((line) => line.includes("会自己长在世界里"))!
  expect(found).toContain("新建的世界里找")
  expect(found).toContain("F3")
  expect(identifiersIn(found)).toEqual([])
})

test("the guide handout keeps no name of code: a known moment is said as when it happens and any other name becomes a plain gap, without losing the sentence around it", () => {
  expect(handoutWords("检查 12 格以内有没有玩家，调用 alertGuards() 惊动守卫（world.getTime() % 20 == 0）")).toBe("检查 12 格以内有没有玩家，调用 游戏里的某个部分 惊动守卫")
  expect(handoutWords("识别 HabitAlertGoal 在 Main.java 里注册")).toBe("识别 游戏里的某个部分 在 游戏里的某个部分 里注册")
  expect(handoutWords(`粘贴 ${command("/give @s a:b")} 再按回车`)).toBe(`粘贴 ${command("/give @s a:b")} 再按回车`)
})

test("a gameplay described with the game's event names is shown to a person in plain words, in the guide and its markdown", () => {
  const project = withGameplay(sampleProject(), TICKING)
  const guide = guideOf(project)
  // The retest's words are in the saved description, and they are not in anything the person reads.
  expect(JSON.stringify(project.workspace.assets.at(-1)!.document)).toContain("END_WORLD_TICK")
  expect(guide.markdown).not.toMatch(/END_WORLD_TICK|CHUNK_LOAD|onChunkLoad|alertGuards|getTime/)
  expect(guide.markdown).toContain("游戏每走一小步（每秒 20 次）的时候")
  expectPlainGuide(guide)
  // The steps to try it carry the same words and the new world to make first.
  const section = guide.sections.find((value) => value.title.startsWith("玩法"))!
  expect(section.lines.some((line) => line.text.includes(NEW_WORLD_WORDS))).toBe(true)
  expect(section.lines.some((line) => line.text.startsWith("试第 1 条") && line.text.includes("游戏每走一小步"))).toBe(true)
})

test("no line of the guide, for the sample mod with or without a gameplay, is a piece of code outside its commands", () => {
  expectPlainGuide(guideOf(sampleProject()))
  expectPlainGuide(guideOf(withGameplay(sampleProject(), BOX_GUARD)))
  // Every command in the guide is between backticks and has its words before it (it says what it does and how to type it).
  const markdown = guideOf(withGameplay(sampleProject(), TICKING)).markdown
  const commands = [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!)
  expect(commands.length).toBeGreaterThan(0)
  commands.forEach((text) => expect(text.startsWith("/")).toBe(true))
  expect(GAMEPLAY_API.main).toBe("Main.java")
})

test("the writer is told the description is for a player who cannot program, and the example it is given is already in such words", () => {
  for (const words of [GAMEPLAY_DISCIPLINE, GAMEPLAY_SHEET_INSTRUCTIONS]) {
    expect(words).toContain("不懂编程的玩家")
    expect(words).toContain("不要写游戏的事件名、类名、方法名")
  }
  expect(identifiersIn(Object.values(GAMEPLAY_FORM_EXAMPLE).join("；"))).toEqual([])
})

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

test("the guide of a mod with a boss, abilities, effects, a chain of gameplay and an ore says no piece of code outside its commands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-plain-guide-"))
  roots.push(root)
  const rich = await createDataGameplaySample(path.join(root, "project"), { chain: true, life: true, abilities: true, effects: true, hitbox: true })
  const guide = guideOf(rich)
  expectPlainGuide(guide)
  // An ore generates by itself: it is looked for in a new world, at its height.
  expect(guide.sections.find((value) => value.title === "进游戏找到这些东西")!.lines.some((line) => line.text.includes("会自己长在世界里") && line.text.includes("F3"))).toBe(true)
  // Every command the guide holds is one line with a leading slash, and a person is told once how to type one.
  const commands = [...guide.markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!)
  expect(commands.length).toBeGreaterThan(3)
  commands.forEach((text) => expect(text.startsWith("/")).toBe(true))
  expect(guide.markdown).toContain("按 T 打开聊天框")
}, 60000)

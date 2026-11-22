import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { vanillaCraftingFile } from "../script/vanilla-crafting"
import { RecipeSchema } from "../src/content"
import { MINECRAFT_ITEM_TAGS } from "../src/fabric/content-vanilla"
import { VANILLA_CRAFTING } from "../src/fabric/vanilla-crafting"
import { createProject } from "../src/project"
import { recipeClashes, recipeThing, vanillaClashes, type ClashRecipe } from "../src/recipe-clash"
import { reconcile } from "../src/reconcile"
import { WorkspaceAssetSchema, applyWorkspaceAsset } from "../src/workspace"
import { MODULES } from "../src/workspace"
import { RECIPE_INSTRUCTIONS } from "../src/content-words"
import { HAS_GAME_DATA, MINECRAFT_DATA_JAR } from "./java-tree"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true }))))

/** The nine slots from three rows of three, "." for an empty one; letters stand for the items given. */
const grid = (rows: string[], items: Record<string, string>) => rows.join("").split("").map((cell) => (cell === "." ? null : items[cell]!))
let count = 0
const recipe = (rows: string[], items: Record<string, string>, change: Partial<ClashRecipe> = {}): ClashRecipe => ({ id: `recipe-${++count}`, name: `配方${count}`, pattern: grid(rows, items), result: "duck_mod:pot", count: 1, ...change })
const said = (reference: string) => `「${reference.split(":")[1]}」`

// ---- the table ----

test.skipIf(!HAS_GAME_DATA)("the checked-in table of the game's crafting recipes is what the script makes from the game's jar", async () => {
  // A checkout may have turned the file's line ends into CRLF; the script writes LF.
  expect(vanillaCraftingFile(MINECRAFT_DATA_JAR)).toBe((await readFile(fileURLToPath(new URL("../src/fabric/vanilla-crafting.ts", import.meta.url)), "utf8")).replaceAll("\r\n", "\n"))
})

test("the table holds the shaped and shapeless crafting recipes of 1.21.1 and nothing else", () => {
  // 634 shaped and 253 shapeless recipe files in the 1.21.1 jar (the special recipes, the cooked and the cut ones are not in it).
  expect(VANILLA_CRAFTING.shaped).toHaveLength(634)
  expect(VANILLA_CRAFTING.shapeless).toHaveLength(253)
  expect(VANILLA_CRAFTING.tags).toHaveLength(147)
  // Every tag a project may name has its items in the table, so none is compared by its name only.
  expect([...MINECRAFT_ITEM_TAGS].filter((name) => !VANILLA_CRAFTING.tags.some((entry) => entry[0] === name))).toEqual([])
  // Tags are followed down to items: planks hold the planks of every wood, and the logs of a wood come up through the tags inside the tag of all logs.
  const tag = (name: string) => VANILLA_CRAFTING.tags.find((entry) => entry[0] === name)![1].map((item) => VANILLA_CRAFTING.items[item])
  expect(tag("planks")).toContain("oak_planks")
  expect(tag("planks")).toContain("bamboo_planks")
  expect(tag("logs")).toEqual(expect.arrayContaining(["oak_log", "stripped_crimson_stem", "birch_wood"]))
  expect(tag("logs")).not.toContain("#minecraft:oak_logs")
})

// ---- one recipe against the game's ----

test("a recipe that lays out what a recipe of the game takes is found, wherever it sits on the grid and mirrored", () => {
  const brick = "minecraft:brick"
  // broad8 w3: three bricks in a V were the game's flower pot.
  expect(vanillaClashes(recipe(["B.B", ".B.", "..."], { B: brick }))).toEqual(["flower_pot"])
  expect(vanillaClashes(recipe(["...", "B.B", ".B."], { B: brick }))).toEqual(["flower_pot"])
  expect(vanillaClashes(recipe([".B.", "...", "..."], { B: brick }))).toEqual([])
  // One more cell, one fewer, another item: not the same.
  expect(vanillaClashes(recipe(["B.B", ".B.", ".B."], { B: brick }))).toEqual([])
  expect(vanillaClashes(recipe(["B.B", "...", "..."], { B: brick }))).toEqual([])
  expect(vanillaClashes(recipe(["B.B", ".S.", "..."], { B: brick, S: "minecraft:stick" }))).toEqual([])
  // The stairs lie left, mirrored they lie right: the game takes both, so both are the game's.
  const stairs = { P: "minecraft:oak_planks" }
  expect(vanillaClashes(recipe(["P..", "PP.", "PPP"], stairs))).toContain("oak_stairs")
  expect(vanillaClashes(recipe(["..P", ".PP", "PPP"], stairs))).toContain("oak_stairs")
  // Turned over is another shape.
  expect(vanillaClashes(recipe(["PPP", "PP.", "P.."], stairs))).not.toContain("oak_stairs")
  // The project's own things are never the game's.
  expect(vanillaClashes(recipe(["B.B", ".B.", "..."], { B: "duck_mod:brick" }))).toEqual([])
})

test("a recipe with no order is found by what it takes, and the order of a shaped one does not hide it from a shapeless one", () => {
  // broad8 w3: one sunflower was yellow dye.
  expect(vanillaClashes(recipe(["S..", "...", "..."], { S: "minecraft:sunflower" }, { type: "shapeless" }))).toContain("yellow_dye")
  expect(vanillaClashes(recipe([".S.", "...", "..."], { S: "minecraft:sunflower" }))).toContain("yellow_dye")
  // Three things in any places.
  const pie = { E: "minecraft:egg", P: "minecraft:pumpkin", S: "minecraft:sugar" }
  expect(vanillaClashes(recipe(["E..", ".P.", "..S"], pie, { type: "shapeless" }))).toEqual(["pumpkin_pie"])
  expect(vanillaClashes(recipe(["SP.", "E..", "..."], pie))).toEqual(["pumpkin_pie"])
  expect(vanillaClashes(recipe(["SP.", "S..", "..."], pie, { type: "shapeless" }))).toEqual([])
  expect(vanillaClashes(recipe(["EP.", "...", "..."], pie, { type: "shapeless" }))).toEqual([])
  // Several of one thing are several: two sunflowers are not one.
  expect(vanillaClashes(recipe(["SS.", "...", "..."], { S: "minecraft:sunflower" }, { type: "shapeless" }))).not.toContain("yellow_dye")
})

test("a tag in a recipe clashes with every recipe of an item it holds, and a tag the game does not have only with itself", () => {
  // Any planks, two by two, are a crafting table; any log alone is the planks of its wood (the logs of one wood are a tag of their own).
  expect(vanillaClashes(recipe(["PP.", "PP.", "..."], { P: "#minecraft:planks" }))).toContain("crafting_table")
  expect(vanillaClashes(recipe(["L..", "...", "..."], { L: "#minecraft:logs" }, { type: "shapeless" }))).toEqual(expect.arrayContaining(["oak_planks", "crimson_planks"]))
  // An item from the tag against a vanilla recipe that takes the tag.
  expect(vanillaClashes(recipe(["PP.", "PP.", "..."], { P: "minecraft:cherry_planks" }))).toContain("crafting_table")
  // Fabric's convention tags have their members in Fabric's data, not the game's: they are held only against themselves.
  expect(vanillaClashes(recipe(["III", ".S.", ".S."], { I: "#c:ingots/iron", S: "minecraft:stick" }))).toEqual([])
  const own = [recipe(["I..", "...", "..."], { I: "#c:ingots/iron" }), recipe(["I..", "...", "..."], { I: "#c:ingots/gold" }), recipe([".I.", "...", "..."], { I: "#c:ingots/iron" }, { result: "duck_mod:other" })]
  expect(recipeClashes(own[2]!, own, said).map((clash) => (clash.with.kind === "project" ? clash.with.id : "vanilla"))).toEqual([own[0]!.id])
  // A tag the game has that none of its recipes takes is still resolved.
  expect(vanillaClashes(recipe(["F..", "...", "..."], { F: "#minecraft:small_flowers" }, { type: "shapeless" }))).toEqual(expect.arrayContaining(["orange_dye", "yellow_dye"]))
})

test("only the crafting kinds are held against the crafting table", () => {
  const sunflower = { S: "minecraft:sunflower" }
  ;["smelting", "blasting", "smoking", "campfire", "stonecutting"].forEach((type) => expect(vanillaClashes(recipe(["S..", "...", "..."], sunflower, { type }))).toEqual([]))
  expect(recipeClashes(recipe(["S..", "...", "..."], sunflower, { type: "smelting" }), [recipe(["S..", "...", "..."], sunflower, { type: "smelting" })], said)).toEqual([])
  // A smelting recipe and a crafting recipe on the same item are on different stations.
  const crafting = recipe(["S..", "...", "..."], sunflower, { result: "duck_mod:a" })
  expect(recipeClashes(crafting, [recipe(["S..", "...", "..."], sunflower, { type: "smelting", result: "duck_mod:b" })], said).filter((clash) => clash.with.kind === "project")).toEqual([])
})

// ---- the words ----

test("a clash is said in plain words with the game's item named, and what to change", () => {
  const pot = recipe(["B.B", ".B.", "..."], { B: "minecraft:brick" }, { name: "红砖花盆" })
  const [clash] = recipeClashes(pot, [], (reference) => recipeThing({ mod_id: "duck_mod", blocks: [], items: [{ identifier: "pot", name: "红砖盆" } as never] }, reference))
  expect(clash).toEqual({
    with: { kind: "vanilla", results: ["flower_pot"] },
    stops: true,
    text: "配方「红砖花盆」的材料和摆法和原版的「花盆」配方一样：玩家在工作台上这样放，游戏先认出的是原版的配方，做出来的是原版的物品，不是「红砖盆」。",
    fix: "换掉其中一种材料，或者换一种摆法（多放一格、少放一格也行），让它和原版的配方不一样。",
  })
  const dye = recipeClashes(recipe(["S..", "...", "..."], { S: "minecraft:sunflower" }, { type: "shapeless", name: "向日葵块" }), [], said)[0]!
  expect(dye.text).toStartWith("配方「向日葵块」的材料和原版的「黄色染料」配方一样")
  // Many of the game's items are named three at a time.
  const planks = recipeClashes(recipe(["L..", "...", "..."], { L: "#minecraft:logs" }, { type: "shapeless" }), [], said)[0]!
  expect(planks.text).toContain("和原版的「金合欢木板」、「白桦木板」、「樱花木板」等 10 种配方一样")
  expect(recipeThing({ mod_id: "duck_mod", blocks: [], items: [] }, "minecraft:bread")).toBe("「面包」")
})

// ---- two recipes of the project ----

test("two recipes of a project that take the same things are found, shifted or mirrored; two that make the same thing only repeat", () => {
  const items = { A: "duck_mod:azure_shard", S: "minecraft:stick" }
  const first = recipe(["AA.", ".S.", ".S."], items, { name: "蓝晶镐", result: "duck_mod:pick" })
  const shifted = recipe(["...", ".AA", "..S"].map((row) => row), { A: items.A, S: items.S }, { name: "移位的", result: "duck_mod:axe" })
  expect(recipeClashes(shifted, [first], said)).toEqual([])
  const mirrored = recipe([".AA", ".S.", ".S."], items, { name: "镜像的", result: "duck_mod:axe" })
  const [clash] = recipeClashes(mirrored, [first], said)
  expect(clash).toMatchObject({ with: { kind: "project", id: first.id }, stops: true })
  expect(clash!.text).toBe("配方「镜像的」和配方「蓝晶镐」的材料和摆法一样，可是一个做「axe」，一个做「pick」：玩家这样放，只会做出其中一个，另一个永远做不出来。")
  expect(clash!.fix).toBe("换掉其中一个配方的一种材料，或者换一种摆法，让两个配方不一样。")
  // The very same thing twice: nothing is lost, one of them is only extra.
  const twice = recipeClashes(recipe(["AA.", ".S.", ".S."], items, { name: "又一份", result: "duck_mod:pick" }), [first], said)
  expect(twice).toMatchObject([{ stops: false }])
  expect(twice[0]!.text).toBe("配方「又一份」和配方「蓝晶镐」的材料和摆法一样，做出来的也一样（1 个「pick」），重复了一份。")
  // The same things but another number of them made, or a recipe of itself.
  expect(recipeClashes(recipe(["AA.", ".S.", ".S."], items, { result: "duck_mod:pick", count: 2 }), [first], said)).toMatchObject([{ stops: true }])
  expect(recipeClashes(first, [first], said)).toEqual([])
  // A shapeless one against a shaped one takes the same things in any places.
  expect(recipeClashes(recipe(["A.A", "...", "..."], items, { type: "shapeless", result: "duck_mod:other" }), [recipe(["AA.", "...", "..."], items, { result: "duck_mod:pick" })], said)).toMatchObject([{ stops: true, text: expect.stringContaining("的材料一样") }])
})

// ---- where it is reported ----

const project = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-clash-"))
  directories.push(root)
  return createProject({ directory: root, name: "鸭子模组", mod_id: "duck_mod" })
}
const documentOf = (item: ClashRecipe) => ({ kind: "recipe", name: item.name, pattern: item.pattern, result: item.result, count: item.count, ...(item.type ? { type: item.type } : {}) })
const asset = (item: ClashRecipe) =>
  WorkspaceAssetSchema.parse({ id: crypto.randomUUID(), module: "recipe", title: item.name, revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), prompt: "设计 recipe", dependencies: [], document: documentOf(item), provenance: { model: null, request_id: null }, status: "design" })

test("the reconciliation of a project says a recipe that gives the game's item, as one that stops, and a pair that repeats, as a reminder", async () => {
  const made = await project()
  const item = (identifier: string, name: string) => ({ id: crypto.randomUUID(), identifier, name, max_stack: 64 })
  const recipes = [
    recipe(["B.B", ".B.", "..."], { B: "minecraft:brick" }, { name: "红砖花盆", result: "duck_mod:pot" }),
    recipe(["S..", "...", "..."], { S: "minecraft:sunflower" }, { name: "向日葵块", result: "duck_mod:sun_block", type: "shapeless" }),
    recipe(["AA.", "AA.", "..."], { A: "duck_mod:azure_shard" }, { name: "晶墙", result: "duck_mod:wall" }),
    recipe([".AA", ".AA", "..."], { A: "duck_mod:azure_shard" }, { name: "晶墙又一份", result: "duck_mod:wall" }),
  ].map((value) => RecipeSchema.parse({ ...value, id: crypto.randomUUID() }))
  const findings = reconcile({ ...made, items: [item("pot", "红砖盆"), item("sun_block", "向日葵方块"), item("wall", "晶墙"), item("azure_shard", "蓝晶碎片")] as never, recipes }, { animations: {} })
  const about = (rule: string) => findings.filter((finding) => finding.rule === rule).map((finding) => `${finding.about?.name}${finding.stops ? "!" : ""}`)
  expect(about("recipe_vanilla")).toEqual(["红砖花盆!", "向日葵块!"])
  expect(about("recipe_duplicate")).toEqual(["晶墙又一份"])
  const pot = findings.find((finding) => finding.rule === "recipe_vanilla")!
  expect(pot).toMatchObject({ stops: true, about: { kind: "recipe", name: "红砖花盆" }, detail: "same as the game's crafting recipe for: flower_pot" })
  expect(pot.text).toBe("配方「红砖花盆」的材料和摆法和原版的「花盆」配方一样：玩家在工作台上这样放，游戏先认出的是原版的配方，做出来的是原版的物品，不是「红砖盆」。")
  // The pair of them is said once, about the later one, and does not stop: they make the same thing.
  expect(findings.find((finding) => finding.rule === "recipe_duplicate")).toMatchObject({ stops: false, about: { name: "晶墙又一份" }, detail: `same as recipe ${recipes[2]!.id}` })
})

test("a recipe the AI saves that the game would take over is refused with the game's item named, and the plain ones are saved", async () => {
  const made = await project()
  const pot = recipe(["B.B", ".B.", "..."], { B: "minecraft:brick" }, { name: "红砖花盆", result: "minecraft:bowl" })
  expect(() => applyWorkspaceAsset(made, asset(pot))).toThrow("配方「红砖花盆」的材料和摆法和原版的「花盆」配方一样")
  expect(() => applyWorkspaceAsset(made, asset(pot))).toThrow("换掉其中一种材料，或者换一种摆法")
  // One more brick is not the game's.
  const fine = recipe(["B.B", ".B.", ".B."], { B: "minecraft:brick" }, { name: "红砖花盆", result: "minecraft:bowl" })
  const saved = applyWorkspaceAsset(made, asset(fine))
  expect(saved.recipes.map((value) => value.name)).toEqual(["红砖花盆"])
  // Another recipe of the project that takes the same things and makes something else is refused; one that makes the same thing is let through (the reconciliation reminds).
  const other = recipe(["B.B", ".B.", ".B."], { B: "minecraft:brick" }, { name: "另一个", result: "minecraft:flower_pot" })
  expect(() => applyWorkspaceAsset(saved, asset(other))).toThrow("配方「另一个」和配方「红砖花盆」的材料和摆法一样")
  expect(applyWorkspaceAsset(saved, asset({ ...other, result: "minecraft:bowl" })).recipes).toHaveLength(2)
  // Saving the same recipe again with a change is not a clash with its own old self.
  const again = { ...saved.workspace.assets[0]!, document: { ...saved.workspace.assets[0]!.document, count: 2 } }
  expect(applyWorkspaceAsset(saved, again).recipes[0]!.count).toBe(2)
  // The AI is told.
  expect(RECIPE_INSTRUCTIONS).toContain("合成配方（shaped、shapeless）的材料和摆法不能和原版的合成配方一样，也不能和工程里另一条合成配方一样")
  expect(MODULES.recipe.instructions).toContain(RECIPE_INSTRUCTIONS)
})

// The planner is told which common layouts are the game's own (blueprint-planner.ts BLUEPRINT_RECIPE_RULE); each example stays true.
test("the planner's examples of layouts the game already has are the game's", async () => {
  const { BLUEPRINT_RECIPE_RULE } = await import("../src/blueprint-planner")
  const { vanillaClashes: clashes } = await import("../src/recipe-clash")
  const P = "minecraft:oak_planks", C = "minecraft:cobblestone"
  const examples: [string, Parameters<typeof clashes>[0], string][] = [
    ["四块木板摆成 2×2 是工作台", { pattern: [P, P, null, P, P, null, null, null, null] }, "crafting_table"],
    ["八块圆石围一圈是熔炉", { pattern: [C, C, C, C, null, C, C, C, C] }, "furnace"],
    ["三块木板横排是台阶", { pattern: [P, P, P, null, null, null, null, null, null] }, "oak_slab"],
    ["两块木板竖放是木棍", { pattern: [P, null, null, P, null, null, null, null, null] }, "stick"],
    ["一朵原版花单独放常是染料", { type: "shapeless", pattern: ["minecraft:sunflower", null, null, null, null, null, null, null, null] }, "yellow_dye"],
  ]
  for (const [words, recipe, result] of examples) {
    expect(BLUEPRINT_RECIPE_RULE).toContain(words)
    expect(clashes(recipe)).toContain(result)
  }
})

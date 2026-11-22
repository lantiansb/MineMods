import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { creatureContractLines, readGeneratedCreature } from "../src/creature-contract"
import { CREATURE_LIFE_INSTRUCTIONS, CREATURE_LIFE_SUMMARY, TEMPT_INSTRUCTIONS, creatureFacets, creatureTemptIssues, creatureWords } from "../src/creature-life"
import { CREATURE_LIFE_LIMITS, EntitySchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { applyWorkspaceAsset, getModuleSchema, type ModuleDocument } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { createDataGameplaySample, fightingGolemDesign } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-tempt-"))
  roots.push(root)
  return root
}

const sha = (files: Record<string, string | Uint8Array>) => {
  const text = Object.keys(files).sort().map((name) => `${name}\n${files[name]}`).join("\n")
  return `${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${text.length}`
}
const base = { modId: "duck_mod", packageName: "com.minemods.content_duck_mod", id: "duck", name: "鸭子", health: 6, speed: 0.25, attack_damage: 0, behavior: "follow" as const, model: fightingGolemDesign }
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const creatureClass = (files: Record<string, string | Uint8Array>) => String(files["src/main/java/com/minemods/content_duck_mod/entity/StudioCreature.java"])
const tempt = ["minecraft:bread", "azure_shard"]

// ---- the field ----

test("tempt is one to four items, written like a drop's, and only a creature that follows has it", () => {
  const duck = { id: "11111111-1111-4111-8111-111111111111", name: "鸭子", description: "", health: 6, speed: 0.25, attack_damage: 0, behavior: "follow", model_asset_id: null }
  const refused = (change: Record<string, unknown>) => EntitySchema.safeParse({ ...duck, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  // Left out, or null: the creature is what it was, field for field.
  expect(JSON.stringify(EntitySchema.parse(duck))).toBe(JSON.stringify(duck))
  expect(EntitySchema.parse({ ...duck, tempt: null }).tempt).toBeNull()
  expect(refused({ tempt: ["minecraft:bread"] })).toBe("")
  expect(refused({ tempt })).toBe("")
  expect(refused({ tempt: ["minecraft:bread", "minecraft:wheat_seeds", "minecraft:carrot", "azure_shard"] })).toBe("")
  expect(CREATURE_LIFE_LIMITS.tempt).toBe(4)
  expect(EntitySchema.safeParse({ ...duck, tempt: ["minecraft:bread", "minecraft:wheat_seeds", "minecraft:carrot", "minecraft:apple", "azure_shard"] }).success).toBe(false)
  expect(EntitySchema.safeParse({ ...duck, tempt: [] }).success).toBe(false)
  expect(refused({ tempt: ["minecraft:blue_bread"] })).toContain("Minecraft 1.21.1 里没有 minecraft:blue_bread 这个物品")
  expect(refused({ tempt: ["Azure Shard"] })).toContain("引诱物写本工程物品或方块的标识符")
  expect(refused({ tempt: ["minecraft:bread", "minecraft:bread"] })).toContain("引诱物 minecraft:bread 不要写两遍")
  // A creature that does not follow is led by nothing: said, with the way out.
  ;["passive", "hostile"].forEach((behavior) => expect(refused({ behavior, tempt })).toContain("写了引诱物（tempt）的生物要会跟人（behavior 写 follow）"))
  // The asset document carries the same field and the same rule.
  const { id, ...fields } = duck
  const document = { kind: "entity", ...fields, model_asset_id: id, runtime }
  expect(getModuleSchema("entity").safeParse({ ...document, tempt }).success).toBe(true)
  expect(getModuleSchema("entity").safeParse({ ...document, behavior: "passive", tempt }).success).toBe(false)
  expect(Object.keys(getModuleSchema("entity").parse({ ...document, tempt }))).toContain("tempt")
})

// ---- the generated class ----

test("a follower without tempt generates the same Java as before the field existed", () => {
  // The hashes are of the Java the generator wrote before `tempt`; they change only when the Java of a follower with no lure does.
  const pinned = { ...base, modId: "m", packageName: "com.minemods.content_m", id: "creature", name: "生物", health: 20, attack_damage: 3 }
  // re-pinned when every creature became the game's ageing animal, so it can be a baby (test/creature-baby.test.ts): the class gained its baby members and its renderer one line for the shadow; nothing else of any creature moved.
  // re-pinned when the generator moved to Mojang's names (Loom's officialMojangMappings): names and the imports they need, nothing else.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity(pinned))).toBe("bf867fab2d41e798 44374")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...pinned, runtime }))).toBe("93ecd6812502fe79 47391")
  const plain = compileEntity(base)
  expect(sha(compileEntity({ ...base, tempt: null }))).toBe(sha(plain))
  // The wheat it always had, in the goal and in the two checks of the runtime goal.
  expect(creatureClass(plain)).toContain("new TemptGoal(this, 1.2, Ingredient.of(Items.WHEAT), false)")
  expect(creatureClass(compileEntity({ ...base, runtime }))).toContain("player.getMainHandItem().is(Items.WHEAT) || player.getOffhandItem().is(Items.WHEAT)")
  expect(creatureClass(compileEntity({ ...base, runtime }))).toContain("target.getMainHandItem().is(Items.WHEAT) || target.getOffhandItem().is(Items.WHEAT)")
  expect(creatureClass(plain)).not.toContain("LURES")
  // A creature that does not follow ignores a lure left in its data: it has no lure goal to take it.
  expect(sha(compileEntity({ ...base, behavior: "passive", tempt }))).toBe(sha(compileEntity({ ...base, behavior: "passive" })))
  expect(sha(compileEntity({ ...base, behavior: "hostile", tempt }))).toBe(sha(compileEntity({ ...base, behavior: "hostile" })))
})

test("a follower with tempt is lured by those items and by no wheat", () => {
  const source = creatureClass(compileEntity({ ...base, tempt }))
  // The list is by registry id: the project's own item under the mod's name, a vanilla one under minecraft.
  expect(source).toContain('LURES = java.util.Set.of(ResourceLocation.fromNamespaceAndPath("minecraft", "bread"), ResourceLocation.fromNamespaceAndPath("duck_mod", "azure_shard"));')
  expect(source).toContain("private static boolean isLure(ItemStack stack) { return LURES.contains(BuiltInRegistries.ITEM.getKey(stack.getItem())); }")
  expect(source).toContain("goalSelector.addGoal(1, new TemptGoal(this, 1.2, StudioCreature::isLure, false));")
  expect(source.match(/^import net\.minecraft\.world\.item\.ItemStack;$/gm)).toHaveLength(1)
  expect(source).not.toContain("WHEAT")
  expect(source).not.toContain("Ingredient.of(")
  // The goal of a creature with movement looks for a player holding one of them, and lets go of one who puts it away.
  const moving = creatureClass(compileEntity({ ...base, runtime, tempt }))
  expect(moving).toContain("hasLineOfSight(player) && (isLure(player.getMainHandItem()) || isLure(player.getOffhandItem())) &&")
  expect(moving).toContain("hasLineOfSight(target) && (isLure(target.getMainHandItem()) || isLure(target.getOffhandItem())) &&")
  expect(moving).not.toContain("WHEAT")
  expect(moving).not.toContain("TemptGoal")
  // A creature that dies leaving a block already imports the stack; it is not imported twice.
  const dropping = creatureClass(compileEntity({ ...base, tempt, runtime: { ...runtime, death_drop: { block_identifier: "azure_ore", chance: 0.5 } } }))
  expect(dropping.match(/^import net\.minecraft\.world\.item\.ItemStack;$/gm)).toHaveLength(1)
})

test("the whole mod with a duck led by bread and its own item builds, says so in its guide, and the review is told", async () => {
  const root = await temporary()
  const directory = path.join(root, "project")
  // The sample's second creature is a gentle one that no gameplay code governs; it is made a follower.
  const project = await createDataGameplaySample(directory, { life: true, hitbox: true })
  const file = path.join(directory, "minemods.project.json")
  const saved = JSON.parse(await readFile(file, "utf8"))
  saved.entities[1].behavior = "follow"
  saved.entities[1].tempt = tempt
  await writeFile(file, JSON.stringify(saved))
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  // With two creatures each class has a name of its own: the follower's is the one that holds the list.
  const folder = path.join(source, `src/main/java/com/minemods/content_${project.mod_id}/entity`)
  const classes = await Promise.all((await readdir(folder)).map((name) => readFile(path.join(folder, name), "utf8")))
  const java = classes.find((text) => text.includes("LURES"))!
  expect(java).toContain(`LURES = java.util.Set.of(ResourceLocation.fromNamespaceAndPath("minecraft", "bread"), ResourceLocation.fromNamespaceAndPath("${project.mod_id}", "azure_shard"));`)
  // The guide says what lures it, by the names a player knows, in the creature's line and in its card.
  expect(built.guide.markdown).toContain("玩家手里拿着「面包」或「蓝晶碎片」时会跟过来，不打人")
  expect(built.guide.markdown).not.toContain("手里拿着小麦")
  // What the review of gameplay code is told it guarantees: read from this Java, the lure it really goes by.
  const facts = readGeneratedCreature(java, null)
  expect(facts.lures).toEqual(["minecraft:bread", `${project.mod_id}:azure_shard`])
  const named = (item: string) => ({ "minecraft:bread": "面包", [`${project.mod_id}:azure_shard`]: "蓝晶碎片" })[item] ?? item
  const lines = creatureContractLines({ title: "鸭子", key: "DUCK" }, facts, named).join("\n")
  expect(lines).toContain("RuntimeMovementGoal（Studio 生成的：自己找 24 格内看得见的、最近的、手里拿着「面包」或「蓝晶碎片」的玩家并靠近")
  expect(lines).not.toContain("小麦")
  if (!hasTargetJavac(OFFICIAL)) return
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
  // The same follower with no movement block of its own leads with the game's TemptGoal, given the list as a predicate.
  delete saved.entities[1].runtime
  await writeFile(file, JSON.stringify(saved))
  const plainSource = path.join(root, "plain")
  await mkdir(plainSource)
  await assembleBuildSource(directory, plainSource, TEMPLATE)
  const plainFolder = path.join(plainSource, `src/main/java/com/minemods/content_${project.mod_id}/entity`)
  const plain = (await Promise.all((await readdir(plainFolder)).map((name) => readFile(path.join(plainFolder, name), "utf8")))).find((text) => text.includes("LURES"))!
  expect(plain).toContain("new TemptGoal(this, 1.2, ")
  expect(plain).toContain("::isLure, false));")
  const plainCompiled = (await compileTreeFor(OFFICIAL, plainSource))!
  expect(plainCompiled.output).not.toContain("error")
  expect(plainCompiled.code).toBe(0)
}, 120000)

test("the contract of a follower with no tempt still says wheat, and the goal that tempts says what it takes", () => {
  const facts = readGeneratedCreature(creatureClass(compileEntity({ ...base, runtime })), null)
  expect(facts.lures).toBeNull()
  expect(creatureContractLines({ title: "鸭子", key: "DUCK" }, facts).join("\n")).toContain("自己找 24 格内看得见的、最近的、手里拿着小麦的玩家并靠近")
  const goal = readGeneratedCreature(creatureClass(compileEntity(base)), null)
  expect(creatureContractLines({ title: "鸭子", key: "DUCK" }, goal).join("\n")).toContain("TemptGoal（跟着手里拿着小麦的玩家走；占 MOVE、LOOK）")
  const led = readGeneratedCreature(creatureClass(compileEntity({ ...base, tempt })), null)
  expect(creatureContractLines({ title: "鸭子", key: "DUCK" }, led, (item) => item.split(":")[1]!).join("\n")).toContain("TemptGoal（跟着手里拿着「bread」或「azure_shard」的玩家走；占 MOVE、LOOK）")
})

// ---- the words ----

test("what lures a follower is said by the names a player knows, and the AI is told to write it", async () => {
  const root = await temporary()
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true })
  expect(creatureWords.lure(null, project)).toBe("玩家手里拿着小麦时会跟过来，不打人")
  expect(creatureWords.lure(tempt, project)).toBe("玩家手里拿着「面包」或「蓝晶碎片」时会跟过来，不打人")
  // The four questions: a follower led by an item is for something, though it drops nothing.
  const golem = project.workspace.assets.find((asset) => asset.document.kind === "entity")!.document as Extract<ModuleDocument, { kind: "entity" }>
  const duck = { ...golem, behavior: "follow" as const, loot: null, experience: null, tempt }
  expect(creatureFacets(duck, project).find((facet) => facet.question === "use")).toMatchObject({ answered: true, words: "玩家手里拿着「面包」或「蓝晶碎片」时它会跟着走" })
  expect(creatureFacets({ ...duck, tempt: null }, project).find((facet) => facet.question === "use")).toMatchObject({ answered: false })
  expect(creatureFacets({ ...duck, behavior: "hostile" }, project).find((facet) => facet.question === "use")).toMatchObject({ answered: false })
  // The instructions: what follow means, and that a lure the user names is written.
  expect(MODULES.entity.instructions).toContain(CREATURE_LIFE_INSTRUCTIONS)
  expect(MODULES.entity.instructions).not.toContain("follow 在玩家持小麦时接近")
  expect(MODULES.entity.instructions).toContain("follow 在玩家手里拿着引诱物时接近")
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(TEMPT_INSTRUCTIONS)
  ;["tempt", "behavior=follow", "minecraft:bread", "1 到 4 个物品", "省略 tempt 或写 null，就是拿着小麦", "不跟人的生物写 tempt 会被退回"].forEach((word) => expect(TEMPT_INSTRUCTIONS).toContain(word))
  expect(CREATURE_LIFE_SUMMARY).toContain("tempt")
})

test("a lure that names nothing of the project is refused when the creature is saved and when it is built", async () => {
  const root = await temporary()
  const directory = path.join(root, "project")
  const project = await createDataGameplaySample(directory, { life: true })
  const entity = project.workspace.assets.find((asset) => asset.document.kind === "entity")!
  const lost = { ...entity, document: { ...entity.document, behavior: "follow", tempt: ["blue_sword"] } }
  expect(creatureTemptIssues(project, { name: "鸭子", tempt: ["blue_sword", "azure_ore", "minecraft:bread"] })).toEqual(["生物「鸭子」的引诱物「blue_sword」在这个工程里找不到。先把这样物品或方块做出来，或者写成 minecraft:名字 的原版物品。"])
  expect(() => applyWorkspaceAsset(project, lost as typeof entity)).toThrow("生物「晶石傀儡」的引诱物「blue_sword」在这个工程里找不到。")
  const found = { ...entity, document: { ...entity.document, behavior: "follow", tempt: ["azure_shard", "minecraft:bread"] } }
  expect(applyWorkspaceAsset(project, found as typeof entity).entities[0]).toMatchObject({ behavior: "follow", tempt: ["azure_shard", "minecraft:bread"] })
  // A project file edited by hand does not get past the build either.
  const file = path.join(directory, "minemods.project.json")
  const saved = JSON.parse(await readFile(file, "utf8"))
  saved.entities[0].behavior = "follow"
  saved.entities[0].tempt = ["blue_sword"]
  await writeFile(file, JSON.stringify(saved))
  const source = path.join(root, "again")
  await mkdir(source)
  await expect(assembleBuildSource(directory, source, TEMPLATE)).rejects.toThrow(`ENTITY_TEMPT_UNKNOWN_ITEM:${project.entities[0]!.id}`)
}, 120000)

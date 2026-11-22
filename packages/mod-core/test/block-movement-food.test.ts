import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { BlockSchema, ContentSchema, FoodSchema, ItemSchema, compileContent, validateContent } from "../src/content"
import { blockFacets, itemFacets } from "../src/content-facets"
import { BLOCK_MOVEMENT_INSTRUCTIONS, CONNECTION_CAPABILITY, FOOD_EFFECTS, FOOD_EFFECT_LIMITS, FOOD_LEAVES, FOOD_NATURE_INSTRUCTIONS, ITEM_NATURE_INSTRUCTIONS, MOVEMENT_LIMITS, MOVEMENT_PLAIN, contentWords } from "../src/content-words"
import { modGuide } from "../src/guide"
import { createProject, saveProject } from "../src/project"
import { applyContent, getModuleSchema } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-movement-"))
  roots.push(root)
  return root
}

const ID = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
const block = (index: number, identifier: string, extra: Record<string, unknown> = {}) => ({ id: ID(index), identifier, name: `方块${index}`, hardness: 1.5, luminance: 0, tool: "pickaxe", drop: "self", color: "#335577", ...extra })
const item = (index: number, identifier: string, extra: Record<string, unknown> = {}) => ({ id: ID(100 + index), identifier, name: `物品${index}`, max_stack: 64, color: "#c89b5a", ...extra })
const effect = (name: keyof typeof FOOD_EFFECTS, extra: Record<string, unknown> = {}) => ({ effect: name, seconds: "instant" in FOOD_EFFECTS[name] ? 1 : 8, level: 1, chance: 1, ...extra })
const content = (blocks: unknown[], items: unknown[]) => ({ mod_id: "m", package_name: "a.b", blocks, items, recipes: [], logic: [] })
const REGISTRY = "src/main/java/a/b/StudioContentRegistry.java"
const registry = (blocks: unknown[], items: unknown[]) => String(compileContent(content(blocks, items))[REGISTRY])
const digest = (files: Record<string, string | Uint8Array>) => {
  const hash = createHash("sha256")
  Object.keys(files).sort().forEach((file) => hash.update(file).update(files[file]!))
  return hash.digest("hex")
}
const refused = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) => !schema.safeParse(value).success

// ---- the data ----

test("movement and food effects are held to the vanilla numbers they come from, at each end", () => {
  const moving = (movement: unknown) => BlockSchema.safeParse(block(1, "honey", { movement })).success
  const honey = { speed: 0.4, jump: 0.5, slip: 0.6 }
  expect(moving(honey)).toBe(true)
  expect(moving(null)).toBe(true)
  expect(BlockSchema.safeParse(block(1, "honey")).success).toBe(true)
  // The slow ends are half of the slowest vanilla block (0.4); a slip under an ordinary block's would be grippier than any; blue ice (0.989) is the slipperiest.
  expect(MOVEMENT_LIMITS).toEqual({ speed: { min: 0.2, max: 1 }, jump: { min: 0.2, max: 1 }, slip: { min: 0.6, max: 0.989 } })
  const ends: [string, number, number][] = [["speed", 0.19, 1.01], ["jump", 0.19, 1.01], ["slip", 0.59, 0.99]]
  ends.forEach(([field, low, high]) => {
    const limits = MOVEMENT_LIMITS[field as keyof typeof MOVEMENT_LIMITS]
    expect([field, moving({ ...honey, [field]: low })]).toEqual([field, false])
    expect([field, moving({ ...honey, [field]: high })]).toEqual([field, false])
    expect([field, moving({ ...honey, [field]: limits.min })]).toEqual([field, true])
    expect([field, moving({ ...honey, [field]: limits.max })]).toEqual([field, true])
    expect([field, moving({ ...honey, [field]: Number.NaN })]).toEqual([field, false])
  })
  // All three are written; nothing else is.
  expect(moving({ speed: 0.4, jump: 0.5 })).toBe(false)
  expect(moving({ ...honey, friction: 1 })).toBe(false)
  expect(MOVEMENT_PLAIN).toEqual({ speed: 1, jump: 1, slip: 0.6 })

  const food = (extra: Record<string, unknown>) => FoodSchema.safeParse({ hunger: 3, saturation: 0.3, ...extra }).success
  expect(food({})).toBe(true)
  expect(food({ effects: null, drink: null, leaves: null })).toBe(true)
  expect(food({ effects: [effect("regeneration")], drink: true, leaves: "minecraft:glass_bottle" })).toBe(true)
  // At most four (the enchanted golden apple's), from one second to ten minutes, level I to V, chance 0 to 1.
  expect(FOOD_EFFECT_LIMITS).toEqual({ count: 4, seconds: { min: 1, max: 600 }, level: { min: 1, max: 5 } })
  expect(food({ effects: [1, 2, 3, 4].map(() => effect("speed")) })).toBe(true)
  expect(food({ effects: [1, 2, 3, 4, 5].map(() => effect("speed")) })).toBe(false)
  expect([0, 601, 1.5].map((seconds) => food({ effects: [effect("speed", { seconds })] }))).toEqual([false, false, false])
  expect([1, 600].map((seconds) => food({ effects: [effect("speed", { seconds })] }))).toEqual([true, true])
  expect([0, 6, 1.5].map((level) => food({ effects: [effect("speed", { level })] }))).toEqual([false, false, false])
  expect([1, 5].map((level) => food({ effects: [effect("speed", { level })] }))).toEqual([true, true])
  expect([-0.1, 1.1].map((chance) => food({ effects: [effect("speed", { chance })] }))).toEqual([false, false])
  expect([0, 0.3, 1].map((chance) => food({ effects: [effect("speed", { chance })] }))).toEqual([true, true, true])
  // Only effects that make sense to eat or drink, by the game's id.
  expect(food({ effects: [effect("speed", { effect: "wither" })] })).toBe(false)
  expect(food({ effects: [effect("speed", { effect: "minecraft:speed" })] })).toBe(false)
  expect(Object.keys(FOOD_EFFECTS)).toHaveLength(23)
  Object.keys(FOOD_EFFECTS).forEach((name) => expect([name, food({ effects: [effect(name as keyof typeof FOOD_EFFECTS)] })]).toEqual([name, true]))
  // An instant effect has no length; the document says so with a 1 rather than carrying a number that does nothing.
  expect(food({ effects: [effect("instant_health", { seconds: 5 })] })).toBe(false)
  expect(FoodSchema.safeParse({ hunger: 3, saturation: 0.3, effects: [effect("saturation", { seconds: 5 })] }).error?.issues[0]?.message).toContain("瞬间生效")
  // What it leaves: a glass bottle or a bowl, or nothing.
  expect(["minecraft:glass_bottle", "minecraft:bowl", null].map((leaves) => food({ leaves }))).toEqual([true, true, true])
  expect(food({ leaves: "minecraft:bucket" })).toBe(false)
  expect(refused(FoodSchema, { hunger: 3, saturation: 0.3, drink: "yes" })).toBe(true)
  expect(refused(FoodSchema, { hunger: 3, saturation: 0.3, effects: [{ ...effect("speed"), extra: 1 }] })).toBe(true)
})

test("the workspace documents of a block and an item carry the new fields, and a block document without them is still valid", () => {
  const document = { kind: "block", identifier: "honey", name: "蜂蜜块", hardness: 0.5, luminance: 0, tool: "none", drop: "self", color: "#e8a317", texture: null }
  const schema = getModuleSchema("block")
  expect(schema.safeParse(document).success).toBe(true)
  expect(schema.safeParse({ ...document, movement: { speed: 0.4, jump: 0.5, slip: 0.6 } }).success).toBe(true)
  expect(schema.safeParse({ ...document, movement: { speed: 0.1, jump: 0.5, slip: 0.6 } }).success).toBe(false)
  const drink = { kind: "item", identifier: "nectar", name: "花蜜", max_stack: 16, color: "#e8a317", texture: null, food: { hunger: 3, saturation: 0.3, effects: [effect("regeneration", { seconds: 8, level: 2 })], drink: true, leaves: "minecraft:glass_bottle" } }
  expect(getModuleSchema("item").safeParse(drink).success).toBe(true)
  expect(getModuleSchema("item").safeParse({ ...drink, food: { ...drink.food, leaves: "minecraft:stick" } }).success).toBe(false)
})

// ---- the Java ----

test("a block's movement is written as the game's own block settings; a part left at its default writes nothing", () => {
  const settings = (movement: unknown) => /BlockBehaviour\.Properties\.of\(\)[^\n]*/.exec(registry([block(1, "honey", { movement })], []))![0]
  expect(settings({ speed: 0.4, jump: 0.5, slip: 0.6 })).toContain(".lightLevel(state -> 0).requiresCorrectToolForDrops().speedFactor(0.4f).jumpFactor(0.5f)));")
  expect(settings({ speed: 0.4, jump: 1, slip: 0.6 })).toContain(".speedFactor(0.4f)));")
  expect(settings({ speed: 1, jump: 1, slip: 0.98 })).toContain(".friction(0.98f)));")
  expect(settings({ speed: 1, jump: 1, slip: 0.989 })).toContain(".friction(0.989f)));")
  expect(settings({ speed: 0.2, jump: 0.2, slip: 0.6 })).toContain(".speedFactor(0.2f).jumpFactor(0.2f)));")
  // After the sound, ahead of the box shape's own setting; a movement that changes nothing is a block without one, to the byte.
  const plain = compileContent(content([block(1, "honey")], []))
  expect(compileContent(content([block(1, "honey", { movement: { speed: 1, jump: 1, slip: 0.6 } })], []))).toEqual(plain)
  expect(compileContent(content([block(1, "honey", { movement: null })], []))).toEqual(plain)
  expect(settings({ speed: 0.4, jump: 0.5, slip: 0.6 })).not.toContain(".friction")
  const sounding = /BlockBehaviour\.Properties\.of\(\)[^\n]*/.exec(registry([block(1, "honey", { sound: "honey", movement: { speed: 0.4, jump: 0.5, slip: 0.6 } })], []))![0]
  expect(sounding).toContain(".sound(SoundType.HONEY_BLOCK).speedFactor(0.4f).jumpFactor(0.5f)));")
  // Nothing else is generated for it: the same files, the same data.
  const moved = compileContent(content([block(1, "honey", { movement: { speed: 0.4, jump: 0.5, slip: 0.6 } })], []))
  expect(Object.keys(moved).sort()).toEqual(Object.keys(plain).sort())
  Object.keys(plain).filter((file) => file !== REGISTRY).forEach((file) => expect([file, moved[file]]).toEqual([file, plain[file]]))
})

test("a food's effects, drink and leftover are written with the game's own builder, and an old food is the same bytes", () => {
  const written = registry([], [item(1, "nectar", { max_stack: 16, food: { hunger: 3, saturation: 0.3, always_edible: true, effects: [effect("regeneration", { seconds: 8, level: 2 }), effect("poison", { seconds: 5, chance: 0.3 }), effect("instant_health", { level: 2 })], drink: true, leaves: "minecraft:glass_bottle" } })])
  expect(written).toContain(
    ".food(new FoodProperties.Builder().nutrition(3).saturationModifier(0.3f).alwaysEdible()" +
      ".effect(new MobEffectInstance(MobEffects.REGENERATION, 160, 1), 1f)" +
      ".effect(new MobEffectInstance(MobEffects.POISON, 100, 0), 0.3f)" +
      // An instant effect happens once: one tick, as the game's potions give it.
      ".effect(new MobEffectInstance(MobEffects.HEAL, 1, 1), 1f)" +
      ".usingConvertsTo(Items.GLASS_BOTTLE).build()))",
  )
  // Drunk: the drinking motion while held, the drinking sound at the last mouthful.
  expect(written).toContain("@Override public UseAnim getUseAnimation(ItemStack stack) { return UseAnim.DRINK; }")
  expect(written).toContain("@Override public SoundEvent getEatingSound() { return getDrinkingSound(); }")
  ;["net.minecraft.world.effect.MobEffectInstance", "net.minecraft.world.effect.MobEffects", "net.minecraft.world.item.Items", "net.minecraft.world.item.ItemStack", "net.minecraft.sounds.SoundEvent", "net.minecraft.world.item.UseAnim"].forEach((name) => expect(written).toContain(`import ${name};`))
  // A bowl for a stew, chewed (not a drink), with no effect: only what it says is written.
  const stew = registry([], [item(1, "stew", { food: { hunger: 6, saturation: 0.6, leaves: "minecraft:bowl" } })])
  expect(stew).toContain(".saturationModifier(0.6f).usingConvertsTo(Items.BOWL).build()))")
  expect(stew).not.toContain("UseAnim")
  expect(stew).not.toContain("MobEffectInstance")
  expect(stew).toContain("import net.minecraft.world.item.Items;")
  expect(stew).not.toContain("import net.minecraft.world.item.ItemStack;")
  // Nulls are absent.
  const nulls = compileContent(content([], [item(1, "bread", { food: { hunger: 5, saturation: 0.6, effects: null, drink: null, leaves: null } })]))
  expect(nulls).toEqual(compileContent(content([], [item(1, "bread", { food: { hunger: 5, saturation: 0.6 } })])))
  expect(compileContent(content([], [item(1, "bread", { food: { hunger: 5, saturation: 0.6, effects: [], drink: false } })]))).toEqual(nulls)
  // It is still sorted into the food tab, like every food.
  expect(written).toContain("ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.FOOD_AND_DRINKS)")
})

test("blocks and foods that say nothing new generate the very files they generated before", () => {
  const plain = block(1, "plain_block", { name: "石块", id: "2f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e51" })
  const glow = block(2, "glow_block", { name: "荧块", id: "2f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e52", hardness: 0.5, luminance: 12, tool: "none", drop: "none", color: "#ffee88", sound: "honey" })
  const foods = [
    { id: "1f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e51", identifier: "bread", name: "面包", max_stack: 64, color: "#c89b5a", food: { hunger: 5, saturation: 0.6 } },
    { id: "1f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e52", identifier: "candy", name: "糖", max_stack: 16, color: "#8FE3FF", food: { hunger: 2, saturation: 0.3, always_edible: true, snack: true } },
    { id: "1f2d1c9e-3a4b-4c5d-8e6f-0a1b2c3d4e53", identifier: "dust", name: "尘", max_stack: 64, color: "#ffffff" },
  ]
  // Taken from what the build wrote before movement, effects, drinks and leftovers existed; since the generator writes Mojang's names, the registry class is the one file that differs from those bytes.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(digest(compileContent(content([plain, glow], foods)))).toBe("44893da5cde2eda32483610c7c13a613280bc1ea2e780b9e32e49cfe9d2b73ac")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(digest(compileContent(content([plain, glow], [])))).toBe("c189d3233f62b7725ad82e6f55b42b428e2eb21fa51222b186cec205c8b4e8e1")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(digest(compileContent(content([], foods)))).toBe("985794a6a7bf0662f94e0cc0c8fc71921041d8c733a7fd971333501a35f99dfb")
  // And a document that parsed before parses into the same value now.
  expect(BlockSchema.parse(plain)).toEqual(plain as never)
  expect(ItemSchema.parse(foods[1])).toEqual(foods[1] as never)
})

// ---- the vocabulary is the game's ----

// The game's own classes in Mojang's names: the common jar of the official class path, read with the JDK's javap.
const GAME_JAR = hasTargetJavac("fabric-1.21.1-official") ? readFileSync(path.join(process.env.MINEMODS_TARGET_CLASSPATH!, "fabric-1.21.1-official.txt"), "utf8").split(/\r?\n/).find((jar) => /minecraft-common-/.test(path.basename(jar))) : undefined
const JAVAP = path.join(process.env.MINEMODS_JDK21 ?? "", "bin", process.platform === "win32" ? "javap.exe" : "javap")
const HAS_JAVAP = !!GAME_JAR && existsSync(GAME_JAR) && existsSync(JAVAP)
// Read as lines whatever the platform ends them with.
const javap = (...args: string[]) => Bun.spawnSync([JAVAP, "-c", "-p", "-cp", GAME_JAR!, ...args]).stdout.toString().replaceAll("\r\n", "\n")

test.skipIf(!HAS_JAVAP)("the limits are the numbers of the game's own blocks, and the instant effects are the game's own", () => {
  // The float a block's settings are given for one method, read from the game's block registrations.
  const blocks = javap("net.minecraft.world.level.block.Blocks").split("\n")
  const setting = (name: string, method: string) => {
    const start = blocks.findIndex((line) => line.endsWith(`// String ${name}`))
    const end = blocks.findIndex((line, index) => index > start && line.includes("Method register:(Ljava/lang/String;"))
    const lines = blocks.slice(start, end)
    const call = lines.findIndex((line) => line.includes(`BlockBehaviour$Properties.${method}:(F)`))
    return call < 0 ? null : Number(/float ([0-9.]+)f/.exec(lines[call - 1]!)?.[1])
  }
  expect(setting("soul_sand", "speedFactor")).toBe(0.4)
  expect(setting("honey_block", "speedFactor")).toBe(0.4)
  expect(setting("honey_block", "jumpFactor")).toBe(0.5)
  expect(setting("ice", "friction")).toBe(0.98)
  expect(setting("blue_ice", "friction")).toBe(MOVEMENT_LIMITS.slip.max)
  expect<number>(MOVEMENT_LIMITS.speed.min).toBe((setting("soul_sand", "speedFactor") ?? 0) / 2)
  // The effects: each by its constant, instant exactly where the game's effect class is.
  const effects = javap("net.minecraft.world.effect.MobEffects").split("\n")
  const made = (id: string) => /class net\/minecraft\/world\/effect\/(\w+)/.exec(effects.slice(effects.findIndex((line) => line.endsWith(`// String ${id}`))).find((line) => line.includes("// class "))!)![1]!
  const happensOnce = (id: string) => javap(`net.minecraft.world.effect.${made(id)}`).includes("extends net.minecraft.world.effect.InstantenousMobEffect")
  const instant = Object.entries(FOOD_EFFECTS).filter(([, words]) => "instant" in words).map(([id]) => id)
  expect(instant).toEqual(["instant_health", "saturation"])
  Object.keys(FOOD_EFFECTS).forEach((id) => expect([id, happensOnce(id)]).toEqual([id, instant.includes(id)]))
  // Every effect and both leftovers are fields of the game's own classes (the build compiles them; here they are looked up by name).
  const fields = javap("net.minecraft.world.effect.MobEffects")
  Object.values(FOOD_EFFECTS).forEach((words) => expect(fields).toContain(`Holder<net.minecraft.world.effect.MobEffect> ${words.java};`))
  const items = javap("net.minecraft.world.item.Items")
  Object.values(FOOD_LEAVES).forEach((words) => expect(items).toContain(`net.minecraft.world.item.Item ${words.java};`))
})

// ---- the words ----

test("what a block and a food do is said in plain words from the same document the Java is made from", () => {
  expect(contentWords.movement({ speed: 0.4, jump: 0.5, slip: 0.6 })).toBe("踩上去会变慢（速度变成原来的 40%），跳起来更费劲（起跳力变成原来的 50%）")
  expect(contentWords.movement({ speed: 1, jump: 1, slip: 0.98 })).toBe("脚下很滑（滑度 0.98，普通方块 0.6，原版冰 0.98、蓝冰 0.989）")
  expect(contentWords.movement({ speed: 1, jump: 1, slip: 0.6 })).toBe("")
  expect(contentWords.movement(null)).toBe("")
  // An old food reads as it did.
  expect(contentWords.food({ hunger: 4, always_edible: true, snack: true })).toBe("能吃：补 4 点饥饿（2 格鸡腿），不饿也能吃，吃得很快")
  const drink = contentWords.food({ hunger: 3, always_edible: true, effects: [effect("regeneration", { seconds: 8, level: 2 }), effect("poison", { seconds: 5, chance: 0.3 }), effect("instant_health")], drink: true, leaves: "minecraft:glass_bottle" })
  expect(drink).toBe("能喝：补 3 点饥饿（1.5 格鸡腿），不饿也能喝，喝下去会有效果：生命恢复 II（慢慢回血） 8 秒；中毒（持续掉血（不会掉到死）） 5 秒，30% 的机会；瞬间治疗（立刻回血），喝完剩一个玻璃瓶")
  expect(contentWords.food({ hunger: 6, leaves: "minecraft:bowl" })).toBe("能吃：补 6 点饥饿（3 格鸡腿），吃完剩一个碗")
})

test("the playable facets, the guide and the instructions all say it, so 'what is it for' has an answer", async () => {
  const root = await temporary()
  const created = await createProject({ directory: root, name: "蜂蜜园", description: "蜜蜂和蜂蜜。", mod_id: "honey_garden" })
  const honey = block(1, "honey_slab", { movement: { speed: 0.4, jump: 0.5, slip: 0.6 }, drop: "self" })
  const nectar = item(1, "nectar", { max_stack: 16, food: { hunger: 3, saturation: 0.3, effects: [effect("regeneration", { seconds: 8, level: 2 })], drink: true, leaves: "minecraft:glass_bottle" } })
  const bare = block(2, "bare_slab")
  const project = await saveProject(root, applyContent(created, ContentSchema.parse({ blocks: [honey, bare], items: [nectar], recipes: [], logic: [] })), created.revision)
  const document = (kind: "blocks" | "items", identifier: string) => ({ kind: kind === "blocks" ? ("block" as const) : ("item" as const), ...(project[kind] as { identifier: string }[]).find((value) => value.identifier === identifier)! }) as never
  const uses = (facets: ReturnType<typeof blockFacets>) => facets.filter((facet) => facet.question === "use").map((facet) => facet.words)
  expect(uses(blockFacets(document("blocks", "honey_slab"), project))).toContain("踩上去会变慢（速度变成原来的 40%），跳起来更费劲（起跳力变成原来的 50%）")
  expect(uses(blockFacets(document("blocks", "bare_slab"), project)).join("")).not.toContain("变慢")
  expect(uses(itemFacets(document("items", "nectar"), project)).join("")).toContain("喝下去会有效果：生命恢复 II（慢慢回血） 8 秒，喝完剩一个玻璃瓶")
  const guide = modGuide(project, { findings: [], animations: {}, glowing: [], built: false }).markdown
  expect(guide).toContain("踩上去会变慢（速度变成原来的 40%）")
  expect(guide).toContain("喝完剩一个玻璃瓶")
  // The instructions an AI writes a block or an item by say to use the data fields, not gameplay code, and give the limits.
  expect(MODULES.block.instructions).toContain(BLOCK_MOVEMENT_INSTRUCTIONS)
  expect(MODULES.item.instructions).toContain(ITEM_NATURE_INSTRUCTIONS)
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("不要写成 gameplay 代码")
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("speed: 0.2–1")
  expect(BLOCK_MOVEMENT_INSTRUCTIONS).toContain("slip: 0.6–0.989")
  expect(FOOD_NATURE_INSTRUCTIONS).toContain("不要写成 gameplay 代码")
  expect(FOOD_NATURE_INSTRUCTIONS).toContain("最多 4 条")
  expect(FOOD_NATURE_INSTRUCTIONS).toContain("minecraft:glass_bottle（玻璃瓶）")
  Object.keys(FOOD_EFFECTS).forEach((name) => expect(FOOD_NATURE_INSTRUCTIONS).toContain(`${name}（`))
  // The old line that sent every effect on food to gameplay is gone, and the capability list says what is and is not done.
  expect(ITEM_NATURE_INSTRUCTIONS).not.toContain("吃了以后给药水效果")
  expect(CONNECTION_CAPABILITY.done.join("")).toContain("movement")
  expect(CONNECTION_CAPABILITY.not_done.join("")).not.toContain("吃了给药水效果的食物")
  expect(MODULES.block.summary).toContain("movement")
  expect(MODULES.item.summary).toContain("leaves")
})

// ---- the whole project ----

test.skipIf(!hasTargetJavac("fabric-1.21.1-official"))("a project with a block that slows and a drink with effects and a leftover builds, and every effect and leftover compiles", async () => {
  const root = await temporary()
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "蜂蜜园", description: "蜜蜂和蜂蜜。", mod_id: "honey_garden" })
  // Every effect on the list, four to a drink, so the build proves each is a real constant of the game's.
  const names = Object.keys(FOOD_EFFECTS) as (keyof typeof FOOD_EFFECTS)[]
  const drinks = Array.from({ length: Math.ceil(names.length / FOOD_EFFECT_LIMITS.count) }, (_, index) => item(10 + index, `drink_${index}`, { max_stack: 16, food: { hunger: 2, saturation: 0.2, always_edible: true, drink: true, leaves: index % 2 ? "minecraft:bowl" : "minecraft:glass_bottle", effects: names.slice(index * FOOD_EFFECT_LIMITS.count, (index + 1) * FOOD_EFFECT_LIMITS.count).map((name) => effect(name, { level: 2, chance: 0.5 })) } }))
  const blocks = [
    block(1, "sticky", { name: "粘脚块", tool: "none", movement: { speed: 0.4, jump: 0.5, slip: 0.6 }, luminance: 8 }),
    block(2, "slick", { name: "滑块", movement: { speed: 1, jump: 1, slip: 0.989 }, sound: "glass" }),
    block(3, "boggy", { name: "泥块", experience: undefined, drop: "none", movement: { speed: 0.2, jump: 0.2, slip: 0.6 } }),
  ]
  const filled = applyContent(created, ContentSchema.parse({ blocks, items: [...drinks, item(1, "plain", {})], recipes: [], logic: [] }))
  await saveProject(directory, filled, created.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(directory, source, TEMPLATE)
  const java = await readFile(path.join(source, "src/main/java/com/minemods/content_honey_garden/StudioContentRegistry.java"), "utf8")
  expect(java).toContain(".speedFactor(0.4f).jumpFactor(0.5f)")
  expect(java).toContain(".friction(0.989f)")
  expect(java.match(/UseAnim\.DRINK/g)).toHaveLength(drinks.length)
  expect(java).toContain("usingConvertsTo(Items.BOWL)")
  expect(java).toContain("usingConvertsTo(Items.GLASS_BOTTLE)")
  const compiled = (await compileTreeFor("fabric-1.21.1-official", source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
  // The same settings and builder calls as the game's own, compiled on their own against the jar.
  await mkdir(path.join(root, "vanilla"))
  await writeFile(
    path.join(root, "vanilla", "Vanilla.java"),
    `import net.minecraft.sounds.SoundEvent; import net.minecraft.world.effect.MobEffectInstance; import net.minecraft.world.effect.MobEffects; import net.minecraft.world.food.FoodProperties; import net.minecraft.world.item.Item; import net.minecraft.world.item.ItemStack; import net.minecraft.world.item.Items; import net.minecraft.world.item.UseAnim; import net.minecraft.world.level.block.state.BlockBehaviour;
final class Vanilla {
    static final BlockBehaviour.Properties SETTINGS = BlockBehaviour.Properties.of().speedFactor(0.4f).jumpFactor(0.5f).friction(0.989f);
    static final FoodProperties FOOD = new FoodProperties.Builder().nutrition(1).saturationModifier(0.1f).effect(new MobEffectInstance(MobEffects.${FOOD_EFFECTS.regeneration.java}, 100, 1), 0.5f).usingConvertsTo(Items.${FOOD_LEAVES["minecraft:glass_bottle"].java}).build();
    static final Item DRINK = new Item(new Item.Properties()) { @Override public UseAnim getUseAnimation(ItemStack stack) { return UseAnim.DRINK; } @Override public SoundEvent getEatingSound() { return getDrinkingSound(); } };
}
`,
  )
  const vanilla = await targetJavac("fabric-1.21.1-official", path.join(root, "vanilla"))
  expect(vanilla.output).not.toContain("error")
  expect(vanilla.code).toBe(0)
  // Validation still passes with the project's own entities, as the build does it.
  expect(() => validateContent({ ...content(blocks, [...drinks]), entities: [] })).not.toThrow()
}, 240000)

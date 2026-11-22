import { afterEach, expect, test } from "bun:test"
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { motionName } from "@minemods/studio-ai/making"
import { bbmodelNames, bbmodelText, checkBbmodel, exportBbmodel } from "../src/bbmodel"
import { assembleBuildSource } from "../src/build-source"
import { BlockSchema, GenerationSchema, SOUND_TYPES, compileContent, oreLoot, validateContent } from "../src/content"
import { BLOCK_SOUNDS, CREATURE_SOUNDS, DATA_CAPABILITY, ORE_BASES, ORE_BIOME_GROUPS, ORE_DIMENSIONS, TOOL_TIERS, dataWords, soundConstant, type BlockSound } from "../src/data-words"
import { CreatureSoundsSchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { compileEntityLogic } from "../src/fabric/logic"
import { oreFeatures } from "../src/fabric/worldgen"
import { resolveProfile } from "../src/fabric/profile"
import { creatureName, generatedNames } from "../src/gameplay"
import { GUIDE_FILE, modGuide, type ModGuide } from "../src/guide"
import { GAME_WORDS } from "../src/play-by-hand"
import { projectBbmodel, projectGuide } from "../src/guide-project"
import { compileModel } from "../src/model"
import { glowMaskPath } from "../src/glow-mask"
import { decodeRgbaPng } from "../src/png-decode"
import { openProject, ProjectSchema, saveProject, type Project } from "../src/project"
import { BUILT_IN_MOTIONS, mayBePlayedByGameplay, playedAnimations, reconcile } from "../src/reconcile"
import { jarName } from "../src/release"
import { WorkspaceAssetSchema, getModuleSchema } from "../src/workspace"
import { MODULES } from "../src/workspace-modules"
import { createDataGameplaySample, golemDesign } from "../script/data-gameplay-sample"
import { BOX_GUARD, IDS, LEGACY_FILES, sampleProject } from "./fixtures/gameplay/sample"
import { HAS_GAME_DATA, compileTreeFor, vanillaFiles, vanillaJson } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-data-"))
  roots.push(root)
  return root
}

/** The sample project that uses every data-only feature, and the source a build assembles from it. */
async function sample() {
  const root = await temporary()
  const directory = path.join(root, "project")
  const project = await createDataGameplaySample(directory)
  const source = path.join(root, "source")
  await mkdir(source)
  return { directory, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}

async function legacy() {
  const root = await temporary()
  const original = JSON.parse(await readFile(LEGACY_FILES.project, "utf8"))
  await cp(LEGACY_FILES.project, path.join(root, "minemods.project.json"))
  await mkdir(path.join(root, ".minemods", "assets", original.assets[0].id), { recursive: true })
  await cp(LEGACY_FILES.model, path.join(root, ".minemods", "assets", original.assets[0].id, `${original.assets[0].revision}.json`))
  return root
}

const files = async (directory: string) =>
  (await readdir(directory, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).replaceAll(path.sep, "/"))
const text = (source: string, name: string) => readFile(path.join(source, name), "utf8")
const json = async (source: string, name: string) => JSON.parse(await text(source, name)) as unknown
/** A JSON value with every leaf replaced by its type: two documents of the same format have the same shape. */
const shape = (value: unknown): unknown =>
  Array.isArray(value) ? [...new Set(value.map((entry) => JSON.stringify(shape(entry))))].sort().map((entry) => JSON.parse(entry)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, shape(entry)])) : typeof value

const block = (extra: Record<string, unknown> = {}) => ({ id: "00000000-0000-4000-8000-000000000001", identifier: "azure_ore", name: "蓝晶矿石", hardness: 3, luminance: 0, tool: "pickaxe", drop: "self", color: "#5E7F96", ...extra })
const item = { id: "00000000-0000-4000-8000-000000000002", identifier: "azure_shard", name: "蓝晶碎片", max_stack: 64, color: "#49C6E8" }
const overworld = { dimension: "overworld", min_y: -16, max_y: 48, spread: "middle", vein_size: 6, veins_per_chunk: 8, replaces: ["stone", "deepslate"], biomes: null }
const content = (blocks: unknown[], items: unknown[] = [item]) => ({ mod_id: "azure", package_name: "com.minemods.content_azure", blocks, items, recipes: [], logic: [] })
const message = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return ""
}

// ---- 0. one tick() ----

test("a creature with both a rule and a runtime block gets one tick() that runs both", async () => {
  const root = await legacy()
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(root, source, TEMPLATE)
  const creature = await text(source, "src/main/java/com/minemods/content_legacy_sample/entity/StudioCreature.java")
  // The creature's own tick(); the second one is the movement goal's, an inner class.
  expect(creature.match(/^    @Override public void tick\(\) \{$/gm)).toHaveLength(1)
  expect(creature).toContain("        super.tick();\n        if (!level().isClientSide()) applyStudioLogic();\n        tickRuntime();\n")
  if (!hasTargetJavac(OFFICIAL)) return
  const compiled = await targetJavac(OFFICIAL, path.join(source, "src/main/java/com/minemods/content_legacy_sample/entity"))
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
}, 120000)

test("a creature with only rules, or only a runtime block, is generated exactly as before the fix", () => {
  const rule = { id: "00000000-0000-4000-8000-000000000009", entity_id: "00000000-0000-4000-8000-000000000008", trigger: "player_near" as const, action: "look" as const, enabled: true }
  const alone = compileEntityLogic([rule], ["idle"], "creature")
  expect(alone.method).toEndWith("    @Override public void tick() {\n        super.tick();\n        if (!level().isClientSide()) applyStudioLogic();\n    }")
  const joined = compileEntityLogic([rule], ["idle"], "creature", false)
  expect(joined.method).not.toContain("tick()")
  expect(joined.method).toBe(alone.method.slice(0, alone.method.indexOf("\n\n    @Override public void tick()")))
  expect(joined.tick).toBe("if (!level().isClientSide()) applyStudioLogic();")
  expect(compileEntityLogic([{ ...rule, enabled: false }], ["idle"], "creature", false)).toEqual({ fields: "", method: "", controller: "", tick: "" })
})

// ---- 1. generation, tool tier, drops, experience ----

test("a block without the new fields parses, validates and compiles exactly as before", () => {
  const plain = block()
  expect(BlockSchema.parse(plain)).toEqual(plain as ReturnType<typeof BlockSchema.parse>)
  const compiled = compileContent(content([plain]))
  expect(Object.keys(compiled).some((name) => /worldgen|needs_|StudioWorldgen/.test(name))).toBe(false)
  const registry = String(compiled["src/main/java/com/minemods/content_azure/StudioContentRegistry.java"])
  expect(registry).toContain('new Block(BlockBehaviour.Properties.of().strength(3f).lightLevel(state -> 0).requiresCorrectToolForDrops()));')
  expect(registry).not.toMatch(/DropExperienceBlock|SoundType|StudioWorldgen|UniformInt/)
  // null means the same as leaving the field out.
  const nulls = compileContent(content([block({ generation: null, drop_item: null, tool_tier: null, experience: null, sound: null })]))
  expect(nulls).toEqual(compiled)
})

test("generation is bounded and says in plain words what is wrong", () => {
  expect(GenerationSchema.parse(overworld)).toEqual(overworld as ReturnType<typeof GenerationSchema.parse>)
  const refused = (change: Record<string, unknown>) => GenerationSchema.safeParse({ ...overworld, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
  expect(refused({ min_y: 60, max_y: 10 })).toContain("生成高度的上限不能比下限低")
  expect(refused({ dimension: "nether" })).toContain("下界里没有石头，换成下界岩")
  expect(refused({ dimension: "nether", replaces: ["netherrack"], min_y: -16 })).toContain("下界的高度只有 0 到 255")
  expect(refused({ dimension: "end", replaces: ["end_stone"], min_y: 0, biomes: "is_forest" })).toContain("只有主世界可以再限定群系")
  expect(refused({ replaces: ["stone", "stone"] })).toContain("不要重复写")
  expect(GenerationSchema.safeParse({ ...overworld, vein_size: 2 }).success).toBe(false)
  expect(GenerationSchema.safeParse({ ...overworld, vein_size: 21 }).success).toBe(false)
  expect(GenerationSchema.safeParse({ ...overworld, veins_per_chunk: 33 }).success).toBe(false)
  expect(GenerationSchema.safeParse({ ...overworld, replaces: ["dirt"] }).success).toBe(false)
  expect(GenerationSchema.safeParse({ ...overworld, biomes: "minecraft:plains" }).success).toBe(false)
  expect(GenerationSchema.safeParse({ ...overworld, loader: "fabric" }).success).toBe(false)
})

test("drops, tool tier and sounds are checked against the project, with plain messages", () => {
  const drop = { item: "azure_shard", min: 1, max: 2, fortune: true }
  expect(validateContent(content([block({ drop: "item", drop_item: drop, tool_tier: "iron" })])).blocks[0]!.drop_item).toEqual(drop)
  expect(message(() => validateContent(content([block({ drop: "item" })])))).toContain("没有写掉什么")
  expect(message(() => validateContent(content([block({ drop: "self", drop_item: drop })])))).toContain("drop 就要写成 item")
  expect(message(() => validateContent(content([block({ drop: "item", drop_item: { ...drop, item: "missing" } })])))).toContain("模组里没有别的方块或物品叫这个名字")
  expect(message(() => validateContent(content([block({ drop: "item", drop_item: { ...drop, item: "azure_ore" } })])))).toContain("模组里没有别的方块或物品叫这个名字")
  expect(message(() => validateContent(content([block({ tool: "none", tool_tier: "iron" })])))).toContain("得先选一种工具")
  expect(message(() => validateContent(content([block({ experience: { min: 1, max: 3 } })])))).toContain("可以反复放下再挖来刷经验")
  expect(validateContent(content([block({ drop: "none", experience: { min: 1, max: 3 } })])).blocks[0]!.experience).toEqual({ min: 1, max: 3 })
  expect(BlockSchema.safeParse(block({ drop: "item", drop_item: { ...drop, min: 3, max: 1 } })).error?.issues[0]?.message).toContain("掉落数量的最大值不能比最小值小")
  expect(BlockSchema.safeParse(block({ drop_item: { ...drop, item: "minecraft:diamond" } })).success).toBe(false)
  expect(BlockSchema.safeParse(block({ sound: "my_own_sound" })).success).toBe(false)
  expect(BlockSchema.safeParse(block({ tool_tier: "netherite" })).success).toBe(false)
  expect(BlockSchema.safeParse(block({ experience: { min: 0, max: 21 } })).success).toBe(false)
  // The workspace document of a block carries the same fields, so an AI's block task can set them.
  const { id: _id, ...document } = block({ generation: overworld, sound: "deepslate" })
  expect(getModuleSchema("block").safeParse({ kind: "block", ...document, texture: null }).success).toBe(true)
  expect(MODULES.block.references.some((reference) => reference.field === "drop_item.item" && reference.match === "identifier")).toBe(true)
})

test.skipIf(!HAS_GAME_DATA)("generated worldgen, loot and tag files have the shape of vanilla 1.21.1's own", () => {
  const ore = oreFeatures({ identifier: "azure_ore", generation: GenerationSchema.parse(overworld) }, "azure")
  expect(shape(ore.configured)).toEqual(shape(vanillaJson("data/minecraft/worldgen/configured_feature/ore_iron.json")))
  // trapezoid (more in the middle) and uniform, both with absolute heights, as vanilla writes them.
  expect(shape(ore.placed)).toEqual(shape(vanillaJson("data/minecraft/worldgen/placed_feature/ore_iron_middle.json")))
  expect(ore.placed.placement.map((step) => step.type)).toEqual((vanillaJson("data/minecraft/worldgen/placed_feature/ore_iron_middle.json") as { placement: { type: string }[] }).placement.map((step) => step.type))
  const nether = oreFeatures({ identifier: "ember_rock", generation: GenerationSchema.parse({ dimension: "nether", min_y: 10, max_y: 117, spread: "even", vein_size: 10, veins_per_chunk: 6, replaces: ["netherrack"], biomes: null }) }, "azure")
  expect(shape(nether.configured)).toEqual(shape(vanillaJson("data/minecraft/worldgen/configured_feature/ore_quartz.json")))
  expect(shape(nether.placed)).toEqual(shape(vanillaJson("data/minecraft/worldgen/placed_feature/ore_gold_extra.json")))
  const end = oreFeatures({ identifier: "void_ore", generation: GenerationSchema.parse({ dimension: "end", min_y: 0, max_y: 80, spread: "even", vein_size: 4, veins_per_chunk: 3, replaces: ["end_stone"], biomes: null }) }, "azure")
  expect(end.configured.config.targets).toEqual([{ state: { Name: "azure:void_ore" }, target: { block: "minecraft:end_stone", predicate_type: "minecraft:block_match" } }])
  // The values are the project's, not vanilla's.
  expect(ore.configured.config).toMatchObject({ size: 6, targets: [{ state: { Name: "azure:azure_ore" } }, { state: { Name: "azure:azure_ore" } }] })
  expect(ore.placed).toMatchObject({ feature: "azure:ore_azure_ore", placement: [{ count: 8 }, {}, { height: { type: "minecraft:trapezoid", min_inclusive: { absolute: -16 }, max_inclusive: { absolute: 48 } } }, {}] })
  // Loot: vanilla's ore tables, minus the optional random_sequence.
  const vanillaLoot = (name: string) => {
    const { random_sequence: _sequence, ...table } = vanillaJson(`data/minecraft/loot_table/blocks/${name}.json`) as Record<string, unknown>
    return shape(table)
  }
  expect(shape(oreLoot("azure", "azure_ore", { item: "azure_shard", min: 1, max: 1, fortune: true }))).toEqual(vanillaLoot("diamond_ore"))
  expect(shape(oreLoot("azure", "azure_ore", { item: "azure_shard", min: 4, max: 9, fortune: true }))).toEqual(vanillaLoot("lapis_ore"))
  expect(JSON.stringify(oreLoot("azure", "azure_ore", { item: "azure_shard", min: 1, max: 2, fortune: false }))).not.toContain("fortune")
  // Every rule test, biome tag and tool tag named in the vocabulary exists in the game.
  const tags = vanillaFiles().join("\n")
  Object.values(ORE_BASES).forEach((base) => {
    if ("tag" in base.target) expect(tags).toContain(`data/minecraft/tags/block/${base.target.tag.split(":")[1]}.json`)
  })
  Object.keys(ORE_BIOME_GROUPS).forEach((group) => expect(tags).toContain(`data/minecraft/tags/worldgen/biome/${group}.json`))
  Object.values(TOOL_TIERS).forEach((tier) => expect(tags).toContain(`data/minecraft/tags/block/${tier.tag}.json`))
  const compiled = compileContent(content([block({ tool_tier: "iron" })]))
  expect(Object.keys(shape(JSON.parse(String(compiled["src/main/resources/data/minecraft/tags/block/needs_iron_tool.json"]))) as object)).toContain("values")
  expect(JSON.parse(String(compiled["src/main/resources/data/minecraft/tags/block/needs_iron_tool.json"]))).toEqual({ replace: false, values: ["azure:azure_ore"] })
})

// ---- 2. sounds ----

test.skipIf(!hasTargetJavac(OFFICIAL))("every sound, sound group and selector in the vocabulary is a real constant of the game", async () => {
  const root = await temporary()
  await writeFile(
    path.join(root, "Vocabulary.java"),
    `import net.minecraft.world.level.block.SoundType; import net.minecraft.sounds.SoundEvent; import net.minecraft.sounds.SoundEvents;
import net.fabricmc.fabric.api.biome.v1.BiomeSelectionContext; import net.fabricmc.fabric.api.biome.v1.BiomeSelectors; import java.util.function.Predicate;
final class Vocabulary {
    static final SoundType[] GROUPS = { ${Object.keys(BLOCK_SOUNDS).map((key) => `SoundType.${SOUND_TYPES[key as BlockSound]}`).join(", ")} };
    static final SoundEvent[] SOUNDS = { ${Object.keys(CREATURE_SOUNDS).map((id) => `SoundEvents.${soundConstant(id)}`).join(", ")} };
    static final java.util.List<Predicate<BiomeSelectionContext>> WHERE = java.util.List.of(${Object.values(ORE_DIMENSIONS).map((dimension) => `BiomeSelectors.${dimension.selector}()`).join(", ")});
}
`,
  )
  const compiled = await targetJavac(OFFICIAL, root)
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
  expect(Object.keys(CREATURE_SOUNDS).length).toBeGreaterThanOrEqual(36)
  expect(CREATURE_SOUNDS["entity.iron_golem.hurt"]).toBe("铁傀儡受伤")
  expect(CREATURE_SOUNDS["block.amethyst_block.chime"]).toBe("紫水晶叮声")
  // A name is said once: two sounds never share one.
  expect(new Set(Object.values(CREATURE_SOUNDS)).size).toBe(Object.keys(CREATURE_SOUNDS).length)
}, 120000)

test("creature sounds are bounded, and a creature without them is generated as before", () => {
  const sounds = { ambient: null, hurt: "entity.iron_golem.hurt", death: null, step: null, pitch: 0.8, volume: 1 }
  expect(CreatureSoundsSchema.parse(sounds)).toEqual(sounds)
  expect(CreatureSoundsSchema.safeParse({ ...sounds, hurt: "entity.player.burp" }).success).toBe(false)
  expect(CreatureSoundsSchema.safeParse({ ...sounds, pitch: 2.5 }).success).toBe(false)
  expect(CreatureSoundsSchema.safeParse({ ...sounds, volume: 0 }).success).toBe(false)
  const input = { modId: "azure", packageName: "com.minemods.content_azure", id: "golem", name: "晶石傀儡", health: 40, speed: 0.2, attack_damage: 6, behavior: "hostile", model: golemDesign }
  const plain = compileEntity(input)
  expect(compileEntity({ ...input, sounds: null })).toEqual(plain)
  const creature = "src/main/java/com/minemods/content_azure/entity/StudioCreature.java"
  expect(String(plain[creature])).not.toMatch(/SoundEvent|getVoicePitch/)
  const voiced = String(compileEntity({ ...input, sounds })[creature])
  expect(voiced).toContain("@Override protected SoundEvent getHurtSound(DamageSource source) { return SoundEvents.IRON_GOLEM_HURT; }")
  expect(voiced).toContain("* 0.2f + 0.8f; }")
  // Moments that were not chosen are not overridden: they stay what every mob does.
  expect(voiced).not.toMatch(/getAmbientSound|getDeathSound|playStepSound/)
  // Everything but the creature class is untouched by sounds.
  const other = compileEntity({ ...input, sounds })
  const rest = (files: typeof plain) => Object.fromEntries(Object.entries(files).filter(([name]) => name !== creature))
  expect(rest(other)).toEqual(rest(plain))
})

// ---- 3. glow ----

test("glow features give a second picture holding exactly the lit texels, and nothing changes without them", () => {
  const glowing = compileModel(golemDesign, "golem")
  expect(glowing.glow).not.toBeNull()
  const base = decodeRgbaPng(glowing.png)
  const mask = decodeRgbaPng(glowing.glow!)
  expect([mask.width, mask.height]).toEqual([base.width, base.height])
  const lit = Array.from({ length: mask.width * mask.height }, (_, index) => index).filter((index) => mask.pixels[index * 4 + 3] !== 0)
  // Two eyes and the veins: a handful of texels, each the very colour of the texture there, everything else fully transparent.
  expect(lit.length).toBeGreaterThan(8)
  expect(lit.length).toBeLessThan(200)
  expect(lit.every((index) => [0, 1, 2].every((channel) => mask.pixels[index * 4 + channel] === base.pixels[index * 4 + channel]) && mask.pixels[index * 4 + 3] === 255)).toBe(true)
  // The same design with glow switched off paints the same texture apart from the glow's own halo, and has no mask.
  const dull = JSON.parse(JSON.stringify(golemDesign).replaceAll('"glow":true', '"glow":false')) as typeof golemDesign
  expect(compileModel(dull, "golem").glow).toBeNull()
  const input = { modId: "azure", packageName: "com.minemods.content_azure", id: "golem", name: "晶石傀儡", health: 40, speed: 0.2, attack_damage: 6, behavior: "hostile", model: golemDesign }
  const renderer = "src/main/java/com/minemods/content_azure/client/StudioCreatureRenderer.java"
  // The layer is only added when the build says the mask is there.
  expect(String(compileEntity(input)[renderer])).not.toContain("AutoGlowingGeoLayer")
  expect(String(compileEntity({ ...input, glow: true })[renderer])).toContain("addRenderLayer(new AutoGlowingGeoLayer<>(this));")
})

test("the build puts each glow picture exactly where GeckoLib's glow layer reads it, and the jar check asks for it", async () => {
  // GeckoLib 4.8.3 (AutoGlowingTexture.getEmissiveResource): the mask is the texture's own path with `_glowmask` before `.png`.
  expect(glowMaskPath("textures/entity/golem.png")).toBe("textures/entity/golem_glowmask.png")
  const { source, built } = await sample()
  const creature = built.entityIds[0]!
  const mod = built.project.mod_id
  const renderer = await text(source, `src/main/java/com/minemods/content_${mod}/client/StudioCreatureRenderer.java`)
  // The texture the renderer draws with, read back from the generated Java, is what the layer derives the mask path from.
  const texture = /ResourceLocation\.fromNamespaceAndPath\("([^"]+)", "(textures\/entity\/[^"]+\.png)"\)/.exec(renderer)!
  expect(texture[1]).toBe(mod)
  expect(renderer).toContain("addRenderLayer(new AutoGlowingGeoLayer<>(this));")
  const maskInJar = `assets/${texture[1]}/${glowMaskPath(texture[2]!)}`
  expect(maskInJar).toBe(`assets/${mod}/textures/entity/${creature}_glowmask.png`)
  // The build's own jar check asks for it, so a jar without it is refused instead of glowing nowhere.
  expect(built.glowMasks).toContain(maskInJar)
  const base = decodeRgbaPng(await readFile(path.join(source, `src/main/resources/assets/${mod}/${texture[2]}`)))
  const mask = decodeRgbaPng(await readFile(path.join(source, "src/main/resources", maskInJar)))
  // GeckoLib throws when the sizes differ, and reads every non-zero texel of the mask with its alpha as the strength.
  expect([mask.width, mask.height]).toEqual([base.width, base.height])
  const lit = Array.from({ length: mask.width * mask.height }, (_, index) => index).filter((index) => mask.pixels.slice(index * 4, index * 4 + 4).some(Boolean))
  expect(lit.length).toBeGreaterThan(0)
  expect(lit.every((index) => mask.pixels[index * 4 + 3] === 255)).toBe(true)
})

// ---- the sample project: everything together ----

test("the sample project assembles its data files, and its whole Java tree compiles", async () => {
  const { source, built, project } = await sample()
  const names = await files(source)
  const mod = project.mod_id
  const creature = built.entityIds[0]!
  ;[
    `src/main/resources/data/${mod}/worldgen/configured_feature/ore_azure_ore.json`,
    `src/main/resources/data/${mod}/worldgen/placed_feature/ore_azure_ore.json`,
    `src/main/resources/data/${mod}/worldgen/configured_feature/ore_ember_rock.json`,
    `src/main/resources/data/${mod}/worldgen/placed_feature/ore_ember_rock.json`,
    "src/main/resources/data/minecraft/tags/block/needs_iron_tool.json",
    "src/main/resources/data/minecraft/tags/block/needs_stone_tool.json",
    "src/main/resources/data/minecraft/tags/block/mineable/pickaxe.json",
    `src/main/resources/assets/${mod}/textures/entity/${creature}_glowmask.png`,
    `src/main/java/com/minemods/content_${mod}/StudioWorldgen.java`,
  ].forEach((name) => expect(names).toContain(name))
  // A block that does not generate has no feature; one class serves every ore.
  expect(names.filter((name) => name.includes("/worldgen/"))).toHaveLength(4)
  expect(names.filter((name) => /Worldgen/.test(name))).toHaveLength(1)
  const worldgen = await text(source, `src/main/java/com/minemods/content_${mod}/StudioWorldgen.java`)
  expect(worldgen).toContain('new Ore("ore_azure_ore", "overworld", null),')
  expect(worldgen).toContain('new Ore("ore_ember_rock", "nether", null),')
  expect(worldgen.match(/BiomeModifications\.addFeature/g)).toHaveLength(1)
  expect(await json(source, `src/main/resources/data/${mod}/loot_table/blocks/azure_ore.json`)).toEqual(oreLoot(mod, "azure_ore", { item: "azure_shard", min: 1, max: 2, fortune: true }))
  const registry = await text(source, `src/main/java/com/minemods/content_${mod}/StudioContentRegistry.java`)
  expect(registry).toContain("new DropExperienceBlock(UniformInt.of(2, 5), BlockBehaviour.Properties.of().strength(3f).lightLevel(state -> 3).requiresCorrectToolForDrops().sound(SoundType.AMETHYST))")
  expect(registry).toContain("        StudioWorldgen.register();\n")
  expect(await text(source, `src/main/java/com/minemods/content_${mod}/client/StudioCreatureRenderer.java`)).toContain("AutoGlowingGeoLayer")
  // Gameplay code may not put its own file where Studio writes one of these.
  const reserved = generatedNames(project)
  expect(names.filter((name) => name.startsWith("src/main/resources/data/") && /worldgen|needs_/.test(name)).every((name) => reserved.data(name.slice("src/main/resources/".length)))).toBe(true)
  expect(reserved.data(`data/${mod}/worldgen/placed_feature/own_feature.json`)).toBe(false)
  // Nothing of the guide or the reconciliation is written into the source: it goes beside the jar.
  expect(names.some((name) => name.includes(GUIDE_FILE) || name.endsWith(".bbmodel"))).toBe(false)
  if (!hasTargetJavac(OFFICIAL)) return
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output).not.toContain("error")
  expect(compiled.code).toBe(0)
}, 120000)

test("an old project gains none of the new files", async () => {
  const root = await legacy()
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(root, source, TEMPLATE)
  expect((await files(source)).some((name) => /worldgen|glowmask|StudioWorldgen|needs_|bbmodel|模组说明/.test(name))).toBe(false)
  // The old sample still builds as before; its unsegmented appendage and the missing English name are advice.
  expect(machine(built.findings).map((finding) => `${finding.rule}${finding.stops ? "!" : ""}`)).toEqual(["appendage_chain", "english_missing"])
  // What the playable standard says about an old project is a reminder, never a stop.
  expect(built.findings.filter((finding) => finding.rule.startsWith("play_")).every((finding) => !finding.stops)).toBe(true)
  expect(built.looks).toHaveLength(1)
  if (!hasTargetJavac(OFFICIAL)) return
  expect(((await compileTreeFor(OFFICIAL, source))!).code).toBe(0)
}, 120000)

// ---- 6. machine reconciliation ----

test("the runtime plays idle, walk, hurt and what an enabled rule names, and reconciliation says what is never played", async () => {
  const { project, built } = await sample()
  const golem = project.entities[0]!
  expect(BUILT_IN_MOTIONS).toEqual(["idle", "walk", "hurt"])
  expect(playedAnimations(project, golem.id)).toEqual(["idle", "walk", "hurt", "roar"])
  expect(playedAnimations({ logic: project.logic.map((rule) => ({ ...rule, enabled: false })) }, golem.id)).toEqual(["idle", "walk", "hurt"])
  // A motion a rule asks for that the model does not have cannot play, and is not said to.
  expect(playedAnimations({ logic: project.logic.map((rule) => ({ ...rule, animation: "spin" })) }, golem.id, ["idle", "walk", "hurt", "roar", "wave"])).toEqual(["idle", "walk", "hurt"])
  expect(machine(built.findings).map((finding) => finding.rule)).toEqual(["animation_unplayed"])
  const finding = built.findings[0]!
  expect(finding).toMatchObject({ stops: false, about: { kind: "entity", id: golem.id, name: "晶石傀儡" } })
  // Said by its plain name (the clip name is in `detail`, below, for whoever has to write it).
  expect(finding.text).toContain("挥动")
  expect(finding.text).not.toContain("roar")
  expect(finding.text).not.toContain("吼叫")
  expect(finding.fix).toContain("待机、走路、受伤、吼叫")
  expect(finding.detail).toBe("never played: wave; played: idle, walk, hurt, roar")
  // broad2: gameplay code that starts a clip by the name the creature gives it plays it; another creature's clip of the same name does not count.
  const coded = (content: string) => ({ ...project, workspace: { ...project.workspace, assets: [...project.workspace.assets, { id: "g", module: "gameplay", title: "g", document: { kind: "gameplay", sources: [{ path: "client/ClientMain.java", content }] } }] } }) as never
  expect(playedAnimations(coded(`RawAnimation.begin().thenLoop("animation.${creatureName({ id: golem.id })}.wave")`), golem.id, ["idle", "walk", "hurt", "roar", "wave"])).toContain("wave")
  expect(playedAnimations(coded(`RawAnimation.begin().thenLoop("animation.creature_other.wave")`), golem.id, ["idle", "walk", "hurt", "roar", "wave"])).not.toContain("wave")
})

test("a motion the project's gameplay code plays is not said to be never played, in the findings or in the guide", async () => {
  const { project } = await sample()
  const golem = project.entities[0]!
  const animations = { [golem.id]: ["idle", "walk", "hurt", "roar", "wave"] }
  const withCode = (content: string, uses: string[] = []) => ({ ...project, workspace: { ...project.workspace, assets: [...project.workspace.assets, { id: "g", module: "gameplay", title: "g", document: { ...BOX_GUARD, kind: "gameplay", uses, sources: [{ path: "Main.java", content }] } }] } }) as never as Project
  const report = (changed: Project) => ({ findings: reconcile(changed, { animations }).filter((finding) => finding.rule === "animation_unplayed"), guide: modGuide(changed, { findings: reconcile(changed, { animations }), animations, glowing: [], built: false }).markdown })
  expect(report(project).findings).toHaveLength(1)
  expect(report(project).guide).toContain("没有东西去播放")
  // A name written out in a play call is played (a bare clip name, or the full name of this creature's clip), whatever else the code does.
  for (const code of [`geo.triggerAnim("gameplay", "wave");`, `controller.triggerableAnim("wave", RawAnimation.begin().thenPlay("animation.${creatureName({ id: golem.id })}.wave"));`, `RawAnimation.begin().thenLoop("wave")`, `ProjectContent.playMotion(mob.getOwner(), "wave");`]) {
    const done = report(withCode(code))
    expect(done.findings).toEqual([])
    expect(done.guide).not.toContain("没有东西去播放")
    expect(done.guide).not.toContain("可能由玩法代码播放")
    expect(playedAnimations(withCode(code), golem.id, animations[golem.id])).toContain("wave")
  }
  // Another creature's clip, a name that is not a motion of this model, and a name only in a comment or in other text do not count.
  for (const code of [`RawAnimation.begin().thenLoop("animation.creature_other.wave")`, `geo.triggerAnim("gameplay", "spin");`, `// geo.triggerAnim("gameplay", "wave")\nlog("wave");`]) expect(report(withCode(code)).findings).toHaveLength(1)
  // A name the code builds cannot be read: nothing is said to be never played, and the guide says the rest may be played by that code.
  const built = report(withCode(`geo.triggerAnim("gameplay", prefix + kind);`))
  expect(built.findings).toEqual([])
  expect(built.guide).not.toContain("没有东西去播放")
  expect(built.guide).toContain("可能由玩法代码播放")
  expect(mayBePlayedByGameplay(withCode(`geo.triggerAnim("gameplay", prefix + kind);`), golem.id)).toBe(true)
  expect(mayBePlayedByGameplay(withCode(`geo.triggerAnim("gameplay", "wave");`), golem.id)).toBe(false)
  // Code that is about another creature, and not about this one, is not held to play this one's motions.
  const other = { ...project, entities: [...project.entities, { ...golem, id: "99999999-9999-4999-8999-999999999999" }] } as Project
  const aboutOther = { ...other, workspace: { ...other.workspace, assets: [...other.workspace.assets, { id: "g", module: "gameplay", title: "g", document: { ...BOX_GUARD, kind: "gameplay", uses: ["99999999-9999-4999-8999-999999999999"], sources: [{ path: "Main.java", content: `geo.triggerAnim("gameplay", prefix + kind);` }] } }] } } as never as Project
  expect(mayBePlayedByGameplay(aboutOther, golem.id)).toBe(false)
})

test("generated creature code starts exactly the animations reconciliation says are played", async () => {
  const { source, project, built } = await sample()
  const creature = await text(source, `src/main/java/com/minemods/content_${project.mod_id}/entity/StudioCreature.java`)
  const started = [...creature.matchAll(/"animation\.[a-z0-9_]+\.([A-Za-z0-9_]+)"/g)].map((match) => match[1]!)
  expect([...new Set(started)].sort()).toEqual([...playedAnimations(project, project.entities[0]!.id)].sort())
  expect(Object.keys(built.looks[0]!.animation.animations).map((name) => name.split(".").at(-1))).toContain("wave")
})

test("each reconciliation rule fires on what it is for and on nothing else", async () => {
  const { project, built } = await sample()
  const golem = project.entities[0]!
  const animations = { [golem.id]: ["idle", "walk", "hurt", "roar", "wave"] }
  const rules = (changed: Project, facts: Partial<Parameters<typeof reconcile>[1]> = {}) => machine(reconcile(changed, { animations, ...facts })).map((finding) => `${finding.rule}${finding.stops ? "!" : ""}`)
  expect(rules(project)).toEqual(["animation_unplayed"])
  // A creature without a model, or whose model lacks a built-in motion, stops the build.
  expect(rules(project, { animations: {} })).toEqual(["model_missing!"])
  expect(rules(project, { animations: { [golem.id]: ["idle", "walk", "roar"] } })).toEqual(["model_motions!"])
  // A rule naming a motion the model does not have stops it too.
  expect(rules(project, { animations: { [golem.id]: ["idle", "walk", "hurt"] } })).toEqual(["rule_animation!"])
  // Content edited by hand into naming something that is gone.
  const lostRecipe = { ...project, items: [] }
  expect(rules(lostRecipe)).toContain("recipe_reference!")
  expect(rules(lostRecipe)).toContain("drop_reference!")
  expect(reconcile(lostRecipe, { animations }).find((finding) => finding.rule === "recipe_reference")!.text).toContain("配方「蓝晶块」用到了「azure_shard」")
  // Round 19: a finding that asks the person to fill a field says which field of which thing, in the thing's own form path.
  const fieldsOf = (found: ReturnType<typeof reconcile>, rule: string) => found.filter((finding) => finding.rule === rule).flatMap((finding) => (finding.targets ?? []).map((target) => [target.about.kind, target.about.name, target.field]))
  expect(fieldsOf(reconcile(lostRecipe, { animations }), "recipe_reference")).toEqual([["recipe", "蓝晶块", "pattern"]])
  expect(fieldsOf(reconcile(lostRecipe, { animations }), "drop_reference").length).toBeGreaterThan(0)
  expect(fieldsOf(reconcile(lostRecipe, { animations }), "drop_reference").every(([kind, , field]) => kind === "block" && field === "drop")).toBe(true)
  // An ore that generates and drops nothing.
  const barren = { ...project, blocks: project.blocks.map((value) => (value.identifier === "ember_rock" ? { ...value, drop: "none" as const } : value)) }
  expect(reconcile(barren, { animations }).filter((finding) => finding.rule === "ore_drops_nothing").map((finding) => finding.about?.name)).toEqual(["余烬石"])
  expect(fieldsOf(reconcile(barren, { animations }), "ore_drops_nothing")).toEqual([["block", "余烬石", "drop"]])
  // An explosion on a creature that never approaches anybody.
  const harmless = { ...project, entities: [{ ...golem, behavior: "passive" as const, runtime: { ...golem.runtime!, explosion: { fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] } } }] }
  expect(rules(harmless)).toContain("explosion_never")
  // Names: a key missing from either language, and a key present in one language only.
  const keys = [...project.blocks.map((value) => `block.${project.mod_id}.${value.identifier}`), ...project.items.map((value) => `item.${project.mod_id}.${value.identifier}`), `entity.${project.mod_id}.${built.entityIds[0]}`, `item.${project.mod_id}.${built.entityIds[0]}_spawn_egg`]
  const full = Object.fromEntries(keys.map((key) => [key, "名字"]))
  expect(rules(project, { built: { lang: { zh_cn: full, en_us: full }, files: [] } })).toEqual(["animation_unplayed"])
  const { [keys[0]!]: _dropped, ...partial } = full
  const missing = reconcile(project, { animations, built: { lang: { zh_cn: full, en_us: partial }, files: [] } }).filter((finding) => finding.rule === "language_key")
  expect(missing).toHaveLength(1)
  expect(missing[0]).toMatchObject({ stops: false, detail: `en_us: ${keys[0]}` })
  expect(missing[0]!.text).toContain("英文游戏里没有名字")
  expect(reconcile(project, { animations, built: { lang: { zh_cn: { ...full, "key.extra": "多的" }, en_us: full }, files: [] } }).filter((finding) => finding.rule === "language_key")[0]).toMatchObject({ about: null, detail: "en_us: key.extra" })
  // A creature nobody can ever meet: no natural spawn and, in the generated names, no spawn egg.
  const egg = keys.at(-1)!
  const { [egg]: _egg, ...eggless } = full
  const hidden = { ...project, entities: [{ ...golem, runtime: { ...golem.runtime!, spawn: null } }] }
  expect(rules(hidden, { built: { lang: { zh_cn: eggless, en_us: eggless }, files: [] } })).toContain("creature_unreachable")
  expect(rules(hidden, { built: { lang: { zh_cn: full, en_us: full }, files: [] } })).not.toContain("creature_unreachable")
  // Gameplay whose current version has no check on record.
  expect(reconcile(project, { animations, gameplay: [{ id: IDS.box_guard, title: "守匣", checked: false }, { id: IDS.item, title: "别的", checked: true }] }).filter((finding) => finding.rule === "gameplay_unchecked").map((finding) => finding.about?.name)).toEqual(["守匣"])
  // The real build of the sample compared its real names: nothing was missing.
  expect(built.findings.some((finding) => finding.rule === "language_key" || finding.rule === "creature_unreachable")).toBe(false)
})

// ---- 4. the mod guide ----

const at = (root: unknown, pointer: string): unknown =>
  [...pointer.matchAll(/[^.[\]]+/g)].reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key[0]] : undefined), root)
const strings = (value: unknown): string[] => (typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [])
const numerals = (value: string) => [...value.replaceAll("−", "-").matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
const numbers = (value: unknown): number[] => (typeof value === "number" ? [Math.abs(value)] : typeof value === "string" ? numerals(value) : value && typeof value === "object" ? Object.values(value).flatMap(numbers) : [])

/**
 * Numbers the guide's wording contains that are constants of the generated code, each checked against that
 * code just below: the top light level, the reach of a rule, the fuse distance, the version in the jar name.
 */
const WORDING_NUMBERS: [RegExp, number[]][] = [
  [/最亮是 15/, [15]],
  [/走到 8 格以内/, [8]],
  [/玩家 3 格以内/, [3]],
  [/-0\.1\.0\.jar/, [0.1, 0]],
  [/试第 \d+ 条/, []],
  // broad6 w1: the command that brings a walled-in hostile creature six blocks in front of the person (a fixed distance of the sentence, not of the project).
  [/\^ \^ \^6` 再按回车，它就到你面前 6 格/, [6]],
]

/** The machine rules alone: the playable standard's reminders (`play_*`, never a stop) are held in playable.test.ts. */
const machine = <Found extends { rule: string }>(findings: readonly Found[]) => findings.filter((finding) => !finding.rule.startsWith("play_"))

/** Holds one guide to its data: every source exists, and every number and quoted name in a sentence is in its sources. */
function expectBacked(guide: ModGuide, project: Project, extra: { findings: unknown; animations: Record<string, readonly string[]> }) {
  const root = { ...project, profile: resolveProfile(project.target), built: true, ...extra }
  // A name may be said through the shared vocabularies; anything else in 「」 has to be in the project's own records.
  // Round 17: the game's own screens and tabs the steps name, and a creature's spawn egg, which the game names after the creature.
  const vocabulary = new Set([...Object.values(CREATURE_SOUNDS), ...Object.values(extra.animations).flatMap((names) => names.flatMap((name) => [name, motionName(name)])), ...GAME_WORDS, ...project.entities.map((entity) => `${entity.name}刷怪蛋`)])
  const lines = guide.sections.flatMap((section) => section.lines.map((line) => ({ section: section.title, ...line })))
  expect(lines.length).toBeGreaterThan(5)
  lines.forEach((line) => {
    expect(line.from.length).toBeGreaterThan(0)
    const sources = line.from.map((pointer) => ({ pointer, value: at(root, pointer) }))
    sources.forEach((source) => expect([source.pointer, source.value === undefined || source.value === null]).toEqual([source.pointer, false]))
    const known = sources.flatMap((source) => numbers(source.value))
    // Stated as they are, or as hearts (half), seconds (a twentieth), a percentage, or a count of what is listed.
    const allowed = new Set([...known, ...known.flatMap((value) => [value / 2, Number((value / 20).toFixed(1)), Math.round(value * 100)]), ...sources.flatMap((source) => (Array.isArray(source.value) ? [source.value.length] : source.value && typeof source.value === "object" ? Object.values(source.value).flatMap((value) => (Array.isArray(value) ? [value.length] : value && typeof value === "object" ? Object.values(value).flatMap((inner) => (Array.isArray(inner) ? [inner.length] : [])) : [])) : [])), ...WORDING_NUMBERS.filter(([pattern]) => pattern.test(line.text)).flatMap(([pattern, values]) => [...values, ...numerals(pattern.exec(line.text)![0])])])
    // An id the player types (/give, /summon) is this mod's id and the registry name of a thing the sentence is about.
    const ids = [...line.text.matchAll(/\b([a-z][a-z0-9_]*):([a-z0-9_]+)/g)]
    const registered = sources.flatMap((source) => (source.value && typeof source.value === "object" ? [(source.value as { identifier?: string }).identifier, `creature_${String((source.value as { id?: string }).id).replaceAll("-", "")}`] : []))
    // A vanilla id is only ever one the records themselves hold (a recipe ingredient, a reward).
    ids.forEach((match) => expect([line.text, match[0], (match[1] === project.mod_id && registered.includes(match[2]!)) || sources.some((source) => strings(source.value).includes(match[0]))]).toEqual([line.text, match[0], true]))
    // The name of a key (F3+B shows collision boxes, F3 the height) is not a number of the project.
    numerals(ids.reduce((rest, match) => rest.replace(match[0], ""), line.text.replaceAll("F3+B", "").replaceAll("F3", ""))).forEach((value) => expect([line.text, value, allowed.has(value)]).toEqual([line.text, value, true]))
    // A name is one of the records' own strings, or stands inside one (prose a person or an AI wrote into the project).
    const said = sources.flatMap((source) => strings(source.value))
    ;[...line.text.matchAll(/「([^」]+)」/g)].forEach((match) => expect([line.text, match[1], said.some((value) => value.includes(match[1]!)) || vocabulary.has(match[1]!)]).toEqual([line.text, match[1], true]))
  })
  // The page is the sections and nothing more.
  expect(guide.markdown.split("\n").filter((line) => line.startsWith("- "))).toEqual(lines.map((line) => `- ${line.text}`))
}

test("the constants in the guide's wording are the generated code's own", async () => {
  const logic = await readFile(fileURLToPath(new URL("../src/fabric/logic.ts", import.meta.url)), "utf8")
  const entity = await readFile(fileURLToPath(new URL("../src/fabric/entity.ts", import.meta.url)), "utf8")
  const build = await readFile(fileURLToPath(new URL("../src/build.ts", import.meta.url)), "utf8")
  expect(logic).toContain("getNearestPlayer(this, 8.0)")
  expect(entity).toContain("RUNTIME_FUSE_DISTANCE = 3.0")
  expect(build).toContain("jarName(source.project)")
  expect(jarName({ mod_id: "azure_sample" })).toBe("azure_sample-0.1.0.jar")
  expect(BlockSchema.shape.luminance.safeParse(15).success && !BlockSchema.shape.luminance.safeParse(16).success).toBe(true)
  // What the guide says a tool, a mood and a missing sound mean is what the template writes.
  expect(entity).toContain('data.behavior === "follow" ? `&& (${lured("player.getMainHandItem()")}')
  expect(entity).toContain('`${stack}.is(Items.WHEAT)`')
  expect(entity).toContain("Monster.isDarkEnoughToSpawn(world, pos, random)")
  const content = await readFile(fileURLToPath(new URL("../src/content.ts", import.meta.url)), "utf8")
  expect(content).toContain('needsTool(block) ? ".requiresCorrectToolForDrops()" : ""')
})

test("every sentence of the sample project's guide is backed by its data", async () => {
  const { project, built } = await sample()
  const guide = built.guide
  expectBacked(guide, project, { findings: built.findings, animations: Object.fromEntries(built.looks.map((look, index) => [project.entities[index]!.id, Object.keys(look.animation.animations).map((name) => name.split(".").at(-1)!)])) })
  const page = guide.markdown
  expect(page).toStartWith("# 蓝晶矿洞 模组说明\n")
  // The plain facts the brief asks for, word for word from the data.
  expect(page).toContain("「蓝晶矿石」在主世界 Y −16 到 48 的石头、深板岩里生成（越靠中间越多），每个区块约 8 团，每团最多 6 块。")
  expect(page).toContain("「蓝晶矿石」挖掉会掉 1–2 个「蓝晶碎片」，带时运的工具会掉得更多；用精准采集挖，掉的是它自己。")
  expect(page).toContain("「蓝晶矿石」至少要用铁镐才挖得下来，用更差的工具挖什么都不掉。")
  expect(page).toContain("「余烬石」在下界 Y 10 到 117 的下界岩里生成，每个区块约 6 团，每团最多 10 块。")
  expect(page).toContain("受伤时是「铁傀儡受伤」的声音")
  expect(page).toContain("「蓝晶块」可以合成：在工作台上按配方「蓝晶块」摆放 9 个「蓝晶碎片」，做出 1 个。")
  expect(page).toContain("会自己出现在这些群系：溶洞、平原，一次 1–2 只；只在暗处出现，和平难度下不出现。")
  expect(page).toContain("模型里的「挥动」没有东西去播放，游戏里看不到。")
  expect(page).toContain(`Minecraft ${resolveProfile(project.target).minecraft}`)
  expect(page).toContain("azure_sample-0.1.0.jar")
  expect(page).toContain("没有人替你启动游戏试玩过")
  // Nothing about what this project does not have.
  expect(page).not.toMatch(/施法动作|按键|盲盒|爆炸|AI 写的代码|不做什么/)
  expect(guide.sections.map((section) => section.title)).toEqual(["作者的介绍", "模组里有什么", "进游戏找到这些东西", "怎么玩一遍", "进游戏亲眼看这几样", "怎么得到这些东西", "方块挖起来怎么样", "生物「晶石傀儡」", "机器对账发现的问题", "怎么安装"])
})

test("a sentence disappears with the data behind it, and never claims what the project does not do", async () => {
  const { project } = await sample()
  const animations = { [project.entities[0]!.id]: ["idle", "walk", "hurt", "roar", "wave"] }
  const page = (changed: Project, glowing: string[] = []) => modGuide(changed, { findings: reconcile(changed, { animations }), animations, glowing, built: false }).markdown
  const golem = project.entities[0]!
  // No sounds, no spawn rule, no rules: said as that, not as a default that sounds nice.
  const bare = page({ ...project, logic: [], entities: [{ ...golem, sounds: undefined, runtime: undefined, behavior: "passive" }] })
  expect(bare).toContain("没有设置声音：平时不出声，受伤和死的时候是所有生物通用的声音。")
  expect(bare).toContain("不会自己出现：按 E 打开创造模式物品栏，在「刷怪蛋」页签里找「晶石傀儡刷怪蛋」，拿在手上对着地面右键；或者按 T 打开聊天框，粘贴 `/summon azure_sample:creature_")
  expect(bare).toContain("游戏里它会做的动作只有：待机、走路、受伤。")
  expect(bare).not.toMatch(/铁傀儡|打中玩家|护甲|发光的部分/)
  expect(page(project)).not.toContain("发光的部分")
  expect(page(project, [golem.id])).toContain("模型上画成发光的部分（眼睛、纹路）在黑暗里也是亮的。")
  // An item nothing makes, drops or generates.
  const orphan = page({ ...project, recipes: [], blocks: project.blocks.filter((value) => value.identifier !== "azure_ore") })
  expect(orphan).toContain("「蓝晶碎片」没有配方，不会在世界里生成，也没有方块或生物掉它：可以在创造模式里拿：按 E 打开物品栏，点「搜索物品」页签，输入它的名字；不想翻物品栏的话，按 T 打开聊天框，粘贴 `/give @s azure_sample:azure_shard` 再按回车，直接给你一个。")
  expect(orphan).not.toContain("会掉 1–2 个")
  // Not yet built: the guide does not say it was compiled.
  expect(page(project)).toContain("模组还没有打包")
  expect(page(project)).not.toContain("核对过它能编译")
  // An empty project has an honest, short guide.
  const empty = page({ ...project, blocks: [], items: [], recipes: [], logic: [], entities: [], assets: [], workspace: { assets: [] }, description: "" })
  expect(empty).toContain("这个模组里还没有任何东西。")
  expect(empty.split("\n").filter((line) => line.startsWith("## "))).toEqual(["## 模组里有什么", "## 怎么安装"])
})

test("gameplay, cast actions and what the plan left out are written from their own records", () => {
  const base = sampleProject()
  const NOW = "2026-10-05T08:00:00.000Z"
  const gameplay = WorkspaceAssetSchema.parse({ id: IDS.box_guard, module: "gameplay", title: BOX_GUARD.name, revision: 1, created_at: NOW, updated_at: NOW, prompt: "守着秘匣的生物", dependencies: BOX_GUARD.uses, document: BOX_GUARD, provenance: { model: "gpt-6-astra", request_id: null }, status: "ready" })
  const project = ProjectSchema.parse({
    ...base,
    workspace: { assets: [...base.workspace.assets, gameplay] },
    blueprint: { request: "一个守着秘匣的生物", style: { palette: [], shape: "", naming: "", world: "" }, entries: [{ key: "boss", kind: "entity", title: "最终首领", brief: "一个很强的首领", owner: null, needs: [], out_of_scope: "多阶段的首领战现在做不了，这次不做。", asset_id: null }], questions: [], revision: 1, state: "confirmed" },
  })
  const animations = Object.fromEntries(project.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]]))
  const findings = reconcile(project, { animations, gameplay: [{ id: IDS.box_guard, title: BOX_GUARD.name, checked: false }] })
  const guide = modGuide(project, { findings, animations, glowing: [], built: true })
  expectBacked(guide, project, { findings, animations })
  const page = guide.markdown
  expect(page).toContain(`玩法「${BOX_GUARD.name}」（这部分是 AI 写的代码）：${BOX_GUARD.summary}`)
  expect(page).toContain("Studio 没有、也不会替你进游戏试玩。")
  expect(page).toContain("怎么在游戏里试：先把构建出来的模组放进 mods 文件夹")
  BOX_GUARD.behaviours.forEach((behaviour) => expect(page).toContain(`${behaviour.when}：${behaviour.does}`))
  BOX_GUARD.not_doing.forEach((line) => expect(page).toContain(`玩法「${BOX_GUARD.name}」不会：${line}`))
  expect(page).toContain("「最终首领」：多阶段的首领战现在做不了，这次不做。")
  expect(page).toContain(`玩法「${BOX_GUARD.name}」现在这一版代码没有检查记录`)
  expect(guide.sections.map((section) => section.title)).toContain("这个模组不做什么")
})

test("the guide and the reconciliation can be read for a saved project without building it", async () => {
  const { directory, project } = await sample()
  const report = await projectGuide(directory)
  expect(report.revision).toBe(project.revision)
  expect(machine(report.findings).map((finding) => finding.rule)).toEqual(["animation_unplayed"])
  expect(report.guide.markdown).toContain("模型上画成发光的部分")
  expect(report.guide.markdown).toContain("模组还没有打包")
  // A creature whose model is gone is reported, not thrown.
  const opened = await openProject(directory)
  const saved = await saveProject(directory, { ...opened, logic: [], assets: [], entities: opened.entities.map((entity) => ({ ...entity, model_asset_id: null })) }, opened.revision)
  expect(machine((await projectGuide(directory)).findings).map((finding) => `${finding.rule}${finding.stops ? "!" : ""}`)).toEqual(["model_missing!"])
  expect(saved.revision).toBe(project.revision + 1)
})

// ---- 5. .bbmodel ----

test("a creature's model is written as a Blockbench file that passes its structural check", async () => {
  const { built } = await sample()
  const look = built.looks[0]!
  const written = JSON.parse(bbmodelText(look)) as ReturnType<typeof exportBbmodel>
  expect(checkBbmodel(written)).toEqual([])
  expect(written.meta).toEqual({ format_version: "4.10", model_format: "bedrock", box_uv: false })
  const bones = golemDesign.bones
  const cubes = bones.flatMap((bone) => bone.cubes)
  expect(written.elements).toHaveLength(cubes.length)
  const groups = (nodes: unknown[]): { name: string; origin: number[]; children: unknown[] }[] => nodes.flatMap((node) => (typeof node === "string" ? [] : [node as { name: string; origin: number[]; children: unknown[] }, ...groups((node as { children: unknown[] }).children)]))
  expect(groups(written.outliner).map((group) => group.name).sort()).toEqual(bones.map((bone) => bone.name).sort())
  // One root, the rest nested under their parents.
  expect(written.outliner).toHaveLength(1)
  expect(groups(written.outliner).find((group) => group.name === "body")!.children.filter((child) => typeof child !== "string")).toHaveLength(bones.filter((bone) => bone.parent === "body").length)
  // Blockbench keeps X mirrored relative to the .geo.json: sizes are kept, positions and pivots are negated.
  const armPivot = bones.find((bone) => bone.name === "arm_left")!.pivot
  expect(groups(written.outliner).find((group) => group.name === "arm_left")!.origin).toEqual([-armPivot[0]!, armPivot[1]!, armPivot[2]!])
  const torso = written.elements.find((element) => element.name === "torso")!
  expect([torso.from, torso.to]).toEqual([[-5, 10, -3], [5, 20, 3]])
  const fist = written.elements.filter((element) => element.name === "fist").map((element) => element.from[0]).sort((a, b) => a - b)
  expect(fist).toEqual([-9, 5])
  // Per-face UV: six rectangles a cube, each the size of its face and inside the texture; up and down turned half a turn.
  expect(written.resolution).toEqual({ width: 128, height: 128 })
  written.elements.forEach((element) => {
    const size = element.to.map((value, axis) => value - element.from[axis]!)
    expect(Object.keys(element.faces).sort()).toEqual(["down", "east", "north", "south", "up", "west"])
    const north = element.faces.north!.uv
    expect([north[2]! - north[0]!, north[3]! - north[1]!]).toEqual([size[0]!, size[1]!])
    const up = element.faces.up!.uv
    expect([up[0]! - up[2]!, up[1]! - up[3]!]).toEqual([size[0]!, size[2]!])
    Object.values(element.faces).forEach((face) => expect(face.uv.every((value) => value >= 0 && value <= 128)).toBe(true))
  })
  // The texture is the build's own picture, embedded.
  expect(written.textures).toHaveLength(1)
  expect(Buffer.from(written.textures[0]!.source.slice("data:image/png;base64,".length), "base64").equals(Buffer.from(look.png))).toBe(true)
  // Animations: every one of the model's, under the name the mod asks for, with rotation keyframes as written.
  expect(written.animations.map((animation) => animation.name.split(".").at(-1))).toEqual(golemDesign.animations.map((animation) => animation.name))
  expect(written.animations.every((animation) => animation.name.startsWith("animation.creature_"))).toBe(true)
  const walk = written.animations.find((animation) => animation.name.endsWith(".walk"))!
  expect([walk.loop, walk.length]).toEqual(["loop", 1])
  expect(written.animations.find((animation) => animation.name.endsWith(".hurt"))!.loop).toBe("once")
  const legs = Object.values(walk.animators).find((animator) => animator.name === "leg_left")!
  expect(legs.keyframes.map((frame) => [frame.channel, frame.time, frame.data_points[0]])).toEqual([["rotation", 0, { x: 24, y: 0, z: 0 }], ["rotation", 0.5, { x: -24, y: 0, z: 0 }], ["rotation", 1, { x: 24, y: 0, z: 0 }]])
  expect(Object.keys(walk.animators).every((id) => JSON.stringify(written.outliner).includes(id))).toBe(true)
  // Undoing what Blockbench's Bedrock importer does (mirror X back, turn up and down back) gives the build's geometry again, cube for cube.
  const geometry = (look.geometry as { "minecraft:geometry": { bones: { name: string; pivot: number[]; cubes: { origin: number[]; size: number[]; uv: Record<string, { uv: number[]; uv_size: number[] }> }[] }[] }[] })["minecraft:geometry"][0]!
  const restored = written.elements.map((element) => ({
    origin: [-element.to[0] || 0, element.from[1], element.from[2]],
    size: element.to.map((value, axis) => value - element.from[axis]!),
    uv: Object.fromEntries(Object.entries(element.faces).map(([face, value]) => [face, face === "up" || face === "down" ? { uv: [value.uv[2], value.uv[3]], uv_size: [value.uv[0] - value.uv[2], value.uv[1] - value.uv[3]] } : { uv: [value.uv[0], value.uv[1]], uv_size: [value.uv[2] - value.uv[0], value.uv[3] - value.uv[1]] }])),
  }))
  expect(restored).toEqual(geometry.bones.flatMap((bone) => bone.cubes.map((cube) => ({ origin: cube.origin, size: cube.size, uv: cube.uv }))))
  // The same model always gives the same file.
  expect(bbmodelText(look)).toBe(bbmodelText(look))
})

test("the structural check notices a file Blockbench would not show properly", async () => {
  const { built } = await sample()
  const good = () => JSON.parse(bbmodelText(built.looks[0]!)) as ReturnType<typeof exportBbmodel>
  const broken = (change: (model: ReturnType<typeof good>) => void) => {
    const model = good()
    change(model)
    return checkBbmodel(model).join("\n")
  }
  expect(broken((model) => (model.elements[0]!.faces.north!.uv = [120, 120, 140, 130]))).toContain("UV leaves the texture")
  expect(broken((model) => (model.elements[0]!.to = [...model.elements[0]!.from]))).toContain("has no size")
  expect(broken((model) => model.elements.push({ ...model.elements[0]!, uuid: "stray" }))).toContain("is not in exactly one bone")
  expect(broken((model) => (model.textures[0]!.source = "data:image/png;base64,AAAA"))).toContain("not a readable PNG")
  expect(broken((model) => (model.resolution = { width: 64, height: 64 }))).toContain("not the size the file says")
  expect(broken((model) => (Object.values(model.animations[0]!.animators)[0]!.keyframes[1]!.time = 99))).toContain("after the end")
  expect(broken((model) => Object.values(model.animations[0]!.animators)[0]!.keyframes.reverse())).toContain("do not increase")
  expect(broken((model) => (model.animations[0]!.animators = { "no-such-bone": Object.values(model.animations[0]!.animators)[0]! }))).toContain("moves a bone that is not in the model")
  expect(broken((model) => (model.meta.model_format = "free" as "bedrock"))).toContain("model_format")
})

test("a model is exported by any of its creature's ids, or as a workspace model no creature uses", async () => {
  const { directory, project } = await sample()
  const golem = project.entities[0]!
  const byCreature = await projectBbmodel(directory, golem.id)
  expect(byCreature.file).toBe("晶石傀儡.bbmodel")
  expect((await projectBbmodel(directory, golem.model_asset_id!)).text).toBe(byCreature.text)
  expect(checkBbmodel(JSON.parse(byCreature.text))).toEqual([])
  await expect(projectBbmodel(directory, "00000000-0000-4000-8000-00000000dead")).rejects.toThrow("BBMODEL_NO_MODEL")
  // An old project's creature exports too, with the texture asset it is bound to.
  const old = await legacy()
  const oldProject = await openProject(old)
  const exported = JSON.parse((await projectBbmodel(old, oldProject.entities[0]!.id)).text) as ReturnType<typeof exportBbmodel>
  expect(checkBbmodel(exported)).toEqual([])
  expect(bbmodelNames(["晶石傀儡", "晶石傀儡", "a/b:c", "  "])).toEqual(["晶石傀儡.bbmodel", "晶石傀儡-2.bbmodel", "a_b_c.bbmodel", "model.bbmodel"])
})

// ---- words ----

test("the facts are said in the words a player uses, from the numbers given", () => {
  expect(dataWords.generation({ dimension: "overworld", min_y: -16, max_y: 48, spread: "even", vein_size: 6, veins_per_chunk: 2, replaces: ["stone"], biomes: "is_mountain" })).toBe("在主世界 Y −16 到 48 的石头里生成，每个区块约 2 团，每团最多 6 块；只在山地一类的群系里有")
  expect(dataWords.drop({ item: "azure_shard", min: 1, max: 2, fortune: false }, () => "蓝晶碎片")).toBe("挖掉会掉 1–2 个「蓝晶碎片」；用精准采集挖，掉的是它自己")
  expect(dataWords.drop({ item: "azure_shard", min: 3, max: 3, fortune: false }, () => "蓝晶碎片")).toStartWith("挖掉会掉 3 个「蓝晶碎片」")
  expect(dataWords.tier("diamond", "shovel")).toBe("至少要用钻石锹才挖得下来，用更差的工具挖什么都不掉")
  expect(dataWords.experience({ min: 0, max: 0 })).toBe("挖掉不给经验")
  expect(dataWords.creatureSound("hurt", "entity.iron_golem.hurt")).toBe("受伤时是「铁傀儡受伤」的声音")
  expect(dataWords.voice({ pitch: 1, volume: 1 })).toBe("")
  expect(dataWords.voice({ pitch: 1.4, volume: 0.5 })).toBe("声音比原来尖细，比原来小声")
  // The instructions an AI reads list exactly the vocabulary the schema accepts.
  Object.keys(BLOCK_SOUNDS).forEach((key) => expect(MODULES.block.instructions).toContain(key))
  Object.keys(CREATURE_SOUNDS).forEach((id) => expect(MODULES.entity.instructions).toContain(id))
  expect(MODULES.block.instructions).toContain('"generation":{"dimension":"overworld"')
  // Blocks borrow from vanilla; direct sound documents and Studio conversion have separate entry points.
  expect(DATA_CAPABILITY.not_done.join("")).toContain("方块只能借用原版方块的声音")
  expect(DATA_CAPABILITY.not_done.join("")).toContain("直接提交声音文档用单声道 OGG Vorbis")
  expect(DATA_CAPABILITY.not_done.join("")).toContain("文件导入和 Studio 声音工具可转码")
})

// ---- 7. English names ----

test("without an English name both language files are the same as before; with one the English game shows it", async () => {
  const lang = (files: ReturnType<typeof compileContent>, locale: string) => JSON.parse(String(files[`src/main/resources/assets/azure/lang/${locale}.json`])) as Record<string, string>
  const plain = compileContent(content([block()]))
  expect(plain["src/main/resources/assets/azure/lang/en_us.json"]).toBe(plain["src/main/resources/assets/azure/lang/zh_cn.json"]!)
  expect(compileContent(content([block({ name_en: null })], [{ ...item, name_en: null }]))).toEqual(plain)
  const named = compileContent(content([block({ name_en: "Azure Ore" })], [{ ...item, name_en: "Azure Shard" }]))
  expect(lang(named, "zh_cn")).toEqual(lang(plain, "zh_cn"))
  expect(lang(named, "en_us")).toEqual({ "block.azure.azure_ore": "Azure Ore", "item.azure.azure_shard": "Azure Shard" })
  expect(BlockSchema.safeParse(block({ name_en: "蓝晶 Ore" })).error?.issues[0]?.message).toContain("英文名里不能有中文")
  // The sample project names everything in English; its creature and spawn egg follow.
  const { source, project } = await sample()
  const english = (await json(source, `src/main/resources/assets/${project.mod_id}/lang/en_us.json`)) as Record<string, string>
  const chinese = (await json(source, `src/main/resources/assets/${project.mod_id}/lang/zh_cn.json`)) as Record<string, string>
  const golem = `creature_${project.entities[0]!.id.replaceAll("-", "")}`
  expect(english[`entity.${project.mod_id}.${golem}`]).toBe("Crystal Golem")
  expect(english[`item.${project.mod_id}.${golem}_spawn_egg`]).toBe("Crystal Golem Spawn Egg")
  expect(chinese[`item.${project.mod_id}.${golem}_spawn_egg`]).toBe("晶石傀儡刷怪蛋")
  expect(Object.keys(english)).toEqual(Object.keys(chinese))
  expect(Object.values(english).join("")).not.toMatch(/\p{Script=Han}/u)
  // The AI that writes these documents is told to give the English name.
  ;([MODULES.block, MODULES.item, MODULES.entity] as const).forEach((kind) => expect(kind.instructions).toContain("name_en"))
})

test("reconciliation gives one plain reminder for everything still without an English name, and the guide prints it", async () => {
  const { project } = await sample()
  const animations = { [project.entities[0]!.id]: ["idle", "walk", "hurt", "roar"] }
  expect(machine(reconcile(project, { animations }))).toEqual([])
  // A name with no Chinese in it needs no English one.
  const bare = { ...project, items: project.items.map((value) => ({ ...value, name_en: undefined })), entities: project.entities.map((value) => ({ ...value, name_en: null })), blocks: project.blocks.map((value, index) => (index ? value : { ...value, name: "Azurite", name_en: undefined })) }
  const findings = reconcile(bare, { animations })
  expect(findings).toHaveLength(1)
  expect(findings[0]).toMatchObject({ rule: "english_missing", stops: false, about: null, text: "有 2 样东西还没有英文名，英文版游戏里会显示中文：「蓝晶碎片」、「晶石傀儡」。" })
  expect(modGuide(bare, { findings, animations, glowing: [], built: false }).markdown).toContain("有 2 样东西还没有英文名，英文版游戏里会显示中文")
  // Round 19: the sentence tells the person to fill the English name, so it also says where: one target per thing, each the thing's own name_en field.
  expect(findings[0]!.targets).toEqual([
    { about: { kind: "item", id: bare.items[0]!.id, name: "蓝晶碎片" }, field: "name_en", label: "给「蓝晶碎片」填英文名" },
    { about: { kind: "entity", id: bare.entities[0]!.id, name: "晶石傀儡" }, field: "name_en", label: "给「晶石傀儡」填英文名" },
  ])
  // It no longer sends the person to a 「高级」 that has no such field.
  expect(findings[0]!.fix).not.toContain("高级")
  // Gameplay carries its own two languages: English left in Chinese is said, per gameplay.
  const base = sampleProject()
  const NOW = "2026-10-06T08:00:00.000Z"
  const key = Object.keys(BOX_GUARD.lang.en_us)[0]!
  const gameplay = WorkspaceAssetSchema.parse({ id: IDS.box_guard, module: "gameplay", title: BOX_GUARD.name, revision: 1, created_at: NOW, updated_at: NOW, prompt: "守着秘匣的生物", dependencies: BOX_GUARD.uses, document: { ...BOX_GUARD, lang: { ...BOX_GUARD.lang, en_us: BOX_GUARD.lang.zh_cn } }, provenance: { model: null, request_id: null }, status: "ready" })
  const copied = reconcile(ProjectSchema.parse({ ...base, workspace: { assets: [...base.workspace.assets, gameplay] } }), { animations: Object.fromEntries(base.entities.map((entity) => [entity.id, ["idle", "walk", "hurt"]])) })
  expect(copied.find((finding) => finding.rule === "english_text")).toMatchObject({ stops: false, about: { kind: "gameplay", id: IDS.box_guard }, detail: `en_us: ${key}` })
})

test("a mod with an English name of its own is called by it in the English game", async () => {
  const { directory, project } = await sample()
  const root = await temporary()
  await saveProject(directory, { ...project, name_en: "Azure Caverns", description_en: "Azure ore lies underground, guarded by crystal golems." }, project.revision)
  await assembleBuildSource(directory, root, TEMPLATE)
  const english = (await json(root, `src/main/resources/assets/${project.mod_id}/lang/en_us.json`)) as Record<string, string>
  const chinese = (await json(root, `src/main/resources/assets/${project.mod_id}/lang/zh_cn.json`)) as Record<string, string>
  expect(english[`modmenu.nameTranslation.${project.mod_id}`]).toBe("Azure Caverns")
  expect(chinese[`modmenu.nameTranslation.${project.mod_id}`]).toBe("蓝晶矿洞")
  expect(english[`modmenu.descriptionTranslation.${project.mod_id}`]).toStartWith("Azure ore")
  // Without one, nothing of the kind is written.
  const { source } = await sample()
  expect(await text(source, "src/main/resources/assets/azure_sample/lang/en_us.json")).not.toContain("modmenu")
})

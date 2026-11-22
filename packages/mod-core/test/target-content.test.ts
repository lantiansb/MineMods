import { afterEach, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ZodError } from "zod"
import { assembleBuildSource } from "../src/build-source"
import { compileContent } from "../src/content"
import { requirementLines } from "../src/export"
import { resolveProfile } from "../src/fabric/profile"
import { modTomlExtras } from "../src/platform/metadata"
import { scenePlan } from "../src/scene"
import { targetSaid, targetSceneDatapack, targetScenePlan } from "../src/scene-target"
import { targetManifest } from "../src/target/manifests"
import { genTarget } from "../src/platform/target"
import { targetVanillaIssue } from "../src/platform/vanilla-targets"
import { oreModifierFiles } from "../src/platform/worldgen"
import type { TargetId } from "../src/target/ids"
import { createTargetContentSample } from "../script/target-content-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

/**
 * E 组 of the platform layer (平台层-移植清单.md): a project's blocks, items and data beyond the slice — shapes, bounce, launch,
 * experience, movement and fuel of blocks; tools, foods and drinks; lucky caches; ores in worldgen; the project's own sounds;
 * the icon and the release links — generated for Forge 1.20.1 and NeoForge 1.21.1 through the facade, and the whole tree
 * compiled against each target's real class path. The real Gradle builds and dedicated servers are `script/target-content-check.ts`.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const CLASSPATH: Record<TargetId, string> = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" }
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function sample(target: TargetId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-content-"))
  roots.push(root)
  const project = await createTargetContentSample(path.join(root, "琥珀工坊"), target)
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(path.join(root, "琥珀工坊"), source, TEMPLATE)
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
  const read = (name: string) => readFile(path.join(source, name), "utf8")
  return { project, source, built, names, read }
}

const LOADER_API = /^import net\.(minecraftforge|neoforged|fabricmc)\./m

for (const target of ["forge-1.20.1", "neoforge-1.21.1"] as const) {
  const forge = target === "forge-1.20.1"
  const loader = forge ? "forge" : "neoforge"
  test(`${target}: blocks, items, ores, lucky caches and the project's own sounds go through the facade, and the whole tree compiles`, async () => {
    const { built, names, read, source } = await sample(target)
    const pkg = "src/main/java/com/minemods/content_amber_works"
    const data = "src/main/resources/data/amber_works"
    const assets = "src/main/resources/assets/amber_works"
    expect(built.target.manifest.id).toBe(target)
    // Only the facade and the main class name the loader.
    const java = names.filter((name) => name.endsWith(".java"))
    const loaderNamed = (await Promise.all(java.map(async (name) => (LOADER_API.test(await read(name)) ? [name] : [])))).flat()
    expect(loaderNamed.sort()).toEqual([`${pkg}/AmberWorksMod.java`, `${pkg}/platform/StudioClientPlatform.java`, `${pkg}/platform/StudioPlatform.java`])
    // Fabric's own classes are not written for a facade target.
    expect(names).not.toContain(`${pkg}/StudioWorldgen.java`)
    expect(names).not.toContain(`${pkg}/client/StudioBlockClient.java`)
    const registry = await read(`${pkg}/StudioContentRegistry.java`)
    // Experience, bounce and launch, movement, the lucky cache's stack, the tools, foods and drinks, the tabs and the fuels.
    expect(registry).toContain(forge ? "new DropExperienceBlock(BlockBehaviour.Properties.of().strength(3f)" : "new DropExperienceBlock(UniformInt.of(2, 5), BlockBehaviour.Properties.of().strength(3f)")
    expect(registry).toContain("new ShapedBlock_amber_stool(BlockBehaviour.Properties.of().strength(1f).lightLevel(state -> 0).noOcclusion())")
    expect(registry).toContain("public void updateEntityAfterFallOn(BlockGetter world, Entity entity) {")
    expect(registry).toContain("public void stepOn(Level world, BlockPos pos, BlockState state, Entity entity) {")
    expect(registry).toContain(".speedFactor(0.4f).jumpFactor(0.5f)")
    expect(registry).toContain("new Item.Properties().stacksTo(16)")
    expect(registry).toContain(forge ? "new SwordItem(MATERIAL_AMBER_SWORD, 0, -2.4f, new Item.Properties())" : "new SwordItem(MATERIAL_AMBER_SWORD, new Item.Properties().attributes(SwordItem.createAttributes(MATERIAL_AMBER_SWORD, 0, -2.4f)))")
    expect(registry).toContain(forge ? "new AxeItem(MATERIAL_AMBER_AXE, 0f, -3.1f, new Item.Properties())" : "new AxeItem(MATERIAL_AMBER_AXE, new Item.Properties().attributes(AxeItem.createAttributes(MATERIAL_AMBER_AXE, 0f, -3.1f)))")
    expect(registry).toContain(forge ? ".saturationMod(0.3f).alwaysEat()" : ".saturationModifier(0.3f).alwaysEdible()")
    expect(registry).toContain(forge ? "return new net.minecraft.world.item.ItemStack(Items.BOWL);" : ".usingConvertsTo(Items.BOWL)")
    expect(registry).toContain("@Override public UseAnim getUseAnimation(ItemStack stack) { return UseAnim.DRINK; }")
    for (const line of ["StudioPlatform.addToTab(CreativeModeTabs.COMBAT, ITEM_AMBER_SWORD);", "StudioPlatform.addToTab(CreativeModeTabs.TOOLS_AND_UTILITIES, ITEM_AMBER_HOE);", "StudioPlatform.addToTab(CreativeModeTabs.FOOD_AND_DRINKS, ITEM_HONEY_TEA);", "StudioPlatform.fuel(ITEM_AMBER, 800);", "StudioPlatform.fuel(BLOCK_ITEM_PEAT, 2400);", "StudioLuckyCaches.register();", "StudioSounds.register();"])
      expect(registry).toContain(line)
    expect(registry).not.toContain("addToTab(CreativeModeTabs.INGREDIENTS, ITEM_AMBER_SWORD)")
    // The tool material: a mining level on 1.20.1, the blocks it cannot mine on 1.21.1.
    expect(await read(`${pkg}/StudioToolMaterial.java`)).toContain(forge ? "@Override public int getLevel() { return level; }" : "getIncorrectBlocksForDrops")
    // A block with a shape: its class (no codec on 1.20.1), the loader's experience, and holes in its picture by its model.
    const stool = await read(`${pkg}/block/ShapedBlock_amber_stool.java`)
    expect(stool.includes("MapCodec")).toBe(!forge)
    expect(stool).toContain(forge ? "public int getExpDrop(BlockState state, LevelReader level, RandomSource random, BlockPos pos, int fortune, int silkTouch) {" : "public int getExpDrop(BlockState state, LevelAccessor level, BlockPos pos, BlockEntity blockEntity, Entity breaker, ItemStack tool) {")
    expect(stool).not.toContain("spawnAfterBreak")
    expect(JSON.parse(await read(`${assets}/models/block/amber_stool.json`)).render_type).toBe("minecraft:cutout")
    // The lucky cache opens through the facade and reads its block from the supplier.
    const lucky = await read(`${pkg}/StudioLuckyCaches.java`)
    expect(lucky).toContain("StudioPlatform.onUseBlock(StudioLuckyCaches::open);")
    expect(lucky).toContain("state.is(StudioContentRegistry.BLOCK_LUCKY_CRATE.get())")
    expect(lucky.includes("Holder<MobEffect>")).toBe(!forge)
    // Ores: the same two worldgen documents, and the loader's biome modifier; the mountain ore in both tags at once.
    expect(names).toContain(`${data}/worldgen/configured_feature/ore_amber_ore.json`)
    expect(names).toContain(`${data}/worldgen/placed_feature/ore_jade_ore.json`)
    expect(JSON.parse(await read(`${data}/${loader}/biome_modifier/ore_amber_ore.json`))).toEqual({ type: `${loader}:add_features`, biomes: "#minecraft:is_overworld", features: "amber_works:ore_amber_ore", step: "underground_ores" })
    expect(JSON.parse(await read(`${data}/${loader}/biome_modifier/ore_jade_ore.json`)).biomes).toEqual({ type: `${loader}:and`, values: ["#minecraft:is_overworld", "#minecraft:is_mountain"] })
    // The tool kinds' tags and the mining tags in the version's folders.
    expect(names).toContain(`src/main/resources/data/minecraft/tags/${forge ? "items" : "item"}/swords.json`)
    expect(names).toContain(`src/main/resources/data/minecraft/tags/${forge ? "blocks" : "block"}/needs_iron_tool.json`)
    // The project's own sound: registered through the facade, still a SoundEvent, and played by the creature.
    const sounds = await read(`${pkg}/StudioSounds.java`)
    expect(sounds).toContain("public static final SoundEvent SOUND_AMBER_CHIME = register(\"amber_chime\");")
    expect(sounds).toContain("StudioPlatform.register(Registries.SOUND_EVENT, name, () -> event);")
    expect(await read(`${pkg}/entity/StudioCreature.java`)).toContain("StudioSounds.SOUND_AMBER_CHIME")
    expect(JSON.parse(await read(`${assets}/sounds.json`))).toHaveProperty("amber_chime")
    expect(names).toContain(`${assets}/sounds/amber_chime.ogg`)
    expect(built.soundFiles).toContain("com/minemods/content_amber_works/StudioSounds.class")
    // The icon and the release links in the loader's metadata.
    const toml = await read(forge ? "src/main/resources/META-INF/mods.toml" : "src/main/resources/META-INF/neoforge.mods.toml")
    expect(toml).toContain('logoFile = "assets/amber_works/icon.png"')
    expect(toml).toContain('displayURL = "https://example.com/amber-works"')
    expect(toml).toContain('issueTrackerURL = "https://example.com/amber-works/issues"')
    expect(names).toContain(`${assets}/icon.png`)
    if (!hasTargetJavac(CLASSPATH[target])) return
    const compiled = await targetJavac(CLASSPATH[target], path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 300000)
}

test("the same project for Fabric 1.21.1 is Fabric's own text and compiles (Mojang's names)", async () => {
  const { names, read, source } = await sample("fabric-1.21.1")
  const pkg = "src/main/java/com/minemods/content_amber_works"
  expect(names.some((name) => name.includes("/platform/"))).toBe(false)
  expect(names).toContain(`${pkg}/StudioWorldgen.java`)
  expect(names).toContain(`${pkg}/client/StudioBlockClient.java`)
  expect(await read(`${pkg}/StudioSounds.java`)).toContain("Registry.register(BuiltInRegistries.SOUND_EVENT, id, SoundEvent.createVariableRangeEvent(id))")
  expect(JSON.parse(await read("src/main/resources/assets/amber_works/models/block/amber_stool.json"))).not.toHaveProperty("render_type")
  if (!hasTargetJavac(CLASSPATH["fabric-1.21.1"])) return
  const compiled = await targetJavac(CLASSPATH["fabric-1.21.1"], path.join(source, "src", "main", "java"))
  expect(compiled.code).toBe(0)
}, 300000)

test("a vanilla item or tag a facade target does not have is refused for that target in plain words; Fabric 1.21.1 and NeoForge's own have it", () => {
  expect(targetVanillaIssue("minecraft:mace", "forge-1.20.1")).toContain("forge-1.20.1 的 Minecraft 里还没有 minecraft:mace")
  expect(targetVanillaIssue("minecraft:mace", "neoforge-1.21.1")).toBeNull()
  expect(targetVanillaIssue("minecraft:mace", "fabric-1.21.1")).toBeNull()
  expect(targetVanillaIssue("minecraft:iron_ingot", "forge-1.20.1")).toBeNull()
  // 1.20.1's smithing templates are there (the trims came in 1.20); the two of 1.21 are not.
  expect(targetVanillaIssue("minecraft:coast_armor_trim_smithing_template", "forge-1.20.1")).toBeNull()
  expect(targetVanillaIssue("minecraft:flow_armor_trim_smithing_template", "forge-1.20.1")).not.toBeNull()
  expect(targetVanillaIssue("#c:ingots/iron", "forge-1.20.1")).toContain("c: 开头的标签它都没有")
  expect(targetVanillaIssue("#c:ingots/iron", "neoforge-1.21.1")).toBeNull()
  expect(targetVanillaIssue("#minecraft:planks", "forge-1.20.1")).toBeNull()
  expect(targetVanillaIssue("#minecraft:enchantable/sword", "forge-1.20.1")).not.toBeNull()
  const recipe = { id: randomUUID(), name: "锤", pattern: ["minecraft:mace", null, null, null, null, null, null, null, null], result: "minecraft:iron_ingot", count: 1, type: "shapeless" }
  const input = { mod_id: "m", package_name: "a.b", recipes: [recipe] }
  expect(() => compileContent(input, genTarget("forge-1.20.1"))).toThrow(ZodError)
  expect(() => compileContent(input, genTarget("forge-1.20.1"))).toThrow("minecraft:mace")
  expect(() => compileContent(input, genTarget("neoforge-1.21.1"))).not.toThrow()
  expect(() => compileContent(input)).not.toThrow()
})

test("an exported jar says what it needs by its target: Fabric's lines as always, Forge's and NeoForge's from the manifest", () => {
  const fabric = requirementLines({ manifest: targetManifest("fabric-1.21.1"), profile: resolveProfile("fabric-1.21.1") })
  expect(fabric[0]).toMatch(/^Required: Minecraft 1\.21\.1; Java 21; Fabric Loader [\d.]+; Fabric API [^;]+; GeckoLib 4\.8\.3\.$/)
  expect(requirementLines({ manifest: targetManifest("forge-1.20.1"), profile: null })).toEqual([
    "Required: Minecraft 1.20.1; Java 17; Forge 47.4.28; GeckoLib 4.8.4 (geckolib-forge-1.20.1).",
    "Install Forge 47.4.28 for Minecraft 1.20.1 and copy this mod and the GeckoLib JAR into the installation's mods directory.",
  ])
  expect(requirementLines({ manifest: targetManifest("neoforge-1.21.1"), profile: null })[0]).toMatch(/^Required: Minecraft 1\.21\.1; Java 21; NeoForge 21\.1\.\d+; GeckoLib 4\.9\.3 \(geckolib-neoforge-1\.21\.1\)\.$/)
})

test("the test scene of a Forge or NeoForge project: the plan's commands and the world's data pack in the game version's form", () => {
  const plan = scenePlan({ mod_id: "m", entities: [], blocks: [{ identifier: "b", name: "方块" }], items: [{ identifier: "i", name: "物品" }] })
  const shown = (mapped: typeof plan) => mapped.place.map((step) => step.command).find((command) => command.startsWith("summon minecraft:item_display"))!
  expect(shown(targetScenePlan(plan, "1.21.1"))).toContain('item:{id:"m:i",count:1}')
  expect(shown(targetScenePlan(plan, "1.20.1"))).toContain('item:{id:"m:i",Count:1b}')
  expect(targetScenePlan(plan, "1.20.1").place.filter((step) => step.ok).map((step) => step.ok)).toEqual(plan.place.filter((step) => step.ok).map((step) => step.ok))
  for (const version of ["1.20.1", "1.21.1"]) {
    const named = targetScenePlan(plan, version).place.map((step) => step.command).filter((command) => command.startsWith("summon minecraft:text_display"))
    expect(named.length).toBeGreaterThan(0)
    for (const command of named) expect(command).toContain('{alignment:"center",text:')
  }
  expect(plan.place.some((step) => step.command.includes("alignment"))).toBe(false)
  // Forge's and NeoForge's server log names the logger too; the answer is what follows it.
  expect(targetSaid("[15:58:19] [Server thread/INFO] [minecraft/MinecraftServer]: Changed the block at 0, -60, 26")).toBe("Changed the block at 0, -60, 26")
  expect(targetSaid("[15:58:19] [Server thread/INFO]: Changed the block at 0, -60, 26")).toBe("Changed the block at 0, -60, 26")
  expect(Object.keys(targetSceneDatapack("1.21.1"))).toEqual(["pack.mcmeta", "data/minecraft/tags/function/tick.json", "data/minemods_scene/function/tidy.mcfunction"])
  const old = targetSceneDatapack("1.20.1")
  expect(Object.keys(old)).toEqual(["pack.mcmeta", "data/minecraft/tags/functions/tick.json", "data/minemods_scene/functions/tidy.mcfunction"])
  expect(JSON.parse(old["pack.mcmeta"]!).pack.pack_format).toBe(15)
})

test("an ore's biome modifier and the mods.toml extras, as data", () => {
  expect(oreModifierFiles("forge", "forge/biome_modifier", { modId: "m", feature: "ore_x", dimension: "nether", biomeTag: null })).toEqual({
    "src/main/resources/data/m/forge/biome_modifier/ore_x.json": JSON.stringify({ type: "forge:add_features", biomes: "#minecraft:is_nether", features: "m:ore_x", step: "underground_ores" }, null, 2),
  })
  const toml = ['modLoader = "javafml"', 'license = "MIT"', "", "[[mods]]", 'modId = "m"', 'description = "x"', "", "[[dependencies.m]]", 'modId = "forge"', ""].join("\n")
  expect(modTomlExtras(toml, {})).toBe(toml)
  const extended = modTomlExtras(toml, { icon: "assets/m/icon.png", homepage: 'https://a.b/"q"', issues: "https://a.b/i" })
  expect(extended.split("\n")).toEqual(['modLoader = "javafml"', 'license = "MIT"', "", 'issueTrackerURL = "https://a.b/i"', "", "[[mods]]", 'modId = "m"', 'description = "x"', 'logoFile = "assets/m/icon.png"', 'displayURL = "https://a.b/\\"q\\""', "", "[[dependencies.m]]", 'modId = "forge"', ""])
})

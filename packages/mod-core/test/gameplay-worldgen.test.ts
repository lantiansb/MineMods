import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { blockFacets, sourceWays } from "../src/content-facets"
import type { GameplayDocument } from "../src/gameplay"
import { READ_FROM_CODE, checkGameplayReferences, gameplayRecipes, gameplayWorldgen } from "../src/gameplay-references"
import { modGuide } from "../src/guide"
import type { Project } from "../src/project"
import { playFindings } from "../src/reconcile"
import { createDataGameplaySample } from "../script/data-gameplay-sample"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const MOD = "azure_sample"
const PACKAGE = `com.minemods.content_azure_sample.gameplay.highland`

// The three files a gameplay really wrote to plant a flower in forests (field test), with the flower being 蓝晶块 here.
const configured = (block = `${MOD}:azure_block`) => ({ type: "minecraft:random_patch", config: { tries: 8, xz_spread: 6, y_spread: 2, feature: { feature: { type: "minecraft:simple_block", config: { to_place: { type: "minecraft:simple_state_provider", state: { Name: block } } } }, placement: [] } } })
const FILES = {
  configured: { path: `data/${MOD}/worldgen/configured_feature/night_flower_patch.json`, content: JSON.stringify(configured()) },
  placed: { path: `data/${MOD}/worldgen/placed_feature/night_flower_patch.json`, content: JSON.stringify({ feature: `${MOD}:night_flower_patch`, placement: [{ type: "minecraft:rarity_filter", chance: 4 }, { type: "minecraft:in_square" }, { type: "minecraft:heightmap", heightmap: "WORLD_SURFACE" }, { type: "minecraft:biome" }] }) },
}
const main = (hook: string) => ({ path: "Main.java", content: `package ${PACKAGE};\npublic final class Main implements GameplayEntry {\n    public void onInitialize() {\n        ${hook}\n    }\n}\n` })
const HOOK = "BiomeModifications.addFeature(BiomeSelectors.tag(BiomeTags.IS_FOREST), GenerationStep.Decoration.VEGETAL_DECORATION, ResourceKey.create(Registries.PLACED_FEATURE, ProjectContent.id(\"night_flower_patch\")));"

/** The living sample with its one gameplay replaced by `sources` and `data`, and 蓝晶块 left without a recipe of its own. */
async function sample(sources: GameplayDocument["sources"], data: GameplayDocument["data"], change: (project: Project) => Partial<Project> = () => ({})) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-worldgen-"))
  roots.push(root)
  const made = await createDataGameplaySample(path.join(root, "project"), { life: true })
  const uses = [made.blocks.find((block) => block.identifier === "azure_block")!.id]
  const assets = made.workspace.assets.map((asset) => (asset.document.kind === "gameplay" ? { ...asset, title: "夜花", dependencies: uses, document: { ...asset.document, slug: "highland", name: "夜花", uses, sources, data } } : asset))
  const project = { ...made, recipes: [], workspace: { assets }, ...change(made) } as Project
  const gameplay = assets.find((asset) => asset.document.kind === "gameplay")!
  return { project, asset: gameplay, document: gameplay.document as unknown as GameplayDocument, block: project.blocks.find((block) => block.identifier === "azure_block")! }
}
const source = (made: Awaited<ReturnType<typeof sample>>) => blockFacets(made.block, made.project).filter((facet) => facet.question === "source")
const NOT_GENERATED = "不会在世界里生成，没有配方，也没有方块或生物掉它：只能在创造模式物品栏里拿到"
const unreached = (project: Project) => modGuide(project, { findings: [], animations: {}, glowing: [], built: false }).markdown.split("\n").find((line) => line.includes("还走不到的")) ?? ""

test("a block that gameplay worldgen files plant and its code hooks into biomes is a way to come by it, in every place that reads where things come from", async () => {
  const made = await sample([main(HOOK)], [FILES.configured, FILES.placed])
  const { project, asset, document } = made
  expect(checkGameplayReferences(project, document, asset.id)).toEqual([])
  expect(gameplayWorldgen(project, "azure_block")).toEqual([{ id: asset.id, title: "夜花" }])
  expect(gameplayWorldgen(project, "azure_shard")).toEqual([])
  expect(source(made)).toEqual([{ question: "source", answered: true, words: `玩法「夜花」把它加进了世界生成（${READ_FROM_CODE}；在哪些地方、多常见，见那个玩法的说明）`, through: [asset.id] }])
  expect(sourceWays(project, "azure_block").map((way) => [way.way, way.from])).toEqual([["gameplay", [`workspace.assets[${project.workspace.assets.indexOf(asset)}]`]]])
  // The guide, the machine's reconciliation and the playable standard all read that one answer.
  expect(unreached(project)).not.toContain("蓝晶块")
  expect(modGuide(project, { findings: [], animations: {}, glowing: [], built: false }).markdown).toContain("把它加进了世界生成")
  expect(playFindings(project).filter((finding) => finding.about?.name === "蓝晶块")).toEqual([])
})

test("the hook is found however the placed feature's id is written, and the chain is followed by id or inline", async () => {
  const hooked = async (hook: string, extra: string[] = [], data = [FILES.configured, FILES.placed]) => gameplayWorldgen((await sample([{ path: "Main.java", content: `package ${PACKAGE};\npublic final class Main {\n${extra.join("\n")}\n    void init() {\n        ${hook}\n    }\n}\n` }], data)).project, "azure_block").length === 1
  const add = (id: string) => `BiomeModifications.addFeature(BiomeSelectors.foundInOverworld(), GenerationStep.Decoration.VEGETAL_DECORATION, ${id});`
  expect(await hooked(add(`ResourceKey.create(Registries.PLACED_FEATURE, ResourceLocation.fromNamespaceAndPath("${MOD}", "night_flower_patch"))`))).toBe(true)
  expect(await hooked(add(`ResourceKey.create(Registries.PLACED_FEATURE, ResourceLocation.parse("${MOD}:night_flower_patch"))`))).toBe(true)
  expect(await hooked(add(`ResourceKey.create(Registries.PLACED_FEATURE, ResourceLocation.tryParse("${MOD}:night_flower_patch"))`))).toBe(true)
  expect(await hooked(add(`"${MOD}:night_flower_patch"`))).toBe(true)
  // A key held in a field, a name held in a constant: followed once to what they were made from.
  expect(await hooked(add("PATCH"), [`    static final ResourceKey<PlacedFeature> PATCH = ResourceKey.create(Registries.PLACED_FEATURE, ProjectContent.id("night_flower_patch"));`])).toBe(true)
  expect(await hooked(add("ResourceKey.create(Registries.PLACED_FEATURE, ProjectContent.id(NAME))"), [`    static final String NAME = "night_flower_patch";`])).toBe(true)
  // A placed feature that carries the configured one inline, and one that points at a configured feature in a folder.
  const inline = { path: FILES.placed.path, content: JSON.stringify({ feature: configured(), placement: [] }) }
  expect(await hooked(add('ResourceKey.create(Registries.PLACED_FEATURE, ProjectContent.id("night_flower_patch"))'), [], [inline])).toBe(true)
  const nested = [
    { path: `data/${MOD}/worldgen/configured_feature/groves/night.json`, content: FILES.configured.content },
    { path: FILES.placed.path, content: JSON.stringify({ feature: `${MOD}:groves/night`, placement: [] }) },
  ]
  expect(await hooked(add('ResourceKey.create(Registries.PLACED_FEATURE, ProjectContent.id("night_flower_patch"))'), [], nested)).toBe(true)
})

test("a feature file that names the block but that nothing hooks into generation is no source, and says so as before", async () => {
  const rejected = async (sources: GameplayDocument["sources"], data: GameplayDocument["data"]) => {
    const made = await sample(sources, data)
    expect(gameplayWorldgen(made.project, "azure_block")).toEqual([])
    expect(source(made)).toEqual([{ question: "source", answered: false, words: `${NOT_GENERATED}；玩法「夜花」挂在它上面，但 Studio 没能从代码里读出是不是它把这样东西放进世界或交给玩家，要你自己进游戏看` }])
    return made
  }
  // The files without any code that adds them to a biome.
  const files = await rejected([main("")], [FILES.configured, FILES.placed])
  expect(unreached(files.project)).toContain("蓝晶块")
  // The call is in a comment or a string; it hooks another placed feature; it hooks the configured id of a placed feature that does not exist.
  await rejected([main(`// ${HOOK}`)], [FILES.configured, FILES.placed])
  await rejected([main(`String note = "${HOOK.replaceAll('"', "'")}";`)], [FILES.configured, FILES.placed])
  await rejected([main(HOOK.replace("night_flower_patch", "other_patch"))], [FILES.configured, FILES.placed])
  await rejected([main(HOOK)], [FILES.configured])
  // The hooked chain does not reach the block: the file names another block, or the block's name only appears as a part of a longer id or as a key.
  await rejected([main(HOOK)], [{ ...FILES.configured, content: JSON.stringify(configured(`${MOD}:azure_block_slab`)) }, FILES.placed])
  await rejected([main(HOOK)], [{ ...FILES.configured, content: JSON.stringify({ type: "x", note: { [`${MOD}:azure_block`]: 1 } }) }, FILES.placed])
  await rejected([main(HOOK)], [{ ...FILES.configured, content: "{ not json" }, FILES.placed])
  // Something else's placed feature is hooked while this one only sits in the folder.
  await rejected([main(HOOK.replace("night_flower_patch", "unrelated"))], [FILES.configured, FILES.placed, { path: `data/${MOD}/worldgen/placed_feature/unrelated.json`, content: JSON.stringify({ feature: `${MOD}:unrelated`, placement: [] }) }, { path: `data/${MOD}/worldgen/configured_feature/unrelated.json`, content: JSON.stringify(configured(`${MOD}:azure_shard`)) }])
})

test("a gameplay's own recipe may sit in the recipe folder; only the files Studio writes are kept", async () => {
  const scale = { path: `data/${MOD}/recipe/scale_armor.json`, content: JSON.stringify({ type: "minecraft:crafting_shaped", pattern: ["XX"], key: { X: { item: `${MOD}:azure_shard` } }, result: { id: `${MOD}:scale_chestplate`, count: 1 } }) }
  // The sample's own recipe for 蓝晶块 is the file Studio writes.
  const made = await sample([main(`Registry.register(Registries.ITEM, ProjectContent.id("scale_chestplate"), new Item(new Item.Settings()));`)], [scale], (project) => ({ recipes: project.recipes }))
  const studio = made.project.recipes[0]!
  const rules = (data: GameplayDocument["data"]) => checkGameplayReferences(made.project, { ...made.document, data }, made.asset.id)
  expect(rules([scale])).toEqual([])
  // Another name in the same folder, whatever it makes, is the gameplay's own.
  expect(rules([{ ...scale, path: `data/${MOD}/recipe/anything_else.json` }])).toEqual([])
  const taken = rules([{ path: `data/${MOD}/recipe/${studio.id}.json`, content: "{}" }])
  expect(taken.map((finding) => finding.rule)).toEqual(["shadows_generated"])
  expect(taken[0]!.fix).toContain("同一个 recipe 文件夹")
  expect(taken[0]!.fix).toContain("loot_table")
  // Studio's loot tables of its own blocks stay Studio's.
  expect(rules([{ path: `data/${MOD}/loot_table/blocks/azure_block.json`, content: "{}" }]).map((finding) => finding.rule)).toEqual(["shadows_generated"])
})

test("a recipe file the gameplay ships is a source of its result when that is one of the project's things", async () => {
  const shapeless = { path: `data/${MOD}/recipe/azure_from_shards.json`, content: JSON.stringify({ type: "minecraft:crafting_shapeless", ingredients: [{ item: `${MOD}:azure_shard` }, { item: "minecraft:stick" }], result: { id: `${MOD}:azure_block`, count: 1 } }) }
  const made = await sample([main("")], [shapeless])
  expect(gameplayRecipes(made.project, "azure_block")).toEqual([{ id: made.asset.id, title: "夜花", path: shapeless.path, through: ["azure_shard"] }])
  expect(source(made)).toEqual([{ question: "source", answered: true, words: expect.stringContaining(`玩法「夜花」自带一个配方能做出它（数据文件 ${shapeless.path}`), detail: `gameplay recipe ${shapeless.path}`, through: ["azure_shard", made.asset.id] }])
  expect(unreached(made.project)).not.toContain("蓝晶块")
  // A recipe for a thing the gameplay registers itself is not one of the project's things: nothing to read, nothing broken.
  const armour = { path: `data/${MOD}/recipe/scale_armor.json`, content: JSON.stringify({ type: "minecraft:crafting_shaped", pattern: ["XX"], key: { X: { item: "minecraft:stick" } }, result: { id: `${MOD}:scale_chestplate` } }) }
  const own = await sample([main("")], [armour, { path: `data/${MOD}/recipe/broken.json`, content: "[" }, { path: `data/${MOD}/recipe/bare.json`, content: JSON.stringify({ result: `${MOD}:azure_shard` }) }])
  expect(gameplayRecipes(own.project, "azure_block")).toEqual([])
  expect(gameplayRecipes(own.project, "scale_chestplate")).toEqual([{ id: own.asset.id, title: "夜花", path: armour.path, through: [] }])
  expect(gameplayRecipes(own.project, "azure_shard").map((value) => value.path)).toEqual([`data/${MOD}/recipe/bare.json`])
  expect(source(own)).toEqual([{ question: "source", answered: false, words: `${NOT_GENERATED}；玩法「夜花」挂在它上面，但 Studio 没能从代码里读出是不是它把这样东西放进世界或交给玩家，要你自己进游戏看` }])
})

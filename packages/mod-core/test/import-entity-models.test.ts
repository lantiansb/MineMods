import { expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { buildEntityModels, findEntityIds, type EntityAsset, type GameSource } from "../src/import-entity-models"
import { readClassCode, readJavaModels, type ClassCode } from "../src/imported-java-model"

// Compiled from test/fixtures/java-models/src (see build.sh there): small stand-ins for the game's
// model classes under three naming schemes, and one mod written against each.
const classes = path.join(import.meta.dir, "fixtures/java-models/classes")
const walk = (directory: string, prefix = ""): string[] =>
  readdirSync(directory).flatMap((name) =>
    statSync(path.join(directory, name)).isDirectory() ? walk(path.join(directory, name), `${prefix}${name}/`) : [`${prefix}${name}`],
  )
const source = (...folders: string[]) => {
  const files = new Map<string, string>()
  folders.forEach((folder) => walk(path.join(classes, folder)).forEach((file) => files.set(file, path.join(classes, folder, file))))
  return { paths: [...files.keys()], readFile: async (file: string) => new Uint8Array(readFileSync(files.get(file)!)) }
}
const lookupIn = (...folders: string[]) => {
  const cache = new Map<string, ClassCode | null>()
  return (name: string) => {
    if (!cache.has(name)) {
      const folder = folders.find((candidate) => existsSync(path.join(classes, candidate, `${name}.class`)))
      cache.set(name, folder ? readClassCode(readFileSync(path.join(classes, folder, `${name}.class`))) : null)
    }
    return cache.get(name) ?? null
  }
}
const bones = (lookup: ReturnType<typeof lookupIn>, name: string) => {
  const [model] = readJavaModels(lookup(name)!, lookup)
  return { model: model!, bones: model!.geometry["minecraft:geometry"][0]!.bones, description: model!.geometry["minecraft:geometry"][0]!.description }
}
// A 1×1 PNG header is enough for the size check; these tests never decode pixels.
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x89504e47)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
const project = () => {
  const assets: EntityAsset[] = []
  const files = new Map<string, Uint8Array>()
  return {
    assets,
    add(resourcePath: string, content: string | Uint8Array = "") {
      const id = String(assets.length + 1).padStart(64, "0")
      assets.push({
        id,
        resourcePath,
        kind: resourcePath.endsWith(".png") ? "texture" : resourcePath.endsWith(".geo.json") ? "model" : "data",
        format: resourcePath.split(".").pop()!,
      })
      files.set(id, typeof content === "string" ? new TextEncoder().encode(content) : content)
      return id
    },
    readAsset: async (id: string) => files.get(id)!,
  }
}

test("layer model with Mojang names: children, rotation, mirror, helper method and a loop that names parts", () => {
  const { model, bones: parts, description } = bones(lookupIn("mod-mojmap"), "fixturemod/client/CrystalDeerModel")
  expect(model.partial).toBe(false)
  expect(description).toMatchObject({ texture_width: 64, texture_height: 48 })
  expect(parts.map((bone) => bone.name)).toEqual(["body", "head", "left_antler", "leg_0", "leg_1", "leg_2", "leg_3"])
  expect(parts[1]).toMatchObject({ parent: "body", pivot: [0, 18, -8], rotation: [30, 0, 0] })
  expect(parts[1]!.cubes[0]).toEqual({ origin: [-2, 18, -12], size: [4, 6, 6], uv: [0, 0], inflate: 0.25 })
  expect(parts[2]).toMatchObject({ parent: "head", rotation: [0, 0, 20] })
  expect(parts[2]!.cubes[0]).toMatchObject({ mirror: true, uv: [40, 0] })
  expect(parts[4]).toMatchObject({ name: "leg_1", pivot: [2, 10, -6] })
})

test("layer model with Fabric intermediary names is read by call shape, not by class name", () => {
  const { model, bones: parts, description } = bones(lookupIn("mod-fabric"), "fabricmod/client/EmberFoxModel")
  expect(model.partial).toBe(false)
  expect(description).toMatchObject({ texture_width: 48, texture_height: 32 })
  expect(parts.map((bone) => [bone.name, bone.parent ?? null])).toEqual([["body", null], ["tail", "body"], ["head", null]])
  expect(parts[0]).toMatchObject({ pivot: [0, 8, -6], rotation: [90, 0, 0] })
  expect(parts[2]!.cubes[0]).toMatchObject({ uv: [1, 5], inflate: 0.5 })
  expect(parts[1]!.cubes[0]).toMatchObject({ mirror: true })
})

test("a base mesh from the game is replayed from the game's files when present, else a built-in stand-in", () => {
  const without = bones(lookupIn("mod-mojmap"), "fixturemod/client/SwampWalkerModel")
  expect(without.bones.map((bone) => bone.name)).toContain("right_leg")
  const withGame = bones(lookupIn("mod-mojmap", "game-vanilla"), "fixturemod/client/SwampWalkerModel")
  expect(withGame.bones.map((bone) => bone.name)).toEqual(["head", "body", "tail_from_game_files", "hat"])
  expect(withGame.model.partial).toBe(false)
})

test("pre-1.17 part models: constructor, child parts, a rotation helper, and int-sized boxes", () => {
  const owl = bones(lookupIn("mod-legacy"), "legacymod/client/SnowOwlModel")
  expect(owl.description).toMatchObject({ texture_width: 64, texture_height: 64 })
  expect(owl.bones.map((bone) => [bone.name, bone.parent ?? null])).toEqual([["body", null], ["head", "body"], ["leftWing", "body"]])
  expect(owl.bones[2]).toMatchObject({ pivot: [3, 9, 0], rotation: [0, 0, -15] })
  expect(owl.bones[2]!.cubes[0]).toMatchObject({ mirror: true, uv: [24, 10] })
  expect(owl.bones[1]!.cubes[0]).toMatchObject({ uv: [0, 0], size: [5, 5, 5] })
  const golem = bones(lookupIn("mod-legacy"), "legacymod/client/ModelMossGolem")
  expect(golem.description).toMatchObject({ texture_width: 128, texture_height: 64 })
  expect(golem.bones[1]).toMatchObject({ name: "arm", parent: "torso", rotation: [0, 0, -10] })
  expect(golem.bones[1]!.cubes[0]).toMatchObject({ size: [4, 14, 4], inflate: 0.5 })
})

test("creature ids come from language files, drop tables and spawn eggs", () => {
  const assets: EntityAsset[] = [
    { id: "a", resourcePath: "data/somemod/loot_tables/entities/bog_frog.json", kind: "data", format: "json" },
    { id: "b", resourcePath: "data/newmod/loot_table/entities/ice_crab.json", kind: "data", format: "json" },
    { id: "c", resourcePath: "assets/somemod/models/item/sun_moth_spawn_egg.json", kind: "model", format: "json" },
  ]
  const languages = new Map([
    ["assets/somemod/lang/en_us.json", JSON.stringify({ "entity.somemod.cave_bat": "Cave Bat", "entity.minecraft.villager.farmer": "x", "item.somemod.gem": "Gem" })],
    ["assets/oldmod/lang/en_us.lang", "entity.oldmod.StoneGolem.name=Stone Golem\nitem.thing.name=Thing\n"],
  ])
  expect(findEntityIds(assets, languages)).toEqual([
    "newmod:ice_crab",
    "oldmod:stone_golem",
    "somemod:bog_frog",
    "somemod:cave_bat",
    "somemod:sun_moth",
  ])
})

test("NeoForge-style mod: registration is followed to the layer method and the renderer's texture", async () => {
  const files = project()
  files.add(
    "assets/fixturemod/lang/en_us.json",
    JSON.stringify({ "entity.fixturemod.crystal_deer": "Crystal Deer", "entity.fixturemod.pack_wolf": "Pack Wolf", "entity.fixturemod.swamp_walker": "Swamp Walker" }),
  )
  const deerTexture = files.add("assets/fixturemod/textures/entity/deer/crystal.png", png(64, 48))
  const walkerTexture = files.add("assets/fixturemod/textures/entity/swamp_walker.png", png(64, 64))
  files.add("data/fixturemod/loot_tables/entities/crystal_deer.json", "{}")
  const result = await buildEntityModels({ assets: files.assets, readAsset: files.readAsset, classes: source("mod-mojmap") })
  const [deer, wolf, walker] = result
  expect(deer).toMatchObject({
    entity: "fixturemod:crystal_deer",
    kind: "java",
    via: "registration",
    source: "fixturemod/client/CrystalDeerModel.createBodyLayer",
    texture: { assetId: deerTexture },
    creature: true,
  })
  // The wolf reuses a model of the game itself; without the game's files there is nothing to draw.
  expect(wolf).toMatchObject({ entity: "fixturemod:pack_wolf", kind: "none", creature: false })
  expect(wolf!.diagnostics[0]).toContain("原版游戏")
  // The walker's renderer is an anonymous class with no texture name: the file named after the creature is used.
  expect(walker).toMatchObject({ kind: "java", source: "fixturemod/client/SwampWalkerModel.create", texture: { assetId: walkerTexture } })
})

test("with the game's files, a creature that reuses a game model gets that model and texture", async () => {
  const files = project()
  files.add("assets/fixturemod/lang/en_us.json", JSON.stringify({ "entity.fixturemod.pack_wolf": "Pack Wolf" }))
  const gameClasses = source("game-mojmap", "game-vanilla")
  const known = new Set(gameClasses.paths)
  const game: GameSource = {
    classPaths: gameClasses.paths,
    hasClass: (file) => known.has(file),
    has: (file) => file === "assets/minecraft/textures/entity/wolf/wolf.png",
    readFile: async (file) => (file.endsWith(".png") ? png(64, 32) : gameClasses.readFile(file)),
  }
  const [wolf] = await buildEntityModels({ assets: files.assets, readAsset: files.readAsset, classes: source("mod-mojmap"), game })
  expect(wolf).toMatchObject({ kind: "java", via: "registration", texture: { game: "assets/minecraft/textures/entity/wolf/wolf.png" } })
  expect(wolf!.geometry!["minecraft:geometry"][0]!.bones.map((bone) => bone.name)).toEqual(["head", "body"])
})

test("Fabric-style mod: intermediary names, a field assigned in a method, and a GeckoLib model file", async () => {
  const files = project()
  files.add("assets/fabricmod/lang/en_us.json", JSON.stringify({ "entity.fabricmod.ember_fox": "Ember Fox" }))
  files.add("data/fabricmod/loot_tables/entities/ash_beetle.json", "{}")
  const foxTexture = files.add("assets/fabricmod/textures/entity/ember_fox.png", png(48, 32))
  const beetleModel = files.add("assets/fabricmod/geo/ash_beetle.geo.json", "{}")
  const beetleTexture = files.add("assets/fabricmod/textures/entity/ash_beetle.png", png(32, 32))
  const [beetle, fox] = await buildEntityModels({ assets: files.assets, readAsset: files.readAsset, classes: source("mod-fabric") })
  expect(fox).toMatchObject({
    entity: "fabricmod:ember_fox",
    kind: "java",
    via: "registration",
    source: "fabricmod/client/EmberFoxModel.getTexturedModelData",
    texture: { assetId: foxTexture },
  })
  expect(beetle).toMatchObject({ entity: "fabricmod:ash_beetle", kind: "asset", modelAssetId: beetleModel, texture: { assetId: beetleTexture }, creature: true })
})

test("old Forge mod: a method-reference registration, and a creature matched to its classes by name", async () => {
  const files = project()
  files.add("assets/legacymod/lang/en_us.lang", "entity.legacymod.SnowOwl.name=Snow Owl\nentity.MossGolem.name=Moss Golem\n")
  files.add("assets/legacymod/textures/entity/snow_owl.png", png(64, 64))
  files.add("assets/legacymod/textures/entity/moss_golem.png", png(128, 64))
  const [golem, owl] = await buildEntityModels({ assets: files.assets, readAsset: files.readAsset, classes: source("mod-legacy") })
  expect(owl).toMatchObject({ entity: "legacymod:snow_owl", kind: "java", via: "registration", source: "legacymod/client/SnowOwlModel.<init>" })
  expect(golem).toMatchObject({ entity: "legacymod:moss_golem", kind: "java", via: "name", source: "legacymod/client/ModelMossGolem.<init>" })
})

test("a mod without code still lists its creatures and uses model files when it has them", async () => {
  const files = project()
  files.add("assets/datamod/lang/en_us.json", JSON.stringify({ "entity.datamod.reef_ray": "Reef Ray", "entity.datamod.mystery": "Mystery" }))
  const model = files.add("assets/datamod/geo/entity/reef_ray.geo.json", "{}")
  const result = await buildEntityModels({ assets: files.assets, readAsset: files.readAsset, classes: null })
  expect(result.map((entry) => [entry.entity, entry.kind])).toEqual([["datamod:mystery", "none"], ["datamod:reef_ray", "asset"]])
  expect(result[1]).toMatchObject({ modelAssetId: model, via: "files" })
  expect(result[0]!.diagnostics[0]).toContain("没有可以读取的模组代码")
})

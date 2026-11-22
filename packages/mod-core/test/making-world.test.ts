import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { unzipSync, zipSync } from "fflate"
import { findSceneJar, findWorldJar, readWorldArt, SITS_IN, TOOL_TAGS, WORLD_LIMITS, WORLD_SPREAD, worldNeighbours, worldSource } from "../src/making-world"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolveProfile } from "../src/fabric/profile"
import { scenePaths } from "../src/scene-run"
import { decodeRgbaPng } from "../src/png-decode"
import { encodePng } from "../src/png"

// The machine's own copy of the game, when there is one (`java-tree.ts`): only numbers about it are asserted, and the test is skipped without it.
import { HAS_GAME_DATA, MINECRAFT_JARS } from "./java-tree"
import { runDrawing } from "../src/script-run"
import { SCRIPT_ERRORS } from "@minemods/studio-ai/script"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

// A stand-in for the game jar, made of arithmetic: the names are the game's, not one pixel is.
const grain = (seed: number, tones: number[][], side = 16) => encodePng(Uint8Array.from({ length: side * side * 4 }, (_, index) => (index % 4 === 3 ? 255 : tones[((Math.floor(index / 4) % side) * 7 + Math.floor(index / 4 / side) * 13 + ((Math.floor(index / 4) + seed) % 5)) % tones.length]![index % 4]!)), side, side)
const GREY = [[104, 104, 104], [116, 116, 116], [127, 127, 127], [143, 143, 143]]
const DARK = [[60, 60, 66], [72, 72, 78], [84, 84, 90]]
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const tag = (...names: string[]) => text({ values: names.map((name) => `minecraft:${name}`) })
const JAR = {
  "assets/minecraft/textures/block/stone.png": grain(1, GREY),
  "assets/minecraft/textures/block/deepslate.png": grain(2, DARK),
  "assets/minecraft/textures/block/iron_ore.png": grain(3, [...GREY, [216, 175, 147]]),
  "assets/minecraft/textures/block/gold_ore.png": grain(4, [...GREY, [250, 210, 70]]),
  "assets/minecraft/textures/block/deepslate_iron_ore.png": grain(5, [...DARK, [216, 175, 147]]),
  "assets/minecraft/textures/block/dirt.png": grain(6, [[134, 96, 67], [121, 85, 58], [150, 108, 74]]),
  "assets/minecraft/textures/block/oak_planks.png": grain(7, [[162, 130, 78], [184, 148, 95], [150, 120, 70]]),
  "assets/minecraft/textures/block/sand.png": grain(8, [[219, 207, 163], [226, 215, 172], [209, 196, 150]]),
  // A strip of frames and a large picture are not what the game shows as one face: left out.
  "assets/minecraft/textures/block/lava_still.png": encodePng(new Uint8Array(16 * 32 * 4).fill(200), 16, 32),
  "assets/minecraft/textures/block/huge.png": grain(9, GREY, 64),
  "assets/minecraft/textures/item/iron_sword.png": grain(10, GREY),
  "assets/minecraft/textures/item/diamond_sword.png": grain(11, [[40, 200, 210], [20, 120, 130]]),
  "assets/minecraft/textures/item/iron_ingot.png": grain(12, GREY),
  "assets/minecraft/textures/item/iron_pickaxe.png": grain(13, GREY),
  "assets/minecraft/textures/item/coal.png": grain(14, DARK),
  "data/minecraft/tags/block/iron_ores.json": tag("iron_ore", "deepslate_iron_ore"),
  "data/minecraft/tags/block/gold_ores.json": tag("gold_ore", "deepslate_gold_ore"),
  "data/minecraft/tags/block/base_stone_overworld.json": tag("stone", "deepslate"),
  "data/minecraft/tags/block/dirt.json": tag("grass_block", "dirt"),
  "data/minecraft/tags/block/planks.json": tag("oak_planks"),
  "data/minecraft/tags/block/sand.json": tag("sand"),
  "data/minecraft/tags/item/swords.json": tag("diamond_sword", "iron_sword"),
  "data/minecraft/tags/item/beacon_payment_items.json": tag("netherite_ingot", "iron_ingot"),
  "data/minecraft/tags/item/pickaxes.json": tag("iron_pickaxe"),
  "data/minecraft/tags/item/coals.json": tag("coal"),
  "net/minecraft/Something.class": new Uint8Array(64),
}

async function home(files: Record<string, Uint8Array> | null) {
  const root = await mkdtemp(path.join(os.tmpdir(), "making-world-"))
  directories.push(root)
  if (!files) return root
  const folder = path.join(root, "caches", "fabric-loom", "minecraftMaven", "net", "minecraft", "minecraft-merged-abc", "1.21.1-yarn")
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, "minecraft-merged-abc-1.21.1-yarn.jar"), zipSync(files))
  // Neither a sources jar nor a jar without the game's pictures is taken for it.
  await writeFile(path.join(folder, "minecraft-merged-abc-1.21.1-yarn-sources.jar"), zipSync({ "a.java": new Uint8Array(1) }))
  await mkdir(path.join(root, "caches", "fabric-loom", "1.21.1"), { recursive: true })
  await writeFile(path.join(root, "caches", "fabric-loom", "1.21.1", "minecraft-server.jar"), zipSync({ "data/x.json": new Uint8Array(1) }))
  return root
}

test("原版的图只从 Studio 自己构建目录里的游戏文件读，读进内存；没有就是没有", async () => {
  const empty = await home(null)
  expect(await findWorldJar(empty)).toBeNull()
  expect(await worldSource(empty)()).toBeNull()

  const root = await home(JAR)
  const jar = await findWorldJar(root)
  expect(path.basename(jar!)).toBe("minecraft-merged-abc-1.21.1-yarn.jar")
  const art = (await readWorldArt(jar!))!
  expect([...art.pictures.block.keys()].sort()).toEqual(["deepslate", "deepslate_iron_ore", "dirt", "gold_ore", "iron_ore", "oak_planks", "sand", "stone"])
  expect(art.pictures.block.get("stone")).toMatchObject({ name: "stone", url: expect.stringMatching(/^data:image\/png;base64,/), image: { width: 16, height: 16 } })
  expect(art.tags.item.get("swords")).toEqual(["diamond_sword", "iron_sword"])
  expect(WORLD_LIMITS.side).toBeLessThan(64)
  // Reading left the folder exactly as it was: nothing is unpacked or cached on disk.
  const before = (await readdir(root, { recursive: true })).sort()
  const source = worldSource(root)
  expect(await source()).toBe(await source())
  expect((await readdir(root, { recursive: true })).sort()).toEqual(before)
  // A game that arrives later (the first build) is found at the next ask.
  const late = await home(null)
  const later = worldSource(late)
  expect(await later()).toBeNull()
  await mkdir(path.join(late, "caches", "fabric-loom", "1.21.1"), { recursive: true })
  await writeFile(path.join(late, "caches", "fabric-loom", "1.21.1", "minecraft-client.jar"), zipSync(JAR))
  expect((await later())?.pictures.block.has("stone")).toBe(true)
})

test("还没有构建过的电脑上，测试场自己下载的游戏本体也能读原版的图：只认校验对得上的那一个文件，只读不写", async () => {
  const gradle = await home(null)
  const runtime = await mkdtemp(path.join(os.tmpdir(), "making-world-runtime-"))
  directories.push(runtime)
  const profile = resolveProfile("fabric-1.21.1")
  // Where the test scene keeps it is the scene's own word, not a second copy of the path.
  const jar = path.join(scenePaths(runtime, "none").clientLibraries, `minecraft-client-${profile.minecraft}.jar`)
  expect(jar).toBe(path.join(runtime, "scene", "fabric-1.21.1", "client-libs", "minecraft-client-1.21.1.jar"))
  const bytes = zipSync(JAR)
  const sha1 = createHash("sha1").update(bytes).digest("hex")
  // Nothing there yet, and without the runtime folder the source never looks outside the Gradle home.
  expect(await findSceneJar(runtime, sha1)).toBeNull()
  const source = worldSource(gradle, runtime, sha1)
  expect(await source()).toBeNull()
  await mkdir(path.dirname(jar), { recursive: true })
  await writeFile(jar, bytes)
  // Other jars beside it (the game's libraries) are never taken for the game.
  await writeFile(path.join(path.dirname(jar), "minecraft-other.jar"), zipSync(JAR))
  expect(await worldSource(gradle)()).toBeNull()
  // A file that is not the game's client by its checksum is not read: the default is the profile's own SHA-1, which no stand-in has.
  expect(await findSceneJar(runtime)).toBeNull()
  expect(await worldSource(gradle, runtime)()).toBeNull()
  expect(await findSceneJar(runtime, sha1)).toBe(jar)
  const before = (await readdir(runtime, { recursive: true })).sort()
  // The same source finds it at the next ask, once the scene has been opened.
  const art = (await source())!
  expect(art.pictures.block.get("stone")).toMatchObject({ name: "stone", image: { width: 16, height: 16 } })
  expect(art.tags.item.get("swords")).toEqual(["diamond_sword", "iron_sword"])
  expect(await source()).toBe(art)
  expect((await readdir(runtime, { recursive: true })).sort()).toEqual(before)
  expect((await readdir(gradle, { recursive: true })).length).toBe(0)
  // The game a build brought is preferred once there is one.
  const built = await home(JAR)
  expect(path.basename((await findWorldJar(built))!)).toBe("minecraft-merged-abc-1.21.1-yarn.jar")
  expect((await worldSource(built, runtime, sha1)())?.pictures.block.has("stone")).toBe(true)
})

test("放在旁边的是按它自己的说明挑的：长在哪种石头里就嵌在哪种石头里，是什么工具就和那一类放在一起，别的按游戏自己的大类各取一样", async () => {
  const art = (await readWorldArt((await findWorldJar(await home(JAR)))!))!
  const names = (found: { inside: { name: string } | null; beside: { name: string }[] }) => ({ inside: found.inside?.name ?? null, beside: found.beside.map((value) => value.name) })
  // In stone: the stone, and the game's own things that sit in stone (read off their pictures, not their names).
  expect(names(worldNeighbours(art, { kind: "block", generation: { replaces: ["stone"] } }))).toEqual({ inside: "stone", beside: ["stone", "gold_ore", "iron_ore"] })
  expect(names(worldNeighbours(art, { kind: "block", generation: { replaces: ["deepslate", "stone"] } }))).toEqual({ inside: "deepslate", beside: ["deepslate", "deepslate_iron_ore"] })
  // The rock is also known by the person's word for it; the game's other pictures only by the game's names.
  expect(worldNeighbours(art, { kind: "block", generation: { replaces: ["stone"] } }).beside.map((value) => value.label)).toEqual(["石头", undefined, undefined])
  expect(SITS_IN).toBe(0.5)
  // No context of its own: one member of each broad tag that has a picture; a member without one is passed over.
  expect(names(worldNeighbours(art, { kind: "block", generation: null }))).toEqual({ inside: null, beside: ["stone", "dirt", "oak_planks", "sand"] })
  expect(names(worldNeighbours(art, { kind: "block" }))).toEqual({ inside: null, beside: ["stone", "dirt", "oak_planks", "sand"] })
  expect(names(worldNeighbours(art, { kind: "item", tool: { kind: "sword" } }))).toEqual({ inside: null, beside: ["diamond_sword", "iron_sword"] })
  expect(names(worldNeighbours(art, { kind: "item", tool: null }))).toEqual({ inside: null, beside: ["iron_ingot", "diamond_sword", "iron_pickaxe", "coal"] })
  // The tags are the game's own broad ones; none names a subject a person might ask for.
  expect(WORLD_SPREAD.block).toEqual(["base_stone_overworld", "dirt", "planks", "sand", "stone_bricks", "terracotta"])
})

test("方块和物品的图可以用脚本画：交回一张画布就是那张图，透明的留着透明", async () => {
  const icon = await runDrawing(`const c = api.canvas(16, 16, null)\nfor (let i = 2; i < 14; i++) c.set(i, 15 - i, i > 8 ? "#a8f0ff" : "#3a8fd0")\nc.rect(0, 14, 2, 2, "#4a3520")\napi.note("一条斜线")\nreturn c`)
  if (!icon.ok) throw new Error(icon.error)
  expect(icon.summary).toEqual({ kind: "picture", width: 16, height: 16, colours: 3, empty: 240 })
  expect(icon.notes).toEqual(["一条斜线"])
  const read = decodeRgbaPng(Uint8Array.from(atob(icon.texture.split(",")[1]!), (letter) => letter.charCodeAt(0)))
  expect([read.width, read.height, read.pixels[3], [...read.pixels.subarray((13 * 16 + 2) * 4, (13 * 16 + 2) * 4 + 4)]]).toEqual([16, 16, 0, [0x3a, 0x8f, 0xd0, 255]])
  // The same script draws the same picture: the version handed in is the version that was looked at.
  expect(await runDrawing(`const c = api.canvas(16, 16, "#777777")\nc.noise(0, 0, 16, 16, ["#686868", "#747474", "#7f7f7f", "#8f8f8f"], { seed: 3, cell: 2 })\nreturn c`)).toEqual(await runDrawing(`const c = api.canvas(16, 16, "#777777")\nc.noise(0, 0, 16, 16, ["#686868", "#747474", "#7f7f7f", "#8f8f8f"], { seed: 3, cell: 2 })\nreturn c`))
  // Anything but a canvas is said in plain words; a model's own texture still may not have holes.
  expect(await runDrawing(`return api.model({ name: "x" }).document()`)).toMatchObject({ ok: false })
  expect(await runDrawing(`return { kind: "texture", width: 1, height: 1, palette: ["#000000"], pixels: [0] }`)).toEqual({ ok: false, error: SCRIPT_ERRORS.not_a_picture("texture 文档"), line: null })
  expect(await runDrawing(`return api.canvas(4, 4, null).texture()`)).toMatchObject({ ok: false, error: expect.stringContaining("穿在模型上的贴图不能有透明") })
})

// ---- J2 (round 10): what a measure is held against is the broad family, not the few put beside the thing ----

test("量的范围取自同一大类：工具是所有拿在手里用的，长在岩石里的是所有岩石和矿石，各自和自己的岩石比", async () => {
  const art = (await readWorldArt((await findWorldJar(await home(JAR)))!))!
  const family = (document: Parameters<typeof worldNeighbours>[1]) => ((found) => ({ label: found.label, names: found.pictures.map((picture) => picture.name) }))(worldNeighbours(art, document).family)
  // A sword is put beside the swords, and measured against every tool and weapon the game has a picture of.
  expect(family({ kind: "item", tool: { kind: "sword" } })).toEqual({ label: "原版里所有拿在手里用的工具和武器的图标", names: ["diamond_sword", "iron_sword", "iron_pickaxe"] })
  expect(TOOL_TAGS).toEqual(["swords", "pickaxes", "axes", "shovels", "hoes"])
  expect(family({ kind: "item", tool: null }).names).toEqual(["iron_ingot", "diamond_sword", "iron_sword", "iron_pickaxe", "coal"])
  // In stone: every rock a block may generate in, then every ore in whichever of them most of its picture is.
  const rocky = worldNeighbours(art, { kind: "block", generation: { replaces: ["stone"] } }).family
  expect(rocky.pictures.map((picture) => picture.name)).toEqual(["stone", "deepslate", "deepslate_iron_ore", "gold_ore", "iron_ore"])
  expect(rocky.pictures.map((picture) => (picture.inside ? art.pictures.block.get("deepslate")!.image === picture.inside : null))).toEqual([null, null, true, false, false])
  // No context of its own: every member of the broad tags the spread takes one each of.
  expect(family({ kind: "block" }).names).toEqual(["stone", "deepslate", "dirt", "oak_planks", "sand"])
  expect(WORLD_LIMITS.family).toBe(48)
})

test.skipIf(!HAS_GAME_DATA)("游戏本体在的时候：工具这一大类是 30 张，岩石和矿石是 21 张", async () => {
  // The class path has the game in two halves (pictures in the client's, tags in the common one); Studio's own build keeps it whole, as one jar.
  const whole = Object.assign({}, ...MINECRAFT_JARS.map((jar) => unzipSync(new Uint8Array(readFileSync(jar)), { filter: (file) => /^(?:assets\/minecraft\/textures\/(?:block|item)|data\/minecraft\/tags\/(?:block|item))\//.test(file.name) })))
  const root = await mkdtemp(path.join(os.tmpdir(), "making-world-game-"))
  directories.push(root)
  const game = path.join(root, "minecraft-merged-1.21.1.jar")
  await writeFile(game, zipSync(whole))
  const art = (await readWorldArt(game))!
  expect(worldNeighbours(art, { kind: "item", tool: { kind: "pickaxe" } }).family.pictures).toHaveLength(30)
  expect(worldNeighbours(art, { kind: "item", tool: { kind: "pickaxe" } }).beside.map((picture) => picture.name).every((name) => name.endsWith("_pickaxe"))).toBe(true)
  const rocky = worldNeighbours(art, { kind: "block", generation: { replaces: ["stone"] } }).family.pictures
  expect(rocky).toHaveLength(21)
  expect(rocky.filter((picture) => picture.inside).length).toBe(17)
})

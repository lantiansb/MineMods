import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import { resolveProfile } from "../src/fabric/profile"
import { FLIGHT_LIMITS, turnRadius } from "../src/flight-words"
import { SCENE, SCENE_DATAPACK, SCENE_PEN, SCENE_EXTRA, SCENE_RIDER_TAG, SCENE_MARK, SCENE_READY, SCENE_WORDS, creatureEntry, creatureSize, flightRoam, mavenPath, penRadius, roamOf, sceneClientArgs, sceneClientLibraries, sceneLines, sceneLoaderLibraries, sceneModFacts, sceneMods, scenePlan, scenePlanOf, sceneReport, sceneSaid, sceneServerArgs, sceneServerProperties, type SceneAnswer } from "../src/scene"
import { checkScene, deployScene, readScene, scenePaths } from "../src/scene-run"
import { dragonBoss, dragonDesign, dragonFlight, dragonHitbox } from "./giant-flier"

const project = {
  id: "11111111-1111-4111-8111-111111111111",
  mod_id: "storm_peak",
  entities: [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "风暴石像", hitbox: { core: { width: 2.6 } } },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "云鲸" },
  ],
  blocks: [{ identifier: "storm_brick", name: "风暴砖" }],
  items: Array.from({ length: 29 }, (_, index) => ({ identifier: `item_${index}`, name: `东西 ${index}` })),
}

test("the scene sets out every thing of the project by its kind and registry name, and the same project gives the same plan", () => {
  const plan = scenePlan(project)
  expect(scenePlan(project)).toEqual(plan)
  expect(plan.things.map((thing) => thing.kind)).toEqual(["block", ...Array.from({ length: 29 }, () => "item" as const), "creature", "creature"])
  const commands = plan.place.map((step) => step.command)
  // One row across the view, side by side: items shown on the right (-X), the block in the middle, the creatures on the left (+X).
  const blocks = plan.things.filter((thing) => thing.kind === "block")
  const creatures = plan.things.filter((thing) => thing.kind === "creature")
  const shown = commands.filter((command) => command.startsWith("summon minecraft:item_display"))
  expect(shown).toHaveLength(SCENE.shown_items)
  const shownX = shown.map((command) => Number(command.split(" ")[2]) - 0.5)
  expect(Math.max(...shownX)).toBeLessThan(blocks[0]!.at[0])
  expect(creatures.every((creature) => creature.at[0] > blocks[0]!.at[0])).toBe(true)
  // All in one row, at the same distance, and far enough back that the widest reach (a pen's edge) is inside the view.
  const distance = blocks[0]!.at[2]
  expect(creatures.every((creature) => creature.at[2] === distance)).toBe(true)
  const radius = Math.ceil(2.6 / 2) + 2
  const reach = Math.max(...creatures.map((creature) => Math.abs(creature.at[0]) + radius + Math.ceil(2.6 / 2)), ...shownX.map((x) => Math.abs(x) + 1))
  expect(distance).toBe(Math.max(SCENE.near, Math.ceil(reach / SCENE.view)))
  expect(reach / distance).toBeLessThanOrEqual(SCENE.view)
  // A creature 2.6 blocks wide stands in a pen of glass panes of radius 4 (half its width rounded up, and 2), so pens are 10 apart.
  expect(creatures[1]!.at[0] - creatures[0]!.at[0]).toBe(10)
  const [cx, , cz] = creatures[0]!.at
  expect(commands).toEqual(expect.arrayContaining([`fill ${cx - 4} -60 ${cz - 4} ${cx + 4} -59 ${cz - 4} ${SCENE_PEN.wall}`, `fill ${cx - 4} -60 ${cz + 4} ${cx + 4} -59 ${cz + 4} ${SCENE_PEN.wall}`]))
  expect(commands.indexOf("gamerule spawnRadius 0")).toBeLessThan(commands.indexOf("setworldspawn 0 -60 0"))
  expect(commands).toContain(`setblock ${blocks[0]!.at[0]} -60 ${distance} storm_peak:storm_brick`)
  // Names grow with the row's distance, so they look the size they do at SCENE.near; a creature carries its name as a rider.
  const scale = Math.round(1.5 * (distance / SCENE.near) * 100) / 100
  const transform = (lift: number) => `transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,${lift}f,0f],scale:[${scale}f,${scale}f,${scale}f]}`
  expect(commands).toContain(`summon storm_peak:creature_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa ${cx} -60 ${cz} {PersistenceRequired:1b,Rotation:[180f,0f],Passengers:[{id:"minecraft:text_display",Tags:["minemods_scene_label"],text:'"风暴石像"',billboard:"center",${transform(0.5)}}]}`)
  // broad4 w1: names in the row never reach each other. Each is at most the grown size, and smaller only when the grown size would
  // cover the name beside it (here the eight item names, two blocks apart, at a row set far back for the pens).
  const names = commands
    .filter((command) => command.startsWith("summon minecraft:text_display "))
    .map((command) => ({ x: Number(command.split(" ")[2]), title: /text:'"([^"]*)"'/.exec(command)![1]!, scale: Number(/scale:\[([\d.]+)f/.exec(command)![1]) }))
    .sort((a, b) => a.x - b.x)
  const width = (name: { title: string; scale: number }) => ([...name.title].reduce((sum, char) => sum + (/[\u2E80-\uFFFF]/u.test(char) ? 9 : 6), 0) + 2) / 40 * name.scale
  expect(names.map((name) => name.title)).toContain("风暴砖")
  expect(names.every((name) => name.scale <= scale)).toBe(true)
  names.slice(1).forEach((name, index) => expect(name.x - names[index]!.x).toBeGreaterThanOrEqual((width(name) + width(names[index]!)) / 2 + 0.5 - 0.02))
  expect(commands.some((command) => command.includes("_sign") || command.includes("CustomName"))).toBe(false)
  // 29 items: the first eight shown, all 29 in two chests right behind the ones shown; the 28th in the second chest's first slot.
  const chests = commands.filter((command) => command.endsWith("minecraft:chest"))
  expect(chests).toHaveLength(2)
  expect(chests.every((command) => command.includes(` -60 ${distance + 2} `))).toBe(true)
  const chestX = chests.map((command) => Number(command.split(" ")[1]))
  expect(chestX.every((x) => x >= Math.min(...shownX) && x <= Math.max(...shownX))).toBe(true)
  expect(commands).toContain(`item replace block ${chestX[0]} -60 ${distance + 2} container.26 with storm_peak:item_26`)
  expect(commands).toContain(`item replace block ${chestX[1]} -60 ${distance + 2} container.0 with storm_peak:item_27`)
  expect(scenePlan({ ...project, blocks: [{ identifier: "b", name: `它's "砖"` }], items: [], entities: [] }).place.at(-1)!.command).toContain(`text:'"它\\'s \\\\"砖\\\\""'`)
  // A small project stands nearer: one block, one item, one creature at 12.
  const small = scenePlan({ ...project, items: project.items.slice(0, 1), entities: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "云鲸" }] })
  expect(small.things.find((thing) => thing.kind === "block")!.at[2]).toBe(12)
  // Everything set out is inside the region kept loaded, and that is asked for before anything is placed.
  expect(commands.findIndex((command) => command.startsWith("forceload add"))).toBeLessThan(commands.findIndex((command) => command.startsWith("setblock")))
  expect(plan.things.every((thing) => thing.at[0] >= plan.region[0] && thing.at[0] <= plan.region[2] && thing.at[2] >= plan.region[1] && thing.at[2] <= plan.region[3])).toBe(true)
  // Only creatures are asked about again after the wait; the world is saved last.
  expect(plan.ask.map((step) => step.ask)).toEqual(["there", "where", "health", "there", "where", "health"])
  expect(plan.close.map((step) => step.command)).toEqual(["save-all flush"])
  expect(scenePlan({ mod_id: "empty", entities: [], blocks: [], items: [] }).things).toEqual([])
})

/** The blocks the plan's commands leave, in order, as the game would: `fill` and `setblock` only; a cell is a block name (air removes it). */
function worldOf(commands: readonly string[]) {
  const cells = new Map<string, string>()
  const set = (x: number, y: number, z: number, block: string) => (block.replace(/\[.*$/, "") === "minecraft:air" ? cells.delete(`${x} ${y} ${z}`) : cells.set(`${x} ${y} ${z}`, block))
  for (const command of commands) {
    const fill = /^fill (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(command)
    if (fill) {
      const [x1, y1, z1, x2, y2, z2] = fill.slice(1, 7).map(Number) as [number, number, number, number, number, number]
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) set(x, y, z, fill[7]!)
    }
    const one = /^setblock (-?\d+) (-?\d+) (-?\d+) (\S+)$/.exec(command)
    if (one) set(Number(one[1]), Number(one[2]), Number(one[3]), one[4]!)
  }
  return cells
}

test("broad23: nothing in the scene is an invisible block, and every creature that has a pen has a seen-through one with a way in", () => {
  const walkers = [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "霜角鹿王", hitbox: { core: { width: 2.6, height: 3 } } },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "云鲸" },
    { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "岩巨人", hitbox: { core: { width: 10, height: 14 } } },
  ]
  const plan = scenePlan({ ...project, entities: walkers })
  const world = worldOf(plan.place.map((step) => step.command))
  // No block the game does not draw: the wall of a pen is glass and its gate wood, and nothing else of the scene is invisible either.
  const blocks = [...new Set(world.values())].map((block) => block.replace(/\[.*$/, ""))
  for (const hidden of ["minecraft:barrier", "minecraft:structure_void", "minecraft:light", "minecraft:command_block", "minecraft:jigsaw"]) expect(blocks).not.toContain(hidden)
  expect(plan.place.some((step) => /barrier|structure_void|minecraft:light/.test(step.command))).toBe(false)
  for (const thing of plan.things.filter((thing) => thing.kind === "creature")) {
    const [x, y, z] = thing.at
    const r = penRadius(thing.title === "岩巨人" ? 10 : thing.title === "霜角鹿王" ? 2.6 : undefined)
    // The pen is seen through: every cell of its wall is a pane, except the gate.
    for (let d = -r; d <= r; d++) {
      for (const up of [0, 1]) {
        for (const [cx, cz] of [[x + d, z - r], [x + d, z + r], [x - r, z + d], [x + r, z + d]] as const) {
          if (cx === x && cz === z - r) continue
          expect(world.get(`${cx} ${y + up} ${cz}`)).toBe(SCENE_PEN.wall)
        }
      }
    }
    // The way in: a gate in the middle of the side toward the person (at the origin), with room above it to walk through, and nothing placed on the way to it or just inside it.
    expect(world.get(`${x} ${y} ${z - r}`)).toBe(SCENE_PEN.gate)
    expect(world.has(`${x} ${y + 1} ${z - r}`)).toBe(false)
    for (const dz of [-2, -1, 1, 2]) for (const up of [0, 1]) expect(world.has(`${x} ${y + up} ${z - r + dz}`)).toBe(false)
    // Nothing of the pen stands between the person and the creature but the glass and the gate: the cell the creature is summoned in is free.
    expect(world.has(`${x} ${y} ${z}`)).toBe(false)
  }
  // Every creature of a kind is penned the same: the same wall and gate, one gate each.
  expect(plan.place.filter((step) => step.command.includes("oak_fence_gate"))).toHaveLength(3)
})

test("a plain list of registry names gives the same plan as the project it could have come from, whatever order it is in", () => {
  const list = [
    { kind: "creature" as const, id: "storm_peak:creature_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa", title: "风暴石像", width: 2.6 },
    ...project.items.map((item) => ({ kind: "item" as const, id: `storm_peak:${item.identifier}`, title: item.name })),
    { kind: "creature" as const, id: "storm_peak:creature_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb", title: "云鲸" },
    { kind: "block" as const, id: "storm_peak:storm_brick", title: "风暴砖" },
  ]
  expect(scenePlanOf(list)).toEqual(scenePlan(project))
  // The names are used as given: a mod written by hand registers a creature under whatever name it chose, in any namespace.
  const own = scenePlanOf([{ kind: "creature", id: "ruby:ruby_golem", title: "红宝石傀儡" }, { kind: "item", id: "ruby:ruby", title: "红宝石" }])
  expect(own.things).toEqual([{ kind: "item", id: "ruby:ruby", title: "红宝石", at: [-3, -60, 11] }, { kind: "creature", id: "ruby:ruby_golem", title: "红宝石傀儡", at: [4, -60, 9] }])
  expect(own.place.map((step) => step.command)).toEqual(expect.arrayContaining(["item replace block -3 -60 11 container.0 with ruby:ruby"]))
  expect(own.place.some((step) => step.command.startsWith(`summon ruby:ruby_golem 4 -60 9 {PersistenceRequired:1b,Rotation:[180f,0f],Passengers:[{id:"minecraft:text_display",Tags:["minemods_scene_label"],text:'"红宝石傀儡"'`))).toBe(true)
  expect(own.ask.map((step) => step.command)).toEqual(["execute if entity @e[type=ruby:ruby_golem]", "data get entity @e[type=ruby:ruby_golem,limit=1] Pos", "data get entity @e[type=ruby:ruby_golem,limit=1] Health"])
  expect(scenePlanOf([]).things).toEqual([])
})

test("the server it starts is on this computer only, flat, with no account asked; the game is started with Fabric Loader and every jar of one folder", () => {
  const properties = sceneServerProperties(40123)
  for (const line of ["level-type=minecraft\\:flat", "server-ip=127.0.0.1", "server-port=40123", "online-mode=false", "enable-rcon=false", "generate-structures=false"]) expect(properties.split("\n")).toContain(line)
  expect(sceneServerArgs({ libraries: "C:\\运行\\server-libs", gameJar: "C:\\运行\\game\\server.jar" })).toEqual(["-Xmx2G", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dfabric.gameJarPath=C:\\运行\\game\\server.jar", "-classpath", "C:\\运行\\server-libs\\*", "net.fabricmc.loader.impl.launch.knot.KnotServer", "--universe", "saves", "--world", "test_scene", "nogui"])
  const client = sceneClientArgs({ libraries: "/r/client-libs", assets: "/r/assets", assetIndex: "17", instance: "/r/i", version: "fabric-loader-0.17.2-1.21.1", os: "linux", world: true })
  expect(client.slice(0, 5)).toEqual(["-Xmx2G", "-Dfile.encoding=UTF-8", "-classpath", "/r/client-libs/*", "net.fabricmc.loader.impl.launch.knot.KnotClient"])
  expect(client.join(" ")).toContain("--gameDir /r/i --assetsDir /r/assets --assetIndex 17")
  expect(client.slice(-2)).toEqual(["--quickPlaySingleplayer", "test_scene"])
  // No world yet: the title screen, not a world that is not there. macOS needs its first-thread flag.
  expect(sceneClientArgs({ libraries: "/r", assets: "/a", assetIndex: "17", instance: "/i", version: "v", os: "osx", world: false })).toEqual(expect.arrayContaining(["-XstartOnFirstThread"]))
  expect(sceneClientArgs({ libraries: "/r", assets: "/a", assetIndex: "17", instance: "/i", version: "v", os: "osx", world: false })).not.toContain("--quickPlaySingleplayer")
})

test("the game's libraries are read from its own version file by its own rules, and Fabric Loader's from the list inside its jar — each with its checksum", () => {
  const version = {
    libraries: [
      { name: "a:plain:1", downloads: { artifact: { path: "a/plain/1/plain-1.jar", sha1: "1".repeat(40), url: "https://l/a" } } },
      { name: "org.lwjgl:lwjgl:3.3.3:natives-windows", rules: [{ action: "allow", os: { name: "windows" } }], downloads: { artifact: { path: "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar", sha1: "2".repeat(40), url: "https://l/w" } } },
      { name: "org.lwjgl:lwjgl:3.3.3:natives-macos", rules: [{ action: "allow", os: { name: "osx" } }], downloads: { artifact: { path: "org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-macos.jar", sha1: "3".repeat(40), url: "https://l/m" } } },
      { name: "b:not-mac:1", rules: [{ action: "allow" }, { action: "disallow", os: { name: "osx" } }], downloads: { artifact: { path: "b/not-mac/1/not-mac-1.jar", sha1: "4".repeat(40), url: "https://l/b" } } },
      { name: "a:plain:1", downloads: { artifact: { path: "a/plain/1/plain-1.jar", sha1: "1".repeat(40), url: "https://l/a" } } },
    ],
  }
  expect(sceneClientLibraries(version, "windows").map((library) => library.name)).toEqual(["a:plain:1", "org.lwjgl:lwjgl:3.3.3:natives-windows", "b:not-mac:1"])
  expect(sceneClientLibraries(version, "osx").map((library) => library.name)).toEqual(["a:plain:1", "org.lwjgl:lwjgl:3.3.3:natives-macos"])
  // The same native library for other processors of the same system is left out; the game would not load it.
  const natives = { libraries: ["natives-windows", "natives-windows-x86", "natives-windows-arm64"].map((kind) => ({ name: `org.lwjgl:lwjgl:3.3.3:${kind}`, rules: [{ action: "allow", os: { name: "windows" } }], downloads: { artifact: { path: `l/lwjgl-3.3.3-${kind}.jar`, sha1: "6".repeat(40), url: "https://l/n" } } })) }
  expect(sceneClientLibraries(natives, "windows").map((library) => library.name)).toEqual(["org.lwjgl:lwjgl:3.3.3:natives-windows"])
  expect(sceneClientLibraries(natives, "windows", "arm64").map((library) => library.name)).toEqual(["org.lwjgl:lwjgl:3.3.3:natives-windows-arm64"])
  expect(mavenPath("net.fabricmc:sponge-mixin:0.16.3+mixin.0.8.7")).toBe("net/fabricmc/sponge-mixin/0.16.3+mixin.0.8.7/sponge-mixin-0.16.3+mixin.0.8.7.jar")
  const installer = { libraries: { common: [{ name: "org.ow2.asm:asm:9.8", url: "https://maven.fabricmc.net/", sha1: "dc19ecb3f7889b7860697215cae99c0f9b6f6b4b" }], client: [], server: [], development: [{ name: "x:dev:1", url: "https://m/", sha1: "5".repeat(40) }] } }
  expect(sceneLoaderLibraries(installer, "server")).toEqual([{ name: "org.ow2.asm:asm:9.8", url: "https://maven.fabricmc.net/org/ow2/asm/asm/9.8/asm-9.8.jar", sha1: "dc19ecb3f7889b7860697215cae99c0f9b6f6b4b", path: "org/ow2/asm/asm/9.8/asm-9.8.jar" }])
  // A library without a checksum is not fetched on trust.
  expect(() => sceneLoaderLibraries({ libraries: { common: [{ name: "a:b:1", url: "https://m/" }] } }, "client")).toThrow("LOADER_LIBRARY_UNPINNED")
})

test("only what something in the scene asks for is put in; a mod it is built on that nobody supplied is named as missing", () => {
  const built = sceneModFacts("/b/mod.jar", { id: "storm_peak", depends: { fabricloader: "*", minecraft: "1.21.1", java: ">=21", "fabric-api": "*", geckolib: ">=4.8.3", playeranimator: "*" } }, [{ id: "playeranimator", depends: { fabricloader: "*" } }])
  expect(built).toEqual({ file: "/b/mod.jar", ids: ["storm_peak", "playeranimator"], depends: ["fabricloader", "minecraft", "java", "fabric-api", "geckolib"] })
  const known = [{ file: "/k/fabric-api.jar", ids: ["fabric-api", "fabric"], depends: [] }, { file: "/k/geckolib.jar", ids: ["geckolib"], depends: ["fabric-api"] }]
  expect(sceneMods(built, known, [])).toEqual({ mods: [built, ...known], missing: [] })
  // No creature, no GeckoLib: it stays out.
  const plain = sceneModFacts("/b/plain.jar", { id: "plain", depends: { "fabric-api": "*" } })
  expect(sceneMods(plain, known, []).mods.map((mod) => mod.file)).toEqual(["/b/plain.jar", "/k/fabric-api.jar"])
  // Built on another mod: supplied, it goes in with what it needs in turn; not supplied, it is named.
  const addon = sceneModFacts("/b/addon.jar", { id: "addon", depends: { create: ">=0.5", "fabric-api": "*" } })
  const create = sceneModFacts("/e/create.jar", { id: "create", provides: ["flywheel"], depends: { porting_lib: "*" } })
  expect(sceneMods(addon, known, [])).toEqual({ mods: [addon, known[0]!], missing: ["create"] })
  expect(sceneMods(addon, known, [create])).toEqual({ mods: [addon, create, known[0]!], missing: ["porting_lib"] })
})

const log = (answers: string[][]) => [
  "[12:00:00] [main/INFO]: Loading 4 mods:",
  "\t- fabric-api 0.116.6+1.21.1",
  "\t   |-- fabric-api-base 0.4.42",
  "\t   \\-- fabric-renderer-api-v1 3.4.0",
  "\t- fabricloader 0.17.2",
  "\t- geckolib 4.8.3",
  "\t- java 21",
  "\t- minecraft 1.21.1",
  "\t- storm_peak 0.1.0",
  "[12:00:09] [Server thread/INFO]: Done (8.1s)! For help, type \"help\"",
  ...answers.flatMap((said, index) => [...said.map((line) => `[12:00:10] [Server thread/INFO]: ${line}`), `[12:00:10] [Server thread/INFO]: [Not Secure] [Server] ${SCENE_MARK} ${index}`]),
]

test("a report says only what the game itself answered: placed when the game said so, the game's own words when it did not, and every time what was not looked at", () => {
  const small = { id: project.id, mod_id: "storm_peak", entities: project.entities, blocks: project.blocks, items: [{ identifier: "storm_core", name: "风暴石核" }] }
  const plan = scenePlan(small)
  // Found by what the command says, wherever the row puts the thing.
  const say = (command: string, ...said: string[]): SceneAnswer => ({ step: [...plan.place, ...plan.ask, ...plan.close].find((step) => step.command.startsWith(command) || (command.startsWith("~") && step.command.includes(command.slice(1))))!, said })
  const good = [
    say("~storm_peak:storm_brick", "Changed the block at 0, -60, 6"),
    say("item replace", "Replaced a slot at 0, -60, 3 with [风暴石核]"),
    say("summon storm_peak:creature_aaaa", "Summoned new 风暴石像"),
    say("summon storm_peak:creature_bbbb", "Summoned new 云鲸"),
    say(`~text:'"风暴砖"'`, "Summoned new Text Display"),
    say("execute if entity @e[type=storm_peak:creature_aaaa", "Test passed, count: 1"),
    say("data get entity @e[type=storm_peak:creature_aaaa", "风暴石像 has the following entity data: [-3.5d, -60.0d, 14.5d]"),
    say("execute if entity @e[type=storm_peak:creature_bbbb", "Test passed, count: 1"),
    say("save-all", "Saving the game (this may take a moment!)", "Saved the game"),
  ]
  const lines = log([])
  expect(SCENE_READY.test(lines[9]!)).toBe(true)
  expect(sceneSaid(lines[9]!)).toBe('Done (8.1s)! For help, type "help"')
  const clean = sceneReport({ mod_id: "storm_peak", plan, answers: good, log: lines, started: true })
  // Everything that was in this game, the game, Java and the loader left out; nested modules are not counted as mods of their own.
  expect(clean.mods).toEqual(["fabric-api 0.116.6+1.21.1", "geckolib 4.8.3", "storm_peak 0.1.0"])
  expect(clean.findings).toEqual([])
  expect(clean.things.find((thing) => thing.kind === "block")).toMatchObject({ placed: true, label: { placed: true, said: ["Summoned new Text Display"] } })
  expect(clean.things.find((thing) => thing.title === "风暴石像")).toMatchObject({ placed: true, there: true, at: [-3.5, -60, 14.5] })
  expect(sceneLines(clean)).toEqual(["游戏带着这个模组启动了。测试场里装的只有：fabric-api 0.116.6+1.21.1、geckolib 4.8.3、storm_peak 0.1.0。", "摆出来的每样东西游戏都认，等了一会儿都还在，日志里没有提到这个模组或它的东西的报错。", clean.limits])
  expect(clean.limits).toContain("它看不到任何画面")
  // Round 20, from the real logs: the two lines every such game writes are no fault of the mod; an error that names a creature only by
  // its registry name is the mod's; an error naming nothing of it is counted and said as that, never as "the log is clean".
  const real = sceneReport({
    mod_id: "storm_peak",
    plan,
    answers: good,
    started: true,
    log: [
      ...lines,
      "[12:08:36] [main/ERROR]: No data fixer registered for creature_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",
      "[12:08:36] [main/ERROR]: No key layers in MapLike[{}]",
      "[12:08:40] [Server thread/ERROR]: Entity creature_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa ticked with a null brain",
      "[12:08:41] [Server thread/ERROR]: Something else entirely went wrong",
    ],
  })
  expect(real.errors).toEqual(["[12:08:40] [Server thread/ERROR]: Entity creature_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa ticked with a null brain"])
  expect(real.others).toBe(1)
  expect(sceneLines(real).at(-2)).toBe("日志里另有 1 行报错没有提到这个模组（原文在检查的日志里），是不是和它有关没有判断。")
  expect(clean.others).toBe(0)
  // What went wrong by itself: an id the game does not know, a creature gone after the wait, one that fell through, an error naming the mod, a world not saved.
  const bad = sceneReport({
    mod_id: "storm_peak",
    plan,
    started: true,
    log: [...lines, "[12:00:11] [Server thread/ERROR]: Failed to handle packet", "java.lang.NullPointerException: Cannot invoke \"studio.storm_peak.StudioCreature.tick()\""],
    answers: [
      say("~storm_peak:storm_brick", "Unknown block type 'storm_peak:storm_brick'", "...ck 0 -60 6 storm_peak:storm_brick<--[HERE]"),
      good[4]!,
      good[1]!,
      good[2]!,
      good[3]!,
      say("execute if entity @e[type=storm_peak:creature_aaaa", "Test failed"),
      say("execute if entity @e[type=storm_peak:creature_bbbb", "Test passed, count: 1"),
      say("data get entity @e[type=storm_peak:creature_bbbb", "云鲸 has the following entity data: [4.5d, -71.25d, 14.5d]"),
    ],
  })
  expect(bad.findings).toEqual([
    "「风暴砖」摆不出来（storm_peak:storm_brick）：Unknown block type 'storm_peak:storm_brick' ...ck 0 -60 6 storm_peak:storm_brick<--[HERE]",
    "「风暴石像」放出来 10 秒以后已经不在世界里了（没有人碰它）。",
    "「云鲸」放在地面上，10 秒以后掉到了 y=-71，在地面以下。",
    'java.lang.NullPointerException: Cannot invoke "studio.storm_peak.StudioCreature.tick()"'.replace(/^/, "游戏日志里有 1 行提到这个模组的报错，第一行："),
    "世界没有存下来，打开测试场时看到的可能不是这一次摆好的样子。",
  ])
  expect(bad.tail.length).toBeGreaterThan(0)
  // It never started: said as that, with the end of the log, and nothing is claimed about any thing.
  const dead = sceneReport({ mod_id: "storm_peak", plan, answers: [], log: ["[main/ERROR]: Incompatible mods found!"], started: false })
  expect(dead.findings).toEqual(["游戏装上这个模组以后没有启动起来。"])
  expect(dead.tail).toEqual(["[main/ERROR]: Incompatible mods found!"])
})

test("a rejected or unanswered block label is reported separately from block placement", () => {
  const plan = scenePlan({ mod_id: "storm_peak", entities: [], blocks: project.blocks, items: [] })
  const placement = plan.place.find((step) => step.command.startsWith("setblock") && step.about === 0)!
  const label = plan.place.find((step) => step.ask === "label" && step.about === 0)!
  const saved = plan.close[0]!
  const base = {
    mod_id: "storm_peak",
    plan,
    started: true,
    log: log([]),
  }
  const refused = sceneReport({
    ...base,
    answers: [
      { step: placement, said: ["Changed the block at 0, -60, 6"] },
      { step: label, said: ["Invalid string contents: Could not parse text"] },
      { step: saved, said: ["Saved the game"] },
    ],
  })
  expect(refused.things[0]).toMatchObject({ placed: true, label: { placed: false, said: ["Invalid string contents: Could not parse text"] } })
  expect(refused.findings).toEqual(["「风暴砖」名字标签没有放出来（storm_peak:storm_brick）：Invalid string contents: Could not parse text"])
  expect(sceneLines(refused)).not.toContain(SCENE_WORDS.clean)

  const unanswered = sceneReport({
    ...base,
    answers: [
      { step: placement, said: ["Changed the block at 0, -60, 6"] },
      { step: saved, said: ["Saved the game"] },
    ],
  })
  expect(unanswered.things[0]).toMatchObject({ placed: true, label: { placed: false, said: [] } })
  expect(unanswered.findings).toEqual(["「风暴砖」名字标签没有放出来（storm_peak:storm_brick）：游戏没有回答"])
})

test("deploying makes an instance with the built jar, what it asks for and nothing else; a second deploy replaces the first; a check is not started without the person's agreement or over a missing mod", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-scene-"))
  try {
    const profile = resolveProfile("fabric-1.21.1")
    const jar = (metadata: unknown, nested: Record<string, unknown> = {}) =>
      zipSync({ "fabric.mod.json": Buffer.from(JSON.stringify(metadata)), ...Object.fromEntries(Object.entries(nested).map(([name, value]) => [`META-INF/jars/${name}`, zipSync({ "fabric.mod.json": Buffer.from(JSON.stringify(value)) })])) })
    const projectDirectory = path.join(directory, "project")
    const runtimeDirectory = path.join(directory, "runtime")
    await mkdir(path.join(projectDirectory, "out"), { recursive: true })
    const jarPath = path.join(projectDirectory, "out", "storm_peak-0.1.0.jar")
    await writeFile(jarPath, jar({ id: "storm_peak", depends: { fabricloader: "*", minecraft: "1.21.1", "fabric-api": "*", geckolib: "*", playeranimator: "*" } }, { "player-animation-lib.jar": { id: "playeranimator" } }))
    const build = { id: "22222222-2222-4222-8222-222222222222", revision: 17, jarPath, projectDirectory, sourceDirectory: projectDirectory, sha256: "a".repeat(64) }
    const fetched: string[] = []
    // The pinned libraries are "downloaded" as files whose bytes happen to have the pinned checksums: only the asking is under test.
    const fetch = async (input: { url: string; destination: string }) => {
      fetched.push(input.url)
      await writeFile(input.destination, "x")
    }
    const unchecked = { ...{ runtimeDirectory }, fetch }
    // Not the right bytes: refused, and nothing is left in the instance's place for a library.
    await expect(deployScene({ build, project: { id: project.id, name: "风暴山巅" }, runtimeDirectory }, unchecked)).rejects.toThrow("DOWNLOAD_CHECKSUM_MISMATCH")
    expect(fetched).toEqual(expect.arrayContaining([profile.downloads.fabricApi.url]))
    const paths = scenePaths(runtimeDirectory, project.id)
    expect(await readdir(paths.mods)).toEqual([])
    // A download the network drops is asked for again, a few times; a wrong checksum is not.
    const { SCENE_FETCH } = await import("../src/scene-run")
    const dropped = { calls: 0 }
    const paused: number[] = []
    const said: string[] = []
    await expect(deployScene({ build, project: { id: project.id, name: "风暴山巅" }, runtimeDirectory }, { runtimeDirectory, onProgress: (line) => said.push(line), pause: async (ms) => void paused.push(ms), fetch: async () => { dropped.calls++; throw new Error("DOWNLOAD_FAILED", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) }) } })).rejects.toThrow("SCENE_DOWNLOAD_FAILED")
    expect(dropped.calls).toBeGreaterThanOrEqual(SCENE_FETCH.tries)
    expect(dropped.calls % SCENE_FETCH.tries).toBe(0)
    // Each pause doubles up to the longest (several files are fetched at once, so their pauses interleave), and each retry is
    // said with what the network answered.
    expect([...new Set(paused)].sort((a, b) => a - b)).toEqual([1000, 2000, 4000, 8000, 16000])
    expect(said.find((line) => line.includes("ECONNRESET") && line.includes("第 2 次"))).toBeDefined()
    // A mod that asks for nothing Studio has to fetch deploys with no network at all.
    await writeFile(jarPath, jar({ id: "storm_peak", depends: { fabricloader: "*", create: "*" } }))
    const none = async () => {
      throw new Error("NO_NETWORK_IN_THIS_TEST")
    }
    const missing = await deployScene({ build, project: { id: project.id, name: "风暴山巅" }, runtimeDirectory }, { runtimeDirectory, fetch: none })
    expect(missing).toMatchObject({ build_id: build.id, revision: 17, mods: ["storm_peak-0.1.0.jar"], missing: ["create"] })
    expect(await readFile(path.join(paths.instance, "测试场说明.md"), "utf8")).toContain(`缺少前置模组：create。把它们的 jar 放进工程文件夹下的 ${SCENE_EXTRA} 文件夹`)
    await expect(checkScene({ project: { ...project, items: [] }, runtimeDirectory, eula: false }, { runtimeDirectory, fetch: none })).rejects.toThrow("SCENE_EULA")
    await expect(checkScene({ project: { ...project, items: [] }, runtimeDirectory, eula: true }, { runtimeDirectory, fetch: none })).rejects.toThrow("SCENE_MISSING_MODS:create")
    // The person puts the jar it is built on beside the project: it goes in, and the old instance's mods and world are replaced.
    await mkdir(path.join(projectDirectory, SCENE_EXTRA))
    await writeFile(path.join(projectDirectory, SCENE_EXTRA, "create-0.5.jar"), jar({ id: "create" }))
    await mkdir(path.join(paths.instance, "saves", SCENE.world), { recursive: true })
    await writeFile(path.join(paths.instance, "mods", "left-over.jar"), "old")
    const whole = await deployScene({ build, project: { id: project.id, name: "风暴山巅" }, runtimeDirectory }, { runtimeDirectory, fetch: none })
    expect(whole).toMatchObject({ mods: ["create-0.5.jar", "storm_peak-0.1.0.jar"], missing: [] })
    expect((await readdir(path.join(paths.instance, "mods"))).sort()).toEqual(["create-0.5.jar", "storm_peak-0.1.0.jar"])
    expect(await readdir(path.join(paths.instance, "saves"))).toEqual([])
    expect(await readScene(runtimeDirectory, project.id)).toEqual(whole)
    expect(createHash("sha256").update(await readFile(path.join(paths.instance, "mods", "storm_peak-0.1.0.jar"))).digest("hex")).toBe(createHash("sha256").update(await readFile(jarPath)).digest("hex"))
    expect(await readFile(path.join(paths.instance, "options.txt"), "utf8")).toContain("pauseOnLostFocus:false")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// The game is played here by a script that answers the console the way the server does: what is under test is the driving, not the game.
test.skipIf(process.platform === "win32")("the check drives the console one command at a time, reads each answer between its marks, saves and stops", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-scene-run-"))
  try {
    const javaHome = path.join(directory, "java")
    await mkdir(path.join(javaHome, "bin"), { recursive: true })
    await writeFile(
      path.join(javaHome, "bin", "java"),
      [
        "#!/bin/bash",
        `if [ "$1" = "-version" ]; then echo 'openjdk version "21.0.1" 2023' >&2; exit 0; fi`,
        `printf '[00:00:00] [main/INFO]: Loading 3 mods:\\n\\t- java 21\\n\\t- minecraft 1.21.1\\n\\t- storm_peak 0.1.0\\n'`,
        `echo "$@" > args.txt`,
        `echo '[00:00:01] [Server thread/INFO]: Done (1.0s)! For help, type "help"'`,
        "while IFS= read -r line; do",
        '  case "$line" in',
        '    stop) echo "[00:00:09] [Server thread/INFO]: Stopping server"; exit 0;;',
        '    say\\ *) echo "[00:00:02] [Server thread/INFO]: [Not Secure] [Server] ${line#say }";;',
        '    summon\\ minecraft:text_display*) echo "[00:00:02] [Server thread/INFO]: Summoned new Text Display";;',
        '    summon\\ *aaaa*) echo "[00:00:02] [Server thread/INFO]: Summoned new 风暴石像";;',
        '    summon\\ *) echo "[00:00:02] [Server thread/INFO]: Can\'t find element of type minecraft:entity_type";;',
        '    setblock\\ *storm_peak*) echo "[00:00:02] [Server thread/INFO]: Changed the block at 0, -60, 6";;',
        '    execute\\ if*aaaa*) echo "[00:00:03] [Server thread/INFO]: Test passed, count: 1";;',
        '    execute\\ if*) echo "[00:00:03] [Server thread/INFO]: Test failed";;',
        '    data\\ get*aaaa*Pos) echo "[00:00:03] [Server thread/INFO]: 风暴石像 has the following entity data: [-3.5d, -60.0d, 15.25d]";;',
        '    data\\ get*aaaa*Health) echo "[00:00:03] [Server thread/INFO]: 风暴石像 has the following entity data: 300.0f";;',
        '    save-all*) mkdir -p saves/test_scene; touch saves/test_scene/level.dat; echo "[00:00:04] [Server thread/INFO]: Saved the game";;',
        "  esac",
        "done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    )
    const runtimeDirectory = path.join(directory, "runtime")
    const projectDirectory = path.join(directory, "project")
    await mkdir(projectDirectory, { recursive: true })
    const jarPath = path.join(projectDirectory, "storm_peak-0.1.0.jar")
    await writeFile(jarPath, zipSync({ "fabric.mod.json": Buffer.from(JSON.stringify({ id: "storm_peak", depends: { fabricloader: "*" } })) }))
    const options = { runtimeDirectory, javaHome, server: { libraries: path.join(directory, "libs"), gameJar: path.join(directory, "server.jar") } }
    const small = { ...project, items: [] }
    await expect(checkScene({ project: small, runtimeDirectory, eula: true, settle: 0 }, options)).rejects.toThrow("SCENE_NOT_DEPLOYED")
    await deployScene({ build: { id: "22222222-2222-4222-8222-222222222222", revision: 1, jarPath, projectDirectory, sourceDirectory: projectDirectory, sha256: "a".repeat(64) }, project: { id: project.id, name: "风暴山巅" }, runtimeDirectory }, options)
    const report = await checkScene({ project: small, runtimeDirectory, eula: true, settle: 0 }, options)
    const paths = scenePaths(runtimeDirectory, project.id)
    expect(report.started).toBe(true)
    expect(report.mods).toEqual(["storm_peak 0.1.0"])
    expect(report.saved).toBe(true)
    expect(report.things).toEqual([
      { kind: "block", id: "storm_peak:storm_brick", title: "风暴砖", placed: true, label: { placed: true, said: ["Summoned new Text Display"] }, said: [] },
      { kind: "creature", id: "storm_peak:creature_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa", title: "风暴石像", placed: true, there: true, at: [-3.5, -60, 15.25], health: 300, said: [] },
      { kind: "creature", id: "storm_peak:creature_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb", title: "云鲸", placed: false, there: false, at: null, health: null, said: ["Can't find element of type minecraft:entity_type"] },
    ])
    expect(report.findings).toEqual(["「云鲸」放不出来（storm_peak:creature_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb）：Can't find element of type minecraft:entity_type"])
    // It was started in the instance, as the server of one flat world on this computer, and the person's agreement is what wrote the licence file.
    expect(await readFile(path.join(paths.instance, "args.txt"), "utf8")).toContain("net.fabricmc.loader.impl.launch.knot.KnotServer --universe saves --world test_scene nogui")
    expect(await readFile(path.join(paths.instance, "eula.txt"), "utf8")).toBe("eula=true\n")
    expect(await readFile(path.join(paths.instance, "server.properties"), "utf8")).toContain("server-ip=127.0.0.1")
    expect((await readScene(runtimeDirectory, project.id))!.report).toEqual(report)
    expect(await readFile(paths.log, "utf8")).toContain("Stopping server")
    // The world is given its tidy-up rule before the game makes it: in the world's own folder, nowhere near the mod.
    const pack = path.join(paths.instance, "saves", SCENE.world, "datapacks", SCENE_DATAPACK.folder)
    expect(await readFile(path.join(pack, "data", "minemods_scene", "function", "tidy.mcfunction"), "utf8")).toBe(SCENE_DATAPACK.files["data/minemods_scene/function/tidy.mcfunction"])
    expect(JSON.parse(await readFile(path.join(pack, "data", "minecraft", "tags", "function", "tick.json"), "utf8"))).toEqual({ values: ["minemods_scene:tidy"] })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

describe("what a run of the scene says about each saved thing", () => {
  const entity = "64e4b0c2-1111-4222-8333-444455556666"
  const ids = { block: "00000000-0000-4000-8000-000000000001", item: "00000000-0000-4000-8000-000000000002", numbers: "00000000-0000-4000-8000-000000000003", picture: "00000000-0000-4000-8000-000000000004", recipe: "00000000-0000-4000-8000-000000000005" }
  const project = {
    mod_id: "m",
    entities: [{ id: entity, runtime: { texture_asset_id: ids.picture } }],
    blocks: [{ id: ids.block, identifier: "blue_ore" }],
    items: [{ id: ids.item, identifier: "copper_pickaxe" }],
    workspace: { assets: [{ id: entity, document: { kind: "model" } }, { id: ids.numbers, document: { kind: "entity", model_asset_id: entity } }, { id: ids.picture, document: { kind: "texture" } }, { id: ids.block, document: { kind: "block" } }, { id: ids.item, document: { kind: "item" } }, { id: ids.recipe, document: { kind: "recipe" } }] },
  }
  const built = [entity, ids.numbers, ids.picture, ids.block, ids.item, ids.recipe]
  const thing = (kind: "creature" | "block" | "item", name: string, more: object = {}) => ({ kind, id: `m:${name}`, title: name, placed: true, said: [], ...more })
  const report = (things: object[], started = true) => ({ started, mods: [], things, errors: [], saved: true, tail: [], findings: [], limits: "" }) as never

  test("a check gives one case a thing that was set out, on the saved things it is made of", async () => {
    const { sceneCases } = await import("../src/scene")
    const { creatureName } = await import("../src/gameplay")
    const cases = sceneCases(project, built, { report: report([thing("block", "blue_ore"), thing("item", "copper_pickaxe", { placed: false, said: ["Unknown item"] }), thing("creature", creatureName({ id: entity }), { there: true, at: [0, SCENE.ground, 0] })]) })
    expect(cases.map((value) => [value.kind, value.passed, value.asset_ids])).toEqual([
      ["gametest", true, [ids.block]],
      ["gametest", false, [ids.item]],
      ["gametest", true, [entity, ids.numbers, ids.picture]],
    ])
    expect(cases[1]!.detail).toContain("Unknown item")
  })

  test("a creature that is gone or under the ground did not pass; a game that never started says nothing of any thing", async () => {
    const { sceneCases } = await import("../src/scene")
    const { creatureName } = await import("../src/gameplay")
    const name = creatureName({ id: entity })
    expect(sceneCases(project, built, { report: report([thing("creature", name, { there: false })]) })[0]!.passed).toBe(false)
    expect(sceneCases(project, built, { report: report([thing("creature", name, { there: true, at: [0, SCENE.ground - 30, 0] })]) })[0]!.passed).toBe(false)
    expect(sceneCases(project, built, { report: report([thing("block", "blue_ore")], false) })).toEqual([])
  })

  test("nothing outside the build is named, and opening the scene is one case for everything in it", async () => {
    const { sceneCases } = await import("../src/scene")
    expect(sceneCases(project, [ids.item], { report: report([thing("block", "blue_ore"), thing("item", "copper_pickaxe")]) }).map((value) => value.asset_ids)).toEqual([[ids.item]])
    expect(sceneCases(project, built, { opened: true })).toEqual([{ id: "scene.opened", asset_ids: built, kind: "client", passed: true, detail: SCENE_WORDS.opened }])
    expect(sceneCases(project, [], { opened: true })).toEqual([])
  })
})

test("broad4: two blocks with long names side by side stand far enough apart for both names at full size", () => {
  const plan = scenePlan({ mod_id: "forest", entities: [], items: [], blocks: [{ identifier: "moss", name: "苔藓石砖" }, { identifier: "lantern", name: "萤火虫玻璃灯笼" }] })
  const labels = plan.place.map((step) => step.command).filter((command) => command.startsWith("summon minecraft:text_display "))
  const xs = labels.map((command) => Number(command.split(" ")[2]))
  const scales = labels.map((command) => Number(/scale:\[([\d.]+)f/.exec(command)![1]))
  // Both at the size names have at `near`, and apart by more than half of each name's width.
  expect(scales).toEqual([1.5, 1.5])
  const width = (count: number) => (count * 9 + 2) / 40 * 1.5
  expect(Math.abs(xs[1]! - xs[0]!)).toBeGreaterThanOrEqual((width(4) + width(7)) / 2 + 0.5)
})

test("broad5: the scene's world is opened for commands, so the person can try a boss with /kill or /tp; only that byte changes", async () => {
  const { gzipSync, gunzipSync } = await import("fflate")
  const { allowSceneCommands } = await import("../src/scene-run")
  const name = new TextEncoder().encode("allowCommands")
  const tag = (value: number) => [1, 0, name.length, ...name, value]
  const body = new Uint8Array([10, 0, 0, 10, 0, 4, ...new TextEncoder().encode("Data"), 1, 0, 4, ...new TextEncoder().encode("hard"), 0, ...tag(0), 0, 0])
  const opened = allowSceneCommands(gzipSync(body))!
  const after = gunzipSync(opened)
  expect(after.length).toBe(body.length)
  expect([...after].filter((byte, index) => byte !== body[index])).toEqual([1])
  expect(allowSceneCommands(opened)).toBeNull()
})

test("broad6 w3: the game's line for a player in the world is what tells the drawer the scene is open", async () => {
  const { SCENE_IN_GAME } = await import("../src/scene-run")
  expect(SCENE_IN_GAME.test("[16:01:02] [Server thread/INFO]: Player492 joined the game")).toBe(true)
  expect(SCENE_IN_GAME.test("[16:00:40] [Render thread/INFO]: Setting user: Player492")).toBe(false)
  // broad7 w3: the scene's game speaks Chinese; the untranslated login line and the translated join line both count.
  expect(SCENE_IN_GAME.test("[11:50:51] [Server thread/INFO]: Tester加入了游戏")).toBe(true)
  expect(SCENE_IN_GAME.test("[11:50:51] [Server thread/INFO]: Tester[local:E:1a2b] logged in with entity id 42 at (0.5, -60.0, 0.5)")).toBe(true)
})

// broad16 a60–a61: the game sat on its main menu for six minutes while the drawer said it was still opening, because only the join line was read.
test("broad16 a60: the game's own log says the title screen is ready once the block atlas exists and the sound engine has finished, with or without a world", async () => {
  const { watchGame, CLIENT_ATLAS_READY, CLIENT_SOUND_READY } = await import("../src/scene-run")
  // Lines as the Fabric 1.21.1 client writes them while it loads (the packaged-app test of this repo waits for the same pair).
  const loading = [
    "[19:55:01] [main/INFO] (FabricLoader) Loading 38 mods: fabric-api@0.102.0+1.21.1",
    "[19:55:09] [Render thread/INFO] (Minecraft) Setting user: Tester",
    "[19:55:11] [Render thread/INFO] (Minecraft) Backend library: LWJGL version 3.3.3-snapshot",
    "[19:55:13] [Render thread/INFO] (Minecraft) Reloading ResourceManager: vanilla, fabric, minemods_test",
  ]
  const sound = "[19:55:15] [Render thread/INFO] (Minecraft) OpenAL initialized on device OpenAL Soft on Speakers\n[19:55:15] [Render thread/INFO] (Minecraft) Sound engine started"
  const atlas = "[19:55:18] [Render thread/INFO] (Minecraft) Created: 1024x512x4 minecraft:textures/atlas/blocks.png-atlas"
  expect(CLIENT_ATLAS_READY.test(atlas)).toBe(true)
  expect(CLIENT_ATLAS_READY.test("[19:55:18] [Render thread/INFO] (Minecraft) Created: 512x256x0 minecraft:textures/atlas/particles.png-atlas")).toBe(false)
  expect(CLIENT_SOUND_READY.test("[19:55:15] [Render thread/ERROR] (Minecraft) Error starting SoundSystem. Turning off sounds & music")).toBe(true)

  // The whole log read again every poll, as the file watch does: said once, and only when both lines are in.
  const stages: string[] = []
  const feed = watchGame((stage) => stages.push(stage))
  feed(loading.join("\n"))
  feed(`${loading.join("\n")}\n${sound}`)
  expect(stages).toEqual([])
  feed(`${loading.join("\n")}\n${sound}\n${atlas}`)
  feed(`${loading.join("\n")}\n${sound}\n${atlas}\n[19:55:20] [Render thread/INFO] (Minecraft) Stopping worker threads`)
  expect(stages).toEqual(["title"])
  // Later the player joins a world: that is said too, once, and the title screen is not said again.
  feed("[19:56:40] [Server thread/INFO] (Minecraft) Tester joined the game")
  feed("[19:56:41] [Server thread/INFO] (Minecraft) Tester joined the game")
  expect(stages).toEqual(["title", "in_world"])

  // Pieces of output as the process gives them, a line cut in two among them, and the atlas before the sound.
  const pieces: string[] = []
  const live = watchGame((stage) => pieces.push(stage))
  const text = `${atlas}\n${sound}\n`
  for (let at = 0; at < text.length; at += 17) live(text.slice(at, at + 17))
  expect(pieces).toEqual(["title"])

  // A computer without a sound device prints the error instead and carries on without sound.
  const quiet: string[] = []
  const silent = watchGame((stage) => quiet.push(stage))
  silent(`${atlas}\n[19:55:15] [Render thread/ERROR] (Minecraft) Error starting SoundSystem. Turning off sounds & music`)
  expect(quiet).toEqual(["title"])

  // Joining a world straight away (the check left one) says the join alone: the title screen was only passed through.
  const direct: string[] = []
  const joined = watchGame((stage) => direct.push(stage))
  joined(`${sound}\n[19:56:40] [Server thread/INFO] (Minecraft) Tester[local:E:1a2b] logged in with entity id 42 at (0.5, -60.0, 0.5)\n${atlas}`)
  expect(direct).toEqual(["in_world"])

  // Only one of the two is not the title screen: the window and textures are not ready with just the sound, and the sound may still be loading with just the atlas.
  const half: string[] = []
  watchGame((stage) => half.push(stage))(sound)
  watchGame((stage) => half.push(stage))(atlas)
  expect(half).toEqual([])
})

test("broad16 a60: the title screen has its own words, with the window possibly behind Studio, and no word for 'still opening'", async () => {
  const { SCENE_WORDS } = await import("../src/scene")
  expect(SCENE_WORDS.at_title).toContain("主菜单")
  expect(SCENE_WORDS.at_title).toContain("后面")
  expect(SCENE_WORDS.at_title).toContain("关掉游戏窗口以后这里才算结束")
  expect(SCENE_WORDS.at_title).not.toMatch(/[A-Za-z]/)
  expect(SCENE_WORDS.at_title).not.toContain("正在打开")
})

test("broad8: a creature that flies is told to keep within a few blocks of where it is put, so it is still in the first look; the others are not told", () => {
  // The radius is the smallest home radius the data allows, the nearest a flier's own home could be; it is a number of the scene, not of a creature.
  expect(SCENE.roam).toBe(8)
  const flying = { ...project, entities: [{ ...project.entities[0]!, flight: { style: "soar" } }, project.entities[1]!] }
  const plan = scenePlan(flying)
  const summons = plan.place.map((step) => step.command).filter((command) => command.startsWith("summon storm_peak:creature_"))
  expect(summons).toHaveLength(2)
  const flier = summons.find((command) => command.includes("aaaaaaaaaaaa4aaa"))!
  const walker = summons.find((command) => command.includes("bbbbbbbbbbbb4bbb"))!
  expect(flier).toContain(`Rotation:[180f,0f],FlightRoam:${SCENE.roam}.0d,Passengers:`)
  expect(walker).not.toContain("FlightRoam")
  // It is put on the ground at its spot (the game puts a flier that spawns there on the ground, from which it takes off or stays), and is not penned.
  expect(flier).toMatch(/^summon storm_peak:creature_\S+ -?\d+ -60 \d+ \{/)
  const [fx, , fz] = plan.things.find((thing) => thing.id.includes("aaaaaaaaaaaa4aaa"))!.at
  expect(plan.place.some((step) => step.command.includes(`fill ${fx - 4} -60 ${fz - 4}`))).toBe(false)
  // The row is far enough back that where it may fly (its roam, not a pen) is inside the view; a project with no flier is the plan it was.
  const creatures = plan.things.filter((thing) => thing.kind === "creature")
  const distance = creatures[0]!.at[2]
  const reach = Math.max(...creatures.map((creature) => Math.abs(creature.at[0]) + (creature.id.includes("aaaaaaaaaaaa4aaa") ? SCENE.roam : 4) + Math.ceil(2.6 / 2)))
  expect(reach / distance).toBeLessThanOrEqual(SCENE.view)
  expect(scenePlan({ ...project, entities: project.entities.map((entity) => ({ ...entity, flight: null })) })).toEqual(scenePlan(project))
  // A plain list says which creature flies the same way.
  const listed = scenePlanOf([{ kind: "creature", id: "ruby:ruby_wing", title: "红宝石鹰", flies: true }, { kind: "creature", id: "ruby:ruby_golem", title: "红宝石傀儡" }])
  const said = listed.place.map((step) => step.command)
  expect(said.find((command) => command.startsWith("summon ruby:ruby_wing "))).toContain("FlightRoam:8.0d")
  expect(said.find((command) => command.startsWith("summon ruby:ruby_golem "))).not.toContain("FlightRoam")
})

// ---- a creature too large for the first look the row was laid out for ----

const cube = (origin: number[], size: number[]) => ({ name: "box", origin, size })
/** A dragon-sized model: a body 3 blocks long and a wing each side 15 blocks long, folded up at rest and spread (flat) by the clip it flies with. */
const dragonModel = {
  kind: "model",
  bones: [
    { name: "body", parent: null, pivot: [0, 20, 0], rotation: [0, 0, 0], cubes: [cube([-8, 10, -24], [16, 14, 48])] },
    { name: "wing_l", parent: "body", pivot: [8, 22, 0], rotation: [0, 0, 80], cubes: [cube([8, 22, -6], [240, 1, 12])] },
    { name: "wing_r", parent: "body", pivot: [-8, 22, 0], rotation: [0, 0, -80], cubes: [cube([-248, 22, -6], [240, 1, 12])] },
  ],
  animations: [{ name: "fly", length: 1, loop: true, channels: [{ bone: "wing_l", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0, 0, -80] }, { time: 1, rotation: [0, 0, 0] }] }, { bone: "wing_r", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 0.5, rotation: [0, 0, 80] }, { time: 1, rotation: [0, 0, 0] }] }] }],
}
const GIANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const flightOf = (speed: number, turn: number) => ({ style: "soar", speed, turn, altitude: { min: 10, max: 40 }, climb: 40, bank: 30, air_share: 0.6, takeoff: { clip: null, seconds: 2 }, land: { clip: null, seconds: 2 }, clips: { fly: "fly", glide: null, hover: null } })
const giantFlier = { mod_id: "sky", blocks: [], items: [], entities: [{ id: GIANT, name: "巨龙", hitbox: { core: { width: 6, height: 8 } }, flight: flightOf(12, 60) }], workspace: { assets: [{ id: GIANT, document: dragonModel }] } }

test("a giant flier is given the room its own turn needs, and the row stands back until all of it is in the first look", () => {
  // How big it looks: the wings spread by the clip it flies with, not the folded ones it is built in.
  const looks = creatureSize(giantFlier.entities[0]!, giantFlier.workspace)!
  const folded = creatureSize({ ...giantFlier.entities[0]!, flight: null }, giantFlier.workspace)!
  expect(looks.half).toBeGreaterThan(15.5)
  expect(looks.half).toBeLessThan(17)
  expect(folded.half).toBeLessThan(looks.half / 2)
  // Speed 12 blocks a second turning 60 degrees a second flies a circle of radius 12 / (60 * pi / 180) = 11.46 blocks; kept 1.2 times as wide, inside 0.8 of the roam: 11.46 * 1.2 / 0.8 = 17.2, so 18.
  const plan = scenePlan(giantFlier)
  const summon = plan.place.map((step) => step.command).find((command) => command.startsWith("summon sky:creature_"))!
  expect(summon).toContain("FlightRoam:18.0d,")
  expect(flightRoam(turnRadius({ speed: 12, turn: 60 }))).toBe(18)
  // All of it is in the first look: from the side it and where it may fly are inside the view, and from the front its top is within the view above the eye.
  const [x, , distance] = plan.things[0]!.at
  expect((Math.abs(x) + 18 + Math.ceil(looks.half)) / distance).toBeLessThanOrEqual(SCENE.view)
  expect((looks.height - SCENE.eye) / (distance - looks.half)).toBeLessThanOrEqual(SCENE.rise)
  // ... and it is not so for the row the scene used to lay out for it (its width, the 8 blocks every flier had).
  const before = scenePlan({ ...giantFlier, workspace: undefined, entities: [{ ...giantFlier.entities[0]!, flight: { style: "soar" } }] })
  expect(distance).toBeGreaterThan(before.things[0]!.at[2])
  expect(before.place.map((step) => step.command).find((command) => command.startsWith("summon sky:creature_"))).toContain("FlightRoam:8.0d,")
  // Where it may fly is kept loaded.
  expect(plan.region[3]).toBeGreaterThanOrEqual(distance + 18)
  expect(plan.region[0]).toBeLessThanOrEqual(-18)
  expect(scenePlan(giantFlier)).toEqual(plan)
  // The most a roam may be is what the game's own generated flier keeps to: a creature that turns slowly is not given more.
  const sluggish = scenePlan({ ...giantFlier, entities: [{ ...giantFlier.entities[0]!, flight: flightOf(30, 20) }] })
  expect(sluggish.place.map((step) => step.command).find((command) => command.startsWith("summon sky:creature_"))).toContain(`FlightRoam:${FLIGHT_LIMITS.roam.max}.0d,`)
})

test("a giant that walks is set out as far back as its height needs, and its width spaces the row", () => {
  const ground = { mod_id: "sky", blocks: [], items: [], entities: [{ id: GIANT, name: "岩巨人", hitbox: { core: { width: 10, height: 14 } } }, { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "小石怪", hitbox: { core: { width: 1, height: 1 } } }] }
  const plan = scenePlan(ground)
  const [giant, small] = plan.things
  const distance = giant!.at[2]
  // 14 blocks tall, half of it 5 blocks wide: the top is within the view (0.488 of the distance above the eye) counted to the nearest side.
  expect(distance).toBe(Math.ceil((14 - SCENE.eye) / SCENE.rise + 5))
  expect((14 - SCENE.eye) / (distance - 5)).toBeLessThanOrEqual(SCENE.rise)
  expect(small!.at[2]).toBe(distance)
  // Only its height asked for more: sideways the row was already as far back as it needs.
  expect(Math.ceil((penRadius(10) + 5 + Math.abs(giant!.at[0])) / SCENE.view)).toBeLessThan(distance)
  // No flier's roam anywhere in it.
  expect(plan.place.some((step) => step.command.includes("FlightRoam"))).toBe(false)
})

test("a creature that is not large is set out exactly as before, whatever the project says of its model and its turn", () => {
  // A flier the size of an eagle, that turns inside a circle of 3 blocks, with a model a block across.
  const small = { id: GIANT, name: "小鹰", hitbox: { core: { width: 0.8, height: 0.8 } }, flight: flightOf(6, 120) }
  const model = { kind: "model", bones: [{ name: "body", parent: null, pivot: [0, 4, 0], rotation: [0, 0, 0], cubes: [cube([-4, 0, -4], [8, 8, 8])] }], animations: [] }
  const plain = { mod_id: "sky", blocks: [{ identifier: "b", name: "砖" }], items: [], entities: [{ ...small, flight: { style: "soar" } }] }
  const told = { ...plain, entities: [small], workspace: { assets: [{ id: GIANT, document: model }] } }
  expect(scenePlan(told)).toEqual(scenePlan(plain))
  expect(flightRoam(turnRadius({ speed: 6, turn: 120 }))).toBe(SCENE.roam)
  // The same without any hitbox height, and with a creature that does not fly at all.
  const walker = { mod_id: "sky", blocks: [], items: [], entities: [{ id: GIANT, name: "史莱姆", hitbox: { core: { width: 0.8 } } }] }
  expect(scenePlan({ ...walker, workspace: { assets: [{ id: GIANT, document: model }] } })).toEqual(scenePlan(walker))
  expect(roamOf({})).toBe(0)
})

// ---- a flier is in the first look: held down for it, and not woken ----

/**
 * The first look: the person stands at (0, eye, 0) and looks along +Z with the game's default view, 70° high, in a window of 16:9 (the game's own 854 x 480). Half the height is 35°, so the
 * edge is tan 35° = 0.700 over the eye line; half the width is the same times 16/9 = 1.245 (51.2°). `SCENE.view` and `SCENE.rise` are those two with 9° kept inside the edge (tan 42°, tan 26°).
 */
const EDGE = { across: (Math.tan((35 * Math.PI) / 180) * 16) / 9, up: Math.tan((35 * Math.PI) / 180) }
/** A box (its middle `x` and `z` from the person, `half` its width each side of that, `top` its height over the ground) is whole in the first look when its nearest, outermost corner is inside the edge asked. */
const inFirstLook = (box: { x: number; z: number; half: number; top: number }, edge: { across: number; up: number }) => {
  const near = box.z - box.half
  return near > 0 && (Math.abs(box.x) + box.half) / box.z <= edge.across && (box.top - SCENE.eye) / near <= edge.up
}
const KEPT = { across: SCENE.view, up: SCENE.rise }
const summonOf = (plan: ReturnType<typeof scenePlan>, mod: string) => plan.place.map((step) => step.command).find((command) => command.startsWith(`summon ${mod}:creature_`))!

test("the first look is the game's default view on a 16:9 window, and the rows keep nine degrees inside it", () => {
  expect(EDGE.up).toBeCloseTo(0.7002, 3)
  expect((Math.atan(EDGE.across) * 180) / Math.PI).toBeCloseTo(51.2, 1)
  expect(SCENE.view).toBeCloseTo(Math.tan((42 * Math.PI) / 180), 2)
  expect(SCENE.rise).toBeCloseTo(Math.tan((26 * Math.PI) / 180), 2)
  expect(KEPT.across).toBeLessThan(EDGE.across)
})

test("a flier is summoned in the mood to stay on the ground for the first look, and the others are not told", () => {
  const eagle = { kind: "creature" as const, id: "ruby:ruby_wing", title: "红宝石鹰", flies: true }
  const golem = { kind: "creature" as const, id: "ruby:ruby_golem", title: "红宝石傀儡" }
  const said = scenePlanOf([eagle, golem]).place.map((step) => step.command)
  const flier = said.find((command) => command.startsWith("summon ruby:ruby_wing "))!
  // On the ground (state 0), in the mood for the ground, for SCENE.look seconds of ticks. Before Rotation, so the roam is where it was in the command.
  expect(SCENE.look * 20).toBe(1800)
  expect(flier).toContain(`{PersistenceRequired:1b,FlightState:0,FlightMoodAir:0b,FlightMoodLeft:1800,Rotation:[180f,0f],FlightRoam:8.0d,Passengers:`)
  const walker = said.find((command) => command.startsWith("summon ruby:ruby_golem "))!
  expect(walker).not.toContain("Flight")
  expect(walker).toContain("{PersistenceRequired:1b,Rotation:[180f,0f],Passengers:")
  // A row without a flier is the plan it was: nothing about flight anywhere in it.
  expect(scenePlanOf([golem]).place.some((step) => step.command.includes("Flight"))).toBe(false)
})

test("a giant flier is whole in the first look while it is held on the ground, and the flight band it would go up to is not", () => {
  const looks = creatureSize(giantFlier.entities[0]!, giantFlier.workspace)!
  const plan = scenePlan(giantFlier)
  const dragon = plan.things.find((thing) => thing.kind === "creature")!
  const roam = flightRoam(turnRadius({ speed: 12, turn: 60 }))
  expect(summonOf(plan, "sky")).toContain("FlightMoodAir:0b")
  // Held down it walks its roam: the farthest it can be is the roam from its spot, the widest it looks the spread of its wings (half), the highest its own height; inside the view with its margin.
  const walking = { x: Math.abs(dragon.at[0]) + roam, z: dragon.at[2], half: looks.half, top: looks.height }
  expect(inFirstLook(walking, KEPT)).toBe(true)
  expect(inFirstLook(walking, EDGE)).toBe(true)
  // The band of the document (10 to 40 over the ground) is above it from where the row stands: this is what lost the wyvern.
  expect(inFirstLook({ ...walking, top: 40 + looks.height }, EDGE)).toBe(false)
  // Standing back far enough for the band would be (40 + height - eye) / rise: more than the row, and past what the game is sent (6 chunks, 96 blocks).
  expect((40 + looks.height - SCENE.eye) / SCENE.rise + looks.half).toBeGreaterThan(dragon.at[2])
})

test("a small flier is whole in the first look: its roam on the ground and its size", () => {
  const entity = { id: GIANT, name: "小鹰", hitbox: { core: { width: 0.8, height: 0.8 } }, flight: flightOf(6, 120) }
  const plan = scenePlan({ mod_id: "sky", blocks: [{ identifier: "b", name: "砖" }], items: [], entities: [entity] })
  const eagle = plan.things.find((thing) => thing.kind === "creature")!
  expect(summonOf(plan, "sky")).toContain(`FlightMoodLeft:${SCENE.look * 20},Rotation:[180f,0f],FlightRoam:${SCENE.roam}.0d,`)
  expect(inFirstLook({ x: Math.abs(eagle.at[0]) + SCENE.roam, z: eagle.at[2], half: 1, top: 0.8 }, KEPT)).toBe(true)
})

test("a boss that flies and sleeps is set out beyond the reach of its roam from where it wakes", () => {
  const wake = 32
  const flying = { kind: "creature" as const, id: "ruby:ruby_wing", title: "红宝石鹰", flies: true, wake }
  const walking = { kind: "creature" as const, id: "ruby:ruby_golem", title: "红宝石傀儡", flies: false, wake }
  const away = (entry: typeof flying) => scenePlanOf([entry]).things[0]!.at[2]
  // A walker as before: just past the distance it wakes at. A flier walks its roam too, toward the person, so the nearest edge of that has to be past it.
  expect(away(walking)).toBe(wake + 2)
  expect(away(flying)).toBe(wake + SCENE.roam + 2)
  expect(away(flying) - roamOf(flying)).toBeGreaterThan(wake)
  // One that turns wide has the bigger roam, and stands that much further back.
  const wide = { ...flying, turning: 11.46 }
  expect(roamOf(wide)).toBe(18)
  expect(away(wide)).toBe(wake + 18 + 2)
})

test("the dragon fixture as a sleeping boss: asleep beyond its roam, held on the ground, whole in the first look", () => {
  const entity = { id: GIANT, name: "熔岩飞龙", behavior: "hostile", hitbox: dragonHitbox, boss: dragonBoss, flight: dragonFlight }
  const lava = { mod_id: "lava", blocks: [{ identifier: "b", name: "砖" }], items: [{ identifier: "i", name: "剑" }], entities: [entity], workspace: { assets: [{ id: GIANT, document: { kind: "model", ...dragonDesign } }] } }
  const plan = scenePlan(lava as never)
  const dragon = plan.things.find((thing) => thing.kind === "creature")!
  const looks = creatureSize(entity as never, lava.workspace)!
  const entry = creatureEntry(lava as never, entity as never)
  const roam = roamOf(entry)
  expect(entry.wake).toBe(32)
  expect(roam).toBeGreaterThan(SCENE.roam)
  // Asleep: even at the edge of its roam nearest the person it is farther than the 32 blocks it wakes at (the game measures from its middle to the player).
  expect(Math.hypot(dragon.at[0], dragon.at[2]) - roam).toBeGreaterThan(32)
  // In the first look: all its width, its roam, its height.
  expect(looks.half).toBeGreaterThan(10)
  expect(inFirstLook({ x: Math.abs(dragon.at[0]) + roam, z: dragon.at[2], half: looks.half, top: looks.height }, KEPT)).toBe(true)
  // Held on the ground, unpenned; and the kept-loaded region reaches all it may walk.
  expect(summonOf(plan, "lava")).toContain(`FlightState:0,FlightMoodAir:0b,FlightMoodLeft:${SCENE.look * 20},Rotation:[180f,0f],FlightRoam:${roam}.0d,`)
  expect(plan.place.some((step) => step.command.startsWith("fill "))).toBe(false)
  expect(plan.region[3]).toBeGreaterThanOrEqual(dragon.at[2] + roam)
})

// broad21: the boss was beaten in the test scene; its body, its bar and its health were gone, and its name (riding it as a passenger) hung in the air at the size of a boss's.
describe("a name that rides a creature goes when the creature goes", () => {
  const plan = scenePlanOf([
    { kind: "block", id: "m:ore", title: "蓝矿" },
    { kind: "item", id: "m:gem", title: "宝石" },
    { kind: "creature", id: "m:boss", title: "守匣者", width: 1.2 },
  ])
  const commands = plan.place.map((step) => step.command)

  test("only the name that rides a creature carries the tag; the names of blocks and items stand by themselves and are never touched", () => {
    const summon = commands.find((command) => command.startsWith("summon m:boss "))!
    expect(summon).toContain(`Passengers:[{id:"minecraft:text_display",Tags:["${SCENE_RIDER_TAG}"],`)
    const alone = commands.filter((command) => command.startsWith("summon minecraft:text_display "))
    expect(alone.length).toBe(2)
    expect(alone.some((command) => command.includes(SCENE_RIDER_TAG))).toBe(false)
  })

  test("the world's rule: every tick a tagged name that rides nothing is removed, a name riding a living creature is not", () => {
    const files = SCENE_DATAPACK.files
    // The game runs this function every tick, and the pack is one the 1.21.1 game reads.
    expect(JSON.parse(files["data/minecraft/tags/function/tick.json"])).toEqual({ values: ["minemods_scene:tidy"] })
    expect(JSON.parse(files["pack.mcmeta"]).pack.pack_format).toBe(SCENE_DATAPACK.format)
    expect(SCENE_DATAPACK.format).toBe(48)
    const lines = files["data/minemods_scene/function/tidy.mcfunction"].split("\n").filter((line) => line && !line.startsWith("#"))
    // Mark the creature's names, unmark the ones that still have a vehicle, remove what is still marked: in this order and nothing else.
    expect(lines).toEqual([
      `tag @e[type=minecraft:text_display,tag=${SCENE_RIDER_TAG}] add minemods_loose`,
      "execute as @e[type=!minecraft:text_display] on passengers run tag @s remove minemods_loose",
      "kill @e[type=minecraft:text_display,tag=minemods_loose]",
    ])
    // Only the tagged names are selected anywhere: nothing the mod or the person made is in reach of the rule.
    expect(lines.filter((line) => line.startsWith("kill")).every((line) => line.includes("minecraft:text_display") && line.includes("tag=minemods_loose"))).toBe(true)
    expect(lines.some((line) => /kill @e\[(?!type=minecraft:text_display)/.test(line))).toBe(false)
  })

  test("the pack is written into the scene's world folder and only there", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "studio-scene-pack-"))
    try {
      const { writeSceneDatapack } = await import("../src/scene-run")
      await writeSceneDatapack(path.join(directory, "test_scene"))
      const base = path.join(directory, "test_scene", "datapacks", SCENE_DATAPACK.folder)
      for (const [file, text] of Object.entries(SCENE_DATAPACK.files)) expect(await readFile(path.join(base, ...file.split("/")), "utf8")).toBe(text)
      expect(await readdir(directory)).toEqual(["test_scene"])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

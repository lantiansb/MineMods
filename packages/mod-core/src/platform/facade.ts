import type { NaturalSpawn } from "./adapter"

/**
 * The facade every loader writes, `<package>.platform.StudioPlatform` and `StudioClientPlatform`: the only way the
 * common layer (and, later, gameplay code an AI writes) reaches a loader. Each loader adapter writes the same public
 * members with the same signatures; `test/platform.test.ts` compiles all three against their real class paths and
 * compares the members `javap` reads off them.
 *
 * Registration calls are made while the mod is constructed (from `StudioContent.register()` and the static fields it
 * initialises): Forge and NeoForge hand their deferred registers, listeners and packet channels to the loader then.
 *
 * StudioPlatform (both sides):
 * - `MOD_ID`, `id(String path)`: the mod's namespace and a `ResourceLocation` in it.
 * - `block(name, factory)`, `item(name, factory)`, `entity(name, factory)`, `sound(name)`: register; each returns a
 *   `Supplier` of the registered thing, valid once the game has registered it (immediately on Fabric).
 * - `attributes(type, builder)`: a creature's default attributes.
 * - `spawnEgg(name, type, shell, spots)`: its spawn egg (an item).
 * - `spawnRule(type, rule)`: where a natural spawn may place it (on the ground, below leaves).
 * - `addToTab(tab, item)`: an item into one of the game's creative tabs.
 * - `s2c(name, type, write, read)`: a server-to-client packet of the generated class `type`; the returned
 *   `StudioPlatform.Channel` sends it to one player (`sendTo`), to everyone who sees an entity (`sendTracking`), or to
 *   everyone within a radius of a point (`sendNear`).
 * - `c2s(name, type, write, read, handler)`: a client-to-server packet; `handler(player, packet)` runs on the server's
 *   main thread. The client sends it with `StudioClientPlatform.sendToServer`.
 * - `register(registryKey, name, factory)`: anything of another of the game's registries (particles, structure types…).
 * - `fuel(item, ticks)`: how long an item burns. `onUseBlock(handler)`: a player's use of a block, before the game's own.
 * - `onServerTick(tick)`: after every server tick. `onServerStarted(started)`: once a server has loaded its worlds.
 * - `onPlayerJoin(join)`: a player joined (on the server). `onEntityDeath(death)`: a living entity died on the server, with its damage source.
 * - `onUseItem(handler)`, `onUseEntity(handler)`: a player's use of the item in a hand, or of an entity, before the game's own (PASS lets it go on).
 * - `onCommands(commands)`: the server's command dispatcher, to add commands to. (These six are what gameplay code's `ProjectPlatform` needs; D 组.)
 * - `onAttack(handler)`: whether a player's melee attack on an entity goes ahead (`Attack.allow(player, target)`, false calls it off; asked on both
 *   sides before the game's own attack): Forge's and NeoForge's `AttackEntityEvent`, Fabric API's `AttackEntityCallback` (Boss 能力 14, the disarm).
 * - `mobGriefing(entity)`: whether the world lets this mob change blocks (the game rule; on Forge and NeoForge their own event, which claim mods answer). Boss 能力 15.
 * - `naturalSpawn(...)`: Fabric only, where natural spawns are code; Forge and NeoForge take them from the biome
 *   modifier files `LoaderAdapter.spawnFiles` writes, and their facade has no such member (`SpawnSource`).
 *
 * StudioClientPlatform (a player's game only; never named by code that runs on a server):
 * - `renderer(type, provider)`: how a creature is drawn.
 * - `onS2C(channel, handler)`: what a player's game does with a packet, on its main thread. `sendToServer(channel, packet)`.
 * - `keyMapping(mapping)`: a key the player can rebind under Controls.
 * - `onClientTick(tick)`: after every client tick. `onHud(hud)`: drawn over the game after the HUD, with the partial tick.
 * - `onBossBar(bar)`: asked for every boss bar the game is about to draw (`BossBar.draw(graphics, bar, top)`, `top` the line of its
 *   name): the pixels it took when it drew that bar itself (the game's is then not drawn, and the next goes below), 0 to leave it to the
 *   game. Forge and NeoForge: their `CustomizeGuiOverlayEvent.BossEventProgress`; Fabric: a mixin into the overlay calls `Hooks.bossBar`.
 * - `onReload(reload)`: after the client's resources are (re)loaded.
 * - `onCameraRoll(roll)`: degrees the view is turned about the line of sight this frame (`CameraRoll.roll(partialTick)`, added to the game's own); `onFov(fov)`: the field of view
 *   of the world (not the hand's) this frame (`Fov.fov(fov, partialTick)` from the one the game would use). Boss 能力 8's shake. Forge and NeoForge: their `ViewportEvent.ComputeCameraAngles`
 *   and `ComputeFov`; Fabric: a mixin into the camera and one into `GameRenderer.getFov` call `Hooks.cameraRoll` and `Hooks.fov`.
 *
 * The client entry `<package>.client.StudioClient.register()` is run once by the facade when the player's game sets
 * up (Fabric: its client entry point does it).
 */
export const PLATFORM_PACKAGE = "platform"
export const PLATFORM_CLASS = "StudioPlatform"
export const CLIENT_PLATFORM_CLASS = "StudioClientPlatform"

/** The source folder of a package. */
export const sourceRoot = (packageName: string) => `src/main/java/${packageName.replaceAll(".", "/")}`

/** Where the facade's two classes are written. */
export const platformPaths = (packageName: string) => ({
  common: `${sourceRoot(packageName)}/${PLATFORM_PACKAGE}/${PLATFORM_CLASS}.java`,
  client: `${sourceRoot(packageName)}/${PLATFORM_PACKAGE}/${CLIENT_PLATFORM_CLASS}.java`,
})

/**
 * A creature's natural spawn as Forge's or NeoForge's biome modifiers: one file per kind of selector, since a modifier
 * names either biomes or one tag. The ids are the ones the game uses (`minecraft:plains`, a tag as `#minecraft:is_forest`).
 */
export function biomeModifierFiles(type: "forge:add_spawns" | "neoforge:add_spawns", folder: string, input: { modId: string; entityId: string; category: "monster" | "creature"; spawn: NaturalSpawn }) {
  const spawners = { type: `${input.modId}:${input.entityId}`, weight: input.spawn.weight, minCount: input.spawn.min, maxCount: input.spawn.max }
  const selectors = [...(input.spawn.biomes.length ? [[...input.spawn.biomes]] : []), ...(input.spawn.tags ?? []).map((tag) => `#minecraft:${tag}`)]
  return Object.fromEntries(
    selectors.map((biomes, index) => [
      `src/main/resources/data/${input.modId}/${folder}/${input.entityId}_spawns${selectors.length === 1 ? "" : `_${index + 1}`}.json`,
      JSON.stringify({ type, biomes, spawners }, null, 2),
    ]),
  )
}

/** The mixin list with these classes added; the template writes `"mixins": []` and `"client": []`, Fabric's, Forge's and NeoForge's alike. */
export function addMixinClasses(text: string, mixins: { common?: readonly string[]; client?: readonly string[] }) {
  const config = JSON.parse(text) as Record<string, unknown>
  const add = (key: "mixins" | "client", names: readonly string[] | undefined) => {
    if (!names?.length) return
    const current = Array.isArray(config[key]) ? (config[key] as string[]) : []
    config[key] = [...current, ...names.filter((name) => !current.includes(name))]
  }
  add("mixins", mixins.common)
  add("client", mixins.client)
  return `${JSON.stringify(config, null, 2)}\n`
}

/** The Java imports of a list of full class names, sorted, one line each. */
export const importLines = (names: readonly string[]) => [...new Set(names)].sort().map((name) => `import ${name};`).join("\n")

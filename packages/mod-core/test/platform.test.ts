import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { FABRIC_TARGET, genTarget } from "../src/platform/target"
import { VERSION_1_20_1, VERSION_1_21_1 } from "../src/platform/version"
import { addMixinClasses, biomeModifierFiles } from "../src/platform/facade"
import { hasTargetJavac, hasTargetJavap, targetJavac, targetJavap } from "./target-javac"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const PACKAGE = "com.minemods.content_platform_probe"
/** The class path each target's facade is compiled against: Fabric with Mojang's names, Forge 1.20.1, NeoForge 1.21.1. */
const CLASSPATH = { "fabric-1.21.1": "fabric-1.21.1-official", "forge-1.20.1": "forge-1.20.1", "neoforge-1.21.1": "neoforge-1.21.1" } as const

/**
 * Code of the common layer that uses every member of the facade, written once: the same text compiles on all three
 * loaders, which is what the facade is for. A packet class with its own write and read, as the generated ones have.
 */
function probeSources(target: ReturnType<typeof genTarget>) {
  const root = `src/main/java/${PACKAGE.replaceAll(".", "/")}`
  const rl = (namespace: string, value: string) => target.version.resourceLocation(namespace, value)
  return {
    [`${root}/StudioContent.java`]: `package ${PACKAGE};

import java.util.function.Supplier;
import ${PACKAGE}.platform.StudioPlatform;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.sounds.SoundEvent;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.MobCategory;
import net.minecraft.world.entity.monster.Zombie;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;

public final class StudioContent {
    public static final Supplier<Block> BLOCK = StudioPlatform.block("probe_block", () -> new Block(BlockBehaviour.Properties.of().strength(1.0f)));
    public static final Supplier<Item> BLOCK_ITEM = StudioPlatform.item("probe_block", () -> new BlockItem(BLOCK.get(), new Item.Properties()));
    public static final Supplier<Item> ITEM = StudioPlatform.item("probe_item", () -> new Item(new Item.Properties().stacksTo(16)));
    public static final Supplier<EntityType<Zombie>> CREATURE = StudioPlatform.entity("probe", () -> EntityType.Builder.<Zombie>of(Zombie::new, MobCategory.MONSTER).sized(0.6f, 1.95f).build("probe"));
    public static final Supplier<Item> EGG = StudioPlatform.spawnEgg("probe_spawn_egg", CREATURE, 0x112233, 0x445566);
    public static final Supplier<SoundEvent> SOUND = StudioPlatform.sound("probe.roar");
    public static final StudioPlatform.Channel<Shake> SHAKE = StudioPlatform.s2c("shake", Shake.class, Shake::write, Shake::read);
    public static final StudioPlatform.Channel<Press> PRESS = StudioPlatform.c2s("press", Press.class, Press::write, Press::read, (player, press) -> player.heal(press.amount));
    public static final Supplier<ResourceLocation> STAT = StudioPlatform.register(Registries.CUSTOM_STAT, "probe_stat", () -> StudioPlatform.id("probe_stat"));

    /** A packet the other way: a player's key press. */
    public static final class Press {
        public final float amount;
        public Press(float amount) { this.amount = amount; }
        public void write(FriendlyByteBuf buffer) { buffer.writeFloat(amount); }
        public static Press read(FriendlyByteBuf buffer) { return new Press(buffer.readFloat()); }
    }
    public static final ResourceLocation WHERE = ${rl('"minecraft"', '"plains"')};

    /** A packet: what it carries and how it is written, the way the generated ones are. */
    public static final class Shake {
        public final float strength;
        public Shake(float strength) { this.strength = strength; }
        public void write(FriendlyByteBuf buffer) { buffer.writeFloat(strength); }
        public static Shake read(FriendlyByteBuf buffer) { return new Shake(buffer.readFloat()); }
    }

    public static void register() {
        StudioPlatform.attributes(CREATURE, Zombie::createAttributes);
        StudioPlatform.spawnRule(CREATURE, (type, world, reason, pos, random) -> Mob.checkMobSpawnRules(type, world, reason, pos, random));
        StudioPlatform.addToTab(CreativeModeTabs.SPAWN_EGGS, EGG);
        StudioPlatform.addToTab(CreativeModeTabs.BUILDING_BLOCKS, BLOCK_ITEM);
        StudioPlatform.fuel(ITEM, 400);
        StudioPlatform.onUseBlock((player, level, hand, hit) -> level.getBlockState(hit.getBlockPos()).is(BLOCK.get()) ? InteractionResult.SUCCESS : InteractionResult.PASS);
        // D 组: what gameplay code reaches the loader through (ProjectPlatform), each once.
        StudioPlatform.onServerStarted(server -> server.overworld().getGameTime());
        StudioPlatform.onPlayerJoin(player -> player.heal(1.0f));
        StudioPlatform.onEntityDeath((entity, source) -> source.getEntity());
        StudioPlatform.onUseItem((player, level, hand) -> player.getItemInHand(hand).is(ITEM.get()) ? InteractionResult.SUCCESS : InteractionResult.PASS);
        StudioPlatform.onUseEntity((player, level, hand, entity) -> entity instanceof Zombie ? InteractionResult.SUCCESS : InteractionResult.PASS);
        StudioPlatform.onCommands(dispatcher -> dispatcher.register(net.minecraft.commands.Commands.literal("probe").executes(context -> 1)));
        // Boss 能力 14: a player's melee attack, called off here for zombies.
        StudioPlatform.onAttack((player, target) -> !(target instanceof Zombie));
        StudioPlatform.onEntityDeath((entity, source) -> StudioPlatform.mobGriefing(entity));
        StudioPlatform.onServerTick(server -> {
            for (var level : server.getAllLevels())
                for (var player : level.players()) {
                    SHAKE.sendTo(player, new Shake(1.0f));
                    SHAKE.sendTracking(player, new Shake(0.5f));
                    SHAKE.sendNear(level, player.getX(), player.getY(), player.getZ(), 16.0, new Shake(0.25f));
                }
        });
    }
}
`,
    [`${root}/client/StudioClient.java`]: `package ${PACKAGE}.client;

import ${PACKAGE}.StudioContent;
import ${PACKAGE}.platform.StudioClientPlatform;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.renderer.entity.ZombieRenderer;

public final class StudioClient {
    public static float shaking;
    static final KeyMapping CAST = new KeyMapping("key.platform_probe.cast", 71, "key.categories.misc");

    public static void register() {
        StudioClientPlatform.renderer(StudioContent.CREATURE, ZombieRenderer::new);
        StudioClientPlatform.onS2C(StudioContent.SHAKE, shake -> shaking = shake.strength);
        StudioClientPlatform.keyMapping(CAST);
        StudioClientPlatform.onClientTick(() -> {
            shaking *= 0.9f;
            if (CAST.consumeClick()) StudioClientPlatform.sendToServer(StudioContent.PRESS, new StudioContent.Press(2.0f));
        });
        StudioClientPlatform.onHud((graphics, partialTick) -> graphics.fill(0, 0, 1, 1, 0xff000000));
        // A boss bar of the mod's own: drawn in place of the game's when the bar's name says so (the pixels it took), else left to the game (0).
        StudioClientPlatform.onBossBar((graphics, bar, top) -> {
            if (!bar.getName().getString().startsWith("probe")) return 0;
            graphics.fill(0, top, 10, top + 10, 0xff000000);
            return 12;
        });
        StudioClientPlatform.onReload(() -> shaking = 0.0f);
        StudioClientPlatform.particle(() -> net.minecraft.core.particles.ParticleTypes.FLAME, sprites -> new net.minecraft.client.particle.FlameParticle.Provider(sprites));
        // Boss 能力 8: the view turned and its field of view widened while something shakes.
        StudioClientPlatform.onCameraRoll(partialTick -> shaking * 2.0f);
        StudioClientPlatform.onFov((fov, partialTick) -> fov + shaking);
    }
}
`,
  }
}

async function writeTree(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-platform-"))
  roots.push(root)
  await Promise.all(
    Object.entries(files).map(async ([name, text]) => {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await writeFile(path.join(root, name), text)
    }),
  )
  return root
}

test("Fabric 1.21.1 stays the default target and generates by its own text; Forge and NeoForge go through the facade", () => {
  expect(FABRIC_TARGET.manifest.id).toBe("fabric-1.21.1")
  expect(FABRIC_TARGET.loader.facade).toBe(false)
  expect(FABRIC_TARGET.version).toBe(VERSION_1_21_1)
  expect(genTarget("forge-1.20.1")).toMatchObject({ loader: { kind: "forge", facade: true, spawns: { kind: "data", type: "forge:add_spawns" } }, version: { minecraft: "1.20.1", java: 17 } })
  expect(genTarget("neoforge-1.21.1")).toMatchObject({ loader: { kind: "neoforge", facade: true, spawns: { kind: "data", type: "neoforge:add_spawns" } }, version: { minecraft: "1.21.1", java: 21 } })
  // The game version each adapter maps to is the one its manifest names.
  for (const id of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"]) {
    const target = genTarget(id)
    expect(target.version.minecraft).toBe(target.manifest.minecraft.version as "1.20.1" | "1.21.1")
    expect(target.version.java).toBe(target.manifest.java.major as 17 | 21)
    expect(target.version.packFormat).toEqual(target.manifest.data.packFormat)
    expect(target.loader.modFile).toBe(`src/main/resources/${target.manifest.data.modFile}`)
  }
})

test("1.21.1 changes nothing of what the common layer writes; 1.20.1 maps its names, folders and JSON", () => {
  const java = 'import software.bernie.geckolib.animation.PlayState;\nimport software.bernie.geckolib.animation.AnimationController;\nimport software.bernie.geckolib.animatable.instance.AnimatableInstanceCache;\nvar id = ResourceLocation.fromNamespaceAndPath("a", "b");\n'
  expect(VERSION_1_21_1.rewriteJava(java)).toBe(java)
  expect(VERSION_1_20_1.rewriteJava(java)).toBe(
    'import software.bernie.geckolib.core.object.PlayState;\nimport software.bernie.geckolib.core.animation.AnimationController;\nimport software.bernie.geckolib.core.animatable.instance.AnimatableInstanceCache;\nvar id = new ResourceLocation("a", "b");\n',
  )
  expect(VERSION_1_20_1.geckolib("GeoEntity")).toBe("software.bernie.geckolib.animatable.GeoEntity")
  expect(VERSION_1_20_1.geckolib("RawAnimation")).toBe("software.bernie.geckolib.core.animation.RawAnimation")
  const shaped = JSON.stringify({ type: "minecraft:crafting_shaped", pattern: ["AA"], key: { A: { item: "m:a" } }, result: { id: "m:b", count: 2 } }, null, 2)
  const file = "src/main/resources/data/m/recipe/r.json"
  expect(VERSION_1_21_1.dataFile(file, shaped)).toEqual({ file, text: shaped })
  expect(VERSION_1_20_1.dataFile(file, shaped)).toEqual({ file: "src/main/resources/data/m/recipes/r.json", text: JSON.stringify({ type: "minecraft:crafting_shaped", pattern: ["AA"], key: { A: { item: "m:a" } }, result: { item: "m:b", count: 2 } }, null, 2) })
  const smelt = JSON.stringify({ type: "minecraft:smelting", cookingtime: 200, experience: 0, ingredient: { item: "m:a" }, result: { id: "m:b" } })
  expect(JSON.parse(VERSION_1_20_1.dataFile(file, smelt).text).result).toBe("m:b")
  const cut = JSON.stringify({ type: "minecraft:stonecutting", ingredient: { item: "m:a" }, result: { count: 2, id: "m:b" } })
  expect(JSON.parse(VERSION_1_20_1.dataFile(file, cut).text)).toEqual({ type: "minecraft:stonecutting", ingredient: { item: "m:a" }, result: "m:b", count: 2 })
  // Loot: Silk Touch in the item predicate's own list, Looting as looting_enchant.
  const loot = {
    type: "minecraft:block",
    pools: [{ rolls: 1, entries: [{ type: "minecraft:item", name: "m:a", conditions: [{ condition: "minecraft:match_tool", predicate: { predicates: { "minecraft:enchantments": [{ enchantments: "minecraft:silk_touch", levels: { min: 1 } }] } } }], functions: [{ count: { type: "minecraft:uniform", max: 1, min: 0 }, enchantment: "minecraft:looting", function: "minecraft:enchanted_count_increase" }] }] }],
  }
  const mapped = VERSION_1_20_1.dataFile("src/main/resources/data/m/loot_table/blocks/a.json", JSON.stringify(loot))
  expect(mapped.file).toBe("src/main/resources/data/m/loot_tables/blocks/a.json")
  const entry = JSON.parse(mapped.text).pools[0].entries[0]
  expect(entry.conditions[0].predicate).toEqual({ enchantments: [{ enchantment: "minecraft:silk_touch", levels: { min: 1 } }] })
  expect(entry.functions[0]).toEqual({ count: { type: "minecraft:uniform", max: 1, min: 0 }, function: "minecraft:looting_enchant" })
  // Tags move to the plural; anything outside the renamed folders, and every resource, stays where it is.
  expect(VERSION_1_20_1.dataFile("src/main/resources/data/minecraft/tags/block/mineable/pickaxe.json", "{}").file).toBe("src/main/resources/data/minecraft/tags/blocks/mineable/pickaxe.json")
  expect(VERSION_1_20_1.dataFile("src/main/resources/data/m/forge/biome_modifier/a.json", "{}").file).toBe("src/main/resources/data/m/forge/biome_modifier/a.json")
  expect(VERSION_1_20_1.dataFile("src/main/resources/assets/m/lang/en_us.json", "{}").file).toBe("src/main/resources/assets/m/lang/en_us.json")
})

test("a natural spawn is a biome modifier per selector on Forge and NeoForge, and nothing on Fabric", () => {
  const spawn = { biomes: ["minecraft:plains", "minecraft:forest"], tags: ["is_mountain"], weight: 20, min: 1, max: 3 }
  const files = genTarget("neoforge-1.21.1").loader.spawnFiles({ modId: "m", entityId: "golem", category: "monster", spawn })
  expect(Object.keys(files)).toEqual(["src/main/resources/data/m/neoforge/biome_modifier/golem_spawns_1.json", "src/main/resources/data/m/neoforge/biome_modifier/golem_spawns_2.json"])
  expect(JSON.parse(Object.values(files)[0]!)).toEqual({ type: "neoforge:add_spawns", biomes: ["minecraft:plains", "minecraft:forest"], spawners: { type: "m:golem", weight: 20, minCount: 1, maxCount: 3 } })
  expect(JSON.parse(Object.values(files)[1]!).biomes).toBe("#minecraft:is_mountain")
  expect(Object.keys(biomeModifierFiles("forge:add_spawns", "forge/biome_modifier", { modId: "m", entityId: "golem", category: "creature", spawn: { ...spawn, biomes: [] } }))).toEqual(["src/main/resources/data/m/forge/biome_modifier/golem_spawns.json"])
  expect(FABRIC_TARGET.loader.spawnFiles({ modId: "m", entityId: "golem", category: "monster", spawn })).toEqual({})
  expect(JSON.parse(addMixinClasses('{"mixins": [], "client": ["A"]}', { client: ["A", "B"], common: ["C"] }))).toEqual({ mixins: ["C"], client: ["A", "B"] })
})

for (const id of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`the facade compiles on ${id} with its real class path, and the same common code compiles against it`, async () => {
    if (!hasTargetJavac(CLASSPATH[id])) return
    const target = genTarget(id)
    const files = { ...target.loader.platformFiles({ modId: "platform_probe", packageName: PACKAGE, version: target.version }), ...probeSources(target) }
    const main = target.loader.mainClass({ modId: "platform_probe", packageName: PACKAGE, version: target.version, className: "PlatformProbeMod" })
    if (main) files[main.file] = main.source
    const root = await writeTree(files)
    const compiled = await targetJavac(CLASSPATH[id], path.join(root, "src", "main", "java"), path.join(root, "classes"))
    expect(compiled.output).not.toMatch(/error|warning/)
    expect(compiled.code).toBe(0)
  }, 120000)
}

test("the facade has the same public members on all three loaders (Fabric's natural spawn and the loaders' init aside)", async () => {
  if (!(["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const).every((id) => hasTargetJavap(CLASSPATH[id]))) return
  const members = async (id: keyof typeof CLASSPATH) => {
    const target = genTarget(id)
    const root = await writeTree({ ...target.loader.platformFiles({ modId: "platform_probe", packageName: PACKAGE, version: target.version }), ...probeSources(target) })
    const classes = path.join(root, "classes")
    const compiled = await targetJavac(CLASSPATH[id], path.join(root, "src", "main", "java"), classes)
    expect(compiled.code).toBe(0)
    const read = (name: string) =>
      targetJavap(CLASSPATH[id], classes, `${PACKAGE}.platform.${name}`)
        .split("\n")
        .map((line) => line.trim())
        // init: what the main class of Forge and NeoForge calls; naturalSpawn: Fabric's alone; onClientSetup, onRenderers, onKeys, onReloaders and onParticles: the client events Forge and NeoForge deliver.
        .filter((line) => line.startsWith("public ") && !/ (init|naturalSpawn|onClientSetup|onRenderers|onKeys|onReloaders|onParticles)\(/.test(line))
        .sort()
    return { common: read("StudioPlatform"), channel: read("StudioPlatform$Channel"), client: read("StudioClientPlatform"), hud: read("StudioClientPlatform$Hud"), bossBar: read("StudioClientPlatform$BossBar"), cameraRoll: read("StudioClientPlatform$CameraRoll"), fov: read("StudioClientPlatform$Fov") }
  }
  const fabric = await members("fabric-1.21.1")
  expect(fabric.common.length).toBeGreaterThan(10)
  // Forge 1.20.1 has no payload record (its packets are their own classes), so the record's members are compared only between Fabric and NeoForge.
  expect(await members("forge-1.20.1")).toEqual(fabric)
  expect(await members("neoforge-1.21.1")).toEqual(fabric)
}, 180000)

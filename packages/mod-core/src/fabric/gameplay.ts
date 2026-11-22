import { gameplayUsesTerrain, gameplayUsesTerrainOptions, terrainAccessor } from "../common/terrain"
import { createHash } from "node:crypto"
import { z } from "zod"
import { GAMEPLAY_API, GameplayDocumentSchema, dataFile, gameplayPackage, gameplayRoot, modPackage, sourceFile, type GameplayDocument } from "../gameplay"
import { EFFECT_RUNTIME } from "./effect"
import { stripJava } from "../gameplay-scan"
import type { GenTarget } from "../platform/adapter"
import { FABRIC_TARGET } from "../platform/target"
import { GAMEPLAY_PLATFORM_NAMES, gameplayPlatformFiles } from "./gameplay-platform"

/**
 * What gameplay adds to a generated mod: the small fixed support code every gameplay is written against
 * (`ProjectContent`, the entry interfaces, the boot classes that start each one), every gameplay's own
 * files in its own package, and the edit that lists the boot classes in fabric.mod.json. Only called when
 * a project has gameplay, so a project without any is untouched.
 */

const Input = z.strictObject({
  modId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  items: z.array(z.string()),
  blocks: z.array(z.string()),
  /**
   * Every id a creature can be read by (its model asset, its rules asset) with the creature's name in the game's registry. Several ids may name the same creature:
   * the first of them is the creature, the others are only other names for it (`ENTITIES` and `ALIASES` in the accessor).
   */
  creatures: z.array(z.strictObject({ key: z.uuid(), registry: z.string().regex(/^[a-z0-9_]+$/) })),
  gameplays: z.array(z.strictObject({ id: z.uuid(), title: z.string(), revision: z.number().int().min(1), document: GameplayDocumentSchema })),
  /** H3: the project has effects, so the accessor can show them. Absent or false: the accessor is what it always was. */
  effects: z.boolean().optional(),
  terrain: z.boolean().optional(),
})
export type GameplayCompileInput = z.input<typeof Input>

const quoted = (value: string) => JSON.stringify(value)
const set = (names: readonly string[]) => (names.length ? `Set.of(${names.map(quoted).join(", ")})` : "Set.of()")
const sha256 = (content: string) => createHash("sha256").update(content).digest("hex")

/** The accessor a gameplay reads this project's things through. It looks them up in the game's registries by name, so it does not depend on how Studio's own classes are laid out. */
export function projectContentSource(input: Pick<GameplayCompileInput, "modId" | "items" | "blocks" | "creatures" | "effects" | "terrain">, target: GenTarget = FABRIC_TARGET, terrainOptions = false) {
  // Forge and NeoForge register what the mod has once it is constructed, after gameplay has started: asked for before that, a thing is not there yet, and is said so (D 组). Fabric: as it always was.
  const early = (registry: string, what: string) => (target.loader.facade ? `\n        if (!BuiltInRegistries.${registry}.containsKey(id(${what}))) throw new IllegalStateException("Not registered yet: " + ${what} + ". Read the project's things when they are used (in an event, a goal, a rule), not while onInitialize runs.");` : "")
  // One entry for each creature, under the first id it is listed by; every other id of the same creature is only a name for it, so a walk over the creatures meets each of them once.
  const firstOf = new Map<string, string>()
  for (const creature of input.creatures) if (!firstOf.has(creature.registry)) firstOf.set(creature.registry, creature.key)
  const own = input.creatures.filter((creature) => firstOf.get(creature.registry) === creature.key)
  const aliases = input.creatures.filter((creature) => firstOf.get(creature.registry) !== creature.key)
  const table = (entries: readonly string[]) => (entries.length ? `Map.ofEntries(${entries.join(", ")})` : "Map.of()")
  const entities = table([...new Map(own.map((creature) => [creature.key, `Map.entry(${quoted(creature.key)}, ${quoted(creature.registry)})`])).values()])
  const names = table([...new Map(aliases.map((creature) => [creature.key, `Map.entry(${quoted(creature.key)}, ${quoted(firstOf.get(creature.registry)!)})`])).values()])
  return target.version.rewriteJava(`package ${gameplayRoot(input.modId)}.${GAMEPLAY_API.package};

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiPredicate;
import java.util.function.Function;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.ai.goal.Goal;
import net.minecraft.world.entity.ai.goal.GoalSelector;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Generated by MineMods Studio from this project. Gameplay code reads the project's own content through it. */
public final class ${GAMEPLAY_API.content} {
    public static final String MOD_ID = ${quoted(input.modId)};
    private static final Set<String> ITEMS = ${set(input.items)};
    private static final Set<String> BLOCKS = ${set(input.blocks)};
    /** The creatures of this project, each once: the id it is read by, and its name in the game's registry. */
    private static final Map<String, String> ENTITIES = ${entities};
    /** Other ids the same creatures are read by (a creature's rules and its model are two assets of one creature), each with the id it is another name for. Not creatures of their own. */
    private static final Map<String, String> ALIASES = ${names};
    private static final Map<String, List<AddedGoal>> GOALS = new HashMap<>();
    private static final Map<String, List<BiPredicate<PathfinderMob, LivingEntity>>> TARGET_RULES = new HashMap<>();
    private static final Map<String, ${GAMEPLAY_API.ability}> ABILITY_ACTIONS = new HashMap<>();
    private static final Set<String> ABILITY_SAID = new HashSet<>();
    private static final Logger LOGGER = LoggerFactory.getLogger(${quoted(`${input.modId}/ability`)});
    private static final Logger MOTION_LOGGER = LoggerFactory.getLogger(${quoted(`${input.modId}/motion`)});
    private static final Set<String> MOTION_SAID = new HashSet<>();

    private record AddedGoal(boolean target, int priority, Function<PathfinderMob, Goal> factory) {}

    /**
     * What a flying creature of this project answers to. Studio's generated fliers implement it; gameplay code
     * does not use it directly, it calls flyTo, isFlying and land below.
     */
    public interface StudioFlier {
        void studioFlyTo(double x, double y, double z);

        boolean studioFlying();

        void studioLand();
    }

    /**
     * What a generated creature of this project answers to when gameplay code asks it to play a motion. Gameplay code
     * does not use it directly, it calls playMotion below.
     */
    public interface ${GAMEPLAY_API.actor} {
        /** True when the creature's model has this motion (it is then started, unless the creature is dead); false when it has none of that name. */
        boolean studioPlay(String motion);
    }

${input.terrain ? terrainAccessor(modPackage(input.modId), terrainOptions) : ""}    private ${GAMEPLAY_API.content}() {}

    /** An id in this mod's namespace, for things a gameplay names itself: tags, attachments, data files. */
    public static ResourceLocation id(String path) {
        return ResourceLocation.fromNamespaceAndPath(MOD_ID, path);
    }

    public static Item item(String identifier) {
        if (!ITEMS.contains(identifier)) throw new IllegalArgumentException("This project has no item " + identifier);${early("ITEM", "identifier")}
        return BuiltInRegistries.ITEM.get(id(identifier));
    }

    public static Block block(String identifier) {
        if (!BLOCKS.contains(identifier)) throw new IllegalArgumentException("This project has no block " + identifier);${early("BLOCK", "identifier")}
        return BuiltInRegistries.BLOCK.get(id(identifier));
    }

    /** The item form of one of this project's blocks. */
    public static Item blockItem(String identifier) {
        return block(identifier).asItem();
    }

    /** The registry name of the creature an id stands for, by its own id or by any other name it is read by. */
    private static String registry(String id) {
        String registry = ENTITIES.get(ALIASES.getOrDefault(id, id));
        if (registry == null) throw new IllegalArgumentException("This project has no creature " + id);
        return registry;
    }

    public static EntityType<?> entity(String id) {${early("ENTITY_TYPE", "registry(id)")}
        return BuiltInRegistries.ENTITY_TYPE.get(id(registry(id)));
    }

    public static boolean isEntity(Entity entity, String id) {
        return entity.getType() == entity(id);
    }

    /**
     * Gives every creature of one kind of this project one more goal, beside the ones it already has
     * (swim 0, fight its target 1, wander 5, look at a player 6, look around 7; lower runs first).
     * Call it once from onInitialize; the factory is asked for a fresh goal each time such a creature
     * enters a world. This is how gameplay changes what a creature does: by adding, never by clearing.
     * What it does when it is not fighting goes here; whom it fights goes through targetRule and addTargetGoal.
     */
    public static void addGoal(String id, int priority, Function<PathfinderMob, Goal> factory) {
        added(id, new AddedGoal(false, priority, factory));
    }

    /** The same for the goals that choose whom the creature is after (its target selector). */
    public static void addTargetGoal(String id, int priority, Function<PathfinderMob, Goal> factory) {
        added(id, new AddedGoal(true, priority, factory));
    }

    /**
     * Rules on whom creatures of one kind of this project may fight. Call it once from onInitialize. The
     * creature asks the rule before it picks anybody by itself, and again on every tick about whoever it is
     * after, whoever chose them: the moment the rule answers false it lets that target go, stops fighting and
     * is free for its other goals. Several rules for one kind must all answer true. Keep the rule cheap, and
     * do not change the world in it.
     */
    public static void targetRule(String id, BiPredicate<PathfinderMob, LivingEntity> rule) {
        TARGET_RULES.computeIfAbsent(registry(id), name -> new ArrayList<>()).add(rule);
    }

    /** Asked by each generated creature about whom it may fight. Gameplay code does not call it. */
    public static boolean mayTarget(PathfinderMob mob, LivingEntity candidate) {
        for (BiPredicate<PathfinderMob, LivingEntity> rule : TARGET_RULES.getOrDefault(BuiltInRegistries.ENTITY_TYPE.getKey(mob.getType()).getPath(), List.of()))
            if (!rule.test(mob, candidate)) return false;
        return true;
    }

    /**
     * Plays one of a creature's motions (the names its model has: the animation's name in the model) once, from its start, at this moment, for every player who sees the creature.
     * Call it on the server; in a player's own game it does nothing. It does not stop the creature or turn it: the motion plays over whatever the creature is doing. A creature that has no motion of that name does nothing, and the log says so once.
     */
    public static void ${GAMEPLAY_API.motionMethod}(Mob creature, String motion) {
        if (creature.level().isClientSide()) return;
        if (creature instanceof ${GAMEPLAY_API.actor} actor && actor.studioPlay(motion)) return;
        if (MOTION_SAID.add(BuiltInRegistries.ENTITY_TYPE.getKey(creature.getType()).getPath() + "/" + motion)) MOTION_LOGGER.warn("{} has no motion {}; nothing is played", BuiltInRegistries.ENTITY_TYPE.getKey(creature.getType()), motion);
    }

    /**
     * Asks a creature to be at a place now, with its feet at (x, y, z). A flying creature of this project takes
     * off if it is on the ground, flies there and stays about it (hovering or circling) for a few seconds; the
     * next flyTo replaces the request, and once it has stayed or cannot get there its own wandering goes on. It
     * is a temporary destination, not a new state: its other goals are untouched, and a creature that is
     * fighting in the air keeps fighting. Any other creature is sent along the ground (its path finder,
     * normal walking speed), which may find no way. Call it on the server: in a player's own game it does nothing.
     */
    public static void flyTo(Mob creature, double x, double y, double z) {
        if (creature.level().isClientSide()) return;
        if (creature instanceof StudioFlier flier) flier.studioFlyTo(x, y, z);
        else creature.getNavigation().moveTo(x, y, z, 1.0);
    }

    /** Whether a flying creature of this project is off the ground (taking off and landing count). False for every other creature. */
    public static boolean isFlying(Mob creature) {
        return creature instanceof StudioFlier flier && flier.studioFlying();
    }

    /** Asks a flying creature of this project to come down where it is and stay down a while. It replaces a flyTo request. Does nothing for any other creature, and in a player's own game. */
    public static void land(Mob creature) {
        if (creature.level().isClientSide()) return;
        if (creature instanceof StudioFlier flier) flier.studioLand();
    }

    /**
     * Registers what this gameplay does at the moment an ability of one of this project's creatures reaches a hit written for it (a hit of type "gameplay" in the creature's ability, naming this gameplay's
     * slug and this name). The ability itself (its motion, its wait, when it may start, its boss phase, its shake and its debris) is the creature's; only what happens at that moment is yours: the action is
     * handed the creature and the one it is fighting, on the server. Call it once per name from onInitialize; the name is the one the ability writes in "action" (lower case letters, digits and underscores),
     * and no two gameplays can register the same one. An action that throws is logged and the ability goes on, so a fault in it does not take the world down.
     */
    public static void abilityAction(String name, ${GAMEPLAY_API.ability} action) {
        if (ABILITY_ACTIONS.putIfAbsent(name, action) != null) throw new IllegalArgumentException("The ability action " + name + " is registered twice");
    }

    /** Called by each generated creature at the moment of a gameplay hit. Gameplay code does not call it. */
    public static void runAbility(String name, Mob creature, LivingEntity target) {
        if (creature.level().isClientSide()) return;
        ${GAMEPLAY_API.ability} action = ABILITY_ACTIONS.get(name);
        if (action == null) {
            if (ABILITY_SAID.add(name)) LOGGER.error("An ability asked for the action {}, which no gameplay registered; it does nothing", name);
            return;
        }
        try {
            action.run(creature, target);
        } catch (RuntimeException | LinkageError error) {
            LOGGER.error("The ability action {} failed", name, error);
        }
    }

    private static void added(String id, AddedGoal goal) {
        GOALS.computeIfAbsent(registry(id), name -> new ArrayList<>()).add(goal);
    }

    /** Called by each generated creature at the end of its own initGoals. Gameplay code does not call it. */
    public static void applyGoals(PathfinderMob mob, GoalSelector goals, GoalSelector targets) {
        for (AddedGoal goal : GOALS.getOrDefault(BuiltInRegistries.ENTITY_TYPE.getKey(mob.getType()).getPath(), List.of()))
            (goal.target() ? targets : goals).addGoal(goal.priority(), goal.factory().apply(mob));
    }
${
  input.effects
    ? `
    /**
     * Shows one of this project's effects (a small model that appears for a moment) at a place, its front
     * turned to yaw. Call it on the server; in a player's own game it does nothing and answers null. An effect
     * hurts nobody, is never saved and removes itself when its time is up.
     */
    public static Entity spawnEffect(String id, net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 pos, float yaw) {
        return spawnEffect(id, world, pos, yaw, null);
    }

    /** The same with an owner: an effect made to follow keeps its place beside the owner, and one made to end with its owner is gone when the owner is. */
    public static Entity spawnEffect(String id, net.minecraft.world.level.Level world, net.minecraft.world.phys.Vec3 pos, float yaw, Entity owner) {
        return ${modPackage(input.modId)}.entity.${EFFECT_RUNTIME.table}.spawn(id, world, pos, yaw, owner, null);
    }
`
    : ""
}}
`)
}

/** What a gameplay implements to do the one thing of an ability (see `ProjectContent.abilityAction`). */
const abilitySource = (root: string) => `package ${root}.${GAMEPLAY_API.package};

import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.Mob;

/**
 * Generated by MineMods Studio. What a gameplay does at the moment an ability of a creature of this project reaches a hit written for it. \`creature\` is the one using the ability, \`target\` the one it is
 * fighting; it runs on the server, once, at that moment of the ability's motion. Register an implementation with \`ProjectContent.abilityAction("name", ...)\` from onInitialize, a lambda or a class of your own.
 */
@FunctionalInterface
public interface ${GAMEPLAY_API.ability} {
    void run(Mob creature, LivingEntity target);
}
`

const entrySource = (root: string, name: string, method: string) => `package ${root}.${GAMEPLAY_API.package};

/** Generated by MineMods Studio. Each gameplay has one class that implements this; Studio starts it. */
public interface ${name} {
    void ${method}();
}
`

// One gameplay that throws while starting is switched off and said so in the log; the others still start.
const bootSource = (input: { modId: string; packageName: string; name: string; loader: string; entry: string; method: string; starts: { slug: string; type: string }[] }) => `package ${input.packageName};

import ${input.loader};
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Generated by MineMods Studio: starts every gameplay of this mod, each on its own. */
public final class ${input.name} implements ${input.loader.split(".").at(-1)} {
    private static final Logger LOGGER = LoggerFactory.getLogger(${quoted(`${input.modId}/gameplay`)});

    @Override public void ${input.method}() {
${input.starts.map((start) => `        start(${quoted(start.slug)}, ${start.type}::new);`).join("\n")}
    }

    // The entry is created inside the try as well: a static field or a constructor of its own that throws switches that one gameplay off, not the game.
    private static void start(String name, java.util.function.Supplier<${input.entry}> entry) {
        try {
            entry.get().${input.method}();
        } catch (RuntimeException | LinkageError error) {
            LOGGER.error("Gameplay {} failed to start and is switched off", name, error);
        }
    }
}
`

/**
 * Forge and NeoForge: the same start of every gameplay, from the common entry (`StudioContent.register()`, while the mod is constructed) and the
 * client entry (`StudioClient.register()`, once when the player's game sets up), instead of a loader's entry point.
 */
const facadeBootSource = (input: { modId: string; packageName: string; name: string; entry: string; method: string; starts: { slug: string; type: string }[]; from: string }) => `package ${input.packageName};

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Generated by MineMods Studio: starts every gameplay of this mod, each on its own. ${input.from} */
public final class ${input.name} {
    private static final Logger LOGGER = LoggerFactory.getLogger(${quoted(`${input.modId}/gameplay`)});

    private ${input.name}() {}

    public static void register() {
${input.starts.map((start) => `        start(${quoted(start.slug)}, ${start.type}::new);`).join("\n")}
    }

    // The entry is created inside the try as well: a static field or a constructor of its own that throws switches that one gameplay off, not the game.
    private static void start(String name, java.util.function.Supplier<${input.entry}> entry) {
        try {
            entry.get().${input.method}();
        } catch (RuntimeException | LinkageError error) {
            LOGGER.error("Gameplay {} failed to start and is switched off", name, error);
        }
    }
}
`

/** Whether a gameplay's code names `ProjectPlatform` or `ProjectClient` (comments and strings aside): only then are they generated into a Fabric mod. */
const PLATFORM_NAMED = new RegExp(`(?<![\\w$])(?:${GAMEPLAY_PLATFORM_NAMES.join("|")})(?![\\w$])`)
const namesPlatform = (document: GameplayDocument) => document.sources.some((file) => PLATFORM_NAMED.test(stripJava(file.content).code))

const hasClient = (document: GameplayDocument) => document.sources.some((file) => file.path === GAMEPLAY_API.client_main)

/** The support code alone, by its path in the generated project. The same for a build and for a code check. */
export function gameplaySupport(input: Pick<GameplayCompileInput, "modId" | "items" | "blocks" | "creatures" | "effects" | "terrain"> & { gameplays: readonly { document: GameplayDocument }[] }, target: GenTarget = FABRIC_TARGET) {
  const root = gameplayRoot(input.modId)
  const folder = `src/main/java/${root.replaceAll(".", "/")}/${GAMEPLAY_API.package}`
  // Sorted by slug so the order gameplay starts in does not depend on the order assets were saved in.
  const documents = input.gameplays.map((gameplay) => gameplay.document).sort((left, right) => left.slug.localeCompare(right.slug))
  const client = documents.filter(hasClient)
  const api = `${root}.${GAMEPLAY_API.package}`
  const facade = target.loader.facade
  const starts = documents.map((document) => ({ slug: document.slug, type: `${gameplayPackage(input.modId, document.slug)}.Main` }))
  const clientStarts = client.map((document) => ({ slug: document.slug, type: `${gameplayPackage(input.modId, document.slug)}.client.ClientMain` }))
  return {
    main: `${api}.${GAMEPLAY_API.boot}`,
    client: client.length ? `${api}.client.${GAMEPLAY_API.client_boot}` : null,
    /** Every class the boot code creates with `new`, with the interface it calls it through. */
    created: [
      ...documents.map((document) => ({ class: `${gameplayPackage(input.modId, document.slug)}.Main`, implements: `${api}.${GAMEPLAY_API.entry}` })),
      ...client.map((document) => ({ class: `${gameplayPackage(input.modId, document.slug)}.client.ClientMain`, implements: `${api}.${GAMEPLAY_API.client_entry}` })),
    ],
    files: {
      [`${folder}/${GAMEPLAY_API.content}.java`]: projectContentSource({ ...input, terrain: input.terrain ?? (gameplayUsesTerrain(documents) || gameplayUsesTerrainOptions(documents)) }, target, gameplayUsesTerrainOptions(documents)),
      [`${folder}/${GAMEPLAY_API.ability}.java`]: abilitySource(root),
      [`${folder}/${GAMEPLAY_API.entry}.java`]: entrySource(root, GAMEPLAY_API.entry, "onInitialize"),
      [`${folder}/${GAMEPLAY_API.client_entry}.java`]: entrySource(root, GAMEPLAY_API.client_entry, "onInitializeClient"),
      [`${folder}/${GAMEPLAY_API.boot}.java`]: facade
        ? facadeBootSource({ modId: input.modId, packageName: api, name: GAMEPLAY_API.boot, entry: GAMEPLAY_API.entry, method: "onInitialize", starts, from: "StudioContent.register() runs it while the mod is constructed." })
        : bootSource({ modId: input.modId, packageName: api, name: GAMEPLAY_API.boot, loader: "net.fabricmc.api.ModInitializer", entry: GAMEPLAY_API.entry, method: "onInitialize", starts }),
      ...(client.length
        ? {
            [`${folder}/client/${GAMEPLAY_API.client_boot}.java`]: facade
              ? facadeBootSource({ modId: input.modId, packageName: `${api}.client`, name: GAMEPLAY_API.client_boot, entry: `${api}.${GAMEPLAY_API.client_entry}`, method: "onInitializeClient", starts: clientStarts, from: "StudioClient.register() runs it once when the player's game sets up." })
              : bootSource({ modId: input.modId, packageName: `${api}.client`, name: GAMEPLAY_API.client_boot, loader: "net.fabricmc.api.ClientModInitializer", entry: `${api}.${GAMEPLAY_API.client_entry}`, method: "onInitializeClient", starts: clientStarts }),
          }
        : {}),
      // What gameplay reaches the loader through: always on Forge and NeoForge; on Fabric only when a gameplay names it, so every other Fabric mod is what it was.
      ...(facade || documents.some(namesPlatform) ? gameplayPlatformFiles(input.modId, target) : {}),
    } as Record<string, string>,
  }
}

export function compileGameplay(value: GameplayCompileInput, target: GenTarget = FABRIC_TARGET) {
  const input = Input.parse(value)
  const gameplays = [...input.gameplays].sort((left, right) => left.document.slug.localeCompare(right.document.slug))
  const twice = gameplays.find((gameplay, index) => gameplays.slice(0, index).some((earlier) => earlier.document.slug === gameplay.document.slug))
  if (twice) throw new Error(`GAMEPLAY_SLUG_CONFLICT:${twice.id}`)
  const support = gameplaySupport(input, target)
  const own = gameplays.map((gameplay) => ({
    gameplay,
    files: Object.fromEntries([
      ...gameplay.document.sources.map((file) => [sourceFile(input.modId, gameplay.document.slug, file.path), file.content] as const),
      ...gameplay.document.data.map((file) => [dataFile(file.path), file.content] as const),
    ]),
  }))
  const names = own.flatMap((entry) => Object.keys(entry.files).map((name) => name.toLowerCase()))
  const shared = names.find((name, index) => names.indexOf(name) !== index)
  if (shared) throw new Error(`GAMEPLAY_FILE_CONFLICT:${shared}`)
  const keys = gameplays.flatMap((gameplay) => Object.keys(gameplay.document.lang.zh_cn))
  const said = keys.find((key, index) => keys.indexOf(key) !== index)
  if (said) throw new Error(`GAMEPLAY_TEXT_CONFLICT:${said}`)
  const root = gameplayRoot(input.modId).replaceAll(".", "/")
  return {
    files: { ...support.files, ...Object.assign({}, ...own.map((entry) => entry.files)) } as Record<string, string>,
    language: {
      zh_cn: Object.assign({}, ...gameplays.map((gameplay) => gameplay.document.lang.zh_cn)) as Record<string, string>,
      en_us: Object.assign({}, ...gameplays.map((gameplay) => gameplay.document.lang.en_us)) as Record<string, string>,
    },
    /** For the build record: what code in this mod an AI wrote, file by file. */
    manifest: own.map((entry) => ({
      id: entry.gameplay.id,
      slug: entry.gameplay.document.slug,
      title: entry.gameplay.title,
      revision: entry.gameplay.revision,
      ai_written_code: true as const,
      package: gameplayPackage(input.modId, entry.gameplay.document.slug),
      uses: entry.gameplay.document.uses,
      files: Object.entries(entry.files).map(([path, content]) => ({ path, bytes: Buffer.byteLength(content), sha256: sha256(content) })),
    })),
    /** Every gameplay entry class the boot code creates: the build checks each can be created. */
    created: support.created,
    /** Paths inside the built jar that prove the gameplay went in. */
    classes: [`${root}/${GAMEPLAY_API.package}/${GAMEPLAY_API.boot}.class`, ...gameplays.map((gameplay) => `${root}/${gameplay.document.slug}/Main.class`)],
    /** Forge and NeoForge: the boot classes, by their full names, for the common and the client entry to run (`addEntryCalls`). Empty on Fabric, whose entry points are in fabric.mod.json. */
    entries: target.loader.facade ? { common: [support.main], client: support.client ? [support.client] : [] } : { common: [] as string[], client: [] as string[] },
    /** Edits to files the scaffold wrote: the boot classes start after Studio's own content is registered. Fabric's metadata only; a facade target has none. */
    patch: target.loader.facade ? {} : {
      "src/main/resources/fabric.mod.json": (text: string) => {
        const metadata = z.record(z.string(), z.unknown()).parse(JSON.parse(text))
        const entrypoints = z.looseObject({ main: z.array(z.string()), client: z.array(z.string()).default([]) }).parse(metadata.entrypoints)
        const client = [...entrypoints.client, ...(support.client ? [support.client] : [])]
        const edited = `${JSON.stringify({ ...metadata, entrypoints: { ...entrypoints, main: [...entrypoints.main, support.main], ...(client.length ? { client } : {}) }, custom: { ...z.record(z.string(), z.unknown()).default({}).parse(metadata.custom), "minemods:gameplay": { ai_written_code: true, units: gameplays.map((gameplay) => gameplay.document.slug) } } }, null, 2)}\n`
        return text.includes("\r\n") ? edited.replaceAll("\n", "\r\n") : edited
      },
    },
  }
}

import type { GenTarget, NaturalSpawn } from "./adapter"
import { CLIENT_PLATFORM_CLASS, PLATFORM_CLASS, PLATFORM_PACKAGE, importLines, sourceRoot } from "./facade"

export type PlatformCreatureInput = {
  modId: string
  packageName: string
  /** Its registry id (`creatureName`: its `identifier`, or `creature_<uuid without dashes>`). */
  id: string
  names: { content: string; entity: string; client: string; renderer: string }
  category: "monster" | "creature"
  /** Its collision box in blocks, and how many chunks away a player is sent it (null: the game's default). */
  size: { width: number; height: number; tracking: number | null }
  /** Its spawn egg's shell and spots, as Java hex literals. */
  egg: readonly [string, string]
  /**
   * Its natural spawn: `rule` is the Java lambda the Fabric generator writes for where a spawn may place it (the same on
   * every loader), `cap` the helper that rule calls when the spawn has a population cap (written against the facade's supplier).
   */
  spawn: { rule: string; spawn: NaturalSpawn; cap: string; dark: boolean; hostile: boolean } | null
  /** Statements its content class's `register()` runs after its own (a boss's lair registers its structure). */
  register?: readonly string[]
  /**
   * Its body (C 组): its eye height and its step height in blocks (null: the game's), and whether every player's game is sent where it is on every
   * tick (a flier). Left out: none of them, as before.
   */
  body?: { eye: number | null; step: number | null; everyTick: boolean }
}

/**
 * A creature for a facade target, from what the Fabric generator wrote for it (`fabric/entity.ts`): its class and its
 * renderer stay (they name only the game and GeckoLib) and are mapped to the target's game version; its content class
 * (the type, the attributes, the spawn egg in the spawn-egg tab, the spawn rule) and its client class (the renderer) are
 * written again against `StudioPlatform`; its data files go to the target's folders, and its natural spawn becomes the
 * loader's biome modifiers.
 */
export function platformCreature(fabricFiles: Record<string, string | Uint8Array>, target: GenTarget, input: PlatformCreatureInput) {
  const source = sourceRoot(input.packageName)
  const { names } = input
  const spawn = input.spawn
  const body = input.body
  // The creature's class with its eyes and its step where this version takes them (C 组); without either, the class as the Fabric generator wrote it.
  const entityFile = `${source}/entity/${names.entity}.java`
  if (body && (body.eye != null || body.step != null)) {
    let text = String(fabricFiles[entityFile])
    if (body.eye != null) {
      const member = target.version.body.eyeMember(body.eye, input.size.height)
      const anchor = "    public static AttributeSupplier.Builder attributes() {"
      if (member && !text.includes(anchor)) throw new Error(`EYE_HEIGHT_UNPLACED:${names.entity}`)
      text = text.replace(anchor, `${member}${anchor}`)
    }
    if (body.step != null) text = target.version.body.step(text, names.entity, body.step)
    fabricFiles = { ...fabricFiles, [entityFile]: text }
  }
  // creature-extras: its lures and its explosion in this version's members.
  fabricFiles = { ...fabricFiles, [entityFile]: target.version.creatureExtras(String(fabricFiles[entityFile]), names.entity) }
  // A flier's renderer leans the model in GeckoLib's own rotation hook, whose parameters are the GeckoLib line's.
  const rendererFile = `${source}/client/${names.renderer}.java`
  if (body?.everyTick && typeof fabricFiles[rendererFile] === "string") fabricFiles = { ...fabricFiles, [rendererFile]: target.version.body.rotations(fabricFiles[rendererFile]) }
  const contentImports = [
    `${input.packageName}.entity.${names.entity}`,
    `${input.packageName}.${PLATFORM_PACKAGE}.${PLATFORM_CLASS}`,
    "java.util.function.Supplier",
    "net.minecraft.world.entity.EntityType",
    "net.minecraft.world.entity.MobCategory",
    "net.minecraft.world.item.CreativeModeTabs",
    "net.minecraft.world.item.Item",
    ...(spawn ? ["net.minecraft.world.entity.Mob", ...(spawn.hostile ? ["net.minecraft.world.Difficulty"] : []), ...(spawn.dark ? ["net.minecraft.world.entity.monster.Monster"] : [])] : []),
  ]
  const content = `package ${input.packageName};

${importLines(contentImports)}

/** ${names.entity}'s registration (${target.manifest.id}), through the facade. */
public final class ${names.content} {
    public static final String MOD_ID = "${input.modId}";
    public static final Supplier<EntityType<${names.entity}>> CREATURE = ${PLATFORM_CLASS}.entity("${input.id}",
        () -> EntityType.Builder.of(${names.entity}::new, MobCategory.${input.category === "monster" ? "MONSTER" : "CREATURE"})
            .sized(${input.size.width.toFixed(4)}f, ${input.size.height.toFixed(4)}f)${body?.eye != null ? target.version.body.eyeBuilder(body.eye) : ""}${input.size.tracking === null ? "" : `.clientTrackingRange(${input.size.tracking})`}${body?.everyTick ? ".updateInterval(1)" : ""}.build("${input.id}"));
    public static final Supplier<Item> SPAWN_EGG = ${PLATFORM_CLASS}.spawnEgg("${input.id}_spawn_egg", CREATURE, ${input.egg[0]}, ${input.egg[1]});

${spawn?.cap ?? ""}    public static void register() {
        ${PLATFORM_CLASS}.attributes(CREATURE, ${names.entity}::attributes);
        ${PLATFORM_CLASS}.addToTab(CreativeModeTabs.SPAWN_EGGS, SPAWN_EGG);
${spawn ? `        ${PLATFORM_CLASS}.spawnRule(CREATURE, ${spawn.rule});\n` : ""}${(input.register ?? []).map((line) => `        ${line}\n`).join("")}    }
}
`
  const client = `package ${input.packageName}.client;

import ${input.packageName}.${names.content};
import ${input.packageName}.${PLATFORM_PACKAGE}.${CLIENT_PLATFORM_CLASS};

/** How ${names.entity} is drawn (${target.manifest.id}), through the facade. */
public final class ${names.client} {
    public static void register() {
        ${CLIENT_PLATFORM_CLASS}.renderer(${names.content}.CREATURE, ${names.renderer}::new);
    }
}
`
  const files: Record<string, string | Uint8Array> = {}
  for (const [name, contents] of Object.entries({ ...fabricFiles, [`${source}/${names.content}.java`]: content, [`${source}/client/${names.client}.java`]: client })) {
    if (typeof contents === "string" && name.endsWith(".java")) files[name] = target.version.rewriteJava(contents)
    else if (typeof contents === "string" && name.startsWith("src/main/resources/data/")) {
      const mapped = target.version.dataFile(name, contents)
      files[mapped.file] = mapped.text
    } else files[name] = contents
  }
  if (spawn) Object.assign(files, target.loader.spawnFiles({ modId: input.modId, entityId: input.id, category: input.category, spawn: spawn.spawn }))
  return files
}

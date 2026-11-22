import type { LoaderKind, TargetManifest } from "../target/manifest"
import type { ContentVersion } from "./content-version"
import type { OreSpread } from "./worldgen"

/**
 * The generation context: which game version and mod loader a mod is generated for. Every generator that writes
 * something that is not the same on every target takes one (`GenTarget`), defaulting to Fabric 1.21.1, so a caller
 * that passes none generates exactly what it always did.
 *
 * Three layers (plan 方案 一.2):
 * - The common layer writes the mod once, in Mojang's names and in 1.21.1's shape, and reaches the loader only through
 *   the generated facade `<package>.platform.StudioPlatform` (and `StudioClientPlatform` for what only a player's
 *   game has). It never names a loader's API.
 * - `LoaderAdapter` (Fabric, Forge, NeoForge) writes that facade, the mod's main class and metadata, and whatever the
 *   loader takes as data rather than code (Forge's and NeoForge's biome modifiers).
 * - `VersionAdapter` (1.20.1, 1.21.1) maps the common layer's 1.21.1 shape to its game version: data folders, JSON
 *   fields, renamed classes, and the few members whose signature changed.
 *
 * Fabric 1.21.1 keeps its own generator's text, byte for byte (`LoaderAdapter.facade` is false for it): the whole-file
 * hashes the tests pin say so. Its adapter still writes a facade (`platformFiles`), compiled by the tests against
 * Fabric's real class path, so the facade is held to all three loaders and the common layer can move onto it later.
 */

/** The Java version of the game: what the common layer is written for, and what it is mapped to. */
export type MinecraftLine = "1.20.1" | "1.21.1"

/** A GeckoLib class the generated code names, by its simple name. */
export type GeckoClass =
  | "GeoEntity"
  | "AnimatableInstanceCache"
  | "AnimatableManager"
  | "Animation"
  | "AnimationController"
  | "AnimationState"
  | "PlayState"
  | "RawAnimation"
  | "GeckoLibUtil"
  | "GeoModel"
  | "GeoEntityRenderer"
  | "AutoGlowingGeoLayer"

export interface VersionAdapter {
  readonly minecraft: MinecraftLine
  /** `pack.mcmeta` numbers. */
  readonly packFormat: { readonly data: number; readonly resource: number }
  /** The Java release the generated code is compiled for. */
  readonly java: 17 | 21
  /** A `ResourceLocation` from two Java expressions (string literals or variables). */
  resourceLocation(namespace: string, path: string): string
  /** The full name of a GeckoLib class of the GeckoLib line this version uses. */
  geckolib(name: GeckoClass): string
  /**
   * The last pass over every `.java` file the common layer wrote (1.21.1's shape): renamed packages and factories,
   * applied as exact replacements. 1.21.1: nothing changes.
   */
  rewriteJava(source: string): string
  /**
   * Where a data file of the common layer (written to 1.21.1's folders, `src/main/resources/data/<ns>/loot_table/…`) goes
   * in this version, with its JSON in this version's form. Null text: the file is not changed. 1.21.1: the same file.
   */
  dataFile(file: string, text: string): { file: string; text: string }
  /** Members of the generated creature class that are not written the same in every version. */
  readonly creature: {
    /** The baby's members (age, offspring, the first spawn, the scale). */
    babyMembers(entity: string): string
    /** The renderer's shadow scaled with the creature (a baby's is half), or nothing where the game does it itself. */
    rendererShadow(entity: string): string
  }
  /** What the boss runtime and a boss's lair write differently per version (B 组). */
  readonly boss: {
    /** The type of `Camera.move`'s three offsets, which the screen shake's camera mixin shadows: float in 1.21.1, double in 1.20.1. */
    readonly cameraMove: "float" | "double"
    /** What a structure type returns as its codec, from the structure's `MapCodec` expression: 1.21 takes the MapCodec, 1.20.1 a Codec. */
    structureCodec(mapCodec: string): string
    /**
     * Boss 能力 10: the colour arguments that end a call to GeckoLib's `reRender`, white at the brightness `level` (a Java float expression): one int in GeckoLib 4.8.3 / 4.9.3
     * (1.21.1, `StudioBossGlowLayer.colour`), four floats (red, green, blue, alpha) in 4.8.4 (1.20.1).
     */
    glowColour(level: string): string
  }
  /** What the abilities, their warnings, the effects and the weapon trails write differently per version (A 组). */
  readonly abilities: {
    /** GeckoLib's renderer hooks (`preRender`, `renderFinal`) after the packed light and overlay: one int colour (GeckoLib for 1.21), four floats (4.8.4 for 1.20.1). `params` declares them, `args` passes them on. */
    readonly renderColour: { readonly params: string; readonly args: string }
    /** The vanilla particles and sounds an ability may name (by their game id) that this version of the game does not have. */
    readonly lacks: { readonly particles: readonly string[]; readonly sounds: readonly string[] }
  }
  /** What a creature's body (its eyes, its step) and the plain entities beside it (its parts) write differently per version (C 组). */
  readonly body: {
    /** The type builder's call for a creature's eye height in blocks: 1.20.5+ has `.eyeHeight`; nothing where the class says it itself (`eyeMember`). */
    eyeBuilder(eye: number): string
    /** The member of a creature's class that says its eye height, or nothing where the type says it (`eyeBuilder`). */
    eyeMember(eye: number, height: number): string
    /**
     * A creature's class (the common layer's, whose attributes add `Attributes.STEP_HEIGHT`) with its step height where this version takes it:
     * 1.21.1 changes nothing; 1.20.1 has no such attribute, and sets the entity's own maxUpStep in its constructor instead.
     */
    step(source: string, entity: string, step: number): string
    /** A class that extends the game's `Entity` itself (not a living one), in this version's members. 1.21.1: nothing changes. */
    plainEntity(source: string): string
    /** A creature's renderer that turns the model in GeckoLib's `applyRotations` (a flier's lean), in the GeckoLib line of this version. 1.21.1: nothing changes. */
    rotations(source: string): string
  }
  /** What a project's blocks and items write differently per version (E 组): tools, foods, experience blocks, blocks with a shape, lucky caches. */
  readonly content: ContentVersion
  /**
   * A creature's class (the common layer's) with its lures and its explosion in this version's members (creature-extras): 1.21.1 changes nothing;
   * 1.20.1's `TemptGoal` takes an `Ingredient` (not a predicate), and a status effect is the registry's `MobEffect` (not a `Holder`).
   */
  creatureExtras(source: string, entity: string): string
}

/** Where a loader takes a creature's natural spawn from: Fabric's API in code, or a biome modifier data file of this type. */
export type SpawnSource = { readonly kind: "code" } | { readonly kind: "data"; readonly type: "forge:add_spawns" | "neoforge:add_spawns"; readonly folder: string }

/** A creature's natural spawn, as the common layer knows it (`EntityRuntimeSchema.spawn`). */
export type NaturalSpawn = { readonly biomes: readonly string[]; readonly tags?: readonly string[] | null | undefined; readonly weight: number; readonly min: number; readonly max: number }

export type PlatformInput = { readonly modId: string; readonly packageName: string; readonly version: VersionAdapter }

export interface LoaderAdapter {
  readonly kind: LoaderKind
  /**
   * Whether the mod is generated through the facade (Forge, NeoForge), or by the Fabric generator's own text, kept byte
   * for byte as it always was (Fabric).
   */
  readonly facade: boolean
  /** The file that declares the mod, under the source tree. */
  readonly modFile: string
  /** How the mod's natural spawns reach the game. */
  readonly spawns: SpawnSource
  /**
   * The generated `<package>.platform` package: `StudioPlatform` (registration, attributes, spawn eggs and rules,
   * creative tabs, server-to-client packets, server ticks) and `StudioClientPlatform` (renderers, packet handlers,
   * client ticks, the HUD), written for this loader.
   */
  platformFiles(input: PlatformInput): Record<string, string>
  /**
   * The mod's main class, which replaces the template's `{{ClassName}}.java`: it runs the common layer's
   * `StudioContent.register()` and hands the facade to the loader. Null for a loader whose metadata names entry points
   * instead (Fabric's `fabric.mod.json`).
   */
  mainClass(input: PlatformInput & { readonly className: string }): { readonly file: string; readonly source: string } | null
  /** A creature's natural spawn as data files (Forge, NeoForge); none where it is written in code (Fabric). */
  spawnFiles(input: { readonly modId: string; readonly entityId: string; readonly category: "monster" | "creature"; readonly spawn: NaturalSpawn }): Record<string, string>
  /** The mixin list the template carries, `src/main/resources/<mod id>.mixins.json`, with these classes added (by name relative to `<package>.mixin`). */
  addMixins(text: string, mixins: { readonly common?: readonly string[]; readonly client?: readonly string[] }): string
  /** E 组: an ore's placed feature added to the biomes it generates in, as data files (Forge, NeoForge); none where it is code (Fabric's `StudioWorldgen`). */
  featureFiles(input: OreSpread): Record<string, string>
  /**
   * E 组: the member of a block class (a block with a shape) that drops experience, `range` an `IntProvider` expression, when a player breaks it
   * without Silk Touch: vanilla's `spawnAfterBreak` on Fabric; Forge and NeoForge drop a block's experience from their own `getExpDrop` instead
   * (and pass `false` to `spawnAfterBreak` when a player breaks it), each with its own parameters.
   */
  blockExperience(range: string): { readonly member: string; readonly imports: readonly string[] }
}

/** A target to generate for: its manifest and the two adapters that map the common layer onto it. */
export type GenTarget = { readonly manifest: TargetManifest; readonly loader: LoaderAdapter; readonly version: VersionAdapter }

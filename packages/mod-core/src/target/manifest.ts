import { z } from "zod"

/**
 * One game version × mod loader, described as data: what to download, how to build, how the data pack is laid out,
 * how the game is installed and started. Adding a version of a loader Studio already knows is a new manifest; a new
 * loader also needs its adapter. Every address here is the official one — mirrors are rewrite rules applied by the
 * download layer, so a manifest never depends on a mirror being up, and every file is checked by its hash anyway.
 */

const sha1 = z.string().regex(/^[0-9a-f]{40}$/)
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const url = z.url()

/** A file Studio downloads and checks; at least one hash. */
export const RemoteFileSchema = z
  .strictObject({ url, sha1: sha1.optional(), sha256: sha256.optional(), size: z.int().positive().optional() })
  .refine((file) => file.sha1 || file.sha256, "A downloaded file needs a hash.")
export type RemoteFile = z.infer<typeof RemoteFileSchema>

/** A Maven artifact: the coordinate a build script names, plus the jar itself for the test scene. */
const ArtifactSchema = z.strictObject({ coordinate: z.string().min(5), repository: url, version: z.string().min(1), file: RemoteFileSchema })

export const LoaderKindSchema = z.enum(["fabric", "forge", "neoforge"])
export type LoaderKind = z.infer<typeof LoaderKindSchema>

export const ToolchainKindSchema = z.enum(["loom", "mdg-legacyforge", "mdg"])
export type ToolchainKind = z.infer<typeof ToolchainKindSchema>

export const TargetManifestSchema = z.strictObject({
  id: z.string().regex(/^(fabric|forge|neoforge)-\d+\.\d+(\.\d+)?$/),
  minecraft: z.strictObject({
    version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
    /** Mojang's version file; the client, server and asset index below are copied from it so nothing is looked up at run time. */
    metadata: RemoteFileSchema,
    client: RemoteFileSchema,
    server: RemoteFileSchema,
    assetIndex: z.strictObject({ id: z.string().min(1), file: RemoteFileSchema }),
  }),
  loader: z.strictObject({
    kind: LoaderKindSchema,
    version: z.string().min(1),
    /**
     * `libraries`: the loader's jars go straight on the class path (Fabric). `installer`: the loader's own installer
     * is run headless into the instance, with the vanilla files placed and checked by Studio first (Forge, NeoForge).
     */
    install: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("libraries") }),
      z.strictObject({ kind: z.literal("installer"), file: RemoteFileSchema }),
    ]),
  }),
  /** The Java the game and the mod run on; `alsoForBuild` lists any other the build tool needs at the same time. */
  java: z.strictObject({ major: z.int().min(17), alsoForBuild: z.array(z.int().min(17)).max(2) }),
  toolchain: z.strictObject({
    kind: ToolchainKindSchema,
    /** Gradle plugin version: Loom, or ModDevGradle (whose legacyforge plugin builds Forge 1.20.1). */
    plugin: z.string().min(1),
    gradle: z.strictObject({ version: z.string().min(1), distribution: RemoteFileSchema }),
  }),
  /** How the game's classes are named: Mojang's official names on every target (Fabric through Loom's officialMojangMappings), with Parchment's parameter names where a target has them. */
  mappings: z.strictObject({ kind: z.literal("official"), parchment: z.strictObject({ minecraft: z.string(), version: z.string() }).nullable() }),
  /**
   * `playerAnimator` (D 组): the animation library a project with cast actions bundles inside its jar, when the target has one. Fabric's is pinned in its
   * generator profile (`fabric/profile.ts`, kept there so the Fabric build is what it was); a target without it cannot build cast actions.
   */
  dependencies: z.strictObject({ geckolib: ArtifactSchema, fabricApi: ArtifactSchema.optional(), playerAnimator: ArtifactSchema.optional() }),
  /** How the data and resource packs are written for this game version. */
  data: z.strictObject({
    /** `pack.mcmeta` numbers: 1.20.1 uses 15 for both; 1.21.1 uses 48 for data, 34 for resources. */
    packFormat: z.strictObject({ data: z.int().positive(), resource: z.int().positive() }),
    /** 1.21 renamed `loot_tables`, `recipes`, `tags/items`… to the singular. */
    folders: z.enum(["plural", "singular"]),
    /** A recipe's result names its item as `item` (1.20) or `id` (1.21). */
    recipeResult: z.enum(["item", "id"]),
    /** The file that declares the mod. */
    modFile: z.enum(["fabric.mod.json", "META-INF/mods.toml", "META-INF/neoforge.mods.toml"]),
    /** Natural spawning: Fabric's API in code, or a biome modifier data file of this type. */
    spawns: z.enum(["fabric-api", "forge:add_spawns", "neoforge:add_spawns"]),
    /** Whether Mixin needs a refmap (it does when the game is obfuscated at run time). */
    refmap: z.boolean(),
  }),
  /** Whether Studio can make a mod for this target now, and if not, why (in plain words for the person). */
  ready: z.boolean(),
  why: z.string().nullable(),
  /** What has been checked in the real game, and how. */
  verification: z.strictObject({ build: z.enum(["passed", "pending"]), client: z.enum(["passed", "pending"]), server: z.enum(["passed", "pending"]) }),
})
export type TargetManifest = z.infer<typeof TargetManifestSchema>

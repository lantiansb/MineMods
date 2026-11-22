import { resolveProfile } from "../fabric/profile"
import { TargetManifestSchema, type TargetManifest } from "./manifest"

/*
 * Versions and hashes, read 2026-11-14 from:
 * - Forge 1.20.1 47.4.28 (recommended): files.minecraftforge.net promotions_slim.json; installer SHA-1 from maven.minecraftforge.net.
 * - NeoForge 21.1.266: maven.neoforged.net maven-metadata.xml; installer SHA-256 from the same Maven.
 * - ModDevGradle 2.0.148 (and its legacyforge plugin, which builds Forge 1.20.1): maven.neoforged.net.
 * - GeckoLib 4.8.4 (Forge 1.20.1) and 4.9.3 (NeoForge 1.21.1): Modrinth API; SHA-256 from dl.cloudsmith.io.
 * - Gradle 8.14.3: services.gradle.org `.sha256`.
 * - playerAnimator (cast actions, D 组): Modrinth API (project playeranimator) for what exists per loader and game version, the jar and its
 *   SHA-256 from maven.kosmx.dev, which is what Gradle downloads. NeoForge 1.21.1: 2.0.4+1.21.1 (published 2025-12-28, the same file as
 *   Modrinth's, SHA-1 05be8ddc…). Forge 1.20.1: only 1.0.2-rc1+1.20 (2023-06-14, a release candidate, Modrinth's "beta"; there is no later
 *   build for Forge 1.20.1). Kosmx's Maven and Modrinth hold two builds of the same source for it, which differ only in a generated class
 *   name of the build tool (Modrinth's SHA-1 16808f94…); the Maven one is pinned.
 * - Mojang files: piston-meta version files (`javaVersion`, `downloads`, `assetIndex`).
 * - Parchment 2023.09.03 (1.20.1) and 2024.11.17 (1.21.1): parchmentmc.org.
 * Each was built, installed and started in the real game in a separate check folder before it was written here.
 */

const fabricProfile = resolveProfile("fabric-1.21.1")
const geckolibMaven = "https://dl.cloudsmith.io/public/geckolib3/geckolib/maven/"
const mojang1211 = {
  version: "1.21.1",
  // Mojang's current 1.21.1 version file (version_manifest_v2, 2026-11-14): the asset index below is the one it names.
  // The Fabric profile pins an older publish of the same version (same client and server jars, an older asset index), kept there for the archives' lock.
  metadata: { url: "https://piston-meta.mojang.com/v1/packages/9aa86ea608c3ec777dcdc09e6c5a06c85b53599e/1.21.1.json", sha1: "9aa86ea608c3ec777dcdc09e6c5a06c85b53599e" },
  client: { url: fabricProfile.downloads.minecraftClient.url, sha1: fabricProfile.downloads.minecraftClient.sha1, size: 26836906 },
  server: { url: fabricProfile.downloads.minecraftServer.url, sha1: fabricProfile.downloads.minecraftServer.sha1, size: 51627615 },
  assetIndex: {
    id: "17",
    file: { url: "https://piston-meta.mojang.com/v1/packages/fe8483e9e95c56b261ed6ab05aa57f83d669edf1/17.json", sha1: "fe8483e9e95c56b261ed6ab05aa57f83d669edf1", size: 449757 },
  },
}
const gradle8143 = {
  version: "8.14.3",
  distribution: { url: "https://services.gradle.org/distributions/gradle-8.14.3-bin.zip", sha256: "bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531" },
}
const mdg = "2.0.148"
const kosmx = "https://maven.kosmx.dev/"
const playerAnimator = (artifact: string, version: string, sha1: string, sha256: string, size: number) => ({
  coordinate: `dev.kosmx.player-anim:${artifact}:${version}`,
  repository: kosmx,
  version,
  file: { url: `${kosmx}dev/kosmx/player-anim/${artifact}/${version}/${artifact}-${version}.jar`, sha1, sha256, size },
})

const manifests: TargetManifest[] = [
  {
    id: "fabric-1.21.1",
    minecraft: mojang1211,
    loader: { kind: "fabric", version: fabricProfile.loader, install: { kind: "libraries" } },
    java: { major: 21, alsoForBuild: [] },
    toolchain: { kind: "loom", plugin: fabricProfile.loom, gradle: { version: fabricProfile.gradle.version, distribution: fabricProfile.gradle.distribution } },
    mappings: { kind: "official", parchment: null },
    dependencies: {
      geckolib: { coordinate: fabricProfile.geckolib.coordinate, repository: fabricProfile.geckolib.repository, version: fabricProfile.geckolib.version, file: fabricProfile.geckolib.download },
      fabricApi: {
        coordinate: `net.fabricmc.fabric-api:fabric-api:${fabricProfile.fabricApi}`,
        repository: "https://maven.fabricmc.net/",
        version: fabricProfile.fabricApi,
        file: fabricProfile.downloads.fabricApi,
      },
    },
    data: { packFormat: { data: 48, resource: 34 }, folders: "singular", recipeResult: "id", modFile: "fabric.mod.json", spawns: "fabric-api", refmap: false },
    ready: true,
    why: null,
    verification: { ...fabricProfile.verification },
  },
  {
    id: "forge-1.20.1",
    minecraft: {
      version: "1.20.1",
      metadata: { url: "https://piston-meta.mojang.com/v1/packages/3ecf2cab995685d345a257326ba72192b7911250/1.20.1.json", sha1: "3ecf2cab995685d345a257326ba72192b7911250" },
      client: { url: "https://piston-data.mojang.com/v1/objects/0c3ec587af28e5a785c0b4a7b8a30f9a8f78f838/client.jar", sha1: "0c3ec587af28e5a785c0b4a7b8a30f9a8f78f838", size: 23028853 },
      server: { url: "https://piston-data.mojang.com/v1/objects/84194a2f286ef7c14ed7ce0090dba59902951553/server.jar", sha1: "84194a2f286ef7c14ed7ce0090dba59902951553", size: 47791053 },
      assetIndex: {
        id: "5",
        file: { url: "https://piston-meta.mojang.com/v1/packages/2b3aa959237269caa09ac97fc3f7eae651315696/5.json", sha1: "2b3aa959237269caa09ac97fc3f7eae651315696", size: 413267 },
      },
    },
    loader: {
      kind: "forge",
      version: "47.4.28",
      install: {
        kind: "installer",
        file: {
          url: "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar",
          sha1: "585dd6071897becaed3b09bff4c3d9559e0cbc75",
          sha256: "d615397a6b2f1e99d4b454e2db2b4ca2e94be91d5e0243c8c7e023d965db39e7",
          size: 8859760,
        },
      },
    },
    // legacyforge compiles the mod on Java 17 but makes the deobfuscated game jar on Java 21.
    java: { major: 17, alsoForBuild: [21] },
    toolchain: { kind: "mdg-legacyforge", plugin: mdg, gradle: gradle8143 },
    mappings: { kind: "official", parchment: { minecraft: "1.20.1", version: "2023.09.03" } },
    dependencies: {
      geckolib: {
        coordinate: "software.bernie.geckolib:geckolib-forge-1.20.1:4.8.4",
        repository: geckolibMaven,
        version: "4.8.4",
        file: {
          url: `${geckolibMaven}software/bernie/geckolib/geckolib-forge-1.20.1/4.8.4/geckolib-forge-1.20.1-4.8.4.jar`,
          sha256: "33765775385857e7be6dca712d37f1cf05b48d052b86a8453c93631009ea1106",
        },
      },
      playerAnimator: playerAnimator("player-animation-lib-forge", "1.0.2-rc1+1.20", "9515ed7e230bb2d092208179ad2337636b7168d7", "4a624602ba90d305a4cdcfbde07c893466ddbc0a1210b559bf607bf715626cb0", 181438),
    },
    data: { packFormat: { data: 15, resource: 15 }, folders: "plural", recipeResult: "item", modFile: "META-INF/mods.toml", spawns: "forge:add_spawns", refmap: true },
    ready: true,
    why: null,
    verification: { build: "passed", client: "passed", server: "passed" },
  },
  {
    id: "neoforge-1.21.1",
    minecraft: mojang1211,
    loader: {
      kind: "neoforge",
      version: "21.1.266",
      install: {
        kind: "installer",
        file: {
          url: "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.266/neoforge-21.1.266-installer.jar",
          sha1: "922e6c9a118144572c2afa0ad0b059671be73837",
          sha256: "4f312ec39ff935c661f4053ef398056a8f946057b04be1c1eebf0518a18b2ba2",
          size: 6992413,
        },
      },
    },
    java: { major: 21, alsoForBuild: [] },
    toolchain: { kind: "mdg", plugin: mdg, gradle: gradle8143 },
    mappings: { kind: "official", parchment: { minecraft: "1.21.1", version: "2024.11.17" } },
    dependencies: {
      geckolib: {
        coordinate: "software.bernie.geckolib:geckolib-neoforge-1.21.1:4.9.3",
        repository: geckolibMaven,
        version: "4.9.3",
        file: {
          url: `${geckolibMaven}software/bernie/geckolib/geckolib-neoforge-1.21.1/4.9.3/geckolib-neoforge-1.21.1-4.9.3.jar`,
          sha256: "20a1995e4074f387ff549e2c57ea79dd7d41ee83c6afb9dd6a6e840e592d1c47",
        },
      },
      playerAnimator: playerAnimator("player-animation-lib-forge", "2.0.4+1.21.1", "05be8ddcc78532b9a5520c718edc6c971cd0057c", "dbe5de45f5cd60c0e5e47af14e6d564534a98456e973cf670cb881f6938eee92", 203149),
    },
    data: { packFormat: { data: 48, resource: 34 }, folders: "singular", recipeResult: "id", modFile: "META-INF/neoforge.mods.toml", spawns: "neoforge:add_spawns", refmap: false },
    ready: true,
    why: null,
    verification: { build: "passed", client: "passed", server: "passed" },
  },
]

const parsed = manifests.map((manifest) => TargetManifestSchema.parse(manifest))

/** The manifests Studio knows, checked against the schema once when the module loads. */
export function listTargetManifests(): readonly TargetManifest[] {
  return parsed.map((manifest) => structuredClone(manifest))
}

export function findTargetManifest(id: string): TargetManifest | undefined {
  const found = parsed.find((manifest) => manifest.id === id)
  return found && structuredClone(found)
}

export function targetManifest(id: string): TargetManifest {
  const found = findTargetManifest(id)
  if (!found) throw new Error(`UNKNOWN_TARGET: ${id}`)
  return found
}

/**
 * What a project archive pins as its dependency lock: for Fabric 1.21.1 the generator profile it always pinned, so
 * existing archives still open; for the others their manifest.
 */
export function targetLock(id: string): unknown {
  return id === "fabric-1.21.1" ? resolveProfile(id) : targetManifest(id)
}

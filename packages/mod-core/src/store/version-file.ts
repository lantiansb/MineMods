import path from "node:path"
import type { TargetManifest } from "../target/manifest"

/**
 * Reading Mojang's version files (and the loader files that inherit from them) the way the official launcher does:
 * which libraries belong on this system, where each lies in a Maven-layout folder, how a loader's file is merged with
 * the vanilla one it names in `inheritsFrom`, and how the `${…}` placeholders in the arguments are filled in.
 * Pure functions only; the downloads and the processes are in `minecraft.ts`, `instance.ts` and `launch.ts`.
 */

export type VersionRule = { action: "allow" | "disallow"; os?: { name?: string; arch?: string; version?: string }; features?: Record<string, boolean> }
export type VersionDownload = { path?: string; sha1?: string; size?: number; url?: string }
export type VersionLibrary = { name: string; rules?: VersionRule[]; downloads?: { artifact?: VersionDownload; classifiers?: Record<string, VersionDownload> }; url?: string }
export type VersionArgument = string | { rules?: VersionRule[]; value: string | string[] }
export type VersionFile = {
  id: string
  inheritsFrom?: string
  mainClass?: string
  type?: string
  assetIndex?: { id: string; sha1: string; size?: number; url: string; totalSize?: number }
  assets?: string
  downloads?: Record<string, { sha1: string; size?: number; url: string }>
  libraries?: VersionLibrary[]
  arguments?: { game?: VersionArgument[]; jvm?: VersionArgument[] }
  javaVersion?: { majorVersion: number }
}

/** The system a launch is for. Studio starts the game on 64-bit Windows only. */
export type LaunchPlatform = { os: "windows" | "osx" | "linux"; arch: "x64" | "x86" | "arm64" }
export const WINDOWS_X64: LaunchPlatform = { os: "windows", arch: "x64" }

/**
 * The game's own rule: with rules, the last one that applies decides, and none applying means no. A rule that asks
 * for a feature (demo mode, a custom window size, quick play) never applies: Studio turns none of them on. A rule
 * for a 32-bit system never applies on 64-bit and the other way round.
 */
export function rulesAllow(rules: readonly VersionRule[] | undefined, platform: LaunchPlatform = WINDOWS_X64) {
  if (!rules?.length) return true
  let verdict = false
  for (const rule of rules) {
    if (rule.features) continue
    if (rule.os?.name && rule.os.name !== platform.os) continue
    if (rule.os?.arch && rule.os.arch !== platform.arch) continue
    verdict = rule.action === "allow"
  }
  return verdict
}

/** A Maven coordinate (`group:artifact:version[:classifier][@ext]`) as a path under a repository, with `/`. */
export function mavenPath(name: string) {
  const [coordinate, extension = "jar"] = name.split("@")
  const [group, artifact, version, classifier] = coordinate.split(":")
  if (!group || !artifact || !version || /[\\]|\.\./.test(coordinate) || !/^[A-Za-z0-9]+$/.test(extension)) throw new Error(`INVALID_MAVEN_COORDINATE: ${name}`)
  return `${group.replaceAll(".", "/")}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ""}.${extension}`
}

/** Where a library lies under a Maven-layout libraries folder: the path its download names, else the one its coordinate gives. */
export function libraryPath(library: VersionLibrary) {
  const relative = library.downloads?.artifact?.path || mavenPath(library.name)
  const normal = path.posix.normalize(relative.replaceAll("\\", "/"))
  if (normal.startsWith("../") || normal === ".." || path.posix.isAbsolute(normal) || /^[A-Za-z]:/.test(normal)) throw new Error(`UNSAFE_LIBRARY_PATH: ${relative}`)
  return normal
}

/** `group:artifact[:classifier]`: two libraries with the same key are the same thing in two versions. */
export const libraryKey = (name: string) => {
  const [group, artifact, , classifier] = name.split("@")[0].split(":")
  return `${group}:${artifact}:${classifier ?? ""}`
}

/**
 * The libraries of one version file that belong on this system. Since 1.19 the natives are ordinary jars with rules,
 * and Windows gets each three times (plain = 64-bit, `-x86`, `-arm64`) told apart by name only: the others are dropped.
 */
export function platformLibraries<L extends VersionLibrary>(version: { libraries?: readonly L[] }, platform: LaunchPlatform = WINDOWS_X64): L[] {
  return (version.libraries ?? []).filter((library) => {
    if (!rulesAllow(library.rules, platform)) return false
    const native = /:natives-([a-z]+)(?:-(x86|arm64))?$/.exec(library.name.split("@")[0])
    return !native || (native[2] ?? "x64") === platform.arch
  })
}

export type MergedVersion = {
  id: string
  /** The vanilla version this one stands on (its own id when there is none). */
  vanillaId: string
  mainClass: string
  assetIndex: NonNullable<VersionFile["assetIndex"]>
  /** Loader libraries first (they win over a vanilla library with the same key), each marked with the file that listed it. */
  libraries: (VersionLibrary & { from: "loader" | "vanilla" })[]
  jvm: VersionArgument[]
  game: VersionArgument[]
}

/**
 * A loader's version file merged with the vanilla one it inherits from, as the official launcher does: the loader's
 * main class, its libraries ahead of vanilla's (one per key), and vanilla's arguments followed by the loader's.
 */
export function mergeVersions(loader: VersionFile, vanilla?: VersionFile): MergedVersion {
  if (loader.inheritsFrom && (!vanilla || vanilla.id !== loader.inheritsFrom)) throw new Error(`VERSION_PARENT_MISSING: ${loader.inheritsFrom}`)
  const chain = vanilla && loader.inheritsFrom ? [vanilla, loader] : [loader]
  const mainClass = loader.mainClass ?? vanilla?.mainClass
  const assetIndex = loader.assetIndex ?? vanilla?.assetIndex
  if (!mainClass) throw new Error("VERSION_MAIN_CLASS_MISSING")
  if (!assetIndex) throw new Error("VERSION_ASSET_INDEX_MISSING")
  const seen = new Set<string>()
  const libraries: MergedVersion["libraries"] = []
  for (const [version, from] of chain.length === 2 ? ([[loader, "loader"], [vanilla!, "vanilla"]] as const) : ([[loader, "vanilla"]] as const)) {
    for (const library of version.libraries ?? []) {
      const key = libraryKey(library.name)
      if (seen.has(key)) continue
      seen.add(key)
      libraries.push({ ...library, from })
    }
  }
  return {
    id: loader.id,
    vanillaId: chain[0].id,
    mainClass,
    assetIndex,
    libraries,
    jvm: chain.flatMap((version) => version.arguments?.jvm ?? []),
    game: chain.flatMap((version) => version.arguments?.game ?? []),
  }
}

/**
 * The arguments that apply on this system with their `${name}` placeholders filled in. A placeholder Studio has no
 * value for is left as written, as the official launcher does.
 */
export function expandArguments(items: readonly VersionArgument[], values: Readonly<Record<string, string>>, platform: LaunchPlatform = WINDOWS_X64) {
  const out: string[] = []
  for (const item of items) {
    if (typeof item !== "string" && !rulesAllow(item.rules, platform)) continue
    const value = typeof item === "string" ? item : item.value
    for (const piece of Array.isArray(value) ? value : [value]) out.push(piece.replace(/\$\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? values[name] : whole)))
  }
  return out
}

/** The id the loader's installer gives its version file (and folder under `versions/`). */
export function loaderVersionId(manifest: Pick<TargetManifest, "minecraft" | "loader">) {
  if (manifest.loader.kind === "forge") return `${manifest.minecraft.version}-forge-${manifest.loader.version}`
  if (manifest.loader.kind === "neoforge") return `neoforge-${manifest.loader.version}`
  throw new Error(`NOT_AN_INSTALLER_LOADER: ${manifest.loader.kind}`)
}

/** The argument file the server installer writes for Windows, relative to the server folder, with `/`. */
export function serverArgsFile(manifest: Pick<TargetManifest, "minecraft" | "loader">) {
  if (manifest.loader.kind === "forge") return `libraries/net/minecraftforge/forge/${manifest.minecraft.version}-${manifest.loader.version}/win_args.txt`
  if (manifest.loader.kind === "neoforge") return `libraries/net/neoforged/neoforge/${manifest.loader.version}/win_args.txt`
  throw new Error(`NOT_AN_INSTALLER_LOADER: ${manifest.loader.kind}`)
}

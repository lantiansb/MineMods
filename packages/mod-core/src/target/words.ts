import { DEFAULT_TARGET, TargetIdSchema, type TargetId } from "./ids"
import type { LoaderKind, TargetManifest } from "./manifest"
import { listTargetManifests, targetManifest } from "./manifests"

/**
 * A target's facts in the plain words every text an AI or a person reads uses: the game version, the loader and
 * its version, the Java, how gameplay code names the game's classes, the GeckoLib it needs. All read off the
 * target's manifest, so a text never states a version the build does not use. No Node APIs.
 */
export type TargetWords = {
  id: TargetId
  /** "1.21.1" */
  minecraft: string
  /** "Fabric" · "Forge" · "NeoForge" */
  loader: string
  loaderVersion: string
  /** The loader as one installs it: "Fabric Loader 0.17.2" · "Forge 47.4.28" · "NeoForge 21.1.266". */
  loaderFull: string
  /** What gameplay code may use beside the game itself: "Fabric API" · "Forge" · "NeoForge". */
  api: string
  /** The Java the game and the mod run on. */
  java: number
  /** Every Java the build needs, the game's first: [21] · [17, 21]. */
  javas: number[]
  naming: {
    kind: "official"
    /** "Mojang 官方命名" */
    scheme: string
    /** How a name of the game is said in a sentence: "Mojang 官方名称". */
    names: string
    /** The other scheme, which no target uses any more and older gameplay code was written in: "Yarn 名称". */
    other: string
  }
  geckolib: string
  /** Fabric API's version, for a Fabric target; null for the others, which need no such library. */
  fabricApi: string | null
  /** 1.21 renamed the data folders to the singular (`loot_table`); 1.20 still has `loot_tables`. */
  folders: "plural" | "singular"
  /** "Minecraft 1.20.1 · Forge 47.4.28 · Java 17" */
  line: string
  /** "Minecraft 1.21.1、Fabric Loader 0.17.2、Java 21": the build template, as the hand-off text says it. */
  template: string
  ready: boolean
  why: string | null
}

const LOADER_NAMES: Record<LoaderKind, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge" }

const NAMING = {
  official: { kind: "official", scheme: "Mojang 官方命名", names: "Mojang 官方名称", other: "Yarn 名称" },
} as const

function wordsOf(manifest: TargetManifest): TargetWords {
  const loader = LOADER_NAMES[manifest.loader.kind]
  const loaderFull = manifest.loader.kind === "fabric" ? `Fabric Loader ${manifest.loader.version}` : `${loader} ${manifest.loader.version}`
  return {
    id: TargetIdSchema.parse(manifest.id),
    minecraft: manifest.minecraft.version,
    loader,
    loaderVersion: manifest.loader.version,
    loaderFull,
    api: manifest.loader.kind === "fabric" ? "Fabric API" : loader,
    java: manifest.java.major,
    javas: [manifest.java.major, ...manifest.java.alsoForBuild.filter((major) => major !== manifest.java.major)],
    naming: { ...NAMING[manifest.mappings.kind] },
    geckolib: manifest.dependencies.geckolib.version,
    fabricApi: manifest.dependencies.fabricApi?.version ?? null,
    folders: manifest.data.folders,
    line: `Minecraft ${manifest.minecraft.version} · ${loader} ${manifest.loader.version} · Java ${manifest.java.major}`,
    template: `Minecraft ${manifest.minecraft.version}、${loaderFull}、Java ${manifest.java.major}`,
    ready: manifest.ready,
    why: manifest.why,
  }
}

const cache = new Map<string, TargetWords>()

/** The facts of one target in plain words. Left out: the default target, the one every project had before there were others. */
export function targetWords(id: TargetId = DEFAULT_TARGET): TargetWords {
  const known = cache.get(id) ?? wordsOf(targetManifest(id))
  cache.set(id, known)
  return structuredClone(known)
}

/** The targets Studio can make a mod for now, in the manifests' order. What a text says when no project is at hand. */
export function readyTargetIds(): TargetId[] {
  return listTargetManifests()
    .filter((manifest) => manifest.ready)
    .map((manifest) => TargetIdSchema.parse(manifest.id))
}

/** The targets a text is about: a project's own when given (primary first), otherwise every ready one. */
export function targetsWords(ids?: readonly TargetId[]): TargetWords[] {
  const ready = readyTargetIds()
  return (ids?.length ? [...new Set(ids)] : ready.length ? ready : [DEFAULT_TARGET]).map((id) => targetWords(id))
}

/** Each distinct value once, in order, joined the way a Chinese sentence lists things. */
export function listed(values: readonly (string | number)[], separator = "、") {
  return [...new Set(values.map(String))].join(separator)
}

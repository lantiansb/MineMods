import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import yauzl from "yauzl"
import { measureTexture, type Picture, type WorldFamily } from "@minemods/studio-ai/texture-facts"
import { ORE_BASES } from "./data-words"
import { resolveProfile } from "./fabric/profile"
import { decodeRgbaPng } from "./png-decode"
import { scenePaths } from "./scene-run"

/**
 * The game's own pictures, for a made block or item to be looked at beside. Studio ships none of them:
 * they are read out of the game jar that Studio's own build downloaded into its own Gradle home, or the one
 * the test scene downloaded into Studio's own runtime folder, when one is there, and held in memory only. Nothing here writes a file, and nothing read here may be written
 * anywhere by a caller: the pictures go into the transient look picture and into numbers, never into the
 * project, a making record or a package. No network, and no folder but the one handed in.
 *
 * Which pictures are put beside a thing is decided from the thing's own document (what it generates in,
 * what kind of tool it is) or, failing that, as one member of each of a few of the game's own broad tags.
 * There is no list of subjects.
 */

/** `name` is the game's own name for the picture; `label` is the person's word for it, where Studio has one (the rocks a block can generate in). */
export type WorldPicture = { name: string; url: string; image: Picture; label?: string }
type Folder = "block" | "item"
/** What was read of one jar: every small square picture of blocks and items, and the game's own tags for them. */
export type WorldArt = { pictures: Record<Folder, Map<string, WorldPicture>>; tags: Record<Folder, Map<string, string[]>> }

/**
 * The largest picture read (the game's own are 16 pixels square), how many may be put beside one thing, and
 * (J2) the most pictures of its broad family that are measured: a few dozen says where the game's own lie
 * without counting the same sort many times over.
 */
export const WORLD_LIMITS = { side: 32, beside: 5, family: 48 } as const

const PICTURE = /^assets\/minecraft\/textures\/(block|item)\/([a-z0-9_]+)\.png$/
const TAG = /^data\/minecraft\/tags\/(block|item)\/([a-z0-9_]+)\.json$/
const PROBE = "assets/minecraft/textures/block/stone.png"

const opened = (file: string) => new Promise<yauzl.ZipFile | null>((resolve) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (error, zip) => resolve(error || !zip ? null : zip)))
const bytesOf = (zip: yauzl.ZipFile, entry: yauzl.Entry) =>
  new Promise<Uint8Array | null>((resolve) =>
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return resolve(null)
      const chunks: Buffer[] = []
      stream.on("data", (chunk: Buffer) => chunks.push(chunk))
      stream.on("error", () => resolve(null))
      stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))))
    }),
  )

/** Every entry of a jar whose name `wanted` accepts, read into memory. Null when the file is not an archive that can be read. */
async function entries(file: string, wanted: (name: string) => boolean) {
  const zip = await opened(file)
  if (!zip) return null
  return new Promise<Map<string, Uint8Array> | null>((resolve) => {
    const found = new Map<string, Uint8Array>()
    zip.on("error", () => resolve(null))
    zip.on("end", () => resolve(found))
    zip.on("entry", (entry: yauzl.Entry) => {
      if (!wanted(entry.fileName) || entry.uncompressedSize > 256 * 1024) return zip.readEntry()
      void bytesOf(zip, entry).then((bytes) => {
        if (bytes) found.set(entry.fileName, bytes)
        zip.readEntry()
      })
    })
    zip.readEntry()
  })
}

/** Jars under a folder, a few levels down: Loom keeps the game under its own cache, by version. */
async function jarsUnder(folder: string, depth: number): Promise<string[]> {
  const listed = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const below = depth > 0 ? await Promise.all(listed.filter((entry) => entry.isDirectory()).map((entry) => jarsUnder(path.join(folder, entry.name), depth - 1))) : []
  return [...listed.filter((entry) => entry.isFile() && /^minecraft.*\.jar$/.test(entry.name) && !entry.name.includes("sources")).map((entry) => path.join(folder, entry.name)), ...below.flat()]
}

/**
 * The game jar Studio's own build keeps under its Gradle home, or null when there is none yet (nothing was
 * ever built on this machine). Only that one folder is looked in. A merged or client jar carries the pictures.
 */
export async function findWorldJar(gradleHome: string) {
  const rank = (file: string) => (/merged/.test(path.basename(file)) ? 0 : /client/.test(path.basename(file)) ? 1 : 2)
  const jars = (await jarsUnder(path.join(gradleHome, "caches", "fabric-loom"), 8)).sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
  // One after another: the first that really holds the game's pictures.
  return jars.reduce<Promise<string | null>>(async (before, jar) => (await before) ?? ((await entries(jar, (name) => name === PROBE))?.size ? jar : null), Promise.resolve(null))
}

const profile = resolveProfile("fabric-1.21.1")

/**
 * The game's client jar the test scene keeps under Studio's runtime folder (`prepareSceneClient`), or null when it is not there
 * or is not that file. Round 18: before a first build the Gradle home holds no game, so a new person's whole first run had nothing
 * of the game's to compare with, though opening the test scene once had already brought the jar. It is taken only when its SHA-1
 * is the one the profile names for the game's client: a half-written or swapped file is never read as the game.
 */
export async function findSceneJar(runtimeDirectory: string, sha1: string = profile.downloads.minecraftClient.sha1) {
  const jar = path.join(scenePaths(runtimeDirectory, "none").clientLibraries, `minecraft-client-${profile.minecraft}.jar`)
  const bytes = await readFile(jar).catch(() => null)
  return bytes && createHash("sha1").update(bytes).digest("hex") === sha1 ? jar : null
}

/** Read the pictures and tags of one game jar into memory. Null when it cannot be read or holds none. */
export async function readWorldArt(jar: string): Promise<WorldArt | null> {
  const read = await entries(jar, (name) => PICTURE.test(name) || TAG.test(name))
  if (!read?.has(PROBE)) return null
  const art: WorldArt = { pictures: { block: new Map(), item: new Map() }, tags: { block: new Map(), item: new Map() } }
  read.forEach((bytes, name) => {
    const tag = TAG.exec(name)
    if (tag) {
      const values = (() => {
        try {
          return (JSON.parse(Buffer.from(bytes).toString("utf8")) as { values?: unknown }).values
        } catch {
          return null
        }
      })()
      if (Array.isArray(values)) art.tags[tag[1] as Folder].set(tag[2]!, values.flatMap((value) => (typeof value === "string" && value.startsWith("minecraft:") ? [value.slice("minecraft:".length)] : [])))
      return
    }
    const picture = PICTURE.exec(name)!
    const image = (() => {
      try {
        return decodeRgbaPng(bytes)
      } catch {
        return null
      }
    })()
    // A strip of frames (taller than wide) is a moving picture; one frame of it would not be what the game shows.
    if (!image || image.width !== image.height || image.width > WORLD_LIMITS.side) return
    art.pictures[picture[1] as Folder].set(picture[2]!, { name: picture[2]!, url: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, image })
  })
  return art
}

/**
 * One source of the game's pictures for the app's life: the jar is looked for at every ask (a first build may have happened since,
 * or the test scene may have been opened) and read once. `runtimeDirectory` is Studio's runtime folder, where the test scene keeps
 * its copy of the game; left out, only the Gradle home is looked in. `sha1` is what that copy must hash to (the profile's, unless a test says otherwise).
 */
export function worldSource(gradleHome: string, runtimeDirectory?: string, sha1?: string) {
  const held: { jar?: string; stamp?: number; art?: Promise<WorldArt | null> } = {}
  return async (): Promise<WorldArt | null> => {
    const jar = held.jar && (await stat(held.jar).then((found) => found.mtimeMs === held.stamp, () => false)) ? held.jar : ((await findWorldJar(gradleHome)) ?? (runtimeDirectory ? await findSceneJar(runtimeDirectory, sha1) : null))
    if (!jar) return null
    if (jar !== held.jar || !held.art) {
      held.jar = jar
      held.stamp = await stat(jar).then((found) => found.mtimeMs, () => 0)
      held.art = readWorldArt(jar)
    }
    return held.art
  }
}
export type WorldSource = ReturnType<typeof worldSource>

/**
 * The game's broad tags a thing with no context of its own is set beside: one member of each, the first
 * that has a picture. Ground, rock, wood, sand, worked stone; a gem or ingot, a blade, a tool, a fuel, a projectile, food.
 */
export const WORLD_SPREAD: Record<Folder, readonly string[]> = {
  block: ["base_stone_overworld", "dirt", "planks", "sand", "stone_bricks", "terracotta"],
  item: ["beacon_payment_items", "swords", "pickaxes", "coals", "arrows", "fishes"],
}

/** How much of a picture must be the colours of a rock for the thing to count as sitting in that rock, as the game's own ores do. */
export const SITS_IN = 0.5

const spread = (art: WorldArt, folder: Folder) => WORLD_SPREAD[folder].flatMap((tag) => (art.tags[folder].get(tag) ?? []).flatMap((name) => ((found) => (found ? [found] : []))(art.pictures[folder].get(name))).slice(0, 1))
/** Evenly spread picks from a list, the same every time. */
const some = <Value>(values: Value[], count: number) => (values.length <= count ? values : Array.from({ length: count }, (_, index) => values[Math.floor((index * values.length) / count)]!))

/** The game's own tags for what is held in the hand and swung: every kind of tool and weapon, in every material. */
export const TOOL_TAGS = ["swords", "pickaxes", "axes", "shovels", "hoes"] as const

/** Every member of some of the game's tags that has a picture, each once, in the game's own order; when there are more than `WORLD_LIMITS.family`, that many evenly spread. */
const members = (art: WorldArt, folder: Folder, tags: readonly string[]) => some([...new Set(tags.flatMap((tag) => art.tags[folder].get(tag) ?? []))].flatMap((name) => ((found) => (found ? [found] : []))(art.pictures[folder].get(name))), WORLD_LIMITS.family)

/**
 * What a block or an item is looked at beside. `inside` is the rock a generating block replaces (the wall
 * it is drawn set into); `beside` are the pictures it is compared with by eye: for a block that generates, that
 * rock and the game's own things that sit in it; for a tool, the game's own tools of its kind; otherwise the spread.
 *
 * `family` (J2) is what its measures are held against: the broad family those few are a handful of, decided
 * by the same tags and never by a list of subjects. A tool: every hand-held tool and weapon of every kind and
 * material (`TOOL_TAGS`), since a pickaxe's five nearest are one drawing in five colours. A block that
 * generates in rock: every rock a block may generate in and everything the game's ore tags name that sits in
 * one of them (each read off its picture, each measured against its own rock). Anything else: every member of
 * the broad tags the spread is one each of.
 */
export function worldNeighbours(art: WorldArt, document: { kind: "block"; generation?: { replaces: readonly string[] } | null } | { kind: "item"; tool?: { kind: string } | null }): { inside: WorldPicture | null; beside: WorldPicture[]; family: WorldFamily } {
  if (document.kind === "item") {
    const kin = document.tool ? (art.tags.item.get(`${document.tool.kind}s`) ?? []).flatMap((name) => ((found) => (found ? [found] : []))(art.pictures.item.get(name))) : []
    const tools = document.tool ? members(art, "item", TOOL_TAGS) : []
    return {
      inside: null,
      beside: some(kin.length >= 2 ? kin : spread(art, "item"), WORLD_LIMITS.beside),
      family: tools.length ? { label: "原版里所有拿在手里用的工具和武器的图标", pictures: tools } : { label: "原版里几大类物品的图标", pictures: members(art, "item", WORLD_SPREAD.item) },
    }
  }
  const rocks: Record<string, { name: string }> = ORE_BASES
  const inside = (document.generation?.replaces ?? []).flatMap((name) => ((found) => (found ? [{ ...found, ...(rocks[name] ? { label: rocks[name].name } : {}) }] : []))(art.pictures.block.get(name)))[0] ?? null
  if (!inside) return { inside: null, beside: some(spread(art, "block"), WORLD_LIMITS.beside), family: { label: "原版里几大类的方块", pictures: members(art, "block", WORLD_SPREAD.block) } }
  // The game's own tags of ores name what generates in rock; which rock each sits in is read off its picture.
  const ores = [...new Set([...art.tags.block.entries()].filter((entry) => entry[0].endsWith("_ores")).flatMap((entry) => entry[1]))].sort().flatMap((name) => ((found) => (found ? [found] : []))(art.pictures.block.get(name)))
  const sitting = ores.filter((found) => (measureTexture(found.image, inside.image).like ?? 0) >= SITS_IN)
  // Every rock a block may generate in, and each ore in the rock most of its picture is: the family of things that sit in rock.
  const grounds = Object.keys(rocks).flatMap((name) => ((found) => (found ? [found] : []))(art.pictures.block.get(name)))
  const seated = ores.flatMap((found) => {
    const best = grounds.map((ground) => ({ ground, like: measureTexture(found.image, ground.image).like ?? 0 })).reduce((most, value) => (value.like > most.like ? value : most), { ground: inside, like: 0 })
    return best.like >= SITS_IN ? [{ name: found.name, image: found.image, inside: best.ground.image }] : []
  })
  return {
    inside,
    beside: [inside, ...some(sitting.length ? sitting : spread(art, "block").filter((value) => value.name !== inside.name), WORLD_LIMITS.beside - 1)],
    family: { label: "原版里的岩石和长在岩石里的矿石", pictures: some([...grounds.map((ground) => ({ name: ground.name, image: ground.image, inside: null })), ...seated], WORLD_LIMITS.family) },
  }
}

import { createHash } from "node:crypto"
import { createServer } from "node:net"
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { gunzipSync, gzipSync, unzipSync } from "fflate"
import type { BuildResult } from "./build"
import { CRASH_MARKER, CRASH_MARKER_PATH, GAME_CRASH_CODES, parseCrashReport, type CrashSign, type GameCrash } from "./game-crash"
import { modPackage } from "./gameplay"
import { resolveProfile } from "./fabric/profile"
import { Agent, ProxyAgent, type Dispatcher } from "undici/index.js"
import { downloadVerifiedFile, ensureJava, runOwnedProcess, type RuntimeOptions } from "./runtime"
import { COUNTER_LABELS, countLine, readCounter } from "./progress-counter"
import { GRADLE_NETWORK } from "./gradle-network"
import {
  SCENE,
  SCENE_DATAPACK,
  SCENE_EXTRA,
  SCENE_MARK,
  SCENE_OPTIONS,
  SCENE_READY,
  SCENE_WORDS,
  sceneClientArgs,
  sceneClientLibraries,
  sceneLines,
  sceneLoaderLibraries,
  sceneMark,
  sceneModFacts,
  sceneMods,
  scenePlan,
  sceneReport,
  sceneSaid,
  sceneServerArgs,
  sceneServerProperties,
  type SceneAnswer,
  type ScenePlan,
  type SceneModFile,
  type SceneOs,
  type SceneReport,
  type SceneStep,
} from "./scene"

/**
 * 「测试场」 on disk and running. Everything the game needs is fetched once into Studio's own runtime folder,
 * each file held to a pinned checksum: the game's jars and the version file by the SHA-1 in the profile, the
 * game's libraries and assets by the SHA-1 the version file gives, Fabric Loader by the profile's SHA-256 and
 * what it needs by the checksums inside its own jar. No launcher is involved and nothing is read from one.
 * The game's files stay on this computer; they are never copied into a project or a mod.
 */

const profile = resolveProfile("fabric-1.21.1")
/**
 * Pinned beside the profile, not inside it: the profile is copied into every build manifest, and a build must
 * assemble exactly as it did before the test scene existed. The names the game runs under outside a
 * development environment; Fabric Loader needs them beside itself.
 */
const INTERMEDIARY = {
  url: "https://maven.fabricmc.net/net/fabricmc/intermediary/1.21.1/intermediary-1.21.1-v2.jar",
  sha256: "e8bd6a4c39e235ee2dc73063558610775c72a2572fa0c6b32915b149074012a6",
} as const
const ASSETS = "https://resources.download.minecraft.net"
/**
 * How often one file is asked for before the preparation gives up, the pause before the second try, and the longest pause.
 * Each pause doubles. Round 19's failures answered again within seconds; round 26's first run from an empty cache lost the
 * game's own 26 MB file and its three quick retries inside the same few seconds, so the whole open failed. The pauses now
 * add up to 1 + 2 + 4 + 8 + 16 = 31 s: about as long as a Wi-Fi or proxy reconnect takes. A file still failing after
 * that means the network is down, which is said to the person as that.
 */
export const SCENE_FETCH = { tries: 6, wait: 1000, longest: 16000 } as const
/** Seconds to wait before the try after `attempt`. */
export const sceneFetchPause = (attempt: number) => Math.min(SCENE_FETCH.wait * 2 ** (attempt - 1), SCENE_FETCH.longest)

export type SceneOptions = RuntimeOptions & {
  /** Replaces the network in tests: puts the file at `destination` or throws. */
  fetch?: (input: { url: string; sha1?: string; sha256?: string; destination: string }) => Promise<unknown>
  /** Replaces the game's server files in tests: a folder of jars and the server jar, as `prepareSceneServer` returns them. */
  server?: { libraries: string; gameJar: string }
  /**
   * The files are being fetched ahead of need, in the background, while the person does something else (see `SCENE_GENTLE`): few at a time. A caller that is
   * waiting for the same files joins the preparation that is running and takes it up to full speed; it never starts a second one.
   */
  gentle?: boolean
  /** Made by `preparing` and shared by everyone joined to one preparation; callers leave it out. */
  pace?: ScenePace
  /**
   * What a deploy is for, read by a Forge or NeoForge project's scene only (`scene-target.ts`): the check installs that target's server, opening the game
   * only its client. Fabric's deploy is the same for both.
   */
  purpose?: "check" | "play"
}
/** Whether a preparation still holds itself to `SCENE_GENTLE` lanes; one object per running preparation, so a late joiner can lift it for everyone. */
export type ScenePace = { gentle: boolean }
export type SceneRecord = {
  schema_version: 1
  project_id: string
  build_id: string
  revision: number
  jar_sha256: string
  /** File names in the instance's `mods`: the mod, and only what it cannot start without. */
  mods: string[]
  missing: string[]
  deployed_at: string
  checked_at?: string
  report?: SceneReport
  /** How the last opening of the game ended when it was a crash; absent after an opening that was not, and after every new deploy. Read by the hand-off to the AI. */
  crash?: GameCrash
  /** The target of a Forge or NeoForge project's scene (`scene-target.ts`); absent for Fabric's own, as every record before it. */
  target?: string
}

/** Whether a project or a record is another target's than this scene's own (Fabric 1.21.1): its scene is `scene-target.ts`. */
const otherTarget = (target: string | undefined): target is string => Boolean(target) && target !== profile.id

const os = (): SceneOs => (process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux")
const digest = async (file: string, algorithm: "sha1" | "sha256") => createHash(algorithm).update(await readFile(file)).digest("hex")
const exists = (file: string) => stat(file).then(() => true, () => false)

export const scenePaths = (runtimeDirectory: string, projectId: string) => {
  const root = path.join(runtimeDirectory, "scene", profile.id)
  const instance = path.join(runtimeDirectory, "scene", "instances", projectId)
  return {
    root,
    instance,
    game: path.join(root, "game"),
    serverLibraries: path.join(root, "server-libs"),
    clientLibraries: path.join(root, "client-libs"),
    assets: path.join(root, "assets"),
    mods: path.join(root, "mods"),
    record: path.join(instance, "scene.json"),
    log: path.join(instance, "scene-check.log"),
  }
}

/**
 * The connections every download of a preparation shares. Round 27, a first open from an empty cache: some 3,900 small files,
 * each on a connection of its own, so as many TLS handshakes (through a proxy, when there is one); the far end reset them by
 * the dozen. Kept connections are opened once and reused; at most `SCENE_POOL` to each host at a time, which is also how
 * many files are fetched at once. It lives as long as Studio does and is made again if the proxy setting changes.
 */
export const SCENE_POOL = 8
/**
 * How many finished files between two lines of the sounds-and-languages count. Every 500 of some 3,900 files was seven lines in all, and on a slow
 * network 500 files take longer than the window waits before it says a counter has stopped (`STALL_MS`): a count that only speaks that rarely
 * cannot be told from one that is stuck. Every 100 keeps the log short (about forty lines) and speaks well inside that wait unless the network delivers less than one file a second.
 */
export const SCENE_COUNT_EVERY = 100
/**
 * The same for the game's runtime libraries (some sixty files of 0.1 to 5 MB): a line every five keeps the log to a dozen lines and speaks within seconds even on a slow
 * line, far inside the wait after which the window calls a counter stuck (`STALL_MS`). Before this the whole stretch between the first line and the sounds' count said
 * nothing, and a press that joined the preparation there saw only the elapsed time and the usual range (round 21).
 */
export const SCENE_FILES_EVERY = 5
/**
 * How many files a preparation done ahead of need fetches at once: the figure the development files already use for Gradle (`GRADLE_NETWORK.workers`).
 * Each file is a connection of its own to be opened, and what the person is doing at the same time (an AI's replies over the same line) is
 * what a background download must not crowd out. One preparation at a time is the caller's rule (`prepare-ahead.ts`).
 */
export const SCENE_GENTLE = GRADLE_NETWORK.workers
/** How often a lane held back by the gentle pace looks whether the pace was lifted. */
const GENTLE_LOOK_MS = 500
/**
 * A count of files done out of a known number, said when the step begins (so the step is named at once, before its first file is in), every `every` files and at the last.
 * Only what is really done is counted; the number is the length of the list the step was given.
 */
export function counted(options: Pick<SceneOptions, "onProgress">, label: string, total: number, every = 1) {
  const done = { count: 0 }
  const say = () => options.onProgress?.(`${countLine(label, done.count, total)}\n`)
  say()
  return () => {
    if (++done.count % every === 0 || done.count === total) say()
  }
}
/** What the network answered under a failed download, as short as it was said: an error code, an HTTP status, or a message. */
const reason = (error: Error) => String(error.cause instanceof Error ? ((error.cause as Error & { code?: string }).code ?? error.cause.message) : error.message).slice(0, 120)
const pools = new Map<string, Dispatcher>()
function pool() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY ?? ""
  const kept = pools.get(proxy)
  if (kept) return kept
  const made = proxy
    ? new ProxyAgent({ uri: proxy, proxyTunnel: true, connections: SCENE_POOL, keepAliveTimeout: 30_000 })
    : new Agent({ connections: SCENE_POOL, keepAliveTimeout: 30_000 })
  pools.set(proxy, made)
  return made
}

/**
 * Which of the scene's downloads are already on this computer, so that a hint about "the first time" is only given when it is one. A file is put in place
 * only after it is whole and matches its checksum (`held`), and the last thing the client's preparation writes is the stamp that all of its sounds, languages
 * and icons are there; so the files and the stamp are evidence, a part-filled folder is not.
 * `check` is what the windowless check starts (the game's server and Fabric Loader, about 60 MB); `play` is the game itself (several hundred MB).
 */
export async function sceneReady(runtimeDirectory: string): Promise<{ check: boolean; play: boolean }> {
  const paths = scenePaths(runtimeDirectory, "none")
  const check = (await exists(path.join(paths.game, `server-${profile.minecraft}.jar`))) && (await exists(path.join(paths.serverLibraries, `fabric-loader-${profile.loader}.jar`)))
  const stamped = (await readdir(paths.assets).catch(() => [] as string[])).some((name) => name.startsWith("complete-"))
  const play = stamped && (await exists(path.join(paths.clientLibraries, `minecraft-client-${profile.minecraft}.jar`)))
  return { check, play }
}

/**
 * What Studio puts into every test scene by itself, pinned beside the profile: Fabric API and GeckoLib, the two mods a creature of Studio cannot start without. They
 * are downloaded here once and copied into each scene's instance (`deployScene`). The game's preparation fetches them too, so the first check does not.
 */
const knownMods = (modsDirectory: string): (SceneModFile & { fetch: { url: string; sha256: string } })[] => [
  { file: path.join(modsDirectory, `fabric-api-${profile.fabricApi}.jar`), ids: ["fabric-api", "fabric"], depends: [], fetch: profile.downloads.fabricApi },
  { file: path.join(modsDirectory, `geckolib-fabric-${profile.minecraft}-${profile.geckolib.version}.jar`), ids: ["geckolib"], depends: ["fabric-api"], fetch: profile.geckolib.download },
]
/** Whether the two pinned mods are already in the cache (present; each is checked against its pinned checksum when a scene takes it). */
export async function sceneModsReady(runtimeDirectory: string): Promise<boolean> {
  const found = await Promise.all(knownMods(scenePaths(runtimeDirectory, "none").mods).map((mod) => exists(mod.file)))
  return found.every(Boolean)
}

/** A file held to its checksum: kept when it is already there and right, fetched (and checked) when it is not. */
async function held(options: SceneOptions, input: { url: string; sha1?: string; sha256?: string; destination: string }) {
  const want = input.sha256 ?? input.sha1!
  if ((await exists(input.destination)) && (await digest(input.destination, input.sha256 ? "sha256" : "sha1")) === want) return input.destination
  await mkdir(path.dirname(input.destination), { recursive: true })
  const part = `${input.destination}.part-${process.pid}-${Date.now()}`
  try {
    const once = () =>
      rm(part, { force: true }).then(() =>
        options.fetch
          ? options.fetch({ ...input, destination: part })
          : downloadVerifiedFile({ ...input, destination: part, proxyUrl: process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY, dispatcher: pool(), signal: options.signal }),
      )
    // Round 19, a real first run: of some 4,000 files a few failed on the network each time and every failure ended the whole
    // preparation, so it took seven starts by hand. One file is now tried up to SCENE_FETCH.tries times, waiting a little longer
    // each time; a wrong checksum is never tried again here (the file that came is not the file that was pinned).
    const fetched = async (attempt: number): Promise<unknown> =>
      once().catch(async (error: unknown) => {
        const passing = error instanceof Error && ["DOWNLOAD_FAILED", "DOWNLOAD_TIMEOUT"].includes(error.message)
        if (!passing || attempt >= SCENE_FETCH.tries || options.signal?.aborted) throw error
        // Said as it happens, with what the network answered, so a slow first start is not a silent one and a failure can be told apart.
        options.onProgress?.(`「${path.basename(input.destination)}」这一次没下完（${reason(error)}），${sceneFetchPause(attempt) / 1000} 秒后再试（第 ${attempt + 1} 次，最多 ${SCENE_FETCH.tries} 次）。\n`)
        await (options.pause ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(sceneFetchPause(attempt))
        return fetched(attempt + 1)
      })
    await fetched(1)
      .catch((error: unknown) => {
        // Said apart from a failed download of Java or Gradle: this is the game's own files, and never the mod's fault.
        if (!(error instanceof Error && ["DOWNLOAD_FAILED", "DOWNLOAD_TIMEOUT"].includes(error.message))) throw error
        // Which file and what the network last said go with it, so the person (and whoever they ask) can tell a proxy from an outage.
        throw Object.assign(new Error("SCENE_DOWNLOAD_FAILED", { cause: error }), { detail: `「${path.basename(input.destination)}」：${reason(error)}` })
      })
    if ((await digest(part, input.sha256 ? "sha256" : "sha1")) !== want) throw new Error("DOWNLOAD_CHECKSUM_MISMATCH")
    await rm(input.destination, { force: true })
    await rename(part, input.destination)
  } finally {
    await rm(part, { force: true })
  }
  return input.destination
}

/**
 * Several at a time, in order of asking; the first failure stops the rest. With a gentle `pace` only `SCENE_GENTLE` of the lanes work; the others wait
 * and start as soon as the pace is lifted.
 */
export async function each<T>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<unknown>, pace?: ScenePace) {
  const next = { index: 0, failed: false }
  const lanes = () => (pace?.gentle ? Math.min(SCENE_GENTLE, limit) : limit)
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async (_, lane) => {
      while (next.index < items.length && !next.failed) {
        if (lane >= lanes()) {
          await new Promise((resolve) => setTimeout(resolve, GENTLE_LOOK_MS))
          continue
        }
        const index = next.index++
        await work(items[index]!, index).catch((error: unknown) => {
          next.failed = true
          throw error
        })
      }
    }),
  )
}

/**
 * One preparation of the game's files per kind and computer, however many ask for it. The person's press and the preparation done ahead of it
 * (`prepare-ahead.ts`) reach for the same files: the later one joins the one that is running (it hears its progress and waits for its end) instead of starting
 * a second download of the same files. The work stops only when everyone who asked for it has stopped asking.
 */
type Shared = { work: Promise<unknown>; listeners: Set<(text: string) => void>; people: number; stop: AbortController; pace: ScenePace; done: boolean; counter: string }
const shared = new Map<string, Shared>()
export const sceneBeingPrepared = (runtimeDirectory: string) => (["client", "server"] as const).filter((kind) => shared.has(sharedKey(kind, runtimeDirectory)))
const sharedKey = (kind: "client" | "server", runtimeDirectory: string) => `${kind}:${process.platform === "win32" ? path.resolve(runtimeDirectory).toLowerCase() : path.resolve(runtimeDirectory)}`
export async function preparing<T>(kind: "client" | "server", runtimeDirectory: string, options: SceneOptions, work: (options: SceneOptions) => Promise<T>): Promise<T> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const key = sharedKey(kind, runtimeDirectory)
  const entry = shared.get(key)
  // One that was told to stop because everyone left is let finish stopping; whoever comes now starts it afresh.
  if (entry?.stop.signal.aborted) {
    await entry.work.catch(() => undefined)
    return preparing(kind, runtimeDirectory, options, work)
  }
  const made: Shared | null = entry ? null : { work: Promise.resolve(), listeners: new Set(), people: 0, stop: new AbortController(), pace: { gentle: options.gentle === true }, done: false, counter: "" }
  if (made) shared.set(key, made)
  else if (!options.gentle) entry!.pace.gentle = false
  const joined: Shared = made ?? entry!
  joined.people++
  // Listening before the work starts: what it says first is heard by whoever started it too. Someone who comes late is told where the count stands now (the newest
  // counter line, nothing else of what was said before), so the step it joins is named for it from the first moment and not from the next file.
  if (options.onProgress) {
    if (joined.counter) options.onProgress(joined.counter)
    joined.listeners.add(options.onProgress)
  }
  if (made) {
    made.work = work({ ...options, signal: made.stop.signal, pace: made.pace, onProgress: (text) => {
      const counter = readCounter(text)
      if (counter) made.counter = `${counter.text}\n`
      made.listeners.forEach((listener) => listener(text))
    } })
    const over = () => {
      made.done = true
      if (shared.get(key) === made) shared.delete(key)
    }
    void made.work.then(over, over)
  }
  return new Promise<T>((resolve, reject) => {
    const left = { value: false }
    const leave = (finish: () => void) => {
      if (left.value) return
      left.value = true
      options.signal?.removeEventListener("abort", cancel)
      if (options.onProgress) joined.listeners.delete(options.onProgress)
      if (--joined.people === 0 && !joined.done) joined.stop.abort()
      finish()
    }
    const cancel = () => leave(() => reject(new Error("CANCELLED")))
    options.signal?.addEventListener("abort", cancel, { once: true })
    joined.work.then(
      (value) => leave(() => resolve(value as T)),
      (error: unknown) => leave(() => reject(error)),
    )
  })
}

const json = (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown
const inside = async (jar: string, wanted: (name: string) => boolean) => unzipSync(await readFile(jar), { filter: (file) => wanted(file.name) })

/** Fabric Loader, what it needs, and the names it runs the game under: the same for the check and for the person's game. */
async function loaderInto(options: SceneOptions, directory: string, side: "client" | "server") {
  const loader = await held(options, { ...profile.downloads.loader, destination: path.join(directory, `fabric-loader-${profile.loader}.jar`) })
  const installer = (await inside(loader, (name) => name === "fabric-installer.json"))["fabric-installer.json"]
  if (!installer) throw new Error("LOADER_INSTALLER_MISSING")
  const libraries = sceneLoaderLibraries(json(installer), side)
  const tick = counted(options, COUNTER_LABELS.loader, libraries.length + 1)
  await each(libraries, 4, (library) => held(options, { url: library.url, sha1: library.sha1, destination: path.join(directory, path.basename(library.path)) }).then(tick), options.pace)
  await held(options, { ...INTERMEDIARY, destination: path.join(directory, "intermediary-1.21.1-v2.jar") })
  tick()
}

/** Everything the windowless check starts: the game's server jar, Fabric Loader and what it needs. About 60 MB, once. */
export const prepareSceneServer = (runtimeDirectory: string, options: SceneOptions) =>
  preparing("server", runtimeDirectory, options, async (inner) => {
    const paths = scenePaths(runtimeDirectory, "none")
    inner.onProgress?.("准备测试场要用的游戏文件（服务器）。\n")
    await loaderInto(inner, paths.serverLibraries, "server")
    const tick = counted(inner, COUNTER_LABELS.server, 1)
    const gameJar = await held(inner, { ...profile.downloads.minecraftServer, destination: path.join(paths.game, `server-${profile.minecraft}.jar`) })
    tick()
    return { libraries: paths.serverLibraries, gameJar }
  })

/**
 * Everything the game itself starts with: its jar, its libraries for this system, its sounds, languages and
 * icons, Fabric Loader and what it needs, and the two pinned mods every scene starts with (Fabric API and GeckoLib, which `deployScene` takes from the same cache). Several
 * hundred MB the first time; what the development files of an earlier build already hold under Studio's own runtime folder is copied from there, checked the same way.
 * Each part says where it stands (a count of files done, `counted`), so whoever waits for it, or joins it late, sees the real part it is at and not only the time.
 */
export const prepareSceneClient = (runtimeDirectory: string, given: SceneOptions) =>
  preparing("client", runtimeDirectory, given, async (options) => {
    const paths = scenePaths(runtimeDirectory, "none")
    options.onProgress?.("准备测试场要用的游戏文件（游戏本体）。\n")
    // First, because they are small: the two mods every scene starts with (`knownMods`), a few MB that the first check would otherwise fetch while the person waits for it.
    const mods = knownMods(paths.mods)
    const modDone = counted(options, COUNTER_LABELS.mods, mods.length)
    await each(mods, 2, (mod) => held(options, { ...mod.fetch, destination: mod.file }).then(modDone), options.pace)
    const version = JSON.parse(await readFile(await held(options, { ...profile.downloads.minecraftMetadata, destination: path.join(paths.game, `${profile.minecraft}.json`) }), "utf8")) as { assetIndex: { id: string; sha1: string; url: string } }
    const libraries = sceneClientLibraries(version, os(), process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "x86" : "x64")
    const names = libraries.map((library) => path.basename(library.path))
    if (new Set(names).size !== names.length) throw new Error("SCENE_LIBRARY_NAMES_COLLIDE")
    const libraryDone = counted(options, COUNTER_LABELS.runtime, libraries.length, SCENE_FILES_EVERY)
    await each(libraries, 8, (library) => held(options, { url: library.url, sha1: library.sha1, destination: path.join(paths.clientLibraries, path.basename(library.path)) }).then(libraryDone), options.pace)
    await loaderInto(options, paths.clientLibraries, "client")
    const clientDone = counted(options, COUNTER_LABELS.client, 1)
    await held(options, { ...profile.downloads.minecraftClient, destination: path.join(paths.clientLibraries, `minecraft-client-${profile.minecraft}.jar`) })
    clientDone()
    const index = await held(options, { url: version.assetIndex.url, sha1: version.assetIndex.sha1, destination: path.join(paths.assets, "indexes", `${version.assetIndex.id}.json`) })
    const stamp = path.join(paths.assets, `complete-${version.assetIndex.sha1}`)
    if (!(await exists(stamp))) {
      const objects = [...new Set(Object.values((JSON.parse(await readFile(index, "utf8")) as { objects: Record<string, { hash: string }> }).objects).map((object) => object.hash))]
      const loom = path.join(runtimeDirectory, "gradle-home", "caches", "fabric-loom", "assets", "objects")
      const done = { count: 0 }
      await each(objects, SCENE_POOL, async (hash) => {
        const destination = path.join(paths.assets, "objects", hash.slice(0, 2), hash)
        const local = path.join(loom, hash.slice(0, 2), hash)
        await held(
          { ...options, fetch: (await exists(local)) && !(await exists(destination)) ? async (input) => copyFile(local, input.destination).catch(() => (options.fetch ? options.fetch(input) : downloadVerifiedFile({ ...input, proxyUrl: process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY, dispatcher: pool(), signal: options.signal }))) : options.fetch },
          { url: `${ASSETS}/${hash.slice(0, 2)}/${hash}`, sha1: hash, destination },
        )
        if (++done.count % SCENE_COUNT_EVERY === 0) options.onProgress?.(`${countLine(COUNTER_LABELS.assets, done.count, objects.length)}\n`)
      }, options.pace)
      await writeFile(stamp, "")
    }
    return { libraries: paths.clientLibraries, assets: paths.assets, assetIndex: version.assetIndex.id }
  })

/** A jar's own `fabric.mod.json`, read the way the scene reads it; null when it has none (no Fabric mod) or it is not JSON. */
export async function fabricModJson(file: string): Promise<unknown> {
  const entry = (await inside(file, (name) => name === "fabric.mod.json"))["fabric.mod.json"]
  return entry ? (() => { try { return json(entry) } catch { return null } })() : null
}

async function modFile(file: string): Promise<SceneModFile> {
  const entries = await inside(file, (name) => name === "fabric.mod.json" || /^META-INF\/jars\/[^/]+\.jar$/.test(name))
  const nested = Object.entries(entries)
    .filter(([name]) => name.endsWith(".jar"))
    .flatMap(([, bytes]) => {
      const metadata = unzipSync(bytes, { filter: (inner) => inner.name === "fabric.mod.json" })["fabric.mod.json"]
      return metadata ? [json(metadata)] : []
    })
  return sceneModFacts(file, entries["fabric.mod.json"] ? json(entries["fabric.mod.json"]) : {}, nested)
}

/**
 * Sets the scene up for one build: an instance folder of its own with the built jar, the pinned libraries it
 * asks for, the jars the person put in `test-scene-mods` beside the project, and nothing else. An instance from
 * an earlier build of the same project is emptied of its mods and its world first.
 */
export async function deployScene(input: { build: BuildResult; project: { id: string; name: string; target?: string }; runtimeDirectory: string }, options: SceneOptions): Promise<SceneRecord> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  // A Forge or NeoForge project's scene is the loader's own server, installed for the project (`scene-target.ts`).
  const target = input.project.target
  if (otherTarget(target)) return (await import("./scene-target")).deployTargetScene({ ...input, project: { ...input.project, target } }, options)
  const paths = scenePaths(input.runtimeDirectory, input.project.id)
  const built = await modFile(input.build.jarPath)
  const extraDirectory = path.join(input.build.projectDirectory, SCENE_EXTRA)
  const extra = await Promise.all((await readdir(extraDirectory).catch(() => [] as string[])).filter((name) => name.toLowerCase().endsWith(".jar")).sort().map((name) => modFile(path.join(extraDirectory, name))))
  // What Studio can fetch by itself, said by the ids they answer to so nothing is downloaded that is not asked for.
  const known = knownMods(paths.mods)
  const chosen = sceneMods(built, known, extra)
  await each(chosen.mods.filter((mod) => known.some((value) => value.file === mod.file)), 2, (mod) => held(options, { ...known.find((value) => value.file === mod.file)!.fetch, destination: mod.file }))
  await rm(path.join(paths.instance, "mods"), { recursive: true, force: true })
  await rm(path.join(paths.instance, "saves", SCENE.world), { recursive: true, force: true })
  await mkdir(path.join(paths.instance, "mods"), { recursive: true })
  await Promise.all(chosen.mods.map((mod) => copyFile(mod.file, path.join(paths.instance, "mods", path.basename(mod.file)))))
  if (!(await exists(path.join(paths.instance, "options.txt")))) await writeFile(path.join(paths.instance, "options.txt"), SCENE_OPTIONS)
  const record: SceneRecord = {
    schema_version: 1,
    project_id: input.project.id,
    build_id: input.build.id,
    revision: input.build.revision,
    jar_sha256: input.build.sha256,
    mods: chosen.mods.map((mod) => path.basename(mod.file)).sort(),
    missing: chosen.missing,
    deployed_at: new Date().toISOString(),
  }
  await writeFile(paths.record, `${JSON.stringify(record, null, 2)}\n`)
  await writeFile(
    path.join(paths.instance, "测试场说明.md"),
    [
      `# 「${input.project.name}」的${SCENE_WORDS.name}`,
      "",
      `这个文件夹是一个只为这个模组准备的游戏：mods 里只有它自己和它必须的前置（${record.mods.join("、")}），没有别的模组、材质包或光影。`,
      ...(record.missing.length ? ["", SCENE_WORDS.missing(record.missing)] : []),
      "",
      "- 在 Studio 里点「打开测试场」，或者双击这里的启动脚本，直接进到摆好东西的世界里：这个模组的东西在面前横着摆成一排：右边是物品（浮在空中，最多 8 件，全部也放在后面的箱子里），中间是方块，左边是生物，每样头上浮着名字（模组里没有的那一类就没有）。",
      "- 它不经过任何启动器，也不登录账号，所以进不了联机服务器；只用来看这个模组。",
      "- 每次重新部署，这里的 mods 和世界都会换成新的；你在这个世界里做的改动不会留下。",
      "",
    ].join("\n"),
  )
  return record
}

export const readScene = async (runtimeDirectory: string, projectId: string) =>
  readFile(scenePaths(runtimeDirectory, projectId).record, "utf8").then((text) => JSON.parse(text) as SceneRecord, () => null)

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("NO_FREE_PORT"))))
    })
  })

/** The test world's own data pack (`SCENE_DATAPACK`), written into the world's folder. */
export async function writeSceneDatapack(world: string) {
  for (const [file, text] of Object.entries(SCENE_DATAPACK.files)) {
    const target = path.join(world, "datapacks", SCENE_DATAPACK.folder, ...file.split("/"))
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text)
  }
}

/**
 * The windowless check, for an AI or before the person looks: starts the game's own server on this computer
 * only with the deployed mods, sets every thing of the project out over the console, waits, asks the game about
 * each, saves the world and stops. The world it leaves is the one 「打开测试场」 opens.
 * `eula` is the person's own agreement to the game's licence, which its server asks for; without it nothing is started.
 */
export async function checkScene(
  input: { project: Parameters<typeof scenePlan>[0] & { id: string }; /** A plan made elsewhere (the command-line tool has no project document, only registry names); left out, the project's own. */ plan?: ScenePlan; runtimeDirectory: string; eula: boolean; settle?: number },
  options: SceneOptions,
): Promise<SceneReport> {
  if (!input.eula) throw new Error("SCENE_EULA")
  const paths = scenePaths(input.runtimeDirectory, input.project.id)
  const record = await readScene(input.runtimeDirectory, input.project.id)
  if (!record) throw new Error("SCENE_NOT_DEPLOYED")
  if (record.missing.length) throw new Error(`SCENE_MISSING_MODS:${record.missing.join(",")}`)
  const target = record.target
  if (otherTarget(target)) return (await import("./scene-target")).checkTargetScene(input, { ...record, target }, options)
  const server = options.server ?? (await prepareSceneServer(input.runtimeDirectory, options))
  const javaHome = await ensureJava(input.runtimeDirectory, options)
  await rm(path.join(paths.instance, "saves", SCENE.world), { recursive: true, force: true })
  // Before the game makes the world: a pack in its folder is switched on with it. It only tidies the names left by creatures that are gone (see `SCENE_DATAPACK`).
  await writeSceneDatapack(path.join(paths.instance, "saves", SCENE.world))
  await writeFile(path.join(paths.instance, "eula.txt"), "eula=true\n")
  await writeFile(path.join(paths.instance, "server.properties"), sceneServerProperties(await freePort()))
  const plan = input.plan ?? scenePlan(input.project)
  const settle = input.settle ?? SCENE.settle
  const lines: string[] = []
  const state = { wake: () => undefined as void, over: false, write: (_text: string) => undefined as void, started: false }
  const until = async (find: () => number, seconds: number) => {
    const end = Date.now() + seconds * 1000
    for (;;) {
      const at = find()
      if (at >= 0 || state.over || Date.now() >= end || options.signal?.aborted) return at
      await new Promise<void>((resolve) => {
        state.wake = resolve
        setTimeout(resolve, 250)
      })
    }
  }
  const answers: SceneAnswer[] = []
  const marks = { next: 0 }
  const send = async (step: SceneStep) => {
    const mark = marks.next++
    const from = lines.length
    state.write(`${step.command}\n${sceneMark(mark)}\n`)
    const closing = new RegExp(`${SCENE_MARK} ${mark}$`)
    const at = await until(() => lines.findIndex((line, index) => index >= from && closing.test(line.trim())), SCENE.answer)
    answers.push({ step, said: lines.slice(from, at < 0 ? lines.length : at).map(sceneSaid).filter(Boolean) })
    return at >= 0
  }
  const running = runOwnedProcess(path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java"), sceneServerArgs(server), {
    cwd: paths.instance,
    signal: options.signal,
    timeoutMs: (SCENE.boot + settle + 180 + (plan.place.length + plan.ask.length) * SCENE.answer) * 1000,
    onProgress: (text) => {
      lines.push(...text.split(/\r?\n/).filter((line) => line.length))
      options.onProgress?.(text)
      state.wake()
    },
    interact: (write) => {
      state.write = write
    },
  })
    .catch((error: unknown) => {
      if (error instanceof Error && error.message === "CANCELLED") throw error
      return { code: -1, output: "" }
    })
    .finally(() => {
      state.over = true
      state.wake()
    })
  const drive = async () => {
    state.started = (await until(() => lines.findIndex((line) => SCENE_READY.test(line)), SCENE.boot)) >= 0
    if (!state.started) return
    for (const step of plan.place) if (!(await send(step)) && state.over) return
    await until(() => -1, settle)
    for (const step of [...plan.ask, ...plan.close]) if (!(await send(step)) && state.over) return
  }
  await drive().finally(() => state.write("stop\n"))
  // A game that does not take `stop` is ended with the rest of its process tree when the time allowed runs out.
  await running
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const report = sceneReport({ mod_id: input.project.mod_id, plan, answers, log: lines, started: state.started })
  await writeFile(paths.log, `${lines.join("\n")}\n`)
  await writeFile(paths.record, `${JSON.stringify({ ...record, checked_at: new Date().toISOString(), report } satisfies SceneRecord, null, 2)}\n`)
  return report
}

const quoted = (value: string) => (/^[A-Za-z0-9_\-./:=+]+$/.test(value) ? value : `"${value.replaceAll("%", "%%")}"`)

/**
 * broad5: the scene's world is made by the headless check (a dedicated server), and a world a server made keeps commands off
 * when it is opened as a single-player world, so the person could not use /kill, /tp or /gamemode to try a boss's phases or
 * death. It is the person's own test world: its level.dat is opened for commands, the way "允许作弊" does when a world is made.
 * Only the one byte after the tag's own name is touched (a byte tag named allowCommands); anything else leaves the file alone.
 */
export function allowSceneCommands(levelDat: Uint8Array): Uint8Array | null {
  const raw = gunzipSync(levelDat)
  const name = new TextEncoder().encode("allowCommands")
  for (let at = 0; at + 3 + name.length < raw.length; at++) {
    if (raw[at] !== 1 || raw[at + 1] !== 0 || raw[at + 2] !== name.length) continue
    if (!name.every((byte, index) => raw[at + 3 + index] === byte)) continue
    const value = at + 3 + name.length
    if (raw[value] === 1) return null
    const changed = raw.slice()
    changed[value] = 1
    return gzipSync(changed)
  }
  return null
}

/** What starts the game for the person, as a command and its arguments; also written beside the instance as a script that needs nothing but itself. */
async function clientLaunch(input: { projectId: string; runtimeDirectory: string }, options: SceneOptions) {
  const paths = scenePaths(input.runtimeDirectory, input.projectId)
  const client = await prepareSceneClient(input.runtimeDirectory, options)
  const javaHome = await ensureJava(input.runtimeDirectory, options)
  const level = path.join(paths.instance, "saves", SCENE.world, "level.dat")
  const world = await exists(level)
  if (world) {
    const opened = allowSceneCommands(await readFile(level))
    if (opened) await writeFile(level, opened)
  }
  const args = sceneClientArgs({ ...client, instance: paths.instance, version: `fabric-loader-${profile.loader}-${profile.minecraft}`, os: os(), world })
  const java = path.join(javaHome, "bin", process.platform === "win32" ? "javaw.exe" : "java")
  await writeFile(
    path.join(paths.instance, process.platform === "win32" ? "打开测试场.bat" : "open-test-scene.sh"),
    process.platform === "win32"
      ? ["@echo off", "chcp 65001 >nul", 'cd /d "%~dp0"', `start "" ${[java, ...args].map(quoted).join(" ")}`, ""].join("\r\n")
      : ["#!/bin/sh", 'cd "$(dirname "$0")"', `exec ${[java, ...args].map((value) => `'${value.replaceAll("'", `'\\''`)}'`).join(" ")}`, ""].join("\n"),
    { mode: 0o755 },
  )
  return { java, args, cwd: paths.instance, world }
}

/** How often the game's log is read for how far the game has come: two seconds, well inside what a person waits before wondering. */
export const SCENE_LOG_POLL_MS = 2000

/** The line the game prints when the player has joined the world. */
// broad7 w3: the scene's game is in Chinese (options.txt lang:zh_cn) and its server said 「Tester加入了游戏」, which the English words missed. The line
// the player list writes when a player logs in is not translated, and the translated join line is kept beside the English one.
export const SCENE_IN_GAME = /\blogged in with entity id\b|\bjoined the game\b|加入了游戏/

/**
 * What the game's own log says about how far the game has come, so the job can say 「the game is open」 before (or without) the player
 * being in a world: a launch with no test world, or one the person has not opened, stops on the title screen and never prints the join line.
 *
 * The title screen is ready when the game has finished loading its resources, and these two lines are the ones the game prints for that
 * (the packaged-app test of this repo waits for the same pair in a real client log):
 *   - the block texture atlas was created (`Created: ... textures/atlas/blocks.png-atlas`): the window and its GL context exist, and textures
 *     and models are loaded, the largest and last step of the resource reload;
 *   - the sound engine finished starting (`Sound engine started` / `OpenAL initialized`), which the reload does just before the models. A
 *     computer without a sound device prints `Error starting SoundSystem` instead and goes on without sound, so that counts as finished too.
 * Either alone is not enough: the atlas line can come while the sound is still loading, and the sound line comes well before the models.
 * After both, the loading overlay only has its fade left. Any line of the world join is read as the title screen having been passed.
 */
export const CLIENT_ATLAS_READY = /Created:.*textures\/atlas\/blocks\.png-atlas/
export const CLIENT_SOUND_READY = /OpenAL initialized|Sound engine started|Error starting SoundSystem/
export type GameStage = "title" | "in_world"

/** Longest line either pattern is read from, plus room: output comes in pieces and a line cut in two is still found. */
const GAME_LINE_TAIL = 256

/**
 * Feeds the game's output (pieces of it, or the whole log read again, in any mix) and says each stage once, in order: `title` when the
 * title screen is ready and `in_world` when the player has joined. The join is said without the title first when the title was never seen.
 */
export function watchGame(onStage: (stage: GameStage) => void) {
  const seen = { atlas: false, sound: false, title: false, joined: false }
  let tail = ""
  return (text: string) => {
    const chunk = tail + text
    tail = chunk.slice(-GAME_LINE_TAIL)
    seen.atlas ||= CLIENT_ATLAS_READY.test(chunk)
    seen.sound ||= CLIENT_SOUND_READY.test(chunk)
    if (!seen.joined && SCENE_IN_GAME.test(chunk)) {
      seen.joined = true
      seen.title = true
      return onStage("in_world")
    }
    if (!seen.title && !seen.joined && seen.atlas && seen.sound) {
      seen.title = true
      onStage("title")
    }
  }
}

/** Longest crash report that is read: a report with its system details is tens of KB; more than this is not one the game wrote. */
const CRASH_REPORT_BYTES = 262144

/**
 * Whether the game that ran in `instance` since `launched` crashed, from what it left behind (see `CrashSign` for why each of these is evidence and
 * what each one cannot see). Null when none of them is there: a window closed by the person, or a process killed from outside, is not claimed as a crash.
 * `launched` is when Studio started the process; files are taken from one second before it, since a file system keeps modification times coarsely.
 */
export async function findGameCrash(input: { instance: string; launched: number; code: number | null; output: string; modId?: string }): Promise<GameCrash | null> {
  const since = input.launched - 1000
  const newest = async (folder: string, name: RegExp) => {
    const found = await Promise.all(
      (await readdir(folder).catch(() => [] as string[])).filter((file) => name.test(file)).map(async (file) => ({ file: path.join(folder, file), at: (await stat(path.join(folder, file)).catch(() => null))?.mtimeMs ?? 0 })),
    )
    return found.filter((value) => value.at >= since).sort((a, b) => b.at - a.at)[0]?.file ?? null
  }
  const report = await newest(path.join(input.instance, "crash-reports"), /^crash-.*\.txt$/)
  const fatal = report ? null : await newest(input.instance, /^hs_err_pid\d+\.log$/)
  const marked = CRASH_MARKER.test(input.output)
  // The marker names the report even if the folder could not be listed; a path it names that is not there is not used.
  const named = CRASH_MARKER_PATH.exec(input.output)?.[1]?.trim()
  const reported = report ?? (named && (await exists(named)) ? named : null)
  const signs: CrashSign[] = [
    ...(reported ? (["report"] as const) : []),
    ...(marked ? (["marker"] as const) : []),
    ...(input.code !== null && GAME_CRASH_CODES.includes(input.code) ? (["exit"] as const) : []),
    ...(fatal ? (["jvm"] as const) : []),
  ]
  if (!signs.length) return null
  const kept = reported ?? fatal
  const text = reported ? await readFile(reported).then((buffer) => buffer.subarray(0, CRASH_REPORT_BYTES).toString("utf8"), () => null) : null
  const read = text !== null ? parseCrashReport(text, input.modId ? modPackage(input.modId) : "-") : { description: null, exception: null, where: null, frames: [] }
  return { signs, code: input.code, report: kept ? path.resolve(kept) : null, ...read, at: new Date().toISOString() }
}

/**
 * Leaves how the last opening of the game ended in the scene's record: the crash when it was one, and nothing when it was not, so an earlier crash does not outlive
 * a game that ran well. Written to the record as it is now (a check may have rewritten it meanwhile) and only when it is still the same build's.
 */
export async function keepCrash(runtimeDirectory: string, projectId: string, buildId: string, crash: GameCrash | null) {
  const now = await readScene(runtimeDirectory, projectId)
  if (!now || now.build_id !== buildId) return
  const { crash: _earlier, ...rest } = now
  await writeFile(scenePaths(runtimeDirectory, projectId).record, `${JSON.stringify(crash ? { ...rest, crash } : rest, null, 2)}\n`).catch(() => undefined)
}

/**
 * Opens the scene in the game for the person and returns when they close it. Straight into the world the check
 * left when there is one; otherwise the game's own title screen, with the same mods and nothing else.
 * `crash` is what `findGameCrash` made of how the game ended; the record of the scene keeps it (and drops an earlier one) so the hand-off to the AI can read it.
 */
export async function openScene(input: { projectId: string; runtimeDirectory: string; modId?: string }, options: SceneOptions) {
  const record = await readScene(input.runtimeDirectory, input.projectId)
  if (!record) throw new Error("SCENE_NOT_DEPLOYED")
  if (record.missing.length) throw new Error(`SCENE_MISSING_MODS:${record.missing.join(",")}`)
  const target = record.target
  // A Forge or NeoForge project's game is the client instance Studio installs for it (`scene-target.ts`).
  if (otherTarget(target)) return (await import("./scene-target")).openTargetScene(input, { ...record, target }, options)
  const launch = await clientLaunch(input, options)
  options.onProgress?.("正在打开测试场。\n")
  // Said once each, in the person's words: the title screen is ready, then the player is in the world.
  const feed = watchGame((stage) => options.onProgress?.(`${stage === "title" ? SCENE_WORDS.at_title : SCENE_WORDS.in_game}\n`))
  const onProgress = (text: string) => {
    options.onProgress?.(text)
    feed(text)
  }
  // broad8 w2: the game's own output did not reach the job (the drawer still said it was opening four minutes into play), so its log
  // file is read as well: the game starts logs/latest.log afresh each time, and a file written after the launch is this session's.
  const launched = Date.now()
  const log = path.join(launch.cwd, "logs", "latest.log")
  const watch = setInterval(() => {
    void stat(log)
      .then(async (found) => (found.mtimeMs >= launched - 1000 ? feed(await readFile(log, "utf8")) : undefined))
      .catch(() => undefined)
  }, SCENE_LOG_POLL_MS)
  const result = await runOwnedProcess(launch.java, launch.args, { cwd: launch.cwd, signal: options.signal, timeoutMs: 14400000, onProgress, visible: true }).finally(() => clearInterval(watch))
  const crash = await findGameCrash({ instance: launch.cwd, launched, code: result.code, output: result.output, ...(input.modId ? { modId: input.modId } : {}) })
  await keepCrash(input.runtimeDirectory, input.projectId, record.build_id, crash)
  return { world: launch.world, code: result.code, crash }
}

export { sceneLines }

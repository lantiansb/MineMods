import { readFile } from "node:fs/promises"
import path from "node:path"
// Explicit entry bypasses Bun's partial built-in undici shim, as `fetch.ts` does.
import { Agent, ProxyAgent, type Dispatcher } from "undici/index.js"
import type { RemoteFile, TargetManifest } from "../target/manifest"
import { measurePath, readCatalog, recordItem, type StoreKind } from "./catalog"
import { fetchVerified, type HostLimiter, type SourceHealth } from "./fetch"
import { storeIds, storeLayout } from "./layout"
import type { Candidate, SourceId } from "./sources"
import { libraryPath, platformLibraries, WINDOWS_X64, type LaunchPlatform, type VersionFile } from "./version-file"

/**
 * The vanilla game for one target, kept once in the shared store and used by every instance of that game version:
 * Mojang's version file, the client (and, when asked, the server) jar, the libraries for this system in one
 * Maven-layout folder, and the asset index with its objects stored by hash. Every file comes through `fetchVerified`
 * (mirror first, official last) and is kept only if its hash is the one Mojang published.
 */

export type VanillaProgress = { stage: "version" | "client" | "server" | "libraries" | "assets"; files: number; totalFiles: number; bytes: number; totalBytes: number }

export type DownloadOptions = {
  signal?: AbortSignal
  /** How many files are fetched at once (default 8); the downloader also keeps each host to its own limit. */
  concurrency?: number
  /** Where a file can come from, for an official address; left out, the mirrors and then the official address. */
  sources?: (officialUrl: string) => Candidate[]
  mirrors?: boolean
  proxyUrl?: string
  stallMs?: number
  health?: SourceHealth
  limiter?: HostLimiter
}

export type VanillaFiles = {
  /** Absolute paths. */
  versionJson: string
  clientJar: string | null
  serverJar: string | null
  librariesRoot: string
  assetsRoot: string
  assetIndexId: string
  /** The library paths (relative to `librariesRoot`, with `/`) this version needs on this system. */
  libraries: string[]
  version: VersionFile
  fetched: { files: number; bytes: number }
}

/** A version file's JSON, read from disk; a file that is not an object is refused. */
export async function readVersionFile(file: string): Promise<VersionFile> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
  if (!parsed || typeof parsed !== "object" || typeof (parsed as VersionFile).id !== "string") throw new Error(`INVALID_VERSION_FILE: ${file}`)
  return parsed as VersionFile
}

/** Where the store keeps a game version's files, absolute. */
export function vanillaPaths(runtimeDir: string, version: string) {
  const folder = path.join(runtimeDir, storeLayout.minecraft(version))
  return {
    folder,
    versionJson: path.join(folder, `${version}.json`),
    clientJar: path.join(folder, `${version}.jar`),
    serverJar: path.join(folder, `server-${version}.jar`),
    librariesRoot: path.join(runtimeDir, storeLayout.libraries()),
    assetsRoot: path.join(runtimeDir, storeLayout.assets()),
  }
}

export type VerifiedDownload = { file: RemoteFile; destination: string }

/**
 * Fetches many files with at most `concurrency` at once, one shared connection pool, and a progress count. The first
 * failure stops the rest from starting and is thrown once those running have ended.
 */
export async function fetchAll(downloads: readonly VerifiedDownload[], options: DownloadOptions & { onFile?: (bytes: number, source: SourceId | "kept") => void } = {}) {
  const proxyUrl = options.proxyUrl ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY
  const dispatcher: Dispatcher = proxyUrl ? new ProxyAgent({ uri: proxyUrl, proxyTunnel: true }) : new Agent({ connections: 16 })
  const sources: Partial<Record<SourceId | "kept", number>> = {}
  let next = 0
  let failure: unknown
  const worker = async () => {
    while (failure === undefined && next < downloads.length) {
      if (options.signal?.aborted) break
      const download = downloads[next++]
      try {
        const result = await fetchVerified({
          file: download.file,
          destination: download.destination,
          sources: options.sources?.(download.file.url),
          mirrors: options.mirrors,
          dispatcher,
          signal: options.signal,
          stallMs: options.stallMs,
          health: options.health,
          limiter: options.limiter,
        })
        sources[result.source] = (sources[result.source] ?? 0) + 1
        options.onFile?.(result.bytes, result.source)
      } catch (error) {
        failure ??= error
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 8, downloads.length)) }, worker))
  } finally {
    await dispatcher.close().catch(() => undefined)
  }
  if (options.signal?.aborted) throw new Error("CANCELLED")
  if (failure !== undefined) throw failure
  return sources
}

/** The source to write in the list for a batch: the one most files came from, `kept` when nothing was fetched. */
export function mainSource(sources: Partial<Record<SourceId | "kept", number>>): SourceId | "kept" {
  const fetched = Object.entries(sources).filter(([source, count]) => source !== "kept" && count) as [SourceId, number][]
  return fetched.sort((a, b) => b[1] - a[1])[0]?.[0] ?? "kept"
}

/**
 * Writes an item into the list for a target, with its size measured where it lies. An item already listed keeps
 * where it first came from and when, unless something new was fetched for it now.
 */
export async function registerForTarget(
  runtimeDir: string,
  entry: { id: string; kind: StoreKind; title: string; path: string; source: SourceId | "kept"; users: string[]; sha256?: string | null },
  now = new Date(),
) {
  const before = (await readCatalog(runtimeDir)).items.find((item) => item.id === entry.id)
  const keep = before && entry.source === "kept"
  await recordItem(runtimeDir, {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    path: entry.path,
    bytes: await measurePath(path.join(runtimeDir, entry.path)),
    source: keep ? before.source : entry.source,
    sha256: entry.sha256 ?? null,
    installed_at: keep ? before.installed_at : now.toISOString(),
    users: entry.users,
  })
}

/** Mojang's address for one asset object. */
export const assetObjectUrl = (hash: string) => `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`

/** The objects an asset index lists, once per hash, with where each is kept. */
export function assetDownloads(index: unknown, assetsRoot: string): VerifiedDownload[] {
  const objects = (index as { objects?: Record<string, { hash?: string; size?: number }> } | null)?.objects
  if (!objects || typeof objects !== "object") throw new Error("INVALID_ASSET_INDEX")
  const byHash = new Map<string, VerifiedDownload>()
  for (const object of Object.values(objects)) {
    if (!object.hash || !/^[0-9a-f]{40}$/.test(object.hash)) throw new Error("INVALID_ASSET_INDEX")
    byHash.set(object.hash, {
      file: { url: assetObjectUrl(object.hash), sha1: object.hash, ...(object.size ? { size: object.size } : {}) },
      destination: path.join(assetsRoot, "objects", object.hash.slice(0, 2), object.hash),
    })
  }
  return [...byHash.values()]
}

/** The libraries a version file needs on this system that can be fetched (an address and a SHA-1), with where each is kept. */
export function libraryDownloads(version: Pick<VersionFile, "libraries">, librariesRoot: string, platform: LaunchPlatform = WINDOWS_X64): VerifiedDownload[] {
  const byPath = new Map<string, VerifiedDownload>()
  for (const library of platformLibraries(version, platform)) {
    const artifact = library.downloads?.artifact
    if (!artifact?.url || !artifact.sha1) continue
    const relative = libraryPath(library)
    byPath.set(relative, { file: { url: artifact.url, sha1: artifact.sha1, ...(artifact.size ? { size: artifact.size } : {}) }, destination: path.join(librariesRoot, ...relative.split("/")) })
  }
  return [...byPath.values()]
}

/**
 * Makes sure the vanilla game files for this target are in the store and right. What is already there and matches
 * its hash is kept; the rest is fetched. Registers `minecraft:<v>`, `libraries:shared` and `assets:shared` as needed
 * by `target:<id>`. `include` picks the parts (default: client jar, libraries and assets; not the server jar).
 */
export async function ensureVanilla(
  runtimeDir: string,
  manifest: Pick<TargetManifest, "id" | "minecraft">,
  options: DownloadOptions & {
    include?: { client?: boolean; server?: boolean; libraries?: boolean; assets?: boolean }
    onProgress?: (progress: VanillaProgress) => void
  } = {},
): Promise<VanillaFiles> {
  if (!path.isAbsolute(runtimeDir)) throw new Error("INVALID_RUNTIME_DIRECTORY")
  const include = { client: true, server: false, libraries: true, assets: true, ...options.include }
  const minecraft = manifest.minecraft
  const at = vanillaPaths(runtimeDir, minecraft.version)
  const user = `target:${manifest.id}`
  const fetched = { files: 0, bytes: 0 }
  const sources: Partial<Record<SourceId | "kept", number>> = {}
  const assetSources: Partial<Record<SourceId | "kept", number>> = {}
  const librarySources: Partial<Record<SourceId | "kept", number>> = {}

  const stage = async (name: VanillaProgress["stage"], downloads: VerifiedDownload[], tally: Partial<Record<SourceId | "kept", number>>) => {
    const totalBytes = downloads.reduce((sum, download) => sum + (download.file.size ?? 0), 0)
    const progress: VanillaProgress = { stage: name, files: 0, totalFiles: downloads.length, bytes: 0, totalBytes }
    options.onProgress?.({ ...progress })
    let last = 0
    const result = await fetchAll(downloads, {
      ...options,
      onFile: (bytes, source) => {
        progress.files += 1
        progress.bytes += bytes
        if (source !== "kept") {
          fetched.files += 1
          fetched.bytes += bytes
        }
        // Thousands of asset objects: said at most every 1% and at the end, not once per file.
        if (progress.files === progress.totalFiles || progress.files - last >= Math.max(1, Math.floor(progress.totalFiles / 100))) {
          last = progress.files
          options.onProgress?.({ ...progress })
        }
      },
    })
    for (const [source, count] of Object.entries(result)) tally[source as SourceId] = (tally[source as SourceId] ?? 0) + (count ?? 0)
  }

  await stage("version", [{ file: minecraft.metadata, destination: at.versionJson }], sources)
  const version = await readVersionFile(at.versionJson)
  if (version.id !== minecraft.version) throw new Error(`VERSION_FILE_MISMATCH: ${version.id}`)
  // The manifest copies the game jars from the version file; a difference means the manifest is wrong, not the download.
  // The asset index is compared by id only: Mojang republishes a version file now and then with a newer index of the
  // same id (1.21.1: index cdc3b024… in version file 21471485…, fe8483e9… in 9aa86ea6…), and the one fetched is the manifest's, by its own hash.
  if (version.downloads?.client?.sha1 !== minecraft.client.sha1 || version.downloads?.server?.sha1 !== minecraft.server.sha1 || version.assetIndex?.id !== minecraft.assetIndex.id)
    throw new Error("VERSION_FILE_DISAGREES_WITH_MANIFEST")

  if (include.client) await stage("client", [{ file: minecraft.client, destination: at.clientJar }], sources)
  if (include.server) await stage("server", [{ file: minecraft.server, destination: at.serverJar }], sources)

  const libraries = platformLibraries(version).flatMap((library) => (library.downloads?.artifact?.url ? [libraryPath(library)] : []))
  if (include.libraries) await stage("libraries", libraryDownloads(version, at.librariesRoot), librarySources)

  if (include.assets) {
    const indexFile = path.join(at.assetsRoot, "indexes", `${minecraft.assetIndex.id}.json`)
    await stage("assets", [{ file: minecraft.assetIndex.file, destination: indexFile }], assetSources)
    const index: unknown = JSON.parse(await readFile(indexFile, "utf8"))
    await stage("assets", assetDownloads(index, at.assetsRoot), assetSources)
  }

  await registerForTarget(runtimeDir, { id: storeIds.minecraft(minecraft.version), kind: "minecraft", title: `Minecraft ${minecraft.version} 游戏文件`, path: storeLayout.minecraft(minecraft.version), source: mainSource(sources), users: [user] })
  if (include.libraries) await registerForTarget(runtimeDir, { id: storeIds.libraries(), kind: "libraries", title: "游戏运行库（各版本共用）", path: storeLayout.libraries(), source: mainSource(librarySources), users: [user] })
  if (include.assets) await registerForTarget(runtimeDir, { id: storeIds.assets(), kind: "assets", title: "游戏资源文件（各版本共用）", path: storeLayout.assets(), source: mainSource(assetSources), users: [user] })

  return {
    versionJson: at.versionJson,
    clientJar: include.client ? at.clientJar : null,
    serverJar: include.server ? at.serverJar : null,
    librariesRoot: at.librariesRoot,
    assetsRoot: at.assetsRoot,
    assetIndexId: minecraft.assetIndex.id,
    libraries,
    version,
    fetched,
  }
}

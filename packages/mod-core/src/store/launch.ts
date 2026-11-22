import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"
import { ensureJavaMajor } from "../runtime"
import type { TargetManifest } from "../target/manifest"
import { useItem } from "./catalog"
import { storeIds } from "./layout"
import { downloadOptions, installedProof, instanceDirectory, placeVerified } from "./instance"
import { fetchAll, readVersionFile, vanillaPaths, type DownloadOptions, type VerifiedDownload } from "./minecraft"
import { expandArguments, libraryPath, loaderVersionId, mergeVersions, platformLibraries, serverArgsFile, WINDOWS_X64, type MergedVersion, type VersionFile } from "./version-file"

/**
 * How Studio starts a Forge or NeoForge game it installed (`instance.ts`): the command line only, so the caller
 * decides how to run and watch it. The client is started as the official launcher would start it, from the loader's
 * version file merged with vanilla's; the server from the argument file its installer wrote.
 */

export type LaunchCommand = { java: string; args: string[]; cwd: string }

/** The offline player's UUID, as the game itself makes it: a name-based (MD5, version 3) UUID of `OfflinePlayer:<name>`. */
export function offlineUuid(name: string) {
  const bytes = createHash("md5").update(`OfflinePlayer:${name}`, "utf8").digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return bytes.toString("hex")
}

/** The `${…}` values of a client launch; everything about the account is an offline placeholder. */
export function clientLaunchValues(input: {
  versionId: string
  librariesRoot: string
  nativesDirectory: string
  gameDirectory: string
  assetsRoot: string
  assetIndexId: string
  classpath: readonly string[]
  player: string
}): Record<string, string> {
  return {
    library_directory: input.librariesRoot,
    classpath_separator: path.delimiter === ";" ? ";" : ":",
    version_name: input.versionId,
    natives_directory: input.nativesDirectory,
    launcher_name: "MineModsStudio",
    launcher_version: "0.1",
    classpath: input.classpath.join(path.delimiter === ";" ? ";" : ":"),
    auth_player_name: input.player,
    version_type: "release",
    game_directory: input.gameDirectory,
    assets_root: input.assetsRoot,
    game_assets: input.assetsRoot,
    assets_index_name: input.assetIndexId,
    auth_uuid: offlineUuid(input.player),
    auth_access_token: "0",
    auth_session: "0",
    clientid: "0",
    auth_xuid: "0",
    user_type: "legacy",
    user_properties: "{}",
  }
}

/** The whole client command line after `java`: memory and encoding first, then the version files' JVM arguments, the main class, their game arguments. */
export function clientArguments(merged: Pick<MergedVersion, "jvm" | "game" | "mainClass">, values: Readonly<Record<string, string>>, options: { memory?: string; extraJvm?: readonly string[] } = {}) {
  return [
    `-Xmx${options.memory ?? "2G"}`,
    "-Dfile.encoding=UTF-8",
    "-Dstdout.encoding=UTF-8",
    "-Dstderr.encoding=UTF-8",
    ...(options.extraJvm ?? []),
    ...expandArguments(merged.jvm, values, WINDOWS_X64),
    merged.mainClass,
    ...expandArguments(merged.game, values, WINDOWS_X64),
  ]
}

type LaunchOptions = DownloadOptions & {
  projectId: string
  javaHome?: string
  javaDirectory?: string
  javaExecutable?: string
  /** Java heap, as `-Xmx` takes it (default `2G`). */
  memory?: string
  extraJvm?: string[]
}

async function javaFor(runtimeDir: string, manifest: TargetManifest, options: LaunchOptions) {
  if (options.javaExecutable) return options.javaExecutable
  const home = await ensureJavaMajor(runtimeDir, manifest.java.major, { javaHome: options.javaHome, javaDirectory: options.javaDirectory, signal: options.signal })
  return path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java")
}

const exists = async (file: string, size?: number) => {
  const info = await stat(file).catch(() => null)
  return Boolean(info?.isFile() && (size === undefined || info.size === size))
}

/** Marks what a launch uses as used now; a list that cannot be written never stops the game. */
async function markUsed(runtimeDir: string, manifest: TargetManifest, projectId: string, ids: string[]) {
  for (const id of ids) await useItem(runtimeDir, id, `target:${manifest.id}`).catch(() => undefined)
  await useItem(runtimeDir, storeIds.instance(projectId, manifest.id), `project:${projectId}`).catch(() => undefined)
}

/**
 * The client's command line. Reads the loader's version file and the vanilla one it inherits from, fetches any
 * library that is missing (the loader's into the instance, as its arguments name them under `library_directory`;
 * vanilla's into the shared store), puts the game jar on the class path under the loader version's own name (Forge's
 * and NeoForge's `ignoreList` skips exactly that name; under the vanilla name both the plain and the patched game
 * would load and clash), and fills in the placeholders with an offline player.
 */
export async function clientLaunchCommand(runtimeDir: string, manifest: TargetManifest, options: LaunchOptions & { player?: string }): Promise<LaunchCommand & { gameDirectory: string; classpath: string[] }> {
  const directory = instanceDirectory(runtimeDir, options.projectId, manifest.id, "client")
  const versionId = loaderVersionId(manifest)
  const loaderJson = path.join(directory, ...installedProof(manifest, "client").split("/"))
  if (!(await exists(loaderJson))) throw new Error(`INSTANCE_NOT_INSTALLED: ${directory}`)
  const loader = await readVersionFile(loaderJson)
  const store = vanillaPaths(runtimeDir, manifest.minecraft.version)
  const placedVanilla = path.join(directory, "versions", manifest.minecraft.version, `${manifest.minecraft.version}.json`)
  const vanilla: VersionFile | undefined = loader.inheritsFrom ? await readVersionFile((await exists(placedVanilla)) ? placedVanilla : store.versionJson) : undefined
  const merged = mergeVersions(loader, vanilla)
  const instanceLibraries = path.join(directory, "libraries")

  const classpath: string[] = []
  const missing: VerifiedDownload[] = []
  const unfetchable: string[] = []
  for (const library of platformLibraries(merged)) {
    const relative = libraryPath(library)
    const parts = relative.split("/")
    const artifact = library.downloads?.artifact
    const inInstance = path.join(instanceLibraries, ...parts)
    const inStore = path.join(store.librariesRoot, ...parts)
    const found = (await exists(inInstance, artifact?.size)) ? inInstance : (await exists(inStore, artifact?.size)) ? inStore : null
    const home = library.from === "loader" ? inInstance : inStore
    if (!found) {
      if (artifact?.url && artifact.sha1) missing.push({ file: { url: artifact.url, sha1: artifact.sha1, ...(artifact.size ? { size: artifact.size } : {}) }, destination: home })
      else unfetchable.push(library.name)
    }
    classpath.push(found ?? home)
  }
  if (unfetchable.length) throw new Error(`LIBRARY_MISSING: ${unfetchable.join(", ")} (the installer makes these; install the instance again)`)
  if (missing.length) await fetchAll(missing, downloadOptions(options))

  // The game jar under the loader version's name, as the official launcher places it.
  const gameJar = path.join(directory, "versions", versionId, `${versionId}.jar`)
  const placedJar = path.join(directory, "versions", manifest.minecraft.version, `${manifest.minecraft.version}.jar`)
  await placeVerified((await exists(placedJar, manifest.minecraft.client.size)) ? placedJar : store.clientJar, gameJar, manifest.minecraft.client)
  classpath.push(gameJar)

  const gameDirectory = path.join(directory, "game")
  const nativesDirectory = path.join(directory, "natives")
  await mkdir(path.join(gameDirectory, "mods"), { recursive: true })
  await mkdir(nativesDirectory, { recursive: true })
  if (!(await exists(path.join(store.assetsRoot, "indexes", `${merged.assetIndex.id}.json`)))) throw new Error(`ASSETS_MISSING: ${merged.assetIndex.id} (ensureVanilla first)`)
  const values = clientLaunchValues({
    versionId,
    librariesRoot: instanceLibraries,
    nativesDirectory,
    gameDirectory,
    assetsRoot: store.assetsRoot,
    assetIndexId: merged.assetIndex.id,
    classpath,
    player: options.player ?? "Tester",
  })
  const java = await javaFor(runtimeDir, manifest, options)
  await markUsed(runtimeDir, manifest, options.projectId, [storeIds.minecraft(manifest.minecraft.version), storeIds.libraries(), storeIds.assets()])
  return { java, args: clientArguments(merged, values, options), cwd: gameDirectory, gameDirectory, classpath }
}

/** A port nobody listens on now, from the system. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error("NO_FREE_PORT"))))
    })
  })
}

/** `server.properties` with the keys Studio needs set, every other line kept as it was. */
export function serverProperties(existing: string, set: Readonly<Record<string, string>>) {
  const lines = existing.split(/\r?\n/).filter((line, index, all) => line !== "" || index < all.length - 1)
  const left = new Map(Object.entries(set))
  const out = lines.map((line) => {
    const key = /^([^#=\s][^=]*)=/.exec(line)?.[1]?.trim()
    if (key === undefined || !left.has(key)) return line
    const value = left.get(key)!
    left.delete(key)
    return `${key}=${value}`
  })
  for (const [key, value] of left) out.push(`${key}=${value}`)
  return `${out.join("\n")}\n`
}

/**
 * The server's command line: `java -Xmx2G @libraries/…/win_args.txt nogui` in the server folder, which is what the
 * installer's own `run.bat` does. Accepts the EULA (it is Studio's test server) and sets offline mode and a free port.
 */
export async function serverLaunchCommand(runtimeDir: string, manifest: TargetManifest, options: LaunchOptions & { port?: number; properties?: Record<string, string> }): Promise<LaunchCommand & { port: number }> {
  const directory = instanceDirectory(runtimeDir, options.projectId, manifest.id, "server")
  const argsFile = serverArgsFile(manifest)
  if (!(await exists(path.join(directory, ...argsFile.split("/"))))) throw new Error(`INSTANCE_NOT_INSTALLED: ${directory}`)
  const port = options.port ?? (await freePort())
  await writeFile(path.join(directory, "eula.txt"), "eula=true\n")
  const propertiesFile = path.join(directory, "server.properties")
  const before = await readFile(propertiesFile, "utf8").catch(() => "")
  await writeFile(propertiesFile, serverProperties(before, { "online-mode": "false", "server-port": String(port), ...options.properties }))
  await mkdir(path.join(directory, "mods"), { recursive: true })
  const java = await javaFor(runtimeDir, manifest, options)
  await markUsed(runtimeDir, manifest, options.projectId, [storeIds.minecraft(manifest.minecraft.version)])
  return {
    java,
    args: [`-Xmx${options.memory ?? "2G"}`, "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", ...(options.extraJvm ?? []), `@${argsFile}`, "nogui"],
    cwd: directory,
    port,
  }
}

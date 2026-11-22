import { createHash } from "node:crypto"
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { ensureJavaMajor, runOwnedProcess } from "../runtime"
import type { RemoteFile, TargetManifest } from "../target/manifest"
import { fetchVerified, matches } from "./fetch"
import { storeIds, storeLayout } from "./layout"
import { ensureVanilla, mainSource, registerForTarget, type DownloadOptions } from "./minecraft"
import type { SourceId } from "./sources"
import { loaderVersionId, serverArgsFile } from "./version-file"

/**
 * A Forge or NeoForge game instance for one project and one target, installed by the loader's own installer, run
 * headless. What Studio does first, because the installer does it badly (checked 2026-11-14, see the phase 0 notes):
 * the vanilla version file and jar are fetched and checked by Studio and placed in the instance, so the installer
 * never downloads them through a mirror node that sends the wrong bytes; the client instance gets a
 * `launcher_profiles.json`, which the client installer insists on; the installer always gets the instance folder
 * (NeoForge would otherwise install into `.minecraft`) and runs in it (it writes `installer.log` into its working
 * folder). Nothing is read from or written to any launcher's folder.
 *
 * Fabric is not installed here: its jars go straight on the class path, and it keeps its own test scene (`scene.ts`).
 */

export type InstanceSide = "client" | "server"

export const BMCLAPI_MAVEN = "https://bmclapi2.bangbang93.com/maven/"
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MARKER = ".minemods-instance.json"
const INSTALL_TIMEOUT_MS = 25 * 60_000
/** How many more times an installer is run when Mojang's mappings it fetched arrived cut short (see `brokenMappings`). */
const MAPPINGS_RETRIES = 2

/**
 * Mojang's mappings of this side that a Forge or NeoForge installer fetched into the instance, when one is there and is not
 * the file the game's version file names (by its sha1); null when there is none or all are right. The installer's
 * DOWNLOAD_MOJMAPS step fetches it itself, straight from Mojang (past the mirror, and Studio cannot hand it one: the step
 * deletes the file first), and keeps whatever arrived without checking it, so a connection that is cut leaves part of a
 * file, the step says it downloaded it, and the next step fails reading it (NeoForge 21.1.266: an
 * ArrayIndexOutOfBoundsException in srgutils, seen 2026-11-15). Nothing else of the install is wrong then: run again, it
 * fetches only this file.
 */
export async function brokenMappings(directory: string, side: InstanceSide, versionJson: string): Promise<string | null> {
  const version = JSON.parse(await readFile(versionJson, "utf8")) as { downloads?: Record<string, { sha1?: string }> }
  const expected = version.downloads?.[`${side}_mappings`]?.sha1
  if (!expected) return null
  const folder = path.join(directory, "libraries", "net", "minecraft", side)
  const versions = await readdir(folder, { withFileTypes: true }).catch(() => [])
  for (const entry of versions) {
    if (!entry.isDirectory()) continue
    const names = await readdir(path.join(folder, entry.name)).catch(() => [] as string[])
    for (const name of names) {
      if (!name.startsWith(`${side}-`) || !name.endsWith("-mappings.txt")) continue
      const file = path.join(folder, entry.name, name)
      const hash = createHash("sha1").update(await readFile(file)).digest("hex")
      if (hash !== expected.toLowerCase()) return file
    }
  }
  return null
}

/** The installer's command line after `java -jar <installer>`: its own flag for the side, the folder, and the mirror if any. */
export function installerArgs(kind: TargetManifest["loader"]["kind"], side: InstanceSide, directory: string, mirror: string | null) {
  const flag =
    kind === "forge" ? (side === "client" ? "--installClient" : "--installServer")
    : kind === "neoforge" ? (side === "client" ? "--install-client" : "--install-server")
    : null
  if (!flag) throw new Error(`NOT_AN_INSTALLER_LOADER: ${kind} (Fabric uses its test scene, not an installed instance)`)
  return [flag, directory, ...(mirror ? ["--mirror", mirror] : [])]
}

/** The instance folder of one side, absolute. */
export function instanceDirectory(runtimeDir: string, projectId: string, targetId: string, side: InstanceSide) {
  if (!PROJECT_ID.test(projectId)) throw new Error("INVALID_PROJECT_ID")
  return path.join(runtimeDir, storeLayout.instance(projectId, targetId), side)
}

/** The file whose presence says the installer finished its work for this side (relative, with `/`). */
export function installedProof(manifest: Pick<TargetManifest, "minecraft" | "loader">, side: InstanceSide) {
  if (side === "server") return serverArgsFile(manifest)
  const id = loaderVersionId(manifest)
  return `versions/${id}/${id}.json`
}

type Marker = { target: string; loader: string; installer: string; side: InstanceSide; installed_at: string; mirror: boolean }

async function readMarker(directory: string): Promise<Marker | null> {
  try {
    return JSON.parse(await readFile(path.join(directory, MARKER), "utf8")) as Marker
  } catch {
    return null
  }
}

const installerHash = (file: RemoteFile) => file.sha256 ?? file.sha1 ?? ""

/** Whether this side was installed by this very installer and its proof is still there. */
export async function isInstalled(directory: string, manifest: Pick<TargetManifest, "id" | "minecraft" | "loader">, side: InstanceSide) {
  if (manifest.loader.install.kind !== "installer") return false
  const marker = await readMarker(directory)
  if (!marker || marker.target !== manifest.id || marker.loader !== manifest.loader.version || marker.side !== side || marker.installer !== installerHash(manifest.loader.install.file)) return false
  return Boolean(await stat(path.join(directory, ...installedProof(manifest, side).split("/"))).catch(() => null))
}

/** A verified store file placed in an instance: a hard link where the disk allows, else a copy. Left alone when already right. */
export async function placeVerified(source: string, destination: string, file: RemoteFile) {
  if (await matches(destination, file)) return
  await mkdir(path.dirname(destination), { recursive: true })
  await rm(destination, { force: true })
  await link(source, destination).catch(() => copyFile(source, destination))
  if (!(await matches(destination, file))) throw new Error(`PLACED_FILE_MISMATCH: ${destination}`)
}

/**
 * The environment the installer runs in: only what Java and the network need. `APPDATA` points at the instance, so
 * whatever an installer would look up there by default (`.minecraft`) is the instance's, never the person's launcher.
 */
export function installerEnvironment(directory: string, from: NodeJS.ProcessEnv = process.env) {
  const kept = ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "LANG", "LC_ALL"]
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(from).filter(([name]) => kept.includes(name.toUpperCase())))
  env.APPDATA = directory
  return env
}

export type InstallRunner = (java: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs: number; onProgress?: (text: string) => void }) => Promise<{ code: number; output: string }>

const defaultRunner: InstallRunner = (java, args, options) => runOwnedProcess(java, args, options)

export type InstanceResult = {
  directory: string
  side: InstanceSide
  /** The loader's version id (`1.20.1-forge-47.4.28`, `neoforge-21.1.266`). */
  versionId: string
  java: string
  installed: "already" | "mirror" | "official"
  seconds: number
}

const running = new Map<string, Promise<InstanceResult>>()

/** Only the download settings out of a caller's options. */
export const downloadOptions = (options: DownloadOptions): DownloadOptions => ({
  signal: options.signal,
  concurrency: options.concurrency,
  sources: options.sources,
  mirrors: options.mirrors,
  proxyUrl: options.proxyUrl,
  stallMs: options.stallMs,
  health: options.health,
  limiter: options.limiter,
})

/**
 * Makes sure one side of a project's instance for an installer loader is installed. Does nothing when this installer
 * already installed it. Otherwise: the vanilla files (fetched and checked), the installer jar (fetched and checked),
 * the right Java (Forge 1.20.1 → 17, NeoForge 1.21.1 → 21, from the manifest), then the installer with the BMCLAPI
 * mirror, and once more without it if that fails; a run that failed because Mojang's mappings arrived cut short
 * (`brokenMappings`) is run again the same way, twice at most, and one that lost the network (a cut handshake, a
 * reset, a mirror node refusing: `networkFailure`) after a wait, twice at most; a failure says (`code`) whether it was
 * the network. Registers `instance:<project>.<target>` as needed by the project
 * and the target, and the installer as `loader:…` needed by the target.
 */
export function ensureLoaderInstance(
  runtimeDir: string,
  manifest: TargetManifest,
  options: DownloadOptions & {
    side: InstanceSide
    projectId: string
    /** A JDK folder of the right major version the person chose; left out, Studio's own (installed if needed). */
    javaHome?: string
    javaDirectory?: string
    /** A `java.exe` to use as it is, skipping the lookup (tests, or a caller that already has it). */
    javaExecutable?: string
    timeoutMs?: number
    onProgress?: (text: string) => void
    runner?: InstallRunner
    /** The waits before the runs again after a network failure (tests); left out, five seconds and fifteen. */
    retryWaitsMs?: readonly number[]
  },
): Promise<InstanceResult> {
  if (manifest.loader.install.kind !== "installer") return Promise.reject(new Error(`NOT_AN_INSTALLER_LOADER: ${manifest.loader.kind} (Fabric uses its test scene, not an installed instance)`))
  if (!path.isAbsolute(runtimeDir)) return Promise.reject(new Error("INVALID_RUNTIME_DIRECTORY"))
  let directory: string
  try {
    directory = instanceDirectory(runtimeDir, options.projectId, manifest.id, options.side)
  } catch (error) {
    return Promise.reject(error)
  }
  // Two calls for the same instance share one install.
  const key = directory.toLowerCase()
  const already = running.get(key)
  if (already) return already
  const work = install(runtimeDir, manifest, directory, options).finally(() => running.delete(key))
  running.set(key, work)
  return work
}

async function install(
  runtimeDir: string,
  manifest: TargetManifest,
  directory: string,
  options: Parameters<typeof ensureLoaderInstance>[2],
): Promise<InstanceResult> {
  if (manifest.loader.install.kind !== "installer") throw new Error("NOT_AN_INSTALLER_LOADER")
  const installerFile = manifest.loader.install.file
  const started = Date.now()
  const side = options.side
  const versionId = loaderVersionId(manifest)
  const say = (text: string) => options.onProgress?.(text.endsWith("\n") ? text : `${text}\n`)
  const register = (source: SourceId | "kept") =>
    registerForTarget(runtimeDir, {
      id: storeIds.instance(options.projectId, manifest.id),
      kind: "instance",
      title: `游戏实例 · ${manifest.loader.kind === "forge" ? "Forge" : "NeoForge"} ${manifest.minecraft.version}`,
      path: storeLayout.instance(options.projectId, manifest.id),
      source,
      users: [`project:${options.projectId}`, `target:${manifest.id}`],
    })

  const resolveJava = async () =>
    options.javaExecutable ??
    path.join(await ensureJavaMajor(runtimeDir, manifest.java.major, { javaHome: options.javaHome, javaDirectory: options.javaDirectory, signal: options.signal }), "bin", process.platform === "win32" ? "java.exe" : "java")

  if (await isInstalled(directory, manifest, side)) {
    await register("kept")
    return { directory, side, versionId, java: await resolveJava(), installed: "already", seconds: (Date.now() - started) / 1000 }
  }

  if (options.signal?.aborted) throw new Error("CANCELLED")
  say(`Getting the Minecraft ${manifest.minecraft.version} ${side} files ready.`)
  const vanilla = await ensureVanilla(runtimeDir, manifest, {
    ...downloadOptions(options),
    include: { client: side === "client", server: side === "server", libraries: false, assets: false },
    onProgress: (progress) => {
      if (progress.files === progress.totalFiles && progress.totalFiles) say(`Minecraft ${progress.stage}: ${progress.files} file(s) ready.`)
    },
  })

  say(`Getting the ${manifest.loader.kind} ${manifest.loader.version} installer ready.`)
  const loaderFolder = path.join(runtimeDir, storeLayout.loader(manifest))
  const installerJar = path.join(loaderFolder, path.posix.basename(new URL(installerFile.url).pathname))
  const fetchedInstaller = await fetchVerified({ file: installerFile, destination: installerJar, sources: options.sources?.(installerFile.url), mirrors: options.mirrors, signal: options.signal, stallMs: options.stallMs, health: options.health, limiter: options.limiter, proxyUrl: options.proxyUrl ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY })
  await registerForTarget(runtimeDir, {
    id: storeIds.loader(manifest),
    kind: "loader",
    title: `${manifest.loader.kind === "forge" ? "Forge" : "NeoForge"} ${manifest.loader.version} 安装器`,
    path: storeLayout.loader(manifest),
    source: fetchedInstaller.source,
    sha256: installerFile.sha256 ?? null,
    users: [`target:${manifest.id}`],
  })

  const java = await resolveJava()

  await mkdir(directory, { recursive: true })
  const mc = manifest.minecraft.version
  if (side === "client") {
    await placeVerified(vanilla.versionJson, path.join(directory, "versions", mc, `${mc}.json`), manifest.minecraft.metadata)
    await placeVerified(vanilla.clientJar!, path.join(directory, "versions", mc, `${mc}.jar`), manifest.minecraft.client)
    // The client installer refuses a folder without one; an empty list of profiles is all it needs.
    const profiles = path.join(directory, "launcher_profiles.json")
    if (!(await stat(profiles).catch(() => null))) await writeFile(profiles, '{ "profiles": {} }\n')
  } else {
    // Where both installers look for the server jar (`serverJarPath` in their install profile): there and right, they skip downloading it.
    await placeVerified(vanilla.serverJar!, path.join(directory, "libraries", "net", "minecraft", "server", mc, `server-${mc}.jar`), manifest.minecraft.server)
  }

  const attempts: (string | null)[] = options.mirrors === false ? [null] : [BMCLAPI_MAVEN, null]
  const failures: string[] = []
  let retries = 0
  let networkRetries = 0
  // Whether every run that failed failed for the network (a cut handshake, a reset, a mirror refusing, cut-short mappings): what the person is then told.
  let network = true
  for (let index = 0; index < attempts.length; index++) {
    const mirror = attempts[index]!
    if (options.signal?.aborted) throw new Error("CANCELLED")
    say(`Running the ${manifest.loader.kind} installer (${side})${mirror ? " through the BMCLAPI mirror" : " from the official addresses"}.`)
    const args = ["-Djava.awt.headless=true", "-Dfile.encoding=UTF-8", "-jar", installerJar, ...installerArgs(manifest.loader.kind, side, directory, mirror)]
    const run = options.runner ?? defaultRunner
    let result: { code: number; output: string }
    try {
      result = await run(java, args, { cwd: directory, env: installerEnvironment(directory), signal: options.signal, timeoutMs: options.timeoutMs ?? INSTALL_TIMEOUT_MS, onProgress: options.onProgress })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.message === "CANCELLED")) throw new Error("CANCELLED")
      failures.push(`${mirror ? "mirror" : "official"}: ${error instanceof Error ? error.message : String(error)}`)
      network = false
      continue
    }
    const proof = path.join(directory, ...installedProof(manifest, side).split("/"))
    if (result.code === 0 && (await stat(proof).catch(() => null))) {
      const marker: Marker = { target: manifest.id, loader: manifest.loader.version, installer: installerHash(installerFile), side, installed_at: new Date().toISOString(), mirror: Boolean(mirror) }
      await writeFile(path.join(directory, MARKER), `${JSON.stringify(marker, null, 2)}\n`)
      await register(mainSource({ [mirror ? "bmclapi" : "official"]: 1 }))
      return { directory, side, versionId, java, installed: mirror ? "mirror" : "official", seconds: (Date.now() - started) / 1000 }
    }
    const tail = result.output.split(/\r?\n/).filter((line) => /exception|error|failed|invalid/i.test(line)).slice(-3).join(" | ")
    const broken = await brokenMappings(directory, side, vanilla.versionJson).catch(() => null)
    const cut = !broken && networkFailure(result.output)
    failures.push(`${mirror ? "mirror" : "official"}: exit ${result.code}${broken ? " (Mojang mappings incomplete)" : cut ? " (network)" : ""}${tail ? `: ${tail}` : ""}`)
    if (!broken && !cut) network = false
    if (broken && retries < MAPPINGS_RETRIES) {
      // The same way again: everything else is in place, so it fetches only the mappings.
      retries++
      say(`Mojang's ${side} mappings arrived incomplete (${path.basename(broken)}); running the installer again.`)
      index--
    } else if (cut && networkRetries < NETWORK_RETRY_WAITS_MS.length) {
      // A handshake cut, a reset, a mirror node refusing: the same way again after a wait, before the next way (Fable's acceptance, 2026-11-15: run again as it was, it went through).
      const wait = options.retryWaitsMs?.[networkRetries] ?? NETWORK_RETRY_WAITS_MS[networkRetries]!
      networkRetries++
      say(`The ${manifest.loader.kind} installer lost the network (${tail.split(" | ")[0] || "connection cut"}); trying again in ${Math.round(wait / 1000)} s.`)
      await waitFor(wait, options.signal)
      index--
    }
  }
  // `code`: what the person is told (Studio's words for it): the network, which another try may get through, or the installer itself.
  throw Object.assign(new Error(`LOADER_INSTALL_FAILED: ${failures.join("; ")}`), { failures, directory, code: network && failures.length ? "LOADER_INSTALL_NETWORK" : "LOADER_INSTALL_FAILED" })
}

/** What an installer that failed for the network says (Java's words, the installers' and a refusing mirror's): a run that failed so may go through again. */
const NETWORK_FAILURE = /SSLHandshakeException|SSLException|Remote host terminated|Connection reset|SocketException|SocketTimeoutException|ConnectException|UnknownHostException|NoRouteToHostException|No route to host|timed out|EOFException|HTTP response code: (?:403|408|429|5\d\d)/i
export const networkFailure = (output: string) => NETWORK_FAILURE.test(output)

/** Waits between the runs of an installer that lost the network: five seconds, then fifteen. */
const NETWORK_RETRY_WAITS_MS = [5_000, 15_000] as const

const waitFor = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("CANCELLED"))
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new Error("CANCELLED"))
    }, { once: true })
  })

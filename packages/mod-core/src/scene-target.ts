import { copyFile, cp, link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { BuildResult } from "./build"
import { missingMods, readModJar } from "./mod-jar"
import { COUNTER_LABELS, countLine, growthLine } from "./progress-counter"
import { runOwnedProcess } from "./runtime"
import { SCENE, SCENE_DATAPACK, SCENE_EXTRA, SCENE_MARK, SCENE_OPTIONS, SCENE_READY, SCENE_WORDS, sceneMark, scenePlan, sceneReport, sceneSaid, sceneServerProperties, type SceneAnswer, type ScenePlan, type SceneReport, type SceneStep } from "./scene"
import { allowSceneCommands, findGameCrash, keepCrash, SCENE_LOG_POLL_MS, watchGame, type SceneOptions, type SceneRecord } from "./scene-run"
import { measurePath } from "./store/catalog"
import { fetchVerified } from "./store/fetch"
import { ensureLoaderInstance, instanceDirectory, isInstalled } from "./store/instance"
import { clientLaunchCommand, serverLaunchCommand } from "./store/launch"
import { ensureVanilla, registerForTarget, vanillaPaths, type VanillaProgress } from "./store/minecraft"
import { storeIds, storeLayout } from "./store/layout"
import type { TargetManifest } from "./target/manifest"
import { targetManifest } from "./target/manifests"

/**
 * 「测试场」 for a Forge or NeoForge project, on the loader's own game. Fabric keeps its own scene (`scene-run.ts`: its jars
 * straight on the class path); this one uses the instances Studio installs for the project and the target
 * (`store/instance.ts`, the loader's own installer, run headless) and starts them by the command lines `store/launch.ts`
 * makes, with the built jar, GeckoLib (fetched and checked by the target's manifest) and the jars the person put in
 * `test-scene-mods` (read as mods of the target's loader, `mod-jar.ts`), and nothing else. Jars a mod carries inside itself
 * (playerAnimator for cast actions) come with it.
 *
 * - The windowless check (`checkTargetScene`) runs the server instance: the plan, the commands that set things out, what
 *   counts as an answer and the report are the Fabric scene's (`scene.ts`), mapped to the target's game version where its
 *   commands or its data pack differ.
 * - 「打开测试场」 (`openTargetScene`) runs the client instance: the same mods, and the world the check left for this build
 *   (copied from the server and opened for commands), or the game's main menu when there is none. What it says while it
 *   opens, how it tells the title screen and the world, and how it reads a crash are the Fabric scene's.
 */

export type TargetSceneOptions = SceneOptions & {
  /** A JDK folder per Java major the target runs on (Forge 1.20.1: 17); left out, Studio's own of that major (installed if needed). */
  javaHomes?: Partial<Record<number, string>>
  /** Download settings for the instance and GeckoLib; left out, mirrors first, then the official addresses. */
  mirrors?: boolean
}

const LOADER_NAMES = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge" } as const
const targetName = (manifest: TargetManifest) => `${LOADER_NAMES[manifest.loader.kind]} ${manifest.minecraft.version}`

/**
 * About how much (MB) a project's first check and first opening of each target take, for the words said before they start. Measured on the
 * author's computer on 2026-11-14 by `script/target-scene-sizes.ts` from a runtime folder where Studio had just done both: the check is the
 * server instance (the server jar, everything its installer fetched and made) and the installer; the opening is the client instance, the
 * game's libraries, every sound, language and icon of its asset index, and the installer. The game's own files are kept once for every
 * project (and shared with other targets of the same game version), so a later project downloads less than this.
 */
export const TARGET_SCENE_DOWNLOADS: Record<string, { check: number; play: number }> = {
  // Server instance 177 + installer 9; client instance 144 + libraries 58 + sounds and languages 654 + installer 9.
  "forge-1.20.1": { check: 186, play: 865 },
  // Server instance 189 + installer 7; client instance 169 + libraries 62 + sounds and languages 828 + installer 7.
  "neoforge-1.21.1": { check: 196, play: 1066 },
}
const megabytes = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} GB` : `${value} MB`)

/** The words a target scene says that the Fabric one does not. */
export const TARGET_SCENE_WORDS = {
  /** What a first check or opening of this target fetches, said before it does (the drawer's note under the running stage). */
  cold: (manifest: TargetManifest) => {
    const size = TARGET_SCENE_DOWNLOADS[manifest.id]
    const about = (value: number | undefined) => (value ? `约 ${megabytes(value)}` : "几百 MB")
    // The instances are the project's own (`store/instance.ts`), so this is said of the project; the game's own files are kept once for every project.
    return {
      check: `这个工程还没有装过 ${targetName(manifest)} 的服务器（${about(size?.check)}），要先下载并用它自己的安装器装好，这个工程之后不用再装。`,
      play: `这个工程还没有装过 ${targetName(manifest)} 的游戏（${about(size?.play)}；游戏本体、运行库、声音和语言文件所有工程共用，这台电脑上已经有的不再下），要先下载并用它自己的安装器装好，这个工程之后不用再装。`,
    }
  },
  /** Said as each part of a first preparation begins (Chinese only, so the drawer shows it, `plainProgress`). */
  server: "准备测试场要用的游戏文件（服务器）。",
  client: "准备测试场要用的游戏文件（游戏本体）。",
  installing: "正在用加载器自己的安装器装好游戏，只有第一次要装，要几分钟。",
  readme: (name: string, target: string, mods: readonly string[], where: { server: string; client: string }) =>
    [
      `# 「${name}」的测试场（${target}）`,
      "",
      `这个模组的测试场用的是 Studio 用 ${target} 自己的安装器装好的游戏：mods 里只有它自己和它必须的前置（${mods.join("、")}），没有别的模组、材质包或光影。`,
      "",
      `- 后台检查用的服务端在：${where.server}`,
      `- 「打开测试场」用的游戏在：${where.client}（游戏文件夹是里面的 game，那里有双击就能打开的启动脚本）`,
      "- 它不经过任何启动器，也不登录账号，所以进不了联机服务器；只用来看这个模组。",
      "- 每次重新部署，这里的 mods 和测试世界都会换成新的；你在这个世界里做的改动不会留下。",
      "",
    ].join("\n"),
} as const

/** The Java the target's game runs on: a folder given for that major, or Studio's setting when the target runs on 21 (Studio's own Java), else Studio installs it. */
const javaFor = (manifest: TargetManifest, options: TargetSceneOptions) => {
  const home = options.javaHomes?.[manifest.java.major] ?? (manifest.java.major === 21 ? options.javaHome : undefined)
  return { ...(home ? { javaHome: home } : {}), ...(options.javaDirectory ? { javaDirectory: options.javaDirectory } : {}) }
}

/**
 * Where a target scene's things lie. The record, the check's log, the mods of the last deploy and the readme are in the same folder as
 * Fabric's scene keeps its own (one project has one target); the two instances are the store's (`store/instance.ts`).
 */
export function targetScenePaths(runtimeDirectory: string, projectId: string, targetId: string) {
  const folder = path.join(runtimeDirectory, "scene", "instances", projectId)
  const server = instanceDirectory(runtimeDirectory, projectId, targetId, "server")
  const client = instanceDirectory(runtimeDirectory, projectId, targetId, "client")
  return {
    folder,
    record: path.join(folder, "scene.json"),
    log: path.join(folder, "scene-check.log"),
    mods: path.join(folder, "mods"),
    server,
    client,
    game: path.join(client, "game"),
    /** The world the check makes and leaves: the server's own, by `level-name`. */
    world: path.join(server, SCENE.world),
  }
}

const exists = (file: string) => stat(file).then(() => true, () => false)
const jars = async (folder: string) => (await readdir(folder).catch(() => [] as string[])).filter((name) => name.toLowerCase().endsWith(".jar")).sort()

/** GeckoLib for the target, fetched once into the shared store and checked by the manifest's hash. */
async function geckolibJar(runtimeDirectory: string, manifest: TargetManifest, options: TargetSceneOptions) {
  const file = manifest.dependencies.geckolib.file
  const name = path.posix.basename(new URL(file.url).pathname)
  const relative = storeLayout.mod(file.sha256 ?? file.sha1 ?? "unhashed", name)
  const fetched = await fetchVerified({ file, destination: path.join(runtimeDirectory, relative), signal: options.signal, ...(options.mirrors === undefined ? {} : { mirrors: options.mirrors }) })
  await registerForTarget(runtimeDirectory, { id: `mod:${name}`, kind: "mod", title: `GeckoLib ${manifest.dependencies.geckolib.version}（${manifest.id}）`, path: relative, source: fetched.source, sha256: file.sha256 ?? null, users: [`target:${manifest.id}`] }).catch(() => undefined)
  return fetched.path
}

/**
 * While the loader's installer runs (minutes, the first time), how much the instance's folder has grown, every few seconds: the
 * installer prints in English only, so this is the line the drawer can show (`growthLine`, which also tells a stalled step).
 */
async function installing<T>(directory: string, options: TargetSceneOptions, work: () => Promise<T>) {
  const before = await measurePath(directory)
  const timer = setInterval(() => {
    void measurePath(directory).then((now) => options.onProgress?.(`${growthLine(COUNTER_LABELS.loader, Math.max(0, Math.round((now - before) / 1e6)))}\n`), () => undefined)
  }, 3000)
  try {
    return await work()
  } finally {
    clearInterval(timer)
  }
}

/** One side of the project's instance, installed when it is not yet: said in the person's words first, then the folder's growth while the installer runs. */
async function ensureSide(runtimeDirectory: string, manifest: TargetManifest, projectId: string, side: "client" | "server", options: TargetSceneOptions) {
  const directory = instanceDirectory(runtimeDirectory, projectId, manifest.id, side)
  const already = await isInstalled(directory, manifest, side)
  if (!already) options.onProgress?.(`${TARGET_SCENE_WORDS.installing}\n`)
  const run = () =>
    ensureLoaderInstance(runtimeDirectory, manifest, {
      side,
      projectId,
      ...javaFor(manifest, options),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.mirrors === undefined ? {} : { mirrors: options.mirrors }),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    })
  return already ? run() : installing(directory, options, run)
}

/**
 * Sets the scene up for one build of a Forge or NeoForge project: the built jar, GeckoLib and the jars of `test-scene-mods`
 * staged beside the record (each read as a mod of the target's loader, and what one of them cannot start without and nobody
 * brings named as missing, as the Fabric scene does); the check's world of an earlier build removed. For the check (the
 * default) the project's server instance is installed (once) and its `mods` filled with the staged jars; opening the game
 * fills the client's from the same jars (`openTargetScene`), so a press of 「打开测试场」 never installs a server.
 */
export async function deployTargetScene(input: { build: BuildResult; project: { id: string; name: string; target: string }; runtimeDirectory: string }, options: TargetSceneOptions): Promise<SceneRecord> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const manifest = targetManifest(input.project.target)
  const paths = targetScenePaths(input.runtimeDirectory, input.project.id, manifest.id)
  const geckolib = await geckolibJar(input.runtimeDirectory, manifest, options)
  const extraDirectory = path.join(input.build.projectDirectory, SCENE_EXTRA)
  const extra = (await jars(extraDirectory)).map((name) => path.join(extraDirectory, name))
  const mods = [input.build.jarPath, geckolib, ...extra]
  const loader = manifest.loader.kind
  const facts = await Promise.all(mods.map(async (file) => (await readModJar(file, loader)) ?? { ids: [], depends: [] }))
  await rm(paths.mods, { recursive: true, force: true })
  await mkdir(paths.mods, { recursive: true })
  await Promise.all(mods.map((file) => copyFile(file, path.join(paths.mods, path.basename(file)))))
  // A world left by a check of an earlier build is not this build's: gone, like the Fabric scene's on every deploy.
  await rm(paths.world, { recursive: true, force: true })
  if (options.purpose !== "play") {
    if (!(await isInstalled(paths.server, manifest, "server"))) options.onProgress?.(`${TARGET_SCENE_WORDS.server}\n`)
    const instance = await ensureSide(input.runtimeDirectory, manifest, input.project.id, "server", options)
    await rm(path.join(instance.directory, "mods"), { recursive: true, force: true })
    await mkdir(path.join(instance.directory, "mods"), { recursive: true })
    await Promise.all(mods.map((file) => copyFile(file, path.join(instance.directory, "mods", path.basename(file)))))
  }
  const record: SceneRecord = {
    schema_version: 1,
    project_id: input.project.id,
    build_id: input.build.id,
    revision: input.build.revision,
    jar_sha256: input.build.sha256,
    mods: mods.map((file) => path.basename(file)).sort(),
    missing: missingMods(facts, loader),
    deployed_at: new Date().toISOString(),
    target: manifest.id,
  }
  await mkdir(paths.folder, { recursive: true })
  await writeFile(paths.record, `${JSON.stringify(record, null, 2)}\n`)
  await writeFile(path.join(paths.folder, "测试场说明.md"), TARGET_SCENE_WORDS.readme(input.project.name, manifest.id, record.mods, { server: paths.server, client: paths.client }))
  await useInstance(input.runtimeDirectory, manifest, input.project.id)
  return record
}

/** Marks the instance as the project's, so tidying up keeps it while the project has this target. */
const useInstance = (runtimeDirectory: string, manifest: TargetManifest, projectId: string) =>
  registerForTarget(runtimeDirectory, { id: storeIds.instance(projectId, manifest.id), kind: "instance", title: `游戏实例 · ${manifest.loader.kind === "forge" ? "Forge" : "NeoForge"} ${manifest.minecraft.version}`, path: storeLayout.instance(projectId, manifest.id), source: "kept", users: [`project:${projectId}`, `target:${manifest.id}`] }).catch(() => undefined)

/** The file whose presence says the client's game files were all fetched and checked once (`prepareTargetClient`); named for the asset index, which is most of them. */
const clientStamp = (directory: string, manifest: TargetManifest) => path.join(directory, `.minemods-game-files-${manifest.minecraft.assetIndex.file.sha1 ?? manifest.minecraft.assetIndex.id}`)

/**
 * Whether what each side needs is already on this computer, for the words about a first time: the check's server instance installed by
 * this very installer, and the client instance installed with all of the game's files fetched and checked once (`prepareTargetClient`).
 */
export async function targetSceneReady(runtimeDirectory: string, projectId: string, manifest: TargetManifest): Promise<{ check: boolean; play: boolean }> {
  const paths = targetScenePaths(runtimeDirectory, projectId, manifest.id)
  const [check, client, stamped] = await Promise.all([isInstalled(paths.server, manifest, "server"), isInstalled(paths.client, manifest, "client"), exists(clientStamp(paths.client, manifest))])
  return { check, play: client && stamped }
}

/**
 * The sounds, languages and icons already on this computer under another of Studio's folders (the Fabric scene's, Loom's), placed in the
 * store's by a hard link (a copy where the disk does not allow one) before anything is downloaded; `ensureVanilla` then checks every
 * one by its hash and fetches only what is still missing or wrong. A game version shares most of these with every other.
 */
async function seedAssets(runtimeDirectory: string, manifest: TargetManifest, options: TargetSceneOptions) {
  const store = vanillaPaths(runtimeDirectory, manifest.minecraft.version)
  const index = path.join(store.assetsRoot, "indexes", `${manifest.minecraft.assetIndex.id}.json`)
  await fetchVerified({ file: manifest.minecraft.assetIndex.file, destination: index, signal: options.signal, ...(options.mirrors === undefined ? {} : { mirrors: options.mirrors }) })
  const objects = (JSON.parse(await readFile(index, "utf8")) as { objects?: Record<string, { hash?: string }> }).objects ?? {}
  const hashes = [...new Set(Object.values(objects).flatMap((object) => (object.hash && /^[0-9a-f]{40}$/.test(object.hash) ? [object.hash] : [])))]
  const elsewhere = [path.join(runtimeDirectory, "scene", "fabric-1.21.1", "assets", "objects"), path.join(runtimeDirectory, "gradle-home", "caches", "fabric-loom", "assets", "objects")]
  for (const hash of hashes) {
    if (options.signal?.aborted) throw new Error("CANCELLED")
    const destination = path.join(store.assetsRoot, "objects", hash.slice(0, 2), hash)
    if (await exists(destination)) continue
    for (const root of elsewhere) {
      const source = path.join(root, hash.slice(0, 2), hash)
      if (!(await exists(source))) continue
      await mkdir(path.dirname(destination), { recursive: true })
      await link(source, destination).catch(() => copyFile(source, destination)).catch(() => undefined)
      break
    }
  }
}

/** What each stage of the game's files is called in the counter the drawer shows (`COUNTER_LABELS`); the version file is too small to count. */
const VANILLA_LABELS: Partial<Record<VanillaProgress["stage"], string>> = { client: COUNTER_LABELS.client, libraries: COUNTER_LABELS.runtime, assets: COUNTER_LABELS.assets }

/**
 * Everything the client of the target needs, once: the game's jar, its libraries and its sounds and languages in the shared store (each
 * held to Mojang's hash), and the client instance installed by the loader's own installer. Said in the Fabric scene's words and counters.
 * A second time it is only a look at the stamp and the installer's marker.
 */
export async function prepareTargetClient(runtimeDirectory: string, manifest: TargetManifest, projectId: string, options: TargetSceneOptions) {
  const paths = targetScenePaths(runtimeDirectory, projectId, manifest.id)
  const stamp = clientStamp(paths.client, manifest)
  if (!(await exists(stamp)) || !(await isInstalled(paths.client, manifest, "client"))) {
    options.onProgress?.(`${TARGET_SCENE_WORDS.client}\n`)
    const download = { ...(options.signal ? { signal: options.signal } : {}), ...(options.mirrors === undefined ? {} : { mirrors: options.mirrors }) }
    const said = new Map<string, string>()
    const onProgress = (progress: VanillaProgress) => {
      const label = VANILLA_LABELS[progress.stage]
      // The asset index comes as a stage of one file before the objects; only the objects are counted.
      if (!label || (progress.stage === "assets" && progress.totalFiles <= 1)) return
      const line = countLine(label, progress.files, progress.totalFiles)
      if (said.get(label) === line) return
      said.set(label, line)
      options.onProgress?.(`${line}\n`)
    }
    await ensureVanilla(runtimeDirectory, manifest, { ...download, include: { client: true, libraries: true, assets: false }, onProgress })
    await seedAssets(runtimeDirectory, manifest, options)
    await ensureVanilla(runtimeDirectory, manifest, { ...download, include: { client: false, libraries: false, assets: true }, onProgress })
    await ensureSide(runtimeDirectory, manifest, projectId, "client", options)
    await writeFile(stamp, `${new Date().toISOString()}\n`)
  }
  return paths
}

const quoted = (value: string) => (/^[A-Za-z0-9_\-./:=+]+$/.test(value) ? value : `"${value.replaceAll("%", "%%")}"`)

/**
 * Opens the scene of a Forge or NeoForge project in the game for the person and returns when they close it, as `openScene` does for
 * Fabric: the client instance prepared (once), its `mods` filled with the jars of the last deploy, the world the check left for this
 * build copied in from the server and opened for commands (straight into it), else the game's main menu with the same mods. `crash`
 * is what `findGameCrash` made of how the game ended, kept in the scene's record for the hand-off to the AI.
 */
export async function openTargetScene(input: { projectId: string; runtimeDirectory: string; modId?: string }, record: SceneRecord & { target: string }, options: TargetSceneOptions) {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const manifest = targetManifest(record.target)
  const paths = await prepareTargetClient(input.runtimeDirectory, manifest, input.projectId, options)
  // The jars of the last deploy; a record from before they were kept beside it (the check's first version) has them in the server's `mods`.
  const staged = (await jars(paths.mods)).length ? paths.mods : path.join(paths.server, "mods")
  const mods = await jars(staged)
  const gameMods = path.join(paths.game, "mods")
  await rm(gameMods, { recursive: true, force: true })
  await mkdir(gameMods, { recursive: true })
  await Promise.all(mods.map((name) => copyFile(path.join(staged, name), path.join(gameMods, name))))
  const saved = path.join(paths.game, "saves", SCENE.world)
  await rm(saved, { recursive: true, force: true })
  const world = await exists(path.join(paths.world, "level.dat"))
  if (world) {
    await cp(paths.world, saved, { recursive: true, filter: (source) => path.basename(source) !== "session.lock" })
    const level = path.join(saved, "level.dat")
    const opened = allowSceneCommands(await readFile(level))
    if (opened) await writeFile(level, opened)
  }
  if (!(await exists(path.join(paths.game, "options.txt")))) await writeFile(path.join(paths.game, "options.txt"), SCENE_OPTIONS)
  const command = await clientLaunchCommand(input.runtimeDirectory, manifest, {
    projectId: input.projectId,
    ...javaFor(manifest, options),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.mirrors === undefined ? {} : { mirrors: options.mirrors }),
  })
  // The game's own window, without a console beside it on Windows (as the Fabric scene starts it).
  const windowed = process.platform === "win32" ? path.join(path.dirname(command.java), "javaw.exe") : command.java
  const java = (await exists(windowed)) ? windowed : command.java
  const args = [...command.args, "--width", "1280", "--height", "720", ...(world ? ["--quickPlaySingleplayer", SCENE.world] : [])]
  await writeFile(
    path.join(paths.game, process.platform === "win32" ? "打开测试场.bat" : "open-test-scene.sh"),
    process.platform === "win32"
      ? ["@echo off", "chcp 65001 >nul", 'cd /d "%~dp0"', `start "" ${[java, ...args].map(quoted).join(" ")}`, ""].join("\r\n")
      : ["#!/bin/sh", 'cd "$(dirname "$0")"', `exec ${[java, ...args].map((value) => `'${value.replaceAll("'", `'\\''`)}'`).join(" ")}`, ""].join("\n"),
    { mode: 0o755 },
  )
  options.onProgress?.("正在打开测试场。\n")
  const feed = watchGame((stage) => options.onProgress?.(`${stage === "title" ? SCENE_WORDS.at_title : SCENE_WORDS.in_game}\n`))
  const onProgress = (text: string) => {
    options.onProgress?.(text)
    feed(text)
  }
  // The loaders write the game's log to `logs/latest.log` as well; read like the Fabric scene's, for output that does not reach the job.
  const launched = Date.now()
  const log = path.join(command.cwd, "logs", "latest.log")
  const watch = setInterval(() => {
    void stat(log)
      .then(async (found) => (found.mtimeMs >= launched - 1000 ? feed(await readFile(log, "utf8")) : undefined))
      .catch(() => undefined)
  }, SCENE_LOG_POLL_MS)
  const result = await runOwnedProcess(java, args, { cwd: command.cwd, signal: options.signal, timeoutMs: 14400000, onProgress, visible: true }).finally(() => clearInterval(watch))
  const crash = await findGameCrash({ instance: command.cwd, launched, code: result.code, output: result.output, ...(input.modId ? { modId: input.modId } : {}) })
  await keepCrash(input.runtimeDirectory, input.projectId, record.build_id, crash)
  return { world, code: result.code, crash }
}

/**
 * The scene's commands for a game version: 1.20.1 (before item components) writes an item's count in NBT as `Count:1b`.
 * And on both versions the game's text display logs an error for every one summoned without an `alignment` (it reads the
 * missing tag as a string anyway: seen on the real Forge 1.20.1 and NeoForge 1.21.1 servers), so the scene's names say the
 * default, `center`, outright. Everything else the plan sends (setblock, summon, item replace, data get, save-all) reads the same.
 */
export function targetScenePlan(plan: ScenePlan, minecraft: string): ScenePlan {
  const counted = (command: string) => (minecraft === "1.20.1" ? command.replace(/item:\{id:"([^"]+)",count:1\}/g, 'item:{id:"$1",Count:1b}') : command)
  const map = (step: SceneStep): SceneStep => ({
    ...step,
    command: counted(step.command).replaceAll('id:"minecraft:text_display",', 'id:"minecraft:text_display",alignment:"center",').replace(/^summon minecraft:text_display ([^{]+)\{/, 'summon minecraft:text_display $1{alignment:"center",'),
  })
  return { ...plan, place: plan.place.map(map), ask: plan.ask.map(map), close: plan.close.map(map) }
}

/**
 * The scene's own data pack (`SCENE_DATAPACK`) for a game version: 1.20.1 reads pack format 15 and the plural folders
 * (`functions`, `tags/functions`); 1.21.1 is the pack as it is.
 */
export function targetSceneDatapack(minecraft: string): Record<string, string> {
  if (minecraft !== "1.20.1") return { ...SCENE_DATAPACK.files }
  return Object.fromEntries(
    Object.entries(SCENE_DATAPACK.files).map(([file, text]) => [
      file.replace("/tags/function/", "/tags/functions/").replace(/^data\/([^/]+)\/function\//, "data/$1/functions/"),
      file === "pack.mcmeta" ? text.replace(`"pack_format": ${SCENE_DATAPACK.format}`, '"pack_format": 15') : text,
    ]),
  )
}

/** A line of the server's log without its time, its thread and (Forge's and NeoForge's own) the logger's name: `[time] [Server thread/INFO] [minecraft/MinecraftServer]: Changed …`. */
export const targetSaid = (line: string) => sceneSaid(line).replace(/^\[[\w./-]+\]:? ?/, "").trim()

/** `server.properties` of the scene as the keys `serverLaunchCommand` sets: one flat world named for the scene, this computer only. */
function sceneProperties() {
  return Object.fromEntries(
    sceneServerProperties(0)
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("server-port=") && !line.startsWith("online-mode="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  )
}

/**
 * The windowless check for a Forge or NeoForge project, as `checkScene` does it for Fabric: starts the project's server
 * with the deployed mods, sets every thing of the project out over the console, waits, asks the game about each, saves
 * the world and stops. `eula` is the person's own agreement to the game's licence.
 */
export async function checkTargetScene(
  input: { project: Parameters<typeof scenePlan>[0] & { id: string }; plan?: ScenePlan; runtimeDirectory: string; eula: boolean; settle?: number },
  record: SceneRecord & { target: string },
  options: TargetSceneOptions,
): Promise<SceneReport> {
  if (!input.eula) throw new Error("SCENE_EULA")
  const manifest = targetManifest(record.target)
  const command = await serverLaunchCommand(input.runtimeDirectory, manifest, {
    projectId: input.project.id,
    ...javaFor(manifest, options),
    ...(options.signal ? { signal: options.signal } : {}),
    properties: { ...sceneProperties(), "level-name": SCENE.world },
  })
  const world = path.join(command.cwd, SCENE.world)
  await rm(world, { recursive: true, force: true })
  // Before the game makes the world: a pack in its folder is switched on with it (see `SCENE_DATAPACK`).
  for (const [file, text] of Object.entries(targetSceneDatapack(manifest.minecraft.version))) {
    const at = path.join(world, "datapacks", SCENE_DATAPACK.folder, ...file.split("/"))
    await mkdir(path.dirname(at), { recursive: true })
    await writeFile(at, text)
  }
  const plan = targetScenePlan(input.plan ?? scenePlan(input.project), manifest.minecraft.version)
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
    answers.push({ step, said: lines.slice(from, at < 0 ? lines.length : at).map(targetSaid).filter(Boolean) })
    return at >= 0
  }
  const running = runOwnedProcess(command.java, command.args, {
    cwd: command.cwd,
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
  await running
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const report = sceneReport({ mod_id: input.project.mod_id, plan, answers, log: lines, started: state.started })
  // The loader lists its mods in its own way; what was in the game is what was deployed into `mods`.
  const whole = { ...report, mods: report.mods.length ? report.mods : record.mods }
  await writeFile(targetScenePaths(input.runtimeDirectory, input.project.id, record.target).log, `${lines.join("\n")}\n`)
  await writeFile(targetScenePaths(input.runtimeDirectory, input.project.id, record.target).record, `${JSON.stringify({ ...record, checked_at: new Date().toISOString(), report: whole } satisfies SceneRecord, null, 2)}\n`)
  return whole
}

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { readCatalog } from "../src/store/catalog"
import { HostLimiter, SourceHealth } from "../src/store/fetch"
import { BMCLAPI_MAVEN, ensureLoaderInstance, type InstallRunner } from "../src/store/instance"
import { clientLaunchCommand, serverLaunchCommand } from "../src/store/launch"
import { ensureVanilla, type VanillaProgress } from "../src/store/minecraft"
import type { TargetManifest } from "../src/target/manifest"
import { targetManifest } from "../src/target/manifests"

/*
 * The whole path without the network or Java: a local server stands in for Mojang and the mirrors (every official
 * address is rewritten to it), and the installer is a stand-in that writes what the real one leaves behind.
 */

const files = new Map<string, Uint8Array>()
const requested: string[] = []
let server: Server
let base = ""
const directories: string[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const key = decodeURIComponent(new URL(request.url ?? "/", "http://local").pathname)
    requested.push(key)
    const body = files.get(key)
    if (!body) return void response.writeHead(404).end("missing")
    response.writeHead(200, { "content-length": body.byteLength }).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})
afterEach(async () => {
  requested.length = 0
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const runtime = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods 中文 实例-"))
  directories.push(directory)
  return directory
}
const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex")
const bytes = (text: string) => new TextEncoder().encode(text)
/** Mojang's client mappings as the fixture's version file names them; an installer that fetched them cut short leaves the first part. */
const MAPPINGS = bytes("# (c) 2020 Microsoft Corporation.\nnet.minecraft.client.Minecraft -> fgo:\n    int fps -> c\n")
const writeMappings = async (instance: string, body: Uint8Array) => {
  const folder = path.join(instance, "libraries", "net", "minecraft", "client", "1.20.1-20230612.114412")
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, "client-1.20.1-20230612.114412-mappings.txt"), body)
}
/** Serves `body` for an official address; returns the pinned file for it. */
const serve = (url: string, body: Uint8Array) => {
  const { host, pathname } = new URL(url)
  files.set(`/${host}${pathname}`, body)
  return { url, sha1: sha1(body), size: body.byteLength }
}
const download = () => ({
  sources: (url: string) => [{ source: "bmclapi" as const, url: `${base}/${new URL(url).host}${new URL(url).pathname}` }],
  health: new SourceHealth(),
  limiter: new HostLimiter(4),
  stallMs: 5000,
})

/** A small 1.20.1 world: version file, jars, three libraries (one each for this system, 32-bit Windows and Linux), and an index with two objects. */
function fixture(): TargetManifest {
  const real = targetManifest("forge-1.20.1")
  const client = serve("https://piston-data.mojang.com/v1/objects/c/client.jar", bytes("client jar"))
  const serverJar = serve("https://piston-data.mojang.com/v1/objects/s/server.jar", bytes("server jar"))
  const sound = bytes("a sound")
  const icon = bytes("an icon")
  serve(`https://resources.download.minecraft.net/${sha1(sound).slice(0, 2)}/${sha1(sound)}`, sound)
  serve(`https://resources.download.minecraft.net/${sha1(icon).slice(0, 2)}/${sha1(icon)}`, icon)
  const index = serve("https://piston-meta.mojang.com/v1/packages/i/5.json", bytes(JSON.stringify({ objects: { "minecraft/sounds/a.ogg": { hash: sha1(sound), size: sound.byteLength }, "minecraft/sounds/b.ogg": { hash: sha1(sound), size: sound.byteLength }, "icons/icon.png": { hash: sha1(icon), size: icon.byteLength } } })))
  const library = (name: string, relative: string, served: boolean, rules?: unknown[]) => {
    const url = `https://libraries.minecraft.net/${relative}`
    const body = bytes(`jar of ${name}`)
    const file = served ? serve(url, body) : { url, sha1: sha1(body), size: body.byteLength }
    return { name, downloads: { artifact: { path: relative, ...file } }, ...(rules ? { rules } : {}) }
  }
  const version = {
    id: "1.20.1",
    mainClass: "net.minecraft.client.main.Main",
    assetIndex: { id: "5", ...index },
    downloads: { client, server: serverJar, client_mappings: { url: "https://piston-data.mojang.com/v1/objects/m/client.txt", sha1: sha1(MAPPINGS), size: MAPPINGS.byteLength } },
    libraries: [
      library("com.mojang:logging:1.1.1", "com/mojang/logging/1.1.1/logging-1.1.1.jar", true),
      library("org.lwjgl:lwjgl:3.3.1:natives-windows", "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar", true, [{ action: "allow", os: { name: "windows" } }]),
      // Not served: fetching either would fail the test.
      library("org.lwjgl:lwjgl:3.3.1:natives-windows-x86", "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows-x86.jar", false, [{ action: "allow", os: { name: "windows" } }]),
      library("org.lwjgl:lwjgl:3.3.1:natives-linux", "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-linux.jar", false, [{ action: "allow", os: { name: "linux" } }]),
    ],
    arguments: {
      game: ["--username", "${auth_player_name}", "--version", "${version_name}", "--gameDir", "${game_directory}", "--assetsDir", "${assets_root}", "--assetIndex", "${assets_index_name}", { rules: [{ action: "allow", features: { is_demo_user: true } }], value: "--demo" }],
      jvm: [{ rules: [{ action: "allow", os: { name: "osx" } }], value: ["-XstartOnFirstThread"] }, "-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
    },
  }
  const metadata = serve("https://piston-meta.mojang.com/v1/packages/m/1.20.1.json", bytes(JSON.stringify(version)))
  const installer = serve("https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar", bytes("installer jar"))
  return {
    ...real,
    minecraft: { version: "1.20.1", metadata, client, server: serverJar, assetIndex: { id: "5", file: index } },
    loader: { ...real.loader, install: { kind: "installer", file: { url: installer.url, sha1: installer.sha1, size: installer.size } } },
  }
}

test("原版文件：版本文件、客户端、这台机器的库、资源按哈希放进共用仓库；登记给目标；再来一次什么都不下", async () => {
  const root = await runtime()
  const manifest = fixture()
  const progress: VanillaProgress[] = []
  const first = await ensureVanilla(root, manifest, { ...download(), onProgress: (step) => progress.push(step) })
  expect(first.fetched.files).toBe(1 + 1 + 2 + 1 + 2)
  expect(await readFile(first.clientJar!, "utf8")).toBe("client jar")
  expect(first.serverJar).toBeNull()
  expect(first.libraries).toEqual(["com/mojang/logging/1.1.1/logging-1.1.1.jar", "org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar"])
  expect((await stat(path.join(first.librariesRoot, "org", "lwjgl", "lwjgl", "3.3.1", "lwjgl-3.3.1-natives-windows.jar"))).isFile()).toBe(true)
  expect(requested.some((request) => request.includes("natives-windows-x86") || request.includes("natives-linux"))).toBe(false)
  const sound = sha1(bytes("a sound"))
  expect(await readFile(path.join(first.assetsRoot, "objects", sound.slice(0, 2), sound), "utf8")).toBe("a sound")
  expect((await stat(path.join(first.assetsRoot, "indexes", "5.json"))).isFile()).toBe(true)
  expect(first.assetsRoot.startsWith(root)).toBe(true)
  expect(progress.at(-1)).toMatchObject({ stage: "assets", files: 2, totalFiles: 2 })

  const listed = (await readCatalog(root)).items
  expect(listed.map((item) => [item.id, item.kind, item.source, item.users])).toEqual([
    ["assets:shared", "assets", "bmclapi", ["target:forge-1.20.1"]],
    ["libraries:shared", "libraries", "bmclapi", ["target:forge-1.20.1"]],
    ["minecraft:1.20.1", "minecraft", "bmclapi", ["target:forge-1.20.1"]],
  ])
  expect(listed.find((item) => item.id === "minecraft:1.20.1")?.path).toBe(path.join("store", "minecraft", "versions", "1.20.1"))

  requested.length = 0
  const second = await ensureVanilla(root, manifest, download())
  expect(second.fetched).toEqual({ files: 0, bytes: 0 })
  expect(requested).toEqual([])
  const again = (await readCatalog(root)).items
  expect(again.map((item) => [item.source, item.installed_at])).toEqual(listed.map((item) => [item.source, item.installed_at]))
})

test("原版文件和清单对不上就停：清单写错了不能装", async () => {
  const root = await runtime()
  const manifest = fixture()
  await expect(ensureVanilla(root, { ...manifest, minecraft: { ...manifest.minecraft, client: { ...manifest.minecraft.client, sha1: "0".repeat(40) } } }, download())).rejects.toThrow("VERSION_FILE_DISAGREES_WITH_MANIFEST")
})

test("装实例：先放好校验过的原版文件和 launcher_profiles.json，镜像装失败就不带镜像再装一次；工作目录是实例；登记；再来一次不装", async () => {
  const root = await runtime()
  const manifest = fixture()
  const projectId = randomUUID()
  const calls: { java: string; args: string[]; cwd: string; appdata?: string }[] = []
  const runner: InstallRunner = async (java, args, options) => {
    calls.push({ java, args, cwd: options.cwd, appdata: options.env.APPDATA })
    // What the installer would check before it starts: the vanilla files and the profiles file.
    expect(await readFile(path.join(options.cwd, "versions", "1.20.1", "1.20.1.jar"), "utf8")).toBe("client jar")
    expect(JSON.parse(await readFile(path.join(options.cwd, "launcher_profiles.json"), "utf8"))).toEqual({ profiles: {} })
    if (args.includes("--mirror")) return { code: 1, output: "Exception: Checksum invalid for a library from the mirror\n" }
    const id = "1.20.1-forge-47.4.28"
    await mkdir(path.join(options.cwd, "versions", id), { recursive: true })
    await writeFile(path.join(options.cwd, "versions", id, `${id}.json`), JSON.stringify({ id, inheritsFrom: "1.20.1" }))
    return { code: 0, output: "The client installed successfully\n" }
  }
  const result = await ensureLoaderInstance(root, manifest, { ...download(), side: "client", projectId, javaExecutable: "C:\\jdk 17\\bin\\java.exe", runner })
  const directory = path.join(root, "store", "instances", projectId, "forge-1.20.1", "client")
  expect(result).toMatchObject({ directory, side: "client", versionId: "1.20.1-forge-47.4.28", installed: "official" })
  expect(calls).toHaveLength(2)
  const installerJar = path.join(root, "store", "loaders", "forge-1.20.1-47.4.28", "forge-1.20.1-47.4.28-installer.jar")
  expect(calls[0]).toEqual({ java: "C:\\jdk 17\\bin\\java.exe", args: ["-Djava.awt.headless=true", "-Dfile.encoding=UTF-8", "-jar", installerJar, "--installClient", directory, "--mirror", BMCLAPI_MAVEN], cwd: directory, appdata: directory })
  expect(calls[1].args.slice(-2)).toEqual(["--installClient", directory])
  // Only the files the install needs: no libraries and no assets yet.
  expect(requested.some((request) => request.includes("libraries.minecraft.net") || request.includes("resources.download"))).toBe(false)

  const items = (await readCatalog(root)).items
  expect(items.find((item) => item.id === `instance:${projectId}.forge-1.20.1`)).toMatchObject({ kind: "instance", source: "official", users: [`project:${projectId}`, "target:forge-1.20.1"], path: path.join("store", "instances", projectId, "forge-1.20.1") })
  expect(items.find((item) => item.id === "loader:forge-1.20.1-47.4.28")).toMatchObject({ kind: "loader", users: ["target:forge-1.20.1"] })

  const again = await ensureLoaderInstance(root, manifest, { ...download(), side: "client", projectId, javaExecutable: "java", runner })
  expect(again.installed).toBe("already")
  expect(calls).toHaveLength(2)
})

test("装实例：安装器自己下的 Mojang 映射没下完整（下一步读它就崩），同一种方式再装一次；一直不完整，最多多装两次，失败原因里说清楚", async () => {
  const root = await runtime()
  const manifest = fixture()
  const projectId = randomUUID()
  const directory = path.join(root, "store", "instances", projectId, "forge-1.20.1", "client")
  const id = "1.20.1-forge-47.4.28"
  const progress: string[] = []
  const calls: string[][] = []
  // First run: the mappings are cut short and the next step fails on them; second run: they arrive whole and the install ends.
  const runner: InstallRunner = async (_java, args, options) => {
    calls.push(args)
    if (calls.length === 1) {
      await writeMappings(options.cwd, MAPPINGS.slice(0, 40))
      return { code: 1, output: "Downloaded Mojang mappings for 1.20.1\njava.lang.ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 2\nThere was an error during installation\n" }
    }
    await writeMappings(options.cwd, MAPPINGS)
    await mkdir(path.join(options.cwd, "versions", id), { recursive: true })
    await writeFile(path.join(options.cwd, "versions", id, `${id}.json`), JSON.stringify({ id, inheritsFrom: "1.20.1" }))
    return { code: 0, output: "The client installed successfully\n" }
  }
  const result = await ensureLoaderInstance(root, manifest, { ...download(), side: "client", projectId, javaExecutable: "java", runner, onProgress: (text) => progress.push(text) })
  expect(result).toMatchObject({ directory, installed: "mirror" })
  expect(calls).toHaveLength(2)
  expect(calls.every((args) => args.includes("--mirror"))).toBe(true)
  expect(progress.join("")).toContain("Mojang's client mappings arrived incomplete (client-1.20.1-20230612.114412-mappings.txt); running the installer again.")

  // Always cut short: the mirror's run and two more, then the official addresses once; the reason is in the error.
  const always = randomUUID()
  const count: string[][] = []
  const cut: InstallRunner = async (_java, args, options) => {
    count.push(args)
    await writeMappings(options.cwd, MAPPINGS.slice(0, 40))
    return { code: 1, output: "java.lang.ArrayIndexOutOfBoundsException: Index 3 out of bounds for length 2\n" }
  }
  const error = await ensureLoaderInstance(root, manifest, { ...download(), side: "client", projectId: always, javaExecutable: "java", runner: cut }).catch((caught: Error) => caught)
  expect(count.map((args) => args.includes("--mirror"))).toEqual([true, true, true, false])
  expect(String(error)).toContain("mirror: exit 1 (Mojang mappings incomplete): java.lang.ArrayIndexOutOfBoundsException")

  // Whole mappings and a failure for some other reason: no extra run.
  const other = randomUUID()
  const plain: string[][] = []
  const failing: InstallRunner = async (_java, args, options) => {
    plain.push(args)
    await writeMappings(options.cwd, MAPPINGS)
    return { code: 1, output: "java.lang.RuntimeException: nope\n" }
  }
  await ensureLoaderInstance(root, manifest, { ...download(), side: "client", projectId: other, javaExecutable: "java", runner: failing }).catch(() => undefined)
  expect(plain).toHaveLength(2)
})

test("装实例：网络断了（握手被断、镜像拒绝）等一会儿用同一种方式再装，最多两次；一直断就说是网络问题，安装器自己的错不重试", async () => {
  const root = await runtime()
  const manifest = fixture()
  const id = "1.20.1-forge-47.4.28"
  const handshake = "java.io.IOException: Server returned HTTP response code: 403 for URL: https://cmcc.mirrors.ustc.edu.cn/bmclapi/x.zip\njavax.net.ssl.SSLHandshakeException: Remote host terminated the handshake\nThere was an error during installation\n"
  // Cut once, then through, the same way (the mirror).
  const progress: string[] = []
  const calls: string[][] = []
  const flaky: InstallRunner = async (_java, args, options) => {
    calls.push(args)
    if (calls.length === 1) return { code: 1, output: handshake }
    await mkdir(path.join(options.cwd, "versions", id), { recursive: true })
    await writeFile(path.join(options.cwd, "versions", id, `${id}.json`), JSON.stringify({ id, inheritsFrom: "1.20.1" }))
    return { code: 0, output: "The server installed successfully\n" }
  }
  const result = await ensureLoaderInstance(root, manifest, { ...download(), side: "client", projectId: randomUUID(), javaExecutable: "java", runner: flaky, retryWaitsMs: [0, 0], onProgress: (text) => progress.push(text) })
  expect(result.installed).toBe("mirror")
  expect(calls.map((args) => args.includes("--mirror"))).toEqual([true, true])
  expect(progress.join("")).toContain("lost the network")

  // Always cut: the mirror, twice more, then the official addresses once; the error says it was the network.
  const count: string[][] = []
  const cut: InstallRunner = async (_java, args) => {
    count.push(args)
    return { code: 1, output: handshake }
  }
  const error = (await ensureLoaderInstance(root, manifest, { ...download(), side: "server", projectId: randomUUID(), javaExecutable: "java", runner: cut, retryWaitsMs: [0, 0] }).catch((caught: unknown) => caught)) as Error & { code?: string }
  expect(count.map((args) => args.includes("--mirror"))).toEqual([true, true, true, false])
  expect(error.code).toBe("LOADER_INSTALL_NETWORK")
  expect(error.message).toContain("mirror: exit 1 (network)")

  // The installer's own error: no wait, no extra run, and it is not called the network.
  const plain: string[][] = []
  const failing: InstallRunner = async (_java, args) => {
    plain.push(args)
    return { code: 1, output: "java.lang.RuntimeException: nope\n" }
  }
  const own = (await ensureLoaderInstance(root, manifest, { ...download(), side: "server", projectId: randomUUID(), javaExecutable: "java", runner: failing }).catch((caught: unknown) => caught)) as Error & { code?: string }
  expect(plain).toHaveLength(2)
  expect(own.code).toBe("LOADER_INSTALL_FAILED")
})

test("装实例：两次都失败就说清楚；取消就停；Fabric 和不像工程编号的不收", async () => {
  const root = await runtime()
  const manifest = fixture()
  const projectId = randomUUID()
  const failing: InstallRunner = async () => ({ code: 1, output: "java.lang.RuntimeException: nope\n" })
  const error = await ensureLoaderInstance(root, manifest, { ...download(), side: "server", projectId, javaExecutable: "java", runner: failing }).catch((caught: Error) => caught)
  expect(String(error)).toContain("LOADER_INSTALL_FAILED: mirror: exit 1: java.lang.RuntimeException: nope; official: exit 1")
  // The server side gets the server jar where both installers look for it, and no profiles file.
  const serverDirectory = path.join(root, "store", "instances", projectId, "forge-1.20.1", "server")
  expect(await readFile(path.join(serverDirectory, "libraries", "net", "minecraft", "server", "1.20.1", "server-1.20.1.jar"), "utf8")).toBe("server jar")
  expect(await stat(path.join(serverDirectory, "launcher_profiles.json")).catch(() => null)).toBeNull()

  const controller = new AbortController()
  const cancelling: InstallRunner = async () => {
    controller.abort()
    throw new Error("CANCELLED")
  }
  await expect(ensureLoaderInstance(root, manifest, { ...download(), side: "server", projectId, javaExecutable: "java", runner: cancelling, signal: controller.signal })).rejects.toThrow("CANCELLED")

  await expect(ensureLoaderInstance(root, targetManifest("fabric-1.21.1"), { side: "client", projectId })).rejects.toThrow("NOT_AN_INSTALLER_LOADER")
  await expect(ensureLoaderInstance(root, manifest, { side: "client", projectId: "../../escape" })).rejects.toThrow("INVALID_PROJECT_ID")
})

test("客户端命令：合并版本文件、补齐缺的库、游戏本体按加载器版本命名放上类路径、资源用共用仓库", async () => {
  const root = await runtime()
  const manifest = fixture()
  const projectId = randomUUID()
  await ensureVanilla(root, manifest, download())
  const id = "1.20.1-forge-47.4.28"
  const loaderLibrary = bytes("bootstrap launcher")
  const loaderLibraryUrl = "https://maven.minecraftforge.net/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar"
  serve(loaderLibraryUrl, loaderLibrary)
  const runner: InstallRunner = async (_java, _args, options) => {
    await mkdir(path.join(options.cwd, "versions", id), { recursive: true })
    const made = path.join(options.cwd, "libraries", "net", "minecraftforge", "forge", "1.20.1-47.4.28")
    await mkdir(made, { recursive: true })
    await writeFile(path.join(made, "forge-1.20.1-47.4.28-client.jar"), "patched by the installer")
    await writeFile(
      path.join(options.cwd, "versions", id, `${id}.json`),
      JSON.stringify({
        id,
        inheritsFrom: "1.20.1",
        mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
        libraries: [
          { name: "cpw.mods:bootstraplauncher:1.1.2", downloads: { artifact: { path: "cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar", url: loaderLibraryUrl, sha1: sha1(loaderLibrary), size: loaderLibrary.byteLength } } },
          // Made by the installer, nowhere to download it from.
          { name: "net.minecraftforge:forge:1.20.1-47.4.28:client", downloads: { artifact: { path: "net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-client.jar", url: "", sha1: "0".repeat(40) } } },
        ],
        arguments: { jvm: ["-DignoreList=client-extra,${version_name}.jar", "-DlibraryDirectory=${library_directory}", "-p", "${library_directory}/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar"], game: ["--launchTarget", "forgeclient"] },
      }),
    )
    return { code: 0, output: "" }
  }
  await ensureLoaderInstance(root, manifest, { ...download(), side: "client", projectId, javaExecutable: "java", runner })
  const directory = path.join(root, "store", "instances", projectId, "forge-1.20.1", "client")
  const command = await clientLaunchCommand(root, manifest, { ...download(), projectId, javaExecutable: "C:\\jdk\\bin\\java.exe", player: "蚩尤测试" })
  expect(command.java).toBe("C:\\jdk\\bin\\java.exe")
  expect(command.cwd).toBe(path.join(directory, "game"))
  expect((await stat(path.join(directory, "game", "mods"))).isDirectory()).toBe(true)

  const instanceLibraries = path.join(directory, "libraries")
  const storeLibraries = path.join(root, "store", "minecraft", "libraries")
  const gameJar = path.join(directory, "versions", id, `${id}.jar`)
  expect(command.classpath).toEqual([
    path.join(instanceLibraries, "cpw", "mods", "bootstraplauncher", "1.1.2", "bootstraplauncher-1.1.2.jar"),
    path.join(instanceLibraries, "net", "minecraftforge", "forge", "1.20.1-47.4.28", "forge-1.20.1-47.4.28-client.jar"),
    path.join(storeLibraries, "com", "mojang", "logging", "1.1.1", "logging-1.1.1.jar"),
    path.join(storeLibraries, "org", "lwjgl", "lwjgl", "3.3.1", "lwjgl-3.3.1-natives-windows.jar"),
    gameJar,
  ])
  // The loader's missing library came into the instance (where `-p ${library_directory}/…` looks), checked.
  expect(await readFile(command.classpath[0], "utf8")).toBe("bootstrap launcher")
  expect(await readFile(gameJar, "utf8")).toBe("client jar")

  const args = command.args
  expect(args).not.toContain("-XstartOnFirstThread")
  expect(args).not.toContain("--demo")
  expect(args).toContain(`-Djava.library.path=${path.join(directory, "natives")}`)
  expect(args[args.indexOf("-cp") + 1]).toBe(command.classpath.join(";"))
  expect(args).toContain(`-DignoreList=client-extra,${id}.jar`)
  expect(args).toContain(`-DlibraryDirectory=${instanceLibraries}`)
  expect(args.indexOf("cpw.mods.bootstraplauncher.BootstrapLauncher")).toBeGreaterThan(args.indexOf("-cp"))
  const game = args.slice(args.indexOf("cpw.mods.bootstraplauncher.BootstrapLauncher") + 1)
  expect(game).toEqual(["--username", "蚩尤测试", "--version", id, "--gameDir", path.join(directory, "game"), "--assetsDir", path.join(root, "store", "minecraft", "assets"), "--assetIndex", "5", "--launchTarget", "forgeclient"])

  const items = (await readCatalog(root)).items
  expect(items.find((item) => item.id === `instance:${projectId}.forge-1.20.1`)?.last_used_at).not.toBeNull()

  // A library only the installer can make, gone: said plainly, nothing started.
  await rm(path.join(instanceLibraries, "net", "minecraftforge", "forge"), { recursive: true })
  await expect(clientLaunchCommand(root, manifest, { ...download(), projectId, javaExecutable: "java" })).rejects.toThrow("LIBRARY_MISSING: net.minecraftforge:forge:1.20.1-47.4.28:client")
})

test("服务端命令：@win_args.txt nogui，在服务端目录里；同意 EULA，离线模式，空闲端口，原有设置留着", async () => {
  const root = await runtime()
  const manifest = fixture()
  const projectId = randomUUID()
  await expect(serverLaunchCommand(root, manifest, { projectId, javaExecutable: "java" })).rejects.toThrow("INSTANCE_NOT_INSTALLED")
  const directory = path.join(root, "store", "instances", projectId, "forge-1.20.1", "server")
  const argsFile = path.join(directory, "libraries", "net", "minecraftforge", "forge", "1.20.1-47.4.28", "win_args.txt")
  await mkdir(path.dirname(argsFile), { recursive: true })
  await writeFile(argsFile, "-p libraries/x.jar\n")
  await writeFile(path.join(directory, "server.properties"), "motd=hello\nonline-mode=true\n")
  const command = await serverLaunchCommand(root, manifest, { projectId, javaExecutable: "C:\\jdk 17\\bin\\java.exe" })
  expect(command).toMatchObject({ java: "C:\\jdk 17\\bin\\java.exe", cwd: directory })
  expect(command.args).toEqual(["-Xmx2G", "-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "@libraries/net/minecraftforge/forge/1.20.1-47.4.28/win_args.txt", "nogui"])
  expect(command.port).toBeGreaterThan(0)
  expect(await readFile(path.join(directory, "eula.txt"), "utf8")).toBe("eula=true\n")
  expect(await readFile(path.join(directory, "server.properties"), "utf8")).toBe(`motd=hello\nonline-mode=false\nserver-port=${command.port}\n`)
})

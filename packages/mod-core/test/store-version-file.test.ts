import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { installerArgs, installerEnvironment } from "../src/store/instance"
import { clientArguments, clientLaunchValues, offlineUuid, serverProperties } from "../src/store/launch"
import { assetDownloads, libraryDownloads, mainSource } from "../src/store/minecraft"
import { expandArguments, libraryPath, loaderVersionId, mavenPath, mergeVersions, platformLibraries, rulesAllow, serverArgsFile, type VersionFile } from "../src/store/version-file"
import { targetManifest } from "../src/target/manifests"

const windows = (name: string) => ({ name, rules: [{ action: "allow" as const, os: { name: "windows" } }] })

test("规则：没有规则就要；最后一条适用的说了算；只看功能开关或别的系统、别的位数的规则不适用", () => {
  expect(rulesAllow(undefined)).toBe(true)
  expect(rulesAllow([])).toBe(true)
  expect(rulesAllow([{ action: "allow" }, { action: "disallow", os: { name: "osx" } }])).toBe(true)
  expect(rulesAllow([{ action: "allow" }, { action: "disallow", os: { name: "windows" } }])).toBe(false)
  expect(rulesAllow([{ action: "allow", os: { name: "osx" } }])).toBe(false)
  expect(rulesAllow([{ action: "allow", features: { is_demo_user: true } }])).toBe(false)
  expect(rulesAllow([{ action: "allow", os: { arch: "x86" } }])).toBe(false)
  expect(rulesAllow([{ action: "allow", os: { name: "linux" } }], { os: "linux", arch: "x64" })).toBe(true)
})

test("这台机器要的库：64 位 Windows 只留不带 -x86/-arm64 的原生库，别的系统的不要", () => {
  const version: VersionFile = {
    id: "1.21.1",
    libraries: [
      { name: "com.mojang:logging:1.2.7" },
      windows("org.lwjgl:lwjgl:3.3.3:natives-windows"),
      windows("org.lwjgl:lwjgl:3.3.3:natives-windows-x86"),
      windows("org.lwjgl:lwjgl:3.3.3:natives-windows-arm64"),
      { name: "org.lwjgl:lwjgl:3.3.3:natives-linux", rules: [{ action: "allow", os: { name: "linux" } }] },
      { name: "ca.weblite:java-objc-bridge:1.1", rules: [{ action: "allow", os: { name: "osx" } }] },
    ],
  }
  expect(platformLibraries(version).map((library) => library.name)).toEqual(["com.mojang:logging:1.2.7", "org.lwjgl:lwjgl:3.3.3:natives-windows"])
})

test("库的位置：优先用版本文件写的路径，否则按 Maven 坐标算；带分类、带扩展名；往外跳的路径不收", () => {
  expect(mavenPath("net.minecraftforge:forge:1.20.1-47.4.28:client")).toBe("net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-client.jar")
  expect(mavenPath("de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412@zip")).toBe("de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/mcp_config-1.20.1-20230612.114412.zip")
  expect(() => mavenPath("bad")).toThrow("INVALID_MAVEN_COORDINATE")
  expect(libraryPath({ name: "a.b:c:1", downloads: { artifact: { path: "x/y/c-1.jar" } } })).toBe("x/y/c-1.jar")
  expect(libraryPath({ name: "a.b:c:1", downloads: { artifact: { path: "" } } })).toBe("a/b/c/1/c-1.jar")
  expect(() => libraryPath({ name: "a.b:c:1", downloads: { artifact: { path: "../../outside.jar" } } })).toThrow("UNSAFE_LIBRARY_PATH")
  expect(() => libraryPath({ name: "a.b:c:1", downloads: { artifact: { path: "C:/Windows/x.jar" } } })).toThrow("UNSAFE_LIBRARY_PATH")
})

test("合并版本文件：加载器的主类、库排在前面且同名的以加载器为准，参数是原版在前加载器在后", () => {
  const vanilla: VersionFile = {
    id: "1.20.1",
    mainClass: "net.minecraft.client.main.Main",
    assetIndex: { id: "5", sha1: "a".repeat(40), url: "https://example/5.json" },
    libraries: [{ name: "org.ow2.asm:asm:9.3" }, { name: "com.mojang:logging:1.1.1" }],
    arguments: { jvm: ["-cp", "${classpath}"], game: ["--version", "${version_name}"] },
  }
  const loader: VersionFile = {
    id: "1.20.1-forge-47.4.28",
    inheritsFrom: "1.20.1",
    mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher",
    libraries: [{ name: "org.ow2.asm:asm:9.9.1" }, { name: "net.minecraftforge:forge:1.20.1-47.4.28:client" }],
    arguments: { jvm: ["-DlibraryDirectory=${library_directory}"], game: ["--launchTarget", "forgeclient"] },
  }
  const merged = mergeVersions(loader, vanilla)
  expect(merged.mainClass).toBe("cpw.mods.bootstraplauncher.BootstrapLauncher")
  expect(merged.vanillaId).toBe("1.20.1")
  expect(merged.assetIndex.id).toBe("5")
  expect(merged.libraries.map((library) => [library.name, library.from])).toEqual([
    ["org.ow2.asm:asm:9.9.1", "loader"],
    ["net.minecraftforge:forge:1.20.1-47.4.28:client", "loader"],
    ["com.mojang:logging:1.1.1", "vanilla"],
  ])
  expect(merged.jvm).toEqual(["-cp", "${classpath}", "-DlibraryDirectory=${library_directory}"])
  expect(merged.game).toEqual(["--version", "${version_name}", "--launchTarget", "forgeclient"])
  expect(() => mergeVersions(loader)).toThrow("VERSION_PARENT_MISSING")
  expect(() => mergeVersions(loader, { ...vanilla, id: "1.21.1" })).toThrow("VERSION_PARENT_MISSING")
  expect(mergeVersions(vanilla).libraries.map((library) => library.from)).toEqual(["vanilla", "vanilla"])
})

test("填参数：${…} 换成值，没有值的原样留着；有功能开关或别的系统规则的参数整条不要；列表值展开", () => {
  const out = expandArguments(
    [
      "--username",
      "${auth_player_name}",
      "${unknown_thing}",
      { rules: [{ action: "allow", features: { is_demo_user: true } }], value: "--demo" },
      { rules: [{ action: "allow", os: { name: "osx" } }], value: ["-XstartOnFirstThread"] },
      { rules: [{ action: "allow", os: { name: "windows" } }], value: ["-Dos.name=Windows 10", "-Dos.version=10.0"] },
      "-p",
      "${library_directory}/a.jar${classpath_separator}${library_directory}/b.jar",
    ],
    { auth_player_name: "Tester", library_directory: "C:\\运行 目录\\libraries", classpath_separator: ";" },
  )
  expect(out).toEqual(["--username", "Tester", "${unknown_thing}", "-Dos.name=Windows 10", "-Dos.version=10.0", "-p", "C:\\运行 目录\\libraries/a.jar;C:\\运行 目录\\libraries/b.jar"])
})

test("客户端命令行：内存和编码在前，游戏本体在类路径里，离线玩家的 UUID 和游戏自己算的一样", () => {
  const values = clientLaunchValues({
    versionId: "1.20.1-forge-47.4.28",
    librariesRoot: "C:\\中文 目录\\libraries",
    nativesDirectory: "C:\\中文 目录\\natives",
    gameDirectory: "C:\\中文 目录\\game",
    assetsRoot: "C:\\store\\assets",
    assetIndexId: "5",
    classpath: ["C:\\a.jar", "C:\\中文 目录\\versions\\1.20.1-forge-47.4.28\\1.20.1-forge-47.4.28.jar"],
    player: "Tester",
  })
  const args = clientArguments(
    { mainClass: "cpw.mods.bootstraplauncher.BootstrapLauncher", jvm: ["-cp", "${classpath}", "-DignoreList=client-extra,${version_name}.jar"], game: ["--gameDir", "${game_directory}", "--assetIndex", "${assets_index_name}", "--uuid", "${auth_uuid}"] },
    values,
  )
  expect(args.slice(0, 2)).toEqual(["-Xmx2G", "-Dfile.encoding=UTF-8"])
  expect(args).toContain("C:\\a.jar;C:\\中文 目录\\versions\\1.20.1-forge-47.4.28\\1.20.1-forge-47.4.28.jar")
  expect(args).toContain("-DignoreList=client-extra,1.20.1-forge-47.4.28.jar")
  expect(args.indexOf("cpw.mods.bootstraplauncher.BootstrapLauncher")).toBe(args.indexOf("--gameDir") - 1)
  expect(args).toContain("C:\\中文 目录\\game")
  // Java: UUID.nameUUIDFromBytes("OfflinePlayer:Tester".getBytes(UTF_8)).
  const md5 = createHash("md5").update("OfflinePlayer:Tester").digest()
  md5[6] = (md5[6] & 0x0f) | 0x30
  md5[8] = (md5[8] & 0x3f) | 0x80
  expect(offlineUuid("Tester")).toBe(md5.toString("hex"))
  expect(offlineUuid("Tester")[12]).toBe("3")
  expect(values.auth_access_token).toBe("0")
})

test("安装器参数：Forge 和 NeoForge 各用各的写法，一定带目录；有镜像才带 --mirror；Fabric 不归这里", () => {
  const dir = "C:\\运行 目录\\instances\\x\\client"
  expect(installerArgs("forge", "client", dir, "https://bmclapi2.bangbang93.com/maven/")).toEqual(["--installClient", dir, "--mirror", "https://bmclapi2.bangbang93.com/maven/"])
  expect(installerArgs("forge", "server", dir, null)).toEqual(["--installServer", dir])
  expect(installerArgs("neoforge", "client", dir, null)).toEqual(["--install-client", dir])
  expect(installerArgs("neoforge", "server", dir, "m")).toEqual(["--install-server", dir, "--mirror", "m"])
  expect(() => installerArgs("fabric", "client", dir, null)).toThrow("NOT_AN_INSTALLER_LOADER")
})

test("安装器的环境：APPDATA 指向实例自己，不碰任何启动器的 .minecraft；别的环境变量只留需要的", () => {
  const env = installerEnvironment("D:\\实例", { APPDATA: "C:\\Users\\x\\AppData\\Roaming", Path: "C:\\bin", SECRET_TOKEN: "x", TEMP: "C:\\t" })
  expect(env).toEqual({ APPDATA: "D:\\实例", Path: "C:\\bin", TEMP: "C:\\t" })
})

test("加载器版本名和服务端参数文件的位置，按清单算", () => {
  expect(loaderVersionId(targetManifest("forge-1.20.1"))).toBe("1.20.1-forge-47.4.28")
  expect(loaderVersionId(targetManifest("neoforge-1.21.1"))).toBe("neoforge-21.1.266")
  expect(() => loaderVersionId(targetManifest("fabric-1.21.1"))).toThrow("NOT_AN_INSTALLER_LOADER")
  expect(serverArgsFile(targetManifest("forge-1.20.1"))).toBe("libraries/net/minecraftforge/forge/1.20.1-47.4.28/win_args.txt")
  expect(serverArgsFile(targetManifest("neoforge-1.21.1"))).toBe("libraries/net/neoforged/neoforge/21.1.266/win_args.txt")
})

test("server.properties：只改要改的键，别的行照旧，没有的键补上", () => {
  expect(serverProperties("#Minecraft server properties\nmotd=hi\nonline-mode=true\nserver-port=25565\n", { "online-mode": "false", "server-port": "50001", "level-name": "world" })).toBe(
    "#Minecraft server properties\nmotd=hi\nonline-mode=false\nserver-port=50001\nlevel-name=world\n",
  )
  expect(serverProperties("", { "online-mode": "false" })).toBe("online-mode=false\n")
})

test("资源对象按哈希去重、按哈希放；库按路径去重；能下的才列", () => {
  const h1 = "ab".padEnd(40, "1")
  const objects = assetDownloads({ objects: { "a.ogg": { hash: h1, size: 3 }, "b.ogg": { hash: h1, size: 3 }, "c.png": { hash: "cd".padEnd(40, "2"), size: 4 } } }, "C:\\assets")
  expect(objects).toHaveLength(2)
  expect(objects[0]).toEqual({ file: { url: `https://resources.download.minecraft.net/ab/${h1}`, sha1: h1, size: 3 }, destination: path.join("C:\\assets", "objects", "ab", h1) })
  expect(() => assetDownloads({ objects: { x: { hash: "../../evil" } } }, "C:\\assets")).toThrow("INVALID_ASSET_INDEX")
  expect(() => assetDownloads({}, "C:\\assets")).toThrow("INVALID_ASSET_INDEX")
  const sha1 = "f".repeat(40)
  const libraries = libraryDownloads(
    {
      libraries: [
        { name: "a:b:1", downloads: { artifact: { path: "a/b/1/b-1.jar", sha1, url: "https://libraries.minecraft.net/a/b/1/b-1.jar" } } },
        { name: "a:b:1", downloads: { artifact: { path: "a/b/1/b-1.jar", sha1, url: "https://libraries.minecraft.net/a/b/1/b-1.jar" } } },
        { name: "c:d:1", downloads: { artifact: { path: "c/d/1/d-1.jar", sha1, url: "" } } },
      ],
    },
    "C:\\libs",
  )
  expect(libraries).toHaveLength(1)
  expect(mainSource({ kept: 10, bmclapi: 3, official: 1 })).toBe("bmclapi")
  expect(mainSource({ kept: 10 })).toBe("kept")
})

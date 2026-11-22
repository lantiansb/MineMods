import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { GameTarget, JavaInstallPlan, JavaReport } from "../src/api"
import { WORDS } from "../src/renderer/words"
import {
  SEARCH_MAX,
  SETUP_WORDS,
  addedLines,
  defaultTarget,
  downloads,
  forget,
  hostOf,
  installFacts,
  javaPhrase,
  kindWords,
  landOn,
  loadersAt,
  modIcon,
  plainError,
  remember,
  searchQuery,
  shortPath,
  size,
  summaryLine,
  targetLine,
  targetLoaderName,
  versionsOf,
  whyNot,
} from "../src/renderer/features/project-setup-model"

const target = (over: Partial<GameTarget>): GameTarget => ({ id: "fabric-1.21.1", minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2", java: 21, ready: true, why: null, ...over })
const CATALOGUE: GameTarget[] = [
  target({}),
  target({ id: "neoforge-1.21.1", loader: "neoforge", loaderVersion: "21.1.77", ready: false, why: "这个组合 Studio 还生成不了代码" }),
  target({ id: "fabric-1.20.1", minecraft: "1.20.1", loaderVersion: "0.16.10", java: 17, ready: false, why: "这个版本 Studio 还生成不了代码" }),
  target({ id: "forge-1.20.1", minecraft: "1.20.1", loader: "forge", loaderVersion: "47.3.0", java: 17, ready: false, why: null }),
  target({ id: "quilt-1.21.1", loader: "quilt", loaderVersion: null, ready: false, why: null }),
]
const java = (over: Partial<JavaReport>): JavaReport => ({ found: [], using: null, mode: "auto", chosen: null, ...over })
const found = { home: "C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.4.7-hotspot", version: "21.0.4", major: 21, vendor: "Eclipse Adoptium", arch: "amd64", jdk: true, source: "installed" as const, fits: true, why: null }

test("新建工程的一行摘要：游戏、加载器、Java 有没有、预装几个", () => {
  expect(summaryLine({ target: CATALOGUE[0]!, java: java({ found: [found], using: found }), mods: 0 })).toBe("Minecraft 1.21.1 · Fabric 0.17.2 · Java 21 已就绪 · 预装 0 个")
  expect(summaryLine({ target: CATALOGUE[0]!, java: java({}), mods: 2 })).toBe("Minecraft 1.21.1 · Fabric 0.17.2 · Java 21 第一次打包时自动下载 · 预装 2 个")
  // Still looking: nothing is claimed about the Java yet.
  expect(javaPhrase(21, undefined)).toBe("Java 21")
  expect(targetLine(CATALOGUE[4]!)).toBe("Minecraft 1.21.1 · Quilt")
})

test("大小按 MB/GB 说，问不到就说问不到，不编数字", () => {
  expect(size(195 * 1024 ** 2)).toBe("195 MB")
  expect(size(3.46 * 1024 ** 2)).toBe("3.5 MB")
  expect(size(42.3 * 1024 ** 3)).toBe("42 GB")
  expect(size(1.25 * 1024 ** 3)).toBe("1.3 GB")
  expect(size(200 * 1024)).toBe("0.2 MB")
  expect(size(10)).toBe("不到 0.1 MB")
  expect(SETUP_WORDS.traffic(195 * 1024 ** 2)).toBe("要下载约 195 MB")
  expect(SETUP_WORDS.traffic(null)).toBe("下载大小问不到，以实际为准")
  expect(SETUP_WORDS.free(null)).toBe("读不到剩余空间")
  expect(downloads(950)).toBe("950 次下载")
  expect(downloads(123_456)).toBe("12.3 万次下载")
  expect(downloads(250_000_000)).toBe("2.5 亿次下载")
})

test("装 Java 之前的确认：装什么、从哪下、多少流量、占多少硬盘、装到哪、还剩多少；有问题就不让装", () => {
  const plan: JavaInstallPlan = {
    vendor: "Eclipse Temurin JDK",
    version: "21.0.4+7",
    url: "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse",
    downloadBytes: null,
    directory: "D:\\MineMods",
    defaultDirectory: "C:\\Users\\a\\AppData\\Roaming\\MineMods Studio",
    freeBytes: 20 * 1024 ** 3,
    problem: null,
  }
  expect(installFacts(plan)).toEqual({
    what: "Eclipse Temurin JDK 21.0.4+7",
    from: "api.adoptium.net",
    traffic: "下载大小问不到，以实际为准",
    disk: "下载的压缩包装完就删；装好以后占多少会在装完时量出来告诉你",
    where: "D:\\MineMods",
    moved: true,
    free: "那个盘还剩 20 GB",
    problem: null,
    blocked: false,
  })
  expect(installFacts({ ...plan, directory: plan.defaultDirectory, problem: "那个盘只剩 0.2 GB，装不下" })).toMatchObject({ moved: false, blocked: true })
  expect(hostOf("不是地址")).toBe("不是地址")
  expect(SETUP_WORDS.javaNone).toBe("没找到合适的 Java。第一次打包时会自动下载一个；也可以现在就装。")
})

test("游戏版本按目录顺序各列一次；只落在能做的组合上，做不了的说为什么", () => {
  expect(versionsOf(CATALOGUE)).toEqual([
    { minecraft: "1.21.1", ready: true },
    { minecraft: "1.20.1", ready: false },
  ])
  expect(loadersAt(CATALOGUE, "1.21.1").map((entry) => [entry.loader, entry.target.id])).toEqual([
    ["fabric", "fabric-1.21.1"],
    ["neoforge", "neoforge-1.21.1"],
    ["quilt", "quilt-1.21.1"],
  ])
  expect(landOn(CATALOGUE, "1.20.1")).toBeNull()
  expect(landOn(CATALOGUE, "1.21.1", "neoforge")).toBeNull()
  expect(landOn(CATALOGUE, "1.21.1")?.id).toBe("fabric-1.21.1")
  expect(whyNot(CATALOGUE[1]!)).toBe("这个组合 Studio 还生成不了代码")
  expect(whyNot(CATALOGUE[3]!)).toBe(SETUP_WORDS.notReady)
  expect(whyNot(CATALOGUE[0]!)).toBeNull()
  // Main's choice when it can be made; never one that cannot.
  expect(defaultTarget(CATALOGUE, "fabric-1.21.1")?.id).toBe("fabric-1.21.1")
  expect(defaultTarget(CATALOGUE, "forge-1.20.1")?.id).toBe("fabric-1.21.1")
  expect(defaultTarget(CATALOGUE.slice(1), "fabric-1.20.1")).toBeUndefined()
})

test("搜模组：只把真要找的字发出去", () => {
  expect(searchQuery("  just   enough  items ")).toBe("just enough items")
  expect(searchQuery("   ")).toBe("")
  expect(searchQuery("a".repeat(150))).toHaveLength(SEARCH_MAX)
  // Only a picture handed over as data is drawn: the window loads nothing from the network.
  expect(modIcon("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA")
  expect(modIcon("https://cdn.modrinth.com/data/abc/icon.png")).toBeNull()
  expect(modIcon(null)).toBeNull()
})

test("预装模组：说清楚作用；加上了什么、哪个没加和为什么", () => {
  expect(SETUP_WORDS.modsMeaning).toBe("这些模组会和你的模组一起装进测试场；你的模组的代码不会调用它们。")
  expect(SETUP_WORDS.modsBuiltIn("fabric")).toBe("fabric-api 和 geckolib 是 Studio 自己会装的，不用加。")
  // A Forge or NeoForge test scene has no Fabric API: only GeckoLib is put there by Studio.
  for (const loader of ["forge", "neoforge"]) expect(SETUP_WORDS.modsBuiltIn(loader)).toBe("geckolib 是 Studio 自己会装的，不用加。")
  expect([WORDS.preinstalled, WORDS.runtime]).toEqual([SETUP_WORDS.mods, SETUP_WORDS.java])
  const mod = { file: "jade.jar", id: "jade", name: "Jade", version: "15.1", from: "modrinth" as const, required: false }
  expect(addedLines({ added: [mod, { ...mod, name: "Cloth Config", required: true }], skipped: [{ name: "Sodium", why: "没有给 Minecraft 1.21.1 · Fabric 的版本" }] })).toEqual([
    "加上了：Jade、Cloth Config",
    "「Sodium」没加：没有给 Minecraft 1.21.1 · Fabric 的版本",
  ])
  expect(addedLines({ added: [], skipped: [] })).toEqual([])
  const list = remember(remember([], { modrinthId: "nvQzSEkH", title: "Jade" }), { modrinthId: "nvQzSEkH", title: "Jade" })
  expect(list).toEqual([{ modrinthId: "nvQzSEkH", title: "Jade" }])
  expect(forget(list, "nvQzSEkH")).toEqual([])
})

test("Java 的样子：长路径留头尾；JDK 在基础模式里有一句白话", () => {
  expect(shortPath(found.home, 40)).toBe("C:\\…\\Eclipse Adoptium\\jdk-21.0.4.7-hotspot")
  expect(shortPath("/usr/lib/jvm/java-21-openjdk-amd64/lib/server", 30)).toBe("/…/lib/server")
  expect(shortPath("C:\\Java", 40)).toBe("C:\\Java")
  expect(kindWords(true, false)).toBe("完整的 Java（JDK）")
  expect(kindWords(false, false)).not.toMatch(/^JRE/)
  expect(kindWords(true, true)).toBe("JDK")
})

test("出错时给人看的是主进程的中文句子；英文原文只在高级里", () => {
  const remote = new Error("Error invoking remote method 'studio:invoke': Error: ENOSPC: no space left on device")
  expect(plainError(remote, "没做成，过一会儿再试。")).toBe("没做成，过一会儿再试。")
  expect(plainError(remote, "没做成，过一会儿再试。", true)).toBe("ENOSPC: no space left on device")
  expect(plainError(new Error("Error invoking remote method 'studio:invoke': Error: 那个盘装不下"), "x")).toBe("那个盘装不下")
})

test("新建页只要一个名字；配置折成一行，「改一改」展开三张卡片；工程页和存储空间用同一张运行环境卡片", () => {
  const renderer = path.join(import.meta.dir, "../src/renderer")
  const app = readFileSync(path.join(renderer, "studio-app.tsx"), "utf8")
  expect(app).toContain("targetId: targetId() || undefined,")
  expect(app).toContain('<div class="setup-cards" hidden={!setupOpen()}>')
  expect(app).toContain("setSetupOpen(advanced())")
  expect(app).not.toContain("<strong>Minecraft 1.21.1 · Fabric 0.17.2</strong>")
  expect(app).toContain("<JavaCard compact major={major()}")
  const resources = readFileSync(path.join(renderer, "features/resource-manager.tsx"), "utf8")
  expect(resources).not.toContain("准备 Java 21")
  expect(resources).toContain("<For each={majors()}>")
  expect(resources).toContain("<JavaCard major={major}")
  const scene = readFileSync(path.join(renderer, "features/test-scene.tsx"), "utf8")
  expect(scene).toContain("<PreinstalledMods projectId={props.projectId} targetId={props.targetId} />")
  expect(SETUP_WORDS.sceneFolder("test-scene-mods")).toBe("自己把 jar 放进工程文件夹下的 test-scene-mods 文件夹也行。")
})

test("a project's mod is named by its target's loader (the source export once said Fabric for every project)", () => {
  expect(targetLoaderName("fabric-1.21.1")).toBe("Fabric")
  expect(targetLoaderName("forge-1.20.1")).toBe("Forge")
  expect(targetLoaderName("neoforge-1.21.1")).toBe("NeoForge")
})

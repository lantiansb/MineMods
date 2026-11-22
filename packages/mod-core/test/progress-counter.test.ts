import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { GRADLE_NETWORK } from "../src/gradle-network"
import { COUNTER_LABELS, STALL_MS, USUAL_WAITS, countLine, counterStalled, growthLine, longerThanUsual, readCounter, stalledWords, usualFor, usualRange } from "../src/progress-counter"
import { gradleReady, markGradleReady, watchGradleDownloads } from "../src/runtime"
import { SCENE_COUNT_EVERY, sceneReady } from "../src/scene-run"

const roots: string[] = []
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mm-counter-"))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("计数是真的数：写出来的那一句，读出来是同样的数；没有总数的不编百分比", () => {
  const line = countLine(COUNTER_LABELS.assets, 3500, 3888)
  expect(line).toBe("游戏的声音、语言和图标：3500 / 3888")
  expect(readCounter(`准备测试场要用的游戏文件（游戏本体）。\n${line}\n`)).toEqual({ text: line, label: "游戏的声音、语言和图标", done: 3500, of: 3888 })
  const growth = growthLine(COUNTER_LABELS.game, 412)
  expect(growth).toBe("正在准备游戏的开发文件：这一步已经新增 412 MB")
  expect(readCounter(growth)).toEqual({ text: growth, label: "游戏的开发文件", done: 412, of: null })
  // The newest one wins, and a line that is not a counter is not one.
  expect(readCounter(`${countLine("游戏的声音、语言和图标", 100, 3888)}\n${countLine("游戏的声音、语言和图标", 200, 3888)}`)?.done).toBe(200)
  expect(readCounter("> Task :compileJava\nBUILD SUCCESSFUL\n")).toBeNull()
  expect(readCounter("")).toBeNull()
})

test("一个计数多久不动才说没有进展：两个连接超时（各 60 秒），有来历", () => {
  expect(GRADLE_NETWORK.http["org.gradle.internal.http.socketTimeout"]).toBe(60000)
  expect(STALL_MS).toBe(120_000)
  const at = "2026-10-19T10:00:00.000Z"
  const t = Date.parse(at)
  expect(counterStalled(at, t + 119_000)).toBe(false)
  expect(counterStalled(at, t + 120_000)).toBe(true)
  // Nothing known: nothing claimed.
  expect(counterStalled(undefined, t)).toBe(false)
  expect(counterStalled("坏的", t)).toBe(false)
  const words = stalledWords("游戏的声音、语言和图标：3500 / 3888", at, t + 9 * 60_000)
  expect(words.lead).toBe("这一步有一阵没有进展了：「游戏的声音、语言和图标：3500 / 3888」已经 9 分钟没有变。")
  expect(words.can).toContain("取消")
  expect(words.can).toContain("不会重新下")
})

test("每一个「一般要多久」都说得出来历；没计时过的写明是估计，不装成实测", () => {
  for (const stage of ["build", "check", "play"] as const)
    for (const warm of [false, true]) {
      const wait = usualFor(stage, warm)
      if (wait) expect(wait.source.length).toBeGreaterThan(8)
      if (wait && !wait.measured) expect(wait.source.startsWith("估计")).toBe(true)
    }
  // The two that were timed follow one rule: shortest and longest recorded run, rounded outward to whole minutes.
  expect(USUAL_WAITS.build.cold).toMatchObject({ from: 6 * 60, to: 10 * 60, measured: true })
  expect(USUAL_WAITS.play.cold).toMatchObject({ from: 1 * 60, to: 7 * 60, measured: true })
  expect(usualRange(USUAL_WAITS.build.cold)).toBe("6 到 10 分钟")
  expect(usualRange(USUAL_WAITS.play.warm)).toBe("10 到 20 秒")
  expect(usualFor("check", true)).toBeNull()
})

test("超过一般的上限就是比平常久；没有范围的步骤不下这个结论", () => {
  expect(longerThanUsual("build", false, 10 * 60_000)).toBe(false)
  // Round 20: a cold pack took 10 min 54 s.
  expect(longerThanUsual("build", false, (10 * 60 + 54) * 1000)).toBe(true)
  expect(longerThanUsual("check", false, 145_000)).toBe(true)
  expect(longerThanUsual("check", true, 600_000)).toBe(false)
})

test("下载的文件夹在长，就如实说长了多少；不长就不说，也不编总数", async () => {
  const lines: string[] = []
  const sizes = { tool: 0, game: 0, libs: 0 }
  const measure = async (directory: string) => (directory.endsWith("wrapper") ? sizes.tool : directory.endsWith("fabric-loom") ? sizes.game : sizes.libs)
  const pending: { tick?: () => Promise<void> } = {}
  const stop = watchGradleDownloads("/gradle-home", (text) => lines.push(text), 10, measure, "fabric-loom", {
    now: () => 0,
    schedule: (_delay, tick) => {
      pending.tick = tick
      return () => { if (pending.tick === tick) delete pending.tick }
    },
  })
  await pending.tick!()
  expect(lines).toEqual([])
  sizes.game = 5 * 1024 ** 2 + 100
  await pending.tick!()
  expect(lines.at(-1)).toBe("正在准备游戏的开发文件：这一步已经新增 5 MB\n")
  sizes.libs = 3 * 1024 ** 2
  await pending.tick!()
  expect(lines.at(-1)).toBe("正在准备开发用的库：这一步已经新增 3 MB\n")
  const said = lines.length
  const alreadyRunning = pending.tick!
  stop()
  sizes.game += 50 * 1024 ** 2
  expect(pending.tick).toBeUndefined()
  await alreadyRunning()
  expect(pending.tick).toBeUndefined()
  expect(lines).toHaveLength(said)
  for (const line of lines) expect(line).not.toContain("%")
})

test("「第一次」看这台电脑真的有没有：跑完过一次才算有；空的、下了一半的都不算", async () => {
  const runtime = await temporary()
  expect(await gradleReady(runtime)).toBe(false)
  // A part-filled cache with no mark: the first attempt broke off halfway, so the next one is still a first time.
  await mkdir(path.join(runtime, "gradle-home", "caches", "fabric-loom"), { recursive: true })
  await writeFile(path.join(runtime, "gradle-home", "caches", "fabric-loom", "half.jar"), "x")
  expect(await gradleReady(runtime)).toBe(false)
  expect(await sceneReady(runtime)).toEqual({ check: false, play: false })
  // A Gradle run that ended well leaves the mark (build, code check and development game alike), and from then on it is not a first time.
  await markGradleReady(runtime, "compileJava")
  expect(await gradleReady(runtime)).toBe(true)
})

test("测试场的两组文件各认各的：服务器的齐了才不是第一次检查，游戏本体盖了章才不是第一次打开", async () => {
  const runtime = await temporary()
  const { scenePaths } = await import("../src/scene-run")
  const paths = scenePaths(runtime, "none")
  const { resolveProfile } = await import("../src/fabric/profile")
  const profile = resolveProfile("fabric-1.21.1")
  await mkdir(paths.game, { recursive: true })
  await mkdir(paths.serverLibraries, { recursive: true })
  await writeFile(path.join(paths.serverLibraries, `fabric-loader-${profile.loader}.jar`), "x")
  expect(await sceneReady(runtime)).toEqual({ check: false, play: false })
  await writeFile(path.join(paths.game, `server-${profile.minecraft}.jar`), "x")
  expect(await sceneReady(runtime)).toEqual({ check: true, play: false })
  await mkdir(paths.assets, { recursive: true })
  await mkdir(paths.clientLibraries, { recursive: true })
  await writeFile(path.join(paths.clientLibraries, `minecraft-client-${profile.minecraft}.jar`), "x")
  expect(await sceneReady(runtime)).toEqual({ check: true, play: false })
  await writeFile(path.join(paths.assets, "complete-abc"), "")
  expect(await sceneReady(runtime)).toEqual({ check: true, play: true })
})

test("游戏文件的计数每 100 个说一次，不是每 500 个：慢网络上也不会隔太久才有一句", () => {
  expect(SCENE_COUNT_EVERY).toBe(100)
  // At the pace that is just fast enough not to be called stuck (one file a second), 100 files come within the stall time.
  expect(SCENE_COUNT_EVERY / 1).toBeLessThan(STALL_MS / 1000)
})

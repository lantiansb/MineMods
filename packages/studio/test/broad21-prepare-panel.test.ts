import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveProfile } from "@minemods/mod-core/fabric/profile"
import { markGradleReady } from "@minemods/mod-core/runtime"
import { scenePaths } from "@minemods/mod-core/scene-run"
import { AHEAD_WORDS, aheadWhy, type AheadStep } from "../src/prepare-ahead"
import { createPrepareAhead, type AheadRun } from "../src/main/prepare-ahead-run"
import { createStudioService } from "../src/main/service"
import { PARTLY_WORDS, WARM_WORDS, runningNote } from "../src/renderer/play-chain"
import { advanceChain, type Chain, type ChainDeps } from "../src/renderer/play-chain-run"

const roots: string[] = []
const services: Array<Awaited<ReturnType<typeof createStudioService>>> = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const profile = resolveProfile("fabric-1.21.1")

/** A service with stand-ins for the three steps, each of which leaves on the disk what the real one leaves unless told to fail. */
async function studio(onDevelopment?: () => void) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-broad21-"))
  roots.push(root)
  const options = { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} }
  const paths = scenePaths(options.runtimeDirectory, "none")
  const log: string[] = []
  const fail: Partial<Record<AheadStep, Error>> = {}
  const holds: Partial<Record<AheadStep, { open: () => void }>> = {}
  const says: Partial<Record<AheadStep, (text: string) => void>> = {}
  const changes = { count: 0, hook: undefined as undefined | (() => void) }
  const leaves: Record<AheadStep, () => Promise<void>> = {
    development: () => markGradleReady(options.runtimeDirectory, "build"),
    server: async () => {
      await mkdir(paths.game, { recursive: true })
      await mkdir(paths.serverLibraries, { recursive: true })
      await writeFile(path.join(paths.game, `server-${profile.minecraft}.jar`), "")
      await writeFile(path.join(paths.serverLibraries, `fabric-loader-${profile.loader}.jar`), "")
    },
    client: async () => {
      await mkdir(paths.mods, { recursive: true })
      await writeFile(path.join(paths.mods, `fabric-api-${profile.fabricApi}.jar`), "")
      await writeFile(path.join(paths.mods, `geckolib-fabric-${profile.minecraft}-${profile.geckolib.version}.jar`), "")
      await mkdir(paths.assets, { recursive: true })
      await mkdir(paths.clientLibraries, { recursive: true })
      await writeFile(path.join(paths.assets, "complete-x"), "")
      await writeFile(path.join(paths.clientLibraries, `minecraft-client-${profile.minecraft}.jar`), "")
    },
  }
  const runner = (name: AheadStep) => async (run: AheadRun) => {
    log.push(name)
    says[name] = run.onProgress
    if (name === "development") onDevelopment?.()
    const hold = holds[name]
    if (hold) await new Promise<void>((resolve) => Object.assign(hold, { open: resolve }))
    if (fail[name]) throw fail[name]
    await leaves[name]()
  }
  const service = await createStudioService({ ...options, ahead: { on: true, changed: () => {
        changes.count++
        changes.hook?.()
      }, runners: { development: runner("development"), server: runner("server"), client: runner("client") } } })
  services.push(service)
  const created = await service.createProject({ name: "面板", description: "", empty: true })
  await service.openProject(created.project.id)
  const projectId = created.project.id
  /** The first thing in the project: this is the moment the preparation starts. */
  const start = () => service.addEntity({ projectId, expectedRevision: created.project.revision, name: "第一只" })
  return { service, projectId, log, fail, holds, says, changes, start, options, paths }
}

test("面板读到准备的真实情况：现在在哪一步、最新数到哪；准备一结束这些就没了", async () => {
  const started = Promise.withResolvers<void>()
  const { service, projectId, holds, says, start } = await studio(started.resolve)
  holds.development = { open: () => {} }
  await start()
  await started.promise
  says.development!("> Task :compileJava\n")
  says.development!("正在准备开发用的库：这一步已经新增 48 MB\n")
  expect(await service.getBuildPanel({ projectId })).toMatchObject({ preparing: true, prepareStep: "development", prepareCounter: "正在准备开发用的库：这一步已经新增 48 MB" })
  holds.development!.open()
  await service.aheadSettled()
  const done = await service.getBuildPanel({ projectId })
  expect(done.preparing).toBeUndefined()
  expect(done.prepareStep).toBeUndefined()
  expect(done.prepareCounter).toBeUndefined()
  expect(done.prepareFailed).toBeUndefined()
  expect(done.ready).toEqual({ build: true, check: false, play: true })
  expect(done.whole).toEqual({ build: true, play: true })
})

test("面板主动知道：准备的状态变化（开始、结束、失败）都通知窗口去重读，不靠窗口一直问；通知时读到的就是新状态", async () => {
  const { service, projectId, fail, changes, start } = await studio()
  fail.development = new Error("BUILD_NETWORK_FAILED")
  const read: Array<ReturnType<typeof service.getBuildPanel>> = []
  changes.hook = () => void read.push(service.getBuildPanel({ projectId }))
  await start()
  await service.aheadSettled()
  // The step began, and the preparation ended (the failure is kept before that is said): two moments the open panel is out of date.
  expect(changes.count).toBeGreaterThanOrEqual(2)
  const last = await read.at(-1)!
  expect(last.preparing).toBeUndefined()
  expect(last.prepareFailed).toMatchObject({ step: "development" })
})

test("准备装 Java 的时候马上通知窗口：Java 装好的那一刻窗口就去重新检测，不等开发文件那一大步结束", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-broad21-"))
  roots.push(root)
  const events: string[] = []
  const service = await createStudioService({
    workspaceDirectory: path.join(root, "projects"),
    runtimeDirectory: path.join(root, "runtime"),
    // Not there: the files after Java fail at once, which is all the order needs.
    templateDirectory: path.join(root, "templates"),
    ai: {},
    javaProbe: { install: async (runtimeDirectory) => (events.push("装 Java"), path.join(runtimeDirectory, "java-21")) },
    ahead: { on: true, changed: () => void events.push("通知") },
  })
  services.push(service)
  const created = await service.createProject({ name: "装 Java", description: "", empty: true })
  await service.openProject(created.project.id)
  await service.addEntity({ projectId: created.project.id, expectedRevision: created.project.revision, name: "第一只" })
  await service.aheadSettled()
  // The step began, Java was put in place and the window told, and then the long part ran and the preparation ended: the middle notice is the one that was missing.
  expect(events).toEqual(["通知", "装 Java", "通知", "通知"])
})

test("失败不再静悄悄：面板留着失败在哪一步、白话原因、下次自动再试的时间；开关关了或者那一步已经别的办法做好了就不再显示", async () => {
  const { service, projectId, fail, options, start } = await studio()
  fail.development = new Error("BUILD_NETWORK_FAILED")
  const before = Date.now()
  await start()
  await service.aheadSettled()
  const panel = await service.getBuildPanel({ projectId })
  expect(panel.preparing).toBeUndefined()
  expect(panel.prepareFailed).toMatchObject({ step: "development", why: "下载时网络断了，或者停住了" })
  // The time of the next try is given, about a minute on (the first wait), and is a time and not a count.
  const retryAt = Date.parse(panel.prepareFailed!.retryAt)
  expect(retryAt - before).toBeGreaterThanOrEqual(59_000)
  expect(retryAt - before).toBeLessThan(65_000)
  // The words the window shows say all three things.
  const words = AHEAD_WORDS.failed(panel.prepareFailed!)
  expect(words).toContain("打包要用的开发文件")
  expect(words).toContain("下载时网络断了")
  expect(words).toMatch(/\d\d:\d\d 左右会自动再试/)
  // A pack that fetched the files itself ends it: the files are there, and nothing is left to try again.
  await markGradleReady(options.runtimeDirectory, "build")
  expect((await service.getBuildPanel({ projectId })).prepareFailed).toBeUndefined()
  // And with the switch off nothing will try again, so nothing says it will.
  const again = await studio()
  again.fail.development = new Error("BUILD_NETWORK_FAILED")
  await again.start()
  await again.service.aheadSettled()
  expect((await again.service.getBuildPanel({ projectId: again.projectId })).prepareFailed).toBeDefined()
  const settings = await again.service.getSettings()
  await again.service.saveSettings({ ...settings, prepareAhead: false })
  expect((await again.service.getBuildPanel({ projectId: again.projectId })).prepareFailed).toBeUndefined()
})

test("点打包就是重试：上次没做成的游戏文件马上接着做，不等那一分钟", async () => {
  const { service, projectId, log, fail, start } = await studio()
  // The pack's own files are there; the game's failed.
  fail.client = new Error("SCENE_DOWNLOAD_FAILED")
  await start()
  await service.aheadSettled()
  expect(log).toEqual(["development", "client"])
  expect((await service.getBuildPanel({ projectId })).prepareFailed).toMatchObject({ step: "client" })
  delete fail.client
  await service.buildProject({ projectId })
  await service.aheadSettled()
  expect(log).toEqual(["development", "client", "client"])
  expect((await service.getBuildPanel({ projectId })).prepareFailed).toBeUndefined()
})

test("「齐了」不是「有了」：只做过代码检查的电脑，开发文件算主要文件有了但不算齐；打包做过、前置在缓存里才算齐", async () => {
  const { service, projectId, options, paths } = await studio()
  expect((await service.getBuildPanel({ projectId })).whole).toEqual({ build: false, play: false })
  await markGradleReady(options.runtimeDirectory, "compileJava")
  const checked = await service.getBuildPanel({ projectId })
  expect(checked.ready.build).toBe(true)
  expect(checked.whole?.build).toBe(false)
  await markGradleReady(options.runtimeDirectory, "build")
  expect((await service.getBuildPanel({ projectId })).whole?.build).toBe(true)
  // The game's files with no mods in the cache: the main files, not all of them.
  await mkdir(paths.assets, { recursive: true })
  await mkdir(paths.clientLibraries, { recursive: true })
  await writeFile(path.join(paths.assets, "complete-x"), "")
  await writeFile(path.join(paths.clientLibraries, `minecraft-client-${profile.minecraft}.jar`), "")
  const game = await service.getBuildPanel({ projectId })
  expect(game.ready.play).toBe(true)
  expect(game.whole?.play).toBe(false)
})

test("面板那一行的措辞照真实情况：齐了才说「不用再下载」，没把握只说主要的；没下过照旧说要先下", () => {
  expect(runningNote("build", "", true, true)).toContain(WARM_WORDS.build)
  expect(runningNote("build", "", true)).toContain(WARM_WORDS.build)
  const partly = runningNote("build", "", true, false)
  expect(partly).toContain(PARTLY_WORDS.build)
  expect(partly).not.toContain("不用再下载")
  expect(partly).toContain("主要的开发文件")
  expect(runningNote("build", "", false, false)).toContain("还没有下载过")
  expect(runningNote("build", "", undefined)).not.toContain("下载")
})

test("一个阶段开始时，「有没有」和「齐不齐」一起记下来，之后不再变", async () => {
  const shown: Chain[] = []
  const deps: ChainDeps = {
    readScene: async () => ({ eula: true, record: null, world: false, missing: [] }) as never,
    latestBuildJobId: async () => null,
    readMaking: async () => 0,
    blocked: () => false,
    start: async () => ({ jobId: "j" }),
    ready: async () => ({ build: true, check: false, play: false, whole: { build: false } }),
    error: () => "",
    show: (chain) => void (chain && shown.push(chain)),
  }
  const base: Chain = { projectId: "p", want: "play", running: null, marks: {}, ended: null, stop: null, error: "", lines: [], findings: 0, missing: [], making: 0 }
  await advanceChain(base, null, deps)
  const began = shown.at(-1)!
  expect(began.running?.stage).toBe("build")
  expect(began.ready?.build).toBe(true)
  expect(began.whole?.build).toBe(false)
})

test("Forge 或 NeoForge 工程：阶段开始时把它自己目标第一次要下载的话一起记下来，只记这一阶段的", async () => {
  const shown: Chain[] = []
  const cold = { check: "这台电脑还没有装过 Forge 1.20.1 的服务器（约 186 MB）", play: "这台电脑还没有装过 Forge 1.20.1 的游戏本体（约 865 MB）" }
  const deps: ChainDeps = {
    readScene: async () => ({ eula: true, record: null, world: false, missing: [] }) as never,
    latestBuildJobId: async () => "built",
    readMaking: async () => 0,
    blocked: () => false,
    start: async () => ({ jobId: "j" }),
    ready: async () => ({ build: true, check: false, play: false, cold }),
    error: () => "",
    show: (chain) => void (chain && shown.push(chain)),
  }
  const base: Chain = { projectId: "p", want: "play", running: null, marks: {}, ended: null, stop: null, error: "", lines: [], findings: 0, missing: [], making: 0 }
  await advanceChain(base, null, deps)
  const began = shown.at(-1)!
  expect(began.running?.stage).toBe("check")
  expect(began.cold).toEqual({ check: cold.check })
  expect(runningNote("check", "", began.ready?.check, began.whole?.check, began.cold?.check)).toContain("约 186 MB")
})

test("白话原因只说得准的几种，别的不端原文", () => {
  expect(aheadWhy(new Error("BUILD_NETWORK_FAILED"))).toBe("下载时网络断了，或者停住了")
  expect(aheadWhy(new Error("D:\\Users\\某人\\工程\\x.java:12 boom"))).toBe("出了意料之外的问题")
  expect(aheadWhy("not an error")).toBe("出了意料之外的问题")
})

test("打包接上正在做的准备时，打包的进度里有准备此刻的真实计数（接上之前已经数到的也补上），不只是「一般几分钟」和时间", async () => {
  const progress = Promise.withResolvers<void>()
  const hold = Promise.withResolvers<void>()
  const fake = createPrepareAhead<string>({
    facts: async () => ({ enabled: true, eula: false, ready: { build: false, check: true, play: true } }),
    runners: {
      development: async (run) => {
        run.onProgress("Building the saved project with Gradle.\n")
        run.onProgress("正在准备构建工具：这一步已经新增 130 MB\n")
        run.onProgress("正在准备开发用的库：这一步已经新增 48 MB\n")
        progress.resolve()
        await hold.promise
      },
      server: async () => {},
      client: async () => {},
    },
  })
  fake.consider("p")
  await progress.promise
  const told: string[] = []
  const waiting = fake.join({ onProgress: (text) => void told.push(text) })
  // The pack is told what it waits for and where that stands now: the newest count, though it was written before the pack came.
  expect(told).toEqual([`${AHEAD_WORDS.now}\n`, "正在准备开发用的库：这一步已经新增 48 MB\n"])
  hold.resolve()
  await waiting
  await fake.settled()
})

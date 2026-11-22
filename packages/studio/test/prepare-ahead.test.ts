import { afterEach, expect, test } from "bun:test"
import { untilObserved } from "./observed"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveProfile } from "@minemods/mod-core/fabric/profile"
import { markGradleReady } from "@minemods/mod-core/runtime"
import { scenePaths } from "@minemods/mod-core/scene-run"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"
import { AHEAD_LOOK_MS, AHEAD_RETRY_MS, AHEAD_WORDS, aheadMoment, aheadRetryIn, aheadSteps, type AheadFacts, type AheadStep } from "../src/prepare-ahead"
import { createPrepareAhead, type AheadRun } from "../src/main/prepare-ahead-run"
import { createStudioService } from "../src/main/service"
import { SettingsSchema } from "../src/settings"
import { played } from "./playable-fixture"

const roots: string[] = []
const services: Array<Awaited<ReturnType<typeof createStudioService>>> = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const none = { build: false, check: false, play: false }
const facts = (over: Partial<AheadFacts> = {}): AheadFacts => ({ enabled: true, eula: false, ready: none, ...over })

test("提前准备哪些：缺什么准备什么，已经有的跳过；开关关着什么都不做", () => {
  expect(aheadSteps(facts())).toEqual(["development", "client"])
  expect(aheadSteps(facts({ ready: { build: true, check: false, play: false } }))).toEqual(["client"])
  expect(aheadSteps(facts({ ready: { build: false, check: false, play: true } }))).toEqual(["development"])
  expect(aheadSteps(facts({ ready: { build: true, check: true, play: true } }))).toEqual([])
  expect(aheadSteps(facts({ enabled: false }))).toEqual([])
  expect(aheadSteps(facts({ enabled: false, eula: true }))).toEqual([])
})

test("许可协议的边界：没同意之前只做打包和打开游戏本来就会下的；服务器文件要同意以后才下，和后台检查同一条规矩", () => {
  // Before the agreement: the development files (a pack) and the game's own files (opening the game works without the licence) only.
  expect(aheadSteps(facts({ eula: false }))).not.toContain("server")
  // After it: the server's files too, in the order a press needs them (pack, check, game).
  expect(aheadSteps(facts({ eula: true }))).toEqual(["development", "server", "client"])
  // Already there is skipped even when agreed.
  expect(aheadSteps(facts({ eula: true, ready: { build: true, check: true, play: false } }))).toEqual(["client"])
})

test("什么时候开始：蓝图确认了（AI 要开始做了），或者工程里已经有能打包的东西；刚起了个名字的空工程不下", () => {
  expect(aheadMoment({ blueprintConfirmed: true, things: 0 })).toBe("blueprint")
  expect(aheadMoment({ blueprintConfirmed: false, things: 3 })).toBe("content")
  expect(aheadMoment({ blueprintConfirmed: false, things: 0 })).toBeNull()
})

/** A computer to prepare: what is ready changes as the steps finish, as the disk does. */
function computer(initial: Partial<AheadFacts> = {}) {
  const state = { ...facts(), ...initial, ready: { ...(initial.ready ?? none) } }
  const log: string[] = []
  const live = { now: 0, most: 0 }
  const clock = { at: 1_000_000 }
  const holds: Partial<Record<AheadStep, { open: () => void }>> = {}
  const fail: Partial<Record<AheadStep, Error>> = {}
  const signals: Partial<Record<AheadStep, AbortSignal>> = {}
  const says: Partial<Record<AheadStep, (text: string) => void>> = {}
  const done = { build: "development", check: "server", play: "client" } as const
  const step = (name: AheadStep) => async (run: AheadRun) => {
    log.push(name)
    signals[name] = run.signal
    says[name] = run.onProgress
    live.now++
    live.most = Math.max(live.most, live.now)
    try {
      const hold = holds[name]
      if (hold) await new Promise<void>((resolve, reject) => {
        Object.assign(hold, { open: resolve })
        run.signal.addEventListener("abort", () => reject(new Error("CANCELLED")), { once: true })
      })
      if (fail[name]) throw fail[name]
      for (const [key, value] of Object.entries(done)) if (value === name) state.ready[key as keyof typeof state.ready] = true
    } finally {
      live.now--
    }
  }
  const reads = { count: 0 }
  // The wait for the next try is a timer: here it is recorded and fired by hand.
  const timers: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
  const changes = { count: 0 }
  const ahead = createPrepareAhead<string>({
    facts: async () => {
      reads.count++
      return { enabled: state.enabled, eula: state.eula, ready: { ...state.ready }, ...(state.whole ? { whole: { ...state.whole } } : {}) }
    },
    runners: { development: step("development"), server: step("server"), client: step("client") },
    now: () => clock.at,
    changed: () => void changes.count++,
    later: (run, ms) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => void (timer.cancelled = true)
    },
  })
  const started = (name: AheadStep) => untilObserved(async () => ahead.current(), (current) => current === name)
  /** The newest timer fires, as it would after its wait. */
  const fire = async () => {
    const timer = timers.at(-1)!
    clock.at += timer.ms
    if (!timer.cancelled) timer.run()
    await ahead.settled()
  }
  return { state, log, live, clock, holds, fail, signals, says, reads, ahead, timers, changes, fire, started }
}

test("一次只做一样、一次只有一路：按打包、检查、游戏的顺序做，下过的不再做，做完不留在后台", async () => {
  const pc = computer({ eula: true })
  pc.ahead.consider("p")
  // A second ask while it runs does nothing: there is one preparation for the computer.
  pc.ahead.consider("p")
  pc.ahead.consider("q", true)
  await pc.ahead.settled()
  expect(pc.log).toEqual(["development", "server", "client"])
  expect(pc.live.most).toBe(1)
  expect(pc.ahead.active()).toBe(false)
  expect(pc.ahead.current()).toBeNull()
  // Everything is there now: another ask, even after the wait, finds nothing to do.
  pc.clock.at += AHEAD_LOOK_MS + 1
  pc.ahead.consider("p")
  await pc.ahead.settled()
  expect(pc.log).toEqual(["development", "server", "client"])
})

test("已经下过的跳过：打包过的电脑只补游戏本体，全有的电脑什么都不启动", async () => {
  const warm = computer({ ready: { build: true, check: false, play: false } })
  warm.ahead.consider("p")
  await warm.ahead.settled()
  expect(warm.log).toEqual(["client"])
  const full = computer({ ready: { build: true, check: true, play: true }, eula: true })
  full.ahead.consider("p")
  await full.ahead.settled()
  expect(full.log).toEqual([])
})

test("开关关着不下；中途关掉马上停，已经下好的留着；再打开马上接着做", async () => {
  const off = computer({ enabled: false })
  off.ahead.consider("p")
  await off.ahead.settled()
  expect(off.log).toEqual([])
  const pc = computer()
  pc.holds.development = { open: () => {} }
  pc.ahead.consider("p")
  await pc.started("development")
  expect(pc.ahead.current()).toBe("development")
  pc.state.enabled = false
  pc.ahead.stop()
  await pc.ahead.settled()
  expect(pc.signals.development!.aborted).toBe(true)
  // Nothing after it ran, and it was a stop on purpose, not a failure to be held off for.
  expect(pc.log).toEqual(["development"])
  pc.state.enabled = true
  delete pc.holds.development
  pc.ahead.consider("p", true)
  await pc.ahead.settled()
  expect(pc.log).toEqual(["development", "development", "client"])
})

test("同意许可协议是中途发生的事：之后的一次检查就会把服务器文件加进来，而不是替他同意", async () => {
  const pc = computer({ eula: false })
  pc.holds.development = { open: () => {} }
  pc.ahead.consider("p")
  await pc.started("development")
  // The person agrees while the first step runs; the steps are chosen afresh before each one.
  pc.state.eula = true
  pc.holds.development!.open()
  await pc.ahead.settled()
  expect(pc.log).toEqual(["development", "server", "client"])
})

test("失败不是静悄悄的：一步失败整个准备停下，记下哪一步、白话原因和下次自动再试的时间；按 1、2、5、5 分钟退避，到点由定时器自己再试；成功了就清掉", async () => {
  expect(AHEAD_RETRY_MS).toEqual([60_000, 120_000, 300_000])
  expect([1, 2, 3, 4, 9].map(aheadRetryIn)).toEqual([60_000, 120_000, 300_000, 300_000, 300_000])
  const pc = computer()
  pc.fail.development = new Error("BUILD_NETWORK_FAILED")
  const began = pc.clock.at
  pc.ahead.consider("p")
  await pc.ahead.settled()
  // Nothing was thrown at anyone, and the later steps were not tried on a network that just failed.
  expect(pc.log).toEqual(["development"])
  expect(pc.ahead.active()).toBe(false)
  // What is kept: where, why in plain words, and when it is tried again.
  expect(pc.ahead.status().failure).toEqual({ step: "development", why: "下载时网络断了，或者停住了", at: began, retryAt: began + 60_000, failures: 1 })
  expect(pc.timers.map((timer) => timer.ms)).toEqual([60_000])
  // A save before its time does not try again (every save asks), not even the soon-ask of a look; the timer does it, whoever asks or not.
  pc.clock.at += 30_000
  pc.ahead.consider("p")
  await pc.ahead.settled()
  expect(pc.log).toEqual(["development"])
  // Failing again: two minutes, then five, then five.
  pc.clock.at = began
  await pc.fire()
  expect(pc.log).toEqual(["development", "development"])
  expect(pc.ahead.status().failure).toMatchObject({ failures: 2, retryAt: pc.clock.at + 120_000 })
  await pc.fire()
  expect(pc.ahead.status().failure).toMatchObject({ failures: 3, retryAt: pc.clock.at + 300_000 })
  await pc.fire()
  expect(pc.ahead.status().failure).toMatchObject({ failures: 4, retryAt: pc.clock.at + 300_000 })
  expect(pc.timers.map((timer) => timer.ms)).toEqual([60_000, 120_000, 300_000, 300_000])
  // The network is back: the next try goes through, and the failure and the count are gone.
  delete pc.fail.development
  await pc.fire()
  expect(pc.log.slice(-2)).toEqual(["development", "client"])
  expect(pc.ahead.status().failure).toBeNull()
  // A later failure begins at a minute again.
  pc.state.ready = { build: true, check: true, play: false }
  pc.fail.client = new Error("SCENE_DOWNLOAD_FAILED")
  pc.clock.at += AHEAD_LOOK_MS + 1
  pc.ahead.consider("p")
  await pc.ahead.settled()
  expect(pc.ahead.status().failure).toMatchObject({ step: "client", failures: 1, retryAt: pc.clock.at + 60_000 })
})

test("失败时说的原因是白话，而且只说得准的：下载断了、磁盘满了、文件被占用；不认识的错误不把原文端给人", async () => {
  const why = async (error: Error) => {
    const pc = computer()
    pc.fail.development = error
    pc.ahead.consider("p")
    await pc.ahead.settled()
    return pc.ahead.status().failure!.why
  }
  expect(await why(new Error("SCENE_DOWNLOAD_FAILED"))).toBe("下载时网络断了，或者停住了")
  expect(await why(Object.assign(new Error("write failed"), { code: "ENOSPC" }))).toBe("磁盘空间不够了")
  expect(await why(Object.assign(new Error("busy"), { code: "EBUSY" }))).toBe("有文件被占用，或者没有写入权限")
  expect(await why(new Error("C:\\Users\\someone\\secret failed"))).toBe("出了意料之外的问题")
})

test("有人点打包：不等间隔。上次没做成的游戏文件马上接着做；开发文件不再另起一份（打包自己就在下）；上次成功了或正在做就什么都不做", async () => {
  // The game's files failed: the press tries them at once, without waiting for the minute.
  const game = computer({ ready: { build: true, check: false, play: false } })
  game.fail.client = new Error("SCENE_DOWNLOAD_FAILED")
  game.ahead.consider("p")
  await game.ahead.settled()
  expect(game.ahead.status().failure).toMatchObject({ step: "client" })
  delete game.fail.client
  game.ahead.pressed("p")
  await game.ahead.settled()
  expect(game.log).toEqual(["client", "client"])
  expect(game.ahead.status().failure).toBeNull()
  // The development files failed: the pack is the retry, so only what the pack does not fetch is tried.
  const pack = computer()
  pack.fail.development = new Error("BUILD_NETWORK_FAILED")
  pack.ahead.consider("p")
  await pack.ahead.settled()
  delete pack.fail.development
  pack.ahead.pressed("p")
  await pack.ahead.settled()
  expect(pack.log).toEqual(["development", "client"])
  // Nothing failed before: a press starts nothing by itself.
  const fine = computer({ ready: { build: true, check: true, play: true } })
  fine.ahead.pressed("p")
  await fine.ahead.settled()
  expect(fine.log).toEqual([])
  // One that is running is left alone.
  const busy = computer()
  busy.holds.development = { open: () => {} }
  busy.ahead.consider("p")
  await busy.started("development")
  busy.ahead.pressed("p")
  expect(busy.log).toEqual(["development"])
  busy.holds.development!.open()
  await busy.ahead.settled()
})

test("人自己改了能下什么（同意协议、打开开关）是现在就试的理由，不被失败后的等待挡住", async () => {
  const pc = computer({ eula: false })
  pc.fail.development = new Error("BUILD_NETWORK_FAILED")
  pc.ahead.consider("p")
  await pc.ahead.settled()
  delete pc.fail.development
  pc.state.eula = true
  pc.ahead.consider("p", true)
  await pc.ahead.settled()
  expect(pc.log).toEqual(["development", "development", "server", "client"])
  expect(pc.ahead.status().failure).toBeNull()
})

test("下的时候每一步都通知窗口（开始、结束、失败、全部做完），计数不通知；当前步和最新的计数能读到", async () => {
  const pc = computer()
  pc.holds.development = { open: () => {} }
  pc.ahead.consider("p")
  await pc.started("development")
  const atStart = pc.changes.count
  expect(atStart).toBeGreaterThan(0)
  expect(pc.ahead.status()).toMatchObject({ step: "development", counter: null, failure: null })
  pc.says.development!("> Task :compileJava\n")
  pc.says.development!("正在准备游戏的开发文件：这一步已经新增 12 MB\n")
  expect(pc.ahead.status().counter).toBe("正在准备游戏的开发文件：这一步已经新增 12 MB")
  expect(pc.changes.count).toBe(atStart)
  pc.holds.development!.open()
  await pc.ahead.settled()
  // The step ended, the next began and ended, and the preparation was over: the window was told each time.
  expect(pc.changes.count).toBeGreaterThanOrEqual(atStart + 4)
  expect(pc.ahead.status()).toEqual({ step: null, counter: null, failure: null })
  const broken = computer()
  broken.fail.development = new Error("BUILD_NETWORK_FAILED")
  const before = broken.changes.count
  broken.ahead.consider("p")
  await broken.ahead.settled()
  expect(broken.changes.count).toBeGreaterThan(before)
  // Whoever listens failing does not fail the preparation.
  const noisy = createPrepareAhead<string>({ facts: async () => facts({ ready: { build: true, check: true, play: false } }), runners: { development: async () => {}, server: async () => {}, client: async () => {} }, changed: () => { throw new Error("listener") } })
  noisy.consider("p")
  await noisy.settled()
  expect(noisy.status().failure).toBeNull()
})

test("没齐的算没做：主要文件有了、但还有没取的（只做过代码检查、前置不在缓存里），照样补；全齐的才不动", () => {
  const ready = { build: true, check: true, play: true }
  expect(aheadSteps(facts({ ready, whole: { build: false, play: true } }))).toEqual(["development"])
  expect(aheadSteps(facts({ ready, whole: { build: true, play: false } }))).toEqual(["client"])
  expect(aheadSteps(facts({ ready, whole: { build: true, play: true } }))).toEqual([])
  // Not known to be partial is whole (a caller that does not say).
  expect(aheadSteps(facts({ ready }))).toEqual([])
})

test("看过没事做的电脑，一分钟内不再看磁盘（每次保存都会问一遍）", async () => {
  const pc = computer({ ready: { build: true, check: true, play: true } })
  pc.ahead.consider("p")
  await pc.ahead.settled()
  const looked = pc.reads.count
  for (let saves = 0; saves < 20; saves++) pc.ahead.consider("p")
  await pc.ahead.settled()
  expect(pc.reads.count).toBe(looked)
})

test("与打包的接续：开发文件正在下时，打包等着它并说一句话、带上进度数字；它失败了打包照常自己下；游戏文件那两步不用等", async () => {
  const pc = computer()
  pc.holds.development = { open: () => {} }
  pc.ahead.consider("p")
  await pc.started("development")
  const told: string[] = []
  const waiting = pc.ahead.join({ onProgress: (text) => void told.push(text) })
  let over = false
  void waiting.then(() => (over = true))
  await Promise.resolve()
  expect(over).toBe(false)
  // Gradle's own lines are not handed on (they would say the mod is being compiled); the counter is.
  pc.says.development!("> Task :compileJava\n")
  pc.says.development!("正在准备游戏的开发文件：这一步已经新增 12 MB\n")
  pc.holds.development!.open()
  expect(await waiting).toBe(true)
  expect(told).toEqual([`${AHEAD_WORDS.now}\n`, "正在准备游戏的开发文件：这一步已经新增 12 MB\n"])
  await pc.ahead.settled()
  // Nothing running: nothing to wait for.
  expect(await pc.ahead.join({})).toBe(false)
  // The preparation failed: the pack is released all the same, to fetch for itself.
  const broken = computer()
  broken.holds.development = { open: () => {} }
  broken.fail.development = new Error("BUILD_NETWORK_FAILED")
  broken.ahead.consider("p")
  await broken.started("development")
  const released = broken.ahead.join({})
  broken.holds.development!.open()
  expect(await released).toBe(true)
  // At the game's files a pack has nothing to wait for: it does its own, which joins the running one (mod-core, `preparing`).
  const late = computer({ ready: { build: true, check: false, play: false } })
  late.holds.client = { open: () => {} }
  late.ahead.consider("p")
  await late.started("client")
  expect(late.ahead.current()).toBe("client")
  expect(await late.ahead.join({})).toBe(false)
  late.holds.client!.open()
  await late.ahead.settled()
  // A pack cancelled while it waits stops waiting, and the preparation goes on.
  const slow = computer()
  slow.holds.development = { open: () => {} }
  slow.ahead.consider("p")
  await slow.started("development")
  const stopped = new AbortController()
  const cancelled = slow.ahead.join({ signal: stopped.signal })
  stopped.abort()
  await expect(cancelled).rejects.toThrow("CANCELLED")
  expect(slow.signals.development!.aborted).toBe(false)
  slow.holds.development!.open()
  await slow.ahead.settled()
})

// --- in the service: when it starts, the switch, the panel's line, the pack that comes while it runs ---

async function studio(over: { runners?: Parameters<typeof createStudioService>[0]["ahead"] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-ahead-"))
  roots.push(root)
  const options = { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} }
  const log: string[] = []
  const holds: Partial<Record<AheadStep, { open: () => void }>> = {}
  const signals: Partial<Record<AheadStep, AbortSignal>> = {}
  const profile = resolveProfile("fabric-1.21.1")
  const paths = scenePaths(options.runtimeDirectory, "none")
  // What each step leaves on the disk when it is done, as the real ones do: the marks the next look reads.
  const leaves: Record<AheadStep, () => Promise<void>> = {
    development: () => markGradleReady(options.runtimeDirectory, "build"),
    server: async () => {
      await mkdir(paths.game, { recursive: true })
      await mkdir(paths.serverLibraries, { recursive: true })
      await writeFile(path.join(paths.game, `server-${profile.minecraft}.jar`), "")
      await writeFile(path.join(paths.serverLibraries, `fabric-loader-${profile.loader}.jar`), "")
    },
    client: async () => {
      // Everything the real step leaves: the game's files and the two mods every scene starts with.
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
    signals[name] = run.signal
    const hold = holds[name]
    if (hold) await new Promise<void>((resolve, reject) => {
      Object.assign(hold, { open: resolve })
      run.signal.addEventListener("abort", () => reject(new Error("CANCELLED")), { once: true })
    })
    await leaves[name]()
  }
  const service = await createStudioService({ ...options, ahead: { on: true, runners: { development: runner("development"), server: runner("server"), client: runner("client") } } })
  services.push(service)
  return { service, log, holds, signals, options }
}

test("工程里有东西才开始：空工程不下；加了第一样东西开始；这台电脑已经有就不再下；没同意许可协议不下服务器文件", async () => {
  const { service, log } = await studio()
  const created = await service.createProject({ name: "空的", description: "", empty: true })
  await service.openProject(created.project.id)
  await service.aheadSettled()
  expect(log).toEqual([])
  await service.addEntity({ projectId: created.project.id, expectedRevision: created.project.revision, name: "第一只" })
  await service.aheadSettled()
  // Pack and game, not the server: the licence has not been agreed.
  expect(log).toEqual(["development", "client"])
  expect((await service.getScene({ projectId: created.project.id })).eula).toBe(false)
  // Opened again later: it is all there, nothing is started.
  await service.openProject(created.project.id)
  await service.aheadSettled()
  expect(log).toEqual(["development", "client"])
  // The person agrees: the server's files, the one thing that was held back for it, are fetched, and only those.
  await service.agreeSceneEula()
  await service.aheadSettled()
  expect(log).toEqual(["development", "client", "server"])
  expect((await service.getBuildPanel({ projectId: created.project.id })).ready).toEqual({ build: true, check: true, play: true })
})

test("蓝图确认的那一刻开始（AI 要开始做了），还没确认不下", async () => {
  const { service, log } = await studio()
  const created = await service.createProject({ name: "要做的", description: "", empty: true })
  const entries = [{ key: "gem", kind: "item", title: "宝石", brief: "做一个宝石", owner: null, needs: [], out_of_scope: null }] as BlueprintPlan["entries"]
  const plan = played({ style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }, entries, questions: [] })
  await service.saveBlueprint({ projectId: created.project.id, revision: 0, blueprint: { request: "做一个宝石", ...plan } })
  await service.openProject(created.project.id)
  await service.aheadSettled()
  expect(log).toEqual([])
  await service.confirmBlueprint({ projectId: created.project.id, revision: 1 })
  await service.aheadSettled()
  expect(log).toEqual(["development", "client"])
})

test("设置里的开关：默认开；关掉就不提前下，下着的马上停；重新打开接着做", async () => {
  expect(SettingsSchema.parse({}).prepareAhead).toBe(true)
  // A settings file from before the switch existed reads as on.
  expect(SettingsSchema.parse({ nickname: "旧" }).prepareAhead).toBe(true)
  const { service, log, holds, signals } = await studio()
  const settings = await service.getSettings()
  expect(settings.prepareAhead).toBe(true)
  await service.saveSettings({ ...settings, prepareAhead: false })
  const created = await service.createProject({ name: "流量有限", description: "" })
  await service.openProject(created.project.id)
  await service.aheadSettled()
  expect(log).toEqual([])
  expect((await service.getBuildPanel({ projectId: created.project.id })).preparing).toBeUndefined()
  // On again: it starts at once, without waiting for the next save.
  holds.development = { open: () => {} }
  await service.saveSettings({ ...settings, prepareAhead: true })
  await untilObserved(async () => log, (entries) => entries.includes("development"))
  expect(log).toEqual(["development"])
  // Off while it runs: the step is told to stop.
  await service.saveSettings({ ...settings, prepareAhead: false })
  await service.aheadSettled()
  expect(signals.development!.aborted).toBe(true)
  expect(log).toEqual(["development"])
})

test("生产环境默认不动：不是应用打开的服务（比如各种测试里的服务）从不自己下载", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-ahead-"))
  roots.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} })
  services.push(service)
  const created = await service.createProject({ name: "有东西", description: "" })
  await service.openProject(created.project.id)
  await service.aheadSettled()
  expect((await service.getBuildPanel({ projectId: created.project.id })).preparing).toBeUndefined()
})

test("面板那一行和打包接上：下着的时候面板说正在提前准备；这时点打包，打包等它，并用同一句话，下好了才往下走", async () => {
  const { service, holds } = await studio()
  holds.development = { open: () => {} }
  const created = await service.createProject({ name: "正赶上", description: "" })
  const panel = () => service.getBuildPanel({ projectId: created.project.id })
  expect((await untilObserved(panel, (panel) => panel.preparing === true)).preparing).toBe(true)
  const { jobId } = await service.buildProject({ projectId: created.project.id })
  const detail = async () => ((await service.getJob({ projectId: created.project.id, jobId })).checkpoint as { detail?: string } | null)?.detail ?? ""
  await untilObserved(detail, (text) => text.includes(AHEAD_WORDS.now))
  const waiting = await service.getJob({ projectId: created.project.id, jobId })
  expect(waiting.state).toBe("running")
  expect(await detail()).toContain(AHEAD_WORDS.now)
  // The preparation is still blocked, so the pack has joined it without starting its own build.
  expect((await panel()).preparing).toBe(true)
  expect((await service.getJob({ projectId: created.project.id, jobId })).state).toBe("running")
  expect(await detail()).not.toContain("Assembling")
  // The files arrive: the pack goes on (here it ends at once, there is no template to pack from), and the panel's line is gone.
  holds.development!.open()
  await service.aheadSettled()
  await untilObserved(() => service.getJob({ projectId: created.project.id, jobId }), (job) => !["queued", "running"].includes(job.state))
  expect(await detail()).not.toContain("Waiting for the runtime environment")
  expect((await service.getBuildPanel({ projectId: created.project.id })).preparing).toBeUndefined()
}, 120_000)

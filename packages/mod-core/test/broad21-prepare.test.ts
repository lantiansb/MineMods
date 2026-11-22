import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prepareDevelopmentFiles } from "../src/build"
import { resolveProfile } from "../src/fabric/profile"
import { BUILD_NETWORK_FAILED, GRADLE_STOOD_STILL, gradleNetworkFailure } from "../src/gradle-network"
import { COUNTER_LABELS, readCounter } from "../src/progress-counter"
import type { ProcessCpuWatch } from "../src/process-cpu"
import { directorySize, gradleReady, gradleWhole, markGradleReady, runOwnedProcess, type StallClock } from "../src/runtime"
import { counted, prepareSceneClient, preparing, sceneModsReady, scenePaths } from "../src/scene-run"

const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))
const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const folder = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-broad21-"))
  roots.push(directory)
  return directory
}
const profile = resolveProfile("fabric-1.21.1")

/** A Java that is a shell script: says it is 21, and for any other call runs `body` (a shell fragment) in the project folder with GRADLE_USER_HOME set; the number of such calls is written to `runs`. */
async function fakeJava(directory: string, body: string) {
  const home = path.join(directory, "java")
  const runs = path.join(directory, "runs.log")
  await mkdir(path.join(home, "bin"), { recursive: true })
  await writeFile(
    path.join(home, "bin", "java"),
    `#!/bin/sh\nif [ "$1" = "-version" ]; then echo 'openjdk version "21.0.4" 2024-07-16' >&2; exit 0; fi\necho "$@" >> '${runs}'\n${body}`,
  )
  await chmod(path.join(home, "bin", "java"), 0o755)
  return { home, runs: async () => (await readFile(runs, "utf8").catch(() => "")).trim().split("\n").filter(Boolean) }
}

// --- 停滞才算失败，不是总时长 ---

function stallTime() {
  let current = 0
  let timer: { at: number; work: () => Promise<void> } | undefined
  const clock: StallClock = {
    now: () => current,
    schedule: (ms, work) => {
      const next = { at: current + ms, work }
      timer = next
      return () => { if (timer === next) timer = undefined }
    },
  }
  return {
    clock,
    pending: () => timer !== undefined,
    async advance(ms: number) {
      const until = current + ms
      while (timer && timer.at <= until) {
        const next = timer
        timer = undefined
        current = next.at
        await next.work()
      }
      current = until
    },
  }
}

function monitored(stall: { ms: number; look: () => Promise<number>; clock: StallClock; cpu?: ProcessCpuWatch }, start = "") {
  const signal = new AbortController()
  const input = Promise.withResolvers<(line: string) => void>()
  const lines = new Map<string, () => void>()
  const exited = runOwnedProcess(process.execPath, ["-e", `
    const lines = require("node:readline").createInterface({ input: process.stdin });
    if (${JSON.stringify(start)}) console.log(${JSON.stringify(start)});
    lines.on("line", (line) => {
      if (line === "exit") lines.close();
      else if (line.startsWith("raw ")) process.stdout.write(line.slice(4));
      else console.log(line);
    });
  `], {
    signal: signal.signal, stall: { ...stall, every: 20 },
    interact: input.resolve,
    onProgress: (text) => text.split("\n").forEach((line) => lines.get(line)?.()),
  }).catch((error: unknown) => error as Error & { output?: string })
  const waitFor = (line: string) => Promise.race([
    new Promise<void>((resolve) => lines.set(line, resolve)),
    exited.then((result) => { throw new Error(`Subprocess closed before ${line}: ${JSON.stringify(result)}`) }),
  ])
  return { input: input.promise, waitFor, exited, close: () => { signal.abort(); return exited } }
}

test("一直有进展的长下载不会被杀：安静（没有输出）但下载文件夹一直在长，比「停滞时限」久得多也照常跑完", async () => {
  const directory = await folder()
  const watched = path.join(directory, "cache")
  await mkdir(watched)
  const time = stallTime()
  const process = monitored({ ms: 200, look: () => directorySize(watched), clock: time.clock })
  try {
    const write = await process.input
    for (let count = 1; count <= 25; count += 1) {
      await writeFile(path.join(watched, "part"), "x".repeat(count * 1000))
      await time.advance(40)
    }
    write("exit\n")
    expect(await process.exited).toMatchObject({ code: 0, output: "" })
    expect(await directorySize(watched)).toBe(25_000)
    expect(time.clock.now()).toBeGreaterThan(5 * 200 - 1)
  } finally {
    await process.close()
  }
}, 120_000)

test("一直有输出的长任务也不会被杀；输出和下载都停住了才算停滞，并带着停住前它写过的话", async () => {
  const directory = await folder()
  const talkingTime = stallTime()
  const talker = monitored({ ms: 200, look: async () => 0, clock: talkingTime.clock })
  try {
    const write = await talker.input
    for (let index = 0; index < 20; index += 1) {
      await talkingTime.advance(40)
      const line = `line ${index}`
      const read = talker.waitFor(line)
      write(line + "\n")
      await read
    }
    write("exit\n")
    expect(await talker.exited).toMatchObject({ code: 0, output: expect.stringContaining("line 19") })
  } finally {
    await talker.close()
  }
  // Printed once, then nothing at all and nothing growing: ended for standing still, carrying what it printed.
  const quietTime = stallTime()
  const quiet = monitored({ ms: 300, look: () => directorySize(directory), clock: quietTime.clock })
  try {
    const read = quiet.waitFor("started")
    const write = await quiet.input
    await quietTime.advance(20)
    write("started\n")
    await read
    await quietTime.advance(299)
    expect(quietTime.clock.now()).toBe(319)
    await quietTime.advance(1)
    const error = await quiet.exited
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("PROCESS_STALLED")
    expect(error.output).toContain("started")
    expect(quietTime.clock.now()).toBeLessThan(5000)
  } finally {
    await quiet.close()
  }
}, 120_000)

test("还没有换行的真实输出也算进展，日志仍按行给出", async () => {
  const time = stallTime()
  const observed = { bytes: () => {} }
  const child = monitored({
    ms: 120,
    look: async () => 0,
    clock: { ...time.clock, now: () => { observed.bytes(); return time.clock.now() } },
  })
  try {
    const write = await child.input
    await time.advance(20)
    for (let part = 0; part < 5; part++) {
      await time.advance(100)
      const bytes = Promise.withResolvers<void>()
      observed.bytes = bytes.resolve
      write("raw abc\n")
      await bytes.promise
    }
    const line = child.waitFor("abc".repeat(5))
    write("\n")
    await line
    write("exit\n")
    expect(await child.exited).toEqual({ code: 0, output: "abc".repeat(5) + "\n" })
  } finally {
    await child.close()
  }
}, 120_000)

test("只有孙进程的 CPU 在涨也算进展，它静下来以后仍按时结束", async () => {
  const time = stallTime()
  const work = { cpu: 0 }
  const child = monitored({
    ms: 120,
    look: async () => 8,
    clock: time.clock,
    cpu: { read: async (pid) => ({ rootStarted: 1, processes: new Map([[`${pid}:1`, 0], ["worker:2", work.cpu]]) }) },
  })
  try {
    const write = await child.input
    const started = child.waitFor("started")
    write("started\n")
    await started
    await time.advance(20)
    for (let step = 0; step < 4; step++) {
      work.cpu += 120
      await time.advance(100)
    }
    work.cpu += 120
    await time.advance(20)
    await time.advance(119)
    expect(time.pending()).toBe(true)
    await time.advance(1)
    expect(await child.exited).toMatchObject({ message: "PROCESS_STALLED", output: "started\n" })
  } finally {
    await child.close()
  }
}, 120_000)

test.skipIf(process.platform === "win32")("Gradle 一直在长文件，跑得比停滞时限久也算做成：做完留下「下过了」的记号（打包自己的任务）", async () => {
  const directory = await folder()
  const runtimeDirectory = path.join(directory, "runtime")
  const java = await fakeJava(directory, 'i=0; while [ $i -lt 14 ]; do sleep 0.1; echo xxxxxxxxxx >> "$GRADLE_USER_HOME/grown"; i=$((i+1)); done\nexit 0\n')
  const options = { templateDirectory, javaHome: java.home, runtimeDirectory, stall: { ms: 400, every: 40 } }
  await mkdir(path.join(runtimeDirectory, "gradle-home"), { recursive: true })
  const began = Date.now()
  expect(await prepareDevelopmentFiles(options)).toBe("prepared")
  expect(Date.now() - began).toBeGreaterThan(1000)
  expect(await java.runs()).toHaveLength(1)
  expect(await gradleWhole(runtimeDirectory)).toBe(true)
})

test.skipIf(process.platform === "win32")("Gradle 停住了（没输出、文件夹也不长）就结束这一次，当成下载断了再跑，几次都停住才失败；不留「下过了」的记号", async () => {
  const directory = await folder()
  const runtimeDirectory = path.join(directory, "runtime")
  const java = await fakeJava(directory, "sleep 30\n")
  const told: string[] = []
  const options = { templateDirectory, javaHome: java.home, runtimeDirectory, stall: { ms: 300, every: 30 }, pause: async () => undefined, onProgress: (text: string) => void told.push(text) }
  const began = Date.now()
  await expect(prepareDevelopmentFiles(options)).rejects.toThrow(BUILD_NETWORK_FAILED)
  // The first run and the three runs again that got nothing further (`GRADLE_NETWORK.retries`), each ended when it stood still and not after 30 seconds.
  expect(await java.runs()).toHaveLength(4)
  expect(Date.now() - began).toBeLessThan(15_000)
  expect(told.join("")).toContain(GRADLE_STOOD_STILL)
  expect(await gradleReady(runtimeDirectory)).toBe(false)
})

test("停住的那句话算「下载断了」，但真正的编译错误不会被它盖过", () => {
  expect(gradleNetworkFailure(`> Task :compileJava\n${GRADLE_STOOD_STILL}\n`)).toBe(true)
  expect(gradleNetworkFailure(`Foo.java:3: error: cannot find symbol\n${GRADLE_STOOD_STILL}\n`)).toBe(false)
})

// --- 准备要覆盖打包真正要的东西 ---

test.skipIf(process.platform === "win32")("开发文件：只做过代码检查的电脑还不算齐，要补一次打包自己的任务；做过打包的才算齐，之后再做代码检查也不会让它不齐", async () => {
  const directory = await folder()
  const runtimeDirectory = path.join(directory, "runtime")
  const java = await fakeJava(directory, "exit 0\n")
  const options = { templateDirectory, javaHome: java.home, runtimeDirectory }
  await markGradleReady(runtimeDirectory, "compileJava")
  // Main files are there (the next pack is not a first time) but not every file a pack resolves.
  expect(await gradleReady(runtimeDirectory)).toBe(true)
  expect(await gradleWhole(runtimeDirectory)).toBe(false)
  expect(await prepareDevelopmentFiles(options)).toBe("prepared")
  const [line] = await java.runs()
  expect(line!.endsWith(" build")).toBe(true)
  expect(await gradleWhole(runtimeDirectory)).toBe(true)
  // A code check afterwards leaves its own mark, and what a pack has fetched stays fetched.
  await markGradleReady(runtimeDirectory, "compileJava")
  expect(await gradleWhole(runtimeDirectory)).toBe(true)
  expect(await prepareDevelopmentFiles(options)).toBe("already")
  expect(await java.runs()).toHaveLength(1)
  // A mark written before the field existed is read by its task.
  const old = await folder()
  await mkdir(path.join(old, "gradle-home"), { recursive: true })
  await writeFile(path.join(old, "gradle-home", "minemods-ready.json"), JSON.stringify({ at: "2026-10-01T00:00:00.000Z", task: "build" }))
  expect(await gradleWhole(old)).toBe(true)
  await writeFile(path.join(old, "gradle-home", "minemods-ready.json"), JSON.stringify({ at: "2026-10-01T00:00:00.000Z", task: "compileJava" }))
  expect(await gradleWhole(old)).toBe(false)
})

test("游戏本体那一步把测试场要装的前置（Fabric API、GeckoLib）也取进缓存：它们的固定下载地址在这一步里被要过", async () => {
  const runtimeDirectory = await folder()
  const asked: string[] = []
  // The pinned bytes cannot be made here, so the first file fails its checksum: what is under test is which files this step asks for first.
  const fetch = async (input: { url: string; destination: string }) => {
    asked.push(input.url)
    await writeFile(input.destination, "x")
  }
  await expect(prepareSceneClient(runtimeDirectory, { runtimeDirectory, fetch })).rejects.toThrow("DOWNLOAD_CHECKSUM_MISMATCH")
  expect(asked).toContain(profile.downloads.fabricApi.url)
  expect(asked).toContain(profile.geckolib.download.url)
  // They go where the test scene takes them from (`deployScene`), so the first check finds them there.
  const paths = scenePaths(runtimeDirectory, "none")
  expect(paths.mods).toBe(path.join(runtimeDirectory, "scene", profile.id, "mods"))
})

test("前置齐了才算齐：两个前置都在缓存里，游戏文件才算备齐", async () => {
  const runtimeDirectory = await folder()
  const mods = scenePaths(runtimeDirectory, "none").mods
  expect(await sceneModsReady(runtimeDirectory)).toBe(false)
  await mkdir(mods, { recursive: true })
  await writeFile(path.join(mods, `fabric-api-${profile.fabricApi}.jar`), "")
  expect(await sceneModsReady(runtimeDirectory)).toBe(false)
  await writeFile(path.join(mods, `geckolib-fabric-${profile.minecraft}-${profile.geckolib.version}.jar`), "")
  expect(await sceneModsReady(runtimeDirectory)).toBe(true)
})

// --- 子步骤和计数 ---

test("计数：一步开始就说「0 / 总数」（先把这一步的名字亮出来），之后每隔几个和最后一个说一次；读出来就是真实的子步骤", () => {
  const said: string[] = []
  const tick = counted({ onProgress: (text) => void said.push(text) }, COUNTER_LABELS.runtime, 12, 5)
  for (let index = 0; index < 12; index++) tick()
  expect(said).toEqual(["游戏的运行库：0 / 12\n", "游戏的运行库：5 / 12\n", "游戏的运行库：10 / 12\n", "游戏的运行库：12 / 12\n"])
  expect(readCounter(said[1]!)).toMatchObject({ label: "游戏的运行库", done: 5, of: 12 })
  // One file: begun, then done.
  const one: string[] = []
  counted({ onProgress: (text) => void one.push(text) }, COUNTER_LABELS.client, 1)()
  expect(one).toEqual(["游戏本体：0 / 1\n", "游戏本体：1 / 1\n"])
})

test("接上正在做的准备：后来的人一加入就听到现在数到哪了（只补最新的一条计数），不是等下一个文件", async () => {
  const runtimeDirectory = await folder()
  const gate = { open: () => {} }
  const opened = new Promise<void>((resolve) => (gate.open = resolve))
  const work = async (options: { onProgress?: (text: string) => void }) => {
    options.onProgress?.("准备测试场要用的游戏文件（游戏本体）。\n")
    options.onProgress?.("游戏的运行库：0 / 54\n")
    options.onProgress?.("游戏的运行库：25 / 54\n")
    await opened
    options.onProgress?.("游戏的运行库：54 / 54\n")
  }
  const early = preparing("client", runtimeDirectory, { runtimeDirectory, gentle: true }, work)
  const heard: string[] = []
  const late = preparing("client", runtimeDirectory, { runtimeDirectory, onProgress: (text) => void heard.push(text) }, work)
  // Told at once where it stands; the sentence and the older count are not told again.
  expect(heard).toEqual(["游戏的运行库：25 / 54\n"])
  gate.open()
  await Promise.all([early, late])
  expect(heard).toEqual(["游戏的运行库：25 / 54\n", "游戏的运行库：54 / 54\n"])
})

import { afterEach, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prepareDevelopmentFiles } from "../src/build"
import { BUILD_NETWORK_FAILED } from "../src/gradle-network"
import { gradleReady, markGradleReady } from "../src/runtime"
import { SCENE_GENTLE, prepareSceneServer, preparing, sceneBeingPrepared, type ScenePace } from "../src/scene-run"
import { HANDSHAKE } from "./fixtures/gradle-output"

const roots: string[] = []
afterEach(() => Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))
const templateDirectory = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const folder = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-ahead-"))
  roots.push(directory)
  return directory
}

/** A Java that is a shell script: says it is 21, and for any other call writes down where it ran, with what, and whether the project it was given is there; then ends as `ending` says. */
async function fakeJava(directory: string, ending: string) {
  const home = path.join(directory, "java")
  const log = path.join(directory, "gradle.log")
  await mkdir(path.join(home, "bin"), { recursive: true })
  await writeFile(
    path.join(home, "bin", "java"),
    `#!/bin/sh\nif [ "$1" = "-version" ]; then echo 'openjdk version "21.0.4" 2024-07-16' >&2; exit 0; fi\necho "$PWD|$GRADLE_USER_HOME|$(test -f build.gradle && echo project)|$(test -f gradle/wrapper/gradle-wrapper.jar && echo wrapper)|$@" >> '${log}'\n${ending}`,
  )
  await chmod(path.join(home, "bin", "java"), 0o755)
  return { home, log }
}

test.skipIf(process.platform === "win32")("提前准备开发文件：这台电脑下过了就什么都不做；没下过就用打包同一份缓存、跑打包自己的任务做一个空模组，做完不留东西、留下「下过了」的记号", async () => {
  const directory = await folder()
  const runtimeDirectory = path.join(directory, "runtime")
  const java = await fakeJava(directory, "exit 0\n")
  const options = { templateDirectory, javaHome: java.home, runtimeDirectory, lowPriority: true }
  // Already there: nothing is scaffolded, no Java is started.
  await markGradleReady(runtimeDirectory, "build")
  expect(await prepareDevelopmentFiles(options)).toBe("already")
  expect(await readFile(java.log, "utf8").catch(() => "")).toBe("")
  expect(await readdir(runtimeDirectory)).toEqual(["gradle-home"])
  // Not there: one Gradle run of the pack's own task, from the template, into the gradle-home every pack uses.
  await rm(path.join(runtimeDirectory, "gradle-home"), { recursive: true })
  expect(await gradleReady(runtimeDirectory)).toBe(false)
  expect(await prepareDevelopmentFiles(options)).toBe("prepared")
  const runs = (await readFile(java.log, "utf8")).trim().split("\n")
  expect(runs).toHaveLength(1)
  const [cwd, home, project, wrapper, line] = runs[0]!.split("|")
  expect(path.basename(path.dirname(cwd!))).toBe("prepare")
  expect(home).toBe(path.join(runtimeDirectory, "gradle-home"))
  expect([project, wrapper]).toEqual(["project", "wrapper"])
  expect(line!.endsWith(" build")).toBe(true)
  // Few downloads at once, the figure a pack uses.
  expect(line).toContain("--max-workers=2")
  // It succeeded, so the next pack is not a first time; and the scratch project is gone.
  expect(await gradleReady(runtimeDirectory)).toBe(true)
  expect(await readdir(path.join(runtimeDirectory, "prepare"))).toEqual([])
  // And a second ask is a skip again.
  expect(await prepareDevelopmentFiles(options)).toBe("already")
  expect((await readFile(java.log, "utf8")).trim().split("\n")).toHaveLength(1)
})

test.skipIf(process.platform === "win32")("提前准备开发文件：断网时说成下载失败、不留「下过了」的记号；中途取消不再往下做", async () => {
  const directory = await folder()
  const runtimeDirectory = path.join(directory, "runtime")
  const java = await fakeJava(directory, `cat <<'OUT'\n${HANDSHAKE}OUT\nexit 1\n`)
  const options = { templateDirectory, javaHome: java.home, runtimeDirectory, pause: async () => undefined }
  await expect(prepareDevelopmentFiles(options)).rejects.toThrow(BUILD_NETWORK_FAILED)
  expect(await gradleReady(runtimeDirectory)).toBe(false)
  expect(await readdir(path.join(runtimeDirectory, "prepare"))).toEqual([])
  const stopped = new AbortController()
  stopped.abort()
  const before = (await readFile(java.log, "utf8")).split("\n").length
  await expect(prepareDevelopmentFiles({ ...options, signal: stopped.signal })).rejects.toThrow("CANCELLED")
  expect((await readFile(java.log, "utf8")).split("\n").length).toBe(before)
}, 60_000)

test("游戏文件只准备一份：提前准备正在下时，打包接着要同样的文件，是接上它，不是再下一份；谁都不要了才停", async () => {
  const runtimeDirectory = await folder()
  const gate = { open: () => {} }
  const opened = new Promise<void>((resolve) => (gate.open = resolve))
  const started: string[] = []
  const work = async (options: { signal?: AbortSignal; onProgress?: (text: string) => void }) => {
    started.push("work")
    options.onProgress?.("一\n")
    await opened
    options.onProgress?.("二\n")
    return "files"
  }
  const heard = { ahead: [] as string[], press: [] as string[] }
  const ahead = preparing("client", runtimeDirectory, { runtimeDirectory, gentle: true, onProgress: (text) => void heard.ahead.push(text) }, work)
  expect(sceneBeingPrepared(runtimeDirectory)).toEqual(["client"])
  // The press asks for the same files while they are on their way.
  const press = preparing("client", runtimeDirectory, { runtimeDirectory, onProgress: (text) => void heard.press.push(text) }, work)
  gate.open()
  expect(await Promise.all([ahead, press])).toEqual(["files", "files"])
  expect(started).toEqual(["work"])
  // What is said afterwards reaches both; what was said before the press came is not repeated to it.
  expect(heard.ahead).toEqual(["一\n", "二\n"])
  expect(heard.press).toEqual(["二\n"])
  expect(sceneBeingPrepared(runtimeDirectory)).toEqual([])
  // Done is done: the next ask is a new piece of work (it finds the files in place and fetches nothing, see `held`).
  await preparing("client", runtimeDirectory, { runtimeDirectory }, async () => started.push("again"))
  expect(started).toEqual(["work", "again"])
  // The game's files and the server's files are two preparations, and another computer's folder is another one.
  const kinds = [preparing("server", runtimeDirectory, { runtimeDirectory }, async () => started.push("server")), preparing("client", `${runtimeDirectory}-other`, { runtimeDirectory }, async () => started.push("other"))]
  await Promise.all(kinds)
  expect(started.slice(2).sort()).toEqual(["other", "server"])
})

test("游戏文件只准备一份：一个人不要了不影响别人，最后一个也不要了才真停；停了以后再要是重新开始", async () => {
  const runtimeDirectory = await folder()
  const seen: AbortSignal[] = []
  const hang = (options: { signal?: AbortSignal }) =>
    new Promise<string>((resolve, reject) => {
      seen.push(options.signal!)
      options.signal!.addEventListener("abort", () => reject(new Error("CANCELLED")), { once: true })
      setTimeout(() => resolve("late"), 5000).unref()
    })
  const first = new AbortController()
  const second = new AbortController()
  const a = preparing("server", runtimeDirectory, { runtimeDirectory, signal: first.signal }, hang)
  const b = preparing("server", runtimeDirectory, { runtimeDirectory, signal: second.signal }, hang)
  const outcomes = [a.catch((error: Error) => error.message), b.catch((error: Error) => error.message)]
  first.abort()
  expect(await outcomes[0]).toBe("CANCELLED")
  // The one who left is told at once; the work goes on for the one still waiting.
  expect(seen).toHaveLength(1)
  expect(seen[0]!.aborted).toBe(false)
  second.abort()
  expect(await outcomes[1]).toBe("CANCELLED")
  expect(seen[0]!.aborted).toBe(true)
  // Asking again after it stopped starts it afresh, not on the stopped one.
  const fresh = await preparing("server", runtimeDirectory, { runtimeDirectory }, async () => "fresh")
  expect(fresh).toBe("fresh")
  // A call that is already stopped starts nothing.
  const stopped = new AbortController()
  stopped.abort()
  await expect(preparing("server", runtimeDirectory, { runtimeDirectory, signal: stopped.signal }, async () => "never")).rejects.toThrow("CANCELLED")
})

test("游戏文件只准备一份：真的服务器文件那一步也一样，两路同时要只发一次下载；协议没同意之前这里不会被调用（检查那边先拦）", async () => {
  const runtimeDirectory = await folder()
  const asked: string[] = []
  // The pinned bytes cannot be made here, so the first file fails its checksum: what is under test is how many times it was asked for.
  const fetch = async (input: { url: string; destination: string }) => {
    asked.push(input.url)
    await Bun.sleep(20)
    await writeFile(input.destination, "x")
  }
  const [one, two] = await Promise.allSettled([prepareSceneServer(runtimeDirectory, { runtimeDirectory, fetch, gentle: true }), prepareSceneServer(runtimeDirectory, { runtimeDirectory, fetch })])
  expect([one.status, two.status]).toEqual(["rejected", "rejected"])
  expect((one as PromiseRejectedResult).reason.message).toBe("DOWNLOAD_CHECKSUM_MISMATCH")
  expect((two as PromiseRejectedResult).reason.message).toBe("DOWNLOAD_CHECKSUM_MISMATCH")
  expect(asked).toHaveLength(1)
  expect(sceneBeingPrepared(runtimeDirectory)).toEqual([])
})

test("低并发：提前准备时同时只下两个文件，有人等着要这些文件就放开到全速；这个数就是 Gradle 打包用的那个", async () => {
  const { GRADLE_NETWORK } = await import("../src/gradle-network")
  expect(SCENE_GENTLE).toBe(GRADLE_NETWORK.workers)
  const { each } = await import("../src/scene-run")
  const pace: ScenePace = { gentle: true }
  const live = { now: 0, most: 0, done: 0, started: 0, draining: false }
  const release: Array<() => void> = []
  const milestones = new Map([2, 4, 10, 12].map((count) => [count, Promise.withResolvers<void>()]))
  const run = each(
    Array.from({ length: 12 }, (_, index) => index),
    8,
    async () => {
      live.now++
      live.most = Math.max(live.most, live.now)
      milestones.get(++live.started)?.resolve()
      if (!live.draining) await new Promise<void>((resolve) => release.push(resolve))
      live.now--
      live.done++
    },
    pace,
  )
  try {
    await milestones.get(2)!.promise
    expect(live.now).toBe(SCENE_GENTLE)
    // Let two finish: the next two start, never more than two at a time.
    release.splice(0).forEach((resolve) => resolve())
    await milestones.get(4)!.promise
    expect(live.most).toBe(SCENE_GENTLE)
    expect(live.now).toBe(SCENE_GENTLE)
    // Someone waits for these files now: the six held-back lanes must actually start.
    pace.gentle = false
    await milestones.get(10)!.promise
    expect(live.now).toBeGreaterThan(SCENE_GENTLE)
    release.splice(0).forEach((resolve) => resolve())
    await milestones.get(12)!.promise
  } finally {
    live.draining = true
    pace.gentle = false
    release.splice(0).forEach((resolve) => resolve())
    await run
  }
  expect(live.done).toBe(12)
  expect(live.most).toBeLessThanOrEqual(8)
  // A failure stops the rest, and a held-back lane does not wait forever for work that will not come.
  const failing = each(
    Array.from({ length: 12 }, (_, index) => index),
    8,
    async (index) => {
      if (index === 0) throw new Error("DOWNLOAD_FAILED")
      await Bun.sleep(5)
    },
    { gentle: true },
  )
  await expect(failing).rejects.toThrow("DOWNLOAD_FAILED")
}, 120_000)

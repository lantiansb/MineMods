import { afterEach, expect, test } from "bun:test"
import { untilObserved } from "./observed"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { createStudioService, dispatchStudioRequest, publicError, SETUP_WORDS } from "../src/main/service"
import { StudioRequestSchema, WorkerRequestSchema } from "../src/main/protocol"
import { SettingsSchema } from "../src/settings"
import { DEFAULT_TARGET, TARGETS, targetById } from "@minemods/mod-core/targets"
import { MOD_WORDS } from "@minemods/mod-core/modrinth"
import type { JavaFound } from "@minemods/mod-core/java-detect"

// fflate is mod-core's dependency, not Studio's: reached through mod-core, as the other tests that make jars do.
const { zipSync } = createRequire(path.join(import.meta.dir, "../../mod-core/package.json"))("fflate") as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array
}

// 新建工程的配置和运行环境 (2026-10-08): what Studio lets through. Finding Java and Modrinth are tested where they are
// driven (mod-core/test/java-detect.test.ts, modrinth.test.ts); here they are stand-ins.
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const java = (home: string, fits: boolean, source: JavaFound["source"] = "installed"): JavaFound => ({
  home,
  version: fits ? "21.0.8" : "17.0.12",
  major: fits ? 21 : 17,
  vendor: "Eclipse Adoptium",
  arch: "amd64",
  jdk: true,
  source,
  fits,
  why: fits ? null : "这是 Java 17，这个版本的游戏要 Java 21。",
})

async function setup(probe: Parameters<typeof createStudioService>[0]["javaProbe"] = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-setup-"))
  roots.push(root)
  const asked: { chosen?: string | null; installDirectory?: string | null }[] = []
  const options = {
    workspaceDirectory: path.join(root, "projects"),
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: path.join(root, "templates"),
    ai: {},
    javaProbe: {
      // Nothing on this computer but what a test says: an old Java 17 always, and whatever was asked for.
      detect: async (input: { chosen?: string | null; installDirectory?: string | null }) => {
        asked.push({ chosen: input.chosen, installDirectory: input.installDirectory })
        const found = [java("/opt/jdk-17", false)]
        if (input.chosen === "/opt/jdk-21") found.unshift(java("/opt/jdk-21", true, "chosen"))
        if (input.chosen === "/opt/jdk-17") found[0] = java("/opt/jdk-17", false, "chosen")
        return { found, using: found.find((value) => value.fits) ?? null }
      },
      ...probe,
    },
  }
  return { root, options, asked, service: await createStudioService(options) }
}

test("新建工程：游戏版本和加载器都列出来，只有真能做的那几个能选；不说就是默认的", async () => {
  const { service } = await setup()
  const { targets, chosen } = await service.getTargets()
  expect(chosen).toBe(DEFAULT_TARGET)
  expect(targets).toEqual([...TARGETS])
  expect(targets.filter((target) => target.ready).map((target) => target.id)).toEqual([DEFAULT_TARGET, "neoforge-1.21.1", "forge-1.20.1"])
  // The environment's profiles are the ready targets, not a second list.
  expect((await service.environment()).profiles).toEqual([
    { id: "fabric-1.21.1", java: 21, minecraft: "1.21.1", loader: "fabric", loaderVersion: "0.17.2" },
    { id: "neoforge-1.21.1", java: 21, minecraft: "1.21.1", loader: "neoforge", loaderVersion: "21.1.266" },
    { id: "forge-1.20.1", java: 17, minecraft: "1.20.1", loader: "forge", loaderVersion: "47.4.28" },
  ])

  const later = targets.find((target) => !target.ready)!
  await expect(service.createProject({ name: "还不能做", description: "", targetId: later.id })).rejects.toThrow(SETUP_WORDS.notReady(later))
  expect(SETUP_WORDS.notReady(targetById("forge-1.21.1")!)).toBe(`Minecraft 1.21.1 · Forge 现在还不能选。${targetById("forge-1.21.1")!.why}`)
  await expect(service.createProject({ name: "没有这个", description: "", targetId: "fabric-9.99" })).rejects.toThrow(SETUP_WORDS.unknownTarget)
  expect((await service.listProjects()).length).toBe(0)

  const plain = await service.createProject({ name: "默认的", description: "" })
  const chosenTarget = await service.createProject({ name: "选了的", description: "", targetId: DEFAULT_TARGET })
  expect([plain.project.target, chosenTarget.project.target]).toEqual(["fabric-1.21.1", "fabric-1.21.1"])
  // Forge 1.20.1 and NeoForge 1.21.1 are made for their own target, with the example creature like any new project.
  const forge = await service.createProject({ name: "熔岩守卫", description: "", targetId: "forge-1.20.1" })
  const neo = await service.createProject({ name: "苔藓守卫", description: "", targetId: "neoforge-1.21.1" })
  expect([forge.project.target, neo.project.target]).toEqual(["forge-1.20.1", "neoforge-1.21.1"])
  expect([forge.project.entities.length, neo.project.entities.length]).toEqual([1, 1])
  expect(StudioRequestSchema.safeParse({ method: "createProject", input: { name: "x", description: "", targetId: "x".repeat(65) } }).success).toBe(false)
})

test("运行环境：默认自动；只能指定一个合适的 Java，指定的不合适就说为什么；换回自动", async () => {
  const { service, asked } = await setup()
  const auto = await service.detectJava({ major: 21 })
  expect(auto).toMatchObject({ mode: "auto", chosen: null, using: null })
  expect(auto.found.map((value) => value.home)).toEqual(["/opt/jdk-17"])
  // Nothing fits: the first build installs Studio's own, so the card says so rather than 「已就绪」.
  expect((await service.environment()).javaConfigured).toBe(false)

  await expect(service.chooseJava({ home: "/opt/jdk-17", major: 21 })).rejects.toThrow(SETUP_WORDS.javaUnfit("这是 Java 17，这个版本的游戏要 Java 21。"))
  await expect(service.chooseJava({ home: "/nowhere", major: 21 })).rejects.toThrow(SETUP_WORDS.javaMissing)
  expect((await service.getSettings()).javaHome).toBeNull()

  const chosen = await service.chooseJava({ home: "/opt/jdk-21", major: 21 })
  expect(chosen).toMatchObject({ mode: "chosen", chosen: "/opt/jdk-21", using: { home: "/opt/jdk-21", fits: true } })
  expect((await service.getSettings()).javaHome).toBe("/opt/jdk-21")
  expect((await service.environment()).javaConfigured).toBe(true)
  // What was just found is kept: the environment check asked nothing again.
  const counted = asked.length
  await service.detectJava({ major: 21 })
  expect(asked.length).toBe(counted)

  const back = await service.chooseJava({ home: null, major: 21 })
  expect(back).toMatchObject({ mode: "auto", chosen: null, using: null })
  expect(asked.at(-1)?.chosen).toBeNull()
})

test("运行环境：装 Java 之前说清楚下载多大、装到哪、那个盘还剩多少；没选过的位置不收", async () => {
  const { service, options } = await setup({
    installSource: (major: number) => (major === 21 ? { vendor: "Eclipse Temurin", version: "21.0.8+9", url: "https://example.invalid/temurin.zip", sha256: "a".repeat(64) } : null),
    downloadSize: async () => 195_000_000,
  })
  const plan = await service.planJavaInstall({ major: 21 })
  expect(plan).toMatchObject({ vendor: "Eclipse Temurin", version: "21.0.8+9", url: "https://example.invalid/temurin.zip", downloadBytes: 195_000_000, directory: options.runtimeDirectory, defaultDirectory: options.runtimeDirectory })
  expect(Object.keys(plan).sort()).toEqual(["defaultDirectory", "directory", "downloadBytes", "freeBytes", "problem", "url", "vendor", "version"])
  expect(plan.freeBytes === null || plan.freeBytes > 0).toBe(true)
  // A folder the window names without the person having picked it in the chooser is refused.
  const elsewhere = path.join(path.dirname(options.runtimeDirectory), "elsewhere")
  await expect(service.planJavaInstall({ major: 21, directory: elsewhere })).rejects.toThrow(SETUP_WORDS.unpicked)
  await expect(service.installJava({ major: 21, directory: elsewhere })).rejects.toThrow(SETUP_WORDS.unpicked)
  // Picked in the chooser (the main process registers it): planned there.
  expect((await service.registerJavaDirectory({ major: 21, directory: elsewhere })).directory).toBe(elsewhere)
  expect((await service.planJavaInstall({ major: 21, directory: elsewhere })).directory).toBe(elsewhere)
  await expect(service.planJavaInstall({ major: 17 })).rejects.toThrow(SETUP_WORDS.noInstall(17))
})

test("运行环境：一键安装在后台跑，装到选的位置并记住，装完说装了多大", async () => {
  const installed: { runtime: string; javaDirectory?: string }[] = []
  const { service, options } = await setup({
    installSource: () => ({ vendor: "Eclipse Temurin", version: "21.0.8+9", url: "https://example.invalid/temurin.zip", sha256: "a".repeat(64) }),
    downloadSize: async () => null,
    install: async (runtime: string, input: { javaDirectory?: string } = {}) => {
      installed.push({ runtime, javaDirectory: input.javaDirectory })
      const home = path.join(input.javaDirectory ?? runtime, "java-21")
      await mkdir(path.join(home, "bin"), { recursive: true })
      await writeFile(path.join(home, "bin", "java"), Buffer.alloc(3 * 1024 * 1024))
      return home
    },
  })
  const target = path.join(path.dirname(options.runtimeDirectory), "D盘", "Java")
  await mkdir(target, { recursive: true })
  await service.registerJavaDirectory({ major: 21, directory: target })
  const started = await service.installJava({ major: 21, directory: target })
  const deadline = Date.now() + 10_000
  let task = service.library.getLibraryTask(started.id)
  while (["running", "canceling"].includes(task.state) && Date.now() < deadline) {
    await Bun.sleep(20)
    task = service.library.getLibraryTask(started.id)
  }
  expect(task.error).toBeNull()
  expect(task.state).toBe("completed")
  expect(installed).toEqual([{ runtime: options.runtimeDirectory, javaDirectory: target }])
  expect(task.detail).toBe(SETUP_WORDS.installed("Eclipse Temurin", "21.0.8+9", path.join(target, "java-21"), 3 * 1024 * 1024))
  expect(task.detail).toContain("占用 3 MB")
  expect((await service.getSettings()).javaInstallDirectory).toBe(target)
  // From now on that folder is where Studio's own JDK is looked for, and installs go there unless the person says otherwise.
  expect((await service.planJavaInstall({ major: 21 })).directory).toBe(target)
})

test("设置：Java 和它的安装位置只由运行环境改，保存个人设置时原样留着；旧的设置文件读成「自动」", async () => {
  const { service, options } = await setup()
  await writeFile(path.join(options.workspaceDirectory, "studio-settings.json"), JSON.stringify({ nickname: "小明", projectsDirectory: "" }))
  const old = await service.getSettings()
  expect([old.javaHome, old.javaInstallDirectory]).toEqual([null, null])
  await service.chooseJava({ home: "/opt/jdk-21", major: 21 })
  const saved = await service.saveSettings({ ...old, nickname: "小红", javaHome: "/tmp/evil", javaInstallDirectory: "/tmp/evil" })
  expect(saved).toMatchObject({ nickname: "小红", javaHome: "/opt/jdk-21", javaInstallDirectory: null })
  const stored = SettingsSchema.parse(JSON.parse(await readFile(path.join(options.workspaceDirectory, "studio-settings.json"), "utf8")))
  expect([stored.javaHome, stored.javaInstallDirectory]).toEqual(["/opt/jdk-21", null])
  // A caller written before 运行环境 leaves both out, as the window's own save does.
  const { javaHome: _home, javaInstallDirectory: _directory, ...before } = saved
  expect(StudioRequestSchema.safeParse({ method: "saveSettings", input: before }).success).toBe(true)
})

test("预装模组：从电脑选的 jar 只凭选的时候给的凭据加，用过就失效；移除只认文件名", async () => {
  const { service, root } = await setup()
  const created = await service.createProject({ name: "带前置的", description: "", empty: true })
  const projectId = created.project.id
  const jar = path.join(root, "选的.jar")
  await writeFile(jar, Buffer.from(zipSync({ "fabric.mod.json": new TextEncoder().encode(JSON.stringify({ id: "picked", name: "选的模组", version: "2.0" })) })))
  const token = randomUUID()
  // Only the main process registers picks; the window cannot send a path of its own.
  expect(StudioRequestSchema.safeParse({ method: "registerModFiles", input: { files: [{ token, filename: jar }] } }).success).toBe(false)
  expect(WorkerRequestSchema.safeParse({ method: "registerModFiles", input: { files: [{ token, filename: jar }] } }).success).toBe(true)
  expect(await dispatchStudioRequest(service, { method: "registerModFiles", input: { files: [{ token, filename: jar }] } })).toEqual([{ token, name: "选的.jar" }])
  const added = await service.addModFiles({ projectId, tokens: [token] })
  expect(added).toEqual({ added: [{ file: "选的.jar", id: "picked", name: "选的模组", version: "2.0", from: "file", required: false }], skipped: [] })
  await expect(service.addModFiles({ projectId, tokens: [token] })).rejects.toThrow(SETUP_WORDS.filesGone)
  await expect(service.addModFiles({ projectId, tokens: [randomUUID()] })).rejects.toThrow(SETUP_WORDS.filesGone)
  const listed = await service.listPreinstalledMods({ projectId })
  expect(listed).toEqual({ mods: added.added, folder: path.join(created.directory, "test-scene-mods") })

  for (const file of ["../选的.jar", "sub/选的.jar", "C:\\x\\选的.jar", "选的.zip", ".minemods-mods.json"])
    expect(StudioRequestSchema.safeParse({ method: "removePreinstalledMod", input: { projectId, file } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "removePreinstalledMod", input: { projectId, file: "选的.jar" } }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "addModrinthMod", input: { projectId, modrinthId: "../../x" } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "searchMods", input: { query: "x".repeat(101), targetId: DEFAULT_TARGET } }).success).toBe(false)
  expect(await service.removePreinstalledMod({ projectId, file: "选的.jar" })).toEqual({ mods: [] })
  // Refusals and Modrinth failures are said in plain words.
  expect(publicError(new Error("MODRINTH_UNREACHABLE"))).toBe("连不上 Modrinth（模组库）：检查网络或代理后再试。")
  expect(MOD_WORDS.studio).toContain("Studio 自己会")
})

test("运行环境：一次打包（或检查、试玩）跑完以后，下一次问 Java 是重新找的，不拿打包前半分钟内记下的答案", async () => {
  // An elapsed cache lifetime cannot make the assertion pass.
  const { service, asked } = await setup({ now: () => 0 })
  const created = await service.createProject({ name: "刚装好 Java", description: "" })
  const saved = await service.useExample({ projectId: created.project.id, expectedRevision: created.project.revision })
  await service.detectJava({ major: 21 })
  const counted = asked.length
  // Within the half minute the answer is kept: this is what made the build panel keep saying "no suitable Java" after a build had downloaded one.
  await service.detectJava({ major: 21 })
  expect(asked.length).toBe(counted)
  const { jobId } = await service.buildProject({ projectId: saved.project.id })
  // The build has nothing to build with in this test and fails; what matters is that it has ended.
  await untilObserved(() => service.getJob({ projectId: saved.project.id, jobId }), (job) => !["queued", "running"].includes(job.state))
  await untilObserved(async () => { await service.detectJava({ major: 21 }); return asked.length }, (count) => count > counted)
  expect(asked.length).toBeGreaterThan(counted)
}, 120_000)

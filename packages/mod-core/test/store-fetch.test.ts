import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DownloadError, fetchVerified, HostLimiter, SourceHealth } from "../src/store/fetch"
import { candidates } from "../src/store/sources"

const body = new Uint8Array(200_000).map((_, index) => (index * 7) % 251)
const sha256 = createHash("sha256").update(body).digest("hex")
const sha1 = createHash("sha1").update(body).digest("hex")
const seen: { path: string; range: string | null }[] = []
let server: Server
let base = ""
const directories: string[] = []

// Node's own server, so a reply can really be cut off halfway, as a flaky mirror node does.
beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://local")
    const range = request.headers.range ?? null
    seen.push({ path: url.pathname, range })
    if (!request.headers["user-agent"]?.startsWith("MineModsStudio")) return void response.writeHead(403).end("no agent")
    const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
    if (url.pathname === "/ok" && range) return void response.writeHead(206, { "content-length": body.length - from }).end(body.slice(from))
    if (url.pathname === "/ok" || url.pathname === "/ignores-range") return void response.writeHead(200, { "content-length": body.length }).end(body)
    if (url.pathname === "/wrong") return void response.writeHead(200).end(body.map((value) => value ^ 1))
    if (url.pathname === "/missing") return void response.writeHead(404).end("gone")
    if (url.pathname === "/silent") return void response.writeHead(200, { "content-length": body.length }).flushHeaders()
    if (url.pathname === "/half") {
      response.writeHead(200, { "content-length": body.length })
      // Sends the first part and then nothing more, as a mirror node that hangs halfway did on 2026-11-14.
      response.write(body.slice(0, 80_000))
      return
    }
    response.writeHead(500).end("?")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})
afterEach(async () => {
  seen.length = 0
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const folder = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-store-下载-"))
  directories.push(directory)
  return directory
}
const at = (source: "bmclapi" | "tuna" | "official", route: string) => ({ source, url: `${base}${route}` })

test("镜像在前、官方兜底：镜像给错文件、404、不出声，都换下一个；最后存下的一定是对的哈希", async () => {
  const destination = path.join(await folder(), "lib", "a.jar")
  const health = new SourceHealth()
  const result = await fetchVerified({
    file: { url: `${base}/ok`, sha256, size: body.length },
    destination,
    sources: [at("bmclapi", "/wrong"), at("tuna", "/missing"), at("bmclapi", "/silent"), at("official", "/ok")],
    stallMs: 300,
    health,
  }).catch((error: unknown) => error)
  expect(result).toMatchObject({ source: "official", bytes: body.length })
  expect(createHash("sha256").update(await readFile(destination)).digest("hex")).toBe(sha256)
  expect(await stat(`${destination}.part`).catch(() => null)).toBeNull()
})

test("每个源的失败原因都记下来；全失败时报 DOWNLOAD_FAILED 并列出来", async () => {
  const error = await fetchVerified({
    file: { url: `${base}/ok`, sha1 },
    destination: path.join(await folder(), "b.jar"),
    sources: [at("bmclapi", "/wrong"), at("tuna", "/missing"), at("official", "/silent")],
    stallMs: 300,
    health: new SourceHealth(),
  }).catch((reason: unknown) => reason)
  expect(error).toBeInstanceOf(DownloadError)
  expect((error as DownloadError).failures.map((failure) => [failure.source, failure.reason])).toEqual([
    ["bmclapi", "checksum"],
    ["tuna", "http"],
    ["official", "stalled"],
  ])
})

test("断了接着下：第二个源从断点用 Range 续上；节点不认 Range 给整个文件也照样对", async () => {
  const destination = path.join(await folder(), "c.jar")
  const health = new SourceHealth()
  const resumed = await fetchVerified({ file: { url: `${base}/ok`, sha256 }, destination, sources: [at("bmclapi", "/half"), at("official", "/ok")], health, stallMs: 300 })
  expect(resumed.source).toBe("official")
  expect(seen.find((request) => request.path === "/ok")?.range).toBe("bytes=80000-")
  expect(createHash("sha256").update(await readFile(destination)).digest("hex")).toBe(sha256)

  const second = path.join(path.dirname(destination), "d.jar")
  await writeFile(`${second}.part`, body.slice(0, 50_000))
  const whole = await fetchVerified({ file: { url: `${base}/ignores-range`, sha256 }, destination: second, sources: [at("official", "/ignores-range")], health })
  expect(whole.bytes).toBe(body.length)
  expect(createHash("sha256").update(await readFile(second)).digest("hex")).toBe(sha256)
})

test("已经有对的文件就不再下载；出过错的源一段时间里排到最后", async () => {
  const destination = path.join(await folder(), "e.jar")
  await writeFile(destination, body)
  expect((await fetchVerified({ file: { url: `${base}/ok`, sha256 }, destination, sources: [at("official", "/ok")] })).source).toBe("kept")
  expect(seen).toEqual([])

  let now = 1_000
  const health = new SourceHealth(() => now)
  health.setBack("bmclapi", 60_000)
  const list = [at("bmclapi", "/a"), at("tuna", "/b"), at("official", "/c")]
  expect(health.order(list).map((candidate) => candidate.source)).toEqual(["tuna", "official", "bmclapi"])
  now += 61_000
  expect(health.order(list).map((candidate) => candidate.source)).toEqual(["bmclapi", "tuna", "official"])
  health.setBack("official", 60_000)
  expect(health.order(list).map((candidate) => candidate.source)).toEqual(["bmclapi", "tuna", "official"])
})

test("同一个站点同时最多几个下载", async () => {
  const limiter = new HostLimiter(2)
  let running = 0
  let most = 0
  await Promise.all(
    Array.from({ length: 6 }, () =>
      limiter.run("https://bmclapi2.bangbang93.com/x", async () => {
        running += 1
        most = Math.max(most, running)
        await Bun.sleep(10)
        running -= 1
      }),
    ),
  )
  expect(most).toBe(2)
})

test("改写规则：Mojang、Forge、NeoForge、Fabric 走 BMCLAPI，JDK 走清华，Gradle 走腾讯；官方地址永远在最后", () => {
  expect(candidates("https://piston-data.mojang.com/v1/objects/0c3e/client.jar")).toEqual([
    { source: "bmclapi", url: "https://bmclapi2.bangbang93.com/v1/objects/0c3e/client.jar" },
    { source: "official", url: "https://piston-data.mojang.com/v1/objects/0c3e/client.jar" },
  ])
  expect(candidates("https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.266/x.jar")[0]!.url).toBe("https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/21.1.266/x.jar")
  expect(candidates("https://resources.download.minecraft.net/2b/2b3a")[0]!.url).toBe("https://bmclapi2.bangbang93.com/assets/2b/2b3a")
  expect(candidates("https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21%2B9/OpenJDK17U-jdk_x64_windows_hotspot_17.0.21_9.zip")[0]).toEqual({
    source: "tuna",
    url: "https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/OpenJDK17U-jdk_x64_windows_hotspot_17.0.21_9.zip",
  })
  expect(candidates("https://services.gradle.org/distributions/gradle-8.14.3-bin.zip")[0]!.source).toBe("tencent")
  expect(candidates("https://dl.cloudsmith.io/public/geckolib3/x.jar")).toEqual([{ source: "official", url: "https://dl.cloudsmith.io/public/geckolib3/x.jar" }])
  expect(candidates("https://maven.fabricmc.net/a.jar", { mirrors: false })).toEqual([{ source: "official", url: "https://maven.fabricmc.net/a.jar" }])
})

import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { connect } from "node:net"
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveProfile } from "../src/fabric/profile"
import {
  checkInstallDirectory,
  downloadVerifiedFile,
  ensureJava, ensureJavaMajor, ManagedJavaCacheError,
  javaDownloadSize,
  javaInstallSource,
  runOwnedProcess,
  proxyJvmArgs,
  withRuntimeInstallLock,
} from "../src/runtime"

test.skipIf(process.platform !== "win32" || !process.env.MINEMODS_STUDIO_JAVA_HOME)("a Java install waiting behind cache population reports its turn after acquiring the lease", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-java-turn-"))
  const script = path.join(root, "install-turn.ts")
  try {
    await writeFile(script, [
      `import { cp, mkdir } from "node:fs/promises"`,
      `import { ensureJava, withRuntimeInstallLock, withRuntimeDirectoryLease, RUNTIME_WAIT_LINE, RUNTIME_TURN_LINE } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/runtime.ts"))}`,
      `const root = process.argv[2], source = process.argv[3]`,
      `await mkdir(root, { recursive: true })`,
      `const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()`,
      `const first = withRuntimeInstallLock(root, () => withRuntimeDirectoryLease(root, async () => { entered.resolve(); await release.promise; await cp(source, root + "/java-21", { recursive: true }) }, {}))`,
      `await entered.promise`,
      `const lines: string[] = [], waiting = Promise.withResolvers<void>()`,
      `const second = ensureJava(root, { onProgress: text => { lines.push(text); if (text === RUNTIME_WAIT_LINE) waiting.resolve() } })`,
      `await Promise.race([waiting.promise, second.then(() => { throw new Error("Java did not wait for cache population") })])`,
      `release.resolve(); await first; await second`,
      `console.log(JSON.stringify(lines.filter(text => text === RUNTIME_WAIT_LINE || text === RUNTIME_TURN_LINE)))`,
    ].join("\n"))
    const result = await runOwnedProcess(process.execPath, [script, path.join(root, "cache"), process.env.MINEMODS_STUDIO_JAVA_HOME!], {
      env: { ...process.env, JAVA_HOME: "" },
      timeoutMs: 60000,
    })
    expect(result.code).toBe(0)
    const { RUNTIME_WAIT_LINE, RUNTIME_TURN_LINE } = await import("../src/runtime")
    expect(JSON.parse(result.output.trim())).toEqual([RUNTIME_WAIT_LINE, RUNTIME_TURN_LINE])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("owned processes run without a shell and redact bounded progress", async () => {
  const messages: string[] = []
  const result = await runOwnedProcess(
    process.execPath,
    ["-e", 'console.log("Bearer private-service-token sk-private-key");'],
    { onProgress: (text) => messages.push(text) },
  )
  expect(result.code).toBe(0)
  expect(messages.join("")).toContain("[redacted]")
  expect(messages.join("")).not.toContain("private-service-token")
  expect(messages.join("")).not.toContain("sk-private")
})

test("already-cancelled child work never starts", async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(runOwnedProcess("must-not-exist", [], { signal: controller.signal })).rejects.toThrow("CANCELLED")
})

test("timeout and cancellation terminate only the spawned process", async () => {
  await expect(
    runOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 60 }),
  ).rejects.toThrow("PROCESS_TIMEOUT")
  const controller = new AbortController()
  const processResult = runOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 60)
  await expect(processResult).rejects.toThrow("CANCELLED")
})

test("proxy arguments come from parsed trusted environment, never hardcoded or credential-bearing", () => {
  expect(proxyJvmArgs({ HTTPS_PROXY: "http://127.0.0.1:4567" })).toEqual([
    "-Dhttp.proxyHost=127.0.0.1",
    "-Dhttp.proxyPort=4567",
    "-Dhttps.proxyHost=127.0.0.1",
    "-Dhttps.proxyPort=4567",
  ])
  expect(proxyJvmArgs({})).toEqual([])
  expect(() => proxyJvmArgs({ HTTPS_PROXY: "http://user:secret@proxy:7890" })).toThrow(
    "UNSUPPORTED_PROXY_CONFIGURATION",
  )
})

test("runtime install queue serializes shared cache work and cancelled waiters never install", async () => {
  const events: string[] = []
  const controller = new AbortController()
  const first = withRuntimeInstallLock("runtime-fixture", async () => {
    events.push("first-start")
    await Bun.sleep(30)
    events.push("first-end")
    return "first"
  })
  const cancelled = withRuntimeInstallLock(
    "runtime-fixture",
    async () => {
      events.push("cancelled-install")
    },
    controller.signal,
  )
  const second = withRuntimeInstallLock("runtime-fixture", async () => {
    events.push("second")
    return "second"
  })
  controller.abort()
  await expect(cancelled).rejects.toThrow("CANCELLED")
  expect(await Promise.all([first, second])).toEqual(["first", "second"])
  expect(events).toEqual(["first-start", "first-end", "second"])
})

test("verified downloads use a real explicit proxy and reject corrupt bytes without overwriting files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-proxy-download-"))
  const bytes = Buffer.from("Actual protocol fixture download bytes")
  const origin = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(bytes) })
  const connections: string[] = []
  const proxy = createServer()
  proxy.on("connect", (request, socket, head) => {
    connections.push(request.url ?? "")
    const target = new URL(`http://${request.url}`)
    const remote = connect(Number(target.port), target.hostname, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length) remote.write(head)
      socket.pipe(remote)
      remote.pipe(socket)
    })
    remote.on("error", () => socket.destroy())
    socket.on("error", () => remote.destroy())
  })
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
  const address = proxy.address()
  if (!address || typeof address === "string") throw new Error("Expected TCP proxy")
  const input = {
    url: origin.url.toString(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    proxyUrl: `http://127.0.0.1:${address.port}`,
    destination: path.join(directory, "archive.zip"),
  }
  try {
    await downloadVerifiedFile(input)
    expect(await readFile(input.destination)).toEqual(bytes)
    expect(connections).toEqual([`${origin.hostname}:${origin.port}`])
    await expect(downloadVerifiedFile(input)).rejects.toThrow()
    expect(await readFile(input.destination)).toEqual(bytes)
    await expect(
      downloadVerifiedFile({ ...input, destination: path.join(directory, "bad.zip"), sha256: "0".repeat(64) }),
    ).rejects.toThrow("DOWNLOAD_CHECKSUM_MISMATCH")
  } finally {
    origin.stop(true)
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})

/** A stand-in JDK 21 whose `java -version` answers like the real one; only for the platforms a shell script runs on. */
async function fakeJava21(home: string) {
  await mkdir(path.join(home, "bin"), { recursive: true })
  await writeFile(path.join(home, "bin", "java"), `#!/bin/sh\necho 'openjdk version "21.0.5" 2024-10-15 LTS' 1>&2\n`)
  await chmod(path.join(home, "bin", "java"), 0o755)
  await writeFile(path.join(home, "bin", "javac"), "")
  await writeFile(path.join(home, "bin", "jar"), "")
}

test.skipIf(process.platform === "win32")("Studio 自己装的 Java 在人选的安装位置里找，而不是运行目录", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-java-directory-"))
  const saved = process.env.JAVA_HOME
  delete process.env.JAVA_HOME
  try {
    const runtime = path.join(root, "runtime")
    const chosen = path.join(root, "chosen")
    await fakeJava21(path.join(chosen, "java-21"))
    expect(await ensureJava(runtime, { javaDirectory: chosen })).toBe(await realpath(path.join(chosen, "java-21")))
    // The lease taken for the lookup is the chosen root's, and it is let go afterwards.
    expect(await lstat(path.join(chosen, ".environment.lock")).catch(() => null)).toBeNull()
    await expect(ensureJava(runtime)).rejects.toThrow("EXPLICIT_JAVA_21_REQUIRED_ON_THIS_PLATFORM")
    await symlink(chosen, path.join(root, "linked"), "dir")
    expect(await ensureJava(runtime, { javaDirectory: path.join(root, "linked") })).toBe(await realpath(path.join(chosen, "java-21")))
  } finally {
    if (saved !== undefined) process.env.JAVA_HOME = saved
    await rm(root, { recursive: true, force: true })
  }
})

test("一键安装的来源只在 Studio 钉好下载的那个系统和版本上有", () => {
  const java = resolveProfile("fabric-1.21.1").java
  expect(javaInstallSource(21, { platform: "win32", arch: "x64" })).toEqual({
    vendor: "Eclipse Temurin",
    version: java.version,
    url: java.downloads["windows-x64"].url,
    sha256: java.downloads["windows-x64"].sha256,
  })
  expect(javaInstallSource(17, { platform: "win32", arch: "x64" })).toBeNull()
  expect(javaInstallSource(21, { platform: "linux", arch: "x64" })).toBeNull()
  expect(javaInstallSource(21, { platform: "win32", arch: "arm64" })).toBeNull()
})

test("问不到下载大小时给 null，不编一个数", async () => {
  expect(await javaDownloadSize({ url: "not a url" })).toBeNull()
  expect(await javaDownloadSize({ url: "file:///etc/passwd" })).toBeNull()
  expect(await javaDownloadSize({ url: "https://example.test/jdk.zip", proxyUrl: "http://user:secret@proxy:7890" })).toBeNull()
})

test("安装位置：空间够、能写入就行；链接、文件、空间不够都说明原因", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-install-directory-"))
  try {
    expect(await checkInstallDirectory(root, 200 * 1024 * 1024)).toBeNull()
    expect(await checkInstallDirectory(path.join(root, "not", "made", "yet"), null)).toBeNull()
    expect(await checkInstallDirectory("relative/place", null)).toBe("这不是一个完整的文件夹位置，请重新选一个文件夹。")
    await mkdir(path.join(root, "real"))
    await symlink(path.join(root, "real"), path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir")
    expect(await checkInstallDirectory(path.join(root, "linked"), null)).toBe(
      "这个位置是指向别处的链接，Studio 不往链接里装 Java，请换一个普通文件夹。",
    )
    await mkdir(path.join(root, "holder"))
    await symlink(path.join(root, "real"), path.join(root, "holder", "java-21"), process.platform === "win32" ? "junction" : "dir")
    expect(await checkInstallDirectory(path.join(root, "holder"), null)).toBe(
      "这个位置是指向别处的链接，Studio 不往链接里装 Java，请换一个普通文件夹。",
    )
    await writeFile(path.join(root, "file"), "x")
    expect(await checkInstallDirectory(path.join(root, "file"), null)).toBe("这里是一个文件，不是文件夹，请换一个文件夹。")
    expect(await checkInstallDirectory(root, 2 ** 52)).toStartWith("这个盘只剩 ")
    expect((await import("node:fs/promises").then((fs) => fs.readdir(root))).filter((name) => name.endsWith(".tmp"))).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.skipIf(process.platform !== "win32" || !process.env.MINEMODS_JDK17)("Java 缓存联接可读完整 JDK，缺文件时带回真实目标", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-java-junction-"))
  const home = path.join(root, "java-17")
  const complete = await realpath(process.env.MINEMODS_JDK17!)
  const incomplete = path.join(root, "incomplete_JDK")
  const invalidRuntime = path.join(root, "invalid")
  const invalidHome = path.join(invalidRuntime, "java-17")
  try {
    await symlink(complete, home, "junction")
    expect(await ensureJavaMajor(root, 17, { javaHome: home })).toBe(complete)
    await mkdir(invalidRuntime)
    await mkdir(incomplete)
    await symlink(incomplete, invalidHome, "junction")
    const error = await ensureJavaMajor(invalidRuntime, 17, { javaHome: invalidHome }).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(ManagedJavaCacheError)
    expect((error as ManagedJavaCacheError).detail).toContain(incomplete)
    expect((error as ManagedJavaCacheError).detail).toContain("目录联接")
    expect(await realpath(invalidHome)).toBe(await realpath(incomplete))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

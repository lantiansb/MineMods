import { expect, test } from "bun:test"
import { createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"
import yazl from "yazl"
import { RuntimeDirectoryError, runOwnedProcess, withRuntimeDirectoryLease } from "../src/runtime"
import { compileReverseSources, decompileArchive, prepareReverseTools, VineflowerTool } from "../src/reverse-tools"

async function writeZip(filename: string, entries: Array<{ name: string; bytes: Buffer }>) {
  const zip = new yazl.ZipFile()
  entries.forEach((entry) => zip.addBuffer(entry.bytes, entry.name))
  const written = pipeline(zip.outputStream, createWriteStream(filename))
  zip.end()
  await written
}

test("Vineflower downloads are pinned and its output recompiles as ordinary Java source", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods reverse tools-"))
  const runtimeDirectory = path.join(directory, "runtime")
  const fixture = path.join(directory, "fixture")
  const sources = path.join(fixture, "src")
  const librarySources = path.join(fixture, "library-src")
  const classes = path.join(fixture, "classes")
  const libraryClasses = path.join(fixture, "library-classes")
  const decompiled = path.join(fixture, "sourcefiles")
  const recompiled = path.join(fixture, "recompiled")
  const jarFixture = process.env.MINEMODS_TEST_VINEFLOWER_JAR
  const requests: string[] = []
  const mirror = jarFixture ? Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const pathname = new URL(request.url).pathname
      requests.push(pathname)
      return pathname === new URL(VineflowerTool.url).pathname ? new Response(Bun.file(jarFixture)) : new Response(null, { status: 404 })
    },
  }) : undefined
  try {
    expect(VineflowerTool).toEqual({
      id: "vineflower",
      version: "1.12.0",
      sha256: "1dfcfe974395734fa467ce620661c7623d05ba83670de0529b1fbd63ff548b9d",
      url: "https://repo.maven.apache.org/maven2/org/vineflower/vineflower/1.12.0/vineflower-1.12.0.jar",
    })
    await Promise.all([
      mkdir(sources, { recursive: true }),
      mkdir(librarySources, { recursive: true }),
      mkdir(classes, { recursive: true }),
      mkdir(libraryClasses, { recursive: true }),
    ])
    const javaSource = path.join(sources, "fixture", "Hello.java")
    const dependencySource = path.join(librarySources, "library", "Greeting.java")
    await mkdir(path.dirname(javaSource), { recursive: true })
    await mkdir(path.dirname(dependencySource), { recursive: true })
    await writeFile(
      dependencySource,
      'package library; public final class Greeting { public String text() { return "hello"; } }\n',
    )
    await writeFile(
      javaSource,
      "package fixture; import library.Greeting; public final class Hello { public String greet() { return new Greeting().text(); } }\n",
    )
    const tools = await prepareReverseTools({ runtimeDirectory, downloadMirror: mirror?.url })
    if (mirror) expect(requests).toEqual([new URL(VineflowerTool.url).pathname])
    const libraryCompiled = await runOwnedProcess(tools.javacExecutable, [
      "-encoding",
      "UTF-8",
      "--release",
      "17",
      "-d",
      libraryClasses,
      dependencySource,
    ])
    expect(libraryCompiled.code).toBe(0)
    const libraryJar = path.join(fixture, "fixture library.jar")
    await writeZip(libraryJar, [
      { name: "library/Greeting.class", bytes: await readFile(path.join(libraryClasses, "library", "Greeting.class")) },
    ])
    const compiled = await runOwnedProcess(tools.javacExecutable, [
      "-encoding",
      "UTF-8",
      "--release",
      "17",
      "-classpath",
      libraryJar,
      "-d",
      classes,
      javaSource,
    ])
    expect(compiled.code).toBe(0)
    const fixtureJar = path.join(fixture, "fixture.jar")
    await writeZip(fixtureJar, [
      { name: "fixture/Hello.class", bytes: await readFile(path.join(classes, "fixture", "Hello.class")) },
    ])
    const result = await decompileArchive({
      jar: fixtureJar,
      outputDirectory: decompiled,
      tools,
      classpath: [libraryJar],
    })
    expect(result).toMatchObject({ exitCode: 0, timedOut: false })
    expect(await Bun.file(path.join(decompiled, "fixture", "Hello.java")).exists()).toBe(true)
    const recompiledResult = await compileReverseSources({
      sourceDirectory: decompiled,
      outputDirectory: recompiled,
      classpath: [libraryJar],
      tools,
      release: 17,
    })
    expect(recompiledResult).toMatchObject({ exitCode: 0, timedOut: false })
    expect(await Bun.file(path.join(recompiled, "fixture", "Hello.class")).exists()).toBe(true)
    expect(
      JSON.parse(
        await readFile(path.join(runtimeDirectory, "reverse-tools", tools.tool.version, "receipt.json"), "utf8"),
      ),
    ).toMatchObject({
      version: tools.tool.version,
      sourceUrl: tools.tool.url,
      sha256: tools.tool.sha256,
    })

    // Keep the verified JAR, but force both processes past the cache fast path.
    await rm(path.join(runtimeDirectory, "reverse-tools", tools.tool.version, "receipt.json"))
    const locked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const lease = withRuntimeDirectoryLease(runtimeDirectory, () => {
      locked.resolve()
      return release.promise
    })
    const moduleUrl = new URL("../src/reverse-tools.ts", import.meta.url).href
    const prepareInProcess = () => {
      const waiting = Promise.withResolvers<void>()
      const finished = runOwnedProcess(process.execPath, [
        "-e",
        `import(${JSON.stringify(moduleUrl)}).then(({ prepareReverseTools }) => prepareReverseTools({ runtimeDirectory: ${JSON.stringify(runtimeDirectory)}, onLeaseWait: () => console.log("lease waiting") })).catch((error) => { console.error(error.message); process.exitCode = 1 })`,
      ], { onProgress: (text) => { if (text.includes("lease waiting")) waiting.resolve() } })
      return { finished, waiting: Promise.race([waiting.promise, finished.then((result) => {
        throw new Error(`No lease wait observed: ${JSON.stringify(result)}`)
      })]) }
    }
    await Promise.race([locked.promise, lease])
    const children = [prepareInProcess(), prepareInProcess()]
    try {
      await Promise.all(children.map((child) => child.waiting))
    } finally {
      release.resolve()
      await Promise.allSettled([lease, ...children.map((child) => child.finished)])
    }
    expect(await Promise.all(children.map((child) => child.finished))).toEqual([expect.objectContaining({ code: 0 }), expect.objectContaining({ code: 0 })])

    const unsafeJar = path.join(fixture, "unsafe.jar")
    await writeFile(unsafeJar, zipSync({ "../escape.java": new Uint8Array(Buffer.from("class Escape {}")) }))
    await expect(
      decompileArchive({ jar: unsafeJar, outputDirectory: path.join(fixture, "unsafe-output"), tools }),
    ).rejects.toThrow()
    const aborted = new AbortController()
    aborted.abort()
    await expect(
      decompileArchive({
        jar: fixtureJar,
        outputDirectory: path.join(fixture, "cancelled"),
        tools,
        signal: aborted.signal,
      }),
    ).rejects.toThrow("REVERSE_PROCESS_CANCELLED")
  } finally {
    await mirror?.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
}, 120000)

test("运行时目录是联接：指向不存在的地方时说清是联接、指向哪里，不在它底下建东西", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-reverse-link-"))
  try {
    const gone = path.join(root, "gone")
    await mkdir(gone)
    const linked = path.join(root, "runtime")
    await symlink(gone, linked, process.platform === "win32" ? "junction" : "dir")
    await rm(gone, { recursive: true })
    const refused = await prepareReverseTools({ runtimeDirectory: linked }).then(() => null, (error: unknown) => error)
    expect(refused).toBeInstanceOf(RuntimeDirectoryError)
    expect((refused as RuntimeDirectoryError).detail).toContain(`指向「${gone}」`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

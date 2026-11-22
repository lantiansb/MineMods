import { expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  deleteManagedEnvironment,
  isManagedJavaHome,
  listManagedEnvironment,
  prepareManagedEnvironment,
} from "../src/environment"
import { RuntimeDirectoryError, readRuntimeLeaseOwner, recordManagedEnvironmentUse, withRuntimeDirectoryLease } from "../src/runtime"

const directory = () => mkdtemp(path.join(os.tmpdir(), "minemods-environment-"))

test("lists verified reverse tool installation receipts and removes only its managed cache", async () => {
  const root = await directory()
  const tool = path.join(root, "reverse-tools", "1.12.0")
  await mkdir(tool, { recursive: true })
  await writeFile(
    path.join(tool, "receipt.json"),
    JSON.stringify({
      version: "1.12.0",
      sourceUrl: "https://repo.maven.apache.org/maven2/org/vineflower/vineflower/1.12.0/vineflower-1.12.0.jar",
      sha256: "1".repeat(64),
      installedAt: "2026-10-02T00:00:00.000Z",
    }),
  )
  await writeFile(path.join(tool, "vineflower.jar"), "fixture")
  await writeFile(path.join(root, "connection.json"), "keep")
  try {
    const installed = (await listManagedEnvironment({ runtimeDirectory: root })).items.find(
      (item) => item.id === "reverse-tools",
    )
    expect(installed).toMatchObject({
      type: "reverse-tools",
      version: "1.12.0",
      distribution: "Vineflower",
      canDelete: true,
      sourceSha256: "1".repeat(64),
    })
    await expect(
      deleteManagedEnvironment({ runtimeDirectory: root, id: "reverse-tools", inUse: ["reverse-tools"] }),
    ).rejects.toThrow("ENVIRONMENT_IN_USE")
    expect(await deleteManagedEnvironment({ runtimeDirectory: root, id: "reverse-tools" })).toMatchObject({
      deleted: true,
    })
    expect(await Bun.file(path.join(root, "connection.json")).text()).toBe("keep")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("lists managed entries by real byte size and labels external Java as read-only", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  const external = path.join(root, "external-java")
  await mkdir(path.join(runtime, "java-21"), { recursive: true })
  await mkdir(path.join(runtime, "gradle-home"), { recursive: true })
  await mkdir(path.join(runtime, "java-download-12345678-1234-1234-1234-123456789abc"), { recursive: true })
  await mkdir(external)
  await writeFile(path.join(runtime, "java-21", "bin-file"), "java")
  await writeFile(path.join(runtime, "gradle-home", "cache"), "12345")
  await writeFile(path.join(runtime, "java-download-12345678-1234-1234-1234-123456789abc", "partial"), "xx")
  await writeFile(path.join(external, "release"), "external")
  try {
    const result = await listManagedEnvironment({
      runtimeDirectory: runtime,
      externalJavaHome: external,
      projectReferences: [{ projectId: "project-a", environmentIds: ["java-21"] }],
      inUse: ["gradle-home"],
    })
    expect(result.items.find((item) => item.id === "java-21")).toMatchObject({
      bytes: 4,
      canDelete: true,
      referencedBy: [{ projectId: "project-a", projectName: null }],
      version: null,
      targetVersion: "21.0.12.1+1",
      distribution: null,
      sourceUrl: null,
      lastUsedAt: null,
    })
    expect(result.items.find((item) => item.id === "gradle-home")).toMatchObject({
      bytes: 5,
      canDelete: false,
      inUse: true,
      version: null,
      targetVersion: "8.8",
    })
    expect(result.items.find((item) => item.id.startsWith("java-download-"))).toMatchObject({
      bytes: 2,
      status: "incomplete",
      lastUsedAt: null,
    })
    expect(result.items.find((item) => item.id === "external-java")).toMatchObject({
      canDelete: false,
      bytes: 8,
      version: null,
      targetVersion: null,
      distribution: null,
      sourceUrl: null,
      referencedBy: [],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("requires confirmation for referenced caches and removes only the managed item", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  await mkdir(path.join(runtime, "java-21"), { recursive: true })
  await writeFile(path.join(runtime, "java-21", "release"), "x")
  await writeFile(path.join(runtime, "connection.json"), "keep")
  const projectReferences = [{ projectId: "project-a", environmentIds: ["java-21"] }]
  try {
    expect(await deleteManagedEnvironment({ runtimeDirectory: runtime, id: "java-21", projectReferences })).toEqual({
      deleted: false,
      confirmationRequired: true,
      impactedProjects: [{ projectId: "project-a", projectName: null }],
    })
    await expect(
      deleteManagedEnvironment({
        runtimeDirectory: runtime,
        id: "java-21",
        projectReferences,
        inUse: ["java-21"],
        confirmReferenced: true,
      }),
    ).rejects.toThrow("ENVIRONMENT_IN_USE")
    expect(
      await deleteManagedEnvironment({
        runtimeDirectory: runtime,
        id: "java-21",
        projectReferences,
        confirmReferenced: true,
      }),
    ).toMatchObject({ deleted: true, impactedProjects: [{ projectId: "project-a", projectName: null }] })
    expect(await Bun.file(path.join(runtime, "connection.json")).text()).toBe("keep")
    await expect(
      deleteManagedEnvironment({ runtimeDirectory: runtime, id: "../connection.json", confirmReferenced: true }),
    ).rejects.toThrow("UNSUPPORTED_ENVIRONMENT_ITEM")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("refuses symlinks and junction-like managed entries without following them", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  const outside = path.join(root, "outside")
  await mkdir(runtime)
  await mkdir(outside)
  await writeFile(path.join(outside, "precious"), "keep")
  await symlink(outside, path.join(runtime, "java-21"), process.platform === "win32" ? "junction" : "dir")
  try {
    expect(
      (await listManagedEnvironment({ runtimeDirectory: runtime })).items.find((item) => item.id === "java-21"),
    ).toMatchObject({ status: "unsafe", canDelete: false })
    await expect(
      deleteManagedEnvironment({ runtimeDirectory: runtime, id: "java-21", confirmReferenced: true }),
    ).rejects.toThrow("UNSAFE_ENVIRONMENT_ITEM")
    expect(await Bun.file(path.join(outside, "precious")).text()).toBe("keep")
    await expect(listManagedEnvironment({ runtimeDirectory: path.join(root, "linked-root") })).resolves.toBeDefined()
    // r29: a runtime directory that is itself a junction to a folder is that folder (moved to another drive); the link inside it is still refused, and deleting it still does not follow it.
    await symlink(runtime, path.join(root, "linked-root"), process.platform === "win32" ? "junction" : "dir")
    expect(
      (await listManagedEnvironment({ runtimeDirectory: path.join(root, "linked-root") })).items.find((item) => item.id === "java-21"),
    ).toMatchObject({ status: "unsafe", canDelete: false })
    await expect(
      deleteManagedEnvironment({ runtimeDirectory: path.join(root, "linked-root"), id: "java-21", confirmReferenced: true }),
    ).rejects.toThrow("UNSAFE_ENVIRONMENT_ITEM")
    expect(await Bun.file(path.join(outside, "precious")).text()).toBe("keep")
    // A junction to nothing: said as a junction, with where it points.
    const gone = path.join(root, "gone")
    await mkdir(gone)
    await symlink(gone, path.join(root, "dangling-root"), process.platform === "win32" ? "junction" : "dir")
    await rm(gone, { recursive: true })
    const refused = await listManagedEnvironment({ runtimeDirectory: path.join(root, "dangling-root") }).then(() => null, (error: unknown) => error)
    expect(refused).toBeInstanceOf(RuntimeDirectoryError)
    expect((refused as RuntimeDirectoryError).message).toBe("UNSAFE_RUNTIME_DIRECTORY")
    expect((refused as RuntimeDirectoryError).detail).toContain("是一个联接，指向「")
    expect((refused as RuntimeDirectoryError).detail).toContain(gone)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("reports unsupported environments and prepares only the existing Fabric profile", async () => {
  const root = await directory()
  try {
    await expect(prepareManagedEnvironment({ runtimeDirectory: root, profileId: "forge-1.21.1" })).rejects.toThrow(
      "UNSUPPORTED_ENVIRONMENT_PROFILE",
    )
    expect((await listManagedEnvironment({ runtimeDirectory: root })).supportedProfiles).toEqual(["fabric-1.21.1"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("does not classify an external JDK as managed when the runtime directory does not exist", () => {
  expect(isManagedJavaHome(undefined, path.join(os.tmpdir(), "external-jdk"))).toBe(false)
  expect(isManagedJavaHome(path.join(os.tmpdir(), "runtime"), path.join(os.tmpdir(), "runtime", "java-21"))).toBe(true)
})

test("runtime lease blocks cache deletion across concurrent operations", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  await mkdir(path.join(runtime, "java-21"), { recursive: true })
  await writeFile(path.join(runtime, "java-21", "release"), "x")
  await mkdir(path.join(runtime, ".environment.lock"))
  await writeFile(
    path.join(runtime, ".environment.lock", "owner.json"),
    JSON.stringify({ pid: process.pid, nonce: "active" }),
  )
  try {
    await expect(deleteManagedEnvironment({ runtimeDirectory: runtime, id: "java-21" })).rejects.toThrow(
      "ENVIRONMENT_BUSY",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("recovers a lease owned by a process that no longer exists", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  await mkdir(path.join(runtime, "java-21"), { recursive: true })
  await writeFile(path.join(runtime, "java-21", "release"), "x")
  await mkdir(path.join(runtime, ".environment.lock"))
  await writeFile(
    path.join(runtime, ".environment.lock", "owner.json"),
    JSON.stringify({ pid: process.pid + 10000000, nonce: "123e4567-e89b-12d3-a456-426614174000" }),
  )
  try {
    expect(
      (await listManagedEnvironment({ runtimeDirectory: runtime })).items.find((item) => item.id === "java-21"),
    ).toMatchObject({ canDelete: true, inUse: false })
    expect(await deleteManagedEnvironment({ runtimeDirectory: runtime, id: "java-21" })).toMatchObject({
      deleted: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("accepts only positive integer lease owner PIDs with a valid nonce", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  const lock = path.join(runtime, ".environment.lock")
  await mkdir(lock, { recursive: true })
  try {
    await writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: 0, nonce: "123e4567-e89b-12d3-a456-426614174000" }),
    )
    expect(await readRuntimeLeaseOwner(runtime)).toBeNull()
    await writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: -2, nonce: "123e4567-e89b-12d3-a456-426614174000" }),
    )
    expect(await readRuntimeLeaseOwner(runtime)).toBeNull()
    await writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, nonce: "123e4567-e89b-12d3-a456-426614174000" }),
    )
    expect(await readRuntimeLeaseOwner(runtime)).toEqual({
      pid: process.pid,
      nonce: "123e4567-e89b-12d3-a456-426614174000",
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("reads bounded install receipts and records last use only under a managed runtime lease", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  const java = path.join(runtime, "java-21")
  await mkdir(java, { recursive: true })
  await mkdir(path.join(runtime, "gradle-home"), { recursive: true })
  const installedAt = "2026-10-02T12:00:00.000Z"
  await writeFile(
    path.join(java, ".minemods-install.json"),
    JSON.stringify({
      version: "21.0.12.1+1",
      distribution: "temurin",
      sourceUrl: "https://example.test/temurin.zip",
      sha256: "a".repeat(64),
      installedAt,
    }),
  )
  try {
    await expect(recordManagedEnvironmentUse(runtime, ["java-21"])).rejects.toThrow("ENVIRONMENT_LEASE_REQUIRED")
    const lastUsedAt = await withRuntimeDirectoryLease(runtime, async () => {
      const before = new Date().toISOString()
      await recordManagedEnvironmentUse(runtime, ["java-21", "gradle-home"])
      return before
    })
    const listed = await listManagedEnvironment({ runtimeDirectory: runtime })
    expect(listed.items.find((item) => item.id === "java-21")).toMatchObject({
      version: "21.0.12.1+1",
      targetVersion: "21.0.12.1+1",
      distribution: "temurin",
      sourceUrl: "https://example.test/temurin.zip",
      installedAt,
      sourceSha256: "a".repeat(64),
      lastUsedAt: expect.any(String),
    })
    expect(listed.items.find((item) => item.id === "java-21")!.lastUsedAt! >= lastUsedAt).toBe(true)
    expect(listed.items.find((item) => item.id === "gradle-home")!.lastUsedAt).toBeTruthy()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("rejects symlink and malformed provenance records as unknown", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  const java = path.join(runtime, "java-21")
  await mkdir(java, { recursive: true })
  await mkdir(path.join(root, "outside"))
  await writeFile(
    path.join(root, "outside", "receipt.json"),
    JSON.stringify({
      version: "21.0.12.1+1",
      distribution: "temurin",
      sourceUrl: "https://example.test/temurin.zip",
      sha256: "b".repeat(64),
      installedAt: "2026-10-02T12:00:00.000Z",
    }),
  )
  await symlink(
    path.join(root, "outside", "receipt.json"),
    path.join(java, ".minemods-install.json"),
    process.platform === "win32" ? "file" : undefined,
  )
  await symlink(
    path.join(root, "outside", "receipt.json"),
    path.join(runtime, ".environment-usage.json"),
    process.platform === "win32" ? "file" : undefined,
  )
  try {
    const listed = await listManagedEnvironment({ runtimeDirectory: runtime })
    expect(listed.items.find((item) => item.id === "java-21")).toMatchObject({
      status: "unsafe",
      version: null,
      distribution: null,
      sourceUrl: null,
      installedAt: null,
      sourceSha256: null,
      lastUsedAt: null,
    })
    await rm(path.join(java, ".minemods-install.json"))
    await rm(path.join(runtime, ".environment-usage.json"))
    await writeFile(
      path.join(java, ".minemods-install.json"),
      JSON.stringify({
        version: "21.0.12.1+1",
        distribution: "temurin",
        sourceUrl: "javascript:bad",
        sha256: "wrong",
        installedAt: "not-a-date",
      }),
    )
    await writeFile(
      path.join(runtime, ".environment-usage.json"),
      `{"schema_version":1,"last_used_at":${JSON.stringify({ "java-21": "x".repeat(20000) })}}`,
    )
    const invalid = await listManagedEnvironment({ runtimeDirectory: runtime })
    expect(invalid.items.find((item) => item.id === "java-21")).toMatchObject({
      version: null,
      distribution: null,
      sourceUrl: null,
      installedAt: null,
      sourceSha256: null,
      lastUsedAt: null,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test.skipIf(process.platform === "win32")("Studio 自己的 JDK 装在人选的位置时，在那里准备、列出、记使用时间和删除", async () => {
  const root = await directory()
  const runtime = path.join(root, "runtime")
  const chosen = path.join(root, "chosen")
  const saved = process.env.JAVA_HOME
  delete process.env.JAVA_HOME
  try {
    await mkdir(path.join(runtime, "gradle-home"), { recursive: true })
    // A JDK left in the runtime directory from before the person picked a place is not the one in use any more.
    await mkdir(path.join(runtime, "java-21"), { recursive: true })
    await mkdir(path.join(chosen, "java-21", "bin"), { recursive: true })
    await writeFile(
      path.join(chosen, "java-21", "bin", "java"),
      `#!/bin/sh\necho 'openjdk version "21.0.5" 2024-10-15 LTS' 1>&2\n`,
      { mode: 0o755 },
    )
    const prepared = await prepareManagedEnvironment({ runtimeDirectory: runtime, javaDirectory: chosen })
    expect(prepared.java).toMatchObject({ path: await realpath(path.join(chosen, "java-21")), managed: true })
    const listed = await listManagedEnvironment({ runtimeDirectory: runtime, javaDirectory: chosen })
    expect(listed.items.map((item) => [item.id, item.path]).sort()).toEqual([
      ["gradle-home", path.join(await realpath(runtime), "gradle-home")],
      ["java-21", path.join(await realpath(chosen), "java-21")],
    ])
    expect(listed.items.find((item) => item.id === "java-21")!.lastUsedAt).toEqual(expect.any(String))
    expect(
      (await listManagedEnvironment({ runtimeDirectory: runtime })).items.find((item) => item.id === "java-21")!.path,
    ).toBe(path.join(await realpath(runtime), "java-21"))
    expect(await deleteManagedEnvironment({ runtimeDirectory: runtime, javaDirectory: chosen, id: "java-21" })).toMatchObject({
      deleted: true,
    })
    expect(await lstat(path.join(chosen, "java-21")).catch(() => null)).toBeNull()
    expect((await lstat(path.join(runtime, "java-21"))).isDirectory()).toBe(true)
  } finally {
    if (saved !== undefined) process.env.JAVA_HOME = saved
    await rm(root, { recursive: true, force: true })
  }
})

test("a run that waits takes its turn at a held environment, says so once, and can be stopped; one that does not wait is refused", async () => {
  const root = await directory()
  const said: string[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  try {
    const entered = Promise.withResolvers<void>()
    const first = withRuntimeDirectoryLease(root, () => { entered.resolve(); return held })
    await entered.promise
    await expect(withRuntimeDirectoryLease(root, async () => "never")).rejects.toThrow("ENVIRONMENT_BUSY")
    const stopper = new AbortController()
    const waiting = Promise.withResolvers<void>()
    const stopped = withRuntimeDirectoryLease(root, async () => "never", { signal: stopper.signal, onWait: waiting.resolve })
    const second = withRuntimeDirectoryLease(root, async () => "ran", { onWait: () => said.push("wait"), onTurn: () => said.push("turn") })
    await waiting.promise
    stopper.abort()
    await expect(stopped).rejects.toThrow("CANCELLED")
    // Raw callbacks: each lock it waits at says so (here the queue behind the stopped run, then the lock); `waitTurn` says it once per run.
    expect(said.length).toBeGreaterThan(0)
    expect(said.every((word) => word === "wait")).toBe(true)
    release()
    await first
    expect(await second).toBe("ran")
    expect(said.at(-1)).toBe("turn")
    // Nothing waits when nothing holds it.
    const quiet: string[] = []
    expect(await withRuntimeDirectoryLease(root, async () => "free", { onWait: () => quiet.push("wait"), onTurn: () => quiet.push("turn") })).toBe("free")
    expect(quiet).toEqual([])
  } finally {
    release()
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("runs of one Studio that wait for the environment go in the order they came, one stopped while queued lets the rest go on, and each says its wait and its turn once", async () => {
  const { waitTurn, RUNTIME_WAIT_LINE, RUNTIME_TURN_LINE } = await import("../src/runtime")
  const root = await directory()
  const order: string[] = []
  const said: string[] = []
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  try {
    const entered = Promise.withResolvers<void>()
    const first = withRuntimeDirectoryLease(root, () => { entered.resolve(); return held }, {})
    await entered.promise
    const stopper = new AbortController()
    const runs = ["a", "b", "c", "d"].map((name) =>
      withRuntimeDirectoryLease(root, async () => void order.push(name), name === "a" ? waitTurn({ onProgress: (text) => said.push(text) }) : name === "c" ? { signal: stopper.signal } : {}),
    )
    stopper.abort()
    await expect(runs[2]).rejects.toThrow("CANCELLED")
    release()
    await first
    await Promise.all([runs[0], runs[1], runs[3]])
    expect(order).toEqual(["a", "b", "d"])
    expect(said).toEqual([RUNTIME_WAIT_LINE, RUNTIME_TURN_LINE])
  } finally {
    release()
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)

test("leases of two folders are taken in one order whichever is named first, so two runs set the other way round both finish", async () => {
  const { withRuntimeLeases } = await import("../src/runtime")
  const a = await directory()
  const b = await directory()
  try {
    const slow = () => new Promise<string>((resolve) => setTimeout(() => resolve("done"), 30))
    const results = await Promise.race([
      Promise.all([withRuntimeLeases([a, b], {}, slow), withRuntimeLeases([b, a], {}, slow)]),
      new Promise((resolve) => setTimeout(() => resolve("stuck"), 5000)),
    ])
    expect(results).toEqual(["done", "done"])
  } finally {
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})

test("an install into the same place that has to wait for another says it is waiting", async () => {
  const { withRuntimeInstallLock } = await import("../src/runtime")
  const root = await directory()
  const said: string[] = []
  let release!: () => void
  try {
    const entered = Promise.withResolvers<void>()
    const first = withRuntimeInstallLock(root, () => new Promise<void>((resolve) => { release = resolve; entered.resolve() }), undefined, () => said.push("first"))
    const second = withRuntimeInstallLock(root, async () => "second", undefined, () => said.push("second"))
    expect(said).toEqual(["second"])
    await entered.promise
    release()
    await first
    expect(await second).toBe("second")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 120_000)


test("canceling started work retains both leases until its operation has settled", async () => {
  const { withRuntimeLeases } = await import("../src/runtime")
  const a = await directory()
  const b = await directory()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const stopper = new AbortController()
  const finished = { value: false }
  const run = withRuntimeLeases([a, b], { signal: stopper.signal }, async () => {
    started.resolve()
    await release.promise
    finished.value = true
    throw new Error("CANCELLED")
  })
  const outcome = run.catch((error: unknown) => error)
  try {
    await started.promise
    stopper.abort()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(finished.value).toBe(false)
    expect(await readRuntimeLeaseOwner(a)).not.toBeNull()
    expect(await readRuntimeLeaseOwner(b)).not.toBeNull()
    await expect(withRuntimeDirectoryLease(a, async () => "unsafe")).rejects.toThrow("ENVIRONMENT_BUSY")
    await expect(withRuntimeDirectoryLease(b, async () => "unsafe")).rejects.toThrow("ENVIRONMENT_BUSY")
    release.resolve()
    expect(await outcome).toEqual(new Error("CANCELLED"))
    expect(finished.value).toBe(true)
    expect(await readRuntimeLeaseOwner(a)).toBeNull()
    expect(await readRuntimeLeaseOwner(b)).toBeNull()
    expect(await withRuntimeLeases([b, a], {}, async () => "safe")).toBe("safe")
  } finally {
    release.resolve()
    await outcome
    await rm(a, { recursive: true, force: true })
    await rm(b, { recursive: true, force: true })
  }
})

test("Java 17 和 21 各占一个文件夹；Forge 1.20.1 构建时两个都在用，都不能删", async () => {
  const root = await directory()
  try {
    for (const name of ["java-17", "java-21"]) await mkdir(path.join(root, name, "bin"), { recursive: true })
    const listed = await listManagedEnvironment({ runtimeDirectory: root, inUse: ["forge-1.20.1"] })
    const java17 = listed.items.find((item) => item.id === "java-17")!
    expect(java17).toMatchObject({ type: "jdk", targetVersion: "17.0.21+9", inUse: true, canDelete: false })
    expect(listed.items.find((item) => item.id === "java-21")).toMatchObject({ type: "jdk", inUse: true })
    await expect(deleteManagedEnvironment({ runtimeDirectory: root, id: "java-17", inUse: ["forge-1.20.1"] })).rejects.toThrow("ENVIRONMENT_IN_USE")
    // A Fabric 1.21.1 build needs only 21; 17 is free to go.
    const fabric = await listManagedEnvironment({ runtimeDirectory: root, inUse: ["fabric-1.21.1"] })
    expect(fabric.items.find((item) => item.id === "java-17")).toMatchObject({ inUse: false, canDelete: true })
    expect(await deleteManagedEnvironment({ runtimeDirectory: root, id: "java-17", inUse: ["fabric-1.21.1"] })).toMatchObject({ deleted: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("资源清单里的东西也上存储页：有人用的要确认，正在用的不能删，「清理没用的」只清没人用的", async () => {
  const root = await realpath(await directory())
  try {
    const { recordItem } = await import("../src/store/catalog")
    const { cleanUnusedEnvironment } = await import("../src/environment")
    await mkdir(path.join(root, "scene", "fabric-1.21.1", "assets"), { recursive: true })
    await writeFile(path.join(root, "scene", "fabric-1.21.1", "assets", "a"), "123")
    for (const name of ["inst", "old"]) await mkdir(path.join(root, "store", name), { recursive: true })
    const base = { kind: "instance" as const, bytes: 1, source: "kept", sha256: null, installed_at: "2026-11-14T00:00:00.000Z" }
    const project = "00000000-0000-4000-8000-0000000000aa"
    await recordItem(root, { ...base, id: "instance:a", title: "蚩尤 · Forge 1.20.1", path: "store/inst", users: [`project:${project}`, "target:forge-1.20.1"] })
    await recordItem(root, { ...base, id: "loader:old", title: "旧加载器", path: "store/old" })
    const listed = (await listManagedEnvironment({ runtimeDirectory: root, projectReferences: [{ projectId: project, projectName: "蚩尤", environmentIds: [] }] })).items
    expect(listed.find((item) => item.id === "scene:fabric-1.21.1")).toMatchObject({ type: "store", title: "测试场游戏文件（Fabric 1.21.1）", bytes: 3 })
    expect(listed.find((item) => item.id === "instance:a")).toMatchObject({ referencedBy: [{ projectId: project, projectName: "蚩尤" }], inUse: false })
    expect((await listManagedEnvironment({ runtimeDirectory: root, inUse: ["forge-1.20.1"] })).items.find((item) => item.id === "instance:a")).toMatchObject({ inUse: true, canDelete: false })
    await expect(deleteManagedEnvironment({ runtimeDirectory: root, id: "instance:a", inUse: ["forge-1.20.1"] })).rejects.toThrow("ENVIRONMENT_IN_USE")
    expect(await deleteManagedEnvironment({ runtimeDirectory: root, id: "instance:a" })).toMatchObject({ deleted: false, confirmationRequired: true })
    await expect(cleanUnusedEnvironment({ runtimeDirectory: root, inUse: ["fabric-1.21.1"] })).rejects.toThrow("ENVIRONMENT_IN_USE")
    expect(await cleanUnusedEnvironment({ runtimeDirectory: root })).toMatchObject({ removed: ["loader:old"] })
    expect(await deleteManagedEnvironment({ runtimeDirectory: root, id: "instance:a", confirmReferenced: true })).toMatchObject({ deleted: true })
    expect(await lstat(path.join(root, "store", "inst")).catch(() => null)).toBeNull()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("「清理没用的」也清掉升级前就有、没人用的反编译工具；工程还在用的不清", async () => {
  const root = await realpath(await directory())
  try {
    const { cleanUnusedEnvironment } = await import("../src/environment")
    await mkdir(path.join(root, "reverse-tools", "1.12.0"), { recursive: true })
    await writeFile(path.join(root, "reverse-tools", "1.12.0", "vineflower.jar"), "jar")
    const project = "00000000-0000-4000-8000-0000000000bb"
    const kept = await cleanUnusedEnvironment({ runtimeDirectory: root, projectReferences: [{ projectId: project, projectName: "导入", environmentIds: ["reverse-tools"] }] })
    expect(kept.removed).toEqual([])
    expect(await lstat(path.join(root, "reverse-tools"))).toBeTruthy()
    const cleaned = await cleanUnusedEnvironment({ runtimeDirectory: root })
    expect(cleaned.removed).toEqual(["tools:reverse"])
    expect(await lstat(path.join(root, "reverse-tools")).catch(() => null)).toBeNull()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

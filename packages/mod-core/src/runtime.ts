import { spawn } from "node:child_process"
import { constants as osConstants, setPriority } from "node:os"
import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, open, readdir, readFile, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
// Explicit entry bypasses Bun's partial built-in undici shim; Node/Electron use this same installed implementation.
import { Agent, ProxyAgent, request, type Dispatcher } from "undici/index.js"
import { resolveProfile } from "./fabric/profile"
import { fetchVerified } from "./store/fetch"
import { managedJdk } from "./target/jdks"
import { GRADLE_NETWORK, GRADLE_STOOD_STILL, retryGradle, type GradleResult } from "./gradle-network"
import { discardBody } from "./http-body"
import { COUNTER_LABELS, STALL_MS, growthLine } from "./progress-counter"
import { cpuAdvanced, watchWindowsProcessTreeCpu, type ProcessTreeCpu, type ProcessCpuWatch } from "./process-cpu"

export type RuntimeOptions = {
  javaHome?: string
  runtimeDirectory: string
  /** The root the Studio-installed JDK folder lives under when the person picked one in the settings; left out, the runtime directory. */
  javaDirectory?: string
  signal?: AbortSignal
  onProgress?: (text: string) => void
  /** A Gradle task is being run again because a download broke off; `attempt` counts from 1. */
  onRetry?: (attempt: number) => void
  /** How the pause before such a retry is waited out; left unset outside tests. */
  pause?: (ms: number) => Promise<unknown>
  /** The run is Studio getting things ready ahead of need, not something the person is waiting for: its process runs below normal priority, so the computer stays as quick as it was. */
  lowPriority?: boolean
  /** For tests: how long a Gradle run may stand still (default `STALL_MS`) and how often that is looked at (default `GRADLE_WATCH_MS`). */
  stall?: { ms?: number; every?: number }
}

const runtimeInstallations = new Map<string, Promise<unknown>>()

/** The folder name of the JDK Studio installs itself, under the runtime directory or the root the person picked. */
export const MANAGED_JAVA = "java-21" as const

export const JavaInstallationReceiptSchema = z.strictObject({
  version: z.string().min(1).max(80),
  distribution: z.string().min(1).max(80),
  sourceUrl: z.url().max(2048),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  installedAt: z.iso.datetime(),
})

export const EnvironmentUsageSchema = z.strictObject({
  schema_version: z.literal(1),
  last_used_at: z.partialRecord(z.enum(["java-21", "gradle-home"]), z.iso.datetime()),
})

const RuntimeLeaseOwnerSchema = z.strictObject({ pid: z.number().int().positive().safe(), nonce: z.uuid() })

async function readBoundedJson(filename: string, limit = 16384) {
  const info = await lstat(filename).catch(() => undefined)
  if (!info || info.isSymbolicLink() || !info.isFile() || info.size > limit) return undefined
  return readFile(filename, "utf8")
    .then(JSON.parse)
    .catch(() => undefined) as Promise<unknown>
}

export async function readJavaInstallationReceipt(javaDirectory: string) {
  const parsed = JavaInstallationReceiptSchema.safeParse(
    await readBoundedJson(path.join(javaDirectory, ".minemods-install.json"), 4096),
  )
  return parsed.success ? parsed.data : null
}

export async function readEnvironmentUsage(runtimeDirectory: string) {
  const parsed = EnvironmentUsageSchema.safeParse(
    await readBoundedJson(path.join(runtimeDirectory, ".environment-usage.json")),
  )
  return parsed.success ? parsed.data : null
}

export async function readRuntimeLeaseOwner(runtimeDirectory: string) {
  const parsed = RuntimeLeaseOwnerSchema.safeParse(
    await readBoundedJson(path.join(runtimeDirectory, ".environment.lock", "owner.json"), 1024),
  )
  return parsed.success ? parsed.data : null
}

export async function recordManagedEnvironmentUse(runtimeDirectory: string, ids: Array<"java-21" | "gradle-home">) {
  const root = await realpath(runtimeDirectory)
  const owner = await readRuntimeLeaseOwner(root)
  if (owner?.pid !== process.pid) throw new Error("ENVIRONMENT_LEASE_REQUIRED")
  const existing = await readEnvironmentUsage(root)
  const next = EnvironmentUsageSchema.parse({
    schema_version: 1,
    last_used_at: {
      ...(existing?.last_used_at ?? {}),
      ...Object.fromEntries(ids.map((id) => [id, new Date().toISOString()])),
    },
  })
  const destination = path.join(root, ".environment-usage.json")
  const info = await lstat(destination).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (info?.isSymbolicLink() || (info && !info.isFile())) throw new Error("UNSAFE_ENVIRONMENT_USAGE_FILE")
  const temporary = path.join(root, `.environment-usage-${randomUUID()}.tmp`)
  const handle = await open(temporary, "wx", 0o600)
  await handle
    .writeFile(JSON.stringify(next))
    .then(() => handle.sync())
    .finally(() => handle.close())
  await rename(temporary, destination).finally(() => rm(temporary, { force: true }))
  return next
}

/**
 * The line a waiting run prints once, when the runtime environment is held by another build, check or open game of
 * this or another Studio. Said to the person through `BUILD_STAGES`.
 */
export const RUNTIME_WAIT_LINE = "Waiting for the runtime environment: another build, check or open game is using it.\n"
/** Printed once a run that waited gets the environment; a run that never waited prints neither line. */
export const RUNTIME_TURN_LINE = "Runtime environment free, going on.\n"

/** How often a waiting run looks again whether the environment is free. A lease is held for minutes, so a second is prompt enough and costs nothing. */
export const RUNTIME_WAIT_POLL_MS = 1000

/** How a run waits its turn: `onWait` when it starts waiting, `onTurn` when a wait ended and it goes on, `signal` to stop waiting. */
export type RuntimeWait = { signal?: AbortSignal; onWait?: () => void; onTurn?: () => void }

/**
 * Cross-process lease shared by runtime installation and managed-cache deletion.
 *
 * Without `wait`, a held environment is refused at once (`ENVIRONMENT_BUSY`): the right answer for deleting caches.
 * With `wait`, the run takes its turn instead: it says so once through `onWait` and looks again every
 * `RUNTIME_WAIT_POLL_MS` until the environment is free (then `onTurn`) or `signal` stops it (`CANCELLED`). Only taking the lease is
 * retried, never the operation itself.
 */
export async function withRuntimeDirectoryLease<T>(
  runtimeDirectory: string,
  operation: () => Promise<T>,
  wait?: RuntimeWait,
) {
  // Runs of this process that wait take their turns in the order they came: one at a time asks the lock, the rest queue behind it. The
  // queue is joined before anything is awaited, so the order is the order of the calls.
  if (wait) return queuedLease(path.resolve(runtimeDirectory), async (queued) => takeAndHold(await realpath(runtimeDirectory), operation, wait, queued), wait)
  return takeAndHold(await realpath(runtimeDirectory), operation, wait, false)
}

const leaseQueues = new Map<string, Promise<unknown>>()

function queuedLease<T>(folder: string, run: (queued: boolean) => Promise<T>, wait: RuntimeWait): Promise<T> {
  const key = leaseKey(folder)
  const before = leaseQueues.get(key)
  const running = { value: false }
  if (before) wait.onWait?.()
  const result = (before ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      if (wait.signal?.aborted) throw new Error("CANCELLED")
      running.value = true
      return run(!!before)
    })
  leaseQueues.set(key, result)
  const clear = () => {
    if (leaseQueues.get(key) === result) leaseQueues.delete(key)
  }
  void result.then(clear, clear)
  return untilCancelled(result, wait.signal, running)
}

/** Queued callers stop immediately. Started work retains its leases until its operation has actually settled. */
function untilCancelled<T>(work: Promise<T>, signal: AbortSignal | undefined, running: { value: boolean }): Promise<T> {
  if (!signal) return work
  const cancellation = { reject: (_: Error) => {} }
  const cancel = () => {
    if (!running.value) cancellation.reject(new Error("CANCELLED"))
  }
  const aborted = new Promise<never>((_, reject) => {
    cancellation.reject = reject
    signal.addEventListener("abort", cancel, { once: true })
  })
  if (signal.aborted) cancel()
  return Promise.race([work, aborted]).finally(() => signal.removeEventListener("abort", cancel))
}

/** `queued`: the run already waited behind another of this Studio, so getting the lock is its turn even when the lock was free. */
async function takeAndHold<T>(root: string, operation: () => Promise<T>, wait: RuntimeWait | undefined, queued: boolean) {
  const lock = path.join(root, ".environment.lock")
  const owner = { pid: process.pid, nonce: randomUUID() }
  for (let told = queued; ; ) {
    if (wait?.signal?.aborted) throw new Error("CANCELLED")
    const taken = await takeRuntimeLock(root, lock).then(
      () => true,
      (error: unknown) => {
        if (wait && error instanceof Error && error.message === "ENVIRONMENT_BUSY") return false
        throw error
      },
    )
    if (taken) {
      if (told) wait?.onTurn?.()
      break
    }
    if (!told) wait?.onWait?.()
    told = true
    await abortablePause(RUNTIME_WAIT_POLL_MS, wait?.signal)
  }
  return holdRuntimeLock(lock, owner, operation)
}

async function abortablePause(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      reject(new Error("CANCELLED"))
    }
    signal?.addEventListener("abort", stop, { once: true })
  })
}

async function takeRuntimeLock(root: string, lock: string) {
  await mkdir(lock).catch(async (error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    const previousLock = await lstat(lock).catch(() => undefined)
    if (!previousLock?.isDirectory() || previousLock.isSymbolicLink()) throw new Error("ENVIRONMENT_BUSY")
    const previousOwner = await readRuntimeLeaseOwner(root)
    if (!previousOwner) {
      if (Date.now() - previousLock.mtimeMs < 30000) throw new Error("ENVIRONMENT_BUSY")
    } else {
      let active = true
      try {
        process.kill(previousOwner.pid, 0)
      } catch (cause) {
        if (!(cause instanceof Error && "code" in cause && cause.code === "ESRCH")) throw cause
        active = false
      }
      if (active) throw new Error("ENVIRONMENT_BUSY")
    }
    const stale = path.join(root, `.environment-stale-${randomUUID()}`)
    await rename(lock, stale).catch(() => {
      throw new Error("ENVIRONMENT_BUSY")
    })
    await rm(stale, { recursive: true, force: true })
    // Another waiter may have cleared the same stale lock and taken it first.
    await mkdir(lock).catch((again: unknown) => {
      if (again instanceof Error && "code" in again && again.code === "EEXIST") throw new Error("ENVIRONMENT_BUSY")
      throw again
    })
  })
}

async function holdRuntimeLock<T>(lock: string, owner: { pid: number; nonce: string }, operation: () => Promise<T>) {
  const ownerFile = path.join(lock, "owner.json")
  try {
    const handle = await open(ownerFile, "wx", 0o600)
    await handle.writeFile(JSON.stringify(owner)).finally(() => handle.close())
  } catch (error) {
    await rm(lock, { recursive: true, force: true })
    throw error
  }
  try {
    return await operation()
  } finally {
    const current = (await readFile(ownerFile, "utf8")
      .then(JSON.parse)
      .catch(() => undefined)) as typeof owner | undefined
    if (current?.nonce === owner.nonce) await rm(lock, { recursive: true, force: true })
  }
}

export async function downloadVerifiedFile(input: {
  url: string
  /** The pinned SHA-256 of the file; or, for files whose publisher pins them by SHA-1 only (the game's own libraries and assets), `sha1`. */
  sha256?: string
  sha1?: string
  destination: string
  proxyUrl?: string
  signal?: AbortSignal
  /**
   * Connections to reuse, for a caller that fetches many files from the same hosts. Without one each file opens (and
   * closes) connections of its own; given one, it is used and left open for the next file.
   */
  dispatcher?: Dispatcher
}): Promise<string> {
  if (input.signal?.aborted) throw new Error("CANCELLED")
  if (
    !URL.canParse(input.url) ||
    !["http:", "https:"].includes(new URL(input.url).protocol) ||
    (input.sha256 === undefined) === (input.sha1 === undefined) ||
    (input.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.sha256)) ||
    (input.sha1 !== undefined && !/^[a-f0-9]{40}$/.test(input.sha1)) ||
    !path.isAbsolute(input.destination)
  )
    throw new Error("INVALID_DOWNLOAD_CONFIGURATION")
  if (input.proxyUrl) proxyJvmArgs({ HTTPS_PROXY: input.proxyUrl })
  const dispatcher = input.dispatcher ?? (input.proxyUrl ? new ProxyAgent({ uri: input.proxyUrl, proxyTunnel: true }) : new Agent())
  // No limit on how long the whole file takes: a download that keeps arriving is not ended for being slow (a fixed ten minutes ended a 26 MB file on a slow line and each
  // new try began again from nothing). One that goes quiet is: `headersTimeout` and `bodyTimeout` below end a connection that has sent nothing for 60 seconds, and the caller tries again.
  const signal = input.signal
  const hash = createHash(input.sha256 ? "sha256" : "sha1")
  const downloaded = { bytes: 0 }
  const download = async () => {
    const file = await open(input.destination, "wx")
    const transfer = async () => {
      const response = await request(input.url, {
        dispatcher,
        signal,
        maxRedirections: 5,
        headersTimeout: 60000,
        bodyTimeout: 60000,
      })
      if (response.statusCode < 200 || response.statusCode >= 300) {
        discardBody(response.body)
        throw new Error(`HTTP ${response.statusCode}`)
      }
      for await (const chunk of response.body) {
        downloaded.bytes += chunk.byteLength
        if (downloaded.bytes > 536870912) {
          discardBody(response.body)
          throw new Error("DOWNLOAD_TOO_LARGE")
        }
        hash.update(chunk)
        await file.writeFile(chunk)
      }
      if (hash.digest("hex") !== (input.sha256 ?? input.sha1)) throw new Error("DOWNLOAD_CHECKSUM_MISMATCH")
      return input.destination
    }
    return transfer().finally(() => file.close())
  }
  return download()
    .catch((error: unknown) => {
      if (input.signal?.aborted) throw new Error("CANCELLED")
      if (error instanceof Error && ["DOWNLOAD_TOO_LARGE", "DOWNLOAD_CHECKSUM_MISMATCH"].includes(error.message))
        throw error
      // The message stays the one every caller tests for; what the network actually answered rides along for whoever reports it.
      throw new Error("DOWNLOAD_FAILED", { cause: error })
    })
    .finally(() => (input.dispatcher ? undefined : dispatcher.destroy()))
}

/** Serialize cache installation without letting one waiting caller cancel another caller's install. */
export async function withRuntimeInstallLock<T>(
  directory: string,
  operation: () => Promise<T>,
  signal?: AbortSignal,
  onWait?: () => void,
): Promise<T> {
  if (signal?.aborted) throw new Error("CANCELLED")
  const key = process.platform === "win32" ? directory.toLowerCase() : directory
  // Another install into the same place goes first: said like any other wait for the environment.
  if (runtimeInstallations.has(key)) onWait?.()
  const running = { value: false }
  const result = (runtimeInstallations.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => {
      if (signal?.aborted) throw new Error("CANCELLED")
      running.value = true
      return operation()
    })
  runtimeInstallations.set(key, result)
  const clear = () => {
    if (runtimeInstallations.get(key) === result) runtimeInstallations.delete(key)
  }
  void result.then(clear, clear)
  return untilCancelled(result, signal, running)
}

export function proxyJvmArgs(environment: Record<string, string | undefined>) {
  const value = environment.HTTPS_PROXY ?? environment.HTTP_PROXY
  if (!value) return []
  if (!URL.canParse(value)) throw new Error("UNSUPPORTED_PROXY_CONFIGURATION")
  const proxy = new URL(value)
  if (!["http:", "https:"].includes(proxy.protocol) || proxy.username || proxy.password)
    throw new Error("UNSUPPORTED_PROXY_CONFIGURATION")
  return ["http", "https"].flatMap((protocol) => [
    `-D${protocol}.proxyHost=${proxy.hostname}`,
    `-D${protocol}.proxyPort=${proxy.port || (proxy.protocol === "https:" ? "443" : "80")}`,
  ])
}

export type StallClock = {
  now: () => number
  schedule: (ms: number, work: () => Promise<void>) => () => void
}

const wallStallClock: StallClock = {
  now: () => performance.now(),
  schedule: (ms, work) => {
    const timer = setTimeout(() => void work(), ms)
    timer.unref?.()
    return () => clearTimeout(timer)
  },
}

export function gradleStall(options: RuntimeOptions["stall"], gradleHome: string, source: string) {
  return {
    ms: options?.ms ?? STALL_MS,
    every: options?.every,
    look: async () => (await directorySize(gradleHome)) + (await directorySize(source)),
    cpu: !options ? watchWindowsProcessTreeCpu() : undefined,
  }
}

export async function runOwnedProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    signal?: AbortSignal
    timeoutMs?: number
    onProgress?: (text: string) => void
    /** Given once, right after the start: a way to write lines to the process's input (the game's server console is driven through it). */
    interact?: (write: (text: string) => void) => void
    /** The process opens a window the person is meant to see (the game itself). Left out, any window it has stays hidden. */
    visible?: boolean
    /** Below normal priority (what it starts afterwards inherits it). Best effort: a system that refuses leaves the process as it was. */
    lowPriority?: boolean
    /**
     * The process is ended when it stands still, not when it has taken long: `look` measures something that grows while it works (the folders a download fills), and a
     * process with no output bytes, size change or measured CPU progress for `ms` is ended with `PROCESS_STALLED` (carrying what it printed, as `output`). With this and
     * without `timeoutMs` there is no limit on the whole run, so a slow download that keeps moving is never ended for being slow. `every` is how often `look` is called;
     * the wait after a look is at least five times what it took, so measuring a big cache never competes with the work.
     */
    stall?: { ms: number; look: () => Promise<number>; every?: number; clock?: StallClock; cpu?: ProcessCpuWatch }
  } = {},
): Promise<{ code: number; output: string }> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: !options.visible,
      detached: process.platform !== "win32",
      stdio: [options.interact ? "pipe" : "ignore", "pipe", "pipe"],
    })
    child.stdin?.on("error", () => undefined)
    if (options.lowPriority && child.pid) {
      try {
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // Not allowed here: it runs at normal priority, which is only a little slower for everything else.
      }
    }
    options.interact?.((text) => {
      if (child.stdin?.writable) child.stdin.write(text, "utf8")
    })
    const state: { output: string; reason?: string } = { output: "" }
    const clock = options.stall?.clock ?? wallStallClock
    const alive = { since: clock.now(), last: -1, cpu: null as ProcessTreeCpu | null, stopWatch: undefined as (() => void) | undefined, over: false }
    const record = (text: string) => {
      const safe = text
        .replace(
          /^.*(?:Picked up JAVA_TOOL_OPTIONS|NOTE: Picked up JDK_JAVA_OPTIONS).*$/gm,
          "[Java environment options applied]",
        )
        .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
        .replace(/\bsk-[A-Za-z0-9_-]+/g, "[redacted]")
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@")
      if (state.output.length >= 1048576) return
      const bounded = safe.slice(0, 1048576 - state.output.length)
      state.output += bounded
      options.onProgress?.(bounded)
    }
    const stop = (reason: string) => {
      if (state.reason) return
      state.reason = reason
      if (!child.pid) return
      if (process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        })
        killer.once("error", () => child.kill())
        killer.once("close", (code) => {
          if (code !== 0) child.kill("SIGKILL")
        })
        return
      }
      void Promise.resolve()
        .then(() => process.kill(-child.pid!, "SIGKILL"))
        .catch(() => child.kill("SIGKILL"))
    }
    const cancel = () => stop("CANCELLED")
    const timer = options.stall && options.timeoutMs === undefined ? undefined : setTimeout(() => stop("PROCESS_TIMEOUT"), options.timeoutMs ?? 600000)
    options.signal?.addEventListener("abort", cancel, { once: true })
    const stall = options.stall
    if (stall) {
      const every = stall.every ?? GRADLE_WATCH_MS
      const tick = async () => {
        const began = clock.now()
        // A measure that cannot be read this time says nothing: the last one stands.
        const [measured, cpu] = await Promise.all([
          stall.look().catch(() => alive.last).then((bytes) => ({ bytes, took: clock.now() - began })),
          child.pid && stall.cpu ? stall.cpu.read(child.pid).catch(() => null) : null,
        ])
        if (alive.over || state.reason) return
        if (measured.bytes !== alive.last || cpuAdvanced(alive.cpu, cpu)) alive.since = clock.now()
        alive.last = measured.bytes
        alive.cpu = cpu
        if (clock.now() - alive.since >= stall.ms) return stop("PROCESS_STALLED")
        alive.stopWatch = clock.schedule(Math.max(every, measured.took * 5), tick)
      }
      alive.stopWatch = clock.schedule(every, tick)
    }
    const buffers = [child.stdout!, child.stderr!].map((stream) => {
      const buffer = { pending: "" }
      stream.on("data", (chunk: Buffer) => {
        if (stall && chunk.length) alive.since = clock.now()
        buffer.pending += chunk.toString("utf8")
        if (buffer.pending.length > 65536) buffer.pending = "[Long process output omitted]\n"
        const lines = buffer.pending.split(/\r?\n/)
        buffer.pending = lines.pop() ?? ""
        if (lines.length) record(`${lines.join("\n")}\n`)
      })
      return buffer
    })
    const cleanup = () => {
      clearTimeout(timer)
      alive.over = true
      alive.stopWatch?.()
      stall?.cpu?.close?.()
      options.signal?.removeEventListener("abort", cancel)
    }
    child.once("error", () => {
      cleanup()
      reject(new Error(state.reason ?? "PROCESS_START_FAILED"))
    })
    child.once("close", (code) => {
      cleanup()
      buffers.forEach((buffer) => {
        if (buffer.pending) record(buffer.pending)
      })
      // What it printed rides along: a run that was ended for standing still is run again, and the words about it are read from this.
      if (state.reason) return reject(Object.assign(new Error(state.reason), { output: state.output }))
      resolve({ code: code ?? -1, output: state.output })
    })
    if (options.signal?.aborted) cancel()
  })
}

/** The variables a build tool or the game is started with: what Windows and Java need, the proxy, and nothing else of Studio's own environment. */
export function runtimeEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      [
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "HOME",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "JAVA_TOOL_OPTIONS",
        "JDK_JAVA_OPTIONS",
        "LANG",
        "LC_ALL",
      ].includes(name.toUpperCase()),
    ),
  )
}

export async function validateJava(javaHome: string, options: { signal?: AbortSignal } = {}, major = 21) {
  const missing = (error: unknown) => {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))
      throw new Error("JAVA_HOME_NOT_FOUND")
    throw error
  }
  const directory = await realpath(javaHome).catch(missing)
  await lstat(path.join(directory, "bin", process.platform === "win32" ? "java.exe" : "java")).catch(missing)
  const result = await runOwnedProcess(
    path.join(directory, "bin", process.platform === "win32" ? "java.exe" : "java"),
    ["-version"],
    { env: runtimeEnvironment(), signal: options.signal, timeoutMs: 15000 },
  )
  if (result.code !== 0 || !new RegExp(`(?:openjdk|java) version "${major}(?:\\.|")`).test(result.output))
    throw new Error(`JAVA_${major}_REQUIRED`)
  return directory
}

/** The folder Studio keeps its own JDK of one major version in: `java-21` (as it always was), `java-17`. */
export const managedJavaFolder = (major: number) => `java-${major}`

export class ManagedJavaCacheError extends Error {
  constructor(readonly detail: string) { super("INVALID_MANAGED_JAVA_DIRECTORY") }
}

/** The runtime directory cannot be used; `detail` says why in the person's words, a link with where it points. */
export class RuntimeDirectoryError extends Error {
  constructor(readonly detail: string) { super("UNSAFE_RUNTIME_DIRECTORY") }
}

/**
 * The real folder a runtime directory stands for, undefined when it is not there yet. With C: full, people move the runtime to another drive
 * and leave a junction where it was: a junction or link to a folder is that folder, and everything after works under the folder it resolves to
 * (links inside it are still refused one by one, so cleanup never follows one). A link to nothing usable is said with where it points.
 */
export async function runtimeDirectoryRoot(directory: string) {
  const info = await lstat(directory).catch((error: unknown) => (error instanceof Error && "code" in error && error.code === "ENOENT" ? undefined : Promise.reject(error)))
  if (!info) return undefined
  if (!info.isSymbolicLink() && !info.isDirectory()) throw new RuntimeDirectoryError(`运行时目录「${directory}」不是文件夹。`)
  const real = await realpath(directory).catch(() => null)
  const folder = real ? await stat(real).then((value) => value.isDirectory(), () => false) : false
  if (real && folder) return real
  const target = real ?? (await readlink(directory).then((value) => path.resolve(path.dirname(directory), value), () => null))
  throw new RuntimeDirectoryError(`运行时目录「${directory}」是一个联接，${target ? `指向「${target}」，那里${real ? "不是文件夹" : "不存在或读不到"}` : "读不出它指向哪里"}。把联接改指到一个存在的文件夹，或者在存储空间里直接选那个文件夹。`)
}

async function validateManagedJava(home: string, major: number, options: { signal?: AbortSignal }, parentLink?: string) {
  const link = parentLink ?? ((await lstat(home).catch(() => null))?.isSymbolicLink() ? home : null)
  const explain = async () => {
    const target = link ? await realpath(link).catch(() => readlink(link).then((value) => path.resolve(path.dirname(link), value)).catch(() => null)) : null
    const where = link
      ? `Java 缓存目录「${link}」是一个目录联接，${target ? "指向「" + target + "」" : "无法读取它指向的位置"}。`
      : `Java 缓存目录「${home}」不完整或不能读取。`
    return new ManagedJavaCacheError(`${where}请检查目标里是否有完整的 JDK ${major}，或到「运行环境」选择一个能用的 Java 后再打包。`)
  }
  const directory = await realpath(home).catch(() => null)
  if (!directory) throw await explain()
  const files = await Promise.all(["java", "javac", "jar"].map((name) =>
    stat(path.join(directory, "bin", process.platform === "win32" ? name + ".exe" : name)).then((info) => info.isFile(), () => false)))
  if (!files.every(Boolean)) throw await explain()
  return validateJava(directory, options, major).catch(async (error: unknown) => {
    if (options.signal?.aborted || (error instanceof Error && error.message === "CANCELLED")) throw error
    throw await explain()
  })
}

export async function ensureJava(
  runtimeDirectory: string,
  options: Pick<RuntimeOptions, "javaHome" | "javaDirectory" | "signal" | "onProgress"> = {},
) {
  return ensureJavaMajor(runtimeDirectory, 21, options)
}

/**
 * A JDK of one major version: the one the person named, else a JAVA_HOME of that version, else Studio's own, installed
 * once from the pinned Temurin build (`target/jdks.ts`), mirror first. Forge 1.20.1 needs 17 and 21 side by side.
 */
export async function ensureJavaMajor(
  runtimeDirectory: string,
  major: number,
  options: Pick<RuntimeOptions, "javaHome" | "javaDirectory" | "signal" | "onProgress"> = {},
) {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  if (options.javaHome) {
    const home = path.resolve(options.javaHome)
    const custom = options.javaDirectory && path.resolve(options.javaDirectory)
    if (custom && home === path.join(custom, managedJavaFolder(major))) {
      const link = (await lstat(custom).catch(() => null))?.isSymbolicLink() ? custom : undefined
      return validateManagedJava(home, major, options, link)
    }
    return home === path.resolve(runtimeDirectory, managedJavaFolder(major))
      ? validateManagedJava(home, major, options)
      : validateJava(home, options, major)
  }
  const environment = process.env.JAVA_HOME
    ? await validateJava(process.env.JAVA_HOME, options, major).catch(() => undefined)
    : undefined
  if (environment) return environment
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const installRoot = options.javaDirectory ?? runtimeDirectory
  // A linked install root can be reused read-only; installs and cleanup must never write through it.
  if (options.javaDirectory && (await lstat(installRoot).catch(() => null))?.isSymbolicLink())
    return validateManagedJava(path.join(installRoot, managedJavaFolder(major)), major, options, installRoot)
  await mkdir(installRoot, { recursive: true })
  // The lock and the lease are keyed by this root, so two installs into the same place wait for each other wherever they come from.
  const root = await realpath(installRoot)
  const turn = waitTurn(options)
  return withRuntimeInstallLock(
    root,
    () =>
      withRuntimeDirectoryLease(root, async () => {
        // An installation may already have waited at the in-process queue before reaching this lease.
        turn.onTurn?.()
        const managed = path.join(root, managedJavaFolder(major))
        const existing = await lstat(managed).catch((error: unknown) => {
          if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
          throw error
        })
        if (existing) return validateManagedJava(managed, major, options)
        if (process.platform !== "win32" || process.arch !== "x64")
          throw new Error(`EXPLICIT_JAVA_${major}_REQUIRED_ON_THIS_PLATFORM`)
        const jdk = managedJdk(major)
        const download = jdk.downloads["windows-x64"]
        const stage = path.join(root, `java-download-${randomUUID()}`)
        await mkdir(stage)
        try {
          const archive = path.join(stage, `temurin${major}.zip`)
          // The download is held to the same rule as every other (`downloadVerifiedFile`: ended when it goes quiet, not when it has taken long) and the unpacking has its own limit below.
          const signal = options.signal
          options.onProgress?.(`Downloading the pinned Java ${major} runtime.\n`)
          // Mirror first, Adoptium last; kept only if it is byte-for-byte the pinned build.
          await fetchVerified({ file: download, destination: archive, proxyUrl: process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY, signal })
          const script = path.join(stage, "expand.ps1")
          await writeFile(
            script,
            'param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)\n$ErrorActionPreference = "Stop"\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination\n',
            { flag: "wx" },
          )
          const extracted = path.join(stage, "extracted")
          const expansion = await runOwnedProcess(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              script,
              "-Archive",
              archive,
              "-Destination",
              extracted,
            ],
            { signal, timeoutMs: 120000, env: runtimeEnvironment(), onProgress: options.onProgress },
          )
          if (expansion.code !== 0) throw new Error("JAVA_EXTRACTION_FAILED")
          const directories = (await readdir(extracted, { withFileTypes: true })).filter(
            (entry) => entry.isDirectory() && !entry.isSymbolicLink(),
          )
          if (directories.length !== 1) throw new Error("JAVA_ARCHIVE_LAYOUT_INVALID")
          const validated = await validateJava(path.join(extracted, directories[0].name), options, major)
          const relative = path.relative(stage, validated)
          if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            throw new Error("JAVA_INSTALL_PATH_ESCAPE")
          await rename(validated, managed)
          const receipt = JavaInstallationReceiptSchema.parse({
            version: jdk.version,
            distribution: jdk.distribution,
            sourceUrl: download.url,
            sha256: download.sha256,
            installedAt: new Date().toISOString(),
          })
          await writeFile(path.join(managed, ".minemods-install.json"), JSON.stringify(receipt), {
            flag: "wx",
            mode: 0o600,
          })
          return managed
        } finally {
          await rm(stage, { recursive: true, force: true })
        }
      }, turn),
    options.signal,
    turn.onWait,
  )
}

/**
 * A run takes its turn at the runtime environment rather than failing while another one holds it. One tracker per run, shared by every
 * lock it waits at: the wait is said once when it begins, the turn once when it ends, and a lock it gets at once says nothing.
 */
export function waitTurn(options: Pick<RuntimeOptions, "signal" | "onProgress">): RuntimeWait {
  let waiting = false
  return {
    signal: options.signal,
    onWait: () => {
      if (!waiting) options.onProgress?.(RUNTIME_WAIT_LINE)
      waiting = true
    },
    onTurn: () => {
      if (waiting) options.onProgress?.(RUNTIME_TURN_LINE)
      waiting = false
    },
  }
}

/** The JDK `ensureJava` would download for this Java major on this computer; null when Studio has none pinned for it. */
export function javaInstallSource(
  major: number,
  system: { platform: NodeJS.Platform; arch: string } = { platform: process.platform, arch: process.arch },
) {
  const java = resolveProfile("fabric-1.21.1").java
  if (major !== java.major || system.platform !== "win32" || system.arch !== "x64") return null
  return {
    vendor: java.distribution === "temurin" ? "Eclipse Temurin" : java.distribution,
    version: java.version,
    url: java.downloads["windows-x64"].url,
    sha256: java.downloads["windows-x64"].sha256,
  }
}

/** Asks the server how big a download is before anyone agrees to it; null on any failure, so no number is ever made up. */
export async function javaDownloadSize(input: { url: string; proxyUrl?: string; signal?: AbortSignal }): Promise<number | null> {
  if (!URL.canParse(input.url) || !["http:", "https:"].includes(new URL(input.url).protocol)) return null
  const dispatcher = (() => {
    try {
      if (input.proxyUrl) proxyJvmArgs({ HTTPS_PROXY: input.proxyUrl })
      return input.proxyUrl ? new ProxyAgent({ uri: input.proxyUrl, proxyTunnel: true }) : new Agent()
    } catch {
      return null
    }
  })()
  if (!dispatcher) return null
  const timeout = AbortSignal.timeout(15000)
  try {
    // GitHub release links answer with a redirect to the storage host, which is the one that knows the length.
    const response = await request(input.url, {
      method: "HEAD",
      dispatcher,
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
      maxRedirections: 5,
      headersTimeout: 15000,
    })
    await response.body.dump()
    const length = Number([response.headers["content-length"]].flat()[0])
    return response.statusCode >= 200 && response.statusCode < 300 && Number.isSafeInteger(length) && length > 0 ? length : null
  } catch {
    return null
  } finally {
    await dispatcher.destroy().catch(() => undefined)
  }
}

const gigabyte = 1024 ** 3
const sizeWords = (bytes: number) =>
  bytes >= gigabyte ? `${(bytes / gigabyte).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`

/** Why Java cannot be installed under `directory`, in plain words; null when it can. `needBytes`: the download's size when the server told it. */
export async function checkInstallDirectory(directory: string, needBytes: number | null): Promise<string | null> {
  if (!path.isAbsolute(directory)) return "这不是一个完整的文件夹位置，请重新选一个文件夹。"
  const present = async (file: string) =>
    lstat(file).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return undefined
      throw error
    })
  try {
    const [root, managed] = [await present(directory), await present(path.join(directory, MANAGED_JAVA))]
    if (root?.isSymbolicLink() || managed?.isSymbolicLink())
      return "这个位置是指向别处的链接，Studio 不往链接里装 Java，请换一个普通文件夹。"
    if (root && !root.isDirectory()) return "这里是一个文件，不是文件夹，请换一个文件夹。"
    if (managed && !managed.isDirectory()) return "这个文件夹里有一个同名的文件挡住了 Java 要装的地方，请换一个文件夹。"
  } catch {
    return "读不了这个位置，请换一个文件夹。"
  }
  const nearest = async (candidate: string): Promise<string> =>
    (await lstat(candidate).catch(() => undefined)) || path.dirname(candidate) === candidate ? candidate : nearest(path.dirname(candidate))
  const existing = await nearest(directory)
  const probe = path.join(existing, `.minemods-write-${randomUUID()}.tmp`)
  const writable = await open(probe, "wx", 0o600)
    .then((handle) => handle.close())
    .then(() => true)
    .catch(() => false)
    .finally(() => rm(probe, { force: true }).catch(() => undefined))
  if (!writable) return "这个文件夹不能写入（可能没有权限），请换一个文件夹。"
  // Peak use is the archive plus the unpacked JDK: the pinned Temurin 21 zip (~190 MB) unpacks to ~330 MB, about 1.75
  // times the download, so three times the download covers both with room to spare. When the size could not be asked,
  // 1 GB is required instead: about twice that ~520 MB peak, enough even if the unknown download is somewhat larger.
  const required = needBytes !== null ? needBytes * 3 : gigabyte
  const { freeSpace } = await import("./java-detect")
  const free = await freeSpace(directory)
  if (free !== null && free < required)
    return `这个盘只剩 ${sizeWords(free)}，装 Java 至少要 ${sizeWords(required)}，请换一个空间更多的位置。`
  return null
}

/**
 * What a build tool needs before it may touch the runtime environment: the JDK found (or installed), the runtime folder's lease
 * taken (the JDK and Gradle's caches are one shared installation; a run waits its turn for it), the JDK checked once more now that nobody
 * else can remove it, and its use recorded. `operation` runs holding all of that.
 */
export async function withBuildEnvironment<T>(options: RuntimeOptions, operation: (environment: { javaHome: string; environment: ReturnType<typeof runtimeEnvironment>; runtimeDirectory: string }) => Promise<T>) {
  const javaHome = await ensureJava(options.runtimeDirectory, options)
  await mkdir(options.runtimeDirectory, { recursive: true })
  // A Studio-installed JDK under a root of the person's own is held by that root's lease as well, so the environment
  // page cannot delete it in the middle of the build, and its last use is recorded where it lives.
  const javaRoot = options.javaDirectory ? await realpath(options.javaDirectory).catch(() => undefined) : undefined
  const apart =
    !!javaRoot &&
    javaRoot !== (await realpath(options.runtimeDirectory)) &&
    path.resolve(javaHome) === path.join(javaRoot, MANAGED_JAVA)
  const runtimeRoot = await realpath(options.runtimeDirectory)
  const turn = waitTurn(options)
  return withRuntimeLeases(apart ? [javaRoot!, runtimeRoot] : [runtimeRoot], turn, async () => {
    if (apart) await recordManagedEnvironmentUse(javaRoot!, [MANAGED_JAVA])
    await validateJava(javaHome, options).catch(() => {
      throw new Error("JAVA_RUNTIME_REMOVED_RETRY")
    })
    const environment = runtimeEnvironment()
    await mkdir(path.join(options.runtimeDirectory, "gradle-home"), { recursive: true })
    const root = await realpath(options.runtimeDirectory)
    await recordManagedEnvironmentUse(root, [
      "gradle-home",
      ...(path.resolve(javaHome) === path.join(root, MANAGED_JAVA) ? [MANAGED_JAVA] : []),
    ])
    return operation({ javaHome, environment, runtimeDirectory: root })
  })
}

/**
 * What a `compileJava` run leaves in the project folder besides Gradle's own: a script, handed to Gradle as an init script, that writes what Gradle
 * gave the Java compiler (its classpath, processors, flags and release) to `CAPTURE_FILE` just before the compile. It is how a later check learns
 * the very classpath of the real build without guessing where Loom keeps its remapped jars. It changes nothing about the build, and it
 * cannot fail it: whatever goes wrong inside it is swallowed.
 */
export const CAPTURE_SCRIPT = "minemods-capture.init.gradle"
export const CAPTURE_FILE = "build/minemods-javac.json"
const CAPTURE_SCRIPT_TEXT = `// Written by MineMods Studio for a code check. Records what Gradle hands to javac; changes nothing, and never fails the build.
gradle.allprojects { p ->
  p.tasks.withType(JavaCompile).configureEach { t ->
    if (t.name != 'compileJava') return
    t.doFirst {
      try {
        def o = t.options
        def main = p.extensions.findByName('sourceSets')?.findByName('main')
        def args = o.allCompilerArgs.collect { it.toString() }
        def data = [
          schema: 1,
          projectDir: p.projectDir.absolutePath,
          srcDirs: main == null ? [] : main.java.srcDirs.collect { it.absolutePath },
          classpath: t.classpath.files.collect { it.absolutePath },
          processorpath: o.annotationProcessorPath == null ? [] : o.annotationProcessorPath.files.collect { it.absolutePath },
          compilerArgs: args,
          // Which -A values were files before the compile (inputs) and which are not there yet (outputs).
          argFileExists: args.collect { a -> def m = (a =~ /^-A[^=]+=(.*)$/); m.matches() ? new File(m.group(1)).exists() : false },
          release: o.release.present ? o.release.get() : null,
          encoding: o.encoding,
          fork: o.fork,
        ]
        def out = new File(p.projectDir, '${CAPTURE_FILE}')
        out.parentFile.mkdirs()
        out.setText(groovy.json.JsonOutput.toJson(data), 'UTF-8')
      } catch (Throwable e) {
        p.logger.warn('minemods capture skipped: ' + e)
      }
    }
  }
}
`

/**
 * What follows `GradleWrapperMain` on a Studio Gradle command line: no daemon, plain output, few downloads at once, Gradle's own network
 * timeouts, the capture script for a code check, then the task. `properties` (`-P…`, `-D…`) go before the task; Fabric passes none, so its
 * command line is the one it always was.
 */
export function gradleWrapperArguments(task: string, properties: readonly string[] = []) {
  return [
    "--no-daemon",
    "--console=plain",
    `--max-workers=${GRADLE_NETWORK.workers}`,
    // Fixed values on the controlled command line; the person's proxy and TLS settings are left as they are.
    ...Object.entries(GRADLE_NETWORK.http).map(([name, value]) => `-D${name}=${value}`),
    ...properties,
    ...(task === "compileJava" ? ["--init-script", CAPTURE_SCRIPT] : []),
    task,
    // A task option follows its task. The one place it is written: the conversion of gameplay code to Mojang's names (`naming-migration.ts`).
    ...(task === MIGRATE_MAPPINGS_TASK ? ["--mappings", OFFICIAL_MAPPINGS] : []),
  ]
}

/**
 * Loom's task that renames the Java under `src/main/java` from the project's own mappings to others and writes the result to `remappedSrc`.
 * Studio runs it only in a throwaway project set up with Yarn names, towards Mojang's (`OFFICIAL_MAPPINGS`, Loom's name for them).
 */
export const MIGRATE_MAPPINGS_TASK = "migrateMappings"
export const OFFICIAL_MAPPINGS = "net.minecraft:mappings:1.21.1"

/** Writes the code check's capture script into a project folder (see `CAPTURE_SCRIPT`). */
export const writeCaptureScript = (sourceDirectory: string) => writeFile(path.join(sourceDirectory, CAPTURE_SCRIPT), CAPTURE_SCRIPT_TEXT)

// `compileJava` compiles the generated sources and stops: no jar, no game. It is how gameplay code is checked.
// `migrateMappings` converts gameplay code to Mojang's names, once per older project (`naming-migration.ts`).
// The list stays a closed one on purpose; a caller cannot pass a task of its own.
export async function runGradle(sourceDirectory: string, task: "build" | "runClient" | "compileJava" | typeof MIGRATE_MAPPINGS_TASK, options: RuntimeOptions) {
  if (task !== "build" && task !== "runClient" && task !== "compileJava" && task !== MIGRATE_MAPPINGS_TASK) throw new Error("UNSUPPORTED_GRADLE_TASK")
  if (options.signal?.aborted) throw new Error("CANCELLED")
  const wrapper = path.join(sourceDirectory, "gradle/wrapper/gradle-wrapper.jar")
  if (
    createHash("sha256")
      .update(await readFile(wrapper))
      .digest("hex") !== resolveProfile("fabric-1.21.1").gradle.wrapper.sha256
  )
    throw new Error("GRADLE_WRAPPER_CHECKSUM_MISMATCH")
  // Only the code check records the compile's inputs. The script sits in the (throwaway) project folder and is named relative to it, so that no path
  // with the person's own characters in it is added to the command line.
  if (task === "compileJava") await writeCaptureScript(sourceDirectory)
  return withBuildEnvironment(options, async ({ javaHome, environment }) => {
    options.onProgress?.(
      task === "build"
        ? "Building the saved project with Gradle.\n"
        : task === "compileJava"
          ? "Compiling the generated sources with Gradle (no jar, no game).\n"
          : task === MIGRATE_MAPPINGS_TASK
            ? "Converting gameplay code from Yarn names to Mojang's with Loom.\n"
            : "Starting the development Minecraft client.\n",
    )
    // Gradle prints nothing while it downloads (a first build sat silent for ten minutes, round 20): the folders it fills are measured and said instead.
    const watch = options.onProgress ? watchGradleDownloads(path.join(options.runtimeDirectory, "gradle-home"), options.onProgress) : undefined
    const once = () =>
      runOwnedProcess(
        path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java"),
        [...proxyJvmArgs(environment), "-classpath", wrapper, "org.gradle.wrapper.GradleWrapperMain", ...gradleWrapperArguments(task)],
        {
          cwd: sourceDirectory,
          env: {
            ...environment,
            JAVA_HOME: javaHome,
            GRADLE_USER_HOME: path.join(options.runtimeDirectory, "gradle-home"),
          },
          signal: options.signal,
          // The game stays open as long as the person plays. A build or a check has no limit on how long it takes, only on how long it stands still: the first fixed
          // limit (fifteen minutes) ended a first download that was slow but moving, twice in a row, in the background preparation (round 21).
          ...(task === "runClient"
            ? { timeoutMs: 14400000 }
            : { stall: gradleStall(options.stall, path.join(options.runtimeDirectory, "gradle-home"), sourceDirectory) }),
          onProgress: options.onProgress,
          lowPriority: options.lowPriority,
        },
      ).catch((error: unknown): { code: number; output: string } => {
        if (!(error instanceof Error && error.message === "PROCESS_STALLED")) throw error
        options.onProgress?.(`${GRADLE_STOOD_STILL}\n`)
        return { code: 1, output: `${(error as Error & { output?: string }).output ?? ""}${GRADLE_STOOD_STILL}\n` }
      })
    // The game itself is never started a second time behind the person's back.
    try {
      const result =
        task === "runClient"
          ? await once().then((value): GradleResult => ({ ...value, network: false, retries: 0 }))
          : await retryGradle(once, { ...options, downloaded: () => directorySize(path.join(options.runtimeDirectory, "gradle-home", "caches")) })
      // A run that finished well has what every later run needs: the next one is not a first time (see `gradleReady`). Not the conversion's: it sets up the game
      // in Yarn's names, which says nothing about the files a build in Mojang's names fetches.
      if (result.code === 0 && task !== MIGRATE_MAPPINGS_TASK) await markGradleReady(options.runtimeDirectory, task)
      return result
    } finally {
      watch?.()
    }
  })
}

/**
 * Whether this computer has already run Gradle to the end for Studio, which means the development files (Gradle itself, Minecraft's, the libraries) are in
 * the folder every build, every code check and the development game share. A build, a code check and the development game are one dependency set:
 * once any of them has finished, none of the others is a "first time". Only a run that ended well leaves the mark; a first attempt that broke off halfway
 * leaves a part-filled folder and no mark, which is why the folder itself is not what is looked at.
 */
const GRADLE_READY_FILE = "minemods-ready.json"
const gradleReadyPath = (runtimeDirectory: string) => path.join(runtimeDirectory, "gradle-home", GRADLE_READY_FILE)
export const gradleReady = (runtimeDirectory: string) => readFile(gradleReadyPath(runtimeDirectory), "utf8").then(() => true, () => false)
/**
 * The tasks whose end means the pack has everything it will ask for. A code check (`compileJava`) leaves the mark too, because the files it fetched are the bulk and the
 * pack no longer counts as a first time, but it does not resolve what only the pack does: Loom's `remapJar` resolves the game's runtime libraries, among them the
 * system-specific native libraries (24 of them, about 7.5 MB, found on a first pack after everything else was prepared, round 21), which a compile never touches.
 */
const GRADLE_WHOLE_TASKS = ["build", "runClient"]
type GradleMark = { at?: unknown; task?: unknown; whole?: unknown }
const readGradleMark = (runtimeDirectory: string) => readFile(gradleReadyPath(runtimeDirectory), "utf8").then((text) => JSON.parse(text) as GradleMark, () => null).catch(() => null)
/** Whether a Gradle run of a pack's own tasks has ended well here, so that the next pack finds every development file in place. Once it has, a later code check does not take it away. */
export const gradleWhole = async (runtimeDirectory: string) => {
  const mark = await readGradleMark(runtimeDirectory)
  return !!mark && (mark.whole === true || (typeof mark.task === "string" && GRADLE_WHOLE_TASKS.includes(mark.task)))
}
export async function markGradleReady(runtimeDirectory: string, task: string) {
  const whole = (await gradleWhole(runtimeDirectory)) || GRADLE_WHOLE_TASKS.includes(task)
  await mkdir(path.join(runtimeDirectory, "gradle-home"), { recursive: true })
  await writeFile(gradleReadyPath(runtimeDirectory), `${JSON.stringify({ at: new Date().toISOString(), task, whole })}\n`).catch(() => undefined)
}

/** How often the folders Gradle downloads into are looked at. Often enough that a counter moves within a person's patience, rare enough that measuring a cache of thousands of files costs nothing. */
export const GRADLE_WATCH_MS = 10_000
const MEGABYTE = 1024 ** 2
/**
 * Says, while Gradle runs, which of its download folders is growing and by how much since this step began. The numbers are what is on disk, measured: no total is
 * known, so no percentage is made up. Returns the function that stops it. `measure` is replaced in tests. `gameFolder`: the folder under
 * `caches` the build tool keeps the game's development files in (Loom's, unless a toolchain names its own).
 */
export function watchGradleDownloads(gradleHome: string, onProgress: (text: string) => void, every = GRADLE_WATCH_MS, measure: (directory: string) => Promise<number> = directorySize, gameFolder = "fabric-loom", clock = wallStallClock) {
  const folders = [
    { label: COUNTER_LABELS.tool, directory: path.join(gradleHome, "wrapper"), start: 0, last: 0, said: "" },
    { label: COUNTER_LABELS.game, directory: path.join(gradleHome, "caches", gameFolder), start: 0, last: 0, said: "" },
    { label: COUNTER_LABELS.libs, directory: path.join(gradleHome, "caches", "modules-2"), start: 0, last: 0, said: "" },
  ]
  const state = { stopped: false, cancel: undefined as (() => void) | undefined }
  const ready = Promise.all(folders.map(async (folder) => (folder.start = folder.last = await measure(folder.directory).catch(() => 0))))
  const tick = async () => {
    const began = clock.now()
    try {
      await ready
      const sizes = await Promise.all(folders.map((folder) => measure(folder.directory).catch(() => folder.last)))
      // The folder that grew most since the last look is what is being fetched now.
      const grown = folders.map((folder, index) => ({ folder, size: sizes[index]!, by: sizes[index]! - folder.last })).sort((a, b) => b.by - a.by)[0]
      folders.forEach((folder, index) => (folder.last = sizes[index]!))
      if (!state.stopped && grown && grown.by > 0) {
        const text = growthLine(grown.folder.label, Math.floor((grown.size - grown.folder.start) / MEGABYTE))
        if ((grown.size - grown.folder.start) / MEGABYTE >= 1 && text !== grown.folder.said) {
          grown.folder.said = text
          onProgress(`${text}\n`)
        }
      }
    } finally {
      // Measuring thousands of files is not free on a slow disk: the wait before the next look is at least five times what this one took, so it never competes with the build.
      if (!state.stopped) state.cancel = clock.schedule(Math.max(every, (clock.now() - began) * 5), tick)
    }
  }
  state.cancel = clock.schedule(every, tick)
  return () => {
    state.stopped = true
    state.cancel?.()
  }
}

/** How lease folders are put in order: the same on every Studio, and case-blind where the file system is. */
const leaseKey = (root: string) => (process.platform === "win32" ? root.toLowerCase() : root)

/**
 * The leases of several folders, held together while `operation` runs. They are always taken in the same order (by path), whichever
 * folder a caller names first, so two Studios whose Java and runtime folders are set the other way round cannot each hold one and wait
 * for the other.
 */
export function withRuntimeLeases<T>(roots: readonly string[], wait: RuntimeWait, operation: () => Promise<T>) {
  const ordered = [...new Set(roots)].sort((a, b) => leaseKey(a).localeCompare(leaseKey(b)))
  return ordered.reduceRight<() => Promise<T>>((inner, root) => () => withRuntimeDirectoryLease(root, inner, wait), operation)()
}

/** Total bytes of the files under `directory`; links are not followed and a missing folder is 0. */
export async function directorySize(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) return 0
      if (entry.isDirectory()) return directorySize(file)
      return entry.isFile() ? ((await lstat(file).catch(() => undefined))?.size ?? 0) : 0
    }),
  )
  return sizes.reduce((total, size) => total + size, 0)
}

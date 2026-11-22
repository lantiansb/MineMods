import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
// Explicit entry bypasses Bun's partial built-in undici shim; Node/Electron use this same installed implementation.
import { Agent, ProxyAgent, request, type Dispatcher } from "undici/index.js"
import type { RemoteFile } from "../target/manifest"
import { candidates, type Candidate, type SourceId } from "./sources"

/**
 * One downloader for everything Studio keeps: Java, game files, loaders, Gradle, mods. Per file it tries the mirrors
 * and then the official address, carries on from what an earlier try already wrote (Range), leaves a source that goes
 * quiet for the next one, and keeps the file only when its hash is the pinned one. A source that failed is tried last
 * for a while afterwards, so a dead mirror costs one stall, not one per file.
 */

const USER_AGENT = "MineModsStudio/0.1 (+https://github.com/minemods)"
const MOST_BYTES = 1024 * 1024 * 1024

export type FetchFailure = { source: SourceId; url: string; reason: "stalled" | "http" | "checksum" | "network" | "too-large"; detail: string }

export class DownloadError extends Error {
  constructor(
    readonly file: string,
    readonly failures: FetchFailure[],
  ) {
    super("DOWNLOAD_FAILED")
  }
}

export type FetchProgress = { bytes: number; total: number | null; source: SourceId }

/** How the last tries of each source went, for this run of Studio. A source that failed waits at the back for a while. */
export class SourceHealth {
  private readonly back = new Map<SourceId, number>()
  constructor(private readonly now: () => number = Date.now) {}
  setBack(source: SourceId, forMs: number) {
    if (source !== "official") this.back.set(source, this.now() + forMs)
  }
  /** Healthy sources first in their own order, then the ones set back (soonest recovered first). */
  order(list: Candidate[]) {
    const until = (candidate: Candidate) => Math.max(0, (this.back.get(candidate.source) ?? 0) - this.now())
    return list.map((candidate, index) => ({ candidate, index, wait: until(candidate) })).sort((a, b) => (a.wait > 0 ? 1 : 0) - (b.wait > 0 ? 1 : 0) || a.wait - b.wait || a.index - b.index).map((entry) => entry.candidate)
  }
}

/** At most `most` downloads at once from one host, so one big batch never floods a mirror. */
export class HostLimiter {
  private readonly running = new Map<string, number>()
  private readonly waiting = new Map<string, (() => void)[]>()
  constructor(private readonly most = 6) {}
  async run<T>(url: string, work: () => Promise<T>): Promise<T> {
    const host = new URL(url).host
    if ((this.running.get(host) ?? 0) >= this.most) await new Promise<void>((resolve) => this.waiting.set(host, [...(this.waiting.get(host) ?? []), resolve]))
    this.running.set(host, (this.running.get(host) ?? 0) + 1)
    try {
      return await work()
    } finally {
      this.running.set(host, (this.running.get(host) ?? 1) - 1)
      const next = this.waiting.get(host)?.shift()
      next?.()
    }
  }
}

const defaultHealth = new SourceHealth()
const defaultLimiter = new HostLimiter()

async function hashOf(file: string, algorithm: "sha256" | "sha1") {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

/** Whether a file already on disk is the pinned one. */
export async function matches(file: string, remote: RemoteFile) {
  const info = await stat(file).catch(() => null)
  if (!info?.isFile() || (remote.size !== undefined && info.size !== remote.size)) return false
  return remote.sha256 ? (await hashOf(file, "sha256")) === remote.sha256 : (await hashOf(file, "sha1")) === remote.sha1
}

export async function fetchVerified(input: {
  file: RemoteFile
  destination: string
  /** Defaults to the file's mirrors then its official address; tests and callers with their own list pass it. */
  sources?: Candidate[]
  mirrors?: boolean
  proxyUrl?: string
  dispatcher?: Dispatcher
  signal?: AbortSignal
  /** How long a source may send nothing before the next one is tried. */
  stallMs?: number
  /** How long a failed source waits at the back. */
  setBackMs?: number
  health?: SourceHealth
  limiter?: HostLimiter
  onProgress?: (progress: FetchProgress) => void
}): Promise<{ path: string; source: SourceId | "kept"; bytes: number }> {
  if (!path.isAbsolute(input.destination)) throw new Error("INVALID_DOWNLOAD_CONFIGURATION")
  if (input.signal?.aborted) throw new Error("CANCELLED")
  if (await matches(input.destination, input.file)) return { path: input.destination, source: "kept", bytes: (await stat(input.destination)).size }
  await mkdir(path.dirname(input.destination), { recursive: true })
  const health = input.health ?? defaultHealth
  const limiter = input.limiter ?? defaultLimiter
  const stallMs = input.stallMs ?? 15_000
  const setBackMs = input.setBackMs ?? 120_000
  const part = `${input.destination}.part`
  const dispatcher = input.dispatcher ?? (input.proxyUrl ? new ProxyAgent({ uri: input.proxyUrl, proxyTunnel: true }) : new Agent())
  const owned = !input.dispatcher
  const failures: FetchFailure[] = []
  const limit = input.file.size ?? MOST_BYTES
  try {
    for (const candidate of health.order(input.sources ?? candidates(input.file.url, { mirrors: input.mirrors }))) {
      const fail = (reason: FetchFailure["reason"], detail: string) => {
        failures.push({ source: candidate.source, url: candidate.url, reason, detail })
        health.setBack(candidate.source, setBackMs)
      }
      try {
        await limiter.run(candidate.url, () => transfer(candidate))
      } catch (error) {
        if (input.signal?.aborted) throw new Error("CANCELLED")
        const message = error instanceof Error ? error.message : String(error)
        fail(message === "STALLED" ? "stalled" : message === "TOO_LARGE" ? "too-large" : message.startsWith("HTTP ") ? "http" : "network", message)
        continue
      }
      if (!(await matches(part, input.file))) {
        // A mirror that sent something else: what it wrote is no use to the next source either.
        await rm(part, { force: true })
        fail("checksum", "hash differs from the pinned one")
        continue
      }
      await rm(input.destination, { force: true })
      await rename(part, input.destination)
      return { path: input.destination, source: candidate.source, bytes: (await stat(input.destination)).size }
    }
  } finally {
    if (owned) await dispatcher.close().catch(() => undefined)
  }
  throw new DownloadError(input.file.url, failures)

  async function transfer(candidate: Candidate) {
    const offset = (await stat(part).catch(() => null))?.size ?? 0
    const quiet = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => quiet.abort(new Error("STALLED")), stallMs)
    }
    const signal = input.signal ? AbortSignal.any([input.signal, quiet.signal]) : quiet.signal
    arm()
    try {
      const response = await request(candidate.url, {
        dispatcher,
        signal,
        maxRedirections: 5,
        headers: { "user-agent": USER_AGENT, ...(offset > 0 ? { range: `bytes=${offset}-` } : {}) },
      })
      // 206 carries on from the offset; a 200 is the whole file (some mirror nodes ignore Range), so start again.
      const resumed = response.statusCode === 206 && offset > 0
      if (response.statusCode !== 200 && !resumed) {
        response.body.resume()
        throw new Error(`HTTP ${response.statusCode}`)
      }
      const length = Number(response.headers["content-length"])
      const total = Number.isFinite(length) ? (resumed ? offset : 0) + length : (input.file.size ?? null)
      if (total !== null && total > limit) {
        response.body.resume()
        throw new Error("TOO_LARGE")
      }
      const file = await open(part, resumed ? "a" : "w")
      let bytes = resumed ? offset : 0
      try {
        for await (const chunk of response.body) {
          arm()
          bytes += (chunk as Buffer).byteLength
          if (bytes > limit) throw new Error("TOO_LARGE")
          await file.write(chunk as Buffer)
          input.onProgress?.({ bytes, total, source: candidate.source })
        }
      } finally {
        await file.close()
      }
    } catch (error) {
      if (quiet.signal.aborted) throw new Error("STALLED")
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

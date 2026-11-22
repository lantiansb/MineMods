/**
 * Gradle and a network that drops. A build that dies while downloading (Minecraft's development files, a
 * library) says nothing about the mod: the same Gradle task is run again a few times with a pause, and Gradle
 * keeps what it already downloaded. Nothing here starts a process, so it can be loaded anywhere.
 */

/**
 * `http` are Gradle's own timeouts and retries for a single download, in its units (milliseconds, attempts).
 * They cover a slow server; a TLS handshake that is cut off is what running the task again is for.
 */
export const GRADLE_NETWORK = {
  /** Runs in a row that got nothing further before giving up. */
  retries: 3,
  pauseMs: [5000, 15000, 30000],
  /**
   * Round 28, a first build from an empty cache through a tunnel that cut TLS handshakes now and then: each run got
   * further (Gradle keeps every file it finished) but three runs were not enough to finish. A run that added to the
   * download cache is progress and does not use up a retry; at most this many runs in all, so a network that drips
   * forever still ends.
   */
  most: 12,
  /** Fewer downloads at once: every one is a TLS handshake, and the handshakes are what such a network cuts. */
  workers: 2,
  http: {
    "org.gradle.internal.http.connectionTimeout": 60000,
    "org.gradle.internal.http.socketTimeout": 60000,
    // The same setting under its current name and the one Gradle used before it; an unknown property is ignored.
    "org.gradle.internal.repository.max.retries": 5,
    "org.gradle.internal.repository.max.tentatives": 5,
    "org.gradle.internal.repository.initial.backoff": 1000,
  },
} as const

/** What the person is told when every retry was used up. `again` is what to do then, in a few words. */
export const gradleNetworkWords = (again = "再点一次打包") => `下载 Minecraft 的开发文件时网络断了（不是你的模组有问题）。已经自动重试过，直到连着 ${GRADLE_NETWORK.retries} 次都没有进展。等一会儿${again}就行，已经下载好的不会重下。`

/** The same, for a code check that could not compile because of it. */
export const CHECK_NETWORK_WORDS = gradleNetworkWords("再检查一次")

/** Thrown by a build that failed only because a download broke off, after the retries. */
export const BUILD_NETWORK_FAILED = "BUILD_NETWORK_FAILED"

/**
 * Written after the output of a Gradle run that Studio ended because it had no observable progress for `STALL_MS`.
 * A run that stands still for that long, between two downloads or in the middle of one, is a connection that went quiet: it is told apart from a compile error
 * by this line and handled like a download that broke off (run again, what was fetched is kept). This is the only way a Gradle run ends for taking long: one that is
 * still printing or still fetching is never ended for the time it has taken (the first fixed limit of fifteen minutes ended a slow first download that was still moving).
 */
const STALL_MARKER = "[Studio] Gradle stood still:"
export const GRADLE_STOOD_STILL = `${STALL_MARKER} no output, file-size change or observed CPU progress, so this run was ended.`

const DOWNLOAD_BROKE = /Remote host terminated the handshake|SSLHandshakeException|Connection reset|Connection refused|Connection timed out|connect timed out|Read timed out|UnknownHostException|NoRouteToHostException|SocketTimeoutException|SocketException|Could not (?:GET|HEAD) '|Could not download |Failed to download |Premature EOF|unexpected end of stream/i
const CODE_BROKE = /Compilation failed|\.java:\d+: error:/

/** Whether a failed Gradle run died on a download and not on the mod's own code. A compile error is never this. */
export const gradleNetworkFailure = (output: string) => (DOWNLOAD_BROKE.test(output) || output.includes(STALL_MARKER)) && !CODE_BROKE.test(output)

export type GradleResult = { code: number; output: string; network: boolean; retries: number }

/**
 * The last download Gradle could not finish, and what the network said, from its own output: "Could not GET '<url>'."
 * followed (on the same or a later line) by the reason. Null when the output names none.
 */
export function gradleNetworkDetail(output: string): string | null {
  const lines = output.split(/\r?\n/)
  const at = lines.map((line) => /Could not (?:GET|HEAD) '/.test(line)).lastIndexOf(true)
  if (at < 0) return null
  const url = lines[at]!.match(/Could not (?:GET|HEAD) '([^']+)'/)![1]!
  const file = decodeURIComponent(url.split("/").at(-1) || url)
  const reason = lines.slice(at, at + 4).map((line) => line.match(DOWNLOAD_BROKE)?.[0]).find((word) => word && !/^Could not/.test(word))
  return `「${file}」（${new URL(url).host}）${reason ? `：${reason}` : ""}`
}

/**
 * Run one Gradle task, and run it again while it keeps failing on a download, at most `GRADLE_NETWORK.retries`
 * times. Anything else that fails (a compile error, a bad build script) is returned at once. `network` on the
 * result says the last failure was still a download; `retries` how many times it was run again.
 */
export async function retryGradle(
  run: () => Promise<{ code: number; output: string }>,
  options: {
    signal?: AbortSignal
    onProgress?: (text: string) => void
    onRetry?: (attempt: number) => void
    pause?: (ms: number) => Promise<unknown>
    /** How much is downloaded so far (bytes in Gradle's cache); a run that raised it got further. */
    downloaded?: () => Promise<number>
  } = {},
): Promise<GradleResult> {
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => {
    const done = () => (clearTimeout(timer), options.signal?.removeEventListener("abort", done), resolve())
    const timer = setTimeout(done, ms)
    options.signal?.addEventListener("abort", done, { once: true })
  }))
  const measure = () => (options.downloaded ? options.downloaded().catch(() => 0) : Promise.resolve(0))
  // `retries`: runs in a row that got nothing further; `runs`: every run, for the overall bound.
  const attempt = async (retries: number, runs: number, before: number): Promise<GradleResult> => {
    const result = await run()
    const network = result.code !== 0 && gradleNetworkFailure(result.output)
    if (!network) return { ...result, network, retries: runs - 1 }
    const after = await measure()
    const further = options.downloaded !== undefined && after > before
    const stuck = further ? 0 : retries + 1
    if (stuck > GRADLE_NETWORK.retries || runs >= GRADLE_NETWORK.most) return { ...result, network, retries: runs - 1 }
    options.onRetry?.(runs)
    options.onProgress?.(
      further
        ? `A download broke off after getting further; running the same Gradle task again (run ${runs + 1} of at most ${GRADLE_NETWORK.most}). What was downloaded is kept.\n`
        : `A download broke off; running the same Gradle task again (${stuck}/${GRADLE_NETWORK.retries}). What was downloaded is kept.\n`,
    )
    await pause(GRADLE_NETWORK.pauseMs[Math.max(0, stuck - 1)] ?? GRADLE_NETWORK.pauseMs.at(-1)!)
    if (options.signal?.aborted) throw new Error("CANCELLED")
    return attempt(stuck, runs + 1, after)
  }
  return attempt(0, 1, await measure())
}

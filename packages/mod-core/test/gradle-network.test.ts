import { expect, test } from "bun:test"
import { GRADLE_NETWORK, gradleNetworkFailure, gradleNetworkWords, retryGradle } from "../src/gradle-network"
import { COMPILE, HANDSHAKE } from "./fixtures/gradle-output"

/** A Gradle that answers from a script, one entry per run, and remembers how it was paused. */
function gradle(script: { code: number; output: string }[]) {
  const seen = { runs: 0, pauses: [] as number[], retries: [] as number[] }
  const run = async () => script[Math.min(seen.runs++, script.length - 1)]!
  return { seen, result: () => retryGradle(run, { pause: async (ms) => void seen.pauses.push(ms), onRetry: (attempt) => void seen.retries.push(attempt) }) }
}

test("a download that broke off is run again and Gradle carries on; one that keeps breaking ends as a network failure; a compile error is never retried", async () => {
  expect(gradleNetworkFailure(HANDSHAKE)).toBe(true)
  expect(gradleNetworkFailure("Could not resolve net.fabricmc:yarn:1.21.1+build.3\nCould not GET 'https://maven.fabricmc.net/x.pom'.\nRemote host terminated the handshake")).toBe(true)
  expect(gradleNetworkFailure(COMPILE)).toBe(false)

  const transient = gradle([{ code: 1, output: HANDSHAKE }, { code: 0, output: "BUILD SUCCESSFUL in 41s" }])
  expect(await transient.result()).toEqual({ code: 0, output: "BUILD SUCCESSFUL in 41s", network: false, retries: 1 })
  expect(transient.seen).toEqual({ runs: 2, pauses: [GRADLE_NETWORK.pauseMs[0]], retries: [1] })

  const down = gradle([{ code: 1, output: HANDSHAKE }])
  expect(await down.result()).toMatchObject({ code: 1, network: true, retries: GRADLE_NETWORK.retries })
  expect(down.seen).toEqual({ runs: GRADLE_NETWORK.retries + 1, pauses: [...GRADLE_NETWORK.pauseMs], retries: [1, 2, 3] })

  const broken = gradle([{ code: 1, output: COMPILE }])
  expect(await broken.result()).toMatchObject({ code: 1, network: false, retries: 0 })
  expect(broken.seen.runs).toBe(1)

  // The words the person reads: whose fault it is not, how often it was tried, and what to do.
  expect(gradleNetworkWords()).toBe(`下载 Minecraft 的开发文件时网络断了（不是你的模组有问题）。已经自动重试过，直到连着 ${GRADLE_NETWORK.retries} 次都没有进展。等一会儿再点一次打包就行，已经下载好的不会重下。`)
})

test("a run that got further does not use up a retry; runs in a row that got nothing do, and there is a bound on all runs", async () => {
  const { retryGradle, GRADLE_NETWORK } = await import("../src/gradle-network")
  const broke = { code: 1, output: "Could not GET 'https://libraries.minecraft.net/a.jar'.\nRemote host terminated the handshake" }
  // Every run adds to the cache: it goes on until the bound on all runs.
  const growing = { size: 0, runs: 0 }
  const forever = await retryGradle(async () => (growing.runs++, broke), { pause: async () => undefined, downloaded: async () => (growing.size += 10) })
  expect(growing.runs).toBe(GRADLE_NETWORK.most)
  expect(forever).toMatchObject({ network: true, retries: GRADLE_NETWORK.most - 1 })
  // Two runs that got further, then nothing more: three more runs that get nothing, then it stops.
  const tapering = { runs: 0, sizes: [0, 10, 20, 20, 20, 20, 20] }
  await retryGradle(async () => (tapering.runs++, broke), { pause: async () => undefined, downloaded: async () => tapering.sizes.shift() ?? 20 })
  expect(tapering.runs).toBe(2 + GRADLE_NETWORK.retries + 1)
  // Finishing after a few runs is a success, as before.
  const late = { runs: 0 }
  expect(await retryGradle(async () => (++late.runs < 5 ? broke : { code: 0, output: "BUILD SUCCESSFUL" }), { pause: async () => undefined, downloaded: async () => late.runs })).toMatchObject({ code: 0, network: false, retries: 4 })
})

test("the last download Gradle could not finish is named, with what the network said", async () => {
  const { gradleNetworkDetail } = await import("../src/gradle-network")
  expect(gradleNetworkDetail("> Could not GET 'https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-dimensions-v1/4.0.1%2B65213ef819/fabric-dimensions-v1-4.0.1%2B65213ef819.pom'.\n   > Remote host terminated the handshake")).toBe("「fabric-dimensions-v1-4.0.1+65213ef819.pom」（maven.fabricmc.net）：Remote host terminated the handshake")
  expect(gradleNetworkDetail("BUILD FAILED")).toBeNull()
})

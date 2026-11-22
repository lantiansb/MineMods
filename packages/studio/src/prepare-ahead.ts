/**
 * 提前准备 (broad20). The first pack from an empty cache took six to eleven minutes and the first opening of the game eight to ten, almost all of it
 * downloads (Gradle's libraries and Minecraft's development files, the game's own files, the server's), and all of it after the person had pressed
 * 「构建并试玩」. The cause is when the downloads happen, so they are moved: once there is a mod to pack soon, Studio fetches in the background what this
 * computer lacks, with the same code and into the same folders the pack and the game use, so that the press finds it there.
 *
 * This file is the rules, with no Node APIs (the window reads the words); the doing is `main/prepare-ahead-run.ts`.
 */
import { BUILD_NETWORK_FAILED } from "@minemods/mod-core/gradle-network"

/** What can be prepared, in the order a press needs it: the development files (the pack), the server's files (the check), the game's files (the game). */
export type AheadStep = "development" | "server" | "client"

/** What this computer already has, as `getBuildPanel` reads it: `build` is the development files, `check` the server's files, `play` the game's. */
export type AheadReady = { build: boolean; check: boolean; play: boolean }

/**
 * Whether what is there is all of it, for the two steps that can be there in part: the development files after only a code check (which does not fetch what a pack
 * resolves, `gradleWhole`) and the game's files without the two mods every scene starts with (`sceneModsReady`). `ready` says the main files are on the computer;
 * this says nothing is left. Left out, everything that is ready is whole.
 */
export type AheadWhole = { build: boolean; play: boolean }

export type AheadFacts = {
  /** The person's switch (设置里的「提前下载游戏文件」). */
  enabled: boolean
  /** Whether the person has agreed to the Minecraft licence in Studio (`agreeSceneEula`). */
  eula: boolean
  ready: AheadReady
  whole?: AheadWhole
}

/**
 * What is fetched ahead, from what is missing and what the person has agreed to; nothing at all when the switch is off.
 *
 * The licence boundary is the pack's own: the development files and the game's files are downloaded by a pack and by 「打开测试场」 whether or not the
 * licence was agreed (the game opens on its main menu without it), so they may be fetched ahead too. The server's files are only ever fetched for the
 * windowless check, which is refused until the person has agreed (`startSceneCheck`, `checkScene`); so they are only fetched ahead once they have.
 * Nothing here agrees to anything, writes the agreement, or starts a server.
 */
export function aheadSteps(facts: AheadFacts): AheadStep[] {
  if (!facts.enabled) return []
  const left = { build: !facts.ready.build || facts.whole?.build === false, play: !facts.ready.play || facts.whole?.play === false }
  return [...(left.build ? (["development"] as const) : []), ...(facts.eula && !facts.ready.check ? (["server"] as const) : []), ...(left.play ? (["client"] as const) : [])]
}

/** What `aheadMoment` reads of a project. */
export type AheadProject = { blueprintConfirmed: boolean; things: number }

/**
 * When it is worth starting, from the project alone (the rest is `aheadSteps`):
 * - 「blueprint」: the person has confirmed the plan, so the AI starts making. Making takes many minutes in which the network is idle, and the first pack comes
 *   after it; before the confirmation they may still discard the plan and leave, and nothing is going to be packed.
 * - 「content」: the project already holds something that can be packed (a project opened again, or made by hand or by an outside AI without a plan).
 * Neither: an empty project that has only been named is not asked for anything.
 */
export function aheadMoment(project: AheadProject): "blueprint" | "content" | null {
  if (project.blueprintConfirmed) return "blueprint"
  return project.things > 0 ? "content" : null
}

/** What each step fetches, in the words the person reads (the first is the pack's, the second the background check's, the third the game's). */
const AHEAD_STEP_WORDS = { development: "打包要用的开发文件", server: "后台检查要用的服务器文件", client: "游戏本体的文件" } as const satisfies Record<AheadStep, string>

/** The words, one line each. The first is the build panel's and what a pack that has to wait for the preparation says; no new explanation anywhere. */
export const AHEAD_WORDS = {
  now: "正在提前准备游戏文件",
  setting: "提前下载游戏文件",
  settingNote: "在后台先下好打包和试玩要用的游戏文件，第一次打包就不用久等。流量有限时关掉。",
  /** Which step is being fetched, after `now`. */
  step: AHEAD_STEP_WORDS,
  /** What stands in the panel's place of `now` when the last try did not succeed: which step, why, and when it is tried again by itself. */
  failed: (failure: { step: AheadStep | null; why: string; retryAt: string }) => {
    const time = new Date(failure.retryAt)
    const at = Number.isFinite(time.getTime()) ? `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}` : ""
    return `提前准备${failure.step ? AHEAD_STEP_WORDS[failure.step] : ""}没有成功：${failure.why}。${at ? `${at} 左右会自动再试，` : "会自动再试，"}现在点打包也行，打包会自己接着下。`
  },
} as const

/**
 * The plain reason a step did not succeed, from the error it ended with. Only the kinds Studio can say something true about are named: a download that broke off or
 * stood still (the same codes the pack's and the game's own failures use), a full disk, a file the system would not let go. Anything else is "出了意料之外的问题"
 * and nothing more: the message of an unknown error is not shown (it may carry a private path); the pack, if the person presses it, shows its own failure in full.
 */
export function aheadWhy(error: unknown): string {
  const code = error instanceof Error ? error.message : ""
  const system = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : ""
  if ([BUILD_NETWORK_FAILED, "SCENE_DOWNLOAD_FAILED", "DOWNLOAD_FAILED", "DOWNLOAD_TIMEOUT"].includes(code)) return "下载时网络断了，或者停住了"
  if (system === "ENOSPC") return "磁盘空间不够了"
  if (["EACCES", "EPERM", "EBUSY"].includes(system)) return "有文件被占用，或者没有写入权限"
  if (code === "JAVA_HOME_NOT_FOUND") return "没有找到工程要用的 Java"
  const java = /^(?:EXPLICIT_)?JAVA_(17|21)_REQUIRED(?:_ON_THIS_PLATFORM)?$/.exec(code)
  if (java) return `没有找到能用的 Java ${java[1]}`
  return "出了意料之外的问题"
}

/**
 * After a preparation did not succeed, how long before it is tried again by itself: one minute, then two, then five, and five from then on. The pack and the game
 * already ran their own retries inside the failed try (a download is asked for six times over half a minute, `SCENE_FETCH`; a Gradle run is run again three times, and
 * is ended after `STALL_MS` of standing still, `GRADLE_NETWORK`), so a failure here is not a network that blinked: the first wait is short because the cause is often
 * already gone (a Wi-Fi that reconnected, a proxy that was switched), and it grows because a failure that comes again is an outage or a block, which a faster try does not
 * cure and which would cost a download's start-up each time. Five minutes is the cap: the try is background and slow (a few files at once), so it costs the person's line
 * nothing worth saving, and a longer wait only leaves a network that came back unused. A pack never waits for any of this: pressing it retries at once (`pressed`).
 */
export const AHEAD_RETRY_MS = [60_000, 120_000, 300_000] as const
/** The wait after the `failures`-th failure in a row (the first is 1). */
export const aheadRetryIn = (failures: number) => AHEAD_RETRY_MS[Math.min(Math.max(failures, 1), AHEAD_RETRY_MS.length) - 1]!
/** After a look that found nothing to do, how long before the disk is looked at again; the project is considered on every save, the disk is not. */
export const AHEAD_LOOK_MS = 60_000

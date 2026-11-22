import { GRADLE_NETWORK } from "./gradle-network"

/**
 * The counters a long wait writes while it works, and when one of them has stopped moving. No Node APIs: the window reads them too.
 *
 * Two kinds exist, and both are measured, never estimated:
 *   - a count of files done out of a known total (the game's sounds, languages and icons: 「…：500 / 3888」);
 *   - the megabytes a download folder has grown by since the step began (Gradle prints nothing while it downloads, so the build's long
 *     silence is read from the folder it fills: `watchGradleDownloads` in runtime.ts). There is no total for those, so no percentage is ever said.
 */

/** What each counter is counting, in the words the person reads. One table so the line that is written and the line that is read agree. */
export const COUNTER_LABELS = {
  assets: "游戏的声音、语言和图标",
  tool: "构建工具",
  game: "游戏的开发文件",
  libs: "开发用的库",
  runtime: "游戏的运行库",
  loader: "加载器的文件",
  client: "游戏本体",
  server: "游戏的服务器",
  mods: "测试场的前置模组",
  other: "其他要用的文件",
} as const

/** A step that counts files: how many are done of how many there are. */
export const countLine = (label: string, done: number, of: number) => `${label}：${done} / ${of}`
/** A step with no known total: how much its folder has grown by since it began. */
export const growthLine = (label: string, megabytes: number) => `正在准备${label}：这一步已经新增 ${megabytes} MB`

export type Counter = { text: string; label: string; done: number; of: number | null }

const COUNT = /^(\S+?)：(\d+) \/ (\d+)$/
const GROWTH = /^正在准备(\S+?)：这一步已经新增 (\d+) MB$/

/** The newest counter line in a stretch of output; null when it holds none. */
export function readCounter(detail: string): Counter | null {
  for (const raw of detail.split(/\r?\n/).reverse()) {
    const line = raw.trim()
    const count = COUNT.exec(line)
    if (count) return { text: line, label: count[1]!, done: Number(count[2]), of: Number(count[3]) }
    const growth = GROWTH.exec(line)
    if (growth) return { text: line, label: growth[1]!, done: Number(growth[2]), of: null }
  }
  return null
}

/**
 * How long a counter may stand still before the window says so. Both the build's downloads (Gradle's connection and socket timeouts) and the
 * game's files (the download's header and body timeouts) give up on a connection that has sent nothing for 60 seconds and try it again; a
 * counter that has not moved for two of those has been through one whole give-up-and-retry without a single file finishing. Shorter than that
 * and an ordinary retry would be called stuck; much longer and the person waits ten minutes (round 20) before being told.
 */
export const STALL_MS = 2 * GRADLE_NETWORK.http["org.gradle.internal.http.socketTimeout"]

/** Whether a counter that last changed at `changedAt` (an ISO time) has stood still for `STALL_MS`; false when nothing is known. */
export function counterStalled(changedAt: string | undefined, now: number) {
  const since = changedAt ? Date.parse(changedAt) : NaN
  return Number.isFinite(since) && now - since >= STALL_MS
}

/** The words for a counter that stopped: what stood still, for how long, and what can be done. Nothing is claimed about why. */
export function stalledWords(counter: string, changedAt: string, now: number) {
  const minutes = Math.max(1, Math.floor((now - Date.parse(changedAt)) / 60_000))
  return {
    lead: `这一步有一阵没有进展了：「${counter}」已经 ${minutes} 分钟没有变。`,
    // Both are true of what Studio keeps: a file is only put in place once it is whole and checked, so a restart never downloads a finished one again.
    can: "可以再等等（网速慢的时候这样也有），也可以点「取消」，再按一次重来：已经下好的文件不会重新下。",
  }
}

/**
 * How long each long step usually takes, and where the range comes from. A range is shown with "usually" and only as a guide: another computer and network
 * can take longer, and when a step has gone past the top of its range the window says so (`longerThanUsual`) instead of going on quoting the range.
 *
 * One rule for every range that was timed: the shortest and longest of the recorded real runs, rounded outward to whole minutes. A range nobody has timed
 * is marked `measured: false` and is an estimate; it is not dressed up as a measurement. "Cold" is a step whose downloads are not on the computer yet
 * (see `getBuildPanel`'s `ready`); "warm" is the same step once they are.
 */
export type UsualWait = { from: number; to: number; measured: boolean; source: string }
const minutes = (shortest: number, longest: number, source: string): UsualWait => ({ from: Math.floor(shortest / 60) * 60, to: Math.ceil(longest / 60) * 60, measured: true, source })

export const USUAL_WAITS = {
  build: {
    cold: minutes(384, 589, "第 26 到 30 批，作者的电脑，从空缓存第一次打包：384 到 589 秒"),
    warm: { from: 60, to: 120, measured: false, source: "估计：之后每次一分钟上下，没有专门计时过" },
  },
  check: {
    cold: { from: 60, to: 120, measured: false, source: "估计：要下的服务器文件约 60 MB，没有专门计时过" },
    warm: null,
  },
  play: {
    cold: minutes(65, 380, "第 26 到 30 批，作者的电脑，从空缓存第一次打开测试场：65 到 380 秒"),
    warm: { from: 10, to: 20, measured: false, source: "估计：游戏本体已经在，只是启动，没有专门计时过" },
  },
} as const satisfies Record<string, { cold: UsualWait; warm: UsualWait | null }>

export type WaitStage = keyof typeof USUAL_WAITS

/** "6 到 10 分钟", or "10 到 20 秒" for a short one. */
export function usualRange(wait: UsualWait) {
  return wait.to >= 90 ? `${Math.round(wait.from / 60)} 到 ${Math.round(wait.to / 60)} 分钟` : `${wait.from} 到 ${wait.to} 秒`
}

/** The usual range for a step; null when none is known for that state. */
export const usualFor = (stage: WaitStage, warm: boolean): UsualWait | null => (warm ? USUAL_WAITS[stage].warm : USUAL_WAITS[stage].cold)

/** Whether a step that has taken `ms` has gone past the top of its usual range. */
export const longerThanUsual = (stage: WaitStage, warm: boolean, ms: number) => {
  const wait = usualFor(stage, warm)
  return wait !== null && ms > wait.to * 1000
}

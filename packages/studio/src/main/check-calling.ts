/**
 * How a code check that outlasts one request is called, timed and worded. Kept apart from the loop so the
 * hand-off text, the capability list and the loop itself read the same definitions and nothing else.
 */

import { USUAL_WAITS, usualRange } from "@minemods/mod-core/progress-counter"

/** The line a compile run writes first when the development files are not on this computer yet; the loop turns it into `CHECK_STAGES.preparing_first`. */
export const COMPILE_COLD_LINE = "The development files are not on this computer yet.\n"

/**
 * A compile can take ten minutes the first time (Minecraft's development files are downloaded), about a minute with Gradle
 * after that and seconds when javac is given Gradle's own classpath, while an MCP client gives one request about a minute. So `check_code` never holds a
 * request open past that: `first` is how long the call that starts a check waits for it, `again` how long a call that comes back for the same check waits
 * (a long poll: it returns the moment the compile finishes), `early` when the person is first told a compile is still going (an ordinary one ends within the
 * minute and would otherwise say nothing), and `beat` how often after that.
 *
 * `again` is derived, not chosen. The code has always assumed one minute for a client's request (the "about a minute" above; the inspection waits are
 * held to 40 s for the same reason, `INSPECTION_LIMITS.wait`), which is the default of the MCP TypeScript SDK's client (`DEFAULT_REQUEST_TIMEOUT_MSEC` = 60 s,
 * as that SDK documents it; not installed in this sandbox to read) for a caller that did not raise it. The answer must be back before then with room to spare.
 * Spent besides the wait itself: reading the project and the record before it and the record after it (milliseconds), the hop from the MCP process to Studio
 * and back (milliseconds), and whatever a busy machine adds to those (assumed to be seconds at the very worst, not measured). `CALL_MARGIN_MS` = 15 s is that
 * allowance with several times over to spare: 60 - 15 = 45 s.
 */
export const CLIENT_CALL_MS = 60000
export const CALL_MARGIN_MS = 15000
export const CHECK_TIMING = { first: 5000, again: CLIENT_CALL_MS - CALL_MARGIN_MS, early: 20000, beat: 60000 } as const
export type CheckTiming = { [K in keyof typeof CHECK_TIMING]: number }

/** How long something has been going, as the person and an outside AI are told it. */
export const elapsedWords = (ms: number) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : `${Math.floor(ms / 60000)} 分钟`)

/** Where a check is, in plain words. The compile's own are read from what Gradle prints. */
export const CHECK_STAGES = {
  reading: "正在核对越界和引用",
  queued: "正在排队，等前一个编译结束",
  preparing: "正在准备编译环境",
  // Only when the development files are really not on this computer yet (`COMPILE_COLD_LINE`); a computer that has built or checked before never reads this.
  preparing_first: `正在准备编译环境：这台电脑还没有下载过 Minecraft 的开发文件，要先下载，一般 ${usualRange(USUAL_WAITS.build.cold)}`,
  compiling: "正在编译代码",
  retrying: "下载时网络断了一下，正在自动重试",
  // Said once a check has ended without a result, so that no one is left reading "preparing" about something that has stopped.
  stopped: "没能开始编译：工程里有别的东西没做对，拼不成一个整体",
  failed: "这一次检查没有做成",
} as const

/** What an outside AI is told about a check that takes longer than one call. */
export const CHECK_CALLING = {
  how: `check_code 不会让一次调用一直等着：编译慢的时候（第一次要下载 Minecraft 的开发文件，可能要十分钟；之后一般一分钟左右），它先回答“还在检查”——finished 是 false，checking 里有已经用了多久、做到哪一步。这时用完全相同的参数再调用 check_code 就是接着等同一次检查：不会再编译一次，也不多占版数；每次调用最多等 ${CHECK_TIMING.again / 1000} 秒，编译一结束就马上返回，不会等满。finished 是 true 时才有 check 结果。检查出结果以前不要交另一版：一次只检查一版，内容不一样的会被退回。调用超时了也一样，用相同的参数再调用一次。`,
  still: (elapsed: string, stage: string) => `还在检查，已经 ${elapsed}（${stage}）。用完全相同的参数再调用一次 check_code 来取结果：不会再编译一次，也不多占版数。`,
  busy: (elapsed: string) => `上一版还在检查（已经 ${elapsed}），一次只能检查一版。用和上次完全相同的参数再调用 check_code 等它出结果，看了结果再交新的一版。`,
  other: "Studio 正在打包或者做别的编译，这一次没法同时编译。等它结束再检查一次。",
} as const

/**
 * A check whose project could not be put together: the generator stopped on something that is not this code's (a creature whose ability names a part its model lacks, a clash between two units),
 * and said why in its own words. `ai` is what the writer of the code is told; `person` is what the person reads; both carry that sentence as it stands.
 */
export const CHECK_STOPPED = {
  ai: (words: string) => `这一版代码没有编译，也没有占用版数：Studio 把工程里所有的东西拼成一个整体时就停下了，原因不在这段代码里。${words}先让那一样东西改好（它是工程里另一个任务的事，或者要由人处理），再用完全相同的参数检查一次；工程一直拼不起来的话，就如实报告这个任务现在做不了。`,
  person: (title: string) => `「${title}」的代码这一次没能编译：工程里别的东西没做对，拼不成一个整体，不是这段代码的问题。`,
} as const

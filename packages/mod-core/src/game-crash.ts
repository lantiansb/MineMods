import type { FindingTarget } from "./reconcile"

/**
 * A game that crashed while the person was looking at the test scene (broad18 w2, B18-J-08): the play stage said 「完成」 and 「测试场已经关掉了」
 * while the process output said `Game crashed!` and the game had written a crash report. A closed window and a crashed game end the same process; only
 * what the game leaves behind tells them apart. This file says what counts as that evidence, reads a crash report, and words the result for the person
 * and for the AI that has to fix it. Reading the files is `findGameCrash` in scene-run.ts. No Node APIs.
 */

/** What a failed play job is stored with in `checkpoint.reason`, so the window decides by this and never by the words of `error`. */
export const CRASH_REASON = "game_crashed"

/**
 * The ways the game leaves word that it crashed, strongest first. Each is read off the 1.21.1 client (javap on `MinecraftClient.printCrashReport`):
 *  - `report`: the game writes `crash-reports/crash-<time>-client.txt` (or `-server.txt`, written by the integrated server when the world's tick
 *    threw, which is what a gameplay callback that throws does) and nothing else writes a file of that name. It does not depend on how much output
 *    Studio kept, which is capped, so it is the evidence that survives a long session.
 *  - `marker`: the line `#@!@# Game crashed! Crash report saved to: #@!@# <path>` (or `#@?@# Game crashed! Crash report could not be saved. #@?@#`)
 *    printed on the process output right before the exit. It names the report even where the folder cannot be listed, but is lost when the output
 *    cap was reached first.
 *  - `exit`: `printCrashReport` ends in `System.exit(-1)` (`-2` when the report could not be saved), which a process reports as 255 / 254, or as the
 *    unsigned 4294967295 / 4294967294 on Windows. A person closing the window ends with 0, so these two codes are a crash and not a close; any
 *    other non-zero code (the process was killed, the computer shut down) is not claimed as one.
 *  - `jvm`: the Java machine itself died and wrote `hs_err_pid<n>.log` (a fault in native code, a graphics driver); then no crash report exists.
 */
export type CrashSign = "report" | "marker" | "exit" | "jvm"
export const GAME_CRASH_CODES: readonly number[] = [-1, -2, 255, 254, 4294967295, 4294967294]
export const CRASH_MARKER = /#@[!?]@# Game crashed!/
/** The path the marker line names; what stands after the second `#@!@#` up to the end of the line. */
export const CRASH_MARKER_PATH = /#@!@# Game crashed! Crash report saved to: #@!@# ([^\r\n]+)/

export type CrashFrame = { class: string; method: string; file: string | null; line: number | null }

export type GameCrash = {
  signs: CrashSign[]
  /** The process's exit code, when it ended with one. */
  code: number | null
  /** Where the game wrote the report (or the Java machine its fatal-error log); null when it wrote none. Absolute. */
  report: string | null
  /** The game's own one-line description of what it was doing (`Exception ticking world`), as written. */
  description: string | null
  /** The exception that ended the game, first line as written (`java.lang.IllegalArgumentException: Invalid weapon firing an arrow`). */
  exception: string | null
  /** The first frame of the stack that belongs to this mod's package, with the gameplay it stands in when the package is a gameplay's. */
  where: (CrashFrame & { gameplay: string | null }) | null
  /** The start of the stack, up to and including the mod's frame and two after it, as `Class.method(File.java:line)`. */
  frames: string[]
  at: string
}

const FRAME = /^\s*at\s+(?:[\w.@-]+\/)*([\w.$]+)\.([\w$<>]+)\(([^)]*)\)/

/**
 * What a crash report says about the crash: the description, the exception and the stack of its head (everything before the game's own
 * "A detailed walkthrough" line, which repeats the stack under `-- Head --`). `modPackage` is the package every class of this mod lives under
 * (`com.minemods.content_<mod id>`); the frame chosen is the first one in it, but not one in the generated support package `gameplay.api`, which
 * only forwards what a gameplay asked of it, and not one of `Caused by` before the last: the cause that ended it is the deepest one.
 */
export function parseCrashReport(text: string, modPackage: string): Pick<GameCrash, "description" | "exception" | "where" | "frames"> {
  const lines = text.split(/\r?\n/)
  const walkthrough = lines.findIndex((line) => /^A detailed walkthrough/.test(line))
  const head = walkthrough < 0 ? lines : lines.slice(0, walkthrough)
  const description = head.map((line) => /^Description:\s*(.+)$/.exec(line)?.[1]?.trim()).find(Boolean) ?? null
  // The stacks, each starting at its exception line: the first, and one more for every `Caused by:`.
  const stacks: { exception: string; frames: CrashFrame[]; raw: string[] }[] = []
  for (const line of head) {
    const exception = /^(?:Caused by:\s*)?([\w.$]+(?:Exception|Error|Throwable)\b.*)$/.exec(line.trim())
    if (exception && !/^\s*at\s/.test(line) && (stacks.length === 0 ? !/^Description:/.test(line) : /^Caused by:/.test(line.trim()))) {
      stacks.push({ exception: exception[1]!.trim(), frames: [], raw: [] })
      continue
    }
    const frame = FRAME.exec(line)
    if (frame && stacks.length) {
      const place = /^([\w$]+\.java):(\d+)$/.exec(frame[3]!.trim())
      stacks.at(-1)!.frames.push({ class: frame[1]!, method: frame[2]!, file: place?.[1] ?? null, line: place ? Number(place[2]) : null })
      stacks.at(-1)!.raw.push(`${frame[1]}.${frame[2]}(${frame[3]!.trim()})`)
    }
  }
  const prefix = `${modPackage}.`
  const inMod = (frame: CrashFrame) => frame.class.startsWith(prefix) && !frame.class.startsWith(`${prefix}gameplay.api.`)
  const ordered = [...stacks].reverse()
  const stack = ordered.find((value) => value.frames.some(inMod)) ?? ordered.find((value) => value.frames.some((frame) => frame.class.startsWith(prefix))) ?? stacks[0]
  const where = stack?.frames.find(inMod) ?? stack?.frames.find((frame) => frame.class.startsWith(prefix)) ?? null
  const at = stack && where ? stack.frames.indexOf(where) : -1
  return {
    description,
    // What the game was told first is the wrapper (`CrashException`); the person and the AI read the exception that was thrown, which is the last cause.
    exception: stacks.at(-1)?.exception ?? null,
    where: where ? { ...where, gameplay: gameplayOf(where.class, modPackage) } : null,
    frames: stack ? stack.raw.slice(0, Math.max(at + 3, 6)) : [],
  }
}

/** The slug of the gameplay a class belongs to (`<mod package>.gameplay.<slug>.…`), null for any other class of the mod and for the support package. */
export function gameplayOf(className: string, modPackage: string) {
  const found = new RegExp(`^${modPackage.replaceAll(".", "\\.")}\\.gameplay\\.([a-z][a-z0-9_]*)\\.`).exec(className)
  return found && found[1] !== "api" ? found[1]! : null
}

/** The words of a crash, each said in the person's language; the file and the line stay for 高级. */
export const CRASH_WORDS = {
  /** The play stage's mark and the stop's first sentence. */
  mark: "游戏崩溃了",
  stop: "游戏崩溃了，测试场不是正常关掉的。",
  /** Which part of the mod the report points at. It points: it is where the stack first enters this mod, not a finding that the fault is there. */
  gameplay: (title: string) => `崩溃报告指向玩法「${title}」：游戏是在运行它的代码时出的错。`,
  thing: (title: string) => `崩溃报告指向「${title}」。`,
  generated: "崩溃报告指向这个模组里 Studio 自己生成的部分，具体位置在「高级」里。",
  elsewhere: "崩溃报告里没有出现这个模组的代码，问题可能出在游戏本身，或者你放进测试场的别的模组。",
  unread: "没能读出崩溃报告里的内容，所以说不出它指向哪一部分。",
  report: (path: string) => `崩溃报告在：${path}。`,
  none: "游戏没有留下崩溃报告，只能从它退出的方式看出它是崩溃了。",
  jvm: (path: string) => `游戏连同运行它的 Java 一起崩了，留下的记录在：${path}。`,
  button: "把这次崩溃交给 AI 改",
  /** After the sentences, when the crash is pointed at something an AI can be asked to change. */
  fixable: "可以把这次崩溃连同崩溃报告里的内容交给 AI，让它改。",
  unfixable: "这次崩溃对应不到工程里的某一样东西，没法直接交给某一张卡片重做。",
  /** Said after `unfixable` when there is a report to hand over. */
  show: "崩溃报告可以发给你的 AI 看。",
  advanced: (crash: Pick<GameCrash, "exception" | "description" | "where">) =>
    [crash.description ? `游戏说：${crash.description}` : "", crash.exception ?? "", crash.where ? `位置：${crash.where.class}.${crash.where.method}${crash.where.file ? `（${crash.where.file}${crash.where.line ? `:${crash.where.line}` : ""}）` : ""}` : ""].filter(Boolean).join("\n"),
} as const

/** The signs as the person's sentence, for a log or the card: how Studio knows it crashed. Never claims more than the evidence. */
export const crashSignWords = (signs: readonly CrashSign[]) =>
  signs.length === 0 ? "" : `依据：${signs.map((sign) => ({ report: "游戏写下了崩溃报告", marker: "游戏输出里有「Game crashed」", exit: "游戏以崩溃的方式退出", jvm: "Java 留下了致命错误记录" })[sign]).join("；")}。`

/**
 * The sentence a failed play job is given: that it crashed, which part the report points at, where the report is. `find` names the thing of the
 * project a gameplay slug stands for (its title), null when the project has none by that slug.
 */
export function crashSentence(crash: GameCrash, find: (slug: string) => string | null) {
  const title = crash.where?.gameplay ? find(crash.where.gameplay) : null
  const part = crash.signs.includes("jvm") && !crash.where ? "" : title ? CRASH_WORDS.gameplay(title) : crash.where ? CRASH_WORDS.generated : crash.report ? (crash.exception || crash.frames.length ? CRASH_WORDS.elsewhere : CRASH_WORDS.unread) : ""
  const kept = crash.report ? (crash.signs.includes("jvm") && !crash.signs.includes("report") ? CRASH_WORDS.jvm(crash.report) : CRASH_WORDS.report(crash.report)) : CRASH_WORDS.none
  return [CRASH_WORDS.stop, part, kept, title ? CRASH_WORDS.fixable : `${CRASH_WORDS.unfixable}${crash.report ? CRASH_WORDS.show : ""}`].filter(Boolean).join("")
}

/** The way to the card a crash points at, when it points at a gameplay of the project: the same button a finding has. */
export function crashTarget(crash: GameCrash, find: (slug: string) => { id: string; title: string } | null): FindingTarget | null {
  const found = crash.where?.gameplay ? find(crash.where.gameplay) : null
  return found ? { about: { kind: "gameplay", id: found.id, name: found.title }, field: "", label: `打开「${found.title}」` } : null
}

/**
 * The crash as the AI that has to fix it is told: what the game said, where its stack first entered the mod, and the start of the stack. Written as lines
 * for `fixFindings`, which hands them to the redo of the card the crash points at. The exception is quoted as the game wrote it: that is the evidence.
 */
export function crashRemark(crash: GameCrash, title: string | null): string[] {
  return [
    `游戏崩溃了${crash.description ? `（游戏说：${crash.description}）` : ""}${crash.exception ? `，抛出的是 ${crash.exception}` : ""}。`,
    crash.where ? `崩溃报告的调用栈里，最先进到这个模组代码的地方是 ${crash.where.class}.${crash.where.method}${crash.where.file ? `（${crash.where.file}${crash.where.line ? ` 第 ${crash.where.line} 行` : ""}）` : ""}${title ? `，属于玩法「${title}」` : ""}。` : "",
    crash.frames.length ? `调用栈开头：${crash.frames.join("；")}。` : "",
    "先弄清游戏为什么不接受这里的写法（它在服务器上会再检查一遍参数），改掉这一处；同类的写法在这个玩法的别处也检查一遍。",
  ].filter(Boolean)
}

/** What the play job throws when the game crashed: the sentence is the one the person reads, the crash and the way to its card ride along for the job's record. */
export class GameCrashedError extends Error {
  constructor(
    message: string,
    readonly crash: GameCrash,
    readonly target: FindingTarget | null,
  ) {
    super(message)
    this.name = "GameCrashedError"
  }
}

/** Whether a job is a play that ended in a crash, by the reason it was stored with and never by its words. */
export const jobCrashed = (job: { state: string; checkpoint: unknown } | null | undefined) =>
  !!job && job.state === "failed" && !!job.checkpoint && typeof job.checkpoint === "object" && !Array.isArray(job.checkpoint) && (job.checkpoint as { reason?: unknown }).reason === CRASH_REASON

/** What a crashed job's checkpoint keeps for 高级: the game's own words and the place, already put into lines. Empty for any other job. */
export function jobCrashDetail(job: { checkpoint: unknown } | null | undefined) {
  const checkpoint = job?.checkpoint
  const detail = checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) ? (checkpoint as { crash_detail?: unknown }).crash_detail : undefined
  return typeof detail === "string" ? detail : ""
}

/** The sentence of a crashed play without its first part: the stop line already says that the game crashed, and the rest is what follows from it. */
export const crashDetails = (error: string) => (error.startsWith(CRASH_WORDS.stop) ? error.slice(CRASH_WORDS.stop.length) : error)

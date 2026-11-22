import { RUNTIME_WAIT_WORDS, buildStageWords } from "@minemods/mod-core/build-stages"
import { SCENE_WORDS } from "@minemods/mod-core/scene"
import { CRASH_WORDS } from "@minemods/mod-core/game-crash"
import type { JobState } from "@minemods/mod-core/jobs"
import { longerThanUsual, readCounter, stalledWords, counterStalled, usualFor, usualRange } from "@minemods/mod-core/progress-counter"
import { VERSION_WORDS, type PackedVersion } from "@minemods/mod-core/packed-version"

/**
 * 「构建并试玩」 as one press: pack the mod, check it in the background when the person has agreed to the game's
 * licence, then open the test scene. This file is the decision only — given what is known, what happens next —
 * and the words each stage and each stop is said with. The window starts the jobs and reads their ends.
 */

export type ChainStage = "build" | "check" | "play"
export type ChainEnd = Exclude<JobState, "queued" | "running">
export type ChainStop =
  /** Only the jar was asked for, and there is one. */
  | "built"
  /** The game was opened and has been closed again. */
  | "played"
  | "build_failed"
  /**
   * There is no build of the project as it is now because something was saved meanwhile: either the build ended well and is already out of
   * date, or the run itself refused to keep a build of a project that changed under it (the job's reason says so, `ChainFacts.ended.stale`).
   */
  | "build_stale"
  | "check_failed"
  /** The check ran and found something: the person decides whether to look anyway. */
  | "found"
  | "missing"
  | "play_failed"
  /** The game was opened and crashed (the play job's failure reason says so): not a game that was closed, and not one that could not be opened. */
  | "crashed"
  | "canceled"
  /** The person read what the check found and chose not to open the game. */
  | "left"
  /** The licence is not agreed and there is no test world to open: the person decides between agreeing and the game's bare main menu. */
  | "eula"
  /** The AI is still making things, so a pack now would be out of date as soon as one is saved: the person decides between packing what is there and waiting. */
  | "making"
  /** The person chose to wait for the AI to finish. */
  | "waits"

export type ChainFacts = {
  /** What the person pressed: the whole way into the game, or only the file. */
  want: "play" | "jar"
  /** There is a finished build of the project as it is now. */
  built: boolean
  /** The person has agreed to the game's licence, which the windowless check needs. Never set by the chain. */
  eula: boolean
  /** A test world of an earlier check is there for this very build, so opening the scene needs no new check and does not land on the main menu. */
  world: boolean
  /** The stage this chain ran last and how it ended; null before the first. */
  ended: { stage: ChainStage; state: ChainEnd; /** The job failed because the project was saved while it ran; known from the job's recorded reason, never from its words. */ stale?: boolean; /** The play job ended because the game crashed; known from the job's recorded reason too. */ crashed?: boolean } | null
  /** What the scene's record says after a stage that sets it up: how many things the check found, which mods are missing. */
  scene: { findings: number; missing: readonly string[] } | null
  /**
   * How many things the AI is still making (or making again) right now. Only asked about before a pack is made: with a finished
   * build of the project as it is, the press plays exactly that build and later saves do not touch it.
   */
  making: number
  /** What the person answered where the chain stopped to ask; "now" is 「pack what is there」 at the `making` stop. */
  choice: "open" | "leave" | "now" | null
}
export type ChainStep = { run: ChainStage } | { stop: ChainStop }

/** The next thing to do. Pure: the same facts always give the same step. */
export function chainStep(facts: ChainFacts): ChainStep {
  const ended = facts.ended
  if (ended && ended.state === "canceled") return { stop: "canceled" }
  if (ended && ended.state !== "completed") {
    // The project changed under the run, so whatever it was working from is no longer the project: that is not a failure of the mod, and the one way on is to pack again.
    if (ended.stale) return { stop: "build_stale" }
    if (ended.stage === "build") return { stop: "build_failed" }
    // Both scene stages refuse the same way when a mod this one needs is not there, and the record names them.
    if (facts.scene?.missing.length) return { stop: "missing" }
    if (ended.stage === "play") return { stop: ended.crashed ? "crashed" : "play_failed" }
    // A check that could not run says nothing about the mod: the person may still look.
    return facts.choice === "open" ? { run: "play" } : facts.choice === "leave" ? { stop: "left" } : { stop: "check_failed" }
  }
  // Asked once, at the start: later saves by the AI while the chain runs show up as a stale build, which has its own stop.
  if (!facts.built && !ended && facts.making > 0 && facts.choice !== "now") return facts.choice === "leave" ? { stop: "waits" } : { stop: "making" }
  // Something ran against a pack and the project has been saved since: there is no pack of the project as it is. Packing again is the person's call (the stop offers it),
  // never done behind their back: after the game was closed it used to pack anew and open the game a second time.
  if (!facts.built) return ended?.stage === "play" ? { stop: "played" } : ended ? { stop: "build_stale" } : { run: "build" }
  if (facts.want === "jar") return { stop: "built" }
  if (ended?.stage === "play") return { stop: "played" }
  if (ended?.stage === "check") {
    if (!facts.scene?.findings) return { run: "play" }
    return facts.choice === "open" ? { run: "play" } : facts.choice === "leave" ? { stop: "left" } : { stop: "found" }
  }
  if (facts.eula) return { run: "check" }
  // No licence, so no check, so no world: the game would open on its main menu with nothing of the mod set out. The person decides, unless there is a world already or they chose to open anyway.
  return facts.world || facts.choice === "open" ? { run: "play" } : { stop: "eula" }
}

/**
 * The stops that put buttons of their own in the drawer. At those the person is in the middle of one press and the stop's buttons are
 * the ways on from where it stands (agree or not, pack now or wait, pack again, open anyway or not), each continuing what they pressed.
 * The drawer's ordinary 「打包并打开游戏」 / 「只打包」 would start a second, separate press beside them: three buttons for one decision, two
 * of which restart from the beginning (broad18 r52). So while a stop like this is shown the ordinary pair is not offered; every other stop
 * (done, failed, canceled, left, waits) has no button of its own and the ordinary pair is the natural way to try again.
 */
export const STOPS_WITH_OWN_ACTIONS: readonly ChainStop[] = ["eula", "making", "build_stale", "found", "check_failed"]
export const chainOwnsNextAction = (stop: ChainStop | "busy" | null | undefined) => !!stop && (STOPS_WITH_OWN_ACTIONS as readonly string[]).includes(stop)

/** The jar export beside the play buttons: a copy of a finished pack, so the game being open is no reason to hold it back. */
export const EXPORT_WORDS = {
  button: "导出模组文件 .jar",
  packing: "正在打包，打完才能导出。",
  packingThenSave: "正在打包，打完会让你选保存的位置。",
  needsPack: "还没有这一版的打包，而游戏或别的任务开着时没法打包，等它结束再导出。",
} as const

/**
 * Whether the export button can be pressed, and the one sentence beside it when there is a real reason it cannot. It is off only while a pack is being written (a copy
 * taken of a file in the middle of being written would be a torn one), or when there is no pack of the project as it is and something else is running, so none can be made
 * now. With a pack, nothing else matters: not the game being open, not a check running; the jar is a file of its own. Without one, pressing it packs first (the "只打包" press,
 * which neither checks nor opens the game) and then saves.
 */
export function exportButton(input: {
  busy: boolean
  /** The job running now: none, a pack being made, anything else (the game, a check), or one that has not been read yet. */
  running: "none" | "build" | "other" | "unknown"
  /** There is a finished pack of the project as it is now. */
  hasPack: boolean
  /** A press of the play or pack button is under way. */
  pressing: boolean
  /** The pack being made is this export's own, so it is saved when it is done. */
  savingAfterPack: boolean
}): { off: boolean; why: string } {
  if (input.busy) return { off: true, why: "" }
  // A job that has not been read yet is held back for the moment it takes, without a reason that may not be true.
  if (input.running === "unknown") return { off: true, why: "" }
  if (input.running === "build") return { off: true, why: input.savingAfterPack ? EXPORT_WORDS.packingThenSave : EXPORT_WORDS.packing }
  if (input.hasPack) return { off: false, why: "" }
  if (input.running === "other") return { off: true, why: EXPORT_WORDS.needsPack }
  // A press is on its way to a pack (between two of its steps nothing runs): its own list shows where it is.
  return { off: input.pressing, why: "" }
}

/** The stages a press goes through, in order, for the list the drawer shows. */
export const chainStages = (want: ChainFacts["want"]): ChainStage[] => (want === "jar" ? ["build"] : ["build", "check", "play"])

/** A job's state as the person reads it. A job cut off by the app closing did not get done either. */
export const JOB_STATE_WORDS: Record<JobState, string> = {
  queued: "排队中",
  running: "正在进行",
  completed: "做好了",
  failed: "没做成",
  canceled: "已取消",
  interrupted: "没做成",
}

export const CHAIN_WORDS = {
  /** The play stage's state once the game is open: the job is still going, but it is waiting for the person to close the game, not for the game. */
  gameOpen: "游戏开着",
  start: "构建并试玩",
  jar: "打包，不打开游戏",
  open: "还是打开看看",
  leave: "先不打开",
  eula: "同意以后，打开游戏之前会先在后台用游戏自带的服务器建好测试场，把你做的东西摆好；不同意的话游戏也能打开，但只到主菜单，什么都没有摆。",
  /** The stop for a licence not agreed: what each of the two answers gives. */
  agree: "同意许可协议，继续",
  openBare: "不同意，直接打开游戏",
  /**
   * The `making` stop: what each of the two answers gives. The second only puts the press down: Studio cannot tell an outside AI that is between two batches from one that
   * is done, so nothing is queued and nothing is packed or opened by itself later; the button says that it is the person who presses again.
   */
  packNow: "先打包现在有的",
  waitForAi: "先不打包，我晚点再按",
  /** The `build_stale` stop: one press that packs the project as it is now and goes on the same way the first press would have. */
  again: (want: ChainFacts["want"]) => VERSION_WORDS.again(want),
  openBareNote: "不同意的话，游戏会直接打开到主菜单：测试场里不会摆好你做的东西。要看它们，得自己新建一个创造模式的世界，再从物品栏里拿出来；具体怎么做，写在下面。",
  licence: "Minecraft 最终用户许可协议：aka.ms/MinecraftEULA",
  stage: { build: "打包模组", check: "后台检查", play: "打开测试场" } satisfies Record<ChainStage, string>,
  /** What is happening. What it costs when the downloads are not on this computer yet is `COLD_WORDS`, said only then. */
  running: {
    build: "正在把做好的东西做进模组。",
    check: "正在后台检查：不开窗口，把每样东西在游戏里摆出来问一遍。",
    play: "正在打开测试场。游戏窗口关掉以后这里才算结束。",
  } satisfies Record<ChainStage, string>,
  /** A stage the chain did not need to run. */
  skipped: { build: "沿用已有的打包", check: "没有同意许可协议，跳过", play: "" } satisfies Record<ChainStage, string>,
  stop: {
    built: "模组打包好了，可以导出了。",
    played: "测试场已经关掉了。想再看一次，再按一次就行。",
    /** The same, when the project has been saved since the pack it opened: the version lines say what is missing, and pressing again packs anew. */
    played_older: "测试场已经关掉了。",
    build_failed: "模组没有打包成功。",
    build_stale: "打包完以后工程又改过了，这份打包已经不是现在的样子。",
    /** The pack run itself was cut off by a save: nothing was kept, so nothing is out of date, there is simply no pack of the project as it is. */
    build_stale_failed: "打包的时候工程变了（有新的内容存了进来），这一次没有留下可用的打包。",
    build_stale_failed_making: (count: number) => `打包的时候 AI 存了新的东西，这一次没有留下可用的打包；它还在做 ${count} 样，等它做完再打包最稳。`,
    /** The same, when the AI is still making things: pressing again will first ask what to do about that. */
    build_stale_making: (count: number) => `打包的时候 AI 又存了新的东西，这份打包已经不是现在的样子；它还在做 ${count} 样，等它做完再打包最稳。`,
    making: (count: number) => `AI 还在做 ${count} 样东西（包括正在重做的）。现在打包，打进去的是它们目前的样子；做好一样，工程就变一次，这份打包就不是最新的了，到时候得再打包一次。`,
    waits: "好，先不打包。等 AI 做完，你再按一次，那时打出来的就是最新的。",
    check_failed: "后台检查没有做成，这不一定是模组的问题。",
    found: (count: number) => `后台检查发现了 ${count} 处问题：`,
    play_failed: "测试场没有打开成功。",
    crashed: CRASH_WORDS.stop,
    canceled: "已经停下了。上一次成功的打包还在。",
    left: "好，先不打开。改好以后再按一次。",
    eula: "要把你做的东西摆在测试场里给你看，得先在后台用游戏自带的服务器建好测试场，这需要你同意游戏的许可协议（Minecraft EULA）。",
  },
  /** Something else is still running, so the chain was not started. */
  busy: "上一件事还没做完，等它结束再按一次。",
  missing: SCENE_WORDS.missing,
} as const

/**
 * Whether the scene's game is open, by the line the play job writes when the player is in the world (broad6 w3) or, before that, when the
 * game finished loading and sits on its title screen (broad16 a60: it had been on the main menu for minutes while this still said 「正在打开」).
 */
export const GAME_OPEN_LINES = [SCENE_WORDS.in_game, SCENE_WORDS.at_title] as const
export const inGame = (stage: ChainStage, detail: string) => stage === "play" && GAME_OPEN_LINES.some((line) => detail.includes(line))

/**
 * What a job's detail says once the job is over. The detail is the newest piece of output, so a job that stopped without writing an end (Studio was closed, or killed, with the scene's
 * game open) still has 「游戏已经开着了」 as its last line. That was true of the run, not of what is there now: it is taken out of a job that is no longer going, and an interrupted job
 * says why it stopped instead (broad11 w4b: it went on saying the game was open after a restart, with nothing running).
 */
export const INTERRUPTED_WORDS = "Studio 关掉的时候这一步还没做完，所以它停下了，不算做成。测试场的游戏窗口要是还开着，自己关掉它，再重新按一次。"
export function endedDetail(state: JobState, detail: string) {
  if (state === "queued" || state === "running") return detail
  const rest = GAME_OPEN_LINES.reduce((text, line) => text.replace(line, ""), detail).trimEnd()
  return state === "interrupted" ? `${rest}${rest ? "\n" : ""}${INTERRUPTED_WORDS}` : rest
}

/**
 * What a stage costs when the downloads it needs are not on this computer yet, and what it does not when they are. Said from the computer's real state
 * (`getBuildPanel`'s `ready`, read when the stage started), never from "is this the first press": a code check, a build and the development game share one set of files,
 * so once any of them has finished the others are not a first time. Nothing is said while the state is not known.
 */
export const COLD_WORDS = {
  build: "这台电脑还没有下载过游戏的开发文件，要先下载，会慢很多。",
  check: "这台电脑还没有下载过游戏的服务器文件，要先下载。",
  play: "这台电脑还没有下载过游戏本体的文件（几百 MB），要先下载，之后不用再下。",
} satisfies Record<ChainStage, string>
export const WARM_WORDS = { build: "开发文件已经在这台电脑上，不用再下载。", check: "", play: "" } satisfies Record<ChainStage, string>
/**
 * What is said instead of `WARM_WORDS` when the main files are here but not everything a pack asks for is known to be (`getBuildPanel`'s `whole`): only "nothing left to
 * download" is a promise, and it is made only when every file is in place. A code check, for one, leaves the development files in this state: its files are most of them,
 * and the pack still fetches the few it alone resolves.
 */
export const PARTLY_WORDS = { build: "主要的开发文件已经在这台电脑上，个别文件打包时可能还要下一点。", check: "", play: "" } satisfies Record<ChainStage, string>

/**
 * The note under a running stage: what it is doing, and what its downloads cost when they are still to come; nothing once the game is open, when the progress line says so
 * instead. `whole` is whether nothing is left to download for a stage whose files are here; unknown counts as whole.
 */
export const runningNote = (stage: ChainStage, detail: string, ready?: boolean, whole?: boolean, cold?: string) =>
  inGame(stage, detail) ? "" : `${CHAIN_WORDS.running[stage]}${ready === undefined ? "" : ready ? (whole === false ? PARTLY_WORDS[stage] : WARM_WORDS[stage]) : (cold ?? COLD_WORDS[stage])}`

/**
 * How long a stage has been running, once it is long enough to wonder about, and how long that step usually takes (`USUAL_WAITS`, which says where each range comes
 * from). `ready` is whether the step's downloads were on the computer when it began, fixed at that moment: asking again later would compare a first run, which has by
 * now finished downloading, with the quick range. Past the top of the range it says so (比平常久) and stops quoting the range as if it still held; with `ready` unknown it
 * says only the time.
 */
export function stageElapsed(stage: ChainStage, ms: number, detail = "", ready?: boolean) {
  if (!Number.isFinite(ms) || ms < 60_000) return ""
  // Playing is not waiting: once the game is open the time is the person's own.
  if (inGame(stage, detail)) return ""
  // Waiting its turn behind another run is said by the progress line itself; how long a first build takes would not fit.
  if (buildStageWords(detail) === RUNTIME_WAIT_WORDS) return ""
  const minutes = Math.floor(ms / 60_000)
  const head = `已经过了 ${minutes} 分钟。`
  const usual = ready === undefined ? null : usualFor(stage, ready)
  if (!usual || ready === undefined) return head
  if (longerThanUsual(stage, ready, ms)) return `${head}比平常久（一般 ${usualRange(usual)}）。`
  return `${head}一般 ${usualRange(usual)}。`
}

/** The counter a running job last wrote and when it last changed, from the marks kept beside its detail; null when it has none. */
export function jobCounter(checkpoint: unknown, detail = ""): { text: string; at: string | null } | null {
  const marks = checkpoint && typeof checkpoint === "object" && !Array.isArray(checkpoint) ? (checkpoint as Record<string, unknown>) : {}
  if (typeof marks.counter === "string" && marks.counter) return { text: marks.counter, at: typeof marks.counter_at === "string" ? marks.counter_at : null }
  const written = readCounter(detail)
  return written ? { text: written.text, at: null } : null
}

/**
 * Everything a long wait shows under the stage that is running, from the job's own record: the time it has taken, the counter it is at, and, when that
 * counter has stood still for `STALL_MS`, that the step has stopped making progress and what can be done. Only what the job really wrote is used: with no counter
 * there is no number and no percentage, and a step with no counter is never called stuck (a build can be quiet while it compiles).
 */
export function stageWait(input: { stage: ChainStage; state: JobState | undefined; ms: number; detail: string; checkpoint: unknown; ready?: boolean; now: number }) {
  const running = input.state === "running"
  const counter = running ? jobCounter(input.checkpoint, input.detail) : null
  const stalled = counter?.at && counterStalled(counter.at, input.now) ? stalledWords(counter.text, counter.at, input.now) : null
  return { elapsed: stageElapsed(input.stage, input.ms, input.detail, input.ready), counter: counter?.text ?? "", stalled }
}

/** The line of a version in the stage list for a pack that was reused: which one, in the version words. */
export const skippedBuildWords = (version: PackedVersion | null, now?: Date) => (version ? `沿用 ${VERSION_WORDS.version(version, now)}` : CHAIN_WORDS.skipped.build)

/**
 * The newest line of a job's progress that is already written for the person. The service's own lines are
 * Chinese sentences; what Gradle and the game print is English and stays behind 高级. A line counts as the
 * service's when it has Chinese in it and no Latin letter, which no line of either tool's output has.
 */
export function plainProgress(detail: string) {
  // A stage of the build that Gradle named in its own output, said the way the activity log says it (`buildStageWords`).
  return (
    buildStageWords(detail) ??
    detail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /[一-鿿]/.test(line) && !/[A-Za-z]/.test(line))
      .at(-1) ?? ""
  )
}

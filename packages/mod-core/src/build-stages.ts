/** What a run waiting for its turn at the runtime environment says; while it is the newest stage, no "how long it usually takes" is said beside it. */
export const RUNTIME_WAIT_WORDS = "前面还有一个打包、检查或者开着的测试游戏在用运行环境。它结束（游戏要关掉）就自动接着做，不用重新按。"

/**
 * The stages of a build as a person is told them: what a line of the build's output means, in one plain
 * sentence each, in the order a build goes through them. One table for the activity log and for the window
 * that waits on the build. No Node APIs.
 */
export const BUILD_STAGES: readonly (readonly [RegExp, string])[] = [
  [/Assembling a saved project snapshot/, "正在把工程里的东西整理到一起。"],
  // `RUNTIME_WAIT_LINE`: the run is waiting its turn, not stuck. `RUNTIME_TURN_LINE` says when it got its turn.
  [/Waiting for the runtime environment/, RUNTIME_WAIT_WORDS],
  [/Runtime environment free, going on/, "轮到它了，接着做。"],
  [/> Task :compileJava\b/, "正在编译模组的代码。"],
  [/> Task :processResources\b/, "正在装进贴图、模型和声音。"],
  [/> Task :(remapJar|jar)\b/, "正在装成一个模组文件。"],
  [/BUILD SUCCESSFUL/, "编译完成，正在检查做出来的文件。"],
]

/**
 * The stage a stretch of build output has reached: the sentence of the mark that stands last in it, or null
 * when it holds none (keep showing the previous one). By place in the text and not by order in the table,
 * because Gradle may run resources before or after compiling. `stages`: another toolchain's table (`toolchain/*.ts`); Loom's is this file's.
 */
export function buildStageWords(text: string, stages: readonly (readonly [RegExp, string])[] = BUILD_STAGES): string | null {
  return stages.reduce<{ at: number; words: string | null }>(
    (found, [pattern, words]) => {
      const at = Array.from(text.matchAll(new RegExp(pattern.source, "g"))).at(-1)?.index ?? -1
      return at > found.at ? { at, words } : found
    },
    { at: -1, words: null },
  ).words
}

/**
 * A job that failed because the project was saved while it ran (the build was made from one revision, the project is on
 * another) carries this as `checkpoint.reason`. The window decides what to show by this and by the error code the run
 * threw, never by the sentence the person is shown: that sentence is wording and changes. No Node APIs.
 */
export const STALE_BUILD_CODE = "STALE_BUILD_REVISION"
export const STALE_JOB_REASON = "stale"

/** The reason a failed run is stored with, where it is known to be about timing and not about the mod; null when there is none to say. */
export const staleReasonOf = (error: unknown) => (error instanceof Error && error.message === STALE_BUILD_CODE ? STALE_JOB_REASON : null)

/** Whether a job is one that went stale (a failed build or a failed stage that needed the build). */
export const jobWentStale = (job: { state: string; checkpoint: unknown } | null | undefined) =>
  !!job && job.state === "failed" && !!job.checkpoint && typeof job.checkpoint === "object" && !Array.isArray(job.checkpoint) && (job.checkpoint as { reason?: unknown }).reason === STALE_JOB_REASON

import { SCENE_WORDS } from "@minemods/mod-core/scene"
import type { JobState } from "@minemods/mod-core/jobs"
import type { FindingTarget } from "@minemods/mod-core/reconcile"
import { chainStages, chainStep, type ChainFacts, type ChainStage, type ChainStop } from "./play-chain"
import type { SceneInfo } from "./features/test-scene"

/**
 * One press of 「构建并试玩」 on its way: which stage's job is running, how the earlier ones ended, and where it stopped.
 * It belongs to the project it was pressed in (`projectId`), not to the window or to whichever project is shown: the window
 * may show another project, or none of the drawer, by the time a stage ends, and the next stage is still this project's.
 */
export type Chain = {
  projectId: string
  want: ChainFacts["want"]
  running: { stage: ChainStage; jobId: string } | null
  marks: Partial<Record<ChainStage, JobState | "skipped">>
  ended: ChainFacts["ended"]
  /** Where it stands still; "busy" when it could not start because something else was running. Null while it is under way. */
  stop: ChainStop | "busy" | null
  /** The sentence the failed stage's job gave. */
  error: string
  /** Where the failure is put right, when the job named the thing it stopped on: the button beside the sentence. */
  go?: FindingTarget
  /** For a game that crashed: the game's own words and the place, kept for 高级. */
  crash?: string
  /** What the check found, as its job reported it. */
  lines: string[]
  findings: number
  missing: string[]
  /** How many things the AI was still making when the chain stopped for it, or when its pack went stale; 0 otherwise. */
  making: number
  /** The game is (or was) opened on its main menu with no test world set out: the window then says how to see the things by hand. */
  bare?: boolean
  /**
   * The pack (the build job) this press is working from, once it has one: the version every line about the press is said of. It is kept when the project is saved
   * later and there is no pack of the project as it is any more, because the stages still running are working from this one.
   */
  build?: string
  /** For each stage that has started: whether its downloads were already on the computer when it began. Fixed at the start, so "first time" and the usual time are judged against how it began, not how it stands once the downloads have finished. */
  ready?: Partial<Record<ChainStage, boolean>>
  /** For each stage that has started: whether, besides being ready, nothing was left to download (`getBuildPanel`'s `whole`); only said false when it is known not to be. */
  whole?: Partial<Record<ChainStage, boolean>>
  /** For a stage whose first time is another target's than Fabric's: what it downloads, said in place of `COLD_WORDS` (`getBuildPanel`'s `cold`). */
  cold?: Partial<Record<ChainStage, string>>
}

/** What the window gives the chain to work with; nothing here reads which project is on screen. */
export type ChainDeps = {
  /** The scene's record for this project (the licence line, the last check, the missing mods). */
  readScene(projectId: string): Promise<SceneInfo | null>
  /** The id of this project's finished build as it is now, null when there is none. Rejects when the project is gone. */
  latestBuildJobId(projectId: string): Promise<string | null>
  /** How many things the AI is making (or making again) in this project right now. Unknown counts as none: it must not stop a press. */
  readMaking(projectId: string): Promise<number>
  /** Something else is being handled or is still running, so a stage cannot be started now. */
  blocked(): boolean
  /** Starts the stage's job for the project; undefined when it could not be started. */
  start(projectId: string, stage: ChainStage, jobId: string): Promise<{ jobId: string } | undefined>
  /** Whether the downloads each stage needs are already on this computer; null when that cannot be read (nothing is then said about a first time). */
  ready(projectId: string): Promise<(Record<ChainStage, boolean> & { whole?: Partial<Record<ChainStage, boolean>>; cold?: Partial<Record<ChainStage, string>> }) | null>
  /** The sentence the last refusal gave. */
  error(): string
  /** Shows the chain's new state; null drops it. */
  show(chain: Chain | null): void
}

/**
 * Goes on from how the chain stands: decides the next step (`chainStep`) and starts it for `base.projectId`. The project on
 * screen is never consulted — a build that ends while the person is looking at another project goes on to the game all the same.
 * Only a project that is gone (its build cannot be read) drops the chain.
 */
export async function advanceChain(base: Chain, choice: ChainFacts["choice"], deps: ChainDeps): Promise<void> {
  const info = await deps.readScene(base.projectId)
  const latest = await deps.latestBuildJobId(base.projectId).then(
    (id) => ({ id }),
    () => null,
  )
  // The project was deleted meanwhile: nothing more is started for it.
  if (!latest) return deps.show(null)
  // The scene stages refuse with this very sentence when a mod this one needs is not there; the record names which.
  const missing = info?.record?.missing.length && base.error === SCENE_WORDS.missing(info.record.missing) ? info.record.missing : []
  // Only asked while there is no usable pack: that is when the AI's saves would make the pack out of date.
  const making = latest.id ? 0 : await deps.readMaking(base.projectId).catch(() => 0)
  const step = chainStep({
    want: base.want,
    built: !!latest.id,
    eula: !!info?.eula,
    // Only a world the play would open as it is: the one left for this very build (a play of another build deploys afresh and clears it).
    world: !!info?.world && info.record?.build_id === latest.id,
    ended: base.ended,
    scene: base.ended && base.ended.stage !== "build" ? { findings: base.findings, missing } : null,
    making,
    choice,
  })
  // A stage passed over is said as that, so the list never shows one as still waiting after a later one ran.
  const passed = (stage: ChainStage) => ({ build: 0, check: 1, play: 2 })[stage]
  const marks = (reached: number) => Object.fromEntries(chainStages(base.want).map((stage) => [stage, base.marks[stage] ?? (passed(stage) < reached ? "skipped" : undefined)])) as Chain["marks"]
  // Which pack this press works from: the one there is, else the one it already had (a save since has taken "the pack of the project as it is" away, not the pack the stages are using).
  const build = latest.id ?? base.build
  const named = build ? { build } : {}
  if ("stop" in step) return deps.show({ ...base, ...named, running: null, marks: marks(step.stop === "built" || step.stop === "eula" ? 1 : 0), stop: step.stop, missing, making: step.stop === "making" || step.stop === "build_stale" ? making : 0 })
  if (deps.blocked()) return deps.show({ ...base, running: null, stop: "busy" })
  // The scene's game opens on the main menu when there was no check to set a world out (no licence) and no world of this build is left.
  const bare = base.bare || (step.run === "play" && !info?.eula && !(!!info?.world && info.record?.build_id === latest.id))
  // Read before the stage begins, and kept: a first run that downloads what it needs is judged as one even after the files have arrived.
  const ready = await deps.ready(base.projectId).catch(() => null)
  const began = ready
    ? {
        ready: { ...base.ready, [step.run]: ready[step.run] },
        ...(ready.whole?.[step.run] !== undefined ? { whole: { ...base.whole, [step.run]: ready.whole[step.run] } } : {}),
        ...(ready.cold?.[step.run] !== undefined ? { cold: { ...base.cold, [step.run]: ready.cold[step.run] } } : {}),
      }
    : {}
  deps.show({ ...base, ...named, ...began, marks: marks(passed(step.run)), stop: null, ...(bare ? { bare } : {}) })
  const started = await deps.start(base.projectId, step.run, latest.id ?? "")
  const next = { ...base, ...named, ...began, marks: marks(passed(step.run)), stop: null, ...(bare ? { bare } : {}) }
  if (started) return deps.show({ ...next, running: { stage: step.run, jobId: started.jobId }, marks: { ...next.marks, [step.run]: "queued" } })
  // It could not even be started: said like a stage that failed, with the sentence the refusal gave.
  await advanceChain({ ...next, running: null, marks: { ...next.marks, [step.run]: "failed" }, ended: { stage: step.run, state: "failed" }, error: deps.error() }, null, deps)
}

import type { Blueprint } from "./blueprint"
import { currentReview, type RedoRequest, type Review } from "./reviews"
import { blueprintSource } from "./task-source"
import type { VerificationRecord } from "./verification"
import { claimedIdle, type ProjectRun } from "./workspace-runs"

/**
 * Shown to the person as written, and worded for someone who plays the game rather than builds software.
 * This is the one place the words live. `out_of_scope` only ever applies to a blueprint entry that will not be made.
 */
export const ASSET_STATUS_LABELS = {
  planned: "还没做",
  making: "正在做",
  review: "等你验收",
  redo: "要重做",
  saved: "做好了",
  built: "已做进模组",
  // broad1: "游戏里测过了" was read as "someone played it". It means the game itself set it out and answered: no person has played it.
  verified: "游戏自动查过了",
  failed: "没做成",
  out_of_scope: "这次不做",
} as const
export type AssetStatusId = keyof typeof ASSET_STATUS_LABELS

export { KEPT_WORDS } from "./kept-words"

type Check = "passed" | "failed" | "none"
export type AssetStatus = {
  status: AssetStatusId
  /** Why it failed, has to be redone or is not being made; null otherwise. */
  reason: string | null
  /**
   * Present (true) with status "making" when every task still live for it is only queued, or taken by an outside AI that has done nothing with it yet
   * (`claimedIdle`): nothing has started on it (it waits for its turn, or for what it needs to be made first). It is not "being made", and is never said as that.
   * Absent once any of its tasks is running, being checked or saving.
   */
  queued?: true
  /**
   * The separate facts the status was worked out from. None of them implies another.
   * `accepted` is the person's own verdict on the revision that exists now; null when they have not judged it.
   * `asked` says whether they are asked to: see `reviewAsked`.
   */
  facts: { saved: boolean; built: boolean; gametest: Check; client: Check; accepted: boolean | null; asked: boolean }
}

export type AssetStatusInput = {
  blueprint?: Blueprint
  assets: { id: string; revision: number; updated_at?: string }[]
  /** The person's verdicts, any revision. Only one given for the revision an asset has now counts. Absent: acceptance is not looked at. */
  reviews?: Review[]
  /** "Try once more" for entries that failed and were never made. One counts until a run made after it takes the entry up. */
  requests?: RedoRequest[]
  /** Any order; a run that is waiting for an answer or has ended no longer counts as making anything. */
  runs: Pick<ProjectRun, "state" | "created_at" | "tasks">[]
  /** Asset ids whose newest draft is waiting for a decision: it failed the quality gate, or the person reviews each one. */
  review?: string[]
  /** Asset ids whose newest version is an older one the person brought back: theirs to say yes or no to, like a version an AI made. */
  restored?: string[]
  /** The latest build that succeeded, with the `workspace_assets` list from its manifest. */
  build: { id: string; assets: { id: string; revision: number }[] } | null
  /** Ignored unless it was recorded for that same build. */
  verification: VerificationRecord | null
}

const ACTIVE_TASK = ["queued", "running", "validating", "saving"]
const ACTIVE_RUN = ["planning", "running"]

/**
 * Whether a finished task hands the person a version to say yes or no to: every version an AI made is, whether from the plan they confirmed, a change to a thing
 * already saved, or something new made from a sentence of theirs (11-09: the newcomer's usual way in, which was told 「等你验收」 and given no button).
 * One rule for every place that says a version waits for the person, so a line in 动态 and the card of the thing cannot tell two stories.
 */
export const taskAsksForReview = (_task: { source: string; target_id?: string | null }) => true

/**
 * Whether the person is asked to look at this asset and say yes or no. Only for a version an AI made
 * for them (`taskAsksForReview`), or for a thing they have already judged. Run records decide
 * it: the task that made it finished after the asset was last saved, so nothing was changed by hand since.
 * What they made or changed by hand, and everything from before plans existed, is theirs already.
 */
export function reviewAsked(input: {
  asset: { id: string; updated_at?: string }
  reviews: Review[]
  tasks: { asset_id: string; source: string; state: string; finished_at: string | null; target_id?: string | null }[]
}) {
  const judged = input.reviews.some((value) => value.asset_id === input.asset.id)
  return input.tasks.some(
    (task) =>
      task.asset_id === input.asset.id &&
      task.state === "completed" &&
      (task.finished_at ?? "") >= (input.asset.updated_at ?? "") &&
      (judged || taskAsksForReview(task)),
  )
}

/**
 * Status is worked out, never stored, so it cannot claim "built" for something edited since.
 * Order of the checks follows the table in the design: a draft waiting for a decision, being made, sent back by the
 * person, failed, then how far a saved asset got. A caller that passes no `reviews` gets exactly the answers from
 * before acceptance existed.
 */
export function deriveAssetStatus(input: AssetStatusInput) {
  const runs = [...input.runs].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const cases = input.build && input.verification?.build_id === input.build.id ? input.verification.cases : []
  const derive = (assetId: string | null, source: string | null): AssetStatus => {
    const tasks = runs.flatMap((run) =>
      run.tasks.filter((task) => task.asset_id === assetId || task.source === source).map((task) => ({ task, live: ACTIVE_RUN.includes(run.state), created_at: run.created_at })),
    )
    const asset = input.assets.find((value) => value.id === assetId)
    const check = (kind: "gametest" | "client"): Check => {
      const relevant = cases.filter((value) => value.kind === kind && asset && value.asset_ids.includes(asset.id))
      if (!relevant.length) return "none"
      return relevant.every((value) => value.passed) ? "passed" : "failed"
    }
    const review = asset ? currentReview(input.reviews ?? [], asset) : null
    const facts = {
      saved: !!asset,
      built: !!asset && !!input.build?.assets.some((value) => value.id === asset.id && value.revision === asset.revision),
      gametest: check("gametest"),
      client: check("client"),
      accepted: review ? review.verdict === "accepted" : null,
      // A caller that knows nothing of verdicts is never told somebody is waited for.
      asked: !!asset && !!input.reviews && (!!input.restored?.includes(asset.id) || reviewAsked({ asset, reviews: input.reviews, tasks: tasks.map((value) => value.task) })),
    }
    const last = tasks.at(-1)?.task
    const checks = [facts.gametest, facts.client].filter((value) => value !== "none")
    if (assetId && input.review?.includes(assetId)) return { status: "review", reason: null, facts }
    const active = tasks.filter((value) => value.live && ACTIVE_TASK.includes(value.task.state))
    // Queued, or taken by an outside AI that has not touched it yet: neither is being made, and neither is said as that.
    if (active.length) return { status: "making", reason: null, facts, ...(active.every((value) => value.task.state === "queued" || claimedIdle(value.task)) ? { queued: true as const } : {}) }
    // Asked to try a never-made entry once more, and nothing has taken it up yet (an outside AI will, on its next batch).
    const request = asset ? undefined : input.requests?.find((value) => blueprintSource(value.key) === source && !tasks.some((task) => task.created_at >= value.at))
    if (request)
      return {
        status: "redo",
        reason: [request.feedback || "你想让它再做一次。", ...(last?.state === "failed" ? [`上次没有做成：${last.error ?? last.detail}`] : [])].join("\n"),
        facts,
      }
    // The person's "not right" outranks everything but work in progress; a redo that then failed is said in the same breath.
    if (review?.verdict === "rejected")
      return {
        status: "redo",
        reason: [
          review.note || "你觉得它不太对，想让它重做。",
          ...(last?.state === "failed" && (last.finished_at ?? "") >= review.at ? [`上次重做没有做成：${last.error ?? last.detail}`] : []),
        ].join("\n"),
        facts,
      }
    // Once the person accepted the version that exists, a failed try at changing it no longer matters.
    if (!review && (last?.state === "failed" || last?.state === "blocked")) return { status: "failed", reason: last.error ?? last.detail, facts }
    if (!facts.saved) return { status: "planned", reason: null, facts }
    // Being packed into the mod and being accepted by the person are two independent facts. A version that asks for their
    // answer and has none keeps waiting for it whether or not a build has already taken it up; otherwise the build would
    // quietly remove it from "waiting for you" and a summary could claim the person had seen what they never judged.
    // `facts.built` still says it was packed, beside the status.
    if (facts.asked && !review) return { status: "review", reason: null, facts }
    if (!facts.built) return { status: "saved", reason: null, facts }
    // A build with no check recorded for this asset is only built; one failed check keeps it there too.
    return { status: checks.length > 0 && checks.every((value) => value === "passed") ? "verified" : "built", reason: null, facts }
  }
  return {
    assets: Object.fromEntries(input.assets.map((asset) => [asset.id, derive(asset.id, null)])),
    entries: Object.fromEntries(
      (input.blueprint?.entries ?? []).map((entry) => {
        const status = derive(entry.asset_id, blueprintSource(entry.key))
        return [entry.key, entry.out_of_scope ? { ...status, status: "out_of_scope" as const, reason: entry.out_of_scope } : status]
      }),
    ),
  }
}

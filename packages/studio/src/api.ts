import type { SixViewStyle } from "@minemods/studio-ai/making"
import type { AdvancementId } from "./advancements"
import type { Entity, Project } from "@minemods/mod-core/project"
import type { BuildWarning } from "@minemods/mod-core/build-warnings"
import type { Job } from "@minemods/mod-core/jobs"
import type { SceneRecord } from "@minemods/mod-core/scene-run"
import type { Receipt } from "@minemods/mod-core/receipt"
import type { PackedVersion } from "@minemods/mod-core/packed-version"
import type { HandSaveInput, HandSaveResult } from "./main/content-service"
import type { ExternalThreeViewFinishInput, ExternalThreeViewPromptInput } from "./external"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import type { ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import type { MakingTrace } from "./making-trace"
import type { MakingNote, MakingNoteInput } from "./making-notes"
import type { compileModel } from "@minemods/mod-core/model"
import type { Content } from "@minemods/mod-core/content"
import type { Release } from "@minemods/mod-core/release"
/** What a save answers when the project was changed elsewhere since it was read. One sentence for the service that says it and the window that recognises it. */
export const REVISION_CONFLICT = "工程内容已更新，请重新打开工程后再试，已有内容未被覆盖。"
/** Where a deleted project's folder is moved to, beside where it was. Nothing is ever unlinked. */
export const DELETED_FOLDER = "_deleted"
import type { StudioSettings, StudioSettingsInput } from "./settings"
import type { Conception, ConceptionEntry, ConceptionPlan } from "@minemods/mod-core/conception"
import type { ModelProgress } from "./main/model-core-session"
import type { ProjectRun } from "./project-runs"
import type { ModuleKind } from "@minemods/mod-core/workspace"
import type { Blueprint, BlueprintDraft } from "@minemods/mod-core/blueprint"
import type { SpeechInput } from "./speech"
// Idea cards and the activity panel (types only).
import type { IdeaChoice, Ideas } from "@minemods/mod-core/blueprint-ideas"
import type { PlayReport } from "@minemods/mod-core/playable"
import type { ActivityEvent as StoredActivityEvent } from "@minemods/mod-core/activity"
// Data-only gameplay (Engineer C): the mod guide and machine reconciliation (types only).
import type { Finding } from "@minemods/mod-core/reconcile"
import type { GuideSection } from "@minemods/mod-core/guide"
import type { FixFindingsResult } from "./fix-findings"
export type { FixFindingsResult }
/** The mod guide written from the project as saved, and what machine reconciliation found in it. */
export type ModGuideView = { revision: number; title: string; markdown: string; sections: GuideSection[]; findings: Finding[] }
// Gameplay (Engineer D): what the code checks said about a gameplay asset (types only).
import type { ShownGameplay } from "@minemods/mod-core/gameplay-loop"
export type GameplayStory = ShownGameplay
import type {
  PublicConnection,
  SaveConnectionInput,
  TestConnectionInput,
  ConnectionTestResult,
  ListConnectionModelsInput,
} from "./connection"
import type { McpConnectionStatus } from "./mcp-status"
import type { AiClientDetection, AiClientId, ConnectResult } from "./ai-clients"
import type { KeyPageProvider } from "./ai-providers"
import type { ExternalProgress, ExternalRunInput } from "./external"
import type {
  LibraryTask,
  EnvironmentStorage,
  EnvironmentRemoval,
  EnvironmentCleanup,
  ImportedProject,
  ImportedProjectList,
} from "./library"

/** What the AI wrote down before making a thing: every structure and part, said clearly. Free prose in every field. */
export type PartSheet = {
  /** What it is, one sentence. */
  subject: string
  /** The few features that make it read at a glance. */
  recognisable: string[]
  parts: { name: string; what: string; shape: string; attaches: string; surface: string; moves: string; assumed: boolean }[]
  /** Things the person did not say and the AI decided. */
  assumed: string[]
  /** The person's redo remark this sheet answers, if any. */
  remark: string | null
  /** Motions the AI declared are meant not to move (by their name in the document), each with why. Show them with the sheet; keep them when the person saves an edited sheet. Absent in older sheets. */
  still?: { motion: string; reason: string }[]
  /** Blocks and items: measures of the picture the AI declared are meant to lie outside the range of the game's own, each with why. Shown and kept like `still`. Absent in older sheets. */
  differs?: { measure: string; reason: string }[]
  /** Anything else measured that the AI declared is meant to be as it is (`what` names it as the finding did, such as `walk:seam`), each with why. Shown and kept like `still`. Absent in older sheets. */
  justified?: { what: string; reason: string }[]
  /** Engineer H2: models only. The geometry tier the AI asked for (`studio-ai/budget.ts`), why, and how many of the thing it expects the game to show at once. Shown and kept like `still`. Absent: the default tier. */
  budget?: { tier: string; reason: string; at_once: number }
}
/** One version the AI looked at: the pictures it was shown, what it said about them, and what the standard measured. */
export type MakingRound = {
  round: number
  at: string
  /**
   * `url` is a data URL, usable directly as an image source. `label` is in plain words for the person
   * ("六个角度", "只看形状", "走路（walk）· 斜前方"). `from` says who the picture was drawn for: the maker's
   * own look, the set drawn for the reviewer of this version, or something that reviewer asked to see
   * besides. A reviewed round lists the reviewer's set first. Absent in records from before reviews had their own set.
   */
  pictures: { label: string; url: string; from?: "look" | "review" | "asked" }[]
  /** One view of this version alone, for a thumbnail. Absent in older records: show `pictures[0]` whole instead. */
  cover?: string
  /** `problems` are the blocking ones; `advice` is polish and never stood in the way of "done". */
  self_review: { matches: string[]; problems: string[]; advice?: string[]; next: string[]; technical?: string[]; verdict: "revise" | "done" } | null
  /** Plain-words findings of the deterministic standard for this round. */
  findings: string[]
  /** Script modelling: the script this version's document came out of, when it was written as one. For 高级 only; the person never has to read it. */
  script?: string
  /**
   * How much each motion of this version moves, measured from its document. `plain` is the sentence for the
   * person (no numbers); `line` is the same with the numbers, for 高级 only. `unseen`: nothing travels far
   * enough to be seen at game size; `still` is then the sheet's reason when it declares the motion is meant
   * to be still (not a fault), else null. Absent in older records and for things without motions.
   */
  motion?: {
    name: string
    unseen: boolean
    still: string | null
    plain: string
    line: string
    /** How the motion holds together tick by tick: `plain` are sentences for the person (empty when nothing was found), `line` the whole measured sentence for 高级. Absent in older records. */
    held?: { plain: string[]; line: string }
  }[]
  /**
   * What was counted on this version's picture, for a block or an item: `plain` is a sentence or two for the
   * person, `lines` every counted fact with its numbers (for 高级 only), `compared` whether the game's own
   * pictures were there to compare with. Absent for other kinds and in older records.
   */
  texture?: { plain: string[]; lines: string[]; compared: boolean }
  /** Engineer H2: a model's counts against its geometry tier: `plain` a sentence for the person, `line` the same with every limit (for 高级 only). Absent for other kinds and in older records. */
  budget?: { plain: string; line: string }
}
/**
 * A reference image of an overview item. `kind` "user": the person attached it. "concept": an AI drew it
 * of what it meant to make, before modelling (mark it as AI-drawn). `url` is a data URL, usable as an image source.
 */
export type ReferenceImage = {
  style?: SixViewStyle
  id: string
  /**
   * "three_view" (2026-10-08): the thing's 六视图 (three views until the owner made it six; the kind kept its name) — the shape the
   * making AI must follow. One whole sheet (`view` "sheet") or up to six separate views. `by`: the person gave it, or an image model drew it when the person asked.
   */
  kind: "user" | "concept" | "three_view"
  name: string
  url: string
  view?: ThreeViewSlot
  by?: "person" | "ai"
}
/**
 * One picture holding all the views in a fixed grid, or one view. 2026-10-08, the owner: three views are not enough
 * for an AI to understand a shape, so it is six — the same six angles every version is rendered from (front, back, its
 * left, its right, top, three-quarter), so each reference sits beside the render of the same side. "side" is a picture
 * kept from before the six, read as its left side. The kind keeps its stored name "three_view"; the person reads 六视图.
 */
export type ThreeViewSlot = "sheet" | "front" | "back" | "left" | "right" | "top" | "quarter" | "side"
export type ThreeViewResult = { status: "generated" | "provided" | "unsupported"; message: string; references: ReferenceImage[] }
/** How one thing was made by looking: the sheet, every round, and the review by someone who took no part. */
export type Making = {
  item_id: string
  /** The saved asset, or null while the first version is still being made. */
  asset_id: string | null
  sheet: PartSheet | null
  /** Round 10: this thing is looked at and reviewed without a part sheet (a creature with abilities): `sheet` is null on purpose. Absent otherwise. */
  sheetless?: boolean
  rounds: MakingRound[]
  /**
   * `independent` is true for Studio's own reviewer; for an outside AI it is what that client declared and cannot be checked.
   * `findings` are blocking (必须改的) and alone decide `passed`; `advice` (可以更好的) never fails a review.
   * In records from before the two were told apart `advice` is absent and a passing review's `findings` say what was checked.
   * `round` is the version the review was of: it may be earlier than the last round, which was then never reviewed.
   */
  review: {
    independent: boolean
    passed: boolean
    findings: string[]
    advice?: string[]
    /** Round 18: the technical detail behind the two lists, kept under 高级. */
    technical?: string[]
    at: string
    round?: number | null
    /**
     * Round 17, 盲认 (an item's icon, a block's picture): before the reviewer was told what the thing is it was shown the picture alone and said what it is.
     * `words` is the one sentence for the person. `tested: false` is 未盲认: 审查 was off, nobody could be shown it without knowing. `said` / `also` /
     * `because` are the blind answer, `recognised` whether it was the thing; a miss is also the first of `findings`. Absent for other kinds and older records.
     */
    blind?: { tested: boolean; said?: string; also?: string[]; because?: string; recognised?: boolean; fits?: "at_once" | "with_name" | "no"; words: string }
  } | null
  /** "stopped": the task ended without this version being saved (failed, cancelled, or the app closed). */
  state: "describing" | "making" | "reviewing" | "done" | "stopped"
  /** Present while the task is held by an outside AI that has handed in nothing yet: the record exists, but nothing is being written or made. It is waiting, and is said as that. */
  idle?: true
  rounds_allowed: number
  /**
   * How it ended; absent while it runs and in older records. "kept_unsatisfied": the loop ended without a
   * pass (rounds ran out, the last review failed, or the AI stopped) and its best version was saved all the
   * same, for the person to judge: `kept_reason` says in plain lines why the AI was not satisfied, and
   * `kept_round` which round was saved. The item's status is then "review" like any other.
   */
  outcome?: "passed" | "kept_unsatisfied" | "kept_interrupted" | "failed"
  kept_reason?: string[]
  /** Round 18: the technical detail behind `kept_reason`, kept under 高级. */
  kept_technical?: string[]
  kept_round?: number
  /**
   * Why the making stopped short of a pass, when it did; absent in older records. "interrupted" (the app
   * closed or the connection broke) is not a judgement of the work and must never be worded as one:
   * with `outcome` "kept_interrupted" the best version before the interruption was saved for the person.
   * "rounds": versions ran out. "review": the last review allowed failed. "gave_up": its maker stopped. "failed": it broke.
   */
  stopped_reason?: "interrupted" | "rounds" | "review" | "gave_up" | "failed"
  /** Reference images attached to this item, without the pictures: fetch those with `getReferences` when this list changes. Absent in answers from before references existed. */
  references?: { id: string; kind: "user" | "concept" | "three_view"; name: string; view?: ThreeViewSlot }[]
}

// "changed" is not a menu command: main says a run just changed, so the window reads runs now instead of at its next poll.
// "prepared" is not one either: main says the background preparation (提前准备) changed (a step began or ended, a try failed, Java was installed), so the window reads the build panel and the Java line now.
/** A saved version of a thing, numbered from its first. `by` "converted": Studio turned the version before it from the old Yarn names into Mojang's; nobody wrote it. */
export type MakingVersion = { version: number; revision: number; at: string; by: "ai" | "person" | "restored" | "converted"; from: number | null; title: string; document: ModuleDocument; current: boolean }
export type MakingHistoryView = { versions: MakingVersion[]; notes: MakingNote[]; revision: number }

export type StudioCommand = "new" | "open" | "home" | "export" | "settings" | "changed" | "prepared" | "presence" | "trace" | "tools"

export type BuildJarEntry = { jobId: string; name: string; revision: number; finishedAt: string; available: boolean }

/** What `getBuildPanel` answers. */
export type BuildPanel = {
  javaProblem?: string
  latest: PackedVersion | null
  used: PackedVersion | null
  /** How many saved things a pack made now would leave out (design text, kinds no build compiles, a texture no creature wears): the build's own list, not the `status` they were saved with (`unbuiltThings`). */
  drafts: number
  ready: { build: boolean; check: boolean; play: boolean }
  /** Whether what is ready is all of it: the development files only after a pack's own tasks have run, the game's files with the two mods every scene starts with. `ready` says the main files are here, this says nothing is left to fetch. */
  whole?: { build: boolean; play: boolean }
  /** For a Forge or NeoForge project: what a first check and a first opening of that target download, said instead of the Fabric scene's words while that stage runs. */
  cold?: { check: string; play: string }
  /** Studio is fetching the game's files in the background right now (提前准备); absent when it is not. */
  preparing?: boolean
  /** While it is: which step, and the newest count that step wrote (「游戏的运行库：12 / 54」). */
  prepareStep?: "development" | "server" | "client"
  prepareCounter?: string
  /** The last background try did not succeed: which step (null when it was not in one), why in plain words, and when it is tried again by itself (ISO time). */
  prepareFailed?: { step: "development" | "server" | "client" | null; why: string; retryAt: string }
  /** 补字 (E19): the characters of the names and books the game's fonts cannot draw, and what a pack made now does with them; absent when there are none. */
  glyphs?: { filled: { char: string; family: string }[]; missing: string[]; off: boolean }
}

export type StudioView = {
  directory: string
  project: Project
  model: ModelDesign | null
  model_origin: string | null
  latest_build_job_id: string | null
  latest_build_warnings: BuildWarning[]
  /** Repairs applied to this legacy project during the current Studio session. */
  open_notice?: string
  preview: {
    geometry: ReturnType<typeof compileModel>["geometry"]
    textureDataUrl: string
    animation?: ReturnType<typeof compileModel>["animation"]
  } | null
  entity_id?: string | null
  blockbench?: Record<string, unknown> | null
}

/**
 * How far one piece of content has got. `blocked` means it cannot start because something it needs
 * failed; `out_of_scope` means the plan lists it but it will not be made (see `out_of_scope` for why).
 * `review` (等你验收): an AI made this version, nobody has said yes or no to it, and nothing further has
 * happened to it. It only ever stands in for `saved`: once the thing is in a build the status is `built` or
 * `verified` and `facts.accepted` stays null beside it. Acceptance is the person's record, never a gate.
 * `redo` (要重做): the person sent this version back and it has not been remade yet, or asked for one more
 * try at a plan entry that failed (then `facts.saved` is false). `reason` carries their words, and on a
 * second line what went wrong if the redo itself failed. It outranks `failed`, `saved`, `built` and `verified`.
 * `making` outranks everything; `status_label` is the wording for all of them and is set in one place.
 */
export type OverviewStatus = "planned" | "making" | "review" | "redo" | "saved" | "built" | "verified" | "failed" | "blocked" | "out_of_scope"

/** One tile of the asset overview: a blueprint entry, a saved asset, or content from before assets existed. */
export type OverviewItem = {
  /**
   * Stable for as long as the thing exists: the blueprint key if it has one, else the asset id, else
   * `kind:id` for content saved before assets existed. `needs`, `used_by`, `owner` and `problems[].item` use these ids.
   */
  id: string
  /** Blueprint entry key, or null when no entry stands for this. */
  key: string | null
  /** The saved asset, or null when it has not been made yet (or predates assets). */
  asset_id: string | null
  /** One of `ProjectOverview.kinds[].id`. */
  kind: ModuleKind
  title: string
  /** What it is meant to be: the entry's brief, or what the asset was made from. May be empty. */
  brief: string
  /** Id of the content item it belongs to (a model belongs to its creature); null for content itself and for loose assets. */
  owner: string | null
  status: OverviewStatus
  /** `status` in words for the person, e.g. "做好了". Show this; do not translate `status` yourself. */
  status_label: string
  /**
   * Present when `status` is "making" only because a task for it is queued: nothing has started on it. `status_label` then reads 「在排队」, never
   * 「正在做」. `waiting_for` are the titles of what it needs that is not made yet (empty: it is next in line, or waits for a free place).
   */
  queued?: { waiting_for: string[] }
  /** Why it failed, is blocked, has to be redone (the person's own words), or is not being made; null otherwise. */
  reason: string | null
  /**
   * The separate facts behind `status`; none implies another. `gametest` and `client` are null until a
   * check was really recorded for the latest build, then true (all passed) or false (one failed).
   * `accepted` is the person's own verdict on the revision that exists now: true (可以), false (不太对),
   * null when nobody has judged this revision. A verdict given for an earlier revision no longer counts.
   */
  facts: { saved: boolean; built: boolean; gametest: boolean | null; client: boolean | null; accepted: boolean | null }
  /**
   * Whether the person is asked to judge this thing. True only when all of these hold: it is saved; the
   * version on disk was made by an AI (a hand edit makes it the person's own); and either it was made
   * from an entry of the confirmed plan, or it is a change to a thing already saved (`taskAsksForReview`),
   * or the person has judged or asked to redo it before. Everything
   * else — hand-made things, content from before plans existed, old projects — is never asked about, so
   * `status` goes straight to saved/built/verified. The person may still judge those with `reviewAsset`.
   * Acceptance is the person's own check-off: it never holds up production, building or testing.
   */
  review_asked: boolean
  /**
   * Models only: the 模型精细度 (低/中/高) this model's last task was made by, the button it started with raised by the creature's tier. Show it only where `level` differs
   * from the button at the top, so the top label never seems to be ignored. Absent for other kinds and for a task with no button recorded.
   */
  detail?: { level: "low" | "medium" | "high"; label: string }
  /** The saved version was kept although its AI was not satisfied (see `Making.outcome`), and the person has not judged it yet. Show a small "AI 还不满意" mark. */
  ai_unsatisfied?: boolean
  /** The saved version was kept because its making was cut short (`Making.outcome` "kept_interrupted"), and the person has not judged it yet. Show 「被中断了」, never "AI 还不满意". */
  ai_interrupted?: boolean
  /**
   * What the person said about the revision that exists now, or null when they have not judged it (a
   * verdict for an earlier revision is not reported). `note` is their remark, empty when they gave none.
   */
  review: { verdict: "accepted" | "rejected"; note: string; at: string } | null
  /**
   * Where the documents to draw this item from are found, so the screen never has to guess. Pointers only.
   * - `source`: "asset" — its own document is `project.workspace.assets[asset_id].document`; "content" — it
   *   predates assets and its record is in `project.entities/blocks/items/recipes/logic` under the id after
   *   the colon of `id`; null — not made yet, nothing to draw.
   * - `model_asset_id`: the workspace model to show it on (itself for a model; the model a texture or
   *   animation was made for; the model a creature or a behaviour rule uses), or null.
   * - `texture_asset_id`: the workspace texture that model wears (itself for a texture), or null for the
   *   model's built-in colours.
   * - `entity_id`: pass to `getEntityPreview` for the compiled shape and UV layout; set whenever a saved
   *   model file exists, including for a creature whose model has no workspace document. Null: only the
   *   model document itself can be drawn, untextured.
   */
  preview: { source: "asset" | "content" | null; model_asset_id: string | null; texture_asset_id: string | null; entity_id: string | null }
  /** Ids of the items this one uses. */
  needs: string[]
  /** Ids of the items that use this one. */
  used_by: string[]
  /** Set when the plan lists it but it cannot be made: the reason, in plain words. */
  out_of_scope: string | null
  /** The asset's revision; null when there is no asset. */
  revision: number | null
  /**
   * Set exactly when the version on disk is an AI's hand-in: the task that made it finished after the
   * asset was last saved, so no hand has changed it since. It is what the acceptance standard was told at
   * that hand-in: the person's own words (`asked`), those plus the task's text (`brief`), whether a tier was
   * chosen (`insisted`) and which (`complexity`). Pass it as the context of `reviewAsset` from
   * `@minemods/mod-core/acceptance`, adding `against`, and the 「质量检查」 block shows the very review that
   * decided the hand-in. Absent: a person made this version or changed it by hand (or its run record is
   * gone), and a person's own work is never judged, so there is nothing to show.
   */
  judged?: { brief: string; asked: string; insisted: boolean; complexity?: "low" | "medium" | "high" }
}

/** Everything the asset overview screen shows, worked out in one call. Poll it while `production.running`. */
export type ProjectOverview = {
  build_failure?: { jobId: string; reason: string; detail?: string | undefined } | null
  /** 「能不能玩」: every thing with its answers to the four questions, and what is still open (see `@minemods/mod-core/playable`). Absent from a host older than the standard. */
  playable?: PlayReport
  /** The plan's header, or null for a project without one. Its entries are in `items`; `getBlueprint` returns the editable plan. */
  blueprint: {
    revision: number
    /** Nothing is made from a draft. Only `confirmBlueprint` turns it into "confirmed". */
    state: "draft" | "confirmed"
    /** The person's own sentence. */
    request: string
    style: { palette: string[]; shape: string; naming: string; world: string }
    /** What the planner wants answered before the person confirms. */
    questions: string[]
  } | null
  /**
   * The newest plan an AI handed in that Studio refused, null when none stands. A refused plan is not stored, so with nothing stored `blueprint` is null and
   * this is all there is to show where the plan should be. `constraint` is the requirement it is about as it stands now; `settled`: the person changed their
   * requirements after the refusal, so its reason may no longer hold. Cleared when a plan is stored.
   */
  plan_refusal: {
    at: string
    by: "studio" | "outside"
    /** The reason in words for the person; lines are separated by newlines. */
    why: string
    about: "requirement" | "playable" | "rule"
    constraint: { id: string; text: string; lifted: boolean; reworded_into: string | null; /** Whether it is on the person's list: false when the refused plan was the first to carry it and nothing was stored. */ recorded: boolean } | null
    /** What the refused plan would have made, by title. */
    titles: string[]
    /** The revision of the stored plan it would have replaced; null when nothing was stored. */
    against: number | null
    settled: boolean
  } | null
  /** 「审查」 as the person has it switched now: on, a finished version is read by another AI before it reaches the person. Absent from a host older than this field. */
  review_on?: boolean
  /**
   * Finished versions of an outside AI that wait for a reviewing window, and whether one is there. Absent when nothing waits (or 「审查」 is off).
   * `reviewer`: "never" (no reviewing window has asked for anything), "silent" (one did, but not lately), "present", "reading" (one is at a version now).
   * `offer`: the page offers to open the reviewer or to go without one, which is when nobody is there ("never", "silent").
   */
  review_wait?: {
    waiting: { asset_id: string; title: string; since: string }[]
    reviewer: "never" | "silent" | "present" | "reading"
    offer: boolean
  }
  /**
   * An outside AI that waits for the person's decision on the blueprint (`await_blueprint_decision`). "waiting": a wait call is pending now or ended lately, so the AI
   * starts by itself once the person confirms. "told": it was handed the confirmation a moment ago and is starting. "none": no wait call seen lately, the person has to tell the AI.
   * Absent when no wait call was ever seen in this run of Studio.
   */
  blueprint_wait?: { ai: "waiting" | "told" | "none" }
  /**
   * Whether a reviewing window is really connected, apart from whether 「审查」 is switched on (broad20): "never" (none has asked for anything since Studio started),
   * "silent" (one did, but not lately), "present", "reading" (one is at a version now). Absent when 「审查」 is off. Only an outside AI has a window to connect.
   */
  review_window?: "never" | "silent" | "present" | "reading"
  production: {
    /** Content is being made right now, by Studio or by an outside AI. */
    running: boolean
    /** Counts over `items`, leaving out what will not be made. `saved` includes built and verified ones. */
    total: number
    saved: number
    built: number
    verified: number
    /** Everything with a task live right now, first time or again, queued ones included. What is really being made is `making - queued`. */
    making: number
    /** Of `making`, the ones nothing has started on: they wait for their turn or for what they need to be made first. */
    queued: number
    /** Of `queued`, the ones that already have a saved version (waiting to be made again). */
    queued_again: number
    /** Saved things being made again right now: counted in `saved`, but not done. */
    remaking: number
    /** Saved things kept although their AI (or its reviewer) was not satisfied; not counted in `done`. Disjoint from `remaking`. */
    unsatisfied: number
    /** Saved things kept because their making was cut short; not counted in `done`. Disjoint from `remaking` and `unsatisfied`. */
    interrupted: number
    /** Saved things that are done: not being made again and not kept without a pass. The number every "已做好" shows. */
    done: number
    failed: number
    blocked: number
    /** Saved things the person said yes to, as they are now. */
    accepted: number
    /** Things waiting for the person to look at them, packed into the mod or not: exactly the items whose `status` is "review". */
    to_review: number
    /** Things the person asked to have made again that have not been yet: exactly the items whose `status` is "redo". */
    to_redo: number
    /** Titles being made at this moment. */
    current: string[]
    /** Why production stopped by itself, if it did; null otherwise. */
    note: string | null
  }
  /** The asset registry, for tabs and labels: "by section" groups by `group`, "by content" roots at kinds with `owner`. */
  kinds: {
    id: ModuleKind
    label: string
    group: { id: string; label: string }
    /** Icon name in the Studio icon set. */
    glyph: string
    /** Content the player meets in the game (creature, block, item): a root of the "by content" view. */
    owner: boolean
    /** "runtime" goes into the built mod; "design" is only ever a saved draft for this project's target. */
    capability: "runtime" | "design"
  }[]
  items: OverviewItem[]
  /**
   * Things worth the person's attention. `missing_reference`: it points at something that is gone, or lacks
   * something it must have. `unused`: a model or texture nothing uses. `blocked`: waiting behind a failed item.
   * `stale`: something it uses was sent back and remade after this item was last saved, so it may no longer
   * fit (a texture painted for a model whose shape changed). Nothing is remade automatically; the entry goes
   * away when this item is remade or the person accepts it as it is. One entry per remade thing it uses.
   */
  problems: { item: string; kind: "missing_reference" | "unused" | "blocked" | "stale"; message: string }[]
}

/**
 * One node of the activity panel. `item` is an `OverviewItem.id` (null: about the whole project); `text` is one
 * plain sentence and `lines` a few more; `detail`, `tool` and `ms` are for 高级 only. `step` events say what is
 * being done right now (show the newest per item as its live line); `quiet` ones repeat what another event
 * already says and belong under 高级; `end` closes the thing with `mark` as its outcome. `round` is the round of
 * the making story to open. `thumb` is a picture the making loop already keeps, as a data URL; only the newest
 * few events of a read carry one.
 */
export type ActivityEvent = Omit<StoredActivityEvent, "picture" | "key"> & { thumb?: string }
/** What `getActivity` returns. Poll it with `after: last` while the project page is open. */
export type Activity = {
  /** Oldest first; at most 400 per read. */
  events: ActivityEvent[]
  /** The newest `seq` in the log, 0 when it is empty. */
  last: number
  /** The main process's clock, so "how long ago" does not depend on the screen's. */
  now: string
  /** When anything in this project last gave a sign of life (an event, text arriving from a model, a tool call); null when unknown. */
  alive_at: string | null
  /** Something is being planned or made right now, by Studio or an outside AI. With an old `alive_at` this is "no sign of life for a while". */
  running: boolean
}
export type { Ideas, IdeaChoice }

/**
 * 验收回执 (`getReceipt`): what Studio measured, refused and verified for one project, as plain facts from the records it keeps.
 * `things` are the overview's items by id (the renderer draws their pictures from the overview it already holds); `made` counts the
 * versions looked at over all of them; `caught` is newest first, cut to 30 (`caught_total` is how many there were), each line about
 * `item`'s version `round` with `fixed` saying whether a later version or a saved one no longer has it; `reviewed` is the other AI's
 * verdicts (`blind` is what it said of the picture alone); `game` is the background scene check, null when there is none;
 * `unverified` are saved things nobody has fully verified, with the reason. Defined beside its assembly in mod-core.
 */
export type { Receipt }

/** What uses one piece of content. Ask before deleting it. */
export type AssetUsage = {
  /** `OverviewItem.id` of the thing asked about. */
  item: string
  title: string
  used_by: { id: string; kind: ModuleKind; title: string; status: OverviewStatus }[]
  /** Ready to show in a confirmation: who uses it, or that nothing does. */
  message: string
}

/** What the tools page shows. */
export type ToolsView = {
  tools: {
    id: string
    title: string
    description: string
    role: string
    medium: string
    builtin: boolean
    state: "ready" | "unapproved" | "disabled" | "invalid" | "missing_program" | "missing_secret"
    problem: string | null
    sha256: string | null
    /** What it runs or reaches, for the person to look at before turning it on: a program and its arguments, an address, an MCP server. */
    runs: string | null
    secrets: string[]
  }[]
  programs: { id: string; title: string; license: string; path: string | null; own: boolean; /** Nothing chosen on this page: a copy found on the machine (PATH, WinGet, scoop). */ auto?: boolean }[]
  secrets: string[]
  folder: string
}

export type StudioApi = {
  getImportAssetSelection(input: {
    id: string
  }): Promise<Awaited<ReturnType<typeof import("@minemods/mod-core/import-assets").getImportAssetSelection>>>
  extractImportAssets(input: {
    id: string
    groupIds: string[]
  }): Promise<import("@minemods/mod-core/import-assets").ImportedAssetCatalog>
  getImportedAssetCatalog(input: {
    id: string
  }): Promise<import("@minemods/mod-core/import-assets").ImportedAssetCatalog | null>
  getImportAssetGraph(input: {
    id: string
  }): Promise<import("@minemods/mod-core/import-asset-graph").ImportedAssetGraph>
  buildImportAssetGraph(input: {
    id: string
  }): Promise<import("@minemods/mod-core/import-asset-graph").ImportedAssetGraph>
  prepareImportAssetGraphAnalysis(input: {
    id: string
    nodeIds?: string[]
  }): Promise<ReturnType<typeof import("./main/import-asset-graph-ai").prepareImportAssetGraphAnalysis>>
  startImportAssetGraphAnalysis(input: {
    id: string
    nodeIds?: string[]
  }): Promise<import("./main/import-asset-graph-service").ImportAssetGraphAnalysisRun>
  getImportAssetGraphAnalysis(input: {
    id: string
  }): Promise<import("./main/import-asset-graph-service").ImportAssetGraphAnalysisRun | null>
  submitImportAssetGraphAnalysis(input: {
    id: string
    contextId: string
    result: unknown
  }): Promise<import("./main/import-asset-graph-service").ImportAssetGraphAnalysisRun>
  cancelImportAssetGraphAnalysis(input: {
    id: string
  }): Promise<import("./main/import-asset-graph-service").ImportAssetGraphAnalysisRun | null>
  readImportedAssetFile(input: {
    id: string
    assetId: string
  }): Promise<Awaited<ReturnType<typeof import("@minemods/mod-core/import-assets").readImportedAssetFile>>>
  previewImportedAsset(input: {
    id: string
    assetId: string
    texturePath?: string
  }): Promise<import("@minemods/mod-core/imported-model").ImportedModelPreview>
  /** Every creature an imported mod adds, with whether a picture of it can be shown. */
  listImportedEntities(input: { id: string }): Promise<
    {
      /** "namespace:id" */
      entity: string
      kind: "java" | "asset" | "none"
      /** A living thing with drops or a spawn egg, as opposed to arrows and other helper entities. */
      creature: boolean
      partial: boolean
      hasTexture: boolean
      matchedByName: boolean
      /** Not a living thing: an arrow, a bolt, a thrown block. */
      helper: boolean
      note: string | null
    }[]
  >
  /** The picture of a vanilla item or block, read from the game installed on this computer; null when there is none. */
  readImportedGameIcon(input: {
    id: string
    /** "namespace:id" */
    item: string
  }): Promise<{ mime: "image/png"; base64: string } | null>
  /** The model and texture of one creature of an imported mod. Models written in Java are read, never run. */
  previewImportedEntity(input: {
    id: string
    entity: string
  }): Promise<import("@minemods/mod-core/imported-model").ImportedModelPreview>
  saveImportedAssetFile(input: {
    id: string
    assetId: string
    expectedSha256: string
    content: string
  }): Promise<import("@minemods/mod-core/import-assets").ImportedAssetCatalog>
  exportImportedAssets(input: { id: string }): Promise<{ path: string } | null>
  prepareReverseProject(input: { id: string }): Promise<import("./main/reverse-service").ReverseOperation>
  getReverseState(input: { id: string }): Promise<import("./main/reverse-service").ReverseState>
  listReverseFiles(input: {
    id: string
    prefix?: string
  }): Promise<Awaited<ReturnType<typeof import("@minemods/mod-core/reverse-project").listReverseFiles>>>
  readReverseFile(input: {
    id: string
    path: string
  }): Promise<Awaited<ReturnType<typeof import("@minemods/mod-core/reverse-project").readReverseFile>>>
  editReverseFiles(input: {
    id: string
    changes: import("zod").z.infer<typeof import("@minemods/mod-core/reverse-project").ReverseChangeSchema>[]
  }): Promise<unknown>
  startReverseAnalysis(input: {
    id: string
    prompt?: string
  }): Promise<import("./main/reverse-service").ReverseModelRun>
  applyReversePlan(input: { id: string; runId: string }): Promise<import("./main/reverse-service").ReverseModelRun>
  cancelReverseOperation(input: {
    id: string
    operationId: string
  }): Promise<import("./main/reverse-service").ReverseState>
  buildReverseModule(input: {
    id: string
    moduleId: string
  }): Promise<import("./main/reverse-service").ReverseOperation>
  chooseReverseDependencies(input: {
    id: string
    moduleId: string
  }): Promise<import("./main/reverse-service").ReverseOperation | null>
  exportReverseProject(input: {
    id: string
    kind: "archive" | "project"
  }): Promise<Awaited<ReturnType<typeof import("@minemods/mod-core/reverse-project").exportReverseProject>> | null>
  startImportAnalysis(input: {
    id: string
    prompt?: string
  }): Promise<import("./main/import-analysis-service").ImportAnalysisRun>
  listImportAnalysisRuns(input: { id: string }): Promise<import("./main/import-analysis-service").ImportAnalysisRun[]>
  getImportAnalysisRun(input: {
    id: string
    runId: string
  }): Promise<import("./main/import-analysis-service").ImportAnalysisRun>
  cancelImportAnalysis(input: {
    id: string
    runId: string
  }): Promise<import("./main/import-analysis-service").ImportAnalysisRun>
  applyImportedPlan(input: {
    id: string
    runId: string
  }): Promise<import("./main/import-analysis-service").ImportAnalysisRun>
  exportModifiedImport(input: {
    id: string
    runId: string
    kind: "archive" | "project"
  }): Promise<{ path: string } | null>
  /** 2026-10-08 新建工程的配置和运行环境: the game targets, the Java found on this computer, its install, and a project's pre-installed mods. */
  getTargets(): Promise<{ targets: GameTarget[]; chosen: string }>
  detectJava(input: { major: number }): Promise<JavaReport>
  /** `home`: a Java the person picked from the found list; null goes back to automatic. */
  chooseJava(input: { home: string | null; major: number }): Promise<JavaReport>
  planJavaInstall(input: { major: number; directory?: string }): Promise<JavaInstallPlan>
  /** Opens a folder dialog; null when the person cancels. */
  chooseJavaDirectory(input: { major: number }): Promise<JavaInstallPlan | null>
  /** Runs in the background as a library task; `directory` is the root the JDK folder goes under (null = default). */
  installJava(input: { major: number; directory?: string | null }): Promise<LibraryTask>
  listPreinstalledMods(input: { projectId: string }): Promise<{ mods: PreinstalledMod[]; folder: string }>
  searchMods(input: { query: string; targetId: string; offset?: number }): Promise<ModSearch>
  addModrinthMod(input: { projectId: string; modrinthId: string }): Promise<ModsAdded>
  /** Opens a file dialog for jars; returns tokens that addModFiles takes. */
  chooseModFiles(): Promise<{ token: string; name: string }[]>
  addModFiles(input: { projectId: string; tokens: string[] }): Promise<ModsAdded>
  removePreinstalledMod(input: { projectId: string; file: string }): Promise<{ mods: PreinstalledMod[] }>
  listEnvironmentStorage(): Promise<EnvironmentStorage>
  prepareEnvironment(input: { profileId: "fabric-1.21.1" }): Promise<LibraryTask>
  removeEnvironment(input: { id: string; confirmReferenced?: boolean }): Promise<EnvironmentRemoval>
  /** 「清理没用的」: removes every downloaded thing no target or project needs; refused while anything is running. */
  cleanUnusedEnvironment(): Promise<EnvironmentCleanup>
  /** 工具资产: every tool Studio knows, what each needs, the programs it looks after and the names (never the values) of the keys saved. */
  listTools(): Promise<ToolsView>
  /** The person turned a new or changed tool on, having seen this tool.json (its sha256). */
  approveTool(input: { id: string; sha256: string }): Promise<void>
  setToolEnabled(input: { id: string; enabled: boolean }): Promise<void>
  /** Saves (encrypted) or, with an empty value, removes a key a tool asks for. */
  saveToolSecret(input: { name: string; value: string }): Promise<void>
  /** Downloads a program Studio looks after (held to its release's sha256). */
  installProgram(input: { id: "ffmpeg" }): Promise<{ path: string }>
  /** Opens a file dialog for the person's own copy; null when they cancel. */
  chooseOwnProgram(input: { id: "ffmpeg" }): Promise<{ path: string } | null>
  /** A sound file the person brought in, turned into the game's sound and saved as a sound asset of the project. */
  changeSoundMoment(input:{projectId:string;expectedRevision:number;entityId:string;key:string;soundId?:string;vanilla?:string}):Promise<StudioView>
  vanillaAudio(input:{projectId:string;event:string;probe?:boolean}):Promise<string|null>
  renameAsset(input:{projectId:string;expectedRevision:number;assetId:string;title:string;creature?:true}):Promise<StudioView>
  duplicateAsset(input:{projectId:string;expectedRevision:number;assetId:string}):Promise<{view:StudioView;assetId:string}>
  deleteAsset(input:{projectId:string;expectedRevision:number;assetId:string;creature?:true}):Promise<{view:StudioView;deletion:string;used_by:[]} | {view:StudioView;deletion:null;used_by:AssetUsage["used_by"];message:string}>
  restoreDeleted(input:{projectId:string;expectedRevision:number;deletion:string}):Promise<{view:StudioView;assetId:string}>
  listAudioInbox(input: { projectId: string }): Promise<{folder: string; files: string[]}>
  extractAbility(input: import("zod").z.infer<typeof import("./ability-requests").ExtractAbilityInput>): Promise<{ assetId: string; view: StudioView }>
  /** 从别的工程导入: the other projects and what can be picked in each; the list of what an import would bring (nothing written); the import itself; taking it back out. */
  projectImportSources(input: { projectId: string }): Promise<ProjectImportSource[]>
  /** r29c: a project folder anywhere on disk, by its full path, read where it is; and the same chosen in the system's folder picker (null: nothing chosen). */
  projectImportSourceAt(input: import("zod").z.infer<typeof import("./project-import-requests").ProjectImportFolderInput>): Promise<ProjectImportSource>
  chooseProjectImportFolder(input: { projectId: string }): Promise<ProjectImportSource | null>
  previewProjectImport(input: import("zod").z.infer<typeof import("./project-import-requests").ProjectImportPreviewInput>): Promise<import("@minemods/mod-core/project-import").ImportPlan>
  applyProjectImport(input: import("zod").z.infer<typeof import("./project-import-requests").ProjectImportApplyInput>): Promise<{ view: StudioView; plan: import("@minemods/mod-core/project-import").ImportPlan; importId: string }>
  undoProjectImport(input: import("zod").z.infer<typeof import("./project-import-requests").ProjectImportUndoInput>): Promise<{ view: StudioView }>
  /** r29b 合并重复件: the renamed copies earlier imports left beside what they copy; merging the ones chosen; taking a merge back. */
  listDuplicateAssets(input: import("zod").z.infer<typeof import("./project-import-requests").AssetMergeListInput>): Promise<import("@minemods/mod-core/project-import").DuplicatePair[]>
  mergeDuplicateAssets(input: import("zod").z.infer<typeof import("./project-import-requests").AssetMergeInput>): Promise<{ view: StudioView; mergeId: string; pairs: import("@minemods/mod-core/project-import").DuplicatePair[] }>
  undoAssetMerge(input: import("zod").z.infer<typeof import("./project-import-requests").AssetMergeUndoInput>): Promise<{ view: StudioView }>
  importAudioInbox(input: import("./audio-requests").AudioTargetInput & {filename: string}): Promise<{assetId: string; seconds: number; cut: boolean; view: StudioView}>
  uploadAudio(input: import("./audio-requests").AudioTargetInput & {data: string}): Promise<{assetId: string; seconds: number; cut: boolean; view: StudioView}>
  removeAudio(input: import("./audio-requests").AudioTargetInput): Promise<StudioView>
  saveSoundSettings(input: import("./audio-requests").SoundSettingsInput): Promise<StudioView>
  readMusicPart(input: {projectId:string;assetId:string;part:import("@minemods/mod-core/music").MusicPart}): Promise<string>
  importSound(input: { projectId: string; name: string; data: string }): Promise<{ asset_id: string; name: string; seconds: number; added_file: boolean; view: StudioView }>
  chooseImportSource(): Promise<LibraryTask | null>
  getLibraryTask(input: { id: string }): Promise<LibraryTask>
  listLibraryTasks(): Promise<LibraryTask[]>
  cancelLibraryTask(input: { id: string }): Promise<LibraryTask>
  listImportedProjects(): Promise<ImportedProjectList>
  listImportedProjectIssues(): Promise<import("@minemods/mod-core/import-project").ImportProjectIssue[]>
  getImportedProject(input: { id: string }): Promise<ImportedProject>
  deleteImportedProject(input: { id: string }): Promise<void>
  clearImportedCache(input: { id: string }): Promise<void>
  exportImportedReport(input: { id: string }): Promise<{ path: string } | null>
  getConnection(): Promise<PublicConnection>
  saveConnection(input: SaveConnectionInput): Promise<PublicConnection>
  /** 「这次不另请审查，让做的 AI 自己检查」: switches 「审查」 off from now on (the connection's own switch), also while an outside AI is at work. */
  turnOffReview(): Promise<PublicConnection>
  testConnection(input: TestConnectionInput): Promise<ConnectionTestResult>
  listConnectionModels(input: ListConnectionModelsInput): Promise<string[]>
  getMcpStatus(): Promise<McpConnectionStatus>
  copyMcpConfig(): Promise<void>
  /** Put plain text on the clipboard; works whether or not the window has focus. */
  copyText(input: { text: string }): Promise<void>
  /** `role`: with 「审查」 on, the hand-off for the AI that makes (the default) or the one for the AI that reviews. */
  getMcpHandoff(input?: { projectId?: string; role?: "maker" | "reviewer" }): Promise<string>
  copyMcpHandoff(input?: { projectId?: string; role?: "maker" | "reviewer"; request?: string; ifNoPlan?: boolean }): Promise<void>
  /** 一键接上: which AI assistants (Claude 桌面版, Codex) are on this computer and whether Studio is already in their settings. Reads only. */
  detectAiClients(): Promise<AiClientDetection>
  /** Put Studio into that assistant's settings (a copy of the file is kept beside it first). Called only by the person's button press. */
  connectAiClient(input: { client: AiClientId }): Promise<ConnectResult>
  /** Open that assistant's download page in the browser. */
  openAiClientDownload(input: { client: AiClientId }): Promise<void>
  /** Open the page where a ready-made AI service (DeepSeek) gives out keys, in the browser. */
  openProviderKeyPage(input: { provider: KeyPageProvider }): Promise<void>
  getExternalProgress(input: ExternalRunInput): Promise<ExternalProgress>
  listProjects(): Promise<{ directory: string; project: Project }[]>
  createProject(input: {
    name: string
    description: string
    modId?: string
    empty?: boolean
    profileId?: "fabric-1.21.1"
    javaMajor?: 21
    minecraft?: "1.21.1"
    loader?: "fabric"
    loaderVersion?: "0.17.2"
    locationToken?: string
    /** A target from getTargets; only a ready one is accepted. Absent = the default target. */
    targetId?: string
  }): Promise<StudioView>
  openProject(projectId: string): Promise<StudioView>
  chooseExistingProject(): Promise<StudioView | null>
  onCommand(listener: (command: StudioCommand) => void): () => void
  startProjectRun(input: {
    projectId: string
    expectedRevision: number
    prompt: string
    module?: ModuleKind
    assetId?: string
  }): Promise<ProjectRun>
  listProjectRuns(input: { projectId: string }): Promise<ProjectRun[]>
  getProjectRun(input: { projectId: string; runId: string }): Promise<ProjectRun>
  cancelProjectRun(input: { projectId: string; runId: string }): Promise<ProjectRun>
  /**
   * Turn one sentence into a draft blueprint with Studio's own AI. Returns at once; follow the job with
   * `getJob` (cancel with `cancelJob`) and read the result with `getBlueprint` once it is "completed".
   * A failed job's `error` is already worded for the person.
   * With `ideas` (the `Ideas.revision` on screen, in state "ready") the plan is drawn from the summary the
   * person approved and `request` is ignored. Either way the person's requirements are locked: a plan that
   * breaks one they have not given up fails the job with a message that names the requirement.
   */
  draftBlueprint(input: { projectId: string; request: string; ideas?: number }): Promise<{ jobId: string }>
  /**
   * Turn one sentence into idea cards with Studio's own AI: groups the AI chose from the sentence, two or
   * three concrete options each, and the person's requirements quoted word for word. One request, no pictures.
   * Returns at once; follow the job like `draftBlueprint` and read the cards with `getIdeas`.
   */
  expandIdeas(input: { projectId: string; request: string }): Promise<{ jobId: string }>
  /** The idea cards, the person's requirements and choices as stored; null for a project that never had any. */
  getIdeas(input: { projectId: string }): Promise<Ideas | null>
  /**
   * The person's own part of the cards: pick per group (`option` null with empty `own` is 都不要, null with
   * words is 我自己写), answer a constraint question, give a requirement up or take it back, add one, edit the
   * summary, and say go (`ready`). Only the app calls this: no tool offered to an outside AI chooses.
   */
  chooseIdeas(input: { projectId: string } & IdeaChoice): Promise<Ideas>
  /** Put the cards away. The person's requirements stay with their sentence. */
  discardIdeas(input: { projectId: string }): Promise<null>
  /**
   * What is happening in this project, as an append-only list of plain-word events: planning, every step of
   * every task, builds, the person's own actions, and each call an outside AI makes. `after` is the last
   * `seq` already on screen. Read-only; safe to poll every second or two.
   */
  getActivity(input: { projectId: string; after?: number }): Promise<Activity>
  /** 验收回执 of the project: facts read from its making, gameplay, activity and scene records. Read-only; safe to call whenever the receipt is opened. */
  getReceipt(input: { projectId: string }): Promise<Receipt>
  /** The project's plan as stored, with every entry, or null when there is none. */
  getBlueprint(input: { projectId: string }): Promise<Blueprint | null>
  /**
   * Store the plan after the person edited it (titles, briefs, entries added or removed). `revision` is the
   * one the edit started from; 0 when there was no plan. The stored plan gets a new revision and is a draft
   * again. An entry that keeps its key and kind keeps the content already made for it. Rejects with a plain
   * message when a rule is broken (a creature without a model, a dependency loop) or while content is being made.
   */
  saveBlueprint(input: { projectId: string; revision: number; blueprint: BlueprintDraft }): Promise<Blueprint>
  /**
   * The person approves exactly the revision on screen. Nothing is made before this, and only the app can
   * do it: no tool offered to an outside AI confirms a plan. Confirming also gives entries that had failed
   * a fresh pair of tries.
   */
  confirmBlueprint(input: { projectId: string; revision: number }): Promise<Blueprint>
  /** Remove the plan. Content already made stays in the project. */
  discardBlueprint(input: { projectId: string }): Promise<null>
  /**
   * Make everything the confirmed plan lists, batch after batch in dependency order, with Studio's own AI.
   * Each batch is an ordinary project run (see `listProjectRuns`). An entry that fails is tried once more in
   * a later batch; after that it stays failed and whatever needs it shows as blocked, while the rest carries
   * on. Call it again to resume after stopping or after the app was restarted: it continues with what is left.
   */
  startBlueprintProduction(input: { projectId: string }): Promise<ProjectOverview>
  /** Finish the pieces being made right now, then start nothing more. `production.running` turns false once they are done. */
  stopBlueprintProduction(input: { projectId: string }): Promise<ProjectOverview>
  /** The asset overview for any project, with or without a plan. Read-only. */
  getProjectPlay(input: { projectId: string }): Promise<PlayReport>
  getProjectOverview(input: { projectId: string; progressOnly?: boolean }): Promise<ProjectOverview>
  /**
   * The person's verdict on one saved thing. It is stored beside the project and bound to the asset's
   * current revision; when the thing changes, the verdict stops counting and it is asked about again.
   * Pass `revision` (the `OverviewItem.revision` on screen): if the thing changed meanwhile the call is
   * refused with a plain message instead of judging a version the person never saw. `note` is at most
   * 500 characters. "rejected" only records it (`status` becomes "redo"); use `redoAsset` to also have it
   * remade. Any saved asset may be judged, asked about or not. Only the person can do this: no outside AI tool exists for it.
   */
  reviewAsset(input: { projectId: string; assetId: string; revision?: number; verdict: "accepted" | "rejected"; note?: string }): Promise<ProjectOverview>
  /**
   * Take back the verdict on the revision that exists now, as if nobody had looked. Taking back a
   * "rejected" also withdraws a redo that has not started yet. Nothing to take back is not an error.
   */
  clearAssetReview(input: { projectId: string; assetId: string }): Promise<ProjectOverview>
  /**
   * "Not right, do it again", for one item. `itemId` is an `OverviewItem.id`; `feedback` is the person's
   * remark, at most 500 characters, and may be empty for "just try again".
   * - A saved thing: the rejection is recorded with those words and the asset is remade in place, with
   *   its brief, the shared style and the remark kept apart in the prompt. Its revision goes up, so the
   *   old verdict no longer applies and the new version waits to be looked at.
   * - A plan entry whose `status` is "failed" (never made): it gets one more try, made anew.
   * With Studio's own AI it starts at once, or right after the batch in hand when production is running.
   * With an outside AI it waits: that AI's next `next_batch` hands it out before anything else.
   * Rejects with a plain message while that item is being made, and for an item that is planned or
   * blocked. Asking again after a redo failed gives it another try. The returned overview shows the item
   * as "making" or "redo". Nothing that uses a remade thing is remade with it: those items get a
   * `problems` entry of kind "stale" instead.
   * `itemId` is the overview item's `id`; the id of the asset made for it (`asset_id`) names the same thing and is accepted too (round 10).
   */
  redoAsset(input: { projectId: string; itemId: string; feedback: string; annotation?: ModelAnnotationInput }): Promise<ProjectOverview>
  /** The steps of a making, for 制作现场's timeline. The newest version when none is named. */
  getMakingTrace(input: { projectId: string; assetId: string; version?: number }): Promise<MakingTrace>
  /** The document as it stood at a step of a making; null when no copy of it was kept. */
  getMakingStep(input: { projectId: string; assetId: string; version: number; seq: number }): Promise<ModuleDocument | null>
  /** Every saved version of a thing and every note on it, for 验收窗「制作过程」. */
  getMakingHistory(input: { projectId: string; assetId: string }): Promise<MakingHistoryView>
  /** Saves what an old version held as a new version. The version it replaces stays. */
  restoreVersion(input: { projectId: string; assetId: string; version: number; expectedRevision: number }): Promise<{ version: number; view: StudioView }>
  addMakingNote(input: { projectId: string; assetId: string; note: MakingNoteInput }): Promise<MakingNote[]>
  changeMakingNote(input: { projectId: string; assetId: string; id: number; change: "remove" | "reopen" }): Promise<MakingNote[]>
  earnAdvancements(input: { projectId: string; ids: AdvancementId[]; quiet?: boolean }): Promise<{ fresh: AdvancementId[] }>
  /** Hands notes to the AI through the redo that exists. `picture`: the view with the marks on it, for a thing that has one. */
  sendMakingNotes(input: { projectId: string; assetId: string; ids: number[]; onlyMarked: boolean; extra?: string; titles?: Record<string, string>; picture?: { image: string; width: number; height: number; projectRevision: number; marks?: { note: number; start: { x: number; y: number }; end?: { x: number; y: number } }[] } }): Promise<MakingNote[]>
  /**
   * How one item was or is being made by looking. `itemId` is an `OverviewItem.id`. Null for an item with no
   * record: a kind that is not made by looking, something a person made, or anything from before this existed.
   * While a task runs the record is written at every step, so polling this shows live progress.
   */
  getMaking(input: { projectId: string; itemId: string }): Promise<Making | null>
  /**
   * A saved block or item drawn among the game's own blocks or items (label 「和原版放在一起」), as a data URL
   * for an image element. Drawn afresh on every call and stored nowhere: it holds the game's own pictures,
   * which never go into a project. Null when the game cannot be read on this machine yet (nothing was ever
   * built), when the asset is of another kind or gone, or when nothing could be drawn.
   */
  lookBeside(input: { projectId: string; assetId: string }): Promise<{ label: string; url: string } | null>
  /**
   * Gameplay (Engineer D). How one gameplay's code was or is being checked: its description, every version with
   * what each check found, the review of description against code, and what was said of the saved version.
   * `itemId` is an `OverviewItem.id`. Null when no record was kept. While a task runs the record is written at
   * every step, so polling this shows live progress.
   */
  getGameplay(input: { projectId: string; itemId: string }): Promise<GameplayStory | null>
  /**
   * The person's own edit of an item's part sheet. The next redo starts from it. Rejects with a plain message
   * while the item is being made, and for an item nothing has been made of yet.
   */
  saveSheet(input: { projectId: string; itemId: string; sheet: PartSheet }): Promise<Making>
  /**
   * Reference images of an overview item (`itemId` is an `OverviewItem.id`), the person's own first. They can be
   * attached before anything has been made, are kept inside the project, and are shown to the AI that makes
   * and reviews this one thing, nowhere else. A redo carries them.
   */
  getReferences(input: { projectId: string; itemId: string }): Promise<ReferenceImage[]>
  /**
   * Attach one picture the person chose: `url` is a data URL of PNG, JPEG or WebP, at most 4 MB; `name` is the
   * file's name. At most 4 per item. Rejects with a plain message otherwise. Answers the item's list.
   */
  addReference(input: { projectId: string; itemId: string; name: string; url: string }): Promise<ReferenceImage[]>
  /** Take one reference off an item (the person's own, or a view an AI drew). Answers the item's list. */
  removeReference(input: { projectId: string; itemId: string; referenceId: string }): Promise<ReferenceImage[]>
  /**
   * 2026-10-08 六视图: put the person's own picture in a slot (replacing what was there; "sheet" replaces all six views, a single
   * view replaces a sheet, "side" is the left slot). Same formats and size as addReference. Answers the item's list.
   */
  addThreeView(input: { projectId: string; itemId: string; view: ThreeViewSlot; style?: SixViewStyle; name: string; url: string }): Promise<ReferenceImage[]>
  /** Ask the connected image model to draw the item's 六视图 (one sheet, six views in fixed places) from its words (and its part sheet when there is one). Replaces an earlier AI-drawn one; never the person's. */
  drawThreeView(input: { projectId: string; itemId: string; note?: string }): Promise<ReferenceImage[]>
  /** Read the current model's GPT drawing prompt without network requests or project changes. */
  getThreeViewPrompt(input: ExternalThreeViewPromptInput): Promise<string>
  /** An external agent returns its generated sheet, or reports that its current tools cannot draw. */
  finishThreeView(input: ExternalThreeViewFinishInput): Promise<ThreeViewResult>
  /** API drawing availability; MCP uses a prompt hand-off and returns can:false/why:null. */
  threeViewDrawing(): Promise<{ mode: "api" | "mcp"; can: boolean; model: string | null; why: string | null }>
  /** Whether the person already chose, for this item, to have it made from words alone (no 六视图). Kept in the project, so it is not asked again, including on a redo. */
  threeViewByWords(input: { projectId: string; itemId: string }): Promise<boolean>
  /** Records that choice (the question's 「直接开始」) for these items' sake, one at a time. */
  chooseThreeViewByWords(input: { projectId: string; itemId: string }): Promise<void>
  /** What uses this content. `assetId` is an `OverviewItem.asset_id`, or the id part of a `kind:id` item. */
  getAssetUsage(input: { projectId: string; assetId: string; creature?: true }): Promise<AssetUsage>
  transcribeAudio(input: SpeechInput): Promise<{ text: string }>
  chooseProjectLocation(): Promise<{ token: string; label: string } | null>
  addEntity(input: { projectId: string; expectedRevision: number; name: string }): Promise<StudioView>
  selectEntity(input: { projectId: string; entityId: string }): Promise<StudioView>
  getCreatureLook(input: {projectId:string; assetId:string; expectedRevision:number; part:"move"|"phases"|"show"|"arena"; key?:string}):Promise<{pictures:{label:string;url:string}[];note:string}>
  getEntityPreview(input: { projectId: string; entityId: string }): Promise<Pick<StudioView, "model" | "preview">>
  saveContent(input: { projectId: string; expectedRevision: number; content: Content }): Promise<StudioView>
  /** 「自己改」: one thing changed by the person on its own page, through the same validation an AI's hand-in gets; refused field by field in plain words. */
  saveByHand(input: HandSaveInput): Promise<HandSaveResult>
  saveConception(input: { projectId: string; expectedRevision: number; conception: Conception }): Promise<StudioView>
  /** 「发布信息」: author, version, licence and links, written into the jar by the build. Fields left out are not stored. */
  saveRelease(input: { projectId: string; expectedRevision: number; release: Release }): Promise<StudioView>
  /** The display name only; the mod id never changes. */
  renameProject(input: { projectId: string; expectedRevision: number; name: string }): Promise<StudioView>
  /**
   * 「模组信息」: everything the mod says about itself, saved together: names (Chinese and English), description, author, version, licence, links and icon.
   * `icon`: undefined keeps the saved one, null takes it away, a PNG data URL is checked and sized (`givenIcon`) before it is kept.
   */
  saveModInfo(input: { projectId: string; expectedRevision: number; info: ModInfoInput }): Promise<StudioView>
  /** The English name of one block, item or creature (empty takes it away); the one field a finding about missing English names takes the person to. */
  setEnglishName(input: { projectId: string; expectedRevision: number; kind: "entity" | "block" | "item"; id: string; name_en: string }): Promise<StudioView>
  /** Moves the project's folder into `DELETED_FOLDER` beside it; refused while something of the project is running. `moved` is where it went. */
  deleteProject(input: { projectId: string }): Promise<{ moved: string }>
  analyzeConception(input: {
    projectId: string
    expectedRevision: number
    brief: string
  }): Promise<{ jobId: string; view: StudioView }>
  importConception(input: { projectId: string; expectedRevision: number; plan: ConceptionPlan }): Promise<StudioView>
  saveEntry(input: { projectId: string; expectedRevision: number; entry: ConceptionEntry }): Promise<StudioView>
  reviewEntry(input: {
    projectId: string
    expectedRevision: number
    entry: ConceptionEntry
    behavior: boolean
  }): Promise<{ jobId: string; view: StudioView }>
  exportProject(input: { projectId: string }): Promise<{ path: string } | null>
  chooseImport(): Promise<{
    token: string
    name: string
    project: Project
    environment: { java: number; minecraft: string; loader: string; loaderVersion: string }
  } | null>
  importProject(input: { token: string }): Promise<StudioView>
  getSettings(): Promise<StudioSettings>
  saveSettings(input: StudioSettingsInput): Promise<StudioSettings>
  /**
   * 个人设置 · 默认工程目录: where new projects go from now on. `locationToken` is the folder the person just picked with
   * `chooseProjectLocation`; null goes back to Studio's own folder. Projects already made stay where they are.
   * (`saveSettings` never changes this folder: a path is only taken from the system's chooser.)
   */
  saveProjectsDirectory(input: { locationToken: string | null }): Promise<StudioSettings>
  saveBlockbench(input: {
    projectId: string
    expectedRevision: number
    entityId: string
    snapshot: Record<string, unknown>
  }): Promise<StudioView>
  loadBlockbench(input: { projectId: string; entityId: string }): Promise<Record<string, unknown>>
  getBlockbenchRuntime(): Promise<{ origin: string; url: string; version: string }>
  saveEntity(input: {
    projectId: string
    expectedRevision: number
    name: string
    description: string
    health: number
    speed: number
    attack_damage: number
    behavior: Entity["behavior"]
    steady?: Entity["steady"]
    entityId?: string
  }): Promise<StudioView>
  useExample(input: { projectId: string; expectedRevision: number; entityId?: string }): Promise<StudioView>
  saveModel(input: {
    projectId: string
    expectedRevision: number
    model: ModelDesign
    entityId?: string
  }): Promise<StudioView>
  generateModel(input: { projectId: string; expectedRevision: number; prompt: string; annotation?: ModelAnnotationInput }): Promise<{ jobId: string }>
  /**
   * A build job that failed only because a download broke off (after automatic retries) has
   * `checkpoint.reason === "network"`: `error` is then one plain sentence saying it is not the mod's fault and
   * to try again later, and `checkpoint.detail` keeps what Gradle printed, for 高级.
   * A job that failed because the project was saved while it ran has `checkpoint.reason === "stale"`: the window sends it to the one stop
   * that packs again (`jobWentStale`), by that reason and never by the words of `error`.
   */
  getJob(input: { projectId: string; jobId: string }): Promise<Job>
  getLatestBuild(input: { projectId: string }): Promise<Job | null>
  /**
   * The build panel's facts about the packs. `latest`: the newest finished pack as a version (when it was made, how many things it holds, what was made since);
   * `used`: the same for the pack `jobId` names, the one a press is working from. `ready`: which downloads this computer already has (the development files
   * a build and a code check share; the game's server files; the game itself), so a hint says "the first time" only when it is one.
   */
  getBuildPanel(input: { projectId: string; jobId?: string }): Promise<BuildPanel>
  getModelProgress(input: { projectId: string; jobId: string }): Promise<ModelProgress | null>
  cancelJob(input: { projectId: string; jobId: string }): Promise<Job>
  buildProject(input: { projectId: string }): Promise<{ jobId: string }>
  startPlaytest(input: { projectId: string; jobId: string }): Promise<{ jobId: string }>
  /**
   * 「测试场」: the built jar and only the mods it cannot start without, in a game of its own with nothing else in it,
   * in a flat world with everything the mod adds set out. `startSceneCheck` runs it without a window (the game's own
   * server) and reports what the game answered; `startScenePlay` opens it for the person. Both take a finished build's
   * job and return a job read with `getJob`. `record.report` is the last check; `extra` is the folder beside the
   * project for the jars of mods this one is built on.
   */
  getScene(input: { projectId: string }): Promise<{ record: SceneRecord | null; /** The record is of the project as it is now, not of an earlier state of it. */ current: boolean; lines: string[]; eula: boolean; /** A test world from a background check is there (the record says for which build); opening the scene without one lands on the game's main menu. */ world: boolean; directory: string; extra: string }>
  /**
   * Closes the loop after a build: gathers what the mod guide's reconciliation and the test scene's last check
   * (only one of the project's current revision) found, sorts the findings by the thing each is about, and starts
   * for every such thing the same redo `redoAsset` starts, with the findings as its words (「打包以后检查发现：…」).
   * Things that cannot be redone (made by hand, being made, not on any card) and findings about the mod as a whole
   * come back in `left` with the reason. With Studio's own AI the redos run as one batch; otherwise they are
   * recorded for the outside AI's next batch, `waiting` is true and `tell` is the sentence to paste to it.
   */
  fixFindings(input: { projectId: string }): Promise<FixFindingsResult>
  /** The person agrees to the game's licence (https://aka.ms/MinecraftEULA), which its server asks for. Asked once. */
  agreeSceneEula(): Promise<{ eula: boolean }>
  startSceneCheck(input: { projectId: string; jobId: string }): Promise<{ jobId: string }>
  startScenePlay(input: { projectId: string; jobId: string }): Promise<{ jobId: string }>
  exportSource(input: { projectId: string }): Promise<{ path: string }>
  listBuildJars(input: { projectId: string }): Promise<BuildJarEntry[]>
  revealRecordedJar(input: { projectId: string; jobId: string }): Promise<void>
  revealBuildJar(input: { projectId: string; jobId: string }): Promise<void>
  exportJar(input: { projectId: string; jobId: string }): Promise<{ path: string }>
  /**
   * Data-only gameplay (Engineer C). The mod guide (模组说明书) for the project as it is saved now, with what
   * machine reconciliation found: both made by rule from the project's own data, with no AI and no game.
   * A build writes the same guide beside the jar as 模组说明.md.
   */
  getModGuide(input: { projectId: string }): Promise<ModGuideView>
  /** Saves one model (a creature's, or a workspace model's) as a Blockbench .bbmodel file the person picks a place for. */
  exportBlockbench(input: { projectId: string; assetId: string }): Promise<{ path: string }>
  environment(): Promise<{
    aiConfigured: boolean
    javaConfigured: boolean
    model: string
    projectAiConfigured?: boolean
    routerModel?: string
    assetModel?: string
    workspace: string
    version: "0.1.0-preview"
    profiles?: { id: string; java: number; minecraft: string; loader: string; loaderVersion: string }[]
  }>
}

declare global {
  interface Window {
    studio: StudioApi
  }
}

/** One game version × mod loader, and whether Studio can really make a mod for it now (and if not, why, in plain words). */
export type GameTarget = {
  id: string
  minecraft: string
  loader: "fabric" | "forge" | "neoforge" | "quilt"
  loaderVersion: string | null
  java: number
  ready: boolean
  why: string | null
}

/** A Java found on this computer. `fits`: a JDK of the major version asked for, for this computer's processor. */
export type JavaFound = {
  home: string
  version: string
  major: number
  vendor: string
  arch: string
  jdk: boolean
  source: "chosen" | "studio" | "java_home" | "path" | "installed" | "launcher" | "registry"
  fits: boolean
  /** Why it does not fit, in plain words; null when it fits. */
  why: string | null
}

export type ModInfoInput = {
  name: string
  name_en: string
  description: string
  description_en: string
  release: Release
  icon?: string | null
}

export type JavaReport = {
  found: JavaFound[]
  /** What the next build will use; null when nothing fits (then the first build downloads one, or installJava does now). */
  using: JavaFound | null
  mode: "auto" | "chosen"
  chosen: string | null
}

export type JavaInstallPlan = {
  vendor: string
  version: string
  url: string
  /** Asked of the server just now; null when it could not be asked (then nothing is made up). */
  downloadBytes: number | null
  directory: string
  defaultDirectory: string
  /** Free space on that disk; null when it could not be read. */
  freeBytes: number | null
  /** Plain reason it cannot be installed there (not enough space, a link, not writable); null when it can. */
  problem: string | null
}

export type PreinstalledMod = {
  file: string
  id: string
  name: string
  version: string
  from: "modrinth" | "file"
  /** Added because another pre-installed mod needs it. */
  required: boolean
}

export type ModSearch = {
  hits: { projectId: string; slug: string; title: string; description: string; icon: string | null; downloads: number; author: string }[]
  total: number
}

export type ModsAdded = { added: PreinstalledMod[]; skipped: { name: string; why: string }[] }

/** Another project of the person's, as 从别的工程导入 lists it: who it is and what can be picked in it. */
/** `path` (r29c): a project folder outside Studio's projects, read where it is; absent for one of Studio's own. */
export type ProjectImportSource = { id: string; name: string; mod_id: string; revision: number; targets: string[]; things: { id: string; kind: string; title: string }[]; path?: string }

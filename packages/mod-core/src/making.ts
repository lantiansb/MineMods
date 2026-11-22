import { createHash } from "node:crypto"
import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { BLIND_FITS, EPIC_MAKING, makingLimits, BlindAnswerSchema, blindAdvice, blindFinding, blindFit, blindPlain, carriedOver, continuityFindings, continuityLine, continuityPlain, continuityUnanswered, FinalReviewSchema, heldBefore, isBlindNamed, isFlat, MAKING_LIMITS, MotionNoteSchema, motionLine, motionPlain, NO_WORLD_WORDS, outsideFindings, outsideUnanswered, PartSheetSchema, REFUSALS, SelfReviewSchema, stillReason, textureLines, TextureNoteSchema, texturePlain, unseenMotions, type BlindAnswer, type BlindFit, type MotionNote, type PartSheet, type SelfReview, type TextureNote } from "@minemods/studio-ai/making"
import { REFUSAL_CAP, type ToldReview } from "@minemods/studio-ai/acceptance"
import { SCRIPT_LIMITS } from "@minemods/studio-ai/script"
import { budgetLine, budgetPlain, GEOMETRY_TIER_IDS, TIER_CEILING, tierFindings, tierUnanswered, type BudgetNote } from "@minemods/studio-ai/budget"
import { archivedReferencePaths, archivedReferences, listedReferences } from "./making-references"
import { archivedModelAnnotationPaths, archivedModelAnnotations } from "./making-annotations"
import type { Project } from "./project"
import { storagePath, withProjectLock, writeRecord } from "./project"
import { ModuleKindSchema } from "./workspace-modules"
import { entityChoices, referenceChoices, UNKNOWN_CONTENT_REFERENCE, UNKNOWN_ENTITY_REFERENCE } from "./content"

export * from "@minemods/studio-ai/making"
export * from "./making-references"

/**
 * The record of one thing being made by looking: its part sheet, every round of pictures the AI was shown
 * with what it said about them, and the final review. The rules of the loop are the functions below; the
 * app's own AI and an outside AI's tools both go through them, so there is one protocol. Kept beside the
 * project file, one record per asset, so a project from before this existed opens and saves unchanged.
 */

const Words = z.string().max(2000)
const PictureFile = z.string().regex(/^[a-z0-9-]{1,40}\.(jpg|png)$/)
const Version = z.string().regex(/^[a-f0-9]{64}$/)
/** The most pictures one review can hold: the set it is given, and everything it may ask for. */
const REVIEW_PICTURES = MAKING_LIMITS.review_sheets + MAKING_LIMITS.needs * MAKING_LIMITS.need_items

export const MakingRoundSchema = z.strictObject({
  round: z.number().int().min(1),
  at: z.iso.datetime(),
  /** Which version was looked at: the hash of its document. */
  fingerprint: Version,
  /** Pictures the AI was shown, as files beside the record. */
  pictures: z.array(z.strictObject({ label: z.string().max(120), file: PictureFile })).max(EPIC_MAKING.kept),
  /** One view of this version alone, for a small picture of the round. Absent in records from before it was drawn. */
  cover: PictureFile.optional(),
  /** The set drawn for the reviewer of this version, and (`asked`) what the reviewer asked to see besides. Absent when it was never reviewed. */
  review_pictures: z.array(z.strictObject({ label: z.string().max(120), file: PictureFile, asked: z.boolean().optional() })).max(REVIEW_PICTURES).optional(),
  /** How many times the reviewer of this version asked to be shown more. */
  asked: z.number().int().min(0).max(MAKING_LIMITS.needs).optional(),
  self_review: SelfReviewSchema.nullable(),
  /** Round 17, blind naming: what a reviewer said this version is when it was shown the picture alone, before it was told anything. Written once, before the review of this version; absent when it was never asked. */
  blind: BlindAnswerSchema.extend({ at: z.iso.datetime() }).optional(),
  /** What the deterministic standard found on this version, in plain words. */
  findings: z.array(Words).max(64),
  /** Which answers the part sheet gave (`sheetVersion`) when those findings were judged: a sheet that answers differently since has not been read into them. Absent in records from before. */
  sheet: Version.optional(),
  /** The script this version's document came out of, when it was written as one. The next version is made by editing it. */
  script: z.string().max(SCRIPT_LIMITS.source).optional(),
  /**
   * How much each motion of this version moves, measured. Absent in records from before motion was measured and for things without motions.
   * One note for every clip the model has, so as many as any tier allows (`TIER_CEILING.animations`, an epic creature's 32): what a look draws is
   * bounded by its own picture limits, never what it measured and keeps (a 21-clip Boss's first look was once refused here at 16).
   */
  motion: z.array(MotionNoteSchema).max(TIER_CEILING.animations).optional(),
  /** What was counted on this version's picture (a block's face, an item's icon), and the same as ranges for the game's own pictures it was looked at beside: numbers and names, never their pixels. Absent for other kinds and in older records. */
  texture: TextureNoteSchema.optional(),
  /** Engineer H2: what a model has against its geometry tier (`budget.ts`): counts only. Absent for other kinds and in records from before tiers. */
  /** Round 10: sentences measured on this version that have to be answered before it is called finished, for what has no typed measure of its own (a creature's abilities against its model). Absent when there are none and in older records. */
  measured: z.array(Words).max(64).optional(),
  budget: z.strictObject({ tier: z.enum(GEOMETRY_TIER_IDS), cubes: z.number().int().min(0), bones: z.number().int().min(0), texture: z.number().int().min(0), animations: z.number().int().min(0), keys: z.number().int().min(0), total_keys: z.number().int().min(0), texture_needed: z.number().int().min(0).optional() }).optional(),
})

/** Why a making stopped short of a pass. `interrupted` is not a judgement of the work: the app closed or the connection broke. */
export const STOPPED_REASONS = ["interrupted", "rounds", "review", "gave_up", "failed"] as const
export type StoppedReason = (typeof STOPPED_REASONS)[number]

/** Said to the person about a version that was saved because its making was cut short. */
export const INTERRUPTED_WORDS = "制作被中断了（软件关了或连接断了），这是中断前最好的一版，还没有做完审查。"

export const MakingRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  /** The asset this is the making of. It names the record's file. */
  asset_id: z.uuid(),
  /** The plan entry it was made for, if any: how a later try at the same entry finds this sheet. */
  entry: z.string().max(64).nullable(),
  kind: ModuleKindSchema,
  /** The person's own words, and the task's brief: what a reviewer who took no part is given. */
  request: z.string().max(20000),
  brief: z.string().max(16000),
  /** The task this making belongs to; null once only the sheet is kept (a person's edit of something made earlier). */
  task_id: z.uuid().nullable(),
  sheet: PartSheetSchema.nullable(),
  /** Round 10: this making has no part sheet and asks for none (`SHEETLESS_KINDS`: a creature looked at for its abilities). Absent for everything made from a sheet and in older records. */
  sheetless: z.boolean().optional(),
  /** The sheet was written or revised during this making. A sheet carried over from an earlier version does not count. */
  described: z.boolean(),
  /** What the person said when they sent the last version back, if this is a redo. */
  remark: z.string().max(500).nullable(),
  rounds: z.array(MakingRoundSchema).max(32),
  /** `findings` are the blocking ones; `advice` never failed anything and is absent in records from before the two were told apart. */
  review: z
    .strictObject({
      independent: z.boolean(),
      passed: z.boolean(),
      findings: FinalReviewSchema.shape.findings,
      advice: FinalReviewSchema.shape.advice,
      /** Round 18: the reviewer's technical detail behind the two lists above, for 高级 and for the maker. Absent in records from before. */
      technical: FinalReviewSchema.shape.technical,
      at: z.iso.datetime(),
      fingerprint: Version,
      /**
       * Round 17, blind naming (`BLIND_KINDS`): what was said of the picture alone, what the thing was meant to be (`named`), and whether the
       * reviewer, once told, judged that answer to be the thing. Null: this kind is named blind and this review was not (the review switch
       * was off, so nobody could be shown it without knowing): 未盲认. Absent: a kind that is not named blind, and records from before.
       * `fits` (round 18) is the verdict in three (`BLIND_FITS`); `recognised` is false for `no` alone. Records from before hold `recognised` only.
       */
      blind: z.strictObject({ said: BlindAnswerSchema.shape.sees, also: BlindAnswerSchema.shape.also, because: BlindAnswerSchema.shape.because, recognised: z.boolean(), fits: z.enum(BLIND_FITS).optional(), named: z.string().max(200) }).nullable().optional(),
    })
    .nullable(),
  /** The latest version looked at that the standard does not refuse: the one kept for the person if the loop ends without a pass. Its document lies beside the record. */
  best: z.strictObject({ round: z.number().int().min(1), fingerprint: Version }).nullable().optional(),
  /**
   * How it ended. `kept_unsatisfied`: saved although its maker or its reviewer still had blocking findings, for the person to judge.
   * `kept_interrupted`: saved because the making was cut short; nobody found it wanting. Absent while it runs and in older records.
   */
  outcome: z.enum(["passed", "kept_unsatisfied", "kept_interrupted", "failed"]).optional(),
  /** Why it stopped short of a pass, when it did. Absent in older records and in ones that passed. */
  stopped_reason: z.enum(STOPPED_REASONS).optional(),
  /** Why the AI was not satisfied with the version it kept, in plain lines for the person. */
  kept_reason: z.array(Words).max(64).optional(),
  /** Round 18: the technical detail behind `kept_reason` (what whoever stopped wrote apart from its plain sentence, and the technical notes of the reviews), for 高级. Absent in older records. */
  kept_technical: z.array(Words).max(64).optional(),
  /** Which round the saved version is, when it was kept. */
  kept_round: z.number().int().min(1).optional(),
  state: z.enum(["describing", "making", "reviewing", "done", "stopped"]),
  rounds_allowed: z.number().int().min(1).max(32),
  /**
   * r29c (大鹗): the part sheet was rewritten after the independent review of the last version failed it. A review reads the thing against its sheet, so the same document with
   * the sheet that answers it now is a version not reviewed yet: from then on a version is told apart by this too (`makingVersion`), and the next look opens a round of its own.
   * The fingerprint of the sheet as rewritten then. Absent: versions are their documents' fingerprints, as they always were.
   */
  resheet: Version.optional(),
  updated_at: z.iso.datetime(),
})
export type MakingRound = z.infer<typeof MakingRoundSchema>
export type MakingRecord = z.infer<typeof MakingRecordSchema>

/**
 * A step of the loop refused, said in words whoever is making can act on. Nothing was changed.
 * `final` means there is no way on from here: the task this making belongs to has failed.
 */
export class MakingRefusal extends Error {
  constructor(
    message: string,
    readonly final = false,
    /** Round 18: the same refusal in a sentence for the person, when `message` quotes the code for whoever has to fix it. */
    readonly plain?: string,
  ) {
    super(message)
  }
}

/**
 * Round 10: a version the save itself cannot store (a schema, the compile, a limit on what is exported). Not final in itself and not
 * a failure of the task: the version is handed back with why, and another can be made. It is counted against the standard's own cap
 * on hand-ins (`saveVerdict`), so the same unsaveable version cannot hold a batch forever: only the last hand-in allowed (`REFUSAL_CAP`) is final.
 */
export class SaveRefusal extends MakingRefusal {}

/** What a save refusal can say is there to be referred to: the project the version is saved into, as far as references go. */
export type SaveSource = Parameters<typeof referenceChoices>[1] & { entities?: readonly { id: string; name: string }[] }

/**
 * Why a save threw, in one sentence that ends as a sentence. A version that refers to something the project does not hold is told what
 * it can refer to (`referenceChoices`, `entityChoices`), whatever it was and wherever the refusal is read: the same for every such refusal.
 */
export const saveReason = (error: unknown, source?: SaveSource) => {
  const issues = error instanceof z.ZodError ? error.issues.slice(0, 8) : []
  const wrong = (prefix: string) => issues.filter((found) => found.message.startsWith(prefix)).map((found) => found.message.slice(prefix.length))
  const content = wrong(UNKNOWN_CONTENT_REFERENCE)
  const choices = source ? [content.length ? referenceChoices(content, source) : "", wrong(UNKNOWN_ENTITY_REFERENCE).length && source.entities ? entityChoices(source.entities) : ""].join("") : ""
  const words =
    error instanceof z.ZodError
      ? issues.map((issue) => issue.code === "custom" && /」(?:引用的声音在这个工程里找不到|的声音依赖还没登记)/.test(issue.message) ? issue.message : `${issue.path.join(".") || "input"}: ${issue.message}`).join("；")
      : error instanceof Error
        ? error.message
        : String(error)
  return `${/[。！？.!?]$/.test(words) ? words : `${words}。`}${choices}`
}

/** What a save refusal is read with besides the words: where it can look up what to refer to, and the sentence for a person. */
export type SaveWords = {
  source?: SaveSource
  /** The same refusal in a person's words (no field paths, no English), when the caller can say it. */
  plain?: (error: unknown) => string
}

/**
 * Runs the part of a save that only prepares (schemas, compile) and answers what it made, or the refusal it
 * would end in. The look, a draft and the hand-in all ask through here, so they say the same words.
 */
export function saveable<Made>(make: () => Made, words?: SaveWords): { ok: true; made: Made } | { ok: false; refusal: SaveRefusal } {
  try {
    return { ok: true, made: make() }
  } catch (error) {
    return { ok: false, refusal: new SaveRefusal(REFUSALS.unsaveable(saveReason(error, words?.source)).slice(0, 2000), false, words?.plain ? REFUSALS.unsaveable(words.plain(error)).slice(0, 2000) : undefined) }
  }
}

/**
 * A save refusal counted against the standard's own cap on hand-ins (`REFUSAL_CAP`), so the same unsaveable
 * version cannot hold a batch forever: whether this was the last one allowed, and what its maker is told.
 */
export function saveVerdict(refusal: SaveRefusal, refusals: number, said = refusal.message) {
  const left = Math.max(0, REFUSAL_CAP - refusals)
  return { final: left === 0, text: left > 0 ? `${said}任务保持运行，工程里什么都没有改动（还可以再交 ${left} 次）。` : `${said}这个任务已经被退回 ${refusals} 次。` }
}

const now = () => new Date().toISOString()
const stamped = (record: MakingRecord) => MakingRecordSchema.parse({ ...record, updated_at: now() })
const refuse = (words: string, final = false): never => {
  throw new MakingRefusal(words, final)
}

// Keys in one order, so the same content written down in a different order is still the same version.
const ordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(ordered)
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort((left, right) => (left[0] < right[0] ? -1 : 1))
      .map((entry) => [entry[0], ordered(entry[1])]),
  )
}

/** Which version a document is: two documents with the same content are the same version. */
export function fingerprint(document: unknown) {
  return createHash("sha256").update(JSON.stringify(ordered(document))).digest("hex")
}

/**
 * What a part sheet answers, as a version: the motions it declares still, the reasons it gives (`justified`) and the measures it says are meant to differ. These are what the standard
 * and the measuring read beside the document, so a sheet that answers differently has not been read into findings that were judged before it was written. Null when there is no sheet.
 */
export const sheetVersion = (sheet: Pick<PartSheet, "still" | "justified" | "differs"> | null) => (sheet ? fingerprint({ still: sheet.still ?? [], justified: sheet.justified ?? [], differs: sheet.differs ?? [] }) : null)

/**
 * Said when the maker calls a version finished after it changed the part sheet and the findings kept with the look are of the sheet as it was. Owner's rule (a harness never
 * contradicts itself): the finding it was told to change or answer with a reason is the one it just answered, so refusing "done" with that same finding would send it round again
 * for nothing. A look at the same version re-reads the sheet and costs no round (`lookGate`); the document is not kept for a version that has findings, so it cannot be re-judged here.
 */
export const SHEET_CHANGED = "部件说明在这一版看过以后改过了，下面这些毛病是照改之前的说明查出来的：对这同一版再看一次（look，文档不用改，这不算新的一版），新写的理由才会被读进去；然后再自评。"

/** What the deterministic standard found, one plain sentence each: which criterion, what is wrong, what to change. */
export function findingLines(review: Pick<ToldReview, "unreadable" | "findings">) {
  return (review.unreadable ? [`这份内容没法检查：${review.unreadable.message}${review.unreadable.fix}`] : review.findings.map((finding) => `${finding.criterion}：${finding.message}${finding.fix}`)).map((line) => line.slice(0, 2000))
}

/**
 * A task starts on an asset. The sheet of an earlier making is where this one starts from, with what the
 * person said about that version; its rounds and review belong to the old version and go. Starting the
 * same task twice changes nothing.
 */
export function begin(previous: MakingRecord | null, { sheetless, ...input }: Pick<MakingRecord, "asset_id" | "entry" | "kind" | "request" | "brief"> & { task_id: string; remark: string | null; sheetless?: boolean }) {
  if (previous?.task_id === input.task_id) return previous
  return stamped({
    schema_version: 1,
    ...input,
    ...(sheetless ? { sheetless: true } : {}),
    sheet: previous?.sheet ? { ...previous.sheet, remark: input.remark } : null,
    described: false,
    rounds: [],
    review: null,
    state: "describing",
    rounds_allowed: MAKING_LIMITS.rounds,
    updated_at: now(),
  })
}

/**
 * A record that holds only a sheet, for something no making was ever recorded for (made before the loop
 * existed, or by a person): the sheet a person writes for it is where a later redo starts from.
 */
export function sheetOnly(input: Pick<MakingRecord, "asset_id" | "entry" | "kind" | "request" | "brief">, sheet: PartSheet) {
  return stamped({ schema_version: 1, ...input, task_id: null, sheet: PartSheetSchema.parse({ ...sheet, remark: null }), described: false, remark: null, rounds: [], review: null, state: "done", rounds_allowed: MAKING_LIMITS.rounds, updated_at: now() })
}

// A sheet that declares nothing (no motion still, no measure meant to differ) is stored as sheets always were, without the fields.
const sheetOf = ({ still, differs, justified, budget, ...sheet }: Omit<PartSheet, "remark" | "budget"> & { budget?: PartSheet["budget"] | null }, remark: string | null) => PartSheetSchema.parse({ ...sheet, ...(still?.length ? { still } : {}), ...(differs?.length ? { differs } : {}), ...(justified?.length ? { justified } : {}), ...(budget ? { budget } : {}), remark })

/**
 * r29c (大鹗): which version a document is under this record: its fingerprint, and once the sheet was rewritten after a failed review (`resheet`) that fingerprint taken with the sheet's, so
 * the same document read against the new sheet is a new version (a round of its own, a review of its own). Every comparison with a round's `fingerprint` goes through this.
 */
export function makingVersion(record: Pick<MakingRecord, "resheet"> | null | undefined, document: unknown) {
  const plain = fingerprint(document)
  return record?.resheet ? fingerprint({ document: plain, sheet: record.resheet }) : plain
}

/** The maker writes or revises the sheet. The remark stays the person's: what an AI puts there is replaced. */
export function describe(record: MakingRecord, sheet: Omit<PartSheet, "remark" | "budget"> & { budget?: PartSheet["budget"] | null }) {
  if (record.state === "done" || record.state === "stopped") refuse(REFUSALS.over)
  if (record.sheetless) refuse(record.kind==="particle" ? "粒子直接用 look 看三张图，再用 self_review 自评，完成后提交。" : REFUSALS.no_sheet_wanted)
  // A review was of the thing against the sheet as it was; a sheet rewritten since has not been reviewed against.
  // 第 2 步: a thing declared of the epic tier is given its own number of versions (`makingLimits`); none is ever taken away.
  const rounds_allowed = Math.max(record.rounds_allowed, makingLimits(sheet.budget?.tier).rounds)
  const written = sheetOf(sheet, record.remark)
  // r29c (大鹗): a failed review of the last version and a sheet that now says something else: the same document is a new version to be reviewed again (`resheet`).
  const failed = record.review && !record.review.passed && record.review.fingerprint === last(record)?.fingerprint
  const resheet = failed && record.sheet && fingerprint(written) !== fingerprint(record.sheet) ? { resheet: fingerprint(written) } : {}
  return stamped({ ...record, sheet: written, described: true, review: record.review?.passed ? null : record.review, state: record.state === "describing" ? "making" : record.state, ...(rounds_allowed === record.rounds_allowed ? {} : { rounds_allowed }), ...resheet })
}

/** The person's own edit of the sheet. It does not stand in for the maker describing what it is about to make. */
export function edit(record: MakingRecord, sheet: PartSheet) {
  return stamped({ ...record, sheet: sheetOf(sheet, record.remark) })
}

const last = (record: MakingRecord) => record.rounds.at(-1)

/**
 * Refuses a look that the loop does not allow yet; says whether it opens a new round, and which earlier round it leaves
 * without a self-review (`skipped`, else null). Call before rendering.
 *
 * A new version no longer waits for the self-review of the one before it: that rule protected nothing, since the review
 * that counts (`reviewable`, `commitGate`) is always of the last version and needs its own self-review, and the skipped
 * version has already used up one of the versions allowed. 17 of 52 refusals measured on real projects were of this order.
 * The exception is the last version allowed: no version is left to give, so that one has to be judged.
 */
export function lookGate(record: MakingRecord, version: string) {
  if (record.state === "done" || record.state === "stopped") refuse(REFUSALS.over, true)
  if (!record.sheetless && (!record.described || !record.sheet)) refuse(REFUSALS.no_sheet)
  const current = last(record)
  if (!current || current.fingerprint === version) return { opens: !current, skipped: null }
  if (record.rounds.length >= record.rounds_allowed) refuse(current.self_review ? REFUSALS.out_of_rounds(record.rounds_allowed) : REFUSALS.no_self_review(current.round), Boolean(current.self_review))
  return { opens: true, skipped: current.self_review ? null : current.round }
}

/** A glance at the bench is allowed whenever there is something to make by: the loop is running and, for a kind with a sheet, the sheet is written. It opens nothing. */
export function glanceGate(record: MakingRecord) {
  if (record.state === "done" || record.state === "stopped") refuse(REFUSALS.over, true)
  if (!record.sheetless && (!record.described || !record.sheet)) refuse(REFUSALS.no_sheet)
  return { opens: false, skipped: null }
}

/**
 * The maker was shown pictures of one version. A version not seen before opens a round; another look at
 * the same version (a close-up, a motion) adds to its round, the newest pictures kept.
 */
export function looked(record: MakingRecord, input: { fingerprint: string; pictures: MakingRound["pictures"]; findings: string[]; cover?: string; script?: string; motion?: MotionNote[]; texture?: TextureNote; budget?: BudgetNote; measured?: string[] }) {
  const gate = lookGate(record, input.fingerprint)
  const current = last(record)
  const limits = makingLimits(record.sheet?.budget?.tier)
  const fresh = input.pictures.slice(0, limits.sheets)
  // The same view drawn again takes the place of the old one; when a round is full, the first sheet stays and the oldest of the rest go.
  const merged = gate.opens || !current ? fresh : [...current.pictures.map((picture) => fresh.find((value) => value.label === picture.label) ?? picture), ...fresh.filter((value) => !current.pictures.some((picture) => picture.label === value.label))]
  const round = {
    ...(gate.opens || !current ? { round: record.rounds.length + 1, at: now(), fingerprint: input.fingerprint, self_review: null } : current),
    pictures: [...merged.slice(0, 1), ...merged.slice(1).slice(-(limits.kept - 1))],
    ...(input.cover ? { cover: input.cover } : {}),
    ...(input.script ? { script: input.script } : {}),
    ...(input.motion?.length ? { motion: input.motion } : {}),
    ...(input.texture ? { texture: input.texture } : {}),
    ...(input.budget ? { budget: input.budget } : {}),
    // Another look at the same version may have drawn only part of it (one ability): what was measured on the rest still stands.
    ...((measured) => (measured.length ? { measured: measured.slice(0, 64).map((line) => line.slice(0, 2000)) } : {}))([...new Set([...(gate.opens || !current ? [] : (current.measured ?? [])), ...(input.measured ?? [])])]),
    findings: input.findings,
    ...((answers) => (answers ? { sheet: answers } : {}))(sheetVersion(record.sheet)),
  }
  return stamped({
    ...record,
    rounds: [...(gate.opens ? record.rounds : record.rounds.slice(0, -1)), round],
    // Nothing the standard refuses is ever kept for the person; a version with a hard fault leaves the earlier best in place.
    best: input.findings.length ? record.best : { round: round.round, fingerprint: input.fingerprint },
    // A pass was for the version reviewed, not for a later one. A failure stays on show until the next review replaces it.
    review: record.review?.passed && record.review.fingerprint !== input.fingerprint ? null : record.review,
    state: round.self_review?.verdict === "done" ? "reviewing" : "making",
  })
}

/** Whether the last version looked at already has a self-review: writing another one replaces it. */
export const selfReviewed = (record: MakingRecord) => Boolean(last(record)?.self_review)

/**
 * What the maker says about the version it has just looked at. One stands per round: writing it again replaces the earlier
 * one (the maker changed its mind, or sent the call twice), which hurts nothing as long as nobody has concluded on the version.
 * Once the independent review of this very version has concluded, the self-review is no longer changed: written afterwards,
 * it could be made to match what the reviewer found and would read as foreseen. Advice left over does not stand in the way of "done".
 */
export function selfReview(record: MakingRecord, input: SelfReview) {
  const given = SelfReviewSchema.parse(input)
  // A problem the maker named of the version before and names again of the one made to answer it no longer blocks (`carriedOver`): it stays in the advice, said so.
  const before = record.rounds.at(-2)?.self_review
  const again = carriedOver(heldBefore(before?.problems ?? [], before?.advice), given.problems, "own")
  const review = again.carried.length ? SelfReviewSchema.parse({ ...given, problems: again.fresh, advice: [...again.carried, ...(given.advice ?? [])].slice(0, 24) }) : given
  if (record.state === "done" || record.state === "stopped") refuse(REFUSALS.over, true)
  const current = last(record) ?? refuse(REFUSALS.no_look)
  if (current.self_review && record.review?.fingerprint === current.fingerprint) refuse(REFUSALS.reviewed_already)
  if (review.verdict === "done" && review.problems.length) refuse(REFUSALS.done_with_problems)
  // A motion nobody can see moving is answered, not waved through: changed, or declared still in the sheet as it is now.
  const unseen = unseenMotions(record.sheet, current.motion)
  // The same for a flat picture measured outside the range of the game's own beside it: changed, or declared as meant in the sheet.
  const outside = isFlat(record.kind) ? outsideFindings(record.kind, record.sheet, current.texture) : []
  // And for a motion that does not hold together over time (a loop that jumps, a foot in the ground): changed, or justified in the sheet.
  const broken = continuityFindings(record.sheet, current.motion)
  if (review.verdict === "done" && current.findings.length && current.sheet !== undefined && current.sheet !== sheetVersion(record.sheet)) refuse(`${SHEET_CHANGED}${current.findings.join(" ")}`.slice(0, 8000))
  if (review.verdict === "done" && current.findings.length) refuse(REFUSALS.done_with_findings([...current.findings, ...unseen, ...broken, ...outside, ...(current.measured ?? []), ...tierFindings(record.sheet, current.budget)]))
  if (review.verdict === "done" && unseen.length) refuse(REFUSALS.done_with_unseen_motion(unseen))
  if (review.verdict === "done" && broken.length) refuse(REFUSALS.done_with_motion_faults(broken))
  if (review.verdict === "done" && outside.length) refuse(REFUSALS.done_outside_world(outside))
  // Round 10: and for what was measured without a typed note (a creature's abilities) and for a geometry tier that is not used.
  const measured = [...(current.measured ?? []), ...tierFindings(record.sheet, current.budget)]
  if (review.verdict === "done" && measured.length) refuse(REFUSALS.done_with_measured(measured))
  if (review.verdict === "revise" && !review.next.length) refuse(REFUSALS.revise_without_next)
  return stamped({
    ...record,
    rounds: [...record.rounds.slice(0, -1), { ...current, self_review: review }],
    // Nothing left to revise in: the last round allowed said it is not finished.
    state: review.verdict === "done" ? "reviewing" : record.rounds.length >= record.rounds_allowed ? "stopped" : "making",
  })
}

/** The round a review is of: the last one, once its maker has called it finished. Refuses otherwise. */
export function reviewable(record: MakingRecord) {
  const current = last(record) ?? refuse(REFUSALS.no_look)
  if (!current.self_review) refuse(REFUSALS.no_self_review(current.round))
  if (current.self_review?.verdict !== "done") refuse(REFUSALS.not_done)
  return current
}

/** The set of pictures drawn for the reviewer of the last version. Drawn once per version; what the reviewer asked for besides stays. */
export function reviewShown(record: MakingRecord, pictures: MakingRound["pictures"]) {
  const current = reviewable(record)
  return stamped({ ...record, rounds: [...record.rounds.slice(0, -1), { ...current, review_pictures: [...pictures.slice(0, MAKING_LIMITS.review_sheets), ...(current.review_pictures ?? []).filter((picture) => picture.asked)] }] })
}

/** Refuses a reviewer's request to be shown more once it has asked as often as one review may. Call before rendering. */
export function needGate(record: MakingRecord) {
  const current = reviewable(record)
  if (record.review?.fingerprint === current.fingerprint) refuse(REFUSALS.concluded)
  if ((current.asked ?? 0) >= MAKING_LIMITS.needs) refuse(REFUSALS.no_more_needs)
  return current
}

/** The reviewer could not see something and was shown it: the pictures join the round, and the request is counted. */
export function reviewAsked(record: MakingRecord, pictures: MakingRound["pictures"]) {
  const current = needGate(record)
  return stamped({
    ...record,
    rounds: [...record.rounds.slice(0, -1), { ...current, asked: (current.asked ?? 0) + 1, review_pictures: [...(current.review_pictures ?? []), ...pictures.slice(0, MAKING_LIMITS.need_items).map((picture) => ({ ...picture, asked: true }))].slice(0, REVIEW_PICTURES) }],
  })
}

/**
 * Round 17, blind naming: whether the version its maker called finished still has to be named from its picture alone
 * before anyone is told what it is. True for the kinds a player has to recognise at a glance (`BLIND_KINDS`), until
 * that has been answered for this version or the version has been concluded on.
 */
export function blindDue(record: MakingRecord) {
  const current = reviewable(record)
  return isBlindNamed(record.kind) && !current.blind && record.review?.fingerprint !== current.fingerprint
}

/** What was said of the last version when only its picture was shown. Once: the answer of someone who has since been told cannot be taken again. */
export function blindAnswered(record: MakingRecord, answer: BlindAnswer) {
  const current = reviewable(record)
  if (!isBlindNamed(record.kind)) refuse(REFUSALS.blind_not_wanted)
  if (record.review?.fingerprint === current.fingerprint) refuse(REFUSALS.concluded)
  if (current.blind) refuse(REFUSALS.blind_answered)
  return stamped({ ...record, rounds: [...record.rounds.slice(0, -1), { ...current, blind: { ...BlindAnswerSchema.parse(answer), at: now() } }] })
}

/**
 * What a reviewer who took no part concluded about the version the maker called finished. Only blocking findings fail it.
 * Round 17: a kind that is named blind is concluded on only after that (`REFUSALS.no_blind`), with how the picture fits the
 * thing (`fits`, or the `recognised` of callers from before: true is `at_once`, false is `no`). `no` is a blocking finding
 * Studio writes itself, whatever the reviewer put in `passed`; `with_name` passes, and Studio writes what it was called blind
 * into the advice (`named` is what the thing was meant to be, as the person calls it). `unblinded`: the review switch is off,
 * nobody could name it blind, and the record says so instead.
 */
export function finalReview(record: MakingRecord, input: { passed: boolean; findings: string[]; advice?: string[]; technical?: string[]; independent: boolean; fits?: BlindFit; recognised?: boolean; named?: string; unblinded?: boolean }) {
  const current = reviewable(record)
  if (record.review?.fingerprint === current.fingerprint && !record.review.passed) refuse(REFUSALS.reviewed_and_failed)
  const blind = isBlindNamed(record.kind) ? (current.blind ?? null) : undefined
  if (blind === null && !input.unblinded) refuse(REFUSALS.no_blind)
  const fit = blind ? blindFit(input) : undefined
  if (blind && fit === undefined) refuse(REFUSALS.blind_unjudged)
  if (input.passed && input.findings.length) refuse(REFUSALS.passed_with_findings)
  const named = input.named ?? record.sheet?.subject ?? ""
  const missed = blind && fit === "no" ? [blindFinding(named, blind)] : []
  // What the reviewer held against the version before and holds against this one again no longer blocks (`carriedOver`): a review of which nothing else is new passes, and says so in its advice.
  const earlier = record.review && !record.review.passed && record.review.fingerprint !== current.fingerprint ? record.review : null
  const again = carriedOver(heldBefore(earlier?.findings ?? [], earlier?.advice), input.findings, "reviewed")
  const told = blind && fit === "with_name" ? [blindAdvice(named, blind), ...(input.advice ?? [])] : input.advice
  const advice = again.carried.length ? [...again.carried, ...(told ?? [])].slice(0, 24) : blind && fit === "with_name" ? told?.slice(0, 24) : told
  const findings = [...missed, ...again.fresh].slice(0, 24)
  const passed = (input.passed || (input.findings.length > 0 && !again.fresh.length)) && !missed.length
  if (!passed && !findings.length) refuse(REFUSALS.failed_without_findings)
  return stamped({
    ...record,
    review: {
      ...FinalReviewSchema.parse({ passed, findings, ...(advice ? { advice } : {}), ...(input.technical?.length ? { technical: input.technical } : {}) }),
      independent: input.independent,
      at: now(),
      fingerprint: current.fingerprint,
      ...(blind === undefined ? {} : { blind: blind ? { said: blind.sees, also: blind.also, because: blind.because, recognised: fit !== "no", ...(fit ? { fits: fit } : {}), named: named.slice(0, 200) } : null }),
    },
    state: passed ? "reviewing" : record.rounds.length >= record.rounds_allowed ? "stopped" : "making",
  })
}

/** Why this version may not be handed in, or null when the loop was followed to the end for exactly this version. */
export function commitGate(record: MakingRecord | null, version: string) {
  if (!record?.sheetless && (!record?.described || !record.sheet)) return REFUSALS.no_sheet
  const current = last(record)
  if (!current) return REFUSALS.no_look
  if (current.fingerprint !== version) return REFUSALS.unseen
  if (!current.self_review) return REFUSALS.no_self_review(current.round)
  if (current.self_review.verdict !== "done") return REFUSALS.not_done
  if (!record.review) return REFUSALS.no_review
  if (record.review.fingerprint !== version) return REFUSALS.stale_review
  if (!record.review.passed) return REFUSALS.review_failed
  return null
}

export const finish = (record: MakingRecord) => stamped({ ...record, state: "done", outcome: "passed" })
/** The task ended and nothing of it was saved. `failed` is false when it was only called off. */
export const stop = (record: MakingRecord, failed = true) => (record.state === "done" ? record : stamped({ ...record, state: "stopped", ...(failed ? { outcome: "failed" as const, stopped_reason: stoppedWhy(record, "failed") } : {}) }))

/** Why a making that did not pass stopped: out of versions, failed by its last review, or ended by whoever was making (`otherwise`). */
export function stoppedWhy(record: MakingRecord, otherwise: "gave_up" | "failed"): StoppedReason {
  if (record.rounds.length < record.rounds_allowed) return otherwise
  return record.review && !record.review.passed && record.review.fingerprint === last(record)?.fingerprint ? "review" : "rounds"
}

/**
 * Why the AI was not satisfied with the version being kept, for the person: what whoever stopped said,
 * what the reviewer of that very version held against it, and what its maker still wanted to change.
 * A review of an earlier version is not repeated here: it is shown beside the version it was of.
 */
export function unsatisfied(record: MakingRecord, said: string | null) {
  const round = record.rounds.find((value) => value.round === record.best?.round)
  const review = record.review && !record.review.passed && record.review.fingerprint === record.best?.fingerprint ? record.review : null
  const own = round?.self_review?.verdict === "revise" ? round.self_review : null
  const lines = [
    ...(said ? [`停下的原因：${said}`] : []),
    ...(review ? [...review.findings.map((line) => `评审认为必须改：${line}`), ...(review.advice ?? []).map((line) => `评审认为可以更好：${line}`)] : []),
    ...(own ? [...own.problems.map((line) => `它自己认为必须改：${line}`), ...(own.advice ?? []).map((line) => `它自己认为可以更好：${line}`)] : []),
    ...unseenMotions(record.sheet, round?.motion).map((line) => `量出来的：${line.replace(/把它改到看得出来.*$/u, "")}`),
    ...continuityUnanswered(record.sheet, round?.motion).map((found) => `量出来的：${found.line}`),
    ...(isFlat(record.kind) ? outsideUnanswered(record.kind, record.sheet, round?.texture) : []).map((found) => `量出来的：${found.line}`),
    ...(round?.measured ?? []).map((line) => `量出来的：${line}`),
    ...tierUnanswered(record.sheet, round?.budget).map((line) => `量出来的：${line}`),
    ...(round && round.round < record.rounds.length ? [`交给你的是第 ${round.round} 版：后面的版本有量得出来的硬伤，没有留。`] : []),
  ]
  return (lines.length ? lines : [`做到第 ${record.rounds.length} 版（最多 ${record.rounds_allowed} 版），AI 还没有说做完。`]).slice(0, 64).map((line) => line.slice(0, 2000))
}

/**
 * The technical detail behind `unsatisfied`, for 高级: what whoever stopped wrote apart from its plain sentence, and the technical notes of the review of that very
 * version and of the maker's own last self-review. Never shown in the normal view.
 */
export function unsatisfiedTechnical(record: MakingRecord, technical: string | null) {
  const round = record.rounds.find((value) => value.round === record.best?.round)
  const review = record.review && !record.review.passed && record.review.fingerprint === record.best?.fingerprint ? record.review : null
  const own = round?.self_review?.verdict === "revise" ? round.self_review : null
  return [...(technical ? [technical] : []), ...(review?.technical ?? []), ...(own?.technical ?? [])].slice(0, 64).map((line) => line.slice(0, 2000))
}

/** The best version was saved for the person although the loop did not pass it. */
export const keep = (record: MakingRecord, reasons: string[], technical: string[] = []) => stamped({ ...record, state: "done", outcome: "kept_unsatisfied", stopped_reason: stoppedWhy(record, "gave_up"), kept_reason: reasons, ...(technical.length ? { kept_technical: technical } : {}), kept_round: record.best?.round })

/**
 * The best version was saved because the making was cut short. Nothing is said against the work: what its
 * maker or a reviewer had already written about that version stays beside it, as theirs.
 */
export const keepInterrupted = (record: MakingRecord) => stamped({ ...record, state: "done", outcome: "kept_interrupted", stopped_reason: "interrupted", kept_reason: [INTERRUPTED_WORDS], kept_round: record.best?.round })

const FOLDER = [".minemods", "making"]
const recordSegments = (assetId: string) => [...FOLDER, `${z.uuid().parse(assetId)}.json`]
const PICTURE_LIMIT = 2 * 1024 * 1024
const bestSegments = (assetId: string) => [...FOLDER, `${z.uuid().parse(assetId)}.best.json`]
// r29c: `resheet`, the record's when the best version was kept under it (`makingVersion`); absent as it always was.
const BestSchema = z.strictObject({ task_id: z.uuid(), fingerprint: Version, document: z.unknown(), resheet: Version.optional() })
/** Every picture file a round names: what the maker saw, its small cover, and what its reviewer saw. */
const roundFiles = (round: MakingRound) => [...round.pictures, ...(round.review_pictures ?? [])].map((picture) => picture.file).concat(round.cover ? [round.cover] : [])

const absent = (error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
  throw error
}

/** Null when nothing was recorded, or when the file cannot be read as a record: the thing is then simply made afresh. */
export async function readMaking(directory: string, assetId: string) {
  const text = await readFile(await storagePath(directory, recordSegments(assetId)), "utf8").catch(absent)
  return MakingRecordSchema.safeParse(await Promise.resolve(text ?? "null").then(JSON.parse).catch(() => null)).data ?? null
}

/** Caller holds the project lock. */
export async function writeMakingUnlocked(directory: string, record: MakingRecord) {
  await writeRecord(directory, recordSegments(record.asset_id), MakingRecordSchema.parse(record))
  return record
}

/** Read, change and store one record as a single step. `change` may refuse by throwing; then nothing is written. */
export function changeMaking(directory: string, assetId: string, change: (record: MakingRecord | null) => MakingRecord) {
  return withProjectLock(directory, async () => writeMakingUnlocked(directory, change(await readMaking(directory, assetId))))
}

/**
 * The document of the best version so far, kept beside the record until the task ends: rounds hold only
 * a version's hash, and a version the loop did not pass can be handed to the person only if it still exists.
 */
export async function writeBest(directory: string, assetId: string, best: z.infer<typeof BestSchema>) {
  await withProjectLock(directory, () => writeRecord(directory, bestSegments(assetId), BestSchema.parse(best)))
}

/** The kept document of this record's best version, or null when there is none or it is another task's or another version's. */
export async function readBest(directory: string, record: MakingRecord) {
  const text = await readFile(await storagePath(directory, bestSegments(record.asset_id)), "utf8").catch(absent)
  const best = BestSchema.safeParse(await Promise.resolve(text ?? "null").then(JSON.parse).catch(() => null)).data
  return best && best.task_id === record.task_id && best.fingerprint === record.best?.fingerprint && makingVersion(best, best.document) === best.fingerprint ? best.document : null
}

export const removeBest = async (directory: string, assetId: string) => rm(await storagePath(directory, bestSegments(assetId)), { force: true })

/** Every record of the project. Read only when a sheet has to be found by its plan entry, never on a poll. */
export async function listMakings(directory: string) {
  const folder = path.dirname(await storagePath(directory, [...FOLDER, "listing"]))
  const files = await readdir(folder, { withFileTypes: true }).catch((error: unknown) => absent(error) ?? [])
  return (await Promise.all(files.filter((file) => file.isFile() && /^[0-9a-f-]{36}\.json$/i.test(file.name)).map((file) => readMaking(directory, file.name.slice(0, -5))))).flatMap((record) => (record ? [record] : []))
}

const pictureFolder = async (directory: string, assetId: string) => path.dirname(await storagePath(directory, [...FOLDER, z.uuid().parse(assetId), "listing"]))

/** Store pictures (data URLs) beside the record and return how the record names them. One that is not a picture is left out. `tag` (a letter) keeps apart what is drawn for different readers of the same round. */
export async function writePictures(directory: string, assetId: string, round: number, pictures: { label: string; url: string }[], tag = "") {
  const stored = await Promise.all(
    pictures.map(async (picture, index) => {
      const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(picture.url)
      if (!match || match[2]!.length > PICTURE_LIMIT) return null
      const file = `${round}${tag}-${Date.now().toString(36)}-${index}.${match[1] === "png" ? "png" : "jpg"}`
      await writeFile(await storagePath(directory, [...FOLDER, z.uuid().parse(assetId), file], true), Buffer.from(match[2]!, "base64"))
      return { label: picture.label.slice(0, 120), file }
    }),
  )
  return stored.flatMap((picture) => (picture ? [picture] : []))
}

/** A stored picture as a data URL, or null when the file is gone. */
export async function readPicture(directory: string, assetId: string, file: string) {
  const bytes = await readFile(await storagePath(directory, [...FOLDER, z.uuid().parse(assetId), file])).catch(absent)
  return bytes ? `data:image/${file.endsWith(".png") ? "png" : "jpeg"};base64,${bytes.toString("base64")}` : null
}

/** Pictures no round names any more: those of an earlier making, and ones a later look at the same version replaced. */
export async function prunePictures(directory: string, record: MakingRecord) {
  const folder = await pictureFolder(directory, record.asset_id)
  const kept = new Set(record.rounds.flatMap(roundFiles))
  const files = await readdir(folder).catch((error: unknown) => absent(error) ?? [])
  await Promise.all(files.filter((file) => !kept.has(file)).map((file) => rm(path.join(folder, file), { force: true })))
}

/**
 * A record as the app shows it: pictures as data URLs, ready for an image element. A round that was
 * reviewed shows the reviewer's set first (it is the complete one), then what only the maker looked at.
 */
export async function shownMaking(directory: string, record: MakingRecord) {
  const url = (file: string) => readPicture(directory, record.asset_id, file)
  return {
    sheet: record.sheet,
    // Round 10: made without a part sheet on purpose (a creature looked at for its abilities), so the screen does not say one is missing.
    ...(record.sheetless ? { sheetless: true as const } : {}),
    rounds: await Promise.all(
      record.rounds.map(async (round) => {
        const reviewed = round.review_pictures ?? []
        const named = [
          ...reviewed.map((picture) => ({ ...picture, from: picture.asked ? ("asked" as const) : ("review" as const) })),
          ...round.pictures.filter((picture) => !reviewed.some((value) => value.label === picture.label)).map((picture) => ({ ...picture, from: "look" as const })),
        ]
        const cover = round.cover ? await url(round.cover) : null
        return {
          round: round.round,
          at: round.at,
          pictures: (await Promise.all(named.map(async (picture) => ({ label: picture.label, url: await url(picture.file), from: picture.from })))).flatMap((picture) => (picture.url ? [{ label: picture.label, url: picture.url, from: picture.from }] : [])),
          ...(cover ? { cover } : {}),
          self_review: round.self_review,
          // What was measured and had to be answered is shown with what the standard found: both are what the maker was told to change.
          findings: [...round.findings, ...(round.measured ?? [])],
          ...(round.script ? { script: round.script } : {}),
          // Each motion in a sentence for the person (`plain`) and with its numbers (`line`, for 高级); `still` is the sheet's reason when it declares the motion still.
          // `held` is how the motion holds together over time: sentences for the person (empty when nothing is wrong) and the whole measured sentence for 高级; absent in rounds from before that was measured.
          ...(round.motion ? { motion: round.motion.map((note) => ({ ...note, still: stillReason(record.sheet, note.name), plain: motionPlain(note, stillReason(record.sheet, note.name)), line: motionLine(note, stillReason(record.sheet, note.name)), ...(note.continuity ? { held: { plain: continuityPlain(note, record.sheet), line: continuityLine(note, record.sheet) } } : {}) })) } : {}),
          // A flat picture's counted facts: a sentence or two for the person (`plain`), every line with its numbers for 高级 (`lines`), and whether the game's own pictures were there to compare with.
          ...(round.texture && isFlat(record.kind) ? { texture: { plain: texturePlain(record.kind, round.texture, record.sheet), lines: [...(round.texture.world ? [] : [NO_WORLD_WORDS]), ...textureLines(record.kind, round.texture, record.sheet)], compared: round.texture.world !== null } } : {}),
          // Engineer H2: a model's counts against its geometry tier: a sentence for the person, the whole line for 高级.
          ...(round.budget ? { budget: { plain: budgetPlain(round.budget, record.sheet), line: budgetLine(round.budget, record.sheet) } } : {}),
        }
      }),
    ),
    review: record.review
      ? {
          independent: record.review.independent,
          passed: record.review.passed,
          findings: record.review.findings,
          ...(record.review.advice ? { advice: record.review.advice } : {}),
          ...(record.review.technical ? { technical: record.review.technical } : {}),
          at: record.review.at,
          // Round 17, blind naming: what was said of the picture alone and whether that was the thing, (`fits` says which of the three it was, in records that hold it), with the one sentence the person reads (`words`); `tested: false` is 未盲认. Left out for kinds that are not named blind and for older records.
          ...(record.review.blind === undefined ? {} : { blind: { tested: record.review.blind !== null, ...(record.review.blind ? { said: record.review.blind.said, also: record.review.blind.also, because: record.review.blind.because, recognised: record.review.blind.recognised, ...(record.review.blind.fits ? { fits: record.review.blind.fits } : {}) } : {}), words: blindPlain(record.review.blind) } }),
          // The version it was of. Null when that version is no longer among the rounds.
          round: record.rounds.find((round) => round.fingerprint === record.review!.fingerprint)?.round ?? null,
        }
      : null,
    rounds_allowed: record.rounds_allowed,
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.stopped_reason ? { stopped_reason: record.stopped_reason } : {}),
    ...(record.kept_reason ? { kept_reason: record.kept_reason } : {}),
    ...(record.kept_technical ? { kept_technical: record.kept_technical } : {}),
    ...(record.kept_round ? { kept_round: record.kept_round } : {}),
    // What is attached to this thing, by name only: the pictures are read when the screen asks for them. Left out when there is nothing.
    ...(await listedReferences(directory, [record.entry, record.asset_id]).then((references) => (references.length ? { references } : {}))),
  }
}

/** How much of an exported project may be pictures of makings. Records always travel; pictures beyond this stay behind, newest makings first. */
export const ARCHIVE_PICTURE_BUDGET = 32 * 1024 * 1024
const PICTURE_FILE = /^[a-z0-9-]{1,40}\.(jpg|png)$/

/** Every record and the pictures it names, as archive entries. Caller holds the project lock. */
export async function archivedMakings(directory: string) {
  const records = (await listMakings(directory)).sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  const left = { bytes: ARCHIVE_PICTURE_BUDGET }
  // References are what the person put in: they always travel, outside the budget for pictures of rounds.
  const entries: Record<string, Uint8Array> = await archivedReferences(directory)
  Object.assign(entries, await archivedModelAnnotations(directory))
  // One record after another, so the budget is spent on the newest first.
  await records.reduce(async (before, record) => {
    await before
    entries[`.minemods/making/${record.asset_id}.json`] = await readFile(await storagePath(directory, recordSegments(record.asset_id)))
    await record.rounds.flatMap(roundFiles).reduce(async (earlier, file) => {
      await earlier
      const bytes = await readFile(await storagePath(directory, [...FOLDER, record.asset_id, file])).catch(absent)
      if (!bytes || bytes.length > left.bytes) return
      left.bytes -= bytes.length
      entries[`.minemods/making/${record.asset_id}/${file}`] = bytes
    }, Promise.resolve())
  }, Promise.resolve())
  return entries
}

/** The archive paths that are makings: each record must be a record of the asset its name says, each picture one its record names. Throws on anything else under the folder. */
export function archivedMakingPaths(entries: Record<string, Uint8Array>, project?: Project) {
  const references = archivedReferencePaths(entries)
  const annotations = archivedModelAnnotationPaths(entries, project)
  const paths = Object.keys(entries).filter((name) => name.startsWith(".minemods/making/") && !references.includes(name) && !annotations.includes(name))
  const records = new Map(
    paths
      .filter((name) => /^\.minemods\/making\/[0-9a-f-]{36}\.json$/.test(name))
      .map((name) => {
        const record = MakingRecordSchema.parse(JSON.parse(Buffer.from(entries[name]!).toString("utf8")))
        if (name !== `.minemods/making/${record.asset_id}.json`) throw new Error("Making record does not match its name")
        return [record.asset_id, new Set(record.rounds.flatMap(roundFiles))] as const
      }),
  )
  paths
    .filter((name) => !name.endsWith(".json"))
    .forEach((name) => {
      const parts = name.split("/")
      if (parts.length !== 4 || !PICTURE_FILE.test(parts[3]!) || !records.get(parts[2]!)?.has(parts[3]!)) throw new Error("Making picture is not named by a record")
    })
  if (paths.some((name) => name.endsWith(".json") && !records.has(name.slice(".minemods/making/".length, -5)))) throw new Error("Making record does not match its name")
  return [...paths, ...references, ...annotations]
}

import { readFile, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { z } from "zod"
import { GAMEPLAY_LIMITS, GameplaySheetSchema, findingLine, gameplaySheet, type GameplayDocument, type GameplaySheet } from "./gameplay"
import { floorPassed, plainCheckLines, type GameplayCheck } from "./gameplay-check"
import { GAMEPLAY_REFUSALS, gameplayOwnWords } from "./gameplay-words"
import { FinalReviewSchema, MakingRefusal, REFUSALS, fingerprint } from "./making"
import { storagePath, withProjectLock, writeRecord } from "./project"

/**
 * The record of one gameplay being written: its description, every version that was checked with what the
 * checks found, and the review of description against code. The order of work is the functions below;
 * Studio's own AI and an outside AI's tools both go through them. It follows the making loop of the looked
 * kinds and reuses its parts (a version's fingerprint, the refusal type, the reviewer's two lists and the
 * rule that only blocking findings fail); what differs is the middle, where a machine check takes the place
 * of looking and self-review. Kept beside the project file, one record per asset, so a project from before
 * this existed opens and saves unchanged.
 */

const Words = z.string().max(2000)
const Version = z.string().regex(/^[a-f0-9]{64}$/)
const Finding = z.strictObject({ rule: z.string().max(40), file: z.string().max(200).nullable(), line: z.number().int().min(1).nullable(), message: Words, fix: Words, plain: Words.optional() })
const Findings = z.array(Finding).max(64)

export const GameplayCheckSchema = z.strictObject({
  bounds: Findings,
  references: Findings,
  compile: z.strictObject({ ok: z.boolean(), findings: Findings, compiler: z.string().max(80), note: Words.nullable(), /** What `note` leaves out for the person (the files and the compiler's lines); the AI is told it too. Absent in records from before. */ detail: Words.nullable().optional() }).nullable(),
  /** K2: what Studio read off the source and told the writer without refusing the version. Absent in records from before it existed. */
  advice: Findings.optional(),
})

/** How many things a reviewer may name as material it lacked. */
export const GAMEPLAY_REVIEW_LIMITS = { lacking: 8 } as const

/** How many changes of the description are kept: the versions one task may check, twice over (one change before each, one after it). */
const AMENDMENTS_KEPT = GAMEPLAY_LIMITS.rounds * 2

/** The description was changed after it was first written, by whoever writes the code: when, why, and what is different now, in words. */
export const GameplayAmendmentSchema = z.strictObject({
  /** The version being written when the change was made. */
  round: z.number().int().min(1),
  /** Why, in the writer's words; empty when it gave none (an outside AI that saves the description again). */
  because: Words,
  changes: z.array(Words).max(32),
  at: z.iso.datetime(),
})
export type GameplayAmendment = z.infer<typeof GameplayAmendmentSchema>

export const GameplayRoundSchema = z.strictObject({
  round: z.number().int().min(1),
  at: z.iso.datetime(),
  /** Which version was checked: the hash of its document. */
  fingerprint: Version,
  /** Which description it was checked under. A description rewritten since has to be checked against again. */
  sheet: Version,
  check: GameplayCheckSchema,
  /** In bounds, references real and compiled. */
  passed: z.boolean(),
})

export const GameplayRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  asset_id: z.uuid(),
  /** The plan entry it was written for, if any: how a later try at the same entry finds this description. */
  entry: z.string().max(64).nullable(),
  request: z.string().max(20000),
  brief: z.string().max(16000),
  task_id: z.uuid().nullable(),
  sheet: GameplaySheetSchema.nullable(),
  /** The description was written or revised during this task. One carried over from an earlier version does not count. */
  described: z.boolean(),
  /** What the person said when they sent the last version back, if this is a redo. */
  remark: z.string().max(500).nullable(),
  /** Every change of the description since code was first written for it. A reviewer is shown them: it judges the description as it is now, and whether the changes took out what the person asked for. Absent when there is none, and in records from before. */
  amendments: z.array(GameplayAmendmentSchema).max(AMENDMENTS_KEPT).optional(),
  rounds: z.array(GameplayRoundSchema).max(32),
  review: z
    .strictObject({
      independent: z.boolean(),
      passed: z.boolean(),
      findings: FinalReviewSchema.shape.findings,
      advice: FinalReviewSchema.shape.advice,
      /** Round 18: the reviewer's technical detail behind the two lists above, for 高级 and for the writer. Absent in records from before. */
      technical: FinalReviewSchema.shape.technical,
      at: z.iso.datetime(),
      fingerprint: Version,
      /** The hash of what the reviewer was given (instructions and input). Absent in records from before it was kept. */
      packet: Version.optional(),
      /** What the reviewer said it could not see and needed. A failed review that lacked material may be held once more for the same version. */
      lacked: z.array(z.string().max(600)).max(GAMEPLAY_REVIEW_LIMITS.lacking).optional(),
      /** This is already the second review of this version: there is no third. */
      again: z.boolean().optional(),
    })
    .nullable(),
  /** The latest version that passed the three machine checks: the one kept for the person if the loop ends without a pass. Its document lies beside the record. */
  best: z.strictObject({ round: z.number().int().min(1), fingerprint: Version }).nullable(),
  outcome: z.enum(["passed", "kept_unsatisfied", "failed"]).optional(),
  kept_reason: z.array(Words).max(64).optional(),
  /** Round 18: the technical detail behind `kept_reason`, for 高级. Absent in older records. */
  kept_technical: z.array(Words).max(64).optional(),
  kept_round: z.number().int().min(1).optional(),
  /** The saved version: which one it is and what the checks said about it. What the card and the build record show. */
  saved: z.strictObject({ fingerprint: Version, check: GameplayCheckSchema, at: z.iso.datetime() }).optional(),
  state: z.enum(["describing", "writing", "reviewing", "done", "stopped"]),
  rounds_allowed: z.number().int().min(1).max(32),
  updated_at: z.iso.datetime(),
})
export type GameplayRound = z.infer<typeof GameplayRoundSchema>
export type GameplayRecord = z.infer<typeof GameplayRecordSchema>

const now = () => new Date().toISOString()
const stamped = (record: GameplayRecord) => GameplayRecordSchema.parse({ ...record, updated_at: now() })
const refuse = (words: string, final = false, plain?: string): never => {
  throw new MakingRefusal(words, final, plain)
}
const last = (record: GameplayRecord) => record.rounds.at(-1)
const over = (record: GameplayRecord) => record.state === "done" || record.state === "stopped"
const capped = (check: GameplayCheck): GameplayCheck => {
  const cut = (findings: GameplayCheck["bounds"]) => findings.slice(0, 64).map((finding) => ({ ...finding, rule: finding.rule.slice(0, 40), message: finding.message.slice(0, 2000), fix: finding.fix.slice(0, 2000), ...(finding.plain ? { plain: finding.plain.slice(0, 2000) } : {}) }))
  return { bounds: cut(check.bounds), references: cut(check.references), compile: check.compile ? { ...check.compile, findings: cut(check.compile.findings), note: check.compile.note?.slice(0, 2000) ?? null, ...(check.compile.detail ? { detail: check.compile.detail.slice(0, 2000) } : {}) } : null, ...(check.advice?.length ? { advice: cut(check.advice) } : {}) }
}

/** Every finding of a check as one plain line each, in the order to fix them: bounds first, since out-of-bounds code is not even compiled. */
export const checkLines = (check: GameplayCheck) => [...check.bounds, ...check.references, ...(check.compile?.findings ?? []), ...(check.compile && !check.compile.ok && !check.compile.findings.length && check.compile.note ? [{ rule: "compile", file: null, line: null, message: check.compile.detail ?? check.compile.note, fix: "" }] : [])].map(findingLine)

/** A task starts on a gameplay. The description of an earlier version is where this one starts from; its rounds and review go. */
export function beginGameplay(previous: GameplayRecord | null, input: Pick<GameplayRecord, "asset_id" | "entry" | "request" | "brief"> & { task_id: string; remark: string | null }) {
  if (previous?.task_id === input.task_id) return previous
  // The entry a gameplay was written for does not change because a later task (a revision asked for in the person's own words) names none: the thing is still that entry's.
  return stamped({ schema_version: 1, ...input, entry: input.entry ?? previous?.entry ?? null, sheet: previous?.sheet ?? null, described: false, rounds: [], review: null, best: null, state: "describing", rounds_allowed: GAMEPLAY_LIMITS.rounds, updated_at: now() })
}

/**
 * What differs between two descriptions, in words: a behaviour is the same when all three of its lines are, so one that was reworded is told as taken out and put in.
 * Computed from the two documents, never written by whoever made the change.
 */
export function sheetChanges(before: GameplaySheet, after: GameplaySheet): string[] {
  const behaviour = (value: GameplaySheet["behaviours"][number]) => `「${value.when}」→ ${value.does}（看到听到：${value.shows}）`
  const list = (kind: string, was: readonly string[], now: readonly string[]) => [...was.filter((line) => !now.includes(line)).map((line) => `去掉了${kind}：${line}`), ...now.filter((line) => !was.includes(line)).map((line) => `加上了${kind}：${line}`)]
  return [
    ...(before.name === after.name ? [] : [`名字改成了「${after.name}」`]),
    ...(before.summary === after.summary ? [] : [`概述改成了：${after.summary}`]),
    ...list("行为", before.behaviours.map(behaviour), after.behaviours.map(behaviour)),
    ...list("它不做的事", before.not_doing, after.not_doing),
    ...(isDeepStrictEqual([...before.uses].sort(), [...after.uses].sort()) ? [] : [`挂的东西：加上 ${after.uses.filter((id) => !before.uses.includes(id)).length} 样，去掉 ${before.uses.filter((id) => !after.uses.includes(id)).length} 样`]),
  ]
    .slice(0, 32)
    .map((line) => line.slice(0, 2000))
}

/**
 * The writer writes or revises the description. A review was of the code against the description as it was, so it goes.
 * Once code has been written for it, or when whoever writes the code says why (`because`), this is a change of the description and is kept as one (`amendments`);
 * the package a gameplay's code is written in is its slug, so that stays for a change the writer of the code asks for (`because`): the code it is writing now is in that package.
 */
export function describeGameplay(record: GameplayRecord, sheet: GameplaySheet, because?: string) {
  if (over(record)) refuse(GAMEPLAY_REFUSALS.over)
  const next = GameplaySheetSchema.parse(sheet)
  const changing = Boolean(record.described && record.sheet && (because !== undefined || record.rounds.length > 0))
  if (changing && because !== undefined && next.slug !== record.sheet!.slug) refuse(GAMEPLAY_REFUSALS.amend_slug(record.sheet!.slug))
  const changes = changing ? sheetChanges(record.sheet!, next) : []
  const amendments = changes.length ? [...(record.amendments ?? []), { round: record.rounds.length + 1, because: (because ?? "").slice(0, 2000), changes, at: now() }].slice(-AMENDMENTS_KEPT) : record.amendments
  return stamped({ ...record, sheet: next, described: true, review: null, ...(amendments ? { amendments } : {}), state: record.state === "describing" || record.state === "reviewing" ? "writing" : record.state })
}

/** Refuses a check the loop does not allow; says whether it opens a new round. Call before compiling. */
export function checkGate(record: GameplayRecord, document: GameplayDocument) {
  if (over(record)) refuse(GAMEPLAY_REFUSALS.over, true)
  if (!record.described || !record.sheet) refuse(GAMEPLAY_REFUSALS.no_sheet)
  // What the reviewer reads and the person tests by is the description as it was saved; a document that carries another one is not this gameplay.
  if (!isDeepStrictEqual(gameplaySheet(document), record.sheet)) refuse(GAMEPLAY_REFUSALS.sheet_differs)
  const current = last(record)
  if (!current || current.fingerprint === fingerprint(document)) return { opens: !current }
  if (record.rounds.length >= record.rounds_allowed) refuse(GAMEPLAY_REFUSALS.out_of_rounds(record.rounds_allowed), true)
  return { opens: true }
}

/** One version was checked. A version not checked before opens a round; the same version checked again replaces its round. */
export function checkedGameplay(record: GameplayRecord, document: GameplayDocument, check: GameplayCheck) {
  const gate = checkGate(record, document)
  const version = fingerprint(document)
  const passed = floorPassed(check)
  const round = { round: gate.opens ? record.rounds.length + 1 : record.rounds.length, at: now(), fingerprint: version, sheet: fingerprint(record.sheet), check: capped(check), passed }
  return stamped({
    ...record,
    rounds: [...(gate.opens ? record.rounds : record.rounds.slice(0, -1)), round],
    // Nothing that fails a machine check is ever kept for the person.
    best: passed ? { round: round.round, fingerprint: version } : record.best,
    review: record.review && record.review.fingerprint !== version && record.review.passed ? null : record.review,
    // Nothing left to fix in: the last version allowed did not pass.
    state: passed ? "reviewing" : round.round >= record.rounds_allowed ? "stopped" : "writing",
  })
}

/** The round a review is of: the last one, once it has passed the machine checks. Refuses otherwise. */
export function reviewableGameplay(record: GameplayRecord) {
  if (!record.described || !record.sheet) refuse(GAMEPLAY_REFUSALS.no_sheet)
  const current = last(record) ?? refuse(GAMEPLAY_REFUSALS.no_check)
  if (current.sheet !== fingerprint(record.sheet)) refuse(GAMEPLAY_REFUSALS.redescribed)
  if (!current.passed) refuse(GAMEPLAY_REFUSALS.floor(checkLines(current.check)), false, GAMEPLAY_REFUSALS.floor_plain(plainCheckLines(current.check)))
  return current
}

/**
 * Whether a version that already failed a review may be reviewed once more, given the hash of what a
 * reviewer would be handed now: only when that review said it lacked material, or was of a different
 * packet (Studio now hands over something it did not then). The same question put again is refused, and
 * so is a third review whatever the reason.
 */
export function reviewAgain(record: GameplayRecord, packet: string | undefined) {
  const failed = record.review && !record.review.passed && record.review.fingerprint === last(record)?.fingerprint ? record.review : null
  if (!failed) return { repeat: false, allowed: true }
  return { repeat: true, allowed: !failed.again && (Boolean(failed.lacked?.length) || (packet !== undefined && failed.packet !== packet)) }
}

/**
 * What a reviewer who took no part concluded about description against code. Only blocking findings fail
 * it. `packet` is the hash of what the reviewer was given; `lacking` is what it said it could not see.
 */
export function reviewedGameplay(record: GameplayRecord, input: { passed: boolean; findings: string[]; advice?: string[]; technical?: string[]; independent: boolean; lacking?: string[]; packet?: string }) {
  if (over(record)) refuse(GAMEPLAY_REFUSALS.over, true)
  const current = reviewableGameplay(record)
  const again = reviewAgain(record, input.packet)
  if (!again.allowed) refuse(GAMEPLAY_REFUSALS.reviewed_and_failed)
  if (!input.passed && !input.findings.length) refuse(REFUSALS.failed_without_findings)
  if (input.passed && input.findings.length) refuse(REFUSALS.passed_with_findings)
  return stamped({
    ...record,
    review: {
      ...FinalReviewSchema.parse({ passed: input.passed, findings: input.findings, ...(input.advice ? { advice: input.advice } : {}), ...(input.technical?.length ? { technical: input.technical } : {}) }),
      independent: input.independent,
      at: now(),
      fingerprint: current.fingerprint,
      ...(input.packet ? { packet: input.packet } : {}),
      ...(input.lacking?.length ? { lacked: input.lacking.slice(0, GAMEPLAY_REVIEW_LIMITS.lacking).map((line) => line.slice(0, 600)) } : {}),
      ...(again.repeat ? { again: true } : {}),
    },
    // A failed review that lacked material is not the end of the last version allowed: that version may be reviewed once more.
    state: input.passed ? "reviewing" : record.rounds.length >= record.rounds_allowed && !(input.lacking?.length && !again.repeat) ? "stopped" : "writing",
  })
}

/** Why this version may not be handed in, or null when the loop was followed to the end for exactly this version. */
export function gameplayCommitGate(record: GameplayRecord | null, version: string) {
  if (!record?.described || !record.sheet) return GAMEPLAY_REFUSALS.no_sheet
  const current = last(record)
  if (!current) return GAMEPLAY_REFUSALS.no_check
  if (current.fingerprint !== version) return GAMEPLAY_REFUSALS.unchecked
  if (current.sheet !== fingerprint(record.sheet)) return GAMEPLAY_REFUSALS.redescribed
  if (!current.passed) return GAMEPLAY_REFUSALS.floor(checkLines(current.check))
  if (!record.review) return GAMEPLAY_REFUSALS.no_review
  if (record.review.fingerprint !== version) return GAMEPLAY_REFUSALS.stale_review
  if (!record.review.passed) return GAMEPLAY_REFUSALS.review_failed
  return null
}

/**
 * The same refusal as `gameplayCommitGate`, as the person is told it (round 18): the facts without the outside AI's tool voice, and for a version that failed the
 * code checks the sentences of the rules instead of the quoted code. Null when the gate is open.
 */
export function gameplayCommitGatePlain(record: GameplayRecord | null, version: string) {
  const message = gameplayCommitGate(record, version)
  if (!message) return null
  const current = record ? last(record) : undefined
  return record?.described && record.sheet && current && current.fingerprint === version && current.sheet === fingerprint(record.sheet) && !current.passed ? GAMEPLAY_REFUSALS.floor_plain(plainCheckLines(current.check)) : gameplayOwnWords(message)
}

const savedOf = (record: GameplayRecord, version: string | undefined) => {
  const round = record.rounds.find((value) => value.fingerprint === version)
  return round ? { saved: { fingerprint: round.fingerprint, check: round.check, at: now() } } : {}
}

export const finishGameplay = (record: GameplayRecord) => stamped({ ...record, state: "done", outcome: "passed", ...savedOf(record, last(record)?.fingerprint) })
/** The task ended and nothing of it was saved. `failed` is false when it was only called off. */
export const stopGameplay = (record: GameplayRecord, failed = true) => (record.state === "done" ? record : stamped({ ...record, state: "stopped", ...(failed ? { outcome: "failed" as const } : {}) }))

/** Why the AI was not satisfied with the version being kept, for the person. */
export function gameplayUnsatisfied(record: GameplayRecord, said: string | null) {
  const round = record.rounds.find((value) => value.round === record.best?.round)
  const review = record.review && !record.review.passed && record.review.fingerprint === record.best?.fingerprint ? record.review : null
  const lines = [
    ...(said ? [`停下的原因：${said}`] : []),
    ...(review ? [...review.findings.map((line) => `评审认为必须改：${line}`), ...(review.advice ?? []).map((line) => `评审认为可以更好：${line}`)] : []),
    ...(!review && round ? ["这一版通过了越界、引用和编译检查，但说明和代码是不是一回事还没有评审通过。"] : []),
    ...(round && round.round < record.rounds.length ? [`交给你的是第 ${round.round} 版：后面的版本没有通过代码检查，没有留。`] : []),
  ]
  return (lines.length ? lines : [`检查到第 ${record.rounds.length} 版（最多 ${record.rounds_allowed} 版），还没有做完。`]).slice(0, 64).map((line) => line.slice(0, 2000))
}

/** The technical detail behind `gameplayUnsatisfied`, for 高级: what whoever stopped wrote apart from its plain sentence, and the reviewer's technical notes for that version. */
export function gameplayUnsatisfiedTechnical(record: GameplayRecord, technical: string | null) {
  const review = record.review && !record.review.passed && record.review.fingerprint === record.best?.fingerprint ? record.review : null
  return [...(technical ? [technical] : []), ...(review?.technical ?? [])].slice(0, 64).map((line) => line.slice(0, 2000))
}

/** The best version was saved for the person although the loop did not pass it. */
export const keepGameplay = (record: GameplayRecord, reasons: string[], technical: string[] = []) => stamped({ ...record, state: "done", outcome: "kept_unsatisfied", kept_reason: reasons, ...(technical.length ? { kept_technical: technical } : {}), kept_round: record.best?.round, ...savedOf(record, record.best?.fingerprint) })

const FOLDER = [".minemods", "gameplay"]
const recordSegments = (assetId: string) => [...FOLDER, `${z.uuid().parse(assetId)}.json`]
const bestSegments = (assetId: string) => [...FOLDER, `${z.uuid().parse(assetId)}.best.json`]
const BestSchema = z.strictObject({ task_id: z.uuid(), fingerprint: Version, document: z.unknown() })
const absent = (error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
  throw error
}
const parsed = (text: string | null): unknown => {
  try {
    return JSON.parse(text ?? "null")
  } catch {
    return null
  }
}

/** Null when nothing was recorded, or when the file cannot be read as a record. */
export async function readGameplay(directory: string, assetId: string) {
  return GameplayRecordSchema.safeParse(parsed(await readFile(await storagePath(directory, recordSegments(assetId)), "utf8").catch(absent))).data ?? null
}

/** Caller holds the project lock. */
export async function writeGameplayUnlocked(directory: string, record: GameplayRecord) {
  await writeRecord(directory, recordSegments(record.asset_id), GameplayRecordSchema.parse(record))
  return record
}

/** Read, change and store one record as a single step. `change` may refuse by throwing; then nothing is written. */
export function changeGameplay(directory: string, assetId: string, change: (record: GameplayRecord | null) => GameplayRecord) {
  return withProjectLock(directory, async () => writeGameplayUnlocked(directory, change(await readGameplay(directory, assetId))))
}

/** The document of the best version so far, kept beside the record until the task ends. */
export async function writeGameplayBest(directory: string, assetId: string, best: z.infer<typeof BestSchema>) {
  await withProjectLock(directory, () => writeRecord(directory, bestSegments(assetId), BestSchema.parse(best)))
}

export async function readGameplayBest(directory: string, record: GameplayRecord) {
  const best = BestSchema.safeParse(parsed(await readFile(await storagePath(directory, bestSegments(record.asset_id)), "utf8").catch(absent))).data
  return best && best.task_id === record.task_id && best.fingerprint === record.best?.fingerprint && fingerprint(best.document) === best.fingerprint ? best.document : null
}

export const removeGameplayBest = async (directory: string, assetId: string) => rm(await storagePath(directory, bestSegments(assetId)), { force: true })

/** Every record of the project. Read only when a description has to be found by its plan entry, or for an export. */
export async function listGameplay(directory: string) {
  const folder = path.dirname(await storagePath(directory, [...FOLDER, "listing"]))
  const files = await readdir(folder, { withFileTypes: true }).catch((error: unknown) => absent(error) ?? [])
  return (await Promise.all(files.filter((file) => file.isFile() && /^[0-9a-f-]{36}\.json$/i.test(file.name)).map((file) => readGameplay(directory, file.name.slice(0, -5))))).flatMap((record) => (record ? [record] : []))
}

/** The record of an overview item: by the asset's id, or by the plan entry it was written for (the newest). Null when there is none. */
export async function findGameplay(directory: string, item: string) {
  const direct = z.uuid().safeParse(item).success ? await readGameplay(directory, item).catch(() => null) : null
  return direct ?? (await listGameplay(directory).catch(() => [])).filter((record) => record.entry === item).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null
}

/**
 * A record as the app shows it: no fingerprints, and the rounds' checks as they were. `held` is the document the project holds for the asset now: what the
 * record says was checked and reviewed counts for that version only, so when the project holds another one (changed by hand since, or a record left by an
 * older try) the card is told there is no record of it, not given the checks of a version that is gone.
 */
export function shownGameplay(record: GameplayRecord, held?: unknown) {
  const saved = record.saved && (held === undefined || record.saved.fingerprint === fingerprint(held)) ? record.saved : undefined
  return {
    sheet: record.sheet,
    ...(record.amendments?.length ? { amendments: record.amendments.map((value) => ({ round: value.round, because: value.because, changes: value.changes, at: value.at })) } : {}),
    rounds: record.rounds.map((round) => ({ round: round.round, at: round.at, check: round.check, passed: round.passed })),
    review: record.review ? { independent: record.review.independent, passed: record.review.passed, findings: record.review.findings, ...(record.review.advice ? { advice: record.review.advice } : {}), ...(record.review.technical ? { technical: record.review.technical } : {}), at: record.review.at, round: record.rounds.find((round) => round.fingerprint === record.review!.fingerprint)?.round ?? null } : null,
    rounds_allowed: record.rounds_allowed,
    state: record.state,
    /** What the checks said about the version the project holds; null when no check of it was recorded. */
    saved: saved
      ? {
          check: saved.check,
          at: saved.at,
          round: record.rounds.find((round) => round.fingerprint === saved.fingerprint)?.round ?? null,
          // The review of this very version, when there was one.
          review: record.review?.fingerprint === saved.fingerprint ? { independent: record.review.independent, passed: record.review.passed, findings: record.review.findings, advice: record.review.advice ?? [], technical: record.review.technical ?? [] } : null,
        }
      : null,
    ...(record.outcome ? { outcome: record.outcome } : {}),
    ...(record.kept_reason ? { kept_reason: record.kept_reason } : {}),
    ...(record.kept_technical ? { kept_technical: record.kept_technical } : {}),
    ...(record.kept_round ? { kept_round: record.kept_round } : {}),
  }
}
export type ShownGameplay = ReturnType<typeof shownGameplay>

/** Every record as archive entries. Caller holds the project lock. */
export async function archivedGameplay(directory: string) {
  const records = await listGameplay(directory)
  return Object.fromEntries(await Promise.all(records.map(async (record) => [`.minemods/gameplay/${record.asset_id}.json`, new Uint8Array(await readFile(await storagePath(directory, recordSegments(record.asset_id))))] as const)))
}

/** The archive paths that are gameplay records: each must be a record of the asset its name says. Throws on anything else under the folder. */
export function archivedGameplayPaths(entries: Record<string, Uint8Array>) {
  const paths = Object.keys(entries).filter((name) => name.startsWith(".minemods/gameplay/"))
  paths.forEach((name) => {
    const record = GameplayRecordSchema.parse(JSON.parse(Buffer.from(entries[name]!).toString("utf8")))
    if (name !== `.minemods/gameplay/${record.asset_id}.json`) throw new Error("Gameplay record does not match its name")
  })
  return paths
}

import { planLook, planReview } from "./look-plan"
import { z } from "zod"
import { ASSET_STANDARDS, CRITERIA, told, type AssetReview } from "@minemods/mod-core/acceptance"
import type { EffectLookup } from "@minemods/mod-core/effect-abilities"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import { blueprintSourceKey } from "@minemods/mod-core/task-source"
import { redoRemark } from "@minemods/mod-core/blueprint-production"
import { abilityWords } from "@minemods/mod-core/creature-abilities"
import { hitboxLooked } from "@minemods/mod-core/creature-hitbox"
import { sizeNextToPlayer, type TierAskReview, type TierReferences, type TierReview } from "@minemods/mod-core/creature-tier"
import { TIER_UNUSED } from "@minemods/studio-ai/budget"
import type { TracePicture } from "@minemods/studio-ai/script"
import { STATIC_ITEM_MODEL_STANDARD } from "@minemods/mod-core/item-model-quality"
import { staticItemScope, STATIC_ITEM_REVIEW_GUIDE, styleThreeViewInstructions, type SixViewStyle } from "@minemods/studio-ai/making"
import {
  ABILITY_REVIEWER_INSTRUCTIONS,
  abilityScope,
  begin,
  BLIND_INSTRUCTIONS,
  BLIND_REVIEW_RULE,
  BLIND_SHOWN,
  BLIND_SHOWN_SHAPE,
  BlindAnswerSchema,
  blindAnswered,
  blindDue,
  BlindReviewerAnswerSchema,
  changeMaking,
  commitGate,
  continuityFindings,
  copyFinding,
  outsideFindings,
  describe,
  findingLines,
  fingerprint,
  finalReview,
  finish,
  isBlindNamed,
  isFlat,
  isLooked,
  isSheetless,
  keep,
  listMakings,
  looked,
  makingVersion,
  lookGate,
  glanceGate,
  looksAt,
  MAKING_LIMITS,
  MakingRefusal,
  needGate,
  PartSheetDraftSchema,
  prunePictures,
  readBest,
  readMaking,
  readPicture,
  REFERENCE_LIMITS,
  ReferenceRefusal,
  REFUSALS,
  removeBest,
  reviewable,
  reviewAsked,
  ReviewerAnswerSchema,
  REVIEWER_INSTRUCTIONS,
  reviewScope,
  reviewShown,
  selfReview,
  selfReviewed,
  SelfReviewSchema,
  setConcepts,
  sheetVersion,
  shownReferences,
  stop,
  tierFindings,
  unsatisfied,
  unsatisfiedTechnical,
  unseenMotions,
  writeBest,
  writeMakingUnlocked,
  writePictures,
  type BlindFit,
  type LookOptions,
  type MakingRecord,
  type ReferenceKind,
  type ReviewNeed,
  type ThreeViewBy,
  type ThreeViewSlot,
  viewSlot,
  SIX_VIEWS,
  threeViewCover,
} from "@minemods/mod-core/making"
import type { ProjectRun, RunTask } from "../project-runs"
import { worldNeighbours, type WorldSource } from "@minemods/mod-core/making-world"
import { blindSheet, HITBOX_SHEET, lookJob, needJob, referenceSheet, type AbilityMoments, type LookJob, type LookPictures, type LookProgress, type LookRenderer, type LookWorld } from "./look-job"

type Model = Extract<ModuleDocument, { kind: "model" }>

/** One task's work as the loop needs to know it. Both ways of making build this and nothing else. */
/** Said with a look whose version Studio could not measure because of a fault of its own. */
export const MEASURE_BROKE = "Studio 自己量这一版的时候出了故障，这一版的量化检查没有做（不是你的问题，图照常给你）。请照图自评，并把这件事原样告诉用户。"

export function designNotes(feedback?: ReturnType<NonNullable<MakingWork["designFeedback"]>>) {
  return feedback ? [...feedback.facts, ...feedback.hints.map((issue) => `改进建议：${issue.text} ${issue.fix}`)] : []
}

export type MakingWork = {
  /** A workspace model used only by items: enforce static export and omit creature anatomy/gait requirements. */
  itemOnly?: boolean
  directory: string
  run: Pick<ProjectRun, "prompt">
  task: Pick<RunTask, "id" | "asset_id" | "module" | "title" | "prompt" | "source">
  /** The model a texture dresses or an animation moves, when the project knows one. */
  wears: (document: ModuleDocument, requireReady?: boolean) => Model | null
  /**
   * r29: the document as its pictures are drawn: a creature with the abilities it uses from ability assets (`shared_abilities`) among its own, so their hits are drawn and
   * a reviewer is given them (a reviewer once wrote that the material named no charge, the one move the creature had). Left out: the document as it is.
   */
  drawn?: (document: ModuleDocument) => ModuleDocument
  /** The concept pictures of this thing, made ready for `api.trace` in a script (`conceptPictures`). Read when asked, since decoding is work; left out: none. */
  concepts?: () => Promise<TracePicture[]>
  /** Blocks a second the creature this thing belongs to walks at, when the project already says: what its planted feet are held to. Left out or null: not known yet. */
  speed?: (document: ModuleDocument) => number | null
  /** H3: the project's effect assets by id, for drawing a creature's abilities with the effects they show. Left out: abilities are drawn without them. */
  particles?: (document:ModuleDocument)=>Extract<ModuleDocument,{kind:"particle"}>[]
  effects?: EffectLookup
  designFeedback?: (document: ModuleDocument) => { hints: import("@minemods/mod-core/combat-design").DesignHint[]; facts: string[] }
  /** Round 10: the moments of this thing's motions that an ability of a creature wearing it is read by (`abilityMoments`): a strip of such a motion always shows them. Left out: none known. */
  moments?: (document: ModuleDocument) => AbilityMoments
  /** Round 10: why the save itself would refuse this version (a schema, the compile, what the exported file may hold), or null: asked at every look, so nothing looked at turns out unsaveable at the hand-in. Left out: not asked. */
  saves?: (document: ModuleDocument) => Promise<string | null>
  /** creature tier (10-12): why a part sheet is refused for the geometry budget it names (the blueprint's tier for the creature asks for more), or null. Left out: nothing is asked. */
  sheetRefusal?: (sheet: { budget?: { tier: string } | null }) => string | null
  /** broad5 w3: the budget the blueprint's tier for the creature keeps, with the words that answer it on the sheet, or null. Left out: none. */
  sheetKeeps?: () => { tier: string; reason: string } | null
  /** broad11: what the independent reviewer of a model is told of the tier of the creature it belongs to (`tierReviewOf`), given what is attached to it; null for every other thing and for the tiers that are reviewed as before. Left out: nothing. */
  tier?: (attached: TierReferences) => TierReview | null
  /** broad21: what the independent reviewer of a creature's abilities is told the blueprint's tier asks of it, and what is measurably missing (`tierAskReviewOf`); null for the tiers that ask nothing more. Left out: nothing. */
  tierAsks?: (creature: Extract<ModuleDocument, { kind: "entity" }>) => TierAskReview | null
  /** The deterministic standard's review of a version, the same one the hand-in door applies. */
  judge: (document: ModuleDocument) => Promise<AssetReview>
  /** What the plan says will not be made, in its own words: handed to a reviewer as outside what it judges. */
  outside: string[]
}

/**
 * The game's own pictures a block or an item is looked at beside; null for every other kind and when the
 * game cannot be read here. They are read into memory for this one look. Whatever is drawn with them is
 * handed to whoever looks and never stored: see `look`, `packet` and `besidePicture`.
 */
export async function worldFor(source: WorldSource | undefined, document: ModuleDocument): Promise<LookWorld> {
  if (document.kind !== "block" && document.kind !== "item") return null
  const art = await source?.().catch(() => null)
  return art ? worldNeighbours(art, document) : null
}

/**
 * A block or an item set among the game's own, for the person's own eyes: drawn when asked for, handed
 * over as a data URL and kept nowhere. Null when the kind has no such picture, the game cannot be read
 * here, or nothing could be drawn.
 */
export async function besidePicture(options: { look?: LookRenderer; world?: WorldSource }, document: ModuleDocument) {
  if (!options.look || !isFlat(document.kind)) return null
  const sheet = lookJob(document, null, {}, null, await worldFor(options.world, document)).world
  const drawn = sheet ? await options.look({ scenes: [], sheets: [sheet] }) : null
  return drawn?.ok ? (drawn.pictures[0] ?? null) : null
}

const missing = (): never => {
  throw new MakingRefusal(REFUSALS.no_sheet)
}

/**
 * The making loop as Studio runs it: describe → look → self-review → review by someone who took no part.
 * Studio's own AI and an outside AI's tools both call these functions and only these, so there is one
 * protocol and one record. Without a renderer the loop is off and work is checked by the standard alone.
 */
export function createMakingLoop(options: { look?: LookRenderer; particleLook?:()=>boolean; /** The game's own pictures, when the game is installed under Studio's own build folder (`making-world.ts`). */ world?: WorldSource }) {
  const enabled=(kind:string)=>kind!=="particle" || options.particleLook?.()!==false
  const on = (kind: string) => Boolean(options.look) && isLooked(kind)
  /**
   * Round 10: whether this very version goes through the loop: every version of a looked kind, and a creature's version that has abilities.
   * K1: or collision boxes to look at. `wears` is the model the creature wears, when the caller knows it: the one box a
   * creature gets without stating any is measured on that model, and one that does not fit is looked at too.
   */
  const reviews = (document: ModuleDocument, wears: ModuleDocument | null = null) => Boolean(options.look) && enabled(document.kind) && looksAt(document, document.kind === "entity" && wears?.kind === "model" && hitboxLooked(document, wears))
  /** Round 10: whether a task of this kind may have a record of a making at all: what ends, rescues and keeps ask before they look for one. */
  const records = (kind: string) => Boolean(options.look) && enabled(kind) && (isLooked(kind) || isSheetless(kind))

  const worldOf = (document: ModuleDocument) => worldFor(options.world, document)

  /** The record of this task's making, started if this is the first step. A redo starts from the sheet of the version before. */
  async function open(work: MakingWork) {
    const current = await readMaking(work.directory, work.task.asset_id)
    if (current?.task_id === work.task.id) return current
    const entry = blueprintSourceKey(work.task.source)
    // A plan entry tried again is a new asset: its earlier sheet is found by the entry, the newest first.
    const earlier = current ?? (entry ? ((await listMakings(work.directory)).filter((record) => record.entry === entry).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null) : null)
    const record = await changeMaking(work.directory, work.task.asset_id, (latest) =>
      begin(latest ?? earlier, { asset_id: work.task.asset_id, entry, kind: work.task.module, request: work.run.prompt, brief: work.task.prompt, task_id: work.task.id, remark: redoRemark(work.task.prompt), sheetless: isSheetless(work.task.module) }),
    )
    await prunePictures(work.directory, record)
    // Views an AI drew for the version before were of what it meant then. The person's own references, and the 六视图 (the shape the person settled on), stay.
    await setConcepts(work.directory, ownerOf(work), []).catch(() => null)
    return record
  }

  /** A reference as an AI is told of it: by name, and a view of the 六视图 by its slot (a `side` from three views as the left it is read as) and whose it is. */
  const named = (reference: { kind: ReferenceKind; name: string; view?: ThreeViewSlot; by?: ThreeViewBy; style?: SixViewStyle }) => ({ kind: reference.kind, name: reference.name, ...(reference.view ? { view: viewSlot(reference.view) } : {}), ...(reference.by ? { by: reference.by } : {}), ...(reference.style ? { style: reference.style } : {}) })
  const threeViewOf = (references: { kind: ReferenceKind; view?: ThreeViewSlot; by?: ThreeViewBy }[]) => {
    const views = references.filter((reference) => reference.kind === "three_view")
    const given = views.flatMap((reference) => (reference.view ? [viewSlot(reference.view)] : []))
    // Separate views name their directions, so the ones not given are known; a whole sheet's are read off the picture.
    const missing = views.length && !given.includes("sheet") ? SIX_VIEWS.filter((view) => !given.includes(view)) : []
    return { present: views.length > 0, by: views[0]?.by ?? null, views: given, missing, words: threeViewCover(given, missing) }
  }

  /** The overview item this task's thing is: its plan entry when it has one, else the asset itself. References are kept under it. */
  const ownerOf = (work: MakingWork) => blueprintSourceKey(work.task.source) ?? work.task.asset_id

  /** What is attached to this task's thing: the plan entry's and the asset's are one list, the person's own first. */
  const referencesOf = (work: MakingWork) => shownReferences(work.directory, [blueprintSourceKey(work.task.source), work.task.asset_id]).catch(() => [])

  /**
   * The references on one sheet, as a picture to show beside the renders; null when there are none or the
   * sheet could not be drawn. It is not a picture of any version, so it is never stored with a round.
   */
  async function referencePicture(work: MakingWork, signal?: AbortSignal) {
    const sheet = referenceSheet(await referencesOf(work), REFERENCE_LIMITS.shown)
    signal?.throwIfAborted()
    const drawn = sheet ? await options.look!({ scenes: [], sheets: [sheet] }, undefined, signal) : null
    return drawn?.ok ? (drawn.pictures[0] ?? null) : null
  }

  const change = (work: MakingWork, step: (record: MakingRecord) => MakingRecord) =>
    changeMaking(work.directory, work.task.asset_id, (record) => step(record?.task_id === work.task.id ? record : missing()))

  /** A job of any size, drawn a look's worth at a time so that each part has the time limit to itself. */
  const draw = (job: LookJob, progress?: LookProgress) =>
    Array.from({ length: Math.ceil(job.sheets.length / MAKING_LIMITS.sheets) }, (_, index) => job.sheets.slice(index * MAKING_LIMITS.sheets, (index + 1) * MAKING_LIMITS.sheets)).reduce<Promise<LookPictures>>(async (before, sheets) => {
      const drawn = await before
      if (!drawn.ok) return drawn
      const more = await options.look!({ scenes: job.scenes, sheets }, progress && ((done) => progress(drawn.pictures.length + done, job.sheets.length)))
      return more.ok ? { ok: true, pictures: [...drawn.pictures, ...more.pictures] } : more
    }, Promise.resolve({ ok: true, pictures: [] }))

  /** The version under review: its record, its round, and its document, which was kept when it was looked at. */
  async function reviewed(work: MakingWork) {
    const record = await readMaking(work.directory, work.task.asset_id)
    if (record?.task_id !== work.task.id || (!record.sheet && !record.sheetless)) return missing()
    const round = reviewable(record)
    const document = record.best?.fingerprint === round.fingerprint ? ((await readBest(work.directory, record)) as ModuleDocument | null) : null
    if (!document) throw new MakingRefusal(REFUSALS.no_document)
    return { record, round, document, sheet: record.sheet }
  }

  const urls = async (work: MakingWork, pictures: { label: string; file: string }[]) =>
    (await Promise.all(pictures.map(async (picture) => ({ label: picture.label, url: await readPicture(work.directory, work.task.asset_id, picture.file) })))).flatMap((picture) => (picture.url ? [{ label: picture.label, url: picture.url }] : []))

  return {
    on,
    reviews,
    records,
    open,
    /** The maker's part sheet for this task. */
    async describe(work: MakingWork, sheet: unknown) {
      await open(work)
      const parsed = PartSheetDraftSchema.parse(sheet)
      const refused = work.sheetRefusal?.(parsed)
      if (refused) throw new MakingRefusal(refused)
      // The tier's budget is answered on the sheet in the tier's words, so no look asks to lower it (see `tierBudgetKept`).
      const keeps = work.sheetKeeps?.()
      const draft =
        keeps && parsed.budget?.tier === keeps.tier && !parsed.justified.some((value) => value.what.trim().toLowerCase() === TIER_UNUSED)
          ? { ...parsed, justified: [...parsed.justified, { what: TIER_UNUSED, reason: keeps.reason }] }
          : parsed
      return change(work, (record) => describe(record, draft))
    },
    /**
     * Draw one version and record that the maker was shown it. Refused, before anything is drawn, when the
     * loop does not allow a look yet. A picture that could not be drawn is a refusal too: nothing was seen.
     * A version the standard does not refuse is kept whole, so it can still be handed to the person if the
     * loop ends without a pass.
     */
    async look(work: MakingWork, document: ModuleDocument, asked: LookOptions = {}, script?: string, glance = false, progress?: LookProgress, signal?: AbortSignal) {
      signal?.throwIfAborted()
      const before = await open(work)
      // r29c: under a sheet rewritten after a failed review the same document is a new version (`makingVersion`).
      const version = makingVersion(before, document)
      // 边做边看 (10-07): a glance draws and measures what is on the bench exactly as a look does and leaves no trace — no round is opened,
      // nothing is stored or kept as the best, and no self-review is owed for it. Only a look counts as a version seen.
      const gate = glance ? glanceGate(before) : lookGate(before, version)
      // Another look at the version the last round was of, after the part sheet's answers changed (a reason written, a motion declared still): this look judges the same document against the
      // new sheet. A caller that would call a resubmitted, unchanged document a failure (`REFUSALS.unchanged`) must not here: nothing was resubmitted, the maker answered.
      const previous = before.rounds.at(-1)
      const rejudged = !gate.opens && previous !== undefined && previous.fingerprint === version && previous.sheet !== undefined && previous.sheet !== sheetVersion(before.sheet)
      const made = await planLook([work.drawn?.(document) ?? document, work.wears(document, true), asked, before.sheet, await worldOf(document), work.speed?.(document) ?? null, work.effects ?? null, work.moments?.(document) ?? {}, work.itemOnly], signal)
      made.notes.push(...designNotes(work.designFeedback?.(document)))
      if (work.itemOnly && document.kind === "model") made.notes.push(STATIC_ITEM_REVIEW_GUIDE)
      // A picture that is one of the game's own over again is refused before anything is drawn or kept: its pixels are not this project's to store.
      const copy = made.texture && isFlat(document.kind) ? copyFinding(document.kind, made.texture) : null
      if (copy) throw new MakingRefusal(copy)
      // One more cell rides along: a single view, for the small picture of this round. The maker is not shown it.
      // The sheet that sets the thing among the game's own comes last: it is shown and, like a reference, never stored.
      const visible = made.job.sheets.length + Number(Boolean(made.world))
      signal?.throwIfAborted()
      progress?.(0, visible)
      const drawn = await options.look!(
        { ...made.job, sheets: [...made.job.sheets, made.cover, ...(made.world ? [made.world] : [])] },
        progress && ((done) => progress(done > made.job.sheets.length ? done - 1 : done, visible)),
        signal,
      )
      signal?.throwIfAborted()
      if (!drawn.ok) throw new MakingRefusal(REFUSALS.render_failed(drawn.reason))
      const pictures = drawn.pictures.slice(0, made.job.sheets.length)
      const beside = drawn.pictures.slice(made.job.sheets.length + 1)
      // A fault inside Studio's own measuring is not the maker's: the look goes on unmeasured and says so, instead of ending with no pictures.
      const broke: string[] = []
      const review = await work.judge(document).catch((error: unknown) => {
        if (error instanceof MakingRefusal) throw error
        console.error("making: the standard could not be measured", error)
        broke.push(MEASURE_BROKE)
        return null
      })
      // What the hand-in would refuse beyond the standard is a finding now, in the same words: a version that cannot be saved is not kept as the best.
      signal?.throwIfAborted()
      const unsaveable = (await work.saves?.(document)) ?? null
      signal?.throwIfAborted()
      const findings = [...(!review || review.passed ? [] : findingLines(told(review))), ...(unsaveable ? [unsaveable] : [])]
      const reference = await referencePicture(work, signal)
      signal?.throwIfAborted()
      if (glance)
        return { record: before, round: before.rounds.length, own: pictures.length, skipped: null, rejudged, pictures: [...pictures, ...beside, ...(reference ? [reference] : [])], findingDetails: made.findingDetails, findings: [...findings, ...broke, ...unseenMotions(before.sheet, made.motion), ...continuityFindings(before.sheet, made.motion), ...(isFlat(document.kind) ? outsideFindings(document.kind, before.sheet, made.texture) : []), ...(made.measured ?? []), ...tierFindings(before.sheet, made.budget)], notes: made.notes, motion_facts: made.facts, texture_facts: made.texture_facts ?? [], budget_facts: made.budget_facts ?? [] }
      const round = before.rounds.length + (gate.opens ? 1 : 0)
      const stored = await writePictures(work.directory, work.task.asset_id, round, pictures)
      signal?.throwIfAborted()
      if (!stored.length) throw new MakingRefusal(REFUSALS.render_failed("画出来的不是能用的图片。"))
      const cover = (await writePictures(work.directory, work.task.asset_id, round, drawn.pictures.slice(made.job.sheets.length, made.job.sheets.length + 1), "c"))[0]?.file
      signal?.throwIfAborted()
      if (!findings.length) await writeBest(work.directory, work.task.asset_id, { task_id: work.task.id, fingerprint: version, document, ...(before.resheet ? { resheet: before.resheet } : {}) })
      const record = await change(work, (current) => {
        signal?.throwIfAborted()
        return looked(current, { fingerprint: version, pictures: stored, findings, cover, script, motion: made.motion, texture: made.texture, budget: made.budget, measured: made.measured })
      })
      await prunePictures(work.directory, record)
      // Motion (Engineer Q): a motion nobody can see moving is handed back with the standard's findings, to be changed or declared still; the version is kept all the same.
      // `own`: how many of the pictures are of this version itself; what follows them (the game's own beside it, the references) is set beside it and is the same at every look.
      // `skipped`: the round this look moved on from without a self-review (see `lookGate`); null when it left none behind.
      return { record, round: record.rounds.length, own: pictures.length, skipped: gate.skipped, rejudged, pictures: [...pictures, ...beside, ...(reference ? [reference] : [])], findingDetails: made.findingDetails, findings: [...findings, ...broke, ...unseenMotions(record.sheet, made.motion), ...continuityFindings(record.sheet, made.motion), ...(isFlat(document.kind) ? outsideFindings(document.kind, record.sheet, made.texture) : []), ...(record.rounds.at(-1)?.measured ?? []), ...tierFindings(record.sheet, made.budget)], notes: made.notes, motion_facts: made.facts, texture_facts: made.texture_facts ?? [], budget_facts: made.budget_facts ?? [] }
    },
    /** The references of this task's thing on one sheet, for a maker who has not looked at anything yet. */
    referencePicture,
    /** What is attached to this task's thing, by name; a three-view also by its slot and whose it is. */
    references: async (work: MakingWork) => (await referencesOf(work)).map(named),
    /** The same references with the pictures themselves, in the same order (`view_reference` picks one by its number in that list). */
    referencePictures: (work: MakingWork) => referencesOf(work),
    /** 2026-10-08: whether this task's thing has a 六视图 to follow, whose it is, and which views it holds (a `side` from three views is read as `left`). */
    threeView: async (work: MakingWork) => threeViewOf(await referencesOf(work)),
    /** Views the maker drew of what it intends, before modelling: kept as this thing's concept views, in place of any it drew before. */
    async concepts(work: MakingWork, views: { name: string; url: string }[]) {
      await open(work)
      await setConcepts(work.directory, ownerOf(work), views).catch((error: unknown) => Promise.reject(error instanceof ReferenceRefusal ? new MakingRefusal(error.message) : error))
      return (await referencesOf(work)).map(named)
    },
    /** What the maker says about the version it has just been shown. */
    selfReview: (work: MakingWork, review: unknown, finishParticle=false) => change(work, record=>{
      const opinion=SelfReviewSchema.parse(review)
      const reviewed=selfReview(record,opinion)
      return finishParticle && record.kind==="particle" && reviewed.state==="reviewing" && opinion.verdict==="done" ? finalReview(reviewed,{passed:true,findings:[],advice:opinion.advice??[],independent:false,unblinded:true,named:work.task.title}) : reviewed
    }),
    /** Whether the version last looked at already has a self-review, which a new one then replaces. */
    selfReviewed: async (work: MakingWork) => {
      const record = await readMaking(work.directory, work.task.asset_id)
      return record?.task_id === work.task.id && selfReviewed(record)
    },
    /**
     * Round 17, 盲认: the first hand-off of a review of something a player has to recognise at a glance. The picture
     * alone at the size the game shows it, and the question what it is; no name, no sheet, no request, no criteria.
     * Null when this version is not named blind or already has been: then the packet is what a reviewer is given.
     * The picture is drawn for this hand-off and not stored: it is the version's own picture, which the record holds.
     */
    async blind(work: MakingWork, progress?: LookProgress) {
      const held = await reviewed(work)
      const sheet = blindDue(held.record) ? blindSheet(held.document) : null
      if (!sheet || !isBlindNamed(held.record.kind)) return null
      progress?.(0, 1)
      const drawn = await options.look!({ scenes: [], sheets: [sheet] }, progress)
      if (!drawn.ok || !drawn.pictures.length) throw new MakingRefusal(REFUSALS.review_not_drawn(drawn.ok ? "画出来的不是能用的图片。" : drawn.reason))
      return { instructions: BLIND_INSTRUCTIONS, input: { showing: held.document.kind === "block" && held.document.shape ? BLIND_SHOWN_SHAPE : BLIND_SHOWN[held.record.kind] }, pictures: drawn.pictures, answer_schema: z.toJSONSchema(BlindAnswerSchema) as Record<string, unknown> }
    },
    /** What was said of the picture alone. Recorded before anything else of the thing is handed over; it cannot be answered twice. */
    blindAnswer: (work: MakingWork, answer: unknown) => change(work, (record) => blindAnswered(record, BlindAnswerSchema.parse(answer))),
    /**
     * All that a reviewer who took no part is given: what is being judged and what is not, the sheet, the
     * criteria of this kind, the person's words for context, and the whole set of pictures, drawn afresh
     * from the final document the first time it is asked for.
     */
    async packet(work: MakingWork, progress?: LookProgress) {
      const held = await reviewed(work)
      const world = await worldOf(held.document)
      const made = await planReview(work.drawn?.(held.document) ?? held.document, work.wears(held.document, true), held.sheet, world, work.speed?.(held.document) ?? null, work.effects ?? null, work.moments?.(held.document) ?? {}, work.itemOnly)
      made.notes.push(...designNotes(work.designFeedback?.(held.document)))
      // Round 10: a creature is reviewed for its abilities: no sheet; its brief, the abilities in words and what was measured stand in its place.
      const creature = held.document.kind === "entity" ? held.document : null
      // Count the fresh sheets together, even when separate renderer jobs draw them.
      const particleSheets=(work.particles?.(held.document)??[]).flatMap(p=>lookJob(p,null,{},null,null,null,work.effects && Object.assign((id:string)=>work.effects!(id),{examples:()=>work.effects?.examples?.(p,held.document) ?? []}) || null).job.sheets)
      const have = (held.round.review_pictures ?? []).filter((picture) => !picture.asked)
      const worldCount = Number(Boolean(made.world))
      const total = worldCount + particleSheets.length + (have.length ? 0 : made.job.sheets.length)
      const onDraw = (offset: number): LookProgress | undefined => progress && ((done) => progress(offset + done, total))
      progress?.(0, total)
      const beside = made.world ? await options.look!({ scenes: [], sheets: [made.world] }, onDraw(0)).then((drawn) => (drawn.ok ? drawn.pictures : [])) : []
      const particles=particleSheets.length ? await draw({scenes:[],sheets:particleSheets}, onDraw(worldCount)) : null
      if(particles && !particles.ok)throw new MakingRefusal(REFUSALS.review_not_drawn(particles.reason))
      const record = have.length ? held.record : await (async () => {
        const drawn = await draw(made.job, onDraw(worldCount + particleSheets.length))
        if (!drawn.ok) throw new MakingRefusal(REFUSALS.review_not_drawn(drawn.reason))
        const stored = await writePictures(work.directory, work.task.asset_id, held.round.round, drawn.pictures, "r")
        if (!stored.length) throw new MakingRefusal(REFUSALS.review_not_drawn("画出来的不是能用的图片。"))
        return change(work, (current) => {
          if (reviewable(current).fingerprint !== held.round.fingerprint || sheetVersion(current.sheet) !== sheetVersion(held.sheet))
            throw new MakingRefusal("画图期间，待审查版本或部件说明变了。请重新领取当前版本的审查材料。")
          return reviewShown(current, stored)
        })
      })()
      const staticItem = work.itemOnly && held.document.kind === "model"
      const outline = staticItem ? STATIC_ITEM_MODEL_STANDARD : isLooked(record.kind) || creature ? ASSET_STANDARDS[record.kind] : null
      // Round 17: named blind first, the reviewer is now told what was said then and has to say whether that was the thing.
      const blind = held.round.blind ? { sees: held.round.blind.sees, also: held.round.blind.also, because: held.round.blind.because } : null
      // broad11: a model of a creature the blueprint put at 精细 or above is judged for what its tier asks too, and is told how big it is next to the player.
      const attached = await referencesOf(work)
      const tier = held.document.kind === "model" ? (work.tier?.({ three_view: attached.some((value) => value.kind === "three_view"), user: attached.filter((value) => value.kind === "user").length, concept: attached.filter((value) => value.kind === "concept").length }) ?? null) : null
      const tierAsks = creature ? (work.tierAsks?.(creature) ?? null) : null
      const budget_facts = [...(made.budget_facts ?? []), ...(tier && held.document.kind === "model" ? [sizeNextToPlayer(held.document)] : [])]
      return {
        instructions: creature ? ABILITY_REVIEWER_INSTRUCTIONS : styleThreeViewInstructions(`${REVIEWER_INSTRUCTIONS}${blind ? BLIND_REVIEW_RULE : ""}${staticItem ? STATIC_ITEM_REVIEW_GUIDE : ""}`, attached),
        input: {
          ...(blind ? { blind } : {}),
          ...(creature
            ? { ...abilityScope(work.task.title, work.outside, { abilities: Boolean(creature.abilities?.length), hitbox: made.job.sheets.some((sheet) => sheet.label === HITBOX_SHEET) }), brief: record.brief, abilities: (creature.abilities ?? []).map((ability) => `招式「${ability.name}」（id ${ability.id}，播动作 ${ability.clip}）：${[abilityWords.summary(ability, "；", undefined, undefined, creature.stagger), ...abilityWords.terrain(ability)].join("；")}。`), ability_facts: made.notes, ...(tierAsks ? { tier_asks: tierAsks } : {}) }
            : { ...(staticItem ? staticItemScope(work.task.title, work.outside) : reviewScope(isLooked(record.kind) ? record.kind : "model", work.task.title, work.outside, held.document.kind === "block" && Boolean(held.document.shape))), part_sheet: held.sheet, ...(tier ? { tier } : {}) }),
          criteria: CRITERIA.filter((value) => outline?.rules.some((rule) => rule.criterion === value.id) || outline?.told?.[value.id]).map((value) => `${value.name}：${value.meaning}`),
          request: record.request,
          ...(made.facts.length ? { motion_facts: made.facts } : {}),
          ...(budget_facts.length ? { budget_facts } : {}),
          ...(made.texture_facts?.length ? { texture_facts: made.texture_facts } : {}),
          ...(!creature && made.notes.some((line) => line.startsWith("改进建议：")) ? { design_advice: made.notes.filter((line) => line.startsWith("改进建议：")) } : {}),
        },
        pictures: [...(await urls(work, record.rounds.at(-1)?.review_pictures ?? [])), ...beside, ...(particles?.ok ? particles.pictures:[]), ...(await referencePicture(work).then((reference) => (reference ? [reference] : [])))],
        notes: made.notes,
        answer_schema: z.toJSONSchema(blind ? BlindReviewerAnswerSchema : ReviewerAnswerSchema) as Record<string, unknown>,
        /** Round 17: this version was named blind, so the answer has to say how the picture fits the thing (`fits`). */
        blind_named: Boolean(blind),
        needs_left: MAKING_LIMITS.needs - (record.rounds.at(-1)?.asked ?? 0),
      }
    },
    /** The reviewer could not see something: draw what it asked for. Refused, before anything is drawn, once it has asked as often as one review may. */
    async need(work: MakingWork, needs: ReviewNeed[]) {
      const held = await reviewed(work)
      needGate(held.record)
      const drawn = await draw(needJob(held.document, work.wears(held.document, true), needs, work.effects ?? null, work.itemOnly).job)
      if (!drawn.ok) throw new MakingRefusal(REFUSALS.review_not_drawn(drawn.reason))
      const stored = await writePictures(work.directory, work.task.asset_id, held.round.round, drawn.pictures, "n")
      if (!stored.length) throw new MakingRefusal(REFUSALS.review_not_drawn("画出来的不是能用的图片。"))
      const record = await change(work, (current) => reviewAsked(current, stored))
      return { pictures: await urls(work, stored), needs_left: MAKING_LIMITS.needs - (record.rounds.at(-1)?.asked ?? 0) }
    },
    /** The reviewer's conclusion about the last version. */
    /** Round 17: `fits` (or `recognised`, from a caller of before) is the reviewer's word on a blind answer; `unblinded` says the review switch is off and nobody could name it blind. */
    review: (work: MakingWork, verdict: { passed: boolean; findings: string[]; advice?: string[]; technical?: string[]; independent: boolean; fits?: BlindFit; recognised?: boolean; unblinded?: boolean }) => change(work, (record) => finalReview(record, { ...verdict, named: work.task.title })),
    /**
     * Why this version may not be saved, or null. For the hand-in door, which holds the project lock.
     * `kept` asks about the other way in: the best version looked at, when the loop has ended without a pass.
     */
    gate: async (directory: string, task: Pick<RunTask, "id" | "asset_id">, document: ModuleDocument, kept = false) => {
      const found = await readMaking(directory, task.asset_id)
      const record = found?.task_id === task.id ? found : null
      // A thing looked at without a sheet that was never looked at is asked for the look, not for a sheet.
      if (!kept && !record && isSheetless(document.kind)) return REFUSALS.no_look
      if (!kept) return commitGate(record, makingVersion(record, document))
      return record && record.state !== "done" && (record.best?.fingerprint === makingVersion(record, document) || record.best?.fingerprint === fingerprint(document)) ? null : REFUSALS.unseen
    },
    /** The best version looked at that the standard does not refuse, with its document; null when there is none. */
    best: async (directory: string, task: Pick<RunTask, "id" | "asset_id">) => {
      const record = await readMaking(directory, task.asset_id).catch(() => null)
      if (record?.task_id !== task.id || record.state === "done" || !record.best) return null
      const document = (await readBest(directory, record).catch(() => null)) as ModuleDocument | null
      return document ? { document, round: record.best.round } : null
    },
    /** Round 10: whether this task has a record of a making: how a step that has no document in hand knows a creature's task is in the loop. */
    begun: async (directory: string, task: Pick<RunTask, "id" | "asset_id">) => (await readMaking(directory, task.asset_id).catch(() => null))?.task_id === task.id,
    /** Round 10: a version that does not go through the loop was saved although this task had looked at earlier ones (a creature handed in without abilities after all): the making is closed without a verdict. Caller holds the project lock. */
    bypassed: async (directory: string, task: Pick<RunTask, "id" | "asset_id">) => {
      const record = await readMaking(directory, task.asset_id).catch(() => null)
      if (record?.task_id !== task.id || record.state === "done") return
      await writeMakingUnlocked(directory, stop(record, false))
      await removeBest(directory, task.asset_id).catch(() => null)
    },
    /** The version was saved. `kept`: not because the loop passed it, but so the person can judge it; `said` is why whoever stopped did. Caller holds the project lock. */
    saved: async (directory: string, task: Pick<RunTask, "id" | "asset_id">, kept?: { said: string | null; technical?: string | null }) => {
      const record = await readMaking(directory, task.asset_id)
      if (record?.task_id !== task.id) return
      await writeMakingUnlocked(directory, kept ? keep(record, unsatisfied(record, kept.said), unsatisfiedTechnical(record, kept.technical ?? null)) : finish(record))
      await removeBest(directory, task.asset_id)
    },
    /** The task ended without saving. `failed` is false when it was called off. */
    ended: async (directory: string, task: Pick<RunTask, "id" | "asset_id">, failed = true) => {
      const record = await readMaking(directory, task.asset_id).catch(() => null)
      if (record?.task_id === task.id && record.state !== "done") await changeMaking(directory, task.asset_id, (latest) => stop(latest ?? record, failed)).catch(() => null)
      await removeBest(directory, task.asset_id).catch(() => null)
    },
  }
}
export type MakingLoop = ReturnType<typeof createMakingLoop>

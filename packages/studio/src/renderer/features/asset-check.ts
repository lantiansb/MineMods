import { CRITERIA, reviewAsset, type AssetReview } from "@minemods/mod-core/acceptance"
import type { Project } from "@minemods/mod-core/project"
import type { ModuleDocument } from "@minemods/mod-core/workspace"
import type { OverviewItem } from "../../api"

type Tile = Pick<OverviewItem, "id" | "asset_id" | "kind" | "brief" | "needs" | "preview" | "judged">
type Shown = { id: string; asset_id: string | null }
type Draft = { kind: string; document: unknown; progress: number | null }
/** The reasons of a part sheet (`sheetReasons`), or null when it gives none. */
type Justified = readonly { what: string; reason: string }[] | null

/** One acceptance review laid out for the card: every criterion in the standard's order, with what it found. */
export type AssetCheck = {
  passed: boolean
  /** An outside AI's hand-in that is not saved yet. */
  draft: boolean
  /** Findings are listed but not held against it: an AI's change to a person's own work that did not pass either. */
  spared: boolean
  /** The brief asked for something simple, so only defects were looked for. */
  simple: boolean
  unreadable: AssetReview["unreadable"]
  found: number
  criteria: {
    id: string
    name: string
    meaning: string
    /** What the check looks at or counts, in one plain line: what a tick or a cross stands on. */
    measures: string
    state: "passed" | "failed" | "unmeasured"
    note: string | null
    findings: { rule: string; message: string; fix: string; plain?: string }[]
    /** What a rule measured and could not call a fault: shown beside the criterion, never refused for. */
    advice: { rule: string; message: string }[]
    /**
     * The rules of this check that ran and passed, each with the numbers it passed on (`read`), or null when there is nothing to count and the card says what it
     * looked at (`asks`). Only what the review records: a rule that did not run is not here.
     */
    looked: { rule: string; asks: string; read: string | null }[]
  }[]
  /** The one reason when nothing of this thing can be measured at all. */
  nothing: string | null
}

// A review reads every pixel of a texture, so one is kept per version of the thing and of its project.
const kept = new Map<string, AssetCheck>()
const keep = (key: string, make: () => AssetCheck) => {
  const known = kept.get(key)
  if (known) return known
  kept.set(key, make())
  if (kept.size > 60) kept.delete(kept.keys().next().value!)
  return kept.get(key)!
}

/**
 * The acceptance review of an AI-made thing for the 「质量检查」 block of its card, whatever its kind: the
 * same review, by the same standard, that decided whether the AI's hand-in was saved. A draft an outside AI
 * has shown is judged as it stands. A saved thing is judged only while the overview says the version on
 * disk is an AI's hand-in (`judged`): null for anything a person made or changed by hand, and for content
 * from before assets existed.
 */
export function assetCheck(project: Project, items: readonly Shown[], item: Tile, draft: Draft | null, justified: Justified = null): AssetCheck | null {
  const assets = project.workspace.assets
  const saved = item.preview.source === "asset" ? assets.find((value) => value.id === item.asset_id) : undefined
  // What it was made against, as the overview already worked out: the model a texture or an animation is for.
  const against = [item.preview.model_asset_id, ...item.needs.map((id) => items.find((value) => value.id === id)?.asset_id ?? null)].flatMap((id) => assets.filter((value) => value.id === id))
  // The gate's own brief and tier when the overview carries them, so the card and the gate cannot disagree.
  // And the reasons its maker gave in the part sheet, which the gate accepted the work on: judged without them the card would refuse again what the gate let through.
  const context = { brief: item.brief || saved?.prompt, insisted: true, ...item.judged, against, justified }
  const stamp = `${project.id}:${project.revision}:${item.id}:${JSON.stringify(justified ?? [])}`
  if (!saved && draft && draft.kind === item.kind && draft.document && typeof draft.document === "object")
    return keep(`${stamp}:draft:${JSON.stringify(draft.document).length}:${draft.progress}`, () =>
      laid(reviewAsset(project, { id: item.asset_id ?? "", module: item.kind as ModuleDocument["kind"], document: draft.document as ModuleDocument, dependencies: [] }, { ...context, candidate: true }), true),
    )
  // Only an AI's hand-in is judged: a person's later edit of it is theirs and is left alone.
  if (!saved || !item.judged) return null
  return keep(`${stamp}:${saved.revision}`, () => laid(reviewAsset(project, saved, context), false))
}

const laid = (review: AssetReview, draft: boolean): AssetCheck => ({
  passed: review.passed,
  draft,
  spared: review.spared && review.findings.length > 0,
  simple: review.level === "simple",
  unreadable: review.unreadable,
  found: review.findings.length,
  criteria: review.criteria.map((value) => ({
    ...value,
    meaning: CRITERIA.find((criterion) => criterion.id === value.id)!.meaning,
    measures: CRITERIA.find((criterion) => criterion.id === value.id)!.measures,
    // A rule that only advised is not ticked: what it measured is said as advice instead.
    looked: (review.looked ?? []).filter((entry) => entry.criterion === value.id && entry.passed && !(review.advice ?? []).some((other) => other.rule === entry.rule)).map((entry) => ({ rule: entry.rule, asks: entry.asks, read: entry.read })),
    findings: review.findings.filter((finding) => finding.criterion === value.id).map((finding) => ({ rule: finding.rule, message: finding.message, fix: finding.fix, ...(finding.plain ? { plain: finding.plain } : {}) })),
    advice: (review.advice ?? []).filter((entry) => entry.criterion === value.id).map((entry) => ({ rule: entry.rule, message: entry.message })),
  })),
  nothing: review.criteria.every((value) => value.state === "unmeasured") && !review.unreadable ? (review.criteria[0]?.note ?? null) : null,
})

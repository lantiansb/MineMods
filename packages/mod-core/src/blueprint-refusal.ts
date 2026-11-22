import { readFile, rm } from "node:fs/promises"
import { z } from "zod"
import { ConstraintSchema, type Constraint } from "./blueprint-constraints"
import type { Ideas } from "./blueprint-ideas"
import { storagePath, withProjectLock, writeRecord } from "./project"

/**
 * A plan an AI handed in and Studio refused. A refused plan is never stored, so without this the reason lived only in the activity list and the
 * person, looking at the blueprint page, saw nothing where the plan should be. This is the one place the page reads it from, to say at the
 * refused plan why it was refused and what the person can do. It is Studio's own note about the newest refusal, not part of the person's
 * project: it is replaced by the next refusal and cleared when a plan is stored, so it does not travel with an exported project.
 */
export const PlanRefusalSchema = z.strictObject({
  at: z.iso.datetime(),
  by: z.enum(["studio", "outside"]),
  /** The reason in words for the person, as the refusal itself says it (not what was appended for an AI). */
  why: z.string().trim().min(1).max(4000),
  /** "requirement": a requirement of the person's is broken, unanswered or was not compared. "playable": a thing is left without an answer. "rule": the plan's own rules or a clash with what is already made. */
  about: z.enum(["requirement", "playable", "rule"]),
  /** The requirement it is about, when it is about one. */
  constraint: ConstraintSchema.shape.id.nullable(),
  /** That requirement's words as the refused plan was held to them. Kept because the list itself may not be stored: a plan can be the first thing to carry it. */
  words: z.string().max(300).nullable().default(null),
  /** What the refused plan would have made, by title: so the page can say which plan it was. */
  titles: z.array(z.string().max(120)).max(200),
  /** The revision of the stored plan it would have replaced; null when nothing was stored. */
  against: z.number().int().min(1).nullable(),
})
export type PlanRefusal = z.infer<typeof PlanRefusalSchema>

const SEGMENTS = [".minemods", "plan-refusal.json"]

/** Null when nothing was refused, or when the file cannot be read as a record. */
export async function readRefusal(directory: string) {
  const text = await readFile(await storagePath(directory, SEGMENTS), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "null"
    throw error
  })
  return PlanRefusalSchema.safeParse(await Promise.resolve(text).then(JSON.parse).catch(() => null)).data ?? null
}

/** Remember the newest refusal, in place of the one before. */
export function noteRefusal(directory: string, refusal: PlanRefusal) {
  return withProjectLock(directory, () => writeRecord(directory, SEGMENTS, PlanRefusalSchema.parse(refusal)))
}

/** A plan was stored, or the person started over: whatever was refused before no longer stands in the way. */
export function clearRefusal(directory: string) {
  return withProjectLock(directory, async () => rm(await storagePath(directory, SEGMENTS), { force: true }))
}

/**
 * The refusal as the blueprint page shows it. `constraint` is the requirement it is about as it stands now: its words, whether the person has
 * since given it up, and what they reworded it into (`recorded`: whether it is on the person's list at all). `settled`: the person changed their requirements after the refusal, so what it says
 * may no longer hold and the plan only needs handing in again.
 */
export function refusalView(refusal: PlanRefusal | null, ideas: Pick<Ideas, "constraints" | "lifted" | "changes"> | null) {
  if (!refusal) return null
  const constraints: Constraint[] = ideas?.constraints ?? []
  const named = constraints.find((value) => value.id === refusal.constraint)
  const lifted = (id: string) => (ideas?.lifted ?? []).some((entry) => entry.constraint === id)
  return {
    ...refusal,
    // `recorded` false: the requirement is not in a list of the person's (nothing was stored), so there is no card to change it on; the sentence is the place.
    constraint: named
      ? { id: named.id, text: named.text, lifted: lifted(named.id), reworded_into: constraints.find((value) => value.replaces === named.id)?.id ?? null, recorded: true }
      : refusal.constraint && refusal.words
        ? { id: refusal.constraint, text: refusal.words, lifted: false, reworded_into: null, recorded: false }
        : null,
    settled: (ideas?.changes ?? []).some((change) => change.at > refusal.at),
  }
}
export type PlanRefusalView = NonNullable<ReturnType<typeof refusalView>>

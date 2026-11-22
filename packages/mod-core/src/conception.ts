import { createHash } from "node:crypto"
import { z } from "zod"
import type { Project } from "./project"

const BriefTextSchema = z.string().trim().min(1).max(20000)
const EntryStatusSchema = z.enum(["draft", "reviewed", "imported"])

export const RecipeBriefSchema = z.strictObject({
  recipe_type: z.enum(["crafting", "furnace", "custom"]),
  input_names: z.array(z.string().trim().max(200)).max(64),
  output_name: z.string().trim().min(1).max(200),
  output_names: z.array(z.string().trim().max(200)).max(64).default([]),
  count: z.number().int().min(1).max(64).default(1),
  fuel: z.string().max(200).default(""),
  duration: z.string().max(200).default(""),
  container_description: z.string().max(4000).optional(),
  intent: BriefTextSchema,
})

export const BlockBriefSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  intent: BriefTextSchema,
  visual_intent: z.string().max(8000).optional(),
  behavior_intent: z.string().max(8000).optional(),
  interaction_intent: z.string().max(8000).optional(),
})

export const ConceptionReviewSchema = z.strictObject({
  summary: z.string().max(20000),
  sections: z.array(z.strictObject({ title: z.string().trim().min(1).max(200), body: z.string().max(12000) })).max(64),
  questions: z.array(z.string().max(2000)).max(64),
})

const EntryBaseSchema = z.strictObject({
  id: z.uuid(),
  key: z.string().max(120).default(""),
  title: z.string().trim().min(1).max(120),
  brief: BriefTextSchema,
  status: EntryStatusSchema.default("draft"),
  entity_id: z.uuid().nullable().default(null),
  review: ConceptionReviewSchema.nullable().default(null),
  behavior_brief: z.string().max(20000).default(""),
  behavior_review: ConceptionReviewSchema.nullable().default(null),
  model_confirmed_asset_id: z.uuid().nullable().default(null),
})

export const ConceptionEntrySchema = z.discriminatedUnion("kind", [
  EntryBaseSchema.extend({ kind: z.literal("entity") }),
  EntryBaseSchema.extend({ kind: z.literal("item") }),
  EntryBaseSchema.extend({ kind: z.literal("dimension") }),
  EntryBaseSchema.extend({ kind: z.literal("biome") }),
  EntryBaseSchema.extend({ kind: z.literal("worldview") }),
  EntryBaseSchema.extend({ kind: z.literal("block"), block: BlockBriefSchema.optional() }),
  EntryBaseSchema.extend({ kind: z.literal("recipe"), recipe: RecipeBriefSchema }),
])

/** Required-only wire format; the application owns UUIDs and production status. */
export const ConceptionPlanSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  worldview: z.string().max(20000),
  entries: z.array(z.strictObject({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    kind: z.enum(["entity", "item", "block", "recipe", "dimension", "biome", "worldview"]),
    title: z.string().trim().min(1).max(120),
    brief: BriefTextSchema,
    relationships: z.array(z.string().max(500)).max(32),
  })).max(256),
  questions: z.array(z.string().max(2000)).max(32),
}).superRefine((plan, context) => {
  if (new Set(plan.entries.map(entry => entry.key)).size !== plan.entries.length)
    context.addIssue({ code: "custom", path: ["entries"], message: "Duplicate plan key" })
})

export const ConceptionSchema = z.strictObject({
  brief: z.string().max(20000).default(""),
  plan: z.string().max(20000).default(""),
  entries: z.array(ConceptionEntrySchema).max(1024).default([]),
  status: z.enum(["draft", "reviewed", "imported"]).default("draft"),
  updated_at: z.iso.datetime().optional(),
  review: ConceptionPlanSchema.nullable().default(null),
}).superRefine((conception, context) => {
  if (new Set(conception.entries.map((entry) => entry.id)).size !== conception.entries.length)
    context.addIssue({ code: "custom", path: ["entries"], message: "Duplicate conception entry ID" })
})

export type RecipeBrief = z.infer<typeof RecipeBriefSchema>
export type BlockBrief = z.infer<typeof BlockBriefSchema>
export type ConceptionEntry = z.infer<typeof ConceptionEntrySchema>
export type Conception = z.infer<typeof ConceptionSchema>
export type ConceptionPlan = z.infer<typeof ConceptionPlanSchema>
export type ConceptionReview = z.infer<typeof ConceptionReviewSchema>
export type DraftLink = { entry_id: string; kind: ConceptionEntry["kind"]; title: string; brief: string }
export type ConceptionImportResult = { project: Project; imported_entry_ids: string[]; draft_links: DraftLink[] }

function stableUuid(value: string) {
  const hash = createHash("sha256").update(`minemods:conception:${value}`).digest("hex")
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
}

function assertImportableRecipe(recipe: RecipeBrief) {
  const filled = recipe.input_names.filter(Boolean).length
  if (!filled) return
  if (recipe.recipe_type === "crafting" && recipe.input_names.length !== 9) throw new Error("Crafting recipes require nine slots")
  if (recipe.recipe_type === "furnace" && recipe.input_names.length !== 1) throw new Error("Furnace recipes require one input")
  if (recipe.recipe_type === "custom" && filled < 1) throw new Error("Custom recipes require an input")
}

export function applyConceptionPlan(project: Project, input: Conception): ConceptionImportResult {
  const conception = ConceptionSchema.parse(input)
  conception.entries.filter((entry): entry is Extract<ConceptionEntry, { kind: "recipe" }> => entry.kind === "recipe").forEach(entry => assertImportableRecipe(entry.recipe))
  const existing = new Set(project.entities.map((entity) => entity.id))
  const entityEntries = conception.entries.filter((entry) => entry.kind === "entity")
  const entities = entityEntries
    .filter((entry) => !existing.has(entry.entity_id ?? stableUuid(entry.id)))
    .map((entry) => ({
      id: entry.entity_id ?? stableUuid(entry.id), name: entry.title, description: entry.brief.slice(0, 4000),
      health: 20, speed: 0.25, attack_damage: 2, behavior: "passive" as const, model_asset_id: null,
    }))
  const imported = new Set(entityEntries.map((entry) => entry.id))
  const entries = conception.entries.map((entry) => imported.has(entry.id) ? { ...entry, entity_id: entry.entity_id ?? stableUuid(entry.id), status: "imported" as const } : entry)
  const draft_links = conception.entries
    .filter((entry) => entry.kind !== "entity")
    .map((entry) => ({ entry_id: entry.id, kind: entry.kind, title: entry.title, brief: entry.brief }))
  return {
    project: { ...project, entities: [...project.entities, ...entities], conception: { ...conception, entries, status: "imported" } },
    imported_entry_ids: [...imported],
    draft_links,
  }
}

export function conceptionFromPlan(project: Project, input: ConceptionPlan): Conception {
  const plan = ConceptionPlanSchema.parse(input)
  const incoming = plan.entries.map(entry => {
    const existing = project.conception.entries.find(value => value.key === entry.key && value.kind === entry.kind)
    const base = { ...existing, id: existing?.id ?? stableUuid(`${project.id}:${entry.kind}:${entry.key}`), key: entry.key, title: entry.title, brief: entry.brief, kind: entry.kind }
    if (entry.kind === "recipe") return ConceptionEntrySchema.parse({ ...base, recipe: existing?.kind === "recipe" ? existing.recipe : { recipe_type: "crafting", input_names: Array(9).fill(""), output_name: entry.title, intent: entry.brief } })
    const clean = { ...base } as Record<string, unknown>
    delete clean.recipe
    if (entry.kind !== "block") delete clean.block
    return ConceptionEntrySchema.parse(clean)
  })
  return ConceptionSchema.parse({ ...project.conception, plan: plan.worldview, review: plan, entries: [...project.conception.entries.filter(entry => !incoming.some(value => value.id === entry.id)), ...incoming], status: "reviewed" })
}

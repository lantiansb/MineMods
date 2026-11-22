import { bossShowAssets } from "@minemods/mod-core/boss-show"
import { abilityRef, assetRef, phaseRef } from "@minemods/mod-core/finding-refs"
import { reconcile, type Finding, type ReconcileFacts } from "@minemods/mod-core/reconcile"
import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { abilityAssetNames } from "@minemods/mod-core/ability-asset"
import { bookImageIds } from "@minemods/mod-core/book"
import { particleDependencies } from "@minemods/mod-core/particle-emission"
import { creatureSoundIds, SoundAssetRefSchema } from "@minemods/mod-core/sound"
import { isDeepStrictEqual } from "node:util"
import { z } from "zod"
import type { ActivityInput } from "@minemods/mod-core/activity"
import { ProjectSchema, type Project } from "@minemods/mod-core/project"
import { ModuleDocumentSchema, WorkspaceAssetSchema, applyWorkspaceAsset, getModuleSchema, type WorkspaceAsset } from "@minemods/mod-core/workspace"
import { savedStatus } from "@minemods/mod-core/workspace-modules"
import { assertFresh, StaleEditError } from "@minemods/mod-core/stale-edit"
import type { StudioView } from "../api"

/**
 * The person's own edit of one thing (「自己改」): a block, an item, a recipe or a creature's numbers, changed
 * in a form and saved as a whole document. It travels the road an AI's hand-in travels after its review
 * (`applyWorkspaceAsset`): the kind's schema, the reference rules of the content lists, the creature's own
 * rules, one more revision of the asset and of the project. It is never judged by the acceptance standard:
 * that is for AI work (see `saveTaskAsset`), and what a person decides for their own mod is theirs.
 */
export const HAND_KINDS = ["block", "item", "recipe", "entity", "particle", "ability", "book"] as const
export type HandKind = (typeof HAND_KINDS)[number]
/** What the asset of a thing made from blank keeps where an AI-made one keeps the words it was asked with. */
export const HAND_PROMPT = "自己从空白开始做的"
// As many changed fields as fit one line of the activity panel (`ACTIVITY_LIMITS.text` is 300 characters; a label is a few).
const SAID = 6

/** A schema as plain data a form can be laid out from: what each field holds and what it may hold. */
export type HandShape =
  | { type: "text"; min?: number; max?: number; pattern?: string; format?: string }
  | { type: "number"; int?: true; min?: number; max?: number; above?: number; below?: number }
  | { type: "choice"; options: string[] }
  | { type: "flag" }
  | { type: "fixed"; value: string | number | boolean | null }
  | { type: "object"; fields: Record<string, HandField> }
  | { type: "list"; of: HandField; min?: number; max?: number }
  | { type: "other" }
export type HandField = HandShape & { optional?: true; nullable?: true }

type Bag = { minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number; format?: string; patterns?: Set<RegExp> }
const bounds = (min: number | undefined, max: number | undefined) => ({ ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) })

function shapeOf(schema: z.ZodType): HandField {
  const def = schema.def as { type: string; innerType?: z.ZodType; element?: z.ZodType; values?: unknown[] }
  const bag = (schema as unknown as { _zod: { bag: Bag } })._zod.bag ?? {}
  if (def.type === "optional" || def.type === "default") return { ...shapeOf(def.innerType!), optional: true }
  if (def.type === "nullable") return { ...shapeOf(def.innerType!), nullable: true }
  if (def.type === "object") return { type: "object", fields: Object.fromEntries(Object.entries((schema as z.ZodObject).shape).map(([key, value]) => [key, shapeOf(value as z.ZodType)])) }
  if (def.type === "array") return { type: "list", of: shapeOf(def.element!), ...bounds(bag.minimum, bag.maximum) }
  if (def.type === "enum") return { type: "choice", options: [...(schema as z.ZodEnum).options].map(String) }
  if (def.type === "boolean") return { type: "flag" }
  if (def.type === "literal") return { type: "fixed", value: (def.values?.[0] ?? null) as string | number | boolean | null }
  if (def.type === "number")
    return { type: "number", ...(bag.format?.includes("int") ? { int: true as const } : {}), ...bounds(bag.minimum, bag.maximum), ...(bag.exclusiveMinimum === undefined ? {} : { above: bag.exclusiveMinimum }), ...(bag.exclusiveMaximum === undefined ? {} : { below: bag.exclusiveMaximum }) }
  if (def.type === "string") {
    const pattern = bag.format === "regex" ? [...(bag.patterns ?? [])][0]?.source : undefined
    return { type: "text", ...bounds(bag.minimum, bag.maximum), ...(pattern ? { pattern } : {}), ...(bag.format && bag.format !== "regex" ? { format: bag.format } : {}) }
  }
  // 任务二 §9: a vanilla sound id or a sound asset of the project ({ asset }): the form offers the vanilla ones; one that holds a sound asset is not shown in it (`asset-edit-words.ts`).
  if (def.type === "union") {
    const options = (def as unknown as { options: z.ZodType[] }).options
    const named = options.find((option) => option.def.type === "enum")
    if (named && options.length === 2 && options.some((option) => option === SoundAssetRefSchema)) return shapeOf(named)
  }
  // A choice between whole shapes (an ability's hit, a reward) is not a form of plain fields.
  return { type: "other" }
}

/** The shape of a hand-editable kind's document, read off the very schema a save is held to. */
export function handShape(kind: HandKind) {
  return shapeOf(getModuleSchema(kind)) as Extract<HandField, { type: "object" }>
}

/**
 * One thing wrong with a hand-edited document. `path` is inside the document being saved; it is empty when
 * the trouble is not one field's. `elsewhere` names another thing of the project the change would break.
 */
export type HandIssue = { path: (string | number)[]; code: string; message: string; elsewhere?: string; refs?: FindingRef[] }
/** A save that cannot be made at all, said in the person's words. */
export class HandRefusal extends Error {}

const LISTS = { blocks: "block", items: "item", recipes: "recipe" } as const

/**
 * What mod-core said about a document, as issues of that document's own fields. The paths it reports are of
 * three makes: of the asset (`document.…`), of the document or its content record (bare), and of the whole
 * content lists (`blocks.3.…`), where the saved thing is always the last of its list (`applyWorkspaceAsset` puts it there).
 */
export function handIssues(error: unknown, project: Pick<Project, "blocks" | "items" | "recipes" | "entities">, target: { id: string; kind: string }): HandIssue[] {
  if (error instanceof HandRefusal) return [{ path: [], code: "refused", message: error.message }]
  if (!(error instanceof z.ZodError)) return [{ path: [], code: "custom", message: error instanceof Error ? error.message : String(error) }]
  const issues = error.issues.map((issue): HandIssue => {
    const whole = issue.path.filter((part): part is string | number => typeof part !== "symbol")
    const inside = whole[0] === "document"
    // A recipe's document repeats its content record's findings under one more name (`ContentDocumentSchemas.recipe`).
    const path = whole.slice(inside ? 1 : 0).filter((part, index) => index > 0 || part !== "recipe")
    const head = String(path[0])
    const plain = { code: issue.code ?? "custom", message: issue.message }
    if (inside) return { ...plain, path }
    if (head in LISTS && typeof path[1] === "number") {
      const others = project[head as keyof typeof LISTS].filter((value) => value.id !== target.id)
      if (LISTS[head as keyof typeof LISTS] === target.kind && path[1] === others.length) return { ...plain, path: path.slice(2) }
      return { ...plain, path: [], elsewhere: others[path[1]]?.name }
    }
    if (head === "entities" && typeof path[1] === "number") return { ...plain, path: [], elsewhere: project.entities[path[1]]?.name }
    if (head === "assets" || head === "logic") return { ...plain, path: [] }
    return { ...plain, path }
  })
  // A recipe is checked as an asset's document and again as a content record: the same finding is said once.
  return issues.filter((issue, index) => issues.findIndex((other) => other.path.join(".") === issue.path.join(".") && other.message === issue.message) === index)
}

function entityAudioParticles(document: Extract<WorkspaceAsset["document"], { kind: "entity" }>) {
  return [...particleDependencies(document), ...creatureSoundIds(document), ...bossShowAssets(document.boss).sounds,
    ...(document.shared_abilities ?? []).flatMap(use => Object.values(use.sounds ?? {}).flatMap(ref => typeof ref === "object" ? [ref.asset] : []))]
}

function battleDependencies(document: WorkspaceAsset["document"]): string[] {
  if (document.kind === "entity") return entityAudioParticles(document)
  if (document.kind === "ability") return Object.values(abilityAssetNames(document)).flat()
  return []
}

/**
 * The project with one hand-edited document in it, and the asset that now holds it. Throws what mod-core
 * throws (read it with `handIssues`). `same`: the document is what the project already holds; nothing to save.
 */
export function handSave(project: Project, input: { assetId: string | null; document: unknown; id: string; at: string; battleEdit?: boolean }) {
  const document = ModuleDocumentSchema.parse(input.document)
  if (!(HAND_KINDS as readonly string[]).includes(document.kind) || !("name" in document)) throw new HandRefusal("这一类东西还不能在这里自己改。")
  const existing = input.assetId ? project.workspace.assets.find((asset) => asset.id === input.assetId) : undefined
  if (input.assetId && !existing) throw new HandRefusal("这一样东西已经不在工程里了。回到列表重新打开它。")
  if (existing && existing.module !== document.kind) throw new HandRefusal("这一样东西的种类对不上，没有保存。")
  // A creature stands on a model: one is made in the model editor or by an AI, never from an empty form.
  if (!existing && document.kind === "entity") throw new HandRefusal("生物要先有模型，不能从空白的表格开始。")
  if (existing && isDeepStrictEqual(existing.document, document)) return { next: project, asset: existing, same: true as const }
  // An item's model binding is a workspace reference. Keep unrelated dependencies when that binding changes.
  const previousMusic = existing?.document.kind === "entity" ? existing.document.boss?.music?.asset : undefined
  const oldBattleDeps = new Set(existing && input.battleEdit ? battleDependencies(existing.document) : [])
  const oldDependencies = (existing?.dependencies ?? []).filter(id => !oldBattleDeps.has(id))
  const dependencies = document.kind === "item" && (!existing || (existing.document.kind === "item" && existing.document.model_asset_id !== document.model_asset_id))
    ? [...new Set([...(existing?.dependencies ?? []).filter(id => existing?.document.kind !== "item" || id !== existing.document.model_asset_id), ...(document.model_asset_id ? [document.model_asset_id] : [])])]
    : document.kind === "ability" ? [...new Set([...oldDependencies, ...battleDependencies(document)])]
    // 书: the pictures its pages show, and nothing of a picture a page no longer shows.
    : document.kind === "book" ? [...new Set([...(existing?.dependencies ?? []).filter((id) => existing?.document.kind !== "book" || !bookImageIds(existing.document).includes(id)), ...bookImageIds(document)])] : document.kind === "entity" ? [...new Set([...oldDependencies.filter(id => id !== previousMusic), ...(document.boss?.music ? [document.boss.music.asset] : []), ...[document.builtin?.fixture_lit?.effect, document.builtin?.fixture_ember?.effect].filter((id): id is string => !!id), ...entityAudioParticles(document)])] : existing?.dependencies ?? []
  const asset: WorkspaceAsset = WorkspaceAssetSchema.parse(
    existing
      ? { ...existing, title: document.kind==="particle" ? existing.title : document.name, document, dependencies, revision: existing.revision + 1, updated_at: input.at }
      : { id: input.id, module: document.kind, title: document.name, revision: 1, created_at: input.at, updated_at: input.at, prompt: HAND_PROMPT, dependencies, document, provenance: { model: null, request_id: null }, status: savedStatus(document.kind, project.target) },
  )
  const next = applyWorkspaceAsset(project, asset)
  ProjectSchema.parse(next)
  return { next, asset, same: false as const }
}

/** The one line the activity panel gets for a hand edit: who did it (the person) and to what. */
export function handNote(project: Pick<Project, "blueprint">, asset: Pick<WorkspaceAsset, "id" | "title">, created: boolean, changed: readonly string[]): ActivityInput {
  const said = changed.slice(0, SAID).join("、")
  const text = created ? `你自己从空白做了「${asset.title}」。` : `你自己改了「${asset.title}」${said ? `的${said}${changed.length > SAID ? ` 等 ${changed.length} 处` : ""}` : ""}。`
  // The overview knows a planned thing by its plan entry and any other by its asset (`itemOf` in blueprint-service).
  return { kind: "person", mark: "note", item: project.blueprint?.entries.find((entry) => entry.asset_id === asset.id)?.key ?? asset.id, title: asset.title, text }
}

/** `assetId` null: a new thing. `changed`: the labels of the fields the person changed, as the form shows them. */
export const HandSaveInputSchema = z.strictObject({
  projectId: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  assetId: z.uuid().nullable(),
  // Held to the kind's own schema inside `handSave`, so what is wrong comes back as issues of fields and not as a refused call.
  document: z.record(z.string(), z.unknown()),
  changed: z.array(z.string().trim().min(1).max(40)).max(64),
  /** The revision of the asset the form started from (see `stale-edit`). Absent for a new thing, and for callers that are not a form. */
  basedOn: z.number().int().min(1).optional(),
  battleEdit: z.boolean().optional(),
})
export type HandSaveInput = z.infer<typeof HandSaveInputSchema>
export type HandSaveResult = { ok: true; view: StudioView; assetId: string; warnings?: Finding[] } | { ok: false; issues: HandIssue[] }

function battleFindings(project: Project) {
  const facts: ReconcileFacts = {
    animations: Object.fromEntries(project.workspace.assets.flatMap(asset => asset.document.kind === "model" ? [[asset.id, asset.document.animations.map(clip => clip.name)]] : [])),
    models: Object.fromEntries(project.workspace.assets.flatMap(asset => asset.document.kind === "model" ? [[asset.id, asset.document]] : [])),
  }
  return reconcile(project, facts)
}

function newBattleFindings(before: Project, after: Project) {
  const key = ({ rule, about, text, detail }: Finding) => JSON.stringify([rule, about?.id, text, detail])
  const previous = new Map<string, number>()
  for (const finding of battleFindings(before)) {
    const id = key(finding)
    previous.set(id, (previous.get(id) ?? 0) + 1)
  }
  return battleFindings(after).filter(finding => {
    const id = key(finding)
    const count = previous.get(id) ?? 0
    if (!count) return true
    previous.set(id, count - 1)
    return false
  })
}

function battleIssueRefs(issues: HandIssue[], asset: WorkspaceAsset): HandIssue[] {
  const document = asset.document
  return issues.map(issue => {
    const refs = [assetRef(asset.id, asset.title)]
    if (document.kind === "entity") {
      const [root, index, section] = issue.path
      const move = root === "abilities" && typeof index === "number" ? document.abilities?.[index] : undefined
      if (move) refs.push(abilityRef(move))
      if (root === "boss" && index === "phases" && typeof section === "number") refs.push(phaseRef(section + 2))
    }
    return { ...issue, refs }
  })
}

/**
 * `saveByHand` for the Studio service. It is given the service's own `source`, `view` and project save, so a
 * hand edit meets the same revision check as every other save, and `note` (mod-core's `noteActivity`).
 */
export function createContentService(deps: {
  source: (projectId: string, expectedRevision?: number) => Promise<StudioView>
  view: (directory: string) => Promise<StudioView>
  saveProject: (directory: string, project: Project, expectedRevision: number) => Promise<unknown>
  note: (directory: string, event: ActivityInput) => unknown
  id?: () => string
}) {
  return {
    async saveByHand(raw: HandSaveInput): Promise<HandSaveResult> {
      const input = HandSaveInputSchema.parse(raw)
      const current = await deps.source(input.projectId, input.expectedRevision)
      const id = input.assetId ?? (deps.id ?? (() => crypto.randomUUID()))()
      // The form was opened on an older version than the one stored (an AI saved it meanwhile): saving would write the old words back.
      try {
        assertFresh(input.basedOn, input.assetId ? current.project.workspace.assets.find((asset) => asset.id === input.assetId)?.revision : undefined)
      } catch (error) {
        if (error instanceof StaleEditError) return { ok: false, issues: [{ path: [], code: "refused", message: error.message }] }
        throw error
      }
      const existing = current.project.workspace.assets.find(asset => asset.id === input.assetId)
      const made = await Promise.resolve()
        .then(() => handSave(current.project, { assetId: input.assetId, document: input.document, id, at: new Date().toISOString(), battleEdit: input.battleEdit }))
        .catch((error: unknown) => ({ issues: handIssues(error, current.project, { id, kind: String(input.document.kind) }) }))
      if ("issues" in made) return { ok: false, issues: input.battleEdit && existing ? battleIssueRefs(made.issues, existing) : made.issues }
      if (made.same) return { ok: true, view: current, assetId: made.asset.id }
      const warnings = input.battleEdit ? newBattleFindings(current.project, made.next) : []
      const stops = warnings.filter(finding => finding.stops)
      if (stops.length) return { ok: false, issues: stops.map(finding => ({
        path: [], code: finding.rule, message: [finding.text, finding.fix].filter(Boolean).join(" "),
        refs: finding.refs?.length ? finding.refs : [assetRef(made.asset.id, made.asset.title)],
      })) }
      await deps.saveProject(current.directory, made.next, input.expectedRevision)
      await deps.note(current.directory, handNote(made.next, made.asset, !input.assetId, input.changed))
      return { ok: true, view: await deps.view(current.directory), assetId: made.asset.id, ...(warnings.length ? { warnings } : {}) }
    },
  }
}

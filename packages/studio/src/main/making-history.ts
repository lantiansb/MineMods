import { readFile, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { assetVersionSegments, openProject, ProjectSchema, RevisionConflictError, saveProjectUnlocked, storagePath, withProjectLock, writeRecord, type KeptVersion, type Project } from "@minemods/mod-core/project"
import { applyWorkspaceAsset, WorkspaceAssetSchema, type ModuleDocument } from "@minemods/mod-core/workspace"
import { persistWorkspaceModelUnlocked, compileWorkspaceModel } from "@minemods/mod-core/workspace-model"
import { addNote, MakingNoteInputSchema, MakingNotesSchema, NO_NOTES, noteBrief, removeNote, reopenNote, reviewNotes, sendNotes, settleNotes, toSend, type MakingNote, type MakingNoteInput, type MakingNotes } from "../making-notes"
import { AdvancementsSchema, earn, startingEarned, type AdvancementId } from "../advancements"
import { changedParts, thinSteps, TRACE_LIMITS, type MakingTrace, type TraceKind, type TraceStep } from "../making-trace"

const missing = (error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
  throw error
}
const traceSegments = (assetId: string, ...rest: string[]) => [".minemods", "making", "trace", z.uuid().parse(assetId), ...rest]
const notesSegments = (assetId: string) => [".minemods", "making", "notes", `${z.uuid().parse(assetId)}.json`]
const ADVANCEMENT_SEGMENTS = [".minemods", "making", "advancements.json"]

const TraceStepSchema = z.strictObject({ seq: z.number().int().positive(), at: z.string(), kind: z.enum(["write", "look", "review"]), parts: z.array(z.string()), areas: z.array(z.enum(["shape", "paint", "motion"])), note: z.string().nullable(), copy: z.boolean() })
const TraceFileSchema = z.strictObject({ schema_version: z.literal(1), next: z.number().int().positive(), total: z.number().int().nonnegative(), steps: z.array(TraceStepSchema), thought: z.strictObject({ at: z.string(), text: z.string() }).nullable().optional(), written: z.number().int().nonnegative().optional() })
type TraceFile = z.infer<typeof TraceFileSchema>

/** A saved version of a thing, numbered from its first. */
export type AssetVersion = { version: number; revision: number; at: string; by: KeptVersion["by"]; from: number | null; title: string; document: ModuleDocument; current: boolean }
export class HistoryRefusal extends Error {}

async function readJson(directory: string, segments: string[]) {
  const text = await readFile(await storagePath(directory, segments), "utf8").catch(missing)
  return text === null ? null : (JSON.parse(text) as unknown)
}

/**
 * Oldest first, each numbered. A version whose document is what the one before it held is not a version to anybody (the asset's number moved for another reason): it is left out.
 * An older project that never recorded one still has what it holds now: that is its first version.
 */
export async function assetVersions(directory: string, project: Project, assetId: string): Promise<AssetVersion[]> {
  const asset = project.workspace.assets.find((value) => value.id === assetId)
  const listing = await readdir(path.dirname(await storagePath(directory, assetVersionSegments(z.uuid().parse(assetId), 1)))).catch(() => [] as string[])
  const kept = (await Promise.all(listing.filter((name) => /^[1-9][0-9]*\.json$/.test(name)).map((name) => readJson(directory, assetVersionSegments(assetId, Number(name.slice(0, -5))))))) as (KeptVersion | null)[]
  const known = kept.flatMap((value) => (value ? [value] : [])).sort((left, right) => left.revision - right.revision)
  const all: KeptVersion[] = asset && !known.some((value) => value.revision === asset.revision) ? [...known, { revision: asset.revision, at: asset.updated_at, by: asset.provenance.model === null ? "person" : "ai", title: asset.title, document: asset.document }] : known
  const distinct = all.filter((value, index) => index === 0 || JSON.stringify(value.document) !== JSON.stringify(all[index - 1]!.document))
  return distinct.map((value, index) => ({ version: index + 1, revision: value.revision, at: value.at, by: value.by, from: value.from ?? null, title: value.title, document: value.document as ModuleDocument, current: index === distinct.length - 1 && !!asset }))
}

/** Writes wait in line for their own thing, so two tool calls answered at once cannot lose a step. */
const lines = new Map<string, Promise<unknown>>()
function inLine<T>(key: string, work: () => Promise<T>) {
  const next = (lines.get(key) ?? Promise.resolve()).then(work, work)
  lines.set(key, next.catch(() => undefined))
  return next
}

// Which saved versions are an older one the person brought back. The record of a revision never changes once written, so each is read once.
const restoredSeen = new Map<string, boolean>()
export async function restoredAssets(directory: string, assets: readonly { id: string; revision: number }[]) {
  const found = await Promise.all(
    assets.map(async (asset) => {
      const key = `${directory}:${asset.id}:${asset.revision}`
      if (!restoredSeen.has(key)) restoredSeen.set(key, ((await readJson(directory, assetVersionSegments(asset.id, asset.revision)).catch(() => null)) as { by?: string } | null)?.by === "restored")
      return restoredSeen.get(key) ? [asset.id] : []
    }),
  )
  return found.flat()
}

export function createMakingHistory(options: {
  directoryFor: (projectId: string) => Promise<string>
  /** Told after every step is on disk: the window reads it now rather than at its next turn. */
  changed?: () => void
  /** Why this thing cannot be changed now ("" when it can). */
  lock?: (input: { projectId: string; assetId: string }) => Promise<string>
  /** The review of the version in hand, whose findings become notes. */
  reviewOf?: (input: { projectId: string; assetId: string }) => Promise<{ passed: boolean; findings: readonly string[] } | null>
  /** The redo with marks that exists already: Studio's own AI starts on it, an outside AI is given it with its next task. */
  redo: (input: { projectId: string; itemId: string; feedback: string; annotation?: unknown }) => Promise<unknown>
}) {
  const now = () => new Date().toISOString()
  const readTrace = async (directory: string, assetId: string, version: number) => TraceFileSchema.parse((await readJson(directory, traceSegments(assetId, `${version}.json`))) ?? { schema_version: 1, next: 1, total: 0, steps: [] })
  const readNotes = async (directory: string, assetId: string) => {
    const stored = await readJson(directory, notesSegments(assetId))
    return stored ? MakingNotesSchema.parse(stored) : NO_NOTES
  }
  const traced = async (directory: string, assetId: string) => {
    const listing = await readdir(path.dirname(await storagePath(directory, traceSegments(assetId, "listing")))).catch(() => [] as string[])
    return listing.flatMap((name) => (/^[1-9][0-9]*\.json$/.test(name) ? [Number(name.slice(0, -5))] : [])).sort((left, right) => left - right)
  }
  // The version being written: the one after the last that was saved.
  const versionInHand = async (directory: string, assetId: string) => (await assetVersions(directory, await openProject(directory), assetId)).length + 1

  return {
    /** One step of a making. Nothing here may stand in the way of the call that caused it. */
    async record(input: { projectId: string; assetId: string; kind: TraceKind; note?: string | null; document?: unknown }) {
      const directory = await options.directoryFor(input.projectId)
      await inLine(`${directory}:${input.assetId}`, async () => {
        const version = await versionInHand(directory, input.assetId)
        const file = await readTrace(directory, input.assetId, version)
        const last = [...file.steps].reverse().find((step) => step.copy)
        const before = last ? await readJson(directory, traceSegments(input.assetId, `${version}-${last.seq}.json`)) : await assetVersions(directory, await openProject(directory), input.assetId).then((all) => all.at(-1)?.document ?? null)
        const text = input.document === undefined ? "" : JSON.stringify(input.document)
        const fits = !!text && text.length <= TRACE_LIMITS.document
        // A step that wrote nothing new is not another tick of the same kind: an AI reporting progress is not writing.
        const same = input.document !== undefined && JSON.stringify(before) === text
        if (input.kind === "write" && (input.document === undefined || same)) {
          if (input.note?.trim()) await writeRecord(directory, await prepared(directory, traceSegments(input.assetId, `${version}.json`)), { ...file, thought: { at: now(), text: input.note.trim().slice(0, 1000) } } satisfies TraceFile)
          return
        }
        const change = input.document === undefined || same ? { parts: [], areas: [] } : changedParts(before, input.document)
        const step: TraceStep = { seq: file.next, at: now(), kind: input.kind, parts: change.parts, areas: change.areas, note: input.note?.trim().slice(0, 1000) || null, copy: fits && !same }
        if (step.copy) await writeRecord(directory, await prepared(directory, traceSegments(input.assetId, `${version}-${step.seq}.json`)), input.document)
        const steps = thinSteps([...file.steps, step], TRACE_LIMITS.steps)
        const kept = new Set(steps.map((value) => value.seq))
        await Promise.all(file.steps.filter((value) => value.copy && !kept.has(value.seq)).map(async (value) => rm(await storagePath(directory, traceSegments(input.assetId, `${version}-${value.seq}.json`)), { force: true })))
        await writeRecord(directory, await prepared(directory, traceSegments(input.assetId, `${version}.json`)), { ...file, next: file.next + 1, total: file.total + 1, written: (file.written ?? 0) + (step.kind === "write" ? 1 : 0), steps, thought: step.note ? null : file.thought } satisfies TraceFile)
      })
      options.changed?.()
    },

    /** The steps of one version, the newest version when none is named. `after`: only what came after that step, with the rest said to be unchanged. */
    async trace(input: { projectId: string; assetId: string; version?: number }): Promise<MakingTrace> {
      const directory = await options.directoryFor(input.projectId)
      const versions = await traced(directory, input.assetId)
      const version = input.version ?? versions.at(-1) ?? (await versionInHand(directory, input.assetId))
      const file = await readTrace(directory, input.assetId, version)
      return { asset_id: input.assetId, version, steps: file.steps, total: file.total, written: file.written ?? 0, versions, thought: file.thought ?? null }
    },

    /** The document as it stood at that step; null when no copy of it was kept. */
    async traceDocument(input: { projectId: string; assetId: string; version: number; seq: number }) {
      return (await readJson(await options.directoryFor(input.projectId), traceSegments(input.assetId, `${input.version}-${input.seq}.json`))) as ModuleDocument | null
    },

    /** Every saved version and every note. Reading also settles the notes: a version the AI handed in since answers what was handed to it. */
    async read(input: { projectId: string; assetId: string }): Promise<{ versions: AssetVersion[]; notes: MakingNote[]; revision: number }> {
      const directory = await options.directoryFor(input.projectId)
      const project = await openProject(directory)
      const versions = await assetVersions(directory, project, input.assetId)
      const review = await options.reviewOf?.(input).catch(() => null)
      const notes = await withProjectLock(directory, async () => {
        const stored = await readNotes(directory, input.assetId)
        const settled = settleNotes(stored, versions, now())
        const next = review && !review.passed && versions.length ? reviewNotes(settled, review.findings, { version: versions.at(-1)!.version, at: now() }) : settled
        if (next !== stored) await writeNotes(directory, input.assetId, next)
        return next
      })
      return { versions, notes: notes.notes, revision: project.revision }
    },

    /**
     * A step back that is not a step back: what the old version held is saved as the newest version, and everything before it stays where it was. The same project revision
     * check as every other save, the same stored compile for a model.
     */
    async restore(input: { projectId: string; assetId: string; version: number; expectedRevision: number }) {
      const locked = await options.lock?.(input)
      if (locked) throw new HistoryRefusal(locked)
      const directory = await options.directoryFor(input.projectId)
      const version = await withProjectLock(directory, async () => {
        const project = await openProject(directory)
        if (project.revision !== input.expectedRevision) throw new RevisionConflictError(input.expectedRevision, project.revision)
        const existing = project.workspace.assets.find((value) => value.id === input.assetId)
        if (!existing) throw new HistoryRefusal("这一样东西已经不在工程里了。")
        const versions = await assetVersions(directory, project, input.assetId)
        const target = versions.find((value) => value.version === input.version)
        if (!target) throw new HistoryRefusal(`找不到第 ${input.version} 版。`)
        if (target.current) throw new HistoryRefusal(`第 ${input.version} 版就是现在这一版。`)
        const at = now()
        const asset = WorkspaceAssetSchema.parse({ ...existing, title: target.title, document: target.document, revision: existing.revision + 1, updated_at: at, provenance: { model: null, request_id: null } })
        const next = applyWorkspaceAsset(project, asset)
        if (asset.module === "model") compileWorkspaceModel(next, asset.id)
        ProjectSchema.parse(next)
        // Written first, so the record every save keeps finds it there and leaves it saying where it came from. The old current version is kept by that same save.
        const record = await prepared(directory, assetVersionSegments(asset.id, asset.revision))
        await writeRecord(directory, record, { revision: asset.revision, at, by: "restored", from: input.version, title: asset.title, document: asset.document } satisfies KeptVersion)
        await (asset.module === "model" ? persistWorkspaceModelUnlocked(directory, next, asset.id) : saveProjectUnlocked(directory, next, project.revision)).catch(async (error: unknown) => {
          await rm(await storagePath(directory, record), { force: true })
          throw error
        })
        return versions.at(-1)!.version + 1
      })
      options.changed?.()
      return { version }
    },

    async addNote(input: { projectId: string; assetId: string; note: MakingNoteInput }) {
      const directory = await options.directoryFor(input.projectId)
      const note = MakingNoteInputSchema.parse(input.note)
      return withProjectLock(directory, async () => {
        const versions = await assetVersions(directory, await openProject(directory), input.assetId)
        const next = addNote(await readNotes(directory, input.assetId), note, { version: versions.at(-1)?.version ?? 1, at: now() })
        await writeNotes(directory, input.assetId, next)
        return next.notes
      })
    },

    /** Which of these firsts are news in this project. Nothing asked and a record there already: nothing to write, and nothing that waits for the project's lock. `quiet`: they happened while nobody was looking, so they are kept and none is news. */
    async earnAdvancements(input: { projectId: string; ids: AdvancementId[]; quiet?: boolean }) {
      const directory = await options.directoryFor(input.projectId)
      const known = await readJson(directory, ADVANCEMENT_SEGMENTS)
      if (known && !earn(AdvancementsSchema.parse(known).earned, input.ids).fresh.length) return { fresh: [] as AdvancementId[] }
      return withProjectLock(directory, async () => {
        const stored = await readJson(directory, ADVANCEMENT_SEGMENTS)
        const had = stored ? AdvancementsSchema.parse(stored).earned : startingEarned((await openProject(directory)).workspace.assets.length)
        const { earned, fresh } = earn(had, input.ids)
        await writeRecord(directory, await prepared(directory, ADVANCEMENT_SEGMENTS), { schema_version: 1, earned })
        return { fresh: input.quiet ? ([] as AdvancementId[]) : fresh }
      })
    },

    /** The person changes their mind about a note: take it away, or say it is not fixed after all. */
    async changeNote(input: { projectId: string; assetId: string; id: number; change: "remove" | "reopen" }) {
      const directory = await options.directoryFor(input.projectId)
      return withProjectLock(directory, async () => {
        const stored = await readNotes(directory, input.assetId)
        const next = input.change === "remove" ? removeNote(stored, input.id) : reopenNote(stored, input.id, now())
        await writeNotes(directory, input.assetId, next)
        return next.notes
      })
    },

    /**
     * Hand notes over through the redo that exists. `annotation`: the picture with the marks on it, for a model; words alone for what has no such picture. The notes are marked
     * only after the redo has been accepted: one refused stays as it was.
     */
    async sendNotes(input: { projectId: string; assetId: string; ids: number[]; onlyMarked: boolean; extra?: string; titles?: Record<string, string>; picture?: { image: string; width: number; height: number; projectRevision: number; marks?: { note: number; start: { x: number; y: number }; end?: { x: number; y: number } }[] } }) {
      const directory = await options.directoryFor(input.projectId)
      const project = await openProject(directory)
      const versions = await assetVersions(directory, project, input.assetId)
      const all = (await readNotes(directory, input.assetId)).notes
      const notes = toSend(all).filter((note) => input.ids.includes(note.id))
      if (!notes.length) throw new HistoryRefusal("没有还没交的批注。")
      const feedback = noteBrief(notes, { onlyMarked: input.onlyMarked, extra: input.extra, title: (part) => input.titles?.[part] ?? part })
      // The picture shows one angle, and the marks drawn from it where they fall on that picture. The rest are in the words and in the notes the AI is given with its task.
      const placed = new Map(input.picture?.marks?.map((mark) => [mark.note, mark]))
      const marked = notes.filter((note) => note.source === "person" && note.camera && (!input.picture?.marks || placed.has(note.id)))
      const annotation = input.picture && marked.length
        ? {
            targetId: input.assetId,
            projectRevision: input.picture.projectRevision,
            image: input.picture.image,
            width: input.picture.width,
            height: input.picture.height,
            selectedPart: null,
            only_marked: input.onlyMarked,
            annotations: marked.map((note) => ({
              kind: note.kind === "frame" ? ("text" as const) : note.kind,
              start: placed.get(note.id)?.start ?? note.start,
              ...(note.end && note.kind !== "text" && note.kind !== "frame" ? { end: placed.get(note.id)?.end ?? note.end } : {}),
              ...(note.text || note.kind === "frame" || note.kind === "text" ? { text: note.text || `第 ${note.id} 条` } : {}),
              part: note.part,
              note: note.id,
              ...(note.frame ? { frame: note.frame } : {}),
            })),
          }
        : undefined
      await options.redo({ projectId: input.projectId, itemId: input.assetId, feedback, ...(annotation ? { annotation } : {}) })
      return withProjectLock(directory, async () => {
        const next = sendNotes(await readNotes(directory, input.assetId), notes.map((note) => note.id), { version: versions.at(-1)?.version ?? 1, at: now() })
        await writeNotes(directory, input.assetId, next)
        return next.notes
      })
    },

    /** What an outside AI is given of the notes with its task: readable, whichever kind the thing is. */
    async notesForTask(projectId: string, assetId: string) {
      const directory = await options.directoryFor(projectId)
      const versions = await assetVersions(directory, await openProject(directory), assetId)
      return settleNotes(await readNotes(directory, assetId), versions, now()).notes.filter((note) => note.status === "sent").map((note) => ({ number: note.id, says: note.text, kind: note.kind, part: note.part, frame: note.frame, start: note.start, end: note.end ?? null }))
    },
  }
}

async function prepared(directory: string, segments: string[]) {
  await storagePath(directory, segments, true)
  return segments
}

async function writeNotes(directory: string, assetId: string, notes: MakingNotes) {
  await writeRecord(directory, await prepared(directory, notesSegments(assetId)), notes)
}

export type MakingHistory = ReturnType<typeof createMakingHistory>

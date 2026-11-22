import { z } from "zod"

/**
 * The person's notes on a thing (验收窗「制作过程」): where they point, what they say, and how far they have got.
 * Pure: the store is `main/making-history.ts`.
 */
const Point = z.strictObject({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) })
const Vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const NoteCameraSchema = z.strictObject({ position: Vector, target: Vector })

export const NOTE_LIMITS = { text: 1000, notes: 200, feedback: 500 } as const

export const MakingNoteInputSchema = z.strictObject({
  kind: z.enum(["circle", "arrow", "text", "frame"]),
  start: Point,
  end: Point.optional(),
  text: z.string().trim().max(NOTE_LIMITS.text),
  /** The part it points at, by the name the document gives it. */
  part: z.string().trim().min(1).max(200).nullable(),
  /** The motion and the moment it points at. */
  frame: z.strictObject({ clip: z.string().trim().min(1).max(120), time: z.number().finite().min(0).max(3600) }).nullable(),
  /** The view it was drawn on: the marks only mean something from there. */
  camera: NoteCameraSchema.nullable(),
  /** The shape of the picture it was drawn on (width / height). Absent in notes from before it was kept. */
  aspect: z.number().positive().max(20).nullable().optional(),
})
export type MakingNoteInput = z.infer<typeof MakingNoteInputSchema>

export const MakingNoteSchema = MakingNoteInputSchema.extend({
  /** Its number. Never given to another note, whatever happens to this one. */
  id: z.number().int().positive(),
  source: z.enum(["person", "review"]),
  /** The version it was written on. */
  version: z.number().int().positive(),
  status: z.enum(["unsent", "sent", "fixed", "not_fixed"]),
  /** The version that was current when it was handed over. */
  sent_version: z.number().int().positive().nullable(),
  /** The version it was fixed in. */
  fixed_version: z.number().int().positive().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
})
export type MakingNote = z.infer<typeof MakingNoteSchema>

export const MakingNotesSchema = z.strictObject({ schema_version: z.literal(1), next: z.number().int().positive(), notes: z.array(MakingNoteSchema).max(NOTE_LIMITS.notes) })
export type MakingNotes = z.infer<typeof MakingNotesSchema>
export const NO_NOTES: MakingNotes = { schema_version: 1, next: 1, notes: [] }

/** A number, once given, is never given again. */
export function addNote(record: MakingNotes, input: MakingNoteInput, about: { version: number; at: string; source?: MakingNote["source"] }): MakingNotes {
  const note = MakingNoteSchema.parse({ ...input, id: record.next, source: about.source ?? "person", version: about.version, status: "unsent", sent_version: null, fixed_version: null, created_at: about.at, updated_at: about.at })
  return { ...record, next: record.next + 1, notes: [...record.notes, note] }
}

export const removeNote = (record: MakingNotes, id: number): MakingNotes => ({ ...record, notes: record.notes.filter((note) => note.id !== id) })

/** Those that can be handed to the AI now: not handed over yet, or said not to be fixed. */
export const toSend = (notes: readonly MakingNote[]) => notes.filter((note) => note.status === "unsent" || note.status === "not_fixed")

/** Handed to the AI while `version` is the current one. Anything else stays as it stands. */
export function sendNotes(record: MakingNotes, ids: readonly number[], about: { version: number; at: string }): MakingNotes {
  return { ...record, notes: record.notes.map((note) => (ids.includes(note.id) && toSend([note]).length ? { ...note, status: "sent" as const, sent_version: about.version, fixed_version: null, updated_at: about.at } : note)) }
}

/** The person looked and it is not fixed after all. Only a note said to be fixed can go back. */
export function reopenNote(record: MakingNotes, id: number, at: string): MakingNotes {
  return { ...record, notes: record.notes.map((note) => (note.id === id && note.status === "fixed" ? { ...note, status: "not_fixed" as const, fixed_version: null, updated_at: at } : note)) }
}

/**
 * The AI handed a new version in: what was handed to it before that is now said to be fixed in it. Only a version of the AI's counts: the person's own edit,
 * a step back to an old version or Studio's own conversion to the official names answers nothing that was asked of the AI. The newest such version is the one named.
 */
export function settleNotes(record: MakingNotes, versions: readonly { version: number; by: "ai" | "person" | "restored" | "converted" }[], at: string): MakingNotes {
  const answered = (note: MakingNote) => versions.filter((value) => value.by === "ai" && value.version > (note.sent_version ?? Number.MAX_SAFE_INTEGER)).at(-1)?.version
  if (!record.notes.some((note) => note.status === "sent" && answered(note))) return record
  return { ...record, notes: record.notes.map((note) => (note.status === "sent" && answered(note) ? { ...note, status: "fixed" as const, fixed_version: answered(note)!, updated_at: at } : note)) }
}

/** What a failed review found becomes notes of its own, once each. They are the reviewer's words and are not sent again unless the person sends them. */
export function reviewNotes(record: MakingNotes, findings: readonly string[], about: { version: number; at: string }): MakingNotes {
  const known = new Set(record.notes.map((note) => note.text))
  return [...new Set(findings.map((text) => text.trim().slice(0, NOTE_LIMITS.text)))].filter((text) => text && !known.has(text)).reduce((next, text) => (next.notes.length >= NOTE_LIMITS.notes ? next : addNote(next, { kind: "text", start: { x: 0, y: 0 }, text, part: null, frame: null, camera: null }, { ...about, source: "review" })), record)
}

type Camera = z.infer<typeof NoteCameraSchema>
/** Two views at the same angle: a mark drawn on one means the same on the other. */
export const sameAngle = (left: Camera | null | undefined, right: Camera | null | undefined) => {
  if (!left || !right) return false
  const others = [...right.position, ...right.target]
  return [...left.position, ...left.target].every((value, index) => Math.abs(value - others[index]!) < 0.01)
}

/**
 * Where a point drawn on a picture of one shape falls on a picture of another, from the same angle. The camera keeps its height of view: when the picture narrows, what was at
 * the sides moves in, toward its middle, and top and bottom stay. So a mark stays on the part it was drawn on when the stage narrows for a side-by-side.
 */
export function pointOnShape(point: { x: number; y: number }, drawnOn: number | null | undefined, shownOn: number | null | undefined) {
  if (!drawnOn || !shownOn) return point
  return { x: Math.max(0, Math.min(1, 0.5 + ((point.x - 0.5) * drawnOn) / shownOn)), y: point.y }
}

/**
 * How a note stands, as the list says it. `external`: an outside AI does not wake by itself, so what was handed over waits until it comes for it, and is said as that.
 */
export function noteStanding(note: Pick<MakingNote, "status" | "source" | "fixed_version">, external = false) {
  const by = note.source === "review" ? "审查提的" : ""
  const words = { unsent: note.source === "review" ? "" : "还没交给 AI", sent: external ? "已记下，等 AI 领" : "已交给 AI", fixed: `第 ${note.fixed_version} 版已改`, not_fixed: "还没改好" }[note.status]
  return [by, words].filter(Boolean).join(" · ")
}

/** Where a note points, as the list says it. `title` puts a part's name into plain words. */
export function notePlace(note: Pick<MakingNote, "kind" | "part" | "frame"> & Partial<Pick<MakingNote, "start" | "end" | "camera">>, title: (part: string) => string = (part) => part, motion: (clip: string) => string = (clip) => clip) {
  const part = note.part ? title(note.part) : null
  if (note.kind === "frame" && note.frame) return `标在：${motion(note.frame.clip)} · 第 ${noteTick(note.frame.time)} 帧${part ? ` · ${part}` : ""}`
  const verb = note.kind === "circle" ? "圈在" : note.kind === "arrow" ? "指向" : "写在"
  // Drawn on a flat picture (a texture) rather than from a view of a model: where on the picture is all there is to say.
  if (note.camera === null && note.start) return `${verb}：贴图区域 ${noteArea(note.start, note.end)}`
  return part ? `${verb}：${part}` : note.kind === "text" && note.part === null ? "说的是整体" : `${verb}：整体`
}

const percent = (value: number) => `${Math.round(value * 100)}%`
/** A place on a picture, in shares of its width and height from the top left: the picture's size may differ between versions. */
const noteArea = (start: { x: number; y: number }, end?: { x: number; y: number }) => `左 ${percent(start.x)} 上 ${percent(start.y)}${end ? ` 到 左 ${percent(end.x)} 上 ${percent(end.y)}` : ""}`

/** A motion's frames are the game's ticks: 20 a second. */
export const noteTick = (time: number) => Math.round(time * 20)

export const ONLY_MARKED = "只改标到的地方，别的不动。"

/** The words a note set is handed over with. The limit of a remark is 500 characters; what does not fit is in the marks handed over beside it, whole. */
export function noteBrief(notes: readonly MakingNote[], options: { onlyMarked: boolean; extra?: string; title?: (part: string) => string }) {
  const tail = [options.extra?.trim(), options.onlyMarked ? ONLY_MARKED : ""].filter(Boolean).join(" ")
  const room = NOTE_LIMITS.feedback - tail.length - 16
  const lines = notes.map((note) => `${note.id}. ${notePlace(note, options.title)}：${note.text || "（看图上标的）"}`)
  const kept = lines.reduce<string[]>((held, line) => (held.join("\n").length + line.length + 1 > room ? held : [...held, line]), [])
  const left = lines.length - kept.length
  return [...kept, ...(left ? [`另外 ${left} 条见图上标注。`] : []), ...(tail ? [tail] : [])].join("\n").slice(0, NOTE_LIMITS.feedback)
}

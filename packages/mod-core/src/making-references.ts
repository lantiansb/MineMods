import { createHash, randomUUID } from "node:crypto"
import { readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { REFERENCE_KINDS, REFERENCE_LIMITS, REFERENCE_ORDER, REFERENCE_REFUSALS, THREE_VIEW_BY, THREE_VIEW_SLOTS, SixViewStyleSchema, viewSlot, type ReferenceKind, type ThreeViewBy, type ThreeViewSlot, type SixViewStyle } from "@minemods/studio-ai/making"
import { SCRIPT_LIMITS, type TracePicture } from "@minemods/studio-ai/script"
import { StoredModelAnnotationSchema } from "@minemods/studio-ai/model-annotation"
import { fitWithin, decodeImage, ImageUnreadable, pictureType } from "./image-decode"
import { storagePath, withProjectLock, writeRecord } from "./project"

/**
 * Reference pictures for a thing being made: what the person attached to their request ("user"), views
 * the AI drew of what it intends before modelling ("concept"), and the thing's 六视图 ("three_view", 2026-10-08):
 * the shape the person settled on, which the maker follows. It was three views until the owner made it six the same
 * night; the stored kind keeps the name "three_view", so nothing written since needs to change. They are kept inside the project,
 * beside the making records, so they travel with it; nothing here sends them anywhere. A reference
 * belongs to an overview item (a plan entry or a saved asset), so one can be attached before anything
 * has been made.
 */

const FILE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/
export const ReferenceSchema = z.strictObject({
  id: z.uuid(),
  /** `user`: the person attached it. `concept`: an AI drew it of what it meant to make. `three_view`: the thing's 六视图 (the name it was first stored under). */
  kind: z.enum(REFERENCE_KINDS),
  /** The file's own name, or which view a concept shows. Words for a label, nothing more. */
  name: z.string().max(REFERENCE_LIMITS.name),
  file: z.string().regex(FILE),
  added_at: z.iso.datetime(),
  /** A 六视图's slot: the whole sheet, or one of its six views. Only a 六视图 has one. `side`, stored when there were three, is read as `left`. */
  view: z.enum(THREE_VIEW_SLOTS).optional(),
  /** Who put a 六视图 there: the person, or an image model the person asked. Only a 六视图 has one. */
  by: z.enum(THREE_VIEW_BY).optional(),
  style: SixViewStyleSchema.optional(),
}).refine((value) => (value.kind === "three_view" ? value.view !== undefined && value.by !== undefined : value.view === undefined && value.by === undefined && value.style === undefined))
export type Reference = z.infer<typeof ReferenceSchema>
const IndexSchema = z.strictObject({ schema_version: z.literal(1), owner: z.string().min(1).max(200), references: z.array(ReferenceSchema).max(REFERENCE_LIMITS.user + REFERENCE_LIMITS.concept + REFERENCE_LIMITS.three_view),
  /** The person chose to have this thing made from words, without a 六视图 (broad20): kept with the thing so it is not asked again, and travels with the project. Absent: not chosen. */
  by_words: z.literal(true).optional(),
})

/** An attachment refused, in words for the person (or the AI) who offered it. Nothing was changed. */
export class ReferenceRefusal extends Error {}

const FOLDER = [".minemods", "making", "references"]
// An owner is an item's id as the overview has it; its folder is named by a hash so any id is a safe name.
const folderOf = (owner: string) => createHash("sha256").update(owner).digest("hex").slice(0, 32)
const indexSegments = (owner: string) => [...FOLDER, `${folderOf(owner)}.json`]

const absent = (error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
  throw error
}

export { pictureType }
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const

/** The bytes of a picture handed over as a data URL. Refuses what is not one of the three kinds, or is too large. */
function pictureOf(url: string) {
  const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (!match) throw new ReferenceRefusal(REFERENCE_REFUSALS.not_a_picture)
  // Four characters carry three bytes: refused by length before anything is decoded.
  if (match[1]!.length > Math.ceil(REFERENCE_LIMITS.bytes / 3) * 4 + 4) throw new ReferenceRefusal(REFERENCE_REFUSALS.too_large)
  const bytes = Buffer.from(match[1]!, "base64")
  const type = pictureType(bytes)
  if (!type) throw new ReferenceRefusal(REFERENCE_REFUSALS.not_a_picture)
  if (bytes.length > REFERENCE_LIMITS.bytes) throw new ReferenceRefusal(REFERENCE_REFUSALS.too_large)
  return { bytes, type }
}

/** An index's references as they are used now: a `side` view kept from when there were three views is the left side it was read as. Written back so on the next change. */
async function readWhole(directory: string, owner: string) {
  const text = await readFile(await storagePath(directory, indexSegments(owner)), "utf8").catch(absent)
  const index = IndexSchema.safeParse(await Promise.resolve(text ?? "null").then(JSON.parse).catch(() => null)).data
  return index?.owner === owner ? index : null
}
async function readIndex(directory: string, owner: string) {
  const index = await readWhole(directory, owner)
  return index ? index.references.map((reference): Reference => (reference.view ? { ...reference, view: viewSlot(reference.view) } : reference)) : []
}

/** Whether the person chose to have this thing made from words, without a 六视图. The choice belongs to the thing, so it holds for a redo as well. */
export async function readByWords(directory: string, owner: string) {
  return (await readWhole(directory, owner))?.by_words === true
}

/** Records that choice. It stays with the thing's pictures in the project; adding or removing pictures later does not undo it. */
export function setByWords(directory: string, owner: string) {
  return withProjectLock(directory, async () => {
    if (await readByWords(directory, owner)) return
    await writeRecord(directory, indexSegments(owner), IndexSchema.parse({ schema_version: 1, owner, references: await readIndex(directory, owner), by_words: true }))
  })
}

/** Where a reference stands among a thing's references: the 六视图 first (the sheet, then front, back, left, right, top and quarter, as the renders), then the person's own, then what an AI drew. */
const rank = (reference: Pick<Reference, "kind" | "view">) => REFERENCE_ORDER.indexOf(reference.kind) * THREE_VIEW_SLOTS.length + (reference.view ? THREE_VIEW_SLOTS.indexOf(viewSlot(reference.view)) : 0)
const ranked = <T extends Pick<Reference, "kind" | "view">>(left: T, right: T) => rank(left) - rank(right)

/** The references of one item, the 六视图 first, then the person's own. An item with none, or with an index that cannot be read, has none. */
export async function readReferences(directory: string, owner: string) {
  return (await readIndex(directory, owner)).sort(ranked)
}

const store = async (directory: string, owner: string, picture: ReturnType<typeof pictureOf>, kind: ReferenceKind, name: string, slot?: { view: ThreeViewSlot; by: ThreeViewBy; style?: SixViewStyle }): Promise<Reference> => {
  const id = randomUUID()
  const file = `${id}.${picture.type}`
  await writeFile(await storagePath(directory, [...FOLDER, folderOf(owner), file], true), picture.bytes)
  return { id, kind, name: name.trim().slice(0, REFERENCE_LIMITS.name), file, added_at: new Date().toISOString(), ...slot }
}
const unstore = (directory: string, owner: string, gone: Reference[]) => Promise.all(gone.map(async (value) => rm(await storagePath(directory, [...FOLDER, folderOf(owner), value.file]), { force: true })))

// Written under the project lock, so the choice to go by words (read again here) is carried along with every change of pictures.
const write = async (directory: string, owner: string, references: Reference[]) => writeRecord(directory, indexSegments(owner), IndexSchema.parse({ schema_version: 1, owner, references, ...((await readByWords(directory, owner)) ? { by_words: true } : {}) }))

/** Attach one picture to an item. Refused, with nothing changed, when it is not a picture, is too large, or the item is full. */
export async function addReference(directory: string, owner: string, input: { kind: Exclude<ReferenceKind, "three_view">; name: string; url: string; replaceId?: string }) {
  return withProjectLock(directory, () => addReferenceUnlocked(directory, owner, input))
}

/** Internal transaction primitive: caller holds withProjectLock, including metadata naming the reference. */
export async function addReferenceUnlocked(directory: string, owner: string, input: { kind: Exclude<ReferenceKind, "three_view">; name: string; url: string; replaceId?: string }) {
  const picture = pictureOf(input.url)
  const held = await readIndex(directory, owner)
  // A replacement owns exactly one same-kind reference. Keep the previous picture until the new index is saved.
  const previous = input.replaceId ? held.find((value) => value.id === input.replaceId) : undefined
  if (previous && previous.kind !== input.kind) throw new ReferenceRefusal(REFERENCE_REFUSALS.gone)
  const kept = held.filter((value) => value.id !== previous?.id)
  if (kept.filter((value) => value.kind === input.kind).length >= REFERENCE_LIMITS[input.kind]) throw new ReferenceRefusal(REFERENCE_REFUSALS.too_many(input.kind))
  await write(directory, owner, [...kept, await store(directory, owner, picture, input.kind, input.name)])
  if (previous) await rm(await storagePath(directory, [...FOLDER, folderOf(owner), previous.file]), { force: true })
  return readReferences(directory, owner)
}

/** Take one picture off an item. */
export function removeReference(directory: string, owner: string, id: string) {
  return withProjectLock(directory, () => removeReferenceUnlocked(directory, owner, id))
}

/** Internal transaction primitive: caller holds withProjectLock. */
export async function removeReferenceUnlocked(directory: string, owner: string, id: string) {
  const held = await readIndex(directory, owner)
  const gone = held.find((value) => value.id === id)
  if (!gone) throw new ReferenceRefusal(REFERENCE_REFUSALS.gone)
  const annotationPath = z.uuid().safeParse(owner).success ? await storagePath(directory, [".minemods", "making", "annotations", `${owner}.json`]) : null
  const text = annotationPath ? await readFile(annotationPath, "utf8").catch(absent) : null
  const annotation = text ? StoredModelAnnotationSchema.parse(JSON.parse(text)) : null
  await write(directory, owner, held.filter((value) => value !== gone))
  // The PNG and its edit intent belong together. Removing an ordinary reference never clears the annotation.
  if (annotationPath && annotation?.context.targetId === owner && annotation.referenceId === id) await rm(annotationPath, { force: true })
  await unstore(directory, owner, [gone])
  return readReferences(directory, owner)
}

/** The views an AI drew of what it intends, in place of any it drew before. An empty list takes them away. The person's own pictures are not touched. */
export async function setConcepts(directory: string, owner: string, views: { name: string; url: string }[]) {
  if (views.length > REFERENCE_LIMITS.concept) throw new ReferenceRefusal(REFERENCE_REFUSALS.too_many("concept"))
  const pictures = views.map((view) => ({ name: view.name, picture: pictureOf(view.url) }))
  return withProjectLock(directory, async () => {
    const held = await readIndex(directory, owner)
    if (!pictures.length && !held.some((value) => value.kind === "concept")) return readReferences(directory, owner)
    const drawn = await Promise.all(pictures.map((view) => store(directory, owner, view.picture, "concept", view.name)))
    await write(directory, owner, [...held.filter((value) => value.kind !== "concept"), ...drawn])
    await unstore(directory, owner, held.filter((value) => value.kind === "concept"))
    return readReferences(directory, owner)
  })
}

/**
 * 2026-10-08: a picture into one slot of the item's 六视图, in place of what the slot held, so it never holds more than six. The whole
 * sheet stands for all six views, so a sheet takes the place of every view and a single view takes the place of a sheet; a `side` from
 * before the six is the left slot. One 六视图 is all the person's or all drawn: the person's picture takes the place of a drawn one, and an
 * image model (`by` "ai") only ever replaces what an image model drew — while the person's own is there it is refused, and nothing is
 * changed. Unlike a concept, a 六视图 is not taken away when the thing is made again: it is the shape the person settled on.
 */
export async function setThreeView(directory: string, owner: string, input: { view: ThreeViewSlot; by: ThreeViewBy; name: string; url: string; style?: SixViewStyle }) {
  const picture = pictureOf(input.url)
  return withProjectLock(directory, async () => {
    const held = await readIndex(directory, owner)
    const views = held.filter((value) => value.kind === "three_view")
    if (input.by === "ai" && views.some((value) => value.by === "person")) throw new ReferenceRefusal(REFERENCE_REFUSALS.person_three_view)
    const slot = viewSlot(input.view)
    const replaced = views.filter((value) => slot === "sheet" || value.view === "sheet" || value.view === slot || value.by !== input.by)
    const style = input.style ?? (input.by === "ai" ? "blocky" : undefined)
    const placed = await store(directory, owner, picture, "three_view", input.name, { view: slot, by: input.by, ...(style ? { style } : {}) })
    await write(directory, owner, [...held.filter((value) => !replaced.includes(value)), placed])
    await unstore(directory, owner, replaced)
    return readReferences(directory, owner)
  })
}

/** A stored reference as a data URL, or null when its file is gone or is no longer a picture. */
export async function readReferencePicture(directory: string, owner: string, reference: Pick<Reference, "file">) {
  const bytes = await readFile(await storagePath(directory, [...FOLDER, folderOf(owner), reference.file])).catch(absent)
  const type = bytes && bytes.length <= REFERENCE_LIMITS.bytes ? pictureType(bytes) : null
  return bytes && type ? `data:${MIME[type]};base64,${bytes.toString("base64")}` : null
}

/**
 * Everything attached to any of these items (a plan entry and the asset made for it are two ids of one
 * thing), with the pictures themselves: the 六视图 first, then the person's own, since theirs outrank what an AI drew.
 */
const slotOf = (reference: Reference): Pick<Reference, "view" | "by" | "style"> => (reference.view && reference.by ? { view: reference.view, by: reference.by, ...(reference.style ? { style: reference.style } : {}) } : {})

export async function shownReferences(directory: string, owners: (string | null | undefined)[]) {
  const listed = await Promise.all([...new Set(owners.flatMap((owner) => (owner ? [owner] : [])))].map(async (owner) => (await readReferences(directory, owner)).map((reference) => ({ owner, reference }))))
  const read = await Promise.all(
    listed
      .flat()
      .sort((left, right) => ranked(left.reference, right.reference))
      .map(async (held) => ({ id: held.reference.id, kind: held.reference.kind, name: held.reference.name, ...slotOf(held.reference), url: await readReferencePicture(directory, held.owner, held.reference) })),
  )
  return read.flatMap((value) => (value.url ? [{ ...value, url: value.url }] : []))
}

/** The same without the pictures: who drew each and what it is called. Cheap enough to read on every poll. */
export async function listedReferences(directory: string, owners: (string | null | undefined)[]) {
  const listed = await Promise.all([...new Set(owners.flatMap((owner) => (owner ? [owner] : [])))].map((owner) => readReferences(directory, owner)))
  return listed
    .flat()
    .sort(ranked)
    .map((reference) => ({ id: reference.id, kind: reference.kind, name: reference.name, ...(reference.view ? { view: reference.view } : {}) }))
}

// A reference file never changes once stored (a new picture is a new id), so what was made of one is kept: a script that is run again and again
// while it is tuned must not decode and shrink the same 4 MB picture each time. Bounded: 16 pictures of at most 256 KiB of base64 text each.
const traced = new Map<string, TracePicture>()
const TRACED_KEPT = 16

/**
 * The concept pictures of these items (a plan entry and the asset made for it are two ids of one thing), made ready for `api.trace`: decoded
 * (PNG, JPEG or WebP, `image-decode.ts`), shrunk to at most `SCRIPT_LIMITS.trace` pixels on the long side, and written as base64 of raw RGBA.
 * A picture that cannot be read is listed by its name with the reason, so the script's author is told rather than finding a name missing.
 * Only the AI's own concept pictures: the person's pictures and the 六视图 are for the maker to look at, not to trace.
 */
export async function conceptPictures(directory: string, owners: (string | null | undefined)[]): Promise<TracePicture[]> {
  const listed = await Promise.all([...new Set(owners.flatMap((owner) => (owner ? [owner] : [])))].map(async (owner) => (await readReferences(directory, owner)).filter((reference) => reference.kind === "concept").map((reference) => ({ owner, reference }))))
  const made: TracePicture[] = []
  for (const { owner, reference } of listed.flat()) {
    if (made.length >= SCRIPT_LIMITS.pictures) break
    const key = `${await storagePath(directory, [...FOLDER, folderOf(owner), reference.file])}`
    const known = traced.get(key)
    if (known) {
      made.push({ ...known, name: reference.name })
      continue
    }
    const bytes = await readFile(key).catch(absent)
    const picture: TracePicture = await (async () => {
      if (!bytes || bytes.length > REFERENCE_LIMITS.bytes) return { name: reference.name, error: "图片文件找不到了，请重新交一次 save_concepts。" }
      try {
        const small = fitWithin(decodeImage(bytes), SCRIPT_LIMITS.trace)
        return { name: reference.name, width: small.width, height: small.height, rgba: Buffer.from(small.pixels.buffer, small.pixels.byteOffset, small.pixels.byteLength).toString("base64") }
      } catch (error) {
        if (error instanceof ImageUnreadable) return { name: reference.name, error: error.message }
        throw error
      }
    })()
    if (traced.size >= TRACED_KEPT) traced.delete(traced.keys().next().value!)
    traced.set(key, picture)
    made.push(picture)
  }
  return made
}

const PREFIX = ".minemods/making/references/"

/** Every index and the pictures it names, as archive entries. Caller holds the project lock. */
export async function archivedReferences(directory: string) {
  const folder = path.dirname(await storagePath(directory, [...FOLDER, "listing"]))
  const files = (await readdir(folder, { withFileTypes: true }).catch((error: unknown) => absent(error) ?? [])).filter((file) => file.isFile() && /^[0-9a-f]{32}\.json$/.test(file.name))
  const entries: Record<string, Uint8Array> = {}
  await Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(path.join(folder, file.name))
      const index = IndexSchema.safeParse(await Promise.resolve(bytes.toString("utf8")).then(JSON.parse).catch(() => null)).data
      if (!index || `${folderOf(index.owner)}.json` !== file.name) return
      const pictures = await Promise.all(index.references.map(async (reference) => ({ reference, bytes: await readFile(path.join(folder, file.name.slice(0, -5), reference.file)).catch(absent) })))
      // An index travels with exactly the pictures that are still there.
      const kept = pictures.filter((picture) => picture.bytes && picture.bytes.length <= REFERENCE_LIMITS.bytes && pictureType(picture.bytes))
      entries[`${PREFIX}${file.name}`] = Buffer.from(`${JSON.stringify({ ...index, references: kept.map((picture) => picture.reference) }, null, 2)}\n`)
      kept.forEach((picture) => (entries[`${PREFIX}${file.name.slice(0, -5)}/${picture.reference.file}`] = picture.bytes!))
    }),
  )
  return entries
}

/** The archive paths that are references: each index must be named for its owner, each picture named by its index and really a picture. Throws on anything else under the folder. */
export function archivedReferencePaths(entries: Record<string, Uint8Array>) {
  const paths = Object.keys(entries).filter((name) => name.startsWith(PREFIX))
  const named = new Map(
    paths
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        const index = IndexSchema.parse(JSON.parse(Buffer.from(entries[name]!).toString("utf8")))
        if (name !== `${PREFIX}${folderOf(index.owner)}.json`) throw new Error("Reference index does not match its name")
        return [folderOf(index.owner), new Set(index.references.map((reference) => reference.file))] as const
      }),
  )
  paths
    .filter((name) => !name.endsWith(".json"))
    .forEach((name) => {
      const parts = name.slice(PREFIX.length).split("/")
      const bytes = entries[name]!
      if (parts.length !== 2 || !named.get(parts[0]!)?.has(parts[1]!) || bytes.length > REFERENCE_LIMITS.bytes || pictureType(bytes) !== parts[1]!.split(".").at(-1)) throw new Error("Reference picture is not named by an index")
    })
  return paths
}

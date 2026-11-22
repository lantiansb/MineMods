import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ModelAnnotationInputSchema, StoredModelAnnotationSchema } from "@minemods/studio-ai/model-annotation"
import { REFERENCE_LIMITS } from "@minemods/studio-ai/making"
import { ReferenceSchema } from "./making-references"
import { storagePath, type Project } from "./project"

const PREFIX = ".minemods/making/annotations/"
const FILE = /^[0-9a-f-]{36}\.json$/
const LIMIT = 512 * 1024
const IndexSchema = z.strictObject({ schema_version: z.literal(1), owner: z.string().min(1).max(200), references: z.array(ReferenceSchema).max(REFERENCE_LIMITS.user + REFERENCE_LIMITS.concept + REFERENCE_LIMITS.three_view), by_words: z.literal(true).optional() })

/** Small, named metadata only. Caller holds the project lock; the PNG travels through archivedReferences. */
export async function archivedModelAnnotations(directory: string) {
  const files = await readdir(path.dirname(await storagePath(directory, [...PREFIX.slice(0, -1).split("/"), "listing"])), { withFileTypes: true }).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  })
  return Object.fromEntries(await Promise.all(files.map(async (file) => {
    if (!file.isFile() || !FILE.test(file.name)) throw new Error("Invalid model annotation archive path")
    const name = `${PREFIX}${file.name}`
    const bytes = await readFile(await storagePath(directory, name.split("/")))
    if (bytes.length > LIMIT) throw new Error("Model annotation metadata is too large")
    const record = StoredModelAnnotationSchema.parse(JSON.parse(bytes.toString("utf8")))
    if (name !== `${PREFIX}${record.context.targetId}.json`) throw new Error("Model annotation target does not match its name")
    return [name, bytes] as const
  })))
}

/** Metadata must point to the same model owner's actual user PNG, with a compatible saved revision. */
export function archivedModelAnnotationPaths(entries: Record<string, Uint8Array>, project?: Project) {
  const paths = Object.keys(entries).filter((name) => name.startsWith(PREFIX))
  paths.forEach((name) => {
    const bytes = entries[name]!
    if (!FILE.test(name.slice(PREFIX.length)) || bytes.length > LIMIT) throw new Error("Invalid model annotation archive path")
    const record = StoredModelAnnotationSchema.parse(JSON.parse(Buffer.from(bytes).toString("utf8")))
    if (name !== `${PREFIX}${record.context.targetId}.json`) throw new Error("Model annotation target does not match its name")
    const owner = createHash("sha256").update(record.context.targetId).digest("hex").slice(0, 32)
    const indexBytes = entries[`.minemods/making/references/${owner}.json`]
    if (!indexBytes) throw new Error("Model annotation reference index is missing")
    const index = IndexSchema.parse(JSON.parse(Buffer.from(indexBytes).toString("utf8")))
    const reference = index.references.find((value) => value.id === record.referenceId && value.kind === "user" && value.file.endsWith(".png"))
    if (index.owner !== record.context.targetId || !reference) throw new Error("Model annotation reference belongs to another owner")
    const picture = entries[`.minemods/making/references/${owner}/${reference.file}`]
    if (!picture) throw new Error("Model annotation PNG is missing")
    ModelAnnotationInputSchema.parse({ ...record.context, image: `data:image/png;base64,${Buffer.from(picture).toString("base64")}` })
    if (project) {
      const asset = project.workspace.assets.find((value) => value.id === record.context.targetId)
      // Older metadata remains identifiable so the first read can remove its stale PNG after import.
      if (asset?.module !== "model" || asset.document.kind !== "model" || record.modelRevision > asset.revision || record.context.projectRevision > project.revision) throw new Error("Model annotation does not belong to the saved model revision")
    }
  })
  return paths
}

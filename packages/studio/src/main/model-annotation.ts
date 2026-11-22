import { readFile, rm } from "node:fs/promises"
import { z } from "zod"
import { addReferenceUnlocked, readReferencePicture, readReferences, removeReferenceUnlocked } from "@minemods/mod-core/making"
import { openProject, storagePath, withProjectLock, writeRecord, type Project } from "@minemods/mod-core/project"
import { ModelAnnotationContextSchema, ModelAnnotationInputSchema, StoredModelAnnotationSchema, type ModelAnnotationInput } from "@minemods/studio-ai/model-annotation"

export class ModelAnnotationError extends Error {}
const segments = (targetId: string) => [".minemods", "making", "annotations", `${z.uuid().parse(targetId)}.json`]

export const modelAnnotationContext = (annotation: ModelAnnotationInput) => ModelAnnotationContextSchema.parse({
  targetId: annotation.targetId,
  projectRevision: annotation.projectRevision,
  width: annotation.width,
  height: annotation.height,
  selectedPart: annotation.selectedPart,
  annotations: annotation.annotations,
  ...(annotation.only_marked === undefined ? {} : { only_marked: annotation.only_marked }),
})

/** A capture belongs to exactly one currently displayed model and project snapshot. Check before writing anything. */
export function validateModelAnnotation(input: unknown, project: Project, targetId: string) {
  const annotation = ModelAnnotationInputSchema.parse(input)
  if (annotation.targetId !== targetId) throw new ModelAnnotationError("标注对应的模型不是当前目标，请重新截图。")
  if (annotation.projectRevision !== project.revision) throw new ModelAnnotationError("截图之后工程已经变化，请重新截图再修改。")
  return annotation
}

async function storedAnnotation(directory: string, targetId: string) {
  const text = await readFile(await storagePath(directory, segments(targetId)), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  return text ? StoredModelAnnotationSchema.parse(JSON.parse(text)) : null
}

/** Only the annotation-owned reference is removed; ordinary user and concept pictures stay attached. */
async function clearUnlocked(directory: string, targetId: string) {
  const stored = await storedAnnotation(directory, targetId)
  if (!stored) return
  if ((await readReferences(directory, targetId)).some((reference) => reference.id === stored.referenceId)) await removeReferenceUnlocked(directory, targetId, stored.referenceId)
  await rm(await storagePath(directory, segments(targetId)), { force: true })
}

export const clearModelAnnotation = (directory: string, targetId: string) => withProjectLock(directory, () => clearUnlocked(directory, targetId))

/** The PNG uses the existing reference store; readable marks stay separate from the person's 500-character feedback. */
export async function storeModelAnnotation(directory: string, annotation: ModelAnnotationInput, modelRevision: number) {
  return withProjectLock(directory, async () => {
    const current = await openProject(directory)
    validateModelAnnotation(annotation, current, annotation.targetId)
    if (!current.workspace.assets.some((asset) => asset.id === annotation.targetId && asset.module === "model" && asset.revision === modelRevision)) throw new ModelAnnotationError("标注对应的模型已经变化，请重新截图。")
    const name = `图上修改 · 工程版本 ${annotation.projectRevision} · ${crypto.randomUUID().slice(0, 8)}`
    const previous = await storedAnnotation(directory, annotation.targetId)
    const references = await addReferenceUnlocked(directory, annotation.targetId, { kind: "user", name, url: annotation.image, ...(previous ? { replaceId: previous.referenceId } : {}) })
    const reference = references.find((value) => value.name === name)
    if (!reference) throw new ModelAnnotationError("标注图片没有保存，请重试。")
    await writeRecord(directory, segments(annotation.targetId), StoredModelAnnotationSchema.parse({ context: modelAnnotationContext(annotation), modelRevision, referenceId: reference.id }))
  })
}

/** Only a redo of this saved model revision receives these edit instructions. */
export async function readModelAnnotation(directory: string, targetId: string, modelRevision: number) {
  return withProjectLock(directory, async () => {
    const stored = await storedAnnotation(directory, targetId)
    if (!stored) return null
    if (stored.context.targetId !== targetId || stored.modelRevision !== modelRevision) {
      await clearUnlocked(directory, targetId)
      return null
    }
    const reference = (await readReferences(directory, targetId)).find((value) => value.id === stored.referenceId)
    const image = reference ? await readReferencePicture(directory, targetId, reference) : null
    if (!image) throw new ModelAnnotationError("图上修改的参考图片已丢失，请重新截图。")
    return { context: stored.context, image }
  })
}

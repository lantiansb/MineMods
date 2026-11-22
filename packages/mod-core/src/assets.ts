import { createHash, randomUUID } from "node:crypto"
import { lstat, readFile, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import {
  openProject,
  RevisionConflictError,
  saveProjectUnlocked,
  storagePath,
  withProjectLock,
  writeRecord,
} from "./project"
import type { WorkspaceAsset } from "./workspace"
import type { AssetOrigin } from "./project"

function modelDesignFromData(data: unknown) {
  const candidate = typeof data === "object" && data !== null && "design" in data
    ? (data as { design?: unknown }).design
    : data
  const parsed = ModelDesignSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

function modelProvenanceFromData(data: unknown, asset: WorkspaceAsset, origin: AssetOrigin) {
  if (origin === "manual" || origin === "example") return { model: null, request_id: null }
  const raw = typeof data === "object" && data !== null && "provenance" in data
    ? (data as { provenance?: unknown }).provenance
    : undefined
  const parsed = z.object({ model: z.string().trim().max(120).nullable().optional(), request_id: z.uuid().nullable().optional() }).safeParse(raw)
  return {
    model: parsed.success ? parsed.data.model ?? origin : origin,
    request_id: parsed.success ? parsed.data.request_id ?? null : null,
  }
}

function workspaceModelUpdate(asset: WorkspaceAsset, data: unknown, origin: AssetOrigin) {
  const design = modelDesignFromData(data)
  if (!design) return asset
  const document = { kind: "model" as const, ...design }
  const { kind: _kind, ...currentDesign } = asset.document
  const changed = JSON.stringify(ModelDesignSchema.parse(currentDesign)) !== JSON.stringify(design)
  const provenance = modelProvenanceFromData(data, asset, origin)
  return {
    ...asset,
    document,
    revision: changed ? asset.revision + 1 : asset.revision,
    updated_at: changed ? new Date().toISOString() : asset.updated_at,
    provenance,
    status: "ready" as const,
  }
}

export const ModelAssetSchema = z.strictObject({
  schema_version: z.literal(1),
  id: z.uuid(),
  entity_id: z.uuid(),
  revision: z.number().int().positive(),
  origin: z.enum(["gpt-6-astra", "ai", "manual", "example"]),
  created_at: z.iso.datetime(),
  data: z.json(),
})
export type ModelAsset = z.infer<typeof ModelAssetSchema>

/** Caller validates geometry and assigns provenance; renderer input must never select trusted AI provenance. */
export async function putModelAssetUnlocked(
  directory: string,
  project: Awaited<ReturnType<typeof openProject>>,
  input: {
    entity_id: string
    data: unknown
    origin: AssetOrigin
    expectedRevision: number
    job_id?: string
  },
) {
  z.uuid().parse(input.entity_id)
  if (project.revision !== input.expectedRevision)
    throw new RevisionConflictError(input.expectedRevision, project.revision)
  const entity = project.entities.find((value) => value.id === input.entity_id)
  if (!entity) throw new Error(`Unknown entity: ${input.entity_id}`)
  if (input.job_id) {
    const jobs = await import("./jobs")
    const job = await jobs.loadJob(directory, input.job_id)
    if (job.state !== "running") throw new Error(`Model job must be running; current state is ${job.state}`)
    if (job.entity_id !== entity.id) throw new Error("Model job belongs to a different entity")
    if (job.project_revision !== input.expectedRevision)
      throw new RevisionConflictError(job.project_revision, input.expectedRevision)
  }
  const previous = project.assets.find((asset) => asset.id === entity.model_asset_id)
  const versions = previous
    ? await readdir(path.dirname(await storagePath(directory, [".minemods", "assets", previous.id, "listing"])))
    : []
  const asset = ModelAssetSchema.parse({
    schema_version: 1,
    id: previous?.id ?? randomUUID(),
    entity_id: entity.id,
    revision:
      Math.max(
        previous?.revision ?? 0,
        ...versions.filter((name) => /^[1-9][0-9]*\.json$/.test(name)).map((name) => Number(name.slice(0, -5))),
      ) + 1,
    origin: input.origin,
    created_at: new Date().toISOString(),
    data: input.data,
  })
  const segments = [".minemods", "assets", asset.id, `${asset.revision}.json`]
  const existing = await lstat(await storagePath(directory, segments, true)).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
    throw error
  })
  if (existing) throw new Error("Asset revision already exists; immutable asset revisions cannot be overwritten")
  await writeRecord(directory, segments, asset)
  const reference = {
    id: asset.id,
    entity_id: asset.entity_id,
    revision: asset.revision,
    origin: asset.origin,
    created_at: asset.created_at,
    sha256: createHash("sha256")
      .update(await readFile(await storagePath(directory, segments)))
      .digest("hex"),
  }
  const workspaceModel = project.workspace.assets.find((value) => value.id === entity.id && value.module === "model")
  const workspace = workspaceModel
    ? { assets: project.workspace.assets.map((value) => value.id === workspaceModel.id ? workspaceModelUpdate(value, input.data, input.origin) : value) }
    : project.workspace
  try {
    const updated = await saveProjectUnlocked(
      directory,
      {
        ...project,
        workspace,
        assets: [...project.assets.filter((value) => value.id !== asset.id), reference],
        entities: project.entities.map((value) =>
          value.id === entity.id ? { ...value, model_asset_id: asset.id } : value,
        ),
      },
      input.expectedRevision,
    )
    return { project: updated, asset }
  } catch (error) {
    const target = await storagePath(directory, segments)
    await rm(previous ? target : path.dirname(target), { recursive: !previous, force: true }).catch(() => undefined)
    throw error
  }
}

export async function putModelAsset(
  directory: string,
  input: {
    entity_id: string
    data: unknown
    origin: AssetOrigin
    expectedRevision: number
    job_id?: string
  },
) {
  z.uuid().parse(input.entity_id)
  return withProjectLock(directory, async () => putModelAssetUnlocked(directory, await openProject(directory), input))
}

export async function loadModelAsset(directory: string, assetId: string, revision?: number) {
  z.uuid().parse(assetId)
  if (revision !== undefined) z.number().int().positive().parse(revision)
  const project = await openProject(directory)
  const reference = project.assets.find((asset) => asset.id === assetId)
  if (!reference) throw new Error(`Unknown model asset: ${assetId}`)
  const asset = ModelAssetSchema.parse(
    JSON.parse(
      await readFile(
        await storagePath(directory, [".minemods", "assets", assetId, `${revision ?? reference.revision}.json`]),
        "utf8",
      ),
    ),
  )
  if (
    asset.id !== assetId ||
    asset.entity_id !== reference.entity_id ||
    asset.revision !== (revision ?? reference.revision)
  )
    throw new Error("Model asset metadata does not match the requested revision")
  return asset
}

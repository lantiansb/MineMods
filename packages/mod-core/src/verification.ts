import { readFile } from "node:fs/promises"
import { z } from "zod"
import { storagePath, withProjectLock, writeRecord } from "./project"

/**
 * One check that was actually run against a built mod. `gametest` runs headless on the server;
 * `client` means someone (or a script) looked at the running game. The two are never merged into one flag.
 */
export const VerificationCaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
  asset_ids: z.array(z.uuid()).min(1).max(64),
  kind: z.enum(["gametest", "client"]),
  passed: z.boolean(),
  detail: z.string().max(4000),
  /** Path inside the project folder, forward slashes, never climbing out of it. */
  screenshot: z
    .string()
    .max(512)
    .regex(/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\:*?"<>|\0]+$/)
    .optional(),
})

export const VerificationRecordSchema = z
  .strictObject({
    schema_version: z.literal(1),
    build_id: z.uuid(),
    updated_at: z.iso.datetime(),
    cases: z.array(VerificationCaseSchema).max(1024),
  })
  .superRefine((record, context) => {
    if (new Set(record.cases.map((value) => value.id)).size !== record.cases.length)
      context.addIssue({ code: "custom", path: ["cases"], message: "Duplicate verification case ID" })
  })

export type VerificationCase = z.infer<typeof VerificationCaseSchema>
export type VerificationRecord = z.infer<typeof VerificationRecordSchema>

function missing(error: unknown) {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined
  throw error
}

// Read loosely: only what proves the build finished and what went into it.
const BuiltSchema = z.object({ id: z.uuid(), jarPath: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const BuiltAssetsSchema = z.object({ workspace_assets: z.array(z.object({ id: z.uuid() })) })

/** The assets a finished build says it contains; throws when the build is not a finished one or does not say. */
async function builtAssets(directory: string, buildId: string) {
  const id = z.uuid().parse(buildId)
  const result = BuiltSchema.safeParse(
    await readFile(await storagePath(directory, [".minemods", "builds", `${id}.json`]), "utf8")
      .then(JSON.parse)
      .catch(() => null),
  )
  if (!result.success || result.data.id !== id) throw new Error("Verification requires a recorded successful build")
  const manifest = BuiltAssetsSchema.safeParse(
    await readFile(await storagePath(directory, ["generated", `build-${id}`, "minemods-build.json"]), "utf8")
      .then(JSON.parse)
      .catch(() => null),
  )
  if (!manifest.success) throw new Error("This build does not list what went into it; build the project again before recording checks")
  return new Set(manifest.data.workspace_assets.map((asset) => asset.id))
}

function segments(buildId: string) {
  return [".minemods", "verifications", `${z.uuid().parse(buildId)}.json`]
}

/** What has been checked in the game for one build, or null when nothing has been recorded. */
export async function readVerification(directory: string, buildId: string) {
  const text = await readFile(await storagePath(directory, segments(buildId)), "utf8").catch(missing)
  if (text === undefined) return null
  const record = VerificationRecordSchema.parse(JSON.parse(text))
  if (record.build_id !== buildId) throw new Error("Verification record does not belong to this build")
  return record
}

/**
 * Add or replace results by case id. GameTest and client checks arrive at different times, so earlier
 * results for other cases are kept. Only a build that really finished can be verified.
 */
export async function recordVerification(directory: string, input: { build_id: string; cases: VerificationCase[] }) {
  const cases = z.array(VerificationCaseSchema).parse(input.cases)
  return withProjectLock(directory, async () => {
    const built = await builtAssets(directory, input.build_id)
    const stray = cases.flatMap((value) => value.asset_ids).find((id) => !built.has(id))
    if (stray) throw new Error(`Verification names an asset that is not part of this build: ${stray}`)
    const record = VerificationRecordSchema.parse({
      schema_version: 1,
      build_id: input.build_id,
      updated_at: new Date().toISOString(),
      cases: [
        ...((await readVerification(directory, input.build_id))?.cases ?? []).filter((value) => !cases.some((next) => next.id === value.id)),
        ...cases,
      ],
    })
    await writeRecord(directory, segments(input.build_id), record)
    return record
  })
}

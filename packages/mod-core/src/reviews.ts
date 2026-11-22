import { readFile } from "node:fs/promises"
import { z } from "zod"
import { storagePath, withProjectLock, writeRecord } from "./project"

export const REVIEW_NOTE_LIMIT = 500

/**
 * What the person said about one saved thing after looking at it. It is bound to the revision they
 * looked at: once the thing changes, the verdict says nothing about the new version.
 */
export const ReviewSchema = z.strictObject({
  asset_id: z.uuid(),
  revision: z.number().int().min(1),
  verdict: z.enum(["accepted", "rejected"]),
  /** What should change, in the person's own words. Empty when they gave none. */
  note: z.string().trim().max(REVIEW_NOTE_LIMIT),
  at: z.iso.datetime(),
  /**
   * The last revision the person sent back, kept when a later verdict replaces that one. A higher revision
   * now means the thing was remade since, which is how what uses it learns it may no longer fit.
   */
  sent_back: z.number().int().min(1).optional(),
})

/** "Try once more" for a plan entry that failed and so has nothing saved to hang a verdict on. */
export const RedoRequestSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  feedback: z.string().trim().max(REVIEW_NOTE_LIMIT),
  at: z.iso.datetime(),
})

export const ReviewRecordSchema = z.strictObject({
  schema_version: z.literal(1),
  /** One per asset: the latest verdict replaces the earlier one. */
  reviews: z.array(ReviewSchema).max(4096),
  /** One per entry: asking again replaces the earlier request. */
  requests: z.array(RedoRequestSchema).max(256).default([]),
})

export type Review = z.infer<typeof ReviewSchema>
export type RedoRequest = z.infer<typeof RedoRequestSchema>
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>

const SEGMENTS = [".minemods", "reviews.json"]

/** Kept beside the project file, never in it, so a project from before reviews existed opens and saves unchanged. */
async function readRecord(directory: string) {
  const text = await readFile(await storagePath(directory, SEGMENTS), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "null"
    throw error
  })
  // A file that cannot be read as a record proves nothing, which is the same as nobody having judged anything.
  return (
    ReviewRecordSchema.safeParse(await Promise.resolve(text).then(JSON.parse).catch(() => null)).data ?? { schema_version: 1 as const, reviews: [], requests: [] }
  )
}

// The newest are kept when a list is full; the oldest are about revisions and failures long gone.
const change = (directory: string, update: (record: ReviewRecord) => Pick<ReviewRecord, "reviews" | "requests">) =>
  withProjectLock(directory, async () => {
    const next = update(await readRecord(directory))
    await writeRecord(directory, SEGMENTS, ReviewRecordSchema.parse({ schema_version: 1, reviews: next.reviews.slice(-4096), requests: next.requests.slice(-256) }))
  })

/** Verdicts for assets that no longer exist stay in the file and are simply never looked up. */
export async function readReviews(directory: string) {
  return (await readRecord(directory)).reviews
}

export async function readRedoRequests(directory: string) {
  return (await readRecord(directory)).requests
}

/** Store the person's verdict for exactly this revision of the asset, replacing what they said before. */
export async function recordReview(directory: string, input: { asset_id: string; revision: number; verdict: Review["verdict"]; note?: string }) {
  const review = ReviewSchema.parse({ ...input, note: input.note ?? "", at: new Date().toISOString() })
  await change(directory, (record) => {
    const earlier = record.reviews.find((value) => value.asset_id === review.asset_id)
    const sentBack = review.verdict === "rejected" ? review.revision : earlier?.sent_back
    return {
      requests: record.requests,
      reviews: [...record.reviews.filter((value) => value !== earlier), { ...review, ...(sentBack === undefined ? {} : { sent_back: sentBack }) }],
    }
  })
  return currentReview(await readReviews(directory), { id: review.asset_id, revision: review.revision })!
}

/**
 * The person takes their verdict back, as if they had never looked at this revision. The whole entry goes,
 * and with it the memory that the thing was once sent back. Nothing to take back is not an error.
 */
export async function clearReview(directory: string, input: { asset_id: string; revision: number }) {
  await change(directory, (record) => ({
    requests: record.requests,
    reviews: record.reviews.filter((value) => value.asset_id !== input.asset_id || value.revision !== input.revision),
  }))
}

/** Ask for one more try at an entry that was never made. */
export async function requestRedo(directory: string, input: { key: string; feedback?: string }) {
  const request = RedoRequestSchema.parse({ key: input.key, feedback: input.feedback ?? "", at: new Date().toISOString() })
  await change(directory, (record) => ({ reviews: record.reviews, requests: [...record.requests.filter((value) => value.key !== request.key), request] }))
  return request
}

/** The verdict that still counts for an asset: the one given for the revision it has now. */
export function currentReview(reviews: Review[], asset: { id: string; revision: number }) {
  return reviews.find((value) => value.asset_id === asset.id && value.revision === asset.revision) ?? null
}

/** The asset was sent back at some point and is no longer the version that was sent back. */
export function remadeSince(reviews: Review[], asset: { id: string; revision: number }) {
  return reviews.some((value) => value.asset_id === asset.id && value.sent_back !== undefined && value.sent_back < asset.revision)
}

import { readFile } from "node:fs/promises"
import { z } from "zod"
import { listJobs } from "./jobs"
import { storagePath } from "./project"

// Read loosely on purpose: these files were written by builds of any earlier version.
const OutputSchema = z.object({ id: z.uuid(), revision: z.number().int().nonnegative() })
const ManifestSchema = z.object({ workspace_assets: z.array(z.object({ id: z.uuid(), revision: z.number().int() })) })

/**
 * The newest build that really finished, with the assets its manifest says went into it. A build result
 * carries no time of its own, so "newest" is the order in which the build jobs completed.
 * `assets` is empty when the manifest is gone or predates the asset list: nothing is then claimed as built.
 */
export async function latestSuccessfulBuild(directory: string) {
  return (await buildHistory(directory)).build
}

export async function buildHistory(directory: string) {
  const jobs = (await listJobs(directory))
    .filter(job => job.kind === "build")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.created_at.localeCompare(a.created_at))
  const settled = jobs.find(job => job.state === "failed" || job.state === "completed")
  const job = jobs.find(job => job.state === "completed" && OutputSchema.safeParse(job.output).success)
  const detail = z.object({ build_detail: z.string() }).safeParse(settled?.checkpoint).data?.build_detail
  return {
    build: job ? await recordOfBuild(directory, job) : null,
    failure: settled?.state === "failed" ? {
      jobId: settled.id,
      reason: settled.error || "这次打包中断了，请重新打包。",
      ...(detail ? { detail } : {}),
    } : null,
  }
}

/**
 * One specific finished build, by the id of its build job: the same record as `latestSuccessfulBuild`, for the pack a run is working from
 * (which is not always the newest one: a later pack by an outside AI may have been made meanwhile). Null when the job is not a finished build.
 */
export async function successfulBuild(directory: string, jobId: string) {
  const job = (await listJobs(directory)).find((value) => value.id === jobId && value.kind === "build" && value.state === "completed" && OutputSchema.safeParse(value.output).success)
  return job ? recordOfBuild(directory, job) : null
}

async function recordOfBuild(directory: string, job: Awaited<ReturnType<typeof listJobs>>[number]) {
  const output = OutputSchema.parse(job.output)
  const text = await readFile(await storagePath(directory, ["generated", `build-${output.id}`, "minemods-build.json"]), "utf8").catch(
    (error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return "null"
      throw error
    },
  )
  return {
    id: output.id,
    /** The build job that made it: what the window and the test scene call "the pack". */
    job_id: job.id,
    /** The project revision that was built. */
    revision: output.revision,
    finished_at: job.updated_at,
    assets: (ManifestSchema.safeParse(await Promise.resolve(text).then(JSON.parse).catch(() => null)).data?.workspace_assets ?? []).map((asset) => ({ id: asset.id, revision: asset.revision })),
  }
}

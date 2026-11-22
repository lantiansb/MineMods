import { verifyBuiltResult, type BuildResult } from "./build"
import { runGradle, type RuntimeOptions } from "./runtime"

export async function launchPlaytest(buildResult: BuildResult, options: RuntimeOptions): Promise<void> {
  if (options.signal?.aborted) throw new Error("CANCELLED")
  await verifyBuiltResult(buildResult.projectDirectory, buildResult)
  const result = await runGradle(buildResult.sourceDirectory, "runClient", options)
  if (result.code !== 0) throw new Error("PLAYTEST_PROCESS_FAILED")
}

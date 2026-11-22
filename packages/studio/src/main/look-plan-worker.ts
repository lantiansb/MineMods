import { parentPort, workerData } from "node:worker_threads"
import { MakingRefusal } from "@minemods/mod-core/making"
import { lookJob, reviewJob } from "./look-job"
import type { ModelPlanRequest } from "./look-plan"

const request = workerData as ModelPlanRequest
try {
  parentPort!.postMessage({ plan: request.kind === "look" ? lookJob(...request.args) : reviewJob(...request.args) })
} catch (error) {
  parentPort!.postMessage({
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof MakingRefusal ? { refusal: { final: error.final, plain: error.plain } } : {}),
  })
}

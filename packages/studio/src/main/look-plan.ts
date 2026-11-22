import { Worker } from "node:worker_threads"
import { MakingRefusal } from "@minemods/mod-core/making"
import { lookJob, reviewJob } from "./look-job"

type Model = Extract<Parameters<typeof lookJob>[0], { kind: "model" }>
export type ModelPlanRequest =
  | { kind: "look"; args: Parameters<typeof lookJob> }
  | { kind: "review"; args: Parameters<typeof reviewJob> }

type PlanReply<T> = { plan: T } | { error: string; refusal?: { final: boolean; plain?: string } }

const heavy = (document: Parameters<typeof lookJob>[0]): document is Model =>
  document.kind === "model" && document.bones.reduce((count, bone) => count + bone.cubes.length, 0) > 512

function background<T>(request: ModelPlanRequest, signal?: AbortSignal) {
  signal?.throwIfAborted()
  // The unpacked worker runs for the model measurements only. Project storage and the renderer queue stay with their current owners.
  const entry = process.env.MINEMODS_LOOK_PLAN_WORKER!.replace(/([/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2")
  const worker = new Worker(entry, { workerData: request })
  let cancel: (() => void) | undefined
  return new Promise<T>((resolve, reject) => {
    cancel = () => reject(signal?.reason)
    signal?.addEventListener("abort", cancel, { once: true })
    worker.once("message", (reply: PlanReply<T>) => {
      if ("plan" in reply) resolve(reply.plan)
      else reject(reply.refusal ? new MakingRefusal(reply.error, reply.refusal.final, reply.refusal.plain) : new Error(reply.error))
    })
    worker.once("error", reject)
    worker.once("exit", (code) => reject(new Error(`Model look worker exited before answering (${code})`)))
  }).finally(() => {
    if (cancel) signal?.removeEventListener("abort", cancel)
    void worker.terminate()
  })
}

export async function planLook(args: Parameters<typeof lookJob>, signal?: AbortSignal): Promise<ReturnType<typeof lookJob>> {
  signal?.throwIfAborted()
  if (!process.env.MINEMODS_LOOK_PLAN_WORKER || !heavy(args[0])) return lookJob(...args)
  const [model, , options, sheet, world, speed, , key, itemOnly] = args
  return background({ kind: "look", args: [model, null, options, sheet, world, speed, null, key, itemOnly] }, signal)
}

export async function planReview(...args: Parameters<typeof reviewJob>): Promise<ReturnType<typeof reviewJob>> {
  if (!process.env.MINEMODS_LOOK_PLAN_WORKER || !heavy(args[0])) return reviewJob(...args)
  const [model, , sheet, world, speed, , key, itemOnly] = args
  return background({ kind: "review", args: [model, null, sheet, world, speed, null, key, itemOnly] })
}

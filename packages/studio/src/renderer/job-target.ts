import type { FindingTarget } from "@minemods/mod-core/reconcile"

/**
 * The thing a failed job stopped on, as a way to its card. The service leaves it in the job's checkpoint (`target`, a `FindingTarget` with no
 * field) when the failure carried the id of a thing of the project (a creature with no model); the window shows one button for it, the same
 * button a finding has. Read here with a shape check, since a checkpoint is open JSON and an older job has none.
 */
export function jobTarget(job: { checkpoint: unknown } | null | undefined): FindingTarget | undefined {
  const checkpoint = job?.checkpoint
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return undefined
  const target = (checkpoint as { target?: unknown }).target as Partial<FindingTarget> | undefined
  const about = target?.about
  return about && typeof about.id === "string" && typeof about.name === "string" && typeof about.kind === "string" && typeof target?.label === "string" && target.field === "" ? (target as FindingTarget) : undefined
}

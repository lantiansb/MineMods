import { expect } from "@playwright/test"

type Call = (name: string, args: Record<string, unknown>) => Promise<unknown>
type Task = { projectId: string; runId: string; taskId: string }
type Document = { kind: string; name?: string; bones?: { name: string; parent?: string | null }[]; animations?: { name: string }[] }

/** Test documents follow the current making contract. These deterministic review answers are test fixtures, not AI quality evidence. */
export async function fixtureSheet(call: Call, task: Task, document: Document) {
  await call("save_sheet", { ...task, sheet: {
    subject: document.name ?? document.kind,
    recognisable: document.bones?.map(bone => bone.name).slice(0, 8) ?? [document.name ?? document.kind],
    parts: (document.bones ?? [{ name: document.name ?? document.kind }]).map(bone => ({ name: bone.name, what: bone.name, shape: "See the unchanged geometric test specimen", attaches: bone.parent ?? "root", surface: "Materials and pixels of the test specimen", moves: document.animations?.map(animation => animation.name).join(", ") || "static", assumed: true })),
    assumed: ["Deterministic test specimen; no live model evaluation"],
  } })
}

export async function fixtureReview(call: Call, review: Call, task: Task, document: Document) {
  await call("look", { ...task, document, glance: true })
  await call("look", { ...task, document })
  for (const animation of document.animations ?? []) await call("look", { ...task, document, animation: animation.name })
  await call("self_review", { ...task, matches: ["The unchanged specimen matches its documented parts"], problems: [], advice: [], next: [], verdict: "done" })
  const inspection = await review("final_review", task) as { blind_first?: boolean }
  if (inspection.blind_first) await review("final_review", { ...task, blind: { sees: document.name ?? document.kind, also: [], because: "Deterministic review fixture for the documented test specimen" } })
  const result = await review("final_review", { ...task, verdict: { independent: true, passed: true, findings: [], advice: [], fits: "at_once" } })
  expect(result).toBeTruthy()
}

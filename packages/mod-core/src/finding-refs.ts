import type { FindingRef } from "@minemods/studio-ai/acceptance"
import { motionName } from "@minemods/studio-ai/making"

type NamedMove = { id: string; name: string }

/** Keep the project's ids and their display names together where a finding is made. */
export const clipRef = (id: string): FindingRef => ({ kind: "clip", id, title: motionName(id) })
export const abilityRef = (move: NamedMove): FindingRef => ({ kind: "ability", id: move.id, title: move.name })
export const comboRef = (combo: NamedMove): FindingRef => ({ kind: "combo", id: combo.id, title: combo.name })
export const assetRef = (id: string, title = id): FindingRef => ({ kind: "asset", id, title })
export const blueprintRef = (id: string, title: string): FindingRef => ({ kind: "blueprint", id, title })
export const registryRef = (id: string, title = id): FindingRef => ({ kind: "registry", id, title })
export const boneRef = (id: string): FindingRef => ({ kind: "bone", id, title: id })
export const stanceRef = (pose: NamedMove): FindingRef => ({ kind: "stance", id: pose.id, title: pose.name })
export const partRef = (id: string): FindingRef => ({ kind: "part", id, title: id })
export const fixtureRef = (id: string, title = id): FindingRef => ({ kind: "fixture", id, title })
export const phaseRef = (id: number): FindingRef => ({ kind: "phase", id, title: `第 ${id} 阶段` })

export const uniqueFindingRefs = (refs: FindingRef[]): FindingRef[] =>
  [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}:${ref.title}`, ref])).values()]

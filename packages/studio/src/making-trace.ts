/**
 * What was written while a thing was being made, step by step, so 制作现场 can follow it live and play it back.
 * Pure: the store is `main/making-history.ts`; the screen's words are `renderer/features/making-live-model.ts`.
 */
export const TRACE_LIMITS = {
  /** Steps kept of one version of one thing. Past it the steps are thinned evenly, the first and the newest stay. */
  steps: 200,
  /** A step whose document is larger than this keeps its tick and no copy (a texture of a few MB would fill the disk in one making). */
  document: 512 * 1024,
} as const

/** The three colours of the timeline. */
export type TraceKind = "write" | "look" | "review"
/** Which part of the making a write touched; the step bar reads it. */
export type TraceArea = "shape" | "paint" | "motion"

export type TraceStep = {
  seq: number
  at: string
  kind: TraceKind
  /** The bones or parts this step wrote; empty when it wrote none or the kind has none. */
  parts: string[]
  areas: TraceArea[]
  /** What the AI itself wrote about this call. Null when the tool has no such field or it said nothing: the screen never makes one up. */
  note: string | null
  /** A copy of the document as it stood is on disk. */
  copy: boolean
}

export type MakingTrace = {
  asset_id: string
  version: number
  steps: TraceStep[]
  /** How many steps were really recorded, thinned or not. */
  total: number
  /** How many of them were writes. */
  written: number
  /** Versions that have a trace, oldest first. */
  versions: number[]
  /** The AI's own words from a report that wrote nothing, when they are newer than any step's. */
  thought: { at: string; text: string } | null
}

/** Evenly thinned to `limit`, always keeping the first and the newest. */
export function thinSteps<T>(steps: readonly T[], limit: number = TRACE_LIMITS.steps): T[] {
  if (steps.length <= limit) return [...steps]
  if (limit < 2) return steps.slice(-Math.max(0, limit))
  return Array.from({ length: limit }, (_, index) => steps[Math.round((index * (steps.length - 1)) / (limit - 1))]!)
}

type Bone = { name?: unknown; cubes?: unknown }
type Doc = { kind?: unknown; bones?: unknown; animations?: unknown; pixels?: unknown }
const isPaint = (key: string) => /colou?r|paint|face|texture|uv|material|surface|detail/i.test(key)
const shapeOnly = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(shapeOnly)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => (isPaint(key) ? [] : [[key, shapeOnly(entry)]])))
      : value
const bonesOf = (document: Doc | null | undefined) => (Array.isArray(document?.bones) ? (document.bones as Bone[]).filter((bone) => typeof bone?.name === "string") : [])
const named = (document: Doc | null | undefined) => new Map(bonesOf(document).map((bone) => [bone.name as string, bone]))
/** A part inside a bone, when the document names them that finely. */
const partsOf = (bone: Bone) => (Array.isArray(bone.cubes) ? bone.cubes.flatMap((cube) => (cube && typeof cube === "object" && typeof (cube as { part?: unknown }).part === "string" ? [(cube as { part: string }).part] : [])) : [])

/** Every name a part can go by in this document: its bones and the parts its cubes name. */
export const documentParts = (document: unknown) => [...new Set(bonesOf(document as Doc).flatMap((bone) => [bone.name as string, ...partsOf(bone)]))]

/** What one write changed, by comparing it with the document before it. */
export function changedParts(before: unknown, after: unknown): { parts: string[]; areas: TraceArea[] } {
  const from = before as Doc | null | undefined
  const to = after as Doc | null | undefined
  if (!to) return { parts: [], areas: [] }
  const was = named(from)
  const moved = bonesOf(to).filter((bone) => JSON.stringify(was.get(bone.name as string)) !== JSON.stringify(bone))
  const parts = moved.flatMap((bone) => {
    const inner = partsOf(bone)
    const previous = new Set(partsOf(was.get(bone.name as string) ?? {}))
    const fresh = inner.filter((part) => !previous.has(part))
    return fresh.length ? fresh : [bone.name as string]
  })
  const shape = moved.some((bone) => JSON.stringify(shapeOnly(was.get(bone.name as string))) !== JSON.stringify(shapeOnly(bone))) || bonesOf(from).length !== bonesOf(to).length
  const areas: TraceArea[] = [
    ...(shape ? (["shape"] as const) : []),
    ...(moved.length && !shape ? (["paint"] as const) : []),
    ...(JSON.stringify(from?.animations ?? []) !== JSON.stringify(to.animations ?? []) ? (["motion"] as const) : []),
    ...(!moved.length && JSON.stringify(from?.pixels ?? null) !== JSON.stringify(to.pixels ?? null) ? (["paint"] as const) : []),
  ]
  return { parts: [...new Set(parts)], areas: [...new Set(areas)] }
}

/** Bones the version before had and this one does not have yet: what can honestly be drawn as "not made yet", since their place is known. */
export function missingBones<T extends { name: string }>(before: readonly T[] | null | undefined, now: readonly { name: string }[]) {
  const have = new Set(now.map((bone) => bone.name))
  return (before ?? []).filter((bone) => !have.has(bone.name))
}

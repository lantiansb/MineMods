import type { TargetId } from "../target/ids"

/**
 * The asset kinds a target cannot make into the game yet, each with the reason in the person's words. Every target
 * shares one generator, so a kind's own capability (`capability` in `workspace-modules.ts`) holds on all of them;
 * this is the one place an exception is written. `kindCapability` reads it, so the blueprint, the planner's list,
 * the saved status, the overview and the hand-off text all agree.
 *
 * It sits beside `ported.ts`, the feature groups a facade target cannot generate yet: a group listed there that a
 * kind needs is a gap here too (a test holds the two together). Both are empty: everything is ported.
 *
 * Kept free of imports beyond types: the renderer reads it through `workspace-modules.ts`.
 */
export const KIND_GAPS: Partial<Record<TargetId, Partial<Record<string, string>>>> = {}

/** The reason a target cannot make a kind yet; null when it can. */
export function kindGap(kind: string, target: TargetId): string | null {
  return KIND_GAPS[target]?.[kind] ?? null
}

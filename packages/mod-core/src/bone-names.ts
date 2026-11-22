/**
 * The one place that says what a Blockbench group or box is called inside a ModelDesign.
 *
 * Blockbench identifies every element by its uuid and lets any number of groups and boxes share a name. A
 * ModelDesign identifies a bone by its name, so the name a group gets here is its identity from then on
 * (animations, parents and the editable-model check all find it by it). The importer (`blockbench.ts`) and the
 * check that a saved design still describes its Blockbench file (`editable-model.ts`) must therefore derive the
 * very same names from the very same groups; having each keep its own copy of the rule is how an exported file
 * once failed to import back.
 */

/** A name the design's schema accepts: letters, digits and underscores, starting with a letter, at most 48 long. */
export function safeDesignName(value: string, fallback = "part") {
  const name = value.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]+/, "")
  return (name || fallback).slice(0, 48)
}

/**
 * Makes `value` unique among `taken` (and records it there) by appending `_1`, `_2`, ... so a repeated name keeps
 * its readable start. The suffix is counted inside the 48 letters, so a long name still fits.
 */
export function uniqueDesignName(value: string, taken: Set<string>, fallback = "part") {
  const base = safeDesignName(value, fallback)
  const candidate = (suffix: number): string => {
    const suffixText = suffix === 0 ? "" : `_${suffix}`
    const name = `${base.slice(0, Math.max(0, 48 - suffixText.length))}${suffixText}`
    return taken.has(name) ? candidate(suffix + 1) : name
  }
  const name = candidate(0)
  taken.add(name)
  return name
}

/**
 * The design name of each group, in the order the groups are given (the outliner's depth-first order).
 * Only bones compete for a name: a box named like a bone, or like a box in another bone, is no clash, because
 * the design asks box names to be unique inside their own bone only.
 */
export function boneNamesFor(groupNames: readonly string[]) {
  const taken = new Set<string>()
  return groupNames.map((name) => uniqueDesignName(name, taken))
}

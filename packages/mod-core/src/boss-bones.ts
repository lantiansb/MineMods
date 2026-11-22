import type { ModelDesign } from "@minemods/studio-ai/contracts"

/**
 * The named bones and every bone that hangs from them. Kept apart from the picture code (boss-look-picture.ts writes
 * PNGs with node:zlib) so the Studio window, which reads a show's model state, never pulls Node-only code into its bundle.
 */
export function bonesBelow(design: Pick<ModelDesign, "bones">, names: readonly string[]) {
  const found = new Set(names)
  let grew = true
  while (grew) {
    grew = false
    for (const bone of design.bones)
      if (bone.parent && found.has(bone.parent) && !found.has(bone.name)) {
        found.add(bone.name)
        grew = true
      }
  }
  return found
}

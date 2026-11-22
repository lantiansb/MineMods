import { effectModel, type EffectDocument } from "./effect"
import { fitModelAtlas } from "./model"

/**
 * What the build does with an effect's model, in one place: the model the document names, packed into the smallest texture of its tier its faces fit
 * (the size the document names, or the next ones up) and written as the game's geometry, motions and picture. Whoever asks whether an effect can be
 * built (the save, and so every look at it in the making loop and every draft of it) calls this and gets the build's own refusal, in the build's own
 * words; `compileEffects` calls it to build. Node side only: the app's window reads `effect.ts` and paints (`effectTexture`) without it.
 */
export function compileEffectModel(document: Pick<EffectDocument, "name" | "texture_size" | "texel_size" | "bones" | "animations">, name: string) {
  return fitModelAtlas(effectModel(document), name)
}

/** Why the build would refuse an effect's model, in the build's words, or null when it builds. */
export function effectBuildFault(document: Pick<EffectDocument, "name" | "texture_size" | "texel_size" | "bones" | "animations">, name = "effect_check") {
  try {
    compileEffectModel(document, name)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * Where GeckoLib 4.8.3's `AutoGlowingGeoLayer` looks for the glow picture of a texture: it takes the texture's own
 * path and puts `_glowmask` in front of the extension (`GeoAbstractTexture.appendToPath(id, "_glowmask")`, read with
 * javap from geckolib-fabric-1.21.1-4.8.3.jar). A mask anywhere else is not found, and the layer then draws nothing
 * and says nothing, so the build writes the mask by this one rule and checks the jar for it by the same rule.
 */
export function glowMaskPath(texturePath: string): string {
  const dot = texturePath.lastIndexOf(".")
  return `${texturePath.slice(0, dot)}_glowmask${texturePath.slice(dot)}`
}

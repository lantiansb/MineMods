import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { geoCube, paintModel, usesPaint, type AtlasIsland } from "@minemods/studio-ai/model-paint"
import type { Preview } from "./viewport"

type Rgba = { size: number; pixels: Uint8Array | Uint8ClampedArray }

/** The geometry part of a preview: only what the viewport reads, which is where each face sits on the atlas. */
function layout(design: ModelDesign, size: number, islands: AtlasIsland[]) {
  return {
    format_version: "1.12.0",
    "minecraft:geometry": [
      {
        description: { identifier: "geometry.preview", texture_width: size, texture_height: size, visible_bounds_width: 8, visible_bounds_height: 8, visible_bounds_offset: [0, 0, 0] },
        bones: design.bones.map((bone, boneIndex) => ({
          name: bone.name,
          pivot: bone.pivot,
          rotation: bone.rotation,
          // 第 1 步: the same cube the build writes (`geoCube`): turned, inflated and mirrored as it will be in the game.
          cubes: bone.cubes.map((cube, cubeIndex) => geoCube(cube, islands.filter((island) => island.boneIndex === boneIndex && island.cubeIndex === cubeIndex))),
        })),
      },
    ],
  } as unknown as Preview["geometry"]
}

function dataUrl(image: Rgba) {
  const canvas = document.createElement("canvas")
  canvas.width = image.size
  canvas.height = image.size
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.size, image.size), 0, 0)
  return canvas.toDataURL("image/png")
}

/**
 * A preview drawn in the page for a model that is painted by material and features, so drafts
 * and unsaved edits look the way the saved model will. Null for plain face-colour models, which
 * the viewport already draws itself, and for models whose faces do not fit their atlas.
 */
export function paintedPreview(design: ModelDesign, texture: Rgba | null = null): Preview | null {
  if (!texture && !usesPaint(design)) return null
  try {
    const painted = paintModel(design)
    return { geometry: layout(design, painted.size, painted.islands), textureDataUrl: dataUrl(texture ?? painted) }
  } catch {
    return null
  }
}

type GlowPreview = { picture: Rgba | "emissive"; level: number }

/** Settled appearance of a stance. Use the same atlas as the base preview before adding the selected light layers. */
export function layeredModelPreview(design: ModelDesign, texture: Rgba | null, glows: readonly GlowPreview[]): Preview | null {
  if (!texture && !glows.length) return null
  try {
    const painted = paintModel(design)
    const matches = (image: Rgba | null) => image?.size === painted.size
    const pixels = new Uint8ClampedArray(matches(texture) ? texture!.pixels : painted.pixels)
    for (const glow of glows) {
      const mask = glow.picture === "emissive" ? painted.glow : matches(glow.picture) ? glow.picture.pixels : null
      if (!mask || glow.level <= 0) continue
      for (let index = 0; index < pixels.length; index += 4) {
        if (!mask[index + 3]) continue
        pixels[index] += mask[index]! * glow.level
        pixels[index + 1] += mask[index + 1]! * glow.level
        pixels[index + 2] += mask[index + 2]! * glow.level
      }
    }
    return { geometry: layout(design, painted.size, painted.islands), textureDataUrl: dataUrl({ size: painted.size, pixels }) }
  } catch {
    return null
  }
}

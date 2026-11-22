import { ModelShapeSchema } from "@minemods/studio-ai/contracts"
import { ANIMATION_TRACKS, bakedCounts, bakeFitted, channelTracks } from "@minemods/studio-ai/animation"
import { encodePng } from "./png"
import { MODEL_FACES, TEXTURE_SPACE_ERROR, geoCube, paintModel } from "@minemods/studio-ai/model-paint"
import { modelBounds } from "./model-bounds"
import { textureSizes } from "@minemods/studio-ai/budget"

export const modelFaces = MODEL_FACES

export function compileModel(input: unknown, identifier: string) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(identifier)) throw new Error("Invalid model identifier")
  // The shape alone is what compiles. Which motions a thing has to carry is its document's rule (a creature's model: three; an effect: the one it plays), checked where it is saved.
  const design = ModelShapeSchema.parse(input)
  // What the game's file cannot hold is refused here, in the words the look gave for it: a curve is cut to fit before it is refused (`bakeFitted`).
  const unfit = bakedCounts(design.animations).faults
  if (unfit.length) throw new Error(unfit.join(""))
  const bounds = modelBounds(design)
  const painted = paintModel(design)
  const width = painted.size
  const bones = design.bones.map((bone, boneIndex) => ({
    name: bone.name,
    ...(bone.parent === null ? {} : { parent: bone.parent }),
    pivot: bone.pivot,
    rotation: bone.rotation,
    // 第 1 步: a turned, inflated or mirrored cube is written with its pivot, rotation and inflate and its faces' places run backwards (`geoCube`).
    cubes: bone.cubes.map((cube, cubeIndex) => geoCube(cube, painted.islands.filter((island) => island.boneIndex === boneIndex && island.cubeIndex === cubeIndex))),
  }))
  return {
    design,
    bounds,
    geometry: {
      format_version: "1.12.0",
      "minecraft:geometry": [
        {
          description: {
            identifier: `geometry.${identifier}`,
            texture_width: width,
            texture_height: width,
            visible_bounds_width: Math.max(8, bounds.width * 2),
            visible_bounds_height: Math.max(8, (bounds.max[1] - bounds.min[1]) / 8),
            visible_bounds_offset: [0, (bounds.max[1] + bounds.min[1]) / 32, 0],
          },
          bones,
        },
      ],
    },
    animation: {
      format_version: "1.8.0",
      animations: Object.fromEntries(
        design.animations.map((animation) => [
          `animation.${identifier}.${animation.name}`,
          {
            loop: animation.loop,
            animation_length: animation.length,
            bones: Object.fromEntries(
              animation.channels.map((channel) => [
                channel.bone,
                // The animation contract as a GeckoLib file: one track per kind the clip carries, written in the
                // document's own axes (the file's), curves cut into straight pieces and held values ended with
                // pre/post, the only forms GeckoLib 4.8.3 plays as the contract means them. Exported keys have their own
                // limit (`BAKED_LIMITS`); the limit on written keys is the schema's and was applied above.
                Object.fromEntries(
                  ANIMATION_TRACKS.map((track) => [track, bakeFitted(channelTracks(channel)[track], animation.loop, track).keys] as const)
                    .filter((entry) => entry[1].length)
                    .map(([track, keys]) => [
                      track,
                      // Integer object keys are reordered by JSON.stringify; GeckoLib reads frame order as written.
                      Object.fromEntries(keys.map((key) => [Number.isInteger(key.time) ? `${key.time}.0` : String(key.time), key.pre ? { pre: key.pre, post: key.value } : key.value])),
                    ]),
                ),
              ]),
            ),
          },
        ]),
      ),
    },
    png: encodePng(painted.pixels, width, width),
    /** The texels a glow feature lit, as a picture the size of `png` and transparent elsewhere; null when nothing glows. */
    glow: painted.glow ? encodePng(painted.glow, width, width) : null,
  }
}

/** Fits AI-authored designs to the smallest supported atlas without changing compileModel defaults. */
export function fitModelAtlas(input: unknown, identifier: string) {
  const design = ModelShapeSchema.parse(input)
  // The sizes the model's own geometry tier allows (`budget.ts`): 64, 128, 256 for a model that names none, as before.
  const sizes = textureSizes(design.budget)
  const fit = (textureSize: (typeof sizes)[number]): ReturnType<typeof compileModel> => {
    try {
      return compileModel({ ...design, texture_size: textureSize }, identifier)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== TEXTURE_SPACE_ERROR) throw error
      const next = sizes[sizes.indexOf(textureSize) + 1]
      if (!next) throw error
      return fit(next)
    }
  }
  return fit(design.texture_size)
}

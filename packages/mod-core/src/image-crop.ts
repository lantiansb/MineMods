// No Node APIs: pixels in, pixels out, like `image-decode.ts` beside it.
import { fitWithin, type Rgba } from "./image-decode"

/**
 * One region of a reference picture, cut out and made big enough to read (`view_reference`): an outside AI that is shown a whole
 * 六视图 on one sheet sees each view a few hundred pixels wide, too small to count fingers or read a weapon, and asks for a part of it.
 *
 * `side`: the longest the answer is on its long side, the size an AI's eyes are given a picture at. `upscale`: how many times a small
 * region is blown up at most, so a region of a few pixels is not stretched into a blur filling the whole answer.
 */
export const CROP_LIMITS = { side: 1024, upscale: 8 } as const

/** Where to cut: from the left and the top, and how wide and high. `fraction` (the default) counts in parts of the picture's width and height, 0 to 1; `pixels` in its own pixels. */
export type CropRegion = { x: number; y: number; width: number; height: number; unit?: "pixels" | "fraction" }
/** A region in whole pixels of the original, its left and top edge included and its right and bottom edge not. */
export type PixelRect = { x: number; y: number; width: number; height: number }

/** A region that cannot be cut, in words for whoever asked for it. Nothing was made. */
export class CropRefusal extends Error {}

export const CROP_WORDS = {
  not_numbers: "region 的 x、y、width、height 都要是数字。",
  not_positive: "region 的 width 和 height 要大于 0。",
  outside: (width: number, height: number, unit: "pixels" | "fraction") =>
    `region 整个落在图外面，或者小得不到 1 个像素：这张图是 ${width}×${height} 像素，${unit === "fraction" ? "按比例给的 x、y 在 0 到 1 之间，width、height 是图宽、图高的几分之几" : "按像素给的 x 在 0 到 " + (width - 1) + "、y 在 0 到 " + (height - 1) + " 之间"}。`,
} as const

// A fraction times the picture's size lands a hair off a whole number (0.3 × 1000 is 300.00000000000006): it is read as that whole number, so a
// region given in fractions cuts the same pixels as the same region given in pixels.
const snap = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * The region in whole pixels of a picture of this size: every pixel it touches, clamped to the picture. Without a region, the whole picture.
 * Refused when the numbers are not numbers, when it has no width or height, or when nothing of it is left on the picture.
 */
export function cropRect(size: { width: number; height: number }, region?: CropRegion): PixelRect {
  if (!region) return { x: 0, y: 0, width: size.width, height: size.height }
  const unit = region.unit ?? "fraction"
  const numbers = [region.x, region.y, region.width, region.height]
  if (!numbers.every(Number.isFinite)) throw new CropRefusal(CROP_WORDS.not_numbers)
  if (!(region.width > 0 && region.height > 0)) throw new CropRefusal(CROP_WORDS.not_positive)
  const across = unit === "fraction" ? size.width : 1
  const down = unit === "fraction" ? size.height : 1
  const left = Math.max(0, Math.floor(snap(region.x * across)))
  const top = Math.max(0, Math.floor(snap(region.y * down)))
  const right = Math.min(size.width, Math.ceil(snap((region.x + region.width) * across)))
  const bottom = Math.min(size.height, Math.ceil(snap((region.y + region.height) * down)))
  if (right - left < 1 || bottom - top < 1) throw new CropRefusal(CROP_WORDS.outside(size.width, size.height, unit))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** The pixels of one rectangle of a picture, as a picture of its own. */
function cut(image: Rgba, rect: PixelRect): Rgba {
  const pixels = new Uint8Array(rect.width * rect.height * 4)
  for (let row = 0; row < rect.height; row++) {
    const from = ((rect.y + row) * image.width + rect.x) * 4
    pixels.set(image.pixels.subarray(from, from + rect.width * 4), row * rect.width * 4)
  }
  return { width: rect.width, height: rect.height, pixels }
}

/**
 * A picture made larger by bilinear interpolation, each new pixel read at its centre between the four old ones around it (the edges
 * held), in premultiplied colour so a see-through edge does not darken. Bilinear and not nearest: what is enlarged here is a drawing
 * (a 六视图, a person's picture), where blocky steps would read as detail that is not there. A pixel-art picture comes out soft;
 * it is read for its shapes, not its pixels.
 */
function enlarge(image: Rgba, width: number, height: number): Rgba {
  if (width === image.width && height === image.height) return image
  const pixels = new Uint8Array(width * height * 4)
  const scaleX = image.width / width
  const scaleY = image.height / height
  const source = image.pixels
  for (let y = 0; y < height; y++) {
    const along = Math.min(image.height - 1, Math.max(0, (y + 0.5) * scaleY - 0.5))
    const top = Math.floor(along)
    const bottom = Math.min(image.height - 1, top + 1)
    const down = along - top
    for (let x = 0; x < width; x++) {
      const across = Math.min(image.width - 1, Math.max(0, (x + 0.5) * scaleX - 0.5))
      const left = Math.floor(across)
      const right = Math.min(image.width - 1, left + 1)
      const over = across - left
      const corners = [
        [(top * image.width + left) * 4, (1 - over) * (1 - down)],
        [(top * image.width + right) * 4, over * (1 - down)],
        [(bottom * image.width + left) * 4, (1 - over) * down],
        [(bottom * image.width + right) * 4, over * down],
      ] as const
      let alpha = 0
      let red = 0
      let green = 0
      let blue = 0
      for (const [at, weight] of corners) {
        const opacity = source[at + 3]! * weight
        alpha += opacity
        red += source[at]! * opacity
        green += source[at + 1]! * opacity
        blue += source[at + 2]! * opacity
      }
      const out = (y * width + x) * 4
      if (alpha > 0) {
        pixels[out] = Math.round(red / alpha)
        pixels[out + 1] = Math.round(green / alpha)
        pixels[out + 2] = Math.round(blue / alpha)
      }
      pixels[out + 3] = Math.round(alpha)
    }
  }
  return { width, height, pixels }
}

/**
 * One region of a picture, cut out and scaled so its long side is exactly `min(CROP_LIMITS.side, CROP_LIMITS.upscale × its own long side)`:
 * a large region is shrunk by averaging (`fitWithin`), a small one enlarged bilinearly (`enlarge`). The short side keeps the region's
 * proportions, rounded, and is never less than one pixel. `rect` is the region in pixels of the original.
 */
export function cropAndScale(image: Rgba, region?: CropRegion): { rect: PixelRect; image: Rgba } {
  const rect = cropRect(image, region)
  const piece = rect.width === image.width && rect.height === image.height ? image : cut(image, rect)
  const long = Math.max(rect.width, rect.height)
  const side = Math.min(CROP_LIMITS.side, CROP_LIMITS.upscale * long)
  if (side <= long) return { rect, image: fitWithin(piece, side) }
  const scale = side / long
  const width = rect.width >= rect.height ? side : Math.max(1, Math.round(rect.width * scale))
  const height = rect.height >= rect.width ? side : Math.max(1, Math.round(rect.height * scale))
  return { rect, image: enlarge(piece, width, height) }
}

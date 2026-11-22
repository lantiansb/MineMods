// No Node APIs: pictures are read from bytes alone, like the three readers this chooses between.
import { decodeJpeg, JPEG_MAX_PIXELS, JpegUnreadable } from "./jpeg-decode"
import { decodeRgbaPng } from "./png-decode"
import { decodeWebp, WebpUnreadable } from "./webp-decode"

/**
 * Reading a picture an outside AI handed in (a concept picture, `save_concepts`) into raw pixels: PNG, JPEG or WebP,
 * told apart by their bytes and not by what a name or header claims. Studio has no image library to lean on (the app's
 * own window is the only other thing that can draw a JPEG or WebP, and it cannot be asked from here), so `png-decode.ts`,
 * `jpeg-decode.ts` and `webp-decode.ts` read the three formats themselves; this file is the one door to them.
 */

/** What kind of picture these bytes are, read from the bytes themselves: what a name or a header claims is not believed. */
export function pictureType(bytes: Uint8Array) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png" as const
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg" as const
  if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "webp" as const
  return null
}

/** A picture that cannot be read, in words for whoever handed it in. */
export class ImageUnreadable extends Error {}

export type Rgba = { width: number; height: number; /** Four bytes a pixel, red first, row by row from the top, not premultiplied. */ pixels: Uint8Array }

/**
 * The most pixels a picture may have to be read: 4096 on a square. An image tool writes 1024 to 2048 on a side; this is twice
 * the larger, and the most that decodes in about a second and fits in memory as planes (4096² × 4 bytes is 64 MB).
 */
export const IMAGE_MAX_SIDE = 4096
export const IMAGE_MAX_PIXELS = IMAGE_MAX_SIDE * IMAGE_MAX_SIDE

const tooLarge = (kind: string, width: number, height: number) => new ImageUnreadable(`这张 ${kind} 太大了（${width}×${height}），最多读 ${IMAGE_MAX_SIDE}×${IMAGE_MAX_SIDE} 像素。把它缩小一些再交（构想图一边 1024 像素就够了）。`)

export function decodeImage(bytes: Uint8Array): Rgba {
  const type = pictureType(bytes)
  if (!type) throw new ImageUnreadable("这不是 PNG、JPEG 或 WebP 图片。")
  try {
    if (type === "png") {
      // The header says how large it is before anything is inflated.
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (bytes.length >= 24) {
        const width = view.getUint32(16)
        const height = view.getUint32(20)
        if (width * height > IMAGE_MAX_PIXELS || width > IMAGE_MAX_SIDE || height > IMAGE_MAX_SIDE) throw tooLarge("PNG", width, height)
      }
      return decodeRgbaPng(bytes, { side: IMAGE_MAX_SIDE, sixteen: true })
    }
    const read = type === "jpg" ? decodeJpeg(bytes) : decodeWebp(bytes)
    if (read.width * read.height > Math.max(IMAGE_MAX_PIXELS, JPEG_MAX_PIXELS)) throw tooLarge(type === "jpg" ? "JPEG" : "WebP", read.width, read.height)
    return read
  } catch (error) {
    if (error instanceof ImageUnreadable) throw error
    if (error instanceof JpegUnreadable || error instanceof WebpUnreadable) throw new ImageUnreadable(error.message)
    // Anything else came from inside a reader meeting bytes it did not expect.
    throw new ImageUnreadable(type === "png" ? "这张 PNG 读不了：它可能是坏的，或者用了少见的格式（只读 8 位和 16 位的普通 PNG）。存成普通的 PNG 再交。" : `这张${type === "jpg" ? " JPEG" : " WebP"}读不了：它可能是坏的。存成普通的 PNG 再交。`)
  }
}

/**
 * The picture made no larger than `side` on its long side, by averaging the pixels that fall in each new one (so a thin line
 * stays a faint line and does not vanish), weighted by opacity so that the colour of a see-through edge is not dragged toward
 * whatever lay under it. A picture already small enough is returned as it is: nothing is ever stretched.
 */
export function fitWithin(image: Rgba, side: number): Rgba {
  const long = Math.max(image.width, image.height)
  if (long <= side) return image
  const scale = long / side
  const width = Math.max(1, Math.round(image.width / scale))
  const height = Math.max(1, Math.round(image.height / scale))
  const pixels = new Uint8Array(width * height * 4)
  const stepX = image.width / width
  const stepY = image.height / height
  for (let y = 0; y < height; y++) {
    const top = y * stepY
    const bottom = (y + 1) * stepY
    for (let x = 0; x < width; x++) {
      const left = x * stepX
      const right = (x + 1) * stepX
      let weight = 0
      let opacity = 0
      let red = 0
      let green = 0
      let blue = 0
      for (let row = Math.floor(top); row < Math.min(image.height, Math.ceil(bottom)); row++) {
        const rowWeight = Math.min(row + 1, bottom) - Math.max(row, top)
        for (let column = Math.floor(left); column < Math.min(image.width, Math.ceil(right)); column++) {
          const share = rowWeight * (Math.min(column + 1, right) - Math.max(column, left))
          const at = (row * image.width + column) * 4
          const alpha = image.pixels[at + 3]! * share
          red += image.pixels[at]! * alpha
          green += image.pixels[at + 1]! * alpha
          blue += image.pixels[at + 2]! * alpha
          opacity += alpha
          weight += share
        }
      }
      const out = (y * width + x) * 4
      if (opacity > 0) {
        pixels[out] = Math.round(red / opacity)
        pixels[out + 1] = Math.round(green / opacity)
        pixels[out + 2] = Math.round(blue / opacity)
      }
      pixels[out + 3] = Math.round(opacity / weight)
    }
  }
  return { width, height, pixels }
}

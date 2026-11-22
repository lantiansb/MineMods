import { expect, test } from "bun:test"
import { CROP_LIMITS, CROP_WORDS, CropRefusal, cropAndScale, cropRect } from "../src/image-crop"
import { decodeImage, type Rgba } from "../src/image-decode"
import { encodePng } from "../src/png"

/** A picture of four flat quadrants: red top left, green top right, blue bottom left, white bottom right. */
function quadrants(width: number, height: number): Rgba {
  const pixels = new Uint8Array(width * height * 4)
  const colours = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ] as const
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const colour = colours[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]!
      pixels.set([...colour, 255], (y * width + x) * 4)
    }
  return { width, height, pixels }
}
/** Every pixel's colour, once each, as `r,g,b,a`. */
const coloursOf = (image: Rgba) => new Set(Array.from({ length: image.width * image.height }, (_, at) => Array.from(image.pixels.subarray(at * 4, at * 4 + 4)).join(",")))

test("按比例和按像素给同一块区域，切出来的是同一块", () => {
  const size = { width: 1000, height: 700 }
  expect(cropRect(size, { x: 0.3, y: 0.1, width: 0.2, height: 0.5 })).toEqual({ x: 300, y: 70, width: 200, height: 350 })
  expect(cropRect(size, { x: 300, y: 70, width: 200, height: 350, unit: "pixels" })).toEqual({ x: 300, y: 70, width: 200, height: 350 })
  // The default unit is fraction; no region is the whole picture.
  expect(cropRect(size, { x: 0, y: 0, width: 1, height: 1 })).toEqual({ x: 0, y: 0, ...size })
  expect(cropRect(size)).toEqual({ x: 0, y: 0, ...size })
  const image = quadrants(64, 48)
  const byFraction = cropAndScale(image, { x: 0.25, y: 0.25, width: 0.5, height: 0.5, unit: "fraction" })
  const byPixels = cropAndScale(image, { x: 16, y: 12, width: 32, height: 24, unit: "pixels" })
  expect(byFraction.rect).toEqual(byPixels.rect)
  expect(Buffer.from(byFraction.image.pixels).equals(Buffer.from(byPixels.image.pixels))).toBe(true)
})

test("出来的图长边正好是 1024 和区域 8 倍里小的那个，从不超过 1024", () => {
  const big = quadrants(2048, 1536)
  const whole = cropAndScale(big)
  expect(whole.rect).toEqual({ x: 0, y: 0, width: 2048, height: 1536 })
  expect([whole.image.width, whole.image.height]).toEqual([1024, 768])
  // A small region is blown up eight times at most.
  const small = cropAndScale(big, { x: 10, y: 10, width: 40, height: 20, unit: "pixels" })
  expect([small.image.width, small.image.height]).toEqual([320, 160])
  // A middle one is made exactly 1024 on its long side, the short side in proportion.
  const middle = cropAndScale(big, { x: 0, y: 0, width: 300, height: 600, unit: "pixels" })
  expect([middle.image.width, middle.image.height]).toEqual([512, 1024])
  for (const region of [undefined, { x: 0, y: 0, width: 1, height: 0.001 }, { x: 0.5, y: 0.5, width: 0.0001, height: 0.0001 }]) {
    const made = cropAndScale(big, region)
    expect(Math.max(made.image.width, made.image.height)).toBeLessThanOrEqual(CROP_LIMITS.side)
    expect(Math.min(made.image.width, made.image.height)).toBeGreaterThanOrEqual(1)
    expect(made.image.pixels.length).toBe(made.image.width * made.image.height * 4)
  }
})

test("从一张 PNG 里切一个纯色的象限，出来的就是那个颜色", () => {
  const picture = decodeImage(encodePng(quadrants(200, 120).pixels, 200, 120))
  const blue = cropAndScale(picture, { x: 0, y: 0.5, width: 0.5, height: 0.5 })
  expect(blue.rect).toEqual({ x: 0, y: 60, width: 100, height: 60 })
  expect([blue.image.width, blue.image.height]).toEqual([800, 480])
  expect([...coloursOf(blue.image)]).toEqual(["0,0,255,255"])
  const white = cropAndScale(picture, { x: 150, y: 90, width: 50, height: 30, unit: "pixels" })
  expect([...coloursOf(white.image)]).toEqual(["255,255,255,255"])
  // Shrunk rather than enlarged: still the one colour.
  const large = decodeImage(encodePng(quadrants(2400, 1800).pixels, 2400, 1800))
  const green = cropAndScale(large, { x: 0.5, y: 0, width: 0.5, height: 0.5 })
  expect([green.image.width, green.image.height]).toEqual([1024, 768])
  expect([...coloursOf(green.image)]).toEqual(["0,255,0,255"])
})

test("超出图的部分截掉，整个在图外、没有大小或不是数字的区域被拒绝", () => {
  const size = { width: 100, height: 80 }
  expect(cropRect(size, { x: 0.9, y: -0.5, width: 0.5, height: 1 })).toEqual({ x: 90, y: 0, width: 10, height: 40 })
  expect(cropRect(size, { x: 90.5, y: 0, width: 100, height: 1.2, unit: "pixels" })).toEqual({ x: 90, y: 0, width: 10, height: 2 })
  const refused = (region: Parameters<typeof cropRect>[1]) => {
    try {
      cropRect(size, region)
    } catch (error) {
      expect(error).toBeInstanceOf(CropRefusal)
      return (error as Error).message
    }
    throw new Error("not refused")
  }
  expect(refused({ x: 1.2, y: 0, width: 0.5, height: 0.5 })).toBe(CROP_WORDS.outside(100, 80, "fraction"))
  expect(refused({ x: 100, y: 0, width: 5, height: 5, unit: "pixels" })).toBe(CROP_WORDS.outside(100, 80, "pixels"))
  expect(refused({ x: -10, y: 0, width: 5, height: 5, unit: "pixels" })).toBe(CROP_WORDS.outside(100, 80, "pixels"))
  expect(refused({ x: 0, y: 0, width: 0, height: 0.5 })).toBe(CROP_WORDS.not_positive)
  expect(refused({ x: 0, y: 0, width: -0.5, height: 0.5 })).toBe(CROP_WORDS.not_positive)
  expect(refused({ x: Number.NaN, y: 0, width: 0.5, height: 0.5 })).toBe(CROP_WORDS.not_numbers)
  expect(refused({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 0.5 })).toBe(CROP_WORDS.not_numbers)
})

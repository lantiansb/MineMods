import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { inflateSync } from "node:zlib"
import { SCRIPT_LIMITS } from "@minemods/studio-ai/script"
import { decodeImage, fitWithin, ImageUnreadable, pictureType, type Rgba } from "../src/image-decode"
import { conceptPictures, setConcepts } from "../src/making-references"
import { createProject } from "../src/project"
import { encodePng } from "../src/png"
import { runBlockDrawing, runDrawing } from "../src/script-run"
import { decodeRgbaPng } from "../src/png-decode"
import { PICTURE_FIXTURES } from "./fixtures/pictures"

const bytesOf = (text: string) => new Uint8Array(Buffer.from(text, "base64"))
const oracle = (name: keyof typeof PICTURE_FIXTURES) => new Uint8Array(inflateSync(Buffer.from(PICTURE_FIXTURES[name].rgba, "base64")))
const decoded = (name: keyof typeof PICTURE_FIXTURES) => decodeImage(bytesOf(PICTURE_FIXTURES[name].file))
/** How far apart two pictures are: the largest and the mean difference of any colour channel; the alpha is compared on its own. */
function difference(one: Uint8Array, other: Uint8Array) {
  let largest = 0
  let sum = 0
  let alpha = 0
  for (let index = 0; index < one.length; index++) {
    const gap = Math.abs(one[index]! - other[index]!)
    if (index % 4 === 3) alpha = Math.max(alpha, gap)
    else {
      largest = Math.max(largest, gap)
      sum += gap
    }
  }
  return { largest, mean: sum / ((one.length / 4) * 3), alpha }
}

// What each reader is held to is what Pillow (libpng, libjpeg-turbo, libwebp) made of the very same file.
test("PNG 读出来和 Pillow 一个像素不差：RGB、带透明、调色板、16 位", () => {
  for (const name of ["png_rgb", "png_rgba", "png_palette", "png_16bit"] as const) {
    const read = decoded(name)
    expect([read.width, read.height]).toEqual([PICTURE_FIXTURES[name].width, PICTURE_FIXTURES[name].height])
    expect(difference(read.pixels, oracle(name))).toEqual({ largest: 0, mean: 0, alpha: 0 })
  }
  // The transparent stripe of the one with alpha really is transparent.
  expect(decoded("png_rgba").pixels[3]).toBe(0)
})

test("JPEG：全采样、渐进、灰度几乎一样；色度减半的差在边缘上，平均很小", () => {
  for (const name of ["jpeg_444", "jpeg_progressive", "jpeg_gray"] as const) {
    const gap = difference(decoded(name).pixels, oracle(name))
    expect(gap.largest).toBeLessThanOrEqual(3)
    expect(gap.alpha).toBe(0)
  }
  // Chroma shared by 2×2 pixels is widened by copying here and by smoothing in libjpeg.
  // Brightness does not depend on it, so that agrees closely; the colour differs at the hard edges of this small, edge-heavy picture.
  const halved = difference(decoded("jpeg_420").pixels, oracle("jpeg_420"))
  expect(halved.mean).toBeLessThan(12)
  const grey = (pixels: Uint8Array) => Uint8Array.from({ length: pixels.length / 4 }, (_, at) => Math.round(0.299 * pixels[at * 4]! + 0.587 * pixels[at * 4 + 1]! + 0.114 * pixels[at * 4 + 2]!))
  const expected = grey(oracle("jpeg_420"))
  const brightness = grey(decoded("jpeg_420").pixels).reduce((sum, value, at) => sum + Math.abs(value - expected[at]!), 0) / (40 * 24)
  expect(brightness).toBeLessThan(2)
})

test("WebP：无损和有损（带不带透明）都和 libwebp 一个像素不差", () => {
  for (const name of ["webp_lossless", "webp_lossless_alpha", "webp_lossy", "webp_lossy_alpha"] as const) {
    const read = decoded(name)
    expect([read.width, read.height]).toEqual([PICTURE_FIXTURES[name].width, PICTURE_FIXTURES[name].height])
    expect(difference(read.pixels, oracle(name))).toEqual({ largest: 0, mean: 0, alpha: 0 })
  }
  expect(decoded("webp_lossy_alpha").pixels[3]).toBe(0)
})

test("认图靠内容；读不了的图说明白，坏的、截断的、乱的都只给 ImageUnreadable，不会别的错", () => {
  expect(pictureType(bytesOf(PICTURE_FIXTURES.png_rgb.file))).toBe("png")
  expect(pictureType(bytesOf(PICTURE_FIXTURES.jpeg_420.file))).toBe("jpg")
  expect(pictureType(bytesOf(PICTURE_FIXTURES.webp_lossy.file))).toBe("webp")
  expect(pictureType(new TextEncoder().encode("<svg/>"))).toBeNull()
  const refused = (bytes: Uint8Array) => {
    try {
      decodeImage(bytes)
      return null
    } catch (error) {
      if (error instanceof ImageUnreadable) return error.message
      throw error
    }
  }
  expect(refused(new TextEncoder().encode("#!/bin/sh"))).toMatch(/PNG、JPEG 或 WebP/)
  for (const name of ["png_rgba", "jpeg_420", "jpeg_progressive", "webp_lossless", "webp_lossy_alpha"] as const) {
    const whole = bytesOf(PICTURE_FIXTURES[name].file)
    for (const cut of [8, 20, Math.floor(whole.length / 2), whole.length - 3]) {
      // Cut short, a picture is either read as far as it goes or refused in words; it never throws anything else.
      const outcome = refused(whole.slice(0, cut))
      expect(outcome === null || outcome.length > 0).toBe(true)
    }
    // Damaged in the middle: the same.
    const damaged = whole.slice()
    for (let at = 12; at < damaged.length; at += 7) damaged[at] = (damaged[at]! * 31 + 17) & 255
    const outcome = refused(damaged)
    expect(outcome === null || outcome.length > 0).toBe(true)
  }
  // A picture whose header claims more pixels than the limit is refused before any of it is read.
  const header = encodePng(new Uint8Array(4), 1, 1).slice()
  new DataView(header.buffer, header.byteOffset).setUint32(16, 100_000)
  new DataView(header.buffer, header.byteOffset).setUint32(20, 100_000)
  expect(refused(header)).toMatch(/太大/)
})

const flat = (width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Rgba => {
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set(paint(x, y), (y * width + x) * 4)
  return { width, height, pixels }
}

test("fitWithin：只往小了缩，取每一格下面的平均，透明的不拖黑颜色", () => {
  const small = flat(10, 4, () => [1, 2, 3, 255])
  expect(fitWithin(small, 256)).toBe(small)
  const wide = fitWithin(flat(1000, 500, (x) => (x < 500 ? [255, 0, 0, 255] : [0, 0, 255, 255])), SCRIPT_LIMITS.trace)
  expect([wide.width, wide.height]).toEqual([256, 128])
  expect(Array.from(wide.pixels.slice(0, 4))).toEqual([255, 0, 0, 255])
  expect(Array.from(wide.pixels.slice((255) * 4, 256 * 4))).toEqual([0, 0, 255, 255])
  // Half opaque white and half transparent black in one cell: the cell is half transparent and still white, not grey.
  const mixed = fitWithin(flat(512, 512, (x) => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 0])), 256)
  expect(Array.from(mixed.pixels.slice(0, 4))).toEqual([255, 255, 255, 128])
})

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "trace-pictures-"))
  directories.push(root)
  const directory = path.join(root, "project")
  await createProject({ directory, name: "构想图", description: "" })
  return directory
}
const url = (type: string, bytes: Uint8Array) => `data:image/${type};base64,${Buffer.from(bytes).toString("base64")}`

test("conceptPictures：只给构想图，缩到上限以内，读不出来的带着原因列出来", async () => {
  const directory = await project()
  const big = flat(1024, 512, (x, y) => (x > 200 && x < 800 && y > 100 && y < 400 ? [200, 30, 30, 255] : [255, 255, 255, 255]))
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
  await setConcepts(directory, "thing", [
    { name: "正面", url: url("png", encodePng(big.pixels, big.width, big.height)) },
    { name: "侧面", url: url("webp", bytesOf(PICTURE_FIXTURES.webp_lossy.file)) },
    { name: "坏的", url: url("jpeg", fakeJpeg) },
  ])
  const made = await conceptPictures(directory, ["thing", null, "thing"])
  expect(made.map((picture) => picture.name)).toEqual(["正面", "侧面", "坏的"])
  const first = made[0]!
  if ("error" in first) throw new Error(first.error)
  // 1024×512 fits 256 on the long side; four bytes a pixel, base64 four characters to three bytes.
  expect([first.width, first.height]).toEqual([SCRIPT_LIMITS.trace, SCRIPT_LIMITS.trace / 2])
  expect(first.rgba.length).toBe(Math.ceil((first.width * first.height * 4) / 3) * 4)
  const second = made[1]!
  expect("error" in second ? second.error : [second.width, second.height]).toEqual([40, 24])
  expect("error" in made[2]! ? made[2]!.error : "").not.toBe("")
  // A person's own picture and a thing with none are not concepts.
  expect(await conceptPictures(directory, ["someone_else", undefined])).toEqual([])
  // Asked again, the same.
  expect(await conceptPictures(directory, ["thing"])).toEqual(made)
})

// A picture drawn here: a slanted bar of orange on white, as large as a concept picture usually is.
const bar = flat(300, 300, (x, y) => (Math.abs(x - y) < 30 && x > 20 && x < 280 ? [230, 120, 30, 255] : [255, 255, 255, 255]))
const barPictures = async () => {
  const directory = await project()
  await setConcepts(directory, "thing", [{ name: "斜条", url: url("png", encodePng(bar.pixels, bar.width, bar.height)) }])
  return conceptPictures(directory, ["thing"])
}

test("画图脚本里 api.trace 描出来的是一张普通的物品图：背景透明，形状对，进沙箱的是小图", async () => {
  const pictures = await barPictures()
  const ran = await runDrawing(`return api.trace("斜条", { outline: true, colors: 4 })`, { pictures })
  if (!ran.ok) throw new Error(ran.error)
  expect(ran.summary).toMatchObject({ kind: "picture", width: 16, height: 16 })
  expect(ran.summary.empty).toBeGreaterThan(100)
  expect(ran.notes.join("")).toContain("斜条")
  const png = decodeRgbaPng(Buffer.from(ran.texture.split(",")[1]!, "base64"))
  expect(png.pixels[3]).toBe(0)
  expect(png.pixels[(15 * 16 + 15) * 4 + 3]).toBe(0)
  // The bar runs from the top left to the bottom right: the middle of the picture is on it, the top right corner is not.
  expect(png.pixels[(8 * 16 + 8) * 4 + 3]).toBe(255)
  // The same script for a block is the same picture, drawn from the same cell grid.
  const block = await runBlockDrawing(`return api.trace("斜条", { background: "#ffffff", size: 16 })`, { pictures })
  expect(block.ok).toBe(true)
})

test("api.trace 没有构想图、名字不对、图读不出来的时候，说清楚怎么办", async () => {
  const none = await runDrawing(`return api.trace("正面")`)
  expect(none.ok ? "" : none.error).toContain("save_concepts")
  const wrong = await runDrawing(`return api.trace("背面")`, { pictures: await barPictures() })
  expect(wrong.ok ? "" : wrong.error).toContain("「斜条」")
  const broken = await runDrawing(`return api.trace("坏的")`, { pictures: [{ name: "坏的", error: "这张图是残的。" }] })
  expect(broken.ok ? "" : broken.error).toContain("这张图是残的。")
  // Several concepts and no name: the script is told which there are.
  const many = await runDrawing(`return api.trace()`, { pictures: [{ name: "甲", error: "x" }, { name: "乙", error: "y" }] })
  expect(many.ok ? "" : many.error).toContain("「甲」")
  // A script may list what it was given.
  const listed = await runDrawing(`api.note(JSON.stringify(api.concepts)); return api.canvas(4, 4, null)`, { pictures: await barPictures() })
  expect(listed.ok ? listed.notes[0] : "").toBe(JSON.stringify([{ name: "斜条", width: 256, height: 256 }]))
})

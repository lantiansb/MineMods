import { expect, test } from "bun:test"
import { deflateSync } from "node:zlib"
import { decodeRgbaPng } from "../src/png-decode"

const passes = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

function paeth(a: number, b: number, c: number) {
  const estimate = a + b - c
  const pa = Math.abs(estimate - a)
  const pb = Math.abs(estimate - b)
  const pc = Math.abs(estimate - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function chunk(type: string, bytes: Uint8Array) {
  const output = Buffer.alloc(bytes.length + 12)
  output.writeUInt32BE(bytes.length)
  output.write(type, 4, "ascii")
  output.set(bytes, 8)
  let crc = 0xffffffff
  output.subarray(4, bytes.length + 8).forEach((value) => {
    crc ^= value
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  })
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length + 8)
  return output
}

function adam7RgbaPng(width: number, height: number, pixels: Uint8Array, interlace = 1) {
  const scanlines: number[] = []
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = startX >= width ? 0 : Math.floor((width - 1 - startX!) / stepX!) + 1
    const passHeight = startY >= height ? 0 : Math.floor((height - 1 - startY!) / stepY!) + 1
    let previous: number[] | undefined
    for (let row = 0; row < passHeight; row++) {
      const raw = Array.from({ length: passWidth * 4 }, (_, index) => {
        const x = startX! + (index >> 2) * stepX!
        const y = startY! + row * stepY!
        return pixels[(y * width + x) * 4 + (index & 3)]!
      })
      const filter = previous ? ((row - 1) % 4) + 1 : 0
      scanlines.push(
        filter,
        ...raw.map((value, index) => {
          const left = index >= 4 ? raw[index - 4]! : 0
          const up = previous?.[index] ?? 0
          const upperLeft = previous && index >= 4 ? previous[index - 4]! : 0
          const prediction =
            filter === 0
              ? 0
              : filter === 1
                ? left
                : filter === 2
                  ? up
                  : filter === 3
                    ? Math.floor((left + up) / 2)
                    : paeth(left, up, upperLeft)
          return (value - prediction + 256) & 255
        }),
      )
      previous = raw
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  header[12] = interlace
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Uint8Array.from(scanlines))),
    chunk("IEND", new Uint8Array()),
  ])
}

function adam7IndexedPng(width: number, height: number, indices: number[]) {
  const scanlines: number[] = []
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = startX >= width ? 0 : Math.floor((width - 1 - startX!) / stepX!) + 1
    const passHeight = startY >= height ? 0 : Math.floor((height - 1 - startY!) / stepY!) + 1
    for (let row = 0; row < passHeight; row++) {
      const packed = new Uint8Array(Math.ceil(passWidth / 8))
      for (let column = 0; column < passWidth; column++) {
        const index = indices[(startY! + row * stepY!) * width + startX! + column * stepX!]!
        packed[column >> 3] |= index << (7 - (column & 7))
      }
      scanlines.push(0, ...packed)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 1
  header[9] = 3
  header[12] = 1
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("PLTE", Uint8Array.from([240, 10, 20, 1, 30, 250])),
    chunk("tRNS", Uint8Array.from([255, 64])),
    chunk("IDAT", deflateSync(Uint8Array.from(scanlines))),
    chunk("IEND", new Uint8Array()),
  ])
}

test("decodes Adam7 RGBA pixels and resets Up filters at each pass", () => {
  const width = 9
  const height = 9
  const expected = Uint8Array.from({ length: width * height * 4 }, (_, index) => (index * 37 + 13) & 255)
  const result = decodeRgbaPng(adam7RgbaPng(width, height, expected))
  expect(result).toEqual({ width, height, pixels: expected })
})

test("rejects unsupported PNG interlace methods", () => {
  expect(() => decodeRgbaPng(adam7RgbaPng(1, 1, Uint8Array.from([1, 2, 3, 4]), 2))).toThrow("MODEL_PNG_UNSUPPORTED")
})

test("decodes packed palette samples across Adam7 pass boundaries", () => {
  const width = 9
  const height = 5
  const indices = Array.from({ length: width * height }, (_, index) => (index + Math.floor(index / width)) & 1)
  const expected = Uint8Array.from(indices.flatMap((index) => (index ? [1, 30, 250, 64] : [240, 10, 20, 255])))
  expect(decodeRgbaPng(adam7IndexedPng(width, height, indices)).pixels).toEqual(expected)
})

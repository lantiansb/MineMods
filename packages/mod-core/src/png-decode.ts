import { unzlibSync } from "fflate"

// No Node APIs: the acceptance standard reads item and block pictures with this in the app's window too.
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function fail(): never {
  throw new Error("MODEL_PNG_UNSUPPORTED")
}

function paeth(a: number, b: number, c: number) {
  const estimate = a + b - c
  const pa = Math.abs(estimate - a)
  const pb = Math.abs(estimate - b)
  const pc = Math.abs(estimate - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

const adam7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

/**
 * `side`: the longest side accepted. The default, 1024, is for the game's own textures; a concept picture an AI drew (`image-decode.ts`)
 * passes its own, larger one. `sixteen`: also read 16 bits to a sample (kept as the high byte), which image tools sometimes write and a texture never is.
 */
export function decodeRgbaPng(input: Uint8Array, limits: { side?: number; sixteen?: boolean } = {}) {
  const side = limits.side ?? 1024
  if (!SIGNATURE.every((value, index) => input[index] === value)) fail()
  let cursor = 8
  let width = 0
  let height = 0
  let depth = 0
  let colorType = 0
  let interlace = 0
  let palette = new Uint8Array()
  let transparency = new Uint8Array()
  let header = false
  let end = false
  let chunkCount = 0
  const compressed: Uint8Array[] = []
  while (cursor + 12 <= input.length) {
    const length = new DataView(input.buffer, input.byteOffset + cursor, 4).getUint32(0)
    const chunkEnd = cursor + length + 12
    if (chunkEnd > input.length) fail()
    const type = String.fromCharCode(...input.subarray(cursor + 4, cursor + 8))
    const data = input.subarray(cursor + 8, cursor + 8 + length)
    const expectedCrc = new DataView(input.buffer, input.byteOffset + cursor + 8 + length, 4).getUint32(0)
    let crc = 0xffffffff
    input.subarray(cursor + 4, cursor + 8 + length).forEach((value) => {
      crc ^= value
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    })
    if ((crc ^ 0xffffffff) >>> 0 !== expectedCrc) fail()
    chunkCount += 1
    if (end || (chunkCount !== 1 && !header)) fail()
    if (type === "IHDR") {
      if (header || length !== 13) fail()
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      width = view.getUint32(0)
      height = view.getUint32(4)
      depth = data[8]!
      colorType = data[9]!
      if (width < 1 || height < 1 || width > side || height > side) fail()
      if (
        ![0, 2, 3, 4, 6].includes(colorType) ||
        (depth !== 8 && !(colorType === 3 && [1, 2, 4].includes(depth)) && !(limits.sixteen && depth === 16 && colorType !== 3)) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12]! > 1
      )
        fail()
      interlace = data[12]!
      header = true
    }
    if (type === "PLTE") palette = new Uint8Array(data)
    if (type === "tRNS") transparency = new Uint8Array(data)
    if (type === "IDAT") compressed.push(data)
    if (type === "IEND") {
      if (length !== 0) fail()
      end = true
    }
    cursor = chunkEnd
  }
  if (!header || !end || cursor !== input.length || !compressed.length) fail()
  if (colorType === 3 && (!palette.length || palette.length % 3 || palette.length > 768)) fail()
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4
  const bitsPerPixel = channels * depth
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8))
  const passes = interlace ? adam7 : [[0, 0, 1, 1]]
  const passSizes = passes.map(([startX, startY, stepX, stepY]) => ({
    startX: startX!,
    startY: startY!,
    stepX: stepX!,
    stepY: stepY!,
    width: startX! >= width ? 0 : Math.floor((width - 1 - startX!) / stepX!) + 1,
    height: startY! >= height ? 0 : Math.floor((height - 1 - startY!) / stepY!) + 1,
  }))
  const expectedLength = passSizes.reduce(
    (sum, pass) => sum + pass.height * (Math.ceil((pass.width * bitsPerPixel) / 8) + 1),
    0,
  )
  if (!expectedLength) fail()
  const packed = new Uint8Array(compressed.reduce((sum, chunk) => sum + chunk.length, 0))
  compressed.reduce((offset, chunk) => (packed.set(chunk, offset), offset + chunk.length), 0)
  // One byte of room past what the header promises: data that inflates to more is refused, never grown into.
  const scanlines = unzlibSync(packed, { out: new Uint8Array(expectedLength + 1) })
  if (scanlines.length !== expectedLength) fail()
  const pixels = new Uint8Array(width * height * 4)
  // A 16-bit sample is read as its high byte, so it is an 8-bit one from here on.
  const maximum = depth === 16 ? 255 : (1 << depth) - 1
  let scanlineOffset = 0
  for (const pass of passSizes) {
    if (!pass.width || !pass.height) continue
    const stride = Math.ceil((pass.width * bitsPerPixel) / 8)
    let prior: Uint8Array | undefined
    for (let row = 0; row < pass.height; row++) {
      const filter = scanlines[scanlineOffset++]!
      if (filter > 4) fail()
      const source = scanlines.subarray(scanlineOffset, scanlineOffset + stride)
      scanlineOffset += stride
      const output = new Uint8Array(stride)
      for (let index = 0; index < stride; index++) {
        const left = index >= bytesPerPixel ? output[index - bytesPerPixel]! : 0
        const up = prior?.[index] ?? 0
        const upperLeft = prior && index >= bytesPerPixel ? prior[index - bytesPerPixel]! : 0
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
        output[index] = (source[index]! + prediction) & 255
      }
      prior = output
      for (let column = 0; column < pass.width; column++) {
        const sample = (channel: number) => {
          if (depth === 8) return output[column * channels + channel]!
          if (depth === 16) return output[(column * channels + channel) * 2]!
          const bit = column * depth
          return (output[Math.floor(bit / 8)]! >> (8 - depth - (bit % 8))) & maximum
        }
        const target = ((pass.startY + row * pass.stepY) * width + pass.startX + column * pass.stepX) * 4
        if (colorType === 3) {
          const index = sample(0)
          const paletteOffset = index * 3
          if (paletteOffset + 2 >= palette.length) fail()
          pixels[target] = palette[paletteOffset]!
          pixels[target + 1] = palette[paletteOffset + 1]!
          pixels[target + 2] = palette[paletteOffset + 2]!
          pixels[target + 3] = transparency[index] ?? 255
          continue
        }
        const gray = sample(0)
        pixels[target] = colorType === 0 || colorType === 4 ? Math.round((gray * 255) / maximum) : sample(0)
        pixels[target + 1] = colorType === 0 || colorType === 4 ? pixels[target]! : sample(1)
        pixels[target + 2] = colorType === 0 || colorType === 4 ? pixels[target]! : sample(2)
        pixels[target + 3] = colorType === 4 ? sample(1) : colorType === 6 ? sample(3) : 255
        if (colorType === 0 && depth !== 16 && transparency.length >= 2 && gray === transparency[1]) pixels[target + 3] = 0
        if (
          colorType === 2 &&
          depth !== 16 &&
          transparency.length >= 6 &&
          sample(0) === transparency[1] &&
          sample(1) === transparency[3] &&
          sample(2) === transparency[5]
        )
          pixels[target + 3] = 0
      }
    }
  }
  if (scanlineOffset !== scanlines.length) fail()
  return { width, height, pixels }
}

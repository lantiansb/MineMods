// No Node APIs: like the PNG reader, this only reads bytes.
import { NEIGHBOUR_OFFSETS } from "./webp-tables"
import { decodeVp8, vp8ToRgba, WEBP_MAX_PIXELS, WebpUnreadable } from "./webp-lossy"

export { WEBP_MAX_PIXELS, WebpUnreadable }

/**
 * A WebP reader for the concept pictures an outside AI hands in: still images, lossy (VP8, `webp-lossy.ts`, with or without
 * the separate alpha chunk) or lossless (VP8L, RFC 9649, below). Animated files are refused in words.
 */

const refuse = (why: string): never => {
  throw new WebpUnreadable(why)
}

export type DecodedWebp = { width: number; height: number; pixels: Uint8Array }

/** Whether these bytes start like a WebP file. */
export const isWebp = (bytes: Uint8Array) => bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"

export function decodeWebp(input: Uint8Array): DecodedWebp {
  if (!isWebp(input)) refuse("这不是 WebP 文件。")
  const four = (at: number) => String.fromCharCode(input[at]!, input[at + 1]!, input[at + 2]!, input[at + 3]!)
  const long = (at: number) => (input[at]! | (input[at + 1]! << 8) | (input[at + 2]! << 16) | (input[at + 3]! << 24)) >>> 0
  const chunks: { name: string; start: number; end: number }[] = []
  for (let at = 12; at + 8 <= input.length; ) {
    const size = long(at + 4)
    const start = at + 8
    // A last chunk cut short is still read as far as it goes.
    chunks.push({ name: four(at), start, end: Math.min(input.length, start + size) })
    at = start + size + (size & 1)
  }
  const find = (name: string) => chunks.find((chunk) => chunk.name === name)
  const extended = find("VP8X")
  if (find("ANIM") || find("ANMF") || (extended && input[extended.start]! & 2)) refuse("这是一张会动的 WebP，读不了：存成一张静止的 PNG 再交。")
  const lossy = find("VP8 ")
  const lossless = find("VP8L")
  if (lossless) {
    const image = decodeLossless(input, lossless.start, lossless.end)
    return { width: image.width, height: image.height, pixels: image.pixels }
  }
  if (!lossy) return refuse("这张 WebP 里没有图像数据。")
  const frame = decodeVp8(input, lossy.start, lossy.end)
  const pixels = vp8ToRgba(frame)
  const alpha = find("ALPH")
  if (alpha) {
    const plane = decodeAlphaPlane(input, alpha.start, alpha.end, frame.width, frame.height)
    for (let index = 0; index < plane.length; index++) pixels[index * 4 + 3] = plane[index]!
  }
  return { width: frame.width, height: frame.height, pixels }
}

// ---- the alpha chunk of a lossy file

function decodeAlphaPlane(data: Uint8Array, start: number, end: number, width: number, height: number) {
  if (end - start < 2) refuse("这张 WebP 的透明度部分不完整。")
  const flags = data[start]!
  const method = flags & 3
  const filter = (flags >> 2) & 3
  let plane: Uint8Array
  if (method === 0) {
    if (end - start - 1 < width * height) refuse("这张 WebP 的透明度部分不完整。")
    plane = data.slice(start + 1, start + 1 + width * height)
  } else if (method === 1) {
    // Lossless: a VP8L image stream with no header and the picture's own size; the transparency is its green channel.
    const bits = new BitReader(data, start + 1, end)
    const transforms: Transform[] = []
    const argb = undoTransforms(transforms, decodeImageStream(bits, width, height, true, transforms), height)
    plane = Uint8Array.from(argb, (value) => (value >>> 8) & 255)
  } else return refuse("这张 WebP 的透明度压缩方式读不了。")
  // Undo the prediction the encoder applied to the plane (the WebP container spec, "Alpha"): the first pixel is as it is, the top row follows the pixel to its left, the left column the one above.
  if (filter !== 0) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = y * width + x
        let predicted = 0
        if (x === 0 && y === 0) predicted = 0
        else if (y === 0) predicted = plane[at - 1]!
        else if (x === 0) predicted = plane[at - width]!
        else if (filter === 1) predicted = plane[at - 1]!
        else if (filter === 2) predicted = plane[at - width]!
        else predicted = Math.max(0, Math.min(255, plane[at - 1]! + plane[at - width]! - plane[at - width - 1]!))
        plane[at] = (plane[at]! + predicted) & 255
      }
  }
  return plane
}

// ---- lossless (VP8L)

/** Bits are read from the low end of each byte first. */
class BitReader {
  buffer = 0
  count = 0
  /** Zero bytes fed in after the data ended: reading into them means the file is cut short. */
  zeros = 0
  constructor(
    readonly data: Uint8Array,
    public position: number,
    readonly end: number,
  ) {}
  get past() {
    return this.count < this.zeros * 8
  }
  fill() {
    while (this.count <= 24) {
      if (this.position >= this.end) this.zeros++
      else this.buffer |= this.data[this.position++]! << this.count
      this.count += 8
    }
  }
  read(length: number) {
    if (length === 0) return 0
    if (this.count < length) this.fill()
    const value = this.buffer & ((1 << length) - 1)
    this.buffer >>>= length
    this.count -= length
    return value
  }
}

/** A canonical prefix code (the same kind DEFLATE uses): codes of one length are in order of their symbols, shorter codes first. */
class PrefixCode {
  single = -1
  fast = new Int32Array(0)
  fastBits = 0
  counts = new Int32Array(16)
  symbols: Int32Array
  constructor(lengths: Uint8Array | number[], size: number) {
    for (let symbol = 0; symbol < size; symbol++) this.counts[lengths[symbol]!] = this.counts[lengths[symbol]!]! + 1
    const used = size - this.counts[0]!
    if (used === 0) refuse("这张 WebP 里有空的编码表。")
    this.symbols = new Int32Array(used)
    if (used === 1) {
      // A code with a single symbol is no bits at all.
      for (let symbol = 0; symbol < size; symbol++) if (lengths[symbol]) this.single = symbol
      return
    }
    // The code must be complete: every bit string leads to a symbol.
    let space = 1
    for (let length = 1; length <= 15; length++) {
      space = (space << 1) - this.counts[length]!
      if (space < 0) refuse("这张 WebP 的编码表是坏的。")
    }
    if (space !== 0) refuse("这张 WebP 的编码表是坏的。")
    const offsets = new Int32Array(17)
    for (let length = 1; length < 16; length++) offsets[length + 1] = offsets[length]! + this.counts[length]!
    const next = new Int32Array(17)
    let code = 0
    for (let length = 1; length <= 15; length++) {
      next[length] = code
      code = (code + this.counts[length]!) << 1
    }
    let longest = 1
    for (let length = 1; length <= 15; length++) if (this.counts[length]) longest = length
    this.fastBits = Math.min(longest, 9)
    this.fast = new Int32Array(1 << this.fastBits)
    for (let symbol = 0; symbol < size; symbol++) {
      const length = lengths[symbol]!
      if (!length) continue
      this.symbols[offsets[length]!] = symbol
      offsets[length] = offsets[length]! + 1
      const canonical = next[length]!
      next[length] = canonical + 1
      if (length <= this.fastBits) {
        // The stream gives the code's first bit first, so the table is keyed by the code reversed.
        let reversed = 0
        for (let bit = 0; bit < length; bit++) reversed |= ((canonical >> bit) & 1) << (length - 1 - bit)
        for (let fill = reversed; fill < 1 << this.fastBits; fill += 1 << length) this.fast[fill] = (length << 16) | symbol
      }
    }
  }
  read(bits: BitReader) {
    if (this.single >= 0) return this.single
    if (bits.count < 16) bits.fill()
    const entry = this.fast[bits.buffer & ((1 << this.fastBits) - 1)]!
    if (entry) {
      const length = entry >> 16
      bits.buffer >>>= length
      bits.count -= length
      return entry & 0xffff
    }
    let code = 0
    let first = 0
    let index = 0
    let window = bits.buffer
    for (let length = 1; length <= 15; length++) {
      code |= window & 1
      window >>>= 1
      const count = this.counts[length]!
      if (code - count < first) {
        bits.buffer >>>= length
        bits.count -= length
        return this.symbols[index + (code - first)]!
      }
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    return refuse("这张 WebP 里有读不懂的编码。")
  }
}

const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
const subSample = (size: number, bits: number) => (size + (1 << bits) - 1) >> bits

function readPrefixCode(bits: BitReader, size: number) {
  const lengths = new Uint8Array(size)
  if (bits.read(1)) {
    // A simple code: one or two symbols, said outright.
    const symbols = bits.read(1) + 1
    const wide = bits.read(1)
    const first = bits.read(wide ? 8 : 1)
    if (first >= size) refuse("这张 WebP 的编码表是坏的。")
    lengths[first] = 1
    if (symbols === 2) {
      const second = bits.read(8)
      if (second >= size) refuse("这张 WebP 的编码表是坏的。")
      lengths[second] = 1
    }
    // Two symbols the same would be one: a code of a single symbol.
    return new PrefixCode(lengths, size)
  }
  const lengthCodeLengths = new Uint8Array(19)
  const wanted = 4 + bits.read(4)
  if (wanted > 19) refuse("这张 WebP 的编码表是坏的。")
  for (let index = 0; index < wanted; index++) lengthCodeLengths[CODE_LENGTH_ORDER[index]!] = bits.read(3)
  const lengthCode = new PrefixCode(lengthCodeLengths, 19)
  let limit = size
  if (bits.read(1)) {
    const lengthBits = 2 + 2 * bits.read(3)
    limit = 2 + bits.read(lengthBits)
    if (limit > size) refuse("这张 WebP 的编码表是坏的。")
  }
  let previous = 8
  for (let symbol = 0; symbol < size && limit-- > 0; ) {
    const length = lengthCode.read(bits)
    if (length < 16) {
      lengths[symbol++] = length
      if (length !== 0) previous = length
    } else {
      const extra = length === 16 ? 2 : length === 17 ? 3 : 7
      const repeat = bits.read(extra) + (length === 18 ? 11 : 3)
      if (symbol + repeat > size) refuse("这张 WebP 的编码表是坏的。")
      const value = length === 16 ? previous : 0
      for (let step = 0; step < repeat; step++) lengths[symbol++] = value
    }
  }
  return new PrefixCode(lengths, size)
}

/** Distance and length prefixes: a symbol is a small number outright, or a bit count and then that many more bits. */
function prefixValue(bits: BitReader, symbol: number) {
  if (symbol < 4) return symbol + 1
  const extra = (symbol - 2) >> 1
  const offset = (2 + (symbol & 1)) << extra
  return offset + bits.read(extra) + 1
}

type Transform = { kind: number; width: number; bits: number; data: Uint32Array | null }

/** An image stream: transforms (for the picture itself only), then prefix codes and the pixels they spell. Returns the pixels as ARGB; they are still transformed. */
function decodeImageStream(bits: BitReader, width: number, height: number, topLevel: boolean, transforms: Transform[] = []) {
  let codedWidth = width
  if (topLevel) {
    const seen = new Set<number>()
    while (bits.read(1)) {
      const kind = bits.read(2)
      if (seen.has(kind)) refuse("这张 WebP 把同一种变换用了两次。")
      seen.add(kind)
      const transform: Transform = { kind, width: codedWidth, bits: 0, data: null }
      if (kind === 0 || kind === 1) {
        transform.bits = bits.read(3) + 2
        transform.data = decodeImageStream(bits, subSample(codedWidth, transform.bits), subSample(height, transform.bits), false)
      } else if (kind === 3) {
        const colours = bits.read(8) + 1
        transform.bits = colours > 16 ? 0 : colours > 4 ? 1 : colours > 2 ? 2 : 3
        const table = decodeImageStream(bits, colours, 1, false)
        // The palette is stored as differences from the colour before it.
        const full = new Uint32Array(1 << (8 >> transform.bits))
        let previous = 0
        for (let index = 0; index < colours; index++) {
          const value = table[index]!
          const sum = ((((previous & 0xff00ff00) + (value & 0xff00ff00)) & 0xff00ff00) | (((previous & 0x00ff00ff) + (value & 0x00ff00ff)) & 0x00ff00ff)) >>> 0
          full[index] = sum
          previous = sum
        }
        transform.data = full
        codedWidth = subSample(codedWidth, transform.bits)
      }
      transforms.push(transform)
    }
  }
  let cacheBits = 0
  if (bits.read(1)) {
    cacheBits = bits.read(4)
    if (cacheBits < 1 || cacheBits > 11) refuse("这张 WebP 的颜色缓存大小不对。")
  }
  let groupBits = 0
  let groupImage: Uint32Array | null = null
  let groupCount = 1
  if (topLevel && bits.read(1)) {
    groupBits = bits.read(3) + 2
    groupImage = decodeImageStream(bits, subSample(codedWidth, groupBits), subSample(height, groupBits), false)
    for (const value of groupImage) groupCount = Math.max(groupCount, ((value >>> 8) & 0xffff) + 1)
  }
  const cacheSize = cacheBits ? 1 << cacheBits : 0
  const sizes = [256 + 24 + cacheSize, 256, 256, 256, 40]
  // Every group's codes are in the stream, but only the groups the picture actually points at are kept: a file can name tens of thousands of them.
  const wanted = new Set<number>(groupImage ? Array.from(groupImage, (value) => (value >>> 8) & 0xffff) : [0])
  const groups: PrefixCode[][] = []
  for (let group = 0; group < groupCount; group++) {
    const codes = sizes.map((size) => readPrefixCode(bits, size))
    if (wanted.has(group)) groups[group] = codes
  }
  if (bits.past) refuse("这张 WebP 不完整。")

  const total = codedWidth * height
  const pixels = new Uint32Array(total)
  const cache = cacheBits ? new Uint32Array(cacheSize) : null
  const remember = (from: number, to: number) => {
    for (let at = from; at < to; at++) cache![Math.imul(pixels[at]!, 0x1e35a7bd) >>> (32 - cacheBits)] = pixels[at]!
  }
  const groupAt = (x: number, y: number) => (groupImage ? groups[(groupImage[(y >> groupBits) * subSample(codedWidth, groupBits) + (x >> groupBits)]! >>> 8) & 0xffff]! : groups[0]!)
  let at = 0
  let cached = 0
  while (at < total) {
    const x = at % codedWidth
    const y = (at - x) / codedWidth
    const group = groupAt(x, y)
    const symbol = group[0]!.read(bits)
    if (symbol < 256) {
      const r = group[1]!.read(bits)
      const b = group[2]!.read(bits)
      const a = group[3]!.read(bits)
      pixels[at++] = ((a << 24) | (r << 16) | (symbol << 8) | b) >>> 0
    } else if (symbol < 280) {
      const length = prefixValue(bits, symbol - 256)
      const code = prefixValue(bits, group[4]!.read(bits))
      let back = code
      if (code <= 120) {
        const packed = NEIGHBOUR_OFFSETS[code - 1]!
        back = (packed >> 4) * codedWidth + (8 - (packed & 15))
        if (back < 1) back = 1
      } else back = code - 120
      if (back > at || at + length > total) refuse("这张 WebP 的重复引用越界了。")
      for (let step = 0; step < length; step++, at++) pixels[at] = pixels[at - back]!
    } else {
      if (!cache) refuse("这张 WebP 用了不存在的颜色缓存。")
      if (cached < at) {
        remember(cached, at)
        cached = at
      }
      const found = symbol - 280
      if (found >= cacheSize) refuse("这张 WebP 的颜色缓存下标越界了。")
      pixels[at++] = cache![found]!
    }
    if (bits.past) refuse("这张 WebP 不完整。")
  }
  return pixels
}

const addPixels = (a: number, b: number) => ((((a & 0xff00ff00) + (b & 0xff00ff00)) & 0xff00ff00) | (((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff)) >>> 0
/** The average of two pixels, each channel on its own. */
const average2 = (a: number, b: number) => (((((a ^ b) & 0xfefefefe) >>> 1) + (a & b)) >>> 0)
const channel = (value: number, shift: number) => (value >>> shift) & 255
const clamp255 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value)

function select(left: number, top: number, topLeft: number) {
  let toLeft = 0
  let toTop = 0
  for (const shift of [24, 16, 8, 0]) {
    const estimate = channel(left, shift) + channel(top, shift) - channel(topLeft, shift)
    toLeft += Math.abs(estimate - channel(left, shift))
    toTop += Math.abs(estimate - channel(top, shift))
  }
  return toLeft < toTop ? left : top
}
function clampAddSubtractFull(a: number, b: number, c: number) {
  let out = 0
  for (const shift of [24, 16, 8, 0]) out |= clamp255(channel(a, shift) + channel(b, shift) - channel(c, shift)) << shift
  return out >>> 0
}
function clampAddSubtractHalf(a: number, b: number) {
  let out = 0
  for (const shift of [24, 16, 8, 0]) out |= clamp255(channel(a, shift) + Math.trunc((channel(a, shift) - channel(b, shift)) / 2)) << shift
  return out >>> 0
}
const predict = (mode: number, left: number, top: number, topRight: number, topLeft: number) => {
  switch (mode) {
    case 1:
      return left
    case 2:
      return top
    case 3:
      return topRight
    case 4:
      return topLeft
    case 5:
      return average2(average2(left, topRight), top)
    case 6:
      return average2(left, topLeft)
    case 7:
      return average2(left, top)
    case 8:
      return average2(topLeft, top)
    case 9:
      return average2(top, topRight)
    case 10:
      return average2(average2(left, topLeft), average2(top, topRight))
    case 11:
      return select(left, top, topLeft)
    case 12:
      return clampAddSubtractFull(left, top, topLeft)
    case 13:
      return clampAddSubtractHalf(average2(left, top), topLeft)
    default:
      return 0xff000000
  }
}

/** The transforms undone, last one first, giving the picture's own pixels as ARGB. */
function undoTransforms(transforms: Transform[], coded: Uint32Array, height: number) {
  let pixels = coded
  for (let index = transforms.length - 1; index >= 0; index--) {
    const { kind, width, bits, data } = transforms[index]!
    if (kind === 0) {
      const across = subSample(width, bits)
      pixels[0] = addPixels(pixels[0]!, 0xff000000)
      for (let x = 1; x < width; x++) pixels[x] = addPixels(pixels[x]!, pixels[x - 1]!)
      for (let y = 1; y < height; y++) {
        const row = y * width
        pixels[row] = addPixels(pixels[row]!, pixels[row - width]!)
        for (let x = 1; x < width; x++) {
          const mode = (data![(y >> bits) * across + (x >> bits)]! >>> 8) & 15
          const at = row + x
          // Past the right edge, "up and to the right" is the first pixel of this row, which is already restored.
          pixels[at] = addPixels(pixels[at]!, predict(mode, pixels[at - 1]!, pixels[at - width]!, pixels[at - width + 1]!, pixels[at - width - 1]!))
        }
      }
    } else if (kind === 1) {
      const across = subSample(width, bits)
      const delta = (factor: number, value: number) => ((factor << 24) >> 24) * ((value << 24) >> 24) >> 5
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const element = data![(y >> bits) * across + (x >> bits)]!
          const greenToRed = element & 255
          const greenToBlue = (element >>> 8) & 255
          const redToBlue = (element >>> 16) & 255
          const at = y * width + x
          const value = pixels[at]!
          const green = (value >>> 8) & 255
          const red = (((value >>> 16) & 255) + delta(greenToRed, green)) & 255
          const blue = ((value & 255) + delta(greenToBlue, green) + delta(redToBlue, red)) & 255
          pixels[at] = (((value & 0xff000000) | (red << 16) | (green << 8) | blue) >>> 0)
        }
    } else if (kind === 2) {
      for (let at = 0; at < pixels.length; at++) {
        const value = pixels[at]!
        const green = (value >>> 8) & 255
        pixels[at] = (((value & 0xff00ff00) | (((((value >>> 16) & 255) + green) & 255) << 16) | (((value & 255) + green) & 255)) >>> 0)
      }
    } else {
      // Colour indexing: the green channel holds one index, or several packed together.
      const perByte = bits === 0 ? 1 : 1 << bits
      const depth = 8 >> bits
      const mask = (1 << depth) - 1
      const packedWidth = subSample(width, bits)
      const out = new Uint32Array(width * height)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const packed = (pixels[y * packedWidth + (x >> bits)]! >>> 8) & 255
          const found = bits === 0 ? packed : (packed >> ((x & (perByte - 1)) * depth)) & mask
          out[y * width + x] = found < data!.length ? data![found]! : 0
        }
      pixels = out
    }
  }
  return pixels
}

function decodeLossless(data: Uint8Array, start: number, end: number): DecodedWebp {
  if (end - start < 5 || data[start] !== 0x2f) refuse("这张 WebP 的无损画面头是坏的。")
  const bits = new BitReader(data, start + 1, end)
  const width = bits.read(14) + 1
  const height = bits.read(14) + 1
  const hasAlpha = bits.read(1) === 1
  if (bits.read(3) !== 0) refuse("这张 WebP 的无损版本读不了。")
  if (width * height > WEBP_MAX_PIXELS) refuse(`这张 WebP 太大了（${width}×${height}），最多读 ${Math.sqrt(WEBP_MAX_PIXELS)}×${Math.sqrt(WEBP_MAX_PIXELS)} 像素。把它缩小一些再交。`)
  const transforms: Transform[] = []
  const coded = decodeImageStream(bits, width, height, true, transforms)
  const argb = undoTransforms(transforms, coded, height)
  const pixels = new Uint8Array(width * height * 4)
  for (let at = 0; at < width * height; at++) {
    const value = argb[at]!
    pixels[at * 4] = (value >>> 16) & 255
    pixels[at * 4 + 1] = (value >>> 8) & 255
    pixels[at * 4 + 2] = value & 255
    pixels[at * 4 + 3] = hasAlpha ? value >>> 24 : 255
  }
  return { width, height, pixels }
}

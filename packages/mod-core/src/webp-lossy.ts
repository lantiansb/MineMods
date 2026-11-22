// No Node APIs: like the PNG reader, this only reads bytes.
import { AC_STEP, COEFFICIENT_PROBABILITIES, COEFFICIENT_UPDATE_PROBABILITIES, DC_STEP, SUBBLOCK_MODE_PROBABILITIES } from "./webp-tables"

/**
 * The lossy half of WebP: one VP8 key frame (RFC 6386), decoded the way the RFC lays it out. The loop filter runs over
 * the finished frame, after every block has been predicted from its neighbours as they were before filtering; that is
 * what the format asks for, and why this reads the whole frame into planes first. Chroma is widened with the same
 * 9-3-3-1 smoothing libwebp uses by default, so the pixels come out the same as the ones other programs show.
 */

export class WebpUnreadable extends Error {}
const refuse = (why: string): never => {
  throw new WebpUnreadable(why)
}

/** Coefficient index (zig-zag order) → position in the 4×4 block as a raster. */
const ZIGZAG = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15]
/** The probability band of each coefficient index; the 17th is only read past the last coefficient. */
const BANDS = [0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0]
/** Extra-bit probabilities of the large-value categories 3 to 6, most significant bit first. */
const CATEGORY = [[173, 148, 140], [176, 155, 140, 135], [180, 157, 141, 134, 130], [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129]]

/** 4×4 sub-block modes, numbered as the probability table is: DC, TM, VE, HE, RD, VR, LD, VL, HD, HU. */
const B_DC = 0
const B_TM = 1
const B_VE = 2
const B_HE = 3
const B_RD = 4
const B_VR = 5
const B_LD = 6
const B_VL = 7
const B_HD = 8
const B_HU = 9
/** The tree that reads a sub-block mode (RFC 6386 section 11.2): a positive entry is the next node, a negative one a leaf, minus the mode. */
const SUBBLOCK_TREE = [-B_DC, 1, -B_TM, 2, -B_VE, 3, 4, 6, -B_HE, 5, -B_RD, -B_VR, -B_LD, 7, -B_VL, 8, -B_HD, -B_HU]
/** The whole-block modes share the numbers of the sub-block modes they stand for. */
const DC_PRED = B_DC
const TM_PRED = B_TM
const V_PRED = B_VE
const H_PRED = B_HE

/** Bool-decoder of RFC 6386 section 7. Reading past the end gives zeros, as a damaged file is better drawn than refused. */
class Booleans {
  value: number
  range = 255
  bits = 0
  constructor(
    readonly data: Uint8Array,
    public position: number,
    readonly end: number,
  ) {
    this.value = (this.next() << 8) | this.next()
  }
  next() {
    return this.position < this.end ? this.data[this.position++]! : 0
  }
  bit(probability: number) {
    const split = 1 + (((this.range - 1) * probability) >> 8)
    const scaled = split << 8
    let result = 0
    if (this.value >= scaled) {
      result = 1
      this.range -= split
      this.value -= scaled
    } else this.range = split
    while (this.range < 128) {
      this.value <<= 1
      this.range <<= 1
      if (++this.bits === 8) {
        this.bits = 0
        this.value |= this.next()
      }
    }
    return result
  }
  literal(length: number) {
    let value = 0
    for (let index = 0; index < length; index++) value = (value << 1) | this.bit(128)
    return value
  }
  /** A magnitude of `length` bits and then a sign bit. */
  signed(length: number) {
    const value = this.literal(length)
    return this.bit(128) ? -value : value
  }
}

const clip8 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value)
const clipTo = (value: number, high: number) => (value < 0 ? 0 : value > high ? high : value)

export type Vp8Frame = { width: number; height: number; y: Uint8Array; u: Uint8Array; v: Uint8Array; yStride: number; uvStride: number }

/** Most pixels a picture may have: the same bound as the JPEG reader (4096 on a square), for the same reason. */
export const WEBP_MAX_PIXELS = 4096 * 4096

/** Decode the VP8 key frame stored in `data[start, end)`. */
export function decodeVp8(data: Uint8Array, start: number, end: number): Vp8Frame {
  if (end - start < 10) refuse("这张 WebP 不完整。")
  const tag = data[start]! | (data[start + 1]! << 8) | (data[start + 2]! << 16)
  if (tag & 1) refuse("这张 WebP 不是一帧完整的图（只有关键帧能读）。")
  if (((tag >> 1) & 7) > 3) refuse("这张 WebP 的版本读不了。")
  const firstSize = tag >>> 5
  if (data[start + 3] !== 0x9d || data[start + 4] !== 0x01 || data[start + 5] !== 0x2a) refuse("这张 WebP 的画面头是坏的。")
  const width = (data[start + 6]! | (data[start + 7]! << 8)) & 0x3fff
  const height = (data[start + 8]! | (data[start + 9]! << 8)) & 0x3fff
  if (!width || !height) refuse("这张 WebP 的宽或高是 0。")
  if (width * height > WEBP_MAX_PIXELS) refuse(`这张 WebP 太大了（${width}×${height}），最多读 ${Math.sqrt(WEBP_MAX_PIXELS)}×${Math.sqrt(WEBP_MAX_PIXELS)} 像素。把它缩小一些再交。`)
  const partitionsAt = start + 10 + firstSize
  if (partitionsAt > end) refuse("这张 WebP 不完整。")
  const header = new Booleans(data, start + 10, partitionsAt)

  header.literal(1) // colour space
  header.literal(1) // clamping type: values are clamped here whatever it says
  // Segments (section 9.3).
  const segments = { on: header.literal(1) === 1, update: false, absolute: false, quantizer: [0, 0, 0, 0], strength: [0, 0, 0, 0], probability: [255, 255, 255] }
  if (segments.on) {
    segments.update = header.literal(1) === 1
    if (header.literal(1)) {
      segments.absolute = header.literal(1) === 1
      for (let index = 0; index < 4; index++) segments.quantizer[index] = header.literal(1) ? header.signed(7) : 0
      for (let index = 0; index < 4; index++) segments.strength[index] = header.literal(1) ? header.signed(6) : 0
    }
    if (segments.update) for (let index = 0; index < 3; index++) segments.probability[index] = header.literal(1) ? header.literal(8) : 255
  }
  // Loop filter (section 9.6).
  const simple = header.literal(1) === 1
  const level = header.literal(6)
  const sharpness = header.literal(3)
  const deltas = { on: header.literal(1) === 1, reference: [0, 0, 0, 0], mode: [0, 0, 0, 0] }
  if (deltas.on && header.literal(1)) {
    for (let index = 0; index < 4; index++) if (header.literal(1)) deltas.reference[index] = header.signed(6)
    for (let index = 0; index < 4; index++) if (header.literal(1)) deltas.mode[index] = header.signed(6)
  }
  const filterType = level === 0 ? 0 : simple ? 1 : 2
  // Token partitions (section 9.5).
  const partitionCount = 1 << header.literal(2)
  const tokens: Booleans[] = []
  {
    const sizes = partitionsAt
    let at = sizes + 3 * (partitionCount - 1)
    if (at > end) refuse("这张 WebP 不完整。")
    for (let index = 0; index < partitionCount; index++) {
      const declared = index < partitionCount - 1 ? data[sizes + index * 3]! | (data[sizes + index * 3 + 1]! << 8) | (data[sizes + index * 3 + 2]! << 16) : end - at
      const size = Math.min(declared, end - at)
      tokens.push(new Booleans(data, at, at + size))
      at += size
    }
  }
  // Quantisers (section 9.6): one set for each segment.
  const baseQuantiser = header.literal(7)
  const delta = () => (header.literal(1) ? header.signed(4) : 0)
  const y1DcDelta = delta()
  const y2DcDelta = delta()
  const y2AcDelta = delta()
  const uvDcDelta = delta()
  const uvAcDelta = delta()
  const quantisers = [0, 1, 2, 3].map((segment) => {
    const q = segments.on ? segments.quantizer[segment]! + (segments.absolute ? 0 : baseQuantiser) : baseQuantiser
    return {
      y1: [DC_STEP[clipTo(q + y1DcDelta, 127)]!, AC_STEP[clipTo(q, 127)]!],
      // For every step in the table, ×155/100 is the same as (×101581) >> 16, and never below 8.
      y2: [DC_STEP[clipTo(q + y2DcDelta, 127)]! * 2, Math.max(8, (AC_STEP[clipTo(q + y2AcDelta, 127)]! * 101581) >> 16)],
      uv: [DC_STEP[clipTo(q + uvDcDelta, 117)]!, AC_STEP[clipTo(q + uvAcDelta, 127)]!],
    }
  })
  header.literal(1) // refresh entropy probabilities: a still image has no next frame
  const probabilities = new Uint8Array(1056)
  for (let index = 0; index < 1056; index++) probabilities[index] = header.bit(COEFFICIENT_UPDATE_PROBABILITIES[index]!) ? header.literal(8) : COEFFICIENT_PROBABILITIES[index]!
  const useSkip = header.literal(1) === 1
  const skipProbability = useSkip ? header.literal(8) : 0

  // Loop filter strength for each segment and kind of block (section 9.6 / 15): [segment][is 4×4].
  const strengths = [0, 1, 2, 3].map((segment) =>
    [0, 1].map((fourByFour) => {
      let base = level
      if (segments.on) base = segments.strength[segment]! + (segments.absolute ? 0 : level)
      if (deltas.on) {
        base += deltas.reference[0]!
        if (fourByFour) base += deltas.mode[0]!
      }
      const filterLevel = clipTo(base, 63)
      if (filterLevel === 0) return { limit: 0, interior: 1, hev: 0 }
      let interior = filterLevel
      if (sharpness > 0) {
        interior >>= sharpness > 4 ? 2 : 1
        if (interior > 9 - sharpness) interior = 9 - sharpness
      }
      if (interior < 1) interior = 1
      return { limit: 2 * filterLevel + interior, interior, hev: filterLevel >= 40 ? 2 : filterLevel >= 15 ? 1 : 0 }
    }),
  )

  const mbWidth = (width + 15) >> 4
  const mbHeight = (height + 15) >> 4
  const yStride = mbWidth * 16
  const uvStride = mbWidth * 8
  const y = new Uint8Array(yStride * mbHeight * 16)
  const u = new Uint8Array(uvStride * mbHeight * 8)
  const v = new Uint8Array(uvStride * mbHeight * 8)
  const filters = new Int32Array(mbWidth * mbHeight * 4) // limit (0 = none), interior, hev threshold, inner edges

  // Prediction modes of the sub-blocks along the top and left edge of the block being read (section 11.3).
  const modesAbove = new Uint8Array(mbWidth * 4)
  const modesLeft = new Uint8Array(4)
  // "Has coefficients" flags, along the top and left: four luma, two of each chroma, and the second-order luma block.
  const nonzeroAbove = new Uint8Array(mbWidth * 9)
  const nonzeroLeft = new Uint8Array(9)
  const coefficients = new Int16Array(400)
  const modes = new Uint8Array(16)

  // Pixel of a plane as intra prediction sees it: a row above the picture is 127, a column left of it 129.
  const at = (plane: Uint8Array, stride: number, x: number, row: number) => (row < 0 ? 127 : x < 0 ? 129 : plane[row * stride + x]!)

  for (let mbY = 0; mbY < mbHeight; mbY++) {
    modesLeft.fill(B_DC)
    nonzeroLeft.fill(0)
    const part = tokens[mbY & (partitionCount - 1)]!
    for (let mbX = 0; mbX < mbWidth; mbX++) {
      // ---- the modes, from the first partition
      let segment = 0
      if (segments.update) segment = header.bit(segments.probability[0]!) ? 2 + header.bit(segments.probability[2]!) : header.bit(segments.probability[1]!)
      const skip = useSkip ? header.bit(skipProbability) : 0
      const fourByFour = !header.bit(145)
      let lumaMode = DC_PRED
      if (!fourByFour) {
        lumaMode = header.bit(156) ? (header.bit(128) ? TM_PRED : H_PRED) : header.bit(163) ? V_PRED : DC_PRED
        modesAbove.fill(lumaMode, mbX * 4, mbX * 4 + 4)
        modesLeft.fill(lumaMode)
      } else {
        for (let row = 0; row < 4; row++) {
          let left = modesLeft[row]!
          for (let column = 0; column < 4; column++) {
            const probabilityAt = (modesAbove[mbX * 4 + column]! * 10 + left) * 9
            let node = SUBBLOCK_TREE[header.bit(SUBBLOCK_MODE_PROBABILITIES[probabilityAt]!)]!
            while (node > 0) node = SUBBLOCK_TREE[2 * node + header.bit(SUBBLOCK_MODE_PROBABILITIES[probabilityAt + node]!)]!
            const mode = -node
            modesAbove[mbX * 4 + column] = mode
            modes[row * 4 + column] = mode
            left = mode
          }
          modesLeft[row] = left
        }
      }
      const chromaMode = !header.bit(142) ? DC_PRED : !header.bit(114) ? V_PRED : header.bit(183) ? TM_PRED : H_PRED

      // ---- the coefficients, from this row's token partition
      coefficients.fill(0)
      const quantiser = quantisers[segment]!
      const column = mbX * 9
      let anyCoefficient = false
      if (!skip) {
        let first = 0
        let type = 3
        if (!fourByFour) {
          const context = nonzeroAbove[column + 8]! + nonzeroLeft[8]!
          const used = readCoefficients(part, probabilities, 1, context, quantiser.y2[0]!, quantiser.y2[1]!, 0, coefficients, 384)
          nonzeroAbove[column + 8] = nonzeroLeft[8] = used > 0 ? 1 : 0
          walshHadamard(coefficients, 384)
          first = 1
          type = 0
        }
        for (let row = 0; row < 4; row++)
          for (let across = 0; across < 4; across++) {
            const context = nonzeroAbove[column + across]! + nonzeroLeft[row]!
            const used = readCoefficients(part, probabilities, type, context, quantiser.y1[0]!, quantiser.y1[1]!, first, coefficients, (row * 4 + across) * 16)
            nonzeroAbove[column + across] = nonzeroLeft[row] = used > first ? 1 : 0
            // A block counts for the loop filter when it has a coefficient past the first, or a first one (its own or the second-order block's) that is not zero.
            if (used > 1 || coefficients[(row * 4 + across) * 16] !== 0) anyCoefficient = true
          }
        for (let channel = 0; channel < 2; channel++)
          for (let row = 0; row < 2; row++)
            for (let across = 0; across < 2; across++) {
              const slot = 4 + channel * 2
              const context = nonzeroAbove[column + slot + across]! + nonzeroLeft[slot + row]!
              const used = readCoefficients(part, probabilities, 2, context, quantiser.uv[0]!, quantiser.uv[1]!, 0, coefficients, 256 + channel * 64 + (row * 2 + across) * 16)
              nonzeroAbove[column + slot + across] = nonzeroLeft[slot + row] = used > 0 ? 1 : 0
              if (used > 1 || coefficients[256 + channel * 64 + (row * 2 + across) * 16] !== 0) anyCoefficient = true
            }
      } else {
        nonzeroAbove.fill(0, column, column + 8)
        nonzeroLeft.fill(0, 0, 8)
        if (!fourByFour) nonzeroAbove[column + 8] = nonzeroLeft[8] = 0
      }
      const kind = strengths[segment]![fourByFour ? 1 : 0]!
      const filterAt = (mbY * mbWidth + mbX) * 4
      filters[filterAt] = kind.limit
      filters[filterAt + 1] = kind.interior
      filters[filterAt + 2] = kind.hev
      filters[filterAt + 3] = fourByFour || anyCoefficient ? 1 : 0

      // ---- the picture
      const x0 = mbX * 16
      const y0 = mbY * 16
      if (!fourByFour) {
        predictBlock(y, yStride, x0, y0, 16, lumaMode, mbX > 0, mbY > 0)
        for (let index = 0; index < 16; index++) addTransform(coefficients, index * 16, y, (y0 + (index >> 2) * 4) * yStride + x0 + (index & 3) * 4, yStride)
      } else {
        // The pixels just above and to the right of the block: from the block above and to the right, the last of its row repeating, and 127 above the picture.
        const aboveRight = [0, 1, 2, 3].map((index) => (mbY === 0 ? 127 : mbX < mbWidth - 1 ? y[(y0 - 1) * yStride + x0 + 16 + index]! : y[(y0 - 1) * yStride + x0 + 15]!))
        for (let index = 0; index < 16; index++) {
          const bx = x0 + (index & 3) * 4
          const by = y0 + (index >> 2) * 4
          // The pixels to the upper right of the right-most sub-blocks, on every row of them, are the whole block's own upper right.
          const top = Array.from({ length: 8 }, (_, step) => (step < 4 || (index & 3) < 3 ? at(y, yStride, bx + step, by - 1) : aboveRight[step - 4]!))
          predictSubBlock(y, yStride, bx, by, modes[index]!, top, [0, 1, 2, 3].map((step) => at(y, yStride, bx - 1, by + step)), at(y, yStride, bx - 1, by - 1))
          addTransform(coefficients, index * 16, y, by * yStride + bx, yStride)
        }
      }
      predictBlock(u, uvStride, mbX * 8, mbY * 8, 8, chromaMode, mbX > 0, mbY > 0)
      predictBlock(v, uvStride, mbX * 8, mbY * 8, 8, chromaMode, mbX > 0, mbY > 0)
      for (let index = 0; index < 4; index++) {
        const offset = (mbY * 8 + (index >> 1) * 4) * uvStride + mbX * 8 + (index & 1) * 4
        addTransform(coefficients, 256 + index * 16, u, offset, uvStride)
        addTransform(coefficients, 320 + index * 16, v, offset, uvStride)
      }
    }
  }

  if (filterType > 0) loopFilter(y, u, v, yStride, uvStride, mbWidth, mbHeight, filters, filterType)
  return { width, height, y, u, v, yStride, uvStride }
}

/** One block's coefficients into `out[offset…]` (dequantised, in raster order); returns the index after the last one read (RFC 6386 section 13). */
function readCoefficients(booleans: Booleans, probabilities: Uint8Array, type: number, context: number, dc: number, ac: number, first: number, out: Int16Array, offset: number) {
  let n = first
  let p = ((type * 8 + BANDS[n]!) * 3 + context) * 11
  while (n < 16) {
    if (!booleans.bit(probabilities[p]!)) return n
    while (!booleans.bit(probabilities[p + 1]!)) {
      n++
      p = ((type * 8 + BANDS[n]!) * 3) * 11
      if (n === 16) return 16
    }
    const next = (type * 8 + BANDS[n + 1]!) * 3
    let value: number
    if (!booleans.bit(probabilities[p + 2]!)) {
      value = 1
      p = (next + 1) * 11
    } else {
      value = largeValue(booleans, probabilities, p)
      p = (next + 2) * 11
    }
    out[offset + ZIGZAG[n]!] = (booleans.bit(128) ? -value : value) * (n > 0 ? ac : dc)
    n++
  }
  return 16
}

function largeValue(booleans: Booleans, probabilities: Uint8Array, p: number) {
  if (!booleans.bit(probabilities[p + 3]!)) {
    if (!booleans.bit(probabilities[p + 4]!)) return 2
    return 3 + booleans.bit(probabilities[p + 5]!)
  }
  if (!booleans.bit(probabilities[p + 6]!)) {
    if (!booleans.bit(probabilities[p + 7]!)) return 5 + booleans.bit(159)
    return 7 + 2 * booleans.bit(165) + booleans.bit(145)
  }
  const high = booleans.bit(probabilities[p + 8]!)
  const category = 2 * high + booleans.bit(probabilities[p + 9 + high]!)
  let value = 0
  for (const probability of CATEGORY[category]!) value += value + booleans.bit(probability)
  return value + 3 + (8 << category)
}

/** The inverse Walsh-Hadamard transform of the second-order block at `coefficients[at…]`: its 16 results become the DC of the 16 luma blocks. */
function walshHadamard(coefficients: Int16Array, at: number) {
  const tmp = new Int32Array(16)
  for (let i = 0; i < 4; i++) {
    const a0 = coefficients[at + i]! + coefficients[at + 12 + i]!
    const a1 = coefficients[at + 4 + i]! + coefficients[at + 8 + i]!
    const a2 = coefficients[at + 4 + i]! - coefficients[at + 8 + i]!
    const a3 = coefficients[at + i]! - coefficients[at + 12 + i]!
    tmp[i] = a0 + a1
    tmp[8 + i] = a0 - a1
    tmp[4 + i] = a3 + a2
    tmp[12 + i] = a3 - a2
  }
  for (let i = 0; i < 4; i++) {
    const dc = tmp[i * 4]! + 3
    const a0 = dc + tmp[3 + i * 4]!
    const a1 = tmp[1 + i * 4]! + tmp[2 + i * 4]!
    const a2 = tmp[1 + i * 4]! - tmp[2 + i * 4]!
    const a3 = dc - tmp[3 + i * 4]!
    coefficients[(i * 4) * 16] = (a0 + a1) >> 3
    coefficients[(i * 4 + 1) * 16] = (a3 + a2) >> 3
    coefficients[(i * 4 + 2) * 16] = (a0 - a1) >> 3
    coefficients[(i * 4 + 3) * 16] = (a3 - a2) >> 3
  }
}

const times1 = (value: number) => ((value * 20091) >> 16) + value
const times2 = (value: number) => (value * 35468) >> 16

/** The 4×4 inverse DCT of the coefficients at `from`, added to the predicted pixels already in `plane` (RFC 6386 section 14.3). */
function addTransform(coefficients: Int16Array, from: number, plane: Uint8Array, offset: number, stride: number) {
  let any = false
  for (let index = 0; index < 16 && !any; index++) any = coefficients[from + index] !== 0
  if (!any) return
  const tmp = new Int32Array(16)
  for (let i = 0; i < 4; i++) {
    const a = coefficients[from + i]! + coefficients[from + 8 + i]!
    const b = coefficients[from + i]! - coefficients[from + 8 + i]!
    const c = times2(coefficients[from + 4 + i]!) - times1(coefficients[from + 12 + i]!)
    const d = times1(coefficients[from + 4 + i]!) + times2(coefficients[from + 12 + i]!)
    tmp[i * 4] = a + d
    tmp[i * 4 + 1] = b + c
    tmp[i * 4 + 2] = b - c
    tmp[i * 4 + 3] = a - d
  }
  for (let i = 0; i < 4; i++) {
    const dc = tmp[i]! + 4
    const a = dc + tmp[8 + i]!
    const b = dc - tmp[8 + i]!
    const c = times2(tmp[4 + i]!) - times1(tmp[12 + i]!)
    const d = times1(tmp[4 + i]!) + times2(tmp[12 + i]!)
    const row = offset + i * stride
    plane[row] = clip8(plane[row]! + ((a + d) >> 3))
    plane[row + 1] = clip8(plane[row + 1]! + ((b + c) >> 3))
    plane[row + 2] = clip8(plane[row + 2]! + ((b - c) >> 3))
    plane[row + 3] = clip8(plane[row + 3]! + ((a - d) >> 3))
  }
}

/** Whole-block prediction, 16×16 luma or 8×8 chroma (RFC 6386 section 12.2). */
function predictBlock(plane: Uint8Array, stride: number, x0: number, y0: number, size: number, mode: number, hasLeft: boolean, hasTop: boolean) {
  const shift = size === 16 ? 4 : 3
  const top = (step: number) => (hasTop ? plane[(y0 - 1) * stride + x0 + step]! : 127)
  const left = (step: number) => (hasLeft ? plane[(y0 + step) * stride + x0 - 1]! : 129)
  const fill = (pixel: (x: number, row: number) => number) => {
    for (let row = 0; row < size; row++) for (let x = 0; x < size; x++) plane[(y0 + row) * stride + x0 + x] = pixel(x, row)
  }
  if (mode === DC_PRED) {
    let sum = 0
    let value = 128
    if (hasTop && hasLeft) {
      for (let step = 0; step < size; step++) sum += top(step) + left(step)
      value = (sum + size) >> (shift + 1)
    } else if (hasTop || hasLeft) {
      for (let step = 0; step < size; step++) sum += hasTop ? top(step) : left(step)
      value = (sum + (size >> 1)) >> shift
    }
    fill(() => value)
  } else if (mode === V_PRED) fill((x) => top(x))
  else if (mode === H_PRED) fill((_, row) => left(row))
  else {
    // TrueMotion: the corner is the pixel up and to the left, 127 above the picture and 129 left of it.
    const corner = !hasTop ? 127 : !hasLeft ? 129 : plane[(y0 - 1) * stride + x0 - 1]!
    fill((x, row) => clip8(left(row) + top(x) - corner))
  }
}

const avg3 = (a: number, b: number, c: number) => (a + 2 * b + c + 2) >> 2
const avg2 = (a: number, b: number) => (a + b + 1) >> 1

/** 4×4 sub-block prediction from the 8 pixels above (the last four are above and to the right), the 4 to the left and the corner (RFC 6386 section 12.3). */
function predictSubBlock(plane: Uint8Array, stride: number, bx: number, by: number, mode: number, top: number[], left: number[], corner: number) {
  const out = (x: number, row: number, value: number) => {
    plane[(by + row) * stride + bx + x] = value
  }
  const [A, B, C, D, E, F, G, H] = top as [number, number, number, number, number, number, number, number]
  const [I, J, K, L] = left as [number, number, number, number]
  const X = corner
  switch (mode) {
    case B_DC: {
      let sum = 4
      for (let step = 0; step < 4; step++) sum += top[step]! + left[step]!
      for (let row = 0; row < 4; row++) for (let x = 0; x < 4; x++) out(x, row, sum >> 3)
      break
    }
    case B_TM:
      for (let row = 0; row < 4; row++) for (let x = 0; x < 4; x++) out(x, row, clip8(left[row]! + top[x]! - X))
      break
    case B_VE: {
      const values = [avg3(X, A, B), avg3(A, B, C), avg3(B, C, D), avg3(C, D, E)]
      for (let row = 0; row < 4; row++) for (let x = 0; x < 4; x++) out(x, row, values[x]!)
      break
    }
    case B_HE: {
      const values = [avg3(X, I, J), avg3(I, J, K), avg3(J, K, L), avg3(K, L, L)]
      for (let row = 0; row < 4; row++) for (let x = 0; x < 4; x++) out(x, row, values[row]!)
      break
    }
    case B_RD:
      out(0, 3, avg3(J, K, L))
      out(1, 3, avg3(I, J, K)), out(0, 2, avg3(I, J, K))
      out(2, 3, avg3(X, I, J)), out(1, 2, avg3(X, I, J)), out(0, 1, avg3(X, I, J))
      out(3, 3, avg3(A, X, I)), out(2, 2, avg3(A, X, I)), out(1, 1, avg3(A, X, I)), out(0, 0, avg3(A, X, I))
      out(3, 2, avg3(B, A, X)), out(2, 1, avg3(B, A, X)), out(1, 0, avg3(B, A, X))
      out(3, 1, avg3(C, B, A)), out(2, 0, avg3(C, B, A))
      out(3, 0, avg3(D, C, B))
      break
    case B_VR:
      out(0, 0, avg2(X, A)), out(1, 2, avg2(X, A))
      out(1, 0, avg2(A, B)), out(2, 2, avg2(A, B))
      out(2, 0, avg2(B, C)), out(3, 2, avg2(B, C))
      out(3, 0, avg2(C, D))
      out(0, 3, avg3(K, J, I))
      out(0, 2, avg3(J, I, X))
      out(0, 1, avg3(I, X, A)), out(1, 3, avg3(I, X, A))
      out(1, 1, avg3(X, A, B)), out(2, 3, avg3(X, A, B))
      out(2, 1, avg3(A, B, C)), out(3, 3, avg3(A, B, C))
      out(3, 1, avg3(B, C, D))
      break
    case B_LD:
      out(0, 0, avg3(A, B, C))
      out(1, 0, avg3(B, C, D)), out(0, 1, avg3(B, C, D))
      out(2, 0, avg3(C, D, E)), out(1, 1, avg3(C, D, E)), out(0, 2, avg3(C, D, E))
      out(3, 0, avg3(D, E, F)), out(2, 1, avg3(D, E, F)), out(1, 2, avg3(D, E, F)), out(0, 3, avg3(D, E, F))
      out(3, 1, avg3(E, F, G)), out(2, 2, avg3(E, F, G)), out(1, 3, avg3(E, F, G))
      out(3, 2, avg3(F, G, H)), out(2, 3, avg3(F, G, H))
      out(3, 3, avg3(G, H, H))
      break
    case B_VL:
      out(0, 0, avg2(A, B))
      out(1, 0, avg2(B, C)), out(0, 2, avg2(B, C))
      out(2, 0, avg2(C, D)), out(1, 2, avg2(C, D))
      out(3, 0, avg2(D, E)), out(2, 2, avg2(D, E))
      out(0, 1, avg3(A, B, C))
      out(1, 1, avg3(B, C, D)), out(0, 3, avg3(B, C, D))
      out(2, 1, avg3(C, D, E)), out(1, 3, avg3(C, D, E))
      out(3, 1, avg3(D, E, F)), out(2, 3, avg3(D, E, F))
      out(3, 2, avg3(E, F, G))
      out(3, 3, avg3(F, G, H))
      break
    case B_HD:
      out(0, 0, avg2(I, X)), out(2, 1, avg2(I, X))
      out(0, 1, avg2(J, I)), out(2, 2, avg2(J, I))
      out(0, 2, avg2(K, J)), out(2, 3, avg2(K, J))
      out(0, 3, avg2(L, K))
      out(3, 0, avg3(A, B, C))
      out(2, 0, avg3(X, A, B))
      out(1, 0, avg3(I, X, A)), out(3, 1, avg3(I, X, A))
      out(1, 1, avg3(J, I, X)), out(3, 2, avg3(J, I, X))
      out(1, 2, avg3(K, J, I)), out(3, 3, avg3(K, J, I))
      out(1, 3, avg3(L, K, J))
      break
    default: // B_HU
      out(0, 0, avg2(I, J))
      out(2, 0, avg2(J, K)), out(0, 1, avg2(J, K))
      out(2, 1, avg2(K, L)), out(0, 2, avg2(K, L))
      out(1, 0, avg3(I, J, K))
      out(3, 0, avg3(J, K, L)), out(1, 1, avg3(J, K, L))
      out(3, 1, avg3(K, L, L)), out(1, 2, avg3(K, L, L))
      out(3, 2, L), out(2, 2, L), out(0, 3, L), out(1, 3, L), out(2, 3, L), out(3, 3, L)
  }
}

// ---- the loop filter (RFC 6386 section 15), over the whole frame in raster order of blocks

const sclip1 = (value: number) => (value < -128 ? -128 : value > 127 ? 127 : value)
const sclip2 = (value: number) => (value < -16 ? -16 : value > 15 ? 15 : value)

/** Two pixels changed (the edge itself). */
function filter2(plane: Uint8Array, at: number, step: number) {
  const p1 = plane[at - 2 * step]!
  const p0 = plane[at - step]!
  const q0 = plane[at]!
  const q1 = plane[at + step]!
  const a = 3 * (q0 - p0) + sclip1(p1 - q1)
  const a1 = sclip2((a + 4) >> 3)
  const a2 = sclip2((a + 3) >> 3)
  plane[at - step] = clip8(p0 + a2)
  plane[at] = clip8(q0 - a1)
}
/** Four pixels changed (inside a block). */
function filter4(plane: Uint8Array, at: number, step: number) {
  const p1 = plane[at - 2 * step]!
  const p0 = plane[at - step]!
  const q0 = plane[at]!
  const q1 = plane[at + step]!
  const a = 3 * (q0 - p0)
  const a1 = sclip2((a + 4) >> 3)
  const a2 = sclip2((a + 3) >> 3)
  const a3 = (a1 + 1) >> 1
  plane[at - 2 * step] = clip8(p1 + a3)
  plane[at - step] = clip8(p0 + a2)
  plane[at] = clip8(q0 - a1)
  plane[at + step] = clip8(q1 - a3)
}
/** Six pixels changed (the edge between blocks). */
function filter6(plane: Uint8Array, at: number, step: number) {
  const p2 = plane[at - 3 * step]!
  const p1 = plane[at - 2 * step]!
  const p0 = plane[at - step]!
  const q0 = plane[at]!
  const q1 = plane[at + step]!
  const q2 = plane[at + 2 * step]!
  const a = sclip1(3 * (q0 - p0) + sclip1(p1 - q1))
  const a1 = (27 * a + 63) >> 7
  const a2 = (18 * a + 63) >> 7
  const a3 = (9 * a + 63) >> 7
  plane[at - 3 * step] = clip8(p2 + a3)
  plane[at - 2 * step] = clip8(p1 + a2)
  plane[at - step] = clip8(p0 + a1)
  plane[at] = clip8(q0 - a1)
  plane[at + step] = clip8(q1 - a2)
  plane[at + 2 * step] = clip8(q2 - a3)
}
const highVariance = (plane: Uint8Array, at: number, step: number, threshold: number) => Math.abs(plane[at - 2 * step]! - plane[at - step]!) > threshold || Math.abs(plane[at + step]! - plane[at]!) > threshold
const needsSimple = (plane: Uint8Array, at: number, step: number, limit: number) => 4 * Math.abs(plane[at - step]! - plane[at]!) + Math.abs(plane[at - 2 * step]! - plane[at + step]!) <= limit
function needsNormal(plane: Uint8Array, at: number, step: number, limit: number, interior: number) {
  if (!needsSimple(plane, at, step, limit)) return false
  const p3 = plane[at - 4 * step]!
  const p2 = plane[at - 3 * step]!
  const p1 = plane[at - 2 * step]!
  const p0 = plane[at - step]!
  const q0 = plane[at]!
  const q1 = plane[at + step]!
  const q2 = plane[at + 2 * step]!
  const q3 = plane[at + 3 * step]!
  return Math.abs(p3 - p2) <= interior && Math.abs(p2 - p1) <= interior && Math.abs(p1 - p0) <= interior && Math.abs(q3 - q2) <= interior && Math.abs(q2 - q1) <= interior && Math.abs(q1 - q0) <= interior
}

/** Filter `size` pixels along an edge. `across` steps over the edge, `along` moves down it. */
function filterEdge(plane: Uint8Array, start: number, across: number, along: number, size: number, limit: number, interior: number, hev: number, onBlockEdge: boolean) {
  const thresholdLimit = 2 * limit + 1
  for (let index = 0; index < size; index++, start += along) {
    if (!needsNormal(plane, start, across, thresholdLimit, interior)) continue
    if (highVariance(plane, start, across, hev)) filter2(plane, start, across)
    else if (onBlockEdge) filter6(plane, start, across)
    else filter4(plane, start, across)
  }
}
function filterSimpleEdge(plane: Uint8Array, start: number, across: number, along: number, limit: number) {
  const thresholdLimit = 2 * limit + 1
  for (let index = 0; index < 16; index++, start += along) if (needsSimple(plane, start, across, thresholdLimit)) filter2(plane, start, across)
}

function loopFilter(y: Uint8Array, u: Uint8Array, v: Uint8Array, yStride: number, uvStride: number, mbWidth: number, mbHeight: number, filters: Int32Array, filterType: number) {
  for (let mbY = 0; mbY < mbHeight; mbY++)
    for (let mbX = 0; mbX < mbWidth; mbX++) {
      const at = (mbY * mbWidth + mbX) * 4
      const limit = filters[at]!
      if (limit === 0) continue
      const interior = filters[at + 1]!
      const hev = filters[at + 2]!
      const inner = filters[at + 3] === 1
      const luma = mbY * 16 * yStride + mbX * 16
      const chroma = mbY * 8 * uvStride + mbX * 8
      if (filterType === 1) {
        if (mbX > 0) filterSimpleEdge(y, luma, 1, yStride, limit + 4)
        if (inner) for (let edge = 4; edge < 16; edge += 4) filterSimpleEdge(y, luma + edge, 1, yStride, limit)
        if (mbY > 0) filterSimpleEdge(y, luma, yStride, 1, limit + 4)
        if (inner) for (let edge = 4; edge < 16; edge += 4) filterSimpleEdge(y, luma + edge * yStride, yStride, 1, limit)
        continue
      }
      if (mbX > 0) {
        filterEdge(y, luma, 1, yStride, 16, limit + 4, interior, hev, true)
        filterEdge(u, chroma, 1, uvStride, 8, limit + 4, interior, hev, true)
        filterEdge(v, chroma, 1, uvStride, 8, limit + 4, interior, hev, true)
      }
      if (inner) {
        for (let edge = 4; edge < 16; edge += 4) filterEdge(y, luma + edge, 1, yStride, 16, limit, interior, hev, false)
        filterEdge(u, chroma + 4, 1, uvStride, 8, limit, interior, hev, false)
        filterEdge(v, chroma + 4, 1, uvStride, 8, limit, interior, hev, false)
      }
      if (mbY > 0) {
        filterEdge(y, luma, yStride, 1, 16, limit + 4, interior, hev, true)
        filterEdge(u, chroma, uvStride, 1, 8, limit + 4, interior, hev, true)
        filterEdge(v, chroma, uvStride, 1, 8, limit + 4, interior, hev, true)
      }
      if (inner) {
        for (let edge = 4; edge < 16; edge += 4) filterEdge(y, luma + edge * yStride, yStride, 1, 16, limit, interior, hev, false)
        filterEdge(u, chroma + 4 * uvStride, uvStride, 1, 8, limit, interior, hev, false)
        filterEdge(v, chroma + 4 * uvStride, uvStride, 1, 8, limit, interior, hev, false)
      }
    }
}

// ---- colour

const multiplyHigh = (value: number, factor: number) => (value * factor) >> 8
const clip6 = (value: number) => ((value & ~16383) === 0 ? value >> 6 : value < 0 ? 0 : 255)

/** The frame as RGBA, chroma widened with the 9-3-3-1 smoothing (the neighbour nearer in each direction counts three, the diagonal one). */
export function vp8ToRgba(frame: Vp8Frame): Uint8Array {
  const { width, height, y, u, v, yStride, uvStride } = frame
  const pixels = new Uint8Array(width * height * 4)
  const chromaWidth = (width + 1) >> 1
  const chromaHeight = (height + 1) >> 1
  const widened = (plane: Uint8Array, x: number, row: number) => {
    const cx = x >> 1
    const cy = row >> 1
    const nx = Math.min(chromaWidth - 1, Math.max(0, x & 1 ? cx + 1 : cx - 1))
    const ny = Math.min(chromaHeight - 1, Math.max(0, row & 1 ? cy + 1 : cy - 1))
    return (9 * plane[cy * uvStride + cx]! + 3 * plane[cy * uvStride + nx]! + 3 * plane[ny * uvStride + cx]! + plane[ny * uvStride + nx]! + 8) >> 4
  }
  for (let row = 0; row < height; row++)
    for (let x = 0; x < width; x++) {
      const luma = multiplyHigh(y[row * yStride + x]!, 19077)
      const cb = widened(u, x, row)
      const cr = widened(v, x, row)
      const at = (row * width + x) * 4
      pixels[at] = clip6(luma + multiplyHigh(cr, 26149) - 14234)
      pixels[at + 1] = clip6(luma - multiplyHigh(cb, 6419) - multiplyHigh(cr, 13320) + 8708)
      pixels[at + 2] = clip6(luma + multiplyHigh(cb, 33050) - 17685)
      pixels[at + 3] = 255
    }
  return pixels
}

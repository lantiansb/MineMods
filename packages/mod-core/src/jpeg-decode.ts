// No Node APIs: like the PNG reader beside it, this only reads bytes.

/**
 * A JPEG reader for the concept pictures an outside AI hands in (`save_concepts`): baseline, extended-sequential and
 * progressive Huffman files at 8 bits, grey or YCbCr (what every camera and image tool writes). Arithmetic-coded,
 * lossless, 12-bit and four-channel (CMYK) files are refused in words, never half-read.
 *
 * It is written for tracing a picture down to a few dozen pixels, not for archiving it, so two things are plain on
 * purpose: the colour planes are widened by repeating samples (libjpeg's "fancy" smoothing would only be averaged
 * away again), and the inverse DCT is the textbook 8×8 matrix product in floating point (within one level of libjpeg's).
 * The EXIF orientation tag is not applied.
 */

export class JpegUnreadable extends Error {}

const refuse = (why: string): never => {
  throw new JpegUnreadable(why)
}

/** Position in a block of 64 (zig-zag order) → position in the block as a raster (ITU T.81 figure A.6). */
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]

/** c(u)/2 · cos((2x+1)uπ/16): the 1-D inverse transform as a matrix, row = output sample x, column = frequency u. */
const BASIS = Array.from({ length: 64 }, (_, index) => {
  const x = index >> 3
  const u = index & 7
  return ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
})

type Table = { fast: Int32Array; maxcode: Int32Array; valptr: Int32Array; mincode: Int32Array; values: Uint8Array }
/** Fast lookup covers codes of up to this many bits; longer ones (rare) are walked bit by bit. */
const FAST_BITS = 9

/** A Huffman table from the DHT segment's counts (codes of 1..16 bits) and symbols, canonical as T.81 annex C builds it. */
function huffmanTable(counts: Uint8Array, values: Uint8Array): Table {
  const maxcode = new Int32Array(18).fill(-1)
  const valptr = new Int32Array(17)
  const mincode = new Int32Array(17)
  const fast = new Int32Array(1 << FAST_BITS)
  let code = 0
  let index = 0
  for (let length = 1; length <= 16; length++) {
    valptr[length] = index
    mincode[length] = code
    for (let step = 0; step < counts[length - 1]!; step++, index++, code++) {
      if (length <= FAST_BITS) {
        const first = code << (FAST_BITS - length)
        for (let fill = 0; fill < 1 << (FAST_BITS - length); fill++) fast[first + fill] = (length << 8) | values[index]!
      }
    }
    maxcode[length] = counts[length - 1]! ? code - 1 : -1
    // The next length's codes start where this one's ended, one bit longer.
    code <<= 1
  }
  if (index > values.length) refuse("这张 JPEG 的哈夫曼表是坏的。")
  return { fast, maxcode, valptr, mincode, values }
}

/** The bit stream of a scan: bytes with 0xFF 0x00 stuffing, ending at the next marker (after which it reads zeros). */
class Bits {
  buffer = 0
  count = 0
  marker = 0
  constructor(
    readonly data: Uint8Array,
    public position: number,
  ) {}
  fill() {
    while (this.count <= 24) {
      let byte = 0
      if (!this.marker) {
        if (this.position >= this.data.length) this.marker = 0xd9
        else {
          byte = this.data[this.position]!
          if (byte === 0xff) {
            let next = this.data[this.position + 1]
            // Fill bytes: any number of 0xFF may come before a marker.
            let skip = 1
            while (next === 0xff) next = this.data[this.position + 1 + skip++]
            if (next === 0) this.position += 2
            else {
              this.marker = next ?? 0xd9
              this.position += skip - 1
              byte = 0
            }
          } else this.position++
        }
      }
      this.buffer = (this.buffer << 8) | byte
      this.count += 8
    }
  }
  take(length: number) {
    if (length === 0) return 0
    if (this.count < length) this.fill()
    this.count -= length
    return (this.buffer >>> this.count) & ((1 << length) - 1)
  }
  /** A number of `length` bits in the sign-and-magnitude form the coefficients use (T.81 F.2.2.1). */
  signed(length: number) {
    if (length === 0) return 0
    const value = this.take(length)
    return value < 1 << (length - 1) ? value - (1 << length) + 1 : value
  }
  symbol(table: Table) {
    if (this.count < 16) this.fill()
    const entry = table.fast[(this.buffer >>> (this.count - FAST_BITS)) & ((1 << FAST_BITS) - 1)]!
    if (entry) {
      this.count -= entry >> 8
      return entry & 255
    }
    for (let length = FAST_BITS + 1; length <= 16; length++) {
      const code = (this.buffer >>> (this.count - length)) & ((1 << length) - 1)
      if (table.maxcode[length]! >= 0 && code <= table.maxcode[length]! && code >= table.mincode[length]!) {
        this.count -= length
        return table.values[table.valptr[length]! + code - table.mincode[length]!]!
      }
    }
    return refuse("这张 JPEG 里有读不懂的编码。")
  }
  /** After a restart interval: drop the bits left over and step over the RSTn marker. */
  restart() {
    this.count = 0
    this.buffer = 0
    if (!this.marker) {
      while (this.position + 1 < this.data.length && !(this.data[this.position] === 0xff && this.data[this.position + 1]! >= 0xd0 && this.data[this.position + 1]! <= 0xd7)) this.position++
      if (this.position + 1 >= this.data.length) return
      this.marker = this.data[this.position + 1]!
    }
    if (this.marker >= 0xd0 && this.marker <= 0xd7) {
      this.position += 2
      this.marker = 0
    }
  }
}

type Component = {
  id: number
  h: number
  v: number
  quantisation: number
  /** Blocks across / down, padded to whole MCUs: the coefficients are stored for all of them. */
  blocksX: number
  blocksY: number
  /** Blocks the component really covers (a scan of this component alone walks these, not the padding). */
  usedX: number
  usedY: number
  coefficients: Int16Array
  predictor: number
  dc: Table | null
  ac: Table | null
}

export type DecodedJpeg = { width: number; height: number; pixels: Uint8Array }

/** Most pixels a picture may have: a long side of 4096 on a square, which is as large as an image tool writes and decodes in about a second. */
export const JPEG_MAX_PIXELS = 4096 * 4096

export function decodeJpeg(input: Uint8Array): DecodedJpeg {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) refuse("这不是 JPEG 文件。")
  const quantisation: Int32Array[] = []
  const dcTables: Table[] = []
  const acTables: Table[] = []
  let components: Component[] = []
  let width = 0
  let height = 0
  let progressive = false
  let restartInterval = 0
  let adobe = -1
  let maxH = 1
  let maxV = 1
  let mcusX = 0
  let mcusY = 0
  let scans = 0
  let position = 2
  const word = (at: number) => (input[at]! << 8) | input[at + 1]!
  while (position < input.length) {
    if (input[position] !== 0xff) {
      position++
      continue
    }
    const marker = input[position + 1]!
    if (marker === 0xff) {
      position++
      continue
    }
    if (marker === 0 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      position += 2
      continue
    }
    if (marker === 0xd9) break
    const length = word(position + 2)
    const body = position + 4
    const end = position + 2 + length
    if (length < 2 || end > input.length) refuse("这张 JPEG 不完整。")
    if (marker === 0xdb) {
      for (let at = body; at < end; ) {
        const precision = input[at]! >> 4
        const slot = input[at]! & 15
        at++
        const table = new Int32Array(64)
        for (let index = 0; index < 64; index++) {
          table[ZIGZAG[index]!] = precision ? word(at + index * 2) : input[at + index]!
        }
        at += precision ? 128 : 64
        quantisation[slot] = table
      }
    } else if (marker === 0xc4) {
      for (let at = body; at < end; ) {
        const kind = input[at]! >> 4
        const slot = input[at]! & 15
        const counts = input.subarray(at + 1, at + 17)
        const total = counts.reduce((sum, count) => sum + count, 0)
        const table = huffmanTable(counts, input.subarray(at + 17, at + 17 + total))
        if (kind === 0) dcTables[slot] = table
        else acTables[slot] = table
        at += 17 + total
      }
    } else if (marker === 0xdd) {
      restartInterval = word(body)
    } else if (marker === 0xee) {
      if (length >= 14 && String.fromCharCode(...input.subarray(body, body + 5)) === "Adobe") adobe = input[body + 11]!
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (components.length) refuse("这张 JPEG 有两个画面头，读不了。")
      progressive = marker === 0xc2
      if (input[body] !== 8) refuse("只读 8 位的 JPEG。")
      height = word(body + 1)
      width = word(body + 3)
      const count = input[body + 5]!
      if (!width || !height) refuse("这张 JPEG 的宽或高是 0。")
      if (width * height > JPEG_MAX_PIXELS || width > 8192 || height > 8192) refuse(`这张 JPEG 太大了（${width}×${height}），最多读 ${Math.sqrt(JPEG_MAX_PIXELS)}×${Math.sqrt(JPEG_MAX_PIXELS)} 像素。把它缩小一些再交。`)
      if (count !== 1 && count !== 3) refuse(count === 4 ? "这张 JPEG 是 CMYK 的，读不了：存成普通的 RGB 再交。" : "这张 JPEG 的颜色通道数读不了。")
      components = Array.from({ length: count }, (_, index) => {
        const at = body + 6 + index * 3
        const sampling = input[at + 1]!
        const h = sampling >> 4
        const v = sampling & 15
        if (!h || !v || h > 4 || v > 4) refuse("这张 JPEG 的采样方式读不懂。")
        return { id: input[at]!, h, v, quantisation: input[at + 2]!, blocksX: 0, blocksY: 0, usedX: 0, usedY: 0, coefficients: new Int16Array(0), predictor: 0, dc: null, ac: null }
      })
      maxH = Math.max(...components.map((component) => component.h))
      maxV = Math.max(...components.map((component) => component.v))
      mcusX = Math.ceil(width / (8 * maxH))
      mcusY = Math.ceil(height / (8 * maxV))
      for (const component of components) {
        component.blocksX = mcusX * component.h
        component.blocksY = mcusY * component.v
        component.usedX = Math.ceil(Math.ceil((width * component.h) / maxH) / 8)
        component.usedY = Math.ceil(Math.ceil((height * component.v) / maxV) / 8)
        component.coefficients = new Int16Array(component.blocksX * component.blocksY * 64)
      }
    } else if ((marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) || marker === 0xc8) {
      refuse(marker >= 0xc9 ? "这张 JPEG 用了算术编码，读不了：存成普通的 JPEG 或 PNG 再交。" : "这张 JPEG 的压缩方式读不了：存成普通的 JPEG 或 PNG 再交。")
    } else if (marker === 0xda) {
      if (!components.length) refuse("这张 JPEG 的扫描出现在画面头之前。")
      const count = input[body]!
      const used: Component[] = []
      for (let index = 0; index < count; index++) {
        const component = components.find((value) => value.id === input[body + 1 + index * 2])
        if (!component) return refuse("这张 JPEG 的扫描指向不存在的颜色通道。")
        const tables = input[body + 2 + index * 2]!
        component.dc = dcTables[tables >> 4] ?? null
        component.ac = acTables[tables & 15] ?? null
        used.push(component)
      }
      const spectralStart = input[body + 1 + count * 2]!
      const spectralEnd = input[body + 2 + count * 2]!
      const approximation = input[body + 3 + count * 2]!
      const after = scan(input, end, used, progressive ? { start: spectralStart, end: spectralEnd, high: approximation >> 4, low: approximation & 15 } : null, restartInterval, mcusX, mcusY)
      scans++
      position = after
      continue
    }
    position = end
  }
  if (!scans) refuse("这张 JPEG 里没有图像数据。")
  return { width, height, pixels: assemble(components, quantisation, width, height, maxH, maxV, adobe) }

  function scan(data: Uint8Array, start: number, used: Component[], spectral: { start: number; end: number; high: number; low: number } | null, interval: number, across: number, down: number) {
    const bits = new Bits(data, start)
    for (const component of used) component.predictor = 0
    let eobrun = 0
    const single = used.length === 1
    const total = single ? used[0]!.usedX * used[0]!.usedY : across * down
    const blockAt = (component: Component, row: number, column: number) => (row * component.blocksX + column) * 64
    const decodeBlock = (component: Component, offset: number) => {
      const block = component.coefficients
      if (!spectral) {
        if (!component.dc || !component.ac) refuse("这张 JPEG 缺哈夫曼表。")
        const size = bits.symbol(component.dc!)
        component.predictor += bits.signed(size)
        block[offset] = component.predictor
        for (let k = 1; k < 64; ) {
          const symbol = bits.symbol(component.ac!)
          const run = symbol >> 4
          const magnitude = symbol & 15
          if (magnitude === 0) {
            if (run < 15) break
            k += 16
            continue
          }
          k += run
          if (k > 63) break
          block[offset + ZIGZAG[k]!] = bits.signed(magnitude)
          k++
        }
        return
      }
      const { start: from, end: to, high, low } = spectral
      if (from === 0) {
        if (high === 0) {
          if (!component.dc) refuse("这张 JPEG 缺哈夫曼表。")
          const size = bits.symbol(component.dc!)
          component.predictor += bits.signed(size)
          block[offset] = component.predictor * (1 << low)
        } else if (bits.take(1)) block[offset] |= 1 << low
        return
      }
      if (!component.ac) refuse("这张 JPEG 缺哈夫曼表。")
      if (high === 0) {
        if (eobrun > 0) {
          eobrun--
          return
        }
        for (let k = from; k <= to; ) {
          const symbol = bits.symbol(component.ac!)
          const run = symbol >> 4
          const magnitude = symbol & 15
          if (magnitude === 0) {
            if (run < 15) {
              eobrun = bits.take(run) + (1 << run) - 1
              break
            }
            k += 16
            continue
          }
          k += run
          if (k > 63) break
          block[offset + ZIGZAG[k]!] = bits.signed(magnitude) * (1 << low)
          k++
        }
        return
      }
      // Refinement of the AC coefficients (T.81 G.1.2.3): the bit that is one place finer, for those already non-zero, and the new ones.
      const plus = 1 << low
      const minus = -1 << low
      let k = from
      if (eobrun === 0) {
        for (; k <= to; k++) {
          const symbol = bits.symbol(component.ac!)
          let run = symbol >> 4
          let value = symbol & 15
          if (value !== 0) value = bits.take(1) ? plus : minus
          else if (run !== 15) {
            eobrun = 1 << run
            if (run) eobrun += bits.take(run)
            break
          }
          do {
            const at = offset + ZIGZAG[k]!
            if (block[at] !== 0) {
              if (bits.take(1) && (block[at]! & plus) === 0) block[at] += block[at]! >= 0 ? plus : minus
            } else if (--run < 0) break
            k++
          } while (k <= to)
          if (value !== 0 && k <= 63) block[offset + ZIGZAG[k]!] = value
        }
      }
      if (eobrun > 0) {
        for (; k <= to; k++) {
          const at = offset + ZIGZAG[k]!
          if (block[at] !== 0 && bits.take(1) && (block[at]! & plus) === 0) block[at] += block[at]! >= 0 ? plus : minus
        }
        eobrun--
      }
    }
    let reached = 0
    try {
      for (let index = 0; index < total; index++) {
        reached = index
        if (interval && index > 0 && index % interval === 0) {
          bits.restart()
          for (const component of used) component.predictor = 0
          eobrun = 0
        }
        if (single) {
          const component = used[0]!
          decodeBlock(component, blockAt(component, Math.floor(index / component.usedX), index % component.usedX))
        } else {
          const row = Math.floor(index / across)
          const column = index % across
          for (const component of used) for (let v = 0; v < component.v; v++) for (let h = 0; h < component.h; h++) decodeBlock(component, blockAt(component, row * component.v + v, column * component.h + h))
        }
      }
    } catch (error) {
      // A file cut off or damaged in the middle of its data keeps what was decoded up to there (the rest stays mid-grey):
      // a concept picture that is mostly there is still worth tracing. A file that fails at its very first block is refused.
      if (!(error instanceof JpegUnreadable) || reached === 0) throw error
    }
    // Step to the next marker after the scan's data.
    let after = bits.position
    while (after + 1 < data.length && !(data[after] === 0xff && data[after + 1] !== 0 && !(data[after + 1]! >= 0xd0 && data[after + 1]! <= 0xd7) && data[after + 1] !== 0xff)) after++
    return after
  }
}

/** The planes of every component as 8-bit samples (dequantised, inverse transformed, level shifted), then widened and joined into RGBA. */
function assemble(components: Component[], quantisation: Int32Array[], width: number, height: number, maxH: number, maxV: number, adobe: number) {
  const planes = components.map((component) => {
    const table = quantisation[component.quantisation]
    if (!table) refuse("这张 JPEG 缺量化表。")
    const stride = component.blocksX * 8
    const plane = new Uint8Array(stride * component.blocksY * 8)
    const input = new Float64Array(64)
    const middle = new Float64Array(64)
    for (let row = 0; row < component.blocksY; row++) {
      for (let column = 0; column < component.blocksX; column++) {
        const offset = (row * component.blocksX + column) * 64
        let others = false
        for (let index = 0; index < 64; index++) {
          const value = component.coefficients[offset + index]! * table![index]!
          input[index] = value
          if (index > 0 && value !== 0) others = true
        }
        const base = row * 8 * stride + column * 8
        if (!others) {
          const flat = Math.max(0, Math.min(255, Math.round(input[0]! / 8 + 128)))
          for (let y = 0; y < 8; y++) plane.fill(flat, base + y * stride, base + y * stride + 8)
          continue
        }
        // Rows first: middle[y][x] = Σu basis[x][u] · input[y][u]; then columns.
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            let sum = 0
            for (let u = 0; u < 8; u++) sum += BASIS[x * 8 + u]! * input[y * 8 + u]!
            middle[y * 8 + x] = sum
          }
        for (let x = 0; x < 8; x++)
          for (let y = 0; y < 8; y++) {
            let sum = 0
            for (let v = 0; v < 8; v++) sum += BASIS[y * 8 + v]! * middle[v * 8 + x]!
            plane[base + y * stride + x] = Math.max(0, Math.min(255, Math.round(sum + 128)))
          }
      }
    }
    return { plane, stride, h: component.h, v: component.v }
  })
  const pixels = new Uint8Array(width * height * 4)
  // Which colour model: the Adobe marker says (0 = RGB as it is); otherwise component names "R","G","B" mean RGB, and anything else is YCbCr.
  const rgb = components.length === 3 && (adobe === 0 || (components[0]!.id === 0x52 && components[1]!.id === 0x47 && components[2]!.id === 0x42))
  const sample = (index: number, x: number, y: number) => {
    const plane = planes[index]!
    return plane.plane[Math.floor((y * plane.v) / maxV) * plane.stride + Math.floor((x * plane.h) / maxH)]!
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      if (planes.length === 1) {
        const grey = sample(0, x, y)
        pixels[at] = pixels[at + 1] = pixels[at + 2] = grey
      } else {
        const first = sample(0, x, y)
        const second = sample(1, x, y)
        const third = sample(2, x, y)
        if (rgb) {
          pixels[at] = first
          pixels[at + 1] = second
          pixels[at + 2] = third
        } else {
          const cb = second - 128
          const cr = third - 128
          pixels[at] = clamp(first + 1.402 * cr)
          pixels[at + 1] = clamp(first - 0.344136 * cb - 0.714136 * cr)
          pixels[at + 2] = clamp(first + 1.772 * cb)
        }
      }
      pixels[at + 3] = 255
    }
  return pixels
}

const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value))

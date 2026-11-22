// No Node APIs: a font file's bytes in, outlines and pixels out. Reading the files off the disk is `glyph-fill.ts`'s.

/**
 * Just enough of a TrueType font (or one face of a collection) to draw a few characters as the game's pixel glyphs (补字, E19): the names a
 * licence is read from, which glyph a character is, and that glyph's outline at a weight of a variable font. Outlines in `glyf` only: a font
 * whose outlines are PostScript (`CFF `, as the OpenType releases of Source Han Serif are) is not read, and says so (`outlines: false`).
 */
export type GlyphFace = ReturnType<typeof readFace>

type Point = { x: number; y: number; on: boolean }

/** Where each face of the file starts: one for a font, several for a collection (`ttcf`). */
export function faceOffsets(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 12) return []
  if (view.getUint32(0) !== 0x74746366) return [0]
  return Array.from({ length: Math.min(view.getUint32(8), 64) }, (_, index) => view.getUint32(12 + index * 4))
}

/** The table directory of a face: tag to [offset, length], or null when the bytes are not a font. */
export function faceTables(bytes: Uint8Array, start = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (start + 12 > bytes.length) return null
  const version = view.getUint32(start)
  if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) return null
  const count = view.getUint16(start + 4)
  if (start + 12 + count * 16 > bytes.length) return null
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const at = start + 12 + index * 16
    return [String.fromCharCode(...bytes.subarray(at, at + 4)), [view.getUint32(at + 8), view.getUint32(at + 12)] as const]
  }))
}

/** The face's names by name id (0 copyright, 1 family, 13 licence, 14 licence URL…), in English where the font has it. */
export function faceNames(bytes: Uint8Array, tables: NonNullable<ReturnType<typeof faceTables>>) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const table = tables["name"]
  if (!table || table[0] + 6 > bytes.length) return {}
  const base = table[0]
  const strings = base + view.getUint16(base + 4)
  const found: Record<number, string> = {}
  const rank: Record<number, number> = {}
  Array.from({ length: view.getUint16(base + 2) }, (_, index) => base + 6 + index * 12).forEach((at) => {
    const platform = view.getUint16(at)
    const language = view.getUint16(at + 4)
    const id = view.getUint16(at + 6)
    const from = strings + view.getUint16(at + 10)
    const raw = bytes.subarray(from, from + view.getUint16(at + 8))
    // Windows English first, then any Windows name, then the old Macintosh Roman ones.
    const score = platform === 3 ? (language === 0x409 ? 3 : 2) : platform === 1 && language === 0 ? 1 : 0
    if (!score || (rank[id] ?? 0) >= score) return
    rank[id] = score
    found[id] = platform === 3
      ? String.fromCharCode(...Array.from({ length: raw.length >> 1 }, (_, unit) => (raw[unit * 2]! << 8) | raw[unit * 2 + 1]!))
      : String.fromCharCode(...raw)
  })
  return found
}

/** Whether what a face says of its licence is the SIL Open Font License 1.1, which lets its glyphs go out with a mod (as long as the font itself is not sold alone). */
export const openFontLicensed = (names: Record<number, string>) =>
  /SIL Open Font License,? (Version )?1\.1/i.test(names[13] ?? "") || /scripts\.sil\.org\/OFL|openfontlicense\.org/i.test(names[14] ?? "")

/**
 * The character map of a face, as a lookup: format 12 (every plane) when the face has it, else format 4 (the BMP). Read lazily, once.
 */
function characterMap(view: DataView, table: readonly [number, number] | undefined) {
  if (!table) return () => 0
  const base = table[0]
  const subtables = Array.from({ length: view.getUint16(base + 2) }, (_, index) => {
    const at = base + 4 + index * 8
    const offset = base + view.getUint32(at + 4)
    return { platform: view.getUint16(at), encoding: view.getUint16(at + 2), offset, format: view.getUint16(offset) }
  })
  const unicode = (entry: (typeof subtables)[number]) => entry.platform === 0 || (entry.platform === 3 && (entry.encoding === 1 || entry.encoding === 10))
  const wide = subtables.find((entry) => unicode(entry) && entry.format === 12)
  if (wide) {
    const groups = Array.from({ length: view.getUint32(wide.offset + 12) }, (_, index) => {
      const at = wide.offset + 16 + index * 12
      return [view.getUint32(at), view.getUint32(at + 4), view.getUint32(at + 8)] as const
    })
    return (code: number) => {
      let low = 0, high = groups.length - 1
      while (low <= high) {
        const middle = (low + high) >> 1
        const group = groups[middle]!
        if (code < group[0]) high = middle - 1
        else if (code > group[1]) low = middle + 1
        else return group[2] + code - group[0]
      }
      return 0
    }
  }
  const basic = subtables.find((entry) => unicode(entry) && entry.format === 4)
  if (!basic) return () => 0
  const segments = view.getUint16(basic.offset + 6) >> 1
  const ends = basic.offset + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const ranges = deltas + segments * 2
  return (code: number) => {
    if (code > 0xffff) return 0
    const segment = Array.from({ length: segments }, (_, index) => index).find((index) => view.getUint16(ends + index * 2) >= code)
    if (segment === undefined || view.getUint16(starts + segment * 2) > code) return 0
    const range = view.getUint16(ranges + segment * 2)
    const delta = view.getInt16(deltas + segment * 2)
    if (!range) return (code + delta) & 0xffff
    const glyph = view.getUint16(ranges + segment * 2 + range + (code - view.getUint16(starts + segment * 2)) * 2)
    return glyph ? (glyph + delta) & 0xffff : 0
  }
}

/** A character's glyph id in a `cmap` table read on its own (`bytes` is the table), 0 when the face has none: for looking a font up without reading all of it. */
export const glyphLookup = (bytes: Uint8Array) => characterMap(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), [0, bytes.length])

/** Reads one face: null when it is not a font this can draw from. */
export function readFace(bytes: Uint8Array, start = 0) {
  const tables = faceTables(bytes, start)
  if (!tables || !tables["head"] || !tables["maxp"]) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names = faceNames(bytes, tables)
  const head = tables["head"][0]
  const upem = view.getUint16(head + 18)
  const longLoca = view.getInt16(head + 50) === 1
  const glyphs = view.getUint16(tables["maxp"][0] + 4)
  const os2 = tables["OS/2"]?.[0]
  // The ideographic em box: OS/2's typographic ascender and descender, which for a CJK font are the em's top and bottom (880 and -120 of 1000).
  const ascender = os2 !== undefined ? view.getInt16(os2 + 68) : Math.round(upem * 0.88)
  const descender = os2 !== undefined ? view.getInt16(os2 + 70) : -Math.round(upem * 0.12)
  const glyph = characterMap(view, tables["cmap"])
  const loca = tables["loca"]?.[0]
  const glyf = tables["glyf"]?.[0]
  const axes = tables["fvar"]
    ? ((base: number) => Array.from({ length: view.getUint16(base + 8) }, (_, index) => {
        const at = base + view.getUint16(base + 4) + index * view.getUint16(base + 10)
        return { tag: String.fromCharCode(...bytes.subarray(at, at + 4)), min: view.getInt32(at + 4) / 65536, value: view.getInt32(at + 8) / 65536, max: view.getInt32(at + 12) / 65536 }
      }))(tables["fvar"][0])
    : []
  // avar: each axis's piecewise map of normalized coordinates.
  const maps = tables["avar"]
    ? ((base: number) => {
        const list: [number, number][][] = []
        let at = base + 8
        axes.forEach(() => {
          const count = view.getUint16(at)
          list.push(Array.from({ length: count }, (_, index) => [view.getInt16(at + 2 + index * 4) / 16384, view.getInt16(at + 4 + index * 4) / 16384]))
          at += 2 + count * 4
        })
        return list
      })(tables["avar"][0])
    : []
  /** The normalized coordinates of a design point (`{ wght: 500 }`), each axis clamped to its range, through avar. */
  const coordinates = (design: Readonly<Record<string, number>>) => axes.map((axis, index) => {
    const value = Math.min(axis.max, Math.max(axis.min, design[axis.tag] ?? axis.value))
    const plain = value < axis.value ? (value - axis.value) / (axis.value - axis.min || 1) : value > axis.value ? (value - axis.value) / (axis.max - axis.value || 1) : 0
    const map = maps[index]
    if (!map || map.length < 2) return plain
    const after = map.findIndex(([from]) => from >= plain)
    if (after <= 0) return after === 0 ? map[0]![1] : map.at(-1)![1]
    const [a, b] = [map[after - 1]!, map[after]!]
    return a[1] + ((plain - a[0]) / (b[0] - a[0] || 1)) * (b[1] - a[1])
  })
  const range = (id: number) => {
    if (loca === undefined || glyf === undefined || id >= glyphs) return null
    const from = longLoca ? view.getUint32(loca + id * 4) : view.getUint16(loca + id * 2) * 2
    const to = longLoca ? view.getUint32(loca + id * 4 + 4) : view.getUint16(loca + id * 2 + 2) * 2
    return [glyf + from, glyf + to] as const
  }
  const variations = glyphVariations(view, tables["gvar"], glyphs)
  /** A glyph's contours in font units, at those normalized coordinates (the default instance when there are none). */
  const outline = (id: number, at: readonly number[], depth = 0): Point[][] => {
    const span = range(id)
    if (!span || span[1] <= span[0] || depth > 8) return []
    const contours = view.getInt16(span[0])
    if (contours >= 0) {
      const simple = simpleGlyph(view, span[0], contours)
      const moved = variations(id, at, simple.flat().map((point) => [point.x, point.y] as [number, number]), simple.map((contour) => contour.length))
      let index = 0
      return simple.map((contour) => contour.map((point) => {
        const [x, y] = moved[index++]!
        return { x, y, on: point.on }
      }))
    }
    const parts = compositeGlyph(view, span[0] + 10)
    const moved = variations(id, at, parts.map((part) => [part.dx, part.dy] as [number, number]), parts.map(() => 1))
    return parts.flatMap((part, index) => outline(part.glyph, at, depth + 1).map((contour) => contour.map((point) => ({
      x: part.matrix[0] * point.x + part.matrix[2] * point.y + moved[index]![0],
      y: part.matrix[1] * point.x + part.matrix[3] * point.y + moved[index]![1],
      on: point.on,
    }))))
  }
  return { names, upem, ascender, descender, axes, outlines: glyf !== undefined && loca !== undefined, glyph, coordinates, outline }
}

function simpleGlyph(view: DataView, start: number, contours: number) {
  const ends = Array.from({ length: contours }, (_, index) => view.getUint16(start + 10 + index * 2))
  const count = contours ? ends.at(-1)! + 1 : 0
  let at = start + 10 + contours * 2
  at += 2 + view.getUint16(at)
  const flags: number[] = []
  while (flags.length < count) {
    const flag = view.getUint8(at++)
    flags.push(flag)
    if (flag & 8) {
      const times = view.getUint8(at++)
      for (let repeat = 0; repeat < times; repeat++) flags.push(flag)
    }
  }
  const read = (short: number, same: number) => {
    let value = 0
    return flags.map((flag) => {
      if (flag & short) {
        const step = view.getUint8(at++)
        value += flag & same ? step : -step
        return value
      }
      if (!(flag & same)) {
        value += view.getInt16(at)
        at += 2
      }
      return value
    })
  }
  const xs = read(2, 16)
  const ys = read(4, 32)
  return ends.map((end, index) => {
    const from = index ? ends[index - 1]! + 1 : 0
    return Array.from({ length: end - from + 1 }, (_, offset) => ({ x: xs[from + offset]!, y: ys[from + offset]!, on: (flags[from + offset]! & 1) === 1 }))
  })
}

function compositeGlyph(view: DataView, start: number) {
  const parts: { glyph: number; dx: number; dy: number; matrix: [number, number, number, number] }[] = []
  let at = start
  for (let more = true; more; ) {
    const flags = view.getUint16(at)
    const glyph = view.getUint16(at + 2)
    at += 4
    const words = flags & 1
    const dx = words ? view.getInt16(at) : view.getInt8(at)
    const dy = words ? view.getInt16(at + 2) : view.getInt8(at + 1)
    at += words ? 4 : 2
    const f2 = (offset: number) => view.getInt16(at + offset) / 16384
    const matrix: [number, number, number, number] = flags & 8 ? [f2(0), 0, 0, f2(0)] : flags & 0x40 ? [f2(0), 0, 0, f2(2)] : flags & 0x80 ? [f2(0), f2(2), f2(4), f2(6)] : [1, 0, 0, 1]
    at += flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0
    // Point-matched placement (ARGS_ARE_XY_VALUES unset) is rare in CJK fonts and drawn unshifted.
    parts.push({ glyph, dx: flags & 2 ? dx : 0, dy: flags & 2 ? dy : 0, matrix })
    more = (flags & 0x20) !== 0
  }
  return parts
}

/**
 * gvar: moves a glyph's points from the default instance to the given normalized coordinates. Tuples that name only some points have the others
 * inferred along each contour (IUP), as the spec says; the four phantom points are read past and not used.
 */
function glyphVariations(view: DataView, table: readonly [number, number] | undefined, glyphs: number) {
  const none = (_id: number, _at: readonly number[], points: [number, number][]) => points
  if (!table) return none
  const base = table[0]
  const axisCount = view.getUint16(base + 4)
  const sharedCount = view.getUint16(base + 6)
  const shared = base + view.getUint32(base + 8)
  const longOffsets = (view.getUint16(base + 14) & 1) === 1
  const data = base + view.getUint32(base + 16)
  const offset = (id: number) => (longOffsets ? view.getUint32(base + 20 + id * 4) : view.getUint16(base + 20 + id * 2) * 2)
  const tuple = (at: number) => Array.from({ length: axisCount }, (_, index) => view.getInt16(at + index * 2) / 16384)
  const sharedTuples = Array.from({ length: sharedCount }, (_, index) => tuple(shared + index * axisCount * 2))
  return (id: number, at: readonly number[], points: [number, number][], contours: number[]) => {
    if (id >= glyphs || !at.some((value) => value !== 0)) return points
    const from = data + offset(id)
    const to = data + offset(id + 1)
    if (to <= from) return points
    const total = points.length + 4
    const header = view.getUint16(from)
    let cursor = from + view.getUint16(from + 2)
    const packedPoints = () => {
      const first = view.getUint8(cursor++)
      if (first === 0) return null
      const count = first & 0x80 ? ((first & 0x7f) << 8) | view.getUint8(cursor++) : first
      const list: number[] = []
      let point = 0
      while (list.length < count) {
        const control = view.getUint8(cursor++)
        const run = (control & 0x7f) + 1
        for (let index = 0; index < run && list.length < count; index++) {
          point += control & 0x80 ? view.getUint16(cursor) : view.getUint8(cursor)
          cursor += control & 0x80 ? 2 : 1
          list.push(point)
        }
      }
      return list
    }
    const packedDeltas = (count: number) => {
      const list: number[] = []
      while (list.length < count) {
        const control = view.getUint8(cursor++)
        const run = (control & 0x3f) + 1
        for (let index = 0; index < run && list.length < count; index++) {
          if (control & 0x80) list.push(0)
          else if (control & 0x40) {
            list.push(view.getInt16(cursor))
            cursor += 2
          } else list.push(view.getInt8(cursor++))
        }
      }
      return list
    }
    const sharedPoints = header & 0x8000 ? packedPoints() : null
    const result = points.map(([x, y]) => [x, y] as [number, number])
    let head = from + 4
    for (let index = 0; index < (header & 0x0fff); index++) {
      const size = view.getUint16(head)
      const flags = view.getUint16(head + 2)
      head += 4
      const peak = flags & 0x8000 ? tuple(head) : sharedTuples[flags & 0x0fff] ?? []
      if (flags & 0x8000) head += axisCount * 2
      const startTuple = flags & 0x4000 ? tuple(head) : null
      const endTuple = flags & 0x4000 ? tuple(head + axisCount * 2) : null
      if (flags & 0x4000) head += axisCount * 4
      const scalar = peak.reduce((product, top, axis) => {
        const value = at[axis] ?? 0
        if (top === 0 || product === 0) return product
        if (value === top) return product
        const low = startTuple ? startTuple[axis]! : Math.min(top, 0)
        const high = endTuple ? endTuple[axis]! : Math.max(top, 0)
        if (value <= low || value >= high) return 0
        return product * (value < top ? (value - low) / (top - low) : (high - value) / (high - top))
      }, 1)
      const next = cursor + size
      if (scalar !== 0) {
        const own = flags & 0x2000 ? packedPoints() : sharedPoints
        const named = own ?? Array.from({ length: total }, (_, point) => point)
        const dx = packedDeltas(named.length)
        const dy = packedDeltas(named.length)
        const deltas = interpolate(points, contours, named, dx, dy)
        deltas.forEach(([x, y], point) => {
          result[point]![0] += x * scalar
          result[point]![1] += y * scalar
        })
      }
      cursor = next
    }
    return result
  }
}

/** One tuple's deltas for every outline point: the named ones as given, the others inferred from their neighbours on the same contour (IUP). */
function interpolate(points: [number, number][], contours: number[], named: number[], dx: number[], dy: number[]) {
  const given = new Map<number, [number, number]>()
  named.forEach((point, index) => {
    if (point < points.length) given.set(point, [dx[index]!, dy[index]!])
  })
  const out = points.map((_, point) => given.get(point) ?? [0, 0] as [number, number])
  if (given.size === points.length) return out
  let start = 0
  contours.forEach((length) => {
    const indexes = Array.from({ length }, (_, offset) => start + offset)
    const touched = indexes.filter((point) => given.has(point))
    start += length
    if (!touched.length) return
    if (touched.length === 1) {
      indexes.forEach((point) => (out[point] = given.get(touched[0]!)!))
      return
    }
    touched.forEach((point, index) => {
      const after = touched[(index + 1) % touched.length]!
      for (let step = (point - indexes[0]! + 1) % length; ; step = (step + 1) % length) {
        const current = indexes[step]!
        if (current === after) break
        out[current] = [0, 1].map((axis) => {
          const [a, b] = [points[point]![axis]!, points[after]![axis]!]
          const [da, db] = [given.get(point)![axis]!, given.get(after)![axis]!]
          const value = points[current]![axis]!
          if (a === b) return da === db ? da : 0
          const [lowAt, highAt, lowDelta, highDelta] = a < b ? [a, b, da, db] : [b, a, db, da]
          if (value <= lowAt) return lowDelta
          if (value >= highAt) return highDelta
          return lowDelta + ((value - lowAt) / (highAt - lowAt)) * (highDelta - lowDelta)
        }) as [number, number]
      }
    })
  })
  return out
}

/**
 * How much of each pixel of a `size`-square cell a glyph covers (0 to 1), its em box (the face's ascender to descender) filling the cell's
 * height and centred across: `samples` × `samples` points a pixel, filled by the nonzero rule. Quadratic curves are cut into straight pieces.
 */
export function coverage(face: NonNullable<GlyphFace>, contours: Point[][], size: number, samples = 8) {
  const scale = size / (face.ascender - face.descender)
  const edges: [number, number, number, number][] = []
  contours.forEach((contour) => {
    if (contour.length < 2) return
    // TrueType's implied on-curve points between two off-curve ones; then a closed run of on, off*, on.
    const full = contour.flatMap((point, index) => {
      const next = contour[(index + 1) % contour.length]!
      return !point.on && !next.on ? [point, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2, on: true }] : [point]
    })
    const first = full.findIndex((point) => point.on)
    const ring = first < 0 ? full : [...full.slice(first), ...full.slice(0, first)]
    const pixel = (point: { x: number; y: number }) => [point.x * scale + size / 2 - (face.upem * scale) / 2, (face.ascender - point.y) * scale] as const
    let from = pixel(ring[0]!)
    for (let index = 1; index <= ring.length; index++) {
      const point = ring[index % ring.length]!
      if (point.on) {
        const to = pixel(point)
        edges.push([from[0], from[1], to[0], to[1]])
        from = to
        continue
      }
      const end = ring[(index + 1) % ring.length]!
      const control = pixel(point)
      const to = pixel(end)
      for (let step = 1; step <= 8; step++) {
        const t = step / 8
        const along = [(1 - t) ** 2 * from[0] + 2 * (1 - t) * t * control[0] + t * t * to[0], (1 - t) ** 2 * from[1] + 2 * (1 - t) * t * control[1] + t * t * to[1]] as const
        const last = edges.length && step > 1 ? [edges.at(-1)![2], edges.at(-1)![3]] : from
        edges.push([last[0]!, last[1]!, along[0], along[1]])
      }
      from = to
      index++
    }
  })
  const cells = new Float32Array(size * size)
  const share = 1 / (samples * samples)
  for (let row = 0; row < size * samples; row++) {
    const y = (row + 0.5) / samples
    const crossings = edges.flatMap(([x0, y0, x1, y1]) => {
      if ((y0 <= y) === (y1 <= y)) return []
      return [{ x: x0 + ((y - y0) / (y1 - y0)) * (x1 - x0), winding: y1 > y0 ? 1 : -1 }]
    }).sort((a, b) => a.x - b.x)
    let winding = 0
    crossings.forEach((crossing, index) => {
      winding += crossing.winding
      const next = crossings[index + 1]
      if (!winding || !next) return
      for (let column = Math.max(0, Math.ceil(crossing.x * samples - 0.5)); column < size * samples && (column + 0.5) / samples < next.x; column++)
        cells[Math.floor(row / samples) * size + Math.floor(column / samples)]! += share
    })
  }
  return cells
}

/** The side of a glyph cell: unifont's, so a glyph put beside the game's own is as tall and as fine (16 texels in 8 GUI pixels). */
export const GLYPH_CELL = 16

/**
 * How each kind of font is drawn at 16 pixels, picked by eye against unifont (r29c-丁): unifont draws every stroke one pixel wide, so a variable
 * font is read at a light weight and a pixel is set where it is solid or where it is the middle of a thin stroke (a ridge across it), which keeps
 * the thin horizontals of a Song face that a plain threshold drops. `wght` is ignored by a font that does not vary.
 */
export const GLYPH_LOOKS = {
  sans: { wght: 250, low: 0.25 },
  serif: { wght: 400, low: 0.2 },
  other: { wght: 400, low: 0.25 },
} as const

/**
 * One character as the game's pixel glyph: `GLYPH_CELL` rows of `GLYPH_CELL` booleans, its ink moved to the left edge as unifont's are (the
 * game measures a bitmap glyph's advance from its last inked column, so it sits as tight as theirs). Null when the face has no ink for it.
 */
export function pixelGlyph(face: NonNullable<GlyphFace>, code: number, look: { wght: number; low: number }) {
  const id = face.glyph(code)
  if (!id) return null
  const size = GLYPH_CELL
  const cells = coverage(face, face.outline(id, face.coordinates({ wght: look.wght })), size)
  const value = (row: number, column: number) => (row < 0 || column < 0 || row >= size || column >= size ? 0 : cells[row * size + column]!)
  const ink = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
    const own = value(row, column)
    if (own >= 0.8) return true
    if (own < look.low) return false
    // The middle of a stroke one way or the other; a tie goes to the left or upper pixel, so a stroke two half-pixels wide is drawn one wide.
    return (own >= value(row, column - 1) && own > value(row, column + 1)) || (own >= value(row - 1, column) && own > value(row + 1, column))
  }))
  const left = Math.min(...ink.map((line) => line.indexOf(true)).filter((column) => column >= 0))
  if (!Number.isFinite(left)) return null
  return ink.map((line) => [...line.slice(left), ...Array<boolean>(left).fill(false)])
}

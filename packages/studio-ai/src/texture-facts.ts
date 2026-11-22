import { z } from "zod"
import { criterion } from "./acceptance"
import { GAME_PIXELS, MOTION_VISIBLE } from "./model-motion"

/**
 * What can be said about a small flat picture (a block's face, an item's icon) by counting its pixels, with
 * no knowledge of what it is a picture of. These are facts handed to whoever makes and whoever judges it,
 * with every look; none of them is a veto. The one refusal here is copying: a picture that is, pixel for
 * pixel, one of the world's own.
 *
 * "The world's own" is the art of the game the mod is for. Studio ships none of it: when the game is
 * installed on the person's machine a few of its pictures are read at look time to be compared with, and
 * only numbers about them are ever kept (`TextureNote.world`). No imports beyond the standard and the
 * screen arithmetic the motion measure already uses.
 */

export type Picture = { width: number; height: number; pixels: Uint8Array }
/** The two kinds made as one flat picture. */
export const FLAT_KINDS = ["block", "item"] as const
export type FlatKind = (typeof FLAT_KINDS)[number]
export const isFlat = (kind: string): kind is FlatKind => (FLAT_KINDS as readonly string[]).includes(kind)

/**
 * How large a flat picture is on the screen, from the screen and not from the subject. A block is usually
 * looked at from about as far as a creature (`MOTION_VISIBLE`): one of its faces is then `block` screen
 * pixels wide and one pixel of a 16-pixel picture covers `texel` of them; `far` is twice as far away. An
 * item is mostly seen in an inventory slot: the game draws its interface `gui` times enlarged (the largest
 * whole number at which its 320×240 layout still fits the screen), a slot is 18 of those units and the
 * icon in it 16, so the icon is `icon` screen pixels wide; `small` is the same with the interface at half size.
 */
export const TEXTURE_SEEN = ((gui) => ({
  distance: MOTION_VISIBLE.distance,
  texel: Math.round(GAME_PIXELS),
  block: Math.round(GAME_PIXELS) * 16,
  far: Math.round(GAME_PIXELS / 2) * 16,
  gui,
  slot: 18 * gui,
  icon: 16 * gui,
  small: 8 * gui,
}))(Math.min(Math.floor(1920 / 320), Math.floor(MOTION_VISIBLE.screen / 240)))

/**
 * What counts while measuring; these say what a number means and are not limits a picture is held to.
 * `same`: the most two colours may differ on any one channel (of 255) and still be the same colour to the
 * eye at game size. `like`: the same, for "this pixel could be a pixel of the thing it sits in". `stands`: a
 * pixel stands out when it is further from the picture's middle colour than this share of the way to the
 * colour furthest from it, and at least twice `like` (grain of one material, however coarse, does not stand
 * out from itself): the nearer half is the ground and its shading, the farther half is what is drawn on it.
 */
export const TEXTURE_MEASURES = { same: 8, like: 20, stands: 0.5 } as const

/**
 * When a picture is a copy of a reference. Two pictures of the same size, drawn independently, do not
 * agree pixel for pixel: `share` of the pixels within `same` of each other on every channel is a copy,
 * whatever was changed in the rest. A reference with nothing in it to copy (every pixel within `same` of
 * one colour) is not compared.
 */
export const COPY_LIMITS = { share: 0.9, same: TEXTURE_MEASURES.same } as const

const rounded = (value: number, digits = 3) => Number(value.toFixed(digits))
const light = (colour: number) => ((colour >> 16) & 255) * 0.299 + ((colour >> 8) & 255) * 0.587 + (colour & 255) * 0.114
const channels = (colour: number) => [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255] as const
const apart = (a: number, b: number) => Math.max(Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)), Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)), Math.abs((a & 255) - (b & 255)))
/** Every pixel as one number (red, green, blue packed), or -1 where it is transparent. */
const cellsOf = (image: Picture) => Int32Array.from({ length: image.width * image.height }, (_, index) => (image.pixels[index * 4 + 3]! >= 128 ? (image.pixels[index * 4]! << 16) | (image.pixels[index * 4 + 1]! << 8) | image.pixels[index * 4 + 2]! : -1))

/**
 * Which pixels stand out from a picture's middle colour (`TEXTURE_MEASURES.stands`): 1 where one does. A wall shows
 * every block's marks at the same place; whether that reads as a rhythm depends on whether what stands out is one
 * large figure or many small ones.
 */
function standing(cells: Int32Array) {
  const shown = cells.filter((cell) => cell >= 0)
  const ground = [0, 1, 2].map((part) => Array.from(shown, (cell) => channels(cell)[part]!).sort((a, b) => a - b)[shown.length >> 1] ?? 0)
  const away = Array.from(cells, (cell) => (cell < 0 ? 0 : Math.max(...channels(cell).map((value, part) => Math.abs(value - ground[part]!)))))
  return Uint8Array.from(away, (value) => (value > Math.max(TEXTURE_MEASURES.like * 2, Math.max(...away) * TEXTURE_MEASURES.stands) ? 1 : 0))
}

/** The sizes of the separate figures in a mask: groups of touching pixels (corners count, and so do the picture's edges, since it is laid next to itself). */
function figures(mask: Uint8Array, width: number, height: number) {
  const marked = Uint8Array.from(mask)
  const sizes: number[] = []
  marked.forEach((on, start) => {
    if (on !== 1) return
    const open = [start]
    marked[start] = 2
    for (let at = 0; at < open.length; at++)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const next = ((Math.floor(open[at]! / width) + dy + height) % height) * width + (((open[at]! % width) + dx + width) % width)
        if (marked[next] !== 1) continue
        marked[next] = 2
        open.push(next)
      }
    sizes.push(open.length)
  })
  return sizes
}

/**
 * One flat picture, counted. `inside` is the picture of the thing this one sits in, when it has one (a block
 * that generates in rock): how many of this picture's pixels could be pixels of that.
 */
export function measureTexture(image: Picture, inside: Picture | null = null) {
  const cells = cellsOf(image)
  const shown = cells.filter((cell) => cell >= 0)
  const counts = shown.reduce((map, cell) => map.set(cell, (map.get(cell) ?? 0) + 1), new Map<number, number>())
  // The largest upright rectangle of exactly one colour. A patch that merely hangs together (fine grain with one
  // common colour does) is not what the eye reads as a flat shape; a solid rectangle is.
  const tall = new Int32Array(image.width)
  const solid = { value: 0 }
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) tall[x] = cells[y * image.width + x]! >= 0 && y > 0 && cells[(y - 1) * image.width + x] === cells[y * image.width + x] ? tall[x]! + 1 : 1
    for (let x = 0; x < image.width; x++) {
      const colour = cells[y * image.width + x]!
      if (colour < 0) continue
      const low = { value: tall[x]! }
      for (let end = x; end < image.width && cells[y * image.width + end] === colour; end++) {
        low.value = Math.min(low.value, tall[end]!)
        solid.value = Math.max(solid.value, low.value * (end - x + 1))
      }
    }
  }
  const flat = solid.value
  // Neighbours side by side and one above the other, inside the picture; and the same across its edges, as when it is laid next to itself.
  const pairs = { inner: 0, differ: 0, step: 0, gap: 0, seam: 0, across: 0 }
  cells.forEach((cell, index) => {
    const x = index % image.width
    const y = Math.floor(index / image.width)
    for (const [other, wraps] of [
      [cells[y * image.width + ((x + 1) % image.width)]!, x === image.width - 1],
      [cells[((y + 1) % image.height) * image.width + x]!, y === image.height - 1],
    ] as const) {
      if (cell < 0 || other < 0) continue
      const gap = channels(cell).reduce((sum, value, part) => sum + Math.abs(value - channels(other)[part]!), 0) / 3
      if (wraps) {
        pairs.across += 1
        pairs.seam += gap
        continue
      }
      pairs.inner += 1
      pairs.gap += gap
      pairs.step += Math.abs(light(cell) - light(other))
      if (cell !== other) pairs.differ += 1
    }
  })
  const lights = [...counts.keys()].map(light)
  // How far a colour is from grey, 0 to 1: the widest gap between its channels.
  const vivid = (colour: number) => (Math.max(...channels(colour)) - Math.min(...channels(colour))) / 255
  const base = inside && inside.width === image.width && inside.height === image.height ? [...new Set(cellsOf(inside).filter((cell) => cell >= 0))] : null
  const marks = figures(standing(cells), image.width, image.height)
  return {
    width: image.width,
    height: image.height,
    /** Share of the picture that is filled in. */
    opaque: rounded(shown.length / Math.max(1, cells.length)),
    /** Distinct colours, and the share of the filled-in pixels the commonest one has. */
    colours: counts.size,
    top: rounded(Math.max(0, ...counts.values()) / Math.max(1, shown.length)),
    /** The largest solid rectangle of exactly one colour, as a share of the filled-in pixels. */
    flat: rounded(flat / Math.max(1, shown.length)),
    /** From the darkest colour to the lightest, of 255. */
    contrast: Math.round(lights.length ? Math.max(...lights) - Math.min(...lights) : 0),
    /** Share of neighbouring pixels that are not the same colour: low is large flat shapes, high is fine grain. */
    busy: rounded(pairs.differ / Math.max(1, pairs.inner)),
    /** How much lighter or darker a pixel is than its neighbour on average, of 255. */
    step: rounded(pairs.step / Math.max(1, pairs.inner), 1),
    /** How much pixels differ across the picture's edges when it repeats, over how much neighbours differ inside it. 1: no seam. Null when there is nothing to compare (transparent edges, or a picture of one colour). */
    seam: pairs.across && pairs.gap > 0 ? rounded(pairs.seam / pairs.across / (pairs.gap / pairs.inner), 2) : null,
    /** How far from grey the colours are on average (0 to 1), and the most vivid colour that covers at least one pixel in a hundred. */
    vivid: rounded(shown.reduce((sum, cell) => sum + vivid(cell), 0) / Math.max(1, shown.length)),
    peak: rounded(Math.max(0, ...[...counts.entries()].filter((entry) => entry[1] >= shown.length * 0.01).map((entry) => vivid(entry[0])))),
    /**
     * Repetition across a wall. `marks`: how many separate figures stand out from the picture's middle colour; `motif`: the largest of them
     * as a share of the picture. A wall repeats every block's figures at the same place: many small ones read as grain, one large one as
     * the same figure over and over.
     */
    motif: rounded(Math.max(0, ...marks) / Math.max(1, cells.length)),
    marks: marks.length,
    /** Share of the pixels that could be pixels of the thing it sits in; null when it sits in nothing. */
    like: base ? rounded(shown.filter((cell) => base.some((other) => apart(cell, other) <= TEXTURE_MEASURES.like)).length / Math.max(1, shown.length)) : null,
  }
}
export type TextureMeasure = ReturnType<typeof measureTexture>

/**
 * A block may have more than one face for the game to choose from. The game's own way (the lists in its
 * `blockstates/stone.json`, `dirt.json`): every position in the world picks one entry of the block's list, each as
 * likely as the next, from a number worked out of the position alone, so the same place always shows the same one.
 * `extra`: how many pictures a block may carry besides its first. `wall`: how many blocks across and up the wall
 * is that repetition is measured on. `height`: the level that wall stands at; any other place in the world mixes
 * the same pictures in the same proportions, in another arrangement.
 */
export const BLOCK_FACES = { extra: 3, wall: 8, height: 64 } as const

/** What a block lets the game do to its face from place to place, besides choosing among its pictures. */
export type FaceMix = { mirror?: boolean | null; turn?: boolean | null }
/** One entry of a block's list: which picture, flipped left to right or not, and how many quarter turns (clockwise, seen from above) the block is turned. */
export type FaceEntry = { picture: number; mirror: boolean; turn: 0 | 1 | 2 | 3 }

/** A block's list, in the order it is written into the game's files: every turn, within it every picture, plain and then mirrored. */
export const faceEntries = (pictures: number, mix: FaceMix = {}): FaceEntry[] =>
  (mix.turn ? ([0, 1, 2, 3] as const) : ([0] as const)).flatMap((turn) => Array.from({ length: pictures }, (_, picture) => (mix.mirror ? [false, true] : [false]).map((mirror) => ({ picture, mirror, turn }))).flat())

/**
 * Which entry of a list of `count` the game shows for the block at x, y, z: the game's own arithmetic (1.21.1:
 * `MathHelper.hashCode`, the seed of `Random`, the second 32 bits it yields, `WeightedBakedModel.getQuads`), so a
 * picture drawn with it is what the game shows at those places. Held to the game's own classes by a test.
 */
export function facePick(x: number, y: number, z: number, count: number) {
  if (count < 2) return 0
  const long = (value: bigint) => BigInt.asIntN(64, value)
  const mixed = long(long(BigInt(Math.imul(x, 3129871))) ^ long(BigInt(z) * 116129781n) ^ BigInt(y))
  const seed = long(long(mixed * mixed * 42317861n) + long(mixed * 11n)) >> 16n
  const mask = (1n << 48n) - 1n
  const step = (state: bigint) => (state * 0x5deece66dn + 0xbn) & mask
  // The first 32 bits drawn are the high half of the long the game asks for; the entry comes from the low half.
  return Math.abs(Number(BigInt.asIntN(32, step(step((seed ^ 0x5deece66dn) & mask)) >> 16n))) % count
}

/** A picture's standing-out pixels as a block's side face shows them: left to right, or flipped. */
const faced = (mask: Uint8Array, width: number, mirror: boolean) => (mirror ? Uint8Array.from(mask, (_, index) => mask[index - (index % width) + (width - 1 - (index % width))]!) : mask)

/**
 * Repetition across a wall of blocks that have several faces, built the way the game would at `BLOCK_FACES.height`:
 * `same` is the share of neighbouring pairs of blocks (side by side, one above the other) that show the very same face;
 * `marks` and `motif` are what `measureTexture` counts on one picture, counted on what two neighbouring blocks have in
 * common at the same place (the figures both show there, and the largest of them as a share of a block), averaged over
 * every pair. For a block with one face these are 1 and that picture's own `marks` and `motif`. A turn does not show
 * on a wall: all four sides of a turned block wear the picture upright.
 */
export function measureWall(pictures: Picture[], mix: FaceMix = {}) {
  const entries = faceEntries(pictures.length, mix)
  const [width, height] = [pictures[0]!.width, pictures[0]!.height]
  const masks = pictures.map((picture) => standing(cellsOf(picture)))
  const side = BLOCK_FACES.wall
  const worn = Array.from({ length: side * side }, (_, index) => entries[facePick(index % side, BLOCK_FACES.height + Math.floor(index / side), 0, entries.length)]!)
  const pairs = worn.flatMap((entry, index) => [...(index % side < side - 1 ? [index + 1] : []), ...(index + side < worn.length ? [index + side] : [])].map((other) => [entry, worn[other]!] as const))
  // What two faces have in common is the same for every pair that shows those two, so each kind of pair is counted once.
  const known = new Map<string, { marks: number; motif: number }>()
  const common = (a: FaceEntry, b: FaceEntry) => {
    const key = [`${a.picture}${a.mirror}`, `${b.picture}${b.mirror}`].sort().join()
    if (!known.has(key)) {
      const [left, right] = [faced(masks[a.picture]!, width, a.mirror), faced(masks[b.picture]!, width, b.mirror)]
      const sizes = figures(Uint8Array.from(left, (on, index) => on & right[index]!), width, height)
      known.set(key, { marks: sizes.length, motif: Math.max(0, ...sizes) / Math.max(1, width * height) })
    }
    return known.get(key)!
  }
  const found = pairs.map((pair) => common(pair[0], pair[1]))
  return {
    pictures: pictures.length,
    mirror: Boolean(mix.mirror),
    turn: Boolean(mix.turn),
    blocks: worn.length,
    same: rounded(pairs.filter((pair) => pair[0].picture === pair[1].picture && pair[0].mirror === pair[1].mirror).length / Math.max(1, pairs.length)),
    marks: rounded(found.reduce((sum, value) => sum + value.marks, 0) / Math.max(1, found.length), 1),
    motif: rounded(found.reduce((sum, value) => sum + value.motif, 0) / Math.max(1, found.length)),
  }
}

/**
 * How much of a picture is in the colours of the others it shares a block with. `all`: the share of its pixels
 * within `TEXTURE_MEASURES.like` of some colour one of the others uses. `drawn`: the same for the pixels that
 * stand out from its own ground (what is drawn on it), null when nothing does: the ground of two different things
 * that sit in the same rock agrees almost wholly, what is drawn on them does not. Both 1 when it stands alone.
 */
export function agreement(picture: Picture, others: Picture[]) {
  const palette = [...new Set(others.flatMap((other) => [...cellsOf(other).filter((cell) => cell >= 0)]))]
  const cells = cellsOf(picture)
  const shown = cells.filter((cell) => cell >= 0)
  if (!palette.length || !shown.length) return { all: 1, drawn: null }
  const known = new Map<number, boolean>()
  const near = (cell: number) => known.get(cell) ?? (known.set(cell, palette.some((other) => apart(cell, other) <= TEXTURE_MEASURES.like)), known.get(cell)!)
  const marked = standing(cells)
  const drawn = cells.filter((_, index) => marked[index] === 1)
  return { all: rounded(shown.filter(near).length / shown.length), drawn: drawn.length ? rounded(drawn.filter(near).length / drawn.length) : null }
}

/**
 * When the pictures of one block do not belong together, and when one of them adds nothing.
 * `agree`: a picture with less than this share of what is drawn on it (`agreement().drawn`; of all of it when
 * nothing on it stands out) in the others' colours reads as another block mixed in.
 * Why a half, measured with `agreement` on the game's own 1.21.1 pictures: two different things that sit in the
 * same rock, taken two at a time (the eight ores in stone, the eight in deepslate, the two in netherrack: 114
 * pairs) agree in 0 to 0.185 of what is drawn on them (median 0), while their whole pictures agree in 0.68 to
 * 0.91 because the rock is the same, which is why the whole picture is not what is held to the limit. A picture
 * against its own colours is 1. The game itself has no block with several pictures to measure (its lists only
 * mirror and turn one picture), so the upper side is that 1 and the three-picture set of the round-9 proof
 * (1 for each of its pictures); a half lies between the two groups with room on either side. A number to revisit with real sets.
 * `twin`: `COPY_LIMITS.share` of the pixels the same, the measure that already says "this is that picture over again".
 */
export const VARIANT_LIMITS = { agree: 0.5, twin: COPY_LIMITS.share } as const

/** Whether `made` is `reference` over again (`COPY_LIMITS`): the share of pixels that agree, when that is a copy; else null. */
export function copied(made: Picture, reference: Picture) {
  if (!sameSize(made, reference)) return null
  const shown = cellsOf(reference).filter((cell) => cell >= 0)
  if (!shown.length || shown.every((cell) => apart(cell, shown[0]!) <= COPY_LIMITS.same)) return null
  const share = pixelShare(made, reference)
  return share >= COPY_LIMITS.share ? rounded(share) : null
}
const sameSize = (a: Picture, b: Picture) => a.width === b.width && a.height === b.height
/** The share of the places where two pictures of one size show the same colour (`COPY_LIMITS.same`), or are both empty. */
function pixelShare(made: Picture, reference: Picture) {
  const theirs = cellsOf(reference)
  const ours = cellsOf(made)
  return ours.filter((cell, index) => (cell < 0 || theirs[index]! < 0 ? cell < 0 && theirs[index]! < 0 : apart(cell, theirs[index]!) <= COPY_LIMITS.same)).length / ours.length
}

/**
 * Round 17: how much two pictures of one size have the same outline: the places both fill in, over the places either
 * does. 1: the same outline; 0: nothing in common. Colour plays no part. Null for pictures of different sizes.
 */
export function outlineOverlap(a: Picture, b: Picture) {
  if (!sameSize(a, b)) return null
  const [ours, theirs] = [cellsOf(a), cellsOf(b)]
  const either = ours.filter((cell, index) => cell >= 0 || theirs[index]! >= 0).length
  return either ? rounded(ours.filter((cell, index) => cell >= 0 && theirs[index]! >= 0).length / either, 2) : null
}

const Share = z.number().min(0).max(1)
const Range = z.tuple([z.number().min(0), z.number().min(0)])

/**
 * What was measured on one version of a flat picture, kept with the round it was looked at in. `world` is
 * the same numbers for the game's own pictures it was compared with, as ranges: numbers and names only,
 * never a pixel of them. Absent in records from before flat pictures were looked at.
 */
const MeasureShape = {
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  opaque: Share,
  colours: z.number().int().min(0),
  top: Share,
  flat: Share,
  contrast: z.number().min(0).max(255),
  busy: Share,
  step: z.number().min(0).max(255),
  seam: z.number().min(0).nullable(),
  vivid: Share,
  peak: Share,
  like: Share.nullable(),
  /** Absent in records from before repetition across a wall was measured. */
  motif: Share.optional(),
  marks: z.number().int().min(0).optional(),
}
/** What is said of each picture of a block that has several: how far it is in the others' colours (`agreement`), and which earlier picture it is over again (1 is the first), if any. */
const AmongShape = { agree: Share, drawn: Share.nullable(), twin: z.number().int().min(1).nullable() }
export const TextureNoteSchema = z.strictObject({
  ...MeasureShape,
  /** What the block sits in, when the comparison was made: in the person's words when Studio has them, else by the name the game gives it. */
  inside: z.string().max(80).nullable(),
  world: z
    .strictObject({
      /** The game's own pictures compared with, by the names the game gives them. */
      names: z.array(z.string().max(80)).max(12),
      colours: Range,
      flat: Range,
      contrast: Range,
      busy: Range,
      peak: Range,
      opaque: Range,
      /** The same for the game's own things that sit in the same rock; null when there are none. */
      like: Range.nullable(),
      /** Absent in records from before these were compared; `seam` is null when none of the references has a seam to measure. */
      seam: Range.nullable().optional(),
      motif: Range.optional(),
      marks: Range.optional(),
      /**
       * J2: the same numbers for the broad family of the game's own things this one belongs to (`FAMILY_LIMITS`): what a
       * measure is held against. `label` says in the person's words what family it is; `count` how many pictures were
       * measured, `like_count` and `seam_count` how many of them had that measure at all. Absent in records from before
       * a family was measured, and when nothing of the family could be read.
       */
      family: z
        .strictObject({ label: z.string().max(80), count: z.number().int().min(0), colours: Range, flat: Range, contrast: Range, busy: Range, peak: Range, opaque: Range, motif: Range, marks: Range, like: Range.nullable(), like_count: z.number().int().min(0), seam: Range.nullable(), seam_count: z.number().int().min(0), /** Round 17: every member's outline against the member nearest to it that is not the same outline over again (`outlineOverlap`); absent in older records and when no two members differ. */ outline: Range.optional() })
        .optional(),
    })
    .nullable(),
  /**
   * Round 17: the member of the family whose outline this picture's is nearest to (`outlineOverlap`), by the game's name for it, and how much
   * the two overlap. A fact only, never held against the picture: a new thing has a new outline. Absent for a picture that fills its whole
   * square (a block's face has no outline), without a family, and in older records.
   */
  outline: z.strictObject({ name: z.string().max(80), share: Share }).optional(),
  /** The reference this picture is a copy of (`COPY_LIMITS`), by name; null when it is its own. For a block with several pictures: the first of them that is a copy. */
  copy: z.string().max(80).nullable(),
  /** A block with more pictures than one: the numbers above are the first picture's, these are the others', in order, and `among` is the first's place among them. Absent for one picture. */
  variants: z.array(z.strictObject({ ...MeasureShape, ...AmongShape })).max(BLOCK_FACES.extra).optional(),
  among: z.strictObject(AmongShape).optional(),
  /** A block the game shows differently from place to place (several pictures, a mirror, a turn): repetition as measured on a wall of it (`measureWall`). Absent otherwise. */
  wall: z
    .strictObject({ pictures: z.number().int().min(1), mirror: z.boolean(), turn: z.boolean(), blocks: z.number().int().min(1), same: Share, marks: z.number().min(0), motif: Share })
    .optional(),
})
export type TextureNote = z.infer<typeof TextureNoteSchema>

const span = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)]

/**
 * J2: the broad family of the game's own things a picture is measured against: every member with the thing it
 * sits in, when it sits in one (an ore in its own rock), so "how much of it is rock" is asked of each against its own.
 */
export type WorldFamily = { label: string; pictures: readonly { name: string; image: Picture; inside?: Picture | null }[] }

/**
 * One version's note: its own numbers, the ranges of the few references it was looked at beside, and (J2) the
 * ranges of the broad family those references are a handful of, which is what its measures are held against.
 */
export function textureNote(made: Picture, references: { name: string; image: Picture }[] = [], inside: { name: string; image: Picture; label?: string } | null = null, more: Picture[] = [], mix: FaceMix = {}, family: WorldFamily | null = null): TextureNote {
  const own = measureTexture(made, inside?.image)
  const all = [made, ...more]
  // Each picture among the others of its block, and whether it is an earlier one over again.
  const among = (index: number) => ({ ...((found) => ({ agree: found.all, drawn: found.drawn }))(agreement(all[index]!, all.filter((_, other) => other !== index))), twin: ((twin) => (twin < 0 ? null : twin + 1))(all.slice(0, index).findIndex((earlier) => sameSize(earlier, all[index]!) && pixelShare(all[index]!, earlier) >= VARIANT_LIMITS.twin)) })
  const others = references.map((reference) => measureTexture(reference.image, inside && reference.name !== inside.name ? inside.image : null))
  const sitting = others.flatMap((other) => (other.like === null ? [] : [other.like]))
  const seams = others.flatMap((other) => (other.seam === null ? [] : [other.seam]))
  const kin = (family?.pictures ?? []).map((member) => measureTexture(member.image, member.inside ?? null))
  // Round 17: outlines. Each member against the nearest member that is not its own outline over again (the same thing in another material is);
  // and this picture against the nearest member. Only for a picture with an outline: one that leaves some of its square empty.
  const members = family?.pictures ?? []
  const nearest = (picture: Picture, among: readonly { name: string; image: Picture }[]) => among.map((member) => ({ name: member.name, share: outlineOverlap(picture, member.image) })).filter((found): found is { name: string; share: number } => found.share !== null).sort((left, right) => right.share - left.share)[0]
  const apartOutlines = own.opaque < 1 ? members.flatMap((member) => ((found) => (found ? [found.share] : []))(nearest(member.image, members.filter((other) => other !== member && (outlineOverlap(member.image, other.image) ?? 1) < COPY_LIMITS.share)))) : []
  const outline = own.opaque < 1 ? nearest(made, members) : undefined
  const kinLike = kin.flatMap((other) => (other.like === null ? [] : [other.like]))
  const kinSeams = kin.flatMap((other) => (other.seam === null ? [] : [other.seam]))
  return {
    ...own,
    inside: inside ? (inside.label ?? inside.name).slice(0, 80) : null,
    world: others.length
      ? {
          names: references.slice(0, 12).map((reference) => reference.name.slice(0, 80)),
          colours: span(others.map((other) => other.colours)),
          flat: span(others.map((other) => other.flat)),
          contrast: span(others.map((other) => other.contrast)),
          busy: span(others.map((other) => other.busy)),
          peak: span(others.map((other) => other.peak)),
          opaque: span(others.map((other) => other.opaque)),
          like: sitting.length ? span(sitting) : null,
          seam: seams.length ? span(seams) : null,
          motif: span(others.map((other) => other.motif)),
          marks: span(others.map((other) => other.marks)),
          ...(family && kin.length
            ? {
                family: {
                  label: family.label.slice(0, 80),
                  count: kin.length,
                  colours: span(kin.map((other) => other.colours)),
                  flat: span(kin.map((other) => other.flat)),
                  contrast: span(kin.map((other) => other.contrast)),
                  busy: span(kin.map((other) => other.busy)),
                  peak: span(kin.map((other) => other.peak)),
                  opaque: span(kin.map((other) => other.opaque)),
                  motif: span(kin.map((other) => other.motif)),
                  marks: span(kin.map((other) => other.marks)),
                  like: kinLike.length ? span(kinLike) : null,
                  like_count: kinLike.length,
                  seam: kinSeams.length ? span(kinSeams) : null,
                  seam_count: kinSeams.length,
                  ...(apartOutlines.length ? { outline: span(apartOutlines) } : {}),
                },
              }
            : {}),
        }
      : null,
    ...(outline && others.length ? { outline: { name: outline.name.slice(0, 80), share: outline.share } } : {}),
    // A copy of any of the game's own it was measured against is a copy, whether or not that one was put in the picture.
    copy: [...references, ...(family?.pictures ?? [])].find((reference) => all.some((picture) => copied(picture, reference.image) !== null))?.name.slice(0, 80) ?? null,
    ...(more.length ? { variants: more.map((picture, index) => ({ ...measureTexture(picture, inside?.image), ...among(index + 1) })), among: among(0) } : {}),
    ...(more.length || mix.mirror || mix.turn ? { wall: measureWall(all.filter((picture) => sameSize(picture, made)), mix) } : {}),
  }
}

/**
 * How far past the nearest end of the neighbours' range a measure has to lie before it counts as outside
 * the world's own range: a quarter of that end's own value (below `low × 0.75`, or above `high × 1.25`).
 *
 * Why a ratio: the measures have different units (counts, shares, steps of 255), and the eye compares
 * amounts by proportion (twice as flat, half as busy), so one proportion serves all of them.
 * Why a quarter: (1) the range comes from some of the game's pictures (a few dozen of one broad family,
 * `FAMILY_LIMITS`; five put beside the thing, in records from before round 10), so its ends are not the
 * game's limits and a value just past one says nothing; (2) on a 16×16 picture
 * one pixel is 0.4% of it, and the smallest ranges met (the largest flat shape, 2% to 4%: five to ten
 * pixels) need a quarter to be more than a pixel or two; (3) on the one real case this was written for
 * (round 6's ore), what a person saw at once lay at 0.62 of the low end (neighbouring pixels that differ,
 * 37% against 60–83%) and 1.75 of the high end (largest flat shape, 7% against 2–4%), and what nobody
 * objected to lay within 8% of an end (15 colours against 4–14; 88% rock-coloured against 77–82%). A
 * quarter sits between the two groups with room on either side. It is one case: a number to revisit
 * when more real pictures have gone through it, not a law.
 */
export const OUTSIDE_MARGIN = 0.25

/**
 * J2: when a range is a range. The few pictures put beside a thing are its own kind (a pickaxe beside the
 * game's five pickaxes), and pictures of one kind are one picture in several colours: round 8's real pickaxe
 * was held to "largest flat shape 7% to 7%" and "neighbours that differ 80% to 82%", and six honest versions
 * could not get into that sliver. So a measure is held against the broad family the thing belongs to
 * (`WorldFamily`: every hand-held tool of every kind and material; every rock and everything that sits in
 * one), and against that only when it is a range at all:
 * - `least`: with fewer pictures than this nothing is held, the numbers are facts only. A new picture drawn
 *   from the very same population as n others falls outside what those n span 2 times in n + 1; at twelve
 *   that is under one time in six before any margin, at the five put beside a thing it is one in three.
 * - a spread narrower than the margin itself is a point: when the family's highest value is not at least
 *   `OUTSIDE_MARGIN` above its lowest (`high - low < OUTSIDE_MARGIN × high`), its members agree with each
 *   other more closely than the room a newcomer is given past either end, so "outside" would mean "not
 *   identical". Such a measure is a fact only. No number of its own: it is the margin, used on the range itself.
 * - `outsideStep`: a value is outside only when it is past the end by more than one pixel of this picture can
 *   make on that measure (one more colour, one more pixel in the largest flat shape). On an icon that fills
 *   seventy pixels a flat shape of two pixels against three is 2.7% against 4.1%: a quarter apart, one pixel apart.
 */
export const FAMILY_LIMITS = { least: 12 } as const

/** True when a family's range of one measure can be held against: enough pictures had the measure, and they do not all but agree. */
export const isRange = (range: readonly [number, number] | null | undefined, count: number): range is readonly [number, number] => Boolean(range) && count >= FAMILY_LIMITS.least && range![1] - range![0] >= OUTSIDE_MARGIN * range![1]

/** The words for a measure outside the world's range, and for a sheet that says it is meant to be. */
export const OUTSIDE_WORDS = { mark: "在原版的范围以外", meant: "它本来就该和原版不一样" } as const

/** The same two for what is measured between the pictures of one block, where the game's own art is not what it is held to. */
export const AMONG_WORDS = { mark: "几张图不是一套", meant: "它本来就该这样" } as const

/** A sheet's declarations that this picture is meant to differ from the game's own, each naming a measure. Structural, so `making.ts` need not be imported here. */
type Declared = { differs?: readonly { measure: string; reason: string }[] } | null | undefined

/** The name of the one picture that sets a thing among the game's own, as it is written on it. */
const WORLD_SHEET = "和原版放在一起"

const percent = (value: number) => (value > 0 && value < 0.01 ? "不到 1%" : `${Math.round(value * 100)}%`)
const between = (range: readonly [number, number], say: (value: number) => string = String) => (say(range[0]) === say(range[1]) ? say(range[0]) : `${say(range[0])} 到 ${say(range[1])}`)
const WORLD = { block: "周围的原版方块", item: "原版物品" } as const
const SUBJECT = { block: "这张贴图", item: "这个图标" } as const

/** Said when the game's own art could not be read on this machine, so nothing was compared. */
export const NO_WORLD_WORDS = "这台电脑上还读不到游戏本体的贴图（工程还没有构建过，也没有打开过测试场；构建一次或者打开一次测试场就有了），所以这次没有原版的东西可以放在旁边对照，下面只有它自己量出来的数。"

/**
 * The note in sentences, each under the criterion it bears on: what a maker and a reviewer are told with
 * the pictures. Facts, not verdicts — what follows from them is for whoever looks to say.
 */
export function textureLines(kind: FlatKind, note: TextureNote, sheet: Declared = null) {
  const world = note.world
  const texel = (TEXTURE_SEEN.block / note.width).toFixed(TEXTURE_SEEN.block % note.width ? 1 : 0)
  return [
    kind === "block"
      ? `${criterion("reads").name}：按游戏里常见的距离（离它大约 ${TEXTURE_SEEN.distance} 格），一格方块在 1080p 的屏幕上约 ${TEXTURE_SEEN.block} 个像素宽，这张 ${note.width}×${note.height} 的贴图上一个像素约占 ${texel} 个屏幕像素；好不好看以「游戏里的实际大小」和「砌成一面墙」那两格为准，不以放大的那一格为准。`
      : `${criterion("reads").name}：背包格子里图标只有 ${TEXTURE_SEEN.icon}×${TEXTURE_SEEN.icon} 个屏幕像素（界面小一号时 ${TEXTURE_SEEN.small}×${TEXTURE_SEEN.small}），这张 ${note.width}×${note.height} 的图填了格子的 ${percent(note.opaque)}${world ? `（${WORLD.item}填了 ${between(world.opaque, percent)}）` : ""}；认不认得出以「背包格子里的实际大小」那两格为准，不以放大的那一格为准。`,
    `${criterion("hierarchy").name}：${SUBJECT[kind]}用了 ${note.colours} 种颜色（最多的一种占 ${percent(note.top)}），最大的一整块纯色（方方正正的一块）占 ${percent(note.flat)}，最暗到最亮相差 ${note.contrast}（满格 255）` +
      (world ? `；${WORLD[kind]}（${world.names.length} 张）是 ${between(world.colours)} 种颜色，最大的纯色块占 ${between(world.flat, percent)}，明暗相差 ${between(world.contrast)}。` : "。"),
    `${criterion("not_mechanical").name}：相邻的两个像素有 ${percent(note.busy)} 颜色不一样（越低越是大块平涂，越高越细碎）${world ? `，${WORLD[kind]}是 ${between(world.busy, percent)}` : ""}` +
      (kind === "block" ? (note.seam === null ? "；铺开以后的接缝量不出来（整张只有一种颜色）。" : `；一张挨一张铺开时，接缝两边的差别是图里面相邻像素的 ${note.seam} 倍（接近 1 看不出接缝，明显大于 1 会看出一格一格的线）${world?.seam ? `，${WORLD.block}是 ${between(world.seam)} 倍` : ""}。`) : "。") +
      (kind === "block" && note.motif !== undefined && note.marks !== undefined
        ? note.wall
          ? wallWords(note as TextureNote & { wall: NonNullable<TextureNote["wall"]> })
          : `砌成墙以后，每一块上的图案都出现在同一个位置：这张贴图上显眼的图案（和底色差得远、连在一起的像素）有 ${note.marks} 处，最大的一处占整张图的 ${percent(note.motif)}（处数少、最大的一处又大，墙上越看得出同一个图案在一格一格地重复）` +
            (world?.motif && world.marks ? `，${WORLD.block}有 ${between(world.marks)} 处，最大的一处占 ${between(world.motif, percent)}。` : "。") +
            // One picture can only be made less striking; the same figure still stands at the same place on every block.
            (note.marks > 0 && !outsideWorld(kind, note).some((found) => found.measure === "motif") ? VARIANT_HINT(world?.motif !== undefined) : "")
        : ""),
    ...(world || note.like !== null
      ? [
          `${criterion("fits").name}：最鲜艳的颜色离灰色有 ${percent(note.peak)} 远${world ? `，${WORLD[kind]}最鲜艳的是 ${between(world.peak, percent)}` : ""}` +
            (note.like !== null && note.inside ? `；它长在「${note.inside}」里，贴图上有 ${percent(note.like)} 的像素和「${note.inside}」自己的颜色相近${world?.like ? `，原版里长在同一种石头里的方块是 ${between(world.like, percent)}` : ""}。` : "。"),
        ]
      : []),
    ...(kind === "block" && note.variants?.length && note.among ? amongLines(note as TextureNote & { variants: NonNullable<TextureNote["variants"]>; among: NonNullable<TextureNote["among"]> }) : []),
    ...(world?.family ? [familyLine(kind, world.names.length, world.family)] : []),
    ...(kind === "item" && note.outline && world?.family ? [outlineLine(note.outline, world.family)] : []),
    ...outsideWorld(kind, note).map((found) => ((reason) => `${found.fix ? AMONG_WORDS.mark : OUTSIDE_WORDS.mark}（${found.name}）：${found.words}。${reason === null ? "" : `部件说明里声明了「${found.fix ? AMONG_WORDS.meant : OUTSIDE_WORDS.meant}」（${reason}）。`}`)(differsReason(sheet, found))),
  ]
}

type Family = NonNullable<NonNullable<TextureNote["world"]>["family"]>
/** How many of a family's pictures had one measure at all. */
const familyCount = (family: Family, id: ComparedMeasure) => (id === "like" ? family.like_count : id === "seam" ? family.seam_count : family.count)
/** A family as the sentences name it. */
const familyName = (family: Family) => `${family.label}（${family.count} 张）`

/**
 * J2: what the measures are held against, said once with every look: the family, how many pictures of it were
 * measured, its range of every measure that is compared for this kind, and which of them are facts only and why
 * (too few pictures; or a range that is a point, `isRange`).
 */
function familyLine(kind: FlatKind, beside: number, family: Family) {
  const measures = COMPARED.filter((measure) => (measure.kinds as readonly FlatKind[]).includes(kind) && family[measure.id])
  const spanned = (measure: (typeof COMPARED)[number]) => `${between(family[measure.id]!, PERCENT.includes(measure.id) ? percent : String)}${measure.id === "colours" ? " 种" : measure.id === "seam" ? " 倍" : ""}`
  const said = (measure: (typeof COMPARED)[number]) => `${measure.name} ${spanned(measure)}`
  const few = family.count < FAMILY_LIMITS.least
  const held = measures.filter((measure) => isRange(family[measure.id], familyCount(family, measure.id)))
  const points = few ? [] : measures.filter((measure) => !held.includes(measure))
  return (
    `对照的范围：摆在旁边的 ${beside} 张是和它最像的几样，只用来对着看；一项量出来算不算「${OUTSIDE_WORDS.mark}」，按${familyName(family)}量出来的范围算` +
    (few
      ? `。这一类只读到 ${family.count} 张，不到 ${FAMILY_LIMITS.least} 张，量出来的范围不可靠：这次所有的数都只当事实说，不拿来要求它。（${measures.map(said).join("，")}）`
      : `：${held.map(said).join("，")}。` +
        (points.length ? `另外${points.map((measure) => `「${measure.name}」（${spanned(measure)}）`).join("、")}这${points.length > 1 ? "几" : "一"}项，它们彼此几乎一样（最高和最低相差不到 ${Math.round(OUTSIDE_MARGIN * 100)}%，或者有这一项的不到 ${FAMILY_LIMITS.least} 张），是一个点不是一个范围：只当事实说，不拿来要求它。` : ""))
  )
}
/**
 * Round 17: the outline as a fact, and why it is only that. The measures above are of colour and grain; an icon the owner
 * could not recognise passed all of them, because none is of shape. What can be measured of shape without knowing the
 * subject is how much its outline overlaps the game's own: the nearest member of its family, set beside how much the
 * family's different outlines overlap each other. It is not held against the picture (no finding, no gate): the family
 * cannot tell two of its own kinds apart by it (in 1.21.1 a pickaxe and a hoe overlap 68%, the most of any two kinds;
 * a sword and a shovel 43%, the least), and a thing the game does not have rightly overlaps none of them. It is said
 * so that a maker sees, before any review, when a thing of a kind the game has shares less outline with all of that
 * kind than the game's different kinds share with one another: the question a blind naming then asks.
 */
function outlineLine(outline: NonNullable<TextureNote["outline"]>, family: Family) {
  return (
    `${criterion("reads").name}：轮廓（只当事实说，不拿来要求它）——这个图标填了的格子，和${familyName(family)}里轮廓最接近的一张（原版 · ${outline.name}）重合 ${percent(outline.share)}（两张都填了的格子 ÷ 至少一张填了的格子，一模一样是 100%）` +
    (family.outline ? `；这一大类里轮廓不一样的东西，每一张和最接近它的另一张重合 ${between(family.outline, percent)}。` : "。") +
    `重合低不等于不好：原版里没有的东西，轮廓本来就和它们都不像。但它要是原版里有的那一类东西，重合却比原版里不同种类之间还低，就对着「只看轮廓」和实际大小的那几格再看一眼：不知道名字的人会把它认成什么。`
  )
}

/** The measures that are shares and read as percentages. */
const PERCENT: readonly ComparedMeasure[] = ["opaque", "flat", "busy", "motif", "peak", "like"]

/**
 * J2: the least a value has to lie past the end of a range to be outside it, whatever the margin says: what one
 * pixel of this picture can make on that measure. One colour; one pixel of the filled-in part for a share of it;
 * one pixel of the whole picture for a share of that.
 */
const outsideStep = (id: ComparedMeasure, own: { width: number; height: number; opaque: number }) =>
  id === "colours" ? 1 : id === "flat" || id === "like" ? 1 / Math.max(1, own.opaque * own.width * own.height) : id === "opaque" || id === "motif" ? 1 / (own.width * own.height) : 0

/** Told with a block of one picture whose repetition is no worse than the game's own: the way to break what is left of it. */
const VARIANT_HINT = (compared: boolean) =>
  `这一张自己量出来的重复${compared ? "已经不比对照的那几张显眼" : "只能靠这几个数来看"}；砌成墙以后还是嫌同一个图案一格一格地重复，再改这一张解决不了：给这个方块的 variants 里再放 1 到 ${BLOCK_FACES.extra} 张同一种材质、图案位置不一样的图，或者把 random_mirror（随机左右镜像）、random_turn（随机转向，只在顶面和底面看得出来）写成 true，游戏会在每个位置随机用其中一种。`

/** How many ways a block can look on a wall: each of its pictures, and each mirrored when it may be. */
const looks = (wall: NonNullable<TextureNote["wall"]>) => wall.pictures * (wall.mirror ? 2 : 1)

/** Repetition as measured on a wall of a block the game shows differently from place to place. */
function wallWords(note: TextureNote & { wall: NonNullable<TextureNote["wall"]> }) {
  const wall = note.wall
  const side = Math.round(Math.sqrt(wall.blocks))
  return (
    `砌成墙以后，游戏在每个位置从这个方块的 ${looks(wall)} 种样子里随机用一种（${wall.pictures} 张图${wall.mirror ? "，每张有正的和左右镜像的" : ""}；每种的机会一样，同一个位置永远是同一种${wall.turn ? "；另外还会随机转向，转向只在顶面和底面看得出来，四周的面不变" : ""}）。` +
    `按游戏自己的挑法砌一面 ${side}×${side} 的墙量出来（图上那几面墙就是这样砌的；换一个地方，排法不同，比例一样）：相邻两块长得完全一样的占 ${percent(wall.same)}（只有一种样子时是 100%）；相邻两块在同一个位置上都有的显眼图案平均 ${wall.marks} 处，最大的一处平均占一块的 ${percent(wall.motif)}（只用第 1 张时是 ${note.marks} 处、${percent(note.motif ?? 0)}）` +
    (note.world?.motif && note.world.marks ? `，${WORLD.block}（每个都只有一张图）有 ${between(note.world.marks)} 处，最大的一处占 ${between(note.world.motif, percent)}。` : "。")
  )
}

/** Which picture of a block is meant, counted the way the person counts them. */
const pictureName = (index: number) => (index === 0 ? "第 1 张图（texture）" : `第 ${index + 1} 张图（variants 的第 ${index} 张）`)

/** One sentence for each picture of a block that has several: its own counts, and how far it is in the others' colours. */
function amongLines(note: TextureNote & { variants: NonNullable<TextureNote["variants"]>; among: NonNullable<TextureNote["among"]> }) {
  const said = (among: NonNullable<TextureNote["among"]>) => `和其余几张比，${among.drawn === null ? `它整张图有 ${percent(among.agree)} 的像素` : `它上面显眼的图案有 ${percent(among.drawn)} 的像素（整张图是 ${percent(among.agree)}）`}用的是其余几张也有的颜色${among.twin === null ? "" : `；它和第 ${among.twin} 张几乎一模一样`}`
  return [
    `${criterion("fits").name}：这个方块一共 ${note.variants.length + 1} 张图，游戏会混着用，所以它们要像同一种东西。上面几句量的是${pictureName(0)}：${said(note.among)}。`,
    ...note.variants.map(
      (variant, index) =>
        `${pictureName(index + 1)}：${variant.colours} 种颜色，最大的纯色块占 ${percent(variant.flat)}，明暗相差 ${variant.contrast}，相邻的两个像素有 ${percent(variant.busy)} 颜色不一样${variant.seam === null ? "" : `，接缝是 ${variant.seam} 倍`}${variant.like !== null && note.inside ? `，${percent(variant.like)} 的像素和「${note.inside}」的颜色相近` : ""}；${said(variant)}。`,
    ),
  ]
}

/** The same for the person, in a sentence or two: what it has, and what the world around it has. The rest is behind 高级. */
export function texturePlain(kind: FlatKind, note: TextureNote, sheet: Declared = null) {
  const world = note.world
  // J2: the person is told the range the thing is held against, which is the family's when one was measured.
  const held = world?.family ?? world
  return [
    `${SUBJECT[kind]}有 ${note.colours} 种颜色，最大的一整块纯色占了 ${percent(note.flat)}` + (held ? `；${world?.family ? world.family.label : WORLD[kind]}有 ${between(held.colours)} 种颜色，最大的纯色块占 ${between(held.flat, percent)}。` : "。"),
    ...(note.like !== null && note.inside && world?.like ? [`它长在「${note.inside}」里，贴图上和「${note.inside}」颜色相近的像素有 ${percent(note.like)}；原版里长在同一种石头里的方块是 ${between(world.like, percent)}。`] : []),
    ...(note.wall ? [`这个方块在游戏里有 ${looks(note.wall)} 种样子，每个位置随机用一种${note.wall.turn ? "，顶面还会随机转向" : ""}：砌成墙以后，相邻两块长得完全一样的占 ${percent(note.wall.same)}（只有一种样子时每一块都一样）。`] : []),
    ...(world ? [] : ["这次没有原版的东西可以对照。"]),
    ...outsideWorld(kind, note).map((found) => ((reason) => `${found.fix ? "这个方块的几张图放在一起看" : "和原版放在一起看"}，${found.plain}。${reason === null ? "" : `AI 说${found.fix ? AMONG_WORDS.meant : OUTSIDE_WORDS.meant}：${reason}`}`)(differsReason(sheet, found))),
  ]
}

/**
 * Every measure that has a range to be held against, with the criterion it bears on and what lying below
 * or above the range looks like beside the game's own (`low` / `high`; absent when that side is no fault:
 * a seam fainter than the game's, a figure smaller than the game's). Nothing here says how to draw.
 */
const COMPARED = [
  { id: "opaque", kinds: ["item"], criterion: "reads", name: "图标填了格子的多少", low: "它在格子里比原版的都小一截", high: "它把格子填得比原版的都满一截" },
  { id: "colours", kinds: FLAT_KINDS, criterion: "hierarchy", name: "颜色的种数", low: "它的颜色比原版的都少一截，显得单调", high: "它的颜色比原版的都多一截，显得花" },
  { id: "flat", kinds: FLAT_KINDS, criterion: "hierarchy", name: "最大的纯色块", low: "它没有原版那样成片的颜色，显得更碎", high: "它有一整块平涂的颜色比原版的都大一截，显得平" },
  { id: "contrast", kinds: FLAT_KINDS, criterion: "hierarchy", name: "明暗相差", low: "它的明暗比原版的都平一截，显得发灰", high: "它的明暗比原版的都强一截，显得扎眼" },
  { id: "busy", kinds: FLAT_KINDS, criterion: "not_mechanical", name: "相邻像素的差别", low: "它比原版的都平一截，是大块的平涂", high: "它比原版的都碎一截，像噪点" },
  { id: "seam", kinds: ["block"], criterion: "not_mechanical", name: "接缝", high: "铺开以后它的接缝比原版的都明显一截，会看出一格一格的线" },
  { id: "motif", kinds: ["block"], criterion: "not_mechanical", name: "墙上的重复", high: "砌成墙以后同一个图案在每一块的同一个位置原样出现，比原版的重复显眼一截" },
  { id: "peak", kinds: FLAT_KINDS, criterion: "fits", name: "最鲜艳的颜色", low: "它比原版的都灰一截", high: "它比原版的都鲜艳一截，显得跳" },
  { id: "like", kinds: ["block"], criterion: "fits", name: "和所在石头相近的像素", low: "它比原版里长在同一种石头里的方块都不像这种石头，不像是长在里面的", high: "它比原版里长在同一种石头里的方块都更像石头本身，它自己的东西露出来的比它们少一截" },
] as const satisfies readonly { id: string; kinds: readonly FlatKind[]; criterion: Parameters<typeof criterion>[0]; name: string; low?: string; high?: string }[]
export type ComparedMeasure = (typeof COMPARED)[number]["id"]

/**
 * The measures of this picture that lie outside the range of the game's own it was compared with, by more
 * than `OUTSIDE_MARGIN`. Empty without a comparison. `words` is the fact with its numbers under the
 * criterion's name; `plain` the same for the person, without numbers.
 */
export function outsideWorld(kind: FlatKind, note: TextureNote): OutsideFound[] {
  const world = note.world
  const wall = kind === "block" ? note.wall : undefined
  const pictures = [note, ...(kind === "block" ? (note.variants ?? []) : [])]
  // Pictures of one block that do not belong together, or that are one picture twice: nothing of the world is needed to say so.
  const among = pictures.length > 1 ? [note.among, ...(note.variants ?? [])].flatMap((found, index): OutsideFound[] => (found ? [...apartFound(found, index), ...twinFound(found, index)] : [])) : []
  if (!world) return among
  // J2: held against the broad family when one was measured (records from before that are held against the few beside it, as they were).
  const family = world.family
  const who = family ? familyName(family) : WORLD[kind]
  const marked = (family ?? world).marks
  const compared = pictures.flatMap((own, index) => {
    const subject = pictures.length > 1 ? pictureName(index) : SUBJECT[kind]
    const numbers: Record<ComparedMeasure, { value: number | null | undefined; range: readonly [number, number] | null | undefined; fact: (value: string, range: string) => string; say?: (value: number) => string }> = {
      opaque: { value: own.opaque, range: (family ?? world).opaque, say: percent, fact: (value, range) => `${subject}填了格子的 ${value}，${who}填了 ${range}` },
      colours: { value: own.colours, range: (family ?? world).colours, fact: (value, range) => `${subject}用了 ${value} 种颜色，${who}是 ${range} 种` },
      flat: { value: own.flat, range: (family ?? world).flat, say: percent, fact: (value, range) => `${subject}最大的一整块纯色占 ${value}，${who}是 ${range}` },
      contrast: { value: own.contrast, range: (family ?? world).contrast, fact: (value, range) => `${subject}最暗到最亮相差 ${value}（满格 255），${who}是 ${range}` },
      busy: { value: own.busy, range: (family ?? world).busy, say: percent, fact: (value, range) => `${subject}相邻的两个像素有 ${value} 颜色不一样，${who}是 ${range}` },
      seam: { value: own.seam, range: (family ?? world).seam, fact: (value, range) => `${subject}铺开时接缝两边的差别是图里面相邻像素的 ${value} 倍，${who}是 ${range} 倍` },
      // A block the game mixes is held to what its wall repeats, once, and not to what any one of its pictures has.
      motif: wall
        ? { value: index === 0 ? wall.motif : null, range: (family ?? world).motif, say: percent, fact: (value, range) => `按游戏的混法砌成墙，相邻两块在同一个位置上都有的显眼图案平均 ${wall.marks} 处，最大的一处平均占一块的 ${value}，${who}${marked ? `有 ${between(marked)} 处，` : ""}最大的一处占 ${range}` }
        : { value: own.motif, range: (family ?? world).motif, say: percent, fact: (value, range) => `${subject}上显眼的图案${own.marks === undefined ? "" : `有 ${own.marks} 处，`}最大的一处占整张图的 ${value}，${who}${marked ? `有 ${between(marked)} 处，` : ""}最大的一处占 ${range}` },
      peak: { value: own.peak, range: (family ?? world).peak, say: percent, fact: (value, range) => `${subject}最鲜艳的颜色离灰色有 ${value} 远，${who}最鲜艳的是 ${range}` },
      like: { value: note.inside ? own.like : null, range: (family ?? world).like, say: percent, fact: (value, range) => `${subject}有 ${value} 的像素和「${note.inside}」自己的颜色相近，${family ? `${who}里长在岩石里的那些（各自和自己那种岩石比）` : "原版里长在同一种石头里的方块"}是 ${range}` },
    }
    return COMPARED.flatMap((measure): OutsideFound[] => {
      const found = numbers[measure.id]
      if (!(measure.kinds as readonly FlatKind[]).includes(kind) || found.value === null || found.value === undefined || !found.range) return []
      // A family's range is held against only when it is a range (`isRange`); and nothing is outside by less than one pixel can make.
      if (family && !isRange(found.range, familyCount(family, measure.id))) return []
      const step = family ? outsideStep(measure.id, own) : 0
      const side = found.value < found.range[0] * (1 - OUTSIDE_MARGIN) && found.range[0] - found.value > step ? "low" : found.value > found.range[1] * (1 + OUTSIDE_MARGIN) && found.value - found.range[1] > step ? "high" : null
      const plain = side && side in measure ? (measure as { low?: string; high?: string })[side] : undefined
      if (!side || !plain) return []
      return [{ measure: measure.id, name: measure.name, criterion: measure.criterion, side, plain: index === 0 ? plain : `第 ${index + 1} 张图：${plain}`, words: `${found.fact((found.say ?? String)(found.value), between(found.range, found.say))}——${plain}` }]
    })
  })
  return [...compared, ...among]
}

/** One measured thing that is to be answered: changed, or declared as meant in the sheet under `measure` (or `name`). `fix`, when it has its own, is what to do about it instead of the words for a measure outside the world's range. */
export type OutsideFound = { measure: string; name: string; criterion: Parameters<typeof criterion>[0]; side: "low" | "high"; plain: string; words: string; fix?: string }

/** The two things measured between the pictures of one block, named as a sheet's `differs` names them. */
export const AMONG_MEASURES = { agree: { id: "variant_colours", name: "几张图的颜色是不是一套" }, twin: { id: "variant_twin", name: "两张图是不是一样" } } as const

const apartFound = (found: NonNullable<TextureNote["among"]>, index: number): OutsideFound[] =>
  (found.drawn ?? found.agree) >= VARIANT_LIMITS.agree
    ? []
    : [
        {
          measure: AMONG_MEASURES.agree.id,
          name: AMONG_MEASURES.agree.name,
          criterion: "fits",
          side: "low",
          plain: `第 ${index + 1} 张图的颜色和这个方块其余的图不是一套，混在墙里像是另一种方块`,
          words: `${pictureName(index)}${found.drawn === null ? "整张图" : "上面显眼的图案"}只有 ${percent(found.drawn ?? found.agree)} 的像素用的是这个方块其余几张图也有的颜色（不到 ${percent(VARIANT_LIMITS.agree)}）——游戏会把这几张图混着用，它混在墙里像是另一种方块`,
          fix: `把这一张改成和其余几张同一种材质、同一套颜色（图案的位置和形状尽管不同），再看一版；它本来就该是另一套颜色的话，在部件说明的 differs 里写上这一项和理由（{"measure":"${AMONG_MEASURES.agree.id}","reason":"……"}），理由会原样给评审和人看。`,
        },
      ]

const twinFound = (found: NonNullable<TextureNote["among"]>, index: number): OutsideFound[] =>
  found.twin === null
    ? []
    : [
        {
          measure: AMONG_MEASURES.twin.id,
          name: AMONG_MEASURES.twin.name,
          criterion: "not_mechanical",
          side: "high",
          plain: `第 ${index + 1} 张图和第 ${found.twin} 张几乎一样，多这一张等于没有多`,
          words: `${pictureName(index)}和第 ${found.twin} 张几乎一模一样（同一个位置上 ${percent(VARIANT_LIMITS.twin)} 以上的像素颜色相同或只差一点点）——墙上多这一张等于没有多，重复照旧`,
          fix: `把这一张的图案换到别的位置、换个形状（材质和颜色不变），或者从 variants 里拿掉它，再看一版；它本来就该这样的话，在部件说明的 differs 里写上这一项和理由（{"measure":"${AMONG_MEASURES.twin.id}","reason":"……"}）。`,
        },
      ]

/** Why a sheet says this measure is meant to lie outside the world's range, or null when it does not. The measure is named by its id or by its plain name. */
export const differsReason = (sheet: Declared, measure: { measure: string; name: string }) => sheet?.differs?.find((value) => [measure.measure, measure.name].includes(value.measure.trim().toLowerCase()))?.reason ?? null

/** A measure as the person reads it, from whatever a sheet called it (its id or its plain name); the sheet's own word when it is neither. */
export const comparedName = (measure: string) => [...COMPARED, ...Object.values(AMONG_MEASURES)].find((value) => [value.id as string, value.name as string].includes(measure.trim().toLowerCase()))?.name ?? measure

/** Where a maker or a reviewer looks for what a measure says, by kind: the cells of the pictures, as they are labelled. */
const WHERE = { block: `「砌成一面墙」「平铺 4×4」「游戏里的实际大小」和「${WORLD_SHEET}」那几格`, item: `「背包格子里的实际大小」和「${WORLD_SHEET}」那几格` } as const

/** Measures outside the world's own range that the sheet does not declare as meant, each as a fact under its criterion. Empty when nothing was compared. */
export const outsideUnanswered = (kind: FlatKind, sheet: Declared, note: TextureNote | null | undefined) =>
  (note ? outsideWorld(kind, note) : []).filter((found) => differsReason(sheet, found) === null).map((found) => ({ ...found, line: `${criterion(found.criterion).name}：${found.words}。` }))

/**
 * The same as findings for the maker: the picture is changed, or the sheet says why it is meant to differ.
 * Like a motion nobody can see, it is not one of the standard's hard faults: the version is still kept.
 */
export const outsideFindings = (kind: FlatKind, sheet: Declared, note: TextureNote | null | undefined) =>
  outsideUnanswered(kind, sheet, note).map((found) => found.fix ? `${found.line}${found.fix}` : `${found.line}这一项${OUTSIDE_WORDS.mark}（离最近的一头超过 ${Math.round(OUTSIDE_MARGIN * 100)}%）：对着${WHERE[kind]}改到和这个世界是一起的，再看一版；${OUTSIDE_WORDS.meant}的话，在部件说明的 differs 里写上这一项和理由（{"measure":"${found.measure}","reason":"……"}），理由会原样给评审和人看。`)

/** The one refusal: a picture that is one of the references over again. Null when it is its own. */
export const copyFinding = (kind: FlatKind, note: Pick<TextureNote, "copy">) =>
  note.copy === null
    ? null
    : `照搬：${SUBJECT[kind]}和拿来对照的原版「${note.copy}」几乎一模一样（同一个位置上 ${Math.round(COPY_LIMITS.share * 100)}% 以上的像素颜色相同或只差一点点）。原版的图只用来对照细节的多少、用色和光的方向，不能拿来用：重新画一张自己的，再看一版。`

export const WORLD_SHEET_NAME = WORLD_SHEET

/**
 * Three sentences for anyone who makes or judges a flat picture: where it is judged, what comes back with
 * every look, and what the references are for. No word on how anything should be drawn.
 */
export const TEXTURE_GUIDE =
  `方块和物品的贴图：好不好，看的是它在游戏里的样子——方块看「游戏里的实际大小」和「砌成一面墙」「平铺」那几格（铺开以后有没有接缝、是不是一眼看出一格一格在重复），物品看「背包格子里的实际大小」那几格（浅色和深色的格子里都认不认得出）——不是单独放大的那一格；放大的那一格只用来找哪个像素不对。` +
  `每次看图和验收，Studio 都会把量出来的事实一句一条告诉你（texture_facts）：用了几种颜色、最大的一块纯色占多少、明暗相差多少、相邻像素有多少不一样、铺开时接缝明不明显；这些是事实不是判决，怎么改由你对着图决定。` +
  `这台电脑上装了游戏本体时，还会另附一张「${WORLD_SHEET_NAME}」：把它和游戏里本来就有的方块或物品放在一起，texture_facts 里也会有它们量出来的数。原版的东西只用来对照——细节的多少、用色的道理、光从哪边来——让它看起来和这个世界是一起的，不是让你照着画：和其中任何一张几乎一样的贴图会被拒绝。没有这张图时，texture_facts 会说明没有对照。` +
  `一个方块可以不止一张图：variants 里再放 1 到 ${BLOCK_FACES.extra} 张同样大小的图，游戏就在每个位置随机用其中一张（random_mirror、random_turn 写 true 还会随机左右镜像、随机转向）——同一个图案在墙上一格一格地重复，而单独一张已经改不出来的时候，这是唯一的办法。几张图要是同一种材质、同一套颜色，只有图案的位置和形状不同；每一张都照样量、照样对照原版，texture_facts 还会说它们的颜色是不是一套、砌成墙以后相邻两块有多少是一样的。` +
  `有对照时，量出来的数里哪一项落在原版的范围以外一截（离最近的一头超过 ${Math.round(OUTSIDE_MARGIN * 100)}%），texture_facts 会另起一句写明「${OUTSIDE_WORDS.mark}」：这不是随口的建议，制作者要么把它改回这个世界的样子，要么在部件说明的 differs 里写明${OUTSIDE_WORDS.meant}和理由（理由会给评审和人看），否则不能说做完。没有对照时没有这一条。这个范围不是摆在旁边的那几张量出来的（它们和它是同一种东西，彼此太像，只用来对着看），而是原版里同一大类的几十张量出来的：texture_facts 里「对照的范围」那一句写着是哪一类、多少张、每一项的范围；这一大类彼此几乎一样的那几项（或者读到的不到 ${FAMILY_LIMITS.least} 张时的所有项）只当事实说，不拿来要求它。`

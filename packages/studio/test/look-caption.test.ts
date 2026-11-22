import { expect, test } from "bun:test"
import { MAKING_LIMITS } from "@minemods/mod-core/making"
import { CAPTION, captionBand, captionLayout, captionRows, pictureSize } from "../src/renderer/look-caption"
import { lookCamera, projector } from "../src/renderer/look-camera"
import { once } from "../src/main/look-job"

// A letter of the caption's font is as wide as it is tall; a row of a cell as wide as the cell less its two margins.
const measure = (text: string) => [...text].length * 15
const CELL = [MAKING_LIMITS.sheet[0] / 3, MAKING_LIMITS.sheet[1] / 2] as const
const WIDTH = CELL[0] - 20

test("sentences that repeat are said once with how many places say them, in the order they were first said", () => {
  expect(once(["甲。", "乙。", "甲。", "丙。", "甲。"])).toEqual(["甲。（同样的有 3 处）", "乙。", "丙。"])
  expect(once(["甲。", "乙。"])).toEqual(["甲。", "乙。"])
  expect(once([])).toEqual([])
})

test("a caption covers at most two fifths of its cell: the rest of the rows are cut and the last kept row says how many sentences are left to the notes", () => {
  // 512 pixels high: two fifths is 204.8, less the band's padding, in rows of 22: 8 rows.
  expect(captionRows(CELL[1])).toBe(8)
  const row = Math.floor(WIDTH / 15)
  const sentence = (letter: string, rows: number) => letter.repeat(row * rows - 3) + "。。。"
  // Fits: laid out as before, row by row, every row whole.
  const short = [sentence("甲", 2), sentence("乙", 3)]
  const whole = captionLayout(short, WIDTH, CELL[1], measure)
  expect(whole).toHaveLength(5)
  expect(whole.map((value) => value.text).join("")).toBe(short.join(""))
  // Four long sentences of three rows each: twelve rows wanted, eight kept, and the band is no taller than the share.
  const long = ["甲", "乙", "丙", "丁"].map((letter) => sentence(letter, 3))
  const cut = captionLayout(long, WIDTH, CELL[1], measure)
  expect(cut).toHaveLength(8)
  expect(cut.length * CAPTION.row + CAPTION.pad).toBeLessThanOrEqual(CELL[1] * CAPTION.share)
  // Three rows each: the first two sentences are whole (rows 1 to 6), the third has two rows kept and the mark takes the end of the second (it is cut in the middle); it and the fourth are left.
  expect(cut.at(-1)!.text.endsWith("……其余 2 句见说明")).toBe(true)
  expect(measure(cut.at(-1)!.text)).toBeLessThanOrEqual(WIDTH)
  expect(cut.slice(0, 7).map((value) => value.text).join("")).toBe(long.slice(0, 2).join("") + long[2]!.slice(0, row))
  // One sentence of ten rows: it is cut in the middle, and it alone is what is left.
  const one = captionLayout([sentence("甲", 10)], WIDTH, CELL[1], measure)
  expect(one).toHaveLength(8)
  expect(one.at(-1)!.text.endsWith("……其余 1 句见说明")).toBe(true)
  // A cell shorter than a row still keeps a row.
  expect(captionRows(10)).toBe(1)
})

// ---- the picture is drawn above the band ----

const VIEWS = ["front", "back", "plus_x", "minus_x", "top", "quarter", "quarter_back"] as const
// A flier as big as a boss (model pixels, 16 to a block): 24 blocks across, 24 deep, 16 high, standing on the ground.
const BOSS = { min: [-192, 0, -192] as [number, number, number], max: [192, 256, 192] as [number, number, number] }
const corners = (box: typeof BOSS) => [box.min[0], box.max[0]].flatMap((x) => [box.min[1], box.max[1]].flatMap((y) => [box.min[2], box.max[2]].map((z): [number, number, number] => [x, y, z])))

test("a cell with no caption is drawn into the whole cell, exactly as before; a captioned one into the part above its band", () => {
  expect(pictureSize(CELL, 0)).toEqual([CELL[0], CELL[1]])
  expect(captionBand(3)).toBe(3 * CAPTION.row + CAPTION.pad)
  for (const rows of [1, 3, captionRows(CELL[1])]) {
    const area = pictureSize(CELL, rows)
    expect(area[0]).toBe(CELL[0])
    // The band and the picture's part are the cell, with nothing between them.
    expect(area[1] + captionBand(rows)).toBe(CELL[1])
  }
  // The most a caption takes is the share, so the picture keeps at least three fifths of the cell's height.
  expect(pictureSize(CELL, captionRows(CELL[1]))[1]).toBeGreaterThanOrEqual(CELL[1] * (1 - CAPTION.share))
  // A cell too small to hold a row still keeps a pixel for the picture.
  expect(pictureSize([100, 20], 1)[1]).toBe(1)
})

test("the camera that frames a thing for a cell frames it above the band: every corner of its box lands in the part the caption leaves free, from every side, for every band", () => {
  for (const view of VIEWS) {
    const camera = lookCamera(BOSS, view, CELL[0] / CELL[1])
    // Before: in the whole cell the box is inside, but the low corners lie under a band of any height, the claw and the lower half of the hit under it.
    const whole = corners(BOSS).map(projector(camera, CELL))
    whole.forEach((point) => {
      expect(point[0]).toBeGreaterThanOrEqual(0)
      expect(point[0]).toBeLessThanOrEqual(CELL[0])
      expect(point[1]).toBeGreaterThanOrEqual(0)
      expect(point[1]).toBeLessThanOrEqual(CELL[1])
    })
    if (view !== "top") expect(Math.max(...whole.map((point) => point[1]))).toBeGreaterThan(CELL[1] - captionBand(captionRows(CELL[1])))
    for (const rows of [1, 4, captionRows(CELL[1])]) {
      const area = pictureSize(CELL, rows)
      corners(BOSS).map(projector(camera, area)).forEach((point) => {
        expect(point[0]).toBeGreaterThanOrEqual(-1e-6)
        expect(point[0]).toBeLessThanOrEqual(area[0] + 1e-6)
        expect(point[1]).toBeGreaterThanOrEqual(-1e-6)
        expect(point[1]).toBeLessThanOrEqual(area[1] + 1e-6)
      })
    }
  }
})

test("a camera fitted for a picture of the free part's own aspect is the camera of the whole cell: the lens is vertical and a wider picture only shows more, so nothing needs refitting", () => {
  for (const view of VIEWS) {
    const area = pictureSize(CELL, captionRows(CELL[1]))
    const whole = lookCamera(BOSS, view, CELL[0] / CELL[1])
    const free = lookCamera(BOSS, view, area[0] / area[1])
    // The cell is square, so the free part is wider than high: the sphere the thing is fitted in is limited by the height in both.
    free.position.forEach((value, axis) => expect(value).toBeCloseTo(whole.position[axis]!, 6))
    expect(free.fov).toBe(whole.fov)
  }
})

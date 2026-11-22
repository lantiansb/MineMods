import { expect, test } from "bun:test"
import { CONCEPT_GUIDE, REFERENCE_LIMITS } from "../src/making"
import { DRAWN_GUIDE, SCRIPT_API, SCRIPT_GUIDE, SCRIPT_LIMITS, scriptApi, type TracePicture } from "../src/script"

// `api.trace` is called directly, outside any sandbox: these tests are about what it makes of a picture. That it runs
// in the sandbox, from a stored picture of any of the three kinds, is tested in mod-core (image-decode.test.ts).

type Paint = (x: number, y: number) => [number, number, number, number]
const picture = (width: number, height: number, paint: Paint, name = "概念") => {
  const bytes = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bytes.set(paint(x, y), (y * width + x) * 4)
  return { name, width, height, rgba: bytes.toString("base64") } satisfies TracePicture
}
const WHITE: [number, number, number, number] = [255, 255, 255, 255]
type Traced = { width: number; height: number; palette: string[]; pixels: number[] }
const trace = (pictures: TracePicture[], asked?: Record<string, unknown>, name: string | undefined = pictures[0]?.name) => {
  const made = scriptApi({ wears: null, limits: SCRIPT_LIMITS, flat: true, pictures })
  const canvas = (made.api as any).trace(name, asked) as { picture: () => Traced }
  return { ...canvas.picture(), notes: made.notes, canvas }
}
const filled = (traced: Traced) => traced.pixels.map((index) => index >= 0)
const colourAt = (traced: Traced, x: number, y: number) => (traced.pixels[y * traced.width + x]! < 0 ? null : traced.palette[traced.pixels[y * traced.width + x]!]!)
const luma = (hex: string) => 0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)
const failure = (run: () => unknown) => {
  try {
    run()
    return ""
  } catch (error) {
    return (error as Error).message
  }
}

// Two shapes drawn by arithmetic, not by any picture library: a slanted oval (a vane) and a slanted bar with a cross piece (a blade and its guard).
const oval: Paint = (x, y) => {
  const u = (x - 64 + (y - 64)) / Math.SQRT2
  const v = (x - 64 - (y - 64)) / Math.SQRT2
  return (u / 60) ** 2 + (v / 22) ** 2 <= 1 ? [70, 130, 210, 255] : WHITE
}
const blade: Paint = (x, y) => {
  const along = (x + (127 - y)) / Math.SQRT2
  const across = (x - (127 - y)) / Math.SQRT2
  if (Math.abs(across) < 9 && along > 40 && along < 170) return [200, 205, 215, 255]
  if (Math.abs(across) < 28 && along > 28 && along < 40) return [190, 140, 40, 255]
  return WHITE
}

/** What a picture's subject comes to at 16×16, found a different way from the implementation: points sampled in each cell of the subject's box, kept when half of them are on it. */
function expectedMask(source: { width: number; height: number }, paint: Paint, side: number) {
  let left = 999, top = 999, right = -1, bottom = -1
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++)
      if (paint(x, y)[0] !== 255 || paint(x, y)[1] !== 255) [left, top, right, bottom] = [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)]
  const boxWidth = right - left + 1
  const boxHeight = bottom - top + 1
  const scale = Math.max(boxWidth, boxHeight) / side
  const across = Math.round(boxWidth / scale)
  const down = Math.round(boxHeight / scale)
  const mask = new Array(side * side).fill(false)
  for (let cy = 0; cy < down; cy++)
    for (let cx = 0; cx < across; cx++) {
      let on = 0
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const x = Math.floor(left + ((cx + (sx + 0.5) / 4) * boxWidth) / across)
          const y = Math.floor(top + ((cy + (sy + 0.5) / 4) * boxHeight) / down)
          if (paint(x, y)[0] !== 255 || paint(x, y)[1] !== 255) on++
        }
      mask[(Math.floor((side - down) / 2) + cy) * side + Math.floor((side - across) / 2) + cx] = on >= 8
    }
  return mask
}
const mismatches = (a: boolean[], b: boolean[]) => a.filter((value, index) => value !== b[index]).length

test("描出来的轮廓就是图里主体缩到 16×16 的样子：斜椭圆和斜剑形都对得上", () => {
  for (const [name, paint, least] of [["椭圆", oval, 40], ["剑形", blade, 15]] as const) {
    const source = picture(128, 128, paint, name)
    const traced = trace([source])
    expect([traced.width, traced.height]).toEqual([16, 16])
    const mask = filled(traced)
    // Not a blank or a full square: there is a subject, with room round it.
    expect(mask.filter(Boolean).length).toBeGreaterThan(least)
    expect(mask.filter(Boolean).length).toBeLessThan(150)
    // Within a few cells of the downsampled mask: the two differ only where a cell is nearly half covered.
    expect(mismatches(mask, expectedMask(source, paint, 16))).toBeLessThanOrEqual(6)
  }
})

test("缩的时候按比例：长的主体放进 16×16 不变形，size 可以写 [宽, 高] 或一个数，fit 可以铺满", () => {
  const long = picture(200, 100, (x, y) => (x >= 10 && x < 190 && y >= 20 && y < 80 ? [30, 160, 60, 255] : WHITE))
  const traced = trace([long])
  const cells = filled(traced)
  const columns = cells.flatMap((on, at) => (on ? [at % 16] : []))
  const rows = cells.flatMap((on, at) => (on ? [Math.floor(at / 16)] : []))
  // 180×60 is 3:1: 16 across and about 5 or 6 down, in the middle.
  expect(Math.max(...columns) - Math.min(...columns) + 1).toBe(16)
  expect(Math.max(...rows) - Math.min(...rows) + 1).toBeGreaterThanOrEqual(5)
  expect(Math.max(...rows) - Math.min(...rows) + 1).toBeLessThanOrEqual(6)
  const wide = trace([long], { size: [32, 16] })
  expect([wide.width, wide.height]).toEqual([32, 16])
  const small = trace([long], { size: 8 })
  expect([small.width, small.height]).toEqual([8, 8])
  // Covering: the picture fills the canvas and what does not fit is cut off.
  const covered = trace([long], { fit: "cover" })
  expect(filled(covered).every(Boolean)).toBe(true)
  expect(failure(() => trace([long], { size: SCRIPT_LIMITS.canvas + 1 }))).toContain("trace 的 size")
})

test("背景去掉：纯色底（带一点噪点）、图自己的透明、底色写明；主体里被围住的同色地方留着", () => {
  // A little noise on the flat colour, as a scanned or compressed picture has.
  const noisy = (x: number, y: number): [number, number, number, number] => [32 + ((x * 7 + y * 13) % 5), 64, 128, 255]
  const onBlue = picture(96, 96, (x, y) => (Math.hypot(x - 48, y - 48) < 40 ? [220, 60, 50, 255] : noisy(x, y)))
  const keyed = trace([onBlue])
  expect(colourAt(keyed, 0, 0)).toBeNull()
  expect(colourAt(keyed, 15, 15)).toBeNull()
  expect(colourAt(keyed, 8, 8)).not.toBeNull()
  expect(keyed.notes.join("")).toContain("底色")
  // The picture says what is transparent: the colour under it does not matter.
  const cutOut = picture(96, 96, (x, y) => (Math.hypot(x - 48, y - 48) < 40 ? [220, 60, 50, 255] : [0, 255, 0, 0]))
  const alpha = trace([cutOut])
  expect(filled(alpha)).toEqual(filled(keyed))
  expect(alpha.notes.join("")).toContain("透明")
  // A ring on white, with the white inside it: the inside is part of the subject (it is enclosed), the outside is not.
  const ring = picture(96, 96, (x, y) => (Math.hypot(x - 48, y - 48) < 44 && Math.hypot(x - 48, y - 48) > 30 ? [40, 40, 40, 255] : WHITE))
  const ringed = trace([ring])
  expect(colourAt(ringed, 8, 8)).not.toBeNull()
  expect(colourAt(ringed, 0, 0)).toBeNull()
  // The background colour can be said, and a picture that is only a field of colour has no subject to find.
  const named = trace([onBlue], { background: "#204080", tolerance: 0.1 })
  expect(filled(named)).toEqual(filled(keyed))
  expect(failure(() => trace([picture(32, 32, () => [10, 200, 10, 255])]))).toContain("找不到主体")
})

test("颜色合成 colors 种以内，看起来差不多的不拆开，差得多的不并", () => {
  // Four flat colours far apart, in bands that line up with the 16 cells (a 64-pixel box, 4 pixels to a cell, so no cell holds two of them):
  // four come out of a request for eight, and at most two out of a request for two.
  const bands: [number, number, number, number][] = [[220, 40, 40, 255], [40, 180, 60, 255], [40, 60, 220, 255], [230, 210, 40, 255]]
  const three = picture(96, 96, (x, y) => (x < 16 || x >= 80 || y < 16 || y >= 80 ? WHITE : bands[Math.floor((x - 16) / 16)]!))
  const all = trace([three], { colors: 8 })
  expect(all.palette).toHaveLength(4)
  const two = trace([three], { colors: 2 })
  expect(two.palette.length).toBeLessThanOrEqual(2)
  expect(filled(two)).toEqual(filled(all))
  // A smooth gradient has no three colours in it, but a request for four gives at most four, in order of lightness.
  const ramp = picture(96, 96, (x, y) => (x > 8 && x < 88 && y > 8 && y < 88 ? [x * 2, x * 2, x * 2, 255] : WHITE))
  const grey = trace([ramp], { colors: 4 })
  expect(grey.palette.length).toBeGreaterThan(1)
  expect(grey.palette.length).toBeLessThanOrEqual(4)
  // Shades and an outline are made from the colours and counted apart: three tones of each at most, and one more for the line.
  const shaded = trace([three], { colors: 4, shade: true, outline: true })
  expect(shaded.palette.length).toBeLessThanOrEqual(4 * 3 + 1)
  expect(shaded.palette.length).toBeGreaterThan(4)
  expect(failure(() => trace([three], { colors: 1 }))).toContain("colors")
  expect(failure(() => trace([three], { colors: 33 }))).toContain("colors")
})

test("描边：主体外面一圈一个像素，深色，不压在主体上；不要就没有；有描边时主体离边留一格", () => {
  const source = picture(128, 128, oval)
  const plain = trace([source])
  const lined = trace([source], { outline: true })
  const subject = filled(plain)
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16
  // The subject with a line round it is the same shape, a cell smaller on every side to leave room: compare against its own subject cells.
  const colourless = trace([source], { outline: "#101010" })
  const line = colourless.palette.indexOf("#101010")
  expect(line).toBeGreaterThanOrEqual(0)
  const drawn = colourless.pixels.map((index) => index >= 0)
  const edge = colourless.pixels.map((index) => index === line)
  const body = drawn.map((on, at) => on && !edge[at])
  // Every line cell touches the body, and every body cell's empty neighbour is a line cell.
  drawn.forEach((_, at) => {
    const x = at % 16, y = Math.floor(at / 16)
    const next = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([px, py]) => inside(px!, py!))
    if (edge[at]) expect(next.some(([px, py]) => body[py! * 16 + px!])).toBe(true)
    if (body[at]) expect(next.every(([px, py]) => drawn[py! * 16 + px!])).toBe(true)
  })
  expect(body.filter(Boolean).length).toBeGreaterThan(20)
  // The body's own colours do not include the line's, and the line is darker than all of them.
  const bodyColours = new Set(colourless.pixels.filter((index) => index >= 0 && index !== line).map((index) => colourless.palette[index]!))
  expect([...bodyColours].every((hex) => luma(hex) > luma("#101010"))).toBe(true)
  // Left to itself the line is a dark shade of the darkest colour, darker than every colour it surrounds.
  const auto = lined.pixels.flatMap((index, at) => (index >= 0 && !filled(plain)[at] ? [lined.palette[index]!] : []))
  expect(auto.length).toBeGreaterThan(10)
  expect(new Set(auto).size).toBe(1)
  const rest = lined.pixels.flatMap((index, at) => (index >= 0 && !auto.includes(lined.palette[index]!) ? [lined.palette[index]!] : []))
  expect(rest.every((hex) => luma(hex) > luma(auto[0]!))).toBe(true)
  // Room for the line: nothing of a subject that is traced with an outline touches the edge of the canvas.
  const touching = lined.pixels.some((index, at) => index >= 0 && (at % 16 === 0 || at % 16 === 15 || at < 16 || at >= 240) && !auto.includes(lined.palette[index]!))
  expect(touching).toBe(false)
  expect(subject.filter(Boolean).length).toBeGreaterThan(0)
})

test("光从左上来：打开 shade，每种颜色左上的格子比右下的亮，不打开就是平的", () => {
  const disc = picture(128, 128, (x, y) => (Math.hypot(x - 64, y - 64) < 60 ? [120, 120, 200, 255] : WHITE))
  const flatTraced = trace([disc], { colors: 3 })
  expect(flatTraced.palette).toHaveLength(1)
  const lit = trace([disc], { shade: 0.12 })
  expect(lit.palette.length).toBeGreaterThan(1)
  const brightness = (x: number, y: number) => luma(colourAt(lit, x, y)!)
  // The cell nearest the top left of the disc is lighter than the cell nearest its bottom right.
  const cells = filled(lit).flatMap((on, at) => (on ? [{ x: at % 16, y: Math.floor(at / 16) }] : []))
  const near = (sx: number, sy: number) => cells.reduce((best, cell) => (Math.hypot(cell.x - sx, cell.y - sy) < Math.hypot(best.x - sx, best.y - sy) ? cell : best))
  const top = near(0, 0)
  const bottom = near(15, 15)
  expect(brightness(top.x, top.y)).toBeGreaterThan(brightness(bottom.x, bottom.y))
  // The whole of its top left half is, on average, lighter than the bottom right half, and its shape is the same as the flat one's.
  const half = (test: (cell: { x: number; y: number }) => boolean) => cells.filter(test).reduce((sum, cell) => sum + brightness(cell.x, cell.y), 0) / cells.filter(test).length
  expect(half((cell) => cell.x + cell.y < 15)).toBeGreaterThan(half((cell) => cell.x + cell.y > 15))
  expect(filled(lit)).toEqual(filled(flatTraced))
})

test("结果是一张普通的画布：可以接着改、擦、贴到别的画布上，再交出去就是普通的图", () => {
  const made = scriptApi({ wears: null, limits: SCRIPT_LIMITS, flat: true, pictures: [picture(128, 128, oval)] })
  const api = made.api as any
  const c = api.trace("概念", { outline: true })
  expect(Object.keys(c).sort()).toEqual(Object.keys(api.canvas(4, 4, null)).sort())
  const before = c.get(8, 8)
  c.set(8, 8, "#ff0000").set(0, 0, null).rect(1, 1, 2, 2, "#00ff00")
  const sheet = api.canvas(32, 16, null)
  sheet.stamp(c, 16, 0)
  const done = JSON.parse(made.finish(sheet)) as { value: Traced }
  expect(done.value.width).toBe(32)
  expect(before).not.toBe("#ff0000")
  expect(done.value.palette).toContain("#ff0000")
  expect(done.value.pixels[8 * 32 + 16 + 8]).toBe(done.value.palette.indexOf("#ff0000"))
  // The same picture and options give the same canvas every time: a script must come out the same on every run.
  const fresh = () => JSON.stringify((scriptApi({ wears: null, limits: SCRIPT_LIMITS, flat: true, pictures: [picture(128, 128, oval)] }).api as any).trace("概念", { outline: true, shade: true }).picture())
  expect(fresh()).toBe(fresh())
})

test("没有构想图、名字不对、读不出来的图、选项写错：说清楚是什么、怎么办", () => {
  const some = picture(32, 32, oval, "正面")
  const kit = (pictures?: TracePicture[]) => (scriptApi({ wears: null, limits: SCRIPT_LIMITS, pictures }).api as any)
  expect(failure(() => kit().trace("正面"))).toMatch(/save_concepts.*物品、方块、模型/)
  expect(failure(() => kit([some]).trace("侧面"))).toContain("「正面」")
  expect(failure(() => kit([{ name: "正面", error: "文件是残的。" }]).trace("正面"))).toContain("文件是残的。")
  expect(failure(() => kit([some, { ...some, name: "侧面" }]).trace())).toContain("「侧面」")
  // One picture only: no name needed.
  expect(() => kit([some]).trace()).not.toThrow()
  expect(failure(() => kit([some]).trace("正面", { fit: "stretch" }))).toContain("fit")
  expect(failure(() => kit([some]).trace("正面", { outline: "red" }))).toContain("outline")
  expect(failure(() => kit([some]).trace("正面", 5))).toContain("选项")
  // What a script is told it has.
  expect(kit([some, { name: "坏", error: "x" }]).concepts).toEqual([{ name: "正面", width: 32, height: 32 }, { name: "坏", width: 0, height: 0, error: "x" }])
  expect(kit().concepts).toEqual([])
})

test("限制和说明：能交的张数同 save_concepts，说明里写了怎么用、可做可不做", () => {
  expect(SCRIPT_LIMITS.pictures).toBe(REFERENCE_LIMITS.concept)
  expect(SCRIPT_LIMITS.trace).toBe(256)
  // 256 on the long side and four bytes a pixel: what the sandbox is handed for one picture at most, as base64.
  expect(Math.ceil((SCRIPT_LIMITS.trace * SCRIPT_LIMITS.trace * 4) / 3) * 4).toBeLessThan(400_000)
  expect(SCRIPT_API.map((entry) => entry[0]).join("\n")).toMatch(/api\.trace\(/)
  expect(SCRIPT_API.map((entry) => entry[0]).join("\n")).toMatch(/api\.concepts/)
  for (const text of [DRAWN_GUIDE, CONCEPT_GUIDE]) {
    expect(text).toContain("api.trace")
    expect(text).toContain("save_concepts")
    expect(text).toContain("可做可不做")
    expect(text).toContain("轮廓")
    expect(text).not.toContain("三视图")
  }
  expect(CONCEPT_GUIDE).toMatch(/物品、方块/)
  expect(DRAWN_GUIDE).toMatch(/再手改|手改/)
  // The model script guide says it is for a block's or an item's own picture, so a maker of a worn texture is not led to it.
  expect(SCRIPT_GUIDE).toContain("api.trace 是给方块和物品自己的那张图用的")
})

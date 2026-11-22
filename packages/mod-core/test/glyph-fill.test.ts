import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { BUILD_WARNING_RULES } from "../src/build-warnings"
import { fontHas } from "../src/font-findings"
import { fillGlyphs, glyphForecast, glyphPaths } from "../src/glyph-fill"
import { GLYPH_CELL, GLYPH_LOOKS, openFontLicensed, pixelGlyph, readFace } from "../src/glyph-font"
import { decodeRgbaPng } from "../src/png-decode"
import { saveProject, type Project } from "../src/project"
import { BOOK_IDS, createBookSample } from "../script/target-book-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const fresh = async (name: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `minemods-glyph-${name}-`))
  roots.push(root)
  return root
}

// Two rare characters a font can have (Extension B, neither game version draws them) and one that the tiny font leaves out, as no font here has it.
const RARE = { a: "\u{216B8}", b: "\u{291D5}", none: "\u{24FE4}" }
const OFL = "This Font Software is licensed under the SIL Open Font License, Version 1.1."

/**
 * A TrueType font made in the test, so the fill is tested the same on every computer and no font file is in the repository: one glyph, a box
 * from (100, -100) to (800, 800) on a 1000 em, for each code point given; its name table says the licence given.
 */
function tinyFont(license: string, codes: number[]) {
  const table = (size: number, fill: (view: DataView) => void) => {
    const bytes = new Uint8Array(size)
    fill(new DataView(bytes.buffer))
    return bytes
  }
  const head = table(54, (view) => {
    view.setUint32(0, 0x00010000)
    view.setUint32(12, 0x5f0f3cf5)
    view.setUint16(18, 1000)
    view.setInt16(50, 1)
  })
  const maxp = table(6, (view) => {
    view.setUint32(0, 0x00005000)
    view.setUint16(4, 2)
  })
  const cmap = table(12 + 16 + codes.length * 12, (view) => {
    view.setUint16(2, 1)
    view.setUint16(4, 3)
    view.setUint16(6, 10)
    view.setUint32(8, 12)
    view.setUint16(12, 12)
    view.setUint32(16, 16 + codes.length * 12)
    view.setUint32(24, codes.length)
    codes.forEach((code, index) => {
      view.setUint32(28 + index * 12, code)
      view.setUint32(32 + index * 12, code)
      view.setUint32(36 + index * 12, 1)
    })
  })
  const box = [[100, -100], [100, 800], [800, 800], [800, -100]]
  const glyph = table(10 + 2 + 2 + 4 + 16, (view) => {
    view.setInt16(0, 1)
    view.setUint16(10, 3)
    let at = 14
    for (let index = 0; index < 4; index++) view.setUint8(at++, 1)
    box.forEach(([x], index) => view.setInt16(at + index * 2, x! - (index ? box[index - 1]![0]! : 0)))
    at += 8
    box.forEach(([, y], index) => view.setInt16(at + index * 2, y! - (index ? box[index - 1]![1]! : 0)))
  })
  const loca = table(12, (view) => {
    view.setUint32(8, glyph.length)
  })
  const strings = [[0, "Copyright 2026 Test Foundry."], [1, "Tiny Sans"], [13, license]] as const
  const encoded = strings.map(([, text]) => Uint8Array.from([...text].flatMap((char) => [char.charCodeAt(0) >> 8, char.charCodeAt(0) & 0xff])))
  const name = table(6 + strings.length * 12 + encoded.reduce((sum, bytes) => sum + bytes.length, 0), (view) => {
    view.setUint16(2, strings.length)
    view.setUint16(4, 6 + strings.length * 12)
    let offset = 0
    strings.forEach(([id], index) => {
      const at = 6 + index * 12
      view.setUint16(at, 3)
      view.setUint16(at + 2, 1)
      view.setUint16(at + 4, 0x409)
      view.setUint16(at + 6, id)
      view.setUint16(at + 8, encoded[index]!.length)
      view.setUint16(at + 10, offset)
      encoded[index]!.forEach((byte, place) => view.setUint8(6 + strings.length * 12 + offset + place, byte))
      offset += encoded[index]!.length
    })
  })
  const tables = Object.entries({ cmap, glyf: glyph, head, loca, maxp, name })
  const directory = 12 + tables.length * 16
  const offsets = tables.reduce<number[]>((list, [, bytes], index) => [...list, index ? list[index - 1]! + Math.ceil(tables[index - 1]![1].length / 4) * 4 : directory], [])
  return table(offsets.at(-1)! + Math.ceil(tables.at(-1)![1].length / 4) * 4, (view) => {
    view.setUint32(0, 0x00010000)
    view.setUint16(4, tables.length)
    tables.forEach(([tag, bytes], index) => {
      ;[...tag].forEach((char, place) => view.setUint8(12 + index * 16 + place, char.charCodeAt(0)))
      view.setUint32(12 + index * 16 + 8, offsets[index]!)
      view.setUint32(12 + index * 16 + 12, bytes.length)
      bytes.forEach((byte, place) => view.setUint8(offsets[index]! + place, byte))
    })
  })
}

async function fontFolder(license = OFL) {
  const folder = path.join(await fresh("fonts"), "fonts")
  await mkdir(folder)
  await writeFile(path.join(folder, "tiny.ttf"), tinyFont(license, [RARE.a.codePointAt(0)!, RARE.b.codePointAt(0)!]))
  return folder
}

/** The book sample with the rare characters in a book's name (its item name), a page title and a page body. */
async function rareSample(directory: string, target: Project["target"], release?: Project["release"]) {
  const project = await createBookSample(directory, target)
  return saveProject(directory, {
    ...project,
    ...(release ? { release } : {}),
    workspace: { assets: project.workspace.assets.map((asset) => (asset.id === BOOK_IDS.quests && asset.document.kind === "book" ? { ...asset, document: { ...asset.document, name: `北境${RARE.a}手册`, pages: [{ title: `山${RARE.none}`, body: `去北边找${RARE.b}字。` }] } } : asset)) },
  } as Project, project.revision)
}

const tree = async (source: string) => {
  const names = (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/")).sort()
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, new Bun.CryptoHasher("sha256").update(await readFile(path.join(source, name))).digest("hex")] as const)))
}
const build = async (root: string, name: string, directory: string, fonts: readonly string[]) => {
  const source = path.join(root, name)
  await mkdir(source)
  return { source, built: await assembleBuildSource(directory, source, TEMPLATE, { glyphFonts: fonts }) }
}

test("补字: a TrueType face is read for its licence, its characters and its outline; a glyph is a 16-pixel cell, inked from its left edge", () => {
  for (const char of Object.values(RARE)) expect([fontHas("1.20.1", char.codePointAt(0)!), fontHas("1.21.1", char.codePointAt(0)!)]).toEqual([false, false])
  const face = readFace(tinyFont(OFL, [0x216b8]))!
  expect(openFontLicensed(face.names)).toBe(true)
  expect(openFontLicensed(readFace(tinyFont("All rights reserved.", [0x216b8]))!.names)).toBe(false)
  expect([face.glyph(0x216b8), face.glyph(0x24fe4), face.upem, face.outlines]).toEqual([1, 0, 1000, true])
  const cell = pixelGlyph(face, 0x216b8, GLYPH_LOOKS.sans)!
  expect([cell.length, ...new Set(cell.map((row) => row.length))]).toEqual([GLYPH_CELL, GLYPH_CELL])
  // The box: x 100–800 of 1000 is 1.6–12.8 pixels, moved to the left edge; y 800 to -100 under an em top of 880 is rows 1.28–15.68.
  const rows = cell.map((row) => row.some(Boolean))
  expect([rows.indexOf(true), rows.lastIndexOf(true)]).toEqual([1, 15])
  const columns = Array.from({ length: GLYPH_CELL }, (_, column) => cell.some((row) => row[column]))
  expect([columns.indexOf(true), columns.lastIndexOf(true)]).toEqual([0, 11])
  expect(pixelGlyph(face, 0x24fe4, GLYPH_LOOKS.sans)).toBeNull()
})

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`补字 ${target}: the characters the game cannot draw that an OFL font here has go into the mod as glyphs of unifont's size; the rest are said as boxes; the tree compiles`, async () => {
    const root = await fresh(target)
    const directory = path.join(root, "工程")
    await rareSample(directory, target)
    const { source, built } = await build(root, "source", directory, [await fontFolder()])
    const where = glyphPaths("book_sample")
    const read = (name: string) => readFile(path.join(source, "src/main/resources", name))
    expect(built.glyphFiles).toEqual([where.font, where.picture, where.license])
    const font = JSON.parse(String(await read(where.font))) as { providers: { type: string; file: string; height: number; ascent: number; chars: string[] }[] }
    // One bitmap provider added to the game's own default font, as tall and as high as unifont's glyphs, one row of the two characters in code-point order.
    expect(font).toEqual({ providers: [{ type: "bitmap", file: "book_sample:font/glyphs.png", height: 8, ascent: 7, chars: [RARE.a + RARE.b] }] })
    expect(String(await read(where.font))).not.toMatch(/[^\x00-\x7f]/)
    const picture = decodeRgbaPng(await read(where.picture))
    expect([picture.width, picture.height]).toEqual([2 * GLYPH_CELL, GLYPH_CELL])
    // White where inked, clear elsewhere: the game colours it with the text colour.
    expect(new Set(Array.from({ length: picture.width * picture.height }, (_, at) => picture.pixels.subarray(at * 4, at * 4 + 4).join(",")))).toEqual(new Set(["0,0,0,0", "255,255,255,255"]))
    const license = String(await read(where.license))
    expect(license).toContain("Tiny Sans: U+216B8 U+291D5")
    expect(license).toContain("Copyright 2026 Test Foundry.")
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007")
    expect(license).not.toContain("Tiny Sans: U+24FE4")
    expect(await readFile(path.join(source, "README-STUDIO.md"), "utf8")).toContain(`Characters Minecraft's fonts do not have (${RARE.a} ${RARE.b}) are drawn into ${where.picture} from Tiny Sans`)
    const version = target === "forge-1.20.1" ? "1.20.1" : "1.21.1"
    const said = built.findings.filter((finding) => finding.rule.startsWith("font_"))
    expect(said.map((finding) => [finding.rule, finding.stops, finding.about?.id])).toEqual([["font_filled", false, BOOK_IDS.quests], ["font_missing", false, BOOK_IDS.quests]])
    expect(said[0]!.text).toBe(`「北境${RARE.a}手册」的书名里的「${RARE.a}」，第 1 页的正文里的「${RARE.b}」在 Minecraft ${version} 的字体里没有，打包时已经补进模组：照这台电脑上的 Tiny Sans 画成和游戏里的字一样大的像素字「${RARE.a}」（U+216B8）「${RARE.b}」（U+291D5），字体许可（SIL OFL 1.1）随模组带上。`)
    expect(said[0]!.fix).toContain("只提醒")
    expect(said[1]!.text).toBe(`「北境${RARE.a}手册」的第 1 页的标题里的「${RARE.none}」在 Minecraft ${version} 的字体里没有，游戏里会显示成方框：「${RARE.none}」（U+24FE4）。`)
    expect(said[1]!.fix).toContain("补不上")
    expect(BUILD_WARNING_RULES.font_filled).toBe("advice")
    const javac = target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target
    if (!hasTargetJavac(javac)) return console.warn(`${target}: no javac class path here; the tree was not compiled`)
    const compiled = await targetJavac(javac, path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

test("补字: the three targets get the same glyph files for the same characters", async () => {
  const fonts = [await fontFolder()]
  const made = await Promise.all((["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const).map(async (target) => {
    const root = await fresh(`same-${target}`)
    const directory = path.join(root, "工程")
    await rareSample(directory, target)
    const { source } = await build(root, "source", directory, fonts)
    const files = await tree(path.join(source, "src/main/resources"))
    return Object.values(glyphPaths("book_sample")).map((name) => files[name])
  }))
  expect(made[0]!.every(Boolean)).toBe(true)
  expect(made[1]).toEqual(made[0]!)
  expect(made[2]).toEqual(made[0]!)
})

test("补字: a project whose words the game can all draw is generated byte for byte as without any font, and gets no glyph file", async () => {
  const root = await fresh("plain")
  const directory = path.join(root, "工程")
  await createBookSample(directory, "fabric-1.21.1")
  const fonts = await fontFolder()
  const withFonts = await build(root, "with", directory, [fonts])
  const without = await build(root, "without", directory, [])
  expect(withFonts.built.glyphFiles).toEqual([])
  expect(withFonts.built.findings.filter((finding) => finding.rule.startsWith("font_"))).toEqual([])
  const [a, b] = await Promise.all([tree(withFonts.source), tree(without.source)])
  // The time the backup was written is in no file; the build manifest names the revision only.
  expect(Object.keys(a)).toEqual(Object.keys(b))
  expect(Object.keys(a).filter((name) => /font\/|glyphs/.test(name))).toEqual([])
  expect(a).toEqual(b)
})

test("补字: with no font that has them, or only one whose licence does not let them go out, or turned off, nothing is added and the characters are said as before", async () => {
  const root = await fresh("none")
  const directory = path.join(root, "工程")
  await rareSample(directory, "fabric-1.21.1")
  const nowhere = await build(root, "nowhere", directory, [path.join(root, "没有这个文件夹")])
  const closed = await build(root, "closed", directory, [await fontFolder("All rights reserved. Not for redistribution.")])
  expect([nowhere.built.glyphFiles, closed.built.glyphFiles]).toEqual([[], []])
  for (const run of [nowhere, closed]) {
    const said = run.built.findings.filter((finding) => finding.rule.startsWith("font_"))
    expect(said.map((finding) => finding.rule)).toEqual(["font_missing"])
    expect(said[0]!.text).toContain(`「${RARE.a}」（U+216B8）「${RARE.none}」（U+24FE4）「${RARE.b}」（U+291D5）`)
    expect(said[0]!.fix).toContain("补不上")
  }
  expect(await tree(closed.source)).toEqual(await tree(nowhere.source))
  // Turned off in 模组信息: the font is there and not used.
  const off = path.join(root, "关掉")
  await rareSample(off, "fabric-1.21.1", { glyphs: "off" })
  const kept = await build(root, "off", off, [await fontFolder()])
  expect(kept.built.glyphFiles).toEqual([])
  const said = kept.built.findings.filter((finding) => finding.rule.startsWith("font_"))
  expect(said.map((finding) => finding.rule)).toEqual(["font_missing"])
  expect(said[0]!.fix).toContain("「模组信息」把「游戏字体里没有的字」改成「补成像素字」")
})

test("补字 ahead: the build panel is told which characters a pack made now fills, from which font, and which stay boxes", async () => {
  const root = await fresh("ahead")
  const directory = path.join(root, "工程")
  const project = await rareSample(directory, "fabric-1.21.1")
  const fonts = [await fontFolder()]
  expect(await glyphForecast(project, fonts)).toEqual({ filled: [{ char: RARE.a, family: "Tiny Sans" }, { char: RARE.b, family: "Tiny Sans" }], missing: [RARE.none], off: false })
  expect(await glyphForecast({ ...project, release: { glyphs: "off" } }, fonts)).toEqual({ filled: [], missing: [RARE.a, RARE.none, RARE.b], off: true })
  expect(await glyphForecast({ ...project, workspace: { assets: [] } }, fonts)).toBeNull()
  expect((await fillGlyphs([RARE.none], "book_sample", "sans", fonts)).files).toEqual({})
})

// The fonts the request names (r29c-丁): Noto Sans / Serif TC are the same faces as Source Han Sans / Serif and have both rare characters; skipped where they are not installed.
const NOTO = ["NotoSansTC-VF.ttf", "NotoSerifTC-VF.ttf"].map((name) => path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", name))
test.skipIf(!NOTO.every((file) => existsSync(file)))("补字 with this computer's Noto TC fonts: 黑体 by default, 宋体 when asked; both glyphs drawn", async () => {
  const sans = await fillGlyphs([RARE.b, RARE.a], "book_sample", "sans", NOTO)
  const serif = await fillGlyphs([RARE.a, RARE.b], "book_sample", "serif", NOTO)
  expect(sans.filled).toEqual([{ char: RARE.a, family: "Noto Sans TC" }, { char: RARE.b, family: "Noto Sans TC" }])
  expect(serif.filled.map((entry) => entry.family)).toEqual(["Noto Serif TC", "Noto Serif TC"])
  for (const made of [sans, serif]) {
    const picture = decodeRgbaPng(made.files[`src/main/resources/${glyphPaths("book_sample").picture}`] as Uint8Array)
    // Each glyph is inked, no wider than unifont's 16 columns, and its ink reaches above the baseline (row 14) as a character's does.
    for (const cell of [0, 1]) {
      const ink = (x: number, y: number) => picture.pixels[((y * picture.width) + cell * GLYPH_CELL + x) * 4 + 3]! > 0
      const rows = Array.from({ length: GLYPH_CELL }, (_, y) => Array.from({ length: GLYPH_CELL }, (_, x) => ink(x, y)).some(Boolean))
      expect(rows.indexOf(true)).toBeLessThan(4)
      expect(rows.lastIndexOf(true)).toBeGreaterThan(11)
    }
  }
  expect(String(sans.files[`src/main/resources/${glyphPaths("book_sample").license}`])).toContain("Reserved Font Name 'Source'")
}, 60000)

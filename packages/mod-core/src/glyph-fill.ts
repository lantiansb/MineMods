import { open, readdir, readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { GLYPH_CELL, GLYPH_LOOKS, faceNames, faceOffsets, faceTables, glyphLookup, openFontLicensed, pixelGlyph, readFace } from "./glyph-font"
import { OFL_TEXT } from "./ofl"
import { fontVersion, missingInLang, shownWords } from "./font-findings"
import type { Project } from "./project"
import { encodePng } from "./png"

/**
 * 补字 (E19): the characters a mod shows that the game's fonts (unifont too) cannot draw are drawn into the mod as 16-pixel glyphs, from a font
 * installed on this computer whose licence lets them go out with a mod (the SIL Open Font License 1.1, read off each font's own name table), and
 * added to the game's default font by a `minecraft:default` of the mod's own (resource packs' font files are merged, so the game's own glyphs stay).
 * No font is in the repository or downloaded: a computer with none that has a character leaves it as before, said by `font_missing`.
 */

/** Which kind of face is tried first: 黑体 (sans) draws closest to unifont's one-pixel strokes; 宋体 (serif) is the project's art font. */
export const GLYPH_STYLES = ["sans", "serif"] as const
export type GlyphStyle = (typeof GLYPH_STYLES)[number]

/** Where the mod's own glyphs go in the jar. Not named after any font: OFL's reserved names stay with the fonts themselves. */
export const glyphPaths = (mod: string) => ({
  font: "assets/minecraft/font/default.json",
  picture: `assets/${mod}/textures/font/glyphs.png`,
  license: "META-INF/licenses/glyphs-OFL.txt",
})

/** The folders this computer keeps its installed fonts in (the person's own too). */
export function fontFolders() {
  const home = os.homedir()
  if (process.platform === "win32")
    return [path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts"), ...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts")] : [])]
  if (process.platform === "darwin") return ["/System/Library/Fonts", "/Library/Fonts", path.join(home, "Library", "Fonts")]
  return ["/usr/share/fonts", "/usr/local/share/fonts", path.join(home, ".local", "share", "fonts"), path.join(home, ".fonts")]
}

type Candidate = { file: string; start: number; family: string; copyright: string; kind: keyof typeof GLYPH_LOOKS; region: number; has: (code: number) => boolean }

/** The font files under these places (a place may be a file), a few folders deep. */
async function fontFiles(places: readonly string[]): Promise<string[]> {
  const walk = async (place: string, depth: number): Promise<string[]> => {
    const facts = await stat(place).catch(() => null)
    if (!facts) return []
    if (facts.isFile()) return /\.(ttf|ttc|otf|otc)$/i.test(place) ? [place] : []
    if (!facts.isDirectory() || depth > 3) return []
    const names = await readdir(place).catch(() => [] as string[])
    return (await Promise.all(names.sort().map((name) => walk(path.join(place, name), depth + 1)))).flat()
  }
  return (await Promise.all(places.map((place) => walk(place, 0)))).flat()
}

/**
 * The faces of one font file that glyphs may be drawn from: OFL 1.1, outlines in `glyf`. Only the table directory, `name` and `cmap` are read, so
 * looking through a few hundred installed fonts is quick; kept by file, size and time for as long as the process runs.
 */
const known = new Map<string, Promise<Candidate[]>>()
function candidates(file: string) {
  const read = async () => {
    const facts = await stat(file)
    const key = `${file}|${facts.size}|${facts.mtimeMs}`
    const kept = known.get(key)
    if (kept) return kept
    const found = (async () => {
      const handle = await open(file, "r")
      const bytes = async (at: number, length: number) => {
        const buffer = new Uint8Array(Math.max(0, Math.min(length, facts.size - at)))
        await handle.read(buffer, 0, buffer.length, at)
        return buffer
      }
      const head = await bytes(0, 12 + 64 * 4)
      const faces = await Promise.all(faceOffsets(head).map(async (start) => {
        const top = await bytes(start, 12)
        const count = top.length === 12 ? (top[4]! << 8) | top[5]! : 0
        const tables = faceTables(await bytes(start, 12 + count * 16), 0)
        if (!tables?.["name"] || !tables["cmap"] || !tables["glyf"] || !tables["loca"]) return null
        const names = faceNames(await bytes(tables["name"][0], tables["name"][1]), { name: [0, tables["name"][1]] })
        if (!openFontLicensed(names)) return null
        const lookup = glyphLookup(await bytes(tables["cmap"][0], tables["cmap"][1]))
        const family = names[16] ?? names[1] ?? path.basename(file)
        const kind = /sans/i.test(family) || /gothic|hei|黑/i.test(family) ? "sans" : /serif|song|ming|宋|明/i.test(family) ? "serif" : "other"
        // Simplified Chinese first, then the other CJK regions of the same families, then anything else.
        const region = [/\bSC\b|SimpChinese|CN/, /\bTC\b|TradChinese|TW/, /\bHK\b/, /\bJP\b|Japanese/, /\bKR\b|Korean/, /CJK/].findIndex((pattern) => pattern.test(family))
        return { file, start, family, copyright: names[0] ?? "", kind, region: region < 0 ? 9 : region, has: (code: number) => lookup(code) !== 0 } satisfies Candidate
      })).finally(() => handle.close())
      return faces.filter((face) => face !== null)
    })()
    known.set(key, found)
    return found
  }
  return read().catch(() => [] as Candidate[])
}

/**
 * The faces under these places, looked through again at most once a minute. The build panel asks several times a second and keeps only the
 * newest answer (r29c-丁 found it never showing a slow one), so walking a few hundred font files at every ask is not an option; a font
 * installed a moment ago is found within the minute.
 */
const scans = new Map<string, { at: number; faces: Promise<Candidate[]> }>()
function installed(places: readonly string[]) {
  const key = places.join("\n")
  const kept = scans.get(key)
  if (kept && Date.now() - kept.at < 60_000) return kept.faces
  const faces = fontFiles(places).then(async (files) => (await Promise.all(files.map(candidates))).flat())
  scans.set(key, { at: Date.now(), faces })
  return faces
}

/** Every face glyphs may come from, in the order they are tried: the chosen kind first, then the other kind, then the rest; by region, then name. */
export async function glyphFonts(style: GlyphStyle, places: readonly string[] = fontFolders()) {
  const rank = (face: Candidate) => (face.kind === style ? 0 : face.kind === "other" ? 2 : 1)
  return [...(await installed(places))].sort((a, b) => rank(a) - rank(b) || a.region - b.region || a.family.localeCompare(b.family) || a.file.localeCompare(b.file) || a.start - b.start)
}

/** Which of these characters a font on this computer has, and which: what the build will fill, without drawing anything (the build panel says it ahead). */
export async function glyphSources(chars: readonly string[], style: GlyphStyle, places?: readonly string[]) {
  const fonts = chars.length ? await glyphFonts(style, places) : []
  return chars.map((char) => ({ char, font: fonts.find((face) => face.has(char.codePointAt(0)!)) ?? null }))
}

const escape = (text: string) => [...text].map((char) => char.split("").map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")).join("")

/**
 * Draws the characters a font here has and writes the mod's glyph files: the picture (16 cells a row), the `minecraft:default` that adds them
 * (one bitmap provider, as tall and as high as unifont's glyphs: 8 GUI pixels, ascent 7), and the licence with each font's copyright line.
 * `filled` and `missing` keep the characters' order; `files` is empty when nothing could be drawn, and then nothing of the mod changes.
 */
export async function fillGlyphs(chars: readonly string[], mod: string, style: GlyphStyle, places?: readonly string[]) {
  const sources = await glyphSources([...new Set(chars)].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!), style, places)
  const files = [...new Set(sources.flatMap((entry) => (entry.font ? [entry.font.file] : [])))]
  const bytes = new Map(await Promise.all(files.map(async (file) => [file, new Uint8Array(await readFile(file))] as const)))
  const faces = new Map<string, ReturnType<typeof readFace>>()
  const face = (font: Candidate) => {
    const key = `${font.file}#${font.start}`
    if (!faces.has(key)) faces.set(key, readFace(bytes.get(font.file)!, font.start))
    return faces.get(key)!
  }
  const drawn = sources.map((entry) => {
    const opened = entry.font ? face(entry.font) : null
    return { ...entry, glyph: opened && entry.font ? pixelGlyph(opened, entry.char.codePointAt(0)!, GLYPH_LOOKS[entry.font.kind]) : null }
  })
  const filled = drawn.flatMap((entry) => (entry.glyph && entry.font ? [{ char: entry.char, family: entry.font.family, copyright: entry.font.copyright, glyph: entry.glyph }] : []))
  const missing = chars.filter((char) => !filled.some((entry) => entry.char === char))
  if (!filled.length) return { filled: [], missing, files: {} as Record<string, string | Uint8Array> }
  const columns = Math.min(16, filled.length)
  const rows = Math.ceil(filled.length / columns)
  const width = columns * GLYPH_CELL
  const pixels = new Uint8Array(width * rows * GLYPH_CELL * 4)
  filled.forEach((entry, index) => entry.glyph.forEach((line, row) => line.forEach((on, column) => {
    if (!on) return
    const at = (((Math.floor(index / columns) * GLYPH_CELL + row) * width) + (index % columns) * GLYPH_CELL + column) * 4
    pixels.set([255, 255, 255, 255], at)
  })))
  const grid = Array.from({ length: rows }, (_, row) => filled.slice(row * columns, row * columns + columns).map((entry) => entry.char).join("") + "\u0000".repeat(Math.max(0, columns - filled.slice(row * columns, row * columns + columns).length)))
  const where = glyphPaths(mod)
  const fonts = [...new Map(filled.map((entry) => [entry.family, entry])).values()]
  const resources = "src/main/resources/"
  return {
    filled: filled.map((entry) => ({ char: entry.char, family: entry.family })),
    missing,
    files: {
      // Escaped, so the file is plain ASCII whatever reads it; the game reads the pairs of escapes back as one character each.
      [resources + where.font]: `{\n  "providers": [\n    {\n      "type": "bitmap",\n      "file": "${mod}:font/glyphs.png",\n      "height": 8,\n      "ascent": 7,\n      "chars": [\n${grid.map((line) => `        "${escape(line)}"`).join(",\n")}\n      ]\n    }\n  ]\n}\n`,
      [resources + where.picture]: encodePng(pixels, width, rows * GLYPH_CELL),
      [resources + where.license]: [
        `The pictures in ${where.picture} are ${filled.length} characters that Minecraft's own fonts do not have, drawn as 16-pixel glyphs from the fonts below`,
        "and added to the game's default font by assets/minecraft/font/default.json. They are a Modified Version of those fonts (pictures of a few of their",
        "glyphs), not the fonts themselves, and carry none of their names. They are licensed under the SIL Open Font License, Version 1.1, which follows;",
        "the rest of this mod is under its own licence.",
        "",
        ...fonts.flatMap((font) => [
          `${font.family}: ${filled.filter((entry) => entry.family === font.family).map((entry) => `U+${entry.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ")}`,
          font.copyright,
          "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
          "",
        ]),
        OFL_TEXT,
      ].join("\n"),
    } as Record<string, string | Uint8Array>,
  }
}

/**
 * What a build of the project as it is now will do about the characters the game cannot draw, said ahead in the build panel: which a font here
 * has (and which font), which stay boxes, and whether 补字 is off. Null when the names and books have none. Measured on the project's own target.
 */
export async function glyphForecast(project: Pick<Project, "target" | "release" | "blocks" | "items" | "entities" | "workspace">, places?: readonly string[]) {
  const wanted = missingInLang(fontVersion(project.target), { words: shownWords(project) })
  if (!wanted.length) return null
  if (project.release?.glyphs === "off") return { filled: [], missing: wanted, off: true }
  const sources = await glyphSources(wanted, project.release?.glyphs === "serif" ? "serif" : "sans", places)
  return {
    filled: sources.flatMap((entry) => (entry.font ? [{ char: entry.char, family: entry.font.family }] : [])),
    missing: wanted.filter((char) => !sources.some((entry) => entry.char === char && entry.font)),
    off: false,
  }
}

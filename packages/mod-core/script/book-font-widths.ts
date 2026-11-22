import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { unzipSync } from "fflate"
import { decodeRgbaPng } from "../src/png-decode"

/**
 * Writes `src/book-font-data.ts`: how far the game's default font moves on after each character of the Basic Multilingual Plane, the
 * number `Font.width` adds up, read off the game's own font files the way the game reads them (`BitmapProvider`: the last column with a
 * visible pixel, plus one; `UnihexProvider`: the set columns, or the size override, halved, plus one; `include/space`). Both game versions'
 * files are read and each character keeps the wider of the two, so a page the check passes fits in either.
 *
 *   bun packages/mod-core/script/book-font-widths.ts <1.21.1 client jar> <1.20.1 client assets jar> <assets folder with indexes/ and objects/>
 *
 * The jars are the game's own (Studio's runtime has them: `scene/fabric-1.21.1/client-libs/minecraft-client-1.21.1.jar`, and Forge's
 * `client-extra-1.20.1-*.jar`); the unifont files come from the asset index (17 for 1.21.1, 5 for 1.20.1). Nothing of the game is copied
 * into the repository: only the numbers.
 */
const [modern, legacy, assets] = process.argv.slice(2)
if (!modern || !legacy || !assets) throw new Error("Usage: bun packages/mod-core/script/book-font-widths.ts <1.21.1 client jar> <1.20.1 client jar> <assets folder>")

type Provider = { type: string; file?: string; height?: number; ascent?: number; chars?: string[]; advances?: Record<string, number>; hex_file?: string; size_overrides?: { from: string; to: string; left: number; right: number }[]; filter?: Record<string, boolean> }
const lenient = (text: string) => JSON.parse(text.replace(/,(\s*[\]}])/g, "$1")) as { providers: Provider[] }
const decoder = new TextDecoder()

async function advances(jar: string, index: string) {
  const files = unzipSync(await readFile(jar), { filter: (entry) => entry.name.startsWith("assets/minecraft/font/") || entry.name.startsWith("assets/minecraft/textures/font/") })
  const objects = (JSON.parse(await readFile(path.join(assets, "indexes", `${index}.json`), "utf8")) as { objects: Record<string, { hash: string }> }).objects
  const object = (name: string) => readFile(path.join(assets, "objects", objects[name]!.hash.slice(0, 2), objects[name]!.hash))
  const found = new Map<number, number>()
  const put = (code: number, advance: number) => { if (!found.has(code)) found.set(code, advance) }
  // default.json: space, then the bitmaps (include/default, not forced unicode), then unifont (from the asset index, not the jar).
  const space = lenient(decoder.decode(files["assets/minecraft/font/include/space.json"]!)).providers
  const bitmaps = lenient(decoder.decode(files["assets/minecraft/font/include/default.json"]!)).providers
  const unifont = lenient(decoder.decode(await object("minecraft/font/include/unifont.json"))).providers.filter((provider) => !provider.filter?.jp)
  for (const provider of space) for (const [char, advance] of Object.entries(provider.advances ?? {})) put(char.codePointAt(0)!, advance)
  for (const provider of bitmaps) {
    if (provider.type !== "bitmap") continue
    const name = `assets/minecraft/textures/${provider.file!.replace("minecraft:", "")}`
    const image = decodeRgbaPng(files[name]!)
    const rows = provider.chars!.map((row) => [...row].map((char) => char.codePointAt(0)!))
    const cellWidth = image.width / rows[0]!.length
    const cellHeight = image.height / rows.length
    const scale = (provider.height ?? 8) / cellHeight
    rows.forEach((row, y) => row.forEach((code, x) => {
      if (code === 0) return
      const visible = (column: number) => Array.from({ length: cellHeight }, (_, line) => image.pixels[((y * cellHeight + line) * image.width + x * cellWidth + column) * 4 + 3]!).some(Boolean)
      const width = Array.from({ length: cellWidth }, (_, column) => cellWidth - 1 - column).find(visible)
      put(code, Math.floor(0.5 + ((width ?? -1) + 1) * scale) + 1)
    }))
  }
  for (const provider of unifont) {
    const zip = unzipSync(await object(`minecraft/${provider.hex_file!.replace("minecraft:", "")}`))
    const overrides = provider.size_overrides ?? []
    for (const [name, bytes] of Object.entries(zip)) {
      if (!name.endsWith(".hex")) continue
      for (const line of decoder.decode(bytes).split(/\r?\n/)) {
        const [code, data] = line.split(":")
        if (!code || !data) continue
        const point = parseInt(code, 16)
        if (point > 0xffff) continue
        const bitWidth = data.length * 4 / 16
        const override = overrides.find((range) => point >= range.from.codePointAt(0)! && point <= range.to.codePointAt(0)!)
        const mask = Array.from({ length: 16 }, (_, row) => (parseInt(data.slice(row * bitWidth / 4, (row + 1) * bitWidth / 4), 16) << (32 - bitWidth)) >>> 0).reduce((all, value) => (all | value) >>> 0, 0)
        const left = override ? override.left : mask === 0 ? 0 : Math.clz32(mask)
        const right = override ? override.right : mask === 0 ? bitWidth : 31 - (31 - Math.clz32(mask & -mask))
        put(point, Math.floor((right - left + 1) / 2) + 1)
      }
    }
  }
  return found
}

const both = [await advances(modern, "17"), await advances(legacy, "5")]
const differ = [...both[0]!.keys()].filter((code) => both[1]!.has(code) && both[1]!.get(code) !== both[0]!.get(code)).length
// Run-length over the BMP: "advance:count" pieces; a character no font has is the missing glyph's 6, written as such.
const runs: [number, number][] = []
for (let code = 0; code <= 0xffff; code++) {
  const advance = Math.max(both[0]!.get(code) ?? 6, both[1]!.get(code) ?? 6)
  const last = runs.at(-1)
  if (last && last[0] === advance) last[1] += 1
  else runs.push([advance, 1])
}
const encoded = runs.map(([advance, count]) => count === 1 ? advance.toString(36) : `${advance.toString(36)}.${count.toString(36)}`).join(",")
const out = path.join(import.meta.dir, "../src/book-font-data.ts")
await writeFile(out, `// Generated by script/book-font-widths.ts from the game's own font files (1.21.1 and 1.20.1, the wider of the two). Do not edit.
/** The default font's advance of every BMP character, as base-36 "advance.count" runs from U+0000 (a single one has no count). */
export const FONT_ADVANCES = ${JSON.stringify(encoded)}
`)
console.log(`wrote ${out}: ${runs.length} runs, ${encoded.length} characters; ${differ} characters differ between the two versions`)
for (const sample of ["中", "，", "。", "“", "a", "i", "l", "W", " ", "1", "!", "：", "—", "…"]) console.log(sample, both[0]!.get(sample.codePointAt(0)!), both[1]!.get(sample.codePointAt(0)!))

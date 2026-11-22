import type { Project } from "./project"
import type { Finding } from "./reconcile"
import { FONT_COVERAGE } from "./game-font-coverage"
import { creatureName } from "./gameplay"
import { bookName } from "./common/book"
import { assetRef } from "./finding-refs"

type Version = keyof typeof FONT_COVERAGE
/** The runs of code points a version's font draws, as [start, end) pairs in order. */
const runs = Object.fromEntries((Object.keys(FONT_COVERAGE) as Version[]).map((version) => {
  let end = 0
  return [version, FONT_COVERAGE[version].split(",").map((piece) => {
    const [gap, length] = piece.split(".").map((value) => parseInt(value, 36)) as [number, number]
    const start = end + gap
    end = start + length
    return [start, end] as const
  })]
})) as Record<Version, (readonly [number, number])[]>

/** The game version whose fonts a target's game has. */
export const fontVersion = (target: string): Version => (target.includes("1.20.1") ? "1.20.1" : "1.21.1")

/** Whether the default font of that game version draws the character (a line break and the controls the game skips count as drawn). */
export function fontHas(version: Version, code: number) {
  if (code < 0x20) return true
  const list = runs[version]
  let low = 0, high = list.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const [start, end] = list[middle]!
    if (code < start) high = middle - 1
    else if (code >= end) low = middle + 1
    else return true
  }
  return false
}

/** The characters of a text that font cannot draw, once each, in the order they come. */
export const missingGlyphs = (version: Version, text: string) => [...new Set([...text].filter((char) => !fontHas(version, char.codePointAt(0)!)))]

/** Every character the game's font of that version cannot draw, in any of these language files, once each, in the order they come. */
export const missingInLang = (version: Version, lang: Readonly<Record<string, Readonly<Record<string, string>>>>) =>
  [...new Set(Object.values(lang).flatMap((words) => Object.values(words).flatMap((text) => missingGlyphs(version, text))))]

/** What the build did about them (补字, `glyph-fill.ts`): which it drew into the mod and from which font, and whether the person turned it off. */
export type GlyphFacts = { filled: readonly { char: string; family: string }[]; off: boolean; /** The target this build was for, when it is not the project's own. */ target?: string }

const code = (char: string) => `「${char}」（U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}）`

/**
 * Characters the game cannot draw (缺字): the target's default font has no glyph for them, so the game shows an empty box. Read off the language
 * files the build just wrote, which hold every word the mod shows (names, a book's pages, subtitles, a boss's bar); one finding per thing, with
 * the fields that have them. Those the build drew into the mod (补字) are said as filled, from which font; the rest as before, with what to do.
 */
export function fontFindings(project: Pick<Project, "mod_id" | "target" | "blocks" | "items" | "entities" | "workspace">, lang: Readonly<Record<"zh_cn" | "en_us", Readonly<Record<string, string>>>>, glyphs?: GlyphFacts): Finding[] {
  const version = fontVersion(glyphs?.target ?? project.target)
  const mod = project.mod_id
  const books = project.workspace.assets.flatMap((asset) => (asset.document.kind === "book" ? [{ id: asset.id, title: asset.title, name: asset.document.name, document: asset.document }] : []))
  // Which thing a key is the words of, and what it is of that thing.
  const owner = (key: string): { about: Finding["about"]; ref: ReturnType<typeof assetRef> | null; field: string } => {
    const block = project.blocks.find((value) => key === `block.${mod}.${value.identifier}`)
    if (block) return { about: { kind: "block", id: block.id, name: block.name }, ref: null, field: "名字" }
    const item = project.items.find((value) => key === `item.${mod}.${value.identifier}`)
    if (item) return { about: { kind: "item", id: item.id, name: item.name }, ref: null, field: "名字" }
    const entity = project.entities.find((value) => key === `entity.${mod}.${creatureName(value)}` || key === `item.${mod}.${creatureName(value)}_spawn_egg`)
    if (entity) return { about: { kind: "entity", id: entity.id, name: entity.name }, ref: null, field: key.endsWith("_spawn_egg") ? "刷怪蛋的名字" : "名字" }
    const book = books.find((value) => key === `item.${mod}.${bookName(value)}` || key.startsWith(`book.${mod}.${bookName(value)}.`))
    if (book) {
      const rest = key.slice(`book.${mod}.${bookName(book)}.`.length).split(".")
      const part = { title: "标题", body: "正文", margin: "页边小字" }[rest[1] ?? ""]
      return { about: { kind: "book", id: book.id, name: book.name }, ref: assetRef(book.id, book.title), field: key.startsWith("item.") ? "书名" : rest[0] === "author" ? "署名" : `第 ${rest[0]} 页的${part ?? "文字"}` }
    }
    return { about: null, ref: null, field: `「${key}」` }
  }
  const found = new Map<string, { about: Finding["about"]; ref: ReturnType<typeof assetRef> | null; places: Map<string, Set<string>> }>()
  for (const locale of ["zh_cn", "en_us"] as const)
    for (const [key, text] of Object.entries(lang[locale])) {
      const missing = missingGlyphs(version, text)
      if (!missing.length) continue
      const place = owner(key)
      const id = place.about ? `${place.about.kind}:${place.about.id}` : "mod"
      const entry = found.get(id) ?? { about: place.about, ref: place.ref, places: new Map() }
      found.set(id, entry)
      const chars = entry.places.get(place.field) ?? new Set<string>()
      entry.places.set(place.field, chars)
      missing.forEach((char) => chars.add(char))
    }
  const from = new Map((glyphs?.filled ?? []).map((entry) => [entry.char, entry.family]))
  return [...found.values()].flatMap((entry) => {
    const words = (keep: (char: string) => boolean) => {
      const places = [...entry.places.entries()].map(([field, chars]) => [field, [...chars].filter(keep)] as const).filter(([, chars]) => chars.length)
      return { all: [...new Set(places.flatMap(([, chars]) => chars))], where: places.map(([field, chars]) => `${field}里的${chars.map((char) => `「${char}」`).join("")}`).join("，") }
    }
    const subject = entry.about ? `「${entry.about.name}」的` : "模组里有"
    const base = { stops: false, about: entry.about, ...(entry.ref ? { refs: [entry.ref] } : {}) }
    const filled = words((char) => from.has(char))
    const left = words((char) => !from.has(char))
    const families = [...new Set(filled.all.map((char) => from.get(char)!))].join("、")
    return [
      ...(filled.all.length
        ? [{
            ...base,
            rule: "font_filled" as const,
            text: `${subject}${filled.where}在 Minecraft ${version} 的字体里没有，打包时已经补进模组：照这台电脑上的 ${families} 画成和游戏里的字一样大的像素字${filled.all.map(code).join("")}，字体许可（SIL OFL 1.1）随模组带上。`,
            fix: "进游戏看一眼这几个字和旁边的字放在一起顺不顺眼。不想补，到「模组信息」把「游戏字体里没有的字」改成「只提醒」。",
          }]
        : []),
      ...(left.all.length
        ? [{
            ...base,
            rule: "font_missing" as const,
            text: `${subject}${left.where}在 Minecraft ${version} 的字体里没有，游戏里会显示成方框：${left.all.map(code).join("")}。`,
            fix: glyphs?.off
              ? "换一个常用的同义字或同音字；一定要用这个字，到「模组信息」把「游戏字体里没有的字」改成「补成像素字」，打包时会从这台电脑上的开源字体补进模组。"
              : "换一个常用的同义字或同音字。一定要用这个字：这台电脑上装的开源字体（许可是 SIL OFL 1.1 的）里也没有它，补不上；装一套有这个字的 OFL 字体再打包，会自动补进模组。",
          }]
        : []),
    ] satisfies Finding[]
  })
}

/**
 * The words a mod will show that are known before it is built: every block's, item's and creature's name and every book's words, in both
 * languages. What a build window says ahead (补字, the build panel) is read off these; the build itself reads its language files, which hold more.
 */
export function shownWords(project: Pick<Project, "blocks" | "items" | "entities" | "workspace">) {
  const named = [...project.blocks, ...project.items, ...project.entities].flatMap((thing) => [thing.name, thing.name_en ?? ""])
  const books = project.workspace.assets.flatMap((asset) => {
    if (asset.document.kind !== "book") return []
    const book = asset.document
    return [book.name, book.name_en ?? "", book.author ?? "", ...book.pages.flatMap((page) => [page.title ?? "", page.body, page.margin ?? "", page.title_en ?? "", page.body_en ?? "", page.margin_en ?? ""])]
  })
  return Object.fromEntries([...named, ...books].filter(Boolean).map((text, index) => [String(index), text]))
}

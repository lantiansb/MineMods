import { z } from "zod"
import type { FindingRef, StandardOutline } from "@minemods/studio-ai/acceptance"
import { assetRef } from "./finding-refs"
import { FONT_ADVANCES } from "./book-font-data"
import { hasCjk } from "./data-words"
import { REGISTRY_NAME_INSTRUCTIONS, RegistryNameSchema } from "./registry-name"

/**
 * 书（book）: a book the player is given, read on a page screen of the mod's own (not the game's written book). Its pages are fixed when the
 * mod is built; a later version may unlock them with the player's progress. A manual, a bestiary and a quest log are each one of these.
 *
 * The limits were promised to whoever writes the content before this was built, so they are fixed: a page that does not fit is said, never cut.
 */
export const BOOK_LIMITS = { name: 24, name_en: 48, author: 24, pages: 64, title: 16, title_en: 40, body: 320, body_image: 160, body_en: 800, margin: 60, margin_en: 160 } as const

/**
 * The page as the game draws it, in GUI pixels: the screen (`common/book.ts`) and the check below read these same numbers. The default window
 * (854×480 at GUI scale 2) is 240 high, so the whole panel is 230. Text is the game's font at 9 pixels a line; the margin note is drawn at the
 * text's own size in a fainter ink (r29: three quarters blurred at the default GUI scale), the page number three pixels lower to make room for
 * its second line. A book that asks for the small note (`margin_small`) is drawn at three quarters with the number where it was, as r28 drew
 * every book. The picture is 216×108 above the text.
 */
export const BOOK_PAGE = {
  panel: { width: 302, height: 230 },
  text: { left: 16, width: 270 },
  title_top: 10,
  body_top: 24,
  line: 9,
  body_lines: 19,
  image: { width: 216, height: 108, gap: 4 },
  margin: { top: 198, scale: 1, small: 0.75, lines: 2 },
  number_top: 218,
  number_top_small: 215,
  cover: { title_top: 56, scale: 2, wrap: 130, lines: 3, author_top: 176 },
} as const

/** The scale a book's margin notes are drawn at. */
export const marginScale = (book: { margin_small?: boolean }) => (book.margin_small ? BOOK_PAGE.margin.small : BOOK_PAGE.margin.scale)

/** The inks of a page that names none: dark brown text on cream paper, the note a faded brown. */
export const BOOK_INK = { paper: "#f4ebd3", body: "#2b2118", title: "#4a2f1a", margin: "#8a7a66" } as const

/**
 * The pictures a book's look may name, each a texture of the project, with the shape it is drawn in: the cover, both kinds of paper and the
 * frame fill the whole panel (302×230; drawn twice as fine at 604×460, which is one texture pixel to one screen pixel at GUI scale 2); the item's
 * icon is square. Also where the text falls, for whoever draws them: scorch marks and ornaments keep out of these boxes.
 */
export const BOOK_LOOK_SLOTS = {
  cover: { label: "封面图", width: 302, height: 230, size: "604×460" },
  paper: { label: "内页底图", width: 302, height: 230, size: "604×460" },
  paper_even: { label: "双数页的内页底图", width: 302, height: 230, size: "604×460" },
  frame: { label: "页边框", width: 302, height: 230, size: "604×460" },
  icon: { label: "物品图标", width: 16, height: 16, size: "16×16" },
} as const
export type BookLookSlot = keyof typeof BOOK_LOOK_SLOTS
/** The colour drawn see-through in a frame and an icon when the look names none: magenta, the colour nobody draws with. */
export const BOOK_FRAME_CLEAR = "#ff00ff"

/** Where the words fall on the panel, in GUI pixels (left, top, right, bottom): what a page's paper and frame keep clear. */
export const BOOK_TEXT_BOXES = {
  title: [16, 10, 286, 18],
  body: [16, 24, 286, 195],
  margin: [16, 198, 286, 215],
  number: [131, 218, 171, 226],
  cover_title: [28, 56, 288, 116],
  cover_author: [28, 176, 288, 184],
} as const

/** Lines of text below a picture: the 19 lines less the picture and its gap. */
export const BOOK_IMAGE_LINES = Math.floor((BOOK_PAGE.body_lines * BOOK_PAGE.line - BOOK_PAGE.image.height - BOOK_PAGE.image.gap) / BOOK_PAGE.line)
/** Kraft paper: a book that names no colour of its own. */
export const BOOK_DEFAULT_COLOR = "#b08a5b"

const advances = (() => {
  const table = new Uint8Array(0x10000)
  let code = 0
  for (const run of FONT_ADVANCES.split(",")) {
    const [advance, count] = run.split(".")
    const width = parseInt(advance!, 36)
    const times = count ? parseInt(count, 36) : 1
    table.fill(width, code, code + times)
    code += times
  }
  return table
})()

/** How far the game's default font moves on after one character (beyond the BMP: the widest glyph, so nothing is under-measured). */
export const advance = (code: number) => (code === 10 ? 0 : code < 0x10000 ? advances[code]! : 9)
export const textWidth = (text: string) => [...text].reduce((sum, char) => sum + advance(char.codePointAt(0)!), 0)

/**
 * The game's own line breaking (`StringSplitter.splitLines`): a line ends at a newline, or before the character that would take it past
 * `width` (at the last space on the line when there is one, which is then dropped). A text that ends with a newline has an empty last line.
 */
export function splitLines(text: string, width: number) {
  const chars = [...text]
  const lines: string[] = []
  let start = 0
  let broke = false
  while (start < chars.length) {
    let used = 0
    let space = -1
    let wide = false
    let end = start
    let cut = -1
    for (; end < chars.length; end++) {
      const char = chars[end]!
      if (char === "\n") { cut = end; break }
      if (char === " ") space = end
      const step = advance(char.codePointAt(0)!)
      used += step
      if (wide && used > width) { cut = space !== -1 ? space : end; break }
      wide ||= step !== 0
    }
    if (cut === -1) {
      lines.push(chars.slice(start).join(""))
      return lines
    }
    lines.push(chars.slice(start, cut).join(""))
    const skip = chars[cut] === "\n" || chars[cut] === " "
    broke = chars[cut] === "\n"
    start = cut + (skip ? 1 : 0)
  }
  if (broke) lines.push("")
  return lines
}

/** Characters as the limits count them: every one but a line break. */
export const charCount = (text: string) => [...text].filter((char) => char !== "\n" && char !== "\r").length

const counted = (limit: number, what: string) => z.string().refine((text) => charCount(text) <= limit, { message: `${what}最多 ${limit} 字（换行不算）。` })
const english = (limit: number, what: string) => counted(limit, what).refine((text) => !hasCjk(text), `${what}里不能有中文；没有英文就不写这一项，游戏里会显示中文。`)

export const BookPageSchema = z.strictObject({
  title: counted(BOOK_LIMITS.title, "页标题").refine((text) => !text.includes("\n"), "页标题只有一行，不能换行。").optional(),
  title_en: english(BOOK_LIMITS.title_en, "英文页标题").refine((text) => !text.includes("\n"), "页标题只有一行，不能换行。").optional(),
  body: counted(BOOK_LIMITS.body, "正文"),
  body_en: english(BOOK_LIMITS.body_en, "英文正文").optional(),
  image: z.uuid().nullable().optional(),
  margin: counted(BOOK_LIMITS.margin, "页边小字").optional(),
  margin_en: english(BOOK_LIMITS.margin_en, "英文页边小字").optional(),
})
export type BookPage = z.infer<typeof BookPageSchema>

const ink = (what: string) => z.string().regex(/^#[0-9a-fA-F]{6}$/, `${what}写成 #rrggbb，比如 #3a2412。`).optional()

/**
 * How a book looks beyond its colour: pictures of the project for its cover, its paper, a frame laid over the paper and its icon, and the ink of
 * its words. Every picture is a texture asset of the project, so the book depends on it and the texture shows who uses it. A book without a look
 * is drawn and built as r28 drew it.
 */
export const BookLookSchema = z.strictObject({
  cover: z.uuid().optional(),
  /** true: the cover picture has the title drawn into it, so neither the title nor the author is printed on it. */
  title_in_cover: z.boolean().optional(),
  paper: z.uuid().optional(),
  paper_even: z.uuid().optional(),
  frame: z.uuid().optional(),
  /** The colour drawn see-through in the frame and the icon (pictures have no transparency of their own). */
  clear_color: ink("边框和图标里画成透明的颜色"),
  body_color: ink("正文颜色"),
  title_color: ink("页标题颜色"),
  margin_color: ink("页边小字颜色"),
  icon: z.uuid().optional(),
})
export type BookLook = z.infer<typeof BookLookSchema>

export const BookDocumentSchema = z.strictObject({
  kind: z.literal("book"),
  name: z.string().trim().min(1, "书名不能空着。").refine((text) => charCount(text) <= BOOK_LIMITS.name, `书名最多 ${BOOK_LIMITS.name} 字。`).refine((text) => !text.includes("\n"), "书名只有一行。"),
  name_en: z.string().trim().min(1).refine((text) => charCount(text) <= BOOK_LIMITS.name_en, `英文书名最多 ${BOOK_LIMITS.name_en} 个字母。`).refine((text) => !hasCjk(text), "英文书名里不能有中文。").optional(),
  /** r29b: the name the game registers the book's item by; absent: `book_<its id>`, as every book had (`bookName`). */
  identifier: RegistryNameSchema.nullable().optional(),
  author: z.string().trim().refine((text) => charCount(text) <= BOOK_LIMITS.author, `署名最多 ${BOOK_LIMITS.author} 字。`).refine((text) => !text.includes("\n"), "署名只有一行。").optional(),
  cover_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "封面颜色写成 #rrggbb，比如 #8a4b2d。").optional(),
  give_on_first_join: z.boolean().default(true),
  keep_on_death: z.boolean().default(true),
  pages: z.array(BookPageSchema).min(1, "一本书至少要有一页。").max(BOOK_LIMITS.pages, `一本书最多 ${BOOK_LIMITS.pages} 页。`),
  /** true: the margin notes drawn at three quarters, as every book was before r29 (they then hold a third more). */
  margin_small: z.boolean().optional(),
  look: BookLookSchema.optional(),
}).superRefine((book, context) => {
  book.pages.forEach((page, index) => {
    if (page.image && charCount(page.body) > BOOK_LIMITS.body_image)
      context.addIssue({ code: "custom", path: ["pages", index, "body"], message: `第 ${index + 1} 页有图，正文最多 ${BOOK_LIMITS.body_image} 字（现在 ${charCount(page.body)} 字）；去掉图，或者把一部分挪到下一页。` })
  })
  if (book.look?.title_in_cover && !book.look.cover)
    context.addIssue({ code: "custom", path: ["look", "title_in_cover"], message: "不印书名要配一张自己画了书名的封面图（look.cover）；没有封面图就把书名印上。" })
})
export type BookDocument = z.infer<typeof BookDocumentSchema>
type BookInput = z.input<typeof BookDocumentSchema>

/** The look's pictures by slot, in the order the slots are listed. */
export const bookLookImages = (look: BookLook | undefined) =>
  (Object.keys(BOOK_LOOK_SLOTS) as BookLookSlot[]).flatMap((slot) => (look?.[slot] ? [[slot, look[slot]] as const] : []))

/** The ids of the pictures a book shows (its pages', then its look's), once each. */
export const bookImageIds = (book: Pick<BookInput, "pages" | "look">) => [...new Set([...book.pages.flatMap((page) => (page.image ? [page.image] : [])), ...bookLookImages(book.look).map(([, id]) => id)])]

export type BookLanguage = "zh" | "en"
/** What a page shows in a language: the English when written, else the Chinese, as the game does with a key its language lacks. */
export const pageText = (page: BookPage, language: BookLanguage) => ({
  title: (language === "en" ? page.title_en : undefined) ?? page.title ?? "",
  body: (language === "en" ? page.body_en : undefined) ?? page.body,
  margin: (language === "en" ? page.margin_en : undefined) ?? page.margin ?? "",
})

/** One page laid out as the game lays it out: its lines, how many fit, and by how much each part is over. */
export function bookPageLayout(page: BookPage, language: BookLanguage, small = false) {
  const text = pageText(page, language)
  const lines = text.body ? splitLines(text.body, BOOK_PAGE.text.width) : []
  const room = page.image ? BOOK_IMAGE_LINES : BOOK_PAGE.body_lines
  const marginWidth = Math.floor(BOOK_PAGE.text.width / marginScale({ margin_small: small }))
  const margin = text.margin ? splitLines(text.margin, marginWidth) : []
  const titleWidth = textWidth(text.title)
  return {
    text,
    title: { width: titleWidth, over: Math.max(0, titleWidth - BOOK_PAGE.text.width) },
    body: { lines, room, over: Math.max(0, lines.length - room) },
    margin: { lines: margin, room: BOOK_PAGE.margin.lines, over: Math.max(0, margin.length - BOOK_PAGE.margin.lines) },
  }
}

/** The cover's title as the game wraps it at twice the size. */
export function bookCoverLayout(name: string) {
  const lines = splitLines(name, BOOK_PAGE.cover.wrap)
  return { lines, over: Math.max(0, lines.length - BOOK_PAGE.cover.lines) }
}

/** How many characters of one kind fill a page: what the person writing is told. */
export function bookCapacity(sample = "字") {
  const perLine = Math.floor(BOOK_PAGE.text.width / textWidth(sample))
  return { perLine, plain: perLine * BOOK_PAGE.body_lines, image: perLine * BOOK_IMAGE_LINES, lines: BOOK_PAGE.body_lines, imageLines: BOOK_IMAGE_LINES }
}

/** How many characters of one kind the margin note holds: per line at its scale, and its two lines. */
export function marginCapacity(small = false, sample = "字") {
  const perLine = Math.floor(Math.floor(BOOK_PAGE.text.width / marginScale({ margin_small: small })) / textWidth(sample))
  return { perLine, lines: BOOK_PAGE.margin.lines, total: perLine * BOOK_PAGE.margin.lines }
}

/** A texture as a book reads it: its size and its indexed pixels. */
export type BookTexture = { width: number; height: number; palette: readonly string[]; pixels: readonly number[] }
const rgb = (color: string) => [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16)) as [number, number, number]
const hexOf = (channels: readonly number[]) => `#${channels.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`

/**
 * The mean colour of a texture under a box of the panel (GUI pixels; the texture is stretched over the whole panel), leaving out the frame's
 * see-through colour. null when nothing of it is under the box.
 */
export function textureTone(texture: BookTexture, box: readonly [number, number, number, number], clear?: string) {
  const sx = texture.width / BOOK_PAGE.panel.width, sy = texture.height / BOOK_PAGE.panel.height
  const [left, top, right, bottom] = [Math.floor(box[0] * sx), Math.floor(box[1] * sy), Math.ceil(box[2] * sx), Math.ceil(box[3] * sy)]
  const skip = clear?.toLowerCase()
  const sum = [0, 0, 0]
  let count = 0
  for (let y = Math.max(0, top); y < Math.min(texture.height, bottom); y++)
    for (let x = Math.max(0, left); x < Math.min(texture.width, right); x++) {
      const color = texture.palette[texture.pixels[y * texture.width + x]!]!.toLowerCase()
      if (color === skip) continue
      rgb(color).forEach((value, at) => (sum[at]! += value))
      count++
    }
  return count ? hexOf(sum.map((value) => value / count)) : null
}

/** The mean colour the page shows under a box, pixel by GUI pixel: the frame where it is not see-through, else the paper (or the plain cream). */
export function pageTone(paper: BookTexture | null, frame: BookTexture | null, clear: string, box: readonly [number, number, number, number]) {
  const skip = clear.toLowerCase()
  const sample = (texture: BookTexture, x: number, y: number) => {
    const at = Math.min(texture.height - 1, Math.floor(((y + 0.5) * texture.height) / BOOK_PAGE.panel.height)) * texture.width + Math.min(texture.width - 1, Math.floor(((x + 0.5) * texture.width) / BOOK_PAGE.panel.width))
    return texture.palette[texture.pixels[at]!]!.toLowerCase()
  }
  const sum = [0, 0, 0]
  let count = 0
  for (let y = box[1]; y < box[3]; y++)
    for (let x = box[0]; x < box[2]; x++) {
      const over = frame ? sample(frame, x, y) : skip
      rgb(over !== skip ? over : paper ? sample(paper, x, y) : BOOK_INK.paper).forEach((value, at) => (sum[at]! += value))
      count++
    }
  return hexOf(sum.map((value) => value / count))
}

/** How much of a box (GUI pixels) a frame draws over: the share of its pixels there that are not the see-through colour. */
export function frameCover(frame: BookTexture, clear: string, box: readonly [number, number, number, number]) {
  const skip = clear.toLowerCase()
  let over = 0, count = 0
  for (let y = box[1]; y < box[3]; y++)
    for (let x = box[0]; x < box[2]; x++) {
      const at = Math.min(frame.height - 1, Math.floor(((y + 0.5) * frame.height) / BOOK_PAGE.panel.height)) * frame.width + Math.min(frame.width - 1, Math.floor(((x + 0.5) * frame.width) / BOOK_PAGE.panel.width))
      if (frame.palette[frame.pixels[at]!]!.toLowerCase() !== skip) over++
      count++
    }
  return count ? over / count : 0
}

/** Relative luminance and contrast as WCAG measures them: 1 is none, 21 black on white; text wants 4.5, faint text 3. */
const luminance = (color: string) => {
  const [red, green, blue] = rgb(color).map((value) => value / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!
}
export const contrast = (one: string, two: string) => {
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}
/** A colour near the one given that reads on the ground: the same hue taken darker (on a light ground) or lighter, step by step, until it does. */
export function readableOn(color: string, ground: string, need: number) {
  const toward = luminance(ground) > 0.18 ? [0, 0, 0] : [255, 255, 255]
  const steps = Array.from({ length: 20 }, (_, step) => hexOf(rgb(color).map((value, at) => value + (toward[at]! - value) * ((step + 1) / 20))))
  return steps.find((value) => contrast(value, ground) >= need) ?? hexOf(toward)
}

/** What each ink of a page needs against its paper: the note is faint by design, so it wants less. */
export const BOOK_CONTRAST = { body: 4.5, title: 4.5, margin: 3, cover: 3 } as const

/** The look's inks with the defaults filled in. */
export const bookInks = (look: BookLook | undefined) => ({ body: look?.body_color ?? BOOK_INK.body, title: look?.title_color ?? BOOK_INK.title, margin: look?.margin_color ?? BOOK_INK.margin })

export type BookIssue = { rule: "book_overflow" | "book_image" | "book_image_ratio" | "book_contrast" | "book_frame"; stops: boolean; text: string; fix: string; refs: FindingRef[]; page: number | null; field: string }
/** A picture of the project as a book's check sees it: its size and title, and its pixels when it is a texture. */
export type BookPicture = { width: number; height: number; title: string; texture?: BookTexture }

/**
 * A book's look against the project: a picture that is gone stops the build; one of the wrong shape is drawn stretched, a frame with nothing
 * see-through covers the page, and an ink too close to its paper (or a cover too busy under its title) is hard to read, which are only said, each
 * with what to do (for an ink, the colour to use).
 */
function lookIssues(asset: { id: string; title: string; document: BookDocument }, pictures: (id: string) => BookPicture | null): BookIssue[] {
  const book = asset.document
  const look = book.look
  if (!look) return []
  const own = assetRef(asset.id, asset.title)
  const found: BookIssue[] = []
  const seen = new Map<string, BookPicture>()
  for (const [slot, id] of bookLookImages(look)) {
    const shape = BOOK_LOOK_SLOTS[slot]
    const picture = pictures(id)
    if (!picture) {
      found.push({ rule: "book_image", stops: true, page: null, field: `look.${slot}`, refs: [own], text: `「${book.name}」的${shape.label}在工程里找不到，或者它不是一张贴图。`, fix: `重新选一张工程里的贴图当${shape.label}，或者不用${shape.label}。` })
      continue
    }
    seen.set(slot, picture)
    const want = shape.width / shape.height
    if (Math.abs(picture.width / picture.height - want) / want > 0.02)
      found.push({ rule: "book_image_ratio", stops: false, page: null, field: `look.${slot}`, refs: [own, assetRef(id, picture.title)], text: `「${book.name}」的${shape.label}「${picture.title}」是 ${picture.width}×${picture.height}，比例不是 ${shape.width}:${shape.height}，游戏里会被拉伸。`, fix: `换一张 ${shape.width}:${shape.height} 的图，建议 ${shape.size}。` })
  }
  const clear = look.clear_color ?? BOOK_FRAME_CLEAR
  const frame = seen.get("frame")?.texture
  if (frame && !frame.pixels.some((index) => frame.palette[index]!.toLowerCase() === clear.toLowerCase()))
    found.push({ rule: "book_frame", stops: false, page: null, field: "look.clear_color", refs: [own, assetRef(look.frame!, seen.get("frame")!.title)], text: `「${book.name}」的页边框「${seen.get("frame")!.title}」里一个 ${clear} 的像素都没有，没有透明的地方，会把整页盖住。`, fix: `把边框图中间要透出内页的地方涂成 ${clear}，或者把「画成透明的颜色」改成边框图里中间那块的颜色。` })
  // A frame that reaches into where the words are (the r29 run in the game: a rule across the page number) draws over them.
  else if (frame) {
    const parts = ([["title", "页标题"], ["body", "正文"], ["margin", "页边小字"], ["number", "页码"]] as const).filter(([part]) => frameCover(frame, clear, BOOK_TEXT_BOXES[part]) > 0.05)
    if (parts.length)
      found.push({ rule: "book_frame", stops: false, page: null, field: "look.frame", refs: [own, assetRef(look.frame!, seen.get("frame")!.title)], text: `「${book.name}」的页边框「${seen.get("frame")!.title}」画进了${parts.map(([, name]) => name).join("、")}那一块，字会压在花纹上看不清。`, fix: `边框和装饰只画在四边留白里：${parts.map(([part, name]) => `${name}在 ${BOOK_TEXT_BOXES[part].join(",")}`).join("，")}（界面像素，左、上、右、下；图上是两倍），这些地方涂成 ${clear}。` })
  }
  // The inks against each paper the pages are printed on: the paper's colour under the text, with the frame laid over it.
  const inks = bookInks(look)
  const papers = (["paper", "paper_even"] as const).filter((slot) => slot === "paper" || look.paper_even)
  for (const slot of papers) {
    const texture = seen.get(slot)?.texture
    if (look[slot] && !texture) continue
    for (const [part, box] of [["body", BOOK_TEXT_BOXES.body], ["title", BOOK_TEXT_BOXES.title], ["margin", BOOK_TEXT_BOXES.margin]] as const) {
      const ground = pageTone(texture ?? null, frame ?? null, clear, box)
      const ratio = contrast(inks[part], ground)
      if (ratio >= BOOK_CONTRAST[part]) continue
      const named = { body: "正文", title: "页标题", margin: "页边小字" }[part]
      const where = slot === "paper_even" ? "双数页" : look.paper_even ? "单数页" : "内页"
      const suggested = readableOn(inks[part], ground, BOOK_CONTRAST[part])
      found.push({ rule: "book_contrast", stops: false, page: null, field: `look.${part}_color`, refs: [own], text: `「${book.name}」的${named}颜色 ${inks[part]} 和${where}底色（${named}那一块平均是 ${ground}）太接近，对比度只有 ${ratio.toFixed(1)}，要 ${BOOK_CONTRAST[part]} 以上才看得清。`, fix: `把${named}颜色改成 ${suggested}（对比度 ${contrast(suggested, ground).toFixed(1)}），或者把底图这一块画浅一些或深一些。` })
    }
  }
  const cover = seen.get("cover")?.texture
  if (cover && !look.title_in_cover) {
    const ground = textureTone(cover, BOOK_TEXT_BOXES.cover_title) ?? BOOK_INK.paper
    const ratio = contrast(coverInk(ground), ground)
    if (ratio < BOOK_CONTRAST.cover)
      found.push({ rule: "book_contrast", stops: false, page: null, field: "look.cover", refs: [own, assetRef(look.cover!, seen.get("cover")!.title)], text: `「${book.name}」的封面图在书名那一块（平均 ${ground}）不深也不浅，印上去的书名对比度只有 ${ratio.toFixed(1)}，看不清。`, fix: "把封面图中间偏上印书名的那一块画得更深或更浅；或者把书名画进封面图，再打开「封面图里画了书名」（title_in_cover）。" })
  }
  return found
}

/**
 * A book against its own page layout and against the project: a page whose text does not fit (in either language) stops the build, as does a
 * picture the project no longer has as a texture; a picture that is not 2:1 is drawn stretched, which is only said. Then its look (`lookIssues`).
 */
export function bookIssues(asset: { id: string; title: string; document: BookDocument }, pictures: (id: string) => BookPicture | null): BookIssue[] {
  const book = asset.document
  const own = assetRef(asset.id, asset.title)
  const cover = (["zh", "en"] as const).flatMap((language): BookIssue[] => {
    const name = language === "en" ? book.name_en : book.name
    const laid = name ? bookCoverLayout(name) : null
    return laid?.over ? [{ rule: "book_overflow", stops: true, page: null, field: language === "en" ? "name_en" : "name", refs: [own], text: `「${book.name}」的${language === "en" ? "英文" : ""}书名在封面上排成 ${laid.lines.length} 行，封面只放得下 ${BOOK_PAGE.cover.lines} 行。`, fix: "把书名改短一些。" }] : []
  })
  const pages = book.pages.flatMap((page, index): BookIssue[] => {
    const at = `第 ${index + 1} 页`
    const own = (["zh", "en"] as const).flatMap((language): BookIssue[] => {
      if (language === "en" && !page.title_en && !page.body_en && !page.margin_en) return []
      const laid = bookPageLayout(page, language, book.margin_small)
      const tongue = language === "en" ? "英文" : ""
      const field = (name: string) => language === "en" ? `${name}_en` : name
      return [
        ...(laid.title.over ? [{ field: field("title"), text: `「${book.name}」${at}的${tongue}标题比一行宽了 ${laid.title.over} 个像素，游戏里会伸出页面。`, fix: "把标题改短一些。" }] : []),
        ...(laid.body.over ? [{ field: field("body"), text: `「${book.name}」${at}的${tongue}正文排成 ${laid.body.lines.length} 行，${page.image ? "有图的页" : "这一页"}只放得下 ${laid.body.room} 行，多了 ${laid.body.over} 行。`, fix: `删掉大约 ${Math.ceil(laid.body.over * bookCapacity(language === "en" ? "e" : "字").perLine)} 个字，或者把后面一段挪到下一页${page.image ? "，或者去掉这一页的图" : ""}；空行和换行也占一行。` }] : []),
        ...(laid.margin.over ? [{ field: field("margin"), text: `「${book.name}」${at}的${tongue}页边小字排成 ${laid.margin.lines.length} 行，页脚只放得下 ${laid.margin.room} 行，多了 ${laid.margin.over} 行。`, fix: book.margin_small ? "把页边小字改短一些，或者挪进正文。" : `把页边小字改短一些（和正文一样大，一行 ${marginCapacity(false, language === "en" ? "e" : "字").perLine} 个${language === "en" ? "字母" : "汉字"}，两行），或者挪进正文；想照旧用小一号的字，就打开「页边小字缩小」（margin_small: true）。` }] : []),
      ].map((issue): BookIssue => ({ rule: "book_overflow", stops: true, page: index, refs: [assetRef(asset.id, asset.title)], ...issue }))
    })
    if (!page.image) return own
    const picture = pictures(page.image)
    if (!picture) return [...own, { rule: "book_image", stops: true, page: index, field: "image", refs: [assetRef(asset.id, asset.title)], text: `「${book.name}」${at}的图在工程里找不到，或者它不是一张贴图。`, fix: "在这一页重新选一张工程里的贴图，或者去掉这一页的图。" }]
    const ratio = picture.width / picture.height
    return [...own, ...(Math.abs(ratio - 2) > 0.02 ? [{ rule: "book_image_ratio" as const, stops: false, page: index, field: "image", refs: [assetRef(asset.id, asset.title), assetRef(page.image, picture.title)], text: `「${book.name}」${at}的图「${picture.title}」是 ${picture.width}×${picture.height}，不是 2:1，游戏里会被拉成 ${BOOK_PAGE.image.width}×${BOOK_PAGE.image.height}。`, fix: "换一张 2:1 的横图，建议 432×216。" }] : [])]
  })
  return [...cover, ...pages, ...lookIssues(asset, pictures)]
}

/** Light ink on a dark cover, dark ink on a light one. */
export function coverInk(color: string) {
  const [red, green, blue] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16))
  return 0.299 * red! + 0.587 * green! + 0.114 * blue! < 140 ? "#f4ead2" : "#2b2118"
}

const capacity = bookCapacity()
const note = marginCapacity()
const small = marginCapacity(true)
export const BOOK_SUMMARY = `一本开局就送给玩家的书（说明书、怪物图鉴、任务手册都行）：右键打开模组自己的书页界面，左右翻页；封面写书名和署名，每页依次是标题、可选的横幅图、正文和页脚的页边小字。内容固定，第一次进世界给一本，死了不掉。最多 ${BOOK_LIMITS.pages} 页。`
export const BOOK_INSTRUCTIONS =
  BOOK_SUMMARY +
  ` 文档：{kind:"book", name, name_en?, identifier?, author?, cover_color?, give_on_first_join, keep_on_death, margin_small?, look?, pages:[{title?, body, image?, margin?, title_en?, body_en?, margin_en?}]}。` +
  ` name 是书名（物品名，也印在封面上），最多 ${BOOK_LIMITS.name} 字；author 是封面署名，最多 ${BOOK_LIMITS.author} 字；cover_color 是封面和物品图标的主色 #rrggbb，不写是牛皮纸色。` +
  ` give_on_first_join（默认 true）：玩家第一次进这个世界时放进背包，每人每个世界只给一次；keep_on_death（默认 true）：死了不掉落，重生后还在身上。` +
  ` 每页：title 是一行页标题，最多 ${BOOK_LIMITS.title} 字；body 是正文，可以用 \\n 换行，没有图的页最多 ${BOOK_LIMITS.body} 字，有图的页最多 ${BOOK_LIMITS.body_image} 字（换行不算字数）；margin 是页脚的页边小字（和正文一样大、颜色淡），最多 ${BOOK_LIMITS.margin} 字。` +
  ` 字数之外还按游戏字体真实折行量：一行宽 ${BOOK_PAGE.text.width} 个界面像素，一个汉字 9 像素，所以一行 ${capacity.perLine} 个汉字；没图的页正文 ${capacity.lines} 行，有图的页 ${capacity.imageLines} 行；页边小字一行 ${note.perLine} 个汉字、最多 ${note.lines} 行（${note.total} 字正好两行）；每个换行、空行都占一行。排不下会报出第几页、多了几行，打包会停下：把多的挪到下一页，不要硬塞。` +
  ` margin_small: true 时页边小字缩成四分之三（r28 的画法，一行 ${small.perLine} 个汉字，默认界面缩放下有点糊），一般不用。` +
  ` look（可选，书的外观；不写就是纯色封面、米白纸页）：{cover?, title_in_cover?, paper?, paper_even?, frame?, clear_color?, body_color?, title_color?, margin_color?, icon?}。` +
  `cover 是整张封面底图，书名和署名照旧印在上面（字色按图在书名那块的深浅自动选深色或浅色）；封面图里自己画了书名（比如竖排的题签）时写 title_in_cover: true，游戏里就不再印书名和署名。` +
  `paper 是内页底图，纸纹、做旧、焦边都画在这张图里；paper_even 是双数页（第 2、4、6… 页）的底图，不写就每页都用 paper。frame 是叠在内页底图上面的页边装饰或边框，画在字的下面；贴图没有透明通道，所以边框图里颜色是 clear_color（默认 ${BOOK_FRAME_CLEAR} 品红）的像素画成透明，让底图透出来；物品图标也一样。` +
  `封面图、内页底图、边框都铺满整个书页（${BOOK_PAGE.panel.width}×${BOOK_PAGE.panel.height} 个界面像素），比例 ${BOOK_PAGE.panel.width}:${BOOK_PAGE.panel.height}，建议 ${BOOK_LOOK_SLOTS.paper.size}（界面缩放 2 时一个像素对一个像素），比例不对会被拉伸。` +
  `文字落在这几块里，画焦边和装饰要避开（界面像素，左、上、右、下）：页标题 ${BOOK_TEXT_BOXES.title.join(",")}，正文 ${BOOK_TEXT_BOXES.body.join(",")}，页边小字 ${BOOK_TEXT_BOXES.margin.join(",")}，页码 ${BOOK_TEXT_BOXES.number.join(",")}，封面书名 ${BOOK_TEXT_BOXES.cover_title.join(",")}，署名 ${BOOK_TEXT_BOXES.cover_author.join(",")}；页码离下边只有 4 个界面像素，边框的下边只能画在最外 3 个像素里，画进这几块会提醒。` +
  `body_color、title_color、margin_color 是正文、页标题、页边小字的颜色 #rrggbb，不写是 ${BOOK_INK.body}、${BOOK_INK.title}、${BOOK_INK.margin}；和底图太接近会提醒并给出建议颜色（正文和标题对比度要 ${BOOK_CONTRAST.body}、页边小字要 ${BOOK_CONTRAST.margin}）。icon 是物品图标，一张 ${BOOK_LOOK_SLOTS.icon.size} 的方图，背景涂 clear_color，不写就按封面色画一本书。` +
  `这些图都写工程里贴图（texture）资产的 UUID，并加进这本书的依赖。图从哪来：工程里已有的贴图，或者请人画好导入成贴图；外部 AI 画不了像素图，没有图就不写这一项。` +
  ` image：一页的横幅图，写工程里一张贴图（texture）资产的 UUID，并把它加进这本书的依赖；画在正文上方，显示为 ${BOOK_PAGE.image.width}×${BOOK_PAGE.image.height} 个界面像素，原图要 2:1，建议 432×216（不是 2:1 会被拉伸）。图从哪来：工程里已有的贴图，或者请人画好导入成贴图；外部 AI 画不了像素图，没有图就不写 image。` +
  ` 语言：游戏是中文显示中文，是英文且写了 name_en、title_en、body_en、margin_en 就显示英文，没写英文的地方显示中文；英文同样按真实宽度量。` +
  ` 生僻字：游戏字体里没有的字，打包时从电脑上装的开源字体（SIL OFL 1.1）补成像素字带进模组；哪套都没有的会在打包提醒里说，游戏里是方框，那时换个常用字。` +
  REGISTRY_NAME_INSTRUCTIONS.book +
  " 扔掉、烧掉以后不会再补一本（以后的版本再做）。书不用别的资产引用，存好就会做进模组。"

export const BOOK_STANDARD: StandardOutline = {
  kind: "book",
  label: "书",
  rules: [],
  unmeasured: {
    earns_place: "书里该写多少、写什么量不了，由人自己读",
    not_mechanical: "文字好不好读量不了，由人自己读",
    reads: "一页放不放得下按游戏字体量（排不下会报出来）；读起来顺不顺量不了，由人在预览里翻",
    hierarchy: "标题、图、正文、页边小字的分量由版式定好，内容的主次由人看",
    sound: "书是界面上的文字，站不站得住对它不适用",
    fits: "书配不配这个模组的题材量不了，由人自己看",
  },
  told: { reads: "每一页按游戏里同样的排版画出来，排不下的地方标红，说出第几页多了几行" },
}

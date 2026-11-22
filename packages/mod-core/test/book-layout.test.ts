import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { BOOK_CONTRAST, BOOK_IMAGE_LINES, BOOK_LIMITS, BookDocumentSchema, bookCapacity, bookImageIds, bookIssues, bookPageLayout, contrast, marginCapacity, pageTone, readableOn, splitLines, textureTone, textWidth, type BookPicture } from "../src/book"
import { BUILD_WARNING_RULES } from "../src/build-warnings"
import { reconcile } from "../src/reconcile"
import { builtWorkspaceAssets } from "../src/workspace"
import { kindCapability, savedStatus } from "../src/workspace-modules"
import { BOOK_IDS, createBookSample } from "../script/target-book-sample"
import { LOOK_DOCUMENTS, LOOK_IDS, createBookLookSample, goldFrame } from "./fixtures/book-look"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const fresh = async (name: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `minemods-book-${name}-`))
  roots.push(root)
  return root
}

test("the game's own font widths: a Chinese character is 9, the narrow Latin letters are the game's, a space is 4", () => {
  expect(textWidth("中")).toBe(9)
  expect(textWidth("，。：")).toBe(27)
  expect([..."ailW !1"].map(textWidth)).toEqual([6, 2, 3, 6, 4, 2, 6])
  expect(bookCapacity()).toEqual({ perLine: 30, plain: 570, image: 180, lines: 19, imageLines: 6 })
  expect(BOOK_IMAGE_LINES).toBe(6)
})

test("lines break as the game breaks them: at a newline, before the character that does not fit, at the last space for words", () => {
  expect(splitLines("字".repeat(31), 270)).toEqual(["字".repeat(30), "字"])
  expect(splitLines("一\n\n二", 270)).toEqual(["一", "", "二"])
  expect(splitLines("末尾\n", 270)).toEqual(["末尾", ""])
  // 6 + 4 + … : "aaaa aaaa" is 24 + 4 + 24 = 52; at 40 it breaks at the space, which is dropped.
  expect(splitLines("aaaa aaaa", 40)).toEqual(["aaaa", "aaaa"])
  expect(splitLines("", 270)).toEqual([])
})

test("the document: limits by characters (a line break is not one), a page with a picture holds half the text, both switches default to on", () => {
  const book = BookDocumentSchema.parse({ kind: "book", name: "说明书", pages: [{ body: "第一页" }] })
  expect(book).toMatchObject({ give_on_first_join: true, keep_on_death: true })
  const long = (count: number) => "字".repeat(count)
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: [{ body: long(BOOK_LIMITS.body) + "\n\n" }] }).success).toBe(true)
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: [{ body: long(BOOK_LIMITS.body + 1) }] }).success).toBe(false)
  const pictured = BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: [{ body: long(BOOK_LIMITS.body_image + 1), image: BOOK_IDS.banner }] })
  expect(pictured.success).toBe(false)
  expect(pictured.error?.issues[0]?.message).toContain("第 1 页有图，正文最多 160 字")
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: [{ title: long(17), body: "" }] }).success).toBe(false)
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: [{ body: "", margin: long(61) }] }).success).toBe(false)
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: [] }).success).toBe(false)
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: Array.from({ length: 65 }, () => ({ body: "" })) }).success).toBe(false)
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", pages: [{ body: "", body_en: "中文" }] }).success).toBe(false)
  expect(BookDocumentSchema.safeParse({ kind: "book", name: long(25), pages: [{ body: "" }] }).success).toBe(false)
})

test("a page is measured by its real layout: a short text of many line breaks does not fit, and the finding says which page, how many lines over and how to fix it", () => {
  const book = BookDocumentSchema.parse({ kind: "book", name: "怪物图鉴", pages: [
    { body: "正好".repeat(160) },
    { body: Array.from({ length: 21 }, (_, line) => `第${line + 1}行`).join("\n") },
    { body: "字".repeat(160), image: BOOK_IDS.banner },
    { body: "字".repeat(140) + "\n\n" + "字".repeat(20), image: BOOK_IDS.banner },
    { body: "", margin: "字".repeat(60) },
    { title: "字".repeat(16), body: "", body_en: "line\n".repeat(25) },
  ] })
  expect(bookPageLayout(book.pages[0]!, "zh").body).toMatchObject({ room: 19, over: 0 })
  expect(bookPageLayout(book.pages[2]!, "zh").body).toMatchObject({ room: 6, over: 0 })
  const issues = bookIssues({ id: "b1", title: "怪物图鉴", document: book }, () => ({ width: 432, height: 216, title: "横幅" }))
  expect(issues.map((issue) => [issue.rule, issue.page, issue.field])).toEqual([["book_overflow", 1, "body"], ["book_overflow", 3, "body"], ["book_overflow", 5, "body_en"]])
  expect(issues[0]!.text).toBe("「怪物图鉴」第 2 页的正文排成 21 行，这一页只放得下 19 行，多了 2 行。")
  expect(issues[1]!.text).toBe("「怪物图鉴」第 4 页的正文排成 7 行，有图的页只放得下 6 行，多了 1 行。")
  expect(issues[1]!.fix).toContain("去掉这一页的图")
  expect(issues[2]!.text).toContain("第 6 页的英文正文排成")
  expect(issues.every((issue) => issue.stops && issue.refs.some((ref) => ref.id === "b1"))).toBe(true)
  expect(bookPageLayout(book.pages[4]!, "zh").margin).toMatchObject({ room: 2, over: 0 })
})

test("a picture: gone or not a texture stops; one that is not 2:1 is only said, with both the book and the picture referenced", () => {
  const book = BookDocumentSchema.parse({ kind: "book", name: "说明书", pages: [{ body: "图", image: BOOK_IDS.banner }] })
  expect(bookIssues({ id: "b", title: "说明书", document: book }, () => null).map((issue) => [issue.rule, issue.stops])).toEqual([["book_image", true]])
  const square = bookIssues({ id: "b", title: "说明书", document: book }, () => ({ width: 64, height: 64, title: "方图" }))
  expect(square.map((issue) => [issue.rule, issue.stops])).toEqual([["book_image_ratio", false]])
  expect(square[0]!.refs.map((ref) => ref.id)).toEqual(["b", BOOK_IDS.banner])
  expect([BUILD_WARNING_RULES.book_overflow, BUILD_WARNING_RULES.book_image, BUILD_WARNING_RULES.book_image_ratio]).toEqual(["defect", "defect", "advice"])
})

test("the kind: built on every target with nothing pointing at it, saved ready, and its pictures built with it", async () => {
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    expect(kindCapability("book", target)).toBe("runtime")
    expect(savedStatus("book", target)).toBe("ready")
  }
  const root = await fresh("kind")
  const project = await createBookSample(path.join(root, "工程"))
  expect(builtWorkspaceAssets(project).map((asset) => asset.id).sort()).toEqual(Object.values(BOOK_IDS).sort())
  // The sample's pages all fit: nothing about its books is found.
  expect(reconcile(project, { animations: {} }).filter((finding) => finding.rule.startsWith("book_"))).toEqual([])
})

test("r29: the margin note is drawn at the text's own size by default, 30 characters a line on two lines; margin_small keeps r28's three quarters", () => {
  expect(marginCapacity()).toEqual({ perLine: 30, lines: 2, total: 60 })
  expect(marginCapacity(true)).toEqual({ perLine: 40, lines: 2, total: 80 })
  expect(marginCapacity().total).toBe(BOOK_LIMITS.margin)
  const page = { body: "", margin: "字".repeat(35) + "\n" + "字" }
  expect(bookPageLayout(page, "zh").margin).toMatchObject({ room: 2, over: 1 })
  expect(bookPageLayout(page, "zh", true).margin).toMatchObject({ room: 2, over: 0 })
  const book = BookDocumentSchema.parse({ kind: "book", name: "手册", pages: [page] })
  const issue = bookIssues({ id: "b", title: "手册", document: book }, () => null)
  expect(issue.map((value) => [value.rule, value.field, value.stops])).toEqual([["book_overflow", "margin", true]])
  expect(issue[0]!.text).toBe("「手册」第 1 页的页边小字排成 3 行，页脚只放得下 2 行，多了 1 行。")
  expect(issue[0]!.fix).toContain("margin_small: true")
  expect(bookIssues({ id: "b", title: "手册", document: { ...book, margin_small: true } }, () => null)).toEqual([])
})

const texture = (width: number, height: number, palette: string[], pick: (x: number, y: number) => number = () => 0) => ({ width, height, palette, pixels: Array.from({ length: width * height }, (_, at) => pick(at % width, Math.floor(at / width))) })

test("r29: the look's pictures are the book's own links, and the sample's spell book and ship's log are found clean", async () => {
  const book = BookDocumentSchema.parse(LOOK_DOCUMENTS.spells)
  expect(bookImageIds(book).sort()).toEqual([LOOK_IDS.cover, LOOK_IDS.paper, LOOK_IDS.paper_even, LOOK_IDS.frame, LOOK_IDS.icon].sort())
  const root = await fresh("look")
  const project = await createBookLookSample(path.join(root, "工程"))
  expect(reconcile(project, { animations: {} }).filter((finding) => finding.rule.startsWith("book_"))).toEqual([])
  expect(builtWorkspaceAssets(project).map((asset) => asset.id).sort()).toEqual(Object.values(LOOK_IDS).sort())
  expect(BookDocumentSchema.safeParse({ kind: "book", name: "书", look: { title_in_cover: true }, pages: [{ body: "" }] }).error?.issues[0]?.message).toContain("不印书名要配一张自己画了书名的封面图")
}, 60000)

test("r29: a look's picture gone stops; the wrong shape, a frame with nothing see-through and an ink too close to its paper are said, with the colour to use", () => {
  const book = BookDocumentSchema.parse({ kind: "book", name: "星图", look: { cover: LOOK_IDS.cover, paper: LOOK_IDS.paper, frame: LOOK_IDS.frame, icon: LOOK_IDS.icon, body_color: "#c8b890", margin_color: "#d8c8a0" }, pages: [{ body: "一" }] })
  const pictures: Record<string, BookPicture> = {
    [LOOK_IDS.paper]: { width: 604, height: 460, title: "米色纸", texture: texture(604, 460, ["#e8d6a8"]) },
    [LOOK_IDS.frame]: { width: 604, height: 460, title: "实心框", texture: texture(604, 460, ["#c9a24a"]) },
    [LOOK_IDS.icon]: { width: 32, height: 16, title: "扁图标", texture: texture(32, 16, ["#ff00ff"]) },
  }
  const issues = bookIssues({ id: "b", title: "星图", document: book }, (id) => pictures[id] ?? null)
  expect(issues.map((issue) => [issue.rule, issue.field, issue.stops])).toEqual([
    ["book_image", "look.cover", true],
    ["book_image_ratio", "look.icon", false],
    ["book_frame", "look.clear_color", false],
    ["book_contrast", "look.body_color", false],
    ["book_contrast", "look.margin_color", false],
  ])
  expect(issues[1]!.fix).toBe("换一张 16:16 的图，建议 16×16。")
  // The solid frame covers the paper: the inks are read against the frame's gold, and the colour said reads on it.
  const body = issues[3]!
  const suggested = /改成 (#[0-9a-f]{6})/.exec(body.fix)![1]!
  expect(contrast(suggested, "#c9a24a")).toBeGreaterThanOrEqual(BOOK_CONTRAST.body)
  expect(body.text).toContain("太接近，对比度只有")
  expect([BUILD_WARNING_RULES.book_contrast, BUILD_WARNING_RULES.book_frame]).toEqual(["advice", "advice"])
  // A frame that is see-through in the middle leaves the paper to read against: the default ink on cream paper is fine.
  const open = { ...pictures[LOOK_IDS.frame]!, texture: texture(604, 460, ["#ff00ff", "#c9a24a"], (x, y) => (Math.min(x, y, 603 - x, 459 - y) < 4 ? 1 : 0)) }
  const cream = { ...pictures[LOOK_IDS.paper]!, texture: texture(604, 460, ["#f4ebd3"]) }
  const plain = BookDocumentSchema.parse({ kind: "book", name: "星图", look: { paper: LOOK_IDS.paper, frame: LOOK_IDS.frame }, pages: [{ body: "一" }] })
  expect(bookIssues({ id: "b", title: "星图", document: plain }, (id) => (id === LOOK_IDS.frame ? open : id === LOOK_IDS.paper ? cream : null))).toEqual([])
})

test("r29: a frame drawn into where the words are is said (the first run in the game: its rule crossed the page number); the sample's keeps clear", () => {
  const book = BookDocumentSchema.parse({ kind: "book", name: "法典", look: { frame: LOOK_IDS.frame }, pages: [{ body: "一" }] })
  const frame = (inset: number): BookPicture => ({ width: 604, height: 460, title: "金边", texture: goldFrame(inset) })
  const crossed = bookIssues({ id: "b", title: "法典", document: book }, () => frame(10))
  expect(crossed.map((issue) => [issue.rule, issue.field])).toEqual([["book_frame", "look.frame"]])
  expect(crossed[0]!.text).toBe("「法典」的页边框「金边」画进了页码那一块，字会压在花纹上看不清。")
  expect(crossed[0]!.fix).toContain("页码在 131,218,171,226")
  expect(bookIssues({ id: "b", title: "法典", document: book }, () => frame(2))).toEqual([])
})

test("r29: the readable colour is the same hue taken darker on light paper and lighter on dark", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5)
  const dark = readableOn("#c8b890", "#e8d6a8", 4.5)
  expect(contrast(dark, "#e8d6a8")).toBeGreaterThanOrEqual(4.5)
  const light = readableOn("#3a2412", "#2a1410", 4.5)
  expect(contrast(light, "#2a1410")).toBeGreaterThanOrEqual(4.5)
  expect(pageTone(null, null, "#ff00ff", [0, 0, 10, 10])).toBe("#f4ebd3")
  expect(textureTone(texture(4, 2, ["#000000", "#ffffff"], (x) => (x < 2 ? 0 : 1)), [0, 0, 302, 230])).toBe("#808080")
})

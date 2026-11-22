import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BOOK_PAGE } from "../src/book"
import { bookFindings } from "../src/book-findings"
import { assembleBuildSource } from "../src/build-source"
import { BuildStop } from "../src/build-stop"
import { bookName } from "../src/common/book"
import { openProject, saveProject } from "../src/project"
import { reconcile } from "../src/reconcile"
import { BOOK_DOCUMENTS, BOOK_IDS, createBookSample } from "../script/target-book-sample"
import { LOOK_IDS, createBookLookSample } from "./fixtures/book-look"
import { decodeRgbaPng } from "../src/png-decode"
import { hasTargetJavac, targetJavac } from "./target-javac"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const fresh = async (name: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `minemods-book-${name}-`))
  roots.push(root)
  return root
}

test("a book's finding goes through the reconciliation with its page as the field to put right, and stops the build in the person's words", async () => {
  const root = await fresh("stop")
  const directory = path.join(root, "工程")
  const project = await createBookSample(directory)
  const crowded = { ...BOOK_DOCUMENTS.quests, pages: [{ body: Array.from({ length: 20 }, () => "一").join("\n") }] }
  const saved = await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === BOOK_IDS.quests ? { ...asset, document: crowded } : asset)) } } as typeof project, project.revision)
  const found = bookFindings(saved)
  expect(found).toHaveLength(1)
  expect(found[0]).toMatchObject({ rule: "book_overflow", stops: true, about: { kind: "book", id: BOOK_IDS.quests, name: "北境任务手册" }, targets: [{ field: "pages.0.body", label: "改第 1 页" }] })
  expect(reconcile(saved, { animations: {} }).find((finding) => finding.rule === "book_overflow")?.refs?.map((ref) => ref.id)).toContain(BOOK_IDS.quests)
  const source = path.join(root, "source")
  await mkdir(source)
  const error = await assembleBuildSource(directory, source, TEMPLATE).catch((cause: unknown) => cause)
  expect(error).toBeInstanceOf(BuildStop)
  expect((error as BuildStop).message).toContain("第 1 页的正文排成 20 行")
})

const files = async (source: string) => (await readdir(source, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(source, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"))

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`${target}: the books' classes, items, pictures and words are generated, started by the target's own entries, and the tree compiles`, async () => {
    const root = await fresh(target)
    const directory = path.join(root, "工程")
    await createBookSample(directory, target)
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(directory, source, TEMPLATE)
    const names = await files(source)
    const pkg = "src/main/java/com/minemods/content_book_sample"
    const read = (name: string) => readFile(path.join(source, name), "utf8")
    expect(names.filter((name) => name.startsWith(`${pkg}/book/`)).sort()).toEqual(["StudioBookClient", "StudioBookItem", "StudioBookScreen", "StudioBooks"].map((name) => `${pkg}/book/${name}.java`))
    const assets = "src/main/resources/assets/book_sample"
    for (const id of [BOOK_IDS.manual, BOOK_IDS.bestiary, BOOK_IDS.quests]) {
      expect(names).toContain(`${assets}/models/item/${bookName({ id: id, document: {} })}.json`)
      expect(names).toContain(`${assets}/textures/item/${bookName({ id: id, document: {} })}.png`)
    }
    expect(names).toContain(`${assets}/textures/gui/book/${BOOK_IDS.banner.replaceAll("-", "")}.png`)
    expect(built.bookFiles).toContain("com/minemods/content_book_sample/book/StudioBooks.class")
    const zh = JSON.parse(await read(`${assets}/lang/zh_cn.json`))
    const en = JSON.parse(await read(`${assets}/lang/en_us.json`))
    const manual = bookName({ id: BOOK_IDS.manual, document: {} })
    expect([zh[`item.book_sample.${manual}`], en[`item.book_sample.${manual}`]]).toEqual(["齿轮工坊说明书", "Gearworks Manual"])
    expect([zh[`book.book_sample.${manual}.1.title`], en[`book.book_sample.${manual}.1.title`]]).toEqual(["写在前面", "Before You Start"])
    // Not written in English: the English game shows the Chinese.
    expect(en[`book.book_sample.${manual}.2.body`]).toBe(BOOK_DOCUMENTS.manual.pages[1].body)
    expect(en[`book.book_sample.${manual}.author`]).toBe("工坊学徒")
    const server = await read(`${pkg}/book/StudioBooks.java`)
    expect(server).toContain("private static final boolean[] GIVE = {true, true, false};")
    expect(server).toContain("private static final boolean[] KEEP = {true, true, false};")
    if (target === "fabric-1.21.1") {
      const metadata = JSON.parse(await read("src/main/resources/fabric.mod.json"))
      expect(metadata.entrypoints.main).toContain("com.minemods.content_book_sample.book.StudioBooks")
      expect(metadata.entrypoints.client).toContain("com.minemods.content_book_sample.book.StudioBookClient")
      expect(server).toContain("ServerLivingEntityEvents.ALLOW_DEATH")
    } else {
      expect(await read(`${pkg}/StudioContent.java`)).toContain("com.minemods.content_book_sample.book.StudioBooks.register();")
      expect(await read(`${pkg}/client/StudioClient.java`)).toContain("com.minemods.content_book_sample.book.StudioBookClient.register();")
      for (const name of names.filter((value) => value.startsWith(`${pkg}/book/`))) expect({ name, loader: /^import net\.(fabricmc|minecraftforge|neoforged)\./m.test(await read(name)) }).toEqual({ name, loader: false })
    }
    if (target === "forge-1.20.1") expect(await read(`${pkg}/book/StudioBookScreen.java`)).toContain("new ResourceLocation(")
    const javac = target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target
    if (!hasTargetJavac(javac)) return console.warn(`${target}: no javac class path here; the books were not compiled`)
    const compiled = await targetJavac(javac, path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

test("a project without books generates no book file and no book key", async () => {
  const root = await fresh("none")
  const directory = path.join(root, "工程")
  const project = await createBookSample(directory)
  await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.filter((asset) => asset.module !== "book") } }, project.revision)
  expect((await openProject(directory)).workspace.assets.map((asset) => asset.module)).toEqual(["texture"])
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  expect((await files(source)).filter((name) => /\/book\/|book_[0-9a-f]{32}/.test(name))).toEqual([])
  expect(built.bookFiles).toEqual([])
  expect(JSON.stringify(JSON.parse(await readFile(path.join(source, "src/main/resources/fabric.mod.json"), "utf8")).entrypoints)).not.toContain("Book")
  expect(BOOK_PAGE.panel.height).toBeLessThanOrEqual(240)
})

// r28's StudioBookScreen for the sample, by sha-256 of its text: a book that keeps the small margin note and has no look is generated as it was.
const R28_SCREEN = {
  "fabric-1.21.1": "e24a8b299946a87c85e65783dce18b615f3e54d4ab012d5a715e6929de09d1c4",
  "forge-1.20.1": "d736f4f1c462e1f897dd88f5368ab9e8bfbab45906ce670dbf65fa0349ae13c7",
  "neoforge-1.21.1": "e24a8b299946a87c85e65783dce18b615f3e54d4ab012d5a715e6929de09d1c4",
} as const
const sha = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex")

test("r29: books that keep margin_small and have no look get r28's screen byte for byte; by default the note is full size and the number lower", async () => {
  for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
    const root = await fresh(`r28-${target}`)
    const directory = path.join(root, "工程")
    const project = await createBookSample(directory, target)
    const small = await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.module === "book" ? { ...asset, document: { ...asset.document, margin_small: true } } : asset)) } } as typeof project, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const screen = path.join(source, "src/main/java/com/minemods/content_book_sample/book/StudioBookScreen.java")
    expect({ target, sha: sha(await readFile(screen, "utf8")) }).toEqual({ target, sha: R28_SCREEN[target] })
    await saveProject(directory, { ...small, workspace: { assets: small.workspace.assets.map((asset) => (asset.id === BOOK_IDS.quests ? { ...asset, document: { ...asset.document, margin_small: undefined } } : asset)) } } as typeof project, small.revision)
    const mixed = path.join(root, "mixed")
    await mkdir(mixed)
    await assembleBuildSource(directory, mixed, TEMPLATE)
    const text = await readFile(path.join(mixed, "src/main/java/com/minemods/content_book_sample/book/StudioBookScreen.java"), "utf8")
    expect(text).toContain("private static final float[] MARGIN_SCALE = {0.75f, 0.75f, 1f};")
    expect(text).toContain(`private static final int[] NUMBER_TOP = {${BOOK_PAGE.number_top_small}, ${BOOK_PAGE.number_top_small}, ${BOOK_PAGE.number_top}};`)
  }
}, 120000)

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  test(`r29 ${target}: a book's look is generated (cover, both papers, a frame made see-through, its own icon, its inks) and the tree compiles`, async () => {
    const root = await fresh(`look-${target}`)
    const directory = path.join(root, "工程")
    await createBookLookSample(directory, target)
    const source = path.join(root, "source")
    await mkdir(source)
    await assembleBuildSource(directory, source, TEMPLATE)
    const gui = "src/main/resources/assets/book_look/textures/gui/book"
    const id = (value: string) => value.replaceAll("-", "")
    const names = await files(source)
    for (const picture of [LOOK_IDS.cover, LOOK_IDS.paper, LOOK_IDS.paper_even, LOOK_IDS.log_cover]) expect(names).toContain(`${gui}/${id(picture)}.png`)
    expect(names).toContain(`${gui}/${id(LOOK_IDS.frame)}_ff00ff.png`)
    expect(names.filter((name) => name.includes(id(LOOK_IDS.icon)))).toEqual([])
    const frame = decodeRgbaPng(new Uint8Array(await readFile(path.join(source, `${gui}/${id(LOOK_IDS.frame)}_ff00ff.png`))))
    // The middle of the frame is clear, its rule is solid gold.
    expect([frame.pixels[(230 * frame.width + 302) * 4 + 3], frame.pixels[(3 * frame.width + 302) * 4 + 3]]).toEqual([0, 255])
    const icon = decodeRgbaPng(new Uint8Array(await readFile(path.join(source, `src/main/resources/assets/book_look/textures/item/${bookName({ id: LOOK_IDS.spells, document: {} })}.png`))))
    expect([icon.width, icon.pixels[3], icon.pixels[(4 * 16 + 5) * 4 + 3]]).toEqual([16, 0, 255])
    const screen = await readFile(path.join(source, "src/main/java/com/minemods/content_book_look/book/StudioBookScreen.java"), "utf8")
    expect(screen).toContain("private static final int[] INK = {0xFF3A2412, 0xFF1B2330};")
    expect(screen).toContain("private static final boolean[] COVER_TITLE = {true, false};")
    expect(screen).toContain("private static final int[] PAPER_ODD = {1, -1};")
    expect(screen).toContain("private static final int[] PAPER_EVEN = {2, -1};")
    // The leather is dark under the title: light ink.
    expect(screen).toContain("private static final int[] COVER_INK = {0xFFF4EAD2, 0xFFF4EAD2};")
    const javac = target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target
    if (!hasTargetJavac(javac)) return console.warn(`${target}: no javac class path here; the look was not compiled`)
    const compiled = await targetJavac(javac, path.join(source, "src", "main", "java"))
    expect(compiled.output.split("\n").filter((line) => /error/.test(line))).toEqual([])
    expect(compiled.code).toBe(0)
  }, 240000)
}

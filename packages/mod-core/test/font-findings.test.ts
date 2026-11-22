import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { BUILD_WARNING_RULES } from "../src/build-warnings"
import { assembleBuildSource } from "../src/build-source"
import { fontHas, fontVersion, missingGlyphs } from "../src/font-findings"
import { saveProject } from "../src/project"
import { BOOK_IDS, createBookSample } from "../script/target-book-sample"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

test("缺字: each game version's font is read on its own; the rare characters of Extension B are boxes, and 1.21.1 draws some 1.20.1 does not", () => {
  for (const version of ["1.20.1", "1.21.1"] as const) {
    expect([..."中文，。a!—…\n"].every((char) => fontHas(version, char.codePointAt(0)!))).toBe(true)
    expect(missingGlyphs(version, "山\u{24FE4}")).toEqual(["\u{24FE4}"])
  }
  expect([fontHas("1.20.1", 0x20000), fontHas("1.21.1", 0x20000)]).toEqual([false, true])
  expect([fontVersion("forge-1.20.1"), fontVersion("fabric-1.21.1"), fontVersion("neoforge-1.21.1")]).toEqual(["1.20.1", "1.21.1", "1.21.1"])
  expect(BUILD_WARNING_RULES.font_missing).toBe("advice")
})

for (const target of ["forge-1.20.1", "fabric-1.21.1"] as const) {
  test(`缺字 ${target}: a build says which thing and which field has a character the game shows as a box, as advice, measured against that target's font`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "minemods-font-"))
    roots.push(root)
    const directory = path.join(root, "工程")
    const project = await createBookSample(directory, target)
    await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === BOOK_IDS.quests && asset.document.kind === "book" ? { ...asset, document: { ...asset.document, pages: [{ title: "山\u{24FE4}", body: "去北边找\u{20000}字。" }] } } : asset)) } } as typeof project, project.revision)
    const source = path.join(root, "source")
    await mkdir(source)
    // No font folder: what is said must not hang on what this computer has installed (补字 is `glyph-fill.test.ts`).
    const built = await assembleBuildSource(directory, source, TEMPLATE, { glyphFonts: [] })
    const found = built.findings.filter((finding) => finding.rule === "font_missing")
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ stops: false, about: { kind: "book", id: BOOK_IDS.quests, name: "北境任务手册" } })
    expect(found[0]!.refs?.map((ref) => ref.id)).toEqual([BOOK_IDS.quests])
    expect(found[0]!.text).toBe(target === "forge-1.20.1"
      ? "「北境任务手册」的第 1 页的标题里的「\u{24FE4}」，第 1 页的正文里的「\u{20000}」在 Minecraft 1.20.1 的字体里没有，游戏里会显示成方框：「\u{24FE4}」（U+24FE4）「\u{20000}」（U+20000）。"
      : "「北境任务手册」的第 1 页的标题里的「\u{24FE4}」在 Minecraft 1.21.1 的字体里没有，游戏里会显示成方框：「\u{24FE4}」（U+24FE4）。")
    expect(found[0]!.fix).toContain("补不上")
    expect(built.glyphFiles).toEqual([])
  }, 120000)
}

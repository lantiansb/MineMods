import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { buildCounts, glyphLines } from "../src/renderer/features/build-counts"
import { GLYPH_WORDS, releaseFields, releaseOf } from "../src/renderer/release-words"
import { ReleaseSchema } from "../../mod-core/src/release"
import { describeAsset } from "../src/renderer/features/asset-words"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"
import { createBookSample } from "../../mod-core/script/target-book-sample"
import { hasBuildContent } from "../src/main/service"

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

test("the build list says every count, the gameplay count too when it is none", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-counts-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true })
  const gameplays = project.workspace.assets.filter((asset) => asset.document.kind === "gameplay")
  expect(gameplays).toHaveLength(1)
  const counts = `${project.entities.length} 个生物、${project.blocks.length} 个方块、${project.items.length} 个物品、${project.recipes.length} 个配方`
  expect(buildCounts(project)).toBe(`${counts}、1 个玩法、0 本书`)
  // broad8 w3: with none the line stopped at the recipes, and testers twice read the missing item as unclear.
  expect(buildCounts({ ...project, workspace: { assets: project.workspace.assets.filter((asset) => asset.document.kind !== "gameplay") } })).toBe(`${counts}、0 个玩法、0 本书`)
  expect(buildCounts({ entities: [], blocks: [], items: [], recipes: [], workspace: { assets: [] } })).toBe("0 个生物、0 个方块、0 个物品、0 个配方、0 个玩法、0 本书")
})

test("r28 复验: a project of only books is content enough to build, and the build list counts and names its books", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-books-"))
  directories.push(root)
  const project = await createBookSample(path.join(root, "project"))
  expect([project.entities.length, project.blocks.length, project.items.length]).toEqual([0, 0, 0])
  expect(hasBuildContent(project)).toBe(true)
  expect(hasBuildContent({ ...project, workspace: { assets: project.workspace.assets.filter((asset) => asset.document.kind !== "book") } })).toBe(false)
  expect(buildCounts(project)).toBe("0 个生物、0 个方块、0 个物品、0 个配方、0 个玩法、3 本书（「齿轮工坊说明书」「沼泽怪物图鉴」「北境任务手册」）")
})

test("the card of a follower says what lures it, and a creature that follows nothing says nothing of it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-tempt-"))
  directories.push(root)
  const project = await createDataGameplaySample(path.join(root, "project"), { life: true })
  const asset = project.workspace.assets.find((value) => value.document.kind === "entity")!
  const describe = (document: Record<string, unknown>) =>
    describeAsset({ ...project, workspace: { assets: project.workspace.assets.map((value) => (value.id === asset.id ? { ...value, document } : value)) } } as typeof project, { id: asset.id, asset_id: asset.id, kind: "entity", preview: { source: "asset" } }, (reference) => reference)
  const row = (card: ReturnType<typeof describe>) => card.rows.find((value) => value.label === "拿什么引它")
  const duck = { ...asset.document, behavior: "follow", tempt: ["minecraft:bread", "azure_shard"] }
  expect(row(describe(duck))?.text).toBe("玩家手里拿着「面包」或「蓝晶碎片」时会跟过来，不打人")
  expect(row(describe({ ...duck, tempt: null }))).toBeUndefined()
  expect(row(describe({ ...duck, behavior: "passive" }))).toBeUndefined()
})

test("补字 in the build list: the characters filled are said as going in, with the font; those left are said as boxes, with why", () => {
  expect(glyphLines(undefined)).toBeNull()
  const both = glyphLines({ filled: [{ char: "\u{216B8}", family: "Noto Sans TC" }, { char: "\u{291D5}", family: "Noto Sans TC" }], missing: ["\u{24FE4}"], off: false })!
  expect(both.filled).toEqual({ text: "补 2 个游戏字体里没有的字：「\u{216B8}」「\u{291D5}」", note: "照这台电脑上的 Noto Sans TC 画成像素字，随模组带上" })
  expect(both.missing).toEqual({ text: "1 个字游戏里会显示成方框：「\u{24FE4}」", note: "这台电脑上的开源字体里也没有，补不上" })
  const off = glyphLines({ filled: [], missing: ["\u{216B8}"], off: true })!
  expect(off.filled).toBeNull()
  expect(off.missing?.note).toBe("「模组信息」里设成了只提醒，不补")
})

test("补字 in 模组信息: left alone nothing is stored (黑体 is the default); a choice is stored and read back", () => {
  expect(releaseFields(undefined).glyphs).toBe("")
  expect(releaseOf(releaseFields(undefined))).toEqual({})
  for (const glyphs of ["sans", "serif", "off"] as const) {
    const stored = releaseOf({ ...releaseFields(undefined), glyphs })
    expect(stored).toEqual({ glyphs })
    expect(ReleaseSchema.parse(stored)).toEqual({ glyphs })
    expect(releaseFields(stored).glyphs).toBe(glyphs)
    expect(GLYPH_WORDS[glyphs]).toBeTruthy()
  }
})

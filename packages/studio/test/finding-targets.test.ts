import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import type { FindingTarget } from "@minemods/mod-core/reconcile"
import { reconcile } from "@minemods/mod-core/reconcile"
import { CARD_FIELDS, GO_WORDS, fieldSelector, formCarries, placeOf } from "../src/finding-targets"
import { ENGLISH_WORDS, englishHint, englishProblem, englishThing } from "../src/renderer/features/english-name-model"
import { GO_LIMIT } from "../src/renderer/features/finding-go"
import { ADVANCED_TITLE, advancedLine } from "../src/renderer/advanced"
import { INFO_WORDS, iconPicked, infoChanged, infoFields, infoLine, infoOf, infoProblem } from "../src/renderer/mod-info-model"
import { GIVEN_ICON, ICON_WORDS } from "@minemods/mod-core/release"
import { encodePng } from "@minemods/mod-core/png"
import { ProjectSchema, type Project } from "@minemods/mod-core/project"

// Round 19: a finding that tells the person to fill something in must lead to it. These are the pure parts; the window only acts on them.

const item = (id: string, kind: string, over: Record<string, unknown> = {}) => ({ id, asset_id: null as string | null, kind, title: id, preview: { entity_id: null as string | null }, ...over })
const target = (kind: FindingTarget["about"]["kind"], id: string, field: string, name = id): FindingTarget => ({ about: { kind, id, name }, field, label: `改${name}` })

test("名字类的框：已保存的东西去它自己的编辑器；没有编辑器的老内容在卡片上填；找不到或没处填就说为什么，不指一个不存在的地方", () => {
  const items = [item("asset-block", "block", { asset_id: "block-1" }), item("entity:old", "entity", { preview: { entity_id: "old" } }), item("block:legacy", "block")]
  // The window's own fact: the kind of the saved asset a thing stands on, null for one with no asset.
  const formOf = (found: { asset_id: string | null; kind: string }) => (found.asset_id ? found.kind : null)
  expect(CARD_FIELDS).toEqual(["name_en"])
  // A creature kept from before assets (no editor of its own) and old content: the English name is on the card.
  expect(placeOf(target("entity", "old", "name_en"), items, formOf)).toEqual({ how: "card", itemId: "entity:old", field: "name_en" })
  expect(placeOf(target("block", "legacy", "name_en"), items, formOf)).toEqual({ how: "card", itemId: "block:legacy", field: "name_en" })
  // A saved block: its own editor, at that field (the card is not the place for it).
  expect(placeOf(target("block", "block-1", "name_en"), items, formOf)).toEqual({ how: "form", itemId: "asset-block", field: "name_en" })
  expect(placeOf(target("block", "block-1", "drop"), items, formOf)).toEqual({ how: "form", itemId: "asset-block", field: "drop" })
  // Old content has no form: the person is told, not sent somewhere with nothing to fill.
  expect(placeOf(target("block", "legacy", "drop"), items, formOf)).toEqual({ how: "none", why: GO_WORDS.noForm })
  // A field the form of that kind does not carry is not pretended to be there.
  expect(placeOf(target("block", "block-1", "no_such_field"), items, formOf)).toEqual({ how: "none", why: GO_WORDS.noForm })
  // Deleted since the check.
  expect(placeOf(target("block", "nope", "name_en"), items, formOf)).toEqual({ how: "none", why: GO_WORDS.gone })
  // No field named: the card is the place.
  expect(placeOf({ about: { kind: "block", id: "block-1", name: "block-1" }, field: "" }, items, formOf)).toEqual({ how: "card", itemId: "asset-block", field: "" })
})

test("本次不改的已有方块缺英文名：点「去填」去它自己的编辑器那一栏，不是只有一句「这次不做」的蓝图卡；同类情况（物品、生物）都一样", () => {
  // The newest plan lists the saved block as 「这次不做」: its overview card is the plan's entry (key "hand_block"), with the reason and nothing to fill in.
  const planned = item("hand_block", "block", { asset_id: "block-1", status: "out_of_scope", title: "手做方块" })
  const sameKind = (found: { asset_id: string | null }) => (found.asset_id ? "block" : null)
  expect(placeOf(target("block", "block-1", "name_en", "手做方块"), [planned], sameKind)).toEqual({ how: "form", itemId: "hand_block", field: "name_en" })
  // The plan may call the same saved thing by another kind; the asset decides, so the saved block is still found by its id and sent to the block's form.
  const named = item("hand_item", "item", { asset_id: "block-1", status: "out_of_scope" })
  expect(placeOf(target("block", "block-1", "name_en"), [named], () => "block")).toEqual({ how: "form", itemId: "hand_item", field: "name_en" })
  // A plan entry not made yet has no asset and no editor; it is not a place to fill an English name either.
  const unmade = item("moon_block", "block", { asset_id: null, title: "月块" })
  expect(placeOf(target("block", "月块", "name_en", "月块"), [unmade], () => null)).toEqual({ how: "card", itemId: "moon_block", field: "name_en" })
  // Every saved kind that can carry an English name has the box on its form, so the way there never ends on a form without it.
  for (const module of ["block", "item", "entity"]) expect(formCarries(module, "name_en")).toBe(true)
  expect(formCarries("recipe", "name_en")).toBe(false)
  expect(formCarries("model", "name_en")).toBe(false)
  expect(formCarries("block", "drop")).toBe(true)
})

test("字段在表格里按路径找：先找它自己，再找它上面的一层（掉哪一样只在选了「掉别的东西」时才有）", () => {
  expect(fieldSelector("drop_item.item")).toEqual(['[data-field="drop_item.item"]', '[data-field="drop_item"]'])
  expect(fieldSelector("drop")).toEqual(['[data-field="drop"]'])
})

test("每一条要人自己填的提醒都带着去处，去处的字段是卡片或表格里真有的", async () => {
  // Built from the mod-core fixtures the other reconciliation tests use: a lost drop, a lost recipe ingredient, an ore that drops nothing, and unnamed things.
  const { sampleProject } = await import("../../mod-core/test/fixtures/gameplay/sample")
  const project = sampleProject() as Project
  const found = reconcile({ ...project, items: [], blocks: project.blocks.map((value) => ({ ...value, name_en: undefined, drop: value.generation ? ("none" as const) : value.drop })) }, { animations: {} }).filter((finding) => finding.targets?.length)
  expect(found.length).toBeGreaterThan(0)
  const formFields = (await import("../src/renderer/features/asset-edit-words")).HAND_WORDS
  const paths = new Set(Object.values(formFields).flatMap((sections) => sections.flatMap((section) => section.fields.map((field) => field.path))))
  for (const finding of found)
    for (const one of finding.targets!) {
      expect(CARD_FIELDS.includes(one.field) || paths.has(one.field)).toBe(true)
      // And the form of the kind the finding is about carries it, so the way to a saved thing's own editor ends on the field.
      expect(formCarries(one.about.kind, one.field)).toBe(true)
    }
  expect(GO_LIMIT).toBeGreaterThan(1)
})

test("英文名框：卡片对应哪一样东西、有什么可以存、哪些写不得", () => {
  const project = {
    blocks: [{ id: "b1", name: "月块", name_en: "Moon Block" }],
    items: [{ id: "i1", name: "Shard" }],
    entities: [{ id: "e1", name: "苔灯蛾", name_en: null }],
  } as unknown as Pick<Project, "blocks" | "items" | "entities">
  expect(englishThing(project, item("x", "block", { asset_id: "b1" }) as never)).toEqual({ kind: "block", id: "b1", name: "月块", nameEn: "Moon Block" })
  // Old content is found by the id after the colon; a creature by its entity id.
  expect(englishThing(project, item("item:i1", "item") as never)).toEqual({ kind: "item", id: "i1", name: "Shard", nameEn: "" })
  expect(englishThing(project, item("entity:e1", "entity", { preview: { entity_id: "e1" } }) as never)).toEqual({ kind: "entity", id: "e1", name: "苔灯蛾", nameEn: "" })
  expect(englishThing(project, item("r", "recipe", { asset_id: "r1" }) as never)).toBeNull()
  expect(englishThing(project, item("gone", "block", { asset_id: "zzz" }) as never)).toBeNull()
  expect(englishProblem("")).toBe("")
  expect(englishProblem("  Moss Moth ")).toBe("")
  expect(englishProblem("苔灯蛾")).toContain("英文名里不能有中文")
  // A name with no Chinese reads the same in both games: the box says so; a Chinese one gets the explanation of what it is for.
  expect(englishHint({ name: "Shard", nameEn: "" })).toBe(ENGLISH_WORDS.notNeeded)
  expect(englishHint({ name: "月块", nameEn: "" })).toBe(ENGLISH_WORDS.help)
})

test("「高级」按钮：说清楚打开会多出什么，并且不改模组；打开以后按所在的页说真正多出来的东西", () => {
  expect(ADVANCED_TITLE).toContain("多显示")
  expect(ADVANCED_TITLE).toContain("不会改你的模组")
  for (const place of ["build", "overview", "editor", "other"] as const) {
    const line = advancedLine(place)
    expect(line).toStartWith("「高级」已打开")
    expect(line).toContain("只是多显示，不改你的模组")
    expect(line).toContain("再点一次「高级」就收起")
  }
  expect(advancedLine("build")).toContain("打包的日志")
  expect(new Set(["build", "overview", "editor", "other"].map((place) => advancedLine(place as never))).size).toBe(4)
})

test("模组信息：字段进出、什么算改过、写错的第一句话、图标先在窗口里按大小拦一道", () => {
  const base = ProjectSchema.parse({
    schema_version: 1, id: crypto.randomUUID(), name: "苔光灯林", description: "夜里发光", mod_id: "moss", target: "fabric-1.21.1", revision: 1,
    created_at: "2026-10-14T00:00:00.000Z", updated_at: "2026-10-14T00:00:00.000Z", entities: [], assets: [], blocks: [], items: [], recipes: [], logic: [],
  })
  const fields = infoFields(base)
  expect(infoOf(fields, undefined)).toEqual({ name: "苔光灯林", name_en: "", description: "夜里发光", description_en: "", release: {} })
  expect(infoChanged(base, fields, undefined)).toBe(false)
  expect(infoChanged(base, { ...fields, author: "小铜" }, undefined)).toBe(true)
  expect(infoChanged(base, fields, "data:image/png;base64,AAAA")).toBe(true)
  expect(infoChanged(base, fields, null)).toBe(false)
  expect(infoOf({ ...fields, author: " 小铜 ", license: "Apache-2.0" }, null)).toMatchObject({ release: { author: "小铜", license: "Apache-2.0" }, icon: null })
  expect(infoProblem({ ...fields, name: " " })).toBe(INFO_WORDS.nameEmpty)
  expect(infoProblem({ ...fields, name_en: "苔光灯" })).toContain("英文名里不能有中文")
  expect(infoProblem({ ...fields, description_en: "中文" })).toBe("英文介绍里不能有中文。")
  expect(infoProblem({ ...fields, version: "1.0" })).toContain("三段数字")
  expect(infoProblem({ ...fields, name_en: "Moss Lantern" })).toBe("")
  // The line says what the build will really write, defaults included, and which licence by its name.
  expect(infoLine(base, "")).toBe("作者 MineMods Studio · 版本 0.1.0 · MIT License")
  expect(infoLine({ release: { author: "小铜", version: "1.2.0", license: "Apache-2.0" } }, "昵称")).toBe("作者 小铜 · 版本 1.2.0 · Apache License 2.0")
  expect(infoLine(base, "昵称")).toContain("作者 昵称")
  // The picture is looked at before it is sent: size and shape from its header.
  const square = (side: number) => encodePng(new Uint8Array(side * side * 4), side, side)
  expect(iconPicked(square(16), "image/png")).toEqual({ ok: true })
  expect(iconPicked(square(300), "")).toEqual({ ok: true })
  expect(iconPicked(square(48), "image/png")).toEqual({ ok: false, text: ICON_WORDS.wrongSide(48) })
  expect(iconPicked(encodePng(new Uint8Array(32 * 16 * 4), 32, 16), "image/png")).toEqual({ ok: false, text: ICON_WORDS.notSquare(32, 16) })
  expect(iconPicked(square(16), "image/jpeg")).toEqual({ ok: false, text: ICON_WORDS.unreadable })
  expect(iconPicked(new Uint8Array(GIVEN_ICON.maxBytes + 1), "image/png")).toEqual({ ok: false, text: ICON_WORDS.tooBig })
  expect(INFO_WORDS.iconRules).toContain("64 像素")
  expect(INFO_WORDS.iconRules).toContain(String(GIVEN_ICON.largest))
})

test("模组信息只有一个家：总览和构建并试玩都通向它，构建面板里不再有第二份表格", () => {
  const renderer = path.join(import.meta.dir, "../src/renderer")
  const app = readFileSync(path.join(renderer, "studio-app.tsx"), "utf8")
  expect(app).not.toContain("ReleaseForm")
  expect(app).toContain("<ModInfo")
  expect(app).toContain("openInfo()")
  expect(readFileSync(path.join(renderer, "release-form.tsx"), "utf8")).not.toContain("onSave")
  expect(readFileSync(path.join(renderer, "features/project-assets.tsx"), "utf8")).toContain("onClick={() => info().open()}")
})

import { DETAILED_THREE_VIEW_REVIEW, DETAILED_THREE_VIEW_SHAPE, styleThreeViewInstructions } from "../src/making"
import { createHash } from "node:crypto"
import { expect, test } from "bun:test"
import {
  CONCEPT_GUIDE,
  conceptPrompt,
  FINDING_LABELS,
  MAKER_INSTRUCTIONS,
  REFERENCE_GUIDE,
  REFERENCE_KINDS,
  REFERENCE_LIMITS,
  REFERENCE_ORDER,
  REFERENCE_REFUSALS,
  REVIEWER_INSTRUCTIONS,
  SELF_REVIEW_INSTRUCTIONS,
  SHEET_INSTRUCTIONS,
  THREE_VIEW_GUIDE,
  THREE_VIEW_REVIEW_RULE,
  THREE_VIEW_SLOTS,
  SIX_VIEW_NAME,
  SIX_VIEW_WORDS,
  SIX_VIEWS,
  threeViewLabel,
  threeViewPrompt,
  viewSlot,
} from "../src/making"
import { SIDE_WORDS } from "../src/orientation"
import { SCRIPT_DENIED } from "../src/script"

// 2026-10-08, the owner's rule: a thing's 六视图 (three views until 03:16 that day, then six) is the shape the person settled on, and whoever makes or reviews it follows it.
// One text says so to every maker and every reviewer; without a three-view nothing changes. Nothing in it is about any one subject.

/** The tools an outside AI drives the loop with: the rule is also read by Studio's own AI, which calls none of them. */
const TOOLS = /\b(look|glance|save_sheet|self_review|final_review|commit_task|fail_task|next_batch|save_concepts|claim_task|update_task)\b/
/** Names of subjects and of their parts, in both languages: the rule and the prompt hold for anything, so they name none. */
const SUBJECTS = ["腿", "手臂", "翅膀", "尾巴", "头", "眼睛", "角", "生物", "动物", "怪物", "龙", "人形", "车", "树", "剑", "机器"]
const ENGLISH = SCRIPT_DENIED.filter((word) => !["proportion", "proportions", "tool", "body"].includes(word))

test("六视图这一条只有一份：给制作者、自评、评审和写说明的都是它；每张渲染图对同一个方向的那一格；没有六视图时它不适用", () => {
  expect(SIX_VIEW_NAME).toBe("六视图")
  expect(REFERENCE_GUIDE).toContain(THREE_VIEW_GUIDE)
  for (const told of [MAKER_INSTRUCTIONS, SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS]) expect(told).toContain(THREE_VIEW_GUIDE)
  for (const told of [SELF_REVIEW_INSTRUCTIONS, REVIEWER_INSTRUCTIONS]) expect(told).toContain(THREE_VIEW_REVIEW_RULE)
  expect(SHEET_INSTRUCTIONS).toContain("其中写着「六视图」的格子是人定下来的形状")
  // The six are the six angles of the renders, named as the renders name them, and each render is held against the view of the same angle.
  const pairs = "「正面」对「正面」、「背面」对「背面」、「它的左侧」对「它的左侧」、「它的右侧」对「它的右侧」、「从上往下」对「从上往下」、「斜前方」对「斜前方」"
  for (const text of [THREE_VIEW_GUIDE, THREE_VIEW_REVIEW_RULE]) expect(text).toContain(pairs)
  expect(THREE_VIEW_GUIDE).toContain("正面、背面、它的左侧、它的右侧、从上往下、斜前方，正好是每一版渲染图拍的六个方向")
  // A whole sheet is read by its fixed places, three to a row; one laid out otherwise by what the picture shows.
  expect(THREE_VIEW_GUIDE).toContain("上排从左到右是正面、背面、它的左侧，下排从左到右是它的右侧、从上往下、斜前方")
  expect(THREE_VIEW_GUIDE).toContain("别的排法（人自己放的，或者以前只画了三个方向的）按画面上看得出的方向去对")
  // What it says: follow it from the same angle, part count and placement included; the blocky style's small differences are fine; without one nothing changes.
  for (const phrase of ["从同一个方向看", "轮廓、各部分的比例、每个部件的位置和数量", "颜色和细节用来照着画贴图", "方块风格", "不算对不上", "以六视图为准", "没有六视图时，这一条不适用"]) expect(THREE_VIEW_GUIDE).toContain(phrase)
  // For whoever judges: a clear mismatch is blocking, not a matter of taste; finer differences are advice at most.
  expect(THREE_VIEW_REVIEW_RULE).toContain(`明显对不上，是${FINDING_LABELS.blocking}`)
  expect(THREE_VIEW_REVIEW_RULE).toContain("不是口味问题")
  expect(THREE_VIEW_REVIEW_RULE).toContain(`最多是${FINDING_LABELS.advice}`)
  expect(REFERENCE_GUIDE).toContain("六视图排第一，人给的参考图其次")
  expect(CONCEPT_GUIDE).toContain("已经有六视图时，照六视图做，不用再画构想图")
  // The old name is gone from everything an AI is told.
  for (const text of [REFERENCE_GUIDE, CONCEPT_GUIDE, THREE_VIEW_REVIEW_RULE, SHEET_INSTRUCTIONS, REVIEWER_INSTRUCTIONS]) expect(text).not.toContain("三视图")
  // Studio's own AI reads the same words and calls no tool; no subject is named anywhere.
  for (const text of [THREE_VIEW_GUIDE, THREE_VIEW_REVIEW_RULE]) {
    expect(text).not.toMatch(TOOLS)
    for (const word of SUBJECTS) expect(text).not.toContain(word)
  }
})

test("六视图的格子、上限和排序：一整张或六格，和渲染图的六个角度同序同名；以前的「侧面」读作它的左侧；排在人给的参考图前面", () => {
  expect(REFERENCE_KINDS).toEqual(["user", "concept", "three_view"])
  expect(REFERENCE_ORDER).toEqual(["three_view", "user", "concept"])
  expect(SIX_VIEWS).toEqual(["front", "back", "left", "right", "top", "quarter"])
  expect(THREE_VIEW_SLOTS).toEqual(["sheet", "front", "back", "left", "right", "top", "quarter", "side"])
  expect(SIX_VIEW_WORDS).toEqual({ front: "正面", back: "背面", left: SIDE_WORDS.left, right: SIDE_WORDS.right, top: "从上往下", quarter: "斜前方" })
  expect(viewSlot("side")).toBe("left")
  for (const slot of THREE_VIEW_SLOTS.filter((value) => value !== "side")) expect(viewSlot(slot)).toBe(slot)
  expect(REFERENCE_LIMITS.three_view).toBe(6)
  // Seven on the reference sheet: the six views and the person's first picture.
  expect(REFERENCE_LIMITS.shown).toBe(7)
  expect(threeViewLabel("front", "person")).toBe("六视图 · 正面（人给的）")
  expect(threeViewLabel("left", "ai")).toBe("六视图 · 它的左侧（AI 画的，人确认过才留下）")
  expect(threeViewLabel("side", "person")).toBe("六视图 · 它的左侧（人给的）")
  expect(threeViewLabel("quarter", "person")).toBe("六视图 · 斜前方（人给的）")
  expect(threeViewLabel("sheet", "ai")).toBe("六视图 · 一整张（AI 画的，人确认过才留下）")
  expect(REFERENCE_REFUSALS.too_many("three_view")).toBe("六视图最多 6 张：一整张，或者六个方向各一张。")
  expect(REFERENCE_REFUSALS.person_three_view).toBe("这样东西已经有你自己给的六视图了，AI 画的不会盖掉它。想让 AI 重画，先把你给的六视图去掉。")
  expect(REFERENCE_REFUSALS.not_a_model).toBe("六视图只给模型用：方块和物品做的是一张 16×16 的图，用普通的参考图就好。")
})

test("画六视图的话：照这样东西自己的话画，一张图上三列两行六个方向、位置固定、同一比例、方块风格；说明再长也不截掉版式", () => {
  const sheet = { subject: "一样东西。", recognisable: ["一眼认得出的样子"], parts: [{ name: "a", what: "主体", shape: "方的，约 8 像素", attaches: "落在地上", surface: "灰色", moves: "不动", assumed: false }] }
  const prompt = threeViewPrompt({ title: "灰色方块", words: "一样灰色的东西", sheet, note: "  正面再方一点  " })
  for (const phrase of ["Name: 灰色方块.", "What it is: 一样灰色的东西", "Subject: 一样东西。", "a (主体; shape: 方的，约 8 像素", "The person who asked for it adds: 正面再方一点 ", "Six-view reference sheet", "Same scale", "no text, no labels, no numbers", "Minecraft blocky model", "axis-aligned cuboids", "pixel-art"]) expect(prompt).toContain(phrase)
  // Six places, fixed, three to a row in the order of the renders, each said the way the pictures mean it.
  for (const phrase of [
    "a grid of exactly six views of the same thing, three columns and two rows, every view in its fixed place",
    "Top row, left to right: the front view (it faces the viewer); the back view; its own left side (seen from its own left, so its front points to the left edge of the picture)",
    "Bottom row, left to right: its own right side (seen from its right, so its front points to the right edge of the picture); the top-down view from directly above (its front towards the bottom of the picture); a three-quarter front-right orthographic view: start at the straight-front camera in the top-left cell, move 45 degrees toward the viewer's left (the subject's own right, the same flank as the bottom-left profile), then raise the camera 15 degrees. In this cell the front points diagonally toward the right edge, and both the front and that right flank take up substantial visible width",
    "align the views with invisible guides and leave independent blank gutters",
    "Plain flat neutral light background",
  ])
    expect(prompt).toContain(phrase)
  expect(prompt.indexOf("the front view")).toBeLessThan(prompt.indexOf("the back view"))
  expect(prompt.indexOf("its own left side")).toBeLessThan(prompt.indexOf("its own right side"))
  expect(prompt.indexOf("its own right side")).toBeLessThan(prompt.indexOf("the top-down view"))
  expect(prompt.indexOf("the top-down view")).toBeLessThan(prompt.indexOf("a three-quarter front-right orthographic view"))
  expect(prompt).not.toContain("left to right: front, side, back")
  // Without a sheet or a note, the thing's own words are enough.
  const bare = threeViewPrompt({ title: "灰色方块", words: "" })
  expect(bare).not.toContain("Subject:")
  expect(bare).not.toContain("adds:")
  expect(bare).not.toContain("What it is")
  // However long the words, the layout and style are said whole and the prompt fits what the endpoint is sent.
  const long = threeViewPrompt({ title: "灰色方块", words: "很长的话。".repeat(4000), note: "备注" })
  expect(long.length).toBeLessThanOrEqual(8000)
  expect(long).toContain("Bottom row, left to right")
  expect(long.endsWith("chunky game proportions.")).toBe(true)
  // The same for anything: no subject named in what it is told beyond the thing's own words.
  const told = bare.replace("Name: 灰色方块. ", "").toLowerCase()
  for (const word of ENGLISH) expect(told).not.toMatch(new RegExp(`\\b${word}\\b`))
  // The concept prompt Studio's own AI uses is unchanged in what it says.
  expect(conceptPrompt(sheet)).toContain("Layout: three orthographic views of the same thing side by side on one plain light background")
})

test("the style table defaults to the old wording within the shared revised layout", () => {
  const thing = { title: "Fixture", words: "One model." }
  const prompt = threeViewPrompt(thing)
  expect(prompt).toBe(threeViewPrompt(thing, "blocky"))
  expect(createHash("sha256").update(prompt).digest("hex")).toBe("be018bf71c1493ea5738951aa5097a7814cd9321817e1f455af7102380eb3b36")
  expect(threeViewPrompt(thing, "angled")).toContain("No curved or smooth surfaces.")
  expect(threeViewPrompt(thing, "sculpted")).toContain("ellipsoids, cylinders, cones")
  expect(threeViewPrompt(thing, "free")).toContain("stylised low-poly game boss")
  expect(threeViewPrompt(thing, "sculpted")).toContain("roughly 600 boxes or fewer")
  expect(prompt).not.toContain("roughly 600")
})

test("the actual modelling and review wording changes only for a stored detailed view", () => {
  const old = { kind: "three_view" } as const
  const blocky = { kind: "three_view", style: "blocky" } as const
  const sculpted = { kind: "three_view", style: "sculpted" } as const
  const lines = REFERENCE_GUIDE + THREE_VIEW_REVIEW_RULE
  expect(styleThreeViewInstructions(lines, [])).toBe(lines)
  expect(styleThreeViewInstructions(lines, [old, blocky])).toBe(lines)
  const strict = styleThreeViewInstructions(lines, [sculpted])
  expect(strict).toContain(DETAILED_THREE_VIEW_SHAPE)
  expect(strict).toContain(DETAILED_THREE_VIEW_REVIEW)
  expect(strict).not.toContain("逼出来的小出入")
  const mixed = styleThreeViewInstructions(lines, [old, sculpted])
  expect(mixed).toContain("标为「精细造型」")
  expect(mixed).toContain("其余六视图照老规则")
  expect(mixed).toContain(DETAILED_THREE_VIEW_REVIEW)
})

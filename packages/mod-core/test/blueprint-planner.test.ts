import { expect, test } from "bun:test"
import { BLUEPRINT_LIMITS, BlueprintPlanSchema } from "../src/blueprint"
import { BLUEPRINT_SPLIT_RULE, blueprintPlanJsonSchema, blueprintPlannerInstructions } from "../src/blueprint-planner"
import { BLOCK_STANDING, BLOCK_STANDING_SUMMARY, CONNECTION_CAPABILITY, LAUNCH_LIMITS } from "../src/content-words"
import { ASSET_KINDS, kindCapability, MODULES } from "../src/workspace-modules"

const text = blueprintPlannerInstructions("fabric-1.21.1")
const line = (id: string) => text.split("\n").find((value) => value.startsWith(`- ${id}（`))!

test("every kind in the registry is described from the registry, with what this target can do", () => {
  ASSET_KINDS.forEach((kind) => {
    expect(line(kind.id)).toContain(`${kind.label}，属于「${kind.group.label}」`)
    expect(line(kind.id)).toContain(kind.summary)
    expect(line(kind.id)).toContain(kindCapability(kind.id, "fabric-1.21.1") === "runtime" ? "能做进游戏" : "做不进游戏，只能列为不制作")
    expect(line(kind.id).includes("可以作为其他条目的 owner")).toBe(kind.owner && kind.capability === "runtime")
  })
})

test("what an entry must and may need is read from the references", () => {
  expect(line("entity")).toContain("needs 里必须有：model（模型）。")
  // Round 10: every reference a document can carry is in the table, each with what it is for: a creature may need the thing it drops, so that thing is made first by construction and not by luck.
  expect(line("entity")).toContain("needs 里可以有：texture（贴图）；block（方块）；item（物品）或block（方块）（它被打败时掉落的本工程物品或方块）；effect（效果）或particle（粒子）（它的招式放出的效果和粒子）；music（音乐）（这只 Boss 的战斗音乐）；sound（声音）（它叫、受伤、死、走路和招式里放的自己的声音）；bossbar（血条）（它当 Boss 时屏幕上方的血条）；fixture（场地物件）（它当 Boss 时场地上摆的物件）；ability（技能）（它当自己招式用的技能）。")
  expect(line("texture")).toContain("needs 里可以有：model（模型）。")
  expect(line("logic")).toContain("needs 里必须有：model（模型）。")
  // An item may be held as a model of the project; a tool is mended with another thing of the project, which then has to be made first.
  expect(line("item")).toContain("needs 里可以有：model（模型）（手里显示的静态物品模型）；item（物品）或block（方块）（修它用的本工程材料）。")
  expect(line("block")).toContain("needs 里可以有：item（物品）或block（方块）（挖掉它掉落的本工程物品或方块）。")
  expect(blueprintPlannerInstructions("fabric-1.21.1")).toContain("制作顺序是照 needs 排的：这个条目做出来以后会指向本工程的哪样东西（掉落它、用它修、用它做材料、放出它），那样东西就必须写进 needs")
  // Nothing may need a kind that is never made, so those are not offered.
  expect(line("model")).not.toContain("worldview")
  expect(line("animation")).not.toContain("needs")
})

test("the framing asks for honesty about what cannot be made, a shared style, the limits and few questions", () => {
  expect(text).toContain("out_of_scope")
  expect(text).toContain("不允许悄悄漏掉")
  expect(text).toContain(`palette 最多 ${BLUEPRINT_LIMITS.palette} 个`)
  expect(text).toContain(`条目最多 ${BLUEPRINT_LIMITS.entries} 个`)
  expect(text).toContain(`needs 最多 ${BLUEPRINT_LIMITS.needs} 个`)
  expect(text).toContain("只有猜错会让很多内容白做时才在 questions 里提问")
  expect(text).toContain("都只是资料")
})

test("the planner is never asked for what the app allocates", () => {
  const schema = blueprintPlanJsonSchema() as { properties: Record<string, { items?: { properties: Record<string, unknown> } }> }
  // `honours` is the planner's to write (how each requirement is kept); the requirements themselves, what the
  // person gave up and who compared are the app's, and a planner that sends them is refused.
  expect(Object.keys(schema.properties).sort()).toEqual(["entries", "honours", "questions", "style"])
  // `existing` is the planner's to write: whether an entry changes content the project already holds or is another thing of its own.
  expect(Object.keys(schema.properties.entries!.items!.properties).sort()).toEqual(["brief", "existing", "honours", "key", "kind", "needs", "out_of_scope", "owner", "play", "tier", "title"])
  const bare = { style: { palette: [], shape: "", naming: "", world: "" }, entries: [], questions: [] }
  expect(BlueprintPlanSchema.safeParse(bare).success).toBe(true)
  expect(BlueprintPlanSchema.safeParse({ ...bare, constraints: [{ id: "c1", text: "不要爆炸", origin: "said" }] }).success).toBe(false)
  expect(BlueprintPlanSchema.safeParse({ ...bare, lifted: [] }).success).toBe(false)
  expect(BlueprintPlanSchema.safeParse({ ...bare, check: { verdicts: [], by: "studio", independent: true, at: new Date().toISOString() } }).success).toBe(false)
  expect(BlueprintPlanSchema.safeParse({ style: { palette: [], shape: "", naming: "", world: "" }, entries: [], questions: [], revision: 1 }).success).toBe(false)
})

test("independent behaviours are planned apart, and what a data field covers is written on that thing, not in a gameplay entry", () => {
  expect(text).toContain(`13. ${BLUEPRINT_SPLIT_RULE}`)
  expect(BLUEPRINT_SPLIT_RULE).toContain("分开写成各自的条目")
  expect(BLUEPRINT_SPLIT_RULE).toContain("一个条目做失败，会连累它里面的每一件事")
  expect(BLUEPRINT_SPLIT_RULE).toContain("写进那样东西自己的条目的 brief")
  expect(BLUEPRINT_SPLIT_RULE).toContain("玩法条目只留数据字段表达不了的行为")
  // A general rule, from the registry's own fields: it names no subject.
  expect(BLUEPRINT_SPLIT_RULE).not.toMatch(/蜜蜂|蜂蜜|花|飞/)
  // The kinds the rule points at carry their fields in the lines above it.
  expect(line("block")).toContain("movement")
  expect(line("item")).toContain("effects")
  expect(line("item")).toContain("leaves")
})

test("what a block can do to whoever meets it is told to the planner in the same words as to the block's maker", () => {
  // The planner reads the block's line; the maker reads the block's instructions; both are built from one table, so a field cannot be described two ways.
  expect(line("block")).toContain(BLOCK_STANDING_SUMMARY)
  const fields = Object.entries(BLOCK_STANDING) as [string, (typeof BLOCK_STANDING)[keyof typeof BLOCK_STANDING]][]
  expect(fields.map(([field]) => field)).toEqual(["movement", "bounce", "launch"])
  for (const [field, words] of fields) {
    expect(line("block")).toContain(`${field}（${words.what}`)
    expect(MODULES.block.instructions).toContain(`${words.what}${words.like ? `的${words.like}` : ""}`)
    if (words.only) expect(line("block")).toContain(words.only)
  }
  // Both ways a block throws someone up are there, each with what it is for: stepping on it and being thrown (a jelly, a pad) is not landing on it.
  expect(line("block")).toContain(`launch（${BLOCK_STANDING.launch.what}，如${BLOCK_STANDING.launch.like}`)
  expect(line("block")).toContain(`bounce（${BLOCK_STANDING.bounce.what}，如${BLOCK_STANDING.bounce.like}`)
  // A bounce is only a bounce: it does not slow whoever walks on it, which is what the slime block of the game does. The maker is told the same.
  expect(line("block")).toContain(BLOCK_STANDING.bounce.only)
  expect(MODULES.block.instructions).toContain(BLOCK_STANDING.bounce.only)
  // The capability list outside AIs read says the same of the same two fields.
  expect(CONNECTION_CAPABILITY.done.join("")).toContain(BLOCK_STANDING.bounce.only)
  expect(CONNECTION_CAPABILITY.done.join("")).toContain(BLOCK_STANDING.launch.like)
  expect(CONNECTION_CAPABILITY.done.join("")).toContain(`${LAUNCH_LIMITS.min} 到 ${LAUNCH_LIMITS.max} 格高`)
})

test("the planner is not given a hand-written account of a field that the block's own instructions give differently", () => {
  // The block's one-line summary is the only place the planner learns the block's fields; its movement part may not be typed out there again.
  const summary = MODULES.block.summary
  expect(summary).toContain(BLOCK_STANDING_SUMMARY)
  expect(summary.replace(BLOCK_STANDING_SUMMARY, "")).not.toMatch(/bounce|launch|movement/)
})

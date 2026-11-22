import { expect, test } from "bun:test"
import { nextBlueprintBatch, validateBlueprint, type Blueprint } from "../src/blueprint"
import { EXISTING_REFUSALS, existingRefusal } from "../src/blueprint-existing"
import { blueprintPlanJsonSchema, blueprintPlannerInstructions, paperPlayInstructions } from "../src/blueprint-planner"
import { CONSTRAINT_CHECK_INSTRUCTIONS, constraintCheckInstructions, INDEPENDENCE_REFUSALS, PLAN_CHECK_WORDS, SELF_CHECK_WORDS } from "../src/blueprint-constraints"
import { PAPER_PLAY_INSTRUCTIONS, PLAY_REFUSALS } from "../src/playable"
import { PARALLEL_WORDS } from "../src/workspace-runs"

const TARGET = "fabric-1.21.1"
// What each text asks for when somebody else reads the plan; none of it may survive in a text for an AI whose reviewer was switched off.
const ASKS_FOR_ANOTHER = ["没参与规划的试玩员", "只看得到要求和条目的核对员", "你没有参与规划", "请一个没有参与规划的评审"]

test("审查关着：规划规则、核对说明、纸上试玩说明都不再要一个没参与规划的人，并且一致地说自己核对、independent 填 false", () => {
  const planner = blueprintPlannerInstructions(TARGET, "self")
  const check = constraintCheckInstructions("self")
  const paper = paperPlayInstructions("self")
  for (const text of [planner, check, paper]) {
    ASKS_FOR_ANOTHER.forEach((phrase) => expect(text).not.toContain(phrase))
    expect(text).toContain("independent")
    expect(text).toContain("false")
  }
  expect(planner).toContain(SELF_CHECK_WORDS.rule)
  expect(check).toContain(SELF_CHECK_WORDS.check_tail)
  expect(paper).toContain(SELF_CHECK_WORDS.paper_tail)
  // The rest of each brief is the same: only who reads changes.
  expect(check).toContain("每一条 constraint 都必须给出一个结论")
  expect(paper).toContain("遇不上")
  expect(planner).toContain("12. 生物档位")
})

test("审查开着（默认）：三份说明和以前逐字相同，仍然要没参与规划的人来读", () => {
  expect(blueprintPlannerInstructions(TARGET)).toBe(blueprintPlannerInstructions(TARGET, "independent"))
  expect(blueprintPlannerInstructions(TARGET)).toContain("蓝图保存前会由一个只看得到要求和条目的核对员逐条核对")
  expect(blueprintPlannerInstructions(TARGET)).toContain("保存前还会有一个没参与规划的试玩员")
  expect(blueprintPlannerInstructions(TARGET)).not.toContain(SELF_CHECK_WORDS.rule)
  expect(constraintCheckInstructions()).toBe(CONSTRAINT_CHECK_INSTRUCTIONS)
  expect(paperPlayInstructions()).toBe(PAPER_PLAY_INSTRUCTIONS)
  expect(PLAN_CHECK_WORDS.independent).toContain("没有参与规划的评审")
  expect(PLAN_CHECK_WORDS.self).toBe(SELF_CHECK_WORDS.rule)
})

test("审查关着时被退回的话也是同一个意思：自己做、写 false；没有别的评审可请", () => {
  expect(PLAY_REFUSALS.unplayed_self).toContain("independent 填 false")
  expect(PLAY_REFUSALS.unplayed_self).not.toContain("请一个没有参与规划的评审")
  const refusal = INDEPENDENCE_REFUSALS.no_reviewer("paper_play", "在纸上从头玩一遍")
  expect(refusal).toContain("没有任何别的评审")
  expect(refusal).toContain("paper_play.independent")
  expect(refusal).toContain("改成 false")
})

// ---- existing content ----

const ID = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const asset = (id: string, module: string, title: string) => ({ id, module, title })
const project = (assets: ReturnType<typeof asset>[], blueprint?: Blueprint) => ({ workspace: { assets }, blueprint }) as unknown as Parameters<typeof existingRefusal>[0]
const entry = (over: Record<string, unknown> = {}) => ({ key: "moth", kind: "entity" as const, title: "苔灯蛾", brief: "一只翅膀发出苔绿色微光的蛾子。", owner: null, needs: [], out_of_scope: null, ...over }) as Parameters<typeof existingRefusal>[1]["entries"][number]

test("新条目和已有内容同名：退回，并说清怎么改那一样（它的 id）或者声明这是另一样不同的东西", () => {
  const held = project([asset(ID, "entity", "苔灯蛾")])
  const why = existingRefusal(held, { entries: [entry()] })!
  expect(why).toContain("「苔灯蛾」和工程里已有的")
  expect(why).toContain(ID)
  expect(why).toContain(`existing: { id: "${ID}", action: "change" }`)
  expect(why).toContain(`action: "separate"`)
  // Spacing and punctuation are not part of a name.
  expect(existingRefusal(held, { entries: [entry({ title: "苔灯 蛾。" })] })).toBe(EXISTING_REFUSALS.clash("苔灯 蛾。", { id: ID, kind: "entity", title: "苔灯蛾" }, "name"))
  // Another kind of thing with the same word in its name is not the same thing.
  expect(existingRefusal(held, { entries: [entry({ kind: "item" })] })).toBeNull()
})

test("改已有的内容：写 change 就放行，任务直接改那一样；找不到、种类不一致、两个条目改同一样都退回", () => {
  const held = project([asset(ID, "entity", "苔灯蛾"), asset(OTHER, "model", "苔灯蛾的模型")])
  expect(existingRefusal(held, { entries: [entry({ existing: { id: ID, action: "change" } })] })).toBeNull()
  expect(existingRefusal(held, { entries: [entry({ existing: { id: "33333333-3333-4333-8333-333333333333", action: "change" } })] })).toContain("找不到这一样")
  expect(existingRefusal(held, { entries: [entry({ existing: { id: OTHER, action: "change" } })] })).toContain("不是同一种东西")
  expect(existingRefusal(held, { entries: [entry({ existing: { id: ID, action: "change" } }), entry({ key: "moth_two", title: "另一只", existing: { id: ID, action: "change" } })] })).toContain("都要改同一样已有的内容")
  // The plan itself refuses two entries on one thing too.
  const batch = (entries: unknown[]) => validateBlueprint({ request: "x", style: { palette: [], shape: "", naming: "", world: "" }, entries: entries.map((value) => ({ asset_id: null, ...(value as object) })), questions: [], revision: 1, state: "draft" }, TARGET)
  expect(() => batch([entry({ existing: { id: ID, action: "change" } }), entry({ key: "b", existing: { id: ID, action: "change" } })])).toThrow("都要改同一样已有的内容")
})

test("声明是另一样不同的东西：要写出哪里不同才放行", () => {
  const held = project([asset(ID, "entity", "苔灯蛾")])
  expect(existingRefusal(held, { entries: [entry({ existing: { id: ID, action: "separate" } })] })).toContain("existing.why")
  expect(existingRefusal(held, { entries: [entry({ existing: { id: ID, action: "separate", why: "这是夜里才出现的另一种蛾，旧的是白天的" } })] })).toBeNull()
})

test("说明里写着要改已有的内容、名字却不同：也退回；太短的名字、不同种类、已做好的自己都不算", () => {
  const held = project([asset(ID, "entity", "四足示例")])
  const described = entry({ title: "飞蛾", brief: "把四足示例改成一只会飞的蛾子。" })
  expect(existingRefusal(held, { entries: [described] })).toBe(EXISTING_REFUSALS.clash("飞蛾", { id: ID, kind: "entity", title: "四足示例" }, "described"))
  // Mentioning it without changing it is not a change.
  expect(existingRefusal(held, { entries: [entry({ title: "飞蛾", brief: "它从不靠近四足示例。" })] })).toBeNull()
  // A two-character name is in too many briefs to say which one is meant.
  expect(existingRefusal(project([asset(ID, "entity", "狐狸")]), { entries: [entry({ title: "飞蛾", brief: "把狐狸改成蛾。" })] })).toBeNull()
  // An entry that already has its asset is that thing, not a second one.
  const made = project([asset(ID, "entity", "苔灯蛾")], { entries: [{ key: "moth", kind: "entity", asset_id: ID }] } as unknown as Blueprint)
  expect(existingRefusal(made, { entries: [entry()] })).toBeNull()
  expect(existingRefusal(made, { entries: [entry({ existing: { id: OTHER, action: "change" } })] })).toContain("找不到这一样")
})

test("改已有内容的条目开工时直接是对那一样的修改（target_id），别处的任务不受影响；规划规则讲了怎么写", () => {
  const blueprint = {
    request: "把示例改成蛾",
    style: { palette: [], shape: "", naming: "", world: "" },
    entries: [
      { ...entry({ existing: { id: ID, action: "change" } }), asset_id: null },
      { ...entry({ key: "fresh", title: "新东西", kind: "item" }), asset_id: null },
    ],
    questions: [],
    revision: 1,
    state: "confirmed",
  } as unknown as Blueprint
  const plan = nextBlueprintBatch(blueprint, [])!
  expect(plan.tasks.map((task) => [task.key, task.target_id])).toEqual([["moth", ID], ["fresh", null]])
  expect(plan.tasks[0]!.prompt).toContain(`资产 ID ${ID}`)
  expect(plan.tasks[1]!.prompt).not.toContain("已有的内容")
  const text = blueprintPlannerInstructions(TARGET)
  expect(text).toContain("输入里的 existing 是工程里已经有的内容")
  expect(text).toContain(`action: "change"`)
  expect(Object.keys((blueprintPlanJsonSchema() as { properties: { entries: { items: { properties: object } } } }).properties.entries.items.properties)).toContain("existing")
})

// ---- the call after a task ended without a commit ----

const task = (key: string, state: string, dependencies: string[] = []) => ({ id: `id-${key}`, key, title: `任务${key}`, module: "model", state, dependencies })

test("任务结束但没提交以后接下来调用什么，照这一批现在的样子算：还有能领的就领，手上有就接着做，这一批真结束了才是 next_batch", () => {
  const run = (state: string, tasks: ReturnType<typeof task>[]) => ({ state, tasks }) as unknown as Parameters<typeof PARALLEL_WORDS.ended>[0]
  // The case that was refused: the model task ended (kept for the person), its dependent is still queued and can be claimed now.
  const ready = PARALLEL_WORDS.ended(run("running", [task("model", "completed"), task("creature", "queued", ["model"])]))
  expect(ready).toContain("claim_task")
  expect(ready).toContain("「任务creature」")
  expect(ready).not.toContain("调用 next_batch")
  // Something is still in hand and the rest waits for it.
  const waiting = PARALLEL_WORDS.ended(run("running", [task("model", "completed"), task("a", "running"), task("b", "queued", ["a"])]))
  expect(waiting).toContain("手上还有 1 个在做")
  expect(waiting).not.toContain("调用 next_batch")
  // The batch is over.
  expect(PARALLEL_WORDS.ended(run("completed", [task("model", "completed")]))).toContain("调用 next_batch")
  // Not known: it says how to find out, and names both calls conditionally.
  expect(PARALLEL_WORDS.ended(null)).toContain("get_run")
})

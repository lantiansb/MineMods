import { expect, test } from "bun:test"
import { creatureName, gameplayThings, type GameplayDocument } from "../src/gameplay"
import { alreadyForReview, overlapAdvice, savedGameplays } from "../src/gameplay-already"
import { staticChecks } from "../src/gameplay-check"
import { GameplayRecordSchema, beginGameplay, checkedGameplay, describeGameplay, shownGameplay } from "../src/gameplay-loop"
import { PLAIN_RULES } from "../src/gameplay-plain"
import { gameplayThingsForWriter } from "../src/gameplay-things"
import { GAMEPLAY_DISCIPLINE, GAMEPLAY_REFUSALS, GAMEPLAY_REVIEWER_INSTRUCTIONS, GAMEPLAY_SHEET_INSTRUCTIONS, GAMEPLAY_WRITER_INSTRUCTIONS } from "../src/gameplay-words"
import { gameplaySheet } from "../src/gameplay"
import { MakingRefusal } from "../src/making"
import type { Project } from "../src/project"
import { WorkspaceAssetSchema } from "../src/workspace"
import { identifiersIn } from "../src/play-words"
import { BOX_GUARD, IDS, sampleProject } from "./fixtures/gameplay/sample"

/**
 * broad22-api-r5, in neutral words: two gameplays on one creature each added a timer for the same act, and each wrote the bounce that the block under it already had.
 * Each was written and reviewed on its own description and code, and nobody was told what the others, or the things themselves, already did.
 */

const ROOT = "com.minemods.content_legacy_sample.gameplay"
const REAL = "c0000000-0000-4000-8000-0000000000"
const RULES_ASSET = "77777777-7777-4777-8777-777777777777"

/** The sample project with its block throwing up whoever steps on it and its creature of the given kind. */
function sample(kind: "hostile" | "follow" | "passive" = "follow", launch: number | null = 3): Project {
  const project = sampleProject()
  return { ...project, blocks: project.blocks.map((block) => (block.id === IDS.block ? { ...block, launch } : block)), entities: project.entities.map((entity) => (entity.id === IDS.creature ? { ...entity, behavior: kind } : entity)) }
}

const document = (slug: string, name: string, summary: string, uses: string[], main: string, behaviours: GameplayDocument["behaviours"] = [{ when: "每过二十秒", does: summary, shows: "看得见" }]): GameplayDocument => ({
  kind: "gameplay",
  slug,
  name,
  summary,
  behaviours,
  not_doing: [],
  uses,
  sources: [{ path: "Main.java", content: `package ${ROOT}.${slug};\n\nimport ${ROOT}.api.GameplayEntry;\nimport ${ROOT}.api.ProjectContent;\n\npublic final class Main implements GameplayEntry {\n    @Override public void onInitialize() {\n${main}\n    }\n}\n` }],
  data: [],
  lang: { zh_cn: {}, en_us: {} },
})
const withGameplay = (project: Project, id: string, doc: GameplayDocument): Project => {
  const now = new Date().toISOString()
  const asset = WorkspaceAssetSchema.parse({ id, module: "gameplay", title: doc.name, revision: 1, created_at: now, updated_at: now, prompt: doc.name, dependencies: [], document: doc, provenance: { model: "example", request_id: null }, status: "ready" })
  return { ...project, workspace: { assets: [...project.workspace.assets, asset] } }
}

const LAY = document("lay_egg", "下蛋", "小鸡每隔二十到四十秒下一个蛋。", [RULES_ASSET], `        ProjectContent.addGoal("${IDS.creature}", 3, LayGoal::new);`)
const HATCH = document("hatch_egg", "孵蛋", "右键地面用蛋孵出小鸡。", [IDS.creature, IDS.block], `        ProjectContent.addGoal("${IDS.creature}", 3, LayGoal::new);\n        entity.setDeltaMovement(0, 1, 0);`)

test("a thing says what it already does by its own settings, and nothing for a thing that does nothing by itself", () => {
  const things = gameplayThingsForWriter(sample("follow"), null)
  const block = things.find((thing) => thing.asset_id === IDS.block)!
  // The block's own launch, with the one fact a copy of it would get wrong: whoever sneaks is not thrown.
  expect(block.already).toEqual([{ by: "它自己", does: expect.stringContaining("潜行的人不弹") }])
  expect(block.already![0]!.does).toContain("约 3 格高")
  // A creature that follows is said to follow, to fight nobody, and to need no target rules.
  const creature = things.find((thing) => thing.asset_id === IDS.creature)!
  expect(creature.already!.map((line) => line.does).join("；")).toContain("会跟着手里拿着小麦的玩家走")
  expect(creature.already!.map((line) => line.does).join("；")).toContain("不会打人")
  expect(gameplayThingsForWriter(sample("hostile"), null).find((thing) => thing.asset_id === IDS.creature)!.already!.map((line) => line.does).join("；")).toContain("会打人")
  // A block with no launch, bounce or movement says nothing; the item has no settings of this sort either.
  expect(gameplayThingsForWriter(sample("follow", null), null).find((thing) => thing.asset_id === IDS.block)!.already).toBeUndefined()
  expect(things.find((thing) => thing.asset_id === IDS.item)!.already).toBeUndefined()
})

test("another gameplay on the same creature is told on it by name with what it does, under either of the creature's ids; the gameplay being written is not its own neighbour", () => {
  const project = withGameplay(sample("follow"), `${REAL}01`, LAY)
  const others = savedGameplays(project, null)
  expect(others).toEqual([{ asset_id: `${REAL}01`, name: "下蛋", summary: LAY.summary, behaviours: LAY.behaviours, uses: [RULES_ASSET] }])
  // LAY lists the creature by the asset of its rules; the creature is one thing, so the line is on the creature.
  const creature = gameplayThingsForWriter(project, null, others).find((thing) => thing.asset_id === IDS.creature)!
  expect(creature.already!.filter((line) => line.by === "玩法「下蛋」")).toEqual([{ by: "玩法「下蛋」", does: expect.stringContaining("小鸡每隔二十到四十秒下一个蛋。") }])
  expect(creature.already!.find((line) => line.by === "玩法「下蛋」")!.does).toContain("每过二十秒")
  // Written again, it does not meet itself.
  const again = gameplayThingsForWriter(project, `${REAL}01`, savedGameplays(project, `${REAL}01`)).find((thing) => thing.asset_id === IDS.creature)!
  expect(again.already!.some((line) => line.by.startsWith("玩法"))).toBe(false)
  // The block nobody else lists has only its own line.
  expect(gameplayThingsForWriter(project, null, others).find((thing) => thing.asset_id === IDS.block)!.already!.map((line) => line.by)).toEqual(["它自己"])
})

test("a reviewer is told the same, for the things the gameplay lists and no others", () => {
  const project = withGameplay(sample("follow"), `${REAL}01`, LAY)
  const others = savedGameplays(project, null)
  const onlyBlock = alreadyForReview(project, [IDS.block], others, null)
  expect(onlyBlock.map((entry) => entry.thing)).toEqual(["秘匣"])
  const both = alreadyForReview(project, [IDS.block, IDS.creature], others, null)
  expect(both.map((entry) => entry.thing)).toEqual(["秘匣", "苔皮苦力怕"])
  expect(both[1]!.already.map((line) => line.by)).toContain("玩法「下蛋」")
  expect(alreadyForReview(project, [IDS.item], others, null)).toEqual([])
})

test("a second gameplay that adds behaviour to the same creature, and code that sets the speed over a block that already throws, are noticed and never refused", () => {
  const project = withGameplay(sample("follow"), `${REAL}01`, LAY)
  const twice = overlapAdvice(project, HATCH, `${REAL}02`)
  expect(twice.map((found) => found.rule)).toEqual(["goal_twice", "velocity_twice"])
  expect([twice[0]!.file, twice[0]!.line, twice[1]!.file, twice[1]!.line]).toEqual(["Main.java", 8, "Main.java", 9])
  expect(twice[0]!.message).toContain("玩法「下蛋」也给「苔皮苦力怕」加了行为")
  expect(twice[1]!.message).toContain("「秘匣」")
  // What is said names no code; the rules have sentences for the person as well.
  for (const found of twice) {
    expect(identifiersIn(found.message)).toEqual([])
    expect(found.rule in PLAIN_RULES).toBe(true)
  }
  // They arrive with the machine checks as advice, which the floor does not count.
  const checked = staticChecks(project, HATCH, `${REAL}02`)
  expect(checked.advice!.map((found) => found.rule)).toEqual(["goal_twice", "velocity_twice"])
  expect(checked.bounds).toEqual([])
  expect(checked.references.some((found) => found.rule === "goal_twice")).toBe(false)
  // The same code with nothing already there says nothing: the other gameplay is the one being written, the block throws nothing, or nothing sets a speed.
  expect(overlapAdvice(project, HATCH, `${REAL}01`).map((found) => found.rule)).toEqual(["velocity_twice"])
  expect(overlapAdvice({ ...project, blocks: project.blocks.map((block) => ({ ...block, launch: null })) }, HATCH, `${REAL}02`).map((found) => found.rule)).toEqual(["goal_twice"])
  const quiet = document("hatch_egg", "孵蛋", "右键地面用蛋孵出小鸡。", [IDS.creature, IDS.block], "        ProjectContent.block(\"mystery_box\");")
  expect(overlapAdvice(project, quiet, `${REAL}02`)).toEqual([])
  // A creature is the same creature however the other gameplay names it: the model's asset and the asset of its rules.
  const byModel = document("hatch_egg", "孵蛋", "右键地面用蛋孵出小鸡。", [IDS.creature], `        ProjectContent.addGoal("${IDS.creature}", 4, LayGoal::new);`)
  expect(creatureName({ id: IDS.creature })).toBe(gameplayThings(project).find((thing) => thing.asset_id === RULES_ASSET)!.registry!)
  expect(overlapAdvice(project, byModel, `${REAL}02`).map((found) => found.rule)).toEqual(["goal_twice"])
})

test("a target rule on a creature that does not fight: the boundary is in what every writer is told, on the creature, and the finding sends the writer to the description", () => {
  const boundary = "对它用 targetRule 或 addTargetGoal，check_code 会退回"
  for (const words of [GAMEPLAY_DISCIPLINE, GAMEPLAY_SHEET_INSTRUCTIONS, GAMEPLAY_WRITER_INSTRUCTIONS]) expect(words).toContain(boundary)
  // Said once: the old sentence about target rules grew the boundary, no second paragraph was added for it.
  expect(GAMEPLAY_DISCIPLINE.split("targetRule").length - 1).toBe(2)
  const project = sample("passive")
  expect(gameplayThingsForWriter(project, null).find((thing) => thing.asset_id === IDS.creature)!.already!.map((line) => line.does).join("；")).toContain("不会打人，也不会去追谁")
  const code = document("hatch_egg", "孵蛋", "小鸡被追时逃开。", [IDS.creature], `        ProjectContent.targetRule("${IDS.creature}", (mob, candidate) -> false);`)
  const found = staticChecks(project, code, null).references.find((value) => value.rule === "target_unused")!
  expect(found).toBeDefined()
  // The writer of a gameplay cannot change the creature: it is told to drop the call, or to change the description.
  expect(found.fix).toContain("要改的是说明")
  expect(found.fix).not.toMatch(/^要它打人，先把这只生物的 behavior 改成 hostile/)
  // A creature that does fight is not held to it.
  expect(staticChecks(sample("hostile"), code, null).references.some((value) => value.rule === "target_unused")).toBe(false)
})

test("the rule for a description is one sentence: only what it says itself, what the thing or another gameplay already does is not redone, rewritten or written backwards", () => {
  const rule = "这个玩法只做自己说明里的事"
  expect(GAMEPLAY_DISCIPLINE.split(rule).length - 1).toBe(1)
  expect(GAMEPLAY_SHEET_INSTRUCTIONS).toContain(rule)
  expect(GAMEPLAY_SHEET_INSTRUCTIONS).toContain("不重做、不改写，也不写成相反的")
  // The old sentence that let a description grow past the request is gone.
  for (const words of [GAMEPLAY_SHEET_INSTRUCTIONS, GAMEPLAY_DISCIPLINE]) expect(words).not.toContain("按一个好作者会做到的程度")
  expect(GAMEPLAY_WRITER_INSTRUCTIONS).toContain("也不重做、不改写")
  // The reviewer is given the same material and may refuse a repeat of it.
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain("already（")
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain("又做了一遍")
})

test("a writer who finds the description at fault asks for another: it is kept with why and what changed, and the reviewer is shown it; the package cannot change", () => {
  const sheet = gameplaySheet(BOX_GUARD)
  const begun = beginGameplay(null, { asset_id: IDS.box_guard, entry: null, request: "守着秘匣", brief: "守着秘匣", task_id: "d0000000-0000-4000-8000-0000000000f1", remark: null })
  const described = describeGameplay(begun, sheet)
  // The first description is no change.
  expect(described.amendments).toBeUndefined()
  const smaller = { ...sheet, behaviours: sheet.behaviours.slice(0, 1), not_doing: [...sheet.not_doing, "不会一直跟着玩家"] }
  const changed = describeGameplay(described, smaller, "第二条行为和这只生物自己的行为冲突")
  expect(changed.sheet).toEqual(smaller)
  expect(changed.amendments).toHaveLength(1)
  expect(changed.amendments![0]).toMatchObject({ round: 1, because: "第二条行为和这只生物自己的行为冲突" })
  expect(changed.amendments![0]!.changes).toEqual([expect.stringMatching(/^去掉了行为：.*手持「月露」右键时/), "加上了它不做的事：不会一直跟着玩家"])
  expect(GameplayRecordSchema.parse(changed).amendments).toHaveLength(1)
  expect(shownGameplay(changed).amendments).toEqual([expect.objectContaining({ because: "第二条行为和这只生物自己的行为冲突" })])
  // The same description again changes nothing to tell, though a review of the old one still goes.
  expect(describeGameplay(changed, smaller, "没改").amendments).toHaveLength(1)
  // The slug is the package the code is written in: a change the writer of the code asks for keeps it; an outside AI that saves a description again is free of it (it rewrites the files itself).
  expect(() => describeGameplay(changed, { ...smaller, slug: "other_name" }, "改个名")).toThrow(new MakingRefusal(GAMEPLAY_REFUSALS.amend_slug("box_guard")))
  expect(describeGameplay(changed, { ...smaller, slug: "other_name" }).sheet!.slug).toBe("other_name")
  // Saved again after code was checked, with no reason given: still told to whoever reviews, as a change without one.
  const checked = checkedGameplay(described, BOX_GUARD, { bounds: [], references: [], compile: { ok: true, findings: [], compiler: "x", note: null } })
  const again = describeGameplay(checked, smaller)
  expect(again.amendments).toEqual([expect.objectContaining({ round: 2, because: "" })])
})

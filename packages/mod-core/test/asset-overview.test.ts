import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { assetUsage, buildProjectOverview, OVERVIEW_STATUS_LABELS, type OverviewInput } from "../src/asset-overview"
import { confirmBlueprint, linkBlueprintEntry, replaceBlueprint, type BlueprintDraft } from "../src/blueprint"
import { ProjectSchema } from "../src/project"
import { ReviewSchema } from "../src/reviews"
import { VerificationRecordSchema } from "../src/verification"
import { ASSET_KINDS } from "../src/workspace-modules"
import { CLAIMED_DETAIL, RunTaskSchema } from "../src/workspace-runs"
import { BOX_GUARD, IDS } from "./fixtures/gameplay/sample"
import { SKY_EXAMPLE, gestureAsset } from "./gesture-sample"

const legacy = async () => ProjectSchema.parse(JSON.parse(await readFile(path.join(import.meta.dir, "fixtures", "pre-0a", "project.json"), "utf8")))
const id = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const [MODEL, TEXTURE, ANIMATION, BLOCK, ITEM, RECIPE, ENTITY, LOGIC, WORLD] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(id) as [string, string, string, string, string, string, string, string, string]
const BUILD = id("d")
const time = (minute: number) => `2026-10-01T00:${String(minute).padStart(2, "0")}:00.000Z`
const overview = (project: OverviewInput["project"], extra: Partial<OverviewInput> = {}) =>
  buildProjectOverview({ project, runs: [], build: null, verification: null, production: null, producing: false, ...extra })
const item = (view: ReturnType<typeof overview>, key: string) => view.items.find((value) => value.id === key)!
const entry = (key: string, kind: string, extra: Record<string, unknown> = {}) => ({ key, kind, title: `${key} 标题`, brief: `${key} 说明`, owner: null, needs: [], out_of_scope: null, ...extra }) as BlueprintDraft["entries"][number]
const task = (key: string, module: string, state: string, extra: Record<string, unknown> = {}) =>
  RunTaskSchema.parse({ key, module, title: `${key} 标题`, prompt: key, source: `blueprint:${key}`, dependencies: [], target_id: null, id: crypto.randomUUID(), asset_id: crypto.randomUUID(), state, detail: "细节", error: null, started_at: null, finished_at: null, ...extra })
const run = (state: string, minute: number, tasks: ReturnType<typeof task>[]) => ({ state, created_at: time(minute), tasks }) as OverviewInput["runs"][number]

test("a project with no blueprint shows every saved asset, who it belongs to and what uses what", async () => {
  const view = overview(await legacy())
  expect(view.blueprint).toBeNull()
  expect(view.items).toHaveLength(12)
  expect(view.items.every((value) => value.key === null && value.id === value.asset_id && value.status === "saved" && value.status_label === "做好了")).toBe(true)
  expect(view.production).toEqual({ running: false, total: 12, saved: 12, built: 0, verified: 0, making: 0, queued: 0, queued_again: 0, remaking: 0, unsatisfied: 0, interrupted: 0, done: 12, accepted: 0, to_review: 0, to_redo: 0, failed: 0, blocked: 0, current: [], note: null })
  // A model belongs to the creature that uses it; a texture and a behaviour rule follow their model there.
  expect(item(view, MODEL)).toMatchObject({ kind: "model", owner: ENTITY, needs: [], revision: 1 })
  expect(item(view, MODEL).used_by.sort()).toEqual([TEXTURE, ANIMATION, ENTITY, LOGIC].sort())
  expect(item(view, TEXTURE).owner).toBe(ENTITY)
  expect(item(view, ANIMATION).owner).toBe(ENTITY)
  expect(item(view, LOGIC)).toMatchObject({ owner: ENTITY, needs: [MODEL] })
  // A recipe belongs to what it makes, not to what goes into it; a vanilla ingredient is nobody's.
  expect(item(view, RECIPE)).toMatchObject({ owner: BLOCK, needs: [ITEM, BLOCK] })
  expect(item(view, ENTITY)).toMatchObject({ owner: null, used_by: [] })
  expect(item(view, ENTITY).needs.sort()).toEqual([MODEL, TEXTURE, BLOCK].sort())
  expect(item(view, WORLD)).toMatchObject({ owner: null, needs: [], used_by: [] })
  expect(view.problems).toEqual([])
  expect(view.kinds).toEqual(ASSET_KINDS.map((kind) => ({ id: kind.id, label: kind.label, group: kind.group, glyph: kind.glyph, owner: kind.owner, capability: kind.capability })))
})

test("facts are separate: built needs this revision in the latest build, and checks stay null until recorded", async () => {
  const project = await legacy()
  const built = overview(project, { build: { id: BUILD, revision: 14, assets: [{ id: BLOCK, revision: 1 }, { id: ITEM, revision: 7 }] } })
  expect(item(built, BLOCK)).toMatchObject({ status: "built", status_label: "已做进模组", review_asked: false, facts: { saved: true, built: true, gametest: null, client: null, accepted: null } })
  // The item was edited after that build.
  expect(item(built, ITEM)).toMatchObject({ status: "saved", facts: { saved: true, built: false, gametest: null, client: null } })
  expect(built.production).toMatchObject({ saved: 12, built: 1, verified: 0 })
  const verification = VerificationRecordSchema.parse({ schema_version: 1, build_id: BUILD, updated_at: time(0), cases: [{ id: "box.opens", asset_ids: [BLOCK], kind: "gametest", passed: true, detail: "" }] })
  const checked = overview(project, { build: { id: BUILD, revision: 14, assets: [{ id: BLOCK, revision: 1 }] }, verification })
  expect(item(checked, BLOCK)).toMatchObject({ status: "verified", facts: { built: true, gametest: true, client: null } })
  expect(checked.production.verified).toBe(1)
})

test("problems: a model nothing uses, and a reference to something that is gone", async () => {
  const project = await legacy()
  const without = (...ids: string[]) => ({ ...project, workspace: { assets: project.workspace.assets.filter((asset) => !ids.includes(asset.id)).map((asset) => ({ ...asset, dependencies: asset.dependencies.filter((value) => !ids.includes(value)) })) } })
  // Content is never "unused", nor is a kind nothing can point at, nor a draft that is not built anyway.
  expect(overview({ ...without(TEXTURE, ANIMATION, ENTITY, LOGIC), entities: [], logic: [] }).problems).toEqual([{ item: MODEL, kind: "unused", message: "「苔皮苦力怕」还没有被任何内容用到。" }])
  // With its rules gone the creature is still in the project, still using the model and still asking for its texture.
  const creature = overview(without(TEXTURE, ANIMATION, ENTITY, LOGIC))
  expect(item(creature, MODEL)).toMatchObject({ owner: `entity:${MODEL}`, used_by: [`entity:${MODEL}`, `logic:${LOGIC}`] })
  expect(creature.problems).toEqual([{ item: `entity:${MODEL}`, kind: "missing_reference", message: `「苔皮苦力怕」要用的贴图（${TEXTURE}）找不到了。` }])
  const broken = overview({ ...without(ITEM), items: [] })
  expect(broken.problems).toEqual([{ item: RECIPE, kind: "missing_reference", message: "「秘匣配方」要用的方块或物品（legacy_sample:moon_dew）找不到了。" }])
  expect(item(broken, RECIPE).needs).toEqual([BLOCK])
})

test("an end point is never unused: gameplay code and a cast action reach the game with nothing pointing at them", async () => {
  const project = await legacy()
  const gameplay = { ...gestureAsset(BOX_GUARD, IDS.box_guard), module: "gameplay" as const, dependencies: BOX_GUARD.uses }
  const view = overview(ProjectSchema.parse({ ...project, workspace: { assets: [...project.workspace.assets, gameplay, gestureAsset(SKY_EXAMPLE, id("e"))] } }))
  expect(item(view, IDS.box_guard)).toMatchObject({ kind: "gameplay", status: "saved", used_by: [] })
  expect(item(view, IDS.box_guard).needs.sort()).toEqual([...BOX_GUARD.uses].sort())
  expect(item(view, id("e"))).toMatchObject({ kind: "gesture", used_by: [] })
  expect(view.problems).toEqual([])
  // The rule is a property of the kind, so a model nothing uses is still pointed out.
  expect(ASSET_KINDS.filter((kind) => kind.root).map((kind) => kind.id)).toEqual(["gesture", "gameplay", "ability", "book"])
})

test("content saved before assets existed is listed too, built only while the project is what was built", async () => {
  const saved = await legacy()
  const project = { ...saved, workspace: { assets: [] }, entities: saved.entities.map((entity) => ({ ...entity, runtime: { ...entity.runtime!, texture_asset_id: null, death_drop: null } })) }
  const view = overview(project, { build: { id: BUILD, revision: 14, assets: [] } })
  expect(view.items.map((value) => [value.id, value.kind, value.title, value.asset_id])).toEqual([
    [`entity:${MODEL}`, "entity", "苔皮苦力怕", null],
    [`block:${BLOCK}`, "block", "秘匣", null],
    [`item:${ITEM}`, "item", "月露", null],
    [`recipe:${RECIPE}`, "recipe", "秘匣配方", null],
    [`logic:${LOGIC}`, "logic", "逻辑", null],
  ])
  expect(view.items.every((value) => value.status === "built" && value.facts.gametest === null && value.revision === null)).toBe(true)
  expect(item(view, `recipe:${RECIPE}`)).toMatchObject({ owner: `block:${BLOCK}`, needs: [`item:${ITEM}`, `block:${BLOCK}`] })
  // A creature made by hand carries its own model, so nothing is missing.
  expect(item(view, `logic:${LOGIC}`)).toMatchObject({ owner: `entity:${MODEL}`, needs: [`entity:${MODEL}`] })
  expect(view.problems).toEqual([])
  expect(overview(project, { build: { id: BUILD, revision: 13, assets: [] } }).items.every((value) => value.status === "saved")).toBe(true)
  const bare = overview({ ...project, entities: project.entities.map((entity) => ({ ...entity, model_asset_id: null })), logic: [] })
  expect(bare.problems).toEqual([{ item: `entity:${MODEL}`, kind: "missing_reference", message: "「苔皮苦力怕」还缺一个模型。" }])
})

test("with a blueprint: entries are the items, linked assets fold into them, the rest stay listed", async () => {
  const project = await legacy()
  const planned = replaceBlueprint(project, {
    request: "做一只狐狸、一个果子，还要能骑",
    style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" },
    entries: [
      entry("fox_model", "model", { owner: "fox" }),
      entry("fox", "entity", { needs: ["fox_model"] }),
      entry("berry", "item"),
      entry("ride", "logic", { out_of_scope: "目前做不了骑乘" }),
    ],
    questions: ["狐狸会攻击玩家吗？"],
  })
  const draft = overview(planned)
  expect(draft.blueprint).toEqual({ revision: 1, state: "draft", request: "做一只狐狸、一个果子，还要能骑", style: planned.blueprint!.style, questions: ["狐狸会攻击玩家吗？"] })
  expect(draft.items.slice(0, 4).map((value) => [value.id, value.status, value.asset_id])).toEqual([["fox_model", "planned", null], ["fox", "planned", null], ["berry", "planned", null], ["ride", "out_of_scope", null]])
  expect(item(draft, "ride")).toMatchObject({ status_label: "这次不做", reason: "目前做不了骑乘", out_of_scope: "目前做不了骑乘" })
  expect(item(draft, "fox_model")).toMatchObject({ owner: "fox", used_by: ["fox"], brief: "fox_model 说明" })
  expect(item(draft, "fox")).toMatchObject({ owner: null, needs: ["fox_model"] })
  // 3 entries to make + 12 assets no entry points at; what will not be made is not counted.
  expect(draft.production).toMatchObject({ total: 15, saved: 12, failed: 0, blocked: 0, running: false })

  const linked = linkBlueprintEntry(linkBlueprintEntry(confirmBlueprint(planned, 1), "fox_model", MODEL), "berry", ITEM)
  const view = overview(linked)
  expect(view.items).toHaveLength(14)
  expect(view.items.some((value) => value.id === MODEL || value.id === ITEM)).toBe(false)
  expect(item(view, "fox_model")).toMatchObject({ key: "fox_model", asset_id: MODEL, status: "saved", revision: 1, owner: "fox" })
  // References of the saved asset are spoken in item ids: the recipe now points at the entry.
  expect(item(view, RECIPE).needs).toEqual(["berry", BLOCK])
  expect(item(view, "berry").used_by).toEqual([RECIPE])
  expect(assetUsage(view, ITEM)).toEqual({
    item: "berry",
    title: "berry 标题",
    used_by: [{ id: RECIPE, kind: "recipe", title: "秘匣配方", status: "saved" }],
    message: "「berry 标题」正在被 1 项内容使用：「秘匣配方」。删掉以后它们会缺少这一项。",
  })
  expect(assetUsage(view, WORLD)!.message).toBe("没有其他内容在用「苔原设定」，可以放心删除。")
  expect(assetUsage(view, id("e"))).toBeNull()
})

test("during production: making, failed with its reason, blocked behind it, and held-up work is not failure", async () => {
  const project = { ...(await legacy()), workspace: { assets: [] }, entities: [], blocks: [], items: [], recipes: [], logic: [] }
  const confirmed = confirmBlueprint(
    replaceBlueprint(project, {
      request: "做一只狐狸和一个果子",
      style: { palette: [], shape: "", naming: "", world: "" },
      entries: [entry("fox_model", "model", { owner: "fox" }), entry("fox_skin", "texture", { owner: "fox", needs: ["fox_model"] }), entry("fox", "entity", { needs: ["fox_model", "fox_skin"] }), entry("berry", "item")],
      questions: [],
    }),
    1,
  )
  expect(OVERVIEW_STATUS_LABELS.blocked).toBe("被卡住")
  const making = overview(confirmed, { runs: [run("running", 1, [task("fox_model", "model", "running"), task("fox_skin", "texture", "queued"), task("berry", "item", "saving")])] })
  expect(making.production).toMatchObject({ running: true, total: 4, saved: 0, current: ["fox_model 标题", "berry 标题"] })
  expect(making.items.map((value) => value.status)).toEqual(["making", "making", "planned", "making"])

  const once = [run("partial", 1, [task("fox_model", "model", "failed", { error: "模型需要细化" }), task("fox_skin", "texture", "blocked", { detail: "依赖任务未完成，已阻塞。" }), task("fox", "entity", "blocked"), task("berry", "item", "blocked", { detail: "进程中断，未继续执行。" })])]
  const retrying = overview(confirmed, { runs: once })
  // What the run says and what the plan says are the same thing: the task that failed is failed, the ones held up behind it are
  // blocked from that moment (not "still to do"), and only a task cut off by a restart is simply still to do.
  const waits = "要先做好「fox_model 标题」，但它没有做成。"
  expect(retrying.items.map((value) => [value.id, value.status, value.reason])).toEqual([["fox_model", "failed", "模型需要细化"], ["fox_skin", "blocked", waits], ["fox", "blocked", waits], ["berry", "planned", null]])
  expect(once[0]!.tasks.slice(0, 3).map((value) => [value.key, value.state])).toEqual(retrying.items.slice(0, 3).map((value) => [value.id, value.status]))
  expect(retrying.production).toMatchObject({ failed: 1, blocked: 2 })
  expect(retrying.problems.map((value) => [value.item, value.kind])).toEqual([["fox_skin", "blocked"], ["fox", "blocked"]])
  // Once the failed one is being tried again, nothing is held up behind a failure any more.
  const again = overview(confirmed, { runs: [...once, run("running", 2, [task("fox_model", "model", "running")])] })
  expect(again.items.map((value) => [value.id, value.status])).toEqual([["fox_model", "making"], ["fox_skin", "planned"], ["fox", "planned"], ["berry", "planned"]])

  const twice = [...once, run("failed", 2, [task("fox_model", "model", "failed", { error: "还是不行" }), task("fox_skin", "texture", "blocked"), task("fox", "entity", "blocked")])]
  const stuck = overview(confirmed, { runs: twice, production: { schema_version: 1, blueprint_revision: 1, since: time(0), note: "这一批没有任何进展", updated_at: time(3) } })
  expect(stuck.items.map((value) => [value.id, value.status, value.status_label])).toEqual([["fox_model", "failed", "没做成"], ["fox_skin", "blocked", "被卡住"], ["fox", "blocked", "被卡住"], ["berry", "planned", "还没做"]])
  expect(item(stuck, "fox_model").reason).toBe("还是不行")
  expect(item(stuck, "fox").reason).toBe("要先做好「fox_model 标题」，但它没有做成。")
  expect(stuck.production).toMatchObject({ running: false, total: 4, saved: 0, failed: 1, blocked: 2, note: "这一批没有任何进展" })
  expect(stuck.problems).toEqual([
    { item: "fox_skin", kind: "blocked", message: "「fox_skin 标题」要先做好「fox_model 标题」，但它没有做成。" },
    { item: "fox", kind: "blocked", message: "「fox 标题」要先做好「fox_model 标题」，但它没有做成。" },
  ])
  expect(overview(confirmed, { producing: true }).production.running).toBe(true)
})

test("acceptance: only what an AI made from the plan is asked about, a verdict counts for its revision alone, and a rejection asks for a redo", async () => {
  const project = await legacy()
  const linked = linkBlueprintEntry(
    confirmBlueprint(replaceBlueprint(project, { request: "做一个果子和一个匣子", style: { palette: [], shape: "", naming: "", world: "" }, entries: [entry("berry", "item"), entry("box", "block")], questions: [] }), 1),
    "berry",
    ITEM,
  )
  const review = (assetId: string, revision: number, verdict: string, note = "") => ReviewSchema.parse({ asset_id: assetId, revision, verdict, note, at: time(30) })
  // Linked to an entry, but nothing says the plan made it: it was there before, so nobody is asked.
  expect(item(overview(linked), "berry")).toMatchObject({ status: "saved", review_asked: false, facts: { accepted: null } })
  expect(overview(linked).production).toMatchObject({ accepted: 0, to_review: 0, to_redo: 0 })

  const made = [run("completed", 1, [task("berry", "item", "completed", { asset_id: ITEM, finished_at: "2099-01-01T00:00:00.000Z" })])]
  // Kept without a pass: which of the two reasons is told apart, and only until the person has judged that version.
  const kept = (outcome: string) => [run("completed", 1, [task("berry", "item", "completed", { asset_id: ITEM, finished_at: "2099-01-01T00:00:00.000Z", outcome })])]
  expect(item(overview(linked, { runs: kept("kept_unsatisfied") }), "berry")).toMatchObject({ status: "review", ai_unsatisfied: true })
  expect(item(overview(linked, { runs: kept("kept_unsatisfied") }), "berry").ai_interrupted).toBeUndefined()
  expect(item(overview(linked, { runs: kept("kept_interrupted") }), "berry")).toMatchObject({ status: "review", ai_interrupted: true })
  expect(item(overview(linked, { runs: kept("kept_interrupted") }), "berry").ai_unsatisfied).toBeUndefined()
  expect(item(overview(linked, { runs: kept("kept_interrupted"), reviews: [review(ITEM, 1, "accepted")] }), "berry").ai_interrupted).toBeUndefined()
  // broad19: a version kept although its AI was not satisfied is saved, but it is not "done": the one count every strip, stage and bar reads leaves it out
  // and counts it apart. A thing being made again is under `remaking` only, so the sets never overlap; a version the person answered counts again.
  const unsatisfied = overview(linked, { runs: kept("kept_unsatisfied") }).production
  expect(unsatisfied).toMatchObject({ saved: 12, unsatisfied: 1, interrupted: 0, remaking: 0, done: 11 })
  expect(overview(linked, { runs: kept("kept_interrupted") }).production).toMatchObject({ saved: 12, unsatisfied: 0, interrupted: 1, done: 11 })
  expect(overview(linked, { runs: kept("kept_unsatisfied"), reviews: [review(ITEM, 1, "accepted")] }).production).toMatchObject({ unsatisfied: 0, done: 12 })
  expect(overview(linked, { runs: made }).production).toMatchObject({ unsatisfied: 0, interrupted: 0, done: 12 })
  // Built or not, a kept version stays out of the done count.
  expect(overview(linked, { runs: kept("kept_unsatisfied"), build: { id: BUILD, revision: 14, assets: [{ id: ITEM, revision: 1 }] } }).production).toMatchObject({ unsatisfied: 1, done: 11, built: 1 })
  const waiting = overview(linked, { runs: made })
  expect(item(waiting, "berry")).toMatchObject({ status: "review", status_label: "等你验收", review_asked: true, reason: null, facts: { saved: true, accepted: null } })
  expect(waiting.production).toMatchObject({ saved: 12, accepted: 0, to_review: 1, to_redo: 0, failed: 0 })
  expect(item(waiting, "berry").review).toBeNull()
  // Being packed and being accepted are independent: a build does not answer the question, so it keeps waiting for the person
  // (list, count and label) while `built` still says it went into the mod.
  const built = overview(linked, { runs: made, build: { id: BUILD, revision: 14, assets: [{ id: ITEM, revision: 1 }] } })
  expect(item(built, "berry")).toMatchObject({ status: "review", status_label: "等你验收", review_asked: true, facts: { built: true, accepted: null } })
  expect(built.production).toMatchObject({ built: 1, to_review: 1, accepted: 0 })
  // The game's checks still count as recorded while the label says it waits for the person; and a failed check never counts.
  const checkedCase = (passed: boolean) => VerificationRecordSchema.parse({ schema_version: 1, build_id: BUILD, updated_at: time(0), cases: [{ id: "berry.holds", asset_ids: [ITEM], kind: "gametest", passed, detail: "" }] })
  const packed = { id: BUILD, revision: 14, assets: [{ id: ITEM, revision: 1 }] }
  expect(overview(linked, { runs: made, build: packed, verification: checkedCase(true) }).production).toMatchObject({ verified: 1, to_review: 1 })
  expect(overview(linked, { runs: made, build: packed, verification: checkedCase(false) }).production).toMatchObject({ verified: 0, to_review: 1 })

  const accepted = overview(linked, { runs: made, reviews: [review(ITEM, 1, "accepted")], build: { id: BUILD, revision: 14, assets: [{ id: ITEM, revision: 1 }] } })
  expect(item(accepted, "berry")).toMatchObject({ status: "built", status_label: "已做进模组", facts: { accepted: true }, review: { verdict: "accepted", note: "", at: time(30) } })
  expect(accepted.production).toMatchObject({ accepted: 1, to_review: 0 })
  // The verdict was for another revision than the one that exists, so it is asked about again.
  expect(item(overview(linked, { runs: made, reviews: [review(ITEM, 2, "accepted")] }), "berry")).toMatchObject({ status: "review", facts: { accepted: null } })

  const rejected = overview(linked, { runs: made, reviews: [review(ITEM, 1, "rejected", "太亮了，想要暗一点的蓝色")] })
  expect(item(rejected, "berry")).toMatchObject({ status: "redo", status_label: "要重做", reason: "太亮了，想要暗一点的蓝色", facts: { saved: true, accepted: false }, review: { verdict: "rejected", note: "太亮了，想要暗一点的蓝色" } })
  // Sent back outranks built: the person's "not right" is what the tile says until it is remade.
  expect(item(overview(linked, { runs: made, reviews: [review(ITEM, 1, "rejected", "太亮了")], build: { id: BUILD, revision: 14, assets: [{ id: ITEM, revision: 1 }] } }), "berry")).toMatchObject({ status: "redo", facts: { built: true } })
  expect(rejected.production).toMatchObject({ saved: 12, to_review: 0, to_redo: 1, failed: 0 })
  expect(item(overview(linked, { runs: made, reviews: [review(ITEM, 1, "rejected")] }), "berry").reason).toBe("你觉得它不太对，想让它重做。")
  // While it is being remade it says so; a redo that failed keeps the person's words and adds what went wrong.
  const redo = (state: string, runState: string, extra = {}) => [...made, run(runState, 40, [task("berry", "item", state, { asset_id: ITEM, target_id: ITEM, ...extra })])]
  expect(item(overview(linked, { runs: redo("running", "running"), reviews: [review(ITEM, 1, "rejected", "太亮了")] }), "berry").status).toBe("making")
  // A saved thing that is being remade is still saved, but it is not done: the counts say how many are being remade.
  expect(overview(linked, { runs: redo("running", "running"), reviews: [review(ITEM, 1, "rejected", "太亮了")] }).production).toMatchObject({ saved: 12, making: 1, remaking: 1 })
  expect(overview(linked, { runs: made, reviews: [review(ITEM, 1, "rejected", "太亮了")] }).production.remaking).toBe(0)
  // A kept version that is being made again is counted as remaking and not twice as unsatisfied; the sets stay disjoint and add up to what is saved.
  const again = overview(linked, { runs: [...kept("kept_unsatisfied"), run("running", 40, [task("berry", "item", "running", { asset_id: ITEM, target_id: ITEM })])] }).production
  expect(again).toMatchObject({ saved: 12, remaking: 1, unsatisfied: 0, done: 11 })
  expect(again.done + again.remaking + again.unsatisfied + again.interrupted).toBe(again.saved)
  expect(item(overview(linked, { runs: redo("failed", "failed", { error: "AI 没有回应", finished_at: time(41) }), reviews: [review(ITEM, 1, "rejected", "太亮了")] }), "berry")).toMatchObject({
    status: "redo",
    reason: "太亮了\n上次重做没有做成：AI 没有回应",
  })

  // Something no plan made: the person may still judge it, but nobody asks them to.
  const loose = overview(project, { reviews: [review(BLOCK, 1, "accepted")] })
  expect(item(loose, BLOCK)).toMatchObject({ status: "saved", review_asked: false, facts: { accepted: true } })
  expect(item(loose, RECIPE)).toMatchObject({ status: "saved", review_asked: false, facts: { accepted: null } })
  // Remade outside the plan after they said it was not right: the new version is asked about.
  const remade = { ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === BLOCK ? { ...asset, revision: 2 } : asset)) } }
  const redone = [run("completed", 50, [task("redo", "block", "completed", { asset_id: BLOCK, target_id: BLOCK, source: "盖子要能打开", finished_at: "2099-01-01T00:00:00.000Z" })])]
  expect(item(overview(remade, { runs: redone, reviews: [review(BLOCK, 1, "rejected", "盖子要能打开")] }), BLOCK)).toMatchObject({ status: "review", review_asked: true, facts: { accepted: null } })
  // A change an AI made to a thing that was already saved is asked about whether or not a verdict was recorded first (broad23: an outside AI revised a saved thing from
  // the person's own words; the activity line said it waited for them while the card said nothing did). Since 11-09 so is something new made from a sentence.
  expect(item(overview(remade, { runs: redone }), BLOCK)).toMatchObject({ status: "review", review_asked: true })
  const sentence = [run("completed", 50, [task("sentence", "block", "completed", { asset_id: BLOCK, target_id: null, source: "做一个秘匣", finished_at: "2099-01-01T00:00:00.000Z" })])]
  expect(item(overview(remade, { runs: sentence }), BLOCK)).toMatchObject({ status: "review", review_asked: true })
  // A version the person brought back is theirs to answer, like one an AI made.
  expect(item(overview(remade, { restored: [BLOCK] }), BLOCK)).toMatchObject({ status: "review", review_asked: true })
  expect(item(overview(remade, { restored: [BLOCK], reviews: [review(BLOCK, 2, "accepted")] }), BLOCK)).toMatchObject({ status: "saved", facts: { accepted: true } })
  // A hand edit after the AI finished makes the version on disk the person's own: nothing to accept.
  const edited = { ...linked, workspace: { assets: linked.workspace.assets.map((asset) => (asset.id === ITEM ? { ...asset, revision: 2, updated_at: "2099-01-02T00:00:00.000Z" } : asset)) } }
  expect(item(overview(edited, { runs: made }), "berry")).toMatchObject({ status: "saved", review_asked: false })
})

test("what an AI made and nobody answered waits for the person, old runs too; hand-made things never wait", async () => {
  const project = await legacy()
  // Old run records of an AI that made these very assets, finished after they were saved: since 11-09 every version an AI made is asked about.
  const made = project.workspace.assets.slice(0, 12)
  const old = [run("completed", 1, made.map((asset) => task("old", asset.module, "completed", { key: `k${asset.id.slice(0, 6)}`, source: "做一个东西", asset_id: asset.id, finished_at: "2099-01-01T00:00:00.000Z" })))]
  const view = overview(project, { runs: old, reviews: [], requests: [] })
  const ai = new Set(made.map((asset) => asset.id))
  expect(view.items.filter((value) => value.asset_id && ai.has(value.asset_id)).every((value) => value.status === "review" && value.review_asked)).toBe(true)
  expect(view.items.filter((value) => !value.asset_id || !ai.has(value.asset_id)).every((value) => value.status === "saved" && !value.review_asked && value.facts.accepted === null && value.review === null)).toBe(true)
  // Without old runs, nothing an AI made is on record: a project from before acceptance shows nothing waiting.
  const bare = overview(project, { runs: [], reviews: [], requests: [] })
  expect(bare.items.every((value) => value.status === "saved" && !value.review_asked && value.facts.accepted === null && value.review === null)).toBe(true)
  expect(bare.production).toMatchObject({ accepted: 0, to_review: 0, to_redo: 0 })
  expect(bare.problems).toEqual([])
})

test("the counts say how many of those wait for the person", async () => {
  const project = await legacy()
  const old = [run("completed", 1, project.workspace.assets.slice(0, 12).map((asset) => task("old", asset.module, "completed", { key: `k${asset.id.slice(0, 6)}`, source: "做一个东西", asset_id: asset.id, finished_at: "2099-01-01T00:00:00.000Z" })))]
  const view = overview(project, { runs: old, reviews: [], requests: [] })
  expect(view.production).toMatchObject({ accepted: 0, to_review: 12, to_redo: 0 })
  expect(view.problems).toEqual([])
})

test("preview pointers say where each item's documents are, without carrying them", async () => {
  const project = await legacy()
  const view = overview(project)
  // The compiled shape is kept in a file under the creature that shares the model's id.
  expect(item(view, MODEL).preview).toEqual({ source: "asset", model_asset_id: MODEL, texture_asset_id: TEXTURE, entity_id: MODEL })
  expect(item(view, TEXTURE).preview).toEqual({ source: "asset", model_asset_id: MODEL, texture_asset_id: TEXTURE, entity_id: MODEL })
  expect(item(view, ANIMATION).preview).toEqual({ source: "asset", model_asset_id: MODEL, texture_asset_id: TEXTURE, entity_id: MODEL })
  expect(item(view, ENTITY).preview).toEqual({ source: "asset", model_asset_id: MODEL, texture_asset_id: TEXTURE, entity_id: MODEL })
  expect(item(view, LOGIC).preview).toEqual({ source: "asset", model_asset_id: MODEL, texture_asset_id: TEXTURE, entity_id: MODEL })
  expect(item(view, BLOCK).preview).toEqual({ source: "asset", model_asset_id: null, texture_asset_id: null, entity_id: null })
  // No file yet: only the model's own document can be drawn.
  const unfiled = overview({ ...project, entities: project.entities.map((entity) => ({ ...entity, model_asset_id: null })) })
  expect(item(unfiled, MODEL).preview).toEqual({ source: "asset", model_asset_id: MODEL, texture_asset_id: TEXTURE, entity_id: null })
  // Content from before assets existed: the document is in the project's own lists, and a creature's model only in its file.
  const bare = { ...project, workspace: { assets: [] }, entities: project.entities.map((entity) => ({ ...entity, model_asset_id: id("e") })) }
  const plain = overview(bare)
  expect(plain.items.find((value) => value.kind === "entity")!.preview).toEqual({ source: "content", model_asset_id: null, texture_asset_id: null, entity_id: project.entities[0]!.id })
  expect(plain.items.find((value) => value.kind === "block")!.preview).toEqual({ source: "content", model_asset_id: null, texture_asset_id: null, entity_id: null })
  // Planned and not made yet: nothing to draw.
  const planned = overview(confirmBlueprint(replaceBlueprint(bare, { request: "做", style: { palette: [], shape: "", naming: "", world: "" }, entries: [entry("gem", "item")], questions: [] }), 1))
  expect(item(planned, "gem").preview).toEqual({ source: null, model_asset_id: null, texture_asset_id: null, entity_id: null })
})

test("stale: what uses a remade thing is told so, until it is remade itself or the person says it still fits", async () => {
  const project = await legacy()
  const at = (asset: string, minute: number, revision = 1) => (value: (typeof project.workspace.assets)[number]) => (value.id === asset ? { ...value, revision, updated_at: time(minute) } : value)
  const settle = (...changes: ReturnType<typeof at>[]) => ({ ...project, workspace: { assets: project.workspace.assets.map((value) => changes.reduce((asset, change) => change(asset), { ...value, updated_at: time(0) })) } })
  const review = (assetId: string, revision: number, verdict: string, minute: number, sentBack?: number) =>
    ReviewSchema.parse({ asset_id: assetId, revision, verdict, note: "", at: time(minute), ...(sentBack ? { sent_back: sentBack } : {}) })
  const stale = (view: ReturnType<typeof overview>) => view.problems.filter((value) => value.kind === "stale")
  // Sent back but not remade yet: nothing changed, so nothing is stale. A hand edit of something never sent back is not a remake either.
  expect(stale(overview(settle(), { reviews: [review(MODEL, 1, "rejected", 5, 1)] }))).toEqual([])
  expect(stale(overview(settle(at(MODEL, 10, 2))))).toEqual([])
  const remade = settle(at(MODEL, 10, 2))
  const told = stale(overview(remade, { reviews: [review(MODEL, 1, "rejected", 5, 1)] }))
  expect(told.map((value) => value.item).sort()).toEqual([TEXTURE, ANIMATION, ENTITY, LOGIC].sort())
  expect(told.find((value) => value.item === TEXTURE)!.message).toBe(`「${item(overview(remade), TEXTURE).title}」用到的「${item(overview(remade), MODEL).title}」重做过，最好看看还合不合适。`)
  // Accepting the remade model does not settle the texture: the record still knows it was sent back.
  const happy = [review(MODEL, 2, "accepted", 11, 1)]
  expect(stale(overview(remade, { reviews: happy })).map((value) => value.item)).toContain(TEXTURE)
  // The texture is remade after the model, or the person says it still fits: its notice goes, the others stay.
  expect(stale(overview(settle(at(MODEL, 10, 2), at(TEXTURE, 12, 2)), { reviews: happy })).map((value) => value.item).sort()).toEqual([ANIMATION, ENTITY, LOGIC].sort())
  expect(stale(overview(remade, { reviews: [...happy, review(TEXTURE, 1, "accepted", 12)] })).map((value) => value.item).sort()).toEqual([ANIMATION, ENTITY, LOGIC].sort())
  // A yes given before the remake says nothing about the new shape.
  expect(stale(overview(remade, { reviews: [...happy, review(TEXTURE, 1, "accepted", 9)] })).map((value) => value.item)).toContain(TEXTURE)
})

test("a failed entry the person asks to try once more says so until a later run takes it up", async () => {
  const project = await legacy()
  const confirmed = confirmBlueprint(replaceBlueprint(project, { request: "做一个果子", style: { palette: [], shape: "", naming: "", world: "" }, entries: [entry("berry", "item")], questions: [] }), 1)
  const failed = [run("failed", 1, [task("berry", "item", "failed", { error: "AI 没有回应" })]), run("failed", 2, [task("berry", "item", "failed", { error: "还是不行" })])]
  expect(item(overview(confirmed, { runs: failed }), "berry")).toMatchObject({ status: "failed", status_label: "没做成", reason: "还是不行" })
  const asked = overview(confirmed, { runs: failed, requests: [{ key: "berry", feedback: "做成红色的", at: time(5) }] })
  expect(item(asked, "berry")).toMatchObject({ status: "redo", reason: "做成红色的\n上次没有做成：还是不行", facts: { saved: false, accepted: null }, review: null })
  expect(asked.production).toMatchObject({ to_redo: 1, failed: 0 })
  const again = [...failed, run("failed", 6, [task("berry", "item", "failed", { error: "第三次也不行" })])]
  expect(item(overview(confirmed, { runs: again, requests: [{ key: "berry", feedback: "做成红色的", at: time(5) }] }), "berry")).toMatchObject({ status: "failed", reason: "第三次也不行" })
})

// Round 10 (J1)
test("what a creature drops is a reference like any other: the thing dropped is needed by it, and one that is gone is said", async () => {
  const project = await legacy()
  const dropped = project.items[0]!.identifier
  const dropping = (item: string) => ({ ...project, workspace: { assets: project.workspace.assets.map((asset) => (asset.id === ENTITY && asset.document.kind === "entity" ? { ...asset, document: { ...asset.document, loot: [{ item, min: 1, max: 2, chance: 1, player_only: false }, { item: "minecraft:diamond", min: 1, max: 1, chance: 0.1, player_only: true }] } } : asset)) } })
  const view = overview(dropping(dropped))
  expect(item(view, ENTITY).needs.sort()).toEqual([MODEL, TEXTURE, BLOCK, ITEM].sort())
  expect(item(view, ITEM).used_by).toContain(ENTITY)
  // A vanilla drop is nobody's; a drop that names nothing of this project is a missing reference.
  expect(view.problems).toEqual([])
  expect(overview(dropping("no_such_thing")).problems).toEqual([{ item: ENTITY, kind: "missing_reference", message: expect.stringContaining("no_such_thing") }])
})

test("a task that is only queued is waiting, not being made: the label, the counts and what it waits for say so", async () => {
  const project = { ...(await legacy()), workspace: { assets: [] }, entities: [], blocks: [], items: [], recipes: [], logic: [] }
  const confirmed = confirmBlueprint(
    replaceBlueprint(project, {
      request: "做一只狐狸和一个果子",
      style: { palette: [], shape: "", naming: "", world: "" },
      entries: [entry("fox_model", "model", { owner: "fox" }), entry("fox_skin", "texture", { owner: "fox", needs: ["fox_model"] }), entry("fox", "entity", { needs: ["fox_model", "fox_skin"] }), entry("berry", "item")],
      questions: [],
    }),
    1,
  )
  const view = overview(confirmed, { runs: [run("running", 1, [task("fox_model", "model", "running"), task("fox_skin", "texture", "queued"), task("fox", "entity", "queued"), task("berry", "item", "saving")])] })
  // The one that has started is "正在做"; the two that wait on it are "在排队" and say for what.
  expect(view.items.map((value) => [value.id, value.status_label])).toEqual([["fox_model", "正在做"], ["fox_skin", "在排队"], ["fox", "在排队"], ["berry", "正在做"]])
  expect(item(view, "fox_model").queued).toBeUndefined()
  expect(item(view, "fox_skin").queued).toEqual({ waiting_for: ["fox_model 标题"] })
  expect(item(view, "fox").queued).toEqual({ waiting_for: ["fox_model 标题", "fox_skin 标题"] })
  // The count of what is in the run stays, with the part nothing has started on counted apart; what is being made is the difference.
  expect(view.production).toMatchObject({ making: 4, queued: 2, queued_again: 0 })
  expect(view.production.current).toEqual(["fox_model 标题", "berry 标题"])
  // A task that has started, is being checked or is saving is being made.
  for (const state of ["running", "validating", "saving"]) {
    const started = overview(confirmed, { runs: [run("running", 1, [task("fox_skin", "texture", state)])] })
    expect(item(started, "fox_skin")).toMatchObject({ status: "making", status_label: "正在做" })
    expect(item(started, "fox_skin").queued).toBeUndefined()
  }
  // A run that is no longer live makes nothing and queues nothing.
  expect(item(overview(confirmed, { runs: [run("failed", 1, [task("fox_skin", "texture", "queued")])] }), "fox_skin").queued).toBeUndefined()
})

test("broad23: an outside AI that took a task and has handed in nothing is queued, not 'being made'; the first thing it hands in makes it being made", async () => {
  const project = await legacy()
  const taken = (detail: string) => [run("running", 40, [task("redo", "block", "running", { asset_id: BLOCK, target_id: BLOCK, source: "调一调", detail })])]
  expect(item(overview(project, { runs: taken(CLAIMED_DETAIL) }), BLOCK)).toMatchObject({ status: "making", status_label: "在排队", queued: { waiting_for: [] } })
  const working = overview(project, { runs: taken("外部模型进度 30%。") })
  expect(item(working, BLOCK)).toMatchObject({ status: "making", status_label: "正在做" })
  expect(item(working, BLOCK).queued).toBeUndefined()
  // Counted the way the screen says it: the idle one under the queue, the working one under what is made.
  expect(overview(project, { runs: taken(CLAIMED_DETAIL) }).production).toMatchObject({ making: 1, queued: 1 })
  expect(working.production).toMatchObject({ making: 1, queued: 0 })
})

test("broad23: a model carries the detail its last task was made by, so a Boss's model under a 中 button shows 高", async () => {
  const project = await legacy()
  const boss = replaceBlueprint(project, {
    request: "一只 Boss",
    style: { palette: [], shape: "", naming: "", world: "" },
    entries: [entry("king", "entity", { needs: ["king_model"], tier: { level: "boss", reason: "最终 Boss", by: "ai" } }), entry("king_model", "model", { owner: "king" }), entry("stick", "model")],
    questions: [],
  })
  const confirmed = confirmBlueprint(boss, 1)
  const made = (key: string, complexity: "low" | "medium" | "high" | null) => [{ ...run("completed", 40, [task(key, "model", "completed", { asset_id: crypto.randomUUID() })]), model_complexity: complexity }]
  const withRun = (key: string, complexity: "low" | "medium" | "high" | null) => item(overview(confirmed, { runs: made(key, complexity) }), key)
  expect(withRun("king_model", "medium").detail).toEqual({ level: "high", label: "高" })
  // Not raised: it is the button's own level, which the page does not repeat.
  expect(withRun("stick", "medium").detail).toEqual({ level: "medium", label: "中" })
  // The level is that of the run, not of the button now; no button recorded, nothing said; and only models say it.
  expect(withRun("king_model", "low").detail).toEqual({ level: "high", label: "高" })
  expect(withRun("stick", null).detail).toBeUndefined()
  expect(withRun("king", "high").detail).toBeUndefined()
})

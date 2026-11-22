import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openProject } from "@minemods/mod-core/project"
import { readActivity } from "@minemods/mod-core/activity"
import { REVIEW_NOTE_LIMIT } from "@minemods/mod-core/reviews"
import { SCENE_WORDS, type SceneReport } from "@minemods/mod-core/scene"
import { scenePaths } from "@minemods/mod-core/scene-run"
import type { BlueprintDraft, BlueprintPlan } from "@minemods/mod-core/blueprint"
import { FIX_WORDS, findingsFeedback, fixItem, groupFindings } from "../src/fix-findings"
import { createStudioService, dispatchStudioRequest } from "../src/main/service"
import { NOTHING_LEFT } from "../src/main/blueprint-service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { buildAndCheckStep } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { StudioRequestSchema } from "../src/main/protocol"
import type { ExternalStartResult } from "../src/external"
import { PAPER, played } from "./playable-fixture"

type Service = Awaited<ReturnType<typeof createStudioService>>
const directories: string[] = []
const services: Service[] = []
const closers: (() => void)[] = []
afterEach(async () => {
  closers.splice(0).forEach((close) => close())
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function studio(ai: Record<string, unknown>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-fix-"))
  directories.push(directory)
  const runtime = path.join(directory, "runtime")
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: runtime, templateDirectory: path.join(directory, "templates"), ai })
  services.push(service)
  return { service, runtime }
}

// A stand-in for the AI service: every module task is answered with an item of the task's own key.
function responder() {
  const prompts: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { input: { content: { text: string }[] }[] }
      const input = JSON.parse(body.input[0]!.content[0]!.text) as { task: { key: string; title: string }; prompt: string }
      prompts.push(input.prompt)
      return Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ kind: "item", identifier: input.task.key, name: input.task.title, max_stack: 16, color: "#99ccff", texture: null }) }] }] })
    },
  })
  closers.push(() => server.stop(true))
  return { prompts, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1`, retryWait: [0, 0] } }
}

const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }
const entry = (key: string, kind: string) => ({ key, kind, title: `${key} 标题`, brief: `做一个 ${key}`, owner: null, needs: [], out_of_scope: null }) as BlueprintPlan["entries"][number]
const plan = (entries: BlueprintPlan["entries"]): BlueprintPlan => played({ style, entries, questions: [] })

const LIMITS = SCENE_WORDS.limits
/** What a check of the scene would have written for a mod whose `gem` the game refused, with one line of its log and one thing nobody knows. */
const report = (): SceneReport => ({
  started: true,
  mods: ["pipeline 0.1.0"],
  things: [
    { kind: "item", id: "pipeline:gem", title: "gem 标题", placed: false, said: ["Unknown item 'pipeline:gem'"] },
    { kind: "item", id: "pipeline:ruby", title: "ruby 标题", placed: true, said: [] },
    { kind: "block", id: "pipeline:ghost", title: "幽灵方块", placed: false, said: [] },
  ],
  errors: ["[12:00:00] [Server thread/ERROR]: pipeline failed to load a recipe"],
  saved: true,
  tail: [],
  findings: ["「gem 标题」拿不出来（pipeline:gem）：Unknown item 'pipeline:gem'", "「幽灵方块」摆不出来（pipeline:ghost）：游戏没有回答", "游戏日志里有 1 行提到这个模组的报错，第一行：pipeline failed to load a recipe"],
  limits: LIMITS,
})
async function checked(runtime: string, projectId: string, revision: number) {
  const file = scenePaths(runtime, projectId).record
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ schema_version: 1, project_id: projectId, build_id: crypto.randomUUID(), revision, jar_sha256: "0".repeat(64), mods: [], missing: [], deployed_at: new Date().toISOString(), checked_at: new Date().toISOString(), report: report() }))
}

test("检查发现的问题按「说的是哪一样」分开：测试场的东西按游戏里的名字找到卡片，说整个模组的归到一处，一条都不丢", () => {
  const creature = "11111111-1111-4111-8111-111111111111"
  const items = [
    { id: "gem", asset_id: "a-gem", kind: "item", title: "宝石", preview: { entity_id: null } },
    { id: creature, asset_id: creature, kind: "model", title: "守卫外观", preview: { entity_id: creature } },
    { id: "guard", asset_id: "a-guard", kind: "entity", title: "守卫", preview: { entity_id: creature } },
    { id: "block:b-old", asset_id: null, kind: "block", title: "旧石头", preview: { entity_id: null } },
    { id: "a-play", asset_id: "a-play", kind: "gameplay", title: "守矿", preview: { entity_id: null } },
  ]
  // A creature shares its id with its model: the finding goes to the creature's own card, and to the model only when there is no other.
  expect(fixItem({ kind: "entity", id: creature, name: "守卫" }, items)?.id).toBe("guard")
  expect(fixItem({ kind: "entity", id: creature, name: "守卫" }, items.filter((item) => item.kind !== "entity"))?.id).toBe(creature)
  expect(fixItem({ kind: "block", id: "b-old", name: "旧石头" }, items)?.id).toBe("block:b-old")
  expect(fixItem({ kind: "item", id: "elsewhere", name: "宝石" }, items)?.id).toBe("gem")
  expect(fixItem({ kind: "recipe", id: "none", name: "没有的配方" }, items)).toBeNull()

  const grouped = groupFindings({
    guide: [
      { about: { kind: "gameplay", id: "a-play", name: "守矿" }, text: "玩法「守矿」现在这一版代码没有检查记录。", fix: "重新让它检查一遍，再打包。" },
      { about: { kind: "entity", id: creature, name: "守卫" }, text: "「守卫」的 attack 动作永远不会播放。", fix: "给它加一条会用到这个动作的行为。" },
      { about: null, text: "有 1 样东西还没有英文名。", fix: "给它起一个英文名。" },
      { about: { kind: "recipe", id: "none", name: "没有的配方" }, text: "配方用到了不存在的东西。", fix: "换成一样已经有的。" },
    ],
    scene: {
      things: [
        { kind: "item", id: "mod:gem", title: "宝石", placed: false, said: ["Unknown item 'mod:gem'"] },
        { kind: "creature", id: "mod:creature_x", title: "守卫", placed: true, there: false, said: [] },
        { kind: "block", id: "mod:fine", title: "好方块", placed: true, said: [] },
        { kind: "block", id: "mod:ghost", title: "幽灵方块", placed: false, said: [] },
      ],
      findings: ["「宝石」拿不出来（mod:gem）：Unknown item 'mod:gem'", "「幽灵方块」摆不出来（mod:ghost）：游戏没有回答", SCENE_WORDS.gone("守卫", 10), "游戏日志里有 2 行提到这个模组的报错，第一行：boom", SCENE_WORDS.unsaved],
    },
    contents: [
      { kind: "item", id: "c-gem", name: "宝石", registry: "mod:gem" },
      { kind: "entity", id: creature, name: "守卫", registry: "mod:creature_x" },
    ],
    items,
  })
  expect(grouped.things.map((thing) => [thing.item.id, thing.lines])).toEqual([
    ["a-play", ["玩法「守矿」现在这一版代码没有检查记录。重新让它检查一遍，再打包。"]],
    // Both checks spoke of the creature: one card, both sentences.
    ["guard", ["「守卫」的 attack 动作永远不会播放。给它加一条会用到这个动作的行为。", SCENE_WORDS.gone("守卫", 10)]],
    // What the game said is kept; the registry name is not shown to a person.
    ["gem", ["「宝石」拿不出来：Unknown item 'mod:gem'"]],
  ])
  expect(grouped.unknown).toEqual([{ title: "没有的配方", lines: ["配方用到了不存在的东西。换成一样已经有的。"] }, { title: "幽灵方块", lines: ["「幽灵方块」摆不出来：游戏没有回答"] }])
  expect(grouped.general).toEqual(["有 1 样东西还没有英文名。给它起一个英文名。", "游戏日志里有 2 行提到这个模组的报错，第一行：boom。", SCENE_WORDS.unsaved])
  expect(groupFindings({ guide: [], scene: null, contents: [], items })).toEqual({ things: [], unknown: [], general: [] })

  expect(findingsFeedback(grouped.things[2]!.lines, REVIEW_NOTE_LIMIT)).toBe("打包以后检查发现：「宝石」拿不出来：Unknown item 'mod:gem'。")
  expect(findingsFeedback(grouped.things[1]!.lines, REVIEW_NOTE_LIMIT)).toBe(`打包以后检查发现：「守卫」的 attack 动作永远不会播放。给它加一条会用到这个动作的行为。${SCENE_WORDS.gone("守卫", 10)}`)
  // A remark holds only so much: the words are cut, never refused.
  const long = findingsFeedback(Array.from({ length: 40 }, (_, index) => `第 ${index} 条发现，写得很长很长很长。`), REVIEW_NOTE_LIMIT)
  expect(long).toHaveLength(REVIEW_NOTE_LIMIT)
  expect(long.endsWith("…")).toBe(true)
})

test("broad18 w2: a crash goes to the card it points at with the game's own words, and to the person as a sentence when it points at no card", () => {
  const items = [
    { id: "a-play", asset_id: "a-play", kind: "gameplay", title: "踏板触发炮塔", preview: { entity_id: null } },
    { id: "gem", asset_id: "a-gem", kind: "item", title: "宝石", preview: { entity_id: null } },
  ]
  const crash = (about: { kind: "gameplay"; id: string; name: string } | null) => ({ about, title: about?.name ?? FIX_WORDS.whole, lines: ["游戏崩溃了，抛出的是 java.lang.IllegalArgumentException。", "最先进到这个模组代码的地方是 Main.fire。"], plain: "游戏崩溃了，测试场不是正常关掉的。" })
  // It points at a gameplay that has a card: the card is sent back with the lines written for the AI.
  const pointed = groupFindings({ guide: [], scene: null, contents: [], items, crash: crash({ kind: "gameplay", id: "a-play", name: "踏板触发炮塔" }) })
  expect(pointed.things.map((thing) => [thing.item.id, thing.lines])).toEqual([["a-play", ["游戏崩溃了，抛出的是 java.lang.IllegalArgumentException。", "最先进到这个模组代码的地方是 Main.fire。"]]])
  expect(pointed.unknown).toEqual([])
  expect(pointed.general).toEqual([])
  expect(findingsFeedback(pointed.things[0]!.lines, REVIEW_NOTE_LIMIT)).toContain("java.lang.IllegalArgumentException")
  // It points at a gameplay the overview has no card for: the person gets the sentence, not the AI's lines.
  const missing = groupFindings({ guide: [], scene: null, contents: [], items: [], crash: crash({ kind: "gameplay", id: "gone", name: "已删除的玩法" }) })
  expect(missing.things).toEqual([])
  expect(missing.unknown).toEqual([{ title: "已删除的玩法", lines: ["游戏崩溃了，测试场不是正常关掉的。"] }])
  // It points at nothing of the project: it is about the mod as a whole, said as a sentence.
  const whole = groupFindings({ guide: [], scene: null, contents: [], items, crash: crash(null) })
  expect(whole.things).toEqual([])
  expect(whole.general).toEqual(["游戏崩溃了，测试场不是正常关掉的。"])
  // No crash: what the other checks found is as before.
  expect(groupFindings({ guide: [], scene: null, contents: [], items, crash: null })).toEqual({ things: [], unknown: [], general: [] })
})

test("fixFindings（直连 AI）：有问题的那一样带着检查的原话重做，和卡片上的「不满意，要改」是同一条路；别的留给人，并说明为什么", async () => {
  const fake = responder()
  const { service, runtime } = await studio(fake.ai)
  const created = await service.createProject({ name: "闭环", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  await service.saveBlueprint({ projectId, revision: 0, blueprint: { request: "做两块宝石", ...plan([entry("gem", "item"), entry("ruby", "item")]) } as BlueprintDraft })
  await service.confirmBlueprint({ projectId, revision: 1 })
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const made = await service.getProjectOverview({ projectId })
  expect(made.production).toMatchObject({ saved: 2, to_redo: 0 })
  const revision = (await openProject(created.directory)).revision
  const asked = fake.prompts.length

  const sorted = (things: { thing: string; title: string }[]) => things.map((value) => value.thing).sort()
  const gap = "还有 2 个问题没有答案"
  // A check of an earlier revision says nothing about this one: only what the mod guide finds now is handed over.
  await checked(runtime, projectId, revision - 1)
  const stale = await service.fixFindings({ projectId })
  expect(sorted(stale.started)).toEqual(["gem", "ruby"])
  expect(stale.left.map((value) => value.title)).toEqual([FIX_WORDS.whole])
  expect(stale.left[0]!.why).toContain("还没有英文名")
  expect(stale.left[0]!.why).not.toContain("报错")
  expect(stale).toMatchObject({ nothing: false, waiting: false, tell: null })
  // Both in one batch: a second redo asked while the first is being made would only have waited.
  const both = (await service.listProjectRuns({ projectId })).find((run) => run.tasks.every((task) => task.target_id))!
  await service.externalRunner.wait(both.id)
  expect(both.tasks.map((task) => task.key).sort()).toEqual(["gem", "ruby"])
  expect(fake.prompts).toHaveLength(asked + 2)
  for (const prompt of fake.prompts.slice(asked)) {
    expect(prompt).toContain(`玩家看过现在这一版，说：\n打包以后检查发现：「`)
    expect(prompt).toContain(gap)
    expect(prompt).not.toContain("拿不出来")
  }

  await checked(runtime, projectId, (await openProject(created.directory)).revision)
  expect(StudioRequestSchema.safeParse({ method: "fixFindings", input: { projectId, extra: 1 } }).success).toBe(false)
  const fixed = (await dispatchStudioRequest(service, { method: "fixFindings", input: { projectId } })) as Awaited<ReturnType<Service["fixFindings"]>>
  expect(sorted(fixed.started)).toEqual(["gem", "ruby"])
  expect(fixed).toMatchObject({ nothing: false, waiting: false, tell: null })
  // What is about no card, and what is about the mod as a whole, is handed back in words and not dropped.
  expect(fixed.left.map((value) => value.title)).toEqual(["幽灵方块", FIX_WORDS.whole])
  expect(fixed.left[0]!.why).toBe(`${FIX_WORDS.unknown}「幽灵方块」摆不出来：游戏没有回答`)
  expect(fixed.left[1]!.why).toContain("游戏日志里有 1 行提到这个模组的报错")
  const runs = await service.listProjectRuns({ projectId })
  expect(runs).toHaveLength(3)
  const run = runs.find((value) => value.id !== both.id && value.tasks.every((task) => task.target_id))!
  await service.externalRunner.wait(run.id)
  // The thing the game refused is sent back with both checks' sentences where a person's words would be: the guide's, then what the game said.
  expect(run.tasks.find((task) => task.key === "gem")!.target_id).toBe(made.items.find((item) => item.id === "gem")!.asset_id)
  const gem = fake.prompts.slice(asked + 2).find((prompt) => prompt.includes("拿不出来"))!
  expect(gem).toContain(gap)
  expect(gem).toContain("「gem 标题」拿不出来：Unknown item 'pipeline:gem'。\n")
  expect(gem).not.toContain("（pipeline:gem）")
  const after = await service.getProjectOverview({ projectId })
  expect(after.items.map((item) => [item.id, item.status, item.revision])).toEqual([["gem", "review", 3], ["ruby", "review", 3]])
  const notes = (await readActivity(created.directory)).events.filter((event) => event.kind === "check")
  expect(notes.map((event) => event.text)).toEqual([FIX_WORDS.note(2, 1), FIX_WORDS.note(2, 2)])
  expect(notes[1]!.lines!.slice(0, 2).sort()).toEqual(["gem 标题", "ruby 标题"])
})

test("fixFindings（外部 AI）：记到要改的东西上，等它的下一批来领，并给出一句可以贴给它的话；全部做完以后 next_batch 说接下来打包和检查", async () => {
  const { service, runtime } = await studio({ mode: "mcp", review:true })
  const created = await service.createProject({ name: "外部闭环", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  await call("proposeBlueprint", { projectId, request: "做两块宝石", blueprint: plan([entry("gem", "item"), entry("ruby", "item")]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const document = (key: string) => ({ kind: "item", identifier: key, name: `${key} 标题`, max_stack: 16, color: "#99ccff", texture: null })
  const first = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = (batch: ExternalStartResult, index: number) => ({ projectId, runId: batch.run.id, taskId: batch.tasks[index]!.task.id })
  for (const index of [0, 1]) {
    await call("claimExternalTask", ids(first, index))
    await call("commitExternalTask", { ...ids(first, index), document: document(first.tasks[index]!.task.key) })
  }
  // Everything is made: the answer that starts nothing says what comes next, in the hand-off's own words.
  const done = (await call("nextBatch", { projectId })) as { run: unknown; next_step: string }
  expect(done.run).toBeNull()
  expect(done.next_step).toBe(`${NOTHING_LEFT.made}${buildAndCheckStep()}`)
  for (const phrase of ["build_project", "check_scene", "发现的问题照着改、重新构建、再查", "要用户本人先在 Studio 里同意过一次 Minecraft 的许可协议", "把那句话原样转告用户"]) expect(done.next_step).toContain(phrase)
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "electron", args: ["mcp-stdio.js"], env: {} } } }), project: { id: "p", name: "工程", revision: 1 } })
  const tick = String.fromCharCode(96)
  expect(handoff).toContain("8. " + buildAndCheckStep((name) => tick + name + tick))
  // The licence is said once in that step, not twice.
  expect(handoff.split("把那句话原样转告用户").length).toBe(2)

  await checked(runtime, projectId, (await openProject(created.directory)).revision)
  const fixed = await service.fixFindings({ projectId })
  expect(fixed.started.map((value) => value.thing).sort()).toEqual(["gem", "ruby"])
  expect(fixed.waiting).toBe(true)
  expect(fixed.tell).toBe(FIX_WORDS.tell("外部闭环", fixed.started.map((value) => value.title)))
  // No AI of Studio's own started anything: the requests wait where a card's redo waits.
  expect(await service.listProjectRuns({ projectId })).toHaveLength(1)
  const seen = (await call("getBlueprint", { projectId })) as { redo: { id: string; feedback: string }[] }
  expect(seen.redo.map((value) => value.id).sort()).toEqual(["gem", "ruby"])
  const feedback = seen.redo.find((value) => value.id === "gem")!.feedback
  expect(feedback.startsWith("打包以后检查发现：「gem 标题」还有 2 个问题没有答案")).toBe(true)
  expect(feedback.endsWith("「gem 标题」拿不出来：Unknown item 'pipeline:gem'。")).toBe(true)
  expect(seen.redo.find((value) => value.id === "ruby")!.feedback).not.toContain("拿不出来")
  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult & { next_step: string }
  expect(batch.tasks.map((value) => value.task.key).sort()).toEqual(["gem", "ruby"])
  expect(batch.tasks.find((value) => value.task.key === "gem")!.task.prompt).toContain("「gem 标题」拿不出来")
  expect(batch.next_step).toContain("要求重做")
  // With something to remake, or something that failed, the same call does not say "all made".
  expect(NOTHING_LEFT.stuck).not.toContain("build_project")
})

test("a finding that names who puts it right goes to them, not to the thing it is about", () => {
  const items = [
    { id: "hen", asset_id: "a-hen", kind: "entity", title: "彩虹鸡", preview: { entity_id: "c-hen" } },
    { id: "a-lay", asset_id: "a-lay", kind: "gameplay", title: "下彩虹蛋", preview: { entity_id: null } },
  ]
  const unplayed = { text: "「彩虹鸡」的模型里有 1 个动作在游戏里永远不会播放：lay。", fix: "写一段玩法代码来播放它。" }
  const about = { kind: "entity" as const, id: "c-hen", name: "彩虹鸡" }
  const sentence = `${unplayed.text}${unplayed.fix}`
  // A motion made and played by nothing is for the gameplay that points at the creature: its redo carries the sentence, the creature's card does not.
  const handed = groupFindings({ guide: [{ about, ...unplayed, redo: [{ kind: "gameplay", id: "a-lay", name: "下彩虹蛋" }] }], scene: null, contents: [], items })
  expect(handed.things.map((thing) => [thing.item.id, thing.lines])).toEqual([["a-lay", [sentence]]])
  // With nobody named it stays with the creature, as every finding did.
  const kept = groupFindings({ guide: [{ about, ...unplayed }], scene: null, contents: [], items })
  expect(kept.things.map((thing) => [thing.item.id, thing.lines])).toEqual([["hen", [sentence]]])
  // A named gameplay that is gone from the project leaves the sentence to the person, under its name.
  const gone = groupFindings({ guide: [{ about, ...unplayed, redo: [{ kind: "gameplay", id: "gone", name: "没了的玩法" }] }], scene: null, contents: [], items })
  expect(gone.things).toEqual([])
  expect(gone.unknown).toEqual([{ title: "没了的玩法", lines: [sentence] }])
})

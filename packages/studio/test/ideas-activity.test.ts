import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { openProject } from "@minemods/mod-core/project"
import { blueprintPlannerInstructions, ideaInstructions } from "@minemods/mod-core/blueprint-planner"
import { CONSTRAINT_CHECK_INSTRUCTIONS, CONSTRAINT_EXTRACT_INSTRUCTIONS, LOCK_REFUSALS as LOCK } from "@minemods/mod-core/blueprint-constraints"
import { PAPER_PLAY_INSTRUCTIONS, PLAY_REFUSALS } from "@minemods/mod-core/playable"
import type { IdeaProposal, Ideas } from "@minemods/mod-core/blueprint-ideas"
import type { BlueprintPlan } from "@minemods/mod-core/blueprint"
import { makingActivity, noteActivity, readActivity } from "@minemods/mod-core/activity"
import { begin, describe, fingerprint, looked, writePictures } from "@minemods/mod-core/making"
import { createStudioService, dispatchStudioRequest, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { StudioRequestSchema } from "../src/main/protocol"
import { ExternalBridgeRequestSchema, type ExternalStartResult } from "../src/external"
import { MCP_TOOLS } from "../src/main/mcp-handoff"
import { toolActivity } from "../src/main/activity-tools"
import type { Activity } from "../src/api"
import { PAPER, played } from "./playable-fixture"

type Service = Awaited<ReturnType<typeof createStudioService>>
type Asked = { instructions: string; input: Record<string, unknown> }

const directories: string[] = []
const services: Service[] = []
const closers: (() => void)[] = []

afterEach(async () => {
  closers.splice(0).forEach((close) => close())
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function studio(ai: Record<string, unknown>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-ideas-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: path.join(directory, "templates"), ai })
  services.push(service)
  return service
}

/** A stand-in for the AI service: `reply` sees what Studio asked and returns the document. */
function responder(reply: (asked: Asked) => unknown) {
  const asked: Asked[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { instructions: string; input: { content: { text: string }[] }[] }
      const call = { instructions: body.instructions, input: JSON.parse(body.input[0]!.content[0]!.text) as Record<string, unknown> }
      asked.push(call)
      return Response.json({ model: "gpt-6-astra", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(await reply(call)) }] }] })
    },
  })
  closers.push(() => server.stop(true))
  // No wait between the tries of a request that failed (`AUTHORING_RETRY`).
  return { asked, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1`, retryWait: [0, 0] } }
}

const target = "fabric-1.21.1"
const role = (asked: Asked) =>
  asked.instructions.startsWith(CONSTRAINT_EXTRACT_INSTRUCTIONS) ? "quote" : asked.instructions.startsWith(CONSTRAINT_CHECK_INSTRUCTIONS) ? "check" : asked.instructions.startsWith(PAPER_PLAY_INSTRUCTIONS) ? "paper" : asked.instructions.startsWith(ideaInstructions(target)) ? "ideas" : asked.instructions.startsWith(blueprintPlannerInstructions(target)) ? "plan" : "task"

// The case a competitor got wrong: the person says the sword is only an ordinary item, and a planner makes it a weapon.
const sentence = "做一种蓝晶矿，挖出来能做蓝晶剑，剑现在只能是普通物品，不要爆炸"
const style = { palette: ["#3355aa"], shape: "方块感", naming: "中文名", world: "矿洞" }
type Entry = BlueprintPlan["entries"][number]
const ore: Entry = { key: "ore", kind: "item", title: "蓝晶", brief: "一块蓝色的晶体，挖蓝晶矿得到。", owner: null, needs: [], out_of_scope: null }
const plainSword: Entry = { key: "sword", kind: "item", title: "蓝晶剑", brief: "一把蓝晶做的剑，只是普通物品：没有攻击力，没有耐久。", owner: null, needs: [], out_of_scope: null, honours: [{ constraint: "c1", how: "只是一个普通物品，没有攻击力和耐久。" }] }
const weapon: Entry = { ...plainSword, brief: "一把蓝晶剑：真正的武器，攻击力 6，耐久 500，右键放出冲击波。" }
const whole = [{ constraint: "c2", how: "没有任何会爆炸的东西。" }]
const plan = (sword: Entry, honours = whole): BlueprintPlan => played({ style, entries: [ore, sword], questions: [], honours })
// The reader a fake model plays: it is shown only requirements and entries, and calls a sword with attack a break of "ordinary item".
const verdicts = (input: Record<string, unknown>) => {
  const shown = input as { constraints: { id: string; text: string }[]; entries: Entry[] }
  const armed = shown.entries.find((entry) => entry.brief.includes("攻击力 6"))
  return {
    verdicts: shown.constraints.map((constraint) =>
      constraint.text.includes("普通物品") && armed ? { constraint: constraint.id, kept: false, entry: armed.key, why: "它被做成了攻击力 6、带耐久和技能的武器，不是普通物品" } : { constraint: constraint.id, kept: true, entry: null, why: "条目没有违反它。" },
    ),
  }
}
const BROKEN = "这份蓝图和你说过的要求对不上，所以没有保存。你说过「剑现在只能是普通物品」，但是「蓝晶剑」：它被做成了攻击力 6、带耐久和技能的武器，不是普通物品。想照原来的要求做，就让 AI 重新规划；想改掉这一条，只能由你自己在「你说的要求」里改它的字、或者不要它，AI 不能替你改。"

const line = (text: string, from: "you" | "ai" = "ai", about?: { thing: string; question: "source" | "use" | "reaction" | "idle" }) => ({ text, from, ...(about ? { about } : {}) })
const cards: IdeaProposal = {
  constraints: ["剑现在只能是普通物品"],
  groups: [
    {
      id: "ore_place",
      title: "蓝晶矿在哪里",
      about: "在哪一层挖得到，一脉有多少",
      options: [
        { id: "deep", title: "深层矿脉", lines: [line("挖出来能做蓝晶剑", "you", { thing: "sword", question: "source" }), line("Y -16 到 48，一脉 2 到 6 块"), line("自己发光，亮度 7")], recommended: true, kinds: ["block", "item"], limit: null },
        { id: "realm", title: "只在蓝晶维度", lines: [line("要先造一个传送门进去")], recommended: false, kinds: ["dimension"], limit: null },
      ],
    },
    {
      id: "sword_look",
      title: "蓝晶剑的样子",
      about: "它是普通物品，只定样子",
      options: [
        { id: "clear", title: "透明剑身", lines: [line("剑现在只能是普通物品", "you"), line("半透明的蓝色剑身，剑格是铁的")], recommended: true, kinds: ["item"], limit: null },
        { id: "rough", title: "原石剑", lines: [line("没打磨过的晶簇绑在木柄上")], recommended: false, kinds: ["item"], limit: null },
      ],
    },
  ],
  questions: [{ id: "weapon", constraint: 0, ask: "你说过剑只是普通物品，要不要改成真的武器？", change: "剑做成真的武器：攻击力 6，耐久 500。" }],
  // The playable standard: where the sword comes from is answered on a recommended card; what it is for is closed by the person's own words.
  things: [{ id: "sword", title: "蓝晶剑", kind: "item" }],
  declined: [{ thing: "sword", question: "use", constraint: 0, reason: "普通物品没有别的用处" }],
}

async function finished(service: Service, projectId: string, jobId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = await service.getJob({ projectId, jobId })
    if (["completed", "failed", "canceled", "interrupted"].includes(job.state)) return job
    await Bun.sleep(10)
  }
  throw new Error("job did not finish")
}
const said = (activity: Activity) => activity.events.filter((event) => !event.step && !event.quiet).map((event) => `${event.kind}/${event.mark}${event.end ? "!" : ""} ${event.title ?? "-"}: ${event.text}`)

test("直连 AI：一句话出想法卡片，人来选；剑被悄悄改成武器的蓝图过不了锁，只有人点头才放开", async () => {
  const mood = { sword: weapon }
  // The paper player finds one place where the player ends up with nothing; it is kept beside the plan and stops nothing.
  const STUCK = "蓝晶挖出来以后，除了做剑没有别的去处，剑又只是摆设：玩家忙完一无所得。"
  const fake = responder((asked) => (role(asked) === "ideas" ? cards : role(asked) === "check" ? verdicts(asked.input) : role(asked) === "paper" ? { findings: [STUCK], advice: [] } : plan(mood.sword)))
  const service = await studio(fake.ai)
  const created = await service.createProject({ name: "蓝晶", description: "", modId: "bluecrystal", empty: true })
  const projectId = created.project.id
  // A project that never had ideas has none, and asking creates no file.
  expect(await service.getIdeas({ projectId })).toBeNull()
  expect((await service.getActivity({ projectId })).events).toEqual([])

  expect((await finished(service, projectId, (await service.expandIdeas({ projectId, request: sentence })).jobId)).state).toBe("completed")
  // One request, no pictures, and the sentence in it word for word.
  expect(fake.asked.map(role)).toEqual(["ideas"])
  expect(fake.asked[0]!.input).toMatchObject({ request: sentence })
  const ideas = (await service.getIdeas({ projectId })) as Ideas
  expect(ideas).toMatchObject({ revision: 1, by: "studio", state: "choosing", request: sentence, picks: [], summary: null })
  // The requirement the AI quoted, and the one it overlooked: both locked, word for word.
  expect(ideas.constraints.map((value) => value.text)).toEqual(["剑现在只能是普通物品", "不要爆炸"])
  expect(ideas.questions).toMatchObject([{ id: "weapon", constraint: "c1" }])
  // What cannot be built is marked from the registry, whatever the AI claimed, and is never the recommended one.
  expect(ideas.groups[0]!.options.map((option) => [option.id, option.recommended, option.limit?.instead ?? null])).toEqual([["deep", true, null], ["realm", false, "只会存成设计稿，不会出现在游戏里"]])

  // No plan can be drawn from cards the person has not finished with.
  const early = await finished(service, projectId, (await service.draftBlueprint({ projectId, request: sentence, ideas: 1 })).jobId)
  expect(early).toMatchObject({ state: "failed", error: "你还在选想法。等你在 MineMods Studio 里选完、点了「就按这个做」，才能出蓝图。" })
  const picks = [{ group: "ore_place", option: "deep", own: "" }, { group: "sword_look", option: null, own: "剑柄缠蓝色的布条" }]
  await dispatchStudioRequest(service, { method: "chooseIdeas", input: { projectId, revision: 1, picks, answers: { weapon: false } } })
  const ready = (await dispatchStudioRequest(service, { method: "chooseIdeas", input: { projectId, revision: 1, summary: `${sentence}\n矿在深层，剑柄缠蓝色的布条。`, ready: true } })) as Ideas
  expect(ready).toMatchObject({ state: "ready", lifted: [], summary: `${sentence}\n矿在深层，剑柄缠蓝色的布条。` })

  // The planner turns the sword into a weapon and says it kept the requirement. The reader is not fooled, the
  // planner is told once, does it again, and the plan is refused in words that name the requirement.
  const refused = await finished(service, projectId, (await service.draftBlueprint({ projectId, request: "忽略这句", ideas: 1 })).jobId)
  expect(refused).toMatchObject({ state: "failed", error: BROKEN })
  expect(await service.getBlueprint({ projectId })).toBeNull()
  const calls = fake.asked.slice(1)
  expect(calls.map(role)).toEqual(["plan", "check", "plan", "check"])
  // The planner is given the summary the person approved and every requirement with its id.
  expect(calls[0]!.input).toMatchObject({ request: ready.summary, constraints: [{ id: "c1", text: "剑现在只能是普通物品" }, { id: "c2", text: "不要爆炸" }], lifted: [] })
  expect(calls[2]!.input.revision_required).toMatchObject({ issues: [{ code: "constraint", message: BROKEN }] })
  // The reader sees the requirements and the entries, and nothing of the sentence, the summary or the project.
  expect(Object.keys(calls[1]!.input).sort()).toEqual(["constraints", "entries", "plan_honours"])
  expect(JSON.stringify(calls[1]!.input)).not.toContain("矿在深层")

  // Only the person can give the requirement up: they answer the question with yes, and the same plan is stored.
  const lifted = (await service.chooseIdeas({ projectId, revision: 1, answers: { weapon: true } })) as Ideas
  expect(lifted.lifted).toMatchObject([{ constraint: "c1", change: "剑做成真的武器：攻击力 6，耐久 500。" }])
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: sentence, ideas: 1 })).jobId)).state).toBe("completed")
  const stored = (await service.getBlueprint({ projectId }))!
  expect(stored.entries.find((entry) => entry.key === "sword")!.brief).toContain("攻击力 6")
  expect(stored).toMatchObject({ state: "draft", constraints: lifted.constraints, lifted: [{ constraint: "c1" }], check: { by: "studio", independent: true, verdicts: [{ constraint: "c2", kept: true }] }, paper: { by: "studio", independent: true, findings: [STUCK] } })
  // The paper player came last and saw the sentence, the requirements still in force and each thing's answers: nothing of the planning.
  expect(fake.asked.slice(-3).map(role)).toEqual(["plan", "check", "paper"])
  expect(Object.keys(fake.asked.at(-1)!.input).sort()).toEqual(["constraints", "request", "things"])
  expect(fake.asked.at(-1)!.input).toMatchObject({ constraints: ["不要爆炸"], things: [{ name: "蓝晶", kind: "物品", answers: [{ question: "从哪来", state: "AI 补的" }, { question: "干什么用" }] }, { name: "蓝晶剑" }] })
  expect(fake.asked.at(-3)!.input).toMatchObject({ constraints: [{ id: "c2", text: "不要爆炸" }], lifted: [{ text: "剑现在只能是普通物品", change: "剑做成真的武器：攻击力 6，耐久 500。" }] })
  expect((await service.getIdeas({ projectId }))!.state).toBe("used")

  // What happened, in plain words and in order, for the side panel.
  const activity = await service.getActivity({ projectId })
  expect(said(activity)).toEqual([
    "plan/ok! -: 想法出来了：2 组做法等你挑，记下了你提的 2 条要求。",
    "person/note -: 你决定保持原来的要求，不改：「剑现在只能是普通物品」",
    "person/note -: 你选好了做法，说「就按这个做」。",
    "person/note -: 你同意改掉一条要求：剑做成真的武器：攻击力 6，耐久 500。",
    "plan/ok! -: 蓝图草稿好了：打算做 2 样。试玩员在纸上玩了一遍，有 1 处会卡住，写在蓝图旁边。等你确认。",
  ])
  expect(activity.events.filter((event) => event.step).map((event) => event.text)).toContain("正在请一个没参与规划的核对员，逐条核对蓝图有没有违反你的要求。")
  expect(activity.events.filter((event) => event.step).map((event) => event.text)).toContain("正在请一个没参与规划的试玩员，照着蓝图在纸上从头玩一遍。")
  expect(activity.running).toBe(false)
  mood.sword = plainSword
})

test("直连 AI「直接做」：不出卡片也先把要求逐字记下；没交代怎么遵守的蓝图改一次，照做的蓝图带着要求和核对结论存下", async () => {
  const turn = { plans: 0 }
  const fake = responder((asked) => {
    if (role(asked) === "quote") return { constraints: ["剑只是个普通物品"] }
    if (role(asked) === "check") return verdicts(asked.input)
    if (role(asked) === "paper") return { findings: [], advice: ["蓝晶除了做剑没有别的用处。"] }
    if (role(asked) === "task") return { kind: "item", identifier: (asked.input.task as { key: string }).key, name: "蓝晶", max_stack: 16, color: "#3355aa", texture: null }
    turn.plans += 1
    return turn.plans === 1 ? plan(plainSword, []) : plan(plainSword)
  })
  const service = await studio(fake.ai)
  const projectId = (await service.createProject({ name: "蓝晶", description: "", modId: "bluecrystal", empty: true })).project.id
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: sentence })).jobId)).state).toBe("completed")
  // The quote was a paraphrase: asked once more to copy. It paraphrased again, so that "requirement" is left out,
  // and the limiting clauses of the sentence are locked by rule all the same. The reader is asked once, for the plan that answers.
  expect(fake.asked.map(role)).toEqual(["quote", "quote", "plan", "plan", "check", "paper"])
  expect(fake.asked[0]!.input).toEqual({ request: sentence })
  expect(fake.asked[1]!.input.revision_required).toBe("「剑只是个普通物品」不是你原话里的句子。要求必须逐字摘自你说的话，不能改写。")
  expect(fake.asked[2]!.input).toMatchObject({ request: sentence, constraints: [{ id: "c1", text: "剑现在只能是普通物品" }, { id: "c2", text: "不要爆炸" }] })
  expect(fake.asked[3]!.input.revision_required).toMatchObject({ issues: [{ code: "constraint", message: "蓝图没有交代怎么遵守你说的「不要爆炸」，所以没有保存。每一条要求都要写明由哪一样东西、怎么遵守。" }] })
  const stored = (await service.getBlueprint({ projectId }))!
  expect(stored).toMatchObject({ request: sentence, honours: whole, constraints: [{ id: "c1", origin: "said" }, { id: "c2", origin: "said" }], lifted: [], check: { by: "studio", independent: true } })
  expect(stored.entries[1]!.honours).toEqual(plainSword.honours)
  expect(await service.getIdeas({ projectId })).toMatchObject({ groups: [], state: "used", constraints: stored.constraints })
  // The person's own edit keeps the requirements with the plan and drops the comparison: nobody compared the plan as it is now.
  const edited = await service.saveBlueprint({ projectId, revision: 1, blueprint: { request: stored.request, style: stored.style, questions: [], entries: stored.entries.map((entry) => ({ key: entry.key, kind: entry.kind, title: entry.title, brief: `${entry.brief}（改过）`, owner: entry.owner, needs: entry.needs, out_of_scope: entry.out_of_scope })) } })
  expect(edited.constraints).toEqual(stored.constraints)
  expect(edited.honours).toEqual(whole)
  expect(edited.entries[1]!.honours).toEqual(plainSword.honours)
  expect(edited.check).toBeUndefined()
  // Every task made from it is told the requirements word for word.
  await service.confirmBlueprint({ projectId, revision: 2 })
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const told = fake.asked.filter((asked) => role(asked) === "task").map((asked) => String(asked.input.prompt))
  expect(told).toHaveLength(2)
  told.forEach((prompt) => expect(prompt).toContain("用户亲口提的要求，一条都不能违反：\n- 「剑现在只能是普通物品」"))
  expect(told.find((prompt) => prompt.includes("蓝晶做的剑"))).toContain("- 「剑现在只能是普通物品」（这一样的做法：只是一个普通物品，没有攻击力和耐久。）\n- 「不要爆炸」")
})

test("外部 AI：想法只有人能选；蓝图没带核对、核对说违反、漏了一条都被拒，原话告诉它是哪一条；人点头以后才收", async () => {
  const service = await studio({ mode: "mcp", review:true })
  const created = await service.createProject({ name: "外部蓝晶", description: "", modId: "bluecrystal", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  type Shown = { ideas: (Ideas & { locked: { id: string; text: string }[] }) | null; chosen: boolean; author: { instructions: string; schema: { properties: object } }; next_step: string }

  const empty = (await call("getIdeas", { projectId })) as unknown as Shown
  expect(empty).toMatchObject({ ideas: null, chosen: false })
  expect(empty.author.instructions).toBe(ideaInstructions(target))
  expect(Object.keys(empty.author.schema.properties).sort()).toEqual(["constraints", "declined", "groups", "questions", "things"])
  // A "requirement" that is not the person's words is refused where it comes in.
  expect(await refused("proposeIdeas", { projectId, request: sentence, ideas: { ...cards, constraints: ["剑可以是武器"], questions: [] } })).toBe("「剑可以是武器」不是你原话里的句子。要求必须逐字摘自你说的话，不能改写。")
  const proposed = (await call("proposeIdeas", { projectId, request: sentence, ideas: cards })) as unknown as Shown
  expect(proposed).toMatchObject({ chosen: false, ideas: { by: "outside", state: "choosing", picks: [], locked: [{ id: "c1" }, { id: "c2" }] } })
  // Nothing an outside AI can reach chooses, answers or lifts.
  expect(MCP_TOOLS.some((tool) => /choose|pick|answer|lift|discard_ideas/.test(tool[0]))).toBe(false)
  ;["chooseIdeas", "discardIdeas", "expandIdeas", "getActivity"].forEach((method) => expect(ExternalBridgeRequestSchema.safeParse({ method, input: { projectId, revision: 1 } }).success).toBe(false))
  expect(StudioRequestSchema.safeParse({ method: "chooseIdeas", input: { projectId, revision: 1, picks: [{ group: "ore_place", option: "deep", own: "" }], path: "C:/x" } }).success).toBe(false)

  const good = { projectId, request: sentence, blueprint: plan(plainSword), paper_play: PAPER }
  const kept = { verdicts: [{ constraint: "c1", kept: true, entry: null, why: "剑是普通物品。" }, { constraint: "c2", kept: true, entry: null, why: "没有爆炸。" }], independent: true }
  const LIST = "\n现在锁定的要求（honours 和 constraint_check 里用这些 id）：c1「剑现在只能是普通物品」；c2「不要爆炸」"
  // While the person is still choosing, no plan is taken.
  expect(await refused("proposeBlueprint", { ...good, constraint_check: kept })).toBe("你还在选想法。等你在 MineMods Studio 里选完、点了「就按这个做」，才能出蓝图。")
  await service.chooseIdeas({ projectId, revision: 1, picks: [{ group: "ore_place", option: "deep", own: "" }, { group: "sword_look", option: "clear", own: "" }], answers: { weapon: false }, ready: true })
  const chosen = (await call("getIdeas", { projectId })) as unknown as Shown
  expect(chosen).toMatchObject({ chosen: true, ideas: { state: "ready", picks: [{ group: "ore_place", option: "deep" }, { group: "sword_look", option: "clear" }] } })
  expect(chosen.ideas!.summary).toContain("- 蓝晶剑的样子：透明剑身。")
  const summary = chosen.ideas!.summary!

  expect(await refused("proposeBlueprint", { ...good, request: summary, blueprint: plan(plainSword, []) })).toBe(`蓝图没有交代怎么遵守你说的「不要爆炸」，所以没有保存。每一条要求都要写明由哪一样东西、怎么遵守。${LIST}`)
  expect(await refused("proposeBlueprint", { ...good, request: summary })).toBe(`用户提过要求，提交蓝图时要带上 constraint_check：请一个只看得到这些要求和蓝图条目的评审逐条核对，把它的结论交上来。${LIST}`)
  expect(await refused("proposeBlueprint", { ...good, request: summary, constraint_check: { ...kept, verdicts: kept.verdicts.slice(0, 1) } })).toBe(`核对的时候漏掉了你说的「不要爆炸」，所以没有保存。${LIST}`)
  // The sword case: the plan makes it a weapon, its reader says so, and Studio refuses in the person's terms.
  const armed = { ...good, request: summary, blueprint: plan(weapon), constraint_check: { ...verdicts({ constraints: chosen.ideas!.locked, entries: [ore, weapon] }), independent: true } }
  expect(await refused("proposeBlueprint", armed)).toBe(`${BROKEN}${LIST}`)
  expect((await openProject(created.directory)).blueprint).toBeUndefined()

  // The person says yes to the question in the app; the same plan, with the same reader's verdicts, is now a draft.
  await service.chooseIdeas({ projectId, revision: 1, answers: { weapon: true } })
  const accepted = (await call("proposeBlueprint", armed)) as { blueprint: { state: string; lifted: { constraint: string }[]; check: { by: string; independent: boolean } }; confirmed: boolean }
  expect(accepted).toMatchObject({ confirmed: false, blueprint: { state: "draft", lifted: [{ constraint: "c1" }], check: { by: "outside", independent: true } } })
  const held = (await call("getBlueprint", { projectId })) as unknown as { requirements: { constraints: { id: string }[]; lifted: { constraint: string }[]; check: { instructions: string } } }
  expect(held.requirements.constraints.map((value) => value.id)).toEqual(["c2"])
  expect(held.requirements.check.instructions).toBe(CONSTRAINT_CHECK_INSTRUCTIONS)

  // Every call shows in the panel in plain words; the refusals with what Studio said, the polls only under 高级.
  const activity = await service.getActivity({ projectId })
  const shown = activity.events.filter((event) => !event.quiet).map((event) => `${event.mark} ${event.text}`)
  expect(shown).toContain("fail 外部 AI 出了一组想法卡片，被 Studio 退回了。")
  expect(shown).toContain("ok 外部 AI 交来了想法。2 组做法等你挑，记下了你提的 2 条要求。")
  expect(shown).toContain("note 外部 AI 来看你选了哪些想法。")
  expect(shown.filter((text) => text === "fail 外部 AI 交了一份蓝图草稿，被 Studio 退回了。")).toHaveLength(5)
  expect(shown.at(-2)).toBe("ok 外部 AI 交来了蓝图草稿。打算做 2 样。等你确认。")
  expect(shown.at(-1)).toBe("note 外部 AI 读了蓝图，看每样东西做到哪一步了。")
  const refusal = activity.events.filter((event) => event.mark === "fail").at(-1)!
  expect(refusal.lines![0]).toBe(BROKEN)
  expect(refusal).toMatchObject({ kind: "tool", tool: "propose_blueprint" })
  expect(activity.events.filter((event) => event.quiet).map((event) => event.tool)).toEqual(["propose_ideas", "propose_blueprint"])
})

test("外部 AI 直接交蓝图：Studio 自己把原话里带限定的句子锁上，AI 不摘也逃不掉；没提要求的句子照旧一步就收", async () => {
  const service = await studio({ mode: "mcp", review:true })
  const projectId = (await service.createProject({ name: "外部蓝晶", description: "", modId: "bluecrystal", empty: true })).project.id
  const refused = (input: unknown) => dispatchExternal(service, { method: "proposeBlueprint", input }).then(() => "accepted", (error: unknown) => publicError(externalError(error)))
  const bare = played({ style, entries: [ore, { ...weapon, honours: undefined }], questions: [] })
  expect(await refused({ projectId, request: sentence, blueprint: bare })).toStartWith("蓝图没有交代怎么遵守你说的「剑现在只能是普通物品」，所以没有保存。")
  // A refused plan leaves nothing behind: neither a draft nor a list the person never saw.
  expect(await service.getBlueprint({ projectId })).toBeNull()
  expect(await service.getIdeas({ projectId })).toBeNull()
  // The playable standard is the same door: a thing left without an answer is named, and a plan nobody played on paper is not taken.
  expect(await refused({ projectId, request: "做一块蓝晶和一把蓝晶剑", blueprint: { style, entries: [ore, { ...weapon, honours: undefined }], questions: [] }, paper_play: PAPER })).toStartWith("这份蓝图做出来还不能算一个能玩的模组，所以没有保存。")
  expect(await refused({ projectId, request: "做一块蓝晶和一把蓝晶剑", blueprint: bare })).toBe(PLAY_REFUSALS.unplayed)
  expect(await refused({ projectId, request: "做一块蓝晶和一把蓝晶剑", blueprint: bare, paper_play: PAPER })).toBe("accepted")
  expect((await service.getBlueprint({ projectId }))!.constraints).toBeUndefined()
})

// broad18: a plan was refused over a requirement and the person had no way to change that requirement on the blueprint page.
test("直连 AI：蓝图出来以后人改要求（改字、不要、新加）：记成人自己的改动留着原话，蓝图跟着换，核对员照新的要求重新核对；AI 只能照新的重新交", async () => {
  const NEW = "爆炸只能很小，不能炸坏方块"
  const mood = { honours: whole, sword: plainSword }
  const fake = responder((asked) => {
    if (role(asked) === "quote") return { constraints: ["剑现在只能是普通物品"] }
    if (role(asked) === "check") return verdicts(asked.input)
    if (role(asked) === "paper") return { findings: [], advice: [] }
    return plan(mood.sword, mood.honours)
  })
  const service = await studio(fake.ai)
  const projectId = (await service.createProject({ name: "蓝晶", description: "", modId: "bluecrystal", empty: true })).project.id
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: sentence })).jobId)).state).toBe("completed")
  const first = (await service.getBlueprint({ projectId }))!
  expect(first).toMatchObject({ revision: 1, state: "draft", check: { by: "studio" }, constraints: [{ id: "c1" }, { id: "c2" }] })
  expect((await service.getProjectOverview({ projectId })).plan_refusal).toBeNull()

  // The person rewords "不要爆炸" on the blueprint page: the same save path as every other change to their list.
  const asked = fake.asked.length
  const record = (await service.chooseIdeas({ projectId, revision: 1, reword: [{ id: "c2", text: NEW }] })) as Ideas
  expect(record.constraints.at(-1)).toEqual({ id: "c3", text: NEW, origin: "added", replaces: "c2" })
  expect(record.lifted).toMatchObject([{ constraint: "c2", change: NEW }])
  expect(record.changes).toMatchObject([{ kind: "reword", constraint: "c3", from: "c2", was: "不要爆炸", now: NEW, answered: false }])
  expect(record.state).toBe("used")
  // The plan carries the new list, with what the old line said kept; its entries are untouched and it is not confirmed or renumbered by this.
  const held = (await service.getBlueprint({ projectId }))!
  expect(held).toMatchObject({ revision: 1, state: "draft", constraints: record.constraints, lifted: record.lifted })
  expect(held.entries).toEqual(first.entries)
  // The comparison was made again, by a reader that saw the new words and not the old ones, and is what the plan is now stored with.
  expect(fake.asked.slice(asked).map(role)).toEqual(["check"])
  const reader = fake.asked.at(-1)!.input as { constraints: { id: string; text: string }[] }
  expect(reader.constraints).toEqual([{ id: "c1", text: "剑现在只能是普通物品" }, { id: "c3", text: NEW }])
  expect(JSON.stringify(reader)).not.toContain("不要爆炸")
  expect(held.check).toMatchObject({ by: "studio", verdicts: [{ constraint: "c1" }, { constraint: "c3" }] })
  expect(said(await service.getActivity({ projectId })).slice(-2)).toEqual([`person/note -: 你把要求「不要爆炸」改成了「${NEW}」。`, "plan/ok! -: 照你改过的要求重新审查过了，审查员没有发现违反。"])

  // Dropping one and adding one are the person's too; the plan is not changed by either, only the list it is held to.
  const dropped = (await service.chooseIdeas({ projectId, revision: 1, lift: ["c1"], add: "守卫叫蓝晶卫" })) as Ideas
  expect(dropped.changes.slice(1).map((value) => [value.kind, value.constraint])).toEqual([["add", "c4"], ["drop", "c1"]])
  expect((await service.getBlueprint({ projectId }))).toMatchObject({ lifted: [{ constraint: "c2" }, { constraint: "c1" }], constraints: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }] })
  // An edit that does not fit is said in words and writes nothing.
  await expect(service.chooseIdeas({ projectId, revision: 1, reword: [{ id: "c2", text: "还是别的" }] })).rejects.toThrow("这一条已经不要了。")
  await expect(service.chooseIdeas({ projectId, revision: 9, add: "x要求" })).rejects.toThrow("想法刚刚更新过")
  await service.chooseIdeas({ projectId, revision: 1, restore: ["c1"] })
  await service.chooseIdeas({ projectId, revision: 1, lift: ["c4"] })

  // The AI is held to the new list. It is told what changed; a plan that still answers the old line is refused for the new one, and the page is told where.
  const next = await finished(service, projectId, (await service.draftBlueprint({ projectId, request: sentence })).jobId)
  expect(next).toMatchObject({ state: "failed", error: LOCK.unanswered(NEW) })
  const planned = fake.asked.filter((value) => role(value) === "plan").at(-2)!.input as { constraints: { id: string; text: string }[]; lifted: { text: string; change: string }[] }
  expect(planned.constraints).toEqual([{ id: "c1", text: "剑现在只能是普通物品" }, { id: "c3", text: NEW }])
  expect(planned.lifted).toContainEqual({ text: "不要爆炸", change: NEW })
  // The refused plan is not stored; the one before stands, and the refusal stands beside it with the requirement it is about.
  expect((await service.getBlueprint({ projectId }))!.revision).toBe(1)
  const refused = (await service.getProjectOverview({ projectId })).plan_refusal!
  expect(refused).toMatchObject({ by: "studio", about: "requirement", why: LOCK.unanswered(NEW), titles: ["蓝晶", "蓝晶剑"], against: 1, settled: false, constraint: { id: "c3", text: NEW, lifted: false, recorded: true } })
  // Answering the new line gets the plan through; the refusal is gone and the person is no longer owed any telling.
  mood.honours = [...whole, { constraint: "c3", how: "爆炸只有很小一圈。" }]
  mood.sword = { ...plainSword, honours: [{ constraint: "c1", how: "只是一个普通物品，没有攻击力和耐久。" }] }
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: sentence })).jobId)).state).toBe("completed")
  expect((await service.getProjectOverview({ projectId })).plan_refusal).toBeNull()
  expect(((await service.getIdeas({ projectId })) as Ideas).changes.every((value) => value.answered)).toBe(true)
  expect((await service.getBlueprint({ projectId }))).toMatchObject({ revision: 2, constraints: [{ id: "c1" }, { id: "c2" }, { id: "c3", replaces: "c2" }, { id: "c4" }] })
})

test("外部 AI：计划被退回的原因出现在总览里，指向那一条要求；人改了那一条以后 AI 读得到改了什么，旧的核对作废，只能照新的重新交", async () => {
  const NEW = "剑可以有一点点攻击力，别太强"
  const service = await studio({ mode: "mcp", review:true })
  const projectId = (await service.createProject({ name: "外部蓝晶", description: "", modId: "bluecrystal", empty: true })).project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  await call("proposeIdeas", { projectId, request: sentence, ideas: cards })
  await service.chooseIdeas({ projectId, revision: 1, picks: [{ group: "ore_place", option: "deep", own: "" }, { group: "sword_look", option: "clear", own: "" }], answers: { weapon: false }, ready: true })
  const summary = ((await call("getIdeas", { projectId })) as unknown as { ideas: Ideas }).ideas.summary!
  const verdictFor = (ids: string[], armed: boolean) => ({ verdicts: ids.map((id) => ({ constraint: id, kept: !(armed && id === "c1"), entry: armed && id === "c1" ? "sword" : null, why: "它被做成了攻击力 6、带耐久和技能的武器，不是普通物品" })), independent: true })
  const armed = { projectId, request: summary, blueprint: plan(weapon), paper_play: PAPER, constraint_check: verdictFor(["c1", "c2"], true) }
  // Nothing was refused yet, and the page has nothing to say.
  expect((await service.getProjectOverview({ projectId })).plan_refusal).toBeNull()
  expect(await refused("proposeBlueprint", armed)).toStartWith("这份蓝图和你说过的要求对不上")
  // The refusal's reason is in the blueprint page's own view model, beside the empty blueprint, with the requirement it is about as it stands.
  const view = await service.getProjectOverview({ projectId })
  expect(view.blueprint).toBeNull()
  expect(view.plan_refusal).toMatchObject({ by: "outside", about: "requirement", why: BROKEN, titles: ["蓝晶", "蓝晶剑"], against: null, settled: false, constraint: { id: "c1", text: "剑现在只能是普通物品", lifted: false, reworded_into: null, recorded: true } })
  expect(JSON.stringify(view.plan_refusal)).not.toContain("现在锁定的要求（honours")
  // The AI-facing text is as before, with the list of ids; the person's text has none of that.
  expect(view.plan_refusal!.why).not.toContain("constraint_check")

  // The person changes their mind on that very requirement; the same path the card uses.
  const record = (await service.chooseIdeas({ projectId, revision: ((await service.getIdeas({ projectId })) as Ideas).revision, reword: [{ id: "c1", text: NEW }] })) as Ideas
  expect(record.state).toBe("ready")
  expect(record.constraints.at(-1)).toMatchObject({ id: "c3", text: NEW, replaces: "c1", origin: "added" })
  expect((await service.getProjectOverview({ projectId })).plan_refusal).toMatchObject({ settled: true, constraint: { id: "c1", lifted: true, reworded_into: "c3", recorded: true } })
  // The AI reads what changed, in sentences, and which lines are in force now. Nothing it can call changes a requirement.
  const read = (await call("getBlueprint", { projectId })) as unknown as { requirements: { constraints: { id: string; text: string }[]; changed: string[] } }
  expect(read.requirements.constraints.map((value) => [value.id, value.text])).toEqual([["c2", "不要爆炸"], ["c3", NEW]])
  expect(read.requirements.changed).toEqual([`用户把 c1「剑现在只能是普通物品」改成了 c3「${NEW}」。c1 作废，不用再遵守；新的 c3 要在 honours 和 constraint_check 里交代。`])
  expect(((await call("getIdeas", { projectId })) as unknown as { ideas: { changed: string[] } }).ideas.changed).toHaveLength(1)

  // The same plan, still answering the old line and compared against it, is refused for the new one: the pointer moves to the new card.
  const stale = { ...armed, constraint_check: verdictFor(["c1", "c2"], false), blueprint: plan(plainSword) }
  expect(await refused("proposeBlueprint", stale)).toStartWith(LOCK.unanswered(NEW))
  expect((await service.getProjectOverview({ projectId })).plan_refusal).toMatchObject({ why: LOCK.unanswered(NEW), constraint: { id: "c3", text: NEW, recorded: true }, settled: false })
  // Held to the new words it is accepted; the refusal is gone, and so is the telling.
  const answered = { ...stale, blueprint: plan({ ...plainSword, honours: [{ constraint: "c3", how: "没有攻击力和耐久，只是个普通物品。" }] }), constraint_check: verdictFor(["c2", "c3"], false) }
  expect(await refused("proposeBlueprint", answered)).toBe("accepted")
  expect((await service.getProjectOverview({ projectId })).plan_refusal).toBeNull()
  expect(((await call("getBlueprint", { projectId })) as unknown as { requirements: { changed: string[] } }).requirements.changed).toEqual([])
  expect(await service.getBlueprint({ projectId })).toMatchObject({ constraints: [{ id: "c1" }, { id: "c2" }, { id: "c3" }], lifted: [{ constraint: "c1", change: NEW }], check: { by: "outside" } })

  // With the plan standing, a change of the list drops the comparison it was stored with (nobody compared it against the new words) and says so.
  await service.chooseIdeas({ projectId, revision: ((await service.getIdeas({ projectId })) as Ideas).revision, reword: [{ id: "c3", text: "剑不许有攻击力" }] })
  const after = (await service.getBlueprint({ projectId }))!
  expect(after.check).toBeUndefined()
  expect(after.constraints!.at(-1)).toMatchObject({ id: "c4", text: "剑不许有攻击力", replaces: "c3" })
  expect(((await call("getBlueprint", { projectId })) as unknown as { requirements: { changed: string[] } }).requirements.changed).toHaveLength(1)
  // Nothing of this is reachable by an outside AI.
  expect(ExternalBridgeRequestSchema.safeParse({ method: "chooseIdeas", input: { projectId, revision: 1, reword: [{ id: "c1", text: "x要求" }] } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "chooseIdeas", input: { projectId, revision: 1, reword: [{ id: "c1", text: "x要求" }] } }).success).toBe(true)
  expect(StudioRequestSchema.safeParse({ method: "chooseIdeas", input: { projectId, revision: 1, reword: [{ id: "c1", text: "x要求", extra: 1 }] } }).success).toBe(false)
})

test("没有想法记录的蓝图也能让人改要求：给一份空的记录，只留人自己写的", async () => {
  const service = await studio({ mode: "mcp", review:true })
  const projectId = (await service.createProject({ name: "没记录", description: "", modId: "bluecrystal", empty: true })).project.id
  await service.saveBlueprint({ projectId, revision: 0, blueprint: { request: "做一块蓝晶", style, entries: [{ key: "gem", kind: "item", title: "蓝晶", brief: "一块蓝晶", owner: null, needs: [], out_of_scope: null }], questions: [] } })
  expect(await service.getIdeas({ projectId })).toBeNull()
  const record = (await service.chooseIdeas({ projectId, revision: 1, add: "颜色只能是蓝色" })) as Ideas
  expect(record).toMatchObject({ state: "used", request: "做一块蓝晶", constraints: [{ id: "c1", text: "颜色只能是蓝色", origin: "added" }] })
  expect(await service.getBlueprint({ projectId })).toMatchObject({ constraints: [{ id: "c1" }], lifted: [] })
})

test("动态：确认、开工、每样东西的每一步、验收和打回，按发生的顺序记下；重开以后还在；轮询只拿新的", async () => {
  const item = (asked: Asked) => {
    const task = asked.input.task as { key: string; title: string }
    if (task.key === "bad") return { kind: "recipe", name: "不是物品" }
    return { kind: "item", identifier: task.key, name: task.title, max_stack: 16, color: "#99ccff", texture: null }
  }
  const fake = responder(item)
  const service = await studio(fake.ai)
  const created = await service.createProject({ name: "动态", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const entry = (key: string, title: string): Entry => ({ key, kind: "item", title, brief: `做一个${title}`, owner: null, needs: [], out_of_scope: null })
  await service.saveBlueprint({ projectId, revision: 0, blueprint: { request: "做一套蓝晶", style, entries: [entry("gem", "蓝晶"), entry("bad", "坏掉的")], questions: [] } })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const before = await service.getActivity({ projectId })
  expect(said(before)).toEqual(["person/ok -: 你确认了蓝图。"])
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const overview = await service.getProjectOverview({ projectId })
  const gem = overview.items.find((value) => value.id === "gem")!
  await service.reviewAsset({ projectId, assetId: gem.asset_id!, verdict: "rejected", note: "太亮了" })
  await service.clearAssetReview({ projectId, assetId: gem.asset_id! })
  await service.reviewAsset({ projectId, assetId: gem.asset_id!, verdict: "accepted" })

  const activity = await service.getActivity({ projectId })
  const lines = said(activity)
  // Two things made side by side interleave; each one's own steps stay in order, and the batch closes after both.
  const of = (title: string) => lines.filter((text) => text.includes(` ${title}: `))
  expect(of("蓝晶")).toEqual(["task/run 蓝晶: 开始做", "task/ok! 蓝晶: 做好了，已经保存，等你验收。", "person/note 蓝晶: 你说这一版要改。", "person/note 蓝晶: 你撤回了对这一版的意见。", "person/ok 蓝晶: 你验收通过了。"])
  expect(of("坏掉的").at(0)).toBe("task/run 坏掉的: 开始做")
  expect(of("坏掉的").at(-1)).toBe("task/fail! 坏掉的: 这一样没做成。")
  expect(lines[0]).toBe("person/ok -: 你确认了蓝图。")
  expect(lines[1]).toBe("batch/run -: 开始做这一批，一共 2 样：蓝晶、坏掉的")
  expect(lines.filter((text) => text.startsWith("batch/")).at(-1)).toMatch(/^batch\/(warn|fail)! -: /)
  expect(lines.indexOf("task/ok! 蓝晶: 做好了，已经保存，等你验收。")).toBeLessThan(lines.indexOf("person/note 蓝晶: 你说这一版要改。"))
  // Every event about a thing names its overview item, so a click on the node lands on its card.
  expect(activity.events.filter((event) => event.title === "蓝晶").every((event) => event.item === "gem")).toBe(true)
  expect(activity.events.find((event) => event.text === "你说这一版要改。")!.lines).toEqual(["太亮了"])
  // A failure never shows a raw error as its sentence.
  const failed = activity.events.filter((event) => event.title === "坏掉的" && event.end).at(-1)!
  expect(failed.lines!.join("")).not.toMatch(/Error|at \w+ \(|\{"/)
  expect(activity.events.map((event) => event.seq)).toEqual(activity.events.map((_, index) => index + 1))
  expect(activity).toMatchObject({ last: activity.events.length, running: false })
  expect(Date.parse(activity.now)).toBeGreaterThanOrEqual(Date.parse(activity.alive_at!))

  // Polling with what is already on screen returns only what came since.
  expect((await service.getActivity({ projectId, after: activity.last })).events).toEqual([])
  expect((await service.getActivity({ projectId, after: activity.last - 1 })).events.map((event) => event.text)).toEqual(["你验收通过了。"])
  expect(StudioRequestSchema.safeParse({ method: "getActivity", input: { projectId, after: -1 } }).success).toBe(false)
  // The log is a file beside the project and nothing in the project file: another Studio on the same folder reads the same.
  expect(await readdir(path.join(created.directory, ".minemods"))).toContain("activity.jsonl")
  expect((await readActivity(created.directory)).events).toHaveLength(activity.events.length)
  expect(JSON.stringify(await openProject(created.directory))).not.toContain("activity")

  // A step of a making that was looked at carries the picture the making loop already keeps: by reference in
  // the log, and as a small picture only when the panel reads it. Nothing is copied.
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  const files = await writePictures(created.directory, gem.asset_id!, 1, [{ label: "六个角度", url: PIXEL }], "a")
  const sheet = { subject: "一块蓝晶。", recognisable: ["青蓝色的晶簇"], parts: [{ name: "body", what: "晶体", shape: "一簇", attaches: "立着", surface: "青蓝", moves: "不动", assumed: false }], assumed: [] }
  const record = looked(describe(begin(null, { asset_id: gem.asset_id!, entry: "gem", kind: "model", request: "蓝晶", brief: "蓝晶", task_id: crypto.randomUUID(), remark: null }), sheet), { fingerprint: fingerprint({ kind: "model", name: "a" }), pictures: files, findings: [] })
  await noteActivity(created.directory, makingActivity(record, { item: "gem", title: "蓝晶" }))
  const pictured = await service.getActivity({ projectId, after: activity.last })
  expect(pictured.events.map((event) => [event.kind, event.text, event.round ?? null, event.thumb ?? null])).toEqual([["task", "写好了部件说明：1 个部件。", null, null], ["look", "做出了第 1 版，看了它的渲染图。", 1, PIXEL]])
  // What the screen is given has neither the file reference nor the key.
  expect(Object.keys(pictured.events[1]!)).not.toContain("picture")
  expect(Object.keys(pictured.events[1]!)).not.toContain("key")
  expect((await readActivity(created.directory, activity.last)).events[1]).toMatchObject({ picture: { asset_id: gem.asset_id, file: files[0]!.file } })
})

test("外部 AI 的每一次工具调用都是一条动态：领任务、交草稿、被验收口退回、提交；没点名工程的调用不记", async () => {
  const service = await studio({ mode: "mcp", review:true })
  const created = await service.createProject({ name: "外部动态", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  await call("getCapabilities", {})
  await call("listProjects", {}).catch(() => undefined)
  expect((await service.getActivity({ projectId })).events).toEqual([])
  await call("proposeBlueprint", { projectId, request: "做一块蓝晶", blueprint: played({ style, entries: [ore], questions: [] }), paper_play: PAPER })
  await dispatchStudioRequest(service, { method: "confirmBlueprint", input: { projectId, revision: 1 } })
  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = { projectId, runId: batch.run.id, taskId: batch.tasks[0]!.task.id }
  await call("claimExternalTask", ids)
  await call("getExternalRun", { projectId, runId: batch.run.id })
  await call("getExternalRun", { projectId, runId: batch.run.id })
  await call("commitExternalTask", { ...ids, document: { kind: "recipe", name: "不是物品" } }).catch(() => undefined)
  await call("commitExternalTask", { ...ids, document: { kind: "item", identifier: "ore", name: "蓝晶", max_stack: 16, color: "#3355aa", texture: null } })
  await call("nextBatch", { projectId })

  const activity = await service.getActivity({ projectId })
  const all = activity.events.map((event) => `${event.kind}/${event.mark}${event.quiet ? "?" : ""} ${event.title ?? "-"}: ${event.text}`)
  expect(all).toContain("tool/note? -: 外部 AI 领了下一批要做的东西。")
  expect(all).toContain("tool/note? 蓝晶: 外部 AI 接下了「蓝晶」。")
  // Taken and not touched: the line does not say it started.
  expect(all).toContain("task/note 蓝晶: 领了任务，还没动手")
  // The same poll twice within a minute is one line.
  expect(all.filter((text) => text.includes("看了看这一批的进度"))).toHaveLength(1)
  expect(all).toContain("tool/fail 蓝晶: 外部 AI 提交了「蓝晶」，被 Studio 退回了。")
  expect(all).toContain("task/ok 蓝晶: 做好了，已经保存，等你验收。")
  expect(all.at(-1)).toBe("tool/note? -: 外部 AI 来领下一批，现在没有可以开始的。")
  // Order as it happened: claimed, refused, saved.
  const at = (text: string) => all.findIndex((value) => value.includes(text))
  expect(at("接下了「蓝晶」")).toBeLessThan(at("被 Studio 退回了"))
  expect(at("被 Studio 退回了")).toBeLessThan(at("做好了，已经保存"))
  // 高级 gets the tool's name and how long it took; a person's sentence never carries them.
  const refusal = activity.events.find((event) => event.mark === "fail" && event.kind === "tool")!
  expect(refusal).toMatchObject({ tool: "commit_task", item: "ore" })
  expect(refusal.detail).toStartWith("commit_task · ")
  expect(refusal.ms).toBeGreaterThanOrEqual(0)
  expect(activity.events.every((event) => !/commit_task|claim_task|next_batch/.test(event.text))).toBe(true)
})

test("别的功能加进来的调用也说人话：自己画的参考图、用脚本搭的一版、代码检查", () => {
  const projectId = "00000000-0000-4000-8000-000000000001"
  const said = (method: Parameters<typeof toolActivity>[0]["method"], input: Record<string, unknown>, result: unknown = {}) => toolActivity({ method, input: { projectId, ...input }, result, refused: null, ms: 12, run: null })
  // Nothing else reports a hand-in of reference views, so it is shown; the look and the check have their own nodes and stay behind 高级.
  expect(said("conceptExternalTask", { views: [{ name: "正面", image: "data:" }, { name: "侧面", image: "data:" }] })).toMatchObject({ tool: "save_concepts", text: "外部 AI 给这一样画了 2 张参考图。" })
  expect(said("conceptExternalTask", { views: [] })!.quiet).toBeUndefined()
  expect(said("conceptExternalTask", { views: [] })!.text).toBe("外部 AI 拿掉了自己给这一样画的参考图。")
  expect(said("lookExternalTask", { script: { source: "box()" } }, { round: 2 })).toMatchObject({ tool: "look", quiet: true, text: "外部 AI 用脚本搭了一版，看了一眼这一样的第 2 版。" })
  expect(said("lookExternalTask", { document: {} }, { round: 1 })!.text).toBe("外部 AI 看了一眼这一样的第 1 版。")
  expect(said("checkCodeExternalTask", {})).toMatchObject({ tool: "check_code", quiet: true, text: "外部 AI 让 Studio 检查了这一样的代码。" })
})

import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ASSET_KINDS } from "@minemods/mod-core/workspace-modules"
import { CRITERIA, EXCUSES, SEVERITIES, STANDARD_SUMMARY } from "@minemods/mod-core/acceptance"
import { GESTURE_BOUNDARY } from "@minemods/mod-core/gesture-rig"
import { DATA_CAPABILITY } from "@minemods/mod-core/data-words"
import { MODEL_ART_DIRECTION } from "@minemods/studio-ai/model-quality"
import { ABILITY_REVIEW_GUIDE, MAKING_DISCIPLINE, REFERENCE_GUIDE, REVIEW_SWITCH } from "@minemods/studio-ai/making"
import { DRAWN_GUIDE, SCRIPT_GUIDE } from "@minemods/studio-ai/script"
import { dispatchExternal, externalError, taskGuide } from "../src/main/external-dispatch"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { buildAndCheckStep, buildMcpHandoff, INSTRUCTIONS_IMPORT, INSTRUCTIONS_MERGE, INSTRUCTIONS_TOOLS, MCP_MAKING_ENDINGS, MCP_MAKING_REFUSALS, MCP_SERVER_INSTRUCTIONS, MCP_TOOLS, PLAIN_TALK } from "../src/main/mcp-handoff"
import { CLAIM_GUIDE, GUIDE_TOPIC_IDS, GUIDE_TOPICS, type GuideTopicId } from "../src/main/mcp-guide-topics"
import { claimSegments, guideSegments, guideText } from "../src/main/mcp-guide"
import { gameplayHandoffSection } from "../src/main/gameplay-handoff"
import { createStudioService, publicError } from "../src/main/service"
import type { ExternalTaskContext } from "../src/external"
import { CONFIGURATION, everythingToRead, PROJECT } from "./handoff-reading"
import { PAPER, played } from "./playable-fixture"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
type Service = Awaited<ReturnType<typeof createStudioService>>
const directories: string[] = []
const services: Service[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function external(ai: Record<string, unknown> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-guide-"))
  directories.push(directory)
  const service = await createStudioService({ workspaceDirectory: path.join(directory, "projects"), runtimeDirectory: path.join(directory, "runtime"), templateDirectory: TEMPLATE, ai: { mode: "mcp", review:true, ...ai } })
  services.push(service)
  const created = await service.createProject({ name: "说明", description: "", modId: "guided", empty: true })
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)
  return { service, created, projectId: created.project.id, call, refused }
}

type Guide = { kind: string; topics: string[]; text: string | null; also_in: string[]; next_step: string }
type Claimed = ExternalTaskContext & { guide: Guide }
type Bench = Awaited<ReturnType<typeof external>>

/** A run of the tasks given (each of its own kind, none waiting for another), started the way `plan_run` starts one. */
async function started(bench: Bench, tasks: { key: string; module: string; dependencies?: string[]; target_id?: string | null }[]) {
  const prompt = tasks.map((task) => `做${task.key}`).join("，")
  const run = (await bench.call("startExternal", {
    projectId: bench.projectId,
    expectedRevision: (await bench.service.openProject(bench.projectId)).project.revision,
    prompt,
    plan: { summary: "各样东西", questions: [], tasks: tasks.map((task) => ({ key: task.key, module: task.module, title: `${task.key}标题`, prompt: `做${task.key}`, source: `做${task.key}`, dependencies: task.dependencies ?? [], target_id: task.target_id ?? null })) },
  })) as { run: { id: string; tasks: { id: string; key: string }[] } }
  const ids = (key: string) => ({ projectId: bench.projectId, runId: run.run.id, taskId: run.run.tasks.find((task) => task.key === key)!.id })
  return { run, ids, claim: (key: string) => bench.call("claimExternalTask", ids(key)) as unknown as Promise<Claimed> }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The text the person copies

test("起步说明：怎么连上、整体流程、硬性规矩都在，并说清细节去哪里读", () => {
  const start = buildMcpHandoff({ configuration: CONFIGURATION, project: PROJECT, review: true })
  // How to connect: the configuration whole, both ways to write it, the client that cannot run a local program.
  expect(start).toContain(CONFIGURATION)
  expect(start).toContain("[mcp_servers.minemods-studio]")
  expect(start).toContain("不能用本地 MCP/stdio 的客户端")
  expect(start).toContain(PROJECT.id)
  // The order of work, in the tools there are today.
  for (const name of ["get_capabilities", "list_projects", "open_project", "get_blueprint", "propose_blueprint", "await_blueprint_decision", "next_batch", "plan_run", "claim_task", "update_task", "commit_task", "fail_task", "cancel_run", "build_project", "get_build", "check_scene", "get_scene_check"]) {
    expect(start).toContain(name)
    expect(MCP_TOOLS.map((tool) => tool[0]) as string[]).toContain(name)
  }
  // The rules that hold for everything: what it may not do, who decides, the second reader, what the person has locked.
  expect(start).toContain(PLAIN_TALK)
  for (const rule of ["没做过、没验证的不说成做过", "用户亲口提的要求是锁定的", "只有用户本人能在 Studio 里做，没有任何工具能代替", "不要自己调用 `final_review` 写结论，也不要另开子代理充当评审", "不写任意路径", "provenance.verified 只能是 false", "不要马上 fail_task"]) expect(start).toContain(rule)
  // Where the rest is read: the guide a claim brings, and every topic by name.
  expect(start).toContain("`guide`")
  expect(start).toContain("get_guide")
  for (const topic of GUIDE_TOPIC_IDS) expect(start).toContain(`\`${topic}\``)
  // Review off: the maker checks itself and says so; nothing is said when the switch is not known.
  expect(buildMcpHandoff({ configuration: CONFIGURATION, review: false })).toContain("审查关着")
  expect(buildMcpHandoff({ configuration: CONFIGURATION, review: false })).not.toContain("await_inspection")
  expect(buildMcpHandoff({ configuration: CONFIGURATION })).not.toContain("审查开着")
  expect(buildMcpHandoff({ configuration: CONFIGURATION })).not.toContain("await_inspection")
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Nothing of the 90,000 characters is lost

/**
 * The parts of the hand-off as it was before it moved, each under the topic that now holds it. A part dropped or renamed fails here; one added
 * must be listed here with the topic that carries it. (`review`: one of the two, by the switch.)
 */
const PARTS: Record<GuideTopicId, string[]> = {
  workflow: ["workflow.duties", "workflow.pose", "workflow.environment", "workflow.call_order"],
  blueprint: ["blueprint.intro", "blueprint.ideas", "blueprint.constraints", "blueprint.tiers", "blueprint.playable", "blueprint.steps"],
  plan: ["plan.pose", "plan.modules", "plan.example"],
  review: ["review.on"],
  acceptance: ["acceptance.standard", "acceptance.draft", "acceptance.advice", "acceptance.refused"],
  making: ["making.audio", "making.intro", "making.discipline", "making.steps", "making.saveable", "making.refusals", "making.endings", "making.tail"],
  script: ["script.guide"],
  blockitem: ["blockitem.guide"],
  references: ["references.guide", "references.zoom"],
  model: ["model.art", "model.pose", "model.complexity", "model.button", "model.looked", "model.texture", "model.texture_uv"],
  creature: ["creature.abilities", "creature.entity"],
  gesture: ["gesture.cast"],
  gameplay: ["gameplay.section", "gameplay.combatDesign"],
  data: ["data.plain"],
  rules: ["rules.module", "rules.enforce", "rules.design", "rules.safety", "rules.visual"],
  tools: ["tools.server", "tools.table"],
  import: ["import.assets", "import.merge", "import.flow"],
}

test("原来 9 万字的每一段，现在都在某个主题里读得到：段落清单、每段原文、每个来源常量", () => {
  for (const review of [true, false]) {
    const all: string[] = []
    for (const topic of GUIDE_TOPIC_IDS) {
      const parts = guideSegments(topic, { review })
      const expected = topic === "review" ? [review ? "review.on" : "review.off"] : PARTS[topic]
      expect(parts.map((part) => part.id)).toEqual(expected)
      const text = guideText(topic, { review })
      parts.forEach((part) => {
        expect(part.text.trim().length).toBeGreaterThan(20)
        expect(text).toContain(part.text)
      })
      all.push(...parts.map((part) => part.id))
    }
    // Each part stands under one topic only: said once.
    expect(new Set(all).size).toBe(all.length)
  }
  // The definitions the long text was written from are each in the topic that has them.
  const read = everythingToRead({ configuration: CONFIGURATION, review: true })
  for (const original of [MAKING_DISCIPLINE, ABILITY_REVIEW_GUIDE, REFERENCE_GUIDE, SCRIPT_GUIDE, DRAWN_GUIDE, MODEL_ART_DIRECTION, GESTURE_BOUNDARY, STANDARD_SUMMARY, DATA_CAPABILITY.summary, gameplayHandoffSection("`").replaceAll("这个工程是", "此示例目标是"), INSTRUCTIONS_IMPORT, INSTRUCTIONS_MERGE, INSTRUCTIONS_TOOLS, buildAndCheckStep((name) => `\`${name}\``), REVIEW_SWITCH.maker_model, REVIEW_SWITCH.epic_models]) expect(read).toContain(original)
  CRITERIA.forEach((value, index) => expect(read).toContain(`${index + 1}. ${value.name}：${value.meaning}常见的毛病：${value.examples}改法：${value.fix}`))
  Object.values(SEVERITIES).forEach((value) => expect(read).toContain(`“${value.label}”——${value.meaning.replace(/。$/, "")}`))
  Object.values(EXCUSES).forEach((value) => expect(read).toContain(value.label))
  MCP_MAKING_REFUSALS.forEach((words) => expect(read).toContain(`- ${words}`))
  MCP_MAKING_ENDINGS.forEach((words) => expect(read).toContain(`- ${words}`))
  DATA_CAPABILITY.done.forEach((line) => expect(read).toContain(line))
  DATA_CAPABILITY.not_done.forEach((line) => expect(read).toContain(line))
  // Every tool has its row, every module its line.
  MCP_TOOLS.forEach((tool) => expect(guideText("tools")).toContain(`| \`${tool[0]}\` | ${tool[2]} | ${tool[1]} |`))
  ASSET_KINDS.forEach((kind) => expect(guideText("plan")).toContain(`| ${kind.id} | ${kind.capability} | ${kind.summary} |`))
  // Review off: the other half of the review topic is there.
  expect(guideText("review", { review: false })).toContain("核对和验收都由你自己做")
  expect(guideText("review", { review: true })).toContain("验收由另一个窗口里的审查 AI 负责")
})

test("每个主题都有一行说明何时读，领任务带的主题都是真的主题", () => {
  expect(Object.keys(GUIDE_TOPICS).sort()).toEqual([...GUIDE_TOPIC_IDS].sort())
  GUIDE_TOPIC_IDS.forEach((topic) => expect(GUIDE_TOPICS[topic].when.length).toBeGreaterThan(8))
  expect(Object.keys(CLAIM_GUIDE).sort()).toEqual(ASSET_KINDS.map((kind) => kind.id).sort())
  Object.values(CLAIM_GUIDE).forEach((topics) => topics.forEach((topic) => expect(GUIDE_TOPIC_IDS as readonly string[]).toContain(topic)))
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Read on request

test("get_guide：每个主题都取得到，不带主题列出全部；带了别的东西被拒绝；字面随审查的开关变", async () => {
  const on = await external()
  const index = (await on.call("getGuide", {})) as { topics: { id: string; title: string; when: string; characters: number }[]; how: string }
  expect(index.topics.map((topic) => topic.id)).toEqual([...GUIDE_TOPIC_IDS])
  index.topics.forEach((topic) => expect(topic.characters).toBeGreaterThan(300))
  for (const topic of GUIDE_TOPIC_IDS) {
    const got = (await on.call("getGuide", { topic })) as { topic: string; title: string; text: string }
    expect(got.topic).toBe(topic)
    expect(got.text).toBe(guideText(topic, { review: true, complexity: "medium" }))
    expect(got.text.startsWith(`# ${GUIDE_TOPICS[topic].title}（${topic}）`)).toBe(true)
  }
  expect(await on.refused("getGuide", { topic: "nothing" })).not.toBe("accepted")
  expect(await on.refused("getGuide", { topic: "making", path: "/etc" })).not.toBe("accepted")
  // The words follow the switch as it is now, not as it was when the text was copied.
  expect(((await on.call("getGuide", { topic: "review" })) as { text: string }).text).toContain("审查开着")
  const off = await external({ review: false })
  expect(((await off.call("getGuide", { topic: "review" })) as { text: string }).text).toContain("审查关着")
  expect(((await off.call("getGuide", { topic: "blueprint" })) as { text: string }).text).not.toContain("再请一个只看得到要求和条目的评审逐条核对")
})

test("工具清单、能力清单和服务器说明都告诉 AI 去哪里读；实际注册了 get_guide", async () => {
  const names = MCP_TOOLS.map((tool) => tool[0]) as string[]
  expect(names).toContain("get_guide")
  const capabilities = getMcpCapabilities("medium")
  expect(capabilities.tools.map((tool) => tool.name)).toContain("get_guide")
  expect(capabilities.guide.tool).toBe("get_guide")
  expect(capabilities.guide.active_task_source).toBe("claim_task.guide")
  expect(capabilities.guide.topics.map((topic) => topic.id)).toEqual([...GUIDE_TOPIC_IDS])
  expect(capabilities.guide.by_kind).toEqual(CLAIM_GUIDE)
  expect(MCP_SERVER_INSTRUCTIONS).toContain("claim_task 的返回里有 guide")
  expect(MCP_SERVER_INSTRUCTIONS).toContain("get_guide")
  const stdio = await readFile(fileURLToPath(new URL("../src/main/mcp-stdio.ts", import.meta.url)), "utf8")
  expect(stdio).toMatch(/registerTool\(\s*"get_guide"/)
})

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Come with the task

test("claim_task：每一类任务的返回里都带着这一类的说明，字面一个不少", async () => {
  const bench = await external()
  for (const kind of ASSET_KINDS.map((value) => value.id)) {
    // One run for each kind, so that nothing has been given before in it.
    const claimed = await (await started(bench, [{ key: kind, module: kind }])).claim(kind)
    const guide = claimed.guide
    expect(guide.kind).toBe(kind)
    expect(guide.topics).toEqual([...CLAIM_GUIDE[kind]])
    expect(guide.text, kind).toBeTruthy()
    // Every part meant for this kind is in the text, unless the claim already carries it in a field of its own. The guide names the
    // project's own targets (here the one it was made with), so the parts are worded for them too.
    const parts = claimSegments(kind, { review: true, complexity: "medium", targets: await bench.service.projectTargets(bench.projectId) })
    expect(parts.length, kind).toBeGreaterThan(0)
    for (const part of parts) {
      if (!part.same) expect(guide.text, `${kind} ${part.id}`).toContain(part.text)
    }
    // The first line of each topic says which it is.
    for (const topic of CLAIM_GUIDE[kind]) {
      if (parts.some((part) => part.topic === topic && !part.same)) expect(guide.text).toContain(`# ${GUIDE_TOPICS[topic].title}（${topic}）`)
    }
  }
}, 30000)

test("claim_task：看着做的类带着完整的做法和规矩；玩法带着代码和检查；数据类带着能做到和做不到；设计类带着不能说进游戏", async () => {
  const bench = await external()
  const claimOf = async (kind: string) => (await (await started(bench, [{ key: kind, module: kind }])).claim(kind)) as Claimed
  // A model, a texture and an animation: the loop, the script manual, the reviewer's rules, the acceptance standard; the art direction is in its own field.
  const model = await claimOf("model")
  for (const text of ["save_sheet", "self_review", "final_review", SCRIPT_GUIDE, "审查开着", "没通过验收", "每一版都用 `look` 看过再改", ...MCP_MAKING_REFUSALS]) expect(model.guide.text).toContain(text)
  // The art direction of a model is in the claim's own instructions, and said once.
  expect(model.instructions).toContain(MODEL_ART_DIRECTION)
  expect(model.guide.text).not.toContain(MODEL_ART_DIRECTION)
  expect(model.guide.also_in).toContain("instructions")
  // This Studio cannot draw previews here, so the claim has no `making` of its own: the discipline is then in the guide, not lost with the field.
  expect(model.making).toBeNull()
  expect(model.guide.text).toContain(MAKING_DISCIPLINE)
  // A block and an item: the drawing of their own picture and the data fields.
  for (const kind of ["block", "item"]) {
    const claimed = await claimOf(kind)
    expect(claimed.guide.text).toContain(DRAWN_GUIDE)
    DATA_CAPABILITY.not_done.forEach((line) => expect(claimed.guide.text).toContain(line))
  }
  // A cast action: the rule of the two ways to write it.
  expect((await claimOf("gesture")).guide.text).toContain(GESTURE_BOUNDARY)
  // Gameplay code: the whole section, with the order and the three checks, and the review.
  const gameplay = await claimOf("gameplay")
  expect(gameplay.guide.text).toContain(gameplayHandoffSection("`"))
  expect(gameplay.guide.text).toContain("审查开着")
  // The call that plays a motion of a creature's model is in the guide a gameplay task is handed, and the things it is handed say which motions a creature has.
  expect(gameplay.guide.text).toContain('ProjectContent.playMotion(creature, "动作名")')
  expect(gameplay.guide.text).toContain("things 里每只生物的 motions")
  // A creature: the entity document and what to bind; its abilities' review rule is in the claim's own making.
  const entity = await claimOf("entity")
  expect(entity.guide.text).toContain("model_asset_id 必须引用当前 workspace 的模型资产")
  expect(entity.guide.text).toContain(ABILITY_REVIEW_GUIDE)
  // A recipe and the kinds that are only design: the standard, and that design is not in the game.
  expect((await claimOf("recipe")).guide.text).toContain("没通过验收")
  for (const kind of ["worldview", "biome", "dimension", "terrain", "animation"]) expect((await claimOf(kind)).guide.text, kind).toContain("设计能力")
  // Nothing about the loop is carried by a kind it is not for.
  const worldview = await claimOf("worldview")
  expect(worldview.guide.text).not.toContain("save_sheet")
})

test("claim_task：同一批里同一类的说明只在第一次给，后面的说在哪里读；下一批重新给；开关变了重新给", async () => {
  const bench = await external()
  const first = await started(bench, [
    { key: "one", module: "item" },
    { key: "two", module: "item" },
    { key: "four", module: "gesture" },
  ])
  const one = await first.claim("one")
  expect(one.guide.text).toContain(DRAWN_GUIDE)
  // The second item in the run is told where it was given, with the topics to read again; not given the same again.
  const two = await first.claim("two")
  expect(two.guide.text).toBeNull()
  expect(two.guide.topics).toEqual([...CLAIM_GUIDE.item])
  expect(two.guide.next_step).toContain("已经给过一次")
  expect(two.guide.next_step).toContain("get_guide")
  // A cast action shares the loop and the standard with the item but has a part of its own: only what is new to the run comes with it.
  const gesture = await first.claim("four")
  expect(gesture.guide.text).toContain(GESTURE_BOUNDARY)
  expect(gesture.guide.text).not.toContain("# 看着做（making）")
  expect(gesture.guide.text).not.toContain("# 验收标准与被退回时怎么办（acceptance）")
  // The next batch is a run of its own and gets the whole of it again.
  const second = await started(bench, [{ key: "five", module: "item" }])
  expect((await second.claim("five")).guide.text).toBe(one.guide.text)
  // What the person switched changes the words, so the one that follows the switch is given again.
  const off = await external({ review: false })
  const run = await started(off, [{ key: "a", module: "item" }])
  expect((await run.claim("a")).guide.text).toContain("审查关着")
})

test("get_blueprint：还没有蓝图或蓝图还是草稿时带着规划的说明，确认以后只说去哪里读", async () => {
  const bench = await external()
  const shown = async () => (await bench.call("getBlueprint", { projectId: bench.projectId })) as unknown as { guide: { topic: string; text: string | null; next_step?: string } }
  const none = await shown()
  expect(none.guide.topic).toBe("blueprint")
  expect(none.guide.text).toBe(guideText("blueprint", { review: true, complexity: "medium" }))
  const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }
  const gem = { key: "gem", kind: "item", title: "宝石", brief: "做一颗宝石", owner: null, needs: [], out_of_scope: null }
  await bench.call("proposeBlueprint", { projectId: bench.projectId, request: "做一颗宝石", blueprint: played({ style, entries: [gem], questions: [] } as never), paper_play: PAPER })
  expect((await shown()).guide.text).toContain("蓝图优先")
  await bench.service.confirmBlueprint({ projectId: bench.projectId, revision: 1 })
  const confirmed = await shown()
  expect(confirmed.guide.text).toBeNull()
  expect(confirmed.guide.next_step).toContain("get_guide")
})

test("claim_task：领取时已经在自己字段里带着的话不重复；字段里没有就留在说明里", () => {
  const service = {}
  const wording = { review: true, complexity: "medium" as const }
  // A model claim whose instructions hold the art direction and whose `making` holds the discipline: neither is said twice, and the guide says where they are.
  const whole = taskGuide(service, "run-1", { instructions: `${MODEL_ART_DIRECTION} 其余`, making: { discipline: MAKING_DISCIPLINE, sheet: null, remark: null, rounds_allowed: 6, next_step: "", reference_guide: REFERENCE_GUIDE } }, "model", wording)
  expect(whole.text).not.toContain(MODEL_ART_DIRECTION)
  expect(whole.text).not.toContain(MAKING_DISCIPLINE)
  expect(whole.also_in).toEqual(expect.arrayContaining(["instructions", "making.discipline"]))
  // The same claim without them: the words come in the guide.
  const bare = taskGuide(service, "run-2", { instructions: "别的话", making: null }, "model", wording)
  expect(bare.text).toContain(MODEL_ART_DIRECTION)
  expect(bare.text).toContain(MAKING_DISCIPLINE)
  // (The detail range of a model is the one in the task's own instructions, whatever the button says: the guide never carries a second one.)
  expect(bare.also_in).toEqual(["instructions"])
  // What a field holds that is not the words (an instruction that names other things) does not stand for them.
  expect(taskGuide(service, "run-3", { instructions: "别的话", making: { discipline: "别的纪律", sheet: null, remark: null, rounds_allowed: 6, next_step: "" } }, "model", wording).text).toContain(MAKING_DISCIPLINE)
})

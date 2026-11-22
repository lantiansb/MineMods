import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createProject, openProject, storagePath, withProjectLock } from "@minemods/mod-core/project"
import { createBlueprintService } from "../src/main/blueprint-service"
import { createProjectRunner } from "../src/main/project-runner"
import { exportProjectArchive, importProjectArchive } from "@minemods/mod-core/container"
import { REFUSAL_CAP, justifyTail } from "@minemods/mod-core/acceptance"
import { startJob, updateJob } from "@minemods/mod-core/jobs"
import { assembleBuildSource } from "@minemods/mod-core/build"
import { blueprintPlannerInstructions } from "@minemods/mod-core/blueprint-planner"
import { CONSTRAINT_EXTRACT_INSTRUCTIONS } from "@minemods/mod-core/blueprint-constraints"
import { BLUEPRINT_ATTEMPTS } from "@minemods/mod-core/blueprint-production"
import { PROJECT_RUN_LIMITS } from "@minemods/mod-core/workspace-runs"
import type { BlueprintDraft, BlueprintPlan } from "@minemods/mod-core/blueprint"
import { z } from "zod"
import { createStudioService, dispatchStudioRequest, plainContent, publicError } from "../src/main/service"
import { dispatchExternal, externalError } from "../src/main/external-dispatch"
import { StudioRequestSchema } from "../src/main/protocol"
import { ExternalBridgeRequestSchema, type ExternalStartResult } from "../src/external"
import { MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { startChatOnlyProvider } from "./fixtures/chat-only-provider"
import { PAPER, played } from "./playable-fixture"
import { PAPER_PLAY_INSTRUCTIONS, PAPER_UNREACHED } from "@minemods/mod-core/playable"

type Service = Awaited<ReturnType<typeof createStudioService>>
// What Studio sends for one module task. A planner request carries none of these and is never read this way.
type Asked = {
  instructions: string
  input: {
    task: { key: string; module: string; title: string }
    prompt: string
    dependency_results: { id: string; document: { identifier: string } }[]
    revision_required?: unknown
  }
}

const directories: string[] = []
const services: Service[] = []
const closers: (() => void)[] = []

afterEach(async () => {
  closers.splice(0).forEach((close) => close())
  await Promise.all(services.splice(0).map((service) => service.dispose()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function workspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "studio-blueprint-"))
  directories.push(directory)
  return directory
}

async function studio(directory: string, ai: Record<string, unknown>) {
  const service = await createStudioService({
    workspaceDirectory: path.join(directory, "projects"),
    runtimeDirectory: path.join(directory, "runtime"),
    templateDirectory: path.join(directory, "templates"),
    ai: {review:true,...ai},
  })
  services.push(service)
  return service
}

/** A stand-in for the AI service. `reply` sees what Studio asked and returns the document, or a Response to send as it is. */
function responder(reply: (asked: Asked) => unknown) {
  const asked: Asked[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const body = JSON.parse(await request.text()) as { instructions: string; input: { content: { text: string }[] }[] }
      const call = { instructions: body.instructions, input: JSON.parse(body.input[0]!.content[0]!.text) as Asked["input"] }
      asked.push(call)
      const value = await reply(call)
      return value instanceof Response
        ? value
        : Response.json({
            model: "gpt-6-astra",
            status: "completed",
            output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
          })
    },
  })
  closers.push(() => server.stop(true))
  // No wait between the tries of a request that failed (`AUTHORING_RETRY`): a test of a provider that is down stays fast.
  return { asked, ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1`, retryWait: [0, 0] } }
}

const style = { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }
const entry = (key: string, kind: string, needs: string[] = [], extra: Record<string, unknown> = {}) =>
  ({ key, kind, title: `${key} 标题`, brief: `做一个 ${key}`, owner: null, needs, out_of_scope: null, ...extra }) as BlueprintPlan["entries"][number]
// Every thing answers the playable standard's questions plainly: these tests are about the pipeline, `playable.test.ts` is about the standard.
const plan = (entries: BlueprintPlan["entries"], questions: string[] = []): BlueprintPlan => played({ style, entries, questions })
const draft = (request: string, entries: BlueprintPlan["entries"]): BlueprintDraft => ({ request, ...plan(entries) })
// Held shut until the test opens it, to keep an AI reply waiting.
function gate() {
  const latch = { open: () => {} }
  return { closed: new Promise<void>((resolve) => Object.assign(latch, { open: resolve })), open: () => latch.open() }
}

// What a module AI would return for a task: an item, or a recipe that uses whatever it was handed.
function document(asked: Asked) {
  const task = asked.input.task
  if (task.module === "item") return { kind: "item", identifier: task.key, name: task.title, max_stack: 16, color: "#99ccff", texture: null }
  return { kind: "recipe", name: task.title, pattern: [`pipeline:${asked.input.dependency_results[0]!.document.identifier}`, null, null, null, null, null, null, null, null], result: "minecraft:stick", count: 1 }
}

async function confirmed(service: Service, entries: BlueprintPlan["entries"]) {
  const created = await service.createProject({ name: "蓝图流水线", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  await service.saveBlueprint({ projectId, revision: 0, blueprint: draft("做一套矿物和配方", entries) })
  await service.confirmBlueprint({ projectId, revision: 1 })
  return { projectId, directory: created.directory }
}

async function finished(service: Service, projectId: string, jobId: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const job = await service.getJob({ projectId, jobId })
    if (["completed", "failed", "canceled", "interrupted"].includes(job.state)) return job
    await Bun.sleep(10)
  }
  throw new Error("job did not finish")
}

test("一句话生成蓝图：规则不通过时带着原因改一次，存成草稿，修订号和关联由应用分配", async () => {
  const wrong = plan([entry("fox", "entity"), entry("ride", "logic", [], { out_of_scope: "目前做不了骑乘" })])
  const right = plan([entry("fox_model", "model", [], { owner: "fox" }), entry("fox", "entity", ["fox_model"]), entry("ride", "logic", [], { out_of_scope: "目前做不了骑乘" })], ["狐狸会攻击玩家吗？"])
  // A provider that only speaks Chat Completions: no strict schema, no Responses route, replies wrapped in prose.
  // The first request only quotes the person's requirements; this sentence has none.
  const provider = await startChatOnlyProvider((call) =>
    call.body.messages[0].content.startsWith(CONSTRAINT_EXTRACT_INSTRUCTIONS) ? { constraints: [] } : call.body.messages[0].content.startsWith(PAPER_PLAY_INSTRUCTIONS) ? { findings: [], advice: [] } : JSON.parse(call.body.messages[1].content).revision_required ? right : wrong,
  )
  closers.push(provider.close)
  const service = await studio(await workspace(), { apiKey: "private-key", baseUrl: provider.baseUrl, model: "qwen-plus" })
  const created = await service.createProject({ name: "狐狸模组", description: "", empty: true })
  const projectId = created.project.id
  expect(await service.getBlueprint({ projectId })).toBeNull()

  const { jobId } = await service.draftBlueprint({ projectId, request: "做一只能骑的狐狸" })
  expect((await finished(service, projectId, jobId)).state).toBe("completed")
  // Leave out the probes this provider turned down: the Responses route and the strict-schema request.
  const chats = provider.calls.filter((call) => call.path === "/v1/chat/completions" && call.body.response_format?.type !== "json_schema")
  // Quote the requirements, plan, plan again with the reason, and one paper play-through of the plan that passed.
  expect(chats).toHaveLength(4)
  expect(chats[3]!.body.messages[0].content).toStartWith(PAPER_PLAY_INSTRUCTIONS)
  expect(JSON.parse(chats[0]!.body.messages[1].content)).toEqual({ request: "做一只能骑的狐狸" })
  expect(chats[1]!.body.messages[0].content).toStartWith(blueprintPlannerInstructions("fabric-1.21.1"))
  expect(JSON.parse(chats[1]!.body.messages[1].content)).toMatchObject({ request: "做一只能骑的狐狸", current: null })
  // No requirement was stated, so the planner is told of none and nobody is asked to compare.
  expect(JSON.parse(chats[1]!.body.messages[1].content).constraints).toBeUndefined()
  expect(JSON.parse(chats[2]!.body.messages[1].content).revision_required).toEqual({
    blueprint: wrong,
    issues: [{ code: "blueprint_rule", message: "「fox 标题」是生物，必须依赖一个模型条目。" }],
  })
  const blueprint = (await service.getBlueprint({ projectId }))!
  expect(blueprint).toMatchObject({ revision: 1, state: "draft", request: "做一只能骑的狐狸", style, questions: ["狐狸会攻击玩家吗？"] })
  expect(blueprint.entries.map((value) => [value.key, value.asset_id, value.out_of_scope])).toEqual([["fox_model", null, null], ["fox", null, null], ["ride", null, "目前做不了骑乘"]])
  expect((await service.getProjectOverview({ projectId })).items.map((item) => item.status)).toEqual(["planned", "planned", "out_of_scope"])
})

test("改了一次还是不对就失败：用大白话说明原因，不留下半成品蓝图", async () => {
  const fake = responder((asked) => (asked.instructions.startsWith(CONSTRAINT_EXTRACT_INSTRUCTIONS) ? { constraints: [] } : plan([entry("fox", "entity")])))
  const service = await studio(await workspace(), fake.ai)
  const projectId = (await service.createProject({ name: "失败的蓝图", description: "", empty: true })).project.id
  const job = await finished(service, projectId, (await service.draftBlueprint({ projectId, request: "做一只狐狸" })).jobId)
  expect(job.state).toBe("failed")
  expect(job.error).toBe("AI 给出的蓝图有问题，改了一次还是不对：「fox 标题」是生物，还缺一个它要用到的模型。请把想法说得更具体一些，再试一次。")
  expect(fake.asked).toHaveLength(3)
  expect(await service.getBlueprint({ projectId })).toBeNull()
  const offline = await studio(await workspace(), {})
  const other = (await offline.createProject({ name: "没有连接", description: "", empty: true })).project.id
  expect(publicError(await offline.draftBlueprint({ projectId: other, request: "做一只狐狸" }).catch((error: unknown) => error))).toBe("还没有连接 AI。请先在设置里填好 AI 连接，再生成蓝图。")
})

test("用户改蓝图要对上修订号并回到草稿；确认只认屏幕上那一版；可以丢弃", async () => {
  const service = await studio(await workspace(), {})
  const projectId = (await service.createProject({ name: "手改蓝图", description: "", empty: true })).project.id
  const two = draft("做两样东西", [entry("gem", "item"), entry("coin", "item")])
  const first = await service.saveBlueprint({ projectId, revision: 0, blueprint: two })
  expect(first).toMatchObject({ revision: 1, state: "draft" })
  expect(publicError(await service.saveBlueprint({ projectId, revision: 0, blueprint: two }).catch((error: unknown) => error))).toBe("AI 刚改过这一样，你看到的是改之前的。")
  expect(publicError(await service.startBlueprintProduction({ projectId }).catch((error: unknown) => error))).toContain("还没有连接 AI")
  const confirmed = await service.confirmBlueprint({ projectId, revision: 1 })
  expect(confirmed).toMatchObject({ revision: 1, state: "confirmed" })
  // Removing an entry and renaming another is a new revision, and a draft again.
  const edited = await service.saveBlueprint({ projectId, revision: 1, blueprint: draft("做两样东西", [entry("gem", "item", [], { title: "红宝石" })]) })
  expect(edited).toMatchObject({ revision: 2, state: "draft" })
  expect(edited.entries.map((value) => value.title)).toEqual(["红宝石"])
  expect(publicError(await service.confirmBlueprint({ projectId, revision: 1 }).catch((error: unknown) => error))).toBe("别处刚改过蓝图，已为你刷新。请看一眼再确认。")
  expect(publicError(await service.saveBlueprint({ projectId, revision: 2, blueprint: draft("做", [entry("fox", "entity")]) }).catch((error: unknown) => error))).toBe("「fox 标题」是生物，还缺一个它要用到的模型。")
  expect((await service.getBlueprint({ projectId }))!.revision).toBe(2)
  expect(await service.discardBlueprint({ projectId })).toBeNull()
  expect(await service.getBlueprint({ projectId })).toBeNull()
  expect((await service.getProjectOverview({ projectId })).blueprint).toBeNull()
})

test("新接口走严格的 IPC 校验，确认蓝图不在外部 AI 能调用的范围内", async () => {
  const projectId = crypto.randomUUID()
  const accepts = (method: string, input: unknown) => StudioRequestSchema.safeParse({ method, input }).success
  expect(accepts("draftBlueprint", { projectId, request: "做一只狐狸" })).toBe(true)
  expect(accepts("draftBlueprint", { projectId, request: "  " })).toBe(false)
  expect(accepts("draftBlueprint", { projectId, request: "字".repeat(20001) })).toBe(false)
  expect(accepts("saveBlueprint", { projectId, revision: 1, blueprint: { request: "做", ...plan([entry("gem", "item")]) } })).toBe(true)
  expect(accepts("saveBlueprint", { projectId, revision: 1, blueprint: { request: "做", style, questions: [], entries: [{ ...entry("gem", "item"), asset_id: projectId }] } })).toBe(false)
  expect(accepts("saveBlueprint", { projectId, revision: 1, blueprint: { request: "做", ...plan([entry("gem", "item")]), state: "confirmed" } })).toBe(false)
  expect(accepts("confirmBlueprint", { projectId, revision: 1 })).toBe(true)
  expect(accepts("confirmBlueprint", { projectId, revision: 0 })).toBe(false)
  expect(accepts("getAssetUsage", { projectId, assetId: "../secret" })).toBe(false)
  ;["getBlueprint", "discardBlueprint", "startBlueprintProduction", "stopBlueprintProduction", "getProjectOverview"].forEach((method) => {
    expect(accepts(method, { projectId })).toBe(true)
    expect(accepts(method, { projectId, path: "C:/private" })).toBe(false)
  })
  expect(ExternalBridgeRequestSchema.safeParse({ method: "confirmBlueprint", input: { projectId, revision: 1 } }).success).toBe(false)
  expect(MCP_TOOLS.map((tool) => tool[0]).filter((name) => /blueprint|batch|ideas/.test(name))).toEqual(["get_blueprint", "propose_blueprint", "propose_ideas", "get_ideas", "await_blueprint_decision", "next_batch"])
  // Choosing among idea cards is the person's, like confirming: the app has it, no outside tool does.
  expect(MCP_TOOLS.some((tool) => /choose|pick|answer|lift/.test(tool[0]))).toBe(false)
  expect(MCP_TOOLS.some((tool) => /confirm/.test(tool[0]))).toBe(false)
})

test("直连 AI 制作：分两批，后一批拿到前一批做好的内容，全部保存后自己停下", async () => {
  const fake = responder(document)
  const service = await studio(await workspace(), fake.ai)
  // Twelve items fill the first batch; the recipe that uses the first of them has to wait for the second.
  const items = Array.from({ length: PROJECT_RUN_LIMITS.tasks }, (_, index) => entry(`gem_${index}`, "item"))
  const { projectId, directory } = await confirmed(service, [...items, entry("kit", "recipe", ["gem_0"])])
  const started = await service.startBlueprintProduction({ projectId })
  expect(started.production).toMatchObject({ running: true, total: 13 })
  // Starting twice does not start a second line of work.
  expect((await service.startBlueprintProduction({ projectId })).production.running).toBe(true)
  await service.blueprints.idle(projectId)

  const runs = (await service.listProjectRuns({ projectId })).reverse()
  expect(runs.map((run) => [run.state, run.tasks.length])).toEqual([["completed", 12], ["completed", 1]])
  expect(runs[0]!.tasks.every((task) => task.source === `blueprint:${task.key}`)).toBe(true)
  expect(runs[1]!.tasks[0]).toMatchObject({ key: "kit", dependencies: [], state: "completed" })
  const project = await openProject(directory)
  const gem = project.blueprint!.entries.find((value) => value.key === "gem_0")!.asset_id!
  const kit = fake.asked.find((value) => value.input.task.key === "kit")!
  expect(kit.input.dependency_results.map((value) => value.id)).toEqual([gem])
  expect(kit.input.prompt).toContain(`已经做好、可以直接引用的内容：\n物品「gem_0 标题」，资产 ID ${gem}`)
  expect(kit.input.prompt).toContain("造型：圆润")
  expect(project.recipes[0]!.pattern[0]).toBe("pipeline:gem_0")
  expect(project.blueprint!.entries.every((value) => value.asset_id !== null)).toBe(true)
  expect(fake.asked).toHaveLength(13)

  const overview = await service.getProjectOverview({ projectId })
  expect(overview.production).toEqual({ running: false, total: 13, saved: 13, built: 0, verified: 0, making: 0, queued: 0, queued_again: 0, remaking: 0, unsatisfied: 0, interrupted: 0, done: 13, accepted: 0, to_review: 13, to_redo: 0, failed: 0, blocked: 0, current: [], note: null })
  expect(overview.items.find((item) => item.id === "kit")).toMatchObject({ status: "review", status_label: "等你验收", review_asked: true, needs: ["gem_0"], facts: { saved: true, built: false, gametest: null, client: null, accepted: null } })
  // Nothing is left, so asking again starts nothing.
  expect((await service.startBlueprintProduction({ projectId })).production.running).toBe(false)
  expect(await service.listProjectRuns({ projectId })).toHaveLength(2)
})

test("失败的条目只再试一次：之后保持失败并留下原因，依赖它的显示被卡住，其余照常做完", async () => {
  const tries: Record<string, number> = {}
  const fixed = { gem: false }
  const fake = responder((asked) => {
    const key = asked.input.task.key
    // A repair turn inside one try is still the same try, so tries are counted from the run records below.
    tries[key] = (tries[key] ?? 0) + (asked.input.revision_required ? 0 : 1)
    // `gem` never comes out right; `ore` does on its second try.
    if ((key === "gem" && !fixed.gem) || (key === "ore" && tries.ore === 1)) return new Response("{}", { status: 401 })
    return document(asked)
  })
  const service = await studio(await workspace(), fake.ai)
  const { projectId, directory } = await confirmed(service, [entry("gem", "item"), entry("ring", "recipe", ["gem"]), entry("ore", "item"), entry("bar", "recipe", ["ore"]), entry("coin", "item")])
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)

  const runs = (await service.listProjectRuns({ projectId })).reverse()
  const states = (run: (typeof runs)[number]) => Object.fromEntries(run.tasks.map((task) => [task.key, task.state]))
  expect(runs).toHaveLength(BLUEPRINT_ATTEMPTS)
  expect(states(runs[0]!)).toEqual({ gem: "failed", ring: "blocked", ore: "failed", bar: "blocked", coin: "completed" })
  expect(states(runs[1]!)).toEqual({ gem: "failed", ring: "blocked", ore: "completed", bar: "completed" })
  expect(tries).toMatchObject({ gem: 2, ore: 2, coin: 1 })

  const overview = await service.getProjectOverview({ projectId })
  const row = (id: string) => overview.items.find((item) => item.id === id)!
  expect(overview.items.map((item) => [item.id, item.status])).toEqual([["gem", "failed"], ["ring", "blocked"], ["ore", "review"], ["bar", "review"], ["coin", "review"]])
  expect(row("gem")).toMatchObject({ status_label: "没做成", facts: { saved: false } })
  expect(row("gem").reason).toBeTruthy()
  expect(row("ring")).toMatchObject({ status_label: "被卡住", reason: "要先做好「gem 标题」，但它没有做成。" })
  expect(overview.production).toMatchObject({ running: false, total: 5, saved: 3, failed: 1, blocked: 1 })
  expect(overview.problems).toEqual([{ item: "ring", kind: "blocked", message: "「ring 标题」要先做好「gem 标题」，但它没有做成。" }])
  // Pressing start again does not keep hammering at what has failed for good.
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  expect(await service.listProjectRuns({ projectId })).toHaveLength(BLUEPRINT_ATTEMPTS)
  expect((await openProject(directory)).items.map((item) => item.identifier).sort()).toEqual(["coin", "ore"])
  // Confirming the plan again is the person's way of saying "try those once more": nothing is blocked any longer.
  await service.confirmBlueprint({ projectId, revision: 1 })
  expect((await service.getProjectOverview({ projectId })).items.map((item) => item.status)).toEqual(["failed", "planned", "review", "review", "review"])
  fixed.gem = true
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  expect((await service.getProjectOverview({ projectId })).production).toMatchObject({ running: false, saved: 5, failed: 0, blocked: 0 })
  expect(await service.listProjectRuns({ projectId })).toHaveLength(BLUEPRINT_ATTEMPTS + 1)
})

test("重启后继续：做完的不重做，被打断的不算失败，再点一次从剩下的接着做", async () => {
  const directory = await workspace()
  // `gem` hangs as if the app were closed in the middle of it.
  const hung = gate()
  closers.push(hung.open)
  const before = responder(async (asked) => {
    if (asked.input.task.key === "gem") await hung.closed
    return document(asked)
  })
  const first = await studio(directory, before.ai)
  const { projectId } = await confirmed(first, [entry("coin", "item"), entry("gem", "item"), entry("ring", "recipe", ["gem"])])
  await first.startBlueprintProduction({ projectId })
  for (let attempt = 0; attempt < 400 && (await first.getProjectOverview({ projectId })).production.saved < 1; attempt += 1) await Bun.sleep(10)
  expect((await first.getProjectOverview({ projectId })).production).toMatchObject({ running: true, saved: 1, current: ["gem 标题"] })
  await first.dispose()
  services.splice(services.indexOf(first), 1)

  const after = responder(document)
  const second = await studio(directory, after.ai)
  const reopened = await second.getProjectOverview({ projectId })
  expect(reopened.production).toMatchObject({ running: false, total: 3, saved: 1, failed: 0, blocked: 0 })
  expect(reopened.items.map((item) => [item.id, item.status])).toEqual([["coin", "review"], ["gem", "planned"], ["ring", "planned"]])
  expect((await second.listProjectRuns({ projectId })).map((run) => run.state)).toEqual(["interrupted"])

  expect((await second.startBlueprintProduction({ projectId })).production.running).toBe(true)
  await second.blueprints.idle(projectId)
  expect(after.asked.map((asked) => asked.input.task.key)).toEqual(["gem", "ring"])
  expect((await second.getProjectOverview({ projectId })).production).toMatchObject({ running: false, saved: 3, failed: 0, blocked: 0 })
})

test("停止：正在做的做完，还没开始的不再开始，之后可以接着做", async () => {
  const held = gate()
  closers.push(held.open)
  const fake = responder(async (asked) => {
    await held.closed
    return document(asked)
  })
  const service = await studio(await workspace(), fake.ai)
  const { projectId } = await confirmed(service, ["a", "b", "c", "d", "e"].map((key) => entry(`gem_${key}`, "item")))
  await service.startBlueprintProduction({ projectId })
  for (let attempt = 0; attempt < 400 && fake.asked.length < PROJECT_RUN_LIMITS.parallel; attempt += 1) await Bun.sleep(10)
  expect((await service.stopBlueprintProduction({ projectId })).production.running).toBe(true)
  expect(publicError(await service.saveBlueprint({ projectId, revision: 1, blueprint: draft("改", [entry("x", "item")]) }).catch((error: unknown) => error)))
    .toBe("正在制作内容，请等这一批做完或者先停止，再修改蓝图。")
  held.open()
  await service.blueprints.idle(projectId)
  const run = (await service.listProjectRuns({ projectId }))[0]!
  expect(run.state).toBe("canceled")
  expect(run.tasks.map((task) => task.state)).toEqual(["completed", "completed", "completed", "canceled", "canceled"])
  expect(fake.asked).toHaveLength(PROJECT_RUN_LIMITS.parallel)
  expect((await service.getProjectOverview({ projectId })).production).toMatchObject({ running: false, saved: 3, failed: 0 })
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  expect((await service.getProjectOverview({ projectId })).production).toMatchObject({ running: false, saved: 5 })
})

test("外部 AI：提交蓝图只是草稿，用户确认前 next_batch 被拒，确认后和直连走同一套分批", async () => {
  const service = await studio(await workspace(), { mode: "mcp" })
  const created = await service.createProject({ name: "外部蓝图", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const refused = (method: string, input: unknown) => call(method, input).then(() => "accepted", publicError)

  const empty = (await call("getBlueprint", { projectId })) as unknown as { blueprint: unknown; planner: { instructions: string; schema: { properties: object } } }
  expect(empty.blueprint).toBeNull()
  expect(empty.planner.instructions).toBe(blueprintPlannerInstructions("fabric-1.21.1"))
  expect(Object.keys(empty.planner.schema.properties).sort()).toEqual(["entries", "honours", "questions", "style"])

  // The same rules as Studio's own planner, with the reason handed back so the AI can correct itself.
  expect(await refused("proposeBlueprint", { projectId, request: "做一只狐狸", blueprint: plan([entry("fox", "entity")]) })).toBe("「fox 标题」是生物，必须依赖一个模型条目。")
  expect(await refused("proposeBlueprint", { projectId, request: "做", blueprint: { ...plan([entry("gem", "item")]), state: "confirmed" } })).toContain("结构校验失败")
  const proposed = (await call("proposeBlueprint", {
    projectId,
    request: "做一套矿物和配方",
    blueprint: plan([entry("gem", "item"), entry("ring", "recipe", ["gem"]), entry("lore", "worldview", [], { out_of_scope: "只能存成设计稿" })]),
    paper_play: PAPER,
    provenance: { client: "test-client", verified: false },
  })) as { blueprint: { revision: number; state: string }; confirmed: boolean }
  expect(proposed).toMatchObject({ blueprint: { revision: 1, state: "draft" }, confirmed: false })
  expect(await refused("nextBatch", { projectId })).toBe("蓝图还没有确认。请先在 MineMods Studio 里查看并确认蓝图，再开始制作。")
  // No way round: the bridge has no such method, and Studio's own making is off while an outside AI is in charge.
  expect(await refused("confirmBlueprint", { projectId, revision: 1 })).not.toBe("accepted")
  expect((await openProject(created.directory)).blueprint!.state).toBe("draft")
  expect(publicError(await service.startBlueprintProduction({ projectId }).catch((error: unknown) => error))).toContain("现在由外部 AI 负责制作")

  // The person confirms in the app: the only path is Studio's own IPC.
  await dispatchStudioRequest(service, { method: "confirmBlueprint", input: { projectId, revision: 1 } })
  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult & { production: { running: boolean; total: number } }
  expect(batch.run.state).toBe("running")
  expect(batch.production).toMatchObject({ running: true, total: 2 })
  expect(batch.tasks.map((value) => [value.task.key, value.task.source, value.dependencies])).toEqual([["gem", "blueprint:gem", []], ["ring", "blueprint:ring", ["gem"]]])
  expect(Object.keys(batch.tasks[0]!).sort()).toEqual(["dependencies", "schema", "task"])
  // The tasks that can start now are named, with the instruction to claim them all in one turn; the one that waits says for what.
  const steer = batch as unknown as { parallel: { limit: number; free: number; ready_now: { key: string; task_id: string }[]; waiting: { key: string; waits_for: string[] }[] }; next_step: string }
  expect(steer.parallel).toMatchObject({ limit: PROJECT_RUN_LIMITS.parallel, free: PROJECT_RUN_LIMITS.parallel, ready_now: [{ key: "gem", task_id: batch.tasks[0]!.task.id }], waiting: [{ key: "ring", waits_for: ["gem 标题"] }] })
  expect(steer.next_step).toContain("马上把它们全部领下来：在同一轮里同时调用 1 次 claim_task")
  expect(steer.next_step).toContain("去做另一个已经领了的任务")
  expect(steer.next_step).toContain("「ring 标题」要等别的任务提交以后才能领")
  // Refused with the call that is right for this batch as it stands (claim what can be claimed), never with a bare "wait" or next_batch again.
  const early = await refused("nextBatch", { projectId })
  expect(early).toContain(`上一批内容还没有做完（运行 ${batch.run.id}），现在不能领下一批。`)
  expect(early).toContain("claim_task")
  expect(early).toContain("「gem 标题」")
  expect(await refused("proposeBlueprint", { projectId, request: "改主意了", blueprint: plan([entry("gem", "item")]) })).toBe("正在制作内容，请等这一批做完或者先停止，再修改蓝图。")

  // From here on it is the flow an outside AI already knows.
  const ids = (index: number) => ({ projectId, runId: batch.run.id, taskId: batch.tasks[index]!.task.id })
  // A claim before what it needs is saved says which tasks it waits for and what to claim instead.
  expect(await refused("claimExternalTask", ids(1))).toBe("「ring 标题」要等「gem 标题」提交保存以后才能领（做它要用到那些东西存好的样子）。现在能领的是：「gem 标题」，先领它们。")
  const claimed = (await call("claimExternalTask", ids(0))) as { instructions: string; quality: { standard: string; existing: unknown }; parallel: { claimed: { key: string }[]; ready_now: unknown[]; next_step: string } }
  expect(claimed.parallel).toMatchObject({ claimed: [{ key: "gem" }], ready_now: [] })
  expect(claimed.parallel.next_step).toContain("手上还有 1 个在做：「gem 标题」")
  expect(claimed.quality).toMatchObject({ existing: null })
  expect(claimed.instructions).toContain(claimed.quality.standard)
  // What crosses to the outside AI about a draft is the verdict in words: the criterion by name, what was found, what to
  // change. Not the numbers behind it and not the names of the rules.
  const noisy = { kind: "item", identifier: "gem", name: "宝石", max_stack: 16, color: "#99ccff", texture: (await Bun.file(new URL("../../mod-core/test/fixtures/acceptance/bad/static-item.json", import.meta.url)).json()).document.texture as string }
  const drafted = (await call("updateExternalTask", { ...ids(0), progress: 50, draft: noisy })) as unknown as { drafts: Record<string, { quality: Record<string, unknown> }> }
  const shown = drafted.drafts[ids(0).taskId]!.quality
  const wire = JSON.stringify(shown)
  expect(Object.keys(shown).sort()).toEqual(["criteria", "findings", "kind", "level", "passed", "spared", "text", "unreadable"])
  expect(shown).toMatchObject({ kind: "item", passed: false, findings: [{ criterion: "不机械", severity: "硬伤", message: expect.stringContaining("孤立的杂点"), fix: expect.stringContaining("成块的深浅") }] })
  expect(shown.text).toMatch(/^1\. 【不机械】/)
  // The one name that is told is the one a legitimate subject answers with (`justifyTail`: a speckled subject has a legal way out); no other, and no measurement.
  const tail = JSON.stringify(justifyTail("noisy_texture")).slice(1, -1)
  expect(wire).toContain(tail)
  expect(wire.replaceAll(tail, "")).not.toMatch(/noisy_texture|speckShare|opaqueShare|"measured"|"rule"/)
  expect(JSON.stringify(((await call("getExternalProgress", { projectId, runId: batch.run.id })) as unknown as typeof drafted).drafts[ids(0).taskId]!.quality)).toBe(wire)
  // The refusal itself crosses word for word.
  expect(await refused("commitExternalTask", { ...ids(0), document: noisy })).toMatch(/^物品没通过验收，工程里什么都没有改动。必须逐条改掉：1\. 【不机械】物品图标的图上到处是孤立的杂点.+（还可以再交 3 次） 改完用 update_task 交草稿/)
  // Saving the gem frees the ring: the answer to the commit says so, without a second look at the run.
  const freed = (await call("commitExternalTask", { ...ids(0), document: { kind: "item", identifier: "gem", name: "宝石", max_stack: 16, color: "#99ccff", texture: null } })) as unknown as { parallel: { ready_now: { key: string }[]; next_step: string } }
  expect(freed.parallel.ready_now.map((value) => value.key)).toEqual(["ring"])
  expect(freed.parallel.next_step).toContain("这些任务已经能领：「ring 标题」")
  const context = (await call("claimExternalTask", ids(1))) as { dependency_results: { title: string }[] }
  expect(context.dependency_results.map((value) => value.title)).toEqual(["gem 标题"])
  await call("commitExternalTask", { ...ids(1), document: { kind: "recipe", name: "戒指", pattern: ["pipeline:gem", null, null, null, null, null, null, null, null], result: "minecraft:stick", count: 1 } })

  const done = (await call("nextBatch", { projectId })) as { run: unknown; tasks: unknown[]; production: Record<string, unknown> }
  expect(done).toMatchObject({ run: null, tasks: [], production: { running: false, total: 2, saved: 2, failed: 0, blocked: 0 } })
  const status = (await call("getBlueprint", { projectId })) as { blueprint: { state: string }; entries: { id: string; status: string }[] }
  expect(status.blueprint.state).toBe("confirmed")
  expect(status.entries.map((value) => [value.id, value.status])).toEqual([["gem", "review"], ["ring", "review"], ["lore", "out_of_scope"]])
  expect((await service.listProjectRuns({ projectId })).map((run) => run.state)).toEqual(["completed"])
})

test("交接说明和能力清单带上蓝图流程；协议版本不变", () => {
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  expect(handoff).toContain("先 propose_blueprint → 请用户在 Studio 里确认，自己用 await_blueprint_decision 在这一轮里等他 → 确认了就马上 next_batch，反复到完成")
  expect(handoff).toContain("确认只能由用户在应用里完成，没有任何工具可以代替")
  expect(handoff).toContain(`一共最多 ${BLUEPRINT_ATTEMPTS} 次`)
  expect(handoff).toContain(`## ${MCP_TOOLS.length} 个工具`)
  ;["get_blueprint", "propose_blueprint", "next_batch", "plan_run"].forEach((name) => expect(handoff).toContain(`| \`${name}\` |`))
  const capabilities = getMcpCapabilities("medium")
  expect(capabilities.protocol_version).toBe(1)
  expect(capabilities.blueprint_workflow).toEqual(["get_blueprint", "propose_blueprint", "await_blueprint_decision", "next_batch", "claim_task", "update_task", "commit_task"])
  expect(capabilities.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["get_blueprint", "propose_blueprint", "next_batch", "plan_run"]))
  capabilities.blueprint_workflow.forEach((name) => expect(capabilities.tools.some((tool) => tool.name === name)).toBe(true))
})

test("没有蓝图的工程也有总览：手工建的生物列出来，缺模型如实提示，可以查谁在用", async () => {
  const service = await studio(await workspace(), {})
  const created = await service.createProject({ name: "老工程", description: "一只手工生物" })
  const projectId = created.project.id
  const creature = created.project.entities[0]!
  const overview = await service.getProjectOverview({ projectId })
  expect(overview.blueprint).toBeNull()
  // A creature with no model is not done: it cannot go into the mod, so the overview does not count it as saved.
  expect(overview.production).toEqual({ running: false, total: 1, saved: 0, built: 0, verified: 0, making: 0, queued: 0, queued_again: 0, remaking: 0, unsatisfied: 0, interrupted: 0, done: 0, accepted: 0, to_review: 0, to_redo: 0, failed: 0, blocked: 0, current: [], note: null })
  expect(overview.items).toEqual([
    {
      id: `entity:${creature.id}`, key: null, asset_id: null, kind: "entity", title: creature.name, brief: "一只手工生物", owner: null,
      status: "planned", status_label: "还没做", reason: `「${creature.name}」还没有模型：生物要先有模型，才能做进模组。`, facts: { saved: false, built: false, gametest: null, client: null, accepted: null }, review_asked: false,
      review: null, preview: { source: "content", model_asset_id: null, texture_asset_id: null, entity_id: null },
      needs: [], used_by: [], out_of_scope: null, revision: null,
    },
  ])
  expect(overview.problems).toEqual([{ item: `entity:${creature.id}`, kind: "missing_reference", message: `「${creature.name}」还缺一个模型。` }])
  expect(overview.kinds.map((kind) => kind.id)).toContain("entity")
  expect(overview.kinds.find((kind) => kind.id === "animation")).toMatchObject({ label: "动画", group: { id: "look", label: "外观" }, owner: false, capability: "design" })
  expect(await service.getAssetUsage({ projectId, assetId: creature.id })).toMatchObject({ item: `entity:${creature.id}`, used_by: [], message: `没有其他内容在用「${creature.name}」，可以放心删除。` })
  expect(publicError(await service.getAssetUsage({ projectId, assetId: crypto.randomUUID() }).catch((error: unknown) => error))).toBe("找不到这项内容，可能已经被删除了。")
})

test("构建成功后总览显示已构建：只认最近一次成功构建清单里的那一版，改过的回到已保存", async () => {
  const fake = responder(document)
  const service = await studio(await workspace(), fake.ai)
  const { projectId, directory } = await confirmed(service, [entry("gem", "item"), entry("ring", "recipe", ["gem"])])
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const fresh = await service.getProjectOverview({ projectId })
  expect(fresh.items.map((item) => item.status)).toEqual(["review", "review"])
  // The person says yes to both; from here the headline follows saved → built as before.
  await service.reviewAsset({ projectId, assetId: fresh.items[0]!.asset_id!, verdict: "accepted" })
  const judged = await dispatchStudioRequest(service, { method: "reviewAsset", input: { projectId, assetId: fresh.items[1]!.asset_id!, verdict: "accepted" } }) as typeof fresh
  expect(judged.items.map((item) => [item.status, item.facts.accepted])).toEqual([["saved", true], ["saved", true]])
  expect(judged.production).toMatchObject({ accepted: 2, to_review: 0 })

  // Everything a build does except running Gradle: the job record, and the real source snapshot with its manifest.
  const project = await openProject(directory)
  const buildId = crypto.randomUUID()
  const job = await startJob(directory, { kind: "build", expectedRevision: project.revision })
  const running = await updateJob(directory, job.id, { state: "running", expectedRevision: job.revision })
  const source = path.join(path.dirname(await storagePath(directory, ["generated", "reserve"], true)), `build-${buildId}`)
  await mkdir(source)
  await withProjectLock(directory, () => assembleBuildSource(directory, source, fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))))
  expect(JSON.parse(await readFile(path.join(source, "minemods-build.json"), "utf8")).workspace_assets).toHaveLength(2)
  // A build that is still running proves nothing yet.
  expect((await service.getProjectOverview({ projectId })).production.built).toBe(0)
  await updateJob(directory, job.id, {
    state: "completed",
    expectedRevision: running.revision,
    output: { id: buildId, revision: project.revision, jarPath: path.join(source, "build", "libs", "pipeline-0.1.0.jar"), projectDirectory: directory, sourceDirectory: source, sha256: "0".repeat(64) },
  })

  const built = await service.getProjectOverview({ projectId })
  expect(built.items.map((item) => [item.id, item.status, item.status_label])).toEqual([["gem", "built", "已做进模组"], ["ring", "built", "已做进模组"]])
  expect(built.items.every((item) => item.facts.built && item.facts.gametest === null && item.facts.client === null)).toBe(true)
  expect(built.production).toMatchObject({ saved: 2, built: 2, verified: 0 })

  // Editing the item after the build: it is saved again, not built; the recipe is untouched.
  const view = await service.openProject(projectId)
  await service.saveContent({
    projectId,
    expectedRevision: view.project.revision,
    content: { blocks: view.project.blocks, items: view.project.items.map((item) => ({ ...item, max_stack: 8 })), recipes: view.project.recipes, logic: view.project.logic },
  })
  const edited = await service.getProjectOverview({ projectId })
  expect(edited.items.map((item) => [item.id, item.status, item.facts.built])).toEqual([["gem", "saved", false], ["ring", "built", true]])
  expect(edited.items[0]!.revision).toBe(2)
  expect(await service.getAssetUsage({ projectId, assetId: edited.items[0]!.asset_id! })).toMatchObject({
    item: "gem",
    used_by: [{ id: "ring", kind: "recipe", title: "ring 标题", status: "built" }],
    message: "「gem 标题」正在被 1 项内容使用：「ring 标题」。删掉以后它们会缺少这一项。",
  })
})

test("验收和重做（直连 AI）：说不对就带着原话重做这一样，重做完重新等验收；正在做的时候再点会被拒绝", async () => {
  const hold = gate()
  const fake = responder(async (asked) => {
    if (asked.input.prompt.includes("玩家看过现在这一版")) await hold.closed
    return { ...document(asked), ...(asked.input.prompt.includes("太亮了") ? { color: "#223355" } : {}) }
  })
  const service = await studio(await workspace(), fake.ai)
  const { projectId, directory } = await confirmed(service, [entry("gem", "item"), entry("ring", "recipe", ["gem"])])
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const made = await service.getProjectOverview({ projectId })
  const gem = made.items.find((item) => item.id === "gem")!
  expect(made.production).toMatchObject({ saved: 2, accepted: 0, to_review: 2, to_redo: 0 })
  // Nothing made yet cannot be judged or redone, and says so plainly.
  expect(publicError(await service.reviewAsset({ projectId, assetId: crypto.randomUUID(), verdict: "accepted" }).catch((error: unknown) => error))).toBe("这样东西还没有做出来，或者已经被删掉了。")
  expect(publicError(await service.redoAsset({ projectId, itemId: "nothing", feedback: "改" }).catch((error: unknown) => error))).toBe("这样东西还没有做出来，或者已经被删掉了。")
  expect(StudioRequestSchema.safeParse({ method: "reviewAsset", input: { projectId, assetId: gem.asset_id, verdict: "maybe" } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "redoAsset", input: { projectId, itemId: "gem", feedback: "x".repeat(501) } }).success).toBe(false)

  const started = (await dispatchStudioRequest(service, { method: "redoAsset", input: { projectId, itemId: "gem", feedback: "  太亮了，想要暗一点的蓝色  " } })) as typeof made
  expect(started.items.find((item) => item.id === "gem")).toMatchObject({ status: "making", facts: { saved: true, accepted: false } })
  expect(started.production).toMatchObject({ running: true, to_redo: 0 })
  expect(publicError(await service.redoAsset({ projectId, itemId: "gem", feedback: "再改" }).catch((error: unknown) => error))).toBe("「gem 标题」正在做，等这一次做完再说。")
  hold.open()
  const run = (await service.listProjectRuns({ projectId }))[0]!
  await service.externalRunner.wait(run.id)

  // One task, aimed at the thing that exists, with the person's words, the brief and the shared style.
  expect(run.tasks.map((task) => [task.key, task.source, task.target_id])).toEqual([["gem", "blueprint:gem", gem.asset_id]])
  const asked = fake.asked.at(-1)!
  expect(asked.input.prompt).toContain("做一个 gem\n\n玩家看过现在这一版，说：\n太亮了，想要暗一点的蓝色\n")
  expect(asked.input.prompt).toContain("造型：圆润")
  expect((asked.input as unknown as { existing: { color: string } }).existing.color).toBe("#99ccff")
  const project = await openProject(directory)
  expect(project.items[0]!.color).toBe("#223355")
  expect(project.workspace.assets.find((asset) => asset.id === gem.asset_id)!.revision).toBe(2)
  // The new version was never judged: it waits for the person again, and nothing else was touched.
  const after = await service.getProjectOverview({ projectId })
  expect(after.items.map((item) => [item.id, item.status, item.facts.accepted, item.revision])).toEqual([["gem", "review", null, 2], ["ring", "review", null, 1]])
  expect(after.production).toMatchObject({ running: false, saved: 2, to_review: 2, to_redo: 0, failed: 0 })
  expect(JSON.parse(await readFile(path.join(directory, ".minemods", "reviews.json"), "utf8")).reviews).toMatchObject([{ asset_id: gem.asset_id, revision: 1, verdict: "rejected", note: "太亮了，想要暗一点的蓝色" }])
  // Saying yes is one call and sticks until the thing changes.
  expect((await service.reviewAsset({ projectId, assetId: gem.asset_id!, verdict: "accepted" })).items[0]).toMatchObject({ status: "saved", facts: { accepted: true } })
})

test("重做没做成：留着原来那一版和玩家的话，说明没做成；再点一次才会再试", async () => {
  const mood = { fail: false }
  const fake = responder((asked) => (mood.fail ? new Response("upstream down", { status: 500 }) : document(asked)))
  const service = await studio(await workspace(), fake.ai)
  const { projectId, directory } = await confirmed(service, [entry("gem", "item")])
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  mood.fail = true
  await service.redoAsset({ projectId, itemId: "gem", feedback: "换个颜色" })
  await service.externalRunner.wait((await service.listProjectRuns({ projectId }))[0]!.id)
  const failed = await service.getProjectOverview({ projectId })
  expect(failed.items[0]).toMatchObject({ status: "redo", status_label: "要重做", revision: 1, facts: { saved: true, accepted: false } })
  expect(failed.items[0]!.reason).toStartWith("换个颜色\n上次重做没有做成：")
  expect(failed.production).toMatchObject({ running: false, saved: 1, to_redo: 1, failed: 0 })
  expect((await openProject(directory)).items).toHaveLength(1)
  // Carrying on with the plan does not quietly try it again.
  expect((await service.startBlueprintProduction({ projectId })).production.running).toBe(false)
  expect(await service.listProjectRuns({ projectId })).toHaveLength(2)
  mood.fail = false
  await service.redoAsset({ projectId, itemId: "gem", feedback: "换个颜色" })
  await service.externalRunner.wait((await service.listProjectRuns({ projectId }))[0]!.id)
  expect((await service.getProjectOverview({ projectId })).items[0]).toMatchObject({ status: "review", revision: 2 })
})

test("验收和重做（外部 AI）：重做的请求先记下，下一次 next_batch 最先交出去，玩家的话在任务里", async () => {
  const service = await studio(await workspace(), { mode: "mcp" })
  const created = await service.createProject({ name: "外部重做", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  await call("proposeBlueprint", { projectId, request: "做两块宝石", blueprint: plan([entry("gem", "item"), entry("ruby", "item")]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const gemDocument = { kind: "item", identifier: "gem", name: "宝石", max_stack: 16, color: "#99ccff", texture: null }
  const first = (await call("nextBatch", { projectId })) as ExternalStartResult
  const ids = (batch: ExternalStartResult, index: number) => ({ projectId, runId: batch.run.id, taskId: batch.tasks[index]!.task.id })
  await call("claimExternalTask", ids(first, 0))
  await call("commitExternalTask", { ...ids(first, 0), document: gemDocument })
  await call("failExternalTask", { ...ids(first, 1), error: "先不做红宝石" }).catch(() => call("claimExternalTask", ids(first, 1)).then(() => call("failExternalTask", { ...ids(first, 1), error: "先不做红宝石" })))

  const waiting = await service.redoAsset({ projectId, itemId: "gem", feedback: "太亮了" })
  // No AI of Studio's own to start it: the request waits, and the screen says what it is waiting for.
  expect(waiting.items[0]).toMatchObject({ id: "gem", status: "redo", reason: "太亮了", facts: { saved: true, accepted: false } })
  expect(waiting.production).toMatchObject({ running: false, to_redo: 1 })
  expect(await service.listProjectRuns({ projectId })).toHaveLength(1)
  const seen = (await call("getBlueprint", { projectId })) as { redo: unknown[] }
  expect(seen.redo).toEqual([{ id: "gem", asset_id: waiting.items[0]!.asset_id, title: "gem 标题", feedback: "太亮了" }])

  // The redo comes before the ruby that is still to be made.
  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult & { next_step: string }
  expect(batch.tasks.map((value) => [value.task.key, value.task.target_id])).toEqual([["gem", waiting.items[0]!.asset_id]])
  expect(batch.tasks[0]!.task.prompt).toContain("玩家看过现在这一版，说：\n太亮了\n")
  expect(batch.next_step).toContain("要求重做")
  const context = (await call("claimExternalTask", ids(batch, 0))) as { existing: { color: string } | null }
  expect(context.existing).toMatchObject({ color: "#99ccff" })
  await call("commitExternalTask", { ...ids(batch, 0), document: { ...gemDocument, color: "#223355" } })
  const after = await service.getProjectOverview({ projectId })
  expect(after.items[0]).toMatchObject({ status: "review", revision: 2, facts: { accepted: null } })
  expect(after.production).toMatchObject({ to_redo: 0, to_review: 1 })
  // With the redo done the plan carries on where it was.
  expect(((await call("nextBatch", { projectId })) as ExternalStartResult).tasks.map((value) => value.task.key)).toEqual(["ruby"])
})

// 2026-11-16, 蚩尤: the person sent a thing back, the outside AI changed that same thing through its own plan_run before its next
// next_batch, the new version made the verdict stop counting, and the person's words were dropped without the AI having read them.
test("验收和重做（外部 AI）：被打回的东西外部 AI 自己 plan_run 去改，用户的原话也跟着任务走，提交以后不再交第二次", async () => {
  const service = await studio(await workspace(), { mode: "mcp" })
  const created = await service.createProject({ name: "自己改", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  await call("proposeBlueprint", { projectId, request: "做一块宝石", blueprint: plan([entry("gem", "item")]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const gemDocument = { kind: "item", identifier: "gem", name: "宝石", max_stack: 16, color: "#99ccff", texture: null }
  const ids = (batch: ExternalStartResult) => ({ projectId, runId: batch.run.id, taskId: batch.tasks[0]!.task.id })
  const first = (await call("nextBatch", { projectId })) as ExternalStartResult
  await call("claimExternalTask", ids(first))
  await call("commitExternalTask", { ...ids(first), document: gemDocument })
  const assetId = first.tasks[0]!.task.asset_id
  const ownPlan = async (prompt: string) =>
    (await call("startExternal", {
      projectId,
      expectedRevision: (await service.openProject(projectId)).project.revision,
      prompt,
      plan: { summary: "按打包提醒改", questions: [], tasks: [{ key: "gem_fix", module: "item", title: "宝石", prompt, source: prompt, dependencies: [], target_id: assetId }] },
    })) as ExternalStartResult
  type Claimed = { task: { prompt: string }; person_said?: string }

  // The person says 「不满意，要改」 on revision 1; before asking for its next batch the AI plans a change of its own to the same thing.
  await service.reviewAsset({ projectId, assetId, revision: 1, verdict: "rejected", note: "颜色太亮了" })
  expect((await service.getProjectOverview({ projectId })).items[0]).toMatchObject({ status: "redo", reason: "颜色太亮了" })
  const own = await ownPlan("按打包提醒把堆叠数改小")
  expect(own.tasks[0]!.task.prompt).toBe("按打包提醒把堆叠数改小\n\n用户在 Studio 里打回了现在这一版，原话：\n颜色太亮了\n这次连同上面的要求一起改掉；用户没提到的地方保持不变。")
  const claimed = (await call("claimExternalTask", ids(own))) as Claimed
  expect(claimed.person_said).toBe("用户在 Studio 里看过这一样，要改，原话：「颜色太亮了」。这次连同任务里的其他要求一起改掉，改好了再提交。")
  // Taken up: it is not handed out beside the task that carries it, and once the new version is saved nothing is left to hand out.
  expect(((await call("getBlueprint", { projectId })) as { redo: unknown[] }).redo).toEqual([])
  await call("commitExternalTask", { ...ids(own), document: { ...gemDocument, max_stack: 8, color: "#334466" } })
  const after = await service.getProjectOverview({ projectId })
  expect(after.items[0]).toMatchObject({ status: "review", revision: 2 })
  expect(after.production).toMatchObject({ to_redo: 0 })
  expect(await call("nextBatch", { projectId })).toMatchObject({ run: null })

  // Planned before the person sent revision 2 back, claimed after: their words are put in the task when it is claimed.
  const early = await ownPlan("按打包提醒把名字改短")
  expect(early.tasks[0]!.task.prompt).toBe("按打包提醒把名字改短")
  await service.reviewAsset({ projectId, assetId, revision: 2, verdict: "rejected", note: "还是太亮" })
  const late = (await call("claimExternalTask", ids(early))) as Claimed
  expect(late.task.prompt).toContain("\n用户在 Studio 里打回了现在这一版，原话：\n还是太亮\n")
  expect(late.person_said).toContain("「还是太亮」")
  expect(((await call("getExternalRun", { projectId, runId: early.run.id })) as { tasks: { prompt: string }[] }).tasks[0]!.prompt).toBe(late.task.prompt)
  await call("commitExternalTask", { ...ids(early), document: { ...gemDocument, name: "宝", color: "#223344" } })
  expect((await service.getProjectOverview({ projectId })).items[0]).toMatchObject({ status: "review", revision: 3 })
  expect(await call("nextBatch", { projectId })).toMatchObject({ run: null })

  // A task that comes from next_batch already carries the words, and is not given them twice.
  await service.reviewAsset({ projectId, assetId, revision: 3, verdict: "rejected", note: "换成红色" })
  const redo = (await call("nextBatch", { projectId })) as ExternalStartResult
  const redone = (await call("claimExternalTask", ids(redo))) as Claimed
  expect(redone.task.prompt.split("换成红色")).toHaveLength(2)
  expect(redone.person_said).toContain("「换成红色」")
})

test("这几个界面上能碰到的报错都说人话：用到了不存在的东西、蓝图规则、别处刚改过", async () => {
  const service = await studio(await workspace(), {})
  const created = await service.createProject({ name: "报错", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const recipe = { id: crypto.randomUUID(), name: "坏配方", pattern: ["pipeline:ghost_dust", null, null, null, null, null, null, null, null], result: "minecraft:stick", count: 1 }
  const lost = publicError(await service.saveContent({ projectId, expectedRevision: created.project.revision, content: { blocks: [], items: [], recipes: [recipe], logic: [] } as never }).catch((error: unknown) => error))
  expect(lost).toBe("配方「坏配方」用到了「ghost_dust」，可是模组里没有叫这个名字的方块或物品。先把它做出来，或者换成一样已经有的。")
  const rule = (entries: BlueprintPlan["entries"]) => service.saveBlueprint({ projectId, revision: 0, blueprint: draft("做", entries) }).then(() => "saved", publicError)
  expect(await rule([entry("a", "recipe", ["ghost"])])).toBe("「a 标题」要用到的一样东西在蓝图里找不到了。")
  expect(await rule([entry("i", "item"), entry("m", "model", ["i"])])).toBe("「m 标题」是模型，用不上物品「i 标题」。")
  expect(await rule([entry("lore", "worldview", [], { out_of_scope: "只能存成设计稿" }), entry("i", "item", ["lore"])])).toBe("「i 标题」要用到「lore 标题」，可是「lore 标题」这次不做。")
  // The other ways hand-edited content can point at nothing, each named by the thing being saved.
  const issue = (message: string, path: (string | number)[]) => new z.ZodError([{ code: "custom", path, message, input: null }])
  const named = { recipes: [{ name: "坏配方" }], entities: [{ name: "怨灵" }] }
  const broken = [
    plainContent(issue(`Unknown entity reference: ${crypto.randomUUID()}`, ["logic", 0, "entity_id"]), named),
    plainContent(issue("Unknown content reference: pipeline:ghost_dust", ["logic", 0, "item"]), named),
    plainContent(issue("Death drop references a missing or non-lucky block: lucky_box", ["entities", 0, "runtime", "death_drop", "block_identifier"]), named),
    plainContent(issue("Duplicate content identifier", [])),
    publicError(issue("Unknown content reference: pipeline:ghost_dust", ["recipes", 3, "result"])),
  ]
  expect(broken).toEqual([
    "有一条玩法规则要找的那只生物已经不在了。给它换一只生物，或者把这条规则删掉。",
    "有一条玩法规则用到了「ghost_dust」，可是模组里没有叫这个名字的方块或物品。先把它做出来，或者换成一样已经有的。",
    "生物「怨灵」被打倒以后要掉盲盒「lucky_box」，可是这个盲盒方块不见了，或者已经不是盲盒了。先到生物那里换掉它，再来改这个方块。",
    "有两样东西用了同一个英文短名。给其中一样换个名字再保存。",
    "配方用到了「ghost_dust」，可是模组里没有叫这个名字的方块或物品。先把它做出来，或者换成一样已经有的。",
  ])
  expect(plainContent(issue("Invalid input", ["recipes", 0]))).toBeNull()
  const words = [await rule([entry("fox", "entity")]), await rule([entry("a", "item", ["b"]), entry("b", "item", ["a"])]), lost, ...broken]
  words.forEach((text) => expect(text).not.toMatch(/条目|依赖|schema|revision|Unknown|pipeline:|[0-9a-f]{8}-/i))
  // Saved elsewhere between reading and writing: the person is told it was refreshed, not shown a revision number.
  await service.saveBlueprint({ projectId, revision: 0, blueprint: draft("做", [entry("gem", "item")]) })
  const real = service.blueprints.confirm
  const directory = created.directory
  const raced = publicError(
    await Promise.all([real({ projectId, revision: 1 }), real({ projectId, revision: 1 })]).catch((error: unknown) => error),
  )
  expect([raced, (await openProject(directory)).blueprint!.state]).toEqual(["别处刚改过这个模组，已为你刷新。请再试一次。", "confirmed"])
})

test("验收只认玩家看到的那一版：版本对不上会被拒绝，可以撤回；重做过的东西会提醒用到它的内容，直到那样内容重做或被认可", async () => {
  const fake = responder((asked) => ({ ...document(asked), ...(asked.input.prompt.includes("太亮了") ? { color: "#223355" } : {}) }))
  const service = await studio(await workspace(), fake.ai)
  const { projectId, directory } = await confirmed(service, [entry("gem", "item"), entry("ring", "recipe", ["gem"])])
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const made = await service.getProjectOverview({ projectId })
  const [gem, ring] = made.items as [(typeof made.items)[number], (typeof made.items)[number]]
  expect(made.items.map((item) => [item.review, item.preview])).toEqual([
    [null, { source: "asset", model_asset_id: null, texture_asset_id: null, entity_id: null }],
    [null, { source: "asset", model_asset_id: null, texture_asset_id: null, entity_id: null }],
  ])
  // Judging a version the person is not looking at is refused in words; the right one is recorded and reported back.
  const call = (method: string, input: Record<string, unknown>) => dispatchStudioRequest(service, StudioRequestSchema.parse({ method, input: { projectId, ...input } })) as Promise<typeof made>
  expect(publicError(await call("reviewAsset", { assetId: gem.asset_id, revision: 2, verdict: "accepted" }).catch((error: unknown) => error))).toBe(
    "「gem 标题」刚刚又变了，你看到的已经不是最新的一版。已为你刷新，请再看一眼。",
  )
  const yes = await call("reviewAsset", { assetId: gem.asset_id, revision: 1, verdict: "accepted", note: "  挺好  " })
  expect(yes.items[0]).toMatchObject({ status: "saved", facts: { accepted: true }, review: { verdict: "accepted", note: "挺好" } })
  expect(yes.production).toMatchObject({ accepted: 1, to_review: 1 })
  expect(StudioRequestSchema.safeParse({ method: "reviewAsset", input: { projectId, assetId: gem.asset_id, verdict: "accepted", note: "x".repeat(501) } }).success).toBe(false)
  expect(StudioRequestSchema.safeParse({ method: "clearAssetReview", input: { projectId, assetId: gem.asset_id, extra: 1 } }).success).toBe(false)
  // Taken back: it waits to be looked at again, exactly as before. Taking back nothing is fine.
  const cleared = await call("clearAssetReview", { assetId: gem.asset_id })
  expect(cleared.items[0]).toMatchObject({ status: "review", facts: { accepted: null }, review: null })
  expect((await call("clearAssetReview", { assetId: gem.asset_id })).production).toMatchObject({ accepted: 0, to_review: 2 })
  expect(publicError(await service.clearAssetReview({ projectId, assetId: crypto.randomUUID() }).catch((error: unknown) => error))).toBe("这样东西还没有做出来，或者已经被删掉了。")
  // None of this touched the project file.
  expect((await openProject(directory)).revision).toBe((await service.openProject(projectId)).project.revision)

  // The ring was accepted while the gem still had its old look; then the gem is sent back and remade.
  await service.reviewAsset({ projectId, assetId: ring.asset_id!, revision: 1, verdict: "accepted" })
  expect((await service.getProjectOverview({ projectId })).problems).toEqual([])
  await service.redoAsset({ projectId, itemId: "gem", feedback: "太亮了" })
  await service.externalRunner.wait((await service.listProjectRuns({ projectId }))[0]!.id)
  const remade = await service.getProjectOverview({ projectId })
  expect(remade.items.map((item) => [item.id, item.status, item.revision])).toEqual([["gem", "review", 2], ["ring", "saved", 1]])
  // Nothing was remade behind the person's back: the ring is only pointed out.
  expect(remade.problems).toEqual([{ item: "ring", kind: "stale", message: "「ring 标题」用到的「gem 标题」重做过，最好看看还合不合适。" }])
  // Saying yes to the new gem does not settle the ring; looking at the ring again does.
  expect((await service.reviewAsset({ projectId, assetId: gem.asset_id!, revision: 2, verdict: "accepted" })).problems).toHaveLength(1)
  expect((await service.reviewAsset({ projectId, assetId: ring.asset_id!, revision: 1, verdict: "accepted" })).problems).toEqual([])
})

test("没做成的条目也能带着一句话再试一次：直连 AI 从头做一遍；还没轮到的、被卡住的、手工内容说明为什么不行", async () => {
  const mood = { fail: true }
  const fake = responder((asked) => (mood.fail && asked.input.task.key === "gem" ? new Response("{}", { status: 401 }) : document(asked)))
  const service = await studio(await workspace(), fake.ai)
  const { projectId } = await confirmed(service, [entry("gem", "item"), entry("ring", "recipe", ["gem"]), entry("coin", "item")])
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const stuck = await service.getProjectOverview({ projectId })
  expect(stuck.items.map((item) => [item.id, item.status, item.status_label])).toEqual([["gem", "failed", "没做成"], ["ring", "blocked", "被卡住"], ["coin", "review", "等你验收"]])
  const refused = (itemId: string) => service.redoAsset({ projectId, itemId, feedback: "再来" }).then(() => "started", publicError)
  expect(await refused("ring")).toBe("「ring 标题」要先做好「gem 标题」，但它没有做成。先把那一样做出来。")
  const runs = (await service.listProjectRuns({ projectId })).length

  // Still failing: the try is spent, the entry is failed again, and carrying on with the plan does not retry it.
  const tried = await service.redoAsset({ projectId, itemId: "gem", feedback: "做成红色的" })
  expect(tried.items[0]).toMatchObject({ status: "making", facts: { saved: false } })
  await service.externalRunner.wait((await service.listProjectRuns({ projectId }))[0]!.id)
  expect((await service.getProjectOverview({ projectId })).items[0]).toMatchObject({ status: "failed", facts: { saved: false } })
  expect((await service.startBlueprintProduction({ projectId })).production.running).toBe(false)
  expect(await service.listProjectRuns({ projectId })).toHaveLength(runs + 1)

  mood.fail = false
  await service.redoAsset({ projectId, itemId: "gem", feedback: "做成红色的" })
  const run = (await service.listProjectRuns({ projectId }))[0]!
  await service.externalRunner.wait(run.id)
  // One task, made anew from the entry, with the person's words kept apart from the brief and the style.
  expect(run.tasks.map((task) => [task.key, task.source, task.target_id])).toEqual([["gem", "blueprint:gem", null]])
  expect(fake.asked.at(-1)!.input.prompt).toBe(["做一个 gem", "", "这一样之前没有做成，玩家想再试一次，并且说：", "做成红色的", "", "这样东西在蓝图里答应过的事，做出来都要兑现：", "- 从哪来：从哪来有交代", "- 干什么用：干什么用有交代", "", "整个模组共用的风格约定：", "世界观：北方森林", "造型：圆润", "命名：中文名", "配色：#335533"].join("\n"))
  const after = await service.getProjectOverview({ projectId })
  expect(after.items.map((item) => [item.id, item.status])).toEqual([["gem", "review"], ["ring", "planned"], ["coin", "review"]])
  expect(after.production).toMatchObject({ failed: 0, blocked: 0, to_redo: 0 })
  expect(await refused("ring")).toBe("「ring 标题」还没有做出来，没法重做。等它做好再说。")

  // Content the person made by hand, with no asset behind it, is theirs to change.
  const manual = await service.createProject({ name: "手工", description: "一只手工生物", modId: "manual_mod" })
  const creature = (await service.getProjectOverview({ projectId: manual.project.id })).items[0]!
  // A hand-made creature with no model is not whole: the refusal says what is missing and how it gets made, not that nothing was made.
  expect(publicError(await service.redoAsset({ projectId: manual.project.id, itemId: creature.id, feedback: "改" }).catch((error: unknown) => error))).toBe(
    `「${creature.title}」是你自己做的，还缺东西（「${creature.title}」还没有模型：生物要先有模型，才能做进模组。），「重做」帮不上。想让 AI 补上，就告诉它要把「${creature.title}」做完，它会在蓝图里写明改的就是这一个；也可以打开它自己做。`,
  )
  // With a model it is whole, and is the person's own to open and change.
  const modelled = await service.useExample({ projectId: manual.project.id, expectedRevision: manual.project.revision })
  expect(modelled.project.entities[0]!.model_asset_id).not.toBeNull()
  expect(publicError(await service.redoAsset({ projectId: manual.project.id, itemId: creature.id, feedback: "改" }).catch((error: unknown) => error))).toBe(
    `「${creature.title}」是你自己做的内容，AI 没法替你重做。可以打开它直接改。`,
  )
  expect((await service.getProjectOverview({ projectId: manual.project.id })).items[0]).toMatchObject({ status: "saved", review_asked: false, review: null, preview: { source: "content", model_asset_id: null, texture_asset_id: null } })
})

test("外部 AI：没做成的条目再试一次也走 next_batch；验收、打回、撤回都没有对应的工具", async () => {
  const service = await studio(await workspace(), { mode: "mcp" })
  const created = await service.createProject({ name: "外部再试", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  await call("proposeBlueprint", { projectId, request: "做一块宝石", blueprint: plan([entry("gem", "item")]), paper_play: PAPER })
  await service.confirmBlueprint({ projectId, revision: 1 })
  const ids = (batch: ExternalStartResult) => ({ projectId, runId: batch.run.id, taskId: batch.tasks[0]!.task.id })
  // Both allowed tries fail, so the plan has nothing left to hand out.
  for (const _ of Array.from({ length: BLUEPRINT_ATTEMPTS })) {
    const batch = (await call("nextBatch", { projectId })) as ExternalStartResult
    await call("claimExternalTask", ids(batch))
    await call("failExternalTask", { ...ids(batch), error: "画不出来" })
  }
  expect(await call("nextBatch", { projectId })).toMatchObject({ run: null })
  const asked = await service.redoAsset({ projectId, itemId: "gem", feedback: "简单一点就行" })
  expect(asked.items[0]).toMatchObject({ status: "redo", status_label: "要重做", reason: "简单一点就行\n上次没有做成：画不出来", facts: { saved: false } })
  expect(asked.production).toMatchObject({ running: false, to_redo: 1, failed: 0 })
  expect(((await call("getBlueprint", { projectId })) as { redo: unknown[] }).redo).toEqual([{ id: "gem", asset_id: null, title: "gem 标题", feedback: "简单一点就行\n上次没有做成：画不出来" }])
  const batch = (await call("nextBatch", { projectId })) as ExternalStartResult & { next_step: string }
  expect(batch.tasks.map((value) => [value.task.key, value.task.source, value.task.target_id])).toEqual([["gem", "blueprint:gem", null]])
  expect(batch.tasks[0]!.task.prompt).toContain("这一样之前没有做成，玩家想再试一次，并且说：\n简单一点就行")
  expect(batch.next_step).toContain("要求重做")
  await call("claimExternalTask", ids(batch))
  await call("commitExternalTask", { ...ids(batch), document: { kind: "item", identifier: "gem", name: "宝石", max_stack: 16, color: "#99ccff", texture: null } })
  const saved = await service.getProjectOverview({ projectId })
  expect(saved.items[0]).toMatchObject({ status: "review", review_asked: true, facts: { saved: true, accepted: null } })

  // The verdict is the person's act, like confirming the plan: nothing an outside AI can reach gives, changes or clears one.
  // The only names that sound like one belong to the making loop: the maker's own self-review and the review by a
  // reviewer that took no part. Both are about a version still being made; neither touches what the person says.
  const verdict = /review|accept|reject|verdict|redo/i
  expect(ExternalBridgeRequestSchema.shape.method.options.filter((name) => verdict.test(name))).toEqual(["selfReviewExternalTask", "finalReviewExternalTask"])
  expect(MCP_TOOLS.map((tool) => tool[0]).filter((name) => verdict.test(name))).toEqual(["self_review", "final_review"])
  expect([...(await readFile(fileURLToPath(new URL("../src/main/mcp-stdio.ts", import.meta.url)), "utf8")).matchAll(/registerTool\(\s*"([^"]*(?:review|accept|reject|verdict|redo)[^"]*)"/gi)].map((match) => match[1])).toEqual(["self_review", "final_review"])
  for (const method of ["reviewAsset", "clearAssetReview", "redoAsset"])
    await expect(dispatchExternal(service, { method, input: { projectId, assetId: saved.items[0]!.asset_id, itemId: "gem", verdict: "accepted", feedback: "" } })).rejects.toThrow()
  expect((await service.getProjectOverview({ projectId })).items[0]!.facts.accepted).toBeNull()
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  expect(handoff).toContain("带着意见重做")
  expect(handoff).toContain("验收、打回和撤回验收只能由用户在 Studio 里完成")
})

test("蓝图制作和单项重做都从同一个验收口进；人自己改的、导入的不验收；总览带着验收时听到的话", async () => {
  const picture = async (folder: string, name: string) => (await Bun.file(new URL(`../../mod-core/test/fixtures/acceptance/${folder}/${name}.json`, import.meta.url)).json()).document.texture as string
  const icons = { good: await picture("good", "gem-item"), noisy: await picture("bad", "static-item") }
  const mood = { icon: icons.noisy }
  const fake = responder((asked) => ({ kind: "item", identifier: asked.input.task.key, name: asked.input.task.title, max_stack: 16, color: "#99ccff", texture: mood.icon }))
  const service = await studio(await workspace(), fake.ai)
  const { projectId, directory } = await confirmed(service, [entry("gem", "item")])

  // Working through the plan: the AI keeps handing in static, every hand-in is refused, nothing is saved.
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const refused = await service.getProjectOverview({ projectId })
  expect(refused.items[0]).toMatchObject({ status: "failed", facts: { saved: false } })
  expect(refused.items[0]!.reason).toContain(`物品改了 ${REFUSAL_CAP} 次还是没通过验收：1. 【不机械】`)
  expect(refused.items[0]!.judged).toBeUndefined()
  expect(fake.asked).toHaveLength(BLUEPRINT_ATTEMPTS * REFUSAL_CAP)
  // Each repair turn is told what the standard found, in words.
  expect(fake.asked[1]!.input.revision_required).toMatchObject({ issues: [{ criterion: "不机械", message: expect.stringContaining("孤立的杂点"), fix: expect.stringContaining("成块的深浅") }] })
  expect((await openProject(directory)).workspace.assets).toHaveLength(0)

  // The AI does better: saved, and the overview carries what the standard was told when it was handed in.
  mood.icon = icons.good
  await service.confirmBlueprint({ projectId, revision: 1 })
  await service.startBlueprintProduction({ projectId })
  await service.blueprints.idle(projectId)
  const made = await service.getProjectOverview({ projectId })
  expect(made.items[0]).toMatchObject({ status: "review", revision: 1, judged: { asked: "做一套矿物和配方", insisted: true, complexity: "medium" } })
  expect(made.items[0]!.judged!.brief).toContain("做一个 gem")

  // Redoing that one thing is fresh AI work through the same door: static is refused, the saved version stays.
  mood.icon = icons.noisy
  const before = fake.asked.length
  await service.redoAsset({ projectId, itemId: "gem", feedback: "换一种画法" })
  await service.externalRunner.wait((await service.listProjectRuns({ projectId }))[0]!.id)
  const again = await service.getProjectOverview({ projectId })
  expect(fake.asked.length - before).toBe(REFUSAL_CAP)
  expect(again.items[0]).toMatchObject({ status: "redo", revision: 1 })
  expect(again.items[0]!.reason).toContain("还是没通过验收")
  expect((await openProject(directory)).items[0]!.texture).toBe(icons.good)

  // The person paints the same static over it by hand: saved without a word, and it is theirs now, so nothing is judged.
  const view = await service.openProject(projectId)
  await service.saveContent({ projectId, expectedRevision: view.project.revision, content: { blocks: view.project.blocks, items: view.project.items.map((item) => ({ ...item, texture: icons.noisy })), recipes: view.project.recipes, logic: view.project.logic } })
  const own = await service.getProjectOverview({ projectId })
  expect((await openProject(directory)).items[0]!.texture).toBe(icons.noisy)
  expect(own.items[0]).toMatchObject({ revision: 2, review_asked: false, facts: { saved: true } })
  expect(own.items[0]!.judged).toBeUndefined()

  // A project brought in from a file comes in as it is, static icon and all.
  const archive = path.join(await workspace(), "pipeline.minemods")
  await exportProjectArchive({ directory, destination: archive })
  const imported = await importProjectArchive({ archive, destination: path.join(await workspace(), "imported") })
  expect((await openProject(imported.directory)).items[0]!.texture).toBe(icons.noisy)
})

test("纸上试玩把「点了名的事在游玩里遇不上」当成必须改的：试玩员被这样告知，它的结论原样跟着蓝图给人看", async () => {
  // The rule names no subject; it is about where, when and how far.
  for (const phrase of [`4. ${PAPER_UNREACHED.label}：`, "要在一次普通的游玩里真的会发生才算数", "不在一处出现", "不在同一个时候出现", "写明的范围够不到对方", "连得起来，不等于在游戏里遇得上", "就是「必须改的」，不能只写进「可以更好的」"]) expect(PAPER_PLAY_INSTRUCTIONS).toContain(phrase)
  expect(PAPER_UNREACHED.rule).not.toMatch(/矿|守卫|平原|ore|guard/i)
  expect(blueprintPlannerInstructions("fabric-1.21.1")).toContain(PAPER_UNREACHED.rule)
  const stone = { ...entry("stone", "block"), play: { answers: [{ question: "source" as const, words: "只在主世界地下 Y −16 到 48 的石头里生成", from: "ai" as const, through: [] }, { question: "use" as const, words: "能当燃料", from: "ai" as const }, { question: "reaction" as const, words: "挖掉会掉它自己", from: "ai" as const }], declined: [] } }
  const seen: { input?: { request: string; things: { name: string; answers: { says: string[] }[] }[] } } = {}
  // A fake reader that does what the rule asks of a real one: it finds the two places in the answers and says they never meet.
  const fake = responder((asked) => {
    if (asked.instructions.startsWith(CONSTRAINT_EXTRACT_INSTRUCTIONS)) return { constraints: [] }
    if (!asked.instructions.startsWith(PAPER_PLAY_INSTRUCTIONS)) return { style, questions: [], entries: [stone] }
    seen.input = asked.input as unknown as typeof seen.input
    const places = JSON.stringify(seen.input!.things)
    return asked.instructions.includes(PAPER_UNREACHED.rule) && places.includes("地下") ? { findings: ["原话要的是地面上的东西守着这种石头，可它只在地下出现，地面上的东西够不到它：守着这件事遇不上。"], advice: [] } : { findings: [], advice: ["可以更好"] }
  })
  const service = await studio(await workspace(), fake.ai)
  const projectId = (await service.createProject({ name: "遇不上", description: "", modId: "unreached", empty: true })).project.id
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: "做一种地面上有东西守着的石头" })).jobId)).state).toBe("completed")
  // The reader was shown where the thing turns up, in the plan's own words.
  expect(JSON.stringify(seen.input!.things)).toContain("只在主世界地下 Y −16 到 48 的石头里生成")
  const stored = (await service.getBlueprint({ projectId }))!
  expect(stored.paper).toMatchObject({ by: "studio", independent: true, findings: [expect.stringContaining("遇不上")], advice: [] })
})

test("「能玩」在两条路上是同一道门：悄悄空着的问题逐条点名；「故意不做」只有人能替自己说；试玩员的结论跟着蓝图给人看", async () => {
  const gem = entry("gem", "item")
  const answers = [
    { question: "source" as const, words: "主世界地下自己生成", from: "ai" as const, through: [] },
    { question: "use" as const, words: "能当燃料", from: "ai" as const },
  ]
  const turn = { plans: 0 }
  // Studio's own planner first leaves the gem without a use, then claims the person said to leave it out.
  const fake = responder((asked) => {
    if (asked.instructions.startsWith(CONSTRAINT_EXTRACT_INSTRUCTIONS)) return { constraints: [] }
    if (asked.instructions.startsWith(PAPER_PLAY_INSTRUCTIONS)) return { findings: ["宝石挖到以后没有任何去处。"], advice: [] }
    turn.plans += 1
    return { style, questions: [], entries: [{ ...gem, play: turn.plans === 1 ? { answers: answers.slice(0, 1), declined: [] } : { answers: answers.slice(0, 1), declined: [{ question: "use", reason: "用户说不用", by: "you", constraint: null }] } }] }
  })
  const service = await studio(await workspace(), fake.ai)
  const projectId = (await service.createProject({ name: "能玩", description: "", modId: "playable", empty: true })).project.id
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: "做一块宝石" })).jobId)).state).toBe("completed")
  const planner = fake.asked.filter((asked) => asked.instructions.startsWith(blueprintPlannerInstructions("fabric-1.21.1")))
  // The gap went back to the planner once, in the words the person would be shown.
  expect((planner[1]!.input.revision_required as { issues: { code: string; message: string }[] }).issues).toEqual([
    { code: "playable", message: "这份蓝图做出来还不能算一个能玩的模组，所以没有保存。下面每一处都要补上答案；确实不该有的，就写明「故意不做」和原因：\n- 物品「gem 标题」没有交代「干什么用」（得到它或者打败它以后，它通向哪里）：空着的话，拿到它或者打败它以后没有任何下文。" },
  ])
  const stored = (await service.getBlueprint({ projectId }))!
  // An AI cannot speak for the person: its "you" is stored as its own proposal, which the person sees before confirming.
  expect(stored.entries[0]!.play!.declined).toEqual([{ question: "use", reason: "用户说不用", by: "ai", constraint: null }])
  expect(stored.paper).toMatchObject({ by: "studio", independent: true, findings: ["宝石挖到以后没有任何去处。"] })
  const overview = await service.getProjectOverview({ projectId })
  expect(overview.playable!.summary).toBe("1 样东西 · 每个问题都有答案")
  expect(overview.playable!.things[0]!.rows.map((row) => [row.label, row.mark])).toEqual([["从哪来", "ai"], ["干什么用", "proposed"]])

  // The person's own click is theirs: stored as "you", kept through a later edit that does not mention it, and the paper findings stay with the same things.
  const mine = { answers: answers.slice(0, 1), declined: [{ question: "use" as const, reason: "你决定这一处不做", by: "you" as const, constraint: null }] }
  const edited = await service.saveBlueprint({ projectId, revision: stored.revision, blueprint: { request: stored.request, style, questions: [], entries: [{ ...gem, play: mine }] } })
  expect(edited.entries[0]!.play).toEqual(mine)
  const renamed = await service.saveBlueprint({ projectId, revision: edited.revision, blueprint: { request: stored.request, style, questions: [], entries: [{ ...gem, title: "红宝石" }] } })
  expect(renamed.entries[0]).toMatchObject({ title: "红宝石", play: mine })
  expect(renamed.paper?.findings).toEqual(["宝石挖到以后没有任何去处。"])
  expect((await service.getProjectOverview({ projectId })).playable!.things[0]!.rows[1]).toMatchObject({ state: "declined", mark: "person" })
  // A plan from before the standard, or one the person emptied by hand, is stored and confirmed all the same: its questions only show as open.
  const bare = await service.saveBlueprint({ projectId, revision: renamed.revision, blueprint: { request: stored.request, style, questions: [], entries: [{ ...gem, play: { answers: [], declined: [] } }, entry("ruby", "item")] } })
  expect(bare.paper).toBeUndefined()
  expect((await service.getProjectOverview({ projectId })).playable!.summary).toBe("2 样东西 · 4 个问题还没有答案")
  expect((await service.confirmBlueprint({ projectId, revision: bare.revision })).state).toBe("confirmed")

  // An outside AI reads the same standard and how to hand in its paper play-through.
  const told = (await service.blueprints.external.getBlueprint({ projectId })) as unknown as { playable: { gaps: { text: string }[]; paper_play: { instructions: string; schema: { properties: object } } } }
  expect(told.playable.gaps).toHaveLength(4)
  expect(told.playable.paper_play.instructions).toBe(PAPER_PLAY_INSTRUCTIONS)
  expect(Object.keys(told.playable.paper_play.schema.properties).sort()).toEqual(["advice", "findings"])
})

// creature tier (10-12)
test("生物档位：AI 替人写的「你选的」降成 AI 自己的；人选的档位在改名、AI 重新规划（改了或丢了）时都原样保留；外部 AI 同一道门", async () => {
  const tier = (level: "simple" | "standard" | "fine" | "boss", extra: Record<string, unknown> = {}) => ({ level, reason: `原话里有${level}`, by: "ai" as const, ...extra })
  const fox = (extra: Record<string, unknown> = {}) => [entry("fox_model", "model", [], { owner: "fox" }), entry("fox", "entity", ["fox_model"], extra)]
  const turn = { tier: tier("fine", { by: "you" }) as ReturnType<typeof tier> | undefined }
  // Studio's own planner writes whatever the test says; the model entry never carries a tier.
  const fake = responder((asked) => {
    if (asked.instructions.startsWith(CONSTRAINT_EXTRACT_INSTRUCTIONS)) return { constraints: [] }
    if (asked.instructions.startsWith(PAPER_PLAY_INSTRUCTIONS)) return { findings: [], advice: [] }
    return plan(fox(turn.tier ? { tier: turn.tier } : {}))
  })
  const service = await studio(await workspace(), fake.ai)
  const projectId = (await service.createProject({ name: "档位", description: "", modId: "tiers", empty: true })).project.id
  expect(blueprintPlannerInstructions("fabric-1.21.1")).toContain("12. 生物档位")
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: "做一只精细的狐狸" })).jobId)).state).toBe("completed")
  // The AI wrote "you": stored as the AI's own, level and reason as it wrote them.
  const first = (await service.getBlueprint({ projectId }))!
  expect(first.entries.find((value) => value.key === "fox")!.tier).toEqual(tier("fine"))
  // Planning is told the plan on screen, tiers included, so a person's pick can be kept.
  const lastPlanner = () => fake.asked.filter((asked) => asked.instructions.startsWith(blueprintPlannerInstructions("fabric-1.21.1"))).at(-1)!
  // The person clicks Boss: stored as theirs, and a save that does not mention the tier (a rename) keeps it.
  const mine = { level: "boss" as const, reason: "你选的", by: "you" as const }
  const picked = await service.saveBlueprint({ projectId, revision: first.revision, blueprint: { request: first.request, style, questions: [], entries: first.entries.map((value) => (value.key === "fox" ? { ...value, tier: mine } : value)).map(({ asset_id: _id, ...value }) => value) } })
  expect(picked.entries.find((value) => value.key === "fox")!.tier).toEqual(mine)
  const renamed = await service.saveBlueprint({ projectId, revision: picked.revision, blueprint: { request: first.request, style, questions: [], entries: picked.entries.map(({ asset_id: _id, tier: _tier, ...value }) => (value.key === "fox" ? { ...value, title: "红狐狸" } : value)) } })
  expect(renamed.entries.find((value) => value.key === "fox")).toMatchObject({ title: "红狐狸", tier: mine })
  // A tier on something that is not a creature is refused, with why.
  expect(publicError(await service.saveBlueprint({ projectId, revision: renamed.revision, blueprint: { request: first.request, style, questions: [], entries: [{ ...entry("gem", "item"), tier: tier("boss") }] } }).catch((error: unknown) => error))).toContain("不是生物，不能定档位")
  // Studio's own planner plans again and changes the level, then drops it: the person's pick stays either way.
  turn.tier = tier("simple")
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: "做一只简单的狐狸" })).jobId)).state).toBe("completed")
  expect(lastPlanner().input).toMatchObject({ current: { entries: expect.arrayContaining([expect.objectContaining({ key: "fox", tier: mine })]) } })
  expect((await service.getBlueprint({ projectId }))!.entries.find((value) => value.key === "fox")!.tier).toEqual(mine)
  turn.tier = undefined
  expect((await finished(service, projectId, (await service.draftBlueprint({ projectId, request: "做一只狐狸" })).jobId)).state).toBe("completed")
  expect((await service.getBlueprint({ projectId }))!.entries.find((value) => value.key === "fox")!.tier).toEqual(mine)
})

test("生物档位：外部 AI 提交蓝图经过同一道门，档位在交接说明和能力清单里写明；老蓝图没有档位也照常", async () => {
  const service = await studio(await workspace(), { mode: "mcp" })
  const created = await service.createProject({ name: "外部档位", description: "", modId: "pipeline", empty: true })
  const projectId = created.project.id
  const call = (method: string, input: unknown) => dispatchExternal(service, { method, input }).catch((error: unknown) => Promise.reject(externalError(error)))
  const tier = (level: "simple" | "standard" | "fine" | "boss", by: "ai" | "you" = "ai") => ({ level, reason: `原话里有${level}`, by })
  const owl = (extra: Record<string, unknown> = {}) => [entry("owl_model", "model", [], { owner: "owl" }), entry("owl", "entity", ["owl_model"], extra)]
  const propose = (entries: BlueprintPlan["entries"]) => call("proposeBlueprint", { projectId, request: "做一只猫头鹰", blueprint: plan(entries), paper_play: PAPER }) as Promise<{ blueprint: { revision: number; entries: { key: string; tier?: unknown }[] } }>
  const tierOfOwl = async () => (await openProject(created.directory)).blueprint!.entries.find((value) => value.key === "owl")!.tier
  // An outside AI cannot speak for the person.
  await propose(owl({ tier: tier("boss", "you") }))
  expect(await tierOfOwl()).toEqual(tier("boss", "ai"))
  // The person picks fine in the app; the outside AI proposes again with another level, and again with none.
  const held = (await openProject(created.directory)).blueprint!
  const mine = { level: "fine" as const, reason: "你选的", by: "you" as const }
  await service.saveBlueprint({ projectId, revision: held.revision, blueprint: { request: held.request, style: held.style, questions: held.questions, entries: held.entries.map(({ asset_id: _id, ...value }) => (value.key === "owl" ? { ...value, tier: mine } : value)) } })
  await propose(owl({ tier: tier("simple") }))
  expect(await tierOfOwl()).toEqual(mine)
  await propose(owl())
  expect(await tierOfOwl()).toEqual(mine)
  // A tier on a part is turned away with the reason.
  expect(await call("proposeBlueprint", { projectId, request: "做一只猫头鹰", blueprint: plan([entry("owl_model", "model", [], { owner: "owl", tier: tier("fine") }), entry("owl", "entity", ["owl_model"])]), paper_play: PAPER }).then(() => "accepted", publicError)).toContain("不是生物，不能定档位")
  // The hand-off and the capability list say every tier of the table (five since 史诗); the planner's schema and rules carry the field.
  const capabilities = getMcpCapabilities("medium") as unknown as { creature_tiers: { default: string; tiers: Record<string, { geometry_budget: string; required_clips: string[]; review_relaxed_by_simple_wording: boolean }> } }
  expect(Object.keys(capabilities.creature_tiers.tiers)).toEqual(["simple", "standard", "fine", "boss", "epic"])
  expect(capabilities.creature_tiers).toMatchObject({ default: "standard", tiers: { fine: { geometry_budget: "fine", required_clips: ["idle", "walk", "hurt", "death"], review_relaxed_by_simple_wording: false }, boss: { geometry_budget: "finest" } } })
  expect(MCP_TOOLS.find((tool) => tool[0] === "propose_blueprint")![2]).toContain("tier?: { level: 'simple' | 'standard' | 'fine' | 'boss' | 'epic', reason, by: 'ai' }")
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  expect(handoff).toContain("生物档位")
  expect(handoff).toContain("creature_tiers")
  const told = (await call("getBlueprint", { projectId })) as unknown as { planner: { instructions: string; schema: unknown } }
  expect(told.planner.instructions).toContain("12. 生物档位")
  expect(JSON.stringify(told.planner.schema)).toContain('"boss"')
})

// 10-07 audit: one busy moment of the provider used to fail the whole plan.
test("规划时模型服务一时忙（503）：找要求、出蓝图、纸上试玩的请求都会再试，不会整个失败", async () => {
  // Every request is answered 503 the first time it is made and properly the second time.
  const seen = new Set<string>()
  const fake = responder((asked) => {
    const first = !seen.has(asked.instructions)
    seen.add(asked.instructions)
    if (first) return new Response("busy", { status: 503 })
    if (asked.instructions.startsWith(CONSTRAINT_EXTRACT_INSTRUCTIONS)) return { constraints: [] }
    if (asked.instructions.startsWith(PAPER_PLAY_INSTRUCTIONS)) return { findings: [], advice: [] }
    return plan([entry("gem", "item")])
  })
  const directory = path.join(await workspace(), "project")
  const created = await createProject({ directory, name: "忙的时候", description: "" })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  closers.push(() => void runner.dispose())
  const blueprints = createBlueprintService({ directoryFor: async () => directory, runner, connection: () => ({ apiKey: fake.ai.apiKey, baseUrl: fake.ai.baseUrl, retryWait: [0, 0] }), onRun: () => undefined })
  const stored = await blueprints.draft({ projectId: created.id, request: "做一块宝石" }, new AbortController().signal)
  expect(stored.entries.map((value) => value.key)).toEqual(["gem"])
  expect(stored.paper).toMatchObject({ by: "studio", findings: [] })
  // Each kind of request went out twice: the one that was refused, and the one that was answered.
  const counts = [CONSTRAINT_EXTRACT_INSTRUCTIONS, blueprintPlannerInstructions("fabric-1.21.1"), PAPER_PLAY_INSTRUCTIONS].map((start) => fake.asked.filter((asked) => asked.instructions.startsWith(start)).length)
  expect(counts).toEqual([2, 2, 2])
})

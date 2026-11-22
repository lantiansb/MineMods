import { afterEach, expect, test } from "bun:test"
import { untilObserved } from "./observed"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readActivity } from "@minemods/mod-core/activity"
import { createProject, openProject, saveProject } from "@minemods/mod-core/project"
import { loadModelAsset } from "@minemods/mod-core/assets"
import { compileSavedModel } from "@minemods/mod-core/editable-model"
import { applyWorkspaceAsset, WorkspaceAssetSchema } from "@minemods/mod-core/workspace"
import { confirmBlueprint, nextBlueprintBatch, replaceBlueprint } from "@minemods/mod-core/blueprint"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { MODEL_COMPLEXITY_PRESETS, type ModelComplexity } from "@minemods/studio-ai/model-quality"
import { REFUSAL_CAP } from "@minemods/mod-core/acceptance"
import { AUTHORING_RETRY } from "../src/main/authoring-ai"
import { createProjectRunner, makeAsset } from "../src/main/project-runner"
import { GESTURE_EXAMPLE } from "@minemods/mod-core/gesture-bases"
import { played } from "./playable-fixture"
import slime from "../../studio-ai/test/fixtures/look/good/sprout-slime.json"

const directories: string[] = []
const servers: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  servers.splice(0).forEach((server) => server.stop(true))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function response(value: unknown) {
  return Response.json({
    model: "gpt-6-astra",
    status: "completed",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(value) }] }],
  })
}

async function setup(handler: (request: Request, body: Record<string, unknown>) => Response | Promise<Response>, complexity?: { value: ModelComplexity }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-project-runner-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const created = await createProject({ directory, name: "运行测试", description: "" })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => handler(request, JSON.parse(await request.text()) as Record<string, unknown>),
  })
  servers.push(server)
  const runner = createProjectRunner({
    directoryFor: async (projectId) =>
      projectId === created.id
        ? directory
        : (() => {
            throw new Error("unknown project")
          })(),
    // No wait between the tries of a request (`AUTHORING_RETRY`), so a test of an answer that stays wrong is fast.
    ai: { apiKey: "fixture-key", baseUrl: `${server.url}v1`, retryWait: [0, 0] },
    ...(complexity ? { getModelComplexity: async () => complexity.value } : {}),
  })
  return { created, directory, runner, requests: server }
}

test("工程运行在开始时固定复杂度快照并注入模块提示", async () => {
  const complexity = { value: "low" as ModelComplexity }
  let seen: Record<string, unknown> | null = null
  const { created, runner } = await setup(async (_request, body) => {
    seen = {
      ...JSON.parse(String((body.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text)),
      instructions: body.instructions,
    }
    return response(worldview("低复杂度"))
  }, complexity)
  const started = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "建立一个月光森林",
    module: "worldview",
  })
  complexity.value = "high"
  const finished = await waitForTerminal(runner, created.id, started.id)
  expect(finished.model_complexity).toBe("low")
  expect(String((seen as Record<string, unknown> | null)?.instructions)).not.toContain("复杂度档位")
})

async function waitForTerminal(runner: ReturnType<typeof createProjectRunner>, projectId: string, runId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await runner.get({ projectId, runId })
    if (["completed", "partial", "canceled", "failed", "interrupted", "awaiting_input"].includes(run.state)) return run
    await Bun.sleep(10)
  }
  throw new Error("runner did not finish")
}

function worldview(title: string) {
  return { kind: "worldview", title, summary: "测试设定", entries: [{ title: "入口", body: "测试内容" }] }
}

function workspaceAsset(document: Record<string, unknown>, module: string, overrides: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString()
  return WorkspaceAssetSchema.parse({
    id: crypto.randomUUID(),
    module,
    title: String(document.name ?? document.title ?? module),
    revision: 1,
    created_at: timestamp,
    updated_at: timestamp,
    prompt: `测试${module}`,
    dependencies: [],
    document,
    provenance: { model: null, request_id: null },
    status: "design",
    ...overrides,
  })
}

function requestInput(body: Record<string, unknown>) {
  const input = body.input as Array<{ content?: Array<{ text?: string }> }> | undefined
  return JSON.parse(input?.[0]?.content?.[0]?.text ?? "{}") as Record<string, unknown>
}

const modelDocument = {
  kind: "model" as const,
  ...ModelDesignSchema.parse({
    name: "测试生物",
    texture_size: 64,
    bones: [
      {
        name: "root",
        parent: null,
        pivot: [0, 8, 0],
        rotation: [0, 0, 0],
        cubes: [
          {
            name: "body",
            origin: [-2, 4, -2],
            size: [4, 4, 4],
            faces: {
              north: "#aa6644",
              east: "#aa6644",
              south: "#aa6644",
              west: "#aa6644",
              up: "#ddaa77",
              down: "#664422",
            },
          },
        ],
      },
    ],
    animations: ["idle", "walk", "hurt"].map((name) => ({
      name,
      length: 1,
      loop: name !== "hurt",
      channels: [
        {
          bone: "root",
          keyframes: [
            { time: 0, rotation: [0, 0, 0] },
            { time: 1, rotation: [0, 0, 0] },
          ],
        },
      ],
    })),
  }),
}

test("选定模块时强制执行模块且不调用全局路由", async () => {
  let requests = 0
  const { created, directory, runner } = await setup(async (_request, body) => {
    requests += 1
    const input = JSON.parse(
      String((body.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text),
    ) as { task: { module: string } }
    expect(input.task.module).toBe("worldview")
    return response(worldview("固定模块"))
  })
  const started = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "建立一个月光森林",
    module: "worldview",
  })
  const finished = await waitForTerminal(runner, created.id, started.id)
  expect(finished.state).toBe("completed")
  expect(requests).toBe(1)
  expect((await openProject(directory)).revision).toBeGreaterThan(created.revision)
})

test("MCP 生物跨运行引用已有模型，任务上下文提供真实 UV，提交保留其他资产", async () => {
  const { created, directory, runner } = await setup(() => {
    throw new Error("外部模式不应调用 API")
  })
  const models = await runner.startExternal({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "简单低模模型 贴图",
    plan: {
      summary: "模型与贴图",
      questions: [],
      tasks: [
        {
          key: "model",
          module: "model",
          title: "模型",
          prompt: "模型",
          source: "模型",
          dependencies: [],
          target_id: null,
        },
        {
          key: "texture",
          module: "texture",
          title: "贴图",
          prompt: "贴图",
          source: "贴图",
          dependencies: ["model"],
          target_id: null,
        },
      ],
    },
  })
  const input = (runId: string, taskId: string) => ({ projectId: created.id, runId, taskId })
  await runner.claimExternalTask(input(models.run.id, models.run.tasks[0]!.id))
  await runner.commitExternalTask({ ...input(models.run.id, models.run.tasks[0]!.id), document: modelDocument })
  const context = await runner.claimExternalTask(input(models.run.id, models.run.tasks[1]!.id))
  const modelId = models.run.tasks[0]!.asset_id
  expect(context.model_context[0]?.asset_id).toBe(modelId)
  expect(context.model_context[0]?.atlas_size).toBe(64)
  expect(context.model_context[0]?.geometry["minecraft:geometry"]).toBeDefined()
  await runner.commitExternalTask({
    ...input(models.run.id, models.run.tasks[1]!.id),
    document: { kind: "texture", width: 64, height: 64, palette: ["#334455"], pixels: Array(64 * 64).fill(0) },
  })
  const before = await openProject(directory)
  const run = await runner.startExternal({
    projectId: created.id,
    expectedRevision: before.revision,
    prompt: "森林生物",
    plan: {
      summary: "生物规则",
      questions: [],
      tasks: [
        {
          key: "entity",
          module: "entity",
          title: "森林生物",
          prompt: "森林生物",
          source: "森林生物",
          dependencies: [],
          target_id: null,
        },
      ],
    },
  })
  await runner.claimExternalTask(input(run.run.id, run.run.tasks[0]!.id))
  await runner.commitExternalTask({
    ...input(run.run.id, run.run.tasks[0]!.id),
    document: {
      kind: "entity",
      name: "森林生物",
      description: "保留原版地形",
      health: 20,
      speed: 0.25,
      attack_damage: 2,
      behavior: "hostile",
      model_asset_id: modelId,
      runtime: {
        spawn: { biomes: ["minecraft:forest"], weight: 20, min: 1, max: 2 },
        explosion: { fuse_ticks: 40, radius: 3, damage_blocks: false, effects: [] },
        movement: "stalk",
        armor: 0,
        charging_armor: 0,
        texture_asset_id: models.run.tasks[1]!.asset_id,
      },
    },
  })
  const after = await openProject(directory)
  const saved = after.workspace.assets.find((asset) => asset.module === "entity")!
  expect(saved.status).toBe("ready")
  expect(saved.dependencies).toEqual([modelId, models.run.tasks[1]!.asset_id])
  expect(after.entities[0]?.runtime?.explosion?.damage_blocks).toBe(false)
  expect(after.blocks).toEqual(before.blocks)
  expect(after.workspace.assets.filter((asset) => asset.module !== "entity")).toEqual(before.workspace.assets)
})

test("MCP 生物绑定不存在的模型时记录失败并阻塞下游，工程不变", async () => {
  const { created, directory, runner } = await setup(() => {
    throw new Error("不应调用 API")
  })
  const started = await runner.startExternal({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "生物 设定",
    plan: {
      summary: "失败依赖",
      questions: [],
      tasks: [
        {
          key: "entity",
          module: "entity",
          title: "生物",
          prompt: "生物",
          source: "生物",
          dependencies: [],
          target_id: null,
        },
        {
          key: "world",
          module: "worldview",
          title: "设定",
          prompt: "设定",
          source: "设定",
          dependencies: ["entity"],
          target_id: null,
        },
      ],
    },
  })
  const input = { projectId: created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  await runner.claimExternalTask(input)
  const stray = { kind: "entity", name: "生物", description: "", health: 20, speed: 0.25, attack_damage: 2, behavior: "hostile", model_asset_id: crypto.randomUUID(), runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } }
  const refused = () => runner.commitExternalTask({ ...input, document: stray }).then(() => "saved", (error: unknown) => (error instanceof Error ? error.message : String(error)))
  // Round 10: a hand-in the save cannot store is a refusal, not the end of the task: it stays open for another version, in the words a look would have given.
  const first = await refused()
  expect(first).toStartWith("这一版照现在的样子存不进工程，提交会被拒绝：")
  expect(first).toContain("model")
  expect(first).toContain("任务保持运行，工程里什么都没有改动（还可以再交 3 次）")
  const open = await runner.getExternalRun({ projectId: created.id, runId: started.run.id })
  expect(open.state).toBe("running")
  expect(open.tasks.map((task) => task.state)).toEqual(["running", "queued"])
  // A draft says the same before anything is handed in.
  const draft = await runner.updateExternalTask({ ...input, draft: stray })
  expect(draft.drafts[input.taskId]?.unsaveable).toStartWith("这一版照现在的样子存不进工程，提交会被拒绝：")
  // The same unsaveable hand-in cannot hold the batch forever: at the standard's cap the task has failed and what waits behind it is blocked.
  expect(await refused()).toContain("还可以再交 2 次")
  expect(await refused()).toContain("还可以再交 1 次")
  expect(await refused()).toContain("这个任务已经被退回 4 次。这个任务已经记为没做成")
  const ended = await runner.getExternalRun({ projectId: created.id, runId: started.run.id })
  expect(ended.state).toBe("failed")
  expect(ended.tasks.map((task) => task.state)).toEqual(["failed", "blocked"])
  // The person is told in words with no field path in them; the original stays for 高级.
  expect(ended.tasks[0]?.error).not.toContain("assets.0")
  expect(ended.tasks[0]?.error_technical).toContain("model")
  expect(await openProject(directory)).toEqual(created)
})

test("模型模块写入就绪工作区资产、实体模型资产并可编译", async () => {
  const { created, directory, runner } = await setup(async () => response(modelDocument))
  const started = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "制作简单低模测试生物模型",
    module: "model",
  })
  const finished = await waitForTerminal(runner, created.id, started.id)
  expect(finished.state).toBe("completed")
  expect(finished.tasks[0]?.state).toBe("completed")
  const project = await openProject(directory)
  const workspaceAsset = project.workspace.assets.find((asset) => asset.id === finished.tasks[0]?.asset_id)
  expect(workspaceAsset?.status).toBe("ready")
  const entity = project.entities.find((value) => value.id === workspaceAsset?.id)
  expect(entity?.model_asset_id).toBeTruthy()
  expect(project.assets.some((asset) => asset.id === entity?.model_asset_id && asset.entity_id === entity?.id)).toBe(
    true,
  )
  const saved = await loadModelAsset(directory, entity!.model_asset_id!)
  const compiled = compileSavedModel(saved.data, `creature_${entity!.id.replaceAll("-", "")}`)
  expect(compiled.geometry["minecraft:geometry"]).toHaveLength(1)
  expect(saved.data).toMatchObject({ design: expect.objectContaining({ name: "测试生物" }) })
})

test("API 工程模型被退回后按验收意见重做，改好了才写入资产", async () => {
  const requests: Record<string, unknown>[] = []
  // The second answer is a model that passes the look gate; more cubes alone would not.
  const improved = { kind: "model" as const, ...ModelDesignSchema.parse(slime.model) }
  const { created, directory, runner } = await setup(async (_request, body) => {
    requests.push(requestInput(body))
    return response(requests.length === 1 ? modelDocument : improved)
  })
  const run = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "制作精美复杂生物",
    module: "model",
  })
  const result = await waitForTerminal(runner, created.id, run.id)
  expect(result.state).toBe("completed")
  expect(requests).toHaveLength(2)
  expect(requests[1]?.revision_required).toMatchObject({
    // The repair request carries the standard's own wording: which criterion, what was found, what to change.
    issues: expect.arrayContaining([{ criterion: "认得出", severity: "硬伤", message: expect.stringContaining("看得见的体块"), fix: expect.stringContaining("至少要") }]),
  })
  // Words only: no rule names and no measurements for the AI to aim at.
  expect(JSON.stringify(requests[1]?.revision_required)).not.toMatch(/too_few_parts|flat_surfaces|flatShare|visibleCubes/)
  expect((await openProject(directory)).workspace.assets).toHaveLength(1)
  await runner.dispose()
})

test("API 重做到验收上限仍不合格时任务记为没做成，不写入工程", async () => {
  let calls = 0
  const { created, directory, runner } = await setup(async () => {
    calls += 1
    return response(modelDocument)
  })
  const run = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "制作精美复杂生物",
    module: "model",
  })
  const result = await waitForTerminal(runner, created.id, run.id)
  expect(result.state).toBe("failed")
  expect(result.tasks[0]?.error).toContain(`模型改了 ${REFUSAL_CAP} 次还是没通过验收：1. 【`)
  expect(calls).toBe(REFUSAL_CAP)
  expect((await openProject(directory)).revision).toBe(created.revision)
  await runner.dispose()
})

test("后续模块获得工程世界观和实体实际已绑定动作", async () => {
  const contexts: Record<string, unknown>[] = []
  const { created, directory, runner } = await setup(async (_request, body) => {
    const input = JSON.parse(String((body.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text))
    contexts.push(input.project)
    return response(input.task.module === "model" ? modelDocument : worldview("森林设定"))
  })
  for (const module of ["model", "worldview", "worldview"] as const) {
    const project = await openProject(directory)
    const run = await runner.start({
      projectId: created.id,
      expectedRevision: project.revision,
      prompt: "继续制作森林简单低模",
      module,
    })
    expect((await waitForTerminal(runner, created.id, run.id)).state).toBe("completed")
  }
  expect(contexts.at(-1)?.worldviews).toEqual([
    expect.objectContaining({ summary: "测试设定", entries: [{ title: "入口", body: "测试内容" }] }),
  ])
  expect(contexts.at(-1)?.entities).toEqual([
    expect.objectContaining({ available_animations: modelDocument.animations.map((animation) => animation.name) }),
  ])
})

test("路由 source 不包含原始需求时拒绝执行", async () => {
  let requests = 0
  const { created, runner } = await setup(async (_request, body) => {
    requests += 1
    expect((body.text as { format: { type: string } }).format.type).toBe("json_schema")
    return response({
      summary: "错误路由",
      questions: [],
      tasks: [
        {
          key: "bad",
          module: "worldview",
          title: "错误",
          prompt: "别的",
          source: "别的",
          dependencies: [],
          target_id: null,
        },
      ],
    })
  })
  const started = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "月光森林" })
  const finished = await waitForTerminal(runner, created.id, started.id)
  expect(finished.state).toBe("failed")
  expect(requests).toBe(1)
})

test("最多并发三个模块任务，并在依赖完成后调度下游", async () => {
  let requests = 0
  let inFlight = 0
  let maximum = 0
  const arrived = new Set<string>()
  const rootsReady = Promise.withResolvers<void>()
  const releaseRoots = Promise.withResolvers<void>()
  const startedId = Promise.withResolvers<string>()
  let dependencyAtStart: string | undefined
  const { created, runner } = await setup(async (_request, body) => {
    requests += 1
    if (requests === 1)
      return response({
        summary: "并行任务",
        questions: [],
        tasks: [
          {
            key: "one",
            module: "worldview",
            title: "一",
            prompt: "并行生成",
            source: "并行生成",
            dependencies: [],
            target_id: null,
          },
          {
            key: "two",
            module: "worldview",
            title: "二",
            prompt: "并行生成",
            source: "并行生成",
            dependencies: [],
            target_id: null,
          },
          {
            key: "three",
            module: "worldview",
            title: "三",
            prompt: "并行生成",
            source: "并行生成",
            dependencies: [],
            target_id: null,
          },
          {
            key: "four",
            module: "worldview",
            title: "四",
            prompt: "并行生成",
            source: "并行生成",
            dependencies: ["one"],
            target_id: null,
          },
        ],
      })
    const input = JSON.parse(
      String((body.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text),
    ) as { task: { key: string } }
    inFlight += 1
    maximum = Math.max(maximum, inFlight)
    try {
      arrived.add(input.task.key)
      if (["one", "two", "three"].every((key) => arrived.has(key))) rootsReady.resolve()
      if (input.task.key !== "four") await releaseRoots.promise
      else {
        const run = await runner.get({ projectId: created.id, runId: await startedId.promise })
        dependencyAtStart = run.tasks.find((task) => task.key === "one")?.state
      }
      return response(worldview(input.task.key))
    } finally {
      inFlight -= 1
    }
  })
  try {
    const started = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "并行生成" })
    startedId.resolve(started.id)
    await rootsReady.promise
    expect(arrived.has("four")).toBe(false)
    releaseRoots.resolve()
    await runner.wait(started.id)
    const finished = await runner.get({ projectId: created.id, runId: started.id })
    expect(finished.state).toBe("completed")
    expect(maximum).toBeGreaterThan(1)
    expect(maximum).toBeLessThanOrEqual(3)
    expect(dependencyAtStart).toBe("completed")
    expect(finished.tasks.every((task) => task.state === "completed")).toBe(true)
    expect(finished.tasks.find((task) => task.key === "four")?.state).toBe("completed")
  } finally {
    releaseRoots.resolve()
    await runner.dispose()
  }
}, 120_000)

test("失败任务隔离并阻塞其下游任务", async () => {
  let requests = 0
  const { created, runner } = await setup(async (_request, body) => {
    requests += 1
    if (requests === 1)
      return response({
        summary: "依赖任务",
        questions: [],
        tasks: [
          {
            key: "failed",
            module: "worldview",
            title: "失败",
            prompt: "先失败",
            source: "先失败",
            dependencies: [],
            target_id: null,
          },
          {
            key: "blocked",
            module: "worldview",
            title: "下游",
            prompt: "先失败",
            source: "先失败",
            dependencies: ["failed"],
            target_id: null,
          },
        ],
      })
    return response({ kind: "wrong" })
  })
  const started = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "先失败" })
  const finished = await waitForTerminal(runner, created.id, started.id)
  expect(finished.state).toBe("failed")
  expect(finished.tasks.find((task) => task.key === "failed")?.state).toBe("failed")
  expect(finished.tasks.find((task) => task.key === "blocked")?.state).toBe("blocked")
  // The routing request, and the failing task's own request tried as often as a misshapen answer is (`AUTHORING_RETRY.tries`),
  // each try being the answer and its one repair turn (every route parses leniently and repairs once).
  expect(requests).toBe(1 + AUTHORING_RETRY.tries * 2)
  // What is stored for the person is a sentence, not the code of the failure.
  expect(finished.tasks.find((task) => task.key === "failed")?.error).toMatch(/[一-鿿]/)
  expect(JSON.stringify(finished)).not.toContain("INVALID_OUTPUT")
})

/** A plan of tasks where each stands on the one before it, the first of which can never come out (the answer is always the wrong shape). */
function chain(...keys: string[]) {
  return response({
    summary: "一条链",
    questions: [],
    tasks: keys.map((key, index) => ({ key, module: "worldview", title: `第${index + 1}样`, prompt: "先失败", source: "先失败", dependencies: index ? [keys[index - 1]!] : [], target_id: null })),
  })
}

const said = async (directory: string) => (await readActivity(directory)).events.filter((event) => event.kind === "task" && event.end).map((event) => `${event.title}: ${event.text}`)

test("上游失败时，排在后面的任务（不管隔了几层）都被说成在等没做成的那一样，运行也正常收尾，不会被当成应用关掉", async () => {
  let requests = 0
  const { created, directory, runner } = await setup(async () => {
    requests += 1
    return requests === 1 ? chain("first", "second", "third") : response({ kind: "wrong" })
  })
  const started = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "先失败" })
  const finished = await waitForTerminal(runner, created.id, started.id)
  // The run ends as a failure of its first task: the ones behind it were held back, the last of them through the one before.
  expect(finished.state).toBe("failed")
  expect(finished.tasks.map((task) => task.state)).toEqual(["failed", "blocked", "blocked"])
  // Read again by a Studio that opens it later: still what it was, not "interrupted".
  const reopened = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  expect((await reopened.list(created.id))[0]!.state).toBe("failed")
  const second = "第2样: 要用的「第1样」没做成，这一样先放着。"
  const third = "第3样: 要用的「第1样」没做成，这一样先放着。"
  const lines = await untilObserved(() => said(directory), (lines) => lines.includes(second) && lines.includes(third))
  expect(lines).toContain(second)
  expect(lines).toContain(third)
  expect(lines.join("\n")).not.toContain("应用关掉了")
}, 120_000)

test("应用真的关掉再打开：被关掉时在做的说「应用关掉了」，只是在等一个已经失败的东西的，仍然说在等它", async () => {
  let requests = 0
  const { created, directory, runner } = await setup(async () => {
    requests += 1
    return requests === 1 ? chain("first", "second") : response({ kind: "wrong" })
  })
  const started = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "先失败" })
  await waitForTerminal(runner, created.id, started.id)
  // The record as the app left it when it closed: the first task had failed, the second was waiting, a third was in the middle of being made.
  const file = path.join(directory, ".minemods", "runs", `${started.id}.json`)
  const record = JSON.parse(await readFile(file, "utf8")) as { state: string; tasks: Record<string, unknown>[]; events: unknown[] }
  const [first, second] = record.tasks as [Record<string, unknown>, Record<string, unknown>]
  const third = { ...second, id: crypto.randomUUID(), asset_id: crypto.randomUUID(), key: "third", title: "第3样", dependencies: [], state: "running", detail: "", started_at: new Date().toISOString(), finished_at: null }
  await writeFile(file, JSON.stringify({ ...record, state: "running", tasks: [first, { ...second, state: "queued", detail: "", finished_at: null }, third] }))
  const restarted = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  const [run] = await restarted.list(created.id)
  expect(run!.state).toBe("interrupted")
  expect(run!.tasks.map((task) => [task.key, task.state, task.detail])).toEqual([
    ["first", "failed", String(first.detail)],
    ["second", "blocked", "依赖任务未完成，已阻塞。"],
    ["third", "blocked", "制作中断了。需要的话可以接着做。"],
  ])
  const blocked = "第2样: 要用的「第1样」没做成，这一样先放着。"
  const interrupted = "第3样: 做到一半，应用关掉了，这一样没有做完。"
  const lines = await untilObserved(() => said(directory), (lines) => lines.includes(blocked) && lines.includes(interrupted))
  expect(lines).toContain(blocked)
  expect(lines).toContain(interrupted)
}, 120_000)

test("取消正在等待模型的运行不会晚写资产", async () => {
  const entered = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<void>()
  const { created, directory, runner } = await setup(async (request) => {
    entered.resolve()
    await pending.promise
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return response(worldview("不应写入"))
  })
  const started = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "等待后生成",
    module: "worldview",
  })
  try {
    await entered.promise
    await runner.cancel({ projectId: created.id, runId: started.id })
  } finally {
    pending.resolve()
  }
  await runner.wait(started.id)
  expect((await openProject(directory)).revision).toBe(created.revision)
  expect(
    ((await openProject(directory)) as typeof created & { workspace?: { assets: unknown[] } }).workspace?.assets ?? [],
  ).toHaveLength(0)
}, 120_000)

test("目标资产 revision 发生冲突时保持旧文档", async () => {
  let requests = 0
  const entered = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<void>()
  const { created, directory, runner } = await setup(async (_request, body) => {
    requests += 1
    if (requests === 1) return response(worldview("旧资产"))
    entered.resolve()
    await pending.promise
    const input = JSON.parse(
      String((body.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text),
    ) as { task: { title: string } }
    return response(worldview(input.task.title))
  })
  const first = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "创建旧资产",
    module: "worldview",
  })
  const firstFinished = await waitForTerminal(runner, created.id, first.id)
  const assetId = firstFinished.tasks[0]!.asset_id
  const afterFirst = await openProject(directory)
  const target = afterFirst.workspace.assets.find((asset) => asset.id === assetId)!
  const second = await runner.start({
    projectId: created.id,
    expectedRevision: afterFirst.revision,
    prompt: "覆盖旧资产",
    module: "worldview",
    assetId,
  })
  const stillChanged = await (async () => {
    try {
      await entered.promise
      const beforeExternal = await openProject(directory)
      const changed = WorkspaceAssetSchema.parse({
        ...target,
        revision: target.revision + 1,
        updated_at: new Date().toISOString(),
        document: worldview("外部修改"),
      })
      await saveProject(directory, applyWorkspaceAsset(beforeExternal, changed), beforeExternal.revision)
      return (await openProject(directory)).workspace.assets.find((asset) => asset.id === assetId)!
    } finally {
      pending.resolve()
    }
  })()
  const secondFinished = await waitForTerminal(runner, created.id, second.id)
  expect(secondFinished.state).toBe("failed")
  expect((await openProject(directory)).workspace.assets.find((asset) => asset.id === assetId)?.revision).toBe(
    stillChanged.revision,
  )
}, 120_000)

test("重载时把没有活动执行器的 planning 运行标为 interrupted", async () => {
  const { created, directory, runner } = await setup(async () => {
    await Bun.sleep(250)
    return response(worldview("不会保存"))
  })
  const started = await runner.start({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "挂起",
    module: "worldview",
  })
  await runner.dispose()
  const reloaded = createProjectRunner({ directoryFor: async () => directory, ai: { apiKey: "fixture-key" } })
  const runs = await reloaded.list(created.id)
  expect(runs.find((run) => run.id === started.id)?.state).toBe("interrupted")
})

test("修改已有资产时保留依赖并把真实依赖文档传入模块模型", async () => {
  let moduleInput: Record<string, unknown> | undefined
  const { created, directory, runner } = await setup(async (_request, body) => {
    moduleInput = requestInput(body)
    return response(modelDocument)
  })
  const dependencyDocument = worldview("父级设定")
  const dependency = workspaceAsset(dependencyDocument, "worldview")
  const existing = workspaceAsset(modelDocument, "model", { dependencies: [dependency.id] })
  const staged = applyWorkspaceAsset(applyWorkspaceAsset(created, dependency), existing)
  const saved = await saveProject(directory, staged, created.revision)

  const started = await runner.start({
    projectId: created.id,
    expectedRevision: saved.revision,
    prompt: "修改测试生物模型",
    module: "model",
    assetId: existing.id,
  })
  const finished = await waitForTerminal(runner, created.id, started.id)
  expect(finished.state).toBe("completed")
  expect(moduleInput?.existing).toEqual(modelDocument)
  expect(moduleInput?.dependency_results).toEqual([
    { id: dependency.id, module: "worldview", title: dependency.title, document: dependencyDocument },
  ])
  const project = await openProject(directory)
  expect(project.workspace.assets.find((asset) => asset.id === existing.id)?.dependencies).toEqual([dependency.id])
  expect(project.workspace.assets.find((asset) => asset.id === existing.id)?.revision).toBe(2)
})

test("awaiting_input 多次列出和重载不会标为 interrupted，也不会请求模块模型", async () => {
  let requests = 0
  const { created, runner, directory } = await setup(async (_request, body) => {
    requests += 1
    expect(body.text).toBeDefined()
    return response({
      summary: "需要补充信息",
      questions: ["请补充生物外观"],
      tasks: [
        {
          key: "draft",
          module: "worldview",
          title: "等待补充",
          prompt: "等待补充",
          source: "等待补充",
          dependencies: [],
          target_id: null,
        },
      ],
    })
  })
  const started = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "等待补充" })
  const waiting = await waitForTerminal(runner, created.id, started.id)
  expect(waiting.state).toBe("awaiting_input")
  const first = await runner.list(created.id)
  const second = await runner.list(created.id)
  const reloaded = createProjectRunner({ directoryFor: async () => directory, ai: { apiKey: "fixture-key" } })
  const afterReload = await reloaded.list(created.id)
  expect(first.find((run) => run.id === started.id)?.state).toBe("awaiting_input")
  expect(second.find((run) => run.id === started.id)?.state).toBe("awaiting_input")
  expect(afterReload.find((run) => run.id === started.id)?.state).toBe("awaiting_input")
  expect(afterReload.find((run) => run.id === started.id)?.updated_at).toBe(waiting.updated_at)
  expect(requests).toBe(1)
})

test("取消并行运行时保留已完成资产并报告已保存数量", async () => {
  let moduleRequests = 0
  let releasePending!: () => void
  const pending = new Promise<void>((resolve) => {
    releasePending = resolve
  })
  const { created, directory, runner } = await setup(async (request, body) => {
    const input = requestInput(body)
    if (!input.task) {
      return response({
        summary: "并行保存",
        questions: [],
        tasks: [
          {
            key: "done",
            module: "worldview",
            title: "已完成",
            prompt: "并行取消",
            source: "并行取消",
            dependencies: [],
            target_id: null,
          },
          {
            key: "pending",
            module: "worldview",
            title: "等待中",
            prompt: "并行取消",
            source: "并行取消",
            dependencies: [],
            target_id: null,
          },
        ],
      })
    }
    moduleRequests += 1
    const task = input.task as { key: string }
    if (task.key === "done") return response(worldview("已完成"))
    await pending
    if (request.signal.aborted) return new Response(null, { status: 499 })
    return response(worldview("不应保存"))
  })
  const started = await runner.start({ projectId: created.id, expectedRevision: created.revision, prompt: "并行取消" })
  let running = await runner.get({ projectId: created.id, runId: started.id })
  for (
    let attempt = 0;
    attempt < 200 && running.tasks.find((task) => task.key === "done")?.state !== "completed";
    attempt += 1
  ) {
    await Bun.sleep(10)
    running = await runner.get({ projectId: created.id, runId: started.id })
  }
  expect(running.tasks.find((task) => task.key === "done")?.state).toBe("completed")
  const canceled = await runner.cancel({ projectId: created.id, runId: started.id })
  expect(canceled.state).toBe("canceled")
  expect(canceled.summary).toContain("已保存 1 个模块资产")
  expect(canceled.tasks.find((task) => task.key === "done")?.state).toBe("completed")
  expect(canceled.tasks.find((task) => task.key === "pending")?.state).toBe("canceled")
  expect((await openProject(directory)).workspace.assets.map((asset) => asset.title)).toEqual(["已完成"])
  expect(moduleRequests).toBe(2)
  releasePending()
  await runner.dispose()
})

test("蓝图条目分两批制作：保存后回填资产，后一批拿到前一批的模型 UV", async () => {
  const { created, directory, runner } = await setup(() => {
    throw new Error("外部模式不应调用 API")
  })
  const entry = (key: string, kind: "model" | "texture", needs: string[]) => ({ key, kind, title: key, brief: `制作 ${key}`, owner: null, needs, out_of_scope: null })
  const draft = replaceBlueprint(created, {
    request: "简单低模苔狐",
    style: { palette: ["#334455"], shape: "圆润", naming: "", world: "" },
    entries: [entry("fox_model", "model", []), entry("fox_skin", "texture", ["fox_model"])],
    questions: [],
  })
  const planned = await saveProject(directory, draft, created.revision)
  // A draft plan is not something the person agreed to, so nothing may be made from it.
  await expect(
    runner.startExternal({ projectId: created.id, expectedRevision: planned.revision, prompt: "简单低模苔狐", plan: nextBlueprintBatch(confirmBlueprint(planned, 1).blueprint!, []) }),
  ).rejects.toThrow("任务没有对应的原始需求")
  const confirmed = await saveProject(directory, confirmBlueprint(planned, 1), planned.revision)
  const input = (runId: string, taskId: string) => ({ projectId: created.id, runId, taskId })

  // Pretend the run limit split the two entries: the model goes first, on its own.
  const first = await runner.startExternal({
    projectId: created.id,
    expectedRevision: confirmed.revision,
    prompt: confirmed.blueprint!.request,
    plan: { ...nextBlueprintBatch(confirmed.blueprint!, [])!, tasks: nextBlueprintBatch(confirmed.blueprint!, [])!.tasks.slice(0, 1) },
  })
  expect(first.run.tasks.map((task) => task.source)).toEqual(["blueprint:fox_model"])
  await runner.claimExternalTask(input(first.run.id, first.run.tasks[0]!.id))
  await runner.commitExternalTask({ ...input(first.run.id, first.run.tasks[0]!.id), document: modelDocument })
  const afterModel = await openProject(directory)
  const modelId = first.run.tasks[0]!.asset_id
  expect(afterModel.blueprint!.entries.map((value) => value.asset_id)).toEqual([modelId, null])
  expect(afterModel.blueprint).toMatchObject({ revision: 1, state: "confirmed" })

  const second = await runner.startExternal({
    projectId: created.id,
    expectedRevision: afterModel.revision,
    prompt: afterModel.blueprint!.request,
    plan: nextBlueprintBatch(afterModel.blueprint!, ["fox_model"]),
  })
  expect(second.run.tasks.map((task) => [task.key, task.dependencies])).toEqual([["fox_skin", []]])
  const context = await runner.claimExternalTask(input(second.run.id, second.run.tasks[0]!.id))
  expect(context.model_context[0]).toMatchObject({ asset_id: modelId, atlas_size: 64 })
  expect(context.dependency_results.map((asset) => asset.id)).toEqual([modelId])
  const finished = await runner.commitExternalTask({
    ...input(second.run.id, second.run.tasks[0]!.id),
    document: { kind: "texture", width: 64, height: 64, palette: ["#334455"], pixels: Array(64 * 64).fill(0) },
  })
  expect(finished.state).toBe("completed")
  const done = await openProject(directory)
  const skinId = second.run.tasks[0]!.asset_id
  expect(done.blueprint!.entries.map((value) => value.asset_id)).toEqual([modelId, skinId])
  expect(done.workspace.assets.find((asset) => asset.id === skinId)!.dependencies).toEqual([modelId])
  expect(nextBlueprintBatch(done.blueprint!, ["fox_model", "fox_skin"])).toBeNull()
})

// broad20: a creature's tier raises the detail of its own model; the maker is told the one range of the level it is made by, never the button's and the tier's both.
test("生物档位抬高它自己模型的精细度：Boss + 顶部「低」，两条路上的 AI 都只拿到「高」那一个范围；别的模型和更低的档位不受影响，顶部更高时照顶部", async () => {
  const complexity = { value: "low" as ModelComplexity }
  const sent: { instructions: string; quality: { complexity?: string | null } }[] = []
  const { created, directory, runner } = await setup(async (_request, body) => {
    sent.push({ instructions: String(body.instructions), quality: requestInput(body).quality as never })
    return response(modelDocument)
  }, complexity)
  const entry = (key: string, kind: "model" | "entity", extra: Record<string, unknown> = {}) => ({ key, kind, title: key, brief: `制作 ${key}`, owner: null, needs: [], out_of_scope: null, ...extra })
  const tier = (level: "simple" | "boss") => ({ level, reason: "测试", by: "ai" as const })
  const planned = await saveProject(
    directory,
    replaceBlueprint(
      created,
      played({
        request: "一只 Boss、一只简单的小东西和一块石头",
        style: { palette: ["#334455"], shape: "圆润", naming: "", world: "" },
        entries: [
          entry("boss_model", "model", { owner: "boss" }),
          entry("boss", "entity", { needs: ["boss_model"], tier: tier("boss") }),
          entry("cub_model", "model", { owner: "cub" }),
          entry("cub", "entity", { needs: ["cub_model"], tier: tier("simple") }),
          entry("rock_model", "model"),
        ],
        questions: [],
      }),
    ),
    created.revision,
  )
  const confirmed = await saveProject(directory, confirmBlueprint(planned, 1), planned.revision)
  const batch = nextBlueprintBatch(confirmed.blueprint!, [])!
  const range = (level: ModelComplexity) => `${MODEL_COMPLEXITY_PRESETS[level].targetMinCubes}–${MODEL_COMPLEXITY_PRESETS[level].targetMaxCubes} 个体块`
  const only = (told: string, level: ModelComplexity) => {
    // The one range, and the instructions' 复杂度档位 sentence said once; no other level's range is in it.
    // The sentence itself once (other lines may point at it by name).
    expect(told.match(/复杂度档位：/g)).toHaveLength(1)
    expect(told).toContain(`复杂度档位：${MODEL_COMPLEXITY_PRESETS[level].label}（${level}）`)
    expect(told).toContain(range(level))
    for (const other of (["low", "medium", "high"] as const).filter((value) => value !== level)) expect(told).not.toContain(range(other))
  }

  // Studio's own AI: one run per model, so the first request of a run is that model's.
  const ownLevel = async (key: string) => {
    const before = sent.length
    const current = await openProject(directory)
    const started = await runner.startPlanned({ projectId: created.id, expectedRevision: current.revision, prompt: confirmed.blueprint!.request, plan: { ...batch, tasks: batch.tasks.filter((task) => task.key === key) } }, false)
    await waitForTerminal(runner, created.id, started.run.id)
    return sent[before]!
  }
  // The button says 低.
  const boss = await ownLevel("boss_model")
  only(boss.instructions, "high")
  expect(boss.quality.complexity).toBe("high")
  const cub = await ownLevel("cub_model")
  only(cub.instructions, "low")
  expect(cub.quality.complexity).toBe("low")
  const rock = await ownLevel("rock_model")
  only(rock.instructions, "low")
  expect(rock.quality.complexity).toBe("low")
  // The button higher than the tier: the button. The run still records the button's own setting.
  complexity.value = "high"
  only((await ownLevel("cub_model")).instructions, "high")

  // An outside AI claims the same tasks and is given the same one range, in its instructions and in quality.complexity.
  complexity.value = "low"
  const external = await runner.startExternal({ projectId: created.id, expectedRevision: (await openProject(directory)).revision, prompt: confirmed.blueprint!.request, plan: { ...batch, tasks: batch.tasks.filter((task) => task.key.endsWith("_model")) } })
  const claim = async (key: string) => runner.claimExternalTask({ projectId: created.id, runId: external.run.id, taskId: external.run.tasks.find((task) => task.key === key)!.id })
  const outsideBoss = await claim("boss_model")
  only(outsideBoss.instructions, "high")
  expect(outsideBoss.quality.complexity).toBe("high")
  expect(external.run.model_complexity).toBe("low")
  const outsideCub = await claim("cub_model")
  only(outsideCub.instructions, "low")
  expect(outsideCub.quality.complexity).toBe("low")
  const outsideRock = await claim("rock_model")
  only(outsideRock.instructions, "low")
  await runner.dispose()
})

test("MCP 模型反复过不了验收时，几次之后任务记为没做成，不会一直占着这一批", async () => {
  const { created, runner } = await setup(() => {
    throw new Error("外部模式不应调用 API")
  })
  const started = await runner.startExternal({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "一只细节丰富的森林巨兽模型",
    plan: {
      summary: "模型",
      questions: [],
      tasks: [{ key: "model", module: "model", title: "模型", prompt: "细节丰富的森林巨兽", source: "森林巨兽", dependencies: [], target_id: null }],
    },
  })
  const ids = { projectId: created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  await runner.claimExternalTask(ids)
  const attempt = () => runner.commitExternalTask({ ...ids, document: modelDocument }).then(() => "saved", (error: Error) => error.message)
  for (let index = 1; index < REFUSAL_CAP; index++) {
    expect(await attempt()).toContain("当前任务保持运行")
    expect((await runner.get({ projectId: created.id, runId: started.run.id })).tasks[0]?.state).toBe("running")
  }
  expect(await attempt()).toContain("已经记为没做成")
  const failed = (await runner.get({ projectId: created.id, runId: started.run.id })).tasks[0]
  expect(failed?.state).toBe("failed")
  expect(failed?.error).toContain("还是没通过验收")
  expect(await attempt()).toContain("尚未领取或已结束")
})

// One choke point for everything an AI hands in, whatever the kind and whichever AI: the same standard, the
// same wording, the same cap. The specimens are the ones the standard's own tests keep as evidence.
const stiffCast = () => Bun.file(new URL("../../mod-core/test/fixtures/gesture-bad/a-old-sword-fingers.json", import.meta.url)).json()
const specimen = async (name: string) => (await Bun.file(new URL(`../../mod-core/test/fixtures/acceptance/bad/${name}.json`, import.meta.url)).json()).document
const tier = { value: "medium" as ModelComplexity }

test("Studio 自己的 AI 做的施法动作走同一个验收口：僵硬的被退回重做，改好了才保存，到上限还改不好就不保存", async () => {
  const requests: Record<string, unknown>[] = []
  const stiff = await stiffCast()
  const fixed = await setup(async (_request, body) => {
    requests.push(requestInput(body))
    return response(requests.length === 1 ? stiff : GESTURE_EXAMPLE)
  }, tier)
  const run = await fixed.runner.start({ projectId: fixed.created.id, expectedRevision: fixed.created.revision, prompt: "做一个向前推出的施法动作", module: "gesture" })
  const result = await waitForTerminal(fixed.runner, fixed.created.id, run.id)
  expect(result.state).toBe("completed")
  expect(requests).toHaveLength(2)
  // Told before it starts, in the kind's own instructions; told again after the refusal, criterion by criterion.
  expect(requests[0]?.quality).toMatchObject({ standard: expect.stringContaining("验收标准（施法动作）") })
  expect(requests[1]?.revision_required).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ criterion: "有主次", message: expect.stringContaining("出手前没有预备动作") }), expect.objectContaining({ criterion: "不机械", message: expect.stringContaining("关键帧是匀速转过去的") })]) })
  expect(result.events.some((entry) => entry.message.includes("施法动作没通过验收，工程里什么都没有改动。必须逐条改掉：1. 【认得出】"))).toBe(true)
  expect((await openProject(fixed.directory)).workspace.assets.map((asset) => asset.module)).toEqual(["gesture"])
  await fixed.runner.dispose()

  const stuck = await setup(async () => response(stiff), tier)
  const failed = await waitForTerminal(stuck.runner, stuck.created.id, (await stuck.runner.start({ projectId: stuck.created.id, expectedRevision: stuck.created.revision, prompt: "做一个向前推出的施法动作", module: "gesture" })).id)
  expect(failed.state).toBe("failed")
  expect(failed.tasks[0]?.error).toContain(`施法动作改了 ${REFUSAL_CAP} 次还是没通过验收：1. 【认得出】`)
  expect((await openProject(stuck.directory)).revision).toBe(stuck.created.revision)
  await stuck.runner.dispose()
})

test("外部 AI 交上来的每一类都过同一个验收口，同样最多退回四次", async () => {
  const { created, directory, runner } = await setup(() => {
    throw new Error("外部模式不应调用 API")
  }, tier)
  const task = (key: string, module: "gesture" | "item" | "recipe" | "worldview") => ({ key, module, title: key, prompt: `做${key}`, source: "做一套符咒师的东西", dependencies: [], target_id: null })
  const started = await runner.startExternal({
    projectId: created.id,
    expectedRevision: created.revision,
    prompt: "做一套符咒师的东西",
    plan: { summary: "符咒师", questions: [], tasks: [task("cast", "gesture"), task("icon", "item"), task("lore", "worldview")] },
  })
  const ids = (key: string) => ({ projectId: created.id, runId: started.run.id, taskId: started.run.tasks.find((value) => value.key === key)!.id })
  const hand = (key: string, document: unknown) => runner.commitExternalTask({ ...ids(key), document: document as never }).then(() => "saved", (error: Error) => error.message)
  await Promise.all(["cast", "icon", "lore"].map((key) => runner.claimExternalTask(ids(key))))
  // An item whose picture is static: refused under the criterion it breaks, with what to change.
  const noisy = await hand("icon", await specimen("static-item"))
  expect(noisy).toMatch(/^物品没通过验收，工程里什么都没有改动。必须逐条改掉：1\. 【不机械】物品图标的图上到处是孤立的杂点.+怎么改：/)
  expect(noisy).toContain(`还可以再交 ${REFUSAL_CAP - 1} 次`)
  expect((await runner.getExternalProgress({ projectId: created.id, runId: started.run.id })).drafts[ids("icon").taskId]?.quality).toMatchObject({ kind: "item", passed: false, findings: [{ rule: "noisy_texture" }] })
  // The same item with no picture of its own has nothing to measure: it is saved, and the review says it was not judged.
  expect(await hand("icon", { ...(await specimen("static-item")), texture: null })).toBe("saved")
  // A design-only kind is never refused by the standard: there is nothing in it to measure.
  expect(await hand("lore", { kind: "worldview", title: "符咒师", summary: "", entries: [] })).toBe("saved")
  // A cast action is capped like a model: three refusals keep the task open, the fourth closes it.
  const stiff = await stiffCast()
  for (let attempt = 1; attempt < REFUSAL_CAP; attempt++) expect(await hand("cast", stiff)).toContain("当前任务保持运行")
  expect(await hand("cast", stiff)).toContain(`施法动作改了 ${REFUSAL_CAP} 次还是没通过验收`)
  expect((await runner.get({ projectId: created.id, runId: started.run.id })).tasks.map((value) => [value.key, value.state])).toEqual([["cast", "failed"], ["icon", "completed"], ["lore", "completed"]])
  expect((await openProject(directory)).workspace.assets.map((asset) => asset.module).sort()).toEqual(["item", "worldview"])
  await runner.dispose()
})

test.each([
  ["gesture", "做一个向前推出的施法动作", stiffCast],
  ["item", "做一个宝石图标", () => specimen("static-item")],
  ["animation", "做一个摆尾巴的动作", () => specimen("robot-swing")],
  ["recipe", "做一个宝石的配方", () => specimen("gem-from-gem")],
  ["entity", "做一只追人的猎手", () => specimen("toothless-hunter")],
  ["model", "做一只森林巨兽", () => modelDocument],
] as const)("两条路退回同一件样品（%s）：同一个验收口、同样的发现、同样的话、同样的上限", async (module, prompt, read) => {
  const entry = { module, prompt, document: await read() }
  // Studio's own AI keeps answering with the specimen.
  const calls = { count: 0 }
  const own = await setup(async () => {
    calls.count += 1
    return response(entry.document)
  }, tier)
  const run = await own.runner.start({ projectId: own.created.id, expectedRevision: own.created.revision, prompt: entry.prompt, module: entry.module })
  await own.runner.wait(run.id)
  const finished = await own.runner.get({ projectId: own.created.id, runId: run.id })
  const told = finished.events.filter((value) => value.message.includes("没通过验收，工程里什么都没有改动")).map((value) => value.message)
  // An outside AI hands in the same specimen for the same request.
  const outside = await setup(() => {
    throw new Error("外部模式不应调用 API")
  }, tier)
  const started = await outside.runner.startExternal({
    projectId: outside.created.id,
    expectedRevision: outside.created.revision,
    prompt: entry.prompt,
    plan: { summary: entry.prompt, questions: [], tasks: [{ key: "work", module: entry.module, title: "样品", prompt: entry.prompt, source: entry.prompt, dependencies: [], target_id: null }] },
  })
  const ids = { projectId: outside.created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  await outside.runner.claimExternalTask(ids)
  const heard: string[] = []
  for (let attempt = 0; attempt < REFUSAL_CAP; attempt++) heard.push(await outside.runner.commitExternalTask({ ...ids, document: entry.document as never }).then(() => "saved", (error: Error) => error.message))

  // Every refusal below the cap says the same thing on both roads, and so does the last one.
  expect({ module: entry.module, calls: calls.count, told: told.length }).toEqual({ module: entry.module, calls: REFUSAL_CAP, told: REFUSAL_CAP - 1 })
  told.forEach((message, index) => expect({ module: entry.module, same: heard[index]!.slice(0, 1200).startsWith(message.slice(0, 1100)) }).toEqual({ module: entry.module, same: true }))
  expect(finished.tasks[0]).toMatchObject({ state: "failed" })
  expect(heard[REFUSAL_CAP - 1]!.startsWith(finished.tasks[0]!.error!)).toBe(true)
  expect(finished.tasks[0]!.error).toMatch(new RegExp(`改了 ${REFUSAL_CAP} 次还是没通过验收：1\\. 【(不凑数|不机械|认得出|有主次|站得住|配得上)】`))
  expect((await outside.runner.get({ projectId: outside.created.id, runId: started.run.id })).tasks[0]).toMatchObject({ state: "failed", error: finished.tasks[0]!.error })
  // Nothing of it reached either project.
  expect((await openProject(own.directory)).revision).toBe(own.created.revision)
  expect((await openProject(outside.directory)).revision).toBe(outside.created.revision)
  await own.runner.dispose()
  await outside.runner.dispose()
}, 120000)

test("重做 AI 做的东西照样完整验收；AI 改人自己做的东西也从这个口进", async () => {
  const { created, directory, runner } = await setup(() => {
    throw new Error("外部模式不应调用 API")
  }, tier)
  const good = async (name: string) => (await Bun.file(new URL(`../../mod-core/test/fixtures/acceptance/good/${name}.json`, import.meta.url)).json()).document
  const open = async (targetId: string | null) => {
    const project = await openProject(directory)
    const started = await runner.startExternal({
      projectId: created.id,
      expectedRevision: project.revision,
      prompt: "做一个宝石图标",
      plan: { summary: "宝石", questions: [], tasks: [{ key: "gem", module: "item", title: "宝石", prompt: "做一个宝石图标", source: "做一个宝石图标", dependencies: [], target_id: targetId }] },
    })
    const ids = { projectId: created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
    return { ids, context: await runner.claimExternalTask(ids), assetId: started.run.tasks[0]!.asset_id }
  }
  const hand = (ids: { projectId: string; runId: string; taskId: string }, document: unknown) => runner.commitExternalTask({ ...ids, document: document as never }).then(() => "saved", (error: Error) => error.message)
  // An AI makes a good icon.
  const first = await open(null)
  expect(first.context.quality.existing).toBeNull()
  expect(await hand(first.ids, await good("gem-item"))).toBe("saved")
  // Redoing it is fresh AI work: told what the standard thinks of the version it starts from, and judged in full, craft included.
  const redo = await open(first.assetId)
  expect(redo.context.quality.existing).toMatchObject({ kind: "item", passed: true, findings: [] })
  expect(await hand(redo.ids, await specimen("static-item"))).toContain("物品没通过验收")
  expect(await hand(redo.ids, await specimen("flat-item"))).toMatch(/【有主次】物品图标的图只看得出 1 种颜色/)
  expect((await openProject(directory)).workspace.assets[0]).toMatchObject({ revision: 1, provenance: { model: "external-model" } })
  await runner.failExternalTask({ ...redo.ids, error: "测试结束" })
  // Once a person owns it, the version on disk is nobody's hand-in: nothing is said about it to the AI that is asked to change it…
  const project = await openProject(directory)
  await saveProject(directory, { ...project, workspace: { assets: project.workspace.assets.map((asset) => ({ ...asset, document: { ...asset.document, max_stack: 8 } as never, provenance: { model: null, request_id: null } })) } }, project.revision)
  const revise = await open(first.assetId)
  expect(revise.context.quality.existing).toBeNull()
  // …and what the AI hands in for it still goes through the door: inside Studio a tier is always chosen, so it is judged in full.
  expect(await hand(revise.ids, await specimen("static-item"))).toContain("物品没通过验收")
  expect(await hand(revise.ids, await good("wand-item"))).toBe("saved")
  expect((await openProject(directory)).workspace.assets[0]).toMatchObject({ revision: 2, document: { texture: (await good("wand-item")).texture }, provenance: { model: "external-model" } })
  await runner.dispose()
})

test("修改已有的东西，名字不变；新做的东西才用任务的名字", async () => {
  const { created, directory, runner } = await setup(() => {
    throw new Error("外部模式不应调用 API")
  }, tier)
  const good = async (name: string) => (await Bun.file(new URL(`../../mod-core/test/fixtures/acceptance/good/${name}.json`, import.meta.url)).json()).document
  const make = async (title: string, targetId: string | null, document: unknown) => {
    const project = await openProject(directory)
    const started = await runner.startExternal({
      projectId: created.id,
      expectedRevision: project.revision,
      prompt: "做一个宝石图标",
      plan: { summary: "宝石", questions: [], tasks: [{ key: "gem", module: "item", title, prompt: "做一个宝石图标", source: "做一个宝石图标", dependencies: [], target_id: targetId }] },
    })
    const ids = { projectId: created.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
    await runner.claimExternalTask(ids)
    await runner.commitExternalTask({ ...ids, document: document as never })
    return started.run.tasks[0]!.asset_id
  }
  // A task that creates an asset gives it its first title.
  const id = await make("宝石", null, await good("gem-item"))
  expect((await openProject(directory)).workspace.assets).toMatchObject([{ id, title: "宝石", revision: 1 }])
  // Revising it is a task with a label of its own; the asset keeps its name, and the one task still saves a new version.
  expect(await make("宝石修订", id, await good("wand-item"))).toBe(id)
  expect((await openProject(directory)).workspace.assets).toMatchObject([{ id, title: "宝石", revision: 2 }])
  // Confirming it again changes nothing about the name either.
  await make("宝石通过版本确认", id, await good("gem-item"))
  expect((await openProject(directory)).workspace.assets).toMatchObject([{ id, title: "宝石", revision: 3 }])
  await runner.dispose()
})

test("makeAsset：已有的资产沿用原来的名字，没有就用任务的名字，其余照任务来", async () => {
  const document = (await Bun.file(new URL("../../mod-core/test/fixtures/acceptance/good/gem-item.json", import.meta.url)).json()).document
  const task = { asset_id: crypto.randomUUID(), module: "item" as const, title: "宝石", prompt: "做一个宝石图标" }
  const made = makeAsset(task, document, undefined, [], "m", crypto.randomUUID(), "fabric-1.21.1")
  expect(made).toMatchObject({ id: task.asset_id, title: "宝石", revision: 1, prompt: "做一个宝石图标" })
  const revised = makeAsset({ ...task, title: "宝石修订", prompt: "改淡一点" }, document, made, [], "m", crypto.randomUUID(), "fabric-1.21.1")
  expect(revised).toMatchObject({ id: task.asset_id, title: "宝石", revision: 2, prompt: "改淡一点", created_at: made.created_at })
})

test("AI 的作品进工程只有一个口：先验收后保存都在保存任务资产的那一个函数里，两条路都只调用它", async () => {
  const source = await Bun.file(new URL("../src/main/project-runner.ts", import.meta.url)).text()
  const door = source.slice(source.indexOf("async function saveTaskAsset("), source.indexOf("async function runTask("))
  // Inside the door: the review comes before anything is written, and refused work leaves with nothing saved.
  expect(door.indexOf("acceptanceReview(")).toBeGreaterThan(0)
  expect(door.indexOf("if (!review.passed) return { asset: null, review }")).toBeGreaterThan(door.indexOf("acceptanceReview("))
  // Round 10: everything a save prepares (the asset, the project with it in place, a model's compile) is staged in one function, after the review and before anything is written; a look asks the same function beforehand and writes nothing.
  expect(door.indexOf("stagedAsset(")).toBeGreaterThan(door.indexOf("if (!review.passed) return { asset: null, review }"))
  expect(door.indexOf("persistWorkspaceModelUnlocked(")).toBeGreaterThan(door.indexOf("stagedAsset("))
  expect(source.slice(source.indexOf("function stagedAsset("), source.indexOf("function moduleJsonSchema(")).indexOf("applyWorkspaceAsset(")).toBeGreaterThan(0)
  expect(source.split("stagedAsset(").length - 1).toBe(3)
  // The normal authoring paths and an explicit end-of-making keep still use this door.
  // Recovering after a restart only changes the run record and leaves the draft beside it.
  expect(source.split("applyWorkspaceAsset(").length - 1).toBe(1)
  expect(source.split("persistWorkspaceModelUnlocked(").length - 1).toBe(1)
  expect(source.split("await saveTaskAsset(").length - 1).toBe(3)
  const interruption = source.slice(source.indexOf("function markInterrupted("), source.indexOf("async function readRuns("))
  expect(interruption).not.toContain("saveTaskAsset(")
  // The cap and the wording are the standard's: the runner has no number and no refusal sentence of its own.
  expect(source).not.toMatch(/REFUSAL_CAP|refusalText\(|没通过验收：|还是没通过验收/)
  expect(source.split("refusal(").length - 1).toBe(2)
})

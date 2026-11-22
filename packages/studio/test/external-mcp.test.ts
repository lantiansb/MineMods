import { afterEach, expect, test } from "bun:test"
import { GESTURE_BASES, GESTURE_EXAMPLE } from "@minemods/mod-core/gesture-bases"
import { GESTURE_BONES } from "@minemods/mod-core/gesture-rig"
import { createServer, type ServerResponse } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"
import { createProject, openProject, saveProject } from "@minemods/mod-core/project"
import { JobSchema } from "@minemods/mod-core/jobs"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { REFERENCE_LIMITS } from "@minemods/studio-ai/making"
import { SCRIPT_LIMITS } from "@minemods/studio-ai/script"
import { BRIDGE_BODY, bodyLimit, createExternalMcpBridge, tooLargeWords } from "../src/main/external-mcp"
import { callExternalMcpBridge } from "../src/main/mcp-stdio"
import { BUILD_NETWORK_NEXT_STEP, dispatchExternal, externalError } from "../src/main/external-dispatch"
import { BUILD_NETWORK_FAILED, gradleNetworkWords } from "@minemods/mod-core/gradle-network"
import { StudioError, createStudioService, publicError } from "../src/main/service"
import { CREATURE_TIER_LEVELS, CREATURE_TIERS, TIER_WORDS } from "@minemods/mod-core/creature-tier"
import { MCP_TOOLS } from "../src/main/mcp-handoff"
import { everythingToRead } from "./handoff-reading"
import { PAPER, played } from "./playable-fixture"
import { getMcpCapabilities } from "../src/main/mcp-capabilities"
import { AcceptanceRefusal, createProjectRunner } from "../src/main/project-runner"
import { PROJECT_RUN_LIMITS } from "@minemods/mod-core/workspace-runs"
import { ASSET_STANDARDS } from "@minemods/mod-core/acceptance"
import { ModuleKindSchema } from "@minemods/mod-core/workspace-modules"
import { leaked } from "../../mod-core/test/fixtures/acceptance/names"

const bridges: ReturnType<typeof createExternalMcpBridge>[] = []
const directories: string[] = []
const transports: StdioClientTransport[] = []

test("验收退回的原话原样到达外部 AI，别的内部错误不会借这条路出去", () => {
  const message = "贴图没通过验收，工程里什么都没有改动。必须逐条改掉：1. 【不机械】几乎每个面都是同一种填法。怎么改：按部位重新画。（还可以再交 3 次）"
  const error = externalError(new AcceptanceRefusal(message))
  expect(error).toBeInstanceOf(StudioError)
  expect((error as StudioError).message).toBe(message)
  expect(publicError(error)).toBe(message)
  // The same words in an error that is not a refusal are not let through; neither is the wording of the old model-only gate.
  expect(externalError(new Error(message))).not.toBeInstanceOf(StudioError)
  expect(externalError(new Error("模型需要细化：模型至少需要 12 个体块。"))).not.toBeInstanceOf(StudioError)
})

test("能力清单从真实服务读取当前档位、区分设计与运行时且不写工程", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-capabilities-"))
  directories.push(root)
  const service = await createStudioService({
    workspaceDirectory: path.join(root, "projects"),
    runtimeDirectory: path.join(root, "runtime"),
    templateDirectory: path.join(root, "templates"),
    ai: {},
  })
  const connection = await service.getConnection()
  const { hasApiKey: _hasApiKey, source: _source, ...settings } = connection
  await expect(dispatchExternal(service, { method: "getCapabilities", input: {} })).rejects.toThrow("用我自己的 AI 助手")
  await service.saveConnection({ ...settings, mode: "mcp" })
  const initial = (await dispatchExternal(service, { method: "getCapabilities", input: {} })) as ReturnType<
    typeof getMcpCapabilities
  >
  expect(initial.protocol_version).toBe(1)
  expect(initial.contract_fingerprint).toMatch(/^[0-9a-f]{64}$/)
  expect(
    initial.modules
      .filter((module) => module.capability === "design")
      .map((module) => module.module)
      .sort(),
  ).toEqual(["animation", "biome", "dimension", "terrain", "worldview"])
  // Every target Studio offers is listed beside each kind, from the one table: a kind is the same on all of them unless a target has a gap.
  expect(initial.modules.find((module) => module.module === "animation")?.targets).toEqual({ "fabric-1.21.1": "design", "forge-1.20.1": "design", "neoforge-1.21.1": "design" })
  expect(initial.modules.find((module) => module.module === "model")?.targets).toEqual({ "fabric-1.21.1": "runtime", "forge-1.20.1": "runtime", "neoforge-1.21.1": "runtime" })
  expect(initial.modules.find((module) => module.module === "entity")).toMatchObject({ owner: true, group: { id: "content", label: "内容" }, verify: [] })
  expect(initial.modules.find((module) => module.module === "entity")?.capability).toBe("runtime")
  // A cast action (kind id `gesture`) is built, and the capability text says where it stops today. Boss 能力 12 added the arena fixture (`fixture`): nineteen. The ability asset (`ability`): twenty.
  // 书 (book): twenty-two.
  expect(initial.modules.map((module) => module.module)).toHaveLength(22)
  expect(initial.modules.find((module) => module.module === "book")).toMatchObject({ label: "书", capability: "runtime", owner: true, group: { id: "text", label: "文本" } })
  // Boss 能力 11: a particle (kind id `particle`): a few small pictures and how one lives, built into the mod.
  expect(initial.modules.find((module) => module.module === "particle")).toMatchObject({ label: "粒子", capability: "runtime", owner: false, group: { id: "look", label: "外观" } })
  // An effect (kind id `effect`): a small model that appears for a moment, built into the mod and made by looking.
  expect(initial.modules.find((module) => module.module === "effect")).toMatchObject({ label: "效果", capability: "runtime", owner: false, group: { id: "look", label: "外观" } })
  // A sound (kind id `sound`, 任务二 §9): the project's own audio, built into the mod; nothing to look at.
  expect(initial.modules.find((module) => module.module === "sound")).toMatchObject({ label: "声音", capability: "runtime", owner: false, group: { id: "look", label: "外观" } })
  // Gameplay (kind id `gameplay`): code an AI writes, built into the mod.
  expect(initial.modules.find((module) => module.module === "gameplay")).toMatchObject({ capability: "runtime", group: { id: "play", label: "玩法" } })
  expect(initial.modules.find((module) => module.module === "gesture")).toMatchObject({ label: "施法动作", capability: "runtime", targets: { "fabric-1.21.1": "runtime" }, owner: false, group: { id: "look", label: "外观" } })
  expect(initial.boundaries.some((line) => line.includes("施法动作") && line.includes("只能按键播放") && line.includes("验收标准") && line.includes("自己的手臂") && line.includes("还没有验证"))).toBe(true)
  expect(initial.model_quality.complexity).toBe("medium")
  // The tier sets a mild floor only; what is judged is the look, and the rules are stated up front.
  expect(initial.model_quality.minimum.minUniqueCubes).toBe(4)
  // One acceptance standard for every module, stated before any work starts: the criteria, and per kind what each checks and what is not measured yet.
  expect(initial.acceptance.criteria.map((value) => value.name)).toEqual(["不凑数", "不机械", "认得出", "有主次", "站得住", "配得上"])
  expect(initial.acceptance.kinds.map((row) => row.kind)).toEqual(initial.modules.map((module) => module.module))
  expect(initial.acceptance.kinds.find((row) => row.kind === "model")?.criteria.find((cell) => cell.name === "认得出")?.checks.join()).toContain("眼睛")
  expect(initial.acceptance.kinds.find((row) => row.kind === "gesture")?.criteria.map((cell) => cell.measured)).toEqual([false, true, true, true, true, false])
  expect(initial.acceptance.kinds.find((row) => row.kind === "worldview")?.criteria.every((cell) => !cell.measured && cell.note)).toBe(true)
  expect(initial.acceptance).toMatchObject({ refusal_cap: 4, active_task_source: "claim_task.quality" })
  expect(initial.acceptance.refusal).toContain("drafts[taskId].quality")
  // The capability list is the registry itself: every rule of every kind is in it by what it asks, the two weights and the
  // only excuses are named, and no rule's or measurement's inner name is.
  ModuleKindSchema.options.forEach((kind) => ASSET_STANDARDS[kind].rules.forEach((rule) => expect(initial.acceptance.kinds.find((row) => row.kind === kind)?.criteria.find((cell) => cell.id === rule.criterion)?.checks).toContain(rule.asks)))
  expect(initial.acceptance.severities.map((value) => value.label)).toEqual(["硬伤", "做工"])
  expect(initial.acceptance.excuses).toHaveLength(4)
  expect(leaked(JSON.stringify(initial.acceptance))).toEqual([])
  expect(initial.limits).toEqual({ tasks: 12, parallel: 3, dependencies: 64 })
  expect(initial.build_targets[0]).toMatchObject({ minecraft: "1.21.1", java_major: 21, loader: "fabric" })
  await service.saveSettings({ ...(await service.getSettings()), modelComplexity: "high" })
  const updated = (await dispatchExternal(service, { method: "getCapabilities", input: {} })) as ReturnType<
    typeof getMcpCapabilities
  >
  expect(updated.model_quality.complexity).toBe("high")
  expect(updated.model_quality.minimum.minUniqueCubes).toBe(5)
  expect(updated.contract_fingerprint).toBe(initial.contract_fingerprint)
  expect(await service.listProjects()).toEqual([])
  const created = await service.createProject({ name: "雪原", description: "", empty: true })
  const projectId = created.project.id
  const full = await dispatchExternal(service, { method: "openProject", input: { projectId } })
  expect(full).toEqual(await service.openProject(projectId))
  const summary = await dispatchExternal(service, { method: "openProject", input: { projectId, detail: "summary" } })
  expect(summary).toMatchObject({ project: { id: projectId, revision: created.project.revision, workspace: { assets: [] } } })
  expect(summary).not.toHaveProperty("preview")
  expect(await dispatchExternal(service, { method: "listProjects", input: { detail: "summary" } })).toEqual([{ project: { id: projectId, name: "雪原", target: created.project.target, revision: created.project.revision } }])
  await expect(dispatchExternal(service, { method: "openProject", input: { projectId, assetId: crypto.randomUUID() } })).rejects.toThrow("没有这项资产")
  await expect(
    dispatchExternal(service, { method: "getCapabilities", input: { path: "C:/private" } }),
  ).rejects.toThrow()
  expect(JSON.stringify(updated)).not.toContain(root)
})

function dispatchService(input: {
  latestBuild: Record<string, unknown> | null
  started?: { jobId: string }
  jobs: Record<string, Record<string, unknown>>
  getLatestBuild?: () => Promise<Record<string, unknown> | null>
  openProject?: () => Promise<unknown>
  getEntityPreview?: (input: { projectId: string; entityId: string }) => Promise<unknown>
  getSettings?: () => Promise<{ modelComplexity: "low" | "medium" | "high" }>
}) {
  return {
    getConnection: async () => ({ mode: "mcp" }),
    getLatestBuild: input.getLatestBuild ?? (async () => input.latestBuild),
    buildProject: async () => input.started ?? { jobId: crypto.randomUUID() },
    getJob: async ({ jobId }: { projectId: string; jobId: string }) => input.jobs[jobId],
    openProject: input.openProject,
    getEntityPreview: input.getEntityPreview,
    getSettings: input.getSettings ?? (async () => ({ modelComplexity: "medium" as const })),
    externalRunner: {},
  } as unknown as Awaited<ReturnType<typeof createStudioService>>
}

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close().catch(() => undefined)))
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("交给外部 AI 的档位说明从档位表生成：表里有几档，说明里就有几档，不会落下新加的一档", () => {
  const propose = MCP_TOOLS.find((tool) => tool[0] === "propose_blueprint")!
  // The description names every tier by the person's word, and the input contract every level id.
  CREATURE_TIER_LEVELS.forEach((level) => {
    expect(propose[1]).toContain(CREATURE_TIERS[level].label)
    expect(propose[2]).toContain(`'${level}'`)
  })
  expect(TIER_WORDS.ids).toBe(CREATURE_TIER_LEVELS.map((level) => `'${level}'`).join(" | "))
  // The workflow text names each level with its word, and counts the buttons of the blueprint card by the table.
  const handoff = everythingToRead({ configuration: JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: [] } } }) })
  CREATURE_TIER_LEVELS.forEach((level) => expect(handoff).toContain(`${level}（${CREATURE_TIERS[level].label}）`))
  expect(handoff).toContain(`用户会在蓝图卡片上用${TIER_WORDS.count}个按钮改档位`)
  expect(TIER_WORDS.count).toBe("五")
  expect(handoff).not.toContain("用四个按钮")
  expect(handoff).toContain(`${TIER_WORDS.budgeted}的模型，部件说明里的 budget 不能低于这一档的几何预算`)
  expect(TIER_WORDS.budgeted).toBe("精细、Boss、史诗")
  expect(getMcpCapabilities("medium").creature_tiers.tiers).toHaveProperty("epic")
})

test.each(["headers", "body"])("MCP 工具等待延迟的 %s，心跳仍在短时限内中断", async (delayed) => {
  const toolResponse = Promise.withResolvers<ServerResponse>()
  const responses = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    responses.add(response)
    response.once("close", () => responses.delete(response))
    request.resume()
    if (delayed === "body") response.write('{"ok":true,')
    if (request.url === "/tool") {
      toolResponse.resolve(response)
      return
    }
    // A missing heartbeat timeout should fail the assertion, not strand the fake server.
    const fallback = setTimeout(() => response.end(delayed === "body" ? '"value":"late"}' : '{"ok":true,"value":"late"}'), 2000)
    response.once("close", () => clearTimeout(fallback))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test bridge port")
  const root = `http://127.0.0.1:${address.port}`
  const descriptor = { url: root + "/tool", token: "x".repeat(32) }
  const timeout = 100
  const outcome = callExternalMcpBridge(descriptor, "lookExternalTask", {}, "test-session", timeout).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  )
  try {
    const response = await toolResponse.promise
    const heartbeat = { ...descriptor, url: root + "/heartbeat" }
    await expect(callExternalMcpBridge(heartbeat, "heartbeat", {}, "test-session", timeout)).rejects.toMatchObject({ name: expect.stringMatching(/AbortError|TimeoutError/) })
    response.end(delayed === "body" ? '"value":"ready"}' : '{"ok":true,"value":"ready"}')
    expect(await outcome).toEqual({ value: "ready" })
  } finally {
    for (const response of responses) response.end()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await outcome
  }
})

test("关闭 MCP bridge 会让正在等待回复和后来连接的工具调用报错", async () => {
  const entered = Promise.withResolvers<void>()
  const pending = Promise.withResolvers<unknown>()
  const bridge = createExternalMcpBridge({
    token: "x".repeat(32),
    call: () => {
      entered.resolve()
      return pending.promise
    },
  })
  bridges.push(bridge)
  const descriptor = await bridge.start()
  const tool = callExternalMcpBridge(descriptor, "listProjects", {}, "test-session")
  const outcome = tool.then(() => "resolved", () => "disconnected")
  try {
    await entered.promise
    const stopped = bridge.stop()
    expect(await Promise.race([outcome, Bun.sleep(2000).then(() => "still waiting")])).toBe("disconnected")
    await stopped
    await expect(callExternalMcpBridge(descriptor, "listProjects", {}, "test-session")).rejects.toThrow()
  } finally {
    pending.resolve([])
  }
})

test("loopback bridge 只接受 token 保护的白名单调用", async () => {
  const calls: Array<{ method: string; input: unknown }> = []
  const bridge = createExternalMcpBridge({
    token: "x".repeat(32),
    call: async (method, input) => {
      calls.push({ method, input })
      return { accepted: true }
    },
  })
  bridges.push(bridge)
  const descriptor = await bridge.start()

  const unauthorized = await fetch(descriptor.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "listProjects", input: {} }),
  })
  expect(unauthorized.status).toBe(400)

  const response = await fetch(descriptor.url, {
    method: "POST",
    headers: { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      method: "getExternalProgress",
      input: { projectId: crypto.randomUUID(), runId: crypto.randomUUID() },
    }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, value: { accepted: true } })
  expect(calls[0]?.method).toBe("getExternalProgress")
})

/** The biggest document the epic tier allows, as numbers a modeller really writes (four decimals): 192 bones, 1,024 cubes, 32 motions, 39,936 of the 40,000 keys. */
function biggestEpicDocument() {
  let state = 99
  const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const number = (low: number, high: number) => Number((low + (high - low) * random()).toFixed(4))
  const faces = { north: "#6B4E8A", east: "#6B4E8A", south: "#6B4E8A", west: "#6B4E8A", up: "#6B4E8A", down: "#6B4E8A" }
  const bones = Array.from({ length: 192 }, (_, at) => ({
    name: `bone_${at}`,
    parent: at === 0 ? null : `bone_${Math.floor(random() * at)}`,
    pivot: [number(-100, 100), number(0, 200), number(-100, 100)],
    rotation: [0, 0, 0],
    cubes: Array.from({ length: at < 64 ? 6 : 5 }, (_, cube) => ({ name: `cube_${at}_${cube}`, origin: [number(-100, 100), number(0, 200), number(-100, 100)], size: [4, 4, 4], faces })),
  }))
  const names = ["idle", "walk", "hurt", ...Array.from({ length: 29 }, (_, index) => `motion_${index}`)]
  const time = (key: number) => Number((key * 0.4).toFixed(4))
  const animations = names.map((name) => ({
    name,
    length: 3,
    loop: true,
    // 6.5 keys a bone on average over three tracks: 192 × 6.5 × 32 = 39,936.
    channels: bones.map((bone, at) => ({
      bone: bone.name,
      keyframes: Array.from({ length: 3 + (at % 2) }, (_, key) => ({ time: time(key), rotation: [number(-90, 90), number(-90, 90), number(-90, 90)], interpolation: "smooth" })),
      position: Array.from({ length: 2 }, (_, key) => ({ time: time(key), position: [number(-20, 20), number(-20, 20), number(-20, 20)], interpolation: "smooth" })),
      scale: [{ time: 0, scale: [number(0.5, 2), number(0.5, 2), number(0.5, 2)], interpolation: "smooth" }],
    })),
  }))
  return { name: "最大的史诗模型", texture_size: 512, budget: "epic", bones, animations }
}

test("桥一次能收的大小从它要装的东西算出来：整份文档按脚本交出的上限，构想图按每张图的上限，别的仍是原来的上限", () => {
  expect(BRIDGE_BODY.plain).toBe(1_000_000)
  expect(BRIDGE_BODY.document).toBe(SCRIPT_LIMITS.output + BRIDGE_BODY.envelope)
  // A picture of 4 MiB decoded is 5,592,408 characters of base64 and a 23-character prefix; three of them, their names and the envelope.
  expect(BRIDGE_BODY.concepts).toBe(REFERENCE_LIMITS.concept * (5_592_408 + 23 + REFERENCE_LIMITS.name * 3) + BRIDGE_BODY.envelope)
  expect(BRIDGE_BODY.most).toBe(Math.max(BRIDGE_BODY.document, BRIDGE_BODY.concepts))
  expect(bodyLimit("commitExternalTask")).toBe(BRIDGE_BODY.document)
  expect(bodyLimit("updateExternalTask")).toBe(BRIDGE_BODY.document)
  expect(bodyLimit("lookExternalTask")).toBe(BRIDGE_BODY.document)
  expect(bodyLimit("conceptExternalTask")).toBe(BRIDGE_BODY.concepts)
  expect(BRIDGE_BODY.singlePicture).toBe(5_592_408 + 23 + REFERENCE_LIMITS.name * 3 + BRIDGE_BODY.envelope)
  expect(bodyLimit("finishThreeView")).toBe(BRIDGE_BODY.singlePicture)
  expect(bodyLimit("getThreeViewPrompt")).toBe(BRIDGE_BODY.plain)
  // view_reference asks for a picture with a few numbers; the picture comes back, it is never sent.
  expect(bodyLimit("viewReferenceExternalTask")).toBe(BRIDGE_BODY.plain)
  expect(bodyLimit("listProjects")).toBe(BRIDGE_BODY.plain)
  expect(bodyLimit("startExternal")).toBe(BRIDGE_BODY.plain)
  // The biggest epic document, sent the way the bridge sends it, is under the document limit with 14% to spare (87 bytes a key).
  const document = biggestEpicDocument()
  const parsed = ModelDesignSchema.parse(document)
  expect(parsed.animations.reduce((sum, clip) => sum + clip.channels.reduce((n, channel) => n + channel.keyframes.length + (channel.position?.length ?? 0) + (channel.scale?.length ?? 0), 0), 0)).toBe(39_936)
  expect(parsed.bones.reduce((sum, bone) => sum + bone.cubes.length, 0)).toBe(1024)
  const sent = Buffer.byteLength(JSON.stringify({ method: "commitExternalTask", input: { projectId: crypto.randomUUID(), runId: crypto.randomUUID(), taskId: crypto.randomUUID(), document } }))
  expect(sent).toBeGreaterThan(1_000_000)
  expect(sent).toBe(3_490_009)
  expect(sent * 1.14).toBeLessThan(bodyLimit("commitExternalTask"))
})

test("过大的请求被退回时说清楚是哪一步、多大、改怎么做，且不影响别的调用", async () => {
  const calls: string[] = []
  const bridge = createExternalMcpBridge({ token: "z".repeat(32), call: async (method) => (calls.push(method), { accepted: true }) })
  bridges.push(bridge)
  const descriptor = await bridge.start()
  const post = (payload: string, token = descriptor.token) => fetch(descriptor.url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: payload })
  const ids = { projectId: crypto.randomUUID(), runId: crypto.randomUUID(), taskId: crypto.randomUUID() }
  // The biggest epic document goes through the three calls that carry documents.
  const document = biggestEpicDocument()
  for (const method of ["updateExternalTask", "commitExternalTask", "lookExternalTask"]) {
    const response = await post(JSON.stringify({ method, input: { ...ids, ...(method === "updateExternalTask" ? { draft: document } : { document }) } }))
    expect(response.status).toBe(200)
  }
  expect(calls).toEqual(["updateExternalTask", "commitExternalTask", "lookExternalTask"])
  // A document past the script's own ceiling is refused with the way out in plain words.
  const huge = JSON.stringify({ method: "commitExternalTask", input: { ...ids, document: { filler: "字".repeat(1_400_000) } } })
  const refused = (await (await post(huge)).json()) as { ok: boolean; error: string }
  expect(refused.ok).toBe(false)
  expect(refused.error).toContain("MB")
  expect(refused.error).toContain("script")
  expect(refused.error).toContain("脚本")
  expect(calls).toHaveLength(3)
  // Pictures: three of the largest size Studio keeps go through, whatever else is sent beside them.
  const picture = `data:image/webp;base64,${"A".repeat(5_592_408)}`
  const views = ["正面", "侧面", "背面"].map((name) => ({ name, image: picture }))
  expect((await post(JSON.stringify({ method: "conceptExternalTask", input: { ...ids, views } }))).status).toBe(200)
  // The same pictures sent to a call that carries none are refused, in that call's own words.
  const wrong = (await (await post(JSON.stringify({ method: "listProjects", input: { views } }))).json()) as { error: string }
  expect(wrong.error).toContain("这一步只需要几行字")
  expect(calls).toHaveLength(4)
  // A caller without the token is not read past the ordinary cap.
  const stranger = await post(JSON.stringify({ method: "listProjects", input: { filler: "x".repeat(2_000_000) } }), "w".repeat(32))
  expect(stranger.status).toBe(400)
  expect(await stranger.json()).toMatchObject({ ok: false, error: expect.stringContaining("超过了一次能收的上限") })
  expect(calls).toHaveLength(4)
  // Even an authenticated caller stops at the bridge-wide streaming cap, before dispatch.
  const overflowing = await post(JSON.stringify({ method: "conceptExternalTask", input: { ...ids, filler: "x".repeat(BRIDGE_BODY.most) } }))
  expect(overflowing.status).toBe(400)
  expect(await overflowing.json()).toMatchObject({ ok: false, error: expect.stringContaining("超过了一次能收的上限") })
  expect(calls).toHaveLength(4)
  const unauthorized = await post(JSON.stringify({ method: "listProjects", input: {} }), "w".repeat(32))
  expect(unauthorized.status).toBe(400)
  expect(await unauthorized.json()).toEqual({ ok: false, error: "外部 MCP bridge token 无效。" })
  expect(calls).toHaveLength(4)
  const following = await post(JSON.stringify({ method: "listProjects", input: {} }))
  expect(following.status).toBe(200)
  expect(await following.json()).toEqual({ ok: true, value: { accepted: true } })
  expect(calls).toEqual(["updateExternalTask", "commitExternalTask", "lookExternalTask", "conceptExternalTask", "listProjects"])
  // The words, for each kind of call.
  expect(tooLargeWords("conceptExternalTask", 20_000_000)).toContain("JPEG")
  expect(tooLargeWords("commitExternalTask", 5_000_000)).toContain("script")
  expect(tooLargeWords("commitExternalTask", 5_000_000)).toContain(`${SCRIPT_LIMITS.source}`)
})

test("bridge 拒绝任意路径与未登记方法", async () => {
  const bridge = createExternalMcpBridge({ token: "y".repeat(32), call: async () => null })
  bridges.push(bridge)
  const descriptor = await bridge.start()

  const pathResponse = await fetch(descriptor.url.replace("/mcp", "/arbitrary"), { method: "POST" })
  expect(pathResponse.status).toBe(404)
  const methodResponse = await fetch(descriptor.url, {
    method: "POST",
    headers: { authorization: `Bearer ${descriptor.token}`, "content-type": "application/json" },
    body: JSON.stringify({ method: "readFile", input: { path: "C:\\secret" } }),
  })
  expect(methodResponse.status).toBe(400)
})

test("MCP 构建 dispatch 委托 service，并拒绝非 build job", async () => {
  const projectId = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const activeJob = JobSchema.parse({
    schema_version: 1,
    id: crypto.randomUUID(),
    project_id: projectId,
    project_revision: 0,
    entity_id: null,
    kind: "build",
    state: "running",
    revision: 1,
    created_at: timestamp,
    updated_at: timestamp,
    input: null,
    checkpoint: null,
    output: null,
    error: null,
  })
  const service = dispatchService({
    latestBuild: activeJob,
    started: { jobId: activeJob.id },
    jobs: { [activeJob.id]: activeJob },
    getLatestBuild: async () => {
      throw new Error("dispatch must not inspect latest build")
    },
  })
  const started = await dispatchExternal(service, { method: "buildProject", input: { projectId } })
  expect(started).toEqual({ jobId: activeJob.id, job: activeJob })

  const warnings = [{ rule: "skipped_creature", about: "苔叶蛾", text: "苔叶蛾还没有模型。", fix: "补上模型后再打包。" }]
  const done = JobSchema.parse({ ...activeJob, state: "completed", output: { warnings } })
  const completed = dispatchService({ latestBuild: done, jobs: { [done.id]: done } })
  expect(await dispatchExternal(completed, { method: "getBuild", input: { projectId, jobId: done.id } }))
    .toMatchObject({ state: "completed", output: { warnings } })

  const modelJob = JobSchema.parse({
    ...activeJob,
    id: crypto.randomUUID(),
    kind: "model",
    state: "completed",
    output: { value: true },
  })
  const rejecting = dispatchService({ latestBuild: null, jobs: { [modelJob.id]: modelJob } })
  await expect(
    dispatchExternal(rejecting, { method: "getBuild", input: { projectId, jobId: modelJob.id } }),
  ).rejects.toThrow("不是构建任务")

  // A build that died on a download says so beside the job, and tells the AI to leave the mod alone; any other failure is passed on as it is.
  const offline = JobSchema.parse({ ...activeJob, id: crypto.randomUUID(), state: "failed", error: publicError(new Error(BUILD_NETWORK_FAILED)), checkpoint: { detail: "Remote host terminated the handshake", reason: "network" } })
  const broken = JobSchema.parse({ ...offline, id: crypto.randomUUID(), error: publicError(new Error("GRADLE_BUILD_FAILED")), checkpoint: { detail: "Compilation failed" } })
  const failing = dispatchService({ latestBuild: null, jobs: { [offline.id]: offline, [broken.id]: broken } })
  expect(await dispatchExternal(failing, { method: "getBuild", input: { projectId, jobId: offline.id } })).toEqual({ ...offline, reason: "network", next_step: BUILD_NETWORK_NEXT_STEP })
  expect(offline.error).toBe(gradleNetworkWords())
  expect(BUILD_NETWORK_NEXT_STEP).toContain("不要改模组")
  expect(await dispatchExternal(failing, { method: "getBuild", input: { projectId, jobId: broken.id } })).toEqual(broken)
})

test("inspect_model 只读取当前工程的 ready workspace model 并返回实际预览", async () => {
  const projectId = crypto.randomUUID()
  const modelAssetId = crypto.randomUUID()
  const preview = { model: null, preview: { geometry: {}, textureDataUrl: "data:image/png;base64,AA==" } }
  const service = dispatchService({
    latestBuild: null,
    jobs: {},
    openProject: async () => ({
      project: {
        id: projectId,
        workspace: {
          assets: [{ id: modelAssetId, module: "model", status: "ready", document: { kind: "model" } }],
        },
        entities: [{ id: modelAssetId }],
      },
    }),
    getEntityPreview: async (input) => {
      expect(input).toEqual({ projectId, entityId: modelAssetId })
      return preview
    },
  })
  const inspected = await dispatchExternal(service, { method: "inspectModel", input: { projectId, modelAssetId } })
  expect(inspected as Record<string, unknown>).toEqual({ asset_id: modelAssetId, ...preview, quality: null })
  await expect(
    dispatchExternal(service, { method: "inspectModel", input: { projectId, modelAssetId: crypto.randomUUID() } }),
  ).rejects.toThrow("模型资产")
  await expect(
    dispatchExternal(service, { method: "inspectModel", input: { projectId: "not-a-uuid", modelAssetId } }),
  ).rejects.toThrow("Invalid UUID")
  const otherProject = dispatchService({
    latestBuild: null,
    jobs: {},
    openProject: async () => ({
      project: {
        id: crypto.randomUUID(),
        workspace: { assets: [] },
        entities: [],
      },
    }),
  })
  await expect(
    dispatchExternal(otherProject, { method: "inspectModel", input: { projectId, modelAssetId } }),
  ).rejects.toThrow("工程身份")
})

test("改动任务的那几步一结束就告诉窗口，被退回也一样；只读的调用不打扰它", async () => {
  const seen: string[] = []
  const bridge = createExternalMcpBridge({
    token: "c".repeat(32),
    onChanged: (method) => seen.push(`changed:${method}`),
    call: async (method, input) => {
      seen.push(method)
      if (input === "refuse") throw new Error("refused")
      return null
    },
  })
  const authorization = `Bearer ${"c".repeat(32)}`
  await bridge.dispatch("getExternalRun", {}, authorization)
  await bridge.dispatch("commitExternalTask", {}, authorization)
  await expect(bridge.dispatch("failExternalTask", "refuse", authorization)).rejects.toThrow("refused")
  expect(seen).toEqual(["getExternalRun", "commitExternalTask", "changed:commitExternalTask", "failExternalTask", "changed:failExternalTask"])
})

test.skipIf(!process.env.MINEMODS_FFMPEG)("同一工程连续启动九个声音工具，都按最新工程版本保存", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-sound-queue-"))
  directories.push(root)
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} })
  try {
    await service.useOwnProgram({ id: "ffmpeg", path: process.env.MINEMODS_FFMPEG! })
    const { project, directory } = await service.createProject({ name: "声音试验", description: "", modId: "sound_check", empty: true })
    const recipe = JSON.stringify({ seconds: 0.15, layers: [{ wave: "sine", from_hz: 110, length: 0.15, gain: 0.5 }] })
    const started = await Promise.all(Array.from({ length: 9 }, (_, index) => service.tools.start({ projectId: project.id, tool: "sound-synth", input: { recipe, name: `bell_${index}`, title: `钟声 ${index}`, subtitle_zh: "钟声", subtitle_en: "A bell rings" } })))
    const current = () => started.map((run) => service.tools.get({ projectId: project.id, run: run.id }))
    for (let attempt = 0; attempt < 120 && current().some((run) => run.state === "running"); attempt++) await Bun.sleep(100)
    expect(current().flatMap((run) => run.error ? [run.error] : [])).toEqual([])
    expect(current().every((run) => run.state === "completed")).toBe(true)
    const saved = await openProject(directory)
    expect(saved.revision).toBe(project.revision + 9)
    expect(saved.workspace.assets).toHaveLength(9)
    expect(saved.workspace.assets.find((asset) => asset.title === "钟声 0")?.document).toMatchObject({
      subtitle: { zh: "钟声", en: "A bell rings" },
      files: [{ measurements: { dominant_band: "low", clipped: false } }],
    })
    expect(current()[0]?.product?.saved).toMatchObject({ measurements: { dominant_band: "low" } })

    const creatureDirectory = path.join(root, "creature")
    const example = await createDataGameplaySample(creatureDirectory, { life: true })
    const voice = saved.workspace.assets[0]!
    const modelled = await saveProject(creatureDirectory, { ...example, workspace: { assets: [...example.workspace.assets, voice] } }, example.revision)
    const creature = modelled.workspace.assets.find((asset) => asset.document.kind === "entity")!
    if (creature.document.kind !== "entity") throw new Error("SAMPLE_MISSING")
    const runner = createProjectRunner({ directoryFor: async () => creatureDirectory, ai: {} })
    const request = "把石卫受伤的声音换成工程里的钟声"
    const startedEdit = await runner.startExternal({
      projectId: modelled.id, expectedRevision: modelled.revision, prompt: request,
      plan: { summary: request, questions: [], tasks: [{ key: "creature", module: "entity", title: "换石卫声音", prompt: request, source: request, dependencies: [], target_id: creature.id }] },
    })
    const task = { projectId: modelled.id, runId: startedEdit.run.id, taskId: startedEdit.run.tasks[0]!.id }
    await runner.claimExternalTask(task)
    const document = { ...creature.document, sounds: { ...creature.document.sounds!, hurt: { asset: voice.id } } }
    expect((await runner.updateExternalTask({ ...task, progress: 60, draft: document })).drafts[task.taskId]?.unsaveable ?? null).toBeNull()
    expect((await runner.commitExternalTask({ ...task, document })).state).toBe("completed")
    expect((await openProject(creatureDirectory)).workspace.assets.find((asset) => asset.id === creature.id)?.dependencies).toContain(voice.id)
  } finally {
    service.tools.close()
  }
}, 120000)

test("官方 SDK Client 通过 StdioClientTransport 完成启动、工具调用和关闭 heartbeat", async () => {
  // It reads that ffmpeg is missing: not looked for on this machine (r29 finds one on PATH, WinGet or scoop).
  process.env.MINEMODS_PROGRAM_SEARCH = "off"
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-mcp-stdio-"))
  directories.push(root)
  const calls: string[] = []
  const replacementCalls: string[] = []
  let sessionId: string | undefined
  let shutdownSeen = false
  const service = await createStudioService({ workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} })
  const { hasApiKey: _hasApiKey, source: _source, ...settings } = await service.getConnection()
  await service.saveConnection({ ...settings, mode: "mcp", review:true })
  const { project } = await service.createProject({ name: "霜石试验", description: "", modId: "r14_check", targetId: "forge-1.20.1", empty: true })
  await dispatchExternal(service, { method: "proposeBlueprint", input: {
    projectId: project.id,
    request: "同一试场的两只原创模型，测试各自的六视图规格。",
    blueprint: played({
      style: { palette: ["#5D5347", "#3A6869"], shape: "机械驮兽", naming: "小写英文", world: "雾谷" },
      entries: [
        { key: "epic_beast", kind: "entity", title: "雾钟驮兽", brief: "身披斜板的大型机械驮兽", owner: null, needs: ["epic_model"], out_of_scope: null, tier: { level: "epic", reason: "测试史诗档", by: "ai" } },
        { key: "epic_model", kind: "model", title: "雾钟驮兽模型", brief: "象牙色外壳，右侧钴蓝方形通风口", owner: "epic_beast", needs: [], out_of_scope: null },
        { key: "standard_beast", kind: "entity", title: "巡路兽", brief: "四脚小兽", owner: null, needs: ["standard_model"], out_of_scope: null, tier: { level: "standard", reason: "测试普通档", by: "ai" } },
        { key: "standard_model", kind: "model", title: "巡路兽模型", brief: "四足，直立耳朵", owner: "standard_beast", needs: [], out_of_scope: null },
      ],
      questions: [],
    }),
    paper_play: PAPER,
  } })
  const real = new Set(["getCapabilities", "getGuide", "moduleSchema", "listTools", "getThreeViewPrompt", "finishThreeView"])
  const bridge = createExternalMcpBridge({
    token: "z".repeat(32),
    onActivity: (activity) => {
      if (activity.sessionId) sessionId = activity.sessionId
      shutdownSeen ||= activity.shutdown === true
    },
    call: async (method, input) => {
      calls.push(method)
      if (real.has(method)) return dispatchExternal(service, { method, input })
      if (method === "viewReferenceExternalTask") return { original: { width: 2, height: 2 }, rect: { x: 0, y: 0, width: 1, height: 1 }, pictures: [{ label: "参考图第 1 张", url: "data:image/png;base64,aGVsbG8=" }] }
      return method === "listProjects" ? [] : { ready: true }
    },
  })
  bridges.push(bridge)
  const descriptor = await bridge.start()
  const descriptorPath = path.join(root, "connection.json")
  await Bun.write(descriptorPath, JSON.stringify(descriptor))
  const compiledPath = path.join(root, "mcp-stdio.js")
  const built = await Bun.build({
    entrypoints: [path.resolve(import.meta.dir, "../src/main/mcp-stdio.ts")],
    outdir: root,
    target: "node",
    format: "cjs",
    external: ["zod"],
  })
  expect(built.success).toBe(true)

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [compiledPath, "--connection", descriptorPath],
    env: { NODE_PATH: path.resolve(import.meta.dir, "../node_modules") },
    stderr: "pipe",
  })
  transports.push(transport)
  const client = new Client({ name: "external-mcp-test", version: "0.1.0" })
  await client.connect(transport)
  const listed = await client.listTools()
  expect(listed.tools.map((tool) => tool.name).sort()).toEqual(MCP_TOOLS.map(([name]) => name).sort())
  const capabilities = await client.callTool({ name: "get_capabilities", arguments: { projectId: project.id } })
  const guide = await client.callTool({ name: "get_guide", arguments: { projectId: project.id, topic: "gameplay" } })
  const plan = await client.callTool({ name: "get_guide", arguments: { projectId: project.id, topic: "plan" } })
  const workflow = await client.callTool({ name: "get_guide", arguments: { projectId: project.id, topic: "workflow" } })
  const gameplay = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "gameplay" } })
  const model = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "model" } })
  const sound = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "sound" } })
  const block = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "block" } })
  const entity = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "entity" } })
  const cast = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "ability" } })
  const effect = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "effect" } })
  const particle = await client.callTool({ name: "module_schema", arguments: { projectId: project.id, module: "particle" } })
  const tools = await client.callTool({ name: "list_tools", arguments: { medium: "sound" } })
  for (const result of [capabilities, guide, plan, workflow, gameplay, model, sound, block, tools]) expect(result.isError).not.toBe(true)
  const reply = (result: typeof capabilities) => JSON.stringify(result)
  for (const result of [capabilities, guide, gameplay]) {
    expect(reply(result)).toContain("Forge 1.20.1")
    expect(reply(result)).toContain("loot_tables")
    expect(reply(result)).toContain("ProjectContent.blockSwap")
  }
  expect(reply(capabilities)).toContain("boss.summon")
  for (const result of [plan, workflow, model]) expect(reply(result)).toContain("foot_placement")
  for (const result of [entity, cast, effect, particle]) expect(result.isError).not.toBe(true)
  expect(reply(entity)).toContain("再加震屏或碎块")
  expect(reply(entity)).toContain("可分别关闭该位置自带的粒子或声音；省略哪个字段，哪个就沿用默认")
  expect(reply(cast)).toContain("允许立即连放")
  expect(reply(effect)).toContain("play.opacity 是全程固定的")
  expect(reply(particle)).toContain("opacity.end 至少比 start 低")
  expect(reply(model)).toContain("2 到 6 节")
  expect(reply(capabilities)).toContain("combat_design")
  expect(reply(block)).toContain("方块被踩时触发玩法")
  expect(reply(sound)).toContain("工程收件箱")
  expect(reply(tools)).toContain("missing_program")
  expect(reply(tools)).toContain("缺少 ffmpeg")
  delete process.env.MINEMODS_PROGRAM_SEARCH
  if (process.env.MINEMODS_R14_EVIDENCE) await Bun.write(process.env.MINEMODS_R14_EVIDENCE, JSON.stringify({ capabilities, guide, plan, workflow, gameplay, model, sound, block, tools }, null, 2))
  if (process.env.MINEMODS_RULE_EVIDENCE) await Bun.write(process.env.MINEMODS_RULE_EVIDENCE, JSON.stringify({ capabilities, guide, model, entity, cast, effect, particle }, null, 2))
  service.tools.close()
  expect(calls).toContain("getCapabilities")
  expect(listed.tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      "plan_run",
      "claim_task",
      "update_task",
      "commit_task",
      "fail_task",
      "get_run",
      "cancel_run",
      "build_project",
      "get_build",
      "inspect_model",
    ]),
  )
  const response = await client.callTool({ name: "list_projects", arguments: {} })
  expect(response.isError).not.toBe(true)
  expect(calls).toContain("listProjects")
  expect(bridge.status().connected).toBe(true)

  const projectId = crypto.randomUUID()
  expect(listed.tools.find((tool) => tool.name === "get_six_view_prompt")?.annotations?.readOnlyHint).toBe(true)
  const sixView = { projectId: project.id, itemId: "epic_model" }
  const ordinary = { projectId: project.id, itemId: "standard_model" }
  const sixCall = async (name: string, args: Record<string, unknown>) => {
    const answer = await client.callTool({ name, arguments: args })
    expect(answer.isError, JSON.stringify(answer.content)).not.toBe(true)
    const [value] = answer.content as { type: string; text: string }[]
    return JSON.parse(value!.text)
  }
  const epicPrompt: string = await sixCall("get_six_view_prompt", sixView)
  const ordinaryPrompt: string = await sixCall("get_six_view_prompt", ordinary)
  const angledPrompt: string = await sixCall("get_six_view_prompt", { ...sixView, style: "angled", note: "露出蓝色通风口" })
  expect(epicPrompt).toContain("roughly 600 boxes or fewer")
  expect(ordinaryPrompt).toContain("every part built from axis-aligned cuboids")
  expect(angledPrompt).toContain("No curved or smooth surfaces")
  expect(angledPrompt).toContain("露出蓝色通风口")
  await service.saveSettings({ ...await service.getSettings(), epicSixViewStyle: "blocky" })
  const legacyPrompt: string = await sixCall("get_six_view_prompt", sixView)
  expect(legacyPrompt).toContain("every part built from axis-aligned cuboids")
  expect(legacyPrompt).not.toContain("roughly 600")
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  expect(await sixCall("finish_six_view", { ...sixView, style: "sculpted", result: { status: "generated", image: pixel } })).toMatchObject({ status: "generated", references: [{ by: "ai", style: "sculpted" }] })
  expect(await sixCall("finish_six_view", { ...ordinary, style: "sculpted", result: { status: "provided", view: "right", image: pixel } })).toMatchObject({ status: "provided", references: [{ by: "person", view: "right", style: "sculpted" }] })
  const oldUpload = await sixCall("finish_six_view", { ...ordinary, result: { status: "provided", view: "front", image: pixel } })
  expect(oldUpload.references.find((reference: { view: string }) => reference.view === "front")).not.toHaveProperty("style")
  expect(await sixCall("finish_six_view", { ...sixView, result: { status: "unsupported", reason: "当前会话没有绘图工具，需要独立准备六视图。" } })).toMatchObject({ status: "unsupported" })
  expect(calls).toContain("getThreeViewPrompt")
  expect(calls.filter((method) => method === "finishThreeView")).toHaveLength(4)
  if (process.env.MINEMODS_SIX_VIEW_EVIDENCE)
    await Bun.write(process.env.MINEMODS_SIX_VIEW_EVIDENCE, JSON.stringify({ epicPrompt, ordinaryPrompt, angledPrompt, legacyPrompt }, null, 2))
  // view_reference: read-only, and its one picture comes back as image content after the words.
  expect(listed.tools.find((tool) => tool.name === "view_reference")?.annotations?.readOnlyHint).toBe(true)
  const task = { projectId, runId: crypto.randomUUID(), taskId: crypto.randomUUID() }
  const zoomed = await client.callTool({ name: "view_reference", arguments: { ...task, reference: 1, region: { x: 0, y: 0, width: 0.5, height: 0.5 } } })
  expect(zoomed.isError).not.toBe(true)
  const [words, image] = zoomed.content as [{ type: string; text: string }, unknown]
  expect(JSON.parse(words.text)).toEqual({ original: { width: 2, height: 2 }, rect: { x: 0, y: 0, width: 1, height: 1 }, pictures: ["参考图第 1 张"] })
  expect(image).toEqual({ type: "image", data: "aGVsbG8=", mimeType: "image/png" })
  expect((await client.callTool({ name: "view_reference", arguments: { ...task, reference: "正面" } })).isError).not.toBe(true)
  expect((await client.callTool({ name: "view_reference", arguments: { ...task, reference: 0 } })).isError).toBe(true)
  expect(calls.filter((method) => method === "viewReferenceExternalTask")).toHaveLength(2)
  const jobId = crypto.randomUUID()
  const build = await client.callTool({ name: "build_project", arguments: { projectId } })
  expect(build.isError).not.toBe(true)
  const status = await client.callTool({ name: "get_build", arguments: { projectId, jobId } })
  expect(status.isError).not.toBe(true)
  expect(calls).toContain("buildProject")
  expect(calls).toContain("getBuild")

  await bridge.stop()
  const replacement = createExternalMcpBridge({
    token: "w".repeat(32),
    onActivity: (activity) => {
      shutdownSeen ||= activity.shutdown === true
    },
    call: async (method) => {
      replacementCalls.push(method)
      return method === "listProjects" ? [{ id: "replacement" }] : { ready: true }
    },
  })
  bridges.push(replacement)
  await Bun.write(descriptorPath, JSON.stringify(await replacement.start()))
  const switched = await client.callTool({ name: "list_projects", arguments: {} })
  expect(switched.isError).not.toBe(true)
  expect(switched.content).toEqual([{ type: "text", text: JSON.stringify([{ id: "replacement" }]) }])
  expect(replacementCalls).toContain("listProjects")

  await client.close()
  for (let attempt = 0; attempt < 100 && bridge.status().connected; attempt += 1) await Bun.sleep(20)
  expect(sessionId).toBeTruthy()
  expect(shutdownSeen).toBe(true)
  expect(bridge.status().connected).toBe(false)
}, 30000)

test("外部任务只在 commit_task 时写入真实 workspace 资产", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-external-mcp-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const project = await createProject({ directory, name: "外部模型测试", description: "" })
  const runner = createProjectRunner({
    directoryFor: async (projectId) => {
      if (projectId === project.id) return directory
      throw new Error("unknown project")
    },
    ai: {},
  })
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt: "创建世界观",
    plan: {
      summary: "创建世界观",
      questions: [],
      tasks: [
        {
          key: "world",
          module: "worldview",
          title: "世界观",
          prompt: "创建世界观",
          source: "创建世界观",
          dependencies: [],
          target_id: null,
        },
      ],
    },
    provenance: { client: "test-client", model: "test-model", verified: false },
  })
  expect(await runner.hasExternalWork()).toBe(true)
  const task = started.run.tasks[0]!
  const context = await runner.claimExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id })
  expect(context.schema).toHaveProperty("type")
  const draft = {
    kind: "worldview" as const,
    title: "外部世界",
    summary: "外部模型写入",
    entries: [{ title: "入口", body: "测试" }],
  }
  const progress = await runner.updateExternalTask({
    projectId: project.id,
    runId: started.run.id,
    taskId: task.id,
    progress: 60,
    draft,
  })
  expect(progress.drafts[task.id]?.progress).toBe(60)
  expect((await openProject(directory)).workspace.assets).toHaveLength(0)
  const finished = await runner.commitExternalTask({
    projectId: project.id,
    runId: started.run.id,
    taskId: task.id,
    document: draft,
  })
  expect(finished.state).toBe("completed")
  const terminal = await runner.getExternalProgress({ projectId: project.id, runId: started.run.id })
  expect(terminal.run.state).toBe("completed")
  expect(terminal.drafts).toEqual({})
  expect((await openProject(directory)).workspace.assets[0]?.document).toEqual(draft)
  await runner.dispose()
  expect(await runner.hasExternalWork()).toBe(false)
  const historical = await runner.getExternalProgress({ projectId: project.id, runId: started.run.id })
  expect(historical.run.state).toBe("completed")
  expect(historical.drafts).toEqual({})
})

test("外部领取任务保持三个并行任务上限", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-external-cap-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const project = await createProject({ directory, name: "并行限制测试", description: "" })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt: "创建四个模块",
    plan: {
      summary: "四个模块",
      questions: [],
      tasks: ["one", "two", "three", "four"].map((key) => ({
        key,
        module: "worldview" as const,
        title: key,
        prompt: "创建四个模块",
        source: "创建四个模块",
        dependencies: [],
        target_id: null,
      })),
    },
  })
  await Promise.all(
    started.run.tasks
      .slice(0, 3)
      .map((task) => runner.claimExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id })),
  )
  const refused = await runner.claimExternalTask({ projectId: project.id, runId: started.run.id, taskId: started.run.tasks[3]!.id }).then(
    () => "",
    (error: Error) => error.message,
  )
  const claimed = (await runner.getExternalProgress({ projectId: project.id, runId: started.run.id })).run.tasks
  expect(claimed.filter(task => task.state === "running")).toHaveLength(PROJECT_RUN_LIMITS.parallel)
  expect(claimed.find(task => task.key === "four")?.state).toBe("queued")
  // Concurrent claims reach the lock in any order. Equal timestamps keep the plan's order.
  const firstClaimed = claimed.filter(task => task.state === "running").sort((left, right) => left.started_at!.localeCompare(right.started_at!))[0]!
  // The refusal says which of the claimed tasks to finish first, and what to do while one of them waits.
  expect(refused).toContain(`同时最多做 ${PROJECT_RUN_LIMITS.parallel} 个任务`)
  expect(refused).toContain("现在领不了「four」")
  expect(refused).toContain(`最先该做完的是「${firstClaimed.title}」`)
  for (const title of ["one", "two", "three"]) expect(refused).toContain(`「${title}」刚领，还在做`)
  expect(refused).toContain("去做另一个已经领了的任务")
  expect(refused).toContain("马上领「four」")
  const canceled = await runner.cancel({ projectId: project.id, runId: started.run.id })
  expect(canceled.state).toBe("canceled")
  expect((await runner.getExternalProgress({ projectId: project.id, runId: started.run.id })).run.state).toBe(
    "canceled",
  )
  await runner.dispose()
})

test("外部任务并发 commit 只能成功一次", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-external-commit-race-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const project = await createProject({ directory, name: "重复提交测试", description: "" })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt: "创建世界观",
    plan: {
      summary: "创建世界观",
      questions: [],
      tasks: [
        {
          key: "world",
          module: "worldview",
          title: "世界观",
          prompt: "创建世界观",
          source: "创建世界观",
          dependencies: [],
          target_id: null,
        },
      ],
    },
  })
  const task = started.run.tasks[0]!
  await runner.claimExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id })
  const document = {
    kind: "worldview" as const,
    title: "并发世界",
    summary: "只允许保存一次",
    entries: [{ title: "入口", body: "测试" }],
  }
  const results = await Promise.allSettled([
    runner.commitExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id, document }),
    runner.commitExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id, document }),
  ])
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
  expect((await runner.getExternalRun({ projectId: project.id, runId: started.run.id })).state).toBe("completed")
  expect((await openProject(directory)).workspace.assets).toHaveLength(1)
  await runner.dispose()
})

test("外部模型通过同一套任务流程保存施法动作，僵硬的动作按同一套验收标准被退回且任务保持可改", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-external-gesture-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const project = await createProject({ directory, name: "施法动作测试", description: "" })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  const started = await runner.startExternal({
    projectId: project.id,
    expectedRevision: project.revision,
    prompt: "做一个向前推出的施法动作",
    plan: {
      summary: "掌心雷",
      questions: [],
      tasks: [{ key: "palm", module: "gesture", title: "掌心雷", prompt: "做一个向前推出的施法动作", source: "做一个向前推出的施法动作", dependencies: [], target_id: null }],
    },
    provenance: { client: "test-client", model: "test-model", verified: false },
  })
  const task = started.run.tasks[0]!
  const context = await runner.claimExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id })
  // The schema handed to the outside AI lists the base motions to choose from and the fixed bones; there is no free-form name to fill in.
  const schema = context.schema as { properties: { base: { enum: string[] }; custom: { properties: { windup: { properties: { bones: { properties: object } } } } } } }
  expect(schema.properties.base.enum).toEqual(GESTURE_BASES.map((base) => base.id))
  expect(Object.keys(schema.properties.custom.properties.windup.properties.bones.properties)).toEqual(GESTURE_BONES.map((bone) => bone.name))
  expect(context.schema).not.toHaveProperty("properties.hand_color")
  // The motion the product owner rejected, sent by an outside AI: refused in plain words, nothing saved, the task still open.
  const stiff = JSON.parse(await readFile(new URL("../../mod-core/test/fixtures/gesture-bad/a-old-sword-fingers.json", import.meta.url), "utf8"))
  expect(context.quality.standard).toContain("验收标准（施法动作）")
  expect(context.instructions).toContain(context.quality.standard)
  const drafted = await runner.updateExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id, progress: 50, draft: stiff })
  expect(drafted.drafts[task.id]?.quality).toMatchObject({ kind: "gesture", passed: false })
  expect(drafted.drafts[task.id]?.quality?.criteria.filter((value) => value.state === "failed").map((value) => value.name)).toEqual(["不机械", "认得出", "有主次"])
  const refusal = await runner.commitExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id, document: stiff }).catch((error: Error) => error.message)
  expect(refusal).toMatch(/^施法动作没通过验收，工程里什么都没有改动。必须逐条改掉：1\. 【认得出】/)
  expect(refusal).toMatch(/【有主次】出手前没有预备动作[\s\S]*【有主次】只有 right_arm、left_arm 在动/)
  expect(refusal).toContain("还可以再交 3 次")
  // Through the MCP boundary the refusal arrives word for word, as it does for a model or a texture.
  const crossed = externalError(await runner.commitExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id, document: stiff }).catch((error: unknown) => error))
  expect(crossed).toBeInstanceOf(StudioError)
  expect(publicError(crossed)).toMatch(/^施法动作没通过验收，工程里什么都没有改动。必须逐条改掉：1\. 【认得出】/)
  expect((await openProject(directory)).workspace.assets).toHaveLength(0)
  expect((await runner.getExternalRun({ projectId: project.id, runId: started.run.id })).state).toBe("running")
  // So is the format that had a separate block hand.
  await expect(runner.commitExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id, document: { kind: "gesture", name: "剑指", english_name: "Sword Fingers", length: 1, hand_color: "#ecb476", trigger: { type: "key", key: "g" }, first_person: {}, third_person: {} } })).rejects.toThrow(/旧格式/)
  const finished = await runner.commitExternalTask({ projectId: project.id, runId: started.run.id, taskId: task.id, document: GESTURE_EXAMPLE })
  expect(finished.state).toBe("completed")
  const saved = (await openProject(directory)).workspace.assets[0]!
  expect(saved).toMatchObject({ module: "gesture", status: "ready", title: "掌心雷" })
  expect(saved.document).toEqual(JSON.parse(JSON.stringify(GESTURE_EXAMPLE)))
  await runner.dispose()
})
test("技能招式缺反馈仍能保存，草稿、提交和活动面板都能看见建议", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-ability-advice-"))
  directories.push(root)
  const directory = path.join(root, "project")
  const project = await createProject({ directory, name: "锻铜短杖", target: "forge-1.20.1" })
  const runner = createProjectRunner({ directoryFor: async () => directory, ai: {} })
  const prompt = "做一把用震击的锻铜短杖"
  const started = await runner.startExternal({
    projectId: project.id, expectedRevision: project.revision, prompt,
    plan: { summary: prompt, questions: [], tasks: [{ key: "shock", module: "ability", title: "锻铜震击", prompt, source: prompt, dependencies: [], target_id: null }] },
    provenance: { client: "test-client", model: "test-model", verified: false },
  })
  const ids = { projectId: project.id, runId: started.run.id, taskId: started.run.tasks[0]!.id }
  await runner.claimExternalTask(ids)
  const { AbilityAssetDocumentSchema } = await import("@minemods/mod-core/ability-asset")
  const document = AbilityAssetDocumentSchema.parse({
    kind: "ability", name: "锻铜震击", english_name: "Copper Shock", reach: 4, cast: { type: "instant", seconds: 0, cooldown: 0 },
    hits: [{ type: "area", at: 0.5, shape: { type: "arc", reach: 3, angle: 90, low: 0, high: 2 }, hits: "everyone", damage: 12, knockback: 1, effects: [] }],
    moves: [], events: [], bindings: [],
  })
  const draft = await runner.updateExternalTask({ ...ids, progress: 75, draft: document })
  expect(draft.drafts[ids.taskId]?.quality?.passed).toBe(true)
  expect(draft.drafts[ids.taskId]?.quality?.advice?.some((entry) => entry.rule === "hit_feedback")).toBe(true)
  const saved = await runner.commitExternalTask({ ...ids, document })
  expect(saved.state).toBe("completed")
  expect(saved.advice?.some((entry) => entry.message.includes("命中反馈"))).toBe(true)
  expect((await openProject(directory)).workspace.assets[0]?.document).toEqual(document)
  const { readActivity } = await import("@minemods/mod-core/activity")
  expect((await readActivity(directory)).events.some((entry) => entry.kind === "check" && entry.mark === "warn" && entry.text.includes("命中反馈"))).toBe(true)
  await runner.dispose()
})

import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createStudioService } from "../src/main/service"
import { createConnectionStore } from "../src/main/connection-store"
import { inHandShare, makingNow, makingSentence, ORDER_WORDS, REVIEWER_OFFER, reviewWaitWords, sinceWords } from "../src/renderer/features/production-words"
import { roundNow } from "../src/renderer/features/asset-making"
import { MCP_SERVER_INSTRUCTIONS, PLAIN_TALK, buildMcpHandoff, buildMcpReviewHandoff } from "../src/main/mcp-handoff"
import type { Making, OverviewItem } from "../src/api"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const settings = { mode: "mcp" as const, baseUrl: "", model: "fixture", routerModel: "fixture", moduleModel: "fixture", transcriptionModel: "fixture" }
const crypto = { encrypt: (value: string) => Buffer.from(value).toString("base64"), decrypt: (value: string) => Buffer.from(value, "base64").toString("utf8") }

async function start() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-review-wait-"))
  directories.push(root)
  const store = createConnectionStore(path.join(root, "connection.json"), crypto)
  const options = { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), connectionStore: store, ai: {} }
  return { root, store, options, service: await createStudioService(options) }
}

test("这次不另请审查：外部 AI 正在做的时候，普通的保存连接被拒绝，这条路不被拒绝；改的只有审查这一个开关，并且重启后还在", async () => {
  const { store, options, service } = await start()
  try {
    await service.saveConnection({ ...settings, review: true })
    expect((await service.getConnection()).review).toBe(true)
    const created = await service.createProject({ name: "审查测试", description: "" })
    const started = await service.externalRunner.startExternal({
      projectId: created.project.id,
      expectedRevision: created.project.revision,
      prompt: "创建世界观",
      plan: { summary: "世界观", questions: [], tasks: [{ key: "world", module: "worldview", title: "世界观", prompt: "创建世界观", source: "创建世界观", dependencies: [], target_id: null }] },
    })
    expect(started.run.tasks).toHaveLength(1)
    // The overview says the switch is on.
    expect((await service.getProjectOverview({ projectId: created.project.id })).review_on).toBe(true)
    // The outside AI is at work: the settings page's own save is refused for exactly that, which is when the person needs the way out.
    await expect(service.saveConnection({ ...settings, review: false })).rejects.toThrow("外部模型正在制作")
    const after = await service.turnOffReview()
    expect(after).toMatchObject({ mode: "mcp", review: false, model: "fixture" })
    expect((await service.getProjectOverview({ projectId: created.project.id })).review_on).toBe(false)
    // Saved the way the settings page saves it, and only that one switch changed.
    expect((await store.load())!.settings).toMatchObject({ ...settings, review: false })
    // Done twice is the same.
    expect((await service.turnOffReview()).review).toBe(false)
    await service.dispose()
    const restarted = await createStudioService(options)
    expect((await restarted.getConnection()).review).toBe(false)
    await restarted.dispose()
  } finally {
    await service.dispose().catch(() => undefined)
  }
})

const waitFor = { waiting: [{ asset_id: "a", title: "小刺猬", since: "2026-10-14T10:00:00.000Z" }], reviewer: "never" as const, offer: true }
const at = (minutes: number) => Date.parse("2026-10-14T10:00:00.000Z") + minutes * 60_000

test("等审查员的话：说什么在等、等了多久、窗口的情况，只说 Studio 知道的", () => {
  const never = reviewWaitWords(waitFor, at(3))
  expect(never.head).toBe("「小刺猬」做好了，在等审查员看")
  expect(never.clock).toBe("已经等了 3 分钟")
  expect(never.reviewer).toBe("还没有审查员的窗口连上来过。")
  expect(never.after).toContain("才轮到你验收")
  expect(never.offer).toBe(true)
  expect(reviewWaitWords({ ...waitFor, waiting: [...waitFor.waiting, { asset_id: "b", title: "刺猬贴图", since: "2026-10-14T10:01:00.000Z" }] }, at(3)).head).toBe("「小刺猬」等 2 样做好了，在等审查员看")
  expect(reviewWaitWords({ ...waitFor, reviewer: "reading", offer: false }, at(1)).head).toBe("审查员正在看「小刺猬」")
  expect(reviewWaitWords({ ...waitFor, reviewer: "silent" }, at(1)).reviewer).toContain("有一阵没有动静")
  expect(reviewWaitWords({ ...waitFor, reviewer: "present", offer: false }, at(1)).offer).toBe(false)
  expect(sinceWords(waitFor.waiting[0]!.since, at(0) + 20_000)).toBe("刚刚")
  expect(sinceWords(waitFor.waiting[0]!.since, at(75))).toBe("已经等了 1 小时 15 分钟")
  expect(sinceWords("not a time", at(1))).toBe("")
  // The two ways on, each with its cost in one sentence; going without is said to be for good, and where to undo it.
  expect(REVIEWER_OFFER.without).toBe("这次不另请审查，让做的 AI 自己检查")
  expect(REVIEWER_OFFER.openHow).toMatch(/额度和时间/)
  expect(REVIEWER_OFFER.withoutHow).toContain("以后都不另请审查员")
  expect(REVIEWER_OFFER.withoutHow).toMatch(/连接 AI.*打开「审查」/)
  expect(REVIEWER_OFFER.withoutHow).toContain("你最后验收不变")
})

test("谁等谁：审查开着是「AI 做 → 另一个 AI 审查 → 你验收」，关着没有中间那一步", () => {
  expect(ORDER_WORDS.on).toContain("AI 做 → 另一个 AI 审查 → 最后你验收")
  expect(ORDER_WORDS.off).toContain("AI 做 → 它自己检查 → 最后你验收")
  expect(ORDER_WORDS.off).not.toContain("另一个 AI 审查 →")
})

const item = (id: string, title: string, kind: string, extra: Partial<OverviewItem> = {}) => ({ id, title, kind, status: "making", asset_id: null, ...extra }) as unknown as OverviewItem
const making = (rounds: number, state: Making["state"], allowed = 6) => ({ rounds: Array.from({ length: rounds }, (_, index) => ({ round: index + 1 })), state, rounds_allowed: allowed }) as unknown as Making
const kinds = [{ id: "model", label: "模型" }, { id: "texture", label: "贴图" }, { id: "entity", label: "生物" }]

test("制作到一半的话：四样都在做、一样没完的时候，说清每一样做到哪，进度条只按记录里有的数填", () => {
  const items = [item("m", "小刺猬", "model"), item("t", "小刺猬", "texture"), item("e", "刺猬", "entity"), item("w", "刺猬窝", "model")]
  const now = makingNow({
    items,
    kinds,
    // The model is at its second version, the texture's draft was reported at 87%, the creature is writing its part sheet, the nest has no record at all yet.
    makings: { m: making(1, "making"), e: making(0, "describing") },
    drafts: [{ kind: "texture", title: "小刺猬", asset_id: null, document: {}, progress: 87 }],
    roundNow,
  })
  expect(now.map((value) => value.said)).toEqual(["做到第 1 版", "进度 87%", "在写部件说明", "刚开始"])
  expect(makingSentence(now)).toBe("正在做 4 样：小刺猬（模型）做到第 1 版；小刺猬（贴图）进度 87%；刺猬（生物）在写部件说明；另外 1 样")
  // What fills the bar: 1 of 6 versions, 87 per cent, nothing, nothing — never more than the records say and never a whole thing.
  expect(now.map((value) => Math.round(value.fraction * 100))).toEqual([17, 87, 0, 0])
  expect(inHandShare(now, 4)).toBeCloseTo((1 / 6 + 0.87) / 4, 5)
  // A thing a version was made of waits for its review; a reported draft over-reaching 100 never reads as finished.
  const full = makingNow({ items: [item("m", "小刺猬", "model")], kinds, makings: { m: making(6, "reviewing") }, drafts: [{ kind: "model", title: "小刺猬", asset_id: null, document: {}, progress: 100 }], roundNow })
  expect(full[0]!.said).toBe("第 6 版做好了，等审查")
  expect(full[0]!.fraction).toBeLessThan(1)
  // Only things being made count; a saved one that is not being made again is not in hand.
  expect(makingNow({ items: [item("s", "石头", "model", { status: "saved" })], kinds, makings: {}, drafts: [], roundNow })).toEqual([])
  expect(makingSentence([])).toBe("")
  // The bar moves: the second version of the model, seen later, fills more than the first.
  const later = makingNow({ items: [items[0]!], kinds, makings: { m: making(2, "making") }, drafts: [], roundNow })
  expect(later[0]!.fraction).toBeGreaterThan(now[0]!.fraction)
})

test("一个草稿按它的资产认，同一个名字的两样东西不会串", () => {
  const items = [item("m", "小刺猬", "model", { asset_id: "asset-model" }), item("t", "小刺猬", "texture", { asset_id: "asset-texture" })]
  const now = makingNow({ items, kinds, makings: {}, drafts: [{ kind: "texture", title: "小刺猬", asset_id: "asset-texture", document: {}, progress: 40 }], roundNow })
  expect(now.map((value) => value.said)).toEqual(["刚开始", "进度 40%"])
})

test("对用户说话：交接说明、服务说明、审查交接都要求用日常的话，并用 Studio 屏幕上的名字指路", () => {
  const configuration = JSON.stringify({ mcpServers: { "minemods-studio": { command: "studio.exe", args: ["mcp-stdio.js"] } } })
  for (const text of [PLAIN_TALK, MCP_SERVER_INSTRUCTIONS.slice(0, PLAIN_TALK.length + 5)]) expect(text).toContain("日常的话")
  expect(MCP_SERVER_INSTRUCTIONS.startsWith(PLAIN_TALK)).toBe(true)
  // It names what the person sees, so there is something to point to; and the jargon it forbids is named once, in the rule that forbids it.
  for (const name of ["看蓝图", "确认蓝图", "就按这个做", "制作现场", "等你验收", "可以，通过", "不满意，要改", "构建并试玩"]) expect(PLAIN_TALK).toContain(name)
  for (const jargon of ["协议版本", "数组", "id", "文件路径"]) expect(PLAIN_TALK).toContain(jargon)
  const maker = buildMcpHandoff({ configuration, review: true })
  expect(maker).toContain("## 怎么跟用户说话")
  expect(maker).toContain(PLAIN_TALK)
  // The old line told it to keep identifiers as they are in everything it outputs, which is what put them in front of the person.
  expect(maker).not.toContain("所有输出使用简体中文；工具返回的 JSON、路径、标识符和错误原文保持原样")
  expect(buildMcpReviewHandoff({ configuration })).toContain("只用日常的话")
})

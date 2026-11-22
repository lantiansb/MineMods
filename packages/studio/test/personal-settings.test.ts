import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { requestAuthoring } from "../src/main/authoring-ai"
import { dispatchExternal } from "../src/main/external-dispatch"
import { buildMcpHandoff, buildMcpReviewHandoff, WISHES_SOURCE } from "../src/main/mcp-handoff"
import { createStudioService } from "../src/main/service"
import { SettingsSchema, standingWishes, WISHES_ORDER } from "../src/settings"

const roots: string[] = []
async function setup(file?: unknown) {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-person-"))
  roots.push(root)
  const options = { workspaceDirectory: path.join(root, "projects"), runtimeDirectory: path.join(root, "runtime"), templateDirectory: path.join(root, "templates"), ai: {} }
  if (file !== undefined) {
    await mkdir(options.workspaceDirectory, { recursive: true })
    await writeFile(path.join(options.workspaceDirectory, "studio-settings.json"), JSON.stringify(file))
  }
  return { root, options, service: await createStudioService(options) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

const configuration = JSON.stringify({ mcpServers: { "minemods-studio": { command: "electron", args: ["mcp-stdio.js"], env: {} } } })
const person = { nickname: "阿铜", style: "vanilla", difficulty: "hard", likes: "喜欢机械和红石", avoid: "不要血腥的东西", standing: "每样东西都给我讲一句它的来历。" } as const

/** One request of Studio's own AI, answered by a stand-in provider; returns the instruction text that was sent. */
async function sent(standing?: "maker" | "reviewer" | "none") {
  const seen: string[] = []
  const text = JSON.stringify({ summary: "好" })
  await requestAuthoring(z.strictObject({ summary: z.string() }), { brief: "一把剑" }, {
    apiKey: "fixture-key", model: "fixture-small", instructions: "只做这一件事。", signal: new AbortController().signal, ...(standing ? { standing } : {}),
    transport: async (_url, init) => {
      seen.push(String(JSON.parse(String(init.body)).instructions))
      return Response.json({ model: "fixture-small", status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] })
    },
  })
  return seen[0]!
}

test("没写身份时，什么都不加：请求、交接和能力清单都和以前一样", async () => {
  const f = await setup()
  expect(standingWishes(await f.service.getSettings())).toBe("")
  expect(standingWishes(await f.service.getSettings(), "reviewer")).toBe("")
  expect(await sent()).toBe("只做这一件事。")
  expect(buildMcpHandoff({ configuration, person: await f.service.getSettings() })).toBe(buildMcpHandoff({ configuration }))
  expect(buildMcpReviewHandoff({ configuration, person: await f.service.getSettings() })).toBe(buildMcpReviewHandoff({ configuration }))
  const connection = await f.service.getConnection()
  await f.service.saveConnection({ mode: "mcp", baseUrl: connection.baseUrl, model: connection.model, routerModel: connection.routerModel, moduleModel: connection.moduleModel, transcriptionModel: connection.transcriptionModel })
  expect((await dispatchExternal(f.service, { method: "getCapabilities", input: {} }) as { person: { wishes: string } }).person).toEqual({ wishes: "" })
})

test("存下的身份进到 Studio 自己的 AI 的每一次请求里，并写明先后次序", async () => {
  const f = await setup()
  await f.service.saveSettings({ ...(await f.service.getSettings()), ...person })
  const instructions = await sent()
  expect(instructions.startsWith("只做这一件事。")).toBe(true)
  for (const words of ["阿铜", "贴近原版", "有挑战", "喜欢机械和红石", "不要血腥的东西", "每样东西都给我讲一句它的来历。", WISHES_ORDER]) expect(instructions).toContain(words)
  expect(instructions.indexOf("制作纪律")).toBeLessThan(instructions.indexOf("这些意愿在后"))
  // Changed in 个人设置: the next request carries the new words, with nothing restarted.
  await f.service.saveSettings({ ...(await f.service.getSettings()), standing: "多用铜。" })
  expect(await sent()).toContain("多用铜。")
  expect(await sent()).not.toContain("来历")
})

test("评审只知道怎么称呼用户；盲认的请求一个字都不带", async () => {
  const f = await setup()
  await f.service.saveSettings({ ...(await f.service.getSettings()), ...person })
  const reviewer = await sent("reviewer")
  expect(reviewer).toContain("阿铜")
  for (const words of ["贴近原版", "有挑战", "机械", "血腥", "来历"]) expect(reviewer).not.toContain(words)
  expect(await sent("none")).toBe("只做这一件事。")
  const review = buildMcpReviewHandoff({ configuration, person: await f.service.getSettings() })
  expect(review).toContain("阿铜")
  for (const words of ["贴近原版", "有挑战", "机械", "血腥", "来历", "person.wishes"]) expect(review).not.toContain(words)
})

test("交接说明带着身份，能力清单随时给出现在的身份", async () => {
  const f = await setup()
  await f.service.saveSettings({ ...(await f.service.getSettings()), ...person })
  const handoff = buildMcpHandoff({ configuration, person: await f.service.getSettings() })
  for (const words of ["这位用户的长期意愿", "阿铜", "贴近原版", "有挑战", "喜欢机械和红石", "不要血腥的东西", "每样东西都给我讲一句它的来历。", WISHES_ORDER, WISHES_SOURCE]) expect(handoff).toContain(words)
  const connection = await f.service.getConnection()
  await f.service.saveConnection({ mode: "mcp", baseUrl: connection.baseUrl, model: connection.model, routerModel: connection.routerModel, moduleModel: connection.moduleModel, transcriptionModel: connection.transcriptionModel })
  const read = async () => (await dispatchExternal(f.service, { method: "getCapabilities", input: {} }) as { person: { wishes: string } }).person.wishes
  expect(await read()).toContain("每样东西都给我讲一句它的来历。")
  expect(await read()).toContain(WISHES_ORDER)
  await f.service.saveSettings({ ...(await f.service.getSettings()), standing: "多用铜。" })
  expect(await read()).toContain("多用铜。")
})

test("旧的设置文件照常读出来：没有的字段是“没说”，当年的默认昵称不算名字", async () => {
  const old = await setup({ nickname: "本地玩家", avatar: "forest", language: "zh-CN", reducedMotion: true, theme: "obsidian", modelComplexity: "high" })
  const settings = await old.service.getSettings()
  expect(settings).toMatchObject({ nickname: "", avatar: "forest", reducedMotion: true, theme: "craft", modelComplexity: "high", style: "none", difficulty: "none", likes: "", avoid: "", standing: "", projectsDirectory: "" })
  expect(standingWishes(settings)).toBe("")
  await expect((await setup({ nickname: "铜工", avatar: "copper" })).service.getSettings()).resolves.toMatchObject({ nickname: "铜工" })
  expect(SettingsSchema.safeParse({ standing: "字".repeat(2001) }).success).toBe(false)
})

test("默认工程目录只认系统选择器给的文件夹，新工程建到那里，已有的不动", async () => {
  const f = await setup()
  const before = await f.service.createProject({ name: "先做的", description: "", empty: true })
  const chosen = path.join(f.root, "我的 模组")
  await mkdir(chosen)
  const token = randomUUID()
  const location = await f.service.registerLocation(token, chosen)
  await expect(f.service.saveProjectsDirectory({ locationToken: randomUUID() })).rejects.toThrow("重新选择")
  expect((await f.service.saveProjectsDirectory({ locationToken: token })).projectsDirectory).toBe(location.label)
  // A save of the page cannot move it: a typed path is never taken.
  expect((await f.service.saveSettings({ ...(await f.service.getSettings()), projectsDirectory: path.join(f.root, "typed") })).projectsDirectory).toBe(location.label)
  const after = await f.service.createProject({ name: "后做的", description: "", empty: true })
  expect(path.dirname(after.directory)).toBe(location.label)
  const restarted = await createStudioService(f.options)
  expect((await restarted.listProjects()).map((entry) => entry.project.id).sort()).toEqual([before.project.id, after.project.id].sort())
  expect((await restarted.saveProjectsDirectory({ locationToken: null })).projectsDirectory).toBe("")
  expect(path.dirname((await restarted.createProject({ name: "回到原处", description: "", empty: true })).directory)).toBe(path.dirname(before.directory))
})

/** Shared by the packaged-app specs that each check one thing a person met: launching, an outside AI over the real MCP process, and a hand on the IPC door. */
import { expect, _electron, type ElectronApplication, type Page } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { spawnSync } from "node:child_process"
import { appendFile, mkdir, mkdtemp, readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { ExternalStartResult } from "../../src/external"
import { modelFixture } from "./model-fixture"

export type Ids = { projectId: string; runId: string; taskId: string }

export async function open(run: (studio: Awaited<ReturnType<typeof start>>) => Promise<void>) {
  const studio = await start()
  const pid = await studio.app.evaluate(() => process.pid)
  try {
    await run(studio)
  } finally {
    await studio.client?.close().catch(() => undefined)
    // A note still in hand makes the window ask before it closes, and nobody is here to answer.
    const closed = await Promise.race([studio.app.close().then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000))])
    if (!closed) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"])
  }
  expect(studio.errors).toEqual([])
}

export async function start(options: { directory?: string; prefix?: string } = {}) {
  const root = path.resolve("../../.artifacts/studio")
  await mkdir(root, { recursive: true })
  const directory = options.directory ?? (await mkdtemp(path.join(root, options.prefix ?? "p3-review-")))
  const app = await _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE!, args: [`--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "" } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  // Leaving with something unsaved asks before the page goes; at the end of a test that is answered, or closing reports the question as an error.
  page.on("dialog", (dialog) => void dialog.accept().catch(() => undefined))
  await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => /index\.html/.test(window.webContents.getURL()))!.setContentSize(1366, 768))
  return { app, page, errors, directory, client: undefined as Client | undefined }
}

export const createProject = (page: Page, name: string, modId: string) =>
  page.evaluate(
    async (input) => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      return window.studio.createProject({ name: input.name, description: "", modId: input.modId, empty: true })
    },
    { name, modId },
  )

export const enter = async (page: Page, name: string) => {
  await page.locator(".mm-world").filter({ hasText: name }).first().click()
  await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
}
export const goHome = async (page: Page) => {
  await page.getByRole("button", { name: "MineMods Studio 首页", exact: true }).click()
  await expect(page.locator(".mm-logo-face")).toBeVisible()
}

// Things done while nobody looks, or all at once: straight into the log the app reads.
export const happened = async (directory: string, titles: string[]) => {
  const file = path.join(directory, ".minemods", "activity.jsonl")
  await mkdir(path.dirname(file), { recursive: true })
  const lines = await readFile(file, "utf8").then((text) => text.trim().split("\n").filter(Boolean), () => [] as string[])
  const last = lines.length ? (JSON.parse(lines.at(-1)!) as { seq: number }).seq : 0
  await appendFile(file, titles.map((title, index) => `${JSON.stringify({ seq: last + index + 1, at: new Date().toISOString(), kind: "task", mark: "ok", item: randomUUID(), title, text: "确定性的完成事件", end: true })}\n`).join(""))
}
export const earnedIn = (directory: string) => readFile(path.join(directory, ".minemods", "making", "advancements.json"), "utf8").then((text) => (JSON.parse(text) as { earned: string[] }).earned, () => null)

// Every toast shown from here on.
export const watchToasts = (page: Page) =>
  page.evaluate(() => {
    const holder = window as unknown as { heads: string[] }
    holder.heads = []
    new MutationObserver((changes) =>
      changes.forEach((change) =>
        change.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains("adv-toast")) holder.heads.push(node.querySelector("strong")?.textContent ?? "")
        }),
      ),
    ).observe(document.querySelector(".adv-stack")!, { childList: true, subtree: true })
  })
export const heads = (page: Page) => page.evaluate(() => (window as unknown as { heads: string[] }).heads)

export const connect = async (studio: Awaited<ReturnType<typeof start>>) => {
  const configuration = await studio.page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
  const transport = new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" })
  studio.client = new Client({ name: "p3-review-collaborator", version: "1" })
  await studio.client.connect(transport)
  await expect(studio.page.locator("[data-presence=connected]")).toBeVisible()
  return async <T,>(name: string, args: Record<string, unknown>) => {
    const response = CallToolResultSchema.parse(await studio.client!.callTool({ name, arguments: args }))
    expect(response.isError, `${name}: ${JSON.stringify(response.content).slice(0, 800)}`).not.toBe(true)
    const text = response.content.find((item) => item.type === "text")
    if (!text || text.type !== "text") throw new Error(`${name}: missing text`)
    return JSON.parse(text.text) as T
  }
}
export type Call = Awaited<ReturnType<typeof connect>>

export const pieces = (title: string) => {
  const design = modelFixture(title)
  const order = (() => {
    const placed: string[] = []
    const left = design.bones.map((bone) => bone.name)
    while (left.length) {
      const next = left.findIndex((name) => {
        const parent = design.bones.find((bone) => bone.name === name)!.parent
        return !parent || placed.includes(parent)
      })
      placed.push(...left.splice(next < 0 ? 0 : next, 1))
    }
    return placed
  })()
  const piece = (count: number) => {
    const names = order.slice(0, count)
    return {
      ...design,
      bones: design.bones.filter((bone) => names.includes(bone.name)),
      animations: design.animations.flatMap((animation) => {
        const channels = animation.channels.filter((channel) => names.includes(channel.bone))
        return channels.length || ["idle", "walk", "hurt"].includes(animation.name) ? [{ ...animation, channels }] : []
      }),
    }
  }
  return { design, order, piece, all: piece(order.length) }
}
export const finish = async (call: Call, ids: Ids, title: string, document: unknown) => {
  const { design } = pieces(title)
  await call("save_sheet", { ...ids, sheet: { subject: title, recognisable: ["圆头", "四只脚"], assumed: [], parts: design.bones.map((bone) => ({ name: bone.name, what: `小鸡的${bone.name}`, shape: "按现有立方体", attaches: bone.parent ? `接在 ${bone.parent}` : "根", surface: "沿用现有颜色", moves: "跟着动作动", assumed: false })) } })
  await call("look", { ...ids, document })
  await call("self_review", { ...ids, matches: ["部件齐了。"], problems: [], next: [], verdict: "done" })
  const review = await call<{ blind_first?: boolean }>("final_review", ids)
  if (review.blind_first) await call("final_review", { ...ids, blind: { sees: "一个有头和脚的小动物", also: [], because: "确定性测试协作者的回答，不作为真实评审证据。" } })
  await call("final_review", { ...ids, verdict: { passed: true, findings: [], advice: [], independent: false, ...(review.blind_first ? { fits: "at_once" } : {}) } })
  await call("commit_task", { ...ids, document })
}
export const plan = async (call: Call, projectId: string, tasks: { key: string; title: string; target?: string }[]) => {
  const opened = await call<{ project: { revision: number } }>("open_project", { projectId })
  const started = await call<ExternalStartResult>("plan_run", { projectId, expectedRevision: opened.project.revision, prompt: "做模型", plan: { summary: "测试", questions: [], tasks: tasks.map((task) => ({ key: task.key, module: "model", title: task.title, prompt: "做模型", source: "做模型", dependencies: [], target_id: task.target ?? null })) } })
  return started.run
}

export const MODEL = "彩虹小鸡模型"

// A model waiting for a verdict, its card open at 制作过程.
export const atTheCard = async (studio: Awaited<ReturnType<typeof start>>) => {
  const { page } = studio
  const created = await createProject(page, "周末彩虹乐园", "p3_review")
  const projectId = created.project.id
  await page.reload()
  await enter(page, "周末彩虹乐园")
  const call = await connect(studio)
  const first = await plan(call, projectId, [{ key: "chick", title: MODEL }])
  const ids = { projectId, runId: first.id, taskId: first.tasks[0]!.id }
  const assetId = first.tasks[0]!.asset_id!
  await call("claim_task", ids)
  const { all } = pieces(MODEL)
  await finish(call, ids, MODEL, all)
  const second = await plan(call, projectId, [{ key: "chick2", title: MODEL, target: assetId }])
  const secondIds = { projectId, runId: second.id, taskId: second.tasks[0]!.id }
  await call("claim_task", secondIds)
  await finish(call, secondIds, MODEL, all)
  const waiting = () => page.evaluate(async (id) => (await window.studio.getProjectOverview({ projectId: id })).production?.to_review ?? 0, projectId)
  await expect.poll(waiting, { timeout: 30000 }).toBe(1)
  await page.getByRole("button", { name: "模组总览", exact: true }).click().catch(() => undefined)
  await page.locator('.inv-slot[data-kind="model"][data-item]').filter({ hasText: MODEL }).first().click()
  const card = page.getByRole("dialog", { name: MODEL, exact: true })
  await card.getByRole("tab", { name: "制作过程", exact: true }).click()
  const history = () => page.evaluate((input) => window.studio.getMakingHistory(input), { projectId, assetId })
  const circle = card.getByRole("button", { name: "圈一下", exact: true })
  const marks = card.locator(".mh-marks")
  const box = card.getByRole("textbox", { name: /想怎么改/ })
  // By keyboard: Enter on the picture marks its middle.
  const write = async (words: string) => {
    if ((await circle.getAttribute("aria-pressed")) !== "true") await circle.click()
    await marks.focus()
    await page.keyboard.press("Enter")
    await box.fill(words)
  }
  const note = async (words: string) => {
    await write(words)
    await page.keyboard.press("Control+Enter")
    await expect(box).toHaveCount(0)
    return (await history()).notes.at(-1)!.id
  }
  return { card, history, circle, marks, box, write, note, waiting, assetId, projectId, call }
}

// The door every request goes through, with a hand on it.
export const holdAtTheDoor = (app: ElectronApplication, wanted: { method?: string; pattern?: string; change?: string; assetId?: string }, how: "hold" | "fail") =>
  app.evaluate(
    ({ ipcMain }, input) => {
      const shared = globalThis as unknown as { door?: unknown; started?: boolean; release?: () => void }
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (event: unknown, request: { method: string; input: Record<string, unknown> }) => unknown> })._invokeHandlers
      const original = handlers.get("studio:invoke")!
      shared.door = original
      shared.started = false
      ipcMain.removeHandler("studio:invoke")
      ipcMain.handle("studio:invoke", async (event, request) => {
        const named = input.wanted.pattern ? new RegExp(input.wanted.pattern, "i").test(request.method) : request.method === input.wanted.method
        const hit = named && (!input.wanted.change || request.input.change === input.wanted.change) && (!input.wanted.assetId || request.input.assetId === input.wanted.assetId)
        if (hit && input.how === "fail") throw new Error("模拟的写入失败")
        if (hit && !shared.started) {
          shared.started = true
          await new Promise<void>((resolve) => (shared.release = resolve))
        }
        return original(event, request)
      })
    },
    { wanted, how },
  )
export const asked = (app: ElectronApplication) => app.evaluate(() => !!(globalThis as unknown as { started?: boolean }).started)
export const letGo = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { release?: () => void }).release?.())
export const openTheDoor = (app: ElectronApplication) =>
  app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("studio:invoke")
    ipcMain.handle("studio:invoke", (globalThis as unknown as { door: (event: unknown, request: unknown) => unknown }).door as never)
  })

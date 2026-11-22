import { expect, test, _electron } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { applyWorkspaceAsset } from "@minemods/mod-core/workspace"
import type { ExternalStartResult } from "../../src/external"
import path from "node:path"

test("P0 正式包：两栏四种组合、唯一入口、真实心跳五态与恢复", async () => {
  const directory = await mkdtemp(path.resolve("../../.artifacts/studio/shelf-p0-"))
  await mkdir(path.join(directory, "screens"))
  const executable = process.env.STUDIO_PACKAGED_EXECUTABLE!
  const app = await _electron.launch({ executablePath: executable, args: [`--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "" } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  const evidence: Record<string, unknown> = { directory, fixture: "local deterministic collaborator; real packaged stdio process, real idle wait and real process kill" }
  let client: Client | undefined
  let transport: StdioClientTransport | undefined
  const shot = (name: string) => page.screenshot({ path: path.join(directory, "screens", `${name}.png`), animations: "disabled", scale: "css" })
  const size = async (width: number, height: number) => {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setContentSize(value[0], value[1]), [width, height])
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  }
  const connect = async () => {
    const configuration = await page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
    transport = new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" })
    client = new Client({ name: "shelf-presence-fixture", version: "1" })
    await client.connect(transport)
  }
  const call = async <T,>(name: string, args: Record<string, unknown>): Promise<T> => {
    const response = CallToolResultSchema.parse(await client!.callTool({ name, arguments: args }))
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true)
    const text = response.content.find((c) => c.type === "text")
    if (!text || text.type !== "text") throw new Error("missing text")
    return JSON.parse(text.text) as T
  }
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    evidence.application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath }))
    await app.evaluate(({ Notification }) => {
      const state = globalThis as typeof globalThis & { shelfNotifications?: { title: string; body: string; shown: boolean; failed: string | null }[] }
      state.shelfNotifications = []
      const show = Notification.prototype.show
      Notification.prototype.show = function () {
        const entry = { title: this.title, body: this.body, shown: false, failed: null as string | null }
        state.shelfNotifications!.push(entry)
        this.on("show", () => { entry.shown = true })
        this.on("failed", (_event, error) => { entry.failed = error })
        show.call(this)
      }
    })
    const created = await page.evaluate(async () => {
      const { hasApiKey, source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      return window.studio.createProject({ name: "山谷里的周末", description: "会发光的矿石，风铃和小小的营地", modId: "shelf_weekend", empty: true })
    })
    let project = created.project
    const base = { revision: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), prompt: "本地验收样例", dependencies: [], provenance: { model: null, request_id: null }, status: "ready" as const }
    for (const [identifier, name, color] of [["moon_ore", "月光矿石", "#5688cc"], ["moss_stone", "苔藓石", "#638649"], ["camp_lamp", "营地小灯", "#e6b45b"]]) project = applyWorkspaceAsset(project, { ...base, id: crypto.randomUUID(), module: "block", title: name, document: { kind: "block", identifier, name, hardness: 1.5, luminance: 6, tool: "pickaxe", drop: "self", color, texture: null } })
    for (const [identifier, name, color] of [["moon_shard", "月光碎片", "#79a9de"], ["wind_bell", "随身风铃", "#bd8545"]]) project = applyWorkspaceAsset(project, { ...base, id: crypto.randomUUID(), module: "item", title: name, document: { kind: "item", identifier, name, max_stack: 64, color, texture: null } })
    execFileSync(process.env.BUN_EXECUTABLE ?? path.join(process.env.USERPROFILE!, ".bun/bin/bun.exe"), ["-e", 'import {saveProject} from "@minemods/mod-core/project"; const x=JSON.parse(process.argv[1]); await saveProject(x.directory,x.project,x.project.revision)', JSON.stringify({ directory: created.directory, project })], { cwd: process.cwd(), windowsHide: true })
    await size(1366, 768)
    await page.reload()
    await page.locator(".project-card").filter({ hasText: created.project.name }).click()
    await expect(page.locator(".inv-slot")).toHaveCount(5)
    await expect(page.locator(".inv-section")).toHaveCount(2)
    await expect(page.locator(".project-assets .pa-slot")).toHaveCount(0)
    await expect(page.getByRole("tab", { name: "按种类看", exact: true })).toHaveCount(0)
    await expect(page.locator("#project-sidebar").getByRole("button", { name: "制作现场", exact: true })).toHaveCount(0)
    await expect(page.locator("#project-sidebar").getByRole("button", { name: "模组信息", exact: true })).toHaveCount(0)
    const toggleLeft = async (open: boolean) => { const compact = await page.locator("#project-sidebar").evaluate((n) => n.classList.contains("compact")); if (compact === open) await page.getByRole("button", { name: open ? "展开左栏" : "收起左栏", exact: true }).click() }
    const toggleRight = async (open: boolean) => { const expanded = await page.locator(".ac-panel").evaluate((n) => n.classList.contains("open")); if (expanded !== open) await page.getByRole("button", { name: open ? /^打开动态/ : "收起动态", exact: true }).click() }
    for (const [width, height] of [[1366, 768], [1920, 1080]]) {
      await size(width, height)
      for (const left of [true, false]) for (const right of [true, false]) {
        await toggleLeft(left); await toggleRight(right)
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await shot(`${width}-overview-left-${left ? "open" : "closed"}-activity-${right ? "open" : "closed"}`)
      }
      await page.getByRole("button", { name: "加一样东西", exact: true }).click()
      await expect(page.getByRole("dialog", { name: "加一样东西", exact: true }).locator(".shelf-add-grid button")).toHaveCount(11)
      await expect(page.getByRole("dialog", { name: "加一样东西", exact: true }).locator(".shelf-add-grid button:enabled")).toHaveCount(11)
      await shot(`${width}-add`)
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog", { name: "加一样东西", exact: true })).toHaveCount(0)
      await page.getByRole("button", { name: /^AI 连接：/ }).click()
      await shot(`${width}-connection-unconnected`)
      await page.keyboard.press("Escape")
    }
    await page.reload()
    await page.locator(".project-card").filter({ hasText: created.project.name }).click()
    await expect(page.locator("#project-sidebar")).toHaveClass(/compact/)
    await expect(page.locator(".ac-panel")).not.toHaveClass(/open/)
    await size(1200, 768)
    await page.evaluate(() => { localStorage.removeItem("minemods.navigation.open"); localStorage.removeItem("minemods.activity.open") })
    await page.reload(); await page.locator(".project-card").filter({ hasText: created.project.name }).click()
    await expect(page.locator("#project-sidebar")).toHaveClass(/compact/)
    await expect(page.locator(".ac-panel")).not.toHaveClass(/open/)
    await page.getByRole("button", { name: "展开左栏", exact: true }).click()
    await size(1100, 768)
    await expect(page.locator("#project-sidebar")).not.toHaveClass(/compact/)
    evidence.shelves = { persisted: true, defaults: "left below 1280; activity below 1366", manualResizeOverride: true, uniqueThings: 5, nonemptyCategories: 2 }
    await connect()
    await expect(page.locator("[data-presence=connected]")).toBeVisible()
    for (const [width, height] of [[1366, 768], [1920, 1080]]) { await size(width, height); await shot(`${width}-connected`) }
    const latest = await call<{ project: typeof project }>("open_project", { projectId: project.id })
    const run = await call<ExternalStartResult>("plan_run", { projectId: project.id, expectedRevision: latest.project.revision, prompt: "山谷的设计稿", plan: { summary: "补世界设计稿", questions: [], tasks: [{ key: "world", module: "worldview", title: "晨雾山谷", prompt: "山谷的设计稿", source: "山谷的设计稿", dependencies: [], target_id: null }] } })
    await call("claim_task", { projectId: project.id, runId: run.run.id, taskId: run.run.tasks[0].id })
    await expect(page.locator("[data-presence=working]")).toBeVisible()
    for (const [width, height] of [[1366, 768], [1920, 1080]]) { await size(width, height); await shot(`${width}-working`) }
    const claimedAt = Date.now()
    await expect(page.locator("[data-presence=idle]")).toBeVisible({ timeout: 50000 })
    evidence.idle = { elapsed: Date.now() - claimedAt, status: await page.evaluate(() => window.studio.getMcpStatus()) }
    // Persisted evidence excludes the private bridge configuration/token.
    delete (evidence.idle as { status: Record<string, unknown> }).status.configuration
    delete (evidence.idle as { status: Record<string, unknown> }).status.codexConfiguration
    for (const [width, height] of [[1366, 768], [1920, 1080]]) { await size(width, height); await shot(`${width}-idle-warning`); await page.getByRole("button", { name: /^AI 连接：/ }).click(); await shot(`${width}-connection-details`); await page.keyboard.press("Escape") }
    await page.getByRole("button", { name: "再等等", exact: true }).click()
    await expect(page.locator(".presence-banner")).toHaveCount(0)
    // The connection is read every 1.5 s, and still says idle: that is no news, and what was put away stays away.
    await page.waitForTimeout(2500)
    await expect(page.locator(".presence-banner"), "点了再等等，横幅不会自己回来").toHaveCount(0)
    await call("list_projects", {})
    await expect(page.locator("[data-presence=working]")).toBeVisible()
    const pid = transport!.pid!
    const killedAt = Date.now()
    process.kill(pid)
    await expect(page.locator("[data-presence=disconnected]")).toBeVisible({ timeout: 3000 })
    evidence.processExit = { pid, elapsed: Date.now() - killedAt }
    evidence.notifications = await app.evaluate(() => (globalThis as typeof globalThis & { shelfNotifications?: unknown[] }).shelfNotifications)
    expect(evidence.notifications).toMatchObject([{ title: "MineMods · 断开了", shown: true, failed: null }])
    await client!.close().catch(() => undefined)
    for (const [width, height] of [[1366, 768], [1920, 1080]]) { await size(width, height); await shot(`${width}-disconnected-error`); await page.getByRole("button", { name: /^AI 连接：/ }).click(); await shot(`${width}-disconnected-details`); await page.keyboard.press("Escape") }
    await connect()
    await expect(page.locator(".presence-banner[data-state=restored]")).toBeVisible()
    await page.waitForTimeout(2500)
    await expect(page.locator(".presence-banner[data-state=restored]"), "重新连上的提示要留够 4 秒，不被下一次读取带走").toBeVisible()
    for (const [width, height] of [[1366, 768], [1920, 1080]]) { await size(width, height); await shot(`${width}-restored-success`) }
    await expect(page.locator(".presence-banner")).toHaveCount(0, { timeout: 6000 })
    expect(errors).toEqual([])
  } finally {
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ ...evidence, errors }, null, 2))
    await page.screenshot({ path: path.join(directory, "final.png") }).catch(() => undefined)
    await client?.close().catch(() => undefined)
    await app.close()
  }
})

test("后台断开使用 Windows 原生通知，前台断开不重复通知", async () => {
  const directory = await mkdtemp(path.resolve("../../.artifacts/studio/shelf-notification-"))
  const app = await _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE!, args: [`--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "" } })
  const page = await app.firstWindow()
  let client: Client | undefined
  const connect = async () => {
    const configuration = await page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
    const transport = new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" })
    client = new Client({ name: "notification-fixture", version: "1" })
    await client.connect(transport)
    await expect.poll(() => page.evaluate(async () => (await window.studio.getMcpStatus()).connected)).toBe(true)
    return transport.pid!
  }
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.evaluate(async () => { const { hasApiKey, source, ...settings } = await window.studio.getConnection(); await window.studio.saveConnection({ ...settings, mode: "mcp" }) })
    await app.evaluate(({ Notification }) => {
      const state = globalThis as typeof globalThis & { notifyLog?: { title: string; body: string; shown: boolean; failed: string | null }[] }
      state.notifyLog = []
      const show = Notification.prototype.show
      Notification.prototype.show = function () {
        const row = { title: this.title, body: this.body, shown: false, failed: null as string | null }
        state.notifyLog!.push(row)
        this.on("show", () => { row.shown = true })
        this.on("failed", (_event, error) => { row.failed = error })
        show.call(this)
      }
    })
    const pid = await connect()
    // A temporary test surface fills the primary display so the OS screenshot contains no other app's content.
    await app.evaluate(async ({ BrowserWindow, screen }) => {
      const cover = new BrowserWindow({ ...screen.getPrimaryDisplay().bounds, title: "MineMods 系统通知验收", frame: false, alwaysOnTop: true, backgroundColor: "#242424", webPreferences: { nodeIntegration: false, contextIsolation: true } })
      await cover.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<html><body style="margin:0;background:#242424;color:#ddd;font-family:Microsoft YaHei UI;display:grid;place-content:center;height:100vh"><h1>MineMods Studio</h1><p>后台断开 · Windows 原生通知验收</p><p>临时验收画面</p></body></html>')}`)
      cover.show(); cover.focus()
    })
    process.kill(pid)
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { notifyLog: { shown: boolean }[] }).notifyLog[0]?.shown)).toBe(true)
    // Capture the actual OS composition, including its native toast, rather than a mocked web banner.
    await page.waitForTimeout(800)
    const capture = await app.evaluate(async ({ desktopCapturer, screen }) => {
      const display = screen.getPrimaryDisplay()
      const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } })
      const source = sources.find((value) => value.display_id === String(display.id)) ?? sources[0]
      return source.thumbnail.toPNG().toString("base64")
    })
    await writeFile(path.join(directory, "windows-notification.png"), Buffer.from(capture, "base64"))
    await page.waitForTimeout(1000)
    expect(await app.evaluate(() => (globalThis as typeof globalThis & { notifyLog: unknown[] }).notifyLog.length)).toBe(1)
    await client!.close().catch(() => undefined)
    const nextPid = await connect()
    await app.evaluate(({ BrowserWindow }) => { const windows = BrowserWindow.getAllWindows(); const main = windows.find((w) => w.webContents.getURL().endsWith("index.html"))!; windows.filter((w) => w.title === "MineMods 系统通知验收").forEach((w) => w.destroy()); main.show(); main.focus() })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFocused()))).toBe(true)
    process.kill(nextPid)
    await expect.poll(() => page.evaluate(async () => (await window.studio.getMcpStatus()).state)).toBe("disconnected")
    await page.waitForTimeout(500)
    const notifications = await app.evaluate(() => (globalThis as typeof globalThis & { notifyLog: unknown[] }).notifyLog)
    expect(notifications).toHaveLength(1)
    await writeFile(path.join(directory, "notification-evidence.json"), JSON.stringify({ packaged: true, background: notifications, sameDisconnectOnce: true, foregroundNotificationCount: 0, screenshot: "windows-notification.png" }, null, 2))
  } finally {
    await client?.close().catch(() => undefined)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => undefined)
    await app.close()
  }
})

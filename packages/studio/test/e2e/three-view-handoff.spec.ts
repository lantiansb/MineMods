import { expect, test, _electron, type Page } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { encodePng } from "@minemods/mod-core/png"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ThreeViewResult } from "../../src/api"

type ExternalThreeViewResult = Omit<ThreeViewResult, "references"> & {
  references: Omit<ThreeViewResult["references"][number], "url">[]
}

const artifacts = path.resolve("../../.artifacts/studio")
const title = "归途龙外形动作"
const brief = "身高 2.4 米的归途龙，深蓝色鳞片、金色眼睛，背上有一对青绿色宽翅膀，长尾巴末端有白色尾鳍，四足站立，动作包括呼吸、行走和展开翅膀。"
const itemId = "homeward_dragon_model"

async function openProject(page: Page, name: string) {
  await page.reload()
  const card = page.locator(".project-card").filter({ hasText: name })
  if (await card.count()) await card.click()
  await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
}

// A deterministic transport fixture, not an image produced by a real AI image tool.
function sixViewFixture() {
  const width = 384
  const height = 256
  const pixels = new Uint8Array(width * height * 4)
  const rectangle = (x: number, y: number, w: number, h: number, color: readonly number[]) => {
    Array.from({ length: h }, (_, row) => row).forEach((row) => {
      Array.from({ length: w }, (_, column) => column).forEach((column) => {
        pixels.set([...color, 255], ((y + row) * width + x + column) * 4)
      })
    })
  }
  rectangle(0, 0, width, height, [232, 230, 219])
  Array.from({ length: 6 }, (_, view) => view).forEach((view) => {
    const x = (view % 3) * 128
    const y = Math.floor(view / 3) * 128
    rectangle(x + 8, y + 8, 112, 112, [245, 243, 232])
    rectangle(x + 46, y + 48, 36, 44, [31, 63, 105])
    rectangle(x + (view === 2 ? 28 : 53), y + 29, 25, 24, [31, 63, 105])
    rectangle(x + 20, y + 49, 26, 23, [42, 131, 126])
    rectangle(x + 82, y + 49, 26, 23, [42, 131, 126])
    rectangle(x + 47, y + 92, 11, 15, [24, 49, 83])
    rectangle(x + 70, y + 92, 11, 15, [24, 49, 83])
    rectangle(x + (view === 2 ? 17 : 93), y + 79, 13, 8, [244, 246, 235])
    if (view !== 1) rectangle(x + (view === 2 ? 30 : 69), y + 35, 5, 5, [224, 178, 59])
  })
  return encodePng(pixels, width, height)
}

test("MCP 六视图任务可真实交接、自动添加图片并回传不支持状态", async () => {
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "three-view-handoff-"))
  const executable = process.env.STUDIO_PACKAGED_EXECUTABLE || process.env.MINEMODS_STUDIO_EXECUTABLE
  const app = await _electron.launch({
    executablePath: executable || path.resolve("node_modules/electron/dist/electron.exe"),
    args: [...(executable ? [] : [process.cwd()]), `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env,
      OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
      MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
    },
  })
  const page = await app.firstWindow()
  const client = new Client({ name: "six-view-deterministic-collaborator", version: "1.0.0" })
  const errors: string[] = []
  const evidence: Record<string, unknown> = { directory, author: "deterministic local MCP fixture; no live AI image quality claim" }
  page.on("pageerror", (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: "reduce" })
  const call = async <T>(name: string, args: Record<string, unknown>) => {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
    expect(result.isError, `${name}: ${JSON.stringify(result.content)}`).not.toBe(true)
    const content = result.content.find((value) => value.type === "text")
    if (!content || content.type !== "text") throw new Error(`${name}: missing text result`)
    if (name === "finish_six_view") {
      expect(JSON.stringify(result.content), "MCP 工具只回显参考图元数据，不重复传回图片").not.toContain("data:image")
      expect(JSON.stringify(result.structuredContent)).not.toContain("data:image")
    }
    return JSON.parse(content.text) as T
  }
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    evidence.application = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged, executable: process.execPath, appPath: app.getAppPath(),
      hidden: BrowserWindow.getAllWindows().every((window) => !window.isVisible() && !window.isFocused()),
    }))
    expect(evidence.application).toMatchObject({ packaged: Boolean(executable), hidden: true })
    const created = await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp", baseUrl: "http://127.0.0.1:9/v1", clearApiKey: true })
      return window.studio.createProject({ name: "归途龙六视图交接验收", modId: "six_view_handoff", description: "真实 MCP 自动归图与能力回报", empty: true })
    })
    expect(await page.evaluate(() => window.studio.getConnection())).toMatchObject({ mode: "mcp", hasApiKey: false })
    const configuration = await page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
    await client.connect(new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" }))
    await call("propose_blueprint", {
      projectId: created.project.id,
      request: "先画归途龙六视图，确认后才开始制作模型。",
      blueprint: {
        style: { palette: ["#1F3F69", "#2A837E"], shape: "方块造型", naming: "小写英文", world: "归途龙栖息的山谷" },
        entries: [
          { key: itemId, kind: "model", title, brief, owner: null, needs: [], out_of_scope: null },
          { key: "unsupported_model", kind: "model", title: "归途龙能力回报", brief: "另一份尚未开始的模型，用于检查外部 AI 不具备生图能力时的提示。", owner: null, needs: [], out_of_scope: null },
        ],
        questions: [],
      },
      paper_play: { findings: [], advice: [], independent: false },
    })
    const before = await page.evaluate((projectId) => window.studio.getProjectOverview({ projectId }), created.project.id)
    expect(before.items.find((item) => item.id === itemId)).toMatchObject({ kind: "model", facts: { saved: false }, preview: { source: null } })
    await openProject(page, created.project.name)
    await page.locator(`.inv-slot[data-item="${itemId}"]`).click()
    const dialog = page.getByRole("dialog", { name: title, exact: true })
    const block = dialog.getByRole("region", { name: "六视图", exact: true })
    await expect(block).toBeVisible()
    await expect(block.getByRole("button", { name: "复制六视图任务", exact: true })).toBeEnabled()
    await expect(block.getByRole("button", { name: "让 AI 画六视图", exact: true })).toHaveCount(0)
    await expect(block).not.toContainText("得在「连接」里接上一个能画图的接口")
    const prompt = await call<string>("get_six_view_prompt", { projectId: created.project.id, itemId })
    for (const phrase of [title, brief, created.project.id, itemId, "不要开始建模", "finish_six_view", "unsupported", "不具备生图能力", "独立准备", "three columns and two rows", "the front view", "the back view", "its own left side", "its own right side", "the top-down view", "a three-quarter front-right orthographic view"]) expect(prompt).toContain(phrase)
    expect(prompt.indexOf("the front view")).toBeLessThan(prompt.indexOf("the back view"))
    expect(prompt.indexOf("its own left side")).toBeLessThan(prompt.indexOf("its own right side"))
    expect(prompt.indexOf("the top-down view")).toBeLessThan(prompt.indexOf("a three-quarter front-right orthographic view"))
    await writeFile(path.join(directory, "six-view-task.txt"), prompt)
    const clipboard = await app.evaluate(({ clipboard }) => ({
      formats: clipboard.availableFormats(), text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(),
      image: clipboard.readImage().isEmpty() ? null : clipboard.readImage().toDataURL(),
    }))
    const unsupportedFormats = clipboard.formats.filter((format) => !["text/plain", "text/html", "text/rtf", "image/png", "image/bmp"].includes(format))
    evidence.clipboardFormats = clipboard.formats
    expect(unsupportedFormats, "当前剪贴板包含无法完整恢复的格式；复制验证前停止，保护用户内容").toEqual([])
    try {
      await block.getByRole("button", { name: "复制六视图任务", exact: true }).click()
      await expect(block.getByText("任务已复制，发给外部 AI；生成的图片会自动出现在这里。", { exact: true })).toBeVisible()
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(prompt)
      evidence.clipboard = "real operating-system clipboard, restored immediately after copy assertion"
    } finally {
      await app.evaluate(({ clipboard, nativeImage }, previous) => {
        clipboard.clear()
        if (!previous.formats.length) return
        clipboard.write({
          ...(previous.text ? { text: previous.text } : {}),
          ...(previous.html ? { html: previous.html } : {}),
          ...(previous.rtf ? { rtf: previous.rtf } : {}),
          ...(previous.image ? { image: nativeImage.createFromDataURL(previous.image) } : {}),
        })
      }, clipboard)
      expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(clipboard.text)
    }
    await page.screenshot({ path: path.join(directory, "handoff-ready.png"), fullPage: true })
    // Reject only the native write boundary: prompt lookup, validation and IPC stay real.
    await app.evaluate(({ clipboard }) => {
      const state = globalThis as typeof globalThis & { sixViewOriginalWriteText?: typeof clipboard.writeText }
      state.sixViewOriginalWriteText = clipboard.writeText
      clipboard.writeText = () => { throw new Error("E2E clipboard write denied") }
    })
    try {
      await block.getByRole("button", { name: "复制六视图任务", exact: true }).click()
      const manual = block.getByRole("textbox", { name: "六视图任务", exact: true })
      await expect(manual).toBeVisible()
      await expect(manual).toHaveAttribute("readonly", "")
      await expect(manual).toHaveValue(prompt)
      await expect(block.getByRole("alert").filter({ hasText: "未能写入剪贴板" })).toBeVisible()
      evidence.copyFailure = { nativeWriteRejected: true, realPromptRetained: true, manualCopyVisible: true }
      await page.screenshot({ path: path.join(directory, "copy-fallback.png"), fullPage: true })
    } finally {
      await app.evaluate(({ clipboard }) => {
        const state = globalThis as typeof globalThis & { sixViewOriginalWriteText?: typeof clipboard.writeText }
        if (state.sixViewOriginalWriteText) clipboard.writeText = state.sixViewOriginalWriteText
        delete state.sixViewOriginalWriteText
      })
    }
    const image = sixViewFixture()
    await writeFile(path.join(directory, "synthetic-six-view-fixture.png"), image)
    const generated = await call<ExternalThreeViewResult>("finish_six_view", {
      projectId: created.project.id, itemId,
      result: { status: "generated", name: "归途龙六方向测试图.png", image: `data:image/png;base64,${image.toString("base64")}` },
    })
    expect(generated).toMatchObject({ status: "generated", references: [{ kind: "three_view", view: "sheet", by: "ai" }] })
    expect(generated.references.every((reference) => !("url" in reference))).toBe(true)
    expect(generated.message).toMatch(/已.*六视图/)
    await expect(block.getByRole("button", { name: "放大看：一整张六视图，AI 画的", exact: true })).toBeVisible()
    await expect(block.getByRole("status").filter({ hasText: generated.message })).toBeVisible()
    await expect(block.getByRole("textbox", { name: "六视图任务", exact: true })).not.toBeVisible()
    await expect(block.getByRole("alert").filter({ hasText: "未能写入剪贴板" })).not.toBeVisible()
    evidence.copyFailureClearedAfterResult = true
    const references = await page.evaluate((input) => window.studio.getReferences(input), { projectId: created.project.id, itemId })
    expect(references).toHaveLength(1)
    expect(references[0]).toMatchObject(generated.references[0]!)
    const reference = references[0]!
    const sha = createHash("sha256").update(Buffer.from(reference.url.split(",")[1]!, "base64")).digest("hex")
    expect(sha).toBe(createHash("sha256").update(image).digest("hex"))
    evidence.generated = { status: generated.status, message: generated.message, referenceId: reference.id, sha256: sha }
    evidence.mcpResultContainsImage = false
    await page.screenshot({ path: path.join(directory, "automatically-attached.png"), fullPage: true })
    await block.getByRole("button", { name: "分六张", exact: true }).click()
    // Cover two real reference polling intervals: unchanged saved images must preserve this user choice.
    await page.waitForTimeout(3200)
    await expect(block.getByRole("button", { name: "分六张", exact: true })).toHaveAttribute("aria-pressed", "true")
    evidence.layoutChoicePreservedAcrossPolling = true
    await block.getByRole("button", { name: "一整张", exact: true }).click()
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await openProject(page, created.project.name)
    await page.locator(`.inv-slot[data-item="${itemId}"]`).click()
    await expect(block.getByRole("button", { name: "放大看：一整张六视图，AI 画的", exact: true })).toBeVisible()
    expect(await page.evaluate((input) => window.studio.getReferences(input), { projectId: created.project.id, itemId })).toEqual(references)
    const reopened = await page.evaluate((projectId) => window.studio.getProjectOverview({ projectId }), created.project.id)
    expect(reopened.items.find((item) => item.id === itemId)).toMatchObject({ facts: { saved: false }, preview: { source: null } })
    evidence.modelStillUnstarted = true
    await page.screenshot({ path: path.join(directory, "reopened.png"), fullPage: true })
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await page.locator('.inv-slot[data-item="unsupported_model"]').click()
    const unsupportedDialog = page.getByRole("dialog", { name: "归途龙能力回报", exact: true })
    const unsupportedBlock = unsupportedDialog.getByRole("region", { name: "六视图", exact: true })
    const unsupported = await call<ExternalThreeViewResult>("finish_six_view", {
      projectId: created.project.id, itemId: "unsupported_model",
      result: { status: "unsupported", reason: "本地确定性测试协作者只有 MCP 数据工具，没有图像生成工具。" },
    })
    expect(unsupported).toMatchObject({ status: "unsupported", references: [] })
    expect(unsupported.message).toContain("不具备生图能力")
    expect(unsupported.message).toContain("独立准备")
    await expect(unsupportedBlock.getByRole("status").filter({ hasText: unsupported.message })).toBeVisible()
    await expect(unsupportedBlock.getByRole("status").filter({ hasText: unsupported.message })).toContainText("没有图像生成工具")
    await expect(unsupportedBlock.getByRole("button", { name: "加一张：一整张六视图", exact: true })).toBeVisible()
    evidence.unsupported = unsupported
    await page.screenshot({ path: path.join(directory, "unsupported.png"), fullPage: true })
    await unsupportedDialog.getByRole("button", { name: "关闭", exact: true }).click()
    await openProject(page, created.project.name)
    await page.locator('.inv-slot[data-item="unsupported_model"]').click()
    await expect(unsupportedBlock.getByRole("status").filter({ hasText: unsupported.message })).toBeVisible()
    await expect(unsupportedBlock.getByRole("status").filter({ hasText: unsupported.message })).toContainText("没有图像生成工具")
    evidence.unsupportedPersistedAfterReopen = true
    await page.screenshot({ path: path.join(directory, "unsupported-reopened.png"), fullPage: true })
    await unsupportedDialog.getByRole("button", { name: "关闭", exact: true }).click()
    await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "api", clearApiKey: true })
    })
    await openProject(page, created.project.name)
    await page.locator('.inv-slot[data-item="unsupported_model"]').click()
    await expect(unsupportedBlock.getByRole("button", { name: "让 AI 画六视图", exact: true })).toBeDisabled()
    await expect(unsupportedBlock.getByRole("button", { name: "复制六视图任务", exact: true })).toHaveCount(0)
    evidence.api = { originalDrawingEntry: true, disabledWithoutKey: true, drawingRequested: false }
    await page.screenshot({ path: path.join(directory, "api-mode.png"), fullPage: true })
    await unsupportedDialog.getByRole("button", { name: "关闭", exact: true }).click()
    await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
    })
    const personReferences = await page.evaluate((input) => window.studio.addThreeView(input), { projectId: created.project.id, itemId, view: "sheet" as const, name: "人工提供的验收图.png", url: reference.url })
    await openProject(page, created.project.name)
    await page.locator(`.inv-slot[data-item="${itemId}"]`).click()
    await expect(block.getByRole("button", { name: "复制六视图任务", exact: true })).toBeDisabled()
    await expect(block).toContainText("已有你提供的六视图")
    evidence.personReferencePreventsHandoff = true
    await page.evaluate((input) => window.studio.removeReference(input), { projectId: created.project.id, itemId, referenceId: personReferences[0]!.id })
    await expect(block.getByRole("button", { name: "复制六视图任务", exact: true })).toBeEnabled()
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await page.evaluate(async (projectId) => {
      const blueprint = await window.studio.getBlueprint({ projectId })
      if (blueprint?.state === "draft") await window.studio.confirmBlueprint({ projectId, revision: blueprint.revision })
    }, created.project.id)
    await call("next_batch", { projectId: created.project.id })
    await openProject(page, created.project.name)
    const makingCard = page.locator(`.inv-slot[data-item="${itemId}"]`).first()
    await expect(makingCard).toHaveAttribute("data-status", "making")
    await makingCard.click()
    await expect(dialog).toBeVisible()
    const story = dialog.getByRole("tab", { name: "制作过程", exact: true })
    if (await story.count()) await story.click()
    const lockedBlock = page.getByRole("region", { name: "六视图", exact: true })
    await expect(lockedBlock.getByRole("button", { name: "复制六视图任务", exact: true })).toBeDisabled()
    await expect(lockedBlock).toContainText("等这一次做完再换六视图")
    await page.screenshot({ path: path.join(directory, "making-lock.png"), fullPage: true })
    evidence.makingLockPreventsHandoff = true
    expect(errors).toEqual([])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible() && !window.isFocused()))).toBe(true)
  } finally {
    await writeFile(path.join(directory, "final-page.txt"), await page.locator("body").innerText()).catch(() => undefined)
    await page.screenshot({ path: path.join(directory, "final-page.png"), fullPage: true }).catch(() => undefined)
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ ...evidence, errors }, null, 2))
    await client.close().catch(() => undefined)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => undefined)
    await app.close()
  }
})

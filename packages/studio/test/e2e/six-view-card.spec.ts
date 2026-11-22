import { expect, test, _electron } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import path from "node:path"

test("an uploaded six-view model card closes and can be opened again", async () => {
  const studio = process.cwd()
  const artifacts = path.resolve(studio, "../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "six-view-card-"))
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studio, "node_modules/electron/dist/electron.exe"),
    args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studio]), `--user-data-dir=${path.join(directory, "electron")}`],
    env: { ...process.env, OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "", MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime") },
  })
  const client = new Client({ name: "six-view-card-test", version: "1.0.0" })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await page.waitForURL("**/index.html")
    const identity = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath, appPath: app.getAppPath() }))
    await writeFile(path.join(directory, "identity.json"), JSON.stringify(identity, null, 2))
    expect(identity.packaged).toBe(Boolean(process.env.STUDIO_PACKAGED_EXECUTABLE))
    const handoff = await page.evaluate(async () => {
      const { hasApiKey, source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      return window.studio.getMcpHandoff()
    })
    const configuration = [...handoff.matchAll(/```json\s*([\s\S]*?)```/g)]
      .map((match) => JSON.parse(match[1]!))
      .find((value) => value.mcpServers)
    const server = Object.values(configuration.mcpServers)[0] as { command: string; args: string[]; env: Record<string, string> }
    await client.connect(new StdioClientTransport({ command: server.command, args: server.args, env: Object.fromEntries(Object.entries({ ...process.env, ...server.env }).filter((entry): entry is [string, string] => typeof entry[1] === "string")) }))
    const created = await page.evaluate(() => window.studio.createProject({ name: "六视图卡片回归", modId: "six_view_card", description: "参考上传后关闭", empty: true }))
    const result = await client.callTool({ name: "propose_blueprint", arguments: {
      projectId: created.project.id,
      request: "制作一个模型，先上传六视图。",
      blueprint: { style: { palette: ["#B5765A"], shape: "方块造型", naming: "小写英文", world: "独立模型" }, entries: [{ key: "copper_model", kind: "model", title: "铜色模型", brief: "按人的六视图制作", owner: null, needs: [], out_of_scope: null }], questions: [] },
      paper_play: { findings: [], advice: [], independent: false },
    } })
    expect(result.isError).not.toBe(true)
    await page.reload()
    await page.getByRole("button", { name: "六视图卡片回归", exact: false }).first().click()
    await page.locator('[data-item="copper_model"]').first().click()
    const chooser = page.waitForEvent("filechooser")
    await page.getByRole("button", { name: "加一张：一整张六视图", exact: true }).click()
    await (await chooser).setFiles(path.join(studio, "test/e2e/fixtures/copper-pickaxe.png"))
    await expect(page.getByRole("button", { name: "放大看：一整张六视图，你给的", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "关闭", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "铜色模型", exact: true })).toHaveCount(0)
    await page.locator('[data-item="copper_model"]').first().click()
    await expect(page.getByRole("button", { name: "放大看：一整张六视图，你给的", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "关闭", exact: true }).click()
    await expect(page.getByRole("dialog", { name: "铜色模型", exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible() && !window.isFocused()))).toBe(true)
  } finally {
    await client.close()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy()))
    await app.close()
  }
})

const { launch, close } = require("./desktop-fixture.cjs")
const { expect } = require("@playwright/test")
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto")
async function main() {
  const [src, out, route = "mcp"] = process.argv.slice(2)
  await fs.mkdir(out, { recursive: true })
  const base = await fs.mkdtemp(path.join(path.dirname(src), "wizard-")),
    projects = path.join(base, "source/projects"),
    dir = path.join(projects, "sample")
  await fs.mkdir(projects, { recursive: true })
  await fs.cp(src, dir, { recursive: true })
  await fs.writeFile(path.join(projects, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
  const proj = JSON.parse(await fs.readFile(path.join(dir, "minemods.project.json"), "utf8"))
  const id = randomUUID(),
    now = new Date().toISOString(),
    asset = proj.workspace.assets.find((a) => a.module === "sound")
  await fs.mkdir(path.join(dir, ".minemods/runs"), { recursive: true })
  await fs.writeFile(
    path.join(dir, ".minemods/runs", id + ".json"),
    JSON.stringify({
      id,
      project_id: proj.id,
      prompt: "制作声音",
      state: "completed",
      summary: "声音做好了",
      questions: [],
      tasks: [
        {
          key: "tone",
          id: randomUUID(),
          asset_id: asset.id,
          state: "completed",
          module: "sound",
          title: asset.title,
          prompt: "制作声音",
          source: "工程要求",
          dependencies: [],
          target_id: null,
          detail: "",
          error: null,
          started_at: now,
          finished_at: now,
        },
      ],
      events: [],
      error: null,
      created_at: now,
      updated_at: now,
    }),
  )
  if (route === "old") {
    await fs.mkdir(path.join(base, "runtime"), { recursive: true })
    await fs.writeFile(
      path.join(base, "runtime/connection.json"),
      JSON.stringify({
        settings: {
          mode: "mcp",
          baseUrl: "",
          model: "fixture",
          routerModel: "fixture",
          moduleModel: "fixture",
          transcriptionModel: "fixture",
        },
      }),
    )
  }
  const fixture = await launch("wizard", "source", base, undefined, { fresh: true }),
    p = fixture.page,
    d = p.getByRole("dialog", { name: "连接 AI", exact: true })
  const btn = (n, root = d) => root.getByRole("button", { name: n, exact: true }).first(),
    shot = (n) => p.screenshot({ path: path.join(out, n + ".png") })
  const stage = async (n) => {
    await expect(d).toContainText("第 " + n + " 步 / 共 3 步")
    expect(await d.locator(".wizard-steps li").allTextContents()).toHaveLength(3)
  }
  const noAdvanced = async () => {
    expect(await d.innerText()).not.toMatch(/审查|config\.toml|MCP|gpt-|deepseek-flash/i)
  }
  const openProject = async () => {
    await p.locator(".mm-world.project-card").first().click()
    await p.locator(".pa-road").waitFor({ timeout: 90000 })
  }
  const profile = async () => {
    await p.getByRole("button", { name: "个人设置", exact: true }).first().click()
  }
  try {
    // Keep the desktop and the person's credentials isolated. All other requests use the real service.
    await fixture.app.evaluate(({ ipcMain }, route) => {
      const real = ipcMain._invokeHandlers.get("studio:invoke")
      ipcMain.removeHandler("studio:invoke")
      let writes = 0,
        checks = 0
      ipcMain.handle("studio:invoke", async (e, m) => {
        if (m.method === "detectAiClients")
          return { clients: [{ id: "codex", installed: true, state: writes > 1 ? "current" : "absent" }] }
        if (m.method === "connectAiClient")
          return ++writes > 1
            ? { ok: true, client: "codex", files: [] }
            : { ok: false, problem: "no-access", client: "codex", path: "", backup: null }
        if (m.method === "getMcpStatus" && writes > 1) {
          const s = await real(e, m)
          return { ...s, connected: true, state: "connected" }
        }
        if (m.method === "testConnection") {
          if (!checks++) throw new Error("测试服务拒绝了密钥")
          return { ok: true, model: m.input.model, status: "completed" }
        }
        return real(e, m)
      })
    }, route)
    if (route === "old") {
      await profile()
      await expect(p.locator(".connection-settings")).toContainText("开着")
      await shot("G8-旧设置")
      await p.getByRole("button", { name: /返回工程库/ }).first().click()
      await openProject()
      await expect(p.locator(".review-offer")).toHaveCount(0)
      await shot("G8-旧工程总览")
      return
    }
    await p.locator(".title-ai button").click()
    await stage(1)
    await noAdvanced()
    await expect(p.locator(".home-page")).toBeVisible()
    await shot("G1-首页弹窗")
    expect(await d.locator(".wizard-status").innerText()).toBe(
      await p.locator(".title-chip[data-presence]").innerText(),
    )
    await shot("G3-状态")
    await d.getByRole("button", { name: route === "api" ? /让 Studio 自己调用 AI/ : /用我自己的 AI 助手/ }).click()
    await btn("下一步").click()
    await stage(2)
    await noAdvanced()
    if (route === "api") {
      await d.getByRole("radio", { name: /DeepSeek/ }).click()
      await d.getByLabel("API Key", { exact: true }).fill("fixture-only")
      await shot("G2-密钥第二步")
      await btn("下一步").click()
      await stage(3)
      await noAdvanced()
      await btn("验证并连接").click()
      await expect(d.getByRole("alert")).toContainText("拒绝")
      await expect(btn("开始做")).toBeDisabled()
      await shot("G5-验证失败")
      await btn("验证并连接").click()
      await expect(btn("开始做")).toBeEnabled()
      await shot("G2-密钥第三步")
      return
    }
    await d.getByRole("button", { name: /接到 Codex|接上 Codex/ }).click()
    await expect(d.locator(".connection-error")).toBeVisible()
    await expect(btn("下一步")).toBeDisabled()
    await shot("G5-接入失败")
    await d.getByRole("button", { name: /接到 Codex|接上 Codex/ }).click()
    await expect(btn("下一步")).toBeEnabled()
    await shot("G2-助手第二步")
    await btn("下一步").click()
    await stage(3)
    await noAdvanced()
    await expect(btn("开始做")).toBeEnabled({ timeout: 10000 })
    await shot("G4-普通")
    await shot("G2-助手第三步")
    await btn("开始做").click()
    await profile()
    await expect(p.locator(".connection-settings")).toContainText("关着")
    await shot("G6-新设置")
    await p.getByRole("button", { name: "高级", exact: true }).click()
    await btn("重新连接", p).click()
    await btn("下一步").click()
    await d.getByRole("button", { name: /Codex/ }).first().click()
    await btn("下一步").click()
    await expect(d).toContainText("MCP 配置")
    await d.getByText("高级连接设置", { exact: true }).scrollIntoViewIfNeeded()
    await shot("G4-高级")
    await btn("关闭").click()
    await p
      .getByRole("button", { name: /返回工程库/ })
      .first()
      .click()
    await openProject()
    const offer = p.locator(".review-offer")
    await expect(offer).toContainText("第一样东西做好了", { timeout: 18000 })
    await shot("G7-首次建议")
    await btn("先不用", offer).click()
    await expect(offer).toHaveCount(0)
    await p.reload()
    await openProject()
    await expect(offer).toHaveCount(0)
    await shot("G7-已选择")
  } catch (e) {
    await shot("异常-" + route)
    console.error((await p.locator("body").innerText()).slice(-2200))
    throw e
  } finally {
    await close(fixture)
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

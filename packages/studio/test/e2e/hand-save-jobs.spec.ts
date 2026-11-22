import { test, expect } from "@playwright/test"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

const { launch, blank, close } = require("./desktop-fixture.cjs")

test("hand edits show the build/check refusal and remain saveable while the real game is open", async () => {
  test.setTimeout(600000)
  const fixture = await launch("hand-save-jobs-")
  const { page } = fixture
  try {
    await page.getByRole("button", { name: "开始做", exact: true }).first().click()
    await page.getByLabel("工程名称", { exact: true }).fill("Hand Save Jobs")
    await page.getByRole("button", { name: "创建工程", exact: true }).click()
    await blank(page, "方块", "验收石灯")
    await page.getByLabel("发光", { exact: true }).fill("12")
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expect(page.getByText("第 1 次保存 · 会做进模组", { exact: true })).toBeVisible()
    const saved = (await page.evaluate(() => window.studio.listProjects()))[0]
    await page.getByRole("tab", { name: "自己改", exact: true }).click()
    await page.getByLabel("硬度", { exact: true }).fill("2")
    await page.evaluate(() => window.studio.agreeSceneEula())
    await page.getByRole("button", { name: "构建并试玩", exact: true }).first().click()
    await page.getByRole("button", { name: "照保存过的构建", exact: true }).click()
    const jobsDirectory = path.join(saved.directory, ".minemods", "jobs")
    const running = async (kind: string) => {
      const jobs = await Promise.all((await readdir(jobsDirectory).catch(() => []))
        .filter(name => name.endsWith(".json"))
        .map(name => readFile(path.join(jobsDirectory, name), "utf8").then(JSON.parse)))
      return jobs.some(job => job.kind === kind && job.state === "running")
    }
    for (const kind of ["build", "scene_check"]) {
      await expect.poll(() => running(kind), { timeout: 300000, intervals: [100] }).toBe(true)
      await page.locator(".build-drawer-head button").click()
      await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled()
      await page.getByRole("button", { name: "保存", exact: true }).click()
      await expect(page.getByRole("alert").filter({ hasText: "这个工程正在打包或者检查。等它结束或者先取消，再保存修改。" })).toBeVisible()
      expect((await page.evaluate((id: string) => window.studio.openProject(id), saved.project.id)).project.revision).toBe(saved.project.revision)
      await page.getByRole("button", { name: "构建并试玩", exact: true }).first().click()
      const confirm = page.getByRole("button", { name: "照保存过的构建", exact: true })
      if (await confirm.count()) await confirm.click()
    }
    const logPath = path.join(process.env.MINEMODS_E2E_RUNTIME!, "scene", "instances", saved.project.id, "logs", "latest.log")
    await expect.poll(async () => (await readFile(logPath, "utf8").catch(() => "")).includes("Tester加入了游戏"), { timeout: 180000 }).toBe(true)
    expect(await running("scene_play")).toBe(true)
    await page.locator(".build-drawer-head button").click()
    await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled()
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expect(page.getByText("保存好了", { exact: true })).toBeVisible()
    const changed = await page.evaluate((id: string) => window.studio.openProject(id), saved.project.id)
    expect(changed.project.revision).toBe(saved.project.revision + 1)
    expect(changed.project.blocks[0].hardness).toBe(2)
    await page.getByRole("button", { name: "构建并试玩", exact: true }).first().click()
    await expect(page.getByText(/^这是工程改动之前那一次的结果/)).toBeVisible()
    await page.getByRole("button", { name: "取消", exact: true }).click()
  } finally {
    await close(fixture)
  }
})

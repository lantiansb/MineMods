import { test, expect, _electron } from "@playwright/test"
import { mkdtemp, mkdir } from "node:fs/promises"
import path from "node:path"

test("hand editing keeps numeric input, saves it, and restores it when edits are abandoned", async () => {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "numeric-edit-"))
  const app = await _electron.launch({
    args: [process.cwd(), `--user-data-dir=${path.join(directory, "electron")}`],
    env: { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", STUDIO_AI_URL: "" },
  })
  try {
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForURL("**/index.html")
    const projectId = await page.evaluate(async () => {
      const created = await window.studio.createProject({ name: "数值编辑", description: "数值输入与保存回归", empty: true })
      const saved = await window.studio.saveByHand({ projectId: created.project.id, expectedRevision: created.project.revision, assetId: null, changed: [], document: {
        kind: "item", name: "铜镐", identifier: "copper_pickaxe", color: "#b86230", max_stack: 1, texture: null,
        tool: { kind: "pickaxe", durability: 180, mining_level: "stone", mining_speed: 5, attack_damage: 2, attack_speed: 1.2, enchantability: 8, repair: "minecraft:copper_ingot" },
      } })
      if (!saved.ok) throw new Error(JSON.stringify(saved.issues))
      return saved.view.project.id
    })
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "数值编辑" }).click()
    await page.getByRole("button", { name: "高级", exact: true }).click()
    await page.getByRole("navigation", { name: "工程里的东西", exact: true }).getByRole("button", { name: /^铜镐，物品/ }).click()
    if (await page.getByRole("button", { name: "打开它", exact: true }).count()) await page.getByRole("button", { name: "打开它", exact: true }).click()
    await page.getByRole("tab", { name: "自己改", exact: true }).click()
    const durability = page.getByLabel("能用多少次", { exact: true })
    const speed = page.getByLabel("挖得多快", { exact: true })
    await durability.fill("240")
    await speed.fill("7")
    await expect(durability).toHaveValue("240")
    await expect(speed).toHaveValue("7")
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expect(page.getByText("保存好了", { exact: true })).toBeVisible()
    const saved = await page.evaluate(id => window.studio.openProject(id), projectId)
    expect(saved.project.items[0]!.tool?.durability).toBe(240)
    expect(saved.project.items[0]!.tool?.mining_speed).toBe(7)
    await durability.fill("320")
    await page.getByRole("button", { name: "放弃修改", exact: true }).click()
    await expect(durability).toHaveValue("240")
    await durability.fill("")
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expect(durability).toHaveAttribute("aria-invalid", "true")
    expect((await page.evaluate(id => window.studio.openProject(id), projectId)).project.revision).toBe(saved.project.revision)
    await page.getByRole("button", { name: "放弃修改", exact: true }).click()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every(window => !window.isVisible() && !window.isFocused()))).toBe(true)
  } finally {
    const page = app.windows()[0]
    if (page) await page.locator(".ae button").filter({ hasText: /^放弃修改$/ }).click({ timeout: 1000 }).catch(() => undefined)
    await app.close()
  }
})

import { test, expect, _electron, type Page } from "@playwright/test"
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

async function launch() {
  const artifacts = path.resolve("../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "desktop-current-"))
  const options = { args: [process.cwd(), `--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "", MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime") } }
  const app = await _electron.launch(options)
  const page = await app.firstWindow()
  await page.waitForURL("**/index.html")
  await page.emulateMedia({ reducedMotion: "reduce" })
  return { app, page, directory, options }
}
async function seed(page: Page, name: string) {
  const example = await page.evaluate(async name => {
    const created = await window.studio.createProject({ name, description: "Local editor and persistence specimen", empty: false })
    return window.studio.useExample({ projectId: created.project.id, expectedRevision: created.project.revision })
  }, name)
  const project = example.project
  const entity = project.entities[0]!
  const at = new Date().toISOString()
  // Seed the surviving runtime form with the same real example model. This setup is not AI acceptance evidence.
  project.workspace.assets.push({ id: entity.id, module: "model", title: "示例模型", revision: 1, created_at: at, updated_at: at, prompt: "Editor specimen", dependencies: [], document: { kind: "model", ...example.model! }, provenance: { model: null, request_id: null }, status: "ready" })
  project.workspace.assets.push({ id: crypto.randomUUID(), module: "entity", title: "林间小牛", revision: 1, created_at: at, updated_at: at, prompt: "Runtime form specimen", dependencies: [entity.id], document: { kind: "entity", name: "林间小牛", description: "Persistence specimen", model_asset_id: entity.id, health: 20, speed: 0.22, attack_damage: 2, behavior: "follow", runtime: { spawn: { biomes: ["minecraft:forest"], weight: 10, min: 1, max: 2 }, explosion: null, movement: "stalk", armor: 0, charging_armor: 0, texture_asset_id: null } }, provenance: { model: null, request_id: null }, status: "ready" })
  await writeFile(path.join(example.directory, "minemods.project.json"), JSON.stringify(project))
  await page.reload()
  await page.locator(".project-card").filter({ hasText: name }).click()
  await page.getByRole("button", { name: "高级", exact: true }).click()
  await page.getByRole("navigation", { name: "工程里的东西", exact: true }).getByRole("region", { name: "生物", exact: true }).locator(".inv-slot:not(.inv-empty)").first().click()
  if (await page.getByRole("button", { name: "打开它", exact: false }).isVisible()) await page.getByRole("button", { name: "打开它", exact: false }).click()
  if (!(await page.getByRole("region", { name: "做模型", exact: true }).isVisible())) await page.getByRole("navigation", {name:"生物制作流程",exact:true}).getByRole("button",{name:"外观",exact:true}).click()
  await expect(page.getByRole("region", { name: "做模型", exact: true })).toBeVisible()
  return example
}
async function close(app: Awaited<ReturnType<typeof _electron.launch>>) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
  await app.close()
}

test("sample project has synchronized part controls and fits a compact editor with reduced motion", async () => {
  const { app, page, directory } = await launch()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "开始做", exact: true }).click()
    await page.getByLabel("工程名称", { exact: true }).fill("焦点检查")
    await page.getByLabel("工程名称", { exact: true }).focus()
    await expect(page.getByLabel("工程名称", { exact: true })).toBeFocused()
    const workspace = path.join(directory, "projects"), backup = path.join(directory, "workspace-backup")
    await page.evaluate(() => window.studio.listProjects())
    await rename(workspace, backup)
    try {
      await writeFile(workspace, "This file prevents project directory creation", { flag: "wx" })
      await page.getByRole("button", { name: "创建工程", exact: true }).click()
      await expect(page.getByRole("alert")).toBeVisible()
      await expect(page.getByRole("alert")).not.toHaveText("")
      await expect(page.getByRole("button", { name: "创建工程", exact: true })).toBeEnabled()
    } finally { await unlink(workspace); await rename(backup, workspace) }
    await page.getByRole("button", { name: "取消", exact: true }).click()
    const example = await seed(page, "部件与布局")
    expect(example.project.assets[0]!.origin).toBe("example")
    expect(example.project.entities[0]!.model_asset_id).toBeTruthy()
    const bones = page.getByLabel("模型骨骼", { exact: true })
    for (const part of ["head", "body", "tail"]) {
      await bones.getByRole("button", { name: new RegExp("^"+part+"\\s") }).click()
      await expect(bones.locator("[aria-pressed=true]")).toContainText(part)
      await expect(page.getByRole("region", { name: "调整部件 " + part, exact: true })).toBeVisible()
      await expect(page.locator(".model-selection")).toContainText("已选中 " + part)
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1100, 760))
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([1100, 760])
    await expect(page.locator(".model-canvas canvas")).toBeVisible()
    await expect(page.getByLabel("自定义部件颜色", { exact: true })).toBeVisible()
    const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, panels: [".model-canvas", ".model-canvas canvas", ".model-conversation"].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { selector, left: r.left, right: r.right, top: r.top, bottom: r.bottom } }) }))
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.width)
    expect(layout.documentHeight).toBeLessThanOrEqual(layout.height)
    for (const panel of layout.panels) { expect(panel.left).toBeGreaterThanOrEqual(0); expect(panel.right).toBeLessThanOrEqual(layout.width); expect(panel.top).toBeGreaterThanOrEqual(0); expect(panel.bottom).toBeLessThanOrEqual(layout.height) }
    await page.screenshot({ path: path.join(directory, "compact.png") })
    expect(errors).toEqual([])
  } finally { await writeFile(path.join(directory, "renderer-errors.json"), JSON.stringify(errors)); await close(app) }
})

test("standalone app saves a creature and restores its model and gameplay after restart", async () => {
  const { app, page, directory, options } = await launch()
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const example = await seed(page, "林间蘑菇牛")
  let savedHead = ""
  try {
    await page.getByLabel("模型骨骼", { exact: true }).getByRole("button", { name: /^head\s/ }).click()
    await page.getByLabel("自定义部件颜色", { exact: true }).fill("#a65a36")
    await expect(page.getByLabel("有未保存修改", { exact: true })).toBeVisible()
    await page.getByRole("navigation", { name: "生物制作流程", exact: true }).getByRole("button", { name: "行为", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "留在这里", exact: true }).click()
    await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "保存修改", exact: true }).focus()
    await page.keyboard.press("Control+s")
    await expect(page.getByText("模型已保存", { exact: true })).toBeVisible()
    const modelAfterSave = await page.evaluate(id => window.studio.openProject(id), example.project.id)
    await writeFile(path.join(directory, "model-after-color-save.json"), JSON.stringify(modelAfterSave))
    savedHead = JSON.stringify(modelAfterSave.model!.bones.find(bone => bone.name === "head"))
    expect(savedHead).not.toBe(JSON.stringify(example.model!.bones.find(bone => bone.name === "head")))
    expect(modelAfterSave.model!.bones.find(bone => bone.name === "body")).toEqual(example.model!.bones.find(bone => bone.name === "body"))
    await page.getByRole("button", { name: "放大", exact: true }).click()
    await page.getByRole("button", { name: "放弃", exact: true }).click()
    await expect(page.getByLabel("有未保存修改", { exact: true })).toBeHidden()
    await page.getByRole("navigation", { name: "生物制作流程", exact: true }).getByRole("button", { name: "行为", exact: true }).click()
    await page.getByRole("tab", { name: "自己改", exact: true }).click()
    await page.getByLabel("名字", { exact: true }).fill("林间小牛")
    await page.getByLabel("生命", { exact: true }).fill("32")
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expect(page.getByText("保存好了", { exact: true })).toBeVisible()
    const saved = await page.evaluate(id => window.studio.openProject(id), example.project.id)
    await writeFile(path.join(directory, "after-gameplay-save.json"), JSON.stringify(saved))
    expect(saved.project.entities[0]!.health).toBe(32)
    expect(saved.project.entities[0]!.behavior).toBe("follow")
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe("undefined")
    expect(errors).toEqual([])
  } finally { await writeFile(path.join(directory, "renderer-errors.json"), JSON.stringify(errors)); await close(app) }
  const reopened = await _electron.launch(options)
  try {
    const restored = await reopened.firstWindow()
    await restored.waitForURL("**/index.html")
    await restored.locator(".project-card").filter({ hasText: "林间蘑菇牛" }).click()
    await restored.getByRole("region", { name: "生物", exact: true }).locator(".inv-slot:not(.inv-empty)").first().click()
    await restored.getByRole("button", { name: "打开它", exact: false }).click()
    await restored.getByRole("navigation", { name: "生物制作流程", exact: true }).getByRole("button", { name: "行为", exact: true }).click()
    await restored.getByRole("tab", { name: "自己改", exact: true }).click()
    await expect(restored.getByLabel("生命", { exact: true })).toHaveValue("32")
    await expect(restored.getByLabel("名字", { exact: true })).toHaveValue("林间小牛")
    const saved = await restored.evaluate(id => window.studio.openProject(id), example.project.id)
    expect(saved.project.entities[0]!.behavior).toBe("follow")
    expect(JSON.stringify(saved.model!.bones.find(bone => bone.name === "head"))).toBe(savedHead)
  } finally { await close(reopened) }
})

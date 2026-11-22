const fs = require("node:fs/promises")
const path = require("node:path")
const { expect } = require("@playwright/test")
const { launch, close } = require("./desktop-fixture.cjs")

async function main() {
  const [out, phase] = process.argv.slice(2)
  const fixture = await launch("blind3-project-state-")
  const { page } = fixture
  const title = page.locator(".title-status")
  const prompt = page.getByLabel("跟 AI 说这个模型", { exact: true })
  const tab = (name) => page.getByRole("navigation", { name: "生物制作流程" }).getByRole("button", { name, exact: true }).click()
  const open = async (name) => {
    await page.locator(".project-card").filter({ hasText: name }).click()
    await page.locator(".pa-road").waitFor()
  }
  const creature = async () => {
    await page.locator(".inv-slot[data-kind=entity]").first().click()
    const card = page.locator(".pa-card[role=dialog]")
    await card.getByRole("button", { name: "打开它", exact: true }).click()
    await card.waitFor({ state: "hidden" })
  }
  try {
    const seed = await page.evaluate(async () => {
      const a = await window.studio.createProject({ name: "杉林 A", description: "", empty: true })
      const draft = await window.studio.addEntity({ projectId: a.project.id, expectedRevision: a.project.revision, name: "杉林飞蛾" })
      const b = await window.studio.createProject({ name: "石谷 B", description: "", empty: false })
      const model = await window.studio.useExample({ projectId: b.project.id, expectedRevision: b.project.revision })
      return { draft, model }
    })
    const project = seed.model.project
    const entity = project.entities[0]
    const at = new Date().toISOString()
    if (!project.workspace.assets.some(asset => asset.id === entity.id)) project.workspace.assets.push({
      id: entity.id, module: "model", title: "示例模型", revision: 1, created_at: at, updated_at: at, prompt: "Fixture",
      dependencies: [], document: { kind: "model", ...seed.model.model }, provenance: { model: null, request_id: null }, status: "ready",
    })
    project.workspace.assets.push({
      id: crypto.randomUUID(), module: "entity", title: "山谷石羊", revision: 1, created_at: at, updated_at: at, prompt: "Fixture",
      dependencies: [entity.id], document: { kind: "entity", name: "山谷石羊", description: "", model_asset_id: entity.id,
        health: 20, speed: 0.22, attack_damage: 2, behavior: "follow", runtime: { spawn: null, explosion: null, movement: "stalk", armor: 0, charging_armor: 0, texture_asset_id: null } },
      provenance: { model: null, request_id: null }, status: "ready",
    })
    await fs.writeFile(path.join(seed.model.directory, "minemods.project.json"), JSON.stringify(project))
    await page.reload()
    await open("杉林 A")
    await creature()
    await prompt.waitFor()
    if (phase === "before") {
      await expect(title).toHaveText("有未保存修改")
      await page.screenshot({ path: path.join(out, "1-before-false-dirty.png") })
    } else {
      await expect(title).toHaveText("所有修改已保存")
      const savedPrompt = await prompt.inputValue()
      await prompt.fill("临时修改")
      await expect(title).toHaveText("有未保存修改")
      await prompt.fill(savedPrompt)
      await expect(title).toHaveText("所有修改已保存")
    }
    await page.getByLabel("搜索工程里的东西").fill("杉林飞蛾")
    await page.locator(".title-project").click()
    if (phase === "before") await page.getByRole("button", { name: "放弃修改", exact: true }).click()
    await open("石谷 B")
    await creature()
    await tab("外观")
    await prompt.waitFor()
    if (phase === "before") {
      await expect(prompt).toHaveValue(/杉林飞蛾/)
      await expect(title).toHaveText("有未保存修改")
    } else {
      await expect(prompt).toHaveValue("")
      await expect(page.getByLabel("搜索工程里的东西")).toHaveValue("")
      await tab("动作")
      await expect(title).toHaveText("所有修改已保存")
      await tab("外观")
      await expect(title).toHaveText("所有修改已保存")
    }
    await page.screenshot({ path: path.join(out, "1-" + phase + "-project-switch.png") })
    const revisions = await page.evaluate(async () => (await window.studio.listProjects()).map(row => [row.project.id, row.project.revision]))
    expect(new Map(revisions).get(seed.draft.project.id)).toBe(seed.draft.project.revision)
    expect(new Map(revisions).get(project.id)).toBe(project.revision)
    console.log("PASS", phase, "project prompt, dirty marker and unchanged revisions")
  } finally {
    await close(fixture)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

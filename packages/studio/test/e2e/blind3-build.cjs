const fs = require("node:fs/promises")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const { expect } = require("@playwright/test")
const { launch, close } = require("./desktop-fixture.cjs")

async function withMcp(page, check) {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const configuration = await page.evaluate(async () => {
    const { hasApiKey, source, ...settings } = await window.studio.getConnection()
    await window.studio.saveConnection({ ...settings, mode: "mcp" })
    return (await window.studio.getMcpStatus()).configuration
  })
  const client = new Client({ name: "blind3-merge-check", version: "1" })
  const transport = new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" })
  try {
    await client.connect(transport)
    await check(async (name, args) => {
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, JSON.stringify(result.content)).not.toBe(true)
      return JSON.parse(result.content.find(item => item.type === "text").text)
    })
  } finally {
    await client.close()
  }
}

async function main() {
  const [out, phase, base] = process.argv.slice(2)
  const directory = await fs.mkdtemp(path.join(base, "desktop-"))
  const projectRoot = path.join(directory, "source/projects")
  await fs.mkdir(projectRoot, { recursive: true })
  await fs.writeFile(path.join(projectRoot, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
  const fixture = await launch("blind3-build-", "source", directory)
  const { app, page } = fixture
  try {
    const seed = await page.evaluate(async () => {
      const created = await window.studio.createProject({ name: "苔石工坊", modId: "moss_workshop", description: "", empty: true })
      const block = { id: crypto.randomUUID(), identifier: "moss_lamp", name: "苔石灯", hardness: 2, luminance: 12, tool: "pickaxe", drop: "self", color: "#879b55" }
      const content = await window.studio.saveContent({ projectId: created.project.id, expectedRevision: created.project.revision, content: { blocks: [block], items: [], recipes: [], logic: [] } })
      return window.studio.addEntity({ projectId: content.project.id, expectedRevision: content.project.revision, name: "苔叶蛾" })
    })
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "苔石工坊" }).click()
    await page.locator(".pa-road").waitFor()
    await page.locator(".inv-slot[data-kind=entity]").first().click()
    const card = page.locator(".pa-card[role=dialog]")
    await card.getByRole("button", { name: "管理这样东西" }).click()
    const menu = page.locator(".more-menu-popover")
    const rename = menu.getByRole("menuitem", { name: "改名", exact: true })
    if (phase === "before") await expect(rename).toBeDisabled()
    else {
      await expect(rename).toBeEnabled()
      await expect(menu.getByRole("menuitem", { name: "删除", exact: true })).toBeEnabled()
    }
    await page.screenshot({ path: path.join(out, "2-" + phase + "-menu.png") })
    await page.keyboard.press("Escape")
    if (await card.isVisible()) await page.keyboard.press("Escape")
    await card.waitFor({ state: "hidden" })
    if (phase !== "manage") {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("studio:command", "export"))
      await page.getByRole("button", { name: "打包，不打开游戏", exact: true }).click()
      const jobs = path.join(seed.directory, ".minemods/jobs")
      await expect.poll(async () => (await fs.readdir(jobs).catch(() => [])).length).toBeGreaterThan(0)
      const jobId = (await fs.readdir(jobs))[0].replace(".json", "")
      const read = () => page.evaluate(input => window.studio.getJob(input), { projectId: seed.project.id, jobId })
      await expect.poll(async () => (await read()).state, { timeout: 360000, intervals: [1000] }).toMatch(/completed|failed|canceled/)
      const job = await read()
      await fs.writeFile(path.join(out, "2-" + phase + "-build.json"), JSON.stringify(job, null, 2))
      if (phase === "before") {
        expect(job.state).toBe("failed")
        expect(job.error).toContain("苔叶蛾")
      } else {
        expect(job.state, job.error).toBe("completed")
        expect(job.output.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "skipped_creature", about: "苔叶蛾" })]))
        const jars = execFileSync(path.join(process.env.MINEMODS_JDK21, "bin/jar.exe"), ["tf", job.output.jarPath], { encoding: "utf8", windowsHide: true })
        expect(jars).toContain("assets/moss_workshop/blockstates/moss_lamp.json")
        expect(jars).not.toContain(seed.project.entities[0].id.replaceAll("-", ""))
        expect(jars).not.toMatch(/\/geo\/|\/textures\/entity\//)
        await fs.writeFile(path.join(out, "2-after-jar-entries.txt"), jars)
        await withMcp(page, async (call) => {
          const receipt = await call("get_build", { projectId: seed.project.id, jobId })
          const warning = receipt.output.warnings.find(item => item.rule === "skipped_creature")
          expect(warning).toMatchObject({ about: "苔叶蛾", about_id: seed.project.entities[0].id, severity: "defect" })
          await fs.writeFile(path.join(out, "2-after-mcp-warning.json"), JSON.stringify(warning, null, 2))
        })
      }
      await page.screenshot({ path: path.join(out, "2-" + phase + "-build.png") })
      console.log("PASS", phase, job.state, job.output?.jarPath ?? job.error)
    }
    // Use a fresh fixture for the management exercise so it does not race the drawer's terminal build refresh.
    if (phase === "manage") {
      const openMenu = async () => {
        await page.locator(".inv-slot[data-kind=entity]").first().evaluate((slot) => slot.click())
        await card.getByRole("button", { name: "管理这样东西" }).click()
      }
      await openMenu()
      await menu.getByRole("menuitem", { name: "改名", exact: true }).click()
      await page.getByLabel("新名字").fill("长角苔蛾")
      await page.getByRole("button", { name: "保存名字" }).click()
      await expect.poll(async () => page.evaluate(async id => (await window.studio.openProject(id)).project.entities[0]?.name, seed.project.id)).toBe("长角苔蛾")
      await page.reload()
      await page.locator(".project-card").filter({ hasText: "苔石工坊" }).click()
      await page.locator(".pa-road").waitFor()
      await expect(page.locator(".inv-slot[data-kind=entity]").first()).toHaveAccessibleName(/长角苔蛾/)
      await openMenu()
      await menu.getByRole("menuitem", { name: "删除", exact: true }).click()
      await page.getByRole("button", { name: "确认删除", exact: true }).click()
      await expect.poll(async () => page.evaluate(async id => (await window.studio.openProject(id)).project.entities.length, seed.project.id)).toBe(0)
      await page.getByRole("button", { name: "撤销", exact: true }).click()
      await expect.poll(async () => page.evaluate(async id => (await window.studio.openProject(id)).project.entities[0]?.name, seed.project.id)).toBe("长角苔蛾")
      await page.screenshot({ path: path.join(out, "2-manage-restored.png") })
      console.log("PASS manual creature rename, delete and undo")
      await withMcp(page, async (call) => {
        const projectId = seed.project.id
        const assetId = seed.project.entities[0].id
        const project = await page.evaluate(async id => (await window.studio.openProject(id)).project, projectId)
        const action = (tool, input) => call("run_tool", { projectId, tool, input })
        const renamed = await action("rename_asset", { assetId, expectedRevision: project.revision, title: "长角苔叶蛾" })
        expect(renamed).toMatchObject({ ok: true, assetId, title: "长角苔叶蛾" })
        const deleted = await action("delete_asset", { assetId, expectedRevision: renamed.revision })
        expect(deleted).toMatchObject({ ok: true, assetId, deletion: expect.any(String) })
        await expect.poll(async () => page.evaluate(async id => (await window.studio.openProject(id)).project.entities.length, projectId)).toBe(0)
        const restored = await action("restore_deleted_asset", { deletion: deleted.deletion, expectedRevision: deleted.revision })
        expect(restored).toMatchObject({ ok: true, assetId })
        await expect.poll(async () => page.evaluate(async id => (await window.studio.openProject(id)).project.entities[0]?.name, projectId)).toBe("长角苔叶蛾")
      })
      console.log("PASS MCP manual creature rename, delete and restore")
    }
  } finally {
    await close(fixture)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

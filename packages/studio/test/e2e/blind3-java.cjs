const fs = require("node:fs/promises")
const path = require("node:path")
const { expect } = require("@playwright/test")
const { launch, close } = require("./desktop-fixture.cjs")

async function main() {
  const [out, phase, base] = process.argv.slice(2)
  const directory = await fs.mkdtemp(path.join(base, "java-"))
  const projectRoot = path.join(directory, "source/projects")
  const runtime = path.join(directory, "runtime")
  const target = path.join(directory, "incomplete_JDK")
  await fs.mkdir(projectRoot, { recursive: true })
  await fs.mkdir(runtime)
  await fs.mkdir(target)
  await fs.symlink(target, path.join(runtime, "java-17"), "junction")
  await fs.writeFile(path.join(projectRoot, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
  const fixture = await launch("blind3-java-", "source", directory)
  const { app, page } = fixture
  try {
    const seed = await page.evaluate(async () => {
      const created = await window.studio.createProject({ name: "杉石工坊", modId: "fir_workshop", description: "", empty: true, targetId: "forge-1.20.1" })
      const block = { id: crypto.randomUUID(), identifier: "fir_lamp", name: "杉石灯", hardness: 2, luminance: 12, tool: "pickaxe", drop: "self", color: "#879b55" }
      return window.studio.saveContent({ projectId: created.project.id, expectedRevision: created.project.revision, content: { blocks: [block], items: [], recipes: [], logic: [] } })
    })
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "杉石工坊" }).click()
    await page.locator(".pa-road").waitFor()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("studio:command", "export"))
    await page.getByRole("button", { name: "打包，不打开游戏", exact: true }).click()
    const jobs = path.join(seed.directory, ".minemods/jobs")
    await expect.poll(async () => (await fs.readdir(jobs).catch(() => [])).length).toBeGreaterThan(0)
    const jobId = (await fs.readdir(jobs))[0].replace(".json", "")
    const read = () => page.evaluate(input => window.studio.getJob(input), { projectId: seed.project.id, jobId })
    await expect.poll(async () => (await read()).state, { timeout: 180000, intervals: [1000] }).toBe("failed")
    const job = await read()
    await fs.writeFile(path.join(out, "3-" + phase + "-java-failure.json"), JSON.stringify(job, null, 2))
    if (phase === "before") expect(job.error).toContain("JAVA_HOME")
    else {
      expect(job.error).toContain("目录联接")
      expect(job.error).toContain("incomplete_JDK")
      expect(job.error).not.toContain("JAVA_HOME")
      await expect(page.locator(".java-card")).toContainText(job.error)
      await expect(page.locator(".java-card .java-fits")).toHaveCount(0)
    }
    await page.screenshot({ path: path.join(out, "3-" + phase + "-java-drawer.png") })
    await page.getByRole("button", { name: /关闭「构建并试玩」/ }).click()
    await expect(page.locator(".error-bar")).toContainText(job.error)
    await page.getByRole("button", { name: "看详情", exact: true }).click()
    if (phase === "after") await expect(page.locator(".main-area")).toContainText("incomplete_JDK")
    await page.screenshot({ path: path.join(out, "3-" + phase + "-java-details.png") })
    console.log("PASS", phase, job.error)
  } finally {
    await close(fixture)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

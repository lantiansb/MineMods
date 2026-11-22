import { test, expect, _electron } from "@playwright/test"
import { mkdir, mkdtemp } from "node:fs/promises"
import path from "node:path"

test("a clean game check still offers rule findings to the external AI, and stale checks hide the handoff", async () => {
  test.setTimeout(300000)
  await mkdir(path.resolve("../../.artifacts/studio"), { recursive: true })
  const directory = await mkdtemp(path.resolve("../../.artifacts/studio/rule-handoff-"))
  const app = await _electron.launch({
    args: [process.cwd(), `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env,
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
      MINEMODS_STUDIO_RUNTIME: process.env.MINEMODS_E2E_RUNTIME || path.join(directory, "runtime"),
      OPENAI_API_KEY: "",
      STUDIO_AI_URL: "",
    },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    const view = await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      const created = await window.studio.createProject({ name: "规则问题交接", description: "", empty: true })
      const saved = await window.studio.saveByHand({
        projectId: created.project.id,
        expectedRevision: created.project.revision,
        assetId: null,
        changed: [],
        document: {
          kind: "block",
          identifier: "ore",
          name: "无掉落矿石",
          hardness: 3,
          luminance: 0,
          tool: "pickaxe",
          drop: "none",
          color: "#8a8a8a",
          texture: null,
          generation: {
            dimension: "overworld",
            min_y: 0,
            max_y: 64,
            spread: "even",
            vein_size: 5,
            veins_per_chunk: 6,
            replaces: ["stone"],
            biomes: null,
          },
        },
      })
      if (!saved.ok) throw new Error(JSON.stringify(saved.issues))
      await window.studio.agreeSceneEula()
      return saved.view
    })
    const build = await page.evaluate((projectId) => window.studio.buildProject({ projectId }), view.project.id)
    await expect
      .poll(
        async () =>
          (
            await page.evaluate((input) => window.studio.getJob(input), {
              projectId: view.project.id,
              jobId: build.jobId,
            })
          ).state,
        { timeout: 180000, intervals: [1000] },
      )
      .toBe("completed")
    const check = await page.evaluate((input) => window.studio.startSceneCheck(input), {
      projectId: view.project.id,
      jobId: build.jobId,
    })
    await expect
      .poll(
        async () =>
          (
            await page.evaluate((input) => window.studio.getJob(input), {
              projectId: view.project.id,
              jobId: check.jobId,
            })
          ).state,
        { timeout: 90000, intervals: [1000] },
      )
      .toBe("completed")
    expect(
      (await page.evaluate((input) => window.studio.getScene(input), { projectId: view.project.id })).record!.report!
        .findings,
    ).toEqual([])
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "规则问题交接" }).click()
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send("studio:command", "export"),
    )
    const handoff = page.getByRole("button", { name: "把这些问题交给 AI 改", exact: true })
    await expect(page.getByText(/工程规则检查另有/)).toBeVisible()
    await expect(handoff).toBeEnabled()
    await handoff.click()
    await expect(page.getByText("已经记到要改的东西上：「无掉落矿石」。", { exact: true })).toBeVisible()
    const saved = await page.evaluate(async (id) => {
      const current = await window.studio.openProject(id)
      const asset = current.project.workspace.assets[0]!
      return window.studio.saveByHand({
        projectId: id,
        expectedRevision: current.project.revision,
        assetId: asset.id,
        changed: ["hardness"],
        document: { ...asset.document, hardness: 4 },
      })
    }, view.project.id)
    expect(saved.ok).toBe(true)
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "规则问题交接" }).click()
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send("studio:command", "export"),
    )
    await expect(page.locator(".test-scene-stale")).toBeVisible()
    await expect(handoff).toHaveCount(0)
  } finally {
    await app.close()
  }
})

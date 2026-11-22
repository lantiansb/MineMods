import { test, expect, _electron } from "@playwright/test"
import { createServer } from "node:http"
import { mkdir, mkdtemp } from "node:fs/promises"
import path from "node:path"
import { fixtureReply } from "./structured-fixture"

test("desktop project command routes parallel modules into persistent project assets", async () => {
  const studio = process.cwd()
  const artifacts = path.resolve(studio, "../../.artifacts/studio")
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(path.join(artifacts, "project-assets-"))
  const tasks = [
    {
      key: "moon_stone",
      module: "block",
      title: "月光石",
      prompt: "做月光石",
      source: "月光石",
      dependencies: [],
      target_id: null,
    },
    {
      key: "moon_lore",
      module: "worldview",
      title: "月光森林设定",
      prompt: "设定月光森林",
      source: "月光森林",
      dependencies: [],
      target_id: null,
    },
    {
      key: "moon_recipe",
      module: "recipe",
      title: "月光石配方",
      prompt: "合成月光石",
      source: "配方",
      dependencies: ["moon_stone"],
      target_id: null,
    },
  ]
  const state = { concurrent: 0, maximum: 0, requests: 0 }
  const server = createServer((request, response) => {
    const buffers: Buffer[] = []
    request.on("data", (chunk) => buffers.push(Buffer.from(chunk)))
    request.on("end", () => {
      state.requests += 1
      const body = JSON.parse(Buffer.concat(buffers).toString())
      // Before any work Studio asks the model whether it sees pictures (a red square, `probeVision`): not JSON, and answered as a model with eyes would.
      if (!String(body.input[0].content[0].text).trimStart().startsWith("{")) {
        state.requests -= 1
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ model: body.model, status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify({ colour: "red" }) }] }] }))
        return
      }
      const input = JSON.parse(body.input[0].content[0].text)
      const output = fixtureReply(body, input, () => !input.task
        ? { summary: "生成方块与世界观，并为方块制作配方。", questions: [], tasks }
        : input.task.module === "block"
          ? {
              kind: "block",
              identifier: "moon_stone",
              name: "月光石",
              hardness: 2,
              luminance: 8,
              tool: "pickaxe",
              drop: "self",
              color: "#89aeb5",
              texture: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAvUlEQVR4nJVTqxFCQRDbYugERQMYJAKBYwaFQz6BoABqoovXwzPHRGQnB9m5h9iJuNsk+4v94dhO50sjIq63eyJiejwTEfhLDE0GajJQk4GaDAxNnualbV/vttn94SCV5qUjQKiivqloUEkJGFR05CRJB3ywDgx5OtAalYA1Ihw5nceoy1RSAp1SjLo82pOoFN1I3V6EU3Rdr/bCOnBdLx24GquRuoUqb0EJOtvi7OcW1lyjEne3sPb6vh1/ABwPaVuyZ52PAAAAAElFTkSuQmCC",
            }
          : input.task.module === "worldview"
            ? {
                kind: "worldview",
                title: "月光森林",
                summary: "石头储存夜间的月光。",
                entries: [{ title: "月光石", body: "森林中的石头在夜晚发出微光。" }],
              }
            : {
                kind: "recipe",
                name: "月光石配方",
                pattern: ["minecraft:stone", "minecraft:amethyst_shard", null, null, null, null, null, null, null],
                result: "moon_fixture:moon_stone",
                count: 1,
              })
      state.concurrent += 1
      state.maximum = Math.max(state.maximum, state.concurrent)
      setTimeout(
        () => {
          state.concurrent -= 1
          response.setHeader("content-type", "application/json")
          response.end(
            JSON.stringify({
              model: body.model,
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: JSON.stringify(output) }],
                },
              ],
            }),
          )
        },
        input.task ? 350 : 10,
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture port missing")
  const app = await _electron.launch({
    executablePath: path.join(studio, "node_modules/electron/dist/electron.exe"),
    args: [studio, `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env,
      OPENAI_API_KEY: "fixture-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
      MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
    },
  })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    const id = await page.evaluate(
      async () =>
        (
          await window.studio.createProject({
            name: "月光森林工程",
            modId: "moon_fixture",
            description: "fixture",
            empty: true,
          })
        ).project.id,
    )
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "月光森林工程" }).click()
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).first().click()
    await page.getByLabel("说一句想做什么", { exact: true }).fill("创建月光森林、月光石和配方。")
    await page.getByRole("button", { name: "跟 AI 说", exact: true }).click()
    await expect
      .poll(async () => (await page.evaluate((id) => window.studio.listProjectRuns({ projectId: id }), id))[0]?.state)
      .toBe("completed")
    expect(state.maximum).toBeGreaterThanOrEqual(2)
    const project = await page.evaluate((id) => window.studio.openProject(id), id)
    expect(project.project.workspace.assets).toHaveLength(3)
    expect(project.project.blocks).toHaveLength(1)
    expect(project.project.recipes[0].result).toBe("moon_fixture:moon_stone")
    expect(project.project.workspace.assets.find((asset) => asset.module === "worldview")?.status).toBe("design")
    const navigation = page.getByRole("navigation", { name: "工程里的东西", exact: true })
    await expect(navigation.getByRole("region", { name: "方块", exact: true }).locator(".inv-slot:not(.inv-empty)")).toHaveCount(1)
    await expect(navigation.getByRole("region", { name: "配方", exact: true }).locator(".inv-slot:not(.inv-empty)")).toHaveCount(1)
    await expect(page.locator(".project-run-task")).toHaveCount(3)
    await expect(page.locator(".project-run-state").first()).toHaveText("已完成")
    await page.locator(".project-run-summary").click()
    await expect(page.locator(".project-run-summary")).toHaveAttribute("aria-expanded", "false")
    await expect(page.locator(".project-run-detail")).toHaveCount(0)
    // Keep observing through a polling interval: project refresh must not clear history or reopen it.
    await expect
      .poll(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1200))
        return page.locator(".project-run-summary").getAttribute("aria-expanded")
      })
      .toBe("false")
    await page.locator(".project-run-summary").click()
    await expect(page.locator(".project-run-task")).toHaveCount(3)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1440, 900))
    await page.screenshot({ path: path.join(directory, "project-command-1440.png"), fullPage: true })
    await page
      .getByRole("navigation", { name: "工程里的东西", exact: true })
      .getByRole("region", { name: "配方", exact: true })
      .getByRole("button", { name: /^月光石配方，配方/ })
      .click()
    await page.getByRole("button", { name: "打开它", exact: true }).click()
    await expect(page.getByLabel("配方九宫格", { exact: true })).toBeVisible()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith("/index.html"))!.setContentSize(1024, 768))
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024)
    expect(
      await page
        .getByLabel("配方九宫格", { exact: true })
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await expect(page.locator(".recipe-output-cell")).toBeInViewport()
    await page.screenshot({ path: path.join(directory, "recipe-assets-1024.png"), fullPage: true })
    await page.reload()
    await page.locator(".project-card").filter({ hasText: "月光森林工程" }).click()
    const reopened = await page.evaluate((id) => window.studio.openProject(id), id)
    expect(reopened.project.workspace.assets.map((asset) => asset.id).sort()).toEqual(
      project.project.workspace.assets.map((asset) => asset.id).sort(),
    )
    expect((await page.evaluate((id) => window.studio.listProjectRuns({ projectId: id }), id))[0].state).toBe(
      "completed",
    )
    expect(errors).toEqual([])
  } catch (cause) {
    await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => undefined)
    throw cause
  } finally {
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

import { expect, test, _electron } from "@playwright/test"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// The first thing anyone sees. A window that throws while it is first drawn stays blank, and neither the type check
// nor the production build notices: this opens the built app on an empty folder, hidden, and looks.
test("第一次打开：窗口画得出来，没有一句报错，知道下一步点哪里", async () => {
  const studioDirectory = process.cwd()
  const directory = await mkdtemp(path.join(os.tmpdir(), "minemods-startup-"))
  const app = await _electron.launch({
    executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE || path.join(studioDirectory, "node_modules/electron/dist/electron.exe"),
    args: [...(process.env.STUDIO_PACKAGED_EXECUTABLE ? [] : [studioDirectory]), `--user-data-dir=${path.join(directory, "electron")}`],
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      OPENAI_BASE_URL: "",
      STUDIO_AI_URL: "",
      STUDIO_SERVICE_TOKEN: "",
      MINEMODS_STUDIO_TEST: "1",
      MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"),
      MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"),
    },
  })
  try {
    const page = await app.firstWindow()
    const thrown: string[] = []
    page.on("pageerror", (error) => thrown.push(error.stack ?? error.message))
    page.on("console", (message) => {
      if (message.type() === "error") thrown.push(message.text())
    })
    // Whatever was thrown before the listeners were there is thrown again by drawing the window once more.
    await page.waitForURL(/index\.html$/)
    await page.waitForLoadState("domcontentloaded")
    await page.reload()
    await expect(page.getByRole("heading", { name: "MineMods" })).toBeVisible()
    // One press from the first screen to the one field a new mod needs.
    await page.getByRole("button", { name: "开始做" }).first().click()
    await expect(page.getByPlaceholder("例如：赤铜飞行社")).toBeVisible()
    const drawn = await page.evaluate(() => ({
      words: document.body.innerText.trim().length,
      buttons: [...document.querySelectorAll("button")].filter((button) => button.getBoundingClientRect().width > 0).length,
    }))
    expect(drawn.words).toBeGreaterThan(0)
    expect(drawn.buttons).toBeGreaterThan(0)
    expect(thrown).toEqual([])
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => !window.isVisible() && !window.isFocused()))).toBe(true)
  } finally {
    await app.close()
  }
})

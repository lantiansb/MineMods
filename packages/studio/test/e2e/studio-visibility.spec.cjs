const { test, expect } = require("@playwright/test")
const { execFileSync } = require("node:child_process")
const { mkdir, mkdtemp, readFile, writeFile } = require("node:fs/promises")
const path = require("node:path")
const { launch, close } = require("./desktop-fixture.cjs")

test("从工程首页检查打包、可读性与资产名称", async ({}, info) => {
  const output = process.env.STUDIO_VISIBILITY_SHOTS || info.outputPath("screens")
  await mkdir(output, { recursive: true })
  const base = await mkdtemp(path.join(process.env.STUDIO_VISIBILITY_TMP || require("node:os").tmpdir(), "visibility-"))
  const projects = path.join(base, "source", "projects")
  const directory = path.join(projects, "sample")
  await mkdir(projects, { recursive: true })
  execFileSync("bun", ["../mod-core/script/target-combined-sample.ts", directory], { windowsHide: true })
  await writeFile(path.join(projects, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
  const file = path.join(directory, "minemods.project.json")
  const project = JSON.parse(await readFile(file, "utf8"))
  const roar = project.workspace.assets.find((asset) => asset.module === "sound")
  const block = project.workspace.assets.find((asset) => asset.module === "block")
  const ability = JSON.parse(
    execFileSync(
      "bun",
      ["-e", 'import { fireball } from "../mod-core/script/target-cast-sample"; console.log(JSON.stringify(fireball))'],
      { encoding: "utf8", windowsHide: true },
    ),
  )
  ability.bindings = [
    { type: "item", item: project.items[0].identifier, use: "click" },
    { type: "block", block: project.blocks[0].identifier },
  ]
  project.workspace.assets.push({
    ...block,
    id: require("node:crypto").randomUUID(),
    title: ability.name,
    module: "ability",
    document: ability,
    prompt: "让手中的蓝晶碎片放出火球。",
  })
  block.prompt = "max_stack 1, tool {kind sword, durability 2200}"
  // A valid document with one missing reference: let the real generator refuse it, before Gradle.
  for (const entity of [
    project.entities[0],
    project.workspace.assets.find((asset) => asset.module === "entity").document,
  ]) {
    entity.boss.phases[0].clip = "missing_motion"
    entity.boss.intro.steps = [{ type: "sound", at: 0.2, sound: { asset: roar.id }, volume: 1, pitch: 1 }]
    entity.combos[0].branches = [{ after: 0, to: 2, landed: true }]
  }
  await writeFile(file, JSON.stringify(project))
  execFileSync("bun", ["test/e2e/seed-visibility-history.ts", directory, "round"], { windowsHide: true })
  const studio = await launch("visibility", "source", base, process.env.STUDIO_VISIBILITY_APP)
  const page = studio.page
  const button = (name) => page.getByRole("button", { name, exact: true }).first()
  const shot = async (name) => {
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
    await page.screenshot({ path: path.join(output, name + ".png") })
    // Audit text on directly measurable solid backgrounds in the actual Chromium viewport.
    const audit = await page.evaluate(() => {
      const rgb = (value) => /rgba?\(([^)]+)\)/.exec(value)?.[1].split(/,\s*/).map(Number)
      const light = (rgb) =>
        rgb
          .slice(0, 3)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0)
      const misses = []
      let checked = 0
      for (const el of document.querySelectorAll("body *")) {
        const text = [...el.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent.trim())
          .join("")
          .slice(0, 65)
        if (!text || el.closest("button:disabled, [hidden], script, style")) continue
        const rect = el.getBoundingClientRect(),
          x = Math.max(0, rect.left) + Math.min(rect.width / 2, 8),
          y = rect.top + rect.height / 2
        if (
          !rect.width ||
          !rect.height ||
          y < 0 ||
          y >= innerHeight ||
          x >= innerWidth ||
          !el.contains(document.elementFromPoint(x, y))
        )
          continue
        const css = getComputedStyle(el),
          fg = rgb(css.color)
        if (!fg || (fg[3] ?? 1) !== 1) continue
        let parent = el,
          background = null
        while (parent) {
          const style = getComputedStyle(parent)
          if (Number(style.opacity) < 1 || style.backgroundImage !== "none") break
          const color = rgb(style.backgroundColor)
          if (color && (color[3] ?? 1) > 0) {
            if ((color[3] ?? 1) === 1) background = color
            break
          }
          parent = parent.parentElement
        }
        if (!background) continue
        checked++
        const a = light(fg),
          b = light(background),
          ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        const large =
          parseFloat(css.fontSize) >= 24 || (parseFloat(css.fontSize) >= 18.67 && Number(css.fontWeight) >= 700)
        if (ratio + 0.001 < (large ? 3 : 4.5))
          misses.push({
            text,
            element: el.tagName + "." + el.className,
            ratio: +ratio.toFixed(2),
            fg: css.color,
            bg: background,
          })
      }
      return { checked, misses }
    })
    await writeFile(path.join(output, name + "-contrast.json"), JSON.stringify(audit))
    if (!process.env.STUDIO_VISIBILITY_BASELINE) expect.soft(audit.misses, name + " 的可测文字对比度").toEqual([])
    await writeFile(path.join(output, name + ".txt"), await page.locator("body").innerText())
  }
  const menu = (command) =>
    studio.app.evaluate(
      ({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send("studio:command", value),
      command,
    )
  try {
    await button("模组图鉴").waitFor()
    await shot("home")
    await menu("settings")
    await page.locator("input[type=checkbox]:visible").first().waitFor()
    await shot("settings")
    await menu("home")
    await button("模组图鉴").click()
    await page.locator(".workbench-welcome").waitFor()
    await shot("library")
    await button("存储空间").click()
    await page.locator(".resource-summary").first().waitFor()
    await page.getByRole("heading", { name: "合成音效" }).waitFor()
    await shot("storage")
    if (!process.env.STUDIO_VISIBILITY_BASELINE) await expect(page.locator(".tools-panel")).not.toContainText("finish_tool_run")
    await page.reload()
    await page.locator(".mm-world.project-card").first().click()
    await page.locator(".pa-road").waitFor()
    await shot("overview")
    await page.getByRole("tab", { name: /说明书/ }).click()
    await page.locator(".mg-check").first().waitFor()
    await shot("guide")
    await page.getByRole("tab", { name: "能不能玩" }).click()
    await page.locator('[data-stage="build"]').click()
    await shot("pack-step")
    if (!process.env.STUDIO_VISIBILITY_BASELINE) {
      const group = page.locator(".pa-lens .pack-actions")
      const bounds = await group
        .locator("button")
        .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top))
      expect(Math.abs(bounds[0] - bounds[1])).toBeLessThan(2)
    }
    await page.getByRole("tab", { name: "能不能玩" }).click()
    await page.locator(".pp-panel").waitFor()
    await shot("play")
    const boss = page
      .locator(".pp-thing")
      .filter({ has: page.locator("header strong", { hasText: "晶石傀儡" }) })
      .last()
    await boss.scrollIntoViewIfNeeded()
    await shot("boss-answers")
    const sections = boss.locator(".boss-answer")
    if (!process.env.STUDIO_VISIBILITY_BASELINE) {
      await expect(sections.filter({ hasText: "阶段" }).first()).toBeVisible()
      const collapsed = sections.locator('.fold-summary[aria-expanded="false"]')
      while (await collapsed.count()) await collapsed.first().click()
    }
    await shot("boss-expanded")
    for (const toggle of await page.locator(".tree-toggle[aria-expanded=false]").all()) await toggle.click()
    for (const kind of ["block", "item", "recipe", "bossbar", "particle", "ability", "entity"]) {
      await page
        .locator('.inv-slot[data-kind="' + kind + '"][data-item]')
        .first()
        .click()
      const card = page.locator(".pa-card[role=dialog]").first()
      await card.waitFor()
      await card
        .locator(".pa-words")
        .first()
        .waitFor({ timeout: 5000 })
        .catch(() => {})
      await shot(kind + "-card")
      if (kind === "block" && !process.env.STUDIO_VISIBILITY_BASELINE) await expect(card).not.toContainText("max_stack")
      await card.getByRole("button", { name: "打开它", exact: true }).click()
      await card.waitFor({ state: "hidden" })
      await page.locator(".asset-workspace-header").first().scrollIntoViewIfNeeded()
      await shot(kind + "-page")
      if (kind === "entity" && !process.env.STUDIO_VISIBILITY_BASELINE) await expect(page.locator(".entity-biomes")).toHaveText("溶洞平原")
      if (kind === "bossbar" && !process.env.STUDIO_VISIBILITY_BASELINE)
        await expect(page.locator(".asset-workspace-header").locator("..")).not.toContainText("（Awakened）")
      if (kind === "block") {
        await page.getByText("自己改", { exact: true }).last().click()
        await shot("block-form")
        const flag = page.locator("input[type=checkbox]:visible").last()
        if (await flag.count()) {
          await flag.scrollIntoViewIfNeeded()
          await shot("block-switch")
        }
      }
    }
    await page.locator('.inv-slot[data-kind="model"][data-item]').first().click()
    const modelCard = page.locator(".pa-card[role=dialog]").last()
    await modelCard.locator(".mk-teaser").click()
    await modelCard.locator(".mk-stop[role=tab]").first().click()
    const measured = modelCard.locator('.mk-notes[data-tone="rule"]').first()
    await measured.scrollIntoViewIfNeeded()
    await shot("measured")
    await modelCard.getByRole("button", { name: "关闭", exact: true }).last().click()
    await button("高级").click()
    await page.locator(".advanced-note:visible").first().scrollIntoViewIfNeeded()
    await shot("advanced")
    await button("高级").click()
    await button("加一样东西").click()
    await shot("overlay")
    await page.keyboard.press("Escape")
    const id = project.id
    const job = await page.evaluate((projectId) => window.studio.buildProject({ projectId }), id)
    await expect
      .poll(
        () =>
          page.evaluate((input) => window.studio.getJob(input).then((job) => job.state), {
            projectId: id,
            jobId: job.jobId,
          }),
        { timeout: 120000 },
      )
      .toBe("failed")
    await page.reload()
    await page.locator(".mm-world.project-card").first().click()
    await page.locator(".pa-road").waitFor()
    await shot("failed-overview")
    const failed = await page.evaluate((input) => window.studio.getJob(input), { projectId: id, jobId: job.jobId })
    expect(failed.error).toContain("动作")
    if (!process.env.STUDIO_VISIBILITY_BASELINE) {
      const alert = page.getByRole("alert").filter({ hasText: "打包" }).first()
      await expect(alert).toContainText("变身")
      await expect(alert).not.toContainText("missing_motion")
      await alert.getByRole("button", { name: "复制给我的 AI 去改" }).click()
      await alert.getByRole("button", { name: "看详情" }).click()
      await shot("failure-detail")
      const copied = await studio.app.evaluate(({ clipboard }) => clipboard.readText())
      expect(copied).toContain("变身")
    } else {
      await shot("failure-detail")
    }
    const finished = JSON.parse(
      execFileSync("bun", ["test/e2e/seed-visibility-history.ts", directory], { encoding: "utf8", windowsHide: true }),
    )
    await page.reload()
    await page.locator(".mm-world.project-card").first().click()
    await page.locator(".pa-road").waitFor()
    await shot("completed-overview")
    await menu("export")
    const drawer = page.locator(".build-drawer")
    await drawer.waitFor()
    const action = drawer
      .getByRole("button", {
        name: !process.env.STUDIO_VISIBILITY_BASELINE ? "打开模组文件所在的文件夹" : /导出.*模组文件/,
      })
      .first()
    await action.scrollIntoViewIfNeeded()
    await shot("build-drawer")
    await page.keyboard.press("Escape")
    await drawer.waitFor({ state: "hidden" })
    if (!process.env.STUDIO_VISIBILITY_BASELINE) {
      await expect(page.locator(".pack-failure")).toHaveCount(0)
      await studio.app.evaluate(({ shell }) => {
        shell.showItemInFolder = (file) => {
          globalThis.visibilityRevealed = file
        }
      })
      await button("打开模组文件所在的文件夹").click()
      await expect.poll(() => studio.app.evaluate(() => globalThis.visibilityRevealed)).toBe(finished.jarPath)
      await expect(
        page.evaluate((input) => window.studio.revealBuildJar(input), { projectId: id, jobId: job.jobId }),
      ).rejects.toThrow()
      const reveal = (input) => page.evaluate((value) => window.studio.revealBuildJar(value), input)
      await expect(reveal({ projectId: require("node:crypto").randomUUID(), jobId: finished.jobId })).rejects.toThrow()
      await expect(reveal({ projectId: id, jobId: finished.jobId, path: finished.jarPath })).rejects.toThrow()
      await writeFile(finished.jarPath, "changed")
      await expect(
        page.evaluate((input) => window.studio.revealBuildJar(input), { projectId: id, jobId: finished.jobId }),
      ).rejects.toThrow()
    }
    await page.evaluate(async () => {
      const { hasApiKey, source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp", review: true })
    })
    await page.reload()
    await page.locator(".mm-world.project-card").first().click()
    await button("在制作现场看全部").click()
    await page.locator(".mf-reviewer").scrollIntoViewIfNeeded()
    await shot("reviewer")
  } finally {
    await close(studio)
  }
})

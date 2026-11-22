const { launch, close } = require("./desktop-fixture.cjs")
const { expect } = require("@playwright/test")
const fs = require("node:fs/promises"),
  path = require("node:path")
async function main() {
  const [src, out] = process.argv.slice(2),
    large = process.argv.includes("--large")
  await fs.mkdir(out, { recursive: true })
  const base = await fs.mkdtemp(path.join(path.dirname(src), "tabs-")),
    projects = path.join(base, "source/projects")
  await fs.mkdir(projects, { recursive: true })
  await fs.cp(src, path.join(projects, "sample"), { recursive: true })
  await fs.writeFile(path.join(projects, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
  const fixture = await launch("tabs", "source", base),
    p = fixture.page,
    nav = p.getByRole("navigation", { name: "生物制作流程" })
  p.setDefaultTimeout(15000)
  const shot = async (key) => {
    await p.screenshot({ path: path.join(out, key + ".png") })
  }
  const clickTab = async (text) => {
    await nav
      .getByRole("button", { name: new RegExp("^" + text) })
      .first()
      .click()
  }
  const go = async (name) => {
    await p.getByLabel("搜索工程里的东西").fill(name)
    await p.locator(".inv-slot[data-kind=entity]").filter({ hasText: name }).first().click()
    const card = p.locator(".pa-card[role=dialog]").first()
    await card.getByRole("button", { name: "打开它", exact: true }).click()
    await card.waitFor({ state: "hidden" })
    await nav.waitFor()
  }
  try {
    await p.locator(".mm-world.project-card").first().click()
    await p.locator(".pa-road").waitFor({ timeout: 90000 })
    if (!large) {
      const search = p.getByLabel("搜索工程里的东西")
      for (const term of ["重锤", "旧挥手", "石像守卫"]) {
        await search.fill(term)
        await expect(p.locator(".inv-slot[data-kind=entity]").filter({ hasText: "石像守卫" }).first()).toBeVisible()
      }
      await search.fill("不存在的声音或生物")
      await expect(p.getByText("没有找到符合的东西。")).toBeVisible()
    }
    await go("石像守卫")
    if (large) {
      const counts = await p.evaluate(
        async () => (await window.studio.listProjects())[0].project.workspace.assets.length,
      )
      expect(counts).toBeGreaterThanOrEqual(18)
      await p.evaluate(() => {
        window.openMessages = []
        new MutationObserver((records) => {
          for (const record of records)
            for (const n of record.addedNodes)
              if (n.textContent?.includes("正在打开这个工程")) window.openMessages.push(Date.now())
        }).observe(document.body, { childList: true, subtree: true })
      })
      await fixture.app.evaluate(({ipcMain})=>{
        const real=ipcMain._invokeHandlers.get("studio:invoke")
        global.tabReads=[]
        ipcMain.removeHandler("studio:invoke")
        ipcMain.handle("studio:invoke",(e,m)=>{
          if(["openProject","getEntityPreview","selectEntity","getCreatureLook"].includes(m.method))global.tabReads.push(m.method)
          return real(e,m)
        })
      })
      const rows = []
      for (let i = 0; i < 5; i++) {
        const row = {}
        for (const title of ["招式", "阶段", "演出", "声音"]) {
          const start = performance.now()
          await clickTab(title)
          await nav.locator("[aria-current=step]").filter({ hasText: title }).waitFor()
          await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          row[title] = Math.round(performance.now() - start)
        }
        rows.push(row)
      }
      expect(await p.evaluate(() => window.openMessages)).toEqual([])
      const reads=await fixture.app.evaluate(()=>global.tabReads)
      expect(reads).toEqual([])
      await fs.writeFile(path.join(out, "切页签.json"), JSON.stringify({ assets: counts, reads, rows }, null, 2))
      await shot("B9-大工程")
      return
    }
    await expect(nav.locator(".workflow-step")).toHaveCount(7)
    const modelReady=async()=>{
      await expect(p.locator(".entity-preview-note")).toContainText("外观预览 · 游戏行为需构建后验证",{timeout:30000})
      await expect.poll(async()=>{
        const frame=(await p.locator(".entity-appearance canvas").first().screenshot()).toString("base64")
        return p.evaluate(async frame=>{
          const im=await createImageBitmap(new Blob([Uint8Array.from(atob(frame),c=>c.charCodeAt(0))],{type:"image/png"}))
          const canvas=document.createElement("canvas");canvas.width=32;canvas.height=32
          const ctx=canvas.getContext("2d");ctx.drawImage(im,0,0,32,32);im.close()
          const pixels=ctx.getImageData(7,8,18,17).data
          let dark=0
          for(let i=0;i<pixels.length;i+=4)if(pixels[i]<110 && pixels[i+1]<130 && pixels[i+2]<150)dark++
          return dark
        },frame)
      },{timeout:20000}).toBeGreaterThan(8)
    }
    await modelReady();await nav.evaluate(el=>el.scrollIntoView({block:"start"}));await shot("B1-守卫")
    await clickTab("招式")
    const cards = p.locator("article[id^=creature-move-]"),
      moves = p.locator("article[id^=creature-move-]").filter({ has: p.getByText("多远会用", { exact: true }) })
    await expect(moves).toHaveCount(3)
    await moves.first().getByRole("button", { name: "播放", exact: true }).click()
    await expect(p.locator(".inside-stage")).toContainText("正在放")
    await shot("B2-招式")
    const picture = moves.first().locator(".creature-picture")
    await picture.getByRole("button").click()
    await expect(picture.locator("img").first()).toBeVisible({ timeout: 75000 })
    await picture.getByRole("button").click()
    await cards.last().scrollIntoViewIfNeeded()
    await expect(cards.last()).toContainText("目标在 5 格以外")
    await shot("B3-连招")
    const faults = []
    for (const title of ["外观", "动作", "行为", "招式", "阶段", "演出", "声音"]) {
      await clickTab(title)
      const t = await p.locator(".main-area").innerText()
      for (const word of [
        "golem_roar",
        "old_wave",
        "bang_quake",
        "minecraft:",
        "shake_ground",
        "triple",
        "phase_",
        "compass",
      ])
        if (t.includes(word)) faults.push(word)
    }
    expect(faults).toEqual([])
    const contrast = await p
      .locator(".creature-sounds .resource-item strong")
      .first()
      .evaluate((el) => {
        function lum(css) {
          const [r, g, b] = css
            .match(/[0-9.]+/g)
            .slice(0, 3)
            .map((x) => Number(x) / 255)
            .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
          return 0.2126 * r + 0.7152 * g + 0.0722 * b
        }
        let panel = el
        while (panel && getComputedStyle(panel).backgroundColor === "rgba(0, 0, 0, 0)") panel = panel.parentElement
        const a = lum(getComputedStyle(el).color),
          b = lum(getComputedStyle(panel).backgroundColor)
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      })
    expect(contrast).toBeGreaterThanOrEqual(4.5)
    await shot("B8-普通模式")
    await clickTab("阶段")
    await p.locator(".phase-line:visible button").nth(1).click()
    await expect(p.locator(".phase-line:visible")).toContainText("66%")
    await shot("B4-阶段")
    await p.locator(".inside-card:visible").first().getByRole("button", { name: "重锤", exact: true }).click()
    await expect(nav.locator("[aria-current=step]")).toContainText("招式")
    await clickTab("演出")
    for (const [i, n] of ["登场", "死亡"].entries()) {
      await p.locator(".phase-line:visible button").nth(i).click()
      expect(await p.locator(".show-track button").count()).toBe(await p.locator(".show-list li").count())
      await shot("B5-" + n)
    }
    await clickTab("动作")
    await p.locator(".inside-motion-list").waitFor()
    const total=await p.evaluate(async()=>{
      const project=(await window.studio.listProjects())[0].project
      const entity=project.workspace.assets.find(a=>a.title==="石像守卫" && a.document.kind==="entity")
      return project.workspace.assets.find(a=>a.id===entity.document.model_asset_id).document.animations.length
    })
    await expect(p.locator(".inside-motion-list article")).toHaveCount(total)
    const unused = p.locator(".inside-motion-list article").filter({ hasText: "没有任何地方会播放它" }).last()
    await unused.scrollIntoViewIfNeeded()
    await shot("B6-动作列表")
    await clickTab("行为")
    const lair = p.getByText("看它的巢", { exact: true })
    await lair.click()
    await lair.scrollIntoViewIfNeeded()
    await shot("B7-巢")
    await go("溪边石羊")
    await expect(nav.locator(".workflow-step")).toHaveCount(4)
    await nav.scrollIntoViewIfNeeded()
    await modelReady();await nav.evaluate(el=>el.scrollIntoView({block:"start"}));await shot("B1-石羊")
  } catch (e) {
    await shot("异常")
    console.error((await p.locator("body").innerText()).slice(-2000))
    throw e
  } finally {
    await close(fixture)
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

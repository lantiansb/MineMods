const { test, expect } = require("@playwright/test")
const { execFileSync } = require("node:child_process")
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os")
const { launch, close } = require("./desktop-fixture.cjs")
test("在石像守卫工程里管理声音、音乐和其他资产", async ({}, info) => exercise(info, false))
test("战斗音乐的设置、更换、取消与时间轴", async ({}, info) => exercise(info, true))
async function exercise(info, battleOnly) {
  const out = process.env.SOUND_SHOTS || info.outputPath("截图"),
    base = await fs.mkdtemp(path.join(process.env.SOUND_TMP || os.tmpdir(), "sound-ui-"))
  const projects = path.join(base, "source", "projects"),
    dir = path.join(projects, "sample")
  await fs.mkdir(projects, { recursive: true })
  await fs.mkdir(out, { recursive: true })
  const bun = (...args) => execFileSync("bun", args, { windowsHide: true, stdio: "inherit" })
  bun("../mod-core/script/target-combined-sample.ts", dir)
  bun("test/e2e/seed-sound-music.ts", dir)
  await fs.writeFile(path.join(projects, "studio-settings.json"), JSON.stringify({ prepareAhead: false }))
  if(process.env.SOUND_GAME_RUNTIME) bun("test/e2e/seed-vanilla-sound.ts",process.env.SOUND_GAME_RUNTIME,path.join(base,"runtime"))
  const studio = await launch("sounds", "source", base),
    p = studio.page
  const button = (label, root = p) => root.getByRole("button", { name: label, exact: true }).first()
  const card = p.locator(".pa-card[role=dialog]").first(),
    search = p.getByLabel("搜索工程里的东西")
  const go = async (kind, title, open = true) => {
    if (await card.isVisible()) {
      const c = card.getByRole("button", { name: /关闭/ }).last()
      await c.click()
    }
    await search.fill(title || "")
    if (!title) for (const t of await p.locator(".tree-toggle[aria-expanded=false]").all()) await t.click()
    let tile = p.locator('.inv-slot[data-kind="' + kind + '"][data-item]')
    if (title) tile = tile.filter({ hasText: title })
    await tile.first().click()
    await card.waitFor()
    if (open) {
      await button("打开它", card).click()
      await card.waitFor({ state: "hidden" })
      await p.locator(".asset-workspace-header").first().waitFor()
    }
  }
  const shot = async (key, loc) => {
    if (loc)
      await expect(async () => {
        await loc.scrollIntoViewIfNeeded()
      }).toPass({ timeout: 7000 })
    await p.screenshot({ path: path.join(out, key + ".png") })
  }
  const menu = (root = p) => button("管理这样东西", root)
  const errors = []
  const step = async (key, fn) => {
    try {
      await fn()
      console.log(key + " OK")
    } catch (e) {
      errors.push(key + " " + String(e).slice(0, 500))
      await p.screenshot({ path: path.join(out, "未通过-" + key + ".png") })
      console.log(errors.at(-1))
      console.log((await p.locator("body").innerText()).slice(-1000))
      await p.reload()
      await p.locator(".mm-world.project-card").first().click()
      await p.locator(".pa-road").waitFor({ timeout: 35000 })
    }
  }
  p.setDefaultTimeout(8000)
  try {
    await p.locator(".mm-world.project-card").first().click()
    await p.locator(".pa-road").waitFor()
    if (battleOnly) {
      const read = async () => JSON.parse(await fs.readFile(path.join(dir, "minemods.project.json"), "utf8"))
      const state = async () => {
        const project = await read()
        const document = project.workspace.assets.find(a => a.title === "石像守卫" && a.module === "entity")
        const entity = project.entities.find(e => e.id === document.document.model_asset_id)
        return [document.document.boss.music ?? null, entity.boss.music ?? null,
          document.dependencies.filter(id => project.workspace.assets.some(a => a.module === "music" && a.id === id))]
      }
      const select = p.getByRole("combobox", {name:"背景音乐", exact:true})
      const users = p.getByRole("region", {name:"谁在用它"})
      const header = p.locator(".asset-workspace-header")
      const timeline = p.getByRole("region", {name:"战斗音乐时间轴"})
      const opened = async (kind, name) => { await go(kind,name); await expect(header).toContainText(name) }
      const check = async (id, starts="fight", fade_seconds=2) => {
        const cue = id ? { asset:id, starts, fade_seconds } : null
        await expect.poll(state).toEqual([cue,cue,id ? [id] : []])
      }
      await opened("music","洞底回响")
      await expect(users).toContainText("还没有谁在用")
      await expect(header).not.toContainText("正在读")
      await shot("01-未引用页头",header)
      await shot("02-什么时候放",p.getByRole("heading",{name:"什么时候放"}))
      await opened("entity","石像守卫")
      async function choose(name, key) {
        const [id] = await select.selectOption({label:name})
        await check(id)
        await expect(select.locator("option:checked")).toHaveText(name)
        await shot(key,select)
        return id
      }
      await choose("洞底回响","03-设置背景音乐")
      const second = await choose("山口夜曲","04-更换背景音乐")
      await expect(timeline).toContainText("0.8 秒 · 开打")
      await shot("05-开打时间轴",timeline)
      await select.selectOption("")
      await check(null)
      await p.reload()
      await p.locator(".mm-world.project-card").first().click()
      await p.locator(".pa-road").waitFor()
      await opened("entity","石像守卫")
      await expect(select).toHaveValue("")
      await shot("06-重开后已取消",select)
      await select.selectOption(second)
      await check(second)
      await p.getByRole("tab",{name:"自己改"}).click()
      const starts = p.locator('[data-field="boss.music.starts"]')
      const fade = p.locator('[data-field="boss.music.fade_seconds"]')
      await starts.getByRole("button",{name:"登场",exact:true}).click()
      await fade.locator("input").fill("3")
      await fade.locator("input").press("Tab")
      await p.getByRole("region",{name:"自己改"}).getByRole("button",{name:"保存",exact:true}).click()
      try { await check(second,"wake",3) } catch (error) {
        console.log("手改保存",await p.locator(".ae-bar").innerText(), await p.locator(".ae-field.bad").allTextContents())
        throw error
      }
      await shot("07-手改起点",starts)
      await shot("08-手改淡出",fade)
      await p.getByRole("tab",{name:"看看"}).click()
      await expect(timeline).toContainText("0 秒 · 登场音乐开始")
      await shot("09-登场时间轴",timeline)
      await opened("music","山口夜曲")
      await expect(users).toContainText("石像守卫 · 从登场播放，脱战 3 秒淡出")
      await expect(header).not.toContainText("正在读")
      await shot("10-引用页头",header)
      await shot("11-谁在用它",users)
      await p.locator('.inv-slot[data-kind="music"]').filter({hasText:"山口夜曲"}).hover()
      const tooltip = p.locator(".inv-tip")
      await expect(tooltip).toContainText("可用作 Boss 战斗音乐")
      await expect(tooltip).not.toContainText("不会做进游戏")
      await shot("12-音乐徽标提示",tooltip)
      return
    }
    await step("A1", async () => {
      for (const t of await p.locator(".tree-toggle[aria-expanded=false]").all()) await t.click()
      const sound = p.locator('.inv-slot[data-kind="sound"] img').first(),
        music = p.locator('.inv-slot[data-kind="music"] img').first()
      await expect(async () => {
        await p.locator('.inv-slot[data-kind="music"]').first().scrollIntoViewIfNeeded()
      }).toPass({ timeout: 8000 })
      await expect(sound).toHaveCount(1)
      await expect(music).toHaveCount(1)
      await shot("A1", music)
    })
    await step("A2", async () => {
      await go("sound", "石像低鸣")
      const file = p.getByRole("region", { name: "声音文件" })
      await button("试听", file).click()
      const progress = p.locator('progress[aria-label="播放进度"]')
      await expect.poll(() => progress.evaluate((e) => e.value)).toBeGreaterThan(0.5)
      await shot("A2", progress)
      await expect(progress).toHaveCount(0)
    })
    await step("A3", async () => {
      await go("sound", "石像低鸣")
      const users = p.getByRole("region", { name: "谁在用它" })
      await expect(users).toContainText("石像守卫 · 受伤时")
      await shot("A3", users)
      await button("去看", users).click()
      await expect(p.locator(".creature-sounds .fold-summary")).toBeVisible()
    })
    await step("A4", async () => {
      await go("entity", null)
      const table = p.locator(".creature-sounds")
      await expect(table).toContainText("自己的：石像低鸣")
      await expect(table).toContainText("原版：")
      await expect(table).toContainText("登场演出")
      await shot("A4", table.locator(".fold-summary"))
      const ambient=table.locator(".resource-item").filter({has:p.getByText("平时",{exact:true})}).first()
      if(process.env.SOUND_GAME_RUNTIME){
        await button("试听",ambient).click()
        await expect(ambient).toContainText(/正在放 0\.[1-9]/)
        await shot("A4-原版试听",ambient)
      }else await expect(button("试听",ambient)).toBeDisabled()
    })
    await step("A5", async () => {
      await go("entity", null)
      const row = p
        .locator(".creature-sounds .resource-item")
        .filter({ has: p.getByText("走路时", { exact: true }) })
        .first()
      await expect(row).toContainText("没有设")
      await expect(button("试听", row)).toHaveCount(0)
      await button("换", row).click()
      await row.locator("select").selectOption({ label: "空谷回声" })
      await button("用这个声音", row).click()
      await expect(row).toContainText("自己的：空谷回声")
      await expect(button("试听", row)).toBeEnabled()
      await go("sound", "空谷回声")
      const users = p.getByRole("region", { name: "谁在用它" })
      await expect(users).toContainText("石像守卫 · 走路时")
      await shot("A5", users)
    })
    await step("A6", async () => {
      await button("加一样东西").click()
      await button("声音").click()
      const dialog = p.getByRole("dialog").last()
      await dialog.getByLabel("声音的名字").fill("收件箱脚步")
      await button("查看收件箱", dialog).click()
      await expect(dialog).toContainText("守卫脚步.ogg")
      await expect(dialog.getByLabel("让 AI 做一句话")).toBeVisible()
      await shot("A6", dialog)
      await button("加进来", dialog).click()
      await expect(p.getByRole("heading", { name: "收件箱脚步", exact: true }).first()).toBeVisible()
    })
    await step("A7", async () => {
      await go("music", "洞底回响")
      const section = p.getByRole("region", { name: "音乐片段" })
      for (const name of ["前奏", "循环段", "结尾"]) await expect(section.getByRole("heading", { name, exact: true })).toBeVisible()
      await expect(section).toContainText("什么时候放")
      await shot("A7-三段",section.getByRole("heading",{name:"前奏",exact:true}));
      await button("连起来试听（循环两遍）", section).click()
      await expect(section).toContainText("正在放前奏")
      await expect(section).toContainText("正在放循环段", { timeout: 9000 })
      await shot("A7", section.locator("progress"))
      await expect(section).toContainText("正在放结尾", { timeout: 9000 })
    })
    await step("战斗音乐", async () => {
      await go("entity", "石像守卫")
      const select = p.getByRole("combobox", { name: "背景音乐", exact: true })
      await select.selectOption({ label: "洞底回响" })
      await expect(select.locator("option:checked")).toHaveText("洞底回响")
      await shot("背景音乐设置", select)
      await p.getByText("自己改", { exact: true }).last().click()
      const fade = p.getByText("音乐淡出（秒）", { exact: true }).first()
      await expect(fade).toBeAttached()
      await shot("淡出表单", fade)
      await go("music", "洞底回响")
      const users = p.getByRole("region", { name: "谁在用它" })
      await expect(users).toContainText("石像守卫 · 从开打播放，脱战 2 秒淡出")
      await shot("音乐使用者", users)
    })
    await step("A8", async () => {
      await search.fill("音乐")
      const tracks = p.locator('.inv-slot[data-kind="music"]')
      for (const name of ["洞底回响", "山口夜曲"]) await expect(tracks.filter({hasText:name})).toHaveCount(1)
      await shot("A8-音乐", search)
      await search.fill("从不存在的词")
      await expect(p.getByText("没有找到符合的东西。")).toBeVisible()
      await shot("A8", search)
      await search.fill("")
    })
    await step("H1", async () => {
      await go("sound", "石像低鸣", false)
      await menu(card).click()
      const names = await card.getByRole("menuitem").allTextContents()
      expect(names).toEqual(["改名", "复制一份", "换文件", "删除"])
      await shot("H1-卡片", card.getByRole("menu"))
      await button("打开它", card).click()
      const page = p.locator(".asset-workspace-header")
      await menu(page).click()
      expect(await page.getByRole("menuitem").allTextContents()).toEqual(names)
      await shot("H1", page.getByRole("menu"))
    })
    await step("H2", async () => {
      await go("recipe", null, false)
      await menu(card).click()
      await expect(card.getByRole("menuitem", { name: "换文件" })).toBeDisabled()
      await expect(card).toContainText("没有可换的文件")
      await shot("H2", card.getByRole("menu"))
    })
    await step("H3", async () => {
      await go("sound", "收件箱脚步", false)
      await menu(card).click()
      await card.getByRole("menuitem", { name: "删除" }).click()
      await button("确认删除", card).click()
      await expect(p.locator('.inv-slot[data-kind="sound"]').filter({ hasText: "收件箱脚步" })).toHaveCount(0)
      await shot("H3-已删除", button("撤销"))
      await button("撤销").click()
      await expect(p.locator('.inv-slot[data-kind="sound"]').filter({ hasText: "收件箱脚步" })).toHaveCount(1)
      await shot("H3", search)
    })
    await step("H4", async () => {
      await go("sound", "石像低鸣", false)
      await menu(card).click()
      await card.getByRole("menuitem", { name: "删除" }).click()
      const box = card.getByRole("region", { name: "删除确认" })
      await expect(box).toContainText("石像守卫")
      await expect(button("确认删除", box)).toHaveCount(0)
      await shot("H4", box)
      await button("去换", box).click()
      await expect(p.getByLabel("工程里的声音")).toBeVisible()
      await expect(p.locator(".creature-sounds")).toBeVisible()
    })
    await step("H5", async () => {
      await go("sound", "石像低鸣", false)
      await menu(card).click()
      await card.getByRole("menuitem", { name: "改名" }).click()
      await card.getByLabel("新名字").fill("岩石回音")
      await button("保存名字", card).click()
      await expect(card).toContainText("岩石回音")
      await shot("H5-卡片", card)
      await button("关闭", card).click()
      await search.fill("岩石回音")
      await expect(p.locator('.inv-slot[data-kind="sound"]').first()).toContainText("岩石回音")
      await shot("H5", search)
      await go("entity", null)
      await expect(p.locator(".creature-sounds")).toContainText("自己的：岩石回音")
      await shot("H5-使用处", p.locator(".creature-sounds .fold-summary"))
    })
    await step("H6", async () => {
      await go("block", null, false)
      await menu(card).click()
      await card.getByRole("menuitem", { name: "复制一份" }).click()
      await button("关闭", card).click()
      await search.fill("的副本")
      const copy = p.locator('.inv-slot[data-kind="block"]').first()
      await expect(copy).toContainText("的副本")
      await copy.click()
      await button("打开它", card).click()
      await expect(p.locator(".asset-workspace-header")).toContainText("的副本")
      const stored = JSON.parse(await fs.readFile(path.join(dir, "minemods.project.json"), "utf8")),
        duplicate = stored.workspace.assets.find((a) => a.module === "block" && a.title.endsWith(" 的副本")),
        source = stored.workspace.assets.find((a) => a.module === "block" && a.title + " 的副本" === duplicate.title)
      const values = ({ identifier, name, ...rest }) => rest
      expect(values(duplicate.document)).toEqual(values(source.document))
      await shot("H6", p.locator(".asset-workspace-header"))
    })
    await step("H7", async () => {
      await go("fixture", "守卫的罗盘", false)
      await expect(card.locator(".pa-view img").first()).toBeVisible()
      await expect(p.locator('.inv-slot[data-kind="fixture"] img').first()).toBeVisible()
      await shot("H7", card.locator(".pa-view img").first())
    })
    expect(errors).toEqual([])
  } finally {
    await fs.writeFile(path.join(out, "核对.json"), JSON.stringify({ errors, rendererErrors: studio.errors }, null, 2))
    await close(studio)
  }
}

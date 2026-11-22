const fs = require("node:fs/promises")
const path = require("node:path")
const { expect } = require("@playwright/test")
const { launch, close } = require("./desktop-fixture.cjs")

const samples = [
  { name: "潮汐灯塔", move: 0, damage: 13, size: "伸多远（格）", extent: 4.5 },
  { name: "霜杉林径", move: 1, damage: 17, size: "宽度（格）", extent: 2.25 },
  { name: "星沙观测站", move: 0, damage: 23, size: "张开角度（度）", extent: 145 },
]

async function main() {
  const [directory, output, phase = "edit"] = process.argv.slice(2)
  const fixture = await launch("hand-moves-", "source", directory)
  const { app, page } = fixture
  const findTab = name => page.getByRole("navigation", { name: "生物制作流程" }).getByRole("button", { name: new RegExp("^" + name) })
  const form = page.getByRole("form", { name: /^编辑/ })
  const undo = page.getByRole("button", { name: "撤销上次修改" })
  const save = async () => {
    await form.getByRole("button", {name: "保存修改", exact: true}).click()
    await expect(form).toHaveCount(0, { timeout: 12000 })
    await expect(undo).toBeEnabled()
  }

  try {
    for (const sample of samples) {
      const folder = path.join(directory, "source/projects", sample.name)
      const file = path.join(folder, "minemods.project.json")
      const read = async () => JSON.parse(await fs.readFile(file, "utf8"))
      const bytes = await fs.readFile(file)
      await page.locator(".project-card").filter({ hasText: sample.name }).click()
      await page.locator(".pa-road").waitFor()
      if (phase === "edit") {
        const slot = page.locator(".inv-slot[data-kind=entity]").first()
        const openCreature = page.locator(".pa-card[role=dialog]").getByRole("button", { name: "打开它", exact: true })
        await expect.poll(async () => {
          if (await openCreature.isVisible()) return true
          await slot.click({ timeout: 1500 }).catch(() => undefined)
          return openCreature.isVisible()
        }, { timeout: 45000 }).toBe(true)
        await openCreature.click()
        await findTab("招式").click()
        const move = () => page.locator(".inside-card").filter({ has: page.getByRole("button", {name: "编辑这招", exact: true}) }).nth(sample.move)
        const editMove = async () => {
          await move().getByRole("button", { name: "编辑这招", exact: true }).click()
          await expect(form).toBeVisible()
        }
        await editMove()
        expect(await fs.readFile(file)).toEqual(bytes)
        const hit = form.getByRole("group", { name: "出手 1", exact: true })
        const original = (await read()).entities[0].abilities[sample.move]
        if (sample === samples[0]) {
          await form.getByLabel("蓄力（秒）", {exact: true}).fill("7")
          await form.getByRole("button", {name: "保存修改", exact: true}).click()
          const issue = page.locator(".inside-detail").getByRole("alert")
          await expect(issue.getByText(/蓄力/).first()).toBeVisible()
          await expect(issue.getByRole("button", { name: original.name, exact: true }).first()).toBeVisible()
          expect(await fs.readFile(file)).toEqual(bytes)
          await form.getByLabel("蓄力（秒）", {exact: true}).fill(String(original.windup))
        }
        await hit.getByLabel("基本伤害", { exact: true }).fill(String(sample.damage))
        await hit.getByLabel(sample.size, { exact: true }).fill(String(sample.extent))
        await form.scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(output, sample.name + "-招式.png") })
        await save()
        expect((await read()).entities[0].abilities[sample.move].hits[0].damage).toBe(sample.damage)
        if (sample === samples[0]) {
          await undo.click()
          await expect(undo).toHaveCount(0)
          expect((await read()).entities[0].abilities[sample.move]).toEqual(original)
          await editMove()
          await hit.getByLabel("基本伤害", { exact: true }).fill(String(sample.damage))
          await hit.getByLabel(sample.size, { exact: true }).fill(String(sample.extent))
          await save()
        }

        if (sample === samples[2]) {
          await findTab("阶段").click()
          await page.locator(".inside-detail").getByRole("button", { name: /第 2 阶段/ }).click()
          await page.getByRole("button", { name: "编辑这阶段", exact: true }).click()
          await form.getByLabel("血量低于（%）", { exact: true }).fill("45")
          await page.screenshot({ path: path.join(output, "07j-改后-phases.png") })
          await save()
          expect((await read()).entities[0].boss.phases[0].below).toBe(0.45)
          await findTab("演出").click()
          await page.getByRole("button", { name: "编辑登场演出", exact: true }).click()
          await form.getByLabel("全程（秒）", { exact: true }).fill("4.5")
          const sound = form.getByRole("group", { name: /第 \d+ 步 · 声音/ }).first()
          await sound.getByLabel("开始时间（秒）", { exact: true }).fill("2.1")
          const particle = form.getByRole("group", { name: /第 \d+ 步 · 粒子/ }).first()
          await particle.getByRole("combobox").selectOption({ label: "工程里 · 余烬" })
          await sound.scrollIntoViewIfNeeded()
          await page.screenshot({ path: path.join(output, "07j-改后-shows.png") })
          await save()
          const intro = (await read()).entities[0].boss.intro
          expect(intro.seconds).toBe(4.5)
          expect(intro.steps.find(step => step.type === "sound").at).toBe(2.1)
          expect(intro.steps.find(step => step.type === "particle").particle).toHaveProperty("asset")
        }
      } else {
        await pack(app, page, folder, output, sample)
      }
      console.log("PASS", phase, sample.name)
      await page.reload()
    }
  } finally {
    await close(fixture)
  }
}

async function pack(app, page, folder, output, sample) {
  const directory = path.join(folder, ".minemods/jobs")
  const prior = new Set(await fs.readdir(directory).catch(() => []))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("studio:command", "export"))
  await page.getByRole("button", { name: "打包，不打开游戏", exact: true }).click()
  const created = async () => (await fs.readdir(directory).catch(() => [])).find(file => !prior.has(file) && file.endsWith(".json"))
  await expect.poll(created).toBeTruthy()
  const jobFile = path.join(directory, await created())
  const read = async () => JSON.parse(await fs.readFile(jobFile, "utf8"))
  await expect.poll(async () => (await read()).state, { timeout: 900000, intervals: [1000] }).toMatch(/completed|failed|canceled/)
  const job = await read()
  await fs.writeFile(path.join(output, sample.name + "-打包.json"), JSON.stringify(job, null, 2))
  expect(job.state, job.error ?? "").toBe("completed")
  await fs.access(job.output.jarPath)
  await page.screenshot({ path: path.join(output, sample.name + "-打包.png") })
  console.log(job.output.jarPath)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

import { expect, test, _electron } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ModelAnnotationContext } from "@minemods/studio-ai/model-annotation"
import type { ExternalStartResult, ExternalTaskContext } from "../../src/external"
import { modelFixture } from "./model-fixture"

/**
 * P3 on the packaged app, a person's whole way through with hands that slip: nothing is lost to a key, marks stay on what they mark, what is going on can be read, the keyboard
 * gets there too, and the little things are said once and hold still when asked. The AI is a local deterministic collaborator over the real MCP process.
 */
const SIZES = [[1366, 768], [1920, 1080]] as const
const MODEL = "彩虹小鸡模型"
type Seen = { toasts: string[]; orbs: number; audio: number }

test("P3 正式包：不丢东西、不误操作、状态看得懂、键盘走得通、彩蛋只说一次", async () => {
  const root = path.resolve("../../.artifacts/studio")
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, "p3-"))
  await mkdir(path.join(directory, "screens"))
  const projects = path.join(directory, "projects")
  const app = await _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE!, args: [`--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: projects, MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "" } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  const evidence: Record<string, unknown> = { fixture: "local deterministic MCP collaborator; no live model quality claim", directory }
  let client: Client | undefined
  let transport: StdioClientTransport | undefined
  const shot = (name: string) => page.screenshot({ path: path.join(directory, "screens", `${name}.png`), animations: "disabled", scale: "css" })
  const size = async (width: number, height: number) => {
    await expect
      .poll(async () => {
        await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows().find((window) => /index\.html/.test(window.webContents.getURL()))!.setContentSize(value[0], value[1]), [width, height])
        return page.evaluate(() => [innerWidth, innerHeight])
      })
      .toEqual([width, height])
  }
  const bothSizes = async (name: string) => {
    for (const [width, height] of SIZES) {
      await size(width, height)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `${name} 在 ${width} 下不能横向滚动` }).toBe(true)
      await page.waitForTimeout(250)
      await shot(`${width}-${name}`)
    }
    await size(1366, 768)
  }
  const connect = async () => {
    const configuration = await page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
    transport = new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" })
    client = new Client({ name: "p3-collaborator", version: "1" })
    await client.connect(transport)
  }
  const call = async <T,>(name: string, args: Record<string, unknown>) => {
    const response = CallToolResultSchema.parse(await client!.callTool({ name, arguments: args }))
    expect(response.isError, `${name}: ${JSON.stringify(response.content).slice(0, 800)}`).not.toBe(true)
    const text = response.content.find((item) => item.type === "text")
    if (!text || text.type !== "text") throw new Error(`${name}: missing text`)
    return { value: JSON.parse(text.text) as T, content: response.content }
  }
  const design = modelFixture(MODEL)
  const piece = (names: string[]) => ({
    ...design,
    bones: design.bones.filter((bone) => names.includes(bone.name)),
    animations: design.animations.flatMap((animation) => {
      const channels = animation.channels.filter((channel) => names.includes(channel.bone))
      return channels.length || ["idle", "walk", "hurt"].includes(animation.name) ? [{ ...animation, channels }] : []
    }),
  })
  const order = (() => {
    const placed: string[] = []
    const left = design.bones.map((bone) => bone.name)
    while (left.length) {
      const next = left.findIndex((name) => {
        const parent = design.bones.find((bone) => bone.name === name)!.parent
        return !parent || placed.includes(parent)
      })
      placed.push(...left.splice(next < 0 ? 0 : next, 1))
    }
    return placed
  })()
  const sheet = (subject: string) => ({ subject, recognisable: ["圆头", "四只脚"], assumed: [], parts: design.bones.map((bone) => ({ name: bone.name, what: `小鸡的${bone.name}`, shape: "按现有立方体", attaches: bone.parent ? `接在 ${bone.parent}` : "根", surface: "沿用现有颜色", moves: "跟着动作动", assumed: false })) })
  const finish = async (ids: { projectId: string; runId: string; taskId: string }, document: unknown) => {
    await call("save_sheet", { ...ids, sheet: sheet("一只彩虹小鸡的模型") })
    await call("look", { ...ids, document })
    await call("self_review", { ...ids, matches: ["部件齐了。"], problems: [], next: [], verdict: "done" })
    const review = await call<{ blind_first?: boolean }>("final_review", ids)
    if (review.value.blind_first) await call("final_review", { ...ids, blind: { sees: "一个有头和脚的小动物", also: [], because: "确定性测试协作者的回答，不作为真实评审证据。" } })
    await call("final_review", { ...ids, verdict: { passed: true, findings: [], advice: [], independent: false, ...(review.value.blind_first ? { fits: "at_once" } : {}) } })
    await call("commit_task", { ...ids, document })
  }
  const seqOf = () => page.locator(".ml-stage").getAttribute("data-seq").then((value) => Number(value ?? 0))
  const write = async (ids: Record<string, unknown>, names: string[], detail?: string) => {
    const before = await seqOf()
    await call("update_task", { ...ids, draft: piece(names), progress: Math.round((names.length / order.length) * 100), ...(detail ? { detail } : {}) })
    await expect.poll(seqOf, { timeout: 5000, intervals: [25] }).toBeGreaterThan(before)
  }
  const seen = () => page.evaluate(() => (window as unknown as { seen: Seen }).seen)
  // Everything a person is told or shown in passing is counted from here on, so 「once」 and 「never」 can be asserted at the end. Toasts wait in line: pressing one moves on to the next.
  const watch = () =>
    page.evaluate(() => {
      const record: Seen = { toasts: [], orbs: 0, audio: 0 }
      const holder = window as unknown as { seen: Seen; AudioContext: typeof AudioContext }
      holder.seen = record
      const Real = holder.AudioContext
      holder.AudioContext = class extends Real {
        constructor() {
          super()
          record.audio += 1
        }
      }
      new MutationObserver((changes) =>
        changes.forEach((change) =>
          change.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement && node.classList.contains("adv-toast")) record.toasts.push(node.querySelector("strong")!.textContent ?? "")
          }),
        ),
      ).observe(document.querySelector(".adv-stack")!, { childList: true, subtree: true })
      new MutationObserver((changes) =>
        changes.forEach((change) =>
          change.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement && node.classList.contains("xp-orb")) record.orbs += 1
          }),
        ),
      ).observe(document.querySelector(".studio-root")!, { childList: true })
    })
  const sawToast = (head: string) =>
    expect
      .poll(
        async () => {
          await page.locator(".adv-toast").first().click({ timeout: 300 }).catch(() => undefined)
          return (await seen()).toasts
        },
        { timeout: 45000, intervals: [400] },
      )
      .toContain(head)
  const inFocus = (selector: string) => page.evaluate((value) => !!document.activeElement?.matches(value), selector)

  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    evidence.application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath }))
    await size(1366, 768)

    // The splash, pressed: another line, with one jump.
    const splash = page.locator(".mm-splash")
    const said = await splash.textContent()
    await splash.click({ force: true })
    await expect(splash).not.toHaveText(said!)
    expect(await splash.getAttribute("class")).toContain("pop")
    await expect.poll(() => splash.getAttribute("class")).not.toContain("pop")

    const created = await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      await window.studio.createProject({ name: "甲工程", description: "", empty: true })
      await new Promise((resolve) => setTimeout(resolve, 20))
      await window.studio.createProject({ name: "乙工程", description: "", empty: true })
      await new Promise((resolve) => setTimeout(resolve, 20))
      return window.studio.createProject({ name: "周末彩虹乐园", description: "一只彩虹小鸡", modId: "p3_rainbow", empty: true })
    })
    const projectId = created.project.id
    await page.reload()

    // 接着做 goes by up and down, and the row the keyboard is on is the one that looks chosen.
    const worlds = page.locator(".mm-worlds-list .mm-world")
    await expect(worlds).toHaveCount(3)
    await worlds.first().focus()
    await page.keyboard.press("ArrowDown")
    expect(await inFocus(".mm-world:nth-child(2)")).toBe(true)
    await expect.poll(() => worlds.first().evaluate((row) => getComputedStyle(row).borderTopColor)).toBe("rgba(0, 0, 0, 0)")
    await expect.poll(() => worlds.nth(1).evaluate((row) => getComputedStyle(row).borderTopColor)).toBe("rgb(255, 255, 255)")
    await bothSizes("home-keyboard")
    await page.keyboard.press("ArrowUp")
    await page.keyboard.press("ArrowUp")
    expect(await inFocus(".mm-world:nth-child(3)"), "从第一行再往上，回到最后一行").toBe(true)
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Enter")
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await watch()

    // A sentence to copy: the box is ready to type in, and Enter copies.
    await page.getByRole("button", { name: "加一样东西", exact: true }).click()
    await page.getByRole("dialog", { name: "加一样东西", exact: true }).locator(".shelf-add-grid button").filter({ hasText: "生物" }).first().click()
    const tell = page.getByRole("dialog", { name: "加一个生物", exact: true })
    const wish = tell.getByLabel("补一句想要什么样", { exact: true })
    await expect(wish).toBeFocused()
    await page.keyboard.type("一只彩虹小鸡")
    await page.keyboard.press("Enter")
    await expect(tell.getByText("已复制", { exact: false })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(tell).toHaveCount(0)

    // The making: what is on screen is not rebuilt once a second, and looking back says so.
    await connect()
    await expect(page.locator("[data-presence=connected]")).toBeVisible()
    const first = (await call<ExternalStartResult>("plan_run", { projectId, expectedRevision: (await call<{ project: { revision: number } }>("open_project", { projectId })).value.project.revision, prompt: "做一只彩虹小鸡的模型", plan: { summary: "彩虹小鸡", questions: [], tasks: [{ key: "chick", module: "model", title: MODEL, prompt: "做一只彩虹小鸡的模型", source: "做一只彩虹小鸡的模型", dependencies: [], target_id: null }] } })).value
    const ids = { projectId, runId: first.run.id, taskId: first.run.tasks[0]!.id }
    const assetId = first.run.tasks[0]!.asset_id
    await call("claim_task", ids)
    await expect(page.locator("[data-presence=working]")).toBeVisible()
    await page.getByRole("button", { name: /^打开动态/ }).click().catch(() => undefined)
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).click()
    const live = page.getByTestId("making-live")
    await expect(live).toBeVisible({ timeout: 30000 })
    await write(ids, order.slice(0, 3), "正在搭第 3 块")
    await write(ids, order.slice(0, 4), "正在搭第 4 块")

    await page.getByRole("button", { name: "回放过程", exact: true }).focus()
    await live.locator(".ml-road .pa-stop").first().evaluate((stop) => (stop.dataset.mark = "same"))
    await write(ids, order.slice(0, 5), "正在搭第 5 块")
    await page.waitForTimeout(2200)
    await expect(page.getByRole("button", { name: "回放过程", exact: true }), "轮询和写入都不会冲掉焦点").toBeFocused()
    expect(await live.locator(".ml-road .pa-stop").first().getAttribute("data-mark"), "没变的那一行不会被重建").toBe("same")

    const slider = live.locator('[role="slider"]')
    await slider.focus()
    await page.keyboard.press("Home")
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "true")
    await expect(slider).toHaveAttribute("aria-valuetext", /第 1 步，共 \d+ 步/)
    await expect(live.locator(".ml-past")).toContainText("AI 还在往下做")
    await expect(page.getByRole("button", { name: /跟着 AI 看/ })).toHaveAttribute("aria-pressed", "false")
    await expect(live.locator(".ml-thinking b")).toHaveText("这一步")
    await bothSizes("making-past")
    await live.getByRole("button", { name: "回到最新", exact: true }).click()
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "false")
    await expect(live.locator(".ml-past")).toHaveCount(0)
    await slider.focus()
    await page.keyboard.press("ArrowLeft")
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "true")
    await page.keyboard.press("End")
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "false")

    // Gone away, nobody is thinking.
    process.kill(transport!.pid!)
    await expect(live.locator(".ml-thinking")).toHaveAttribute("data-state", "fail", { timeout: 8000 })
    await expect(live.locator(".ml-thinking")).toContainText("回你的 AI 窗口")
    await bothSizes("making-disconnected")
    await client!.close().catch(() => undefined)
    await connect()
    await expect(live.locator(".ml-thinking")).not.toHaveAttribute("data-state", "fail")

    // The task moving through its states is news to the floor, not a reason to start the page over: its list of things and its log stay on screen.
    await page.evaluate(() => {
      const holder = window as unknown as { floor: { log: string[]; last: string } }
      holder.floor = { log: [], last: "" }
      const look = () => {
        const rows = [...document.querySelectorAll<HTMLElement>(".mf-row[data-row]")].map((row) => row.querySelector("strong")?.textContent ?? row.textContent?.slice(0, 8) ?? "").join("|")
        if (rows !== holder.floor.last) {
          holder.floor.last = rows
          holder.floor.log.push(`${Math.round(performance.now())} ${rows}`)
        }
        requestAnimationFrame(look)
      }
      new MutationObserver(look).observe(document.querySelector(".mf-main")!.parentElement!, { childList: true, subtree: true })
      look()
    })
    await finish(ids, piece(order))
    await sawToast("进度达成！开工大吉")
    const floorRows = await page.evaluate(() => (window as unknown as { floor: { log: string[] } }).floor.log)
    evidence.floorRows = floorRows
    expect(floorRows.filter((rows) => !rows.includes("外部 AI 的调用")), "任务状态变化时制作现场的列表不闪空").toEqual([])

    // A second version, for something to compare with and go back to.
    const opened = (await call<{ project: { revision: number } }>("open_project", { projectId })).value
    const second = (await call<ExternalStartResult>("plan_run", { projectId, expectedRevision: opened.project.revision, prompt: "翅膀再大一点", plan: { summary: "第二版", questions: [], tasks: [{ key: "chick2", module: "model", title: MODEL, prompt: "翅膀再大一点", source: "翅膀再大一点", dependencies: [], target_id: assetId }] } })).value
    const secondIds = { projectId, runId: second.run.id, taskId: second.run.tasks[0]!.id }
    await call("claim_task", secondIds)
    const full = piece(order)
    const grown = full.bones.findIndex((bone) => bone.cubes.length)
    const bigger = { ...full, bones: full.bones.map((bone, index) => (index !== grown ? bone : { ...bone, cubes: bone.cubes.map((cube, at) => (at ? cube : { ...cube, size: [cube.size[0] + 1, cube.size[1], cube.size[2]] as typeof cube.size })) })) }
    await finish(secondIds, bigger)
    const history = () => page.evaluate((input) => window.studio.getMakingHistory(input), { projectId, assetId })
    const waiting = () => page.evaluate(async (id) => (await window.studio.getProjectOverview({ projectId: id })).production?.to_review ?? 0, projectId)
    await expect.poll(async () => (await history()).versions.length).toBe(2)

    await page.getByRole("button", { name: "模组总览", exact: true }).click()
    const openCard = async () => {
      await page.locator('.inv-slot[data-kind="model"][data-item]').filter({ hasText: MODEL }).first().click()
      await page.getByRole("dialog", { name: MODEL, exact: true }).getByRole("tab", { name: "制作过程", exact: true }).click()
    }
    const slot = page.locator('.inv-slot[data-kind="model"][data-item]').filter({ hasText: MODEL }).first()
    await slot.focus()
    await openCard()
    const card = page.getByRole("dialog", { name: MODEL, exact: true })
    await expect(card.locator(".mh-version")).toHaveCount(2)

    // The keyboard stays inside the card.
    for (let press = 0; press < 30; press++) {
      await page.keyboard.press("Tab")
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), `第 ${press + 1} 次 Tab 还在卡片里`).toBe(true)
    }

    const stage = card.getByTestId("history-now")
    const marks = card.locator(".mh-marks")
    const box = card.getByRole("textbox", { name: /想怎么改/ })
    const circle = card.getByRole("button", { name: "圈一下", exact: true })
    const draw = async (from: [number, number], to: [number, number]) => {
      const place = await stage.boundingBox()
      await page.mouse.move(place!.x + place!.width * from[0], place!.y + place!.height * from[1])
      await page.mouse.down()
      await page.mouse.move(place!.x + place!.width * to[0], place!.y + place!.height * to[1], { steps: 6 })
      await page.mouse.up()
    }
    const showing = (count: number) => expect(marks).toHaveAttribute("aria-label", `图上的批注：看得见 ${count} 条`)

    // Escape takes back one thing at a time, and a note with words in it asks first.
    await circle.click()
    await expect(card.locator(".mh-tool-hint")).toContainText("按 Esc")
    await draw([0.35, 0.3], [0.6, 0.6])
    await box.fill("写到一半")
    await page.keyboard.press("Escape")
    await expect(card, "Esc 不关窗").toBeVisible()
    await expect(box, "Esc 不丢内容").toHaveValue("写到一半")
    await expect(card.getByText("再按一次 Esc", { exact: false })).toBeVisible()
    await bothSizes("history-compose-esc")
    await page.keyboard.press("Escape")
    await expect(box).toHaveCount(0)
    await expect(card).toBeVisible()
    await expect(circle).toHaveAttribute("aria-pressed", "true")
    await expect(circle, "放弃后焦点回到工具").toBeFocused()
    await page.keyboard.press("Escape")
    await expect(circle).toHaveAttribute("aria-pressed", "false")
    await expect(card).toBeVisible()

    // Only pressed, not drawn: not a note.
    await circle.click()
    await draw([0.5, 0.5], [0.5, 0.5])
    await expect(box).toHaveCount(0)

    // Leaving with a note in hand asks; staying keeps it.
    await draw([0.35, 0.3], [0.6, 0.6])
    await box.fill("还没记下")
    await card.getByRole("tab", { name: "成品", exact: true }).click()
    await expect(page.getByText("还有没保存的修改", { exact: true })).toBeVisible()
    await page.getByRole("button", { name: "留在这里", exact: true }).click()
    await expect(box).toHaveValue("还没记下")
    await card.getByRole("button", { name: "算了", exact: true }).click()
    await expect(box).toHaveCount(0)

    // A note from this angle; turned away it stands aside; a tool out does not turn the view back; a note from there.
    await draw([0.35, 0.3], [0.6, 0.6])
    await box.fill("第一条：这个角度")
    await page.keyboard.press("Control+Enter")
    await expect(card.locator('.mh-note[data-note="1"]')).toContainText("第一条：这个角度")
    await expect(circle, "记下后焦点回到工具").toBeFocused()
    await showing(1)
    await circle.click()
    const canvas = stage.locator("canvas")
    await canvas.focus()
    for (let press = 0; press < 4; press++) await page.keyboard.press("ArrowRight")
    await expect(card, "方向键转模型，不换下一样").toBeVisible()
    await showing(0)
    await expect(card.locator(".mh-turn-back")).toContainText("还有 1 条")
    await circle.click()
    await showing(0)
    await draw([0.3, 0.4], [0.55, 0.7])
    await box.fill("第二条：转过以后")
    await card.getByRole("button", { name: "记下这一条", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="2"]')).toContainText("第二条：转过以后")
    await showing(1)
    await circle.click()
    await card.locator(".mh-turn-back").click()
    await showing(1)
    await expect(card.locator(".mh-turn-back")).toContainText("还有 1 条")

    // Side by side: the view keeps its angle, so the marks stay.
    const beforeSide = await marks.getAttribute("viewBox")
    await card.locator('.mh-version[data-version="1"]').click()
    await expect(card.getByTestId("history-old").locator("canvas")).toBeVisible()
    await expect.poll(() => marks.getAttribute("viewBox")).not.toBe(beforeSide)
    await showing(1)
    await bothSizes("history-side-by-side-marks")

    // Enter does not pass over notes not handed over.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press("Enter")
    await page.waitForTimeout(400)
    expect(await waiting(), "有未交批注时回车不通过验收").toBe(1)

    // Going back is said, and is one first however many times it is done.
    await card.getByRole("button", { name: "回到第 1 版", exact: true }).click()
    await expect(card.locator(".mh-version")).toHaveCount(3)
    const toast = await page.locator(".adv-toast").boundingBox().catch(() => null)
    const close = await card.getByRole("button", { name: "关闭", exact: true }).first().boundingBox()
    if (toast && close) expect(toast.y + toast.height <= close.y || toast.x >= close.x + close.width, "提示不挡验收卡的关闭按钮").toBe(true)
    await sawToast("进度达成！后悔药")
    await card.locator('.mh-version[data-version="2"]').click()
    await card.getByRole("button", { name: "回到第 2 版", exact: true }).click()
    await expect(card.locator(".mh-version")).toHaveCount(4)
    await showing(1)

    // Clearing asks, with the number. One taken away can be taken back for a few seconds, and then it is gone.
    await card.getByRole("button", { name: "清掉我标的", exact: true }).click()
    const ask = page.getByRole("alertdialog", { name: "清掉 2 条还没交的批注？", exact: true })
    await expect(ask).toBeVisible()
    await bothSizes("history-clear-ask")
    await ask.getByRole("button", { name: "先留着", exact: true }).click()
    await expect(card.locator(".mh-note")).toHaveCount(2)
    await card.getByRole("button", { name: "删掉第 2 条", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="2"]')).toHaveCount(0)
    const undo = card.getByRole("button", { name: "撤销", exact: true })
    await expect(undo).toBeFocused()
    await bothSizes("history-undo")
    await page.keyboard.press("Enter")
    await expect(card.locator('.mh-note[data-note="2"]')).toBeVisible()
    await page.waitForTimeout(5400)
    expect((await history()).notes.map((note) => note.id), "撤销之后不会被定时器删掉").toEqual([1, 2])
    await card.getByRole("button", { name: "删掉第 2 条", exact: true }).click()
    await expect.poll(async () => (await history()).notes.map((note) => note.id), { timeout: 8000 }).toEqual([1])
    await expect(undo).toHaveCount(0)

    // Comparing is over. From another angle again, by keyboard alone: Enter on the picture marks its middle.
    await expect(card.getByTestId("history-old"), "回到旧版以后并排比就结束了").toHaveCount(0)
    await canvas.focus()
    for (let press = 0; press < 4; press++) await page.keyboard.press("ArrowLeft")
    await circle.click()
    await marks.focus()
    await page.keyboard.press("Enter")
    await expect(box).toBeFocused()
    await page.keyboard.type("第三条：只用键盘标的")
    await page.keyboard.press("Control+Enter")
    await expect(card.locator('.mh-note[data-note="3"]')).toContainText("只用键盘标的")
    await circle.click()

    // Handed to an outside AI: what comes next is said where it is being looked at. The picture holds the marks of one angle; the words hold them all.
    await card.getByRole("button", { name: "把 2 条批注交给 AI", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="1"]')).toContainText("已记下，等 AI 领")
    await expect(card.locator(".pa-verdict-ask")).toContainText("继续")
    await sawToast("进度达成！指点江山")
    await bothSizes("history-next-step")
    if (await circle.isEnabled()) await circle.click()
    const batch = (await call<ExternalStartResult>("next_batch", { projectId })).value
    const task = batch.run.tasks.find((value) => value.asset_id === assetId)!
    const redoIds = { projectId, runId: batch.run.id, taskId: task.id }
    const claim = await call<ExternalTaskContext & { annotation: ModelAnnotationContext; notes: { number: number; says: string }[] }>("claim_task", redoIds)
    expect(claim.value.annotation.annotations.map((mark) => mark.note), "图上只画同一角度的标记").toEqual([1])
    expect(claim.value.notes.map((value) => value.number), "两条的文字都带给 AI").toEqual([1, 3])
    expect(claim.content.some((item) => item.type === "image"), "批注的图交给了 AI").toBe(true)
    evidence.handedOver = { annotation: claim.value.annotation.annotations, notes: claim.value.notes }

    // The AI took it: the tool does not stay over the view.
    await expect(circle).toBeDisabled({ timeout: 20000 })
    await expect(marks).not.toHaveClass(/drawing/)
    await expect(circle).toHaveAttribute("title", /.+/)
    await expect(card.locator('.mh-note[data-note="1"]'), "领走以后不再说等 AI 领").toContainText("已交给 AI")

    await page.keyboard.press("Escape")
    await expect(card, "Esc 这时才关窗").toHaveCount(0)
    await expect(slot, "关窗后焦点回到打开它的格子").toBeFocused()

    const answer = { ...bigger, bones: bigger.bones.map((bone, index) => (index !== grown ? bone : { ...bone, cubes: bone.cubes.map((cube, at) => (at ? cube : { ...cube, size: [cube.size[0], cube.size[1] + 1, cube.size[2]] as typeof cube.size })) })) }
    await finish(redoIds, answer)
    await expect.poll(async () => (await history()).notes.map((value) => value.status)).toEqual(["fixed", "fixed"])
    await expect.poll(waiting).toBe(1)

    // Nothing left in hand: Enter passes it, with the orbs and the first.
    await page.getByRole("button", { name: "模组总览", exact: true }).click().catch(() => undefined)
    await openCard()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    const orbsBefore = (await seen()).orbs
    await page.keyboard.press("Enter")
    await expect.poll(waiting).toBe(0)
    await expect.poll(async () => (await seen()).orbs, { message: "通过时飞出经验球" }).toBeGreaterThan(orbsBefore)
    await sawToast("进度达成！验货通过")
    await expect.poll(() => page.locator(".xp-orb").count(), { message: "经验球飞完就没了" }).toBe(0)
    await page.keyboard.press("Escape").catch(() => undefined)

    // Mining the block in the title bar goes nowhere; a plain press goes home.
    const block = await page.locator(".brand-mark").boundingBox()
    await page.mouse.move(block!.x + block!.width / 2, block!.y + block!.height / 2)
    await page.mouse.down()
    await expect.poll(() => page.locator(".brand-mark").evaluate((mark) => mark.style.getPropertyValue("--crack"))).not.toBe("")
    await expect(page.locator(".mined-drop"), "挖碎后掉出小方块").toBeVisible({ timeout: 3000 })
    await page.mouse.up()
    await expect(page.locator(".mined-drop")).toHaveCount(0, { timeout: 3000 })
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true }), "挖方块不会跳走").toBeVisible()
    await expect.poll(() => page.locator(".brand-mark").evaluate((mark) => mark.style.visibility)).toBe("")

    // Sounds: not one until asked for, and the audio system not touched either.
    expect((await seen()).audio, "音效默认关，没开过就不创建音频").toBe(0)
    await page.getByRole("button", { name: "个人设置", exact: true }).click()
    await expect(page.getByRole("heading", { name: "个人设置", exact: true })).toBeVisible()
    const sound = page.getByRole("checkbox", { name: "音效", exact: true })
    await expect(sound).not.toBeChecked()
    await sound.scrollIntoViewIfNeeded()
    await bothSizes("settings-sound")
    await sound.check()
    await expect.poll(() => page.evaluate(async () => (await window.studio.getSettings()).sounds)).toBe(true)
    await page.getByRole("button", { name: "个人设置", exact: true }).click()
    await expect.poll(async () => (await seen()).audio, { message: "打开后按按钮才创建音频" }).toBe(1)

    // Each first was said once, and what has not happened was not said.
    const told = (await seen()).toasts.filter((head) => head.startsWith("进度达成"))
    evidence.firsts = told
    expect([...told].sort()).toEqual(["进度达成！开工大吉", "进度达成！后悔药", "进度达成！指点江山", "进度达成！验货通过"].sort())
    const stored = JSON.parse(await readFile(path.join(created.directory, ".minemods", "making", "advancements.json"), "utf8")) as { earned: string[] }
    expect([...stored.earned].sort()).toEqual(["accepted", "handed", "made", "restored"])

    // Less motion, from Studio's own setting: everything holds still, and everything still happens.
    const calmly = page.getByRole("checkbox", { name: "减少动效", exact: true })
    await calmly.check()
    await expect(page.locator(".studio-root")).toHaveClass(/reduce-motion/)
    await expect.poll(() => page.evaluate(async () => (await window.studio.getSettings()).reducedMotion)).toBe(true)
    // A project of its own: its firsts are its own. The record is per project, and Studio is read anew with the setting already on.
    const calmProject = await page.evaluate(() => window.studio.createProject({ name: "安静工程", description: "", modId: "p3_calm", empty: true }))
    await page.reload()
    await expect(page.locator(".studio-root")).toHaveClass(/reduce-motion/)
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    const moved = () =>
      page.evaluate(() => ({
        stone: getComputedStyle(document.querySelector('.studio-root[data-page="home"]')!, "::before").animationName,
        logo: getComputedStyle(document.querySelector(".mm-logo-face")!).animationName,
        splash: getComputedStyle(document.querySelector(".mm-splash")!).animationName,
      }))
    expect(await moved(), "应用内减少动效时首页全部静止").toEqual({ stone: "none", logo: "none", splash: "none" })
    const calmSaid = await splash.textContent()
    await splash.click({ force: true })
    await expect(splash).not.toHaveText(calmSaid!)
    expect(await splash.getAttribute("class")).not.toContain("pop")
    await bothSizes("home-calm")

    await worlds.first().click()
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await watch()
    const calmId = calmProject.project.id
    const third = (await call<ExternalStartResult>("plan_run", { projectId: calmId, expectedRevision: (await call<{ project: { revision: number } }>("open_project", { projectId: calmId })).value.project.revision, prompt: "再做一只", plan: { summary: "安静的一只", questions: [], tasks: [{ key: "chick3", module: "model", title: MODEL, prompt: "再做一只", source: "再做一只", dependencies: [], target_id: null }] } })).value
    const thirdIds = { projectId: calmId, runId: third.run.id, taskId: third.run.tasks[0]!.id }
    await call("claim_task", thirdIds)
    await finish(thirdIds, piece(order))
    // Changed on request is what waits for a verdict, as it did in the first project.
    const fourth = (await call<ExternalStartResult>("plan_run", { projectId: calmId, expectedRevision: (await call<{ project: { revision: number } }>("open_project", { projectId: calmId })).value.project.revision, prompt: "翅膀再大一点", plan: { summary: "第二版", questions: [], tasks: [{ key: "chick4", module: "model", title: MODEL, prompt: "翅膀再大一点", source: "翅膀再大一点", dependencies: [], target_id: third.run.tasks[0]!.asset_id }] } })).value
    const fourthIds = { projectId: calmId, runId: fourth.run.id, taskId: fourth.run.tasks[0]!.id }
    await call("claim_task", fourthIds)
    await finish(fourthIds, bigger)
    const waitingCalm = () => page.evaluate(async (id) => (await window.studio.getProjectOverview({ projectId: id })).production?.to_review ?? 0, calmId)
    await expect.poll(waitingCalm).toBe(1)
    await sawToast("进度达成！开工大吉")
    await page.getByRole("button", { name: "模组总览", exact: true }).click().catch(() => undefined)
    await page.locator('.inv-slot[data-kind="model"][data-item]').filter({ hasText: MODEL }).first().click()
    await expect(page.getByRole("dialog", { name: MODEL, exact: true })).toBeVisible()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press("Enter")
    await expect.poll(waitingCalm).toBe(0)
    await sawToast("进度达成！验货通过")
    expect((await seen()).orbs, "减少动效时不飞经验球").toBe(0)
    await page.keyboard.press("Escape").catch(() => undefined)

    const calmBlock = await page.locator(".brand-mark").boundingBox()
    await page.mouse.move(calmBlock!.x + calmBlock!.width / 2, calmBlock!.y + calmBlock!.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(1200)
    expect(await page.locator(".mined-drop").count(), "减少动效时不挖").toBe(0)
    await page.mouse.up()
    await expect(page.getByRole("heading", { name: "MineMods", exact: true }), "这一按还是回首页").toBeVisible()
    evidence.seen = await seen()
  } finally {
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ ...evidence, errors }, null, 2))
    await page.screenshot({ path: path.join(directory, "final.png") }).catch(() => undefined)
    await client?.close().catch(() => undefined)
    await app.close()
  }
  expect(errors).toEqual([])
})

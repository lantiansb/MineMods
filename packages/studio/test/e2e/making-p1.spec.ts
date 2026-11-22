import { expect, test, _electron } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ModelAnnotationContext } from "@minemods/studio-ai/model-annotation"
import type { ExternalStartResult, ExternalTaskContext } from "../../src/external"
import { modelFixture } from "./model-fixture"

/**
 * P1「验收 2」: a real packaged app, a real stdio MCP process, and a local deterministic collaborator writing a creature's model piece by piece.
 * It proves the protocol, the screen and the storage; it says nothing of a live model's quality.
 */
const SIZES = [[1366, 768], [1920, 1080]] as const
const MODEL = "彩虹小鸡模型"

test("P1 正式包：分步写模型、预览台跟随、时间轴回放、两版并排比、回到旧版、批注交给 AI 后标已改", async () => {
  const root = path.resolve("../../.artifacts/studio")
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, "p1-"))
  await mkdir(path.join(directory, "screens"))
  const app = await _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE!, args: [`--user-data-dir=${path.join(directory, "electron")}`], env: { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "" } })
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  const evidence: Record<string, unknown> = { fixture: "local deterministic MCP collaborator; no live model quality claim", directory }
  let client: Client | undefined
  let transport: StdioClientTransport | undefined
  const shot = (name: string) => page.screenshot({ path: path.join(directory, "screens", `${name}.png`), animations: "disabled", scale: "css" })
  const size = async (width: number, height: number) => {
    // The window pictures are drawn in for a look is a window too: this is the one with the page.
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows().find((window) => /index\.html/.test(window.webContents.getURL()))!.setContentSize(value[0], value[1]), [width, height])
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
  }
  const bothSizes = async (name: string, then?: (width: number) => Promise<void>) => {
    for (const [width, height] of SIZES) {
      await size(width, height)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `${name} 在 ${width} 下不能横向滚动` }).toBe(true)
      await page.waitForTimeout(250)
      await shot(`${width}-${name}`)
      await then?.(width)
    }
    await size(1366, 768)
  }
  const connect = async () => {
    const configuration = await page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
    transport = new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" })
    client = new Client({ name: "p1-collaborator", version: "1" })
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
  const piece = (names: string[]) => {
    const bones = design.bones.filter((bone) => names.includes(bone.name))
    // A draft has to be a model all the way through: the motions it must have are there from the start, moving only what has been built so far.
    return { ...design, bones, animations: design.animations.flatMap((animation) => {
      const channels = animation.channels.filter((channel) => names.includes(channel.bone))
      return channels.length || ["idle", "walk", "hurt"].includes(animation.name) ? [{ ...animation, channels }] : []
    }) }
  }
  const order = (() => {
    const placed: string[] = []
    const left = design.bones.map((bone) => bone.name)
    while (left.length) {
      const next = left.findIndex((name) => { const parent = design.bones.find((bone) => bone.name === name)!.parent; return !parent || placed.includes(parent) })
      placed.push(...left.splice(next < 0 ? 0 : next, 1))
    }
    return placed
  })()
  const sheet = (subject: string) => ({
    subject, recognisable: ["圆头", "四只脚"], assumed: [],
    parts: design.bones.map((bone) => ({ name: bone.name, what: `小鸡的${bone.name}`, shape: "按现有立方体", attaches: bone.parent ? `接在 ${bone.parent}` : "根", surface: "沿用现有颜色", moves: "跟着动作动", assumed: false })),
  })
  const finish = async (ids: { projectId: string; runId: string; taskId: string }, document: unknown) => {
    await call("save_sheet", { ...ids, sheet: sheet("一只彩虹小鸡的模型") })
    const looked = await call<{ findings: string[] }>("look", { ...ids, document })
    evidence.lookFindings = looked.value.findings
    await call("self_review", { ...ids, matches: ["部件齐了。"], problems: [], next: [], verdict: "done" })
    const review = await call<{ blind_first?: boolean }>("final_review", ids)
    if (review.value.blind_first) await call("final_review", { ...ids, blind: { sees: "一个有头和脚的小动物", also: [], because: "确定性测试协作者的回答，不作为真实评审证据。" } })
    await call("final_review", { ...ids, verdict: { passed: true, findings: [], advice: [], independent: false, ...(review.value.blind_first ? { fits: "at_once" } : {}) } })
    await call("commit_task", { ...ids, document })
  }
  // A write the screen must follow within a second: from the answer of the call to the stage standing on that step.
  const seqOf = () => page.locator(".ml-stage").getAttribute("data-seq").then((value) => Number(value ?? 0))
  const write = async (ids: Record<string, unknown>, names: string[], detail?: string) => {
    const before = await seqOf()
    await call("update_task", { ...ids, draft: piece(names), progress: Math.round((names.length / order.length) * 100), ...(detail ? { detail } : {}) })
    const start = Date.now()
    await expect.poll(seqOf, { timeout: 5000, intervals: [25] }).not.toBe(before)
    return Date.now() - start
  }
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    evidence.application = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, executable: process.execPath }))
    const created = await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      return window.studio.createProject({ name: "周末彩虹乐园", description: "一只彩虹小鸡", modId: "p1_rainbow", empty: true })
    })
    const projectId = created.project.id
    await size(1366, 768)
    await page.reload()
    await page.locator(".project-card").filter({ hasText: created.project.name }).click()
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()

    // C2: every kind can be pressed, and what cannot be filled in here gives a sentence to copy.
    await page.getByRole("button", { name: "加一样东西", exact: true }).click()
    const adding = page.getByRole("dialog", { name: "加一样东西", exact: true })
    await expect(adding.locator(".shelf-add-grid button:enabled")).toHaveCount(11)
    await expect(adding.getByRole("button", { name: "声音", exact: true })).toBeEnabled()
    await expect(adding.getByRole("button", { name: "粒子", exact: true })).toBeEnabled()
    await adding.locator(".shelf-add-grid button").filter({ hasText: "生物" }).first().click()
    const tell = page.getByRole("dialog", { name: "加一个生物", exact: true })
    await tell.getByLabel("补一句想要什么样", { exact: true }).fill("一只彩虹小鸡")
    await tell.getByRole("button", { name: "复制给我的 AI", exact: true }).click()
    await expect(tell.getByText("已复制", { exact: false })).toBeVisible()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("在『周末彩虹乐园』里加一个生物：一只彩虹小鸡")
    await bothSizes("add-mcp-copy")
    await page.keyboard.press("Escape")
    await expect(tell).toHaveCount(0)

    // The first version, written piece by piece.
    await connect()
    await expect(page.locator("[data-presence=connected]")).toBeVisible()
    const first = (await call<ExternalStartResult>("plan_run", { projectId, expectedRevision: (await call<{ project: { revision: number } }>("open_project", { projectId })).value.project.revision, prompt: "做一只彩虹小鸡的模型", plan: { summary: "彩虹小鸡", questions: [], tasks: [{ key: "chick", module: "model", title: MODEL, prompt: "做一只彩虹小鸡的模型", source: "做一只彩虹小鸡的模型", dependencies: [], target_id: null }] } })).value
    const ids = { projectId, runId: first.run.id, taskId: first.run.tasks[0]!.id }
    const assetId = first.run.tasks[0]!.asset_id
    await call("claim_task", ids)
    await expect(page.locator("[data-presence=working]")).toBeVisible()
    await page.getByRole("button", { name: /^打开动态/ }).click().catch(() => undefined)
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).click()
    await expect(page.getByTestId("making-live")).toBeVisible({ timeout: 30000 })
    const latencies: number[] = []
    const half = Math.max(4, Math.floor(order.length / 2))
    // The motions a model must have each move at least one part, so a first draft has three pieces.
    for (let count = 3; count <= half; count++) latencies.push(await write(ids, order.slice(0, count), `正在搭第 ${count} 块：${order[count - 1]}`))
    evidence.refreshMs = latencies
    for (const value of latencies) expect(value, "写入后预览台 1 秒内刷新").toBeLessThan(1000)
    await expect(page.getByTestId("making-live").locator(".ml-thinking")).toContainText(`正在搭第 ${half} 块`)
    // No list of parts yet: its name, and no number.
    await expect(page.getByTestId("making-part")).not.toContainText("共")
    await call("save_sheet", { ...ids, sheet: sheet("一只彩虹小鸡的模型") })
    latencies.push(await write(ids, order.slice(0, half + 1)))
    await expect(page.getByTestId("making-part")).toContainText(`共 ${order.length} 块`)
    await expect(page.locator('.ml-road [data-stop="shape"]')).toHaveAttribute("data-state", "now")
    await expect(page.locator(".ml-ticks i[data-kind=write]")).toHaveCount(half - 1)
    await bothSizes("making-writing")

    // Walking back and playing it again.
    await page.getByRole("button", { name: "回放过程", exact: true }).click()
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "true")
    await bothSizes("making-replay")
    await page.getByRole("button", { name: "停止回放", exact: true }).click()
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "false")
    const ticks = await page.locator(".ml-ticks").boundingBox()
    await page.mouse.click(ticks!.x + 6, ticks!.y + ticks!.height / 2)
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "true")
    await expect(page.locator(".ml-count")).toContainText("正在看第 1 步")
    const stayed = await page.locator(".ml-ticks").boundingBox()
    expect(stayed, "时间轴不会因为文字变化而挪位").toEqual(ticks)
    await page.mouse.click(ticks!.x + ticks!.width - 3, ticks!.y + ticks!.height / 2)
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-replaying", "false")

    // C1: the 动态 line and the connection say the same. The floor keeps the panel away: it is read on the overview.
    await page.getByRole("button", { name: "模组总览", exact: true }).click()
    const activity = page.locator(`.ac-thing[data-item]`).filter({ hasText: MODEL }).first()
    await expect(activity).toBeVisible()
    await expect(activity.locator(".ac-now-text")).not.toHaveAttribute("data-presence", /.+/)
    await bothSizes("activity-working")
    await expect(page.locator("[data-presence=idle]")).toBeVisible({ timeout: 50000 })
    await expect(activity.locator(".ac-now-text")).toHaveText("超过 45 秒没动静")
    await bothSizes("activity-idle")
    process.kill(transport!.pid!)
    await expect(page.locator("[data-presence=disconnected]")).toBeVisible({ timeout: 5000 })
    await expect(activity.locator(".ac-now-text")).toHaveText("断开了，已交来的已存好")
    await bothSizes("activity-disconnected")
    await client!.close().catch(() => undefined)
    await connect()
    await expect(page.locator("[data-presence=disconnected]")).toHaveCount(0)
    await expect(activity.locator(".ac-now-text")).not.toHaveText("断开了，已交来的已存好")
    await bothSizes("activity-restored")

    await finish(ids, piece(order))
    await expect.poll(async () => (await page.evaluate((input) => window.studio.getMakingHistory(input), { projectId, assetId })).versions.length).toBe(1)

    // The second version, smaller at first: what the first one had and this has not got to stands as a ghost, which is known to be real.
    const opened = (await call<{ project: { revision: number } }>("open_project", { projectId })).value
    const second = (await call<ExternalStartResult>("plan_run", { projectId, expectedRevision: opened.project.revision, prompt: "翅膀再大一点", plan: { summary: "第二版", questions: [], tasks: [{ key: "chick2", module: "model", title: MODEL, prompt: "翅膀再大一点", source: "翅膀再大一点", dependencies: [], target_id: assetId }] } })).value
    const secondIds = { projectId, runId: second.run.id, taskId: second.run.tasks[0]!.id }
    await call("claim_task", secondIds)
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).click()
    await expect(page.getByTestId("making-live")).toBeVisible({ timeout: 30000 })
    await write(secondIds, order.slice(0, 3), "第二版先搭身子")
    await expect(page.locator(".ml-stage")).toHaveAttribute("data-ghosts", String(order.length - 3))
    await bothSizes("making-second-version")
    // A version really different from the first: one bone a little larger.
    const full = piece(order)
    const grown = full.bones.findIndex((bone) => bone.cubes.length)
    const bigger = { ...full, bones: full.bones.map((bone, index) => (index !== grown ? bone : { ...bone, cubes: bone.cubes.map((cube, at) => (at ? cube : { ...cube, size: [cube.size[0] + 1, cube.size[1], cube.size[2]] as typeof cube.size })) })) }
    await finish(secondIds, bigger)
    const history = () => page.evaluate((input) => window.studio.getMakingHistory(input), { projectId, assetId })
    await expect.poll(async () => (await history()).versions.length).toBe(2)
    evidence.versionsAfterSecond = (await history()).versions.map((value) => ({ version: value.version, by: value.by, revision: value.revision }))
    expect((await history()).versions.map((value) => value.by)).toEqual(["ai", "ai"])

    // 验收窗「制作过程」: the entry is the one that was there.
    await page.getByRole("button", { name: "模组总览", exact: true }).click()
    await page.locator('.inv-slot[data-kind="model"][data-item]').filter({ hasText: MODEL }).first().click()
    const card = page.getByRole("dialog", { name: MODEL, exact: true })
    await card.getByRole("tab", { name: "制作过程", exact: true }).click()
    await expect(card.locator(".mh-version")).toHaveCount(2)
    await expect(card.locator('.mh-version[aria-current="true"]')).toContainText("第 2 版 · 现在")
    await expect(card.getByRole("button", { name: "回到第 1 版", exact: true })).toHaveCount(0)

    // Side by side, turning together.
    await card.locator('.mh-version[data-version="1"]').click()
    await expect(card.getByTestId("history-old").locator("canvas")).toBeVisible()
    await expect(card.getByTestId("history-now").locator("canvas")).toBeVisible()
    const turn = async (side: string) => {
      const box = await card.getByTestId(side).locator("canvas").boundingBox()
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
      await page.mouse.down()
      await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y + box!.height / 2 + 10, { steps: 6 })
      await page.mouse.up()
    }
    await turn("history-old")
    await expect(card.locator(".mh-stages")).toHaveAttribute("data-link", "old")
    await turn("history-now")
    await expect(card.locator(".mh-stages")).toHaveAttribute("data-link", "now")
    await bothSizes("history-compare")

    // Stepping back is a new version, and says so before it is pressed.
    await expect(card.getByText("另存成第 3 版，现在的第 2 版还在", { exact: true })).toBeVisible()
    await card.getByRole("button", { name: "回到第 1 版", exact: true }).click()
    await expect(card.locator(".mh-version")).toHaveCount(3)
    await expect(card.locator('.mh-version[aria-current="true"]')).toContainText("第 3 版 · 现在")
    await expect(card.locator('.mh-version[data-version="2"]')).toContainText("第 2 版 · AI")
    const stepped = (await history()).versions
    expect(stepped.at(-1)).toMatchObject({ version: 3, by: "restored", from: 1, current: true })
    expect(JSON.stringify(stepped[2]!.document)).toBe(JSON.stringify(stepped[0]!.document))
    expect(JSON.stringify(stepped[1]!.document)).not.toBe(JSON.stringify(stepped[0]!.document))
    await bothSizes("history-restored")

    // Two notes pinned on the view, and one on a frame of a motion.
    const draw = async (from: [number, number], to: [number, number]) => {
      const box = await card.getByTestId("history-now").boundingBox()
      await page.mouse.move(box!.x + box!.width * from[0], box!.y + box!.height * from[1])
      await page.mouse.down()
      await page.mouse.move(box!.x + box!.width * to[0], box!.y + box!.height * to[1], { steps: 6 })
      await page.mouse.up()
    }
    await card.getByRole("button", { name: "圈一下", exact: true }).click()
    await draw([0.35, 0.3], [0.6, 0.6])
    await card.getByRole("textbox", { name: /想怎么改/ }).fill("这里再圆一点")
    await card.getByRole("button", { name: "记下这一条", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="1"]')).toContainText("这里再圆一点")
    await card.getByRole("button", { name: "画箭头", exact: true }).click()
    await draw([0.8, 0.2], [0.55, 0.4])
    await card.getByRole("textbox", { name: /想怎么改/ }).fill("这个颜色再亮一点")
    await card.getByRole("button", { name: "记下这一条", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="2"]')).toContainText("还没交给 AI")
    await card.getByRole("button", { name: "标动作的某一帧", exact: true }).click()
    await card.getByLabel("动作的哪一帧", { exact: true }).fill("0.5")
    // Above the verdict bar: the version brought back waits for a verdict, and the bar that asks for it stands over the foot of the picture.
    await draw([0.5, 0.5], [0.5, 0.5])
    await card.getByRole("textbox", { name: /想怎么改/ }).fill("这一帧脚抬高一点")
    await card.getByRole("button", { name: "记下这一条", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="3"]')).toContainText("第 10 帧")
    await card.getByRole("button", { name: "标动作的某一帧", exact: true }).click()
    await bothSizes("history-notes")

    // Notes stay on the thing: the page read anew still has them, with the same numbers.
    await page.reload()
    await page.locator(".project-card").filter({ hasText: created.project.name }).click().catch(() => undefined)
    await page.locator('.inv-slot[data-kind="model"][data-item]').filter({ hasText: MODEL }).first().click()
    await card.getByRole("tab", { name: "制作过程", exact: true }).click()
    await expect(card.locator(".mh-note")).toHaveCount(3)
    expect((await history()).notes.map((value) => value.id)).toEqual([1, 2, 3])

    // Handed to the AI through the redo that exists, with where each one points and the condition.
    await expect(card.getByLabel("只改标到的地方，别的不动", { exact: true })).toBeChecked()
    await card.getByRole("button", { name: "把 3 条批注交给 AI", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="1"]')).toContainText("已记下，等 AI 领")
    await expect(card.locator(".pa-verdict-ask")).toContainText("继续")
    const batch = (await call<ExternalStartResult>("next_batch", { projectId })).value
    const task = batch.run.tasks.find((value) => value.asset_id === assetId)!
    const redoIds = { projectId, runId: batch.run.id, taskId: task.id }
    const claim = await call<ExternalTaskContext & { annotation: ModelAnnotationContext; notes: { number: number; says: string; part: string | null; frame: { clip: string; time: number } | null }[] }>("claim_task", redoIds)
    expect(claim.value.annotation).toMatchObject({ targetId: assetId, only_marked: true })
    expect(claim.value.annotation.annotations.map((mark) => mark.note)).toEqual([1, 2, 3])
    expect(claim.value.annotation.annotations[2]!.frame).toMatchObject({ time: 0.5 })
    expect(claim.value.notes.map((value) => [value.number, value.says])).toEqual([[1, "这里再圆一点"], [2, "这个颜色再亮一点"], [3, "这一帧脚抬高一点"]])
    expect(claim.content.some((item) => item.type === "image"), "批注的图交给了 AI").toBe(true)
    expect(task.prompt + JSON.stringify(claim.value.making?.remark ?? ""), "「只改标到的地方」这个约束要带给 AI").toContain("只改标到的地方，别的不动")
    evidence.handedOver = { annotation: claim.value.annotation, notes: claim.value.notes, remark: claim.value.making?.remark ?? null }

    // The AI hands a new version in: what was handed over now says it is fixed there.
    await page.keyboard.press("Escape")
    const answer = { ...bigger, bones: bigger.bones.map((bone, index) => (index !== grown ? bone : { ...bone, cubes: bone.cubes.map((cube, at) => (at ? cube : { ...cube, size: [cube.size[0], cube.size[1] + 1, cube.size[2]] as typeof cube.size })) })) }
    await finish(redoIds, answer)
    await expect.poll(async () => (await history()).versions.length).toBe(4)
    await expect.poll(async () => (await history()).notes.map((value) => [value.status, value.fixed_version])).toEqual([["fixed", 4], ["fixed", 4], ["fixed", 4]])
    await page.getByRole("button", { name: "模组总览", exact: true }).click().catch(() => undefined)
    await page.locator('.inv-slot[data-kind="model"][data-item]').filter({ hasText: MODEL }).first().click()
    await card.getByRole("tab", { name: "制作过程", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="1"]')).toContainText("第 4 版已改")
    await bothSizes("history-fixed")
    await card.locator('.mh-note[data-note="1"]').getByRole("button", { name: "还没改好", exact: true }).click()
    await expect(card.locator('.mh-note[data-note="1"]')).toContainText("还没改好")
    await expect(card.getByRole("button", { name: "把 1 条批注交给 AI", exact: true })).toBeVisible()
    evidence.finalNotes = (await history()).notes.map((value) => ({ id: value.id, status: value.status, fixed: value.fixed_version }))
  } finally {
    await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ ...evidence, errors }, null, 2))
    await page.screenshot({ path: path.join(directory, "final.png") }).catch(() => undefined)
    await client?.close().catch(() => undefined)
    await app.close()
  }
  expect(errors).toEqual([])
})

test("没有 AI 制作记录的东西：保存过两版就有「制作过程」，只给各版（并排比、回到旧版），自动转换的一版如实标出；只有一版的没有", async () => {
  const root = path.resolve("../../.artifacts/studio")
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(path.join(root, "p1-no-making-"))
  const env = { ...process.env, MINEMODS_STUDIO_TEST: "1", MINEMODS_STUDIO_WORKSPACE: path.join(directory, "projects"), MINEMODS_STUDIO_RUNTIME: path.join(directory, "runtime"), OPENAI_API_KEY: "", OPENAI_BASE_URL: "", STUDIO_AI_URL: "", STUDIO_SERVICE_TOKEN: "" }
  const userData = `--user-data-dir=${path.join(directory, "electron")}`
  // The packaged app when one is named, as the test above; the app built from this checkout otherwise.
  const app = await (process.env.STUDIO_PACKAGED_EXECUTABLE ? _electron.launch({ executablePath: process.env.STUDIO_PACKAGED_EXECUTABLE, args: [userData], env }) : _electron.launch({ args: [process.cwd(), userData], env }))
  const page = await app.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
  try {
    await expect(page.getByRole("heading", { name: "MineMods", exact: true })).toBeVisible()
    // Two things made by hand, never by an AI: no making record. One saved twice, one once.
    const block = (name: string, hardness: number) => ({ kind: "block", identifier: name === "旧石头" ? "old_stone" : "lone_stone", name, hardness, luminance: 0, tool: "pickaxe", drop: "self", color: "#8a8a8a", texture: null }) as const
    const made = await page.evaluate(async (documents) => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "mcp" })
      const created = await window.studio.createProject({ name: "没有制作记录", description: "", modId: "p1_no_making", empty: true })
      const first = await window.studio.saveByHand({ projectId: created.project.id, expectedRevision: created.project.revision, assetId: null, changed: [], document: documents[0] })
      if (!first.ok) throw new Error(JSON.stringify(first.issues))
      const second = await window.studio.saveByHand({ projectId: created.project.id, expectedRevision: first.view.project.revision, assetId: first.assetId, changed: ["hardness"], document: documents[1] })
      if (!second.ok) throw new Error(JSON.stringify(second.issues))
      const lone = await window.studio.saveByHand({ projectId: created.project.id, expectedRevision: second.view.project.revision, assetId: null, changed: [], document: documents[2] })
      if (!lone.ok) throw new Error(JSON.stringify(lone.issues))
      return { projectId: created.project.id, assetId: first.assetId, name: created.project.name }
    }, [block("旧石头", 2), block("旧石头", 4), block("孤石", 2)])
    const history = () => page.evaluate((input) => window.studio.getMakingHistory(input), { projectId: made.projectId, assetId: made.assetId })
    expect((await history()).versions.map((value) => value.by)).toEqual(["person", "person"])
    // The second version as the naming conversion leaves its record (`naming-migration.ts` writes `by: "converted"`; its own test proves that).
    const [folder] = await readdir(path.join(directory, "projects"))
    const record = path.join(directory, "projects", folder!, ".minemods", "making", "versions", made.assetId, `${(await history()).versions[1]!.revision}.json`)
    await writeFile(record, JSON.stringify({ ...JSON.parse(await readFile(record, "utf8")), by: "converted" }, null, 2))
    expect((await history()).versions.map((value) => value.by)).toEqual(["person", "converted"])

    await page.reload()
    await page.locator(".project-card").filter({ hasText: made.name }).click()
    await expect(page.getByRole("navigation", { name: "工程里的东西", exact: true })).toBeVisible()
    await page.getByRole("button", { name: "模组总览", exact: true }).click()

    // Saved once: nothing to compare, no tab.
    await page.locator('.inv-slot[data-kind="block"][data-item]').filter({ hasText: "孤石" }).first().click()
    const lone = page.getByRole("dialog", { name: "孤石", exact: true })
    await expect(lone).toBeVisible()
    await expect(lone.getByTestId("versions-teaser")).toHaveCount(0)
    await expect(lone.getByRole("tab", { name: "制作过程", exact: true })).toHaveCount(0)
    await page.keyboard.press("Escape")
    await expect(lone).toHaveCount(0)

    // Saved twice: the entry and the tab, the versions alone, said to be without a making record.
    await page.locator('.inv-slot[data-kind="block"][data-item]').filter({ hasText: "旧石头" }).first().click()
    const card = page.getByRole("dialog", { name: "旧石头", exact: true })
    await expect(card.getByTestId("versions-teaser")).toContainText("保存过 2 版")
    await card.getByRole("tab", { name: "制作过程", exact: true }).click()
    await expect(card.getByTestId("history-no-making")).toContainText("没有 AI 的制作记录")
    await expect(card.locator(".mk-story")).toHaveCount(0)
    await expect(card.locator(".mh-version")).toHaveCount(2)
    await expect(card.locator('.mh-version[aria-current="true"]')).toContainText("第 2 版 · 现在 · 从旧命名自动转换")
    await expect(card.locator('.mh-version[data-version="1"]')).toContainText("第 1 版 · 你改")
    await card.locator('.mh-version[data-version="1"]').click()
    await expect(card.getByTestId("history-old")).toBeVisible()
    await page.screenshot({ path: path.join(directory, "no-making-compare.png"), animations: "disabled", scale: "css" })
    await card.getByRole("button", { name: "回到第 1 版", exact: true }).click()
    // Stepped back as a new version, and still on the page it was taken on.
    await expect(card.locator(".mh-version")).toHaveCount(3)
    await expect(card.locator('.mh-version[aria-current="true"]')).toContainText("第 3 版 · 现在")
    await expect(card.locator('.mh-version[data-version="2"]')).toContainText("第 2 版 · 从旧命名自动转换")
    expect((await history()).versions.at(-1)).toMatchObject({ version: 3, by: "restored", from: 1, current: true })
    await expect(card.getByRole("tab", { name: "制作过程", exact: true })).toHaveAttribute("aria-selected", "true")
    await page.screenshot({ path: path.join(directory, "no-making-restored.png"), animations: "disabled", scale: "css" })
  } finally {
    await page.screenshot({ path: path.join(directory, "final.png") }).catch(() => undefined)
    await app.close()
  }
  expect(errors).toEqual([])
})

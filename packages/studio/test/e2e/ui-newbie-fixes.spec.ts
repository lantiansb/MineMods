import { expect, test, type Page } from "@playwright/test"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { spawnSync } from "node:child_process"
import { MODEL, connect, createProject, enter, finish, holdAtTheDoor, open, openTheDoor, pieces, plan, start, type Call } from "./review-helpers"

/**
 * What the newcomer test of 11-09 found, one test each on the packaged app. Every one of them was first run on the package the testers had (`37522036`) and failed there for the reason
 * it names. The AI is a local deterministic collaborator over the real MCP process; nothing here packs a mod or opens the game.
 */

// What a test needs before the part it is about: these go through the API, and say so.
const mcpMode = (page: Page) =>
  page.evaluate(async () => {
    const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
    await window.studio.saveConnection({ ...settings, mode: "mcp" })
  })

/** A second AI on the same app, whose refusals are looked at instead of failing the test. */
async function anotherAi(page: Page) {
  const configuration = await page.evaluate(async () => (await window.studio.getMcpStatus()).configuration)
  const transport = new StdioClientTransport({ ...JSON.parse(configuration).mcpServers["minemods-studio"], stderr: "pipe" })
  let said = ""
  const client = new Client({ name: "newbie-second", version: "1" })
  const started = client.connect(transport)
  transport.stderr?.on("data", (chunk) => (said += chunk))
  const connected = await started.then(() => true, () => false)
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
    const text = response.content.find((item) => item.type === "text")
    return { isError: !!response.isError, text: text && text.type === "text" ? text.text : "" }
  }
  return { connected, said: () => said, call, close: () => client.close().catch(() => undefined) }
}

/** A project with one model the AI made on its own (not from a blueprint), finished and saved. */
async function madeOnce(studio: Awaited<ReturnType<typeof start>>, name = "新人工程") {
  const { page } = studio
  const created = await createProject(page, name, "newbie_fix")
  const projectId = created.project.id
  await page.reload()
  await enter(page, name)
  const call = await connect(studio)
  const run = await plan(call, projectId, [{ key: "chick", title: MODEL }])
  const ids = { projectId, runId: run.id, taskId: run.tasks[0]!.id }
  await call("claim_task", ids)
  await finish(call, ids, MODEL, pieces(MODEL).all)
  await expect.poll(() => page.evaluate(async (input) => (await window.studio.getProjectOverview({ projectId: input.projectId })).items.some((item) => item.title === input.title && item.facts.saved), { projectId, title: MODEL }), { timeout: 30000 }).toBe(true)
  return { projectId, assetId: run.tasks[0]!.asset_id!, call }
}

/** The same model made again with one part grown, so there are two versions that differ. */
async function madeTwice(studio: Awaited<ReturnType<typeof start>>) {
  const made = await madeOnce(studio)
  const { all } = pieces(MODEL)
  const grown = all.bones.findIndex((bone) => bone.cubes.length)
  const bigger = { ...all, bones: all.bones.map((bone, index) => (index !== grown ? bone : { ...bone, cubes: bone.cubes.map((cube, at) => (at ? cube : { ...cube, size: [cube.size[0] + 1, cube.size[1], cube.size[2]] as typeof cube.size })) })) }
  const again = await plan(made.call, made.projectId, [{ key: "chick2", title: MODEL, target: made.assetId }])
  const ids = { projectId: made.projectId, runId: again.id, taskId: again.tasks[0]!.id }
  await made.call("claim_task", ids)
  await finish(made.call, ids, MODEL, bigger)
  await expect.poll(() => studio.page.evaluate(async (input) => (await window.studio.getMakingHistory(input)).versions.length, { projectId: made.projectId, assetId: made.assetId }), { timeout: 30000 }).toBe(2)
  return made
}

const overview = (page: Page) => page.getByRole("button", { name: "模组总览", exact: true }).click().catch(() => undefined)
const cardOf = async (page: Page, kind: "model" | "entity", title = MODEL) => {
  await overview(page)
  await page.locator(`.inv-slot[data-kind="${kind}"][data-item]`).filter({ hasText: title }).first().click()
  return page.getByRole("dialog", { name: title, exact: true })
}
/** The creature's own page, where its model is turned, painted and imported. */
const creaturePage = async (page: Page, title = MODEL, modelled = true) => {
  const card = await cardOf(page, "entity", title)
  await card.getByRole("button", { name: /^打开它/ }).click()
  await expect(page.locator(".model-creation-layout")).toBeVisible()
  const canvas = page.locator(".model-visual-column canvas").first()
  if (modelled) await expect(canvas).toBeVisible()
  return canvas
}
/** The colour at the middle of an element, read from a real screenshot. */
const colourAt = async (page: Page, element: ReturnType<Page["locator"]>) => {
  const box = (await element.boundingBox())!
  const shot = await page.screenshot({ clip: { x: box.x + box.width / 2 - 1, y: box.y + box.height / 2 - 1, width: 3, height: 3 } })
  return page.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement("canvas")
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext("2d")!
    context.drawImage(image, 0, 0)
    const [r, g, b] = context.getImageData(1, 1, 1, 1).data
    return { r: r!, g: g!, b: b! }
  }, shot.toString("base64"))
}

test("1 导入模型会替换现有模型，先问", async () => {
  await open(async (studio) => {
    const { page } = studio
    await madeOnce(studio)
    await creaturePage(page)
    await page.getByLabel("导入模型", { exact: true }).setInputFiles({ name: "别的模型.bbmodel", mimeType: "application/json", buffer: Buffer.from("{}") })
    const dialog = page.locator(".confirm-dialog")
    await expect(dialog, "替换之前先问").toBeVisible()
    await expect(dialog).toContainText("导出模型")
    await dialog.getByRole("button", { name: "先不导入", exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(await page.getByText("模型导入失败", { exact: false }).count(), "选了不导入就什么都没做").toBe(0)
  })
})

test("2 AI 直接做的东西做好后等你验收，有通过按钮", async () => {
  await open(async (studio) => {
    const { page } = studio
    const { projectId } = await madeOnce(studio)
    await expect.poll(() => page.evaluate(async (id) => (await window.studio.getProjectOverview({ projectId: id })).production?.to_review ?? 0, projectId), { timeout: 20000 }).toBe(1)
    const card = await cardOf(page, "model")
    await expect(card.getByRole("button", { name: "可以，通过", exact: true })).toBeVisible()
    expect(await card.getByText("没有在等你验收", { exact: false }).count()).toBe(0)
  })
})

test("3 回到旧版以后，回到的这一版等你验收", async () => {
  await open(async (studio) => {
    const { page } = studio
    await madeTwice(studio)
    const card = await cardOf(page, "model")
    await card.getByRole("tab", { name: "制作过程", exact: true }).click()
    await card.locator('.mh-version[data-version="1"]').click()
    await card.getByRole("button", { name: "回到第 1 版", exact: true }).click()
    await expect(card.locator(".mh-version")).toHaveCount(3)
    await expect(card.getByRole("button", { name: "可以，通过", exact: true }), "回到的这一版可以直接通过").toBeVisible()
  })
})

test("4 没连 AI 时，弹窗不给连不上的复制按钮，AI 的报错说界面上的名字", async () => {
  await open(async ({ page }) => {
    await page.getByRole("button", { name: /AI 没连接/ }).first().click()
    const popup = page.getByRole("dialog", { name: "AI 连接", exact: true })
    await expect(popup).toBeVisible()
    await expect(popup).toContainText("还没有连接 AI")
    expect(await popup.getByRole("button", { name: "复制开始协作说明", exact: true }).count(), "还连不上，就不给复制").toBe(0)
    await popup.getByRole("button", { name: "连接设置", exact: true }).click()

    const ai = await anotherAi(page)
    expect(ai.connected).toBe(false)
    await expect.poll(ai.said).toContain("个人设置")
    expect(ai.said()).not.toContain("工作室设置")
    await ai.close()
  })
})

test("5 拿着任务的 AI 断了，另一个窗口还连着，也要说断开", async () => {
  await open(async (studio) => {
    const { page } = studio
    const created = await createProject(page, "两个窗口", "newbie_two")
    const projectId = created.project.id
    await page.reload()
    await enter(page, "两个窗口")
    await mcpMode(page)
    const reviewer = await anotherAi(page)
    expect(reviewer.connected).toBe(true)
    const call = await connect(studio)
    const run = await plan(call, projectId, [{ key: "chick", title: MODEL }])
    const ids = { projectId, runId: run.id, taskId: run.tasks[0]!.id }
    await call("claim_task", ids)
    await call("update_task", { ...ids, draft: pieces(MODEL).piece(3), progress: 30, detail: "第 3 块" })
    await expect.poll(() => page.evaluate(async () => (await window.studio.getMcpStatus()).state)).toBe("working")
    await studio.client!.close()
    studio.client = undefined
    await expect.poll(() => page.evaluate(async () => (await window.studio.getMcpStatus()).state), { timeout: 12000, message: "做东西的 AI 走了" }).toBe("disconnected")
    await reviewer.close()
  })
})

test("6 中断后不说没有入口的「再点一次继续」，只交了计划的不说做到一半", async () => {
  const first = await start({ prefix: "newbie-fix-" })
  const pid = await first.app.evaluate(() => process.pid)
  const created = await createProject(first.page, "中断工程", "newbie_cut")
  const projectId = created.project.id
  await first.page.reload()
  await enter(first.page, "中断工程")
  const call = await connect(first)
  await plan(call, projectId, [{ key: "chick", title: MODEL }])
  const started = await plan(call, projectId, [{ key: "chick2", title: "做了一半的模型" }])
  const ids = { projectId, runId: started.id, taskId: started.tasks[0]!.id }
  await call("claim_task", ids)
  await call("update_task", { ...ids, draft: pieces("做了一半的模型").piece(3), progress: 30, detail: "第 3 块" })
  await first.client!.close()
  const closed = await Promise.race([first.app.close().then(() => true, () => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000))])
  if (!closed) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"])

  const again = await start({ directory: first.directory })
  try {
    await enter(again.page, "中断工程")
    const said = async () => (await again.page.evaluate((id) => window.studio.getActivity({ projectId: id }), projectId)).events.map((event) => event.text)
    await expect.poll(async () => (await said()).some((text) => /应用关掉/.test(text)), { timeout: 15000 }).toBe(true)
    const lines = await said()
    expect(lines.filter((text) => text.includes("再点一次继续")), "外部 AI 的批次没有可点的继续").toEqual([])
    expect(lines.some((text) => text.includes("还没开始")), "只交了计划的说还没开始").toBe(true)
    expect(lines.some((text) => text.includes("回你的 AI 窗口")), "做到一半的说去哪里接着做").toBe(true)
  } finally {
    await again.app.close()
  }
})

test("7 新对话接手：领过的任务说怎么接着交", async () => {
  await open(async (studio) => {
    const { page } = studio
    const created = await createProject(page, "接手工程", "newbie_take")
    const projectId = created.project.id
    await page.reload()
    await enter(page, "接手工程")
    const call = await connect(studio)
    const run = await plan(call, projectId, [{ key: "chick", title: MODEL }])
    const ids = { projectId, runId: run.id, taskId: run.tasks[0]!.id }
    await call("claim_task", ids)
    await studio.client!.close()
    studio.client = undefined
    const next = await anotherAi(page)
    const refused = await next.call("claim_task", ids)
    expect(refused.isError).toBe(true)
    expect(refused.text, "说清楚可以直接接着交").toContain("update_task")
    await next.close()
  })
})

test("7b 「停止」停掉这个工程所有进行中的外部批次", async () => {
  await open(async (studio) => {
    const { page } = studio
    const created = await createProject(page, "多批工程", "newbie_runs")
    const projectId = created.project.id
    await page.reload()
    await enter(page, "多批工程")
    const call: Call = await connect(studio)
    for (const key of ["a", "b"]) {
      const run = await plan(call, projectId, [{ key, title: `${key} 模型` }])
      await call("claim_task", { projectId, runId: run.id, taskId: run.tasks[0]!.id })
    }
    const running = () => page.evaluate(async (id) => (await window.studio.listProjectRuns({ projectId: id })).filter((run) => ["planning", "running", "awaiting_input"].includes(run.state)).length, projectId)
    await expect.poll(running).toBe(2)
    await page.getByRole("button", { name: /^打开动态/ }).click().catch(() => undefined)
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).click()
    await page.getByRole("button", { name: "停止", exact: true }).click()
    await expect.poll(running, { timeout: 10000, message: "两批都停了" }).toBe(0)
  })
})

test("8 有没保存的修改时点「构建并试玩」，先问", async () => {
  await open(async (studio) => {
    const { app, page } = studio
    await madeOnce(studio)
    const canvas = await creaturePage(page)
    await canvas.click()
    await page.getByRole("button", { name: "放大", exact: true }).click()
    await expect(page.getByText("有未保存修改", { exact: false }).first()).toBeVisible()
    // Should nothing ask, nothing is packed either: every request that starts making a mod is refused at the door.
    await holdAtTheDoor(app, { pattern: "build|pack|java|prepar|install|runtime|game|gradle|launch|scene|chain|play" }, "fail")
    try {
      await page.getByRole("button", { name: /构建并试玩/ }).click()
      const dialog = page.locator(".confirm-dialog")
      await expect(dialog, "先说这些修改不会进包").toBeVisible()
      await expect(dialog).toContainText("不会进包")
      await dialog.getByRole("button", { name: "留在这里", exact: true }).click()
      await expect(page.getByText("有未保存修改", { exact: false }).first(), "留下来，修改还在").toBeVisible()
    } finally {
      await openTheDoor(app)
    }
  })
})

test("9 点中一个方块，说清楚改的是整组", async () => {
  await open(async (studio) => {
    const { page } = studio
    await madeOnce(studio)
    const canvas = await creaturePage(page)
    await canvas.click()
    const context = page.locator(".model-part-context strong")
    await expect(context).toBeVisible()
    expect(await context.innerText(), "不露内部名").not.toMatch(/[a-z_]+\.[a-z_]+/)
    await expect(page.locator(".model-part-editor"), "改的是这一整组").toContainText("整组")
  })
})

test("10 整面填充在画过的模型上看得见", async () => {
  await open(async (studio) => {
    const { page } = studio
    await madeOnce(studio)
    const canvas = await creaturePage(page)
    await page.getByRole("tab", { name: "贴图 / UV", exact: true }).click()
    await page.getByRole("button", { name: "整面填充", exact: true }).click()
    await page.getByLabel("自定义画笔颜色", { exact: true }).fill("#ff00ff")
    await canvas.click()
    await page.waitForTimeout(600)
    const colour = await colourAt(page, canvas)
    expect(colour.r > colour.g * 2 && colour.b > colour.g * 2, `点到的地方变成洋红：${JSON.stringify(colour)}`).toBe(true)
  })
})

test("11 「重新截图」会清掉画好的标注，先问", async () => {
  await open(async (studio) => {
    const { page } = studio
    await madeOnce(studio)
    const card = await cardOf(page, "model")
    await card.getByRole("button", { name: "图上标注修改", exact: true }).click()
    const sheet = card.getByRole("img", { name: "截图标注画布", exact: true })
    await sheet.scrollIntoViewIfNeeded()
    const box = (await sheet.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 6 })
    await page.mouse.up()
    await expect(card.locator(".annotation-list li")).toHaveCount(1)
    await card.getByRole("button", { name: "重新截图", exact: true }).click()
    const dialog = page.locator(".confirm-dialog")
    await expect(dialog, "清掉之前先问").toBeVisible()
    await dialog.getByRole("button", { name: "留着", exact: true }).click()
    await expect(card.locator(".annotation-list li"), "选了留着，标注还在").toHaveCount(1)
  })
})

test("12 制作现场不挂着过时的「正在做」，不露内部部件名", async () => {
  await open(async (studio) => {
    const { page } = studio
    const created = await createProject(page, "现场工程", "newbie_floor")
    const projectId = created.project.id
    await page.reload()
    await enter(page, "现场工程")
    const call = await connect(studio)
    const run = await plan(call, projectId, [{ key: "chick", title: MODEL }])
    const ids = { projectId, runId: run.id, taskId: run.tasks[0]!.id }
    await call("claim_task", ids)
    // The person's own words for the parts, which the bones the AI writes do not repeat.
    await call("save_sheet", { ...ids, sheet: { subject: MODEL, recognisable: ["圆头", "四只脚"], assumed: [], parts: ["头部", "身体", "四条腿"].map((name) => ({ name, what: `小鸡的${name}`, shape: "立方体", attaches: "身体", surface: "彩虹色", moves: "跟着动作动", assumed: false })) } })
    await page.getByRole("button", { name: /^打开动态/ }).click().catch(() => undefined)
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).click()
    const live = page.getByTestId("making-live")
    await expect(live).toBeVisible({ timeout: 30000 })
    await call("update_task", { ...ids, draft: pieces(MODEL).piece(3), progress: 30, detail: "先搭身子" })
    await expect(live.locator(".ml-stage")).not.toHaveAttribute("data-seq", "0", { timeout: 10000 })
    await page.waitForTimeout(800)
    const tips = await live.locator(".ml-tips").innerText()
    expect(tips, "不露 root 这类内部名").not.toMatch(/正在做：[A-Za-z_]/)
    expect(tips, "对不上的不当成还没做").not.toContain("接下来")
    await call("look", { ...ids, document: pieces(MODEL).piece(3) })
    await page.waitForTimeout(1500)
    expect(await live.getByTestId("making-part").count(), "AI 已经在看图，不再说正在做哪块").toBe(0)
  })
})

test("13 空白生物告诉人怎么有模型", async () => {
  await open(async ({ page }) => {
    const created = await createProject(page, "空白工程", "newbie_blank")
    // A newcomer with no AI connected: Studio's own way, and nothing set up for it.
    await page.evaluate(async () => {
      const { hasApiKey: _key, source: _source, ...settings } = await window.studio.getConnection()
      await window.studio.saveConnection({ ...settings, mode: "api" })
    })
    await page.evaluate(async (input) => window.studio.addEntity({ projectId: input.id, expectedRevision: input.revision, name: "小石头" }), { id: created.project.id, revision: created.project.revision })
    await page.reload()
    await enter(page, "空白工程")
    await creaturePage(page, "小石头", false)
    await expect(page.locator(".model-creation-layout"), "说清楚要 AI 或者 .bbmodel").toContainText(".bbmodel")
  })
})

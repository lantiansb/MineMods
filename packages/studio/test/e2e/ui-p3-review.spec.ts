import { expect, test } from "@playwright/test"
import { MODEL, asked, atTheCard, connect, createProject, earnedIn, enter, finish, goHome, happened, heads, holdAtTheDoor, letGo, open, openTheDoor, pieces, plan, watchToasts } from "./review-helpers"

/**
 * What an independent review of P3 found, each on its own and on the packaged app, so that one failing does not hide the next. These were first run on the package they were found in, where
 * each of them failed, except 5b: it is there to show the fix for 5 does not silence a first seen happening, which was right before too. The AI is a local deterministic collaborator over the
 * real MCP process; a slow or failing write is made so at the IPC door, a thing done while nobody was looking is written to the project's activity log.
 */
test("1 确认框和询问框上的 Esc 只关它们，底下写到一半的批注不动", async () => {
  await open(async (studio) => {
    const { page } = studio
    const { card, box, write, note } = await atTheCard(studio)
    await write("写到一半，不能丢")
    await card.getByRole("tab", { name: "成品", exact: true }).click()
    const dialog = page.locator(".confirm-dialog")
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog, "第一次 Esc 就关确认框").toHaveCount(0)
    await expect(box).toHaveValue("写到一半，不能丢")
    expect(await card.getByText("再按一次 Esc", { exact: false }).count(), "这一下不算在批注头上").toBe(0)

    await card.getByRole("button", { name: "算了", exact: true }).click()
    await note("先记下一条")
    await write("又写到一半")
    await card.getByRole("button", { name: "清掉我标的", exact: true }).click()
    const ask = page.getByRole("alertdialog")
    await expect(ask).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(ask, "询问框也一样").toHaveCount(0)
    await expect(box).toHaveValue("又写到一半")
    expect(await card.getByText("再按一次 Esc", { exact: false }).count()).toBe(0)

    // Nothing left in hand, so the window closes without asking.
    await card.getByRole("button", { name: "算了", exact: true }).click()
    await expect(box).toHaveCount(0)
  })
})

test("2 删除已经发出去以后，不再给一个没用的撤销", async () => {
  await open(async (studio) => {
    const { app } = studio
    const { card, note, history } = await atTheCard(studio)
    const id = await note("要删的一条")
    await holdAtTheDoor(app, { method: "changeMakingNote", change: "remove" }, "hold")
    await card.getByRole("button", { name: `删掉第 ${id} 条`, exact: true }).click()
    const undo = card.getByRole("button", { name: "撤销", exact: true })
    await expect(undo, "5 秒之内可以撤销").toBeVisible()
    await expect.poll(() => asked(app), { timeout: 8000 }).toBe(true)
    await expect(undo, "请求发出后就没有撤销了").toHaveCount(0)
    await expect(card.locator(".mh-taken")).toContainText("正在删")
    await letGo(app)
    await expect.poll(async () => (await history()).notes.some((value) => value.id === id)).toBe(false)
    await expect(card.locator(".mh-taken")).toHaveCount(0)
    await openTheDoor(app)
  })
})

test("2+ 撤销按钮到时间消失后，焦点不掉到页面上，回车不会通过验收", async () => {
  await open(async (studio) => {
    const { page } = studio
    const { card, note, history, waiting } = await atTheCard(studio)
    const id = await note("最后一条未交批注")
    await card.getByRole("button", { name: `删掉第 ${id} 条`, exact: true }).click()
    await expect(card.getByRole("button", { name: "撤销", exact: true })).toBeFocused()
    await expect.poll(async () => (await history()).notes.some((value) => value.id === id), { timeout: 8000 }).toBe(false)
    await expect(card.getByRole("button", { name: "撤销", exact: true })).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName), { message: "焦点还在卡片里的按钮上" }).toBe("BUTTON")
    await page.keyboard.press("Enter")
    await page.waitForTimeout(500)
    expect(await waiting(), "这一下回车不算通过").toBe(1)
  })
})

test("3 切到另一个模型后，上一个模型迟到的响应不会盖上来", async () => {
  await open(async (studio) => {
    const { app, page } = studio
    const created = await createProject(page, "两个模型", "p3_two")
    const projectId = created.project.id
    await page.reload()
    await enter(page, "两个模型")
    const call = await connect(studio)
    const run = await plan(call, projectId, [
      { key: "a", title: "甲模型" },
      { key: "b", title: "乙模型" },
    ])
    const a = { projectId, runId: run.id, taskId: run.tasks[0]!.id }
    const b = { projectId, runId: run.id, taskId: run.tasks[1]!.id }
    const parts = pieces("甲模型")
    await call("claim_task", a)
    for (const count of [3, 4, 5, 6, 7]) await call("update_task", { ...a, draft: parts.piece(count), progress: count * 10, detail: `第 ${count} 块` })
    await finish(call, a, "甲模型", parts.all)
    const others = pieces("乙模型")
    await call("claim_task", b)
    await call("update_task", { ...b, draft: others.piece(3), progress: 30, detail: "第 3 块" })
    await finish(call, b, "乙模型", others.all)

    await page.getByRole("button", { name: /^打开动态/ }).click().catch(() => undefined)
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).click()
    const row = (title: string) => page.locator(".mf-row[data-row]").filter({ hasText: title }).first()
    const stage = page.locator(".ml-stage")
    const settled = async () => {
      await expect.poll(() => stage.getAttribute("data-seq").then(Number), { timeout: 15000 }).toBeGreaterThan(0)
      await page.waitForTimeout(600)
      return Number(await stage.getAttribute("data-seq"))
    }
    // How many steps the slider counts is the trace in hand: a late answer changes that first, and the stage cannot show a step of one thing from another's record.
    const counted = () => page.getByTestId("making-live").locator('[role="slider"]').getAttribute("aria-valuetext")
    await row("甲模型").click()
    const seqA = await settled()
    const countA = await counted()
    await row("乙模型").click()
    await expect.poll(() => stage.getAttribute("data-seq").then(Number), { timeout: 15000 }).not.toBe(seqA)
    const seqB = await settled()
    const countB = await counted()
    expect(countB, "两个模型的步数不一样，才看得出是谁的").not.toBe(countA)

    await holdAtTheDoor(app, { method: "getMakingTrace", assetId: run.tasks[0]!.asset_id! }, "hold")
    await row("甲模型").click()
    await expect.poll(() => asked(app), { timeout: 8000 }).toBe(true)
    await row("乙模型").click()
    await expect.poll(() => stage.getAttribute("data-seq").then(Number), { timeout: 15000 }).toBe(seqB)
    await letGo(app)
    await page.waitForTimeout(1500)
    await openTheDoor(app)
    expect(await counted(), "步数还是乙模型的").toBe(countB)
    expect(Number(await stage.getAttribute("data-seq")), "舞台上还是乙模型").toBe(seqB)
    await expect(row("乙模型")).toHaveAttribute("aria-pressed", "true")
  })
})

test("4 批量清除写入失败时，不说清掉了", async () => {
  await open(async (studio) => {
    const { app, page } = studio
    const { card, note, history } = await atTheCard(studio)
    const id = await note("清不掉的一条")
    await holdAtTheDoor(app, { method: "changeMakingNote", change: "remove" }, "fail")
    await card.getByRole("button", { name: "清掉我标的", exact: true }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: "清掉", exact: true }).click()
    await expect(card.getByText("模拟的写入失败", { exact: false })).toBeVisible()
    await page.waitForTimeout(300)
    expect(await card.getByText(/清掉了/).count(), "没清掉就不说清掉了").toBe(0)
    expect((await history()).notes.some((value) => value.id === id)).toBe(true)
    await openTheDoor(app)
  })
})

test("5 不在工程里时做好的第一样记下来不弹，下一样也不再说第一样", async () => {
  await open(async ({ page }) => {
    const created = await createProject(page, "后台工程", "p3_away")
    await page.reload()
    await enter(page, "后台工程")
    await expect.poll(() => earnedIn(created.directory)).toEqual([])
    await goHome(page)
    await happened(created.directory, ["不在时做好的"])
    await enter(page, "后台工程")
    await watchToasts(page)
    await expect.poll(() => earnedIn(created.directory), { timeout: 8000, message: "回来就记下了" }).toContain("made")
    await happened(created.directory, ["回来后做好的"])
    await expect.poll(() => heads(page), { timeout: 8000 }).toContain("做好了！")
    await page.waitForTimeout(500)
    expect((await heads(page)).filter((head) => head.startsWith("进度达成")), "第一样早就做过了").toEqual([])
  })
})

test("5b 看着工程时做好的第一样，照常提示", async () => {
  await open(async ({ page }) => {
    const created = await createProject(page, "看着的工程", "p3_watch")
    await page.reload()
    await enter(page, "看着的工程")
    await expect.poll(() => earnedIn(created.directory)).toEqual([])
    await watchToasts(page)
    await page.waitForTimeout(1000)
    await happened(created.directory, ["看着做好的"])
    await expect.poll(async () => { await page.locator(".adv-toast").first().click({ timeout: 300 }).catch(() => undefined); return heads(page) }, { timeout: 15000 }).toContain("进度达成！开工大吉")
  })
})

test("6 同一轮读到 6 个完成事件，进度照样记下，只说一次", async () => {
  await open(async ({ page }) => {
    const created = await createProject(page, "一批工程", "p3_batch")
    await page.reload()
    await enter(page, "一批工程")
    await expect.poll(() => earnedIn(created.directory)).toEqual([])
    await watchToasts(page)
    await page.waitForTimeout(1000)
    await happened(created.directory, ["一", "二", "三", "四", "五", "六"])
    await expect.poll(() => earnedIn(created.directory), { timeout: 10000 }).toEqual(["made"])
    await expect.poll(async () => { await page.locator(".adv-toast").first().click({ timeout: 300 }).catch(() => undefined); return heads(page) }, { timeout: 15000 }).toContain("进度达成！开工大吉")
    expect((await heads(page)).filter((head) => head === "进度达成！开工大吉")).toHaveLength(1)
  })
})

test("7 方向键转模型也算接管镜头，自动跟随要停", async () => {
  await open(async (studio) => {
    const { page } = studio
    const created = await createProject(page, "跟随工程", "p3_follow")
    const projectId = created.project.id
    await page.reload()
    await enter(page, "跟随工程")
    const call = await connect(studio)
    const run = await plan(call, projectId, [{ key: "chick", title: MODEL }])
    const ids = { projectId, runId: run.id, taskId: run.tasks[0]!.id }
    const { piece } = pieces(MODEL)
    await call("claim_task", ids)
    await page.getByRole("button", { name: /^打开动态/ }).click().catch(() => undefined)
    await page.getByRole("button", { name: "在制作现场看全部", exact: true }).click()
    const live = page.getByTestId("making-live")
    await expect(live).toBeVisible({ timeout: 30000 })
    await call("update_task", { ...ids, draft: piece(3), progress: 30, detail: "第 3 块" })
    const follow = page.getByRole("button", { name: /跟着 AI 看/ })
    await expect(follow).toHaveAttribute("aria-pressed", "true")
    const canvas = live.locator("canvas").first()
    await canvas.focus()
    await page.keyboard.press("ArrowRight")
    await expect(follow, "按方向键以后镜头归人").toHaveAttribute("aria-pressed", "false")
  })
})

test("8 新提示入队不会重新计时当前这条", async () => {
  await open(async ({ page }) => {
    const created = await createProject(page, "计时工程", "p3_timer")
    await page.reload()
    await enter(page, "计时工程")
    await expect.poll(() => earnedIn(created.directory)).toEqual([])
    await page.waitForTimeout(1000)
    await happened(created.directory, ["计时甲"])
    const toast = page.locator(".adv-toast")
    await expect(toast).toContainText("计时甲", { timeout: 8000 })
    const shownAt = Date.now()
    await page.waitForTimeout(1000)
    await happened(created.directory, ["计时乙"])
    await expect.poll(async () => /还有 [2-9] 条/.test(await toast.innerText()), { timeout: 3800, message: "乙进了队" }).toBe(true)
    await page.waitForTimeout(Math.max(0, shownAt + 5700 - Date.now()))
    expect(await toast.innerText(), "5.2 秒到了就走").not.toContain("计时甲")
  })
})

test("9 回首页时 logo 不再落一次", async () => {
  await open(async ({ page }) => {
    await createProject(page, "落一次", "p3_logo")
    await page.reload()
    await expect(page.locator(".mm-logo-face")).toHaveClass(/fall/)
    await page.evaluate(() => {
      const holder = window as unknown as { drops: number }
      holder.drops = 0
      document.addEventListener("animationstart", (event) => {
        if (event.animationName === "mm-logo-drop") holder.drops += 1
      })
    })
    await page.waitForTimeout(900)
    await enter(page, "落一次")
    await page.evaluate(() => ((window as unknown as { drops: number }).drops = 0))
    await goHome(page)
    await page.waitForTimeout(900)
    expect(await page.evaluate(() => (window as unknown as { drops: number }).drops), "回来时它已经在那儿").toBe(0)
    await expect(page.locator(".mm-logo-face")).not.toHaveClass(/fall/)
  })
})

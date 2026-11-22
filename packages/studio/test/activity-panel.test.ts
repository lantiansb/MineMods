import { expect, test } from "bun:test"
import type { ActivityEvent } from "../src/api"
import { activitySummary, groupActivity, lasted, shownEvents, STALLED_AFTER } from "../src/renderer/features/project-activity-model"

const start = Date.parse("2026-10-05T08:00:00.000Z")
const stream = (rows: (Partial<ActivityEvent> & Pick<ActivityEvent, "kind" | "text">)[]): ActivityEvent[] =>
  rows.map((row, index) => ({ seq: index + 1, at: new Date(start + index * 30000).toISOString(), mark: "run", item: null, title: null, ...row }))
const ore = { item: "ore", title: "蓝晶矿" }
const sword = { item: "sword", title: "蓝晶剑" }
const events = stream([
  { kind: "plan", text: "正在想要做哪些东西。", step: true },
  { kind: "plan", text: "蓝图草稿好了。", mark: "ok", end: true },
  { kind: "person", text: "你确认了蓝图。", mark: "ok" },
  { kind: "batch", text: "开始做这一批，一共 2 样" },
  { kind: "task", text: "开始做", ...ore },
  { kind: "task", text: "开始做", ...sword },
  { kind: "tool", text: "外部 AI 接下了「蓝晶剑」。", ...sword, quiet: true, mark: "note" },
  { kind: "look", text: "做出了第 1 版，看了它的渲染图。", ...ore, round: 1 },
  { kind: "task", text: "正在验收并保存。", ...ore, step: true },
  { kind: "task", text: "没通过验收，正在按意见改。", ...sword, mark: "fail" },
  { kind: "task", text: "做好了，已经保存，等你验收。", ...ore, mark: "ok", end: true },
  { kind: "person", text: "你说这一版要改。", ...ore, mark: "note" },
  { kind: "task", text: "开始做", ...ore },
])

test("动态按东西归拢：每样东西一组，整个模组的事按发生的地方留着；做完又重做的另起一组", () => {
  const groups = groupActivity(events, true)
  expect(groups.map((group) => [group.title, group.state, group.word, group.events.length])).toEqual([
    ["想法和蓝图", "ok", "做好了", 3],
    ["这一批", "run", "正在做", 1],
    ["蓝晶矿", "ok", "做好了", 5],
    ["蓝晶剑", "run", "正在做", 3],
    // Sent back by the person and begun again: a making of its own, under the first.
    ["蓝晶矿", "run", "正在做", 1],
  ])
  // A group keeps the id of its first event while it grows, so the page can keep it on screen.
  expect(groupActivity(events.slice(0, 8), true).map((group) => group.id)).toEqual(groups.slice(0, 4).map((group) => group.id))
  // The person's own remark stays with the thing it is about and does not reopen it.
  expect(groups[2]!.events.at(-1)!.text).toBe("你说这一版要改。")
  // What is being done right now is the newest step, and only until something ends the thing.
  expect(groupActivity(events.slice(0, 9), true)[2]!.live?.text).toBe("正在验收并保存。")
  expect(groups[2]!.live).toBeNull()
  expect(groupActivity(events.slice(0, 1), true)[0]).toMatchObject({ state: "run", word: "正在想", live: { text: "正在想要做哪些东西。" } })
})

test("没有在做的时候不装作在做：没结束的组说“停了”，没有闪着的那一行", () => {
  const groups = groupActivity(events, false)
  expect(groups.map((group) => group.state)).toEqual(["ok", "idle", "ok", "idle", "idle"])
  expect(groups.every((group) => group.live === null)).toBe(true)
  expect(groups[1]!.word).toBe("停了")
  // A thing that was cut short, and something worth a look about the whole project, read differently.
  const cut = groupActivity(stream([{ kind: "task", text: "开始做", ...ore }, { kind: "task", text: "做到一半，应用关掉了。", ...ore, mark: "note", end: true }, { kind: "batch", text: "上次做到一半，应用关掉了。", mark: "warn", end: true }, { kind: "task", text: "AI 还不满意：把第 3 版先交给你验收。", ...sword, mark: "warn", end: true }]), false)
  expect(cut.map((group) => [group.title, group.word])).toEqual([["蓝晶矿", "没做完"], ["这一批", "要看一眼"], ["蓝晶剑", "留给你看"]])
})

test("给人看的节点：正在做的那一步只当作活动行，别的节点已经说过的调用只在高级里", () => {
  const sworded = groupActivity(events, true)[3]!
  expect(shownEvents(sworded, false).map((event) => event.text)).toEqual(["开始做", "没通过验收，正在按意见改。"])
  expect(shownEvents(sworded, true).map((event) => event.text)).toEqual(["开始做", "外部 AI 接下了「蓝晶剑」。", "没通过验收，正在按意见改。"])
  expect(shownEvents(groupActivity(events, true)[2]!, true).some((event) => event.step)).toBe(false)
})

test("顶上那一行只说记下来的事；很久没动静就明说，不留一个一直转的标记", () => {
  const now = start + 14 * 60000
  const running = activitySummary(groupActivity(events, true), { running: true, now, aliveAt: now - 5000 })
  // The ore counts once, by its latest making, which is under way again.
  expect(running).toEqual({ line: "正在做 2 样 · 用了 13 分钟", stalled: "" })
  const done = stream([{ kind: "task", text: "做好了", ...ore, mark: "ok", end: true }, { kind: "task", text: "AI 还不满意", ...sword, mark: "warn", end: true }, { kind: "task", text: "这一样没做成。", item: "guard", title: "守卫", mark: "fail", end: true }])
  // A version kept for the person is saved but is not 已做好 (broad19): it is counted apart. This one carries no reason (a log from before the field), so it says only what is known.
  expect(activitySummary(groupActivity(done, false), { running: false, now, aliveAt: null }).line).toBe("现在没有在做的 · 已做好 1 样 · 1 样留了一版，等你看 · 没做成 1 样")
  // With the reason recorded the line says which: a review that did not pass, or a making cut short.
  const kept = (by: "unsatisfied" | "interrupted") => stream([{ kind: "task", text: "做好了", ...ore, mark: "ok", end: true }, { kind: "task", text: "存下了", ...sword, mark: "warn", end: true, kept: by }])
  expect(activitySummary(groupActivity(kept("unsatisfied"), false), { running: false, now, aliveAt: null }).line).toBe("现在没有在做的 · 已做好 1 样 · 1 样留了一版但没通过审查")
  expect(activitySummary(groupActivity(kept("interrupted"), false), { running: false, now, aliveAt: null }).line).toBe("现在没有在做的 · 已做好 1 样 · 1 样制作被中断，留了中断前的一版")
  expect(activitySummary([], { running: false, now, aliveAt: null }).line).toBe("还没有动静。说一句想做什么，这里就会一步一步记下来。")
  expect(activitySummary(groupActivity(events.slice(0, 1), true), { running: true, now: start + 60000, aliveAt: start }).line).toBe("正在想 · 用了 1 分钟")
  const quiet = activitySummary(groupActivity(events, true), { running: true, now, aliveAt: now - STALLED_AFTER - 60000 })
  expect(quiet.stalled).toStartWith("AI 已经 3 分钟没有动静了。")
  // Not running: nothing is expected to move, so silence is not a stall.
  expect(activitySummary(groupActivity(events, false), { running: false, now, aliveAt: now - 3600000 }).stalled).toBe("")
  expect([lasted(20000), lasted(59 * 60000), lasted(3 * 3600000)]).toEqual(["1 分钟", "59 分钟", "3 小时"])
})

test("退回外部 AI 的那句话，给人看的时候把步骤的名字说成这一步是什么", async () => {
  const { forPerson } = await import("../src/main/activity-tools")
  expect(forPerson("配方不走看图流程，不需要部件说明、看图和自评：做好以后直接 commit_task。")).toBe("配方不走看图流程，不需要部件说明、看图和自评：做好以后直接 提交。")
  expect(forPerson("先 look 再 self_review")).toBe("先 看图 再 自评")
  // A registry name or a longer word that only contains one is not a step.
  expect(forPerson("minecraft:look_at 和 outlook 不变")).toBe("minecraft:look_at 和 outlook 不变")
})

test("退回的话里的文档字段名，给人看的时候说成中文，原文留在高级里", async () => {
  const { forPerson, toolActivity } = await import("../src/main/activity-tools")
  const { GAMEPLAY_REFUSALS } = await import("@minemods/mod-core/gameplay-words")
  // The refusal as it was shown in a31/a35: a list of field names a person cannot read.
  const plain = forPerson(GAMEPLAY_REFUSALS.sheet_differs)
  expect(plain).toContain("（标识、名字、概要、会做的事、不做的事、用到的东西）")
  for (const raw of ["slug", "summary", "behaviours", "not_doing", "uses"]) expect(plain).not.toContain(raw)
  // A field that is nothing but a field name is turned wherever it is; an ordinary word in a list that is not all fields is left alone.
  expect(forPerson("behaviours 里至少要有一条")).toBe("会做的事 里至少要有一条")
  expect(forPerson("name 不能为空，this、that 不变")).toBe("name 不能为空，this、that 不变")
  expect(forPerson("registry:not_doing_here 不变")).toBe("registry:not_doing_here 不变")
  const event = toolActivity({
    method: "checkCodeExternalTask",
    input: { projectId: "p", taskId: "t" },
    result: null,
    refused: { plain: true, message: GAMEPLAY_REFUSALS.sheet_differs },
    ms: 5,
    run: null,
  })!
  expect(event.lines!.join("")).not.toContain("behaviours")
  // What the outside AI was sent stays whole under 高级.
  expect(event.detail).toContain("slug、name、summary、behaviours、not_doing、uses")
})

test("退回的话是写给 AI 的操作步骤：动态里人读到的是平白的句子，步骤和字段名跟原文一起收在高级里", async () => {
  const { toolActivity } = await import("../src/main/activity-tools")
  const { refusedWords } = await import("../src/main/external-dispatch")
  const { MakingRefusal } = await import("@minemods/mod-core/making")
  const order =
    "这只生物在这个任务里还没有用 look 看过。生物不写部件说明（不用 save_sheet）：文档里 abilities 不是空的，或者写了 hitbox，就先 look 看它的招式和碰撞箱，再 self_review、final_review，通过以后 commit_task。"
  const call = (refused: ReturnType<typeof refusedWords>) =>
    toolActivity({ method: "commitExternalTask", input: { projectId: "p", taskId: "t" }, result: null, refused, ms: 5, run: null })!
  // Without a sentence of its own, the whole text is procedure: the person is told that, not made to read it.
  const bare = call(refusedWords(new MakingRefusal(order)))
  expect(bare.text).toBe("外部 AI 提交了这一样，被 Studio 退回了。")
  expect(bare.lines).toHaveLength(1)
  expect(bare.lines![0]).toStartWith("另有 ")
  for (const name of ["abilities", "hitbox", "self_review", "final_review", "commit_task", "save_sheet", "look"]) expect(bare.lines!.join("")).not.toContain(name)
  expect(bare.detail).toContain("abilities 不是空的")
  // With one (the refusal's `plain`), that sentence is the line and the original is still under 高级.
  const worded = call(refusedWords(new MakingRefusal(order, false, "这只生物还没有看过图就想往下走，Studio 让它先看一眼它的招式和碰撞箱。")))
  expect(worded.lines).toEqual(["这只生物还没有看过图就想往下走，Studio 让它先看一眼它的招式和碰撞箱。"])
  expect(worded.detail).toContain("commit_task")
  // What is wrong stays in front of what to do: the first sentence is the person's, the instruction goes away.
  const half = call(refusedWords(new MakingRefusal("这一版还没有检查过。先用 check_code 检查代码，再往下走。")))
  expect(half.lines![0]).toBe("这一版还没有检查过。")
  expect(half.lines![1]).toStartWith("另有 1 句")
})

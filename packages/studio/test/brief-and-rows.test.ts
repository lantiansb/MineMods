import { expect, test } from "bun:test"
import { briefChars, briefLayout } from "../src/renderer/features/brief-note-model"
import { groupActivity, groupPicture, nowLine, roundPips } from "../src/renderer/features/project-activity-model"
import type { ActivityEvent } from "../src/api"

const HEDGEHOG =
  "制作一只矮小圆润的四足刺猬：棕褐色短刺形成清楚的背部轮廓，脸和肚皮偏浅色，黑亮小眼和鼻子明显，四条短腿看清。贴近 Minecraft 原版小动物的体块和像素质感，复杂度保持适中。包含 idle（轻微探头、嗅闻）、walk（四足交替迈步并带身体起伏）和 hurt（短暂缩身后恢复）动作。"

test("a brief is laid out, never shortened: headline, one point per sentence, named motions as chips", () => {
  const layout = briefLayout(HEDGEHOG)
  expect(layout.head).toBe("制作一只矮小圆润的四足刺猬")
  expect(layout.points).toHaveLength(3)
  const chips = layout.points[2]!.filter((piece) => "name" in piece)
  expect(chips).toEqual([
    { name: "idle", says: "轻微探头、嗅闻" },
    { name: "walk", says: "四足交替迈步并带身体起伏" },
    { name: "hurt", says: "短暂缩身后恢复" },
  ])
  // Only the joining words between chips and layout whitespace are dropped; every other character is shown.
  const kept = briefChars(layout).replace(/\s/g, "")
  const original = HEDGEHOG.replace(/\s/g, "").replace("：", "").replace(/、(?=walk)|和(?=hurt)/g, "").replace(/[（）]/g, "")
  expect(kept).toBe(original)
})

test("a brief without a short head is all points; a long text before the colon is not a headline", () => {
  expect(briefLayout("一个方块。会发光。").head).toBeNull()
  expect(briefLayout("一个方块。会发光。").points).toHaveLength(2)
  const long = "这是一段很长很长的说明文字已经超过了标题应有的长度所以不该当标题：后面"
  expect(briefLayout(long).head).toBeNull()
})

const at = (minute: number) => `2026-10-15T04:${String(minute).padStart(2, "0")}:00.000Z`
const event = (seq: number, part: Partial<ActivityEvent>): ActivityEvent => ({ seq, at: at(seq), kind: "task", mark: "run", item: "hog", title: "小刺猬", text: "x", ...part }) as ActivityEvent

test("a thing's row: rounds as squares from the log alone, its newest picture and one line", () => {
  const events = [
    event(1, { text: "开始做" }),
    event(2, { kind: "look", round: 1, text: "做出了第 1 版", thumb: "data:a" }),
    event(3, { kind: "review", round: 1, mark: "warn", text: "第 1 版自己检查：还要改。" }),
    event(4, { kind: "look", round: 2, text: "做出了第 2 版", thumb: "data:b" }),
    event(5, { step: true, text: "正在看第 2 版" }),
  ]
  const [group] = groupActivity(events, true)
  expect(roundPips(group!)).toEqual([
    { round: 1, state: "redo" },
    { round: 2, state: "now" },
  ])
  expect(groupPicture(group!)).toBe("data:b")
  expect(nowLine(group!, false)?.text).toBe("正在看第 2 版")
  const passed = [...events.slice(0, 4), event(6, { kind: "review", round: 2, mark: "ok", end: true, text: "没参与制作的评审看了第 2 版：通过。" })]
  const [done] = groupActivity(passed, false)
  expect(roundPips(done!).at(-1)).toEqual({ round: 2, state: "passed" })
  expect(nowLine(done!, false)?.text).toContain("通过")
})

test("one row per thing however often it was made again; the strip is the newest making's", async () => {
  const { rowsOf, mileText } = await import("../src/renderer/features/project-activity-model")
  const first = [event(1, { text: "开始做" }), event(2, { kind: "look", round: 1, text: "第 1 版" }), event(3, { kind: "task", mark: "ok", end: true, text: "做好了" })]
  const again = [event(4, { kind: "task", text: "开始重做" }), event(5, { kind: "look", round: 1, text: "第 1 版（重做）" })]
  const whole: ActivityEvent = { seq: 6, at: at(6), kind: "batch", mark: "ok", item: null, end: true, text: "这一批做完了" } as ActivityEvent
  const rows = rowsOf(groupActivity([...first, ...again, whole], true))
  expect(rows.map((row) => row.item)).toEqual(["hog", null])
  expect(rows[0]!.events).toHaveLength(5)
  expect(roundPips(rows[0]!)).toEqual([{ round: 1, state: "now" }])
  expect(mileText("外部 AI", "外部 AI 打开这个模组")).toBe("打开这个模组")
  expect(mileText("这一批", "开始做这一批")).toBe("开始做这一批")
})

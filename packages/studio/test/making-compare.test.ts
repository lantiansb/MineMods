import { expect, test } from "bun:test"
import { cellOffset, choose, isViewSheet, roundBefore, sharedSheets, sheetOf, SHEET_VIEWS } from "../src/renderer/features/making-compare"
import type { MakingRound } from "../src/api"

const round = (number: number, labels: string[]): MakingRound => ({ round: number, at: "2026-10-19T10:00:00.000Z", pictures: labels.map((label) => ({ label, url: `data:image/jpeg;base64,${number}${label}` })), self_review: null, findings: [] })

test("上一轮：往前找最近一轮有图的；只有一轮就没有上一轮", () => {
  const rounds = [round(1, ["六个角度"]), round(2, []), round(3, ["六个角度"])]
  expect(roundBefore(rounds, rounds[2])).toBe(rounds[0])
  expect(roundBefore(rounds, rounds[0])).toBeUndefined()
  expect(roundBefore([rounds[0]!], rounds[0])).toBeUndefined()
})

test("只对两轮都有的图：同一个角度、同一个动作；一边没有的不拿别的顶替", () => {
  const before = round(1, ["六个角度", "走路（walk） · 斜前方"])
  const after = round(2, ["六个角度（它做好的样子）", "六个角度", "走路（walk） · 斜前方", "攻击（attack） · 正面"])
  expect(sharedSheets(before, after)).toEqual(["六个角度", "走路（walk） · 斜前方"])
  expect(sharedSheets(before, round(2, ["攻击（attack） · 正面"]))).toEqual([])
  expect(sharedSheets(undefined, after)).toEqual([])
  expect(sheetOf(before, "攻击（attack） · 正面")).toBeUndefined()
  expect(sheetOf(before, "六个角度")?.label).toBe("六个角度")
})

test("六个角度那一张是 3×2 的格子，按固定顺序切出一个角度；动作的图整张看", () => {
  expect(SHEET_VIEWS).toHaveLength(6)
  expect(SHEET_VIEWS[0]).toBe("正面")
  expect(cellOffset(0)).toEqual({ left: "0%", top: "0%" })
  expect(cellOffset(4)).toEqual({ left: "-100%", top: "-100%" })
  expect(cellOffset(5)).toEqual({ left: "-200%", top: "-100%" })
  expect(isViewSheet("六个角度")).toBe(true)
  expect(isViewSheet("六个角度（它做好的样子）")).toBe(true)
  expect(isViewSheet("只看形状")).toBe(true)
  expect(isViewSheet("走路（walk） · 斜前方")).toBe(false)
})

test("两边一起切：选中的图两轮都有才用，没有就用第一张两轮都有的；动作的图不切格子", () => {
  const shared = ["六个角度", "走路（walk） · 斜前方"]
  expect(choose(shared, "走路（walk） · 斜前方", 2)).toEqual({ label: "走路（walk） · 斜前方", cell: null })
  expect(choose(shared, "攻击（attack） · 正面", 2)).toEqual({ label: "六个角度", cell: 2 })
  expect(choose(shared, "", null)).toEqual({ label: "六个角度", cell: null })
  expect(choose(shared, "六个角度", 9)).toEqual({ label: "六个角度", cell: null })
  expect(choose([], "六个角度", 1)).toEqual({ label: "", cell: null })
})

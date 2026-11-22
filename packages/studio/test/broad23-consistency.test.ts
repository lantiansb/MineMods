import { expect, test } from "bun:test"
import type { Making, OverviewItem, OverviewStatus } from "../src/api"
import { acceptOffered } from "../src/renderer/features/accept-offer"
import { makingBadge, makingLine } from "../src/renderer/features/asset-making"
import { floorRows } from "../src/renderer/features/making-floor-model"
import { detailTag } from "../src/renderer/features/model-detail"
import { makingNow } from "../src/renderer/features/production-words"

// Broad23: two screens said different things about one thing (a line saying it waits for the person, a card saying nothing does, with a 通过 button under it), a task an
// outside AI had only taken was said to be written, and a Boss's model made by 高 sat under a 中 label at the top.

const item = (id: string, status: OverviewStatus, more: Partial<OverviewItem> = {}) =>
  ({ id, key: id, asset_id: `${id}-asset`, kind: "model", title: id, brief: "", owner: null, status, status_label: status, reason: null, facts: { saved: status !== "planned", built: false, gametest: null, client: null, accepted: null }, review_asked: false, review: null, preview: {}, needs: [], used_by: [], out_of_scope: null, revision: 1, ...more }) as unknown as OverviewItem

test("「可以，通过」只在这样东西真的在等你、或者页面问你它还合不合适时才有", () => {
  expect(acceptOffered(item("a", "review"), [])).toBe(true)
  // Waits for nothing: made by hand, or changed by hand since. Nothing to answer.
  expect(acceptOffered(item("a", "saved"), [])).toBe(false)
  expect(acceptOffered(item("a", "built"), [])).toBe(false)
  // The page asked whether it still fits after what it uses was remade.
  expect(acceptOffered(item("a", "saved"), [{ kind: "stale" }])).toBe(true)
  expect(acceptOffered(item("a", "saved"), [{ kind: "unused" }])).toBe(false)
  // Not while it is being made, and not for something that was never saved.
  expect(acceptOffered(item("a", "making"), [])).toBe(false)
  expect(acceptOffered(item("a", "review", { asset_id: null }), [])).toBe(false)
})

const making = (more: Partial<Making> = {}) => ({ item_id: "deer", asset_id: null, sheet: null, rounds: [], review: null, state: "describing", rounds_allowed: 6, ...more }) as Making

test("领了任务还没动手的，不说「正在写部件说明」，也不算在做；交了东西以后才说在写", () => {
  const idle = making({ idle: true })
  expect(makingLine(idle)).not.toContain("正在写")
  expect(makingLine(idle)).toContain("还没动手")
  expect(makingBadge(idle)).toBe("还没动手")
  expect(makingBadge(idle, true)).toBe("排队")
  expect(makingLine(making())).toBe("正在写部件说明")
  expect(makingBadge(making())).toBe("写说明")
  // The line of things in hand leaves the idle one out; it is the queue's to say.
  const things = [item("deer", "making"), item("icon", "making")]
  const now = makingNow({ items: things, kinds: [{ id: "model", label: "模型" }], makings: { deer: idle, icon: making({ item_id: "icon", state: "making", rounds: [] }) }, drafts: [], roundNow: () => 1 })
  expect(now.map((value) => value.id)).toEqual(["icon"])
})

test("模型实际的精细度和顶部不一样时，写在它自己身上；一样就不重复", () => {
  const boss = item("king_model", "making", { detail: { level: "high", label: "高" } })
  expect(detailTag(boss, "medium")).toBe("精细度 高")
  expect(detailTag(boss, "high")).toBeNull()
  expect(detailTag(item("stick", "saved"), "medium")).toBeNull()
  // The button as it stands is not known: nothing is said rather than something wrong.
  expect(detailTag(boss, undefined)).toBeNull()
  // The list of things on the floor carries it beside the kind, searchable like the rest.
  const rows = floorRows({ items: [boss, item("stick", "saved", { detail: { level: "medium", label: "中" } })], kinds: [{ id: "model", label: "模型" }], makings: {}, events: [], say: () => "", top: "medium" })
  expect(Object.fromEntries(rows.map((row) => [row.id, row.kindLabel]))).toEqual({ king_model: "模型 · 精细度 高", stick: "模型" })
})

test("「没量出毛病」说的是结构：动作另有自己的一栏，两栏各说各的范围", async () => {
  const source = await Bun.file(new URL("../src/renderer/features/asset-making.tsx", import.meta.url)).text()
  expect(source).toContain("结构上没量出毛病。")
  expect(source).not.toContain("这一轮没量出毛病")
  // The motions have their own heading and their own empty sentence beside it.
  expect(source).toContain('"每个动作动得怎么样"')
  expect(source).toContain('"动作连起来看"')
})

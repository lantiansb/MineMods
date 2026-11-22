import { expect, test } from "bun:test"
import { activityText, hasIdea, javaMajors, originalBrief, planCounts, playScope, savedLabel } from "../src/project-status"
import { projectGames } from "../src/renderer/features/resource-manager-model"
import { assetChip } from "../src/renderer/features/project-navigation-model"
import { cachedOverview, overviewKey } from "../src/renderer/features/overview-cache"
import { checkVersusReview } from "../src/renderer/features/asset-check-versus"
import { creatureFacets } from "@minemods/mod-core/creature-life"
import { openProject } from "@minemods/mod-core/project"
import { createCombinedSample } from "../../mod-core/script/target-combined-sample"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { GameTarget } from "../src/api"

const facts = { saved: true, accepted: null, built: false, gametest: null, client: null }
test("没有读到这一版总览时没有资产状态", () => {
  expect(cachedOverview(overviewKey("unknown", 9))).toBeNull()
})
test("蓝图数字只数本版条目，单列搁置项目", () => {
  expect(planCounts([{ out_of_scope: null }, { out_of_scope: "另做" }])).toEqual({ planned: 1, skipped: 1 })
})
test("机器通过和审查要求修改同时有记录时明说各自的结论", () => {
  expect(activityText({ tool: "self_review", mark: "fail", text: "旧记录" })).toBe("Studio 退回了这次提交的自评。")
  expect(checkVersusReview({ passed: true, unreadable: null }, { review: { passed: false, independent: true } })).toContain("审查要求修改")
})
test("已经被生物使用的血条按构建能力展示", () => {
  expect(assetChip({ id: "bar", module: "bossbar", status: "design" }, () => ["golem"], "forge-1.20.1")).toBe("")
})
test("工程卡和 Java 环境列出该工程的所有目标", () => {
  const forge = { target: "forge-1.20.1" } as const
  const catalogue = [{ id: forge.target, java: 17 }, { id: "fabric-1.21.1", java: 21 }] as GameTarget[]
  expect(projectGames(forge)).toBe("Forge 1.20.1")
  expect(javaMajors([forge], catalogue)).toEqual([17])
  expect(javaMajors([{ ...forge, targets: [forge.target, "fabric-1.21.1"] }], catalogue)).toEqual([17, 21])
})
test("手改的已保存不冒称 AI 检查通过", () => {
  expect(savedLabel({ status: "saved", facts, review_asked: false }, false)).toBe("已保存")
  expect(savedLabel({ status: "review", facts, review_asked: true }, true)).toBeNull()
})
test("手动造资产也要有实际的想法记录才勾选", () => {
  expect(hasIdea(undefined)).toBe(false)
  expect(hasIdea("做一只雪鹿")).toBe(true)
})
test("玩法检查数与整个工程数量各有口径", () => {
  expect(playScope(18, 6)).toBe("工程共 18 样 · 其中 6 样按玩法检查")
})
test("已关联并保存的蓝图说明只作历史记录", () => {
  expect(originalBrief({ key: "helmet", asset_id: "armor", facts })).toBe(true)
  expect(originalBrief({ key: "helmet", asset_id: null, facts })).toBe(false)
})
test("同一份生成来源覆盖巢和普通群系", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "status-"))
  try {
    await createCombinedSample(dir)
    const project = await openProject(dir)
    const asset = project.workspace.assets.find((asset) => asset.document.kind === "entity")!
    if (asset.document.kind !== "entity") throw Error("missing entity")
    const creature = { ...asset.document, behavior: "hostile" as const, runtime: { ...asset.document.runtime, spawn: null } }
    const lair: NonNullable<NonNullable<typeof creature.boss>["lair"]> = { spacing: 32, radius: 8, floor: ["minecraft:stone"], biomes: ["minecraft:plains"], above_sea: 1, clearance: 8, rim: null }
    const source = creatureFacets({ ...creature, boss: { ...creature.boss!, lair } }, project).filter((fact) => fact.question === "source")
    expect(source.some((fact) => fact.words.includes("巢随世界一起生成"))).toBe(true)
    expect(source.some((fact) => fact.words.includes("只能用它的刷怪蛋"))).toBe(false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

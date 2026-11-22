import { expect, test } from "bun:test"
import { lookJob } from "../src/main/look-job"
import { terrainAbility } from "../../mod-core/script/target-terrain-sample"
import { createDataGameplaySample } from "../../mod-core/script/data-gameplay-sample"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

test("临时地形在看招式中画出并说明升起与还原", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-terrain-"))
  try {
    const project = await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
    const creature = project.workspace.assets.find((a) => a.document.kind === "entity")!.document
    const model = project.workspace.assets.find((a) => a.document.kind === "model")!.document
    if (creature.kind !== "entity" || model.kind !== "model") throw new Error("SAMPLE_MISSING")
    expect(lookJob(model, null).budget_facts?.some((line) => line.startsWith("模型结构："))).toBe(true)
    const looked = lookJob({ ...creature, abilities: [terrainAbility] }, model)
    const ground = looked.job.sheets.find((s) => s.label.includes("地面效果和光束"))!
    expect(ground.cells).toHaveLength(5)
    expect(ground.cells.map((c) => c.label).join()).toContain("升起地形")
    expect(ground.cells.map((c) => c.label).join()).toContain("临时换块")
    expect(ground.cells.flatMap((c) => ("caption" in c ? c.caption : [])).join()).toContain("逐块还原")
    expect(ground.cells.every((c) => c.kind === "hit" && c.trails!.length > 0)).toBe(true)
    const breaking = { type: "break" as const, at: 1, where: "self" as const, hit: null, forward: 1, up: 0, left: 0, radius: 1, height: 3, hardness: 2, drops: false }
    const boss = { bar: { color: "white" as const, style: "progress" as const, darken_sky: false }, intro: null, phases: [], death: { seconds: 1.5, xp_bursts: 0, explosion: false }, leash: null, summon: { item: "minecraft:stick", block: null, consume: false, cooldown: 3, ahead: 2 } }
    const r14 = lookJob({ ...creature, boss, abilities: [{ ...terrainAbility, events: [breaking, ...terrainAbility.events] }] }, model)
    expect(r14.notes.join(" ")).toContain("打碎")
    expect(r14.notes.join(" ")).toContain("右键召唤")
    expect(r14.job.sheets.flatMap((sheet) => sheet.cells).flatMap((cell) => "caption" in cell ? cell.caption : []).join(" ")).toContain("硬度不超过 2")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createTargetSmallFieldsSample } from "../script/target-smallfields-sample"
import { assembleBuildSource } from "../src/build-source"
import { hasTargetJavac, targetJavac } from "./target-javac"

import { AssetEventSchema, versionGaps } from "../src/ability-asset"
import { HitWarnSchema } from "../src/entity-runtime"
import { warnWords } from "../src/creature-abilities"

test("预警的提前定住和淡出边界，以及创作者看到的说明", () => {
  const w = { seconds: 1, look: "ring", color: "purple", follow: "target", lock_before: 0.25, fade_seconds: 0.5 }
  expect(warnWords(HitWarnSchema.parse(w))).toContain("提前 0.25 秒定住")
  for (const changes of [{ follow: undefined }, { lock_before: 2 }, { fade_seconds: 4 }, { effect: "missing" }]) expect(HitWarnSchema.safeParse({ ...w, ...changes }).success).toBe(false)
})

test("方块危险区会说明目标游戏没有的粒子", () => {
  const event = AssetEventSchema.parse({ type: "hazard", at: 1, where: "self", forward: 0, left: 0, radius: 2, seconds: 4, color: "#6699ff", glow: false, damage: 2, hits: "everyone", effects: [], every_ticks: 10, particle: "gust" })
  const doc = { name: "霜纹地砖", events: [event] }
  expect(versionGaps(doc, "1.20.1").join("")).toContain("gust")
  expect(versionGaps(doc, "1.21.1")).toEqual([])
})

for (const target of ["forge-1.20.1", "fabric-1.21.1", "neoforge-1.21.1"] as const) {
  test(`${target} builds the small fields sample`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "smallfields-"))
    try {
      const project = path.join(root, "project")
      await createTargetSmallFieldsSample(project, target)
      const source = path.join(root, "source")
      await mkdir(source)
      await assembleBuildSource(project, source, fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)))
      const cp = target === "fabric-1.21.1" ? target + "-official" : target
      if (!hasTargetJavac(cp)) return
      const compiled = await targetJavac(cp, path.join(source, "src/main/java"))
      expect(compiled.output.split("\n").filter(line => line.includes("error"))).toEqual([])
      expect(compiled.code).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 240000)
}

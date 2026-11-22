import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { aliasIssues, particleDependencies } from "../src/particle-emission"
import { combatParticleCounts } from "../src/combat-particles"
import { createTargetEmitSample } from "../script/target-emit-sample"

let root: string
let java: string
let guide: string
let creature: Awaited<ReturnType<typeof createTargetEmitSample>>["entities"][number]
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "minemods-particle-combat-"))
  const project = path.join(root, "project"), source = path.join(root, "source")
  const saved = await createTargetEmitSample(project, "forge-1.20.1", true)
  creature = saved.entities[2]!
  await mkdir(source)
  const build = await assembleBuildSource(project, source, fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url)))
  guide = build.guide.markdown
  java = await readFile(path.join(source, "src/main/java/com/minemods/content_ember_yard/entity/StudioCreatureEntity3_eb111111.java"), "utf8")
}, 30000)
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

test("稳重生物先确定身体朝向，常驻粒子再按动画骨骼投到世界", () => {
  const tick = java.slice(java.indexOf("@Override public void tick()"))
  const settled = tick.indexOf("steadySettle();"), posed = tick.indexOf("hitboxPose();")
  expect(settled).toBeGreaterThanOrEqual(0)
  expect(posed).toBeGreaterThan(settled)
  expect(tick.indexOf("float[] move = hitboxMoved(0);", posed)).toBeGreaterThan(posed)
  expect(tick.slice(posed)).toContain("StudioEmit.offset(position(), yBodyRot")
})

test("硬直限制出招，战斗常驻粒子仍按存活目标判断", () => {
  const allows = java.slice(java.indexOf("private boolean combatAllows("), java.indexOf("private boolean abilityMayStart("))
  expect(allows).toContain("return combatStagger() < 0")
  const tick = java.slice(java.indexOf("@Override public void tick()"))
  const line = tick.split("\n").find(line => line.includes("StudioEmit.send(") && line.includes('"crit", 3,'))
  expect(line).toContain("tickCount % 2 == 0 && getTarget() != null && getTarget().isAlive()")
  expect(line).not.toContain("combatStagger")
})

test("阶段收尾按生物别名和直接资产分别生成，收集依赖、用量和说明", () => {
  const ids = ["eb111111-0000-4000-8000-000000000004", "eb111111-0000-4000-8000-000000000005"]
  expect(particleDependencies(creature).sort()).toEqual(ids)
  expect(aliasIssues({ ...creature, particles: {} }).some(issue => issue.path.join(".") === "boss.phases.0.finish.1.particle")).toBe(true)
  expect(combatParticleCounts(creature, creature.abilities ?? []).shows).toEqual({ vanilla: 0, own: 2 })
  for (const id of ids) expect(java).toContain(`bossShowOwnParticles("${id}"`)
  expect(guide).toContain("变身收尾时冒出炉火余烬")
})

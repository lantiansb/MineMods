import { expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { reviewAsset } from "../src/acceptance"
import { AbilitySchema } from "../src/entity-runtime"
import { genTarget } from "../src/platform/target"
import { reconcile } from "../src/reconcile"
import { TargetIdSchema } from "../src/target/ids"
import { targetManifest } from "../src/target/manifests"
import { creatureVanillaGaps, lacksOf, targetMinecraft, VERSION_LACKS } from "../src/version-lacks"
import { WorkspaceAssetSchema } from "../src/workspace"
import { kindInstructions } from "../src/workspace-modules"
import { golemAbilities } from "../script/data-gameplay-sample"
import { rainAbility } from "../script/target-projectile-sample"
import { abilityVersionGaps } from "../src/fabric/entity-abilities"
import { sampleProject } from "./fixtures/gameplay/sample"

/**
 * What a game version lacks is one list (`version-lacks.ts`): the version adapter, the build, the creature's acceptance when it is handed in, the project's findings
 * and the outside AI's words read it. The UI run of 2026-11-15 found a Forge 1.20.1 golem with `dust_plume` that passed every review and stopped only its build.
 */

test("the list is the version adapters' own, and each target's game version is its manifest's", () => {
  for (const target of TargetIdSchema.options) {
    const minecraft = targetMinecraft(target)
    expect(minecraft).toBe(targetManifest(target).minecraft.version)
    expect(genTarget(target).version.abilities.lacks).toEqual(lacksOf(minecraft))
  }
  expect(lacksOf("1.21.1")).toEqual({ particles: [], sounds: [] })
  expect(VERSION_LACKS["1.20.1"]!.particles).toContain("dust_plume")
})

// The golem sample's quake throws up `dust_plume`, a particle of 1.20.3 and later.
const abilities = golemAbilities.map((ability) => AbilitySchema.parse(ability))
const time = "2026-11-15T00:00:00.000Z"
const golem = (modelId: string) => ({
  kind: "entity", name: "石像", description: "", health: 200, speed: 0.25, attack_damage: 6, behavior: "hostile", model_asset_id: modelId, abilities,
  runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
})
const handedIn = (document: Record<string, unknown>) =>
  WorkspaceAssetSchema.parse({ id: randomUUID(), module: "entity", title: "石像", revision: 1, created_at: time, updated_at: time, prompt: "测试", dependencies: [], document, provenance: { model: null, request_id: null }, status: "ready" })

test("a creature naming a particle its target's game lacks is refused when it is handed in, in the build's words; on 1.21.1 nothing is said", () => {
  expect(creatureVanillaGaps({ name: "石像", abilities }, "1.20.1").map((gap) => gap.text).join()).toContain("dust_plume")
  for (const target of TargetIdSchema.options) {
    const project = { ...sampleProject(), target }
    const review = reviewAsset(project, handedIn(golem(randomUUID())))
    const found = review.findings.filter((finding) => finding.rule === "target_lacks_vanilla")
    if (targetMinecraft(target) === "1.20.1") {
      expect(review.passed).toBe(false)
      expect(JSON.stringify(found)).toContain("Minecraft 1.20.1 里还没有这个粒子")
    } else expect(found).toEqual([])
  }
})

test("the project's findings say it, as a stop, before a build is tried; the outside AI making a creature is told what its target lacks", () => {
  for (const target of TargetIdSchema.options) {
    const base = sampleProject()
    const entity = { ...base.entities[0]!, abilities }
    // Its model has every motion, so only what this test is about is said of it.
    const findings = reconcile({ ...base, target, entities: [entity, ...base.entities.slice(1)] }, { animations: Object.fromEntries(base.entities.map((value) => [value.id, ["idle", "walk", "hurt", "quake", "burst", "slam"]])) })
    const gap = findings.filter((finding) => finding.rule === "target_lacks_vanilla")
    if (targetMinecraft(target) === "1.20.1") expect(gap.length).toBeGreaterThan(0), expect(gap.every((finding) => finding.stops)).toBe(true)
    else expect(gap).toEqual([])
  }
  // The list of particles a creature may name is every target's; what a target's game lacks is said after it, for that target only.
  const forge = kindInstructions("entity", "forge-1.20.1")
  expect(forge).toContain("这个工程的目标是 Minecraft 1.20.1：招式和演出里不能用原版的粒子 dust_plume、gust，也不能用声音 entity.breeze.shoot")
  for (const target of ["fabric-1.21.1", "neoforge-1.21.1"] as const) expect(kindInstructions("entity", target)).not.toContain("这个版本还没有")
})

test("落地炸开: a thrown thing bursting into a particle its target's game lacks is refused the same way, at hand-in, in the findings and at the build", () => {
  const rain = AbilitySchema.parse({ ...rainAbility, hits: [{ ...rainAbility.hits[0], impact: { particle: "dust_plume", count: 8 } }] })
  const gaps = creatureVanillaGaps({ name: "雨师", abilities: [rain] }, "1.20.1")
  expect(gaps.map((gap) => gap.text)).toEqual(["「雨师」的招式「兵器雨」第 1 次出手扔出去的东西落地炸开（impact）时用了原版的「尘土」粒子（dust_plume），Minecraft 1.20.1 里还没有这个粒子。"])
  expect(creatureVanillaGaps({ name: "雨师", abilities: [rain] }, "1.21.1")).toEqual([])
  expect(abilityVersionGaps("雨师", [rain], genTarget("forge-1.20.1").version)).toEqual(gaps)
  expect(creatureVanillaGaps({ name: "雨师", abilities: [rainAbility] }, "1.20.1")).toEqual([])
  for (const target of TargetIdSchema.options) {
    const review = reviewAsset({ ...sampleProject(), target }, handedIn({ ...golem(randomUUID()), abilities: [rain] }))
    const found = review.findings.filter((finding) => finding.rule === "target_lacks_vanilla")
    if (targetMinecraft(target) === "1.20.1") expect(JSON.stringify(found)).toContain("落地炸开（impact）时用了原版的「尘土」粒子"), expect(review.passed).toBe(false)
    else expect(found).toEqual([])
    const base = sampleProject()
    const findings = reconcile({ ...base, target, entities: [{ ...base.entities[0]!, abilities: [rain] }, ...base.entities.slice(1)] }, { animations: Object.fromEntries(base.entities.map((value) => [value.id, ["idle", "walk", "hurt", "burst"]])) })
    const stops = findings.filter((finding) => finding.rule === "target_lacks_vanilla")
    if (targetMinecraft(target) === "1.20.1") expect(stops.length).toBe(1), expect(stops[0]!.stops).toBe(true)
    else expect(stops).toEqual([])
  }
})

import { expect, test } from "bun:test"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { reconcile } from "../src/reconcile"
import { breath, createTargetEmitSample } from "../script/target-emit-sample"
import { emitArguments } from "../src/common/emit"
import { samples } from "../script/target-particle-sample"
import { particlePreview } from "../src/particle-preview"
import { AbilitySchema } from "../src/entity-runtime"
import { type ParticleRef, aliasIssues, emitterPhaseIssues, EmittersSchema, emitIssues, emitTicks, particleDependencies, particleLabel, resolveAliases } from "../src/particle-emission"

const event = { type: "particle" as const, at: 0.15, until: 0.55, every_ticks: 3, count: 6, spread: { forward: 20, up: 0.1, left: 20 }, shape: "disc" as const }

test("工程粒子发射用注册编号，没写的速度分量为零", () => {
  const particle = { asset: "eb111111-0000-4000-8000-000000000004" }
  const burst = { ...event, particle, velocity: { left: 3 } }
  expect(emitArguments(burst, { [particle.asset]: 2 })).toBe('2, "", 6, 1, 20f, 0.1f, 20f, 0f, 0f, 3f, 0f, 0f, 0, 0f, -1')
  expect(() => emitArguments(burst)).toThrow("找不到")
})

test("continuous emission starts on the event tick and includes a due final tick", () => {
  expect(emitTicks(event)).toEqual([3, 6, 9])
  expect(emitTicks({ ...event, until: 0.6 })).toEqual([3, 6, 9, 12])
  expect(emitIssues([event], 1, [])).toEqual([])
})

test("budgets count bursts, including the first and last", () => {
  const full = { ...event, at: 0, until: 0.95, every_ticks: 2, count: 60 }
  expect(emitIssues([full, full], 1, [])).toEqual([])
  expect(emitIssues([full, full, full], 1, [])[0]?.message).toContain("超过 1500 颗上限 300 颗")
  expect(emitIssues([{ ...full, count: 61 }], 1, [])[0]?.message).toContain("超过 600 颗上限 10 颗")
})

test("each hit location and each channel pulse spends its own particles", () => {
  const hit = { type: "area", at: 0, place: { type: "pattern" as const, points: [1,2,3] } }
  const burst = { ...event, where: "hit", hit: 0, count: 25 }
  expect(emitIssues([burst], 1, [hit], 3)[0]?.message).toContain("共冒 675 颗")
})

test("aliases are local to the owner and reach all the stored particle slots", () => {
  const asset = { asset: "eb111111-0000-4000-8000-000000000004" }
  const slot: { particle: ParticleRef } = { particle: { alias: "火星" } }
  const creature = { particles: { 火星: asset }, abilities: [{ events: [slot], hits: [{ impact: slot, ground: slot }] }], boss: { intro: { steps: [slot] }, death: { steps: [slot] } }, emitters: [slot] }
  const resolved = resolveAliases(creature)
  expect(JSON.stringify(resolved)).not.toContain('"alias":')
  expect(creature.emitters[0]).toBe(slot)
  expect(particleDependencies(creature)).toEqual([asset.asset])
  expect(particleLabel(slot.particle, { aliases: creature.particles, title: () => "炉火余烬" })).toBe("炉火余烬")
  expect(resolveAliases({ particles: { 火星: "crit" as const }, events: [slot] }).events[0]?.particle).toBe("crit")
  expect(aliasIssues({ ...creature, particles: {} })).toHaveLength(6)
  const legacy = { particles: undefined, events: [{ particle: "crit" }] }
  expect(resolveAliases(legacy)).toBe(legacy)
})

test("state emitters require a radius, a real phase, and a bounded rate", () => {
  const base = { particle: "crit", every_ticks: 1, count: 1 }
  expect(EmittersSchema.safeParse([{ ...base, shape: "ring" }]).success).toBe(false)
  expect(EmittersSchema.safeParse([{ ...base, count: 31 }]).success).toBe(false)
  const emitters = EmittersSchema.parse([{ ...base, when: { phase: 2 } }])
  expect(emitterPhaseIssues({ emitters })).toHaveLength(1)
  expect(emitterPhaseIssues({ emitters, boss: { phases: [{}] } })).toEqual([])
})

test("环绕看图每刻旋转位置和速度，并使用工程粒子的阻力", () => {
  const document = { ...samples[2]!, gravity: 0, drag: 0.5 }
  const asset = "eb111111-0000-4000-8000-000000000004"
  const ability = AbilitySchema.parse({ ...breath, events: [{
    type: "particle", at: 0, particle: { asset }, count: 1, spread: 0, forward: 0, up: 0, left: 0,
    velocity: { left: 10 }, motion: { type: "orbit", turns: 1 },
  }] })
  const preview = particlePreview(ability, ModelDesignSchema.parse(fightingGolemDesign), 0.1, {}, () => ({ title: "金属火花", document }))
  const [x, y, z] = preview.groups[0]!.points[0]!
  expect(x).toBeCloseTo(-16 * 0.75 * Math.cos(Math.PI / 5))
  expect(y).toBe(0)
  expect(z).toBeCloseTo(-16 * 0.75 * Math.sin(Math.PI / 5))
  expect(preview.groups[0]!.frame).toStartWith("data:image/png;base64,")
})

test("preview keeps surviving bursts, samples a horizontal ring and shows the vanilla name", () => {
  const ability = AbilitySchema.parse({ ...breath, events: [{ type: "particle", at: 0, until: 0.2, every_ticks: 2, particle: "crit", count: 10, shape: "ring", spread: { forward: 20, up: 0.08, left: 20 }, forward: 0, up: 0, left: 0 }] })
  const design = ModelDesignSchema.parse(fightingGolemDesign)
  const frame = particlePreview(ability, design, 0.2)
  expect(frame.groups.map(g => g.points.length)).toEqual([10,10,10])
  for (const g of frame.groups) {
    expect(g.frame).toBeNull()
    expect(g.name.length).toBeGreaterThan(0)
    for (const [x,y,z] of g.points) {
      expect(Math.hypot(x,z) / 16).toBeCloseTo(20, 5)
      expect(Math.abs(y) / 16).toBeLessThanOrEqual(0.08)
    }
  }
  expect(particlePreview(ability, design, 0.2)).toEqual(frame)
  expect(particlePreview(ability, design, 1.2).groups).toEqual([])
})

test("招式粒子检查：有效的本地别名和原版粒子通过，坏引用指向具体事件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "particle-ref-"))
  try {
    const project = await createTargetEmitSample(directory, "fabric-1.21.1")
    const [entity] = project.entities
    const [move] = entity!.abilities!
    const first = move!.events.find((event) => event.type === "particle")!
    const missing = "eb111111-0000-4000-8000-000000000099"
    const findings = (events: NonNullable<typeof move>["events"]) => reconcile({
      ...project,
      entities: [{ ...entity!, abilities: [{ ...move!, events }] }],
    }, { animations: {}, gameplay: [] }).filter(({ rule }) => rule === "particle_reference")
    expect(findings(move!.events)).toEqual([])
    const broken = findings([{ ...first, particle: { alias: "spark" } }, { ...first, particle: { asset: missing } }])
    expect(broken).toHaveLength(2)
    expect(broken[0]).toMatchObject({
      stops: true,
      text: expect.stringContaining("招式「吐出火星」第 1 个事件"),
      fix: expect.stringContaining("换成可用的原版粒子"),
      refs: expect.arrayContaining([{ kind: "ability", id: move!.id, title: move!.name }]),
    })
    expect(broken[1]?.refs).toContainEqual({ kind: "asset", id: missing, title: "找不到的粒子" })

    const skill = project.workspace.assets.find(asset => asset.document.kind === "ability")!
    if (skill.document.kind !== "ability") throw new Error("缺技能样例")
    const use = { asset: skill.id, id: "shared_mist", clip: move!.clip, facing: "lock" as const, start: move!.start, stopped_by_hurt: false }
    const borrowed = { ...project, entities: [{ ...entity!, abilities: [], shared_abilities: [use] }] }
    const check = (value: typeof project) => reconcile(value, { animations: {}, gameplay: [] }).filter(finding => finding.rule === "particle_reference")
    expect(check(borrowed)).toEqual([])
    const override = { ...borrowed, entities: [{ ...borrowed.entities[0]!, shared_abilities: [{ ...use, particles: { 毒雾: { asset: missing } } }] }] }
    const affected = check(override)
    expect(affected).toHaveLength(2)
    expect(affected.every(finding => finding.about?.kind === "entity")).toBe(true)
    expect(affected[0]?.refs).toContainEqual({ kind: "ability", id: use.id, title: skill.document.name })
    const brokenSkill = {
      ...borrowed,
      workspace: { ...project.workspace, assets: project.workspace.assets.map(asset =>
        asset.id === skill.id && asset.document.kind === "ability"
          ? { ...asset, document: { ...asset.document, particles: { 毒雾: { asset: missing } } } }
          : asset) },
    }
    const skillFindings = check(brokenSkill)
    expect(skillFindings).toHaveLength(2)
    expect(skillFindings.every(finding => finding.about?.kind === "ability")).toBe(true)
    expect(skillFindings[0]?.text).toContain("第 1 个事件")
    expect(skillFindings[0]?.refs).toContainEqual({ kind: "asset", id: skill.id, title: skill.document.name })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

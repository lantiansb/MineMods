import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { BuiltinSchema, BUILTIN_LABELS } from "../src/builtin"
import { combatParticleCounts } from "../src/combat-particles"
import { compileEntity } from "../src/fabric/entity"
import { GROUND_FX_INSTRUCTIONS } from "../src/ground-fx"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { createTargetImpactSample, IMPACT_SAMPLE_IDS } from "../script/target-impact-sample"
import { hasTargetJavac, targetJavac } from "./target-javac"
import { AbilitySchema } from "../src/entity-runtime"
import { scorchAbility } from "../script/target-groundfx-sample"
import { ImpactFxSchema, IMPACT_INSTRUCTIONS, impactSlots } from "../src/impact-fx"
import { StaggerSchema, COMBAT_INSTRUCTIONS } from "../src/combat"
import { stageWords } from "../src/ability-tactics"
import { dashWords } from "../src/ability-dash"
import { ABILITY_INSTRUCTIONS } from "../src/creature-abilities"
import { soundMoments, soundUsers } from "../src/sound-moments"
import { creatureSoundIds } from "../src/sound"
import { particleDependencies } from "../src/particle-emission"
import { creatureVanillaGaps } from "../src/version-lacks"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const base = { modId: "impact_mod", packageName: "org.example.impact", id: "bison", name: "野牛", health: 30, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const creature = (input: Record<string, unknown> = {}) => String(Object.entries(compileEntity({ ...base, ...input } as never)).find(([file]) => file.endsWith("/StudioCreature.java"))![1])

// ---- 1. the puff where a dead body goes ----

test("builtin.death_poof: off, swapped, or left out (the creature then is what it always was)", () => {
  expect(BuiltinSchema.safeParse({ death_poof: { particle: "none" } }).success).toBe(true)
  expect(BuiltinSchema.safeParse({ death_poof: { particle: { asset: IMPACT_SAMPLE_IDS.dust } } }).success).toBe(true)
  // There is no sound to it: the game plays none.
  expect(BuiltinSchema.safeParse({ death_poof: { sound: "none" } }).success).toBe(false)
  expect(BUILTIN_LABELS.death_poof).toBe("死后消失时那团白烟")
  const plain = creature()
  expect(plain).not.toContain("handleEntityEvent")
  const off = creature({ builtin: { death_poof: { particle: "none" } } })
  expect(off).toContain("if (id != net.minecraft.world.entity.EntityEvent.POOF) {\n            super.handleEntityEvent(id);\n            return;\n        }\n    }")
  expect(off).not.toContain("ParticleTypes.POOF")
  const swapped = creature({ builtin: { death_poof: { particle: "flame" } } })
  expect(swapped).toContain(`var puff = StudioBuiltin.particle(this, "death_poof", net.minecraft.core.particles.ParticleTypes.POOF);`)
  expect(swapped).toContain("for (int i = 0; i < 20; i++)")
  // Everything else of the creature is untouched: take the new method out and the rest is the plain creature, to the byte.
  expect(swapped.replace(/    @Override public void handleEntityEvent\(byte id\) \{[\s\S]*?\n    \}\n\n/, "")).toBe(plain)
})

test("the said words: the instructions tell death_poof from death_burst, and the particle count names it once it is changed", () => {
  expect(GROUND_FX_INSTRUCTIONS).toContain("builtin.death_poof.particle 管的就是这团白烟")
  expect(GROUND_FX_INSTRUCTIONS).toContain("builtin.death_burst 只管 Boss 死亡演出最后那一下爆炸的光和声")
  const counted = (builtin?: unknown) => combatParticleCounts({ name: "野牛", behavior: "hostile", builtin } as never, []).builtin
  expect(counted()).toEqual([])
  expect(counted({ death_poof: { particle: "none" } })).toEqual([{ where: "死后消失时那团白烟", kind: "particle", id: "POOF", name: "白烟", replacement: "none", own: false }])
})

// ---- 2. the moment it runs into something ----

const fx = { sound: "entity.ravager.attack", particle: "crit" } as const
const charge = (end: Record<string, unknown>, dash: Record<string, unknown> = {}) => ({
  ...scorchAbility, id: "charge", name: "冲撞", windup: 0.4, length: 1.2, events: [],
  hits: [{ type: "area", at: 0.45, shape: { type: "box", forward: 1, up: 1, left: 0, width: 1.5, height: 2, depth: 1.5 }, hits: "everyone", damage: 4, knockback: 1, effects: [] }],
  stages: [{ kind: "windup", until: 0.4 }, { kind: "loop", until: 1.2, end }],
  moves: [{ type: "dash", from: 0.4, to: 1.2, speed: 14, distance: 10, aim: "locked_at_windup", hit: null, stop_at_wall: true, ...dash }],
})

test("the schema: what a moment of impact may hold, and where it may be written", () => {
  expect(ImpactFxSchema.safeParse({}).success).toBe(false)
  expect(ImpactFxSchema.safeParse({ count: 4 }).error?.issues.map((issue) => issue.message)).toContain("写了 particle 才写 count 和 spread。")
  expect(ImpactFxSchema.safeParse({ shake: { strength: 1, radius: 8, seconds: 0.3 } }).success).toBe(true)
  expect(ImpactFxSchema.safeParse({ sound: { asset: IMPACT_SAMPLE_IDS.thud }, particle: { alias: "土尘" }, count: 8, spread: 0.5 }).success).toBe(true)
  const parsed = (end: Record<string, unknown>, dash?: Record<string, unknown>) => AbilitySchema.safeParse(charge(end, dash))
  expect(parsed({ collision: [{ when: { if: "collision", with: "world" }, result: { interrupt: true, impact: fx } }] }).success).toBe(true)
  // An impact alone is no result: what it does when it meets a wall is still to be said.
  expect(parsed({ collision: [{ when: { if: "collision", with: "world" }, result: { impact: fx } }] }).success).toBe(false)
  expect(parsed({ touch: true, impact: { touch: fx } }).success).toBe(true)
  expect(parsed({ touch: true, impact: {} }).success).toBe(false)
  expect(parsed({ touch: true }, { impact: { wall: fx } }).success).toBe(true)
  expect(StaggerSchema.safeParse({ seconds: 1, damage_scale: 1.5, on_interrupt: true, enter: fx }).success).toBe(true)
})

test("the checks say in plain words what a moment of impact still lacks", () => {
  // They are the ability's own checks (its schema refuses it with them).
  const issues = (end: Record<string, unknown>, dash?: Record<string, unknown>) => AbilitySchema.safeParse(charge(end, dash)).error?.issues.map((issue) => issue.message) ?? []
  expect(issues({ touch: true, impact: { wall: fx } }).some((message) => message.includes("请在 end 里同时写 wall:true"))).toBe(true)
  expect(issues({ wall: true, impact: { touch: fx } }).some((message) => message.includes("请在 end 里同时写 touch:true"))).toBe(true)
  expect(issues({ touch: true }, { impact: { touch: fx } }).some((message) => message.includes("请给冲刺写 hit"))).toBe(true)
  expect(issues({ touch: true, impact: { touch: fx } })).toEqual([])
})

test("one order of the moments for the Java and every reader; the words say 撞上时, not a second", () => {
  const abilities = [AbilitySchema.parse(charge({ collision: [{ when: { if: "collision", with: "world" }, result: { stagger: "wall_daze", impact: fx } }], touch: true, impact: { touch: fx } }, { impact: { wall: fx } }))]
  const slots = impactSlots(abilities, [{ id: "wall_daze", enter: fx }])
  expect(slots.map((slot) => [slot.key, slot.words, slot.path.join(".")])).toEqual([
    ["a0.s1.c0", "招式「冲撞」循环段撞墙时", "stages.1.end.collision.0.result.impact"],
    ["a0.s1.touch", "招式「冲撞」循环段撞到生物时", "stages.1.end.impact.touch"],
    ["a0.dash.wall", "招式「冲撞」冲刺撞墙时", "moves.0.impact.wall"],
    ["stagger.0", "进入硬直「wall_daze」时", "stagger.0.enter"],
  ])
  expect(stageWords(abilities[0]!)).toContain("撞到世界方块时进入硬直「wall_daze」，撞上时响「劫掠兽撞击」、冒「暴击星」12 颗")
  expect(stageWords(abilities[0]!)).toContain("碰到人的那一刻响「劫掠兽撞击」")
  expect(dashWords(abilities[0]!)).toContain("撞墙的那一刻响「劫掠兽撞击」")
  expect(ABILITY_INSTRUCTIONS).toContain(IMPACT_INSTRUCTIONS)
  expect(COMBAT_INSTRUCTIONS).toContain("每种硬直可写 enter")
})

test("a creature without a moment of impact is generated as before: nothing of it, and a wall that dazes it now imports what it names", () => {
  const plain = creature({ abilities: [AbilitySchema.parse(charge({ collision: [{ when: { if: "collision", with: "world" }, result: { stagger: "wall_daze" } }] }))], stagger: [{ id: "wall_daze", seconds: 2, damage_scale: 1.5 }] })
  expect(plain).not.toContain("abilityImpact")
  expect(plain).not.toContain("r29")
  // r28's `abilityContact(Vec3 delta)` was written without the import whenever nothing else needed Vec3 (javac: cannot find symbol on every target).
  expect(plain).toContain("import net.minecraft.world.phys.Vec3;")
  expect(plain).toContain("private boolean abilityContact(Vec3 delta) {")
  const shown = creature({ abilities: [AbilitySchema.parse(charge({ collision: [{ when: { if: "collision", with: "world" }, result: { stagger: "wall_daze", impact: fx } }] }))], stagger: [{ id: "wall_daze", seconds: 2, damage_scale: 1.5, enter: fx }] })
  expect(shown).toContain("abilityImpactOnce(0, abilityImpactFront(delta));\n                combatFall(0, getDeltaMovement(), combatDriven(), 0); return true;")
  expect(shown).toContain("switch (kind) { case 0 -> abilityImpact(1, position().add(0.0, getBbHeight() * 0.5, 0.0)); default -> { } }")
})

test("the sound table, who uses the sound, the particle it depends on and the version gaps read the same moments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "impact-words-"))
  try {
    const project = await createTargetImpactSample(path.join(root, "project"), "forge-1.20.1")
    const bison = project.entities[1]!
    const rows = soundMoments(project, bison.id).filter((row) => row.detail === "撞上那一刻放，不按第几秒")
    expect(rows.map((row) => [row.where, row.path.join("."), row.name])).toEqual([
      ["招式「冲撞」循环段撞墙时", "abilities.0.stages.1.end.collision.0.result.impact.sound", "闷响"],
      ["招式「冲撞」循环段撞到生物时", "abilities.0.stages.1.end.impact.touch.sound", "劫掠兽撞击"],
      ["招式「撞门」冲刺撞墙时", "abilities.1.moves.0.impact.wall.sound", "砸铁门声"],
      ["招式「撞门」冲刺撞到生物时", "abilities.1.moves.0.impact.touch.sound", "闷响"],
      ["进入硬直「wall_daze」时", "stagger.0.enter.sound", "铁砧落地"],
    ])
    expect(soundUsers(project, IMPACT_SAMPLE_IDS.thud).map((user) => user.where)).toEqual(["招式「冲撞」循环段撞墙时", "招式「撞门」冲刺撞到生物时"])
    expect(creatureSoundIds(bison)).toContain(IMPACT_SAMPLE_IDS.thud)
    expect(particleDependencies(bison)).toContain(IMPACT_SAMPLE_IDS.dust)
    // A sound 1.20.1 does not have, written for the moment of impact, is stopped before the build like one in an event.
    const breeze = { ...bison, abilities: [AbilitySchema.parse(charge({ touch: true, impact: { touch: { sound: "entity.breeze.shoot" } } }))] }
    expect(creatureVanillaGaps(breeze, "1.20.1").map((gap) => gap.text).join()).toContain("循环段撞到生物时")
    expect(creatureVanillaGaps(breeze, "1.21.1")).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60000)

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const)
  for (const impacts of [true, false])
    test(`${target}: the impact sample (a dazed bison${impacts ? " with its moments of impact" : ", as r28 could write it"}, the puffs) builds and compiles`, async () => {
      const cp = target === "fabric-1.21.1" ? "fabric-1.21.1-official" : target
      const root = await mkdtemp(path.join(os.tmpdir(), "impact-javac-"))
      try {
        await createTargetImpactSample(path.join(root, "project"), target, { impacts })
        await mkdir(path.join(root, "source"))
        await assembleBuildSource(path.join(root, "project"), path.join(root, "source"), TEMPLATE)
        const java = path.join(root, "source/src/main/java")
        const sources = (await Promise.all((await readdir(java, { recursive: true })).filter((file) => file.endsWith(".java")).map((file) => readFile(path.join(java, file), "utf8")))).join("\n")
        expect(sources).toContain(`StudioBuiltin.particle(this, "death_poof", net.minecraft.core.particles.ParticleTypes.POOF)`)
        expect(sources).toContain(`/death_poof" -> "none";`)
        expect(sources.match(/public void handleEntityEvent\(byte id\)/g)?.length).toBe(2)
        expect(sources.match(/abilityImpact(?:Once)?\(\d+, /g)?.length ?? 0).toBe(impacts ? 5 : 0)
        if (!hasTargetJavac(cp)) return
        const compiled = await targetJavac(cp, java)
        if (compiled.code) console.log(compiled.output)
        expect(compiled.code).toBe(0)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }, 300000)

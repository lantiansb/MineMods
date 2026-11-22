import { expect, test } from "bun:test"
import type { ModelDesign } from "@minemods/studio-ai/contracts"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { ABILITY_INSTRUCTIONS, abilityTick } from "../src/creature-abilities"
import { leapPlan } from "../src/ability-tactics"
import { AbilitySchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"

const id = "guide_guard"
const packageName = "com.minemods.content_" + id
const entityPath = "src/main/java/com/minemods/content_" + id + "/entity/StudioCreature.java"
const source = golemAbilities[0]!
const area = source.hits.find((hit) => hit.type === "area")!
const ability = AbilitySchema.parse({
  ...source, windup: 0.5, length: 1.2,
  moves: [{ type: "leap", at: 0.15, land: 0.53, height: 1, aim: "target", max_distance: 6 }],
  hits: [
    { ...area, at: 0.53, damage: 0, once_group: "same_landing" },
    { ...area, at: 0.7, damage: 7, once_group: "same_landing" },
  ],
  events: [
    { type: "sound", at: 0.53, sound: "entity.iron_golem.attack", where: "hit", hit: 0, volume: 0.65, pitch: 1, range_blocks: 48 },
  ],
})
const phase = { clip: null, seconds: 1, bar_color: null, speed: 1.2, damage: 1.3 }
const inputs = {
  modId: id, packageName, id: "creature", name: "落岩守卫", health: 40, speed: 0.25, attack_damage: 3, behavior: "hostile",
  model: fightingGolemDesign as unknown as ModelDesign, abilities: [ability],
  boss: { bar: { color: "red", style: "progress", darken_sky: false }, intro: null, phases: [{ ...phase, below: 0.6 }, { ...phase, below: 0.3 }], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null },
  emitters: [
    { particle: "flame", every_ticks: 7, count: 1, when: { phase: 2 } },
    { particle: "flame", every_ticks: 11, count: 1, when: { if: "phase_range", from: 2 } },
  ],
}

for (const target of ["fabric-1.21.1", "forge-1.20.1", "neoforge-1.21.1"] as const) {
  const java = String(compileEntity(inputs, genTarget(target))[entityPath])

  test(target + "：常驻发射限定实战中的一个阶段，阶段范围另算", () => {
    expect(ABILITY_INSTRUCTIONS).toContain("只在 Boss 正打到第二阶段时发射")
    expect(java).toContain("tickCount % 7 == 0 && bossState() == BOSS_FIGHT && bossPhase() == 1")
    expect(java).toContain("tickCount % 11 == 0 && bossState() == BOSS_FIGHT && bossPhase() >= 1")
  })

  test(target + "：跳扑先走完落地步，同刻出手在声光之前", () => {
    expect(ABILITY_INSTRUCTIONS).toContain("落地刻处理出手和声光之前已走完落地动作")
    expect(abilityTick(0.53)).toBe(11)
    expect(leapPlan(ability)).toMatchObject({ start: 3, ticks: 8 })
    expect(java).toMatch(/if \(tick == 3\)[\s\S]*?abilityLeapStart\(8,/)
    expect(java).toMatch(/tickAbility\(\);\s*abilityLeapTick\(\);/)
    expect(java).toMatch(/abilityLeapStep\+\+;[\s\S]*?if \(abilityLeapStep >= abilityLeapTicks\) y -= 0\.1;[\s\S]*?move\(/)
    const step = java.slice(java.indexOf("private void abilityStep0"))
    const landingTick = step.slice(step.indexOf("if (tick == 11)"), step.indexOf("if (tick == 14)"))
    expect(landingTick).toMatch(/abilityStrike[\s\S]*?emitHitPoint\[0\]\s*=[\s\S]*?playSound\(/)
  })

  test(target + "：零伤害仍然记录命中，声音沿用出手位置", () => {
    expect(ABILITY_INSTRUCTIONS).toContain("写 0 伤害也能打中")
    expect(java).toMatch(/group\.seen\(victim\)[\s\S]*?abilityStrike\(victim, repeat \? 0\.0f : 0\.0f,[\s\S]*?group\.mark\(victim\)/)
    expect(java).toMatch(/private boolean abilityStrike\([\s\S]*?if \(damage > 0\.0f && !victim\.hurt\([\s\S]*?return false;[\s\S]*?return true;/)
    expect(java).toMatch(/soundAt = emitHitPoint\[0\]/)
  })

  test(target + "：音量原值交给游戏，传播距离独立", () => {
    expect(ABILITY_INSTRUCTIONS).toContain("体型和档位不改这个数")
    expect(java).toMatch(/playSound\(null, soundAt.x, soundAt.y, soundAt.z, StudioSoundRange.wrap\([^;]*?, 48\), [^,]+, 0\.65f, 1\.0f\)/)
  })
}

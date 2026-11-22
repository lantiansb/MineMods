import { compileEntity } from "../src/fabric/entity"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { partAbility } from "../script/target-hitbox-sample"
import { expect, test } from "bun:test"
import { bearingMatches, combatAdvice, combatIssues, combatResult, CombatConditionSchema, combatScaleTable, combatWeight, interruptProgress, InterruptSchema, StaggerSchema } from "../src/combat"
import { abilityWords } from "../src/creature-abilities"
import { readGeneratedCreature } from "../src/creature-contract"
import { AbilitySchema, AbilityStartSchema, SharedAbilityUseSchema } from "../src/entity-runtime"
import { bossPhaseIds } from "../src/boss-words"

test("0 倍的盾砍得开：零掉血的有效来击按原始量累计破防", () => {
  const files = compileEntity({ modId:"combat_guard", packageName:"org.example.guard", id:"guard", name:"石盾卫", health:100, speed:0.2, attack_damage:1,
    model:fightingGolemDesign, behavior:"hostile", abilities:[partAbility], hitbox:{core:{width:1,height:2}, parts:[{name:"盾",forward:1,up:1,left:0,width:1,height:1,damage_scale:0}]},
    stagger:{seconds:2,damage_scale:2,poise:{amount:{points:12},reset_seconds:4,immune_seconds:1}} })
  const java = String(Object.entries(files).find(([file]) => file.endsWith("/StudioCreature.java"))![1])
  expect(java).toContain("hurt || (eligible && (amount <= 0 || blocked))")
  expect(java).toContain("combatTriggers(before, raw)")
  expect(java).toContain("combatPoise[0] += raw")
  expect(java).toContain("combatFall(fall, beforeMotion, driven, combatKnockbacks - beforeKnockbacks)")
})

test("背后方位跨过正后方，保持同一个目标足够久才加权", () => {
  const when = { if: "target_bearing", arc: [120,-120], seconds: 1 } as const
  const move = AbilityStartSchema.parse({ ...partAbility.start, when: [when], keep_heading: true, weight_when: [{ ...when, scale: 5 }] })
  const parsed = move.when![0]!
  if (parsed.if !== "target_bearing") throw new Error("Expected a target bearing")
  expect(bearingMatches(parsed, 180, 20)).toBe(true)
  expect(bearingMatches(parsed, -129, 19)).toBe(false)
  expect(bearingMatches(parsed, 0, 20)).toBe(false)
  expect(combatWeight(move, 1, true, undefined, undefined, { angle: -129, ticks: 20 })).toBe(partAbility.start.weight * 5)
})

test("只有破绽时单招说明和生成对账都认打断，借用受击有自己的硬直动作", () => {
  const openings = [{ from: 0, to: 0.5, damage_scale: 1, group: "core" }]
  const breaks = [{ group: "core", hits: 2, result: { interrupt: true, stagger: "default" } }]
  const move = AbilitySchema.parse({ ...partAbility, stopped_by_hurt: undefined, openings, breaks })
  const shared = SharedAbilityUseSchema.parse({
    asset: "ac610000-0000-4000-8000-000000000001", id: move.id, clip: move.clip,
    facing: move.facing, start: move.start, openings, breaks,
  })
  expect(shared.stopped_by_hurt).toBe(false)
  const stagger = StaggerSchema.parse({ seconds: 1, damage_scale: 1, clip: "hurt" })
  const draft = { modId: "cut_stone", packageName: "org.example.cut", id: "stone", name: "石卫", health: 100, speed: 0.28, attack_damage: 1,
    model: fightingGolemDesign, behavior: "hostile", abilities: [move] }
  const generate = (stagger: unknown) => compileEntity({ ...draft, stagger })
  const java = String(Object.entries(generate(stagger)).find(([file]) => file.endsWith("/StudioCreature.java"))![1])
  expect(abilityWords.summary(move, "，", undefined, undefined, stagger)).toContain("进入硬直 1 秒，别的挨打不会停")
  expect(readGeneratedCreature(java, null).abilities[0]).toMatchObject({ hurt_stops: false, break_stops: true })
  expect(java).toContain("return state.setAndContinue(staggerHurt0);")
  expect(generate({ seconds: 1, damage_scale: 1, clip: null })).toEqual(generate({ seconds: 1, damage_scale: 1 }))
  for (const clip of ["idle", "walk", "death"]) expect(StaggerSchema.safeParse({ seconds: 1, damage_scale: 1, clip }).success).toBe(false)
})

test("part windows override the whole body, then the phase, and bypass guard", () => {
  const move = { name: "重踏", length: 1, openings: [{ from: 0.2, to: 0.7, damage_scale: 2 }, { from: 0.3, to: 0.5, part: "盾", damage_scale: 3 }] }
  const table = combatScaleTable({ abilities: [move], guard: { arc: 120, by: "any", damage_scale: 0.2 }, boss: { phases: [{}] },
    hitbox: { parts: [{ name: "盾", damage_scale: 0, phase_scales: [{ phase: 1, damage_scale: 0.5 }] }] } })
  const rows = table.filter(row => row.phase === 1 && row.part === "盾")
  const round = combatScaleTable({abilities:[move],guard:{arc:360,by:"any",damage_scale:0.2}})
  expect(round[0]?.back).toBe(0.2)
  expect(rows.map(row => [row.from, row.front, row.back])).toEqual([[0,0.1,0.5],[4,2,2],[6,3,3],[10,2,2],[14,0.1,0.5]])
})

test("interrupt distinguishes final loss from qualified hits inside a part window", () => {
  const rule = InterruptSchema.parse({ hits: 2, total: { points: 6 }, part: "盾", from: 0.2, to: 0.5 })
  const hit = { lost: 0, max: 30, part: "盾" }
  expect(interruptProgress(rule, hit, 3, 0, 0).hits).toBe(0)
  expect(interruptProgress(rule, { ...hit, part: "壳" }, 4, 0, 0).hits).toBe(0)
  expect(interruptProgress(rule, hit, 4, 0, 0)).toEqual({ total: 0, hits: 1, stop: false })
  expect(interruptProgress(rule, hit, 9, 0, 1).stop).toBe(true)
  expect(interruptProgress(rule, hit, 10, 0, 1).stop).toBe(false)
})

test("repeat recovers from the end of a choice and matching rules multiply", () => {
  const start = AbilityStartSchema.parse({ weight: 5, min_distance: 0, max_distance: 5, line_of_sight: false, cooldown: 1,
    repeat: { weight_scale: 0, recover_seconds: 2 }, weight_when: [{ if: "no_sight", scale: 3 }, { if: "health_below", share: 0.5, scale: 2 }] })
  expect([undefined, 0, 20, 40, 80].map(age => combatWeight(start, 0.3, false, age))).toEqual([30, 0, 15, 30, 30])
  expect(combatWeight(start, 0.5, true)).toBe(5)
  expect(bossPhaseIds([{ abilities: [] }], ["slam"], true)).toEqual([["slam"], []])
  expect(bossPhaseIds([{ abilities: [] }], ["slam"])).toEqual([["slam"], ["slam"]])
  expect(bossPhaseIds([{ abilities: ["slam"] }], ["slam"], true)).toEqual([[], ["slam"]])
})

test("拒绝不起作用的战斗条件，并给可修复的数值冲突提供说明", () => {
  expect(AbilityStartSchema.safeParse({...partAbility.start,line_of_sight:true,weight_when:[{if:"no_sight",scale:2}]}).success).toBe(false)
  expect(CombatConditionSchema.safeParse({if:"stance",id:"sleep"}).success).toBe(true)
  expect(combatResult({interrupt:true,stagger:"kneel"})).toEqual({interrupt:true,stagger:"kneel",events:[]})
  const move=AbilitySchema.parse({...partAbility,stopped_by_hurt:true,interrupt:{hit:{points:12}}})
  const creature={behavior:"hostile",health:100,boss:{damage_cap:10},abilities:[move],guard:{by:"any" as const,arc:360,damage_scale:0}}
  expect(combatIssues(creature).map(row=>row.path.join("."))).toEqual(["guard","abilities.0.interrupt.hit"])
  expect(combatAdvice(creature).some(row=>row.detail==="guard")).toBe(true)
  expect(combatIssues({...creature,guard:undefined,stagger:{seconds:1,damage_scale:2}}).some(row=>row.path[0]==="stagger")).toBe(true)
})

test("a loop's collision rule that starts a stagger calls combatFall with all four arguments", async () => {
  const { terrainAbility } = await import("../script/target-terrain-sample")
  const ability = AbilitySchema.parse({
    ...terrainAbility,
    stages: [{ kind: "windup", until: 0.7 }, { kind: "loop", until: terrainAbility.length, end: { collision: [{ when: { if: "collision", with: "world" }, result: { stagger: "dazed" } }] } }],
    moves: [{ type: "dash", from: 0.7, to: 1, speed: 12, distance: 3, aim: "locked_at_windup", hit: null, stop_at_wall: true }],
  })
  // No cooldown or max_times: the plain stagger, the case that was written with one argument (combatFall(0)) and did not compile.
  const files = compileEntity({ modId: "combat_charge", packageName: "org.example.charge", id: "charger", name: "冲撞兽", health: 60, speed: 0.25, attack_damage: 3,
    model: fightingGolemDesign, behavior: "hostile", abilities: [ability], stagger: [{ id: "dazed", seconds: 1, damage_scale: 1.5, at_health: [0.5] }] } as never)
  const java = String(Object.entries(files).find(([file]) => file.endsWith("/StudioCreature.java"))![1])
  expect(java).toContain("combatFall(0, getDeltaMovement(), combatDriven(), 0); return true;")
  expect(java).not.toMatch(/combatFall\(\d+\);/)
})

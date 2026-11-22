import { expect, test } from "bun:test"
import { arenaPlan, ArenaSchema } from "../src/arena"
import { CombatConditionSchema, CombatResultSchema, combatWeight } from "../src/combat"
import { feasibleArc, litInArc } from "../src/fixture-conditions"
import { BuiltinSchema } from "../src/builtin"
import { combatParticleCounts, particleReport } from "../src/combat-particles"
import { fixtureIssues, fixtureReview } from "../src/fixture-checks"
import { FixtureActionSchema, fixtureSlots } from "../src/fixture-events"
import { AbilitySchema, BossSchema } from "../src/entity-runtime"

const group = {
  id: "lamps",
  look: { asset: "90d460bd-c5da-495b-a410-196ed428f35d" },
  place: { ring: { count: 6, radius: 10 } },
  use: { by: "hit", seconds: 0, cooldown: 1, lit_seconds: null },
  clear: { radius: 3, seconds: 4 },
}
const arena = ArenaSchema.parse({ fixtures: [group], fog: null })
const boss = BossSchema.parse({
  bar: { color: "red", style: "progress", darken_sky: false },
  intro: null,
  phases: [],
  death: { seconds: 2, xp_bursts: 0, explosion: false },
  leash: null,
  arena,
})
const makeMove = (which: unknown, at = 0.5) =>
  AbilitySchema.parse({
    id: "gust",
    name: "吹灯",
    clip: "attack",
    windup: 0.1,
    length: 1,
    facing: "lock",
    moves: [],
    stopped_by_hurt: true,
    start: { min_distance: 0, max_distance: 10, line_of_sight: false, cooldown: 1, weight: 1 },
    hits: [
      {
        type: "area",
        at: 0.5,
        shape: { type: "sphere", forward: 3, up: 1, left: 0, radius: 2 },
        hits: "everyone",
        damage: 2,
        knockback: 0,
        effects: [],
      },
    ],
    events: [{ type: "fixture", at, do: "ember", which }],
  })

test("组与实例独立点名，混合名单按场地顺序去重", () => {
  expect(fixtureSlots(arena, { group: "lamps" })).toEqual([0, 1, 2, 3, 4, 5])
  expect(fixtureSlots(arena, [{ instance: "lamps_5" }, { instance: "lamps_2" }, { instance: "lamps_5" }])).toEqual([
    1, 4,
  ])
  expect(FixtureActionSchema.safeParse({ type: "fixture", do: "ember", which: { instance: "lamps_4" } }).success).toBe(
    true,
  )
  expect(CombatResultSchema.safeParse({ fixture: { do: "light", which: "nearest" } }).success).toBe(true)
})

test("六灯总角 60 度只在临界朝向容下两座，59 度不足", () => {
  const spots = arenaPlan(arena).fixtures
  expect(litInArc(spots, 0, 60)).toBe(1)
  expect(litInArc(spots, 30, 60)).toBe(2)
  expect(feasibleArc(spots, { if: "fixtures_lit", count: 2, within_arc: 60 })).toEqual({ max: 2, narrow: true })
  expect(feasibleArc(spots, { if: "fixtures_lit", count: 2, within_arc: 59 })).toEqual({ max: 1, narrow: false })
  expect(CombatConditionSchema.safeParse({ if: "fixtures_lit", count: 2, within_arc: 361 }).success).toBe(false)
  const start = { weight: 2, weight_when: [{ if: "fixtures_lit" as const, count: 2, within_arc: 60, scale: 3 }] }
  expect(combatWeight(start, 1, true, 0, (arc) => litInArc(spots, 30, arc))).toBe(6)
  expect(combatWeight(start, 1, true, 0, (arc) => litInArc(spots, 0, arc))).toBe(2)
})

test("亮灯角度提醒能定位招式、物件组和物件资产", () => {
  const move = makeMove("all")
  const start = { ...move.start, when: [{ if: "fixtures_lit" as const, count: 2, within_arc: 59 }] }
  const [finding] = fixtureReview({ boss, abilities: [{ ...move, start }] })
  expect(finding?.refs.map(({ kind, id }) => [kind, id])).toEqual([
    ["ability", move.id], ["fixture", group.id], ["asset", group.look.asset],
  ])
})

test("无场地、未知实例、出手类型与先后、演出不能引用出手", () => {
  expect(
    fixtureIssues({ abilities: [makeMove("all")] })
      .map((issue) => issue.message)
      .join(),
  ).toContain("请在 boss.arena.fixtures")
  expect(fixtureIssues({ boss, abilities: [makeMove({ instance: "missing" })] })[0]?.message).toContain(
    "这座物件 missing",
  )
  expect(fixtureIssues({ boss, abilities: [makeMove({ in_hit: 0 }, 0.2)] })[0]?.message).toContain("先出手")
  expect(fixtureIssues({ boss, abilities: [makeMove({ in_hit: 1 })] })[0]?.message).toContain("范围出手")
  expect(fixtureIssues({ boss, abilities: [makeMove({ in_hit: 0 })] })).toEqual([])
  expect(
    fixtureIssues({
      boss: {
        ...boss,
        death: { ...boss.death, steps: [{ type: "fixture", at: 0, do: "douse", which: { in_hit: 0 } }] },
      },
    })[0]?.message,
  ).toContain("演出")
})

test("亮灯和余烬光照是独立可选的整数；余烬可熄光或降级", () => {
  const parse = (fields: Record<string, number>) =>
    ArenaSchema.safeParse({ fixtures: [{ ...group, ...fields }], fog: null })
  expect(parse({}).data?.fixtures[0]).not.toHaveProperty("light")
  expect(parse({ light: 15, ember_light: 4 }).success).toBe(true)
  expect(parse({ light: 0, ember_light: 0 }).success).toBe(true)
  for (const fields of [{ light: 16 }, { light: -1 }, { light: 1.5 }, { light: 4, ember_light: 5 }, { ember_light: 2 }])
    expect(parse(fields as Record<string, number>).success).toBe(false)
})

test("余烬的火苗按场地记账；关掉或换工程效果以后不计作原版", () => {
  const move = makeMove("all")
  const creature = {name:"萤晶哨塔", boss, runtime:null, hitbox:null, sounds:null}
  const counts = (builtin?: ReturnType<typeof BuiltinSchema.parse>) => combatParticleCounts({...creature,builtin} as never,[move])
  expect(counts().particles).toContain("物件处于余烬时的小火苗")
  expect(particleReport(creature as never,[move],"boss")?.warning?.refs).toContainEqual({kind:"fixture",id:"lamps",title:"lamps"})
  expect(counts({fixture_ember:{particle:"none"}}).particles).not.toContain("物件处于余烬时的小火苗")
  expect(counts({fixture_lit:{effect:group.look.asset}}).builtin.some(b=>b.own && b.replacement===group.look.asset)).toBe(true)
  expect(BuiltinSchema.safeParse({fixture_ember:{particle:"none",effect:group.look.asset}}).success).toBe(false)
})

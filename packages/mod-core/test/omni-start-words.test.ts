import { expect, test } from "bun:test"
import { ABILITY_ASSET_INSTRUCTIONS } from "../src/ability-asset"
import { OMNI_START_INSTRUCTIONS } from "../src/combat"
import { faceTolerance, hasDirectionalStrike } from "../src/creature-abilities"
import { AbilitySchema } from "../src/entity-runtime"
import { MODULES } from "../src/workspace-modules"
import { golemAbilities } from "../script/data-gameplay-sample"

// r28 复验第 1 条：源码里不分方向的招（!hasDirectionalStrike）起手门槛按 180°，外部 AI 读的生物和技能说明里却没写。

const area = (shape: Record<string, unknown>) => ({ type: "area", at: 0.9, shape, hits: "everyone", damage: 6, knockback: 1, effects: [] })
const move = (shape: Record<string, unknown>) => AbilitySchema.parse({ ...golemAbilities[0], id: "move", name: "move", clip: "slam", windup: 0.8, length: 1.2, facing: "lock", events: [], moves: [], hits: [area(shape)] })

test("module_schema 的生物和技能说明都写了「不分方向的招起手不要朝向，门槛按 180°」", () => {
  expect(OMNI_START_INSTRUCTIONS).toContain("不分方向的招（全场招 arena、以自身为中心的球、360° 的圆或环、只有演出和地形没有命中判定的）起手不要朝向，门槛按 180° 算")
  expect(MODULES.entity.instructions).toContain(OMNI_START_INSTRUCTIONS)
  expect(ABILITY_ASSET_INSTRUCTIONS).toContain(OMNI_START_INSTRUCTIONS)
})

test("说明里列的不分方向的招，源码里都按 180° 起手；打在身前的不是", () => {
  for (const shape of [{ type: "arena", low: 0, high: 4 }, { type: "sphere", forward: 0, up: 0, left: 0, radius: 4 }, { type: "arc", angle: 360, reach: 5, low: 0, high: 2 }]) {
    const ability = move(shape)
    expect(hasDirectionalStrike(ability)).toBe(false)
    expect(faceTolerance(ability, [null])).toBe(180)
  }
  expect(faceTolerance(move({ type: "sphere", forward: 4, up: 0, left: 0, radius: 2 }), [null])).toBeLessThan(180)
})

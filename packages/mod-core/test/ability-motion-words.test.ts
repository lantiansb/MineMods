import { expect, test } from "bun:test"
import { abilitiesPlaying, abilityPlays, motionWithAbilities, motionWords } from "../src/creature-abilities"
import { AbilitySchema, type Ability } from "../src/entity-runtime"
import { golemAbilities } from "../script/data-gameplay-sample"

// Broad19: a veteran could guess that 「slam」 was a ground slam but could not tell which motion the ability 冲锋 plays. The two lists never met on any page.
const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const charge = { ...burst, id: "charge_run", name: "冲锋", clip: "charge" } as Ability

test("a motion that an ability plays is named with the ability; one nothing plays keeps its own name", () => {
  expect(abilitiesPlaying([slam, charge], slam.clip)).toEqual([slam.name])
  // Nothing in the table of common motions says what this one is, so the ability's own name is what the person reads.
  expect(motionWithAbilities(slam.clip, [slam, charge])).toBe(`招式：${slam.name}`)
  // The player's word for a motion stays, with the ability beside it.
  expect(motionWithAbilities("charge", [slam, charge])).toBe("蓄力（招式：冲锋）")
  expect(motionWithAbilities("idle", [slam, charge])).toBe("待机")
  expect(motionWithAbilities("hurt", null)).toBe("受伤")
})

test("two abilities that play the same motion are both named, once each, in the creature's order", () => {
  const again = { ...slam, id: "slam_again", name: "再来一锤" } as Ability
  const twin = { ...slam, id: "slam_twin", name: slam.name } as Ability
  expect(motionWithAbilities(slam.clip, [slam, again, twin])).toBe(`招式：${slam.name}、再来一锤`)
})

test("the ability's side says which motion it plays, and when the model has no such motion", () => {
  expect(abilityPlays(charge, [{ name: "charge", length: 1 }])).toBe("播的动作：蓄力")
  expect(abilityPlays(slam, [{ name: "idle", length: 1 }])).toBe(`播的动作：${slam.clip}（模型里还没有这个动作）`)
  // Without the model's motions at hand it only says the motion.
  expect(abilityPlays(slam)).toBe(`播的动作：${slam.clip}`)
})

// Broad22/23: 「lay」 and 「spike_ring」 stood on the motion buttons as they are written in the model file. One rule names every motion, in this order.
test("a motion is named by its own title, else the common-motion table, else what plays it, and only then by the name the document gives it", () => {
  const ring = { ...slam, id: "spike_ring", name: "刺环", clip: "spike_ring" } as Ability
  const egg = { name: "母鸡下蛋", clip: "lay", by: "gameplay" as const }
  // 1. the record's own title, in the person's language
  expect(motionWords("wiggle", null, { title: "摇尾巴" })).toBe("摇尾巴")
  expect(motionWords("walk", null, { title: "小碎步" })).toBe("小碎步")
  // 2. the table of common motions (ignoring case and the joiner)
  expect([motionWords("Sonic-Boom", null), motionWords("roll_up", null), motionWords("STAND_UP", null)]).toEqual(["音波攻击", "缩成一团", "站起来"])
  // 3. what plays it: an ability, or the gameplay whose code plays it
  expect(motionWords("spike_ring", [ring])).toBe("招式：刺环")
  expect(motionWords("lay", [egg, ring])).toBe("玩法：母鸡下蛋")
  expect(motionWords("lay", [egg, { ...ring, clip: "lay" }])).toBe("招式：刺环；玩法：母鸡下蛋")
  expect(motionWords("charge", [{ ...charge }, egg])).toBe("蓄力（招式：冲锋）")
  // 4. an unnamed motion has no inferred player-facing name
  expect(motionWords("lay", null)).toBe("未命名动作")
  expect(motionWords("lay", [ring])).toBe("未命名动作")
})

test("the document's name is kept beside the person's words only under 高级", () => {
  const ring = { ...slam, id: "spike_ring", name: "刺环", clip: "spike_ring" } as Ability
  expect(motionWords("spike_ring", [ring], { advanced: true })).toBe("招式：刺环（spike_ring）")
  expect(motionWords("walk", null, { advanced: true })).toBe("走路（walk）")
  expect(motionWords("lay", null, { advanced: true })).toBe("未命名动作（lay）")
  expect(motionWords("spike_ring", [ring])).not.toContain("spike_ring")
})

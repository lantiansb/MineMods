import { expect, test } from "bun:test"
import { fightingGolemDesign } from "../script/data-gameplay-sample"
import { combatHitbox, partAbility, partBoss } from "../script/target-hitbox-sample"
import { parryAbility } from "../script/target-parry-sample"
import { leapSlam, reaper, thrust } from "../script/target-tactics-sample"
import { compileEntity } from "../src/fabric/entity"
import { genTarget } from "../src/platform/target"

const base = { modId: "combat_test", packageName: "org.example.combat", id: "sentinel", name: "守卫",
  health: 120, speed: 0.2, attack_damage: 4, behavior: "hostile" as const, model: fightingGolemDesign }
const abilities = [{ ...partAbility, stopped_by_hurt: true }, parryAbility]
const cases = [
  { abilities },
  { abilities, hitbox: combatHitbox, boss: partBoss },
  { abilities: [...abilities, leapSlam, thrust], hitbox: combatHitbox, boss: partBoss, combos: [reaper] },
]

// Captured before the combat generator changes, on a47653b.
const pins = {
  "fabric-1.21.1": [
    "b02b4f46b0e4df7cd98f297bf83bb0ee930b61f8fa3da17009312ba81a67012f",
    "62ec54a9dd5c28ad83dbd5a2fd938a222bb623a95694f6594e462f8ed27981f9",
    "dca8ae6aa90d20e213f9e2fa196a0dd7c4792ca85f11a5c5d6379e8c2d7f9a7d",
  ],
  "forge-1.20.1": [
    "55150a268c9911cb86c39b7a209a03717b63cecb53ddc7ab21685b305ac4b8fc",
    "406905bc89c3f3f22656a3fddf44fe590d503f9681b9153a147db1bbe2494046",
    "65e7e7cdaaefd764a0d1d19af29cb25f69c3b716d7e8ce77a6fe06deefa77e33",
  ],
  "neoforge-1.21.1": [
    "4f9bddca7ca05d5ef564e6a51614d9523a68182823446508c3b1f4427717b0ca",
    "bfacf3bab36cef84ff7ee52ee22d61926bd8dd4f701ace4395be8ea71a5fafd3",
    "d4941492a419cff5bec739a51baeb52f0a5514a2f904f20040d8b282db5670ad",
  ],
}
for (const target of Object.keys(pins) as (keyof typeof pins)[]) {
  test(`${target}: combat combinations from a47653b retain their generated files`, () => {
    const hashes = cases.map(shape => new Bun.CryptoHasher("sha256")
      .update(JSON.stringify(compileEntity({ ...base, ...shape }, genTarget(target)))).digest("hex"))
    expect(hashes).toEqual(pins[target])
  })
}

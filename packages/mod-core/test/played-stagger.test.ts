import { expect, test } from "bun:test"
import { playedAnimations } from "../src/reconcile"
import { AbilityAssetDocumentSchema } from "../src/ability-asset"
import { fireball } from "../script/target-cast-sample"

/**
 * r29 修补乙 第 3 件（追加）: a motion of the model that only a stagger plays (`stagger.clip`) was said never to play (r28 build reminder, a ramming beast's dizzy motion).
 * Every field that names a motion the generated creature plays counts: its abilities and their stages, each kind of stagger, a boss's wake-up, phases and shows,
 * its stances, flight and habits (the alert among them), and the abilities it shares from an ability asset.
 */

const model = ["idle", "walk", "hurt", "dizzy", "daze", "charge", "charge_loop", "roar", "change", "sniff", "stance_idle", "shared_cast"]
const base = { id: "11111111-1111-4111-8111-111111111111", name: "冲撞兽", behavior: "hostile", abilities: [{ id: "charge", clip: "charge", stages: [{ kind: "windup", until: 0.5 }, { kind: "loop", until: 2, clip: "charge_loop" }] }] }
const played = (entity: Record<string, unknown>, workspace?: unknown) => playedAnimations({ logic: [], entities: [{ ...base, ...entity }], ...(workspace ? { workspace } : {}) } as never, base.id, model)

test("a stagger's own motion is played, one kind or several", () => {
  expect(played({})).not.toContain("dizzy")
  expect(played({ stagger: { seconds: 2, damage_scale: 1.5, clip: "dizzy", on_interrupt: true } })).toContain("dizzy")
  const both = played({ stagger: [{ id: "wall_daze", seconds: 2, damage_scale: 1.5, clip: "dizzy", on_interrupt: true }, { id: "broken", seconds: 1, damage_scale: 1, clip: "daze", on_interrupt: true }] })
  expect(both).toEqual(expect.arrayContaining(["dizzy", "daze"]))
  // A stagger without a motion of its own adds none.
  expect(played({ stagger: { seconds: 2, damage_scale: 1.5, on_interrupt: true } })).not.toContain("dizzy")
})

test("the other fields that name a motion are counted as before: stages, the boss's wake-up and phases, stances and habits", () => {
  expect(played({})).toEqual(expect.arrayContaining(["charge", "charge_loop"]))
  const boss = { bar: {}, intro: { clip: "roar" }, phases: [{ clip: "change" }], death: {} }
  expect(played({ boss })).toEqual(expect.arrayContaining(["roar", "change"]))
  expect(played({ stances: { start: "a", list: [{ id: "a", name: "甲", clips: { idle: "stance_idle" } }] } })).toContain("stance_idle")
  expect(played({ habits: { rest: null, eat: null, alert: { clip: "sniff" } } })).toContain("sniff")
})

test("an ability shared from an ability asset plays its motion, also where the project is read as saved", () => {
  const id = "22222222-2222-4222-8222-222222222222"
  const use = { id: "cast", asset: id, clip: "shared_cast", facing: "lock", stopped_by_hurt: false, start: { min_distance: 0, max_distance: 8, cooldown: 1, line_of_sight: false, weight: 1 } }
  const skill = AbilityAssetDocumentSchema.parse({ ...fireball, bindings: [] })
  expect(played({ shared_abilities: [use] }, { assets: [{ id, document: skill }] })).toContain("shared_cast")
  // Its asset is not there: nothing is invented.
  expect(played({ shared_abilities: [use] }, { assets: [] })).not.toContain("shared_cast")
})

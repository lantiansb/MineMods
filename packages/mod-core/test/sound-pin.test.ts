import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { compileEntity } from "../src/fabric/entity"
import { AbilitySchema, BossSchema, type Ability } from "../src/entity-runtime"
import { fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"

/**
 * 任务二 §9 「自己的声音」: a creature that only borrows the game's own sounds is generated exactly as before.
 * The hashes were taken from the generator before sound assets existed (874bdf7), over every file `compileEntity` writes.
 */

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const sounds = { ambient: "block.amethyst_block.chime", hurt: "entity.iron_golem.hurt", death: "entity.iron_golem.death", step: "entity.iron_golem.step", pitch: 0.8, volume: 1 }
const boss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack", opening: "burst" },
  phases: [{ below: 0.5, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3 }],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 48, reset_seconds: 30 },
})
/** Every file, by name, with its bytes: one hash for the whole output. */
const whole = (files: Record<string, string | Uint8Array>) =>
  Object.keys(files)
    .sort()
    .reduce((hash, name) => hash.update(name).update("\0").update(files[name]!).update("\0"), createHash("sha256"))
    .digest("hex")

test("a creature that borrows vanilla sounds is generated to the byte as before sound assets", () => {
  expect(whole(compileEntity({ ...plain, runtime, sounds }))).toBe("6ae0feceab5d235f0d61d66ec0ef8af722e24e79b5d8f1ec9c4d961aee298a9e")
  expect(whole(compileEntity({ ...plain, runtime, sounds, abilities: [slam, burst] }))).toBe("e323e0cf98864030f5c305a0b3ecb0495da83cead45c6fa667fb363cee8b356e")
  expect(whole(compileEntity({ ...plain, runtime: { ...runtime, explosion: { fuse_ticks: 30, radius: 2, damage_blocks: false, effects: [] } }, sounds: { ...sounds, ambient: null } }))).toBe("6ce7c8533464ab538f0bafa28ee0ea75d4c413520bdb9ab986d041efcfcb209c")
  expect(whole(compileEntity({ ...plain, sounds, abilities: [slam, burst], boss }))).toBe("274b7252a848a757241e199b75d87ea7c412779c77b7a70fd8630ab71ca5b105")
})

import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { TICKS } from "../src/ability-words"
import { AIR_REACH, abilityIssues, airHitReach, airReachBody, airReachFlier, airReachHolds, airReachLimit, airReachMayStart, airReachNearest, airReachPath, hitAnchor, hitAnchors, type AirReachFlier, type AirReachFrom } from "../src/creature-abilities"
import { creatureContractLines, readGeneratedCreature } from "../src/creature-contract"
import { airReach, airReachCircled, flightCircle, flightPlan } from "../src/creature-flight"
import { AbilitySchema, EntitySchema, FlightSchema, HabitsSchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { FLIGHT_LIMITS } from "../src/flight-words"
import { saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { dragonAnchoredAbilities, dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

const OFFICIAL = hasTargetJavac("fabric-1.21.1-official")

/**
 * epic game1 (an epic frost dragon, 24 blocks long, measured by an independent tester): an aimed air breath started with the mouth out of reach and flew on past the player (four of seven breaths
 * missed all three hits), and a flier that had killed its prey took off with the meal not finished. The rules are the generated `flightReaches`, `flightReachStation` and the eating check of
 * `flightWantsAir`, with the arithmetic of the helpers of creature-abilities.ts written out.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "dragon", name: "巨龙", health: 400, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entityFile])
const sha = (files: Record<string, string | Uint8Array>) => {
  const text = Object.keys(files).sort().map((name) => `${name}\n${files[name]}`).join("\n")
  return `${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${text.length}`
}
const near = (value: number, expected: number, digits = 3) => expect(Math.abs(value - expected)).toBeLessThan(10 ** -digits)

// The breath of the frost dragon: windup 1.2 s, three cones of length 16 aimed at the target at 1.4, 1.9 and 2.4 s, from the mouth (a bone); in the air only.
const cone = { type: "area", shape: { type: "cone", up: 0, length: 16, angle: 24, aim: "target" }, hits: "everyone", damage: 4, knockback: 0.15, effects: [] }
// It starts up to 20 blocks away (the mouth is 7 blocks ahead of the body's middle, so the cone reaches 23 ahead of it: the far-end finding stays quiet).
const breath = AbilitySchema.parse({ ...dragonAnchoredAbilities[1], where: "air", windup: 1.2, length: 2.4, start: { ...dragonAnchoredAbilities[1]!.start, max_distance: 20 }, hits: [1.4, 1.9, 2.4].map((at) => ({ ...cone, at, bone: "head" })) })
const claw = dragonAnchoredAbilities[3]!
const mouth = hitAnchor(breath, 0, dragonDesign)!

// ---- the helpers ----

test("the row an aimed air ability is held to: the shortest hit's reach, where it starts, the ticks of the first and last hit, and how far the hits before push", () => {
  const row = airHitReach(breath, hitAnchors([breath], dragonDesign)[0]!)!
  // Two hits before the last, each pushing with the game's own 0.4 for a damaging hit and its knockback of 0.15, which slides 0.55 / (1 - 0.546) = 1.21 blocks.
  expect(row).toEqual([16, mouth.up, mouth.forward, mouth.left, 28, 48, (2 * (0.4 + 0.15)) / (1 - 0.6 * 0.91), (2 * 0.15) / (1 - 0.6 * 0.91)].map((value) => Number(value.toFixed(4))))
  // The aim follows the hits' own knockback only (0.66), not the game's push of a damaging hit.
  // The shortest of unequal hits, with its own place: a beam adds its radius to its length; a hit that names no bone starts at the feet plus the shape's own height.
  const mixed = AbilitySchema.parse({
    ...breath,
    hits: [
      { ...cone, at: 1.4, bone: "head", shape: { type: "cone", up: 0, length: 16, angle: 24, aim: "target" } },
      { ...cone, at: 1.9, shape: { type: "line", up: 2, length: 9, radius: 1.5, aim: "target" } },
    ],
  })
  expect(airHitReach(mixed, [mouth, null])).toEqual([10.5, 2, 0, 0, 28, 38, Number(((0.4 + 0.15) / (1 - 0.6 * 0.91)).toFixed(4)), Number((0.15 / (1 - 0.6 * 0.91)).toFixed(4))])
  // No row for a ground ability, a dive, an ability laid out ahead of it, one kept level, or a hit from a bone the model lacks.
  expect(airHitReach(AbilitySchema.parse({ ...breath, where: "ground" }), [mouth, mouth, mouth])).toBeNull()
  expect(airHitReach(claw, [null])).toBeNull()
  expect(airHitReach(AbilitySchema.parse({ ...breath, hits: [{ ...cone, at: 1.4, shape: { ...cone.shape, aim: "level" } }] }), [null])).toBeNull()
  expect(airHitReach(breath, [null, null, null])).toBeNull()
  expect(airReach([breath, claw], hitAnchors([breath, claw], dragonDesign))).toEqual([airHitReach(breath, hitAnchors([breath], dragonDesign)[0]!), null])
})

test("the station: two thirds of the reach across for the place the hits start at, a third of it above, a quarter of the reach left over", () => {
  expect(AIR_REACH).toEqual({ stand: 2 / 3, rise: 1 / 3, near: 1 / 3, slack: 1 })
  // 16 long: 10.67 across and 5.33 above is 11.93 away, 0.745 of the reach.
  near(airReachNearest(16, 0), 11.9255, 3)
  near(airReachNearest(16, 0) / 16, Math.sqrt(5) / 3, 6)
  // The floor rule keeps the place higher: feet a block over the ground and the place 14.1 over the middle of someone on the ground puts it out of reach.
  near(airReachNearest(16, 14.1), Math.hypot(32 / 3, 14.1), 9)
  expect(airReachNearest(16, 14.1)).toBeGreaterThan(16 + AIR_REACH.slack)
  // The middle of the body: the place is `forward` ahead of it, so it stands that much further than two thirds of the reach, and less when the place is beside it; never past the target.
  near(airReachBody(16, 7.07, 0), 7.07 + 32 / 3, 9)
  near(airReachBody(16, 7.07, 3), 7.07 + Math.sqrt((32 / 3) ** 2 - 9), 9)
  expect(airReachBody(16, 7.07, 12)).toBe(7.07)
  expect(airReachBody(16, -20, 0)).toBe(0)
})

// A flier that cannot turn: the path of the hold read one step at a time.
const straight: AirReachFlier = { soar: true, cruise: 0.7, stall: 0.35, accel: 0.02, brake: 0.05, turn: 0, climb: 40 }
const FLOOR = 1 - 0.9

test("the path of the hold, a tick at a time: a soaring flier flies on at its stall speed and the place is read from the first hit to the last", () => {
  // Level with the middle of the one it fights, 20 blocks out, flying straight away: the place is the middle of the body (nothing ahead, aside or up), and every tick moves it a stall step further.
  const away: AirReachFrom = { x: 20, z: 0, feet: 0, yaw: -90, climb: 0, speed: 0.35 }
  const path = airReachPath([16, 0, 0, 0, 10, 30, 0], straight, { windup: 0, tracks: false }, away, 0)
  near(path.near, 20 + 0.35 * 10, 6)
  near(path.far, 20 + 0.35 * 30, 6)
  // From twice that speed it slows by the steps its speed may fall by, 0.05 a tick: 0.65, 0.6, ... down to 0.35.
  const braking = airReachPath([16, 0, 0, 0, 10, 10, 0], straight, { windup: 0, tracks: false }, { ...away, speed: 0.7 }, 0)
  near(braking.far, 20 + [0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.35, 0.35, 0.35].reduce((sum, value) => sum + value, 0), 6)
  // A hovering flier within a block of its station stays where it is: the path is the one place.
  const hover: AirReachFlier = { ...straight, soar: false, turn: 3 }
  const station = Math.max(16 / 3, FLOOR)
  const body = airReachBody(16, 0, 0)
  const held = airReachPath([16, 0, 0, 0, 5, 40, 0], hover, { windup: 0, tracks: false }, { x: body, z: 0, feet: station, yaw: 90, climb: 0, speed: 0 }, FLOOR)
  near(held.near, held.far, 9)
  near(held.far, Math.hypot(body, station), 9)
})

test("how far the place may be: the reach less the push of the hits before and a step, the station and a step where the floor rule keeps it farther; and never nearer than a third", () => {
  // 16 long, a push of 0.66 and a cruise step (0.7): 14.64 (the dragon's breath pushes 2.4 for its two hits before the last: 12.9).
  near(airReachLimit([16, 2.8, 7, 0, 28, 48, 0.6608], 0.7, 0.1 + 2.8), 16 - 0.6608 - 0.7, 9)
  // The place 14.1 over the middle keeps the station at 17.68 whatever it does: the limit is the station and a step, not a margin it cannot keep.
  near(airReachLimit([16, 14, 7, 0, 28, 48, 0.6608], 0.7, 0.1 + 14), airReachNearest(16, 14.1) + 0.7, 9)
  const row = [16, 2.8, 7, 0, 28, 48, 0.6608]
  const lowest = 0.1 + 2.8
  expect(airReachMayStart(row, { near: 11, far: 14.6 }, 0.7, lowest)).toBe(true)
  expect(airReachMayStart(row, { near: 11, far: 14.7 }, 0.7, lowest)).toBe(false)
  expect(airReachMayStart(row, { near: 5.3, far: 12 }, 0.7, lowest)).toBe(false)
  expect(airReachMayStart(row, { near: 5.34, far: 12 }, 0.7, lowest)).toBe(true)
})

// ---- the hold, flown by a stand-in for the generated control law with the target in the picture ----

type Strike = { distance: number; off: number; hit: boolean }

/**
 * The hold as the game flies it, written out once more (it is `tickAbility`, `abilityAim`, `abilityFollow`, `flightReachStation`, `flightSteer` and `flightMove` of the generated class) with the one it
 * fights in the picture: the target is pushed away from the flier by `push` blocks at every hit (the knockback of the hit) and runs `run` blocks a tick once the flier is done getting ready. At the aimed hits
 * it measures how far the place its hits start at is from the target, and how many degrees the axis of the cone (from that place to where the aim is) is off the line to them; a hit lands when they are within the
 * reach and within the half angle of the cone and the half width of their body (0.3 blocks) seen from the place. `follow`: the aim follows the target by no more than the turn cap a tick, and no further
 * from where it was when the flier was done getting ready than the hits push them and a step of cruise (`abilityFollow`).
 */
function fight(input: { row: readonly number[]; flier: AirReachFlier; ability: { windup: number; tracks: boolean }; hits: number[]; cone: number; from: AirReachFrom; follow: boolean; push: number; run?: [number, number]; runFrom?: number; budget?: number }): Strike[] {
  const [reach, up, ahead, left] = input.row as [number, number, number, number]
  const { flier, ability } = input
  const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180
  const clamp = (value: number, least: number, most: number) => Math.min(Math.max(value, least), most)
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  const station = Math.max(reach / 3 - up, FLOOR)
  const body = airReachBody(reach, ahead, left)
  let { x, z, feet, climb, speed } = input.from
  let facing = input.from.yaw
  let [tx, tz] = [0, 0]
  let [aimX, aimZ] = [0, 0]
  let [holdX, holdZ] = [0, 0]
  const strikes: Strike[] = []
  for (let tick = 0; tick <= Math.max(...input.hits); tick++) {
    const getting = ability.tracks && tick < ability.windup
    if (tick === 0 || getting) [aimX, aimZ] = [tx, tz]
    if (getting) facing += clamp(wrap((Math.atan2(tz - z, tx - x) * 180) / Math.PI - 90 - facing), -flier.turn, flier.turn)
    if (input.run && tick >= (input.runFrom ?? ability.windup)) [tx, tz] = [tx + input.run[0], tz + input.run[1]]
    if (!getting && ability.tracks && input.follow) {
      if (tick === ability.windup) [holdX, holdZ] = [aimX, aimZ]
      const before = Math.atan2(aimZ - z, aimX - x)
      const to = Math.hypot(tx - x, tz - z)
      const turned = before + rad(clamp(wrap(((Math.atan2(tz - z, tx - x) - before) * 180) / Math.PI), -flier.turn, flier.turn))
      ;[aimX, aimZ] = [x + Math.cos(turned) * to, z + Math.sin(turned) * to]
      // No further from where it was aimed at than the hits push them and a step of cruise.
      const drift = Math.hypot(aimX - holdX, aimZ - holdZ)
      const most = input.budget ?? input.row[7]! + flier.cruise
      if (drift > most) [aimX, aimZ] = [holdX + ((aimX - holdX) * most) / drift, holdZ + ((aimZ - holdZ) * most) / drift]
    }
    if (input.hits.includes(tick)) {
      const angle = rad(facing)
      const mouth = [x - ahead * Math.sin(angle) + left * Math.cos(angle), feet + up, z + ahead * Math.cos(angle) + left * Math.sin(angle)]
      const axis = [aimX - mouth[0]!, 0 - mouth[1]!, aimZ - mouth[2]!]
      const line = [tx - mouth[0]!, 0 - mouth[1]!, tz - mouth[2]!]
      const distance = Math.hypot(...line)
      const cos = (axis[0]! * line[0]! + axis[1]! * line[1]! + axis[2]! * line[2]!) / (Math.hypot(...axis) * distance)
      const off = (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI
      strikes.push({ distance, off, hit: distance <= reach && off <= input.cone / 2 + (Math.atan2(0.3, distance) * 180) / Math.PI })
      const push = Math.hypot(tx - x, tz - z) || 1
      tx += ((tx - x) / push) * input.push
      tz += ((tz - z) / push) * input.push
    }
    const flat = Math.hypot(x - tx, z - tz)
    const away = Math.min(flat, body)
    const toX = flat > 1e-3 ? tx + ((x - tx) * away) / flat - x : 0
    const toZ = flat > 1e-3 ? tz + ((z - tz) * away) / flat - z : 0
    const across = Math.hypot(toX, toZ)
    const stays = !flier.soar && Math.hypot(across, station - feet) < 1
    let heading = facing
    if (!stays && across > 0.05) heading += clamp(wrap((Math.atan2(-toX, toZ) * 180) / Math.PI - heading), -flier.turn, flier.turn)
    climb = clamp(climb + clamp((stays ? 0 : clamp((Math.atan2(station - feet, Math.max(across, 0.5)) * 180) / Math.PI, -flier.climb, flier.climb)) - climb, -flier.turn, flier.turn), -flier.climb, flier.climb)
    speed = Math.max(0, speed + clamp((stays ? 0 : flier.soar ? flier.stall : flier.cruise * 0.5) - speed, -flier.brake, flier.accel))
    x += -Math.sin(rad(heading)) * Math.cos(rad(climb)) * speed
    z += Math.cos(rad(heading)) * Math.cos(rad(climb)) * speed
    feet += Math.sin(rad(climb)) * speed
    if (!getting) facing = heading
  }
  return strikes
}

const dragonFlier = airReachFlier(dragonFlight)
const breathRow = airHitReach(breath, hitAnchors([breath], dragonDesign)[0]!)!
const breathWindup = { windup: Math.round(1.2 * TICKS), tracks: true }
const breathHits = [28, 38, 48]
const breathPush = (0.4 + 0.15) / (1 - 0.6 * 0.91)
const gate = (from: AirReachFrom, row = breathRow, flier = dragonFlier) => airReachMayStart(row, airReachPath(row, flier, breathWindup, from, FLOOR), flier.cruise, FLOOR + row[1]!)
/** The starts of a dragon round a player: feet height over the ground, the middle of its body that far out from them, its heading, and its speed (stall or cruise). */
function starts() {
  const found: AirReachFrom[] = []
  for (let high = 2; high <= 26; high += 2) for (let across = 0; across <= 26; across += 2) for (let yaw = -180; yaw < 180; yaw += 20) for (const speed of [dragonFlier.stall, dragonFlier.cruise]) found.push({ x: across, z: 0, feet: high - 0.9, yaw, climb: 0, speed })
  return found
}
const strikes = (from: AirReachFrom, follow: boolean, push = breathPush, hits = breathHits) => fight({ row: breathRow, flier: dragonFlier, ability: breathWindup, hits, cone: 24, from, follow, push })

test("the path is the hold as the stand-in flies it, to the thousandth of a block", () => {
  for (const from of starts().filter((_, at) => at % 37 === 0)) {
    const path = airReachPath(breathRow, dragonFlier, breathWindup, from, FLOOR)
    // A hit on every tick from the first to the last, the way the path reads them, and nobody pushed.
    const flown = strikes(from, false, 0, Array.from({ length: 21 }, (_, at) => 28 + at)).map((strike) => strike.distance)
    near(path.far, Math.max(...flown), 3)
    near(path.near, Math.min(...flown), 3)
  }
})

test("a breath started inside the first hit's reach but flown out of it by the last is no longer started; every one that is started stays in reach and lands all three", () => {
  // The gate as it was, at the first hit alone and a block of slack past the reach.
  const first = [breathRow[0]!, breathRow[1]!, breathRow[2]!, breathRow[3]!, breathRow[4]!, breathRow[4]!, breathRow[6]!]
  const early = (from: AirReachFrom) => airReachPath(first, dragonFlier, breathWindup, from, FLOOR).far <= breathRow[0]! + AIR_REACH.slack
  const all = starts()
  const flownOut = all.filter((from) => early(from) && strikes(from, true).some((strike) => strike.distance > breathRow[0]!))
  // It happened: the first hit within 15.5 of the cone, the last one beyond 16, as measured in the game (14.9, 15.3, 16.5).
  expect(flownOut.length).toBeGreaterThan(100)
  const example = flownOut.find((from) => strikes(from, true).every((strike, at, list) => (at === 0 ? strike.distance < 16 : strike.distance > list[at - 1]!.distance)))!
  const [one, two, three] = strikes(example, true).map((strike) => strike.distance)
  expect(one!).toBeLessThan(16)
  expect(three!).toBeGreaterThan(16)
  expect(two!).toBeGreaterThan(one!)
  // None of them is started now.
  expect(flownOut.filter((from) => gate(from))).toEqual([])
  // Every start that is, stays within the reach at all three and lands them all (the pushes of the hits before included), and there are many of them: nothing starves.
  const started = all.filter((from) => gate(from))
  expect(started.length).toBeGreaterThan(500)
  for (const from of started) for (const strike of strikes(from, true)) expect(strike).toMatchObject({ hit: true })
  for (const from of started) for (const strike of strikes(from, true)) expect(strike.distance).toBeLessThanOrEqual(breathRow[0]!)
})

test("a breath that flies in on the player does not start nearer than a third of its reach, and its aim follows a player the hits push", () => {
  // Some start flies in over the player (the hits counted from 8.0, 6.3 and 5.4 blocks in the game, the player pushed a block and a half: 21° off the aim at 4.5 blocks, with a cone 24° wide).
  const flyIn = starts().find((from) => {
    const path = airReachPath(breathRow, dragonFlier, breathWindup, from, FLOOR)
    const fixed = strikes(from, false, 0.8)
    return path.far <= airReachLimit(breathRow, dragonFlier.cruise, FLOOR + breathRow[1]!) && path.near < breathRow[0]! / 3 && fixed.some((strike) => strike.distance <= breathRow[0]! && !strike.hit)
  })!
  const fixed = strikes(flyIn, false, 0.8)
  const followed = strikes(flyIn, true, 0.8)
  const missed = fixed.find((strike) => !strike.hit)!
  // Aimed once, the hit is off by more than the cone allows (12° and the body of the player); following, every hit is on.
  expect(missed.distance).toBeLessThan(breathRow[0]! / 2)
  expect(missed.off).toBeGreaterThan(12 + (Math.atan2(0.3, missed.distance) * 180) / Math.PI)
  expect(followed.map((strike) => strike.hit)).toEqual([true, true, true])
  // And it is not started: the path takes the place nearer than a third of the reach.
  expect(gate(flyIn)).toBe(false)
  // Of all the starts, with the player pushed 0.8 a hit (more than the hits say), the aim that is not followed misses some by angle; the one that is, none.
  const started = starts().filter((from) => gate(from))
  const angled = (follow: boolean) => started.filter((from) => strikes(from, follow, 0.8).some((strike) => strike.distance <= breathRow[0]! && !strike.hit)).length
  expect(angled(false)).toBeGreaterThan(0)
  expect(angled(true)).toBe(0)
})

test("a player the hits push stays in the aim; one who steps aside or runs still gets away from it", () => {
  // A hovering flier that stays where it is (its station is its own place) and a cone 9 long from 4 blocks away, turning 3° a tick; its row says the hits before the last push 0.6 blocks, all of it the hits' own knockback.
  const hover: AirReachFlier = { soar: false, cruise: 0.7, stall: 0, accel: 0.03, brake: 0.1, turn: 3, climb: 40 }
  const row = [9, 0, 0, 0, 20, 30, 0.6, 0.6]
  const stand: AirReachFrom = { x: 4, z: 0, feet: 3, yaw: 90, climb: 0, speed: 0 }
  const run = (blocks: number, follow: boolean, push = 0.6) => fight({ row, flier: hover, ability: { windup: 10, tracks: true }, hits: [20, 30], cone: 24, from: stand, follow, push, run: [0, blocks] }).map((strike) => strike.hit)
  // Pushed 1.3 blocks a hit (more than the aim follows: 0.6 and a step of 0.7) and not moving on their own, they stay in.
  expect(run(0, true, 1.3)).toEqual([true, true])
  // Walking across at 0.1 blocks a tick (2 blocks a second, 2 by the last hit) the player is within what the aim follows; the aim that is not followed has lost them by the last hit.
  expect(run(0.1, true)).toEqual([true, true])
  expect(run(0.1, false)).toEqual([true, false])
  // At a run (0.3 a tick, 6 blocks a second: 3 blocks aside by the first hit, past what it follows by) they are out of the aim at both, followed or not.
  expect(run(0.3, true)).toEqual([false, false])
  expect(run(0.3, false)).toEqual([false, false])
})

// ---- where it circles while it waits ----

// A breath with a long window, and a roar from afar of its own: the windows alone put the circle 28 blocks out, which the mouth cannot start the breath from.
const wide = AbilitySchema.parse({ ...breath, start: { ...breath.start, min_distance: 8, max_distance: 32 } })
const roar = AbilitySchema.parse({ ...dragonAnchoredAbilities[2], id: "roar", where: "air", start: { ...dragonAnchoredAbilities[2]!.start, min_distance: 28, max_distance: 32 } })
const fixture = [wide, roar]
const fixtureRows = airReach(fixture, hitAnchors(fixture, dragonDesign))
const fixtureAbility = { windup: breathWindup.windup, tracks: true }
// The dragon turning 90° a second instead of 60°: it can turn in 10.7 blocks, tight enough for a circle to serve the breath (at 60° the gate asks it to close in, see below).
const quick = FlightSchema.parse({ ...dragonFlight, turn: 90 })

/**
 * A small stand-in for the circle (`flightWhere`, `flightSteer`, `flightMove`) and the gate on every tick of it: the flier flies at cruise round a target at the origin at the radius and height the plan gives,
 * steering at a point a little ahead of it on the circle (the angle `cruise · 20 / radius`, at most a right angle), turning by no more than its turn rate a tick. Returns how many of the ticks of the second lap
 * the gate (`airReachMayStart`, read for the flier where it is) lets the breath start on.
 */
function lap(radius: number, high: number, side: 1 | -1, flight = quick) {
  const plan = flightPlan(flight, fixture, true)
  const flier = airReachFlier(flight)
  let [x, z, yaw] = [radius, 0, side === 1 ? 0 : 180]
  let passes = 0
  const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180
  for (let tick = 0; tick < 600; tick++) {
    const angle = Math.atan2(z, x) + side * Math.min(Math.PI / 2, (plan.cruise * 20) / radius)
    const want = (Math.atan2(-(radius * Math.cos(angle) - x), radius * Math.sin(angle) - z) * 180) / Math.PI
    yaw += Math.min(Math.max(wrap(want - yaw), -plan.turn), plan.turn)
    x += -Math.sin((yaw * Math.PI) / 180) * plan.cruise
    z += Math.cos((yaw * Math.PI) / 180) * plan.cruise
    if (tick >= 300 && gate({ x, z, feet: high - 0.9, yaw, climb: 0, speed: plan.cruise }, fixtureRows[0]!, flier)) passes++
  }
  return passes
}

test("a flier with an aimed air ability circles where that ability can start from", () => {
  const without = flightPlan(quick, fixture, true).circle
  const plan = flightPlan(quick, fixture, true, false, fixtureRows)
  // The windows alone put it 28 blocks away, 24.2 across and 14 up: the mouth, 7.1 ahead and 2.8 up, is far beyond the 13 blocks the breath may start from (the reach less the push of the two hits
  // before the last, 2.4 blocks, and a step), however it flies in.
  expect(without).toEqual({ distance: 28, height: 14, radius: 24.25, turnRadius: 8.91 })
  expect(airReachCircled(fixtureRows[0]!, quick, without.distance, fixtureAbility)).toBe(false)
  // Brought in to the widest circle that can, still beyond what the flier can turn in (10.69), so a circle is enough and nothing to close in for.
  expect(plan.circle.approach).toBe(false)
  expect(plan.circle.distance).toBeLessThan(without.distance)
  expect(plan.circle.radius).toBeGreaterThanOrEqual(10.69)
  expect(airReachCircled(fixtureRows[0]!, quick, plan.circle.distance, fixtureAbility)).toBe(true)
  // The edge: a hair wider and it cannot.
  expect(airReachCircled(fixtureRows[0]!, quick, plan.circle.distance + 0.01, fixtureAbility)).toBe(false)
  // Round it for two laps, both ways: the circle it settles at lets the breath start on some tick of every lap. (The flier cuts well inside the circle it steers at, so the plain circle of this window happens
  // to pass in the simulation too: the model is the safe side of it.)
  const band = (circle: { radius: number; height: number }) => ({ radius: circle.radius, high: Math.min(Math.max(circle.height, quick.altitude.min), quick.altitude.max) })
  for (const side of [1, -1] as const) {
    expect(lap(band(plan.circle).radius, band(plan.circle).high, side)).toBeGreaterThan(0)
  }
  // Wherever the plan says a circle passes, the flier on it does pass on some tick: no circle the plan keeps starves the ability.
  for (let distance = 12; distance <= 34; distance += 2) {
    if (!airReachCircled(fixtureRows[0]!, quick, distance, fixtureAbility)) continue
    const circle = band({ radius: Math.max(Math.sqrt(distance * distance * 0.75), 10.69), height: distance / 2 })
    for (const side of [1, -1] as const) expect(lap(circle.radius, circle.high, side)).toBeGreaterThan(0)
  }
  // Nothing else of the plan moves; a flier without such a row has the circle it always had, to the property.
  expect(flightPlan(quick, [claw], true, false, [null]).circle).toEqual(flightPlan(quick, [claw], true).circle)
  expect(Object.keys(flightCircle(quick, fixture))).toEqual(["distance", "height", "radius", "turnRadius"])
})

test("a flier whose window is beyond what its mouth reaches closes in rather than circle where the ability starves", () => {
  // From 26 blocks out the circle is 22.5 across: the breath is never started on it, and the circle that is has the player nearer than 26, which the ability does not start from.
  const farther = AbilitySchema.parse({ ...breath, start: { ...breath.start, min_distance: 26, max_distance: 32 } })
  const abilities = [farther, claw]
  const rows = airReach(abilities, hitAnchors(abilities, dragonDesign))
  const plan = flightPlan(dragonFlight, abilities, true, false, rows)
  const plain = flightPlan(dragonFlight, abilities, true).circle
  expect(plain.distance).toBe(26)
  expect(plan.circle.approach).toBe(true)
  // And the circle it keeps is the plain one, whatever it was without rows.
  expect(plan.circle).toMatchObject({ distance: 26, radius: plain.radius })
})

test("a flier that cannot turn tight enough closes in on its target when an aimed air ability is ready", () => {
  const slow = FlightSchema.parse({ ...dragonFlight, turn: 30 })
  const abilities = [wide, claw]
  const rows = airReach(abilities, hitAnchors(abilities, dragonDesign))
  const plan = flightPlan(slow, abilities, true, false, rows)
  // 14 blocks a second at 30° a second turns in 26.7 blocks and needs 32.1: the mouth is farther than 15 blocks from the player however it circles.
  expect(plan.circle).toMatchObject({ radius: 32.09, approach: true })
  expect(airReachCircled(rows[0]!, slow, 3, fixtureAbility)).toBe(false)
  const source = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities, flight: slow } as never))
  expect(source).toContain("private int flightReachReady()")
  expect(source).toContain("if (FLIGHT_REACH[index] != null && tickCount >= abilityReadyAt[index]) return index;")
  expect(source).toContain("flightSteer(flightReachStation(reaching, target, true), FLIGHT_CRUISE, false);")
  expect(source).toContain("double away = closing ? 0.0 : Math.min(flat, body);")
  expect(source).toContain(`FLIGHT_CIRCLE_RADIUS = ${plan.circle.radius}`)
  // The boss only asks for an ability its phase allows.
  const boss = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [dragonAnchoredAbilities[0], wide, dragonAnchoredAbilities[2], claw], flight: slow, boss: dragonBoss } as never))
  expect(boss).toContain("tickCount >= abilityReadyAt[index] && bossAllows(index)) return index;")
  // A circle that is enough writes nothing of it; the circle it writes is the one the plan makes.
  const enough = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: fixture, flight: quick } as never))
  expect(enough).not.toContain("private int flightReachReady()")
  expect(enough).toContain(`FLIGHT_CIRCLE_RADIUS = ${flightPlan(quick, fixture, true, false, fixtureRows).circle.radius}`)
  expect(FLIGHT_LIMITS.turnRoom).toBe(1.2)
})

test("the dragon at 60° a second cannot start the breath from any circle, and closing in on the line to the player finds a tick it can", () => {
  // The breath is held to 13 blocks at all three hits (the reach less 2.4 for the push of the two before and a step), and a soaring flier goes on 7 blocks between the first and the last: the corridor is
  // 5.3 to 13 and only a pass nearly along the line to the player stays in it. A tangent start on a circle never does, so the plan says approach.
  const abilities = [wide, claw]
  const rows = airReach(abilities, hitAnchors(abilities, dragonDesign))
  expect(rows[0]![6]).toBeCloseTo(2 * breathPush, 3)
  expect(flightPlan(dragonFlight, abilities, true, false, rows).circle.approach).toBe(true)
  // What it does then (`flightReachReady`, `flightReachStation` closing): steers at the column over the player at the height of the station, at cruise, until the gate lets the breath start. From the circle
  // either way round, from far out and from a quarter turn off, that is within five seconds (65 ticks from a quarter turn off, 2 to 14 from the others).
  const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180
  const clamp = (value: number, least: number, most: number) => Math.min(Math.max(value, least), most)
  const station = Math.max(breathRow[0]! / 3 - breathRow[1]!, FLOOR)
  for (const [across, high, yaw] of [[16.04, 12, 0], [16.04, 12, 180], [16.04, 12, -90], [22, 13, 0], [30, 20, 90]] as const) {
    let [x, z, feet, heading, climb, speed] = [across, 0, high - 0.9, yaw, 0, dragonFlier.cruise]
    let started = -1
    for (let tick = 0; tick < 100 && started < 0; tick++) {
      if (gate({ x, z, feet, yaw: heading, climb, speed })) started = tick
      heading += clamp(wrap((Math.atan2(x, -z) * 180) / Math.PI - heading), -dragonFlier.turn, dragonFlier.turn)
      climb = clamp(climb + clamp(clamp((Math.atan2(station - feet, Math.max(Math.hypot(x, z), 0.5)) * 180) / Math.PI, -40, 40) - climb, -dragonFlier.turn, dragonFlier.turn), -40, 40)
      speed = Math.max(0, speed + clamp(dragonFlier.cruise - speed, -dragonFlier.brake, dragonFlier.accel))
      x += -Math.sin((heading * Math.PI) / 180) * Math.cos((climb * Math.PI) / 180) * speed
      z += Math.cos((heading * Math.PI) / 180) * Math.cos((climb * Math.PI) / 180) * speed
      feet += Math.sin((climb * Math.PI) / 180) * speed
    }
    expect(started).toBeGreaterThanOrEqual(0)
  }
})

// ---- what is said when holding cannot mend it ----

test("an aimed air ability that holding cannot bring within reach is said, never a stop", () => {
  const said = (ability: typeof breath, flight: typeof dragonFlight | null = dragonFlight, design: typeof dragonDesign | null = dragonDesign) =>
    abilityIssues({ name: "巨龙", behavior: "hostile", ...(flight ? { flight } : {}), abilities: [ability] }, null, design).filter((issue) => issue.rule === "ability_reach")
  const hovering = FlightSchema.parse({ ...dragonFlight, style: "hover", clips: { fly: "fly", glide: null, hover: "hover" } })
  // The breath of the frost dragon: three hits across 20 ticks; a soaring flier at 14 blocks a second goes on at 7 for that time: 7 blocks, 3.5 either side of the station in the middle.
  // 10.67 + 3.5 across and 5.33 up is 15.1 from the target, within 16 + 1: nothing said.
  expect(said(breath)).toEqual([])
  // A flier at 30 blocks a second goes on at 15: 15 blocks, 7.5 from the middle. 18.2 across and 5.3 up is 18.9 away, past 16 + 1.
  const fast = FlightSchema.parse({ ...dragonFlight, speed: 30 })
  const soaring = said(breath, fast)
  expect(soaring).toHaveLength(1)
  expect(soaring[0]!.stops).toBe(false)
  expect(soaring[0]!.text).toContain("滑翔型")
  expect(soaring[0]!.text).toContain("隔 1 秒")
  expect(soaring[0]!.text).toContain("飞出 15 格")
  // A hovering flier stops: nothing said; no flight at all: nothing said (the ability is never in the air).
  expect(said(breath, FlightSchema.parse({ ...fast, style: "hover", clips: { fly: "fly", glide: null, hover: "hover" } }))).toEqual([])
  expect(said(breath, null)).toEqual([])
  // A place so high above the feet that the floor rule (feet a block over the ground) keeps it 17.68 from someone on the ground, with a reach of 16: said for the hovering one too.
  const high = AbilitySchema.parse({ ...breath, start: { ...breath.start, max_distance: 16 }, hits: [{ ...cone, at: 1.4, shape: { ...cone.shape, up: 14 } }] })
  const floor = said(high, hovering, null)
  expect(floor).toHaveLength(1)
  expect(floor[0]!.stops).toBe(false)
  expect(floor[0]!.text).toContain("离脚 14 格高")
  expect(floor[0]!.text).toContain("至少 17.68 格")
  // Lower than that: nothing.
  expect(said(AbilitySchema.parse({ ...breath, start: { ...breath.start, max_distance: 16 }, hits: [{ ...cone, at: 1.4, shape: { ...cone.shape, up: 12 } }] }), hovering, null)).toEqual([])
})

// ---- the generated class ----

test("the generated creature holds an aimed air ability to where its hits reach and writes nothing of it for any other", () => {
  const source = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [breath, claw], flight: dragonFlight, habits: dragonHabits } as never))
  // The row: reach, up, ahead, left, ticks of the first and of the last hit, push of the hits before the last, and the part of it the aim follows.
  const written = [16, mouth.up, mouth.forward, mouth.left, 28, 48, breathPush * 2, (2 * 0.15) / (1 - 0.6 * 0.91)].map((value) => Number(value.toFixed(4))).map((value) => (Number.isInteger(value) ? `${value}.0` : `${value}`))
  expect(source).toContain(`private static final double[][] FLIGHT_REACH = {{${written.join(", ")}}, null};`)
  // The start, gated where `flightFaces` is: from the air only, by the hold flown forward from where the flier is (`airReachPath`, tick by tick), read at every tick from the first hit to the last.
  expect(source).toContain("|| !flightFaces(index, target) || !flightReaches(index, target)) return false;")
  expect(source).toContain("if (reach == null || flightState() == FLIGHT_GROUND) return true;")
  expect(source).toContain("double[] at = flightLeaned(reach[2] * scale, reach[1] * scale, reach[3] * scale);")
  expect(source).toContain("double station = Math.max(reach[0] / 3.0 - reach[1] * scale, floor);")
  expect(source).toContain("for (int tick = 0; tick <= (int) reach[5]; tick++) {")
  expect(source).toContain("boolean getting = ABILITY_TRACKS[index] && tick < ABILITY_WINDUP[index];")
  expect(source).toContain("if (tick >= (int) reach[4]) {")
  expect(source).toContain("double want = stays ? 0.0 : FLIGHT_SOAR ? FLIGHT_STALL : FLIGHT_CRUISE * 0.5;")
  expect(source).toContain("if (!getting) facing = heading;")
  // The farthest it may be: the reach less the push of the hits before the last and a step of cruise, or the station and a step; never nearer than a third.
  expect(source).toContain("double nearest = Math.hypot(reach[0] * 2.0 / 3.0, Math.max(reach[0] / 3.0, lowest));")
  expect(source).toContain("return far <= Math.max(reach[0] - reach[6] - FLIGHT_CRUISE, nearest + FLIGHT_CRUISE) && near >= reach[0] / 3.0;")
  // The aim follows the one it fights while the hits are counted, no faster than it turns and no further than the hits push them and a step of cruise; one that holds its facing (lock) does not.
  expect(source).toContain("else if (ABILITY_TRACKS[abilityIndex] && FLIGHT_REACH[abilityIndex] != null) abilityFollow(abilityTarget);")
  expect(source).toContain("private void abilityFollow(LivingEntity target) {")
  expect(source).toContain("double most = FLIGHT_REACH[abilityIndex][7] + flightStep();")
  expect(source).toContain("private double flightStep() { return FLIGHT_CRUISE; }")
  // The station, held while it runs: the point on the bearing it has from the target, two thirds of the reach less nothing it lies ahead by, never past the target; the floor rule at that column.
  expect(source).toContain("double body = Math.max(0.0, ahead + Math.sqrt(Math.max(0.0, across * across - left * left)));")
  expect(source).toContain("double away = closing ? 0.0 : Math.min(flat, body);")
  expect(source).toContain("return Math.max(target.getY(0.5) + reach[0] / 3.0 - reach[1] * getScale(), flightGround(x, z, getY()) + 1.0);")
  expect(source).toContain("flightSteer(station, FLIGHT_STALL, false);")
  expect(source).toContain("flightSteer(station, flightApproach(station, FLIGHT_CRUISE * 0.5), false);")
  // The old sinking is part of it now, not beside it.
  expect(source).not.toContain("flightReachClimb")
  // A flier whose air abilities are not aimed, or none: nothing of it, and the bytes of before (pinned at HEAD of 9879d25).
  for (const abilities of [[dragonAnchoredAbilities[0]!, dragonAnchoredAbilities[2]!, claw], [claw]]) {
    const plain = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities, flight: dragonFlight } as never))
    ;["FLIGHT_REACH", "flightReaches", "flightReachStation", "flightReachFeet", "abilityFollow", "abilityHold", "flightStep"].forEach((word) => expect(plain).not.toContain(word))
    expect(plain).toContain("flightMove(FLIGHT_SOAR ? Math.max(flightSpeed, FLIGHT_STALL) : 0.0, getYRot(), 0.0f);")
  }
  // re-pinned when every creature became the game's ageing animal, so it can be a baby (test/creature-baby.test.ts): the class gained its baby members and its renderer one line for the shadow; nothing else of any creature moved.
  // names only (Yarn → Mojang), checked 2026-11-14
  // re-pinned 2026-11-14 (任务二 超大体型): the dragon's parts name bones, which they now follow (a table and its lookup, hitbox-follow.ts); the same document with its parts' bones taken out is the old hash to the byte (test/hitbox-follow.test.ts)
  expect(sha(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [dragonAnchoredAbilities[0]!, dragonAnchoredAbilities[2]!, claw], flight: dragonFlight } as never))).toBe("1e3ae1834d6b6012 242973")
})

const sampleClip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })
const sampleDesign = {
  ...fightingGolemDesign,
  animations: [...fightingGolemDesign.animations.filter((animation) => !["burst", "wave", "roar"].includes(animation.name)), ...[["takeoff", 1.5, false], ["fly", 1, true], ["glide", 2, true], ["hover", 1, true], ["land", 1.2, false], ["sleep", 2, true], ["eat", 1.5, false], ["roar", 0.8, false], ["stoop", 1.2, false]].map(([name, length, loop]) => sampleClip(name as string, length as number, loop as boolean))],
}
const sample = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, model: sampleDesign, behavior: "hostile" as const }
const sampleFlight = FlightSchema.parse({ style: "soar", speed: 12, altitude: { min: 10, max: 28 }, turn: 80, climb: 40, bank: 28, air_share: 0.6, takeoff: { clip: "takeoff", seconds: 1.5 }, land: { clip: "land", seconds: 1.2 }, clips: { fly: "fly", glide: "glide", hover: null } })
const sampleHabits = HabitsSchema.parse({ active: "day", rest: { clip: "sleep" }, home: { radius: 32 }, prey: ["cow", "sheep"], hunger_seconds: 300, eat: { clip: "eat" }, alert: { clip: "roar", distance: 20 } })
const sampleSlam = AbilitySchema.parse(golemAbilities[0])
const sampleDive = AbilitySchema.parse({ ...golemAbilities[0], id: "stoop", name: "俯冲", clip: "stoop", windup: 0.5, length: 1.2, where: "air", dive: true, start: { min_distance: 6, max_distance: 16, line_of_sight: true, cooldown: 4, weight: 3 }, hits: [{ ...golemAbilities[0]!.hits[0], at: 0.9 }] })

test("a flier that eats on the ground eats to the end: a mood for the air does not take it up, what is urgent still does", () => {
  const eats = java(compileEntity({ ...sample, abilities: [sampleSlam, sampleDive], flight: sampleFlight, habits: sampleHabits } as never))
  // After the rest (which it already did) and before the mood: the meal on the ground. The fight, a request to fly somewhere, a return and a boss's show come before both.
  const wants = eats.slice(eats.indexOf("private boolean flightWantsAir()"), eats.indexOf("private boolean flightUrgent()"))
  expect(wants.indexOf("if (flightReturning) return true;")).toBeGreaterThanOrEqual(0)
  const order = ["if (flightReturning) return true;", "target.isAlive() && FLIGHT_FIGHTS", "if (flightAsked())", "if (habitResting()) return false;", "if (habitEatLeft > 0) return false;", "if (tickCount >= flightMoodUntil)"].map((line) => wants.indexOf(line))
  expect(order.every((at) => at >= 0)).toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  // A creature whose habits have no meal, and one without habits, read as before, to the byte (pinned at the commit before this one).
  const hungry = (eat: unknown) => sha(compileEntity({ ...sample, abilities: [sampleSlam, sampleDive], flight: sampleFlight, habits: { ...sampleHabits, eat } } as never))
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(hungry(null)).toBe("feb005f9c4a75f1f 115010")
  expect(hungry(null)).not.toBe(hungry({ clip: "eat" }))
  expect(java(compileEntity({ ...sample, abilities: [sampleSlam, sampleDive], flight: sampleFlight, habits: { ...sampleHabits, eat: null } } as never))).not.toContain("habitEatLeft > 0) return false")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...sample, abilities: [sampleSlam, sampleDive], flight: sampleFlight } as never))).toBe("27f5e721a7857bef 102570")
})

test("the contract reader says the start and the station, and the meal, only when they are written", () => {
  const read = (abilities: unknown[], habits: unknown) => {
    const facts = readGeneratedCreature(java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities, flight: dragonFlight, habits } as never)), null)
    return { facts, text: creatureContractLines({ title: "龙", key: "dragon" }, facts).join("\n") }
  }
  const held = read([breath, claw], dragonHabits)
  expect(held.facts.flight).toMatchObject({ gated: true, faces: true, reaches: true, follows: true, meal: true })
  expect(held.text).toContain("要出手的地方离目标够得着才会开始")
  expect(held.text).toContain("蓄力结束后瞄准点仍会跟着目标")
  expect(held.text).toContain("吃东西时（在地上）它不会因为一时兴起起飞，吃完才会")
  const plain = read([dragonAnchoredAbilities[2], claw], { ...dragonHabits, eat: null })
  expect(plain.facts.flight).not.toHaveProperty("reaches")
  expect(plain.facts.flight).not.toHaveProperty("follows")
  expect(plain.facts.flight).not.toHaveProperty("meal")
  expect(plain.text).not.toContain("够得着才会开始")
  expect(plain.text).not.toContain("瞄准点仍会跟着目标")
  expect(plain.text).not.toContain("一时兴起")
})

// ---- a real javac over the whole tree ----

async function tree(directory: string, entity: Record<string, unknown>, level: "epic" | "fine") {
  const sampleProject = await createDataGameplaySample(directory, { life: true, abilities: true })
  const dragon = EntitySchema.parse({ ...sampleProject.entities[0]!, ...entity })
  const blueprint = {
    request: "做一只会朝人喷吐的巨龙",
    style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" },
    questions: [],
    revision: 1,
    state: "confirmed" as const,
    entries: [
      { key: "dragon_model", kind: "model", title: "龙模型", brief: "说明", owner: "dragon", needs: [], out_of_scope: null, asset_id: dragon.id },
      { key: "dragon", kind: "entity", title: "龙", brief: "一只会飞的龙", owner: null, needs: ["dragon_model"], out_of_scope: null, asset_id: null, tier: { level, reason: "你说了终极", by: "ai" as const } },
    ],
  }
  const saved = await saveProject(directory, { ...sampleProject, entities: [dragon], blueprint } as never, sampleProject.revision)
  await putModelAsset(directory, { entity_id: dragon.id, data: { design: dragonDesign }, origin: "example", expectedRevision: saved.revision })
}

test.skipIf(!OFFICIAL)("the generated tree of a giant flying boss with an aimed breath in the air and a meal after a kill compiles, anchored to the mouth and not", async () => {
  for (const [name, abilities, hitbox] of [
    ["anchored", [dragonAnchoredAbilities[0], breath, dragonAnchoredAbilities[2], claw], dragonHitbox],
    // A flier too slow to turn tight enough closes in when its breath is ready (the boss only for one its phase allows).
    ["slow", [dragonAnchoredAbilities[0], wide, dragonAnchoredAbilities[2], claw], dragonHitbox],
    // No bone and no collision parts: the lean is not written, the place the hits start at is the feet plus the shape's own height.
    ["feet", [AbilitySchema.parse({ ...breath, hits: [1.4, 1.9, 2.4].map((at) => ({ ...cone, at, shape: { ...cone.shape, up: 2 } })) }), claw], undefined],
  ] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `minemods-air-station-${name}-`))
    roots.push(root)
    const directory = path.join(root, "project")
    await tree(directory, { abilities, flight: name === "slow" ? FlightSchema.parse({ ...dragonFlight, turn: 30 }) : dragonFlight, habits: dragonHabits, ...(name === "anchored" || name === "slow" ? { boss: dragonBoss } : {}), ...(hitbox ? { hitbox } : {}) }, name === "feet" ? "fine" : "epic")
    const source = path.join(root, "source")
    await mkdir(source)
    const built = await assembleBuildSource(directory, source, TEMPLATE)
    expect(built.findings.filter((finding) => finding.stops)).toEqual([])
    const compiled = (await compileTreeFor("fabric-1.21.1-official", source))!
    expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
    expect(compiled.code).toBe(0)
  }
}, 400000)

test("the ticks of the breath: windup 1.2 s, hits at 1.4, 1.9 and 2.4 s", () => {
  expect([1.2, 1.4, 1.9, 2.4].map((seconds) => Math.round(seconds * TICKS))).toEqual([24, 28, 38, 48])
})

test("what the aim follows is the hits' own knockback, so a runner still gets away from the later hits, as with the game's push left out", () => {
  // epic game4: running across from the start of getting ready dodged one hit in three, running after the first hit none. The whole push of a hit (the game's 0.4 on top of the knockback) is the gate's
  // margin and is carried by the reach; the aim follows the knockback alone. Over every start the gate lets in, runners at a walk, a jog and a sprint (0.15, 0.2, 0.28 blocks a tick):
  const started = starts().filter((from) => gate(from))
  const dodged = (speed: number, runFrom: number, budget: number) => {
    const all = started.flatMap((from) => fight({ row: breathRow, flier: dragonFlier, ability: breathWindup, hits: breathHits, cone: 24, from, follow: true, push: breathPush, run: [0, speed], runFrom, budget }))
    return all.filter((strike) => !strike.hit).length / all.length
  }
  const follows = breathRow[7]! + dragonFlier.cruise
  const wholePush = breathRow[6]! + dragonFlier.cruise
  expect(follows).toBeLessThan(wholePush)
  for (const speed of [0.15, 0.2, 0.28]) {
    // From the start of getting ready a third of the hits and more are dodged, and after the first hit a quarter and more, at a walk too; with the whole push followed, a walker is hit almost always.
    expect(dodged(speed, 0, follows)).toBeGreaterThan(0.33)
    expect(dodged(speed, 29, follows)).toBeGreaterThan(0.25)
    expect(dodged(speed, 0, follows)).toBeGreaterThan(dodged(speed, 0, wholePush))
    expect(dodged(speed, 29, follows)).toBeGreaterThan(dodged(speed, 29, wholePush))
  }
})

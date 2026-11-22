import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { saveProject } from "../src/project"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"
import { TICKS } from "../src/ability-words"
import { abilityHitShapes, abilityIssues, diveReach, hitAnchor, hitAnchors } from "../src/creature-abilities"
import { airReach } from "../src/creature-flight"
import { AbilitySchema, EntitySchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { dragonAnchoredAbilities, dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox } from "./giant-flier"

const OFFICIAL = hasTargetJavac("fabric-1.21.1-official")

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

/**
 * broad11 w1: a thunderbird boss dived 7 times and slashed a wind blade 6 times in 80 seconds of a real game and neither ever did damage.
 * The dive brought the middle of its body to the middle of the player, while its peck counted from the beak, 2.3 blocks ahead of that middle: the
 * peck was counted a beak's length past the player, and its arc reaches ahead of the beak. The wind blade aimed "at the target" from the tip of its
 * left wing, but kept parallel to the way it faced, so it went by 3.6 blocks to the side of the player in front of it. The arithmetic below is the
 * generated Java's (`flightDiveReached`, `abilityInArc`, `abilityDirection`, `abilityInLine`), written out so the old and the new can be compared.
 */

const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "dragon", name: "巨龙", health: 400, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entityFile])

// A dive whose peck comes from the head, 7.5 blocks ahead of the dragon's feet; its arc reaches from 5 below the head to 1 above it.
const peck = AbilitySchema.parse({
  ...dragonAnchoredAbilities[3],
  hits: [{ type: "area", at: 0.9, shape: { type: "arc", reach: 3, angle: 140, low: -5, high: 1 }, hits: "target", damage: 8, knockback: 0.5, effects: [], bone: "head" }],
})
// A blade from the tip of the left wing, aimed at the one it fights.
const blade = AbilitySchema.parse({
  ...dragonAnchoredAbilities[0],
  id: "blade",
  start: { min_distance: 0, max_distance: 12, line_of_sight: true, cooldown: 4, weight: 3 },
  hits: [{ type: "area", at: 0.5, shape: { type: "line", up: 0, length: 16, radius: 1.5, aim: "target" }, hits: "target", damage: 6, knockback: 0.4, effects: [], bone: "wing_tip_left" }],
})

const PLAYER = { width: 0.6, height: 1.8 }

/** The generated `abilityInArc`, from feet at `feet` facing `yaw`, with the bone at `shift` ([forward, up, left]); the player stands with its feet at `at`. */
function inArc(feet: number[], yaw: number, shift: number[], shape: { reach: number; angle: number; low: number; high: number }, at: number[]) {
  const turn = (yaw * Math.PI) / 180
  if (at[1]! + PLAYER.height < feet[1]! + shift[1]! + shape.low || at[1]! > feet[1]! + shift[1]! + shape.high) return false
  const ahead = -(at[0]! - feet[0]!) * Math.sin(turn) + (at[2]! - feet[2]!) * Math.cos(turn) - shift[0]!
  const left = (at[0]! - feet[0]!) * Math.cos(turn) + (at[2]! - feet[2]!) * Math.sin(turn) - shift[2]!
  const flat = Math.hypot(ahead, left)
  const wide = PLAYER.width / 2
  if (flat - wide > shape.reach) return false
  if (flat <= wide) return true
  return Math.abs((Math.atan2(left, ahead) * 180) / Math.PI) <= shape.angle / 2 + (Math.asin(Math.min(1, wide / flat)) * 180) / Math.PI
}

test("a dive whose first hit counts from a bone brings that bone, and the middle of what it reaches, to the one it fights", () => {
  const anchor = hitAnchor(peck, 0, dragonDesign)!
  expect(anchor.forward).toBeGreaterThan(6)
  const reach = diveReach(peck, [anchor])!
  // The bone, then the middle of the arc from it: half its reach ahead, halfway between its low and its high.
  expect(reach.slice(3)).toEqual([1.5, -2, 0])
  expect(reach.slice(0, 3)).toEqual([anchor.forward, anchor.up, anchor.left])
  // Not a dive, or a dive counted from the feet: nothing to bring.
  expect(diveReach(dragonAnchoredAbilities[3]!, hitAnchors([dragonAnchoredAbilities[3]!], dragonDesign)[0]!)).toBeNull()
  expect(diveReach(AbilitySchema.parse({ ...peck, dive: false, where: "air" }), [anchor])).toBeNull()

  // The charge ends with the middle of its body at the goal on the tick of the hit. The player stands at the origin; the dragon comes from 30 blocks south and 14 up.
  const height = dragonHitbox.core.height
  const target = [0.5, 64, 0.5]
  const start = [0.5, 64 + 14 + height / 2, -29.5]
  const middle = [target[0]!, target[1]! + PLAYER.height / 2, target[2]!]
  // Before: the middle of the body to the middle of the player.
  const before = [middle[0]!, middle[1]! - height / 2, middle[2]!]
  // Now (`flightDiveReached`): laid back along the way it comes in on by the bone and the middle of the arc; the feet never under the player's.
  const way = [middle[0]! - start[0]!, middle[2]! - start[2]!]
  const long = Math.hypot(way[0]!, way[1]!)
  const [wx, wz] = [way[0]! / long, way[1]! / long]
  const ahead = reach[0]! + reach[3]!
  const up = reach[1]! + reach[4]!
  const left = reach[2]! + reach[5]!
  const after = [middle[0]! - wx * ahead - wz * left, Math.max(middle[1]! - up, target[1]!), middle[2]! - wz * ahead + wx * left]
  // It faces the player (south to north is yaw 0 in the game's terms).
  const shift = [anchor.forward, anchor.up, anchor.left]
  const shape = { reach: 3, angle: 140, low: -5, high: 1 }
  expect(inArc(before, 0, shift, shape, target)).toBe(false)
  expect(inArc(after, 0, shift, shape, target)).toBe(true)
  // A player who steps a block toward it or away from it after it locked on is still met: the hit's middle, not its edge, was brought to them.
  expect(inArc(after, 0, shift, shape, [target[0]!, target[1]!, target[2]! - 1])).toBe(true)
  expect(inArc(after, 0, shift, shape, [target[0]!, target[1]!, target[2]! + 1])).toBe(true)
})

test("a beam aimed at the one it fights from a bone off the middle of the body crosses over to them", () => {
  const anchor = hitAnchor(blade, 0, dragonDesign)!
  expect(anchor.left).toBeGreaterThan(8)
  // The generated `abilityDirection` and `abilityInLine`, facing yaw 0 (north, +z), the player 8 blocks ahead on the same ground.
  const feet = [0, 64, 0]
  const player = [0, 64, 8]
  const aimFlat = 8
  const aimY = 64 + PLAYER.height / 2
  const from = [feet[0]! + anchor.left, feet[1]! + anchor.up, feet[2]! + anchor.forward]
  const hits = (direction: number[]) => {
    const norm = Math.hypot(...direction)
    const aim = direction.map((value) => value / norm)
    const centre = [player[0]!, player[1]! + PLAYER.height / 2, player[2]!]
    const along = Math.min(Math.max((centre[0]! - from[0]!) * aim[0]! + (centre[1]! - from[1]!) * aim[1]! + (centre[2]! - from[2]!) * aim[2]!, 0), 16)
    const point = from.map((value, axis) => value + aim[axis]! * along)
    // The squared distance from the point to the player's box.
    const box = [
      [player[0]! - 0.3, player[0]! + 0.3],
      [player[1]!, player[1]! + PLAYER.height],
      [player[2]! - 0.3, player[2]! + 0.3],
    ]
    const gap = point.reduce((sum, value, axis) => sum + Math.max(box[axis]![0]! - value, 0, value - box[axis]![1]!) ** 2, 0)
    return gap <= 1.5 * 1.5
  }
  const flat = Math.max(0.5, aimFlat - anchor.forward)
  const rise = aimY - (feet[1]! + anchor.up)
  // Before: parallel to the way it faces. Now: across by the bone's own offset to its left.
  expect(hits([0, rise, flat])).toBe(false)
  expect(hits([-anchor.left, rise, flat])).toBe(true)
})

test("what is drawn of an aimed beam from a bone off the middle turns to the one it fights, taken to stand straight ahead in the middle of its distances", () => {
  const [found] = abilityHitShapes(blade, dragonDesign)!
  const anchor = found!.anchor!
  // The middle of the drawn line (the mean of its faces' corners): in the model's frame x is the creature's right, so its own left is -x / 16 and ahead is -z / 16.
  const points = found!.faces.flat()
  const left = -points.reduce((sum, point) => sum + point[0]!, 0) / points.length / 16
  const ahead = -points.reduce((sum, point) => sum + point[2]!, 0) / points.length / 16
  // The middle of the start distances is 6 blocks ahead: the middle of the line lies on the way from the tip to there (no distance off that way, measured square to it).
  const way = [6 - anchor.forward, -anchor.left]
  const long = Math.hypot(way[0]!, way[1]!)
  expect(Math.abs(((ahead - anchor.forward) * way[1]! - (left - anchor.left) * way[0]!) / long)).toBeLessThan(0.05)
  expect((ahead - anchor.forward) * way[0]! + (left - anchor.left) * way[1]!).toBeGreaterThan(0)
  expect(left).toBeLessThan(anchor.left - 5)
})

test("the generated creature writes the dive's reach only when a dive counts from a bone, and its beams cross over from an off-middle bone", () => {
  const plain = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAnchoredAbilities, flight: dragonFlight } as never))
  expect(plain).not.toContain("FLIGHT_DIVE_REACH")
  expect(plain).not.toContain("flightDiveReached")
  // A flier aims at where the one it fights stood, from wherever the hit starts; a creature that walks crosses over by the bone's own offset (it faces them).
  expect(plain).toContain("double toX = abilityAimX - from.x;")
  const walker = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [blade] } as never))
  expect(walker).toContain("- Mth.cos(turn) * abilityShiftL")
  expect(walker).not.toContain("abilityAimX")
  const reached = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [...dragonAnchoredAbilities.slice(0, 3), peck, blade], flight: dragonFlight } as never))
  const anchor = hitAnchor(peck, 0, dragonDesign)!
  expect(reached).toContain(`private static final double[][] FLIGHT_DIVE_REACH = {null, null, null, {${[anchor.forward, anchor.up, anchor.left].map((value) => (Number.isInteger(value) ? `${value}.0` : `${value}`)).join(", ")}, 1.5, -2.0, 0.0}, null};`)
  expect(reached).toContain("flightDiveGoal = flightDiveReached(flightDiveGoal, centre, target);")
  expect(reached).toContain("Vec3 face = FLIGHT_DIVE_REACH[abilityIndex] == null ? to : flightDiveFace.subtract(centre);")
})

test.skipIf(!OFFICIAL)("the generated tree of a flying boss whose dive pecks from its head and whose blade comes from a wing tip compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-dive-reach-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const dragon = EntitySchema.parse({ ...sample.entities[0]!, abilities: [...dragonAnchoredAbilities.slice(0, 3), peck, blade], flight: dragonFlight, habits: dragonHabits, boss: dragonBoss, hitbox: dragonHitbox })
  const blueprint = {
    request: "做一只会俯冲啄人、扇出风刃的巨鸟",
    style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" },
    questions: [],
    revision: 1,
    state: "confirmed" as const,
    entries: [
      { key: "dragon_model", kind: "model", title: "鸟模型", brief: "说明", owner: "dragon", needs: [], out_of_scope: null, asset_id: dragon.id },
      { key: "dragon", kind: "entity", title: "鸟", brief: "一只会飞的巨鸟", owner: null, needs: ["dragon_model"], out_of_scope: null, asset_id: null, tier: { level: "epic" as const, reason: "你说了终极", by: "ai" as const } },
    ],
  }
  const saved = await saveProject(directory, { ...sample, entities: [dragon], blueprint } as never, sample.revision)
  await putModelAsset(directory, { entity_id: dragon.id, data: { design: dragonDesign }, origin: "example", expectedRevision: saved.revision })
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
  const compiled = (await compileTreeFor("fabric-1.21.1-official", source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

test("in the air an ability laid out ahead of it waits until it can turn to the one it fights, and what it shows along an aim turns with the aim", () => {
  // broad11 w1 recheck: the wind blade was let go 150° away from the player, and its effect flew the way the body faced, 42–81° off the hit.
  const source = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [...dragonAnchoredAbilities.slice(0, 3), peck, blade], flight: dragonFlight } as never))
  // bite (a sphere ahead), breath (a cone and a shot aimed at the target), sweep (an arc ahead), the peck (a dive lines up by its flight), the blade (a beam aimed at the target).
  expect(source).toContain("private static final boolean[] FLIGHT_FACES = {true, false, true, false, false};")
  // The blade is aimed at the one it fights and may start in the air, so it also starts only when its hits can reach them (`flightReaches`, epic game1).
  expect(source).toContain("if (tickCount < abilityReadyAt[index] || !flightAllows(index) || !flightFaces(index, target) || !flightReaches(index, target)) return false;")
  expect(source).toContain("return off <= flightTurnCap() * (ABILITY_WINDUP[index] + 1);")
  // The turn it may make is its own rate over the ticks of getting ready and one more: the thunderbird (100° a second, 0.68 s) turns 75° at most, so 150° away it waits.
  const thunderbird = (100 / 20) * (Math.round(0.68 * 20) + 1)
  expect(thunderbird).toBe(75)
})

test("an ability that starts further away than its hit reaches straight ahead is said to miss at the far end, counted from the bone it comes from", () => {
  // broad11 w1 recheck2: blades let go at a player past the end of the beam (4.8 and 1.6 blocks short) missed although they aimed true.
  const anchor = hitAnchor(blade, 0, dragonDesign)!
  const beam = 16 + 1.5
  const ahead = anchor.forward + Math.sqrt(beam * beam - anchor.left * anchor.left)
  const far = AbilitySchema.parse({ ...blade, start: { ...blade.start, max_distance: Math.ceil(ahead) + 2 } })
  const issues = (ability: typeof blade) => abilityIssues({ name: "巨龙", behavior: "hostile", abilities: [ability] }, null, dragonDesign).filter((issue) => issue.rule === "ability_reach")
  const said = issues(far)
  expect(said).toHaveLength(1)
  expect(said[0]!.text).toContain(`正前方最远只打得到 ${Number(ahead.toFixed(2))} 格`)
  expect(said[0]!.stops).toBe(false)
  // Within reach: nothing said.
  expect(issues(blade)).toEqual([])
})

test("the charge lays its goal out again every tick from the lean and the facing the hit is counted with", () => {
  // epic game1: the claws of a dragon 7.5 blocks tall stopped about 3 blocks from a player standing still: the goal was laid out level, the hit was counted leaning into the dive.
  const source = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [...dragonAnchoredAbilities.slice(0, 3), peck, blade], flight: dragonFlight } as never))
  expect(source).toContain("if (FLIGHT_DIVE_REACH[abilityIndex] != null) flightDiveGoal = flightDiveHeld();")
  expect(source).toContain("double[] bone = flightLeaned(reach[0] * scale, reach[1] * scale, reach[2] * scale);")
  expect(source).toContain("flightDiveFloor = target.getY();")
  // The arithmetic of `flightLeaned` and `flightDiveHeld`, written out: nose 35° down and banked 20°, facing yaw 30°; the hit counts from the leaned bone plus the middle of its reach.
  const height = dragonHitbox.core.height
  const leaned = (forward: number, up: number, left: number, pitch: number, roll: number) => {
    const middle = height / 2
    const [x, y, z] = [-left, up - middle, -forward]
    const [r, p] = [(roll * Math.PI) / 180, (pitch * Math.PI) / 180]
    const rolledX = x * Math.cos(r) - y * Math.sin(r)
    const rolledY = x * Math.sin(r) + y * Math.cos(r)
    return [-(rolledY * Math.sin(p) + z * Math.cos(p)), rolledY * Math.cos(p) - z * Math.sin(p) + middle, -rolledX]
  }
  const anchor = hitAnchor(peck, 0, dragonDesign)!
  const reach = diveReach(peck, [anchor])!
  const face = [10, 70, -4]
  const floor = 64
  const yaw = (30 * Math.PI) / 180
  const bone = leaned(reach[0]!, reach[1]!, reach[2]!, -35, 20)
  const [ahead, up, left] = [bone[0]! + reach[3]!, bone[1]! + reach[4]!, bone[2]! + reach[5]!]
  const feet = Math.max(face[1]! - up, floor)
  const goal = [face[0]! + Math.sin(yaw) * ahead - Math.cos(yaw) * left, feet + height / 2, face[2]! - Math.cos(yaw) * ahead - Math.sin(yaw) * left]
  // Where the hit is counted from with the body at the goal: the feet, the leaned bone turned by the facing, and the middle of the reach (`abilityPoint`).
  const atFeet = [goal[0]!, goal[1]! - height / 2, goal[2]!]
  const point = [atFeet[0]! - ahead * Math.sin(yaw) + left * Math.cos(yaw), atFeet[1]! + up, atFeet[2]! + ahead * Math.cos(yaw) + left * Math.sin(yaw)]
  // Horizontally on the point it locked; vertically too unless the ground held its feet up.
  expect(Math.hypot(point[0]! - face[0]!, point[2]! - face[2]!)).toBeLessThan(1e-9)
  expect(feet === floor ? point[1]! >= face[1]! : Math.abs(point[1]! - face[1]!) < 1e-9).toBe(true)
})

test("an ability in the air aimed at the one it fights is held to where its hits reach: it starts only in reach and the flier holds station while it runs", () => {
  // epic game1: the breath from the mouth (a cone 16 long) never reached a player 25–34 blocks from the mouth of a dragon circling 10 blocks up, and later started out of reach and was flown on past.
  const breath = AbilitySchema.parse({ ...dragonAnchoredAbilities[1], where: "air", hits: [dragonAnchoredAbilities[1]!.hits[0]] })
  const source = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [breath, dragonAnchoredAbilities[3]], flight: dragonFlight } as never))
  const anchor = hitAnchor(breath, 0, dragonDesign)!
  // [reach, up, ahead, left, tick of the first hit, of the last, push, follow]: the cone is 14 long, the one hit is counted at 1.2 seconds, and no hit before it pushes anybody.
  const row = [14, anchor.up, anchor.forward, anchor.left, Math.round(1.2 * TICKS), Math.round(1.2 * TICKS), 0, 0].map((value) => Number(value.toFixed(4)))
  expect(airReach([breath, dragonAnchoredAbilities[3]!], hitAnchors([breath, dragonAnchoredAbilities[3]!], dragonDesign))).toEqual([row, null])
  const written = row.map((value) => (Number.isInteger(value) ? `${value}.0` : `${value}`)).join(", ")
  expect(source).toContain(`private static final double[][] FLIGHT_REACH = {{${written}}, null};`)
  expect(source).toContain("|| !flightFaces(index, target) || !flightReaches(index, target)) return false;")
  expect(source).toContain("Vec3 station = flightReachStation(abilityIndex, abilityTarget, false);")
  expect(source).toContain("flightSteer(station, flightApproach(station, FLIGHT_CRUISE * 0.5), false);")
  // A flier without such an ability keeps its height while an ability runs, written as it always was.
  const plain = java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: [dragonAnchoredAbilities[2], dragonAnchoredAbilities[3]], flight: dragonFlight } as never))
  expect(plain).not.toContain("FLIGHT_REACH")
  expect(plain).not.toContain("flightReaches")
  expect(plain).toContain("flightMove(FLIGHT_SOAR ? Math.max(flightSpeed, FLIGHT_STALL) : 0.0, getYRot(), 0.0f);")
})

test("a hit that follows a landed one of the same ability within the game's half second of hurt is said to do nothing", () => {
  // epic game1: a breath that hit at 1.4, 1.8 and 2.2 seconds took 4 blood at the first and the last and nothing at the middle one.
  const cone = { type: "area", shape: { type: "cone", up: 0, length: 16, angle: 24, aim: "target" }, hits: "everyone", damage: 4, knockback: 0.15, effects: [] }
  const breath = AbilitySchema.parse({ ...dragonAnchoredAbilities[1], windup: 1.2, length: 3.2, hits: [1.4, 1.8, 2.2].map((at) => ({ ...cone, at })) })
  const said = abilityIssues({ name: "巨龙", behavior: "hostile", abilities: [breath] }, null).filter((issue) => issue.rule === "ability_rehit")
  expect(said).toHaveLength(1)
  expect(said[0]!.text).toContain("有 1 下离上一下不到 0.5 秒（第 1.8 秒）")
  expect(said[0]!.stops).toBe(false)
  // Half a second apart, or heavier: nothing said.
  const spaced = AbilitySchema.parse({ ...breath, hits: [1.4, 1.9, 2.4].map((at) => ({ ...cone, at })) })
  expect(abilityIssues({ name: "巨龙", behavior: "hostile", abilities: [spaced] }, null).filter((issue) => issue.rule === "ability_rehit")).toEqual([])
  const heavier = AbilitySchema.parse({ ...breath, hits: [{ ...cone, at: 1.4 }, { ...cone, at: 1.6, damage: 8 }] })
  expect(abilityIssues({ name: "巨龙", behavior: "hostile", abilities: [heavier] }, null).filter((issue) => issue.rule === "ability_rehit")).toEqual([])
})

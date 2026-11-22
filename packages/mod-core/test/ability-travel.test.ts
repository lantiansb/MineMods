import { expect, test } from "bun:test"
import { AbilitySchema } from "../src/entity-runtime"
import { abilityTravel, diveHeight, diveSpeed, travelAt } from "../src/ability-travel"
import { impactMoments } from "../src/impact-picture"
import { diveFrame, assumedTarget } from "../src/effect-abilities"
import { flightPlan } from "../src/creature-flight"
import { leapReach } from "../src/ability-dash-words"
import { compileEntity } from "../src/fabric/entity"
import { beastCharge, beastDesign, beastPounce, beastStagger, birdDesign, birdFlight, birdSwoop } from "./travel-samples"

/**
 * r29c: the pictures put a creature where an ability carries it with the generated Java's own sums (`ability-travel.ts`). These tests hold the two together: the lines of
 * Java the sums are read from are looked for word for word in what is generated for the samples, and the constants it is generated with are the ones the sums use.
 */

const base = { modId: "travel_mod", packageName: "com.minemods.content_travel_mod", name: "样例", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const java = (input: Record<string, unknown>) => String(compileEntity({ ...base, ...input } as never)["src/main/java/com/minemods/content_travel_mod/entity/StudioCreature.java"])
const constant = (source: string, name: string) => Number(new RegExp(`${name} = (-?[0-9.]+)`).exec(source)![1])
const BIRD = { design: birdDesign, flight: birdFlight, abilities: [birdSwoop], height: 0.75 }

test("the dive the pictures draw is the generated charge: its speed rule, its height, its least and its floor", () => {
  const source = java({ id: "bird", model: birdDesign, abilities: [birdSwoop], flight: birdFlight })
  // The rule, word for word (`flightDiveSpeed`), and that it is fed the ticks to the first hit less one.
  expect(source).toContain("double speed = Math.min(Math.max(distance / Math.max(1, left), least), most);")
  expect(source).toContain("return Math.max(Math.min(speed, distance), floor);")
  expect(source).toContain("flightSpeed = flightDiveSpeed(distance, FLIGHT_FIRST[abilityIndex] - abilityTick - 1, FLIGHT_DIVE_LEAST, FLIGHT_DIVE_MOST, FLIGHT_STALL);")
  expect(source).toContain("setDeltaMovement(distance > 1.0e-6 ? to.scale(flightSpeed / distance) : Vec3.ZERO);")
  const plan = flightPlan(birdFlight, [birdSwoop], true)
  expect(constant(source, "FLIGHT_DIVE_HEIGHT")).toBeCloseTo(diveHeight(birdFlight, [birdSwoop], birdDesign), 4)
  expect(constant(source, "FLIGHT_DIVE_LEAST")).toBeCloseTo(plan.diveLeast, 4)
  expect(constant(source, "FLIGHT_DIVE_MOST")).toBeCloseTo(plan.diveMost, 4)
  expect(constant(source, "FLIGHT_STALL")).toBeCloseTo(plan.stall, 4)
  expect(diveSpeed(10, 5, 0.8, 3.9, 0)).toBe(2)
  expect(diveSpeed(10, 1, 0.8, 3.9, 0)).toBe(3.9)
  expect(diveSpeed(0.3, 5, 0.8, 3.9, 0)).toBe(0.3)
})

test("a dive: still where it gets ready until the charge has started, then straight in, at the target on the tick of its first hit and held there", () => {
  const travel = abilityTravel(birdSwoop, BIRD)!
  expect(travel.kinds).toEqual(["dive"])
  const height = diveHeight(birdFlight, [birdSwoop], birdDesign)
  // Getting ready ends at tick 12; its first velocity is applied before tick 14 is counted.
  expect(travel.places.slice(0, 14).every((place) => place.forward === 0 && place.up === height)).toBe(true)
  expect(travel.from).toBe(14)
  // At the first hit (1.4 s, tick 28) its talons' frame is on the target: where `diveFrame` puts it, which every effect is measured against.
  const frame = diveFrame(birdSwoop, birdDesign)!
  expect(travel.first!.tick).toBe(28)
  expect(travel.first!.place.forward).toBeCloseTo(frame.shift.forward, 3)
  expect(travel.first!.place.up).toBeCloseTo(frame.shift.up, 3)
  expect(travel.first!.place.forward).toBeGreaterThan(assumedTarget(birdSwoop) - 1)
  // Every tick of the charge nearer the target than the one before, along one straight line (the lean of the body is not drawn).
  const charge = travel.places.slice(13, 29)
  expect(charge.every((place, at) => !at || place.forward > charge[at - 1]!.forward)).toBe(true)
  const slope = (charge[1]!.up - charge[0]!.up) / (charge[1]!.forward - charge[0]!.forward)
  expect(charge.slice(2).every((place) => Math.abs((place.up - charge[0]!.up) - slope * (place.forward - charge[0]!.forward)) < 1e-3)).toBe(true)
  expect(travel.places.slice(28).every((place) => place.forward === travel.first!.place.forward)).toBe(true)
  expect(travelAt(travel, 1.4)).toEqual(travel.first!.place)
})

test("a dash and a leap go as the generated Java moves them, and a creature that is carried nowhere has no travel", () => {
  const source = java({ id: "beast", model: beastDesign, abilities: [beastCharge, beastPounce], stagger: beastStagger })
  expect(source).toContain("double step = Math.min(abilityDashStep, abilityDashRoom);")
  expect(source).toContain("double y = abilityLeapFromY + (abilityLeapToY - abilityLeapFromY) * part + 4.0 * abilityLeapHeight * part * (1.0 - part);")
  expect(source).toContain("double go = Math.max(0.0, Math.min(most, flat - shortBy));")
  const dash = abilityTravel(beastCharge, { design: beastDesign, height: 1.25 })!
  // 14 blocks a second from tick 10, 12 blocks at most: 0.7 a tick, after the abilities have ticked, so tick 11 counts the first step.
  expect(dash.kinds).toEqual(["dash"])
  expect(dash.places[10]!.forward).toBe(0)
  expect(dash.places[11]!.forward).toBeCloseTo(0.7, 6)
  expect(dash.places.at(-1)!.forward).toBeCloseTo(12, 6)
  const leap = abilityTravel(beastPounce, { design: beastDesign, height: 1.25 })!
  expect(leap.kinds).toEqual(["leap"])
  // Down a block short of the one it fights (7.5 blocks ahead), on the tick it lands, its arc 2.5 blocks over the line halfway.
  expect(leap.places[20]!.forward).toBeCloseTo(leapReach(beastPounce), 6)
  expect(leap.places[20]!.up).toBe(0)
  expect(Math.max(...leap.places.map((place) => place.up))).toBeCloseTo(2.5, 6)
  expect(abilityTravel(AbilitySchema.parse({ ...beastCharge, id: "butt", moves: [], stages: undefined }), { design: beastDesign, height: 1.25 })).toBeNull()
  // In the air a flier's dash does nothing (the generated Java returns), so nothing is drawn moving.
  expect(abilityTravel(AbilitySchema.parse({ ...beastCharge, where: "air", stages: undefined, moves: [beastCharge.moves[0]] }), { design: beastDesign, flight: birdFlight, height: 1.25 })).toBeNull()
})

test("a push it gives itself is carried on by the game's own mob physics on flat ground", () => {
  const lunge = AbilitySchema.parse({ ...beastPounce, id: "lunge", moves: [{ at: 0.4, forward: 0.8, up: 0.3 }] })
  const travel = abilityTravel(lunge, { design: beastDesign, height: 1.25 })!
  expect(travel.kinds).toEqual(["push"])
  expect(travel.places[8]!.forward).toBe(0)
  // Off the ground at once by its push, then slowed by the air (0.91 a tick) and pulled down (0.08, drag 0.98) until it is down, where the ground slows it fast.
  expect(travel.places[9]!.forward).toBeCloseTo(0.8, 6)
  expect(travel.places[9]!.up).toBeCloseTo(0.3, 6)
  expect(travel.places[10]!.forward).toBeCloseTo(0.8 + 0.8 * 0.546, 6)
  expect(travel.places.at(-1)!.up).toBe(0)
  expect(travel.places.at(-1)!.forward).toBeGreaterThan(2)
})

test("the moments a charge runs into something are placed where the picture's wall and target are, with the daze the wall starts", () => {
  const travel = abilityTravel(beastCharge, { design: beastDesign, height: 1.25 })
  const moments = impactMoments(beastCharge, travel, { stagger: beastStagger, width: 0.75, height: 1.25 })
  const wall = moments.find((moment) => moment.key === "a0.s1.c0")!
  // The dash goes its 12 blocks by the move of tick 27: a wall just past there stops the next one, and it is met at the middle of its front, halfway up.
  expect(wall.tick).toBe(27)
  expect(wall.feet!.forward).toBeCloseTo(12, 6)
  expect(wall.at).toEqual({ forward: 12.375, up: 0.625, left: 0 })
  expect(wall.dazes.map((daze) => [daze.words, daze.at.up])).toEqual([["进入硬直「wall_daze」时", 0.625]])
  // Its horns' box (reaching 1.6 blocks ahead) meets the one it fights 9 blocks off on the stretch of tick 20; what is shown is on them, nearest its middle.
  const touch = moments.find((moment) => moment.key === "a0.dash.touch")!
  expect(touch.tick).toBe(20)
  expect(touch.at!.forward).toBeCloseTo(assumedTarget(beastCharge) - 0.3, 6)
  // Without a travel the wall cannot be placed, and it is said why.
  const still = impactMoments(beastCharge, null, { stagger: beastStagger, width: 0.75, height: 1.25 }).find((moment) => moment.key === "a0.s1.c0")!
  expect(still.tick).toBeNull()
  expect(still.why).toContain("画不出来")
})

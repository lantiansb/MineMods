import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { putModelAsset } from "../src/assets"
import { TICKS } from "../src/ability-words"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, abilityHitShapes, abilityIssues, abilityPlace, abilityWords, hitAnchor, hitAnchors, hitLines, shapeFaces } from "../src/creature-abilities"
import { hitboxFit, hitboxLines } from "../src/creature-hitbox"
import { AbilitySchema, type Ability, EntitySchema, FlightSchema, HabitsSchema, HitboxSchema } from "../src/entity-runtime"
import { compileAbilities } from "../src/fabric/entity-abilities"
import { compileEntity } from "../src/fabric/entity"
import { compileHitboxParts } from "../src/fabric/hitbox"
import { FLIGHT_LIMITS } from "../src/flight-words"
import { REACH, flierSpan, modelReach } from "../src/model-reach"
import { saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { dragonAbilities, dragonAnchoredAbilities, dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJdkTool } from "./target-javac"

const OFFICIAL = hasTargetJavac("fabric-1.21.1-official")

/**
 * Four things a giant flier needs that a creature of the size of a player does not: a hit that comes from a part of its body, collision boxes that go where the body
 * goes in the air, steering that looks from its wing tips, and a place to set down that holds the whole of its box.
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
const PIXELS = 16
const near = (value: number, expected: number, digits = 3) => expect(Math.abs(value - expected)).toBeLessThan(10 ** -digits)
const [bite, breath, sweep, stoop] = dragonAnchoredAbilities as [(typeof dragonAnchoredAbilities)[number], (typeof dragonAnchoredAbilities)[number], (typeof dragonAnchoredAbilities)[number], (typeof dragonAnchoredAbilities)[number]]
// A flier the size of the sample's creatures, pinned at 40304c3 (the numbers of the pins below are of what the generator wrote then): a hostile one with abilities and habits, and a passive hovering one.
const sampleClip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })
const sampleDesign = {
  ...fightingGolemDesign,
  animations: [...fightingGolemDesign.animations.filter((animation) => !["burst", "wave", "roar"].includes(animation.name)), sampleClip("takeoff", 1.5, false), sampleClip("fly", 1, true), sampleClip("glide", 2, true), sampleClip("hover", 1, true), sampleClip("land", 1.2, false), sampleClip("sleep", 2, true), sampleClip("eat", 1.5, false), sampleClip("roar", 0.8, false), sampleClip("stoop", 1.2, false)],
}
const sampleSlam = AbilitySchema.parse(golemAbilities[0])
const sampleDive = AbilitySchema.parse({ ...golemAbilities[0], id: "stoop", name: "俯冲", clip: "stoop", windup: 0.5, length: 1.2, where: "air", dive: true, start: { min_distance: 6, max_distance: 16, line_of_sight: true, cooldown: 4, weight: 3 }, hits: [{ ...golemAbilities[0]!.hits[0], at: 0.9 }] })
const sampleFlight = FlightSchema.parse({ style: "soar", speed: 12, altitude: { min: 10, max: 28 }, turn: 80, climb: 40, bank: 28, air_share: 0.6, takeoff: { clip: "takeoff", seconds: 1.5 }, land: { clip: "land", seconds: 1.2 }, clips: { fly: "fly", glide: "glide", hover: null } })
const sampleHabits = HabitsSchema.parse({ active: "day", rest: { clip: "sleep" }, home: { radius: 32 }, prey: ["cow", "sheep"], hunger_seconds: 300, eat: { clip: "eat" }, alert: { clip: "roar", distance: 20 } })
const sample = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, model: sampleDesign }
const sampleFlier = { ...sample, behavior: "hostile" as const, abilities: [sampleSlam, sampleDive], flight: sampleFlight, habits: sampleHabits }

const giant = { ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAnchoredAbilities, flight: dragonFlight }

// ---- A3a: a hit that comes from a bone ----

test("a hit may name a bone, and a hit that names none is exactly the hit it was", () => {
  const plain = AbilitySchema.parse(golemAbilities[0])
  expect(JSON.stringify(plain)).toBe(JSON.stringify(golemAbilities[0]))
  expect(plain.hits.some((hit) => "bone" in hit)).toBe(false)
  expect(bite.hits[0]).toMatchObject({ bone: "head" })
  const refused = (bone: unknown) => AbilitySchema.safeParse({ ...plain, hits: [{ ...plain.hits[0], bone }] }).success
  expect([refused("head"), refused(""), refused("x".repeat(81)), refused(3)]).toEqual([true, false, false, false])
  // The shot takes it too.
  expect(breath.hits[1]).toMatchObject({ type: "shot", bone: "head" })
})

test("where a bone is at the moment of a hit is the middle of its cubes in the pose the ability's own motion holds at that tick, as the pose arithmetic of the pictures gives it", () => {
  // Independent of `hitAnchor`: the eight corners of the head's one cube, from `posedCorners`, at the tick the hit is counted on.
  const head = dragonDesign.bones.findIndex((bone) => bone.name === "head")
  const before = dragonDesign.bones.slice(0, head).reduce((sum, bone) => sum + bone.cubes.length, 0)
  const clip = dragonDesign.animations.find((animation) => animation.name === "breath")!
  const tick = Math.round(1.2 * TICKS)
  const corners = posedCorners(dragonDesign, clip, tick / TICKS).slice(before * 8, before * 8 + 8)
  const middle = [0, 1, 2].map((axis) => corners.reduce((sum, corner) => sum + corner[axis]!, 0) / 8)
  const place = hitAnchor(breath, 0, dragonDesign)!
  // The model faces -z and its own left is -x: ahead is -z, left is -x, up is y, in blocks.
  near(place.forward, -middle[2]! / PIXELS, 3)
  near(place.up, middle[1]! / PIXELS, 3)
  near(place.left, -middle[0]! / PIXELS, 3)
  // The head is a long way from the feet: well over what any ability's own numbers could reach before.
  expect(place.forward).toBeGreaterThan(6)
  expect(place.up).toBeGreaterThan(2)
  // The pose moves it: the head is lower and nearer in the bite (the neck swings down) than in the breath, and the tail's tip goes aside in the sweep.
  expect(hitAnchor(bite, 0, dragonDesign)!.up).toBeLessThan(place.up)
  expect(hitAnchor(sweep, 0, dragonDesign)!.left).toBeGreaterThan(3)
  // The second hit of the breath is a moment later and finds the head where it is then.
  expect(hitAnchor(breath, 1, dragonDesign)).not.toEqual(place)
  // Hits that name no bone are counted from the feet: nothing to measure.
  expect(hitAnchor(stoop, 0, dragonDesign)).toBeNull()
  expect(hitAnchors(dragonAnchoredAbilities, dragonDesign).map((row) => row.map((value) => value !== null))).toEqual([[true], [true, true], [true], [false]])
})

// A channel that holds the body where it is: a motion must move something to be a motion.
const still = (length: number) => ({ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length, rotation: [0, 0, 0] }] })

test("a bone with no cube is found at its pivot, and a bone the model lacks, or a motion it lacks, is no place at all", () => {
  const design = ModelDesignSchema.parse({
    name: "探",
    texture_size: 64,
    budget: "standard",
    bones: [
      { name: "body", parent: null, pivot: [0, 16, 0], rotation: [0, 0, 0], cubes: [{ name: "torso", origin: [-4, 8, -4], size: [8, 8, 8], faces: { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" } }] },
      { name: "mouth", parent: "body", pivot: [0, 20, -24], rotation: [0, 0, 0], cubes: [] },
    ],
    animations: [
      { name: "idle", length: 1, loop: true, channels: [still(1)] },
      { name: "walk", length: 1, loop: true, channels: [still(1)] },
      { name: "hurt", length: 0.5, loop: false, channels: [still(0.5)] },
      // The body turns a quarter about the vertical on its way: what hangs from it goes round with it.
      { name: "snap", length: 1, loop: false, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: 1, rotation: [0, 90, 0] }] }] },
    ],
  })
  const snap = AbilitySchema.parse({ ...golemAbilities[0], id: "snap", name: "snap", clip: "snap", windup: 0, length: 1, hits: [{ ...golemAbilities[0]!.hits[0], at: 0, bone: "mouth" }, { ...golemAbilities[0]!.hits[0], at: 1, bone: "mouth" }] })
  // At its start the mouth is where it is built: 1.5 blocks ahead of the origin, 1.25 up.
  expect(hitAnchor(snap, 0, design)).toEqual({ forward: 1.5, up: 1.25, left: 0 })
  // A quarter turn later it hangs to the side: the turn carries it from ahead to a side, a block and a half out, at the same height.
  const turned = hitAnchor(snap, 1, design)!
  near(Math.abs(turned.left), 1.5, 3)
  near(turned.forward, 0, 3)
  near(turned.up, 1.25, 3)
  expect(hitAnchor({ ...snap, hits: [{ ...snap.hits[0]!, bone: "tooth" } as Ability["hits"][number]] }, 0, design)).toBeNull()
  expect(hitAnchor({ ...snap, clip: "bite" }, 0, design)).toBeNull()
})

test("a bone the model lacks stops the build, said plainly; a hit from a bone reaches further ahead of the feet than its shape says", () => {
  const named = { name: "巨龙", behavior: "hostile", abilities: [bite] }
  // Its findings are the far end of its window (broad11 w1 recheck2): it starts up to 16 blocks away and reaches 10.4 straight ahead, and the window of a sphere from the head (epic game5):
  // it starts from 0, where the sphere 5.4 to 10.4 ahead meets no one.
  const own = abilityIssues(named, dragonDesign.animations, dragonDesign)
  expect(own.map((found) => found.detail)).toEqual(["ability bite: start.max_distance 16; furthest reach straight ahead 10.38", "ability bite: start 0–16; hits meet straight ahead 5.38–10.38"])
  const lost = { ...named, abilities: [{ ...bite, hits: [{ ...bite.hits[0]!, bone: "jaw" }] }] }
  const [issue, ...others] = abilityIssues(lost, dragonDesign.animations, dragonDesign).filter((found) => !found.detail.includes("start.max_distance"))
  expect(others).toEqual([])
  expect(issue).toMatchObject({ rule: "ability_bone", stops: true, ability: "bite" })
  expect(issue!.text).toContain("「jaw」")
  expect(issue!.text).toContain("模型里没有这个部件")
  expect(issue!.fix).toContain("head")
  expect(() => compileEntity({ ...giant, abilities: [lost.abilities[0]!, breath, sweep] })).toThrow("模型里没有这个部件")
  // The model is not known: there is nothing to say about a bone.
  expect(abilityIssues(lost, dragonDesign.animations)).toEqual([])
  // It starts at 9 blocks and above; its sphere reaches 3.5 ahead of the head, which is 6.9 ahead of the feet: it reaches. Counted from the feet it would not.
  const far = (ability: typeof bite) => abilityIssues({ ...named, abilities: [{ ...ability, start: { ...ability.start, min_distance: 9, max_distance: 16 } }] }, dragonDesign.animations, dragonDesign).filter((found) => found.detail.includes("start.min_distance")).map((found) => found.rule).filter((rule) => rule === "ability_reach")
  expect(far(bite)).toEqual([])
  const feet = { ...bite, hits: [{ ...bite.hits[0]!, bone: undefined }] }
  delete (feet.hits[0] as { bone?: string }).bone
  expect(far(feet)).toEqual(["ability_reach"])
})

test("a window that starts where a sphere from a bone cannot reach is said, with the stretch straight ahead that it does meet (epic game5)", () => {
  // The frost dragon's tail sweep: start window 6 to 11.5, a sphere of 3 on the tail's tip, 16 of 17 sweeps started at the far edge and two hurt.
  const base = AbilitySchema.parse({ ...dragonAnchoredAbilities[0]!, id: "tail_sweep", name: "碎冰扫尾", clip: "sweep", windup: 0.8, length: 1.5, facing: "track", start: { min_distance: 6, max_distance: 11.5, line_of_sight: true, cooldown: 4, weight: 3 }, hits: [{ type: "area", at: 1.2, shape: { type: "sphere", forward: 0, up: 0, left: 0, radius: 3 }, hits: "everyone", damage: 9, knockback: 2.5, effects: [], bone: "tail_3" }] })
  // The fixture's tail hangs behind the feet; the sphere is put 8.5 ahead of the feet and 2.6 to the side from where the bone is (the game's tail at the hit).
  const anchor = hitAnchor(base, 0, dragonDesign)!
  const sweep = AbilitySchema.parse({ ...base, hits: [{ ...base.hits[0]!, shape: { type: "sphere", forward: 8.5 - anchor.forward, up: 0, left: 2.6 - anchor.left, radius: 3 } }] })
  // Centre 8.5 ahead and 2.6 to the side, radius 3: straight ahead the sphere holds 8.5 +- sqrt(3^2 - 2.6^2) = 7 to 10.
  const [near, far] = [7, 10]
  const named = { name: "冰龙", behavior: "hostile", abilities: [sweep] }
  const said = (ability: typeof sweep, flight?: typeof dragonFlight) => abilityIssues({ ...named, ...(flight ? { flight } : {}), abilities: [ability] }, dragonDesign.animations, dragonDesign).filter((found) => found.detail.includes("hits meet straight ahead"))
  const window = (min: number, max: number) => ({ ...sweep, start: { ...sweep.start, min_distance: min, max_distance: max } })
  // Starting at 6 to 11.5 with the sphere meeting only near to far: said, with those numbers, never a stop.
  expect(far).toBeLessThan(11.5 - 1)
  const [one] = said(sweep)
  expect(one).toBeDefined()
  expect(one!.stops).toBe(false)
  expect(one!.rule).toBe("ability_reach")
  expect(one!.text).toContain(`写的是目标在 6–11.5 格时开始`)
  expect(one!.text).toContain(`第 1 次出手打的是以「tail_3」为中心半径 3 格的球，正前方只够得到 ${near}–${far} 格`)
  expect(one!.text).toContain("最远一端（11.5 格）")
  expect(one!.fix).toContain(`${near}–${far}`)
  // Inside the stretch (a block of slack either side): nothing. Outside at either end: said.
  expect(said(window(near, far))).toEqual([])
  expect(said(window(near - 0.9, far + 0.9))).toEqual([])
  expect(said(window(near, far + 1.5))).toHaveLength(1)
  expect(said(window(near - 1.5, far))).toHaveLength(1)
  // A push forward, a dive, or an ability the flier does in the air closes the distance or is held to its own station: not said. A ground ability of a flier is.
  expect(said({ ...window(near, far + 1.5), moves: [{ at: 1, forward: 1, up: 0 }] })).toEqual([])
  expect(said({ ...window(near, far + 1.5), where: "air" }, dragonFlight)).toEqual([])
  expect(said({ ...window(near, far + 1.5), where: "ground" }, dragonFlight)).toHaveLength(1)
  // A hit that cannot reach the middle line at all (a sphere beside the body, narrower than its offset) is said as such.
  const beside = said({ ...sweep, hits: [{ ...sweep.hits[0]!, shape: { type: "sphere", forward: 0, up: 0, left: 8, radius: 3 } }] } as typeof sweep)
  expect(beside).toHaveLength(1)
  expect(beside[0]!.text).toContain("根本打不到站在中线上的目标")
  // The model is not known, or the hit names no bone: nothing to measure, nothing said.
  expect(abilityIssues(named, dragonDesign.animations).filter((found) => found.detail.includes("hits meet"))).toEqual([])
  const feet = { ...sweep, hits: [{ ...sweep.hits[0]!, bone: undefined }] }
  delete (feet.hits[0] as { bone?: string }).bone
  expect(said(feet as typeof sweep)).toEqual([])
})

test("the generated class counts a hit from the bone's place, sized by the creature and carried by the lean of its flight, and clears it after", () => {
  const source = java(compileEntity(giant))
  const anchors = hitAnchors(dragonAnchoredAbilities, dragonDesign)
  const at = anchors[0]![0]!
  expect(source).toContain(`abilityAnchor(${at.forward}, ${at.up}, 0.0);`)
  // Set before the statements of the hit and cleared right after them, in every step that has one.
  const step = (index: number) => new RegExp(`private void abilityStep${index}\\(int tick\\) \\{([\\s\\S]*?)\\n    \\}\\n`).exec(source)![1]!
  for (const index of [0, 1, 2]) {
    const lines = step(index).split("\n").map((line) => line.trim())
    const sets = lines.filter((line) => line.startsWith("abilityAnchor(")).length
    expect(sets).toBeGreaterThan(0)
    expect(lines.filter((line) => line === "abilityAnchorClear();")).toHaveLength(sets)
  }
  // The dive has no bone: nothing is set in its step.
  expect(step(3)).not.toContain("abilityAnchor(")
  // The origin: every check that counts from the feet counts from the shift, and the search for who is near looks as far as the shift is away.
  expect(source).toContain("double scale = getScale();")
  expect(source).toContain("double[] at = flightLeaned(forward * scale, up * scale, left * scale);")
  expect(source).toContain("- abilityShiftF;")
  expect(source).toContain("- abilityShiftL;")
  expect(source).toContain("getY() + abilityShiftU + low")
  // A flier aims from where the hit starts (the shifted point) to where the one it fights stood (broad11 w1 recheck), not straight ahead of its facing.
  expect(source).toContain("Vec3 from = abilityPoint(forward, up, 0.0);")
  expect(source).toContain("double toX = abilityAimX - from.x;")
  expect(source).toContain("getBoundingBox().inflate(range + Math.max(Math.hypot(abilityShiftF, abilityShiftL), Math.abs(abilityShiftU)))")
  expect(source).toContain("forward += abilityShiftF;")
  // The server leans the body as the players see it, so it knows where the head is.
  expect(source).toMatch(/private void tickFlight\(\) \{\n {8}if \(level\(\)\.isClientSide\(\)\) \{\n {12}flightLook\(\);\n {12}return;\n {8}\}\n[^\n]*\n {8}flightLook\(\);/)
  // A creature that does not fly is carried by nothing but its size.
  const walking = java(compileEntity({ ...giant, flight: null }))
  expect(walking).toContain("abilityShiftF = forward * scale;")
  expect(walking).not.toContain("flightLeaned")
})

test("what is shown with a hit that comes from a bone is shown where that hit counts from", () => {
  const debris = { type: "debris" as const, at: 1.2, where: "hit" as const, hit: 0, forward: 3, up: -2, left: 0, radius: 3, count: 8 }
  const withDebris = { ...breath, events: [...breath.events, debris] }
  const made = compileAbilities({ entity: "StudioCreature", model: "dragon", abilities: [withDebris], hostile: true, runtime: false, death: true, anchors: hitAnchors([withDebris], dragonDesign) })
  const at = hitAnchor(breath, 0, dragonDesign)!
  const lines = made.methods.split("\n").map((line) => line.trim())
  const open = lines.findIndex((line) => line.startsWith("abilityDebris("))
  expect(lines[open - 1]).toBe(`abilityAnchor(${at.forward}, ${at.up}, ${at.left.toFixed(1)});`)
  expect(lines[open + 1]).toBe("abilityAnchorClear();")
  // A particle is laid on the creature's own terms as ever.
  const particle = lines.findIndex((line) => line.startsWith("abilityParticles("))
  expect(lines[particle - 1]).not.toContain("abilityAnchor(")
  expect(lines[particle + 1]).not.toBe("abilityAnchorClear();")
  // Asked to count from a bone nobody measured, the build refuses rather than count from the feet.
  expect(() => compileAbilities({ entity: "StudioCreature", model: "dragon", abilities: [breath], hostile: true, runtime: false, death: true })).toThrow("没有量出它在哪里")
})

test("abilities that name no bone generate what they always did", () => {
  // The pins of flight-habits.test.ts hold the creatures that do not fly. This one is a flier with abilities and habits made before bones could be named; it has none of the new code.
  const plain = compileAbilities({ entity: "StudioCreature", model: "dragon", abilities: dragonAbilities, hostile: true, runtime: false, death: true })
  expect(Object.values(plain).join("\n")).not.toMatch(/abilityShift|abilityAnchor/)
  const files = compileEntity({ ...base, model: dragonDesign, hitbox: { core: dragonHitbox.core }, abilities: dragonAbilities, flight: dragonFlight, habits: dragonHabits, boss: dragonBoss })
  expect(java(files)).not.toMatch(/abilityShift|abilityAnchor|flightLeaned|hitboxLeaned/)
  // ... except that a flier with parts follows the lean of its body (below).
  expect(java(compileEntity({ ...base, model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAbilities, flight: dragonFlight }))).toContain("hitboxLeaned")
})

test("the range of a hit from a bone is drawn and measured from the bone, and said so", () => {
  const found = abilityHitShapes(bite, dragonDesign)![0]!
  const at = hitAnchor(bite, 0, dragonDesign)!
  expect(found.anchor).toEqual(at)
  expect(found.bone).toBe("head")
  const shift = abilityPlace(at.forward, at.up, at.left)
  const level = shapeFaces(found.shape)
  expect(found.faces.flat()).toEqual(level.flat().map((point) => [point[0] + shift[0], point[1] + shift[1], point[2] + shift[2]]))
  // The ball of the bite is round the head: the part of the model that is nearest to it is inside it, which counted from the feet it would be 6 blocks away from.
  expect(found.gap).toBe(0)
  const feet = abilityHitShapes({ ...bite, hits: [{ ...bite.hits[0]!, bone: undefined }] } as never, dragonDesign)![0]!
  expect(feet.gap!).toBeGreaterThan(3)
  expect(hitLines(bite, found)[0]).toContain("「head」")
  expect(abilityWords.hit(bite.hits[0]!)).toContain("以「head」为起点")
  expect(abilityWords.hit(breath.hits[1]!)).toContain("从「head」那里")
  // And the AI is told, where the ability's fields are explained.
  expect(ABILITY_INSTRUCTIONS).toContain("bone")
  expect(ABILITY_INSTRUCTIONS).toContain("从那个部件的中心算起")
  expect(ABILITY_INSTRUCTIONS).toContain("不用再把头离身体的距离加进去")
})

test("the reach limit is not lifted: counted from the bone, 16 blocks already reach as far as the bone is from the feet and more", () => {
  const farthest = Math.max(...hitAnchors(dragonAnchoredAbilities, dragonDesign).flat().map((place) => Math.hypot(place?.forward ?? 0, place?.left ?? 0)))
  // The head is 7 blocks ahead of the feet; with the 16 of the shape, a breath reaches 23 from the feet, past the 14 of the cone written in the fixture and the 24 a creature follows by default.
  expect(farthest + 16).toBeGreaterThan(22)
  const longer = AbilitySchema.safeParse({ ...breath, hits: [{ ...breath.hits[0]!, shape: { type: "cone", up: 0, length: 17, angle: 40 } }] })
  expect(longer.success).toBe(false)
})

// ---- the lean, run ----

test.skipIf(!OFFICIAL)("the generated lean puts a place on the body where the renderer's own turns about the middle of the box put it", async () => {
  const source = java(compileEntity(giant))
  const method = /    private double\[\] flightLeaned\(double forward, double up, double left\) \{[\s\S]*?\n    \}\n/.exec(source)![0]
  const work = await mkdtemp(path.join(os.tmpdir(), "minemods-lean-"))
  roots.push(work)
  const cases = [
    [0, 0, 7, 2.6, 0],
    [30, 0, 7, 2.6, 0],
    [-40, 0, 7, 2.6, 0],
    [0, 35, 7, 2.6, 0],
    [25, -20, 7, 2.6, 3],
    [-60, 60, -4, 9, -2],
  ]
  await writeFile(
    path.join(work, "Lean.java"),
    `public class Lean {
    float flightPitch;
    float flightRoll;
    double getBbHeight() { return 5.0; }
${method}
    public static void main(String[] args) {
        Lean lean = new Lean();
${cases.map(([pitch, roll, forward, up, left]) => `        lean.flightPitch = ${pitch}f; lean.flightRoll = ${roll}f; { double[] at = lean.flightLeaned(${forward}, ${up}, ${left}); System.out.println(at[0] + " " + at[1] + " " + at[2]); }`).join("\n")}
    }
}
`,
  )
  const run = await new Promise<string>((resolve, reject) =>
    execFile(targetJdkTool("fabric-1.21.1-official", "javac"), ["-d", work, path.join(work, "Lean.java")], (error, _stdout, stderr) =>
      error ? reject(new Error(stderr)) : execFile(targetJdkTool("fabric-1.21.1-official", "java"), ["-cp", work, "Lean"], (ran, stdout, failed) => (ran ? reject(new Error(failed)) : resolve(stdout))),
    ),
  )
  // The renderer: translate to the middle, turn about x by the pitch, about z by the lean (so a vertex is turned about z first), translate back. Written with matrices, not with the formula.
  const turnX = (a: number) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]]
  const turnZ = (a: number) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]
  const times = (m: number[][], v: number[]) => m.map((row) => row.reduce((sum, value, at) => sum + value * v[at]!, 0))
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  run
    .trim()
    .split("\n")
    .forEach((line, order) => {
      const [pitch, roll, forward, up, left] = cases[order]!
      // Model space: x to the creature's right, y up, z behind it (it faces -z).
      const local = [-left!, up! - 2.5, -forward!]
      const turned = times(turnX(rad(pitch!)), times(turnZ(rad(roll!)), local))
      const expected = [-turned[2]!, turned[1]! + 2.5, -turned[0]!]
      line.split(" ").forEach((value, axis) => near(Number(value), expected[axis]!, 9))
    })
  // Level, nothing moves; nose up lifts what is ahead; a roll to the right raises the right side.
  const first = run.trim().split("\n").map((line) => line.split(" ").map(Number))
  expect(first[0]).toEqual([7, 2.6, 0])
  expect(first[1]![1]!).toBeGreaterThan(2.6)
  expect(first[3]![1]!).not.toBeCloseTo(2.6, 3)
}, 120000)

// ---- A3b: collision boxes that hold a flier in the air, and go where its body goes ----

test("the boxes of a flier are measured in its flying motions as well, and those of a creature that does not fly in the two they always were", () => {
  const ground = hitboxFit(dragonHitbox, dragonDesign)
  const air = hitboxFit(dragonHitbox, dragonDesign, dragonFlight)
  expect(ground.flier).toBe(false)
  expect(air.flier).toBe(true)
  // The wings in a beat reach further out of the boxes than anything standing or walking does.
  expect(["takeoff", "fly", "glide", "land"]).toContain(air.moving!.clip)
  expect(air.moving!.far).toBeGreaterThan(Math.max(ground.rest.far, ground.moving?.far ?? 0) + 1)
  // Said in the lines, with the flying motion named, and what parts do in the air.
  expect(hitboxLines(air).join("\n")).toContain("动起来最差的一刻")
  expect(hitboxLines(air)[0]).toContain("会飞的还跟着机身的俯仰和侧倾转")
  expect(hitboxLines(ground)[0]).not.toContain("俯仰")
  // Nothing about a creature that is not told to fly changes: the same fit as before, field for field.
  const walker = hitboxFit(dragonHitbox, ModelDesignSchema.parse(fightingGolemDesign))
  expect(walker.flier).toBe(false)
  expect(hitboxFit(dragonHitbox, dragonDesign, null)).toEqual(ground)
})

test("a mod whose creatures all walk gets the part class it always had; one with a flier that has parts, the lean", () => {
  const pin = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod" }
  // The hash is of the files the generator wrote at 40304c3, before parts could lean.
  // re-pinned when the generator moved to Mojang's names (Loom's officialMojangMappings): names and the imports they need, nothing else.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileHitboxParts(pin).files)).toBe("513a00c335dc37c4 10167")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileHitboxParts({ ...pin, lean: false }).files)).toBe("513a00c335dc37c4 10167")
  const part = String(compileHitboxParts({ ...pin, lean: true }).files["src/main/java/com/minemods/content_golem_mod/entity/StudioPart.java"])
  expect(part).toContain("default double[] hitboxLeaned(double forward, double up, double left)")
  expect(part).toContain("double[] leaned = creature.hitboxLeaned(ahead, up, side);")
  // The centre of the box is what leans; the box stands on its own floor again.
  expect(part).toContain("double up = (row[1] + row[4] / 2.0f) * scale;")
  expect(part).toContain("owner.getY() + up - row[4] * scale / 2.0,")
  const flier = java(compileEntity(giant))
  expect(flier).toContain("@Override public double[] hitboxLeaned(double forward, double up, double left) { return flightLeaned(forward, up, left); }")
  // A walker with parts has no lean in its class.
  expect(java(compileEntity({ ...giant, flight: null }))).not.toContain("hitboxLeaned")
})

// ---- B1: steering that looks from the wing tips ----

test("how wide a flier is in the air is measured over its flying motions, and only one wider than its box and the half block the game allows is steered by its wing tips", () => {
  const span = flierSpan(dragonDesign, dragonHitbox.core, dragonFlight)!
  // Independent of `modelReach`: the farthest to a side of any corner of any flying pose, with the margin between poses added.
  const played = new Set(["takeoff", "fly", "glide", "land"])
  const reach = Math.max(
    ...dragonDesign.animations
      .filter((clip) => played.has(clip.name))
      .flatMap((clip) => Array.from({ length: 401 }, (_, step) => posedCorners(dragonDesign, clip, (clip.length * step) / 400)).flatMap((corners) => corners.map((corner) => Math.abs(corner[0]!)))),
  )
  expect(span.half).toBeGreaterThanOrEqual(reach / PIXELS - 0.02)
  expect(span.half).toBeLessThan(reach / PIXELS + modelReach(dragonDesign, 2.5).margin + 0.5)
  // The wings are 15 blocks out at the shoulder and the box is 2 each side.
  expect(span.half).toBeGreaterThan(dragonHitbox.core.width / 2 + REACH.slack)
  // One whose model fits its box in the air is steered by its middle alone.
  expect(flierSpan(dragonDesign, { width: 40, height: 5 }, dragonFlight)).toBeNull()
  const golem = ModelDesignSchema.parse(fightingGolemDesign)
  expect(flierSpan({ bones: golem.bones, animations: golem.animations }, { width: 1.125, height: 1.6875 }, { ...dragonFlight, takeoff: { clip: null, seconds: 1 }, land: { clip: null, seconds: 1 }, clips: { fly: "walk", glide: "idle", hover: null } })).toBeNull()
})

test("a wide flier looks for a block from both wing tips, turns to the side whose tip sees more room, and checks the roof over each; a flier that fits is generated as before", () => {
  const source = java(compileEntity(giant))
  const span = flierSpan(dragonDesign, dragonHitbox.core, dragonFlight)!.half
  expect(source).toContain(`private static final double FLIGHT_SPAN = ${span};`)
  expect(source).toContain("if (flightClearWide(centre, way, reach) < reach - 0.05) blocked = look;")
  expect(source).toContain("double left = flightClear(flightTip(centre, 1), flightWay(getYRot() - 55.0f, 0.0f), side);")
  expect(source).toContain("double right = flightClear(flightTip(centre, -1), flightWay(getYRot() + 55.0f, 0.0f), side);")
  expect(source).toContain("boolean roof = flightClearWide(centre, new Vec3(0.0, 1.0, 0.0), half + 4.0) < half + 4.0 - 0.05;")
  expect(source).toContain("return centre.add(Math.cos(turn) * reach, 0.0, Math.sin(turn) * reach);")
  // A flier that fits steers as it did.
  expect(java(compileEntity(sampleFlier as never))).not.toMatch(/FLIGHT_SPAN|flightTip|flightClearWide/)
})

test("the tip of the wing is found to its left with the sign the steering turns by: the left ray from the left tip, the right ray from the right", async () => {
  // Left is (cos yaw, sin yaw) and ahead is (-sin yaw, cos yaw); the ray 55 degrees to the left of ahead (yaw - 55) leans toward the left tip.
  const yaw = (30 * Math.PI) / 180
  const ahead = (angle: number) => [-Math.sin(angle), Math.cos(angle)]
  const left = [Math.cos(yaw), Math.sin(yaw)]
  const leaning = ahead(yaw - (55 * Math.PI) / 180)
  const along = ahead(yaw)
  expect(leaning[0]! * left[0]! + leaning[1]! * left[1]!).toBeGreaterThan(along[0]! * left[0]! + along[1]! * left[1]!)
})

// ---- B2: a place to set down that holds the whole box ----

test("a creature wider than any ordinary walker of the game looks for room for its whole box before it sets down; one no wider is generated as before", () => {
  expect(FLIGHT_LIMITS.footprint).toBe(1.95)
  const source = java(compileEntity(giant))
  expect(source).toContain("private boolean flightFits(double x, double top, double z) {")
  expect(source).toContain("int steps = Math.max(1, (int) Math.ceil(width / FLIGHT_FOOT_COLUMN));")
  expect(source).toContain("level().noCollision(this, new AABB(x - half, top + 0.01, z - half, x + half, top + getBbHeight(), z + half))")
  expect(source).toContain("&& flightFits(x, top, z)) return new Vec3(x, top, z);")
  // With no room anywhere it keeps its height and asks again a second later, and it does not set down without a place.
  expect(source).toContain("if (tickCount < flightLandRetry) return null;")
  expect(source).toContain("flightLandRetry = tickCount + 20;")
  expect(source).toContain("if (spot == null) {")
  expect(source).toContain("&& !flightWater && flightLandSpot != null) {")
  // The widest ordinary creature fits its one column's check and is written as it was.
  const sized = (width: number) => java(compileEntity({ ...sampleFlier, hitbox: HitboxSchema.parse({ core: { width, height: 5 } }) } as never))
  const ravager = sized(FLIGHT_LIMITS.footprint)
  expect(ravager).not.toMatch(/flightFits|flightLandRetry/)
  expect(sized(FLIGHT_LIMITS.footprint + 0.05)).toContain("flightFits")
  expect(ravager).toContain("return new Vec3(around.x, flightGround(around.x, around.z, around.y), around.z);")
})

test("a flier the size of the sample's creatures is generated exactly as it was before wings and footprints were looked at", () => {
  // broad11 w1 recheck changed the hostile flier on purpose: in the air an ability laid out ahead of it waits until it can turn to its target (flightFaces), and its aim keeps where the target stood.
  // epic game1 changed it on purpose again: a flier that eats on the ground eats to the end before a mood takes it up (was f497f48fb88cf694 114490).
  // re-pinned when every creature became the game's ageing animal, so it can be a baby (test/creature-baby.test.ts): the class gained its baby members and its renderer one line for the shadow; nothing else of any creature moved.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity(sampleFlier as never))).toBe("3daee61cbf6b2a8c 116535")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...sample, id: "bee", behavior: "passive", flight: FlightSchema.parse({ ...sampleFlight, style: "hover", altitude: { min: 2, max: 6 }, clips: { fly: "fly", glide: null, hover: "hover" } }) } as never))).toBe("4eb6a8917dcd7068 83405")
})

// ---- the whole giant ----

test.skipIf(!OFFICIAL)("the generated tree of a giant flying boss with a bite and a breath from its head, a sweep from its tail, parts that lean and wing-tip steering compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-giant-bone-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const dragon = EntitySchema.parse({ ...sample.entities[0]!, abilities: dragonAnchoredAbilities, flight: dragonFlight, habits: dragonHabits, boss: dragonBoss, hitbox: dragonHitbox })
  const blueprint = {
    request: "做一只翼展三十格的终极巨龙",
    style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" },
    questions: [],
    revision: 1,
    state: "confirmed" as const,
    entries: [
      { key: "dragon_model", kind: "model", title: "龙模型", brief: "说明", owner: "dragon", needs: [], out_of_scope: null, asset_id: dragon.id },
      { key: "dragon", kind: "entity", title: "龙", brief: "一只会飞的龙", owner: null, needs: ["dragon_model"], out_of_scope: null, asset_id: null, tier: { level: "epic" as const, reason: "你说了终极", by: "ai" as const } },
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
  // The part class of this mod leans, because a creature of it flies and has parts.
  const part = await Bun.file(path.join(source, "src/main/java/com/minemods/content_golem_mod/entity/StudioPart.java")).text().catch(() => "")
  expect(part.length === 0 || part.includes("hitboxLeaned")).toBe(true)
}, 240000)

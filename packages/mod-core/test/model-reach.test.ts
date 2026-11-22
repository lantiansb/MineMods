import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { posedCorners } from "@minemods/studio-ai/model-motion"
import { ModelDesignSchema } from "@minemods/studio-ai/contracts"
import { putModelAsset } from "../src/assets"
import { ABILITY_LIMITS } from "../src/ability-words"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_LIMITS } from "../src/boss-words"
import { ENGAGEMENT_LIMITS, EntitySchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { REACH, modelReach, reachMoments, sightOf } from "../src/model-reach"
import { saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign } from "../script/data-gameplay-sample"
import { dragonAbilities, dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const golem = ModelDesignSchema.parse(fightingGolemDesign)
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const contentFile = "src/main/java/com/minemods/content_golem_mod/StudioContent.java"
const text = (files: Record<string, string | Uint8Array>, file: string) => String(files[file])
const known = (design: typeof dragonDesign) => new Set(design.bones.map((bone) => bone.name))
const PIXELS = 16

/** The extent of a list of posed corners the way `modelReach` states it: blocks from the feet's line, from the feet, and from a point up that line. */
const extentOf = (corners: readonly (readonly number[])[], centre: number) => ({
  flat: Math.max(0, ...corners.map(([x, , z]) => Math.hypot(x!, z!))) / PIXELS,
  low: Math.min(...corners.map(([, y]) => y!)) / PIXELS,
  high: Math.max(...corners.map(([, y]) => y!)) / PIXELS,
  round: Math.max(0, ...corners.map(([x, y, z]) => Math.hypot(x!, y! - centre * PIXELS, z!))) / PIXELS,
})

// ---- the arithmetic ----

test("the pose the model is built in is read exactly as the viewport's own arithmetic reads it", () => {
  for (const design of [golem, dragonDesign]) {
    const solid = { ...design, animations: [] }
    const own = extentOf(posedCorners(design, null), 2.5)
    const mine = modelReach(solid, 2.5).built
    expect(mine.flat).toBeCloseTo(own.flat, 9)
    expect(mine.low).toBeCloseTo(own.low, 9)
    expect(mine.high).toBeCloseTo(own.high, 9)
    expect(mine.round).toBeCloseTo(own.round, 9)
  }
})

test("every pose of every motion is taken: the reach is the farthest of the poses by the viewport's own arithmetic, and no denser sampling goes beyond it", () => {
  for (const design of [golem, dragonDesign]) {
    const reach = modelReach(design, 2.5)
    const taken = design.animations.flatMap((clip) => reachMoments(clip, known(design as typeof dragonDesign)).map((time) => extentOf(posedCorners(design, clip, time), 2.5)))
    // The poses taken, with the built one: the numbers before the margin for the arcs between them.
    const flat = Math.max(reach.built.flat, ...taken.map((one) => one.flat))
    expect(reach.flat - reach.margin).toBeCloseTo(flat, 6)
    expect(reach.high - reach.margin).toBeCloseTo(Math.max(reach.built.high, ...taken.map((one) => one.high)), 6)
    expect(reach.low + reach.margin).toBeCloseTo(Math.min(reach.built.low, ...taken.map((one) => one.low)), 6)
    // A hundred times as many poses as the motions have keys: nothing between the ones taken is farther than the margin allows.
    design.animations.forEach((clip) =>
      Array.from({ length: 201 }, (_, at) => (clip.length * at) / 200).forEach((time) => {
        const dense = extentOf(posedCorners(design, clip, time), 2.5)
        expect(dense.flat).toBeLessThanOrEqual(reach.flat + 1e-9)
        expect(dense.round).toBeLessThanOrEqual(reach.round + 1e-9)
        expect(dense.high).toBeLessThanOrEqual(reach.high + 1e-9)
        expect(dense.low).toBeGreaterThanOrEqual(reach.low - 1e-9)
      }),
    )
  }
})

test("no bone turns more than the step between two poses, a smooth stretch is seen eight times, and a long motion is thinned to the most poses", () => {
  const turned = (key: number) => ({ name: "m", length: 4, loop: false, channels: [{ bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }, { time: 4, rotation: [key, 0, 0] as [number, number, number] }] }] })
  const steps = (key: number) => reachMoments(turned(key), known(dragonDesign)).length - 1
  expect(steps(10)).toBe(1)
  expect(steps(REACH.turn * 4)).toBe(4)
  expect(steps(REACH.turn * 4 + 1)).toBe(5)
  const smooth = { ...turned(5), channels: [{ bone: "head", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number], interpolation: "smooth" as const }, { time: 4, rotation: [5, 0, 0] as [number, number, number], interpolation: "smooth" as const }] }] }
  expect(reachMoments(smooth, known(dragonDesign)).length - 1).toBe(REACH.curve)
  const long = { name: "m", length: 30, loop: true, channels: [{ bone: "head", keyframes: Array.from({ length: 60 }, (_, at) => ({ time: at * 0.5, rotation: [at % 2 ? 120 : 0, 0, 0] as [number, number, number] })) }] }
  expect(reachMoments(long, known(dragonDesign)).length).toBe(REACH.poses)
})

test("whatever the bones and the motions, no pose between the ones taken goes beyond the reach (random models, with curves, moves and scales)", () => {
  // A small deterministic generator: the same models on every run.
  let state = 12345
  const random = () => ((state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const between = (low: number, high: number) => low + (high - low) * random()
  const face = { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" }
  const modes = [null, "linear", "smooth"] as const
  const keys = (length: number, make: () => number[]) => ((count) => Array.from({ length: count }, (_, at) => ({ time: (length * at) / (count - 1), value: make(), interpolation: modes[Math.floor(random() * 3)]! })))(2 + Math.floor(random() * 4))
  for (let round = 0; round < 12; round++) {
    const count = 3 + Math.floor(random() * 6)
    const bones = Array.from({ length: count }, (_, at) => ({
      name: `b${at}`,
      parent: at === 0 ? null : `b${Math.floor(random() * at)}`,
      pivot: [between(-40, 40), between(0, 80), between(-40, 40)] as [number, number, number],
      rotation: [between(-30, 30), between(-30, 30), between(-30, 30)] as [number, number, number],
      cubes: [{ name: `c${at}`, origin: [between(-60, 20), between(0, 60), between(-60, 20)] as [number, number, number], size: [Math.ceil(between(1, 40)), Math.ceil(between(1, 40)), Math.ceil(between(1, 40))] as [number, number, number], faces: face }],
    }))
    const clips = ["idle", "walk", "hurt", "extra"].map((name) => {
      const length = between(0.5, 4)
      return {
        name,
        length,
        loop: random() < 0.5,
        channels: bones.filter(() => random() < 0.7).map((bone) => ({
          bone: bone.name,
          keyframes: keys(length, () => [between(-180, 180), between(-180, 180), between(-180, 180)]).map(({ time, value, interpolation }) => ({ time, rotation: value as [number, number, number], interpolation })),
          position: random() < 0.4 ? keys(length, () => [between(-20, 20), between(-20, 20), between(-20, 20)]).map(({ time, value, interpolation }) => ({ time, position: value as [number, number, number], interpolation })) : null,
          scale: random() < 0.3 ? keys(length, () => [between(0.5, 2), between(0.5, 2), between(0.5, 2)]).map(({ time, value, interpolation }) => ({ time, scale: value as [number, number, number], interpolation })) : null,
        })),
      }
    }).filter((clip) => clip.channels.length)
    const design = ModelDesignSchema.parse({ name: "r", texture_size: 256, bones, animations: ["idle", "walk", "hurt"].map((name) => clips.find((clip) => clip.name === name) ?? { name, length: 1, loop: true, channels: [{ bone: "b0", keyframes: [{ time: 0, rotation: [0, 0, 0] }] }] }) })
    const reach = modelReach(design, 1)
    design.animations.forEach((clip) =>
      Array.from({ length: 121 }, (_, at) => (clip.length * at) / 120).forEach((time) => {
        const dense = extentOf(posedCorners(design, clip, time), 1)
        expect(dense.flat).toBeLessThanOrEqual(reach.flat + 1e-9)
        expect(dense.round).toBeLessThanOrEqual(reach.round + 1e-9)
        expect(dense.high).toBeLessThanOrEqual(reach.high + 1e-9)
        expect(dense.low).toBeGreaterThanOrEqual(reach.low - 1e-9)
      }),
    )
  }
})

test("the margin for arcs is what a bone swinging a whole half turn between two keys really goes beyond them", () => {
  // One bone with a cube 10 blocks from its pivot, turned 0 to 90 degrees in one key: the poses are 15 degrees apart, the arc between two bulges by r(1 - cos(7.5)).
  const arm = ModelDesignSchema.parse({
    name: "arm",
    texture_size: 64,
    bones: [{ name: "body", parent: null, pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "stub", origin: [-1, 0, -1], size: [2, 2, 2], faces: { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" } }] }, { name: "arm", parent: "body", pivot: [0, 0, 0], rotation: [0, 0, 0], cubes: [{ name: "long", origin: [-1, 0, 159], size: [2, 2, 1], faces: { north: "#888888", east: "#888888", south: "#888888", west: "#888888", up: "#888888", down: "#888888" } }] }],
    animations: ["idle", "walk", "hurt"].map((name) => ({ name, length: 1, loop: false, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }, { time: 1, rotation: [0, 0, 0] as [number, number, number] }] }] })).concat([{ name: "swing", length: 1, loop: false, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 0, 0] as [number, number, number] }, { time: 1, rotation: [0, 90, 0] as [number, number, number] }] }] }]),
  })
  const reach = modelReach(arm, 0)
  const swing = arm.animations.find((clip) => clip.name === "swing")!
  // The worst place between two poses is half way between: every 15 degrees from 0, so 7.5 degrees in.
  const between = extentOf(posedCorners(arm, { ...swing, channels: [{ bone: "arm", keyframes: [{ time: 0, rotation: [0, 7.5, 0] }, { time: 1, rotation: [0, 7.5, 0] }] }] }, 0), 0)
  expect(between.flat).toBeLessThanOrEqual(reach.flat + 1e-9)
  // Without the margin it would be short by the bulge of the arc.
  const chord = reachMoments(swing, known(arm as unknown as typeof dragonDesign)).map((time) => extentOf(posedCorners(arm, swing, time), 0).flat)
  expect(Math.max(...chord)).toBeLessThanOrEqual(reach.flat - reach.margin + 1e-9)
  expect(reach.margin).toBeGreaterThan(0)
})

// ---- what a creature that fits is told, and what a giant is ----

test("a creature whose model fits its box is told nothing: no visibility box, no tracking range", () => {
  const fits = sightOf(golem, { width: 1.1, height: 3 }, false, 0)
  expect(fits.sight).toBeNull()
  expect(fits.chunks).toBeNull()
  const files = compileEntity({ ...base, model: fightingGolemDesign as never })
  expect(text(files, entityFile)).not.toContain("getBoundingBoxForCulling")
  expect(text(files, entityFile)).not.toContain("SIGHT_")
  expect(text(files, contentFile)).not.toContain("clientTrackingRange")
})

test("a model that reaches beyond its box is told to the game as the box it fills, over the poses of its motions", () => {
  const giant = { ...base, id: "dragon", model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAbilities, flight: dragonFlight }
  const files = compileEntity(giant)
  const java = text(files, entityFile)
  const field = (name: string) => Number(new RegExp(`${name} = (-?[\\d.]+);`).exec(java)![1])
  expect(java).toContain("@Override public net.minecraft.world.phys.AABB getBoundingBoxForCulling()")
  // The scale a creature is drawn at is applied, as the renderer applies it.
  expect(java).toContain("double scale = getScale();")
  // The farthest a wing goes, in the pose of the wing up, from the middle the renderer leans a flier about, is inside the box said.
  const clip = dragonDesign.animations.find((animation) => animation.name === "takeoff")!
  const up = extentOf(posedCorners(dragonDesign, clip, clip.length / 2), 2.5)
  expect(field("SIGHT_REACH")).toBeGreaterThanOrEqual(up.flat)
  expect(field("SIGHT_HIGH")).toBeGreaterThanOrEqual(up.high)
  expect(field("SIGHT_LOW")).toBeLessThanOrEqual(up.low)
  // The box is the game's own: more than the 16-block collision box, because the wings span thirty blocks.
  expect(field("SIGHT_REACH")).toBeGreaterThan(dragonHitbox.core.width / 2 + REACH.slack)
  // Said once, in whole hundredths, and only the model's own numbers.
  expect(java.match(/getBoundingBoxForCulling/g)).toHaveLength(1)
  expect(text(files, contentFile)).toContain(".clientTrackingRange(16)")
})

test("a creature that does not fly is judged by the pose it is built in, and a flier by every pose", () => {
  // The same dragon on the ground, with a core as wide as it is built: the built pose fits, so nothing is said though a wing swings out in a motion.
  const built = modelReach(dragonDesign, 0).built
  const box = { width: Math.ceil(built.flat * 2) + 1, height: Math.ceil(built.high) + 1 }
  expect(sightOf(dragonDesign, box, false, 0).sight).toBeNull()
  // As a flier it leans about its middle, so the same box is not enough.
  expect(sightOf(dragonDesign, box, true, 0).sight).not.toBeNull()
  // One built outside its box says the farthest it ever goes, on every side.
  const narrow = sightOf(dragonDesign, { width: 1, height: 1 }, false, 0)
  expect(narrow.sight!.reach).toBeGreaterThanOrEqual(modelReach(dragonDesign, 0.5).flat)
})

test("a tracking range is said only above the game's own, from the model, the range it keeps to, and how far the game draws a box of that size, held to the largest the game itself uses", () => {
  const near = sightOf(golem, { width: 1.1, height: 3 }, false, 0)
  expect(near.chunks).toBeNull()
  // The range it roams: the farthest it can be from where it began and still be seen whole.
  const roams = sightOf(golem, { width: 1.1, height: 3 }, false, 100)
  expect(roams.chunks).toBe(Math.ceil((100 + roams.reach.flat) / REACH.chunk))
  expect(roams.chunks!).toBeGreaterThan(REACH.tracking.least)
  // A range below the game's default is never written (it would shorten it).
  expect(sightOf(golem, { width: 1.1, height: 3 }, false, 40).chunks).toBeNull()
  // A big model on a small box is not sent further than the game would draw that box (64 times its average side, `Entity.shouldRender(double)`): 64 blocks
  // for a 1-block box is four chunks, under the game's five; a 4 by 5 box is drawn to 277 blocks, so the range is the largest that is kept.
  const small = sightOf(dragonDesign, { width: 1, height: 1 }, false, 0)
  expect(small.sight).not.toBeNull()
  expect(small.chunks).toBeNull()
  expect(sightOf(dragonDesign, { width: 4, height: 5 }, true, 0).chunks).toBe(REACH.tracking.most)
  expect(sightOf(dragonDesign, { width: 2, height: 2 }, false, 0).chunks).toBe(Math.ceil(((2 * 2 + 2) / 3) * REACH.draw / REACH.chunk))
  // Never above the farthest range of any entity of the game but the player (read from `EntityType`'s static initialiser).
  expect(sightOf(dragonDesign, { width: 4, height: 5 }, true, 96).chunks).toBe(REACH.tracking.most)
  expect(REACH.tracking.most).toBe(16)
  expect(REACH.tracking.least).toBe(5)
})

test("how far a creature picks and keeps a target is its follow range, and that is the farthest of its abilities when they reach beyond the usual", () => {
  const follow = (java: string) => /Attributes\.FOLLOW_RANGE, ([\d.]+)\)/.exec(java)![1]
  const usual = text(compileEntity({ ...base, model: dragonDesign, engagement: "any_player" as const, abilities: dragonAbilities.map((ability) => ({ ...ability, start: { ...ability.start, max_distance: 10 } })) }), entityFile)
  expect(follow(usual)).toBe("24.0")
  expect(usual).toContain("ENGAGE_DISTANCE = 24.0;")
  const far = text(compileEntity({ ...base, model: dragonDesign, engagement: "any_player" as const, abilities: dragonAbilities }), entityFile)
  expect(follow(far)).toBe("32.0")
  expect(far).toContain("ENGAGE_DISTANCE = 32.0;")
  // A creature that follows a player by itself picks the same distance as it keeps.
  const own = text(compileEntity({ ...base, model: dragonDesign, abilities: dragonAbilities, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } }), entityFile)
  expect(own).toContain("RUNTIME_TARGET_DISTANCE = 32.0;")
  // A boss does not let go of a player an ability can still hit: its battle range is no shorter than the farthest ability, which is no shorter than the usual.
  expect(BOSS_LIMITS.battle).toBeGreaterThanOrEqual(ABILITY_LIMITS.distance)
  expect(ABILITY_LIMITS.distance).toBeGreaterThanOrEqual(ENGAGEMENT_LIMITS.distance)
})

// ---- a flier that is killed in the air ----

test("a flier killed in the air is kept until it is down; a creature that walks, and a boss that walks, are removed as they were", () => {
  const flier = { ...base, id: "dragon", model: dragonDesign, hitbox: dragonHitbox, abilities: dragonAbilities }
  const flying = text(compileEntity({ ...flier, flight: dragonFlight }), entityFile)
  expect(flying).toContain("if (++deathTime >= DEATH_DURATION && flightFallen(DEATH_DURATION) && !level().isClientSide() && !isRemoved()) {")
  expect(flying).toContain("private boolean flightFallen(int due) { return onGround() || isInWater() || deathTime >= due + FLIGHT_FALL_TICKS; }")
  // The motion of the death is the creature's own, played while it falls: it flaps nothing and the flight state is the ground's (gravity is on).
  expect(flying).toMatch(/if \(isDeadOrDying\(\)|isDeadOrDying\(\)/)
  const bossed = text(compileEntity({ ...flier, flight: dragonFlight, boss: dragonBoss }), entityFile)
  expect(bossed).toContain("if (deathTime < BOSS_DEATH_TICKS || !flightFallen(BOSS_DEATH_TICKS)) return;")
  // The experience bursts and the rest of the sequence run on their own times, before this line.
  expect(bossed.indexOf("BOSS_BURSTS")).toBeLessThan(bossed.indexOf("!flightFallen(BOSS_DEATH_TICKS)"))
  const walking = text(compileEntity(flier), entityFile)
  expect(walking).not.toContain("flightFallen")
  const walkingBoss = text(compileEntity({ ...flier, boss: dragonBoss }), entityFile)
  expect(walkingBoss).toContain("if (deathTime < BOSS_DEATH_TICKS) return;")
  expect(walkingBoss).not.toContain("flightFallen")
  // The fall is the game's: a body falls 3.92 blocks a tick at the most, so the world's height (384) is fallen in under a hundred ticks.
  expect(Math.ceil(384 / 3.92)).toBe(98)
})

// ---- the whole giant, compiled ----

async function giantProject(options: { hitbox?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-giant-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const dragon = EntitySchema.parse({
    ...sample.entities[0]!,
    abilities: dragonAbilities,
    flight: dragonFlight,
    habits: dragonHabits,
    boss: dragonBoss,
    hitbox: options.hitbox === false ? null : dragonHitbox,
  })
  // The blueprint the person confirmed: this creature is the epic tier, so its 必须 are reconciled.
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
  const made = await putModelAsset(directory, { entity_id: dragon.id, data: { design: dragonDesign }, origin: "example", expectedRevision: saved.revision })
  const source = path.join(root, "source")
  await mkdir(source)
  return { directory, source, project: made.project, build: () => assembleBuildSource(directory, source, TEMPLATE) }
}

test("an epic creature without its hitbox of parts does not build, and is told what to write; with it, it does", async () => {
  const bare = await giantProject({ hitbox: false })
  const refusal = await bare.build().then(() => "built", (error: Error) => error.message)
  expect(refusal).toContain("没有分部位的碰撞箱")
  expect(refusal).toContain("碰撞箱必须补上才能打包")
  const whole = await giantProject()
  const built = await whole.build()
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
})

test.skipIf(!hasTargetJavac(OFFICIAL))("the generated tree of a giant flying boss whose abilities reach beyond 24 blocks compiles, with the visibility box, the tracking range and the fall in it", async () => {
  const made = await giantProject()
  await made.build()
  const compiled = (await compileTreeFor(OFFICIAL, made.source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

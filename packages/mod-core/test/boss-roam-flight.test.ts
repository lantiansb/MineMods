import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { TICKS } from "../src/ability-words"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_LIMITS } from "../src/boss-words"
import { BOSS_INSTRUCTIONS, BOSS_SUMMARY, bossOwn, bossWords } from "../src/creature-boss"
import { readGeneratedCreature } from "../src/creature-contract"
import { FLIGHT_INSTRUCTIONS, HABITS_INSTRUCTIONS, flightFight, flightLands, flightPlan, flightWords } from "../src/creature-flight"
import { creatureWords } from "../src/creature-life"
import { EntitySchema, EntityRuntimeSchema, BossSchema, HabitsSchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { FLIGHT_LIMITS } from "../src/flight-words"
import { saveProject } from "../src/project"
import { createDataGameplaySample } from "../script/data-gameplay-sample"
import { dragonAbilities, dragonBoss, dragonDesign, dragonFlight, dragonHabits, dragonHitbox, epicAbilities, epicBoss, epicHabits } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * An epic flier as one case needs it, in general terms (nothing here is about a dragon but its numbers): a boss whose habits keep it living until it meets someone,
 * whose enrage speeds its flight, whose flight lands for a ground-only ability and whose wake-up is a show in the air; and a natural spawn that asks for height.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "dragon", name: "巨龙", health: 400, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: dragonDesign }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const gen = (input: Record<string, unknown>) => String(compileEntity({ ...base, ...input } as never)[entityFile])
const epic = { abilities: epicAbilities, flight: dragonFlight, habits: epicHabits, boss: epicBoss }
const flat = BossSchema.parse({ ...epicBoss, phases: [{ ...epicBoss.phases[0]!, speed: 1 }] })
const always = HabitsSchema.parse({ active: "always", rest: null, home: null, prey: [], hunger_seconds: 300, eat: null, alert: null })
const facts = (java: string) => readGeneratedCreature(java, null)
const sha = (java: string) => `${createHash("sha256").update(java).digest("hex").slice(0, 16)} ${java.length}`
const near = (value: number, expected: number, digits = 3) => expect(Math.abs(value - expected)).toBeLessThan(10 ** -digits)

// ---- 1: a boss with habits lives them until it meets someone ----

test("a boss with habits that say active keeps its habits until somebody comes: it is not held, picks nobody, and the wake-up meets it", () => {
  const night = gen(epic)
  // Not asleep while its habits say active; asleep (held) while they say rest.
  expect(night).toContain("private boolean bossLives() { return bossState() == BOSS_DORMANT && !(")
  expect(night).toContain("habitShowing() == HABIT_REST")
  expect(night).toContain("bossState() != BOSS_FIGHT && !bossLives()")
  // Not having met anybody means nobody is its target, whoever sets one (a revenge, gameplay code), and it picks none: the wake-up is the only way in.
  expect(night).toContain("public boolean canAttack(LivingEntity target) { return bossState() != BOSS_DORMANT && super.canAttack(target); }")
  expect(facts(night).boss).toMatchObject({ immobile: true, lives: true })
  // Always active: it lives them the whole time before the wake-up.
  expect(gen({ ...epic, habits: always })).toContain("private boolean bossLives() { return bossState() == BOSS_DORMANT && true; }")
  // No habits, or no wake-up: as it was, byte for byte the old lines.
  for (const plain of [gen({ ...epic, habits: null }), gen({ ...epic, boss: BossSchema.parse({ ...epicBoss, intro: null }) })]) {
    expect(plain).not.toContain("bossLives")
    expect(plain).not.toContain("canAttack(LivingEntity target)")
  }
  expect(gen({ ...epic, habits: null })).toContain("protected boolean isImmobile() { return super.isImmobile() || bossState() != BOSS_FIGHT; }")
  expect(facts(gen({ ...epic, habits: null })).boss).toMatchObject({ immobile: true, lives: false })
})

test("the one who is near is found by the nearest-player lookup only once the boss has met somebody, and the leash sends it back to not having met anyone", () => {
  const java = gen({ ...epic, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } })
  expect(java).toContain("bossMet() && ")
  expect(gen({ ...epic, habits: null, runtime: { spawn: null, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null } })).not.toContain("bossMet()")
})

// ---- 2: enrage speeds the flight ----

test("a phase that is faster speeds the flight of a boss that flies, and one that is not faster, or a flier that is not a boss, is written as it always was", () => {
  const fast = gen(epic)
  expect(fast).toContain("private double flightPace() { return bossSpeedScale(); }")
  expect(fast).toContain("flightDiveSpeed(distance, FLIGHT_FIRST[abilityIndex] - abilityTick - 1, flightDiveLeast(), FLIGHT_DIVE_MOST, flightStall());")
  // The dive never goes past the most a velocity may be sent as.
  expect(fast).toContain("Math.min(FLIGHT_DIVE_LEAST * flightPace(), FLIGHT_DIVE_MOST)")
  expect(facts(fast).flight).toMatchObject({ paced: true, charges: true })
  for (const plain of [gen({ ...epic, boss: flat }), gen({ ...epic, boss: null }), gen({ ...epic, boss: null, habits: null })]) {
    expect(plain).not.toContain("flightPace")
    expect(plain).not.toContain("bossSpeedScale")
    expect(facts(plain).flight).not.toHaveProperty("paced")
  }
  // A boss that does not fly keeps its scale for the walk only.
  expect(gen({ ...epic, flight: null, abilities: dragonAbilities.map((ability) => ({ ...ability, where: "any" as const, dive: false })) })).not.toContain("flightPace")
})

test("the fastest a phase can make the cruise is still within what a velocity may be sent as, so the cap never has to cut a cruise", () => {
  // The derivation of the cap: the fastest cruise a document may ask for times the strongest enrage.
  expect((FLIGHT_LIMITS.speed.max / TICKS) * BOSS_LIMITS.speed.max).toBeLessThanOrEqual(FLIGHT_LIMITS.diveMost)
})

// ---- 3: a flier comes down for a ground ability ----

test("a flier with abilities in the air and abilities only on the ground lands for those when no air ability is ready, and one without a ground ability never does", () => {
  const java = gen(epic)
  expect(java).toContain("private int flightGroundWanted(LivingEntity target)")
  expect(java).toContain("private boolean flightStaysDown()")
  expect(java).toContain("return !flightStaysDown();")
  expect(facts(java).flight).toMatchObject({ lands: true })
  // The window it lands for is the one of the ability itself, and the way down is the footprint check's, as any landing of it.
  expect(java).toContain("flightPickLanding(at, spread)")
  expect(flightLands(epicAbilities).map((ability) => ability.id)).toEqual(["sweep"])
  expect(flightLands(epicAbilities.filter((ability) => ability.where !== "ground"))).toEqual([])
  // Ground only ability list: it fights on the ground all the way, nothing to come down for. Air only: nothing to come down for.
  expect(flightLands(epicAbilities.filter((ability) => ability.where === "ground"))).toEqual([])
  const air = epicAbilities.filter((ability) => ability.where !== "ground")
  expect(gen({ ...epic, abilities: air })).not.toContain("flightGroundWanted")
  expect(gen({ ...epic, abilities: epicAbilities.filter((ability) => ability.where === "ground") })).not.toContain("flightGroundWanted")
  expect(gen({ ...epic, boss: null, habits: null, abilities: air })).not.toContain("flightGroundWanted")
  expect(flightPlan(dragonFlight, epicAbilities, true).lands).toBe(true)
  expect(flightPlan(dragonFlight, air, true).lands).toBe(false)
  expect(flightPlan(dragonFlight, epicAbilities, false).lands).toBe(false)
})

// epic game5: the tail sweep starts 6 to 11.5 blocks out; the dragon landed 4.6 to 5.7 blocks from the player (a pick up to 4 blocks off the middle of the window, 8.75, can lie at 4.75) and never used it.
const windowed = (min: number, max: number) => epicAbilities.map((ability) => (ability.id === "sweep" ? { ...ability, start: { ...ability.start, min_distance: min, max_distance: max } } : ability))

test("the place a flier lands at for a ground ability is searched for inside that ability's window, never the 4 blocks around its middle", () => {
  const java = gen({ ...epic, abilities: windowed(6, 11.5) })
  expect(java).toContain("double spread = Math.min(4.0, Math.min(stand - Math.max(FLIGHT_NEAR[index], clearance), FLIGHT_FAR[index] - stand) / Math.sqrt(2.0));")
  expect(java).toContain("flightLandSpot = flightPickLanding(at, spread);")
  // On the ground, nearer than the window of a ready ability, it steps back without a path (a body 7.5 blocks wide gets none from the vanilla pathfinder): walked backwards, facing the target (epic game5).
  expect(java).toContain("abilityFace(target);\n            // Backwards, not along a path: the vanilla pathfinder finds none for a body this wide (a body several blocks wide gets none and would stand still).\n            getNavigation().stop();\n            getMoveControl().strafe(-1.0f, 0.0f);")
  expect(java).not.toContain("moveTo(target.getX()")
  // The window 6 to 11.5 (stand 8.75): the search square's corner is 2.75 from the middle, so its half side is 2.75 / sqrt(2) = 1.94 and no place in it is nearer than 6 or further than 11.5.
  const spread = Math.min(4, Math.min(8.75 - 6, 11.5 - 8.75) / Math.sqrt(2))
  near(spread, 1.944, 3)
  expect(8.75 - spread * Math.sqrt(2)).toBeGreaterThanOrEqual(6 - 1e-9)
  expect(8.75 + spread * Math.sqrt(2)).toBeLessThanOrEqual(11.5 + 1e-9)
  // The other landings (home, a request) are not for a window and keep their own spread; a flier that never lands for a ground ability writes none of this.
  expect(java).toContain("flightLandSpot = flightPickLanding(at, 4.0);")
  const air = gen({ ...epic, abilities: epicAbilities.filter((ability) => ability.where !== "ground") })
  expect(air).not.toContain("double spread = Math.min")
  expect(air).not.toContain("flightGroundDescend")
  // Without a ground-only ability the Java is what it was before the window bound (the hash is of the Java before it; none of these abilities starts nearer than 2 blocks out of a dive).
  const open = epicAbilities.map((ability) => ({ ...ability, where: ability.where === "ground" ? ("any" as const) : ability.where, start: { ...ability.start, min_distance: 0 } }))
  // re-pinned when every creature became the game's ageing animal, so it can be a baby (test/creature-baby.test.ts): the class gained its baby members and its renderer one line for the shadow; nothing else of any creature moved.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(gen({ ...epic, abilities: open }))).toBe("7665d772644f6f27 95390")
})

test("what the guide and the creature's description say of a flier that lands for a ground ability names that ability: 落地用「…」", () => {
  const kind = flightFight(epicAbilities, "hostile")
  expect(kind).toBe("circle")
  const names = flightLands(epicAbilities).map((ability) => ability.name)
  expect(flightWords.fights(kind, names)).toContain(`落地用「${names[0]}」`)
  expect(flightWords.fights(kind, [])).toBe("会飞，追人时在你上空盘旋")
  expect(flightWords.fights("ground", names)).not.toContain("落地用")
  expect(FLIGHT_INSTRUCTIONS).toContain("where: ground")
  expect(FLIGHT_INSTRUCTIONS).toContain("落到目标身边")
})

// ---- 4: a flying boss shows itself in the air ----

test("a boss that flies wakes in the air: it takes off, circles above whoever woke it, and plays the intro clip there; one that does not fly stands still as before", () => {
  const java = gen(epic)
  expect(java).toContain("private boolean bossDisplay() { return bossState() == BOSS_INTRO; }")
  expect(java).toContain("private void flightShow(Vec3 around)")
  expect(java).toContain("if (bossDisplay()) return true;")
  expect(facts(java).boss).toMatchObject({ display: true })
  // The clip and the sound wait for the air, so that a ground-bound intro clip does not play under its feet.
  expect(java).toContain("flightState() == FLIGHT_AIR")
  for (const still of [gen({ ...epic, flight: null, abilities: dragonAbilities.map((ability) => ({ ...ability, where: "any" as const, dive: false })) }), gen({ ...epic, boss: BossSchema.parse({ ...epicBoss, intro: null }) })]) {
    expect(still).not.toContain("bossDisplay")
    expect(still).not.toContain("flightShow")
  }
})

test("the words for a boss say what it is: living its habits until met, an air show for a flier, flight as fast as the phase", () => {
  const own = bossOwn({ habits: epicHabits, flight: dragonFlight })
  expect(own).toEqual({ habits: true, flies: true })
  const told = bossWords.summary(epicBoss, epicAbilities, "；", own)
  expect(told).toContain("还没见过谁")
  expect(told).toContain("头顶")
  expect(told).toContain("飞得也这么快")
  expect(told).toContain("回到没见过谁的样子")
  // Without them the sentences are the old ones.
  const plain = bossWords.summary(epicBoss, epicAbilities)
  expect(plain).toContain("一开始睡着，玩家走近 32 格才醒")
  expect(plain).not.toContain("还没见过谁")
  expect(bossWords.intro(epicBoss, bossOwn({}))).toBe(bossWords.intro(epicBoss))
  for (const text of [BOSS_INSTRUCTIONS, FLIGHT_INSTRUCTIONS, HABITS_INSTRUCTIONS, BOSS_SUMMARY]) expect(text).toMatch(/盘旋|还没见过谁/)
  expect(BOSS_INSTRUCTIONS).toContain("还没见过谁")
  expect(BOSS_INSTRUCTIONS).toContain("speed")
  expect(HABITS_INSTRUCTIONS).toContain("还没见过谁")
})

// ---- 5: a natural spawn that asks for height ----

test("a natural spawn can ask for ground a number of blocks above the sea, through the predicate the game asks, and says so; without it nothing changes", () => {
  const spawn = { biomes: [], tags: ["is_mountain"], light: "any", weight: 5, min: 1, max: 1 }
  const runtime = (extra: Record<string, unknown>) => ({ spawn: { ...spawn, ...extra }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null })
  const content = (extra: Record<string, unknown>) => {
    const files = compileEntity({ ...base, ...epic, runtime: runtime(extra) } as never)
    return Object.entries(files).filter(([name]) => name.endsWith("Content.java") || name.includes("StudioContent")).map(([, text]) => String(text)).join("\n")
  }
  expect(content({ above_sea: 60 })).toContain("pos.getY() >= world.getSeaLevel() + 60 && Mob.checkMobSpawnRules(type, world, reason, pos, random)")
  expect(content({})).not.toContain("getSeaLevel")
  // The most that can be asked is what the overworld has above its sea (320 - 63 = 257, so 256 is the last whole step that is below it).
  const schema = EntityRuntimeSchema.shape.spawn.unwrap()
  expect(schema.safeParse({ ...spawn, above_sea: 256 }).success).toBe(true)
  expect(schema.safeParse({ ...spawn, above_sea: 257 }).success).toBe(false)
  expect(schema.safeParse({ ...spawn, above_sea: 0 }).success).toBe(false)
  expect(schema.safeParse({ ...spawn, above_sea: 60.5 }).success).toBe(false)
  expect(creatureWords.spawn(schema.parse({ ...spawn, above_sea: 60 }), "hostile")).toContain("比海平面高 60 格以上")
  expect(creatureWords.spawn(schema.parse(spawn), "hostile")).not.toContain("海平面")
})

// ---- all of it, compiled ----

test.skipIf(!hasTargetJavac(OFFICIAL))("the generated tree of a flying boss with habits, an enrage, a ground tail sweep and an air breath, nesting on the heights, compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-epic-roam-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const spawn = { biomes: [], tags: ["is_mountain"], light: "any", above_sea: 60, weight: 3, min: 1, max: 1 }
  // The epic tier asks for a felt fight and parts that follow the body: the ground sweep shakes the screen, and the boxes are the dragon's.
  const felt = epicAbilities.map((ability) => (ability.id === "sweep" ? { ...ability, start: { ...ability.start, min_distance: 6, max_distance: 11.5 }, events: [...ability.events, { type: "shake" as const, at: 0.9, strength: 2, radius: 16, seconds: 1 }] } : ability))
  const dragon = EntitySchema.parse({ ...sample.entities[0]!, ...epic, abilities: felt, hitbox: dragonHitbox, runtime: { ...sample.entities[0]!.runtime, spawn } })
  const blueprint = {
    request: "做一只守着山顶的巨龙",
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
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 240000)

// Kept so the unused imports of the fixture stay honest: the plain dragon's own boss and habits are still the ones the pinned tests use.
test("the older dragon fixtures are unchanged in what they ask of the generator", () => {
  expect(dragonBoss.intro).not.toBeNull()
  expect(dragonHabits.active).toBe("day")
  expect(flat.phases[0]!.speed).toBe(1)
})

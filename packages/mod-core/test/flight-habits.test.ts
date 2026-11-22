import { expectPlainGuide } from "./fixtures/plain-guide"
import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { ABILITY_INSTRUCTIONS, creatureBindings } from "../src/creature-abilities"
import { CREATURE_LIFE_INSTRUCTIONS, CREATURE_LIFE_SUMMARY, creatureClipNeeds } from "../src/creature-life"
import { FLIGHT_INSTRUCTIONS, FLIGHT_SUMMARY, FLIGHT_TASK_LINES, HABITS_INSTRUCTIONS, diveCoverage, diveIssues, flightClipRoles, flightClips, flightModelIssues, flightPlan, flightTierGaps, flightTierStops, flightWords, habitClipRoles, habitsClips, habitsPlan, habitsWords, impliesFlight } from "../src/creature-flight"
import { AbilitySchema, BossSchema, CREATURE_LIFE_FIELDS, ENGAGEMENT_LIMITS, EntitySchema, FlightSchema, HabitsSchema, type Ability, type Flight, type Habits } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { FLIGHT_LIMITS, FLIGHT_STATES, HABIT_LIMITS, VANILLA_PREY, VANILLA_PREY_IDS, flightMotions } from "../src/flight-words"
import { createEntity, saveProject } from "../src/project"
import { reconcile } from "../src/reconcile"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac, targetJdkTool } from "./target-javac"

const OFFICIAL = hasTargetJavac("fabric-1.21.1-official")

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const temporary = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-flight-"))
  roots.push(root)
  return root
}

// ---- what a flier and a habitual creature are made of ----

const clip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })
// The golem's own motions, less the ones named here again, with the motions of the air and of habits made beside them (the budget is 16 motions).
const flierDesign = {
  ...fightingGolemDesign,
  animations: [
    ...fightingGolemDesign.animations.filter((animation) => !["burst", "wave", "roar"].includes(animation.name)),
    clip("takeoff", 1.5, false),
    clip("fly", 1, true),
    clip("glide", 2, true),
    clip("hover", 1, true),
    clip("land", 1.2, false),
    clip("sleep", 2, true),
    clip("eat", 1.5, false),
    clip("roar", 0.8, false),
    clip("stoop", 1.2, false),
  ],
}
const clipLengths = (design: typeof flierDesign) => design.animations.map((animation) => ({ name: animation.name, length: animation.length }))
const slam = AbilitySchema.parse(golemAbilities[0])
const stoop: Ability = AbilitySchema.parse({ ...golemAbilities[0], id: "stoop", name: "俯冲", clip: "stoop", windup: 0.5, length: 1.2, where: "air", dive: true, start: { min_distance: 6, max_distance: 16, line_of_sight: true, cooldown: 4, weight: 3 }, hits: [{ ...golemAbilities[0]!.hits[0], at: 0.9 }] })
const flight: Flight = FlightSchema.parse({ style: "soar", speed: 12, altitude: { min: 10, max: 28 }, turn: 80, climb: 40, bank: 28, air_share: 0.6, takeoff: { clip: "takeoff", seconds: 1.5 }, land: { clip: "land", seconds: 1.2 }, clips: { fly: "fly", glide: "glide", hover: null } })
const hovering: Flight = FlightSchema.parse({ ...flight, style: "hover", altitude: { min: 2, max: 6 }, clips: { fly: "fly", glide: null, hover: "hover" } })
const habits: Habits = HabitsSchema.parse({ active: "day", rest: { clip: "sleep" }, home: { radius: 32 }, prey: ["cow", "sheep"], hunger_seconds: 300, eat: { clip: "eat" }, alert: { clip: "roar", distance: 20 } })
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, model: flierDesign }
const entityPath = (id = "StudioCreature") => `src/main/java/com/minemods/content_golem_mod/entity/${id}.java`
const rendererPath = "src/main/java/com/minemods/content_golem_mod/client/StudioCreatureRenderer.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entityPath()])
const refusedFlight = (change: Record<string, unknown>) => FlightSchema.safeParse({ ...flight, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const refusedHabits = (change: Record<string, unknown>) => HabitsSchema.safeParse({ ...habits, ...change }).error?.issues.map((issue) => issue.message).join(" ") ?? ""
const hostile = compileEntity({ ...base, behavior: "hostile", abilities: [slam, stoop], flight, habits })
const hover = compileEntity({ ...base, id: "bee", behavior: "passive", flight: hovering })

// ---- the data ----

test("flight and habits are bounded, and a creature that has neither is exactly what it was", () => {
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "苔皮苦力怕", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null }
  expect(JSON.stringify(EntitySchema.parse(old))).toBe(JSON.stringify(old))
  expect(EntitySchema.parse({ ...old, flight: null, habits: null })).toMatchObject({ flight: null, habits: null })
  expect(Object.keys(CREATURE_LIFE_FIELDS)).toEqual(expect.arrayContaining(["flight", "habits"]))
  // The ranges of the spec, each end: speed 2-30, altitude.min 2-48, altitude.max 4-96, turn 20-360, climb 10-60, bank 0-60, seconds 0.2-5, air_share 0-1.
  expect(refusedFlight({})).toBe("")
  const ends: [string, unknown, unknown][] = [
    ["speed", FLIGHT_LIMITS.speed.min - 0.5, FLIGHT_LIMITS.speed.max + 0.5],
    ["turn", FLIGHT_LIMITS.turn.min - 1, FLIGHT_LIMITS.turn.max + 1],
    ["climb", FLIGHT_LIMITS.climb.min - 1, FLIGHT_LIMITS.climb.max + 1],
    ["bank", -1, FLIGHT_LIMITS.bank.max + 1],
    ["air_share", -0.1, 1.1],
  ]
  ends.forEach(([field, low, high]) => {
    expect(refusedFlight({ [field]: low })).not.toBe("")
    expect(refusedFlight({ [field]: high })).not.toBe("")
  })
  expect([FLIGHT_LIMITS.speed.min, FLIGHT_LIMITS.speed.max].map((speed) => refusedFlight({ speed }))).toEqual(["", ""])
  expect([FLIGHT_LIMITS.turn.min, FLIGHT_LIMITS.turn.max].map((turn) => refusedFlight({ turn }))).toEqual(["", ""])
  expect([0, 1].map((air_share) => refusedFlight({ air_share }))).toEqual(["", ""])
  expect(refusedFlight({ altitude: { min: 1, max: 28 } })).not.toBe("")
  expect(refusedFlight({ altitude: { min: 49, max: 90 } })).not.toBe("")
  expect(refusedFlight({ altitude: { min: 10, max: 3 } })).not.toBe("")
  expect(refusedFlight({ altitude: { min: 10, max: 97 } })).not.toBe("")
  expect(refusedFlight({ takeoff: { clip: "takeoff", seconds: 0.1 } })).not.toBe("")
  expect(refusedFlight({ land: { clip: "land", seconds: 5.5 } })).not.toBe("")
  expect(refusedFlight({ takeoff: { clip: null, seconds: 1 } })).toBe("")
  expect(refusedFlight({ style: "glide" })).not.toBe("")
  expect(refusedFlight({ speed: Number.NaN })).not.toBe("")
  expect(refusedFlight({ extra: 1 })).not.toBe("")
  expect(refusedFlight({ clips: { fly: "not a name!", glide: "glide", hover: null } })).not.toBe("")
  // Habits: radius 8-64, at most 6 prey (vanilla ones, no repeats), hunger 30-1200 s, alert 4-32 blocks.
  expect(refusedHabits({})).toBe("")
  expect(refusedHabits({ home: { radius: 7 } })).not.toBe("")
  expect(refusedHabits({ home: { radius: 65 } })).not.toBe("")
  expect(refusedHabits({ home: null, rest: null, alert: null, eat: null, prey: [] })).toBe("")
  expect(refusedHabits({ hunger_seconds: 29 })).not.toBe("")
  expect(refusedHabits({ hunger_seconds: 1201 })).not.toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 3 } })).not.toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 33 } })).not.toBe("")
  expect(refusedHabits({ active: "dusk" })).not.toBe("")
  expect(refusedHabits({ prey: ["player"] })).toContain("猎物只能写原版生物的 id")
  expect(refusedHabits({ prey: ["villager"] })).not.toBe("")
  expect(refusedHabits({ prey: ["cow", "cow"] })).toContain("不要写两遍")
  expect(refusedHabits({ prey: VANILLA_PREY_IDS.slice(0, HABIT_LIMITS.prey + 1) })).not.toBe("")
  expect(refusedHabits({ prey: VANILLA_PREY_IDS.slice(0, HABIT_LIMITS.prey) })).toBe("")
  expect(Object.keys(VANILLA_PREY)).toHaveLength(20)
})

test("a creature's document as a whole: the height band, the motions of each style, reserved motions, and who may dive", () => {
  const old = { id: "11111111-1111-4111-8111-111111111111", name: "雨燕", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null }
  const document = (change: Record<string, unknown>) => EntitySchema.safeParse({ ...old, abilities: [slam, stoop], flight, habits, ...change }).error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n") ?? ""
  expect(document({})).toBe("")
  expect(document({ flight: { ...flight, altitude: { min: 20, max: 20 } } })).toContain("要比下限（altitude.min）大")
  expect(document({ flight: { ...flight, clips: { fly: "fly", glide: null, hover: null } } })).toContain("滑翔型（soar）要有滑翔的动作")
  expect(document({ flight: { ...hovering, clips: { fly: "fly", glide: null, hover: null } } })).toContain("悬停型（hover）要有悬停的动作")
  // The motions the creature plays on its own are not for the air or for rest.
  expect(document({ flight: { ...flight, clips: { fly: "walk", glide: "glide", hover: null } } })).toContain("飞行不能用 walk")
  expect(document({ flight: { ...flight, takeoff: { clip: "idle", seconds: 1 } } })).toContain("飞行不能用 idle")
  expect(document({ habits: { ...habits, rest: { clip: "death" } } })).toContain("习性不能用 death")
  expect(document({ habits: { ...habits, alert: { clip: "hurt", distance: 10 } } })).toContain("习性不能用 hurt")
  // A creature that stands on purpose does not fly.
  expect(document({ stationary: { reason: "守着洞口" } })).toContain("不会飞")
  // Dive and where: a dive needs wings; "air" needs them too; a dive on the ground only is no dive.
  expect(document({ flight: null, habits: null })).toContain("这只生物不会飞")
  expect(document({ flight: null, habits: null, abilities: [{ ...slam, where: "air" }] })).toContain("where 写 air")
  expect(document({ abilities: [{ ...stoop, where: "ground" }] })).toContain("俯冲（dive），只能在天上用")
  expect(document({ flight: null, habits: null, abilities: [{ ...slam, where: "ground" }] })).toBe("")
  expect(document({ abilities: [{ ...stoop, where: "any" }] })).toBe("")
  // Habits: a hunter bites; one that is always up has no rest.
  expect(document({ attack_damage: 0 })).toContain("近战攻击力")
  expect(document({ attack_damage: 0, habits: { ...habits, prey: [] } })).toBe("")
  expect(document({ habits: { ...habits, active: "always" } })).toContain("一直活动")
  expect(document({ habits: { ...habits, active: "always", rest: null } })).toBe("")
  // The old ability fields still say what they said; the new ones are optional.
  expect(AbilitySchema.safeParse(golemAbilities[0]).success).toBe(true)
  expect(AbilitySchema.safeParse({ ...golemAbilities[0], where: "sea" }).success).toBe(false)
  expect(AbilitySchema.safeParse({ ...golemAbilities[0], dive: "yes" }).success).toBe(false)
  // A boss and a flier are one document: both are checked.
  const boss = BossSchema.parse({ bar: { color: "purple", style: "notched_10", darken_sky: true }, intro: null, phases: [], death: { seconds: 2, xp_bursts: 0, explosion: false }, leash: null })
  expect(document({ boss, behavior: "passive" })).toContain("Boss")
})

// ---- ticks, plan and words ----

test("the plan turns seconds into ticks once; the circle holds where the dive can start", () => {
  const plan = flightPlan(flight, [slam, stoop], true)
  expect(plan).toMatchObject({ soar: true, cruise: 0.6, stall: 0.3, turn: 4, takeoffTicks: 30, landTicks: 24, airShare: 0.6, fights: true, where: [0, 2], dive: [false, true] })
  expect(plan.diveAccel).toBeCloseTo(plan.accel * 3, 6)
  expect(plan.probes).toEqual([10, 20, 30])
  expect(plan.arrive).toBe(6)
  // The stoop starts 6-16 blocks away: the circle is held at a distance that lies in that window, never tighter than the creature can turn.
  expect(plan.circle.distance).toBeGreaterThanOrEqual(6)
  expect(plan.circle.distance).toBeLessThanOrEqual(16)
  expect(plan.circle.radius).toBeGreaterThanOrEqual(plan.circle.turnRadius * 1.2 - 1e-9)
  expect(plan.diveHeight).toBeGreaterThanOrEqual(flight.altitude.min)
  // Only abilities of the air count for fighting there; a flier with none fights on the ground, and a hovering one has no stall.
  expect(flightPlan(flight, [{ ...slam, where: "ground" }], true).fights).toBe(false)
  expect(flightPlan(flight, [slam], true).fights).toBe(true)
  expect(flightPlan(flight, [slam, stoop], false).fights).toBe(false)
  expect(flightPlan(hovering, [], false)).toMatchObject({ soar: false, stall: 0 })
  expect(habitsPlan(habits, { eat: 1.5, roar: 0.8 })).toEqual({ hungerTicks: 6000, eatTicks: 30, alertTicks: 16, cooldownTicks: 600, giveUpTicks: 600 })
  expect(habitsPlan({ ...habits, eat: null, alert: { clip: null, distance: 8 } }, {})).toMatchObject({ eatTicks: HABIT_LIMITS.pause, alertTicks: HABIT_LIMITS.pause })
  expect(Object.values(FLIGHT_STATES).sort()).toEqual([0, 1, 2, 3])
})

test("a glide that a hovering creature never plays is neither played nor asked of the model", () => {
  expect(flightMotions({ ...flight, clips: { fly: "fly", glide: "glide", hover: "hover" } })).toEqual({ takeoff: "takeoff", land: "land", fly: "fly", glide: "glide", hover: null })
  expect(flightMotions({ ...hovering, clips: { fly: "fly", glide: "glide", hover: "hover" } })).toMatchObject({ glide: null, hover: "hover" })
  expect(flightClips(flight)).toEqual(["takeoff", "land", "fly", "glide"])
  expect(flightClips(hovering)).toEqual(["takeoff", "land", "fly", "hover"])
  expect(flightClips({ ...flight, takeoff: { clip: "fly", seconds: 1 } })).toEqual(["fly", "land", "glide"])
  expect(flightClips(null)).toEqual([])
  expect(habitsClips(habits)).toEqual(["sleep", "eat", "roar"])
  expect(habitsClips({ ...habits, rest: null, eat: null, alert: null })).toEqual([])
  expect(flightClipRoles({ ...flight, clips: { fly: "fly", glide: "takeoff", hover: null } }).find((role) => role.clip === "takeoff")!.fix).toContain("起飞");
  expect(habitClipRoles(habits).map((role) => role.clip)).toEqual(["sleep", "eat", "roar"])
})

test("the words say what the creature does in plain sentences, and the instructions carry an example the schema takes", () => {
  expect(flightWords.style(flight)).toBe("滑翔型（要有速度才能留在空中），巡航每秒 12 格，平时离地 10–28 格")
  expect(flightWords.summary(flight)).toStartWith("它会飞：")
  expect(flightWords.summary(flight)).toContain("约 60% 的时间在天上")
  expect(flightWords.summary(flight)).toContain("落地前先降到离地 1 格以内")
  expect(flightWords.summary(flight)).toContain("不受摔落伤害")
  expect(flightWords.share({ ...flight, air_share: 0 })).toContain("不上天")
  expect(flightWords.share({ ...flight, air_share: 1 })).toContain("一直在天上")
  expect(flightWords.clips(hovering)).toContain("、悬停播「")
  expect(flightWords.sees(flight, "golem_mod:creature")).toContain("/tp @e[type=golem_mod:creature,limit=1]")
  expect(flightWords.dive).toContain("两倍巡航速度")
  expect(habitsWords.rest(habits)).toStartWith("白天活动，夜里回窝休息（播「")
  expect(habitsWords.rest({ ...habits, active: "night", home: null, rest: null })).toBe("夜里活动，白天就地休息（站着不动）")
  expect(habitsWords.rest({ ...habits, active: "always" })).toBe("一直活动，不特意休息")
  expect(habitsWords.home(habits)).toContain("32 格")
  expect(habitsWords.prey(habits)).toContain("牛、羊")
  expect(habitsWords.prey(habits)).toContain("5 分钟")
  // An empty prey says nothing about hunting (a gameplay may still make it eat), and the summary leaves that part out.
  expect(habitsWords.prey({ ...habits, prey: [] })).toBe("")
  expect(habitsWords.summary({ ...habits, prey: [] })).not.toContain("捕猎")
  expect(habitsWords.summary({ ...habits, prey: [] }).split("；")).toHaveLength(3)
  expect(habitsWords.alert(habits)).toContain("走近 20 格")
  expect(habitsWords.alert(habits)).toContain("30 秒内不再")
  expect(habitsWords.summary(habits).split("；")).toHaveLength(4)
  // What an AI is told: the fields, the limits, the honest limits of the flight, and a valid example for each.
  ;["style", "altitude", "bank", "air_share", "takeoff", "clips", "dive", "where", "没有三维寻路", "不会在水下飞", "不载人", "不受摔落伤害", "不改世界里的任何方块"].forEach((word) => expect(FLIGHT_INSTRUCTIONS).toContain(word))
  ;["active", "rest", "home", "prey", "hunger_seconds", "eat", "alert", "原版生物", "不改世界里的任何方块"].forEach((word) => expect(HABITS_INSTRUCTIONS).toContain(word))
  const flightExample = /例：(\{"style".*\})。$/.exec(FLIGHT_INSTRUCTIONS)?.[1]
  expect(FlightSchema.safeParse(JSON.parse(flightExample!)).success).toBe(true)
  const habitsExample = /例：(\{"active".*\})。$/.exec(HABITS_INSTRUCTIONS)?.[1]
  expect(HabitsSchema.safeParse(JSON.parse(habitsExample!)).success).toBe(true)
  expect(FlightSchema.parse(JSON.parse(flightExample!))).toEqual(flight)
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(FLIGHT_INSTRUCTIONS)
  expect(CREATURE_LIFE_INSTRUCTIONS).toContain(HABITS_INSTRUCTIONS)
  expect(CREATURE_LIFE_SUMMARY).toContain(FLIGHT_SUMMARY)
  expect(FLIGHT_TASK_LINES.join("\n")).toContain("写了 flight 就不再列进「这次做不了」")
  expect(ABILITY_INSTRUCTIONS).toBeDefined()
})

test("what a creature says it can and cannot do no longer claims that nothing flies", async () => {
  const { CREATURE_LIFE_CAPABILITY } = await import("../src/creature-capability")
  expect(CREATURE_LIFE_CAPABILITY.not_done.join("\n")).not.toContain("生物不会飞")
  const said = CREATURE_LIFE_CAPABILITY.not_done.find((line) => line.startsWith("飞行（flight）能做的有限"))!
  ;["没有三维找路", "不会在水下飞", "不载人", "moves 在天上不起作用", "没有在游戏里看过"].forEach((word) => expect(said).toContain(word))
  expect(CREATURE_LIFE_CAPABILITY.done.filter((line) => line.startsWith("生物会飞（flight）") || line.startsWith("生物的习性（habits）"))).toHaveLength(2)
})

// ---- the generated class ----

test("a creature without flight and habits generates the same Java as before they existed", () => {
  const sha = (files: Record<string, string | Uint8Array>) => {
    const text = Object.keys(files).sort().map((name) => `${name}\n${files[name]}`).join("\n")
    return `${createHash("sha256").update(text).digest("hex").slice(0, 16)} ${text.length}`
  }
  const plain = { ...base, model: fightingGolemDesign }
  const abilities = golemAbilities.map((ability) => AbilitySchema.parse(ability))
  const boss = BossSchema.parse({ bar: { color: "purple", style: "notched_10", darken_sky: true }, intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: null }, phases: [{ below: 0.66, clip: "wave", seconds: 1, bar_color: null, speed: 1.15, damage: 1.3, abilities: [] }], death: { seconds: 4, xp_bursts: 6, explosion: true }, leash: { distance: 48, reset_seconds: 30 } })
  const explosion = { spawn: null, explosion: { fuse_ticks: 30, radius: 3, damage_blocks: false, effects: [] }, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
  // The hashes are of the Java the generator wrote at 8313a47, the commit before flight and habits; they change only when the Java of a creature that does not fly does.
  // re-pinned again when hostile creatures (and bosses) became the game's Monster (test/creature-baby.test.ts): an import and one word in the class line, +50 characters in each hostile one; passive and following creatures did not move.
  // re-pinned when every creature became the game's ageing animal, so it can be a baby (test/creature-baby.test.ts): the class gained its baby members and its renderer one line for the shadow; nothing else of any creature moved.
  // re-pinned when the generator moved to Mojang's names (Loom's officialMojangMappings): names and the imports they need, nothing else.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, behavior: "hostile" }))).toBe("b60b5316e29acbdb 44702")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, behavior: "passive" }))).toBe("28eb6cb991b5baf0 44352")
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, behavior: "hostile", abilities }))).toBe("a013bae9c3c77759 60069") // re-pinned for the step back walked backwards facing the target (strafeTo, abilityFace; epic game5; was 46278e07e2869657 58044), and before that for the step back steered straight, no path (getMoveControl().moveTo); was d72f0dc24d3e1e22 57795; and for the step back into an ability's window (abilityBackOff, epic game5); nothing of flight or habits
  // The boss's changed on purpose once since: its leash ends the fight when nobody is near, wherever it stands (epic r1 review); was cdf93202f5c882e3 70105.
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, behavior: "hostile", abilities, boss }))).toBe("dd6183edd5a272b4 74609") // and the step back walked backwards facing the target (epic game5; was 5adcdedc186983d1 72613); the step back steered straight (was 7f29c38fec6d73a1 72364); and the step back into an ability's window (epic game5); was 4fdcf89a516aefde 70562
  // names only (Yarn → Mojang), checked 2026-11-14
  expect(sha(compileEntity({ ...plain, behavior: "hostile", abilities, runtime: explosion }))).toBe("96c175f8bef7de89 63981") // the step back walked backwards facing the target (epic game5; was 50fb0373b37c0a58 62284); the step back steered straight (was 1ac5a8fd3be54665 62035); the step back as well (epic game5); was 345191f0e26fa61a 60424
  // Said as null, or not said at all, is the same.
  expect(sha(compileEntity({ ...plain, behavior: "hostile", flight: null, habits: null }))).toBe(sha(compileEntity({ ...plain, behavior: "hostile" })))
  const text = Object.values(compileEntity({ ...plain, behavior: "hostile", abilities, boss })).join("\n")
  ;["FLIGHT", "HABIT", "GroundWander", "applyRotations", "trackingTickInterval", "setNoGravity"].forEach((word) => expect(text).not.toContain(word))
})

test("a flier's class holds the four states, the steering, the landing and the bank in the renderer", () => {
  const source = java(hostile)
  // The state machine, synced and saved.
  ;["FLIGHT_GROUND = 0", "FLIGHT_TAKEOFF = 1", "FLIGHT_AIR = 2", "FLIGHT_LANDING = 3"].forEach((line) => expect(source).toContain(line))
  expect(source).toContain("EntityDataAccessor<Byte> FLIGHT = SynchedEntityData.defineId(StudioCreature.class, EntityDataSerializers.BYTE)")
  expect(source).toContain("builder.define(FLIGHT, (byte) 0)")
  expect(source).toContain('nbt.putInt("FlightState"')
  expect(source).toContain('nbt.getInt("FlightState")')
  // A saved takeoff resumes in the air, a saved landing on the ground.
  expect(source).toContain("flightSet(saved == FLIGHT_TAKEOFF ? FLIGHT_AIR : saved == FLIGHT_LANDING ? FLIGHT_GROUND : saved)")
  // No gravity in the air, our own travel, no fall damage, a tracking interval of one tick.
  expect(source).toContain("setNoGravity(off)")
  expect(source).toContain("public void travel(Vec3 movementInput)")
  expect(source).toContain("move(MoverType.SELF, getDeltaMovement())")
  expect(source).toContain("public boolean causeFallDamage(float fallDistance, float damageMultiplier, DamageSource damageSource) { return false; }")
  expect(source).toContain("ClipContext")
  expect(source).toContain("getNavigation().stop()")
  expect(source).toContain("FLIGHT_TAKEOFF_TICKS = 30")
  expect(source).toContain("FLIGHT_LAND_TICKS = 24")
  expect(source).toContain("FLIGHT_ALT_MIN = 10.0")
  expect(source).toContain("FLIGHT_ALT_MAX = 28.0")
  // The clips and the controller choice (soar: glide, never hover).
  expect(source).toContain('RawAnimation.begin().thenPlay("animation.creature.takeoff")')
  expect(source).toContain('RawAnimation.begin().thenPlay("animation.creature.land")')
  expect(source).toContain('"animation.creature.fly"')
  expect(source).toContain('"animation.creature.glide"')
  expect(source).not.toContain("animation.creature.hover")
  expect(source).toContain("RawAnimation flying = flightClip();")
  // The dive and the places an ability starts.
  expect(source).toContain("flightAllows(index)")
  expect(source).toContain("flightDive")
  // Boss states still win: a creature that is not awake or is held does not take off (immobile), and the abilities do not start in the takeoff.
  expect(source).toContain("isImmobile()")
  // The habits: five goals at the priorities the contract says, a ground wander in place of the plain one, the world clock and the saved home.
  ;["HabitAlertGoal", "HabitEatGoal", "HabitHuntGoal", "HabitRestGoal", "HabitReturnGoal", "GroundWanderGoal"].forEach((name) => expect(source).toContain(`class ${name} extends`))
  expect(source).toContain("goalSelector.addGoal(0, new HabitAlertGoal())")
  expect(source).toContain("goalSelector.addGoal(1, new HabitEatGoal())")
  expect(source).toContain("goalSelector.addGoal(2, new HabitHuntGoal())")
  expect(source).toContain("goalSelector.addGoal(3, new HabitRestGoal())")
  expect(source).toContain("goalSelector.addGoal(4, new HabitReturnGoal())")
  expect(source).toContain("getDayTime()")
  expect(source).toContain("hasFixedTime()")
  expect(source).toContain('nbt.putDouble("HabitHomeX"')
  expect(source).toContain("EntityType.COW")
  expect(source).toContain("EntityType.SHEEP")
  expect(source).toContain('"animation.creature.sleep"')
  // The client: the renderer's pitch and roll through the GeckoLib hook.
  const renderer = String(hostile[rendererPath])
  expect(renderer).toContain("protected void applyRotations(StudioCreature creature, PoseStack poseStack, float ageInTicks, float rotationYaw, float partialTick, float nativeScale)")
  expect(renderer).toContain("super.applyRotations(creature, poseStack, ageInTicks, rotationYaw, partialTick, nativeScale)")
  expect(renderer).toContain("creature.flightPitch(partialTick)")
  expect(renderer).toContain("creature.flightRoll(partialTick)")
  expect(renderer).toContain("Axis.XP")
  expect(renderer).toContain("Axis.ZP")
  // The registry asks for a position every tick.
  expect(Object.values(hostile).join("\n")).toContain(".updateInterval(1)")
})

test("the numbers of the data are the numbers of the Java, and a hovering creature hovers instead of gliding", () => {
  const source = java(hostile)
  const plan = flightPlan(flight, [slam, stoop], true)
  expect(source).toContain(`FLIGHT_CRUISE = ${plan.cruise};`)
  const bee = java(hover)
  expect(bee).toContain('"animation.bee.hover"')
  expect(bee).not.toContain("animation.bee.glide")
  // A flier without abilities has none of the machinery of the dive and of an ability's `where`.
  expect(bee).not.toContain("flightDive")
  expect(bee).not.toContain("FLIGHT_WHERE")
  // A passive flier has no habits and no hunting; a hostile one without abilities of the air does not circle.
  expect(bee).not.toContain("HabitHuntGoal")
  const walker = java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], flight }))
  expect(walker).toContain("FLIGHT_GROUND")
  expect(walker).toContain("FLIGHT_WHERE = {0}")
  expect(walker).toContain("FLIGHT_DIVE = {false}")
  // Habits without flight: a ground creature that rests, with no flying in its habits.
  const grounded = java(compileEntity({ ...base, behavior: "hostile", habits }))
  expect(grounded).toContain("HabitRestGoal")
  expect(grounded).not.toContain("FLIGHT")
  expect(grounded).not.toContain("applyRotations")
  expect(String(compileEntity({ ...base, behavior: "hostile", habits })[rendererPath])).not.toContain("applyRotations")
})

test("a motion that the model does not have stops the build, with the creature and the motion named", () => {
  const without = (name: string) => ({ ...flierDesign, animations: flierDesign.animations.filter((animation) => animation.name !== name) })
  for (const [lacking, where] of [["takeoff", "起飞"], ["land", "落地"], ["fly", "在天上扇翅"], ["glide", "滑翔"], ["sleep", "休息"], ["eat", "吃东西"], ["roar", "警觉"]] as const) {
    expect(() => compileEntity({ ...base, behavior: "hostile", abilities: [slam, stoop], flight, habits, model: without(lacking) })).toThrow(new RegExp(`${where}时.*模型里没有这个动作`))
  }
  // The hover it never plays (it soars) is not asked for.
  expect(() => compileEntity({ ...base, behavior: "hostile", abilities: [slam, stoop], flight: { ...flight, clips: { fly: "fly", glide: "glide", hover: "missing" } }, habits })).not.toThrow()
  const issues = (creature: { flight?: Flight | null; habits?: Habits | null }, clips: ReturnType<typeof clipLengths> | null = clipLengths(flierDesign)) => flightModelIssues({ name: "雨燕", ...creature }, clips)
  expect(issues({ flight, habits })).toEqual([])
  expect(issues({ flight, habits }, null)).toEqual([])
  expect(issues({ flight: { ...flight, takeoff: { clip: "takeoff", seconds: 2.5 } } })).toMatchObject([{ rule: "flight_clip_length", stops: false, text: expect.stringContaining("长 1.5 秒") }])
  expect(issues({ flight: { ...flight, land: { clip: "nothing", seconds: 1 } } })).toMatchObject([{ rule: "flight_clip", stops: true, text: expect.stringContaining("模型里没有这个动作") }])
  expect(issues({ habits: { ...habits, rest: { clip: "nothing" } } })).toMatchObject([{ rule: "habit_clip", stops: true }])
  expect(issues({})).toEqual([])
})

test("the model's motions that a flier and its habits need are listed with what each is for", () => {
  const needs = creatureClipNeeds({ behavior: "hostile", attack_damage: 3, abilities: [slam, stoop], flight, habits })
  const named = needs.map((need) => need.clip)
  expect(named).toEqual(expect.arrayContaining(["takeoff", "land", "fly", "glide", "sleep", "eat", "roar", "stoop"]))
  expect(named).not.toContain("hover")
  expect(needs.find((need) => need.clip === "takeoff")!.why).toContain("起飞")
  const bindings = creatureBindings({ abilities: [slam, stoop], flight, habits }, flierDesign.animations)
  expect(bindings.clips.find((bound) => bound.clip === "takeoff")!.sources.map((source) => source.by)).toContain("flight")
  expect(bindings.clips.find((bound) => bound.clip === "sleep")!.sources.map((source) => source.by)).toContain("habit")
  expect(bindings.clips.find((bound) => bound.clip === "stoop")!.sources.map((source) => source.by)).toContain("ability")
  expect(bindings.clips.find((bound) => bound.clip === "hover")?.sources ?? []).toEqual([])
})

// ---- the contract the reviewer reads ----

test("the contract reads the flight and the habits from the class, and from a class without them says nothing", async () => {
  const { readGeneratedCreature } = await import("../src/creature-contract")
  const facts = readGeneratedCreature(java(hostile), null)
  expect(facts.flight).toEqual({ soar: true, cruise: 0.6, altitude: [10, 28], turn: 4, takeoff_ticks: 30, land_ticks: 24, air_share: 0.6, no_fall_damage: true, carried: true, gated: true, faces: true, dives: 1, charges: true, dive_least: 1.2, dive_most: 3.9, roams: false, meal: true })
  expect(facts.habits).toEqual({ mode: 0, home_radius: 32, hunger_ticks: 6000, prey: ["cow", "sheep"], alert_distance: 20, alert_cooldown: 600 })
  expect(facts.plays).toEqual(
    expect.arrayContaining([
      { clip: "takeoff", by: "flight" },
      { clip: "land", by: "flight" },
      { clip: "fly", by: "flight" },
      { clip: "glide", by: "flight" },
      { clip: "sleep", by: "habit" },
      { clip: "eat", by: "habit" },
      { clip: "roar", by: "habit" },
    ]),
  )
  expect(readGeneratedCreature(java(hover), null).flight).toMatchObject({ soar: false, altitude: [2, 6], dives: 0, gated: false, faces: false })
  const plain = readGeneratedCreature(java(compileEntity({ ...base, behavior: "hostile", abilities: [slam] })), null)
  expect(plain.flight).toBeNull()
  expect(plain.habits).toBeNull()
  expect(plain.plays.filter((play) => play.by === "flight" || play.by === "habit")).toEqual([])
})

// ---- the whole project ----

/**
 * A mod with two creatures: the hostile soaring one with habits and a dive (it hunts, rests at night, is alert), and a passive one that hovers.
 * Their models are the golem's with the motions of the air; the build reads the class for each.
 */
async function flierProject(life: Habits = habits) {
  const root = await temporary()
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const bee = EntitySchema.parse({
    ...createEntity({ name: "萤蜂", description: "停在空中的小飞虫。", health: 6, speed: 0.2, attack_damage: 0, behavior: "passive" }),
    runtime: { spawn: { biomes: ["minecraft:plains"], weight: 6, min: 1, max: 2 }, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
    name_en: "Glowbee",
    flight: hovering,
  })
  const flier = EntitySchema.parse({ ...golem, abilities: [slam, stoop], flight, habits: life })
  const saved = await saveProject(directory, { ...sample, entities: [flier, bee] }, sample.revision)
  const first = await putModelAsset(directory, { entity_id: flier.id, data: { design: flierDesign }, origin: "example", expectedRevision: saved.revision })
  const second = await putModelAsset(directory, { entity_id: bee.id, data: { design: { ...flierDesign, animations: flierDesign.animations.filter((animation) => !["slam", "stoop", "attack"].includes(animation.name)) } }, origin: "example", expectedRevision: first.project.revision })
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, directory, project: second.project, source, flier, bee, built: await assembleBuildSource(directory, source, TEMPLATE) }
}

test.skipIf(!OFFICIAL)("the whole generated tree of a project with a hostile flier and a hovering one compiles", async () => {
  const made = await flierProject()
  // Both creatures' classes carry the flight, only the hostile one the habits.
  const folder = path.join(made.source, "src/main/java/com/minemods/content_azure_sample/entity")
  const sources = await Promise.all((await readdir(folder)).filter((file) => file.endsWith(".java")).map((file) => readFile(path.join(folder, file), "utf8")))
  expect(sources).toHaveLength(2)
  expect(sources.filter((text) => text.includes("FLIGHT_AIR")).length).toBe(2)
  expect(sources.filter((text) => text.includes("HabitHuntGoal")).length).toBe(1)
  const compiled = (await compileTreeFor("fabric-1.21.1-official", made.source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

test.skipIf(!OFFICIAL)("every vanilla creature a creature may hunt is a constant of the game, and a flier's renderer and class compile on their own", async () => {
  const root = await temporary()
  const { writeFile } = await import("node:fs/promises")
  const shapes = [
    { name: "StudioCreature", files: hostile },
    { name: "StudioCreatureB", files: compileEntity({ ...base, behavior: "hostile", abilities: [slam, stoop], flight: { ...flight, air_share: 0 }, habits: { ...habits, active: "night", home: null, rest: null, eat: null, alert: { clip: null, distance: 8 } } }) },
    { name: "StudioCreatureC", files: compileEntity({ ...base, behavior: "hostile", habits: { ...habits, active: "always", rest: null, prey: VANILLA_PREY_IDS.slice(0, HABIT_LIMITS.prey) } }) },
    { name: "StudioCreatureD", files: hover },
    { name: "SteadyFlier", files: compileEntity({ ...base, behavior: "hostile", engagement: "provoked", steady: { preset: "huge", focus: { hurt: 0.1 } }, abilities: [slam, stoop], flight }) },
  ]
  await Promise.all(
    shapes.map(async (shape) => {
      const class_ = shape.name === "StudioCreature" ? "StudioCreature" : shape.name
      const text = String(shape.files[entityPath()]).replaceAll("StudioCreature", class_)
      await writeFile(path.join(root, `${class_}.java`), text)
    }),
  )
  await writeFile(path.join(root, "StudioCreatureRenderer.java"), String(hostile[rendererPath]))
  await writeFile(
    path.join(root, "Vocabulary.java"),
    `import net.minecraft.world.entity.EntityType;
final class Vocabulary {
    static final EntityType<?>[] PREY = { ${VANILLA_PREY_IDS.map((id) => `EntityType.${id.toUpperCase()}`).join(", ")} };
}
`,
  )
  const compiled = await targetJavac("fabric-1.21.1-official", root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

test("the reconciliation stops on a motion that the model lacks, says in passing that an epic creature said to fly does not, and counts every motion that is played", async () => {
  const made = await flierProject()
  const names = (design: typeof flierDesign) => ({ animations: { [made.flier.id]: design.animations.map((animation) => animation.name), [made.bee.id]: design.animations.map((animation) => animation.name) } })
  const whole = names(flierDesign)
  const rules = (project: Parameters<typeof reconcile>[0], seen = whole) => reconcile(project, seen)
  expect(rules(made.project).filter((finding) => finding.rule.startsWith("flight_") || finding.rule.startsWith("habit_") || finding.rule === "tier_flight")).toEqual([])
  // Played by flight or habits, so not "unplayed".
  // (A soaring creature never hovers, so the one motion it is not asked for is the one it is told it does not play.)
  const unplayed = rules(made.project).filter((finding) => finding.rule === "animation_unplayed" && finding.about?.id === made.flier.id)
  expect(unplayed).toHaveLength(1)
  expect(unplayed[0]!.detail ?? "").toStartWith("never played: hover;")
  ;["takeoff", "land", "fly", "glide", "sleep", "eat", "roar", "stoop"].forEach((name) => expect((unplayed[0]!.detail ?? "").split("played: ")[2]!).toContain(name))
  // Lacking a motion of the air or of rest stops the build and is placed on the creature.
  const lacking = names({ ...flierDesign, animations: flierDesign.animations.filter((animation) => !["land", "sleep"].includes(animation.name)) })
  const stops = rules(made.project, lacking).filter((finding) => finding.stops && (finding.rule === "flight_clip" || finding.rule === "habit_clip"))
  // The soaring creature lacks the landing and its rest; the hovering one, on the same model, lacks its landing.
  expect(stops.filter((finding) => finding.about?.id === made.flier.id).map((finding) => finding.rule).sort()).toEqual(["flight_clip", "habit_clip"])
  expect(stops.filter((finding) => finding.about?.id === made.bee.id).map((finding) => finding.rule)).toEqual(["flight_clip"])
  expect(stops.every((finding) => finding.about?.kind === "entity")).toBe(true)
  // The epic tier: a creature the blueprint says flies and that has no flight says so once, without stopping; one with flight and its own motions asks nothing.
  const confirmed = (entities: typeof made.project.entities, brief: string) =>
    ({
      ...made.project,
      entities,
      blueprint: {
        request: "做一只会飞的史诗龙", style: { palette: ["#335533"], shape: "圆润", naming: "中文名", world: "北方森林" }, questions: [], revision: 1, state: "confirmed" as const,
        entries: [
          { key: "drake_model", kind: "model", title: "龙模型", brief: "说明", owner: "drake", needs: [], out_of_scope: null, asset_id: entities[0]!.id },
          { key: "drake", kind: "entity", title: "龙", brief, owner: null, needs: ["drake_model"], out_of_scope: null, asset_id: null, tier: { level: "epic" as const, reason: "你说了史诗", by: "ai" as const } },
        ],
      },
    }) as unknown as Parameters<typeof reconcile>[0]
  const tier = (project: Parameters<typeof reconcile>[0]) => rules(project).filter((finding) => finding.rule === "tier_flight")
  expect(tier(confirmed([made.flier], "一只会飞的龙"))).toEqual([])
  const walker = { ...made.flier, flight: null, habits: null }
  const said = tier(confirmed([walker], "一只会飞的龙"))
  expect(said).toMatchObject([{ rule: "tier_flight", stops: false, about: { kind: "entity", id: made.flier.id } }])
  expect(said[0]!.text).toContain("史诗档还缺这几项表现")
  expect(said[0]!.text).toContain("没有 flight")
  expect(tier(confirmed([walker], "一只守着洞口的石头傀儡"))).toEqual([])
  const bare = tier(confirmed([{ ...made.flier, flight: { ...flight, takeoff: { clip: null, seconds: 1 }, land: { clip: null, seconds: 1 } }, habits: { ...habits, rest: { clip: null } } }], "一只守着洞口的龙"))
  expect(bare[0]!.text).toContain("起飞没有自己的动作")
  expect(bare[0]!.text).toContain("落地没有自己的动作")
  expect(bare[0]!.text).toContain("休息没有自己的动作")
  // The motions of takeoff, landing and rest are 必须 for the epic tier (spec 一), so a creature without them stops; being only said to fly never does.
  expect(bare).toMatchObject([{ rule: "tier_flight", stops: true }])
  expect(bare[0]!.fix).toContain("必须补齐才能打包")
  expect(bare[0]!.fix).not.toContain("不补也能打包，只是")
  expect(said.every((finding) => !finding.stops)).toBe(true)
  expect(said[0]!.fix).toContain("不补也能打包")
  expect(flightTierStops({ flight, habits })).toEqual([])
  expect(flightTierStops({ flight: { ...flight, land: { clip: null, seconds: 1 } }, habits })).toHaveLength(1)
  // Not an epic creature: nothing is asked.
  const standard = confirmed([walker], "一只会飞的龙")
  expect(rules({ ...standard, blueprint: { ...standard.blueprint!, entries: standard.blueprint!.entries.map((value) => ({ ...value, tier: value.kind === "entity" ? { level: "boss" as const, reason: "x", by: "ai" as const } : undefined })) } } as never).filter((finding) => finding.rule === "tier_flight")).toEqual([])
  expect(flightTierGaps({}, true)).toHaveLength(1)
  expect(flightTierGaps({ flight, habits }, true)).toEqual([])
  expect(impliesFlight("一只会飞的龙")).toBe(true)
  expect(impliesFlight("a dragon with wings")).toBe(true)
  expect(impliesFlight("一把飞溅火花的剑", "石头傀儡")).toBe(false)
  expect(impliesFlight(null, undefined)).toBe(false)
})

test("the guide says how to watch a creature fly and how to see its habits, and says nothing for a mod without them", async () => {
  const made = await flierProject()
  // Round 17: a flier with habits and a boss's commands, and still not a word of code outside the commands.
  expectPlainGuide(made.built.guide)
  const section = made.built.guide.sections.find((value: { title: string }) => value.title === "怎么玩一遍")
  const lines: string[] = (section?.lines ?? []).map((line: { text: string }) => line.text)
  expect(lines.find((line) => line.includes("它会飞：滑翔型"))).toContain("巡航每秒 12 格")
  expect(lines.find((line) => line.includes("想亲眼看它飞"))).toContain("/tp @e[type=azure_sample:")
  expect(lines.find((line) => line.includes("想看俯冲"))).toContain("两倍巡航速度")
  expect(lines.find((line) => line.includes("它会飞：悬停型"))).toContain("悬停播「悬停」")
  const habitLine = lines.find((line) => line.includes("想看它的作息"))!
  expect(habitLine).toContain("/time set day")
  expect(habitLine).toContain("牛、羊")
  expect(habitLine).toContain("HabitHunger:100000")
  expect(habitLine).toContain("20 格以内")
  expect(lines.find((line) => line.includes("的习性：白天活动"))).toContain("牛、羊")
  // The AI-facing words never reach a person with a technical id for an animal.
  expect(habitLine).not.toContain("cow、sheep")
  // The same mod before it had wings says none of it.
  const root = await temporary()
  await createDataGameplaySample(path.join(root, "project"), { life: true, abilities: true })
  await mkdir(path.join(root, "source"))
  const quiet = await assembleBuildSource(path.join(root, "project"), path.join(root, "source"), TEMPLATE)
  const everything = JSON.stringify(quiet.guide)
  ;["它会飞", "想亲眼看它飞", "的习性", "HabitHunger"].forEach((word) => expect(everything).not.toContain(word))
}, 120000)

test("a flier is not set in a pen in the test scene, and the test scene still places every creature", async () => {
  const { scenePlan } = await import("../src/scene")
  const made = await flierProject()
  const plan = scenePlan(made.project)
  const creatures = plan.things.filter((thing) => thing.kind === "creature")
  expect(creatures).toHaveLength(2)
  expect(plan.place.some((step) => /glass_pane|fence_gate|barrier/.test(step.command))).toBe(false)
  const walking = scenePlan({ ...made.project, entities: made.project.entities.map((entity) => ({ ...entity, flight: null, habits: null })) })
  expect(walking.things.filter((thing) => thing.kind === "creature")).toHaveLength(2)
})

// ---- a dive arrives at its hit ----

/**
 * Runs the charge's own speed rule, taken out of the generated class, over a straight line the way the game applies it: on each tick it sets the velocity from the
 * distance still to go and the ticks still to go, and the next tick's movement applies it. The aim is a point `distance` blocks away; `ticks` is the number of
 * velocities set before the hit (the first hit's tick less the tick the wind-up ended on). Prints, for each case, where it was at the hit and the speeds used.
 */
async function runCharge(source: string, cases: readonly [distance: number, ticks: number][]) {
  const method = /private static double flightDiveSpeed\([^)]*\) \{[\s\S]*?\n    \}\n/.exec(source)![0].replace("private static", "static")
  const constant = (name: string) => Number(new RegExp(`${name} = ([\\d.]+);`).exec(source)![1])
  const root = await temporary()
  const { writeFile } = await import("node:fs/promises")
  await writeFile(
    path.join(root, "ChargeCheck.java"),
    `public final class ChargeCheck {
${method}
    public static void main(String[] args) {
        double least = ${constant("FLIGHT_DIVE_LEAST")}, most = ${constant("FLIGHT_DIVE_MOST")}, floor = ${constant("FLIGHT_STALL")};
        for (String arg : args) {
            String[] part = arg.split(",");
            double distance = Double.parseDouble(part[0]);
            int ticks = Integer.parseInt(part[1]);
            // The aim lies along (0.6, -0.8, 0) from the start: down and forward, as a stoop does.
            double x = 0.6 * distance, y = -0.8 * distance, z = 0.0;
            double fastest = 0.0, slowest = Double.MAX_VALUE;
            for (int tick = 0; tick < ticks; tick++) {
                double d = Math.sqrt(x * x + y * y + z * z);
                double speed = flightDiveSpeed(d, ticks - tick, least, most, floor);
                fastest = Math.max(fastest, speed);
                slowest = Math.min(slowest, speed);
                if (d > 1.0e-6) { x -= x * speed / d; y -= y * speed / d; z -= z * speed / d; }
            }
            System.out.println(arg + " " + Math.sqrt(x * x + y * y + z * z) + " " + fastest + " " + slowest);
        }
    }
}
`,
  )
  const compiled = Bun.spawnSync([targetJdkTool("fabric-1.21.1-official", "javac"), "-d", root, path.join(root, "ChargeCheck.java")])
  expect(compiled.stderr.toString().split("\n").filter((line) => line.includes("error"))).toEqual([])
  const ran = Bun.spawnSync([targetJdkTool("fabric-1.21.1-official", "java"), "-cp", root, "ChargeCheck", ...cases.map(([distance, ticks]) => `${distance},${ticks}`)])
  return ran.stdout.toString().trim().split("\n").map((line) => {
    const [which, gap, fastest, slowest] = line.split(" ")
    return { which: which!, gap: Number(gap), fastest: Number(fastest), slowest: Number(slowest) }
  })
}

test.skipIf(!OFFICIAL)("a dive is at the point it locked on the tick of its first hit, at the speed that takes it there, within its least and most", async () => {
  const source = java(hostile)
  const plan = flightPlan(flight, [slam, stoop], true)
  const cover = diveCoverage(stoop)
  // The stoop: wind-up ends on tick 10, the first hit is on tick 18; the charge sets a velocity while ticks 10 to 16 count (the one set at 17 is applied after the hit): seven.
  expect(plan.first).toEqual([abilityPlanTick(slam), 18])
  expect(cover).toEqual({ windup: 10, first: 18, ticks: 7, blocks: 27.3 })
  expect(source).toContain(`FLIGHT_FIRST = {${plan.first.join(", ")}}`)
  expect(source).toContain(`FLIGHT_DIVE_LEAST = ${plan.diveLeast};`)
  expect(source).toContain("FLIGHT_DIVE_MOST = 3.9;")
  expect(plan.diveLeast).toBeCloseTo(flight.speed / 20 * FLIGHT_LIMITS.dive, 9)
  // The charge is its own straight line: nothing in it pulls it up or aside, and it is not let go of before the last hit has been counted.
  expect(source).toContain("flightCharge(centre);")
  expect(source).toContain("if (abilityTick >= FLIGHT_LAST[abilityIndex]) {")
  expect(source).not.toContain("to.dot(getDeltaMovement())")
  expect(source).not.toContain("FLIGHT_DIVE_SPEED")
  const near = FLIGHT_LIMITS.stall * plan.cruise
  // From a few blocks to the most it can cover: it is at the point, within what a soaring creature never goes under (it cannot stop), on the tick; and it never goes outside its bounds.
  const reached = await runCharge(source, [[1, 7], [3, 7], [8.4, 7], [15.6, 7], [24, 7], [27.3, 7], [2, 1], [3.9, 1], [12, 4]])
  reached.forEach((found) => {
    expect(found.gap).toBeLessThanOrEqual(near + 1e-6)
    expect(found.fastest).toBeLessThanOrEqual(3.9 + 1e-9)
    expect(found.slowest).toBeGreaterThanOrEqual(near - 1e-9)
  })
  // Far enough that it needs the most: it goes at the most the whole way, and is short by exactly what it could not cover.
  const [short] = await runCharge(source, [[40, 7]])
  expect(short!.fastest).toBeCloseTo(3.9, 9)
  expect(short!.gap).toBeCloseTo(40 - 7 * 3.9, 6)
  // Never faster than it needs to be when it can take its time, and never under twice cruise otherwise: 8.4 blocks in seven ticks is exactly twice this cruise.
  const [exact, farther] = await runCharge(source, [[8.4, 7], [21, 7]])
  expect(exact!.fastest).toBeCloseTo(plan.diveLeast, 9)
  expect(farther!.fastest).toBeCloseTo(3, 9)
  // A hovering creature may stop: nothing keeps it above a stall.
  const bee = java(compileEntity({ ...base, id: "bee", behavior: "hostile", abilities: [slam, stoop], flight: hovering }))
  const [hovered] = await runCharge(bee, [[3, 7]])
  expect(hovered!.gap).toBeLessThan(1e-6)
}, 120000)

const abilityPlanTick = (ability: Ability) => Math.min(...ability.hits.map((hit) => Math.max(Math.round(ability.windup * 20), Math.round(hit.at * 20))))

test("a dive whose start cannot be covered in the time from the end of its wind-up to its first hit is warned about, with what to change; the others are not", () => {
  const who = (change: Partial<Ability>, abilities = [slam, { ...stoop, ...change }] as Ability[]) => diveIssues({ name: "雨燕", behavior: "hostile", flight, abilities })
  // The stoop starts up to 16 blocks away and has seven velocities to cover it: 27.3 blocks.
  expect(who({})).toEqual([])
  expect(diveCoverage({ ...stoop, windup: 0.5, hits: [{ ...stoop.hits[0]!, at: 0.5 }] }).ticks).toBe(0)
  expect(diveCoverage({ ...stoop, windup: 0.5, hits: [{ ...stoop.hits[0]!, at: 0.55 }] }).ticks).toBe(0)
  // Too far for the time: 40 blocks in seven velocities.
  const far = who({ start: { ...stoop.start, max_distance: 40 } })
  expect(far).toMatchObject([{ rule: "flight_dive_reach", stops: false }])
  expect(far[0]!.text).toContain("「雨燕」的俯冲招式「俯冲」")
  expect(far[0]!.text).toContain("目标在 40 格外")
  expect(far[0]!.text).toContain("27.3 格")
  expect(far[0]!.text).toContain("第 0.5 秒")
  expect(far[0]!.text).toContain("第 0.9 秒")
  // The fix: a later first hit (40 / 3.9 is 11 velocities, one more tick before the first and the wind-up's own: tick 22, second 1.1) or a nearer start (27.3).
  expect(far[0]!.fix).toContain("第 1.1 秒")
  expect(far[0]!.fix).toContain("27.3 格以内")
  expect(far[0]!.detail).toContain("7 velocities * 3.9 blocks/tick = 27.3")
  // The first hit counts, not the last: a second, later hit gives it no more time to get there.
  const second = who({ start: { ...stoop.start, max_distance: 40 }, hits: [stoop.hits[0]!, { ...stoop.hits[0]!, at: 1.1 }] })
  expect(second).toHaveLength(1)
  // A hit at the very end of the wind-up leaves no time at all.
  expect(who({ hits: [{ ...stoop.hits[0]!, at: 0.5 }] })[0]!.text).toContain("只有 0 秒")
  // Only a dive of a flier that fights: not the ability that is no dive, not a creature that does not fly or does not fight.
  expect(who({ dive: false, start: { ...stoop.start, max_distance: 40 } })).toEqual([])
  expect(diveIssues({ name: "雨燕", behavior: "hostile", flight: null, abilities: [{ ...stoop, start: { ...stoop.start, max_distance: 40 } }] })).toEqual([])
  expect(diveIssues({ name: "雨燕", behavior: "passive", flight, abilities: [{ ...stoop, start: { ...stoop.start, max_distance: 40 } }] })).toEqual([])
})

test("the words and the reconciliation say a dive's arrival, and warn about a dive that cannot get there", async () => {
  expect(flightWords.dive).toContain("两倍巡航速度")
  expect(flightWords.dive).toContain("正好在第一次出手的那一刻到")
  expect(flightWords.dive).toContain("3.9 格")
  ;["离第一次出手还有多久", "不受 climb 限制", "start.max_distance", "78"].forEach((word) => expect(FLIGHT_INSTRUCTIONS).toContain(word))
  const made = await flierProject()
  const reach = (project: Parameters<typeof reconcile>[0]) => reconcile(project, { animations: { [made.flier.id]: flierDesign.animations.map((animation) => animation.name), [made.bee.id]: flierDesign.animations.map((animation) => animation.name) } }).filter((finding) => finding.rule === "flight_dive_reach")
  expect(reach(made.project)).toEqual([])
  const farStoop = { ...stoop, start: { ...stoop.start, max_distance: 40 } }
  const warned = reach({ ...made.project, entities: made.project.entities.map((entity) => (entity.id === made.flier.id ? { ...entity, abilities: [slam, farStoop] } : entity)) })
  expect(warned).toMatchObject([{ rule: "flight_dive_reach", stops: false, about: { kind: "entity", id: made.flier.id } }])
  expect(warned[0]!.fix).toContain("27.3 格以内")
}, 120000)

// ---- a warning before it attacks ----

const warning = (attack: number, distance = 20) => HabitsSchema.parse({ ...habits, alert: { clip: "roar", distance, attack_distance: attack } })

test("attack_distance is bounded by the shortest reach and by how far a creature fights, must be nearer than the warning, and only means something for one that picks its players", () => {
  // Without it the alert is what it was: the same object comes back.
  expect(HabitsSchema.parse(habits).alert).toEqual({ clip: "roar", distance: 20 })
  // 2 to 24: the ends are taken, the next step out is not; 24 is how far a creature fights at all.
  expect(HABIT_LIMITS.attack.max).toBe(ENGAGEMENT_LIMITS.distance)
  expect(refusedHabits({ alert: { clip: "roar", distance: 20, attack_distance: HABIT_LIMITS.attack.min } })).toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 32, attack_distance: HABIT_LIMITS.attack.max } })).toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 20, attack_distance: HABIT_LIMITS.attack.min - 0.5 } })).not.toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 32, attack_distance: HABIT_LIMITS.attack.max + 0.5 } })).not.toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 20, attack_distance: Number.NaN } })).not.toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 20, attack_distance: "8" } })).not.toBe("")
  // Nearer than the warning: the same distance, or a farther one, says the warning would come after the attack.
  expect(refusedHabits({ alert: { clip: "roar", distance: 20, attack_distance: 19.5 } })).toBe("")
  expect(refusedHabits({ alert: { clip: "roar", distance: 20, attack_distance: 20 } })).toContain("要比警觉的距离（distance 20）近")
  expect(refusedHabits({ alert: { clip: "roar", distance: 10, attack_distance: 12 } })).toContain("先警告，再靠近才开打")
  // A creature that has no alert has nothing to put it in.
  expect(refusedHabits({ alert: null })).toBe("")
  // The document: only a creature that fights, and picks its players itself.
  const document = (change: Record<string, unknown>) => EntitySchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", name: "雨燕", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null, abilities: [slam, stoop], flight, habits: warning(8), ...change }).error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n") ?? ""
  expect(document({})).toBe("")
  expect(document({ engagement: "any_player" })).toBe("")
  expect(document({ behavior: "passive", abilities: [] })).toContain("habits.alert.attack_distance: 写了扑上来的距离（attack_distance）的生物要是敌对的")
  expect(document({ engagement: "provoked" })).toContain("engagement 写的是 provoked")
  expect(document({ engagement: "none_by_itself" })).toContain("engagement 写的是 none_by_itself")
  expect(document({ habits }).includes("attack_distance")).toBe(false)
  expect(document({ behavior: "passive", abilities: [], habits }).includes("attack_distance")).toBe(false)
})

test("the words say it: the person is told both distances, and an AI is told what it does and given an example the schema takes", () => {
  const warned = warning(8)
  expect(habitsWords.warns(habits)).toBeNull()
  expect(habitsWords.warns(warned)).toBe("走近到 20 格它会先警告，再靠近到 8 格才扑上来")
  expect(habitsWords.alert(habits)).not.toContain("扑上来")
  expect(habitsWords.alert(warned)).toContain("走近到 8 格以内（或者玩家打了它）才会扑上来")
  expect(HABITS_INSTRUCTIONS).toContain(`attack_distance（${HABIT_LIMITS.attack.min}–${HABIT_LIMITS.attack.max} 格，必须比 distance 小`)
  expect(HABITS_INSTRUCTIONS).toContain("玩家打了它")
  expect(HABITS_INSTRUCTIONS).toContain("不攻击")
  const example = /例：(\{"active".*\})。$/.exec(HABITS_INSTRUCTIONS)?.[1]
  const parsed = HabitsSchema.parse(JSON.parse(example!))
  expect(parsed.alert).toEqual({ clip: "roar", distance: 20, attack_distance: 8 })
  expect(FLIGHT_SUMMARY).toContain("先只警告")
})

test("a creature that warns first picks a player only within the nearer distance or after being hit, keeps one it has, and one that does not is what it was", () => {
  const withWarning = java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], habits: warning(8) }))
  expect(withWarning).toContain("private static final double ENGAGE_ATTACK_DISTANCE = 8.0;")
  expect(withWarning).toContain("return distanceToSqr(candidate) <= ENGAGE_ATTACK_DISTANCE * ENGAGE_ATTACK_DISTANCE || candidate == getLastHurtByMob();")
  // It is the pick that has the rule: the retention rule (the same target until it is gone, far, or unseen) is the one it always had.
  expect(withWarning).toContain("player -> engageAllows(player) && hasLineOfSight(player) && engageNear(player)")
  expect(withWarning).toContain("if (!engageAllows(target) || engageUnseenTicks > ENGAGE_UNSEEN_TICKS) setTarget(null);")
  expect(withWarning).not.toMatch(/engageNear\(target\)/)
  // A fractional distance keeps its fraction.
  expect(java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], habits: warning(7.5) }))).toContain("ENGAGE_ATTACK_DISTANCE = 7.5;")
  // Without it: no distance, no test, and the same Java as before it existed, whatever the other habits.
  const without = java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], habits }))
  ;["ENGAGE_ATTACK_DISTANCE", "engageNear"].forEach((word) => expect(without).not.toContain(word))
  // A creature that does not fight, or fights only when hit, has nothing to hold back: the distance changes nothing there.
  const quiet = (change: Record<string, unknown>, life: Habits) => java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], ...change, habits: life }))
  expect(quiet({ engagement: "provoked" }, warning(8))).toBe(quiet({ engagement: "provoked" }, habits))
  expect(quiet({ engagement: "none_by_itself" }, warning(8))).toBe(quiet({ engagement: "none_by_itself" }, habits))
  expect(java(compileEntity({ ...base, behavior: "passive", habits: warning(8) }))).toBe(java(compileEntity({ ...base, behavior: "passive", habits })))
  // A creature that is told to pick players only by its engagement still has the pick of its engagement, now with the distance.
  expect(quiet({ engagement: "any_player" }, warning(8))).toContain("engageNear(player)")
})

test("the contract reads the warning from the class, the review sees it, and a class without it says nothing of it", async () => {
  const { readGeneratedCreature } = await import("../src/creature-contract")
  const warned = readGeneratedCreature(java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], habits: warning(8) })), null)
  expect(warned.engage?.attack_distance).toBe(8)
  const plain = readGeneratedCreature(java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], habits })), null)
  expect(plain.engage?.attack_distance ?? null).toBeNull()
  // A class where the distance is declared but the pick does not use it is not read as a warning.
  const unused = java(compileEntity({ ...base, behavior: "hostile", abilities: [slam], habits: warning(8) })).replace(" && engageNear(player)", "")
  expect(readGeneratedCreature(unused, null).engage?.attack_distance ?? null).toBeNull()
  // The review's sentences.
  const { creatureContractLines } = await import("../src/creature-contract")
  const lines = creatureContractLines({ title: "生物", key: "creature" }, warned).join("\n")
  expect(lines).toContain("只有玩家走近到 8 格以内，或者玩家打过它，才挑他")
  expect(lines).toContain("先只警告，玩家走近到 8 格以内（或者打过它）才开打")
})

test("the guide tells a person where the two distances are and how to see the difference", async () => {
  const made = await flierProject(warning(8))
  const section = made.built.guide.sections.find((value: { title: string }) => value.title === "怎么玩一遍")
  const lines: string[] = (section?.lines ?? []).map((line: { text: string }) => line.text)
  const habitLine = lines.find((line) => line.includes("想看它的作息"))!
  expect(habitLine).toContain("走近到 20 格它会先警告，再靠近到 8 格才扑上来")
  expect(habitLine).toContain("站在两个距离之间它只警告、不动手")
  expect(habitLine).toContain("走进 8 格以内，或者先打它一下，它才开打")
  // This one has a home, which is where it stays: the scene's roam is not for it.
  expect(lines.find((line) => line.includes("想亲眼看它飞"))).not.toContain("测试场里")
  const homeless = await flierProject({ ...warning(8), home: null })
  const homelessLines: string[] = (homeless.built.guide.sections.find((value: { title: string }) => value.title === "怎么玩一遍")?.lines ?? []).map((line: { text: string }) => line.text)
  // Its roam is the room its own turn needs (speed 12, turning 80 degrees a second: its tightest circle has a radius of 8.6 blocks; it keeps 1.2 times that, inside the 0.8 of the roam it picks its points from).
  const { flightRoam } = await import("../src/scene")
  const { turnRadius } = await import("../src/flight-words")
  expect(flightRoam(turnRadius(flight))).toBe(Math.ceil((turnRadius(flight) * 1.2) / 0.8))
  expect(homelessLines.find((line) => line.includes("想亲眼看它飞"))).toContain(`测试场里它被限定在出生点 ${flightRoam(turnRadius(flight))} 格以内飞`)
  // Without it the habit line says nothing of it.
  const plain = await flierProject()
  const plainLines: string[] = (plain.built.guide.sections.find((value: { title: string }) => value.title === "怎么玩一遍")?.lines ?? []).map((line: { text: string }) => line.text)
  expect(plainLines.find((line) => line.includes("想看它的作息"))).not.toContain("扑上来")
}, 120000)

// ---- a roam given by the command that places the creature ----

test("a flier with no home keeps to a roam it is given, one with a home keeps to its home, and a creature that does not fly has none of it", async () => {
  const roaming = java(compileEntity({ ...base, behavior: "hostile", abilities: [slam, stoop], flight, habits: { ...habits, home: null } }))
  ;["FLIGHT_ROAM_LEAST", "FLIGHT_ROAM_MOST", "flightRoamInside(Vec3 point)", "flightRoamCentre()", '"FlightRoam"', '"FlightRoamSet"'].forEach((word) => expect(roaming).toContain(word))
  expect(roaming).toContain(`FLIGHT_ROAM_LEAST = ${FLIGHT_LIMITS.roam.min}.0;`)
  expect(roaming).toContain(`FLIGHT_ROAM_MOST = ${FLIGHT_LIMITS.roam.max}.0;`)
  // The wander point is taken from the roam's centre and radius when it has no home.
  expect(roaming).toContain("Vec3 home = flightRoamCentre();")
  // The test scene summons a flier in the mood to stay on the ground for the first look (`SCENE.look`): the state and the mood are read from NBT, the mood only along with the state.
  expect(roaming).toMatch(/nbt\.contains\("FlightState"\)[\s\S]*?nbt\.getBoolean\("FlightMoodAir"\)[\s\S]*?nbt\.getInt\("FlightMoodLeft"\)/)
  // A flier without any habits has the roam too: it is the scene that gives it, and the scene knows nothing of habits.
  expect(java(compileEntity({ ...base, behavior: "passive", flight }))).toContain('"FlightRoam"')
  // A home of its own is its centre: the roam is not there at all.
  ;["FlightRoam", "flightRoamCentre", "FLIGHT_ROAM"].forEach((word) => expect(java(hostile)).not.toContain(word))
  // A creature that does not fly has the same Java as before.
  const walking = java(compileEntity({ ...base, behavior: "hostile", abilities: [slam] }))
  expect(walking).not.toContain("FlightRoam")
  const { readGeneratedCreature } = await import("../src/creature-contract")
  expect(readGeneratedCreature(roaming, null).flight?.roams).toBe(true)
  expect(readGeneratedCreature(java(hostile), null).flight?.roams).toBe(false)
  expect(FLIGHT_LIMITS.roam).toEqual({ min: 4, max: 64 })
  expect(FLIGHT_LIMITS.roam.min).toBeGreaterThan(FLIGHT_LIMITS.arriveLeast)
  expect(FLIGHT_LIMITS.roam.max).toBe(HABIT_LIMITS.radius.max)
})

test.skipIf(!OFFICIAL)("a flier with a roam, and one that warns first, compile with every other habit", async () => {
  const root = await temporary()
  const { writeFile } = await import("node:fs/promises")
  const shapes = [
    { name: "StudioCreature", files: hostile },
    { name: "RoamA", files: compileEntity({ ...base, behavior: "hostile", abilities: [slam, stoop], flight, habits: { ...habits, home: null } }) },
    { name: "RoamB", files: compileEntity({ ...base, behavior: "passive", flight: hovering }) },
    { name: "WarnA", files: compileEntity({ ...base, behavior: "hostile", abilities: [slam, stoop], flight, habits: warning(8) }) },
    { name: "WarnB", files: compileEntity({ ...base, behavior: "hostile", abilities: [slam], habits: { ...warning(2.5, 4), home: null, rest: null }, engagement: "any_player" }) },
  ]
  await Promise.all(shapes.map((shape) => writeFile(path.join(root, `${shape.name}.java`), String(shape.files[entityPath()]).replaceAll("StudioCreature", shape.name))))
  await writeFile(path.join(root, "StudioCreatureRenderer.java"), String(hostile[rendererPath]))
  const compiled = await targetJavac("fabric-1.21.1-official", root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

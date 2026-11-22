import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { TICKS } from "../src/ability-words"
import { assembleBuildSource } from "../src/build-source"
import { BOSS_LIMITS, bossFirstPhaseIds } from "../src/boss-words"
import { BOSS_INSTRUCTIONS, BOSS_SUMMARY, bossMasks, bossOpeningTicks, bossOwn, bossPlan, bossWords } from "../src/creature-boss"
import { creatureContractLines, readGeneratedCreature } from "../src/creature-contract"
import { AbilitySchema, BossSchema, EntitySchema, type Ability, type Boss } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { FLIGHT_LIMITS } from "../src/flight-words"
import { putModelAsset } from "../src/assets"
import { saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { dragonDesign, dragonFlight, epicAbilities, epicBoss, epicHabits } from "./giant-flier"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"

/**
 * A boss that names its first attack (`boss.intro.opening`), in general terms: the ability it uses first once the wake-up is over, with no other one starting before it has been used
 * (or before its time has run out), armed again by a leash reset and not by a phase change. First case in the epic review: a flier whose words say "after displaying in the air it dives
 * down to claw" breathed first a quarter of the time, because abilities are picked by weight. Nothing here is about a dragon but its numbers.
 */

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

// ---- a boss that walks: the golem's two abilities, the first phase of which uses the one no phase lists ----

const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const walker: Boss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack" },
  phases: [
    { below: 0.66, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["slam"] },
    { below: 0.33, clip: "wave", seconds: 1, bar_color: null, speed: 1.3, damage: 1.6, abilities: [] },
  ],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 48, reset_seconds: 30 },
})
const opening = (boss: Boss, id: string | null | undefined): Boss => ({ ...boss, intro: { ...boss.intro!, ...(id === undefined ? {} : { opening: id }) } })
const plain = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "creature", name: "生物", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile" as const, model: fightingGolemDesign }
const entityFile = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const walk = (boss: Boss) => String(compileEntity({ ...plain, abilities: [slam, burst], boss } as never)[entityFile])

// ---- a boss that flies: stoop (a dive, only in the air), breath (the air) and sweep (only on the ground) ----

const flier = { ...plain, id: "dragon", name: "巨龙", health: 400, model: dragonDesign }
const fly = (boss: Boss) => String(compileEntity({ ...flier, abilities: epicAbilities, flight: dragonFlight, habits: epicHabits, boss } as never)[entityFile])
const facts = (java: string) => readGeneratedCreature(java, null)

test("the first attack is a name in the document: it is left out, null or the id of an ability the first phase can start, and anything else is said in plain words", () => {
  const document = (boss: Boss) => EntitySchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", name: "傀儡", description: "", health: 20, speed: 0.25, attack_damage: 3, behavior: "hostile", model_asset_id: null, abilities: [slam, burst], boss })
  const said = (boss: Boss) => document(boss).error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" ") ?? ""
  // The first phase uses what no phase lists: here "burst" (the phases list "slam"), and every ability when all are listed.
  expect(bossFirstPhaseIds(walker.phases, ["slam", "burst"])).toEqual(["burst"])
  expect(bossFirstPhaseIds([{ abilities: ["slam", "burst"] }], ["slam", "burst"])).toEqual(["slam", "burst"])
  expect(bossFirstPhaseIds([], ["slam", "burst"])).toEqual(["slam", "burst"])
  for (const accepted of [undefined, null, "burst"]) expect(said(opening(walker, accepted))).toBe("")
  expect(said(opening(walker, "slam"))).toContain("boss.intro.opening: 登场以后的第一招「")
  expect(said(opening(walker, "slam"))).toContain("在第一阶段用不了")
  expect(said(opening(walker, "nothing"))).toContain("nothing 在这个生物的招式（abilities）和连招（combos）里都找不到")
  // Every ability listed by some phase: the first phase can use them all, so the one a phase lists is fine as a first attack.
  expect(said(opening({ ...walker, phases: [{ ...walker.phases[0]!, abilities: ["slam", "burst"] }] }, "slam"))).toBe("")
  // The id is held to the shape an ability's id has.
  expect(BossSchema.safeParse(opening(walker, "Bad Id")).success).toBe(false)
  // A boss without a wake-up has no end of one to start from: there is nowhere to write it.
  expect(BossSchema.safeParse({ ...walker, intro: null }).success).toBe(true)
  // A document that does not name one is what it always was, key for key.
  expect(JSON.stringify(BossSchema.parse(JSON.parse(JSON.stringify(walker))))).toBe(JSON.stringify(walker))
})

test("how long the others wait is read from the data: the floor, the ability's own cooldown, and for a flier its trip up and down", () => {
  // The floor is the ten seconds the game's generated creatures give any chase before they give up (boss-words has no imports, so the two are held equal here).
  expect(BOSS_LIMITS.opening.floor).toBe(FLIGHT_LIMITS.giveUpSeconds)
  const floor = BOSS_LIMITS.opening.floor * TICKS
  // A walker: the floor and the ability's cooldown (burst waits 2 s in the golem's sample; read from the data, not written here).
  const walkPlan = bossPlan(opening(walker, "burst"), [slam, burst])
  expect(walkPlan.opening).toEqual({ index: 1, ticks: floor + Math.round(burst.start.cooldown * TICKS) })
  expect(bossOpeningTicks({ start: { ...burst.start, cooldown: 0 } })).toBe(floor)
  expect(bossOpeningTicks({ start: { ...burst.start, cooldown: 120 } })).toBe(floor + 120 * TICKS)
  // A flier adds the least it stays up before it comes down, the landing and the take-off again.
  const stoop = epicAbilities[0]!
  const trip = (FLIGHT_LIMITS.airLeast + dragonFlight.land.seconds + dragonFlight.takeoff.seconds) * TICKS
  expect(bossPlan(opening(epicBoss, "stoop"), epicAbilities, dragonFlight).opening).toEqual({ index: 0, ticks: floor + stoop.start.cooldown * TICKS + trip })
  expect(bossOpeningTicks(stoop, dragonFlight)).toBe(456)
  // Without one named (or one that is not there) there is no plan for it, and the masks are what they were.
  expect(bossPlan(walker, [slam, burst]).opening).toBeNull()
  expect(bossPlan(opening(walker, "nothing"), [slam, burst]).opening).toBeNull()
  expect(bossMasks(walker, [slam, burst])).toEqual([0b10, 0b01, 0b11])
})

test("a boss that walks and names a first attack holds the others back for it; one that names none is the Java it always was", () => {
  const without = walk(walker)
  // Left out, null, or the key written with nothing: the same bytes, and none of the first attack's pieces.
  expect(walk(opening(walker, null))).toBe(without)
  for (const piece of ["BOSS_OPENING", "bossOpened", "bossFightAt", "bossBegin", "bossStarted", "BossOpened", "BossOpenWaited"]) expect(without).not.toContain(piece)
  expect(without).toContain("private boolean bossAllows(int index) {\n        return bossState() == BOSS_FIGHT && (BOSS_MASKS[Math.min(bossPhase(), BOSS_MASKS.length - 1)] & (1 << index)) != 0;\n    }")
  expect(without).toContain("if (--bossTimer <= 0) bossSet(BOSS_FIGHT, 0);")
  expect(facts(without).boss).not.toHaveProperty("opening")

  const first = walk(opening(walker, "burst"))
  // Its place in the list and its time: "burst" is the second ability; the time is the floor and its cooldown.
  expect(first).toContain("private static final int BOSS_OPENING = 1;")
  expect(first).toContain(`private static final int BOSS_OPENING_TICKS = ${BOSS_LIMITS.opening.floor * TICKS + Math.round(burst.start.cooldown * TICKS)};`)
  // The gate: the first attack always, the others once it has been used, once its phase does not allow it, or once its time has run out.
  expect(first).toContain("return index == BOSS_OPENING || bossOpened || (mask & (1 << BOSS_OPENING)) == 0 || tickCount - bossFightAt > BOSS_OPENING_TICKS;")
  // The fight begins where the wake-up ends, and that is where it is armed (and where a leash reset's next fight arms it again); a phase change goes through `bossSet(BOSS_FIGHT, bossPhase())` and does not.
  expect(first).toContain("if (--bossTimer <= 0) bossBegin();")
  expect(first.split("bossSet(BOSS_FIGHT, 0)")).toHaveLength(2)
  expect(first).toContain("bossSet(BOSS_FIGHT, bossPhase());")
  expect(first).toMatch(/private void bossBegin\(\) \{\s*bossSet\(BOSS_FIGHT, 0\);\s*bossOpened = false;\s*bossFightAt = tickCount;/)
  // Every start of an ability is told to the boss, and a saved fight keeps whether it was used.
  expect(first).toMatch(/abilityIndex = index;\s*bossStarted\(index\);/)
  expect(first).toContain('nbt.putBoolean("BossOpened", bossOpened);')
  expect(first).toContain('bossOpened = nbt.getBoolean("BossOpened");')
  // epic r3 review: a reload (the age starts from 0 again) goes on with the wait where it was instead of starting it over.
  expect(first).toContain('nbt.putInt("BossOpenWaited", Mth.clamp(tickCount - bossFightAt, 0, BOSS_OPENING_TICKS + 1));')
  expect(first).toContain('bossFightAt = tickCount - Mth.clamp(nbt.getInt("BossOpenWaited"), 0, BOSS_OPENING_TICKS + 1);')
  expect(facts(first).boss).toMatchObject({ opening: { index: 1, ticks: BOSS_LIMITS.opening.floor * TICKS + Math.round(burst.start.cooldown * TICKS), gated: true, marked: true, armed: true } })
})

test("a boss that flies and dives first: the same pieces, the time counting the trip, the dive the only one the flight sees as ready", () => {
  const without = fly(epicBoss)
  expect(fly(opening(epicBoss, null))).toBe(without)
  for (const piece of ["BOSS_OPENING", "bossOpened", "bossFightAt", "bossBegin", "bossStarted"]) expect(without).not.toContain(piece)
  const first = fly(opening(epicBoss, "stoop"))
  expect(first).toContain("private static final int BOSS_OPENING = 0;")
  expect(first).toContain("private static final int BOSS_OPENING_TICKS = 456;")
  // The air show ends in two places (the seconds ran out, or it could not rise in the time a landing and a take-off need); both begin the fight the same way.
  expect(first).toContain("if (--bossTimer <= 0) bossBegin();")
  expect(first).toMatch(/FLIGHT_LAND_TICKS \+ FLIGHT_TAKEOFF_TICKS \+ BOSS_WATCH\) \{\s*bossBegin\(\);\s*\}/)
  expect(first.split("bossSet(BOSS_FIGHT, 0)")).toHaveLength(2)
  // The flight asks `bossAllows` for what is ready (to go up for an ability in the air, to come down for one on the ground), so it too sees only the first attack until it is used.
  expect(first).toContain("private boolean flightReady(int index) { return tickCount >= abilityReadyAt[index] && bossAllows(index); }")
  expect(facts(first).boss).toMatchObject({ opening: { index: 0, ticks: 456, gated: true, marked: true, armed: true }, display: true })
  expect(facts(first).flight).toMatchObject({ gated: true, dives: 1 })
  // A ground-only first attack of the same flier is the same Java but for its place.
  expect(fly(opening(epicBoss, "sweep"))).toContain("private static final int BOSS_OPENING = 2;")
})

test("the words say it: the card and the summary, the instructions an AI is given, the guide's test step and the contract a reviewer reads", () => {
  const abilities = [slam, burst]
  const said = bossWords.intro(opening(walker, "burst"), {}, abilities)
  expect(said).toContain(`，登场以后先用「${burst.name}」：它用过一次之前别的招式都不出`)
  expect(said).toContain(`${(BOSS_LIMITS.opening.floor * TICKS + Math.round(burst.start.cooldown * TICKS)) / TICKS} 秒还没用出来`)
  expect(said).toContain("离开重置后下一场重新先用它，变身不会让它重来")
  expect(said).not.toContain("飞不到")
  expect(bossWords.summary(opening(walker, "burst"), abilities, "\n").split("\n")[1]).toContain("登场以后先用")
  // A flier is told its trip, and what it is told is the number the Java holds.
  const flying = bossWords.intro(opening(epicBoss, "stoop"), bossOwn({ habits: epicHabits, flight: dragonFlight }), epicAbilities, dragonFlight)
  expect(flying).toContain("22.8 秒还没用出来")
  expect(flying).toContain("它飞不到、落不到这招要的地方")
  // Without ability data at hand the wait is not made up; without a first attack nothing is added.
  expect(bossWords.intro(opening(walker, "burst"), {}, [{ id: "burst", name: "迸裂" }])).toContain("一阵子还没用出来")
  expect(bossWords.intro(walker)).not.toContain("登场以后先用")
  expect(bossWords.intro(opening(walker, null))).toBe(bossWords.intro(walker))
  // What an AI is told, and the example it is given still parses.
  for (const word of ["opening（可选）", "weight 随机", "用过一次之前，别的招式都不出", "离开重置之后下一场重新先用它", "变身不会让它重来", "第一阶段能用的招式", `过了 ${BOSS_LIMITS.opening.floor} 秒`]) expect(BOSS_INSTRUCTIONS).toContain(word)
  expect(BOSS_SUMMARY).toContain("第一招（opening）")
  expect(BossSchema.safeParse(JSON.parse(/例：(\{"bar".*\})。$/.exec(BOSS_INSTRUCTIONS)![1]!)).success).toBe(true)
  // The reviewer reads the class: the first attack, and that the gate, the mark and the arming are really there; a class that lacks one is not credited with it.
  const contract = (java: string) => creatureContractLines({ title: "龙", key: "dragon" }, facts(java)).join("\n")
  expect(contract(fly(opening(epicBoss, "stoop")))).toContain("登场以后的第一招是")
  expect(contract(fly(opening(epicBoss, "stoop")))).toContain("最多等 456 刻")
  expect(contract(fly(epicBoss))).not.toContain("登场以后的第一招")
  expect(contract(fly(opening(epicBoss, "stoop")).replace("bossOpened || ", ""))).toContain("没有读到先用第一招、别的招式等着的那一步")
})

const bossProject = async (boss: Boss) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-opening-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const golem = sample.entities[0]!
  const project = await saveProject(directory, { ...sample, entities: [{ ...golem, abilities: EntitySchema.shape.abilities.unwrap().unwrap().parse([slam, burst]), boss }] }, sample.revision)
  const source = path.join(root, "source")
  await mkdir(source)
  return { root, directory, project, source, built: await assembleBuildSource(directory, source, TEMPLATE) }
}

test("the mod guide says what to look for after the wake-up, what happens when the first attack cannot start, and the reset", async () => {
  const lines = async (boss: Boss) => (await bossProject(boss)).built.guide.sections.flatMap((section: { lines: { text: string }[] }) => section.lines.map((line) => line.text))
  const step = (await lines(opening(walker, "burst"))).find((line: string) => line.includes("登场以后的第一招"))!
  expect(step).toContain(`该是「${burst.name}」`)
  expect(step).toContain(`离它 ${burst.start.min_distance}–${burst.start.max_distance} 格`)
  expect(step).toContain(`躲到离它 ${burst.start.max_distance} 格以外、但别走出 ${BOSS_LIMITS.battle} 格（走出 ${BOSS_LIMITS.battle} 格待够 ${walker.leash!.reset_seconds} 秒它会先重置）`)
  // epic r3 review: what the wait opens is the other abilities that may start then, not "the others start".
  expect(step).toContain(`登场结束约 ${(BOSS_LIMITS.opening.floor * TICKS + Math.round(burst.start.cooldown * TICKS)) / TICKS} 秒以后它就放开其他符合条件的招式`)
  expect(step).toContain(`走远待够 ${walker.leash!.reset_seconds} 秒`)
  expect(step).toContain("变身（进下一个阶段）不会让它重新先用这一招")
  // Without one the step is not there, and the other steps are found where they were.
  const plainLines = await lines(walker)
  expect(plainLines.some((line: string) => line.includes("登场以后的第一招"))).toBe(false)
  expect(plainLines.find((line: string) => line.includes("是 Boss"))).toContain("Studio 不会替你把它叫醒")
}, 120000)

test.skipIf(!hasTargetJavac(OFFICIAL))("the generated tree of a flying boss that dives first, and of a walking one that names its first attack, compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-opening-tree-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  // The epic tier asks for a felt fight: the ground sweep shakes the screen.
  const felt = epicAbilities.map((ability) => (ability.id === "sweep" ? { ...ability, events: [...ability.events, { type: "shake" as const, at: 0.9, strength: 2, radius: 16, seconds: 1 }] } : ability))
  const dragon = EntitySchema.parse({ ...sample.entities[0]!, abilities: felt, flight: dragonFlight, habits: epicHabits, boss: opening(epicBoss, "stoop") })
  const saved = await saveProject(directory, { ...sample, entities: [dragon] } as never, sample.revision)
  await putModelAsset(directory, { entity_id: dragon.id, data: { design: dragonDesign }, origin: "example", expectedRevision: saved.revision })
  const source = path.join(root, "source")
  await mkdir(source)
  const built = await assembleBuildSource(directory, source, TEMPLATE)
  expect(built.findings.filter((finding) => finding.stops)).toEqual([])
  const compiled = (await compileTreeFor(OFFICIAL, source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
  // The walking boss whose first attack is its second ability.
  const walking = await bossProject(opening(walker, "burst"))
  const walked = (await compileTreeFor(OFFICIAL, walking.source))!
  expect(walked.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(walked.code).toBe(0)
}, 300000)

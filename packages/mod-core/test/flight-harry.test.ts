import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { putModelAsset } from "../src/assets"
import { assembleBuildSource } from "../src/build-source"
import { FLIGHT_INSTRUCTIONS, flightFight, flightPlan, flightWords } from "../src/creature-flight"
import { AbilitySchema, EntitySchema, FlightSchema } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { createEntity, saveProject } from "../src/project"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, targetJavac } from "./target-javac"

const OFFICIAL = hasTargetJavac("fabric-1.21.1-official")

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))

// broad9 w2: bumblebees that were set on the player by gameplay code chased on the ground while the guide said they hover above. A flier that has a target (given by its own
// goal, a revenge, gameplay code) is in the air or on the ground by what it can do there: an ability that may start in the air circles, no ability at all closes in and swings,
// abilities that all say `ground` keep it on the ground as they say, a passive one does not fight.

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const clip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })
const design = {
  ...fightingGolemDesign,
  animations: [...fightingGolemDesign.animations.filter((animation) => !["burst", "wave", "roar"].includes(animation.name)), clip("takeoff", 1.5, false), clip("fly", 1, true), clip("hover", 1, true), clip("land", 1.2, false)],
}
const hovering = FlightSchema.parse({ style: "hover", speed: 6, altitude: { min: 2, max: 6 }, turn: 120, climb: 40, bank: 10, air_share: 0.5, takeoff: { clip: "takeoff", seconds: 1.5 }, land: { clip: "land", seconds: 1.2 }, clips: { fly: "fly", glide: null, hover: "hover" } })
const base = { modId: "golem_mod", packageName: "com.minemods.content_golem_mod", id: "bee", name: "蜜蜂", health: 10, speed: 0.25, attack_damage: 2, model: design, flight: hovering }
const runtime = { spawn: null, explosion: null, movement: "direct" as const, armor: 0, charging_armor: 0, texture_asset_id: null }
const entity = "src/main/java/com/minemods/content_golem_mod/entity/StudioCreature.java"
const java = (files: Record<string, string | Uint8Array>) => String(files[entity])
const airSwing = /if \(flightState\(\) != FLIGHT_GROUND\) \{\n {16}if \(runtimeAttackCooldown == 0 && isWithinMeleeAttackRange\(target\)\) \{\n {20}doHurtTarget\(target\);\n {20}runtimeAttackCooldown = 20;/
const airSting = AbilitySchema.parse({ ...golemAbilities[0], id: "sting", where: "air" })
const groundSlam = AbilitySchema.parse({ ...golemAbilities[0], where: "ground" })

test("how a flier fights follows from what it can do: air abilities circle, none at all closes in, ground-only stays down, a passive one does not fight", () => {
  expect(flightFight([airSting], "hostile")).toBe("circle")
  expect(flightFight([AbilitySchema.parse(golemAbilities[0])], "hostile")).toBe("circle") // `where` left out is either
  expect(flightFight([], "hostile")).toBe("harry")
  expect(flightFight([], "follow")).toBe("harry")
  expect(flightFight([groundSlam], "hostile")).toBe("ground")
  expect(flightFight([], "passive")).toBe("none")
  // The plan carries it: only a flier that closes in is told to.
  expect(flightPlan(hovering, [], true, true).harries).toBe(true)
  expect(flightPlan(hovering, [airSting], true).harries).toBe(false)
})

test("a hostile flier with no ability goes up after its target and swings in the air, whoever gave it the target", () => {
  // Its own chase goal keeps its target to itself: flight reads it too, or a bee that picked the player itself would walk after them.
  const own = java(compileEntity({ ...base, behavior: "hostile", runtime }))
  expect(own).toContain("private Player runtimeChasing;")
  expect(own).toContain("@Override public void start() { runtimeChasing = target; }")
  expect(own).toContain("runtimeChasing = null;")
  expect(own).toContain("private LivingEntity flightAfter()")
  expect(own).toContain("LivingEntity chasing = runtimeChasing;")
  // A target set from outside (gameplay code, a revenge) is the game's target; the same functions read it first.
  expect(own).toContain("LivingEntity target = getTarget();\n        if (target != null && target.isAlive()) return target;")
  // Wanting the air needs nothing but a target; taking off for one is not waiting for the mood.
  expect(own).toMatch(/private boolean flightWantsAir\(\) \{\n {8}if \(flightReturning\) return true;\n {8}LivingEntity target = flightAfter\(\);\n {8}if \(target != null && target\.isAlive\(\)\) return true;/)
  expect(own).toMatch(/private boolean flightUrgent\(\) \{\n {8}LivingEntity target = flightAfter\(\);\n {8}return flightReturning \|\| flightAsked\(\) \|\| \(target != null && target\.isAlive\(\)\);/)
  // It closes in to the level of the middle of its target, short of them by a gap inside a swing's reach, and does not hold to its band over the ground.
  expect(own).toContain("boolean harries = !flightReturning && !fights && target != null && target.isAlive();")
  expect(own).toContain("target.getY() + target.getBbHeight() * 0.6")
  expect(own).toContain("FLIGHT_HARRY_GAP = 0.4;")
  expect(own).toContain("flightSteer(point, flightApproach(point, FLIGHT_CRUISE), false);")
  // In the air the plain swing is still the creature's, with the same cooldown as on the ground; it does not walk.
  expect(own).toMatch(airSwing)
  // One whose target is the game's alone (engagement: gameplay or its own targeting) has no field of its own to read, and the same behaviour.
  const engaged = java(compileEntity({ ...base, behavior: "hostile", runtime, engagement: "any_player" }))
  expect(engaged).not.toContain("runtimeChasing")
  expect(engaged).toContain("boolean harries")
  expect(engaged).toMatch(airSwing)
  // A follower is not after anybody by itself, but one that was given a target (gameplay code) goes after it in the air like the rest.
  const follower = java(compileEntity({ ...base, behavior: "follow", runtime }))
  expect(follower).not.toContain("runtimeChasing")
  expect(follower).toContain("boolean harries")
  expect(follower).not.toMatch(airSwing)
})

test("a flier with abilities keeps going by them, a passive one is not made to fight, and one without a flight is what it was", () => {
  // Some ability may start in the air: it circles, as before; nothing of the harrying is written.
  const circling = java(compileEntity({ ...base, behavior: "hostile", abilities: [airSting] }))
  expect(circling).not.toMatch(/FLIGHT_HARRY|harries|flightAfter/)
  expect(circling).toContain("private static final boolean FLIGHT_FIGHTS = true;")
  // Every ability says ground: it fights on the ground, as they say, and waits for the mood to fly like any creature with a target it cannot use the air for.
  const grounded = java(compileEntity({ ...base, behavior: "hostile", abilities: [groundSlam] }))
  expect(grounded).not.toMatch(/FLIGHT_HARRY|harries|flightAfter/)
  expect(grounded).toContain("private static final boolean FLIGHT_FIGHTS = false;")
  // Passive: no fight, so a target changes nothing (the bytes of a passive hovering creature are pinned in giant-anchors.test.ts).
  expect(java(compileEntity({ ...base, behavior: "passive", runtime }))).not.toMatch(/FLIGHT_HARRY|harries|flightAfter/)
  // A hostile creature that does not fly gets none of it.
  const { flight: _flight, ...walking } = base
  expect(java(compileEntity({ ...walking, behavior: "hostile", runtime }))).not.toMatch(/runtimeChasing|flightAfter|harries/)
})

test.skipIf(!OFFICIAL)("every shape of a flier that closes in compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-harry-"))
  roots.push(root)
  const shapes = [
    { name: "StudioCreature", files: compileEntity({ ...base, behavior: "hostile", runtime }) },
    { name: "EngagedBee", files: compileEntity({ ...base, behavior: "hostile", runtime, engagement: "any_player" }) },
    { name: "FollowerBee", files: compileEntity({ ...base, behavior: "follow", runtime }) },
    { name: "PlainBee", files: compileEntity({ ...base, behavior: "hostile" }) },
    { name: "GroundedBee", files: compileEntity({ ...base, behavior: "hostile", abilities: [groundSlam], runtime }) },
  ]
  await Promise.all(shapes.map((shape) => writeFile(path.join(root, `${shape.name}.java`), String(shape.files[entity]).replaceAll("StudioCreature", shape.name))))
  await writeFile(path.join(root, "StudioCreatureRenderer.java"), String(shapes[0]!.files["src/main/java/com/minemods/content_golem_mod/client/StudioCreatureRenderer.java"]))
  const compiled = await targetJavac("fabric-1.21.1-official", root)
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

test("the words say what the creature will really do, and the instructions say the three cases", () => {
  expect(flightWords.fights("circle")).toBe("会飞，追人时在你上空盘旋")
  expect(flightWords.fights("harry")).toContain("近身攻击")
  expect(flightWords.fights("ground")).toContain("留在地上")
  // A follower or a passive one is not after anybody by itself, so the guide claims nothing about chasing.
  expect(flightWords.fights("none")).toBe("会飞")
  ;["每个都是 where: ground 的", "一个招式都没写的", "近身攻击", "自己选的、被打了还手、还是玩法代码给它定的"].forEach((words) => expect(FLIGHT_INSTRUCTIONS).toContain(words))
})

test.skipIf(!OFFICIAL)("the whole generated tree of a project with a hostile hovering bee and a following one compiles", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-harry-tree-"))
  roots.push(root)
  const directory = path.join(root, "project")
  const sample = await createDataGameplaySample(directory, { life: true, abilities: true })
  const spawn = { biomes: ["minecraft:plains"], weight: 6, min: 1, max: 2 }
  const bee = (name: string, behavior: "hostile" | "follow") =>
    EntitySchema.parse({
      ...createEntity({ name, description: "停在空中的小飞虫。", health: 6, speed: 0.2, attack_damage: behavior === "hostile" ? 2 : 0, behavior }),
      runtime: { spawn, explosion: null, movement: "direct", armor: 0, charging_armor: 0, texture_asset_id: null },
      name_en: name === "蜜蜂" ? "Bumblebee" : "Followbee",
      flight: hovering,
    })
  const bees = [bee("蜜蜂", "hostile"), bee("跟随蜂", "follow")]
  const saved = await saveProject(directory, { ...sample, entities: [sample.entities[0]!, ...bees] }, sample.revision)
  const put = async (revision: number, entityId: string) => (await putModelAsset(directory, { entity_id: entityId, data: { design }, origin: "example", expectedRevision: revision })).project
  const project = await put((await put(saved.revision, bees[0]!.id)).revision, bees[1]!.id)
  const source = path.join(root, "source")
  await mkdir(source)
  await assembleBuildSource(directory, source, TEMPLATE)
  const folder = path.join(source, "src/main/java/com/minemods/content_azure_sample/entity")
  const sources = await Promise.all((await readdir(folder)).filter((file) => file.endsWith(".java")).map((file) => readFile(path.join(folder, file), "utf8")))
  expect(project.entities).toHaveLength(3)
  expect(sources.filter((text) => text.includes("boolean harries"))).toHaveLength(2)
  expect(sources.filter((text) => text.includes("runtimeChasing = target;"))).toHaveLength(1)
  const compiled = (await compileTreeFor("fabric-1.21.1-official", source))!
  expect(compiled.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(compiled.code).toBe(0)
}, 180000)

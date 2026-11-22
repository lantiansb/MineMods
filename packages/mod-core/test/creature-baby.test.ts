import { afterEach, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assembleBuildSource } from "../src/build-source"
import { CREATURE_BABY, CREATURE_LIFE_CAPABILITY } from "../src/creature-capability"
import { creatureContractLines, readGeneratedCreature } from "../src/creature-contract"
import { AbilitySchema, BossSchema, FlightSchema, type Ability, type Boss } from "../src/entity-runtime"
import { compileEntity } from "../src/fabric/entity"
import { compileHitboxParts } from "../src/fabric/hitbox"
import { GAMEPLAY_API_WORDS } from "../src/gameplay-check"
import { ideaInstructions, blueprintPlannerInstructions } from "../src/blueprint-planner"
import { GAMEPLAY_INSTRUCTIONS, GAMEPLAY_REVIEWER_INSTRUCTIONS, GAMEPLAY_SHEET_INSTRUCTIONS } from "../src/gameplay-words"
import { assetKind } from "../src/workspace-modules"
import { createDataGameplaySample, fightingGolemDesign, golemAbilities } from "../script/data-gameplay-sample"
import { compileTreeFor } from "./java-tree"
import { hasTargetJavac, hasTargetJavap, targetJavap } from "./target-javac"

/** The class path the generated Java is compiled against: Fabric with Mojang's names. */
const OFFICIAL = "fabric-1.21.1-official"
const javap = (classes: string, name: string) => targetJavap(OFFICIAL, classes, name)

const TEMPLATE = fileURLToPath(new URL("../../../templates/fabric-1.21", import.meta.url))
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const PACKAGE = "com.minemods.content_golem_mod"
const clip = (name: string, length: number, loop: boolean) => ({ name, length, loop, channels: [{ bone: "body", keyframes: [{ time: 0, rotation: [0, 0, 0] }, { time: length / 2, rotation: [-10, 0, 0] }, { time: length, rotation: [0, 0, 0] }] }] })
const flierDesign = { ...fightingGolemDesign, animations: [...fightingGolemDesign.animations.filter((animation) => ["idle", "walk", "hurt", "death"].includes(animation.name)), clip("takeoff", 1, false), clip("fly", 1, true), clip("hover", 1, true), clip("land", 1, false)] }
const hovering = FlightSchema.parse({ style: "hover", speed: 6, altitude: { min: 2, max: 6 }, turn: 200, climb: 40, bank: 20, air_share: 0.4, takeoff: { clip: "takeoff", seconds: 1 }, land: { clip: "land", seconds: 1 }, clips: { fly: "fly", glide: null, hover: "hover" } })
const [slam, burst] = golemAbilities.map((ability) => AbilitySchema.parse(ability)) as [Ability, Ability]
const boss: Boss = BossSchema.parse({
  bar: { color: "purple", style: "notched_10", darken_sky: true },
  intro: { wake_distance: 16, clip: "roar", seconds: 0.8, sound: "entity.iron_golem.attack" },
  phases: [{ below: 0.5, clip: "wave", seconds: 1, bar_color: "red", speed: 1.15, damage: 1.3, abilities: ["slam"] }],
  death: { seconds: 4, xp_bursts: 6, explosion: true },
  leash: { distance: 48, reset_seconds: 30 },
})
const base = { modId: "golem_mod", packageName: PACKAGE, health: 20, speed: 0.25, attack_damage: 3 }
const wing = { name: "翅", forward: 0, up: 0.2, left: 0.6, width: 0.4, height: 0.3 }

/** Every kind of creature the generator makes: what it is called, and what it is made from. */
const KINDS = [
  { suffix: "A", name: "passive", input: { ...base, id: "kind_a", name: "小鸡", behavior: "passive" as const, model: fightingGolemDesign, attack_damage: 0 } },
  { suffix: "B", name: "follower", input: { ...base, id: "kind_b", name: "跟随者", behavior: "follow" as const, model: fightingGolemDesign, attack_damage: 0 } },
  { suffix: "C", name: "hostile with abilities", input: { ...base, id: "kind_c", name: "怪", behavior: "hostile" as const, model: fightingGolemDesign, abilities: [slam, burst] } },
  { suffix: "D", name: "boss", input: { ...base, id: "kind_d", name: "首领", behavior: "hostile" as const, model: fightingGolemDesign, abilities: [slam, burst], boss } },
  { suffix: "E", name: "passive flier with collision parts", input: { ...base, id: "kind_e", name: "小飞虫", behavior: "passive" as const, model: flierDesign, attack_damage: 0, flight: hovering, hitbox: { core: { width: 0.6, height: 0.6 }, parts: [wing] } } },
] as const

const files = (kind: (typeof KINDS)[number]) => compileEntity({ ...kind.input, classSuffix: kind.suffix }) as Record<string, string | Uint8Array>
const entityJava = (kind: (typeof KINDS)[number]) => String(files(kind)[`src/main/java/${PACKAGE.replaceAll(".", "/")}/entity/StudioCreature${kind.suffix}.java`])

test("every kind of creature is the game's own ageing animal: baby, grown, saved, and half the size for the box and the picture alike", () => {
  for (const kind of KINDS) {
    const java = entityJava(kind)
    // The class the game's setBaby, Age and growing-up belong to (a plain mob answers setBaby with nothing).
    expect(java, kind.name).toContain(`public class StudioCreature${kind.suffix} extends AgeableMob implements GeoEntity`)
    expect(java, kind.name).toContain("import net.minecraft.world.entity.AgeableMob;")
    // The one method that class leaves open: a new baby of the same kind.
    expect(java, kind.name).toMatch(new RegExp(`public AgeableMob getBreedOffspring\\(net\\.minecraft\\.server\\.level\\.ServerLevel world, AgeableMob other\\) \\{\\s*StudioCreature${kind.suffix} child = \\(StudioCreature${kind.suffix}\\) getType\\(\\)\\.create\\(world\\);\\s*if \\(child != null\\) child\\.setBaby\\(true\\);\\s*return child;`))
    // Half the size lives in getScale (GeckoLib draws by it, and the box and every measure of the body follow); the game's own half for the box alone is turned off, or the box would be a quarter.
    expect(java, kind.name).toContain("public float getScale() { return super.getScale() * (isBaby() ? net.minecraft.world.entity.LivingEntity.EXTRA_RENDER_CULLING_SIZE_WITH_BIG_HAT : 1.0f); }")
    expect(java, kind.name).toContain("public float getAgeScale() { return 1.0f; }")
    // Never born a baby by the game's herd roll: nothing that was an adult before is a baby now.
    expect(java, kind.name).toContain("data instanceof AgeableMob.AgeableMobGroupData ? data : new AgeableMob.AgeableMobGroupData(false)")
    // The age is the game's own, and every override that saves something calls the game's first, so "Age" is written and read like any animal's.
    for (const method of ["addAdditionalSaveData", "readAdditionalSaveData"])
      for (const found of java.matchAll(new RegExp(`public void ${method}\\(CompoundTag nbt\\) \\{\\s*(super\\.${method}\\(nbt\\);)?`, "g"))) expect(found[1], `${kind.name} ${method}`).toBeDefined()
    expect(java, kind.name).not.toMatch(/\b(breedingAge|forcedAge)\b/)
  }
})

test("a hostile creature and a boss are the game's Monster, so what asks \"is this an enemy\" finds them; no other kind is", () => {
  for (const kind of KINDS) {
    const java = entityJava(kind)
    const hostile = kind.input.behavior === "hostile"
    // The marker the game's own code (a conduit, an iron golem, a lead) and gameplay code ask by; HostileEntity is the vanilla class that carries it, which these cannot extend.
    expect(/public class StudioCreature\w+ extends AgeableMob implements GeoEntity(?:, \w+(?:\.\w+)*)*, Enemy\b/.test(java), kind.name).toBe(hostile)
    expect(java.includes("import net.minecraft.world.entity.monster.Enemy;"), kind.name).toBe(hostile)
    expect(java, kind.name).not.toContain("extends Monster")
  }
  expect(KINDS.filter((kind) => kind.input.behavior === "hostile").map((kind) => kind.name)).toEqual(["hostile with abilities", "boss"])
})

test("the picture is drawn by the body's scale: the shadow follows it, and the flier's lean turns about the middle of what is drawn", () => {
  const renderer = (kind: (typeof KINDS)[number]) => String(files(kind)[`src/main/java/${PACKAGE.replaceAll(".", "/")}/client/StudioCreatureRenderer${kind.suffix}.java`])
  for (const kind of KINDS) expect(renderer(kind), kind.name).toContain(`protected float getShadowRadius(StudioCreature${kind.suffix} creature) { return super.getShadowRadius(creature) * creature.getScale(); }`)
  const flier = renderer(KINDS[4])
  expect(flier).toContain("float middle = creature.getBbHeight() * 0.5f / nativeScale;")
})

test("the contract reads it off the generated class; a class without it is said to have no effect, never counted as having it", () => {
  for (const kind of KINDS) {
    const java = entityJava(kind)
    const facts = readGeneratedCreature(java, null)
    expect(facts.grows, kind.name).toBe(true)
    const lines = creatureContractLines({ title: "对象", key: "x" }, facts).join("\n")
    expect(lines, kind.name).toContain(`幼年：${CREATURE_BABY.capability}`)
    expect(lines, kind.name).toContain("24000 刻，20 分钟")
    expect(lines, kind.name).not.toContain("在游戏里没有效果")
  }
  // The ways the class could fail to be one: the old base class, no half in the scale, the game's own half left on as well. Each is read as not there.
  const java = entityJava(KINDS[0])
  const broken = [
    java.replace("extends AgeableMob implements", "extends PathfinderMob implements"),
    java.replace("EXTRA_RENDER_CULLING_SIZE_WITH_BIG_HAT : 1.0f", "1.0f : 1.0f"),
    java.replace("public float getAgeScale() { return 1.0f; }", ""),
    java.replace("child.setBaby(true);", ""),
  ]
  for (const text of broken) {
    expect(text).not.toBe(java)
    const facts = readGeneratedCreature(text, null)
    expect(facts.grows).toBe(false)
    expect(creatureContractLines({ title: "对象", key: "x" }, facts).join("\n")).toContain("setBaby(...) 在游戏里没有效果")
  }
})

test("what the AI that writes gameplay is told, and what the capability list says: one sentence each, true, and honest that it was not seen in the game", () => {
  const told = GAMEPLAY_API_WORDS.filter((line) => line.includes("setBaby"))
  expect(told).toHaveLength(1)
  expect(told[0]).toContain("setBaby(true)")
  expect(told[0]).toContain("24000 刻，20 分钟")
  expect(GAMEPLAY_INSTRUCTIONS).toContain(told[0]!)
  const listed = CREATURE_LIFE_CAPABILITY.done.filter((line) => line.includes("setBaby"))
  expect(listed).toHaveLength(1)
  expect(listed[0]).toContain("24000 刻，20 分钟")
  // Listed as something it can do, with the honest mark that nobody has seen it in the game; no second line in the list of what it cannot.
  expect(listed[0]).toContain("还没有在游戏里看过")
  expect(CREATURE_LIFE_CAPABILITY.not_done.filter((line) => line.includes("setBaby"))).toEqual([])
  // Said nowhere as something it cannot do.
  expect(JSON.stringify(CREATURE_LIFE_CAPABILITY)).not.toMatch(/不能(?:变成|是)幼年|没有幼年/)
})

test("every stage that plans, describes, writes, reviews or lists what a creature can do is told it can be a baby, from the one source", () => {
  // The planner reads the creature kind's summary from the registry; the ideas step reads the same lines.
  const summary = assetKind("entity").summary
  expect(summary).toContain(CREATURE_BABY.summary)
  expect(blueprintPlannerInstructions("fabric-1.21.1")).toContain(CREATURE_BABY.summary)
  expect(ideaInstructions("fabric-1.21.1")).toContain(CREATURE_BABY.summary)
  // Whoever writes the gameplay's description, whoever writes its code and whoever reviews it, and the list an outside AI is handed.
  expect(GAMEPLAY_SHEET_INSTRUCTIONS).toContain(CREATURE_BABY.plain)
  expect(GAMEPLAY_INSTRUCTIONS).toContain(CREATURE_BABY.capability)
  expect(GAMEPLAY_REVIEWER_INSTRUCTIONS).toContain(CREATURE_BABY.what)
  expect(CREATURE_LIFE_CAPABILITY.done.some((line) => line.includes(CREATURE_BABY.capability))).toBe(true)
  // The same facts in each: how big, how long to grow, that it is kept in the save, and what it does not do by itself.
  for (const text of [CREATURE_BABY.summary, CREATURE_BABY.plain, CREATURE_BABY.capability]) {
    expect(text).toContain("一半大")
    expect(text).toContain("24000 刻，20 分钟")
    expect(text).toContain("不会生出幼年")
  }
  // Nothing decides for the AI what a thing that comes out of something is: no word about hatching, eggs of a chicken, or what an adult is, in the shared words.
  expect(JSON.stringify(CREATURE_BABY)).not.toMatch(/孵|小鸡|必须是幼年|一律/)
})

test.skipIf(!hasTargetJavac(OFFICIAL))("every kind compiles against the game, and the compiled class is an AgeableMob with the baby's methods; the renderer takes its shadow from the scale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-baby-"))
  roots.push(root)
  const source = path.join(root, "source")
  const folder = path.join(source, "src", "main", "java", ...PACKAGE.split("."))
  await mkdir(folder, { recursive: true })
  // The helper that compiles a tree finds the package from this file; every other file is a creature's own.
  await writeFile(path.join(folder, "StudioContentRegistry.java"), `package ${PACKAGE};\npublic final class StudioContentRegistry {}\n`)
  for (const kind of KINDS)
    for (const [name, text] of Object.entries(files(kind))) {
      if (!name.endsWith(".java")) continue
      await mkdir(path.dirname(path.join(source, name)), { recursive: true })
      await writeFile(path.join(source, name), String(text))
    }
  for (const [name, text] of Object.entries(compileHitboxParts({ modId: "golem_mod", packageName: PACKAGE, lean: true }).files)) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true })
    await writeFile(path.join(source, name), String(text))
  }
  const classes = path.join(root, "classes")
  await mkdir(classes)
  const built = (await compileTreeFor(OFFICIAL, source, classes))!
  expect(built.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(built.code).toBe(0)
  if (!hasTargetJavap(OFFICIAL)) return
  for (const kind of KINDS) {
    const entity = javap(classes, `${PACKAGE}.entity.StudioCreature${kind.suffix}`)
    expect(entity, kind.name).toContain("extends net.minecraft.world.entity.AgeableMob")
    // The compiled class is a Monster exactly when it is hostile.
    expect(/implements [^{]*net\.minecraft\.world\.entity\.monster\.Enemy\b/.test(entity), kind.name).toBe(kind.input.behavior === "hostile")
    for (const member of ["getBreedOffspring(net.minecraft.server.level.ServerLevel, net.minecraft.world.entity.AgeableMob)", "getScale()", "getAgeScale()", "finalizeSpawn(net.minecraft.world.level.ServerLevelAccessor"]) expect(entity, `${kind.name} ${member}`).toContain(member)
    expect(javap(classes, `${PACKAGE}.client.StudioCreatureRenderer${kind.suffix}`), kind.name).toContain(`getShadowRadius(${PACKAGE}.entity.StudioCreature${kind.suffix})`)
  }
}, 240000)

test.skipIf(!hasTargetJavac(OFFICIAL))("a whole project with a fighting creature and a long one with collision boxes builds, and both classes are the baby's", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "minemods-baby-project-"))
  roots.push(root)
  const [project, source, classes] = ["project", "source", "classes"].map((name) => path.join(root, name)) as [string, string, string]
  await Promise.all([project, classes].map((directory) => mkdir(directory)))
  await createDataGameplaySample(project, { chain: true, life: true, abilities: true, effects: true, hitbox: true })
  await assembleBuildSource(project, source, TEMPLATE)
  const built = (await compileTreeFor(OFFICIAL, source, classes))!
  expect(built.output.split("\n").filter((line) => line.includes("error"))).toEqual([])
  expect(built.code).toBe(0)
  if (!hasTargetJavap(OFFICIAL)) return
  const entities = path.join(source, "src", "main", "java", "com", "minemods", "content_azure_sample", "entity")
  const names = (await readdir(entities)).filter((file) => /^StudioCreature\w*\.java$/.test(file)).map((file) => file.replace(/\.java$/, ""))
  expect(names.length).toBeGreaterThanOrEqual(2)
  for (const name of names) expect(javap(classes, `com.minemods.content_azure_sample.entity.${name}`)).toContain("extends net.minecraft.world.entity.AgeableMob")
}, 240000)
